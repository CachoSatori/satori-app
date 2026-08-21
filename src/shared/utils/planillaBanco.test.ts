import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import {
  buildPlanillaRows,
  buildPlanillaXlsx,
  planillaFileName,
  CONCEPTO_SALARIOS_DEFAULT,
  PLANILLA_SHEET,
} from './planillaBanco'

// El contrato del archivo que se sube al homebanking. Si un test de acá se cae, el banco
// rechaza el archivo: NO se "arregla" el test, se arregla el generador.

describe('buildPlanillaRows · formato del banco', () => {
  it('arma 5 columnas por beneficiario: nombre | monto entero | COL | concepto | concepto', () => {
    const rows = buildPlanillaRows(
      [{ nombre: 'ROSAURA JIMENEZ', monto: 185_000 }],
      CONCEPTO_SALARIOS_DEFAULT,
    )
    expect(rows).toEqual([['ROSAURA JIMENEZ', 185000, 'COL', 'PAGO DE SALARIOS', 'PAGO DE SALARIOS']])
  })

  it('redondea el monto a entero (el banco no acepta decimales)', () => {
    const rows = buildPlanillaRows([{ nombre: 'JOSE', monto: 123456.78 }], 'X')
    expect(rows[0][1]).toBe(123457)
    expect(Number.isInteger(rows[0][1])).toBe(true)
  })

  it('deja afuera los montos <= 0 (una transferencia de ₡0 no existe)', () => {
    const rows = buildPlanillaRows(
      [
        { nombre: 'A', monto: 1000 },
        { nombre: 'B', monto: 0 },
        { nombre: 'C', monto: 0.4 },   // redondea a 0
        { nombre: 'D', monto: -500 },
      ],
      'X',
    )
    expect(rows.map(r => r[0])).toEqual(['A'])
  })

  it('un beneficiario sin nombre TIRA: el banco identifica la cuenta por el nombre', () => {
    expect(() => buildPlanillaRows([{ nombre: '   ', monto: 1000 }], 'X')).toThrow(/sin nombre/i)
  })

  it('concepto vacío TIRA (columnas D y E son obligatorias)', () => {
    expect(() => buildPlanillaRows([{ nombre: 'A', monto: 1 }], '  ')).toThrow(/concepto/i)
  })

  it('D y E llevan exactamente el mismo texto', () => {
    const [row] = buildPlanillaRows([{ nombre: 'A', monto: 1 }], ' PAGO QUINCENA ')
    expect(row[3]).toBe('PAGO QUINCENA')
    expect(row[4]).toBe(row[3])
  })
})

describe('buildPlanillaXlsx · el archivo', () => {
  it('hoja `planilla`, SIN encabezado, una fila por beneficiario con monto > 0', () => {
    const bytes = buildPlanillaXlsx(
      [
        { nombre: 'ROSAURA', monto: 185_000 },
        { nombre: 'SIN PLATA', monto: 0 },
        { nombre: 'JOSE', monto: 92_500.6 },
      ],
      CONCEPTO_SALARIOS_DEFAULT,
    )
    const wb = XLSX.read(bytes, { type: 'array' })
    expect(wb.SheetNames).toEqual([PLANILLA_SHEET])

    const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[PLANILLA_SHEET], { header: 1 })
    expect(aoa).toEqual([
      ['ROSAURA', 185000, 'COL', 'PAGO DE SALARIOS', 'PAGO DE SALARIOS'],
      ['JOSE', 92501, 'COL', 'PAGO DE SALARIOS', 'PAGO DE SALARIOS'],
    ])
    // La primera fila es plata, no un encabezado.
    expect(typeof aoa[0][1]).toBe('number')
  })

  it('sin ningún monto > 0 TIRA en vez de escribir un archivo vacío', () => {
    expect(() => buildPlanillaXlsx([{ nombre: 'A', monto: 0 }], 'X')).toThrow(/mayor a/i)
  })
})

describe('planillaFileName', () => {
  it('sin espacios ni acentos', () => {
    expect(planillaFileName('planilla salarios', '2026-08-15 · quincena')).toBe(
      'planilla-salarios-2026-08-15-quincena.xlsx',
    )
  })
})
