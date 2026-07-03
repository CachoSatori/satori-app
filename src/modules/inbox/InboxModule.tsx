import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../shared/hooks/useAuth'
import { useManagerOverride } from '../../shared/ManagerOverride'
import {
  listInbox, uploadImage, extractImage, createDocumentRow, signedUrl, setDocEstado,
  insertInboxMovement, findDuplicate, sha256File, cuadra,
  type DocumentRow, type DocExtract,
} from '../../shared/api/documents'
import { getFinanceAccounts, type FinanceAccount } from '../../shared/api/finance'
import { getSuppliers, getAllCashMovements, updateMovementStatus, getOpenCashSession, createCashMovement, upsertSupplier } from '../../shared/api/cash'
import { getCurrentRate } from '../../shared/api/exchangeRate'
import { listDocsNeedingInventory } from '../../shared/api/inventoryIngest'
import type { Supplier, CashMovement, UserRole } from '../../shared/types/database'
import { fi } from '../cash/cashUtils'
import { tipShiftToCaja } from '../../shared/utils'
import { PAGO_META, isLocalRole, type Pago } from '../../shared/utils/pagoMatrix'
import { normalizeInvoiceImage } from '../../shared/utils/imageNormalize'

import { ROLE_LABELS } from '../../shared/constants'
const N = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const esFacturaTipo = (t?: string | null) => t === 'factura' || t === 'proforma'

// Evita que una request colgada (token vencido / red) deje el botón en "Guardando…" para siempre.
function withTimeout<T>(p: Promise<T>, ms = 15000): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error('Tiempo de espera agotado — recargá la app (sesión vencida) y reintentá.')), ms)),
  ])
}

export default function InboxModule() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const requireManager = useManagerOverride()
  const [params, setParams] = useSearchParams()

  const [docs, setDocs]       = useState<DocumentRow[]>([])
  const [thumbs, setThumbs]   = useState<Record<string, string>>({})
  const [accounts, setAccounts] = useState<FinanceAccount[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [pendientes, setPendientes] = useState<CashMovement[]>([])
  const [tc, setTc] = useState(640)
  useEffect(() => { getCurrentRate().then(r => { if (r > 0) setTc(r) }).catch(() => {}) }, [])
  const [invDocs, setInvDocs] = useState<DocumentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState<string | null>(null)
  const [error, setError]     = useState<string | null>(null)
  const [info, setInfo]       = useState<string | null>(null)
  const [active, setActive]   = useState<DocumentRow | null>(null)

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [d, accs, sups, movs, invd] = await Promise.all([
        listInbox('nuevo'), getFinanceAccounts(), getSuppliers(), getAllCashMovements(),
        listDocsNeedingInventory().catch(() => []),
      ])
      setDocs(d)
      setAccounts(accs.filter(a => a.is_leaf))
      setSuppliers(sups)
      setPendientes(movs.filter(m => m.status === 'pendiente'))
      setInvDocs(invd)
      // miniaturas firmadas
      const t: Record<string, string> = {}
      await Promise.all(d.map(async doc => { const u = await signedUrl(doc.image_path); if (u) t[doc.id] = u }))
      setThumbs(t)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando bandeja')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  // ── Procesar una imagen (cámara, galería o compartida) ────────
  // SIN auto-commit: la IA solo PRECARGA. Cada documento detectado entra a la cola
  // 'nuevo'; NINGÚN movimiento se crea hasta que el humano confirme en la ConfirmCard.
  const processFile = useCallback(async (file: Blob) => {
    if (!profile) return
    setBusy('upload'); setError(null); setInfo(null)
    try {
      // Normalizar la foto ANTES de todo (cámara/galería/WhatsApp entran acá): JPEG liviano y con
      // EXIF aplicado, así la IA siempre recibe algo legible. El sha (dedup) se calcula sobre el
      // blob YA normalizado.
      const { blob, filename } = await normalizeInvoiceImage(file)
      const sha = await sha256File(blob)
      const dup = await withTimeout(findDuplicate(sha, null))
      if (dup) { setError('Esta foto ya fue cargada (duplicado).'); setBusy(null); return }
      const { path } = await withTimeout(uploadImage(blob, filename), 30000)
      const detected = await extractImage(path)   // una foto puede traer varios documentos
      if (detected.length === 0) {
        await createDocumentRow(path, sha, null, profile.id)
        setInfo('Cargado en modo manual — abrilo y completá los datos.')
      } else {
        for (const ex of detected) await createDocumentRow(path, sha, ex, profile.id)
        setInfo(`${detected.length} documento(s) detectado(s) — la IA precargó los datos. Abrí cada uno, verificá la factura y confirmá. Nada se registra hasta confirmar.`)
      }
      await loadAll()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error procesando la imagen')
    } finally { setBusy(null) }
  }, [profile, loadAll])

  // Varias fotos en una tanda (una factura por hoja) — secuencial para no saturar.
  const processFiles = useCallback(async (files: File[]) => {
    for (const f of files) await processFile(f)
  }, [processFile])

  // ── Imagen compartida desde WhatsApp (Share Target) ───────────
  useEffect(() => {
    if (params.get('shared') !== '1') return
    ;(async () => {
      try {
        const cache = await caches.open('satori-share-inbox')
        const res = await cache.match('/__shared__')
        if (res) {
          const blob = await res.blob()
          await processFile(blob)
          await cache.delete('/__shared__')
        }
      } catch { /* noop */ }
      setParams({}, { replace: true })
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length) processFiles(files)
    e.target.value = ''
  }

  const descartar = async (doc: DocumentRow) => {
    if (!(await requireManager()).ok) return
    setBusy(doc.id)
    try { await setDocEstado(doc.id, 'descartado'); await loadAll() }
    finally { setBusy(null) }
  }

  if (loading) return <div className="module-loading"><span className="loading-mark">受</span></div>

  return (
    <div className="tips-module">
      <div className="cd-module-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span className="tips-kanji" style={{ fontSize: '1.6rem' }}>受</span>
          <div>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: '1.1rem', fontWeight: 700, color: 'var(--t-ink)' }}>Bandeja de documentos</div>
            <div style={{ fontSize: '0.72rem', letterSpacing: '0.15em', color: '#888', textTransform: 'uppercase' }}>Facturas y comprobantes</div>
          </div>
          {profile?.role && <span className="role-badge">{ROLE_LABELS[profile.role] ?? profile.role}</span>}
        </div>
        <button className="cash-back-btn" onClick={() => navigate('/')}>← Inicio</button>
      </div>

      <div style={{ padding: '1rem 1.5rem' }}>
        {error && (
          <div className="tips-error" style={{ marginBottom: '1rem' }}><span>{error}</span><button onClick={() => setError(null)}>✕</button></div>
        )}
        {info && (
          <div style={{ marginBottom: '1rem', padding: '0.6rem 0.85rem', borderRadius: 4, background: 'rgba(42,122,106,.1)', border: '1px solid var(--t-teal)', color: 'var(--t-teal)', fontSize: '0.82rem', display: 'flex', justifyContent: 'space-between' }}>
            <span>{info}</span><button onClick={() => setInfo(null)} style={{ background: 'none', border: 'none', color: 'var(--t-teal)', cursor: 'pointer' }}>✕</button>
          </div>
        )}

        {/* ── ARRANQUE CÁMARA-PRIMERO: el botón más grande de la pantalla ── */}
        <label style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
          border: '3px dashed #a07830', borderRadius: 10, padding: '1.6rem 1rem', cursor: busy === 'upload' ? 'wait' : 'pointer',
          background: '#fff', marginBottom: '0.75rem', opacity: busy === 'upload' ? 0.6 : 1,
        }}>
          <span style={{ fontSize: '2.6rem', lineHeight: 1 }}>📷</span>
          <span style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--t-ink)' }}>
            {busy === 'upload' ? '⏳ Procesando…' : 'SACAR FOTO DE LA FACTURA'}
          </span>
          <span style={{ fontSize: '0.72rem', color: '#5a5040' }}>Podés sacar varias (una por hoja)</span>
          <input type="file" accept="image/*" capture="environment" multiple hidden onChange={onPick} disabled={busy === 'upload'} />
        </label>
        <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
          <label style={{ fontSize: '0.78rem', color: '#a07830', cursor: busy === 'upload' ? 'wait' : 'pointer', textDecoration: 'underline' }}>
            o elegir de la galería
            <input type="file" accept="image/*" multiple hidden onChange={onPick} disabled={busy === 'upload'} />
          </label>
        </div>

        {docs.length === 0 && invDocs.length === 0 ? (
          <div className="tips-empty-state">
            <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>📥</div>
            <p className="tips-empty-text">Bandeja vacía — sacá una foto de la factura, compartila desde WhatsApp o elegila de la galería.</p>
          </div>
        ) : docs.length === 0 ? null : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
            {docs.map(doc => {
              const ex = doc.raw_json
              const tipo = ex?.tipo ?? doc.tipo ?? 'otro'
              return (
                <div key={doc.id} className="cd-prov-card" style={{ padding: 0, overflow: 'hidden', cursor: 'pointer' }} onClick={() => setActive(doc)}>
                  {thumbs[doc.id] && <img src={thumbs[doc.id]} alt="" style={{ width: '100%', height: 150, objectFit: 'cover', display: 'block' }} />}
                  <div style={{ padding: '0.7rem 0.9rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className={`inbox-badge ${tipo}`} style={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '2px 7px', borderRadius: 99, background: esFacturaTipo(tipo) ? '#fbeede' : tipo === 'comprobante_pago' ? '#e0edf8' : tipo === 'propinas' ? '#efe6f8' : 'rgba(0,0,0,.06)', color: esFacturaTipo(tipo) ? '#a07030' : tipo === 'comprobante_pago' ? '#2a4a7a' : tipo === 'propinas' ? '#6a4a8a' : '#777' }}>
                        {tipo === 'comprobante_pago' ? 'comprobante' : tipo}
                      </span>
                      <span style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                        {ex?.requiere_revision && <span style={{ fontSize: '0.6rem', fontWeight: 700, color: '#c23b22' }}>⚠ revisar</span>}
                        {ex?.confianza != null && <span style={{ fontSize: '0.62rem', color: '#999' }}>{Math.round(N(ex.confianza) * 100)}%</span>}
                      </span>
                    </div>
                    <div style={{ fontWeight: 700, fontSize: '0.92rem', marginTop: '0.4rem', color: 'var(--t-ink)' }}>{ex?.proveedor || '— sin leer —'}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: '#5a5040', marginTop: '0.2rem' }}>
                      <span>{ex?.fecha || doc.created_at.slice(0, 10)}</span>
                      <span style={{ fontFamily: "'DM Mono', monospace", fontWeight: 700 }}>{ex?.total ? `${ex.moneda === 'USD' ? '$' : '₡'}${N(ex.total).toLocaleString('es-CR')}` : '—'}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Facturas con gasto ya creado, pendientes de ingresar a inventario */}
        {invDocs.length > 0 && (
          <div style={{ marginTop: '2rem' }}>
            <div style={{ fontSize: '0.72rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--t-muted)', marginBottom: '0.6rem' }}>
              📦 Inventario pendiente ({invDocs.length}) — el gasto ya está registrado · se procesa en Inventario → Revisión
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {invDocs.map(d => {
                const e = d.raw_json
                return (
                  <div key={d.id}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0.9rem', background: '#fff', border: '1px solid var(--t-border)', borderRadius: 4 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>{e?.proveedor || 'Factura'}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--t-muted)' }}>{e?.fecha || d.created_at.slice(0, 10)} · {e?.items?.length ?? 0} ítem(s)</div>
                    </div>
                    {/* F4: el ingreso a inventario ya no se hace acá — la tarea vive en Inventario → Revisión (solo lectura). */}
                    <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--t-muted)', whiteSpace: 'nowrap' }}>Inventario: pendiente de revisión</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {active && (
        <ConfirmCard
          doc={active} accounts={accounts} suppliers={suppliers} pendientes={pendientes} tc={tc}
          createdBy={profile?.id ?? ''} role={profile?.role ?? 'contador'}
          onClose={() => setActive(null)}
          onDone={async () => { setActive(null); await loadAll() }}
          onDiscard={async () => { const d = active; setActive(null); await descartar(d) }}
        />
      )}
    </div>
  )
}

// Forma de pago × rol (RN-3) — la matriz vive en shared/utils/pagoMatrix (fuente única, reusada por el
// "➕ Agregar" de Caja). PAGO_META, Pago e isLocalRole se importan arriba; el comportamiento no cambia.

// Unificación Bandeja↔Caja (040-043): la vía de la Bandeja ES mercadería por definición. Marcamos
// cada egreso_mercaderia con classification='mercaderia' → el trigger del server crea la tarea de
// Revisión de inventario (inventory_review_task PENDIENTE). No afecta montos/forma de pago.
const MERCADERIA_CLASS = { classification: 'mercaderia', suggested_classification: 'mercaderia', suggested_confidence: 1 } as const

// Defaults para dar de alta un proveedor al vuelo desde la Bandeja — espejo del
// `empty` de CashProveedores para que el alta sea idéntica a la del modal manual.
const NEW_SUPPLIER_DEFAULTS = {
  category: 'Pescados y Mariscos', moneda: 'CRC',
  ciclo_pago: 'Semanal', metodo_pago: 'Efectivo', cuenta_iban: '',
} as const

// Match de proveedor por nombre (trim + case-insensitive) contra los existentes.
function matchSupplierByName(name: string, suppliers: Supplier[]): Supplier | null {
  const key = name.trim().toLowerCase()
  if (!key) return null
  return suppliers.find(s => s.name.trim().toLowerCase() === key) ?? null
}

function ConfirmCard({ doc, accounts, suppliers, pendientes, tc, createdBy, role, onClose, onDone, onDiscard }: {
  doc: DocumentRow
  accounts: FinanceAccount[]
  suppliers: Supplier[]
  pendientes: CashMovement[]
  tc: number
  createdBy: string
  role: UserRole
  onClose: () => void
  onDone: () => void
  onDiscard: () => void
}) {
  const ex = doc.raw_json
  const isLocal = isLocalRole(role)   // cajero/manager están en caja → pueden efectivo
  const [tipo, setTipo]     = useState<DocExtract['tipo']>((ex?.tipo as DocExtract['tipo']) ?? 'factura')
  const [prov, setProv]     = useState(ex?.proveedor ?? '')
  const [fecha, setFecha]   = useState(ex?.fecha ?? new Date().toISOString().slice(0, 10))
  const [total, setTotal]   = useState<number | ''>(ex?.total ? N2(ex.total) : '')
  const [moneda, setMoneda] = useState<'CRC' | 'USD'>(ex?.moneda === 'USD' ? 'USD' : 'CRC')
  // Forma de pago (matriz). Default: local → efectivo; oficina → pendiente.
  const [pago, setPago]     = useState<Pago>(isLocal ? 'efectivo' : 'pendiente')
  const [ref, setRef]       = useState(ex?.referencia ?? ex?.numero_documento ?? '')
  const [accountId, setAccountId] = useState<string>(ex?.cuenta_qb_sugerida && accounts.some(a => a.id === ex.cuenta_qb_sugerida) ? ex.cuenta_qb_sugerida! : '')
  const [validado, setValidado] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState<string | null>(null)

  // Factura EN GRANDE (signedUrl del image_path) para verificar lo que leyó la IA.
  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const [zoom, setZoom]     = useState(false)
  useEffect(() => { let on = true; signedUrl(doc.image_path).then(u => { if (on) setImgUrl(u) }); return () => { on = false } }, [doc.image_path])

  const esFactura  = tipo === 'factura' || tipo === 'proforma'
  // Necesita validación humana: manuscrito/borroso/no cuadra (la IA lo marcó o el cruce falla)
  const revisar = !!(ex && (ex.requiere_revision || !cuadra(ex)))

  // Proveedor: ¿matchea uno existente o se creará nuevo? (la IA puede equivocarse,
  // el cajero confirma el nombre a mano). El indicador de abajo refleja esto en vivo.
  const matchedSupplier = useMemo(() => matchSupplierByName(prov, suppliers), [prov, suppliers])

  // Resuelve el supplier_id real al confirmar: usa el match o da de alta el proveedor
  // nuevo con los defaults del modal manual. Sin nombre → null (no se fuerza alta).
  const resolveSupplierId = async (): Promise<string | null> => {
    const name = prov.trim()
    if (!name) return null
    if (matchedSupplier) return matchedSupplier.id
    const created = await withTimeout(upsertSupplier({ name, ...NEW_SUPPLIER_DEFAULTS }))
    return created.id
  }

  const amountCRC = moneda === 'USD' ? Math.round(N2(total) * (tc || 1)) : N2(total)
  const amountUSD = moneda === 'USD' ? N2(total) : 0

  // Asiento que resultará al confirmar (preview para el humano)
  const asiento = tipo === 'propinas' ? 'Propinas (excluido del P&L)'
    : tipo === 'comprobante_pago' ? 'Comprobante — Pagado'
    : `${PAGO_META[pago].caja} · ${PAGO_META[pago].status === 'pendiente' ? 'Pendiente (cuenta por pagar)' : 'Pagado'}`

  // Candidato a conciliar (solo comprobante): proveedor parecido + total ±2% + fecha ±7d
  const candidato = useMemo(() => {
    if (tipo !== 'comprobante_pago' || !total) return null
    const t = amountCRC, pn = (prov || '').toLowerCase()
    return pendientes.find(m => {
      const okTotal = Math.abs(N(m.amount_crc) - t) <= t * 0.02
      const okProv  = pn && (m.supplier_name || '').toLowerCase().includes(pn.slice(0, 4))
      const okFecha = !fecha || Math.abs(daysBetween(m.created_at.slice(0, 10), fecha)) <= 7
      return okTotal && (okProv || !pn) && okFecha
    }) ?? null
  }, [tipo, total, prov, fecha, pendientes, amountCRC])

  const confirmar = async () => {
    if (!total) { setErr('Ingresá el monto'); return }
    if (tipo === 'otro') { setErr('Elegí un tipo (factura / comprobante / propinas) o descartá el documento.'); return }
    if (revisar && !validado) { setErr('Revisá los montos contra la factura y marcá "Validé los datos" antes de confirmar.'); return }
    setSaving(true); setErr(null)
    try {
      // created_at de las altas nivel-día = día de REGISTRO (no se pasa `fecha` → now()),
      // así el pago cae en la Caja Diaria del día en que se registra. La fecha de la
      // factura (que puede ser de otro día) se conserva como referencia en la descripción.
      const baseDesc = ref ? `${prov || 'Factura'} · ${ref}` : (prov || 'Factura')
      const descripcion = fecha ? `${baseDesc} · fact ${fecha}` : baseDesc
      let movementId: string

      // Resolver el proveedor (match o alta) ANTES de crear el movimiento, así el pago
      // queda enlazado por supplier_id y aparece bajo su proveedor en Caja → Proveedores.
      // Salvo: propinas (no es proveedor) y la conciliación de un pendiente existente
      // (ese movimiento ya tiene su supplier_id).
      const needsSupplier = tipo !== 'propinas' && !(tipo === 'comprobante_pago' && candidato)
      const supplierId = needsSupplier ? await resolveSupplierId() : null

      if (tipo === 'comprobante_pago' && candidato) {
        // El comprobante concilia un pendiente → se marca pagado.
        await withTimeout(updateMovementStatus(candidato.id, 'aprobado'))
        movementId = candidato.id
      } else if (tipo === 'comprobante_pago') {
        // Comprobante sin pendiente que matchee → egreso ya pagado (desde Banco).
        movementId = await withTimeout(insertInboxMovement({
          created_by: createdBy, movement_type: 'egreso_mercaderia', amount_crc: amountCRC, amount_usd: amountUSD,
          description: descripcion, subcategory: prov || '', supplier_id: supplierId, supplier_name: prov || '',
          method: 'Transferencia', caja_origen: 'Banco', status: 'aprobado', account_id: accountId || null,
          ...MERCADERIA_CLASS,
        }))
      } else if (tipo === 'propinas') {
        // Propinas: pass-through, NO es gasto del P&L (subcategoría 'Propinas' se excluye)
        movementId = await withTimeout(insertInboxMovement({
          created_by: createdBy, movement_type: 'egreso_personal', amount_crc: amountCRC, amount_usd: amountUSD,
          description: prov ? `Propinas · ${prov}` : 'Propinas', subcategory: 'Propinas', supplier_name: prov || '',
          method: 'Transferencia', caja_origen: 'Caja Fuerte', status: 'aprobado', account_id: null, fecha,
        }))
      } else if (pago === 'efectivo') {
        // MATRIZ — Efectivo: descuenta la Caja Diaria. REQUIERE caja abierta.
        const session = await withTimeout(getOpenCashSession())
        if (!session) {
          setErr('Abrí la Caja Diaria primero — sin caja abierta no se puede pagar en efectivo.')
          setSaving(false); return
        }
        const mv = await withTimeout(createCashMovement({
          session_id: session.id, created_by: createdBy, movement_type: 'egreso_mercaderia',
          amount_crc: amountCRC, amount_usd: amountUSD, currency: moneda, exchange_rate: moneda === 'USD' ? tc : null,
          description: descripcion, subcategory: prov || '', supplier_id: supplierId, supplier_name: prov || '',
          method: 'Efectivo', caja_origen: 'Caja Proveedores', status: 'aprobado',
          account_id: accountId || null, shift: tipShiftToCaja(session.shift_type),
          ...MERCADERIA_CLASS,
        }))
        movementId = mv.id
      } else {
        // MATRIZ — Transferencia: Pendiente (cuenta por pagar) o Pagado desde Banco.
        // Nivel día (sin turno): no toca efectivo, no exige caja abierta.
        const { method, status, caja } = PAGO_META[pago]
        movementId = await withTimeout(insertInboxMovement({
          created_by: createdBy, movement_type: 'egreso_mercaderia', amount_crc: amountCRC, amount_usd: amountUSD,
          description: descripcion, subcategory: prov || '', supplier_id: supplierId, supplier_name: prov || '',
          method, caja_origen: caja, status, account_id: accountId || null,
          ...MERCADERIA_CLASS,
        }))
      }
      await withTimeout(setDocEstado(doc.id, 'procesado', movementId))
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al confirmar')
      setSaving(false)
    }
  }

  return (
    <div className="cd-modal-overlay" onClick={onClose}>
      <div className="cd-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 880 }}>
        <div className="cd-modal-title">Confirmar documento</div>
        <p style={{ fontSize: '0.74rem', color: 'var(--t-muted)', margin: '0.2rem 0 0.75rem' }}>
          Revisá la factura contra lo que leyó la IA, confirmá el monto y la forma de pago. Nada se guarda hasta que toques Confirmar.
        </p>
        {err && <div className="tips-error" style={{ marginBottom: '0.75rem' }}><span>{err}</span><button onClick={() => setErr(null)}>✕</button></div>}

        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {/* FACTURA EN GRANDE (ampliable) */}
          <div style={{ flex: '1 1 260px', minWidth: 240 }}>
            {imgUrl ? (
              <button type="button" onClick={() => setZoom(true)} title="Tocá para ampliar"
                style={{ display: 'block', width: '100%', padding: 0, border: '1px solid var(--t-border)', borderRadius: 6, overflow: 'hidden', cursor: 'zoom-in', background: '#fff' }}>
                <img src={imgUrl} alt="Factura" style={{ display: 'block', width: '100%', maxHeight: 440, objectFit: 'contain', background: '#faf8f3' }} />
                <span style={{ display: 'block', fontSize: '0.68rem', color: 'var(--t-muted)', padding: '0.3rem 0.5rem', textAlign: 'center' }}>🔍 Tocá para ampliar</span>
              </button>
            ) : (
              <div style={{ width: '100%', height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed var(--t-border)', borderRadius: 6, color: 'var(--t-muted)', fontSize: '0.8rem' }}>
                Cargando factura…
              </div>
            )}
          </div>

          {/* CAMPOS EXTRAÍDOS */}
          <div style={{ flex: '2 1 360px', minWidth: 300 }}>
            <div className="cd-grid2">
              <Field label="Tipo" full>
                <select className="tips-input-dark" style={{ width: '100%' }} value={tipo} onChange={e => setTipo(e.target.value as DocExtract['tipo'])}>
                  <option value="factura">Factura (cuenta por pagar)</option>
                  <option value="proforma">Proforma (= factura)</option>
                  <option value="comprobante_pago">Comprobante de pago</option>
                  <option value="propinas">Propinas (no es gasto)</option>
                  <option value="otro">Otro</option>
                </select>
              </Field>
              <Field label="Proveedor" full>
                <input className="tips-input-dark" style={{ width: '100%' }} list="inbox-sups" value={prov} onChange={e => setProv(e.target.value)} placeholder="Nombre del proveedor" />
                <datalist id="inbox-sups">{suppliers.map(s => <option key={s.id} value={s.name} />)}</datalist>
                {/* Indicador en vivo: la IA puede equivocarse — el cajero confirma el nombre.
                    Editá para mapear a uno existente o dejá el nombre nuevo. */}
                {prov.trim() && tipo !== 'propinas' && (
                  matchedSupplier
                    ? <div style={{ fontSize: '0.7rem', color: 'var(--t-teal)', marginTop: 3, fontWeight: 600 }}>✓ Proveedor existente: {matchedSupplier.name}</div>
                    : <div style={{ fontSize: '0.7rem', color: '#a07030', marginTop: 3, fontWeight: 600 }}>➕ Se creará proveedor nuevo: {prov.trim()}</div>
                )}
              </Field>
              <Field label="Fecha">
                <input type="date" className="tips-input-dark" style={{ width: '100%' }} value={fecha} onChange={e => setFecha(e.target.value)} />
              </Field>
              <Field label={`Monto final ${moneda === 'USD' ? '$' : '₡'}`}>
                <input type="number" className="tips-input-dark" style={{ width: '100%' }} value={total} onChange={e => setTotal(e.target.value === '' ? '' : Number(e.target.value))} placeholder="0" />
                {moneda === 'USD' && <div style={{ fontSize: '0.66rem', color: 'var(--t-muted)', marginTop: 2 }}>≈ {fi(amountCRC)} al TC {tc}</div>}
              </Field>
              <Field label="Moneda">
                <select className="tips-input-dark" style={{ width: '100%' }} value={moneda} onChange={e => setMoneda(e.target.value as 'CRC' | 'USD')}>
                  <option value="CRC">₡ Colones</option>
                  <option value="USD">$ Dólares</option>
                </select>
              </Field>
              <Field label="Referencia / Nº de factura" full>
                <input className="tips-input-dark" style={{ width: '100%' }} value={ref} onChange={e => setRef(e.target.value)} placeholder="Nº de factura / referencia" />
              </Field>

              {/* FORMA DE PAGO (matriz) — solo para facturas/proformas */}
              {esFactura && (
                <Field label="Forma de pago" full>
                  <select className="tips-input-dark" style={{ width: '100%' }} value={pago} onChange={e => setPago(e.target.value as Pago)}>
                    {isLocal && <option value="efectivo">Efectivo (caja del local)</option>}
                    <option value="pendiente">Transferencia — Pendiente</option>
                    <option value="banco">Transferencia — Pagado desde Banco</option>
                  </select>
                  <div style={{ fontSize: '0.66rem', color: 'var(--t-muted)', marginTop: 3 }}>{PAGO_META[pago].label}</div>
                </Field>
              )}

              {tipo !== 'propinas' && (
                <Field label="Cuenta P&L (opcional)">
                  <select className="tips-input-dark" style={{ width: '100%' }} value={accountId} onChange={e => setAccountId(e.target.value)}>
                    <option value="">— auto —</option>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </Field>
              )}
              <Field label="Asiento contable" full>
                <div style={{ fontSize: '0.82rem', color: 'var(--t-muted)', padding: '0.4rem 0' }}>{asiento}</div>
              </Field>
            </div>

            {revisar && (
              <div style={{ marginTop: '0.75rem', padding: '0.7rem 0.85rem', borderRadius: 4, background: 'rgba(194,59,34,.08)', border: '1px solid #c23b22' }}>
                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#c23b22', marginBottom: '0.4rem' }}>⚠ Requiere revisión (manuscrito / baja confianza / no cuadra)</div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={validado} onChange={e => setValidado(e.target.checked)} />
                  Revisé los montos contra la factura y están correctos
                </label>
              </div>
            )}

            {tipo === 'comprobante_pago' && (
              <div style={{ marginTop: '0.75rem', padding: '0.6rem 0.8rem', borderRadius: 4, background: candidato ? 'rgba(74,154,106,.1)' : 'rgba(200,160,48,.08)', border: `1px solid ${candidato ? '#4a9a6a' : '#c8a030'}`, fontSize: '0.8rem' }}>
                {candidato
                  ? <>✓ Concilia con pendiente: <strong>{candidato.supplier_name}</strong> · {fi(N(candidato.amount_crc))} ({candidato.created_at.slice(0, 10)}). Al confirmar se marca <strong>pagado</strong>.</>
                  : <>No encontré un pendiente que matchee. Al confirmar se registra el pago como egreso directo.</>}
              </div>
            )}
          </div>
        </div>

        <div className="cd-modal-actions" style={{ marginTop: '1rem' }}>
          <button className="tips-btn-ghost" style={{ color: '#c0392b', borderColor: '#f0b0b0' }} onClick={onDiscard} disabled={saving}>Descartar</button>
          <button className="tips-btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="cd-btn-green" onClick={confirmar} disabled={saving || !total || tipo === 'otro' || (revisar && !validado)}>
            {saving ? 'Guardando…' : '✓ Confirmar'}
          </button>
        </div>
      </div>

      {/* Lightbox de la factura */}
      {zoom && imgUrl && (
        <div onClick={() => setZoom(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 100000, background: 'rgba(0,0,0,.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', cursor: 'zoom-out' }}>
          <img src={imgUrl} alt="Factura ampliada" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          <button onClick={() => setZoom(false)} style={{ position: 'fixed', top: 16, right: 16, background: 'rgba(255,255,255,.15)', color: '#fff', border: '1px solid rgba(255,255,255,.3)', borderRadius: 6, padding: '6px 12px', fontSize: '1rem', cursor: 'pointer' }}>✕ Cerrar</button>
        </div>
      )}
    </div>
  )
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return <div className="tips-field" style={full ? { gridColumn: '1 / -1' } : undefined}><div className="tips-field-label">{label}</div>{children}</div>
}
function N2(v: number | ''): number { return Number(v) || 0 }
function daysBetween(a: string, b: string): number { return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000) }
