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
import { abrirConexion } from './db.ts'
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
 * El día completo: facturas mapeadas + `DiaData` + conteos y avisos. Es lo que usa
 * el CLI, porque el dry-run necesita el detalle factura por factura.
 */
export async function extraerDiaDetalle(fecha: string, config?: PosConfig): Promise<ExtraccionDia> {
  const cfg = config ?? loadPosConfig(loadEnv())
  const conn = await abrirConexion(cfg)
  try {
    const esquema = await leerEsquema(conn, cfg.columnas)
    const lectura = await leerDia(conn, esquema, fecha)
    return {
      ...lectura,
      dia: construirDiaData(fecha, lectura.tickets, { uploadedAt: todayCR() }),
      origen: describirConfig(cfg),
    }
  } finally {
    await conn.close()
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
