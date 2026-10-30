// @vitest-environment happy-dom
//
// Mi Rendimiento muestra la franja «no se pudo leer el PoS» cuando la carga no salió 'ok', y
// sigue mostrando los días del Excel (no queda vacío).
import { describe, it, expect, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const H = vi.hoisted(() => ({ estado: 'sin_acceso' as string | null }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'p1', full_name: 'Francisco', role: 'salonero' }, loading: false }) }))
vi.mock('../../shared/api/ventas', () => ({
  getProductMap: vi.fn(async () => ({})),
  getMetas: vi.fn(async () => ({ restaurante: {}, margen: {}, global: { promPax: 15000, bebPax: 1.2, ratioCB: 3, ticketItem: 7500, ventas: 800000 }, salMetas: {} })),
  getComps: vi.fn(async () => []),
}))
vi.mock('./ventasFuente', async orig => ({
  ...(await orig<Record<string, unknown>>()),
  cargarDias: vi.fn(async () => ({ dias: {}, pm: {}, estadoPos: H.estado, ultimoDiaXls: '2026-10-20' })),
}))
vi.mock('../../shared/api/tips', () => ({ getAttendanceHistory: vi.fn(async () => []) }))
vi.mock('../../shared/api/admin', () => ({ getAllEmployees: vi.fn(async () => []), getEmployeeByProfileId: vi.fn(async () => null) }))

import MiRendimientoWrap from './MiRendimientoWrap'

const montar = () => render(<MemoryRouter initialEntries={['/mi-rendimiento']}><MiRendimientoWrap /></MemoryRouter>)

describe('MiRendimientoWrap · aviso del PoS', () => {
  it("con estado 'sin_acceso' muestra la franja", async () => {
    H.estado = 'sin_acceso'
    const { container } = montar()
    await waitFor(() => expect(container.querySelector('[data-estado-pos]')).not.toBeNull())
    expect(container.textContent).toContain('Mostrando solo el Excel (último día: 20/10). No se pudo leer el PoS.')
  })

  it("con estado 'ok' no hay franja", async () => {
    H.estado = 'ok'
    const { container } = montar()
    await waitFor(() => expect(container.querySelector('.module-loading')).toBeNull())
    expect(container.querySelector('[data-estado-pos]')).toBeNull()
  })
})
