// ─────────────────────────────────────────────────────────────────────────────────────────────
//  Plantilla del comprobante de pago al proveedor, con el estándar de reportes Satori adaptado a correo
//  (correo-estandar.ts). Lo lee alguien de afuera (el proveedor): va en «usted».
//  SOLO forma y redacción: los mismos datos del correo anterior (proveedor, fecha, monto en colones y en
//  dólares si hay, método y detalle). El correo del proveedor NO va en el cuerpo (solo es el destinatario).
// ─────────────────────────────────────────────────────────────────────────────────────────────

import { cabecera, celdaNombre, cifras, crc, documento, esc, fechaCorta, fechaLarga, pie, seccion, tabla, titulo, usd, gris, type Cifra } from './correo-estandar.ts'

/** Campos que usa el comprobante (tipos estructurales: index.ts pasa las filas tal cual). */
export interface MovimientoCorreo {
  amount_crc: number
  amount_usd: number | null
  method: string | null
  description: string | null
  created_at: string
}
export interface ProveedorCorreo { name: string }

const CR_OFFSET_MS = 6 * 60 * 60 * 1000

/** Fecha del pago en Costa Rica (UTC-6 fijo, sin horario de verano), `YYYY-MM-DD`. */
export function diaCR(iso: string): string {
  const t = Date.parse(iso)
  if (!isFinite(t)) return String(iso ?? '')
  return new Date(t - CR_OFFSET_MS).toISOString().slice(0, 10)
}

export function buildHtml(m: MovimientoCorreo, s: ProveedorCorreo): string {
  const reporte = 'Comprobante de pago'
  const dia = diaCR(m.created_at)
  const corta = fechaCorta(dia)
  const metodo = (m.method ?? '').trim() || 'Transferencia'
  const detalle = (m.description ?? '').trim()
  const conUsd = !!(m.amount_usd && m.amount_usd > 0)
  const montos = conUsd ? `${crc(m.amount_crc)} y ${usd(m.amount_usd as number)}` : crc(m.amount_crc)

  const bajada = esc(`Le confirmamos un pago por ${montos} el ${fechaLarga(dia)}.`)

  const lista: Cifra[] = [{ valor: crc(m.amount_crc), etiqueta: 'monto en colones' }]
  if (conUsd) lista.push({ valor: usd(m.amount_usd as number), etiqueta: 'monto en dólares' })
  lista.push({ valor: esc(corta), etiqueta: 'fecha del pago' })

  let html = cabecera(reporte, corta) + titulo(s.name, bajada) + cifras(lista)
  html += seccion('Detalle del pago')
  html += tabla(
    [{ titulo: 'concepto', ancho: 32 }, { titulo: 'dato', ancho: 68 }],
    [
      [celdaNombre('Proveedor'), esc(s.name)],
      [celdaNombre('Método'), esc(metodo)],
      [celdaNombre('Detalle'), detalle ? esc(detalle) : gris('—')],
    ],
  )
  html += pie('comprobante de pago', corta, 'Aviso automático de Satori. Por favor, no responda a este correo.')
  return documento(`Satori, comprobante de pago, ${corta}`, html)
}
