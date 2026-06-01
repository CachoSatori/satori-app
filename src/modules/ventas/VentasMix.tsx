/**
 * VentasMix — Mix de ventas por producto
 * Two modes (ported from SATORI DASHBOARD standalone renderMixVentas):
 *   - "Ver período": single period hierarchical breakdown
 *   - "Comparar": up to 6 periods side-by-side with var% vs first
 */
import { useState, useMemo, type ReactElement } from 'react'
import type { DiasMap, ProductMap, HistMap } from '../../shared/types/ventas'
import {
  allDates, availableMonths, availableYears,
  fi,
} from './ventasUtils'
import { isCajeroName } from '../../shared/utils'

interface PM_Item {
  nombre: string; tipo: string; clas: string; subcl: string
  salon: number; delivery: number; unidades: number; monto: number
}

function buildPM(
  dates: string[],
  dias: DiasMap,
  pm: ProductMap,
  canal: 'todos' | 'salon' | 'delivery',
): Record<string, PM_Item> {
  const result: Record<string, PM_Item> = {}
  for (const date of dates) {
    const dia = dias[date]
    if (!dia) continue
    for (const [salName, s] of Object.entries(dia.saloneros)) {
      const isCaj = isCajeroName(salName)
      if (canal === 'salon'    && isCaj)  continue
      if (canal === 'delivery' && !isCaj) continue
      const prods = (s as { prods?: [string, number, number][] }).prods ?? []
      for (const [name, qty, monto] of prods) {
        if (!result[name]) {
          const info = pm[name]
          result[name] = {
            nombre: name, tipo: info?.tipo ?? 'desconocido',
            clas: info?.clasificacion ?? '', subcl: info?.subclasificacion ?? '',
            salon: 0, delivery: 0, unidades: 0, monto: 0,
          }
        }
        const mult = pm[name]?.multiplicador ?? 1
        result[name].monto    += monto
        result[name].unidades += qty * mult
        if (isCaj) result[name].delivery += monto
        else       result[name].salon    += monto
      }
    }
  }
  return result
}

function datesForPeriod(key: string, dias: DiasMap, hist: HistMap): string[] {
  const allD = [...new Set([...Object.keys(dias), ...Object.keys(hist)])].sort()
  if (key.startsWith('todo-')) {
    const y = key.slice(5)
    return allD.filter(d => d.startsWith(y))
  }
  return allD.filter(d => d.startsWith(key))
}

// Build PM including hist data (hist days have no product breakdown — only totals)
function buildPMForPeriod(
  key: string,
  dias: DiasMap,
  hist: HistMap,
  pm: ProductMap,
  canal: 'todos' | 'salon' | 'delivery',
): Record<string, PM_Item> {
  const dates = datesForPeriod(key, dias, hist)
  // Only include dates that have product-level data (ventas_dias)
  const diasDates = dates.filter(d => dias[d])
  return buildPM(diasDates, dias, pm, canal)
}

const CMP_COLORS = ['#c8a96e','#4a9a6a','#c890e8','#8ab4d4','#d4a84b','#c23b22']
const TIPO_ORDER = ['comida','bebida','nofood','cortesia','personal','desconocido']
const MAX_CMP = 6

interface Props {
  dias: DiasMap
  pm:   ProductMap
  hist?: HistMap
}

export default function VentasMix({ dias, pm, hist = {} }: Props) {
  const [mode, setMode] = useState<'ver' | 'comparar'>('ver')

  // ── Ver período ───────────────────────────────────────────────
  const months = useMemo(() => availableMonths(dias, hist), [dias, hist])
  const [selected, setSelected] = useState(months[0] ?? '')
  const [canal, setCanal] = useState<'todos'|'salon'|'delivery'>('todos')
  const [sortBy, setSortBy] = useState<'monto'|'unidades'>('monto')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  // ── Comparar mode ─────────────────────────────────────────────
  const [cmpPeriods, setCmpPeriods] = useState<string[]>(() => {
    // Default: last 2 months
    return months.slice(0, 2)
  })

  function togglePeriod(key: string) {
    setCmpPeriods(prev => {
      const idx = prev.indexOf(key)
      if (idx >= 0) return prev.filter((_, i) => i !== idx)
      if (prev.length >= MAX_CMP) return prev
      return [...prev, key]
    })
  }

  // ── VER mode data ─────────────────────────────────────────────
  const dates = useMemo(() => {
    const all = allDates(dias)
    if (selected.startsWith('todo-')) return all.filter(d => d.startsWith(selected.slice(5)))
    if (!selected) return all
    return all.filter(d => d.startsWith(selected))
  }, [dias, selected])

  const pmData = useMemo(() => buildPM(dates, dias, pm, canal), [dates, dias, pm, canal])

  const foodCostData = useMemo(() => {
    let totalCosto = 0, totalMonto = 0
    const byTipo: Record<string, { costo: number; monto: number }> = {}
    for (const [name, item] of Object.entries(pmData)) {
      const costo = (pm[name]?.costo_unitario ?? 0) * item.unidades
      totalCosto += costo; totalMonto += item.monto
      const tipo = item.tipo
      if (!byTipo[tipo]) byTipo[tipo] = { costo: 0, monto: 0 }
      byTipo[tipo].costo += costo; byTipo[tipo].monto += item.monto
    }
    return { totalCosto, totalMonto, byTipo, fcPct: totalMonto > 0 ? totalCosto / totalMonto * 100 : 0 }
  }, [pmData, pm])

  const totalMonto = Object.values(pmData).reduce((s, p) => s + p.monto, 0)
  const totBeb     = Object.values(pmData).filter(p => p.tipo === 'bebida').reduce((s, p) => s + p.monto, 0)
  const totCom     = Object.values(pmData).filter(p => p.tipo === 'comida').reduce((s, p) => s + p.monto, 0)
  const totUds     = Object.values(pmData).reduce((s, p) => s + p.unidades, 0)

  // Group by tipo → clas → subcl → prod
  const byTipoMap: Record<string, Record<string, Record<string, PM_Item[]>>> = {}
  for (const item of Object.values(pmData)) {
    const tipo = item.tipo || 'desconocido'
    const clas = item.clas || '(sin clasificar)'
    const subcl = item.subcl || ''
    if (!byTipoMap[tipo]) byTipoMap[tipo] = {}
    if (!byTipoMap[tipo][clas]) byTipoMap[tipo][clas] = {}
    if (!byTipoMap[tipo][clas][subcl]) byTipoMap[tipo][clas][subcl] = []
    byTipoMap[tipo][clas][subcl].push(item)
  }

  const toggle = (key: string) => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }))

  // ── COMPARAR mode data ────────────────────────────────────────
  const cmpData = useMemo(() => {
    return cmpPeriods.map(key => {
      const pmBuilt = buildPMForPeriod(key, dias, hist, pm, canal)
      const total   = Object.values(pmBuilt).reduce((s, p) => s + p.monto, 0)
      const beb     = Object.values(pmBuilt).filter(p => p.tipo === 'bebida').reduce((s, p) => s + p.monto, 0)
      const com     = Object.values(pmBuilt).filter(p => p.tipo === 'comida').reduce((s, p) => s + p.monto, 0)
      const uds     = Object.values(pmBuilt).reduce((s, p) => s + p.unidades, 0)
      return { key, pm: pmBuilt, total, beb, com, uds }
    })
  }, [cmpPeriods, dias, hist, pm, canal])

  // Master product list (union of all comparison periods)
  const masterProds = useMemo(() => {
    const all = new Set<string>()
    cmpData.forEach(c => Object.keys(c.pm).forEach(n => all.add(n)))
    return [...all]
  }, [cmpData])

  const labelPeriod = (key: string): string => {
    if (key.startsWith('todo-')) return `Todo ${key.slice(5)}`
    const [y, m] = key.split('-')
    const MSHORT = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
    return `${MSHORT[Number(m)-1]} ${y}`
  }

  // All periods for the selector (months from dias + hist)
  const allMonths = useMemo(() => availableMonths(dias, hist), [dias, hist])
  const allYears  = useMemo(() => availableYears(dias, hist), [dias, hist])

  return (
    <div className="vt-section">
      {/* Mode toggle */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', alignItems: 'center' }}>
        <div className="vt-tab-group">
          <button className={`vt-tab-btn ${mode === 'ver' ? 'active' : ''}`} onClick={() => setMode('ver')}>
            📊 Ver período
          </button>
          <button className={`vt-tab-btn ${mode === 'comparar' ? 'active' : ''}`} onClick={() => setMode('comparar')}>
            ⇄ Comparar
          </button>
        </div>
        {/* Canal filter — shared by both modes */}
        <div className="vt-tab-group">
          {(['todos','salon','delivery'] as const).map(c => (
            <button key={c} className={`vt-tab-btn ${canal === c ? 'active' : ''}`} onClick={() => setCanal(c)}>
              {c.charAt(0).toUpperCase() + c.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* ══════════════ VER PERÍODO ══════════════ */}
      {mode === 'ver' && (
        <>
          {/* Period picker */}
          <div className="vt-period-picker" style={{ marginBottom: '1.25rem' }}>
            {allYears.map(y => (
              <div key={y} style={{ marginBottom: '0.4rem' }}>
                <button
                  className={`vt-period-btn year ${selected === `todo-${y}` ? 'active' : ''}`}
                  onClick={() => setSelected(`todo-${y}`)}>
                  Todo {y}
                </button>
                {allMonths.filter(m => m.startsWith(String(y))).map(m => {
                  const [, mo] = m.split('-')
                  const MSHORT = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
                  return (
                    <button key={m} className={`vt-period-btn ${selected === m ? 'active' : ''}`}
                      onClick={() => setSelected(m)}>
                      {MSHORT[Number(mo)-1]}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>

          {/* Sort + KPIs */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <div className="vt-tab-group">
              {(['monto','unidades'] as const).map(v => (
                <button key={v} className={`vt-tab-btn ${sortBy === v ? 'active' : ''}`}
                  onClick={() => setSortBy(v)}>
                  Por {v}
                </button>
              ))}
            </div>
          </div>

          <div className="vt-kpi-grid">
            <div className="vt-kpi red">
              <div className="vt-kpi-label">Total Mix</div>
              <div className="vt-kpi-val">{fi(totalMonto)}</div>
            </div>
            <div className="vt-kpi blue">
              <div className="vt-kpi-label">Bebidas</div>
              <div className="vt-kpi-val">{fi(totBeb)}</div>
              <div className="vt-kpi-sub">{totalMonto > 0 ? (totBeb/totalMonto*100).toFixed(1) : 0}%</div>
            </div>
            <div className="vt-kpi green">
              <div className="vt-kpi-label">Comidas</div>
              <div className="vt-kpi-val">{fi(totCom)}</div>
              <div className="vt-kpi-sub">{totalMonto > 0 ? (totCom/totalMonto*100).toFixed(1) : 0}%</div>
            </div>
            <div className="vt-kpi">
              <div className="vt-kpi-label">Unidades</div>
              <div className="vt-kpi-val">{totUds.toLocaleString('es-CR')}</div>
            </div>
            {foodCostData.totalCosto > 0 && (
              <div className="vt-kpi" style={{ borderLeftColor: foodCostData.fcPct > 35 ? 'var(--vt-red)' : foodCostData.fcPct > 25 ? 'var(--vt-gold-dark,#a07830)' : 'var(--vt-green)' }}>
                <div className="vt-kpi-label">Food Cost</div>
                <div className="vt-kpi-val" style={{ color: foodCostData.fcPct > 35 ? 'var(--vt-red)' : foodCostData.fcPct > 25 ? 'var(--vt-gold-dark,#a07830)' : 'var(--vt-green)' }}>
                  {foodCostData.fcPct.toFixed(1)}%
                </div>
                <div className="vt-kpi-sub">{fi(foodCostData.totalCosto)} insumos</div>
              </div>
            )}
          </div>

          {/* Hierarchical table */}
          <div className="vt-mix-table">
            {TIPO_ORDER.filter(tipo => byTipoMap[tipo]).map(tipo => {
              const tipoKey = `tipo-${tipo}`
              const tipoTotal = Object.values(byTipoMap[tipo]).reduce((s, clases) =>
                s + Object.values(clases).reduce((s2, prods) => s2 + prods.reduce((s3, p) => s3 + p.monto, 0), 0), 0)
              const tipoUds = Object.values(byTipoMap[tipo]).reduce((s, clases) =>
                s + Object.values(clases).reduce((s2, prods) => s2 + prods.reduce((s3, p) => s3 + p.unidades, 0), 0), 0)
              const fcTipo = foodCostData.byTipo[tipo]

              return (
                <div key={tipo}>
                  <div className="vt-mix-tipo-hdr" onClick={() => toggle(tipoKey)}>
                    <span>{collapsed[tipoKey] ? '▶' : '▼'} {tipo.toUpperCase()}</span>
                    <span>
                      {fi(tipoTotal)} · {tipoUds.toLocaleString('es-CR')} uds · {totalMonto > 0 ? (tipoTotal/totalMonto*100).toFixed(1) : 0}%
                      {fcTipo?.costo > 0 && fcTipo?.monto > 0 && (
                        <span style={{ marginLeft: '0.5rem', color: fcTipo.costo/fcTipo.monto > 0.35 ? 'var(--vt-red)' : '#7ec8a0' }}>
                          · FC {(fcTipo.costo/fcTipo.monto*100).toFixed(0)}%
                        </span>
                      )}
                    </span>
                  </div>

                  {!collapsed[tipoKey] && Object.entries(byTipoMap[tipo]).sort().map(([clas, subclMap]) => {
                    const clasKey = `clas-${tipo}-${clas}`
                    const clasTotal = Object.values(subclMap).reduce((s, prods) => s + prods.reduce((s2, p) => s2 + p.monto, 0), 0)
                    return (
                      <div key={clas}>
                        <div className="vt-mix-clas-hdr" onClick={() => toggle(clasKey)}>
                          <span style={{ paddingLeft: '1rem' }}>{collapsed[clasKey] ? '▶' : '▼'} {clas}</span>
                          <span>{fi(clasTotal)} · {tipoTotal > 0 ? (clasTotal/tipoTotal*100).toFixed(1) : 0}%</span>
                        </div>
                        {!collapsed[clasKey] && Object.entries(subclMap).map(([, prods]) => {
                          const sorted = [...prods].sort((a, b) =>
                            sortBy === 'monto' ? b.monto - a.monto : b.unidades - a.unidades)
                          return sorted.map(p => (
                            <div key={p.nombre} className="vt-mix-prod-row">
                              <span style={{ paddingLeft: '3rem' }}>{p.nombre}</span>
                              <span className={`vt-prod-tipo ${p.tipo}`}>{p.tipo}</span>
                              <span>{p.unidades.toLocaleString('es-CR')} uds</span>
                              <span className="vt-bold">{fi(p.monto)}</span>
                              <span style={{ color: '#888' }}>{totalMonto > 0 ? (p.monto/totalMonto*100).toFixed(2) : 0}%</span>
                            </div>
                          ))
                        })}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* ══════════════ COMPARAR ══════════════ */}
      {mode === 'comparar' && (
        <>
          {/* Period selector */}
          <div style={{ background: 'var(--vt-ink)', borderRadius: 2, padding: '1rem 1.1rem', marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <div style={{ fontSize: '0.68rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#888', fontWeight: 700 }}>
                PERÍODOS A COMPARAR
                <span style={{ color: '#555', fontWeight: 400, marginLeft: '0.5rem' }}>
                  (click para agregar/quitar · máx {MAX_CMP})
                </span>
              </div>
              {cmpPeriods.length > 0 && (
                <button onClick={() => setCmpPeriods([])}
                  style={{ padding: '0.2rem 0.625rem', fontSize: '0.65rem', cursor: 'pointer', border: '1px solid #3a2a2a', color: '#c23b22', background: 'transparent', borderRadius: 2 }}>
                  × Limpiar
                </button>
              )}
            </div>

            {/* Selected period chips */}
            {cmpPeriods.length > 0 && (
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.75rem', paddingBottom: '0.75rem', borderBottom: '1px solid #1a1a1a' }}>
                {cmpPeriods.map((p, i) => {
                  const col = CMP_COLORS[i % CMP_COLORS.length]
                  return (
                    <div key={p} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.625rem', borderRadius: 2, fontSize: '0.72rem', border: `1px solid ${col}`, color: col, background: col + '18' }}>
                      <span style={{ fontWeight: 700, minWidth: 14 }}>{i+1}</span>
                      {labelPeriod(p)}
                      <span onClick={() => togglePeriod(p)} style={{ cursor: 'pointer', opacity: 0.7, marginLeft: 2, fontSize: '0.88rem' }}>×</span>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Year selectors */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {/* Full years */}
              <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.68rem', color: '#555', minWidth: 45, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Año:</span>
                {allYears.map(y => {
                  const key = `todo-${y}`
                  const selIdx = cmpPeriods.indexOf(key)
                  const isSel = selIdx >= 0
                  const col = isSel ? CMP_COLORS[selIdx % CMP_COLORS.length] : ''
                  return (
                    <div key={key} onClick={() => togglePeriod(key)}
                      style={{ padding: '0.25rem 0.625rem', borderRadius: 2, fontSize: '0.72rem', cursor: 'pointer', border: `1px solid ${isSel ? col : 'var(--vt-border)'}`, color: isSel ? col : '#888', background: isSel ? col+'18' : 'transparent', fontWeight: isSel ? 700 : 400, transition: 'all .12s' }}>
                      Todo {y}{isSel ? ' ✓' : ''}
                    </div>
                  )
                })}
              </div>
              {/* Months by year */}
              {allYears.map(y => (
                <div key={y} style={{ display: 'flex', gap: '0.25rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.68rem', color: '#444', minWidth: 45, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{y}:</span>
                  {allMonths.filter(m => m.startsWith(String(y))).map(key => {
                    const [, mo] = key.split('-')
                    const MSHORT = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
                    const selIdx = cmpPeriods.indexOf(key)
                    const isSel = selIdx >= 0
                    const col = isSel ? CMP_COLORS[selIdx % CMP_COLORS.length] : ''
                    return (
                      <div key={key} onClick={() => togglePeriod(key)}
                        style={{ padding: '0.2rem 0.5rem', borderRadius: 2, fontSize: '0.68rem', cursor: 'pointer', border: `1px solid ${isSel ? col : 'var(--vt-border)'}`, color: isSel ? col : '#888', background: isSel ? col+'18' : 'transparent', fontWeight: isSel ? 700 : 400, transition: 'all .12s' }}>
                        {MSHORT[Number(mo)-1]}{isSel ? ' ✓' : ''}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>

          {cmpPeriods.length < 2 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#888', fontSize: '0.85rem' }}>
              Seleccioná al menos <strong style={{ color: 'var(--vt-paper)' }}>2 períodos</strong> para comparar.<br />
              <span style={{ fontSize: '0.72rem', color: '#555' }}>Podés elegir hasta {MAX_CMP} períodos simultáneamente.</span>
            </div>
          ) : (
            <>
              {/* KPI comparison table */}
              <div style={{ background: 'var(--vt-ink)', borderRadius: 2, marginBottom: '1.25rem', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', minWidth: 400 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #222' }}>
                      <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', fontSize: '0.65rem', color: '#555', fontWeight: 400, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                        Métrica
                      </th>
                      {cmpData.map((c, i) => (
                        <th key={c.key} style={{ textAlign: 'right', padding: '0.5rem 0.75rem', fontSize: '0.65rem', color: CMP_COLORS[i % CMP_COLORS.length], fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {labelPeriod(c.key)}
                        </th>
                      ))}
                      {cmpData.length > 1 && (
                        <th style={{ textAlign: 'right', padding: '0.5rem 0.75rem', fontSize: '0.65rem', color: '#555', fontWeight: 400 }}>vs ①</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { label: 'Total ventas', fn: (c: typeof cmpData[0]) => c.total },
                      { label: 'Bebidas', fn: (c: typeof cmpData[0]) => c.beb },
                      { label: 'Comidas', fn: (c: typeof cmpData[0]) => c.com },
                      { label: 'Ticket/item', fn: (c: typeof cmpData[0]) => c.uds > 0 ? c.total / c.uds : 0 },
                    ].map(row => {
                      const vals = cmpData.map(c => row.fn(c))
                      const base = vals[0]
                      return (
                        <tr key={row.label} style={{ borderBottom: '1px solid #111' }}>
                          <td style={{ padding: '0.5rem 0.75rem', color: '#aaa', fontWeight: 600 }}>{row.label}</td>
                          {vals.map((v, i) => (
                            <td key={i} style={{ padding: '0.5rem 0.75rem', textAlign: 'right', color: CMP_COLORS[i % CMP_COLORS.length], fontWeight: 700, whiteSpace: 'nowrap' }}>
                              {fi(v)}
                            </td>
                          ))}
                          {cmpData.length > 1 && (
                            <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                              {vals.slice(1).map((v, i) => {
                                if (!base) return <span key={i} style={{ color: '#444' }}>—</span>
                                const pct = (v - base) / Math.abs(base) * 100
                                const col = pct > 0 ? '#7ec8a0' : pct < 0 ? '#c23b22' : '#888'
                                return <span key={i} style={{ color: col, fontSize: '0.72rem', fontWeight: 700, marginLeft: i > 0 ? '0.4rem' : 0 }}>
                                  {pct >= 0 ? '▲ +' : '▼ '}{pct.toFixed(1)}%
                                </span>
                              })}
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Multi-period product table */}
              <div className="vt-tbl-wrap">
                <table className="vt-tbl" style={{ minWidth: `${300 + cmpData.length * 130}px` }}>
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th>Tipo</th>
                      {cmpData.map((c, i) => (
                        <th key={c.key} className="r" style={{ color: CMP_COLORS[i % CMP_COLORS.length] }}>
                          {labelPeriod(c.key)}
                        </th>
                      ))}
                      {cmpData.length > 1 && <th className="r" style={{ color: '#555' }}>Var%</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      // Group master prods by tipo → clas
                      const grouped: Record<string, string[]> = {}
                      masterProds.forEach(n => {
                        const info = pm[n]
                        const tipo = info?.tipo ?? 'desconocido'
                        if (!grouped[tipo]) grouped[tipo] = []
                        grouped[tipo].push(n)
                      })
                      const rows: ReactElement[] = []
                      TIPO_ORDER.filter(t => grouped[t]).forEach(tipo => {
                        // Tipo header
                        const tipoVals = cmpData.map(c =>
                          grouped[tipo].reduce((s, n) => s + (c.pm[n]?.monto ?? 0), 0)
                        )
                        rows.push(
                          <tr key={`tipo-${tipo}`} style={{ background: 'var(--vt-ink)' }}>
                            <td colSpan={2} style={{ padding: '0.4rem 0.75rem', fontSize: '0.65rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--vt-gold)', fontWeight: 700 }}>
                              {tipo.toUpperCase()}
                            </td>
                            {tipoVals.map((v, i) => (
                              <td key={i} className="r" style={{ color: CMP_COLORS[i % CMP_COLORS.length], fontWeight: 700 }}>
                                {fi(v)}
                              </td>
                            ))}
                            {cmpData.length > 1 && (() => {
                              const pct = tipoVals[0] ? (tipoVals[1] - tipoVals[0]) / tipoVals[0] * 100 : null
                              return <td className="r" style={{ color: pct !== null ? (pct >= 0 ? '#7ec8a0' : '#c23b22') : '#555', fontSize: '0.72rem', fontWeight: 700 }}>
                                {pct !== null ? (pct >= 0 ? '▲ +' : '▼ ') + pct.toFixed(1) + '%' : '—'}
                              </td>
                            })()}
                          </tr>
                        )
                        // Products sorted by first period monto
                        const sorted = grouped[tipo].sort((a, b) =>
                          (cmpData[0]?.pm[b]?.monto ?? 0) - (cmpData[0]?.pm[a]?.monto ?? 0)
                        )
                        sorted.forEach(n => {
                          const vals = cmpData.map(c => c.pm[n]?.monto ?? 0)
                          if (vals.every(v => v === 0)) return
                          const info = pm[n]
                          rows.push(
                            <tr key={n}>
                              <td style={{ fontSize: '0.78rem', fontWeight: 500, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {n}
                              </td>
                              <td>
                                {info && <span className={`vt-prod-tipo ${info.tipo}`} style={{ fontSize: '0.58rem' }}>{info.tipo}</span>}
                              </td>
                              {vals.map((v, i) => (
                                <td key={i} className="r" style={{ fontSize: '0.8rem', color: v > 0 ? 'var(--vt-ink)' : '#555' }}>
                                  {v > 0 ? fi(v) : '—'}
                                </td>
                              ))}
                              {cmpData.length > 1 && (() => {
                                const base = vals[0]
                                if (!base) return <td className="r" style={{ color: '#555' }}>—</td>
                                return (
                                  <td className="r" style={{ fontSize: '0.72rem' }}>
                                    {vals.slice(1).map((v, i) => {
                                      const pct = (v - base) / base * 100
                                      const col = pct > 5 ? '#7ec8a0' : pct < -5 ? '#c23b22' : '#888'
                                      return <span key={i} style={{ color: col, fontWeight: 700, marginLeft: i > 0 ? '0.3rem' : 0 }}>
                                        {pct >= 0 ? '+' : ''}{pct.toFixed(0)}%
                                      </span>
                                    })}
                                  </td>
                                )
                              })()}
                            </tr>
                          )
                        })
                      })
                      return rows
                    })()}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
