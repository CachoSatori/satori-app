// (10-nov) Las reglas de public/_redirects. Con destino «/index.html», Pages (wrangler pages dev, el mismo motor) las
// ignora por «bucle infinito» y, en las rutas sin comodín, REDIRIGE con 308 a «/»: /alta perdía la ruta y mostraba la
// portada (el alta de socios por QR no aparecía), igual /privacidad. Con destino «/» sirve index.html con 200 y la URL
// intacta (probado en local: las 9 rutas dan 200 sin avisos).
import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const REGLAS = readFileSync(new URL('../public/_redirects', import.meta.url), 'utf8')
  .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => l.split(/\s+/))

test('ninguna regla reescribe a /index.html (Pages la ignora y redirige con 308)', () => {
  for (const r of REGLAS) expect(r[1], r.join(' ')).not.toMatch(/index(\.html)?$/)
})

test('todas las rutas del sitio reescriben a «/» con 200', () => {
  const rutas = ['/r/*', '/c/*', '/p/*', '/k/*', '/s/*', '/w/*', '/b/*', '/alta', '/privacidad']
  for (const ruta of rutas) expect(REGLAS.find(r => r[0] === ruta), ruta).toEqual([ruta, '/', '200'])
})
