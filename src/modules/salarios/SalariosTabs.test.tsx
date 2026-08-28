// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SalariosLiquidaciones from './SalariosLiquidaciones'
import SalariosHistorial from './SalariosHistorial'
import SalariosFicha from './SalariosFicha'
import type { Employee } from '../../shared/types/database'

// v3 · las pestañas nuevas del SPEC-UI. Lo que se prueba acá es lo que se PROMETE:
// que las que son cascarón lo digan, que las vacías no inventen datos, y que la ficha
// cambie de formulario según el tipo de regla.

// El cliente de Supabase se corta acá: en happy-dom no hay Web Worker y el realtime
// no arranca. Estas pantallas no lo tocan — leen por la API de salarios, que se mockea
// abajo.
vi.mock('../../shared/api/supabase', () => ({ supabase: { from: () => ({}) } }))

const PERIODS: unknown[] = []
vi.mock('../../shared/api/salarios', async (orig) => {
  const real = await orig<typeof import('../../shared/api/salarios')>()
  return {
    ...real,
    getSalaryPeriods:  vi.fn(async () => PERIODS),
    getPeriodPayments: vi.fn(async () => []),
    updateEmployeeHorasHabituales:  vi.fn(async () => {}),
    updateEmployeeHomebankingName:  vi.fn(async () => {}),
    exigirTarifasEditables:         vi.fn(async () => {}),
  }
})

const emp = (o: Partial<Employee>): Employee => ({
  id: 'e1', full_name: 'KAREN JIMENEZ', role: 'salonero', profile_id: null,
  is_active: true, pos_name: null, created_at: '', updated_at: '', ...o,
} as Employee)

beforeEach(() => { PERIODS.length = 0 })

describe('Salarios · Liquidaciones (cascarón declarado)', () => {
  it('dice que las fórmulas CR están pendientes y que NO se guarda', () => {
    render(<SalariosLiquidaciones employees={[emp({})]} />)
    expect(screen.getByText(/Fórmulas CR pendientes del contador/)).toBeTruthy()
    // Lo dice dos veces a propósito: en el aviso de arriba y en la píldora del desglose.
    expect(screen.getAllByText(/no se guarda/).length).toBeGreaterThan(0)
  })

  it('suma los montos cargados a mano — no los calcula', async () => {
    render(<SalariosLiquidaciones employees={[emp({})]} />)
    fireEvent.change(screen.getByLabelText('Empleado a liquidar'), { target: { value: 'e1' } })
    // Los montos arrancan deshabilitados hasta que hay alguien elegido: sin persona no
    // hay liquidación que cargar. Hay que esperar a que React vuelva a pintar.
    await waitFor(() =>
      expect((screen.getByLabelText('Monto de Cesantía') as HTMLInputElement).disabled).toBe(false),
    )
    fireEvent.change(screen.getByLabelText('Monto de Cesantía'), { target: { value: '310000' } })
    fireEvent.change(screen.getByLabelText('Monto de Aguinaldo proporcional'), { target: { value: '142300' } })
    // Lo que importa es la SUMA, no el separador de miles: el ICU del runner de tests
    // usa espacio fino donde el navegador pone punto. Se comparan solo los dígitos.
    await waitFor(() => {
      const total = document.querySelector('.sal-costrow.is-total .sal-costrow-r')
      const digitos = (total?.textContent ?? '').replace(/\D/g, '')
      expect(digitos).toBe('452300')
    })
  })
})

describe('Salarios · Historial', () => {
  it('sin períodos pagados muestra un vacío HONESTO, sin filas de ejemplo', async () => {
    render(<SalariosHistorial employees={[emp({})]} />)
    expect(await screen.findByText(/Todavía no hay períodos pagados/)).toBeTruthy()
  })
})

describe('Salarios · Ficha', () => {
  it('el tipo de regla CAMBIA el formulario: único pide horas, flexible no', async () => {
    render(<SalariosFicha employees={[emp({ hora_entrada_habitual: '07:00:00', hora_salida_habitual: '15:00:00' })]} onRefresh={async () => {}} />)
    fireEvent.change(screen.getByLabelText('Empleado'), { target: { value: 'e1' } })

    // Arranca en ÚNICO porque tiene las dos horas cargadas.
    expect(await screen.findByLabelText('Hora de entrada habitual')).toBeTruthy()

    fireEvent.click(screen.getByText('Flexible'))
    await waitFor(() => expect(screen.queryByLabelText('Hora de entrada habitual')).toBeNull())
    expect(screen.getByText(/Sin hora techo/)).toBeTruthy()
  })

  it('cortado avisa que todavía no se puede guardar, en vez de fingir el campo', async () => {
    render(<SalariosFicha employees={[emp({})]} onRefresh={async () => {}} />)
    fireEvent.change(screen.getByLabelText('Empleado'), { target: { value: 'e1' } })
    fireEvent.click(await screen.findByText('Cortado'))
    expect(screen.getByText(/No se puede guardar todavía/)).toBeTruthy()
  })

  it('dice qué campos del SPEC no tienen columna, en vez de ofrecerlos rotos', async () => {
    render(<SalariosFicha employees={[emp({})]} onRefresh={async () => {}} />)
    fireEvent.change(screen.getByLabelText('Empleado'), { target: { value: 'e1' } })
    expect(await screen.findByText(/todavía no tienen columna/)).toBeTruthy()
  })
})
