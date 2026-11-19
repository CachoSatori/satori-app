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
import { armarLectura, cifrasDelRango } from './resumenV2'
import { mesDe, proyectarMes } from './proyeccion'
import { marcarInternas } from './tiemposV2Rpc'
import { getLocalesVentas } from './resumenV2Datos'
import type { Meta } from '../../shared/types/ventas'
const fx = datos('2026-09-01', 78)
const cargar = vi.fn(async () => armarLectura(fx.tickets, fx.lineas, { '026': 'SALONERO_A', '027': 'SALONERO_B' }))
const cargarRango = vi.fn(async () => armarLectura(fx.tickets, fx.lineas, {}))
vi.mock('./resumenV2Datos', () => ({
  cargarLecturaResumen: (...a: unknown[]) => cargar(...(a as [])),
  cargarLecturaRango: (...a: unknown[]) => cargarRango(...(a as [])),
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
const abrir = (url: string, metas?: Meta) => render(<MemoryRouter initialEntries={[url]}><VentasResumen metas={metas} /><Url /></MemoryRouter>)
const META_NOV = 5_000_000 // ficticia
const metas = { restaurante: { '2026-11': META_NOV }, margen: {}, global: {}, salMetas: {} } as unknown as Meta

function contabilidad(anio: number, mes: number) {
  const { dias } = armarDiasMap(fx.tickets, fx.lineas, { desde: '2026-09-01', hasta: '2026-11-17' }, { uploadedAt: 'x', avisar: () => {} })
  return totalesContabilidad(getContabilidadDays(anio, mes, dias, {}))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-19T05:30:00Z'))
  role = 'owner'
  cargar.mockClear()
  cargarRango.mockClear()
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
    expect(document.body.textContent).toContain('1 al 31 de octubre (31 días) contra el mes anterior (1–30 sep)')
    expect(document.body.textContent).toMatch(/Vas \d+ % (arriba|abajo) del mes anterior \(1–30 sep\)/)
    // Las tarjetas nombran la base con sus fechas (pedido del dueño del 18-nov), no «período anterior».
    expect(document.querySelector('[data-cifra="ventaNeta"]')!.textContent).toContain('vs mes anterior (1–30 sep): ₡')
    expect(document.body.textContent).not.toMatch(/período anterior/i)
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

  it('«Hoy» (repuesto) no lee nada y lleva a En vivo; el Período tiene todas las opciones', async () => {
    abrir('/ventas?tab=resumen&p=hoy')
    fireEvent.click(await screen.findByRole('button', { name: /Ir a En vivo/ }))
    expect(cargar).not.toHaveBeenCalled()
    expect([...(screen.getByLabelText('Período') as HTMLSelectElement).options].map(o => o.textContent))
      .toEqual(['Hoy', 'Ayer', 'Semana', 'Quincena', 'Mes', 'Año a la fecha', 'Temporada', 'Rango'])
    expect(screen.queryByLabelText('Comparar con')).toBeNull()
    await vi.waitFor(() => expect(ultima.url).toContain('tab=envivo'))
  })

  it('períodos repuestos: «Año a la fecha» y «Temporada» leen su período', async () => {
    abrir('/ventas?tab=resumen&p=anioALaFecha')
    await screen.findByRole('table', { name: 'Detalle por día' })
    expect(cargar).toHaveBeenCalledWith('santa-teresa', expect.objectContaining({ tipo: 'anioALaFecha', desde: '2026-01-01', hasta: '2026-11-17' }))
    cleanup(); cargar.mockClear()
    abrir('/ventas?tab=resumen&p=temporada')
    await screen.findByRole('table', { name: 'Detalle por día' })
    expect(cargar).toHaveBeenCalledWith('santa-teresa', expect.objectContaining({ tipo: 'temporada' }))
  })

  it('«Comparar con» = «Año pasado, mismas fechas» (repuesta): un solo %, con su nombre y fechas, sin volver a leer', async () => {
    abrir('/ventas?tab=resumen&p=mesALaFecha')
    await screen.findByRole('table', { name: 'Detalle por día' })
    const llamadas = cargar.mock.calls.length
    fireEvent.change(screen.getByLabelText('Comparar con'), { target: { value: 'anioFechas' } })
    await vi.waitFor(() => expect(ultima.url).toContain('c=anioFechas'))
    expect(document.querySelectorAll('[data-cifra="ventaNeta"] .vt2-delta')).toHaveLength(1)
    expect(document.body.textContent).toContain('contra el año pasado, mismas fechas (1–17 nov 2025)')
    expect(cargar.mock.calls.length).toBe(llamadas)
  })

  it('«Comparar con» una sola base: cada cifra con un solo %, en la URL y sin volver a leer', async () => {
    abrir('/ventas?tab=resumen&p=mesALaFecha')
    await screen.findByRole('table', { name: 'Detalle por día' })
    expect(document.querySelectorAll('[data-cifra="ventaNeta"] .vt2-delta')).toHaveLength(2)
    const llamadas = cargar.mock.calls.length
    fireEvent.change(screen.getByLabelText('Comparar con'), { target: { value: 'anterior' } })
    await vi.waitFor(() => expect(ultima.url).toContain('c=anterior'))
    expect(document.querySelectorAll('[data-cifra="ventaNeta"] .vt2-delta')).toHaveLength(1)
    expect(document.querySelector('[data-cifra="ventaNeta"] .vt2-delta')!.textContent).toContain('vs mes anterior a la misma fecha (1–17 oct)')
    expect(document.body.textContent).not.toContain('contra el año pasado')
    expect(screen.queryByLabelText('Base B')).toBeNull()
    expect(cargar.mock.calls.length).toBe(llamadas)
  })

  it('meta del mes: noviembre a la fecha (hasta ayer, 1–17 nov), con la proyección de `proyeccion.ts`', async () => {
    abrir('/ventas?tab=resumen&p=ayer', metas)
    const bloque = await screen.findByText(/Meta de noviembre · a la fecha \(hasta ayer, 1–17 nov\)/)
    expect(bloque).toBeTruthy()
    // Lee el mes hasta ayer y las 8 semanas lunes–domingo de los pesos (21-sep a 15-nov) hasta el 17-nov.
    expect(cargarRango).toHaveBeenCalledWith('santa-teresa', { desde: '2026-09-21', hasta: '2026-11-17' })
    const rango = { desde: '2026-09-21', hasta: '2026-11-17' }
    const l = armarLectura(fx.tickets, fx.lineas, {})
    const esperado = proyectarMes({ meta: META_NOV, mes: mesDe('2026-11-17'), N: '2026-11-17',
      netaPorDia: new Map(cifrasDelRango(l, rango).dias.map(d => [d.fecha, d.ventaNeta])), primerDiaConDatos: '2024-01-05' })
    await vi.waitFor(() => expect(document.querySelector('[data-meta="proyeccion"] .vt-kpi-val')).not.toBeNull())
    expect(document.querySelector('[data-meta="proyeccion"] .vt-kpi-val')!.textContent).toBe(fi(Math.round(esperado.proyeccion)))
    expect(document.querySelector('[data-meta="vendido"] .vt-kpi-val')!.textContent).toBe(fi(Math.round(esperado.vendido)))
    expect(document.querySelector('[data-meta="necesario"]')!.textContent).toContain('13 días que faltan (con hoy)')
    // El % de la meta aparece una sola vez (en «Vendido»); la proyección dice cuánto sobra o falta.
    expect(document.querySelector('[data-meta="vendido"]')!.textContent).toMatch(/\d+ % de la meta/)
    expect(document.querySelector('[data-meta="proyeccion"]')!.textContent).toMatch(/(sobre|debajo de) la meta/)
    expect(document.querySelector('[data-meta="proyeccion"]')!.textContent).not.toMatch(/\d+ % de la meta/)
    // Lo vendido a la fecha = la tarjeta de «Mes a la fecha» (mismo camino que Contabilidad).
    expect(esperado.vendido).toBe(cifrasDelRango(l, { desde: '2026-11-01', hasta: '2026-11-17' }).totales.ventaNeta)
  })

  it('meta del mes con mesas internas marcadas (decisión del dueño 18-nov 13:45): lo vendido es el de Contabilidad, igual', async () => {
    const base = armarLectura(fx.tickets, fx.lineas, {})
    const elegidas = base.facturas.filter(f => f.canal === 'salon' && f.fecha_registra.startsWith('2026-11-1')).slice(0, 3)
    const internas = elegidas.map(f => ({ id: f.id, dia: f.fecha_registra.slice(0, 10), hora: 20, canal: 'salon', netaCts: Math.round(f.neta * 100), pax: 2 }))
    cargarRango.mockResolvedValueOnce({ ...base, facturas: marcarInternas(base.facturas, internas), internas })
    abrir('/ventas?tab=resumen&p=ayer', metas)
    await vi.waitFor(() => expect(document.querySelector('[data-meta="vendido"] .vt-kpi-val')).not.toBeNull())
    const conta = cifrasDelRango(base, { desde: '2026-11-01', hasta: '2026-11-17' }).totales.ventaNeta
    expect(document.querySelector('[data-meta="vendido"] .vt-kpi-val')!.textContent).toBe(fi(conta))
  })

  it('meta del mes: sin meta cargada lo dice y no lee nada de más', async () => {
    abrir('/ventas?tab=resumen&p=ayer', { ...metas, restaurante: {} } as Meta)
    await screen.findByText(/No hay meta cargada para noviembre/)
    expect(cargarRango).not.toHaveBeenCalled()
  })

  it('meta del mes en otro local: avisa que no tiene meta propia y no lee ni proyecta', async () => {
    vi.mocked(getLocalesVentas).mockResolvedValue([{ id: 'santa-teresa', nombre: 'Local A' }, { id: 'local-b', nombre: 'Local B' }])
    abrir('/ventas?tab=resumen&p=ayer&local=local-b', metas)
    await screen.findByText(/este local todavía no tiene meta propia/)
    expect(cargarRango).not.toHaveBeenCalled()
    expect(document.querySelector('[data-meta="proyeccion"]')).toBeNull()
    expect(cargar).toHaveBeenCalledWith('local-b', expect.objectContaining({ tipo: 'ayer' }))
    vi.mocked(getLocalesVentas).mockResolvedValue([{ id: 'santa-teresa', nombre: 'Local A' }])
  })
})
