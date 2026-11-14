// Mig 168 · El pase (Google y Apple) muestra el avance de los primeros 90 días del socio activo: «Visita 2 de 4» o la
// cortesía especial ganada. Sin avance (o con datos raros, o base sin la 168) el pase sale igual que antes.
import { describe, it, expect } from 'vitest'
import { armarObjeto, configurarBaseClub, textoAvance, type PaseDatos } from './googlePase'
import { armarPassJson } from './applePase'

configurarBaseClub('https://club.ejemplo.test')
const A = '00000000-0000-4000-8000-0000000000aa'
const socio = { estado: 'activo' as const, desde: '2026-11-01', qr_url: 'https://club.ejemplo.test/s/ABCD2345K', beneficio: 'Vale en todos los Satori',
                visitas_mes: 1, cortesias: [] }
const datos = (avance: unknown, estado: 'activo' | 'pendiente' = 'activo'): PaseDatos => ({
  contrato: 1, miembro_id: A, version: 1, actualizado_en: '2026-11-12T19:20:00Z', nombre_pila: 'Ana', estado: 'activo',
  local: { id: 'local-prueba', nombre: 'Local Prueba' }, pestanas: ['mi_club'],
  codigo_barras: { tipo: 'socio', valor: socio.qr_url }, socio: { ...socio, estado, avance: avance as never }, anfitrion: null,
  promociones: [], canjear_url: null,
})
const ISSUER = '3388000000012345678'
const modulo = (d: PaseDatos) => (armarObjeto(ISSUER, 'stg', d).textModulesData as Array<{ id: string; body: string; localizedBody: { translatedValues: Array<{ value: string }> } }>)
  .find(m => m.id === 'avance')
const apple = (d: PaseDatos) => ((armarPassJson(d, { passTypeIdentifier: 'pass.test.club', teamIdentifier: 'ABCDE12345' }, null)
  .storeCard as { secondaryFields: Array<{ key: string; value: string }> }).secondaryFields).find(f => f.key === 'avance')

describe('pase · avance de los primeros 90 días (mig 168)', () => {
  it('en curso: «Visita 2 de 4» con la fecha, en ES y EN (Google) y en Apple', () => {
    const d = datos({ visita: 2, de: 4, ganada: false, hasta: '2027-02-11' })
    const m = modulo(d)!
    expect(m.body).toBe('Visita 2 de 4 · cortesía especial al llegar a 4 antes del 11-feb')
    expect(m.localizedBody.translatedValues[0].value).toBe('Visit 2 of 4 · special treat at 4 visits before Feb 11')
    expect(apple(d)?.value).toBe(m.body)
  })
  it('ganada: «Cortesía de bienvenida» con el vencimiento', () => {
    const m = modulo(datos({ visita: 4, de: 4, ganada: true, vence_en: '2026-12-20' }))!
    expect(m.body).toBe('Ganada: muéstrela en caja (vale hasta el 20-dic)')
  })
  it('sin avance, datos raros o socio pendiente: sin renglón (el pase sale igual)', () => {
    expect(modulo(datos(null))).toBeUndefined()
    expect(modulo(datos(undefined))).toBeUndefined()
    expect(modulo(datos({ visita: 5, de: 4, ganada: false, hasta: '2027-02-11' }))).toBeUndefined()
    expect(modulo(datos({ visita: 2, de: 4, ganada: false, hasta: 'pronto' }))).toBeUndefined()
    expect(modulo(datos({ visita: 2, de: 4, ganada: false, hasta: '2027-02-11' }, 'pendiente'))).toBeUndefined()
    expect(textoAvance({ visita: 4, de: 4, ganada: true })).toBeNull()
  })
})
