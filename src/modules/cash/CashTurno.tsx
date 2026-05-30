import { useState, useCallback } from 'react'
import { useAuth } from '../../shared/hooks/useAuth'
import type { CashSession, CashMovement, Supplier, MovementType } from '../../shared/types/database'
import {
  createCashSession,
  closeCashSession,
  createCashMovement,
} from '../../shared/api/cash'
import { fi, fd, todayStr } from './cashUtils'
import { getActiveEmployees } from '../../shared/api/tips'
import type { Employee } from '../../shared/types/database'

interface Props {
  openSession:    CashSession | null
  suppliers:      Supplier[]
  sessions:           CashSession[]         // to detect if Mediodía/Noche already exists today
  sessionMovements:   CashMovement[]        // DB movements for current open session
  onSessionOpen:      (s: CashSession) => void
  onSessionClose:     () => void
  onMovAdded:         (m: CashMovement) => void
  onError:            (msg: string) => void
}

type ViewState = 'apertura' | 'turno' | 'cierre'

interface PagoRow {
  id:            string
  supplier_id:   string
  supplier_name: string
  supplier_cat:  string
  amount_crc:    number | ''
  amount_usd:    number | ''
  method:        'Efectivo' | 'Transferencia'
  reference:     string
}

export default function CashTurno({
  openSession, suppliers, sessions, sessionMovements,
  onSessionOpen, onSessionClose, onMovAdded, onError,
}: Props) {
  const { profile } = useAuth()
  const canManage = profile?.role === 'owner' || profile?.role === 'manager' || profile?.role === 'cajero'
  const canClose  = profile?.role === 'owner' || profile?.role === 'manager'

  // Determine if Mediodía/Noche already exists today for apertura
  const today = todayStr()
  const hoyTurnos = sessions.filter(s => s.session_date === today && s.status === 'closed')
  const tieneMediodia = hoyTurnos.some(s => s.shift_type === 'Mediodía')
  const tieneNoche    = hoyTurnos.some(s => s.shift_type === 'Noche')
  const defaultShift  = !tieneMediodia ? 'Mediodía' : !tieneNoche ? 'Noche' : ''
  const bothDone      = tieneMediodia && tieneNoche

  const [view, setView] = useState<ViewState>(openSession ? 'turno' : 'apertura')

  // Apertura form
  const [apFecha,   setApFecha]   = useState(today)
  // apTurno derived from sessions — auto-detects Mediodía vs Noche
  const apTurno = defaultShift
  const [apCajero,  setApCajero]  = useState(profile?.full_name ?? '')
  const [employees, setEmployees] = useState<Employee[]>([])
  useState(() => { getActiveEmployees().then(setEmployees).catch(() => {}) })
  const [apCRC,      setApCRC]      = useState<number | ''>(0)   // fondo servicio (registradora)
  const [apProvCRC,  setApProvCRC]  = useState<number | ''>(0)   // fondo proveedores (caja separada)
  const [apUSD,      setApUSD]      = useState<number | ''>(0)
  const [saving,     setSaving]     = useState(false)

  // Turno state: pagos + ingresos adicionales
  const [pagos,    setPagos]    = useState<PagoRow[]>([])
  const [ingresos, setIngresos] = useState<Array<{ id: string; crc: number | ''; usd: number | ''; nota: string }>>([])

  // Cierre form
  const [cierreCRC,   setCierreCRC]   = useState<number | ''>(0)
  const [cierreUSD,   setCierreUSD]   = useState<number | ''>(0)
  const [cierreSafe,  setCierreSafe]  = useState<number | ''>(0)
  const [cierreBank,  setCierreBank]  = useState<number | ''>(0)
  const [cierreNotas, setCierreNotas] = useState('')
  const [showResumen, setShowResumen] = useState(false)

  // ── Calculated totals ────────────────────────────────────
  const initCRC     = openSession ? openSession.initial_cash_crc : 0
  const initProvCRC = openSession ? openSession.initial_suppliers_crc : 0
  const initUSD     = openSession ? openSession.initial_cash_usd : 0
  const pagosEf  = pagos.filter(p => p.supplier_id && p.method === 'Efectivo')
                        .reduce((s, p) => s + (Number(p.amount_crc) || 0), 0)
  const pagosTr  = pagos.filter(p => p.supplier_id && p.method === 'Transferencia')
                        .reduce((s, p) => s + (Number(p.amount_crc) || 0), 0)
  const ingresosTotal = ingresos.reduce((s, i) => s + (Number(i.crc) || 0), 0)
  const totalAsig = initCRC + ingresosTotal

  // BUG-1 FIX: subtract DB egresos (efectivo) already registered in this session.
  // This includes propinas paid out via Caja↔Propinas integration and any other
  // egreso_personal/operativo/socios registered as Efectivo.
  const dbEgresosEfectivo = sessionMovements
    .filter(m => m.movement_type !== 'ingreso' && m.movement_type !== 'traspaso'
              && m.method === 'Efectivo' && m.status !== 'pendiente' && m.status !== 'rechazado')
    .reduce((s, m) => s + m.amount_crc, 0)

  const deberiaCRC = totalAsig - pagosEf - dbEgresosEfectivo
  const cierreVal  = Number(cierreCRC) || 0
  const diferencia = cierreVal ? cierreVal - deberiaCRC : null
  const cuadra     = diferencia !== null && Math.abs(diferencia) < 500

  // ── Apertura ─────────────────────────────────────────────
  const handleApertura = useCallback(async () => {
    if (!profile) return
    if (!apCajero) { onError('Seleccioná un cajero'); return }
    if (!apTurno)  { onError('El turno está bloqueado — ambos turnos del día ya fueron registrados'); return }
    const dup = sessions.find(s => s.session_date === apFecha && s.shift_type === apTurno)
    if (dup) { onError(`Ya existe un turno ${apTurno} del ${apFecha}`); return }

    setSaving(true)
    try {
      const session = await createCashSession({
        session_date:          apFecha,
        shift_type:            apTurno,
        opened_by:             profile.id,
        cajero_name:           apCajero,
        initial_cash_crc:      Number(apCRC) || 0,
        initial_cash_usd:      Number(apUSD) || 0,
        initial_suppliers_crc: Number(apProvCRC) || 0,
      })
      onSessionOpen(session)
      setView('turno')
      setPagos([])
      setIngresos([])
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Error abriendo turno')
    } finally {
      setSaving(false)
    }
  }, [profile, apCajero, apTurno, apFecha, apCRC, apProvCRC, apUSD, sessions, onSessionOpen, onError])

  // ── Add pago ──────────────────────────────────────────────
  const addPago = () => {
    setPagos(prev => [...prev, {
      id:            crypto.randomUUID(),
      supplier_id:   '',
      supplier_name: '',
      supplier_cat:  '',
      amount_crc:    '',
      amount_usd:    '',
      method:        'Efectivo',
      reference:     '',
    }])
  }
  const removePago = (id: string) => setPagos(prev => prev.filter(p => p.id !== id))
  const updatePago = (id: string, field: keyof PagoRow, value: unknown) =>
    setPagos(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p))

  // ── Add ingreso ───────────────────────────────────────────
  const addIngreso = () => setIngresos(prev => [...prev, { id: crypto.randomUUID(), crc: '', usd: '', nota: '' }])
  const removeIngreso = (id: string) => setIngresos(prev => prev.filter(i => i.id !== id))
  const updateIngreso = (id: string, field: string, value: unknown) =>
    setIngresos(prev => prev.map(i => i.id === id ? { ...i, [field]: value } : i))

  // ── Confirmar cierre ──────────────────────────────────────
  const handleCierre = useCallback(async () => {
    if (!openSession || !profile) return
    setSaving(true)
    try {
      // Save all pagos as movements
      await Promise.all(pagos.filter(p => p.supplier_id).map(p =>
        createCashMovement({
          session_id:    openSession.id,
          created_by:    profile.id,
          movement_type: 'egreso_mercaderia' as MovementType,
          amount_crc:    Number(p.amount_crc) || 0,
          amount_usd:    Number(p.amount_usd) || 0,
          currency:      'CRC',
          exchange_rate: null,
          description:   p.supplier_name || 'Proveedor',
          subcategory:   'Proveedor mercadería',
          supplier_id:   p.supplier_id || null,
          supplier_name: p.supplier_name,
          method:        p.method,
          caja_origen:   'Caja Proveedores',
          shift:         openSession.shift_type,
        }).then(m => onMovAdded(m))
      ))
      // Save ingresos adicionales
      await Promise.all(ingresos.filter(i => Number(i.crc) > 0 || Number(i.usd) > 0).map(i =>
        createCashMovement({
          session_id:    openSession.id,
          created_by:    profile.id,
          movement_type: 'ingreso' as MovementType,
          amount_crc:    Number(i.crc) || 0,
          amount_usd:    Number(i.usd) || 0,
          currency:      'CRC',
          exchange_rate: null,
          description:   i.nota || 'Ingreso adicional',
          method:        'Efectivo',
          caja_origen:   'Registradora',
          shift:         openSession.shift_type,
        }).then(m => onMovAdded(m))
      ))
      // Close session
      await closeCashSession(
        openSession.id,
        {
          final_cash_crc: Number(cierreCRC) || 0,
          final_cash_usd: Number(cierreUSD) || 0,
          final_safe_crc: Number(cierreSafe) || 0,
          final_bank_crc: Number(cierreBank) || 0,
          notes:          cierreNotas || undefined,
        },
        profile.id,
      )
      onSessionClose()
      setPagos([])
      setIngresos([])
      setShowResumen(false)
      setCierreCRC(0)
      setCierreUSD(0)
      setView('apertura')
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Error cerrando turno')
    } finally {
      setSaving(false)
    }
  }, [openSession, profile, pagos, ingresos, cierreCRC, cierreUSD, cierreSafe, cierreBank, cierreNotas,
      onSessionClose, onMovAdded, onError])

  // ────────────────────────────────────────────────────────
  // ── APERTURA VIEW ─────────────────────────────────────
  // ────────────────────────────────────────────────────────
  if (!openSession) {
    return (
      <div className="cd-wrap">
        <div className="cd-apertura-header">
          <div className="cd-apertura-title">Apertura de Turno</div>
          <div className="cd-apertura-sub">Confirmá el saldo inicial antes de empezar</div>
        </div>
        <div className="cd-apertura-body">

          {bothDone && (
            <div className="cd-warn">
              ⚠ Ambos turnos del día ({today}) ya fueron registrados
            </div>
          )}

          {!bothDone && (
            <>
              <div className="cd-grid3">
                <div className="tips-field">
                  <div className="tips-field-label">Cajero</div>
                  <select className="tips-input-dark" value={apCajero}
                    onChange={e => setApCajero(e.target.value)}>
                    <option value="">-- Seleccioná --</option>
                    {employees.map(e => <option key={e.id} value={e.full_name}>{e.full_name}</option>)}
                  </select>
                </div>
                <div className="tips-field">
                  <div className="tips-field-label">Turno</div>
                  <div className={`cd-turno-display ${apTurno ? 'ok' : 'blocked'}`}>
                    {apTurno || '⚠ Sin turno disponible'}
                  </div>
                </div>
                <div className="tips-field">
                  <div className="tips-field-label">Fecha</div>
                  <input type="date" className="tips-input-dark" value={apFecha}
                    onChange={e => setApFecha(e.target.value)} />
                </div>
              </div>

              <div className="cd-ap-saldo-label">Saldo inicial en caja</div>
              <div className="cd-grid2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
                <div className="tips-field">
                  <div className="tips-field-label">Registradora / Servicio (₡)</div>
                  <div className="cd-monto-wrap">
                    <span className="cd-prefix">₡</span>
                    <input type="number" className="cd-monto-input" value={apCRC} min={0} step={1000}
                      placeholder="0" onChange={e => setApCRC(e.target.value === '' ? '' : Number(e.target.value))} />
                  </div>
                </div>
                <div className="tips-field">
                  <div className="tips-field-label">Caja Proveedores (₡)</div>
                  <div className="cd-monto-wrap">
                    <span className="cd-prefix">₡</span>
                    <input type="number" className="cd-monto-input" value={apProvCRC} min={0} step={1000}
                      placeholder="0" onChange={e => setApProvCRC(e.target.value === '' ? '' : Number(e.target.value))} />
                  </div>
                </div>
                <div className="tips-field">
                  <div className="tips-field-label">$ Dólares (efectivo)</div>
                  <div className="cd-monto-wrap usd">
                    <span className="cd-prefix">$</span>
                    <input type="number" className="cd-monto-input" value={apUSD} min={0} step={1}
                      placeholder="0" onChange={e => setApUSD(e.target.value === '' ? '' : Number(e.target.value))} />
                  </div>
                </div>
              </div>

              <button
                className="cd-btn-green"
                onClick={handleApertura}
                disabled={saving || !apTurno || !apCajero}
              >
                {saving ? 'Abriendo…' : '✓ CONFIRMAR APERTURA Y EMPEZAR TURNO'}
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  // ────────────────────────────────────────────────────────
  // ── TURNO VIEW ────────────────────────────────────────
  // ────────────────────────────────────────────────────────
  return (
    <div className="cd-wrap">

      {/* Status bar */}
      <div className="cd-status-bar">
        <div className="cd-status-left">
          <div className="cd-status-title">Caja Diaria</div>
          <div className="cd-status-sub">
            {openSession.cajero_name} · {openSession.shift_type} · {openSession.session_date}
          </div>
        </div>
        <span className="cd-badge-open">Turno activo</span>
      </div>

      {/* Top cards */}
      <div className="cd-top-cards">
        <div className="cd-top-card green">
          <div className="cd-tc-label">Fondo servicio</div>
          <div className="cd-tc-val">{fi(initCRC)}</div>
          {initUSD > 0 && <div className="cd-tc-usd">{fd(initUSD)}</div>}
          <div className="cd-tc-sub">registradora / cambio</div>
        </div>
        {initProvCRC > 0 && (
          <div className="cd-top-card" style={{ borderLeftColor: '#8a5210' }}>
            <div className="cd-tc-label">Fondo proveedores</div>
            <div className="cd-tc-val" style={{ color: '#8a5210' }}>{fi(initProvCRC)}</div>
            <div className="cd-tc-sub">caja pagos</div>
          </div>
        )}
        <div className="cd-top-card gold">
          <div className="cd-tc-label">Gastado efectivo</div>
          <div className="cd-tc-val" style={{ color: pagosEf > 0 ? '#a07030' : '#aaa' }}>{fi(pagosEf)}</div>
          <div className="cd-tc-sub">pagos a proveedores</div>
        </div>
        <div className="cd-top-card red">
          <div className="cd-tc-label">Disponible</div>
          <div className="cd-tc-val" style={{ color: deberiaCRC < 0 ? '#c0392b' : deberiaCRC < 10000 ? '#a07030' : '#444' }}>
            {fi(deberiaCRC)}
          </div>
          <div className="cd-tc-sub">{deberiaCRC < 0 ? '⚠ déficit en caja' : 'restante en caja'}</div>
        </div>
      </div>

      {/* Pagos a proveedores */}
      <div className="cd-section">
        <div className="cd-section-head">
          <div className="cd-section-icon">🏪</div>
          <div>
            <div className="cd-section-title">Pagos a proveedores</div>
            <div className="cd-section-sub">
              {pagos.filter(p => p.supplier_id).length === 0
                ? 'Sin pagos registrados'
                : `${pagos.filter(p => p.supplier_id).length} registrado${pagos.filter(p => p.supplier_id).length !== 1 ? 's' : ''} · efectivo: ${fi(pagosEf)}`
              }
            </div>
          </div>
          {canManage && (
            <button className="cd-section-add" onClick={addPago}>+ Agregar</button>
          )}
        </div>
        <div className="cd-section-body">
          {pagos.map((p, idx) => (
            <PagoCard
              key={p.id}
              pago={p}
              idx={idx}
              suppliers={suppliers}
              onChange={(field, val) => updatePago(p.id, field as keyof PagoRow, val)}
              onRemove={() => removePago(p.id)}
            />
          ))}
          {pagos.filter(p => p.supplier_id).length > 0 && (
            <div className="cd-pagos-total">
              <span className="cd-tc-label">Pagado en efectivo</span>
              <span className="cd-total-val">{fi(pagosEf)}</span>
            </div>
          )}
          {pagosTr > 0 && (
            <div className="cd-pend-bar">
              <span>🕐</span>
              <div><strong>{fi(pagosTr)}</strong> por transferencia — pendiente de confirmación</div>
            </div>
          )}
        </div>
      </div>

      {/* Ingresos adicionales */}
      <div className="cd-section">
        <div className="cd-section-head">
          <div className="cd-section-icon">💵</div>
          <div>
            <div className="cd-section-title">Ingresos adicionales del turno</div>
            <div className="cd-section-sub">Aceite, otros ingresos en efectivo</div>
          </div>
          {canManage && (
            <button className="cd-section-add" onClick={addIngreso}>+ Agregar</button>
          )}
        </div>
        <div className="cd-section-body">
          {ingresos.length === 0 && (
            <div className="cd-empty-row">ℹ Sin ingresos adicionales registrados</div>
          )}
          {ingresos.map(i => (
            <div key={i.id} className="cd-ingreso-row">
              <div className="cd-monto-wrap">
                <span className="cd-prefix">₡</span>
                <input type="number" className="cd-monto-input" value={i.crc} min={0} step={100}
                  placeholder="0" onChange={e => updateIngreso(i.id, 'crc', e.target.value === '' ? '' : Number(e.target.value))} />
              </div>
              <div className="cd-monto-wrap usd">
                <span className="cd-prefix">$</span>
                <input type="number" className="cd-monto-input" value={i.usd} min={0} step={1}
                  placeholder="0" onChange={e => updateIngreso(i.id, 'usd', e.target.value === '' ? '' : Number(e.target.value))} />
              </div>
              <input type="text" className="cd-nota-input" value={i.nota}
                placeholder="Motivo del ingreso..."
                onChange={e => updateIngreso(i.id, 'nota', e.target.value)} />
              <button className="cd-btn-remove" onClick={() => removeIngreso(i.id)}>×</button>
            </div>
          ))}
          {ingresosTotal > 0 && (
            <div className="cd-pagos-total" style={{ borderTopColor: '#cce5ff' }}>
              <span className="cd-tc-label" style={{ color: '#1a4a7a' }}>Total ingresos adicionales</span>
              <span className="cd-total-val" style={{ color: '#1a4a7a' }}>{fi(ingresosTotal)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Cierre del turno */}
      {canClose && view !== 'cierre' && (
        <div className="cd-section" style={{ borderColor: '#2a4a7a', borderWidth: 2 }}>
          <div className="cd-section-head" style={{ background: '#e0edf8', borderBottomColor: '#8ab0d0' }}>
            <div className="cd-section-icon" style={{ background: '#b0cce8' }}>🔒</div>
            <div>
              <div className="cd-section-title" style={{ color: '#1a4a7a' }}>Cierre del turno</div>
              <div className="cd-section-sub" style={{ color: '#3a6a9a' }}>Solo el encargado puede cerrar</div>
            </div>
            <span className="cd-badge-manager">Manager</span>
          </div>
          <div className="cd-section-body">
            <div className="cd-grid2">
              <div className="tips-field">
                <div className="tips-field-label">Efectivo al cierre ₡</div>
                <div className="cd-monto-wrap">
                  <span className="cd-prefix">₡</span>
                  <input type="number" className="cd-monto-input" value={cierreCRC} min={0}
                    placeholder="0" onChange={e => setCierreCRC(e.target.value === '' ? '' : Number(e.target.value))} />
                </div>
              </div>
              <div className="tips-field">
                <div className="tips-field-label">Efectivo al cierre $</div>
                <div className="cd-monto-wrap usd">
                  <span className="cd-prefix">$</span>
                  <input type="number" className="cd-monto-input" value={cierreUSD} min={0}
                    placeholder="0" onChange={e => setCierreUSD(e.target.value === '' ? '' : Number(e.target.value))} />
                </div>
              </div>
              <div className="tips-field">
                <div className="tips-field-label">Caja fuerte (₡)</div>
                <div className="cd-monto-wrap">
                  <span className="cd-prefix">₡</span>
                  <input type="number" className="cd-monto-input" value={cierreSafe} min={0}
                    placeholder="0" onChange={e => setCierreSafe(e.target.value === '' ? '' : Number(e.target.value))} />
                </div>
              </div>
              <div className="tips-field">
                <div className="tips-field-label">Depósito banco (₡)</div>
                <div className="cd-monto-wrap">
                  <span className="cd-prefix">₡</span>
                  <input type="number" className="cd-monto-input" value={cierreBank} min={0}
                    placeholder="0" onChange={e => setCierreBank(e.target.value === '' ? '' : Number(e.target.value))} />
                </div>
              </div>
            </div>

            {/* Verificación */}
            <div className="cd-verificacion">
              <div className="cd-verif-header">Verificación</div>
              <div className="cd-verif-row">
                <span>Asignado total</span>
                <strong>{fi(totalAsig)}</strong>
              </div>
              <div className="cd-verif-row">
                <span>− Pagado en efectivo</span>
                <strong style={{ color: '#c0392b' }}>− {fi(pagosEf)}</strong>
              </div>
              <div className="cd-verif-row">
                <span>Debería quedar</span>
                <strong>{fi(deberiaCRC)}</strong>
              </div>
            </div>

            {cierreVal > 0 && (
              <div className={`cd-cierre-resultado ${cuadra ? 'ok' : 'fail'}`}>
                <span>{cuadra ? '✓' : '⚠'}</span>
                <span>{cuadra
                  ? 'Cuadra correctamente'
                  : `Diferencia: ${fi(Math.abs(diferencia!))}${diferencia! > 0 ? ' de más' : ' faltante'}`
                }</span>
              </div>
            )}

            <div className="tips-field" style={{ marginTop: '1rem' }}>
              <div className="tips-field-label">Notas del turno</div>
              <input type="text" className="tips-input-dark" value={cierreNotas}
                placeholder="Observaciones, incidentes..."
                onChange={e => setCierreNotas(e.target.value)} />
            </div>

            <button className="cd-btn-primary" style={{ marginTop: '1rem', width: '100%', justifyContent: 'center' }}
              onClick={() => setShowResumen(true)}>
              👁 VER RESUMEN Y CONFIRMAR CIERRE
            </button>
          </div>
        </div>
      )}

      {!canClose && (
        <div className="cd-locked">
          <span>🔒</span>
          <span>El cierre lo realiza el encargado al finalizar el turno</span>
        </div>
      )}

      {/* Resumen modal before confirm */}
      {showResumen && openSession && (
        <div className="cd-modal-overlay" onClick={() => setShowResumen(false)}>
          <div className="cd-modal" onClick={e => e.stopPropagation()}>
            <div className="cd-modal-title">Resumen del Turno</div>
            <div className="cd-modal-meta">
              {openSession.cajero_name} · {openSession.shift_type} · {openSession.session_date}
            </div>

            <div className="cd-resumen-block">
              <div className="cd-resumen-row">
                <span>Caja inicial asignada</span>
                <strong>{fi(initCRC)}{initUSD ? ' / ' + fd(initUSD) : ''}</strong>
              </div>
              {ingresosTotal > 0 && (
                <div className="cd-resumen-row">
                  <span>Ingresos adicionales</span>
                  <strong style={{ color: '#c8a96e' }}>+ {fi(ingresosTotal)}</strong>
                </div>
              )}
              <div className="cd-resumen-row total">
                <span>Total asignado</span>
                <strong>{fi(totalAsig)}</strong>
              </div>
            </div>

            <div className="cd-resumen-block">
              {pagos.filter(p => p.supplier_id).map(p => (
                <div key={p.id} className="cd-resumen-pago">
                  <div>
                    <span>{p.supplier_name || '—'}</span>
                    <span className={`cd-method-badge ${p.method === 'Efectivo' ? 'ef' : 'tr'}`}>{p.method}</span>
                  </div>
                  <span>{fi(Number(p.amount_crc) || 0)}</span>
                </div>
              ))}
              <div className="cd-resumen-row">
                <span>Efectivo que debería quedar</span>
                <strong style={{ color: '#27874f' }}>{fi(deberiaCRC)}</strong>
              </div>
            </div>

            {cierreVal > 0 && (
              <div className={`cd-cierre-resultado ${cuadra ? 'ok' : 'fail'}`} style={{ marginBottom: '1rem' }}>
                <span>Efectivo real al cierre: <strong>{fi(cierreVal)}</strong></span>
                <span>{cuadra ? '✓ Cuadra' : `⚠ Dif: ${fi(Math.abs(diferencia!))}`}</span>
              </div>
            )}

            <div className="cd-modal-note">
              Los pagos en efectivo quedan como Pagados. Las transferencias quedan como Pendientes hasta confirmar.
            </div>
            <div className="cd-modal-actions">
              <button className="tips-btn-ghost" onClick={() => setShowResumen(false)}>Volver a editar</button>
              <button className="cd-btn-green" onClick={handleCierre} disabled={saving}>
                {saving ? 'Cerrando…' : '✓ Confirmar y cerrar turno'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── PagoCard ──────────────────────────────────────────────────

interface PagoCardProps {
  pago: PagoRow
  idx: number
  suppliers: Supplier[]
  onChange: (field: string, val: unknown) => void
  onRemove: () => void
}

function PagoCard({ pago, idx, suppliers, onChange, onRemove }: PagoCardProps) {
  const provActivos = suppliers.filter(s => s.is_active)

  const handleSelectProv = (id: string) => {
    const prov = provActivos.find(s => s.id === id)
    onChange('supplier_id',   id)
    onChange('supplier_name', prov?.name ?? '')
    onChange('supplier_cat',  prov?.category ?? '')
  }

  return (
    <div className="cd-pago-card">
      <div className="cd-pago-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div className="cd-pago-num">{idx + 1}</div>
          <div>
            <div className="cd-pago-nombre">{pago.supplier_name || 'Proveedor'}</div>
            <div className="cd-pago-cat">{pago.supplier_cat}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {pago.method === 'Transferencia' && (
            <span className="cd-badge-pend">→ Pendiente</span>
          )}
          <button className="tips-btn-ghost" style={{ fontSize: '0.75rem', color: '#c0392b', borderColor: '#f0b0b0' }}
            onClick={onRemove}>× Quitar</button>
        </div>
      </div>

      <div className="tips-field">
        <div className="tips-field-label">Proveedor</div>
        <select className="tips-input-dark" value={pago.supplier_id}
          onChange={e => handleSelectProv(e.target.value)}>
          <option value="">-- elegir proveedor --</option>
          {provActivos.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      <div className="cd-grid2" style={{ marginTop: '0.75rem' }}>
        <div className="tips-field">
          <div className="tips-field-label">Monto ₡ colones</div>
          <div className="cd-monto-wrap">
            <span className="cd-prefix">₡</span>
            <input type="number" className="cd-monto-input" value={pago.amount_crc} placeholder="0"
              onChange={e => onChange('amount_crc', e.target.value === '' ? '' : Number(e.target.value))} />
          </div>
        </div>
        <div className="tips-field">
          <div className="tips-field-label">Monto $ dólares</div>
          <div className="cd-monto-wrap usd">
            <span className="cd-prefix">$</span>
            <input type="number" className="cd-monto-input" value={pago.amount_usd} placeholder="0"
              onChange={e => onChange('amount_usd', e.target.value === '' ? '' : Number(e.target.value))} />
          </div>
        </div>
      </div>

      <div className="tips-field" style={{ marginTop: '0.75rem' }}>
        <div className="tips-field-label">Método de pago</div>
        <div className="cd-metodo-tabs">
          <div className={`cd-metodo-tab ef ${pago.method === 'Efectivo' ? 'active' : ''}`}
            onClick={() => onChange('method', 'Efectivo')}>
            💵 Efectivo
          </div>
          <div className={`cd-metodo-tab tr ${pago.method === 'Transferencia' ? 'active' : ''}`}
            onClick={() => onChange('method', 'Transferencia')}>
            🏦 Transferencia
          </div>
        </div>
        {pago.method === 'Efectivo' && (
          <div className="cd-method-info ok">✓ Efectivo — se descuenta del total asignado</div>
        )}
        {pago.method === 'Transferencia' && (
          <div className="cd-method-info pend">→ Transferencia — queda como pendiente hasta confirmar</div>
        )}
      </div>

      <div className="tips-field" style={{ marginTop: '0.75rem' }}>
        <div className="tips-field-label">Nota / Nº Factura</div>
        <input type="text" className="tips-input-dark" value={pago.reference}
          placeholder="Nº factura, descripción del pago..."
          onChange={e => onChange('reference', e.target.value)} />
      </div>
    </div>
  )
}
