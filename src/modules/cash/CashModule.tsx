import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../shared/hooks/useAuth'
import {
  getOpenCashSession,
  getCashSessions,
  getCashMovements,
  createCashSession,
  closeCashSession,
  createCashMovement,
  deleteCashMovement,
  getSuppliers,
} from '../../shared/api/cash'
import type { CashSession, CashMovement, Supplier, MovementType } from '../../shared/types/database'

type View = 'turno' | 'historial'

const MOVEMENT_LABELS: Record<MovementType, string> = {
  ingreso:           'Ingreso',
  egreso_mercaderia: 'Egreso mercadería',
  egreso_personal:   'Egreso personal',
  egreso_operativo:  'Egreso operativo',
  egreso_socios:     'Egreso socios',
  traspaso:          'Traspaso',
}

const MOVEMENT_TYPES: MovementType[] = [
  'ingreso',
  'egreso_mercaderia',
  'egreso_personal',
  'egreso_operativo',
  'egreso_socios',
  'traspaso',
]

function isEgreso(t: MovementType) {
  return t !== 'ingreso' && t !== 'traspaso'
}

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatCRC(n: number) {
  return '₡ ' + Math.round(n).toLocaleString('es-CR')
}

export default function CashModule() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const canManage = profile?.role === 'owner' || profile?.role === 'manager' || profile?.role === 'cajero'

  const [view, setView] = useState<View>('turno')

  // Data
  const [openSession, setOpenSession]   = useState<CashSession | null>(null)
  const [sessions, setSessions]         = useState<CashSession[]>([])
  const [movements, setMovements]       = useState<CashMovement[]>([])
  const [suppliers, setSuppliers]       = useState<Supplier[]>([])

  // UI state
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState<string | null>(null)
  const [showNewSession, setShowNewSession] = useState(false)
  const [showCloseForm, setShowCloseForm]   = useState(false)
  const [showAddMovement, setShowAddMovement] = useState(false)
  const [saving, setSaving]             = useState(false)

  // New session form
  const [newDate, setNewDate]               = useState(todayStr())
  const [newServiceCRC, setNewServiceCRC]   = useState<number | ''>(0)
  const [newSuppliersCRC, setNewSuppliersCRC] = useState<number | ''>(0)

  // Close session form
  const [closeSvcCRC, setCloseSvcCRC]       = useState<number | ''>(0)
  const [closeProvCRC, setCloseProvCRC]     = useState<number | ''>(0)
  const [closeSafeCRC, setCloseSafeCRC]     = useState<number | ''>(0)
  const [closeBankCRC, setCloseBankCRC]     = useState<number | ''>(0)
  const [closeNotes, setCloseNotes]         = useState('')

  // Add movement form
  const [movType, setMovType]               = useState<MovementType>('ingreso')
  const [movAmount, setMovAmount]           = useState<number | ''>('')
  const [movCurrency, setMovCurrency]       = useState<'CRC' | 'USD'>('CRC')
  const [movExRate, setMovExRate]           = useState<number | ''>(640)
  const [movDesc, setMovDesc]               = useState('')
  const [movSupplier, setMovSupplier]       = useState('')

  // History
  const [expandedId, setExpandedId]         = useState<string | null>(null)
  const [histMovements, setHistMovements]   = useState<Record<string, CashMovement[]>>({})
  const [histLoading, setHistLoading]       = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [open, all, supps] = await Promise.all([
        getOpenCashSession(),
        getCashSessions(),
        getSuppliers(),
      ])
      setOpenSession(open)
      setSessions(all)
      setSuppliers(supps)
      if (open) {
        const movs = await getCashMovements(open.id)
        setMovements(movs)
      } else {
        setMovements([])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando datos')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // ── Abrir sesión ───────────────────────────────────────────
  const handleCreateSession = async () => {
    if (!profile) return
    setSaving(true)
    try {
      const session = await createCashSession({
        session_date:          newDate,
        opened_by:             profile.id,
        initial_service_crc:   Number(newServiceCRC) || 0,
        initial_suppliers_crc: Number(newSuppliersCRC) || 0,
      })
      setOpenSession(session)
      setMovements([])
      setShowNewSession(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error abriendo turno')
    } finally {
      setSaving(false)
    }
  }

  // ── Cerrar sesión ──────────────────────────────────────────
  const handleCloseSession = async () => {
    if (!openSession || !profile) return
    setSaving(true)
    try {
      await closeCashSession(
        openSession.id,
        {
          final_service_crc:   Number(closeSvcCRC) || 0,
          final_suppliers_crc: Number(closeProvCRC) || 0,
          final_safe_crc:      Number(closeSafeCRC) || 0,
          final_bank_crc:      Number(closeBankCRC) || 0,
          notes:               closeNotes || undefined,
        },
        profile.id,
      )
      setOpenSession(null)
      setMovements([])
      setShowCloseForm(false)
      // Reset close form
      setCloseSvcCRC(0)
      setCloseProvCRC(0)
      setCloseSafeCRC(0)
      setCloseBankCRC(0)
      setCloseNotes('')
      await loadData()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cerrando turno')
    } finally {
      setSaving(false)
    }
  }

  // ── Agregar movimiento ─────────────────────────────────────
  const handleAddMovement = async () => {
    if (!openSession || !profile) return
    if (!movDesc.trim()) { setError('Ingresá una descripción'); return }
    if (!movAmount || Number(movAmount) <= 0) { setError('Ingresá un monto válido'); return }

    const amountCRC = movCurrency === 'USD'
      ? Math.round(Number(movAmount) * (Number(movExRate) || 640))
      : Math.round(Number(movAmount))

    setSaving(true)
    try {
      const mov = await createCashMovement({
        session_id:    openSession.id,
        created_by:    profile.id,
        movement_type: movType,
        amount_crc:    amountCRC,
        currency:      movCurrency,
        exchange_rate: movCurrency === 'USD' ? (Number(movExRate) || 640) : null,
        description:   movDesc.trim(),
        supplier_id:   movSupplier || null,
      })
      setMovements(prev => [...prev, mov])
      // Reset form
      setMovDesc('')
      setMovAmount('')
      setMovCurrency('CRC')
      setMovSupplier('')
      setShowAddMovement(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error registrando movimiento')
    } finally {
      setSaving(false)
    }
  }

  // ── Eliminar movimiento ────────────────────────────────────
  const handleDeleteMovement = async (id: string) => {
    try {
      await deleteCashMovement(id)
      setMovements(prev => prev.filter(m => m.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error eliminando movimiento')
    }
  }

  // ── Expandir historial ─────────────────────────────────────
  const handleExpandHistory = async (s: CashSession) => {
    if (expandedId === s.id) { setExpandedId(null); return }
    setExpandedId(s.id)
    if (histMovements[s.id]) return
    setHistLoading(s.id)
    try {
      const movs = await getCashMovements(s.id)
      setHistMovements(prev => ({ ...prev, [s.id]: movs }))
    } finally {
      setHistLoading(null)
    }
  }

  // ── Cálculos de la sesión ──────────────────────────────────
  const totalIngresos = movements
    .filter(m => m.movement_type === 'ingreso')
    .reduce((s, m) => s + m.amount_crc, 0)

  const totalEgresos = movements
    .filter(m => isEgreso(m.movement_type))
    .reduce((s, m) => s + m.amount_crc, 0)

  const totalTraspasos = movements
    .filter(m => m.movement_type === 'traspaso')
    .reduce((s, m) => s + m.amount_crc, 0)

  // ── Loading ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="module-loading">
        <span className="loading-mark">金</span>
      </div>
    )
  }

  return (
    <div className="tips-module">

      {/* Header */}
      <div className="tips-header">
        <div className="tips-header-left">
          <span className="tips-kanji">金</span>
          <div>
            <h2 className="tips-title">Caja</h2>
            <p className="tips-subtitle">Turnos y movimientos · Satori</p>
          </div>
        </div>
        <div className="tips-header-right">
          <div className="tips-tabs">
            <button className={`tips-tab ${view === 'turno' ? 'active' : ''}`} onClick={() => setView('turno')}>
              Turno actual
            </button>
            <button className={`tips-tab ${view === 'historial' ? 'active' : ''}`} onClick={() => setView('historial')}>
              Historial
            </button>
          </div>
          <button className="cash-back-btn" onClick={() => navigate('/')} title="Inicio">
            ← Inicio
          </button>
        </div>
      </div>

      {error && (
        <div className="tips-error">
          <span>{error}</span>
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* ── TURNO ACTUAL ── */}
      {view === 'turno' && (
        <div className="tips-body">

          {/* Sin sesión — estado vacío */}
          {!openSession && !showNewSession && (
            <div className="tips-empty-state">
              <p className="tips-empty-text">No hay turno de caja abierto</p>
              {canManage && (
                <button className="tips-btn-primary" onClick={() => setShowNewSession(true)}>
                  Abrir turno de caja
                </button>
              )}
            </div>
          )}

          {/* Formulario abrir sesión */}
          {!openSession && showNewSession && (
            <div className="tips-new-session">
              <div className="tips-section-label">Nuevo turno de caja</div>
              <div className="tips-config-grid">
                <div className="tips-field">
                  <div className="tips-field-label">Fecha</div>
                  <input type="date" className="tips-input-dark" value={newDate}
                    onChange={e => setNewDate(e.target.value)} />
                </div>
                <div className="tips-field">
                  <div className="tips-field-label">Fondo servicio (₡)</div>
                  <input type="number" className="tips-input-dark" value={newServiceCRC} min={0} step={1000}
                    onChange={e => setNewServiceCRC(e.target.value === '' ? '' : Number(e.target.value))} />
                </div>
                <div className="tips-field">
                  <div className="tips-field-label">Fondo proveedores (₡)</div>
                  <input type="number" className="tips-input-dark" value={newSuppliersCRC} min={0} step={1000}
                    onChange={e => setNewSuppliersCRC(e.target.value === '' ? '' : Number(e.target.value))} />
                </div>
              </div>
              <div className="tips-new-session-actions">
                <button className="tips-btn-teal" onClick={handleCreateSession} disabled={saving}>
                  {saving ? 'Abriendo…' : '▶ Abrir turno'}
                </button>
                <button className="tips-btn-ghost" onClick={() => setShowNewSession(false)}>
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* Sesión abierta */}
          {openSession && !showCloseForm && (
            <>
              {/* Config bar */}
              <div className="tips-config-bar">
                <div className="tips-config-meta">
                  <strong>{openSession.session_date}</strong>
                </div>
                <div className="tips-config-meta">
                  Fondo inicial: <strong>{formatCRC(openSession.initial_service_crc + openSession.initial_suppliers_crc)}</strong>
                </div>
                <div className="tips-config-meta tips-status-open">
                  ● Abierto
                </div>
              </div>

              {/* Summary bar */}
              <div className="cash-summary-bar">
                <div className="cash-summary-item">
                  <div className="cash-summary-label">Ingresos</div>
                  <div className="cash-summary-val green">{formatCRC(totalIngresos)}</div>
                </div>
                <div className="cash-summary-item">
                  <div className="cash-summary-label">Egresos</div>
                  <div className="cash-summary-val red">{formatCRC(totalEgresos)}</div>
                </div>
                {totalTraspasos > 0 && (
                  <div className="cash-summary-item">
                    <div className="cash-summary-label">Traspasos</div>
                    <div className="cash-summary-val dim">{formatCRC(totalTraspasos)}</div>
                  </div>
                )}
                <div className="cash-summary-item">
                  <div className="cash-summary-label">Saldo neto</div>
                  <div className={`cash-summary-val ${totalIngresos - totalEgresos >= 0 ? 'gold' : 'red'}`}>
                    {formatCRC(totalIngresos - totalEgresos)}
                  </div>
                </div>
              </div>

              {/* Lista de movimientos */}
              <div className="cash-movements-list">
                {movements.length === 0 && (
                  <div className="cash-empty-movements">Sin movimientos registrados aún</div>
                )}
                {movements.map(m => (
                  <div key={m.id} className={`cash-mov-row ${m.movement_type}`}>
                    <div className="cash-mov-left">
                      <span className={`cash-mov-type-badge ${m.movement_type}`}>
                        {MOVEMENT_LABELS[m.movement_type]}
                      </span>
                      <span className="cash-mov-desc">{m.description}</span>
                    </div>
                    <div className="cash-mov-right">
                      <span className={`cash-mov-amount ${m.movement_type === 'ingreso' ? 'green' : isEgreso(m.movement_type) ? 'red' : 'dim'}`}>
                        {m.movement_type === 'ingreso' ? '+' : isEgreso(m.movement_type) ? '−' : ''}{formatCRC(m.amount_crc)}
                      </span>
                      {canManage && (
                        <button
                          className="cash-mov-del"
                          onClick={() => handleDeleteMovement(m.id)}
                          title="Eliminar"
                        >✕</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Agregar movimiento */}
              {canManage && !showAddMovement && (
                <div className="cash-actions-bar">
                  <button className="tips-btn-teal" onClick={() => setShowAddMovement(true)}>
                    + Agregar movimiento
                  </button>
                  <button className="tips-btn-danger" onClick={() => setShowCloseForm(true)}>
                    Cerrar turno
                  </button>
                </div>
              )}

              {canManage && showAddMovement && (
                <div className="cash-add-form">
                  <div className="tips-section-label">Nuevo movimiento</div>
                  <div className="cash-form-grid">
                    <div className="tips-field">
                      <div className="tips-field-label">Tipo</div>
                      <select className="tips-input-dark" value={movType}
                        onChange={e => setMovType(e.target.value as MovementType)}>
                        {MOVEMENT_TYPES.map(t => (
                          <option key={t} value={t}>{MOVEMENT_LABELS[t]}</option>
                        ))}
                      </select>
                    </div>
                    <div className="tips-field">
                      <div className="tips-field-label">Moneda</div>
                      <select className="tips-input-dark" value={movCurrency}
                        onChange={e => setMovCurrency(e.target.value as 'CRC' | 'USD')}>
                        <option value="CRC">₡ Colones</option>
                        <option value="USD">$ Dólares</option>
                      </select>
                    </div>
                    <div className="tips-field">
                      <div className="tips-field-label">Monto {movCurrency === 'USD' ? '($)' : '(₡)'}</div>
                      <input type="number" className="tips-input-dark" value={movAmount} min={0}
                        step={movCurrency === 'USD' ? 1 : 1000}
                        onChange={e => setMovAmount(e.target.value === '' ? '' : Number(e.target.value))}
                        placeholder="0" />
                    </div>
                    {movCurrency === 'USD' && (
                      <div className="tips-field">
                        <div className="tips-field-label">Tipo de cambio (₡/USD)</div>
                        <input type="number" className="tips-input-dark" value={movExRate} min={1}
                          onChange={e => setMovExRate(Number(e.target.value) || 640)} />
                      </div>
                    )}
                    <div className="tips-field cash-form-desc">
                      <div className="tips-field-label">Descripción</div>
                      <input type="text" className="tips-input-dark" value={movDesc}
                        onChange={e => setMovDesc(e.target.value)}
                        placeholder="Ej: Pago proveedor, venta mesa 5…" />
                    </div>
                    {suppliers.length > 0 && (movType === 'egreso_mercaderia') && (
                      <div className="tips-field">
                        <div className="tips-field-label">Proveedor (opcional)</div>
                        <select className="tips-input-dark" value={movSupplier}
                          onChange={e => setMovSupplier(e.target.value)}>
                          <option value="">— Sin proveedor —</option>
                          {suppliers.map(s => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                  {movCurrency === 'USD' && movAmount && (
                    <div className="cash-preview-crc">
                      Equivalente: <strong>{formatCRC(Number(movAmount) * (Number(movExRate) || 640))}</strong>
                    </div>
                  )}
                  <div className="tips-new-session-actions">
                    <button className="tips-btn-teal" onClick={handleAddMovement} disabled={saving}>
                      {saving ? 'Guardando…' : '✓ Guardar'}
                    </button>
                    <button className="tips-btn-ghost" onClick={() => {
                      setShowAddMovement(false)
                      setMovDesc('')
                      setMovAmount('')
                      setMovCurrency('CRC')
                      setMovSupplier('')
                      setError(null)
                    }}>
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Formulario cerrar sesión */}
          {openSession && showCloseForm && (
            <div className="tips-new-session">
              <div className="tips-section-label">Cierre de turno — {openSession.session_date}</div>
              <div className="cash-close-summary">
                <div className="cash-close-row">
                  <span>Movimientos registrados</span>
                  <span><strong>{movements.length}</strong></span>
                </div>
                <div className="cash-close-row">
                  <span>Total ingresos</span>
                  <span className="green"><strong>{formatCRC(totalIngresos)}</strong></span>
                </div>
                <div className="cash-close-row">
                  <span>Total egresos</span>
                  <span className="red"><strong>{formatCRC(totalEgresos)}</strong></span>
                </div>
              </div>
              <div className="tips-section-label" style={{ marginTop: '1rem' }}>Conteo final de caja</div>
              <div className="tips-config-grid">
                <div className="tips-field">
                  <div className="tips-field-label">Caja servicio (₡)</div>
                  <input type="number" className="tips-input-dark" value={closeSvcCRC} min={0} step={1000}
                    onChange={e => setCloseSvcCRC(e.target.value === '' ? '' : Number(e.target.value))} />
                </div>
                <div className="tips-field">
                  <div className="tips-field-label">Caja proveedores (₡)</div>
                  <input type="number" className="tips-input-dark" value={closeProvCRC} min={0} step={1000}
                    onChange={e => setCloseProvCRC(e.target.value === '' ? '' : Number(e.target.value))} />
                </div>
                <div className="tips-field">
                  <div className="tips-field-label">Caja fuerte (₡)</div>
                  <input type="number" className="tips-input-dark" value={closeSafeCRC} min={0} step={1000}
                    onChange={e => setCloseSafeCRC(e.target.value === '' ? '' : Number(e.target.value))} />
                </div>
                <div className="tips-field">
                  <div className="tips-field-label">Depósito banco (₡)</div>
                  <input type="number" className="tips-input-dark" value={closeBankCRC} min={0} step={1000}
                    onChange={e => setCloseBankCRC(e.target.value === '' ? '' : Number(e.target.value))} />
                </div>
                <div className="tips-field cash-form-desc">
                  <div className="tips-field-label">Notas (opcional)</div>
                  <input type="text" className="tips-input-dark" value={closeNotes}
                    onChange={e => setCloseNotes(e.target.value)}
                    placeholder="Observaciones del cierre…" />
                </div>
              </div>
              <div className="tips-new-session-actions">
                <button className="tips-btn-danger" onClick={handleCloseSession} disabled={saving}>
                  {saving ? 'Cerrando…' : '▶ Confirmar cierre'}
                </button>
                <button className="tips-btn-ghost" onClick={() => setShowCloseForm(false)}>
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── HISTORIAL ── */}
      {view === 'historial' && (
        <div className="tips-body">
          {sessions.filter(s => s.status === 'closed').length === 0 && (
            <div className="tips-empty-state">
              <p className="tips-empty-text">No hay turnos cerrados aún</p>
            </div>
          )}
          {sessions.filter(s => s.status === 'closed').map(s => {
            const isOpen = expandedId === s.id
            const movs   = histMovements[s.id] ?? []
            const isLoad = histLoading === s.id
            const ingresos = movs.filter(m => m.movement_type === 'ingreso').reduce((a, m) => a + m.amount_crc, 0)
            const egresos  = movs.filter(m => isEgreso(m.movement_type)).reduce((a, m) => a + m.amount_crc, 0)

            return (
              <div key={s.id} className={`hist-item${isOpen ? ' open' : ''}`}
                onClick={() => handleExpandHistory(s)}>
                <div className="hist-header">
                  <div>
                    <div className="hist-fecha">{s.session_date}</div>
                    <div className="hist-meta">
                      {isOpen && movs.length > 0 ? `${movs.length} movimientos` : ''}
                    </div>
                  </div>
                  <div className="hist-right">
                    {isOpen && movs.length > 0 && (
                      <div className="hist-total">{formatCRC(ingresos)}</div>
                    )}
                    <span className="hist-toggle">{isOpen ? '▲' : '▼'}</span>
                  </div>
                </div>

                {isOpen && (
                  <div className="hist-body" onClick={e => e.stopPropagation()}>
                    {isLoad && <div className="hist-loading">Cargando…</div>}
                    {!isLoad && movs.length === 0 && (
                      <div className="cash-empty-movements">Sin movimientos</div>
                    )}
                    {!isLoad && movs.length > 0 && (
                      <>
                        {/* Fondos iniciales / finales */}
                        <div className="cash-hist-funds">
                          <div className="cash-hist-fund-row">
                            <span className="dim">Fondo inicial</span>
                            <span>{formatCRC(s.initial_service_crc + s.initial_suppliers_crc)}</span>
                          </div>
                          {s.final_service_crc != null && (
                            <div className="cash-hist-fund-row">
                              <span className="dim">Cierre servicio</span>
                              <span>{formatCRC(s.final_service_crc)}</span>
                            </div>
                          )}
                          {s.final_suppliers_crc != null && (
                            <div className="cash-hist-fund-row">
                              <span className="dim">Cierre proveedores</span>
                              <span>{formatCRC(s.final_suppliers_crc)}</span>
                            </div>
                          )}
                          {s.final_safe_crc != null && (
                            <div className="cash-hist-fund-row">
                              <span className="dim">Caja fuerte</span>
                              <span>{formatCRC(s.final_safe_crc)}</span>
                            </div>
                          )}
                          {s.final_bank_crc != null && (
                            <div className="cash-hist-fund-row">
                              <span className="dim">Banco</span>
                              <span>{formatCRC(s.final_bank_crc)}</span>
                            </div>
                          )}
                        </div>

                        {/* Pool de movimientos */}
                        <div className="hist-pool-row">
                          <span>Ingresos <strong className="green">{formatCRC(ingresos)}</strong></span>
                          <span>Egresos <strong className="red">{formatCRC(egresos)}</strong></span>
                          <span>Neto <strong>{formatCRC(ingresos - egresos)}</strong></span>
                        </div>

                        {/* Lista */}
                        <div className="cash-hist-movs">
                          {movs.map(m => (
                            <div key={m.id} className="hist-emp-row">
                              <div>
                                <div className="hist-emp-name">{m.description}</div>
                                <div className="hist-emp-meta">{MOVEMENT_LABELS[m.movement_type]}</div>
                              </div>
                              <div className={`hist-emp-take ${m.movement_type === 'ingreso' ? 'green' : isEgreso(m.movement_type) ? 'red' : 'dim'}`}>
                                {m.movement_type === 'ingreso' ? '+' : isEgreso(m.movement_type) ? '−' : ''}{formatCRC(m.amount_crc)}
                              </div>
                            </div>
                          ))}
                        </div>

                        {s.notes && (
                          <div className="cash-hist-notes">📝 {s.notes}</div>
                        )}
                      </>
                    )}
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
