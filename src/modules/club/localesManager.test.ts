// 170: el selector de local del Club le ofrece al manager solo sus locales (mis_locales, 091); los demás roles, igual.
import { describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
const select = vi.fn()
vi.mock('../../shared/api/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({ select: () => ({ order: () => select() }) }),
  },
}))

import { asegurarLocalParaRol, elegirLocal, getLocalesClubParaRol, localActual, localesParaRol, type LocalClub } from '../../shared/api/club'

const A: LocalClub = { id: 'local-a', nombre: 'Local A', activo: true }
const B: LocalClub = { id: 'local-b', nombre: 'Local B', activo: true }
const C: LocalClub = { id: 'local-c', nombre: 'Local C', activo: false }

describe('localesParaRol', () => {
  it('manager: solo los de mis_locales', () => {
    expect(localesParaRol([A, B, C], 'manager', ['local-b'])).toEqual([B])
    expect(localesParaRol([A, B, C], 'manager', ['local-a', 'local-c'])).toEqual([A, C])
  })
  it('manager sin locales (o sin respuesta): ninguno', () => {
    expect(localesParaRol([A, B], 'manager', [])).toEqual([])
    expect(localesParaRol([A, B], 'manager', null)).toEqual([])
  })
  it('owner, contador, cajero y sin rol: igual que antes (todos)', () => {
    for (const rol of ['owner', 'contador', 'cajero', 'salonero', null, undefined]) {
      expect(localesParaRol([A, B, C], rol, ['local-a'])).toEqual([A, B, C])
    }
  })
})

describe('getLocalesClubParaRol', () => {
  const filas = { data: [A, B].map(l => ({ location_id: l.id, nombre: l.nombre, club_activo: l.activo })), error: null }
  it('manager: pide mis_locales y filtra', async () => {
    rpc.mockReset(); select.mockResolvedValue(filas); rpc.mockResolvedValue({ data: ['local-a'], error: null })
    expect(await getLocalesClubParaRol('manager')).toEqual([A])
    expect(rpc).toHaveBeenCalledWith('mis_locales', {})
  })
  it('owner: no pide mis_locales y ve todos', async () => {
    rpc.mockReset(); select.mockResolvedValue(filas)
    expect(await getLocalesClubParaRol('owner')).toEqual([A, B])
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('asegurarLocalParaRol (Inicio)', () => {
  const filas = { data: [A, B].map(l => ({ location_id: l.id, nombre: l.nombre, club_activo: l.activo })), error: null }
  it('manager con un local ajeno recordado: pasa a uno suyo', async () => {
    rpc.mockReset(); select.mockResolvedValue(filas); rpc.mockResolvedValue({ data: ['local-b'], error: null })
    elegirLocal('local-a')
    await asegurarLocalParaRol('manager')
    expect(localActual()).toBe('local-b')
  })
  it('manager con su local recordado: no lo cambia', async () => {
    rpc.mockReset(); select.mockResolvedValue(filas); rpc.mockResolvedValue({ data: ['local-a', 'local-b'], error: null })
    elegirLocal('local-a')
    await asegurarLocalParaRol('manager')
    expect(localActual()).toBe('local-a')
  })
  it('owner: no consulta ni cambia nada', async () => {
    rpc.mockReset(); select.mockReset()
    elegirLocal('local-a')
    await asegurarLocalParaRol('owner')
    expect(localActual()).toBe('local-a')
    expect(rpc).not.toHaveBeenCalled(); expect(select).not.toHaveBeenCalled()
  })
})
