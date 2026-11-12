import { useState, useMemo, useEffect } from 'react'
import type { CashMovement, CashSession, CashCierreDia } from '../../shared/types/database'
import type { MovementType } from '../../shared/types/database'
import { MOVEMENT_LABELS, EGRESO_TYPES, isEgreso, fi } from './cashUtils'
import { getCierresDia } from '../../shared/api/cash'
import { computeOverShort } from './cierreStats'

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

  // C2 — Historial de sobrantes/faltantes del cierre. Lee lo YA guardado en
  // cash_cierres_dia (no recalcula). Fetch propio, como CashMovimientos.
  const [cierres, setCierres] = useState<CashCierreDia[]>([])
  useEffect(() => { getCierresDia().then(setCierres).catch(() => {}) }, [])
  const overShort = useMemo(() => computeOverShort(cierres, selMonth), [cierres, selMonth])

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
    movements.filter(m => filteredSessionIds.has(m.session_id ?? '') && m.status !== 'rechazado'),
  [movements, filteredSessionIds])

  // ── Totals ──────────────────────────────────────────────────
  const totalIngresos  = filteredMovements.filter(m => m.movement_type === 'ingreso').reduce((s, m) => s + m.amount_crc, 0)
  const totalEgresos   = filteredMovements.filter(m => isEgreso(m.movement_type as MovementType)).reduce((s, m) => s + m.amount_crc, 0)
  const resultado      = totalIngresos - totalEgresos
  const totalPendiente = movements.filter(m => filteredSessionIds.has(m.session_id ?? '') && m.status === 'pendiente').reduce((s, m) => s + m.amount_crc, 0)

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
      const monthMovs = movements.filter(m => monthSessions.has(m.session_id ?? '') && m.status !== 'rechazado')
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

      {/* Month filter — desplegable estilo Propinas */}
      {availableMonths.length > 1 && (
        <div style={{ display:'flex', gap:'0.5rem', flexWrap:'wrap', marginBottom:'1.25rem', alignItems:'center' }}>
          <span style={{ fontSize:'0.68rem', color:'var(--c-gris)', letterSpacing:'0.1em' }}>Período:</span>
          <select
            className={`date-filter ${selMonth !== 'all' ? 'active' : ''}`}
            value={selMonth}
            onChange={e => setSelMonth(e.target.value)}>
            <option value="all">Todos los meses</option>
            {availableMonths.map(ym => (
              <option key={ym} value={ym}>{fmtMonth(ym)}</option>
            ))}
          </select>
        </div>
      )}

      {/* Summary bar */}
      <div className="cd-saldos-bar" style={{ marginBottom: '1.5rem' }}>
        <div className="cd-saldo-card" style={{ borderLeftColor: 'var(--c-musgo)' }}>
          <div className="cd-saldo-label">Total Ingresos</div>
          <div className="cd-saldo-val" style={{ color: 'var(--c-musgo)' }}>{fi(totalIngresos)}</div>
        </div>
        <div className="cd-saldo-card" style={{ borderLeftColor: 'var(--c-laca)' }}>
          <div className="cd-saldo-label">Total Egresos</div>
          <div className="cd-saldo-val" style={{ color: 'var(--c-laca)' }}>{fi(totalEgresos)}</div>
        </div>
        <div className="cd-saldo-card" style={{ borderLeftColor: resultado >= 0 ? 'var(--c-musgo)' : 'var(--c-laca)' }}>
          <div className="cd-saldo-label">Resultado</div>
          <div className="cd-saldo-val" style={{ color: resultado >= 0 ? 'var(--c-musgo)' : 'var(--c-laca)' }}>
            {resultado >= 0 ? '+' : ''}{fi(resultado)}
          </div>
        </div>
        <div className="cd-saldo-card" style={{ borderLeftColor: totalPendiente > 0 ? 'var(--c-oro-texto)' : 'var(--c-gris)' }}>
          <div className="cd-saldo-label">Pendientes</div>
          <div className="cd-saldo-val" style={{ color: totalPendiente > 0 ? 'var(--c-oro-texto)' : 'var(--c-gris)', fontSize: totalPendiente > 0 ? '17px' : '13px' }}>
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
              <div key={method} style={{ display:'flex', justifyContent:'space-between', fontSize:'0.75rem', color:'var(--c-gris)', padding:'2px 0', borderBottom:'1px solid var(--c-linea)' }}>
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
            <div style={{ fontSize:'0.62rem', letterSpacing:'0.12em', color:'var(--c-gris)', marginBottom:'0.3rem', paddingLeft:'0.5rem' }}>Por categoría</div>
            {egresosBySubcat.map(([subcat, amt]) => {
              const pct = totalEgresos > 0 ? amt / totalEgresos * 100 : 0
              return (
                <div key={subcat} style={{ padding:'0.3rem 0.5rem', display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid var(--c-linea)' }}>
                  <span style={{ fontSize:'0.78rem', color:'var(--c-tinta)' }}>{subcat}</span>
                  <div style={{ display:'flex', alignItems:'center', gap:'0.75rem' }}>
                    {/* Mini bar */}
                    <div style={{ width:60, height:4, background:'var(--c-linea)', borderRadius:2, overflow:'hidden' }}>
                      <div style={{ height:'100%', width:`${Math.min(pct,100)}%`, background:'var(--c-laca)', borderRadius:2 }}/>
                    </div>
                    <span style={{ fontSize:'0.75rem', color:'var(--c-laca)', fontWeight:600, minWidth:45, textAlign:'right' }}>{fi(amt)}</span>
                    <span style={{ fontSize:'0.65rem', color:'var(--c-gris)', minWidth:32, textAlign:'right' }}>{pct.toFixed(1)}%</span>
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
              <tr style={{ borderBottom:'1px solid var(--c-linea)' }}>
                <th style={{ textAlign:'left', padding:'0.4rem 0.5rem', fontSize:'0.65rem', color:'var(--c-gris)', fontWeight:400, letterSpacing:'0.1em' }}>Mes</th>
                <th style={{ textAlign:'right', padding:'0.4rem 0.5rem', fontSize:'0.65rem', color:'var(--c-musgo)', fontWeight:400 }}>Ingresos</th>
                <th style={{ textAlign:'right', padding:'0.4rem 0.5rem', fontSize:'0.65rem', color:'var(--c-laca)', fontWeight:400 }}>Egresos</th>
                <th style={{ textAlign:'right', padding:'0.4rem 0.5rem', fontSize:'0.65rem', color:'var(--c-gris)', fontWeight:400 }}>Neto</th>
              </tr>
            </thead>
            <tbody>
              {monthlyTrend.map(m => (
                <tr key={m.ym} style={{ borderBottom:'1px solid var(--c-linea)', background: m.ym === selMonth ? 'var(--c-oro-fondo)' : undefined }}>
                  <td style={{ padding:'0.4rem 0.5rem', color: m.ym === selMonth ? 'var(--c-oro-texto)' : 'var(--c-gris)', fontWeight: m.ym === selMonth ? 700 : 400 }}>{fmtMonth(m.ym)}</td>
                  <td style={{ padding:'0.4rem 0.5rem', textAlign:'right', color:'var(--c-musgo)' }}>{fi(m.ing)}</td>
                  <td style={{ padding:'0.4rem 0.5rem', textAlign:'right', color:'var(--c-laca)' }}>{fi(m.egr)}</td>
                  <td style={{ padding:'0.4rem 0.5rem', textAlign:'right', color: m.neto >= 0 ? 'var(--c-musgo)' : 'var(--c-laca)', fontWeight:700 }}>
                    {m.neto >= 0 ? '+' : ''}{fi(m.neto)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* C2 — Sobrantes / faltantes del cierre (patrón over/short). Display de lo
          ya sellado en cash_cierres_dia; sirve para ver tendencia, no es contabilidad. */}
      {overShort.total > 0 && (
        <div style={{ marginTop: '1.5rem' }}>
          <div className="cd-resumen-section-hdr" style={{ marginBottom: '0.5rem' }}>
            SOBRANTES / FALTANTES DEL CIERRE ({overShort.total})
          </div>
          {/* Agregados del período */}
          <div style={{ display:'flex', gap:'1rem', flexWrap:'wrap', marginBottom:'0.75rem', fontSize:'0.75rem' }}>
            <span style={{ color:'var(--c-musgo)' }}>✓ Cuadraron: <strong>{overShort.nCuadraron}</strong></span>
            <span style={{ color: overShort.nDescuadraron > 0 ? 'var(--c-laca)' : 'var(--c-gris)' }}>
              Con diferencia: <strong>{overShort.nDescuadraron}</strong>
            </span>
            <span style={{ color:'var(--c-gris)' }}>
              Neto: <strong style={{ color: overShort.sumaNeta >= 0 ? 'var(--c-musgo)' : 'var(--c-laca)' }}>
                {overShort.sumaNeta >= 0 ? '+' : ''}{fi(overShort.sumaNeta)}
              </strong>
            </span>
            <span style={{ color:'var(--c-gris)' }}>Absoluto: <strong>{fi(overShort.sumaAbs)}</strong></span>
          </div>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.8rem' }}>
            <thead>
              <tr style={{ borderBottom:'1px solid var(--c-linea)' }}>
                <th style={{ textAlign:'left',  padding:'0.4rem 0.5rem', fontSize:'0.65rem', color:'var(--c-gris)', fontWeight:400, letterSpacing:'0.1em' }}>Fecha</th>
                <th style={{ textAlign:'right', padding:'0.4rem 0.5rem', fontSize:'0.65rem', color:'var(--c-gris)', fontWeight:400 }}>Diferencia</th>
                <th style={{ textAlign:'left',  padding:'0.4rem 0.5rem', fontSize:'0.65rem', color:'var(--c-gris)', fontWeight:400 }}>Ajuste</th>
              </tr>
            </thead>
            <tbody>
              {overShort.items.map(it => {
                const color = it.estado === 'faltante' ? 'var(--c-laca)' : it.estado === 'sobrante' ? 'var(--c-oro-texto)' : 'var(--c-musgo)'
                const label = it.estado === 'faltante' ? 'Faltante' : it.estado === 'sobrante' ? 'Sobrante' : '✓ Cuadró'
                return (
                  <tr key={it.session_date} style={{ borderBottom:'1px solid var(--c-linea)' }}>
                    <td style={{ padding:'0.4rem 0.5rem', color:'var(--c-gris)' }}>{it.session_date}</td>
                    <td style={{ padding:'0.4rem 0.5rem', textAlign:'right', color, fontWeight:700, fontFamily: 'var(--font-sans)', fontVariantNumeric: 'tabular-nums' }}>
                      {it.estado === 'cuadro' ? label : `${it.diferencia_crc >= 0 ? '+' : ''}${fi(it.diferencia_crc)}`}
                    </td>
                    <td style={{ padding:'0.4rem 0.5rem', color:'var(--c-gris-claro)', fontSize:'0.72rem' }}>
                      {it.estado === 'cuadro'
                        ? <span style={{ color:'var(--c-gris)' }}>—</span>
                        : <span><span style={{ color, fontWeight:600 }}>{it.ajuste_tipo || label}</span>{it.ajuste_motivo ? ` · ${it.ajuste_motivo}` : ''}</span>}
                    </td>
                  </tr>
                )
              })}
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
              <div key={s.id} style={{ borderBottom: '1px solid var(--c-linea)', paddingBottom: '0.75rem', marginBottom: '0.75rem' }}>
                <div className="cd-resumen-row" style={{ marginBottom: hasFinal ? '0.4rem' : 0 }}>
                  <div>
                    <span style={{ fontWeight: 600 }}>{s.session_date}</span>
                    <span style={{ color: 'var(--c-gris)', marginLeft: '0.5rem', fontSize: '0.8rem' }}>
                      {s.shift_type} · {s.cajero_name}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                    <span style={{ color: 'var(--c-musgo)', fontSize: '0.85rem' }}>+{fi(ing)}</span>
                    <span style={{ color: 'var(--c-laca)', fontSize: '0.85rem' }}>-{fi(egr)}</span>
                  </div>
                </div>
                {hasFinal && (
                  <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', paddingLeft: '0.5rem', fontSize: '0.72rem' }}>
                    {[
                      { label: 'Caja inicial', val: s.initial_cash_crc, color: 'var(--c-tinta)' },
                      { label: 'Final registradora', val: s.final_cash_crc, color: 'var(--c-tinta)' },
                      { label: 'Caja fuerte', val: s.final_safe_crc, color: 'var(--c-teal)' },
                      { label: 'Depósito banco', val: s.final_bank_crc, color: 'var(--c-teal)' },
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
