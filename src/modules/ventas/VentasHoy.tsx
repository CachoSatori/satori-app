import React, { useState, useMemo } from 'react'
import type { DiasMap, ProductMap, Meta } from '../../shared/types/ventas'
import {
  aggGeneral, aggSalonero, aggCajero, getDayStats,
  fi, fmtDate, metaColor, getMeta,
  topProds, metaProgress, ratioCBClass,
  allSaloneros, esCajero,
} from './ventasUtils'
import { getOpenCashSession, createCashMovement } from '../../shared/api/cash'
import { useAuth } from '../../shared/hooks/useAuth'

interface Props {
  dias:   DiasMap
  pm:     ProductMap
  metas: Meta
}

export default function VentasHoy({ dias, pm, metas }: Props) {
  const { profile } = useAuth()
  const [registrando, setRegistrando] = useState(false)
  const [regMsg,      setRegMsg]      = useState<string | null>(null)
  const [prodView, setProdView]   = useState<'general'|'comidas'|'bebidas'>('general')
  const [prodBy, setProdBy]       = useState<'monto'|'unidades'>('monto')
  const [salFiltro, setSalFiltro] = useState<string>('')
  const [sortBy, setSortBy]       = useState<'promPax'|'total'|'pax'|'ticket'>('promPax')

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

  // Previous day for delta comparison
  const prevDate = useMemo(() => {
    if (!activeDate) return null
    const i = allDates.indexOf(activeDate)
    return i > 0 ? allDates[i - 1] : null
  }, [activeDate, allDates])

  const genPrev = useMemo(() =>
    prevDate ? aggGeneral([prevDate], dias, pm) : null,
  [prevDate, dias, pm])

  // Derived metrics not in aggGeneral
  const com  = useMemo(() => gen ? Object.entries(gen.prods).reduce((s,[n,v]) => s + (pm[n]?.tipo==='comida' ? v.m : 0), 0) : 0, [gen, pm])
  const beb  = useMemo(() => gen ? Object.entries(gen.prods).reduce((s,[n,v]) => s + (pm[n]?.tipo==='bebida' ? v.m : 0), 0) : 0, [gen, pm])
  const promPlato   = gen && gen.iCom > 0 ? com   / gen.iCom : 0
  const promBebida  = gen && gen.iBeb > 0 ? beb   / gen.iBeb : 0

  // Special product categories for bottom section
  const cortProds = useMemo(() => gen ? topProds(gen.prods, 'monto', 8, ['cortesia'],    pm) : [], [gen, pm])
  const persProds = useMemo(() => gen ? topProds(gen.prods, 'monto', 8, ['personal'],    pm) : [], [gen, pm])
  const descProds = useMemo(() => gen ? topProds(gen.prods, 'monto', 8, ['desconocido'], pm) : [], [gen, pm])

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
      if (sortBy === 'ticket')  return b.promTicket - a.promTicket
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

  // ▲/▼ delta vs día anterior
  function delta(cur: number, prev: number | undefined, isInt = false): React.ReactNode {
    if (!prev || prev === 0) return null
    const pct = (cur - prev) / prev * 100
    const col = pct > 0 ? 'var(--vt-green)' : pct < 0 ? 'var(--vt-red)' : '#666'
    const abs = isInt ? Math.round(cur - prev).toLocaleString('es-CR') : fi(Math.abs(cur - prev))
    return (
      <div style={{ fontSize:'0.68rem', color:col, marginTop:2 }}>
        {pct >= 0 ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}% ({pct >= 0 ? '+' : ''}{isInt ? (Math.round(cur - prev)) : abs})
      </div>
    )
  }

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
          {/* Auto-register ventas in Caja */}
          {(profile?.role === 'owner' || profile?.role === 'manager') && gen && gen.totalRest > 0 && (
            <button
              className="vt-range-btn"
              disabled={registrando}
              title="Crea un movimiento de ingreso en la Caja con el total de ventas del día"
              style={{ fontSize: '0.68rem', borderColor: 'var(--vt-green)', color: 'var(--vt-green)' }}
              onClick={async () => {
                if (!profile) return
                setRegistrando(true); setRegMsg(null)
                try {
                  const cashSession = await getOpenCashSession()
                  if (!cashSession) { setRegMsg('⚠ No hay turno de caja abierto'); return }
                  await createCashMovement({
                    session_id:    cashSession.id,
                    created_by:    profile.id,
                    movement_type: 'ingreso',
                    amount_crc:    Math.round(gen.totalRest),
                    amount_usd:    0,
                    currency:      'CRC',
                    exchange_rate: null,
                    description:   `Ventas del día ${activeDate}`,
                    subcategory:   'Ventas diarias',
                    method:        'Efectivo',
                    caja_origen:   'Registradora',
                    shift:         cashSession.shift_type ?? '',
                  })
                  setRegMsg(`✓ ₡${Math.round(gen.totalRest).toLocaleString('es-CR')} registrado en Caja`)
                  setTimeout(() => setRegMsg(null), 4000)
                } catch (e) {
                  setRegMsg(`✗ ${e instanceof Error ? e.message : 'Error'}`)
                } finally {
                  setRegistrando(false)
                }
              }}
            >
              {registrando ? '⟳' : '→ Caja'}
            </button>
          )}
        </div>
      </div>
      {regMsg && (
        <div style={{ fontSize: '0.78rem', padding: '0.4rem 0', color: regMsg.startsWith('✓') ? 'var(--vt-green)' : 'var(--vt-red)' }}>
          {regMsg}
        </div>
      )}

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
      <div className="vt-sl">
        Saloneros
        {prevDate && <span style={{ fontSize:'0.65rem', color:'#555', marginLeft:'0.5rem', fontWeight:400 }}>vs {prevDate}</span>}
      </div>
      <div className="vt-kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(145px, 1fr))' }}>
        <div className="vt-kpi red">
          <div className="vt-kpi-label">Ventas Salón</div>
          <div className="vt-kpi-val">{fi(gen.total)}</div>
          {delta(gen.total, genPrev?.total)}
        </div>
        <div className="vt-kpi">
          <div className="vt-kpi-label">PAX</div>
          <div className="vt-kpi-val">{gen.pax}</div>
          {delta(gen.pax, genPrev?.pax, true)}
        </div>
        <div className="vt-kpi" style={{ borderLeftColor: metaColor(gen.promPax, getMeta(metas, '', 'promPax')) || 'var(--vt-gold)' }}>
          <div className="vt-kpi-label">Prom/PAX</div>
          <div className="vt-kpi-val">{fi(gen.promPax)}</div>
          {delta(gen.promPax, genPrev?.promPax)}
        </div>
        <div className="vt-kpi">
          <div className="vt-kpi-label">Prom/Plato</div>
          <div className="vt-kpi-val">{fi(promPlato)}</div>
          {delta(promPlato, genPrev && genPrev.iCom > 0 ? Object.entries(genPrev.prods).reduce((s,[n,v]) => s+(pm[n]?.tipo==='comida'?v.m:0),0) / genPrev.iCom : undefined)}
        </div>
        <div className="vt-kpi">
          <div className="vt-kpi-label">Prom/Bebida</div>
          <div className="vt-kpi-val">{fi(promBebida)}</div>
        </div>
        <div className="vt-kpi">
          <div className="vt-kpi-label">Bebidas/PAX</div>
          <div className="vt-kpi-val" style={{ color: metaColor(gen.bebPax, getMeta(metas,'','bebPax')) }}>
            {gen.bebPax.toFixed(2)}
          </div>
          {delta(gen.bebPax, genPrev?.bebPax)}
        </div>
        <div className="vt-kpi">
          <div className="vt-kpi-label">Ratio C/B (₡)</div>
          <div className={`vt-kpi-val ${ratioCBClass(gen.ratioCB)}`}>{gen.ratioCB.toFixed(2)}:1</div>
        </div>
        <div className="vt-kpi">
          <div className="vt-kpi-label">Comidas</div>
          <div className="vt-kpi-val" style={{ fontSize:'0.85rem' }}>{fi(com)}</div>
          <div className="vt-kpi-sub">{gen.iCom} platos</div>
        </div>
        <div className="vt-kpi blue">
          <div className="vt-kpi-label">Bebidas</div>
          <div className="vt-kpi-val" style={{ fontSize:'0.85rem' }}>{fi(beb)}</div>
          <div className="vt-kpi-sub">{gen.iBeb} bebidas</div>
        </div>
      </div>

      {/* Ranking */}
      <div className="vt-sl" style={{ marginTop: '1.5rem' }}>
        Ranking del día
        <div className="vt-sort-tabs" style={{ marginLeft: '1rem' }}>
          {(['promPax','total','pax','ticket'] as const).map(k => (
            <button key={k} className={`vt-sort-tab ${sortBy === k ? 'active' : ''}`}
              onClick={() => setSortBy(k)}>
              {k === 'promPax' ? 'Prom/PAX' : k === 'total' ? 'Ventas' : k === 'ticket' ? 'Ticket/item' : 'PAX'}
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
              <th className="r">Ticket/item</th>
              <th className="r">Beb/PAX</th>
              <th className="r">Ratio C/B</th>
              <th className="r" style={{ color:'#555', fontSize:'0.65rem' }}>vs General</th>
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
                  <td className="r" style={{ fontSize:'0.8rem', color: s.promTicket >= (gen.promTicket ?? 0) ? 'var(--vt-green)' : '#888' }}>
                    {fi(s.promTicket)}
                  </td>
                  <td className="r" style={{ color: metaColor(s.bebPax, metaBP) }}>
                    {s.bebPax.toFixed(2)}
                  </td>
                  <td className={`r ${ratioCBClass(s.ratioCB)}`}>
                    {s.ratioCB.toFixed(2)}:1
                  </td>
                  <td className="r">
                    {gen.promPax > 0 && (() => {
                      const diff = s.promPax - gen.promPax
                      const pct  = diff / gen.promPax * 100
                      const col  = diff >= 0 ? 'var(--vt-green)' : 'var(--vt-red)'
                      return <span style={{ fontSize:'0.72rem', color:col, fontWeight:600 }}>{diff >= 0 ? '▲ +' : '▼ '}{Math.abs(pct).toFixed(1)}%</span>
                    })()}
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

      {/* ── Regalías, Personal & Desconocidos ── */}
      {(gen.cortTotal > 0 || gen.persTotal > 0 || descProds.length > 0) && (
        <>
          <div className="vt-sl" style={{ marginTop: '1.75rem' }}>Regalías, Personal & Desconocidos</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))', gap:'0.75rem' }}>
            {gen.cortTotal > 0 && (
              <SpecialCard
                icon="🎁" title="Regalías / Cortesías" color="#e8a838"
                total={gen.cortTotal} prods={cortProds} />
            )}
            {gen.persTotal > 0 && (
              <SpecialCard
                icon="👨‍🍳" title="Comida Personal" color="#7b9fc7"
                total={gen.persTotal} prods={persProds} />
            )}
            {descProds.length > 0 && (
              <SpecialCard
                icon="❓" title="Desconocidos" color="#888"
                total={descProds.reduce((s,p)=>s+p.m,0)} prods={descProds} />
            )}
          </div>
        </>
      )}
    </div>
  )
}

function SpecialCard({ icon, title, color, total, prods }: {
  icon: string; title: string; color: string
  total: number; prods: Array<{ nombre: string; q: number; m: number }>
}) {
  return (
    <div style={{ background:'var(--vt-ink)', borderRadius:2, padding:'0.875rem', borderLeft:`3px solid ${color}` }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.75rem' }}>
        <div style={{ fontSize:'0.82rem', fontWeight:700, color }}>{icon} {title}</div>
        <div style={{ fontFamily:'Syne,sans-serif', fontSize:'1rem', fontWeight:800, color }}>
          {new Intl.NumberFormat('es-CR',{style:'currency',currency:'CRC',minimumFractionDigits:0}).format(total)}
        </div>
      </div>
      {prods.map(p => (
        <div key={p.nombre} style={{ display:'flex', gap:'0.5rem', alignItems:'baseline', padding:'0.25rem 0', borderBottom:'1px solid #1a1a1a' }}>
          <span style={{ flex:1, fontSize:'0.78rem', color:'#aaa', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.nombre}</span>
          <span style={{ fontSize:'0.72rem', color:'#555', whiteSpace:'nowrap' }}>{p.q} uds</span>
          <span style={{ fontSize:'0.78rem', color, fontWeight:600, whiteSpace:'nowrap' }}>
            {new Intl.NumberFormat('es-CR',{style:'currency',currency:'CRC',minimumFractionDigits:0}).format(p.m)}
          </span>
        </div>
      ))}
    </div>
  )
}
