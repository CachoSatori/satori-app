// @vitest-environment happy-dom
//
// Rediseño A2, en el DOM: el menú de Ventas con entradas y sub-pestañas, y la vista en la URL.
// Las vistas se reemplazan por marcadores: acá se prueba la navegación, no el contenido.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useEffect } from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'

let role = 'owner'
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { role } }) }))
vi.mock('../../shared/api/ventas', () => ({
  getProductMap: vi.fn(async () => ({})),
  getMetas: vi.fn(async () => ({ restaurante: {}, margen: {}, global: {}, salMetas: {} })),
  getComps: vi.fn(async () => []),
}))
vi.mock('./ventasFuente', () => ({
  cargarDiasEager: vi.fn(async () => ({ dias: {}, pm: {}, estadoPos: null, ultimoDiaXls: null })),
  cargarHistEager: vi.fn(async () => ({})),
  cargarDeFondo:   vi.fn(() => new Promise(() => {})),
}))
vi.mock('./AvisoFuentePos', () => ({ default: () => null }))
const vista = (n: string) => ({ default: () => <div data-testid="vista">{n}</div> })
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

import VentasModule from './VentasModule'
import { TABS } from './ventasTabs'

const ultima = { url: '' }
function Url() {
  const l = useLocation()
  useEffect(() => { ultima.url = l.pathname + l.search }, [l])
  return null
}

const nav: { atras: () => void } = { atras: () => {} }
function Atras() {
  const n = useNavigate()
  useEffect(() => { nav.atras = () => n(-1) }, [n])
  return null
}

function abrir(url: string) {
  return render(<MemoryRouter initialEntries={[url]}><VentasModule /><Url /><Atras /></MemoryRouter>)
}

beforeEach(() => { cleanup(); role = 'owner' })

describe('VentasModule · navegación', () => {
  it.each(['owner', 'manager', 'contador'])('%s sin ?tab= abre «Hoy»', async r => {
    role = r
    abrir('/ventas')
    expect((await screen.findByTestId('vista')).textContent).toBe('hoy')
  })

  it.each(TABS.filter(t => t.roles.includes('owner')).map(t => t.id))('owner abre ?tab=%s', async id => {
    abrir(`/ventas?tab=${id}`)
    expect((await screen.findByTestId('vista')).textContent).toBe(id)
  })

  it('manager con ?tab=paridad (solo owner) cae en «Hoy»', async () => {
    role = 'manager'
    abrir('/ventas?tab=paridad')
    expect((await screen.findByTestId('vista')).textContent).toBe('hoy')
  })

  it('tocar una entrada abre su primera vista y la deja en la URL', async () => {
    abrir('/ventas')
    await screen.findByTestId('vista')
    fireEvent.click(screen.getByRole('tab', { name: 'Histórico' }))
    expect((await screen.findByTestId('vista')).textContent).toBe('historico')
    await vi.waitFor(() => expect(ultima.url).toBe('/ventas?tab=historico'))
    fireEvent.click(screen.getByRole('tab', { name: 'Mix' }))
    expect((await screen.findByTestId('vista')).textContent).toBe('mix')
    await vi.waitFor(() => expect(ultima.url).toBe('/ventas?tab=mix'))
  })

  it('las sub-pestañas solo aparecen en entradas con varias vistas', async () => {
    abrir('/ventas?tab=icp')
    await screen.findByTestId('vista')
    expect(screen.getByRole('tablist', { name: 'Vistas de Saloneros' })).toBeTruthy()
    cleanup()
    abrir('/ventas?tab=metas')
    await screen.findByTestId('vista')
    expect(screen.queryByRole('tablist', { name: /Vistas de Metas/ })).toBeNull()
  })

  // ── A7 · ARIA, teclado, historial y `?tab=` inválido ──────────────────────────────────
  it('cada pestaña controla el panel y el panel la nombra', async () => {
    abrir('/ventas?tab=icp')
    await screen.findByTestId('vista')
    const panel = screen.getByRole('tabpanel')
    for (const t of screen.getAllByRole('tab')) expect(t.getAttribute('aria-controls')).toBe(panel.id)
    const activa = screen.getByRole('tab', { name: 'ICP' })
    expect(activa.getAttribute('aria-selected')).toBe('true')
    expect(panel.getAttribute('aria-labelledby')).toBe(activa.id)
  })

  it('flecha derecha e izquierda se mueven entre pestañas', async () => {
    abrir('/ventas?tab=hoy')
    await screen.findByTestId('vista')
    const hoy = screen.getByRole('tab', { name: 'Hoy' })
    hoy.focus()
    fireEvent.keyDown(hoy, { key: 'ArrowRight' })
    expect((await screen.findByTestId('vista')).textContent).toBe('envivo')
    const envivo = screen.getByRole('tab', { name: 'En vivo' })
    expect(document.activeElement).toBe(envivo)
    fireEvent.keyDown(envivo, { key: 'ArrowLeft' })
    await vi.waitFor(() => expect(screen.getByTestId('vista').textContent).toBe('hoy'))
  })

  it('cambiar de pestaña deja una entrada en el historial: Atrás vuelve a la anterior', async () => {
    abrir('/ventas?tab=historico')
    await screen.findByTestId('vista')
    fireEvent.click(screen.getByRole('tab', { name: 'Mix' }))
    await vi.waitFor(() => expect(ultima.url).toBe('/ventas?tab=mix'))
    nav.atras()
    await vi.waitFor(() => expect(ultima.url).toBe('/ventas?tab=historico'))
    expect((await screen.findByTestId('vista')).textContent).toBe('historico')
  })

  it.each([
    ['manager', 'paridad'],
    ['owner', 'no-existe'],
  ])('%s con ?tab=%s: se limpia de la URL y abre «Hoy»', async (r, t) => {
    role = r
    abrir(`/ventas?tab=${t}`)
    expect((await screen.findByTestId('vista')).textContent).toBe('hoy')
    await vi.waitFor(() => expect(ultima.url).toBe('/ventas'))
  })

  it('sin ?tab= no se escribe nada en la URL', async () => {
    abrir('/ventas')
    await screen.findByTestId('vista')
    expect(ultima.url).toBe('/ventas')
  })
})
