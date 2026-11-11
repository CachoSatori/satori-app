// (11-nov, modo transición) El link del anfitrión para WhatsApp: el mismo destino que su QR, nunca el portal privado, y
// los dos textos tal como los aprobó el dueño.
import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { linkAnfitrion, lugarDelMensaje, mensajeWhatsapp, urlWhatsapp } from './compartir'
import { urlReferente, urlPortal, CLUB_BASE_URL } from './qrFormato'
import { TEXTOS } from './i18n'

const BASE = 'https://club.ejemplo.test'
const CODIGO = 'ABCDEFGH'

test('el link es exactamente lo que codifica el QR del anfitrión (/r/<código>)', () => {
  expect(linkAnfitrion(BASE, CODIGO)).toBe(`${BASE}/r/${CODIGO}`)
  expect(linkAnfitrion(CLUB_BASE_URL, CODIGO)).toBe(urlReferente(CODIGO))
})

test('nunca es el link del portal privado, ni acepta algo que no sea un código de anfitrión', () => {
  const token = 'a'.repeat(64)
  expect(linkAnfitrion(BASE, token)).toBeNull()                 // un token del portal no pasa
  expect(linkAnfitrion(BASE, 'abcdefgh')).toBeNull()            // minúsculas
  expect(linkAnfitrion(BASE, 'ABCDEFG')).toBeNull()             // 7
  expect(linkAnfitrion(BASE, 'ABCDEFG0')).toBeNull()            // el 0 no está en el alfabeto
  expect(linkAnfitrion(BASE, 'ABCD/../')).toBeNull()
  for (const idioma of ['es', 'en'] as const) {
    const m = mensajeWhatsapp(idioma, 'Satori Sushi Bar', 'Santa Teresa', linkAnfitrion(BASE, CODIGO)!)
    expect(m).not.toContain('/p/')
    expect(m).not.toContain(urlPortal(token))
  }
})

test('los textos aprobados por el dueño (11-nov), con el único local encendido', () => {
  const link = `${BASE}/r/${CODIGO}`
  expect(mensajeWhatsapp('es', 'Satori Sushi Bar', 'Santa Teresa', link)).toBe(
    `¡Bienvenidos! Con este link tienen 10 % de descuento en Satori Sushi Bar (Santa Teresa). Ábranlo y muestren el cupón al pedir la cuenta: ${link}`)
  expect(mensajeWhatsapp('en', 'Satori Sushi Bar', 'Santa Teresa', link)).toBe(
    `Welcome! This link gets you 10% off at Satori Sushi Bar (Santa Teresa). Open it and show the coupon when you ask for the bill: ${link}`)
})

test('LC-ML: el lugar sale de los locales encendidos; con ninguno o con dos, el mensaje no nombra ninguno', () => {
  expect(lugarDelMensaje([{ nombre: 'Santa Teresa' }])).toBe('Santa Teresa')
  expect(lugarDelMensaje([{ nombre: 'Uno' }, { nombre: 'Dos' }])).toBeNull()
  expect(lugarDelMensaje([])).toBeNull()
  expect(lugarDelMensaje(null)).toBeNull()
  expect(lugarDelMensaje([{ nombre: '  ' }])).toBeNull()
  const link = `${BASE}/r/${CODIGO}`
  expect(mensajeWhatsapp('es', 'Satori Sushi Bar', null, link)).toContain('en Satori Sushi Bar. Ábranlo')
  expect(mensajeWhatsapp('en', 'Satori Sushi Bar', null, link)).toContain('at Satori Sushi Bar. Open it')
  // ningún local escrito en el código del mensaje
  expect(readFileSync(new URL('./compartir.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/Santa Teresa|Nosara/i)
})

test('wa.me sin destinatario y con el texto entero codificado (el link llega completo)', () => {
  const link = `${BASE}/r/${CODIGO}`
  const u = urlWhatsapp(mensajeWhatsapp('es', 'Satori Sushi Bar', 'Santa Teresa', link))
  expect(u.startsWith('https://wa.me/?text=')).toBe(true)
  expect(u).not.toMatch(/wa\.me\/\d/)                            // sin número: no se manda a nadie por defecto
  expect(decodeURIComponent(u.slice('https://wa.me/?text='.length))).toContain(link)
  expect(u).not.toContain(' ')
})

test('la pantalla tiene los rótulos en los dos idiomas', () => {
  for (const k of ['es', 'en'] as const) {
    for (const c of ['portal_link', 'portal_link_ayuda', 'copiar_link', 'link_copiado', 'link_no_copiado', 'whatsapp_es', 'whatsapp_en'] as const) {
      expect(typeof TEXTOS[k][c]).toBe('string'); expect((TEXTOS[k][c] as string).length).toBeGreaterThan(3)
    }
  }
})
