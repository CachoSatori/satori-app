import { describe, it, expect } from 'vitest'

import {
  CR_OFFSET,
  MAX_TICKETS,
  conOffsetCR,
  instanteConZona,
  fusionarCursor,
  normalizarCursor,
  normalizarLinea,
  normalizarLote,
  normalizarOpen,
  normalizarTicket,
  validarPayload,
  type TicketIngest,
} from './ingestNdf'
import { mapTicket, type TicketCrudo } from './mapTicket'

const AHORA = '2026-09-02T04:00:00.000Z'

// El ticket del payload se arma con el MISMO `mapTicket` que usa el extractor de la
// Fase 1a: si los dos módulos se separaran, estos tests dejarían de compilar.
const crudo = (over: Partial<TicketCrudo> = {}): TicketCrudo => ({
  numero_factura:   '9007199254740993',
  fecha_hora:       '2026-09-01 19:42:07',
  estado:           'C',
  tipo:             'M',
  area:             'SALON 1',
  login_cajero:     '222',
  usuario_registra: '026',
  salonero_nombre:  'MAXO',
  personas:         0,
  imp_servicio:     1200,
  medios:           { efectivo: 15000, vuelto: 3000, dolaresEfectivo: 20 },
  items: [
    { codigo: '100', nombre: 'ROLL SATORI', cantidad: 2, monto: 12000, familia: 2, familia_nombre: 'SUSHI', impS: 1200 },
    { codigo: '677', nombre: 'A PAX', cantidad: 2, monto: 0, familia: 19, familia_nombre: 'A PAX', impS: 0 },
  ],
  ...over,
})

const ticket = (over: Partial<TicketIngest> = {}, base: Partial<TicketCrudo> = {}): TicketIngest => ({
  ...mapTicket(crudo(base)),
  fecha_registra: conOffsetCR('2026-09-01 19:42:07'),
  ...over,
})

// ── Zona horaria ───────────────────────────────────────────────────────────────

describe('conOffsetCR / instanteConZona', () => {
  it('le pone a la hora de pared del PoS el offset de Costa Rica, sin moverla', () => {
    expect(conOffsetCR('2026-09-01 19:42:07')).toBe(`2026-09-01T19:42:07${CR_OFFSET}`)
    expect(instanteConZona(conOffsetCR('2026-09-01 19:42:07'))).toBe('2026-09-02T01:42:07.000Z')
  })

  it('RECHAZA un instante sin zona (el desfase de 1 hora de BioTime)', () => {
    expect(instanteConZona('2026-09-01 19:42:07')).toBeNull()
    expect(instanteConZona('2026-09-01T19:42:07')).toBeNull()
    expect(instanteConZona(null)).toBeNull()
    expect(instanteConZona(1756000000)).toBeNull()
  })

  it('acepta Z y ±HH:MM', () => {
    expect(instanteConZona('2026-09-02T01:42:07Z')).toBe('2026-09-02T01:42:07.000Z')
    expect(instanteConZona('2026-09-01T19:42:07-06:00')).toBe('2026-09-02T01:42:07.000Z')
  })
})

// ── El sobre ───────────────────────────────────────────────────────────────────

describe('validarPayload', () => {
  it('acepta un sobre bien formado', () => {
    const r = validarPayload({ local: 'santa-teresa', tickets: [], open: [], cursor: {} })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.valor.local).toBe('santa-teresa')
      expect(r.valor.open).toEqual([])
    }
  })

  it('rechaza local desconocido, body raro y tickets que no son array', () => {
    expect(validarPayload({ local: 'jaco', tickets: [] })).toMatchObject({ ok: false })
    expect(validarPayload(null)).toMatchObject({ ok: false })
    expect(validarPayload({ local: 'nosara' })).toMatchObject({ ok: false })
    expect(validarPayload({ local: 'nosara', tickets: {} })).toMatchObject({ ok: false })
  })

  it('frena un lote absurdo', () => {
    const r = validarPayload({ local: 'nosara', tickets: new Array(MAX_TICKETS + 1).fill({}) })
    expect(r).toMatchObject({ ok: false })
  })

  it('distingue "sin snapshot" (undefined) de "no hay nada abierto" ([])', () => {
    const sin = validarPayload({ local: 'nosara', tickets: [] })
    const vacio = validarPayload({ local: 'nosara', tickets: [], open: [] })
    expect(sin.ok && sin.valor.open).toBeUndefined()
    expect(vacio.ok && vacio.valor.open).toEqual([])
  })
})

// ── Ticket ─────────────────────────────────────────────────────────────────────

describe('normalizarTicket', () => {
  it('arma la fila de pos_ndf_tickets desde el TicketMapeado de la Fase 1a', () => {
    const r = normalizarTicket('santa-teresa', ticket())
    expect(r.ok).toBe(true)
    if (!r.ok) return

    expect(r.valor.fila).toMatchObject({
      local:          'santa-teresa',
      numero_factura: '9007199254740993',   // string: el decimal del PoS no pasa por Number
      fecha_registra: '2026-09-02T01:42:07.000Z',
      estado:         'C',
      canal:          'salon',
      area:           'SALON 1',
      salonero_login: '026',
      registrado_por: 'salonero',
      turno:          'noche',
      cajero_login:   '222',
      con_servicio:   true,
      servicio_crc:   1200,
      pax_nativo:     0,
      pax_articulo:   2,
      pax:            2,
      pax_alerta:     'falta_nativo',
      total_fuente:   'provisorio',
    })
  })

  it('el total se recalcula con la misma regla del extractor: el vuelto SE RESTA', () => {
    const r = normalizarTicket('santa-teresa', ticket())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valor.fila.efectivo_crc).toBe(15000)
    expect(r.valor.fila.vuelto_crc).toBe(3000)
    expect(r.valor.fila.total_crc).toBe(12000)
    expect(r.valor.fila.dolares_efectivo).toBe(20)   // informativo: NO entra al total
    expect(r.valor.totalRecalculado).toBe(false)
  })

  it('si el agente manda un total que no coincide, gana el recalculado y queda marcado', () => {
    const r = normalizarTicket('santa-teresa', ticket({ total: 15000 }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valor.fila.total_crc).toBe(12000)
    expect(r.valor.totalRecalculado).toBe(true)
  })

  it('rechaza el ticket sin numero_factura y el que llega con fecha sin zona', () => {
    expect(normalizarTicket('santa-teresa', ticket({ numero_factura: '' })))
      .toMatchObject({ ok: false })
    expect(normalizarTicket('santa-teresa', ticket({ fecha_registra: '2026-09-01 19:42:07' })))
      .toMatchObject({ ok: false, error: expect.stringContaining('sin zona horaria') })
    expect(normalizarTicket('santa-teresa', 'no soy un objeto')).toMatchObject({ ok: false })
  })

  it('rechaza lo que violaría un CHECK de la migración (tumbaría el INSERT del lote entero)', () => {
    for (const roto of [
      { estado: 'Z' }, { canal: 'aire' }, { registrado_por: 'duende' }, { pax_alerta: 'cualquiera' },
    ] as unknown as Partial<TicketIngest>[]) {
      expect(normalizarTicket('santa-teresa', ticket(roto))).toMatchObject({ ok: false })
    }
  })

  it('un turno raro NO tumba el ticket: se guarda null (es informativo)', () => {
    const r = normalizarTicket('santa-teresa', ticket({ turno: 'madrugada' } as unknown as Partial<TicketIngest>))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.valor.fila.turno).toBeNull()
  })

  it('acepta "tarde" (reservado para el login 022, sin confirmar)', () => {
    const r = normalizarTicket('santa-teresa', ticket({ turno: 'tarde' } as unknown as Partial<TicketIngest>))
    expect(r.ok && r.valor.fila.turno).toBe('tarde')
  })

  it('la factura del cajero de turno entra con salonero_login null y su total intacto', () => {
    const r = normalizarTicket('santa-teresa', ticket({}, {
      usuario_registra: '222', salonero_nombre: null, login_cajero: '222', tipo: 'D', imp_servicio: 0,
      medios: { efectivo: 8000 }, items: [],
    }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valor.fila.salonero_login).toBeNull()
    expect(r.valor.fila.registrado_por).toBe('cajero')
    expect(r.valor.fila.canal).toBe('delivery')
    expect(r.valor.fila.con_servicio).toBe(false)
    expect(r.valor.fila.total_crc).toBe(8000)
  })

  it('las líneas salen del detalle, con sus banderas de familia', () => {
    const r = normalizarTicket('santa-teresa', ticket())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valor.lineas).toHaveLength(2)
    expect(r.valor.lineas[0]).toMatchObject({
      codigo_producto: '100', nombre: 'ROLL SATORI', cantidad: 2, monto: 12000,
      familia: 2, es_pax: false, es_extra: false, es_cortesia: false,
    })
    expect(r.valor.lineas[1]).toMatchObject({ codigo_producto: '677', familia: 19, es_pax: true })
  })

  it('guarda los campos que solo necesita la base (mesa, pedido, descuento, cierre)', () => {
    const r = normalizarTicket('santa-teresa', ticket({
      tipo: 'M', mesa: '12', numero_pedido: '4477', descuento: 500,
      fecha_cierra: conOffsetCR('2026-09-02 01:15:00'),
    }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valor.fila).toMatchObject({
      tipo: 'M', mesa: '12', numero_pedido: '4477', descuento_crc: 500,
      fecha_cierra: '2026-09-02T07:15:00.000Z',
    })
  })

  it('fecha_cierra ausente es válida; con formato naive, no', () => {
    expect(normalizarTicket('santa-teresa', ticket({ fecha_cierra: null })))
      .toMatchObject({ ok: true })
    expect(normalizarTicket('santa-teresa', ticket({ fecha_cierra: '2026-09-02 01:15:00' })))
      .toMatchObject({ ok: false })
  })
})

describe('normalizarLinea', () => {
  it('tolera nulos y basura sin romper los montos', () => {
    expect(normalizarLinea({ codigo: null, nombre: '', cantidad: null, monto: 'x', familia: null }))
      .toEqual({
        codigo_producto: null, nombre: null, cantidad: 0, precio: null, monto: 0,
        familia: null, es_pax: false, es_extra: false, es_cortesia: false,
      })
    expect(normalizarLinea('no soy objeto')).toBeNull()
  })
})

// ── Mesas abiertas y cursor ────────────────────────────────────────────────────

describe('normalizarOpen', () => {
  it('arma la fila del snapshot', () => {
    const r = normalizarOpen('nosara', {
      clave: 'mesa-12', mesa: '12', salonero_login: '026', canal: 'salon',
      pax: 4, pax_alerta: 'falta_nativo', updated_at: '2026-09-01T19:00:00-06:00',
    }, AHORA)
    expect(r).toMatchObject({
      ok: true,
      valor: { local: 'nosara', clave: 'mesa-12', pax: 4, updated_at: '2026-09-02T01:00:00.000Z' },
    })
  })

  it('sin clave no hay mesa; sin updated_at vale el momento del lote', () => {
    expect(normalizarOpen('nosara', { mesa: '12' }, AHORA)).toMatchObject({ ok: false })
    const r = normalizarOpen('nosara', { clave: 'mesa-1' }, AHORA)
    expect(r.ok && r.valor.updated_at).toBe(AHORA)
  })

  it('un canal o una alerta desconocidos se guardan como null, no rompen', () => {
    const r = normalizarOpen('nosara', { clave: 'm', canal: 'aire', pax_alerta: 'x' }, AHORA)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.valor).toMatchObject({ canal: null, pax_alerta: null })
  })
})

describe('normalizarCursor', () => {
  it('siempre deja el latido, aunque el agente no mande nada', () => {
    // Solo `local` y `last_poll_at`: lo demás ausente = "no lo toques".
    expect(normalizarCursor('nosara', undefined, AHORA)).toEqual({
      local: 'nosara', last_poll_at: AHORA,
    })
  })

  it('guarda el corte y el último error', () => {
    expect(normalizarCursor('nosara', {
      last_factura: '5001', last_fecha_registra: '2026-09-01T19:42:07-06:00', last_error: 'timeout',
    }, AHORA)).toEqual({
      local: 'nosara', last_poll_at: AHORA, last_factura: '5001',
      last_fecha_registra: '2026-09-02T01:42:07.000Z', last_error: 'timeout',
    })
  })

  it('distingue "no lo mandé" de "ponelo en null"', () => {
    expect(normalizarCursor('nosara', { last_error: null }, AHORA))
      .toHaveProperty('last_error', null)
    expect(normalizarCursor('nosara', {}, AHORA)).not.toHaveProperty('last_error')
  })
})

describe('fusionarCursor', () => {
  const guardado = {
    local: 'nosara', last_factura: '5001', last_fecha_registra: '2026-09-02T01:42:07.000Z',
    last_poll_at: '2026-09-02T01:45:00.000Z', last_error: 'timeout',
  }

  it('el saludo de arranque (lote vacío) NO borra el corte guardado', () => {
    const r = fusionarCursor(guardado, normalizarCursor('nosara', undefined, AHORA))
    expect(r).toEqual({ ...guardado, last_poll_at: AHORA })
  })

  it('lo que el agente sí manda, pisa', () => {
    const r = fusionarCursor(guardado, normalizarCursor('nosara', { last_factura: '5099' }, AHORA))
    expect(r.last_factura).toBe('5099')
    expect(r.last_fecha_registra).toBe(guardado.last_fecha_registra)   // no lo mandó: se conserva
  })

  it('last_error: null explícito limpia el error anterior (el agente se recuperó)', () => {
    const r = fusionarCursor(guardado, normalizarCursor('nosara', { last_error: null }, AHORA))
    expect(r.last_error).toBeNull()
  })

  it('sin fila previa arma la fila completa con nulls', () => {
    expect(fusionarCursor(null, normalizarCursor('nosara', undefined, AHORA))).toEqual({
      local: 'nosara', last_factura: null, last_fecha_registra: null,
      last_poll_at: AHORA, last_error: null,
    })
  })
})

// ── El lote entero ─────────────────────────────────────────────────────────────

describe('normalizarLote', () => {
  const lote = (tickets: unknown[], open?: unknown[]) =>
    normalizarLote({ local: 'santa-teresa', tickets, open, cursor: undefined }, AHORA)

  it('un ticket corrupto NO tumba el lote: se cuenta y se sigue', () => {
    const r = lote([ticket(), { numero_factura: '' }, ticket({}, { numero_factura: '5002' })])
    expect(r.tickets).toHaveLength(2)
    expect(r.invalid).toBe(1)
    expect(r.problemas).toHaveLength(1)
  })

  it('deduplica por numero_factura dentro del lote: gana el último (es el más fresco)', () => {
    const r = lote([
      ticket({}, { medios: { efectivo: 10000 } }),
      ticket({}, { medios: { efectivo: 11000 } }),
    ])
    expect(r.tickets).toHaveLength(1)
    expect(r.tickets[0].fila.total_crc).toBe(11000)
  })

  it('reenviar el mismo lote da exactamente el mismo resultado (idempotencia)', () => {
    const entrada = [ticket(), ticket({}, { numero_factura: '5002' })]
    expect(JSON.stringify(lote(entrada))).toBe(JSON.stringify(lote(entrada)))
  })

  it('deduplica el snapshot por clave y respeta el snapshot vacío', () => {
    const r = lote([], [{ clave: 'm1' }, { clave: 'm1', mesa: '9' }, { clave: 'm2' }])
    expect(r.open).toHaveLength(2)
    expect(r.open?.[0].mesa).toBe('9')

    expect(lote([], []).open).toEqual([])
    expect(lote([]).open).toBeUndefined()
  })

  it('no acumula más de 10 problemas (el log tiene que ser legible)', () => {
    const r = lote(new Array(50).fill({ numero_factura: '' }))
    expect(r.invalid).toBe(50)
    expect(r.problemas).toHaveLength(10)
  })

  it('cuenta los totales recalculados', () => {
    const r = lote([ticket({ total: 999 })])
    expect(r.recalculados).toBe(1)
    expect(r.tickets[0].fila.total_crc).toBe(12000)
  })
})
