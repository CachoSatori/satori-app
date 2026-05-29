import { useState, useMemo } from 'react'
import type { DiasMap, ProductMap, Meta } from '../../shared/types/ventas'
import {
  aggGeneral, aggSalonero, getDayStats,
  fi, fmtDate, metaColor, getMeta,
  topProds, metaProgress, ratioCBClass,
  allSaloneros,
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

  const lastDate = useMemo(() => {
    const keys = Object.keys(dias).sort()
    return keys[keys.length - 1] ?? null
  }, [dias])

  const dia = lastDate ? dias[lastDate] : null
  const sals = useMemo(() => dia ? allSaloneros({ [lastDate!]: dia }) : [], [dia, lastDate])

  const gen = useMemo(() =>
    lastDate ? aggGeneral([lastDate], dias, pm) : null,
  [lastDate, dias, pm])

  const salAggs = useMemo(() =>
    sals.map(n => aggSalonero(n, lastDate ? [lastDate] : [], dias, pm)),
  [sals, lastDate, dias, pm])

  const sorted = useMemo(() =>
    [...salAggs].sort((a, b) => {
      if (sortBy === 'promPax') return b.promPax - a.promPax
      if (sortBy === 'total')   return b.total - a.total
      return b.pax - a.pax
    }),
  [salAggs, sortBy])

  const metaMonth = lastDate?.slice(0, 7) ?? ''
  const progress  = metaProgress(metas, dias, {}, metaMonth)

  if (!lastDate || !dia || !gen) {
    return (
      <div className="vt-empty">
        <div className="vt-empty-icon">売</div>
        <div className="vt-empty-title">Sin datos cargados</div>
        <div className="vt-empty-sub">Cargá un archivo XLS para empezar</div>
      </div>
    )
  }

  const stats = getDayStats(dia)
  const hasCajeros = Object.values(dia.saloneros).some(s => (s as { esCajero?: boolean }).esCajero)

  // Top products for this day
  const allProds = salFiltro
    ? (aggSalonero(salFiltro, [lastDate], dias, pm).prods)
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
      <div className="vt-hoy-header">
        <div>
          <div className="vt-hoy-fecha">{fmtDate(lastDate)}</div>
          <div className="vt-hoy-sub">Último día cargado</div>
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

      {/* Restaurant KPIs */}
      {hasCajeros && (
        <div className="vt-kpi-grid">
          <div className="vt-kpi red">
            <div className="vt-kpi-label">Venta Total Restaurante</div>
            <div className="vt-kpi-val">{fi(stats.ventaNeta)}</div>
          </div>
          <div className="vt-kpi">
            <div className="vt-kpi-label">Salón</div>
            <div className="vt-kpi-val">{fi(gen.total + gen.cajSalon)}</div>
            <div className="vt-kpi-sub">{((gen.total + gen.cajSalon) / gen.totalRest * 100).toFixed(1)}%</div>
          </div>
          <div className="vt-kpi blue">
            <div className="vt-kpi-label">Delivery</div>
            <div className="vt-kpi-val">{fi(gen.cajDelivery)}</div>
            <div className="vt-kpi-sub">{(gen.cajDelivery / gen.totalRest * 100).toFixed(1)}%</div>
          </div>
        </div>
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
          <div className="vt-kpi-val" style={{ color: metaColor(gen.bebPax, getMeta(metas,'','bebPax')) }}>{gen.bebPax.toFixed(2)}</div>
        </div>
        <div className={`vt-kpi`}>
          <div className="vt-kpi-label">Ratio C/B (₡)</div>
          <div className={`vt-kpi-val ${ratioCBClass(gen.ratioCB)}`}>{gen.ratioCB.toFixed(2)}:1</div>
        </div>
        <div className="vt-kpi">
          <div className="vt-kpi-label">Ratio C/B (uds)</div>
          <div className="vt-kpi-val">{gen.ratioU.toFixed(2)}:1</div>
        </div>
      </div>

      {/* Ranking table */}
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
                  <td style={{ color: '#555', fontWeight: 700 }}>{i + 1}</td>
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
