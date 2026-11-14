// Club → Embudo del anfitrión (mig 162): % entre pasos, pasos con y sin reseña, cero datos y CSV.
import { describe, it, expect } from 'vitest'
import { embudoCsv, pasos, pct, pctTxt, resumenVacio } from './embudoFormato'
import { embudoDePrueba, embudoVacio } from './embudoFixture.test-util'

describe('embudoFormato', () => {
  it('% contra el paso anterior, con un decimal; null sin base', () => {
    expect(pct(4, 6)).toBe(66.7)
    expect(pct(0, 0)).toBeNull()
    expect(pctTxt(66.7)).toBe('66,7 %')
    expect(pctTxt(null)).toBe('—')
  })

  it('pasos sin la 158: generados → usados → con factura → personas → venta → tiquete', () => {
    const p = pasos(embudoDePrueba().totales, false)
    expect(p.map(x => x.clave)).toEqual(['generados', 'usados', 'con_factura', 'personas', 'venta', 'tiquete'])
    expect(p[1].pct).toBe(62.5)          // 5 de 8
    expect(p[2].pct).toBe(80)            // 4 de 5 usados
    expect(p[4].valor).toBe('₡17.000')
    expect(p[5].valor).toBe('₡5.667')    // 17.000 ÷ 3 mesas
  })

  it('con la 158 aparece el clic en reseña entre usados y con factura', () => {
    const p = pasos(embudoDePrueba(true).totales, true)
    expect(p.map(x => x.clave)).toEqual(['generados', 'usados', 'resena', 'con_factura', 'personas', 'venta', 'tiquete'])
    expect(p[2].pct).toBe(40)            // 2 de 5
  })

  it('cero datos: texto explicado, no error; con datos, null', () => {
    expect(resumenVacio(embudoVacio())).toMatch(/Todavía no hay anfitriones con cupones/)
    expect(resumenVacio({ ...embudoVacio(), totales: { ...embudoVacio().totales, sin_cupones: 3 } })).toMatch(/3 anfitriones activos sin cupones/)
    expect(resumenVacio(embudoDePrueba())).toBeNull()
  })

  it('CSV: una fila por anfitrión + total, celdas tipo fórmula escapadas, sin columnas de reseña si no está la 158', () => {
    const csv = embudoCsv(embudoDePrueba())
    const filas = csv.replace(/^﻿/, '').split('\r\n')
    expect(filas).toHaveLength(4)
    expect(filas[2]).toContain('"\'=Referente Uno"')
    expect(filas[2]).toContain('"17000"')
    expect(filas[3]).toMatch(/^"total \(cada factura una vez\)"/)
    expect(filas[1].split(';')[8]).toBe('""')        // clic_resena vacío sin la 158
    expect(embudoCsv(embudoDePrueba(true)).split('\r\n')[2].split(';')[8]).toBe('"2"')
    expect(csv).not.toMatch(/@|\+506/)
  })
})
