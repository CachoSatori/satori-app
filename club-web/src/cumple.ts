// D6 A (14-nov, firmada por el dueño) · Cumpleaños del alta del Local Club: opcional, solo día y mes (sin año) y con el
// permiso explícito para usarlo en beneficios. La base exige lo mismo (migración 159): esta validación solo evita un
// viaje de ida y vuelta con un error genérico. El 29 de febrero vale (se festeja el 28 o el 1 en años no bisiestos).

/** Días máximos por mes (1–12); febrero con 29. */
const MAX_DIA = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

export function diaMesValido(dia: number, mes: number): boolean {
  return Number.isInteger(dia) && Number.isInteger(mes) && mes >= 1 && mes <= 12 && dia >= 1 && dia <= MAX_DIA[mes - 1]
}

export type Cumple = { dia: number; mes: number }
export type ResultadoCumple = { ok: true; cumple: Cumple | null } | { ok: false; error: 'falta' | 'invalido' }

/**
 * Lo que eligió la persona en el formulario. Todo vacío (y sin permiso) = no da su cumpleaños. Día y mes sin el
 * permiso, o el permiso sin día y mes, o solo uno de los dos = 'falta'. Una fecha que no existe (31/4) = 'invalido'.
 */
export function validarCumple(dia: string, mes: string, permiso: boolean): ResultadoCumple {
  const d = dia.trim(), m = mes.trim()
  if (!d && !m && !permiso) return { ok: true, cumple: null }
  if (!d || !m || !permiso) return { ok: false, error: 'falta' }
  const dn = Number(d), mn = Number(m)
  if (!/^\d{1,2}$/.test(d) || !/^\d{1,2}$/.test(m) || !diaMesValido(dn, mn)) return { ok: false, error: 'invalido' }
  return { ok: true, cumple: { dia: dn, mes: mn } }
}
