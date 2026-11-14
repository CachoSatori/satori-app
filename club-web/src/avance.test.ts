// Mig 168 · «Mi Club»: textos del avance de los primeros 90 días (ES y EN, «usted»), y lectura defensiva de la API.
import { test, expect } from 'vitest'
import { leerAvance, textosAvance } from './avance'
import { TEXTOS } from './i18n'

const dia = (d: string) => d.split('-').reverse().join('/')

test('168: «Visita 2 de 4» con la fecha límite, en ES y EN', () => {
  const a = leerAvance({ avance: { visita: 2, de: 4, ganada: false, hasta: '2027-02-11' } })
  expect(a).not.toBeNull()
  const es = textosAvance(a!, TEXTOS.es, dia)
  expect(es.principal).toBe('Visita 2 de 4')
  expect(es.detalle).toBe('Si nos visita 4 veces antes del 11/02/2027, le regalamos una cortesía especial.')
  expect(textosAvance(a!, TEXTOS.en, dia).principal).toBe('Visit 2 of 4')
})

test('168: ganada → mensaje de cortesía con el vencimiento (visita = de)', () => {
  const a = leerAvance({ avance: { visita: 4, de: 4, ganada: true, vence_en: '2026-12-20' } })!
  const es = textosAvance(a, TEXTOS.es, dia)
  expect(es.ganada).toBe(true)
  expect(es.principal).toBe('Ganó una cortesía especial de bienvenida.')
  expect(es.detalle).toContain('20/12/2026')
  expect(textosAvance(a, TEXTOS.en, dia).principal).toBe('You earned a special welcome treat.')
})

test('168: sin avance o datos raros → null (el portal no muestra nada)', () => {
  expect(leerAvance({ avance: null })).toBeNull()
  expect(leerAvance(null)).toBeNull()
  expect(leerAvance({ avance: { visita: 5, de: 4, ganada: false, hasta: '2027-01-01' } })).toBeNull()
  expect(leerAvance({ avance: { visita: 0, de: 4, ganada: false, hasta: '2027-01-01' } })).toBeNull()
  expect(leerAvance({ avance: { visita: 2, de: 4, ganada: false } })).toBeNull()
  expect(leerAvance({ avance: { visita: 4, de: 4, ganada: true, vence_en: 'mañana' } })).toBeNull()
})
