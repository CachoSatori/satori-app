// @vitest-environment happy-dom
//
// En el DOM: el menú de Ventas con entradas y sub-pestañas, y la vista en la URL. Desde el 3.5.1
// (SPEC-ventas-v2 §12.4): arranque en «Resumen» y redirección de los `?tab=` viejos. Desde el 3.5.2: siete
// entradas (con «Regalías»), «Resumen» sin sub-pestañas y «Hoy», «Ventas» e «Histórico» retiradas. Desde el 3.5.3:
// «Tiempos» sin sub-pestañas; «Análisis» y «Calendario» retiradas (abren «Tiempos» con su período).
// Las vistas se reemplazan por marcadores: acá se prueba la navegación, no el contenido.
import { describe, it, expect, vi, beforeEach, onTestFinished } from 'vitest'
import { useEffect } from 'react'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate, useNavigationType } from 'react-router-dom'

let role = 'owner'
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { role } }) }))
vi.mock('../../shared/api/ventas', () => ({
  getProductMap: vi.fn(async () => ({})),
  getMetas: vi.fn(async () => ({ restaurante: {}, margen: {}, global: {}, salMetas: {} })),
  getComps: vi.fn(async () => []),
}))
vi.mock('./ventasFuente', () => ({
  cargarDiasEager: vi.fn(async () => ({ dias: {}, pm: {}, estadoPos: null })),
  cargarHistEager: vi.fn(async () => ({})),
  cargarDeFondo:   vi.fn(() => new Promise(() => {})),
}))
vi.mock('./AvisoFuentePos', () => ({ default: () => null }))
const vista = (n: string) => ({ default: () => <div data-testid="vista">{n}</div> })
vi.mock('./VentasEnVivo',         () => vista('envivo'))
vi.mock('./VentasSaloneros',      () => vista('saloneros'))
vi.mock('./VentasSaloneroLineas', () => vista('salolineas'))
vi.mock('./VentasMix',            () => vista('mix'))
vi.mock('./VentasMetas',          () => vista('metas'))
vi.mock('./VentasCompetencias',   () => vista('competencias'))
vi.mock('./VentasConfig',         () => vista('config'))
vi.mock('./VentasCajeros',        () => vista('cajeros'))
vi.mock('./VentasEvaluacion',     () => vista('evaluacion'))
vi.mock('./VentasICP',            () => vista('icp'))
vi.mock('./VentasMenuEng',        () => vista('menueng'))
vi.mock('./VentasResumen',        () => vista('resumen'))
vi.mock('./VentasTiempos',        () => vista('tiempos'))
vi.mock('./VentasMesasInternas',  () => vista('internas'))
vi.mock('./VentasRegalias',       () => vista('regalias'))

import VentasModule from './VentasModule'
import { TABS, ENTRADAS, CLAVE_V, entradasVisibles, labelDe, type Tab } from './ventasTabs'

const ultima = { url: '', tipo: '' }
function Url() {
  const l = useLocation()
  const tipo = useNavigationType()
  useEffect(() => { ultima.url = l.pathname + l.search; ultima.tipo = tipo }, [l, tipo])
  return null
}

const nav: { atras: () => void } = { atras: () => {} }
function Atras() {
  const n = useNavigate()
  useEffect(() => { nav.atras = () => n(-1) }, [n])
  return null
}

function abrir(url: string, antes: string[] = []) {
  const entradas = [...antes, url]
  return render(
    <MemoryRouter initialEntries={entradas} initialIndex={entradas.length - 1}>
      <VentasModule /><Url /><Atras />
    </MemoryRouter>,
  )
}

const menu = () => screen.getByRole('tablist', { name: 'Vistas de Ventas' })
const subMenu = (entrada: string) => screen.getByRole('tablist', { name: `Vistas de ${entrada}` })

/** SPEC §12.2: `?tab=` viejo → dirección nueva (escrita a mano: si cambia el mapa, cae). */
const REDIRECCION: Record<string, string> = {
  mix: '/ventas?tab=productos', menueng: '/ventas?tab=productos&v=menu',
  saloneros: '/ventas?tab=equipo', salolineas: '/ventas?tab=equipo&v=lineas',
  evaluacion: '/ventas?tab=equipo&v=evaluacion', icp: '/ventas?tab=equipo&v=icp',
  cajeros: '/ventas?tab=equipo&v=cajas', competencias: '/ventas?tab=equipo&v=competencias',
  metas: '/ventas?tab=ajustes', config: '/ventas?tab=ajustes&v=productos', internas: '/ventas?tab=ajustes&v=internas',
}

beforeEach(() => { cleanup(); role = 'owner'; ultima.url = ''; ultima.tipo = '' })

describe('VentasModule · 3.5.1 menú y arranque', () => {
  it.each(['owner', 'manager', 'contador'])('%s sin ?tab= abre «Resumen» y no escribe nada en la URL', async r => {
    role = r
    abrir('/ventas')
    expect((await screen.findByTestId('vista')).textContent).toBe('resumen')
    expect(ultima.url).toBe('/ventas')
  })

  it.each(['owner', 'manager', 'contador'])('%s ve siete botones: Resumen · Productos · Equipo · Tiempos · Regalías · En vivo · Ajustes', async r => {
    role = r
    abrir('/ventas')
    await screen.findByTestId('vista')
    expect(within(menu()).getAllByRole('tab').map(t => t.textContent)).toEqual(
      ['Resumen', 'Productos', 'Equipo', 'Tiempos', 'Regalías', 'En vivo', 'Ajustes'],
    )
  })

  it('3.5.2 y 3.5.3: ni «Resumen» ni «Tiempos» tienen botones al lado («Calendario» y «Análisis» se retiraron)', async () => {
    abrir('/ventas')
    await screen.findByTestId('vista')
    expect(screen.queryByRole('tablist', { name: 'Vistas de Resumen' })).toBeNull()
    fireEvent.click(within(menu()).getByRole('tab', { name: 'Tiempos' }))
    await vi.waitFor(() => expect(screen.getByTestId('vista').textContent).toBe('tiempos'))
    await vi.waitFor(() => expect(ultima.url).toBe('/ventas?tab=tiempos'))
    expect(screen.queryByRole('tablist', { name: 'Vistas de Tiempos' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Calendario' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Análisis' })).toBeNull()
  })

  it.each(['owner', 'manager', 'contador'])('%s: «Regalías» abre su pantalla (el contador también, D7)', async r => {
    role = r
    abrir('/ventas')
    await screen.findByTestId('vista')
    fireEvent.click(within(menu()).getByRole('tab', { name: 'Regalías' }))
    await vi.waitFor(() => expect(screen.getByTestId('vista').textContent).toBe('regalias'))
    await vi.waitFor(() => expect(ultima.url).toBe('/ventas?tab=regalias'))
  })

  it('«En vivo» no lleva sub-pestañas', async () => {
    abrir('/ventas?tab=envivo')
    await screen.findByTestId('vista')
    expect(screen.queryByRole('tablist', { name: /Vistas de En vivo/ })).toBeNull()
  })
})

describe('VentasModule · cada vista vieja sigue accesible desde su pestaña nueva', () => {
  const casos = ['owner', 'manager', 'contador'].flatMap(r =>
    entradasVisibles(r).flatMap(e => e.vistas.map(v => [r, e.label, labelDe(v), v] as const)))

  it.each(casos)('%s: «%s» → «%s»', async (r, entrada, etiqueta, vista) => {
    role = r
    abrir('/ventas')
    await screen.findByTestId('vista')
    const e = within(menu()).getByRole('tab', { name: entrada })
    if (e.getAttribute('aria-selected') !== 'true') fireEvent.click(e)
    const sub = screen.queryByRole('tablist', { name: `Vistas de ${entrada}` })
    if (sub) fireEvent.click(within(sub).getByRole('tab', { name: etiqueta }))
    await vi.waitFor(() => expect(screen.getByTestId('vista').textContent).toBe(vista))
  })
})

describe('VentasModule · redirecciones (criterio 3)', () => {
  const casos = ['owner', 'manager', 'contador'].flatMap(r => TABS.map(t => [r, t.id] as const))

  it.each(casos)('%s con ?tab=%s: abre lo mismo de antes y reemplaza la dirección', async (r, viejo) => {
    role = r
    abrir(`/ventas?tab=${viejo}`, ['/'])
    const ve = TABS.find(t => t.id === viejo)!.roles.includes(r)
    expect((await screen.findByTestId('vista')).textContent).toBe(ve ? viejo : 'resumen')
    const esperada = !ve ? '/ventas' : (REDIRECCION[viejo] ?? `/ventas?tab=${viejo}`)
    await vi.waitFor(() => expect(ultima.url).toBe(esperada))
    if (ultima.url !== `/ventas?tab=${viejo}`) expect(ultima.tipo).toBe('REPLACE')
  })

  it('la redirección no suma un paso al «Atrás»: vuelve a la pantalla anterior', async () => {
    abrir('/ventas?tab=calendario', ['/caja'])
    await vi.waitFor(() => expect(ultima.url).toBe('/ventas?tab=tiempos&p=mesALaFecha'))
    nav.atras()
    await vi.waitFor(() => expect(ultima.url).toBe('/caja'))
  })

  it('la redirección conserva el local de la barra', async () => {
    abrir('/ventas?tab=icp&local=local-b&p=mes')
    await vi.waitFor(() => expect(ultima.url).toBe('/ventas?tab=equipo&local=local-b&p=mes&v=icp'))
    expect((await screen.findByTestId('vista')).textContent).toBe('icp')
  })

  // 3.5.2 (SPEC §12.2, D15) y 3.5.3: las retiradas abren su pestaña nueva con el período que las reemplaza, para los
  // tres roles, desde el `?tab=` de antes y desde su dirección de sub-vista. Reemplazan la dirección (sin paso extra).
  const RETIRADAS: [string, string][] = [
    ['tab=hoy', '/ventas?tab=resumen&p=ayer'],
    ['tab=ventas', '/ventas?tab=resumen&p=mesALaFecha'],
    ['tab=historico', '/ventas?tab=resumen&p=rango&desde=2026-10-19&hasta=2026-11-17'],
    ['tab=resumen&v=hoy', '/ventas?tab=resumen&p=ayer'],
    ['tab=resumen&v=ventas', '/ventas?tab=resumen&p=mesALaFecha'],
    ['tab=resumen&v=historico', '/ventas?tab=resumen&p=rango&desde=2026-10-19&hasta=2026-11-17'],
    ['tab=resumen&v=analisis', '/ventas?tab=tiempos&p=anioALaFecha'],
    ['tab=analisis', '/ventas?tab=tiempos&p=anioALaFecha'],
    ['tab=tiempos&v=analisis', '/ventas?tab=tiempos&p=anioALaFecha'],
    ['tab=calendario', '/ventas?tab=tiempos&p=mesALaFecha'],
    ['tab=tiempos&v=calendario', '/ventas?tab=tiempos&p=mesALaFecha'],
  ]
  it.each(['owner', 'manager', 'contador'].flatMap(r => RETIRADAS.map(([q, a]) => [r, q, a] as const)))(
    '%s con ?%s → %s', async (r, q, a) => {
      // Reloj de noche en CR: 23:30 del 18-nov (05:30 UTC del 19). «Histórico» → los 30 días que terminan ayer.
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-11-19T05:30:00Z'))
      onTestFinished(() => { vi.useRealTimers() })
      role = r
      abrir(`/ventas?${q}`, ['/'])
      await vi.waitFor(() => expect(ultima.url).toBe(a))
      expect(ultima.tipo).toBe('REPLACE')
      expect((await screen.findByTestId('vista')).textContent).toBe(new URL(a, 'http://x').searchParams.get('tab'))
    })

  it('una retirada con un día de otro período: queda el local, cambia el período y se limpia el día', async () => {
    abrir('/ventas?tab=hoy&local=local-b&p=semana&d=2026-11-03')
    await vi.waitFor(() => expect(ultima.url).toBe('/ventas?tab=resumen&local=local-b&p=ayer'))
    cleanup()
    abrir('/ventas?tab=tiempos&v=calendario&local=local-b&p=semana&d=2026-11-03')
    await vi.waitFor(() => expect(ultima.url).toBe('/ventas?tab=tiempos&local=local-b&p=mesALaFecha'))
  })

  it.each([
    ['manager', 'paridad'],
    ['owner', 'paridad'],
    ['contador', 'xls'],
    ['owner', 'no-existe'],
  ])('%s con ?tab=%s: se limpia de la URL y abre «Resumen»', async (r, t) => {
    role = r
    abrir(`/ventas?tab=${t}`)
    expect((await screen.findByTestId('vista')).textContent).toBe('resumen')
    await vi.waitFor(() => expect(ultima.url).toBe('/ventas'))
  })

  it('contador con la dirección nueva de una sub-vista que no ve (Equipo → Por línea): abre «Resumen»', async () => {
    role = 'contador'
    abrir('/ventas?tab=equipo&v=lineas')
    expect((await screen.findByTestId('vista')).textContent).toBe('resumen')
    await vi.waitFor(() => expect(ultima.url).toBe('/ventas'))
  })
})

describe('VentasModule · navegación', () => {
  it('tocar una entrada abre su primera vista y deja la entrada en la URL', async () => {
    abrir('/ventas')
    await screen.findByTestId('vista')
    fireEvent.click(within(menu()).getByRole('tab', { name: 'Productos' }))
    expect((await screen.findByTestId('vista')).textContent).toBe('mix')
    await vi.waitFor(() => expect(ultima.url).toBe('/ventas?tab=productos'))
    fireEvent.click(within(subMenu('Productos')).getByRole('tab', { name: 'Ing. Menú' }))
    expect((await screen.findByTestId('vista')).textContent).toBe('menueng')
    await vi.waitFor(() => expect(ultima.url).toBe('/ventas?tab=productos&v=menu'))
    fireEvent.click(within(subMenu('Productos')).getByRole('tab', { name: 'Mix' }))
    await vi.waitFor(() => expect(ultima.url).toBe('/ventas?tab=productos'))
  })

  it('contador: «Equipo» abre «ICP» (la primera que ve)', async () => {
    role = 'contador'
    abrir('/ventas')
    await screen.findByTestId('vista')
    fireEvent.click(within(menu()).getByRole('tab', { name: 'Equipo' }))
    expect((await screen.findByTestId('vista')).textContent).toBe('icp')
    await vi.waitFor(() => expect(ultima.url).toBe('/ventas?tab=equipo&v=icp'))
  })

  it('criterio 10: la barra se conserva al pasar de Resumen a Equipo y a Tiempos', async () => {
    abrir('/ventas?tab=resumen&p=mes&local=local-b')
    await screen.findByTestId('vista')
    fireEvent.click(within(menu()).getByRole('tab', { name: 'Equipo' }))
    await vi.waitFor(() => expect(ultima.url).toBe('/ventas?tab=equipo&p=mes&local=local-b'))
    fireEvent.click(within(menu()).getByRole('tab', { name: 'Tiempos' }))
    await vi.waitFor(() => expect(ultima.url).toBe('/ventas?tab=tiempos&p=mes&local=local-b'))
  })

  it('cada entrada con más de una vista tiene sub-pestañas', async () => {
    for (const e of ENTRADAS.filter(x => x.vistas.length > 1)) {
      cleanup()
      abrir(`/ventas?tab=${e.id}`)
      await screen.findByTestId('vista')
      expect(within(subMenu(e.label)).getAllByRole('tab').map(t => t.textContent)).toEqual(e.vistas.map(labelDe))
    }
  })

  // ── A7 · ARIA, teclado e historial ────────────────────────────────────────────────────
  it('cada pestaña controla el panel y el panel la nombra', async () => {
    abrir(`/ventas?tab=equipo&v=${CLAVE_V.icp}`)
    await screen.findByTestId('vista')
    const panel = screen.getByRole('tabpanel')
    for (const t of screen.getAllByRole('tab')) expect(t.getAttribute('aria-controls')).toBe(panel.id)
    const activa = screen.getByRole('tab', { name: 'ICP' })
    expect(activa.getAttribute('aria-selected')).toBe('true')
    expect(panel.getAttribute('aria-labelledby')).toBe(activa.id)
  })

  it('flecha derecha e izquierda se mueven entre entradas', async () => {
    abrir('/ventas?tab=envivo')
    await screen.findByTestId('vista')
    const vivo = within(menu()).getByRole('tab', { name: 'En vivo' })
    vivo.focus()
    fireEvent.keyDown(vivo, { key: 'ArrowRight' })
    expect((await screen.findByTestId('vista')).textContent).toBe('metas')
    const ajustes = within(menu()).getByRole('tab', { name: 'Ajustes' })
    expect(document.activeElement).toBe(ajustes)
    fireEvent.keyDown(ajustes, { key: 'ArrowLeft' })
    await vi.waitFor(() => expect(screen.getByTestId('vista').textContent).toBe('envivo'))
  })

  it('cambiar de pestaña deja una entrada en el historial: Atrás vuelve a la anterior', async () => {
    abrir('/ventas?tab=equipo&v=icp')
    await screen.findByTestId('vista')
    fireEvent.click(within(menu()).getByRole('tab', { name: 'Productos' }))
    await vi.waitFor(() => expect(ultima.url).toBe('/ventas?tab=productos'))
    nav.atras()
    await vi.waitFor(() => expect(ultima.url).toBe('/ventas?tab=equipo&v=icp'))
    expect((await screen.findByTestId('vista')).textContent).toBe('icp')
  })

  it('la vista que abre cada dirección nueva es la misma para el owner', async () => {
    const casos: [string, Tab][] = [['tab=tiempos', 'tiempos'], ['tab=ajustes&v=productos', 'config'], ['tab=equipo&v=cajas', 'cajeros'], ['tab=regalias', 'regalias']]
    for (const [q, vista] of casos) {
      cleanup()
      abrir(`/ventas?${q}`)
      expect((await screen.findByTestId('vista')).textContent).toBe(vista)
      expect(ultima.url).toBe(`/ventas?${q}`)
    }
  })
})
