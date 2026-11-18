// @vitest-environment happy-dom
//
// «Resumen» v2 en el DOM: la cifra de venta neta y la fila TOTAL del detalle son las de Contabilidad para el
// mismo período; el contador abre con el detalle desplegado; «Hoy» manda a En vivo; la barra vive en la URL.
// Datos ficticios. Reloj fijo DE NOCHE en CR (23:30 del 18-nov = 05:30 UTC del 19).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useEffect } from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'

let role = 'owner'
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { role } }) }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

import { datos } from './resumenV2.fixture'
import { armarLectura } from './resumenV2'
const fx = datos('2026-09-01', 78)
const cargar = vi.fn(async () => armarLectura(fx.tickets, fx.lineas, { '026': 'SALONERO_A', '027': 'SALONERO_B' }))
vi.mock('./resumenV2Datos', () => ({
  cargarLecturaResumen: (...a: unknown[]) => cargar(...(a as [])),
  getLocalesVentas: vi.fn(async () => [{ id: 'santa-teresa', nombre: 'Local A' }]),
}))

import VentasResumen from './VentasResumen'
import { armarDiasMap } from './ventasDiasDesdePos'
import { fi, getContabilidadDays, totalesContabilidad } from './ventasUtils'

const ultima = { url: '' }
function Url() {
  const l = useLocation()
  useEffect(() => { ultima.url = l.pathname + l.search }, [l])
  return null
}
const abrir = (url: string) => render(<MemoryRouter initialEntries={[url]}><VentasResumen /><Url /></MemoryRouter>)

function contabilidad(anio: number, mes: number) {
  const { dias } = armarDiasMap(fx.tickets, fx.lineas, { desde: '2026-09-01', hasta: '2026-11-17' }, { uploadedAt: 'x', avisar: () => {} })
  return totalesContabilidad(getContabilidadDays(anio, mes, dias, {}))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-19T05:30:00Z'))
  role = 'owner'
  cargar.mockClear()
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('VentasResumen', () => {
  it('octubre: la venta neta de la tarjeta y la fila TOTAL = Contabilidad de octubre', async () => {
    abrir('/ventas?tab=resumen&p=mes&d=2026-10-01')
    const tot = contabilidad(2026, 10)
    const tarjeta = await screen.findByText((_, el) => el?.getAttribute('data-cifra') === 'ventaNeta')
    expect(tarjeta.querySelector('.vt-kpi-val')!.textContent).toBe(fi(tot.ventaNeta))
    const fila = document.querySelector('[data-fila="total"]')!
    const celdas = [...fila.querySelectorAll('td')].map(td => td.textContent)
    expect(celdas).toEqual(['TOTAL', '', fi(tot.ventaBruta), fi(tot.iva), fi(tot.serv), fi(tot.ventaNeta),
      fi(tot.salon), fi(tot.delivery), String(tot.pax)])
    // Barra en palabras y la bajada con datos.
    expect(document.body.textContent).toContain('1 al 31 de octubre (31 días) contra 1 al 30 de septiembre')
    expect(document.body.textContent).toMatch(/Vas \d+ % (arriba|abajo) del período anterior/)
    // Personas = PAX de Contabilidad; venta por persona con su rótulo de estimadas.
    expect(document.querySelector('[data-cifra="personas"] .vt-kpi-val')!.textContent).toBe(tot.pax.toLocaleString('es-CR'))
    expect(document.querySelector('[data-cifra="ventaPorPersona"]')!.textContent).toMatch(/incluye \d+,\d % estimado/)
  })

  it('por defecto «Ayer» (17-nov, el último día cerrado) y la alerta de mesas sin pax por salonero', async () => {
    abrir('/ventas?tab=resumen')
    await screen.findByText(/Ayer \(2026-11-17\): mesas sin pax/)
    expect(document.body.textContent).toMatch(/(se cargaron enteras|se cargó entera) desde la caja/)
    expect(cargar).toHaveBeenCalledWith('santa-teresa', expect.objectContaining({ tipo: 'ayer', desde: '2026-11-17' }))
  })

  it('el contador abre con el detalle por día desplegado; el owner, plegado', async () => {
    role = 'contador'
    abrir('/ventas?tab=resumen&p=mesALaFecha')
    await screen.findByRole('table', { name: 'Detalle por día' })
    expect((document.querySelector('details.vt2-detalle') as HTMLDetailsElement).open).toBe(true)
    cleanup()
    role = 'owner'
    abrir('/ventas?tab=resumen&p=mesALaFecha')
    await screen.findByRole('table', { name: 'Detalle por día' })
    expect((document.querySelector('details.vt2-detalle') as HTMLDetailsElement).open).toBe(false)
  })

  it('«Hoy» no lee nada y lleva a En vivo', async () => {
    abrir('/ventas?tab=resumen&p=hoy')
    fireEvent.click(await screen.findByRole('button', { name: /Ir a En vivo/ }))
    expect(cargar).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(ultima.url).toContain('tab=envivo'))
  })

  it('cambiar la base B a «mismas fechas» queda en la URL y cambia el texto, sin volver a leer', async () => {
    abrir('/ventas?tab=resumen&p=mesALaFecha')
    await screen.findByRole('table', { name: 'Detalle por día' })
    const llamadas = cargar.mock.calls.length
    fireEvent.change(screen.getByLabelText('Base B'), { target: { value: 'anioMismasFechas' } })
    await vi.waitFor(() => expect(ultima.url).toContain('b=anioMismasFechas'))
    expect(document.body.textContent).toContain('contra 1 al 17 de noviembre de 2025')
    expect(cargar.mock.calls.length).toBe(llamadas)
  })
})
