import pg from 'pg'
import type { BridgeConfig } from './config.js'
import { type Queryable, normalizarInstante } from './fetchPunches.js'

// ── ZONA HORARIA: por qué este bloque existe ────────────────────────────────────
// `public.iclock_transaction.punch_time` de BioTime es un `timestamp` NAIVE (reloj de
// pared). El parser por defecto de `pg` lo convierte a `Date` interpretándolo en la zona
// del PROCESO — o sea, en lo que tenga configurado la PC del reloj. Con una PC en UTC−5
// (o en una zona con horario de verano, que en agosto corre a UTC−5) cada marca salía
// 1 hora atrás: BioTime 16:00 → app 15:00. Ese fue el desfase del piloto v3.
//
// Se desactiva ese parseo: los `timestamp` sin zona llegan como TEXTO CRUDO y el offset
// de Costa Rica (−06:00, FIJO, sin horario de verano) se lo pone `normalizarInstante`.
// `timestamptz` (1184) NO se toca: ahí el driver ya devuelve un instante absoluto, que es
// el mismo mire quien lo mire.
const OID_TIMESTAMP = 1114   // timestamp without time zone

pg.types.setTypeParser(OID_TIMESTAMP, (v: string) => v)

// ── Conexión a BioTime (Postgres local) ─────────────────────────────────────────
// SOLO LECTURA, y por partida triple:
//   1. el usuario `satori_ro` solo tiene SELECT sobre iclock_transaction / personnel_employee,
//   2. la sesión se abre con `default_transaction_read_only = on`,
//   3. el único SQL del agente es el SELECT de fetchPunches.
// Cero INSERT/UPDATE/DELETE contra BioTime: si algún día alguien agrega uno por error, la
// sesión read-only lo rechaza antes de tocar la base del reloj.

export interface BiotimeDb extends Queryable {
  close(): Promise<void>
  /** Chequeo de arranque: dice el tipo de `punch_time` y muestra la última marca leída. */
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
    // `TimeZone` fija la zona en la que el SERVIDOR formatea cualquier `timestamptz` a
    // texto. Con America/Costa_Rica, un `timestamptz` que el driver no parseara igual
    // saldría en hora de Costa Rica y no en la del sistema operativo del server.
    options: "-c default_transaction_read_only=on -c TimeZone=America/Costa_Rica",
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
      console.log(
        `[bridge] punch_time es "${tipo}" · las marcas sin zona se leen como hora de Costa Rica (UTC−6 fijo).`,
      )

      // ── El diagnóstico que faltaba ─────────────────────────────────────────────
      // El desfase de 1 hora del piloto v3 fue invisible durante semanas porque NADA
      // fallaba: las marcas entraban, solo que corridas. Así que el agente ahora imprime,
      // en cada arranque, la última marca TAL CUAL está en BioTime y el instante que va a
      // mandar. Si alguien vuelve a ver horas raras en la app, la comparación está en el
      // log y no hay que reconstruirla.
      try {
        const { rows: ult } = await pool.query<{ punch_time: Date | string }>(
          `select punch_time from public.iclock_transaction order by id desc limit 1`,
          [],
        )
        const cruda = ult[0]?.punch_time
        if (cruda !== undefined && cruda !== null) {
          const enviado = normalizarInstante(cruda)
          const cr = new Date(new Date(enviado).getTime() - 6 * 3600_000)
          const hhmm = `${String(cr.getUTCHours()).padStart(2, '0')}:${String(cr.getUTCMinutes()).padStart(2, '0')}`
          console.log(
            `[bridge] última marca · BioTime crudo: ${String(cruda)} · se envía: ${enviado} ` +
            `· se verá en la app a las ${hhmm} (hora CR). Tienen que coincidir con lo que muestra BioTime.`,
          )
        }
      } catch (e) {
        console.warn('[bridge] no se pudo leer la última marca para el diagnóstico:', e instanceof Error ? e.message : e)
      }
    },

    async close(): Promise<void> {
      await pool.end()
    },
  }
}
