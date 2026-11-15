// @vitest-environment happy-dom
// Mig 169 · conPremioDeReto: el paso del reto después de registrar la visita. Llama a club_reto_en_visita con la visita y
// el local; no llama sin visita (ya usó hoy) ni si la visita ya trae el reto (reescaneo); si falla, la caja sigue igual.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({ supabase: { rpc } }))

import { conPremioDeReto, elegirLocal, type QueAplicar } from './club'

const base: QueAplicar = {
  visita_id: 'v1', socio: 'Socio Ficticio', estado: 'aplica', porcentaje: 10, cortesias: [],
  texto: '10 % LC', avisos: ['Aviso de la visita.'], articulo_lc: '856', repetida: false, promo: 'Local Club',
}

describe('conPremioDeReto (mig 169)', () => {
  beforeEach(() => { rpc.mockReset(); elegirLocal('loc-a') })

  it('llama con la visita y el local, y suma los avisos nuevos sin repetir', async () => {
    rpc.mockResolvedValue({ data: { ...base, avisos: ['Aviso de la visita.', 'Premio del reto: va una sola vez.'],
      reto: { estado: 'ofrecida', nombre: 'Reto', cortesia: 'Postre', codigo: 'P1' } }, error: null })
    const r = await conPremioDeReto({ ...base, repetida: true })
    expect(rpc).toHaveBeenCalledWith('club_reto_en_visita', { p_visita: 'v1', p_location: 'loc-a' })
    expect(r.reto?.estado).toBe('ofrecida')
    expect(r.repetida).toBe(true)
    expect(r.avisos).toEqual(['Aviso de la visita.', 'Premio del reto: va una sola vez.'])
  })

  it('sin visita (ya usó hoy) o con el reto ya resuelto: no llama', async () => {
    expect(await conPremioDeReto({ ...base, visita_id: null })).toEqual({ ...base, visita_id: null })
    const conReto = { ...base, reto: { estado: 'guardada' as const, nombre: 'Reto' } }
    expect(await conPremioDeReto(conReto)).toBe(conReto)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('error de la base, sin red o respuesta rara: devuelve lo que ya tenía (el premio queda guardado)', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'function club_reto_en_visita does not exist' } })
    expect(await conPremioDeReto(base)).toBe(base)
    rpc.mockRejectedValueOnce(new Error('Failed to fetch'))
    expect(await conPremioDeReto(base)).toBe(base)
    rpc.mockResolvedValueOnce({ data: 'x', error: null })
    expect(await conPremioDeReto(base)).toBe(base)
  })
})
