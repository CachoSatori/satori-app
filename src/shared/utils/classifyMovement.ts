// F4.2 (unificación Bandeja↔Caja) — Clasificador advisory PURO: Mercadería vs Operativa.
//
// Diseño firmado: SPEC §6 (docs/SPEC-unificacion-bandeja-caja.md). Es la fundación del "Agregar"
// único de F4.3, que lo usará para SUGERIR la clasificación. Acá NO se conecta a ninguna UI ni base.
//
// RN-2: la sugerencia es SOLO advisory — nunca confirma ni escribe. El humano confirma siempre.
//
// Señales, en orden de peso (§6, todas calculables sin servicios externos):
//   1. Proveedor reconocido (nombre/OCR contra `suppliers`) → 'mercaderia', confianza ALTA.
//   2. Palabra clave operativa en el texto, o ausencia de proveedor → 'operativa', confianza MEDIA.
//   3. Desempate por monto (la recurrencia exigiría historial → no es puro) → 'operativa', confianza BAJA.
//
// ALCANCE: distingue SOLO Mercadería vs Operativa (es lo que define §6). 'Ingreso' NO se infiere del
// texto — lo decide la dirección del flujo en el asistente (F4.3), no esta función.

import { norm } from '../api/inventoryIngest'
import type { Supplier } from '../types/database'

export type Classification = 'mercaderia' | 'operativa'

export interface ClassifyInput {
  /** Texto libre disponible: descripción / nota / referencia / OCR (lo que haya). */
  text?: string
  /** Nombre del proveedor leído por OCR o tipeado, si lo hay. */
  supplierName?: string
  /** Monto en CRC del pago — sólo para el desempate de la señal 3. */
  amount?: number
}

export interface ClassifyResult {
  suggestion: Classification
  /** Fuerza de la señal en [0,1]: proveedor alto · keyword medio · desempate bajo. */
  confidence: number
}

// Confianzas por fuerza de señal (§6). Constantes nombradas para que el contrato sea legible y auditable.
const CONFIDENCE = {
  SUPPLIER_EXACT:     0.95, // el supplierName coincide con un proveedor conocido
  SUPPLIER_IN_TEXT:   0.85, // un proveedor conocido aparece embebido en el texto (típico de OCR)
  OPERATIVE_KEYWORD:  0.7,  // sin proveedor, pero hay palabra clave operativa
  TIEBREAK:           0.4,  // sin proveedor ni keyword → operativa por defecto (§6)
  TIEBREAK_FIXED_COST: 0.5, // monto alto y redondo → típico de costo operativo fijo (alquiler/servicios)
  TIEBREAK_BLIND:     0.3,  // sin texto, sin proveedor y sin monto → casi adivinanza
} as const

// Palabras clave de gasto OPERATIVO (§6), ya normalizadas (minúsculas, sin acentos) para comparar contra
// los tokens del texto normalizado. NO hay keywords de "mercadería": ese lado se decide por proveedor
// reconocido (señal 1), no por palabras — el SPEC §6 sólo define keywords operativas. Mantener la lista en
// tokens de UNA palabra permite el match por token exacto (evita falsos positivos tipo 'gas' ⊂ 'gaseosa').
const OPERATIVE_KEYWORDS = [
  'alquiler', 'renta', 'rent',
  'electricidad', 'luz', 'agua', 'gas', 'combustible',
  'internet', 'telefono', 'cable', 'wifi',
  'servicio', 'servicios',
  'mantenimiento', 'reparacion', 'limpieza',
  'salario', 'sueldo', 'planilla', 'adelanto',
  'impuesto', 'municipal', 'patente', 'seguro', 'poliza',
  'contabilidad', 'honorarios', 'legal',
  'publicidad', 'marketing', 'transporte', 'flete', 'envio',
  'papeleria', 'utiles', 'oficina',
] as const

// Tokens (palabras) del texto normalizado, para el match de keywords por palabra exacta.
const tokenize = (s: string): Set<string> =>
  new Set(norm(s).split(/[^a-z0-9]+/).filter(Boolean))

type SupplierMatch = 'exact' | 'in_text' | null

// Match de proveedor contra la lista — espeja el criterio de findOrCreateSupplier (nombre + aliases) pero
// con `norm` (insensible a acentos/case). 'exact' = el supplierName ES un nombre/alias conocido;
// 'in_text' = un nombre/alias conocido aparece dentro del texto libre (el OCR suele traerlo embebido).
// No muta entradas; sólo lee.
function matchSupplier(input: ClassifyInput, suppliers: Supplier[]): SupplierMatch {
  const supplierName = norm(input.supplierName ?? '')
  const haystack = norm(`${input.supplierName ?? ''} ${input.text ?? ''}`).trim()
  let inText: SupplierMatch = null
  for (const s of suppliers) {
    const names = [s.name, ...(s.aliases ?? [])].map(norm).filter(Boolean)
    for (const n of names) {
      if (supplierName && n.length >= 2 && supplierName === n) return 'exact'          // exact gana de una
      if (!inText && n.length >= 4 && haystack && haystack.includes(n)) inText = 'in_text'
    }
  }
  return inText
}

/**
 * Clasificador advisory puro: dado lo que se sabe de un pago (texto, nombre de proveedor, monto) y la
 * lista de proveedores conocidos, sugiere 'mercaderia' u 'operativa' con una confianza en [0,1].
 * SIN efectos secundarios, SIN I/O, SIN mutar inputs (RN-2: sólo sugiere, nunca confirma ni escribe).
 */
export function classifyMovement(input: ClassifyInput, suppliers: Supplier[]): ClassifyResult {
  // Señal 1 — proveedor reconocido → mercadería (mayor peso, §6). Domina aunque haya keyword operativa.
  const sup = matchSupplier(input, suppliers)
  if (sup === 'exact')   return { suggestion: 'mercaderia', confidence: CONFIDENCE.SUPPLIER_EXACT }
  if (sup === 'in_text') return { suggestion: 'mercaderia', confidence: CONFIDENCE.SUPPLIER_IN_TEXT }

  // Señal 2 — palabra clave operativa (sin proveedor reconocido) → operativa.
  const tokens = tokenize(`${input.supplierName ?? ''} ${input.text ?? ''}`)
  if (OPERATIVE_KEYWORDS.some(k => tokens.has(k))) {
    return { suggestion: 'operativa', confidence: CONFIDENCE.OPERATIVE_KEYWORD }
  }

  // Señal 3 — desempate. La recurrencia (mismo payee/monto repetido) sería la señal fuerte, pero exige
  // historial → no es calculable en una función pura; queda para F4.3 con el contexto del asistente. Sin
  // proveedor ni keyword, el SPEC inclina a 'operativa' con confianza baja; el humano confirma (RN-2).
  const amount = input.amount ?? 0
  const hasAnySignal = !!(input.text?.trim() || input.supplierName?.trim() || amount)
  if (!hasAnySignal) return { suggestion: 'operativa', confidence: CONFIDENCE.TIEBREAK_BLIND }
  const fixedCostLike = amount >= 50_000 && amount % 1_000 === 0
  return { suggestion: 'operativa', confidence: fixedCostLike ? CONFIDENCE.TIEBREAK_FIXED_COST : CONFIDENCE.TIEBREAK }
}
