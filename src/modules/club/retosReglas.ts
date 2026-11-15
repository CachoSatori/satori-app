/** Mig 169 · Retos de temporada baja: reglas de pantalla (la base vuelve a validar todo) y textos cortos. */
import type { Reto, RetoDatos } from '../../shared/api/club'

export const DIAS: Array<[number, string]> = [[1, 'Lu'], [2, 'Ma'], [3, 'Mi'], [4, 'Ju'], [5, 'Vi'], [6, 'Sá'], [7, 'Do']]

/** «Lu a Vi · 11:30–15:00» (texto corto para la lista). */
export function resumenFranja(r: Pick<Reto, 'dias' | 'hora_desde' | 'hora_hasta'>): string {
  const dias = r.dias.length === 7 ? 'todos los días' : r.dias.map(d => DIAS.find(([n]) => n === d)?.[1] ?? d).join(' ')
  return dias + (r.hora_desde && r.hora_hasta ? ` · ${r.hora_desde.slice(0, 5)}–${r.hora_hasta.slice(0, 5)}` : ' · todo el día')
}

/** Validación de pantalla (la base vuelve a validar todo). Devuelve el primer problema o null. */
export function problemaReto(d: RetoDatos, hoy: string): string | null {
  if (d.nombre.trim().length < 2 || d.nombre_en.trim().length < 2) return 'Poné el nombre en español y en inglés.'
  if (d.locales.length === 0) return 'Elegí al menos un local.'
  if (!d.desde || !d.hasta) return 'Poné las fechas del reto.'
  if (d.desde < hoy) return 'El reto no puede empezar en el pasado.'
  if (d.hasta < d.desde) return 'La fecha de fin es antes que la de inicio.'
  if (d.desde.slice(0, 4) !== d.hasta.slice(0, 4)) return 'El reto tiene que quedar dentro de un mismo año.'
  if ((Date.parse(d.hasta) - Date.parse(d.desde)) / 86_400_000 > 92) return 'El reto dura como máximo 92 días.'
  if (d.dias.length === 0) return 'Elegí al menos un día.'
  if (!!d.hora_desde !== !!d.hora_hasta) return 'Poné las dos horas de la franja, o ninguna (todo el día).'
  if (d.hora_desde && d.hora_desde === d.hora_hasta) return 'La franja necesita dos horas distintas.'
  if (!(d.meta >= 2 && d.meta <= 10)) return 'La meta va de 2 a 10 visitas.'
  if (!(d.vence_dias >= 7 && d.vence_dias <= 90)) return 'El premio vale de 7 a 90 días.'
  return null
}
