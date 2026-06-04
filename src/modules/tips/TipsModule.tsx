import { useState, useEffect, useCallback, useRef, Suspense, lazy } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../shared/hooks/useAuth'
import {
  getOpenTipSession,
  getTipSessions,
  getTipEntriesBySession,
  getActiveEmployees,
  getRoleTipPoints,
  createTipSession,
  closeTipSession,
  deleteTipSession,
  upsertTipEntry,
  deleteTipEntry,
  updateSessionPools,
  updateTipSessionNotes,
  savePayouts,
} from '../../shared/api/tips'
import {
  calcTurno,
  formatCRC,
  formatNum,
  ROL_ORDER,
  ROL_NAMES,
  BAR_ROLES,
  NO_PROPINA_ROLES,
  type DraftLine,
  type PoolTotals,
} from '../../shared/utils/tipCalculations'
import type { TipSession, Employee, RoleTipPoints } from '../../shared/types/database'
const TipHistory   = lazy(() => import('./TipHistory'))
const TipQuincenal = lazy(() => import('./TipQuincenal'))
const TipStats     = lazy(() => import('./TipStats'))
const TipCocina    = lazy(() => import('./TipCocina'))
import { todayCR, shiftLabel, tipShiftToCaja } from '../../shared/utils'
import { getCurrentRate } from '../../shared/api/exchangeRate'
import { getOpenCashSession, createCashMovement } from '../../shared/api/cash'
import type { HistoryCalc } from '../../shared/utils/tipCalculations'

type View = 'turno' | 'historial' | 'quincenal' | 'stats' | 'cocina'

export default function TipsModule() {
  const { profile } = useAuth()
  const navigate    = useNavigate()
  const isManager = profile?.role === 'owner' || profile?.role === 'manager'

  // ── Vistas ────────────────────────────────────────────────
  const [view, setView] = useState<View>('turno')
  // Cache calculos de historial para reutilizar en vista quincenal
  const [tipCalcCache, setTipCalcCache] = useState<Record<string, HistoryCalc>>({})

  // ── Datos base ────────────────────────────────────────────
  const [employees, setEmployees] = useState<Employee[]>([])
  const [rolePoints, setRolePoints] = useState<RoleTipPoints[]>([])
  const [sessions, setSessions] = useState<TipSession[]>([])
  const [openSession, setOpenSession] = useState<TipSession | null>(null)

  // ── Estado UI sesión abierta ──────────────────────────────
  const [fecha, setFecha] = useState(todayCR())
  const [shiftType, setShiftType] = useState<'AM' | 'PM'>('PM')
  const [exchangeRate, setExchangeRate] = useState(640)
  const [efectivoCRC, setEfectivoCRC] = useState<number | ''>('')
  const [efectivoUSD, setEfectivoUSD] = useState<number | ''>('')
  const [barraCRC, setBarraCRC] = useState<number | ''>('')

  // Líneas del draft (por empleado)
  const [lines, setLines] = useState<DraftLine[]>([])
  // Totales calculados
  const [totals, setTotals] = useState<PoolTotals | null>(null)

  // ── Estado UI ─────────────────────────────────────────────
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showNewSession, setShowNewSession] = useState(false)
  const [closing, setClosing] = useState(false)
  const [verifTotal, setVerifTotal] = useState<number | ''>('')  // Pool verification
  const [verifTipo,  setVerifTipo]  = useState('')               // tipo de diferencia (>₡500)
  const [verifMotivo,setVerifMotivo]= useState('')               // motivo de la diferencia
  // Coberturas: employeeId → role they're covering (overrides their natural role for this shift)
  const [coberturas, setCoberturas] = useState<Record<string, string>>({})
  const [showCobPicker, setShowCobPicker] = useState(false)
  const [cobEmpId, setCobEmpId] = useState('')
  const [cobRole,  setCobRole]  = useState('')

  // Refs para evitar re-saves infinitos
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Cargar datos ──────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [open, allSessions, emps, pts, currentRate] = await Promise.all([
        getOpenTipSession(),
        getTipSessions(),
        getActiveEmployees(),
        getRoleTipPoints(),
        getCurrentRate(),
      ])
      // Use DB rate as default if no session is open
      if (!open) setExchangeRate(currentRate)
      setEmployees(emps)
      setRolePoints(pts)
      setSessions(allSessions)
      setOpenSession(open)

      if (open) {
        // Restaurar pools del session
        setEfectivoCRC(open.pool_efectivo_crc || '')
        setEfectivoUSD(open.pool_efectivo_usd || '')
        setBarraCRC(open.pool_barra_crc || '')
        setShiftType(open.shift_type)
        setFecha(open.session_date)
        setExchangeRate(open.exchange_rate)

        // Cargar entradas
        const entries = await getTipEntriesBySession(open.id)
        const ptsMap = new Map(pts.map(r => [r.role, r.points]))

        // Reconstruir coberturas guardadas (rol cubierto por entrada)
        const cobMap: Record<string, string> = {}
        entries.forEach(e => { if (e.covered_role) cobMap[e.employee_id] = e.covered_role })
        setCoberturas(cobMap)

        const draftLines: DraftLine[] = emps.map(emp => {
          const entry = entries.find(e => e.employee_id === emp.id)
          const effRole = (entry?.covered_role ?? emp.role)
          const pts_rol = ptsMap.get(effRole) ?? 0
          return {
            employeeId:   emp.id,
            employeeName: emp.full_name,
            role:         emp.role,
            active:       !!entry,
            hours:        entry?.hours_worked ?? '',
            propina_crc:  entry?.tip_amount_crc ?? '',
            propina_usd:  entry?.tip_amount_usd ?? '',
            pts_rol,
            pts_val:      0,
            take_home:    0,
          }
        })
        setLines(draftLines)
      } else {
        // Sin sesión: armar líneas vacías para cuando se cree
        const ptsMap = new Map(pts.map(r => [r.role, r.points]))
        const draftLines: DraftLine[] = emps.map(emp => ({
          employeeId:   emp.id,
          employeeName: emp.full_name,
          role:         emp.role,
          active:       false,
          hours:        '',
          propina_crc:  '',
          propina_usd:  '',
          pts_rol:      ptsMap.get(emp.role) ?? 0,
          pts_val:      0,
          take_home:    0,
        }))
        setLines(draftLines)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando datos')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // ── Recalcular totales en tiempo real ─────────────────────
  useEffect(() => {
    if (!openSession) { setTotals(null); return }
    // Cobertura = trabajó ese puesto: el rol EFECTIVO (cubierto) define puntos
    // Y la membresía del pool de barra.
    const linesForCalc = lines.map(l => {
      const cov = coberturas[l.employeeId]
      return cov ? { ...l, role: cov as import('../../shared/types/database').UserRole } : l
    })
    const { totals: t, updatedLines } = calcTurno(
      linesForCalc,
      Number(efectivoCRC) || 0,
      Number(efectivoUSD) || 0,
      Number(barraCRC) || 0,
      exchangeRate,
    )
    // Merge pts_val y take_home back — updatedLines are already copies
    setLines(prev => prev.map((l, i) => ({
      ...l,
      pts_val:   updatedLines[i]?.pts_val   ?? l.pts_val,
      take_home: updatedLines[i]?.take_home ?? l.take_home,
    })))
    setTotals(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines.map(l => `${l.active}|${l.hours}|${l.propina_crc}|${l.propina_usd}`).join(','),
      JSON.stringify(coberturas), efectivoCRC, efectivoUSD, barraCRC, exchangeRate, openSession?.id])

  // ── Auto-guardar pools en Supabase ────────────────────────
  const scheduleSavePools = useCallback(() => {
    if (!openSession) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      updateSessionPools(openSession.id, {
        pool_efectivo_crc: Number(efectivoCRC) || 0,
        pool_efectivo_usd: Number(efectivoUSD) || 0,
        pool_barra_crc:    Number(barraCRC)    || 0,
      }).catch(() => {})
    }, 800)
  }, [openSession, efectivoCRC, efectivoUSD, barraCRC])

  useEffect(() => { scheduleSavePools() }, [scheduleSavePools])

  // ── Abrir sesión ──────────────────────────────────────────
  const handleCreateSession = async () => {
    if (!profile) return
    // Guard: nunca crear si ya existe un registro (abierto o cerrado) para esa fecha + turno
    const dup = sessions.find(s => s.session_date === fecha && s.shift_type === shiftType)
    if (dup) {
      setError(`Ya existe un registro para ${fecha} · ${shiftLabel(shiftType)}. Para modificarlo, andá a Historial.`)
      setShowNewSession(false)
      return
    }
    try {
      const session = await createTipSession({
        session_date:  fecha,
        shift_type:    shiftType,
        exchange_rate: exchangeRate,
        opened_by:     profile.id,
      })
      setOpenSession(session)
      setShowNewSession(false)
      // Resetear líneas
      const ptsMap = new Map(rolePoints.map(r => [r.role, r.points]))
      setLines(employees.map(emp => ({
        employeeId:   emp.id,
        employeeName: emp.full_name,
        role:         emp.role,
        active:       false,
        hours:        '',
        propina_crc:  '',
        propina_usd:  '',
        pts_rol:      ptsMap.get(emp.role) ?? 0,
        pts_val:      0,
        take_home:    0,
      })))
      setEfectivoCRC('')
      setEfectivoUSD('')
      setBarraCRC('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error creando sesión')
    }
  }

  // ── Toggle empleado ───────────────────────────────────────
  const toggleLine = async (employeeId: string, checked: boolean) => {
    if (!openSession) return
    if (!checked) {
      // Desmarcar: eliminar entrada
      await deleteTipEntry(openSession.id, employeeId).catch(() => {})
      setLines(prev => prev.map(l =>
        l.employeeId === employeeId
          ? { ...l, active: false, hours: '', propina_crc: '', propina_usd: '', pts_val: 0, take_home: 0 }
          : l
      ))
    } else {
      // Marcar: poner horas default
      const defaultHours = shiftType === 'AM' ? 5 : 8
      const line = lines.find(l => l.employeeId === employeeId)
      if (!line) return
      const h = NO_PROPINA_ROLES.includes(line.role) ? defaultHours : (shiftType === 'AM' ? 5 : 0)
      setLines(prev => prev.map(l =>
        l.employeeId === employeeId ? { ...l, active: true, hours: h } : l
      ))
      // Persistir
      await upsertTipEntry({
        session_id:     openSession.id,
        employee_id:    employeeId,
        hours_worked:   h,
        tip_amount_crc: 0,
        tip_amount_usd: 0,
        covered_role:   coberturas[employeeId] ?? null,
      }).catch(() => {})
    }
  }

  // ── Cambiar horas ─────────────────────────────────────────
  const handleHoursChange = (employeeId: string, val: string) => {
    setLines(prev => prev.map(l =>
      l.employeeId === employeeId ? { ...l, hours: val === '' ? '' : parseFloat(val) || '' } : l
    ))
  }

  // ── Coberturas ────────────────────────────────────────────
  // Assign a cobertura: employee works in a different role this shift
  const addCobertura = (empId: string, coveredRole: string) => {
    if (!empId || !coveredRole) return
    const ptsMap = new Map(rolePoints.map(r => [r.role, r.points]))
    setCoberturas(prev => ({ ...prev, [empId]: coveredRole }))
    const defaultHours = shiftType === 'AM' ? 5 : 8
    setLines(prev => prev.map(l => {
      if (l.employeeId !== empId) return l
      return { ...l, active: true, hours: defaultHours, pts_rol: ptsMap.get(coveredRole as import('../../shared/types/database').UserRole) ?? l.pts_rol }
    }))
    setShowCobPicker(false); setCobEmpId(''); setCobRole('')
  }

  const removeCobertura = (empId: string) => {
    const ptsMap = new Map(rolePoints.map(r => [r.role, r.points]))
    setCoberturas(prev => { const n = { ...prev }; delete n[empId]; return n })
    setLines(prev => prev.map(l => {
      if (l.employeeId !== empId) return l
      return { ...l, active: false, hours: '', pts_rol: ptsMap.get(l.role) ?? l.pts_rol }
    }))
  }

  // ── Cambiar propina ───────────────────────────────────────
  const handlePropinaChange = (employeeId: string, field: 'propina_crc' | 'propina_usd', val: string) => {
    setLines(prev => prev.map(l =>
      l.employeeId === employeeId ? { ...l, [field]: val === '' ? '' : parseFloat(val) || '' } : l
    ))
  }

  // ── Auto-save entrada al dejar campo ─────────────────────
  const handleLineBlur = async (employeeId: string) => {
    if (!openSession) return
    const line = lines.find(l => l.employeeId === employeeId)
    if (!line || !line.active) return
    const hours = Number(line.hours) || 0
    if (hours <= 0) return
    await upsertTipEntry({
      session_id:     openSession.id,
      employee_id:    employeeId,
      hours_worked:   hours,
      tip_amount_crc: Number(line.propina_crc) || 0,
      tip_amount_usd: Number(line.propina_usd) || 0,
      covered_role:   coberturas[employeeId] ?? null,
    }).catch(() => {})
  }

  // ── Eliminar sesión (desde el historial) ──────────────────
  const handleDeleteSession = async (session: TipSession) => {
    if (!isManager) return
    if (!window.confirm(`¿Estás seguro de eliminar el turno ${session.session_date} ${shiftLabel(session.shift_type)}?\n\nSe borra la sesión y todas sus propinas. No se puede deshacer.`)) return
    setError(null)
    try {
      await deleteTipSession(session.id)
      await loadData()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error eliminando turno')
    }
  }

  // ── Cerrar turno ──────────────────────────────────────────
  const handleCloseSession = async () => {
    if (!openSession || !profile) return
    const workedLines = lines.filter(l => l.active)
    if (!workedLines.length) { setError('Marcá quién trabajó primero'); return }
    const poolCRC = Math.round((Number(efectivoCRC)||0) + (Number(efectivoUSD)||0)*exchangeRate + (Number(barraCRC)||0))

    // ── Verificación del pool: si se contó un monto y la diferencia con el pool
    // declarado supera ₡500, exigir tipo + motivo antes de permitir cerrar ──
    const diff = verifTotal !== '' ? Math.abs(Number(verifTotal) - poolCRC) : 0
    if (verifTotal !== '' && diff > 500) {
      if (!verifTipo || !verifMotivo.trim()) {
        setError(`Diferencia de ₡${diff.toLocaleString('es-CR')} en el pool — indicá tipo y motivo antes de cerrar`)
        return
      }
    }
    const ok = window.confirm(
      `¿Cerrar turno y guardar payouts?\n\n` +
      `Empleados: ${workedLines.length}\n` +
      `Pool total: ₡ ${poolCRC.toLocaleString('es-CR')}\n\n` +
      `Esta acción no se puede deshacer.`
    )
    if (!ok) return
    setClosing(true)
    try {
      // Flush any unsaved line state to DB before reading back
      // (handles the case where a field was edited but not blurred before clicking close)
      await Promise.all(workedLines.map(l => handleLineBlur(l.employeeId)))

      // Guardar pool final
      await updateSessionPools(openSession.id, {
        pool_efectivo_crc: Number(efectivoCRC) || 0,
        pool_efectivo_usd: Number(efectivoUSD) || 0,
        pool_barra_crc:    Number(barraCRC)    || 0,
      })

      // Guardar todas las entradas con payout
      const entries = await getTipEntriesBySession(openSession.id)
      const payouts = workedLines.map(l => {
        const entry = entries.find(e => e.employee_id === l.employeeId)
        if (!entry) return null
        return { id: entry.id, points: l.pts_val, payout_crc: Math.round(l.take_home) }
      }).filter((p): p is NonNullable<typeof p> => p !== null)

      await savePayouts(payouts)

      // Persistir motivo de diferencia de pool (si la hubo) en las notas
      if (verifTotal !== '' && diff > 500 && verifTipo) {
        const note = `Diferencia pool: ${verifTipo} de ₡${diff.toLocaleString('es-CR')} (contado ₡${Number(verifTotal).toLocaleString('es-CR')} vs pool ₡${poolCRC.toLocaleString('es-CR')}). Motivo: ${verifMotivo.trim()}`
        await updateTipSessionNotes(openSession.id, note).catch(() => {})
      }

      await closeTipSession(openSession.id, profile.id)

      // ── Integración Caja↔Propinas ──────────────────────────
      // Si hay un turno de caja abierto, registrar el pago de propinas
      // como egreso_personal para que cuadre en el cierre de caja
      const totalPayout = payouts.reduce((s, p) => s + p.payout_crc, 0)
      if (totalPayout > 0) {
        try {
          const cashSession = await getOpenCashSession()
          if (cashSession) {
            await createCashMovement({
              session_id:    cashSession.id,
              created_by:    profile.id,
              movement_type: 'egreso_personal',
              amount_crc:    totalPayout,
              amount_usd:    0,
              currency:      'CRC',
              exchange_rate: null,
              description:   `Propinas turno ${openSession.session_date} ${shiftLabel(openSession.shift_type)}`,
              subcategory:   'Propinas por turno',
              method:        'Efectivo',
              caja_origen:   'Registradora',
              shift:         tipShiftToCaja(openSession.shift_type),
            })
          }
        } catch {
          // No bloquear el cierre de propinas si la integración falla silenciosamente
        }
      }

      setOpenSession(null)
      setTotals(null)
      setEfectivoCRC('')
      setEfectivoUSD('')
      setBarraCRC('')
      setVerifTotal('')
      setVerifTipo('')
      setVerifMotivo('')
      // Resetear líneas
      setLines(prev => prev.map(l => ({
        ...l, active: false, hours: '', propina_crc: '', propina_usd: '', pts_val: 0, take_home: 0,
      })))
      await loadData()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cerrando turno')
    } finally {
      setClosing(false)
    }
  }

  // ── Loading ───────────────────────────────────────────────
  if (loading) {
    return (
      <div className="module-loading">
        <span className="loading-mark">心</span>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────
  return (
    <div className="tips-module">

      {/* Header */}
      <div className="tips-header">
        <div className="tips-header-left">
          <span className="tips-kanji">心</span>
          <div>
            <h2 className="tips-title">Propinas</h2>
            <p className="tips-subtitle">Pool del turno · Satori</p>
          </div>
          {profile?.role && <span className="role-badge">{profile.role}</span>}
        </div>
        <button className="cash-back-btn" style={{ borderColor:'#333', color:'#888', whiteSpace:'nowrap' }}
          onClick={() => navigate('/')}>← Inicio</button>
      </div>

      {/* Nav tabs — barra estilo dashboard */}
      <div className="vt-nav-tabs">
        <div className={`vt-nav-tab ${view === 'turno' ? 'active' : ''}`} onClick={() => setView('turno')}>Turno actual</div>
        <div className={`vt-nav-tab ${view === 'historial' ? 'active' : ''}`} onClick={() => setView('historial')}>Historial</div>
        {isManager && <div className={`vt-nav-tab ${view === 'quincenal' ? 'active' : ''}`} onClick={() => setView('quincenal')}>Quincenal</div>}
        {isManager && <div className={`vt-nav-tab ${view === 'stats' ? 'active' : ''}`} onClick={() => setView('stats')}>Estadísticas</div>}
        {isManager && <div className={`vt-nav-tab ${view === 'cocina' ? 'active' : ''}`} onClick={() => setView('cocina')}>Cocina</div>}
      </div>

      {error && (
        <div className="tips-error">
          <span>{error}</span>
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* ─── TURNO ACTUAL ─── */}
      {view === 'turno' && (
        <div className="tips-body">

          {/* Sin sesión abierta */}
          {!openSession && !showNewSession && (
            <div className="tips-empty-state">
              <p className="tips-empty-text">No hay turno abierto</p>
              {isManager && (
                <button className="tips-btn-primary" onClick={() => setShowNewSession(true)}>
                  Abrir turno
                </button>
              )}
            </div>
          )}

          {/* Formulario abrir sesión */}
          {!openSession && showNewSession && (() => {
            const dupSession = sessions.find(s => s.session_date === fecha && s.shift_type === shiftType)
            return (
            <div className="tips-new-session">
              <div className="tips-section-label">Nuevo turno</div>
              <p style={{ fontSize: '0.72rem', color: 'var(--t-muted)', marginBottom: '0.75rem', lineHeight: 1.4 }}>
                Elegí la fecha y el turno de la propina que vas a ingresar. Si te atrasaste, podés registrar un turno de otro día.
              </p>
              <div className="tips-config-grid">
                <div className="tips-field">
                  <div className="tips-field-label">Fecha</div>
                  <input type="date" className="tips-input-dark" value={fecha}
                    onChange={e => setFecha(e.target.value)} />
                </div>
                <div className="tips-field">
                  <div className="tips-field-label">Turno</div>
                  <select className="tips-input-dark" value={shiftType}
                    onChange={e => setShiftType(e.target.value as 'AM' | 'PM')}>
                    <option value="PM">PM — Noche</option>
                    <option value="AM">AM — Mediodía</option>
                  </select>
                </div>
                <div className="tips-field">
                  <div className="tips-field-label">Tipo de cambio (₡/USD)</div>
                  <input type="number" className="tips-input-dark" value={exchangeRate} min={1}
                    onChange={e => setExchangeRate(Number(e.target.value) || 640)} />
                </div>
              </div>

              {/* Aviso: ya existe registro para esa fecha + turno */}
              {dupSession && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', background: 'rgba(194,59,34,0.08)', border: '1px solid rgba(194,59,34,0.35)', borderRadius: 2, padding: '0.6rem 0.85rem', marginBottom: '0.75rem' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--t-red)', lineHeight: 1.4 }}>
                    Ya hay un registro para <strong>{fecha} · {shiftLabel(shiftType)}</strong> ({dupSession.status === 'open' ? 'abierto' : 'cerrado'}). No se puede crear otro. Para modificarlo, andá a Historial.
                  </span>
                  <button className="tips-btn-ghost" onClick={() => { setShowNewSession(false); setView('historial') }}>
                    Ir a Historial →
                  </button>
                </div>
              )}

              <div className="tips-new-session-actions">
                <button className="tips-btn-teal" onClick={handleCreateSession} disabled={!!dupSession}
                  style={dupSession ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}>
                  ▶ Abrir turno
                </button>
                <button className="tips-btn-ghost" onClick={() => setShowNewSession(false)}>
                  Cancelar
                </button>
              </div>
            </div>
            )
          })()}

          {/* Sesión abierta */}
          {openSession && (
            <>
              {/* ── Banner turno activo / editando ── */}
              <div style={{ background: openSession?.session_date !== (fecha ?? '') ? 'rgba(200,144,232,.12)' : 'rgba(74,154,106,.12)', borderBottom:'2px solid #2a4a2a', padding:'0.5rem 1.25rem', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:'0.5rem' }}>
                <div style={{ display:'flex', alignItems:'center', gap:'0.75rem' }}>
                  <span style={{ fontSize:'0.72rem', color: '#4a9a6a', fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase' }}>
                    ● TURNO ACTIVO
                  </span>
                  <span style={{ fontSize:'0.88rem', color:'var(--t-gold)', fontWeight:700 }}>
                    {openSession.session_date}
                  </span>
                  <span style={{ fontSize:'0.78rem', color:'#888', background:'#1a2a1a', padding:'2px 8px', borderRadius:10, border:'1px solid #2a3a2a' }}>
                    {shiftLabel(openSession.shift_type)}
                  </span>
                </div>
                <div style={{ fontSize:'0.72rem', color:'#555' }}>
                  TC: ₡{openSession.exchange_rate?.toLocaleString('es-CR') ?? '—'} · {lines.filter(l=>l.active).length} empleados activos
                </div>
              </div>

              {/* Config bar */}
              <div className="tips-config-bar">
                <div className="tips-config-meta">
                  <strong>{openSession.session_date}</strong> · {shiftLabel(openSession.shift_type)}
                </div>
                <div className="tips-config-meta">
                  Tipo de cambio: <strong>₡{openSession.exchange_rate.toLocaleString('es-CR')}</strong>
                </div>
                <div className="tips-config-meta tips-status-open">
                  ● Abierto
                </div>
              </div>

              {/* Pool efectivo */}
              <div className="tips-efectivo-row">
                <span className="tips-efectivo-label">💵 Efectivo</span>
                <div className="tips-efectivo-inputs">
                  <div className="tips-money-field">
                    <span className="tips-money-prefix">₡</span>
                    <input type="number" className="tips-money-input" placeholder="0" step={100} min={0}
                      value={efectivoCRC}
                      onChange={e => setEfectivoCRC(e.target.value === '' ? '' : parseFloat(e.target.value) || 0)} />
                  </div>
                  <div className="tips-money-field">
                    <span className="tips-money-prefix">$</span>
                    <input type="number" className="tips-money-input" placeholder="0.00" step={0.01} min={0}
                      value={efectivoUSD}
                      onChange={e => setEfectivoUSD(e.target.value === '' ? '' : parseFloat(e.target.value) || 0)} />
                  </div>
                </div>
                <span className="tips-field-hint">Propina en efectivo al pool general</span>
              </div>

              {/* Empleados por sección */}
              {ROL_ORDER.filter(rol => {
                return lines.some(l => l.role === rol) ||
                  Object.entries(coberturas).some(([, cr]) => cr === rol)
              }).map(rol => {
                // Natural role employees (excluding those who are coberturas in a different role)
                // Cobertura employees in THIS role
                const rolLines = lines.filter(l =>
                  coberturas[l.employeeId]
                    ? coberturas[l.employeeId] === rol   // show under covered role
                    : l.role === rol                      // show under natural role
                )
                const isBar = BAR_ROLES.includes(rol)
                const pts = rolePoints.find(r => r.role === rol)?.points ?? 0

                return (
                  <div key={rol} className="tips-rol-section">
                    {/* Sección barra: mostrar pool_barra antes del primer grupo de barra */}
                    {isBar && rol === 'barman' && (
                      <div className="tips-barra-row">
                        <span className="tips-barra-label">🍸 Pool Barra</span>
                        <div className="tips-money-field">
                          <span className="tips-money-prefix">₡</span>
                          <input type="number" className="tips-money-input" placeholder="0" step={100} min={0}
                            value={barraCRC}
                            onChange={e => setBarraCRC(e.target.value === '' ? '' : parseFloat(e.target.value) || 0)} />
                        </div>
                        <span className="tips-field-hint">Dividido entre barra por horas</span>
                      </div>
                    )}

                    <div className="tips-sl">
                      {ROL_NAMES[rol]}
                      <span className="tips-sl-pts">{pts} pts/hora</span>
                    </div>
                    <div className="tips-emp-rows">
                      {rolLines.map(line => {
                        const isCob = !!coberturas[line.employeeId]
                        return (
                          <div key={line.employeeId} style={{ position:'relative' }}>
                            {isCob && (
                              <div style={{ position:'absolute', top:8, right:8, zIndex:2, display:'flex', alignItems:'center', gap:'0.3rem' }}>
                                <span style={{ fontSize:'0.6rem', background:'#c8a030', color:'#0a0a0a', padding:'1px 6px', borderRadius:10, fontWeight:800, letterSpacing:'0.08em' }}>COB</span>
                                <button onClick={() => removeCobertura(line.employeeId)}
                                  style={{ background:'none', border:'none', color:'#c23b22', cursor:'pointer', fontSize:'0.75rem', lineHeight:1, padding:'0 2px' }} title="Quitar cobertura">×</button>
                              </div>
                            )}
                            <TipLineRow
                              line={line}
                              isBar={NO_PROPINA_ROLES.includes(coberturas[line.employeeId] as import('../../shared/types/database').UserRole ?? line.role)}
                              isBarra={BAR_ROLES.includes((coberturas[line.employeeId] as import('../../shared/types/database').UserRole) ?? line.role)}
                              generalRate={totals?.generalRate ?? 0}
                              isManager={isManager}
                              shiftType={shiftType}
                              onToggle={checked => !isCob && toggleLine(line.employeeId, checked)}
                              onHoursChange={val => handleHoursChange(line.employeeId, val)}
                              onPropinaChange={(field, val) => handlePropinaChange(line.employeeId, field, val)}
                              onBlur={() => handleLineBlur(line.employeeId)}
                            />
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}

              {/* ── Sección coberturas ── */}
              {isManager && (
                <div style={{ marginTop:'0.75rem', background:'rgba(200,169,110,.05)', border:'1px solid rgba(200,169,110,.2)', borderRadius:2, padding:'0.75rem' }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: showCobPicker ? '0.75rem' : 0 }}>
                    <div style={{ fontSize:'0.72rem', fontWeight:700, color:'#c8a030', letterSpacing:'0.08em', textTransform:'uppercase' }}>
                      👥 Coberturas {Object.keys(coberturas).length > 0 && `(${Object.keys(coberturas).length})`}
                    </div>
                    <button onClick={() => setShowCobPicker(p => !p)}
                      style={{ fontSize:'0.72rem', padding:'3px 10px', border:'1px solid #c8a030', background:'transparent', color:'#c8a030', borderRadius:2, cursor:'pointer' }}>
                      {showCobPicker ? '✕ Cancelar' : '+ Agregar cobertura'}
                    </button>
                  </div>
                  {showCobPicker && (
                    <div style={{ display:'flex', gap:'0.5rem', flexWrap:'wrap', alignItems:'flex-end' }}>
                      <div>
                        <div style={{ fontSize:'0.62rem', color:'#888', marginBottom:3, textTransform:'uppercase', letterSpacing:'0.1em' }}>Empleado</div>
                        <select value={cobEmpId} onChange={e => setCobEmpId(e.target.value)}
                          style={{ background:'#111', border:'1px solid #2a2a2a', color: cobEmpId ? 'var(--t-gold)' : '#888', padding:'5px 8px', borderRadius:2, fontSize:'0.78rem' }}>
                          <option value="">— seleccionar —</option>
                          {employees.filter(e => !coberturas[e.id]).map(e => (
                            <option key={e.id} value={e.id}>{e.full_name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <div style={{ fontSize:'0.62rem', color:'#888', marginBottom:3, textTransform:'uppercase', letterSpacing:'0.1em' }}>Cubre rol de</div>
                        <select value={cobRole} onChange={e => setCobRole(e.target.value)}
                          style={{ background:'#111', border:'1px solid #2a2a2a', color: cobRole ? 'var(--t-gold)' : '#888', padding:'5px 8px', borderRadius:2, fontSize:'0.78rem' }}>
                          <option value="">— seleccionar rol —</option>
                          {ROL_ORDER.map(r => <option key={r} value={r}>{ROL_NAMES[r]}</option>)}
                        </select>
                      </div>
                      <button
                        onClick={() => addCobertura(cobEmpId, cobRole)}
                        disabled={!cobEmpId || !cobRole}
                        style={{ padding:'5px 14px', borderRadius:2, background: cobEmpId && cobRole ? '#c8a030' : '#2a2a2a', color: cobEmpId && cobRole ? '#0a0a0a' : '#555', fontWeight:700, fontSize:'0.78rem', border:'none', cursor: cobEmpId && cobRole ? 'pointer' : 'not-allowed' }}>
                        Agregar
                      </button>
                    </div>
                  )}
                  {Object.keys(coberturas).length === 0 && !showCobPicker && (
                    <div style={{ fontSize:'0.72rem', color:'#555', marginTop:'0.25rem' }}>
                      Sin coberturas este turno · "Juan cubre a María en barra" → usá este picker
                    </div>
                  )}
                </div>
              )}

              {/* Pool totals */}
              {totals && (
                <div className="tips-pool-bar">
                  <div className="tips-pool-item">
                    <div className="tips-pool-label">Pool total</div>
                    <div className="tips-pool-val gold">{formatCRC(totals.totalPool)}</div>
                  </div>
                  <div className="tips-pool-item">
                    <div className="tips-pool-label">Total puntos</div>
                    <div className="tips-pool-val dim">{formatNum(totals.totalPoints)}</div>
                  </div>
                  <div className="tips-pool-item">
                    <div className="tips-pool-label">Valor por punto</div>
                    <div className="tips-pool-val teal">{formatCRC(totals.generalRate)}</div>
                  </div>
                  <div className="tips-pool-item">
                    <div className="tips-pool-label">Distribuido</div>
                    <div className="tips-pool-val gold">
                      {formatCRC(lines.filter(l => l.active).reduce((s, l) => s + l.take_home, 0))}
                    </div>
                  </div>
                </div>
              )}

              {/* Verificación del pool antes de cerrar */}
              {isManager && lines.some(l => l.active) && totals && (
                <div style={{ margin:'1rem 0', padding:'0.875rem', background:'#0d0f0d', border:'1px solid #1a2a1a', borderRadius:2 }}>
                  <div style={{ fontSize:'0.68rem', color:'#555', letterSpacing:'0.12em', textTransform:'uppercase', marginBottom:'0.5rem' }}>
                    ✓ Verificar monto total del pool antes de cerrar
                  </div>
                  <div style={{ display:'flex', gap:'0.75rem', alignItems:'center', flexWrap:'wrap' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:'0.5rem' }}>
                      <span style={{ fontSize:'0.78rem', color:'#888' }}>Monto contado:</span>
                      <input
                        type="number" min={0} step={100}
                        value={verifTotal}
                        onChange={e => setVerifTotal(e.target.value === '' ? '' : Number(e.target.value))}
                        placeholder="₡ Ingresar total..."
                        style={{ width:140, background:'#111', border:'1px solid #2a2a2a', color:'var(--t-gold)', padding:'5px 10px', borderRadius:2, fontSize:'0.85rem', fontFamily:'DM Mono, monospace' }}
                      />
                    </div>
                    {verifTotal !== '' && (() => {
                      const diff = Math.abs(Number(verifTotal) - totals.totalPool)
                      const ok   = diff <= 500
                      return (
                        <div style={{ display:'flex', alignItems:'center', gap:'0.4rem', padding:'4px 12px', borderRadius:2, background: ok ? 'rgba(74,154,106,.15)' : 'rgba(194,59,34,.15)', border:`1px solid ${ok ? '#4a9a6a' : '#c23b22'}` }}>
                          <span style={{ fontSize:'1rem' }}>{ok ? '✅' : '⚠️'}</span>
                          <span style={{ fontSize:'0.78rem', color: ok ? '#4a9a6a' : '#c23b22', fontWeight:700 }}>
                            {ok ? 'Pool verificado — cuadra' : `Diferencia: ₡ ${diff.toLocaleString('es-CR')}`}
                          </span>
                        </div>
                      )
                    })()}
                  </div>

                  {/* Si la diferencia supera ₡500 → exigir tipo + motivo antes de cerrar */}
                  {verifTotal !== '' && Math.abs(Number(verifTotal) - totals.totalPool) > 500 && (
                    <div style={{ marginTop:'0.75rem', display:'flex', gap:'0.5rem', flexWrap:'wrap', alignItems:'flex-end' }}>
                      <div>
                        <div style={{ fontSize:'0.62rem', color:'#888', marginBottom:3, textTransform:'uppercase', letterSpacing:'0.1em' }}>Tipo de diferencia *</div>
                        <select value={verifTipo} onChange={e => setVerifTipo(e.target.value)}
                          style={{ background:'#111', border:`1px solid ${verifTipo ? '#c23b22' : '#2a2a2a'}`, color: verifTipo ? 'var(--t-gold)' : '#888', padding:'5px 8px', borderRadius:2, fontSize:'0.78rem' }}>
                          <option value="">— seleccionar —</option>
                          <option value="Sobrante">Sobrante (contado &gt; pool)</option>
                          <option value="Faltante">Faltante (contado &lt; pool)</option>
                          <option value="Error de conteo">Error de conteo</option>
                          <option value="Otro">Otro</option>
                        </select>
                      </div>
                      <div style={{ flex:1, minWidth:180 }}>
                        <div style={{ fontSize:'0.62rem', color:'#888', marginBottom:3, textTransform:'uppercase', letterSpacing:'0.1em' }}>Motivo *</div>
                        <input type="text" value={verifMotivo} onChange={e => setVerifMotivo(e.target.value)}
                          placeholder="Explicá la diferencia…"
                          style={{ width:'100%', background:'#111', border:`1px solid ${verifMotivo.trim() ? '#c23b22' : '#2a2a2a'}`, color:'#e8e2d8', padding:'5px 10px', borderRadius:2, fontSize:'0.82rem' }} />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Cerrar turno */}
              {isManager && lines.some(l => l.active) && (
                <div className="tips-close-bar">
                  <button className="tips-btn-danger" onClick={handleCloseSession} disabled={closing}>
                    {closing ? 'Cerrando…' : '▶ Cerrar turno y guardar payouts'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ─── HISTORIAL / QUINCENAL / STATS — lazy-loaded ─── */}
      <Suspense fallback={<div style={{ padding:'3rem', textAlign:'center', opacity:0.4 }}>⏳</div>}>
        {view === 'historial' && (
          <div className="tips-body">
            <TipHistory
              sessions={sessions}
              employees={employees}
              rolePoints={rolePoints}
              onCalcReady={(id, calc) => setTipCalcCache(prev => ({ ...prev, [id]: calc }))}
              onDeleteSession={handleDeleteSession}
              onSaved={loadData}
              isManager={isManager}
            />
          </div>
        )}

        {view === 'quincenal' && (
          <div className="tips-body">
            <TipQuincenal
              sessions={sessions}
              calcCache={tipCalcCache}
              employees={employees}
              rolePoints={rolePoints}
            />
          </div>
        )}

        {view === 'stats' && (
          <div className="tips-body">
            <TipStats
              sessions={sessions}
              calcCache={tipCalcCache}
              employees={employees}
              rolePoints={rolePoints}
            />
          </div>
        )}

        {view === 'cocina' && isManager && (
          <div className="tips-body">
            <TipCocina employees={employees} />
          </div>
        )}
      </Suspense>
    </div>
  )
}

// ── Componente fila de empleado ────────────────────────────────

interface TipLineRowProps {
  line: DraftLine
  isBar: boolean          // bar o cocina = sin campo propina
  isBarra: boolean        // SOLO barra (barman/barback) — tiene desglose pool barra + servicio
  generalRate: number     // ₡ por punto del pool general (para separar servicio)
  isManager: boolean
  shiftType: 'AM' | 'PM'
  onToggle: (checked: boolean) => void
  onHoursChange: (val: string) => void
  onPropinaChange: (field: 'propina_crc' | 'propina_usd', val: string) => void
  onBlur: () => void
}

function TipLineRow({ line, isBar, isBarra, generalRate, isManager, shiftType, onToggle, onHoursChange, onPropinaChange, onBlur }: TipLineRowProps) {
  const defaultHrs = shiftType === 'AM' ? 5 : (NO_PROPINA_ROLES.includes(line.role) ? 8 : 0)
  // Desglose para barra: servicio = puntos × ₡/pto del pool general; pool barra = resto del take home
  const servicio = Math.round((line.pts_val || 0) * generalRate)
  const poolBarra = Math.max(0, Math.round(line.take_home) - servicio)

  return (
    <div className={`tips-emp-row${line.active ? ' worked' : ''}`}>
      <label className="tips-emp-label" htmlFor={`chk-${line.employeeId}`}>
        {isManager ? (
          <input
            type="checkbox"
            id={`chk-${line.employeeId}`}
            className="tips-emp-chk"
            checked={line.active}
            onChange={e => onToggle(e.target.checked)}
          />
        ) : (
          <span className={`tips-emp-dot ${line.active ? 'active' : ''}`} />
        )}
        <span className="tips-emp-name">{line.employeeName}</span>
      </label>

      {line.active && (
        <div className={`tips-emp-fields ${isBar ? 'three-col' : 'four-col'}`}>
          {/* Horas */}
          <div className="tips-emp-field">
            <div className="tips-emp-field-label">Horas</div>
            <input
              type="number" className="tips-emp-input" min={0} max={24} step={0.25}
              value={line.hours}
              placeholder={String(defaultHrs)}
              onChange={e => onHoursChange(e.target.value)}
              onBlur={onBlur}
              disabled={!isManager}
            />
          </div>

          {/* Propina CRC+USD — solo para roles de sala */}
          {!isBar && (
            <>
              <div className="tips-emp-field">
                <div className="tips-emp-field-label">Propina ₡</div>
                <div className="tips-money-wrap">
                  <span className="tips-money-sm-prefix">₡</span>
                  <input
                    type="number" className="tips-emp-input-money" min={0} step={100}
                    value={line.propina_crc} placeholder="0"
                    onChange={e => onPropinaChange('propina_crc', e.target.value)}
                    onBlur={onBlur}
                    disabled={!isManager}
                  />
                </div>
              </div>
              <div className="tips-emp-field">
                <div className="tips-emp-field-label">Propina $</div>
                <div className="tips-money-wrap">
                  <span className="tips-money-sm-prefix">$</span>
                  <input
                    type="number" className="tips-emp-input-money" min={0} step={0.01}
                    value={line.propina_usd} placeholder="0"
                    onChange={e => onPropinaChange('propina_usd', e.target.value)}
                    onBlur={onBlur}
                    disabled={!isManager}
                  />
                </div>
              </div>
            </>
          )}

          {/* Puntos */}
          <div className="tips-emp-field">
            <div className="tips-emp-field-label">Puntos</div>
            <div className="tips-pts-badge">
              {line.pts_val > 0 ? formatNum(line.pts_val) : '—'}
            </div>
          </div>

          {/* Take home */}
          <div className="tips-emp-field">
            <div className="tips-emp-field-label">Take Home</div>
            <div className={`tips-take-badge${line.take_home > 0 ? '' : ' zero'}`}>
              {line.take_home > 0 ? formatCRC(line.take_home) : '₡ —'}
            </div>
            {/* Desglose de barra: pool barra exclusivo + parte del servicio general */}
            {isBarra && line.take_home > 0 && (
              <div style={{ fontSize: '0.6rem', color: '#5a5040', marginTop: 3, lineHeight: 1.4, textAlign: 'right', whiteSpace: 'nowrap' }}>
                <div>🍸 Pool barra <strong style={{ color: '#a07830' }}>{formatCRC(poolBarra)}</strong></div>
                <div>Servicio <strong style={{ color: '#2a7a6a' }}>{formatCRC(servicio)}</strong></div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
