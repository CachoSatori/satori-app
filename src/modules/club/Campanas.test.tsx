// @vitest-environment happy-dom
// 166 · Campañas (solo owner): la regla del beneficio base en pantalla, «Reservar 15 %» por defecto, la lista sin los
// reservados y el aviso de que con pocos miembros la diferencia no es concluyente.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { Campana, ListaCampana, ReporteCampana } from '../../shared/api/club'

const st = vi.hoisted(() => ({
  crear: vi.fn(), lista: null as unknown, reporte: null as unknown, campanas: [] as unknown[],
}))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('../../shared/api/club', async orig => ({
  ...(await orig<typeof import('../../shared/api/club')>()),
  localActual: () => 'p166-a',
  getCampanas: async () => st.campanas,
  crearCampana: (...a: unknown[]) => st.crear(...a),
  getListaCampana: async () => st.lista,
  getReporteCampana: async () => st.reporte,
}))

import Campanas from './Campanas'

const camp: Campana = { id: 'c1', nombre: 'Prueba vencen', local: 'p166-a', fuente: 'a_contactar', control_pct: 15,
  inicio: '2026-11-14', creada_en: '2026-11-14T18:00:00Z', oferta: 5, control: 1 }
const grupo = (miembros: number) => ({ miembros, con_visita: 1, con_visita_pct: 20, visitas: 1, visitas_por_miembro: 0.2,
  facturas: 1, venta_respaldada_crc: 9000, venta_por_miembro_crc: 1800 })

beforeEach(() => {
  st.crear.mockReset(); st.campanas = []
  window.confirm = vi.fn(() => true)
})

describe('Campañas', () => {
  it('muestra la regla del beneficio base y reserva 15 % por defecto', async () => {
    render(<Campanas />)
    expect(await screen.findByText(/no se le quita nada de lo que ya tiene/)).toBeTruthy()
    expect((screen.getByLabelText('Porcentaje reservado') as HTMLInputElement).value).toBe('15')
    expect(await screen.findByText('Todavía no hay campañas en este local.')).toBeTruthy()
  })
  it('arma con el % editado; sin «Reservar» manda 0; un % fuera de rango no deja armar', async () => {
    st.crear.mockResolvedValue({ ...camp, oferta: 4, control: 0 })
    render(<Campanas />)
    fireEvent.change(await screen.findByPlaceholderText(/Créditos por vencer/), { target: { value: 'Prueba vencen' } })
    fireEvent.change(screen.getByLabelText('Porcentaje reservado'), { target: { value: '20' } })
    fireEvent.click(screen.getByText('Armar campaña'))
    await waitFor(() => expect(st.crear).toHaveBeenCalledWith('Prueba vencen', 'p166-a', 20))
    fireEvent.change(screen.getByPlaceholderText(/Créditos por vencer/), { target: { value: 'Prueba dos' } })
    fireEvent.change(screen.getByLabelText('Porcentaje reservado'), { target: { value: '80' } })
    expect(screen.getByText('El porcentaje va de 0 a 50.')).toBeTruthy()
    expect((screen.getByText('Armar campaña').closest('button') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByText('Armar campaña'))
    await waitFor(() => expect(st.crear).toHaveBeenLastCalledWith('Prueba dos', 'p166-a', 0))
  })
  it('la lista muestra solo a los de oferta y cuántos quedaron reservados', async () => {
    st.campanas = [camp]
    st.lista = { id: 'c1', nombre: 'Prueba vencen', local: 'p166-a', control_pct: 15, oferta: 1, control: 1,
      filas: [{ miembro_id: 'm1', nombre: 'Prueba Oferta', negocio: null, tipo: 'referente', estado: 'activo', creditos: 1, vence_en: '2026-11-24T12:00:00Z' }] } satisfies ListaCampana
    render(<Campanas />)
    fireEvent.click(await screen.findByText('Lista'))
    expect(await screen.findByText(/Prueba Oferta/)).toBeTruthy()
    expect(screen.getByText(/Los 1 reservados no salen acá ni en el CSV/)).toBeTruthy()
  })
  it('reporte con pocos miembros: aviso de que la diferencia no es concluyente, con el tamaño de cada grupo', async () => {
    st.campanas = [camp]
    st.reporte = { id: 'c1', nombre: 'Prueba vencen', local: 'p166-a', fuente: 'a_contactar', control_pct: 15, inicio: '2026-11-14',
      generado_en: '2026-11-14T18:00:00Z', ventana_dias: 30, ventana_hasta: '2026-12-13', cerrado: false, umbral_minimo: 30,
      no_concluyente: true, pos_sin_datos: false, oferta: grupo(5), control: grupo(1) } satisfies ReporteCampana
    render(<Campanas />)
    fireEvent.click(await screen.findByText('Reporte'))
    expect(await screen.findByText(/Con 5 con oferta y 1 reservados, la diferencia no es concluyente/)).toBeTruthy()
    expect(screen.getByText(/Parcial: la ventana sigue abierta/)).toBeTruthy()
    expect(screen.getAllByText('₡9.000')).toHaveLength(2)
  })
})
