// ── pos-bridge · configuración del agente (A3) ─────────────────────────────────
//
// El agente = la conexión al PoS (la de la Fase 1a) + el destino en Supabase + el ritmo.
// Todo sale del `.env` de la PC del PoS y nada se imprime: ni la clave del PoS ni el
// secreto del Edge.

import { loadPosConfig, type Env, type PosConfig } from './config.ts'
import type { RitmoConfig, Ventana } from './ventana.ts'

/** LC-ML: un local es un id `^[a-z0-9-]{2,40}$` (el mismo de `club_config` y de `POS_INGEST_SECRETS`); ninguno escrito acá. */
export const RE_LOCAL = /^[a-z0-9-]{2,40}$/
export type Local = string

export interface AgenteConfig {
  pos:          PosConfig
  local:        Local
  entorno:      string
  ingestUrl:    string
  ingestSecret: string
  ritmo:        RitmoConfig
  /** Cuántas horas hacia atrás se relee en cada ciclo. */
  ventanaHoras: number
}

/**
 * El agente apunta a STAGING hasta nueva orden: la primera corrida real se valida
 * comparando `pos_ndf_*` de staging contra el reporte del PoS. Mandar a producción
 * antes de eso es escribir ventas sin haberlas cuadrado nunca.
 *
 * El candado no se puede abrir por accidente: hace falta la firma explícita
 * `POS_AGENTE_PROD_FIRMADO=<fecha>` en el `.env`, igual que el doble opt-in de
 * `scripts/pool-backfill/prod-gate.ts`.
 */
export const ENTORNO_POR_DEFECTO = 'staging'
export const FIRMA_PROD = 'POS_AGENTE_PROD_FIRMADO'
/** El único destino sin firma (CLUB-AUD-32): el Edge de STAGING. Cualquier otro (prod) exige la firma. */
export const HOST_STAGING = 'hwiatgicyyqyezqwldia.supabase.co'

function requerido(env: Env, clave: string): string {
  const v = (env[clave] ?? '').trim()
  if (!v) throw new Error(`Falta ${clave} en el .env (copiá .env.example y completalo).`)
  return v
}

function entero(env: Env, clave: string, porDefecto: number, minimo: number): number {
  const crudo = (env[clave] ?? '').trim()
  if (!crudo) return porDefecto
  const n = Number(crudo)
  if (!Number.isInteger(n) || n < minimo) {
    throw new Error(`${clave} inválido: "${crudo}" (entero >= ${minimo}).`)
  }
  return n
}

function hora(env: Env, clave: string, porDefecto: number): number {
  const n = entero(env, clave, porDefecto, 0)
  if (n > 23) throw new Error(`${clave} inválido: "${n}" (hora de 0 a 23).`)
  return n
}

function esLocal(v: string): v is Local {
  return RE_LOCAL.test(v)
}

export function loadAgenteConfig(env: Env): AgenteConfig {
  // El local NO se adivina: decide a qué local se le acreditan las ventas y es parte de
  // la clave de idempotencia (cada PoS tiene su propia numeración de facturas).
  const local = requerido(env, 'LOCAL')
  if (!esLocal(local)) {
    throw new Error(`LOCAL inválido: "${local}". Es el id del local (minúsculas, números y guiones), el mismo de su secreto en el Edge.`)
  }

  const entorno = (env.ENV ?? ENTORNO_POR_DEFECTO).trim() || ENTORNO_POR_DEFECTO
  if (entorno !== ENTORNO_POR_DEFECTO && !(env[FIRMA_PROD] ?? '').trim()) {
    throw new Error(
      `ABORTADO: ENV="${entorno}". El agente solo corre contra STAGING hasta que un día real ` +
      `se valide contra el reporte del PoS. Para habilitar otro entorno hace falta la firma ` +
      `explícita ${FIRMA_PROD}=<fecha> en el .env.`,
    )
  }

  const ingestUrl = requerido(env, 'INGEST_URL')
  if (!/^https:\/\//i.test(ingestUrl)) {
    // El secreto compartido viaja en un header: sin TLS iría en claro por la red.
    throw new Error(`INGEST_URL tiene que ser https:// (llegó "${ingestUrl}").`)
  }
  // CLUB-AUD-32: el candado mira el DESTINO real, no la etiqueta ENV. Un .env con la URL de prod y ENV=staging
  // no escribe en prod sin la firma.
  let host = ''
  try { host = new URL(ingestUrl).hostname.toLowerCase() } catch { throw new Error(`INGEST_URL no es una URL válida.`) }
  const destinoStaging = host === HOST_STAGING
  if (!destinoStaging && !(env[FIRMA_PROD] ?? '').trim()) {
    throw new Error(
      `ABORTADO: INGEST_URL apunta a ${host}, que no es STAGING. Para escribir ahí hace falta la firma ` +
      `explícita ${FIRMA_PROD}=<fecha> en el .env (la etiqueta ENV no alcanza).`,
    )
  }
  if (destinoStaging !== (entorno === ENTORNO_POR_DEFECTO)) {
    throw new Error(`ABORTADO: ENV="${entorno}" no coincide con INGEST_URL (${host}). Revisá el .env.`)
  }

  const ventana: Ventana = {
    inicio: hora(env, 'HORA_APERTURA', 10),
    fin:    hora(env, 'HORA_CIERRE', 2),
  }

  return {
    pos:          loadPosConfig(env),
    local,
    entorno,
    ingestUrl,
    ingestSecret: requerido(env, 'INGEST_SECRET'),
    ritmo: {
      ventana,
      // En operación la mesa abierta tiene que verse casi en vivo; de madrugada el PoS
      // no factura y machacarlo no aporta nada.
      operacionMs: entero(env, 'POLL_OPERACION_MS', 75_000, 15_000),
      madrugadaMs: entero(env, 'POLL_MADRUGADA_MS', 300_000, 15_000),
    },
    ventanaHoras: entero(env, 'VENTANA_HORAS', 36, 1),
  }
}

/** Una línea para el log. **Nunca** incluye la clave del PoS ni el secreto del Edge. */
export function describirAgente(cfg: AgenteConfig): string {
  const host = new URL(cfg.ingestUrl).host
  return `local=${cfg.local} · entorno=${cfg.entorno} · ingest=${host} · ` +
    `poll ${Math.round(cfg.ritmo.operacionMs / 1000)}s/${Math.round(cfg.ritmo.madrugadaMs / 1000)}s · ` +
    `ventana ${cfg.ventanaHoras}h`
}
