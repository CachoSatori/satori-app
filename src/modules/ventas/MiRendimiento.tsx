/**
 * MiRendimiento — Vista personal para saloneros
 * Accessible at /mi-rendimiento for roles: salonero, barman, barback, runner, cocina
 *
 * Tabs:
 *   Hoy      — today's personal stats vs general average
 *   Historial — last 60 days trend: promPax, bebPax, ratioCB
 *   Semana   — current week + last 4 weeks comparison
 */
import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../shared/hooks/useAuth'
import type { DiasMap, ProductMap } from '../../shared/types/ventas'
import {
  aggSalonero, aggGeneral, allSaloneros, allDates,
  fi, fmtDate,
  topProds, ratioCBClass,
} from './ventasUtils'
import { todayCR } from '../../shared/utils'

interface Props { dias: DiasMap; pm: ProductMap }

type Tab = 'hoy' | 'historial' | 'semana'

const DAYS_SHORT = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb']

export default function MiRendimiento({ dias, pm }: Props) {
  const { profile } = useAuth()
  const navigate    = useNavigate()
  const [tab, setTab] = useState<Tab>('hoy')

  const allSals  = useMemo(() => allSaloneros(dias), [dias])
  const dates    = useMemo(() => allDates(dias), [dias])
  const today    = todayCR()

  // Try to match profile name to a salonero key
  const inferredName = useMemo(() => {
    if (!profile?.full_name) return null
    const firstName = profile.full_name.split(' ')[0].toUpperCase()
    // Exact match first
    const exact = allSals.find(n => n.toUpperCase() === profile.full_name.toUpperCase())
    if (exact) return exact
    // First-name match
    const byFirst = allSals.find(n => n.toUpperCase().startsWith(firstName))
    return byFirst ?? null
  }, [profile, allSals])

  const [salName, setSalName] = useState<string>('')
  const activeName = salName || inferredName || ''

  if (!activeName && allSals.length === 0) {
    return (
      <div className="vt-empty">
        <div className="vt-empty-icon">👤</div>
        <div className="vt-empty-title">Sin datos de saloneros</div>
        <div className="vt-empty-sub">Cargá los XLS del turno para ver tu rendimiento</div>
      </div>
    )
  }

  // ── Data for the active salonero ─────────────────────────────
  const todayAgg = useMemo(() =>
    activeName ? aggSalonero(activeName, dates.filter(d => d === today), dias, pm) : null,
  [activeName, dates, dias, pm, today])

  const genToday = useMemo(() =>
    aggGeneral(dates.filter(d => d === today), dias, pm),
  [dates, dias, pm, today])

  const last60 = useMemo(() => {
    const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - 60)
    const cutStr = cutoff.toISOString().slice(0, 10)
    return dates.filter(d => d >= cutStr && d <= today)
  }, [dates, today])

  const histData = useMemo(() => {
    if (!activeName) return []
    return last60
      .map(date => {
        const s = aggSalonero(activeName, [date], dias, pm)
        const g = aggGeneral([date], dias, pm)
        if (s.days === 0) return null
        const dow = new Date(date + 'T12:00:00').getDay()
        return { date, dow, promPax: s.promPax, bebPax: s.bebPax, ratioCB: s.ratioCB, total: s.total, pax: s.pax, genPromPax: g.promPax }
      })
      .filter(Boolean) as Array<{ date: string; dow: number; promPax: number; bebPax: number; ratioCB: number; total: number; pax: number; genPromPax: number }>
  }, [activeName, last60, dias, pm])

  // Week data: current week + 4 previous weeks
  const weekData = useMemo(() => {
    if (!activeName) return []
    const weeks: Array<{ label: string; dates: string[]; promPax: number; bebPax: number; total: number; pax: number; days: number }> = []
    // Get monday of current week
    const now = new Date(today + 'T12:00:00')
    const dayOfWeek = now.getDay()
    const monday = new Date(now)
    monday.setDate(monday.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1))

    for (let w = 0; w < 5; w++) {
      const from = new Date(monday); from.setDate(from.getDate() - w * 7)
      const to   = new Date(from);   to.setDate(to.getDate() + 6)
      const fromStr = from.toISOString().slice(0, 10)
      const toStr   = to.toISOString().slice(0, 10)
      const wDates  = dates.filter(d => d >= fromStr && d <= toStr)
      const agg     = aggSalonero(activeName, wDates, dias, pm)
      if (w === 0 || agg.days > 0) {
        const label = w === 0 ? 'Esta semana' : w === 1 ? 'Semana pasada' : `Hace ${w} semanas`
        weeks.push({ label, dates: wDates, promPax: agg.promPax, bebPax: agg.bebPax, total: agg.total, pax: agg.pax, days: agg.days })
      }
    }
    return weeks
  }, [activeName, dates, dias, pm, today])

  const top5Today = useMemo(() =>
    todayAgg ? topProds(todayAgg.prods, 'monto', 5, undefined, pm) : [],
  [todayAgg, pm])

  // Max promPax for mini bar chart
  const maxPromPax = Math.max(...histData.map(d => d.promPax), 1)

  return (
    <div className="vt-module">
      {/* Header */}
      <div className="vt-module-header">
        <div style={{ display:'flex', alignItems:'center', gap:'0.75rem' }}>
          <span style={{ fontFamily:'var(--font-serif)', fontSize:'1.5rem', color:'var(--vt-gold)' }}>人</span>
          <div>
            <div style={{ fontFamily:'Syne,var(--font-serif)', fontSize:'0.9rem', fontWeight:800, color:'var(--vt-gold)', letterSpacing:'0.1em' }}>
              MI RENDIMIENTO
            </div>
            <div style={{ fontSize:'0.6rem', letterSpacing:'0.3em', color:'#444', textTransform:'uppercase' }}>
              Satori · {activeName || 'Salonero'}
            </div>
          </div>
        </div>
        <div style={{ display:'flex', gap:'0.5rem', alignItems:'center' }}>
          {/* Name selector — if auto-match failed */}
          {(!inferredName || allSals.length > 1) && (
            <select
              value={activeName}
              onChange={e => setSalName(e.target.value)}
              style={{ background:'#1a1a1a', border:'1px solid #333', color:'#c8a96e', padding:'4px 8px', borderRadius:2, fontSize:'0.78rem' }}>
              {!inferredName && <option value="">— Seleccioná tu nombre —</option>}
              {allSals.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          )}
          <button className="cash-back-btn" style={{ borderColor:'#333', color:'#888' }}
            onClick={() => navigate('/')}>← Inicio</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="vt-nav-tabs">
        {([
          { id:'hoy',      label:'🌅 Hoy' },
          { id:'historial',label:'📈 Historial' },
          { id:'semana',   label:'📅 Semana' },
        ] as const).map(t => (
          <div key={t.id}
            className={`vt-nav-tab ${tab === t.id ? 'active' : ''}`}
            style={tab === t.id ? { borderBottomColor:'var(--vt-gold)', color:'var(--vt-gold)' } : {}}
            onClick={() => setTab(t.id)}>
            {t.label}
          </div>
        ))}
      </div>

      {!activeName ? (
        <div style={{ padding:'3rem', textAlign:'center', color:'#555' }}>
          Seleccioná tu nombre arriba para ver tu rendimiento.
        </div>
      ) : (
        <div className="vt-content">

          {/* ══ HOY ══ */}
          {tab === 'hoy' && (
            <div className="vt-section">
              <div className="vt-sl">{fmtDate(today)} — {activeName}</div>

              {!todayAgg || todayAgg.days === 0 ? (
                <div style={{ padding:'2rem', textAlign:'center', color:'#666', fontSize:'0.85rem' }}>
                  Sin datos para hoy. El turno puede no estar cargado aún.
                </div>
              ) : (
                <>
                  {/* My KPIs vs General */}
                  <div className="vt-kpi-grid">
                    {[
                      { label:'Ventas', mine: todayAgg.total,   gen: genToday.total,   fmt: fi,             color:'var(--vt-gold)' },
                      { label:'PAX',    mine: todayAgg.pax,     gen: genToday.pax,     fmt:(v:number)=>String(Math.round(v)), color:'#aaa' },
                      { label:'Prom/PAX', mine: todayAgg.promPax, gen: genToday.promPax, fmt: fi,           color:'var(--vt-gold)' },
                      { label:'Beb/PAX',  mine: todayAgg.bebPax,  gen: genToday.bebPax,  fmt:(v:number)=>v.toFixed(2), color:'#7ec8a0' },
                    ].map(k => {
                      const diff = k.mine - k.gen
                      const pct  = k.gen > 0 ? diff / k.gen * 100 : 0
                      const col  = diff >= 0 ? 'var(--vt-green)' : 'var(--vt-red)'
                      return (
                        <div key={k.label} className="vt-kpi">
                          <div className="vt-kpi-label">{k.label}</div>
                          <div className="vt-kpi-val" style={{ color: k.color }}>{k.fmt(k.mine)}</div>
                          {k.gen > 0 && (
                            <div style={{ fontSize:'0.65rem', color:col, marginTop:2 }}>
                              {diff >= 0 ? '▲ +' : '▼ '}{Math.abs(pct).toFixed(1)}% vs general
                            </div>
                          )}
                        </div>
                      )
                    })}
                    <div className="vt-kpi">
                      <div className="vt-kpi-label">Ratio C/B</div>
                      <div className={`vt-kpi-val ${ratioCBClass(todayAgg.ratioCB)}`}>{todayAgg.ratioCB.toFixed(2)}:1</div>
                      <div className="vt-kpi-sub">ideal 2.5–4.5</div>
                    </div>
                    <div className="vt-kpi">
                      <div className="vt-kpi-label">Ticket/item</div>
                      <div className="vt-kpi-val">{fi(todayAgg.promTicket)}</div>
                      {genToday.promTicket > 0 && (
                        <div style={{ fontSize:'0.65rem', color: todayAgg.promTicket >= genToday.promTicket ? 'var(--vt-green)' : 'var(--vt-red)', marginTop:2 }}>
                          {todayAgg.promTicket >= genToday.promTicket ? '▲' : '▼'} vs {fi(genToday.promTicket)} gral
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Top 5 productos del día */}
                  {top5Today.length > 0 && (
                    <>
                      <div className="vt-sl">Top productos de hoy</div>
                      <div className="vt-prod-list">
                        {top5Today.map((p, i) => (
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
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {/* ══ HISTORIAL ══ */}
          {tab === 'historial' && (
            <div className="vt-section">
              <div className="vt-sl">Últimos 60 días — {activeName}</div>

              {histData.length === 0 ? (
                <div style={{ padding:'2rem', textAlign:'center', color:'#666', fontSize:'0.85rem' }}>Sin datos en los últimos 60 días.</div>
              ) : (
                <>
                  {/* Stats summary */}
                  {(() => {
                    const avgPP  = histData.reduce((s,d)=>s+d.promPax,0) / histData.length
                    const avgBP  = histData.reduce((s,d)=>s+d.bebPax,0)  / histData.length
                    const totVt  = histData.reduce((s,d)=>s+d.total,0)
                    const totPax = histData.reduce((s,d)=>s+d.pax,0)
                    // Trend: last 10 vs prior 10
                    const last10 = histData.slice(-10)
                    const prev10 = histData.slice(-20, -10)
                    const trend  = prev10.length > 0
                      ? (last10.reduce((s,d)=>s+d.promPax,0)/last10.length) - (prev10.reduce((s,d)=>s+d.promPax,0)/prev10.length)
                      : 0
                    return (
                      <div className="vt-kpi-grid" style={{ marginBottom:'1.5rem' }}>
                        <div className="vt-kpi red">
                          <div className="vt-kpi-label">Ventas totales</div>
                          <div className="vt-kpi-val">{fi(totVt)}</div>
                          <div className="vt-kpi-sub">{histData.length} días trabajados</div>
                        </div>
                        <div className="vt-kpi">
                          <div className="vt-kpi-label">Prom/PAX promedio</div>
                          <div className="vt-kpi-val">{fi(avgPP)}</div>
                        </div>
                        <div className="vt-kpi">
                          <div className="vt-kpi-label">Beb/PAX promedio</div>
                          <div className="vt-kpi-val">{avgBP.toFixed(2)}</div>
                        </div>
                        <div className="vt-kpi">
                          <div className="vt-kpi-label">PAX totales</div>
                          <div className="vt-kpi-val">{totPax.toLocaleString('es-CR')}</div>
                        </div>
                        <div className="vt-kpi" style={{ borderLeftColor: trend >= 0 ? 'var(--vt-green)' : 'var(--vt-red)' }}>
                          <div className="vt-kpi-label">Tendencia (últ. 10 días)</div>
                          <div className="vt-kpi-val" style={{ color: trend >= 0 ? 'var(--vt-green)' : 'var(--vt-red)', fontSize:'0.9rem' }}>
                            {trend >= 0 ? '▲ +' : '▼ '}{fi(Math.abs(trend))}/PAX
                          </div>
                        </div>
                      </div>
                    )
                  })()}

                  {/* Mini bar chart: promPax per worked day */}
                  <div className="vt-sl">Prom/PAX — evolución</div>
                  <div style={{ display:'flex', alignItems:'flex-end', gap:2, height:80, marginBottom:'0.5rem', overflowX:'auto', paddingBottom:4 }}>
                    {histData.map((d, i) => {
                      const h    = Math.round((d.promPax / maxPromPax) * 100)
                      const aboveGen = d.promPax >= d.genPromPax
                      return (
                        <div key={d.date} style={{ display:'flex', flexDirection:'column', alignItems:'center', flex:'0 0 auto', width:16 }}
                          title={`${fmtDate(d.date)}: ${fi(d.promPax)}`}>
                          <div style={{ height:`${h}%`, width:12, borderRadius:'2px 2px 0 0', background: aboveGen ? 'var(--vt-green)' : 'var(--vt-red)', opacity: i === histData.length-1 ? 1 : 0.7 }}/>
                        </div>
                      )
                    })}
                  </div>
                  <div style={{ fontSize:'0.62rem', color:'#444', display:'flex', gap:'0.75rem' }}>
                    <span style={{ color:'var(--vt-green)' }}>■ Por encima del promedio general</span>
                    <span style={{ color:'var(--vt-red)' }}>■ Por debajo del promedio general</span>
                  </div>

                  {/* Daily history table */}
                  <div className="vt-sl" style={{ marginTop:'1.25rem' }}>Detalle por fecha</div>
                  <div className="vt-tbl-wrap">
                    <table className="vt-tbl">
                      <thead>
                        <tr>
                          <th>Fecha</th>
                          <th>Día</th>
                          <th className="r">PAX</th>
                          <th className="r">Ventas</th>
                          <th className="r">Prom/PAX</th>
                          <th className="r">Beb/PAX</th>
                          <th className="r" style={{ fontSize:'0.65rem', color:'#555' }}>vs General</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...histData].reverse().map(d => {
                          const diff = d.promPax - d.genPromPax
                          const col  = diff >= 0 ? 'var(--vt-green)' : 'var(--vt-red)'
                          return (
                            <tr key={d.date}>
                              <td style={{ fontSize:'0.78rem' }}>{fmtDate(d.date)}</td>
                              <td style={{ color:'#666', fontSize:'0.78rem' }}>{DAYS_SHORT[d.dow]}</td>
                              <td className="r">{d.pax}</td>
                              <td className="r vt-bold">{fi(d.total)}</td>
                              <td className="r" style={{ color:'var(--vt-gold)' }}>{fi(d.promPax)}</td>
                              <td className="r">{d.bebPax.toFixed(2)}</td>
                              <td className="r" style={{ color:col, fontSize:'0.72rem', fontWeight:600 }}>
                                {diff >= 0 ? '▲ +' : '▼ '}{Math.abs(diff / d.genPromPax * 100).toFixed(1)}%
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
          )}

          {/* ══ SEMANA ══ */}
          {tab === 'semana' && (
            <div className="vt-section">
              <div className="vt-sl">Por semana — {activeName}</div>
              {weekData.length === 0 ? (
                <div style={{ padding:'2rem', textAlign:'center', color:'#666', fontSize:'0.85rem' }}>Sin datos semanales.</div>
              ) : (
                <>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))', gap:'0.75rem', marginBottom:'1.5rem' }}>
                    {weekData.map((w, i) => (
                      <div key={w.label} style={{ background:'var(--vt-ink)', borderRadius:2, padding:'0.875rem', borderLeft: i===0 ? '3px solid var(--vt-gold)' : '3px solid #222' }}>
                        <div style={{ fontSize:'0.68rem', letterSpacing:'0.1em', textTransform:'uppercase', color: i===0 ? 'var(--vt-gold)' : '#555', marginBottom:'0.5rem', fontWeight:700 }}>
                          {w.label}
                        </div>
                        {w.days > 0 ? (
                          <>
                            <div style={{ fontFamily:'Syne,sans-serif', fontSize:'1rem', fontWeight:800, color:'var(--vt-gold)', marginBottom:4 }}>{fi(w.total)}</div>
                            <div style={{ fontSize:'0.72rem', color:'#888' }}>{w.days} días · {w.pax} PAX</div>
                            <div style={{ fontSize:'0.75rem', color:'#aaa', marginTop:4 }}>
                              {fi(w.promPax)}/PAX · {w.bebPax.toFixed(2)} beb/PAX
                            </div>
                            {i > 0 && weekData[0].promPax > 0 && (
                              <div style={{ fontSize:'0.68rem', marginTop:4, color: weekData[0].promPax >= w.promPax ? 'var(--vt-green)' : 'var(--vt-red)' }}>
                                {weekData[0].promPax >= w.promPax ? '▲ Mejor' : '▼ Peor'} que ahora
                              </div>
                            )}
                          </>
                        ) : (
                          <div style={{ color:'#333', fontSize:'0.78rem' }}>Sin datos</div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Weekly detail table */}
                  <div className="vt-tbl-wrap">
                    <table className="vt-tbl">
                      <thead>
                        <tr>
                          <th>Semana</th>
                          <th className="r">Días</th>
                          <th className="r">PAX</th>
                          <th className="r">Ventas</th>
                          <th className="r">Prom/PAX</th>
                          <th className="r">Beb/PAX</th>
                        </tr>
                      </thead>
                      <tbody>
                        {weekData.filter(w => w.days > 0).map((w, i) => (
                          <tr key={w.label} style={{ fontWeight: i===0 ? 700 : 400 }}>
                            <td style={{ color: i===0 ? 'var(--vt-gold-dark,#a07830)' : undefined }}>{w.label}</td>
                            <td className="r">{w.days}</td>
                            <td className="r">{w.pax}</td>
                            <td className="r vt-bold">{fi(w.total)}</td>
                            <td className="r" style={{ color:'var(--vt-gold)' }}>{fi(w.promPax)}</td>
                            <td className="r">{w.bebPax.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

        </div>
      )}
    </div>
  )
}
