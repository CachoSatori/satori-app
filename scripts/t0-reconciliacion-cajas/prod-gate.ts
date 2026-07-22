// Candado de PRODUCCIÓN — implementación ÚNICA del doble opt-in.
//
// Vive acá y no dentro de un entry point para que run-prod.ts (T0-B) y run-t1.ts (T1) usen
// exactamente el mismo candado. Dos copias de una salvaguarda es peor que una: alcanza con
// que alguien afloje una para que la otra dé una falsa sensación de seguridad.
//
// ── DOBLE OPT-IN ────────────────────────────────────────────────────────────
// 1. El ref de prod está CLAVADO acá abajo, en el código: no sale de `.env.local`, así que
//    apuntar el `.env` a otro lado no cambia nada.
// 2. Además exige `T0_PROD_FIRMADO=<fecha de la firma del dueño>` en el entorno.
// Ninguna de las dos alcanza sola.
//
// ── POR QUÉ SE PUEDE LEER PROD ──────────────────────────────────────────────
// Todo va con `read_only: true`, que Postgres impone a nivel de TRANSACCIÓN. Antes de leer
// un solo dato, `verificarRechazoDeEscritura()` manda a propósito un `create temp table` y
// exige que el servidor lo rechace con `25006`. Si esa sonda pasara, se aborta sin consultar.

import { mgmtToken, REF_PROD, REF_STAGING, type Env } from './env.ts'
import { contarFilas, crearLectorMgmt, verificarRechazoDeEscritura, type Conteos, type Lector } from './db.ts'

/** Candado 1: el ref, clavado en el código. El `: string` evita que TS estreche al literal
 *  y declare "imposible" (TS2367) la comparación defensiva contra staging. */
export const REF_PROD_CLAVADO: string = 'yiczgdtirrkdvohdquzf'

/** Candado 2: la fecha en que el dueño firmó la corrida read-only contra prod. */
export const FIRMA_REQUERIDA = '2026-07-22'

export function exigirFirma(env: Env, script: string): void {
  const firma = (env.T0_PROD_FIRMADO || '').trim()
  if (!firma) {
    throw new Error(
      'FALTA LA FIRMA. Esta corrida va contra PRODUCCIÓN y necesita doble opt-in.\n' +
        `  Para autorizarla:  T0_PROD_FIRMADO=${FIRMA_REQUERIDA} node --import ./scripts/t0-reconciliacion-cajas/register.mjs ${script}\n` +
        '  Si lo que querés es STAGING, run.ts y run-t1.ts --solo-staging no piden nada.',
    )
  }
  if (firma !== FIRMA_REQUERIDA) {
    throw new Error(
      `FIRMA INVÁLIDA: T0_PROD_FIRMADO="${firma}" pero esta corrida está autorizada para "${FIRMA_REQUERIDA}". ` +
        'La firma es la fecha en que el dueño autorizó tocar prod — si hoy es otro día, hace falta una ' +
        'autorización nueva (y cambiar FIRMA_REQUERIDA en prod-gate.ts, a propósito y a mano).',
    )
  }
}

/** Paranoia barata: que el ref clavado sea el de prod y NO el de staging. */
export function verificarRefClavado(): void {
  // El chequeo contra STAGING va PRIMERO: después del `!== REF_PROD`, el control-flow de TS
  // ya habría estrechado el ref al literal de prod y la comparación daría TS2367.
  if (REF_PROD_CLAVADO === REF_STAGING) {
    throw new Error('El ref clavado es el de STAGING. Para staging usá run.ts / run-t1.ts.')
  }
  if (REF_PROD_CLAVADO !== REF_PROD) {
    throw new Error(`El ref clavado (${REF_PROD_CLAVADO}) no coincide con REF_PROD (${REF_PROD}) de env.ts.`)
  }
}

export type AperturaProd = {
  lector: Lector
  token: string
  smoke: string
  conteosAntes: Conteos
}

/**
 * Abre prod para LECTURA: valida los dos candados, comprueba que el canal rechaza una
 * escritura, y deja tomado el conteo de filas "antes". El llamador debe cerrar con
 * `cerrarProd()` para dejar la evidencia de que no se escribió nada.
 */
export async function abrirProdFirmado(env: Env, script: string): Promise<AperturaProd> {
  exigirFirma(env, script)
  verificarRefClavado()

  const token = mgmtToken(env)
  if (!token) {
    throw new Error(
      'Sin token de Management API (SUPABASE_ACCESS_TOKEN o Keychain "Supabase CLI"). ' +
        'La anon key NO sirve: RLS devuelve 200 con [].',
    )
  }

  const smoke = await verificarRechazoDeEscritura(REF_PROD_CLAVADO, token)
  const conteosAntes = await contarFilas(REF_PROD_CLAVADO, token)
  return { lector: crearLectorMgmt(REF_PROD_CLAVADO, token), token, smoke, conteosAntes }
}

export type CierreProd = { antes: Conteos; despues: Conteos; iguales: boolean }

/** Vuelve a contar y exige que nada haya cambiado durante la corrida. */
export async function cerrarProd(a: AperturaProd): Promise<CierreProd> {
  const despues = await contarFilas(REF_PROD_CLAVADO, a.token)
  const iguales = (Object.keys(a.conteosAntes) as (keyof Conteos)[]).every(
    t => a.conteosAntes[t] === despues[t],
  )
  if (!iguales) {
    throw new Error(
      `Los conteos cambiaron durante la corrida (antes ${JSON.stringify(a.conteosAntes)} vs después ` +
        `${JSON.stringify(despues)}). No fue este script (solo manda SELECT en transacción read-only), ` +
        'pero el snapshot ya no es consistente: alguien escribió en paralelo. Repetir con la caja quieta.',
    )
  }
  return { antes: a.conteosAntes, despues, iguales }
}
