// D7 A (mig 157) · El portal del equipo: personas registradas, sin créditos ni «Canjear». Textos al cliente en «usted».
import { test, expect } from 'vitest'
import { modoPortal } from './portalEquipo'
import { TEXTOS } from './i18n'

test('equipo: nunca ofrece «Canjear», aunque la base mande créditos', () => {
  expect(modoPortal({ equipo: true, creditos: 3 })).toEqual({ equipo: true, canje: false })
  expect(modoPortal({ equipo: true, creditos: 0 })).toEqual({ equipo: true, canje: false })
})

test('referente: «Canjear» desde 1 crédito, como siempre', () => {
  expect(modoPortal({ equipo: false, creditos: 1 })).toEqual({ equipo: false, canje: true })
  expect(modoPortal({ creditos: 0.5 })).toEqual({ equipo: false, canje: false })
  expect(modoPortal({ equipo: null, creditos: 2 }).canje).toBe(true)   // base vieja sin el campo
})

test('textos del equipo: personas, no créditos; ES y EN', () => {
  expect(TEXTOS.es.equipo_mes(1)).toBe('1 persona este mes')
  expect(TEXTOS.es.equipo_mes(4)).toBe('4 personas este mes')
  expect(TEXTOS.en.equipo_mes(4)).toBe('4 guests this month')
  expect(TEXTOS.es.equipo_titulo).toBe('Personas registradas')
  expect(TEXTOS.es.equipo_indicaciones).not.toMatch(/crédito/)
  expect(TEXTOS.en.equipo_indicaciones).not.toMatch(/credit/)
})
