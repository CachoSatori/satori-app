// Saldo a favor de proveedores (Fase B2) — modales de REGISTRAR y APLICAR crédito.
// Todos los writes van por RPC SECURITY DEFINER (mig 053/054); el residual/saldo se lee del helper puro
// (supplierCredits.ts) — NUNCA se muta amount_crc. CRC-only en v1 (el campo USD va deshabilitado).
import { useState, useMemo } from 'react'
import type { Supplier, CashMovement, SupplierCredit, CreditApplication } from '../../shared/types/database'
import { createSupplierCredit, applySupplierCredit } from '../../shared/api/cash'
import { fi } from './cashUtils'
import { saldoCredito, saldoResidual, distribuirCreditoFIFO } from './supplierCredits'

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

// ── Aplicar crédito a UNA O VARIAS facturas pendientes (tiempo real, reparto FIFO). ──
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
  // FIFO = más viejas primero: la lista y el reparto van por fecha de creación ascendente.
  const ordered = useMemo(
    () => [...pendientes].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [pendientes])

  // Reparto FIFO puro para un crédito dado → { facturaId: montoStr } (solo montos > 0).
  const buildFIFO = (cId: string): Record<string, string> => {
    const c = misCreditos.find(x => x.id === cId)
    const saldo = c ? saldoCredito(c, applications) : 0
    const dist = distribuirCreditoFIFO(saldo, ordered.map(m => saldoResidual(m, applications)))
    const next: Record<string, string> = {}
    ordered.forEach((m, i) => { if (dist[i] > 0) next[m.id] = String(dist[i]) })
    return next
  }

  const [creditId, setCreditId] = useState(misCreditos[0]?.id ?? '')
  const [montos, setMontos]     = useState<Record<string, string>>(() => buildFIFO(misCreditos[0]?.id ?? ''))
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)

  const credito   = misCreditos.find(c => c.id === creditId) ?? null
  const saldoCred = credito ? saldoCredito(credito, applications) : 0
  const montoOf     = (id: string): number => { const n = Number(montos[id]); return Number.isFinite(n) && n > 0 ? n : 0 }
  const residualOf  = (m: CashMovement): number => saldoResidual(m, applications)
  const sumMontos   = ordered.reduce((s, m) => s + montoOf(m.id), 0)
  const credRestante = saldoCred - sumMontos                                    // TIEMPO REAL
  const anyOver     = ordered.some(m => montoOf(m.id) > residualOf(m) + 0.001)  // algún monto > su residual
  const overCredit  = sumMontos > saldoCred + 0.001                             // Σ > crédito disponible
  const canApply    = sumMontos > 0 && !anyOver && !overCredit && !saving

  const cambiarCredito = (id: string) => { setCreditId(id); setMontos(buildFIFO(id)); setError(null) }

  const aplicar = async () => {
    const items = ordered.map(m => ({ id: m.id, monto: montoOf(m.id) })).filter(x => x.monto > 0)
    if (!items.length) { setError('Ingresá al menos un monto > 0'); return }
    if (overCredit)    { setError(`El total (${fi(sumMontos)}) supera el crédito disponible (${fi(saldoCred)})`); return }
    if (anyOver)       { setError('Algún monto supera el residual de su factura'); return }
    setSaving(true); setError(null)
    // SECUENCIAL a propósito: la RPC apply_supplier_credit lockea y revalida el saldo; en paralelo
    // dos imputaciones podrían leer el mismo saldo y sobre-aplicar. Cada una con su client_op_id.
    const ok: string[] = [], fail: string[] = []
    for (const it of items) {
      try { await applySupplierCredit({ credit_id: creditId, movement_id: it.id, amount: it.monto, client_op_id: uuid() }); ok.push(it.id) }
      catch { fail.push(it.id) }
    }
    onDone()   // refrescar SIEMPRE, aun con fallos parciales
    setSaving(false)
    if (fail.length) {
      // Limpiá los que SÍ entraron: la lista refleja lo que falta y no se re-aplica.
      setMontos(prev => { const n = { ...prev }; ok.forEach(id => delete n[id]); return n })
      setError(`Se aplicaron ${ok.length} de ${items.length} facturas. Fallaron ${fail.length} — revisá y reintentá.`)
    } else {
      onClose()
    }
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
        <div className="tips-field">
          <div className="tips-field-label">Crédito</div>
          <select className="tips-input-dark" value={creditId} onChange={e => cambiarCredito(e.target.value)}>
            {misCreditos.map(c => <option key={c.id} value={c.id}>{(c.fecha_origen ?? c.created_at.slice(0, 10))} · saldo {fi(saldoCredito(c, applications))} · {c.referencia ?? ''}</option>)}
          </select>
        </div>

        <div className="tips-field" style={{ marginTop: '0.75rem' }}>
          <div className="tips-field-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Repartir entre facturas pendientes (FIFO)</span>
            <button className="tips-btn-ghost" style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem' }} onClick={() => setMontos(buildFIFO(creditId))}>
              Aplicar el máximo
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', maxHeight: 280, overflowY: 'auto', marginTop: 4 }}>
            {ordered.map(m => {
              const r = residualOf(m)
              const v = montoOf(m.id)
              const resultante = r - v
              const over = v > r + 0.001
              return (
                <div key={m.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.5rem', alignItems: 'center', padding: '0.3rem 0', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                  <div style={{ fontSize: '0.75rem', minWidth: 0 }}>
                    <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {m.created_at.slice(0, 10)} · <span style={{ color: 'var(--t-muted)' }}>{(m.description || m.subcategory || '').slice(0, 26)}</span>
                    </div>
                    <div style={{ fontSize: '0.66rem', color: 'var(--t-muted)' }}>
                      residual {fi(r)}
                      {v > 0 && <> → quedará <strong style={{ color: resultante <= 0.001 ? 'var(--t-teal)' : '#c8a030' }}>{fi(Math.max(0, resultante))}</strong>{resultante <= 0.001 && ' ✓ aprobada'}</>}
                    </div>
                  </div>
                  <input className="tips-input-dark" inputMode="numeric" placeholder="0"
                    style={{ width: 108, textAlign: 'right', borderColor: over ? '#c0392b' : undefined }}
                    value={montos[m.id] ?? ''}
                    onChange={e => { const val = e.target.value.replace(/[^\d.]/g, ''); setMontos(prev => ({ ...prev, [m.id]: val })) }} />
                </div>
              )
            })}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '1.5rem', margin: '1rem 0 0.25rem', fontSize: '0.85rem', flexWrap: 'wrap' }}>
          <div>Crédito: <strong>{fi(saldoCred)}</strong></div>
          <div>Repartido: <strong style={{ color: overCredit ? '#c0392b' : 'var(--t-ink)' }}>{fi(sumMontos)}</strong></div>
          <div>Restante: <strong style={{ color: credRestante < -0.001 ? '#c0392b' : 'var(--t-teal)' }}>{fi(Math.max(0, credRestante))}</strong></div>
        </div>
        {overCredit && <div style={{ fontSize: '0.78rem', color: '#c0392b', marginBottom: '0.5rem' }}>El total repartido supera el crédito disponible.</div>}
        {anyOver && !overCredit && <div style={{ fontSize: '0.78rem', color: '#c0392b', marginBottom: '0.5rem' }}>Algún monto supera el residual de su factura.</div>}

        <div className="cd-modal-actions">
          <button className="tips-btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="tips-btn-teal" onClick={aplicar} disabled={!canApply}>{saving ? 'Aplicando…' : `Aplicar (${fi(sumMontos)})`}</button>
        </div>
      </div>
    </div>
  )
}
