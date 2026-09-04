import { describe, it, expect } from 'vitest'

import { correrBackfill, correrDia, payloadBackfill, rangoEfectivo, type PuertosBackfill } from './backfill.ts'
import { enumerarDias, parsearArgs } from './backfillPlan.ts'
import { aTicketIngest } from './consultaAgente.ts'
import type { IngestNdfResult } from './pushIngest.ts'
import type { PayloadIngest } from '../src/shared/ndf/ingestNdf'
import { mapTicket } from '../src/shared/ndf/mapTicket'

const LOCAL = 'santa-teresa'

const ticket = (numero: string) => aTicketIngest(mapTicket({
  numero_factura: numero, fecha_hora: '2026-08-20 19:42:07', estado: 'C', tipo: 'M',
  area: 'SALON 1', login_cajero: '222', usuario_registra: '026', salonero_nombre: 'MAXO',
  personas: 0, imp_servicio: 1200, medios: { efectivo: 15000, vuelto: 3000 },
  items: [{ codigo: '100', nombre: 'ROLL', cantidad: 2, monto: 12000, familia: 2, familia_nombre: 'SUSHI', impS: 1200 }],
}))

const respuesta = (payload: PayloadIngest): IngestNdfResult => ({
  ok: true, local: LOCAL,
  tickets_recibidos: payload.tickets.length,
  tickets_guardados: payload.tickets.length,
  lineas_guardadas:  payload.tickets.reduce((s, t) => s + t.items.length, 0),
  open_guardadas: 0, open_borradas: 0, invalid: 0, recalculados: 0, problemas: [],
  cursor: { local: LOCAL, last_factura: '9999', last_fecha_registra: null, last_poll_at: null, last_error: null },
})

function puertos(opts: { ventas?: Record<string, string[]>; falla?: Record<string, string>; avisos?: string[] } = {}) {
  const enviados: PayloadIngest[] = []
  const log: string[] = []
  const pausas: number[] = []
  const p: PuertosBackfill = {
    async leerDia(fecha) {
      const err = opts.falla?.[fecha]
      if (err) throw new Error(err)
      return {
        tickets: (opts.ventas?.[fecha] ?? []).map(ticket),
        avisos:  opts.avisos ?? [],
      }
    },
    async enviar(payload) { enviados.push(structuredClone(payload)); return respuesta(payload) },
    async pausar(ms) { pausas.push(ms) },
    log(l) { log.push(l) },
  }
  return { p, enviados, log, pausas }
}

// ── EL GUARDRAIL ───────────────────────────────────────────────────────────────

describe('payloadBackfill — el lote NO puede tocar al agente en vivo', () => {
  it('lleva SOLO local y tickets', () => {
    const p = payloadBackfill(LOCAL, [ticket('5001')])
    expect(Object.keys(p).sort()).toEqual(['local', 'tickets'])
  })

  it('NO lleva `open`: `open: []` le borraría a staging las mesas abiertas de hoy', () => {
    expect('open' in payloadBackfill(LOCAL, [])).toBe(false)
  })

  it('NO lleva `cursor`: ni last_factura ni last_error ni el latido', () => {
    // Ausente ≠ `{ last_error: null }`. Lo segundo le limpiaría al agente un error
    // recién escrito; ausente, el Edge lee la fila y no la escribe.
    expect('cursor' in payloadBackfill(LOCAL, [])).toBe(false)
  })

  it('todo lote que sale del barrido cumple lo mismo', async () => {
    const { p, enviados } = puertos({ ventas: { '2026-08-20': ['5001'], '2026-08-19': ['5002', '5003'] } })
    await correrBackfill(p, { local: LOCAL, dias: enumerarDias('2026-08-19', '2026-08-20'), dryRun: false, pausaMs: 0 })
    expect(enviados).toHaveLength(2)
    for (const e of enviados) {
      expect(Object.keys(e).sort()).toEqual(['local', 'tickets'])
      expect(e.local).toBe(LOCAL)
    }
  })
})

// ── Un día ─────────────────────────────────────────────────────────────────────

describe('correrDia', () => {
  it('un día con ventas manda el lote y devuelve lo que el Edge guardó', async () => {
    const { p, enviados, log } = puertos({ ventas: { '2026-08-20': ['5001', '5002'] } })
    const r = await correrDia(p, LOCAL, '2026-08-20', false)
    expect(r).toEqual({ fecha: '2026-08-20', tickets: 2, guardados: 2, lineas: 2, error: null })
    expect(enviados[0].tickets).toHaveLength(2)
    expect(log.join(' ')).toContain('tickets=2 guardados=2')
  })

  it('un día sin ventas no manda nada (cerrado, feriado)', async () => {
    const { p, enviados, log } = puertos()
    const r = await correrDia(p, LOCAL, '2026-08-20', false)
    expect(r).toMatchObject({ tickets: 0, error: null })
    expect(enviados).toEqual([])
    expect(log.join(' ')).toContain('sin ventas')
  })

  it('--dry-run lee y cuenta pero NO envía', async () => {
    const { p, enviados, log } = puertos({ ventas: { '2026-08-20': ['5001'] } })
    const r = await correrDia(p, LOCAL, '2026-08-20', true)
    expect(enviados).toEqual([])
    expect(r).toMatchObject({ tickets: 1, guardados: 0, lineas: 1 })
    expect(log.join(' ')).toContain('NO se envía')
  })

  it('un día que falla se anota y NO tira', async () => {
    const { p } = puertos({ falla: { '2026-08-20': 'ECONNREFUSED SQLNUBE' } })
    const r = await correrDia(p, LOCAL, '2026-08-20', false)
    expect(r.error).toContain('ECONNREFUSED')
    expect(r.tickets).toBe(0)
  })

  it('los avisos del tramo viejo salen al log y no frenan nada', async () => {
    const { p, log } = puertos({ ventas: { '2024-03-10': ['5001'] }, avisos: ['3 factura(s) sin pedido'] })
    const r = await correrDia(p, LOCAL, '2024-03-10', false)
    expect(r.error).toBeNull()
    expect(log.join(' ')).toContain('sin pedido')
  })
})

// ── El barrido ─────────────────────────────────────────────────────────────────

describe('correrBackfill', () => {
  const dias = enumerarDias('2026-07-30', '2026-08-02')   // reciente → viejo, cruza el mes

  it('barre del más reciente al más viejo', async () => {
    const { p, enviados } = puertos({
      ventas: { '2026-08-02': ['1'], '2026-08-01': ['2'], '2026-07-31': ['3'], '2026-07-30': ['4'] },
    })
    await correrBackfill(p, { local: LOCAL, dias, dryRun: false, pausaMs: 0 })
    expect(enviados.map((e) => e.tickets[0].numero_factura)).toEqual(['1', '2', '3', '4'])
  })

  it('agrupa el log por mes y resume cada tramo', async () => {
    const { p, log } = puertos({ ventas: { '2026-08-02': ['1'], '2026-07-31': ['3'] } })
    const { porMes } = await correrBackfill(p, { local: LOCAL, dias, dryRun: false, pausaMs: 0 })

    expect(porMes.map((t) => t.mes)).toEqual(['2026-08', '2026-07'])
    expect(porMes[0].conteo).toMatchObject({ dias: 2, diasVacios: 1, tickets: 1 })
    expect(log.filter((l) => l.includes('── 2026-08'))).toHaveLength(1)
    expect(log.filter((l) => l.includes('── 2026-07'))).toHaveLength(1)
  })

  it('el total junta todos los tramos', async () => {
    const { p } = puertos({ ventas: { '2026-08-02': ['1'], '2026-08-01': ['2'], '2026-07-30': ['4'] } })
    const { total } = await correrBackfill(p, { local: LOCAL, dias, dryRun: false, pausaMs: 0 })
    expect(total).toMatchObject({
      dias: 4, diasVacios: 1, tickets: 3, guardados: 3, lineas: 3, errores: 0,
      primerDia: '2026-07-30', ultimoDia: '2026-08-02',
    })
  })

  it('un día roto no frena los demás', async () => {
    const { p, enviados } = puertos({
      ventas: { '2026-08-02': ['1'], '2026-08-01': ['2'], '2026-07-30': ['4'] },
      falla:  { '2026-07-31': 'columna rara en un mes viejo' },
    })
    const { total } = await correrBackfill(p, { local: LOCAL, dias, dryRun: false, pausaMs: 0 })
    expect(total.errores).toBe(1)
    expect(total.tickets).toBe(3)
    expect(enviados).toHaveLength(3)
  })

  it('pausa entre días, pero no después del último', async () => {
    const { p, pausas } = puertos({ ventas: {} })
    await correrBackfill(p, { local: LOCAL, dias, dryRun: false, pausaMs: 500 })
    expect(pausas).toEqual([500, 500, 500])   // 4 días → 3 pausas
  })

  it('IDEMPOTENCIA: re-correr el mismo rango arma exactamente los mismos lotes', async () => {
    const ventas = { '2026-08-02': ['1', '2'], '2026-08-01': ['3'] }
    const a = puertos({ ventas }); const b = puertos({ ventas })
    await correrBackfill(a.p, { local: LOCAL, dias, dryRun: false, pausaMs: 0 })
    await correrBackfill(b.p, { local: LOCAL, dias, dryRun: false, pausaMs: 0 })
    expect(JSON.stringify(a.enviados)).toBe(JSON.stringify(b.enviados))
  })

  it('rango vacío: no hace nada y no explota', async () => {
    const { p, enviados } = puertos()
    const { total } = await correrBackfill(p, { local: LOCAL, dias: [], dryRun: false, pausaMs: 500 })
    expect(enviados).toEqual([])
    expect(total.dias).toBe(0)
  })
})

// ── Rango efectivo (--todo) ────────────────────────────────────────────────────

describe('rangoEfectivo', () => {
  it('con --desde/--hasta usa lo que se pidió', () => {
    const args = parsearArgs(['--desde', '2026-08-05', '--hasta', '2026-09-03'])
    expect(rangoEfectivo(args, null, '2026-09-05')).toEqual({ desde: '2026-08-05', hasta: '2026-09-03' })
  })

  it('--todo va desde la venta más vieja hasta AYER (hoy lo cubre el agente en vivo)', () => {
    const args = parsearArgs(['--todo'])
    expect(rangoEfectivo(args, '2024-03-10', '2026-09-05'))
      .toEqual({ desde: '2024-03-10', hasta: '2026-09-04' })
  })

  it('--todo sin ninguna factura cerrada avisa en vez de barrer al vacío', () => {
    expect(() => rangoEfectivo(parsearArgs(['--todo']), null, '2026-09-05'))
      .toThrow(/ninguna factura cerrada/)
  })
})
