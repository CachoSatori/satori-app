import sql from 'mssql'
import type { PosConfig } from './config.js'
import type { Queryable } from './fetchVentas.js'

// ╔══════════════════════════════════════════════════════════════════════════════════════╗
// ║ ESQUELETO · Conexión al PoS (SQL Server, base `ndf`)                                   ║
// ╚══════════════════════════════════════════════════════════════════════════════════════╝
//
// ⚠ FASE A: `createDb` arma la configuración pero NO abre la conexión. Todavía no tenemos
//   permiso de lectura y no hay a qué conectarse. `connect()` está escrito y comentado: cuando
//   llegue el acceso, se descomenta y el resto del agente ya funciona.
//
// SOLO LECTURA, con el mismo criterio del biotime-bridge:
//   1. el usuario del PoS tiene que ser de SELECT solamente (lo crea el proveedor del PoS),
//   2. la sesión se abre con `READ ONLY` donde el motor lo permita,
//   3. el único SQL del agente es el SELECT de `fetchVentas`.
// Cero INSERT/UPDATE/DELETE contra el PoS: es la base que factura, no se toca ni por error.

export interface PosDb extends Queryable {
  close(): Promise<void>
  /** Chequeo de arranque: confirma que la tabla y las columnas son las que esperamos. */
  checkEsquema(): Promise<void>
}

/**
 * La configuración del pool. Se arma acá para que quede a la vista qué se le pide al motor,
 * aunque en Fase A no se use.
 */
export function poolConfig(cfg: PosConfig): sql.config {
  return {
    server:   cfg.posHost,
    port:     cfg.posPort,
    database: cfg.posDb,
    user:     cfg.posUser,
    password: cfg.posPassword,
    options: {
      // El PoS corre en la misma red del local, casi siempre con certificado autofirmado.
      trustServerCertificate: cfg.posTrustCert,
      encrypt:                true,
      // ⚠ IMPORTANTE cuando se cablee: con `useUTC: true` (el default de `mssql`) un
      // `datetime` naive de SQL Server se interpreta como UTC. Con `false`, como hora de la
      // PC. Las dos opciones son una trampa: la primera corre las ventas 6 horas, la segunda
      // las deja a merced de cómo esté configurada la máquina — que es EXACTAMENTE el bug que
      // corrió las marcas de BioTime. Por eso `fetchVentas.normalizarInstante` estampa el
      // offset de Costa Rica a mano y no confía en el driver.
      useUTC: true,
    },
    pool: { max: 2, min: 0, idleTimeoutMillis: 30_000 },
    connectionTimeout: 15_000,
    requestTimeout:    30_000,
  }
}

/**
 * ⚠ TODO CABLEAR · El acceso real.
 *
 * En Fase A devuelve un objeto que cumple el contrato pero no abre nada: `query` explota si
 * alguien lo llama por error, en vez de fallar en silencio o —peor— conectarse a algo.
 */
export function createDb(cfg: PosConfig): PosDb {
  // ⚠ Descomentar en Fase B, cuando exista el usuario de solo lectura:
  // const pool = new sql.ConnectionPool(poolConfig(cfg))
  // const listo = pool.connect()

  return {
    async query<T>(_text: string, _params: Record<string, unknown>): Promise<{ rows: T[] }> {
      // ⚠ Fase B:
      // await listo
      // const req = pool.request()
      // for (const [k, v] of Object.entries(_params)) req.input(k, v)
      // const res = await req.query(_text)
      // return { rows: res.recordset as T[] }
      throw new Error(
        'pos-bridge está en FASE A (esqueleto): no hay conexión al PoS. ' +
        'Ver tools/pos-bridge/README.md → «Qué falta cablear».',
      )
    },

    async checkEsquema(): Promise<void> {
      // ⚠ TODO CABLEAR · Espeja `checkPunchTimeType` del biotime-bridge, y existe por la misma
      // razón: los errores de tipo de fecha no fallan, solo corren la hora, y eso es invisible
      // durante semanas. Al arrancar hay que dejar en el log:
      //   · el tipo real de la columna de fecha (`datetime` naive vs `datetimeoffset`),
      //   · la ÚLTIMA venta tal cual está en el PoS, el instante que se va a enviar, y la hora
      //     en que se verá en la app.
      // Esas tres cosas juntas convierten un desfase silencioso en algo que se ve en un minuto.
      console.log(
        `[pos-bridge] FASE A · esqueleto. No se consulta ${cfg.posHost}:${cfg.posPort}/${cfg.posDb}. ` +
        'Ver README → «Qué falta cablear».',
      )
    },

    async close(): Promise<void> {
      // ⚠ Fase B: await pool.close()
    },
  }
}
