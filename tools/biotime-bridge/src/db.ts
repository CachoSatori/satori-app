import pg from 'pg'
import type { BridgeConfig } from './config.js'
import type { Queryable } from './fetchPunches.js'

// ── Conexión a BioTime (Postgres local) ─────────────────────────────────────────
// SOLO LECTURA, y por partida triple:
//   1. el usuario `satori_ro` solo tiene SELECT sobre iclock_transaction / personnel_employee,
//   2. la sesión se abre con `default_transaction_read_only = on`,
//   3. el único SQL del agente es el SELECT de fetchPunches.
// Cero INSERT/UPDATE/DELETE contra BioTime: si algún día alguien agrega uno por error, la
// sesión read-only lo rechaza antes de tocar la base del reloj.

export interface BiotimeDb extends Queryable {
  close(): Promise<void>
  /** Chequeo de arranque: avisa fuerte si `punch_time` NO es timestamptz. */
  checkPunchTimeType(): Promise<void>
}

export function createDb(cfg: BridgeConfig): BiotimeDb {
  const pool = new pg.Pool({
    host:     cfg.biotimeHost,
    port:     cfg.biotimePort,
    database: cfg.biotimeDb,
    user:     cfg.biotimeUser,
    password: cfg.biotimePassword,
    // BioTime corre en la misma PC (127.0.0.1): sin TLS y con pocas conexiones alcanza.
    max: 2,
    connectionTimeoutMillis: 15_000,
    idle_in_transaction_session_timeout: 30_000,
    options: '-c default_transaction_read_only=on',
  })

  return {
    async query<T>(text: string, params: unknown[]): Promise<{ rows: T[] }> {
      const res = await pool.query(text, params)
      return { rows: res.rows as T[] }
    },

    async checkPunchTimeType(): Promise<void> {
      const { rows } = await pool.query<{ data_type: string }>(
        `select data_type from information_schema.columns
          where table_schema = 'public' and table_name = 'iclock_transaction'
            and column_name = 'punch_time'`,
        [],
      )
      const tipo = rows[0]?.data_type
      if (!tipo) {
        throw new Error(
          'No se ve public.iclock_transaction.punch_time. ¿El usuario satori_ro tiene SELECT sobre esa tabla?',
        )
      }
      if (tipo !== 'timestamp with time zone') {
        // No frenamos acá: `mapRow` corta si de verdad llega un instante sin zona. Pero
        // que quede dicho en el log desde el arranque, porque el síntoma (marcas corridas
        // 6 horas) no se parece en nada a la causa.
        console.warn(
          `[bridge] OJO: punch_time es "${tipo}", no timestamptz. Si las marcas llegan sin zona horaria, ` +
          'el agente frena el ciclo en vez de guardar instantes corridos.',
        )
      }
    },

    async close(): Promise<void> {
      await pool.end()
    },
  }
}
