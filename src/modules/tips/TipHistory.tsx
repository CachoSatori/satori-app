import { useState, useEffect, useMemo, useCallback } from 'react'
import type { TipSession, Employee, RoleTipPoints } from '../../shared/types/database'
import { getTipEntriesBySession } from '../../shared/api/tips'
import { calcHistory, formatCRC, formatNum, ROL_LABELS, type HistoryCalc, type HistoryRow } from '../../shared/utils/tipCalculations'
import { shiftLabel } from '../../shared/utils'

interface Props {
  sessions:        TipSession[]
  employees:       Employee[]
  rolePoints:      RoleTipPoints[]
  onCalcReady?:    (sessionId: string, calc: HistoryCalc) => void
  onEditSession?:  (session: TipSession) => void
  onDeleteSession?: (session: TipSession) => void
  isManager?:      boolean
}

const MSHORT = ['','Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const BAR_ROLES = new Set(['barman', 'barback'])
const MUTED = '#5a5040', BORDER = 'var(--t-border,#d4cfc4)', GOLD = '#a07830', TEAL = '#2a7a6a', RED = '#c23b22'

// Pool total a la vista sin click (efectivo + barra del registro de la sesión)
function poolTotalOf(s: TipSession) {
  return (s.pool_efectivo_crc || 0) + (s.pool_efectivo_usd || 0) * (s.exchange_rate || 0) + (s.pool_barra_crc || 0)
}
// Desglose de barra para una fila: servicio (pool general por puntos) + pool barra (resto)
function barraSplit(r: HistoryRow, generalRate: number) {
  if (!BAR_ROLES.has(r.role)) return null
  const serv = Math.round(r.pts_val * generalRate)
  return { serv, barra: Math.max(0, r.payout_crc - serv) }
}

export default function TipHistory({ sessions, employees, rolePoints, onCalcReady, onEditSession, onDeleteSession, isManager }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [calcCache,  setCalcCache]  = useState<Record<string, HistoryCalc>>({})
  const [loadingId,  setLoadingId]  = useState<string | null>(null)
  const [modalId,    setModalId]    = useState<string | null>(null)
  const [copied,     setCopied]     = useState(false)

  const [filterEmp,   setFilterEmp]   = useState<string>('all')
  const [filterMonth, setFilterMonth] = useState<string>('all')

  const closed = sessions.filter(s => s.status === 'closed')

  const availableMonths = useMemo(() => {
    const m = new Set<string>()
    closed.forEach(s => { if (s.session_date) m.add(s.session_date.slice(0, 7)) })
    return [...m].sort().reverse()
  }, [closed])

  const filteredSessions = useMemo(
    () => closed.filter(s => filterMonth === 'all' || s.session_date?.startsWith(filterMonth)),
    [closed, filterMonth],
  )

  // ── Cargar el cálculo de una sesión (entradas → reparto) ──
  const loadCalc = useCallback(async (s: TipSession): Promise<HistoryCalc | null> => {
    if (calcCache[s.id]) return calcCache[s.id]
    setLoadingId(s.id)
    try {
      const entries = await getTipEntriesBySession(s.id)
      const calc = calcHistory(
        entries.map(e => ({
          employee_id: e.employee_id, hours_worked: e.hours_worked,
          tip_amount_crc: e.tip_amount_crc, tip_amount_usd: e.tip_amount_usd,
          points: e.points, payout_crc: e.payout_crc,
        })),
        employees.map(e => ({ id: e.id, full_name: e.full_name, role: e.role })),
        rolePoints,
        { pool_efectivo_crc: s.pool_efectivo_crc, pool_efectivo_usd: s.pool_efectivo_usd, pool_barra_crc: s.pool_barra_crc, exchange_rate: s.exchange_rate },
      )
      setCalcCache(prev => ({ ...prev, [s.id]: calc }))
      onCalcReady?.(s.id, calc)
      return calc
    } finally {
      setLoadingId(null)
    }
  }, [calcCache, employees, rolePoints, onCalcReady])

  const handleExpand = (s: TipSession) => {
    if (expandedId === s.id) { setExpandedId(null); return }
    setExpandedId(s.id)
    loadCalc(s)
  }
  const openModal = (s: TipSession) => { setModalId(s.id); loadCalc(s) }

  // Cerrar modal con Escape
  useEffect(() => {
    if (!modalId) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setModalId(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modalId])

  const activeEmps = employees.filter(e => e.is_active).sort((a, b) => a.full_name.localeCompare(b.full_name))

  const sessionsToShow = useMemo(() => {
    if (filterEmp === 'all') return filteredSessions
    return filteredSessions.filter(s => {
      const calc = calcCache[s.id]
      if (!calc) return true
      return calc.rows.some(r => r.employeeId === filterEmp)
    })
  }, [filteredSessions, filterEmp, calcCache])

  function fmtMonth(ym: string) { const [y, m] = ym.split('-'); return `${MSHORT[Number(m)]} ${y}` }

  function copySession(s: TipSession, calc: HistoryCalc) {
    const L = [`Propinas ${s.session_date} · ${shiftLabel(s.shift_type)}`, `Pool total: ${formatCRC(calc.totalPool)}`, '']
    calc.rows.forEach(r => L.push(`• ${r.employeeName} (${ROL_LABELS[r.role]}, ${r.hours}h): ${formatCRC(r.payout_crc)}`))
    navigator.clipboard?.writeText(L.join('\n')).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) }).catch(() => window.prompt('Copiá:', L.join('\n')))
  }

  if (!closed.length) {
    return <div className="tips-empty-state"><p className="tips-empty-text">No hay turnos cerrados aún</p></div>
  }

  const modalSession = closed.find(s => s.id === modalId) || null
  const modalCalc = modalId ? calcCache[modalId] : null

  return (
    <div className="tips-history">
      {/* ── Filtros ── */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', padding: '0.75rem 0', marginBottom: '0.5rem', borderBottom: `1px solid ${BORDER}` }}>
        <select className={`date-filter ${filterMonth !== 'all' ? 'active' : ''}`} value={filterMonth} onChange={e => setFilterMonth(e.target.value)}>
          <option value="all">Todos los meses</option>
          {availableMonths.map(ym => <option key={ym} value={ym}>{fmtMonth(ym)}</option>)}
        </select>
        <select className={`date-filter ${filterEmp !== 'all' ? 'active' : ''}`} value={filterEmp} onChange={e => setFilterEmp(e.target.value)}>
          <option value="all">Todos los empleados</option>
          {activeEmps.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
        </select>
        <span style={{ fontSize: '0.68rem', color: MUTED, marginLeft: 'auto' }}>
          {sessionsToShow.length} turno{sessionsToShow.length !== 1 ? 's' : ''}
        </span>
      </div>

      {sessionsToShow.length === 0 ? (
        <div className="tips-empty-state"><p className="tips-empty-text">Sin turnos para los filtros seleccionados</p></div>
      ) : (
        sessionsToShow.map(s => {
          const isOpen    = expandedId === s.id
          const calc      = calcCache[s.id]
          const isLoading = loadingId === s.id && isOpen
          const total     = calc ? calc.totalPool : poolTotalOf(s)
          const filteredRows = calc?.rows.filter(r => filterEmp === 'all' || r.employeeId === filterEmp)

          return (
            <div key={s.id} className={`hist-item${isOpen ? ' open' : ''}`}>
              {/* Barra de la sesión: click → expand inline */}
              <div className="hist-header" onClick={() => handleExpand(s)} style={{ cursor: 'pointer' }}>
                <div>
                  <div className="hist-fecha">{s.session_date} · {shiftLabel(s.shift_type)}</div>
                  <div className="hist-meta">
                    {calc ? `${calc.rows.length} empleados` : 'Tocá para ver el detalle'}
                    {filterEmp !== 'all' && calc && (() => {
                      const row = calc.rows.find(r => r.employeeId === filterEmp)
                      return row ? <span style={{ color: GOLD, marginLeft: '0.4rem' }}> · {row.employeeName}: {formatCRC(row.payout_crc)}</span> : null
                    })()}
                  </div>
                </div>
                <div className="hist-right" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div className="hist-total">{formatCRC(total)}</div>
                  <button
                    onClick={e => { e.stopPropagation(); openModal(s) }}
                    style={{ fontSize: '0.7rem', padding: '4px 12px', border: `1px solid ${TEAL}`, background: 'rgba(42,122,106,0.08)', color: TEAL, borderRadius: 3, cursor: 'pointer', fontWeight: 700, whiteSpace: 'nowrap' }}
                    title="Ver detalle y acciones">
                    Ver
                  </button>
                  <span className="hist-toggle">{isOpen ? '▲' : '▼'}</span>
                </div>
              </div>

              {/* Desglose inline (al click en la barra) */}
              {isOpen && (
                <div className="hist-body">
                  {isLoading && <div className="hist-loading">Cargando…</div>}
                  {calc && (
                    <>
                      <div className="hist-pool-row">
                        <span>Pool <strong>{formatCRC(calc.totalPool)}</strong></span>
                        {calc.barraPool > 0 && <span>🍸 Barra <strong>{formatCRC(calc.barraPool)}</strong></span>}
                        <span>₡/pto <strong>{formatCRC(calc.generalRate)}</strong></span>
                        <span>Pts <strong>{formatNum(calc.totalPoints)}</strong></span>
                      </div>
                      <div className="hist-emp-grid">
                        {(filteredRows ?? calc.rows).map(row => {
                          const split = barraSplit(row, calc.generalRate)
                          return (
                            <div key={row.employeeId} className="hist-emp-row" style={{ background: filterEmp === row.employeeId ? 'rgba(200,169,110,.08)' : undefined }}>
                              <div>
                                <div className="hist-emp-name" style={{ color: filterEmp === row.employeeId ? GOLD : undefined }}>{row.employeeName}</div>
                                <div className="hist-emp-meta">
                                  {ROL_LABELS[row.role]} · {row.hours}h · {formatNum(row.pts_val)} pts
                                  {split && <span style={{ color: MUTED }}> · 🍸 barra {formatCRC(split.barra)} · serv {formatCRC(split.serv)}</span>}
                                </div>
                              </div>
                              <div className="hist-emp-take">{formatCRC(row.payout_crc)}</div>
                            </div>
                          )
                        })}
                      </div>
                      {s.notes && (
                        <div style={{ marginTop: '0.5rem', padding: '0.5rem 0.75rem', background: 'rgba(0,0,0,0.04)', borderRadius: 2, fontSize: '0.78rem', color: MUTED, borderLeft: `2px solid ${GOLD}` }}>📝 {s.notes}</div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })
      )}

      {/* ── MODAL ── */}
      {modalSession && (
        <div onClick={() => setModalId(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '1rem', overflowY: 'auto' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'var(--t-paper,#f5f0e8)', color: 'var(--t-ink,#0d0d0d)', borderRadius: 8, maxWidth: 560, width: '100%', marginTop: '4vh', boxShadow: '0 12px 48px rgba(0,0,0,0.4)', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ background: 'var(--t-ink,#0d0d0d)', padding: '1rem 1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ color: GOLD, fontWeight: 700, fontSize: '1rem' }}>{modalSession.session_date} · {shiftLabel(modalSession.shift_type)}</div>
                <div style={{ color: '#bbb', fontSize: '0.72rem' }}>
                  Pool total: <strong style={{ color: '#f0ece4' }}>{formatCRC(modalCalc ? modalCalc.totalPool : poolTotalOf(modalSession))}</strong>
                  {modalCalc && modalCalc.barraPool > 0 && <span> · 🍸 Barra {formatCRC(modalCalc.barraPool)}</span>}
                </div>
              </div>
              <button onClick={() => setModalId(null)} style={{ background: 'none', border: 'none', color: '#888', fontSize: '1.3rem', cursor: 'pointer', lineHeight: 1 }} title="Cerrar (Esc)">✕</button>
            </div>

            {/* Desglose */}
            <div style={{ padding: '0.5rem 1.25rem 1rem', maxHeight: '55vh', overflowY: 'auto' }}>
              {!modalCalc ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: MUTED }}>Cargando detalle…</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                      <th style={{ textAlign: 'left', padding: '0.4rem 0.3rem', color: MUTED, fontWeight: 500, fontSize: '0.66rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Empleado</th>
                      <th style={{ textAlign: 'right', padding: '0.4rem 0.3rem', color: MUTED, fontWeight: 500, fontSize: '0.66rem' }}>Hs</th>
                      <th style={{ textAlign: 'right', padding: '0.4rem 0.3rem', color: MUTED, fontWeight: 500, fontSize: '0.66rem' }}>Pts</th>
                      <th style={{ textAlign: 'right', padding: '0.4rem 0.3rem', color: MUTED, fontWeight: 500, fontSize: '0.66rem' }}>Propina</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modalCalc.rows.map(row => {
                      const split = barraSplit(row, modalCalc.generalRate)
                      return (
                        <tr key={row.employeeId} style={{ borderBottom: `1px solid ${BORDER}` }}>
                          <td style={{ padding: '0.4rem 0.3rem' }}>
                            <div style={{ fontWeight: 600 }}>{row.employeeName}</div>
                            <div style={{ fontSize: '0.66rem', color: MUTED }}>
                              {ROL_LABELS[row.role]}
                              {split && <span> · 🍸 barra <strong style={{ color: GOLD }}>{formatCRC(split.barra)}</strong> · serv <strong style={{ color: TEAL }}>{formatCRC(split.serv)}</strong></span>}
                            </div>
                          </td>
                          <td style={{ textAlign: 'right', padding: '0.4rem 0.3rem', color: MUTED }}>{row.hours}</td>
                          <td style={{ textAlign: 'right', padding: '0.4rem 0.3rem', color: MUTED }}>{formatNum(row.pts_val)}</td>
                          <td style={{ textAlign: 'right', padding: '0.4rem 0.3rem', fontWeight: 700, color: GOLD }}>{formatCRC(row.payout_crc)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
              {modalSession.notes && (
                <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', background: 'rgba(0,0,0,0.04)', borderRadius: 2, fontSize: '0.78rem', color: MUTED, borderLeft: `2px solid ${GOLD}` }}>📝 {modalSession.notes}</div>
              )}
            </div>

            {/* Acciones */}
            <div style={{ display: 'flex', gap: '0.5rem', padding: '0.875rem 1.25rem', borderTop: `1px solid ${BORDER}`, flexWrap: 'wrap', justifyContent: 'flex-end', background: 'rgba(0,0,0,0.02)' }}>
              {isManager && onEditSession && (
                <button onClick={() => { onEditSession(modalSession); setModalId(null) }}
                  style={{ padding: '7px 14px', borderRadius: 4, border: `1px solid ${TEAL}`, background: 'rgba(42,122,106,0.1)', color: TEAL, fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer' }}>
                  ✏ Editar
                </button>
              )}
              {isManager && onDeleteSession && (
                <button onClick={() => { onDeleteSession(modalSession); setModalId(null) }}
                  style={{ padding: '7px 14px', borderRadius: 4, border: `1px solid ${RED}`, background: 'transparent', color: RED, fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer' }}>
                  🗑 Eliminar
                </button>
              )}
              <button onClick={() => modalCalc && copySession(modalSession, modalCalc)} disabled={!modalCalc}
                style={{ padding: '7px 14px', borderRadius: 4, border: `1px solid ${BORDER}`, background: 'transparent', color: copied ? TEAL : MUTED, fontWeight: 700, fontSize: '0.8rem', cursor: modalCalc ? 'pointer' : 'default' }}>
                {copied ? '✓ Copiado' : '⎘ Copiar'}
              </button>
              <button onClick={() => setModalId(null)}
                style={{ padding: '7px 14px', borderRadius: 4, border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED, fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer' }}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
