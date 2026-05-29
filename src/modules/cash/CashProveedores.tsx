import { useState } from 'react'
import type { Supplier, CashMovement } from '../../shared/types/database'
import { upsertSupplier, deactivateSupplier } from '../../shared/api/cash'
import { fi } from './cashUtils'

const CATEGORIAS_PROV = [
  'Pescados y Mariscos','Bebidas y Licores','Verduras y Frutas',
  'Lácteos y Huevos','Carnes','Abarrotes','Limpieza y Suministros','Servicios','Otros',
]

interface Props {
  suppliers:  Supplier[]
  movements:  CashMovement[]
  onRefresh:  () => void
}

interface FormState {
  id?: string
  name: string
  category: string
  moneda: string
  ciclo_pago: string
  metodo_pago: string
  cuenta_iban: string
  contact: string
}

const empty: FormState = {
  name: '', category: 'Pescados y Mariscos', moneda: 'CRC',
  ciclo_pago: 'Semanal', metodo_pago: 'Efectivo', cuenta_iban: '', contact: '',
}

export default function CashProveedores({ suppliers, movements, onRefresh }: Props) {
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState<FormState>(empty)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activos = suppliers.filter(s => s.is_active)

  const openNew = () => { setForm(empty); setShowModal(true) }
  const openEdit = (s: Supplier) => {
    setForm({
      id:          s.id,
      name:        s.name,
      category:    s.category ?? 'Otros',
      moneda:      s.moneda ?? 'CRC',
      ciclo_pago:  s.ciclo_pago ?? 'Semanal',
      metodo_pago: s.metodo_pago ?? 'Efectivo',
      cuenta_iban: s.cuenta_iban ?? '',
      contact:     s.contact ?? '',
    })
    setShowModal(true)
  }

  const handleSave = async () => {
    if (!form.name.trim()) { setError('El nombre es obligatorio'); return }
    setSaving(true)
    setError(null)
    try {
      await upsertSupplier(form)
      setShowModal(false)
      onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error guardando proveedor')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm('¿Desactivar este proveedor?')) return
    try {
      await deactivateSupplier(id)
      onRefresh()
    } catch { /* noop */ }
  }

  const getDeuda = (supplierId: string) => ({
    crc: movements.filter(m => m.supplier_id === supplierId && m.status === 'pendiente').reduce((s, m) => s + m.amount_crc, 0),
    usd: movements.filter(m => m.supplier_id === supplierId && m.status === 'pendiente').reduce((s, m) => s + m.amount_usd, 0),
  })

  const up = (field: keyof FormState, val: string) => setForm(prev => ({ ...prev, [field]: val }))

  return (
    <div>
      <div className="cd-prov-header">
        <div className="sl-cash">Proveedores ({activos.length})</div>
        <button className="tips-btn-teal" onClick={openNew}>+ Nuevo Proveedor</button>
      </div>

      {activos.length === 0 && (
        <div className="tips-empty-state">
          <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>🏪</div>
          <p className="tips-empty-text">Sin proveedores configurados</p>
          <button className="tips-btn-primary" onClick={openNew}>Agregar primer proveedor</button>
        </div>
      )}

      <div className="cd-prov-grid">
        {activos.map(s => {
          const deuda = getDeuda(s.id)
          return (
            <div key={s.id} className="cd-prov-card">
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
                  <div className="cd-prov-stat"><span>IBAN</span><span style={{ fontSize: '0.75rem' }}>{s.cuenta_iban}</span></div>
                )}
                {(deuda.crc > 0 || deuda.usd > 0) && (
                  <div className="cd-prov-deuda">
                    <div className="cd-prov-deuda-label">Pendiente</div>
                    {deuda.crc > 0 && <div className="cd-prov-deuda-val">{fi(deuda.crc)}</div>}
                  </div>
                )}
              </div>
            </div>
          )
        })}
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
                <input className="tips-input-dark" value={form.name} onChange={e => up('name', e.target.value)}
                  placeholder="ej: Pescados del Pacífico" />
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
                  {['Efectivo','Transferencia','SINPE','Ambos'].map(m => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div className="tips-field">
                <div className="tips-field-label">IBAN / Cuenta (opcional)</div>
                <input className="tips-input-dark" value={form.cuenta_iban} onChange={e => up('cuenta_iban', e.target.value)}
                  placeholder="CR00..." />
              </div>
              <div className="tips-field cash-form-desc">
                <div className="tips-field-label">Contacto / Notas (opcional)</div>
                <input className="tips-input-dark" value={form.contact} onChange={e => up('contact', e.target.value)}
                  placeholder="Teléfono, observaciones..." />
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
