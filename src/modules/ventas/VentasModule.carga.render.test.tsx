// @vitest-environment happy-dom
//
// Rediseño A5, en el DOM: Ventas pide los datos A PEDIDO. Lo que se prueba:
//   · cada vista recibe los MISMOS datos que antes con los mismos datos de la base;
//   · En vivo y Por línea se pintan sin esperar los 90 días;
//   · la historia completa (`cargarDeFondo`) se pide solo al abrir una vista que la usa.
// Las vistas se reemplazan por marcadores que muestran lo que recibieron.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { DiasMap } from '../../shared/types/ventas'

let role = 'owner'
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { role } }) }))
vi.mock('../../shared/api/ventas', () => ({
  getProductMap: vi.fn(async () => ({ ROLL: { tipo: 'comida' } })),
  getMetas: vi.fn(async () => ({ restaurante: {}, margen: {}, global: { promPax: 1 }, salMetas: {} })),
  getComps: vi.fn(async () => []),
}))

const dia = (total: number) => ({ saloneros: {}, total } as unknown as DiasMap[string])
const D90: DiasMap  = { '2026-11-09': dia(1), '2026-11-10': dia(2) }
const FULL: DiasMap = { '2024-01-05': dia(3), '2026-11-09': dia(1), '2026-11-10': dia(2) }

let resolverEager: () => void = () => {}
let resolverFondo: () => void = () => {}
vi.mock('./ventasFuente', () => ({
  cargarDiasEager: vi.fn(() => new Promise(res => {
    resolverEager = () => res({ dias: D90, pm: { SAKE: { tipo: 'bebida' } }, estadoPos: 'ok' })
  })),
  cargarHistEager: vi.fn(async () => ({ xls: 1 })),
  cargarDeFondo:   vi.fn(() => new Promise(res => {
    resolverFondo = () => res({ dias: FULL, hist: { pos: 1 }, pm: {} })
  })),
}))
vi.mock('./AvisoFuentePos', () => ({ default: () => null }))

// Cada marcador muestra qué recibió: días, hist y si tiene metas.
interface P { dias?: DiasMap; hist?: Record<string, unknown>; metas?: unknown; pm?: Record<string, unknown> }
const vista = (n: string) => ({
  default: (p: P) => (
    <div data-testid="vista">
      {n}|dias:{p.dias ? Object.keys(p.dias).length : '-'}|hist:{p.hist ? Object.keys(p.hist).join(',') : '-'}
      |pm:{p.pm ? Object.keys(p.pm).sort().join(',') : '-'}|metas:{p.metas ? 'si' : '-'}
    </div>
  ),
})
vi.mock('./VentasEnVivo',         () => vista('envivo'))
vi.mock('./VentasEquipo',         () => vista('equipo'))
vi.mock('./VentasSaloneroLineas', () => vista('salolineas'))
vi.mock('./VentasProductos',      () => vista('productos'))
vi.mock('./VentasMix',            () => vista('mix'))
vi.mock('./VentasMetas',          () => vista('metas'))
vi.mock('./VentasCompetencias',   () => vista('competencias'))
vi.mock('./VentasCatalogo',       () => vista('config'))
vi.mock('./VentasCajeros',        () => vista('cajeros'))
vi.mock('./VentasICP',            () => vista('icp'))
vi.mock('./VentasMenuEng',        () => vista('menueng'))
vi.mock('./VentasResumen',        () => vista('resumen'))
vi.mock('./VentasTiempos',        () => vista('tiempos'))
vi.mock('./VentasMesasInternas',  () => vista('internas'))
vi.mock('./VentasRegalias',       () => vista('regalias'))

import * as fuente from './ventasFuente'
import VentasModule from './VentasModule'
import { TABS, VISTAS_SIN_DIAS, VISTAS_CON_FONDO } from './ventasTabs'

const CON_HIST = new Set(['mix', 'metas'])

const abrir = (url: string) =>
  render(<MemoryRouter initialEntries={[url]}><VentasModule /></MemoryRouter>)
const texto = async () => (await screen.findByTestId('vista')).textContent?.replace(/\s+/g, '')

beforeEach(() => {
  cleanup()
  role = 'owner'
  vi.mocked(fuente.cargarDiasEager).mockClear()
  vi.mocked(fuente.cargarDeFondo).mockClear()
})

describe('ventasTabs · qué necesita cada vista', () => {
  it('toda vista está en una sola clase: sin días o con fondo («Hoy», la única que pedía solo los 90 días, se retiró)', () => {
    for (const t of TABS) {
      const clases = [VISTAS_SIN_DIAS.has(t.id), VISTAS_CON_FONDO.has(t.id)].filter(Boolean)
      expect(clases, t.id).toHaveLength(1)
    }
  })
})

describe('VentasModule · carga a pedido (A5)', () => {
  it.each(['envivo', 'salolineas'])('%s se pinta sin pedir ni esperar los 90 días', async id => {
    abrir(`/ventas?tab=${id}`)
    expect(await texto()).toContain(`${id}|`)
    expect(fuente.cargarDiasEager).not.toHaveBeenCalled()
    expect(fuente.cargarDeFondo).not.toHaveBeenCalled()
  })

  // 3.5.1: el arranque pasa de «Hoy» a «Resumen», que lee lo suyo: entrar a Ventas ya no baja los 90 días.
  it.each(['owner', 'manager', 'contador'])('%s: /ventas abre «Resumen» sin pedir los 90 días ni la historia', async r => {
    role = r
    abrir('/ventas')
    expect(await texto()).toContain('resumen|')
    expect(fuente.cargarDiasEager).not.toHaveBeenCalled()
    expect(fuente.cargarDeFondo).not.toHaveBeenCalled()
  })

  it.each(['tab=resumen', 'tab=tiempos', 'tab=regalias', 'tab=hoy', 'tab=ventas', 'tab=historico', 'tab=analisis', 'tab=calendario', 'tab=equipo', 'tab=saloneros', 'tab=evaluacion'])('?%s no pide los 90 días ni la historia (criterio 12)', async q => {
    abrir(`/ventas?${q}`)
    expect(await texto()).toMatch(/^(resumen|tiempos|regalias|equipo)\|/)
    expect(fuente.cargarDiasEager).not.toHaveBeenCalled()
    expect(fuente.cargarDeFondo).not.toHaveBeenCalled()
  })

  it.each(['owner', 'manager', 'contador'])('3.5.4: %s en «Equipo» recibe las metas (y nada de los 90 días)', async r => {
    role = r
    abrir('/ventas?tab=equipo')
    expect(await texto()).toBe('equipo|dias:-|hist:-|pm:-|metas:si')
  })

  it('En vivo recibe las mismas metas de antes', async () => {
    abrir('/ventas?tab=envivo')
    expect(await texto()).toContain('metas:si')
  })

  it.each([...VISTAS_CON_FONDO])('%s pide la historia completa y, al llegar, recibe lo mismo que antes', async id => {
    abrir(`/ventas?tab=${id}`)
    await waitFor(() => expect(fuente.cargarDiasEager).toHaveBeenCalledTimes(1))
    resolverEager()
    // Mientras llega el fondo: los 90 días + el Excel, como antes.
    expect(await texto()).toContain(`${id}|dias:2`)
    await waitFor(() => expect(fuente.cargarDeFondo).toHaveBeenCalledWith({ xls: 1 }))
    resolverFondo()
    await waitFor(async () => expect(await texto()).toContain(`${id}|dias:3`))
    // Las que reciben `hist` pasan del Excel al hist con el PoS encima, como antes.
    if (CON_HIST.has(id)) expect(await texto()).toContain('hist:pos')
  })

  it('3.5.3: «Tiempos» recibe solo `hist` (2023, lo liviano de siempre), sin `dias` ni `pm`', async () => {
    abrir('/ventas?tab=tiempos')
    expect(await texto()).toBe('tiempos|dias:-|hist:xls|pm:-|metas:-')
    expect(fuente.cargarDiasEager).not.toHaveBeenCalled()
    expect(fuente.cargarDeFondo).not.toHaveBeenCalled()
  })

  it('de «Resumen» a «Tiempos» y a «Productos»: los 90 días y la historia se piden recién al entrar a «Mix», y una sola vez (3.2: «Productos» definitiva no los pide)', async () => {
    abrir('/ventas?tab=resumen')
    expect(await texto()).toContain('resumen|')
    expect(fuente.cargarDiasEager).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('tab', { name: 'Tiempos' }))
    expect(await texto()).toContain('tiempos|')
    expect(fuente.cargarDiasEager).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('tab', { name: 'Productos' }))
    await waitFor(() => expect(screen.getByTestId('vista').textContent).toContain('productos|'))
    expect(fuente.cargarDiasEager).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('tab', { name: 'Mix' }))
    await waitFor(() => expect(fuente.cargarDiasEager).toHaveBeenCalledTimes(1))
    resolverEager()
    await waitFor(() => expect(fuente.cargarDeFondo).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('tab', { name: 'Ing. Menú' }))
    expect(await texto()).toContain('menueng|')
    expect(fuente.cargarDeFondo).toHaveBeenCalledTimes(1)
    expect(fuente.cargarDiasEager).toHaveBeenCalledTimes(1)
  })
})
