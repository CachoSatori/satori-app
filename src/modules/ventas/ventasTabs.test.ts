// Ventas v2 · 3.5.1–3.5.4 (SPEC-ventas-v2 §12.4 y §12.5): el menú de siete entradas (con «Regalías», D11),
// las vistas viejas como sub-vistas de su entrada nueva, las retiradas («Hoy», «Ventas», «Histórico», D15, que
// abren «Resumen»; «Análisis» y «Calendario», 3.5.3, que abren «Tiempos»; «Saloneros» y «Evaluación», 3.5.4, que
// abren «Equipo») con su período, las redirecciones de los `?tab=` viejos y los permisos (D18, dueño 23-nov 22:35:
// el contador ve «Equipo» completo, igual que gerencia).
// Las tablas de este archivo están escritas a mano A PROPÓSITO (no se derivan de `ventasTabs.ts`):
// si alguien cambia una entrada, una sub-vista, una dirección o un rol, una prueba cae.
import { describe, it, expect } from 'vitest'
import {
  TABS, ENTRADAS, CLAVE_V, tabPorDefecto, resolverDireccion, resolverVista, direccionDe, entradasVisibles,
  entradaDe, veDetalleEquipo, type Tab,
} from './ventasTabs'

const ROLES = ['owner', 'manager', 'contador'] as const
const OMC = ['owner', 'manager', 'contador']
const OM  = ['owner', 'manager']

/** Quién ve cada vista: los roles de ANTES de la 3.5 (SPEC §6: «No cambia ningún permiso»). */
const ROLES_DE_SIEMPRE: Record<Tab, string[]> = {
  envivo: OMC, salolineas: OM, icp: OMC, cajeros: OMC,
  // 3.5.4: «Equipo» junta «Saloneros» y «Evaluación» (que eran OM). D18 (DUEÑO 23-nov 22:35 CR, corrige la de las 21:40):
  // el contador ve «Equipo» completo —ranking y detalle (evaluación, ICP por fila y ficha)—, igual que OM: `veDetalleEquipo`.
  equipo: OMC,
  mix: OMC, menueng: OM, metas: OMC,
  competencias: OM, config: OM, resumen: OMC, tiempos: OMC, internas: OM,
  regalias: OMC,   // 3.5.2: la ven los tres; el contador, completa (D7)
}

/** Las retiradas (3.5.2: D15; 3.5.3) y la pestaña con el período que las reemplaza (SPEC §12.2). */
// Con «hoy» = 18-nov: «Ventas» abre el mes en curso a la fecha; «Histórico», los 30 días que terminan ayer;
// «Análisis» («Año vs Año»), «Tiempos» con el año a la fecha («Meses y temporadas»); «Calendario», «Tiempos» con el
// mes en curso a la fecha (el período con que abre «Tiempos»).
const HOY = '2026-11-18'
const RETIRADA: Record<string, string> = {
  hoy:        'tab=resumen&p=ayer',
  ventas:     'tab=resumen&p=mesALaFecha',
  historico:  'tab=resumen&p=rango&desde=2026-10-19&hasta=2026-11-17',
  analisis:   'tab=tiempos&p=anioALaFecha',
  calendario: 'tab=tiempos&p=mesALaFecha',
}
/** Las direcciones de sub-vista que tuvieron mientras convivieron (3.5.1 y 3.5.2): `[tab, v]`. */
const SUBVISTA_VIEJA: [string, string][] = [
  ['resumen', 'hoy'], ['resumen', 'ventas'], ['resumen', 'historico'],
  ['resumen', 'analisis'],                      // 3.5.1
  ['tiempos', 'analisis'], ['tiempos', 'calendario'],   // 3.5.1 (Calendario) y 3.5.2 (Análisis)
]

/** Las retiradas del 3.5.4: abren «Equipo» con el período con que abría la vista vieja. */
const RETIRADA_EQUIPO: Record<string, string> = {
  saloneros:  'tab=equipo&p=ayer',
  evaluacion: 'tab=equipo&p=rango&desde=2026-10-19&hasta=2026-11-17',
}

/**
 * SPEC §12.2/§12.4: cada `?tab=` viejo → su dirección nueva (entrada y `v`). Las vistas que se
 * retiran en el 3.5.2–3.5.4 abren, mientras tanto, como sub-vista de su entrada nueva.
 */
const DIRECCION_NUEVA: Record<Tab, string> = {
  resumen:      'tab=resumen',
  regalias:     'tab=regalias',
  mix:          'tab=productos',
  menueng:      'tab=productos&v=menu',
  equipo:       'tab=equipo',
  salolineas:   'tab=equipo&v=lineas',
  icp:          'tab=equipo&v=icp',
  cajeros:      'tab=equipo&v=cajas',
  competencias: 'tab=equipo&v=competencias',
  tiempos:      'tab=tiempos',
  envivo:       'tab=envivo',
  metas:        'tab=ajustes',
  config:       'tab=ajustes&v=productos',
  internas:     'tab=ajustes&v=internas',
}

const texto = (d: { tab: string | null; v: string | null; p?: string; desde?: string; hasta?: string }) =>
  d.tab === null ? '' : `tab=${d.tab}${d.v ? `&v=${d.v}` : ''}${d.p ? `&p=${d.p}` : ''}${d.desde ? `&desde=${d.desde}&hasta=${d.hasta}` : ''}`

describe('ventasTabs · menú de siete entradas (3.5.2; «Tiempos» sin sub-pestañas desde el 3.5.3)', () => {
  it.each(ROLES)('criterio 1: %s ve Resumen · Productos · Equipo · Tiempos · Regalías · En vivo · Ajustes, en ese orden', role => {
    expect(entradasVisibles(role).map(e => e.label)).toEqual(['Resumen', 'Productos', 'Equipo', 'Tiempos', 'Regalías', 'En vivo', 'Ajustes'])
  })

  it('14 vistas (19 − «Hoy», «Ventas», «Histórico», «Análisis», «Calendario», «Saloneros», «Evaluación» + «Regalías», «Equipo») y cada una en exactamente una entrada', () => {
    expect(TABS).toHaveLength(14)
    const enEntradas = ENTRADAS.flatMap(e => e.vistas)
    expect(enEntradas).toHaveLength(14)
    expect(new Set(enEntradas)).toEqual(new Set(TABS.map(t => t.id)))
    for (const v of ['hoy', 'ventas', 'historico', 'analisis', 'calendario', 'saloneros', 'evaluacion']) expect(TABS.map(t => t.id as string)).not.toContain(v)
  })

  it('cada entrada lleva sus vistas, sin cambiarles el nombre; «Resumen» y «Tiempos» ya no llevan sub-pestañas (SPEC §12.4)', () => {
    const conNombres = Object.fromEntries(ENTRADAS.map(e => [e.id, e.vistas.map(v => TABS.find(t => t.id === v)!.label)]))
    expect(conNombres).toEqual({
      resumen:   ['Resumen'],
      productos: ['Mix', 'Ing. Menú'],
      equipo:    ['Equipo', 'Por línea', 'ICP', 'Cajas y canales', 'Competencias'],
      tiempos:   ['Tiempos'],
      regalias:  ['Regalías'],
      envivo:    ['En vivo'],
      ajustes:   ['Metas', 'Productos', 'Mesas internas'],
    })
  })
})

describe('ventasTabs · permisos iguales que antes (criterio 8)', () => {
  it('los roles de cada vista son los de antes de la 3.5', () => {
    expect(Object.fromEntries(TABS.map(t => [t.id, [...t.roles].sort()]))).toEqual(
      Object.fromEntries(Object.entries(ROLES_DE_SIEMPRE).map(([k, r]) => [k, [...r].sort()])),
    )
  })

  // SPEC §6, rol × sub-vista: lo que se ve en cada entrada.
  it.each([
    ['owner', {
      resumen: ['resumen'], productos: ['mix', 'menueng'],
      equipo: ['equipo', 'salolineas', 'icp', 'cajeros', 'competencias'],
      tiempos: ['tiempos'], regalias: ['regalias'], envivo: ['envivo'], ajustes: ['metas', 'config', 'internas'],
    }],
    ['manager', {
      resumen: ['resumen'], productos: ['mix', 'menueng'],
      equipo: ['equipo', 'salolineas', 'icp', 'cajeros', 'competencias'],
      tiempos: ['tiempos'], regalias: ['regalias'], envivo: ['envivo'], ajustes: ['metas', 'config', 'internas'],
    }],
    ['contador', {
      resumen: ['resumen'], productos: ['mix'],
      equipo: ['equipo', 'icp', 'cajeros'],
      tiempos: ['tiempos'], regalias: ['regalias'], envivo: ['envivo'], ajustes: ['metas'],
    }],
  ])('%s: entradas y sub-vistas que ve', (role, esperado) => {
    expect(Object.fromEntries(entradasVisibles(role).map(e => [e.id, e.vistas]))).toEqual(esperado)
  })

  it('el contador no ve «Ing. Menú», «Por línea», «Competencias», «Ajustes → Productos» ni «Mesas internas»', () => {
    const ve = entradasVisibles('contador').flatMap(e => e.vistas)
    for (const v of ['menueng', 'salolineas', 'competencias', 'config', 'internas'] as Tab[]) {
      expect(ve).not.toContain(v)
      expect(resolverDireccion('contador', direccionDe(v).tab, CLAVE_V[v]).vista).toBe('resumen')
    }
  })

  it.each(['salonero', 'cajero', 'barman', 'cocina'])('%s no ve ninguna entrada de Ventas', role => {
    expect(entradasVisibles(role)).toEqual([])
    expect(resolverDireccion(role, 'regalias', null)).toEqual({ vista: 'resumen', corregir: { tab: null, v: null } })
  })

  it('D18 (dueño 23-nov 22:35): el contador ve «Equipo» completo, con su detalle (evaluación, ICP por fila, ficha), igual que gerencia', () => {
    expect(resolverDireccion('contador', 'equipo', null)).toEqual({ vista: 'equipo', corregir: null })
    expect(veDetalleEquipo('contador')).toBe(true)
    expect(veDetalleEquipo('owner')).toBe(true)
    expect(veDetalleEquipo('manager')).toBe(true)
    for (const r of ['salonero', 'cajero', 'barman', 'cocina', '']) expect(veDetalleEquipo(r)).toBe(false)
  })

  it('D7: el contador ve «Regalías» completa (la misma vista que owner y manager)', () => {
    expect(resolverDireccion('contador', 'regalias', null)).toEqual({ vista: 'regalias', corregir: null })
    expect(entradasVisibles('contador').find(e => e.id === 'regalias')!.vistas).toEqual(['regalias'])
  })
})

describe('ventasTabs · arranque (criterio 2)', () => {
  it.each(ROLES)('%s sin ?tab= abre «Resumen» y no toca la dirección', role => {
    expect(tabPorDefecto(role)).toBe('resumen')
    expect(resolverDireccion(role, null, null)).toEqual({ vista: 'resumen', corregir: null })
  })
})

describe('ventasTabs · redirecciones de los ?tab= viejos (criterio 3)', () => {
  const casos = ROLES.flatMap(role => TABS.map(t => [role, t.id] as const))

  const vistaDe = (dir: string) => new URLSearchParams(dir).get('tab')

  it.each(ROLES.flatMap(r => Object.keys(RETIRADA).map(t => [r, t] as const)))(
    '%s con ?tab=%s (retirada): abre su pestaña nueva con su período', (role, viejo) => {
      const r = resolverDireccion(role, viejo, null, HOY)
      expect(r.vista).toBe(vistaDe(RETIRADA[viejo]))
      expect(texto(r.corregir!)).toBe(RETIRADA[viejo])
    })

  it.each(ROLES.flatMap(r => SUBVISTA_VIEJA.map(([t, v]) => [r, t, v] as const)))(
    '%s con la dirección de sub-vista ?tab=%s&v=%s: abre la pestaña nueva con su período', (role, tab, v) => {
      const r = resolverDireccion(role, tab, v, HOY)
      expect(r.vista).toBe(vistaDe(RETIRADA[v]))
      expect(texto(r.corregir!)).toBe(RETIRADA[v])
    })

  it.each(ROLES.flatMap(r => Object.keys(RETIRADA_EQUIPO).map(t => [r, t] as const)))(
    '%s con ?tab=%s (retirada en el 3.5.4): abre «Equipo» con su período', (role, viejo) => {
      const r = resolverDireccion(role, viejo, null, HOY)
      expect(r.vista).toBe('equipo')
      expect(texto(r.corregir!)).toBe(RETIRADA_EQUIPO[viejo])
    })

  it.each(ROLES.flatMap(r => Object.keys(RETIRADA_EQUIPO).map(t => [r, t] as const)))(
    '%s con la dirección de sub-vista ?tab=equipo&v=%s (3.5.1–3.5.3): abre «Equipo» con su período', (role, viejo) => {
      const r = resolverDireccion(role, 'equipo', viejo, HOY)
      expect(r.vista).toBe('equipo')
      expect(texto(r.corregir!)).toBe(RETIRADA_EQUIPO[viejo])
    })

  it('una retirada solo se reconoce en la entrada donde vivió', () => {
    expect(resolverDireccion('owner', 'resumen', 'saloneros')).toEqual({ vista: 'resumen', corregir: { tab: null, v: null } })
    expect(resolverDireccion('owner', 'tiempos', 'evaluacion')).toEqual({ vista: 'resumen', corregir: { tab: null, v: null } })
    expect(resolverDireccion('owner', 'equipo', 'hoy')).toEqual({ vista: 'resumen', corregir: { tab: null, v: null } })
    expect(resolverDireccion('owner', 'equipo', 'calendario')).toEqual({ vista: 'resumen', corregir: { tab: null, v: null } })
    expect(resolverDireccion('owner', 'resumen', 'calendario')).toEqual({ vista: 'resumen', corregir: { tab: null, v: null } })
    expect(resolverDireccion('owner', 'tiempos', 'hoy')).toEqual({ vista: 'resumen', corregir: { tab: null, v: null } })
  })

  it.each(casos)('%s con ?tab=%s', (role, viejo) => {
    const r = resolverDireccion(role, viejo, null)
    if (!ROLES_DE_SIEMPRE[viejo].includes(role)) {
      // Lo que el rol no veía sigue sin verse: abre «Resumen» y la dirección se limpia.
      expect(r).toEqual({ vista: 'resumen', corregir: { tab: null, v: null } })
      return
    }
    expect(r.vista).toBe(viejo)
    const esEntrada = ENTRADAS.some(e => e.id === viejo)
    if (esEntrada) expect(r.corregir).toBeNull()                    // resumen, tiempos, envivo: ya son la dirección nueva
    else expect(texto(r.corregir!)).toBe(DIRECCION_NUEVA[viejo])
  })

  it.each(Object.entries(DIRECCION_NUEVA))('la dirección nueva de %s abre esa vista (owner) sin corregirse', (vista, dir) => {
    const sp = new URLSearchParams(dir)
    expect(resolverDireccion('owner', sp.get('tab'), sp.get('v'))).toEqual({ vista, corregir: null })
    expect(texto(direccionDe(vista as Tab))).toBe(dir)
  })

  it.each(ROLES.flatMap(r => ['paridad', 'xls', 'no-existe', ''].map(t => [r, t] as const)))(
    '%s con ?tab=%s (retirada o inválida) abre «Resumen»', (role, t) => {
      expect(resolverDireccion(role, t, null).vista).toBe('resumen')
    })

  it('un `v` que no existe en la entrada abre «Resumen» y limpia la dirección', () => {
    expect(resolverDireccion('owner', 'equipo', 'nada')).toEqual({ vista: 'resumen', corregir: { tab: null, v: null } })
    expect(resolverDireccion('owner', 'productos', 'internas')).toEqual({ vista: 'resumen', corregir: { tab: null, v: null } })
  })

  it('sin `v`, la entrada abre la primera sub-vista que el rol ve', () => {
    expect(resolverDireccion('owner', 'equipo', null).vista).toBe('equipo')
    expect(resolverDireccion('contador', 'equipo', null).vista).toBe('equipo')
    expect(resolverDireccion('contador', 'ajustes', null).vista).toBe('metas')
    expect(resolverDireccion('owner', 'ajustes', null).vista).toBe('metas')
  })

  it('resolverVista lee `tab` y `v` de la dirección (lo usa el menú lateral)', () => {
    expect(resolverVista('owner', new URLSearchParams('tab=equipo&v=icp'))).toBe('icp')
    expect(resolverVista('owner', new URLSearchParams('tab=hoy'))).toBe('resumen')
    expect(resolverVista('owner', new URLSearchParams('tab=resumen&v=analisis'))).toBe('tiempos')
    expect(resolverVista('owner', new URLSearchParams('tab=analisis'))).toBe('tiempos')
    expect(resolverVista('owner', new URLSearchParams('tab=calendario'))).toBe('tiempos')
    expect(entradaDe(resolverVista('owner', new URLSearchParams('tab=calendario'))).id).toBe('tiempos')
  })
})
