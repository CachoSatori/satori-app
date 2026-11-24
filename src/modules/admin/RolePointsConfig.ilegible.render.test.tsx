// @vitest-environment happy-dom
// Admin → «Puntos por rol»: un cuadro con texto que no es número («5-», «0-450») daba `value` "" y
// `parseInt('') || 0` guardaba 0 puntos (el rol quedaba fuera del reparto de propinas sin aviso). Ahora aviso con el
// rol y no guarda. Cuadros tipeados con userEvent sobre la imitación de Chrome (R29). Datos ficticios.
import { describe, expect, it, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RoleTipPoints } from '../../shared/types/database'
import { imitarInputNumeroDeChrome, textoVisible } from '../tips/inputNumeroComoChrome.testutil'

const H = vi.hoisted(() => ({ upsert: vi.fn<(r: string, p: number, x: boolean) => Promise<void>>(async () => {}) }))
vi.mock('../../shared/api/admin', () => ({ upsertRoleTipConfig: H.upsert }))

import RolePointsConfig from './RolePointsConfig'

const PUNTOS: RoleTipPoints[] = [
  { role: 'salonero', points: 10, recibe_propina: true },
  { role: 'barman', points: 0, recibe_propina: true },
]

let sacar: () => void
beforeAll(() => { sacar = imitarInputNumeroDeChrome() })
afterAll(() => sacar())
beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { cleanup() })

const pts = (rol: string) => screen.getByLabelText(`Puntos / hora: ${rol}`) as HTMLInputElement
const guardar = () => screen.getByRole('button', { name: 'Guardar cambios' }) as HTMLButtonElement
const aviso = () => screen.queryByRole('alert')?.textContent ?? null
const abrir = () => render(<RolePointsConfig rolePoints={PUNTOS} onRefresh={async () => {}} />)

describe('Puntos por rol · puntos ilegibles no se guardan como 0', () => {
  it('«5-» → aviso con el rol, botón apagado, no guarda', async () => {
    const u = userEvent.setup()
    abrir()
    await u.type(pts('Salonero'), '5-', { initialSelectionStart: 0, initialSelectionEnd: 2 })
    expect(textoVisible(pts('Salonero'))).toBe('5-')
    expect(aviso()).toContain('«Puntos / hora · Salonero»: el monto no es un número')
    expect(guardar().disabled).toBe(true)
    await u.click(guardar())
    expect(H.upsert).not.toHaveBeenCalled()
  })

  it('«0-450» → aviso; borrarlo (de "" a "") destraba y vacío guarda 0 como antes', async () => {
    const u = userEvent.setup()
    abrir()
    expect(textoVisible(pts('Barman'))).toBe('0')
    await u.type(pts('Barman'), '-450')
    expect(textoVisible(pts('Barman'))).toBe('0-450')
    expect(aviso()).toContain('«Puntos / hora · Barman»')
    expect(guardar().disabled).toBe(true)
    await u.clear(pts('Barman'))
    expect(aviso()).toBeNull()
    await u.click(guardar())
    await waitFor(() => expect(H.upsert).toHaveBeenCalledWith('barman', 0, true))
  })

  it('negativo legible («-3») → aviso, no guarda', async () => {
    const u = userEvent.setup()
    abrir()
    await u.type(pts('Salonero'), '-3', { initialSelectionStart: 0, initialSelectionEnd: 2 })
    expect(aviso()).toContain('«Puntos / hora · Salonero»: el monto no puede ser negativo')
    expect(guardar().disabled).toBe(true)
  })

  it('apagar «Recibe propina» descarta lo ilegible (vuelven los puntos guardados) y destraba', async () => {
    const u = userEvent.setup()
    abrir()
    await u.type(pts('Salonero'), '5-', { initialSelectionStart: 0, initialSelectionEnd: 2 })
    expect(guardar().disabled).toBe(true)
    await u.click(screen.getByLabelText('Recibe propina: Salonero'))
    expect(aviso()).toBeNull()
    await u.click(guardar())
    await waitFor(() => expect(H.upsert).toHaveBeenCalledWith('salonero', 10, false))
  })

  it('número válido se guarda igual que antes', async () => {
    const u = userEvent.setup()
    abrir()
    await u.type(pts('Salonero'), '12', { initialSelectionStart: 0, initialSelectionEnd: 2 })
    await u.click(guardar())
    await waitFor(() => expect(H.upsert).toHaveBeenCalledWith('salonero', 12, true))
  })
})
