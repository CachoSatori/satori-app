import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Employee, PunchException, TimePunch, WorkDay } from '../types/database'

// Salarios · BioTime F1d: contrato del wrapper de la RPC + la bandeja de excepciones.
// El emparejamiento vive en la mig 059 (SQL) y se valida contra la base; acá se prueba
// lo que la app hace con él: qué le pide, qué agrupa y qué escribe al corregir a mano.

interface Op { fn: string; args: unknown[] }
interface Call { table: string; ops: Op[] }
interface RpcCall { fn: string; args: unknown; thisOk: boolean }

// `vi.hoisted` porque `vi.mock` se iza al tope del archivo: el cliente falso tiene que
// existir ANTES que el import del módulo bajo prueba.
const { cliente, calls, rpcCalls, queues, setRpc } = vi.hoisted(() => {
  const calls: Call[] = []
  const rpcCalls: RpcCall[] = []
  const queues: Record<string, { data: unknown; error: unknown }[]> = {}
  let rpcResult: { data: unknown; error: unknown } = { data: null, error: null }

  function makeQ(table: string) {
    const call: Call = { table, ops: [] }
    calls.push(call)
    const rec = (fn: string) => (...args: unknown[]) => { call.ops.push({ fn, args }); return q }
    const q = {
      select: rec('select'), insert: rec('insert'), upsert: rec('upsert'), update: rec('update'),
      eq: rec('eq'), gte: rec('gte'), lte: rec('lte'), lt: rec('lt'), order: rec('order'),
      single: rec('single'),
      then: (onOk: (r: unknown) => unknown) =>
        Promise.resolve(queues[table]?.shift() ?? { data: [], error: null }).then(onOk),
    }
    return q
  }

  // `rest` + `function` (no arrow) para que el `this` sea observable, igual que en el
  // cliente real: es lo único que delata la pérdida del bind.
  const cliente: Record<string, unknown> = { rest: { __marker: 'rest' } }
  cliente.from = function (this: { rest?: unknown } | undefined, table: string) {
    if (!this?.rest) throw new Error("Cannot read properties of undefined (reading 'rest')")
    return makeQ(table)
  }
  cliente.rpc = function (this: { rest?: unknown } | undefined, fn: string, args: unknown) {
    rpcCalls.push({ fn, args, thisOk: !!this?.rest })
    if (!this?.rest) throw new Error("Cannot read properties of undefined (reading 'rest')")
    return Promise.resolve(rpcResult)
  }
  const setRpc = (r: { data?: unknown; error?: unknown }) => {
    rpcResult = { data: r.data ?? null, error: r.error ?? null }
  }
  return { cliente, calls, rpcCalls, queues, setRpc }
})

function enqueue(table: string, res: { data?: unknown; error?: unknown }) {
  ;(queues[table] ??= []).push({ data: res.data ?? null, error: res.error ?? null })
}

vi.mock('./supabase', () => ({ supabase: cliente }))

import {
  derivarWorkDays, getPunchExceptions, getPunchesDeJornada, resolvePunchException,
  overrideHorasDia, agruparExcepciones, etiquetaTipo, empleadosConHorasDobles, jornadaBounds,
  resumenImpares, semaforoPago, splitHorasPeriodo, marcasDelCaso, HORAS_DEFAULT_IMPAR,
} from './salarios'

beforeEach(() => {
  calls.length = 0
  rpcCalls.length = 0
  setRpc({})
  for (const k of Object.keys(queues)) delete queues[k]
})

const lastCall = (table: string) => [...calls].reverse().find(c => c.table === table)!
const opArgs = (c: Call, fn: string) => c.ops.find(o => o.fn === fn)?.args

function exc(over: Partial<PunchException> & { id: string; tipo: PunchException['tipo'] }): PunchException {
  return {
    employee_id: null, emp_code: null, work_date: '2026-08-01', local: 'santa-teresa',
    detalle: null, estado: 'abierta', resuelto_by: null, resuelto_at: null,
    created_at: '', updated_at: '', ...over,
  } as PunchException
}

function emp(id: string, full_name: string): Employee {
  return { id, full_name, role: 'cocina', is_active: true } as Employee
}

function wd(over: Partial<WorkDay> & { employee_id: string; source: WorkDay['source'] }): WorkDay {
  return {
    work_date: '2026-08-01', local: 'santa-teresa', hours: 8, es_feriado: false,
    flags: null, created_at: '', updated_at: '', ...over,
  } as WorkDay
}

describe('derivarWorkDays', () => {
  it('invoca la RPC con el rango y el local, y devuelve el resumen', async () => {
    setRpc({ data: { local: 'santa-teresa', dias: 200, horas: 1021.55 } })
    const r = await derivarWorkDays('2026-08-01', '2026-08-15', 'santa-teresa')
    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].fn).toBe('derivar_work_days')
    expect(rpcCalls[0].args).toEqual({
      p_desde: '2026-08-01', p_hasta: '2026-08-15', p_local: 'santa-teresa',
    })
    expect(r.dias).toBe(200)
  })

  // El bug de los créditos de proveedor: sin `.bind(supabase)` el método se desestaca y
  // supabase-js hace `this.rest.…` con this=undefined.
  it('llama la RPC con `this` = el cliente (bind)', async () => {
    setRpc({ data: {} })
    await derivarWorkDays('2026-08-01', '2026-08-15')
    expect(rpcCalls[0].thisOk).toBe(true)
  })

  it('traduce el 42501 de la RLS a un mensaje entendible', async () => {
    setRpc({ error: { message: 'permission denied', code: '42501' } })
    await expect(derivarWorkDays('2026-08-01', '2026-08-15')).rejects.toThrow(/No tenés permiso/)
  })

  it('usa santa-teresa por defecto', async () => {
    setRpc({ data: {} })
    await derivarWorkDays('2026-08-01', '2026-08-15')
    expect((rpcCalls[0].args as { p_local: string }).p_local).toBe('santa-teresa')
  })
})

describe('getPunchExceptions', () => {
  it('filtra por local y rango de jornada', async () => {
    enqueue('punch_exceptions', { data: [exc({ id: 'x1', tipo: 'impar' })] })
    const r = await getPunchExceptions('2026-08-01', '2026-08-15', 'nosara')
    expect(r).toHaveLength(1)
    const c = lastCall('punch_exceptions')
    expect(opArgs(c, 'eq')).toEqual(['local', 'nosara'])
    expect(opArgs(c, 'gte')).toEqual(['work_date', '2026-08-01'])
    expect(opArgs(c, 'lte')).toEqual(['work_date', '2026-08-15'])
  })

  // Null-safe a propósito: esta lectura corre TAMBIÉN en la pantalla de pago, y un error
  // de permisos no puede tumbar la pantalla que mueve plata.
  it('devuelve [] si la base contesta error', async () => {
    enqueue('punch_exceptions', { error: { message: 'nope' } })
    expect(await getPunchExceptions('2026-08-01', '2026-08-15')).toEqual([])
  })
})

describe('jornadaBounds', () => {
  it('acota la jornada de corte a corte, con el offset fijo de Costa Rica', () => {
    expect(jornadaBounds('2026-08-01')).toEqual({
      desde: '2026-08-01T05:00:00-06:00',
      hasta: '2026-08-02T05:00:00-06:00',
    })
  })

  it('cruza fin de mes y fin de año', () => {
    expect(jornadaBounds('2026-08-31').hasta).toBe('2026-09-01T05:00:00-06:00')
    expect(jornadaBounds('2026-12-31').hasta).toBe('2027-01-01T05:00:00-06:00')
  })

  it('respeta un corte distinto del default', () => {
    expect(jornadaBounds('2026-08-01', '06:30').desde).toBe('2026-08-01T06:30:00-06:00')
  })

  it('ante un corte basura cae en 05:00 en vez de armar una fecha inválida', () => {
    expect(jornadaBounds('2026-08-01', 'cualquier cosa').desde).toBe('2026-08-01T05:00:00-06:00')
  })
})

describe('getPunchesDeJornada', () => {
  it('pide las marcas del local entre los bordes de la jornada', async () => {
    enqueue('time_punches', { data: [] })
    await getPunchesDeJornada('santa-teresa', '2026-08-01')
    const c = lastCall('time_punches')
    expect(opArgs(c, 'eq')).toEqual(['local', 'santa-teresa'])
    expect(opArgs(c, 'gte')).toEqual(['punch_at', '2026-08-01T05:00:00-06:00'])
    expect(opArgs(c, 'lt')).toEqual(['punch_at', '2026-08-02T05:00:00-06:00'])
  })
})

// "Ver marcas" no mostraba nada cuando la marca cruda no tenía employee_id resuelto (el
// ingest lo deja null si el emp_code no estaba mapeado al entrar): el filtro las descartaba
// todas y el renglón quedaba vacío, indistinguible de "no hubo marcas".
describe('marcasDelCaso', () => {
  const tp = (over: Partial<TimePunch> & { id: string }): TimePunch => ({
    local: 'santa-teresa', biotime_id: 1, emp_code: '18', employee_id: null,
    punch_at: '2026-08-03T17:00:00Z', punch_state: 'in', terminal: null,
    synced_at: '', created_at: '', updated_at: '', ...over,
  } as TimePunch)

  it('cuando la marca SÍ tiene el empleado, filtra por él', () => {
    const r = marcasDelCaso(
      [tp({ id: 'a', employee_id: 'e1' }), tp({ id: 'b', employee_id: 'e2' })],
      { employee_id: 'e1', emp_code: null },
    )
    expect(r.lista.map(m => m.id)).toEqual(['a'])
    expect(r.ampliado).toBe(false)
  })

  it('si ninguna tiene employee_id, cae al emp_code', () => {
    const r = marcasDelCaso(
      [tp({ id: 'a', emp_code: '18' }), tp({ id: 'b', emp_code: '99' })],
      { employee_id: 'e1', emp_code: '18' },
    )
    expect(r.lista.map(m => m.id)).toEqual(['a'])
    expect(r.ampliado).toBe(false)
  })

  // EL BUG: excepción con employee_id, marcas crudas sin resolver y sin emp_code en la
  // excepción. Antes devolvía [] y la UI mostraba un renglón en blanco.
  it('si ningún criterio matchea, muestra TODAS y lo dice', () => {
    const r = marcasDelCaso(
      [tp({ id: 'a' }), tp({ id: 'b' })],
      { employee_id: 'e1', emp_code: null },
    )
    expect(r.lista.map(m => m.id)).toEqual(['a', 'b'])
    expect(r.ampliado).toBe(true)
  })

  it('sin marcas de verdad no inventa el "ampliado"', () => {
    expect(marcasDelCaso([], { employee_id: 'e1', emp_code: null }))
      .toEqual({ lista: [], ampliado: false })
  })
})

describe('resolvePunchException', () => {
  it('no borra: marca resuelta con quién y cuándo', async () => {
    enqueue('punch_exceptions', { data: null })
    await resolvePunchException('x1', 'u-9')
    const c = lastCall('punch_exceptions')
    const patch = (opArgs(c, 'update') as [Record<string, unknown>])[0]
    expect(patch.estado).toBe('resuelta')
    expect(patch.resuelto_by).toBe('u-9')
    expect(patch.resuelto_at).toBeTruthy()
    expect(opArgs(c, 'eq')).toEqual(['id', 'x1'])
  })
})

describe('overrideHorasDia', () => {
  it('escribe la jornada como MANUAL (lo único que el recálculo no pisa) con su rastro', async () => {
    enqueue('work_days', { data: null })
    await overrideHorasDia({
      employee_id: 'e1', work_date: '2026-08-03', local: 'santa-teresa',
      hours: 7.5, userId: 'u-9', horas_biotime: 0, motivo: '  olvidó marcar salida  ',
    })
    const c = lastCall('work_days')
    const [row, opts] = opArgs(c, 'upsert') as [Record<string, unknown>, { onConflict: string }]
    expect(row.source).toBe('manual')
    expect(row.hours).toBe(7.5)
    expect(opts.onConflict).toBe('employee_id,work_date,local')
    const flags = row.flags as { override: Record<string, unknown> }
    expect(flags.override.by).toBe('u-9')
    expect(flags.override.horas_biotime).toBe(0)
    expect(flags.override.motivo).toBe('olvidó marcar salida')
  })

  it('nunca guarda horas negativas', async () => {
    enqueue('work_days', { data: null })
    await overrideHorasDia({
      employee_id: 'e1', work_date: '2026-08-03', local: 'santa-teresa',
      hours: -4, userId: 'u-9', horas_biotime: null,
    })
    const row = (opArgs(lastCall('work_days'), 'upsert') as [Record<string, unknown>])[0]
    expect(row.hours).toBe(0)
  })
})

describe('agruparExcepciones', () => {
  const EMPLEADOS = [emp('e1', 'NACHO'), emp('e2', 'SELENA')]

  it('agrupa por persona y ordena por cantidad de pendientes', () => {
    const g = agruparExcepciones([
      exc({ id: 'a', tipo: 'impar',       employee_id: 'e1', work_date: '2026-08-02' }),
      exc({ id: 'b', tipo: 'impar',       employee_id: 'e1', work_date: '2026-08-01' }),
      exc({ id: 'c', tipo: 'turno_largo', employee_id: 'e2' }),
    ], EMPLEADOS)
    expect(g.map(x => x.nombre)).toEqual(['NACHO', 'SELENA'])
    expect(g[0].abiertas).toBe(2)
    expect(g[0].tipos).toEqual({ impar: 2 })
    // dentro del grupo, por fecha
    expect(g[0].items.map(i => i.work_date)).toEqual(['2026-08-01', '2026-08-02'])
  })

  it('las sin_mapear no tienen empleado: se agrupan por código y quedan visibles', () => {
    const g = agruparExcepciones([
      exc({ id: 'a', tipo: 'sin_mapear', emp_code: '8', work_date: '2026-07-01' }),
      exc({ id: 'b', tipo: 'sin_mapear', emp_code: '8', work_date: '2026-07-02' }),
    ], EMPLEADOS)
    expect(g).toHaveLength(1)
    expect(g[0].key).toBe('code:8')
    expect(g[0].nombre).toBe('Código 8 (sin empleado)')
    expect(g[0].abiertas).toBe(2)
  })

  it('ignora las ya resueltas', () => {
    const g = agruparExcepciones([
      exc({ id: 'a', tipo: 'impar', employee_id: 'e1', estado: 'resuelta' }),
    ], EMPLEADOS)
    expect(g).toEqual([])
  })

  it('un empleado borrado no rompe la bandeja', () => {
    const g = agruparExcepciones([exc({ id: 'a', tipo: 'impar', employee_id: 'zz' })], EMPLEADOS)
    expect(g[0].nombre).toBe('Empleado desconocido')
  })
})

describe('etiquetaTipo', () => {
  it('traduce los cuatro tipos y deja pasar lo desconocido', () => {
    expect(etiquetaTipo('impar')).toBe('sin par')
    expect(etiquetaTipo('turno_largo')).toBe('turno largo')
    expect(etiquetaTipo('sin_mapear')).toBe('sin mapear')
    expect(etiquetaTipo('solapado')).toBe('solapado')
    expect(etiquetaTipo('marciano')).toBe('marciano')
  })
})

// El override puntual de la bandeja escribe una fila MANUAL con flags.override. Si esa
// fila cae en fecha_fin, antes se confundía con el TOTAL del período cargado a mano y
// frenaba la nómina — el falso positivo real que le pasó a KAREN (11 correcciones, una
// de ellas el 15/08).
describe('empleadosConHorasDobles · override puntual vs total del período', () => {
  const FIN = '2026-08-15'
  const override = (work_date: string, hours: number) => wd({
    employee_id: 'e1', source: 'manual', work_date, hours,
    flags: { override: { by: 'u-1', at: '2026-08-24T16:58:01Z', horas_biotime: 3, motivo: null } },
  })

  it('corregir a mano el ÚLTIMO día NO es doble conteo', () => {
    expect(empleadosConHorasDobles([
      override(FIN, 5),
      wd({ employee_id: 'e1', source: 'biotime', work_date: '2026-08-01', hours: 3 }),
    ], FIN)).toEqual([])
  })

  it('el caso KAREN completo: 11 correcciones + 1 jornada derivada → sin freno', () => {
    const filas = [
      ...['03','05','06','07','08','10','11','12','13','14','15'].map(d => override(`2026-08-${d}`, 5)),
      wd({ employee_id: 'e1', source: 'biotime', work_date: '2026-08-01', hours: 3 }),
    ]
    expect(empleadosConHorasDobles(filas, FIN)).toEqual([])
  })

  it('pero el TOTAL del período cargado a mano (sin flags) SÍ frena', () => {
    expect(empleadosConHorasDobles([
      wd({ employee_id: 'e1', source: 'manual', work_date: FIN, hours: 96 }),
      wd({ employee_id: 'e1', source: 'biotime', work_date: '2026-08-01', hours: 3 }),
    ], FIN)).toEqual(['e1'])
  })
})

describe('empleadosConHorasDobles', () => {
  const FIN = '2026-08-15'

  it('detecta al que tiene el TOTAL del período a mano Y días derivados', () => {
    const r = empleadosConHorasDobles([
      wd({ employee_id: 'e1', source: 'manual',  work_date: FIN, hours: 96 }),
      wd({ employee_id: 'e1', source: 'biotime', work_date: '2026-08-01', hours: 8 }),
      wd({ employee_id: 'e2', source: 'biotime', work_date: '2026-08-01', hours: 8 }),
    ], FIN)
    expect(r).toEqual(['e1'])
  })

  // El override de la bandeja REEMPLAZA la jornada de BioTime (misma PK): el total sigue
  // bien. Marcarlo frenaría el flujo que la propia app recomienda para arreglar fichajes.
  it('corregir un día a mano NO es doble carga', () => {
    const r = empleadosConHorasDobles([
      wd({ employee_id: 'e1', source: 'manual',  work_date: '2026-08-03', hours: 7.5 }),
      wd({ employee_id: 'e1', source: 'biotime', work_date: '2026-08-01', hours: 8 }),
    ], FIN)
    expect(r).toEqual([])
  })

  it('una fila manual en 0 no es doble carga', () => {
    const r = empleadosConHorasDobles([
      wd({ employee_id: 'e1', source: 'manual',  work_date: FIN, hours: 0 }),
      wd({ employee_id: 'e1', source: 'biotime', hours: 8 }),
    ], FIN)
    expect(r).toEqual([])
  })

  // El neto que se paga (splitHorasPeriodo) suma TODAS las filas del rango sin mirar el
  // local: si el guard filtrara por local, quedaría ciego justo donde la plata se duplica.
  it('ve el doble conteo aunque las horas derivadas sean de otro local', () => {
    const filas = [
      wd({ employee_id: 'e1', source: 'manual',  work_date: FIN, local: 'santa-teresa', hours: 96 }),
      wd({ employee_id: 'e1', source: 'biotime', work_date: '2026-08-02', local: 'nosara', hours: 40 }),
    ]
    expect(empleadosConHorasDobles(filas, FIN)).toEqual(['e1'])
    // y esto es lo que efectivamente se paga: 136 h, no 96
    expect(splitHorasPeriodo(filas, 'e1', FIN, 'santa-teresa').total).toBe(136)
  })
})

// La fila editable de la pantalla de pago comparte PK con la jornada del último día: si
// BioTime derivó ese día, el upsert la PISA. `pisadas` es lo que hace que la cuenta cierre.
describe('splitHorasPeriodo · horas que el upsert manual va a pisar', () => {
  const FIN = '2026-08-15'

  it('separa la jornada de BioTime del último día', () => {
    const r = splitHorasPeriodo([
      wd({ employee_id: 'e1', source: 'biotime', work_date: '2026-08-14', hours: 72 }),
      wd({ employee_id: 'e1', source: 'biotime', work_date: FIN,          hours: 8 }),
    ], 'e1', FIN, 'santa-teresa')
    expect(r).toMatchObject({ manual: 0, otras: 80, pisadas: 8, total: 80 })
    // el que guarda tiene que restar SOLO lo que sobrevive (72), no las 80
    expect(r.otras - r.pisadas).toBe(72)
  })

  it('sin jornada derivada el último día no hay nada que pisar', () => {
    const r = splitHorasPeriodo([
      wd({ employee_id: 'e1', source: 'biotime', work_date: '2026-08-14', hours: 72 }),
    ], 'e1', FIN, 'santa-teresa')
    expect(r.pisadas).toBe(0)
  })

  it('la jornada pisable de OTRO local no cuenta (el upsert escribe en el suyo)', () => {
    const r = splitHorasPeriodo([
      wd({ employee_id: 'e1', source: 'biotime', work_date: FIN, local: 'nosara', hours: 8 }),
    ], 'e1', FIN, 'santa-teresa')
    expect(r).toMatchObject({ otras: 8, pisadas: 0, total: 8 })
  })
})

// ── La regla de las 3 h (mig 059) vista desde la app ──────────────────────────────
// El emparejamiento y el `case when tiene_par` viven en SQL; acá se prueba que la app
// LEA bien el origen de las horas — que es lo que decide qué ve el contador.

describe('resumenImpares', () => {
  // Los flags tal cual los escribe la mig 059 (A8). El emparejamiento vive en SQL; acá se
  // prueba que la app LEA bien el desglose — que es lo que decide qué ve el contador.
  const dia = (work_date: string, o: {
    pares?: number; horas_pares?: number; tramos?: number
  }) => wd({
    employee_id: 'e1', source: 'biotime', work_date,
    hours: (o.horas_pares ?? 0) + (o.tramos ?? 0) * 3,
    flags: {
      pares:             o.pares ?? 0,
      horas_pares:       o.horas_pares ?? 0,
      tramos_sin_cerrar: o.tramos ?? 0,
      horas_default:     (o.tramos ?? 0) * 3,
      horas_origen: (o.tramos ?? 0) === 0 ? 'biotime' : (o.pares ?? 0) === 0 ? 'default' : 'mixto',
    },
  })

  it('separa las horas medidas de las que puso la regla', () => {
    const r = resumenImpares([
      dia('2026-08-01', { pares: 1, horas_pares: 8 }),                 // completo
      dia('2026-08-02', { tramos: 1 }),                                // solo default
      dia('2026-08-03', { pares: 1, horas_pares: 4, tramos: 1 }),      // MIXTO: turno cortado
    ]).get('e1')!
    expect(r.dias).toBe(3)
    expect(r.diasIncompletos).toBe(2)
    expect(r.tramos).toBe(2)
    expect(r.horasMedidas).toBe(12)
    expect(r.horasDefault).toBe(6)
  })

  // El caso que la regla a nivel DÍA perdía: el día mixto tiene que aparecer en las DOS
  // columnas. Si solo contara como "medido", el contador no vería nunca sus 3 h de default.
  it('el día mixto cuenta en las dos columnas', () => {
    const r = resumenImpares([dia('2026-08-03', { pares: 1, horas_pares: 4, tramos: 1 })]).get('e1')!
    expect(r.diasIncompletos).toBe(1)
    expect(r.horasMedidas).toBe(4)
    expect(r.horasDefault).toBe(3)
  })

  it('un día completo no aporta nada al default', () => {
    const r = resumenImpares([dia('2026-08-01', { pares: 2, horas_pares: 9.5 })]).get('e1')!
    expect(r.diasIncompletos).toBe(0)
    expect(r.tramos).toBe(0)
    expect(r.horasDefault).toBe(0)
    expect(r.horasMedidas).toBe(9.5)
  })

  it('varios tramos en el mismo día suman todos', () => {
    const r = resumenImpares([dia('2026-08-01', { tramos: 2 })]).get('e1')!
    expect(r.diasIncompletos).toBe(1)   // sigue siendo UN día
    expect(r.tramos).toBe(2)
    expect(r.horasDefault).toBe(6)
  })

  it('ignora lo cargado a mano y lo de otro local', () => {
    const r = resumenImpares([
      dia('2026-08-01', { tramos: 1 }),
      wd({ employee_id: 'e1', source: 'biotime', work_date: '2026-08-02', local: 'nosara',
           hours: 3, flags: { tramos_sin_cerrar: 1, horas_default: 3, horas_pares: 0 } }),
      wd({ employee_id: 'e1', source: 'manual', work_date: '2026-08-15', hours: 96 }),
    ], 'santa-teresa').get('e1')!
    expect(r.dias).toBe(1)
    expect(r.tramos).toBe(1)
  })

  // Filas viejas (derivadas antes de A8) no tienen el desglose: no se puede inventar, pero
  // tampoco se puede contar 8 h medidas como default ni al revés.
  it('una jornada sin flags cae del lado de lo medido, no del default', () => {
    const r = resumenImpares([
      wd({ employee_id: 'e1', source: 'biotime', work_date: '2026-08-01', hours: 5, flags: null }),
    ]).get('e1')!
    expect(r).toMatchObject({ dias: 1, diasIncompletos: 0, tramos: 0, horasDefault: 0, horasMedidas: 5 })
  })
})

describe('semaforoPago', () => {
  const FIN = '2026-08-15'
  const ex = (tipo: PunchException['tipo'], over: Partial<PunchException> = {}) =>
    exc({ id: `${tipo}-${over.work_date ?? 'x'}-${over.emp_code ?? over.employee_id ?? 'y'}`, tipo, ...over })

  it('impar, solapado y turno_largo son AVISO; sin_mapear va aparte', () => {
    const s = semaforoPago([
      ex('impar',       { employee_id: 'e1', work_date: '2026-08-01' }),
      ex('solapado',    { employee_id: 'e1', work_date: '2026-08-02' }),
      ex('turno_largo', { employee_id: 'e2', work_date: '2026-08-03' }),
      ex('sin_mapear',  { employee_id: null, emp_code: '8', work_date: '2026-08-04', detalle: { cuantas: 2 } }),
    ], [], FIN)
    expect(s.fichajeDias).toBe(3)
    expect(s.sinMapearDias).toBe(1)
    expect(s.sinMapearMarcas).toBe(2)
    expect(s.dobles).toEqual([])
  })

  // La 059 emite UNA fila por tipo: una jornada `in,in` genera solapado + impar. Son dos
  // filas y UN día; contar filas inflaría el desorden justo donde alguien decide si paga.
  it('cuenta JORNADAS, no filas de excepción', () => {
    const s = semaforoPago([
      ex('impar',    { employee_id: 'e1', work_date: '2026-08-03' }),
      ex('solapado', { employee_id: 'e1', work_date: '2026-08-03' }),
    ], [], FIN)
    expect(s.fichajeDias).toBe(1)
  })

  it('las resueltas no cuentan', () => {
    const s = semaforoPago([ex('impar', { employee_id: 'e1', estado: 'resuelta' })], [], FIN)
    expect(s.fichajeDias).toBe(0)
  })

  // El aviso de las 3 h sale de work_days.flags, NO del estado de la excepción: resolver
  // la bandeja no cambia un colón de lo que se paga, así que no puede apagar la señal.
  it('las horas default siguen avisando aunque la excepción esté resuelta', () => {
    const filas = [
      wd({ employee_id: 'e1', source: 'biotime', work_date: '2026-08-03', hours: 3,
           flags: { horas_pares: 0, tramos_sin_cerrar: 1, horas_default: 3 } }),
      wd({ employee_id: 'e1', source: 'biotime', work_date: '2026-08-04', hours: 7,
           flags: { horas_pares: 4, tramos_sin_cerrar: 1, horas_default: 3 } }),
    ]
    const s = semaforoPago([ex('impar', { employee_id: 'e1', estado: 'resuelta' })], filas, FIN)
    expect(s.fichajeDias).toBe(0)
    expect(s.diasIncompletos).toBe(2)
    expect(s.tramos).toBe(2)
    expect(s.horasDefault).toBe(6)
  })

  it('marca el doble conteo: total a mano + días derivados del mismo empleado', () => {
    const s = semaforoPago([], [
      wd({ employee_id: 'e1', source: 'manual',  work_date: FIN, hours: 96 }),
      wd({ employee_id: 'e1', source: 'biotime', work_date: '2026-08-01', hours: 8 }),
      wd({ employee_id: 'e2', source: 'biotime', work_date: '2026-08-01', hours: 8 }),
    ], FIN)
    expect(s.dobles).toEqual(['e1'])
  })

  // Un inactivo con horas viejas no puede frenar la nómina de los demás: su línea ni
  // siquiera se muestra en la pantalla de pago.
  it('solo mira a los empleados que se están pagando', () => {
    const filas = [
      wd({ employee_id: 'e9', source: 'manual',  work_date: FIN, hours: 96 }),
      wd({ employee_id: 'e9', source: 'biotime', work_date: '2026-08-01', hours: 3,
           flags: { horas_pares: 0, tramos_sin_cerrar: 1, horas_default: 3 } }),
    ]
    const conE9 = semaforoPago([ex('impar', { employee_id: 'e9' })], filas, FIN, ['e9'])
    const sinE9 = semaforoPago([ex('impar', { employee_id: 'e9' })], filas, FIN, ['e1'])
    expect(conE9.dobles).toEqual(['e9'])
    expect(conE9.fichajeDias).toBe(1)
    expect(sinE9.dobles).toEqual([])
    expect(sinE9.fichajeDias).toBe(0)
    expect(sinE9.diasIncompletos).toBe(0)
    expect(sinE9.horasDefault).toBe(0)
  })

  it('las marcas sin empleado cuentan SIEMPRE: no hay a quién acotarlas', () => {
    const s = semaforoPago(
      [ex('sin_mapear', { employee_id: null, emp_code: '8', detalle: { cuantas: 4 } })],
      [], FIN, ['e1'],
    )
    expect(s.sinMapearDias).toBe(1)
    expect(s.sinMapearMarcas).toBe(4)
  })
})

// ── El puente TS ↔ SQL ──────────────────────────────────────────────────────────
// La política de las 3 h vive hardcodeada en dos idiomas (la constante y el `else 3` de
// la mig 059). Este test los ATA: si alguien mueve uno solo, falla acá — que es
// exactamente lo que va a pasar cuando el contador diga que el default es otro número.
describe('HORAS_DEFAULT_IMPAR ↔ mig 059', () => {
  const MIG = readFileSync(
    fileURLToPath(new URL('../../../supabase/migrations/059_derivar_work_days.sql', import.meta.url)),
    'utf8',
  )

  it('`v_default_h` de la 059 es el mismo número que usa la app', () => {
    const m = MIG.match(/v_default_h\s+numeric\s*:=\s*(\d+(?:\.\d+)?)\s*;/)
    expect(m, 'no se encontró v_default_h en la 059').toBeTruthy()
    expect(Number(m![1])).toBe(HORAS_DEFAULT_IMPAR)
  })

  it('la migración sigue calculando POR TRAMO y dejando el desglose en flags', () => {
    // el corazón de A8: pares + tramos × default, no un case por día
    expect(MIG).toMatch(/c\.horas_pares\s*\+\s*\(c\.tramos_sin_cerrar\s*\*\s*v_default_h\)/)
    expect(MIG).toMatch(/\(a\.impar_in\s*\+\s*a\.impar_out\s*\+\s*a\.solapados\)\s+as\s+tramos_sin_cerrar/)
    for (const k of ['horas_pares', 'tramos_sin_cerrar', 'horas_default', 'horas_origen']) {
      expect(MIG).toContain(`'${k}'`)
    }
  })
})
