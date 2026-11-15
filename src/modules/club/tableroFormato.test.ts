// Club → Tablero (mig 160): formato puro. Los números son los de scripts/sql/160_pruebas.sql.
import { describe, it, expect } from 'vitest'
import { avisos, crcTxt, filasPasivo, pasivoCuadra, tableroCsv, titular, creditosTxt } from './tableroFormato'
import { tableroDePrueba, tableroVacio } from './tableroFixture.test-util'

describe('tableroFormato', () => {
  it('formatos del estándar: punto de miles, ₡ pegado, negativos con signo', () => {
    expect(crcTxt(54000)).toBe('₡54.000')
    expect(crcTxt(-27000)).toBe('−₡27.000')
    expect(creditosTxt(-1.5)).toBe('−1,5')
    expect(creditosTxt(3)).toBe('3')
  })

  it('pasivo en orden: inicial → emitidos → carga → canjeados → vencidos → ajustes → final', () => {
    expect(filasPasivo(tableroDePrueba()).map(f => f.clave))
      .toEqual(['saldo_inicial', 'emitidos', 'carga_inicial', 'canjeados', 'vencidos', 'ajustes', 'saldo_final'])
  })

  it('la carga inicial solo aparece el mes en que entró; el mes en curso dice «Saldo a hoy»', () => {
    const t = tableroDePrueba({ parcial: true })
    t.pasivo = { ...t.pasivo, carga_inicial: { personas: 0, creditos: 0, crc: 0 },
                 saldo_final: { personas: 12, creditos: 2, crc: 36000 } }
    const f = filasPasivo(t)
    expect(f.map(x => x.clave)).not.toContain('carga_inicial')
    expect(f.at(-1)?.etiqueta).toBe('Saldo a hoy')
  })

  it('pasivoCuadra: cuadra con la prueba y deja de cuadrar si falta un movimiento', () => {
    expect(pasivoCuadra(tableroDePrueba())).toBe(true)
    const t = tableroDePrueba()
    t.pasivo = { ...t.pasivo, vencidos: { personas: 0, creditos: 0, crc: 0 } }
    expect(pasivoCuadra(t)).toBe(false)
    expect(avisos(t).join(' ')).toMatch(/no cuadra/)
  })

  it('titular: cuánto costó el Club por cada ₡100 cobrados', () => {
    expect(titular(tableroDePrueba())).toBe('Por cada ₡100 cobrados en facturas del Club, el Club costó ₡135,7.')
  })

  it('sin facturas del PoS (local como Nosara): aviso claro, no error, y el titular lo dice', () => {
    const t = tableroVacio()
    expect(titular(t)).toBe('Sin datos del PoS para este local y mes.')
    expect(avisos(t)[0]).toMatch(/no tiene facturas del PoS/)
    expect(() => tableroCsv(t)).not.toThrow()
  })

  it('con PoS pero sin facturas del Club: lo dice, sin tasa inventada', () => {
    const t = tableroVacio(); t.pos_sin_datos = false
    expect(titular(t)).toBe('Todavía no hay facturas del Club en este mes.')
  })

  it('avisa las líneas sin referencia (el descuento es estimado e incompleto)', () => {
    expect(avisos(tableroDePrueba()).join(' ')).toMatch(/1 líneas sin precio de referencia/)
  })

  it('CSV: BOM, separador «;», números crudos, congelado aparte y sin nombres', () => {
    const csv = tableroCsv(tableroDePrueba())
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv).toContain('plata;costo_total_crc;31900;;;')
    expect(csv).toContain('plata;tasa_efectiva_pct;135.7;;;')
    expect(csv).toContain('plata;venta_respaldada_crc;23500;;;')
    expect(csv).toContain('plata;venta_respaldada_neta_crc;33500;;;')
    expect(csv).toContain('pasivo;saldo_final;;18;3;54000')
    expect(csv).toContain('pasivo;congelado_fuera_del_pasivo;2;12;2;36000')
    expect(csv).not.toMatch(/Prueba|@/)
  })
})
