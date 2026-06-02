/**
 * InvRecetas — Link product_map items to ingredient recipes
 * Allows calculating theoretical food cost per dish
 */
import { useState, useEffect } from 'react'
import type { Ingredient, Recipe, RecipeIngredient } from '../../shared/types/inventario'
import { INGREDIENT_UNITS } from '../../shared/types/inventario'
import {
  getRecipes, upsertRecipe, getRecipeIngredients,
  upsertRecipeIngredient, deleteRecipeIngredient,
} from '../../shared/api/inventario'
import { getProductMap, updateProductInfo } from '../../shared/api/ventas'
import type { ProductMap } from '../../shared/types/ventas'

interface Props {
  ingredients: Ingredient[]
  onRefresh:   () => void
}

function fi(n: number): string {
  return '₡ ' + Math.round(n).toLocaleString('es-CR')
}

export default function InvRecetas({ ingredients }: Props) {
  const [recipes,    setRecipes]    = useState<Recipe[]>([])
  const [pm,         setPm]         = useState<ProductMap>({})
  const [search,     setSearch]     = useState('')
  const [expanded,   setExpanded]   = useState<string | null>(null)
  const [recIngredients, setRecIngredients] = useState<Record<string, RecipeIngredient[]>>({})
  const [loading,    setLoading]    = useState(true)
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState<string | null>(null)
  const [syncing,    setSyncing]    = useState(false)
  const [syncMsg,    setSyncMsg]    = useState<string | null>(null)

  // New ingredient form state
  const [newIngId,    setNewIngId]   = useState('')
  const [newQty,      setNewQty]     = useState('')
  const [newUnit,     setNewUnit]    = useState('unidad')
  const [newWaste,    setNewWaste]   = useState('0')

  // Search for products to add recipe for
  const [prodSearch, setProdSearch] = useState('')

  useEffect(() => {
    Promise.all([getRecipes(), getProductMap()])
      .then(([r, p]) => { setRecipes(r); setPm(p) })
      .catch(e => setError(e instanceof Error ? e.message : 'Error'))
      .finally(() => setLoading(false))
  }, [])

  async function expandRecipe(recipe: Recipe) {
    if (expanded === recipe.id) { setExpanded(null); return }
    setExpanded(recipe.id)
    if (!recIngredients[recipe.id]) {
      const ri = await getRecipeIngredients(recipe.id)
      setRecIngredients(prev => ({ ...prev, [recipe.id]: ri }))
    }
  }

  async function addProductRecipe(productName: string) {
    setSaving(true); setError(null)
    try {
      const recipe = await upsertRecipe({ product_name: productName })
      setRecipes(prev => {
        const idx = prev.findIndex(r => r.product_name === productName)
        return idx >= 0 ? prev.map((r,i) => i===idx ? recipe : r) : [...prev, recipe]
      })
      setRecIngredients(prev => ({ ...prev, [recipe.id]: [] }))
      setExpanded(recipe.id)
      setProdSearch('')
    } catch(e) { setError(e instanceof Error ? e.message : 'Error') }
    finally { setSaving(false) }
  }

  async function addIngredientToRecipe(recipeId: string) {
    if (!newIngId || !newQty) { setError('Elegí un ingrediente y cantidad'); return }
    setSaving(true); setError(null)
    try {
      await upsertRecipeIngredient({
        recipe_id:     recipeId,
        ingredient_id: newIngId,
        quantity:      parseFloat(newQty),
        unit:          newUnit,
        waste_factor:  parseFloat(newWaste) / 100,
      })
      const ri = await getRecipeIngredients(recipeId)
      setRecIngredients(prev => ({ ...prev, [recipeId]: ri }))
      setNewIngId(''); setNewQty(''); setNewWaste('0')
    } catch(e) { setError(e instanceof Error ? e.message : 'Error') }
    finally { setSaving(false) }
  }

  async function removeRI(recipeId: string, riId: string) {
    try {
      await deleteRecipeIngredient(riId)
      setRecIngredients(prev => ({
        ...prev,
        [recipeId]: (prev[recipeId] ?? []).filter(r => r.id !== riId)
      }))
    } catch(e) { setError(e instanceof Error ? e.message : 'Error') }
  }

  function calcCost(ris: RecipeIngredient[]): number {
    return ris.reduce((sum, ri) => {
      const ing = ingredients.find(i => i.id === ri.ingredient_id)
      if (!ing) return sum
      const qty = ri.quantity * (1 + (ri.waste_factor ?? 0))
      return sum + qty * ing.cost_per_unit
    }, 0)
  }

  // Costo teórico POR UNIDAD vendida (total receta ÷ rendimiento)
  function perUnitCost(recipe: Recipe, ris: RecipeIngredient[]): number {
    const total = calcCost(ris)
    const y = recipe.yield_qty && recipe.yield_qty > 0 ? recipe.yield_qty : 1
    return total / y
  }

  // ── Sincronizar costo teórico de UNA receta → product_map.costo_unitario ──
  async function syncOne(recipe: Recipe) {
    setSyncing(true); setError(null); setSyncMsg(null)
    try {
      // Asegurar que los ingredientes de la receta estén cargados
      let ris = recIngredients[recipe.id]
      if (!ris) {
        ris = await getRecipeIngredients(recipe.id)
        setRecIngredients(prev => ({ ...prev, [recipe.id]: ris! }))
      }
      const cost = Math.round(perUnitCost(recipe, ris))
      if (cost <= 0) { setSyncMsg(`✗ ${recipe.product_name}: sin costo calculable (faltan ingredientes/costos)`); return }
      await updateProductInfo(recipe.product_name, { costo_unitario: cost })
      setPm(prev => ({ ...prev, [recipe.product_name]: { ...(prev[recipe.product_name] ?? { tipo:'', clasificacion:'', subclasificacion:'', multiplicador:1, costo_unitario:0 }), costo_unitario: cost } }))
      setSyncMsg(`✓ ${recipe.product_name}: costo actualizado a ${fi(cost)}`)
      setTimeout(() => setSyncMsg(null), 5000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error sincronizando')
    } finally {
      setSyncing(false)
    }
  }

  // ── Sincronizar TODAS las recetas con costo > 0 → product_map ──
  async function syncAll() {
    setSyncing(true); setError(null); setSyncMsg(null)
    try {
      let ok = 0, skipped = 0
      const newPm = { ...pm }
      for (const recipe of recipes) {
        let ris = recIngredients[recipe.id]
        if (!ris) {
          ris = await getRecipeIngredients(recipe.id)
          setRecIngredients(prev => ({ ...prev, [recipe.id]: ris! }))
        }
        const cost = Math.round(perUnitCost(recipe, ris))
        if (cost <= 0) { skipped++; continue }
        await updateProductInfo(recipe.product_name, { costo_unitario: cost })
        newPm[recipe.product_name] = { ...(newPm[recipe.product_name] ?? { tipo:'', clasificacion:'', subclasificacion:'', multiplicador:1, costo_unitario:0 }), costo_unitario: cost }
        ok++
      }
      setPm(newPm)
      setSyncMsg(`✓ ${ok} producto${ok !== 1 ? 's' : ''} sincronizado${ok !== 1 ? 's' : ''}${skipped ? ` · ${skipped} sin costo (omitidos)` : ''}`)
      setTimeout(() => setSyncMsg(null), 7000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error sincronizando')
    } finally {
      setSyncing(false)
    }
  }

  const filteredRecipes = recipes.filter(r =>
    !search || r.product_name.toLowerCase().includes(search.toLowerCase())
  )

  // Products with no recipe yet
  const productsNoRecipe = Object.keys(pm)
    .filter(n => !recipes.find(r => r.product_name === n))
    .filter(n => !prodSearch || n.toLowerCase().includes(prodSearch.toLowerCase()))
    .sort()
    .slice(0, 30)

  if (loading) return <div className="vt-section"><div className="vt-empty"><div className="loading-mark">📋</div></div></div>

  return (
    <div className="vt-section">
      {error && <div style={{ color:'#c23b22', fontSize:'0.78rem', marginBottom:'0.5rem' }}>{error}</div>}

      {/* Barra de sincronización de costos teóricos → product_map */}
      <div style={{ display:'flex', alignItems:'center', gap:'0.75rem', flexWrap:'wrap', marginBottom:'0.75rem', padding:'0.6rem 0.75rem', background:'rgba(74,154,106,0.06)', border:'1px solid rgba(74,154,106,0.25)', borderRadius:2 }}>
        <span style={{ fontSize:'0.72rem', color:'#4a9a6a', fontWeight:700, letterSpacing:'0.04em' }}>⇄ Food cost teórico</span>
        <span style={{ fontSize:'0.68rem', color:'#888' }}>
          Calcula el costo desde la receta y lo escribe en el producto (lo usa MenuEng y el análisis de margen)
        </span>
        <button
          onClick={syncAll}
          disabled={syncing || recipes.length === 0}
          style={{ marginLeft:'auto', fontSize:'0.78rem', padding:'5px 12px', borderRadius:2, background: syncing ? '#1a1a1a' : 'var(--vt-green)', color: syncing ? '#666' : '#0a0a0a', fontWeight:800, border:'none', cursor: syncing ? 'default' : 'pointer' }}>
          {syncing ? '⟳ Sincronizando…' : `⇄ Sincronizar todos (${recipes.length})`}
        </button>
        {syncMsg && (
          <span style={{ width:'100%', fontSize:'0.78rem', fontWeight:600, color: syncMsg.startsWith('✓') ? 'var(--vt-green)' : 'var(--vt-red)' }}>{syncMsg}</span>
        )}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1.5rem' }}>

        {/* Left: existing recipes */}
        <div>
          <div style={{ display:'flex', gap:'0.5rem', alignItems:'center', marginBottom:'0.75rem' }}>
            <div className="vt-sl" style={{ margin:0 }}>Recetas ({recipes.length})</div>
            <input type="text" placeholder="Buscar…" value={search} onChange={e => setSearch(e.target.value)}
              style={{ background:'var(--vt-ink)', color:'var(--vt-paper)', border:'1px solid #2a2a2a', padding:'4px 8px', fontSize:'0.75rem', borderRadius:2, width:140, marginLeft:'auto' }} />
          </div>

          <div style={{ display:'flex', flexDirection:'column', gap:'0.35rem' }}>
            {filteredRecipes.map(recipe => {
              const ris      = recIngredients[recipe.id] ?? []
              const cost     = calcCost(ris)
              const unitCost = Math.round(perUnitCost(recipe, ris))
              const info     = pm[recipe.product_name]
              const pmCost   = info?.costo_unitario ?? 0
              const drift    = unitCost > 0 && pmCost > 0 && Math.abs(unitCost - pmCost) > 1
              const isOpen   = expanded === recipe.id
              return (
                <div key={recipe.id} style={{ border:'1px solid #2a2a2a', borderRadius:2, overflow:'hidden' }}>
                  {/* Header */}
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0.5rem 0.75rem', background:'var(--vt-ink)', cursor:'pointer' }}
                    onClick={() => expandRecipe(recipe)}>
                    <div>
                      <span style={{ fontWeight:600, fontSize:'0.82rem' }}>{recipe.product_name}</span>
                      {info && <span className={`vt-prod-tipo ${info.tipo}`} style={{ fontSize:'0.58rem', marginLeft:5 }}>{info.tipo}</span>}
                    </div>
                    <div style={{ display:'flex', gap:'0.6rem', alignItems:'center' }} onClick={e => e.stopPropagation()}>
                      {cost > 0 && (
                        <span style={{ fontSize:'0.72rem', color:'#4a9a6a', fontWeight:700 }} title="Costo teórico por unidad (receta ÷ rendimiento)">
                          receta: {fi(unitCost)}
                        </span>
                      )}
                      {pmCost > 0 && (
                        <span style={{ fontSize:'0.7rem', color: drift ? '#c8a030' : '#666', fontWeight:600 }} title="Costo actual en el producto (product_map)">
                          pm: {fi(pmCost)}{drift ? ' ⚠' : ''}
                        </span>
                      )}
                      {unitCost > 0 && (
                        <button
                          onClick={() => syncOne(recipe)}
                          disabled={syncing}
                          title="Escribir este costo en el producto"
                          style={{ fontSize:'0.66rem', padding:'2px 7px', borderRadius:2, border:'1px solid var(--vt-green)', background: drift || pmCost === 0 ? 'rgba(74,154,106,0.15)' : 'transparent', color:'var(--vt-green)', cursor: syncing ? 'default' : 'pointer', fontWeight:700 }}>
                          ⇄
                        </button>
                      )}
                      <span style={{ color:'#555', fontSize:'0.78rem', cursor:'pointer' }} onClick={() => expandRecipe(recipe)}>{isOpen ? '▲' : '▶'} {ris.length} ing.</span>
                    </div>
                  </div>

                  {/* Expanded: ingredient list + add form */}
                  {isOpen && (
                    <div style={{ padding:'0.75rem', background:'#0d0d0d' }}>
                      {ris.map(ri => {
                        const ing = ingredients.find(i => i.id === ri.ingredient_id)
                        const riCost = ing ? ri.quantity * (1 + ri.waste_factor) * ing.cost_per_unit : 0
                        return (
                          <div key={ri.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0.3rem 0', borderBottom:'1px solid #1a1a1a', fontSize:'0.78rem' }}>
                            <span style={{ color:'#aaa', flex:1 }}>{ing?.name ?? ri.ingredient_id}</span>
                            <span style={{ color:'#666', marginRight:'0.5rem' }}>{ri.quantity} {ri.unit}</span>
                            {ri.waste_factor > 0 && <span style={{ color:'#555', fontSize:'0.68rem', marginRight:'0.5rem' }}>+{(ri.waste_factor*100).toFixed(0)}% merma</span>}
                            {riCost > 0 && <span style={{ color:'#4a9a6a', fontWeight:600, marginRight:'0.5rem' }}>{fi(riCost)}</span>}
                            <button onClick={() => removeRI(recipe.id, ri.id)}
                              style={{ background:'none', border:'none', color:'#c23b22', cursor:'pointer', fontSize:'0.82rem', padding:'0 4px' }}>✕</button>
                          </div>
                        )
                      })}

                      {/* Add ingredient row */}
                      <div style={{ display:'flex', gap:'0.4rem', flexWrap:'wrap', marginTop:'0.5rem', alignItems:'flex-end' }}>
                        <select className="cd-tbl-select" value={newIngId} onChange={e => setNewIngId(e.target.value)} style={{ flex:'2 1 140px' }}>
                          <option value="">— ingrediente —</option>
                          {ingredients.map(i => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
                        </select>
                        <input className="cd-tbl-input" type="number" min="0.001" step="0.001" placeholder="Cantidad"
                          value={newQty} onChange={e => setNewQty(e.target.value)} style={{ flex:'1 1 80px', width:80 }} />
                        <select className="cd-tbl-select" value={newUnit} onChange={e => setNewUnit(e.target.value)} style={{ flex:'1 1 70px' }}>
                          {INGREDIENT_UNITS.map(u => <option key={u}>{u}</option>)}
                        </select>
                        <input className="cd-tbl-input" type="number" min="0" max="50" step="1" placeholder="Merma%"
                          value={newWaste} onChange={e => setNewWaste(e.target.value)} style={{ flex:'0 1 70px', width:70 }} />
                        <button className="vt-range-btn"
                          style={{ borderColor:'var(--vt-green)', color:'var(--vt-green)', flex:'0 0 auto' }}
                          disabled={saving} onClick={() => addIngredientToRecipe(recipe.id)}>
                          + Agregar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
            {filteredRecipes.length === 0 && (
              <div style={{ color:'#555', fontSize:'0.82rem', padding:'1rem', textAlign:'center' }}>
                {recipes.length === 0 ? 'Sin recetas todavía.' : 'Sin resultados.'}
              </div>
            )}
          </div>
        </div>

        {/* Right: products without recipe */}
        <div>
          <div style={{ display:'flex', gap:'0.5rem', alignItems:'center', marginBottom:'0.75rem' }}>
            <div className="vt-sl" style={{ margin:0 }}>Agregar receta a producto</div>
          </div>
          <input type="text" placeholder="Buscar producto…" value={prodSearch} onChange={e => setProdSearch(e.target.value)}
            style={{ background:'var(--vt-ink)', color:'var(--vt-paper)', border:'1px solid #2a2a2a', padding:'5px 10px', fontSize:'0.8rem', borderRadius:2, width:'100%', marginBottom:'0.5rem', boxSizing:'border-box' }} />
          <div style={{ display:'flex', flexDirection:'column', gap:3, maxHeight:480, overflowY:'auto' }}>
            {productsNoRecipe.map(n => {
              const info = pm[n]
              return (
                <div key={n} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0.4rem 0.625rem', background:'var(--vt-ink)', borderRadius:2, cursor:'pointer', border:'1px solid transparent' }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor='#2a2a2a')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor='transparent')}>
                  <span style={{ fontSize:'0.8rem', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {n}
                    {info && <span className={`vt-prod-tipo ${info.tipo}`} style={{ fontSize:'0.58rem', marginLeft:5 }}>{info.tipo}</span>}
                  </span>
                  <button className="vt-range-btn"
                    style={{ fontSize:'0.65rem', borderColor:'#3a3a3a', color:'#888', flexShrink:0 }}
                    disabled={saving} onClick={() => addProductRecipe(n)}>
                    + Receta
                  </button>
                </div>
              )
            })}
            {productsNoRecipe.length === 0 && (
              <div style={{ color:'#555', fontSize:'0.82rem', padding:'1rem', textAlign:'center' }}>
                {Object.keys(pm).length === 0 ? 'Cargá el product map primero.' : '✓ Todos los productos tienen receta o no hay resultados.'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
