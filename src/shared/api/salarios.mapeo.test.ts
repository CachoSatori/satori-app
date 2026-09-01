import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Employee } from '../types/database'

// ╔══════════════════════════════════════════════════════════════════════════════════════╗
// ║ ASIGNAR UN CÓDIGO DE BIOTIME desde la bandeja de Horas (v3, fix del piloto)            ║
// ╚══════════════════════════════════════════════════════════════════════════════════════╝
// La escritura: qué se guarda, qué NO se toca, y el guard de duplicado — que es lo único
// que puede costar plata acá. Dos personas con el mismo usuario del reloj es una de las dos
// cobrando las horas de la otra.

interface Op { fn: string; args: unknown[] }
const ops: Op[] = []
let updateError: { message: string } | null = null

const q = {
  update: (...args: unknown[]) => { ops.push({ fn: 'update', args }); return q },
  eq:     (...args: unknown[]) => { ops.push({ fn: 'eq', args }); return Promise.resolve({ error: updateError }) },
}
const tablas: string[] = []
vi.mock('./supabase', () => ({
  supabase: { from: (t: string) => { tablas.push(t); return q } },
}))

const { asignarCodigoBiotime } = await import('./salarios')

const emp = (id: string, nombre: string, code: string | null): Employee =>
  ({ id, full_name: nombre, role: 'cocina', is_active: true, biotime_emp_code: code } as Employee)

const PLANTEL = [emp('e4', 'FRAN', '4'), emp('e26', 'FEDE', null)]

beforeEach(() => { ops.length = 0; tablas.length = 0; updateError = null })

describe('asignarCodigoBiotime', () => {
  it('escribe SOLO biotime_emp_code, en employees, sobre esa persona', async () => {
    await asignarCodigoBiotime('e26', '26', PLANTEL)
    expect(tablas).toEqual(['employees'])
    expect(ops.find(o => o.fn === 'update')?.args[0]).toEqual({ biotime_emp_code: '26' })
    expect(ops.find(o => o.fn === 'eq')?.args).toEqual(['id', 'e26'])
    // Nada de tarifas, ni horarios, ni el flag del 10%: esta pantalla asigna un código.
    const payload = ops.find(o => o.fn === 'update')?.args[0] as Record<string, unknown>
    expect(Object.keys(payload)).toEqual(['biotime_emp_code'])
  })

  it('guarda el código TAL CUAL lo manda BioTime, sin normalizar el dato de origen', async () => {
    // La forma canónica es para COMPARAR. Pisar el dato con "4" perdería cómo está
    // realmente cargado el usuario en el reloj.
    await asignarCodigoBiotime('e26', '026', PLANTEL)
    expect(ops.find(o => o.fn === 'update')?.args[0]).toEqual({ biotime_emp_code: '026' })
  })

  it('recorta los espacios: " 26 " y "26" son el mismo código, no dos', async () => {
    await asignarCodigoBiotime('e26', '  26  ', PLANTEL)
    expect(ops.find(o => o.fn === 'update')?.args[0]).toEqual({ biotime_emp_code: '26' })
  })

  it('un código que YA es de otro REBOTA, con el nombre, y no escribe nada', async () => {
    await expect(asignarCodigoBiotime('e26', '4', PLANTEL)).rejects.toThrow(/ya es de FRAN/)
    expect(ops).toEqual([])
  })

  it('el duplicado se detecta en forma canónica: "04" no entra si alguien tiene "4"', async () => {
    // Sin esto, el índice único de la mig 055 vería dos textos distintos y dejaría a dos
    // personas cobrando las horas del mismo usuario del reloj.
    await expect(asignarCodigoBiotime('e26', '04', PLANTEL)).rejects.toThrow(/ya es de FRAN/)
    expect(ops).toEqual([])
  })

  it('reasignarle a alguien el código que YA tiene no es un duplicado', async () => {
    await asignarCodigoBiotime('e4', '4', PLANTEL)
    expect(ops.find(o => o.fn === 'update')?.args[0]).toEqual({ biotime_emp_code: '4' })
  })

  it('un código vacío rebota antes de tocar la base', async () => {
    await expect(asignarCodigoBiotime('e26', '   ', PLANTEL)).rejects.toThrow(/no puede quedar vacío/)
    expect(ops).toEqual([])
  })

  it('si la base rechaza (red del índice único), el error sale a la pantalla', async () => {
    updateError = { message: 'El código de BioTime «26» ya está asignado a otro empleado.' }
    await expect(asignarCodigoBiotime('e26', '26', PLANTEL)).rejects.toThrow(/ya está asignado/)
  })
})
