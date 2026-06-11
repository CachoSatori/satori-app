import { useState, useMemo, useCallback } from 'react'
import type { Supplier, CashMovement } from '../../shared/types/database'
import { upsertSupplier, deactivateSupplier } from '../../shared/api/cash'
import { fi, todayStr, METODOS_PAGO_PROVEEDOR, CATEGORIAS_PROV } from './cashUtils'
import { useManagerOverride } from '../../shared/ManagerOverride'

const CICLO_DIAS: Record<string, number> = {
  'Diario': 1, 'Semanal': 7, 'Quincenal': 14, 'Mensual': 30,
}

interface Props {
  suppliers:  Supplier[]
  movements:  CashMovement[]
  onRefresh:  () => void
}

interface FormState {
  id?: string
  name: string; category: string; moneda: string
  ciclo_pago: string; metodo_pago: string; cuenta_iban: string; contact: string
}

const empty: FormState = {
  name: '', category: 'Pescados y Mariscos', moneda: 'CRC',
  ciclo_pago: 'Semanal', metodo_pago: 'Efectivo', cuenta_iban: '', contact: '',
}

function addDays(date: string, n: number): string {
  const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}
function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000)
}

export default function CashProveedores({ suppliers, movements, onRefresh }: Props) {
  const requireManager = useManagerOverride()
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState<FormState>(empty)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPending, setShowPending] = useState(false)

  const activos = suppliers.filter(s => s.is_active)
  const today   = todayStr()

  // ── Payment scheduling per supplier ──────────────────────
  const supplierStatus = useMemo(() => {
    return activos.map(s => {
      const paid = movements
        .filter(m => m.supplier_id === s.id && m.status === 'aprobado' && m.movement_type === 'egreso_mercaderia')
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
      const pending = movements
        .filter(m => m.supplier_id === s.id && m.status === 'pendiente')
      const lastPay = paid[0]?.created_at?.slice(0, 10) ?? null
      const ciclo   = CICLO_DIAS[s.ciclo_pago ?? 'Semanal'] ?? 7
      const nextDue = lastPay ? addDays(lastPay, ciclo) : null
      const daysUntil = nextDue ? daysBetween(today, nextDue) : null
      const isOverdue = daysUntil !== null && daysUntil < 0
      const isDueSoon = daysUntil !== null && daysUntil >= 0 && daysUntil <= 2
      const pendingCRC = pending.reduce((s, m) => s + m.amount_crc, 0)
      const totalPaid  = paid.reduce((s, m) => s + m.amount_crc, 0)
      return { s, lastPay, nextDue, daysUntil, isOverdue, isDueSoon, pendingCRC, totalPaid }
    })
  }, [activos, movements, today])

  const overdueCount = supplierStatus.filter(x => x.isOverdue || x.isDueSoon).length
  const pendingTotal = supplierStatus.reduce((s, x) => s + x.pendingCRC, 0)
  const [expandedProv, setExpandedProv] = useState<string | null>(null)
  const toggleProv = useCallback((id: string) =>
    setExpandedProv(prev => prev === id ? null : id), [])

  const openEdit = (s: Supplier) => {
    setForm({ id: s.id, name: s.name, category: s.category ?? 'Otros',
      moneda: s.moneda ?? 'CRC', ciclo_pago: s.ciclo_pago ?? 'Semanal',
      metodo_pago: s.metodo_pago ?? 'Efectivo', cuenta_iban: s.cuenta_iban ?? '',
      contact: s.contact ?? '' })
    setShowModal(true)
  }

  const handleSave = async () => {
    if (!form.name.trim()) { setError('El nombre es obligatorio'); return }
    setSaving(true); setError(null)
    try { await upsertSupplier(form); setShowModal(false); onRefresh() }
    catch (e) { setError(e instanceof Error ? e.message : 'Error') }
    finally { setSaving(false) }
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm('¿Desactivar este proveedor?')) return
    if (!(await requireManager())) return
    try { await deactivateSupplier(id); onRefresh() }
    catch { /* noop */ }
  }

  const up = (field: keyof FormState, val: string) => setForm(prev => ({ ...prev, [field]: val }))

  return (
    <div>
      <div className="cd-prov-header">
        <div className="sl-cash">Proveedores ({activos.length})</div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {overdueCount > 0 && (
            <button
              className="tips-btn-ghost"
              style={{ fontSize: '0.8rem', color: '#c0392b', borderColor: '#f0b0b0', position: 'relative' }}
              onClick={() => setShowPending(v => !v)}
            >
              ⚠ {overdueCount} pago{overdueCount > 1 ? 's' : ''} pendiente{overdueCount > 1 ? 's' : ''}
            </button>
          )}
          <button className="tips-btn-teal" onClick={() => { setForm(empty); setShowModal(true) }}>
            + Nuevo Proveedor
          </button>
        </div>
      </div>

      {/* Alert panel: pagos pendientes / vencidos */}
      {(showPending || overdueCount > 0) && pendingTotal > 0 && (
        <div className="cd-pend-summary" style={{ marginBottom: '1rem' }}>
          <div>
            <div className="cd-saldo-label">Deuda pendiente (transferencias)</div>
            <div className="cd-saldo-val" style={{ color: '#c8a030' }}>{fi(pendingTotal)}</div>
          </div>
        </div>
      )}

      {/* Due/overdue banner */}
      {supplierStatus.filter(x => x.isOverdue || x.isDueSoon).length > 0 && (
        <div style={{ marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {supplierStatus.filter(x => x.isOverdue || x.isDueSoon).map(({ s, nextDue, daysUntil, isOverdue, pendingCRC }) => (
            <div key={s.id} className="cd-pend-bar" style={{
              background: isOverdue ? '#fdf0ee' : '#fffbec',
              borderColor: isOverdue ? '#f0b0a0' : '#e0c878',
            }}>
              <span>{isOverdue ? '🔴' : '🟡'}</span>
              <div style={{ flex: 1 }}>
                <strong>{s.name}</strong>
                <span style={{ fontSize: '0.78rem', color: '#888', marginLeft: '0.5rem' }}>
                  {isOverdue
                    ? `Vencido hace ${Math.abs(daysUntil!)} días (${nextDue})`
                    : daysUntil === 0
                    ? 'Vence hoy'
                    : `Vence en ${daysUntil} días (${nextDue})`}
                </span>
                {pendingCRC > 0 && (
                  <span style={{ fontSize: '0.78rem', color: '#c0392b', marginLeft: '0.75rem', fontWeight: 600 }}>
                    Deuda: {fi(pendingCRC)}
                  </span>
                )}
              </div>
              <span style={{ fontSize: '0.72rem', color: '#888' }}>{s.ciclo_pago}</span>
            </div>
          ))}
        </div>
      )}

      {activos.length === 0 && (
        <div className="tips-empty-state">
          <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>🏪</div>
          <p className="tips-empty-text">Sin proveedores configurados</p>
          <button className="tips-btn-primary" onClick={() => { setForm(empty); setShowModal(true) }}>
            Agregar primer proveedor
          </button>
        </div>
      )}

      <div className="cd-prov-grid">
        {supplierStatus.map(({ s, lastPay, nextDue, daysUntil, isOverdue, isDueSoon, pendingCRC, totalPaid }) => (
          <div key={s.id} className="cd-prov-card" style={{
            borderTop: isOverdue ? '2px solid #c23b22' : isDueSoon ? '2px solid #c8a030' : undefined,
          }}>
            <div className="cd-prov-head">
              <div className="cd-prov-name">{s.name}</div>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <button className="tips-btn-ghost" style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
                  onClick={() => openEdit(s)}>✏</button>
                <button className="tips-btn-ghost" style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', color: '#c0392b', borderColor: '#f0b0b0' }}
                  onClick={() => handleDelete(s.id)}>×</button>
              </div>
            </div>
            <div className="cd-prov-body">
              <div className="cd-prov-stat"><span>Categoría</span><span>{s.category ?? '—'}</span></div>
              <div className="cd-prov-stat"><span>Ciclo pago</span><span>{s.ciclo_pago ?? '—'}</span></div>
              <div className="cd-prov-stat"><span>Método</span><span>{s.metodo_pago ?? '—'}</span></div>
              <div className="cd-prov-stat"><span>Moneda</span><span>{s.moneda ?? '—'}</span></div>
              {s.cuenta_iban && (
                <div className="cd-prov-stat">
                  <span>IBAN</span>
                  <span style={{ fontSize: '0.72rem', fontFamily: 'monospace' }}>{s.cuenta_iban}</span>
                </div>
              )}
              {/* Payment schedule */}
              <div style={{ marginTop: '0.75rem', paddingTop: '0.625rem', borderTop: '1px solid var(--t-border)' }}>
                <div className="cd-prov-stat">
                  <span>Último pago</span>
                  <span style={{ fontSize: '0.78rem' }}>{lastPay ?? 'Sin registros'}</span>
                </div>
                {nextDue && (
                  <div className="cd-prov-stat">
                    <span>Próximo pago</span>
                    <span style={{
                      fontSize: '0.78rem', fontWeight: 600,
                      color: isOverdue ? '#c0392b' : isDueSoon ? '#a07030' : 'var(--t-teal)',
                    }}>
                      {nextDue}
                      {isOverdue && ` (hace ${Math.abs(daysUntil!)}d)`}
                      {isDueSoon && !isOverdue && daysUntil === 0 && ' (hoy)'}
                      {isDueSoon && !isOverdue && daysUntil! > 0 && ` (en ${daysUntil}d)`}
                    </span>
                  </div>
                )}
                {totalPaid > 0 && (
                  <div className="cd-prov-stat">
                    <span>Total pagado</span>
                    <span style={{ fontWeight: 600, color: 'var(--t-teal)', fontSize: '0.82rem' }}>{fi(totalPaid)}</span>
                  </div>
                )}
                {pendingCRC > 0 && (
                  <div className="cd-prov-deuda">
                    <div className="cd-prov-deuda-label">Pendiente de cobro</div>
                    <div className="cd-prov-deuda-val">{fi(pendingCRC)}</div>
                  </div>
                )}

                {/* Payment history toggle */}
                {(() => {
                  const provPayments = movements
                    .filter(m => m.supplier_id === s.id && m.movement_type === 'egreso_mercaderia')
                    .sort((a, b) => b.created_at.localeCompare(a.created_at))
                    .slice(0, 8)
                  if (!provPayments.length) return null
                  return (
                    <div style={{ marginTop: '0.625rem', paddingTop: '0.625rem', borderTop: '1px solid var(--t-border)' }}>
                      <button
                        onClick={() => toggleProv(s.id)}
                        style={{ fontSize: '0.68rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--t-teal)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                      >
                        {expandedProv === s.id ? '▼' : '▶'} Historial pagos ({provPayments.length})
                      </button>
                      {expandedProv === s.id && (
                        <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                          {provPayments.map(pmt => (
                            <div key={pmt.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', padding: '0.25rem 0', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                              <div>
                                <span style={{ color: '#888' }}>{pmt.created_at?.slice(0, 10)}</span>
                                {pmt.method !== 'Efectivo' && <span style={{ marginLeft: '0.4rem', fontSize: '0.62rem', color: pmt.status === 'pendiente' ? '#c8a030' : '#888' }}>· {pmt.method}</span>}
                              </div>
                              <span style={{ fontWeight: 600, color: pmt.status === 'pendiente' ? '#c8a030' : 'var(--t-teal)' }}>
                                {fi(pmt.amount_crc)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })()}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="cd-modal-overlay" onClick={() => setShowModal(false)}>
          <div className="cd-modal" onClick={e => e.stopPropagation()}>
            <div className="cd-modal-title">{form.id ? 'Editar Proveedor' : 'Nuevo Proveedor'}</div>
            {error && <div className="tips-error" style={{ marginBottom: '1rem' }}><span>{error}</span><button onClick={() => setError(null)}>✕</button></div>}
            <div className="cash-form-grid">
              <div className="tips-field">
                <div className="tips-field-label">Nombre *</div>
                <input className="tips-input-dark" value={form.name} onChange={e => up('name', e.target.value)} placeholder="ej: Pescados del Pacífico" />
              </div>
              <div className="tips-field">
                <div className="tips-field-label">Categoría</div>
                <select className="tips-input-dark" value={form.category} onChange={e => up('category', e.target.value)}>
                  {CATEGORIAS_PROV.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="tips-field">
                <div className="tips-field-label">Moneda preferida</div>
                <select className="tips-input-dark" value={form.moneda} onChange={e => up('moneda', e.target.value)}>
                  <option value="CRC">₡ Colones (CRC)</option>
                  <option value="USD">$ Dólares (USD)</option>
                  <option value="Ambas">Ambas</option>
                </select>
              </div>
              <div className="tips-field">
                <div className="tips-field-label">Ciclo de pago</div>
                <select className="tips-input-dark" value={form.ciclo_pago} onChange={e => up('ciclo_pago', e.target.value)}>
                  {['Diario','Semanal','Quincenal','Mensual'].map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="tips-field">
                <div className="tips-field-label">Método de pago</div>
                <select className="tips-input-dark" value={form.metodo_pago} onChange={e => up('metodo_pago', e.target.value)}>
                  {/* Proveedores: solo Efectivo/Transferencia (corrección 06-11). Si el proveedor
                      ya tenía SINPE/Bitcoin guardado, se muestra para no romper el valor actual. */}
                  {[...METODOS_PAGO_PROVEEDOR, 'Ambos', ...(form.metodo_pago && !['Efectivo','Transferencia','Ambos'].includes(form.metodo_pago) ? [form.metodo_pago] : [])].map(m => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div className="tips-field">
                <div className="tips-field-label">IBAN / Cuenta (opcional)</div>
                <input className="tips-input-dark" value={form.cuenta_iban} onChange={e => up('cuenta_iban', e.target.value)} placeholder="CR00..." />
              </div>
              <div className="tips-field cash-form-desc">
                <div className="tips-field-label">Contacto / Notas (opcional)</div>
                <input className="tips-input-dark" value={form.contact} onChange={e => up('contact', e.target.value)} placeholder="Teléfono, observaciones..." />
              </div>
            </div>
            <div className="cd-modal-actions">
              <button className="tips-btn-ghost" onClick={() => setShowModal(false)}>Cancelar</button>
              <button className="tips-btn-teal" onClick={handleSave} disabled={saving}>
                {saving ? 'Guardando…' : 'Guardar proveedor'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
