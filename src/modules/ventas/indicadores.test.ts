import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

import { readFileSync } from 'node:fs'
import {
  alertaMesasSinPax, diaCRDeFactura, estimadorPorNeta, facturasDesdePos, franjaDeHora,
  personasCargadas, rangoAyer, rangoDeLecturaParaEstimar, turnoDeFactura, ventaPorPersona,
  type EstimadorPersonas, type FacturaIndicador,
} from './indicadores'
import { paxDelTicket } from './ventasEnVivoDatos'
import { totales, type FilaAgregada } from './ventasPromPaxExplicado'
import { todayCR } from '../../shared/utils'

// ╔══════════════════════════════════════════════════════════════════════════════════════╗
// ║ Ventas v2 · indicadores — venta por persona con pax estimado + alerta de mesas sin pax ║
// ╚══════════════════════════════════════════════════════════════════════════════════════╝
// Datos ficticios. Semana ISO de prueba: lun 16-nov-2026 → dom 22-nov-2026 (la anterior, 09–15).

let seq = 0
/** Una factura con su hora CR de pared («2026-11-18 20:00»), escrita con offset −06:00. */
function fac(
  cr: string, o: Partial<Omit<FacturaIndicador, 'fecha_registra'>> & { pax?: number | null; neta?: number } = {},
): FacturaIndicador {
  seq += 1
  return {
    id: o.id ?? `f${seq}`,
    fecha_registra: `${cr.replace(' ', 'T')}:00-06:00`,
    estado: o.estado ?? 'C',
    canal: o.canal === undefined ? 'salon' : o.canal,
    salonero_login: o.salonero_login === undefined ? '901' : o.salonero_login,
    pax: o.pax === undefined ? null : o.pax,
    pax_articulo: o.pax_articulo ?? null,
    neta: o.neta ?? 0,
  }
}

const SEMANA = { desde: '2026-11-16', hasta: '2026-11-22' }
const NULO: EstimadorPersonas = { id: 'nulo', estimar: () => null }

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

  it('borde de turno en hora CR: 16:59 es mañana, 17:00 es noche (también escrito en UTC)', () => {
    const m = { ...fac('x', { pax: 0, neta: 40_000 }), fecha_registra: '2026-11-18T22:59:00Z' }  // 16:59 CR
    const n = { ...fac('x', { pax: 0, neta: 40_000 }), fecha_registra: '2026-11-18T23:00:00Z' }  // 17:00 CR
    expect(turnoDeFactura(m)).toBe('mañana')
    expect(turnoDeFactura(n)).toBe('noche')
    const est = estimadorPorNeta(base())
    expect(est.estimar(m)).toBe(8)
    expect(est.estimar(n)).toBe(2)
    expect(ventaPorPersona([...base(), m], SEMANA, { turno: 'mañana' }).personasEstimadas).toBe(8)
    expect(ventaPorPersona([...base(), n], SEMANA, { turno: 'noche' }).personasEstimadas).toBe(2)
  })

  it('madrugada (00–05 h CR) = noche del mismo día calendario', () => {
    const f = fac('2026-11-18 00:30', { pax: 0, neta: 40_000 })
    expect(diaCRDeFactura(f.fecha_registra)).toBe('2026-11-18')
    expect(turnoDeFactura(f)).toBe('noche')
  })

  it('semana ISO: domingo 23:30 CR (lunes 05:30 UTC) usa la semana del domingo', () => {
    const fs = [
      fac('2026-11-20 20:00', { pax: 4, neta: 40_000 }),   // semana 16: 10.000
      fac('2026-11-24 20:00', { pax: 1, neta: 40_000 }),   // semana 23: 40.000
    ]
    const dom = { ...fac('x', { pax: 0, neta: 40_000 }), fecha_registra: '2026-11-23T05:30:00Z' }
    expect(diaCRDeFactura(dom.fecha_registra)).toBe('2026-11-22')
    expect(estimadorPorNeta(fs).estimar(dom)).toBe(4)
    const lun = fac('2026-11-23 20:00', { pax: 0, neta: 40_000 })
    expect(estimadorPorNeta(fs).estimar(lun)).toBe(1)
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
        fs.push(fac(`2026-11-${String(dia).padStart(2, '0')} ${String(hora).padStart(2, '0')}:15`, {
          canal: canales[Math.floor(azar() * canales.length)],
          pax: azar() < 0.4 ? 0 : Math.floor(azar() * 6),
          neta: Math.floor(azar() * 100_000),
        }))
      }
      const r = { desde: '2026-11-09', hasta: '2026-11-22' }
      const esperado = fs
        .filter(f => f.canal === 'salon' && diaCRDeFactura(f.fecha_registra) >= r.desde && diaCRDeFactura(f.fecha_registra) <= r.hasta)
        .reduce((a, f) => a + f.neta, 0)
      const v1 = ventaPorPersona(fs, r)
      const nulo = ventaPorPersona(fs, r, { estimador: NULO })
      const tres = ventaPorPersona(fs, r, { estimador: { id: 'tres', estimar: () => 3 } })
      expect(v1.netaSalon).toBe(esperado)
      expect(nulo.netaSalon).toBe(esperado)
      expect(tres.netaSalon).toBe(esperado)
      expect(v1.personasCargadas).toBe(nulo.personasCargadas)
      const m = ventaPorPersona(fs, r, { turno: 'mañana' })
      const n = ventaPorPersona(fs, r, { turno: 'noche' })
      expect(m.netaSalon + n.netaSalon).toBe(esperado)
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
      { ...fac('x', { pax: 0, salonero_login: '901' }), fecha_registra: '2026-11-16T05:30:00Z' },  // 15 23:30 CR
      { ...fac('x', { pax: 0, salonero_login: '901' }), fecha_registra: '2026-11-17T05:30:00Z' },  // 16 23:30 CR
    ]
    expect(alertaMesasSinPax(fs, ayer).total).toEqual({ facturasSalon: 1, sinPax: 1, pct: 100 })
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
    ]
    const a = alertaMesasSinPax(fs, dia)
    expect(a.porSalonero).toEqual([
      { salonero_login: '902', facturasSalon: 2, sinPax: 2, pct: 100 },
      { salonero_login: '901', facturasSalon: 3, sinPax: 1, pct: (1 / 3) * 100 },
      { salonero_login: '903', facturasSalon: 1, sinPax: 0, pct: 0 },
    ])
    expect(a.sinSalonero).toEqual({ facturasSalon: 2, sinPax: 1, pct: 50 })
    expect(a.total).toEqual({ facturasSalon: 8, sinPax: 4, pct: 50 })
  })

  it('sin facturas: todo en 0, sin dividir por cero', () => {
    const a = alertaMesasSinPax([], { desde: '2026-11-18', hasta: '2026-11-18' })
    expect(a).toEqual({ porSalonero: [], sinSalonero: { facturasSalon: 0, sinPax: 0, pct: 0 }, total: { facturasSalon: 0, sinPax: 0, pct: 0 } })
  })
})

// ── Desde las filas del PoS ────────────────────────────────────────────────────────────────

describe('facturasDesdePos', () => {
  it('arma la neta con `netaVenta.ts` (fuera familias 6, 17 y 20)', () => {
    const [f] = facturasDesdePos(
      [{ id: 't1', numero_factura: '1', estado: 'C', fecha_registra: '2026-11-18T02:00:00Z', canal: 'salon',
         salonero_login: '901', pax: 2, pax_articulo: null, valor_servido_crc: 0 }],
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
    expect(turnoDeFactura({ fecha_registra: '2026-11-17 16:59:00' })).toBe('mañana')
    expect(diaCRDeFactura('no-es-fecha')).toBe('')
  })
})
