// (13-nov) Reglas de duplicados de facturas (decisiones del dueño): puras, sin red.
import { describe, it, expect } from 'vitest'
import { normNumero, mismaFactura, fechaCortaCR, revisarDocumentos, politicaPantalla, politicaBandeja } from './facturaDuplicada'

const F = { proveedor: 'Distribuidora Ejemplo S.A.', numero_documento: '0354099', total: 25000, moneda: 'CRC' }

describe('mismaFactura (proveedor + número + total)', () => {
  it('mismo número (con ceros, espacios o guiones), mismo total y mismo proveedor (acentos y mayúsculas da igual) → sí', () => {
    expect(normNumero(' 00-354 099 ')).toBe('354099')
    expect(mismaFactura(F, { ...F, numero_documento: '354099', proveedor: 'distribuidora  ejemplo s.a.' })).toBe(true)
    expect(mismaFactura(F, { ...F, total: '25000.3' })).toBe(true)
  })
  it('otro número, otro total, otra moneda u otro proveedor → no', () => {
    expect(mismaFactura(F, { ...F, numero_documento: '354100' })).toBe(false)
    expect(mismaFactura(F, { ...F, total: 25001 })).toBe(false)
    expect(mismaFactura(F, { ...F, moneda: 'USD' })).toBe(false)
    expect(mismaFactura(F, { ...F, proveedor: 'Otra Casa' })).toBe(false)
  })
  it('sin número no se puede decir (no se avisa por proveedor + total solos)', () => {
    expect(mismaFactura({ ...F, numero_documento: null }, { ...F, numero_documento: null })).toBe(false)
    expect(mismaFactura({ ...F, numero_documento: '' }, F)).toBe(false)
  })
  it('con cédula en las dos, manda la cédula (aunque el nombre leído difiera)', () => {
    expect(mismaFactura({ ...F, proveedor_cedula: '3-101-000000' }, { ...F, proveedor: 'Nombre mal leído', proveedor_cedula: '3101000000' })).toBe(true)
    expect(mismaFactura({ ...F, proveedor_cedula: '3-101-000000' }, { ...F, proveedor_cedula: '3-101-999999' })).toBe(false)
  })
  it('fechaCortaCR: hora de Costa Rica (UTC−6)', () => {
    expect(fechaCortaCR('2026-11-12T23:32:00Z')).toBe('12-nov 17:32')
    expect(fechaCortaCR('no')).toBe('')
  })
})

const CLAVE = '5'.repeat(50)
const deps = (claves: string[], parecidos: string[]) => ({
  porClave: async (c: string) => (claves.includes(c) ? { created_at: '2026-11-11T20:00:00Z' } : null),
  parecida: async (d: { numero_documento?: string | null }) => (parecidos.includes(String(d.numero_documento)) ? { created_at: '2026-11-10T20:00:00Z' } : null),
})

describe('políticas: asistente / Caja-Proveedores y Bandeja', () => {
  it('un documento sin repetir → es el de la pantalla, sin extras ni aviso', async () => {
    const pol = politicaPantalla(await revisarDocumentos([{ ...F }], deps([], [])))
    expect(pol).toMatchObject({ bloqueo: null, extras: [], saltados: 0, parecida: null })
    expect(pol.primero?.numero_documento).toBe('0354099')
  })
  it('varios: el primero en la pantalla, los demás a la Bandeja; el extra con clave repetida se saltea', async () => {
    const docs = [{ ...F }, { ...F, numero_documento: '2' }, { ...F, numero_documento: '3', clave_fe: CLAVE }]
    const pol = politicaPantalla(await revisarDocumentos(docs, deps([CLAVE], [])))
    expect(pol.primero?.numero_documento).toBe('0354099')
    expect(pol.extras.map(d => d.numero_documento)).toEqual(['2'])
    expect(pol.saltados).toBe(1)
  })
  it('clave FE repetida en el primero → bloquea TODO (nada a la pantalla ni a la Bandeja)', async () => {
    const pol = politicaPantalla(await revisarDocumentos([{ ...F, clave_fe: CLAVE }, { ...F, numero_documento: '2' }], deps([CLAVE], [])))
    expect(pol.bloqueo).not.toBeNull()
    expect(pol.primero).toBeNull()
    expect(pol.extras).toEqual([])
  })
  it('parecida del primero → aviso (no bloquea)', async () => {
    const pol = politicaPantalla(await revisarDocumentos([{ ...F }], deps([], ['0354099'])))
    expect(pol.bloqueo).toBeNull()
    expect(pol.parecida).not.toBeNull()
  })
  it('Bandeja: entra cada documento salvo los de clave FE repetida; cuenta los parecidos', async () => {
    const docs = [{ ...F, clave_fe: CLAVE }, { ...F, numero_documento: '2' }, { ...F, numero_documento: '3' }]
    const b = politicaBandeja(await revisarDocumentos(docs, deps([CLAVE], ['3'])))
    expect(b.entran.map(d => d.numero_documento)).toEqual(['2', '3'])
    expect(b).toMatchObject({ bloqueados: 1, parecidos: 1, cuandoBloqueo: '11-nov 14:00' })
  })
})
