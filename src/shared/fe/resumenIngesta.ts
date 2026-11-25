// Compras F1 · lo PURO de la pantalla de control de la ingesta (mig 199): tipos, lectura del jsonb por posición y
// «hace cuánto». Sin cliente de Supabase (lo usan las pruebas y la pantalla).

export interface DiaIngesta {
  dia: string; nuevo: number; duplicado: number; revisar: number; no_comprobante: number; sin_xml: number; error: number
}
export interface ResumenIngesta {
  latidos: { fuente: string; ultimo_en: string }[]
  dias: DiaIngesta[]
  revisar: { estado: string; motivo: string; n: number }[]
  errores: { ts: string; resultado: string; motivo: string | null; fin_clave: string | null }[]
  ultima: string | null
}

const n = (x: unknown) => (typeof x === 'number' ? x : Number(x ?? 0) || 0)
const arr = (x: unknown): unknown[][] => (Array.isArray(x) ? (x.filter(Array.isArray) as unknown[][]) : [])

/** jsonb de la 199 → objeto. Puro (lo prueban las pruebas de contrato). */
export function parsearResumenIngesta(raw: unknown): ResumenIngesta {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    latidos: arr(r.latidos).map(([f, u]) => ({ fuente: String(f), ultimo_en: String(u) })),
    dias: arr(r.dias).map(([dia, nu, du, re, nc, sx, er]) => ({
      dia: String(dia), nuevo: n(nu), duplicado: n(du), revisar: n(re), no_comprobante: n(nc), sin_xml: n(sx), error: n(er),
    })),
    revisar: arr(r.revisar).map(([e, m, c]) => ({ estado: String(e), motivo: String(m ?? ''), n: n(c) })),
    errores: arr(r.errores).map(([ts, res, mot, fin]) => ({
      ts: String(ts), resultado: String(res), motivo: mot == null ? null : String(mot), fin_clave: fin == null ? null : String(fin),
    })),
    ultima: typeof r.ultima === 'string' ? r.ultima : null,
  }
}

/** Horas sin latido a partir de las cuales la corrida se marca en rojo (spec §4.5). */
export const HORAS_ALERTA_LATIDO = 6

/** «hace 8 min» / «hace 3 h» / «hace 2 d», y si pasa del umbral. `ahora` se inyecta (pruebas). */
export function haceCuanto(iso: string | null, ahora: Date): { texto: string; alerta: boolean } {
  if (!iso) return { texto: 'nunca', alerta: true }
  const ms = ahora.getTime() - new Date(iso).getTime()
  if (!Number.isFinite(ms)) return { texto: '—', alerta: true }
  const min = Math.max(0, Math.floor(ms / 60_000))
  const texto = min < 60 ? `hace ${min} min` : min < 48 * 60 ? `hace ${Math.floor(min / 60)} h` : `hace ${Math.floor(min / 1440)} d`
  return { texto, alerta: ms > HORAS_ALERTA_LATIDO * 3_600_000 }
}
