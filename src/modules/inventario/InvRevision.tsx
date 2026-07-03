/**
 * InvRevision — Cola de revisión de inventario (F3/F4 unificación Bandeja↔Caja).
 *
 * Consume inventory_review_task (status='PENDIENTE'): cada tarea nace de un gasto de
 * insumos en Caja (classification='mercaderia') que todavía no tiene su inventario
 * ingresado. El revisor (owner/manager/contador — cajero EXCLUIDO) empareja los ítems
 * de la factura con ingredientes y COMPLETA (→ complete_inventory_review) o DESCARTA
 * con motivo (→ discard_inventory_review). Reusa el mapeo de InventoryStep vía InvLineTable.
 *
 * F4: además de mapear, se puede editar METADATOS — proveedor y nota — que se sincronizan
 * con el cash_movement ligado (supplier_id/supplier_name → ambos; nota → description).
 * NUNCA se toca monto/forma de pago/estado del movimiento desde acá (es plata / trigger).
 *
 * Fuera de alcance: la RPC ingresa stock + asiento de auditoría; acá NO se toca
 * cost_per_unit ni ingredient_prices (diferido a la alerta de cambio de precio).
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { supabase } from '../../shared/api/supabase'
import { useAuth } from '../../shared/hooks/useAuth'
import { getSuppliers, updateMovementMetadata } from '../../shared/api/cash'
import { signedUrl, uploadImage, extractImage, createDocumentRow, type DocumentRow, type DocItem, type DocExtract } from '../../shared/api/documents'
import FacturaThumbs from '../../shared/FacturaThumbs'
import { normalizeInvoiceImage } from '../../shared/utils/imageNormalize'
import {
  getSupplierItemMap, resolveLine, resolveEditLines, buildReviewLines, learnSupplierMappings,
  NONE, NEW, type EditLine, type InvLine,
} from '../../shared/api/inventoryIngest'
import InvLineTable from '../../shared/InvLineTable'
import type { Ingredient } from '../../shared/types/inventario'
import type { Supplier, CashMovement } from '../../shared/types/database'
import type { Database } from '../../shared/types/supabase.gen'

type InvReviewTask = Database['public']['Tables']['inventory_review_task']['Row']

const money = (n: number, cur: string) => `${cur === 'USD' ? '$' : '₡'}${Math.round(n).toLocaleString('es-CR')}`

// ¿El total leído difiere del monto del pago más allá de la tolerancia? (mismo umbral 2%/₡50 que
// `cuadra` en api/documents). Lo usan el aviso del detalle Y el paso de confirmación al adjuntar.
const totalDifiere = (leido: number | null, pago: number | null): boolean =>
  leido != null && leido > 0 && pago != null && pago > 0
  && Math.abs(leido - pago) > Math.max(pago * 0.02, 50)

export default function InvRevision({ ingredients, onRefresh }: {
  ingredients: Ingredient[]
  onRefresh: () => void
}) {
  const { profile } = useAuth()
  const [tasks, setTasks]       = useState<InvReviewTask[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [docsById, setDocsById] = useState<Record<string, DocumentRow>>({})
  const [docsByMov, setDocsByMov] = useState<Record<string, DocumentRow>>({})
  const [movsById, setMovsById] = useState<Record<string, CashMovement>>({})
  const [creatorsById, setCreatorsById] = useState<Record<string, string>>({})  // user_id → full_name (trazabilidad)
  const [urls, setUrls]         = useState<Record<string, string>>({})
  const [loading, setLoading]   = useState(true)
  const [err, setErr]           = useState<string | null>(null)

  // Filtros
  const [fSupplier, setFSupplier] = useState('')
  const [fDate, setFDate]         = useState('')

  // Detalle seleccionado
  const [selId, setSelId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const [res, sups] = await Promise.all([
        supabase.from('inventory_review_task').select('*').eq('status', 'PENDIENTE').order('entry_date', { ascending: true }),
        getSuppliers(),
      ])
      if (res.error) throw new Error(res.error.message)
      const rows = (res.data ?? []) as InvReviewTask[]
      setTasks(rows); setSuppliers(sups)
      const docIds  = [...new Set(rows.map(t => t.document_id).filter((x): x is string => !!x))]
      const cashIds = [...new Set(rows.map(t => t.cash_movement_id).filter((x): x is string => !!x))]
      // Documentos: por id directo Y por movimiento ligado. El trigger (042) puede guardar
      // document_id=null si la factura se enlazó al movimiento DESPUÉS del insert (la Bandeja
      // crea el movimiento y recién después corre setDocEstado) → resolvemos también por
      // linked_movement_id = cash_movement_id para que la factura aparezca igual.
      const docRows: DocumentRow[] = []
      if (docIds.length) {
        const { data } = await supabase.from('documents').select('*').in('id', docIds)
        docRows.push(...((data ?? []) as DocumentRow[]))
      }
      if (cashIds.length) {
        const { data } = await supabase.from('documents').select('*').in('linked_movement_id', cashIds)
        for (const d of ((data ?? []) as DocumentRow[])) if (!docRows.some(x => x.id === d.id)) docRows.push(d)
      }
      const byId: Record<string, DocumentRow> = {}
      const byMov: Record<string, DocumentRow> = {}
      for (const d of docRows) { byId[d.id] = d; if (d.linked_movement_id) byMov[d.linked_movement_id] = d }
      setDocsById(byId); setDocsByMov(byMov)
      const u: Record<string, string> = {}
      await Promise.all(docRows.map(async d => { const s = await signedUrl(d.image_path); if (s) u[d.id] = s }))
      setUrls(u)
      // Movimientos de caja ligados (para prefijar la nota = description y el proveedor)
      if (cashIds.length) {
        const { data: movs } = await supabase.from('cash_movements').select('*').in('id', cashIds)
        const movRows = (movs ?? []) as CashMovement[]
        const mmap: Record<string, CashMovement> = {}
        for (const m of movRows) mmap[m.id] = m
        setMovsById(mmap)
        // Nombre de quién registró el pago (created_by) — trazabilidad pedida por la dueña. Solo lectura.
        const creatorIds = [...new Set(movRows.map(m => m.created_by).filter((x): x is string => !!x))]
        if (creatorIds.length) {
          const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', creatorIds)
          const cmap: Record<string, string> = {}
          for (const p of (profs ?? []) as { id: string; full_name: string }[]) cmap[p.id] = p.full_name
          setCreatorsById(cmap)
        } else { setCreatorsById({}) }
      } else { setMovsById({}); setCreatorsById({}) }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error cargando la cola de revisión')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const supName = useCallback((id: string | null) => suppliers.find(s => s.id === id)?.name ?? '— sin proveedor', [suppliers])

  // Proveedores presentes en la cola (para el filtro)
  const queueSuppliers = useMemo(() => {
    const ids = new Set(tasks.map(t => t.supplier_id).filter((x): x is string => !!x))
    return suppliers.filter(s => ids.has(s.id))
  }, [tasks, suppliers])

  const filtered = useMemo(() => tasks.filter(t =>
    (!fSupplier || t.supplier_id === fSupplier) &&
    (!fDate || t.entry_date === fDate)
  ), [tasks, fSupplier, fDate])

  const selected = tasks.find(t => t.id === selId) ?? null

  // Factura de una tarea: por document_id directo o, si el trigger lo dejó null, por el movimiento ligado.
  const docForTask = useCallback((t: InvReviewTask): DocumentRow | undefined =>
    (t.document_id ? docsById[t.document_id] : undefined) ?? (t.cash_movement_id ? docsByMov[t.cash_movement_id] : undefined),
  [docsById, docsByMov])

  const onDone = () => { setSelId(null); load(); onRefresh() }

  return (
    <div style={{ padding: '0.5rem 1.5rem 2rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
        <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--vt-gold)' }}>
          🧾 Revisión de inventario <span style={{ color: 'var(--t-muted)', fontWeight: 400 }}>· {filtered.length} pendiente{filtered.length === 1 ? '' : 's'}</span>
        </div>
        <div style={{ flex: 1 }} />
        <select className="cd-tbl-select" value={fSupplier} onChange={e => setFSupplier(e.target.value)} style={{ minWidth: 160 }}>
          <option value="">Todos los proveedores</option>
          {queueSuppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input type="date" className="cd-tbl-input" value={fDate} onChange={e => setFDate(e.target.value)} />
        {(fSupplier || fDate) && <button className="tips-btn-ghost" onClick={() => { setFSupplier(''); setFDate('') }}>Limpiar</button>}
        <button className="tips-btn-ghost" onClick={() => load()} disabled={loading}>↻</button>
      </div>

      {err && <div className="tips-error" style={{ marginBottom: '0.75rem' }}><span>{err}</span><button onClick={() => setErr(null)}>✕</button></div>}

      {loading ? (
        <div style={{ padding: '2rem', textAlign: 'center', opacity: 0.4 }}>⏳ Cargando…</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--t-muted)', fontSize: '0.82rem' }}>
          No hay facturas de insumos pendientes de revisión. 🎉
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '0.75rem' }}>
          {filtered.map(t => {
            const doc = docForTask(t)
            const thumb = doc ? urls[doc.id] : undefined
            return (
              <div key={t.id} style={{ border: '1px solid #2a2a2a', borderRadius: 8, padding: '0.7rem', background: '#161616', display: 'flex', gap: '0.7rem' }}>
                <div style={{ width: 56, height: 56, flexShrink: 0, borderRadius: 6, overflow: 'hidden', background: '#0d0d0d', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {thumb
                    ? <a href={thumb} target="_blank" rel="noreferrer"><img src={thumb} alt="factura" style={{ width: 56, height: 56, objectFit: 'cover' }} /></a>
                    : <span style={{ fontSize: '1.2rem', opacity: 0.4 }}>📄</span>}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.8rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{supName(t.supplier_id)}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--t-muted)' }}>{t.entry_date ?? '—'}</div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--vt-gold)', marginTop: 2 }}>
                    {t.amount_crc != null ? money(t.amount_crc, t.currency) : '—'}
                  </div>
                  <button className="cd-btn-green" style={{ marginTop: 6, padding: '0.25rem 0.6rem', fontSize: '0.72rem' }} onClick={() => setSelId(t.id)}>
                    Revisar →
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {selected && (() => {
        const selMov = selected.cash_movement_id ? movsById[selected.cash_movement_id] : undefined
        const selDoc = docForTask(selected)
        return (
          <ReviewDetail
            // La key incluye el doc: al adjuntar una factura (sin-doc → con-doc) la vista REMONTA
            // y el efecto de armado de líneas corre con los ítems recién extraídos.
            key={`${selected.id}:${selDoc?.id ?? 'nodoc'}`}
            task={selected}
            doc={selDoc}
            docUrl={selDoc ? urls[selDoc.id] : undefined}
            movement={selMov}
            ingredients={ingredients}
            suppliers={suppliers}
            supplierName={supName(selected.supplier_id)}
            createdBy={profile?.id}
            creatorName={selMov ? (creatorsById[selMov.created_by] ?? selMov.created_by) : undefined}
            onClose={() => setSelId(null)}
            onSaved={load}
            onDone={onDone}
          />
        )
      })()}
    </div>
  )
}

// ── Panel lateral de la foto (T3-A2, solo desktop ≥900px vía CSS) ──────────────────────
// UI-only: muestra la MISMA signed URL ya cargada por el padre (urls[doc.id] — no re-firma).
// Click sobre la foto alterna zoom 1x ↔ 2.5x; en zoom se recorre con scroll o arrastrando
// (drag-to-pan; un arrastre real no dispara el toggle). ⛶ abre pantalla completa (mismo patrón
// de lightbox que FacturaThumbs). En <900px el panel no existe (CSS) — queda el thumb de T3-A.
function FotoPanel({ url }: { url: string }) {
  const [zoom, setZoom] = useState(false)
  const [full, setFull] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; sl: number; st: number; moved: boolean } | null>(null)
  const justDragged = useRef(false)   // suprime el click-toggle inmediatamente después de un arrastre

  useEffect(() => {
    if (!full) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFull(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [full])

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Drag-to-pan SOLO para mouse: en táctil el pan ya es el scroll nativo del contenedor
    // (capturar el puntero ahí pelearía con ese scroll).
    if (e.pointerType !== 'mouse') return
    if (!zoom || !scrollRef.current) return
    drag.current = { x: e.clientX, y: e.clientY, sl: scrollRef.current.scrollLeft, st: scrollRef.current.scrollTop, moved: false }
    scrollRef.current.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !scrollRef.current) return
    const dx = e.clientX - drag.current.x
    const dy = e.clientY - drag.current.y
    if (Math.abs(dx) + Math.abs(dy) > 6) drag.current.moved = true
    scrollRef.current.scrollLeft = drag.current.sl - dx
    scrollRef.current.scrollTop  = drag.current.st - dy
  }
  const onPointerUp = () => {
    if (drag.current?.moved) justDragged.current = true
    drag.current = null
  }
  const toggleZoom = () => {
    if (justDragged.current) { justDragged.current = false; return }   // fue un pan, no un click
    setZoom(z => !z)
  }

  return (
    <div className="invrev-foto-panel">
      <div className="invrev-foto-box">
        <div className="invrev-foto-head">
          <span>🧾 Factura</span>
          <span style={{ display: 'inline-flex', gap: 6 }}>
            <button type="button" className="tips-btn-ghost" style={{ padding: '2px 8px', fontSize: '0.7rem' }}
              onClick={() => setZoom(z => !z)}>{zoom ? '− alejar' : '+ acercar'}</button>
            <button type="button" className="tips-btn-ghost" style={{ padding: '2px 8px', fontSize: '0.7rem' }}
              title="Pantalla completa" onClick={() => setFull(true)}>⛶</button>
          </span>
        </div>
        <div className="invrev-foto-scroll" ref={scrollRef}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove}
          onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
          <img src={url} alt="Factura (panel)" draggable={false}
            className={`invrev-foto-img${zoom ? ' zoomed' : ''}`} onClick={toggleZoom} />
        </div>
        <div className="invrev-foto-hint">
          {zoom ? 'Arrastrá o scrolleá para recorrer la factura · click para alejar' : 'Click sobre la foto para acercar y leer líneas chicas'}
        </div>
      </div>
      {full && (
        <div className="invrev-foto-full" onClick={() => setFull(false)}>
          <img src={url} alt="Factura (pantalla completa)" onClick={e => e.stopPropagation()} />
          <button type="button" aria-label="Cerrar" onClick={() => setFull(false)}>✕</button>
        </div>
      )}
    </div>
  )
}

// ── Detalle: mapear + editar metadatos (proveedor/nota) + completar / descartar ────────
function ReviewDetail({ task, doc, docUrl, movement, ingredients, suppliers, supplierName, createdBy, creatorName, onClose, onSaved, onDone }: {
  task: InvReviewTask
  doc: DocumentRow | undefined
  docUrl: string | undefined
  movement: CashMovement | undefined
  ingredients: Ingredient[]
  suppliers: Supplier[]
  supplierName: string
  createdBy: string | undefined
  creatorName: string | undefined
  onClose: () => void
  onSaved: () => void
  onDone: () => void
}) {
  const items: DocItem[] = useMemo(() => doc?.raw_json?.items ?? [], [doc])
  const [lines, setLines]   = useState<EditLine[]>([])
  const [loaded, setLoaded] = useState(false)
  // Metadatos editables (F4): nota = cash_movements.description; proveedor = supplier_id (sync task↔movimiento)
  const [note, setNote]         = useState(movement?.description ?? '')
  const [supplierId, setSupplierId] = useState(task.supplier_id ?? '')
  const [saving, setSaving]     = useState(false)
  const [err, setErr]           = useState<string | null>(null)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [discarding, setDiscarding] = useState(false)
  const [reason, setReason]     = useState('')
  const [attaching, setAttaching] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // F4.3b — vía de rectificación: adjuntar una factura a una tarea SIN factura. Reusa el pipeline EXACTO
  // de la Bandeja (normalizeInvoiceImage → uploadImage → extractImage), enlazando por
  // linked_movement_id = cash_movement_id. NUNCA toca el cash_movement (monto/método/estado/caja intactos):
  // solo crea el documento. Al refrescar, la tarea ya tiene ítems y el flujo `completar` EXISTENTE aplica.
  //
  // T3-A: entre extractImage y createDocumentRow hay un PASO DE CONFIRMACIÓN: se muestra la foto +
  // proveedor/total leídos por la IA vs los del pago, y el documento SOLO se crea si el contador
  // confirma (objetivo firmado: que no se suba cualquier foto a cualquier pago). Cancelar no crea
  // nada — la foto ya subida al bucket queda huérfana sin fila, invisible, y puede sacar otra.
  type PendingAttach = { path: string; sha: string; detected: DocExtract | null; previewUrl: string | null }
  const [pendingAttach, setPendingAttach] = useState<PendingAttach | null>(null)

  const onAttach = async (file: File) => {
    if (!task.cash_movement_id) { setErr('La tarea no tiene un movimiento ligado — no se puede adjuntar.'); return }
    if (!createdBy) { setErr('No se pudo identificar al usuario para registrar la carga.'); return }
    setAttaching(true); setErr(null); setSavedMsg(null)
    try {
      const { blob, filename } = await normalizeInvoiceImage(file)
      const { path, sha } = await uploadImage(blob, filename)
      const detected = await extractImage(path)              // la IA lee la factura (puede traer 0..n)
      const previewUrl = await signedUrl(path).catch(() => null)
      setPendingAttach({ path, sha, detected: detected[0] ?? null, previewUrl })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo adjuntar la factura — reintentá con buena luz.')
    } finally { setAttaching(false) }
  }

  // Confirmado por el contador → recién ahora se crea el documento (misma llamada que antes de T3-A).
  // estado='procesado' → la factura NO entra a la cola de la Bandeja (el pago ya existe); queda
  // enlazada al movimiento. Si la IA no extrajo nada, el doc se crea igual (foto en el expediente).
  const confirmAttach = async () => {
    if (!pendingAttach || !task.cash_movement_id || !createdBy) return
    setAttaching(true); setErr(null)
    try {
      await createDocumentRow(pendingAttach.path, pendingAttach.sha, pendingAttach.detected, createdBy, task.cash_movement_id, 'procesado')
      setPendingAttach(null)
      onSaved()   // recarga el padre → la key cambia (nodoc→docId) → remonta con los ítems extraídos
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo adjuntar la factura — reintentá.')
      setAttaching(false)
    }
  }

  const onPickAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) onAttach(f)
    e.target.value = ''   // permite re-elegir la misma foto
  }

  // Aviso (no bloqueante) si el total leído de la factura no coincide con el monto del pago. NO auto-corrige.
  const facturaTotal = doc?.raw_json?.total != null ? Number(doc.raw_json.total) : null
  const movAmount = movement ? (movement.currency === 'USD' ? movement.amount_usd : movement.amount_crc) : null
  const totalMismatch = totalDifiere(facturaTotal, movAmount)

  useEffect(() => {
    (async () => {
      const m = task.supplier_id ? await getSupplierItemMap(task.supplier_id).catch(() => []) : []
      setLines(items.map(it => resolveLine(it, m, ingredients)))
      setLoaded(true)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const upd = (i: number, patch: Partial<EditLine>) => setLines(prev => prev.map((l, idx) => idx === i ? { ...l, ...patch } : l))
  const onSelIngredient = (i: number, sel: string) => {
    const ing = ingredients.find(g => g.id === sel)
    upd(i, { sel, ...(ing ? { unidad: lines[i].unidad || ing.unit } : {}) })
  }

  const invCount = lines.filter(l => l.sel && l.sel !== NONE).length
  const curSupName = suppliers.find(s => s.id === supplierId)?.name ?? supplierName

  // Líneas YA decididas (ingrediente existente o "no es inventario") → aprendibles sin crear nada
  // ni exigir que TODAS estén resueltas. Para el aprendizaje al Guardar (parcial OK).
  const decidedInvLines = (): InvLine[] => lines
    .filter(l => l.sel === NONE || (!!l.sel && l.sel !== NEW))
    .map(l => ({
      codigo: l.codigo, descripcion: l.descripcion,
      ingredient_id: l.sel === NONE ? null : l.sel,
      ingredient_unit: ingredients.find(g => g.id === l.sel)?.unit || l.unidad || 'UN',
      unidad_factura: l.unidad || 'UN', factor_conversion: l.factor || 1,
      cantidad: l.cantidad, precio_unitario: l.precio,
      es_inventario: l.sel !== NONE,
    }))

  // Persistir metadatos (nota→description, proveedor→task+movimiento) + mapeo aprendido.
  // SOLO toca supplier_id/supplier_name/description del movimiento — jamás plata/forma de pago/estado.
  const persistMeta = async (learnLines: InvLine[]) => {
    const sup = suppliers.find(s => s.id === supplierId) ?? null
    if (task.cash_movement_id) {
      await updateMovementMetadata(task.cash_movement_id, {
        description: note,
        ...(supplierId ? { supplier_id: supplierId, supplier_name: sup?.name ?? '' } : {}),
      })
    }
    if (supplierId && supplierId !== (task.supplier_id ?? '')) {
      const { error } = await supabase.from('inventory_review_task').update({ supplier_id: supplierId }).eq('id', task.id)
      if (error) throw new Error(error.message)
    }
    if (supplierId) await learnSupplierMappings(supplierId, learnLines)
  }

  const guardar = async () => {
    setSaving(true); setErr(null); setSavedMsg(null)
    try {
      await persistMeta(decidedInvLines())
      setSavedMsg('✓ Cambios guardados')
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudieron guardar los cambios')
    } finally { setSaving(false) }
  }

  const completar = async () => {
    setSaving(true); setErr(null); setSavedMsg(null)
    try {
      const resolved = await resolveEditLines(lines, ingredients, curSupName)
      const pLines = buildReviewLines(resolved)
      if (!pLines.length) { setErr('Necesitás al menos 1 línea de inventario para completar.'); setSaving(false); return }
      await persistMeta(resolved)   // guarda metadatos + aprende el mapeo completo antes de cerrar
      const { error } = await supabase.rpc('complete_inventory_review', {
        p_task_id: task.id, p_lines: pLines, p_note: note,
      })
      if (error) throw new Error(error.message)
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo completar la revisión'); setSaving(false)
    }
  }

  const descartar = async () => {
    if (!reason.trim()) { setErr('El motivo del descarte es obligatorio.'); return }
    setSaving(true); setErr(null)
    try {
      const { error } = await supabase.rpc('discard_inventory_review', {
        p_task_id: task.id, p_reason: reason.trim(),
      })
      if (error) throw new Error(error.message)
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo descartar'); setSaving(false)
    }
  }

  // T3-A2: con factura y URL firmada, en desktop (≥900px, CSS) el modal se ensancha a DOS paneles:
  // izquierda = todo lo actual, derecha = FotoPanel sticky con zoom. En móvil el panel no existe.
  const showFotoPanel = !!(doc?.image_path && docUrl)

  return (
    <div className="cd-modal-overlay" onClick={onClose}>
      <div className={`cd-modal invrev-modal${showFotoPanel ? ' invrev-has-foto' : ''}`} onClick={e => e.stopPropagation()}>
      <div className="invrev-cols">
      <div className="invrev-main">
        <div className="cd-modal-title">Revisión — {curSupName}</div>
        <p style={{ fontSize: '0.74rem', color: 'var(--t-muted)', margin: '0.2rem 0 0.75rem' }}>
          Emparejá cada ítem con un ingrediente. Al completar entra al stock y queda auditado (el gasto ya está en Caja). Si no corresponde, descartá con motivo.
        </p>
        {err && <div className="tips-error" style={{ marginBottom: '0.6rem' }}><span>{err}</span><button onClick={() => setErr(null)}>✕</button></div>}
        {savedMsg && <div style={{ marginBottom: '0.6rem', padding: '0.4rem 0.7rem', borderRadius: 4, background: 'rgba(74,154,106,.12)', border: '1px solid #4a9a6a', color: '#4a9a6a', fontSize: '0.78rem' }}>{savedMsg}</div>}
        {/* Trazabilidad: quién registró el pago de mercadería (pedido de la dueña). */}
        {movement && (
          <div style={{ fontSize: '0.7rem', color: 'var(--t-muted)', marginBottom: '0.5rem' }}>
            Registrado por <strong>{creatorName ?? '—'}</strong>
            {movement.created_at ? ` · ${new Date(movement.created_at).toLocaleString('es-CR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}
          </div>
        )}
        {totalMismatch && (
          <div className="tips-error" style={{ marginBottom: '0.6rem' }}>
            <span>⚠ El total de la factura ({money(facturaTotal!, movement?.currency ?? 'CRC')}) no coincide con el monto del pago ({money(movAmount!, movement?.currency ?? 'CRC')}). Revisalo — el movimiento NO se modifica.</span>
          </div>
        )}
        {/* T3-A parte 1 — la foto de la factura en el detalle, en tamaño útil para comparar contra
            los ítems leídos (tap → fullscreen con el lightbox de FacturaThumbs; bucket 'documents').
            T3-A2: en desktop (≥900px) con panel lateral, este thumb se oculta por CSS (la foto no
            se duplica — vive en el panel). En móvil sigue siendo la única foto, como hoy. */}
        {doc?.image_path && (
          <div className="invrev-thumb-block" style={{ marginBottom: '0.6rem' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--t-muted)', marginBottom: 4 }}>
              Factura adjunta — tocá la foto para ampliarla y comparar contra los ítems leídos.
            </div>
            <FacturaThumbs paths={[doc.image_path]} size={120} resolve={signedUrl} />
          </div>
        )}
        {!doc && !pendingAttach && (
          <div style={{ marginBottom: '0.6rem', padding: '0.6rem 0.7rem', border: '1px dashed var(--vt-gold)', borderRadius: 6, background: 'rgba(200,169,110,.06)' }}>
            <div style={{ fontSize: '0.78rem', marginBottom: '0.45rem' }}>
              Esta tarea no tiene factura enlazada (el pago se hizo sin foto). Adjuntá la factura para poder completar el inventario — el gasto ya está registrado; esto <strong>solo agrega la factura</strong>, no toca el pago.
            </div>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onPickAttach} />
            <button className="cd-btn-green" onClick={() => fileRef.current?.click()} disabled={attaching || !task.cash_movement_id}>
              {attaching ? '📷 Leyendo factura…' : '📷 Adjuntar factura'}
            </button>
          </div>
        )}
        {/* T3-A parte 2 — confirmación ANTES de crear el documento: la foto + lo que leyó la IA vs lo
            que dice el pago. Cancelar no crea NADA (puede sacar otra foto). El movimiento no se toca. */}
        {!doc && pendingAttach && (() => {
          const leidoProv  = pendingAttach.detected?.proveedor ?? null
          const leidoTotal = pendingAttach.detected?.total != null ? Number(pendingAttach.detected.total) : null
          const difiere    = totalDifiere(leidoTotal, movAmount)
          const cur        = movement?.currency ?? 'CRC'
          return (
            <div style={{ marginBottom: '0.6rem', padding: '0.6rem 0.7rem', border: '1px solid var(--vt-gold)', borderRadius: 6, background: 'rgba(200,169,110,.08)' }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: '0.45rem' }}>¿Esta factura corresponde a este pago?</div>
              <div style={{ display: 'flex', gap: '0.7rem', alignItems: 'flex-start' }}>
                <div style={{ width: 96, flexShrink: 0 }}>
                  {pendingAttach.previewUrl
                    ? <a href={pendingAttach.previewUrl} target="_blank" rel="noreferrer">
                        <img src={pendingAttach.previewUrl} alt="factura a adjuntar" style={{ width: 96, borderRadius: 6, display: 'block' }} />
                      </a>
                    : <span style={{ fontSize: '1.6rem', opacity: 0.4 }}>📄</span>}
                </div>
                <div style={{ fontSize: '0.76rem', minWidth: 0, flex: 1, display: 'grid', gap: '0.25rem' }}>
                  <div>Proveedor leído: <strong>{leidoProv ?? '— (la IA no lo leyó)'}</strong></div>
                  <div style={{ color: 'var(--t-muted)' }}>Proveedor del pago: {curSupName}</div>
                  <div>Total leído: <strong>{leidoTotal != null ? money(leidoTotal, cur) : '— (la IA no lo leyó)'}</strong></div>
                  <div style={{ color: 'var(--t-muted)' }}>Monto del pago: {movAmount != null ? money(movAmount, cur) : '—'}</div>
                  {difiere && (
                    <div style={{ color: 'var(--t-red, #d66)', fontWeight: 600 }}>
                      ⚠ El total leído no coincide con el monto del pago. Confirmá solo si es la factura correcta — el movimiento NO se modifica.
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.6rem' }}>
                <button className="tips-btn-ghost" onClick={() => setPendingAttach(null)} disabled={attaching}>Cancelar</button>
                <button className="cd-btn-green" onClick={confirmAttach} disabled={attaching}>
                  {attaching ? 'Adjuntando…' : '✓ Confirmar y adjuntar'}
                </button>
              </div>
            </div>
          )
        })()}

        {!loaded ? (
          <div style={{ padding: '1rem', color: '#888' }}>Cargando…</div>
        ) : items.length === 0 ? (
          <div style={{ padding: '1rem', color: 'var(--t-muted)', fontSize: '0.8rem' }}>La factura no tiene ítems para ingresar.</div>
        ) : (
          <InvLineTable lines={lines} ingredients={ingredients} onUpdate={upd} onSelIngredient={onSelIngredient} />
        )}

        {!discarding ? (
          <div style={{ marginTop: '0.85rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.6rem' }}>
            <div>
              <label style={{ fontSize: '0.7rem', color: 'var(--t-muted)' }}>Proveedor</label>
              <select className="cd-tbl-select" value={supplierId} onChange={e => { setSupplierId(e.target.value); setSavedMsg(null) }} style={{ width: '100%' }}>
                <option value="">— sin proveedor —</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <div style={{ fontSize: '0.64rem', color: 'var(--t-muted)', marginTop: 2 }}>Se sincroniza con el movimiento de caja (supplier_id + nombre).</div>
            </div>
            <div>
              <label style={{ fontSize: '0.7rem', color: 'var(--t-muted)' }}>Nota {movement ? '(se guarda en el movimiento)' : '(solo auditoría al completar)'}</label>
              <textarea className="cd-tbl-input" value={note} onChange={e => { setNote(e.target.value); setSavedMsg(null) }} rows={2} style={{ width: '100%', resize: 'vertical' }} placeholder="Comentario / descripción…" />
            </div>
          </div>
        ) : (
          <div style={{ marginTop: '0.75rem' }}>
            <label style={{ fontSize: '0.7rem', color: 'var(--t-muted)' }}>Motivo del descarte (obligatorio)</label>
            <textarea className="cd-tbl-input" value={reason} onChange={e => setReason(e.target.value)} rows={2} autoFocus style={{ width: '100%', resize: 'vertical' }} placeholder="Por qué se descarta esta revisión…" />
          </div>
        )}

        <div className="cd-modal-actions" style={{ marginTop: '1rem' }}>
          {!discarding ? (
            <>
              <button className="tips-btn-ghost" onClick={onClose} disabled={saving}>Cerrar</button>
              <button className="tips-btn-ghost" onClick={() => { setErr(null); setSavedMsg(null); setDiscarding(true) }} disabled={saving}>🗑 Descartar</button>
              <button className="tips-btn-ghost" onClick={guardar} disabled={saving || !loaded}>{saving ? 'Guardando…' : '💾 Guardar'}</button>
              <button className="cd-btn-green" onClick={completar} disabled={saving || !loaded || invCount === 0}>
                {saving ? 'Completando…' : `✓ Completar (${invCount})`}
              </button>
            </>
          ) : (
            <>
              <button className="tips-btn-ghost" onClick={() => { setDiscarding(false); setReason(''); setErr(null) }} disabled={saving}>Volver</button>
              <button className="cd-btn-green" onClick={descartar} disabled={saving || !reason.trim()}>
                {saving ? 'Descartando…' : 'Confirmar descarte'}
              </button>
            </>
          )}
        </div>
      </div>
      {showFotoPanel && <FotoPanel url={docUrl!} />}
      </div>
      </div>
    </div>
  )
}
