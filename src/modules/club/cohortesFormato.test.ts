// Club → Cohortes y Ranking (mig 161): formato puro.
import { describe, it, expect } from 'vitest'
import { celdaCohorte, crcTxt, mesTxt, ordenar, periodo, periodoValido, rankingCsv } from './cohortesFormato'
import { rankingDePrueba } from './cohortesFixture.test-util'

describe('celdaCohorte', () => {
  it('null es «aún no», nunca 0', () => {
    expect(celdaCohorte(null, 4)).toBe('aún no')
    expect(celdaCohorte(0, 4)).toBe('0 (0 %)')
  })
  it('cuenta y % sobre los socios de la cohorte', () => {
    expect(celdaCohorte(1, 2)).toBe('1 (50 %)')
    expect(celdaCohorte(2, 3)).toBe('2 (67 %)')
  })
  it('sin socios no divide por cero', () => { expect(celdaCohorte(0, 0)).toBe('0') })
})

describe('formatos', () => {
  it('mes y colones', () => {
    expect(mesTxt('2001-01')).toBe('ene 2001')
    expect(mesTxt('2026-11')).toBe('nov 2026')
    expect(crcTxt(1234567)).toBe('₡1.234.567')
    expect(crcTxt(null)).toBe('—')
  })
})

describe('periodo (hoy en CR, entra como parámetro)', () => {
  it('este mes, este año y últimos 90 días (incluye hoy)', () => {
    expect(periodo('mes', '2026-11-14')).toEqual({ desde: '2026-11-01', hasta: '2026-11-14' })
    expect(periodo('anio', '2026-11-14')).toEqual({ desde: '2026-01-01', hasta: '2026-11-14' })
    expect(periodo('90', '2026-03-01')).toEqual({ desde: '2025-12-02', hasta: '2026-03-01' })
  })
  it('valida como la base: al revés o más de 400 días no', () => {
    expect(periodoValido('2026-01-01', '2026-01-31')).toBeNull()
    expect(periodoValido('2026-02-01', '2026-01-31')).toMatch(/antes/)
    expect(periodoValido('2025-01-01', '2026-02-06')).toMatch(/400/)
    expect(periodoValido('2025-01-01', '2026-02-05')).toBeNull()
    expect(periodoValido('', '2026-01-01')).toMatch(/Elegí/)
  })
})

describe('ordenar', () => {
  const r = rankingDePrueba()
  it('por venta (desc) y por nombre (asc); empates por nombre', () => {
    expect(ordenar(r.socios, 'venta_respaldada_crc', false).map(s => s.id)).toEqual(['s1', 's6', 's7', 's2', 's3'])
    expect(ordenar(r.socios, 'nombre', true)[0].nombre).toBe('=Socio Nuevo')
  })
  it('los vacíos van al final en los dos sentidos', () => {
    expect(ordenar(r.socios, 'tiquete_promedio_crc', true).map(s => s.id).slice(0, 2)).toEqual(['s6', 's1'])
    expect(ordenar(r.socios, 'ultima_visita', false).at(-1)?.id).toBe('s7')
    expect(ordenar(r.socios, 'ultima_visita', true).at(-1)?.id).toBe('s7')
  })
  it('no cambia la lista original', () => {
    const antes = r.socios.map(s => s.id)
    ordenar(r.socios, 'nombre', true)
    expect(r.socios.map(s => s.id)).toEqual(antes)
  })
})

describe('rankingCsv', () => {
  const csv = rankingCsv(rankingDePrueba())
  const lineas = csv.replace(/^\uFEFF/, '').split('\r\n')
  it('encabezado, una fila por socio, total y período; BOM y CRLF', () => {
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(lineas[0]).toBe('socio;local_alta;estado;visitas;mesas;facturas;venta_respaldada_crc;tiquete_promedio_crc;personas;invitados;descuento_estimado_crc;ultima_visita')
    expect(lineas).toHaveLength(1 + 5 + 2)
    expect(lineas[1]).toBe('"Socio Uno";"Local P161 A";"activo";"3";"2";"2";"32000";"16000";"7";"3";"5000";"2001-03-26"')
    expect(lineas[6]).toContain('"TOTAL (cada factura una vez)"')
    expect(lineas[6]).toContain('"32000"')
  })
  it('sin fórmulas: un nombre que empieza con = va con apóstrofo', () => {
    expect(csv).toContain(`"'=Socio Nuevo"`)
  })
  it('sin contactos: no hay columnas ni datos de teléfono o correo', () => {
    expect(lineas[0]).not.toMatch(/tel|correo|email|whatsapp|codigo/i)
    expect(csv).not.toMatch(/@|\+506/)
  })
})
