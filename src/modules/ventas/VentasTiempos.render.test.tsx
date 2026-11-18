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
vi.mock('../../shared/api/posNdf', async () => ({ ...(await vi.importActual<object>('../../shared/api/posNdf')), getSaloneroNombres: async () => ({}) }))

import type { FilaPromPaxRpc } from '../../shared/api/posNdf'
import { datos } from './resumenV2.fixture'
import { armarLectura } from './resumenV2'
import { diaCRDeFactura, franjaDeHora, horaCRDeFactura, personasCargadas } from './indicadores'
import { conInternas } from './resumenV2Datos'
import type { HoraRpc, InternaRpc, TiemposRpc } from './tiemposV2Rpc'
const fx = datos('2026-09-01', 78)
const lect = armarLectura(fx.tickets, fx.lineas)
const filas080: FilaPromPaxRpc[] = lect.facturas.map(f => ({
  dia: diaCRDeFactura(f.fecha_registra), franja: franjaDeHora(horaCRDeFactura(f.fecha_registra)),
  salonero_login: f.salonero_login, canal: f.canal ?? 'otro', tickets: 1, pax: 0, neta: f.neta, neta_sin_pax: 0, tickets_sin_pax: 0,
}))
// Mesas internas FICTICIAS: la primera factura de salón del 3, 4 y 5-nov.
const internas: InternaRpc[] = ['2026-11-03', '2026-11-04', '2026-11-05'].map(dia => {
  const f = lect.facturas.find(x => x.canal === 'salon' && diaCRDeFactura(x.fecha_registra) === dia)!
  return { id: f.id, dia, hora: horaCRDeFactura(f.fecha_registra), canal: 'salon', netaCts: Math.round(f.neta * 100), pax: personasCargadas(f) }
})
const lectInt = conInternas(lect, internas)
// Lo que devolvería la 193: horas de todos los canales sin las internas, en céntimos.
const horasRpc: HoraRpc[] = (() => {
  const ids = new Set(internas.map(i => i.id))
  const m = new Map<string, HoraRpc>()
  for (const f of lect.facturas) {
    if (ids.has(f.id)) continue
    const dia = diaCRDeFactura(f.fecha_registra), hora = horaCRDeFactura(f.fecha_registra)
    const e = m.get(`${dia}|${hora}`) ?? { dia, hora, netaCts: 0, facturas: 0, pax: 0 }
    e.netaCts += Math.round(f.neta * 100); e.facturas += 1
    m.set(`${dia}|${hora}`, e)
  }
  return [...m.values()]
})()
let conLa193 = true
const tiempos = vi.fn(async (): Promise<TiemposRpc | null> => conLa193 ? {
  horas: horasRpc, sentados: [{ tamano: '2', n: 40, mediana: 58, promedio: 63.4 }, { tamano: '4', n: 12, mediana: 75, promedio: 80 }],
  descartes: { sin_pedido: 5, internas: 3, sin_pax: 2, menos_de_5: 1, mas_de_240: 1 },
} : null)
const cargar = vi.fn(async () => (conLa193 ? lectInt : { ...lect, internas: null }))
let turnosFallan = false
const turnos = vi.fn(async () => { if (turnosFallan) throw new Error('caída'); return filas080 })
vi.mock('./tiemposV2Datos', () => ({
  cargarLecturaDeRangos: (...a: unknown[]) => cargar(...(a as [])),
  cargarTiempos: (...a: unknown[]) => tiempos(...(a as [])),
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
  conLa193 = true
  tiempos.mockClear()
  cargar.mockClear()
  turnos.mockClear()
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('VentasTiempos', () => {
  it('abre en «Mes a la fecha» (1 al 17-nov): TOTAL del día de semana y del turno = Contabilidad − mesas internas', async () => {
    abrir('/ventas?tab=tiempos')
    await screen.findByRole('table', { name: 'Día de semana' })
    const tot = contabilidad('2026-11-01', '2026-11-17')
    const sinInternas = tot.ventaNeta - internas.reduce((s, i) => s + Math.round(i.netaCts / 100), 0)
    expect(sinInternas).toBeLessThan(tot.ventaNeta)
    expect(celdas('[data-fila="total"]')[2]).toBe(fi(sinInternas))
    expect(celdas('[data-fila="total-turno"]')[1]).toBe(fi(sinInternas))
    expect(document.querySelector('[data-nota="internas"]')!.textContent)
      .toBe(`Sin 3 facturas de mesas internas (${fi(tot.ventaNeta - sinInternas)}): siguen en Contabilidad, que da ${fi(tot.ventaNeta)}.`)
    expect(document.body.textContent).toContain('Mapa por hora · todos los canales')
    expect(turnos).not.toHaveBeenCalled() // con la 193 el turno sale de sus horas
    // Tiempo sentado por tamaño, con N y lo descartado.
    expect([...document.querySelector('[data-tamano="2"]')!.querySelectorAll('td')].map(t => t.textContent)).toEqual(['1 a 2 personas', '40', '58 min', '63 min'])
    expect([...document.querySelector('[data-tamano="7+"]')!.querySelectorAll('td')].map(t => t.textContent)).toEqual(['7 o más', '0', '—', '—'])
    expect(document.body.textContent).toContain('5 cuentas sin pedido')
    expect(document.querySelectorAll('[data-dow]')).toHaveLength(7)
    expect(document.querySelector('[data-dow="0"]')!.textContent).toContain('Lunes')
    expect(cargar).toHaveBeenCalledWith('santa-teresa', expect.arrayContaining([{ desde: '2026-11-01', hasta: '2026-11-17' }]))
    expect(tiempos).toHaveBeenCalledWith('santa-teresa', expect.objectContaining({ desde: '2026-11-01', hasta: '2026-11-17' }))
    // Rótulos concretos en la barra y en la tabla.
    expect((screen.getByLabelText('Base A') as HTMLSelectElement).selectedOptions[0].textContent).toBe('Mes anterior a la misma fecha')
    expect(document.body.textContent).toMatch(/Índice · mes anterior/)
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

  it('sin la 193 (base vieja): turno por la 080 = Contabilidad, mapa solo de salón, sin tiempo sentado', async () => {
    conLa193 = false
    abrir('/ventas?tab=tiempos')
    await screen.findByRole('table', { name: 'Día de semana' })
    const tot = contabilidad('2026-11-01', '2026-11-17')
    expect(celdas('[data-fila="total"]')[2]).toBe(fi(tot.ventaNeta))
    expect(celdas('[data-fila="total-turno"]')[1]).toBe(fi(tot.ventaNeta))
    expect(turnos).toHaveBeenCalled()
    expect(document.body.textContent).toContain('Mapa por hora · solo salón')
    expect(document.body.textContent).toContain('Las mesas internas todavía no se pueden separar')
    expect(screen.queryByRole('table', { name: 'Tiempo sentado' })).toBeNull()
  })

  it('si la 080 falla (sin la 193), se avisa y el resto de la pestaña se ve', async () => {
    conLa193 = false
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
