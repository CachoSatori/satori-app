import { useState, useMemo } from 'react'
import type { CashMovement, CashSession } from '../../shared/types/database'
import type { MovementType } from '../../shared/types/database'
import { MOVEMENT_LABELS, EGRESO_TYPES, isEgreso, fi } from './cashUtils'

interface Props {
  movements: CashMovement[]
  sessions:  CashSession[]
}

export default function CashResumen({ movements, sessions }: Props) {
  // ── Month filter ────────────────────────────────────────────
  const availableMonths = useMemo(() => {
    const months = new Set<string>()
    sessions.forEach(s => { if (s.session_date) months.add(s.session_date.slice(0, 7)) })
    return [...months].sort().reverse()
  }, [sessions])

  const [selMonth, setSelMonth] = useState<string>('all')

  const MN = ['','Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
  function fmtMonth(ym: string) {
    const [y, m] = ym.split('-')
    return `${MN[Number(m)]} ${y}`
  }

  // ── Filter movements by month ───────────────────────────────
  const filteredSessions  = useMemo(() =>
    selMonth === 'all' ? sessions : sessions.filter(s => s.session_date?.startsWith(selMonth)),
  [sessions, selMonth])

  const filteredSessionIds = useMemo(() => new Set(filteredSessions.map(s => s.id)), [filteredSessions])

  const filteredMovements = useMemo(() =>
    movements.filter(m => filteredSessionIds.has(m.session_id) && m.status !== 'rechazado'),
  [movements, filteredSessionIds])

  // ── Totals ──────────────────────────────────────────────────
  const totalIngresos  = filteredMovements.filter(m => m.movement_type === 'ingreso').reduce((s, m) => s + m.amount_crc, 0)
  const totalEgresos   = filteredMovements.filter(m => isEgreso(m.movement_type as MovementType)).reduce((s, m) => s + m.amount_crc, 0)
  const resultado      = totalIngresos - totalEgresos
  const totalPendiente = movements.filter(m => filteredSessionIds.has(m.session_id) && m.status === 'pendiente').reduce((s, m) => s + m.amount_crc, 0)

  // By movement type
  const byType: Record<string, { crc: number; usd: number }> = {}
  filteredMovements.forEach(m => {
    const label = MOVEMENT_LABELS[m.movement_type as MovementType] ?? m.movement_type
    if (!byType[label]) byType[label] = { crc: 0, usd: 0 }
    byType[label].crc += m.amount_crc
    byType[label].usd += m.amount_usd
  })

  // Egresos by subcategory — shows where money actually goes
  const egresosBySubcat = useMemo(() => {
    const r: Record<string, number> = {}
    filteredMovements
      .filter(m => isEgreso(m.movement_type as MovementType) && m.amount_crc > 0)
      .forEach(m => {
        const k = m.subcategory?.trim() || m.movement_type
        r[k] = (r[k] ?? 0) + m.amount_crc
      })
    return Object.entries(r).sort((a, b) => b[1] - a[1])
  }, [filteredMovements])

  // Ingresos by method (Efectivo, Transferencia, SINPE, Bitcoin)
  const ingresosByMethod = useMemo(() => {
    const r: Record<string, number> = {}
    filteredMovements
      .filter(m => m.movement_type === 'ingreso' && m.amount_crc > 0)
      .forEach(m => {
        const k = m.method?.trim() || 'Efectivo'
        r[k] = (r[k] ?? 0) + m.amount_crc
      })
    return Object.entries(r).sort((a, b) => b[1] - a[1])
  }, [filteredMovements])

  // Monthly trend (last 6 months)
  const monthlyTrend = useMemo(() => {
    return availableMonths.slice(0, 6).map(ym => {
      const monthSessions = new Set(sessions.filter(s => s.session_date?.startsWith(ym)).map(s => s.id))
      const monthMovs = movements.filter(m => monthSessions.has(m.session_id) && m.status !== 'rechazado')
      const ing = monthMovs.filter(m => m.movement_type === 'ingreso').reduce((s, m) => s + m.amount_crc, 0)
      const egr = monthMovs.filter(m => isEgreso(m.movement_type as MovementType)).reduce((s, m) => s + m.amount_crc, 0)
      return { ym, ing, egr, neto: ing - egr }
    })
  }, [availableMonths, sessions, movements])

  const closed = filteredSessions.filter(s => s.status === 'closed')
  const ingresoTypes: MovementType[] = ['ingreso']
  const egresoTypes:  MovementType[] = EGRESO_TYPES

  return (
    <div className="cd-resumen">

      {/* Month filter */}
      {availableMonths.length > 1 && (
        <div style={{ display:'flex', gap:'0.4rem', flexWrap:'wrap', marginBottom:'1.25rem', alignItems:'center' }}>
          <span style={{ fontSize:'0.68rem', color:'#888', letterSpacing:'0.1em', textTransform:'uppercase' }}>Período:</span>
          <button
            onClick={() => setSelMonth('all')}
            style={{ padding:'4px 12px', borderRadius:2, fontSize:'0.72rem', cursor:'pointer', border:`1px solid ${selMonth==='all'?'#c8a96e':'#2a2a2a'}`, background: selMonth==='all'?'rgba(200,169,110,.12)':'transparent', color: selMonth==='all'?'#c8a96e':'#888' }}>
            Todo
          </button>
          {availableMonths.map(ym => (
            <button key={ym}
              onClick={() => setSelMonth(ym)}
              style={{ padding:'4px 10px', borderRadius:2, fontSize:'0.72rem', cursor:'pointer', border:`1px solid ${selMonth===ym?'#c8a96e':'#2a2a2a'}`, background: selMonth===ym?'rgba(200,169,110,.12)':'transparent', color: selMonth===ym?'#c8a96e':'#888' }}>
              {fmtMonth(ym)}
            </button>
          ))}
        </div>
      )}

      {/* Summary bar */}
      <div className="cd-saldos-bar" style={{ marginBottom: '1.5rem' }}>
        <div className="cd-saldo-card" style={{ borderLeftColor: '#27874f' }}>
          <div className="cd-saldo-label">Total Ingresos</div>
          <div className="cd-saldo-val" style={{ color: '#27874f' }}>{fi(totalIngresos)}</div>
        </div>
        <div className="cd-saldo-card" style={{ borderLeftColor: '#c0392b' }}>
          <div className="cd-saldo-label">Total Egresos</div>
          <div className="cd-saldo-val" style={{ color: '#c0392b' }}>{fi(totalEgresos)}</div>
        </div>
        <div className="cd-saldo-card" style={{ borderLeftColor: resultado >= 0 ? '#27874f' : '#c0392b' }}>
          <div className="cd-saldo-label">Resultado</div>
          <div className="cd-saldo-val" style={{ color: resultado >= 0 ? '#27874f' : '#c0392b' }}>
            {resultado >= 0 ? '+' : ''}{fi(resultado)}
          </div>
        </div>
        <div className="cd-saldo-card" style={{ borderLeftColor: totalPendiente > 0 ? '#c8a030' : '#444' }}>
          <div className="cd-saldo-label">Pendientes</div>
          <div className="cd-saldo-val" style={{ color: totalPendiente > 0 ? '#c8a030' : '#555', fontSize: totalPendiente > 0 ? '17px' : '13px' }}>
            {totalPendiente > 0 ? fi(totalPendiente) : 'Sin pendientes'}
          </div>
        </div>
      </div>

      {/* Ingresos */}
      <div className="cd-resumen-section">
        <div className="cd-resumen-section-hdr">INGRESOS</div>
        {ingresoTypes.map(t => {
          const label = MOVEMENT_LABELS[t]
          const d = byType[label]
          if (!d || d.crc === 0) return null
          return (
            <div key={t} className="cd-resumen-row">
              <span>{label}</span>
              <span className="cd-resumen-val pos">{fi(d.crc)}</span>
            </div>
          )
        })}
        {/* Breakdown by method */}
        {ingresosByMethod.length > 1 && (
          <div style={{ marginTop:'0.4rem', paddingLeft:'0.75rem' }}>
            {ingresosByMethod.map(([method, amt]) => (
              <div key={method} style={{ display:'flex', justifyContent:'space-between', fontSize:'0.75rem', color:'#666', padding:'2px 0', borderBottom:'1px solid #111' }}>
                <span>{method}</span>
                <span>{fi(amt)} · {totalIngresos > 0 ? (amt/totalIngresos*100).toFixed(1) : 0}%</span>
              </div>
            ))}
          </div>
        )}
        <div className="cd-resumen-row total">
          <span>TOTAL INGRESOS</span>
          <span className="cd-resumen-val">{fi(totalIngresos)}</span>
        </div>
      </div>

      {/* Egresos — with subcategory breakdown */}
      <div className="cd-resumen-section" style={{ marginTop: '1rem' }}>
        <div className="cd-resumen-section-hdr">EGRESOS</div>
        {egresoTypes.map(t => {
          const label = MOVEMENT_LABELS[t]
          const d = byType[label]
          if (!d || d.crc === 0) return null
          return (
            <div key={t} className="cd-resumen-row">
              <span>{label}</span>
              <span className="cd-resumen-val neg">{fi(d.crc)}</span>
            </div>
          )
        })}
        {/* Subcategory breakdown */}
        {egresosBySubcat.length > 0 && (
          <div style={{ marginTop:'0.5rem' }}>
            <div style={{ fontSize:'0.62rem', letterSpacing:'0.12em', textTransform:'uppercase', color:'#444', marginBottom:'0.3rem', paddingLeft:'0.5rem' }}>Por categoría</div>
            {egresosBySubcat.map(([subcat, amt]) => {
              const pct = totalEgresos > 0 ? amt / totalEgresos * 100 : 0
              return (
                <div key={subcat} style={{ padding:'0.3rem 0.5rem', display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #0f0f0f' }}>
                  <span style={{ fontSize:'0.78rem', color:'#aaa' }}>{subcat}</span>
                  <div style={{ display:'flex', alignItems:'center', gap:'0.75rem' }}>
                    {/* Mini bar */}
                    <div style={{ width:60, height:4, background:'#1a1a1a', borderRadius:2, overflow:'hidden' }}>
                      <div style={{ height:'100%', width:`${Math.min(pct,100)}%`, background:'#c0392b', borderRadius:2 }}/>
                    </div>
                    <span style={{ fontSize:'0.75rem', color:'#c0392b', fontWeight:600, minWidth:45, textAlign:'right' }}>{fi(amt)}</span>
                    <span style={{ fontSize:'0.65rem', color:'#555', minWidth:32, textAlign:'right' }}>{pct.toFixed(1)}%</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <div className="cd-resumen-row total">
          <span>TOTAL EGRESOS</span>
          <span className="cd-resumen-val neg">{fi(totalEgresos)}</span>
        </div>
      </div>

      {/* Resultado */}
      <div className={`cd-resumen-resultado ${resultado >= 0 ? 'pos' : 'neg'}`}>
        <span>RESULTADO NETO</span>
        <span>{resultado >= 0 ? '+' : ''}{fi(resultado)}</span>
      </div>

      {/* Monthly trend table */}
      {monthlyTrend.length > 1 && (
        <div style={{ marginTop:'1.5rem' }}>
          <div className="cd-resumen-section-hdr" style={{ marginBottom:'0.5rem' }}>TENDENCIA MENSUAL</div>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.8rem' }}>
            <thead>
              <tr style={{ borderBottom:'1px solid #1a1a1a' }}>
                <th style={{ textAlign:'left', padding:'0.4rem 0.5rem', fontSize:'0.65rem', color:'#555', fontWeight:400, textTransform:'uppercase', letterSpacing:'0.1em' }}>Mes</th>
                <th style={{ textAlign:'right', padding:'0.4rem 0.5rem', fontSize:'0.65rem', color:'#27874f', fontWeight:400 }}>Ingresos</th>
                <th style={{ textAlign:'right', padding:'0.4rem 0.5rem', fontSize:'0.65rem', color:'#c0392b', fontWeight:400 }}>Egresos</th>
                <th style={{ textAlign:'right', padding:'0.4rem 0.5rem', fontSize:'0.65rem', color:'#888', fontWeight:400 }}>Neto</th>
              </tr>
            </thead>
            <tbody>
              {monthlyTrend.map(m => (
                <tr key={m.ym} style={{ borderBottom:'1px solid #111', background: m.ym === selMonth ? 'rgba(200,169,110,.05)' : undefined }}>
                  <td style={{ padding:'0.4rem 0.5rem', color: m.ym === selMonth ? '#c8a96e' : '#888', fontWeight: m.ym === selMonth ? 700 : 400 }}>{fmtMonth(m.ym)}</td>
                  <td style={{ padding:'0.4rem 0.5rem', textAlign:'right', color:'#27874f' }}>{fi(m.ing)}</td>
                  <td style={{ padding:'0.4rem 0.5rem', textAlign:'right', color:'#c0392b' }}>{fi(m.egr)}</td>
                  <td style={{ padding:'0.4rem 0.5rem', textAlign:'right', color: m.neto >= 0 ? '#27874f' : '#c0392b', fontWeight:700 }}>
                    {m.neto >= 0 ? '+' : ''}{fi(m.neto)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Turnos table */}
      {closed.length > 0 && (
        <div style={{ marginTop: '1.5rem' }}>
          <div className="cd-resumen-section-hdr" style={{ marginBottom: '0.5rem' }}>TURNOS CERRADOS ({closed.length})</div>
          {closed.map(s => {
            const movs = movements.filter(m => m.session_id === s.id && m.status !== 'rechazado')
            const ing  = movs.filter(m => m.movement_type === 'ingreso').reduce((a, m) => a + m.amount_crc, 0)
            const egr  = movs.filter(m => isEgreso(m.movement_type as MovementType)).reduce((a, m) => a + m.amount_crc, 0)
            const hasFinal = s.final_cash_crc != null || s.final_safe_crc != null || s.final_bank_crc != null
            return (
              <div key={s.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.07)', paddingBottom: '0.75rem', marginBottom: '0.75rem' }}>
                <div className="cd-resumen-row" style={{ marginBottom: hasFinal ? '0.4rem' : 0 }}>
                  <div>
                    <span style={{ fontWeight: 600 }}>{s.session_date}</span>
                    <span style={{ color: '#888', marginLeft: '0.5rem', fontSize: '0.8rem' }}>
                      {s.shift_type} · {s.cajero_name}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                    <span style={{ color: '#27874f', fontSize: '0.85rem' }}>+{fi(ing)}</span>
                    <span style={{ color: '#c0392b', fontSize: '0.85rem' }}>-{fi(egr)}</span>
                  </div>
                </div>
                {hasFinal && (
                  <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', paddingLeft: '0.5rem', fontSize: '0.72rem' }}>
                    {[
                      { label: 'Caja inicial', val: s.initial_cash_crc, color: '#5a5040' },
                      { label: 'Final registradora', val: s.final_cash_crc, color: '#5a5040' },
                      { label: 'Caja fuerte', val: s.final_safe_crc, color: 'var(--t-teal)' },
                      { label: 'Depósito banco', val: s.final_bank_crc, color: 'var(--t-teal)' },
                    ].filter(k => k.val != null && k.val > 0).map(k => (
                      <span key={k.label} style={{ color: k.color }}>
                        {k.label}: <strong>{fi(k.val!)}</strong>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
