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
import { getProductMap } from '../../shared/api/ventas'
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
              const ris    = recIngredients[recipe.id] ?? []
              const cost   = calcCost(ris)
              const info   = pm[recipe.product_name]
              const isOpen = expanded === recipe.id
              return (
                <div key={recipe.id} style={{ border:'1px solid #2a2a2a', borderRadius:2, overflow:'hidden' }}>
                  {/* Header */}
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0.5rem 0.75rem', background:'var(--vt-ink)', cursor:'pointer' }}
                    onClick={() => expandRecipe(recipe)}>
                    <div>
                      <span style={{ fontWeight:600, fontSize:'0.82rem' }}>{recipe.product_name}</span>
                      {info && <span className={`vt-prod-tipo ${info.tipo}`} style={{ fontSize:'0.58rem', marginLeft:5 }}>{info.tipo}</span>}
                    </div>
                    <div style={{ display:'flex', gap:'0.75rem', alignItems:'center' }}>
                      {cost > 0 && <span style={{ fontSize:'0.72rem', color:'#4a9a6a', fontWeight:700 }}>FC: {fi(cost)}</span>}
                      <span style={{ color:'#555', fontSize:'0.78rem' }}>{isOpen ? '▲' : '▶'} {ris.length} ing.</span>
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
