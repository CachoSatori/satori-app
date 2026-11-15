// D7 A (firma del dueño, 14-nov; mig 157) · El pase de una cuenta del EQUIPO muestra las personas registradas: sin
// créditos, sin «próximo medio crédito» y sin «Canjear» (aunque llegue un canjear_url). El referente, igual que antes.
import { describe, it, expect } from 'vitest'
import { armarObjeto, configurarBaseClub, sinCreditos, type PaseDatos } from './googlePase'
import { armarPassJson, type ConfigApple } from './applePase'
configurarBaseClub('https://club.ejemplo.test')

const ISSUER = '3388000000012345678'
const CFG: ConfigApple = { passTypeIdentifier: 'pass.test.ejemplo.club', teamIdentifier: 'ABCDE12345', webServiceURL: null }
const anf = (over: Partial<NonNullable<PaseDatos['anfitrion']>> = {}): NonNullable<PaseDatos['anfitrion']> => ({
  activo: true, tipo: 'referente', codigo_publico: 'ABCD2345', qr_url: 'https://club.ejemplo.test/r/ABCD2345',
  personas: 12, creditos: 2, personas_proximo_medio: 3, valor_credito_crc: 18000, referidos_mes: 4, creditos_ganados_mes: 0.5, ...over,
})
const datos = (a: NonNullable<PaseDatos['anfitrion']>, canjear: string | null = 'https://club.ejemplo.test/w/' + 'c'.repeat(64)): PaseDatos => ({
  contrato: 1, miembro_id: '00000000-0000-4000-8000-0000000000aa', version: 1, actualizado_en: '2026-11-14T18:00:00Z',
  nombre_pila: 'Cami', estado: 'activo', local: { id: 'local-prueba', nombre: 'Local Prueba' }, pestanas: ['anfitrion'],
  codigo_barras: { tipo: 'cupones', valor: a.qr_url }, socio: null, anfitrion: a, promociones: [], canjear_url: canjear,
})
const equipo = anf({ tipo: 'equipo', con_creditos: false, personas: 0, creditos: 0, personas_proximo_medio: 0, creditos_ganados_mes: 0 })

type Obj = { textModulesData: Array<{ id: string; header: string; body: string }>; linksModuleData: { uris: Array<{ id: string }> } }
type Pase = { storeCard: Record<string, Array<{ key: string; value: string }>> }

describe('pase del equipo (D7 A)', () => {
  it('sinCreditos: con_creditos false, o (base vieja) el tipo equipo', () => {
    expect(sinCreditos(equipo)).toBe(true)
    expect(sinCreditos(anf({ tipo: 'equipo' }))).toBe(true)
    expect(sinCreditos(anf())).toBe(false)
    expect(sinCreditos(anf({ con_creditos: true }))).toBe(false)
  })

  it('Google: «Personas registradas», sin créditos, sin próximo medio crédito y sin «Canjear» aunque venga el link', () => {
    const o = armarObjeto(ISSUER, 'prod', datos(equipo)) as unknown as Obj
    const ids = o.textModulesData.map(t => t.id)
    expect(ids).toContain('registradas')
    expect(ids).not.toContain('creditos')
    expect(ids).not.toContain('proximo')
    expect(o.textModulesData.find(t => t.id === 'registradas')!.body).toBe('4 personas este mes')
    expect((o.linksModuleData?.uris ?? []).map(u => u.id)).not.toContain('canjear')
    expect(JSON.stringify(o)).not.toMatch(/disponibles|Canjear/)
  })

  it('Google (control): el referente sigue con créditos y «Canjear»', () => {
    const o = armarObjeto(ISSUER, 'prod', datos(anf())) as unknown as Obj
    expect(o.textModulesData.find(t => t.id === 'creditos')!.body).toBe('₡36.000 disponibles')
    expect(o.linksModuleData.uris.map(u => u.id)).toContain('canjear')
  })

  it('Apple: lo mismo', () => {
    const p = armarPassJson(datos(equipo), CFG, null) as unknown as Pase
    const campos = [...p.storeCard.primaryFields, ...p.storeCard.secondaryFields, ...p.storeCard.backFields]
    expect(campos.find(c => c.key === 'registradas')!.value).toBe('4 personas este mes')
    expect(campos.map(c => c.key)).not.toEqual(expect.arrayContaining(['creditos']))
    expect(campos.some(c => c.key === 'canjear' || c.key === 'proximo')).toBe(false)
    const ref = armarPassJson(datos(anf()), CFG, null) as unknown as Pase
    expect(ref.storeCard.primaryFields.some(c => c.key === 'creditos')).toBe(true)
  })
})
