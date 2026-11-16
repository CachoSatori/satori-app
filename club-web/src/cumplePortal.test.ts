// 173 (D-cumple-1 A): lo que muestra «Su cumpleaños» en el portal según lo que contesta la base (sin la fecha).
import { test, expect } from 'vitest'
import { leerEstadoCumple, vistaCumple } from './cumple'
import { TEXTOS } from './i18n'

test('formulario solo para el socio que no lo tiene y no lo cargó antes; «ya» si lo tiene; nada si no es socio o la respuesta es rara', () => {
  expect(vistaCumple(leerEstadoCumple({ socio: true, tiene: false, puede_agregar: true }))).toBe('form')
  expect(vistaCumple(leerEstadoCumple({ socio: true, tiene: true, puede_agregar: false }))).toBe('ya')
  // se lo borró el owner después de cargarlo una vez desde el portal: ni formulario ni «ya»
  expect(vistaCumple(leerEstadoCumple({ socio: true, tiene: false, puede_agregar: false }))).toBeNull()
  expect(vistaCumple(leerEstadoCumple({ socio: false, tiene: false, puede_agregar: false }))).toBeNull()
  expect(leerEstadoCumple({ socio: 'true', tiene: false, puede_agregar: true })).toBeNull()
  expect(leerEstadoCumple(null)).toBeNull()
  expect(vistaCumple(null)).toBeNull()
})

test('los textos del portal dicen «una sola vez» en ES y EN, y no muestran fechas', () => {
  expect(TEXTOS.es.cumple_txt).toContain('una sola vez')
  expect(TEXTOS.en.cumple_txt).toContain('only once')
  for (const k of ['cumple_titulo', 'cumple_txt', 'cumple_guardar', 'cumple_listo', 'cumple_ya', 'cumple_ya_cargado'] as const) {
    expect(TEXTOS.es[k].length).toBeGreaterThan(3)
    expect(TEXTOS.en[k].length).toBeGreaterThan(3)
  }
})
