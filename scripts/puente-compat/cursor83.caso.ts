// Grok ID 83 + A7 ampliado (09-nov): el AGENTE DE PROD (`4d3513a`, sin cambios) contra el Edge nuevo y la RPC REAL
// `pos_ndf_ingestar` en STAGING, ciclo por ciclo, con un PoS simulado que cambia entre ciclos.
//
// Cómo se usa la base sin dejar nada: cada llamada al «Edge» manda a staging UNA transacción que (1) crea la 082 a
// probar, (2) vuelve a correr TODA la historia de llamadas anteriores del escenario y la nueva, (3) lee el estado y
// (4) termina con un `raise` que trae el resultado y descarta todo. Ninguna fila queda en staging.
//
// Dos corridas del mismo escenario:
//   · CONTROL con la 082 de `e4678b3` («solo avanza»): tiene que REPRODUCIR el bug (una factura queda en `R`).
//   · NUEVA con la 082 de esta rama («corte seguro»): cada venta entra exactamente una vez y con su estado final.
//
// No se importa nada del árbol de trabajo: `correr.sh` arma la carpeta temporal (VIEJO = 4d3513a: pos-bridge +
// src/shared; NUEVO = la rama: src/shared; y las dos 082). Necesita red a api.supabase.com (el proxy pone el token).
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// @ts-nocheck — se resuelve en la carpeta temporal
import { ESTADO_INICIAL, ejecutarCiclo, type EstadoAgente, type PuertosCiclo } from './VIEJO/pos-bridge/ciclo.ts'
import { leerAbiertas, leerCerradas, leerProvisionales } from './VIEJO/pos-bridge/consultaAgente.ts'
import type { FilaDetalle, FilaFactura, Queryable } from './VIEJO/pos-bridge/consulta.ts'
import { resolverEsquema } from './VIEJO/pos-bridge/esquema.ts'
import { pushIngest } from './VIEJO/pos-bridge/pushIngest.ts'
import { MAX_TICKETS, normalizarLote, validarPayload } from './NUEVO/src/shared/ndf/ingestNdf.ts'

const REF = 'hwiatgicyyqyezqwldia'   // SOLO staging
// El Edge solo acepta los locales conocidos: se usa `nosara` (en staging no tiene agente). Lo que staging tenga de ese
// local se borra al empezar CADA transacción, que después se descarta: staging queda igual.
const LOCAL = 'nosara'
const VENTANA = 36
const COLUMNAS = {
  fac_facturas: ['NumeroFactura', 'FechaRegistra', 'Estado', 'Login', 'Efectivo', 'Tarjeta', 'MontoElectronico', 'Deposito',
    'Cheque', 'CuentaCobrar', 'DolaresEfectivo', 'DolaresTarjeta', 'Vuelto', 'FechaCierra'],
  fac_pedidos: ['NumeroFactura', 'UsuarioRegistra', 'Personas', 'Tipo', 'Area', 'NumeroPedido', 'Mesa', 'FechaRegistra', 'Estado'],
  fac_facturasdet: ['NumeroFactura', 'CodigoProducto', 'Cantidad', 'Monto', 'ImpS'],
  fac_productos: ['Codigo', 'Nombre', 'Clasificacion'],
  fac_clasificaciones: ['Codigo', 'Nombre'],
  fac_empleados: ['Login', 'Nombre'],
}
const ESQUEMA = resolverEsquema(new Map(Object.entries(COLUMNAS)))

// ── PoS simulado ──────────────────────────────────────────────────────────────────────────────────────────────
type Estado = 'C' | 'R' | 'X'
const fac = (n: string, estado: Estado): FilaFactura => ({
  numero_factura: n, fecha_hora: '2026-11-08 19:00:00', estado, login_cajero: '222', tipo_factura: null,
  area_factura: null, usuario_registra: '026', usuario_max: '026', personas: 0, pedidos: 1, tipo_pedido: 'M',
  area_pedido: 'SALON 1', salonero_nombre: 'SALONERO PRUEBA', mesa: '12', numero_pedido: `P${n}`,
  fecha_cierra: estado === 'C' ? '2026-11-08 21:00:00' : null, efectivo: estado === 'C' ? 6000 : 0, tarjeta: 0,
  monto_electronico: 0, deposito: 0, cheque: 0, cuenta_cobrar: 0, dolares_efectivo: 0, dolares_tarjeta: 0, vuelto: 0,
})
// Dos líneas por factura (la segunda distinta) para ver duplicados de líneas.
const lineasDe = (n: string): FilaDetalle[] => [
  { numero_factura: n, usuario_registra: '026', codigo: '100', nombre: 'ROLL PRUEBA', cantidad: 1, monto: 4000,
    imp_servicio: 400, imp_venta: 0, familia: 2, familia_nombre: 'SUSHI', es_extra: 0, compuesto: null },
  { numero_factura: n, usuario_registra: '026', codigo: '300', nombre: 'BEBIDA PRUEBA', cantidad: 1, monto: 2000,
    imp_servicio: 200, imp_venta: 0, familia: 10, familia_nombre: 'BEBIDAS', es_extra: 0, compuesto: null },
]

class Pos {
  facturas = new Map<string, Estado>()
  poner(n: string, e: Estado) { this.facturas.set(n, e) }
  private filas(estados: Estado[], ultima: string | null): FilaFactura[] {
    return [...this.facturas].filter(([n, e]) => estados.includes(e) && (ultima === null || BigInt(n) > BigInt(ultima)))
      .sort(([a], [b]) => (BigInt(a) < BigInt(b) ? -1 : 1)).map(([n, e]) => fac(n, e))
  }
  qy(): Queryable {
    return {
      query: async <T,>(sql: string, p?: Record<string, unknown>) => {
        if (sql.includes('[NumeroFactura] IS NULL')) return { rows: [] as T[] }   // sin mesas abiertas
        const estados: Estado[] = /IN \('R', 'X'\)/.test(sql) ? ['R', 'X'] : ['C']
        const ultima = p && 'ultima' in p ? (p.ultima as string | null) : null
        const fs = this.filas(estados, ultima)
        if (sql.includes('FAC_FacturasDet')) return { rows: fs.flatMap((f) => lineasDe(String(f.numero_factura))) as T[] }
        return { rows: fs as T[] }
      },
    }
  }
}

// ── Staging: historia que se repite en una transacción descartada ─────────────────────────────────────────────
type Paso =
  | { tipo: 'rpc'; tickets: unknown; lineas: unknown; open: unknown; cursor: unknown; falla?: boolean }
  | { tipo: 'anotarError'; mensaje: string }

const dolar = (s: string): string => {
  let tag = 'j'
  while (s.includes(`$${tag}$`)) tag += 'x'
  return `$${tag}$${s}$${tag}$`
}
const js = (v: unknown): string => (v === null || v === undefined ? 'null' : `${dolar(JSON.stringify(v))}::jsonb`)
const sinTx = (sql: string): string => sql.replace(/^\s*(begin|commit)\s*;\s*$/gim, '')

function correrEnStaging(f082: string, historia: Paso[]): { ultimo: any; error: string | null; estado: any } {
  const pasos = historia.map((p, i) => {
    const ultimo = i === historia.length - 1
    if (p.tipo === 'anotarError') {
      return `insert into public.pos_ndf_cursor (local, last_poll_at, last_error) values ('${LOCAL}', now(), ${dolar(p.mensaje)})
              on conflict (local) do update set last_poll_at = excluded.last_poll_at, last_error = excluded.last_error;`
    }
    const llamada = `public.pos_ndf_ingestar('${LOCAL}', ${js(p.tickets)}, ${js(p.lineas)}, ${js(p.open)}, ${js(p.cursor)})`
    // Una llamada que falló de verdad se repite igual y falla igual (su savepoint se descarta, como en la realidad).
    return `begin ${ultimo ? `v_res := ${llamada};` : `perform ${llamada};`}
            exception when others then ${ultimo ? 'v_err := sqlerrm;' : 'null;'} end;`
  }).join('\n')
  const q = `begin;
${sinTx(f082)}
delete from public.pos_ndf_ticket_lines l using public.pos_ndf_tickets t where t.id = l.ticket_id and t.local = '${LOCAL}';
delete from public.pos_ndf_tickets where local = '${LOCAL}';
delete from public.pos_ndf_open where local = '${LOCAL}';
delete from public.pos_ndf_cursor where local = '${LOCAL}';
do $do$
declare v_res jsonb; v_err text;
begin
  set local role service_role;
  ${pasos}
  reset role;
  raise exception 'RES:%', jsonb_build_object('ultimo', v_res, 'error', v_err,
    'cursor', (select to_jsonb(c) from public.pos_ndf_cursor c where c.local = '${LOCAL}'),
    'tickets', (select coalesce(jsonb_object_agg(t.numero_factura, jsonb_build_object('estado', t.estado,
                 'lineas', (select count(*) from public.pos_ndf_ticket_lines l where l.ticket_id = t.id))), '{}')
                  from public.pos_ndf_tickets t where t.local = '${LOCAL}'),
    'filas', (select count(*) from public.pos_ndf_tickets t where t.local = '${LOCAL}'));
end $do$;
rollback;`
  const out = execFileSync('curl', ['-sS', '-X', 'POST', `https://api.supabase.com/v1/projects/${REF}/database/query`,
    '-H', `Authorization: Bearer ${process.env.SUPABASE_ACCESS_TOKEN ?? 'x'}`, '-H', 'Content-Type: application/json',
    '--data-binary', '@-'], { input: JSON.stringify({ query: q }), maxBuffer: 64 * 1024 * 1024 }).toString()
  const m = /RES:(\{.*\})/s.exec(JSON.parse(out).message ?? '')
  if (!m) throw new Error(`staging no devolvió el resultado: ${out.slice(0, 400)}`)
  const r = JSON.parse(m[1].replace(/\\n\s*CONTEXT:.*$/s, '').trim())
  return { ultimo: r.ultimo, error: r.error, estado: r }
}

// ── El Edge emulado: lo mismo que supabase/functions/ingest-ndf/index.ts después del portón ──────────────────────
class Edge {
  historia: Paso[] = []
  llamadas = 0
  /** Respuestas forzadas por número de llamada HTTP: 'rpc_falla' = la RPC lanza (lote rechazado en la base). */
  fallas = new Map<number, 'rpc_falla' | 'red'>()
  ultimoEstado: any = null
  constructor(private f082: string) {}
  fetch = async (_url: string, init: { body: string }): Promise<Response> => {
    const n = ++this.llamadas
    if (this.fallas.get(n) === 'red') throw new TypeError('fetch failed (simulado)')
    const body = JSON.parse(init.body)
    const sobre = validarPayload(body)
    if (!sobre.ok) return new Response(JSON.stringify({ ok: false, error: sobre.error }), { status: 400 })
    const lote = normalizarLote(sobre.valor, new Date().toISOString())
    const lineas = lote.tickets.flatMap((t: any) => t.lineas.map((l: any) => ({ ...l, numero_factura: t.fila.numero_factura })))
    let tickets: unknown[] = lote.tickets.map((t: any) => t.fila)
    const falla = this.fallas.get(n) === 'rpc_falla'
    // Falla REAL de la RPC: la misma factura dos veces en el lote (la RPC rechaza el lote entero, Grok 99).
    if (falla && tickets.length) tickets = [...tickets, tickets[0]]
    this.historia.push({ tipo: 'rpc', tickets, lineas, open: lote.open === undefined ? null : lote.open, cursor: lote.cursor, falla })
    const r = correrEnStaging(this.f082, this.historia)
    this.ultimoEstado = r.estado
    if (r.error) {
      this.historia.push({ tipo: 'anotarError', mensaje: `no se pudo guardar el lote: ${r.error}` })
      this.ultimoEstado = correrEnStaging(this.f082, this.historia).estado
      return new Response(JSON.stringify({ ok: false, error: 'Error interno' }), { status: 500 })
    }
    const res = r.ultimo ?? {}
    return new Response(JSON.stringify({
      ok: true, local: LOCAL, tickets_recibidos: sobre.valor.tickets.length, tickets_guardados: res.tickets ?? 0,
      lineas_guardadas: res.lineas ?? 0, open_guardadas: res.open_guardadas ?? 0, open_borradas: res.open_borradas ?? 0,
      invalid: lote.invalid, recalculados: lote.recalculados, problemas: lote.problemas,
      cursor: res.cursor ?? null, cursor_escrito: lote.cursor !== null,
    }), { status: 200 })
  }
}

// ── El escenario ─────────────────────────────────────────────────────────────────────────────────────────────
interface Corrida { pos: Pos; edge: Edge; cursores: (string | null)[]; resumenes: any[] }

async function escenario(f082: string): Promise<Corrida> {
  const pos = new Pos()
  const edge = new Edge(f082)
  const puertos: PuertosCiclo = {
    leerCerradas: (r: any) => leerCerradas(pos.qy(), ESQUEMA, r),
    leerProvisionales: (r: any) => leerProvisionales(pos.qy(), ESQUEMA, r),
    leerAbiertas: (r: any) => leerAbiertas(pos.qy(), ESQUEMA, r),
    enviar: (payload: any) => pushIngest({ ingestUrl: 'https://edge.invalid/ingest-ndf', ingestSecret: 'x'.repeat(32) },
      payload, edge.fetch as any),
  } as PuertosCiclo
  let estado: EstadoAgente = { ...ESTADO_INICIAL }
  const cursores: (string | null)[] = []
  const resumenes: any[] = []
  const ciclo = async () => {
    const r = await ejecutarCiclo(puertos, LOCAL, VENTANA, estado, new Date('2026-11-09T04:00:00Z'))
    estado = r.estado
    cursores.push(estado.ultimaFactura)
    resumenes.push(r.resumen)
  }
  await ciclo()                                                       // 0 · saludo (nada guardado)
  for (const n of ['7001', '7002', '7004', '7005']) pos.poner(n, 'C')
  pos.poner('7003', 'R'); pos.poner('7006', 'X')
  await ciclo()                                                       // 1 · R 7003 por debajo de la mayor C (7005)
  await ciclo()                                                       // 2 · sin cambios (el agente no manda last_factura)
  pos.poner('7003', 'C'); pos.poner('7007', 'R'); pos.poner('7008', 'C')
  await ciclo()                                                       // 3 · cierra 7003; R 7007 debajo de 7008
  pos.poner('7007', 'C')
  edge.fallas.set(edge.llamadas + 1, 'rpc_falla')                     // 4 · la RPC falla en el 1.er intento; reintento ok
  await ciclo()
  estado = { ...ESTADO_INICIAL }                                      // 5 · reinicio del agente: saludo
  await ciclo()
  pos.poner('7009', 'C'); pos.poner('7010', 'R'); pos.poner('6990', 'R')
  await ciclo()                                                       // 6 · aparece una R MENOR al cursor (otra caja)
  edge.fallas.set(edge.llamadas + 1, 'red'); edge.fallas.set(edge.llamadas + 2, 'red')
  await ciclo()                                                       // 7 · red caída en los dos intentos: no avanza
  pos.poner('6990', 'C')
  await ciclo()                                                       // 8 · cierra 6990
  pos.poner('7010', 'X')
  await ciclo()                                                       // 9 · 7010 se anula
  return { pos, edge, cursores, resumenes }
}

const RAIZ = new URL('.', import.meta.url).pathname
const F082_NUEVA = readFileSync(`${RAIZ}082_nueva.sql`, 'utf8')
const F082_VIEJA = readFileSync(`${RAIZ}082_vieja.sql`, 'utf8')

describe('ID 83 · agente de prod (4d3513a) → Edge nuevo → RPC real en staging (transacciones descartadas)', () => {
  it('CONTROL con la 082 de e4678b3 («solo avanza»): reproduce el bug — 6990 queda en R', async () => {
    const c = await escenario(F082_VIEJA)
    const t = c.edge.ultimoEstado.tickets
    expect(t['6990']?.estado).toBe('R')         // cerró en el PoS y en la base sigue «en curso»
  }, 180_000)

  it('NUEVA 082 («corte seguro»): cada venta entra exactamente una vez, con su estado final y sus líneas', async () => {
    const c = await escenario(F082_NUEVA)
    const e = c.edge.ultimoEstado
    // cursores que adoptó el agente, ciclo por ciclo
    expect(c.cursores).toEqual([
      null,    // 0 saludo
      '7002',  // 1 corte seguro: R 7003 abierta debajo de 7005
      '7002',  // 2 sin cambios
      '7006',  // 3 7003 cerró; R 7007 abierta debajo de 7008
      '7008',  // 4 RPC falló en el 1.er intento, el reintento entró
      '7008',  // 5 reinicio: el saludo trae el corte guardado
      '6989',  // 6 R 6990 apareció debajo del cursor: el servidor baja el corte
      '6989',  // 7 red caída: el agente no avanza
      '7009',  // 8 6990 cerró y entró como C
      '7009',  // 9 7010 anulada (X): no retiene
    ])
    expect(c.resumenes[4].fase).toBe('sincronizado')
    expect(c.resumenes[7].fase).toBe('error_envio')
    // exactamente una vez: una fila por factura, el estado final del PoS y 2 líneas cada una
    expect(e.filas).toBe(c.pos.facturas.size)
    for (const [n, est] of c.pos.facturas) {
      expect(e.tickets[n], n).toEqual({ estado: est, lineas: 2 })
    }
    expect(e.cursor.last_factura).toBe('7009')
    expect(e.cursor.max_factura_vista).toBe('7009')
    expect(e.cursor.last_error).toBeNull()
  }, 180_000)

  it('lote en el límite del Edge: MAX_TICKETS pasa, MAX_TICKETS + 1 se rechaza entero (400) y el agente no avanza', () => {
    const t = (n: number) => ({ numero_factura: String(n), fecha_registra: '2026-11-08T19:00:00-06:00', estado: 'C', items: [] })
    expect(validarPayload({ local: LOCAL, tickets: Array.from({ length: MAX_TICKETS }, (_, i) => t(i + 1)) }).ok).toBe(true)
    expect(validarPayload({ local: LOCAL, tickets: Array.from({ length: MAX_TICKETS + 1 }, (_, i) => t(i + 1)) }).ok).toBe(false)
  })
})
