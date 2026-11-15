// Mig 169: retos de temporada baja en «Mi Club». Lee la respuesta de GET /api/portal/:token/retos y arma los textos.
// Datos raros → se descartan (no se muestra nada; el portal no falla). Fechas: días de Costa Rica (YYYY-MM-DD).
import type { TEXTOS } from './i18n'

type T = (typeof TEXTOS)['es']

export interface RetoSocio {
  nombre: string; nombre_en: string; desde: string; hasta: string; dias: number[]
  hora_desde: string | null; hora_hasta: string | null; meta: number; avance: number; ganada: boolean
  vence_en: string | null; locales: string[]
}

const DIA = /^\d{4}-\d{2}-\d{2}$/
const HORA = /^\d{2}:\d{2}$/

export function leerRetos(data: unknown): RetoSocio[] {
  const lista = (data as { retos?: unknown } | null)?.retos
  if (!Array.isArray(lista)) return []
  const out: RetoSocio[] = []
  for (const x of lista as Array<Record<string, unknown>>) {
    if (!x || typeof x !== 'object') continue
    const meta = Number(x.meta), avance = Number(x.avance)
    const dias = Array.isArray(x.dias) ? (x.dias as unknown[]).map(Number).filter(d => Number.isInteger(d) && d >= 1 && d <= 7) : []
    const hd = typeof x.hora_desde === 'string' && HORA.test(x.hora_desde) ? x.hora_desde : null
    const hh = typeof x.hora_hasta === 'string' && HORA.test(x.hora_hasta) ? x.hora_hasta : null
    if (typeof x.nombre !== 'string' || !x.nombre.trim() || !Number.isInteger(meta) || meta < 2 || !Number.isInteger(avance)
        || avance < 0 || avance > meta || typeof x.desde !== 'string' || !DIA.test(x.desde) || typeof x.hasta !== 'string'
        || !DIA.test(x.hasta) || dias.length === 0 || (hd === null) !== (hh === null)) continue
    const ganada = x.ganada === true
    const vence = typeof x.vence_en === 'string' && DIA.test(x.vence_en) ? x.vence_en : null
    if (ganada && !vence) continue
    out.push({ nombre: x.nombre, nombre_en: typeof x.nombre_en === 'string' && x.nombre_en.trim() ? x.nombre_en : x.nombre,
               desde: x.desde, hasta: x.hasta, dias: [...new Set(dias)].sort(), hora_desde: hd, hora_hasta: hh, meta,
               avance: ganada ? meta : avance, ganada, vence_en: vence,
               locales: Array.isArray(x.locales) ? (x.locales as unknown[]).filter((l): l is string => typeof l === 'string') : [] })
  }
  return out
}

/** «de lunes a viernes de 11:30 a 15:00» / «los sábados y domingos» / «cualquier día». */
export function cuando(r: RetoSocio, t: T): string {
  const d = r.dias
  const dias = d.length === 7 ? t.reto_dias_todos
    : d.join() === '1,2,3,4,5' ? t.reto_dias_semana
    : t.reto_los(d.length === 1 ? t.reto_dias[d[0] - 1]
                 : d.slice(0, -1).map(n => t.reto_dias[n - 1]).join(', ') + t.reto_y + t.reto_dias[d[d.length - 1] - 1])
  return r.hora_desde && r.hora_hasta ? `${dias} ${t.reto_franja(r.hora_desde, r.hora_hasta)}` : dias
}

export interface TextosReto { titulo: string; principal: string; detalle: string; ganada: boolean; avance: number; meta: number }

/** Textos de la tarjeta. `fecha` formatea un día CR (YYYY-MM-DD) en el idioma del portal; `hoy` es el día CR de hoy. */
export function textosReto(r: RetoSocio, t: T, idioma: 'es' | 'en', fecha: (dia: string) => string, hoy: string): TextosReto {
  const nombre = idioma === 'en' ? r.nombre_en : r.nombre
  if (r.ganada && r.vence_en) {
    return { titulo: nombre, principal: t.reto_ganado, detalle: t.reto_ganado_txt(fecha(r.vence_en)), ganada: true, avance: r.meta, meta: r.meta }
  }
  const lugar = r.locales.length ? ' ' + t.reto_en(r.locales.join(t.reto_y)) : ''
  const det = t.reto_txt(r.meta, cuando(r, t) + lugar, fecha(r.hasta)) + (r.desde > hoy ? ' ' + t.reto_empieza(fecha(r.desde)) : '')
  return { titulo: nombre, principal: t.reto_avance(r.avance, r.meta), detalle: det, ganada: false, avance: r.avance, meta: r.meta }
}
