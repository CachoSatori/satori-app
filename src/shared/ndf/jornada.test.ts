import { describe, it, expect } from 'vitest'

import {
  agruparEnLotes,
  agruparPorJornadaTurno,
  cajaDeLogin,
  CAJAS_POR_LOGIN,
  claveLote,
  etiquetaTurno,
  fechaCR,
  instanteCanonico,
  jornadaPorTicket,
  turnoDeCajero,
  turnoDeTicket,
  turnosConocidos,
  type DefCaja,
  type TicketJornada,
} from './jornada'

// Los datos de staging que fijan la semántica (5-sep y 4-sep de 2026).
const t = (over: Partial<TicketJornada> & { fecha_registra: string }): TicketJornada => ({
  fecha_cierra: null,
  cajero_login: null,
  ...over,
})

// ── Hora de Costa Rica ─────────────────────────────────────────────────────────────────────

describe('fechaCR — el día SIEMPRE en CR, nunca ::date pelado', () => {
  it('el cierre de las 22:07 CR es del MISMO día, no del siguiente', () => {
    // 2026-09-04 22:07:59 CR = 2026-09-05T04:07:59Z. Un `::date` bajo TimeZone=UTC diría 05.
    expect(fechaCR('2026-09-04T22:07:59-06:00')).toBe('2026-09-04')
    expect(fechaCR('2026-09-05T04:07:59Z')).toBe('2026-09-04')     // el MISMO instante
  })

  it('la medianoche CR abre el día siguiente', () => {
    expect(fechaCR('2026-09-05T23:59:59-06:00')).toBe('2026-09-05')
    expect(fechaCR('2026-09-06T00:00:00-06:00')).toBe('2026-09-06')
  })

  it('sin instante no inventa una fecha', () => {
    expect(fechaCR(null)).toBeNull()
    expect(fechaCR('')).toBeNull()
    expect(fechaCR('no soy una fecha')).toBeNull()
  })
})

describe('instanteCanonico', () => {
  it('dos escrituras del mismo momento dan la MISMA clave', () => {
    expect(instanteCanonico('2026-09-04T22:07:59-06:00'))
      .toBe(instanteCanonico('2026-09-05T04:07:59Z'))
  })
})

// ── Turno = el cajero, no el reloj ─────────────────────────────────────────────────────────

describe('el mapa de cajas — el turno se BUSCA, no se pregunta con ifs', () => {
  it('lookup: 111 → mañana, 222 → tarde', () => {
    expect(turnoDeCajero('111')).toBe('manana')
    expect(turnoDeCajero('222')).toBe('tarde')
    expect(cajaDeLogin('111')).toMatchObject({ turno: 'manana', etiqueta: 'Mañana · almuerzo' })
    expect(cajaDeLogin('222')).toMatchObject({ turno: 'tarde',  etiqueta: 'Tarde · noche' })
  })

  it('un login FUERA del mapa no tiene turno de caja, y no se inventa por reloj', () => {
    for (const l of [null, undefined, '', '026', '002', '022', '01', '333']) {
      expect(turnoDeCajero(l), `login: ${JSON.stringify(l)}`).toBeNull()
      expect(cajaDeLogin(l), `login: ${JSON.stringify(l)}`).toBeNull()
    }
  })

  it('el turno NO depende de la hora del ticket', () => {
    // El 111 que cierra tardísimo sigue siendo la mañana; el 222 que cobra temprano, la tarde.
    expect(turnoDeTicket({ cajero_login: '111' })).toBe('manana')
    expect(turnoDeTicket({ cajero_login: '222' })).toBe('tarde')
  })

  it('los turnos conocidos salen del mapa, ordenados y sin repetir', () => {
    expect(turnosConocidos()).toEqual([
      { turno: 'manana', etiqueta: 'Mañana · almuerzo', orden: 1 },
      { turno: 'tarde',  etiqueta: 'Tarde · noche',     orden: 2 },
    ])
  })

  it('etiquetaTurno lee el mapa; sin caja conocida lo dice, no inventa un nombre', () => {
    expect(etiquetaTurno('manana')).toBe('Mañana · almuerzo')
    expect(etiquetaTurno('tarde')).toBe('Tarde · noche')
    expect(etiquetaTurno(null)).toBe('Sin caja de turno')
    expect(etiquetaTurno('barra')).toBe('barra')            // no está en el mapa: el id crudo
  })

  it('SUMAR UN TURNO DE BARRA = UNA FILA en el mapa, sin tocar nada más', () => {
    // El contrato del addendum: la barra entra por el mapa. Se simula agregándole la fila a una
    // copia y comprobando que todo lo que consume el mapa la toma sola.
    const conBarra: Record<string, DefCaja> = {
      ...CAJAS_POR_LOGIN,
      '333': { turno: 'barra', etiqueta: 'Barra', orden: 3 },
    }
    // El lookup por login sale del mapa…
    expect(conBarra['333']).toMatchObject({ turno: 'barra' })
    // …y la lista de turnos se deriva de él, ordenada, sin que nadie la escriba a mano.
    const derivados = Object.values(conBarra)
      .sort((a, b) => a.orden - b.orden)
      .map(c => c.turno)
    expect(derivados).toEqual(['manana', 'tarde', 'barra'])

    // Y el mapa real sigue intacto: la prueba no lo mutó.
    expect(Object.keys(CAJAS_POR_LOGIN)).toEqual(['111', '222'])
  })

  it('el mapa NO toca el canal: son dos ejes distintos', () => {
    // El canal (`pos_ndf_tickets.canal`) es por TICKET; el turno es por CAJA. Una venta de
    // canal «barra» cobrada por el 222 es del turno tarde, no de un turno «barra».
    const enBarra = { fecha_registra: '2026-09-05T19:00:00-06:00', cajero_login: '222' }
    expect(turnoDeTicket(enBarra)).toBe('tarde')
    expect(Object.values(CAJAS_POR_LOGIN).some(c => c.turno === 'barra')).toBe(false)
  })
})

// ── El lote de cierre ──────────────────────────────────────────────────────────────────────

describe('agruparEnLotes — un turno = un lote (cajero, fecha_cierra)', () => {
  it('mismo cajero + misma fecha_cierra = UN turno, y no se parte', () => {
    const cierre = '2026-09-05T22:30:00-06:00'
    const lotes = agruparEnLotes([
      t({ fecha_registra: '2026-09-05T17:10:00-06:00', fecha_cierra: cierre, cajero_login: '222' }),
      t({ fecha_registra: '2026-09-05T20:45:00-06:00', fecha_cierra: cierre, cajero_login: '222' }),
      t({ fecha_registra: '2026-09-05T22:05:00-06:00', fecha_cierra: cierre, cajero_login: '222' }),
    ])
    expect(lotes).toHaveLength(1)
    expect(lotes[0].tickets).toHaveLength(3)
    expect(lotes[0].turno).toBe('tarde')
    expect(lotes[0].abierto).toBe(false)
  })

  it('su fecha es la de APERTURA (min fecha_registra en CR), no el timestamp de cierre', () => {
    const lotes = agruparEnLotes([
      t({ fecha_registra: '2026-09-05T20:45:00-06:00', fecha_cierra: '2026-09-05T22:30:00-06:00', cajero_login: '222' }),
      t({ fecha_registra: '2026-09-05T17:10:00-06:00', fecha_cierra: '2026-09-05T22:30:00-06:00', cajero_login: '222' }),
    ])
    expect(lotes[0].apertura).toBe('2026-09-05T23:10:00.000Z')   // 17:10 CR
    expect(lotes[0].jornada).toBe('2026-09-05')
  })

  it('EL BORDE: el 222 que cierra 2026-09-06 01:00 pero abrió el 5 → jornada 2026-09-05', () => {
    const cierre = '2026-09-06T01:00:00-06:00'
    const lotes = agruparEnLotes([
      t({ fecha_registra: '2026-09-05T18:30:00-06:00', fecha_cierra: cierre, cajero_login: '222' }),
      t({ fecha_registra: '2026-09-05T23:50:00-06:00', fecha_cierra: cierre, cajero_login: '222' }),
      t({ fecha_registra: '2026-09-06T00:40:00-06:00', fecha_cierra: cierre, cajero_login: '222' }),
    ])
    expect(lotes).toHaveLength(1)
    expect(lotes[0].jornada).toBe('2026-09-05')                  // la que ABRIÓ
    expect(fechaCR(lotes[0].fechaCierra)).toBe('2026-09-06')     // el cierre es del 6, y da igual
    expect(lotes[0].turno).toBe('tarde')
    // Los tres tickets quedan juntos, incluido el que se facturó pasada la medianoche.
    expect(lotes[0].tickets).toHaveLength(3)
  })

  it('el mismo día, dos cajeros = dos lotes (5-sep de staging)', () => {
    const lotes = agruparEnLotes([
      t({ fecha_registra: '2026-09-05T11:30:00-06:00', fecha_cierra: '2026-09-05T16:07:00-06:00', cajero_login: '111' }),
      t({ fecha_registra: '2026-09-05T17:10:00-06:00', fecha_cierra: '2026-09-05T22:30:00-06:00', cajero_login: '222' }),
    ])
    expect(lotes).toHaveLength(2)
    expect(lotes.map(l => [l.jornada, l.turno])).toEqual([
      ['2026-09-05', 'manana'],
      ['2026-09-05', 'tarde'],
    ])
  })

  it('el MISMO instante escrito distinto no parte el lote', () => {
    const lotes = agruparEnLotes([
      t({ fecha_registra: '2026-09-04T21:00:00-06:00', fecha_cierra: '2026-09-04T22:07:59-06:00', cajero_login: '222' }),
      t({ fecha_registra: '2026-09-04T21:30:00-06:00', fecha_cierra: '2026-09-05T04:07:59Z',      cajero_login: '222' }),
    ])
    expect(lotes).toHaveLength(1)
    expect(lotes[0].tickets).toHaveLength(2)
  })

  it('el mismo cajero que cierra DOS veces en el día son dos lotes distintos', () => {
    const lotes = agruparEnLotes([
      t({ fecha_registra: '2026-09-05T11:00:00-06:00', fecha_cierra: '2026-09-05T13:00:00-06:00', cajero_login: '111' }),
      t({ fecha_registra: '2026-09-05T13:30:00-06:00', fecha_cierra: '2026-09-05T16:07:00-06:00', cajero_login: '111' }),
    ])
    expect(lotes).toHaveLength(2)
    expect(lotes.every(l => l.jornada === '2026-09-05' && l.turno === 'manana')).toBe(true)
  })
})

// ── Turno abierto (en vivo) ────────────────────────────────────────────────────────────────

describe('fecha_cierra NULL — el fallback en vivo', () => {
  it('agrupa por cajero + día CR de la venta', () => {
    const lotes = agruparEnLotes([
      t({ fecha_registra: '2026-09-06T17:00:00-06:00', cajero_login: '222' }),
      t({ fecha_registra: '2026-09-06T19:30:00-06:00', cajero_login: '222' }),
      t({ fecha_registra: '2026-09-06T12:00:00-06:00', cajero_login: '111' }),
    ])
    expect(lotes).toHaveLength(2)
    const tarde = lotes.find(l => l.turno === 'tarde')!
    expect(tarde.abierto).toBe(true)
    expect(tarde.fechaCierra).toBeNull()
    expect(tarde.jornada).toBe('2026-09-06')
    expect(tarde.tickets).toHaveLength(2)
  })

  it('la clave abierta NUNCA se confunde con la cerrada del mismo cajero y día', () => {
    const abierto = claveLote(t({ fecha_registra: '2026-09-05T18:00:00-06:00', cajero_login: '222' }))
    const cerrado = claveLote(t({
      fecha_registra: '2026-09-05T18:00:00-06:00',
      fecha_cierra:   '2026-09-05T22:30:00-06:00',
      cajero_login:   '222',
    }))
    expect(abierto).not.toBe(cerrado)
  })

  it('se ASIENTA al lote cuando cierra: los mismos tickets, ya con fecha_cierra, dan UN lote cerrado', () => {
    const enVivo = [
      t({ fecha_registra: '2026-09-05T18:00:00-06:00', cajero_login: '222' }),
      t({ fecha_registra: '2026-09-05T21:00:00-06:00', cajero_login: '222' }),
    ]
    const cerrado = enVivo.map(x => ({ ...x, fecha_cierra: '2026-09-05T22:30:00-06:00' }))

    const antes   = agruparEnLotes(enVivo)
    const despues = agruparEnLotes(cerrado)
    expect(antes).toHaveLength(1)
    expect(despues).toHaveLength(1)
    expect(antes[0].abierto).toBe(true)
    expect(despues[0].abierto).toBe(false)
    // Lo que NO cambia al cerrar: la jornada y el turno.
    expect(despues[0].jornada).toBe(antes[0].jornada)
    expect(despues[0].turno).toBe(antes[0].turno)
  })

  it('LÍMITE ACEPTADO: en turno ABIERTO la medianoche parte el lote — y el cierre lo repara', () => {
    // Sin `fecha_cierra` no hay nada que diga que esas facturas son la misma pasada de caja, y
    // adivinarlo con una ventana horaria sería volver a la lógica de reloj que P1a vino a
    // matar. Así que en vivo se parte, y se documenta. En cuanto el cajero cierra, los dos
    // pedazos caen bajo la misma clave y la jornada pasa a ser la de la apertura.
    const abierto = agruparEnLotes([
      t({ fecha_registra: '2026-09-05T18:30:00-06:00', cajero_login: '222' }),
      t({ fecha_registra: '2026-09-06T00:40:00-06:00', cajero_login: '222' }),
    ])
    expect(abierto).toHaveLength(2)                       // ← el límite: se parte
    expect(abierto.map(l => l.jornada)).toEqual(['2026-09-05', '2026-09-06'])
    // Pero no tumba nada: los dos pedazos tienen jornada y turno, y ningún ticket se pierde.
    expect(abierto.every(l => l.turno === 'tarde')).toBe(true)
    expect(abierto.flatMap(l => l.tickets)).toHaveLength(2)

    const cerrado = agruparEnLotes([
      t({ fecha_registra: '2026-09-05T18:30:00-06:00', fecha_cierra: '2026-09-06T01:00:00-06:00', cajero_login: '222' }),
      t({ fecha_registra: '2026-09-06T00:40:00-06:00', fecha_cierra: '2026-09-06T01:00:00-06:00', cajero_login: '222' }),
    ])
    expect(cerrado).toHaveLength(1)
    expect(cerrado[0].jornada).toBe('2026-09-05')
  })
})

// ── (jornada, turno) ───────────────────────────────────────────────────────────────────────

describe('agruparPorJornadaTurno', () => {
  it('arma las celdas del 4 y el 5 de septiembre, ordenadas', () => {
    const celdas = agruparPorJornadaTurno([
      t({ fecha_registra: '2026-09-04T20:00:00-06:00', fecha_cierra: '2026-09-04T22:07:00-06:00', cajero_login: '222' }),
      t({ fecha_registra: '2026-09-05T11:30:00-06:00', fecha_cierra: '2026-09-05T16:07:00-06:00', cajero_login: '111' }),
      t({ fecha_registra: '2026-09-05T17:10:00-06:00', fecha_cierra: '2026-09-05T22:30:00-06:00', cajero_login: '222' }),
    ])
    expect(celdas.map(c => [c.jornada, c.turno])).toEqual([
      ['2026-09-04', 'tarde'],
      ['2026-09-05', 'manana'],
      ['2026-09-05', 'tarde'],
    ])
  })

  it('dos cierres del mismo cajero en el día caen en la MISMA celda', () => {
    const celdas = agruparPorJornadaTurno([
      t({ fecha_registra: '2026-09-05T11:00:00-06:00', fecha_cierra: '2026-09-05T13:00:00-06:00', cajero_login: '111' }),
      t({ fecha_registra: '2026-09-05T13:30:00-06:00', fecha_cierra: '2026-09-05T16:07:00-06:00', cajero_login: '111' }),
    ])
    expect(celdas).toHaveLength(1)
    expect(celdas[0].lotes).toHaveLength(2)
    expect(celdas[0].tickets).toHaveLength(2)
  })

  it('INVARIANTE: ningún ticket se pierde ni se duplica', () => {
    const tickets = [
      t({ fecha_registra: '2026-09-05T11:30:00-06:00', fecha_cierra: '2026-09-05T16:07:00-06:00', cajero_login: '111' }),
      t({ fecha_registra: '2026-09-05T17:10:00-06:00', fecha_cierra: '2026-09-05T22:30:00-06:00', cajero_login: '222' }),
      t({ fecha_registra: '2026-09-05T19:00:00-06:00', cajero_login: '222' }),
      t({ fecha_registra: '2026-09-05T14:00:00-06:00', cajero_login: '026' }),   // sin cajero de turno
    ]
    const celdas = agruparPorJornadaTurno(tickets)
    expect(celdas.flatMap(c => c.tickets)).toHaveLength(tickets.length)
    expect(new Set(celdas.flatMap(c => c.tickets)).size).toBe(tickets.length)
  })

  it('la factura sin cajero de turno queda en su propia celda, NO se reparte a ojo', () => {
    const celdas = agruparPorJornadaTurno([
      t({ fecha_registra: '2026-09-05T14:00:00-06:00', cajero_login: '026' }),
    ])
    expect(celdas).toHaveLength(1)
    expect(celdas[0].turno).toBeNull()
    expect(celdas[0].jornada).toBe('2026-09-05')
  })

  it('sin tickets, sin celdas', () => {
    expect(agruparPorJornadaTurno([])).toEqual([])
  })
})

describe('jornadaPorTicket', () => {
  it('etiqueta cada ticket con la jornada de SU lote', () => {
    const tardio = t({ fecha_registra: '2026-09-06T00:40:00-06:00', fecha_cierra: '2026-09-06T01:00:00-06:00', cajero_login: '222' })
    const temprano = t({ fecha_registra: '2026-09-05T18:30:00-06:00', fecha_cierra: '2026-09-06T01:00:00-06:00', cajero_login: '222' })

    const mapa = jornadaPorTicket([tardio, temprano])
    // El ticket de las 00:40 del 6 pertenece a la jornada del 5: la que abrió su lote.
    expect(mapa.get(tardio)).toMatchObject({ jornada: '2026-09-05', turno: 'tarde' })
    expect(mapa.get(temprano)?.lote).toBe(mapa.get(tardio)?.lote)
  })
})

// ── Los tres lotes reales de staging ───────────────────────────────────────────────────────
//
// Números de factura y horas de cierre verificados contra staging. Son el caso de aceptación
// de P1a: si esto se rompe, la jornada dejó de coincidir con lo que el PoS cerró de verdad.

/** `110826..110838` → tickets con el mismo lote, repartidos en la tarde/noche. */
const rango = (
  desde: number, hasta: number,
  opts: { cierre: string | null; cajero: string; primero: string; pasoMin?: number },
): (TicketJornada & { numero: string })[] => {
  const paso = opts.pasoMin ?? 10
  const t0 = Date.parse(opts.primero)
  const out: (TicketJornada & { numero: string })[] = []
  for (let n = desde; n <= hasta; n++) {
    out.push({
      numero:         String(n),
      fecha_registra: new Date(t0 + (n - desde) * paso * 60_000).toISOString(),
      fecha_cierra:   opts.cierre,
      cajero_login:   opts.cajero,
    })
  }
  return out
}

describe('los lotes REALES de staging (4 y 5 de septiembre de 2026)', () => {
  // 110826–110838: 13 facturas, cerradas por el 222 a las 22:07:59 CR del 4-sep.
  const LOTE_4_TARDE = rango(110826, 110838, {
    cajero: '222', cierre: '2026-09-04T22:07:59-06:00', primero: '2026-09-04T18:05:00-06:00',
  })
  // 110840: una sola factura, cerrada por el 111 a las 16:07:03 CR del 5-sep.
  const LOTE_5_MANANA = rango(110840, 110840, {
    cajero: '111', cierre: '2026-09-05T16:07:03-06:00', primero: '2026-09-05T12:20:00-06:00',
  })
  // 110843–110866: 24 facturas, cerradas por el 222 a las 22:30:06 CR del 5-sep.
  const LOTE_5_TARDE = rango(110843, 110866, {
    cajero: '222', cierre: '2026-09-05T22:30:06-06:00', primero: '2026-09-05T17:15:00-06:00',
  })
  const TODOS = [...LOTE_4_TARDE, ...LOTE_5_MANANA, ...LOTE_5_TARDE]

  it('110826–110838 = UN turno tarde del 222, jornada 2026-09-04, cierre 22:07:59 CR', () => {
    const lotes = agruparEnLotes(LOTE_4_TARDE)
    expect(lotes).toHaveLength(1)
    expect(lotes[0]).toMatchObject({ cajeroLogin: '222', turno: 'tarde', jornada: '2026-09-04' })
    expect(lotes[0].tickets).toHaveLength(13)
    expect(lotes[0].tickets.map(t => t.numero)).toEqual(
      Array.from({ length: 13 }, (_, i) => String(110826 + i)))
    expect(fechaCR(lotes[0].fechaCierra)).toBe('2026-09-04')
    expect(lotes[0].fechaCierra).toBe('2026-09-05T04:07:59.000Z')   // 22:07:59 CR
  })

  it('110840 = mañana del 111, jornada 2026-09-05, cierre 16:07:03 CR', () => {
    const lotes = agruparEnLotes(LOTE_5_MANANA)
    expect(lotes).toHaveLength(1)
    expect(lotes[0]).toMatchObject({ cajeroLogin: '111', turno: 'manana', jornada: '2026-09-05' })
    expect(lotes[0].fechaCierra).toBe('2026-09-05T22:07:03.000Z')   // 16:07:03 CR
  })

  it('110843–110866 = UN turno tarde del 222, jornada 2026-09-05, cierre 22:30:06 CR', () => {
    const lotes = agruparEnLotes(LOTE_5_TARDE)
    expect(lotes).toHaveLength(1)
    expect(lotes[0]).toMatchObject({ cajeroLogin: '222', turno: 'tarde', jornada: '2026-09-05' })
    expect(lotes[0].tickets).toHaveLength(24)
    expect(lotes[0].fechaCierra).toBe('2026-09-06T04:30:06.000Z')   // 22:30:06 CR
  })

  it('los tres juntos = tres lotes y tres celdas (jornada, turno), sin mezclarse', () => {
    expect(agruparEnLotes(TODOS)).toHaveLength(3)
    expect(agruparPorJornadaTurno(TODOS).map(c => [c.jornada, c.turno, c.tickets.length])).toEqual([
      ['2026-09-04', 'tarde',  13],
      ['2026-09-05', 'manana',  1],
      ['2026-09-05', 'tarde',  24],
    ])
  })

  it('ninguna de las 38 facturas se pierde ni se duplica', () => {
    const celdas = agruparPorJornadaTurno(TODOS)
    const numeros = celdas.flatMap(c => c.tickets.map(t => t.numero))
    expect(numeros).toHaveLength(38)
    expect(new Set(numeros).size).toBe(38)
  })
})

describe('jornada para TODOS los tickets, turno solo para los del mapa', () => {
  it('el ticket sin caja conocida IGUAL forma lote y recibe jornada — solo le falta el turno', () => {
    const lotes = agruparEnLotes([
      t({ fecha_registra: '2026-09-05T14:00:00-06:00', fecha_cierra: '2026-09-05T16:00:00-06:00', cajero_login: '026' }),
      t({ fecha_registra: '2026-09-05T15:00:00-06:00', cajero_login: null }),   // histórico sin cajero
    ])
    expect(lotes).toHaveLength(2)
    for (const l of lotes) {
      expect(l.jornada).toBe('2026-09-05')   // jornada SIEMPRE
      expect(l.turno).toBeNull()             // turno solo si está en el mapa
    }
  })

  it('mezclados con los del mapa, NINGUNO se cae del día', () => {
    const tickets = [
      t({ fecha_registra: '2026-09-05T12:00:00-06:00', fecha_cierra: '2026-09-05T16:07:03-06:00', cajero_login: '111' }),
      t({ fecha_registra: '2026-09-05T18:00:00-06:00', fecha_cierra: '2026-09-05T22:30:06-06:00', cajero_login: '222' }),
      t({ fecha_registra: '2026-09-05T15:00:00-06:00', cajero_login: '026' }),
      t({ fecha_registra: '2026-09-05T15:30:00-06:00', cajero_login: null }),
    ]
    const celdas = agruparPorJornadaTurno(tickets)
    expect(celdas.flatMap(c => c.tickets)).toHaveLength(4)
    expect(celdas.every(c => c.jornada === '2026-09-05')).toBe(true)
    // Dos celdas con turno y las sin caja, que quedan aparte pero presentes.
    expect(celdas.filter(c => c.turno === null).flatMap(c => c.tickets)).toHaveLength(2)
  })
})
