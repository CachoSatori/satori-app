// D16 (23-nov): Santa Teresa primero y por defecto en toda la app, sin romper sumar locales.
import { describe, it, expect } from 'vitest'
import { LOCAL_PRINCIPAL, compararLocales, localPorDefecto, ordenarLocales } from './ordenLocales'

// Como los devuelve la base con `.order('id')`: «nosara» < «santa-teresa».
const DE_LA_BASE = [
  { id: 'local-zeta', nombre: 'Local Zeta', activo: true },
  { id: 'nosara', nombre: 'Satori Nosara', activo: false },
  { id: 'otro-b', nombre: 'Otro B', activo: true },
  { id: 'santa-teresa', nombre: 'Satori Santa Teresa', activo: true },
  { id: 'local-a', nombre: 'Local A', activo: false },
]

describe('ordenarLocales (D16)', () => {
  it('activos primero; Santa Teresa primera; después alfabético por nombre; inactivos al final', () => {
    expect(ordenarLocales(DE_LA_BASE).map(l => l.id))
      .toEqual(['santa-teresa', 'local-zeta', 'otro-b', 'local-a', 'nosara'])
  })

  it('con los dos locales de hoy, los dos activos: Santa Teresa primero aunque la base traiga Nosara antes', () => {
    const dos = [{ id: 'nosara', nombre: 'Nosara' }, { id: 'santa-teresa', nombre: 'Santa Teresa' }]
    expect(ordenarLocales(dos).map(l => l.id)).toEqual(['santa-teresa', 'nosara'])
  })

  it('Santa Teresa inactiva va con los inactivos (activos primero manda), y primera entre ellos', () => {
    const l = [{ id: 'santa-teresa', activo: false }, { id: 'b', activo: false }, { id: 'a', activo: true }]
    expect(ordenarLocales(l).map(x => x.id)).toEqual(['a', 'santa-teresa', 'b'])
  })

  it('un local nuevo entra solo en su lugar alfabético (multi-local, sin tocar código)', () => {
    const l = [...DE_LA_BASE, { id: 'nuevo', nombre: 'Mal País', activo: true }]
    expect(ordenarLocales(l).map(x => x.id).slice(0, 4)).toEqual(['santa-teresa', 'local-zeta', 'nuevo', 'otro-b'])
  })

  it('acepta otras formas con un traductor y no toca la lista original', () => {
    const filas = [{ id: 'nosara', name: 'Nosara', is_active: true }, { id: 'santa-teresa', name: 'ST', is_active: true }]
    const copia = [...filas]
    expect(ordenarLocales(filas, f => ({ id: f.id, nombre: f.name, activo: f.is_active }))[0].id).toBe(LOCAL_PRINCIPAL)
    expect(filas).toEqual(copia)
  })

  it('compararLocales es un orden total estable (mismo nombre → por id)', () => {
    expect(compararLocales({ id: 'b', nombre: 'X' }, { id: 'a', nombre: 'X' })).toBeGreaterThan(0)
    expect(compararLocales({ id: 'a' }, { id: 'a' })).toBe(0)
  })
})

describe('localPorDefecto (D16)', () => {
  it('sin nada guardado: Santa Teresa si la ve', () => {
    expect(localPorDefecto(DE_LA_BASE)).toBe('santa-teresa')
  })
  it('respeta lo que el usuario ya eligió, si lo sigue viendo', () => {
    expect(localPorDefecto(DE_LA_BASE, 'otro-b')).toBe('otro-b')
    expect(localPorDefecto(DE_LA_BASE, 'nosara')).toBe('nosara')
  })
  it('lo guardado que ya no ve se ignora → Santa Teresa', () => {
    expect(localPorDefecto(DE_LA_BASE, 'no-existe')).toBe('santa-teresa')
  })
  it('manager sin Santa Teresa (profile_locations): el primero que ve, activos primero', () => {
    const suyos = [{ id: 'nosara', activo: false }, { id: 'otro-b', nombre: 'Otro B', activo: true }]
    expect(localPorDefecto(suyos)).toBe('otro-b')
  })
  it('Santa Teresa visible pero inactiva: gana un activo', () => {
    expect(localPorDefecto([{ id: 'santa-teresa', activo: false }, { id: 'x', activo: true }])).toBe('x')
  })
  it('sin locales → null', () => {
    expect(localPorDefecto([])).toBeNull()
  })
})

describe('las copias literales del slug (archivos que entran en paquetes de Edge) siguen iguales a LOCAL_PRINCIPAL', () => {
  it('ventasDiasDesdePos.LOCAL_POR_DEFECTO y aliasCorreo.LOCAL_POR_DEFECTO', async () => {
    const v = await import('../../modules/ventas/ventasDiasDesdePos')
    const a = await import('../../modules/admin/aliasCorreo')
    expect(v.LOCAL_POR_DEFECTO).toBe(LOCAL_PRINCIPAL)
    expect(a.LOCAL_POR_DEFECTO).toBe(LOCAL_PRINCIPAL)
  })
})
