import { useState, useMemo, useEffect } from 'react'
import { createCashMovement } from '../../shared/api/cash'
import { getFinanceAccounts, type FinanceAccount } from '../../shared/api/finance'
import { classifyMovement } from '../../shared/utils/classifyMovement'
import { PAGO_META, formasPago, type Pago } from '../../shared/utils/pagoMatrix'
import { norm } from '../../shared/api/inventoryIngest'
import { tipShiftToCaja } from '../../shared/utils'
import { fi } from './cashUtils'
import type { CashSession, CashMovement, Supplier, UserRole } from '../../shared/types/database'

// F4.3a — el "➕ Agregar" único de Caja Diaria (SPEC §5). Asistente de UNA pantalla con secciones
// progresivas: Captura MANUAL → Clasificación advisory (classifyMovement, RN-2) → Pago (matriz RN-3
// reusada) → Confirmar. Crea el cash_movement vía createCashMovement (idempotente por client_op_id):
//   · Mercadería → classification='mercaderia' → el trigger crea la tarea de Revisión (INV-1).
//   · Operativa(aprobado, con cuenta) → el trigger postea el asiento operativo.
//   · Ingreso → movimiento de ingreso (dirección de flujo elegida explícitamente, NO se infiere).
// Foto/IA = F4.3b (acá NO). Los 3 botones viejos siguen vivos (F4.3c los retira).

type Clase = 'mercaderia' | 'operativa' | 'ingreso'

interface Props {
  openSession: CashSession            // requerido: el asistente vive en la vista de turno (caja abierta)
  suppliers:   Supplier[]
  role:        UserRole
  createdBy:   string                 // profile.id
  tc:          number                 // tipo de cambio vigente
  onCreated:   (m: CashMovement) => void
  onClose:     () => void
  onError:     (msg: string) => void
}

// Match de proveedor por nombre (trim + acentos/case vía norm) contra los activos — para enlazar
// supplier_id en mercadería. Solo lee; no da de alta (eso queda para el flujo con foto / F4.3b).
function matchSupplier(name: string, suppliers: Supplier[]): Supplier | null {
  const key = norm(name)
  if (!key) return null
  return suppliers.find(s => s.is_active && (norm(s.name) === key || (s.aliases ?? []).some(a => norm(a) === key))) ?? null
}

const claseLabel: Record<Clase, string> = { mercaderia: 'Mercadería', operativa: 'Operativa', ingreso: 'Ingreso' }

export default function AgregarAsistente({ openSession, suppliers, role, createdBy, tc, onCreated, onClose, onError }: Props) {
  // ── 1. Captura manual ──────────────────────────────────────
  const [descripcion, setDescripcion] = useState('')
  const [supplierName, setSupplierName] = useState('')
  const [montoCRC, setMontoCRC] = useState<number | ''>('')
  const [montoUSD, setMontoUSD] = useState<number | ''>('')
  const [fechaFactura, setFechaFactura] = useState('')   // opcional; la fecha de REGISTRO es hoy (RN-1)

  // ── 2. Clasificación advisory (RN-2: sugiere, el humano confirma) ──
  const sugerencia = useMemo(
    () => classifyMovement({ text: descripcion, supplierName, amount: Number(montoCRC) || 0 }, suppliers),
    [descripcion, supplierName, montoCRC, suppliers],
  )
  // La clase efectiva sigue la sugerencia hasta que el humano elige otra (null = "seguir la sugerencia").
  const [clasePicked, setClasePicked] = useState<Clase | null>(null)
  const clase: Clase = clasePicked ?? sugerencia.suggestion

  // ── 3. Pago (matriz RN-3 reusada) ──────────────────────────
  const formas = useMemo(() => formasPago(role), [role])
  const [pago, setPago] = useState<Pago>(formas[0])   // local → 'efectivo'; oficina → 'pendiente'
  const [accountId, setAccountId] = useState<string>('')
  const [accounts, setAccounts] = useState<FinanceAccount[]>([])
  const [accountsError, setAccountsError] = useState(false)   // falló la carga (≠ "no hay cuentas")
  useEffect(() => {
    let on = true
    getFinanceAccounts()
      .then(a => { if (on) { setAccounts(a); setAccountsError(false) } })
      .catch(() => { if (on) setAccountsError(true) })   // no bloquea: el gasto se registra igual (P&L cae al catch-all)
    return () => { on = false }
  }, [])
  const cuentasGasto = useMemo(() => accounts.filter(a => a.section === 'expenses' && a.is_leaf), [accounts])

  const [saving, setSaving] = useState(false)

  const amountCRC = Number(montoCRC) || 0
  const amountUSD = Number(montoUSD) || 0
  const montoOk = amountCRC > 0 || amountUSD > 0

  // Preview del destino, para que el cajero vea qué va a pasar antes de confirmar.
  const preview = clase === 'ingreso'
    ? 'Ingreso → entra a la Registradora'
    : `${PAGO_META[pago].caja} · ${PAGO_META[pago].status === 'pendiente' ? 'Pendiente (cuenta por pagar)' : 'Pagado'}`
      + (clase === 'mercaderia' ? ' · crea tarea de Revisión de inventario' : '')

  const confirmar = async () => {
    if (!montoOk || saving) return
    setSaving(true)
    const baseDesc = descripcion.trim() || supplierName.trim() || claseLabel[clase]
    const description = fechaFactura ? `${baseDesc} · fact ${fechaFactura}` : baseDesc
    try {
      let mov: CashMovement
      if (clase === 'ingreso') {
        // Dirección de flujo = entrada. No lleva clasificación mercadería/operativa.
        mov = await createCashMovement({
          session_id:    openSession.id,
          created_by:    createdBy,
          movement_type: 'ingreso',
          amount_crc:    amountCRC,
          amount_usd:    amountUSD,
          currency:      'CRC',
          exchange_rate: tc,
          description,
          subcategory:   'Ingreso adicional',
          method:        'Efectivo',
          caja_origen:   'Registradora',
          shift:         tipShiftToCaja(openSession.shift_type),
        })
      } else {
        const { method, status, caja } = PAGO_META[pago]
        const esMercaderia = clase === 'mercaderia'
        mov = await createCashMovement({
          session_id:    openSession.id,
          created_by:    createdBy,
          movement_type: esMercaderia ? 'egreso_mercaderia' : 'egreso_operativo',
          amount_crc:    amountCRC,
          amount_usd:    amountUSD,
          currency:      'CRC',
          exchange_rate: tc,
          description,
          subcategory:   esMercaderia ? 'Proveedor mercadería' : 'Operativo',
          supplier_id:   esMercaderia ? (matchSupplier(supplierName, suppliers)?.id ?? null) : null,
          supplier_name: supplierName.trim() || undefined,
          method,
          caja_origen:   caja,
          status,
          // Operativa: la cuenta de gasto dispara el asiento operativo del trigger (aprobado + account_id).
          account_id:    esMercaderia ? null : (accountId || null),
          // Efectivo descuenta la caja física → necesita el turno; lo electrónico sale del Banco.
          shift:         pago === 'efectivo' ? tipShiftToCaja(openSession.shift_type) : undefined,
          // Clase EFECTIVA = la confirmada por el humano. suggested_* = snapshot de lo que propuso el
          // sistema (auditoría: qué sugirió vs qué eligió el humano).
          classification:           clase,
          suggested_classification: sugerencia.suggestion,
          suggested_confidence:     sugerencia.confidence,
        })
      }
      onCreated(mov)
      onClose()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'No se pudo registrar el movimiento — reintentá.')
      setSaving(false)
    }
  }

  const confPct = Math.round(sugerencia.confidence * 100)
  const confNivel = sugerencia.confidence >= 0.8 ? 'alta' : sugerencia.confidence >= 0.6 ? 'media' : 'baja'

  return (
    <div className="cd-modal-overlay" onClick={onClose}>
      <div className="cd-modal" onClick={e => e.stopPropagation()} style={{ maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="cd-modal-title">➕ Agregar movimiento</div>

        {/* ── 1. Captura ── */}
        <div className="tips-field" style={{ marginTop: '0.5rem' }}>
          <div className="tips-field-label">Descripción / concepto</div>
          <input type="text" className="tips-input-dark" style={{ width: '100%' }} aria-label="Descripción"
            placeholder="Ej: pescado fresco, alquiler del local, ingreso por…" autoFocus
            value={descripcion} onChange={e => setDescripcion(e.target.value)} />
        </div>

        <div className="tips-field" style={{ marginTop: '0.5rem' }}>
          <div className="tips-field-label">Proveedor (opcional)</div>
          <input type="text" className="tips-input-dark" style={{ width: '100%' }} aria-label="Proveedor"
            placeholder="Nombre del proveedor, si aplica"
            value={supplierName} onChange={e => setSupplierName(e.target.value)} />
        </div>

        <div className="cd-grid2" style={{ marginTop: '0.75rem' }}>
          <div className="tips-field">
            <div className="tips-field-label">Monto ₡ colones</div>
            <div className="cd-monto-wrap">
              <span className="cd-prefix">₡</span>
              <input type="number" className="cd-monto-input" aria-label="Monto colones" placeholder="0"
                value={montoCRC} onChange={e => setMontoCRC(e.target.value === '' ? '' : Number(e.target.value))} />
            </div>
          </div>
          <div className="tips-field">
            <div className="tips-field-label">Monto $ dólares</div>
            <div className="cd-monto-wrap usd">
              <span className="cd-prefix">$</span>
              <input type="number" className="cd-monto-input" aria-label="Monto dólares" placeholder="0"
                value={montoUSD} onChange={e => setMontoUSD(e.target.value === '' ? '' : Number(e.target.value))} />
            </div>
          </div>
        </div>

        <div className="tips-field" style={{ marginTop: '0.75rem' }}>
          <div className="tips-field-label">Fecha de la factura (opcional)</div>
          <input type="date" className="tips-input-dark" style={{ width: '100%' }} aria-label="Fecha de factura"
            value={fechaFactura} onChange={e => setFechaFactura(e.target.value)} />
          <div style={{ fontSize: '0.66rem', color: '#8a8378', marginTop: 3 }}>
            La fecha de registro es HOY (entra hoy a la caja). La de la factura, si difiere, va a la descripción.
          </div>
        </div>

        {/* ── 2. Clasificación advisory ── */}
        <div className="tips-field" style={{ marginTop: '1rem' }}>
          <div className="tips-field-label">
            Clasificación — sugerido: <strong>{claseLabel[sugerencia.suggestion]}</strong> (confianza {confNivel} · {confPct}%)
          </div>
          <div className="cd-metodo-tabs" role="group" aria-label="Clasificación">
            {(['mercaderia', 'operativa', 'ingreso'] as Clase[]).map(c => (
              <div key={c}
                className={`cd-metodo-tab ${clase === c ? 'active' : ''}`}
                role="button" tabIndex={0} aria-pressed={clase === c}
                onClick={() => setClasePicked(c)}>
                {claseLabel[c]}{c === sugerencia.suggestion ? ' ✦' : ''}
              </div>
            ))}
          </div>
          <div style={{ fontSize: '0.66rem', color: '#8a8378', marginTop: 4 }}>
            Es una sugerencia: confirmala o cambiala. Ingreso se elige a mano (no se deduce del texto).
          </div>
        </div>

        {/* ── 3. Pago (matriz RN-3) ── */}
        {clase !== 'ingreso' ? (
          <>
            <div className="tips-field" style={{ marginTop: '1rem' }}>
              <div className="tips-field-label">Forma de pago</div>
              <select className="tips-input-dark" style={{ width: '100%' }} aria-label="Forma de pago"
                value={pago} onChange={e => setPago(e.target.value as Pago)}>
                {formas.map(f => (
                  <option key={f} value={f}>
                    {f === 'efectivo' ? 'Efectivo (caja del local)' : f === 'pendiente' ? 'Transferencia — Pendiente' : 'Transferencia — Pagado desde Banco'}
                  </option>
                ))}
              </select>
              <div style={{ fontSize: '0.66rem', color: '#8a8378', marginTop: 3 }}>{PAGO_META[pago].label}</div>
            </div>

            {clase === 'operativa' && (
              <div className="tips-field" style={{ marginTop: '0.75rem' }}>
                <div className="tips-field-label">Cuenta de gasto (P&L)</div>
                <select className="tips-input-dark" style={{ width: '100%' }} aria-label="Cuenta de gasto"
                  value={accountId} onChange={e => setAccountId(e.target.value)}>
                  <option value="">— sin cuenta (no postea asiento) —</option>
                  {cuentasGasto.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                {accountsError && (
                  <div className="cd-method-info pend" role="alert" style={{ marginTop: 4 }}>
                    ⚠ No se pudieron cargar las cuentas (red/sesión). El gasto se registra igual; reabrí el asistente con conexión para asignar la cuenta y postear el asiento.
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="cd-method-info" style={{ marginTop: '1rem' }}>Ingreso en efectivo → entra a la Registradora.</div>
        )}

        <div className="tips-field" style={{ marginTop: '0.75rem' }}>
          <div className="tips-field-label">Resultado</div>
          <div style={{ fontSize: '0.78rem', color: '#5a5040' }}>{preview}{montoOk ? ` · ${fi(amountCRC)}` : ''}</div>
        </div>

        <div className="cd-modal-actions" style={{ marginTop: '1rem' }}>
          <button className="tips-btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="cd-btn-green" onClick={confirmar} disabled={!montoOk || saving}>
            {saving ? 'Registrando…' : '✓ Confirmar y registrar'}
          </button>
        </div>
      </div>
    </div>
  )
}
