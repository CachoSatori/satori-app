// @vitest-environment happy-dom
//
// CONTRATO: el correo al contador da lo MISMO que la pantalla «Ventas → Contabilidad → Detalle por día»
// para el mismo rango. Tres capas:
//   1. El paquete commiteado (`ventasPos.gen.js`) es exactamente el que sale hoy de `src/` (no quedó viejo).
//   2. Mismos tickets/líneas del PoS (caso ficticio de `__paridad__`) → app (src/) y Edge (paquete) dan
//      las mismas filas y el mismo TOTAL. Además, sin el roster de nombres (la Edge no lee `employees`).
//   3. La pantalla renderizada: su fila TOTAL dice lo mismo que el TOTAL del correo.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { render } from '@testing-library/react'

vi.mock('../../../src/shared/api/supabase', () => ({ supabase: null }))
import * as app from '../../../src/modules/ventas/ventasDiaContadorPuro'
import { fi } from '../../../src/modules/ventas/ventasUtils'
import VentasContabilidad from '../../../src/modules/ventas/VentasContabilidad'
import type { DiasMap, Meta } from '../../../src/shared/types/ventas'
import * as edge from './ventasPos.gen.js'
import { armarDetalle, type LogicaApp } from './detalle.ts'
import { armarQuincena } from './quincena.ts'
import { diasFicticios } from './pruebas.fixtures.ts'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, '..', '..', '..')
const E = edge as unknown as LogicaApp
const A = app as unknown as LogicaApp
const caso = JSON.parse(readFileSync(join(RAIZ, 'src/modules/ventas/__paridad__/caso.json'), 'utf8'))

/** Lo que muestra la pantalla para un mes: `getContabilidadDays` + `totalesContabilidad` de src/. */
function pantalla(ym: string, dias: Record<string, unknown>) {
  const [y, m] = ym.split('-').map(Number)
  const days = app.getContabilidadDays(y, m, dias as DiasMap, {})
  return { days, total: app.totalesContabilidad(days) }
}

describe('contrato: el paquete de la Edge está al día con src/', () => {
  it('ventasPos.gen.js = empaquetar(ventasDiaContadorPuro.ts) de hoy, y sin nombres', async () => {
    const { empaquetar } = await import(pathToFileURL(join(RAIZ, 'scripts/edge/empaquetar-ventas-pos.mjs')).href)
    const fresco: string = await empaquetar(join(RAIZ, 'src/modules/ventas/ventasDiaContadorPuro.ts'))
    const commiteado = readFileSync(join(AQUI, 'ventasPos.gen.js'), 'utf8')
    const cuerpo = commiteado.split('\n').slice(4).join('\n')
    expect(commiteado.split('\n')[0]).toMatch(/Fuente: src\/modules\/ventas\/ventasDiaContadorPuro\.ts @/)
    // Si cae: node scripts/edge/empaquetar-ventas-pos.mjs --entrada src/modules/ventas/ventasDiaContadorPuro.ts supabase/functions/ventas-dia-contador/ventasPos.gen.js
    expect(cuerpo).toBe(fresco)
    expect(fresco).not.toMatch(/^import /m)
    expect(fresco).toMatch(/const SALONEROS_CONOCIDOS = \{\}/)
  })
})

describe('contrato: mismos tickets del PoS → mismas filas y mismo TOTAL que la pantalla', () => {
  it('caso de paridad (5 y 6 de oct): app con nombres = Edge sin nombres', () => {
    const conNombres = app.armarDiasMap(caso.tickets, caso.lineas, caso.rango,
      { uploadedAt: caso.uploadedAt, nombres: caso.nombres, avisar: () => {} }).dias
    const sinNombres = edge.armarDiasMap(caso.tickets, caso.lineas, caso.rango,
      { uploadedAt: caso.uploadedAt, nombres: {}, avisar: () => {} }).dias
    const q = armarQuincena(2026, 10, 1)
    const p = pantalla('2026-10', conNombres)
    const correo = armarDetalle(E, sinNombres, q)
    expect(p.days.length).toBe(2)
    for (const d of p.days) {
      const f = correo.filas.find(x => x.fecha === d.fecha)!
      const CAMPOS = ['fecha', 'ventaBruta', 'ventaNeta', 'iva', 'serv', 'salon', 'delivery', 'pax', 'promPax'] as const
      const elegir = (o: Record<string, unknown>) => Object.fromEntries(CAMPOS.map(k => [k, o[k]]))
      expect(elegir(f as unknown as Record<string, unknown>)).toEqual(elegir(d as unknown as Record<string, unknown>))
      expect(Object.keys(f)).not.toContain('saloneroNames')   // los nombres no viajan al correo
    }
    expect(correo.total).toEqual(p.total)
    expect(correo.filas.filter(f => !p.days.some(d => d.fecha === f.fecha)).every(f => f.ventaNeta === 0 && f.pax === 0)).toBe(true)
    expect(correo.total.ventaNeta).toBeGreaterThan(0)   // el caso muerde: hay plata
  })

  it('mes ficticio con caja y delivery: cada quincena = las filas de la pantalla de ese rango', () => {
    const fechas = ['2026-09-01', '2026-09-02', '2026-09-09', '2026-09-15', '2026-09-16', '2026-09-27', '2026-09-30']
    const dias = diasFicticios(fechas)
    const p = pantalla('2026-09', dias)
    for (const n of [1, 2] as const) {
      const q = armarQuincena(2026, 9, n)
      const deApp = armarDetalle(A, dias, q), deEdge = armarDetalle(E, dias, q)
      expect(deEdge).toEqual(deApp)
      const enRango = p.days.filter(d => d.fecha >= q.desde && d.fecha <= q.hasta)
      expect(deEdge.total).toEqual(app.totalesContabilidad(enRango))
    }
    // Las dos quincenas suman el mes de la pantalla.
    const q1 = armarDetalle(E, dias, armarQuincena(2026, 9, 1)).total, q2 = armarDetalle(E, dias, armarQuincena(2026, 9, 2)).total
    expect(q1.ventaNeta + q2.ventaNeta).toBeCloseTo(p.total.ventaNeta, 6)
    expect(q1.pax + q2.pax).toBe(p.total.pax)
  })
})

describe('contrato con la pantalla renderizada', () => {
  it('la fila TOTAL de Contabilidad dice lo mismo que el TOTAL del correo', () => {
    const dias = diasFicticios(['2026-11-02', '2026-11-05', '2026-11-11', '2026-11-14']) as DiasMap
    const metas = { restaurante: {}, margen: {}, global: { promPax: 0, bebPax: 0, ratioCB: 0, ticketItem: 0, ventas: 0 }, salMetas: {} } as unknown as Meta
    const { container } = render(<VentasContabilidad dias={dias} hist={{}} metas={metas} pm={{}} />)
    const celdas = [...container.querySelectorAll('tfoot td')].map(td => (td.textContent ?? '').replace(/\s/g, ' '))
    const t = armarDetalle(E, dias, armarQuincena(2026, 11, 1)).total
    const plano = (s: string) => s.replace(/\s/g, ' ')
    expect(celdas).toEqual(['TOTAL', fi(t.ventaBruta), fi(t.iva), fi(t.serv), fi(t.ventaNeta), fi(t.salon), fi(t.delivery), String(t.pax), fi(t.promPax)].map(plano))
    // y las filas de la pantalla son los días con ventas del correo
    expect(container.querySelectorAll('tbody tr').length).toBe(4)
  })
})
