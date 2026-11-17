// Plantilla del correo del cierre de caja con el estándar de reportes adaptado a correo.
// Datos FICTICIOS (plantilla.ejemplo.ts). La vista previa del repo es la «foto»; para regenerarla:
//   ACTUALIZAR_PREVIEWS=1 npx vitest run supabase/functions/cierre-email/plantilla.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buildHtml, tipoCambio, tituloFecha, UMBRAL_CUADRA } from './plantilla.ts'
import { verificarCorreo } from './correo-estandar.verificar.ts'
import { COLOR } from './correo-estandar.ts'
import { cierreCuadraEjemplo, cierreFaltanteEjemplo } from './plantilla.ejemplo.ts'

const aqui = dirname(fileURLToPath(import.meta.url))
const previews = join(aqui, '../../../docs/reportes/previews')
function foto(nombre: string, html: string) {
  const ruta = join(previews, nombre)
  if (process.env.ACTUALIZAR_PREVIEWS === '1') writeFileSync(ruta, html)
  expect(existsSync(ruta), `falta ${nombre}: correr con ACTUALIZAR_PREVIEWS=1`).toBe(true)
  expect(html).toBe(readFileSync(ruta, 'utf8'))
}

describe('correo del cierre: cuadra', () => {
  const html = buildHtml(cierreCuadraEjemplo)
  const texto = verificarCorreo(html, { pie: 'Satori, cierre de caja, 15 nov 26' })
  it('cabecera, título y bajada con la conclusión', () => {
    expect(texto).toContain('Satori Cierre de caja 15 nov 26')
    expect(texto).toContain('15 de noviembre')
    expect(texto).toContain('La caja cuadra, sin diferencia. Cerró Ana Prueba, con tipo de cambio ₡505,20.')
  })
  it('mismas cifras que el correo anterior', () => {
    for (const s of ['₡812.400', '$145,00', '₡2.315.900', '$380,50', '−₡337.500', '₡650.000', '$200,00', '₡100.000',
      '₡1.284.350', '$325,50', '₡2.034.350', '$525,50', 'Remanente CF']) expect(texto).toContain(s)
    expect(html).toContain(`color:${COLOR.musgo}">Cuadra`)
    expect(html).not.toContain(COLOR.laca)
  })
  it('notas, escapadas', () => {
    expect(texto).toContain('Se cambió el rollo de la impresora de la barra.')
    const h = buildHtml({ ...cierreCuadraEjemplo, notas: '<script>x</script>', manager: '<b>x</b>' })
    expect(h).not.toContain('<script>')
    expect(h).not.toContain('<b>x')
  })
  it('vista previa al día', () => foto('cierre-email.html', html))
})

describe('correo del cierre: con diferencia', () => {
  const html = buildHtml(cierreFaltanteEjemplo)
  const texto = verificarCorreo(html, { pie: 'Satori, cierre de caja, 15 nov 26' })
  it('faltante en laca, con monto y motivo', () => {
    expect(texto).toContain('Faltante de ₡12.500: Vuelto de una mesa mal contado.')
    expect(html).toContain(`color:${COLOR.laca}">Faltante`)
    expect(texto).toContain('−₡12.500')
    expect(texto).not.toContain('Notas')
  })
  it('umbral de «cuadra» igual que antes: |diferencia| < ₡500', () => {
    expect(UMBRAL_CUADRA).toBe(500)
    expect(buildHtml({ ...cierreCuadraEjemplo, diferencia_crc: -499 })).toContain('La caja cuadra')
    expect(buildHtml({ ...cierreCuadraEjemplo, diferencia_crc: 500 })).toContain('Sobrante de ₡500.')
  })
  it('vista previa al día', () => foto('cierre-email-faltante.html', html))
})

describe('formatos', () => {
  it('tipo de cambio y título', () => {
    expect(tipoCambio(510)).toBe('₡510')
    expect(tipoCambio(505.2)).toBe('₡505,20')
    expect(tituloFecha('2026-06-01')).toBe('1 de junio')
  })
  it('sin propinas ni dólares no muestra filas vacías raras', () => {
    const h = buildHtml({ ...cierreCuadraEjemplo, propinas_m_crc: null, propinas_n_crc: 0, vm_usd: null, vn_usd: 0, sep_diaria_usd: 0, remanente_usd: 0 })
    expect(h).not.toContain('propinas pagadas')
    expect(h).not.toMatch(/NaN|undefined/)
  })
})
