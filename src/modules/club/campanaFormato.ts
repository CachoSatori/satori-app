/**
 * Campañas con grupo de control (166, SPEC Club v2 ítem 12): textos y CSV. Funciones puras (se prueban sin pantalla).
 */
import type { FilaCampana, GrupoReporte, ReporteCampana } from '../../shared/api/club'
import { dateCR } from '../../shared/utils'

/** La regla del dueño: al grupo reservado nunca se le quita el beneficio base, solo el extra de la campaña. */
export const REGLA_BENEFICIO_BASE =
  'Al grupo reservado no se le quita nada de lo que ya tiene: su descuento del Local Club (10 % o 15 %), la cortesía, ' +
  'sus créditos y sus canjes siguen igual. Solo no recibe el mensaje de esta campaña.'

export const PCT_RESERVA_DEFECTO = 15

/** % válido para reservar: entero o con decimales, de 0 a 50. null si no sirve. */
export function pctReserva(txt: string): number | null {
  const n = Number(String(txt).replace(',', '.').trim())
  if (!Number.isFinite(n) || n < 0 || n > 50 || String(txt).trim() === '') return null
  return Math.round(n * 100) / 100
}

/** El aviso honesto: con pocos miembros la diferencia entre los grupos puede ser casualidad. null si no hace falta. */
export function avisoNoConcluyente(r: Pick<ReporteCampana, 'no_concluyente' | 'umbral_minimo' | 'oferta' | 'control'>): string | null {
  if (!r.no_concluyente) return null
  if (r.control.miembros === 0)
    return 'Esta campaña no reservó a nadie: no hay con qué comparar. La diferencia no se puede medir.'
  return `Con ${r.oferta.miembros} con oferta y ${r.control.miembros} reservados, la diferencia no es concluyente: ` +
    `puede ser casualidad. Para empezar a confiar hacen falta al menos ${r.umbral_minimo} en cada grupo.`
}

const crc = (n: number | null) => (n === null ? '—' : `₡${Number(n).toLocaleString('de-DE', { maximumFractionDigits: 0 })}`)
const pct = (n: number | null) => (n === null ? '—' : `${String(n).replace('.', ',')} %`)
const num = (n: number | null) => (n === null ? '—' : String(n).replace('.', ','))

/** Filas de la tabla del reporte: [qué, con oferta, reservado]. */
export function filasReporte(r: Pick<ReporteCampana, 'oferta' | 'control'>): [string, string, string][] {
  const f = (t: string, v: (g: GrupoReporte) => string): [string, string, string] => [t, v(r.oferta), v(r.control)]
  return [
    f('Miembros', g => String(g.miembros)),
    f('Volvieron en 30 días', g => `${g.con_visita} (${pct(g.con_visita_pct)})`),
    f('Visitas (días)', g => String(g.visitas)),
    f('Visitas por miembro', g => num(g.visitas_por_miembro)),
    f('Facturas', g => String(g.facturas)),
    f('Venta respaldada', g => crc(g.venta_respaldada_crc)),
    f('Venta por miembro', g => crc(g.venta_por_miembro_crc)),
  ]
}

// Una celda de texto que empieza con = + - @ (o tab/CR) se abriría como fórmula: se le antepone un apóstrofo
// (CLUB-AUD-34, como reporteHtml). El WhatsApp empieza con «+»: va como texto.
const q = (v: unknown) => {
  let t = String(v ?? '')
  if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(t)) t = `'${t}`
  return `"${t.replace(/"/g, '""')}"`
}

/** CSV de la campaña. Las filas vienen de la base, que nunca manda al grupo reservado ni a quien pasó a baja.
 *  «vence» es el día de Costa Rica (una tarjeta a las 20:00 CR es 02:00 UTC del día siguiente: no se corta en UTC). */
export function campanaCsv(filas: FilaCampana[]): string {
  const L = ['nombre;negocio;tipo;creditos;vence;whatsapp;email']
  for (const f of filas)
    L.push([f.nombre, f.negocio ?? '', f.tipo, f.creditos, dateCR(f.vence_en), f.whatsapp ?? '', f.email ?? ''].map(q).join(';'))
  return '﻿' + L.join('\r\n')
}
