// (D12 = A) Reglas puras del alias aprendido. Mutaciones anotadas (verificadas el 13-nov):
//  U1. decidirAlias: sin el chequeo de OTRO proveedor → cae «coincide con otro proveedor activo».
//  U2. decidirAlias/ALIAS_MIN: `< ALIAS_MIN` → `< 1` → cae «muy corto».
//  U3. sumarAlias: comparar con `a === alias` en vez de la clave → caen «no duplica por clave» y el «ya_estaba» de la API.
import { describe, it, expect } from 'vitest'
import type { Supplier } from '../types/database'
import { claveProveedor, matchSupplier, decidirAlias, sumarAlias, puedeAprenderAlias, msgAliasGuardado } from './proveedorAlias'

const s = (id: string, name: string, aliases: string[] | null = null, is_active = true) =>
  ({ id, name, aliases, is_active } as unknown as Supplier)
const lista = [s('p1', 'Comercial Ficticio'), s('p2', 'Distribuidora Inventada', ['Inventada Hermanos S.A.']), s('p3', 'Viejo Ficticio', ['Legal Vieja SA'], false)]

describe('decidirAlias', () => {
  it('nombre leído nuevo para un existente → agregar (recortado)', () => {
    expect(decidirAlias('  Exportadora Ficticia, S.A. ', 'p1', lista)).toEqual({ agregar: true, alias: 'Exportadora Ficticia, S.A.' })
  })
  it('vacío o solo puntuación → no', () => {
    expect(decidirAlias('', 'p1', lista)).toEqual({ agregar: false, motivo: 'vacio' })
    expect(decidirAlias(null, 'p1', lista)).toEqual({ agregar: false, motivo: 'vacio' })
    expect(decidirAlias(' ., ', 'p1', lista)).toEqual({ agregar: false, motivo: 'vacio' })
  })
  it('muy corto (< 4 caracteres normalizados) → no', () => {
    expect(decidirAlias('S.A.', 'p1', lista)).toEqual({ agregar: false, motivo: 'corto' })
    expect(decidirAlias('Á-b c', 'p1', lista)).toEqual({ agregar: false, motivo: 'corto' })
    expect(decidirAlias('Abcd', 'p1', lista).agregar).toBe(true)
  })
  it('coincide con otro proveedor activo (nombre o alias) → no (ambiguo)', () => {
    expect(decidirAlias('DISTRIBUIDORA inventada', 'p1', lista)).toEqual({ agregar: false, motivo: 'otro_proveedor' })
    expect(decidirAlias('Inventada Hermanos SA', 'p1', lista)).toEqual({ agregar: false, motivo: 'otro_proveedor' })
  })
  it('coincide solo con un proveedor INACTIVO → sí se agrega', () => {
    expect(decidirAlias('Legal Vieja S.A.', 'p1', lista).agregar).toBe(true)
  })
  it('ya es el nombre o un alias del mismo destino → no', () => {
    expect(decidirAlias('Inventada Hermanos, S. A.', 'p2', lista)).toEqual({ agregar: false, motivo: 'ya_esta' })
    expect(decidirAlias('comercial ficticio', 'p1', lista)).toEqual({ agregar: false, motivo: 'ya_esta' })
  })
  it('destino que no está en la lista → no', () => {
    expect(decidirAlias('Exportadora Ficticia', 'zz', lista)).toEqual({ agregar: false, motivo: 'sin_destino' })
  })
})

describe('sumarAlias', () => {
  it('agrega al final', () => { expect(sumarAlias(['A Uno'], ' B Dos ')).toEqual(['A Uno', 'B Dos']) })
  it('desde null', () => { expect(sumarAlias(null, 'B Dos')).toEqual(['B Dos']) })
  it('no duplica por clave (puntuación, tildes, mayúsculas) y devuelve la MISMA lista', () => {
    const l = ['Exportadora Ficticia, S.A.']
    expect(sumarAlias(l, 'EXPORTADORA FICTÍCIA S A')).toBe(l)
  })
})

describe('matchSupplier con alias aprendido', () => {
  it('después de sumar el alias, la siguiente factura se reconoce', () => {
    const antes = [s('p1', 'Comercial Ficticio')]
    expect(matchSupplier('Exportadora Ficticia S. A.', antes)).toBeNull()
    const despues = [{ ...antes[0], aliases: sumarAlias(antes[0].aliases, 'Exportadora Ficticia, S.A.') }]
    expect(matchSupplier('Exportadora Ficticia S. A.', despues)?.id).toBe('p1')
  })
  it('clave ignora espacios, puntuación y tildes', () => { expect(claveProveedor('Pésca, S. A.')).toBe('pescasa') })
})

describe('permisos y texto', () => {
  it('solo owner, manager y cajero (policy suppliers_op_write)', () => {
    expect(['owner', 'manager', 'cajero'].every(r => puedeAprenderAlias(r as never))).toBe(true)
    expect(['contador', 'proveedor', 'salonero'].some(r => puedeAprenderAlias(r as never))).toBe(false)
  })
  it('mensaje en voseo/neutro', () => {
    expect(msgAliasGuardado('X Legal', 'X')).toBe('✓ Guardado: la próxima vez se reconoce «X Legal» como X.')
  })
})
