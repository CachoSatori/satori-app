// Rediseño B3: el menú global muestra exactamente los módulos que hoy muestra la grilla del Inicio.
// La lista esperada por rol es la grilla de `HomePage.tsx` de `main` antes del pase (17a9efd, con el Club),
// escrita a mano a propósito: si alguien cambia un `roles`, este test lo marca.
import { describe, it, expect } from 'vitest'
import { MODULES, modulosPara, menuPara, barraPara, llevaMenu, MAX_BOTONES_BARRA } from './modulos'
import { entradasVisibles } from '../../modules/ventas/ventasTabs'

const GRILLA_DE_HOY: Record<string, string[]> = {
  owner:     ['resumen', 'semana', 'reporte-mensual', 'mi-rendimiento', 'cash', 'tips', 'dashboard', 'inventario', 'clientes', 'club', 'finanzas', 'sops', 'admin', 'prueba'],
  manager:   ['resumen', 'semana', 'reporte-mensual', 'mi-rendimiento', 'cash', 'tips', 'dashboard', 'inventario', 'clientes', 'club', 'finanzas', 'sops'],
  contador:  ['resumen', 'semana', 'reporte-mensual', 'cash', 'tips', 'dashboard', 'inventario', 'club', 'finanzas'],
  cajero:    ['cash', 'tips', 'clientes', 'club', 'sops'],
  salonero:  ['mi-rendimiento', 'sops'],
  barman:    ['mi-rendimiento', 'sops'],
  barback:   ['mi-rendimiento', 'sops'],
  runner:    ['mi-rendimiento', 'sops'],
  cocina:    ['mi-rendimiento', 'sops'],
  proveedor: [],
}

const ROLES = Object.keys(GRILLA_DE_HOY)

describe('B3 · la grilla del Inicio no cambia', () => {
  it.each(ROLES)('%s: la grilla muestra los mismos módulos, en el mismo orden', role => {
    expect(modulosPara(role).map(m => m.id)).toEqual(GRILLA_DE_HOY[role])
  })

  it('todo módulo tiene grupo', () => {
    for (const m of MODULES) expect(m.grupo).toBeTruthy()
  })
})

describe('B3 · el menú muestra exactamente los módulos de la grilla', () => {
  it.each(ROLES)('%s', role => {
    const enMenu = new Set(menuPara(role).flatMap(g => g.items.map(i => i.moduloId)))
    expect([...enMenu].sort()).toEqual([...GRILLA_DE_HOY[role]].sort())
  })

  it.each(ROLES)('%s: la barra inferior solo tiene módulos de su grilla y como mucho 5 botones', role => {
    const b = barraPara(role)
    for (const m of b.directos) expect(GRILLA_DE_HOY[role]).toContain(m.id)
    expect(1 + b.directos.length + (b.conMas ? 1 : 0)).toBeLessThanOrEqual(MAX_BOTONES_BARRA)
    // Lo que no entra en la barra queda en «Más».
    if (!b.conMas) expect(b.directos.length).toBe(GRILLA_DE_HOY[role].length)
  })
})

describe('B3 · quién lleva menú', () => {
  it('el personal con 3 módulos o menos no lleva menú', () => {
    for (const role of ROLES) {
      expect(llevaMenu(role)).toBe(GRILLA_DE_HOY[role].length > 3)
    }
    expect(llevaMenu('runner')).toBe(false)
    expect(llevaMenu('cocina')).toBe(false)
    expect(llevaMenu('proveedor')).toBe(false)
    expect(llevaMenu('salonero')).toBe(false)   // en main el salonero tiene 2 módulos (sin Mi Turno ni Comandero)
  })
})

describe('B3 · Ventas en el menú', () => {
  it.each(['owner', 'manager', 'contador'])('%s: las entradas de Ventas llevan a /ventas?tab=…', role => {
    const ventas = menuPara(role).find(g => g.id === 'ventas')!
    const esperadas = entradasVisibles(role)
    expect(ventas.items.map(i => i.entrada)).toEqual(esperadas.map(e => e.id))
    for (const [k, it] of ventas.items.entries()) {
      expect(it.to).toBe(`/ventas?tab=${esperadas[k].id}`)
    }
  })

  it.each(['owner', 'manager', 'contador'])('%s: 3.5.2, el menú lateral muestra las siete entradas de Ventas (con «Regalías»)', role => {
    const ventas = menuPara(role).find(g => g.id === 'ventas')!
    expect(ventas.items.map(i => i.label)).toEqual(['Resumen', 'Productos', 'Equipo de Ventas', 'Tiempos', 'Regalías', 'En vivo', 'Ajustes de Ventas'])
    expect(ventas.items.map(i => i.to)).toEqual([
      '/ventas?tab=resumen', '/ventas?tab=productos', '/ventas?tab=equipo', '/ventas?tab=tiempos',
      '/ventas?tab=regalias', '/ventas?tab=envivo', '/ventas?tab=ajustes',
    ])
  })

  it('contador no ve «Ing. Menú» (mismo filtro de siempre); «Ajustes de Ventas» le abre solo «Metas»', () => {
    const items = menuPara('contador').find(g => g.id === 'ventas')!.items
    expect(items.map(i => i.label)).not.toContain('Ing. Menú')
    expect(entradasVisibles('contador').find(e => e.id === 'ajustes')!.vistas).toEqual(['metas'])
  })

  it('owner: «Ajustes de Ventas» lleva a Ajustes (abre «Metas»; Paridad y Cargar XLS se retiraron el 16-nov)', () => {
    const item = menuPara('owner').find(g => g.id === 'ventas')!.items.find(i => i.entrada === 'ajustes')!
    expect(item.label).toBe('Ajustes de Ventas')
    expect(item.to).toBe('/ventas?tab=ajustes')
  })

  it('la barra inferior del cajero: Caja, Propinas, Club y «Más»', () => {
    const b = barraPara('cajero')
    expect(b.directos.map(m => m.id)).toEqual(['cash', 'tips', 'club'])
    expect(b.conMas).toBe(true)
  })

  it('salonero, barman y cocina no llevan menú (2 módulos)', () => {
    for (const r of ['salonero', 'barman', 'cocina']) expect(llevaMenu(r)).toBe(false)
  })
})
