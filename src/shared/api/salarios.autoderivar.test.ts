import { describe, it, expect } from 'vitest'
import {
  debeAutoDerivar, participaPorRolDefault, cocinaConServicio, codigosSinMapear,
  normalizarCodigoBiotime, empleadoDeCodigo, codigosSinMapearConDuenio,
} from './salarios'
import type { Employee, PunchException, WorkDay } from '../types/database'

// v3 · las guardas de la derivación automática, el default del 10% por puesto y la
// lista de códigos huérfanos. Todo lógica pura: sin red, sin base.

const wd = (local: string): Pick<WorkDay, 'local'> => ({ local }) as Pick<WorkDay, 'local'>

describe('debeAutoDerivar', () => {
  it('deriva un período ABIERTO sin horas en ese local', () => {
    expect(debeAutoDerivar('abierto', [], 'santa-teresa')).toBe(true)
  })

  it('deriva uno EN REVISIÓN sin horas', () => {
    expect(debeAutoDerivar('en_revision', [], 'santa-teresa')).toBe(true)
  })

  it('NO toca un período CERRADO, ni aunque esté vacío', () => {
    // Congelado es congelado: derivar acá lo descongelaría de hecho, sin reapertura.
    expect(debeAutoDerivar('cerrado', [], 'santa-teresa')).toBe(false)
  })

  it('NO toca un período PAGADO', () => {
    expect(debeAutoDerivar('pagado', [], 'santa-teresa')).toBe(false)
  })

  it('NO deriva si YA hay horas en ese local', () => {
    // Con horas cargadas, derivar solo sería pisar trabajo hecho sin que lo pidan.
    expect(debeAutoDerivar('abierto', [wd('santa-teresa')], 'santa-teresa')).toBe(false)
  })

  it('mira SOLO el local pedido: horas de otro local no cuentan como cargadas', () => {
    expect(debeAutoDerivar('abierto', [wd('nosara')], 'santa-teresa')).toBe(true)
  })
})

describe('participaPorRolDefault', () => {
  it('cocina arranca SIN 10% de servicio', () => {
    expect(participaPorRolDefault('cocina')).toBe(false)
  })

  it('salón y barra arrancan CON 10%', () => {
    for (const r of ['salonero', 'runner', 'barman', 'barback'] as const) {
      expect(participaPorRolDefault(r)).toBe(true)
    }
  })
})

const emp = (o: Partial<Employee>): Employee => ({
  id: 'e1', full_name: 'X', role: 'cocina', profile_id: null, is_active: true,
  pos_name: null, created_at: '', updated_at: '', ...o,
} as Employee)

describe('cocinaConServicio', () => {
  it('lista la cocina ACTIVA que hoy cobra el 10%', () => {
    const r = cocinaConServicio([
      emp({ id: 'a', full_name: 'ANGELA', role: 'cocina', participa_servicio: true }),
      emp({ id: 'b', full_name: 'JUDITH', role: 'cocina', participa_servicio: false }),
      emp({ id: 'c', full_name: 'KAREN',  role: 'salonero', participa_servicio: true }),
    ])
    expect(r.map(e => e.full_name)).toEqual(['ANGELA'])
  })

  it('cuenta al que NO trae el flag: el default de la base es true', () => {
    const r = cocinaConServicio([emp({ id: 'a', full_name: 'JOTA', role: 'cocina' })])
    expect(r).toHaveLength(1)
  })

  it('ignora inactivos: no cobran nada', () => {
    const r = cocinaConServicio([
      emp({ id: 'a', full_name: 'VIEJO', role: 'cocina', participa_servicio: true, is_active: false }),
    ])
    expect(r).toEqual([])
  })
})

const exc = (o: Partial<PunchException>): PunchException => ({
  id: 'x', employee_id: null, emp_code: null, work_date: '2026-08-01', local: 'santa-teresa',
  tipo: 'sin_mapear', detalle: null, estado: 'abierta', resuelto_by: null, resuelto_at: null,
  created_at: '', updated_at: '', ...o,
} as PunchException)

describe('codigosSinMapear', () => {
  it('agrupa por código y cuenta jornadas distintas', () => {
    const r = codigosSinMapear([
      exc({ id: '1', emp_code: '41', work_date: '2026-08-01' }),
      exc({ id: '2', emp_code: '41', work_date: '2026-08-02' }),
      exc({ id: '3', emp_code: '7',  work_date: '2026-08-01' }),
    ])
    expect(r).toEqual([
      { code: '41', dias: 2, marcas: 2 },
      { code: '7',  dias: 1, marcas: 1 },
    ])
  })

  it('ignora las que ya se resolvieron y las de otro tipo', () => {
    const r = codigosSinMapear([
      exc({ id: '1', emp_code: '41', estado: 'resuelta' }),
      exc({ id: '2', emp_code: '9', tipo: 'impar' }),
    ])
    expect(r).toEqual([])
  })

  it('descarta el código vacío: no hay nada que mapear', () => {
    expect(codigosSinMapear([exc({ emp_code: '  ' })])).toEqual([])
  })
})


// ╔══════════════════════════════════════════════════════════════════════════════════════╗
// ║ EL MATCH código BioTime ↔ empleado (v3, fix del piloto)                                ║
// ╚══════════════════════════════════════════════════════════════════════════════════════╝
// Dos fallas reales del piloto: el código matcheaba por igualdad de TEXTO (y BioTime numera
// con ceros a la izquierda según cómo se cargó el usuario), y la bandeja mostraba como
// huérfano un código que YA estaba en una ficha, sin decirlo. Cada una vale horas que no se
// le pagan a nadie, sin que nada falle.

const empCod = (id: string, nombre: string, code: string | null): Employee =>
  ({ id, full_name: nombre, role: 'cocina', is_active: true, biotime_emp_code: code } as Employee)

describe('normalizarCodigoBiotime', () => {
  it('los ceros a la izquierda no hacen a otro usuario del reloj', () => {
    expect(normalizarCodigoBiotime('04')).toBe('4')
    expect(normalizarCodigoBiotime('0004')).toBe('4')
    expect(normalizarCodigoBiotime('4')).toBe('4')
    expect(normalizarCodigoBiotime(' 4 ')).toBe('4')
  })

  it('un código que no es numérico se compara sin espacios y en minúsculas, nada más', () => {
    expect(normalizarCodigoBiotime(' A7 ')).toBe('a7')
    expect(normalizarCodigoBiotime('a7')).toBe('a7')
    // Y NO se le comen ceros: '0A' no es 'A'.
    expect(normalizarCodigoBiotime('0A')).toBe('0a')
  })

  it('vacío, espacios y null son "sin código"', () => {
    expect(normalizarCodigoBiotime('')).toBe('')
    expect(normalizarCodigoBiotime('   ')).toBe('')
    expect(normalizarCodigoBiotime(null)).toBe('')
    expect(normalizarCodigoBiotime(undefined)).toBe('')
  })

  it('no confunde 0 con vacío: el usuario 0 del reloj existe', () => {
    expect(normalizarCodigoBiotime('0')).toBe('0')
  })
})

describe('empleadoDeCodigo', () => {
  // Los códigos reales del reloj de Santa Teresa.
  const PLANTEL = [
    empCod('e4',  'FRAN',   '4'),
    empCod('e10', 'LESTER', '10'),
    empCod('e25', 'AMPI',   '25'),
    empCod('e0',  'NUEVO',  null),
  ]

  it('encuentra a la persona por su código', () => {
    expect(empleadoDeCodigo('10', PLANTEL)?.full_name).toBe('LESTER')
  })

  it('«04» del reloj es el «4» de la ficha', () => {
    expect(empleadoDeCodigo('04', PLANTEL)?.full_name).toBe('FRAN')
    expect(empleadoDeCodigo(' 25 ', PLANTEL)?.full_name).toBe('AMPI')
  })

  it('un código que nadie tiene devuelve null (no el primero de la lista)', () => {
    expect(empleadoDeCodigo('99', PLANTEL)).toBeNull()
  })

  it('un código vacío nunca matchea a quien no tiene código cargado', () => {
    expect(empleadoDeCodigo('', PLANTEL)).toBeNull()
    expect(empleadoDeCodigo('   ', PLANTEL)).toBeNull()
  })
})

describe('codigosSinMapearConDuenio', () => {
  it('separa el código que nadie tiene del que YA está en una ficha', () => {
    const r = codigosSinMapearConDuenio(
      [
        exc({ id: '1', emp_code: '4',  work_date: '2026-08-16' }),   // FRAN ya lo tiene
        exc({ id: '2', emp_code: '99', work_date: '2026-08-16' }),   // de nadie
      ],
      [empCod('e4', 'FRAN', '4')],
    )
    expect(r.find(c => c.code === '4')?.duenio?.full_name).toBe('FRAN')
    expect(r.find(c => c.code === '99')?.duenio).toBeNull()
  })

  it('el dueño se encuentra aunque el reloj mande el código con cero adelante', () => {
    const r = codigosSinMapearConDuenio(
      [exc({ id: '1', emp_code: '04' })],
      [empCod('e4', 'FRAN', '4')],
    )
    expect(r[0].duenio?.full_name).toBe('FRAN')
  })

  it('conserva los conteos de la lista original', () => {
    const r = codigosSinMapearConDuenio(
      [
        exc({ id: '1', emp_code: '41', work_date: '2026-08-01' }),
        exc({ id: '2', emp_code: '41', work_date: '2026-08-02' }),
      ],
      [],
    )
    expect(r).toEqual([{ code: '41', dias: 2, marcas: 2, duenio: null }])
  })
})
