/**
 * Club → Cohortes y Ranking (mig 161): formato puro (sin I/O; «hoy» entra como parámetro, en hora CR) de lo que
 * devuelven `club_cohortes_socios` y `club_ranking_socios`. La base calcula todo; acá: celdas («aún no»), períodos,
 * orden y CSV (ESTANDAR-reportes §7: punto de miles, ₡ pegado, % con espacio). Sin teléfonos ni correos: la base no
 * los devuelve.
 */
import type { SocioRanking, Ranking } from '../../shared/api/club'

const num = (n: number | null | undefined, dec = 0) =>
  Number(n ?? 0).toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: dec })
export const crcTxt = (n: number | null | undefined) => (n == null ? '—' : `₡${num(Math.round(Number(n)))}`)
export const numTxt = (n: number | null | undefined, dec = 0) => (n == null ? '—' : num(n, dec))

/** Celda de una cohorte: «aún no» si no puede medirse (null), nunca 0; si no, «n (x %)» sobre los socios. */
export function celdaCohorte(n: number | null, socios: number): string {
  if (n == null) return 'aún no'
  if (socios <= 0) return '0'
  return `${num(n)} (${num((100 * n) / socios, 0)} %)`
}

/** «2001-03» → «mar 2001». */
export function mesTxt(mes: string): string {
  const [a, m] = mes.split('-').map(Number)
  const nombres = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  return `${nombres[(m ?? 1) - 1] ?? mes} ${a}`
}

// ── Períodos del ranking (días CR, desde y hasta incluidos) ──────────────────────────────────────
export type Preset = 'mes' | '90' | 'anio'
const masDias = (dia: string, n: number) => {
  const d = new Date(`${dia}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
/** `hoy` es todayCR() (AAAA-MM-DD). «Últimos 90 días» = hoy y los 89 anteriores. */
export function periodo(p: Preset, hoy: string): { desde: string; hasta: string } {
  if (p === 'mes') return { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy }
  if (p === 'anio') return { desde: `${hoy.slice(0, 4)}-01-01`, hasta: hoy }
  return { desde: masDias(hoy, -89), hasta: hoy }
}
/** El mismo límite que la base (400 días): mejor avisar antes que recibir el error. */
export function periodoValido(desde: string, hasta: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) return 'Elegí desde y hasta.'
  if (hasta < desde) return '«Hasta» es antes de «desde».'
  const dias = (Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000
  if (dias > 400) return 'El período va hasta 400 días.'
  return null
}

// ── Orden del ranking ────────────────────────────────────────────────────────────────────────────
export type Columna = 'nombre' | 'visitas' | 'venta_respaldada_crc' | 'tiquete_promedio_crc' | 'invitados'
  | 'descuento_estimado_crc' | 'ultima_visita'
/** Ordena una copia. Los vacíos (sin tiquete, sin visita) van siempre al final; empate → nombre. */
export function ordenar(filas: SocioRanking[], col: Columna, asc: boolean): SocioRanking[] {
  const dir = asc ? 1 : -1
  return [...filas].sort((a, b) => {
    const x = a[col], y = b[col]
    if (x == null && y != null) return 1
    if (y == null && x != null) return -1
    if (x != null && y != null && x !== y) {
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'es')
      if (c !== 0) return c * dir
    }
    return a.nombre.localeCompare(b.nombre, 'es')
  })
}

// ── CSV (mismo criterio que la pantalla: sin contactos) ──────────────────────────────────────────
const q = (v: unknown) => {
  let t = String(v ?? '')
  if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(t)) t = `'${t}`   // sin fórmulas al abrirlo en una planilla
  return `"${t.replace(/"/g, '""')}"`
}
export function rankingCsv(r: Ranking, filas: SocioRanking[] = r.socios): string {
  const L = ['socio;local_alta;estado;visitas;mesas;facturas;venta_respaldada_crc;tiquete_promedio_crc;personas;invitados;descuento_estimado_crc;ultima_visita']
  for (const s of filas) {
    L.push([s.nombre, s.local_alta, s.estado, s.visitas, s.mesas, s.facturas, s.venta_respaldada_crc,
            s.tiquete_promedio_crc ?? '', s.personas, s.invitados, s.descuento_estimado_crc, s.ultima_visita ?? ''].map(q).join(';'))
  }
  const t = r.totales
  L.push(['TOTAL (cada factura una vez)', '', '', t.visitas, '', t.facturas, t.venta_respaldada_crc, '', '', t.invitados,
          t.descuento_estimado_crc, ''].map(q).join(';'))
  L.push(['período', r.desde, r.hasta, '', '', '', '', '', '', '', '', ''].map(q).join(';'))
  return '\uFEFF' + L.join('\r\n')   // como reporteCsv: BOM (acentos en Excel) y CRLF
}
