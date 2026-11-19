// ─────────────────────────────────────────────────────────────────────────────────────────────
//  Plantilla del comprobante de pago al proveedor, con el estándar de reportes Satori adaptado a correo
//  (correo-estandar.ts). Lo lee alguien de afuera (el proveedor): va en «usted».
//  (19-nov) UN correo por pago con la lista de facturas: fecha de la factura, referencia, lo facturado, el crédito a
//  favor aplicado (si hubo) y lo pagado; el total pagado; la fecha REAL del pago (CR) y el método.
//  El correo del proveedor NO va en el cuerpo (solo es el destinatario).
// ─────────────────────────────────────────────────────────────────────────────────────────────

import { cabecera, celdaNombre, cifras, crc, documento, esc, fechaCorta, fechaLarga, pie, seccion, tabla, titulo, usd, gris, MAX_FILAS, type Cifra, type Columna } from './correo-estandar.ts'
import type { FilaFactura, Pago } from './pago.ts'

export { diaCR } from './pago.ts'

export interface ProveedorCorreo { name: string }

const EPS = 0.005

/** «₡X», «$Y» o «₡X · $Y» (₡ siempre que haya ₡ o no haya $). */
function monto(crcV: number, usdV: number): string {
  const partes: string[] = []
  if (Math.abs(crcV) > EPS || usdV <= EPS) partes.push(crc(crcV))
  if (usdV > EPS) partes.push(usd(usdV))
  return partes.join(' · ')
}

/** Fecha del pago para el texto: «19 de noviembre de 2026» o «del 18 de noviembre de 2026 al 19 de noviembre de 2026». */
export function fechaPagoLarga(p: Pago): string {
  const { desde, hasta } = p.fechaPago
  return desde === hasta ? fechaLarga(desde) : `del ${fechaLarga(desde)} al ${fechaLarga(hasta)}`
}
/** Fecha del pago corta: «19 nov 26» o «18 nov 26 al 19 nov 26». */
export function fechaPagoCorta(p: Pago): string {
  const { desde, hasta } = p.fechaPago
  return desde === hasta ? fechaCorta(desde) : `${fechaCorta(desde)} al ${fechaCorta(hasta)}`
}

export function asunto(p: Pago): string {
  return `Comprobante de pago — Satori (${fechaPagoLarga(p)})`
}

function bajada(p: Pago): string {
  const n = p.filas.length
  const cuando = p.fechaPago.desde === p.fechaPago.hasta ? `el ${fechaPagoLarga(p)}` : fechaPagoLarga(p)
  const facturas = n === 1 ? 'una factura' : `${n} facturas`
  if (p.totalPagadoCRC <= EPS && p.totalUSD <= EPS && p.totalCreditoCRC > EPS) {
    return `Le confirmamos que ${n === 1 ? 'su factura quedó saldada' : `sus ${n} facturas quedaron saldadas`} con su crédito a favor ${cuando}.`
  }
  const credito = p.totalCreditoCRC > EPS ? `, después de aplicar ${crc(p.totalCreditoCRC)} de su crédito a favor` : ''
  return `Le confirmamos el pago de ${facturas} por ${monto(p.totalPagadoCRC, p.totalUSD).replace(' · ', ' y ')} ${cuando}${credito}.`
}

function filasFacturas(filas: FilaFactura[], conCredito: boolean): string[][] {
  return filas.map((f) => {
    const ref = f.referencia ? esc(f.referencia) : gris('—')
    const pagado = `<span style="font-weight:600">${esc(monto(f.pagadoCRC, f.usd))}</span>`
    if (!conCredito) return [esc(fechaCorta(f.fecha)), ref, pagado]
    return [
      esc(fechaCorta(f.fecha)),
      ref,
      esc(monto(f.facturadoCRC, f.usd)),
      f.creditoCRC > EPS ? esc('−' + crc(f.creditoCRC)) : gris('—'),
      pagado,
    ]
  })
}

export function buildHtml(p: Pago, s: ProveedorCorreo): string {
  const reporte = 'Comprobante de pago'
  const corta = fechaPagoCorta(p)
  const conCredito = p.totalCreditoCRC > EPS
  const conUsd = p.totalUSD > EPS

  const lista: Cifra[] = [{ valor: crc(p.totalPagadoCRC), etiqueta: 'total pagado' }]
  if (conUsd) lista.push({ valor: usd(p.totalUSD), etiqueta: 'total pagado en dólares' })
  if (conCredito) lista.push({ valor: crc(p.totalCreditoCRC), etiqueta: 'crédito a favor aplicado' })
  lista.push({ valor: esc(corta), etiqueta: 'fecha del pago' })

  let html = cabecera(reporte, corta) + titulo(s.name, esc(bajada(p))) + cifras(lista)

  const cols: Columna[] = conCredito
    ? [
        { titulo: 'fecha', ancho: 14 }, { titulo: 'referencia', ancho: 32 },
        { titulo: 'facturado', ancho: 18, derecha: true }, { titulo: 'crédito', ancho: 16, derecha: true },
        { titulo: 'pagado', ancho: 20, derecha: true },
      ]
    : [{ titulo: 'fecha', ancho: 16 }, { titulo: 'referencia', ancho: 58 }, { titulo: 'pagado', ancho: 26, derecha: true }]
  const filas = filasFacturas(p.filas, conCredito)
  html += seccion(
    p.filas.length === 1 ? 'Factura pagada' : 'Facturas pagadas',
    conCredito ? 'Pagado = facturado − crédito a favor aplicado.' : undefined,
  )
  // El estándar pide máximo 10 filas por tabla: con más facturas, varias tablas seguidas (ninguna queda afuera).
  for (let i = 0; i < filas.length; i += MAX_FILAS) html += tabla(cols, filas.slice(i, i + MAX_FILAS))

  html += seccion('Detalle del pago')
  html += tabla(
    [{ titulo: 'concepto', ancho: 32 }, { titulo: 'dato', ancho: 68 }],
    [
      [celdaNombre('Proveedor'), esc(s.name)],
      [celdaNombre('Fecha del pago'), esc(fechaPagoLarga(p))],
      [celdaNombre('Método'), esc(p.metodo)],
      [celdaNombre('Facturas'), esc(String(p.filas.length))],
      ...(conCredito ? [[celdaNombre('Total facturado'), esc(monto(p.totalFacturadoCRC, p.totalUSD))]] : []),
      [celdaNombre('Total pagado'), `<span style="font-weight:600">${esc(monto(p.totalPagadoCRC, p.totalUSD))}</span>`],
    ],
  )
  html += pie('comprobante de pago', corta, 'Aviso automático de Satori. Por favor, no responda a este correo.')
  return documento(`Satori, comprobante de pago, ${corta}`, html)
}
