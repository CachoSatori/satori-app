// Ventas v2 · 3.5.1 (SPEC-ventas-v2 §12.4 y §12.5): el menú de seis entradas, las vistas viejas como
// sub-vistas de su entrada nueva, las redirecciones de los `?tab=` viejos y los permisos de siempre.
// Las tablas de este archivo están escritas a mano A PROPÓSITO (no se derivan de `ventasTabs.ts`):
// si alguien cambia una entrada, una sub-vista, una dirección o un rol, una prueba cae.
import { describe, it, expect } from 'vitest'
import {
  TABS, ENTRADAS, CLAVE_V, tabPorDefecto, resolverDireccion, resolverVista, direccionDe, entradasVisibles,
  entradaDe, type Tab,
} from './ventasTabs'

const ROLES = ['owner', 'manager', 'contador'] as const
const OMC = ['owner', 'manager', 'contador']
const OM  = ['owner', 'manager']

/** Quién ve cada vista: los roles de ANTES de la 3.5 (SPEC §6: «No cambia ningún permiso»). */
const ROLES_DE_SIEMPRE: Record<Tab, string[]> = {
  hoy: OMC, envivo: OMC, saloneros: OM, salolineas: OM, evaluacion: OM, icp: OMC, cajeros: OMC,
  ventas: OMC, historico: OMC, mix: OMC, analisis: OMC, calendario: OMC, menueng: OM, metas: OMC,
  competencias: OM, config: OM, resumen: OMC, tiempos: OMC, internas: OM,
}

/**
 * SPEC §12.2/§12.4: cada `?tab=` viejo → su dirección nueva (entrada y `v`). Las vistas que se
 * retiran en el 3.5.2–3.5.4 abren, mientras tanto, como sub-vista de su entrada nueva.
 */
const DIRECCION_NUEVA: Record<Tab, string> = {
  resumen:      'tab=resumen',
  hoy:          'tab=resumen&v=hoy',
  ventas:       'tab=resumen&v=ventas',
  historico:    'tab=resumen&v=historico',
  analisis:     'tab=resumen&v=analisis',
  mix:          'tab=productos',
  menueng:      'tab=productos&v=menu',
  saloneros:    'tab=equipo',
  salolineas:   'tab=equipo&v=lineas',
  evaluacion:   'tab=equipo&v=evaluacion',
  icp:          'tab=equipo&v=icp',
  cajeros:      'tab=equipo&v=cajas',
  competencias: 'tab=equipo&v=competencias',
  tiempos:      'tab=tiempos',
  calendario:   'tab=tiempos&v=calendario',
  envivo:       'tab=envivo',
  metas:        'tab=ajustes',
  config:       'tab=ajustes&v=productos',
  internas:     'tab=ajustes&v=internas',
}

const texto = (d: { tab: string | null; v: string | null }) =>
  d.tab === null ? '' : `tab=${d.tab}${d.v ? `&v=${d.v}` : ''}`

describe('ventasTabs · 3.5.1 menú de seis entradas', () => {
  it('criterio 1: owner y manager ven Resumen · Productos · Equipo · Tiempos · En vivo · Ajustes, en ese orden', () => {
    for (const role of ['owner', 'manager']) {
      expect(entradasVisibles(role).map(e => e.label)).toEqual(['Resumen', 'Productos', 'Equipo', 'Tiempos', 'En vivo', 'Ajustes'])
    }
  })

  it('las 19 vistas siguen ahí y cada una está en exactamente una entrada', () => {
    expect(TABS).toHaveLength(19)
    const enEntradas = ENTRADAS.flatMap(e => e.vistas)
    expect(enEntradas).toHaveLength(19)
    expect(new Set(enEntradas)).toEqual(new Set(TABS.map(t => t.id)))
  })

  it('cada entrada lleva sus vistas viejas, sin cambiarles el nombre (SPEC §12.4)', () => {
    const conNombres = Object.fromEntries(ENTRADAS.map(e => [e.id, e.vistas.map(v => TABS.find(t => t.id === v)!.label)]))
    expect(conNombres).toEqual({
      resumen:   ['Resumen', 'Hoy', 'Ventas', 'Histórico', 'Análisis'],
      productos: ['Mix', 'Ing. Menú'],
      equipo:    ['Saloneros', 'Por línea', 'Evaluación', 'ICP', 'Cajeros', 'Competencias'],
      tiempos:   ['Tiempos', 'Calendario'],
      envivo:    ['En vivo'],
      ajustes:   ['Metas', 'Productos', 'Mesas internas'],
    })
  })

  it('«Regalías» todavía no está (se suma en el 3.5.2, D11)', () => {
    for (const role of ROLES) expect(entradasVisibles(role).map(e => e.label)).not.toContain('Regalías')
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
      resumen: ['resumen', 'hoy', 'ventas', 'historico', 'analisis'], productos: ['mix', 'menueng'],
      equipo: ['saloneros', 'salolineas', 'evaluacion', 'icp', 'cajeros', 'competencias'],
      tiempos: ['tiempos', 'calendario'], envivo: ['envivo'], ajustes: ['metas', 'config', 'internas'],
    }],
    ['manager', {
      resumen: ['resumen', 'hoy', 'ventas', 'historico', 'analisis'], productos: ['mix', 'menueng'],
      equipo: ['saloneros', 'salolineas', 'evaluacion', 'icp', 'cajeros', 'competencias'],
      tiempos: ['tiempos', 'calendario'], envivo: ['envivo'], ajustes: ['metas', 'config', 'internas'],
    }],
    ['contador', {
      resumen: ['resumen', 'hoy', 'ventas', 'historico', 'analisis'], productos: ['mix'],
      equipo: ['icp', 'cajeros'],
      tiempos: ['tiempos', 'calendario'], envivo: ['envivo'], ajustes: ['metas'],
    }],
  ])('%s: entradas y sub-vistas que ve', (role, esperado) => {
    expect(Object.fromEntries(entradasVisibles(role).map(e => [e.id, e.vistas]))).toEqual(esperado)
  })

  it('el contador no ve «Ing. Menú», «Saloneros», «Por línea», «Evaluación», «Competencias», «Ajustes → Productos» ni «Mesas internas»', () => {
    const ve = entradasVisibles('contador').flatMap(e => e.vistas)
    for (const v of ['menueng', 'saloneros', 'salolineas', 'evaluacion', 'competencias', 'config', 'internas'] as Tab[]) {
      expect(ve).not.toContain(v)
      expect(resolverDireccion('contador', direccionDe(v).tab, CLAVE_V[v]).vista).toBe('resumen')
    }
  })

  it.each(['salonero', 'cajero', 'barman', 'cocina'])('%s no ve ninguna entrada de Ventas', role => {
    expect(entradasVisibles(role)).toEqual([])
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
    expect(resolverDireccion('owner', 'equipo', null).vista).toBe('saloneros')
    expect(resolverDireccion('contador', 'equipo', null).vista).toBe('icp')
    expect(resolverDireccion('contador', 'ajustes', null).vista).toBe('metas')
    expect(resolverDireccion('owner', 'ajustes', null).vista).toBe('metas')
  })

  it('resolverVista lee `tab` y `v` de la dirección (lo usa el menú lateral)', () => {
    expect(resolverVista('owner', new URLSearchParams('tab=equipo&v=icp'))).toBe('icp')
    expect(resolverVista('owner', new URLSearchParams('tab=calendario'))).toBe('calendario')
    expect(entradaDe(resolverVista('owner', new URLSearchParams('tab=calendario'))).id).toBe('tiempos')
  })
})
