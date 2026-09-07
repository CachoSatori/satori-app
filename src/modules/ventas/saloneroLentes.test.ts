// Las dos lentes. El caso testigo es la factura REAL 110607 del PoS, la que destapó todo:
// 5 líneas comandadas por GONZA (`032`) + 4 por MAXO (`026`), y los DOS pax (677) son de MAXO.
// Con el modelo viejo (un mesero por ticket) esa factura entera se le acreditaba a uno solo.
import { describe, it, expect } from 'vitest'

import {
  TURNO_DIA, calcularLentes, duenoDeMesa, etiquetaTurnoSalonero, prorratear, turnoDeFactura,
  type FilaMesaPropia, type FilaVentaPropia, type LentesSaloneros, type LineaLente,
  type TicketLente,
} from './saloneroLentes'

// Familia 2 = comida, está en FAMILIAS_VALOR_SERVIDO. Familia 19 = "A PAX", NO es valor servido.
const FAM_COMIDA = 2
const FAM_PAX    = 19

const ticket = (p: Partial<TicketLente> & { id: string }): TicketLente => ({
  cajero_login:      '111',
  valor_servido_crc: 0,
  iva_crc:           0,
  servicio_crc:      0,
  pax:               0,
  mesa:              null,
  ...p,
})

const linea = (
  ticket_id: string, usuario_registra: string | null, monto: number, p: Partial<LineaLente> = {},
): LineaLente => ({
  ticket_id, usuario_registra, monto,
  codigo_producto: 'X1',
  cantidad:        1,
  familia:         FAM_COMIDA,
  ...p,
})

/** Una línea de pax: código 677, familia 19, sin plata. */
const pax = (ticket_id: string, usuario_registra: string | null, cantidad: number): LineaLente =>
  linea(ticket_id, usuario_registra, 0, { codigo_producto: '677', familia: FAM_PAX, cantidad })

const fila = (r: LentesSaloneros, id: string): FilaVentaPropia | undefined =>
  r.ventaPropia.find(f => f.personaId === id)
const filaB = (r: LentesSaloneros, id: string): FilaMesaPropia | undefined =>
  r.mesaPropia.find(f => f.personaId === id)

// ── El caso testigo ────────────────────────────────────────────────────────────────────────

describe('factura 110607 — dos meseros en la MISMA factura', () => {
  // 5 líneas de GONZA por ₡2.000 c/u = 10.000 · 4 de MAXO por ₡2.500 c/u = 10.000. Neta 20.000.
  const t = ticket({ id: 'f110607', valor_servido_crc: 20_000, iva_crc: 2_600, pax: 2, mesa: '7' })
  const ls: LineaLente[] = [
    ...Array.from({ length: 5 }, () => linea('f110607', '032', 2_000)),
    ...Array.from({ length: 4 }, () => linea('f110607', '026', 2_500)),
    pax('f110607', '026', 2),   // los dos PAX son de MAXO
  ]

  it('LENTE A: la plata se parte por quién comandó, no se acredita entera a uno', () => {
    const r = calcularLentes([t], ls)
    expect(fila(r, '032')?.netaCrc).toBe(10_000)   // GONZA
    expect(fila(r, '026')?.netaCrc).toBe(10_000)   // MAXO
    expect(fila(r, '032')?.lineas).toBe(5)
    expect(fila(r, '026')?.lineas).toBe(4)
  })

  it('LENTE A: el PAX propio es de quien registró el 677 — MAXO', () => {
    const r = calcularLentes([t], ls)
    expect(fila(r, '026')?.paxPropio).toBe(2)
    expect(fila(r, '032')?.paxPropio).toBe(0)
    expect(fila(r, '032')?.promPorPax).toBeNull()   // sin pax no se divide por cero
    expect(fila(r, '026')?.promPorPax).toBe(5_000)  // 10.000 / 2
  })

  it('LENTE B: la mesa entera es de MAXO, que registró el 677', () => {
    const r = calcularLentes([t], ls)
    expect(r.mesaPropia).toHaveLength(1)
    expect(filaB(r, '026')?.netaMesasCrc).toBe(20_000)  // la neta ENTERA, incluida la de GONZA
    expect(filaB(r, '026')?.tickets).toBe(1)
    expect(filaB(r, '026')?.mesas).toBe(1)
    expect(filaB(r, '026')?.ticketPromedio).toBe(20_000)
    expect(filaB(r, '026')?.promPorPaxMesa).toBe(10_000) // 20.000 / 2 pax de la factura
  })

  it('LAS DOS LENTES NO SE SUMAN: cada una vale la neta ENTERA del día', () => {
    const r = calcularLentes([t], ls)
    const sumaA = r.ventaPropia.reduce((s, f) => s + f.netaCrc, 0)
    const sumaB = r.mesaPropia.reduce((s, f) => s + f.netaMesasCrc, 0)
    expect(sumaA).toBe(20_000)
    expect(sumaB).toBe(20_000)
    // Sumarlas daría 40.000 sobre un día de 20.000: esa es exactamente la mesa partida contada
    // dos veces. Por eso viven en dos arreglos y no hay función que los junte.
    expect(sumaA + sumaB).not.toBe(r.netaDiaCrc)
  })

  it('el IVA se prorratea con la plata y sigue cuadrando con la factura', () => {
    const r = calcularLentes([t], ls)
    expect(fila(r, '032')?.ivaCrc).toBe(1_300)
    expect(fila(r, '026')?.ivaCrc).toBe(1_300)
    expect(r.ventaPropia.reduce((s, f) => s + f.ivaCrc, 0)).toBe(2_600)
  })
})

// ── La invariante de plata ─────────────────────────────────────────────────────────────────

describe('Σ(meseros) + caja + genérico + otro = neta del día', () => {
  const tickets = [
    ticket({ id: 't1', cajero_login: '111', valor_servido_crc: 10_000, iva_crc: 1_300 }),
    ticket({ id: 't2', cajero_login: '222', valor_servido_crc: 7_000,  iva_crc:   910 }),
  ]
  const lineas = [
    linea('t1', '032', 6_000),   // mesero
    linea('t1', '111', 3_000),   // caja
    linea('t1', '02',  1_000),   // genérico
    linea('t2', '023', 4_000),   // mesero (ESTEBAN, código activo)
    linea('t2', '555', 2_000),   // el MISMO ESTEBAN, código viejo
    linea('t2', null,  1_000),   // sin código
  ]

  it('las cuatro clases suman la neta, no se pierde ni se duplica un colón', () => {
    const r = calcularLentes(tickets, lineas)
    const porRol = (rol: string) =>
      r.ventaPropia.filter(f => f.rol === rol).reduce((s, f) => s + f.netaCrc, 0)

    expect(porRol('mesero') + porRol('caja') + porRol('generico') + porRol('otro')).toBe(17_000)
    expect(r.netaLineasCrc).toBe(17_000)
    expect(r.netaDiaCrc).toBe(17_000)
    expect(r.descuadreCrc).toBe(0)
  })

  it('la caja y el genérico NO son meseros, pero su plata cuenta igual', () => {
    const r = calcularLentes(tickets, lineas)
    expect(fila(r, '111')?.rol).toBe('caja')
    expect(fila(r, '02')?.rol).toBe('generico')
    expect(fila(r, '111')?.netaCrc).toBe(3_000)
    expect(fila(r, '02')?.netaCrc).toBe(1_000)
  })

  it('ESTEBAN sale en UNA fila con sus dos códigos sumados', () => {
    const r = calcularLentes(tickets, lineas)
    expect(r.ventaPropia.filter(f => f.personaId === '023')).toHaveLength(1)
    expect(fila(r, '023')?.netaCrc).toBe(6_000)   // 4.000 (023) + 2.000 (555)
    expect(r.ventaPropia.some(f => f.personaId === '555')).toBe(false)
  })

  it('una factura sin líneas NO se descarta: aparece en el descuadre', () => {
    const r = calcularLentes([...tickets, ticket({ id: 't3', valor_servido_crc: 5_000 })], lineas)
    expect(r.netaDiaCrc).toBe(22_000)
    expect(r.netaLineasCrc).toBe(17_000)
    expect(r.descuadreCrc).toBe(5_000)   // visible, no escondido
  })

  it('las líneas que no son valor servido no suman plata (pero sí pax)', () => {
    // La familia 19 "A PAX" no es ingreso: si sumara, el día quedaría inflado.
    const r = calcularLentes(
      [ticket({ id: 't9', valor_servido_crc: 1_000 })],
      [linea('t9', '032', 1_000), pax('t9', '032', 3)],
    )
    expect(fila(r, '032')?.netaCrc).toBe(1_000)
    expect(fila(r, '032')?.paxPropio).toBe(3)
    expect(fila(r, '032')?.lineas).toBe(1)
  })
})

// ── Una fila por persona × turno ───────────────────────────────────────────────────────────

describe('turno: lo define la CAJA que cobró, no el reloj', () => {
  it('`111` mañana · `222` noche · cualquier otro cae en el balde "día"', () => {
    expect(turnoDeFactura('111')).toBe('manana')
    expect(turnoDeFactura('222')).toBe('tarde')     // el id del mapa; su etiqueta dice "Tarde · noche"
    expect(turnoDeFactura('388')).toBe(TURNO_DIA)   // sin fila "Bar" en v1
    expect(turnoDeFactura(null)).toBe(TURNO_DIA)
    expect(turnoDeFactura('')).toBe(TURNO_DIA)
  })

  it('las etiquetas salen del mapa de cajas, no se arman acá', () => {
    expect(etiquetaTurnoSalonero('manana')).toBe('Mañana · almuerzo')
    expect(etiquetaTurnoSalonero('tarde')).toBe('Tarde · noche')
    expect(etiquetaTurnoSalonero(TURNO_DIA)).toBe('Día')
  })

  it('la misma persona en dos turnos da DOS filas, no una sumada', () => {
    const r = calcularLentes(
      [
        ticket({ id: 'm', cajero_login: '111', valor_servido_crc: 5_000 }),
        ticket({ id: 'n', cajero_login: '222', valor_servido_crc: 8_000 }),
      ],
      [linea('m', '032', 5_000), linea('n', '032', 8_000)],
    )
    const suyas = r.ventaPropia.filter(f => f.personaId === '032')
    expect(suyas).toHaveLength(2)
    expect(suyas.map(f => [f.turno, f.netaCrc])).toEqual([['manana', 5_000], ['tarde', 8_000]])
  })

  it('las filas salen ordenadas por turno y, adentro, por plata', () => {
    const r = calcularLentes(
      [
        ticket({ id: 'n', cajero_login: '222', valor_servido_crc: 9_000 }),
        ticket({ id: 'm', cajero_login: '111', valor_servido_crc: 3_000 }),
      ],
      [linea('n', '032', 9_000), linea('m', '026', 1_000), linea('m', '024', 2_000)],
    )
    expect(r.ventaPropia.map(f => [f.turno, f.personaId])).toEqual([
      ['manana', '024'],   // 2.000
      ['manana', '026'],   // 1.000
      ['tarde',  '032'],
    ])
  })
})

// ── Lente B: el dueño de la mesa ───────────────────────────────────────────────────────────

describe('duenoDeMesa — quien registró el 677, con desempates deterministas', () => {
  it('gana el que registró el 677 aunque tenga MENOS plata', () => {
    const d = duenoDeMesa([
      linea('t', '032', 90_000),
      linea('t', '026', 1_000),
      pax('t', '026', 2),
    ])
    expect(d.id).toBe('026')
  })

  it('con 677 de los dos, gana el de más unidades', () => {
    const d = duenoDeMesa([pax('t', '032', 4), pax('t', '026', 2)])
    expect(d.id).toBe('032')
  })

  it('empate de 677 → desempata la neta de ESA factura', () => {
    const d = duenoDeMesa([
      pax('t', '032', 2), linea('t', '032', 1_000),
      pax('t', '026', 2), linea('t', '026', 5_000),
    ])
    expect(d.id).toBe('026')
  })

  it('sin ningún 677 → el de más neta', () => {
    const d = duenoDeMesa([linea('t', '032', 1_000), linea('t', '026', 5_000)])
    expect(d.id).toBe('026')
  })

  it('empate total → el id alfabético, NO el orden en que vinieron las filas', () => {
    const ls = [linea('t', '032', 1_000), linea('t', '026', 1_000)]
    expect(duenoDeMesa(ls).id).toBe('026')
    expect(duenoDeMesa([...ls].reverse()).id).toBe('026')
  })

  it('una factura sin líneas no se le regala a nadie', () => {
    expect(duenoDeMesa([]).rol).toBe('otro')
  })

  it('cuenta SOLO el 677: el 678 no acredita pax en v1', () => {
    const d = duenoDeMesa([
      { ticket_id: 't', usuario_registra: '032', monto: 0, codigo_producto: '678', cantidad: 9, familia: FAM_PAX },
      pax('t', '026', 1),
    ])
    expect(d.id).toBe('026')
  })
})

describe('lente B — mesas vs facturas', () => {
  it('dos facturas de la misma mesa son UNA mesa y DOS tickets', () => {
    const r = calcularLentes(
      [
        ticket({ id: 'a', valor_servido_crc: 10_000, mesa: '7', pax: 2 }),
        ticket({ id: 'b', valor_servido_crc: 6_000,  mesa: '7', pax: 1 }),
      ],
      [pax('a', '032', 2), linea('a', '032', 10_000), pax('b', '032', 1), linea('b', '032', 6_000)],
    )
    expect(filaB(r, '032')?.mesas).toBe(1)
    expect(filaB(r, '032')?.tickets).toBe(2)
    expect(filaB(r, '032')?.ticketPromedio).toBe(8_000)   // 16.000 / 2 facturas
    expect(filaB(r, '032')?.promPorPaxMesa).toBe(5_333)   // 16.000 / 3 pax, redondeado
  })

  it('las facturas SIN número de mesa cuentan una por una, no todas como una sola', () => {
    // Delivery y para llevar no traen mesa. Agrupar por `null` las contaría como una mesa.
    const r = calcularLentes(
      [
        ticket({ id: 'a', valor_servido_crc: 5_000, mesa: null }),
        ticket({ id: 'b', valor_servido_crc: 5_000, mesa: '' }),
      ],
      [linea('a', '032', 5_000), linea('b', '032', 5_000)],
    )
    expect(filaB(r, '032')?.mesas).toBe(2)
    expect(filaB(r, '032')?.tickets).toBe(2)
  })
})

// ── Prorrateo ──────────────────────────────────────────────────────────────────────────────

describe('prorratear — reparte sin perder ni inventar un colón', () => {
  it('la suma de las partes es EXACTAMENTE el total, aunque no divida redondo', () => {
    const partes = prorratear(100, [1, 1, 1])
    expect(partes.reduce((s, p) => s + p, 0)).toBe(100)
    expect(partes).toEqual([34, 33, 33])   // el resto va al primero, determinista
  })

  it('reparte proporcional a la plata', () => {
    expect(prorratear(1_000, [750, 250])).toEqual([750, 250])
  })

  it('sin pesos (o todos en cero) no reparte nada: el total queda huérfano', () => {
    expect(prorratear(500, [])).toEqual([])
    expect(prorratear(500, [0, 0])).toEqual([0, 0])
  })

  it('el IVA de una factura sin plata atribuible NO se evapora: cae en "sin código"', () => {
    const r = calcularLentes(
      [ticket({ id: 't', valor_servido_crc: 0, iva_crc: 1_300, servicio_crc: 500 })],
      [linea('t', '032', 0, { familia: FAM_PAX })],   // línea sin valor servido
    )
    expect(r.ventaPropia.reduce((s, f) => s + f.ivaCrc, 0)).toBe(1_300)
    expect(r.ventaPropia.reduce((s, f) => s + f.servicioCrc, 0)).toBe(500)
    expect(fila(r, '(sin codigo)')?.ivaCrc).toBe(1_300)
  })
})

describe('bordes', () => {
  it('sin nada devuelve las dos lentes vacías y el día en cero', () => {
    const r = calcularLentes([], [])
    expect(r.ventaPropia).toEqual([])
    expect(r.mesaPropia).toEqual([])
    expect(r.netaDiaCrc).toBe(0)
    expect(r.descuadreCrc).toBe(0)
  })

  it('los nulos de la base no rompen ni ensucian los totales', () => {
    const r = calcularLentes(
      [ticket({ id: 't', valor_servido_crc: null, iva_crc: null, servicio_crc: null, pax: null })],
      [linea('t', '032', null as unknown as number, { cantidad: null })],
    )
    expect(r.netaDiaCrc).toBe(0)
    expect(fila(r, '032')?.netaCrc).toBe(0)
    expect(fila(r, '032')?.promPorPax).toBeNull()
  })
})
