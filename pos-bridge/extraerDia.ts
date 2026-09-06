// ── pos-bridge · extraer un día del PoS ────────────────────────────────────────
//
// Abre la conexión, resuelve el esquema, corre los tres SELECT y devuelve el día
// en la forma `DiaData` (la misma que produce `xlsParser.parseVentasFile()`).
//
// CERO ESCRITURA: ni al PoS, ni a Supabase, ni al disco.

import { todayCR } from '../src/shared/utils'
import { construirDiaData } from '../src/shared/ndf/mapTicket'
import type { DiaData } from '../src/shared/types/ventas'

import { describirConfig, loadEnv, loadPosConfig, type PosConfig } from './config.ts'
import { leerDia, type LecturaDia } from './consulta.ts'
import { abrirConexion, type ConexionPos } from './db.ts'
import { agruparColumnas, resolverEsquema, SQL_ESQUEMA, type Esquema, type FilaEsquema } from './esquema.ts'

export interface ExtraccionDia extends LecturaDia {
  /** El día en la forma que consume el dashboard. */
  dia:    DiaData
  /** Destino de la conexión, sin contraseña (para el encabezado del dry-run). */
  origen: string
}

/** Catálogo → esquema resuelto. Un solo SELECT a `INFORMATION_SCHEMA`. */
export async function leerEsquema(
  qy: { query<T>(sql: string, params?: Record<string, unknown>): Promise<{ rows: T[] }> },
  overrides: Record<string, string>,
): Promise<Esquema> {
  const { rows } = await qy.query<FilaEsquema>(SQL_ESQUEMA)
  return resolverEsquema(agruparColumnas(rows), overrides)
}

/**
 * Una conexión al PoS con su esquema ya resuelto, para leer MUCHOS días seguidos.
 *
 * `extraerDiaDetalle` abre y cierra por día, que es lo correcto para el dry-run de UN
 * día. El backfill barre meses: reconectar y releer `INFORMATION_SCHEMA` en cada
 * fecha sería tirar el trabajo a la basura 300 veces.
 */
export interface SesionPos {
  conn:    ConexionPos
  esquema: Esquema
  /** Destino de la conexión, sin contraseña. */
  origen:  string
  close(): Promise<void>
}

export async function abrirSesion(config?: PosConfig): Promise<SesionPos> {
  const cfg = config ?? loadPosConfig(loadEnv())
  const conn = await abrirConexion(cfg)
  try {
    return {
      conn,
      esquema: await leerEsquema(conn, cfg.columnas),
      origen:  describirConfig(cfg),
      close:   () => conn.close(),
    }
  } catch (e) {
    // Si el esquema no resuelve, la conexión no queda colgada.
    await conn.close()
    throw e
  }
}

/** Un día sobre una sesión ya abierta. Es el cuerpo que comparten el dry-run y el backfill. */
export async function extraerDiaEnSesion(
  sesion: SesionPos,
  fecha: string,
  uploadedAt: string,
): Promise<ExtraccionDia> {
  const lectura = await leerDia(sesion.conn, sesion.esquema, fecha)
  return {
    ...lectura,
    dia:    construirDiaData(fecha, lectura.tickets, { uploadedAt }),
    origen: sesion.origen,
  }
}

/**
 * El día completo: facturas mapeadas + `DiaData` + conteos y avisos. Es lo que usa
 * el CLI, porque el dry-run necesita el detalle factura por factura.
 */
export async function extraerDiaDetalle(fecha: string, config?: PosConfig): Promise<ExtraccionDia> {
  const sesion = await abrirSesion(config)
  try {
    return await extraerDiaEnSesion(sesion, fecha, todayCR())
  } finally {
    await sesion.close()
  }
}

/**
 * La firma que va a consumir A2/A3: una fecha → el día en forma `DiaData`.
 *
 * Devuelve un array de UN elemento a propósito: cuando haya que extraer un rango,
 * la firma no cambia. Para el dry-run usá `extraerDiaDetalle`, que además trae las
 * facturas una por una.
 */
export async function extraerDia(fecha: string, config?: PosConfig): Promise<DiaData[]> {
  const { dia } = await extraerDiaDetalle(fecha, config)
  return [dia]
}
