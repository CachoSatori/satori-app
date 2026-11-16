// Revisión de seguridad #214, hallazgo 2: el token del portal sale de la barra de direcciones (como /b/).
import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { crearTokenPortal, CLAVE_TOKEN_PORTAL, type Almacen } from './portalToken'

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
