// Los totales de ventas que muestran las pantallas FUERA del módulo Ventas (Resumen del día y de
// la semana, Inicio, Inventario, Finanzas). Antes cada una sumaba `ventas_dias` (xls) a su manera;
// desde el 16-nov leen el PoS (`ventasDelRango`) y suman con `getDayStats`, la MISMA función que
// usa el módulo Ventas: un día da el mismo número en todas las pantallas.
//
// Ojo, diferencias contra las sumas viejas (los días del PoS traen dos datos que el xls no tenía):
//   · el delivery de un mesero va a delivery, no a salón;
//   · el pax de los tickets de salón cobrados con login de caja SÍ cuenta.
import type { DiaData, DiasMap } from '../../shared/types/ventas'
import { getDayStats } from './ventasUtils'

export interface TotalesVentas {
  ventaNeta:  number
  ventaBruta: number
  iva:        number
  serv:       number
  salon:      number
  delivery:   number
  pax:        number
  /** salón / pax (la definición de la app). */
  promPax:    number
  /** Días con venta neta > 0. */
  dias:       number
}

const CERO: TotalesVentas = { ventaNeta: 0, ventaBruta: 0, iva: 0, serv: 0, salon: 0, delivery: 0, pax: 0, promPax: 0, dias: 0 }

/** Los totales de UN día. Sin día (o sin ventas) → todo en cero. */
export function totalesDelDia(dia: DiaData | undefined | null): TotalesVentas {
  if (!dia) return { ...CERO }
  const s = getDayStats(dia)
  return {
    ventaNeta: s.ventaNeta, ventaBruta: s.ventaBruta, iva: s.iva, serv: s.serv,
    salon: s.salon, delivery: s.delivery, pax: s.pax, promPax: s.promPax,
    dias: s.ventaNeta > 0 ? 1 : 0,
  }
}

/** La suma de varios días (cada fecha UNA vez: es un mapa). */
export function totalesDelRango(dias: DiasMap): TotalesVentas {
  const t = { ...CERO }
  for (const dia of Object.values(dias)) {
    const d = totalesDelDia(dia)
    t.ventaNeta += d.ventaNeta; t.ventaBruta += d.ventaBruta; t.iva += d.iva; t.serv += d.serv
    t.salon += d.salon; t.delivery += d.delivery; t.pax += d.pax; t.dias += d.dias
  }
  t.promPax = t.pax > 0 ? t.salon / t.pax : 0
  return t
}
