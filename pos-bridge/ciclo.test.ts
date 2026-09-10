import { describe, it, expect } from 'vitest'

import {
  describirCiclo,
  ejecutarCiclo,
  ESTADO_INICIAL,
  payloadSaludo,
  toparCursor,
  type EstadoAgente,
  type PuertosCiclo,
} from './ciclo.ts'
import type { IngestNdfResult } from './pushIngest.ts'
import type { OpenIngest, PayloadIngest, TicketIngest } from '../src/shared/ndf/ingestNdf'
import { mapTicket } from '../src/shared/ndf/mapTicket'

const LOCAL = 'santa-teresa'
const AHORA = new Date('2026-09-01T20:00:00Z')   // 14:00 CR
const VENTANA_H = 36

const ticket = (numero: string): TicketIngest => ({
  ...mapTicket({
    numero_factura: numero, fecha_hora: '2026-09-01 13:42:07', estado: 'C', tipo: 'M',
    area: 'SALON 1', login_cajero: '111', usuario_registra: '026', salonero_nombre: 'MAXO',
    personas: 0, imp_servicio: 1200, medios: { efectivo: 12000 }, items: [],
  }),
  fecha_registra: '2026-09-01T13:42:07-06:00',
  mesa: '12', numero_pedido: '4477',
})

const abierta = (clave: string): OpenIngest => ({ clave, mesa: '14', pax: 4, canal: 'salon' })

/** Una factura en curso (`R`) o anulada (`X`): mismo ticket, otro estado, sin cobro. */
const provisional = (numero: string, estado: 'R' | 'X' = 'R'): TicketIngest =>
  ({ ...ticket(numero), estado })

const respuesta = (over: Partial<IngestNdfResult> = {}): IngestNdfResult => ({
  ok: true, local: LOCAL, tickets_recibidos: 0, tickets_guardados: 0, lineas_guardadas: 0,
  open_guardadas: 0, open_borradas: 0, invalid: 0, recalculados: 0, problemas: [],
  cursor: { local: LOCAL, last_factura: null, last_fecha_registra: null, last_poll_at: null, last_error: null },
  ...over,
})

/** Puertos falsos: el agente no toca ni el PoS ni la red en ningún test de este archivo. */
function puertos(opts: {
  tickets?: TicketIngest[]
  /** Las R/X que relee cada ciclo. Sin esto: ninguna, igual que antes de B. */
  provisionales?: TicketIngest[]
  abiertas?: OpenIngest[] | null
  fallaPos?: string
  fallaEnvio?: string
  cursorDevuelto?: string | null
  avisos?: string[]
} = {}) {
  const enviados: PayloadIngest[] = []
  const p: PuertosCiclo = {
    async leerCerradas() {
      if (opts.fallaPos) throw new Error(opts.fallaPos)
      return { tickets: opts.tickets ?? [], avisos: opts.avisos ?? [] }
    },
    async leerProvisionales() {
      if (opts.fallaPos) throw new Error(opts.fallaPos)
      return { tickets: opts.provisionales ?? [], avisos: [] }
    },
    async leerAbiertas() {
      if (opts.fallaPos) throw new Error(opts.fallaPos)
      return opts.abiertas === undefined ? [] : opts.abiertas
    },
    async enviar(payload) {
      enviados.push(payload)
      if (opts.fallaEnvio) throw new Error(opts.fallaEnvio)
      return respuesta({
        tickets_recibidos: payload.tickets.length,
        tickets_guardados: payload.tickets.length,
        cursor: {
          local: LOCAL, last_poll_at: null, last_fecha_registra: null, last_error: null,
          last_factura: opts.cursorDevuelto !== undefined
            ? opts.cursorDevuelto
            : payload.cursor?.last_factura ?? null,
        },
      })
    },
  }
  return { p, enviados }
}

const correr = (pu: PuertosCiclo, estado: EstadoAgente) =>
  ejecutarCiclo(pu, LOCAL, VENTANA_H, estado, AHORA)

// ── Saludo de arranque ─────────────────────────────────────────────────────────

describe('saludo de arranque', () => {
  it('el primer ciclo solo lee el cursor guardado: no manda tickets ni toca las abiertas', async () => {
    expect(payloadSaludo(LOCAL)).toEqual({ local: LOCAL, tickets: [] })

    const { p, enviados } = puertos({ cursorDevuelto: '5010' })
    const r = await correr(p, { ...ESTADO_INICIAL })

    expect(enviados).toEqual([{ local: LOCAL, tickets: [] }])
    expect(enviados[0].open).toBeUndefined()   // ausente = el Edge no toca el snapshot
    expect(enviados[0].cursor).toBeUndefined() // ausente = el Edge conserva last_factura
    expect(r.resumen.fase).toBe('saludo')
    expect(r.estado).toEqual({ ultimaFactura: '5010', saludado: true, ultimoError: null })
  })

  it('si el saludo no llega, se reintenta el próximo ciclo (no arranca a ciegas)', async () => {
    const { p } = puertos({ fallaEnvio: 'ECONNREFUSED' })
    const r = await correr(p, { ...ESTADO_INICIAL })
    expect(r.resumen.fase).toBe('error_envio')
    expect(r.estado.saludado).toBe(false)
  })

  it('base vacía (primera vez del local) → arranca sin cursor', async () => {
    const { p } = puertos({ cursorDevuelto: null })
    const r = await correr(p, { ...ESTADO_INICIAL })
    expect(r.estado).toMatchObject({ ultimaFactura: null, saludado: true })
  })
})

// ── Ciclo normal ───────────────────────────────────────────────────────────────

const YA_SALUDADO: EstadoAgente = { ultimaFactura: '5000', saludado: true, ultimoError: null }

describe('ciclo sincronizado', () => {
  it('manda las cerradas nuevas, el snapshot y el cursor que avanzó', async () => {
    const { p, enviados } = puertos({
      tickets: [ticket('5001'), ticket('5002')],
      abiertas: [abierta('pedido:4477')],
    })
    const r = await correr(p, YA_SALUDADO)

    expect(enviados).toHaveLength(1)
    expect(enviados[0].tickets).toHaveLength(2)
    expect(enviados[0].open).toHaveLength(1)
    expect(enviados[0].cursor).toEqual({
      last_error: null,                              // explícito: limpia el error anterior
      last_factura: '5002',
      last_fecha_registra: '2026-09-01T13:42:07-06:00',
    })
    expect(r.estado.ultimaFactura).toBe('5002')
    expect(r.resumen).toMatchObject({ fase: 'sincronizado', tickets: 2, abiertas: 1, guardados: 2 })
  })

  it('sin facturas nuevas manda el latido, sin tocar last_factura', async () => {
    const { p, enviados } = puertos({ tickets: [] })
    const r = await correr(p, YA_SALUDADO)

    expect(enviados[0].tickets).toEqual([])
    expect(enviados[0].cursor).toEqual({ last_error: null })   // sin last_factura: no cambió
    expect(r.estado.ultimaFactura).toBe('5000')
    expect(r.resumen.fase).toBe('sincronizado')
  })

  it('el cursor avanza al MAYOR por valor, no por texto', async () => {
    const { p, enviados } = puertos({ tickets: [ticket('9'), ticket('10')] })
    await correr(p, { ...YA_SALUDADO, ultimaFactura: null })
    expect(enviados[0].cursor?.last_factura).toBe('10')
  })

  it('manda un snapshot VACÍO cuando no hay mesas abiertas (el Edge cierra las que quedaban)', async () => {
    const { p, enviados } = puertos({ abiertas: [] })
    await correr(p, YA_SALUDADO)
    expect(enviados[0].open).toEqual([])
  })

  it('si la instalación no puede leer abiertas, `open` va AUSENTE (no vacío)', async () => {
    const { p, enviados } = puertos({ abiertas: null })
    const r = await correr(p, YA_SALUDADO)
    expect('open' in enviados[0]).toBe(false)
    expect(r.resumen.abiertas).toBeNull()
  })

  it('el cursor que vale es el que CONFIRMÓ el Edge, no el que propuso el agente', async () => {
    // El Edge descartó la 5002 por inválida y devolvió 5001: el agente no la da por buena.
    const { p } = puertos({ tickets: [ticket('5001'), ticket('5002')], cursorDevuelto: '5001' })
    const r = await correr(p, YA_SALUDADO)
    expect(r.estado.ultimaFactura).toBe('5001')
  })

  it('los avisos del PoS y los problemas del Edge llegan juntos al log', async () => {
    const { p } = puertos({ tickets: [ticket('5001')], avisos: ['1 factura sin pedido'] })
    const r = await correr(p, YA_SALUDADO)
    expect(r.resumen.avisos).toContain('1 factura sin pedido')
  })
})

// ── Resiliencia ────────────────────────────────────────────────────────────────

describe('resiliencia', () => {
  it('PoS apagado: no crashea, no inventa el día y deja el error en el cursor', async () => {
    const { p, enviados } = puertos({ fallaPos: 'ECONNREFUSED SQLNUBE' })
    const r = await correr(p, YA_SALUDADO)

    expect(r.resumen.fase).toBe('error_pos')
    expect(r.resumen.error).toContain('ECONNREFUSED')
    // Se manda un lote vacío SOLO para que el error quede en pos_ndf_cursor.last_error.
    expect(enviados).toEqual([{ local: LOCAL, tickets: [], cursor: { last_error: 'ECONNREFUSED SQLNUBE' } }])
    expect(enviados[0].open).toBeUndefined()       // no se tocan las mesas abiertas
    expect(r.estado.ultimaFactura).toBe('5000')    // el cursor NO avanza
  })

  it('PoS apagado Y sin red a Supabase: sigue sin crashear', async () => {
    const { p } = puertos({ fallaPos: 'ECONNREFUSED', fallaEnvio: 'network' })
    const r = await correr(p, YA_SALUDADO)
    expect(r.resumen.fase).toBe('error_pos')
    expect(r.estado.saludado).toBe(true)
  })

  it('Supabase caído: el cursor NO avanza, así el próximo ciclo relee y reenvía', async () => {
    const { p } = puertos({ tickets: [ticket('5001')], fallaEnvio: 'ingest-ndf respondió 503' })
    const r = await correr(p, YA_SALUDADO)

    expect(r.resumen.fase).toBe('error_envio')
    expect(r.resumen.tickets).toBe(1)
    expect(r.resumen.guardados).toBe(0)
    expect(r.estado.ultimaFactura).toBe('5000')
  })

  it('reenviar el mismo lote arma exactamente el mismo payload (idempotencia)', async () => {
    const a = puertos({ tickets: [ticket('5001')], fallaEnvio: 'timeout' })
    await correr(a.p, YA_SALUDADO)
    const b = puertos({ tickets: [ticket('5001')] })
    await correr(b.p, YA_SALUDADO)
    expect(JSON.stringify(a.enviados[0])).toBe(JSON.stringify(b.enviados[0]))
  })

  it('ejecutarCiclo NUNCA tira: un agente caído de madrugada no se entera nadie', async () => {
    const explota: PuertosCiclo = {
      leerCerradas: () => { throw new Error('boom') },
      leerProvisionales: () => { throw new Error('boom') },
      leerAbiertas: () => { throw new Error('boom') },
      enviar:       () => { throw new Error('boom') },
    }
    await expect(correr(explota, YA_SALUDADO)).resolves.toMatchObject({ resumen: { fase: 'error_pos' } })
  })
})

describe('describirCiclo', () => {
  it('una línea por ciclo, sin secretos ni datos de cliente', async () => {
    const { p } = puertos({ tickets: [ticket('5001')], abiertas: [abierta('pedido:1')] })
    const r = await correr(p, YA_SALUDADO)
    expect(describirCiclo(r.resumen)).toBe('cerradas=1 guardadas=1 abiertas=1 cursor=5001')
  })

  it('el error dice que el cursor no avanzó', async () => {
    const { p } = puertos({ fallaPos: 'ECONNREFUSED' })
    const r = await correr(p, YA_SALUDADO)
    expect(describirCiclo(r.resumen)).toContain('no avanza')
  })
})

// ── B · provisionales en el lote, cursor topado por la menor R ────────────────────────────

describe('toparCursor', () => {
  it('sin R no topa nada', () => {
    expect(toparCursor('5010', [])).toBe('5010')
    expect(toparCursor('5010', [provisional('5003', 'X')])).toBe('5010')
    expect(toparCursor(null, [provisional('5003')])).toBeNull()
  })

  it('con una R por debajo del propuesto, el cursor queda en anterior(R)', () => {
    expect(toparCursor('5010', [provisional('5005')])).toBe('5004')
  })

  it('la que manda es la MENOR R, y las X no cuentan', () => {
    expect(toparCursor('5010', [provisional('5008'), provisional('5005'), provisional('5001', 'X')])).toBe('5004')
  })

  it('una R por encima del propuesto no lo mueve', () => {
    expect(toparCursor('5010', [provisional('5020')])).toBe('5010')
  })

  it("compara por valor: '9' no es mayor que '10'", () => {
    expect(toparCursor('10', [provisional('9')])).toBe('8')
  })
})

describe('el ciclo con provisionales (B)', () => {
  const estado = YA_SALUDADO

  it('las R/X viajan en el MISMO lote que las C, las C al final para que ganen en el upsert', async () => {
    const { p, enviados } = puertos({
      tickets: [ticket('5001'), ticket('5002')],
      provisionales: [provisional('5003'), provisional('4990', 'X')],
    })
    const r = await correr(p, estado)
    expect(r.resumen.fase).toBe('sincronizado')
    expect(enviados[0].tickets.map((t) => `${t.numero_factura}:${t.estado}`))
      .toEqual(['5003:R', '4990:X', '5001:C', '5002:C'])
    expect(r.resumen.tickets).toBe(2)
    expect(r.resumen.provisionales).toBe(2)
  })

  it('el cursor NUNCA pasa por encima de una R: se topa en anterior(menor R)', async () => {
    // La caja de la tarde abrió 5003 antes de que la mañana cerrara 5004 y 5005.
    const { p, enviados } = puertos({
      tickets: [ticket('5004'), ticket('5005')],
      provisionales: [provisional('5003')],
    })
    const r = await correr(p, estado)
    expect(enviados[0].cursor?.last_factura).toBe('5002')
    expect(r.estado.ultimaFactura).toBe('5002')
  })

  it('si el cursor ya se había pasado de una R, se REBOBINA (el Edge pisa, el upsert absorbe)', async () => {
    const pasado = { ultimaFactura: '5010', saludado: true, ultimoError: null }
    const { p, enviados } = puertos({ tickets: [], provisionales: [provisional('5003')] })
    const r = await correr(p, pasado)
    expect(enviados[0].cursor?.last_factura).toBe('5002')
    expect(r.estado.ultimaFactura).toBe('5002')
  })

  it('solo R sin C nuevas y sin R por debajo: el cursor no se manda (nada avanzó)', async () => {
    const { p, enviados } = puertos({ tickets: [], provisionales: [provisional('5020')] })
    await correr(p, estado)
    expect(enviados[0].cursor).not.toHaveProperty('last_factura')
    expect(enviados[0].tickets.map((t) => t.numero_factura)).toEqual(['5020'])
  })

  it('una X sola no topa el cursor (es terminal)', async () => {
    const { p, enviados } = puertos({ tickets: [ticket('5004')], provisionales: [provisional('5001', 'X')] })
    await correr(p, estado)
    expect(enviados[0].cursor?.last_factura).toBe('5004')
  })

  it('last_fecha_registra acompaña al cursor SOLO cuando el cursor es una C de este lote', async () => {
    // Topado: el cursor (5002) no es ningún ticket leído → la fecha no viaja.
    const topado = puertos({ tickets: [ticket('5004')], provisionales: [provisional('5003')] })
    await correr(topado.p, estado)
    expect(topado.enviados[0].cursor?.last_factura).toBe('5002')
    expect(topado.enviados[0].cursor).not.toHaveProperty('last_fecha_registra')
    // Normal: el cursor ES la última C → la fecha viaja.
    const normal = puertos({ tickets: [ticket('5004')] })
    await correr(normal.p, estado)
    expect(normal.enviados[0].cursor?.last_factura).toBe('5004')
    expect(normal.enviados[0].cursor?.last_fecha_registra).toBe('2026-09-01T13:42:07-06:00')
  })

  it('la misma factura como R y como C en el mismo ciclo viaja UNA vez, y es la C', async () => {
    // Cerró entre la relectura de R y la lectura de cerradas. El Edge NO deduplica dentro de un
    // tramo y Postgres rechaza tocar la misma fila dos veces en un ON CONFLICT: sin esto se
    // caería el lote entero, cada ciclo, hasta que la R saliera de la ventana.
    const { p, enviados } = puertos({
      tickets: [ticket('5003')],
      provisionales: [provisional('5003'), provisional('5004')],
    })
    const r = await correr(p, estado)
    expect(enviados[0].tickets.map((t) => `${t.numero_factura}:${t.estado}`))
      .toEqual(['5004:R', '5003:C'])
    expect(r.resumen.tickets).toBe(1)
    expect(r.resumen.provisionales).toBe(1)
    // La R restante (5004) sigue topando el cursor por debajo de ella.
    expect(enviados[0].cursor?.last_factura).toBe('5003')
  })

  it('sin provisionales el ciclo es el de siempre: mismo payload que antes de B', async () => {
    const { p, enviados } = puertos({ tickets: [ticket('5001')] })
    const r = await correr(p, estado)
    expect(enviados[0].tickets.map((t) => t.numero_factura)).toEqual(['5001'])
    expect(enviados[0].cursor?.last_factura).toBe('5001')
    expect(r.resumen.provisionales).toBe(0)
  })
})
