// Saldo a favor de proveedores (Fase B2) — modales de REGISTRAR y APLICAR crédito.
// Todos los writes van por RPC SECURITY DEFINER (mig 053/054); el residual/saldo se lee del helper puro
// (supplierCredits.ts) — NUNCA se muta amount_crc. CRC-only en v1 (el campo USD va deshabilitado).
import { useState, useMemo } from 'react'
import type { Supplier, CashMovement, SupplierCredit, CreditApplication } from '../../shared/types/database'
import { createSupplierCredit, applySupplierCredit } from '../../shared/api/cash'
import { fi } from './cashUtils'
import { saldoCredito, saldoResidual } from './supplierCredits'

const uuid = (): string =>
  (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`

// ── Registrar saldo a favor (sobrepago / nota de crédito). CRC-only en v1. ──
export function RegistrarCreditoModal({ supplier, movements, onDone, onClose }: {
  supplier: Supplier
  movements: CashMovement[]
  onDone: () => void
  onClose: () => void
}) {
  const [origin, setOrigin] = useState('sobrepago')
  const [monto, setMonto] = useState('')
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10))
  const [motivo, setMotivo] = useState('')
  const [referencia, setReferencia] = useState('')
  const [source, setSource] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const supMovs = useMemo(() => movements
    .filter(m => m.supplier_id === supplier.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 20), [movements, supplier.id])

  const guardar = async () => {
    const amount = Number(monto)
    if (!(amount > 0)) { setError('El monto ₡ debe ser > 0'); return }
    if (!motivo.trim()) { setError('El motivo es obligatorio'); return }
    if (!referencia.trim()) { setError('La referencia (nº de transferencia) es obligatoria'); return }
    setSaving(true); setError(null)
    try {
      await createSupplierCredit({
        supplier_id: supplier.id, origin, amount_crc: amount, currency: 'CRC',
        fecha_origen: fecha, motivo: motivo.trim(), referencia: referencia.trim(),
        source_movement_id: source || null, client_op_id: uuid(),
      })
      onDone(); onClose()
    } catch (e) { setError(e instanceof Error ? e.message : 'Error') }
    finally { setSaving(false) }
  }

  return (
    <div className="cd-modal-overlay" onClick={onClose}>
      <div className="cd-modal" onClick={e => e.stopPropagation()}>
        <div className="cd-modal-title">Registrar saldo a favor · {supplier.name}</div>
        <div style={{ background: 'rgba(200,169,110,.12)', border: '1px solid #c8a030', borderRadius: 8, padding: '0.6rem 0.8rem', fontSize: '0.78rem', marginBottom: '1rem' }}>
          ⚠️ Esto <strong>NO mueve plata</strong>: solo reconoce un prepago que YA le hiciste al proveedor.
        </div>
        {error && <div className="tips-error" style={{ marginBottom: '1rem' }}><span>{error}</span><button onClick={() => setError(null)}>✕</button></div>}
        <div className="cash-form-grid">
          <div className="tips-field">
            <div className="tips-field-label">Origen</div>
            <select className="tips-input-dark" value={origin} onChange={e => setOrigin(e.target.value)}>
              <option value="sobrepago">Sobrepago</option>
              <option value="nota_credito">Nota de crédito</option>
            </select>
          </div>
          <div className="tips-field">
            <div className="tips-field-label">Monto ₡ (CRC)</div>
            <input className="tips-input-dark" inputMode="numeric" value={monto} onChange={e => setMonto(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0" />
          </div>
          <div className="tips-field">
            <div className="tips-field-label">Monto $ (USD)</div>
            <input className="tips-input-dark" value="" disabled placeholder="En v1 solo CRC" />
          </div>
          <div className="tips-field">
            <div className="tips-field-label">Fecha</div>
            <input className="tips-input-dark" type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
          </div>
          <div className="tips-field">
            <div className="tips-field-label">Motivo *</div>
            <input className="tips-input-dark" value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="ej: pagué de más la factura 4056" />
          </div>
          <div className="tips-field">
            <div className="tips-field-label">Referencia * (nº transferencia)</div>
            <input className="tips-input-dark" value={referencia} onChange={e => setReferencia(e.target.value)} placeholder="ej: TRF-889900" />
          </div>
          <div className="tips-field cash-form-desc">
            <div className="tips-field-label">Movimiento origen (opcional)</div>
            <select className="tips-input-dark" value={source} onChange={e => setSource(e.target.value)}>
              <option value="">— ninguno —</option>
              {supMovs.map(m => <option key={m.id} value={m.id}>{m.created_at.slice(0, 10)} · {fi(m.amount_crc)} · {(m.description || m.subcategory || '').slice(0, 30)}</option>)}
            </select>
          </div>
        </div>
        <div className="cd-modal-actions">
          <button className="tips-btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="tips-btn-teal" onClick={guardar} disabled={saving}>{saving ? 'Guardando…' : 'Registrar saldo a favor'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Aplicar crédito a una factura pendiente (tiempo real). Parcial permitido. ──
export function AplicarCreditoModal({ supplier, credits, applications, pendientes, onDone, onClose }: {
  supplier: Supplier
  credits: SupplierCredit[]
  applications: CreditApplication[]
  pendientes: CashMovement[]
  onDone: () => void
  onClose: () => void
}) {
  const misCreditos = useMemo(
    () => credits.filter(c => c.supplier_id === supplier.id && saldoCredito(c, applications) > 0),
    [credits, applications, supplier.id])
  const [creditId, setCreditId] = useState(misCreditos[0]?.id ?? '')
  const [facturaId, setFacturaId] = useState(pendientes[0]?.id ?? '')
  const [monto, setMonto] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const credito  = misCreditos.find(c => c.id === creditId) ?? null
  const factura  = pendientes.find(m => m.id === facturaId) ?? null
  const saldoCred = credito ? saldoCredito(credito, applications) : 0
  const residual  = factura ? saldoResidual(factura, applications) : 0
  const max = Math.max(0, Math.min(saldoCred, residual))
  const amount = Number(monto) || 0
  const credRestante = saldoCred - amount           // TIEMPO REAL
  const facturaRestante = residual - amount

  const aplicar = async () => {
    if (!credito || !factura) { setError('Elegí crédito y factura'); return }
    if (!(amount > 0)) { setError('El monto debe ser > 0'); return }
    if (amount > max + 0.001) { setError(`Máximo aplicable: ${fi(max)}`); return }
    setSaving(true); setError(null)
    try {
      await applySupplierCredit({ credit_id: credito.id, movement_id: factura.id, amount, client_op_id: uuid() })
      onDone(); onClose()
    } catch (e) { setError(e instanceof Error ? e.message : 'Error') }
    finally { setSaving(false) }
  }

  if (!misCreditos.length || !pendientes.length) {
    return (
      <div className="cd-modal-overlay" onClick={onClose}><div className="cd-modal" onClick={e => e.stopPropagation()}>
        <div className="cd-modal-title">Aplicar crédito · {supplier.name}</div>
        <p style={{ color: 'var(--t-muted)', fontSize: '0.85rem' }}>
          {!misCreditos.length ? 'Este proveedor no tiene saldo a favor disponible.' : 'No hay facturas pendientes para aplicar.'}
        </p>
        <div className="cd-modal-actions"><button className="tips-btn-ghost" onClick={onClose}>Cerrar</button></div>
      </div></div>
    )
  }

  return (
    <div className="cd-modal-overlay" onClick={onClose}>
      <div className="cd-modal" onClick={e => e.stopPropagation()}>
        <div className="cd-modal-title">Aplicar crédito · {supplier.name}</div>
        {error && <div className="tips-error" style={{ marginBottom: '1rem' }}><span>{error}</span><button onClick={() => setError(null)}>✕</button></div>}
        <div className="cash-form-grid">
          <div className="tips-field">
            <div className="tips-field-label">Crédito</div>
            <select className="tips-input-dark" value={creditId} onChange={e => setCreditId(e.target.value)}>
              {misCreditos.map(c => <option key={c.id} value={c.id}>{(c.fecha_origen ?? c.created_at.slice(0, 10))} · saldo {fi(saldoCredito(c, applications))} · {c.referencia ?? ''}</option>)}
            </select>
          </div>
          <div className="tips-field">
            <div className="tips-field-label">Factura pendiente</div>
            <select className="tips-input-dark" value={facturaId} onChange={e => setFacturaId(e.target.value)}>
              {pendientes.map(m => <option key={m.id} value={m.id}>{m.created_at.slice(0, 10)} · residual {fi(saldoResidual(m, applications))} · {(m.description || m.subcategory || '').slice(0, 24)}</option>)}
            </select>
          </div>
          <div className="tips-field">
            <div className="tips-field-label">Monto a aplicar ₡ (máx {fi(max)})</div>
            <input className="tips-input-dark" inputMode="numeric" value={monto} onChange={e => setMonto(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0" />
            <button className="tips-btn-ghost" style={{ marginTop: 4, fontSize: '0.7rem', padding: '0.2rem 0.5rem' }} onClick={() => setMonto(String(max))}>Aplicar el máximo ({fi(max)})</button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '1.5rem', margin: '1rem 0', fontSize: '0.85rem', flexWrap: 'wrap' }}>
          <div>Crédito restante: <strong style={{ color: credRestante < -0.001 ? '#c0392b' : 'var(--t-teal)' }}>{fi(Math.max(0, credRestante))}</strong></div>
          <div>Saldo de la factura: <strong style={{ color: facturaRestante < -0.001 ? '#c0392b' : '#c8a030' }}>{fi(Math.max(0, facturaRestante))}</strong></div>
        </div>
        {amount > 0 && facturaRestante <= 0.001 && (
          <div style={{ fontSize: '0.78rem', color: 'var(--t-teal)', marginBottom: '0.5rem' }}>✓ Cubre la factura entera → quedará <strong>aprobada</strong>.</div>
        )}
        <div className="cd-modal-actions">
          <button className="tips-btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="tips-btn-teal" onClick={aplicar} disabled={saving || !(amount > 0) || amount > max + 0.001}>{saving ? 'Aplicando…' : 'Aplicar crédito'}</button>
        </div>
      </div>
    </div>
  )
}
