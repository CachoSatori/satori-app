import { describe, it, expect } from 'vitest'
import type { CashMovement, CashSession, CashCierreDia } from '../../shared/types/database'
import {
  POZO_CORTE,
  POZO_CORTE_FALLBACK,
  resolverCorte,
  basePozoParaCierre,
  deberiaPozo,
  diasPendientesDeCierre,
  esFilaDelCierre,
  esPostCorte,
  fechaOperativa,
  hayMontosNegativos,
  ventaSospechosaDeSerNeta,
} from './cierrePozo'

let seq = 0
function mov(p: Partial<CashMovement> & { fechaSesion?: string }): CashMovement {
  seq += 1
  return {
    id: p.id ?? `m${seq}`,
    session_id: p.session_id ?? null,
    created_by: 'u1',
    movement_type: p.movement_type ?? 'ingreso',
    amount_crc: p.amount_crc ?? 0,
    amount_usd: p.amount_usd ?? 0,
    currency: 'CRC',
    exchange_rate: 500,
    description: p.description ?? '',
    subcategory: p.subcategory ?? '',
    supplier_id: null,
    supplier_name: null,
    employee_name: null,
    method: p.method ?? 'Efectivo',
    shift: '',
    caja_origen: p.caja_origen ?? 'Caja Fuerte',
    status: p.status ?? 'aprobado',
    approved_by: null,
    approved_at: null,
    account_id: null,
    created_at: p.created_at ?? '2026-08-05T12:00:00+00:00',
    updated_at: p.created_at ?? '2026-08-05T12:00:00+00:00',
  } as CashMovement
}

const ses = (id: string, session_date: string): CashSession =>
  ({ id, session_date, status: 'closed' }) as CashSession

const cierre = (session_date: string, tipo = 'completo'): CashCierreDia =>
  ({ session_date, tipo }) as CashCierreDia

/** Atajo: el "debería" del día, con la base ya filtrada. */
function deberia(
  movs: CashMovement[],
  sessions: CashSession[],
  fecha: string,
  ventas: { efRealM?: number; efRealN?: number; vmUsd?: number; vnUsd?: number; retiroCrc?: number } = {},
) {
  return deberiaPozo({
    base: basePozoParaCierre(movs, sessions, fecha),
    efRealM: ventas.efRealM ?? 0,
    efRealN: ventas.efRealN ?? 0,
    vmUsd: ventas.vmUsd ?? 0,
    vnUsd: ventas.vnUsd ?? 0,
    retiroCrc: ventas.retiroCrc ?? 0,
  })
}

describe('cierrePozo — el corte hacia adelante', () => {
  it('los días anteriores al corte NO usan el modelo nuevo', () => {
    expect(esPostCorte('2026-07-31')).toBe(false)
    expect(esPostCorte(POZO_CORTE)).toBe(true)
    expect(esPostCorte('2026-12-01')).toBe(true)
    expect(esPostCorte('')).toBe(false)
  })

  it('el corte es configurable sin tocar la lógica', () => {
    expect(esPostCorte('2026-06-01', '2026-06-01')).toBe(true)
    expect(esPostCorte('2026-05-31', '2026-06-01')).toBe(false)
  })
})

describe('cierrePozo — un día post-corte completo cuadra exacto', () => {
  // El escenario del criterio de aceptación: se abre el pozo con una cifra física, y en el
  // día se paga un proveedor del fondo, se paga una propina, se hace un traspaso interno y
  // se retira plata al banco. El cierre tiene que cuadrar contra el conteo, sin faltantes
  // fantasma y sin restar nada dos veces.
  const APERTURA = 500_000
  const VENTAS_M = 120_000
  const VENTAS_N = 300_000
  const PROVEEDOR = 45_000 // pagado en efectivo desde el fondo (Caja Proveedores)
  const PROPINA = 70_000 // pagada desde la Registradora
  const TRASPASO = 200_000 // Registradora → Caja Fuerte: no mueve el pozo
  const RETIRO = 80_000 // a banco, lo registra el cierre después

  const movs = [
    mov({ subcategory: 'Apertura pozo', description: 'Apertura pozo 2026-08-01', amount_crc: APERTURA }),
    mov({
      movement_type: 'egreso_mercaderia',
      caja_origen: 'Caja Proveedores',
      amount_crc: PROVEEDOR,
      session_id: 's1',
      description: 'Pescadería',
    }),
    mov({
      movement_type: 'egreso_personal',
      caja_origen: 'Registradora',
      subcategory: 'Propinas por turno',
      amount_crc: PROPINA,
      session_id: 's1',
    }),
    mov({
      movement_type: 'traspaso',
      caja_origen: 'Registradora',
      subcategory: 'Registradora → Caja Fuerte',
      amount_crc: TRASPASO,
      session_id: 's1',
    }),
  ]
  const sessions = [ses('s1', '2026-08-05')]

  it('el conteo físico esperado sale exacto', () => {
    const r = deberia(movs, sessions, '2026-08-05', {
      efRealM: VENTAS_M,
      efRealN: VENTAS_N,
      retiroCrc: RETIRO,
    })
    // apertura + ventas brutas − proveedor − propina − retiro; el traspaso interno no mueve nada
    expect(r.crc).toBe(APERTURA + VENTAS_M + VENTAS_N - PROVEEDOR - PROPINA - RETIRO)
    expect(r.crc).toBe(725_000)
  })

  it('el proveedor pagado con el fondo NO genera faltante fantasma', () => {
    // El modelo viejo no veía `Caja Proveedores` y ese pago aparecía como faltante.
    const sinProveedor = movs.filter(m => m.caja_origen !== 'Caja Proveedores')
    const conProv = deberia(movs, sessions, '2026-08-05', { efRealM: VENTAS_M })
    const sinProv = deberia(sinProveedor, sessions, '2026-08-05', { efRealM: VENTAS_M })
    expect(sinProv.crc - conProv.crc).toBe(PROVEEDOR)
  })

  it('la propina pagada resta UNA sola vez (y es visible en el pozo)', () => {
    const sinPropina = movs.filter(m => m.subcategory !== 'Propinas por turno')
    const con = deberia(movs, sessions, '2026-08-05', {})
    const sin = deberia(sinPropina, sessions, '2026-08-05', {})
    expect(sin.crc - con.crc).toBe(PROPINA)
  })

  it('una propina mal categorizada en OTRA caja física no descuadra: resta igual, una vez', () => {
    const enCajaFuerte = movs.map(m =>
      m.subcategory === 'Propinas por turno' ? ({ ...m, caja_origen: 'Caja Fuerte' } as CashMovement) : m,
    )
    expect(deberia(enCajaFuerte, sessions, '2026-08-05', {}).crc).toBe(
      deberia(movs, sessions, '2026-08-05', {}).crc,
    )
  })

  it('el traspaso interno es neutro: cambiarlo de dirección no mueve el número', () => {
    const alReves = movs.map(m =>
      m.movement_type === 'traspaso'
        ? ({ ...m, caja_origen: 'Caja Fuerte', subcategory: 'Caja Fuerte → Caja Proveedores' } as CashMovement)
        : m,
    )
    expect(deberia(alReves, sessions, '2026-08-05', {}).crc).toBe(
      deberia(movs, sessions, '2026-08-05', {}).crc,
    )
  })

  it('el retiro resta una vez aunque su movimiento ya exista (re-cierre idempotente)', () => {
    const conRetiroYaGrabado = [
      ...movs,
      mov({
        movement_type: 'traspaso',
        caja_origen: 'Caja Fuerte',
        subcategory: 'Caja Fuerte → Banco',
        method: 'Transferencia',
        amount_crc: RETIRO,
        description: 'Retiro dueños a banco 2026-08-05',
      }),
    ]
    const primera = deberia(movs, sessions, '2026-08-05', { efRealM: VENTAS_M, retiroCrc: RETIRO })
    const recierre = deberia(conRetiroYaGrabado, sessions, '2026-08-05', {
      efRealM: VENTAS_M,
      retiroCrc: RETIRO,
    })
    expect(recierre.crc).toBe(primera.crc)
  })

  it('re-cerrar con las ventas y el ajuste ya en el ledger da el MISMO número', () => {
    const yaSellado = [
      ...movs,
      mov({ subcategory: 'Ventas cierre', description: 'Ventas efectivo Mediodía 2026-08-05', amount_crc: VENTAS_M }),
      mov({ subcategory: 'Ventas cierre', description: 'Ventas efectivo Noche 2026-08-05', amount_crc: VENTAS_N }),
      mov({ subcategory: 'Ajuste de cierre', description: 'Ajuste de cierre 2026-08-05 · Faltante · x', movement_type: 'egreso_operativo', amount_crc: 1_200 }),
    ]
    expect(deberia(yaSellado, sessions, '2026-08-05', { efRealM: VENTAS_M, efRealN: VENTAS_N, retiroCrc: RETIRO }).crc)
      .toBe(deberia(movs, sessions, '2026-08-05', { efRealM: VENTAS_M, efRealN: VENTAS_N, retiroCrc: RETIRO }).crc)
  })
})

describe('cierrePozo — el orden de sellado no cambia el número', () => {
  const sessions = [ses('sA', '2026-08-02'), ses('sB', '2026-08-03')]
  const base = [
    mov({ subcategory: 'Apertura pozo', description: 'Apertura pozo 2026-08-01', amount_crc: 400_000 }),
    mov({ movement_type: 'egreso_operativo', caja_origen: 'Caja Proveedores', amount_crc: 10_000, session_id: 'sA' }),
    mov({ movement_type: 'egreso_operativo', caja_origen: 'Caja Proveedores', amount_crc: 25_000, session_id: 'sB' }),
  ]

  it('las filas del cierre del día ANTERIOR se atribuyen por su descripción, no por cuándo se crearon', () => {
    // El cierre del 02 se sella TARDE (created_at del 09) — el modelo viejo leía el ledger
    // del instante y por eso el orden lo movía. Acá la fila pertenece al 02 igual.
    const selladoTarde = mov({
      subcategory: 'Ventas cierre',
      description: 'Ventas efectivo Noche 2026-08-02',
      amount_crc: 90_000,
      created_at: '2026-08-09T23:00:00+00:00',
    })
    const sesionFecha = new Map(sessions.map(s => [s.id, s.session_date]))
    expect(fechaOperativa(selladoTarde, sesionFecha)).toBe('2026-08-02')

    const conSellado = [...base, selladoTarde]
    // Para el cierre del 03, esa venta del 02 entra igual, se haya sellado cuando se haya sellado.
    expect(deberia(conSellado, sessions, '2026-08-03').crc).toBe(400_000 - 10_000 - 25_000 + 90_000)
  })

  it('un movimiento de un día POSTERIOR no se cuela en el debería de hoy', () => {
    const futuro = mov({
      movement_type: 'egreso_operativo',
      caja_origen: 'Caja Proveedores',
      amount_crc: 999_999,
      created_at: '2026-08-20T12:00:00+00:00',
    })
    expect(deberia([...base, futuro], sessions, '2026-08-03').crc).toBe(deberia(base, sessions, '2026-08-03').crc)
  })

  it('el orden del arreglo de movimientos es indiferente', () => {
    const alReves = [...base].reverse()
    expect(deberia(alReves, sessions, '2026-08-03').crc).toBe(deberia(base, sessions, '2026-08-03').crc)
  })
})

describe('cierrePozo — guard de cadena', () => {
  const sessions = [ses('s1', '2026-08-02'), ses('s2', '2026-08-03')]

  it('un día anterior CON plata movida y sin cierre completo BLOQUEA', () => {
    const movs = [
      mov({ movement_type: 'egreso_operativo', caja_origen: 'Caja Proveedores', amount_crc: 33_000, session_id: 's1' }),
    ]
    const p = diasPendientesDeCierre({ fecha: '2026-08-04', cierres: [], movements: movs, sessions })
    expect(p).toEqual([{ fecha: '2026-08-02', movimientos: 1, crc: 33_000 }])
  })

  it('un día SIN operación no traba', () => {
    const p = diasPendientesDeCierre({ fecha: '2026-08-04', cierres: [], movements: [], sessions })
    expect(p).toEqual([])
  })

  it('un día ya cerrado no traba', () => {
    const movs = [
      mov({ movement_type: 'egreso_operativo', caja_origen: 'Caja Proveedores', amount_crc: 33_000, session_id: 's1' }),
    ]
    const p = diasPendientesDeCierre({
      fecha: '2026-08-04',
      cierres: [cierre('2026-08-02')],
      movements: movs,
      sessions,
    })
    expect(p).toEqual([])
  })

  it('un cierre PARCIAL no alcanza: el día sigue trabando', () => {
    const movs = [
      mov({ movement_type: 'egreso_operativo', caja_origen: 'Caja Proveedores', amount_crc: 5_000, session_id: 's1' }),
    ]
    const p = diasPendientesDeCierre({
      fecha: '2026-08-04',
      cierres: [cierre('2026-08-02', 'parcial_mediodia')],
      movements: movs,
      sessions,
    })
    expect(p.map(x => x.fecha)).toEqual(['2026-08-02'])
  })

  it('los días ANTERIORES AL CORTE no traban (el histórico no se toca)', () => {
    const viejo = [ses('sv', '2026-07-15')]
    const movs = [
      mov({ movement_type: 'egreso_operativo', caja_origen: 'Caja Proveedores', amount_crc: 90_000, session_id: 'sv' }),
    ]
    const p = diasPendientesDeCierre({ fecha: '2026-08-04', cierres: [], movements: movs, sessions: viejo })
    expect(p).toEqual([])
  })

  it('la plata que no mueve el pozo (Banco, no-efectivo) no traba', () => {
    const movs = [
      mov({ movement_type: 'egreso_mercaderia', caja_origen: 'Banco', method: 'Transferencia', amount_crc: 80_000, session_id: 's1' }),
      mov({ movement_type: 'egreso_mercaderia', caja_origen: 'Caja Proveedores', method: 'SINPE', amount_crc: 40_000, session_id: 's1' }),
    ]
    expect(diasPendientesDeCierre({ fecha: '2026-08-04', cierres: [], movements: movs, sessions })).toEqual([])
  })

  it('el propio día que se está cerrando no se cuenta como pendiente', () => {
    const movs = [
      mov({ movement_type: 'egreso_operativo', caja_origen: 'Caja Proveedores', amount_crc: 7_000, session_id: 's2' }),
    ]
    expect(diasPendientesDeCierre({ fecha: '2026-08-03', cierres: [], movements: movs, sessions })).toEqual([])
  })
})

describe('cierrePozo — guardas de captura', () => {
  it('avisa cuando la venta de la fase es menor que las propinas pagadas (venta tecleada NETA)', () => {
    // El caso real: 2026-07-18 en prod cargó ₡53,00 de venta con ₡70.106,07 de propinas.
    expect(ventaSospechosaDeSerNeta(53, 70_106.07)).toBe(true)
    expect(ventaSospechosaDeSerNeta(300_000, 70_106.07)).toBe(false)
    expect(ventaSospechosaDeSerNeta(0, 0)).toBe(false)
  })

  it('rechaza montos negativos', () => {
    expect(hayMontosNegativos([100, 200, 0])).toBe(false)
    expect(hayMontosNegativos([100, -1])).toBe(true)
    expect(hayMontosNegativos(['', 5])).toBe(false)
    expect(hayMontosNegativos([-0.5])).toBe(true)
  })
})

describe('cierrePozo — USD', () => {
  it('el pozo en dólares sigue las mismas reglas y suma las ventas USD', () => {
    const movs = [
      mov({ subcategory: 'Apertura pozo', description: 'Apertura pozo 2026-08-01', amount_crc: 0, amount_usd: 300 }),
      mov({ movement_type: 'egreso_socios', caja_origen: 'Caja Fuerte', amount_usd: 50, session_id: 's1' }),
    ]
    const r = deberia(movs, [ses('s1', '2026-08-05')], '2026-08-05', { vmUsd: 20, vnUsd: 30 })
    expect(r.usd).toBe(300 - 50 + 20 + 30)
  })
})

describe('cierrePozo — exclusión de las filas del propio cierre', () => {
  it('reconoce ventas, ajuste y retiro del día', () => {
    const f = '2026-08-05'
    expect(esFilaDelCierre(mov({ subcategory: 'Ventas cierre', description: `Ventas efectivo Noche ${f}` }), f)).toBe(true)
    expect(esFilaDelCierre(mov({ subcategory: 'Ajuste de cierre', description: `Ajuste de cierre ${f} · x` }), f)).toBe(true)
    expect(
      esFilaDelCierre(
        mov({ movement_type: 'traspaso', subcategory: 'Caja Fuerte → Banco', description: `Retiro dueños a banco ${f}` }),
        f,
      ),
    ).toBe(true)
  })

  it('NO excluye las de OTRO día ni los movimientos normales', () => {
    const f = '2026-08-05'
    expect(esFilaDelCierre(mov({ subcategory: 'Ventas cierre', description: 'Ventas efectivo Noche 2026-08-04' }), f)).toBe(false)
    expect(esFilaDelCierre(mov({ movement_type: 'egreso_operativo', description: 'Gas' }), f)).toBe(false)
  })

  it('la apertura del pozo SÍ cuenta (no es una fila del cierre)', () => {
    const r = deberia(
      [mov({ subcategory: 'Apertura pozo', description: 'Apertura pozo 2026-08-01', amount_crc: 250_000 })],
      [],
      '2026-08-05',
    )
    expect(r.crc).toBe(250_000)
  })
})

describe('cierrePozo — la fecha de corte se puede fijar por entorno', () => {
  const mudo = () => {}

  it('una fecha válida gana sobre el fallback', () => {
    expect(resolverCorte('2026-07-23', mudo)).toBe('2026-07-23')
  })

  it('vacía o ausente cae al fallback, sin ruido', () => {
    expect(resolverCorte(undefined, mudo)).toBe(POZO_CORTE_FALLBACK)
    expect(resolverCorte('', mudo)).toBe(POZO_CORTE_FALLBACK)
    expect(resolverCorte('   ', mudo)).toBe(POZO_CORTE_FALLBACK)
  })

  it('una fecha mal formada cae al fallback Y avisa', () => {
    const avisos: string[] = []
    const push = (m: string) => avisos.push(m)
    expect(resolverCorte('23/07/2026', push)).toBe(POZO_CORTE_FALLBACK)
    expect(resolverCorte('2026-7-3', push)).toBe(POZO_CORTE_FALLBACK)
    expect(resolverCorte('mañana', push)).toBe(POZO_CORTE_FALLBACK)
    expect(avisos).toHaveLength(3)
    expect(avisos[0]).toContain('VITE_POZO_CORTE')
  })

  it('un día que no existe NO pasa como válido', () => {
    // Date.parse('2026-02-31') no falla: lo corre al 3 de marzo. Sin el chequeo de ida y
    // vuelta, el corte quedaría en una fecha que nadie escribió.
    const avisos: string[] = []
    expect(resolverCorte('2026-02-31', m => avisos.push(m))).toBe(POZO_CORTE_FALLBACK)
    expect(avisos).toHaveLength(1)
  })

  it('POZO_CORTE queda resuelto y con formato válido', () => {
    expect(POZO_CORTE).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
