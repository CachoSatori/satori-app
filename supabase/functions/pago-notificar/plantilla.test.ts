// Comprobante de pago al proveedor (19-nov: UN correo por pago, con la lista de facturas). Datos FICTICIOS.
// La vista previa del repo es la «foto»; para regenerarla:
//   ACTUALIZAR_PREVIEWS=1 npx vitest run supabase/functions/pago-notificar/plantilla.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { asunto, buildHtml } from './plantilla.ts'
import { armarPago, type MovimientoPago } from './pago.ts'
import { verificarCorreo } from './correo-estandar.verificar.ts'
import {
  proveedorEjemplo, facturaA, facturaB, facturaUsd, editsEjemplo, aplicacionesEjemplo, ENVIO_ISO, ids,
} from './plantilla.ejemplo.ts'

const aqui = dirname(fileURLToPath(import.meta.url))
const previews = join(aqui, '../../../docs/reportes/previews')
function foto(nombre: string, html: string) {
  const ruta = join(previews, nombre)
  if (process.env.ACTUALIZAR_PREVIEWS === '1') writeFileSync(ruta, html)
  expect(existsSync(ruta), `falta ${nombre}: correr con ACTUALIZAR_PREVIEWS=1`).toBe(true)
  expect(html).toBe(readFileSync(ruta, 'utf8'))
}
const PIE = 'Satori, comprobante de pago, 19 nov 26'

describe('comprobante de pago agrupado', () => {
  const pago = armarPago({ movs: [facturaB, facturaA], aplicaciones: aplicacionesEjemplo, edits: editsEjemplo, ahora: ENVIO_ISO })
  const html = buildHtml(pago, proveedorEjemplo)
  const texto = verificarCorreo(html, { pie: PIE })

  it('un solo correo con TODAS las facturas del pago, en orden de fecha', () => {
    const iA = texto.indexOf('Factura 0001'), iB = texto.indexOf('Factura 0002')
    expect(iA).toBeGreaterThan(-1)
    expect(iB).toBeGreaterThan(iA)
    expect(texto).toContain('3 nov 26')
    expect(texto).toContain('10 nov 26')
    expect(texto).toContain('Le confirmamos el pago de 2 facturas')
    expect(texto).toContain('Facturas pagadas')
  })
  it('fecha del pago = la real (CR), no la de la factura', () => {
    expect(texto).toContain('el 19 de noviembre de 2026')
    expect(asunto(pago)).toBe('Comprobante de pago — Satori (19 de noviembre de 2026)')
    expect(texto).not.toMatch(/fecha del pago[^.]*3 nov 26/)
  })
  it('con crédito: muestra facturado, crédito y PAGADO; el total es lo pagado', () => {
    // A: 120.000 − 20.000 = 100.000 · B: 66.450 · total pagado 166.450 (facturado 186.450)
    expect(texto).toContain('₡120.000')
    expect(texto).toContain('−₡20.000')
    expect(texto).toContain('₡100.000')
    expect(texto).toContain('₡166.450 total pagado')
    expect(texto).toContain('₡186.450')   // total facturado, en el detalle
    expect(texto).toContain('después de aplicar ₡20.000 de su crédito a favor')
    expect(texto).toContain('Pagado = facturado − crédito a favor aplicado.')
  })
  it('lo lee el proveedor: en «usted», sin voseo ni tuteo', () => {
    expect(texto).toContain('Por favor, no responda a este correo.')
    expect(texto).not.toMatch(/\b(respondas|respondé|tu|vos|tenés|podés)\b/i)
  })
  it('sin crédito: sin columna de crédito, pagado = facturado', () => {
    const p = armarPago({ movs: [facturaB], aplicaciones: [], edits: editsEjemplo, ahora: ENVIO_ISO })
    const t = verificarCorreo(buildHtml(p, proveedorEjemplo), { pie: PIE })
    expect(t).toContain('Le confirmamos el pago de una factura por ₡66.450 el 19 de noviembre de 2026.')
    expect(t).toContain('Factura pagada')
    expect(t).not.toContain('crédito')
  })
  it('con dólares', () => {
    const p = armarPago({
      movs: [facturaB, facturaUsd], aplicaciones: [], ahora: ENVIO_ISO,
      edits: [...editsEjemplo, { movement_id: ids.c, edited_at: '2026-11-20T03:40:00Z', changed: { status: { old: 'pendiente', new: 'aprobado' } } }],
    })
    const t = verificarCorreo(buildHtml(p, proveedorEjemplo), { pie: PIE })
    expect(t).toContain('₡66.450 y $120,50')
    expect(t).toContain('Efectivo y Transferencia')
  })
  it('solo en dólares: el total va en dólares, nunca «₡0 total pagado»', () => {
    const p = armarPago({ movs: [facturaUsd], aplicaciones: [], edits: [], ahora: ENVIO_ISO })
    const t = verificarCorreo(buildHtml(p, proveedorEjemplo), { pie: PIE.replace('19 nov 26', '12 nov 26') })
    expect(t).not.toContain('₡0')
    expect(t).toContain('$120,50 total pagado')
    expect(t).not.toContain('total pagado en dólares')
    expect(t).toContain('Le confirmamos el pago de una factura por $120,50 el 12 de noviembre de 2026.')
  })
  it('sin auditoría (cajero / nacido pagado): fecha del pago = registro del movimiento, no el envío', () => {
    const p = armarPago({ movs: [facturaB], aplicaciones: [], edits: [], ahora: '2026-11-27T18:00:00Z' })
    const t = verificarCorreo(buildHtml(p, proveedorEjemplo), { pie: PIE.replace('19 nov 26', '10 nov 26') })
    expect(t).toContain('10 nov 26 fecha del pago')
    expect(asunto(p)).toBe('Comprobante de pago — Satori (10 de noviembre de 2026)')
    expect(t).not.toContain('27 de noviembre')
  })
  it('sin ninguna fecha confiable: «enviado el», nunca «fecha del pago»', () => {
    const p = armarPago({ movs: [{ ...facturaB, created_at: '' }], aplicaciones: [], edits: [], ahora: ENVIO_ISO, fechaFactura: { [ids.b]: '2026-11-10' } })
    const t = verificarCorreo(buildHtml(p, proveedorEjemplo), { pie: PIE })
    expect(t).not.toMatch(/fecha del pago/i)
    expect(t).toContain('19 nov 26 enviado el')
    expect(t).toContain('Enviado el')
    expect(asunto(p)).toBe('Comprobante de pago — Satori (enviado el 19 de noviembre de 2026)')
    expect(t).toContain('Le confirmamos el pago de una factura por ₡66.450.')
  })
  it('saldada entera con crédito: lo dice, sin «pago por ₡0»', () => {
    const p = armarPago({
      movs: [facturaB], edits: editsEjemplo, ahora: ENVIO_ISO,
      aplicaciones: [{ applied_to_movement_id: ids.b, amount_applied: 66_450, reversed: false }],
    })
    const t = verificarCorreo(buildHtml(p, proveedorEjemplo), { pie: PIE })
    expect(t).toContain('su factura quedó saldada con su crédito a favor el 19 de noviembre de 2026')
    expect(t).not.toContain('pago de una factura por ₡0')
  })
  it('más de 10 facturas: todas aparecen (varias tablas de 10)', () => {
    const muchas: MovimientoPago[] = Array.from({ length: 13 }, (_, i) => ({
      ...facturaB, id: `00000000-0000-4000-8000-${String(100 + i).padStart(12, '0')}`, description: `Ref ${String(i + 1).padStart(2, '0')}`,
    }))
    const t = verificarCorreo(buildHtml(armarPago({ movs: muchas, aplicaciones: [], edits: [], ahora: ENVIO_ISO }), proveedorEjemplo), { pie: PIE.replace('19 nov 26', '10 nov 26') })
    for (let i = 1; i <= 13; i++) expect(t).toContain(`Ref ${String(i).padStart(2, '0')}`)
    expect(t).not.toContain('Se muestran')
  })
  it('escapa proveedor y referencia', () => {
    const p = armarPago({ movs: [{ ...facturaB, description: '<img src=x>' }], aplicaciones: [], edits: [], ahora: ENVIO_ISO })
    const h = buildHtml(p, { name: '<b>x</b>' })
    expect(h).not.toContain('<img')
    expect(h).not.toContain('<b>x')
  })
  it('vista previa al día', () => foto('pago-notificar.html', html))
})
