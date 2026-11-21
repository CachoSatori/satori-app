// @vitest-environment happy-dom
// «Quincenal» (planilla para nómina) suma LO QUE SE PAGÓ (decisión del dueño, 20-nov-2026), también lo pagado a
// personas que la vista no puede leer (fila sin nombre), y el aviso «sin repartir» del #320 no se dispara por
// ellas. Datos ficticios.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { TipSession, Employee, RoleTipPoints } from '../../shared/types/database'

const ENTRIES: Record<string, Array<Record<string, unknown>>> = {}
vi.mock('../../shared/api/tips', () => ({
  getTipEntriesBySession: vi.fn(async (id: string) => ENTRIES[id] ?? []),
}))

import TipQuincenal from './TipQuincenal'

const employees = [
  { id: 'e1', full_name: 'Sala Uno', role: 'salonero', is_active: true },
  { id: 'e2', full_name: 'Sala Dos', role: 'salonero', is_active: true },
] as unknown as Employee[]
const rolePoints = [{ role: 'salonero', points: 10 }, { role: 'barman', points: 5 }] as unknown as RoleTipPoints[]
const sesion = (id: string, fecha: string, pool: number, barra = 0) => ({
  id, session_date: fecha, shift_type: 'PM', status: 'closed', exchange_rate: 500,
  pool_efectivo_crc: pool - barra, pool_efectivo_usd: 0, pool_barra_crc: barra, pool_barra_electronico_crc: 0, pool_total_crc: pool,
}) as unknown as TipSession
const ent = (sid: string, employee_id: string, payout_crc: number | null, hours_worked = 8, covered_role: string | null = null) => ({
  id: `${sid}-${employee_id}`, employee_id, hours_worked, tip_amount_crc: 0, tip_amount_usd: 0, covered_role, points: hours_worked * 10, payout_crc,
})
const montar = (sessions: TipSession[]) =>
  render(<TipQuincenal sessions={sessions} calcCache={{}} employees={employees} rolePoints={rolePoints} />)
const fila = (nombre: string) => screen.getByText(nombre).closest('tr')!.textContent!

afterEach(() => { cleanup() })

describe('Quincenal · lo pagado', () => {
  it('cada persona suma lo pagado; lo de la persona inactiva va en su fila y el TOTAL cuadra con el pozo', async () => {
    // Q1: pozo 60.000 pagado 25.000 / 20.000 / 15.000 (x inactiva). Q2: pozo 30.000 pagado 18.000 / 12.000.
    ENTRIES.s1 = [ent('s1', 'e1', 25000), ent('s1', 'e2', 20000), ent('s1', 'x', 15000)]
    ENTRIES.s2 = [ent('s2', 'e1', 18000), ent('s2', 'e2', 12000)]
    montar([sesion('s1', '2026-11-03', 60000), sesion('s2', '2026-11-18', 30000)])
    await screen.findByTestId('quincenal-ocultos')
    expect(fila('Sala Uno')).toContain('₡43.000')            // 25.000 + 18.000 (el recálculo daba 30.000 + 15.000)
    expect(fila('Sala Dos')).toContain('₡32.000')
    expect(screen.getByTestId('quincenal-ocultos').textContent).toContain('₡15.000')
    const total = screen.getByText('TOTAL').closest('tr')!.textContent!
    expect(total).toContain('₡90.000')                        // = pozo de los dos turnos
    expect(screen.getByTestId('quincenal-avisos-pagado').textContent).toMatch(/1 pago a una persona que hoy está inactiva/)
    expect(screen.queryByTestId('aviso-sin-repartir')).toBeNull()
  })

  it('el aviso «sin repartir» sigue saliendo cuando lo pagado no cubre el pozo (barra sin horas)', async () => {
    ENTRIES.s3 = [ent('s3', 'e1', 10000, 6)]
    montar([sesion('s3', '2026-11-05', 14000, 4000)])
    const aviso = await screen.findByTestId('aviso-sin-repartir')
    expect(aviso.textContent).toBe('⚠ Turno del 2026-11-05 noche: quedaron ₡4.000 sin repartir (hay propina de barra y nadie de barra tiene horas).')
  })

  it('un turno sin lo guardado: la persona marca «sin dato guardado» y no suma un recálculo', async () => {
    ENTRIES.s4 = [ent('s4', 'e1', null), ent('s4', 'e2', 20000)]
    montar([sesion('s4', '2026-11-07', 40000)])
    await screen.findByTestId('quincenal-sin-dato')
    expect(fila('Sala Uno')).toContain('1 sin dato guardado')
    expect(fila('Sala Uno')).not.toContain('₡20.000')
    expect(screen.getByTestId('quincenal-avisos-pagado').textContent).toContain('1 monto no tiene dato guardado')
  })
})
