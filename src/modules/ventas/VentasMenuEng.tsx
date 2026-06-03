/**
 * VentasMenuEng — Ingeniería de Menú (Menu Engineering Matrix)
 *
 * Replicates the "Menu Engineering Quadrant" from Lightspeed Pro Analytics ($399/mo)
 * and Restaurant365 ($435/mo), using already-existing data:
 *   - product_map.costo_unitario  → ingredient cost per unit
 *   - ventas_dias product records → units sold + revenue
 *
 * Four quadrants (popularidad × margen):
 *   ⭐ ESTRELLAS   — alta popularidad + alto margen   → defender y promover
 *   🐄 CABALLOS    — alta popularidad + bajo margen   → revisar precio / costo
 *   🎯 PUZZLES     — baja popularidad + alto margen   → mejor posicionamiento
 *   🐕 PERROS      — baja popularidad + bajo margen   → evaluar eliminar
 */
import { useState, useMemo } from 'react'
import type { DiasMap, ProductMap, HistMap } from '../../shared/types/ventas'
import { availableMonths, availableYears, fi } from './ventasUtils'
import { isCajeroName } from '../../shared/utils'

interface MenuEngItem {
  nombre:     string
  tipo:       string
  clas:       string
  unidades:   number   // units sold in period
  monto:      number   // total revenue
  avgPrice:   number   // monto / unidades
  costo:      number   // costo_unitario from product_map (per unit)
  margin:     number   // avgPrice - costo
  marginPct:  number   // margin / avgPrice × 100  (food cost% = 100 - marginPct)
  hasCoste:   boolean  // whether costo_unitario > 0
}

const MSHORT = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

const QUADRANTS = [
  {
    id: 'estrella', label: 'ESTRELLAS', emoji: '⭐',
    color: '#4a9a6a', bg: 'rgba(74,154,106,.1)',
    desc: 'Alta popularidad · Alto margen → Defender y promover activamente',
  },
  {
    id: 'caballo', label: 'CABALLOS', emoji: '🐄',
    color: '#c8a96e', bg: 'rgba(200,169,110,.1)',
    desc: 'Alta popularidad · Bajo margen → Revisar precio o reducir costo',
  },
  {
    id: 'puzzle', label: 'PUZZLES', emoji: '🎯',
    color: '#c890e8', bg: 'rgba(200,144,232,.1)',
    desc: 'Baja popularidad · Alto margen → Reposicionar en carta o promover',
  },
  {
    id: 'perro', label: 'PERROS', emoji: '🐕',
    color: '#c23b22', bg: 'rgba(194,59,34,.08)',
    desc: 'Baja popularidad · Bajo margen → Evaluar eliminar de carta',
  },
]

interface Props { dias: DiasMap; pm: ProductMap; hist?: HistMap }

export default function VentasMenuEng({ dias, pm }: Props) {
  const allMonths = useMemo(() => availableMonths(dias, {}), [dias])
  const allYears  = useMemo(() => availableYears(dias, {}),  [dias])
  const [period, setPeriod] = useState(allMonths[0] ?? '')
  const [canal,  setCanal]  = useState<'todos'|'salon'|'delivery'>('todos')
  const [view,   setView]   = useState<'cuadro'|'tabla'>('cuadro')
  const [sortCol, setSortCol] = useState<keyof MenuEngItem>('unidades')
  const [sortAsc, setSortAsc] = useState(false)

  // Build raw sales data for period
  const salesData = useMemo(() => {
    const allD = Object.keys(dias).sort()
    const selDates = period.startsWith('todo-')
      ? allD.filter(d => d.startsWith(period.slice(5)))
      : allD.filter(d => d.startsWith(period))

    const acc: Record<string, { q: number; m: number }> = {}
    for (const date of selDates) {
      const dia = dias[date]
      if (!dia) continue
      for (const [salName, s] of Object.entries(dia.saloneros)) {
        const isCaj = isCajeroName(salName)
        if (canal === 'salon'    && isCaj)  continue
        if (canal === 'delivery' && !isCaj) continue
        const prods = (s as { prods?: [string, number, number][] }).prods ?? []
        for (const [name, qty, monto] of prods) {
          if (!name) continue
          const info = pm[name]
          // Skip cortesia and personal items (they're not sold items)
          if (info?.tipo === 'cortesia' || info?.tipo === 'personal') continue
          if (!acc[name]) acc[name] = { q: 0, m: 0 }
          acc[name].q += qty * (info?.multiplicador ?? 1)
          acc[name].m += monto
        }
      }
    }
    return acc
  }, [dias, pm, period, canal])

  // Build enriched items
  const items: MenuEngItem[] = useMemo(() => {
    return Object.entries(salesData)
      .filter(([, v]) => v.m > 0 && v.q > 0)
      .map(([nombre, { q, m }]) => {
        const info     = pm[nombre]
        const costo    = info?.costo_unitario ?? 0
        const avgPrice = q > 0 ? m / q : 0
        const margin   = avgPrice > 0 ? avgPrice - costo : 0
        const marginPct = avgPrice > 0 && costo > 0 ? (margin / avgPrice) * 100 : 0
        return {
          nombre,
          tipo:      info?.tipo       ?? 'desconocido',
          clas:      info?.clasificacion ?? 'SIN CLASIFICAR',
          unidades:  Math.round(q),
          monto:     Math.round(m),
          avgPrice:  Math.round(avgPrice),
          costo:     Math.round(costo),
          margin:    Math.round(margin),
          marginPct: Math.round(marginPct * 10) / 10,
          hasCoste:  costo > 0,
        }
      })
  }, [salesData, pm])

  // Thresholds — use medians
  const withCost  = items.filter(i => i.hasCoste)
  const allUnids  = items.map(i => i.unidades).sort((a,b) => a-b)
  const medianUds = allUnids.length ? allUnids[Math.floor(allUnids.length / 2)] : 0
  const allMargins = withCost.map(i => i.marginPct).sort((a,b) => a-b)
  const medianMgn  = allMargins.length ? allMargins[Math.floor(allMargins.length / 2)] : 0

  function getQuadrant(item: MenuEngItem): string {
    if (!item.hasCoste) return 'sin-costo'
    const hiPop = item.unidades >= medianUds
    const hiMgn = item.marginPct >= medianMgn
    if (hiPop && hiMgn)  return 'estrella'
    if (hiPop && !hiMgn) return 'caballo'
    if (!hiPop && hiMgn) return 'puzzle'
    return 'perro'
  }

  const grouped = useMemo(() => {
    const g: Record<string, MenuEngItem[]> = { estrella:[], caballo:[], puzzle:[], perro:[], 'sin-costo':[] }
    for (const item of items) g[getQuadrant(item)].push(item)
    return g
  }, [items, medianUds, medianMgn])

  // Sorted table
  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => {
      const va = a[sortCol] as number
      const vb = b[sortCol] as number
      return sortAsc ? va - vb : vb - va
    })
  }, [items, sortCol, sortAsc])

  function toggleSort(col: keyof MenuEngItem) {
    if (col === sortCol) setSortAsc(a => !a)
    else { setSortCol(col); setSortAsc(false) }
  }

  // Stats
  const totalVentas  = items.reduce((s, i) => s + i.monto, 0)
  const withCostPct  = withCost.length / Math.max(items.length, 1) * 100
  const avgFoodCost  = withCost.length
    ? withCost.reduce((s,i) => s + (100 - i.marginPct), 0) / withCost.length : 0
  const topMgn       = withCost.length ? Math.max(...withCost.map(i => i.marginPct)) : 0

  if (!allMonths.length || !Object.keys(dias).length) {
    return (
      <div className="vt-empty">
        <div className="vt-empty-icon">📊</div>
        <div className="vt-empty-title">Sin datos de ventas</div>
        <div className="vt-empty-sub">Cargá archivos XLS para ver la ingeniería de menú</div>
      </div>
    )
  }

  return (
    <div className="vt-section">

      {/* Period + Canal selector */}
      <div style={{ background:'var(--vt-ink)', borderRadius:2, padding:'0.75rem 1rem', marginBottom:'1rem' }}>
        <div style={{ display:'flex', gap:'0.5rem', flexWrap:'wrap', alignItems:'center', marginBottom:'0.5rem' }}>
          <div className="vt-tab-group">
            {(['todos','salon','delivery'] as const).map(c => (
              <button key={c} className={`vt-tab-btn ${canal===c?'active':''}`} onClick={() => setCanal(c)}>
                {c === 'todos' ? 'Salón+Del.' : c === 'salon' ? 'Solo Salón' : 'Solo Delivery'}
              </button>
            ))}
          </div>
          <div className="vt-tab-group" style={{ marginLeft:'auto' }}>
            <button className={`vt-tab-btn ${view==='cuadro'?'active':''}`} onClick={() => setView('cuadro')}>
              ⊞ Cuadrante
            </button>
            <button className={`vt-tab-btn ${view==='tabla'?'active':''}`} onClick={() => setView('tabla')}>
              ≡ Tabla
            </button>
          </div>
        </div>
        {allYears.map(y => (
          <div key={y} style={{ display:'flex', gap:'0.3rem', flexWrap:'wrap', alignItems:'center', marginBottom:'0.3rem' }}>
            <span style={{ fontSize:'0.62rem', color:'#555', minWidth:42, textTransform:'uppercase', letterSpacing:'0.1em' }}>{y}:</span>
            <button className={`vt-range-btn ${period===`todo-${y}`?'active':''}`} onClick={() => setPeriod(`todo-${y}`)}>Todo {y}</button>
            <select
              className={`date-filter ${!period.startsWith('todo-') && period.startsWith(String(y)) ? 'active' : ''}`}
              value={!period.startsWith('todo-') && period.startsWith(String(y)) ? period : ''}
              onChange={e => { if (e.target.value) setPeriod(e.target.value) }}>
              <option value="">mes ▾</option>
              {allMonths.filter(m => m.startsWith(String(y))).map(m => (
                <option key={m} value={m}>{MSHORT[Number(m.split('-')[1]) - 1]}</option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {/* Top KPIs */}
      <div className="vt-kpi-grid" style={{ gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))', marginBottom:'1.25rem' }}>
        <div className="vt-kpi red">
          <div className="vt-kpi-label">Productos activos</div>
          <div className="vt-kpi-val">{items.length}</div>
          <div className="vt-kpi-sub">{withCost.length} con costo cargado</div>
        </div>
        <div className="vt-kpi">
          <div className="vt-kpi-label">Cobertura costos</div>
          <div className="vt-kpi-val" style={{ color: withCostPct > 80 ? 'var(--vt-green)' : withCostPct > 50 ? '#c8a96e' : 'var(--vt-red)' }}>
            {withCostPct.toFixed(0)}%
          </div>
          <div className="vt-kpi-sub">de items con costo</div>
        </div>
        {withCost.length > 0 && (
          <>
            <div className="vt-kpi" style={{ borderLeftColor: avgFoodCost <= 30 ? 'var(--vt-green)' : avgFoodCost <= 38 ? '#c8a96e' : 'var(--vt-red)' }}>
              <div className="vt-kpi-label">Food Cost % promedio</div>
              <div className="vt-kpi-val" style={{ color: avgFoodCost <= 30 ? 'var(--vt-green)' : avgFoodCost <= 38 ? '#c8a96e' : 'var(--vt-red)' }}>
                {avgFoodCost.toFixed(1)}%
              </div>
              <div className="vt-kpi-sub">ideal: 28-35%</div>
            </div>
            <div className="vt-kpi green">
              <div className="vt-kpi-label">Margen máx</div>
              <div className="vt-kpi-val">{topMgn.toFixed(1)}%</div>
            </div>
            <div className="vt-kpi" style={{ borderLeftColor: '#4a9a6a' }}>
              <div className="vt-kpi-label">⭐ Estrellas</div>
              <div className="vt-kpi-val">{grouped.estrella.length}</div>
              <div className="vt-kpi-sub">{fi(grouped.estrella.reduce((s,i)=>s+i.monto,0))}</div>
            </div>
          </>
        )}
      </div>

      {/* No cost data warning */}
      {withCost.length === 0 && (
        <div style={{ background:'rgba(200,169,110,.12)', border:'1px solid rgba(200,169,110,.3)', borderRadius:2, padding:'0.875rem 1rem', marginBottom:'1.25rem', fontSize:'0.82rem', color:'#c8a96e' }}>
          ⚠ Ningún producto tiene costo unitario cargado. Ingresá los costos en la tab <strong>Productos</strong> para ver el análisis de margen completo.
        </div>
      )}

      {/* ── CUADRANTE view ─────────────────────────────────────── */}
      {view === 'cuadro' && (
        <>
          {/* 2×2 quadrant grid */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.5rem', marginBottom:'1.5rem' }}>
            {QUADRANTS.map(q => {
              const qItems = grouped[q.id] ?? []
              const qVentas = qItems.reduce((s,i)=>s+i.monto,0)
              const topItems = [...qItems].sort((a,b)=>b.monto-a.monto).slice(0,6)
              return (
                <div key={q.id} style={{ background:q.bg, border:`1px solid ${q.color}44`, borderRadius:2, padding:'0.875rem' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:'0.5rem' }}>
                    <div style={{ fontSize:'0.78rem', fontWeight:700, color:q.color, letterSpacing:'0.08em' }}>
                      {q.emoji} {q.label}
                    </div>
                    <div style={{ fontSize:'0.72rem', color:'#666' }}>{qItems.length} items</div>
                  </div>
                  <div style={{ fontSize:'0.62rem', color:'#555', marginBottom:'0.6rem', lineHeight:1.4 }}>{q.desc}</div>
                  {qVentas > 0 && (
                    <div style={{ fontSize:'0.72rem', color:q.color, fontWeight:700, marginBottom:'0.5rem' }}>
                      {fi(qVentas)} · {totalVentas > 0 ? (qVentas/totalVentas*100).toFixed(1) : 0}% del mix
                    </div>
                  )}
                  <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
                    {topItems.map((item, i) => (
                      <div key={item.nombre} style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', padding:'0.2rem 0', borderBottom:'1px solid rgba(255,255,255,.04)', fontSize:'0.72rem' }}>
                        <div style={{ display:'flex', gap:'0.3rem', alignItems:'baseline', flex:1, overflow:'hidden' }}>
                          <span style={{ color:'#444', minWidth:14 }}>{i+1}</span>
                          <span style={{ color:'#bbb', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={item.nombre}>{item.nombre}</span>
                        </div>
                        <div style={{ display:'flex', gap:'0.5rem', flexShrink:0, marginLeft:'0.5rem' }}>
                          <span style={{ color:'#666' }}>{item.unidades}u</span>
                          {item.hasCoste && (
                            <span style={{ color: item.marginPct >= medianMgn ? '#4a9a6a' : '#c23b22', fontWeight:600 }}>
                              {item.marginPct.toFixed(0)}%mg
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                    {qItems.length > 6 && (
                      <div style={{ fontSize:'0.65rem', color:'#444', marginTop:2 }}>+{qItems.length-6} más…</div>
                    )}
                    {qItems.length === 0 && (
                      <div style={{ fontSize:'0.72rem', color:'#333', padding:'0.5rem 0' }}>Sin items en este cuadrante</div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Sin costo section */}
          {grouped['sin-costo'].length > 0 && (
            <div style={{ background:'#0f0f0f', border:'1px solid #222', borderRadius:2, padding:'0.75rem 1rem', marginBottom:'1.25rem' }}>
              <div style={{ fontSize:'0.75rem', color:'#555', fontWeight:700, letterSpacing:'0.1em', marginBottom:'0.4rem' }}>
                ⬜ SIN COSTO CARGADO — {grouped['sin-costo'].length} items
              </div>
              <div style={{ fontSize:'0.68rem', color:'#444', display:'flex', flexWrap:'wrap', gap:'0.4rem' }}>
                {grouped['sin-costo'].slice(0,20).map(i => (
                  <span key={i.nombre} style={{ padding:'1px 6px', border:'1px solid #222', borderRadius:2, color:'#555' }}>{i.nombre}</span>
                ))}
                {grouped['sin-costo'].length > 20 && <span style={{ color:'#333' }}>+{grouped['sin-costo'].length-20} más</span>}
              </div>
            </div>
          )}

          {/* Legend */}
          <div style={{ background:'var(--vt-ink)', borderRadius:2, padding:'0.75rem 1rem', fontSize:'0.7rem', color:'#555' }}>
            <strong style={{ color:'#777' }}>Cómo leer el cuadrante:</strong>{' '}
            Popularidad = unidades vendidas vs mediana ({medianUds} uds). Margen = precio promedio - costo unitario, comparado vs mediana ({medianMgn.toFixed(1)}% margen bruto).
            {withCostPct < 80 && <span style={{ color:'#c8a96e', marginLeft:'0.5rem' }}>Tip: cargá más costos en Productos para mejorar la precisión.</span>}
          </div>
        </>
      )}

      {/* ── TABLA view ─────────────────────────────────────────── */}
      {view === 'tabla' && (
        <div className="vt-tbl-wrap">
          <table className="vt-tbl">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Cuadrante</th>
                <th className="r" style={{ cursor:'pointer' }} onClick={() => toggleSort('unidades')}>
                  Uds {sortCol==='unidades' ? (sortAsc?'▲':'▼') : '⇅'}
                </th>
                <th className="r" style={{ cursor:'pointer' }} onClick={() => toggleSort('monto')}>
                  Ventas {sortCol==='monto' ? (sortAsc?'▲':'▼') : '⇅'}
                </th>
                <th className="r" style={{ cursor:'pointer' }} onClick={() => toggleSort('avgPrice')}>
                  Precio Prom {sortCol==='avgPrice' ? (sortAsc?'▲':'▼') : '⇅'}
                </th>
                <th className="r" style={{ cursor:'pointer' }} onClick={() => toggleSort('costo')}>
                  Costo {sortCol==='costo' ? (sortAsc?'▲':'▼') : '⇅'}
                </th>
                <th className="r" style={{ cursor:'pointer' }} onClick={() => toggleSort('margin')}>
                  Margen ₡ {sortCol==='margin' ? (sortAsc?'▲':'▼') : '⇅'}
                </th>
                <th className="r" style={{ cursor:'pointer' }} onClick={() => toggleSort('marginPct')}>
                  Margen % {sortCol==='marginPct' ? (sortAsc?'▲':'▼') : '⇅'}
                </th>
                <th className="r">Food Cost%</th>
              </tr>
            </thead>
            <tbody>
              {sortedItems.map(item => {
                const qid = getQuadrant(item)
                const q   = QUADRANTS.find(x => x.id === qid)
                const foodCost = item.hasCoste ? (100 - item.marginPct) : null
                return (
                  <tr key={item.nombre}>
                    <td style={{ fontSize:'0.78rem', maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {item.nombre}
                      <span className={`vt-prod-tipo ${item.tipo}`} style={{ fontSize:'0.58rem', marginLeft:4 }}>{item.tipo}</span>
                    </td>
                    <td>
                      {q ? (
                        <span style={{ fontSize:'0.68rem', color:q.color, fontWeight:600 }}>{q.emoji} {q.label}</span>
                      ) : (
                        <span style={{ fontSize:'0.68rem', color:'#444' }}>⬜ sin costo</span>
                      )}
                    </td>
                    <td className="r">{item.unidades.toLocaleString('es-CR')}</td>
                    <td className="r vt-bold">{fi(item.monto)}</td>
                    <td className="r">{fi(item.avgPrice)}</td>
                    <td className="r" style={{ color: item.hasCoste ? '#888' : '#333' }}>
                      {item.hasCoste ? fi(item.costo) : '—'}
                    </td>
                    <td className="r" style={{ color: item.hasCoste ? (item.margin > 0 ? 'var(--vt-green)' : 'var(--vt-red)') : '#333' }}>
                      {item.hasCoste ? fi(item.margin) : '—'}
                    </td>
                    <td className="r" style={{ color: item.hasCoste ? (item.marginPct >= medianMgn ? '#4a9a6a' : '#c23b22') : '#333', fontWeight: item.hasCoste ? 700 : 400 }}>
                      {item.hasCoste ? item.marginPct.toFixed(1) + '%' : '—'}
                    </td>
                    <td className="r" style={{ color: foodCost !== null ? (foodCost <= 30 ? '#4a9a6a' : foodCost <= 38 ? '#c8a96e' : '#c23b22') : '#333', fontSize:'0.8rem' }}>
                      {foodCost !== null ? foodCost.toFixed(1) + '%' : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
