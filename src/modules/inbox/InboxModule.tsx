import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../shared/hooks/useAuth'
import { useManagerOverride } from '../../shared/ManagerOverride'
import {
  listInbox, uploadDocument, extractDocument, signedUrl, setDocEstado,
  insertInboxMovement, findDuplicate, sha256File, autoCommitDocument,
  type DocumentRow, type DocExtract,
} from '../../shared/api/documents'
import { getFinanceAccounts, type FinanceAccount } from '../../shared/api/finance'
import { getSuppliers, getAllCashMovements, updateMovementStatus } from '../../shared/api/cash'
import type { Supplier, CashMovement } from '../../shared/types/database'
import { fi } from '../cash/cashUtils'

const ROLE_LABELS: Record<string, string> = { owner: 'Propietario', contador: 'Contador', manager: 'Encargado', cajero: 'Cajero' }
const N = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

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
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState<string | null>(null)
  const [error, setError]     = useState<string | null>(null)
  const [info, setInfo]       = useState<string | null>(null)
  const [active, setActive]   = useState<DocumentRow | null>(null)

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [d, accs, sups, movs] = await Promise.all([
        listInbox('nuevo'), getFinanceAccounts(), getSuppliers(), getAllCashMovements(),
      ])
      setDocs(d)
      setAccounts(accs.filter(a => a.is_leaf))
      setSuppliers(sups)
      setPendientes(movs.filter(m => m.status === 'pendiente'))
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
      if (dup) { setError('Este documento ya fue cargado (duplicado).'); setBusy(null); return }
      const { doc } = await withTimeout(uploadDocument(file, profile.id, filename), 30000)
      const ex = await extractDocument(doc)   // si falla queda 'nuevo' para carga manual
      // Auto-genera el movimiento si la IA leyó lo suficiente; si no, queda para confirmar a mano.
      if (ex) {
        const validAccs = new Set(accounts.map(a => a.id))
        const res = await autoCommitDocument(doc, ex, profile.id, pendientes, validAccs).catch(() => null)
        setInfo(res
          ? (res.reconciled ? '✓ Comprobante conciliado — pendiente marcado pagado.' : '✓ Movimiento generado. Revisalo en Caja → Movimientos.')
          : 'Cargado. La IA no leyó lo suficiente — abrilo y completá los datos a mano.')
      } else {
        setInfo('Cargado en modo manual — abrilo y completá los datos.')
      }
      await loadAll()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error procesando la imagen')
    } finally { setBusy(null) }
  }, [profile, loadAll, accounts, pendientes])

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

        {docs.length === 0 ? (
          <div className="tips-empty-state">
            <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>📥</div>
            <p className="tips-empty-text">Bandeja vacía — compartí una foto desde WhatsApp o subila acá.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
            {docs.map(doc => {
              const ex = doc.raw_json
              const tipo = ex?.tipo ?? doc.tipo ?? 'otro'
              return (
                <div key={doc.id} className="cd-prov-card" style={{ padding: 0, overflow: 'hidden', cursor: 'pointer' }} onClick={() => setActive(doc)}>
                  {thumbs[doc.id] && <img src={thumbs[doc.id]} alt="" style={{ width: '100%', height: 150, objectFit: 'cover', display: 'block' }} />}
                  <div style={{ padding: '0.7rem 0.9rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className={`inbox-badge ${tipo}`} style={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '2px 7px', borderRadius: 99, background: tipo === 'factura' ? '#fbeede' : tipo === 'comprobante_pago' ? '#e0edf8' : 'rgba(0,0,0,.06)', color: tipo === 'factura' ? '#a07030' : tipo === 'comprobante_pago' ? '#2a4a7a' : '#777' }}>
                        {tipo === 'comprobante_pago' ? 'comprobante' : tipo}
                      </span>
                      {ex?.confianza != null && <span style={{ fontSize: '0.62rem', color: '#999' }}>{Math.round(N(ex.confianza) * 100)}%</span>}
                    </div>
                    <div style={{ fontWeight: 700, fontSize: '0.92rem', marginTop: '0.4rem', color: 'var(--t-ink)' }}>{ex?.proveedor || '— sin leer —'}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: '#5a5040', marginTop: '0.2rem' }}>
                      <span>{ex?.fecha || doc.created_at.slice(0, 10)}</span>
                      <span style={{ fontFamily: "'DM Mono', monospace", fontWeight: 700 }}>{ex?.total ? fi(N(ex.total)) : '—'}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {active && (
        <ConfirmCard
          doc={active} accounts={accounts} suppliers={suppliers} pendientes={pendientes}
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
function ConfirmCard({ doc, accounts, suppliers, pendientes, createdBy, onClose, onDone, onDiscard }: {
  doc: DocumentRow
  accounts: FinanceAccount[]
  suppliers: Supplier[]
  pendientes: CashMovement[]
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
  const [metodo, setMetodo] = useState<string>(ex?.metodo_pago ?? 'Transferencia')
  const [ref, setRef]       = useState(ex?.referencia ?? '')
  const [accountId, setAccountId] = useState<string>(ex?.cuenta_qb_sugerida && accounts.some(a => a.id === ex.cuenta_qb_sugerida) ? ex.cuenta_qb_sugerida! : '')
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState<string | null>(null)

  const esTransfer = metodo === 'Transferencia' || metodo === 'SINPE' || metodo === 'Bitcoin'
  const cajaOrigen = esTransfer ? 'Banco' : 'Caja Proveedores'
  const status: 'aprobado' | 'pendiente' = tipo === 'factura' ? (esTransfer ? 'pendiente' : 'aprobado') : 'aprobado'

  // Candidato a conciliar (solo comprobante): proveedor parecido + total ±2% + fecha ±7d
  const candidato = useMemo(() => {
    if (tipo !== 'comprobante_pago' || !total) return null
    const t = N2(total), pn = (prov || '').toLowerCase()
    return pendientes.find(m => {
      const okTotal = Math.abs(N(m.amount_crc) - t) <= t * 0.02
      const okProv  = pn && (m.supplier_name || '').toLowerCase().includes(pn.slice(0, 4))
      const okFecha = !fecha || Math.abs(daysBetween(m.created_at.slice(0, 10), fecha)) <= 7
      return okTotal && (okProv || !pn) && okFecha
    }) ?? null
  }, [tipo, total, prov, fecha, pendientes])

  const confirmar = async () => {
    if (!total) { setErr('Ingresá el monto'); return }
    setSaving(true); setErr(null)
    try {
      let movementId: string
      if (tipo === 'comprobante_pago' && candidato) {
        // Marcar el pendiente como pagado
        await withTimeout(updateMovementStatus(candidato.id, 'aprobado'))
        movementId = candidato.id
      } else {
        // Factura (cuenta por pagar) o comprobante sin match → egreso directo
        movementId = await withTimeout(insertInboxMovement({
          created_by: createdBy,
          movement_type: 'egreso_mercaderia',
          amount_crc: N2(total),
          description: ref ? `${prov || 'Factura'} · ${ref}` : (prov || (tipo === 'factura' ? 'Factura' : 'Pago')),
          subcategory: prov || '',
          supplier_name: prov || '',
          method: metodo,
          caja_origen: cajaOrigen,
          status,
          account_id: accountId || null,
          fecha,
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
              <option value="comprobante_pago">Comprobante de pago</option>
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
          <Field label="Monto ₡">
            <input type="number" className="tips-input-dark" style={{ width: '100%' }} value={total} onChange={e => setTotal(e.target.value === '' ? '' : Number(e.target.value))} placeholder="0" />
          </Field>
          <Field label="Referencia / Nº de factura" full>
            <input className="tips-input-dark" style={{ width: '100%' }} value={ref} onChange={e => setRef(e.target.value)} placeholder="Nº de factura / referencia" />
          </Field>
          <Field label="Método">
            <select className="tips-input-dark" style={{ width: '100%' }} value={metodo} onChange={e => setMetodo(e.target.value)}>
              {['Efectivo', 'Transferencia', 'SINPE', 'Bitcoin'].map(m => <option key={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="Cuenta P&L (opcional)">
            <select className="tips-input-dark" style={{ width: '100%' }} value={accountId} onChange={e => setAccountId(e.target.value)}>
              <option value="">— auto —</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <Field label="Asiento contable" full>
            <div style={{ fontSize: '0.82rem', color: 'var(--t-muted)', padding: '0.4rem 0' }}>
              {cajaOrigen} · {status === 'pendiente' ? 'Pendiente' : 'Pagado'}
            </div>
          </Field>
        </div>

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
          <button className="cd-btn-green" onClick={confirmar} disabled={saving || !total}>
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
