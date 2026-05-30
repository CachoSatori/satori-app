import { useState, useMemo } from 'react'
import type { DiasMap, ProductMap, Meta } from '../../shared/types/ventas'
import {
  aggGeneral, aggSalonero, aggCajero, getDayStats,
  fi, fmtDate, metaColor, getMeta,
  topProds, metaProgress, ratioCBClass,
  allSaloneros, esCajero,
} from './ventasUtils'

interface Props {
  dias:  DiasMap
  pm:    ProductMap
  metas: Meta
}

export default function VentasHoy({ dias, pm, metas }: Props) {
  const [prodView, setProdView]   = useState<'general'|'comidas'|'bebidas'>('general')
  const [prodBy, setProdBy]       = useState<'monto'|'unidades'>('monto')
  const [salFiltro, setSalFiltro] = useState<string>('')
  const [sortBy, setSortBy]       = useState<'promPax'|'total'|'pax'>('promPax')

  // Date picker — defaults to last loaded date
  const allDates = useMemo(() => Object.keys(dias).sort(), [dias])
  const lastDate = allDates[allDates.length - 1] ?? null
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const activeDate = selectedDate ?? lastDate

  const dia  = activeDate ? dias[activeDate] : null
  const sals = useMemo(() => dia ? allSaloneros({ [activeDate!]: dia }) : [], [dia, activeDate])
  const cajs = useMemo(() => dia
    ? Object.keys(dia.saloneros).filter(n => esCajero(n))
    : [], [dia])

  const gen = useMemo(() =>
    activeDate ? aggGeneral([activeDate], dias, pm) : null,
  [activeDate, dias, pm])

  const salAggs = useMemo(() =>
    sals.map(n => aggSalonero(n, activeDate ? [activeDate] : [], dias, pm)),
  [sals, activeDate, dias, pm])

  const cajAggs = useMemo(() =>
    cajs.map(n => aggCajero(n, activeDate ? [activeDate] : [], dias)),
  [cajs, activeDate, dias])

  const sorted = useMemo(() =>
    [...salAggs].sort((a, b) => {
      if (sortBy === 'promPax') return b.promPax - a.promPax
      if (sortBy === 'total')   return b.total - a.total
      return b.pax - a.pax
    }),
  [salAggs, sortBy])

  const metaMonth = activeDate?.slice(0, 7) ?? ''
  const progress  = metaProgress(metas, dias, {}, metaMonth)

  if (!allDates.length) {
    return (
      <div className="vt-empty">
        <div className="vt-empty-icon">売</div>
        <div className="vt-empty-title">Sin datos cargados</div>
        <div className="vt-empty-sub">Cargá un archivo XLS para empezar</div>
      </div>
    )
  }

  if (!activeDate || !dia || !gen) {
    return (
      <div className="vt-empty">
        <div className="vt-empty-icon">日</div>
        <div className="vt-empty-title">Sin datos para esa fecha</div>
        <div className="vt-empty-sub">Elegí otra fecha o cargá el archivo correspondiente</div>
      </div>
    )
  }

  const stats      = getDayStats(dia)
  const hasCajeros = cajAggs.length > 0

  // Top products for this day
  const allProds = salFiltro
    ? aggSalonero(salFiltro, [activeDate], dias, pm).prods
    : gen.prods
  const prodsToShow = topProds(
    allProds,
    prodBy,
    10,
    prodView === 'general' ? undefined : prodView === 'comidas' ? ['comida'] : ['bebida'],
    pm,
  )

  return (
    <div className="vt-section">

      {/* Header + date picker */}
      <div className="vt-hoy-header">
        <div>
          <div className="vt-hoy-fecha">{fmtDate(activeDate)}</div>
          <div className="vt-hoy-sub">
            {activeDate === lastDate ? 'Último día cargado' : 'Día seleccionado'}
          </div>
        </div>
        <div className="vt-hoy-nav">
          {/* Previous day */}
          <button className="vt-day-nav-btn"
            disabled={allDates.indexOf(activeDate) <= 0}
            onClick={() => { const i = allDates.indexOf(activeDate); if (i > 0) setSelectedDate(allDates[i-1]) }}>
            ‹
          </button>
          <input
            type="date"
            className="vt-date-input"
            value={activeDate}
            min={allDates[0]}
            max={allDates[allDates.length - 1]}
            onChange={e => {
              const d = e.target.value
              if (dias[d]) setSelectedDate(d)
            }}
          />
          {/* Next day */}
          <button className="vt-day-nav-btn"
            disabled={allDates.indexOf(activeDate) >= allDates.length - 1}
            onClick={() => { const i = allDates.indexOf(activeDate); if (i < allDates.length-1) setSelectedDate(allDates[i+1]) }}>
            ›
          </button>
          {selectedDate && selectedDate !== lastDate && (
            <button className="vt-range-btn" onClick={() => setSelectedDate(null)}
              style={{ fontSize: '0.68rem' }}>
              Hoy
            </button>
          )}
        </div>
      </div>

      {/* Meta progress */}
      {progress && (
        <div className="vt-meta-bar">
          <div className="vt-meta-bar-top">
            <span>Meta {metaMonth} — {fi(progress.meta)}</span>
            <span style={{ color: progress.onTrack ? 'var(--vt-green)' : 'var(--vt-red)' }}>
              {progress.pct.toFixed(1)}% completado
            </span>
          </div>
          <div className="vt-progress-track">
            <div className="vt-progress-fill" style={{
              width: `${Math.min(progress.pct, 100)}%`,
              background: progress.onTrack ? 'var(--vt-green)' : 'var(--vt-red)',
            }} />
          </div>
          <div className="vt-meta-bar-bottom">
            <span>Proyección: <strong style={{ color: progress.onTrack ? 'var(--vt-green)' : 'var(--vt-red)' }}>{fi(progress.projection)}</strong></span>
            <span>Esfuerzo diario restante: <strong>{fi(progress.effort)}</strong></span>
          </div>
        </div>
      )}

      {/* Restaurant total KPIs (with cajeros) */}
      {hasCajeros && (
        <>
          <div className="vt-sl">Restaurante</div>
          <div className="vt-kpi-grid">
            <div className="vt-kpi red">
              <div className="vt-kpi-label">Venta Total Restaurante</div>
              <div className="vt-kpi-val">{fi(stats.ventaNeta)}</div>
            </div>
            <div className="vt-kpi">
              <div className="vt-kpi-label">Salón</div>
              <div className="vt-kpi-val">{fi(gen.total + gen.cajSalon)}</div>
              <div className="vt-kpi-sub">{gen.totalRest > 0 ? ((gen.total + gen.cajSalon) / gen.totalRest * 100).toFixed(1) : 0}%</div>
            </div>
            <div className="vt-kpi blue">
              <div className="vt-kpi-label">Delivery</div>
              <div className="vt-kpi-val">{fi(gen.cajDelivery)}</div>
              <div className="vt-kpi-sub">{gen.totalRest > 0 ? (gen.cajDelivery / gen.totalRest * 100).toFixed(1) : 0}%</div>
            </div>
            {cajAggs.map(c => (
              <div key={c.nombre} className="vt-kpi">
                <div className="vt-kpi-label">{c.nombre}</div>
                <div className="vt-kpi-val" style={{ fontSize: '0.9rem' }}>{fi(c.total)}</div>
                <div className="vt-kpi-sub">
                  S: {fi(c.salon)} · D: {fi(c.delivery)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Saloneros KPIs */}
      <div className="vt-sl">Saloneros</div>
      <div className="vt-kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        <div className="vt-kpi">
          <div className="vt-kpi-label">Ventas Salón</div>
          <div className="vt-kpi-val">{fi(gen.total)}</div>
        </div>
        <div className="vt-kpi">
          <div className="vt-kpi-label">PAX Ticket</div>
          <div className="vt-kpi-val">{gen.pax}</div>
        </div>
        <div className="vt-kpi" style={{ borderLeftColor: metaColor(gen.promPax, getMeta(metas, '', 'promPax')) || 'var(--vt-gold)' }}>
          <div className="vt-kpi-label">Prom/PAX</div>
          <div className="vt-kpi-val">{fi(gen.promPax)}</div>
        </div>
        <div className="vt-kpi">
          <div className="vt-kpi-label">Bebidas/PAX</div>
          <div className="vt-kpi-val" style={{ color: metaColor(gen.bebPax, getMeta(metas,'','bebPax')) }}>
            {gen.bebPax.toFixed(2)}
          </div>
        </div>
        <div className="vt-kpi">
          <div className="vt-kpi-label">Ratio C/B (₡)</div>
          <div className={`vt-kpi-val ${ratioCBClass(gen.ratioCB)}`}>{gen.ratioCB.toFixed(2)}:1</div>
        </div>
        <div className="vt-kpi">
          <div className="vt-kpi-label">Ratio C/B (uds)</div>
          <div className="vt-kpi-val">{gen.ratioU.toFixed(2)}:1</div>
        </div>
      </div>

      {/* Ranking */}
      <div className="vt-sl" style={{ marginTop: '1.5rem' }}>
        Ranking del día
        <div className="vt-sort-tabs" style={{ marginLeft: '1rem' }}>
          {(['promPax','total','pax'] as const).map(k => (
            <button key={k} className={`vt-sort-tab ${sortBy === k ? 'active' : ''}`}
              onClick={() => setSortBy(k)}>
              {k === 'promPax' ? 'Prom/PAX' : k === 'total' ? 'Ventas' : 'PAX'}
            </button>
          ))}
        </div>
      </div>
      <div className="vt-tbl-wrap">
        <table className="vt-tbl">
          <thead>
            <tr>
              <th>#</th>
              <th>Salonero</th>
              <th className="r">PAX</th>
              <th className="r">Ventas</th>
              <th className="r">Prom/PAX</th>
              <th className="r">Beb/PAX</th>
              <th className="r">Ratio C/B</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s, i) => {
              const metaPP = getMeta(metas, s.nombre, 'promPax')
              const metaBP = getMeta(metas, s.nombre, 'bebPax')
              return (
                <tr key={s.nombre} className={i === 0 ? 'tr-best' : ''}>
                  <td className="vt-muted" style={{ fontWeight: 700 }}>{i + 1}</td>
                  <td style={{ fontWeight: 600 }}>{s.nombre}</td>
                  <td className="r">{s.pax}</td>
                  <td className="r" style={{ color: metaColor(s.total, getMeta(metas,s.nombre,'ventas')) }}>
                    {fi(s.total)}
                  </td>
                  <td className="r" style={{ color: metaColor(s.promPax, metaPP) }}>
                    {fi(s.promPax)}
                  </td>
                  <td className="r" style={{ color: metaColor(s.bebPax, metaBP) }}>
                    {s.bebPax.toFixed(2)}
                  </td>
                  <td className={`r ${ratioCBClass(s.ratioCB)}`}>
                    {s.ratioCB.toFixed(2)}:1
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Top productos */}
      <div className="vt-sl" style={{ marginTop: '1.5rem' }}>Top Productos</div>
      <div className="vt-prod-controls">
        <div className="vt-tab-group">
          {(['general','comidas','bebidas'] as const).map(v => (
            <button key={v} className={`vt-tab-btn ${prodView === v ? 'active' : ''}`}
              onClick={() => setProdView(v)}>
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
        <div className="vt-tab-group">
          {(['monto','unidades'] as const).map(v => (
            <button key={v} className={`vt-tab-btn ${prodBy === v ? 'active' : ''}`}
              onClick={() => setProdBy(v)}>
              Por {v}
            </button>
          ))}
        </div>
        <div className="vt-sal-pills">
          <button className={`vt-sal-pill ${salFiltro === '' ? 'active' : ''}`}
            onClick={() => setSalFiltro('')}>General</button>
          {sals.map(n => (
            <button key={n} className={`vt-sal-pill ${salFiltro === n ? 'active' : ''}`}
              onClick={() => setSalFiltro(n)}>{n}</button>
          ))}
        </div>
      </div>
      <div className="vt-prod-list">
        {prodsToShow.map((p, i) => (
          <div key={p.nombre} className="vt-prod-row">
            <div className="vt-prod-rank">{i + 1}</div>
            <div className="vt-prod-name">
              {p.nombre}
              {pm[p.nombre] && (
                <span className={`vt-prod-tipo ${pm[p.nombre].tipo}`}>
                  {pm[p.nombre].tipo}
                </span>
              )}
            </div>
            <div className="vt-prod-stats">
              <span>{p.q} uds</span>
              <span>{fi(p.m)}</span>
            </div>
          </div>
        ))}
        {prodsToShow.length === 0 && (
          <div style={{ color: '#888', padding: '1rem', textAlign: 'center', fontSize: '0.85rem' }}>
            Sin datos de productos
          </div>
        )}
      </div>
    </div>
  )
}
