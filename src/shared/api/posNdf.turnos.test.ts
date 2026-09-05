import { describe, it, expect, vi, beforeEach } from 'vitest'

// El cliente real exige variables de entorno y una red que acá no hay. Se reemplaza por un
// doble que además GRABA los filtros: así se puede verificar que el borde 7-7 llega a la
// consulta, y no solo que la suma de JS está bien.
const filtros: Record<string, unknown> = {}
let filas: unknown[] = []
let errorDeLaConsulta: { message: string } | null = null

vi.mock('./supabase', () => {
  const builder = {
    select: (cols: string) => { filtros.select = cols; return builder },
    eq:  (col: string, v: unknown) => { filtros[`eq:${col}`]  = v; return builder },
    gte: (col: string, v: unknown) => { filtros[`gte:${col}`] = v; return builder },
    lt:  (col: string, v: unknown) => { filtros[`lt:${col}`]  = v; return builder },
    then: (resolve: (r: unknown) => unknown) =>
      resolve({ data: errorDeLaConsulta ? null : filas, error: errorDeLaConsulta }),
  }
  return { supabase: { from: (t: string) => { filtros.from = t; return builder } } }
})

import {
  businessDateDe, CAJERO_MEDIODIA, CAJERO_NOCHE, getVentasPorTurno, sumarVentasPorTurno,
  ventanaJornada, type FilaTurnoRow,
} from './posNdf'

const fila = (over: Partial<FilaTurnoRow> = {}): FilaTurnoRow => ({
  cajero_login: CAJERO_MEDIODIA, total_crc: 10000, dolares_efectivo: 0, dolares_tarjeta: 0,
  ...over,
})

beforeEach(() => {
  for (const k of Object.keys(filtros)) delete filtros[k]
  filas = []
  errorDeLaConsulta = null
})

// ── La suma ────────────────────────────────────────────────────────────────────

describe('sumarVentasPorTurno', () => {
  it('reparte 111 al mediodía y 222 a la noche', () => {
    expect(sumarVentasPorTurno([
      fila({ cajero_login: CAJERO_MEDIODIA, total_crc: 120_000 }),
      fila({ cajero_login: CAJERO_MEDIODIA, total_crc: 45_500 }),
      fila({ cajero_login: CAJERO_NOCHE,    total_crc: 300_000 }),
    ])).toEqual({
      mediodia: { crc: 165_500, usd: 0 },
      noche:    { crc: 300_000, usd: 0 },
    })
  })

  it('los dólares son efectivo + tarjeta, y NO se mezclan con los colones', () => {
    const r = sumarVentasPorTurno([
      fila({ total_crc: 50_000, dolares_efectivo: 20, dolares_tarjeta: 15 }),
      fila({ total_crc: 10_000, dolares_efectivo: 5.5, dolares_tarjeta: 0 }),
    ])
    expect(r.mediodia).toEqual({ crc: 60_000, usd: 40.5 })
  })

  it('los colones se redondean; los dólares NO (el cajero cuenta centavos)', () => {
    const r = sumarVentasPorTurno([fila({ total_crc: 1234.6, dolares_efectivo: 10.25 })])
    expect(r.mediodia.crc).toBe(1235)
    expect(r.mediodia.usd).toBe(10.25)
  })

  it('los NULL no rompen la suma', () => {
    expect(sumarVentasPorTurno([
      fila({ total_crc: null, dolares_efectivo: null, dolares_tarjeta: null }),
      fila({ total_crc: 7000 }),
    ]).mediodia).toEqual({ crc: 7000, usd: 0 })
  })

  it('sin filas, los dos turnos en cero — no `null` ni NaN', () => {
    expect(sumarVentasPorTurno([])).toEqual({
      mediodia: { crc: 0, usd: 0 },
      noche:    { crc: 0, usd: 0 },
    })
  })
})

// ── Lo que NO entra al pre-llenado ─────────────────────────────────────────────

describe('solo los cajeros de turno pre-llenan el cierre', () => {
  it('sistema, otro cajero y sin cajero quedan afuera', () => {
    const r = sumarVentasPorTurno([
      fila({ cajero_login: '002',  total_crc: 90_000 }),   // sistema
      fila({ cajero_login: '026',  total_crc: 80_000 }),   // un salonero
      fila({ cajero_login: '022',  total_crc: 70_000 }),   // cajero sin confirmar
      fila({ cajero_login: null,   total_crc: 60_000 }),   // sin cajero (histórico sin pedido)
      fila({ cajero_login: '',     total_crc: 50_000 }),
      fila({ cajero_login: CAJERO_MEDIODIA, total_crc: 11_000 }),
    ])
    // Solo la última entra. El resto NO desaparece del día: el campo sigue editable y el
    // cajero la suma a mano si corresponde — pero el PRE-LLENADO no se la mete de prepo.
    expect(r).toEqual({
      mediodia: { crc: 11_000, usd: 0 },
      noche:    { crc: 0, usd: 0 },
    })
  })

  it('un login parecido no cuenta: la comparación es exacta', () => {
    expect(sumarVentasPorTurno([
      fila({ cajero_login: '1110', total_crc: 5000 }),
      fila({ cajero_login: ' 111', total_crc: 5000 }),
    ])).toEqual({ mediodia: { crc: 0, usd: 0 }, noche: { crc: 0, usd: 0 } })
  })
})

// ── El borde 7-7 ───────────────────────────────────────────────────────────────

describe('la jornada es 07:00 → 07:00 CR, no el día civil', () => {
  it('la ventana arranca y termina a las 07:00 con offset fijo −06:00', () => {
    expect(ventanaJornada('2026-09-01')).toEqual({
      desde: '2026-09-01T07:00:00-06:00',
      hasta: '2026-09-02T07:00:00-06:00',
    })
  })

  it('cruza fin de mes y de año', () => {
    expect(ventanaJornada('2026-08-31').hasta).toBe('2026-09-01T07:00:00-06:00')
    expect(ventanaJornada('2026-12-31').hasta).toBe('2027-01-01T07:00:00-06:00')
  })

  it('una factura de la 1 de la mañana es del servicio de ANOCHE', () => {
    expect(businessDateDe('2026-09-02T01:30:00-06:00')).toBe('2026-09-01')
    expect(businessDateDe('2026-09-02T06:59:59-06:00')).toBe('2026-09-01')
  })

  it('a las 07:00 en punto ya empieza la jornada nueva', () => {
    expect(businessDateDe('2026-09-02T07:00:00-06:00')).toBe('2026-09-02')
  })

  it('el borde se calcula en hora CR, no en la del navegador', () => {
    // 2026-09-02T12:00Z = 06:00 CR → todavía es la jornada del 1.
    expect(businessDateDe('2026-09-02T12:00:00Z')).toBe('2026-09-01')
    // 2026-09-02T13:00Z = 07:00 CR → ya es la del 2.
    expect(businessDateDe('2026-09-02T13:00:00Z')).toBe('2026-09-02')
  })
})

// ── La consulta ────────────────────────────────────────────────────────────────

describe('getVentasPorTurno', () => {
  it('pide la ventana de la jornada, el local y solo facturas cerradas', async () => {
    await getVentasPorTurno('2026-09-01')
    expect(filtros.from).toBe('pos_ndf_tickets')
    expect(filtros['gte:fecha_registra']).toBe('2026-09-01T07:00:00-06:00')
    expect(filtros['lt:fecha_registra']).toBe('2026-09-02T07:00:00-06:00')
    expect(filtros['eq:estado']).toBe('C')
    expect(filtros['eq:local']).toBe('santa-teresa')
  })

  it('no suma la venta de otro local en el cierre de este', async () => {
    await getVentasPorTurno('2026-09-01', 'nosara')
    expect(filtros['eq:local']).toBe('nosara')
  })

  it('pide exactamente las cuatro columnas que necesita', async () => {
    await getVentasPorTurno('2026-09-01')
    expect(filtros.select).toBe('cajero_login, total_crc, dolares_efectivo, dolares_tarjeta')
  })

  it('devuelve la suma por turno de lo que trajo la consulta', async () => {
    filas = [
      fila({ cajero_login: CAJERO_MEDIODIA, total_crc: 200_000, dolares_efectivo: 30 }),
      fila({ cajero_login: CAJERO_NOCHE,    total_crc: 500_000, dolares_tarjeta: 12.5 }),
      fila({ cajero_login: '002',           total_crc: 999_999 }),
    ]
    expect(await getVentasPorTurno('2026-09-01')).toEqual({
      mediodia: { crc: 200_000, usd: 30 },
      noche:    { crc: 500_000, usd: 12.5 },
    })
  })

  it('un error de la consulta se propaga — no devuelve ceros que parezcan un día sin venta', async () => {
    errorDeLaConsulta = { message: 'permission denied for table pos_ndf_tickets' }
    await expect(getVentasPorTurno('2026-09-01')).rejects.toThrow('permission denied')
  })
})
