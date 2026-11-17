// Plantillas de monthly-report (ventas y propinas) con el estándar de reportes adaptado a correo.
// Datos FICTICIOS (plantilla.ejemplo.ts). La vista previa del repo (docs/reportes/previews/) es la «foto»:
// si la plantilla cambia y la vista previa no, esta prueba cae. Para regenerarla:
//   ACTUALIZAR_PREVIEWS=1 npx vitest run supabase/functions/monthly-report/plantilla.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buildVentasEmail, buildPropinasEmail, tituloPeriodo } from './plantilla.ts'
import { verificarCorreo } from './correo-estandar.verificar.ts'
import { COLOR } from './correo-estandar.ts'
import { ventasEjemplo, propinasEjemplo, planMesEjemplo, planQuincenaEjemplo } from './plantilla.ejemplo.ts'

const aqui = dirname(fileURLToPath(import.meta.url))
const previews = join(aqui, '../../../docs/reportes/previews')

function foto(nombre: string, html: string) {
  const ruta = join(previews, nombre)
  if (process.env.ACTUALIZAR_PREVIEWS === '1') writeFileSync(ruta, html)
  expect(existsSync(ruta), `falta ${nombre}: correr con ACTUALIZAR_PREVIEWS=1`).toBe(true)
  expect(html).toBe(readFileSync(ruta, 'utf8'))
}

describe('correo de ventas', () => {
  const html = buildVentasEmail(ventasEjemplo, planMesEjemplo)
  const texto = verificarCorreo(html, { pie: 'Satori, reporte de ventas, octubre de 2026' })

  it('cabecera, título del período y bajada con la conclusión', () => {
    expect(texto).toContain('Satori Reporte de ventas octubre de 2026')
    expect(texto).toContain('Octubre 2026')
    expect(texto).toContain('Se vendieron ₡48.250.000 en 30 días con registro, +18 % vs. mes anterior (septiembre).')
    expect(texto).toContain('El salón hizo el 86 % de la venta y el mejor día de la semana fue el sábado.')
  })
  it('mismas cifras que el correo anterior, con formato del estándar', () => {
    for (const s of ['₡48.250.000', '₡41.300.000', '₡2.800.000', '₡4.150.000', '3.120', '₡13.237', '₡1.608.333', '₡41.000.000']) expect(texto).toContain(s)
    // Variación +18 %: dentro de 70–130 %, va en gris y sin flecha.
    expect(html).not.toContain('▲')
    expect(texto).toContain('Ana Prueba')
    expect(texto).toContain('Roll de ejemplo')
    expect(texto).toContain('612')
  })
  it('una suba de más de 130 % va en musgo con ▲; una baja de menos de 70 % en laca con ▼', () => {
    const sube = buildVentasEmail({ ...ventasEjemplo, prevNeta: 30_000_000 }, planMesEjemplo)
    expect(sube).toContain(`color:${COLOR.musgo};font-weight:600">▲ +61 %`)
    const baja = buildVentasEmail({ ...ventasEjemplo, prevNeta: 80_000_000 }, planMesEjemplo)
    expect(baja).toContain(`color:${COLOR.laca};font-weight:600">▼ −40 %`)
  })
  it('sin mes anterior no inventa variación', () => {
    const h = buildVentasEmail({ ...ventasEjemplo, prevNeta: 0 }, planMesEjemplo)
    expect(h).not.toMatch(/vs\. /)
  })
  it('quincena: título y comparación de la 1.ª quincena', () => {
    const q = buildVentasEmail(ventasEjemplo, planQuincenaEjemplo)
    verificarCorreo(q, { pie: 'Satori, reporte de ventas, 1.ª quincena de noviembre de 2026' })
    expect(tituloPeriodo(planQuincenaEjemplo)).toBe('1.ª quincena de noviembre')
    expect(q).toContain('vs. 1.ª quincena de octubre')
  })
  it('escapa nombres que vienen de la base', () => {
    const h = buildVentasEmail({ ...ventasEjemplo, topSal: [{ ...ventasEjemplo.topSal[0], nombre: '<img src=x onerror=1>' }] }, planMesEjemplo)
    expect(h).not.toContain('<img')
  })
  it('vista previa al día', () => foto('monthly-report-ventas.html', html))
})

describe('correo de propinas', () => {
  const html = buildPropinasEmail(propinasEjemplo, planMesEjemplo)
  const texto = verificarCorreo(html, { pie: 'Satori, reporte de propinas, octubre de 2026' })

  it('bajada con la conclusión y cifras clave', () => {
    expect(texto).toContain('Se repartieron ₡6.480.000 en 58 turnos: ₡111.724 por turno en promedio.')
    expect(texto).toContain('El mejor día fue el sábado (₡152.000 por turno) y el más bajo, el lunes (₡84.000).')
    expect(texto).toContain('turnos: 28 mediodía, 30 noche')
    expect(texto).toContain('pozo de barra, 18 % del total')
  })
  it('mismas cifras que el correo anterior', () => {
    for (const s of ['₡85.000', '₡136.667', '₡640.000', '₡24.615', '45 %', 'Saloneros', 'Gerencia']) expect(texto).toContain(s)
    expect(texto).not.toMatch(/take-home|pool/i)
  })
  it('sin turnos no divide por cero', () => {
    const h = buildPropinasEmail({ ...propinasEjemplo, turnos: 0, amCount: 0, pmCount: 0, diasSem: [], semanas: [] }, planMesEjemplo)
    expect(h).not.toMatch(/NaN|Infinity/)
  })
  it('vista previa al día', () => foto('monthly-report-propinas.html', html))
})
