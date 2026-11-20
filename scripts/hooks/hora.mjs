// Hora de Costa Rica para los hooks (UTC-6 fijo, sin horario de verano). Mismo criterio que todayCR() de
// src/shared/utils, reescrito acá porque los hooks corren con node sin compilar TypeScript.
// Regla D1 (ESTADO.md, regla 3; cambio del dueño del 20-nov): libre 23:30–15:00 · 15:00–19:00 solo con OK del dueño en el
// momento · 19:00–23:30 solo si es urgente y con OK del dueño.

const OFFSET_MS = 6 * 60 * 60 * 1000

/** @param {Date} [ahora] @returns {{ fecha: string, minutos: number, hhmm: string }} */
export function relojCR(ahora = new Date()) {
  const cr = new Date(ahora.getTime() - OFFSET_MS)
  const h = cr.getUTCHours()
  const m = cr.getUTCMinutes()
  return {
    fecha: cr.toISOString().slice(0, 10),
    minutos: h * 60 + m,
    hhmm: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
  }
}

export const OK_DESDE = 15 * 60 // 15:00
export const URGENTE_DESDE = 19 * 60 // 19:00
export const LIBRE_DESDE = 23 * 60 + 30 // 23:30

/** @param {number} minutos minutos desde la medianoche CR @returns {'libre' | 'con-ok' | 'urgente'} */
export function ventanaD1(minutos) {
  if (minutos >= OK_DESDE && minutos < URGENTE_DESDE) return 'con-ok'
  if (minutos >= URGENTE_DESDE && minutos < LIBRE_DESDE) return 'urgente'
  return 'libre'
}

/**
 * Reloj de los hooks. `SATORI_HOOKS_AHORA` (ISO) existe solo para las pruebas de scripts/hooks: quien puede fijar el
 * entorno del proceso de Claude Code también puede apagar los hooks, así que no abre una puerta nueva.
 */
export function ahora(env = process.env) {
  const fijo = env.SATORI_HOOKS_AHORA
  if (fijo) {
    const d = new Date(fijo)
    if (!Number.isNaN(d.getTime())) return d
  }
  return new Date()
}
