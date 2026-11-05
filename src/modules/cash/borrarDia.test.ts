import { describe, it, expect } from 'vitest'
import { planBorradoDia, diaOperativoBorrado, resumenPorDia, textoConfirmacionBorrado, type MovimientoBorrable } from './borrarDia'

// Casos REALES de prod (movement_deletions, diagnóstico del 05/11). Horas en UTC; CR = UTC−6.
const mov = (p: Partial<MovimientoBorrable> & { id: string; created_at: string }): MovimientoBorrable => ({
  session_id: null, subcategory: '', description: '', amount_crc: 0, amount_usd: 0, movement_type: 'ingreso', ...p,
} as MovimientoBorrable)

// «Borrar TODO» del 20/10 (21/10 04:28 UTC): se llevó el cierre del 19/10, sellado a las 00:31 CR del 20/10.
const ventas1910 = mov({ id: 'v1910', subcategory: 'Ventas cierre', description: 'Ventas efectivo Noche 2026-10-19', amount_crc: 15600, amount_usd: 100, created_at: '2026-10-20T06:31:38Z' })
const ajuste1910 = mov({ id: 'a1910', subcategory: 'Ajuste de cierre', description: 'Ajuste de cierre 2026-10-19 · Sobrante · ajuste corresponde al problema del 18/10', amount_crc: 54106.70, created_at: '2026-10-20T06:31:39Z' })

// «Borrar TODO» del 20/07: se llevó las ventas del cierre del 19/07 (selladas el 20/07 15:07 CR) y
// las propinas del 17/07 (fila sin turno con created_at sintético a las 06:00 CR del 20/07).
const ventasM1907 = mov({ id: 'vm1907', subcategory: 'Ventas cierre', description: 'Ventas efectivo Mediodía 2026-07-19', amount_crc: 6973, created_at: '2026-07-20T21:07:00Z' })
const ventasN1907 = mov({ id: 'vn1907', subcategory: 'Ventas cierre', description: 'Ventas efectivo Noche 2026-07-19', amount_crc: -26089.81, amount_usd: 100, created_at: '2026-07-20T21:07:00Z' })
const propinas1707 = mov({ id: 'p1707', subcategory: 'Propinas por turno', movement_type: 'egreso_personal', description: 'Propinas turno 2026-07-17 Noche', amount_crc: 70775, created_at: '2026-07-20T12:00:00Z' })
const propinas2007 = mov({ id: 'p2007', subcategory: 'Propinas por turno', movement_type: 'egreso_personal', description: 'Propinas turno 2026-07-20 Noche', amount_crc: 57480, created_at: '2026-07-20T12:00:00Z' })

const sinTurnos = new Map<string, string>()

describe('borrarDia — el «Borrar TODO» elige por día operativo, no por created_at', () => {
  it('20/10: NO borra el cierre del 19/10 sellado después de medianoche (lo lista como ajeno)', () => {
    const plan = planBorradoDia('2026-10-20', [], [ventas1910, ajuste1910], sinTurnos)
    expect(plan.borrar).toEqual([])
    expect(plan.ajenas.map(f => [f.id, f.diaOperativo])).toEqual([['v1910', '2026-10-19'], ['a1910', '2026-10-19']])
  })

  it('20/07: NO borra las ventas del 19/07 ni las propinas del 17/07; SÍ las propinas del 20/07', () => {
    const plan = planBorradoDia('2026-07-20', [], [propinas1707, propinas2007, ventasM1907, ventasN1907], sinTurnos)
    expect(plan.borrar.map(f => f.id)).toEqual(['p2007'])
    expect(plan.ajenas.map(f => [f.id, f.diaOperativo])).toEqual([
      ['p1707', '2026-07-17'], ['vm1907', '2026-07-19'], ['vn1907', '2026-07-19'],
    ])
    expect(plan.borrar.some(f => f.diaOperativo !== '2026-07-20')).toBe(false)
  })

  it('al borrar el 19/10 SÍ incluye su cierre aunque se haya creado el 20/10', () => {
    const plan = planBorradoDia('2026-10-19', [], [ventas1910, ajuste1910], sinTurnos)
    expect(plan.borrar.map(f => f.id)).toEqual(['v1910', 'a1910'])
    expect(plan.ajenas).toEqual([])
  })

  it('movimiento manual sin turno → día de created_at (CR) y marcado como manual', () => {
    const traspaso = mov({ id: 't1', subcategory: 'Banco → Caja Fuerte', movement_type: 'traspaso', description: 'INE ingreso bco a CF', amount_crc: 200000, created_at: '2026-10-20T07:15:00Z' }) // 01:15 CR del 20/10
    const plan = planBorradoDia('2026-10-20', [], [traspaso], sinTurnos)
    expect(plan.borrar).toHaveLength(1)
    expect(plan.borrar[0]).toMatchObject({ id: 't1', manual: true, diaOperativo: '2026-10-20' })
  })

  it('la fecha de FACTURA de un proveedor no es día operativo: no se borra ni se avisa', () => {
    // Traída por el filtro de descripción («fact 2026-10-20») pero creada el 22/10 y sin patrón del sistema.
    const prov = mov({ id: 'pr1', subcategory: 'Proveedor mercadería', movement_type: 'egreso_mercaderia', description: '0184 · fact 2026-10-20', amount_crc: 21379.54, created_at: '2026-10-22T18:00:00Z' })
    const plan = planBorradoDia('2026-10-20', [], [prov], sinTurnos)
    expect(plan.borrar).toEqual([])
    expect(plan.ajenas).toEqual([])
  })

  it('con turno manda el session_date del turno (turno que cruza medianoche)', () => {
    const t = mov({ id: 'm1', session_id: 's-1910', subcategory: 'Proveedor mercadería', description: 'pago', amount_crc: 1000, created_at: '2026-10-20T06:30:00Z' })
    const sesionFecha = new Map([['s-1910', '2026-10-19']])
    const plan = planBorradoDia('2026-10-19', [t], [], sesionFecha)
    expect(plan.borrar).toHaveLength(1)
    expect(plan.borrar[0]).toMatchObject({ origen: 'turno', diaOperativo: '2026-10-19' })
    // «Propinas turno» con turno: manda el turno, no la descripción
    expect(diaOperativoBorrado(mov({ id: 'x', session_id: 's-1910', description: 'Propinas turno 2026-10-17 Noche', created_at: '2026-10-20T06:30:00Z' }), sesionFecha)).toBe('2026-10-19')
  })

  it('no duplica una fila que llega por los dos filtros (creación + descripción)', () => {
    const plan = planBorradoDia('2026-10-20', [], [propinas2007, propinas2007].map(p => ({ ...p, description: 'Propinas turno 2026-10-20 Noche', created_at: '2026-10-20T12:00:00Z' })), sinTurnos)
    expect(plan.borrar).toHaveLength(1)
  })

  it('resumen y texto de confirmación: montos ₡/US$ por día, aviso de ajenas y propinas bien explicadas', () => {
    const plan = planBorradoDia('2026-10-20', [], [ventas1910, ajuste1910, propinas2007, mov({ id: 'm', description: 'DUEÑO TOMI', amount_crc: 5000, created_at: '2026-10-20T15:00:00Z' })], sinTurnos)
    expect(resumenPorDia(plan.borrar)).toEqual([{ dia: '2026-10-20', filas: 1, crc: 5000, usd: 0 }])
    const txt = textoConfirmacionBorrado(plan, n => `₡${n}`)
    expect(txt).toContain('2026-10-20: 1 mov. · ₡5000 · US$ 0.00')
    expect(txt).toContain('09:00 · ₡5000')                         // manual con hora de carga (CR)
    expect(txt).toContain('2 movimiento(s) se cargaron el 2026-10-20 pero son de OTRO día operativo. NO se borran')
    expect(txt).toContain('día 2026-10-19 · ₡54106.7')
    expect(txt).toContain('Se borran los PAGOS de propinas del día')
    expect(txt).not.toContain('NO toca propinas')
  })
})
