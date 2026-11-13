// (12-nov) El logo y la franja del pase de Google Wallet se sirven desde el dominio del Club: `WALLET_DISENO` del Edge
// apunta a https://<dominio>/pase/logo.png y /pase/hero.png. Vite copia `public/` tal cual a `dist/`, así que quedan
// publicados con el deploy de Pages. Esta prueba cuida que existan, que sean los PNG del diseño aprobado y que ninguna
// regla de `_redirects` (las páginas /p/, /r/, …) se coma esas rutas.
import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const leer = (ruta: string) => readFileSync(new URL(ruta, import.meta.url))
const png = (b: Buffer) => ({ firma: b.subarray(0, 8).toString('hex'), ancho: b.readUInt32BE(16), alto: b.readUInt32BE(20) })

test('las imágenes del pase están en public/pase/ y son los PNG del diseño (990×990 y 1032×336)', () => {
  const logo = png(leer('../public/pase/logo.png'))
  const hero = png(leer('../public/pase/hero.png'))
  expect(logo).toEqual({ firma: '89504e470d0a1a0a', ancho: 990, alto: 990 })
  expect(hero).toEqual({ firma: '89504e470d0a1a0a', ancho: 1032, alto: 336 })
})

test('ninguna regla de _redirects captura /pase/logo.png ni /pase/hero.png', () => {
  const reglas = leer('../public/_redirects').toString('utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
  const origenes = reglas.map(l => l.split(/\s+/)[0])
  const aRegex = (o: string) => new RegExp('^' + o.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/:[a-z]+/gi, '[^/]+') + '$')
  for (const ruta of ['/pase/logo.png', '/pase/hero.png']) {
    expect(origenes.filter(o => aRegex(o).test(ruta)), ruta).toEqual([])
  }
})

test('WALLET-GOOGLE-ACTIVACION.md da WALLET_DISENO con esas dos rutas y el fondo tinta', () => {
  const doc = readFileSync(new URL('../../docs/club-satori/WALLET-GOOGLE-ACTIVACION.md', import.meta.url), 'utf8')
  const valores = [...doc.matchAll(/`(\{"colorFondo":"#0d0d0d","logoUrl":"https:\/\/[^"]+","heroUrl":"https:\/\/[^"]+"\})`/g)].map(m => JSON.parse(m[1]))
  expect(valores.length).toBeGreaterThan(0)
  for (const v of valores) {
    expect(new URL(v.logoUrl).pathname).toBe('/pase/logo.png')
    expect(new URL(v.heroUrl).pathname).toBe('/pase/hero.png')
    expect(new URL(v.logoUrl).origin).toBe(new URL(v.heroUrl).origin)
  }
})
