// ─────────────────────────────────────────────────────────────────────────────────────────
//  El correo al negocio con el detalle por día de la quincena (para reenviarlo al contador) — PURO.
//  Corto: asunto con el período y la venta neta; cuerpo con 4 cifras y la lista de adjuntos.
//  Estándar de reportes (correo-estandar.ts, copia igual a la de monthly-report).
// ─────────────────────────────────────────────────────────────────────────────────────────
import { cabecera, cifras, crc, documento, esc, miles, parrafo, pie, titulo, COLOR } from './correo-estandar.ts'
import { aCsv, aXlsx } from './archivos.ts'
import type { Detalle } from './detalle.ts'

export const REPORTE = 'Ventas por día'

/** «santa-teresa» → «Santa Teresa». */
export function nombreLocal(local: string): string {
  return local.split('-').filter(Boolean).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ')
}

/** `satori_ventas_dia_santa-teresa_2026-11-1` (sin extensión). */
export function nombreArchivo(d: Detalle, local: string): string {
  return `satori_ventas_dia_${local}_${d.quincena.clave}`
}

export function asunto(d: Detalle, local: string): string {
  return `Satori · ${REPORTE} ${d.quincena.etiqueta} · ${nombreLocal(local)} · neta ${crc(d.total.ventaNeta)}`
}

export function cuerpoHtml(d: Detalle, local: string): string {
  const t = d.total
  const periodo = `${d.quincena.etiqueta} · ${nombreLocal(local)}`
  const base = nombreArchivo(d, local)
  const sinVentas = d.filas.length - d.diasConVentas
  return documento(`${REPORTE} · ${periodo}`, [
    cabecera(REPORTE, periodo),
    titulo('Detalle por día para el contador',
      esc(`Quincena del ${d.quincena.etiqueta}: ${d.filas.length} días, ${d.diasConVentas} con ventas. Fuente: el PoS, igual que Ventas → Contabilidad.`)),
    cifras([
      { valor: crc(t.ventaNeta), etiqueta: 'Venta neta' },
      { valor: crc(t.ventaBruta), etiqueta: 'Venta bruta' },
      { valor: crc(t.iva), etiqueta: 'IVA' },
      { valor: crc(t.serv), etiqueta: 'Servicio' },
    ]),
    parrafo(esc(`Salón ${crc(t.salon)} · Delivery ${crc(t.delivery)} · ${miles(t.pax)} PAX · Prom/PAX ${crc(t.promPax)}.`)),
    parrafo(`Adjuntos: <b>${esc(base)}.xlsx</b> (Excel con fila de totales) y <b>${esc(base)}.csv</b>. ` +
      esc(sinVentas > 0 ? `Los días sin ventas (${sinVentas}) van en 0.` : 'Todos los días tuvieron ventas.'), COLOR.gris),
    pie(REPORTE, periodo, 'Correo automático de los días 1 y 16. Para el contador: reenviar este correo.'),
  ].join('\n'))
}

/** Bytes → base64 (Resend recibe los adjuntos así). Por tandas: `String.fromCharCode(...)` tiene tope de argumentos. */
export function base64(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s)
}

export interface Adjunto { filename: string; content: string; bytes: number }
export interface Correo { subject: string; html: string; attachments: Adjunto[] }

export function armarCorreo(d: Detalle, local: string, generadoEn: string): Correo {
  const base = nombreArchivo(d, local)
  const csv = new TextEncoder().encode(aCsv(d))
  const xlsx = aXlsx(d, `Satori · ${REPORTE} · ${nombreLocal(local)}`,
    `Quincena del ${d.quincena.etiqueta} · fuente: PoS (Ventas → Contabilidad) · generado ${generadoEn} (hora CR)`)
  return {
    subject: asunto(d, local),
    html: cuerpoHtml(d, local),
    attachments: [
      { filename: `${base}.xlsx`, content: base64(xlsx), bytes: xlsx.length },
      { filename: `${base}.csv`, content: base64(csv), bytes: csv.length },
    ],
  }
}
