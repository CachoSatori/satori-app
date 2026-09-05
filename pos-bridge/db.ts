// ── pos-bridge · conexión al PoS (SQL Server) ──────────────────────────────────
//
// El ÚNICO archivo que importa `mssql`. Todo lo demás (el SQL, el mapeo, el
// reporte) es código puro que se prueba sin base de datos — el mismo reparto que
// `tools/biotime-bridge`.
//
// READ-ONLY, por partida triple:
//   1. el usuario del `.env` es `ClienteConsulta` (solo `db_datareader`),
//   2. `assertSoloSelect` revisa CADA sentencia antes de mandarla al socket,
//   3. no existe en el bridge ningún camino que arme un INSERT/UPDATE/DDL.
//
// ZONA HORARIA: los datetime del PoS son NAIVE = hora de Costa Rica. No se
// convierten a UTC ni se dejan en manos del driver — el SELECT los trae ya
// formateados con `CONVERT(varchar(19), ..., 120)`, o sea TEXTO. Es la misma
// lección del desfase de 1 hora de BioTime (ver `tools/biotime-bridge/README.md`).

import sql from 'mssql'

import type { PosConfig } from './config.ts'
import type { Queryable } from './consulta.ts'
import { assertSoloSelect } from './sqlGuard.ts'

export interface ConexionPos extends Queryable {
  close(): Promise<void>
}

/** Abre el pool contra `ndf`. Nunca imprime la contraseña. */
export async function abrirConexion(cfg: PosConfig): Promise<ConexionPos> {
  const pool = new sql.ConnectionPool({
    server:   cfg.server,
    database: cfg.database,
    user:     cfg.user,
    password: cfg.password,
    // tedious NO acepta puerto e instancia a la vez: `config.ts` ya eligió uno.
    ...(cfg.port !== null ? { port: cfg.port } : {}),
    connectionTimeout: cfg.connectTimeoutMs,
    requestTimeout:    cfg.requestTimeoutMs,
    pool: { max: 2, min: 0, idleTimeoutMillis: 30_000 },
    options: {
      encrypt:                cfg.encrypt,
      trustServerCertificate: cfg.trustServerCertificate,
      ...(cfg.instanceName ? { instanceName: cfg.instanceName } : {}),
      // Los datetime ya vienen como texto del SELECT; esto es el cinturón por si
      // alguna columna nueva se colara como Date.
      useUTC: false,
    },
  })

  await pool.connect()

  return {
    async query<T>(texto: string, params: Record<string, unknown> = {}): Promise<{ rows: T[] }> {
      assertSoloSelect(texto)
      const req = pool.request()
      for (const [clave, valor] of Object.entries(params)) req.input(clave, valor)
      const res = await req.query(texto)
      return { rows: res.recordset as unknown as T[] }
    },

    async close(): Promise<void> {
      await pool.close()
    },
  }
}
