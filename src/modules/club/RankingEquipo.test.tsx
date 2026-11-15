// @vitest-environment happy-dom
// D7 (#2, mig 157) · Pestaña «Equipo» en Reportes del Club: ranking por persona y mes (owner y manager).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import type { ReporteMes } from '../../shared/api/club'

const api = vi.hoisted(() => ({
  getReporteEquipo: vi.fn(), getReporteMes: vi.fn(), getLocalesClub: vi.fn(), getReporteAltas: vi.fn(), getReporteVisitas: vi.fn(),
}))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: 'manager', full_name: 'Prueba' } }) }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('../../shared/api/club', async orig => ({ ...(await orig<typeof import('../../shared/api/club')>()), ...api }))
vi.mock('./Comparacion', () => ({ default: () => null }))
vi.mock('./Vencimiento', () => ({ default: () => null }))

import Reportes from './Reportes'
import { notaEquipoMes } from './equipo'

const repMes = {
  mes: '2026-11', local: 'local-prueba', generado_en: '2026-11-14T12:00:00Z',
  config: { valor_credito_crc: 1000, personas_por_credito: 6, vencimiento_meses: 12, pm_pausado: true },
  kpis: { tarjetas: 0, personas: 0, creditos_generados: 0, canjes: 0, creditos_canjeados: 0, valor_canjeado_crc: 0, personas_vencidas: 0,
          referentes_con_visitas: 0, cupones_generados: 0, cupones_usados: 0, saldo_creditos_al_cierre: 0, cuentas_con_saldo: 0,
          anterior: { tarjetas: 0, personas: 0, canjes: 0, creditos_canjeados: 0 } },
  ranking: [], subiendo: [], bajando: [], a_contactar: [], dormidos: { cuentas: 0, creditos: 0, lista: [] }, nuevos: { cuentas: 0, lista: [] },
  equipo: { personas_mes: 5, tarjetas_mes: 2, congelado_cuentas: 2, congelado_creditos: 3.5, congelado_valor_crc: 3500,
            lista: [{ nombre: 'Persona Equipo Uno', negocio: null, tipo: 'equipo', personas: 5, tarjetas: 2 }] },
  antiguedad: [], pm: { pausado: true, nota: null, pendiente_crc: 0, cargos_mes_crc: 0, pagos_mes_crc: 0 },
  calidad: { abiertas: 0, resueltas: 0, por_tipo: {}, promo_activa: true },
} as unknown as ReporteMes

describe('Reportes · pestaña Equipo', () => {
  beforeEach(() => {
    api.getLocalesClub.mockReset().mockResolvedValue([{ id: 'local-prueba', nombre: 'Local Prueba', activo: true }])
    api.getReporteMes.mockReset().mockResolvedValue(repMes)
    api.getReporteAltas.mockReset().mockResolvedValue([])
    api.getReporteVisitas.mockReset().mockResolvedValue([])
    api.getReporteEquipo.mockReset().mockResolvedValue([
      { miembro_id: 'a', nombre: 'Persona Equipo Uno', estado: 'activo', cupones_usados: 3, personas: 7, mesas: 3, facturas: 2, venta_respaldada_crc: 45000, altas_socios: 1 },
      { miembro_id: 'b', nombre: 'Persona Equipo Dos', estado: 'baja', cupones_usados: 1, personas: 2, mesas: 1, facturas: 0, venta_respaldada_crc: 0, altas_socios: 0 },
    ])
  })

  it('el mes muestra al equipo con personas y el saldo congelado aparte (sin créditos por persona)', async () => {
    render(<Reportes />)
    const card = (await screen.findByText('Equipo Satori')).closest('div')!.parentElement!
    expect(within(card).getByText(/Saldo congelado, fuera del pasivo: 3,5 créditos/)).toBeTruthy()
    expect(within(card).getByText('5 p.')).toBeTruthy()
    expect(api.getReporteEquipo).not.toHaveBeenCalled()
  })

  it('«Equipo» abre el ranking: cupones, personas, mesas, venta respaldada, altas y total', async () => {
    render(<Reportes />)
    fireEvent.click(screen.getByText('Equipo'))
    await screen.findByText('Ranking del equipo')
    await waitFor(() => expect(api.getReporteEquipo).toHaveBeenLastCalledWith(expect.stringMatching(/^\d{4}-\d{2}-01$/), 'local-prueba'))
    const fila = (await screen.findByText('Persona Equipo Uno')).closest('tr')!
    expect([...fila.querySelectorAll('td')].map(td => td.textContent)).toEqual(['1', 'Persona Equipo Uno', '3', '7', '3', '₡45.000 · 2 fact.', '1'])
    expect(screen.getByText('Persona Equipo Dos (baja)')).toBeTruthy()
    const total = screen.getByText('Total').closest('tr')!
    expect([...total.querySelectorAll('td')].map(td => td.textContent)).toEqual(['', 'Total', '4', '9', '4', '₡45.000', '1'])
  })
})

describe('notaEquipoMes', () => {
  it('sin congelado: solo personas', () => {
    expect(notaEquipoMes({ personas_mes: 1, congelado_creditos: 0, congelado_cuentas: 0, congelado_valor_crc: 0 }))
      .toBe('1 persona en el mes. El equipo no acumula créditos.')
  })
})
