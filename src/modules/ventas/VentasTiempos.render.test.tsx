// @vitest-environment happy-dom
//
// «Tiempos» v2 en el DOM: la fila TOTAL del día de semana, el turno y cada quincena dan lo mismo que
// Contabilidad para el mismo período; abre en «Mes a la fecha»; las bases tienen rótulo concreto; si la
// 080 falla, el resto se ve; «Hoy» manda a En vivo. Datos ficticios. Reloj fijo DE NOCHE en CR
// (23:30 del 18-nov = 05:30 UTC del 19).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useEffect } from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'

let role = 'owner'
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { role } }) }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

import type { FilaPromPaxRpc } from '../../shared/api/posNdf'
import { datos } from './resumenV2.fixture'
import { armarLectura } from './resumenV2'
import { diaCRDeFactura, franjaDeHora, horaCRDeFactura } from './indicadores'
const fx = datos('2026-09-01', 78)
const lect = armarLectura(fx.tickets, fx.lineas)
const filas080: FilaPromPaxRpc[] = lect.facturas.map(f => ({
  dia: diaCRDeFactura(f.fecha_registra), franja: franjaDeHora(horaCRDeFactura(f.fecha_registra)),
  salonero_login: f.salonero_login, canal: f.canal ?? 'otro', tickets: 1, pax: 0, neta: f.neta, neta_sin_pax: 0, tickets_sin_pax: 0,
}))
const cargar = vi.fn(async () => lect)
let turnosFallan = false
const turnos = vi.fn(async () => { if (turnosFallan) throw new Error('caída'); return filas080 })
vi.mock('./tiemposV2Datos', () => ({
  cargarLecturaDeRangos: (...a: unknown[]) => cargar(...(a as [])),
  cargarTurnos: (...a: unknown[]) => turnos(...(a as [])),
  getLocalesVentas: vi.fn(async () => [{ id: 'santa-teresa', nombre: 'Local A' }]),
}))

import VentasTiempos from './VentasTiempos'
import { armarDiasMap } from './ventasDiasDesdePos'
import { fi, getContabilidadDays, totalesContabilidad } from './ventasUtils'

const ultima = { url: '' }
function Url() {
  const l = useLocation()
  useEffect(() => { ultima.url = l.pathname + l.search }, [l])
  return null
}
const abrir = (url: string) => render(<MemoryRouter initialEntries={[url]}><VentasTiempos /><Url /></MemoryRouter>)

function contabilidad(desde: string, hasta: string) {
  const { dias } = armarDiasMap(fx.tickets, fx.lineas, { desde: '2026-09-01', hasta: '2026-11-17' }, { uploadedAt: 'x', avisar: () => {} })
  return totalesContabilidad([9, 10, 11].flatMap(m => getContabilidadDays(2026, m, dias, {}))
    .filter(d => d.fecha >= desde && d.fecha <= hasta))
}
const celdas = (sel: string) => [...document.querySelector(sel)!.querySelectorAll('td')].map(td => td.textContent)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-19T05:30:00Z'))
  role = 'owner'
  turnosFallan = false
  cargar.mockClear()
  turnos.mockClear()
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('VentasTiempos', () => {
  it('abre en «Mes a la fecha» (1 al 17-nov): TOTAL del día de semana y del turno = Contabilidad', async () => {
    abrir('/ventas?tab=tiempos')
    await screen.findByRole('table', { name: 'Día de semana' })
    const tot = contabilidad('2026-11-01', '2026-11-17')
    expect(celdas('[data-fila="total"]')[2]).toBe(fi(tot.ventaNeta))
    expect(celdas('[data-fila="total-turno"]')[1]).toBe(fi(tot.ventaNeta))
    expect(document.querySelectorAll('[data-dow]')).toHaveLength(7)
    expect(document.querySelector('[data-dow="0"]')!.textContent).toContain('Lunes')
    expect(cargar).toHaveBeenCalledWith('santa-teresa', expect.arrayContaining([{ desde: '2026-11-01', hasta: '2026-11-17' }]))
    expect(turnos).toHaveBeenCalledWith('santa-teresa', expect.objectContaining({ desde: '2026-11-01', hasta: '2026-11-17' }))
    // Rótulos concretos en la barra y en la tabla.
    expect((screen.getByLabelText('Base A') as HTMLSelectElement).selectedOptions[0].textContent).toBe('Mes anterior')
    expect(document.body.textContent).toContain('Índice · mes anterior')
  })

  it('quincenas: 12 filas; la 1.ª de noviembre = Contabilidad del 1 al 15; la de ahora va a la fecha', async () => {
    abrir('/ventas?tab=tiempos&p=mesALaFecha')
    await screen.findByRole('table', { name: 'Quincenas' })
    expect(document.querySelectorAll('[data-quincena]')).toHaveLength(12)
    const q1 = [...document.querySelector('[data-quincena="2026-11-01"]')!.querySelectorAll('td')].map(td => td.textContent)
    expect(q1[0]).toBe('1.ª quincena de noviembre')
    expect(q1[1]).toBe(fi(contabilidad('2026-11-01', '2026-11-15').ventaNeta))
    expect(q1[6]).toMatch(/^▲ \+|^▼ −/) // contra la misma quincena de octubre
    expect(q1[7]).toBe('sin comparación') // el fixture no tiene 2025
    const q2 = document.querySelector('[data-quincena="2026-11-16"]')!.textContent
    expect(q2).toContain('a la fecha (al 17)')
    expect(document.body.textContent).toContain('vs misma quincena del mes anterior')
  })

  it('calendario: el mejor día marcado y cada día con su venta de Contabilidad', async () => {
    abrir('/ventas?tab=tiempos&p=mes&d=2026-10-01')
    await screen.findByRole('grid', { name: 'Calendario 2026-10' })
    expect(document.querySelectorAll('.vt2t-cal .dia')).toHaveLength(31)
    expect(document.querySelectorAll('.vt2t-cal .dia.mejor')).toHaveLength(1)
    expect(document.body.textContent).toMatch(/Mejor día: 2026-10-\d\d/)
    const tot = contabilidad('2026-10-01', '2026-10-31')
    expect(celdas('[data-fila="total"]')[2]).toBe(fi(tot.ventaNeta))
  })

  it('si la 080 falla, se avisa y el resto de la pestaña se ve', async () => {
    turnosFallan = true
    abrir('/ventas?tab=tiempos')
    await screen.findByRole('table', { name: 'Día de semana' })
    expect(document.body.textContent).toContain('No se pudo leer el reparto por turno')
    expect(screen.getByRole('table', { name: 'Quincenas' })).toBeTruthy()
  })

  it('«Hoy» no lee nada y lleva a En vivo', async () => {
    abrir('/ventas?tab=tiempos&p=hoy')
    fireEvent.click(await screen.findByRole('button', { name: /Ir a En vivo/ }))
    expect(cargar).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(ultima.url).toContain('tab=envivo'))
  })
})
