// ── Cajeros por TURNO + «Salón sin mesero» — la regla firmada 2026-09-08 ────────────────────────
//
// ── QUÉ CAMBIA ─────────────────────────────────────────────────────────────────────────────
// El balde de una factura que no es de un mesero salía del LOGIN que aparecía en ella, así que
// abría una tarjeta por login: `Caja · 388`, `Sistema · 002`, `Sin salonero`. Eso partía la
// caja en pedazos que no significan nada para el negocio y escondía el turno, que es lo único
// que el dueño mira. Ahora el balde sale de (registrado_por, caja que cobró, canal):
//
//   CAJEROS      registrado_por = 'cajero' Y canal <> 'salon', partido por la CAJA QUE COBRÓ.
//                111 → Mañana · 222 → Tarde (etiqueta «Tarde», nunca «noche»). Cualquier otro
//                login cobrando cae en Mañana. NO se filtra por mesa.
//   SALÓN SIN MESERO  cajero + salón  ∪  sin_pedido + salón. Venta de salón sin mesero en la
//                factura. Va a Saloneros, fuera del ranking, y NO suma al Total Cajeros.
//   SISTEMA Y OTROS  todo el resto no-mesero. Aparte, también fuera del Total Cajeros.
//
// ── LO QUE NO CAMBIA ───────────────────────────────────────────────────────────────────────
// Esto REAGRUPA, no recalcula: la neta y el total del día dan exactamente lo mismo, y los
// cuatro baldes conservan la marca `esCajero` (que no se toca), así que `getDayStats` y
// `aggGeneral` siguen sumando igual. Fijado abajo.
import { describe, it, expect } from 'vitest'

import type { CajeroDay } from '../../shared/types/ventas'
import type { TicketNdfConId } from '../../shared/api/posNdf'
import {
  armarDia, claveNoMesero,
  CLAVE_CAJERO_MANANA, CLAVE_CAJERO_TARDE, CLAVE_SALON_SIN_MESERO, CLAVE_SISTEMA_OTROS,
  CLAVES_CAJERO_TURNO,
} from './ventasEnVivoDatos'
import { aggCajero, aggGeneral, getDayStats, allSaloneros } from './ventasUtils'
import { esSinAsignar } from './ventasEnVivoDatos'

const ticket = (over: Partial<TicketNdfConId> = {}): TicketNdfConId => ({
  id: 't1', numero_factura: '5001', fecha_registra: '2026-09-01T19:42:07-06:00',
  fecha_cierra: null, cajero_login: '222',
  canal: 'salon', mesa: null, salonero_login: '026', registrado_por: 'salonero', turno: 'noche',
  con_servicio: true, servicio_crc: 1200, total_crc: 13560, valor_servido_crc: 12000,
  iva_crc: 0, regalia_crc: 0, descuento_crc: 0, clase_ingreso: 'cobrada',
  pax: 2, pax_nativo: 2, pax_articulo: 2, pax_alerta: 'ok', ...over,
})


const armar = (tickets: TicketNdfConId[]) =>
  armarDia('2026-09-01', tickets, [], '2026-09-01', { '026': 'MAXO' })

const caj = (dia: { saloneros: Record<string, unknown> }, clave: string) =>
  dia.saloneros[clave] as CajeroDay | undefined

describe('claveNoMesero · la regla, sin datos alrededor', () => {
  it('cajero fuera del salón: 111 → Mañana, 222 → Tarde', () => {
    expect(claveNoMesero('cajero', '111', 'delivery')).toBe(CLAVE_CAJERO_MANANA)
    expect(claveNoMesero('cajero', '222', 'delivery')).toBe(CLAVE_CAJERO_TARDE)
  })

  it('la etiqueta del 222 dice «tarde», nunca «noche»', () => {
    expect(CLAVE_CAJERO_TARDE).toBe('Cajero turno tarde')
    expect(CLAVE_CAJERO_TARDE).not.toMatch(/noche/i)
  })

  it('cualquier otro login que cobre cae en Mañana (el 388 de barra, o ninguno)', () => {
    expect(claveNoMesero('cajero', '388',  'delivery')).toBe(CLAVE_CAJERO_MANANA)
    expect(claveNoMesero('cajero', null,   'delivery')).toBe(CLAVE_CAJERO_MANANA)
  })

  it('NO se filtra por mesa: barra, llevar y otro son cajeros igual', () => {
    for (const canal of ['barra', 'llevar', 'otro']) {
      expect(claveNoMesero('cajero', '222', canal)).toBe(CLAVE_CAJERO_TARDE)
    }
  })

  it('cajero + salón y sin_pedido + salón son «Salón sin mesero», un solo rótulo', () => {
    expect(claveNoMesero('cajero',     '111', 'salon')).toBe(CLAVE_SALON_SIN_MESERO)
    expect(claveNoMesero('sin_pedido', null,  'salon')).toBe(CLAVE_SALON_SIN_MESERO)
  })

  it('sistema y el sin_pedido de fuera del salón van al tercer balde', () => {
    expect(claveNoMesero('sistema',    '002', 'delivery')).toBe(CLAVE_SISTEMA_OTROS)
    expect(claveNoMesero('sistema',    '002', 'salon')).toBe(CLAVE_SISTEMA_OTROS)
    expect(claveNoMesero('sin_pedido', null,  'delivery')).toBe(CLAVE_SISTEMA_OTROS)
  })

  it('ya no existe ningún balde por login', () => {
    const claves = ['cajero', 'sistema', 'sin_pedido'].flatMap(r =>
      ['111', '222', '388', '002', null].flatMap(l =>
        ['salon', 'delivery', 'barra', 'otro'].map(c => claveNoMesero(r, l, c))))
    expect([...new Set(claves)].sort()).toEqual(
      [CLAVE_CAJERO_MANANA, CLAVE_CAJERO_TARDE, CLAVE_SALON_SIN_MESERO, CLAVE_SISTEMA_OTROS].sort(),
    )
    expect(claves.some(c => /^Caja · |^Sistema · |^Sin salonero$/.test(c))).toBe(false)
  })
})

// El día de prueba, con un ticket por cada caso de la regla.
const TICKETS = [
  // Meseros — el control: no los toca nada de esto.
  ticket({ id: 'm1', registrado_por: 'salonero', salonero_login: '026', canal: 'salon', valor_servido_crc: 200_000 }),
  // Cajeros por turno.
  ticket({ id: 'c1', registrado_por: 'cajero', salonero_login: null, cajero_login: '111', canal: 'delivery', valor_servido_crc: 30_000 }),
  ticket({ id: 'c2', registrado_por: 'cajero', salonero_login: null, cajero_login: '222', canal: 'delivery', valor_servido_crc: 50_000 }),
  // El 388 de barra: cae en Mañana.
  ticket({ id: 'c3', registrado_por: 'cajero', salonero_login: null, cajero_login: '388', canal: 'llevar',   valor_servido_crc:  4_000 }),
  // Salón sin mesero: los dos componentes.
  ticket({ id: 's1', registrado_por: 'cajero',     salonero_login: null, cajero_login: '111', canal: 'salon', valor_servido_crc: 15_000 }),
  ticket({ id: 's2', registrado_por: 'sin_pedido', salonero_login: null, cajero_login: '222', canal: 'salon', valor_servido_crc:  8_000 }),
  // Tercer balde.
  ticket({ id: 'o1', registrado_por: 'sistema', salonero_login: '002', cajero_login: '111', canal: 'delivery', valor_servido_crc: 6_000 }),
]

describe('armarDia · los cuatro baldes en un día completo', () => {
  const a = armar(TICKETS)

  it('hay exactamente los cuatro baldes esperados, más el mesero', () => {
    expect(Object.keys(a.dia.saloneros).sort()).toEqual(
      ['MAXO', CLAVE_CAJERO_MANANA, CLAVE_CAJERO_TARDE, CLAVE_SALON_SIN_MESERO, CLAVE_SISTEMA_OTROS].sort(),
    )
  })

  it('Mañana junta el 111 y el 388; Tarde es el 222', () => {
    expect(caj(a.dia, CLAVE_CAJERO_MANANA)!.total).toBe(34_000)   // 30.000 + 4.000
    expect(caj(a.dia, CLAVE_CAJERO_TARDE)!.total).toBe(50_000)
  })

  it('Total Cajeros = las dos tarjetas y nada más', () => {
    const dias = { '2026-09-01': a.dia }
    const total = CLAVES_CAJERO_TURNO
      .map(n => aggCajero(n, ['2026-09-01'], dias).total)
      .reduce((s, t) => s + t, 0)
    expect(total).toBe(84_000)
    // Ni «Salón sin mesero» ni «Sistema y otros» entran.
    expect(total).not.toBe(total + 23_000)
    expect(aggCajero(CLAVE_SALON_SIN_MESERO,   ['2026-09-01'], dias).total).toBe(23_000)  // 15k + 8k
    expect(aggCajero(CLAVE_SISTEMA_OTROS, ['2026-09-01'], dias).total).toBe(6_000)
  })

  it('la columna salón de los turnos es 0 salvo barra/llevar/otro, que se muestran', () => {
    // Mañana tiene el `llevar` de 4.000: no es delivery, así que NO se esconde.
    expect(caj(a.dia, CLAVE_CAJERO_MANANA)!.delivery).toBe(30_000)
    expect(caj(a.dia, CLAVE_CAJERO_MANANA)!.salon).toBe(4_000)
    // Tarde es 100% delivery: su columna salón sí queda en 0.
    expect(caj(a.dia, CLAVE_CAJERO_TARDE)!.delivery).toBe(50_000)
    expect(caj(a.dia, CLAVE_CAJERO_TARDE)!.salon).toBe(0)
  })

  it('«Salón sin mesero» es todo salón, por construcción', () => {
    expect(caj(a.dia, CLAVE_SALON_SIN_MESERO)!.delivery).toBe(0)
    expect(caj(a.dia, CLAVE_SALON_SIN_MESERO)!.salon).toBe(23_000)
  })

  it('los cuatro baldes conservan la marca `esCajero` — no se tocó', () => {
    for (const k of [CLAVE_CAJERO_MANANA, CLAVE_CAJERO_TARDE, CLAVE_SALON_SIN_MESERO, CLAVE_SISTEMA_OTROS]) {
      expect(caj(a.dia, k)!.esCajero).toBe(true)
    }
  })

  it('«Salón sin mesero» no es un empleado: queda fuera de la lista de meseros', () => {
    // Es lo que lo mantiene fuera de Competencias y de Empleados, que leen `allSaloneros`.
    expect(allSaloneros({ '2026-09-01': a.dia })).toEqual(['MAXO'])
  })
})

describe('REAGRUPA, NO RECALCULA: el día no se mueve', () => {
  const a = armar(TICKETS)
  const dias = { '2026-09-01': a.dia }
  const NETA = 200_000 + 34_000 + 50_000 + 23_000 + 6_000   // 313.000

  it('la neta del día es la suma de TODAS las facturas, como siempre', () => {
    expect(getDayStats(a.dia).ventaNeta).toBe(NETA)
    expect(aggGeneral(['2026-09-01'], dias, {}).totalRest).toBe(NETA)
  })

  it('el corte meseros / no-meseros no se movió', () => {
    const gen = aggGeneral(['2026-09-01'], dias, {})
    expect(gen.total).toBe(200_000)                      // meseros
    expect(gen.cajTotal).toBe(34_000 + 50_000 + 23_000 + 6_000)
    expect(gen.total + gen.cajTotal).toBe(NETA)
  })

  it('el delivery del día sigue saliendo por canal, ticket a ticket', () => {
    // 30.000 (111) + 50.000 (222) + 6.000 (sistema). El `llevar` no es delivery.
    expect(getDayStats(a.dia).delivery).toBe(86_000)
  })
})

describe('el rótulo no choca con el «· sin asignar» del roster', () => {
  it('el balde se llama «Salón sin mesero»', () => {
    expect(CLAVE_SALON_SIN_MESERO).toBe('Salón sin mesero')
  })

  it('y NO se parece al del roster, que es un MESERO sin nombre', () => {
    // `nombreSalonero` produce `«099 · sin asignar»` para un mesero real que no está en
    // Empleados. Son cosas distintas y con el rótulo viejo se leían igual.
    expect(CLAVE_SALON_SIN_MESERO.toLowerCase()).not.toContain('sin asignar')
    expect(esSinAsignar(CLAVE_SALON_SIN_MESERO)).toBe(false)
    expect(esSinAsignar('099 · sin asignar')).toBe(true)
  })
})
