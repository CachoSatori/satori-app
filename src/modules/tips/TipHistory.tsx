import { useState, useEffect, useMemo, useCallback } from 'react'
import type { TipSession, Employee, RoleTipPoints, UserRole } from '../../shared/types/database'
import { getTipEntriesBySession, upsertTipEntry, deleteTipEntry, updateSessionPools, savePayouts } from '../../shared/api/tips'
import { calcHistory, calcTurno, formatCRC, formatNum, ROL_LABELS, ROL_ORDER, NO_PROPINA_ROLES, type HistoryCalc, type HistoryRow, type DraftLine } from '../../shared/utils/tipCalculations'
import { shiftLabel } from '../../shared/utils'

interface Props {
  sessions:        TipSession[]
  employees:       Employee[]
  rolePoints:      RoleTipPoints[]
  onCalcReady?:    (sessionId: string, calc: HistoryCalc) => void
  onDeleteSession?: (session: TipSession) => void
  onSaved?:        () => void | Promise<void>
  isManager?:      boolean
}

interface EditRow {
  employeeId:   string
  employeeName: string
  role:         UserRole          // rol natural del empleado
  coveredRole:  UserRole | ''     // rol cubierto este turno ('' = trabajó en su rol)
  active:       boolean
  hours:        number | ''
  propina_crc:  number | ''
  propina_usd:  number | ''
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

export default function TipHistory({ sessions, employees, rolePoints, onCalcReady, onDeleteSession, onSaved, isManager }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [calcCache,  setCalcCache]  = useState<Record<string, HistoryCalc>>({})
  const [loadingId,  setLoadingId]  = useState<string | null>(null)
  const [modalId,    setModalId]    = useState<string | null>(null)
  const [copied,     setCopied]     = useState(false)

  // ── Edición dentro del modal (mini-formulario, sin salir de Historial) ──
  const [editMode,  setEditMode]  = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [editErr,   setEditErr]   = useState<string | null>(null)
  const [ePoolCRC,  setEPoolCRC]  = useState<number | ''>('')
  const [ePoolUSD,  setEPoolUSD]  = useState<number | ''>('')
  const [ePoolBarra, setEPoolBarra] = useState<number | ''>('')
  const [eRows,     setERows]     = useState<EditRow[]>([])

  const ptsMap = useMemo(() => new Map(rolePoints.map(r => [r.role, r.points])), [rolePoints])

  const closeModal = useCallback(() => { setModalId(null); setEditMode(false); setEditErr(null) }, [])

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
          points: e.points, payout_crc: e.payout_crc, covered_role: e.covered_role,
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
  const openModal = (s: TipSession) => { setModalId(s.id); setEditMode(false); loadCalc(s) }

  // Cerrar modal con Escape (no cierra si está guardando)
  useEffect(() => {
    if (!modalId) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) closeModal() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modalId, saving, closeModal])

  // ── Entrar en modo edición: arma el mini-formulario con los datos actuales ──
  const startEdit = (session: TipSession, calc: HistoryCalc | null) => {
    const existing = new Map((calc?.rows ?? []).map(r => [r.employeeId, r]))
    const empById  = new Map(employees.map(e => [e.id, e]))
    const ids = new Set<string>([
      ...employees.filter(e => e.is_active).map(e => e.id),
      ...(calc?.rows.map(r => r.employeeId) ?? []),
    ])
    const rows: EditRow[] = [...ids].map((id): EditRow => {
      const emp = empById.get(id)
      const r   = existing.get(id)
      // rol natural: el del empleado; si no está en la lista, caer al efectivo guardado
      const naturalRole = (emp?.role ?? r?.coveredRole ?? r?.role) as UserRole
      return {
        employeeId:   id,
        employeeName: emp?.full_name ?? r?.employeeName ?? '—',
        role:         naturalRole,
        coveredRole:  (r?.coveredRole ?? '') as UserRole | '',
        active:       !!r,
        hours:        r ? r.hours : '',
        propina_crc:  r ? r.propina_crc : '',
        propina_usd:  r ? r.propina_usd : '',
      }
    }).sort((a, b) => {
      const ra = ROL_ORDER.indexOf(a.coveredRole || a.role), rb = ROL_ORDER.indexOf(b.coveredRole || b.role)
      return ra !== rb ? ra - rb : a.employeeName.localeCompare(b.employeeName)
    })
    setERows(rows)
    setEPoolCRC(session.pool_efectivo_crc || '')
    setEPoolUSD(session.pool_efectivo_usd || '')
    setEPoolBarra(session.pool_barra_crc || '')
    setEditErr(null)
    setEditMode(true)
  }

  const setRow = (id: string, patch: Partial<EditRow>) =>
    setERows(rows => rows.map(r => r.employeeId === id ? { ...r, ...patch } : r))

  // ── Guardar cambios (replica exacta del cierre de turno) ──
  const handleSaveEdit = async (session: TipSession, prevCalc: HistoryCalc | null) => {
    const rate  = session.exchange_rate
    const draft = eRows.map(r => {
      const eff = (r.coveredRole || r.role) as UserRole
      return {
        employeeId: r.employeeId, employeeName: r.employeeName, role: eff,
        active: r.active, hours: r.hours, propina_crc: r.propina_crc, propina_usd: r.propina_usd,
        pts_rol: ptsMap.get(eff) ?? 0, pts_val: 0, take_home: 0,
      }
    }) as DraftLine[]
    const { updatedLines } = calcTurno(draft, Number(ePoolCRC) || 0, Number(ePoolUSD) || 0, Number(ePoolBarra) || 0, rate)
    if (!updatedLines.some(l => l.active)) { setEditErr('Marcá al menos un empleado que trabajó'); return }

    setSaving(true); setEditErr(null)
    try {
      const sid = session.id
      const prevIds = new Set((prevCalc?.rows ?? []).map(r => r.employeeId))
      for (const r of eRows) {
        if (r.active) {
          await upsertTipEntry({
            session_id: sid, employee_id: r.employeeId,
            hours_worked: Number(r.hours) || 0,
            tip_amount_crc: Number(r.propina_crc) || 0,
            tip_amount_usd: Number(r.propina_usd) || 0,
            covered_role: r.coveredRole || null,
          })
        } else if (prevIds.has(r.employeeId)) {
          await deleteTipEntry(sid, r.employeeId)
        }
      }
      await updateSessionPools(sid, {
        pool_efectivo_crc: Number(ePoolCRC) || 0,
        pool_efectivo_usd: Number(ePoolUSD) || 0,
        pool_barra_crc:    Number(ePoolBarra) || 0,
      })
      // Releer entradas para obtener ids y guardar payouts
      const fresh = await getTipEntriesBySession(sid)
      const idMap = new Map(fresh.map(e => [e.employee_id, e.id]))
      const payouts = updatedLines
        .filter(l => l.active)
        .map(l => { const id = idMap.get(l.employeeId); return id ? { id, points: l.pts_val, payout_crc: Math.round(l.take_home) } : null })
        .filter((p): p is { id: string; points: number; payout_crc: number } => p !== null)
      await savePayouts(payouts)

      // Refrescar: limpiar cache de cálculo y recargar datos del padre
      setCalcCache(prev => { const n = { ...prev }; delete n[sid]; return n })
      await onSaved?.()
      closeModal()
    } catch (e) {
      setEditErr(e instanceof Error ? e.message : 'Error guardando los cambios')
    } finally {
      setSaving(false)
    }
  }

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
      {modalSession && (() => {
        // Preview en vivo del reparto mientras se edita
        const preview = editMode ? calcTurno(
          eRows.map(r => {
            const eff = (r.coveredRole || r.role) as UserRole
            return {
              employeeId: r.employeeId, employeeName: r.employeeName, role: eff,
              active: r.active, hours: r.hours, propina_crc: r.propina_crc, propina_usd: r.propina_usd,
              pts_rol: ptsMap.get(eff) ?? 0, pts_val: 0, take_home: 0,
            }
          }) as DraftLine[],
          Number(ePoolCRC) || 0, Number(ePoolUSD) || 0, Number(ePoolBarra) || 0, modalSession.exchange_rate,
        ) : null
        const payoutMap = new Map(preview?.updatedLines.map(l => [l.employeeId, Math.round(l.take_home)]) ?? [])
        const headPool  = editMode && preview ? preview.totals.totalPool : (modalCalc ? modalCalc.totalPool : poolTotalOf(modalSession))

        return (
        <div onClick={() => { if (!saving) closeModal() }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '1rem', overflowY: 'auto' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'var(--t-paper,#f5f0e8)', color: 'var(--t-ink,#0d0d0d)', borderRadius: 8, maxWidth: editMode ? 640 : 560, width: '100%', marginTop: '4vh', boxShadow: '0 12px 48px rgba(0,0,0,0.4)', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ background: 'var(--t-ink,#0d0d0d)', padding: '1rem 1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ color: GOLD, fontWeight: 700, fontSize: '1rem' }}>
                  {editMode && <span style={{ color: TEAL }}>✏ Editando · </span>}
                  {modalSession.session_date} · {shiftLabel(modalSession.shift_type)}
                </div>
                <div style={{ color: '#bbb', fontSize: '0.72rem' }}>
                  Pool total: <strong style={{ color: '#f0ece4' }}>{formatCRC(headPool)}</strong>
                  {!editMode && modalCalc && modalCalc.barraPool > 0 && <span> · 🍸 Barra {formatCRC(modalCalc.barraPool)}</span>}
                  {editMode && <span> · TC ₡{modalSession.exchange_rate?.toLocaleString('es-CR')}</span>}
                </div>
              </div>
              <button onClick={() => { if (!saving) closeModal() }} style={{ background: 'none', border: 'none', color: '#888', fontSize: '1.3rem', cursor: 'pointer', lineHeight: 1 }} title="Cerrar (Esc)">✕</button>
            </div>

            {/* ── Cuerpo ── */}
            <div style={{ padding: '0.75rem 1.25rem 1rem', maxHeight: '62vh', overflowY: 'auto' }}>
              {!editMode ? (
                /* ── LECTURA ── */
                !modalCalc ? (
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
                                {row.coveredRole && <span style={{ color: TEAL }}> · 👥 cobertura</span>}
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
                )
              ) : (
                /* ── EDICIÓN — mini formulario tipo creación ── */
                <>
                  {/* Pools */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px,1fr))', gap: '0.6rem', marginBottom: '0.9rem' }}>
                    <div className="tips-field">
                      <div className="tips-field-label">💵 Efectivo ₡</div>
                      <input type="number" className="tips-input-dark" min={0} step={100} value={ePoolCRC}
                        onChange={e => setEPoolCRC(e.target.value === '' ? '' : Number(e.target.value))} />
                    </div>
                    <div className="tips-field">
                      <div className="tips-field-label">💵 Efectivo $</div>
                      <input type="number" className="tips-input-dark" min={0} step={0.01} value={ePoolUSD}
                        onChange={e => setEPoolUSD(e.target.value === '' ? '' : Number(e.target.value))} />
                    </div>
                    <div className="tips-field">
                      <div className="tips-field-label">🍸 Pool barra ₡</div>
                      <input type="number" className="tips-input-dark" min={0} step={100} value={ePoolBarra}
                        onChange={e => setEPoolBarra(e.target.value === '' ? '' : Number(e.target.value))} />
                    </div>
                  </div>

                  {/* Empleados */}
                  <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 2 }}>
                    {eRows.map(r => {
                      const eff = (r.coveredRole || r.role) as UserRole
                      const hasPropina = !NO_PROPINA_ROLES.includes(eff)
                      const pay = payoutMap.get(r.employeeId) ?? 0
                      return (
                        <div key={r.employeeId} style={{ borderBottom: `1px solid ${BORDER}`, padding: '0.5rem 0.7rem', background: r.active ? 'rgba(42,122,106,0.05)' : undefined }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                            <input type="checkbox" checked={r.active} onChange={e => setRow(r.employeeId, { active: e.target.checked })}
                              style={{ width: 15, height: 15, accentColor: TEAL, cursor: 'pointer', flexShrink: 0 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: '0.82rem', fontWeight: 700, letterSpacing: '0.02em' }}>{r.employeeName}</div>
                              <div style={{ fontSize: '0.62rem', color: MUTED }}>
                                {ROL_LABELS[r.role]}
                                {r.coveredRole && <span style={{ color: TEAL, fontWeight: 700 }}> → 👥 {ROL_LABELS[r.coveredRole]}</span>}
                              </div>
                            </div>
                            {r.active && (
                              <div style={{ fontSize: '0.82rem', fontWeight: 700, color: GOLD, whiteSpace: 'nowrap' }}>{formatCRC(pay)}</div>
                            )}
                          </div>
                          {r.active && (
                            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.45rem', paddingLeft: '1.6rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                              <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <span style={{ fontSize: '0.55rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: MUTED, fontWeight: 700 }}>Horas</span>
                                <input type="number" className="tips-input-dark" min={0} step={0.5} value={r.hours} style={{ width: 70 }}
                                  onChange={e => setRow(r.employeeId, { hours: e.target.value === '' ? '' : Number(e.target.value) })} />
                              </label>
                              <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <span style={{ fontSize: '0.55rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: MUTED, fontWeight: 700 }}>👥 Cubrió como</span>
                                <select className="tips-input-dark" value={r.coveredRole} style={{ minWidth: 110 }}
                                  onChange={e => {
                                    const nv = (e.target.value || '') as UserRole | ''
                                    const newEff = (nv || r.role) as UserRole
                                    setRow(r.employeeId, NO_PROPINA_ROLES.includes(newEff)
                                      ? { coveredRole: nv, propina_crc: '', propina_usd: '' }
                                      : { coveredRole: nv })
                                  }}>
                                  <option value="">Su rol ({ROL_LABELS[r.role]})</option>
                                  {ROL_ORDER.filter(role => role !== r.role).map(role => (
                                    <option key={role} value={role}>{ROL_LABELS[role]}</option>
                                  ))}
                                </select>
                              </label>
                              {hasPropina && (
                                <>
                                  <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                    <span style={{ fontSize: '0.55rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: MUTED, fontWeight: 700 }}>Datáfono ₡</span>
                                    <input type="number" className="tips-input-dark" min={0} step={100} value={r.propina_crc} style={{ width: 90 }}
                                      onChange={e => setRow(r.employeeId, { propina_crc: e.target.value === '' ? '' : Number(e.target.value) })} />
                                  </label>
                                  <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                    <span style={{ fontSize: '0.55rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: MUTED, fontWeight: 700 }}>Datáfono $</span>
                                    <input type="number" className="tips-input-dark" min={0} step={0.01} value={r.propina_usd} style={{ width: 80 }}
                                      onChange={e => setRow(r.employeeId, { propina_usd: e.target.value === '' ? '' : Number(e.target.value) })} />
                                  </label>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  {editErr && <div style={{ marginTop: '0.6rem', color: RED, fontSize: '0.78rem' }}>{editErr}</div>}
                </>
              )}
              {!editMode && modalSession.notes && (
                <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', background: 'rgba(0,0,0,0.04)', borderRadius: 2, fontSize: '0.78rem', color: MUTED, borderLeft: `2px solid ${GOLD}` }}>📝 {modalSession.notes}</div>
              )}
            </div>

            {/* ── Acciones ── */}
            <div style={{ display: 'flex', gap: '0.5rem', padding: '0.875rem 1.25rem', borderTop: `1px solid ${BORDER}`, flexWrap: 'wrap', justifyContent: 'flex-end', background: 'rgba(0,0,0,0.02)' }}>
              {editMode ? (
                <>
                  <button onClick={() => handleSaveEdit(modalSession, modalCalc)} disabled={saving}
                    style={{ padding: '7px 16px', borderRadius: 4, border: `1px solid ${TEAL}`, background: TEAL, color: '#fff', fontWeight: 700, fontSize: '0.82rem', cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}>
                    {saving ? 'Guardando…' : '💾 Guardar cambios'}
                  </button>
                  <button onClick={() => { setEditMode(false); setEditErr(null) }} disabled={saving}
                    style={{ padding: '7px 14px', borderRadius: 4, border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED, fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer' }}>
                    Cancelar
                  </button>
                </>
              ) : (
                <>
                  {isManager && (
                    <button onClick={() => startEdit(modalSession, modalCalc)} disabled={!modalCalc}
                      style={{ padding: '7px 14px', borderRadius: 4, border: `1px solid ${TEAL}`, background: 'rgba(42,122,106,0.1)', color: TEAL, fontWeight: 700, fontSize: '0.8rem', cursor: modalCalc ? 'pointer' : 'default', opacity: modalCalc ? 1 : 0.5 }}>
                      ✏ Editar
                    </button>
                  )}
                  {isManager && onDeleteSession && (
                    <button onClick={() => { onDeleteSession(modalSession); closeModal() }}
                      style={{ padding: '7px 14px', borderRadius: 4, border: `1px solid ${RED}`, background: 'transparent', color: RED, fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer' }}>
                      🗑 Eliminar
                    </button>
                  )}
                  <button onClick={() => modalCalc && copySession(modalSession, modalCalc)} disabled={!modalCalc}
                    style={{ padding: '7px 14px', borderRadius: 4, border: `1px solid ${BORDER}`, background: 'transparent', color: copied ? TEAL : MUTED, fontWeight: 700, fontSize: '0.8rem', cursor: modalCalc ? 'pointer' : 'default' }}>
                    {copied ? '✓ Copiado' : '⎘ Copiar'}
                  </button>
                  <button onClick={() => closeModal()}
                    style={{ padding: '7px 14px', borderRadius: 4, border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED, fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer' }}>
                    Cerrar
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
        )
      })()}
    </div>
  )
}
