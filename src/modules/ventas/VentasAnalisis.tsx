import { useState, useMemo } from 'react'
import type { DiasMap, HistMap, Meta } from '../../shared/types/ventas'
import {
  getContabilidadDays, availableYears, yearlyTotals,
  fi,
} from './ventasUtils'

interface Props {
  dias:  DiasMap
  hist:  HistMap
  metas: Meta
}

export default function VentasAnalisis({ dias, hist, metas }: Props) {
  const years = useMemo(() => availableYears(dias, hist), [dias, hist])
  const [mode, setMode] = useState<'compare'|'year'>('compare')
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
                      <td>{mNames[m-1]}</td>
                      {vals.map((v, i) => (
                        <td key={i} className="r">{v > 0 ? fi(v) : '—'}</td>
                      ))}
                      {years.length >= 2 && (
                        <td className="r" style={{ color: varPct && varPct >= 0 ? 'var(--vt-green)' : 'var(--vt-red)' }}>
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
                      <td>{mNames[m-1]}</td>
                      <td className="r vt-bold">{fi(d.ventaNeta)}</td>
                      <td className="r" style={{ color: varAnt !== null ? (varAnt >= 0 ? 'var(--vt-green)' : 'var(--vt-red)') : '#888' }}>
                        {varAnt !== null ? (varAnt >= 0 ? '+' : '') + varAnt.toFixed(1) + '%' : '—'}
                      </td>
                      <td className="r">{fi(d.ventaBruta)}</td>
                      <td className="r" style={{ color: '#888', fontSize: '0.75rem' }}>{fi(d.iva)}</td>
                      <td className="r" style={{ color: '#888', fontSize: '0.75rem' }}>{fi(d.serv)}</td>
                      <td className="r">{d.pax}</td>
                      <td className="r" style={{ color: margenPct > 0 ? 'var(--vt-gold)' : '#555' }}>
                        {margenPct > 0 ? margenPct.toFixed(1) + '%' : '—'}
                      </td>
                      <td className="r" style={{ color: 'var(--vt-gold)' }}>
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
    </div>
  )
}
