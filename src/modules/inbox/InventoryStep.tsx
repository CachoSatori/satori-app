import { useState, useEffect, useMemo } from 'react'
import type { Supplier } from '../../shared/types/database'
import type { Ingredient } from '../../shared/types/inventario'
import type { DocumentRow, DocItem } from '../../shared/api/documents'
import {
  getSupplierItemMap, findOrCreateSupplier, createIngredient,
  commitInventoryForDocument, type InvLine, type SupplierItemMap,
} from '../../shared/api/inventoryIngest'

const NONE = '__none__', NEW = '__new__'
const N = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const norm = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

interface Line {
  codigo: string | null
  descripcion: string
  sel: string            // '' | NONE | NEW | ingredient_id
  newName: string
  newUnit: string
  unidad: string
  factor: number
  cantidad: number
  precio: number
}

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
  const [lines, setLines] = useState<Line[]>([])
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

  const upd = (i: number, patch: Partial<Line>) => setLines(prev => prev.map((l, idx) => idx === i ? { ...l, ...patch } : l))

  // Al elegir un ingrediente existente, prefijar su unidad base
  const onSelIngredient = (i: number, sel: string) => {
    const ing = ingredients.find(g => g.id === sel)
    upd(i, { sel, ...(ing ? { unidad: lines[i].unidad || ing.unit } : {}) })
  }

  const confirmar = async () => {
    setSaving(true); setErr(null)
    try {
      const sid = supplierId ?? await findOrCreateSupplier(ex?.proveedor || '', suppliers)
      // Crear ingredientes nuevos primero
      const resolved: InvLine[] = []
      for (const l of lines) {
        const esInv = l.sel !== NONE
        let ingredientId: string | null = null
        let unitBase = l.unidad
        if (esInv) {
          if (l.sel === NEW) {
            if (!l.newName.trim()) { setErr(`Falta el nombre del ingrediente nuevo para "${l.descripcion}"`); setSaving(false); return }
            ingredientId = await createIngredient(l.newName.trim(), l.newUnit || 'UN', ex?.proveedor || undefined)
            unitBase = l.newUnit || 'UN'
          } else if (l.sel) {
            ingredientId = l.sel
            unitBase = ingredients.find(g => g.id === l.sel)?.unit || l.unidad || 'UN'
          } else {
            setErr(`Elegí un ingrediente (o "no es inventario") para "${l.descripcion}"`); setSaving(false); return
          }
        }
        resolved.push({
          codigo: l.codigo, descripcion: l.descripcion, ingredient_id: ingredientId,
          ingredient_unit: unitBase, unidad_factura: l.unidad || 'UN',
          factor_conversion: l.factor || 1, cantidad: l.cantidad, precio_unitario: l.precio,
          es_inventario: esInv && !!ingredientId,
        })
      }
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
          <div style={{ overflowX: 'auto' }}>
            <table className="cd-tbl" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Ítem de factura</th>
                  <th style={{ textAlign: 'left' }}>Ingrediente</th>
                  <th style={{ textAlign: 'right' }}>Cant.</th>
                  <th style={{ textAlign: 'left' }}>Un. fact.</th>
                  <th style={{ textAlign: 'right' }}>Factor →base</th>
                  <th style={{ textAlign: 'right' }}>Precio</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const esInv = l.sel !== NONE
                  return (
                    <tr key={i}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{l.descripcion}</div>
                        {l.codigo && <div style={{ fontSize: '0.66rem', color: 'var(--t-muted)' }}>cód {l.codigo}</div>}
                      </td>
                      <td>
                        <select className="cd-tbl-select" style={{ minWidth: 180 }} value={l.sel} onChange={e => onSelIngredient(i, e.target.value)}>
                          <option value="">— elegir —</option>
                          <option value={NONE}>✕ No es inventario</option>
                          <option value={NEW}>+ Crear ingrediente</option>
                          <optgroup label="Ingredientes">
                            {ingredients.map(g => <option key={g.id} value={g.id}>{g.name} ({g.unit})</option>)}
                          </optgroup>
                        </select>
                        {l.sel === NEW && (
                          <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                            <input className="cd-tbl-input" placeholder="Nombre" value={l.newName} onChange={e => upd(i, { newName: e.target.value })} style={{ width: 120 }} />
                            <input className="cd-tbl-input" placeholder="Un. base (K/UN…)" value={l.newUnit} onChange={e => upd(i, { newUnit: e.target.value })} style={{ width: 90 }} />
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <input type="number" className="cd-tbl-input" value={l.cantidad} onChange={e => upd(i, { cantidad: N(e.target.value) })} style={{ width: 60, textAlign: 'right' }} />
                      </td>
                      <td><input className="cd-tbl-input" value={l.unidad} onChange={e => upd(i, { unidad: e.target.value })} style={{ width: 56 }} disabled={!esInv} /></td>
                      <td style={{ textAlign: 'right' }}>
                        <input type="number" className="cd-tbl-input" value={l.factor} onChange={e => upd(i, { factor: N(e.target.value) })} style={{ width: 64, textAlign: 'right' }} disabled={!esInv} />
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <input type="number" className="cd-tbl-input" value={l.precio} onChange={e => upd(i, { precio: N(e.target.value) })} style={{ width: 80, textAlign: 'right' }} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p style={{ fontSize: '0.68rem', color: 'var(--t-muted)', marginTop: '0.5rem' }}>
              Factor = cuántas unidades base entran por 1 unidad de factura (ej. caja de 12 → 12; kg → 1). Stock que entra = cantidad × factor. Precio base = precio ÷ factor.
            </p>
          </div>
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

// Resolver una línea: mapeo aprendido → fuzzy → vacío
function resolveLine(it: DocItem, map: SupplierItemMap[], ingredients: Ingredient[]): Line {
  const codigo = (it.codigo ?? '').trim() || null
  const descripcion = it.descripcion || ''
  const base: Line = {
    codigo, descripcion, sel: '', newName: descripcion, newUnit: it.unidad || 'UN',
    unidad: it.unidad || 'UN', factor: 1, cantidad: N(it.cantidad) || 1, precio: N(it.precio_unitario) || N(it.total),
  }
  // 1) mapeo aprendido
  const learned = map.find(m => (codigo && m.codigo === codigo) || (!codigo && norm(m.descripcion_factura || '') === norm(descripcion)))
  if (learned) {
    if (!learned.es_inventario) return { ...base, sel: NONE }
    return { ...base, sel: learned.ingredient_id ?? '', factor: Number(learned.factor_conversion) || 1, unidad: learned.unidad_factura || base.unidad }
  }
  // 2) fuzzy por nombre
  const dn = norm(descripcion)
  const fuzzy = ingredients.find(g => { const gn = norm(g.name); return gn && (dn.includes(gn) || gn.includes(dn.split(' ')[0])) })
  if (fuzzy) return { ...base, sel: fuzzy.id, unidad: base.unidad }
  return base
}
