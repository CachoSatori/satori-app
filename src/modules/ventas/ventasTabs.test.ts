// Rediseño A2: Ventas agrupado y con la pestaña en la URL. Fija que ninguna vista se perdió,
// que los roles de cada vista no cambiaron y que la pestaña de arranque es la de siempre.
import { describe, it, expect } from 'vitest'
import { TABS, ENTRADAS, tabPorDefecto, resolverTab, entradasVisibles, entradaDe } from './ventasTabs'

const ROLES = ['owner', 'manager', 'contador'] as const

describe('ventasTabs', () => {
  it('las 16 vistas siguen ahí (+ «Resumen» y «Tiempos» v2) y cada una está en exactamente una entrada', () => {
    expect(TABS).toHaveLength(18)
    const enEntradas = ENTRADAS.flatMap(e => e.vistas)
    expect(enEntradas).toHaveLength(18)
    expect(new Set(enEntradas)).toEqual(new Set(TABS.map(t => t.id)))
  })

  it('7 entradas + «Resumen» y «Tiempos» (v2, fases 2.1 y 2.3) + «Ajustes», con los grupos del PLAN', () => {
    expect(ENTRADAS.map(e => e.id)).toEqual(['hoy','resumen','tiempos','envivo','saloneros','analisis','historico','menueng','metas','ajustes'])
    expect(ENTRADAS.find(e => e.id === 'saloneros')!.vistas).toEqual(['saloneros','salolineas','evaluacion','icp','competencias'])
    expect(ENTRADAS.find(e => e.id === 'historico')!.vistas).toEqual(['historico','calendario','mix','ventas','cajeros'])
    expect(ENTRADAS.find(e => e.id === 'ajustes')!.vistas).toEqual(['config'])
  })

  it('los roles de cada vista son los de antes del rediseño', () => {
    const roles = Object.fromEntries(TABS.map(t => [t.id, [...t.roles].sort().join(',')]))
    const omc = 'contador,manager,owner', om = 'manager,owner'
    expect(roles).toEqual({
      hoy: omc, envivo: omc, saloneros: om, salolineas: om, evaluacion: om,
      icp: omc, cajeros: omc, ventas: omc, historico: omc, mix: omc, analisis: omc,
      calendario: omc, menueng: om, metas: omc, competencias: om, config: om,
      resumen: omc, tiempos: omc,
    })
  })

  it('«Resumen» y «Tiempos» van al final de TABS: no cambian la pestaña de arranque de nadie (conviven hasta la 3.5)', () => {
    expect(TABS.slice(-2).map(t => t.id)).toEqual(['resumen', 'tiempos'])
  })

  it.each(ROLES)('pestaña por defecto de %s: «Hoy», como antes', role => {
    expect(tabPorDefecto(role)).toBe('hoy')
    expect(resolverTab(role, null)).toBe('hoy')
  })

  it('?tab= abre esa vista si el rol la ve', () => {
    for (const role of ROLES) {
      for (const t of TABS) {
        expect(resolverTab(role, t.id)).toBe(t.roles.includes(role) ? t.id : 'hoy')
      }
    }
  })

  it('?tab= desconocido o vacío cae en la pestaña por defecto', () => {
    expect(resolverTab('owner', 'nada')).toBe('hoy')
    expect(resolverTab('owner', '')).toBe('hoy')
  })

  it('el contador ve Saloneros solo con ICP y no ve Ajustes ni Ing. Menú', () => {
    const e = entradasVisibles('contador')
    expect(e.find(x => x.id === 'saloneros')!.vistas).toEqual(['icp'])
    expect(e.map(x => x.id)).not.toContain('ajustes')
    expect(e.map(x => x.id)).not.toContain('menueng')
  })

  it('16-nov · todo del PoS: ningún rol ve «Paridad» ni «Cargar XLS», y sus ?tab= viejos caen en «Hoy»', () => {
    for (const role of ROLES) {
      const vistas = entradasVisibles(role).flatMap(e => e.vistas) as string[]
      expect(vistas).not.toContain('paridad')
      expect(vistas).not.toContain('xls')
      expect(resolverTab(role, 'paridad')).toBe('hoy')
      expect(resolverTab(role, 'xls')).toBe('hoy')
    }
    expect(entradasVisibles('manager').find(x => x.id === 'ajustes')!.vistas).toEqual(['config'])
    expect(entradasVisibles('owner').find(x => x.id === 'ajustes')!.vistas).toEqual(['config'])
  })

  it('cada vista sabe a qué entrada pertenece', () => {
    expect(entradaDe('mix').id).toBe('historico')
    expect(entradaDe('icp').id).toBe('saloneros')
    expect(entradaDe('config').id).toBe('ajustes')
  })
})
