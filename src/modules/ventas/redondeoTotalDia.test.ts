// Decisión del dueño (18-nov 07:46, opción A): el TOTAL del día y del período = round(Σ crudo), UNA vez.
// Antes `armarDia` redondeaba neta, IVA, servicio y delivery POR BALDE (salonero / caja) y `getDayStats` sumaba
// esos redondeados: si una factura cambiaba de salonero, el total del día se movía ±₡1 por columna.
// Datos ficticios. Sin fast-check en el repo (entra con #259): propiedad con un generador sembrado y determinista.
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

import { armarDia } from './ventasEnVivoDatos'
import { diaConCajasDeTurno, getDayStats, totalesContabilidad, getContabilidadDays, sumarPartesRedondeando } from './ventasUtils'
import { totalesDelRango } from './totalesVentas'
import { totalesEnRango } from './aLaFecha'
import type { TicketNdfConId } from '../../shared/api/posNdf'
import type { CajeroDay, DiaData, SaloneroDay } from '../../shared/types/ventas'

const ticket = (over: Partial<TicketNdfConId> = {}): TicketNdfConId => ({
  id: 't1', numero_factura: '5001', estado: 'C', fecha_registra: '2026-09-01T19:42:07-06:00',
  fecha_cierra: null, cajero_login: '222',
  canal: 'salon', mesa: null, salonero_login: '026', registrado_por: 'salonero', turno: 'noche',
  con_servicio: true, servicio_crc: 0, total_crc: 0, valor_servido_crc: 0,
  iva_crc: 0, regalia_crc: 0, descuento_crc: 0, clase_ingreso: 'cobrada',
  pax: 2, pax_nativo: 2, pax_articulo: 2, pax_alerta: 'ok', ...over,
})
const NOMBRES = { '026': 'MESERO_A', '027': 'MESERO_B', '028': 'MESERO_C' }
const LOGINS = Object.keys(NOMBRES)
// Sin líneas: la neta del ticket es `valor_servido_crc` (ver `netaDelTicket`).
const dia = (ts: TicketNdfConId[]): DiaData => armarDia('2026-09-01', ts, [], '2026-09-02', NOMBRES).dia
const CAMPOS = ['ventaNeta', 'iva', 'serv', 'delivery', 'salon', 'ventaBruta'] as const

/** La cuenta VIEJA (la del bug): Σ de los baldes ya redondeados. Solo para medir el efecto. */
function totalViejo(d: DiaData): Record<(typeof CAMPOS)[number], number> {
  let ventaNeta = 0, iva = 0, serv = 0, delivery = 0, salon = 0
  for (const s of Object.values(d.saloneros)) {
    const dl = (s as CajeroDay).esCajero ? (s as CajeroDay).delivery : ((s as SaloneroDay).delivery ?? 0)
    ventaNeta += s.total; iva += s.iva; serv += s.serv; delivery += dl
    salon += (s as CajeroDay).esCajero ? (s as CajeroDay).salon : s.total - dl
  }
  return { ventaNeta, iva, serv, delivery, salon, ventaBruta: ventaNeta + iva + serv }
}

// Generador sembrado (mulberry32): siempre los mismos casos.
function prng(semilla: number) {
  let a = semilla >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const ent = (r: () => number, max: number) => Math.floor(r() * max)

function casoAleatorio(r: () => number): TicketNdfConId[] {
  const n = 2 + ent(r, 11)
  return Array.from({ length: n }, (_, i) => {
    // Montos con céntimos (como el IVA y la neta del PoS); a veces ,50 justo, que es donde muerde.
    const cts = () => (r() < 0.3 ? ent(r, 50_000) * 100 + 50 : ent(r, 5_000_000))
    return ticket({
      id: `t${i}`, numero_factura: String(6000 + i),
      salonero_login: LOGINS[ent(r, LOGINS.length)],
      canal: r() < 0.25 ? 'delivery' : 'salon',
      valor_servido_crc: cts() / 100, iva_crc: cts() / 100, servicio_crc: cts() / 100,
    })
  })
}

describe('total del día = round(Σ crudo), no Σ de baldes redondeados (opción A, 18-nov)', () => {
  it('caso a mano: dos facturas de ₡1.000,50 — el total es ₡2.001 con uno o con dos saloneros', () => {
    const a = ticket({ id: 'a', numero_factura: '1', valor_servido_crc: 1000.5, iva_crc: 130.5, servicio_crc: 100.5 })
    const b = ticket({ id: 'b', numero_factura: '2', valor_servido_crc: 1000.5, iva_crc: 130.5, servicio_crc: 100.5 })
    const juntos   = dia([a, { ...b, salonero_login: '026' }])
    const partidos = dia([a, { ...b, salonero_login: '027' }])
    // Lo de antes (medido): partido daba 1.001 + 1.001 = 2.002; juntos, round(2.001) = 2.001.
    expect(totalViejo(partidos).ventaNeta - totalViejo(juntos).ventaNeta).toBe(1)
    expect(totalViejo(partidos).ventaBruta - totalViejo(juntos).ventaBruta).toBe(3)
    // Ahora: el mismo número las dos veces, y es round(Σ crudo).
    for (const d of [juntos, partidos]) {
      expect(getDayStats(d)).toMatchObject({ ventaNeta: 2001, iva: 261, serv: 201, ventaBruta: 2463, salon: 2001, delivery: 0 })
    }
    // Lo que se muestra por persona sigue redondeado por persona.
    expect(partidos.saloneros.MESERO_A.total).toBe(1001)
    expect(partidos.saloneros.MESERO_B.total).toBe(1001)
  })

  it('PROPIEDAD: el total del día no cambia si se reasigna el salonero de cualquier factura (600 casos)', () => {
    const r = prng(20261118)
    let casos = 0, maxViejo = 0
    for (let k = 0; k < 600; k++) {
      const ts = casoAleatorio(r)
      const base = getDayStats(dia(ts))
      const crudo = (campo: 'valor_servido_crc' | 'iva_crc' | 'servicio_crc', soloDelivery = false) =>
        Math.round(ts.filter(t => !soloDelivery || t.canal === 'delivery')
          .reduce((s, t) => s + Math.round(Number(t[campo]) * 100), 0) / 100)
      expect(base.ventaNeta).toBe(crudo('valor_servido_crc'))
      expect(base.iva).toBe(crudo('iva_crc'))
      expect(base.serv).toBe(crudo('servicio_crc'))
      expect(base.delivery).toBe(crudo('valor_servido_crc', true))
      expect(base.salon).toBe(base.ventaNeta - base.delivery)
      expect(base.ventaBruta).toBe(base.ventaNeta + base.iva + base.serv)
      const viejoBase = totalViejo(dia(ts))
      for (let i = 0; i < ts.length; i++) {
        for (const otro of LOGINS) {
          if (otro === ts[i].salonero_login) continue
          const movido = ts.map((t, j) => (j === i ? { ...t, salonero_login: otro } : t))
          const d = dia(movido)
          const s = getDayStats(d)
          for (const c of CAMPOS) expect(s[c], `caso ${k}, factura ${i} → ${otro}, ${c}`).toBe(base[c])
          const v = totalViejo(d)
          for (const c of CAMPOS) maxViejo = Math.max(maxViejo, Math.abs(v[c] - viejoBase[c]))
          casos++
        }
      }
    }
    expect(casos).toBeGreaterThan(5000)
    // La medición del bug: con la cuenta vieja, mover UNA factura movía el total (bruta hasta ±₡3).
    expect(maxViejo).toBeGreaterThanOrEqual(2)
    expect(maxViejo).toBeLessThanOrEqual(3)
  })

  it('la caja también: mover una factura de un mesero a un balde de caja no mueve el total', () => {
    const a = ticket({ id: 'a', numero_factura: '1', valor_servido_crc: 500.5, iva_crc: 65.5, servicio_crc: 50.5 })
    const b = ticket({ id: 'b', numero_factura: '2', valor_servido_crc: 700.5, iva_crc: 91.5, servicio_crc: 70.5, canal: 'delivery' })
    const conMesero = getDayStats(dia([a, b]))
    const conCaja   = getDayStats(dia([a, { ...b, salonero_login: null, registrado_por: 'cajero' }]))
    for (const c of CAMPOS) expect(conCaja[c], c).toBe(conMesero[c])
    expect(conMesero.ventaNeta).toBe(1201)
  })
})

describe('total del período = SUMA de los días ya redondeados que se muestran (opción A, 18-nov 08:14)', () => {
  // Dos días, cada uno con una factura de ₡1.000,50: cada fila muestra 1.001 (un redondeo por día).
  const d1 = dia([ticket({ id: 'a', valor_servido_crc: 1000.5, iva_crc: 0.5, servicio_crc: 0.5 })])
  const d2 = dia([ticket({ id: 'b', valor_servido_crc: 1000.5, iva_crc: 0.5, servicio_crc: 0.5 })])
  const DIAS = { '2026-11-02': d1, '2026-11-03': d2 }

  it('Contabilidad: la fila TOTAL = Σ de las filas que se ven (igual que la fórmula de suma del Excel)', () => {
    const filas = getContabilidadDays(2026, 11, DIAS, {})
    expect(filas.map(f => f.ventaNeta)).toEqual([1001, 1001])
    expect(totalesContabilidad(filas)).toMatchObject({ ventaNeta: 2002, iva: 2, serv: 2, ventaBruta: 2006, salon: 2002, delivery: 0, pax: 4 })
  })

  it('Inicio (`totalesDelRango`) y «a la fecha» (`totalesEnRango`) dan el mismo total que la fila TOTAL', () => {
    expect(totalesDelRango(DIAS)).toMatchObject({ ventaNeta: 2002, iva: 2, serv: 2, ventaBruta: 2006, dias: 2 })
    const filas = getContabilidadDays(2026, 11, DIAS, {})
    expect(totalesEnRango(filas, { desde: '2026-11-01', hasta: '2026-11-30' }))
      .toMatchObject({ ventaNeta: 2002, iva: 2, serv: 2, ventaBruta: 2006, dias: 2 })
  })

  it('PROPIEDAD: TOTAL = Σ filas mostradas, y no cambia al reasignar el salonero de cualquier factura (200 períodos)', () => {
    const r = prng(20261118 + 1)
    const COLS = ['ventaBruta', 'iva', 'serv', 'ventaNeta', 'salon', 'delivery', 'pax'] as const
    for (let k = 0; k < 200; k++) {
      const nDias = 1 + ent(r, 15)
      const porDia = Array.from({ length: nDias }, () => casoAleatorio(r))
      const mapa = (ts: TicketNdfConId[][]) => Object.fromEntries(ts.map((x, i) =>
        [`2026-11-${String(i + 1).padStart(2, '0')}`, dia(x)]))
      const filas = getContabilidadDays(2026, 11, mapa(porDia), {})
      const t = totalesContabilidad(filas)
      for (const c of COLS) expect(t[c], `período ${k}, ${c}`).toBe(filas.reduce((s, f) => s + f[c], 0))
      expect(totalesDelRango(mapa(porDia)).ventaNeta).toBe(t.ventaNeta)
      // Reasignar una factura cualquiera de un día cualquiera: ninguna fila ni el TOTAL se mueven.
      const di = ent(r, nDias), fi = ent(r, porDia[di].length)
      const otro = LOGINS.find(l => l !== porDia[di][fi].salonero_login)!
      const movido = porDia.map((x, i) => (i !== di ? x : x.map((tk, j) => (j === fi ? { ...tk, salonero_login: otro } : tk))))
      const filas2 = getContabilidadDays(2026, 11, mapa(movido), {})
      expect(filas2.map(f => [f.ventaNeta, f.iva, f.serv, f.delivery])).toEqual(filas.map(f => [f.ventaNeta, f.iva, f.serv, f.delivery]))
      expect(totalesContabilidad(filas2)).toEqual(t)
    }
  })

  it('los días sin crudo (.xls / ventas_hist) se suman tal cual, sin redondear', () => {
    expect(sumarPartesRedondeando([
      { neta: 1000.25, iva: 130, serv: 100, delivery: 50, salon: 900, bruta: 1500.25 },
      { neta: 10.5, iva: 0, serv: 0, delivery: 0, salon: 10.5, bruta: 10.5 },
    ])).toMatchObject({ ventaNeta: 1010.75, ventaBruta: 1510.75, salon: 910.5, delivery: 50 })
  })
})

describe('`sumarCajeroDay` (vía `diaConCajasDeTurno`) funde también el crudo', () => {
  const caja = (total: number, cts: number): CajeroDay => ({
    esCajero: true, total, salon: 0, delivery: total, iva: 0, serv: 0, ordenes: 1, ticketProm: total, prods: [],
    crudoCts: { neta: cts, iva: 0, serv: 0, delivery: cts },
  })
  // Dos nombres del MISMO turno (como los trae el .xls) que se funden en «Cajero turno mañana».
  // Cada uno: ₡500,50 crudo → 501 redondeado. Fundidos: round(1.001,00) = 1.001, no 1.002.
  const d: DiaData = {
    fileName: 'ndf 2026-09-01', uploadedAt: '2026-09-02',
    saloneros: { 'Cajero turno mañana': caja(501, 50050), 'cajero turno manana': caja(501, 50050) },
  }

  it('el balde fundido lleva la suma del crudo y el total del día no cambia al fundir', () => {
    const fundido = diaConCajasDeTurno(d)
    const claves = Object.keys(fundido.saloneros)
    expect(claves).toHaveLength(1)
    expect((fundido.saloneros[claves[0]] as CajeroDay).crudoCts).toEqual({ neta: 100100, iva: 0, serv: 0, delivery: 100100 })
    expect(getDayStats(fundido)).toMatchObject({ ventaNeta: 1001, delivery: 1001, salon: 0 })
    for (const c of CAMPOS) expect(getDayStats(fundido)[c], c).toBe(getDayStats(d)[c])
  })
})
