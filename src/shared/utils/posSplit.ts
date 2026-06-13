// PoS F3 — DIVIDIR CUENTA (3 modos Lavu). Toca plata → 100% puro y testeado.
// INVARIANTE SAGRADO: la suma de los checks SIEMPRE reconcilia exactamente con el
// total de la mesa (computeTotals). El último check absorbe el redondeo.
// computeTotals NO se modifica: se reutiliza por grupo (es lineal por línea, así que
// la suma sobre grupos disjuntos = total de la mesa).
import { computeTotals } from './posFiscal'
import type { BillItem, Canal } from './posFiscal'
import { roundCrc } from './posCobro'

/** Reparto PAREJO en n checks. El último absorbe el resto → suma == total al colón. */
export function splitEven(totalCrc: number, n: number): number[] {
  const total = roundCrc(totalCrc)
  const k = Math.max(1, Math.floor(n))
  const base = Math.floor(total / k)
  const arr = Array(k).fill(base)
  arr[k - 1] = total - base * (k - 1)   // el último reconcilia el redondeo
  return arr
}

export interface SplitCheck {
  key: string
  label: string
  amount_crc: number
  lines: BillItem[]   // snapshot de las líneas que componen el check (display/ticket)
}

/**
 * Reparto POR GRUPO (por asiento, o por cualquier llave). Cada grupo se valora con
 * computeTotals sobre SUS líneas; el último check reconcilia para que la suma sea
 * exactamente el total de la mesa. Grupos en el orden de aparición.
 */
export function splitByGroup(
  lines: BillItem[],
  keyOf: (l: BillItem, i: number) => string,
  labelOf: (key: string) => string,
  canal: Canal,
): { checks: SplitCheck[]; total: number } {
  const total = computeTotals(lines, canal).total
  const groups = new Map<string, BillItem[]>()
  lines.forEach((l, i) => {
    const k = keyOf(l, i)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(l)
  })
  const keys = [...groups.keys()]
  let acc = 0
  const checks: SplitCheck[] = keys.map((k, idx) => {
    const gl = groups.get(k)!
    const amount = idx === keys.length - 1
      ? roundCrc(total - acc)                         // último reconcilia
      : roundCrc(computeTotals(gl, canal).total)
    acc += amount
    return { key: k, label: labelOf(k), amount_crc: amount, lines: gl }
  })
  return { checks, total }
}

/**
 * Reparto POR ÍTEM. `checkOfLine(i)` = índice del check (0..n-1) o null = COMPARTIDO.
 * Los exclusivos se valoran con computeTotals sobre sus líneas; los compartidos se
 * reparten parejo entre los n checks. El último check reconcilia → suma == total.
 */
export function splitByItem(
  lines: BillItem[],
  checkOfLine: (i: number) => number | null,
  n: number,
  canal: Canal,
  labelOf?: (idx: number) => string,
): { checks: SplitCheck[]; total: number } {
  const total = computeTotals(lines, canal).total
  const k = Math.max(1, Math.floor(n))
  const exclusive: BillItem[][] = Array.from({ length: k }, () => [])
  const shared: BillItem[] = []
  lines.forEach((l, i) => {
    const c = checkOfLine(i)
    if (c == null || c < 0 || c >= k) shared.push(l)
    else exclusive[c].push(l)
  })
  const sharedTotal = computeTotals(shared, canal).total
  const sharedShare = splitEven(sharedTotal, k)
  let acc = 0
  const checks: SplitCheck[] = Array.from({ length: k }, (_, idx) => {
    const excl = roundCrc(computeTotals(exclusive[idx], canal).total)
    const amount = idx === k - 1
      ? roundCrc(total - acc)                          // último reconcilia TODO el redondeo
      : roundCrc(excl + sharedShare[idx])
    acc += amount
    return {
      key: String(idx),
      label: labelOf ? labelOf(idx) : `Cuenta ${idx + 1}`,
      amount_crc: amount,
      lines: exclusive[idx],   // los compartidos no se listan en un check puntual (prorrateados)
    }
  })
  return { checks, total }
}

/** Verifica el invariante: la suma de los checks es exactamente el total. */
export function checksReconcile(checks: { amount_crc: number }[], totalCrc: number): boolean {
  return roundCrc(checks.reduce((s, c) => s + c.amount_crc, 0)) === roundCrc(totalCrc)
}
