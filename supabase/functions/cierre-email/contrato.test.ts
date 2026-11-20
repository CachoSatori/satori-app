// CONTRATO: el resumen del correo del cierre sale de la MISMA lógica que la app.
//   1. El paquete commiteado (`ventasPos.gen.js`) es exactamente el que sale hoy de
//      `src/modules/ventas/resumenCierrePuro.ts` (no quedó viejo) y no lleva nombres ni imports.
//   2. Mismas facturas → app (src/) y Edge (paquete) dan el mismo resumen, campo por campo; y los
//      totales son los de `getDayStats` (Contabilidad) y el promedio, el D4 de `indicadores.ts`.
//   3. La forma que devuelve el paquete es la que espera la Edge (`ResumenDia` de resumen.ts).
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

vi.mock('../../../src/shared/api/supabase', () => ({ supabase: null }))
import * as app from '../../../src/modules/ventas/resumenCierrePuro'
import { getDayStats } from '../../../src/modules/ventas/ventasUtils'
import { armarDia } from '../../../src/modules/ventas/ventasEnVivoDatos'
import { facturasDesdePos, ventaPorPersona } from '../../../src/modules/ventas/indicadores'
import { COLS_LINEAS_067, COLS_TICKETS_067 } from '../../../src/modules/ventas/ventasPosPuro'
import * as edge from './ventasPos.gen.js'
import type { LogicaResumen, ResumenDia } from './resumen.ts'
import { diaFicticio } from './pruebas.fixtures.ts'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, '..', '..', '..')
const E = edge as unknown as LogicaResumen
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const A = app as any

const CLAVES: (keyof ResumenDia)[] = ['dia', 'facturas', 'ventaBruta', 'ventaNeta', 'salon', 'delivery', 'pax', 'promPax',
  'pctEstimado', 'mesasDuenos', 'regaliasTotales', 'bebPax', 'masVendio', 'mejorPromPax']

describe('contrato: el paquete de la Edge está al día con src/', () => {
  it('ventasPos.gen.js = empaquetar(resumenCierrePuro.ts) de hoy, sin imports ni nombres', async () => {
    const { empaquetar } = await import(pathToFileURL(join(RAIZ, 'scripts/edge/empaquetar-ventas-pos.mjs')).href)
    const fresco: string = await empaquetar(join(RAIZ, 'src/modules/ventas/resumenCierrePuro.ts'))
    const commiteado = readFileSync(join(AQUI, 'ventasPos.gen.js'), 'utf8')
    expect(commiteado.split('\n')[0]).toMatch(/Fuente: src\/modules\/ventas\/resumenCierrePuro\.ts @/)
    // Si cae: node scripts/edge/empaquetar-ventas-pos.mjs --entrada src/modules/ventas/resumenCierrePuro.ts supabase/functions/cierre-email/ventasPos.gen.js
    expect(commiteado.split('\n').slice(4).join('\n')).toBe(fresco)
    expect(fresco).not.toMatch(/^import /m)
    expect(fresco).toMatch(/const SALONEROS_CONOCIDOS = \{\}/)
  })

  it('el paquete lee las MISMAS columnas que las funciones de la 067', () => {
    expect([...edge.COLS_TICKETS_067]).toEqual([...COLS_TICKETS_067])
    expect([...edge.COLS_LINEAS_067]).toEqual([...COLS_LINEAS_067])
    expect(edge.ventanaRangoJornadas('2026-11-10', '2026-11-10'))
      .toEqual({ desde: '2026-11-09T00:00:00-06:00', hasta: '2026-11-12T00:00:00-06:00' })
    expect(E.sumarDias('2026-11-03', -7)).toBe('2026-10-27')
    expect([E.MIN_MESAS, E.MIN_PERSONAS]).toEqual([app.MIN_MESAS, app.MIN_PERSONAS])
  })
})

describe('contrato: mismas facturas → mismo resumen que la app', () => {
  it('día ficticio completo: app = Edge, campo por campo, con la forma que espera la Edge', () => {
    const { tickets, lineas } = diaFicticio('2026-11-10')
    const deApp = A.resumenVentasDia(tickets, lineas, '2026-11-10', {})
    const deEdge = E.resumenVentasDia(tickets, lineas, '2026-11-10', {})
    expect(deEdge).toEqual(deApp)
    expect(Object.keys(deEdge).sort()).toEqual([...CLAVES].sort())
    expect(deEdge.ventaNeta).toBeGreaterThan(0)          // el caso muerde: hay plata
    expect(deEdge.mesasDuenos).toBe(1)
    expect(deEdge.pctEstimado).toBeGreaterThan(0)
  })

  it('los totales son los de Contabilidad (getDayStats) y el promedio, el D4', () => {
    const { tickets, lineas } = diaFicticio('2026-11-10')
    const r = E.resumenVentasDia(tickets, lineas, '2026-11-10', {})
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const st = getDayStats(armarDia('2026-11-10', tickets as any, lineas as any, '2026-11-10').dia)
    expect({ b: r.ventaBruta, n: r.ventaNeta, s: r.salon, d: r.delivery, p: r.pax })
      .toEqual({ b: st.ventaBruta, n: st.ventaNeta, s: st.salon, d: st.delivery, p: st.pax })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d4 = ventaPorPersona(facturasDesdePos(tickets as any, lineas as any), { desde: '2026-11-10', hasta: '2026-11-10' })
    expect(r.promPax).toBe(d4.valor)
  })

  it('caso de paridad de la app (__paridad__): app = Edge en cada día', () => {
    const caso = JSON.parse(readFileSync(join(RAIZ, 'src/modules/ventas/__paridad__/caso.json'), 'utf8'))
    for (const dia of ['2026-10-05', '2026-10-06']) {
      expect(E.resumenVentasDia(caso.tickets, caso.lineas, dia, {})).toEqual(A.resumenVentasDia(caso.tickets, caso.lineas, dia, {}))
    }
    expect(E.resumenVentasDia(caso.tickets, caso.lineas, '2026-10-05', {}).ventaNeta).toBeGreaterThan(0)
  })

  it('los nombres no viajan en el paquete: sin `nombres`, el destacado sale sin nombre', () => {
    const { tickets, lineas } = diaFicticio('2026-11-10')
    const r = E.resumenVentasDia(tickets, lineas, '2026-11-10', {})
    expect(r.masVendio?.nombre).toBeNull()
  })
})
