import { describe, it, expect } from 'vitest'

import {
  CLAVE_CAJERO,
  CLAVE_SISTEMA,
  SIN_SALONERO,
  conServicio,
  construirDiaData,
  esCajeroTurno,
  esLoginSistema,
  mapCanal,
  mapCategoria,
  mapClaseIngreso,
  mapIva,
  mapRegalia,
  mapValorServido,
  mapEstado,
  mapFamiliaFlags,
  mapPax,
  mapSalonero,
  mapTicket,
  mapTotalProvisorio,
  mapTurno,
  type ItemCrudo,
  type TicketCrudo,
} from './mapTicket'
import type { SaloneroDay } from '../types/ventas'

// ── Fábricas ───────────────────────────────────────────────────────────────────
// Facturas sintéticas: CC no tiene red a SQLNUBE, así que el mapper se prueba
// contra filas armadas a mano con la forma exacta que devuelve el SELECT.

const item = (over: Partial<ItemCrudo> = {}): ItemCrudo => ({
  codigo:         '100',
  nombre:         'ROLL SATORI',
  cantidad:       1,
  monto:          6000,
  familia:        2,          // comida
  familia_nombre: 'SUSHI',
  ...over,
})

const factura = (over: Partial<TicketCrudo> = {}): TicketCrudo => ({
  numero_factura:   '9007199254740993',   // > 2^53: tiene que sobrevivir como string
  fecha_hora:       '2026-09-01 19:42:07',
  estado:           'C',
  tipo:             'M',
  area:             'SALON 1',
  login_cajero:     '222',
  usuario_registra: '026',
  salonero_nombre:  'MAXO',
  personas:         0,
  medios:           { efectivo: 10000 },
  items:            [item()],
  ...over,
})

// ── mapPax — los 5 casos ───────────────────────────────────────────────────────

describe('mapPax', () => {
  it('nativo 0 + artículo > 0 → pax = artículo, alerta falta_nativo', () => {
    expect(mapPax({ personas: 0, qty677: 2, qty678: 1 })).toEqual({
      pax: 4, pax_nativo: 0, pax_articulo: 4, pax_alerta: 'falta_nativo',
    })
  })

  it('nativo > 0 + artículo 0 → pax = nativo, alerta falta_articulo', () => {
    expect(mapPax({ personas: 3 })).toEqual({
      pax: 3, pax_nativo: 3, pax_articulo: 0, pax_alerta: 'falta_articulo',
    })
  })

  it('ambos > 0 e iguales → pax = nativo, alerta ok', () => {
    expect(mapPax({ personas: 4, qty677: 2, qty678: 1 })).toEqual({
      pax: 4, pax_nativo: 4, pax_articulo: 4, pax_alerta: 'ok',
    })
  })

  it('ambos > 0 y distintos → pax = nativo (manda el nativo), alerta difiere', () => {
    expect(mapPax({ personas: 5, qty677: 0, qty678: 1 })).toEqual({
      pax: 5, pax_nativo: 5, pax_articulo: 2, pax_alerta: 'difiere',
    })
  })

  it('ambos 0 → pax 0, alerta sin_pax', () => {
    expect(mapPax({ personas: null, qty677: null, qty678: undefined })).toEqual({
      pax: 0, pax_nativo: 0, pax_articulo: 0, pax_alerta: 'sin_pax',
    })
  })

  it('NUNCA suma las dos fuentes', () => {
    // 4 nativo + 4 artículo sumados darían 8: eso duplicaría la mesa.
    expect(mapPax({ personas: 4, qty677: 4 }).pax).toBe(4)
  })

  it('el 678 vale 2 personas y el 677 una', () => {
    expect(mapPax({ personas: 0, qty678: 3 }).pax_articulo).toBe(6)
    expect(mapPax({ personas: 0, qty677: 3 }).pax_articulo).toBe(3)
  })
})

// ── mapCanal ───────────────────────────────────────────────────────────────────

describe('mapCanal', () => {
  it('M → salon, D → delivery, B → barra, L → llevar', () => {
    expect(mapCanal('M')).toBe('salon')
    expect(mapCanal('D')).toBe('delivery')
    expect(mapCanal('B')).toBe('barra')
    expect(mapCanal('L')).toBe('llevar')
  })

  it('P, E, desconocido, vacío y null → otro', () => {
    for (const t of ['P', 'E', 'Z', '', '  ', null, undefined]) {
      expect(mapCanal(t)).toBe('otro')
    }
  })

  it('tolera minúsculas y espacios', () => {
    expect(mapCanal(' d ')).toBe('delivery')
  })

  it('el área NO decide el canal en v1', () => {
    expect(mapCanal('D', 'SALON 1')).toBe('delivery')
    expect(mapCanal(null, 'BARRA')).toBe('otro')
  })
})

// ── Familias ───────────────────────────────────────────────────────────────────

describe('mapFamiliaFlags', () => {
  it('19 → es_pax', () => {
    expect(mapFamiliaFlags(19)).toEqual({ es_pax: true, es_extra: false, es_cortesia: false })
  })
  it('22 → es_extra', () => {
    expect(mapFamiliaFlags(22)).toEqual({ es_pax: false, es_extra: true, es_cortesia: false })
  })
  it('17 → es_cortesia', () => {
    expect(mapFamiliaFlags('17')).toEqual({ es_pax: false, es_extra: false, es_cortesia: true })
  })
  it('familia desconocida o null → ninguna bandera', () => {
    expect(mapFamiliaFlags(null)).toEqual({ es_pax: false, es_extra: false, es_cortesia: false })
    expect(mapFamiliaFlags(2)).toEqual({ es_pax: false, es_extra: false, es_cortesia: false })
  })
})

describe('mapCategoria', () => {
  it('comida 2,3,4,6,13,16 · bebida 5', () => {
    for (const f of [2, 3, 4, 6, 13, 16]) expect(mapCategoria(f)).toBe('comida')
    expect(mapCategoria(5)).toBe('bebida')
  })
  it('lo que NO es ingreso queda etiquetado aparte', () => {
    expect(mapCategoria(19)).toBe('pax')
    expect(mapCategoria(20)).toBe('ingredientes')
    expect(mapCategoria(22)).toBe('extras')
    expect(mapCategoria(12)).toBe('giftcard')
    expect(mapCategoria(17)).toBe('cortesia')
    expect(mapCategoria(28)).toBe('duenos')
    for (const f of [21, 23, 24, 26, 27]) expect(mapCategoria(f)).toBe('merch')
    expect(mapCategoria(99)).toBe('otro')
  })
})

// ── mapEstado ──────────────────────────────────────────────────────────────────

describe('mapEstado', () => {
  it('solo C, X y R', () => {
    expect(mapEstado('C')).toBe('C')
    expect(mapEstado('x')).toBe('X')
    expect(mapEstado(' R ')).toBe('R')
    expect(mapEstado('A')).toBeNull()
    expect(mapEstado(null)).toBeNull()
  })
})

// ── mapTotalProvisorio ─────────────────────────────────────────────────────────

describe('mapTotalProvisorio', () => {
  it('COALESCE: los NULL no rompen el monto', () => {
    expect(mapTotalProvisorio({
      efectivo: null, tarjeta: undefined, montoElectronico: null,
      deposito: null, cheque: null, cuentaCobrar: null,
    })).toBe(0)
  })

  it('suma los seis medios en colones', () => {
    expect(mapTotalProvisorio({
      efectivo: 1000, tarjeta: 2000, montoElectronico: 500,
      deposito: 250, cheque: 100, cuentaCobrar: 150,
    })).toBe(4000)
  })

  it('NO suma dólares: el PoS ya los convirtió a colones', () => {
    expect(mapTotalProvisorio({
      efectivo: 10000, dolaresEfectivo: 20, dolaresTarjeta: 15,
    })).toBe(10000)
  })

  it('RESTA el vuelto: Efectivo viene con el vuelto adentro', () => {
    // Cuadre contra "Ventas Netas por Día" del PoS (1-sep-2026): el cliente pagó
    // ₡10.000 por un consumo de ₡7.000 y se llevó ₡3.000 de vuelto.
    expect(mapTotalProvisorio({ efectivo: 10000, vuelto: 3000 })).toBe(7000)
    expect(mapTotalProvisorio({ efectivo: 10000, tarjeta: 5000, vuelto: 3000 })).toBe(12000)
  })

  it('vuelto NULL o 0 no cambia el total', () => {
    expect(mapTotalProvisorio({ efectivo: 10000, vuelto: null })).toBe(10000)
    expect(mapTotalProvisorio({ efectivo: 10000, vuelto: 0 })).toBe(10000)
  })

  it('acepta montos como string (el driver a veces los devuelve así)', () => {
    expect(mapTotalProvisorio({ efectivo: '1500.50', tarjeta: '2000' })).toBe(3500.5)
  })
})

// ── Servicio 10% ───────────────────────────────────────────────────────────────

describe('conServicio', () => {
  it('ImpS 0 / null → sin servicio (delivery o llevar)', () => {
    expect(conServicio(0)).toBe(false)
    expect(conServicio(null)).toBe(false)
    expect(conServicio(undefined)).toBe(false)
    expect(conServicio('0')).toBe(false)
  })
  it('ImpS > 0 → con servicio (consumo en salón)', () => {
    expect(conServicio(1200)).toBe(true)
    expect(conServicio('0.5')).toBe(true)
  })
})

// ── Cajeros de turno, saloneros y turno ────────────────────────────────────────

describe('esCajeroTurno / esLoginSistema / mapSalonero', () => {
  it('111 y 222 son los cajeros del PoS', () => {
    expect(esCajeroTurno('111')).toBe(true)
    expect(esCajeroTurno('222')).toBe(true)
    expect(esCajeroTurno('026')).toBe(false)
    expect(esCajeroTurno(null)).toBe(false)
  })

  it('022 NO se mezcla con 111/222 hasta confirmarlo: sigue siendo salonero', () => {
    expect(esCajeroTurno('022')).toBe(false)
    expect(mapSalonero('022')).toBe('022')
  })

  it('002, 01 y 02 son logins de sistema', () => {
    expect(esLoginSistema('002')).toBe(true)
    expect(esLoginSistema('01')).toBe(true)
    expect(esLoginSistema('02')).toBe(true)
    expect(esLoginSistema('023')).toBe(false)
  })

  it('mapSalonero: mesero → login · cajero/sistema/vacío → null', () => {
    expect(mapSalonero('026')).toBe('026')
    expect(mapSalonero(' 023 ')).toBe('023')
    expect(mapSalonero('111')).toBeNull()
    expect(mapSalonero('222')).toBeNull()
    expect(mapSalonero('002')).toBeNull()
    expect(mapSalonero(null)).toBeNull()
    expect(mapSalonero('')).toBeNull()
  })
})

describe('mapTurno', () => {
  it('111 → mañana y 222 → noche, mande la hora que mande', () => {
    expect(mapTurno({ cajeroLogin: '111', fechaRegistra: '2026-09-01 23:30:00' })).toBe('mañana')
    expect(mapTurno({ cajeroLogin: '222', fechaRegistra: '2026-09-01 11:30:00' })).toBe('noche')
  })

  it('si registró un salonero, el turno sale de la hora (naive = hora CR)', () => {
    expect(mapTurno({ cajeroLogin: '026', fechaRegistra: '2026-09-01 12:05:00' })).toBe('mañana')
    expect(mapTurno({ cajeroLogin: '026', fechaRegistra: '2026-09-01 19:42:07' })).toBe('noche')
    expect(mapTurno({ cajeroLogin: '026', fechaRegistra: '2026-09-01 16:00:00' })).toBe('noche')
  })

  it('sin hora legible cae en noche (y el detalle lo muestra)', () => {
    expect(mapTurno({ cajeroLogin: null, fechaRegistra: null })).toBe('noche')
  })
})

// ── mapTicket ──────────────────────────────────────────────────────────────────

describe('mapTicket', () => {
  it('NumeroFactura sobrevive como string (decimal > 2^53)', () => {
    const t = mapTicket(factura())
    expect(t.numero_factura).toBe('9007199254740993')
    // Por eso NO se usa `Number`: el redondeo a double se come el último dígito.
    expect(String(Number(t.numero_factura))).not.toBe(t.numero_factura)
  })

  it('parte la fecha naive sin tocar la zona horaria', () => {
    const t = mapTicket(factura())
    expect(t.fecha).toBe('2026-09-01')
    expect(t.hora).toBe('19:42:07')
  })

  it('factura sin pedido (histórico) → salonero null y pax 0', () => {
    const t = mapTicket(factura({
      usuario_registra: null,
      salonero_nombre:  null,
      personas:         null,
      items:            [item({ codigo: '100' })],
    }))
    expect(t.salonero_login).toBeNull()
    expect(t.salonero_nombre).toBeNull()
    expect(t.salonero).toBe(SIN_SALONERO)
    expect(t.registrado_por).toBe('sin_pedido')
    expect(t.pax).toBe(0)
    expect(t.pax_alerta).toBe('sin_pax')
    expect(t.total).toBe(10000)          // el ticket SIGUE contando en el día
  })

  it('registrada por el cajero de la mañana SIN servicio → delivery/cajero', () => {
    const t = mapTicket(factura({
      usuario_registra: '111',
      salonero_nombre:  null,
      login_cajero:     '111',
      tipo:             'D',
      imp_servicio:     0,
    }))
    expect(t.salonero_login).toBeNull()
    expect(t.registrado_por).toBe('cajero')
    expect(t.turno).toBe('mañana')
    expect(t.con_servicio).toBe(false)
    expect(t.canal).toBe('delivery')
    expect(t.salonero).toBe(CLAVE_CAJERO['mañana'])
    expect(t.total).toBe(10000)          // NO se filtra del total
  })

  it('registrada por el cajero de la noche CON servicio → favor a salón', () => {
    const t = mapTicket(factura({
      usuario_registra: '222',
      salonero_nombre:  null,
      login_cajero:     '222',
      imp_servicio:     1200,
    }))
    expect(t.salonero_login).toBeNull()  // no se adivina el mesero por la mesa
    expect(t.registrado_por).toBe('cajero')
    expect(t.turno).toBe('noche')
    expect(t.con_servicio).toBe(true)
    expect(t.imp_servicio).toBe(1200)
    expect(t.salonero).toBe(CLAVE_CAJERO['noche'])
  })

  it('el cajero que cobró NO pisa al salonero que registró', () => {
    const t = mapTicket(factura({ usuario_registra: '026', login_cajero: '222' }))
    expect(t.salonero_login).toBe('026')
    expect(t.salonero).toBe('MAXO')
    expect(t.registrado_por).toBe('salonero')
    expect(t.login_cajero).toBe('222')
    expect(t.turno).toBe('noche')        // la caja de la noche, el mesero es MAXO
  })

  it('login de sistema (002 cocina express) sale del breakdown, no del total', () => {
    const t = mapTicket(factura({ usuario_registra: '002', salonero_nombre: null }))
    expect(t.registrado_por).toBe('sistema')
    expect(t.salonero).toBe(CLAVE_SISTEMA)
    expect(t.total).toBe(10000)
  })

  it('sin nombre en FAC_Empleados usa el maestro de saloneros conocido', () => {
    const t = mapTicket(factura({ usuario_registra: '024', salonero_nombre: null }))
    expect(t.salonero).toBe('JUANCHO')
  })

  it('SUM(ImpS) de la consulta manda; si no vino, suma línea por línea', () => {
    const conSuma = mapTicket(factura({ imp_servicio: 900, items: [item({ impS: 1 })] }))
    expect(conSuma.imp_servicio).toBe(900)

    const sinSuma = mapTicket(factura({
      items: [item({ impS: 600 }), item({ impS: 300, familia: 5 })],
    }))
    expect(sinSuma.imp_servicio).toBe(900)
    expect(sinSuma.con_servicio).toBe(true)
  })

  it('mix: comida y bebida suman ingreso; PAX, extras y cortesías no', () => {
    const t = mapTicket(factura({
      items: [
        item({ familia: 2,  monto: 6000, cantidad: 2 }),                     // comida
        item({ familia: 5,  monto: 3000, cantidad: 3, codigo: '200' }),      // bebida
        item({ familia: 19, monto: 0, cantidad: 4, codigo: '677' }),         // A PAX
        item({ familia: 22, monto: 1500, cantidad: 1, codigo: '300' }),      // EXTRAS
        item({ familia: 17, monto: 2500, cantidad: 1, codigo: '400' }),      // cortesía
        item({ familia: 28, monto: 800,  cantidad: 1, codigo: '500' }),      // dueños
      ],
    }))
    expect(t.comida).toBe(6000)
    expect(t.bebida).toBe(3000)
    expect(t.unidades_comida).toBe(2)
    expect(t.unidades_bebida).toBe(3)
    expect(t.cortesias).toBe(2500)
    expect(t.duenos).toBe(800)
    expect(t.pax).toBe(4)                 // 677 × 4
    expect(t.pax_alerta).toBe('falta_nativo')
  })

  it('EsExtra/Compuesto no infla las unidades (pero el monto sigue contando)', () => {
    const t = mapTicket(factura({
      items: [
        item({ cantidad: 1, monto: 6000 }),
        item({ cantidad: 5, monto: 500, codigo: '301', no_cuenta_unidad: true }),
      ],
    }))
    expect(t.unidades_comida).toBe(1)
    expect(t.comida).toBe(6500)
  })

  it('resta el vuelto del total e imprime los dólares aparte', () => {
    const t = mapTicket(factura({
      medios: { efectivo: 12000, dolaresEfectivo: 40, vuelto: 2000, tarjeta: null },
    }))
    expect(t.total).toBe(10000)
    expect(t.total_fuente).toBe('provisorio')
    expect(t.medios.dolares_efectivo).toBe(40)
    expect(t.medios.vuelto).toBe(2000)   // se sigue mostrando para poder cuadrarlo
  })
})

// ── construirDiaData ───────────────────────────────────────────────────────────

describe('construirDiaData', () => {
  const tickets = [
    mapTicket(factura({
      numero_factura: '1001', usuario_registra: '026', salonero_nombre: 'MAXO',
      medios: { efectivo: 10000 }, imp_servicio: 1000,
      items: [item({ monto: 6000, cantidad: 1 }), item({ familia: 5, monto: 3000, cantidad: 2, codigo: '200', nombre: 'IMPERIAL' })],
    })),
    mapTicket(factura({
      numero_factura: '1002', usuario_registra: '027', salonero_nombre: 'GUILLE',
      medios: { tarjeta: 25000 }, imp_servicio: 2500,
      items: [item({ monto: 20000, cantidad: 3 })],
    })),
    mapTicket(factura({
      numero_factura: '1003', usuario_registra: '222', salonero_nombre: null,
      login_cajero: '222', tipo: 'D', imp_servicio: 0,
      medios: { efectivo: 8000 },
      items: [item({ monto: 8000, cantidad: 1 })],
    })),
  ]

  const dia = construirDiaData('2026-09-01', tickets, { uploadedAt: '2026-09-02' })

  it('arma la forma DiaData con la clave por salonero', () => {
    expect(dia.fileName).toBe('ndf 2026-09-01')
    expect(dia.uploadedAt).toBe('2026-09-02')
    expect(Object.keys(dia.saloneros).sort()).toEqual(['Cajero turno noche', 'GUILLE', 'MAXO'])
  })

  it('el salonero trae total, mix, servicio y productos ordenados por monto', () => {
    const maxo = dia.saloneros['MAXO'] as SaloneroDay
    expect(maxo.total).toBe(10000)
    expect(maxo.com).toBe(6000)
    expect(maxo.beb).toBe(3000)
    expect(maxo.iCom).toBe(1)
    expect(maxo.iBeb).toBe(2)
    expect(maxo.serv).toBe(1000)
    expect(maxo.iva).toBe(0)             // la Fase 1a no toca impuestos de venta
    expect(maxo.prods[0][0]).toBe('ROLL SATORI')
  })

  it('las facturas del cajero van a su propia línea, con la forma CajeroDay', () => {
    const caja = dia.saloneros['Cajero turno noche']
    expect(caja).toMatchObject({ esCajero: true, total: 8000, delivery: 8000, salon: 0, ordenes: 1 })
  })

  it('el total del día es la suma de TODAS las facturas, cajero incluido', () => {
    const total = Object.values(dia.saloneros).reduce((s, v) => s + v.total, 0)
    expect(total).toBe(43000)
  })
})

// ── Desglose fiscal (mig 063) ──────────────────────────────────────────────────
// Firmado 2026-09-04 · SPEC-valor-servido-regalias.md

// Las cuatro funciones, llamadas directo: son puras y se van a reusar desde A2/A3
// sin pasar por `mapTicket`.
describe('las funciones del desglose, sueltas', () => {
  const li = (familia: number, monto: number, categoria: 'comida' | 'cortesia' | 'duenos' | 'otro' = 'otro') =>
    ({ codigo: null, nombre: 'x', cantidad: 1, monto, imp_servicio: 0, imp_venta: 0,
       familia, familia_nombre: null, categoria, es_pax: false, es_extra: false, es_cortesia: false })

  it('mapValorServido suma solo las familias del neto', () => {
    expect(mapValorServido([li(2, 1000), li(29, 500), li(6, 9999), li(19, 7777)])).toBe(1500)
    expect(mapValorServido([])).toBe(0)
  })

  it('mapIva suma los ImpV de las líneas, o toma el del ticket si vino', () => {
    const items = [{ ...li(2, 1000), imp_venta: 130 }, { ...li(5, 500), imp_venta: 65 }]
    expect(mapIva(items)).toBe(195)
    expect(mapIva(items, 900)).toBe(900)
    expect(mapIva(items, 0)).toBe(0)
    expect(mapIva([])).toBe(0)
  })

  it('mapRegalia: 17 + 28 + el neto sin cobrar', () => {
    const items = [li(17, 2500, 'cortesia'), li(28, 800, 'duenos')]
    expect(mapRegalia({ items, valorServido: 0, total: 5000 })).toBe(3300)
    expect(mapRegalia({ items: [], valorServido: 12000, total: 0 })).toBe(12000)
    expect(mapRegalia({ items: [], valorServido: 12000, total: 12000 })).toBe(0)
  })

  it('mapClaseIngreso cuenta condiciones: 2+ → mixta', () => {
    const base = { items: [], valorServido: 0, total: 10000, descuento: 0 }
    expect(mapClaseIngreso(base)).toBe('cobrada')
    expect(mapClaseIngreso({ ...base, descuento: 500 })).toBe('descuento')
    expect(mapClaseIngreso({ ...base, items: [li(17, 100, 'cortesia')], descuento: 500 })).toBe('mixta')
    expect(mapClaseIngreso({ ...base, total: 0 })).toBeNull()
  })
})

describe('mapValorServido — el NETO', () => {
  const linea = (familia: number, monto: number, codigo = String(familia)) =>
    item({ familia, monto, codigo })

  it('suma comida 2,3,4,13,16,29 y bebida 5', () => {
    const t = mapTicket(factura({
      items: [linea(2, 1000), linea(3, 2000), linea(4, 3000), linea(13, 4000),
              linea(16, 5000), linea(29, 6000), linea(5, 7000)],
    }))
    expect(t.valor_servido).toBe(28000)
  })

  it('la familia 29 (bentos/almuerzo) ENTRA', () => {
    expect(mapTicket(factura({ items: [linea(29, 4500)] })).valor_servido).toBe(4500)
  })

  it('la familia 6 NO entra: es el cajón mixto con la comida del personal', () => {
    // …aunque el MIX la siga contando como comida: son dos medidas distintas.
    const t = mapTicket(factura({ items: [linea(6, 9000)] }))
    expect(t.valor_servido).toBe(0)
    expect(t.comida).toBe(9000)
  })

  it('deja afuera pax, extras, gift, merch, cortesías, dueños y cajón/personal', () => {
    for (const f of [19, 20, 22, 12, 21, 23, 24, 26, 27, 17, 28, 1, 6, 9, 11, 15, 25]) {
      expect(mapTicket(factura({ items: [linea(f, 5000)] })).valor_servido).toBe(0)
    }
  })
})

describe('mapIva — nunca derivado', () => {
  it('es el ImpV que mandó el PoS, línea por línea', () => {
    const t = mapTicket(factura({
      imp_venta: undefined,
      items: [item({ monto: 10000, impV: 1300 }), item({ monto: 5000, impV: 650, codigo: '200' })],
    }))
    expect(t.iva).toBe(1950)
  })

  it('el SUM(ImpV) de la consulta gana sobre la suma de líneas', () => {
    expect(mapTicket(factura({ imp_venta: 900, items: [item({ impV: 1 })] })).iva).toBe(900)
  })

  it('2024: ImpV = 0 → iva 0, NUNCA neto x 0,13', () => {
    const t = mapTicket(factura({
      fecha_hora: '2024-03-10 20:00:00', imp_venta: 0,
      items: [item({ familia: 2, monto: 50000, impV: 0 })],
    }))
    expect(t.valor_servido).toBe(50000)
    expect(t.iva).toBe(0)              // 50000 × 0,13 = 6500 — NO aparece por ningún lado
  })

  it('2026: con ImpV real, se guarda tal cual', () => {
    const t = mapTicket(factura({
      imp_venta: 6500, items: [item({ familia: 2, monto: 50000, impV: 6500 })],
    }))
    expect(t.iva).toBe(6500)
  })

  it('sin la columna ImpV (llega null) el IVA queda en 0', () => {
    expect(mapTicket(factura({ imp_venta: null, items: [item({ impV: null })] })).iva).toBe(0)
  })
})

describe('mapRegalia — medida en NETO', () => {
  it('suma las líneas de cortesías (17) y dueños (28)', () => {
    const t = mapTicket(factura({
      items: [item({ familia: 2, monto: 10000 }),
              item({ familia: 17, monto: 2500, codigo: '400' }),
              item({ familia: 28, monto: 800, codigo: '500' })],
    }))
    expect(t.regalia).toBe(3300)
  })

  it('un ticket servido y NO cobrado regala su neto entero', () => {
    const t = mapTicket(factura({
      medios: {}, items: [item({ familia: 2, monto: 12000 })],
    }))
    expect(t.total).toBe(0)
    expect(t.valor_servido).toBe(12000)
    expect(t.regalia).toBe(12000)
  })

  it('NO incluye el descuento: una promo autorizada no es un regalo', () => {
    const t = mapTicket(factura({
      descuento: 5000, medios: { efectivo: 10000 }, items: [item({ familia: 2, monto: 15000 })],
    }))
    expect(t.descuento).toBe(5000)
    expect(t.regalia).toBe(0)
  })

  it('las dos partes SUMAN sin pisarse: 17/28 no están en el neto', () => {
    const t = mapTicket(factura({
      medios: {}, items: [item({ familia: 2, monto: 10000 }), item({ familia: 17, monto: 2500, codigo: '400' })],
    }))
    // Se sirvieron ₡10.000 de comida + ₡2.500 de cortesía y no entró un colón: se
    // regalaron los ₡12.500. La condición de la regalía es la LITERAL de la spec
    // (`valor_servido > 0 AND total = 0`), sin el "sin 17/28" que sí lleva la CLASE:
    // ahí esa exclusión existe para que una cortesía no cuente doble y salga `mixta`.
    expect(t.valor_servido).toBe(10000)
    expect(t.regalia).toBe(12500)
    expect(t.clase_ingreso).toBe('cortesia')
  })
})

describe('mapClaseIngreso — una por clase', () => {
  const clase = (over: Partial<TicketCrudo>) => mapTicket(factura(over)).clase_ingreso

  it('cobrada: hay plata y ninguna condición especial', () => {
    expect(clase({ medios: { efectivo: 12000 }, items: [item({ familia: 2, monto: 12000 })] })).toBe('cobrada')
  })

  it('cortesia: hay líneas de familia 17', () => {
    expect(clase({ medios: {}, items: [item({ familia: 17, monto: 2500 })] })).toBe('cortesia')
  })

  it('duenos: hay líneas de familia 28', () => {
    expect(clase({ medios: {}, items: [item({ familia: 28, monto: 800 })] })).toBe('duenos')
  })

  it('sin_cobro: se sirvió y no se cobró, sin 17 ni 28', () => {
    expect(clase({ medios: {}, items: [item({ familia: 2, monto: 12000 })] })).toBe('sin_cobro')
  })

  it('descuento: hubo descuento y el resto se cobró', () => {
    expect(clase({ descuento: 3000, medios: { efectivo: 9000 }, items: [item({ familia: 2, monto: 12000 })] }))
      .toBe('descuento')
  })

  it('mixta: 17 Y 28 en el mismo ticket', () => {
    expect(clase({
      medios: {},
      items: [item({ familia: 17, monto: 2500 }), item({ familia: 28, monto: 800, codigo: '500' })],
    })).toBe('mixta')
  })

  it('mixta: cortesía + descuento', () => {
    expect(clase({
      descuento: 1000, medios: { efectivo: 9000 },
      items: [item({ familia: 2, monto: 10000 }), item({ familia: 17, monto: 2500, codigo: '400' })],
    })).toBe('mixta')
  })

  it('null: ni venta ni regalo (nada servido, nada cobrado)', () => {
    expect(clase({ medios: {}, items: [] })).toBeNull()
  })

  it('una cortesía NO es mixta por tener total 0', () => {
    // `sin_cobro` se define SIN 17/28 justamente para que esto no pase.
    expect(clase({ medios: {}, items: [item({ familia: 17, monto: 2500 })] })).toBe('cortesia')
  })
})

describe('el desglose NO toca el total', () => {
  it('total sigue siendo Σ medios − vuelto, mire lo que mire el desglose', () => {
    const t = mapTicket(factura({
      descuento: 4000, imp_venta: 1300,
      medios: { efectivo: 15000, vuelto: 3000, dolaresEfectivo: 20 },
      items: [item({ familia: 2, monto: 10000, impV: 1300 }), item({ familia: 17, monto: 2500, codigo: '400' })],
    }))
    expect(t.total).toBe(12000)          // 15.000 − 3.000, igual que antes de la 063
    expect(t.valor_servido).toBe(10000)
    expect(t.iva).toBe(1300)
    expect(t.regalia).toBe(2500)
    expect(t.descuento).toBe(4000)
    expect(t.clase_ingreso).toBe('mixta')
  })

  it('el bruto servido se DERIVA, no se guarda', () => {
    const t = mapTicket(factura({
      imp_venta: 1300, imp_servicio: 1000,
      items: [item({ familia: 2, monto: 10000, impV: 1300 })],
    }))
    expect(t.valor_servido + t.iva + t.imp_servicio).toBe(12300)
  })

  it('2024 con iva 0: bruto = neto + servicio', () => {
    const t = mapTicket(factura({
      fecha_hora: '2024-03-10 20:00:00', imp_venta: 0, imp_servicio: 5000,
      items: [item({ familia: 2, monto: 50000, impV: 0 })],
    }))
    expect(t.valor_servido + t.iva + t.imp_servicio).toBe(55000)
  })
})
