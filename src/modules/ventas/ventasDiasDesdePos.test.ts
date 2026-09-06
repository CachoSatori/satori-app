import { describe, it, expect, vi } from 'vitest'

vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

import { armarDiasMap, type RangoJornadas } from './ventasDiasDesdePos'
import { armarDia } from './ventasEnVivoDatos'
import { ventanaRangoJornadas } from '../../shared/api/posNdf'
import type { LineaNdfRow, TicketNdfConId } from '../../shared/api/posNdf'
import type { DiaData } from '../../shared/types/ventas'

const NOMBRES = { '026': 'MAXO', '027': 'GUILLE' }
const SELLO = '2026-09-05'

const ticket = (over: Partial<TicketNdfConId> & { id: string }): TicketNdfConId => ({
  numero_factura: over.id, fecha_registra: '2026-09-05T19:00:00-06:00',
  fecha_cierra: null, cajero_login: '222',
  canal: 'salon', salonero_login: '026', registrado_por: 'salonero', turno: 'noche',
  con_servicio: true, servicio_crc: 1200, total_crc: 13560, valor_servido_crc: 12000,
  iva_crc: 0, regalia_crc: 0, descuento_crc: 0, clase_ingreso: 'cobrada',
  pax: 2, pax_nativo: 2, pax_articulo: 2, pax_alerta: 'ok', ...over,
})

const linea = (ticketId: string, over: Partial<LineaNdfRow> = {}): LineaNdfRow => ({
  ticket_id: ticketId, codigo_producto: '100', nombre: 'ROLL SATORI',
  cantidad: 2, monto: 12000, familia: 2, ...over,
})

// ── Los lotes REALES de staging ────────────────────────────────────────────────────────────
// Mismos números y horas de cierre que fija `shared/ndf/jornada.test.ts`.

/** `desde..hasta` de números de factura, todos del mismo lote. */
const lote = (
  desde: number, hasta: number,
  o: { cajero: string; cierre: string | null; primero: string; pasoMin?: number },
): TicketNdfConId[] => {
  const t0 = Date.parse(o.primero)
  const paso = o.pasoMin ?? 10
  const out: TicketNdfConId[] = []
  for (let nro = desde; nro <= hasta; nro++) {
    out.push(ticket({
      id:             String(nro),
      fecha_registra: new Date(t0 + (nro - desde) * paso * 60_000).toISOString(),
      fecha_cierra:   o.cierre,
      cajero_login:   o.cajero,
    }))
  }
  return out
}

/** 110826–110838 · 13 facturas · 222 · cierra 22:07:59 CR del 4-sep → jornada 2026-09-04. */
const LOTE_4_TARDE = lote(110826, 110838, {
  cajero: '222', cierre: '2026-09-04T22:07:59-06:00', primero: '2026-09-04T18:05:00-06:00',
})
/** 110840 · 1 factura · 111 · cierra 16:07:03 CR del 5-sep → jornada 2026-09-05. */
const LOTE_5_MANANA = lote(110840, 110840, {
  cajero: '111', cierre: '2026-09-05T16:07:03-06:00', primero: '2026-09-05T12:20:00-06:00',
})
/** 110843–110866 · 24 facturas · 222 · cierra 22:30:06 CR del 5-sep → jornada 2026-09-05. */
const LOTE_5_TARDE = lote(110843, 110866, {
  cajero: '222', cierre: '2026-09-05T22:30:06-06:00', primero: '2026-09-05T17:15:00-06:00',
})

const TODOS  = [...LOTE_4_TARDE, ...LOTE_5_MANANA, ...LOTE_5_TARDE]
const LINEAS = TODOS.map(t => linea(t.id))
const RANGO: RangoJornadas = { desde: '2026-09-04', hasta: '2026-09-05' }

const armar = (
  tickets: TicketNdfConId[], lineas: LineaNdfRow[], rango: RangoJornadas,
) => armarDiasMap(tickets, lineas, rango, { uploadedAt: SELLO, nombres: NOMBRES })

// ── Un DiaData por jornada ─────────────────────────────────────────────────────────────────

describe('armarDiasMap — un DiaData por jornada', () => {
  it('el rango multi-día parte los lotes reales en sus dos jornadas', () => {
    const dias = armar(TODOS, LINEAS, RANGO)
    expect(Object.keys(dias)).toEqual(['2026-09-04', '2026-09-05'])
  })

  it('110826–110838 caen enteras en la jornada 2026-09-04', () => {
    const dias = armar(TODOS, LINEAS, RANGO)
    const d4 = dias['2026-09-04']
    // 13 facturas del fixture, todas del mismo salonero: 2 pax y ₡12.000 netos cada una.
    const pax   = Object.values(d4.saloneros).reduce((s, x) => s + ('pax' in x ? x.pax : 0), 0)
    const total = Object.values(d4.saloneros).reduce((s, x) => s + x.total, 0)
    expect(pax).toBe(13 * 2)
    expect(total).toBe(13 * 12000)
    expect(d4.fileName).toBe('ndf 2026-09-04')
  })

  it('110840 + 110843–110866 caen juntas en la jornada 2026-09-05', () => {
    const dias = armar(TODOS, LINEAS, RANGO)
    const pax = Object.values(dias['2026-09-05'].saloneros)
      .reduce((s, x) => s + ('pax' in x ? x.pax : 0), 0)
    expect(pax).toBe(25 * 2)                  // 1 del 111 + 24 del 222
    expect(dias['2026-09-05'].fileName).toBe('ndf 2026-09-05')
  })

  it('ninguna de las 38 facturas se pierde ni se duplica entre las dos jornadas', () => {
    const dias = armar(TODOS, LINEAS, RANGO)
    const pax = Object.values(dias).flatMap(d => Object.values(d.saloneros))
      .reduce((s, x) => s + ('pax' in x ? x.pax : 0), 0)
    expect(pax).toBe(38 * 2)
  })

  it('sin tickets, un DiasMap vacío (no se inventa un día en cero)', () => {
    expect(armar([], [], RANGO)).toEqual({})
  })
})

// ── Paridad de forma con «En vivo» ─────────────────────────────────────────────────────────

describe('paridad de FORMA con armarDia / «En vivo»', () => {
  it('el DiaData del adaptador es EXACTAMENTE el de armarDia para los mismos tickets', () => {
    const dias = armar(TODOS, LINEAS, RANGO)
    // Lo que «En vivo» hubiera armado para esa jornada, con los mismos tickets y líneas.
    const delDia = [...LOTE_5_MANANA, ...LOTE_5_TARDE]
    const esperado = armarDia(
      '2026-09-05', delDia, delDia.map(t => linea(t.id)), SELLO, NOMBRES,
    ).dia
    expect(dias['2026-09-05']).toEqual(esperado)
  })

  it('tiene las claves de DiaData y nada más', () => {
    const dias = armar(TODOS, LINEAS, RANGO)
    for (const d of Object.values(dias)) {
      expect(Object.keys(d).sort()).toEqual(['fileName', 'saloneros', 'uploadedAt'])
      expect(typeof d.fileName).toBe('string')
      expect(typeof d.uploadedAt).toBe('string')
      expect(typeof d.saloneros).toBe('object')
    }
  })

  it('las entradas de saloneros tienen la forma que consumen Hoy/Mix/Saloneros', () => {
    const dias = armar(TODOS, LINEAS, RANGO)
    const entradas = Object.values(dias['2026-09-05'].saloneros)
    expect(entradas.length).toBeGreaterThan(0)
    for (const e of entradas) {
      if ('esCajero' in e && e.esCajero) {
        expect(Object.keys(e).sort()).toEqual(
          ['delivery', 'esCajero', 'iva', 'ordenes', 'prods', 'salon', 'serv', 'ticketProm', 'total'])
      } else {
        expect(Object.keys(e).sort()).toEqual(
          ['bebPax', 'beb', 'com', 'iBeb', 'iCom', 'iva', 'pax', 'promBebida', 'promPax',
           'promPlato', 'prods', 'ratioCB', 'ratioU', 'serv', 'total'].sort())
      }
      expect(Array.isArray(e.prods)).toBe(true)
    }
  })

  it('un DiasMap del adaptador es asignable a DiasMap sin castear', () => {
    const dias = armar(TODOS, LINEAS, RANGO)
    const uno: DiaData = dias['2026-09-04']
    expect(uno.saloneros).toBeDefined()
  })
})

// ── El borde del superset ──────────────────────────────────────────────────────────────────

describe('el borde del rango — el lote que cruza la medianoche', () => {
  // 222 que abre el 5-sep 18:30 y cierra el 6-sep 01:00. Su jornada es el 5.
  const CRUZA = lote(200001, 200003, {
    cajero: '222', cierre: '2026-09-06T01:00:00-06:00', primero: '2026-09-05T18:30:00-06:00',
    pasoMin: 200,   // 18:30 · 21:50 · 01:10 del día siguiente
  })

  it('cae ENTERO en la jornada que abrió, con la factura de después de medianoche adentro', () => {
    const dias = armar(CRUZA, CRUZA.map(t => linea(t.id)), { desde: '2026-09-05', hasta: '2026-09-05' })
    expect(Object.keys(dias)).toEqual(['2026-09-05'])
    const pax = Object.values(dias['2026-09-05'].saloneros)
      .reduce((s, x) => s + ('pax' in x ? x.pax : 0), 0)
    expect(pax).toBe(3 * 2)     // las tres, incluida la de la 01:10
  })

  it('NO se cuela en la jornada del 6 aunque tenga facturas con fecha del 6', () => {
    const dias = armar(CRUZA, CRUZA.map(t => linea(t.id)), { desde: '2026-09-06', hasta: '2026-09-06' })
    expect(dias).toEqual({})
  })

  it('el lote que abrió ANTES del rango se descarta entero, no a medias', () => {
    // Es el motivo del margen de −1 día en `ventanaRangoJornadas`: si el fetch arrancara en
    // `desde`, este lote se vería truncado (solo la factura de la madrugada) y se colaría en el
    // 5 con la jornada mal calculada. Con el lote completo a la vista, su jornada da 4 y sale.
    const dias = armar([...CRUZA, ...LOTE_4_TARDE], [], { desde: '2026-09-05', hasta: '2026-09-05' })
    expect(Object.keys(dias)).toEqual(['2026-09-05'])
    const pax = Object.values(dias['2026-09-05'].saloneros)
      .reduce((s, x) => s + ('pax' in x ? x.pax : 0), 0)
    expect(pax).toBe(3 * 2)     // solo el lote que abrió el 5; las 13 del 4 quedaron afuera
  })

  it('la ventana de fetch es un superset por los DOS lados', () => {
    // +1 día al final por el turno que cierra pasada la medianoche; −1 al principio para no
    // ver truncado un lote que abrió el día anterior.
    expect(ventanaRangoJornadas('2026-09-05', '2026-09-05')).toEqual({
      desde: '2026-09-04T00:00:00-06:00',
      hasta: '2026-09-07T00:00:00-06:00',
    })
    expect(ventanaRangoJornadas('2026-09-01', '2026-09-30')).toEqual({
      desde: '2026-08-31T00:00:00-06:00',
      hasta: '2026-10-02T00:00:00-06:00',
    })
  })

  it('la ventana se escribe en hora de CR, nunca en UTC', () => {
    const v = ventanaRangoJornadas('2026-09-04', '2026-09-04')
    expect(v.desde.endsWith('-06:00')).toBe(true)
    expect(v.hasta.endsWith('-06:00')).toBe(true)
    expect(v.desde).not.toMatch(/Z$/)
  })
})

// ── Recortes del rango ─────────────────────────────────────────────────────────────────────

describe('el rango recorta por JORNADA, no por fecha de factura', () => {
  it('pedir solo el 4 deja afuera los dos lotes del 5', () => {
    const dias = armar(TODOS, LINEAS, { desde: '2026-09-04', hasta: '2026-09-04' })
    expect(Object.keys(dias)).toEqual(['2026-09-04'])
  })

  it('pedir solo el 5 deja afuera el lote del 4', () => {
    const dias = armar(TODOS, LINEAS, { desde: '2026-09-05', hasta: '2026-09-05' })
    expect(Object.keys(dias)).toEqual(['2026-09-05'])
  })

  it('un rango sin jornadas devuelve vacío', () => {
    expect(armar(TODOS, LINEAS, { desde: '2026-10-01', hasta: '2026-10-31' })).toEqual({})
  })
})
