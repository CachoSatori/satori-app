import { useState, useEffect, useMemo } from 'react'
import type { Supplier } from '../../shared/types/database'
import type { Ingredient } from '../../shared/types/inventario'
import type { DocumentRow, DocItem } from '../../shared/api/documents'
import {
  getSupplierItemMap, findOrCreateSupplier, commitInventoryForDocument,
  resolveLine, resolveEditLines, norm, NONE, type EditLine,
} from '../../shared/api/inventoryIngest'
import InvLineTable from '../../shared/InvLineTable'

export default function InventoryStep({ doc, ingredients, suppliers, createdBy, onClose, onDone }: {
  doc: DocumentRow
  ingredients: Ingredient[]
  suppliers: Supplier[]
  createdBy: string
  onClose: () => void
  onDone: () => void
}) {
  const ex = doc.raw_json
  const items: DocItem[] = useMemo(() => ex?.items ?? [], [ex])
  const [supplierId, setSupplierId] = useState<string | null>(null)
  const [lines, setLines] = useState<EditLine[]>([])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    (async () => {
      // Resolver el proveedor
      const pn = norm(ex?.proveedor || '')
      const sup = suppliers.find(s => norm(s.name) === pn || (s.aliases ?? []).some(a => norm(a) === pn))
      const sid = sup?.id ?? null
      setSupplierId(sid)
      const m = sid ? await getSupplierItemMap(sid).catch(() => []) : []
      // Resolver cada ítem
      setLines(items.map(it => resolveLine(it, m, ingredients)))
      setLoaded(true)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const upd = (i: number, patch: Partial<EditLine>) => setLines(prev => prev.map((l, idx) => idx === i ? { ...l, ...patch } : l))

  // Al elegir un ingrediente existente, prefijar su unidad base
  const onSelIngredient = (i: number, sel: string) => {
    const ing = ingredients.find(g => g.id === sel)
    upd(i, { sel, ...(ing ? { unidad: lines[i].unidad || ing.unit } : {}) })
  }

  const confirmar = async () => {
    setSaving(true); setErr(null)
    try {
      const sid = supplierId ?? await findOrCreateSupplier(ex?.proveedor || '', suppliers)
      // Crear ingredientes nuevos y resolver a InvLine[] (mapeo compartido)
      const resolved = await resolveEditLines(lines, ingredients, ex?.proveedor || '')
      const res = await commitInventoryForDocument({
        documentId: doc.id, cashMovementId: doc.linked_movement_id, supplierId: sid,
        fecha: ex?.fecha ?? null, createdBy, lines: resolved,
      })
      void res
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al ingresar inventario'); setSaving(false)
    }
  }

  return (
    <div className="cd-modal-overlay" onClick={onClose}>
      <div className="cd-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 860 }}>
        <div className="cd-modal-title">Inventario — {ex?.proveedor || 'Factura'}</div>
        <p style={{ fontSize: '0.74rem', color: 'var(--t-muted)', margin: '0.2rem 0 0.75rem' }}>
          Emparejá cada ítem con un ingrediente. El stock entra al confirmar (idempotente: una vez por factura). El gasto ya está registrado.
        </p>
        {!supplierId && <div className="tips-error" style={{ marginBottom: '0.6rem' }}><span>No encontré el proveedor "{ex?.proveedor}" en el directorio — se creará al confirmar para aprender el mapeo.</span></div>}
        {err && <div className="tips-error" style={{ marginBottom: '0.6rem' }}><span>{err}</span><button onClick={() => setErr(null)}>✕</button></div>}

        {!loaded ? <div style={{ padding: '1rem', color: '#888' }}>Cargando…</div> : (
          <InvLineTable lines={lines} ingredients={ingredients} onUpdate={upd} onSelIngredient={onSelIngredient} />
        )}

        <div className="cd-modal-actions" style={{ marginTop: '1rem' }}>
          <button className="tips-btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="cd-btn-green" onClick={confirmar} disabled={saving || !loaded}>
            {saving ? 'Ingresando…' : `✓ Ingresar a inventario (${lines.filter(l => l.sel && l.sel !== NONE).length})`}
          </button>
        </div>
      </div>
    </div>
  )
}
