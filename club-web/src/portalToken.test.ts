// Revisión de seguridad #214, hallazgo 2: el token del portal sale de la barra de direcciones (como /b/).
import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { crearTokenPortal, crearTokenPase, CLAVE_TOKEN_PORTAL, CLAVE_TOKEN_PASE, type Almacen } from './portalToken'

function almacen(): Almacen & { m: Map<string, string> } {
  const m = new Map<string, string>()
  return { m, getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v) } }
}
function historial() {
  const urls: string[] = []
  return { urls, replaceState: (_d: unknown, _u: string, url?: string | URL | null) => { urls.push(String(url)) } }
}
const TOK = 'tokficticio0123456789abcdef'

test('/p/{token}: devuelve el token y lo saca de la barra (replaceState a /p/)', () => {
  const al = almacen(); const hi = historial()
  const tp = crearTokenPortal(() => al)
  expect(tp(`/p/${TOK.toUpperCase()}/`, hi)).toBe(TOK)
  expect(hi.urls).toEqual(['/p/'])
  expect(hi.urls.join()).not.toContain(TOK)
  expect(al.m.get(CLAVE_TOKEN_PORTAL)).toBe(TOK)
})

test('después del replaceState (/p/): cambiar de idioma vuelve a pintar el portal con el token en memoria', () => {
  const tp = crearTokenPortal(() => null)   // sin storage
  const hi = historial()
  tp(`/p/${TOK}`, hi)
  expect(tp('/p/', hi)).toBe(TOK)
  expect(hi.urls).toEqual(['/p/'])
})

test('recargar /p/ en la misma pestaña: el token sale de sessionStorage; sin él, null (inicio)', () => {
  const al = almacen()
  crearTokenPortal(() => al)(`/p/${TOK}`, historial())
  expect(crearTokenPortal(() => al)('/p/', historial())).toBe(TOK)          // recarga: memoria nueva, mismo storage
  expect(crearTokenPortal(() => almacen())('/p/', historial())).toBeNull()  // otra pestaña
  const roto: Almacen = { getItem: () => { throw new Error('x') }, setItem: () => { throw new Error('x') } }
  expect(crearTokenPortal(() => roto)('/p/', historial())).toBeNull()
  expect(crearTokenPortal(() => roto)(`/p/${TOK}`, historial())).toBe(TOK)
})

test('otras rutas no son el portal ni tocan la barra', () => {
  const hi = historial(); const tp = crearTokenPortal(() => almacen())
  for (const r of ['/', '/r/ABC', '/w/xyz', '/b/abc', '/p/a/b', '/alta', '/px/abc']) expect(tp(r, hi)).toBeNull()
  expect(hi.urls).toEqual([])
})

test('el portal usa tokenPortal ANTES de pintar (main.ts), así el token no queda en la barra', () => {
  const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8')
  const ruta = main.slice(main.indexOf('function ruta()'), main.indexOf('document.querySelectorAll<HTMLButtonElement>(\'[data-lang]\').forEach(b => b.addEventListener'))
  expect(ruta).toMatch(/const tokP = tokenPortal\(location\.pathname, history\)\n\s+if \(tokP\) return paginaPortal\(tokP\)/)
  expect(ruta.indexOf('tokenPortal(')).toBeLessThan(ruta.indexOf("tipo === 'r'"))
})

// (16-nov) /w/{token}: el token del botón «Canjear» del pase de Wallet también sale de la barra.
const TOKW = 'ab'.repeat(32)
test('/w/{token}: devuelve el token, lo saca de la barra (replaceState a /w/) y lo guarda aparte del portal', () => {
  const al = almacen(); const hi = historial()
  const tw = crearTokenPase(() => al)
  expect(tw(`/w/${TOKW.toUpperCase()}`, hi)).toBe(TOKW)
  expect(hi.urls).toEqual(['/w/'])
  expect(hi.urls.join()).not.toContain(TOKW)
  expect(al.m.get(CLAVE_TOKEN_PASE)).toBe(TOKW)
  expect(al.m.has(CLAVE_TOKEN_PORTAL)).toBe(false)
  expect(tw('/w/', hi)).toBe(TOKW)                                   // cambiar de idioma: desde memoria
  expect(crearTokenPase(() => al)('/w/', historial())).toBe(TOKW)    // recargar: desde sessionStorage
  expect(crearTokenPase(() => almacen())('/w/', historial())).toBeNull()
})

test('el pase no toma rutas ajenas ni el portal toma /w/', () => {
  const hi = historial(); const tw = crearTokenPase(() => almacen())
  for (const r of ['/', '/p/abc', '/p/', '/b/abc', '/w/a/b', '/wx/abc', '/alta']) expect(tw(r, hi)).toBeNull()
  expect(hi.urls).toEqual([])
  expect(crearTokenPortal(() => almacen())(`/w/${TOKW}`, hi)).toBeNull()
})

test('main.ts limpia /w/ ANTES de pintar la página del pase', () => {
  const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8')
  const ruta = main.slice(main.indexOf('function ruta()'), main.indexOf('document.querySelectorAll<HTMLButtonElement>(\'[data-lang]\').forEach(b => b.addEventListener'))
  expect(ruta).toMatch(/const tokW = tokenPase\(location\.pathname, history\)\n\s+if \(tokW\) return paginaPase\(tokW\)/)
  expect(ruta.indexOf('tokenPase(')).toBeLessThan(ruta.indexOf('location.pathname.match('))
})
