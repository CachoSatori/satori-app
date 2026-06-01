import React, { useState, useMemo } from 'react'
import type { DiasMap, HistMap, Meta } from '../../shared/types/ventas'
import {
  getContabilidadDays, availableYears, yearlyTotals,
  fi, todayISO, daysInMonth, metaProgress,
} from './ventasUtils'

const MN_FULL = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio',
                 'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const QUARTERS: [number, number, number][] = [[1,2,3],[4,5,6],[7,8,9],[10,11,12]]

function varStr(pct: number | null, big = false): { text: string; color: string } {
  if (pct === null) return { text: '—', color: '#444' }
  const c = pct > 0 ? 'var(--vt-green)' : pct < 0 ? 'var(--vt-red)' : '#888'
  const t = `${pct >= 0 ? '▲ +' : '▼ '}${Math.abs(pct).toFixed(big ? 0 : 1)}%`
  return { text: t, color: c }
}

interface Props {
  dias:  DiasMap
  hist:  HistMap
  metas: Meta
}

export default function VentasAnalisis({ dias, hist, metas }: Props) {
  const years = useMemo(() => availableYears(dias, hist), [dias, hist])
  const [mode, setMode] = useState<'compare'|'year'|'proyeccion'>('compare')
  const [selYear, setSelYear] = useState(years[0] ?? new Date().getFullYear())

  const MONTHS = [1,2,3,4,5,6,7,8,9,10,11,12]

  const yearData = useMemo(() =>
    years.reduce((acc, y) => {
      acc[y] = yearlyTotals(y, dias, hist)
      return acc
    }, {} as Record<number, ReturnType<typeof yearlyTotals>>),
  [years, dias, hist])

  const monthData = useMemo(() =>
    years.reduce((acc, y) => {
      acc[y] = {}
      for (const m of MONTHS) {
        const days = getContabilidadDays(y, m, dias, hist)
        if (days.length) {
          acc[y][m] = {
            ventaNeta:  days.reduce((s, d) => s + d.ventaNeta, 0),
            ventaBruta: days.reduce((s, d) => s + d.ventaBruta, 0),
            iva:        days.reduce((s, d) => s + d.iva, 0),
            serv:       days.reduce((s, d) => s + d.serv, 0),
            pax:        days.reduce((s, d) => s + d.pax, 0),
            salon:      days.reduce((s, d) => s + d.salon, 0),
            delivery:   days.reduce((s, d) => s + d.delivery, 0),
            days:       days.length,
          }
        }
      }
      return acc
    }, {} as Record<number, Record<number, {
      ventaNeta: number; ventaBruta: number; iva: number; serv: number
      pax: number; salon: number; delivery: number; days: number
    }>>),
  [years, dias, hist])

  const mNames = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

  if (!years.length) {
    return (
      <div className="vt-empty">
        <div className="vt-empty-icon">分</div>
        <div className="vt-empty-title">Sin datos suficientes</div>
        <div className="vt-empty-sub">Cargá datos históricos para ver el análisis</div>
      </div>
    )
  }

  return (
    <div className="vt-section">
      {/* Mode selector */}
      <div className="vt-tab-group" style={{ marginBottom: '1.25rem' }}>
        <button className={`vt-tab-btn ${mode === 'compare' ? 'active' : ''}`}
          onClick={() => setMode('compare')}>Año vs Año</button>
        <button className={`vt-tab-btn ${mode === 'year' ? 'active' : ''}`}
          onClick={() => setMode('year')}>Detalle anual</button>
        <button className={`vt-tab-btn ${mode === 'proyeccion' ? 'active' : ''}`}
          onClick={() => setMode('proyeccion')}>Proyección</button>
      </div>

      {mode === 'compare' && (
        <>
          {/* Annual KPI cards */}
          <div className="vt-kpi-grid" style={{ gridTemplateColumns: `repeat(${Math.min(years.length, 4)}, 1fr)` }}>
            {years.map((y, i) => {
              const d    = yearData[y]
              const prev = years[i + 1] ? yearData[years[i + 1]] : null
              const vp   = prev?.ventaNeta ? ((d.ventaNeta - prev.ventaNeta) / prev.ventaNeta * 100) : null
              const vs   = varStr(vp, true)
              const promPAX = d.pax > 0 ? d.ventaNeta / d.pax : 0
              return (
                <div key={y} className="vt-kpi" style={{ borderLeft: '3px solid var(--vt-gold)' }}>
                  <div className="vt-kpi-label">{y} · {d.days} días</div>
                  <div className="vt-kpi-val">{fi(d.ventaNeta)}</div>
                  {vp !== null && (
                    <div className="vt-kpi-delta" style={{ color: vs.color }}>{vs.text} vs {years[i+1]}</div>
                  )}
                  <div className="vt-kpi-sub">{d.pax.toLocaleString('es-CR')} PAX · {fi(promPAX)}/PAX</div>
                </div>
              )
            })}
          </div>

          {/* Monthly comparison table */}
          <div className="vt-sl">Comparativo mensual</div>
          <div className="vt-tbl-wrap">
            <table className="vt-tbl">
              <thead>
                <tr>
                  <th>Mes</th>
                  {years.map(y => <th key={y} className="r">{y}</th>)}
                  {years.map((y, i) => i > 0 ? <th key={`v${y}`} className="r" style={{ color:'#555', fontSize:'0.65rem' }}>vs {years[i-1]}</th> : null)}
                </tr>
              </thead>
              <tbody>
                {MONTHS.map(m => {
                  const hasAny = years.some(y => monthData[y]?.[m])
                  if (!hasAny) return null
                  return (
                    <tr key={m}>
                      <td style={{ fontWeight: 600 }}>{MN_FULL[m]}</td>
                      {years.map(y => {
                        const v = monthData[y]?.[m]?.ventaNeta ?? 0
                        return <td key={y} className="r vt-bold">{v > 0 ? fi(v) : '—'}</td>
                      })}
                      {years.map((y, i) => {
                        if (i === 0) return null
                        const curr = monthData[years[i-1]]?.[m]?.ventaNeta ?? 0
                        const prev = monthData[y]?.[m]?.ventaNeta ?? 0
                        const vp   = prev > 0 ? (curr - prev) / prev * 100 : null
                        const vs   = varStr(vp)
                        return <td key={`v${y}`} className="r" style={{ color: vs.color, fontSize:'0.8rem' }}>{vs.text}</td>
                      })}
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="vt-tbl-footer">
                  <td>TOTAL</td>
                  {years.map(y => <td key={y} className="r">{fi(yearData[y].ventaNeta)}</td>)}
                  {years.map((y, i) => {
                    if (i === 0) return null
                    const curr = yearData[years[i-1]].ventaNeta
                    const prev = yearData[y].ventaNeta
                    const vp   = prev > 0 ? (curr - prev) / prev * 100 : null
                    const vs   = varStr(vp, true)
                    return <td key={`v${y}`} className="r" style={{ color: vs.color, fontWeight: 700 }}>{vs.text}</td>
                  })}
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Quarterly grid */}
          <div className="vt-sl">Por trimestre (Q1–Q4)</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'0.75rem', marginBottom:'1.5rem' }}>
            {QUARTERS.map((qMonths, qi) => (
              <div key={qi} style={{ background:'var(--vt-ink)', borderRadius:2, padding:'0.875rem' }}>
                <div style={{ fontSize:'0.65rem', letterSpacing:'0.15em', textTransform:'uppercase', color:'#555', marginBottom:'0.625rem', fontWeight:700 }}>
                  Q{qi+1} · {mNames[qMonths[0]-1]}–{mNames[qMonths[2]-1]}
                </div>
                {years.map((y, i) => {
                  const tot = qMonths.reduce((s, m) => s + (monthData[y]?.[m]?.ventaNeta ?? 0), 0)
                  const prev = i < years.length-1 ? qMonths.reduce((s, m) => s + (monthData[years[i+1]]?.[m]?.ventaNeta ?? 0), 0) : 0
                  const vp  = prev > 0 ? (tot - prev) / prev * 100 : null
                  const vs  = varStr(vp)
                  return (
                    <div key={y} style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:'0.4rem', paddingBottom:'0.4rem', borderBottom:'1px solid #111' }}>
                      <span style={{ fontSize:'0.78rem', color:'#666' }}>{y}</span>
                      <div style={{ textAlign:'right' }}>
                        <div style={{ fontSize:'0.85rem', fontWeight:700, color:'var(--vt-gold)' }}>{fi(tot)}</div>
                        {vp !== null && <div style={{ fontSize:'0.68rem', color:vs.color }}>{vs.text}</div>}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </>
      )}

      {mode === 'year' && (
        <>
          {/* Year selector */}
          <div className="vt-tab-group" style={{ marginBottom: '1rem' }}>
            {years.map(y => (
              <button key={y} className={`vt-tab-btn ${selYear === y ? 'active' : ''}`}
                onClick={() => setSelYear(y)}>{y}</button>
            ))}
          </div>

          {/* Annual KPIs */}
          {(() => {
            const d    = yearData[selYear]
            const prev = yearData[selYear - 1]
            const promPAX = d.pax > 0 ? d.ventaNeta / d.pax : 0
            function vpKPI(curr: number, p: number | undefined) {
              if (!p) return null
              const vp = (curr - p) / p * 100
              return { vp, color: vp >= 0 ? 'var(--vt-green)' : 'var(--vt-red)', text: `${vp >= 0 ? '▲' : '▼'} ${Math.abs(vp).toFixed(1)}%` }
            }
            return (
              <div className="vt-kpi-grid">
                {[
                  { label:`Venta Neta ${selYear}`, val:d.ventaNeta, pp:vpKPI(d.ventaNeta, prev?.ventaNeta), color:'var(--vt-gold)' },
                  { label:'Venta Bruta', val:d.ventaBruta, pp:vpKPI(d.ventaBruta, prev?.ventaBruta) },
                  { label:'PAX', val:d.pax, pp:vpKPI(d.pax, prev?.pax), fmt:(v:number)=>v.toLocaleString('es-CR') },
                  { label:'Prom/PAX', val:promPAX, pp:null },
                  { label:'Salón', val:d.salon, pp:vpKPI(d.salon, prev?.salon) },
                  { label:'Delivery', val:d.delivery, pp:vpKPI(d.delivery, prev?.delivery) },
                ].map(k => (
                  <div key={k.label} className="vt-kpi">
                    <div className="vt-kpi-label">{k.label}</div>
                    <div className="vt-kpi-val" style={{ color:k.color }}>{k.fmt ? k.fmt(k.val) : fi(k.val)}</div>
                    {k.pp && <div className="vt-kpi-delta" style={{ color:k.pp.color }}>{k.pp.text} vs {selYear-1}</div>}
                  </div>
                ))}
              </div>
            )
          })()}

          {/* Monthly detail table */}
          <div className="vt-sl">Detalle mensual {selYear}</div>
          <div className="vt-tbl-wrap">
            <table className="vt-tbl">
              <thead>
                <tr>
                  <th>Mes</th>
                  <th className="r">Venta Neta</th>
                  <th className="r">vs Mes Ant</th>
                  <th className="r">vs {selYear-1}</th>
                  <th className="r">Bruta</th>
                  <th className="r">IVA</th>
                  <th className="r">Servicio</th>
                  <th className="r">PAX</th>
                  <th className="r">Prom/PAX</th>
                  <th className="r">Margen%</th>
                  <th className="r">Margen ₡</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  let prevM: typeof monthData[number][number] | null = null
                  return MONTHS.map(m => {
                    const d = monthData[selYear]?.[m]
                    if (!d) { prevM = null; return null }
                    const prevY   = monthData[selYear - 1]?.[m]
                    const vaMA    = prevM?.ventaNeta  ? ((d.ventaNeta - prevM.ventaNeta) / prevM.ventaNeta * 100) : null
                    const vaYA    = prevY?.ventaNeta  ? ((d.ventaNeta - prevY.ventaNeta) / prevY.ventaNeta * 100) : null
                    const ym      = `${selYear}-${String(m).padStart(2,'0')}`
                    const mPct    = metas.margen?.[ym] ?? 0
                    const mCRC    = mPct > 0 ? d.ventaBruta * mPct / 100 : 0
                    const pp      = d.pax > 0 ? d.ventaNeta / d.pax : 0
                    const vMA     = varStr(vaMA)
                    const vYA     = varStr(vaYA)
                    prevM = d
                    return (
                      <tr key={m}>
                        <td style={{ fontWeight:600 }}>{MN_FULL[m]}</td>
                        <td className="r vt-bold">{fi(d.ventaNeta)}</td>
                        <td className="r" style={{ color:vMA.color, fontSize:'0.8rem' }}>{vMA.text}</td>
                        <td className="r" style={{ color:vYA.color, fontSize:'0.8rem' }}>{vYA.text}</td>
                        <td className="r" style={{ color:'#888', fontSize:'0.8rem' }}>{fi(d.ventaBruta)}</td>
                        <td className="r vt-muted" style={{ fontSize:'0.78rem' }}>{fi(d.iva)}</td>
                        <td className="r vt-muted" style={{ fontSize:'0.78rem' }}>{fi(d.serv)}</td>
                        <td className="r">{d.pax.toLocaleString('es-CR')}</td>
                        <td className="r">{fi(pp)}</td>
                        <td className="r" style={{ color:mPct>0?'var(--vt-gold-dark)':'var(--vt-muted)' }}>
                          {mPct>0 ? mPct.toFixed(1)+'%' : '—'}
                        </td>
                        <td className="r" style={{ color:mCRC>0?'var(--vt-gold-dark)':'var(--vt-muted)' }}>
                          {mCRC>0 ? fi(mCRC) : '—'}
                        </td>
                      </tr>
                    )
                  })
                })()}
              </tbody>
              <tfoot>
                <tr className="vt-tbl-footer">
                  <td>TOTAL {selYear}</td>
                  <td className="r">{fi(yearData[selYear].ventaNeta)}</td>
                  <td/><td/>
                  <td className="r" style={{ color:'#888' }}>{fi(yearData[selYear].ventaBruta)}</td>
                  <td className="r vt-muted" style={{ fontSize:'0.78rem' }}>{fi(MONTHS.reduce((s,m)=>s+(monthData[selYear]?.[m]?.iva??0),0))}</td>
                  <td className="r vt-muted" style={{ fontSize:'0.78rem' }}>{fi(MONTHS.reduce((s,m)=>s+(monthData[selYear]?.[m]?.serv??0),0))}</td>
                  <td className="r">{yearData[selYear].pax.toLocaleString('es-CR')}</td>
                  <td className="r">{fi(yearData[selYear].pax>0?yearData[selYear].ventaNeta/yearData[selYear].pax:0)}</td>
                  <td/><td/>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Quincenal table */}
          <div className="vt-sl">Quincenal {selYear}</div>
          <div className="vt-tbl-wrap">
            <table className="vt-tbl">
              <thead>
                <tr>
                  <th>Período</th>
                  <th className="r">Venta Neta</th>
                  <th className="r">vs Quinc. Ant</th>
                  <th className="r">vs {selYear-1}</th>
                  <th className="r">PAX</th>
                  <th className="r">Prom/PAX</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const allD   = [...new Set([...Object.keys(dias), ...Object.keys(hist)])].sort()
                  const rows: React.ReactElement[] = []
                  let prevQ: { ventaNeta: number; pax: number } | null = null
                  for (let m = 1; m <= 12; m++) {
                    const mm = String(m).padStart(2,'0')
                    for (let half = 1; half <= 2; half++) {
                      const days  = allD.filter(d => {
                        if (!d.startsWith(`${selYear}-${mm}`)) return false
                        const day = Number(d.slice(8)); return half === 1 ? day <= 15 : day > 15
                      })
                      if (!days.length) continue
                      const items = getContabilidadDays(selYear, m, dias, hist).filter(d => {
                        const day = Number(d.fecha.slice(8)); return half === 1 ? day <= 15 : day > 15
                      })
                      if (!items.length) continue
                      const vn  = items.reduce((s, d) => s + d.ventaNeta, 0)
                      const pax = items.reduce((s, d) => s + d.pax, 0)
                      if (!vn) continue

                      // vs same half prev year
                      const prevYDays = getContabilidadDays(selYear - 1, m, dias, hist).filter(d => {
                        const day = Number(d.fecha.slice(8)); return half === 1 ? day <= 15 : day > 15
                      })
                      const prevYVN = prevYDays.reduce((s, d) => s + d.ventaNeta, 0)

                      const vQA = prevQ?.ventaNeta ? (vn - prevQ.ventaNeta) / prevQ.ventaNeta * 100 : null
                      const vYA = prevYVN > 0 ? (vn - prevYVN) / prevYVN * 100 : null
                      const vsQ = varStr(vQA); const vsY = varStr(vYA)
                      prevQ = { ventaNeta: vn, pax }

                      rows.push(
                        <tr key={`${m}-${half}`}>
                          <td style={{ fontWeight:600, fontSize:'0.82rem' }}>
                            {mNames[m-1]} {half===1?'1–15':'16–fin'}
                          </td>
                          <td className="r vt-bold">{fi(vn)}</td>
                          <td className="r" style={{ color:vsQ.color, fontSize:'0.8rem' }}>{vsQ.text}</td>
                          <td className="r" style={{ color:vsY.color, fontSize:'0.8rem' }}>{vsY.text}</td>
                          <td className="r">{pax.toLocaleString('es-CR')}</td>
                          <td className="r">{fi(pax>0?vn/pax:0)}</td>
                        </tr>
                      )
                    }
                  }
                  return rows
                })()}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── PROYECCIÓN ANUAL ─────────────────────────────── */}
      {mode === 'proyeccion' && (() => {
        const curYear    = new Date().getFullYear()
        const today      = todayISO()
        const curMonth   = today.slice(0, 7)
        const dayOfYear  = Math.ceil((new Date().getTime() - new Date(`${curYear}-01-01`).getTime()) / 86400000)
        const daysInYear = (curYear % 4 === 0 && (curYear % 100 !== 0 || curYear % 400 === 0)) ? 366 : 365
        const ytdDays    = getContabilidadDays(curYear, null, dias, hist)
        const ytdVentas  = ytdDays.reduce((s, d) => s + d.ventaNeta, 0)
        const avgPerDay  = ytdDays.length > 0 ? ytdVentas / ytdDays.length : 0
        const projection = avgPerDay * daysInYear
        const pctYear    = (dayOfYear / daysInYear) * 100

        // Monthly breakdown for current year with projections
        const monthlyData = [1,2,3,4,5,6,7,8,9,10,11,12].map(m => {
          const ym     = `${curYear}-${String(m).padStart(2,'0')}`
          const isPast = ym < curMonth
          const isCur  = ym === curMonth
          const days   = getContabilidadDays(curYear, m, dias, hist)
          const actual = days.reduce((s, d) => s + d.ventaNeta, 0)
          const dIM    = daysInMonth(ym)
          const daysPassed = isPast ? dIM : isCur ? Math.min(new Date().getDate(), days.length) : 0
          const projected  = isPast || isCur
            ? (daysPassed > 0 ? (actual / daysPassed) * dIM : 0)
            : avgPerDay * dIM
          const metaAmt = metas.restaurante?.[ym] ?? 0
          const prog    = metaProgress(metas, dias, hist, ym)
          return { m, ym, actual, projected, metaAmt, prog, isPast, isCur }
        })

        const projectedTotal = monthlyData.reduce((s, m) => s + (m.actual || m.projected), 0)
        const metaYear       = Object.entries(metas.restaurante ?? {})
          .filter(([ym]) => ym.startsWith(String(curYear)))
          .reduce((s, [, v]) => s + v, 0)

        const mNames = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

        return (
          <div>
            {/* Main projection card */}
            <div style={{ background: 'var(--vt-ink)', borderRadius: 3, padding: '1.25rem', marginBottom: '1.5rem', color: 'var(--vt-paper)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '1rem' }}>
                {[
                  { label: `YTD ${curYear} (${ytdDays.length} días)`, val: fi(ytdVentas), color: 'var(--vt-gold)' },
                  { label: 'Proyección año completo', val: fi(projection), color: projectedTotal >= metaYear ? 'var(--vt-green)' : '#f08070' },
                  { label: 'Promedio por día', val: fi(avgPerDay), color: '' },
                  { label: 'Mes en curso — meta', val: fi(metaYear), color: 'var(--vt-muted)' },
                ].map(k => (
                  <div key={k.label}>
                    <div style={{ fontSize: '0.62rem', color: '#555', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '0.3rem' }}>{k.label}</div>
                    <div style={{ fontFamily: "'Syne',sans-serif", fontSize: '1.1rem', fontWeight: 800, color: k.color || 'var(--vt-paper)' }}>{k.val}</div>
                  </div>
                ))}
              </div>
              {/* Progress bar: % of year elapsed */}
              <div style={{ marginTop: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: '#555', marginBottom: '0.3rem' }}>
                  <span>Año transcurrido: {pctYear.toFixed(0)}%</span>
                  <span>Día {dayOfYear} de {daysInYear}</span>
                </div>
                <div style={{ height: 6, background: '#2a2a2a', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pctYear}%`, background: 'var(--vt-gold)', borderRadius: 3 }} />
                </div>
              </div>
            </div>

            {/* Monthly bar chart */}
            <div className="vt-sl">Ventas reales vs proyección — {curYear}</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.4rem', height: 140, marginBottom: '0.5rem', padding: '0 0.25rem' }}>
              {monthlyData.map(d => {
                const maxVal = Math.max(...monthlyData.map(x => Math.max(x.actual, x.projected, x.metaAmt)))
                const actH   = maxVal > 0 ? Math.round((d.actual / maxVal) * 100) : 0
                const projH  = maxVal > 0 ? Math.round(((d.projected || 0) / maxVal) * 100) : 0
                const metaH  = maxVal > 0 && d.metaAmt > 0 ? Math.round((d.metaAmt / maxVal) * 100) : 0
                return (
                  <div key={d.m} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                    {d.actual > 0 && (
                      <div style={{ width: '100%', height: `${actH}%`, background: d.isCur ? 'var(--vt-gold)' : 'var(--vt-green)', borderRadius: 2, opacity: d.isPast ? 1 : 0.6 }} />
                    )}
                    {!d.actual && d.projected > 0 && (
                      <div style={{ width: '100%', height: `${projH}%`, background: '#333', borderRadius: 2, borderTop: '2px dashed var(--vt-muted)' }} />
                    )}
                    {metaH > 0 && (
                      <div style={{ position: 'relative', width: '100%', height: 0 }}>
                        <div style={{ position: 'absolute', bottom: 0, width: '100%', borderBottom: '1px solid var(--vt-red)', opacity: 0.6 }} />
                      </div>
                    )}
                    <div style={{ fontSize: '0.55rem', color: d.isCur ? 'var(--vt-gold)' : '#555', fontWeight: d.isCur ? 700 : 400 }}>
                      {mNames[d.m - 1]}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Monthly table */}
            <div className="vt-tbl-wrap">
              <table className="vt-tbl">
                <thead>
                  <tr>
                    <th>Mes</th>
                    <th className="r">Real</th>
                    <th className="r">Proyectado</th>
                    <th className="r">Meta</th>
                    <th className="r">vs Meta</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyData.map(d => (
                    <tr key={d.m} style={{ fontWeight: d.isCur ? 700 : 400 }}>
                      <td style={{ color: d.isCur ? 'var(--vt-gold-dark,#a07830)' : undefined }}>
                        {mNames[d.m - 1]} {d.isCur ? '← hoy' : ''}
                      </td>
                      <td className="r vt-bold">{d.actual > 0 ? fi(d.actual) : '—'}</td>
                      <td className="r vt-muted" style={{ fontStyle: !d.isPast && !d.isCur ? 'italic' : undefined }}>
                        {fi(d.projected || d.actual)}
                      </td>
                      <td className="r vt-muted">{d.metaAmt > 0 ? fi(d.metaAmt) : '—'}</td>
                      <td className="r" style={{ color: d.prog ? (d.prog.onTrack ? 'var(--vt-green)' : 'var(--vt-red)') : undefined }}>
                        {d.prog ? d.prog.pct.toFixed(0) + '%' : '—'}
                      </td>
                    </tr>
                  ))}
                  <tr className="vt-tbl-footer" style={{ fontWeight: 700 }}>
                    <td>PROYECCIÓN TOTAL</td>
                    <td className="r">{fi(ytdVentas)}</td>
                    <td className="r" style={{ color: projectedTotal >= metaYear ? 'var(--vt-green)' : 'var(--vt-red)' }}>{fi(projectedTotal)}</td>
                    <td className="r">{metaYear > 0 ? fi(metaYear) : '—'}</td>
                    <td className="r">{metaYear > 0 ? (projectedTotal / metaYear * 100).toFixed(0) + '%' : '—'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
