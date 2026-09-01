// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { Employee } from '../../shared/types/database'

// ╔══════════════════════════════════════════════════════════════════════════════════════╗
// ║ FICHA · el ÚNICO lugar donde se edita el horario (v3, fix del piloto)                  ║
// ╚══════════════════════════════════════════════════════════════════════════════════════╝
// El horario se editaba también desde Personal y el mismo dato terminaba distinto según la
// pantalla. Estas pruebas fijan el reparto: la Ficha escribe, las tablas muestran.

const setHorario = vi.fn<(id: string, e: string | null, s: string | null) => Promise<void>>(async () => {})
const setBanco   = vi.fn<(id: string, n: string | null) => Promise<void>>(async () => {})
const guarda     = vi.fn<() => Promise<void>>(async () => {})

vi.mock('../../shared/api/supabase', () => ({ supabase: { from: () => ({}) } }))
// Los helpers puros (tipoReglaDe, horarioResumen, horaHabitualHHMM) tienen que ser los DE
// VERDAD: son justamente lo que comparte con Personal y lo que esta prueba verifica.
vi.mock('../../shared/api/salarios', async (orig) => ({
  ...(await orig<typeof import('../../shared/api/salarios')>()),
  updateEmployeeHorasHabituales: (id: string, e: string | null, s: string | null) => setHorario(id, e, s),
  updateEmployeeHomebankingName: (id: string, n: string | null) => setBanco(id, n),
  exigirTarifasEditables: () => guarda(),
}))

import SalariosFicha from './SalariosFicha'

function emp(over: Partial<Employee> & { id: string; full_name: string }): Employee {
  return {
    role: 'salonero',
    profile_id: null,
    is_active: true,
    pos_name: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  } as Employee
}

const FRAN = emp({
  id: 'e1', full_name: 'FRAN', biotime_emp_code: '4',
  hora_entrada_habitual: '11:00:00', hora_salida_habitual: '20:00:00',
})
const SIN_REGLA = emp({ id: 'e2', full_name: 'LESTER', role: 'cocina', biotime_emp_code: '10' })

function abrir(e: Employee, todos: Employee[] = [FRAN, SIN_REGLA]) {
  const onRefresh = vi.fn(async () => {})
  render(<SalariosFicha employees={todos} onRefresh={onRefresh} />)
  fireEvent.change(screen.getByLabelText('Empleado'), { target: { value: e.id } })
  return { onRefresh }
}

beforeEach(() => {
  setHorario.mockClear(); setBanco.mockClear(); guarda.mockClear()
  guarda.mockResolvedValue(undefined)
})

describe('Ficha · el horario se edita acá', () => {
  it('los tres tipos son Fijo / Cortado / Flexible', () => {
    abrir(FRAN)
    expect(screen.getByText('Fijo')).toBeTruthy()
    expect(screen.getByText('Cortado')).toBeTruthy()
    expect(screen.getByText('Flexible')).toBeTruthy()
  })

  it('abre en el tipo que corresponde y con las horas cargadas, en 24 h', () => {
    abrir(FRAN)
    expect((screen.getByLabelText('Hora de entrada habitual') as HTMLInputElement).value).toBe('11:00')
    expect((screen.getByLabelText('Hora de salida habitual') as HTMLInputElement).value).toBe('20:00')
    // Y muestra lo que las otras pestañas van a leer: el MISMO texto.
    expect(screen.getByText('Fijo · 11:00 → 20:00')).toBeTruthy()
  })

  it('quien no tiene regla abre en Flexible, no en un horario inventado', () => {
    abrir(SIN_REGLA)
    expect(screen.getByText(/Sin hora techo/)).toBeTruthy()
    expect(screen.queryByLabelText('Hora de entrada habitual')).toBeNull()
  })

  it('guardar el turno de tarde persiste las dos horas en 24 h', async () => {
    const { onRefresh } = abrir(FRAN)
    fireEvent.change(screen.getByLabelText('Hora de entrada habitual'), { target: { value: '16:00' } })
    fireEvent.change(screen.getByLabelText('Hora de salida habitual'),  { target: { value: '23:30' } })
    fireEvent.click(screen.getByText('Guardar cambios'))

    await waitFor(() => expect(setHorario).toHaveBeenCalledWith('e1', '16:00', '23:30'))
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
  })

  it('pasar a Flexible BORRA la regla — "sin hora techo" no es una hora vieja escondida', async () => {
    abrir(FRAN)
    fireEvent.click(screen.getByText('Flexible'))
    fireEvent.click(screen.getByText('Guardar cambios'))
    await waitFor(() => expect(setHorario).toHaveBeenCalledWith('e1', '', ''))
  })

  it('Cortado avisa que le falta la migración y NO finge guardarlo', () => {
    abrir(FRAN)
    fireEvent.click(screen.getByText('Cortado'))
    expect(screen.getAllByText(/migración aditiva/).length).toBeGreaterThan(0)
    expect(screen.getByText(/propuesta y sin aplicar/)).toBeTruthy()
  })

  it('con un período cerrado sin pagar, guardar REBOTA', async () => {
    guarda.mockRejectedValueOnce(new Error('El período 2026-08-01 → 2026-08-15 está cerrado y todavía no se pagó'))
    abrir(FRAN)
    fireEvent.click(screen.getByText('Guardar cambios'))
    expect(await screen.findByText(/cerrado y todavía no se pagó/)).toBeTruthy()
    expect(setHorario).not.toHaveBeenCalled()
  })

  it('la pantalla dice que es el único lugar donde se edita el horario', () => {
    abrir(FRAN)
    expect(screen.getByText('◆ Horario · el único lugar donde se edita')).toBeTruthy()
  })
})

// ── Formato 24 h ────────────────────────────────────────────────────────────────
// El `<input type="time">` lo pinta el NAVEGADOR y con `es-CR` muestra el reloj de 12 h
// («04:00 p. m.»). El valor que viaja es 24 h igual, pero en nómina lo que se LEE tiene que
// ser lo que se guarda: un turno cruza la medianoche todas las noches.
describe('Ficha · las horas se leen en 24 h', () => {
  // Un marcador de 12 h siempre viene PEGADO a un número: «04:00 p. m.», «4 pm». Sin el
  // dígito adelante, el patrón matchea dentro de cualquier palabra («c-am-bios»).
  const SIN_12H = /\d\s*(a\.?\s?m\.?|p\.?\s?m\.?)\b/i

  it('al lado del selector de hora va el valor canónico, en 24 h', () => {
    abrir(FRAN)
    fireEvent.change(screen.getByLabelText('Hora de entrada habitual'), { target: { value: '16:00' } })
    fireEvent.change(screen.getByLabelText('Hora de salida habitual'),  { target: { value: '02:00' } })

    const ecos = [...document.querySelectorAll('.sal-24h')].map(n => n.textContent)
    expect(ecos).toEqual(['16:00', '02:00'])
  })

  it('las etiquetas dicen 24 h y en ningún lado aparece a.m./p.m.', () => {
    abrir(FRAN)
    expect(screen.getByText('Entra (24 h)')).toBeTruthy()
    expect(screen.getByText('Sale (24 h)')).toBeTruthy()
    expect(document.body.textContent ?? '').not.toMatch(SIN_12H)
  })

  it('el resumen que leen las otras pestañas también va en 24 h', () => {
    abrir(FRAN)
    expect(screen.getByText('Fijo · 11:00 → 20:00')).toBeTruthy()
  })
})
