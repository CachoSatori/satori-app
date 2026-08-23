import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Employee, PunchException, WorkDay } from '../types/database'

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

describe('empleadosConHorasDobles', () => {
  it('detecta al que tiene total cargado a mano Y días derivados', () => {
    const r = empleadosConHorasDobles([
      wd({ employee_id: 'e1', source: 'manual',  work_date: '2026-08-15', hours: 96 }),
      wd({ employee_id: 'e1', source: 'biotime', work_date: '2026-08-01', hours: 8 }),
      wd({ employee_id: 'e2', source: 'biotime', work_date: '2026-08-01', hours: 8 }),
    ])
    expect(r).toEqual(['e1'])
  })

  it('una fila manual en 0 no es doble carga', () => {
    const r = empleadosConHorasDobles([
      wd({ employee_id: 'e1', source: 'manual',  hours: 0 }),
      wd({ employee_id: 'e1', source: 'biotime', hours: 8 }),
    ])
    expect(r).toEqual([])
  })
})
