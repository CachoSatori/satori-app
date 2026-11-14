// @vitest-environment happy-dom
// 158 · «Locales» (owner): el link de reseña de Google por local. Solo direcciones de Google; vacío = sin link.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const api = vi.hoisted(() => ({
  guardados: {} as Record<string, string | null>,
  set: vi.fn(async (_id: string, _url: string | null) => {}),
}))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('../../shared/api/club', async orig => ({
  ...(await orig<typeof import('../../shared/api/club')>()),
  getResenasLocales: async () => api.guardados,
  setResenaUrl: api.set,
}))

import ResenaLocales from './ResenaLocales'

const LOCALES = [{ id: 'local-a', nombre: 'Local A', activo: true }, { id: 'local-b', nombre: 'Local B', activo: false }]
const campo = (n: string) => screen.findByLabelText(`Link de reseña de Google de ${n}`) as Promise<HTMLInputElement>
const guardarDe = (input: HTMLInputElement) => input.parentElement!.querySelector('button') as HTMLButtonElement

describe('ResenaLocales', () => {
  beforeEach(() => { api.set.mockClear(); api.guardados = { 'local-a': 'https://g.page/r/FICTICIO-A/review', 'local-b': null } })

  it('muestra el link guardado de cada local', async () => {
    render(<ResenaLocales locales={LOCALES} />)
    expect((await campo('Local A')).value).toBe('https://g.page/r/FICTICIO-A/review')
    expect((await campo('Local B')).value).toBe('')
  })

  it('guarda un link de Google (sin espacios alrededor) solo en ese local', async () => {
    render(<ResenaLocales locales={LOCALES} />)
    const b = await campo('Local B')
    fireEvent.change(b, { target: { value: '  https://maps.app.goo.gl/FicticioB  ' } })
    fireEvent.click(guardarDe(b))
    await waitFor(() => expect(api.set).toHaveBeenCalledWith('local-b', 'https://maps.app.goo.gl/FicticioB'))
    expect(await screen.findByText('Local B: link de reseña guardado.')).toBeTruthy()
  })

  it('NO guarda un link que no es de Google: avisa y no llama a la base', async () => {
    render(<ResenaLocales locales={LOCALES} />)
    const b = await campo('Local B')
    for (const malo of ['https://ejemplo.test/review', 'http://g.page/r/x', 'https://google.com.ejemplo.test/maps']) {
      fireEvent.change(b, { target: { value: malo } })
      fireEvent.click(guardarDe(b))
      expect(await screen.findByText(/El link tiene que ser de Google/)).toBeTruthy()
    }
    expect(api.set).not.toHaveBeenCalled()
  })

  it('vacío = borrar el link (null)', async () => {
    render(<ResenaLocales locales={LOCALES} />)
    const a = await campo('Local A')
    fireEvent.change(a, { target: { value: '' } })
    fireEvent.click(guardarDe(a))
    await waitFor(() => expect(api.set).toHaveBeenCalledWith('local-a', null))
    expect(await screen.findByText('Local A: sin link de reseña.')).toBeTruthy()
  })

  it('sin cambios, «Guardar» queda apagado', async () => {
    render(<ResenaLocales locales={LOCALES} />)
    expect(guardarDe(await campo('Local A')).disabled).toBe(true)
  })
})
