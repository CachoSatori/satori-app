// Comprobante de pago al proveedor con el estándar de reportes adaptado a correo. Datos FICTICIOS.
// La vista previa del repo es la «foto»; para regenerarla:
//   ACTUALIZAR_PREVIEWS=1 npx vitest run supabase/functions/pago-notificar/plantilla.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buildHtml, diaCR } from './plantilla.ts'
import { verificarCorreo } from './correo-estandar.verificar.ts'
import { proveedorEjemplo, movimientoEjemplo, movimientoUsdEjemplo } from './plantilla.ejemplo.ts'

const aqui = dirname(fileURLToPath(import.meta.url))
const previews = join(aqui, '../../../docs/reportes/previews')
function foto(nombre: string, html: string) {
  const ruta = join(previews, nombre)
  if (process.env.ACTUALIZAR_PREVIEWS === '1') writeFileSync(ruta, html)
  expect(existsSync(ruta), `falta ${nombre}: correr con ACTUALIZAR_PREVIEWS=1`).toBe(true)
  expect(html).toBe(readFileSync(ruta, 'utf8'))
}

describe('comprobante de pago', () => {
  const html = buildHtml(movimientoEjemplo, proveedorEjemplo)
  const texto = verificarCorreo(html, { pie: 'Satori, comprobante de pago, 15 nov 26' })

  it('fecha de Costa Rica, no la de UTC (pago a las 21:40 CR)', () => {
    expect(diaCR('2026-11-16T03:40:00Z')).toBe('2026-11-15')
    expect(diaCR('2026-11-16T06:00:00Z')).toBe('2026-11-16')
    expect(texto).toContain('15 nov 26')
    expect(texto).toContain('el 15 de noviembre de 2026')
  })
  it('mismos datos que el correo anterior', () => {
    for (const s of ['Pescadería de Ejemplo S.A.', '₡186.450', 'Transferencia', 'Factura 0001 de pescado fresco (ficticia)']) expect(texto).toContain(s)
    expect(texto).not.toContain('$')
  })
  it('lo lee el proveedor: en «usted», sin voseo ni tuteo', () => {
    expect(texto).toContain('Le confirmamos un pago por ₡186.450')
    expect(texto).toContain('Por favor, no responda a este correo.')
    expect(texto).not.toMatch(/\b(respondas|respondé|tu|vos)\b/i)
  })
  it('con dólares', () => {
    const t = verificarCorreo(buildHtml(movimientoUsdEjemplo, proveedorEjemplo), { pie: 'Satori, comprobante de pago, 15 nov 26' })
    expect(t).toContain('₡186.450 y $120,50')
    expect(t).toContain('Efectivo')
  })
  it('sin método: «Transferencia», como antes; sin detalle: raya', () => {
    const t = verificarCorreo(buildHtml({ ...movimientoEjemplo, method: null, description: '' }, proveedorEjemplo), { pie: 'Satori, comprobante de pago, 15 nov 26' })
    expect(t).toContain('Transferencia')
    expect(t).toContain('—')
  })
  it('escapa proveedor y detalle', () => {
    const h = buildHtml({ ...movimientoEjemplo, description: '<img src=x>' }, { name: '<b>x</b>' })
    expect(h).not.toContain('<img')
    expect(h).not.toContain('<b>x')
  })
  it('vista previa al día', () => foto('pago-notificar.html', html))
})
