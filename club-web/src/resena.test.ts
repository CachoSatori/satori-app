// 158 (14-nov, firmado por el dueño) · Reseña de Google después del cupón: textos, link solo de Google (igual en la base,
// la app y club-web), qué vista toca y el sondeo cada ~20 s (máx. 10 min) mientras el cupón está vigente.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { TEXTOS } from './i18n'
import { RE_RESENA_GOOGLE, esUrlResena, marcarClicResena, rutaSondeo, sondearCupon, vistaDelCupon, type CuponEstado } from './resena'
import { RE_RESENA_GOOGLE as RE_APP } from '../../src/modules/club/resenaUrl'

const VALIDAS = [
  'https://maps.app.goo.gl/PruebaFicticia1',
  'https://g.page/r/PRUEBA-FICTICIA/review',
  'https://www.google.com/maps/place/Ficticio/@9.6,-85.1,17z',
  'https://google.com/maps?cid=123',
  'https://search.google.com/local/writereview?placeid=FICTICIO123',
]
const INVALIDAS = [
  'http://maps.app.goo.gl/PruebaFicticia1',
  'https://ejemplo.test/maps',
  'https://google.com.ejemplo.test/maps',
  'https://g.page.ejemplo.test/x',
  'https://google.com@ejemplo.test/maps',
  'https://google.com/mapsx',
  'https://maps.app.goo.gl/',
  'https://g.page/r/x y',
  'https://g.page/r/x"onclick',
  'javascript:alert(1)',
  'https://search.google.com/local/writereview',
  'https://g.page/' + 'a'.repeat(500),
]

test('textos que firmó el dueño (ES y EN), con «usted»', () => {
  expect(TEXTOS.es.resena_txt).toBe('Gracias por su visita. ¿Nos cuenta cómo le fue? Su reseña en Google ayuda a otros viajeros.')
  expect(TEXTOS.es.resena_boton).toBe('Escribir una reseña en Google')
  expect(TEXTOS.en.resena_txt).toBe('Thank you for visiting. How was it? Your Google review helps other travelers.')
  expect(TEXTOS.en.resena_boton).toBe('Write a Google review')
})

test('política de Google: el texto no ofrece nada a cambio ni pide solo buenas reseñas', () => {
  for (const s of [TEXTOS.es.resena_txt, TEXTOS.es.resena_boton, TEXTOS.en.resena_txt, TEXTOS.en.resena_boton]) {
    expect(s).not.toMatch(/descuento|regalo|premio|cr[eé]dito|estrellas|5|discount|gift|reward|credit|stars/i)
  }
})

test('solo acepta direcciones de Google', () => {
  for (const u of VALIDAS) expect(esUrlResena(u), u).toBe(true)
  for (const u of INVALIDAS) expect(esUrlResena(u), u.slice(0, 50)).toBe(false)
  expect(esUrlResena(null)).toBe(false)
})

test('la app y club-web usan la MISMA expresión', () => {
  expect(RE_APP.source).toBe(RE_RESENA_GOOGLE.source)
})

test('el CHECK de la migración 158 acepta y rechaza lo mismo que club-web', () => {
  const sql = readFileSync(join(__dirname, '../../supabase/migrations/158_club_resena_cupon.sql'), 'utf8')
  const m = /and resena_url ~ '([^']+)'/.exec(sql)
  expect(m, 'no encontré el CHECK en la 158').not.toBeNull()
  expect(sql).toMatch(/length\(resena_url\) <= 500/)
  const re = new RegExp(m![1].replace(/\[:space:\]/g, '\\s'))
  for (const u of [...VALIDAS, ...INVALIDAS]) expect(re.test(u) && u.length <= 500, u.slice(0, 50)).toBe(esUrlResena(u))
})

test('qué vista toca', () => {
  const url = VALIDAS[1]
  expect(vistaDelCupon({ estado: 'vigente', resena: null })).toBe('cupon')
  expect(vistaDelCupon({ estado: 'usado', resena: url })).toBe('gracias')
  expect(vistaDelCupon({ estado: 'usado', resena: null })).toBe('usado')            // > 7 días o local sin link
  expect(vistaDelCupon({ estado: 'usado' })).toBe('usado')                          // base vieja, sin la clave
  expect(vistaDelCupon({ estado: 'usado', resena: 'https://ejemplo.test/x' })).toBe('usado')   // nunca un link que no sea de Google
  expect(vistaDelCupon({ estado: 'vencido', resena: url })).toBe('vencido')
})

// ── sondeo ──
beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })
const vigente: CuponEstado = { estado: 'vigente', resena: null }

test('sondeo: cada 20 s; al usarse avisa UNA vez y se para', async () => {
  const consultar = vi.fn(async () => vigente)
  const alCambiar = vi.fn()
  sondearCupon({ consultar, alCambiar })
  await vi.advanceTimersByTimeAsync(19_999)
  expect(consultar).toHaveBeenCalledTimes(0)
  await vi.advanceTimersByTimeAsync(1)
  expect(consultar).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(20_000)
  expect(consultar).toHaveBeenCalledTimes(2)
  consultar.mockResolvedValue({ estado: 'usado', resena: VALIDAS[0] })
  await vi.advanceTimersByTimeAsync(20_000)
  expect(alCambiar).toHaveBeenCalledTimes(1)
  expect(alCambiar).toHaveBeenCalledWith({ estado: 'usado', resena: VALIDAS[0] })
  await vi.advanceTimersByTimeAsync(120_000)
  expect(consultar).toHaveBeenCalledTimes(3)
  expect(alCambiar).toHaveBeenCalledTimes(1)
})

test('sondeo: máximo 10 minutos (30 consultas) y después nada', async () => {
  const consultar = vi.fn(async () => vigente)
  sondearCupon({ consultar, alCambiar: vi.fn() })
  await vi.advanceTimersByTimeAsync(10 * 60_000)
  expect(consultar).toHaveBeenCalledTimes(30)
  await vi.advanceTimersByTimeAsync(30 * 60_000)
  expect(consultar).toHaveBeenCalledTimes(30)
})

test('sondeo: sin señal sigue intentando; con la pestaña oculta no consulta', async () => {
  let oculta = true
  const consultar = vi.fn(async () => null)
  sondearCupon({ consultar, alCambiar: vi.fn(), visible: () => !oculta })
  await vi.advanceTimersByTimeAsync(60_000)
  expect(consultar).toHaveBeenCalledTimes(0)
  oculta = false
  await vi.advanceTimersByTimeAsync(40_000)
  expect(consultar).toHaveBeenCalledTimes(2)
})

test('sondeo: la función que devuelve lo para', async () => {
  const consultar = vi.fn(async () => vigente)
  const parar = sondearCupon({ consultar, alCambiar: vi.fn() })
  await vi.advanceTimersByTimeAsync(20_000)
  parar()
  await vi.advanceTimersByTimeAsync(200_000)
  expect(consultar).toHaveBeenCalledTimes(1)
})

// Verificador, menor a: el sondeo va marcado para que la API lo cuente aparte del portal
test('el sondeo pide el cupón con ?sondeo=1 (clave de tope propia en la API)', () => {
  expect(rutaSondeo('ABCDEFGH23')).toBe('cupon/ABCDEFGH23?sondeo=1')
  const main = readFileSync(join(__dirname, 'main.ts'), 'utf8')
  expect(main).toContain('api<CuponVer>(rutaSondeo(codigo))')
})

// Verificador, menor b: la marca del clic nunca frena ni rompe la apertura de Google
test('marcarClicResena: POST a /api/cupon/:codigo/resena con keepalive, sin esperar y sin lanzar', async () => {
  const llamadas: [string, RequestInit | undefined][] = []
  let soltar: (r: Response) => void = () => undefined
  const lenta = ((u: string, i?: RequestInit) => { llamadas.push([u, i]); return new Promise<Response>(r => { soltar = r }) }) as typeof fetch
  expect(marcarClicResena('ABCDEFGH23', lenta)).toBeUndefined()   // vuelve en el acto, sin esperar la respuesta
  expect(llamadas).toEqual([['/api/cupon/ABCDEFGH23/resena', { method: 'POST', keepalive: true }]])
  soltar(new Response('{"error":"demasiados_pedidos"}', { status: 429 }))
  // sin señal (promesa rechazada) o fetch que lanza de una: nada se propaga. Un rechazo sin manejar hace que vitest
  // termine con «Errors 1 error» y salga 1 (así cae la mutación «sin .catch»).
  expect(() => marcarClicResena('ABCDEFGH23', (() => Promise.reject(new TypeError('red'))) as typeof fetch)).not.toThrow()
  expect(() => marcarClicResena('ABCDEFGH23', (() => { throw new TypeError('sin fetch') }) as typeof fetch)).not.toThrow()
  for (let i = 0; i < 5; i++) await Promise.resolve()   // (relojes falsos en este archivo: microtareas, no setTimeout)
})

test('el botón de la reseña es un link (<a href>) y el clic solo llama a marcarClicResena', () => {
  const main = readFileSync(join(__dirname, 'main.ts'), 'utf8')
  expect(main).toMatch(/h\('a', \{ class: 'btn', href: resena, target: '_blank'/)
  expect(main).toContain("boton.addEventListener('click', () => marcarClicResena(codigo))")
  const gracias = main.slice(main.indexOf('function vistaGracias'), main.indexOf('function formOptin'))
  expect(gracias.length).toBeGreaterThan(100)
  expect(gracias).not.toMatch(/preventDefault|await /)
})
