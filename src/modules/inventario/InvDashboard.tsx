/**
 * InvDashboard — Stock levels, low-stock alerts, movement summary
 */
import { useState, useMemo } from 'react'
import type { Ingredient, InventoryMovement } from '../../shared/types/inventario'

interface Props {
  ingredients: Ingredient[]
  movements:   InventoryMovement[]
  onRefresh:   () => void
}

function fi(n: number): string {
  return '₡ ' + Math.round(n).toLocaleString('es-CR')
}

function stockColor(ing: Ingredient): string {
  if (ing.current_stock <= 0) return '#c23b22'
  if (ing.min_stock > 0 && ing.current_stock <= ing.min_stock) return '#e8a838'
  if (ing.min_stock > 0 && ing.current_stock <= ing.min_stock * 1.5) return '#c8a96e'
  return '#4a9a6a'
}

function stockLabel(ing: Ingredient): string {
  if (ing.current_stock <= 0)                                    return '🔴 Sin stock'
  if (ing.min_stock > 0 && ing.current_stock <= ing.min_stock)  return '🟡 Stock crítico'
  if (ing.min_stock > 0 && ing.current_stock <= ing.min_stock * 1.5) return '🟠 Stock bajo'
  return '🟢 OK'
}

export default function InvDashboard({ ingredients, movements }: Props) {
  const [copied, setCopied] = useState<string | null>(null)
  const totalValue    = ingredients.reduce((s, i) => s + i.current_stock * i.cost_per_unit, 0)
  const lowStock      = ingredients.filter(i => i.min_stock > 0 && i.current_stock <= i.min_stock)
  const outOfStock    = ingredients.filter(i => i.current_stock <= 0)
  const withStock     = ingredients.filter(i => i.current_stock > 0)
  const recentMovs    = movements.slice(0, 10)

  // ── Orden de compra sugerida: lo que está en/bajo mínimo, agrupado por proveedor ──
  // Cantidad sugerida = llevar el stock a 2× el mínimo (buffer). Costo = qty × costo/u.
  const reorderBySupplier = useMemo(() => {
    const items = ingredients
      .filter(i => i.min_stock > 0 && i.current_stock <= i.min_stock * 1.5)
      .map(i => {
        const qty = Math.max(0, Math.round((i.min_stock * 2 - i.current_stock) * 1000) / 1000)
        return { ing: i, qty, cost: qty * i.cost_per_unit }
      })
      .filter(x => x.qty > 0)
    const groups: Record<string, { items: typeof items; total: number }> = {}
    for (const x of items) {
      const sup = x.ing.supplier?.trim() || 'Sin proveedor'
      if (!groups[sup]) groups[sup] = { items: [], total: 0 }
      groups[sup].items.push(x)
      groups[sup].total += x.cost
    }
    return Object.entries(groups).sort((a, b) => b[1].total - a[1].total)
  }, [ingredients])

  function copyOrder(supplier: string, items: { ing: Ingredient; qty: number; cost: number }[]) {
    const text = `Pedido — ${supplier}\n` + items.map(x => `• ${x.ing.name}: ${x.qty} ${x.ing.unit}`).join('\n')
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(supplier); setTimeout(() => setCopied(null), 2500)
    }).catch(() => window.prompt('Copiá el pedido:', text))
  }

  // Group by category
  const byCategory: Record<string, Ingredient[]> = {}
  for (const ing of ingredients) {
    const cat = ing.category || 'Sin categoría'
    if (!byCategory[cat]) byCategory[cat] = []
    byCategory[cat].push(ing)
  }

  if (ingredients.length === 0) {
    return (
      <div className="vt-section">
        <div className="vt-empty">
          <div className="vt-empty-icon">🧂</div>
          <div className="vt-empty-title">Sin ingredientes cargados</div>
          <div className="vt-empty-sub">Agregá ingredientes en la tab "Ingredientes" para empezar el seguimiento de stock.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="vt-section">

      {/* KPI row */}
      <div className="vt-kpi-grid" style={{ marginBottom:'1.5rem' }}>
        <div className="vt-kpi red">
          <div className="vt-kpi-label">Valor total en stock</div>
          <div className="vt-kpi-val">{fi(totalValue)}</div>
          <div className="vt-kpi-sub">{withStock.length} ingredientes con stock</div>
        </div>
        <div className="vt-kpi" style={{ borderLeftColor: outOfStock.length > 0 ? '#c23b22' : '#4a9a6a' }}>
          <div className="vt-kpi-label">Sin stock</div>
          <div className="vt-kpi-val" style={{ color: outOfStock.length > 0 ? '#c23b22' : '#4a9a6a' }}>
            {outOfStock.length}
          </div>
          <div className="vt-kpi-sub">de {ingredients.length} ingredientes</div>
        </div>
        <div className="vt-kpi" style={{ borderLeftColor: lowStock.length > 0 ? '#e8a838' : '#4a9a6a' }}>
          <div className="vt-kpi-label">Stock crítico / mínimo</div>
          <div className="vt-kpi-val" style={{ color: lowStock.length > 0 ? '#e8a838' : '#4a9a6a' }}>
            {lowStock.length}
          </div>
          <div className="vt-kpi-sub">por debajo del mínimo</div>
        </div>
        <div className="vt-kpi">
          <div className="vt-kpi-label">Últimos 7 días</div>
          <div className="vt-kpi-val">{movements.filter(m => {
            const d = new Date(m.created_at); const now = new Date()
            return (now.getTime() - d.getTime()) < 7 * 86400000
          }).length}</div>
          <div className="vt-kpi-sub">movimientos registrados</div>
        </div>
      </div>

      {/* Alertas */}
      {(outOfStock.length > 0 || lowStock.length > 0) && (
        <>
          <div className="vt-sl">⚠ Alertas de stock</div>
          <div style={{ display:'flex', flexDirection:'column', gap:'0.35rem', marginBottom:'1.5rem' }}>
            {outOfStock.map(i => (
              <div key={i.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', background:'rgba(194,59,34,.1)', border:'1px solid rgba(194,59,34,.3)', borderRadius:2, padding:'0.5rem 0.875rem', fontSize:'0.82rem' }}>
                <span style={{ color:'#f0ece4', fontWeight:600 }}>🔴 {i.name}</span>
                <span style={{ color:'#c23b22', fontWeight:700 }}>SIN STOCK · min: {i.min_stock} {i.unit}</span>
              </div>
            ))}
            {lowStock.filter(i => i.current_stock > 0).map(i => (
              <div key={i.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', background:'rgba(232,168,56,.08)', border:'1px solid rgba(232,168,56,.3)', borderRadius:2, padding:'0.5rem 0.875rem', fontSize:'0.82rem' }}>
                <span style={{ color:'#f0ece4', fontWeight:600 }}>🟡 {i.name}</span>
                <span style={{ color:'#e8a838' }}>{i.current_stock.toLocaleString('es-CR')} {i.unit} · min: {i.min_stock} {i.unit}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Orden de compra sugerida */}
      {reorderBySupplier.length > 0 && (
        <>
          <div className="vt-sl">🛒 Orden de compra sugerida</div>
          <div style={{ fontSize:'0.68rem', color:'#5a5040', marginBottom:'0.75rem' }}>
            Ingredientes en o bajo el mínimo, agrupados por proveedor. Cantidad sugerida = llevar a 2× el mínimo.
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:'0.75rem', marginBottom:'1.5rem' }}>
            {reorderBySupplier.map(([supplier, { items, total }]) => (
              <div key={supplier} style={{ border:'1px solid var(--vt-border,#d4cfc4)', borderRadius:2, overflow:'hidden' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0.45rem 0.75rem', background:'var(--vt-ink)', borderBottom:'1px solid #222' }}>
                  <span style={{ fontSize:'0.78rem', fontWeight:700, color:'var(--vt-gold)', letterSpacing:'0.06em' }}>{supplier}</span>
                  <div style={{ display:'flex', alignItems:'center', gap:'0.75rem' }}>
                    <span style={{ fontSize:'0.72rem', color:'#bbb' }}>{total > 0 ? `~${fi(total)}` : `${items.length} ítems`}</span>
                    <button onClick={() => copyOrder(supplier, items)}
                      style={{ fontSize:'0.66rem', padding:'2px 9px', borderRadius:2, border:'1px solid #3a3a3a', background:'transparent', color:'#bbb', cursor:'pointer' }}>
                      {copied === supplier ? '✓ Copiado' : '⎘ Copiar pedido'}
                    </button>
                  </div>
                </div>
                <div className="vt-tbl-wrap" style={{ marginTop:0 }}>
                  <table className="vt-tbl">
                    <tbody>
                      {items.map(({ ing, qty, cost }) => (
                        <tr key={ing.id}>
                          <td style={{ fontSize:'0.82rem', fontWeight:500 }}>
                            {ing.current_stock <= 0 ? '🔴 ' : '🟡 '}{ing.name}
                          </td>
                          <td className="r" style={{ fontSize:'0.75rem', color:'#5a5040' }}>
                            actual {ing.current_stock.toLocaleString('es-CR')} / min {ing.min_stock.toLocaleString('es-CR')} {ing.unit}
                          </td>
                          <td className="r" style={{ fontSize:'0.82rem', fontWeight:700, color:'var(--vt-green)' }}>
                            +{qty.toLocaleString('es-CR')} {ing.unit}
                          </td>
                          <td className="r" style={{ fontSize:'0.75rem', color:'#5a5040' }}>
                            {cost > 0 ? fi(cost) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Stock por categoría */}
      <div className="vt-sl">Stock por categoría</div>
      {Object.entries(byCategory).sort(([a],[b]) => a.localeCompare(b)).map(([cat, items]) => {
        const catValue = items.reduce((s, i) => s + i.current_stock * i.cost_per_unit, 0)
        return (
          <div key={cat} style={{ marginBottom:'1rem' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0.45rem 0.75rem', background:'var(--vt-ink)', borderRadius:'2px 2px 0 0', borderBottom:'1px solid #222' }}>
              <span style={{ fontSize:'0.75rem', fontWeight:700, color:'var(--vt-gold)', letterSpacing:'0.1em', textTransform:'uppercase' }}>{cat}</span>
              <span style={{ fontSize:'0.72rem', color:'#666' }}>{items.length} items · {fi(catValue)}</span>
            </div>
            <div className="vt-tbl-wrap" style={{ marginTop:0 }}>
              <table className="vt-tbl">
                <tbody>
                  {items.map(ing => {
                    const col   = stockColor(ing)
                    const label = stockLabel(ing)
                    const val   = ing.current_stock * ing.cost_per_unit
                    const pct   = ing.min_stock > 0 ? Math.min(ing.current_stock / (ing.min_stock * 2) * 100, 100) : 100
                    return (
                      <tr key={ing.id}>
                        <td style={{ fontSize:'0.82rem', fontWeight:500, minWidth:160 }}>{ing.name}</td>
                        <td>
                          <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', minWidth:160 }}>
                            <div style={{ flex:1, height:4, background:'#1a1a1a', borderRadius:2, overflow:'hidden' }}>
                              <div style={{ height:'100%', width:`${pct}%`, background:col, borderRadius:2, transition:'width .3s' }}/>
                            </div>
                            <span style={{ fontSize:'0.78rem', color:col, fontWeight:700, whiteSpace:'nowrap' }}>
                              {ing.current_stock.toLocaleString('es-CR')} {ing.unit}
                            </span>
                          </div>
                        </td>
                        <td style={{ fontSize:'0.68rem', color:col, whiteSpace:'nowrap' }}>{label}</td>
                        <td className="r" style={{ fontSize:'0.75rem', color:'#666' }}>
                          {ing.cost_per_unit > 0 ? fi(val) : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}

      {/* Recent movements */}
      {recentMovs.length > 0 && (
        <>
          <div className="vt-sl" style={{ marginTop:'1rem' }}>Últimos movimientos</div>
          <div className="vt-tbl-wrap">
            <table className="vt-tbl">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Ingrediente</th>
                  <th>Tipo</th>
                  <th className="r">Cantidad</th>
                  <th>Notas</th>
                </tr>
              </thead>
              <tbody>
                {recentMovs.map(m => {
                  const d    = new Date(m.created_at)
                  const isIn = m.qty_delta > 0
                  return (
                    <tr key={m.id}>
                      <td style={{ fontSize:'0.75rem', color:'#888', whiteSpace:'nowrap' }}>
                        {d.toLocaleDateString('es-CR', { day:'2-digit', month:'short' })} {d.toLocaleTimeString('es-CR', { hour:'2-digit', minute:'2-digit' })}
                      </td>
                      <td style={{ fontSize:'0.82rem' }}>{(m.ingredient as { name?: string })?.name ?? '—'}</td>
                      <td style={{ fontSize:'0.72rem', color:'#888' }}>
                        {m.movement_type === 'purchase' ? '📦 Compra' :
                         m.movement_type === 'waste' ? '🗑 Merma' :
                         m.movement_type === 'count_adjustment' ? '📋 Ajuste' :
                         m.movement_type === 'sale_deduction' ? '🍽 Venta' : '↔ Transfer'}
                      </td>
                      <td className="r" style={{ color: isIn ? '#4a9a6a' : '#c23b22', fontWeight:700 }}>
                        {isIn ? '+' : ''}{m.qty_delta.toLocaleString('es-CR')} {m.unit}
                      </td>
                      <td style={{ fontSize:'0.72rem', color:'#666', maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {m.notes || '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
