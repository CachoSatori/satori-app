/**
 * Club → Tablero (mig 160): formato puro (sin I/O ni reloj) de lo que devuelve `club_tablero_mes`.
 * La base calcula todo; acá solo se arman las filas del pasivo, los avisos y el CSV (ESTANDAR-reportes §7:
 * punto de miles, ₡ pegado, % con espacio). Sin nombres ni contactos: la función no los devuelve.
 */
import type { TableroLinea, TableroMes } from '../../shared/api/club'

const num = (n: number | null | undefined, dec = 0) =>
  Number(n ?? 0).toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: dec })
export const crcTxt = (n: number | null | undefined) => {
  const v = Math.round(Number(n ?? 0))
  return `${v < 0 ? '−' : ''}₡${num(Math.abs(v))}`
}
export const creditosTxt = (n: number | null | undefined) => {
  const v = Number(n ?? 0)
  return `${v < 0 ? '−' : ''}${num(Math.abs(v), 1)}`
}
export const pctTxt = (n: number | null | undefined) => (n == null ? '—' : `${num(n, 1)} %`)

export interface FilaPasivo { clave: string; etiqueta: string; linea: TableroLinea; total?: boolean }

/** Saldo inicial → emitidos → carga inicial → canjeados → vencidos → ajustes → saldo final (en ese orden). */
export function filasPasivo(t: TableroMes): FilaPasivo[] {
  const p = t.pasivo
  const filas: FilaPasivo[] = [
    { clave: 'saldo_inicial', etiqueta: 'Saldo inicial', linea: p.saldo_inicial, total: true },
    { clave: 'emitidos', etiqueta: 'Emitidos en el mes', linea: p.emitidos },
    { clave: 'carga_inicial', etiqueta: 'Carga inicial (papel / página vieja)', linea: p.carga_inicial },
    { clave: 'canjeados', etiqueta: 'Canjeados', linea: p.canjeados },
    { clave: 'vencidos', etiqueta: 'Vencidos', linea: p.vencidos },
    { clave: 'ajustes', etiqueta: 'Ajustes y restituciones', linea: p.ajustes },
    { clave: 'saldo_final', etiqueta: t.parcial ? 'Saldo a hoy' : 'Saldo final', linea: p.saldo_final, total: true },
  ]
  // la carga inicial solo se muestra el mes en que entró
  return filas.filter(f => f.clave !== 'carga_inicial' || f.linea.personas !== 0)
}

/** ¿Cuadra el pasivo? inicial + movimientos = final, en personas (la unidad del libro: entero, sin redondeo). */
export function pasivoCuadra(t: TableroMes): boolean {
  const p = t.pasivo
  return p.saldo_inicial.personas + p.emitidos.personas + p.carga_inicial.personas + p.canjeados.personas
    + p.vencidos.personas + p.ajustes.personas === p.saldo_final.personas
}

/** La frase protagonista (ESTANDAR §1): cuánto costó el Club por cada ₡100 cobrados en sus facturas. */
export function titular(t: TableroMes): string {
  if (t.pos_sin_datos) return 'Sin datos del PoS para este local y mes.'
  const k = t.plata
  if (k.facturas_club === 0) return 'Todavía no hay facturas del Club en este mes.'
  if (k.tasa_efectiva_pct == null) return `Facturas del Club: ${num(k.facturas_club)}, sin venta cobrada.`
  return `Por cada ₡100 cobrados en facturas del Club, el Club costó ₡${num(k.tasa_efectiva_pct, 1)}.`
}

/** Avisos de lectura: datos parciales, estimaciones incompletas, regalía para conciliar. */
export function avisos(t: TableroMes): string[] {
  const a: string[] = []
  if (t.pos_sin_datos) a.push('Este local no tiene facturas del PoS en el mes: la parte de plata sale en cero. El pasivo de créditos sí vale.')
  if (t.parcial) a.push('Mes en curso: los números son a hoy y van a cambiar.')
  if (t.plata.lineas_sin_referencia > 0)
    a.push(`${num(t.plata.lineas_sin_referencia)} líneas sin precio de referencia en los 30 días anteriores: su descuento no se estimó.`)
  if (t.plata.cortesias_sin_precio > 0)
    a.push(`${num(t.plata.cortesias_sin_precio)} cortesías sin precio de referencia: no suman al costo.`)
  if (!pasivoCuadra(t)) a.push('El pasivo no cuadra (inicial + movimientos ≠ final): avisá al owner.')
  return a
}

const q = (v: unknown) => {
  const s = String(v ?? '')
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** CSV del tablero (anexo): una fila por cifra. Números crudos (sin formato) para la planilla. */
export function tableroCsv(t: TableroMes): string {
  const L: string[] = ['seccion;concepto;valor;personas;creditos;crc']
  const fila = (sec: string, concepto: string, valor: unknown, personas: unknown = '', creditos: unknown = '', crc: unknown = '') =>
    L.push([sec, concepto, valor, personas, creditos, crc].map(q).join(';'))
  fila('local', 'local', t.local); fila('local', 'mes', t.mes)
  fila('local', 'parcial', t.parcial ? 'si' : 'no'); fila('local', 'pos_sin_datos', t.pos_sin_datos ? 'si' : 'no')
  fila('config', 'cortesia_costo_pct', t.config.cortesia_costo_pct)
  fila('config', 'valor_credito_crc', t.config.valor_credito_crc)
  const k = t.plata
  for (const [c, v] of Object.entries({
    facturas_mes: k.facturas_mes, venta_mes_crc: k.venta_mes_crc, facturas_club: k.facturas_club,
    venta_respaldada_crc: k.venta_respaldada_crc, descuento_estimado_crc: k.descuento_estimado_crc,
    descuento_lineas: k.descuento_lineas, lineas_sin_referencia: k.lineas_sin_referencia,
    cortesias_unidades: k.cortesias_unidades, cortesias_lista_crc: k.cortesias_lista_crc, cortesias_costo_crc: k.cortesias_costo_crc,
    canjes: k.canjes, creditos_canjeados: k.creditos_canjeados, canjes_crc: k.canjes_crc,
    costo_total_crc: k.costo_total_crc, tasa_efectiva_pct: k.tasa_efectiva_pct ?? '',
  })) fila('plata', c, v)
  fila('regalia', 'facturas', t.regalia.facturas); fila('regalia', 'crc', t.regalia.crc); fila('regalia', 'en_canjes_crc', t.regalia.en_canjes_crc)
  for (const [g, d] of Object.entries(t.comparacion)) {
    fila(`comparacion_${g}`, 'facturas', d.facturas); fila(`comparacion_${g}`, 'venta_crc', d.venta_crc)
    fila(`comparacion_${g}`, 'personas', d.personas); fila(`comparacion_${g}`, 'tiquete_crc', d.tiquete_crc ?? '')
  }
  for (const f of filasPasivo(t)) fila('pasivo', f.clave, '', f.linea.personas, f.linea.creditos, f.linea.crc)
  fila('pasivo', 'congelado_fuera_del_pasivo', t.pasivo.congelado.cuentas, t.pasivo.congelado.personas,
       t.pasivo.congelado.creditos, t.pasivo.congelado.crc)
  return '﻿' + L.join('\r\n')
}
