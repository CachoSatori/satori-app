// Formato del reporte del dry-run. Puro (arma strings); el que hace I/O es cada run-*.ts.

import type { SessionPlan, MonthTotal } from './core.ts'

export const fi = (n: number): string => '₡ ' + Math.round(n).toLocaleString('es-CR')

export interface ReportInput {
  label: string                 // 'STAGING' | 'PROD'
  ref: string
  hadColumn: boolean            // ¿existía pool_total_crc? (idempotencia)
  plans: SessionPlan[]
  months: MonthTotal[]
  focusMonth?: string           // detalle por sesión de este mes
  expected?: { month: string; crc: number }   // control (p.ej. Julio 2026 = 2.167.131)
}

export interface ReportOutput { text: string; expectedOk: boolean | null }

export function formatReport(inp: ReportInput): ReportOutput {
  const L: string[] = []
  const changed = inp.plans.filter((p) => p.changed).length
  L.push(`── DRY-RUN pool_total_crc · ${inp.label} (${inp.ref}) ──`)
  L.push(`Sesiones cerradas: ${inp.plans.length} · con total que cambiaría: ${changed} · ` +
    `columna pool_total_crc en la base: ${inp.hadColumn ? 'SÍ' : 'NO (sin backfill previo)'}`)
  L.push('')
  L.push('Total del pool por mes (Σ calcHistory().totalPool, redondeado al final):')
  L.push('  mes       sesiones        total')
  for (const m of inp.months) {
    L.push(`  ${m.month}   ${String(m.sessions).padStart(6)}   ${fi(m.totalRounded).padStart(14)}`)
  }

  let expectedOk: boolean | null = null
  if (inp.expected) {
    const m = inp.months.find((x) => x.month === inp.expected!.month)
    const got = m ? m.totalRounded : null
    expectedOk = got === inp.expected.crc
    L.push('')
    L.push(`Control ${inp.expected.month}: esperado ${fi(inp.expected.crc)} · obtenido ` +
      `${got == null ? '—' : fi(got)}  → ${expectedOk ? '✅ COINCIDE' : '❌ NO COINCIDE'}`)
  }

  if (inp.focusMonth) {
    const foco = inp.plans.filter((p) => p.month === inp.focusMonth)
    if (foco.length) {
      L.push('')
      L.push(`Detalle por sesión · ${inp.focusMonth} (calcHistory().totalPool por turno):`)
      for (const p of foco) {
        const cur = p.current == null ? 'NULL' : fi(p.current)
        L.push(`  ${p.session_date} ${p.shift_type.padEnd(3)}  ${fi(p.poolTotal).padStart(14)}` +
          `   (actual: ${cur}${p.changed ? ' → cambiaría' : ' · igual'})`)
      }
    }
  }
  return { text: L.join('\n'), expectedOk }
}
