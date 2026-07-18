// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { RoleTipPoints } from '../../shared/types/database'

// Mock de la API: capturamos el upsert para verificar que el toggle persiste.
const upsert = vi.fn(async (_role?: string, _points?: number, _recibe?: boolean) => {})
vi.mock('../../shared/api/admin', () => ({
  upsertRoleTipConfig: (role: string, points: number, recibe: boolean) => upsert(role, points, recibe),
}))

import RolePointsConfig from './RolePointsConfig'

const rolePoints: RoleTipPoints[] = [
  { role: 'salonero', points: 10, recibe_propina: true },
  { role: 'manager',  points: 12, recibe_propina: true },
]

function renderCfg() {
  const onRefresh = vi.fn(async () => {})
  return { onRefresh, ...render(<RolePointsConfig rolePoints={rolePoints} onRefresh={onRefresh} />) }
}

describe('RolePointsConfig · toggle "Recibe propina"', () => {
  it('togglear MANAGER a No y guardar → persiste upsert(role, points, false)', async () => {
    upsert.mockClear()
    const { onRefresh } = renderCfg()

    // Estado inicial: manager en "Sí"
    const mgr = screen.getByLabelText('Recibe propina: Encargado') as HTMLInputElement
    expect(mgr.checked).toBe(true)

    // Apagar el flag del manager
    fireEvent.click(mgr)
    expect(mgr.checked).toBe(false)

    // Guardar
    fireEvent.click(screen.getByText('Guardar cambios'))
    await waitFor(() => expect(upsert).toHaveBeenCalled())

    // Persiste manager con recibe_propina=false, conservando sus puntos (12)
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(upsert).toHaveBeenCalledWith('manager', 12, false)
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
  })

  it('reversible: volver a Sí → persiste recibe_propina=true', async () => {
    upsert.mockClear()
    renderCfg()
    const mgr = screen.getByLabelText('Recibe propina: Encargado') as HTMLInputElement
    fireEvent.click(mgr)                    // Sí → No
    fireEvent.click(mgr)                    // No → Sí (revertir)
    // Sin cambio neto respecto al valor guardado, pero el rol quedó "tocado":
    // igual persiste el estado actual (true), que es lo esperado del flujo reversible.
    fireEvent.click(screen.getByText('Guardar cambios'))
    await waitFor(() => expect(upsert).toHaveBeenCalledWith('manager', 12, true))
  })
})
