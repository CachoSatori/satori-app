// Grok 111 (09-nov) · PoS simulado ESTRICTO para A7 y el caso 83. Se resuelve en la carpeta temporal de correr.sh.
//
// Responde las mismas tres lecturas que hace el agente de prod (4d3513a) — cerradas, provisionales y mesas abiertas —
// y FALLA (lanza) ante cualquier cosa que el SQL Server real no aceptaría o que delataría un cableado mal hecho:
//   · parámetros que no son un objeto plano, o con claves de más;
//   · `desde`/`hasta` que no son texto `AAAA-MM-DD HH:MM:SS` o que no son EXACTAMENTE el rango esperado del ciclo
//     (rangoLectura(ahora, 36 h));
//   · `@ultima` en el SQL sin `ultima` en los parámetros (o al revés), o un `ultima` que no es texto de dígitos ni null
//     (por ejemplo, un objeto: el error del A7 viejo, que pasaba el objeto `p` entero como si fuera el cursor);
//   · un SQL que no es ninguna de las tres lecturas conocidas.
// Filtra como el PoS: estado, `NumeroFactura > @ultima` (numérico) y la ventana por fecha de registro.
// @ts-nocheck — se resuelve en la carpeta temporal
import type { FilaDetalle, FilaFactura, Queryable } from './VIEJO/pos-bridge/consulta.ts'

export type Estado = 'C' | 'R' | 'X'
export interface Lectura { tipo: 'cerradas' | 'provisionales' | 'abiertas'; desde: string; hasta: string; ultima?: string | null }

const RE_NAIVE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/

export const fac = (n: string, estado: Estado, fecha = '2026-11-08 19:00:00'): FilaFactura => ({
  numero_factura: n, fecha_hora: fecha, estado, login_cajero: '222', tipo_factura: null,
  area_factura: null, usuario_registra: '026', usuario_max: '026', personas: 0, pedidos: 1, tipo_pedido: 'M',
  area_pedido: 'SALON 1', salonero_nombre: 'SALONERO PRUEBA', mesa: '12', numero_pedido: `P${n}`,
  fecha_cierra: estado === 'C' ? fecha : null, efectivo: estado === 'C' ? 6000 : 0, tarjeta: 0,
  monto_electronico: 0, deposito: 0, cheque: 0, cuenta_cobrar: 0, dolares_efectivo: 0, dolares_tarjeta: 0, vuelto: 0,
})
// Dos líneas por factura (distintas), para ver duplicados de líneas.
export const lineasDe = (n: string): FilaDetalle[] => [
  { numero_factura: n, usuario_registra: '026', codigo: '100', nombre: 'ROLL PRUEBA', cantidad: 1, monto: 4000,
    imp_servicio: 400, imp_venta: 0, familia: 2, familia_nombre: 'SUSHI', es_extra: 0, compuesto: null },
  { numero_factura: n, usuario_registra: '026', codigo: '300', nombre: 'BEBIDA PRUEBA', cantidad: 1, monto: 2000,
    imp_servicio: 200, imp_venta: 0, familia: 10, familia_nombre: 'BEBIDAS', es_extra: 0, compuesto: null },
]

export class PosEstricto {
  facturas = new Map<string, { fila: FilaFactura; detalle: FilaDetalle[] }>()
  lecturas: Lectura[] = []
  /** `rango()` = el rango que TIENE que pedir el agente en este ciclo (lo fija la prueba con el mismo reloj). */
  constructor(private rango: () => { desde: string; hasta: string }, private abiertas: unknown[] = []) {}
  /** Una factura simple (2 líneas). Cambiarle el estado conserva la fecha si no se pasa otra. */
  poner(n: string, e: Estado, fecha?: string) {
    const f = fecha ?? this.facturas.get(n)?.fila.fecha_hora as string ?? '2026-11-08 19:00:00'
    this.facturas.set(n, { fila: fac(n, e, f), detalle: lineasDe(n) })
  }
  /** Una factura con la fila y el detalle exactos (las del A7 en seco). */
  ponerFila(fila: FilaFactura, detalle: FilaDetalle[]) { this.facturas.set(String(fila.numero_factura), { fila, detalle }) }
  estado(n: string): Estado | undefined { return this.facturas.get(n)?.fila.estado as Estado | undefined }

  private validar(sql: string, p: unknown): Lectura {
    if (p === null || typeof p !== 'object' || Array.isArray(p) || Object.getPrototypeOf(p) !== Object.prototype) {
      throw new Error(`PoS simulado: los parámetros no son un objeto plano (${typeof p})`)
    }
    const q = p as Record<string, unknown>
    const usaUltima = sql.includes('@ultima')
    const permitidas = usaUltima ? ['desde', 'hasta', 'ultima'] : ['desde', 'hasta']
    for (const k of Object.keys(q)) if (!permitidas.includes(k)) throw new Error(`PoS simulado: parámetro de más «${k}»`)
    for (const k of ['desde', 'hasta']) {
      if (typeof q[k] !== 'string' || !RE_NAIVE.test(q[k] as string)) throw new Error(`PoS simulado: ${k} no es AAAA-MM-DD HH:MM:SS`)
    }
    const r = this.rango()
    if (q.desde !== r.desde || q.hasta !== r.hasta) {
      throw new Error(`PoS simulado: rango distinto del esperado (${q.desde}→${q.hasta} en vez de ${r.desde}→${r.hasta})`)
    }
    if (usaUltima) {
      if (!('ultima' in q)) throw new Error('PoS simulado: el SQL usa @ultima y no vino en los parámetros')
      const u = q.ultima
      if (!(u === null || (typeof u === 'string' && /^\d+$/.test(u)))) {
        throw new Error(`PoS simulado: ultima no es texto de dígitos ni null (${typeof u}: ${JSON.stringify(u)?.slice(0, 60)})`)
      }
    }
    if (/\[NumeroFactura\] IS NULL/.test(sql)) return { tipo: 'abiertas', desde: r.desde, hasta: r.hasta }
    if (/\[Estado\] = 'C'/.test(sql)) {
      if (!usaUltima) throw new Error('PoS simulado: lectura de cerradas sin @ultima')
      return { tipo: 'cerradas', desde: r.desde, hasta: r.hasta, ultima: q.ultima as string | null }
    }
    if (/\[Estado\] IN \('R', 'X'\)/.test(sql)) {
      if (usaUltima) throw new Error('PoS simulado: provisionales con @ultima')
      return { tipo: 'provisionales', desde: r.desde, hasta: r.hasta }
    }
    throw new Error('PoS simulado: SQL desconocido')
  }

  qy(): Queryable {
    return {
      query: async <T,>(sql: string, p?: Record<string, unknown>) => {
        const l = this.validar(sql, p)
        const detalle = sql.includes('FAC_FacturasDet')
        if (!detalle) this.lecturas.push(l)
        if (l.tipo === 'abiertas') return { rows: (detalle ? [] : this.abiertas) as T[] }
        const estados: Estado[] = l.tipo === 'cerradas' ? ['C'] : ['R', 'X']
        const fs = [...this.facturas]
          .filter(([n, f]) => estados.includes(f.fila.estado as Estado) && (f.fila.fecha_hora as string) >= l.desde
                              && (f.fila.fecha_hora as string) <= l.hasta && (l.ultima == null || BigInt(n) > BigInt(l.ultima)))
          .sort(([a], [b]) => (BigInt(a) < BigInt(b) ? -1 : 1))
        if (detalle) return { rows: fs.flatMap(([, f]) => f.detalle) as T[] }
        return { rows: fs.map(([, f]) => f.fila) as T[] }
      },
    }
  }
}
