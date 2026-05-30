import { useState, useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { todayCR } from '../../shared/utils'

function nDaysAgo(n: number): string {
  const d = new Date(todayCR() + 'T12:00:00'); d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}
import type { DiasMap, HistMap, ProductMap } from '../../shared/types/ventas'
import {
  aggGeneral, aggSalonero,
  datesInRange, allDates, allSaloneros,
  fi, fmtDate, topProds,
} from './ventasUtils'

interface Props {
  dias:  DiasMap
  hist:  HistMap
  pm:    ProductMap
}




export default function VentasHistorico({ dias, hist, pm }: Props) {
  const [from, setFrom] = useState(nDaysAgo(30))
  const [to,   setTo]   = useState(todayCR())
  const [preset, setPreset] = useState(2)

  const dates  = useMemo(() => allDates(dias, hist), [dias, hist])
  const sals   = useMemo(() => allSaloneros(dias), [dias])

  const PRESETS = [
    { label: '7 días',  f: () => [nDaysAgo(7),  todayCR()] },
    { label: '15 días', f: () => [nDaysAgo(15), todayCR()] },
    { label: '30 días', f: () => [nDaysAgo(30), todayCR()] },
    { label: '3 meses', f: () => [nDaysAgo(90), todayCR()] },
    { label: 'Todo',    f: () => [dates[0] ?? '', dates[dates.length-1] ?? ''] },
  ]

  const handlePreset = (i: number) => {
    const [f, t] = PRESETS[i].f()
    setFrom(f); setTo(t); setPreset(i)
  }

  const rangeDates = useMemo(() => datesInRange(dates, from, to), [dates, from, to])

  const gen = useMemo(() => aggGeneral(rangeDates, dias, pm), [rangeDates, dias, pm])
  const topP = useMemo(() => topProds(gen.prods, 'monto', 10, undefined, pm), [gen.prods, pm])

  // Chart data: daily promPax per salonero + general
  const chartData = useMemo(() => {
    return rangeDates.map(date => {
      if (!dias[date]) return null
      const genDay = aggGeneral([date], dias, pm)
      const point: Record<string, number | string> = { date, General: Math.round(genDay.promPax) }
      sals.forEach(n => {
        const s = aggSalonero(n, [date], dias, pm)
        if (s.days > 0) point[n] = Math.round(s.promPax)
      })
      return point
    }).filter(Boolean) as Record<string, number | string>[]
  }, [rangeDates, dias, pm, sals])

  const COLORS = ['#c8a96e','#7ec8a0','#7ab4d4','#c87ea0','#a0c87e','#c8a07e','#7ea0c8','#c87e7e']

  const [visibleSals, setVisibleSals] = useState<Record<string, boolean>>({ General: true })

  const toggleSal = (name: string) => {
    setVisibleSals(prev => ({ ...prev, [name]: !prev[name] }))
  }

  return (
    <div className="vt-section">
      {/* Range controls */}
      <div className="vt-range-bar">
        {PRESETS.map((p, i) => (
          <button key={i} className={`vt-range-btn ${preset === i ? 'active' : ''}`}
            onClick={() => handlePreset(i)}>
            {p.label}
          </button>
        ))}
        <input className="vt-date-input" type="date" value={from} onChange={e => { setFrom(e.target.value); setPreset(-1) }} />
        <span>→</span>
        <input className="vt-date-input" type="date" value={to} onChange={e => { setTo(e.target.value); setPreset(-1) }} />
        <span className="vt-range-label">{rangeDates.length} días</span>
      </div>

      {/* KPIs */}
      <div className="vt-kpi-grid">
        <div className="vt-kpi red">
          <div className="vt-kpi-label">Venta Neta</div>
          <div className="vt-kpi-val">{fi(gen.total + gen.cajTotal)}</div>
        </div>
        <div className="vt-kpi">
          <div className="vt-kpi-label">Salón</div>
          <div className="vt-kpi-val">{fi(gen.total)}</div>
        </div>
        <div className="vt-kpi">
          <div className="vt-kpi-label">PAX</div>
          <div className="vt-kpi-val">{gen.pax.toLocaleString('es-CR')}</div>
        </div>
        <div className="vt-kpi green">
          <div className="vt-kpi-label">Prom/PAX</div>
          <div className="vt-kpi-val">{fi(gen.promPax)}</div>
        </div>
        <div className="vt-kpi">
          <div className="vt-kpi-label">Beb/PAX</div>
          <div className="vt-kpi-val">{gen.bebPax.toFixed(2)}</div>
        </div>
        <div className="vt-kpi">
          <div className="vt-kpi-label">Ratio C/B</div>
          <div className="vt-kpi-val">{gen.ratioCB.toFixed(2)}:1</div>
        </div>
      </div>

      {/* Prom/PAX chart */}
      {chartData.length > 1 && (
        <>
          <div className="vt-sl">Prom/PAX — evolución</div>
          <div className="vt-chart-legend">
            {['General', ...sals].map((n, i) => (
              <button key={n}
                className={`vt-legend-btn ${visibleSals[n] !== false ? 'active' : ''}`}
                style={{ borderColor: COLORS[i % COLORS.length] }}
                onClick={() => toggleSal(n)}>
                <span style={{ color: COLORS[i % COLORS.length] }}>●</span> {n}
              </button>
            ))}
          </div>
          <div style={{ height: 280, marginBottom: '1.5rem' }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#888' }}
                  tickFormatter={d => d.slice(5)} />
                <YAxis tick={{ fontSize: 10, fill: '#888' }}
                  tickFormatter={v => `₡${Math.round(v/1000)}k`} />
                <Tooltip
                  formatter={(value: unknown) => typeof value === 'number' ? fi(value) : String(value)}
                  labelFormatter={d => fmtDate(String(d))}
                  contentStyle={{ background: '#111', border: '1px solid #333', fontSize: '0.75rem' }}
                  labelStyle={{ color: '#c8a96e' }} />
                <Legend wrapperStyle={{ display: 'none' }} />
                {['General', ...sals].map((n, i) =>
                  visibleSals[n] !== false ? (
                    <Line key={n} type="monotone" dataKey={n}
                      stroke={COLORS[i % COLORS.length]}
                      strokeWidth={n === 'General' ? 2.5 : 1.5}
                      strokeDasharray={n === 'General' ? undefined : '4 2'}
                      dot={false} connectNulls />
                  ) : null
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {/* Top products */}
      <div className="vt-sl">Top productos del período</div>
      <div className="vt-prod-list">
        {topP.map((p, i) => (
          <div key={p.nombre} className="vt-prod-row">
            <div className="vt-prod-rank">{i + 1}</div>
            <div className="vt-prod-name">
              {p.nombre}
              {pm[p.nombre] && <span className={`vt-prod-tipo ${pm[p.nombre].tipo}`}>{pm[p.nombre].tipo}</span>}
            </div>
            <div className="vt-prod-stats">
              <span>{p.q} uds</span>
              <span>{fi(p.m)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
