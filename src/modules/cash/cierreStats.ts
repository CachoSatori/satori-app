// C2 — Historial de sobrantes/faltantes del cierre (patrón Toast over/short).
// Lógica PURA de agregación sobre lo YA guardado en cash_cierres_dia (tipo='completo').
// NO recalcula el "debería" (eso vive en CashCierre, sagrado): solo lee diferencia_crc
// y el ajuste_tipo/motivo que quedaron sellados en cada cierre completo.
//
// NULL-SAFE a propósito: en la base diferencia_crc/ajuste_tipo/ajuste_motivo son
// NULLABLE (supabase.gen.ts) aunque database.ts los declare no-null — ver el hotfix
// del buscador. Un cierre viejo con diferencia_crc null cuenta como que cuadró (0).
import type { CashCierreDia } from '../../shared/types/database'

// Misma tolerancia que el gate de ajuste del cierre (CashCierre: Math.abs(dif) < 500).
// Bajo la tolerancia se considera que el día CUADRÓ (no generó ajuste).
export const OVER_SHORT_TOL = 500

export type OverShortEstado = 'sobrante' | 'faltante' | 'cuadro'

export function overShortEstado(dif: number): OverShortEstado {
  if (dif >= OVER_SHORT_TOL) return 'sobrante'
  if (dif <= -OVER_SHORT_TOL) return 'faltante'
  return 'cuadro'
}

export interface CierreOverShort {
  session_date:   string
  diferencia_crc: number
  ajuste_tipo:    string
  ajuste_motivo:  string
  estado:         OverShortEstado
}

export interface OverShortSummary {
  items:         CierreOverShort[]   // un ítem por cierre completo, más reciente primero
  total:         number              // cierres completos en el período
  nCuadraron:    number
  nDescuadraron: number
  sumaNeta:      number              // Σ diferencia_crc (con signo: tendencia sobrante/faltante)
  sumaAbs:       number              // Σ |diferencia_crc| (magnitud total del descuadre)
}

// month: 'YYYY-MM' para acotar; undefined o 'all' = todos los períodos.
export function computeOverShort(cierres: CashCierreDia[], month?: string): OverShortSummary {
  const completos = cierres.filter(c =>
    c.tipo === 'completo' &&
    (!month || month === 'all' || (c.session_date ?? '').startsWith(month)),
  )

  const items: CierreOverShort[] = completos
    .map(c => {
      const dif = c.diferencia_crc ?? 0
      return {
        session_date:   c.session_date ?? '',
        diferencia_crc: dif,
        ajuste_tipo:    c.ajuste_tipo   ?? '',
        ajuste_motivo:  c.ajuste_motivo ?? '',
        estado:         overShortEstado(dif),
      }
    })
    .sort((a, b) => b.session_date.localeCompare(a.session_date))

  const nCuadraron = items.filter(i => i.estado === 'cuadro').length

  return {
    items,
    total:         items.length,
    nCuadraron,
    nDescuadraron: items.length - nCuadraron,
    sumaNeta:      items.reduce((s, i) => s + i.diferencia_crc, 0),
    sumaAbs:       items.reduce((s, i) => s + Math.abs(i.diferencia_crc), 0),
  }
}
