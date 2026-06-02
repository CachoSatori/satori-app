import { useState, useMemo } from 'react'
import { todayCR } from '../../shared/utils'

function addDays(date: string, n: number): string {
  const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() - n + 1)
  return d.toISOString().slice(0, 10)
}
import type { DiasMap, ProductMap, Meta } from '../../shared/types/ventas'
import {
  aggSalonero, aggGeneral, allSaloneros,
  fi, fmtDate, metaColor, getMeta, ratioCBClass,
  topProds, datesInRange, allDates,
} from './ventasUtils'

interface Props {
  dias:  DiasMap
  pm:    ProductMap
  metas: Meta
}

const PRESETS = [
  { label: 'Hoy',        days: 1 },
  { label: '7 días',     days: 7 },
  { label: '15 días',    days: 15 },
  { label: '30 días',    days: 30 },
  { label: 'Todo',       days: 999 },
]




export default function VentasSaloneros({ dias, pm, metas }: Props) {
  const [preset, setPreset] = useState(1)
  const [from, setFrom]     = useState('')
  const [to,   setTo]       = useState(todayCR())
  const [expanded, setExpanded] = useState<string | null>(null)

  const dates = useMemo(() => allDates(dias), [dias])
  const sals  = useMemo(() => allSaloneros(dias), [dias])

  const rangeDates = useMemo(() => {
    if (preset < PRESETS.length - 1) {
      const last = [...dates].pop() ?? todayCR()
      const f = addDays(last, PRESETS[preset].days)
      return datesInRange(dates, f, last)
    }
    return from && to ? datesInRange(dates, from, to) : dates
  }, [dates, preset, from, to])

  const gen = useMemo(() => aggGeneral(rangeDates, dias, pm), [rangeDates, dias, pm])
  const [viewMode, setViewMode] = useState<'cards' | 'tabla'>('cards')
  const [sortCol,  setSortCol]  = useState<string>('promPax')

  const salAggs = useMemo(() => {
    const base = sals.map(n => aggSalonero(n, rangeDates, dias, pm)).filter(s => s.total > 0)
    return base.sort((a, b) => {
      if (sortCol === 'total')    return b.total    - a.total
      if (sortCol === 'pax')      return b.pax      - a.pax
      if (sortCol === 'bebPax')   return b.bebPax   - a.bebPax
      if (sortCol === 'ratioCB')  return b.ratioCB  - a.ratioCB
      if (sortCol === 'promPlato')return b.promPlato - a.promPlato
      if (sortCol === 'ticket')   return b.promTicket - a.promTicket
      return b.promPax - a.promPax
    })
  }, [sals, rangeDates, dias, pm, sortCol])

  const firstDate = rangeDates[0] ?? ''
  const lastDate  = rangeDates[rangeDates.length - 1] ?? ''

  function toggleSort(col: string) { setSortCol(col) }

  return (
    <div className="vt-section">
      {/* Date range controls */}
      <div className="vt-range-bar">
        {PRESETS.slice(0, -1).map((p, i) => (
          <button key={i} className={`vt-range-btn ${preset === i ? 'active' : ''}`}
            onClick={() => setPreset(i)}>
            {p.label}
          </button>
        ))}
        <button className={`vt-range-btn ${preset === PRESETS.length - 1 ? 'active' : ''}`}
          onClick={() => setPreset(PRESETS.length - 1)}>
          Personalizado
        </button>
        {preset === PRESETS.length - 1 && (
          <>
            <input className="vt-date-input" type="date" value={from} onChange={e => setFrom(e.target.value)} />
            <span>→</span>
            <input className="vt-date-input" type="date" value={to} onChange={e => setTo(e.target.value)} />
          </>
        )}
        {firstDate && <span className="vt-range-label">{fmtDate(firstDate)} — {fmtDate(lastDate)}</span>}
      </div>

      {/* General KPIs */}
      <div className="vt-kpi-grid">
        <div className="vt-kpi">
          <div className="vt-kpi-label">Ventas Salón</div>
          <div className="vt-kpi-val">{fi(gen.total)}</div>
          <div className="vt-kpi-sub">{rangeDates.length} días</div>
        </div>
        <div className="vt-kpi">
          <div className="vt-kpi-label">PAX totales</div>
          <div className="vt-kpi-val">{gen.pax.toLocaleString('es-CR')}</div>
        </div>
        <div className="vt-kpi">
          <div className="vt-kpi-label">Prom/PAX general</div>
          <div className="vt-kpi-val">{fi(gen.promPax)}</div>
        </div>
        <div className="vt-kpi">
          <div className="vt-kpi-label">Beb/PAX</div>
          <div className="vt-kpi-val">{gen.bebPax.toFixed(2)}</div>
        </div>
        <div className="vt-kpi">
          <div className="vt-kpi-label">Ratio C/B</div>
          <div className={`vt-kpi-val ${ratioCBClass(gen.ratioCB)}`}>{gen.ratioCB.toFixed(2)}:1</div>
        </div>
      </div>

      {/* View toggle */}
      <div style={{ display:'flex', gap:'0.5rem', alignItems:'center', marginBottom:'0.75rem' }}>
        <div className="vt-tab-group">
          <button className={`vt-tab-btn ${viewMode==='cards'?'active':''}`} onClick={() => setViewMode('cards')}>🃏 Tarjetas</button>
          <button className={`vt-tab-btn ${viewMode==='tabla'?'active':''}`} onClick={() => setViewMode('tabla')}>⊞ Tabla</button>
        </div>
      </div>

      {/* ── TABLA MODE ── */}
      {viewMode === 'tabla' && (
        <div className="vt-tbl-wrap" style={{ marginBottom:'1.5rem' }}>
          <table className="vt-tbl" style={{ fontSize:'0.8rem' }}>
            <thead>
              <tr>
                <th style={{ width:32 }}>#</th>
                <th style={{ textAlign:'left' }}>Salonero</th>
                {[
                  { id:'total',    label:'Ventas' },
                  { id:'pax',      label:'PAX' },
                  { id:'promPax',  label:'Prom/PAX' },
                  { id:'ticket',   label:'Ticket/item' },
                  { id:'bebPax',   label:'Beb/PAX' },
                  { id:'ratioCB',  label:'Ratio C/B' },
                  { id:'promPlato',label:'Prom/plato' },
                ].map(col => (
                  <th key={col.id} className="r"
                    style={{ cursor:'pointer', color: sortCol===col.id ? 'var(--vt-gold)' : undefined, whiteSpace:'nowrap' }}
                    onClick={() => toggleSort(col.id)}>
                    {col.label}{sortCol===col.id ? ' ▼' : ''}
                  </th>
                ))}
                <th className="r" style={{ color:'#555', fontSize:'0.65rem', whiteSpace:'nowrap' }}>vs Gral</th>
              </tr>
            </thead>
            <tbody>
              {salAggs.map((s, i) => {
                const metaPP = getMeta(metas, s.nombre, 'promPax')
                const metaBP = getMeta(metas, s.nombre, 'bebPax')
                const diff   = s.promPax - gen.promPax
                const diffCol = diff >= 0 ? 'var(--vt-green)' : 'var(--vt-red)'
                const pctTot = gen.total > 0 ? s.total / gen.total * 100 : 0
                return (
                  <tr key={s.nombre}>
                    <td style={{ textAlign:'center', fontWeight:700, color: i===0?'var(--vt-gold)':i===1?'#aaa':i===2?'#c8a030':'#555' }}>
                      {i===0?'🥇':i===1?'🥈':i===2?'🥉':i+1}
                    </td>
                    <td>
                      <div style={{ fontWeight:600 }}>{s.nombre}</div>
                      <div style={{ fontSize:'0.65rem', color:'#555' }}>{s.days} días · {pctTot.toFixed(1)}%</div>
                    </td>
                    <td className="r vt-bold">{fi(s.total)}</td>
                    <td className="r">{s.pax}</td>
                    <td className="r" style={{ color: metaColor(s.promPax, metaPP), fontWeight:700 }}>{fi(s.promPax)}</td>
                    <td className="r" style={{ fontSize:'0.75rem' }}>{fi(s.promTicket)}</td>
                    <td className="r" style={{ color: metaColor(s.bebPax, metaBP) }}>{s.bebPax.toFixed(2)}</td>
                    <td className={`r ${ratioCBClass(s.ratioCB)}`}>{s.ratioCB.toFixed(2)}:1</td>
                    <td className="r" style={{ fontSize:'0.75rem' }}>{s.promPlato > 0 ? fi(s.promPlato) : '—'}</td>
                    <td className="r" style={{ color:diffCol, fontSize:'0.72rem', fontWeight:600 }}>
                      {diff >= 0 ? '▲ +' : '▼ '}{Math.abs(diff / gen.promPax * 100).toFixed(1)}%
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="vt-tbl-footer">
                <td colSpan={2}>GENERAL</td>
                <td className="r">{fi(gen.total)}</td>
                <td className="r">{gen.pax}</td>
                <td className="r vt-bold">{fi(gen.promPax)}</td>
                <td className="r" style={{ fontSize:'0.75rem' }}>{fi(gen.promTicket)}</td>
                <td className="r">{gen.bebPax.toFixed(2)}</td>
                <td className={`r ${ratioCBClass(gen.ratioCB)}`}>{gen.ratioCB.toFixed(2)}:1</td>
                <td colSpan={2}/>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Salonero cards */}
      {viewMode === 'cards' && <div className="vt-sal-cards">
        {salAggs.map((s, i) => {
          const metaPP  = getMeta(metas, s.nombre, 'promPax')
          const metaBP  = getMeta(metas, s.nombre, 'bebPax')
          const pctTotal = gen.total > 0 ? s.total / gen.total * 100 : 0
          const vsGen    = s.promPax - gen.promPax
          const isOpen   = expanded === s.nombre
          const top5 = topProds(s.prods, 'monto', 5)

          return (
            <div key={s.nombre} className="vt-sal-card">
              <div className="vt-sal-card-head" onClick={() => setExpanded(isOpen ? null : s.nombre)}>
                <div>
                  <div className="vt-sal-name">
                    {i < 3 && <span className="vt-medal">{i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}</span>}
                    {s.nombre}
                    <span className="vt-sal-days">{s.days} días</span>
                  </div>
                  <div className="vt-sal-total">{fi(s.total)}</div>
                  <div className="vt-pct-bar">
                    <div className="vt-pct-fill" style={{ width: `${Math.min(pctTotal, 100)}%` }} />
                  </div>
                  <div className="vt-sal-pct">{pctTotal.toFixed(1)}% del período</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="vt-vs-gen" style={{ color: vsGen >= 0 ? 'var(--vt-green)' : 'var(--vt-red)' }}>
                    {vsGen >= 0 ? '▲' : '▼'} {fi(Math.abs(vsGen))} vs gral
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#888' }}>{isOpen ? '▲' : '▼'}</div>
                </div>
              </div>

              {/* KPIs row always visible */}
              <div className="vt-sal-kpis">
                <div className="vt-sal-kpi">
                  <div className="vt-sal-kpi-label">Prom/PAX</div>
                  <div className="vt-sal-kpi-val" style={{ color: metaColor(s.promPax, metaPP) }}>
                    {fi(s.promPax)}
                  </div>
                </div>
                <div className="vt-sal-kpi">
                  <div className="vt-sal-kpi-label">PAX</div>
                  <div className="vt-sal-kpi-val">{s.pax}</div>
                </div>
                <div className="vt-sal-kpi">
                  <div className="vt-sal-kpi-label">Beb/PAX</div>
                  <div className="vt-sal-kpi-val" style={{ color: metaColor(s.bebPax, metaBP) }}>
                    {s.bebPax.toFixed(2)}
                  </div>
                </div>
                <div className="vt-sal-kpi">
                  <div className="vt-sal-kpi-label">Ratio C/B</div>
                  <div className={`vt-sal-kpi-val ${ratioCBClass(s.ratioCB)}`}>
                    {s.ratioCB.toFixed(2)}:1
                  </div>
                </div>
              </div>

              {/* Expanded: top 5 */}
              {isOpen && (
                <div className="vt-sal-detail">
                  <div style={{ fontSize: '0.7rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#888', marginBottom: '0.5rem' }}>
                    Top 5 productos
                  </div>
                  {top5.map(p => (
                    <div key={p.nombre} className="vt-sal-prod-row">
                      <span>{p.nombre}</span>
                      <span style={{ fontWeight: 600 }}>{fi(p.m)}</span>
                    </div>
                  ))}
                  <div className="vt-sal-metrics" style={{ marginTop: '0.75rem' }}>
                    <div><span>Prom/plato</span> <strong>{fi(s.promPlato)}</strong></div>
                    <div><span>Prom/bebida</span> <strong>{fi(s.promBebida)}</strong></div>
                    <div><span>Ticket/item</span> <strong>{fi(s.promTicket)}</strong></div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>}
    </div>
  )
}
