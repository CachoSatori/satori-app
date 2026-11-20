// @vitest-environment happy-dom
//
// «Tiempos» v2 en el DOM: la fila TOTAL del día de semana, el turno y cada quincena dan lo mismo que
// Contabilidad para el mismo período; abre en «Mes» (el en curso, a la fecha); el % del día de semana contra el
// mismo día de semana de cada base, «—» sin datos; la barra simple; si la 080 falla, el resto se ve. Datos ficticios. Reloj fijo DE NOCHE en CR
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
// Lo que devolvería la 193: horas de todos los canales (internas incluidas: son venta), en céntimos.
const horasRpc: HoraRpc[] = (() => {
  const m = new Map<string, HoraRpc>()
  for (const f of lect.facturas) {
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
import { diaSemana } from './periodos'
import { fmtPctSigno } from './tiemposV2'

const ultima = { url: '' }
function Url() {
  const l = useLocation()
  useEffect(() => { ultima.url = l.pathname + l.search }, [l])
  return null
}
const abrir = (url: string) => render(<MemoryRouter initialEntries={[url]}><VentasTiempos /><Url /></MemoryRouter>)

function diasConta(desde: string, hasta: string) {
  const { dias } = armarDiasMap(fx.tickets, fx.lineas, { desde: '2026-09-01', hasta: '2026-11-17' }, { uploadedAt: 'x', avisar: () => {} })
  return [9, 10, 11].flatMap(m => getContabilidadDays(2026, m, dias, {})).filter(d => d.fecha >= desde && d.fecha <= hasta)
}
const contabilidad = (desde: string, hasta: string) => totalesContabilidad(diasConta(desde, hasta))
const netaTotal = () => document.querySelector('[data-fila="total"] [data-neta="total"]')!.textContent
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
  it('abre en «Mes a la fecha» (1 al 17-nov), con mesas internas marcadas: TOTAL del día de semana y del turno = Contabilidad', async () => {
    abrir('/ventas?tab=tiempos')
    await screen.findByRole('table', { name: 'Día de semana' })
    const tot = contabilidad('2026-11-01', '2026-11-17')
    expect(netaTotal()).toBe(fi(tot.ventaNeta))
    expect(celdas('[data-fila="total-turno"]')[1]).toBe(fi(tot.ventaNeta))
    expect(document.querySelector('[data-nota="internas"]')).toBeNull()
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
    // Barra simple: «Mes» elegido, «Los dos» por defecto, con el nombre concreto de cada base.
    expect((screen.getByLabelText('Período') as HTMLSelectElement).selectedOptions[0].textContent).toBe('Mes')
    const cmp = screen.getByLabelText('Comparar con') as HTMLSelectElement
    expect(cmp.selectedOptions[0].textContent).toBe('Los dos')
    expect([...cmp.options].map(o => o.textContent)).toEqual(['Mes anterior a la misma fecha', 'Año pasado, mismo día de semana', 'Año pasado, mismas fechas', 'Los dos'])
    expect(screen.queryByLabelText('Base B')).toBeNull()
    expect(document.body.textContent).not.toMatch(/Índice/)
  })

  it('día de semana: Día · Promedio por día · vs cada base (%) · Venta por persona; el % es contra el mismo día de semana', async () => {
    abrir('/ventas?tab=tiempos')
    const tabla = await screen.findByRole('table', { name: 'Día de semana' })
    expect([...tabla.querySelectorAll('th')].map(t => t.textContent)).toEqual(
      ['Día', 'Promedio por día', 'vs mes anterior a la misma fecha', 'vs año pasado, mismo día de semana', 'Venta por persona'])
    // A mano, desde Contabilidad: promedio por día abierto de cada día de semana, nov 1–17 contra oct 1–17.
    const prom = (desde: string, hasta: string) => {
      const ds = diasConta(desde, hasta)
      return [0, 1, 2, 3, 4, 5, 6].map(dow => {
        const xs = ds.filter(d => diaSemana(d.fecha) === dow && d.ventaNeta > 0)
        return xs.length ? xs.reduce((s, d) => s + d.ventaNeta, 0) / xs.length : null
      })
    }
    const nov = prom('2026-11-01', '2026-11-17'), oct = prom('2026-10-01', '2026-10-17')
    for (let dow = 0; dow < 7; dow++) {
      const fila = document.querySelector(`[data-dow="${dow}"]`)!
      const esperado = nov[dow] !== null && oct[dow] ? fmtPctSigno((nov[dow]! / oct[dow]! - 1) * 100) : '—'
      expect(fila.querySelector('[data-vs="anteriorEquivalente"]')!.textContent).toBe(esperado)
      // El fixture no tiene 2025: sin datos para comparar → «—», en gris.
      expect(fila.querySelector('[data-vs="anioMismoDiaSemana"]')!.textContent).toBe('—')
      expect(fila.querySelector('[data-vs="anioMismoDiaSemana"]')!.className).toContain('gris')
      expect(fila.querySelector('[data-detalle="dia"]')!.textContent).toMatch(/^\d+ días? abiertos? · venta neta /)
    }
    const conSigno = document.querySelector('[data-dow="0"] [data-vs="anteriorEquivalente"]')!
    expect(conSigno.textContent).toMatch(/^[+−]\d+,\d %$|^0,0 %$|^—$/)
    expect(conSigno.className).toMatch(conSigno.textContent!.startsWith('+') ? /sube/ : conSigno.textContent!.startsWith('−') ? /baja/ : /gris/)
    // TOTAL: venta por día abierto del período contra la de la base.
    const tn = diasConta('2026-11-01', '2026-11-17').filter(d => d.ventaNeta > 0)
    const to = diasConta('2026-10-01', '2026-10-17').filter(d => d.ventaNeta > 0)
    const pn = tn.reduce((s, d) => s + d.ventaNeta, 0) / tn.length, po = to.reduce((s, d) => s + d.ventaNeta, 0) / to.length
    expect(document.querySelector('[data-fila="total"] [data-vs="anteriorEquivalente"]')!.textContent).toBe(fmtPctSigno((pn / po - 1) * 100))
    expect(document.querySelector('[data-nota="que-compara"]')!.textContent).toBe(
      'El % compara el promedio por día de cada día de semana con el del mismo día de semana del mes anterior a la misma fecha y del año pasado, mismo día de semana.')
  })

  it('«Comparar con» una sola base: una sola columna de %, en la URL y sin volver a leer', async () => {
    abrir('/ventas?tab=tiempos')
    await screen.findByRole('table', { name: 'Día de semana' })
    const llamadas = cargar.mock.calls.length
    fireEvent.change(screen.getByLabelText('Comparar con'), { target: { value: 'anterior' } })
    await vi.waitFor(() => expect(ultima.url).toContain('c=anterior'))
    expect(document.querySelectorAll('[data-dow="0"] [data-vs]')).toHaveLength(1)
    expect(document.querySelector('[data-quincena="2026-11-01"] [data-vs="anioMismoDiaSemana"]')).toBeNull()
    expect(document.body.textContent).not.toContain('contra el año pasado')
    expect(cargar.mock.calls.length).toBe(llamadas)
  })

  it('«Comparar con» = «Año pasado, mismas fechas» (repuesta): lee esa base y la muestra sola', async () => {
    abrir('/ventas?tab=tiempos')
    await screen.findByRole('table', { name: 'Día de semana' })
    fireEvent.change(screen.getByLabelText('Comparar con'), { target: { value: 'anioFechas' } })
    await vi.waitFor(() => expect(ultima.url).toContain('c=anioFechas'))
    await vi.waitFor(() => expect(document.querySelector('[data-dow="0"] [data-vs="anioMismasFechas"]')).not.toBeNull())
    expect(document.querySelectorAll('[data-dow="0"] [data-vs]')).toHaveLength(1)
    expect(cargar).toHaveBeenLastCalledWith('santa-teresa', expect.arrayContaining([{ desde: '2025-11-01', hasta: '2025-11-17' }]))
    expect(document.body.textContent).toContain('contra el año pasado, mismas fechas (1–17 nov 2025)')
    expect(document.querySelector('[data-dow="0"] [data-vs="anioMismasFechas"]')!.textContent).toBe('—') // el fixture no tiene 2025
  })

  it('períodos repuestos: «Año a la fecha» y «Temporada» leen su período y muestran la tabla', async () => {
    abrir('/ventas?tab=tiempos&p=anioALaFecha')
    await screen.findByRole('table', { name: 'Día de semana' })
    expect(cargar).toHaveBeenCalledWith('santa-teresa', expect.arrayContaining([{ desde: '2026-01-01', hasta: '2026-11-17' }]))
    expect((screen.getByLabelText('Período') as HTMLSelectElement).selectedOptions[0].textContent).toBe('Año a la fecha')
    cleanup(); cargar.mockClear()
    abrir('/ventas?tab=tiempos&p=temporada')
    await screen.findByRole('table', { name: 'Día de semana' })
    expect((screen.getByLabelText('Período') as HTMLSelectElement).selectedOptions[0].textContent).toBe('Temporada')
    expect(cargar).toHaveBeenCalled()
    expect(document.body.textContent).toMatch(/temporada anterior/)
  })

  it('una sola barra: Período con todas las opciones; Desde y Hasta solo con Rango', async () => {
    abrir('/ventas?tab=tiempos')
    await screen.findByRole('table', { name: 'Día de semana' })
    expect([...(screen.getByLabelText('Período') as HTMLSelectElement).options].map(o => o.textContent))
      .toEqual(['Hoy', 'Ayer', 'Semana', 'Quincena', 'Mes', 'Año a la fecha', 'Temporada', 'Rango'])
    expect(screen.queryByLabelText('Desde')).toBeNull()
    fireEvent.change(screen.getByLabelText('Período'), { target: { value: 'rango' } })
    await vi.waitFor(() => expect(ultima.url).toContain('p=rango'))
    expect(screen.getByLabelText('Desde')).toBeTruthy()
    expect(screen.getByLabelText('Hasta')).toBeTruthy()
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
    expect(netaTotal()).toBe(fi(tot.ventaNeta))
  })

  it('sin la 193 (base vieja): turno por la 080 = Contabilidad, mapa solo de salón, sin tiempo sentado', async () => {
    conLa193 = false
    abrir('/ventas?tab=tiempos')
    await screen.findByRole('table', { name: 'Día de semana' })
    const tot = contabilidad('2026-11-01', '2026-11-17')
    expect(netaTotal()).toBe(fi(tot.ventaNeta))
    expect(celdas('[data-fila="total-turno"]')[1]).toBe(fi(tot.ventaNeta))
    expect(turnos).toHaveBeenCalled()
    expect(document.body.textContent).toContain('Mapa por hora · solo salón')
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

  it('«Hoy» (repuesto) no lee nada y lleva a En vivo; «Ayer» (repuesto) lee ese día', async () => {
    abrir('/ventas?tab=tiempos&p=hoy')
    fireEvent.click(await screen.findByRole('button', { name: /Ir a En vivo/ }))
    expect(cargar).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(ultima.url).toContain('tab=envivo'))
    cleanup()
    abrir('/ventas?tab=tiempos&p=ayer')
    await screen.findByRole('table', { name: 'Día de semana' })
    expect(cargar).toHaveBeenCalledWith('santa-teresa', expect.arrayContaining([{ desde: '2026-11-17', hasta: '2026-11-17' }]))
  })
})
