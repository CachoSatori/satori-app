// PoS F1 — precio con modificadores y validación de grupos.
// Puro y sin IO: es la única matemática nueva del PoS y vive testeada.

export interface PosModifier {
  id: string
  name: string
  price_delta_crc: number
}

export interface PosModifierGroup {
  id: string
  name: string
  required: boolean
  min_selections: number
  max_selections: number
  modifiers: PosModifier[]
}

/** Precio final = base + suma de deltas de los modificadores elegidos. */
export function computeItemPrice(basePriceCrc: number, selected: PosModifier[]): number {
  return (Number(basePriceCrc) || 0) + selected.reduce((s, m) => s + (Number(m.price_delta_crc) || 0), 0)
}

/**
 * Valida la selección de UN grupo. Regla: un grupo obligatorio exige al menos
 * max(1, min_selections); uno opcional permite 0 pero si hay selección debe
 * respetar min/max. Devuelve null si es válida, o el mensaje de error.
 */
export function validateGroupSelection(group: PosModifierGroup, selectedCount: number): string | null {
  const min = group.required ? Math.max(1, group.min_selections) : group.min_selections
  if (group.required && selectedCount === 0) return `"${group.name}" es obligatorio — elegí al menos ${min}`
  if (selectedCount > 0 && selectedCount < min) return `"${group.name}": elegí al menos ${min}`
  if (selectedCount > group.max_selections) return `"${group.name}": máximo ${group.max_selections}`
  return null
}

/** Valida TODOS los grupos de un producto; null = el ítem se puede enviar. */
export function validateItemSelections(groups: PosModifierGroup[], selectedByGroup: Record<string, number>): string | null {
  for (const g of groups) {
    const err = validateGroupSelection(g, selectedByGroup[g.id] ?? 0)
    if (err) return err
  }
  return null
}

// ── Cursos (F2) ───────────────────────────────────────────────
export type PosCourse = 'bebida' | 'entrada' | 'principal'
export const COURSE_ORDER: PosCourse[] = ['bebida', 'entrada', 'principal']

/** Curso default según el tipo del catálogo (product_map.tipo). Un tap lo cambia. */
export function defaultCourseForTipo(tipo: string): PosCourse {
  const t = (tipo || '').toLowerCase()
  if (/bebida|licor|cervez|vino|cocktail|coctel|cafe|café|refresco/.test(t)) return 'bebida'
  if (/entrada|appetizer|tapa/.test(t)) return 'entrada'
  return 'principal'
}

/** Siguiente curso al tocar el chip (cicla bebida → entrada → principal → bebida). */
export function nextCourse(c: PosCourse): PosCourse {
  return COURSE_ORDER[(COURSE_ORDER.indexOf(c) + 1) % COURSE_ORDER.length]
}

// ── Reglas de turno (F3) ──────────────────────────────────────
// Regla de la dueña: el turno de la MAÑANA puede cerrar con mesas abiertas
// (pasan al turno de la noche); el ÚLTIMO turno NO (el día no cierra con mesas vivas).
export type Turno = 'mañana' | 'noche'

export function canCloseShift(turno: Turno, openTableNames: string[]): { ok: boolean; message: string } {
  const n = openTableNames.length
  if (turno === 'mañana') {
    return { ok: true, message: n ? `Turno mañana: cierre permitido con ${n} mesa(s) abierta(s) — pasan al turno noche.` : 'Turno mañana: sin mesas abiertas.' }
  }
  if (n === 0) return { ok: true, message: 'Último turno: sin mesas abiertas, se puede cerrar el día.' }
  return { ok: false, message: `No se puede cerrar el último turno con ${n} mesa(s) abierta(s): ${openTableNames.join(', ')}. Cerralas o transferilas antes de cerrar el día.` }
}
