/**
 * D7 A (firma del dueño, 14-nov; mig 157): el equipo de Satori sigue con su QR y sus cupones y registra personas a su
 * nombre, pero NO tiene créditos: no genera código de canje, no se le aplica canje (ni «sin celular»), no vence y no
 * cuenta en el pasivo. En caja, al escanearlo, no se ofrece canje.
 */
import type { TipoMiembro } from '../../shared/api/club'

/** ¿La cuenta no tiene créditos? La base lo dice (`sin_creditos`); con una base vieja, alcanza con que sea del equipo. */
export function esCuentaSinCreditos(d: { sin_creditos?: boolean | null; tipo_miembro?: TipoMiembro | string | null }): boolean {
  return d.sin_creditos === true || d.tipo_miembro === 'equipo'
}

export const MSG_EQUIPO_SIN_CANJE =
  'Es del equipo: registra personas con sus cupones, pero no tiene créditos ni canje. Seguí con la cuenta sin canje.'

type EquipoMes = { personas_mes: number; congelado_cuentas?: number; congelado_creditos?: number; congelado_valor_crc?: number; creditos?: number }
const n0 = (n: number, dec = 0) => Number(n ?? 0).toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: dec })

/** Línea aparte del equipo en el reporte del mes (pantalla y PDF). Con la 157: personas del mes y el saldo congelado
 *  FUERA del pasivo. Un mes cerrado antes de la 157 trae `creditos` (lo que el equipo tenía en saldo entonces). */
export function notaEquipoMes(e: EquipoMes): string {
  const pers = `${n0(e.personas_mes)} ${Number(e.personas_mes) === 1 ? 'persona' : 'personas'} en el mes`
  if (e.congelado_creditos === undefined) {
    return `${pers} y ${n0(e.creditos ?? 0, 1)} créditos en saldo (mes cerrado antes de que el equipo dejara de acumular créditos).`
  }
  if (!Number(e.congelado_creditos)) return `${pers}. El equipo no acumula créditos.`
  return `${pers}. El equipo no acumula créditos. Saldo congelado, fuera del pasivo: ${n0(e.congelado_creditos, 1)} créditos` +
    ` (₡${n0(Math.round(Number(e.congelado_valor_crc ?? 0)))}) en ${n0(e.congelado_cuentas ?? 0)} ${Number(e.congelado_cuentas) === 1 ? 'cuenta' : 'cuentas'}.`
}
