// Ventas v2 · 3.1a — PARIDAD (SPEC-3.1-catalogo §8.2). Las MISMAS facturas ficticias por dos caminos:
//   · el de hoy: `netaDelTicket` (`netaVenta.ts`, firmada) por factura, en céntimos como la 190 (Resumen), y `armarDia`
//     (el armador de «En vivo» y de los días del PoS), que da salón / delivery en colones;
//   · el nuevo: la forma de `pos_ventas_productos` (mig 196) —líneas sumadas por (código, familia de la línea, canal),
//     céntimos por línea, facturas sin líneas aparte— leída con `parsearVentasProductos` y sumada con `catalogoPos`.
// Tienen que dar la misma neta por día y canal, y por familia, al céntimo. Si no, «Productos» deja de cerrar contra
// «Resumen». La simulación de la función vive acá (el SQL real lo cuida scripts/sql/196_pruebas.sql contra la 190).
//
// Montos en céntimos enteros, como en el PoS (staging, 24-nov: 0 de 233.781 líneas con fracción de céntimo). La 196
// redondea por LÍNEA y la 190 por FACTURA: con fracciones de céntimo podrían separarse en un céntimo (PASE-196 lo lee
// en prod antes de la firma).
import { describe, it, expect } from 'vitest'
import { parsearVentasProductos, type LineaNdfRow, type TicketVentaRow } from '../../../shared/api/posNdf'
import { datos, l, t } from '../resumenV2.fixture'
import { diaCRDeFactura } from '../indicadores'
import { armarDia, esTicketOficial } from '../ventasEnVivoDatos'
import { netaDeProductos, netaPorCanal, netaPorFamilia } from '../catalogoPos'
import { esLineaDeVenta, netaDelTicket } from '../netaVenta'

const cts = (x: number) => Math.floor(x * 100 + 0.5)

/** Lo que devolvería `pos_ventas_productos` para esas facturas (solo C), como jsonb. */
function simular196(tickets: TicketVentaRow[], lineas: LineaNdfRow[]) {
  const oficiales = tickets.filter(esTicketOficial)
  const porTicket = new Map<string, LineaNdfRow[]>()
  for (const x of lineas) porTicket.set(x.ticket_id, [...(porTicket.get(x.ticket_id) ?? []), x])
  const filas = new Map<string, unknown[]>()
  let sinFacturas = 0, sinCts = 0
  for (const tk of oficiales) {
    const ls = porTicket.get(tk.id) ?? []
    if (ls.length === 0) { sinFacturas++; sinCts += cts(tk.valor_servido_crc ?? 0); continue }
    for (const x of ls) {
      const k = `${x.codigo_producto}|${x.familia}|${tk.canal}`
      const f = filas.get(k) ?? [x.codigo_producto, x.nombre, x.familia, tk.canal, 0, 0, 0, 'otros', 0]
      f[4] = (f[4] as number) + Math.round(x.cantidad ?? 0)
      f[5] = (f[5] as number) + cts(x.monto ?? 0)
      f[6] = (f[6] as number) + 1
      filas.set(k, f)
    }
  }
  const productos = [...filas.values()]
  const neta = productos.reduce((s, f) => s + (esLineaDeVenta(f[2] as number) ? (f[5] as number) : 0), 0) + sinCts
  return { productos, meses: [], catalogo: [], familias: [], sin_lineas: { facturas: sinFacturas, cts: sinCts }, neta_cts: neta }
}

function caso() {
  const { tickets, lineas } = datos('2026-10-01', 45, 11)
  // céntimos enteros, como el PoS
  const ls: LineaNdfRow[] = lineas.map(x => ({ ...x, monto: Math.round((x.monto ?? 0) * 100) / 100 }))
  // una anulada, una factura sin líneas (cae a su valor servido) y una línea sin familia
  tickets.push(t({ id: 'X1', estado: 'X', fecha_registra: '2026-10-05T20:00:00-06:00' }))
  ls.push(l('X1', 99_999, 2))
  tickets.push(t({ id: 'S1', fecha_registra: '2026-10-06T13:00:00-06:00', valor_servido_crc: 1234.5 }))
  tickets.push(t({ id: 'F1', fecha_registra: '2026-10-07T21:00:00-06:00', canal: 'delivery' }))
  ls.push({ ...l('F1', 3_500.25, 3), familia: null })
  return { tickets, lineas: ls }
}

describe('paridad 3.1a — la neta por día y canal: el camino de hoy = forma de la 196', () => {
  const { tickets, lineas } = caso()
  const dias = [...new Set(tickets.map(x => diaCRDeFactura(x.fecha_registra)))].sort()
  it(`${dias.length} días, al céntimo (salón y delivery)`, () => {
    let revisados = 0
    for (const dia of dias) {
      const delDia = tickets.filter(x => diaCRDeFactura(x.fecha_registra) === dia)
      const ids = new Set(delDia.map(x => x.id))
      const lDia = lineas.filter(x => ids.has(x.ticket_id))
      const viejo = armarDia(dia, delDia, lDia, '2026-11-24T05:30:00Z')
      const nuevo = parsearVentasProductos(simular196(delDia, lDia))
      const porCanal = netaPorCanal(nuevo)
      // las facturas sin líneas no tienen filas: van por su canal
      const sinLineas = delDia.filter(esTicketOficial).filter(x => !lDia.some(y => y.ticket_id === x.id))
      for (const s of sinLineas) porCanal.set(s.canal ?? 'salon', (porCanal.get(s.canal ?? 'salon') ?? 0) + cts(s.valor_servido_crc ?? 0))
      // al céntimo contra la neta firmada por factura (lo que suma la 190, `floor(neta × 100 + 0,5)` por factura)
      const viejoCts = new Map<string, number>()
      for (const x of delDia.filter(esTicketOficial)) {
        const c = x.canal ?? 'salon'
        viejoCts.set(c, (viejoCts.get(c) ?? 0) + cts(netaDelTicket(x, lDia.filter(y => y.ticket_id === x.id))))
      }
      expect(porCanal.get('salon') ?? 0, `${dia} salón`).toBe(viejoCts.get('salon') ?? 0)
      expect(porCanal.get('delivery') ?? 0, `${dia} delivery`).toBe(viejoCts.get('delivery') ?? 0)
      expect(netaDeProductos(nuevo), `${dia} total`).toBe((viejoCts.get('salon') ?? 0) + (viejoCts.get('delivery') ?? 0))
      // y al colón contra armarDia (salón / delivery de «En vivo», en colones redondeados)
      expect(Math.round((porCanal.get('salon') ?? 0) / 100), `${dia} salón armarDia`).toBe(Math.round(viejo.canales.salon))
      expect(Math.round((porCanal.get('delivery') ?? 0) / 100), `${dia} delivery armarDia`).toBe(Math.round(viejo.canales.delivery))
      revisados++
    }
    expect(revisados).toBe(dias.length)
  })
})

describe('paridad 3.1a — la neta por familia de la línea', () => {
  it('Σ por familia (líneas de venta de facturas C) = netaPorFamilia de la forma de la 196', () => {
    const { tickets, lineas } = caso()
    const oficiales = new Set(tickets.filter(esTicketOficial).map(x => x.id))
    const viejo = new Map<number | null, number>()
    for (const x of lineas) {
      if (!oficiales.has(x.ticket_id) || !esLineaDeVenta(x.familia)) continue
      viejo.set(x.familia, (viejo.get(x.familia) ?? 0) + cts(x.monto ?? 0))
    }
    const nuevo = netaPorFamilia(parsearVentasProductos(simular196(tickets, lineas)))
    expect([...nuevo.entries()].sort()).toEqual([...viejo.entries()].sort())
    expect(nuevo.has(17)).toBe(false)   // la regalía (familia 17) no es venta
    expect(nuevo.has(20)).toBe(false)
  })
})
