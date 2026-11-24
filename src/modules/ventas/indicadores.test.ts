import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

import { readFileSync } from 'node:fs'
import { FAMILIA_DUENOS as FAMILIA_DUENOS_POS } from '../../shared/ndf/mapTicket'
import {
  alertaMesasSinPax, diaCRDeFactura, esMesaDeDuenos, esRegaliaTotal, FAMILIA_DUENOS, estimadorPorNeta, facturasDesdePos,
  franjaDeHora, HORA_FIN_NOCHE, personasCargadas, rangoAyer, rangoDeLecturaParaEstimar,
  turnoPorHora, ubicarFactura, ubicarFacturas, ventaPorPersona, ventaPorPersonaPorSalonero,
  netaSalonDeSalonero, ventaPorPersonaDeTotales,
  type EstimadorPersonas, type FacturaIndicador, type Ubicacion,
} from './indicadores'
import { sumarDias } from './periodosPromPax'
import { HORA_CORTE_JORNADA } from '../../shared/api/posNdf'
import { paxDelTicket } from './ventasEnVivoDatos'
import { totales, type FilaAgregada } from './ventasPromPaxExplicado'
import { todayCR } from '../../shared/utils'

// ╔══════════════════════════════════════════════════════════════════════════════════════╗
// ║ Ventas v2 · indicadores — venta por persona con pax estimado + alerta de mesas sin pax ║
// ╚══════════════════════════════════════════════════════════════════════════════════════╝
// Datos ficticios. Semana ISO de prueba: lun 16-nov-2026 → dom 22-nov-2026 (la anterior, 09–15).

let seq = 0
type Extra = Partial<Omit<FacturaIndicador, 'fecha_registra'>>
/**
 * Una factura con su hora CR de pared («2026-11-18 20:00»), escrita con offset −06:00.
 * Caja por defecto, como en el local: 06–16 h la 111 (cierra 16:30); si no, la 222 de la jornada
 * (la de la noche anterior si es madrugada), que cierra 01:45 del día siguiente.
 */
function fac(cr: string, o: Extra = {}): FacturaIndicador {
  seq += 1
  const [dia, hhmm] = cr.split(' ')
  const h = Number(hhmm.slice(0, 2))
  const cajero = o.cajero_login !== undefined ? o.cajero_login : h >= 6 && h <= 16 ? '111' : '222'
  const jornada = h < 6 ? sumarDias(dia, -1) : dia
  const cierre = o.fecha_cierra !== undefined ? o.fecha_cierra
    : cajero === '111' ? `${dia}T16:30:00-06:00`
    : cajero === '222' ? `${sumarDias(jornada, 1)}T01:45:00-06:00`
    : null
  return {
    id: o.id ?? `f${seq}`,
    fecha_registra: `${dia}T${hhmm}:00-06:00`,
    estado: o.estado ?? 'C',
    canal: o.canal === undefined ? 'salon' : o.canal,
    salonero_login: o.salonero_login === undefined ? '901' : o.salonero_login,
    pax: o.pax === undefined ? null : o.pax,
    pax_articulo: o.pax_articulo ?? null,
    neta: o.neta ?? 0,
    cajero_login: cajero,
    fecha_cierra: cierre,
    total_crc: o.total_crc === undefined ? Math.round((o.neta ?? 0) * 1.23) || 1 : o.total_crc,
    clase_ingreso: o.clase_ingreso ?? 'cobrada',
    ...(o.neta_duenos !== undefined ? { neta_duenos: o.neta_duenos } : {}),
  }
}

const SEMANA = { desde: '2026-11-16', hasta: '2026-11-22' }
const NULO: EstimadorPersonas = { id: 'nulo', estimar: () => null }
const U = (f: FacturaIndicador): Ubicacion => ubicarFactura(f)!

afterEach(() => { vi.useRealTimers() })

// ── Contrato: UNA sola venta por persona ────────────────────────────────────────────────────

describe('contrato — una sola definición', () => {
  it('personas cargadas = `paxDelTicket` (artículo pax; si falta, pax del ticket)', () => {
    const casos: [number | null, number | null][] = [
      [null, null], [0, 0], [3, 0], [0, 4], [3, 4], [null, 2], [5, null], [-1, 2], [2, -1],
    ]
    for (const [pax, pax_articulo] of casos) {
      expect(personasCargadas({ pax, pax_articulo })).toBe(paxDelTicket({ pax, pax_articulo }))
    }
  })

  it('la franja horaria es la misma de la RPC 080 (06–16 mañana · 17–23 noche · 00–05 madrugada)', () => {
    const sql = readFileSync(new URL('../../../supabase/migrations/080_pos_prompax_agregado.sql', import.meta.url), 'utf8')
    expect(sql).toMatch(/between 6 and 16 then 'mañana'/)
    expect(sql).toMatch(/between 17 and 23 then 'noche'/)
    for (let h = 0; h < 24; h++) {
      const esperado = h >= 6 && h <= 16 ? 'mañana' : h >= 17 ? 'noche' : 'madrugada'
      expect(franjaDeHora(h)).toBe(esperado)
    }
  })

  it('la madrugada de la caja de noche abierta corta a la misma hora que la jornada del PoS', () => {
    expect(HORA_FIN_NOCHE).toBe(HORA_CORTE_JORNADA)
  })

  it('sin facturas sin pax, da EXACTO el Prom/PAX de `ventasPromPaxExplicado.totales`', () => {
    const fs = [
      fac('2026-11-17 13:00', { pax: 2, neta: 31_000 }),
      fac('2026-11-17 20:00', { pax: 3, neta: 47_500 }),
      fac('2026-11-18 21:00', { pax_articulo: 4, pax: 1, neta: 52_100 }),
      fac('2026-11-18 21:30', { canal: 'delivery', pax: 0, neta: 18_000 }),
    ]
    const filas: FilaAgregada[] = fs.map(f => ({
      dia: diaCRDeFactura(f.fecha_registra), franja: 'noche', salonero_login: f.salonero_login,
      canal: f.canal ?? 'otro', tickets: 1, pax: personasCargadas(f), neta: f.neta,
      neta_sin_pax: personasCargadas(f) === 0 ? f.neta : 0, tickets_sin_pax: personasCargadas(f) === 0 ? 1 : 0,
    }))
    const r = ventaPorPersona(fs, SEMANA)
    expect(r.valor).toBe(totales(filas).promPax)
    expect(r.pctEstimado).toBe(0)
  })

  it('con el estimador nulo (no estima), da EXACTO el Prom/PAX de hoy: la v1 solo cambia el denominador', () => {
    const fs = [
      fac('2026-11-17 20:00', { pax: 2, neta: 40_000 }),
      fac('2026-11-17 20:30', { pax: 0, neta: 25_000 }),
    ]
    const r = ventaPorPersona(fs, SEMANA, { estimador: NULO })
    expect(r.valor).toBe((40_000 + 25_000) / 2)
    expect(r.facturasSinReferencia).toBe(1)
  })
})

// ── Casos por cobertura de pax ─────────────────────────────────────────────────────────────

describe('venta por persona — cobertura', () => {
  it('0 % sin pax: neta ÷ personas cargadas, nada estimado', () => {
    const fs = [
      fac('2026-11-18 19:00', { pax: 2, neta: 30_000 }),
      fac('2026-11-18 20:00', { pax: 4, neta: 50_000 }),
    ]
    const r = ventaPorPersona(fs, SEMANA)
    expect(r).toMatchObject({
      valor: 80_000 / 6, personasCargadas: 6, personasEstimadas: 0, pctEstimado: 0,
      facturasSalon: 2, facturasSinPax: 0, facturasSinReferencia: 0, estimador: 'v1-neta',
    })
  })

  it('11 % sin pax (1 de 9): estima con la referencia de su semana y turno', () => {
    const fs = Array.from({ length: 8 }, (_, i) => fac(`2026-11-19 ${18 + (i % 4)}:00`, { pax: 2, neta: 20_000 }))
    fs.push(fac('2026-11-19 21:30', { pax: 0, neta: 30_000 }))   // ref 10.000/persona → 3
    const r = ventaPorPersona(fs, SEMANA)
    expect(r.facturasSinPax / r.facturasSalon).toBeCloseTo(1 / 9)
    expect(r.personasCargadas).toBe(16)
    expect(r.personasEstimadas).toBe(3)
    expect(r.pctEstimado).toBeCloseTo((3 / 19) * 100)
    expect(r.netaSalon).toBe(190_000)
    expect(r.valor).toBe(190_000 / 19)
    expect(r.valorSoloConPax).toBe(10_000)
  })

  it('100 % sin pax en la semana: usa el mismo turno de las 4 semanas anteriores', () => {
    const fs = [
      fac('2026-11-02 20:00', { pax: 2, neta: 16_000 }),   // hace 2 semanas, noche
      fac('2026-11-10 20:00', { pax: 2, neta: 24_000 }),   // la anterior, noche → juntas: 10.000
      fac('2026-11-10 12:00', { pax: 1, neta: 90_000 }),   // la anterior, MAÑANA: no entra a la noche
      fac('2026-10-12 20:00', { pax: 1, neta: 99_000 }),   // hace 5 semanas: fuera del respaldo
      fac('2026-11-18 20:00', { pax: 0, neta: 50_000 }),
      fac('2026-11-19 20:00', { pax: null, neta: 20_000 }),
    ]
    const r = ventaPorPersona(fs, SEMANA)
    expect(r.facturasSinPax).toBe(2)
    expect(r.personasCargadas).toBe(0)
    expect(r.personasEstimadas).toBe(5 + 2)
    expect(r.pctEstimado).toBe(100)
    expect(r.valor).toBe(70_000 / 7)
  })

  it('sin referencia (ni la semana ni las 4 anteriores): no estima, avisa y la neta queda', () => {
    const fs = [
      fac('2026-11-18 20:00', { pax: 2, neta: 40_000 }),   // noche con pax
      fac('2026-11-18 12:00', { pax: 0, neta: 15_000 }),   // mañana sin pax y sin referencia
    ]
    const r = ventaPorPersona(fs, SEMANA)
    expect(r.facturasSinReferencia).toBe(1)
    expect(r.netaSinReferencia).toBe(15_000)
    expect(r.personasEstimadas).toBe(0)
    expect(r.netaSalon).toBe(55_000)
    expect(r.valor).toBe(55_000 / 2)
  })

  it('todo sin pax y sin historia: valor null, la neta sigue contada', () => {
    const r = ventaPorPersona([fac('2026-11-18 20:00', { pax: 0, neta: 12_000 })], SEMANA)
    expect(r.valor).toBeNull()
    expect(r.netaSalon).toBe(12_000)
    expect(r.facturasSinReferencia).toBe(1)
  })
})

// ── Bordes ─────────────────────────────────────────────────────────────────────────────────

describe('venta por persona — bordes', () => {
  // Mañana: 5.000/persona. Noche: 20.000/persona.
  const base = () => [
    fac('2026-11-17 12:00', { pax: 2, neta: 10_000 }),
    fac('2026-11-17 20:00', { pax: 2, neta: 40_000 }),
  ]

  it('el turno lo define la CAJA, no el reloj: 17:30 cobrada por la 111 es mañana; 16:30 por la 222, noche', () => {
    const m = fac('2026-11-18 17:30', { cajero_login: '111', fecha_cierra: '2026-11-18T17:45:00-06:00', pax: 0, neta: 40_000 })
    const n = fac('2026-11-18 16:30', { cajero_login: '222', fecha_cierra: '2026-11-19T01:00:00-06:00', pax: 0, neta: 40_000 })
    expect(U(m)).toEqual({ dia: '2026-11-18', turno: 'mañana', inferido: false })
    expect(U(n)).toEqual({ dia: '2026-11-18', turno: 'noche', inferido: false })
    const est = estimadorPorNeta(base())
    expect(est.estimar(m, U(m))).toBe(8)
    expect(est.estimar(n, U(n))).toBe(2)
    expect(ventaPorPersona([...base(), m], SEMANA, { turno: 'mañana' }).personasEstimadas).toBe(8)
    expect(ventaPorPersona([...base(), n], SEMANA, { turno: 'noche' }).personasEstimadas).toBe(2)
  })

  it('sin caja 111/222 cae al reloj y cuenta como inferido: 16:59 mañana, 17:00 noche (escrito en UTC)', () => {
    const m = { ...fac('2026-11-18 16:59', { cajero_login: null, pax: 0, neta: 40_000 }), fecha_registra: '2026-11-18T22:59:00Z' }
    const n = { ...fac('2026-11-18 17:00', { cajero_login: '388', pax: 0, neta: 40_000 }), fecha_registra: '2026-11-18T23:00:00Z' }
    expect(U(m)).toEqual({ dia: '2026-11-18', turno: 'mañana', inferido: true })
    expect(U(n)).toEqual({ dia: '2026-11-18', turno: 'noche', inferido: true })
    expect(turnoPorHora(m)).toBe('mañana')
    const r = ventaPorPersona([...base(), m, n], SEMANA)
    expect(r.turnosInferidos).toBe(2)
    expect(r.personasEstimadas).toBe(8 + 2)
  })

  it('madrugada con la caja de noche CERRADA después: es noche del día anterior', () => {
    const tarde = fac('2026-11-17 21:00', { pax: 2, neta: 40_000 })
    const madrugada = fac('2026-11-18 00:30', { pax: 0, neta: 40_000 })
    expect(madrugada.fecha_cierra).toBe(tarde.fecha_cierra)
    expect(ubicarFacturas([tarde, madrugada]).get(madrugada)).toEqual({ dia: '2026-11-17', turno: 'noche', inferido: false })
    const r = ventaPorPersona([tarde, madrugada], { desde: '2026-11-17', hasta: '2026-11-17' })
    expect(r).toMatchObject({ facturasSalon: 2, personasEstimadas: 2, turnosInferidos: 0 })
    expect(ventaPorPersona([tarde, madrugada], { desde: '2026-11-18', hasta: '2026-11-18' }).facturasSalon).toBe(0)
  })

  it('madrugada con la caja de noche todavía ABIERTA (en vivo): también noche del día anterior', () => {
    const f = fac('2026-11-18 00:30', { fecha_cierra: null, pax: 0, neta: 40_000 })
    expect(U(f)).toEqual({ dia: '2026-11-17', turno: 'noche', inferido: false })
    const tempranoMañana = fac('2026-11-18 08:00', { fecha_cierra: null })
    expect(U(tempranoMañana)).toEqual({ dia: '2026-11-18', turno: 'mañana', inferido: false })
  })

  it('madrugada SIN caja (inferido): noche del mismo día calendario, como la RPC 080', () => {
    const f = fac('2026-11-18 00:30', { cajero_login: null, pax: 0, neta: 40_000 })
    expect(diaCRDeFactura(f.fecha_registra)).toBe('2026-11-18')
    expect(U(f)).toEqual({ dia: '2026-11-18', turno: 'noche', inferido: true })
  })

  it('semana ISO: domingo 23:30 CR (lunes 05:30 UTC) usa la semana del domingo', () => {
    const fs = [
      fac('2026-11-20 20:00', { pax: 4, neta: 40_000 }),   // semana 16: 10.000
      fac('2026-11-24 20:00', { pax: 1, neta: 40_000 }),   // semana 23: 40.000
    ]
    const dom = { ...fac('2026-11-22 23:30', { pax: 0, neta: 40_000 }), fecha_registra: '2026-11-23T05:30:00Z' }
    expect(diaCRDeFactura(dom.fecha_registra)).toBe('2026-11-22')
    expect(U(dom).dia).toBe('2026-11-22')
    expect(estimadorPorNeta(fs).estimar(dom, U(dom))).toBe(4)
    const lunMadrugada = fac('2026-11-23 00:30', { pax: 0, neta: 40_000 })   // misma caja del domingo
    const uLun = ubicarFacturas([dom, lunMadrugada]).get(lunMadrugada)!
    expect(uLun.dia).toBe('2026-11-22')
    expect(estimadorPorNeta(fs).estimar(lunMadrugada, uLun)).toBe(4)
    expect(ventaPorPersona([...fs, dom, lunMadrugada], { desde: '2026-11-22', hasta: '2026-11-22' }).personasEstimadas).toBe(8)
    const lun = fac('2026-11-23 20:00', { pax: 0, neta: 40_000 })
    expect(estimadorPorNeta(fs).estimar(lun, U(lun))).toBe(1)
  })

  it('mínimo 1 persona, también con neta 0; la neta no se toca', () => {
    const fs = [...base(), fac('2026-11-17 21:00', { pax: 0, neta: 2_000 }), fac('2026-11-17 21:30', { pax: 0, neta: 0 })]
    const r = ventaPorPersona(fs, SEMANA)
    expect(r.personasEstimadas).toBe(2)
    expect(r.netaSalon).toBe(52_000)
  })

  it('delivery no entra: ni a la neta, ni a las personas, ni a la referencia', () => {
    const sinDelivery = [...base(), fac('2026-11-17 21:00', { pax: 0, neta: 60_000 })]
    const conDelivery = [
      ...sinDelivery,
      fac('2026-11-17 21:10', { canal: 'delivery', pax: 0, neta: 80_000 }),
      fac('2026-11-17 21:20', { canal: 'delivery', pax: 1, neta: 100_000 }),
    ]
    const a = ventaPorPersona(sinDelivery, SEMANA)
    const b = ventaPorPersona(conDelivery, SEMANA)
    expect(b).toEqual(a)
    expect(b.personasEstimadas).toBe(3)       // 60.000 ÷ 20.000 (la noche de salón)
  })

  it('solo facturas cerradas: una anulada no cuenta', () => {
    const r = ventaPorPersona([...base(), fac('2026-11-17 21:00', { estado: 'X', pax: 2, neta: 99_000 })], SEMANA)
    expect(r.facturasSalon).toBe(2)
  })

  it('el historial fuera del rango sirve de referencia pero no suma al resultado', () => {
    const fs = [fac('2026-11-12 20:00', { pax: 2, neta: 20_000 }), fac('2026-11-18 20:00', { pax: 0, neta: 30_000 })]
    const r = ventaPorPersona(fs, SEMANA)
    expect(r).toMatchObject({ netaSalon: 30_000, personasCargadas: 0, personasEstimadas: 3, facturasSalon: 1 })
    expect(rangoDeLecturaParaEstimar({ desde: '2026-11-18', hasta: '2026-11-18' }))
      .toEqual({ desde: '2026-10-19', hasta: '2026-11-18' })
  })

  it('la interfaz admite otro estimador (lugar de la v2 por platos y bebidas)', () => {
    const v2: EstimadorPersonas = { id: 'v2-platos', estimar: () => 2 }
    const r = ventaPorPersona([fac('2026-11-18 20:00', { pax: 0, neta: 30_000 })], SEMANA, { estimador: v2 })
    expect(r).toMatchObject({ estimador: 'v2-platos', personasEstimadas: 2, valor: 15_000 })
  })

  it('filtro por salonero (lente «mesa»)', () => {
    const fs = [fac('2026-11-18 20:00', { pax: 2, neta: 40_000, salonero_login: '901' }),
      fac('2026-11-18 20:00', { pax: 2, neta: 10_000, salonero_login: '902' })]
    expect(ventaPorPersona(fs, SEMANA, { filtro: f => f.salonero_login === '902' }).valor).toBe(5_000)
  })
})

// ── Propiedad: la venta nunca cambia por la estimación ─────────────────────────────────────

describe('propiedad — Σ venta no cambia con la estimación', () => {
  it('500 conjuntos al azar (semilla fija): la neta de salón es la misma con v1, nulo o constante', () => {
    let s = 12345
    const azar = () => ((s = (s * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648)
    const canales = ['salon', 'salon', 'salon', 'delivery', 'barra', null]
    for (let k = 0; k < 500; k++) {
      const fs: FacturaIndicador[] = []
      const cuantas = 1 + Math.floor(azar() * 25)
      for (let i = 0; i < cuantas; i++) {
        const dia = 2 + Math.floor(azar() * 21)
        const hora = Math.floor(azar() * 24)
        const regalo = azar() < 0.1
        fs.push(fac(`2026-11-${String(dia).padStart(2, '0')} ${String(hora).padStart(2, '0')}:15`, {
          canal: canales[Math.floor(azar() * canales.length)],
          pax: azar() < 0.4 ? 0 : Math.floor(azar() * 6),
          neta: Math.floor(azar() * 100_000),
          cajero_login: azar() < 0.15 ? null : undefined,
          ...(regalo ? { total_crc: 0, clase_ingreso: 'cortesia' } : {}),
          ...(azar() < 0.08 ? { clase_ingreso: 'duenos' } : {}),
        }))
      }
      const r = { desde: '2026-11-09', hasta: '2026-11-22' }
      const ubic = ubicarFacturas(fs)
      const esperado = fs
        .filter(f => f.canal === 'salon' && ubic.get(f)!.dia >= r.desde && ubic.get(f)!.dia <= r.hasta)
        .reduce((a, f) => a + f.neta, 0)
      const v1 = ventaPorPersona(fs, r)
      const nulo = ventaPorPersona(fs, r, { estimador: NULO })
      const tres = ventaPorPersona(fs, r, { estimador: { id: 'tres', estimar: () => 3 } })
      const todo = (x: typeof v1) => x.netaSalon + x.netaRegaliasTotales + x.netaMesasDuenos
      expect(todo(v1)).toBe(esperado)
      expect(nulo.netaSalon).toBe(v1.netaSalon)
      expect(tres.netaSalon).toBe(v1.netaSalon)
      expect(v1.personasCargadas).toBe(nulo.personasCargadas)
      expect(tres.personasEstimadas).toBe(3 * tres.facturasSinPax)
      const m = ventaPorPersona(fs, r, { turno: 'mañana' })
      const n = ventaPorPersona(fs, r, { turno: 'noche' })
      expect(todo(m) + todo(n)).toBe(esperado)
      expect(m.personasEstimadas + n.personasEstimadas).toBe(v1.personasEstimadas)
    }
  })
})

// ── Alerta de mesas sin pax ────────────────────────────────────────────────────────────────

describe('alerta de mesas sin pax', () => {
  it('reloj fijo de noche CR (23:30 CR = 05:30 UTC): «ayer» es el día CR anterior', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-17T05:30:00Z'))   // 16-nov 23:30 en Costa Rica
    const ayer = rangoAyer(todayCR())
    expect(ayer).toEqual({ desde: '2026-11-15', hasta: '2026-11-15' })
    const fs = [
      { ...fac('2026-11-15 23:30', { pax: 0 }), fecha_registra: '2026-11-16T05:30:00Z' },  // 15 23:30 CR
      fac('2026-11-16 00:40', { pax: 2 }),                                                  // caja de noche del 15
      { ...fac('2026-11-16 23:30', { pax: 0 }), fecha_registra: '2026-11-17T05:30:00Z' },  // 16 23:30 CR
    ]
    expect(alertaMesasSinPax(fs, ayer).total).toEqual({ facturasSalon: 2, sinPax: 1, pct: 50 })
  })

  it('por salonero, sin salonero aparte, delivery y anuladas fuera', () => {
    const dia = { desde: '2026-11-18', hasta: '2026-11-18' }
    const fs = [
      fac('2026-11-18 20:00', { salonero_login: '901', pax: 2 }),
      fac('2026-11-18 20:10', { salonero_login: '901', pax: 0 }),
      fac('2026-11-18 20:20', { salonero_login: '901', pax_articulo: 3 }),
      fac('2026-11-18 20:30', { salonero_login: '902', pax: null }),
      fac('2026-11-18 20:40', { salonero_login: '902', pax: 0 }),
      fac('2026-11-18 20:50', { salonero_login: '903', pax: 4 }),
      fac('2026-11-18 21:00', { salonero_login: null, pax: 0 }),
      fac('2026-11-18 21:10', { salonero_login: null, pax: 2 }),
      fac('2026-11-18 21:20', { salonero_login: '903', canal: 'delivery', pax: 0 }),
      fac('2026-11-18 21:30', { salonero_login: '903', estado: 'X', pax: 0 }),
      fac('2026-11-19 12:00', { salonero_login: '903', pax: 0 }),   // otro día
      fac('2026-11-18 21:40', { salonero_login: '903', pax: 0, total_crc: 0, clase_ingreso: 'cortesia' }),  // regalía total
      fac('2026-11-18 21:50', { salonero_login: null, pax: 0, total_crc: 0, neta: 0, clase_ingreso: null }), // neta 0 sin cobro
    ]
    const a = alertaMesasSinPax(fs, dia)
    expect(a.porSalonero).toEqual([
      { salonero_login: '902', facturasSalon: 2, sinPax: 2, pct: 100 },
      { salonero_login: '901', facturasSalon: 3, sinPax: 1, pct: (1 / 3) * 100 },
      { salonero_login: '903', facturasSalon: 1, sinPax: 0, pct: 0 },
    ])
    expect(a.sinSalonero).toEqual({ facturasSalon: 2, sinPax: 1, pct: 50 })
    expect(a.total).toEqual({ facturasSalon: 8, sinPax: 4, pct: 50 })
    expect(a.regaliasTotales).toBe(2)
    expect(a.mesasDuenos).toBe(0)
  })

  it('sin facturas: todo en 0, sin dividir por cero', () => {
    const a = alertaMesasSinPax([], { desde: '2026-11-18', hasta: '2026-11-18' })
    expect(a).toEqual({ porSalonero: [], sinSalonero: { facturasSalon: 0, sinPax: 0, pct: 0 }, total: { facturasSalon: 0, sinPax: 0, pct: 0 }, regaliasTotales: 0, mesasDuenos: 0, mesasInternas: 0 })
  })
})

// ── Desde las filas del PoS ────────────────────────────────────────────────────────────────

describe('facturasDesdePos', () => {
  it('arma la neta con `netaVenta.ts` (fuera familias 6, 17 y 20)', () => {
    const [f] = facturasDesdePos(
      [{ id: 't1', numero_factura: '1', estado: 'C', fecha_registra: '2026-11-18T02:00:00Z', canal: 'salon',
         salonero_login: '901', pax: 2, pax_articulo: null, valor_servido_crc: 0,
         cajero_login: '222', fecha_cierra: '2026-11-18T07:00:00Z', total_crc: 16_000, clase_ingreso: 'cobrada' }],
      [
        { ticket_id: 't1', familia: 2, monto: 10_000, codigo_producto: 'A' },
        { ticket_id: 't1', familia: 5, monto: 3_000, codigo_producto: 'B' },
        { ticket_id: 't1', familia: 17, monto: 4_000, codigo_producto: 'C' },
        { ticket_id: 't1', familia: 6, monto: 1_000, codigo_producto: 'D' },
      ],
    )
    expect(f.neta).toBe(13_000)
    expect(diaCRDeFactura(f.fecha_registra)).toBe('2026-11-17')
  })

  it('fecha sin zona se toma como hora CR', () => {
    expect(diaCRDeFactura('2026-11-17 23:30:00')).toBe('2026-11-17')
    expect(turnoPorHora({ fecha_registra: '2026-11-17 16:59:00' })).toBe('mañana')
    expect(diaCRDeFactura('no-es-fecha')).toBe('')
  })
})

// ── Regalías totales y grupo sin salonero ──────────────────────────────────────────────────

describe('regalías totales (decisión 17/11)', () => {
  it('qué es regalía total y qué no', () => {
    expect(esRegaliaTotal({ clase_ingreso: 'cortesia', total_crc: 0, neta: 0 })).toBe(true)
    expect(esRegaliaTotal({ clase_ingreso: 'duenos', total_crc: 0, neta: 25_000 })).toBe(true)
    expect(esRegaliaTotal({ clase_ingreso: 'sin_cobro', total_crc: null, neta: 18_000 })).toBe(true)
    expect(esRegaliaTotal({ clase_ingreso: null, total_crc: 0, neta: 0 })).toBe(true)
    // una línea de cortesía en una cuenta cobrada: mapClaseIngreso dice «cortesia», pero la mesa pagó
    expect(esRegaliaTotal({ clase_ingreso: 'cortesia', total_crc: 30_000, neta: 25_000 })).toBe(false)
    expect(esRegaliaTotal({ clase_ingreso: 'cobrada', total_crc: 30_000, neta: 25_000 })).toBe(false)
    expect(esRegaliaTotal({ clase_ingreso: null, total_crc: null, neta: 0 })).toBe(false)
  })

  it('fuera del numerador y del denominador, contadas aparte (dueños con total 0 = mesa de dueños)', () => {
    const fs = [
      fac('2026-11-18 20:00', { pax: 2, neta: 40_000 }),
      fac('2026-11-18 20:30', { pax: 3, neta: 0, total_crc: 0, clase_ingreso: 'cortesia' }),
      fac('2026-11-18 21:00', { pax: 0, neta: 22_000, total_crc: 0, clase_ingreso: 'duenos' }),
      fac('2026-11-18 21:30', { pax: 0, neta: 20_000 }),
    ]
    const r = ventaPorPersona(fs, SEMANA)
    expect(r).toMatchObject({
      regaliasTotales: 1, netaRegaliasTotales: 0, mesasDuenos: 1, netaMesasDuenos: 22_000,
      personasCargadas: 2, personasEstimadas: 1, facturasSinPax: 1, facturasSalon: 4, netaSalon: 60_000,
      valor: 20_000,
    })
  })

  it('no entran a la referencia del estimador', () => {
    const base = [fac('2026-11-18 20:00', { pax: 2, neta: 40_000 })]
    const conRegalo = [...base, fac('2026-11-18 20:10', { pax: 1, neta: 300_000, total_crc: 0, clase_ingreso: 'duenos' })]
    const f = fac('2026-11-18 21:00', { pax: 0, neta: 60_000 })
    expect(estimadorPorNeta(conRegalo).estimar(f, U(f))).toBe(estimadorPorNeta(base).estimar(f, U(f)))
    expect(estimadorPorNeta(base).estimar(f, U(f))).toBe(3)
  })
})

describe('grupo «sin salonero» siempre aparte', () => {
  it('venta por persona por salonero: el sin salonero no se mezcla con nadie', () => {
    const fs = [
      fac('2026-11-18 20:00', { salonero_login: '901', pax: 2, neta: 40_000 }),
      fac('2026-11-18 20:10', { salonero_login: '902', pax: 2, neta: 10_000 }),
      fac('2026-11-18 20:20', { salonero_login: null, pax: 4, neta: 20_000 }),
      fac('2026-11-18 20:30', { salonero_login: null, pax: 0, neta: 0, total_crc: 0, clase_ingreso: null }),
    ]
    const p = ventaPorPersonaPorSalonero(fs, SEMANA)
    expect(p.porSalonero.map(s => [s.salonero_login, s.valor])).toEqual([['901', 20_000], ['902', 5_000]])
    expect(p.sinSalonero).toMatchObject({ valor: 5_000, facturasSalon: 2, regaliasTotales: 1, facturasSinSalonero: 2 })
    expect(ventaPorPersona(fs, SEMANA).facturasSinSalonero).toBe(2)
  })
})

describe('mesas de dueños (decisión 17/11): fuera de la venta por persona y de la alerta', () => {
  it('la familia de dueños es la del PoS', () => {
    expect(FAMILIA_DUENOS).toBe(FAMILIA_DUENOS_POS)
  })

  it('criterio: con líneas, familia 28 > la mitad de la neta; sin líneas, clase `duenos`', () => {
    expect(esMesaDeDuenos({ clase_ingreso: 'duenos', neta: 30_000 })).toBe(true)
    expect(esMesaDeDuenos({ clase_ingreso: 'mixta', neta: 30_000 })).toBe(false)
    expect(esMesaDeDuenos({ clase_ingreso: 'mixta', neta: 30_000, neta_duenos: 20_000 })).toBe(true)
    // una línea de dueños en una cuenta cobrada: mesa normal
    expect(esMesaDeDuenos({ clase_ingreso: 'duenos', neta: 30_000, neta_duenos: 5_000 })).toBe(false)
    expect(esMesaDeDuenos({ clase_ingreso: 'duenos', neta: 30_000, neta_duenos: 15_000 })).toBe(false)
    expect(esMesaDeDuenos({ clase_ingreso: 'cobrada', neta: 0, neta_duenos: 0 })).toBe(false)
  })

  it('una mesa de dueños COBRADA y con pax tampoco entra (ni neta ni personas) y no va a la alerta', () => {
    const normal = fac('2026-11-18 20:00', { pax: 2, neta: 40_000 })
    const duenos = fac('2026-11-18 20:30', { pax: 4, neta: 90_000, total_crc: 50_000, clase_ingreso: 'duenos' })
    const duenosSinPax = fac('2026-11-18 21:00', { pax: 0, neta: 60_000, neta_duenos: 60_000, clase_ingreso: 'mixta' })
    const r = ventaPorPersona([normal, duenos, duenosSinPax], SEMANA)
    expect(r).toMatchObject({
      valor: 20_000, netaSalon: 40_000, personasCargadas: 2, personasEstimadas: 0,
      mesasDuenos: 2, netaMesasDuenos: 150_000, facturasSinPax: 0,
    })
    const a = alertaMesasSinPax([normal, duenos, duenosSinPax], { desde: '2026-11-18', hasta: '2026-11-18' })
    expect(a.total).toEqual({ facturasSalon: 1, sinPax: 0, pct: 0 })
    expect(a.mesasDuenos).toBe(2)
  })

  it('facturasDesdePos arma `neta_duenos` desde las líneas de familia 28', () => {
    const t = { numero_factura: '1', estado: 'C' as const, fecha_registra: '2026-11-18T02:00:00Z', canal: 'salon',
      salonero_login: '901', pax: 0, pax_articulo: null, valor_servido_crc: 0,
      cajero_login: '222', fecha_cierra: '2026-11-18T07:00:00Z', total_crc: 0, clase_ingreso: 'duenos' }
    const fs = facturasDesdePos(
      [{ ...t, id: 'a' }, { ...t, id: 'b', clase_ingreso: 'cobrada', total_crc: 9_000 }],
      [
        { ticket_id: 'a', familia: 28, monto: 12_000, codigo_producto: 'D' },
        { ticket_id: 'a', familia: 2, monto: 3_000, codigo_producto: 'A' },
        { ticket_id: 'b', familia: 2, monto: 9_000, codigo_producto: 'A' },
      ],
    )
    expect(fs.map(f => [f.neta, f.neta_duenos, esMesaDeDuenos(f)])).toEqual([[15_000, 12_000, true], [9_000, 0, false]])
  })
})

// ── Fase 1.3: una sola venta por persona también para las pantallas que leen totales ─────────
describe('ventaPorPersonaDeTotales (contrato «una sola venta por persona»)', () => {
  it('con los mismos datos da EXACTO lo de ventaPorPersona sin estimar', () => {
    const fs = [
      fac('2026-11-17 13:00', { neta: 30_000, pax_articulo: 2 }),
      fac('2026-11-17 20:00', { neta: 50_000, pax: 3 }),
      fac('2026-11-18 20:30', { neta: 12_000 }),                       // sin pax: neta adentro, sin personas
      fac('2026-11-18 21:00', { neta: 40_000, canal: 'delivery' }),   // delivery: fuera de todo
    ]
    const v = ventaPorPersona(fs, SEMANA, { estimador: NULO })
    const salon = fs.filter(f => f.canal === 'salon').reduce((s, f) => s + f.neta, 0)
    const personas = fs.reduce((s, f) => s + (f.canal === 'salon' ? personasCargadas(f) : 0), 0)
    expect(ventaPorPersonaDeTotales(salon, personas)).toBe(v.valor)
    expect(v.valor).toBeCloseTo(92_000 / 5, 9)
  })
  it('numerador = salón (nunca la neta total): mutación «neta total» cae acá', () => {
    // Un día: 800 de salón + 200 de delivery, 10 personas → 80 (con la neta total serían 100).
    expect(ventaPorPersonaDeTotales(800, 10)).toBe(80)
  })
  it('sin personas → null (la pantalla muestra «—», nunca 0 ni infinito)', () => {
    expect(ventaPorPersonaDeTotales(5_000, 0)).toBeNull()
    expect(ventaPorPersonaDeTotales(5_000, Number.NaN)).toBeNull()
  })
  it('salón de un salonero = su total sin su delivery (días del .xls sin el campo: todo salón)', () => {
    expect(netaSalonDeSalonero({ total: 10_000, delivery: 2_500 })).toBe(7_500)
    expect(netaSalonDeSalonero({ total: 10_000 })).toBe(10_000)
  })
})

// Fuera de `indicadores.ts` nadie divide «venta ÷ pax» por su cuenta en las pantallas migradas (fase 1.3).
describe('guardia: las pantallas migradas usan la fórmula única', () => {
  const MIGRADOS = [
    // 3.5.5: «Análisis» y «Calendario» se borraron (su lugar es «Tiempos»: `mesesTemporadas.ts`, `tiemposV2.ts`).
    'src/modules/ventas/MesesYTemporadas.tsx', 'src/modules/ventas/mesesTemporadas.ts', 'src/modules/ventas/VentasTiempos.tsx',
    'src/modules/ventas/ReporteMensual.tsx', 'src/modules/ventas/VentasContabilidad.tsx', 'src/modules/ventas/totalesVentas.ts',
    // 3.5.2: lo de «Hoy» (retirada) vive en «Resumen» → «Salón en detalle» y en «Regalías».
    'src/modules/ventas/salonDetalle.ts', 'src/modules/ventas/SalonEnDetalle.tsx', 'src/modules/ventas/VentasRegalias.tsx',
    'src/modules/ventas/resumenDetalle.ts', 'src/modules/ventas/VentasResumen.tsx',
    'src/modules/resumen/ReporteMensual.tsx', 'src/modules/resumen/ResumenSemanal.tsx', 'src/modules/resumen/ventasSemana.ts',
  ]
  it.each(MIGRADOS)('%s no divide por pax a mano', (archivo) => {
    const src = readFileSync(archivo, 'utf8')
    // `x / pax`, `a.salon / a.pax`, `b.sum / b.paxSum`, `totSal / totPax`, `vn/pax` (rótulos como «Prom/PAX» no cuentan).
    expect(src.match(/[\w.)\]]\s*\/\s*[\w.]*\b(?:pax|(?!promPax)[a-z]\w*(?:Pax|PAX)\w*)\b/g) ?? []).toEqual([])
  })
})
