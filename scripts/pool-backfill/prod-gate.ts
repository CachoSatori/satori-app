// Candado de PRODUCCIÓN — doble opt-in, mismo molde que scripts/t0-reconciliacion-cajas/prod-gate.ts.
//
// 1. El ref de prod está CLAVADO en el código: no sale del .env, así que apuntar el .env a otro
//    lado no cambia nada.
// 2. Además exige `POOL_BACKFILL_PROD_FIRMADO=<fecha de la firma del dueño>`. Ninguna alcanza sola.
//
// La corrida contra prod es SOLO LECTURA: todo va con read_only:true, y antes de leer un dato
// verificarRechazoDeEscritura() manda un `create temp table` y exige que el servidor lo rechace
// (25006). Este entry point NO importa nada del camino de escritura.

import { REF_PROD, REF_STAGING, type Env } from '../t0-reconciliacion-cajas/env.ts'

/** Candado 1: ref clavado. `: string` evita que TS estreche al literal y marque TS2367. */
export const REF_PROD_CLAVADO: string = 'yiczgdtirrkdvohdquzf'

/** Candado 2: fecha en que el dueño firmó la corrida read-only contra prod (prompt 2026-08-05). */
export const FIRMA_REQUERIDA = '2026-08-05'

export function exigirFirma(env: Env, script: string): void {
  const firma = (env.POOL_BACKFILL_PROD_FIRMADO || '').trim()
  if (!firma) {
    throw new Error(
      'FALTA LA FIRMA. Esta corrida va contra PRODUCCIÓN (solo lectura) y necesita doble opt-in.\n' +
        `  Autorizala:  POOL_BACKFILL_PROD_FIRMADO=${FIRMA_REQUERIDA} node --import ./scripts/pool-backfill/register.mjs ${script}\n` +
        '  Para STAGING, run.ts no pide firma.',
    )
  }
  if (firma !== FIRMA_REQUERIDA) {
    throw new Error(
      `FIRMA INVÁLIDA: POOL_BACKFILL_PROD_FIRMADO="${firma}" pero esta corrida está autorizada para ` +
        `"${FIRMA_REQUERIDA}". La firma es la fecha en que el dueño autorizó leer prod — otro día necesita ` +
        'autorización nueva (y editar FIRMA_REQUERIDA a mano).',
    )
  }
}

/** Paranoia barata: que el ref clavado sea el de prod y NO el de staging. */
export function verificarRefClavado(): void {
  if (REF_PROD_CLAVADO === REF_STAGING) throw new Error('El ref clavado es el de STAGING. Usá run.ts.')
  if (REF_PROD_CLAVADO !== REF_PROD) {
    throw new Error(`El ref clavado (${REF_PROD_CLAVADO}) no coincide con REF_PROD (${REF_PROD}) de env.ts.`)
  }
}
