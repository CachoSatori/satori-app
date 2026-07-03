import { useState, useMemo, useEffect, useRef } from 'react'
import { createCashMovement, upsertSupplier } from '../../shared/api/cash'
import { getFinanceAccounts, type FinanceAccount } from '../../shared/api/finance'
import { uploadImage, extractImage, createDocumentRow, cuadra, type DocExtract } from '../../shared/api/documents'
import { normalizeInvoiceImage } from '../../shared/utils/imageNormalize'
import { classifyMovement } from '../../shared/utils/classifyMovement'
import { PAGO_META, formasPago, type Pago } from '../../shared/utils/pagoMatrix'
import { norm } from '../../shared/api/inventoryIngest'
import { tipShiftToCaja } from '../../shared/utils'
import { fi, fd } from './cashUtils'
import type { CashSession, CashMovement, Supplier, UserRole } from '../../shared/types/database'

// F4.3a — el "➕ Agregar" único de Caja Diaria (SPEC §5). Asistente de UNA pantalla con secciones
// progresivas: Captura MANUAL → Clasificación advisory (classifyMovement, RN-2) → Pago (matriz RN-3
// reusada) → Confirmar. Crea el cash_movement vía createCashMovement (idempotente por client_op_id):
//   · Mercadería → classification='mercaderia' → el trigger crea la tarea de Revisión (INV-1).
//   · Operativa(aprobado, con cuenta) → el trigger postea el asiento operativo.
//   · Ingreso → movimiento de ingreso (dirección de flujo elegida explícitamente, NO se infiere).
// FOTO/IA (aditivo, Opción A): opcionalmente el cajero saca una foto → el MISMO pipeline de la Bandeja
// (normalizeInvoiceImage → uploadImage → extractImage) PRECARGA los campos (todo editable, RN-2) y, al
// confirmar, el documento se enlaza al movimiento recién creado (linked_movement_id) con sus ítems → si es
// mercadería la tarea nace con ítems (completable sin rectificación). El camino manual sigue igual.
// Los 3 botones viejos siguen vivos (F4.3c los retira).

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
  // Resolución de proveedor: pickedSupplierId = uno elegido/creado a mano (pisa el auto-match por nombre);
  // createdSuppliers = altas al vuelo en este flujo (aún no en el prop suppliers).
  const [pickedSupplierId, setPickedSupplierId] = useState<string | null>(null)
  const [createdSuppliers, setCreatedSuppliers] = useState<Supplier[]>([])
  const [creatingSup, setCreatingSup] = useState(false)

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

  // ── Foto/IA (aditivo) ──────────────────────────────────────
  // photo = la factura ya subida + lo extraído por la IA, para enlazarla al movimiento al confirmar.
  const [photo, setPhoto] = useState<{ path: string; sha: string; extracted: DocExtract | null } | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Reusa EXACTO el pipeline de la Bandeja: normalizar → subir → leer. La extracción PRECARGA los campos
  // (todo editable; RN-2: la IA no confirma). El doc se enlaza recién al confirmar (con el id del movimiento).
  const onPhoto = async (file: File) => {
    setPhotoBusy(true)
    try {
      const { blob, filename } = await normalizeInvoiceImage(file)
      const { path, sha } = await uploadImage(blob, filename)
      const detected = await extractImage(path)
      const ex = detected[0] ?? null
      if (ex) {
        if (ex.proveedor) { setSupplierName(ex.proveedor); setPickedSupplierId(null) }   // re-resolver por el nombre leído
        if (ex.concepto || ex.proveedor) setDescripcion(ex.concepto || ex.proveedor || '')
        if (ex.total != null) {
          if (ex.moneda === 'USD') setMontoUSD(ex.total)
          else setMontoCRC(ex.total)
        }
        if (ex.fecha) setFechaFactura(ex.fecha)
        setClasePicked(null)   // que la sugerencia se recalcule sobre lo recién precargado
      }
      setPhoto({ path, sha, extracted: ex })
    } catch (e) {
      onError(e instanceof Error ? e.message : 'No se pudo leer la factura — probá otra foto o cargá a mano.')
    } finally {
      setPhotoBusy(false)
    }
  }
  const onPickPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) onPhoto(f)
    e.target.value = ''   // permite re-sacar la misma foto
  }

  const amountCRC = Number(montoCRC) || 0
  const amountUSD = Number(montoUSD) || 0
  const montoOk = amountCRC > 0 || amountUSD > 0

  // Preview del destino, para que el cajero vea qué va a pasar antes de confirmar.
  const preview = clase === 'ingreso'
    ? 'Ingreso → entra a la Registradora'
    : `${PAGO_META[pago].caja} · ${PAGO_META[pago].status === 'pendiente' ? 'Pendiente (cuenta por pagar)' : 'Pagado'}`
      + (clase === 'mercaderia' ? ' · crea tarea de Revisión de inventario' : '')

  // ── Resolución de proveedor ────────────────────────────────
  // Lista total = proveedores del padre + los recién creados acá. El RESUELTO = el elegido/creado a mano
  // (pickedSupplierId) o, si no, el match EXACTO por nombre (matchSupplier/norm reusado, sin reimplementar).
  const allSuppliers = useMemo(() => [...suppliers, ...createdSuppliers], [suppliers, createdSuppliers])
  const nameTrimmed = supplierName.trim()
  const autoMatch = useMemo(() => matchSupplier(supplierName, allSuppliers), [supplierName, allSuppliers])
  const pickedSupplier = pickedSupplierId ? (allSuppliers.find(s => s.id === pickedSupplierId) ?? null) : null
  const resolvedSupplier: Supplier | null = pickedSupplier ?? autoMatch   // elegido/creado pisa el auto-match
  const resolvedSupplierId = resolvedSupplier?.id ?? null
  const supplierUnknown = nameTrimmed.length > 0 && !resolvedSupplier
  // Parecidos (anti-duplicado): comparten substring o un token significativo (≥4) con lo tipeado/leído.
  const similares = useMemo(() => {
    if (!supplierUnknown) return []
    const q = norm(nameTrimmed)
    const qtok = new Set(q.split(/\s+/).filter(t => t.length >= 4))
    return allSuppliers.filter(s => s.is_active && (
      norm(s.name).includes(q) || q.includes(norm(s.name)) ||
      [...new Set(norm(s.name).split(/\s+/))].some(t => t.length >= 4 && qtok.has(t))
    )).slice(0, 6)
  }, [supplierUnknown, nameTrimmed, allSuppliers])

  const pickSupplier = (s: Supplier) => { setPickedSupplierId(s.id); setSupplierName(s.name) }
  const crearProveedor = async () => {
    if (!nameTrimmed || creatingSup) return
    setCreatingSup(true)
    try {
      const s = await upsertSupplier({ name: nameTrimmed })   // reusa el alta existente (defaults: CRC/Efectivo/activo)
      setCreatedSuppliers(prev => [...prev, s])
      setPickedSupplierId(s.id)
      setSupplierName(s.name)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'No se pudo crear el proveedor — reintentá.')
    } finally { setCreatingSup(false) }
  }

  const confirmar = async () => {
    if (!montoOk || saving) return
    setSaving(true)
    const baseDesc = descripcion.trim() || supplierName.trim() || claseLabel[clase]
    const description = fechaFactura ? `${baseDesc} · fact ${fechaFactura}` : baseDesc

    // Paso 1 — crear el movimiento (plata). Si falla, NO se intenta el doc (no se duplica el movimiento).
    let mov: CashMovement
    try {
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
          // Proveedor RESUELTO (matcheado / elegido / recién creado) → va en mercadería Y operativa para
          // que los movimientos agrupen/filtren por proveedor. No es campo de plata.
          supplier_id:   resolvedSupplierId,
          supplier_name: (resolvedSupplier?.name ?? supplierName.trim()) || undefined,
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
    } catch (e) {
      onError(e instanceof Error ? e.message : 'No se pudo registrar el movimiento — reintentá.')
      setSaving(false)
      return
    }

    // Paso 2 — si hubo foto, enlazar la factura al movimiento recién creado (estado='procesado' → no entra
    // a la cola de la Bandeja). Best-effort: el movimiento ya está; si el enlace falla, la factura se puede
    // adjuntar después en Revisión (vía F4.3b) → NO se reintenta el movimiento (evita duplicar plata).
    if (photo) {
      try {
        await createDocumentRow(photo.path, photo.sha, photo.extracted, createdBy, mov.id, 'procesado')
      } catch {
        onError('El pago se registró, pero la factura no se enlazó — adjuntala en Revisión de inventario.')
      }
    }
    onCreated(mov)
    onClose()
  }

  const confPct = Math.round(sugerencia.confidence * 100)
  const confNivel = sugerencia.confidence >= 0.8 ? 'alta' : sugerencia.confidence >= 0.6 ? 'media' : 'baja'

  // Calidad de la LECTURA de la IA (≠ confianza de la clasificación). Informativo (RN-2): no bloquea.
  // Reusa cuadra() para el cruce ítems↔total (no se reimplementa el chequeo).
  const lectura = photo?.extracted ?? null
  const lecturaPct = lectura ? Math.round((lectura.confianza ?? 0) * 100) : 0
  const lecturaCuadra = lectura ? cuadra(lectura) : true
  const lecturaAlerta = !!lectura && (lectura.requiere_revision === true || (lectura.confianza ?? 0) < 0.5)
  // Ítems leídos (read-only) para revisar antes de confirmar. El emparejamiento va en Revisión, no acá.
  const lineItems = lectura?.items ?? []
  const fmtMoney = (n: number) => (lectura?.moneda === 'USD' ? fd : fi)(n)

  return (
    <div className="cd-modal-overlay" onClick={onClose}>
      <div className="cd-modal" onClick={e => e.stopPropagation()} style={{ maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="cd-modal-title">➕ Agregar movimiento</div>

        {/* ── 1. Captura — foto (opcional) + manual ── */}
        <div className="tips-field" style={{ marginTop: '0.5rem' }}>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onPickPhoto} aria-label="Foto de la factura" />
          <button className="tips-btn-ghost" style={{ width: '100%' }} disabled={photoBusy}
            onClick={() => fileRef.current?.click()}>
            {photoBusy ? '📷 Leyendo factura…' : photo ? '📷 Cambiar foto' : '📷 Sacar foto de la factura (la IA precarga)'}
          </button>
          {photo && photo.extracted && (
            <div style={{ fontSize: '0.66rem', marginTop: 3 }}>
              <div style={{ color: '#4a9a6a' }}>
                ✓ Factura leída{photo.extracted.items?.length ? ` · ${photo.extracted.items.length} ítem(s)` : ''} · confianza {lecturaPct}% — revisá y corregí los campos antes de confirmar.
              </div>
              <div style={{ color: lecturaCuadra ? '#4a9a6a' : '#a07030', marginTop: 2 }}>
                {lecturaCuadra ? '✓ los ítems cuadran con el total leído' : '⚠ los ítems no suman el total — puede faltar alguna línea, revisá'}
              </div>
              {lecturaAlerta && (
                <div className="cd-method-info pend" role="alert" style={{ marginTop: 4 }}>
                  ⚠ Confianza baja — revisá bien los campos y los ítems antes de confirmar.
                </div>
              )}
            </div>
          )}
          {photo && !photo.extracted && (
            <div style={{ fontSize: '0.66rem', color: '#a07030', marginTop: 3 }}>
              La IA no pudo leer la factura — completá los campos a mano. La foto igual se enlaza al pago.
            </div>
          )}
        </div>

        {/* ── 2. Clasificación advisory ── (orden T3-B decidido por la dueña: Foto → Clasificación →
            Proveedor → Montos → Descripción → Fecha. La sugerencia es un useMemo puro sobre
            descripción/proveedor/monto → se recalcula sola aunque esos campos estén más abajo.) */}
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

        <div className="tips-field" style={{ marginTop: '0.5rem' }}>
          <div className="tips-field-label">Proveedor (opcional)</div>
          <input type="text" className="tips-input-dark" style={{ width: '100%' }} aria-label="Proveedor"
            placeholder="Nombre del proveedor, si aplica"
            value={supplierName} onChange={e => { setSupplierName(e.target.value); setPickedSupplierId(null) }} />
          {resolvedSupplier && (
            <div style={{ fontSize: '0.66rem', color: '#4a9a6a', marginTop: 3 }}>✓ Proveedor reconocido: {resolvedSupplier.name}</div>
          )}
          {supplierUnknown && (
            <div style={{ marginTop: 4 }}>
              <div className="cd-method-info pend" role="alert">
                ⚠ «{nameTrimmed}» no existe en el sistema — puede ser un error de lectura. Elegí uno existente o crealo.
              </div>
              {similares.length > 0 && (
                <div style={{ fontSize: '0.66rem', color: '#8a8378', marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                  ¿Quisiste decir?
                  {similares.map(s => (
                    <button key={s.id} type="button" className="tips-btn-ghost" style={{ padding: '2px 8px', fontSize: '0.7rem' }}
                      onClick={() => pickSupplier(s)}>{s.name}</button>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                <select className="tips-input-dark" style={{ flex: 1, minWidth: 160 }} aria-label="Elegir proveedor existente"
                  value="" onChange={e => { const s = allSuppliers.find(x => x.id === e.target.value); if (s) pickSupplier(s) }}>
                  <option value="">— elegir proveedor existente —</option>
                  {allSuppliers.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <button type="button" className="cd-btn-green" onClick={crearProveedor} disabled={creatingSup}>
                  {creatingSup ? 'Creando…' : `+ Crear «${nameTrimmed}»`}
                </button>
              </div>
            </div>
          )}
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
          <div className="tips-field-label">Descripción / concepto</div>
          <input type="text" className="tips-input-dark" style={{ width: '100%' }} aria-label="Descripción"
            placeholder="Ej: pescado fresco, alquiler del local, ingreso por…" autoFocus
            value={descripcion} onChange={e => setDescripcion(e.target.value)} />
        </div>

        <div className="tips-field" style={{ marginTop: '0.75rem' }}>
          <div className="tips-field-label">Fecha de la factura (opcional)</div>
          <input type="date" className="tips-input-dark" style={{ width: '100%' }} aria-label="Fecha de factura"
            value={fechaFactura} onChange={e => setFechaFactura(e.target.value)} />
          <div style={{ fontSize: '0.66rem', color: '#8a8378', marginTop: 3 }}>
            La fecha de registro es HOY (entra hoy a la caja). La de la factura, si difiere, va a la descripción.
          </div>
        </div>

        {/* Preview READ-ONLY de los ítems leídos — revisión previa; el emparejamiento es en Revisión. */}
        {lineItems.length > 0 && (
          <div className="tips-field" style={{ marginTop: '0.75rem' }}>
            <div className="tips-field-label">Ítems leídos por la IA ({lineItems.length}) — revisá antes de confirmar</div>
            <div style={{ border: '1px solid var(--t-border,#d4cfc4)', borderRadius: 4, overflow: 'hidden', fontSize: '0.7rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 44px 78px 82px', gap: 4, padding: '4px 8px', fontWeight: 700, color: '#8a8378', borderBottom: '1px solid var(--t-border,#d4cfc4)' }}>
                <span>Descripción</span><span style={{ textAlign: 'right' }}>Cant.</span><span style={{ textAlign: 'right' }}>P. unit.</span><span style={{ textAlign: 'right' }}>Total</span>
              </div>
              {lineItems.map((it, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 44px 78px 82px', gap: 4, padding: '4px 8px', borderBottom: i < lineItems.length - 1 ? '1px solid var(--t-border,#ece8df)' : 'none' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.descripcion}>{it.descripcion}</span>
                  <span style={{ textAlign: 'right' }}>{it.cantidad ?? '—'}</span>
                  <span style={{ textAlign: 'right' }}>{it.precio_unitario != null ? fmtMoney(it.precio_unitario) : '—'}</span>
                  <span style={{ textAlign: 'right' }}>{it.total != null ? fmtMoney(it.total) : '—'}</span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: '0.64rem', color: '#8a8378', marginTop: 3 }}>
              Solo lectura. El emparejamiento ítem↔ingrediente se hace en Revisión de inventario.
            </div>
          </div>
        )}

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
