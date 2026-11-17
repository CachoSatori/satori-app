// Resumen semanal: las ventas de la semana a partir de los días del PoS (16-nov: nunca más xls).
import type { DiasMap } from '../../shared/types/ventas'
import { totalesDelDia } from '../ventas/totalesVentas'

export interface DiaSemana { fecha: string; ventaNeta: number; pax: number }

/**
 * Las ventas de la semana a partir de los días del PoS. PURA: se prueba sin base.
 * Totales del día con `totalesDelDia` (la suma del módulo Ventas); ranking de saloneros con los
 * buckets que NO son caja, como antes.
 */
export function ventasDeLaSemana(dias: DiasMap) {
  let ventaNeta = 0, ventaBruta = 0, pax = 0
  const days: DiaSemana[] = []
  const salMap: Record<string, { total: number; pax: number; days: number }> = {}

  for (const [fecha, dia] of Object.entries(dias)) {
    const t = totalesDelDia(dia)
    for (const [name, s] of Object.entries(dia.saloneros ?? {})) {
      if ((s as { esCajero?: boolean }).esCajero) continue
      const sl = s as { total?: number; pax?: number }
      const k = name.toUpperCase().trim()
      if (!salMap[k]) salMap[k] = { total: 0, pax: 0, days: 0 }
      salMap[k].total += sl.total ?? 0
      salMap[k].pax   += sl.pax ?? 0
      salMap[k].days++
    }
    ventaNeta  += t.ventaNeta
    ventaBruta += t.ventaBruta
    pax        += t.pax
    days.push({ fecha, ventaNeta: t.ventaNeta, pax: t.pax })
  }
  return { ventaNeta, ventaBruta, pax, days, salMap }
}

