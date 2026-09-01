import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Employee, WorkDay } from '../types/database'
import { fi } from '../utils'

// Salarios · el 10% de SERVICIO (v3). Los tests que amarran los TRES CONCEPTOS:
//
//   · IVA 13%        → impuesto de la factura. NO se reparte y NO aparece acá.
//   · 10% de SERVICIO → cargo de salón/barra. Se reparte por horas y SE TRANSFIERE
//                       junto con el salario. Es lo que prueba este archivo.
//   · PROPINA / pozo  → efectivo, módulo Propinas. NO va al banco.
//
// La regla que sostiene el archivo: el 10% se calcula EN SALARIOS. Si alguna vez este
// cálculo aparece en `tipCalculations`, es que se mezcló el servicio con el pozo.

interface Op { fn: string; args: unknown[] }
interface Call { table: string; ops: Op[] }

const calls: Call[] = []
const queues: Record<string, { data: unknown; error: unknown }[]> = {}

function enqueue(table: string, res: { data?: unknown; error?: unknown }) {
  ;(queues[table] ??= []).push({ data: res.data ?? null, error: res.error ?? null })
}

function makeQ(table: string) {
  const call: Call = { table, ops: [] }
  calls.push(call)
  const rec = (fn: string) => (...args: unknown[]) => { call.ops.push({ fn, args }); return q }
  const q = {
    select: rec('select'), insert: rec('insert'), upsert: rec('upsert'), update: rec('update'),
    eq: rec('eq'), gte: rec('gte'), lte: rec('lte'), lt: rec('lt'), order: rec('order'),
    limit: rec('limit'), single: rec('single'),
    then: (onOk: (r: unknown) => unknown) =>
      Promise.resolve(queues[table]?.shift() ?? { data: [], error: null }).then(onOk),
  }
  return q
}

vi.mock('./supabase', () => ({ supabase: { from: (table: string) => makeQ(table) } }))

import {
  repartoServicioDia, servicioDelPeriodo, servicioDeDiaData, diasDelPeriodo,
  participaServicio, PARTICIPA_SERVICIO_DEFAULT, getServicioPorDia,
  consolidarPeriodo, aPagarDe, ingresoTotalDe, LOCAL_DEFAULT,
  servicioNoAsignado, motivoBloqueoServicio,
} from './salarios'

beforeEach(() => {
  calls.length = 0
  for (const k of Object.keys(queues)) delete queues[k]
})

const lastCall = (table: string) => [...calls].reverse().find(c => c.table === table)!
const opArgs = (c: Call, fn: string) => c.ops.find(o => o.fn === fn)?.args

const emp = (over: Partial<Employee> & { id: string; full_name: string }): Employee =>
  ({ role: 'salonero', profile_id: null, is_active: true, pos_name: null,
     hourly_rate_crc: 0, fixed_salary_crc: 0,
     created_at: '', updated_at: '', ...over }) as Employee

const wd = (over: Partial<WorkDay> & { employee_id: string; work_date: string }): WorkDay =>
  ({ local: LOCAL_DEFAULT, hours: 0, es_feriado: false, source: 'manual',
     flags: null, created_at: '', updated_at: '', ...over }) as WorkDay

// ── El flag `participa del 10%` ─────────────────────────────────────────────────

describe('participa del 10% de servicio', () => {
  // El default de la app tiene que decir lo MISMO que el de la base (mig 055:
  // `participa_servicio boolean not null default true`). Si divergen, alguien deja de
  // cobrar servicio por un dato que en la base dice que sí lo cobra.
  it('el default es true, igual que la mig 055', () => {
    expect(PARTICIPA_SERVICIO_DEFAULT).toBe(true)
    expect(participaServicio(emp({ id: 'e1', full_name: 'ANA' }))).toBe(true)
  })

  it('un false explícito manda', () => {
    expect(participaServicio(emp({ id: 'e1', full_name: 'ANA', participa_servicio: false }))).toBe(false)
  })
})

// ── Los días del período ────────────────────────────────────────────────────────

describe('días del período', () => {
  it('devuelve los días de calendario, inclusive las dos puntas', () => {
    expect(diasDelPeriodo('2026-08-01', '2026-08-04'))
      .toEqual(['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04'])
  })

  it('cruza el fin de mes sin comerse ni repetir un día', () => {
    expect(diasDelPeriodo('2026-08-30', '2026-09-02'))
      .toEqual(['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02'])
  })

  it('un rango dado vuelta o vacío no devuelve nada (en vez de colgarse)', () => {
    expect(diasDelPeriodo('2026-08-10', '2026-08-01')).toEqual([])
    expect(diasDelPeriodo('', '2026-08-01')).toEqual([])
  })
})

// ── El reparto de UN día ────────────────────────────────────────────────────────

describe('reparto del 10% de servicio de un día', () => {
  it('cuota = pool / Σ horas × horas de la persona', () => {
    const r = repartoServicioDia(100_000, [
      { employeeId: 'e1', horas: 8 },
      { employeeId: 'e2', horas: 2 },
    ])
    expect(r.get('e1')).toBe(80_000)
    expect(r.get('e2')).toBe(20_000)
    // Lo repartido es exactamente el pool: el 10% no se crea ni se pierde en el camino.
    expect([...r.values()].reduce((s, v) => s + v, 0)).toBeCloseTo(100_000, 6)
  })

  it('denominador 0 → cuota 0, sin dividir por cero', () => {
    const r = repartoServicioDia(100_000, [])
    expect(r.size).toBe(0)
    const soloCeros = repartoServicioDia(100_000, [{ employeeId: 'e1', horas: 0 }])
    expect(soloCeros.size).toBe(0)
    // Lo que importa: NINGÚN Infinity ni NaN se escapó como monto.
    for (const v of [...r.values(), ...soloCeros.values()]) expect(Number.isFinite(v)).toBe(true)
  })

  it('un pool en 0 (o negativo) no reparte nada', () => {
    expect(repartoServicioDia(0, [{ employeeId: 'e1', horas: 8 }]).size).toBe(0)
    expect(repartoServicioDia(-5000, [{ employeeId: 'e1', horas: 8 }]).size).toBe(0)
  })
})

// ── El reparto del PERÍODO ──────────────────────────────────────────────────────

describe('el 10% de servicio del período', () => {
  const dias = diasDelPeriodo('2026-08-01', '2026-08-02')
  const participaTodos = () => true

  it('suma las cuotas día por día, no el período entero de una', () => {
    // Repartir el total del período contra las horas del período daría OTRO número: cada
    // día tiene su propia dotación, y quien trabajó el día flojo no cobra como el fuerte.
    const workDays = [
      wd({ employee_id: 'e1', work_date: '2026-08-01', hours: 8 }),
      wd({ employee_id: 'e2', work_date: '2026-08-01', hours: 2 }),
      wd({ employee_id: 'e1', work_date: '2026-08-02', hours: 2 }),
      wd({ employee_id: 'e2', work_date: '2026-08-02', hours: 8 }),
    ]
    const pools = new Map([['2026-08-01', 100_000], ['2026-08-02', 50_000]])
    const r = servicioDelPeriodo(workDays, pools, participaTodos, dias)

    expect(r.porEmpleado.get('e1')).toBeCloseTo(80_000 + 10_000, 6)   // 8/10 y 2/10
    expect(r.porEmpleado.get('e2')).toBeCloseTo(20_000 + 40_000, 6)
    expect(r.totalRepartido).toBeCloseTo(150_000, 6)
    expect(r.totalSinRepartir).toBe(0)
    expect(r.diasSinVentas).toEqual([])
  })

  it('participa = false → ₡0 de servicio Y fuera del denominador', () => {
    // Las dos mitades importan: si el que no participa entrara al denominador, achicaría
    // la cuota de los demás sin cobrar él, y el 10% del día quedaría a medio repartir.
    const workDays = [
      wd({ employee_id: 'e1', work_date: '2026-08-01', hours: 8 }),
      wd({ employee_id: 'e2', work_date: '2026-08-01', hours: 2 }),
    ]
    const pools = new Map([['2026-08-01', 100_000]])
    const r = servicioDelPeriodo(workDays, pools, id => id !== 'e2', dias)

    expect(r.porEmpleado.get('e2')).toBeUndefined()
    expect(r.porEmpleado.get('e1')).toBeCloseTo(100_000, 6)
    expect(r.totalRepartido).toBeCloseTo(100_000, 6)
  })

  it('un día con servicio y sin nadie que participe no se divide por cero: queda sin repartir', () => {
    const pools = new Map([['2026-08-01', 100_000], ['2026-08-02', 0]])
    const r = servicioDelPeriodo([], pools, participaTodos, dias)
    expect(r.porEmpleado.size).toBe(0)
    expect(r.totalRepartido).toBe(0)
    // La plata existe y no la cobró nadie: se reporta en vez de evaporarse.
    expect(r.totalSinRepartir).toBe(100_000)
  })

  it('un día SIN ventas cargadas se lista: no se sabe ≠ ₡0', () => {
    const workDays = [wd({ employee_id: 'e1', work_date: '2026-08-02', hours: 8 })]
    const pools = new Map([['2026-08-01', 100_000]])   // el 02 no está en el mapa
    const r = servicioDelPeriodo(workDays, pools, participaTodos, dias)
    expect(r.diasSinVentas).toEqual(['2026-08-02'])
    // Y no se le inventa ₡0 al día faltante: solo se repartió lo del 01.
    expect(r.totalSinRepartir).toBe(100_000)           // el 01 no tenía horas de nadie
  })

  it('las horas de los dos locales del mismo día suman para la misma persona', () => {
    // El pool de `ventas_dias` es UNO por día para el negocio entero, así que el
    // denominador también tiene que mirar el día entero.
    const workDays = [
      wd({ employee_id: 'e1', work_date: '2026-08-01', hours: 4, local: 'santa-teresa' }),
      wd({ employee_id: 'e1', work_date: '2026-08-01', hours: 4, local: 'nosara' }),
      wd({ employee_id: 'e2', work_date: '2026-08-01', hours: 2, local: 'nosara' }),
    ]
    const r = servicioDelPeriodo(workDays, new Map([['2026-08-01', 100_000]]), participaTodos, dias)
    expect(r.porEmpleado.get('e1')).toBeCloseTo(80_000, 6)
    expect(r.porEmpleado.get('e2')).toBeCloseTo(20_000, 6)
  })
})

// ── La lectura del servicio del día ─────────────────────────────────────────────

describe('servicio del día leído de ventas', () => {
  it('suma el servicio de saloneros y cajeros del día', () => {
    expect(servicioDeDiaData({
      saloneros: {
        ANA:     { serv: 40_000 },
        BENITO:  { serv: 25_000 },
        'CAJA 1': { esCajero: true, serv: 10_000 },
      },
    })).toBe(75_000)
  })

  it('una fila rara o vacía da 0 y no tumba la pantalla que paga', () => {
    expect(servicioDeDiaData(null)).toBe(0)
    expect(servicioDeDiaData({})).toBe(0)
    expect(servicioDeDiaData({ saloneros: { ANA: null } })).toBe(0)
    expect(servicioDeDiaData({ saloneros: { ANA: { serv: 'x' } } })).toBe(0)
  })

  it('getServicioPorDia lee ventas_dias acotado al período y NO escribe nada', async () => {
    enqueue('ventas_dias', {
      data: [
        { session_date: '2026-08-01', data: { saloneros: { ANA: { serv: 30_000 } } } },
        { session_date: '2026-08-02', data: { saloneros: {} } },
      ],
    })
    const m = await getServicioPorDia('2026-08-01', '2026-08-15')

    const c = lastCall('ventas_dias')
    expect(opArgs(c, 'gte')).toEqual(['session_date', '2026-08-01'])
    expect(opArgs(c, 'lte')).toEqual(['session_date', '2026-08-15'])
    // SOLO LECTURA: ni upsert, ni insert, ni update sobre las ventas.
    expect(c.ops.map(o => o.fn)).not.toContain('upsert')
    expect(c.ops.map(o => o.fn)).not.toContain('insert')
    expect(c.ops.map(o => o.fn)).not.toContain('update')

    expect(m.get('2026-08-01')).toBe(30_000)
    // Un día cargado sin servicio SÍ está en el mapa con 0: eso es "se sabe y fue ₡0".
    expect(m.get('2026-08-02')).toBe(0)
    // Un día que no vino NO está: eso es "no se sabe", y se distingue del ₡0.
    expect(m.has('2026-08-03')).toBe(false)
  })
})

// ── El consolidado: A pagar = horas + 10% ───────────────────────────────────────

describe('consolidado v3: A pagar = total de horas + 10% de servicio', () => {
  const ANA    = emp({ id: 'e1', full_name: 'ANA', hourly_rate_crc: 2600 })
  const BENITO = emp({ id: 'e2', full_name: 'BENITO', fixed_salary_crc: 185_000 })
  const periodo = { fecha_fin: '2026-08-15' }
  const workDays = [wd({ employee_id: 'e1', work_date: '2026-08-15', hours: 96 })]

  it('el servicio se suma a lo que se transfiere, y las propinas NO', () => {
    const [ana, benito] = consolidarPeriodo(
      [ANA, BENITO], workDays, periodo, LOCAL_DEFAULT,
      new Map([['e1', 27_000]]),      // propinas — efectivo, no van al banco
      new Map([['e1', 41_000]]),      // 10% de servicio — sí va al banco
    )

    expect(ana.neto).toBe(249_600)          // "Total horas (₡)": 96 × 2.600
    expect(ana.servicio).toBe(41_000)
    expect(ana.aPagar).toBe(290_600)        // horas + servicio → lo que sale por el banco
    expect(ana.propinasPeriodo).toBe(27_000)
    expect(ana.ingresoTotal).toBe(317_600)  // + propinas, informativo

    // Sin servicio ni propinas, la línea no cambia de lo que era antes de v3.
    expect(benito.servicio).toBe(0)
    expect(benito.aPagar).toBe(185_000)
    expect(benito.ingresoTotal).toBe(185_000)
  })

  it('sin el mapa de servicio, el consolidado se comporta como antes (A pagar = horas)', () => {
    const [ana] = consolidarPeriodo([ANA], workDays, periodo, LOCAL_DEFAULT)
    expect(ana.servicio).toBe(0)
    expect(ana.aPagar).toBe(ana.neto)
    expect(ana.ingresoTotal).toBe(ana.neto)
  })

  it('las fórmulas son las mismas funciones que usa la pantalla', () => {
    // Si la grilla sumara por su cuenta, un neto pisado a mano dejaría la pantalla y el
    // banco contando historias distintas. Por eso hay UNA sola fórmula para cada cifra.
    expect(aPagarDe(249_600, 41_000)).toBe(290_600)
    expect(ingresoTotalDe(249_600, 27_000, 41_000)).toBe(317_600)
    // `servicio` con default 0: un llamador viejo sigue dando el número de antes.
    expect(ingresoTotalDe(249_600, 27_000)).toBe(276_600)
  })
})


// ╔══════════════════════════════════════════════════════════════════════════════════════╗
// ║ EL 10% QUE NADIE COBRA · desglose POR CAUSA, y el BLOQUEO (v3, fix del piloto)         ║
// ╚══════════════════════════════════════════════════════════════════════════════════════╝
// Antes la pantalla mostraba un total opaco: «₡X no se reparte en esta nómina». Un número
// sin causa no se puede arreglar. Estas pruebas fijan las dos causas, sus montos, y que un
// remanente FRENE el cierre y el pago en vez de dejar plata perdida en silencio.

describe('10% sin asignar · el desglose por causa', () => {
  const TODOS = ['2026-08-01', '2026-08-02', '2026-08-03']

  it('un día con 10% y nadie que participe queda listado CON su fecha y su monto', () => {
    // El 02 lo trabajó solo BENITO, que NO participa del 10% → ese pool no tiene dueño.
    const sp = servicioDelPeriodo(
      [
        wd({ employee_id: 'e1', work_date: '2026-08-01', hours: 8 }),
        wd({ employee_id: 'e2', work_date: '2026-08-02', hours: 8 }),
      ],
      new Map([['2026-08-01', 30_000], ['2026-08-02', 21_000], ['2026-08-03', 0]]),
      id => id === 'e1',
      TODOS,
    )
    expect(sp.diasSinParticipantes).toEqual([{ fecha: '2026-08-02', pool: 21_000 }])
    expect(sp.totalSinRepartir).toBe(21_000)

    const na = servicioNoAsignado(sp, new Set(['e1']), () => ({ nombre: '?', horas: 0 }))
    expect(na.totalDiasSinParticipantes).toBe(21_000)
    expect(na.inactivos).toEqual([])
    expect(na.total).toBe(21_000)
    expect(na.bloquea).toBe(true)
  })

  it('quien fichó estando INACTIVO sale con nombre, horas y la cuota que le tocaría', () => {
    // LESTER está inactivo: tiene horas, el reparto le adjudicó su parte, y la grilla no
    // lo tiene. Esa plata existe y hoy no se la paga nadie.
    const sp = servicioDelPeriodo(
      [
        wd({ employee_id: 'e1', work_date: '2026-08-01', hours: 6 }),
        wd({ employee_id: 'e9', work_date: '2026-08-01', hours: 4 }),
      ],
      new Map([['2026-08-01', 20_000]]),
      () => true,
      ['2026-08-01'],
    )
    // 20.000 entre 10 h → 2.000/h. ANA 6 h = 12.000; LESTER 4 h = 8.000.
    const na = servicioNoAsignado(
      sp,
      new Set(['e1']),                       // solo ANA está en la grilla
      id => ({ nombre: id === 'e9' ? 'LESTER' : id, horas: id === 'e9' ? 4 : 6 }),
    )
    expect(na.inactivos).toEqual([{ employeeId: 'e9', nombre: 'LESTER', horas: 4, cuota: 8_000 }])
    expect(na.totalInactivos).toBe(8_000)
    expect(na.diasSinParticipantes).toEqual([])
    expect(na.total).toBe(8_000)
    expect(na.bloquea).toBe(true)
  })

  it('las dos causas juntas SUMAN, y cada una conserva su monto', () => {
    const sp = servicioDelPeriodo(
      [
        wd({ employee_id: 'e1', work_date: '2026-08-01', hours: 6 }),
        wd({ employee_id: 'e9', work_date: '2026-08-01', hours: 4 }),
        wd({ employee_id: 'e2', work_date: '2026-08-02', hours: 8 }),   // no participa
      ],
      new Map([['2026-08-01', 20_000], ['2026-08-02', 21_000]]),
      id => id !== 'e2',
      ['2026-08-01', '2026-08-02'],
    )
    const na = servicioNoAsignado(sp, new Set(['e1']), id => ({ nombre: id, horas: 4 }))
    expect(na.totalDiasSinParticipantes).toBe(21_000)
    expect(na.totalInactivos).toBe(8_000)
    expect(na.total).toBe(29_000)
  })

  it('los inactivos van del que más plata tiene sin cobrar hacia abajo', () => {
    const sp = servicioDelPeriodo(
      [
        wd({ employee_id: 'e7', work_date: '2026-08-01', hours: 2 }),
        wd({ employee_id: 'e8', work_date: '2026-08-01', hours: 8 }),
      ],
      new Map([['2026-08-01', 10_000]]),
      () => true,
      ['2026-08-01'],
    )
    const na = servicioNoAsignado(sp, new Set(), id => ({ nombre: id, horas: 0 }))
    expect(na.inactivos.map(i => i.cuota)).toEqual([8_000, 2_000])
  })

  it('sin remanente NO bloquea: todo repartido entre gente que sí está en la grilla', () => {
    const sp = servicioDelPeriodo(
      [wd({ employee_id: 'e1', work_date: '2026-08-01', hours: 8 })],
      new Map([['2026-08-01', 30_000]]),
      () => true,
      ['2026-08-01'],
    )
    const na = servicioNoAsignado(sp, new Set(['e1']), id => ({ nombre: id, horas: 8 }))
    expect(na.total).toBe(0)
    expect(na.bloquea).toBe(false)
    expect(motivoBloqueoServicio(na, 'cerrar')).toBeNull()
    expect(motivoBloqueoServicio(na, 'pagar')).toBeNull()
  })

  it('un día con pool ₡0 no inventa un remanente', () => {
    const sp = servicioDelPeriodo([], new Map([['2026-08-01', 0]]), () => true, ['2026-08-01'])
    const na = servicioNoAsignado(sp, new Set(), () => ({ nombre: '?', horas: 0 }))
    expect(na.total).toBe(0)
    expect(na.bloquea).toBe(false)
  })

  it('un día SIN ventas cargadas no es un remanente: es "no se sabe"', () => {
    // Se sigue avisando aparte (`diasSinVentas`), pero no se cuenta como plata sin
    // asignar: no hay monto conocido que asignarle a nadie.
    const sp = servicioDelPeriodo([], new Map(), () => true, ['2026-08-01', '2026-08-02'])
    expect(sp.diasSinVentas).toEqual(['2026-08-01', '2026-08-02'])
    const na = servicioNoAsignado(sp, new Set(), () => ({ nombre: '?', horas: 0 }))
    expect(na.total).toBe(0)
    expect(na.bloquea).toBe(false)
  })

  it('una cuota que redondea a ₡0 no ensucia la lista', () => {
    const sp = servicioDelPeriodo(
      [
        wd({ employee_id: 'e1', work_date: '2026-08-01', hours: 1000 }),
        wd({ employee_id: 'e9', work_date: '2026-08-01', hours: 0.01 }),
      ],
      new Map([['2026-08-01', 100]]),
      () => true,
      ['2026-08-01'],
    )
    const na = servicioNoAsignado(sp, new Set(['e1']), id => ({ nombre: id, horas: 0.01 }))
    expect(na.inactivos).toEqual([])
    expect(na.bloquea).toBe(false)
  })
})

describe('10% sin asignar · el mensaje del bloqueo', () => {
  const conRemanente = (dias: number, inact: number) => ({
    diasSinParticipantes: dias > 0 ? [{ fecha: '2026-08-02', pool: dias }] : [],
    totalDiasSinParticipantes: dias,
    inactivos: inact > 0 ? [{ employeeId: 'e9', nombre: 'LESTER', horas: 4, cuota: inact }] : [],
    totalInactivos: inact,
    total: dias + inact,
    bloquea: dias + inact > 0,
  })

  it('nombra el total, la causa y la acción que queda frenada', () => {
    const msg = motivoBloqueoServicio(conRemanente(21_000, 8_000), 'cerrar')!
    expect(msg).toContain('SIN ASIGNAR')
    // El monto se escribe con el MISMO `fi` que la pantalla: un solo formato de colones.
    expect(msg).toContain(fi(29_000))
    expect(msg).toContain('1 día(s) sin nadie que participe')
    expect(msg).toContain('1 persona(s) que fichó estando inactiva')
    expect(msg).toContain('cerrar')
  })

  it('con una sola causa no menciona la otra', () => {
    const msg = motivoBloqueoServicio(conRemanente(0, 8_000), 'pagar')!
    expect(msg).toContain('fichó estando inactiva')
    expect(msg).not.toContain('sin nadie que participe')
    expect(msg).toContain('pagar')
  })
})
