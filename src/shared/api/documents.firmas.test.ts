// (16-nov) Firmas de las fotos de facturas: el 15/11 un iPhone pidió ~980 firmas en 7 s (un FacturaVerify por fila) y
// Storage respondió 429/544 a 259. signedUrl ahora guarda la firma, junta pedidos de la misma foto y limita los en vuelo.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const H = vi.hoisted(() => {
  const st = { enVuelo: 0, max: 0, llamadas: [] as string[], pendientes: [] as Array<() => void> }
  const createSignedUrl = (path: string) => {
    st.llamadas.push(path); st.enVuelo++; st.max = Math.max(st.max, st.enVuelo)
    return new Promise<{ data: { signedUrl: string } | null; error: null }>(listo => {
      st.pendientes.push(() => { st.enVuelo--; listo({ data: { signedUrl: `https://firmada.test/${path}` }, error: null }) })
    })
  }
  return { st, cliente: { storage: { from: () => ({ createSignedUrl }) } } }
})
vi.mock('./supabase', () => ({ supabase: H.cliente }))
vi.mock('./cash', () => ({ createDayMovement: vi.fn() }))

import { signedUrl, MAX_FIRMAS, _olvidarFirmas } from './documents'

const tic = () => new Promise(r => setTimeout(r, 0))
async function soltarTodo() {
  for (let i = 0; i < 200 && (H.st.pendientes.length || H.st.enVuelo); i++) { H.st.pendientes.splice(0).forEach(f => f()); await tic() }
}

describe('signedUrl (bucket documents)', () => {
  beforeEach(() => { _olvidarFirmas(); Object.assign(H.st, { enVuelo: 0, max: 0, llamadas: [], pendientes: [] }) })

  it(`200 fotos a la vez: nunca más de ${MAX_FIRMAS} pedidos en vuelo y todas reciben su firma`, async () => {
    const ps = Array.from({ length: 200 }, (_, i) => signedUrl(`2026-11-01/f${i}.jpg`))
    await tic()
    expect(H.st.enVuelo).toBe(MAX_FIRMAS)
    await soltarTodo()
    const urls = await Promise.all(ps)
    expect(H.st.max).toBe(MAX_FIRMAS)
    expect(H.st.llamadas).toHaveLength(200)
    expect(urls[57]).toBe('https://firmada.test/2026-11-01/f57.jpg')
  })

  it('la misma foto pedida por varias filas a la vez = un solo pedido; después sale de la memoria', async () => {
    const ps = [signedUrl('a.jpg'), signedUrl('a.jpg'), signedUrl('a.jpg')]
    await tic(); await soltarTodo()
    expect(new Set(await Promise.all(ps)).size).toBe(1)
    expect(H.st.llamadas).toEqual(['a.jpg'])
    expect(await signedUrl('a.jpg')).toBe('https://firmada.test/a.jpg')
    expect(H.st.llamadas).toEqual(['a.jpg'])
  })

  it('una firma vencida (más de ~55 min) se vuelve a pedir', async () => {
    const ahora = Date.now()
    const reloj = vi.spyOn(Date, 'now').mockReturnValue(ahora)
    const p = signedUrl('b.jpg'); await tic(); await soltarTodo(); await p
    reloj.mockReturnValue(ahora + 56 * 60_000)
    const q = signedUrl('b.jpg'); await tic(); await soltarTodo(); await q
    expect(H.st.llamadas).toEqual(['b.jpg', 'b.jpg'])
    reloj.mockRestore()
  })
})
