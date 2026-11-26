// Ventas v2 · 3.2 — PARIDAD de «Productos» definitiva contra el «Mix» viejo (SPEC-3.1-catalogo §7.3 paso 4, §2.5.2;
// SPEC-ventas-v2 §12.5 criterio 7). Las MISMAS facturas ficticias por los dos caminos:
//   · el viejo: `armarDiasMap` (los días del PoS) → `buildPMRaw` + `calcTotals` del Mix (`mixViejo.ts`, la cuenta que
//     pinta «Mix») con el `ProductMap` que arma la familia (sin curado a mano);
//   · el nuevo: la forma de `pos_ventas_productos` (mig 198) con la categoría efectiva de cada fila → `mixDelPeriodo`.
// La venta neta del período es la de «Resumen» (`netaDelTicket`, firmada) al céntimo. Las diferencias contra el Mix
// viejo son SOLO las que la spec dice, una por una (excepciones firmadas de la 3.2):
//   E1 · el Mix viejo suma solo el valor servido (familias 2, 3, 4, 5, 13, 16, 29): merch, gift cards, pax, dueños,
//        extras y las familias mixtas no estaban; «Productos» cierra contra la neta (§4.1 «otros que cierra contra la neta»).
//   E2 · D-3: los códigos de las familias 15 y 25 pasan a comida o bebida; el ítem por comensal de la 11, a `menu_especial`.
//   E3 · B-1: las unidades en ₡0 no son vendidas: no bajan el precio por ítem ni suman a bebidas vendidas.
// Datos FICTICIOS. El SQL real lo cuida scripts/sql/198_pruebas.sql contra la 190.
import { describe, it, expect } from 'vitest'
import { parsearVentasProductos, type LineaNdfRow, type TicketVentaRow } from '../../../shared/api/posNdf'
import { datos, l, t } from '../resumenV2.fixture'
import { armarDiasMap } from '../ventasDiasDesdePos'
import { buildPMRaw, calcTotals } from '../mixViejo'
import { mixDelPeriodo, productosDelPeriodo } from '../productosV2'
import { esLineaDeVenta, netaDelTicket } from '../netaVenta'
import { esTicketOficial } from '../ventasEnVivoDatos'

const cts = (x: number) => Math.floor(x * 100 + 0.5)

/** Categoría por defecto de cada familia (la carga de la 198) y los ajustes por código de las mixtas (§2.5). */
const CAT_FAMILIA: Record<number, string> = {
  2: 'comida', 3: 'comida', 4: 'comida', 13: 'comida', 16: 'comida', 29: 'comida', 5: 'bebida',
  11: 'comida', 15: 'comida', 25: 'bebida', 21: 'merch', 22: 'extras', 12: 'giftcard', 19: 'pax', 28: 'duenos',
  17: 'cortesia', 6: 'personal', 20: 'ingredientes',
}
const AJUSTE: Record<string, string> = { '192': 'menu_especial', '700': 'bebida', '304': 'comida', '519': 'bebida' }
/** `pos_categoria_efectiva`: 6/17/20 fijas · giftcard/pax/duenos fijas · ajuste por código · familia · otros. */
function categoria(familia: number | null, codigo: string | null): string {
  if (familia === 6) return 'personal'
  if (familia === 17) return 'cortesia'
  if (familia === 20) return 'ingredientes'
  const def = familia === null ? undefined : CAT_FAMILIA[familia]
  if (def === 'giftcard' || def === 'pax' || def === 'duenos') return def
  return (codigo && AJUSTE[codigo]) || def || 'otros'
}

/** Lo que devolvería `pos_ventas_productos` (solo C), como jsonb. */
function simular198(tickets: TicketVentaRow[], lineas: LineaNdfRow[], contarAnuladas = false) {
  const oficiales = tickets.filter(x => contarAnuladas ? x.estado !== 'R' : esTicketOficial(x))
  const porTicket = new Map<string, LineaNdfRow[]>()
  for (const x of lineas) porTicket.set(x.ticket_id, [...(porTicket.get(x.ticket_id) ?? []), x])
  const filas = new Map<string, unknown[]>()
  let sinFacturas = 0, sinCts = 0
  for (const tk of oficiales) {
    const ls = porTicket.get(tk.id) ?? []
    if (ls.length === 0) { sinFacturas++; sinCts += cts(tk.valor_servido_crc ?? 0); continue }
    for (const x of ls) {
      const k = `${x.codigo_producto}|${x.familia}|${tk.canal}`
      const f = filas.get(k) ?? [x.codigo_producto, x.nombre, x.familia, tk.canal, 0, 0, 0, categoria(x.familia, x.codigo_producto), 0]
      const u = Math.round(x.cantidad ?? 0), m = cts(x.monto ?? 0)
      f[4] = (f[4] as number) + u
      f[5] = (f[5] as number) + m
      f[6] = (f[6] as number) + 1
      if (m === 0) f[8] = (f[8] as number) + u
      filas.set(k, f)
    }
  }
  const productos = [...filas.values()]
  const neta = productos.reduce((s, f) => s + (esLineaDeVenta(f[2] as number) ? (f[5] as number) : 0), 0) + sinCts
  return parsearVentasProductos({ productos, meses: [], catalogo: [], familias: [], sin_lineas: { facturas: sinFacturas, cts: sinCts }, neta_cts: neta })
}

const linea = (ticket: string, monto: number, familia: number, codigo: string, cantidad = 1): LineaNdfRow =>
  ({ ...l(ticket, monto, familia), codigo_producto: codigo, nombre: `PRODUCTO ${codigo}`, cantidad })

function caso() {
  const { tickets, lineas } = datos('2026-10-01', 31, 21)
  // Colones enteros: el Mix viejo redondea al colón por (día, persona, producto) y la 198 suma céntimos; con montos
  // enteros (lo normal en la carta) los dos caminos tienen que dar lo mismo sin tolerancia.
  const ls: LineaNdfRow[] = lineas.map(x => ({ ...x, monto: Math.round(x.monto ?? 0) }))
  const extra = (id: string, dia: string, canal: string, ...lin: LineaNdfRow[]) => {
    tickets.push(t({ id, fecha_registra: `2026-10-${dia}T20:00:00-06:00`, canal }))
    ls.push(...lin)
  }
  extra('E15', '03', 'salon', linea('E15', 8_000, 15, '304', 2))                               // D-3: 15 → comida
  extra('E25', '04', 'salon', linea('E25', 6_000, 25, '519', 3))                               // D-3: 25 → bebida
  extra('E11', '05', 'salon', linea('E11', 90_000, 11, '192', 4), linea('E11', 0, 11, '700', 4)) // menú cerrado
  extra('E21', '06', 'salon', linea('E21', 15_000, 21, '930'))                                 // merch
  extra('E05', '07', 'salon', linea('E05', 0, 5, '55', 2), linea('E05', 3_000, 5, '56'))        // bebida en ₡0
  extra('EDL', '08', 'delivery', linea('EDL', 4_500, 22, '600'))                                // extras en delivery
  tickets.push(t({ id: 'X1', estado: 'X', fecha_registra: '2026-10-09T20:00:00-06:00' }))       // anulada
  ls.push(linea('X1', 99_999, 2, '1'))
  return { tickets, lineas: ls }
}

const RANGO = { desde: '2026-10-01', hasta: '2026-10-31' }

function caminos(contarAnuladas = false) {
  const { tickets, lineas } = caso()
  const { dias, pm } = armarDiasMap(tickets, lineas, RANGO, { uploadedAt: 'x', avisar: () => {} })
  const fechas = Object.keys(dias).sort()
  const viejo = calcTotals(buildPMRaw(fechas, dias, pm, 'todos'), 'todos')
  // Todos los canales: el «Solo Salón» del Mix viejo es «no es caja de turno», no el canal de la factura.
  const viejoUnidadesBebida = Object.values(buildPMRaw(fechas, dias, pm, 'todos')).filter(p => p.tipo === 'bebida').reduce((s, p) => s + p.unidades, 0)
  const rpc = simular198(tickets, lineas, contarAnuladas)
  const nuevo = mixDelPeriodo(rpc)
  const resumenCts = tickets.filter(esTicketOficial)
    .reduce((s, x) => s + cts(netaDelTicket(x, lineas.filter(y => y.ticket_id === x.id))), 0)
  return { viejo, viejoUnidadesBebida, rpc, nuevo, resumenCts }
}
const cat = (m: ReturnType<typeof mixDelPeriodo>, c: string) => m.categorias.find(x => x.categoria === c)

describe('paridad 3.2 — «Productos» contra «Resumen» y contra el «Mix» viejo', () => {
  it('la venta neta es la de «Resumen» al céntimo, y las categorías cierran contra ella', () => {
    const { nuevo, resumenCts } = caminos()
    expect(nuevo.netaCts).toBe(resumenCts)
    expect(nuevo.cierra).toBe(true)
    expect(nuevo.categorias.reduce((s, c) => s + c.montoCts, 0) + nuevo.sinDetalleCts).toBe(resumenCts)
  })

  it('una factura anulada que se colara rompe la paridad con «Resumen» (mutación de la prueba)', () => {
    const { nuevo, resumenCts } = caminos(true)
    expect(nuevo.netaCts).not.toBe(resumenCts)
  })

  it('E2 · comida y bebida = las del Mix viejo + solo los códigos de D-3 (15 → comida, 25 → bebida); el 192 va a menú especial', () => {
    const { viejo, nuevo } = caminos()
    expect(cat(nuevo, 'comida')!.montoCts).toBe(cts(viejo.totCom) + cts(8_000))
    expect(cat(nuevo, 'bebida')!.montoCts).toBe(cts(viejo.totBeb) + cts(6_000))
    expect(cat(nuevo, 'menu_especial')!.montoCts).toBe(cts(90_000))
  })

  it('E1 · neta − total del Mix viejo = exactamente lo que el Mix viejo no sumaba (D-3, menú especial, merch, extras, dueños)', () => {
    const { viejo, nuevo } = caminos()
    const fueraDelMixViejo = ['menu_especial', 'merch', 'extras', 'duenos', 'pax', 'giftcard', 'otros']
      .reduce((s, c) => s + (cat(nuevo, c)?.montoCts ?? 0), 0) + cts(8_000) + cts(6_000)
    expect(nuevo.netaCts - cts(viejo.totG)).toBe(fueraDelMixViejo + nuevo.sinDetalleCts)
    expect(cat(nuevo, 'duenos')!.montoCts).toBeGreaterThan(0)   // la fixture trae mesas de dueños (familia 28)
  })

  it('E3 · bebidas vendidas = unidades de bebida del Mix viejo − las en ₡0 de la 5 + las de bebida de D-3; el paso en ₡0 del menú va «incluido»', () => {
    const { viejoUnidadesBebida, rpc } = caminos()
    const bebida = productosDelPeriodo(rpc).filter(p => p.categoria === 'bebida')
    const vendidas = bebida.reduce((s, p) => s + p.unidadesVendidas * p.rinde, 0)
    expect(vendidas).toBe(viejoUnidadesBebida - 2 + 3)
    const paso = bebida.find(p => p.codigo === '700')!
    expect(paso.unidades).toBe(4)
    expect(paso.precioItemCts).toBeNull()
  })

  it('el delivery cierra solo con su canal (sin facturas sin detalle)', () => {
    const { rpc } = caminos()
    const d = mixDelPeriodo(rpc, 'delivery')
    expect(d.cierra).toBe(true)
    expect(cat(d, 'extras')!.montoCts).toBe(cts(4_500))
  })
})
