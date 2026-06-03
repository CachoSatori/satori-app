/**
 * InventarioModule — Gestión de stock de ingredientes + recetas
 *
 * Tabs:
 *   Dashboard   — stock cards, low-stock alerts, theoretical cost today
 *   Ingredientes — CRUD of ingredients with stock levels
 *   Recetas      — Link product_map items to ingredient recipes
 *   Movimientos  — Log purchases / waste / count adjustments + history
 */
import { useState, useEffect, useCallback, Suspense, lazy } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../shared/hooks/useAuth'
import { getIngredients, getMovements } from '../../shared/api/inventario'
import type { Ingredient, InventoryMovement } from '../../shared/types/inventario'

const InvDashboard    = lazy(() => import('./InvDashboard'))
const InvIngredientes = lazy(() => import('./InvIngredientes'))
const InvRecetas      = lazy(() => import('./InvRecetas'))
const InvMovimientos  = lazy(() => import('./InvMovimientos'))
const InvConsumo      = lazy(() => import('./InvConsumo'))
const InvFoodCost     = lazy(() => import('./InvFoodCost'))

type Tab = 'dashboard' | 'ingredientes' | 'recetas' | 'consumo' | 'foodcost' | 'movimientos'

const TABS: { id: Tab; label: string; roles: string[] }[] = [
  { id: 'dashboard',    label: '📊 Stock',       roles: ['owner','manager','contador'] },
  { id: 'ingredientes', label: '🧂 Ingredientes', roles: ['owner','manager'] },
  { id: 'recetas',      label: '📋 Recetas',      roles: ['owner','manager'] },
  { id: 'consumo',      label: '🍽 Consumo',      roles: ['owner','manager'] },
  { id: 'foodcost',     label: '💰 Food Cost',    roles: ['owner','manager','contador'] },
  { id: 'movimientos',  label: '📦 Movimientos',  roles: ['owner','manager','contador'] },
]

export default function InventarioModule() {
  const { profile } = useAuth()
  const navigate    = useNavigate()
  const role        = profile?.role ?? ''

  const visibleTabs = TABS.filter(t => t.roles.includes(role))
  const [tab, setTab] = useState<Tab>(visibleTabs[0]?.id ?? 'dashboard')

  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [movements,   setMovements]   = useState<InventoryMovement[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [ings, movs] = await Promise.all([getIngredients(), getMovements(200)])
      setIngredients(ings)
      setMovements(movs)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando datos')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  return (
    <div className="vt-module">

      {/* Header */}
      <div className="vt-module-header">
        <div style={{ display:'flex', alignItems:'center', gap:'0.75rem' }}>
          <span style={{ fontFamily:'var(--font-serif)', fontSize:'1.5rem', color:'var(--vt-gold)' }}>庫</span>
          <div>
            <div style={{ fontFamily:"'DM Mono',monospace", fontSize:'0.9rem', fontWeight:800, color:'var(--vt-gold)', letterSpacing:'0.1em' }}>
              INVENTARIO
            </div>
            <div style={{ fontSize:'0.6rem', letterSpacing:'0.3em', color:'#444', textTransform:'uppercase' }}>
              Satori · Ingredientes &amp; Recetas
            </div>
          </div>
          {role && <span className="role-badge">{role}</span>}
        </div>
        <button className="cash-back-btn" style={{ borderColor:'#333', color:'#888' }}
          onClick={() => navigate('/')}>← Inicio</button>
      </div>

      {/* Tabs */}
      <div className="vt-nav-tabs">
        {visibleTabs.map(t => (
          <div key={t.id}
            className={`vt-nav-tab ${tab === t.id ? 'active' : ''}`}
            style={tab === t.id ? { borderBottomColor:'var(--vt-gold)', color:'var(--vt-gold)' } : {}}
            onClick={() => setTab(t.id)}>
            {t.label}
          </div>
        ))}
      </div>

      {error && (
        <div className="tips-error" style={{ margin:'0.75rem 1.5rem' }}>
          <span>{error}</span><button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {loading ? (
        <div className="module-loading"><span className="loading-mark">庫</span></div>
      ) : (
        <Suspense fallback={<div style={{ padding:'3rem', textAlign:'center', opacity:0.4 }}>⏳</div>}>
          <div className="vt-content">
            {tab === 'dashboard'    && <InvDashboard    ingredients={ingredients} movements={movements} onRefresh={reload} />}
            {tab === 'ingredientes' && <InvIngredientes ingredients={ingredients} onRefresh={reload} profile={profile} />}
            {tab === 'recetas'      && <InvRecetas      ingredients={ingredients} onRefresh={reload} />}
            {tab === 'consumo'      && <InvConsumo      ingredients={ingredients} onRefresh={reload} profile={profile} />}
            {tab === 'foodcost'     && <InvFoodCost     ingredients={ingredients} />}
            {tab === 'movimientos'  && <InvMovimientos  ingredients={ingredients} movements={movements} onRefresh={reload} profile={profile} />}
          </div>
        </Suspense>
      )}
    </div>
  )
}
