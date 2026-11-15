// @vitest-environment happy-dom
// 167 (14-nov, decisión 3 del dueño) · Reseña de Google a socios cada N visitas, en «Mi Club»: la tarjeta, su cierre, las
// marcas (mostrada · cerrada · clic) y que el teléfono no guarda nada (cada N visitas y los 90 días los decide la base:
// scripts/sql/167_pruebas.sql, casos 1–16).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { TEXTOS } from './i18n'
import { marcarResenaSocio, resenaSocioValida, tarjetaResenaSocio, type AccionResena } from './resenaSocio'

const URL_OK = 'https://g.page/r/PRUEBA-FICTICIA-167/review'
const T = { titulo: TEXTOS.es.resena_socio_titulo, txt: TEXTOS.es.resena_socio_txt, boton: TEXTOS.es.resena_boton,
            cerrar: TEXTOS.es.resena_socio_cerrar }

afterEach(() => { document.body.replaceChildren(); vi.useRealTimers() })

function armar(resena: unknown) {
  const marcas: AccionResena[] = []
  const el = tarjetaResenaSocio(resena, T, a => marcas.push(a))
  if (el) document.body.append(el)
  return { el, marcas }
}

test('167: sin reseña (no toca), con un link que no es de Google o con basura → no hay tarjeta ni marca', () => {
  for (const r of [null, undefined, {}, { url: null }, { url: 'https://ejemplo.test/x' }, { url: 'javascript:alert(1)' },
                   { url: 'http://g.page/r/x' }, 'https://g.page/r/x', 42]) {
    const { el, marcas } = armar(r)
    expect(el).toBeNull()
    expect(marcas).toEqual([])
  }
  expect(resenaSocioValida({ url: URL_OK, local: null })).toBe(true)
})

test('167: con reseña → «¿Nos cuenta cómo le fue?», el texto, el local y el botón a Google (pestaña nueva); marca «mostrada» una vez', () => {
  const { el, marcas } = armar({ url: URL_OK, local: 'Local Ficticio' })
  expect(el).not.toBeNull()
  expect(el!.querySelector('h2')!.textContent).toBe('¿Nos cuenta cómo le fue?')
  expect(el!.textContent).toContain(TEXTOS.es.resena_socio_txt)
  expect(el!.textContent).toContain('Local Ficticio')
  const a = el!.querySelector('a.btn') as HTMLAnchorElement
  expect(a.getAttribute('href')).toBe(URL_OK)
  expect(a.getAttribute('target')).toBe('_blank')
  expect(a.getAttribute('rel')).toBe('noopener noreferrer')
  expect(a.textContent).toBe('Escribir una reseña en Google')
  expect(marcas).toEqual(['mostrada'])
  // sin premio: nada de descuentos, créditos ni cortesías en la tarjeta (política de Google)
  expect(el!.textContent).not.toMatch(/descuento|crédito|cortes[ií]a|premio|gratis|%/i)
})

test('167: «Cerrar» saca la tarjeta y marca «cerrada» (no «clic»)', () => {
  const { el, marcas } = armar({ url: URL_OK, local: null })
  const b = el!.querySelector('button.cerrar') as HTMLButtonElement
  expect(b.getAttribute('aria-label')).toBe('Cerrar')
  b.click()
  expect(document.body.contains(el)).toBe(false)
  expect(marcas).toEqual(['mostrada', 'cerrada'])
})

test('167: tocar «Escribir una reseña en Google» marca «clic» y después saca la tarjeta (sin cortar la navegación)', () => {
  vi.useFakeTimers()
  const { el, marcas } = armar({ url: URL_OK, local: null })
  const a = el!.querySelector('a.btn') as HTMLAnchorElement
  a.addEventListener('click', e => e.preventDefault())   // happy-dom: que no navegue
  a.click()
  expect(marcas).toEqual(['mostrada', 'clic'])
  expect(document.body.contains(el)).toBe(true)   // en el mismo clic sigue (el navegador abre la pestaña)
  vi.runAllTimers()
  expect(document.body.contains(el)).toBe(false)
})

test('167: cerrada, no vuelve hasta que la base la mande de nuevo (el teléfono no guarda nada: 90 días = la base)', () => {
  const stores = () => [localStorage.length, sessionStorage.length, document.cookie]
  const antes = stores()
  const uno = armar({ url: URL_OK, local: null })
  ;(uno.el!.querySelector('button.cerrar') as HTMLButtonElement).click()
  // próxima carga del portal: la base ya no la devuelve (casos 6 y 7 de 167_pruebas.sql) → no hay tarjeta
  const dos = armar(null)
  expect(dos.el).toBeNull()
  expect(dos.marcas).toEqual([])
  // y cuando vuelve a tocar (caso 8), se muestra de nuevo con lo que diga la base
  const tres = armar({ url: URL_OK, local: null })
  expect(tres.el).not.toBeNull()
  expect(stores()).toEqual(antes)
})

test('167: marcarResenaSocio hace POST /api/portal/:token/resena {accion} y nunca lanza ni espera', async () => {
  const llamadas: Array<[string, RequestInit | undefined]> = []
  const f = (async (u: string, i?: RequestInit) => { llamadas.push([u, i]); return new Response('{}') }) as unknown as typeof fetch
  const tok = 'a'.repeat(64)
  expect(marcarResenaSocio(tok, 'cerrada', f)).toBeUndefined()
  expect(llamadas[0][0]).toBe(`/api/portal/${tok}/resena`)
  expect(llamadas[0][1]!.method).toBe('POST')
  expect(llamadas[0][1]!.keepalive).toBe(true)
  expect(JSON.parse(String(llamadas[0][1]!.body))).toEqual({ accion: 'cerrada' })
  const rechaza = (() => Promise.reject(new Error('sin señal'))) as unknown as typeof fetch
  const lanza = (() => { throw new Error('boom') }) as unknown as typeof fetch
  expect(() => marcarResenaSocio(tok, 'clic', rechaza)).not.toThrow()
  expect(() => marcarResenaSocio(tok, 'clic', lanza)).not.toThrow()
  await new Promise(r => setTimeout(r, 0))
})

test('167: textos en ES y EN; el botón es el mismo de la 158', () => {
  expect(TEXTOS.es.resena_socio_titulo).toBe('¿Nos cuenta cómo le fue?')
  for (const k of ['resena_socio_titulo', 'resena_socio_txt', 'resena_socio_cerrar', 'resena_boton'] as const) {
    expect(TEXTOS.en[k]).toBeTruthy()
    expect(TEXTOS.en[k]).not.toBe(TEXTOS.es[k])
  }
})

test('167: el portal la pone solo en «Mi Club» del socio ACTIVO y con lo que devuelve club_portal (`resena`)', () => {
  const main = readFileSync(join(__dirname, 'main.ts'), 'utf8')
  expect(main).toMatch(/function tarjetaResena\(token: string, p: Portal\): HTMLElement \| null \{\n\s+if \(p\.socio\?\.estado !== 'activo'\) return null/)
  expect(main).toMatch(/pestanas\(p\.socio \? \[tarjetaResena\(token, p\), seccionSocio\(token, p\.socio\)\]/)
  expect(main).toMatch(/tarjetaResenaSocio\(p\.resena,/)
})
