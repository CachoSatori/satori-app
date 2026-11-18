// ── Ventas v2 · lo que devuelven `pos_ventas_tiempos` y `pos_ventas_internas` (mig 193) — PURO ──────────
//
// · `pos_ventas_internas` → facturas de MESAS INTERNAS (Ajustes → «Mesas internas»; 51, 52 y 53 en santa-teresa):
//   [id, dia, hora, canal, neta_cts, pax]. La app las marca `interna` y las saca de los indicadores de venta real.
//   Siguen en Contabilidad y en el correo del contador (decisión del dueño 18-nov: tienen IVA, son venta fiscal).
// · `pos_ventas_tiempos` → `horas` (día × hora CR, TODOS los canales, sin internas, céntimos), `sentados` (tiempo
//   sentado por tamaño de mesa) y `descartes`.

/** Una factura de mesa interna. */
export interface InternaRpc {
  id:      string
  dia:     string
  hora:    number
  canal:   string | null
  netaCts: number
  pax:     number
}

export interface HoraRpc {
  dia:      string
  hora:     number
  netaCts:  number
  facturas: number
  pax:      number
}

export type TamanoMesa = '2' | '4' | '6' | '7+'

export const TAMANOS: readonly { id: TamanoMesa; label: string }[] = [
  { id: '2',  label: '1 a 2 personas' },
  { id: '4',  label: '3 a 4 personas' },
  { id: '6',  label: '5 a 6 personas' },
  { id: '7+', label: '7 o más' },
]

export interface SentadoRpc {
  tamano:   TamanoMesa
  n:        number
  /** Minutos. */
  mediana:  number
  promedio: number
}

export interface DescartesRpc {
  sin_pedido: number
  internas:   number
  sin_pax:    number
  menos_de_5: number
  mas_de_240: number
}

export interface TiemposRpc {
  horas:     HoraRpc[]
  sentados:  SentadoRpc[]
  descartes: DescartesRpc
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v ?? 0) || 0)

export function parsearInternas(json: unknown): InternaRpc[] {
  if (!Array.isArray(json)) throw new Error('pos_ventas_internas: respuesta con forma inesperada')
  return (json as unknown[][]).map(([id, dia, hora, canal, neta, pax]) => ({
    id: String(id), dia: String(dia), hora: num(hora), canal: canal == null ? null : String(canal),
    netaCts: num(neta), pax: num(pax),
  }))
}

export function parsearTiempos(json: unknown): TiemposRpc {
  const o = json as { horas?: unknown[][]; sentados?: unknown[][]; descartes?: Record<string, unknown> } | null
  if (!o || !Array.isArray(o.horas) || !Array.isArray(o.sentados) || !o.descartes) {
    throw new Error('pos_ventas_tiempos: respuesta con forma inesperada')
  }
  const d = o.descartes
  return {
    horas: o.horas.map(([dia, hora, neta, facturas, pax]) => ({
      dia: String(dia), hora: num(hora), netaCts: num(neta), facturas: num(facturas), pax: num(pax),
    })),
    sentados: o.sentados.map(([tamano, n, mediana, promedio]) => ({
      tamano: String(tamano) as TamanoMesa, n: num(n), mediana: num(mediana), promedio: num(promedio),
    })),
    descartes: {
      sin_pedido: num(d.sin_pedido), internas: num(d.internas), sin_pax: num(d.sin_pax),
      menos_de_5: num(d.menos_de_5), mas_de_240: num(d.mas_de_240),
    },
  }
}

/** ¿El error es «la función no existe» (base sin la 193)? Solo ahí se sigue sin ella. */
export function esFuncionAusente(e: { code?: string; message?: string } | null | undefined, nombre: string): boolean {
  if (!e) return false
  if (e.code === 'PGRST202' || e.code === '42883') return true
  const m = e.message ?? ''
  return m.includes(nombre) && /(not find|does not exist|no existe)/i.test(m)
}

/** Marca `interna` en las facturas cuyo id está en la lista. Copia solo las que cambian. */
export function marcarInternas<T extends { id: string }>(facturas: readonly T[], internas: readonly InternaRpc[]): (T & { interna?: boolean })[] {
  if (internas.length === 0) return [...facturas]
  const ids = new Set(internas.map(i => i.id))
  return facturas.map(f => (ids.has(f.id) ? { ...f, interna: true } : f))
}

/** Céntimos de mesas internas por día CR, de un rango. */
export interface InternasDia { netaCts: number; facturas: number; pax: number }

export function internasPorDia(internas: readonly InternaRpc[], desde: string, hasta: string): Map<string, InternasDia> {
  const out = new Map<string, InternasDia>()
  const vistos = new Set<string>()
  for (const i of internas) {
    if (i.dia < desde || i.dia > hasta || vistos.has(i.id)) continue
    vistos.add(i.id)
    const e = out.get(i.dia) ?? { netaCts: 0, facturas: 0, pax: 0 }
    e.netaCts += i.netaCts
    e.facturas += 1
    e.pax += i.pax
    out.set(i.dia, e)
  }
  return out
}
