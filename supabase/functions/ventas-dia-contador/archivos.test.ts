// Los adjuntos se generan y se ABREN: el CSV como lo escribe el botón (`,`, comillas, BOM) con # y TOTAL;
// el XLSX se parsea con SheetJS (la `xlsx` de la app) y se mira estructura, valores, fórmulas y formato.
import { describe, it, expect, vi } from 'vitest'
import * as XLSX from 'xlsx'
vi.mock('../../../src/shared/api/supabase', () => ({ supabase: null }))
import * as app from '../../../src/modules/ventas/ventasDiaContadorPuro'
import { aCsv, aXlsx, crc32, serieExcel, zipStore, FILA_ENCABEZADO_XLSX } from './archivos.ts'
import { armarDetalle, r2, COLUMNAS, type LogicaApp } from './detalle.ts'
import { armarQuincena } from './quincena.ts'
import { diasFicticios } from './pruebas.fixtures.ts'

const q = armarQuincena(2026, 10, 2)   // 16 días
const det = armarDetalle(app as unknown as LogicaApp, diasFicticios(['2026-10-16', '2026-10-18', '2026-10-30', '2026-10-31']), q)

describe('CSV', () => {
  const csv = aCsv(det)
  const lineas = csv.replace(/^\uFEFF/, '').trimEnd().split('\n')
  it('UTF-8 con BOM, separador «,» y valores entre comillas (como el botón ⬇ CSV)', () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(lineas[0]).toBe(COLUMNAS.join(','))
    expect(lineas[1]).toMatch(/^"1","2026-10-16","Vie",/)
  })
  it('una fila por día de la quincena (días sin ventas en 0) + TOTAL', () => {
    expect(lineas.length).toBe(1 + 16 + 1)
    expect(lineas[2]).toBe('"2","2026-10-17","Sáb","0","0","0","0","0","0","0","0"')
    const total = lineas[lineas.length - 1].split(',').map(c => c.replace(/"/g, ''))
    expect(total.slice(0, 3)).toEqual(['TOTAL', '', ''])
    expect(Number(total[6])).toBe(r2(det.total.ventaNeta))
    expect(Number(total[9])).toBe(det.total.pax)
    expect(Number(total[10])).toBe(Math.round(det.total.promPax))
  })
  it('la plata va con 2 decimales como máximo (sin ruido de coma flotante)', () => {
    for (const l of lineas.slice(1)) for (const c of l.split(',').slice(3, 9)) expect(c).toMatch(/^"-?\d+(\.\d{1,2})?"$/)
  })
})

describe('XLSX', () => {
  const bytes = aXlsx(det, 'Satori · Ventas por día · Santa Teresa', 'Quincena del 16–31 de octubre de 2026')
  const wb = XLSX.read(bytes, { type: 'array', cellFormula: true, cellNF: true, cellDates: false })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const H = FILA_ENCABEZADO_XLSX
  it('abre: una hoja con nombre de la quincena, título, encabezado y 16 días + TOTAL', () => {
    expect(wb.SheetNames).toEqual(['Ventas 2026-10-2'])
    expect(ws['A1'].v).toBe('Satori · Ventas por día · Santa Teresa')
    expect(COLUMNAS.map((_, i) => ws[XLSX.utils.encode_cell({ r: H - 1, c: i })].v)).toEqual([...COLUMNAS])
    const filas = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, range: H, raw: true })
    expect(filas.length).toBe(16 + 1)
    expect(filas[16][0]).toBe('TOTAL')
    expect(ws['!merges']?.length).toBe(2)
  })
  it('fechas como fecha de Excel (dd/mm/yyyy), números como números', () => {
    const c = ws[`B${H + 1}`]
    expect(c.t).toBe('n')
    expect(c.v).toBe(serieExcel('2026-10-16'))
    expect(c.z).toBe('dd/mm/yyyy')
    expect(XLSX.SSF.format(c.z, c.v)).toBe('16/10/2026')
    expect(ws[`G${H + 1}`].t).toBe('n')
    expect(ws[`G${H + 1}`].v).toBe(r2(det.filas[0].ventaNeta))
    expect(ws[`G${H + 1}`].z).toBe('#,##0.00')
  })
  it('fila TOTAL con fórmulas SUM y el valor ya calculado igual al TOTAL del correo', () => {
    const fila = H + 16 + 1
    expect(ws[`G${fila}`].f).toBe(`SUM(G${H + 1}:G${H + 16})`)
    expect(ws[`G${fila}`].v).toBe(r2(det.total.ventaNeta))
    expect(ws[`J${fila}`].v).toBe(det.total.pax)
    expect(ws[`K${fila}`].f).toBe(`IF(J${fila}>0,ROUND(H${fila}/J${fila},0),0)`)
    expect(ws[`K${fila}`].v).toBe(Math.round(det.total.promPax))
    // Σ de las filas redondeadas ≈ total (diferencia < 1 céntimo por fila)
    let s = 0
    for (let r = H + 1; r <= H + 16; r++) s += ws[`G${r}`].v
    expect(Math.abs(s - ws[`G${fila}`].v)).toBeLessThan(0.01 * 16)
  })
  it('lleva formato: estilos con negrita, relleno, borde, panel fijo bajo el encabezado', () => {
    const txt = new TextDecoder().decode(bytes)
    expect(txt).toContain('<b/>')
    expect(txt).toContain('patternType="solid"')
    expect(txt).toContain('state="frozen"')
    expect(txt).toMatch(new RegExp(`<c r="A${H + 17}" s="9" t="inlineStr"><is><t xml:space="preserve">TOTAL`))
  })
  it('es determinista: misma entrada → mismos bytes', () => {
    expect(aXlsx(det, 'a', 'b')).toEqual(aXlsx(det, 'a', 'b'))
  })
})

describe('ZIP', () => {
  it('CRC-32 estándar', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })
  it('un zip con un archivo lo abre SheetJS (CFB/zip) y conserva el contenido', () => {
    const z = zipStore([['hola.txt', 'ñandú']])
    const cfb = XLSX.CFB.read(z, { type: 'array' })
    const e = XLSX.CFB.find(cfb, 'hola.txt')
    expect(new TextDecoder().decode(e!.content as Uint8Array)).toBe('ñandú')
  })
})
