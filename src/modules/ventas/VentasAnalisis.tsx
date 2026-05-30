import { useState, useMemo } from 'react'
import type { DiasMap, HistMap, Meta } from '../../shared/types/ventas'
import {
  getContabilidadDays, availableYears, yearlyTotals,
  fi, todayISO, daysInMonth, metaProgress,
} from './ventasUtils'

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
          <div className="vt-kpi-grid" style={{ gridTemplateColumns: `repeat(${years.length}, 1fr)` }}>
            {years.map((y, i) => {
              const d = yearData[y]
              const prev = years[i + 1] ? yearData[years[i + 1]] : null
              const varPct = prev?.ventaNeta ? ((d.ventaNeta - prev.ventaNeta) / prev.ventaNeta * 100) : null
              return (
                <div key={y} className="vt-kpi red">
                  <div className="vt-kpi-label">{y}</div>
                  <div className="vt-kpi-val">{fi(d.ventaNeta)}</div>
                  {varPct !== null && (
                    <div className="vt-kpi-delta" style={{ color: varPct >= 0 ? 'var(--vt-green)' : 'var(--vt-red)' }}>
                      {varPct >= 0 ? '▲' : '▼'} {Math.abs(varPct).toFixed(1)}% vs {years[i+1]}
                    </div>
                  )}
                  <div className="vt-kpi-sub">{d.days} días</div>
                </div>
              )
            })}
          </div>

          {/* Monthly comparison table */}
          <div className="vt-sl">Comparación mensual</div>
          <div className="vt-tbl-wrap">
            <table className="vt-tbl">
              <thead>
                <tr>
                  <th>Mes</th>
                  {years.map(y => <th key={y} className="r">{y}</th>)}
                  {years.length >= 2 && <th className="r">Var %</th>}
                </tr>
              </thead>
              <tbody>
                {MONTHS.map(m => {
                  const hasAny = years.some(y => monthData[y]?.[m])
                  if (!hasAny) return null
                  const vals = years.map(y => monthData[y]?.[m]?.ventaNeta ?? 0)
                  const varPct = vals[1] ? ((vals[0] - vals[1]) / vals[1] * 100) : null
                  return (
                    <tr key={m}>
                      <td style={{ fontWeight: 600 }}>{mNames[m-1]}</td>
                      {vals.map((v, i) => (
                        <td key={i} className="r vt-bold">{v > 0 ? fi(v) : '—'}</td>
                      ))}
                      {years.length >= 2 && (
                        <td className="r" style={{ color: varPct !== null ? (varPct >= 0 ? 'var(--vt-green)' : 'var(--vt-red)') : 'var(--vt-muted)' }}>
                          {varPct !== null ? (varPct >= 0 ? '+' : '') + varPct.toFixed(1) + '%' : '—'}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
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
            const d = yearData[selYear]
            const prev = yearData[selYear - 1]
            return (
              <div className="vt-kpi-grid">
                <div className="vt-kpi red">
                  <div className="vt-kpi-label">Venta Neta {selYear}</div>
                  <div className="vt-kpi-val">{fi(d.ventaNeta)}</div>
                  {prev?.ventaNeta > 0 && (
                    <div className="vt-kpi-delta" style={{ color: d.ventaNeta >= prev.ventaNeta ? 'var(--vt-green)' : 'var(--vt-red)' }}>
                      {d.ventaNeta >= prev.ventaNeta ? '▲' : '▼'} {Math.abs((d.ventaNeta - prev.ventaNeta) / prev.ventaNeta * 100).toFixed(1)}%
                    </div>
                  )}
                </div>
                <div className="vt-kpi">
                  <div className="vt-kpi-label">Venta Bruta</div>
                  <div className="vt-kpi-val">{fi(d.ventaBruta)}</div>
                </div>
                <div className="vt-kpi">
                  <div className="vt-kpi-label">PAX</div>
                  <div className="vt-kpi-val">{d.pax.toLocaleString('es-CR')}</div>
                </div>
                <div className="vt-kpi green">
                  <div className="vt-kpi-label">Días</div>
                  <div className="vt-kpi-val">{d.days}</div>
                </div>
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
                  <th className="r">vs Ant. Año</th>
                  <th className="r">Bruta</th>
                  <th className="r">IVA</th>
                  <th className="r">Servicio</th>
                  <th className="r">PAX</th>
                  <th className="r">Margen%</th>
                  <th className="r">Margen ₡</th>
                </tr>
              </thead>
              <tbody>
                {MONTHS.map(m => {
                  const d = monthData[selYear]?.[m]
                  if (!d) return null
                  const prev = monthData[selYear - 1]?.[m]
                  const varAnt = prev?.ventaNeta ? ((d.ventaNeta - prev.ventaNeta) / prev.ventaNeta * 100) : null
                  const ym = `${selYear}-${String(m).padStart(2,'0')}`
                  const margenPct = metas.margen?.[ym] ?? 0
                  const margenCRC = margenPct > 0 ? d.ventaBruta * margenPct / 100 : 0
                  return (
                    <tr key={m}>
                      <td style={{ fontWeight: 600 }}>{mNames[m-1]}</td>
                      <td className="r vt-bold">{fi(d.ventaNeta)}</td>
                      <td className="r" style={{ color: varAnt !== null ? (varAnt >= 0 ? 'var(--vt-green)' : 'var(--vt-red)') : 'var(--vt-muted)' }}>
                        {varAnt !== null ? (varAnt >= 0 ? '+' : '') + varAnt.toFixed(1) + '%' : '—'}
                      </td>
                      <td className="r">{fi(d.ventaBruta)}</td>
                      <td className="r vt-muted" style={{ fontSize: '0.8rem' }}>{fi(d.iva)}</td>
                      <td className="r vt-muted" style={{ fontSize: '0.8rem' }}>{fi(d.serv)}</td>
                      <td className="r">{d.pax}</td>
                      <td className="r" style={{ color: margenPct > 0 ? 'var(--vt-gold-dark)' : 'var(--vt-muted)' }}>
                        {margenPct > 0 ? margenPct.toFixed(1) + '%' : '—'}
                      </td>
                      <td className="r" style={{ color: margenCRC > 0 ? 'var(--vt-gold-dark)' : 'var(--vt-muted)' }}>
                        {margenCRC > 0 ? fi(margenCRC) : '—'}
                      </td>
                    </tr>
                  )
                })}
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
