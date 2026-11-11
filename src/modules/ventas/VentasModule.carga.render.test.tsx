// @vitest-environment happy-dom
//
// Rediseño A5, en el DOM: Ventas pide los datos A PEDIDO. Lo que se prueba:
//   · cada vista recibe los MISMOS datos que antes con los mismos datos de la base;
//   · En vivo, Paridad y Por línea se pintan sin esperar los 90 días;
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
    resolverEager = () => res({ dias: D90, pm: { SAKE: { tipo: 'bebida' } }, estadoPos: 'ok', ultimoDiaXls: null })
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
vi.mock('./VentasHoy',            () => vista('hoy'))
vi.mock('./VentasEnVivo',         () => vista('envivo'))
vi.mock('./VentasParidad',        () => vista('paridad'))
vi.mock('./VentasContabilidad',   () => vista('ventas'))
vi.mock('./VentasSaloneros',      () => vista('saloneros'))
vi.mock('./VentasSaloneroLineas', () => vista('salolineas'))
vi.mock('./VentasHistorico',      () => vista('historico'))
vi.mock('./VentasMix',            () => vista('mix'))
vi.mock('./VentasAnalisis',       () => vista('analisis'))
vi.mock('./VentasMetas',          () => vista('metas'))
vi.mock('./VentasCompetencias',   () => vista('competencias'))
vi.mock('./VentasXLS',            () => vista('xls'))
vi.mock('./VentasConfig',         () => vista('config'))
vi.mock('./VentasCajeros',        () => vista('cajeros'))
vi.mock('./VentasEvaluacion',     () => vista('evaluacion'))
vi.mock('./VentasICP',            () => vista('icp'))
vi.mock('./VentasCalendario',     () => vista('calendario'))
vi.mock('./VentasMenuEng',        () => vista('menueng'))

import * as fuente from './ventasFuente'
import VentasModule from './VentasModule'
import { TABS, VISTAS_SIN_DIAS, VISTAS_CON_FONDO } from './ventasTabs'

const CON_HIST = new Set(['ventas', 'historico', 'mix', 'analisis', 'calendario', 'metas'])

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
  it('toda vista está en una sola clase: sin días, con fondo, o «Hoy»', () => {
    for (const t of TABS) {
      const clases = [VISTAS_SIN_DIAS.has(t.id), VISTAS_CON_FONDO.has(t.id), t.id === 'hoy'].filter(Boolean)
      expect(clases, t.id).toHaveLength(1)
    }
  })
})

describe('VentasModule · carga a pedido (A5)', () => {
  it.each(['envivo', 'paridad', 'salolineas'])('%s se pinta sin pedir ni esperar los 90 días', async id => {
    abrir(`/ventas?tab=${id}`)
    expect(await texto()).toContain(`${id}|`)
    expect(fuente.cargarDiasEager).not.toHaveBeenCalled()
    expect(fuente.cargarDeFondo).not.toHaveBeenCalled()
  })

  it('En vivo recibe las mismas metas de antes', async () => {
    abrir('/ventas?tab=envivo')
    expect(await texto()).toContain('metas:si')
  })

  it('«Hoy» espera los 90 días y recibe lo mismo que antes, sin pedir la historia completa', async () => {
    abrir('/ventas?tab=hoy')
    await waitFor(() => expect(fuente.cargarDiasEager).toHaveBeenCalledTimes(1))
    expect(screen.queryByTestId('vista')).toBeNull()  // todavía esperando los 90 días
    resolverEager()
    // Mismos días (90) y el mismo pm fusionado: curado + familia del PoS.
    expect(await texto()).toBe('hoy|dias:2|hist:-|pm:ROLL,SAKE|metas:si')
    expect(fuente.cargarDeFondo).not.toHaveBeenCalled()
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

  it('de «Hoy» a «Análisis»: la historia se pide recién al entrar, y una sola vez', async () => {
    abrir('/ventas?tab=hoy')
    await waitFor(() => expect(fuente.cargarDiasEager).toHaveBeenCalled())
    resolverEager()
    await screen.findByText(/^hoy\|/)
    expect(fuente.cargarDeFondo).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('tab', { name: 'Análisis' }))
    await waitFor(() => expect(fuente.cargarDeFondo).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('tab', { name: 'Histórico' }))
    expect(await texto()).toContain('historico|')
    expect(fuente.cargarDeFondo).toHaveBeenCalledTimes(1)
    expect(fuente.cargarDiasEager).toHaveBeenCalledTimes(1)
  })
})
