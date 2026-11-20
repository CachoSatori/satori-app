// Hora de Costa Rica para los hooks (UTC-6 fijo, sin horario de verano). Mismo criterio que todayCR() de
// src/shared/utils, reescrito acá porque los hooks corren con node sin compilar TypeScript.
// Regla D1 (ESTADO.md, regla 3): libre 23:30–15:50 · bloqueado 15:50–19:00 · 19:00–23:30 solo con OK del dueño.

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

export const BLOQUEO_DESDE = 15 * 60 + 50 // 15:50
export const NOCHE_DESDE = 19 * 60 // 19:00
export const LIBRE_DESDE = 23 * 60 + 30 // 23:30

/** @param {number} minutos minutos desde la medianoche CR @returns {'libre' | 'bloqueado' | 'con-ok'} */
export function ventanaD1(minutos) {
  if (minutos >= BLOQUEO_DESDE && minutos < NOCHE_DESDE) return 'bloqueado'
  if (minutos >= NOCHE_DESDE && minutos < LIBRE_DESDE) return 'con-ok'
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
