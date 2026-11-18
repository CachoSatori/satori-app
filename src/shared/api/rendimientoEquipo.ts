// ── Mi Rendimiento: el equipo en AGREGADOS (mig 194) — SOLO LECTURA ──────────────────────────
//
// Desde la 191 el personal lee del PoS solo sus propias facturas. Las comparaciones con el equipo salen de la base,
// ya agregadas, por estas dos funciones (`security definer`, rol validado adentro). Nunca traen filas, logins ni
// montos de otra persona. Siempre: las proporciones del local (también del año pasado, −364 días). Solo con 4 o más
// personas en el período: posición propia, mediana y promedio por persona e ICP del equipo (si no, `grupo_chico`).
// En competencias el líder sale con su nombre (decisión del dueño, «A»).
//
// Si la función todavía no está (antes de aplicar la 194) o falla, se devuelve `null` y la pantalla lo dice: nunca
// se inventa una comparación.

import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'

const sb = supabase as unknown as SupabaseClient

/** Los indicadores que se comparan por persona. Las claves son las de la 194. */
export interface IndicadoresEquipo {
  prom_pax:    number | null
  beb_pax:     number | null
  comida_pax:  number | null
  prom_ticket: number | null
  pax_dia:     number | null
}

export interface PosicionesEquipo {
  prom_pax:    number | null
  beb_pax:     number | null
  comida_pax:  number | null
  prom_ticket: number | null
  pax_dia:     number | null
  ventas:      number | null
}

export type MotivoEquipo = 'grupo_chico' | 'sin_ventas' | null

export interface ProporcionesLocal {
  prom_pax: number | null; comida_pax: number | null; beb_pax: number | null; prom_ticket: number | null
}

/** Lo que devuelve `pos_mi_rendimiento_equipo`. */
export interface EquipoAgregado {
  desde:    string
  hasta:    string
  k_min:    number
  yo:       boolean
  personas: number | null
  motivo:   MotivoEquipo
  ranking?: { posicion: number; de: number } | null
  /** Proporciones del local: siempre (sin plata total ni posición). */
  general?: ProporcionesLocal | null
  /** Las mismas proporciones en la ventana corrida 364 días. `general` null = sin datos del año pasado. */
  anio_pasado?: { desde: string; hasta: string; general: ProporcionesLocal | null } | null
  equipo?: {
    de: number
    mediana:     IndicadoresEquipo
    promedio:    IndicadoresEquipo
    mi_posicion: PosicionesEquipo | null
  } | null
  por_dow?:    { dow: number; prom_pax: number | null }[]
  icp_equipo?: number | null
}

/** Lo que devuelve `pos_mi_competencia`. */
export interface MiCompetencia {
  participa:       boolean
  motivo:          'grupo_chico' | 'no_participa' | 'no_existe' | 'sin_dias' | null
  de?:             number
  posicion?:       number
  mis_puntos?:     number
  /** Decisión del dueño 18-nov («A»): el líder con su nombre. */
  lider_nombre?:   string | null
  lider_puntos?:   number | null
  mediana_puntos?: number | null
  sin_resolver?:   number
}

/** Agregados del equipo en `[desde, hasta]` (días CR, inclusivos). `null` si la función no está o falla. */
export async function getEquipoAgregado(local: string, desde: string, hasta: string): Promise<EquipoAgregado | null> {
  if (!desde || !hasta || desde > hasta) return null
  const { data, error } = await sb.rpc('pos_mi_rendimiento_equipo', { p_local: local, p_desde: desde, p_hasta: hasta })
  if (error || !data || typeof data !== 'object') return null
  return data as EquipoAgregado
}

/** Mi lugar en una competencia. `null` si la función no está o falla. */
export async function getMiCompetencia(local: string, compId: string): Promise<MiCompetencia | null> {
  if (!compId) return null
  const { data, error } = await sb.rpc('pos_mi_competencia', { p_local: local, p_comp: compId })
  if (error || !data || typeof data !== 'object') return null
  return data as MiCompetencia
}
