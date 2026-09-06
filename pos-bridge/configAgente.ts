// ── pos-bridge · configuración del agente (A3) ─────────────────────────────────
//
// El agente = la conexión al PoS (la de la Fase 1a) + el destino en Supabase + el ritmo.
// Todo sale del `.env` de la PC del PoS y nada se imprime: ni la clave del PoS ni el
// secreto del Edge.

import { loadPosConfig, type Env, type PosConfig } from './config.ts'
import type { RitmoConfig, Ventana } from './ventana.ts'

/** Slugs válidos = `public.locations.id` (los mismos que usan BioTime y el POS). */
export const LOCALES = ['santa-teresa', 'nosara'] as const
export type Local = (typeof LOCALES)[number]

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
  return (LOCALES as readonly string[]).includes(v)
}

export function loadAgenteConfig(env: Env): AgenteConfig {
  // El local NO se adivina: decide a qué local se le acreditan las ventas y es parte de
  // la clave de idempotencia (cada PoS tiene su propia numeración de facturas).
  const local = requerido(env, 'LOCAL')
  if (!esLocal(local)) {
    throw new Error(`LOCAL inválido: "${local}". Tiene que ser uno de: ${LOCALES.join(' | ')}.`)
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
