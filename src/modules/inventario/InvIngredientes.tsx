/**
 * InvIngredientes — CRUD for ingredients + inline stock level editor
 */
import { useState } from 'react'
import type { Ingredient } from '../../shared/types/inventario'
import { INGREDIENT_CATEGORIES, INGREDIENT_UNITS } from '../../shared/types/inventario'
import { upsertIngredient, deleteIngredient } from '../../shared/api/inventario'

interface Props {
  ingredients: Ingredient[]
  onRefresh:   () => void
  profile:     { id: string; role: string } | null
}

const EMPTY: Partial<Ingredient> = {
  name: '', unit: 'unidad', current_stock: 0, min_stock: 0,
  cost_per_unit: 0, supplier: '', category: '', notes: '',
}

function fi(n: number): string {
  return '₡ ' + Math.round(n).toLocaleString('es-CR')
}

export default function InvIngredientes({ ingredients, onRefresh, profile }: Props) {
  const [editId,   setEditId]   = useState<string | null>(null)    // null = new
  const [form,     setForm]     = useState<Partial<Ingredient>>(EMPTY)
  const [saving,   setSaving]   = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [error,    setError]    = useState<string | null>(null)
  const [search,   setSearch]   = useState('')
  const [catFilter,setCatFilter]= useState('')
  const isOwnerMgr = profile?.role === 'owner' || profile?.role === 'manager'

  function startEdit(ing: Ingredient) { setEditId(ing.id); setForm({ ...ing }); setError(null) }
  function startNew()                  { setEditId(null);   setForm({ ...EMPTY }); setError(null) }
  function cancelEdit()                { setEditId(undefined as never); setForm(EMPTY); setError(null) }

  async function handleSave() {
    if (!form.name?.trim()) { setError('El nombre es obligatorio'); return }
    setSaving(true); setError(null)
    try {
      await upsertIngredient({ ...form, name: form.name.trim() } as Ingredient)
      cancelEdit(); onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`¿Eliminar "${name}"? Esta acción no se puede deshacer.`)) return
    setDeleting(id)
    try { await deleteIngredient(id); onRefresh() }
    catch (e) { setError(e instanceof Error ? e.message : 'Error eliminando') }
    finally { setDeleting(null) }
  }

  const filtered = ingredients.filter(i => {
    const matchSearch = !search || i.name.toLowerCase().includes(search.toLowerCase()) || i.supplier.toLowerCase().includes(search.toLowerCase())
    const matchCat    = !catFilter || i.category === catFilter
    return matchSearch && matchCat
  })

  const categories = [...new Set(ingredients.map(i => i.category).filter(Boolean))].sort()

  return (
    <div className="vt-section">

      {/* Controls */}
      <div style={{ display:'flex', gap:'0.5rem', flexWrap:'wrap', alignItems:'center', marginBottom:'1rem' }}>
        <input
          type="text" placeholder="Buscar ingrediente o proveedor…"
          value={search} onChange={e => setSearch(e.target.value)}
          style={{ background:'var(--vt-ink)', color:'var(--vt-paper)', border:'1px solid #2a2a2a', padding:'5px 10px', fontSize:'0.8rem', borderRadius:2, width:220 }} />
        <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
          style={{ background:'var(--vt-ink)', color:'var(--vt-paper)', border:'1px solid #2a2a2a', padding:'5px 10px', fontSize:'0.8rem', borderRadius:2 }}>
          <option value="">Todas las categorías</option>
          {categories.map(c => <option key={c}>{c}</option>)}
        </select>
        {isOwnerMgr && (
          <button className="vt-range-btn"
            style={{ marginLeft:'auto', borderColor:'var(--vt-green)', color:'var(--vt-green)' }}
            onClick={startNew}>
            + Nuevo ingrediente
          </button>
        )}
      </div>

      {/* Inline form */}
      {(editId !== undefined) && (
        <div style={{ background:'var(--vt-ink)', border:'1px solid #2a2a2a', borderRadius:2, padding:'1rem', marginBottom:'1rem' }}>
          <div style={{ fontSize:'0.75rem', letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--vt-gold)', marginBottom:'0.75rem', fontWeight:700 }}>
            {editId === null ? '+ Nuevo ingrediente' : 'Editar ingrediente'}
          </div>
          {error && <div style={{ color:'#c23b22', fontSize:'0.78rem', marginBottom:'0.5rem' }}>{error}</div>}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))', gap:'0.5rem', marginBottom:'0.75rem' }}>
            {[
              { label:'Nombre *',        key:'name',          type:'text',   placeholder:'ej: Atún fresco' },
              { label:'Categoría',       key:'category',      type:'select', options:INGREDIENT_CATEGORIES },
              { label:'Unidad',          key:'unit',          type:'select', options:INGREDIENT_UNITS },
              { label:'Stock actual',    key:'current_stock', type:'number', step:'0.001', placeholder:'0' },
              { label:'Stock mínimo',    key:'min_stock',     type:'number', step:'0.001', placeholder:'0' },
              { label:'Costo/unidad ₡',  key:'cost_per_unit', type:'number', step:'1',     placeholder:'0' },
              { label:'Proveedor',       key:'supplier',      type:'text',   placeholder:'ej: Mercado Central' },
              { label:'Notas',           key:'notes',         type:'text',   placeholder:'opcional' },
            ].map(f => (
              <div key={f.key}>
                <div style={{ fontSize:'0.65rem', color:'#555', marginBottom:3, textTransform:'uppercase', letterSpacing:'0.08em' }}>{f.label}</div>
                {f.type === 'select' ? (
                  <select className="cd-tbl-select"
                    value={(form as Record<string,unknown>)[f.key] as string ?? ''}
                    onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}>
                    <option value="">— elegir —</option>
                    {(f.options ?? []).map(o => <option key={o}>{o}</option>)}
                  </select>
                ) : (
                  <input className="cd-tbl-input"
                    type={f.type} step={f.step} placeholder={f.placeholder}
                    value={(form as Record<string,unknown>)[f.key] as string ?? ''}
                    onChange={e => setForm(p => ({
                      ...p,
                      [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value
                    }))} />
                )}
              </div>
            ))}
          </div>
          <div style={{ display:'flex', gap:'0.5rem' }}>
            <button className="vt-range-btn"
              style={{ borderColor:'var(--vt-green)', color:'var(--vt-green)' }}
              disabled={saving} onClick={handleSave}>
              {saving ? '⟳ Guardando…' : '✓ Guardar'}
            </button>
            <button className="vt-range-btn" onClick={cancelEdit}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="vt-tbl-wrap">
        <table className="vt-tbl">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Categoría</th>
              <th className="r">Stock actual</th>
              <th className="r">Mínimo</th>
              <th className="r">Costo/u</th>
              <th className="r">Valor</th>
              <th>Proveedor</th>
              {isOwnerMgr && <th/>}
            </tr>
          </thead>
          <tbody>
            {filtered.map(ing => {
              const isLow   = ing.min_stock > 0 && ing.current_stock <= ing.min_stock
              const isEmpty = ing.current_stock <= 0
              const rowColor = isEmpty ? '#c23b22' : isLow ? '#e8a838' : 'var(--vt-paper)'
              return (
                <tr key={ing.id}>
                  <td style={{ fontWeight:600, color:rowColor }}>
                    {isEmpty ? '🔴 ' : isLow ? '🟡 ' : ''}{ing.name}
                  </td>
                  <td style={{ fontSize:'0.75rem', color:'#888' }}>{ing.category || '—'}</td>
                  <td className="r" style={{ color:rowColor, fontWeight:700 }}>
                    {ing.current_stock.toLocaleString('es-CR')} {ing.unit}
                  </td>
                  <td className="r" style={{ color:'#555', fontSize:'0.78rem' }}>
                    {ing.min_stock > 0 ? `${ing.min_stock.toLocaleString('es-CR')} ${ing.unit}` : '—'}
                  </td>
                  <td className="r" style={{ fontSize:'0.78rem' }}>{ing.cost_per_unit > 0 ? fi(ing.cost_per_unit) : '—'}</td>
                  <td className="r" style={{ fontSize:'0.78rem', color:'#888' }}>
                    {ing.cost_per_unit > 0 ? fi(ing.current_stock * ing.cost_per_unit) : '—'}
                  </td>
                  <td style={{ fontSize:'0.75rem', color:'#666' }}>{ing.supplier || '—'}</td>
                  {isOwnerMgr && (
                    <td style={{ whiteSpace:'nowrap' }}>
                      <button onClick={() => startEdit(ing)}
                        style={{ background:'none', border:'1px solid #2a2a2a', color:'#888', borderRadius:2, padding:'2px 8px', fontSize:'0.68rem', cursor:'pointer', marginRight:4 }}>
                        Editar
                      </button>
                      <button onClick={() => handleDelete(ing.id, ing.name)}
                        disabled={deleting === ing.id}
                        style={{ background:'none', border:'1px solid #3a1a1a', color:'#c23b22', borderRadius:2, padding:'2px 8px', fontSize:'0.68rem', cursor:'pointer' }}>
                        {deleting === ing.id ? '…' : '✕'}
                      </button>
                    </td>
                  )}
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} style={{ textAlign:'center', padding:'2rem', color:'#555', fontSize:'0.85rem' }}>
                  {ingredients.length === 0 ? 'Sin ingredientes. Agregá el primero arriba.' : 'Sin resultados para ese filtro.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
