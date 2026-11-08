// ── Reparto semanal de cocina (PROP-AUD-01) ────────────────────────────────────────────────
//
// Módulo PURO, sacado de TipCocina.tsx sin cambiar la cuenta:
//   · pozo de la semana (ISO, lun–dom) = Σ payout_crc de las entradas de empleados de cocina;
//   · se divide en partes iguales entre los RECEPTORES de esa semana;
//   · receptor = empleado de cocina con entradas esa semana y `recibe_reparto_cocina !== false`.
// Quien no recibe APORTA igual al pozo: su parte se reparte entre el resto. La marca vive en la
// base (employees.recibe_reparto_cocina, la edita el owner en Admin → Empleados); antes era una
// comparación de una subcadena fija contra el nombre, que fallaba con homónimos y renombres.
// No toca tipCalculations.ts (sagrado): esto es solo la vista semanal, no guarda nada.

export interface EmpleadoCocina {
  id:        string
  full_name: string
  /** null/undefined = recibe (el default de la columna es true). */
  recibe_reparto_cocina?: boolean | null
}

export interface FilaCocina {
  employee_id:  string
  session_date: string          // 'YYYY-MM-DD'
  payout_crc:   number | null
}

export interface SemanaCocina {
  key:        string                       // lunes ISO
  start:      string                       // fecha real más temprana presente
  end:        string                       // fecha real más tardía presente
  pool:       number                       // Σ payout_crc (incluye a quien no recibe)
  receptores: Array<{ id: string; name: string }>
  perPerson:  number
}

/** ¿Recibe del reparto de cocina? Solo la marca de la base decide; el nombre no importa. */
export function recibeRepartoCocina(e: EmpleadoCocina): boolean {
  return e.recibe_reparto_cocina !== false
}

/** Lunes (ISO) de la semana que contiene `dateStr` → 'YYYY-MM-DD'. */
export function mondayOf(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  const dow = (d.getDay() + 6) % 7   // 0 = lunes
  d.setDate(d.getDate() - dow)
  return d.toISOString().slice(0, 10)
}

/** Semanas de cocina, ordenadas. `cocina` = empleados de rol cocina por id. */
export function semanasCocina(
  filas: readonly FilaCocina[],
  cocina: ReadonlyMap<string, EmpleadoCocina>,
): SemanaCocina[] {
  const map: Record<string, { pool: number; start: string; end: string; recept: Map<string, string> }> = {}
  for (const r of filas) {
    const emp = cocina.get(r.employee_id)
    if (!emp) continue
    const k = mondayOf(r.session_date)
    if (!map[k]) map[k] = { pool: 0, start: r.session_date, end: r.session_date, recept: new Map() }
    const b = map[k]
    b.pool += r.payout_crc ?? 0
    if (r.session_date < b.start) b.start = r.session_date
    if (r.session_date > b.end)   b.end = r.session_date
    if (recibeRepartoCocina(emp)) b.recept.set(emp.id, emp.full_name)
  }
  return Object.entries(map)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, b]) => {
      const receptores = [...b.recept.entries()].map(([id, name]) => ({ id, name }))
      return {
        key, start: b.start, end: b.end, pool: b.pool, receptores,
        perPerson: receptores.length > 0 ? b.pool / receptores.length : 0,
      }
    })
}
