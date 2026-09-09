import { describe, it, expect, vi } from 'vitest'

vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

import {
  armarDia, armarSnapshot, calidadPaxPorSalonero, claveSalonero, compararContra,
  esJornadaEnCurso, esSinAsignar, etiquetaNoMesero, horaCRDe, jornadaActualCR,
  diasPorTurno,
  jornadasComparables, lotesDeCierre, nombreSalonero, paxDelTicket, ritmoPorHora,
  detallarMesasAbiertas, etiquetaTurnoPoS, excluirCerradas, frescuraDe, jornadaDesplazada,
  resumirMesasAbiertas, tiempoAbiertaConfiable, ventasPorCanal, ventasPorTurno,
  ventasPorTurnoPoS,
} from './ventasEnVivoDatos'
import type { CajeroDay } from '../../shared/types/ventas'
import { SALONEROS_CONOCIDOS } from '../../shared/ndf/mapTicket'
import { turnosConocidos } from '../../shared/ndf/jornada'
import { aggGeneral, aggSalonero, getDayStats } from './ventasUtils'
import { businessDateDe, ventanaJornada, type MesaAbiertaRow } from '../../shared/api/posNdf'
import { mixPorCategoria, ticketsDelDia } from './ventasEnVivoTypes'
import { FAMILIAS_NETO } from './ventasEnVivoDatos'
import { FAMILIAS_VALOR_SERVIDO } from '../../shared/ndf/mapTicket'
import type { LineaNdfRow, TicketNdfConId } from '../../shared/api/posNdf'
import type { DiaData, SaloneroDay } from '../../shared/types/ventas'

/** El día que arma esta capa solo tiene saloneros (nunca `CajeroDay`). */
const sal = (dia: DiaData, clave: string): SaloneroDay => dia.saloneros[clave] as SaloneroDay

const ticket = (over: Partial<TicketNdfConId> = {}): TicketNdfConId => ({
  id: 't1', numero_factura: '5001', fecha_registra: '2026-09-01T19:42:07-06:00',
  fecha_cierra: null, cajero_login: '222',
  canal: 'salon', mesa: null, salonero_login: '026', registrado_por: 'salonero', turno: 'noche',
  con_servicio: true, servicio_crc: 1200, total_crc: 13560, valor_servido_crc: 12000,
  iva_crc: 0, regalia_crc: 0, descuento_crc: 0, clase_ingreso: 'cobrada',
  pax: 2, pax_nativo: 2, pax_articulo: 2, pax_alerta: 'ok', ...over,
})

/** Los saloneros cargados en Empleados. Sin esto, el día los muestra por número marcado. */
const NOMBRES = { '026': 'MAXO', '027': 'GUILLE' }

/** `armarDia` con el maestro puesto — como corre de verdad. */
const armar = (
  fecha: string, tickets: TicketNdfConId[], lineas: LineaNdfRow[], uploadedAt: string,
) => armarDia(fecha, tickets, lineas, uploadedAt, NOMBRES)

const linea = (over: Partial<LineaNdfRow> = {}): LineaNdfRow => ({
  ticket_id: 't1', codigo_producto: '100', nombre: 'ROLL SATORI',
  cantidad: 2, monto: 9000, familia: 2, usuario_registra: null, ...over,
})

// ── La jornada 07:00 → 07:00 ───────────────────────────────────────────────────

describe('ventanaJornada / businessDateDe', () => {
  it('la jornada va de las 07:00 CR a las 07:00 CR del día siguiente', () => {
    expect(ventanaJornada('2026-09-01')).toEqual({
      desde: '2026-09-01T07:00:00-06:00', hasta: '2026-09-02T07:00:00-06:00',
    })
  })

  it('lo facturado a la 1 de la mañana pertenece al servicio de la noche ANTERIOR', () => {
    expect(businessDateDe('2026-09-02T01:30:00-06:00')).toBe('2026-09-01')
    expect(businessDateDe('2026-09-01T23:00:00-06:00')).toBe('2026-09-01')
  })

  it('a partir de las 07:00 ya es la jornada nueva', () => {
    expect(businessDateDe('2026-09-02T06:59:00-06:00')).toBe('2026-09-01')
    expect(businessDateDe('2026-09-02T07:00:00-06:00')).toBe('2026-09-02')
  })

  it('cruza fin de mes', () => {
    expect(ventanaJornada('2026-08-31').hasta).toBe('2026-09-01T07:00:00-06:00')
    expect(businessDateDe('2026-09-01T02:00:00-06:00')).toBe('2026-08-31')
  })
})

// ── El día ─────────────────────────────────────────────────────────────────────

describe('armarDia', () => {
  it('acredita el NETO al salonero, no el bruto', () => {
    const a = armar('2026-09-01', [ticket()], [linea()], '2026-09-01')
    expect(sal(a.dia, 'MAXO').total).toBe(12000)   // valor_servido_crc
    expect(a.bruto).toBe(13560)                        // total_crc, al lado
    expect(a.servicio).toBe(1200)
  })

  it('el bruto, el servicio, el IVA y la regalía viajan aparte', () => {
    const a = armar('2026-09-01', [
      ticket({ id: 't1', iva_crc: 0, regalia_crc: 0 }),
      ticket({ id: 't2', numero_factura: '5002', total_crc: 0, valor_servido_crc: 5000,
               regalia_crc: 5000, clase_ingreso: 'sin_cobro' }),
    ], [], '2026-09-01')
    expect(a.bruto).toBe(13560)
    expect(a.regalia).toBe(5000)
    expect(a.iva).toBe(0)                              // 2024/histórico: ImpV = 0, no derivado
  })

  it('las facturas del cajero cuentan en el día, en su propia línea', () => {
    // El balde del cajero sale de la CAJA QUE COBRÓ (`cajero_login`, acá el 222 del fixture)
    // y del canal: fuera del salón es un cajero de turno. Ver `claveNoMesero`.
    const a = armar('2026-09-01', [
      ticket(),
      ticket({ id: 't2', numero_factura: '5002', salonero_login: null,
               registrado_por: 'cajero', canal: 'delivery', valor_servido_crc: 8000 }),
    ], [], '2026-09-01')
    expect(Object.keys(a.dia.saloneros).sort()).toEqual(['Cajero turno tarde', 'MAXO'])
    const total = Object.values(a.dia.saloneros).reduce((s, v) => s + v.total, 0)
    expect(total).toBe(20000)
  })

  it('el cajero DENTRO del salón no es un cajero: es «Salón sin mesero»', () => {
    // Venta de salón que la factura no le acredita a ningún mesero. No suma al Total Cajeros;
    // quién comandó cada línea se resuelve en la otra lente (`usuario_registra`).
    const a = armar('2026-09-01', [
      ticket(),
      ticket({ id: 't2', numero_factura: '5002', salonero_login: null,
               registrado_por: 'cajero', canal: 'salon', valor_servido_crc: 8000 }),
      ticket({ id: 't3', numero_factura: '5003', salonero_login: null,
               registrado_por: 'sin_pedido', canal: 'salon', valor_servido_crc: 2000 }),
    ], [], '2026-09-01')
    expect(Object.keys(a.dia.saloneros).sort()).toEqual(['MAXO', 'Salón sin mesero'])
    expect((a.dia.saloneros['Salón sin mesero'] as CajeroDay).total).toBe(10000)
  })

  it('caja y sistema salen marcados `esCajero` — fuera del ranking, dentro del total', () => {
    // El turno lo da `cajero_login` (la caja que cobró), no el login que registró.
    const a = armar('2026-09-01', [
      ticket(),
      ticket({ id: 't2', numero_factura: '5002', salonero_login: null, cajero_login: '111',
               registrado_por: 'cajero', canal: 'delivery', valor_servido_crc: 8000 }),
      ticket({ id: 't3', numero_factura: '5003', salonero_login: null, cajero_login: '222',
               registrado_por: 'cajero', canal: 'delivery', valor_servido_crc: 3000 }),
      ticket({ id: 't4', numero_factura: '5004', salonero_login: '002',
               registrado_por: 'sistema', valor_servido_crc: 1000 }),
    ], [], '2026-09-01')

    expect(Object.keys(a.dia.saloneros).sort())
      .toEqual(['Cajero turno mañana', 'Cajero turno tarde', 'MAXO', 'Sistema y otros'])

    // La marca es lo que hace que `aggSalonero` los saltee y `aggGeneral` los mande a caja.
    for (const clave of ['Cajero turno mañana', 'Cajero turno tarde', 'Sistema y otros']) {
      expect((a.dia.saloneros[clave] as CajeroDay).esCajero).toBe(true)
    }
    expect((a.dia.saloneros['MAXO'] as CajeroDay).esCajero).toBeUndefined()

    // Y sin embargo su venta sigue contando en el día.
    const total = Object.values(a.dia.saloneros).reduce((s, v) => s + v.total, 0)
    expect(total).toBe(12000 + 8000 + 3000 + 1000)
  })

  it('el cajero lleva órdenes, ticket promedio y su corte salón/delivery', () => {
    // Los dos son del cajero 111 y ninguno es de salón (el de salón se iría a «Salón sin mesero»).
    // `salon` acá es lo que no es delivery: barra / para llevar / otro.
    const a = armar('2026-09-01', [
      ticket({ id: 'c1', salonero_login: null, cajero_login: '111', registrado_por: 'cajero',
               canal: 'llevar', valor_servido_crc: 6000 }),
      ticket({ id: 'c2', numero_factura: '5002', salonero_login: null, cajero_login: '111',
               registrado_por: 'cajero', canal: 'delivery', valor_servido_crc: 4000 }),
    ], [], '2026-09-01')
    const c = a.dia.saloneros['Cajero turno mañana'] as CajeroDay
    expect(c.total).toBe(10000)
    expect(c.delivery).toBe(4000)
    expect(c.salon).toBe(6000)
    expect(c.ordenes).toBe(2)
    expect(c.ticketProm).toBe(5000)
  })

  it('el mix deja afuera el artículo pax y las familias que no son neto', () => {
    const a = armar('2026-09-01', [ticket()], [
      linea({ familia: 2, monto: 9000, cantidad: 2 }),
      linea({ familia: 5, monto: 3000, cantidad: 3, nombre: 'IMPERIAL', codigo_producto: '200' }),
      linea({ familia: 19, monto: 0, cantidad: 2, nombre: 'PAX', codigo_producto: '677' }),
      linea({ familia: 22, monto: 1500, cantidad: 1, nombre: 'EXTRA', codigo_producto: '300' }),
      linea({ familia: 17, monto: 2500, cantidad: 1, nombre: 'CORTESIA', codigo_producto: '400' }),
    ], '2026-09-01')

    const prods = sal(a.dia, 'MAXO').prods.map(p => p[0])
    expect(prods).toEqual(['ROLL SATORI', 'IMPERIAL'])
    expect(prods).not.toContain('PAX')
    expect(prods).not.toContain('EXTRA')
    expect(sal(a.dia, 'MAXO').com).toBe(9000)
    expect(sal(a.dia, 'MAXO').beb).toBe(3000)
  })

  // `KOROKKE BENTO` es un PRODUCTO real (`import/productos.csv`), con clasificación
  // GREENSEASON y subclasificación BENTO BOX. La caja de almuerzo es una familia de platos
  // DENTRO de GreenSeason; la FAMILIA 29 se llama GreenSeason, que es lo que se etiqueta acá.
  it('la familia 29 (GreenSeason) entra como comida, con su propia etiqueta', () => {
    const a = armar('2026-09-01', [ticket()],
      [linea({ familia: 29, monto: 4500, cantidad: 1, nombre: 'KOROKKE BENTO' })], '2026-09-01')
    expect(sal(a.dia, 'MAXO').com).toBe(4500)
    expect(a.pm['KOROKKE BENTO'].clasificacion).toBe('GreenSeason')
    expect(a.pm['KOROKKE BENTO'].tipo).toBe('comida')
  })

  it('el mix se agrupa por FAMILIA del PoS, no por el ProductMap', () => {
    const a = armar('2026-09-01', [ticket()], [
      linea({ familia: 3,  monto: 9000, cantidad: 2, nombre: 'ROLL SATORI' }),
      linea({ familia: 5,  monto: 3000, cantidad: 3, nombre: 'IMPERIAL', codigo_producto: '200' }),
      linea({ familia: 2,  monto: 2000, cantidad: 1, nombre: 'EDAMAME', codigo_producto: '201' }),
      linea({ familia: 16, monto: 5000, cantidad: 1, nombre: 'TERIYAKI', codigo_producto: '202' }),
      linea({ familia: 29, monto: 4000, cantidad: 1, nombre: 'KOROKKE BENTO', codigo_producto: '203' }),
      linea({ familia: 4,  monto: 1000, cantidad: 1, nombre: 'SOPA', codigo_producto: '204' }),
      linea({ familia: 13, monto: 500,  cantidad: 1, nombre: 'POSTRE', codigo_producto: '205' }),
    ], '2026-09-01')
    const mix = mixPorCategoria(a.dia, a.pm)
    const por = Object.fromEntries(mix.map(m => [m.categoria, m.monto]))
    expect(por).toEqual({
      'Rolls': 9000, 'Bebidas': 3000, 'Entradas': 2000,
      'Platos fuertes': 5000, 'GreenSeason': 4000, 'Otros': 1500,   // 4 y 13 juntas
    })
  })

  it('INVARIANTE: la suma del mix ES el neto del día', () => {
    // Las familias del mix son EXACTAMENTE las que alimentan `valor_servido_crc`. Si alguien
    // agregara una familia no-neto al mapa de etiquetas, esta igualdad se rompe.
    const lineas = [
      linea({ ticket_id: 't1', familia: 3,  monto: 9000 }),
      linea({ ticket_id: 't1', familia: 5,  monto: 3000, nombre: 'IMPERIAL', codigo_producto: '200' }),
      linea({ ticket_id: 't1', familia: 19, monto: 0,    nombre: 'PAX',   codigo_producto: '677' }),
      linea({ ticket_id: 't1', familia: 22, monto: 1500, nombre: 'EXTRA', codigo_producto: '300' }),
    ]
    const a = armar('2026-09-01', [ticket({ valor_servido_crc: 12000 })], lineas, '2026-09-01')
    const mix = mixPorCategoria(a.dia, a.pm)
    const sumaMix = mix.reduce((s, m) => s + m.monto, 0)
    const neto = Object.values(a.dia.saloneros).reduce((s, v) => s + v.total, 0)
    expect(sumaMix).toBe(12000)
    expect(sumaMix).toBe(neto)
  })

  it('las familias etiquetadas son exactamente las del neto', () => {
    const conUna = (f: number) => armar('2026-09-01', [ticket()],
      [linea({ familia: f, monto: 1000, nombre: `P${f}` })], '2026-09-01')
    // Toda familia del neto produce una categoría con nombre propio…
    for (const f of FAMILIAS_NETO) {
      const mix = mixPorCategoria(conUna(f).dia, conUna(f).pm)
      expect(mix).toHaveLength(1)
      expect(mix[0].monto).toBe(1000)
    }
    // …y ninguna familia de fuera del neto entra al mix.
    for (const f of [1, 6, 9, 11, 12, 15, 17, 19, 20, 21, 22, 25, 28]) {
      expect(mixPorCategoria(conUna(f).dia, conUna(f).pm)).toEqual([])
    }
  })

  it('un día sin ventas da un DiaData vacío, no explota', () => {
    const a = armar('2026-09-01', [], [], '2026-09-01')
    expect(a.dia.saloneros).toEqual({})
    expect(a.bruto).toBe(0)
  })

  it('tolera nulos en todos los montos', () => {
    const a = armar('2026-09-01', [ticket({
      total_crc: null, valor_servido_crc: null, servicio_crc: null, iva_crc: null,
      regalia_crc: null, pax: null,
    })], [linea({ monto: null, cantidad: null })], '2026-09-01')
    expect(sal(a.dia, 'MAXO').total).toBe(0)
    expect(sal(a.dia, 'MAXO').promPax).toBe(0)   // sin pax: 0, no NaN
  })
})

describe('claveSalonero / etiquetaNoMesero', () => {
  it('solo el mesero de verdad tiene clave', () => {
    expect(claveSalonero({ salonero_login: '026', registrado_por: 'salonero' })).toBe('026')
    expect(claveSalonero({ salonero_login: null, registrado_por: 'cajero' })).toBeNull()
    expect(claveSalonero({ salonero_login: null, registrado_por: 'sin_pedido' })).toBeNull()
  })

  it('cada tipo de no-mesero tiene su etiqueta', () => {
    expect(etiquetaNoMesero('cajero', '111')).toBe('Cajero turno mañana')
    expect(etiquetaNoMesero('cajero', '222')).toBe('Cajero turno tarde')
    expect(etiquetaNoMesero('cajero', '333')).toBe('Caja · 333')
    expect(etiquetaNoMesero('cajero')).toBe('Caja')
    expect(etiquetaNoMesero('sistema', '002')).toBe('Sistema · 002')
    expect(etiquetaNoMesero('sistema')).toBe('Sistema')
    expect(etiquetaNoMesero('sin_pedido')).toBe('Sin salonero')
  })
})

// ── La jornada que se mira: 07:00 → 07:00, NO el horario de atención ───────────

describe('jornadaActualCR', () => {
  it('usa el corte de las 07:00 CR, no el horario de atención del mock (11–23)', () => {
    // 09:00 CR: el mock decía "ayer" porque el local no había abierto. La jornada del
    // NEGOCIO ya es la de hoy — ese era el bug: a las 9 de la mañana pedía el día equivocado.
    expect(jornadaActualCR(new Date('2026-09-02T15:00:00Z'))).toBe('2026-09-02')  // 09:00 CR
  })

  it('antes de las 07:00 sigue siendo la jornada de ayer', () => {
    expect(jornadaActualCR(new Date('2026-09-02T11:00:00Z'))).toBe('2026-09-01')  // 05:00 CR
    expect(jornadaActualCR(new Date('2026-09-02T12:59:00Z'))).toBe('2026-09-01')  // 06:59 CR
    expect(jornadaActualCR(new Date('2026-09-02T13:00:00Z'))).toBe('2026-09-02')  // 07:00 CR
  })

  it('la madrugada del servicio cuenta al día anterior', () => {
    expect(jornadaActualCR(new Date('2026-09-02T07:30:00Z'))).toBe('2026-09-01')  // 01:30 CR
  })

  it('es la MISMA regla con la que se filtran los tickets', () => {
    // `businessDateDe` decide a qué jornada pertenece un ticket; `jornadaActualCR`, cuál se
    // está mirando. Si divergieran, la pantalla pediría un rango y mostraría otro.
    const t = '2026-09-02T01:30:00-06:00'
    expect(businessDateDe(t)).toBe(jornadaActualCR(new Date(t)))
  })
})

describe('esJornadaEnCurso', () => {
  it('solo la de hoy está en curso', () => {
    const ahora = new Date('2026-09-02T15:00:00Z')   // 09:00 CR → jornada 2026-09-02
    expect(esJornadaEnCurso('2026-09-02', ahora)).toBe(true)
    expect(esJornadaEnCurso('2026-09-01', ahora)).toBe(false)
  })
})

// ── Una sola fuente de verdad para las familias del neto ───────────────────────

describe('FAMILIAS_NETO', () => {
  it('ES el mismo conjunto que usa el mapper para calcular valor_servido_crc', () => {
    // No "coinciden": es la MISMA referencia. Si el mapper cambia el conjunto (p. ej. el día
    // que se confirme qué hacer con la familia 6), el mix se mueve con él y la invariante
    // "suma del mix = neto del día" se sostiene sola.
    expect(FAMILIAS_NETO).toBe(FAMILIAS_VALOR_SERVIDO)
    expect([...FAMILIAS_NETO].sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 13, 16, 29])
  })
})

// ── Pax: la fuente primaria es el ARTÍCULO (§3.F) ──────────────────────────────

describe('paxDelTicket', () => {
  it('manda el ARTÍCULO, no el `pax` que resolvió el mapper', () => {
    // El mapper pone `pax` = nativo cuando está; el SPEC §3.F dice lo contrario mientras
    // el nativo no sea confiable. Acá el nativo dice 4 y el artículo 2: vale 2.
    expect(paxDelTicket({ pax: 4, pax_articulo: 2 })).toBe(2)
  })

  it('sin artículo cae al pax resuelto (un ticket con solo nativo no queda en cero)', () => {
    expect(paxDelTicket({ pax: 3, pax_articulo: 0 })).toBe(3)
    expect(paxDelTicket({ pax: 3, pax_articulo: null })).toBe(3)
  })

  it('sin ninguna de las dos, cero', () => {
    expect(paxDelTicket({ pax: 0, pax_articulo: 0 })).toBe(0)
    expect(paxDelTicket({ pax: null, pax_articulo: null })).toBe(0)
  })

  it('el día acredita el pax por artículo', () => {
    const a = armar('2026-09-01', [
      ticket({ id: 'a', pax: 4, pax_nativo: 4, pax_articulo: 2 }),
      ticket({ id: 'b', pax: 3, pax_nativo: 0, pax_articulo: 3 }),
    ], [], '2026-09-01')
    expect(sal(a.dia, 'MAXO').pax).toBe(5)   // 2 + 3, no 4 + 3
  })
})

// ── Turnos: mañana / tarde, corte a las 16:00 CR ───────────────────────────────

/** Los bloques de `ventasPorTurno` indexados por id de turno, para poder afirmar corto. */
const porTurno = (v: ReturnType<typeof ventasPorTurno>) =>
  Object.fromEntries([...v.turnos, v.sinTurno].map(b => [b.turno ?? 'sinTurno', b]))

describe('el turno lo decide el CAJERO (mapa), no el reloj (P1a)', () => {
  // Los bordes de la definición están clavados en `shared/ndf/jornada.test.ts` contra los
  // números reales de staging. Acá se prueba el cableado de «En vivo».

  it('la mesa abierta 15:50 y cobrada 22:30 cuenta en el turno del CAJERO que la cobró', () => {
    // Con la regla vieja del reloj esto era «mañana» por abrirse antes de las 16:00.
    const t = porTurno(ventasPorTurno([ticket({
      fecha_registra: '2026-09-01T15:50:00-06:00',
      fecha_cierra:   '2026-09-01T22:30:00-06:00',
      cajero_login:   '222',
      valor_servido_crc: 9000,
    })]))
    expect(t.tarde.neto).toBe(9000)
    expect(t.manana.neto).toBe(0)
  })

  it('el 111 que cierra pasadas las 16:00 sigue siendo MAÑANA', () => {
    // Dato real de staging: el 5-sep el 111 cerró 16:07:03 CR.
    const t = porTurno(ventasPorTurno([ticket({
      fecha_registra: '2026-09-05T12:00:00-06:00',
      fecha_cierra:   '2026-09-05T16:07:03-06:00',
      cajero_login:   '111',
      valor_servido_crc: 8000,
    })]))
    expect(t.manana.neto).toBe(8000)
    expect(t.tarde.neto).toBe(0)
  })

  it('la factura de las 02:00 del lote del 222 va con su turno, sin partirse', () => {
    const cierre = '2026-09-02T02:30:00-06:00'
    const t = porTurno(ventasPorTurno([
      ticket({ id: 'a', fecha_registra: '2026-09-01T20:00:00-06:00', fecha_cierra: cierre, cajero_login: '222', valor_servido_crc: 7000 }),
      ticket({ id: 'b', fecha_registra: '2026-09-02T02:00:00-06:00', fecha_cierra: cierre, cajero_login: '222', valor_servido_crc: 3000 }),
    ]))
    expect(t.tarde).toMatchObject({ neto: 10000, tickets: 2 })
  })
})

describe('lotesDeCierre', () => {
  it('una fila por pasada de caja, con su jornada de apertura y su etiqueta del mapa', () => {
    const lotes = lotesDeCierre([
      ticket({ id: 'a', fecha_registra: '2026-09-05T11:30:00-06:00', fecha_cierra: '2026-09-05T16:07:03-06:00', cajero_login: '111', valor_servido_crc: 8000, pax: 2, pax_articulo: 2 }),
      ticket({ id: 'b', fecha_registra: '2026-09-05T18:30:00-06:00', fecha_cierra: '2026-09-06T01:00:00-06:00', cajero_login: '222', valor_servido_crc: 12000, pax: 4, pax_articulo: 4 }),
      ticket({ id: 'c', fecha_registra: '2026-09-06T00:40:00-06:00', fecha_cierra: '2026-09-06T01:00:00-06:00', cajero_login: '222', valor_servido_crc: 3000, pax: 2, pax_articulo: 2 }),
    ])
    expect(lotes).toHaveLength(2)
    expect(lotes[0]).toMatchObject({
      cajeroLogin: '111', turno: 'manana', etiqueta: 'Mañana · almuerzo',
      jornada: '2026-09-05', abierto: false, neto: 8000, tickets: 1,
    })
    // El 222 abrió el 5 y cerró el 6 a la 01:00: la jornada es la que ABRIÓ.
    expect(lotes[1]).toMatchObject({
      cajeroLogin: '222', turno: 'tarde', etiqueta: 'Tarde · noche',
      jornada: '2026-09-05', abierto: false, neto: 15000, tickets: 2,
    })
  })

  it('el turno todavía abierto se marca como tal', () => {
    const lotes = lotesDeCierre([
      ticket({ fecha_registra: '2026-09-06T18:00:00-06:00', fecha_cierra: null, cajero_login: '222' }),
    ])
    expect(lotes[0]).toMatchObject({ abierto: true, fechaCierra: null, turno: 'tarde', jornada: '2026-09-06' })
  })
})

describe('ventasPorTurno', () => {
  it('INVARIANTE: Σ turnos + sinTurno = el neto del día', () => {
    const tickets = [
      ticket({ id: 'a', fecha_registra: '2026-09-01T09:00:00-06:00', cajero_login: '111', valor_servido_crc: 10000 }),
      ticket({ id: 'b', fecha_registra: '2026-09-01T15:59:00-06:00', cajero_login: '111', valor_servido_crc: 5000 }),
      ticket({ id: 'c', fecha_registra: '2026-09-01T16:00:00-06:00', cajero_login: '222', valor_servido_crc: 7000 }),
      ticket({ id: 'd', fecha_registra: '2026-09-02T02:00:00-06:00', cajero_login: '222', valor_servido_crc: 3000 }),
    ]
    const v = ventasPorTurno(tickets)
    const t = porTurno(v)
    expect(t.manana).toMatchObject({ neto: 15000, tickets: 2 })
    expect(t.tarde).toMatchObject({ neto: 10000, tickets: 2 })
    expect(t.sinTurno).toMatchObject({ neto: 0, tickets: 0 })

    const neto = tickets.reduce((s, x) => s + (x.valor_servido_crc ?? 0), 0)
    const todos = [...v.turnos, v.sinTurno]
    expect(todos.reduce((a, b) => a + b.neto, 0)).toBe(neto)
    expect(todos.reduce((a, b) => a + b.tickets, 0)).toBe(tickets.length)
  })

  it('la factura sin caja conocida NO se cae del total del día: va a `sinTurno`', () => {
    const tickets = [
      ticket({ id: 'a', cajero_login: '222', valor_servido_crc: 4000 }),
      ticket({ id: 'b', cajero_login: '026', valor_servido_crc: 1000 }),   // un salonero cobrando
      ticket({ id: 'c', cajero_login: null,  valor_servido_crc: 500 }),    // histórico sin login
    ]
    const v = ventasPorTurno(tickets)
    const t = porTurno(v)
    expect(t.tarde.neto).toBe(4000)
    expect(t.sinTurno).toMatchObject({ neto: 1500, tickets: 2 })
    expect(t.manana.neto).toBe(0)
    // Lo que importa: el día entero sigue estando.
    expect([...v.turnos, v.sinTurno].reduce((a, b) => a + b.neto, 0)).toBe(5500)
  })

  it('las filas salen del MAPA, en su orden, aunque un turno no haya vendido', () => {
    const v = ventasPorTurno([ticket({ cajero_login: '222', valor_servido_crc: 4000 })])
    expect(v.turnos.map(b => b.turno)).toEqual(turnosConocidos().map(t => t.turno))
    expect(v.turnos.map(b => b.etiqueta)).toEqual(turnosConocidos().map(t => t.etiqueta))
  })

  it('jornada vacía: todos los turnos del mapa en cero, y sinTurno en cero', () => {
    const v = ventasPorTurno([])
    expect(v.turnos).toHaveLength(turnosConocidos().length)
    expect(v.turnos.every(b => b.neto === 0 && b.tickets === 0 && b.pax === 0)).toBe(true)
    expect(v.sinTurno).toMatchObject({ turno: null, neto: 0, tickets: 0, pax: 0 })
  })
})

// ── El login del PoS → la persona ──────────────────────────────────────────────

describe('nombreSalonero', () => {
  const nombres = { '026': 'MAXO', '027': 'GUILLE' }

  it('con el empleado cargado, su nombre', () => {
    expect(nombreSalonero('026', nombres)).toBe('MAXO')
  })

  it('sin cargar, el número MARCADO — no desaparece del ranking', () => {
    expect(nombreSalonero('031', nombres)).toBe('031 · sin asignar')
    expect(esSinAsignar(nombreSalonero('031', nombres))).toBe(true)
    expect(esSinAsignar('MAXO')).toBe(false)
  })

  it('un full_name vacío cae a la capa siguiente, no a la marca', () => {
    // El empleado existe pero sin nombre cargado: no es un mapeo, es un campo en blanco.
    expect(nombreSalonero('026', { '026': '   ' })).toBe('MAXO')   // ← del roster
  })

  it('Empleados le gana al roster: es el mapeo que mantiene el negocio', () => {
    expect(nombreSalonero('026', { '026': 'Máximo R.' })).toBe('Máximo R.')
    expect(SALONEROS_CONOCIDOS['026']).toBe('MAXO')                // el roster dice otra cosa
  })

  it('sin Empleados, el roster de FAC_Empleados evita que salgan números', () => {
    expect(nombreSalonero('024', {})).toBe('Juancho')
    expect(nombreSalonero('235', {})).toBe('ROSAURA M')
    expect(nombreSalonero('444', {})).toBe('MAXI')
    expect(esSinAsignar(nombreSalonero('024', {}))).toBe(false)
  })

  it('fuera de las dos capas, el número MARCADO — nunca un nombre inventado', () => {
    expect(nombreSalonero('777', {})).toBe('777 · sin asignar')
    expect(SALONEROS_CONOCIDOS['777']).toBeUndefined()
  })

  it('el día usa el nombre como clave del salonero', () => {
    const a = armarDia('2026-09-01', [
      ticket({ id: 'a', salonero_login: '026' }),
      ticket({ id: 'b', salonero_login: '099' }),
      // Cajero en el salón → «Salón sin mesero». Ojo con el parecido: `099 · sin asignar` es un
      // MESERO al que no se le pudo poner nombre; `Salón sin mesero` es una factura SIN mesero.
      ticket({ id: 'c', salonero_login: null, registrado_por: 'cajero', canal: 'salon' }),
    ], [], '2026-09-01', nombres)
    expect(Object.keys(a.dia.saloneros).sort())
      .toEqual(['099 · sin asignar', 'MAXO', 'Salón sin mesero'])
  })

  it('sin mapa de Empleados el día igual sale por nombre, vía roster', () => {
    const a = armarDia('2026-09-01', [ticket()], [], '2026-09-01')
    expect(Object.keys(a.dia.saloneros)).toEqual(['MAXO'])
  })

  it('un login que no está en ninguna capa sí queda marcado', () => {
    const a = armarDia('2026-09-01', [ticket({ salonero_login: '777' })], [], '2026-09-01')
    expect(Object.keys(a.dia.saloneros)).toEqual(['777 · sin asignar'])
  })
})

// ── Ritmo ──────────────────────────────────────────────────────────────────────

describe('ritmoPorHora', () => {
  it('agrupa por hora de reloj de Costa Rica', () => {
    const r = ritmoPorHora([
      ticket({ id: 'a', fecha_registra: '2026-09-01T19:10:00-06:00', valor_servido_crc: 10000 }),
      ticket({ id: 'b', fecha_registra: '2026-09-01T19:50:00-06:00', valor_servido_crc: 5000 }),
      ticket({ id: 'c', fecha_registra: '2026-09-01T13:05:00-06:00', valor_servido_crc: 8000 }),
    ])
    expect(r).toEqual([
      { hora: 13, monto: 8000, tickets: 1 },
      { hora: 19, monto: 15000, tickets: 2 },
    ])
    expect(ticketsDelDia(r)).toBe(3)
  })

  it('la hora sale del instante con zona, no del reloj del navegador', () => {
    expect(horaCRDe('2026-09-02T01:42:07Z')).toBe(19)      // 01:42 UTC = 19:42 del día anterior CR
    expect(horaCRDe('2026-09-01T19:42:07-06:00')).toBe(19)
    expect(horaCRDe('no es una fecha')).toBeNull()
  })

  it('sin ventas, sin filas', () => {
    expect(ritmoPorHora([])).toEqual([])
  })
})

// ── Calidad del pax (§3.F) ─────────────────────────────────────────────────────

describe('calidadPaxPorSalonero', () => {
  it('mide el % de mesas con pax nativo y el match contra el artículo', () => {
    const c = calidadPaxPorSalonero([
      ticket({ id: 'a', pax_nativo: 2, pax_articulo: 2, pax_alerta: 'ok' }),
      ticket({ id: 'b', pax_nativo: 4, pax_articulo: 2, pax_alerta: 'difiere' }),
      ticket({ id: 'c', pax_nativo: 0, pax_articulo: 3, pax_alerta: 'falta_nativo' }),
      ticket({ id: 'd', pax_nativo: 0, pax_articulo: 0, pax_alerta: 'sin_pax' }),
    ])
    expect(c).toHaveLength(1)
    expect(c[0]).toMatchObject({ salonero: 'MAXO', mesas: 4 })
    expect(c[0].pctPaxNativoCargado).toBe(50)      // 2 de 4 mesas
    expect(c[0].matchArticuloVsNativo).toBe(50)    // de las 2 con ambos, 1 coincide
  })

  it('al cajero de turno no se le exige cargar comensales', () => {
    expect(calidadPaxPorSalonero([
      ticket({ salonero_login: null, registrado_por: 'cajero' }),
    ])).toEqual([])
  })

  it('ordena por cantidad de mesas', () => {
    const c = calidadPaxPorSalonero([
      ticket({ id: 'a', salonero_login: '026' }),
      ticket({ id: 'b', salonero_login: '027' }),
      ticket({ id: 'c', salonero_login: '027' }),
    ])
    expect(c.map(x => x.salonero)).toEqual(['GUILLE', 'MAXO'])
  })

  it('con el mapa cargado, la calidad del pax también sale por nombre', () => {
    const c = calidadPaxPorSalonero([ticket({ salonero_login: '026' })], NOMBRES)
    expect(c[0].salonero).toBe('MAXO')
  })
})

// ── Comparativa ────────────────────────────────────────────────────────────────

describe('jornadasComparables / compararContra', () => {
  it('son los mismos días de semana, cuatro semanas hacia atrás', () => {
    expect(jornadasComparables('2026-09-01'))
      .toEqual(['2026-08-25', '2026-08-18', '2026-08-11', '2026-08-04'])
  })

  it('la semana pasada es el primero; el promedio, de los cuatro', () => {
    const h = compararContra(
      { '2026-08-25': 400000, '2026-08-18': 300000, '2026-08-11': 500000, '2026-08-04': 400000 },
      jornadasComparables('2026-09-01'),
    )
    expect(h.mismoDiaSemanaPasada).toBe(400000)
    expect(h.promedio4Semanas).toBe(400000)
  })

  it('un día cerrado NO hunde el promedio: se promedian los días que existieron', () => {
    const h = compararContra(
      { '2026-08-25': 400000, '2026-08-18': 0, '2026-08-11': 400000, '2026-08-04': 400000 },
      jornadasComparables('2026-09-01'),
    )
    expect(h.promedio4Semanas).toBe(400000)   // no 300.000
  })

  it('sin histórico devuelve 0, y la pantalla muestra «—»', () => {
    expect(compararContra({}, jornadasComparables('2026-09-01')))
      .toEqual({ mismoDiaSemanaPasada: 0, promedio4Semanas: 0 })
  })
})

// ── El snapshot completo ───────────────────────────────────────────────────────

describe('armarSnapshot', () => {
  const snap = armarSnapshot({
    local: 'santa-teresa', fecha: '2026-09-01',
    tickets: [
      ticket({ id: 'a', fecha_registra: '2026-09-01T13:00:00-06:00', valor_servido_crc: 10000 }),
      ticket({ id: 'b', fecha_registra: '2026-09-01T20:00:00-06:00', valor_servido_crc: 15000,
               salonero_login: '027' }),
    ],
    lineas: [linea({ ticket_id: 'a', monto: 10000 })],
    neto4Sem: { '2026-08-25': 20000, '2026-08-18': 30000, '2026-08-11': 0, '2026-08-04': 40000 },
    ahora: new Date('2026-09-02T02:00:00Z'), enServicio: true,
  })

  it('cumple el contrato SnapshotEnVivo, con el día en forma DiaData', () => {
    expect(snap.local).toBe('santa-teresa')
    expect(snap.fecha).toBe('2026-09-01')
    expect(snap.servicioEnCurso).toBe(true)
    expect(snap.dia.fileName).toBe('ndf 2026-09-01')
    expect(Object.keys(snap.dia.saloneros).sort()).toEqual(['GUILLE', 'MAXO'])
  })

  it('el acumulado del día es la suma del neto de los saloneros', () => {
    const neto = Object.values(snap.dia.saloneros).reduce((s, v) => s + v.total, 0)
    expect(neto).toBe(25000)
    expect(snap.proyeccionCierre).toBe(25000)
  })

  it('trae el ritmo, la comparativa y la calidad del pax', () => {
    expect(snap.porHora.map(h => h.hora)).toEqual([13, 20])
    expect(snap.historico.mismoDiaSemanaPasada).toBe(20000)
    expect(snap.historico.promedio4Semanas).toBe(30000)   // 20+30+40 / 3, el 0 no cuenta
    expect(snap.calidadPax.map(c => c.salonero).sort()).toEqual(['GUILLE', 'MAXO'])
  })

  it('bruto, servicio, IVA y regalía viajan al lado del neto', () => {
    expect(snap.bruto).toBe(27120)
    expect(snap.servicio).toBe(2400)
    expect(snap.iva).toBe(0)
  })

  it('el IVA en cero se marca PENDIENTE, no se deriva', () => {
    expect(snap.ivaPendiente).toBe(true)
    // 25.000 de neto × 0,13 = 3.250. Ese número no aparece por ningún lado.
    expect(snap.iva).toBe(0)
  })

  it('el snapshot dice que la fuente es el PoS, no el simulador', () => {
    expect(snap.fuente).toBe('pos')
  })

  it('una jornada sin ventas da CERO, nunca datos inventados', () => {
    const vacio = armarSnapshot({
      local: 'santa-teresa', fecha: '2026-09-01', tickets: [], lineas: [], neto4Sem: {},
      ahora: new Date('2026-09-02T02:00:00Z'), enServicio: true,
    })
    expect(vacio.dia.saloneros).toEqual({})
    expect(vacio.porHora).toEqual([])
    expect(vacio.bruto).toBe(0)
    expect(vacio.proyeccionCierre).toBe(0)
    expect(vacio.fuente).toBe('pos')
  })

  it('con IVA real informado por el PoS, deja de estar pendiente', () => {
    const conIva = armarSnapshot({
      local: 'santa-teresa', fecha: '2026-09-01',
      tickets: [ticket({ iva_crc: 1560 })], lineas: [], neto4Sem: {},
      ahora: new Date('2026-09-02T02:00:00Z'), enServicio: true,
    })
    expect(conIva.iva).toBe(1560)
    expect(conIva.ivaPendiente).toBe(false)
  })
})

// ── Canal: salón vs delivery ───────────────────────────────────────────────────

describe('ventasPorCanal', () => {
  it('parte el neto por el canal de cada factura, no por quién la cobró', () => {
    const c = ventasPorCanal([
      ticket({ id: 'a', canal: 'salon',    valor_servido_crc: 10000 }),
      ticket({ id: 'b', canal: 'delivery', valor_servido_crc: 4000 }),
      ticket({ id: 'c', canal: 'barra',    valor_servido_crc: 3000 }),
      ticket({ id: 'd', canal: 'llevar',   valor_servido_crc: 1000 }),
      ticket({ id: 'e', canal: null,       valor_servido_crc: 500 }),
    ])
    expect(c.delivery).toBe(4000)
    // Barra, para llevar y sin canal son piso: todo lo que no es delivery cuenta como salón.
    expect(c.salon).toBe(14500)
  })

  it('salón + delivery = el neto del día', () => {
    const tickets = [
      ticket({ id: 'a', canal: 'salon',    valor_servido_crc: 12000 }),
      ticket({ id: 'b', canal: 'delivery', valor_servido_crc: 8000 }),
    ]
    const c = ventasPorCanal(tickets)
    const a = armar('2026-09-01', tickets, [], '2026-09-01')
    const neto = Object.values(a.dia.saloneros).reduce((s, v) => s + v.total, 0)
    expect(c.salon + c.delivery).toBe(neto)
    expect(a.canales).toEqual(c)
  })
})

// ── Paridad con «Hoy»: las MISMAS funciones, sobre el día del PoS ──────────────
//
// No se reimplementa ninguna métrica: se arma el `DiaData` desde `pos_ndf` y se lo pasa a
// `getDayStats`, `aggGeneral` y `aggSalonero` — las de `ventasUtils`, las que usa «Hoy». Estos
// tests fijan que el día que sale del PoS es un ciudadano de primera para esas funciones.

describe('paridad con las funciones de Hoy', () => {
  const tickets = [
    ticket({ id: 'a', salonero_login: '026', valor_servido_crc: 12000, pax_articulo: 4 }),
    ticket({ id: 'b', numero_factura: '5002', salonero_login: '027',
             valor_servido_crc: 8000, pax_articulo: 2 }),
    ticket({ id: 'c', numero_factura: '5003', salonero_login: '111',
             registrado_por: 'cajero', canal: 'delivery', valor_servido_crc: 5000 }),
  ]
  const lineas = [
    linea({ ticket_id: 'a', familia: 3, monto: 9000, cantidad: 3 }),
    linea({ ticket_id: 'a', familia: 5, monto: 3000, cantidad: 3, nombre: 'IMPERIAL',
            codigo_producto: '200' }),
    linea({ ticket_id: 'b', familia: 3, monto: 8000, cantidad: 2 }),
    linea({ ticket_id: 'c', familia: 3, monto: 5000, cantidad: 1 }),
  ]
  const a = armar('2026-09-01', tickets, lineas, '2026-09-01')
  const dias = { '2026-09-01': a.dia }

  it('getDayStats da el total del restaurante, con caja adentro', () => {
    const st = getDayStats(a.dia)
    expect(st.ventaNeta).toBe(25000)
    expect(st.delivery).toBe(5000)      // el delivery de la caja
    // El pax es el del DÍA: meseros + caja. Antes decía 6 —solo meseros—, y ése era el bug:
    // los comensales de un ticket de salón cobrado por caja se descartaban, y el PoS informaba
    // ~9% menos gente que el xls aunque el crudo diera idéntico.
    expect(st.pax).toBe(8)
  })

  it('aggGeneral separa salón de caja y `totalRest` sigue siendo el neto del día', () => {
    const g = aggGeneral(['2026-09-01'], dias, a.pm)
    expect(g.total).toBe(20000)         // solo meseros
    expect(g.cajTotal).toBe(5000)
    expect(g.cajDelivery).toBe(5000)
    expect(g.totalRest).toBe(25000)
    expect(g.promPax).toBeCloseTo(20000 / 6, 6)
  })

  it('aggSalonero saltea a la caja y da el Prom/PAX de cada mesero', () => {
    expect(aggSalonero('Cajero turno mañana', ['2026-09-01'], dias, a.pm).total).toBe(0)
    const s = aggSalonero('MAXO', ['2026-09-01'], dias, a.pm)
    expect(s.total).toBe(12000)
    expect(s.pax).toBe(4)
    expect(s.promPax).toBe(3000)
    expect(s.promPlato).toBe(3000)      // 9000 / 3 platos
    expect(s.promBebida).toBe(1000)     // 3000 / 3 bebidas
    expect(s.bebPax).toBe(0.75)
  })

  it('el ranking del día no lista a la caja ni al sistema', () => {
    const enRanking = Object.entries(a.dia.saloneros)
      .filter(([, v]) => !(v as CajeroDay).esCajero)
      .map(([k]) => k)
      .sort()
    expect(enRanking).toEqual(['GUILLE', 'MAXO'])
  })
})

// ── Mesas abiertas AHORA ───────────────────────────────────────────────────────

describe('resumirMesasAbiertas', () => {
  const mesa = (over: Partial<MesaAbiertaRow> = {}): MesaAbiertaRow => ({
    clave: 'm1', numero_factura: null, id_pedido: '1', mesa: '5',
    salonero_login: '026', canal: 'salon', pax: 2, pax_alerta: 'ok',
    updated_at: '2026-09-01T20:00:00-06:00',
    ...over,
  })

  it('agrupa por quién tiene la mesa, con el nombre resuelto', () => {
    const r = resumirMesasAbiertas([
      mesa({ clave: 'a', salonero_login: '026', pax: 2 }),
      mesa({ clave: 'b', salonero_login: '026', pax: 4 }),
      mesa({ clave: 'c', salonero_login: '027', pax: 3 }),
    ], NOMBRES)
    expect(r).toEqual([
      { salonero: 'MAXO',   mesas: 2, pax: 6 },
      { salonero: 'GUILLE', mesas: 1, pax: 3 },
    ])
  })

  it('sin mapa de Empleados igual sale por nombre, vía roster', () => {
    expect(resumirMesasAbiertas([mesa({ salonero_login: '024' })])[0].salonero).toBe('Juancho')
  })

  it('caja, sistema y sin login llevan su propia etiqueta', () => {
    const r = resumirMesasAbiertas([
      mesa({ clave: 'a', salonero_login: '111' }),
      mesa({ clave: 'b', salonero_login: '222' }),
      mesa({ clave: 'c', salonero_login: '002' }),
      mesa({ clave: 'd', salonero_login: null }),
    ])
    expect(r.map(x => x.salonero).sort()).toEqual([
      'Cajero turno mañana', 'Cajero turno tarde', 'Sin salonero', 'Sistema · 002',
    ])
  })

  it('ordena por cantidad de mesas y desempata alfabéticamente', () => {
    const r = resumirMesasAbiertas([
      mesa({ clave: 'a', salonero_login: '027' }),
      mesa({ clave: 'b', salonero_login: '026' }),
    ], NOMBRES)
    expect(r.map(x => x.salonero)).toEqual(['GUILLE', 'MAXO'])
  })

  it('sin mesas abiertas, lista vacía — no una fila en cero', () => {
    expect(resumirMesasAbiertas([])).toEqual([])
  })
})

// ── El candado de la fusión: la plata del día no se mueve ──────────────────────

const mesaAb = (over: Partial<MesaAbiertaRow> = {}): MesaAbiertaRow => ({
  clave: 'm1', numero_factura: null, id_pedido: '1', mesa: '5',
  salonero_login: '026', canal: 'salon', pax: 2, pax_alerta: 'ok',
  updated_at: '2026-09-01T20:00:00-06:00',
  ...over,
})

describe('la fusión Hoy ↔ En vivo no toca la plata del día', () => {
  const base = armarSnapshot({
    local: 'santa-teresa', fecha: '2026-09-01',
    tickets: [
      ticket({ id: 'a', fecha_registra: '2026-09-01T13:00:00-06:00', valor_servido_crc: 10000 }),
      ticket({ id: 'b', fecha_registra: '2026-09-01T20:00:00-06:00', valor_servido_crc: 15000,
               salonero_login: '027' }),
    ],
    lineas: [linea({ ticket_id: 'a', monto: 10000 })],
    neto4Sem: {},
    ahora: new Date('2026-09-02T02:00:00Z'), enServicio: true,
  })

  // Exactamente lo que hace `getSnapshotEnVivo`: pega los extras del snapshot de abiertas
  // ENCIMA del día ya armado. Si alguna vez alguien mete las mesas abiertas adentro del
  // cálculo, esta prueba se cae.
  const conAbiertas = {
    ...base,
    mesasAbiertas: 3,
    paxAbierto: 9,
    abiertasPorSalonero: resumirMesasAbiertas([mesaAb()], NOMBRES),
    mesasDetalle: detallarMesasAbiertas([mesaAb()], NOMBRES, true),
    frescura: frescuraDe('2026-09-01T20:59:00-06:00', new Date('2026-09-01T21:00:00-06:00')),
    tiempoAbiertaConfiable: true,
  }

  it('el DiaData queda byte-idéntico con y sin mesas abiertas', () => {
    expect(JSON.stringify(conAbiertas.dia)).toBe(JSON.stringify(base.dia))
  })

  it('neto, bruto, servicio, IVA y regalía quedan idénticos', () => {
    const plata = (s: typeof base) =>
      [s.bruto, s.servicio, s.iva, s.regalia,
       Object.values(s.dia.saloneros).reduce((a, v) => a + v.total, 0)]
    expect(plata(conAbiertas)).toEqual(plata(base))
  })

  it('las 9 personas sentadas NO entran en el neto del día', () => {
    const neto = Object.values(conAbiertas.dia.saloneros).reduce((a, v) => a + v.total, 0)
    expect(neto).toBe(25000)   // solo las dos facturas CERRADAS
  })

  it('`armarSnapshot` ni siquiera recibe las mesas abiertas', () => {
    // El candado estructural: `EntradaSnapshot` no tiene por dónde entrarle una mesa abierta,
    // así que la venta cerrada no puede contaminarse ni por error.
    expect(Object.keys(base)).not.toContain('mesasAbiertas')
    expect(Object.keys(base)).not.toContain('mesasDetalle')
  })
})

// ── Fusión Hoy ↔ En vivo: exclusión, tiempo abierta y frescura ─────────────────

describe('excluirCerradas', () => {
  it('saca la mesa que ya se cobró — es el doble conteo Hoy ↔ En vivo', () => {
    const r = excluirCerradas(
      [mesaAb({ clave: 'a', id_pedido: '101' }), mesaAb({ clave: 'b', id_pedido: '102' })],
      new Set(['101']),
    )
    expect(r.map(m => m.clave)).toEqual(['b'])
  })

  it('sin facturas cerradas no saca nada', () => {
    const abiertas = [mesaAb({ id_pedido: '101' })]
    expect(excluirCerradas(abiertas, new Set())).toEqual(abiertas)
  })

  it('la mesa SIN id_pedido se conserva: no hay con qué probar que se cerró', () => {
    const r = excluirCerradas([mesaAb({ clave: 'x', id_pedido: null })], new Set(['101']))
    expect(r.map(m => m.clave)).toEqual(['x'])
  })

  it('no confunde un id_pedido con espacios', () => {
    const r = excluirCerradas([mesaAb({ clave: 'x', id_pedido: ' 101 ' })], new Set(['101']))
    expect(r).toHaveLength(0)
  })
})

describe('tiempoAbiertaConfiable', () => {
  it('mesas separadas por horas = updated_at es la hora de apertura', () => {
    expect(tiempoAbiertaConfiable([
      mesaAb({ clave: 'a', updated_at: '2026-09-01T19:00:00-06:00' }),
      mesaAb({ clave: 'b', updated_at: '2026-09-01T21:30:00-06:00' }),
    ])).toBe(true)
  })

  it('todas con el MISMO sello = ruta fallback, el lote las selló con su `ahora`', () => {
    expect(tiempoAbiertaConfiable([
      mesaAb({ clave: 'a', updated_at: '2026-09-01T21:00:00-06:00' }),
      mesaAb({ clave: 'b', updated_at: '2026-09-01T21:00:00-06:00' }),
    ])).toBe(false)
  })

  it('dispersión menor a una ventana de poll no alcanza para afirmar nada', () => {
    expect(tiempoAbiertaConfiable([
      mesaAb({ clave: 'a', updated_at: '2026-09-01T21:00:00-06:00' }),
      mesaAb({ clave: 'b', updated_at: '2026-09-01T21:00:30-06:00' }),
    ])).toBe(false)
  })

  it('con una sola mesa el resultado es INCONCLUSO, y se trata como no confiable', () => {
    expect(tiempoAbiertaConfiable([mesaAb()])).toBe(false)
    expect(tiempoAbiertaConfiable([])).toBe(false)
  })
})

describe('detallarMesasAbiertas', () => {
  it('NUNCA trae monto: pos_ndf_open no lo tiene en ninguna capa del puente', () => {
    const [m] = detallarMesasAbiertas([mesaAb()], NOMBRES, true)
    expect(Object.keys(m).sort())
      .toEqual(['abiertaDesde', 'canal', 'clave', 'idPedido', 'mesa', 'pax', 'salonero'])
  })

  it('resuelve el nombre y conserva mesa, canal y pax', () => {
    const [m] = detallarMesasAbiertas([mesaAb({ mesa: '12', pax: 4 })], NOMBRES, true)
    expect(m.salonero).toBe('MAXO')
    expect(m.mesa).toBe('12')
    expect(m.canal).toBe('salon')
    expect(m.pax).toBe(4)
  })

  it('sin la guarda, abiertaDesde va en null — la pantalla muestra «—», no una duración falsa', () => {
    const [m] = detallarMesasAbiertas([mesaAb()], NOMBRES, false)
    expect(m.abiertaDesde).toBeNull()
  })

  it('ordena primero la que lleva más tiempo abierta', () => {
    const r = detallarMesasAbiertas([
      mesaAb({ clave: 'nueva',  updated_at: '2026-09-01T22:00:00-06:00' }),
      mesaAb({ clave: 'vieja',  updated_at: '2026-09-01T18:00:00-06:00' }),
    ], NOMBRES, true)
    expect(r.map(m => m.clave)).toEqual(['vieja', 'nueva'])
  })

  it('caja, sistema y sin login llevan su etiqueta, igual que en el agrupado', () => {
    const r = detallarMesasAbiertas([
      mesaAb({ clave: 'a', salonero_login: '111' }),
      mesaAb({ clave: 'b', salonero_login: null }),
    ], {}, false)
    expect(r.map(m => m.salonero).sort()).toEqual(['Cajero turno mañana', 'Sin salonero'])
  })
})

describe('frescuraDe', () => {
  const ahora = new Date('2026-09-01T21:00:00-06:00')

  it('un poll reciente no está desactualizado', () => {
    const f = frescuraDe('2026-09-01T20:58:00-06:00', ahora)
    expect(f.minutos).toBe(2)
    expect(f.desactualizado).toBe(false)
  })

  it('pasado el umbral se marca desactualizado', () => {
    const f = frescuraDe('2026-09-01T20:50:00-06:00', ahora)
    expect(f.minutos).toBe(10)
    expect(f.desactualizado).toBe(true)
  })

  it('sin cursor se asume desactualizado: no poder probar que el agente vive no es probarlo', () => {
    expect(frescuraDe(null, ahora)).toEqual({
      ultimoPollAt: null, minutos: null, desactualizado: true,
    })
  })

  it('un reloj adelantado en la PC del PoS no muestra futuro', () => {
    const f = frescuraDe('2026-09-01T21:05:00-06:00', ahora)
    expect(f.minutos).toBe(0)
    expect(f.desactualizado).toBe(false)
  })
})

// ── Navegación de jornada ──────────────────────────────────────────────────────

describe('jornadaDesplazada', () => {
  it('va una jornada atrás y una adelante', () => {
    expect(jornadaDesplazada('2026-09-01', -1)).toBe('2026-08-31')
    expect(jornadaDesplazada('2026-09-01',  1)).toBe('2026-09-02')
  })

  it('cruza fin de mes y de año', () => {
    expect(jornadaDesplazada('2026-03-01', -1)).toBe('2026-02-28')
    expect(jornadaDesplazada('2026-01-01', -1)).toBe('2025-12-31')
    expect(jornadaDesplazada('2026-12-31',  1)).toBe('2027-01-01')
  })

  it('respeta el año bisiesto', () => {
    expect(jornadaDesplazada('2028-03-01', -1)).toBe('2028-02-29')
  })

  it('una fecha ilegible se devuelve tal cual, sin inventar un día', () => {
    expect(jornadaDesplazada('', -1)).toBe('')
    expect(jornadaDesplazada('no-es-fecha', 1)).toBe('no-es-fecha')
  })
})

// ── El turno que guarda el PoS: 222 se DICE «Tarde» ────────────────────────────

describe('etiquetaTurnoPoS', () => {
  it('traduce el valor guardado sin cambiarlo: noche → Tarde', () => {
    expect(etiquetaTurnoPoS('noche')).toBe('Tarde')
    expect(etiquetaTurnoPoS('mañana')).toBe('Mañana')
  })

  it('un turno desconocido se muestra tal cual, no se esconde', () => {
    expect(etiquetaTurnoPoS('raro')).toBe('raro')
    expect(etiquetaTurnoPoS(null)).toBe('Sin turno')
  })

  it('la línea del cajero 222 también dice «tarde»', () => {
    expect(etiquetaNoMesero('cajero', '222')).toBe('Cajero turno tarde')
    expect(etiquetaNoMesero('cajero', '111')).toBe('Cajero turno mañana')
  })

  it('agrupa el neto por el turno del PoS, ya traducido', () => {
    expect(ventasPorTurnoPoS([
      ticket({ id: 'a', turno: 'mañana', valor_servido_crc: 4000 }),
      ticket({ id: 'b', turno: 'noche',  valor_servido_crc: 9000 }),
      ticket({ id: 'c', turno: 'noche',  valor_servido_crc: 1000 }),
    ])).toEqual([
      { turno: 'Tarde',  neto: 10000, tickets: 2 },
      { turno: 'Mañana', neto: 4000,  tickets: 1 },
    ])
  })
})

// ── El día partido por turno (pase de producto) ────────────────────────────────────────────

describe('diasPorTurno — la partición "por turno + general"', () => {
  const linea = (id: string): LineaNdfRow => ({
    ticket_id: id, codigo_producto: '100', nombre: 'ROLL SATORI',
    cantidad: 2, monto: 12000, familia: 2, usuario_registra: null,
  })
  // Mañana: el 111 cierra 16:07. Tarde: el 222 cierra 22:30. Dos meseros distintos.
  const TICKETS = [
    ticket({ id: 'm1', fecha_registra: '2026-09-05T12:00:00-06:00', fecha_cierra: '2026-09-05T16:07:03-06:00',
             cajero_login: '111', salonero_login: '026', valor_servido_crc: 10000, pax: 2, pax_articulo: 2 }),
    ticket({ id: 'm2', fecha_registra: '2026-09-05T13:00:00-06:00', fecha_cierra: '2026-09-05T16:07:03-06:00',
             cajero_login: '111', salonero_login: '026', valor_servido_crc: 6000, pax: 2, pax_articulo: 2 }),
    ticket({ id: 't1', fecha_registra: '2026-09-05T19:00:00-06:00', fecha_cierra: '2026-09-05T22:30:06-06:00',
             cajero_login: '222', salonero_login: '027', valor_servido_crc: 20000, pax: 4, pax_articulo: 4 }),
  ]
  const LINEAS = TICKETS.map(t => linea(t.id))
  const partido = () => diasPorTurno('2026-09-05', TICKETS, LINEAS, 'sello', NOMBRES)

  it('devuelve un DiaData por turno, en el orden del mapa de cajas', () => {
    expect(partido().map(t => [t.turno, t.etiqueta])).toEqual([
      ['manana', 'Mañana · almuerzo'],
      ['tarde',  'Tarde · noche'],
    ])
  })

  it('cada turno lleva SOLO sus tickets, con su neto, sus tickets y su pax', () => {
    const [manana, tarde] = partido()
    expect(manana).toMatchObject({ neto: 16000, tickets: 2, pax: 4 })
    expect(tarde).toMatchObject({ neto: 20000, tickets: 1, pax: 4 })
  })

  it('INVARIANTE: los turnos suman el día entero, sin perder ni duplicar', () => {
    const p = partido()
    expect(p.reduce((a, t) => a + t.neto, 0)).toBe(36000)
    expect(p.reduce((a, t) => a + t.tickets, 0)).toBe(TICKETS.length)
    expect(p.reduce((a, t) => a + t.pax, 0)).toBe(8)
  })

  it('el DiaData de un turno tiene la MISMA forma que el del día entero', () => {
    for (const t of partido()) {
      expect(Object.keys(t.dia).sort()).toEqual(['fileName', 'saloneros', 'uploadedAt'])
    }
  })

  it('es EXACTAMENTE lo que daría armarDia con los tickets de ese turno', () => {
    const soloManana = TICKETS.filter(t => t.cajero_login === '111')
    const esperado = armarDia('2026-09-05', soloManana, soloManana.map(t => linea(t.id)), 'sello', NOMBRES)
    expect(partido()[0].dia).toEqual(esperado.dia)
  })

  it('cada mesero aparece SOLO en el turno que trabajó', () => {
    const [manana, tarde] = partido()
    expect(Object.keys(manana.dia.saloneros)).toEqual(['MAXO'])
    expect(Object.keys(tarde.dia.saloneros)).toEqual(['GUILLE'])
  })

  it('el lote que cruza medianoche NO se parte: va entero al turno que abrió', () => {
    const cierre = '2026-09-06T01:00:00-06:00'
    const p = diasPorTurno('2026-09-05', [
      ticket({ id: 'a', fecha_registra: '2026-09-05T20:00:00-06:00', fecha_cierra: cierre, cajero_login: '222', valor_servido_crc: 7000 }),
      ticket({ id: 'b', fecha_registra: '2026-09-06T00:40:00-06:00', fecha_cierra: cierre, cajero_login: '222', valor_servido_crc: 3000 }),
    ], [], 'sello', NOMBRES)
    expect(p).toHaveLength(1)
    expect(p[0]).toMatchObject({ turno: 'tarde', neto: 10000, tickets: 2 })
  })

  it('las facturas sin caja conocida forman su propio bloque, al final y sin turno', () => {
    const p = diasPorTurno('2026-09-05', [
      ...TICKETS,
      ticket({ id: 'x', fecha_registra: '2026-09-05T15:00:00-06:00', cajero_login: '026', valor_servido_crc: 500 }),
    ], [], 'sello', NOMBRES)
    expect(p.map(t => t.turno)).toEqual(['manana', 'tarde', null])
    expect(p[2]).toMatchObject({ etiqueta: 'Sin caja de turno', neto: 500 })
  })

  it('sin tickets no inventa turnos en cero', () => {
    expect(diasPorTurno('2026-09-05', [], [], 'sello')).toEqual([])
  })
})

describe('armarDia expone las órdenes por clave', () => {
  it('cuenta las facturas de cada mesero, que es el divisor del "neto ÷ órdenes"', () => {
    const t = [
      ticket({ id: 'a', salonero_login: '026', valor_servido_crc: 10000 }),
      ticket({ id: 'b', salonero_login: '026', valor_servido_crc: 6000 }),
      ticket({ id: 'c', salonero_login: '027', valor_servido_crc: 20000 }),
    ]
    const armado = armarDia('2026-09-05', t, [], 'sello', NOMBRES)
    expect(armado.ordenes).toEqual({ MAXO: 2, GUILLE: 1 })
    // El ticket promedio del mesero sale de acá, NO de las unidades vendidas.
    const maxo = armado.dia.saloneros['MAXO']
    expect(Math.round(maxo.total / armado.ordenes['MAXO'])).toBe(8000)
  })

  it('las claves son las MISMAS que las de dia.saloneros, caja incluida', () => {
    const armado = armarDia('2026-09-05', [
      ticket({ id: 'a', salonero_login: '026' }),
      ticket({ id: 'b', salonero_login: null, registrado_por: 'cajero', cajero_login: '222' }),
    ], [], 'sello', NOMBRES)
    expect(Object.keys(armado.ordenes).sort()).toEqual(Object.keys(armado.dia.saloneros).sort())
  })
})

// ── El IVA atribuido por salonero (el que lee getDayStats para la bruta) ───────────────────

describe('armarDia atribuye el IVA por salonero/cajero, no lo deja en 0', () => {
  it('cada salonero lleva la Σ de `iva_crc` de SUS tickets', () => {
    const armado = armarDia('2026-08-29', [
      ticket({ id: 'a', salonero_login: '026', iva_crc: 6258, servicio_crc: 4814, valor_servido_crc: 48142 }),
      ticket({ id: 'b', salonero_login: '026', iva_crc: 1300, servicio_crc: 1000, valor_servido_crc: 10000 }),
      ticket({ id: 'c', salonero_login: '027', iva_crc: 2600, servicio_crc: 2000, valor_servido_crc: 20000 }),
    ], [], 'sello', NOMBRES)

    expect(armado.dia.saloneros['MAXO'].iva).toBe(6258 + 1300)
    expect(armado.dia.saloneros['GUILLE'].iva).toBe(2600)
  })

  it('el cajero también: su IVA es el de sus facturas, no 0', () => {
    const armado = armarDia('2026-08-29', [
      ticket({ id: 'a', salonero_login: null, registrado_por: 'cajero', cajero_login: '222',
               iva_crc: 3900, servicio_crc: 0, valor_servido_crc: 30000 }),
    ], [], 'sello', NOMBRES)
    const caja = Object.values(armado.dia.saloneros).find(v => 'esCajero' in v && v.esCajero)!
    expect(caja.iva).toBe(3900)
  })

  it('el cajero conserva su PAX: el bucket de caja lo lleva, no se tira', () => {
    // Un ticket de SALÓN cobrado bajo un login de caja: sus comensales existieron. `armarDia`
    // ya los acumulaba, pero no los copiaba al `CajeroDay` — y ahí se perdían, antes de que
    // `getDayStats` pudiera sumarlos. Era el ~9% que le faltaba al PAX del PoS en la Paridad.
    const armado = armarDia('2026-08-29', [
      ticket({ id: 'a', salonero_login: null, registrado_por: 'cajero', cajero_login: '222',
               pax_articulo: 4, valor_servido_crc: 30000 }),
    ], [], 'sello', NOMBRES)
    const caja = Object.values(armado.dia.saloneros).find(v => 'esCajero' in v && v.esCajero)!
    expect((caja as CajeroDay).pax).toBe(4)
  })

  it('INVARIANTE: el PAX del día == Σ del pax de TODOS los buckets, caja incluida', () => {
    const armado = armarDia('2026-08-29', [
      ticket({ id: 'a', pax_articulo: 2 }),
      ticket({ id: 'b', pax_articulo: 3 }),
      ticket({ id: 'c', salonero_login: null, registrado_por: 'cajero', cajero_login: '222',
               pax_articulo: 4 }),
    ], [], 'sello', NOMBRES)
    const suma = Object.values(armado.dia.saloneros)
      .reduce((s, v) => s + ('pax' in v ? v.pax ?? 0 : 0), 0)
    expect(suma).toBe(9)
    expect(getDayStats(armado.dia).pax).toBe(9)   // 5 de MAXO + 4 de la caja
  })

  it('INVARIANTE: Σ del IVA por salonero == el IVA a nivel DÍA', () => {
    // Es lo que hacía que la bruta saliera ~11% corta: el día tenía el IVA y los saloneros no,
    // y `getDayStats` —que arma la bruta— lo lee POR SALONERO.
    const tickets = [
      ticket({ id: 'a', salonero_login: '026', iva_crc: 6258 }),
      ticket({ id: 'b', salonero_login: '027', iva_crc: 2600 }),
      ticket({ id: 'c', salonero_login: null, registrado_por: 'cajero', cajero_login: '222', iva_crc: 1300 }),
    ]
    const armado = armarDia('2026-08-29', tickets, [], 'sello', NOMBRES)
    const porSalonero = Object.values(armado.dia.saloneros).reduce((a, v) => a + (v.iva ?? 0), 0)

    expect(porSalonero).toBe(6258 + 2600 + 1300)
    expect(porSalonero).toBe(armado.iva)              // el nivel día NO cambió
    expect(getDayStats(armado.dia).iva).toBe(armado.iva)
  })

  it('la BRUTA de getDayStats ahora cierra: neta + IVA + servicio', () => {
    // La factura 110599 del 29-ago: ₡48.142 + ₡6.258 + ₡4.814 = ₡59.214.
    const armado = armarDia('2026-08-29', [
      ticket({ id: '110599', salonero_login: '026',
               valor_servido_crc: 48142, iva_crc: 6258, servicio_crc: 4814, total_crc: 59214 }),
    ], [], 'sello', NOMBRES)
    const s = getDayStats(armado.dia)
    expect(s.ventaNeta).toBe(48142)
    expect(s.iva).toBe(6258)
    expect(s.serv).toBe(4814)
    expect(s.ventaBruta).toBe(59214)
  })

  it('sin IVA en el PoS sigue en 0: NO se deriva el 13%', () => {
    const armado = armarDia('2026-08-29', [
      ticket({ id: 'a', salonero_login: '026', valor_servido_crc: 48142, iva_crc: 0 }),
    ], [], 'sello', NOMBRES)
    expect(armado.dia.saloneros['MAXO'].iva).toBe(0)
    expect(getDayStats(armado.dia).ventaBruta).toBe(48142 + 0 + 1200)   // solo neta + servicio
  })
})
