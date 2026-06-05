import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../shared/hooks/useAuth'
import { useManagerOverride } from '../../shared/ManagerOverride'
import {
  listInbox, uploadImage, extractImage, createDocumentRow, signedUrl, setDocEstado,
  insertInboxMovement, findDuplicate, sha256File, autoCommitDocument, cuadra,
  type DocumentRow, type DocExtract,
} from '../../shared/api/documents'
import { getFinanceAccounts, type FinanceAccount } from '../../shared/api/finance'
import { getSuppliers, getAllCashMovements, updateMovementStatus } from '../../shared/api/cash'
import { getCurrentRate } from '../../shared/api/exchangeRate'
import { getIngredients } from '../../shared/api/inventario'
import type { Ingredient } from '../../shared/types/inventario'
import { listDocsNeedingInventory } from '../../shared/api/inventoryIngest'
import InventoryStep from './InventoryStep'
import type { Supplier, CashMovement } from '../../shared/types/database'
import { fi } from '../cash/cashUtils'

const ROLE_LABELS: Record<string, string> = { owner: 'Propietario', contador: 'Contador', manager: 'Encargado', cajero: 'Cajero' }
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
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [invDocs, setInvDocs] = useState<DocumentRow[]>([])
  const [invActive, setInvActive] = useState<DocumentRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState<string | null>(null)
  const [error, setError]     = useState<string | null>(null)
  const [info, setInfo]       = useState<string | null>(null)
  const [active, setActive]   = useState<DocumentRow | null>(null)

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [d, accs, sups, movs, ings, invd] = await Promise.all([
        listInbox('nuevo'), getFinanceAccounts(), getSuppliers(), getAllCashMovements(),
        getIngredients().catch(() => []), listDocsNeedingInventory().catch(() => []),
      ])
      setDocs(d)
      setAccounts(accs.filter(a => a.is_leaf))
      setSuppliers(sups)
      setPendientes(movs.filter(m => m.status === 'pendiente'))
      setIngredients(ings)
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

  // ── Procesar una imagen (subida manual o compartida) ──────────
  const processFile = useCallback(async (file: Blob, filename: string) => {
    if (!profile) return
    setBusy('upload'); setError(null); setInfo(null)
    try {
      const sha = await sha256File(file)
      const dup = await withTimeout(findDuplicate(sha, null))
      if (dup) { setError('Esta foto ya fue cargada (duplicado).'); setBusy(null); return }
      const { path } = await withTimeout(uploadImage(file, filename), 30000)
      const docs = await extractImage(path)   // una foto puede traer varios documentos
      const validAccs = new Set(accounts.map(a => a.id))
      if (docs.length === 0) {
        await createDocumentRow(path, sha, null, profile.id)
        setInfo('Cargado en modo manual — abrilo y completá los datos.')
      } else {
        let auto = 0, rev = 0
        for (const ex of docs) {
          const row = await createDocumentRow(path, sha, ex, profile.id)
          const res = await autoCommitDocument(row, ex, profile.id, pendientes, validAccs, tc).catch(() => null)
          if (res) auto++; else rev++
        }
        setInfo(`${docs.length} documento(s) detectado(s)` +
          (auto ? ` · ${auto} generado(s) automáticamente (revisá en Caja → Movimientos)` : '') +
          (rev ? ` · ${rev} para confirmar/revisar en la Bandeja` : ''))
      }
      await loadAll()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error procesando la imagen')
    } finally { setBusy(null) }
  }, [profile, loadAll, accounts, pendientes, tc])

  // ── Imagen compartida desde WhatsApp (Share Target) ───────────
  useEffect(() => {
    if (params.get('shared') !== '1') return
    ;(async () => {
      try {
        const cache = await caches.open('satori-share-inbox')
        const res = await cache.match('/__shared__')
        if (res) {
          const blob = await res.blob()
          const name = res.headers.get('x-filename') || 'compartido.jpg'
          await processFile(blob, name)
          await cache.delete('/__shared__')
        }
      } catch { /* noop */ }
      setParams({}, { replace: true })
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) processFile(f, f.name)
    e.target.value = ''
  }

  const descartar = async (doc: DocumentRow) => {
    if (!(await requireManager())) return
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

        {/* Subir foto */}
        <label className="cd-btn-green" style={{ display: 'inline-flex', cursor: 'pointer', marginBottom: '1.25rem' }}>
          {busy === 'upload' ? '⏳ Procesando…' : '📷 Subir foto de factura / comprobante'}
          <input type="file" accept="image/*" capture="environment" hidden onChange={onPick} disabled={busy === 'upload'} />
        </label>

        {docs.length === 0 && invDocs.length === 0 ? (
          <div className="tips-empty-state">
            <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>📥</div>
            <p className="tips-empty-text">Bandeja vacía — compartí una foto desde WhatsApp o subila acá.</p>
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
              📦 Inventario pendiente ({invDocs.length}) — el gasto ya está registrado
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {invDocs.map(d => {
                const e = d.raw_json
                return (
                  <div key={d.id} onClick={() => setInvActive(d)}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0.9rem', background: '#fff', border: '1px solid var(--t-border)', borderRadius: 4, cursor: 'pointer' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>{e?.proveedor || 'Factura'}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--t-muted)' }}>{e?.fecha || d.created_at.slice(0, 10)} · {e?.items?.length ?? 0} ítem(s)</div>
                    </div>
                    <span className="cd-btn-primary" style={{ fontSize: '0.74rem' }}>Ingresar a inventario →</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {invActive && (
        <InventoryStep
          doc={invActive} ingredients={ingredients} suppliers={suppliers} createdBy={profile?.id ?? ''}
          onClose={() => setInvActive(null)}
          onDone={async () => { setInvActive(null); setInfo('✓ Inventario ingresado.'); await loadAll() }}
        />
      )}

      {active && (
        <ConfirmCard
          doc={active} accounts={accounts} suppliers={suppliers} pendientes={pendientes} tc={tc}
          createdBy={profile?.id ?? ''}
          onClose={() => setActive(null)}
          onDone={async () => { setActive(null); await loadAll() }}
          onDiscard={async () => { const d = active; setActive(null); await descartar(d) }}
        />
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────
function ConfirmCard({ doc, accounts, suppliers, pendientes, tc, createdBy, onClose, onDone, onDiscard }: {
  doc: DocumentRow
  accounts: FinanceAccount[]
  suppliers: Supplier[]
  pendientes: CashMovement[]
  tc: number
  createdBy: string
  onClose: () => void
  onDone: () => void
  onDiscard: () => void
}) {
  const ex = doc.raw_json
  const [tipo, setTipo]     = useState<DocExtract['tipo']>((ex?.tipo as DocExtract['tipo']) ?? 'factura')
  const [prov, setProv]     = useState(ex?.proveedor ?? '')
  const [fecha, setFecha]   = useState(ex?.fecha ?? new Date().toISOString().slice(0, 10))
  const [total, setTotal]   = useState<number | ''>(ex?.total ? N2(ex.total) : '')
  const [moneda, setMoneda] = useState<'CRC' | 'USD'>(ex?.moneda === 'USD' ? 'USD' : 'CRC')
  const [condicion, setCondicion] = useState<'contado' | 'credito'>(ex?.condicion_pago === 'credito' ? 'credito' : 'contado')
  const [metodo, setMetodo] = useState<string>(ex?.metodo_pago ?? 'Transferencia')
  const [ref, setRef]       = useState(ex?.referencia ?? ex?.numero_documento ?? '')
  const [accountId, setAccountId] = useState<string>(ex?.cuenta_qb_sugerida && accounts.some(a => a.id === ex.cuenta_qb_sugerida) ? ex.cuenta_qb_sugerida! : '')
  const [validado, setValidado] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState<string | null>(null)

  const esFactura  = tipo === 'factura' || tipo === 'proforma'
  const esTransfer = metodo === 'Transferencia' || metodo === 'SINPE' || metodo === 'Bitcoin'
  const status: 'aprobado' | 'pendiente' =
    tipo === 'comprobante_pago' ? 'aprobado'
    : esFactura && condicion === 'credito' ? 'pendiente'
    : esFactura && condicion === 'contado' ? 'aprobado'
    : (esTransfer ? 'pendiente' : 'aprobado')
  const cajaOrigen = tipo === 'propinas' ? 'Caja Fuerte' : (esTransfer || status === 'pendiente' ? 'Banco' : 'Caja Proveedores')
  // Necesita validación humana: manuscrito/borroso/no cuadra (la IA lo marcó o el cruce falla)
  const revisar = !!(ex && (ex.requiere_revision || !cuadra(ex)))

  const amountCRC = moneda === 'USD' ? Math.round(N2(total) * (tc || 1)) : N2(total)
  const amountUSD = moneda === 'USD' ? N2(total) : 0

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
    if (revisar && !validado) { setErr('Revisá los montos y marcá "Validé los datos" antes de confirmar.'); return }
    setSaving(true); setErr(null)
    try {
      let movementId: string
      if (tipo === 'comprobante_pago' && candidato) {
        await withTimeout(updateMovementStatus(candidato.id, 'aprobado'))
        movementId = candidato.id
      } else if (tipo === 'propinas') {
        // Propinas: pass-through, NO es gasto del P&L (subcategoría 'Propinas' se excluye)
        movementId = await withTimeout(insertInboxMovement({
          created_by: createdBy, movement_type: 'egreso_personal', amount_crc: amountCRC, amount_usd: amountUSD,
          description: prov ? `Propinas · ${prov}` : 'Propinas', subcategory: 'Propinas', supplier_name: prov || '',
          method: metodo, caja_origen: 'Caja Fuerte', status: 'aprobado', account_id: null, fecha,
        }))
      } else {
        // Factura/proforma (cuenta por pagar) o comprobante sin match → egreso directo
        movementId = await withTimeout(insertInboxMovement({
          created_by: createdBy, movement_type: 'egreso_mercaderia', amount_crc: amountCRC, amount_usd: amountUSD,
          description: ref ? `${prov || 'Factura'} · ${ref}` : (prov || 'Factura'),
          subcategory: prov || '', supplier_name: prov || '', method: metodo,
          caja_origen: cajaOrigen, status, account_id: accountId || null, fecha,
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
      <div className="cd-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 680 }}>
        <div className="cd-modal-title">Confirmar documento</div>
        <p style={{ fontSize: '0.74rem', color: 'var(--t-muted)', margin: '0.2rem 0 0.75rem' }}>
          Revisá los datos que leyó la IA y confirmá. Nada se guarda hasta que toques Confirmar.
        </p>
        {err && <div className="tips-error" style={{ marginBottom: '0.75rem' }}><span>{err}</span><button onClick={() => setErr(null)}>✕</button></div>}

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
          </Field>
          <Field label="Fecha">
            <input type="date" className="tips-input-dark" style={{ width: '100%' }} value={fecha} onChange={e => setFecha(e.target.value)} />
          </Field>
          <Field label={`Monto ${moneda === 'USD' ? '$' : '₡'}`}>
            <input type="number" className="tips-input-dark" style={{ width: '100%' }} value={total} onChange={e => setTotal(e.target.value === '' ? '' : Number(e.target.value))} placeholder="0" />
            {moneda === 'USD' && <div style={{ fontSize: '0.66rem', color: 'var(--t-muted)', marginTop: 2 }}>≈ {fi(amountCRC)} al TC {tc}</div>}
          </Field>
          <Field label="Moneda">
            <select className="tips-input-dark" style={{ width: '100%' }} value={moneda} onChange={e => setMoneda(e.target.value as 'CRC' | 'USD')}>
              <option value="CRC">₡ Colones</option>
              <option value="USD">$ Dólares</option>
            </select>
          </Field>
          {esFactura && (
            <Field label="Condición de pago">
              <select className="tips-input-dark" style={{ width: '100%' }} value={condicion} onChange={e => setCondicion(e.target.value as 'contado' | 'credito')}>
                <option value="contado">Contado (pagado)</option>
                <option value="credito">Crédito (cuenta por pagar)</option>
              </select>
            </Field>
          )}
          <Field label="Referencia / Nº de factura" full>
            <input className="tips-input-dark" style={{ width: '100%' }} value={ref} onChange={e => setRef(e.target.value)} placeholder="Nº de factura / referencia" />
          </Field>
          <Field label="Método">
            <select className="tips-input-dark" style={{ width: '100%' }} value={metodo} onChange={e => setMetodo(e.target.value)}>
              {['Efectivo', 'Transferencia', 'SINPE', 'Bitcoin'].map(m => <option key={m}>{m}</option>)}
            </select>
          </Field>
          {tipo !== 'propinas' && (
            <Field label="Cuenta P&L (opcional)">
              <select className="tips-input-dark" style={{ width: '100%' }} value={accountId} onChange={e => setAccountId(e.target.value)}>
                <option value="">— auto —</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Asiento contable" full>
            <div style={{ fontSize: '0.82rem', color: 'var(--t-muted)', padding: '0.4rem 0' }}>
              {tipo === 'propinas' ? 'Propinas (excluido del P&L)' : `${cajaOrigen} · ${status === 'pendiente' ? 'Pendiente (cuenta por pagar)' : 'Pagado'}`}
            </div>
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

        <div className="cd-modal-actions" style={{ marginTop: '1rem' }}>
          <button className="tips-btn-ghost" style={{ color: '#c0392b', borderColor: '#f0b0b0' }} onClick={onDiscard} disabled={saving}>Descartar</button>
          <button className="tips-btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="cd-btn-green" onClick={confirmar} disabled={saving || !total || tipo === 'otro' || (revisar && !validado)}>
            {saving ? 'Guardando…' : '✓ Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return <div className="tips-field" style={full ? { gridColumn: '1 / -1' } : undefined}><div className="tips-field-label">{label}</div>{children}</div>
}
function N2(v: number | ''): number { return Number(v) || 0 }
function daysBetween(a: string, b: string): number { return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000) }
