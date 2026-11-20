// Plantilla del correo del cierre de caja con el estándar de reportes adaptado a correo.
// Datos FICTICIOS (plantilla.ejemplo.ts). La vista previa del repo es la «foto»; para regenerarla:
//   ACTUALIZAR_PREVIEWS=1 npx vitest run supabase/functions/cierre-email/plantilla.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buildHtml, textoConSaltos, tipoCambio, tituloFecha, UMBRAL_CUADRA } from './plantilla.ts'
import { verificarCorreo } from './correo-estandar.verificar.ts'
import { COLOR, crc } from './correo-estandar.ts'
import { cierreCuadraEjemplo, cierreFaltanteEjemplo, cierreSinNovedadesEjemplo } from './plantilla.ejemplo.ts'
import * as edge from './ventasPos.gen.js'
import type { LogicaResumen, ResumenCorreo } from './resumen.ts'
import { diaFicticio } from './pruebas.fixtures.ts'

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
  it('cabecera; sin el título ni la bajada que repetían la diferencia (v18)', () => {
    expect(texto).toContain('Satori Cierre de caja 15 nov 26')
    expect(html).not.toContain('<h1')
    expect(texto).not.toContain('15 de noviembre')
    expect(texto).not.toContain('La caja cuadra')
  })
  it('Diferencia: «Cuadra» y, en gris abajo, quién cerró y el tipo de cambio', () => {
    expect(texto).toContain('Diferencia Cuadra sin diferencia Cerró Ana Prueba, tipo de cambio ₡505,20')
    expect(html).toContain(`<br><span style="color:${COLOR.gris}">Cerró Ana Prueba, tipo de cambio ₡505,20</span>`)
    expect(buildHtml({ ...cierreCuadraEjemplo, manager: '  ' })).toContain('>Tipo de cambio ₡505,20<')
  })
  it('mismas cifras que el correo anterior', () => {
    for (const s of ['₡812.400', '$145,00', '₡2.315.900', '$380,50', '−₡337.500', '₡650.000', '$200,00', '₡100.000',
      '₡1.284.350', '$325,50', '₡2.034.350', '$525,50', 'Remanente CF']) expect(texto).toContain(s)
    expect(html).toContain(`color:${COLOR.musgo}">Cuadra`)
    expect(html).not.toContain(COLOR.laca)
  })
  it('Resumen del día: tal cual, con sus saltos de línea, y escapado', () => {
    expect(texto).toContain('Resumen del día Queja: una mesa de la terraza esperó mucho el segundo plato. 86: gyozas desde las 21:00. Mantenimiento: se cambió el rollo de la impresora de la barra.')
    expect(html).toContain('segundo plato.<br>86: gyozas desde las 21:00.<br>Mantenimiento:')
    const h = buildHtml({ ...cierreCuadraEjemplo, notas: '<script>x</script>', manager: '<b>x</b>' })
    expect(h).not.toContain('<script>')
    expect(h).not.toContain('<b>x')
    expect(textoConSaltos('a\r\nb\rc\nd & e')).toBe('a<br>b<br>c<br>d &amp; e')
  })
  it('sin la sección «Notas» del final (ahora es el Resumen del día)', () => {
    expect(html).not.toMatch(/>Notas</)
  })
  it('«Sin novedades» también se muestra', () => {
    expect(verificarCorreo(buildHtml(cierreSinNovedadesEjemplo), { pie: 'Satori, cierre de caja, 15 nov 26' }))
      .toContain('Resumen del día Sin novedades Diferencia')
  })
  it('notas vacías o en blanco (cierres viejos) → no hay sección', () => {
    for (const notas of [null, '', '  \n ']) {
      expect(buildHtml({ ...cierreCuadraEjemplo, notas })).not.toContain('Resumen del día')
    }
  })
  it('vista previa al día', () => foto('cierre-email.html', html))
})

describe('correo del cierre: con diferencia', () => {
  const html = buildHtml(cierreFaltanteEjemplo)
  const texto = verificarCorreo(html, { pie: 'Satori, cierre de caja, 15 nov 26' })
  it('faltante en laca, con monto y motivo, y quién cerró en gris abajo', () => {
    expect(texto).toContain('Diferencia Faltante −₡12.500 Vuelto de una mesa mal contado Cerró Ana Prueba, tipo de cambio ₡505,20')
    expect(html).toContain(`color:${COLOR.laca}">Faltante`)
    expect(texto).not.toContain('Notas')
    expect(texto).not.toContain('Resumen del día')   // cierre viejo sin notas
  })
  it('umbral de «cuadra» igual que antes: |diferencia| < ₡500', () => {
    expect(UMBRAL_CUADRA).toBe(500)
    expect(buildHtml({ ...cierreCuadraEjemplo, diferencia_crc: -499 })).toContain(`color:${COLOR.musgo}">Cuadra`)
    const h = buildHtml({ ...cierreCuadraEjemplo, diferencia_crc: 500 })
    expect(h).toContain(`color:${COLOR.laca}">Sobrante`)
    expect(h).toContain('+₡500')
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

// ── Ventas del día (resumen del PoS). Datos FICTICIOS, armados con el paquete de la app. ─────────

const L = edge as unknown as LogicaResumen
function resumenFicticio(): ResumenCorreo {
  const a = diaFicticio('2026-11-15', 1.25), b = diaFicticio('2026-11-08')
  const actual = L.resumenVentasDia(a.tickets, a.lineas, '2026-11-15', { '901': 'ANA PRUEBA', '902': 'LUIS EJEMPLO' })
  const anterior = L.resumenVentasDia(b.tickets, b.lineas, '2026-11-08', {})
  return { actual, anterior, minMesas: L.MIN_MESAS, minPersonas: L.MIN_PERSONAS }
}

describe('correo del cierre: ventas del día', () => {
  const r = resumenFicticio()
  const html = buildHtml(cierreCuadraEjemplo, r)
  const texto = verificarCorreo(html, { pie: 'Satori, cierre de caja, 15 nov 26' })
  it('cifras con la comparación contra el mismo día de la semana pasada', () => {
    expect(texto).toContain('Ventas del día')
    expect(texto).toContain(crc(r.actual.ventaNeta))
    expect(texto).toContain('venta neta')
    expect(texto).toContain('promedio por pax')
    expect(texto).toContain('bebidas por pax')
    expect(texto).toContain('vs 8 nov 26')
    for (const s of ['Venta bruta', 'Salón', 'Delivery', 'Pax']) expect(texto).toContain(s)
  })
  it('salonero destacado con los dos criterios', () => {
    expect(texto).toContain('Más vendió: Ana Prueba')
    expect(texto).toContain('Mejor promedio por pax: Luis Ejemplo')
    expect(texto).toMatch(/\d pax en \d mesas/)
  })
  it('estimadas y fuera del promedio, rotulados; definiciones al pie', () => {
    expect(texto).toMatch(/El promedio por pax incluye [\d,]+ % de personas estimadas\./)
    expect(texto).toContain('Fuera del promedio: 1 mesa de dueños.')
    expect(texto).toContain('al menos 3 mesas y 6 personas')
    expect(texto).toContain('Beb/PAX')
  })
  it('orden v18: Resumen → Diferencia → Ventas → Salonero → Caja del día → Conteo → pie', () => {
    const orden = ['Resumen del día', 'Diferencia', 'Ventas del día', 'Salonero destacado', 'Caja del día',
      'Distribución del conteo físico', 'Satori, cierre de caja, 15 nov 26']
    // El pie se busca desde el final (el mismo texto está en el <title> del documento).
    const pos = orden.map((s, i) => (i === orden.length - 1 ? texto.lastIndexOf(s) : texto.indexOf(s)))
    for (const p of pos) expect(p).toBeGreaterThan(-1)
    expect([...pos].sort((a, b) => a - b)).toEqual(pos)
    // Las cifras grandes van después del salonero destacado, no arriba.
    expect(texto.indexOf('ventas mediodía')).toBeGreaterThan(texto.indexOf('Salonero destacado'))
    expect(texto.indexOf('total contado')).toBeLessThan(texto.indexOf('Distribución del conteo físico'))
  })
  it('vista previa al día (muestra para el dueño)', () => foto('cierre-email-ventas.html', html))
  it('sin resumen (undefined) → el correo de antes, sin sección', () => {
    expect(buildHtml(cierreCuadraEjemplo)).not.toContain('Ventas del día')
  })
})

describe('correo del cierre: ventas, casos borde', () => {
  const base = resumenFicticio()
  const vacio = { ...base.actual, facturas: 0, ventaBruta: 0, ventaNeta: 0, salon: 0, delivery: 0, pax: 0, promPax: null, pctEstimado: 0, mesasDuenos: 0, regaliasTotales: 0, bebPax: null, masVendio: null, mejorPromPax: null }
  it('no disponible → una línea gris, sin cifras ni destacado', () => {
    const h = buildHtml(cierreCuadraEjemplo, null)
    const t = verificarCorreo(h, { pie: 'Satori, cierre de caja, 15 nov 26' })
    expect(t).toContain('Resumen de ventas no disponible.')
    expect(t).not.toContain('Salonero destacado')
    foto('cierre-email-ventas-no-disponible.html', h)
  })
  it('día sin ventas → lo dice, con la neta de la semana pasada', () => {
    const t = verificarCorreo(buildHtml(cierreCuadraEjemplo, { ...base, actual: vacio }), { pie: 'Satori, cierre de caja, 15 nov 26' })
    expect(t).toContain('No hay ventas cerradas en el PoS para esta jornada.')
    expect(t).toContain(`El 8 nov 26 se vendieron ${crc(base.anterior!.ventaNeta)} netos.`)
  })
  it('sin pax → promedio y bebidas en «—», sin mejor promedio', () => {
    const h = buildHtml(cierreCuadraEjemplo, { ...base, actual: { ...base.actual, pax: 0, promPax: null, bebPax: null, pctEstimado: 0, mejorPromPax: null } })
    const t = verificarCorreo(h, { pie: 'Satori, cierre de caja, 15 nov 26' })
    expect(t).toContain('— promedio por pax')
    expect(t).toContain('Mejor promedio por pax: nadie llegó a 3 mesas y 6 personas.')
    expect(h).not.toMatch(/NaN|undefined|null/)
  })
  it('sin delivery → «—» en la fila', () => {
    const t = verificarCorreo(buildHtml(cierreCuadraEjemplo, { ...base, actual: { ...base.actual, delivery: 0 } }), { pie: 'Satori, cierre de caja, 15 nov 26' })
    expect(t).toMatch(/Delivery — /)
  })
  it('sin salonero → lo dice, sin inventar nombres', () => {
    const t = verificarCorreo(buildHtml(cierreCuadraEjemplo, { ...base, actual: { ...base.actual, masVendio: null, mejorPromPax: null } }), { pie: 'Satori, cierre de caja, 15 nov 26' })
    expect(t).toContain('Más vendió: ningún salonero con ventas de salón.')
  })
  it('sin la semana pasada → sin flechas ni columna inventada', () => {
    const h = buildHtml(cierreCuadraEjemplo, { ...base, anterior: null })
    expect(h).not.toMatch(/▲|▼/)
    expect(verificarCorreo(h, { pie: 'Satori, cierre de caja, 15 nov 26' })).toContain('semana pasada')
  })
  it('destacado sin nombre en employees → su código, no un nombre inventado', () => {
    const mv = { ...base.actual.masVendio!, nombre: null }
    expect(buildHtml(cierreCuadraEjemplo, { ...base, actual: { ...base.actual, masVendio: mv } })).toContain(`código ${mv.login}`)
  })
  it('nombres escapados', () => {
    const mv = { ...base.actual.masVendio!, nombre: '<b>x</b>' }
    expect(buildHtml(cierreCuadraEjemplo, { ...base, actual: { ...base.actual, masVendio: mv } })).not.toContain('<b>x')
  })
})
