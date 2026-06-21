/**
 * ReporteMensual (unificado) — consolida Ventas + Propinas + Caja de un mes
 * Ruta: /reporte-mensual  ·  lazy-loaded en App.tsx
 *
 * - Selector de mes/año (default: mes actual)
 * - Ventas: total neto, PAX, Prom/PAX, mejor/peor día, vs mes anterior %
 * - Propinas: pool total, desglose Q1/Q2, top 3 earners, cantidad de turnos
 * - Caja: ingresos totales, egresos por subcategoría (top 3), saldo neto
 * - Compartir (navigator.share → WhatsApp, fallback clipboard) + Imprimir
 *
 * Datos: reutiliza las funciones de shared/api de ventas (getVentasDias/getVentasHist/
 * getProductMap). Para propinas y caja consulta el rango del mes vía supabase
 * (no existe una función mes-filtrada en shared/api).
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../shared/api/supabase'
import { getVentasDias, getVentasHist, getProductMap } from '../../shared/api/ventas'
import { getActiveEmployees } from '../../shared/api/tips'
import { monthRangeBounds } from '../../shared/utils/dateRange'
import type { DiasMap, HistMap, ProductMap } from '../../shared/types/ventas'
import type { Employee, MovementType } from '../../shared/types/database'
import {
  getContabilidadDays, fi, fmtDate, fmtMonthLabel, daysInMonth, todayISO,
} from '../../modules/ventas/ventasUtils'
import { isEgreso } from '../../modules/cash/cashUtils'

// ── Types for the assembled report ──────────────────────────────
interface VentasBlock {
  totVN: number; pax: number; promPax: number; days: number
  maxDay: { fecha: string; ventaNeta: number } | null
  minDay: { fecha: string; ventaNeta: number } | null
  prevVN: number; varPct: number | null
}
interface PropinasBlock {
  pool: number; q1: number; q2: number; turnos: number
  top: Array<{ name: string; payout: number }>
}
interface CajaBlock {
  ingresos: number; egresos: number; neto: number
  topEgresos: Array<{ subcat: string; amt: number }>
}

// ── Data assembly ───────────────────────────────────────────────
function computeVentas(ym: string, dias: DiasMap, hist: HistMap): VentasBlock {
  const [y, m] = ym.split('-').map(Number)
  const days = getContabilidadDays(y, m, dias, hist)
  const totVN = days.reduce((s, d) => s + d.ventaNeta, 0)
  const pax   = days.reduce((s, d) => s + d.pax, 0)
  const salon = days.reduce((s, d) => s + d.salon, 0)
  const maxDay = days.length ? days.reduce((a, b) => (a.ventaNeta > b.ventaNeta ? a : b)) : null
  const minDay = days.length ? days.reduce((a, b) => (a.ventaNeta < b.ventaNeta ? a : b)) : null

  const prevYM = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
  const [py, pmn] = prevYM.split('-').map(Number)
  const prevDays = getContabilidadDays(py, pmn, dias, hist)
  const prevVN = prevDays.reduce((s, d) => s + d.ventaNeta, 0)

  return {
    totVN, pax,
    promPax: pax > 0 ? salon / pax : 0,
    days: days.length,
    maxDay: maxDay ? { fecha: maxDay.fecha, ventaNeta: maxDay.ventaNeta } : null,
    minDay: minDay ? { fecha: minDay.fecha, ventaNeta: minDay.ventaNeta } : null,
    prevVN,
    varPct: prevVN > 0 ? ((totVN - prevVN) / prevVN) * 100 : null,
  }
}

async function fetchPropinas(ym: string, emps: Employee[]): Promise<PropinasBlock> {
  const empName = new Map(emps.map(e => [e.id, e.full_name]))

  const { data: sessions } = await supabase
    .from('tip_sessions')
    .select('id, session_date, pool_efectivo_crc, pool_efectivo_usd, pool_barra_crc, exchange_rate')
    .eq('status', 'closed')
    // Límite superior EXCLUSIVO = 1° del mes siguiente (no `${ym}-31`, fecha inválida → 400).
    .gte('session_date', monthRangeBounds(ym).start)
    .lt('session_date', monthRangeBounds(ym).endExclusive)

  const rows = (sessions ?? []) as Array<{
    id: string; session_date: string
    pool_efectivo_crc: number; pool_efectivo_usd: number; pool_barra_crc: number; exchange_rate: number
  }>

  let pool = 0, q1 = 0, q2 = 0
  for (const s of rows) {
    const p = (s.pool_efectivo_crc ?? 0) + (s.pool_efectivo_usd ?? 0) * (s.exchange_rate ?? 640) + (s.pool_barra_crc ?? 0)
    pool += p
    if (Number(s.session_date.slice(8, 10)) <= 15) q1 += p
    else q2 += p
  }

  // Top earners from entries
  const ids = rows.map(r => r.id)
  const top: Array<{ name: string; payout: number }> = []
  if (ids.length) {
    const { data: entries } = await supabase
      .from('tip_entries')
      .select('employee_id, payout_crc')
      .in('session_id', ids)
    const byEmp: Record<string, number> = {}
    for (const e of (entries ?? []) as Array<{ employee_id: string; payout_crc: number | null }>) {
      byEmp[e.employee_id] = (byEmp[e.employee_id] ?? 0) + (e.payout_crc ?? 0)
    }
    Object.entries(byEmp)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .forEach(([id, payout]) => top.push({ name: empName.get(id) ?? '—', payout }))
  }

  return { pool, q1, q2, turnos: rows.length, top }
}

async function fetchCaja(ym: string): Promise<CajaBlock> {
  // created_at fue corregido a la fecha real de transacción durante la migración
  const { data } = await supabase
    .from('cash_movements')
    .select('movement_type, amount_crc, subcategory, status, created_at')
    // Límite superior EXCLUSIVO = 1° del mes siguiente 00:00Z (no `${ym}-31T23:59:59Z`, inválido → 400).
    .gte('created_at', monthRangeBounds(ym).startTs)
    .lt('created_at', monthRangeBounds(ym).endExclusiveTs)

  const movs = ((data ?? []) as Array<{
    movement_type: MovementType; amount_crc: number; subcategory: string; status: string
  }>).filter(m => m.status !== 'rechazado')

  let ingresos = 0, egresos = 0
  const bySub: Record<string, number> = {}
  for (const m of movs) {
    if (m.movement_type === 'ingreso') ingresos += m.amount_crc
    else if (isEgreso(m.movement_type)) {
      egresos += m.amount_crc
      if (m.amount_crc > 0) {
        const k = m.subcategory?.trim() || m.movement_type
        bySub[k] = (bySub[k] ?? 0) + m.amount_crc
      }
    }
  }
  const topEgresos = Object.entries(bySub)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([subcat, amt]) => ({ subcat, amt }))

  return { ingresos, egresos, neto: ingresos - egresos, topEgresos }
}

// ── Share text ──────────────────────────────────────────────────
function buildShareText(ym: string, v: VentasBlock, p: PropinasBlock, c: CajaBlock): string {
  const L: string[] = []
  L.push(`里 SATORI — Reporte ${fmtMonthLabel(ym)}`)
  L.push('')
  L.push('📈 VENTAS')
  L.push(`  Venta neta: ${fi(v.totVN)}`)
  L.push(`  PAX: ${v.pax.toLocaleString('es-CR')}  ·  Prom/PAX: ${fi(v.promPax)}`)
  if (v.maxDay) L.push(`  Mejor día: ${fmtDate(v.maxDay.fecha)} (${fi(v.maxDay.ventaNeta)})`)
  if (v.varPct !== null) L.push(`  vs mes anterior: ${v.varPct >= 0 ? '+' : ''}${v.varPct.toFixed(1)}%`)
  L.push('')
  L.push('💰 PROPINAS')
  L.push(`  Pool total: ${fi(p.pool)}  ·  ${p.turnos} turnos`)
  L.push(`  Q1: ${fi(p.q1)}  ·  Q2: ${fi(p.q2)}`)
  p.top.forEach((t, i) => L.push(`  ${i + 1}. ${t.name}: ${fi(t.payout)}`))
  L.push('')
  L.push('金 CAJA')
  L.push(`  Ingresos: ${fi(c.ingresos)}`)
  L.push(`  Egresos: ${fi(c.egresos)}`)
  L.push(`  Neto: ${c.neto >= 0 ? '+' : ''}${fi(c.neto)}`)
  c.topEgresos.forEach(e => L.push(`    · ${e.subcat}: ${fi(e.amt)}`))
  return L.join('\n')
}

async function shareReport(text: string, setCopied: (v: boolean) => void) {
  if (navigator.share) {
    try { await navigator.share({ text }); return } catch { /* fallback */ }
  }
  try {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  } catch {
    window.prompt('Copiá el texto:', text)
  }
}

// ── Component ───────────────────────────────────────────────────
export default function ReporteMensual() {
  const navigate = useNavigate()
  const now = todayISO()
  const [ym, setYm] = useState(now.slice(0, 7))
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  // Ventas source (loaded once)
  const [dias, setDias] = useState<DiasMap>({})
  const [hist, setHist] = useState<HistMap>({})
  const [emps, setEmps] = useState<Employee[]>([])
  const [sourceReady, setSourceReady] = useState(false)

  const [ventas, setVentas] = useState<VentasBlock | null>(null)
  const [propinas, setPropinas] = useState<PropinasBlock | null>(null)
  const [caja, setCaja] = useState<CajaBlock | null>(null)

  // Load heavy ventas source + employees once
  useEffect(() => {
    Promise.all([getVentasDias(400), getVentasHist(), getProductMap(), getActiveEmployees()])
      .then(([d, h, _pm, e]: [DiasMap, HistMap, ProductMap, Employee[]]) => {
        setDias(d); setHist(h); setEmps(e); setSourceReady(true)
      })
      .catch(console.error)
  }, [])

  // Available months from ventas + a 24-month fallback window
  const availableMonths = useMemo(() => {
    const set = new Set<string>()
    for (const k of [...Object.keys(dias), ...Object.keys(hist)]) set.add(k.slice(0, 7))
    // ensure current + recent months are present even before data loads
    const [cy, cmRaw] = now.slice(0, 7).split('-').map(Number)
    for (let i = 0; i < 18; i++) {
      const dt = new Date(cy, cmRaw - 1 - i, 1)
      set.add(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`)
    }
    return [...set].sort().reverse()
  }, [dias, hist, now])

  const reload = useCallback(async () => {
    if (!sourceReady) return
    setLoading(true)
    try {
      const v = computeVentas(ym, dias, hist)
      const [p, c] = await Promise.all([fetchPropinas(ym, emps), fetchCaja(ym)])
      setVentas(v); setPropinas(p); setCaja(c)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [ym, dias, hist, emps, sourceReady])

  useEffect(() => { reload() }, [reload])

  const shareText = useMemo(
    () => (ventas && propinas && caja ? buildShareText(ym, ventas, propinas, caja) : ''),
    [ym, ventas, propinas, caja],
  )

  const [y, m] = ym.split('-').map(Number)
  const prevYM = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`

  return (
    <div className="rm-page" style={{ minHeight: '100vh', background: 'var(--t-paper, #f5f0e8)', color: 'var(--t-ink, #0d0d0d)', fontFamily: 'var(--font-sans)' }}>
      {/* Header / controls — hidden on print */}
      <div className="no-print" style={{ position: 'sticky', top: 0, zIndex: 10, background: '#0d0d0d', borderBottom: '1px solid #1a1a1a', padding: '0.875rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <span style={{ fontFamily: 'var(--font-serif)', fontSize: '1.2rem', color: '#c8a96e', fontWeight: 700 }}>里</span>
          <div>
            <div style={{ fontSize: '0.95rem', fontWeight: 700 }}>Reporte mensual</div>
            <div style={{ fontSize: '0.68rem', color: '#888', letterSpacing: '0.06em' }}>Ventas · Propinas · Caja</div>
          </div>
        </div>

        <select
          value={ym}
          onChange={e => setYm(e.target.value)}
          style={{ background: '#111', border: '1px solid #2a2a2a', color: '#c8a96e', padding: '6px 12px', borderRadius: 2, fontSize: '0.85rem', fontWeight: 600 }}>
          {availableMonths.map(mo => (
            <option key={mo} value={mo}>{fmtMonthLabel(mo)}</option>
          ))}
        </select>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {copied && <span style={{ fontSize: '0.72rem', color: '#2a7a6a' }}>✓ Copiado</span>}
          <button onClick={() => shareReport(shareText, setCopied)} disabled={!shareText}
            style={{ fontSize: '0.8rem', padding: '6px 14px', border: '1px solid #2a4a6b', background: 'transparent', color: '#8ab0d8', borderRadius: 2, cursor: 'pointer' }}>
            ↗ Compartir
          </button>
          <button onClick={() => window.print()}
            style={{ fontSize: '0.8rem', padding: '6px 14px', border: '1px solid #2a7a6a', background: 'transparent', color: '#2a7a6a', borderRadius: 2, cursor: 'pointer' }}>
            🖨 Imprimir
          </button>
          <button onClick={() => navigate('/')}
            style={{ fontSize: '0.8rem', padding: '6px 14px', border: '1px solid #333', background: 'transparent', color: '#888', borderRadius: 2, cursor: 'pointer' }}>
            ← Inicio
          </button>
        </div>
      </div>

      {/* Report body */}
      <div className="rm-body" style={{ maxWidth: 880, margin: '0 auto', padding: '1.5rem 1.25rem 4rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#a07830' }}>{fmtMonthLabel(ym)}</div>
          <div style={{ fontSize: '0.72rem', color: '#5a5040' }}>Satori Sushi Bar · Santa Teresa, CR</div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '4rem', color: '#888' }}>Cargando datos del mes…</div>
        ) : (
          <>
            {/* ── VENTAS ── */}
            <Section title="📈 Ventas" color="#2a4a6b">
              {ventas && (
                <>
                  <KpiGrid items={[
                    { label: 'Venta neta', val: fi(ventas.totVN), bold: true },
                    { label: 'PAX', val: ventas.pax.toLocaleString('es-CR') },
                    { label: 'Prom / PAX', val: fi(ventas.promPax) },
                    { label: 'Días trabajados', val: `${ventas.days} de ${daysInMonth(ym)}` },
                  ]} />
                  <div style={{ marginTop: '0.75rem', display: 'flex', gap: '1.5rem', flexWrap: 'wrap', fontSize: '0.82rem' }}>
                    {ventas.maxDay && <span>Mejor día: <strong style={{ color: '#2a7a6a' }}>{fmtDate(ventas.maxDay.fecha)}</strong> · {fi(ventas.maxDay.ventaNeta)}</span>}
                    {ventas.minDay && <span>Peor día: <strong style={{ color: '#c23b22' }}>{fmtDate(ventas.minDay.fecha)}</strong> · {fi(ventas.minDay.ventaNeta)}</span>}
                  </div>
                  <div style={{ marginTop: '0.5rem', fontSize: '0.82rem', color: '#5a5040' }}>
                    vs {fmtMonthLabel(prevYM)}:{' '}
                    {ventas.varPct !== null ? (
                      <strong style={{ color: ventas.varPct >= 0 ? '#2a7a6a' : '#c23b22' }}>
                        {ventas.varPct >= 0 ? '▲ +' : '▼ '}{ventas.varPct.toFixed(1)}%
                      </strong>
                    ) : <span style={{ color: '#777' }}>— sin datos previos</span>}
                    {' '}({fi(ventas.prevVN)})
                  </div>
                </>
              )}
            </Section>

            {/* ── PROPINAS ── */}
            <Section title="💰 Propinas" color="#2a7a6a">
              {propinas && (
                <>
                  <KpiGrid items={[
                    { label: 'Pool total', val: fi(propinas.pool), bold: true },
                    { label: 'Turnos', val: String(propinas.turnos) },
                    { label: 'Q1 (1–15)', val: fi(propinas.q1) },
                    { label: 'Q2 (16–fin)', val: fi(propinas.q2) },
                  ]} />
                  {propinas.top.length > 0 && (
                    <div style={{ marginTop: '0.75rem' }}>
                      <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#777', marginBottom: '0.4rem' }}>Top earners</div>
                      {propinas.top.map((t, i) => (
                        <div key={t.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--t-border,#d4cfc4)', fontSize: '0.85rem' }}>
                          <span><span style={{ color: '#777', marginRight: '0.5rem' }}>{i + 1}</span>{t.name}</span>
                          <strong style={{ color: '#a07830' }}>{fi(t.payout)}</strong>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </Section>

            {/* ── CAJA ── */}
            <Section title="金 Caja" color="#a07830">
              {caja && (
                <>
                  <KpiGrid items={[
                    { label: 'Ingresos', val: fi(caja.ingresos) },
                    { label: 'Egresos', val: fi(caja.egresos) },
                    { label: 'Saldo neto', val: `${caja.neto >= 0 ? '+' : ''}${fi(caja.neto)}`, bold: true },
                  ]} />
                  {caja.topEgresos.length > 0 && (
                    <div style={{ marginTop: '0.75rem' }}>
                      <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#777', marginBottom: '0.4rem' }}>Top egresos por categoría</div>
                      {caja.topEgresos.map(e => (
                        <div key={e.subcat} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--t-border,#d4cfc4)', fontSize: '0.85rem' }}>
                          <span>{e.subcat}</span>
                          <strong style={{ color: '#c23b22' }}>{fi(e.amt)}</strong>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </Section>

            <div style={{ textAlign: 'center', fontSize: '0.68rem', color: '#666', marginTop: '2rem' }}>
              Satori App · {fmtMonthLabel(ym)} · Generado el {fmtDate(now)}
            </div>
          </>
        )}
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          .rm-page { background: #fff !important; color: #111 !important; }
          .rm-section { break-inside: avoid; }
          @page { margin: 1.5cm; size: A4 portrait; }
        }
      `}</style>
    </div>
  )
}

// ── Small presentational helpers ────────────────────────────────
function Section({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <div className="rm-section" style={{ marginBottom: '1.5rem', background: 'var(--t-paper)', border: '1px solid var(--t-border,#d4cfc4)', borderRadius: 4, padding: '1.1rem 1.25rem' }}>
      <div style={{ fontSize: '1rem', fontWeight: 700, color, borderBottom: `2px solid ${color}`, paddingBottom: '0.5rem', marginBottom: '0.875rem' }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function KpiGrid({ items }: { items: Array<{ label: string; val: string; bold?: boolean }> }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.75rem' }}>
      {items.map(k => (
        <div key={k.label} style={{ background: 'rgba(0,0,0,0.04)', border: '1px solid var(--t-border,#d4cfc4)', borderRadius: 3, padding: '0.6rem 0.75rem' }}>
          <div style={{ fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#5a5040', marginBottom: '0.25rem' }}>{k.label}</div>
          <div style={{ fontSize: k.bold ? '1.05rem' : '0.92rem', fontWeight: k.bold ? 700 : 500, color: k.bold ? 'var(--t-ink,#0d0d0d)' : '#5a5040', fontFamily: 'DM Mono, monospace' }}>{k.val}</div>
        </div>
      ))}
    </div>
  )
}
