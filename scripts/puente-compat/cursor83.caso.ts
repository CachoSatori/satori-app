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
import { resolverEsquema } from './VIEJO/pos-bridge/esquema.ts'
import { rangoLectura } from './VIEJO/pos-bridge/ventana.ts'
import { PosEstricto } from './posMock.ts'
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

// ── PoS simulado: el ESTRICTO de posMock.caso.ts (falla ante parámetros o lecturas inválidas; Grok 111) ───────────

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
  /** Lo que el Edge le devolvió al agente en cada 200 (el cursor que el agente tiene que adoptar). */
  respuestas: any[] = []
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
    this.respuestas.push({ cursor: res.cursor ?? null, corte_retenido_por_r: res.corte_retenido_por_r ?? null })
    return new Response(JSON.stringify({
      ok: true, local: LOCAL, tickets_recibidos: sobre.valor.tickets.length, tickets_guardados: res.tickets ?? 0,
      lineas_guardadas: res.lineas ?? 0, open_guardadas: res.open_guardadas ?? 0, open_borradas: res.open_borradas ?? 0,
      invalid: lote.invalid, recalculados: lote.recalculados, problemas: lote.problemas,
      cursor: res.cursor ?? null, cursor_escrito: lote.cursor !== null,
    }), { status: 200 })
  }
}

// ── El escenario ─────────────────────────────────────────────────────────────────────────────────────────────
interface Corrida { pos: PosEstricto; edge: Edge; cursores: (string | null)[]; resumenes: any[]; respuestaDe: (number | null)[]; antesReplay: any }

const T0 = Date.parse('2026-11-09T04:00:00Z')   // 08-nov 22:00 CR
async function escenario(f082: string): Promise<Corrida> {
  let ahora = new Date(T0)
  const pos = new PosEstricto(() => rangoLectura(ahora, VENTANA))
  const edge = new Edge(f082)
  const puertos: PuertosCiclo = {
    // Grok 111: el objeto del ciclo pasa TAL CUAL (como agente.ts de 4d3513a)
    leerCerradas: (p: any) => leerCerradas(pos.qy(), ESQUEMA, p),
    leerProvisionales: (r: any) => leerProvisionales(pos.qy(), ESQUEMA, r),
    leerAbiertas: (r: any) => leerAbiertas(pos.qy(), ESQUEMA, r),
    enviar: (payload: any) => pushIngest({ ingestUrl: 'https://edge.invalid/ingest-ndf', ingestSecret: 'x'.repeat(32) },
      payload, edge.fetch as any),
  } as PuertosCiclo
  let estado: EstadoAgente = { ...ESTADO_INICIAL }
  const cursores: (string | null)[] = []
  const resumenes: any[] = []
  const respuestaDe: (number | null)[] = []   // índice en edge.respuestas del 200 de cada ciclo (null = no hubo)
  const ciclo = async () => {
    const antes = edge.respuestas.length
    const r = await ejecutarCiclo(puertos, LOCAL, VENTANA, estado, ahora)
    estado = r.estado
    cursores.push(estado.ultimaFactura)
    resumenes.push(r.resumen)
    respuestaDe.push(edge.respuestas.length > antes ? edge.respuestas.length - 1 : null)
  }
  await ciclo()                                                       // 0 · saludo con NADA guardado (cursor null)
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
  pos.poner('7008', 'R'); pos.poner('7009', 'C')                      // 6 · IGUALDAD: la factura del cursor (7008) se reabre
  await ciclo()
  pos.poner('7008', 'C')
  await ciclo()                                                       // 7 · 7008 vuelve a cerrar: entra otra vez como C
  pos.poner('7010', 'R'); pos.poner('6990', 'R')
  pos.poner('6980', 'R', '2026-11-07 12:00:00')                       // 8 · R de otra caja por debajo del cursor (una vieja)
  await ciclo()
  edge.fallas.set(edge.llamadas + 1, 'red'); edge.fallas.set(edge.llamadas + 2, 'red')
  await ciclo()                                                       // 9 · red caída en los dos intentos: no avanza
  pos.poner('6990', 'C')
  await ciclo()                                                       // 10 · cierra 6990 (6980 sigue en curso)
  pos.poner('7010', 'X'); pos.poner('6980', 'C')
  ahora = new Date(T0 + 30 * 3_600_000)                               // 11 · 30 h después: 6980 (11-07 12:00) quedó FUERA de
  pos.poner('7011', 'C', '2026-11-09 08:00:00')                       //      la ventana de 36 h: ni retiene el corte ni se relee
  await ciclo()
  const antesReplay = edge.ultimoEstado
  // 12 · REPLAY desde el PoS (el backfill del agente: lote SIN cursor ni mesas) del día de 6980: entra como C, una vez.
  const rangoViejo = { desde: '2026-11-07 00:00:00', hasta: '2026-11-07 23:59:59' }
  const pv = new PosEstricto(() => rangoViejo); for (const [n, f] of pos.facturas) pv.ponerFila(f.fila, f.detalle)
  const viejas = await leerCerradas(pv.qy(), ESQUEMA, { ...rangoViejo, ultima: null })
  await pushIngest({ ingestUrl: 'https://edge.invalid/ingest-ndf', ingestSecret: 'x'.repeat(32) },
    { local: LOCAL, tickets: viejas.tickets } as any, edge.fetch as any)
  return { pos, edge, cursores, resumenes, respuestaDe, antesReplay }
}

const RAIZ = new URL('.', import.meta.url).pathname
const F082_NUEVA = readFileSync(`${RAIZ}082_nueva.sql`, 'utf8')
const F082_VIEJA = readFileSync(`${RAIZ}082_vieja.sql`, 'utf8')

describe('ID 83 · agente de prod (4d3513a) → Edge nuevo → RPC real en staging (transacciones descartadas)', () => {
  it('CONTROL con la 082 de e4678b3 («solo avanza»): reproduce el bug — facturas cerradas en el PoS quedan en R', async () => {
    const c = await escenario(F082_VIEJA)
    const t = c.antesReplay.tickets
    expect(t['7008']?.estado).toBe('R')         // igualdad: reabierta en el cursor, cerró y no se volvió a leer
    expect(t['6990']?.estado).toBe('R')         // R de otra caja por debajo del cursor: cerró y no se volvió a leer
  }, 300_000)

  it('NUEVA 082 («corte seguro»): el agente recibe el corte, la R cierra y entra exactamente una vez', async () => {
    const c = await escenario(F082_NUEVA)
    expect(c.cursores).toEqual([
      null,    // 0 saludo sin nada guardado: el Edge devuelve cursor null y el agente queda en null (lee todo)
      '7002',  // 1 corte seguro: R 7003 abierta debajo de 7005
      '7002',  // 2 sin cambios (sin last_factura en el lote)
      '7006',  // 3 7003 cerró; R 7007 abierta debajo de 7008
      '7008',  // 4 la RPC falló en el 1.er intento, el reintento entró
      '7008',  // 5 reinicio: el saludo trae el corte guardado
      '7007',  // 6 igualdad: la R es la factura del cursor (7008) → corte 7007
      '7009',  // 7 7008 volvió a cerrar y se releyó
      '6979',  // 8 R 6980 y 6990 debajo del cursor: corte = menor R − 1
      '6979',  // 9 red caída: el agente no avanza
      '6979',  // 10 6990 cerró; 6980 sigue en curso: el corte la espera
      '7011',  // 11 6980 quedó fuera de la ventana: ya no retiene; el corte no se traba
    ])
    // el agente adoptó EXACTAMENTE lo que le devolvió el servidor (cada ciclo con 200)
    c.respuestaDe.forEach((i, k) => {
      if (i !== null) expect(c.edge.respuestas[i].cursor?.last_factura ?? null, `ciclo ${k}`).toBe(c.cursores[k])
    })
    expect(c.edge.respuestas[c.respuestaDe[0]!].cursor).toBeNull()
    expect(c.resumenes[4].fase).toBe('sincronizado')
    expect(c.resumenes[9].fase).toBe('error_envio')
    // antes del replay: 6980 quedó en R (cerró FUERA de la ventana): lo marca el control 7.2 del paquete
    const a = c.antesReplay
    expect(a.tickets['6980']).toEqual({ estado: 'R', lineas: 2 })
    // después del replay: exactamente una vez, con su estado final y sus líneas, todas
    const e = c.edge.ultimoEstado
    expect(e.filas).toBe(c.pos.facturas.size)
    for (const [n] of c.pos.facturas) expect(e.tickets[n], n).toEqual({ estado: c.pos.estado(n), lineas: 2 })
    expect(e.cursor.last_factura).toBe('7011')              // el replay (sin cursor) no movió el corte
    expect(e.cursor.max_factura_vista).toBe('7011')
    expect(e.cursor.last_error).toBeNull()
  }, 300_000)

  it('lote en el límite del Edge: MAX_TICKETS pasa, MAX_TICKETS + 1 se rechaza entero (400) y el agente no avanza', () => {
    const t = (n: number) => ({ numero_factura: String(n), fecha_registra: '2026-11-08T19:00:00-06:00', estado: 'C', items: [] })
    expect(validarPayload({ local: LOCAL, tickets: Array.from({ length: MAX_TICKETS }, (_, i) => t(i + 1)) }).ok).toBe(true)
    expect(validarPayload({ local: LOCAL, tickets: Array.from({ length: MAX_TICKETS + 1 }, (_, i) => t(i + 1)) }).ok).toBe(false)
  })
})
