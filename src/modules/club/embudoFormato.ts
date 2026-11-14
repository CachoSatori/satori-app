/**
 * Club → Embudo del anfitrión (mig 162): formatos puros (números, %, pasos y CSV). Sin React, para probarlos solos.
 */
import type { AnfitrionEmbudo, Embudo, GrupoEmbudo } from '../../shared/api/club'
import { TIPO_MIEMBRO_LABEL } from './estilos'

// ESTANDAR-reportes §7: punto de miles, coma decimal, ₡ pegado, % con espacio.
const num = (n: number, dec = 0) => n.toLocaleString('de-DE', { minimumFractionDigits: dec, maximumFractionDigits: dec })
export const numTxt = (n: number | null | undefined) => (n == null ? '—' : num(Math.round(Number(n))))
export const crcTxt = (n: number | null | undefined) => (n == null ? '—' : `₡${num(Math.round(Number(n)))}`)
/** 66.7 → «66,7 %»; null (sin base para el %) → «—». */
export const pctTxt = (p: number | null | undefined) => (p == null ? '—' : `${num(Number(p), 1)} %`)

/** % entre dos pasos, con un decimal; null si el paso anterior es 0 (no hay base). */
export const pct = (de: number, sobre: number): number | null => (sobre > 0 ? Math.round((1000 * de) / sobre) / 10 : null)

export interface Paso { clave: string; titulo: string; valor: string; pct: number | null; nota?: string }

/**
 * Los pasos del embudo de un anfitrión o de un grupo, en orden. El % de cada paso es contra el anterior de la misma
 * unidad (cupones): uso = usados ÷ generados; reseña = clics ÷ usados; con factura = con factura ÷ usados. Personas,
 * venta y tiquete son de otra unidad: van sin %.
 */
export function pasos(p: GrupoEmbudo | AnfitrionEmbudo, resena: boolean): Paso[] {
  const tiquete = 'tiquete_promedio_crc' in p ? p.tiquete_promedio_crc : (p.mesas > 0 ? p.venta_respaldada_crc / p.mesas : null)
  const out: Paso[] = [
    { clave: 'generados', titulo: 'Cupones generados', valor: numTxt(p.generados), pct: null },
    { clave: 'usados', titulo: 'Usados', valor: numTxt(p.usados), pct: pct(p.usados, p.generados) },
  ]
  if (resena) out.push({ clave: 'resena', titulo: 'Clic en reseña', valor: numTxt(p.clics_resena ?? 0), pct: pct(p.clics_resena ?? 0, p.usados) })
  out.push(
    { clave: 'con_factura', titulo: 'Con factura', valor: numTxt(p.con_factura), pct: pct(p.con_factura, p.usados) },
    { clave: 'personas', titulo: 'Personas', valor: numTxt(p.personas), pct: null,
      nota: p.usados > 0 ? `${num(Math.round((10 * p.personas) / p.usados) / 10, 1)} por cupón` : undefined },
    { clave: 'venta', titulo: 'Venta respaldada', valor: crcTxt(p.venta_respaldada_crc), pct: null },
    { clave: 'tiquete', titulo: 'Tiquete promedio', valor: crcTxt(tiquete), pct: null },
  )
  return out
}

export const tipoTxt = (t: string) => TIPO_MIEMBRO_LABEL[t] ?? t

/** Texto de una pantalla sin datos (cero cupones), para que nadie lo lea como un error. */
export function resumenVacio(e: Embudo): string | null {
  if (e.totales.generados > 0) return null
  const sin = e.totales.sin_cupones
  return sin > 0
    ? `Ningún anfitrión generó cupones en este mes (${numTxt(sin)} anfitriones activos sin cupones). El embudo arranca cuando un turista pide su cupón desde el QR de un anfitrión.`
    : 'Todavía no hay anfitriones con cupones en este local. El embudo arranca cuando un turista pide su cupón desde el QR de un anfitrión.'
}

// CLUB-AUD-34: una celda de texto que empieza con = + - @ (o tab/CR) se abriría como fórmula: se le antepone un apóstrofo.
const q = (v: unknown) => {
  let t = String(v ?? '')
  if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(t)) t = `'${t}`
  return `"${t.replace(/"/g, '""')}"`
}

/** CSV del embudo (lo entrega la base con rastro: getEmbudoAnfitrion(…, true)). Sin contactos. */
export function embudoCsv(e: Embudo): string {
  const L = ['grupo;anfitrion;tipo;local;estado;generados;usados;pct_uso;clic_resena;pct_resena;con_factura;pct_con_factura;' +
    'personas;facturas;mesas;venta_respaldada_crc;venta_neta_crc;tiquete_promedio_crc;vigentes;vencidos;anulados']
  for (const a of e.anfitriones) {
    L.push([a.grupo, a.nombre, tipoTxt(a.tipo), a.local, a.estado, a.generados, a.usados, a.pct_uso ?? '',
      e.resena_disponible ? (a.clics_resena ?? 0) : '', e.resena_disponible ? (a.pct_resena ?? '') : '',
      a.con_factura, a.pct_con_factura ?? '', a.personas, a.facturas, a.mesas, a.venta_respaldada_crc, a.venta_neta_crc,
      a.tiquete_promedio_crc ?? '', a.vigentes, a.vencidos, a.anulados].map(q).join(';'))
  }
  const t = e.totales
  L.push(['total (cada factura una vez)', '', '', e.local, '', t.generados, t.usados, pct(t.usados, t.generados) ?? '',
    e.resena_disponible ? (t.clics_resena ?? 0) : '', e.resena_disponible ? (pct(t.clics_resena ?? 0, t.usados) ?? '') : '',
    t.con_factura, pct(t.con_factura, t.usados) ?? '', t.personas, t.facturas, t.mesas, t.venta_respaldada_crc,
    t.venta_neta_crc, t.mesas > 0 ? Math.round(t.venta_respaldada_crc / t.mesas) : '', t.vigentes, t.vencidos, t.anulados].map(q).join(';'))
  return '\ufeff' + L.join('\r\n')
}
