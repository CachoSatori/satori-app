// @vitest-environment happy-dom
// D6 A (14-nov, firmada) · /alta: «mayor de 18» obligatorio y cumpleaños día/mes opcional con permiso explícito.
// Se monta la página real (main.ts) con Turnstile y la API simulados; se mira qué manda a /api/alta.
import { test, expect, vi, beforeAll, beforeEach } from 'vitest'
import { validarCumple, diaMesValido } from './cumple'
import { TEXTOS } from './i18n'

const t = TEXTOS.es
const llamadas: Array<{ url: string; body: Record<string, unknown> | null }> = []

beforeAll(async () => {
  localStorage.setItem('club.lang', 'es')
  document.body.innerHTML = '<main id="app"></main><p id="aviso"></p>'
  history.replaceState(null, '', '/alta')
  ;(window as unknown as { turnstile: unknown }).turnstile = {
    render: (_el: HTMLElement, o: { callback: (v: string) => void }) => { o.callback('token-de-prueba'); return 'w1' },
    reset: () => {},
  }
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    llamadas.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null })
    if (String(url).endsWith('/api/locales')) return new Response(JSON.stringify({ data: [] }), { status: 200 })
    return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 })
  }) as unknown as typeof fetch
  await import('./main')
  await vi.waitFor(() => expect(document.getElementById('a-mayor')).toBeTruthy())
  await new Promise(r => setTimeout(r, 0))   // Turnstile (simulado) entrega el token
})

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
function llenar({ mayor = true, dia = '', mes = '', permiso = false } = {}) {
  $<HTMLInputElement>('a-nombre').value = 'Ana Prueba'
  $<HTMLInputElement>('a-wa').value = '80000020'
  $<HTMLInputElement>('a-ok').checked = true
  $<HTMLInputElement>('a-mayor').checked = mayor
  $<HTMLSelectElement>('a-cdia').value = dia
  $<HTMLSelectElement>('a-cmes').value = mes
  $<HTMLInputElement>('a-cpermiso').checked = permiso
}
const enviar = () => document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
const altas = () => llamadas.filter(l => l.url.endsWith('/api/alta'))

beforeEach(() => { llamadas.length = 0; document.querySelectorAll('.aviso.err').forEach(e => e.remove()) })

test('la página muestra la casilla de edad, el cumpleaños (día, 12 meses) y su permiso', () => {
  expect(document.body.textContent).toContain(t.alta_mayor)
  expect(document.body.textContent).toContain(t.alta_cumple)
  expect(document.body.textContent).toContain(t.alta_cumple_permiso)
  expect($<HTMLSelectElement>('a-cdia').options.length).toBe(32)   // «—» + 1..31
  expect($<HTMLSelectElement>('a-cmes').options.length).toBe(13)   // «—» + 12 meses
})

test('sin «mayor de 18» no se envía y avisa', async () => {
  llenar({ mayor: false })
  enviar()
  await Promise.resolve()
  expect(altas()).toHaveLength(0)
  expect(document.body.textContent).toContain(t.alta_mayor_falta)
})

test('cumpleaños sin permiso, o fecha inexistente: no se envía', async () => {
  llenar({ dia: '3', mes: '4', permiso: false }); enviar(); await Promise.resolve()
  expect(altas()).toHaveLength(0)
  expect(document.body.textContent).toContain(t.alta_cumple_falta)
  llenar({ dia: '31', mes: '4', permiso: true }); enviar(); await Promise.resolve()
  expect(altas()).toHaveLength(0)
  expect(document.body.textContent).toContain(t.alta_cumple_invalido)
})

test('con edad y sin cumpleaños: manda mayor_edad true y ninguna clave de cumpleaños', async () => {
  llenar()
  enviar()
  await vi.waitFor(() => expect(altas()).toHaveLength(1))
  const b = altas()[0].body!
  expect(b.mayor_edad).toBe(true)
  expect(b.acepto).toBe('v1.3')
  expect(Object.keys(b).filter(k => k.startsWith('cumple'))).toEqual([])
})

test('con cumpleaños 29-feb y permiso: lo manda como números, con permiso true', async () => {
  document.body.innerHTML = '<main id="app"></main><p id="aviso"></p>'
  vi.resetModules(); await import('./main')
  await vi.waitFor(() => expect(document.getElementById('a-mayor')).toBeTruthy())
  await new Promise(r => setTimeout(r, 0))   // Turnstile (simulado) entrega el token
  llamadas.length = 0
  llenar({ dia: '29', mes: '2', permiso: true })
  enviar()
  await vi.waitFor(() => expect(altas()).toHaveLength(1))
  expect(altas()[0].body).toMatchObject({ mayor_edad: true, cumple_dia: 29, cumple_mes: 2, cumple_permiso: true })
})

test('validarCumple / diaMesValido: vacío = sin cumpleaños; 29-feb sí; 30-feb, 31-abr y mes 13 no', () => {
  expect(validarCumple('', '', false)).toEqual({ ok: true, cumple: null })
  expect(validarCumple('29', '2', true)).toEqual({ ok: true, cumple: { dia: 29, mes: 2 } })
  expect(validarCumple('3', '', true)).toEqual({ ok: false, error: 'falta' })
  expect(validarCumple('', '', true)).toEqual({ ok: false, error: 'falta' })
  expect(validarCumple('3', '4', false)).toEqual({ ok: false, error: 'falta' })
  expect(validarCumple('30', '2', true)).toEqual({ ok: false, error: 'invalido' })
  expect(validarCumple('31', '4', true)).toEqual({ ok: false, error: 'invalido' })
  expect(validarCumple('1', '13', true)).toEqual({ ok: false, error: 'invalido' })
  expect([diaMesValido(31, 12), diaMesValido(31, 11), diaMesValido(0, 1), diaMesValido(1.5, 1)]).toEqual([true, false, false, false])
})
