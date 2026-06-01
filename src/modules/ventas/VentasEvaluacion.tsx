/**
 * VentasEvaluacion — Gestión del Equipo
 * Ported from SATORI DASHBOARD standalone app (renderEvaluacion2 / renderEquipoGestion)
 *
 * Per-salonero performance metrics:
 * - Consistencia: % of days at/above the daily general average (0-100)
 * - Tendencia: last 7 days promPax vs prior 7 days promPax
 * - Racha: consecutive days at/above promPax meta
 * - % de meta: how close to the target each metric is
 */
import { useState, useMemo } from 'react'
import { todayCR } from '../../shared/utils'
import type { DiasMap, ProductMap, Meta } from '../../shared/types/ventas'
import {
  aggSalonero, aggGeneral,
  fi, metaColor, getMeta, ratioCBClass,
  allSaloneros, datesInRange, allDates, availableMonths,
} from './ventasUtils'

interface Props {
  dias:  DiasMap
  pm:    ProductMap
  metas: Meta
}

// ── Compute advanced metrics (uses pre-built cache to avoid O(n²)) ────────────
function calcAdvanced(
  name: string,
  dates: string[],
  dias: DiasMap,
  pm: ProductMap,
  metas: Meta,
  dayAggCache: Record<string, ReturnType<typeof aggSalonero>>,
  dayGenCache: Record<string, ReturnType<typeof aggGeneral>>,
) {
  if (!dates.length) return null

  const getDay    = (d: string) => dayAggCache[`${name}|${d}`] ?? aggSalonero(name, [d], dias, pm)
  const getGenDay = (d: string) => dayGenCache[d] ?? aggGeneral([d], dias, pm)

  const metaPP  = getMeta(metas, name, 'promPax')
  const metaBP  = getMeta(metas, name, 'bebPax')
  const metaRat = getMeta(metas, name, 'ratioCB')

  // Daily promPax values — uses cache
  const dailyVals = dates
    .map(d => { const s = getDay(d); return s.days > 0 ? s.promPax : null })
    .filter((v): v is number => v !== null)

  if (!dailyVals.length) return null

  const mean = dailyVals.reduce((s, v) => s + v, 0) / dailyVals.length

  // General average per day
  const genDailyVals = dates
    .map(d => { const g = getGenDay(d); return g.pax > 0 ? g.promPax : null })
    .filter((v): v is number => v !== null)

  const genMean = genDailyVals.length > 0
    ? genDailyVals.reduce((s, v) => s + v, 0) / genDailyVals.length : 0

  // Consistencia: % days above daily general average
  const daysAboveAvg = dates.filter(d => {
    const s = getDay(d); const g = getGenDay(d)
    return s.days > 0 && g.pax > 0 && s.promPax >= g.promPax
  }).length
  const totalWorked  = dailyVals.length
  const consistencia = totalWorked > 0 ? (daysAboveAvg / totalWorked) * 100 : 0

  // Tendencia: last 7 worked days vs prior 7 worked days
  const workedDates = dates.filter(d => getDay(d).days > 0)
  const last7  = workedDates.slice(-7)
  const prev7  = workedDates.slice(-14, -7)
  const avgL7  = last7.length > 0 ? last7.reduce((s, d) => s + getDay(d).promPax, 0) / last7.length : 0
  const avgP7  = prev7.length > 0 ? prev7.reduce((s, d) => s + getDay(d).promPax, 0) / prev7.length : 0
  const tendencia = avgP7 > 0 ? ((avgL7 - avgP7) / avgP7) * 100 : 0

  // Racha: consecutive days at/above promPax meta
  let racha = 0
  if (metaPP > 0) {
    for (const d of [...workedDates].reverse()) {
      if (getDay(d).promPax >= metaPP) racha++; else break
    }
  }

  // Full period agg
  const agg = aggSalonero(name, dates, dias, pm)

  return {
    agg, mean, genMean, consistencia, tendencia, racha,
    totalWorked,
    pctMetaPP:  metaPP  > 0 ? (agg.promPax / metaPP  * 100) : null,
    pctMetaBP:  metaBP  > 0 ? (agg.bebPax  / metaBP  * 100) : null,
    pctMetaRat: metaRat > 0 ? (agg.ratioCB / metaRat * 100) : null,
  }
}

function pctColor(pct: number | null): string {
  if (pct === null) return ''
  if (pct >= 100)   return 'var(--vt-green)'
  if (pct >= 85)    return 'var(--vt-gold-dark,#a07830)'
  return 'var(--vt-red)'
}

function consistenciaColor(c: number): string {
  if (c >= 70) return 'var(--vt-green)'
  if (c >= 40) return 'var(--vt-gold-dark,#a07830)'
  return 'var(--vt-red)'
}

const MSHORT = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

export default function VentasEvaluacion({ dias, pm, metas }: Props) {
  const dates  = useMemo(() => allDates(dias), [dias])
  const sals   = useMemo(() => allSaloneros(dias), [dias])
  const months = useMemo(() => availableMonths(dias, {}), [dias])

  // Period selector — month or last-N-days presets
  const [period, setPeriod]   = useState<string>('30d')  // '30d'|'YYYY-MM'
  const [viewMode, setViewMode] = useState<'cards'|'tabla'>('cards')
  const [sortCol, setSortCol]  = useState<string>('promPax')

  // Compute evalDates based on selected period
  const evalDates = useMemo(() => {
    if (!dates.length) return []
    const last = dates[dates.length - 1]
    if (period === '7d') {
      const d = new Date((last || todayCR()) + 'T12:00:00'); d.setDate(d.getDate() - 7)
      return datesInRange(dates, d.toISOString().slice(0,10), last)
    }
    if (period === '30d') {
      const d = new Date((last || todayCR()) + 'T12:00:00'); d.setDate(d.getDate() - 30)
      return datesInRange(dates, d.toISOString().slice(0,10), last)
    }
    if (period === 'all') return dates
    // YYYY-MM
    return dates.filter(d => d.startsWith(period))
  }, [dates, period])

  // PERF: pre-compute per-day aggSalonero for ALL saloneros × evalDates ONCE
  const dayAggCache = useMemo(() => {
    const cache: Record<string, ReturnType<typeof aggSalonero>> = {}
    for (const date of evalDates) {
      for (const name of sals) {
        cache[`${name}|${date}`] = aggSalonero(name, [date], dias, pm)
      }
    }
    return cache
  }, [evalDates, sals, dias, pm])

  const dayGenCache = useMemo(() => {
    const cache: Record<string, ReturnType<typeof aggGeneral>> = {}
    for (const date of evalDates) { cache[date] = aggGeneral([date], dias, pm) }
    return cache
  }, [evalDates, dias, pm])

  const results = useMemo(() => {
    const raw = sals
      .map(name => ({ name, data: calcAdvanced(name, evalDates, dias, pm, metas, dayAggCache, dayGenCache) }))
      .filter(r => r.data !== null)
    // Sort by selected column
    return raw.sort((a, b) => {
      const da = a.data!, db = b.data!
      if (sortCol === 'promPax')     return db.agg.promPax   - da.agg.promPax
      if (sortCol === 'bebPax')      return db.agg.bebPax    - da.agg.bebPax
      if (sortCol === 'ratioCB')     return db.agg.ratioCB   - da.agg.ratioCB
      if (sortCol === 'consistencia')return db.consistencia  - da.consistencia
      if (sortCol === 'tendencia')   return db.tendencia     - da.tendencia
      if (sortCol === 'racha')       return db.racha         - da.racha
      if (sortCol === 'total')       return db.agg.total     - da.agg.total
      if (sortCol === 'dias')        return db.totalWorked   - da.totalWorked
      return db.agg.promPax - da.agg.promPax
    })
  }, [sals, evalDates, dias, pm, metas, dayAggCache, dayGenCache, sortCol])

  if (!results.length) {
    return (
      <div className="vt-empty">
        <div className="vt-empty-icon">評</div>
        <div className="vt-empty-title">Sin datos suficientes</div>
        <div className="vt-empty-sub">Cargá al menos 2 semanas de XLS para ver la evaluación</div>
      </div>
    )
  }

  const genAgg = aggGeneral(evalDates, dias, pm)

  return (
    <div className="vt-section">

      {/* ── Period selector + view toggle ── */}
      <div style={{ display:'flex', gap:'0.5rem', flexWrap:'wrap', alignItems:'center', marginBottom:'1rem' }}>
        {/* Period presets */}
        <div className="vt-tab-group">
          {[
            { id:'7d',  label:'7 días' },
            { id:'30d', label:'30 días' },
            { id:'all', label:'Todo' },
          ].map(p => (
            <button key={p.id} className={`vt-tab-btn ${period === p.id ? 'active' : ''}`}
              onClick={() => setPeriod(p.id)}>{p.label}</button>
          ))}
        </div>
        {/* Month buttons */}
        <div style={{ display:'flex', gap:'0.25rem', flexWrap:'wrap' }}>
          {months.slice(0,6).map(m => {
            const mo = Number(m.split('-')[1])
            return (
              <button key={m} className={`vt-range-btn ${period === m ? 'active' : ''}`}
                onClick={() => setPeriod(m)} style={{ fontSize:'0.68rem' }}>
                {MSHORT[mo-1]} {m.slice(0,4)}
              </button>
            )
          })}
        </div>

        {/* View toggle + print */}
        <div style={{ marginLeft:'auto', display:'flex', gap:'0.5rem' }}>
          <div className="vt-tab-group">
            <button className={`vt-tab-btn ${viewMode==='cards'?'active':''}`} onClick={() => setViewMode('cards')}>☰ Tarjetas</button>
            <button className={`vt-tab-btn ${viewMode==='tabla'?'active':''}`} onClick={() => setViewMode('tabla')}>⊞ Tabla</button>
          </div>
          <button
            onClick={() => window.print()}
            style={{ padding:'5px 12px', borderRadius:2, border:'1px solid #2a2a2a', background:'transparent', color:'#888', fontSize:'0.75rem', cursor:'pointer' }}>
            🖨 Imprimir
          </button>
        </div>
      </div>

      <div className="vt-sl" style={{ marginBottom: '0.5rem' }}>
        Evaluación de equipo — {evalDates.length} días · {results.length} saloneros
      </div>
      {viewMode === 'cards' && (
      <div style={{ fontSize: '0.72rem', color: 'var(--vt-muted)', marginBottom: '1.25rem' }}>
        Consistencia = % días sobre el promedio general del restaurante.
        Tendencia = últimos 7 días trabajados vs 7 anteriores.
        Racha = días consecutivos sobre la meta de Prom/PAX.
      </div>
      )}

      {/* General stats + cards — only in cards mode */}
      {viewMode === 'cards' && <><div className="vt-kpi-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="vt-kpi">
          <div className="vt-kpi-label">Equipo activo</div>
          <div className="vt-kpi-val">{results.length} saloneros</div>
        </div>
        <div className="vt-kpi green">
          <div className="vt-kpi-label">Prom/PAX general</div>
          <div className="vt-kpi-val">{fi(genAgg.promPax)}</div>
        </div>
        <div className="vt-kpi">
          <div className="vt-kpi-label">Mejor del período</div>
          <div className="vt-kpi-val" style={{ fontSize: '0.85rem' }}>
            {results[0]?.name ?? '—'}
          </div>
          <div className="vt-kpi-sub">{fi(results[0]?.data?.agg.promPax ?? 0)}</div>
        </div>
      </div>

      {/* Evaluation cards grid */}
      <div className="vt-eval-grid">
        {results.map(({ name, data }, rank) => {
          if (!data) return null
          const { agg, consistencia, tendencia, racha, totalWorked,
                  pctMetaPP, pctMetaBP, pctMetaRat } = data
          const metaPP  = getMeta(metas, name, 'promPax')
          const metaBP  = getMeta(metas, name, 'bebPax')
          const metaRat = getMeta(metas, name, 'ratioCB')

          return (
            <div key={name} className="vt-eval-card">
              {/* Header */}
              <div className="vt-eval-card-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div className="vt-eval-rank">
                    {rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : `#${rank + 1}`}
                  </div>
                  <div>
                    <div className="vt-eval-name">{name}</div>
                    <div className="vt-eval-sub">{totalWorked} días trabajados</div>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  {/* Tendencia badge */}
                  {Math.abs(tendencia) > 0.5 && (
                    <div style={{
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      color: tendencia >= 0 ? 'var(--vt-green)' : 'var(--vt-red)',
                    }}>
                      {tendencia >= 0 ? '▲' : '▼'} {Math.abs(tendencia).toFixed(1)}% vs sem ant
                    </div>
                  )}
                  {/* Racha badge */}
                  {racha >= 3 && (
                    <div style={{ fontSize: '0.72rem', color: 'var(--vt-gold-dark,#a07830)', marginTop: '0.1rem' }}>
                      🔥 {racha} días seguidos
                    </div>
                  )}
                </div>
              </div>

              {/* 4 KPI mini-cards */}
              <div className="vt-eval-metrics">
                {[
                  {
                    label: 'Prom/PAX',
                    val:   fi(agg.promPax),
                    meta:  metaPP,
                    pct:   pctMetaPP,
                    color: metaColor(agg.promPax, metaPP),
                  },
                  {
                    label: 'Beb/PAX',
                    val:   agg.bebPax.toFixed(2),
                    meta:  metaBP,
                    pct:   pctMetaBP,
                    color: metaColor(agg.bebPax, metaBP),
                  },
                  {
                    label: 'Ratio C/B',
                    val:   agg.ratioCB.toFixed(2) + ':1',
                    meta:  metaRat,
                    pct:   pctMetaRat,
                    color: 'inherit',
                    cls:   ratioCBClass(agg.ratioCB),
                  },
                  {
                    label: 'Ticket/item',
                    val:   fi(agg.promTicket),
                    meta:  getMeta(metas, name, 'ticketItem'),
                    pct:   getMeta(metas, name, 'ticketItem') > 0
                      ? agg.promTicket / getMeta(metas, name, 'ticketItem') * 100 : null,
                    color: metaColor(agg.promTicket, getMeta(metas, name, 'ticketItem')),
                  },
                ].map(kpi => (
                  <div key={kpi.label} className="vt-eval-metric">
                    <div className="vt-eval-metric-label">{kpi.label}</div>
                    <div className={`vt-eval-metric-val ${kpi.cls ?? ''}`}
                      style={kpi.color && kpi.color !== 'inherit' ? { color: kpi.color } : {}}>
                      {kpi.val}
                    </div>
                    {kpi.pct !== null && (
                      <div className="vt-eval-metric-pct"
                        style={{ color: pctColor(kpi.pct) }}>
                        {kpi.pct.toFixed(0)}% meta
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Consistencia bar */}
              <div className="vt-eval-consistencia">
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                  <span className="vt-eval-metric-label">Consistencia</span>
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, color: consistenciaColor(consistencia) }}>
                    {consistencia.toFixed(0)}%
                  </span>
                </div>
                <div className="vt-progress-track">
                  <div className="vt-progress-fill" style={{
                    width: `${consistencia}%`,
                    background: consistenciaColor(consistencia),
                  }} />
                </div>
                <div style={{ fontSize: '0.65rem', color: 'var(--vt-muted)', marginTop: '0.2rem' }}>
                  {Math.round(consistencia / 100 * totalWorked)} de {totalWorked} días sobre promedio general
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Ranking table */}
      <div className="vt-sl" style={{ marginTop: '2rem' }}>Ranking comparativo</div>
      <div className="vt-tbl-wrap">
        <table className="vt-tbl">
          <thead>
            <tr>
              <th>#</th>
              <th>Salonero</th>
              <th className="r">Días</th>
              <th className="r">Prom/PAX</th>
              <th className="r">vs General</th>
              <th className="r">% Meta</th>
              <th className="r">Consistencia</th>
              <th className="r">Tendencia</th>
              <th className="r">Racha</th>
            </tr>
          </thead>
          <tbody>
            {results.map(({ name, data }, i) => {
              if (!data) return null
              const { agg, consistencia, tendencia, racha, totalWorked, pctMetaPP } = data
              const vsGen = agg.promPax - genAgg.promPax
              return (
                <tr key={name} className={i === 0 ? 'tr-best' : ''}>
                  <td className="vt-muted" style={{ fontWeight: 700 }}>{i + 1}</td>
                  <td style={{ fontWeight: 600 }}>{name}</td>
                  <td className="r vt-muted">{totalWorked}</td>
                  <td className="r vt-bold">{fi(agg.promPax)}</td>
                  <td className="r" style={{ color: vsGen >= 0 ? 'var(--vt-green)' : 'var(--vt-red)', fontWeight: 600 }}>
                    {vsGen >= 0 ? '+' : ''}{fi(vsGen)}
                  </td>
                  <td className="r" style={{ color: pctColor(pctMetaPP) }}>
                    {pctMetaPP !== null ? pctMetaPP.toFixed(0) + '%' : '—'}
                  </td>
                  <td className="r" style={{ color: consistenciaColor(consistencia), fontWeight: 600 }}>
                    {consistencia.toFixed(0)}%
                  </td>
                  <td className="r" style={{ color: tendencia >= 0 ? 'var(--vt-green)' : 'var(--vt-red)', fontWeight: 600 }}>
                    {Math.abs(tendencia) > 0.5 ? (tendencia >= 0 ? '▲ ' : '▼ ') + Math.abs(tendencia).toFixed(1) + '%' : '→'}
                  </td>
                  <td className="r">
                    {racha >= 3 ? `🔥 ${racha}d` : racha > 0 ? `${racha}d` : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* 12-week Prom/PAX trend per salonero */}
      {(() => {
        // Build weekly buckets — last 12 weeks
        const weeks: string[] = []
        const refDate = dates[dates.length - 1] ?? todayCR()
        for (let w = 11; w >= 0; w--) {
          const d = new Date(refDate + 'T12:00:00')
          d.setDate(d.getDate() - w * 7)
          weeks.push(d.toISOString().slice(0, 10))
        }

        // For each week, get the 7 days ending on that date
        const weekRanges = weeks.map(end => {
          const d = new Date(end + 'T12:00:00')
          const start = new Date(d); start.setDate(d.getDate() - 6)
          return { end, dates: datesInRange(dates, start.toISOString().slice(0,10), end) }
        })

        // Only include saloneros with enough data
        const trendSals = results.filter(r => r.data && r.data.totalWorked >= 3)
        if (trendSals.length === 0) return null

        return (
          <div style={{ marginTop: '2rem' }}>
            <div className="vt-sl" style={{ marginBottom: '0.5rem' }}>Tendencia Prom/PAX — últimas 12 semanas</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '0.75rem' }}>
              {trendSals.slice(0, 6).map(({ name }) => {
                const weeklyVals = weekRanges.map(({ dates: wDates }) => {
                  if (!wDates.length) return 0
                  const agg = aggSalonero(name, wDates, dias, pm)
                  return agg.days > 0 ? agg.promPax : 0
                })
                const nonZero = weeklyVals.filter(v => v > 0)
                if (nonZero.length < 2) return null
                const maxVal = Math.max(...weeklyVals, 1)
                const minNonZero = Math.min(...nonZero)
                const latest = nonZero[nonZero.length - 1]
                const prev    = nonZero[nonZero.length - 2]
                const trend   = prev > 0 ? ((latest - prev) / prev * 100) : 0

                return (
                  <div key={name} style={{ background: 'var(--vt-ink)', borderRadius: 2, padding: '0.75rem 0.875rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                      <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--vt-paper)' }}>{name}</div>
                      <div style={{ fontSize: '0.65rem', fontWeight: 700, color: trend >= 0 ? 'var(--vt-green)' : 'var(--vt-red)' }}>
                        {trend >= 0 ? '▲' : '▼'}{Math.abs(trend).toFixed(0)}%
                      </div>
                    </div>
                    {/* Sparkline */}
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 36 }}>
                      {weeklyVals.map((v, i) => {
                        const h = v > 0 ? Math.max(4, Math.round((v - minNonZero * 0.8) / (maxVal - minNonZero * 0.8) * 100)) : 2
                        const isLast = i === weeklyVals.length - 1
                        const col = isLast ? 'var(--vt-gold)' : v > 0 ? '#3a6a9a' : '#1a1a1a'
                        return <div key={i} style={{ flex: 1, height: `${Math.min(h,100)}%`, background: col, borderRadius: 1, transition: 'height 0.3s', minHeight: 2 }} />
                      })}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.25rem', fontSize: '0.6rem', color: '#555' }}>
                      <span>12 sem</span>
                      <span style={{ color: 'var(--vt-gold)', fontWeight: 700 }}>Ahora: {fi(latest)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}</>}

      {/* ── TABLA SCORECARD ── */}
      {viewMode === 'tabla' && (
        <>
          <div className="vt-tbl-wrap" id="eval-print-table">
            <table className="vt-tbl" style={{ fontSize:'0.82rem' }}>
              <thead>
                <tr>
                  <th style={{ width:32 }}>#</th>
                  <th>Salonero</th>
                  {[
                    { id:'dias',         label:'Días' },
                    { id:'total',        label:'Ventas' },
                    { id:'promPax',      label:'Prom/PAX' },
                    { id:'bebPax',       label:'Beb/PAX' },
                    { id:'ratioCB',      label:'Ratio C/B' },
                    { id:'consistencia', label:'Consist.' },
                    { id:'tendencia',    label:'Tendencia' },
                    { id:'racha',        label:'Racha' },
                  ].map(col => (
                    <th key={col.id} className="r"
                      style={{ cursor:'pointer', color: sortCol === col.id ? 'var(--vt-gold)' : undefined }}
                      onClick={() => setSortCol(col.id)}>
                      {col.label}{sortCol === col.id ? ' ▼' : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.map(({ name, data }, i) => {
                  if (!data) return null
                  const metaPP  = getMeta(metas, name, 'promPax')
                  const metaBP  = getMeta(metas, name, 'bebPax')
                  const medal   = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1
                  const cPP = metaColor(data.agg.promPax, metaPP) || (data.agg.promPax >= genAgg.promPax ? 'var(--vt-green)' : 'var(--vt-red)')
                  const cBP = metaColor(data.agg.bebPax, metaBP)
                  const trendCol = data.tendencia >= 0 ? 'var(--vt-green)' : 'var(--vt-red)'
                  const rachaPct = data.totalWorked > 0 ? (data.racha / data.totalWorked * 100) : 0
                  return (
                    <tr key={name}>
                      <td style={{ fontWeight:700, textAlign:'center' }}>{medal}</td>
                      <td style={{ fontWeight:600 }}>{name}</td>
                      <td className="r" style={{ color:'#888' }}>{data.totalWorked}</td>
                      <td className="r vt-bold">{fi(data.agg.total)}</td>
                      <td className="r" style={{ color:cPP, fontWeight:700 }}>{fi(data.agg.promPax)}</td>
                      <td className="r" style={{ color:cBP }}>{data.agg.bebPax.toFixed(2)}</td>
                      <td className={`r ${ratioCBClass(data.agg.ratioCB)}`}>{data.agg.ratioCB.toFixed(2)}:1</td>
                      <td className="r" style={{ color: consistenciaColor(data.consistencia), fontWeight:600 }}>
                        {data.consistencia}%
                      </td>
                      <td className="r" style={{ color:trendCol, fontWeight:600 }}>
                        {data.tendencia >= 0 ? '▲ +' : '▼ '}{Math.abs(data.tendencia).toFixed(1)}%
                      </td>
                      <td className="r">
                        {data.racha > 0 ? (
                          <span style={{ color: rachaPct >= 50 ? 'var(--vt-green)' : 'var(--vt-gold-dark,#a07830)' }}>
                            🔥{data.racha}d
                          </span>
                        ) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="vt-tbl-footer">
                  <td colSpan={2}>GENERAL</td>
                  <td className="r" style={{ color:'#888' }}>{evalDates.length}</td>
                  <td className="r">{fi(genAgg.total + genAgg.cajTotal)}</td>
                  <td className="r vt-bold">{fi(genAgg.promPax)}</td>
                  <td className="r">{genAgg.bebPax.toFixed(2)}</td>
                  <td className={`r ${ratioCBClass(genAgg.ratioCB)}`}>{genAgg.ratioCB.toFixed(2)}:1</td>
                  <td colSpan={3}/>
                </tr>
              </tfoot>
            </table>
          </div>
          <div style={{ fontSize:'0.65rem', color:'#444', marginTop:'0.5rem' }}>
            Consist. = % días sobre el promedio general. Tendencia = últimos 7 días vs 7 anteriores. Racha = días consecutivos sobre meta.
          </div>
        </>
      )}
    </div>
  )
}

