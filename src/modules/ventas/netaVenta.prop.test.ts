// Pruebas de PROPIEDADES de la venta NETA desde las líneas del PoS (`netaVenta.ts`, no se toca).
// Líneas ficticias con montos en colones enteros; familias del catálogo, desconocidas y sin familia.
//
// Semilla fija (R11). Si cae, fast-check imprime semilla y `path`; otra: `FC_SEED=123 npx vitest run <archivo>`.
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { netaDelTicket, netaPorTicket, esLineaDeVenta, FAMILIAS_NO_VENTA, FAMILIAS_CATALOGO, type LineaNeta, type AvisoCatalogo } from './netaVenta'

const SEED = Number(process.env.FC_SEED ?? 20261117)
fc.configureGlobal({ seed: SEED, numRuns: 300 })

const familia = fc.oneof(
  { weight: 6, arbitrary: fc.constantFrom(...FAMILIAS_CATALOGO) },
  { weight: 3, arbitrary: fc.constantFrom(...FAMILIAS_NO_VENTA) },
  { weight: 1, arbitrary: fc.constantFrom<number | null>(null, 7, 8, 30, 99) },   // sin familia / fuera del catálogo
)
// Colones enteros; incluye negativos chicos (devoluciones/descuentos en línea).
const monto = fc.oneof({ weight: 9, arbitrary: fc.integer({ min: 0, max: 120_000 }) }, { weight: 1, arbitrary: fc.integer({ min: -20_000, max: -1 }) })
type Linea = LineaNeta & { monto: number }
const linea = fc.record({ familia, monto, codigo_producto: fc.option(fc.string({ maxLength: 6 }), { nil: null }) }) as fc.Arbitrary<Linea>
const lineas = fc.array(linea, { minLength: 1, maxLength: 30 })
const ticket = { valor_servido_crc: 0, numero_factura: 'F-ficticia' }

const NO_VENTA = new Set<number | null | undefined>(FAMILIAS_NO_VENTA)
const sumaVenta = (ls: Linea[]) => ls.filter(l => !NO_VENTA.has(l.familia)).reduce((s, l) => s + l.monto, 0)

describe('netaVenta — propiedades', () => {
  it('neta = Σ monto de las líneas cuya familia no es {6, 17, 20} (sin familia y desconocidas cuentan)', () => {
    fc.assert(fc.property(lineas, ls => {
      expect(netaDelTicket(ticket, ls)).toBe(sumaVenta(ls))
      for (const l of ls) expect(esLineaDeVenta(l.familia)).toBe(!NO_VENTA.has(l.familia))
    }))
  })

  it('total − neta = exactamente la plata de las familias excluidas', () => {
    fc.assert(fc.property(lineas, ls => {
      const total = ls.reduce((s, l) => s + l.monto, 0)
      const excluida = ls.filter(l => NO_VENTA.has(l.familia)).reduce((s, l) => s + l.monto, 0)
      expect(total - netaDelTicket(ticket, ls)).toBe(excluida)
    }))
  })

  it('aditividad: partir las líneas en dos grupos no vacíos y sumar las netas da la neta del todo', () => {
    const particion = lineas.filter(ls => ls.length >= 2).chain(ls =>
      fc.integer({ min: 1, max: ls.length - 1 }).chain(k =>
        fc.shuffledSubarray(ls, { minLength: ls.length, maxLength: ls.length }).map(p => [p.slice(0, k), p.slice(k)] as const)))
    fc.assert(fc.property(particion, ([a, b]) => {
      expect(netaDelTicket(ticket, a) + netaDelTicket(ticket, b)).toBe(netaDelTicket(ticket, [...a, ...b]))
    }))
  })

  it('el orden de las líneas y pedir avisos no cambian la neta; los avisos no suman plata nueva', () => {
    const conPerm = lineas.chain(ls => fc.tuple(fc.constant(ls), fc.shuffledSubarray(ls, { minLength: ls.length, maxLength: ls.length })))
    fc.assert(fc.property(conPerm, ([ls, perm]) => {
      const avisos: AvisoCatalogo[] = []
      expect(netaDelTicket(ticket, perm, avisos)).toBe(netaDelTicket(ticket, ls))
      // Cada aviso es una línea de venta con plata ≠ 0 sin familia o fuera del catálogo.
      const esperados = ls.filter(l => l.monto !== 0 && esLineaDeVenta(l.familia)
        && (l.familia == null || !FAMILIAS_CATALOGO.includes(l.familia))).length
      expect(avisos).toHaveLength(esperados)
    }))
  })

  it('netaPorTicket = netaDelTicket de cada uno, sin importar cómo vengan mezcladas las líneas', () => {
    const datos = fc.array(lineas, { minLength: 1, maxLength: 6 }).chain(grupos => {
      const todas = grupos.flatMap((ls, i) => ls.map(l => ({ ...l, ticket_id: `t${i}` })))
      return fc.tuple(fc.constant(grupos), fc.shuffledSubarray(todas, { minLength: todas.length, maxLength: todas.length }))
    })
    fc.assert(fc.property(datos, ([grupos, mezcladas]) => {
      const tickets = grupos.map((_, i) => ({ ...ticket, id: `t${i}` }))
      const m = netaPorTicket(tickets, mezcladas)
      grupos.forEach((ls, i) => expect(m.get(`t${i}`)).toBe(netaDelTicket(ticket, ls)))
    }))
  })
})
