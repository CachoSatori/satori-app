/**
 * InvMovimientos — Log stock movements (purchase, waste, count) + history
 */
import { useState } from 'react'
import type { Ingredient, InventoryMovement } from '../../shared/types/inventario'
import { MOVEMENT_LABELS } from '../../shared/types/inventario'
import { addMovement, setStockLevel } from '../../shared/api/inventario'
import { getOpenCashSession, createCashMovement } from '../../shared/api/cash'

interface Props {
  ingredients: Ingredient[]
  movements:   InventoryMovement[]
  onRefresh:   () => void
  profile:     { id: string; role: string; full_name?: string } | null
}

const MOV_TYPES: Array<{ value: InventoryMovement['movement_type']; label: string; delta: 1|-1 }> = [
  { value:'purchase',         label:'📦 Compra (entrada)',         delta:  1 },
  { value:'waste',            label:'🗑 Merma / Desperdicio',       delta: -1 },
  { value:'count_adjustment', label:'📋 Ajuste de conteo físico',   delta:  1 },
  { value:'sale_deduction',   label:'🍽 Deducción por venta',       delta: -1 },
  { value:'transfer',         label:'↔ Transferencia',              delta:  1 },
]

export default function InvMovimientos({ ingredients, movements, onRefresh, profile }: Props) {
  const [ingId,    setIngId]    = useState('')
  const [movType,  setMovType]  = useState<InventoryMovement['movement_type']>('purchase')
  const [qty,      setQty]      = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [notes,    setNotes]    = useState('')
  const [newStock, setNewStock] = useState('')   // for count_adjustment absolute mode
  const [linkCaja, setLinkCaja] = useState(true)  // purchase → registrar egreso en Caja
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [success,  setSuccess]  = useState<string | null>(null)
  const [filter,   setFilter]   = useState('')

  const selectedIng   = ingredients.find(i => i.id === ingId)
  const isCountAdj    = movType === 'count_adjustment'
  const isPurchase    = movType === 'purchase'
  const deltaSign     = MOV_TYPES.find(t => t.value === movType)?.delta ?? 1

  async function handleSubmit() {
    if (!ingId)   { setError('Elegí un ingrediente'); return }
    if (isCountAdj) {
      if (!newStock) { setError('Ingresá el nuevo nivel de stock'); return }
      const ns = parseFloat(newStock)
      if (isNaN(ns) || ns < 0) { setError('Nivel de stock inválido'); return }
      setSaving(true); setError(null)
      try {
        await setStockLevel(ingId, ns, selectedIng!.current_stock, selectedIng!.unit, profile?.full_name ?? '')
        setSuccess(`✓ Stock de ${selectedIng!.name} ajustado a ${ns} ${selectedIng!.unit}`)
        setNewStock(''); setNotes('')
        setTimeout(() => setSuccess(null), 4000)
        onRefresh()
      } catch(e) { setError(e instanceof Error ? e.message : 'Error') }
      finally { setSaving(false) }
      return
    }
    if (!qty || isNaN(parseFloat(qty)) || parseFloat(qty) <= 0) { setError('Ingresá una cantidad válida'); return }
    setSaving(true); setError(null)
    try {
      const q = parseFloat(qty)
      await addMovement({
        ingredient_id: ingId,
        movement_type: movType,
        qty_delta:     q * deltaSign,
        unit:          selectedIng?.unit ?? 'unidad',
        unit_cost:     isPurchase && unitCost ? parseFloat(unitCost) : null,
        reference_id:  new Date().toISOString().slice(0, 10),
        notes,
        created_by:    profile?.full_name ?? '',
      })

      // ── Integración Compra → Caja ──────────────────────────────
      // Si es compra con costo y el usuario lo pidió, registrar el egreso_mercaderia
      // en el turno de caja abierto (mismo patrón que Propinas→Caja).
      let cajaMsg = ''
      const purchaseValue = isPurchase && unitCost ? Math.round(q * parseFloat(unitCost)) : 0
      if (isPurchase && linkCaja && purchaseValue > 0) {
        try {
          const cashSession = await getOpenCashSession()
          if (cashSession) {
            await createCashMovement({
              session_id:    cashSession.id,
              created_by:    profile?.id ?? '',
              movement_type: 'egreso_mercaderia',
              amount_crc:    purchaseValue,
              amount_usd:    0,
              currency:      'CRC',
              exchange_rate: null,
              description:   `Compra ${selectedIng?.name ?? ''} (${q} ${selectedIng?.unit ?? ''})`.trim(),
              subcategory:   'Proveedor mercadería',
              supplier_name: selectedIng?.supplier ?? '',
              method:        'Efectivo',
              caja_origen:   'Caja Proveedores',
            })
            cajaMsg = ` · egreso de ₡${purchaseValue.toLocaleString('es-CR')} registrado en Caja`
          } else {
            cajaMsg = ' · ⚠ sin turno de caja abierto: no se registró el egreso'
          }
        } catch { cajaMsg = ' · ⚠ no se pudo registrar el egreso en Caja' }
      }

      setSuccess(`✓ ${MOVEMENT_LABELS[movType]} registrado: ${q} ${selectedIng?.unit}${cajaMsg}`)
      setQty(''); setUnitCost(''); setNotes('')
      setTimeout(() => setSuccess(null), 5000)
      onRefresh()
    } catch(e) { setError(e instanceof Error ? e.message : 'Error') }
    finally { setSaving(false) }
  }

  const filtered = movements.filter(m => {
    if (!filter) return true
    const ing = ingredients.find(i => i.id === m.ingredient_id)
    return ing?.name.toLowerCase().includes(filter.toLowerCase()) ?? false
  })

  return (
    <div className="vt-section">

      {/* Form */}
      <div style={{ background:'var(--vt-ink)', borderRadius:2, padding:'1rem', marginBottom:'1.5rem' }}>
        <div style={{ fontSize:'0.75rem', letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--vt-gold)', marginBottom:'0.875rem', fontWeight:700 }}>
          Registrar movimiento
        </div>

        {error   && <div style={{ color:'#c23b22', fontSize:'0.78rem', marginBottom:'0.5rem' }}>{error}</div>}
        {success && <div style={{ color:'#4a9a6a', fontSize:'0.78rem', marginBottom:'0.5rem' }}>{success}</div>}

        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))', gap:'0.625rem', marginBottom:'0.75rem' }}>
          {/* Ingredient */}
          <div>
            <div style={{ fontSize:'0.65rem', color:'#555', marginBottom:3, textTransform:'uppercase', letterSpacing:'0.08em' }}>Ingrediente *</div>
            <select className="cd-tbl-select" value={ingId} onChange={e => setIngId(e.target.value)}>
              <option value="">— elegir —</option>
              {ingredients.map(i => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.current_stock.toLocaleString('es-CR')} {i.unit})
                </option>
              ))}
            </select>
          </div>

          {/* Movement type */}
          <div>
            <div style={{ fontSize:'0.65rem', color:'#555', marginBottom:3, textTransform:'uppercase', letterSpacing:'0.08em' }}>Tipo</div>
            <select className="cd-tbl-select" value={movType}
              onChange={e => setMovType(e.target.value as InventoryMovement['movement_type'])}>
              {MOV_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          {/* Quantity OR new stock level */}
          {isCountAdj ? (
            <div>
              <div style={{ fontSize:'0.65rem', color:'#555', marginBottom:3, textTransform:'uppercase', letterSpacing:'0.08em' }}>
                Nuevo nivel de stock {selectedIng ? `(${selectedIng.unit})` : ''} *
              </div>
              <input className="cd-tbl-input" type="number" min="0" step="0.001"
                placeholder={selectedIng ? `Actual: ${selectedIng.current_stock}` : '0'}
                value={newStock} onChange={e => setNewStock(e.target.value)} />
            </div>
          ) : (
            <div>
              <div style={{ fontSize:'0.65rem', color:'#555', marginBottom:3, textTransform:'uppercase', letterSpacing:'0.08em' }}>
                Cantidad {selectedIng ? `(${selectedIng.unit})` : ''} *
              </div>
              <input className="cd-tbl-input" type="number" min="0.001" step="0.001"
                placeholder="0" value={qty} onChange={e => setQty(e.target.value)} />
            </div>
          )}

          {/* Cost (only for purchases) */}
          {isPurchase && (
            <div>
              <div style={{ fontSize:'0.65rem', color:'#555', marginBottom:3, textTransform:'uppercase', letterSpacing:'0.08em' }}>Costo unitario ₡</div>
              <input className="cd-tbl-input" type="number" min="0" step="1"
                placeholder="opcional" value={unitCost} onChange={e => setUnitCost(e.target.value)} />
            </div>
          )}

          {/* Notes */}
          <div>
            <div style={{ fontSize:'0.65rem', color:'#555', marginBottom:3, textTransform:'uppercase', letterSpacing:'0.08em' }}>Notas</div>
            <input className="cd-tbl-input" type="text" placeholder="opcional"
              value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </div>

        {/* Compra → Caja */}
        {isPurchase && (
          <label style={{ display:'flex', alignItems:'center', gap:'0.4rem', fontSize:'0.75rem', color:'#aaa', marginBottom:'0.625rem', cursor:'pointer' }}>
            <input type="checkbox" checked={linkCaja} onChange={e => setLinkCaja(e.target.checked)} />
            Registrar egreso en Caja (egreso_mercaderia)
            {unitCost && qty && (
              <span style={{ color:'#c8a96e', fontWeight:600 }}>
                · ₡{Math.round((parseFloat(qty)||0) * (parseFloat(unitCost)||0)).toLocaleString('es-CR')}
              </span>
            )}
            <span style={{ color:'#555', fontSize:'0.68rem' }}>(requiere turno de caja abierto)</span>
          </label>
        )}

        {/* Preview */}
        {selectedIng && (
          <div style={{ fontSize:'0.72rem', color:'#666', marginBottom:'0.625rem', padding:'0.4rem 0.625rem', background:'#111', borderRadius:2 }}>
            {isCountAdj ? (
              <span>
                {selectedIng.name}: {selectedIng.current_stock} {selectedIng.unit}
                {newStock ? ` → ${parseFloat(newStock) || 0} ${selectedIng.unit} (delta: ${((parseFloat(newStock)||0)-selectedIng.current_stock)>=0?'+':''}${((parseFloat(newStock)||0)-selectedIng.current_stock).toLocaleString('es-CR')})` : ''}
              </span>
            ) : (
              <span>
                {selectedIng.name}: {selectedIng.current_stock} {selectedIng.unit}
                {qty ? ` → ${(selectedIng.current_stock + parseFloat(qty)*deltaSign).toLocaleString('es-CR')} ${selectedIng.unit}` : ''}
              </span>
            )}
          </div>
        )}

        <button className="vt-range-btn"
          style={{ borderColor:'var(--vt-green)', color:'var(--vt-green)' }}
          disabled={saving} onClick={handleSubmit}>
          {saving ? '⟳ Guardando…' : '✓ Registrar movimiento'}
        </button>
      </div>

      {/* History */}
      <div style={{ display:'flex', gap:'0.5rem', alignItems:'center', marginBottom:'0.75rem' }}>
        <div className="vt-sl" style={{ margin:0 }}>Historial</div>
        <input type="text" placeholder="Filtrar por ingrediente…"
          value={filter} onChange={e => setFilter(e.target.value)}
          style={{ background:'var(--vt-ink)', color:'var(--vt-paper)', border:'1px solid #2a2a2a', padding:'4px 8px', fontSize:'0.75rem', borderRadius:2, width:180, marginLeft:'auto' }} />
      </div>

      <div className="vt-tbl-wrap">
        <table className="vt-tbl">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Ingrediente</th>
              <th>Tipo</th>
              <th className="r">Cantidad</th>
              <th className="r">Costo/u</th>
              <th>Notas</th>
              <th>Registrado por</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(m => {
              const ing  = ingredients.find(i => i.id === m.ingredient_id)
              const d    = new Date(m.created_at)
              const isIn = m.qty_delta > 0
              return (
                <tr key={m.id}>
                  <td style={{ fontSize:'0.72rem', color:'#888', whiteSpace:'nowrap' }}>
                    {d.toLocaleDateString('es-CR', { day:'2-digit', month:'short', year:'2-digit' })} {d.toLocaleTimeString('es-CR', { hour:'2-digit', minute:'2-digit' })}
                  </td>
                  <td style={{ fontWeight:500 }}>{ing?.name ?? (m.ingredient as {name?:string})?.name ?? '—'}</td>
                  <td style={{ fontSize:'0.72rem', color:'#888' }}>
                    {m.movement_type === 'purchase' ? '📦 Compra' :
                     m.movement_type === 'waste' ? '🗑 Merma' :
                     m.movement_type === 'count_adjustment' ? '📋 Ajuste' :
                     m.movement_type === 'sale_deduction' ? '🍽 Venta' : '↔ Transfer'}
                    {m.document_id && <span title="Generado desde factura escaneada" style={{ marginLeft: 6, fontSize: '0.58rem', fontWeight: 700, color: '#6a4a8a', background: '#efe6f8', padding: '1px 5px', borderRadius: 99 }}>📄 factura</span>}
                  </td>
                  <td className="r" style={{ color: isIn ? '#4a9a6a' : '#c23b22', fontWeight:700 }}>
                    {isIn ? '+' : ''}{m.qty_delta.toLocaleString('es-CR')} {m.unit}
                  </td>
                  <td className="r" style={{ fontSize:'0.75rem', color:'#666' }}>
                    {m.unit_cost ? `₡ ${m.unit_cost.toLocaleString('es-CR')}` : '—'}
                  </td>
                  <td style={{ fontSize:'0.72rem', color:'#666', maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {m.notes || '—'}
                  </td>
                  <td style={{ fontSize:'0.68rem', color:'#555' }}>{m.created_by || '—'}</td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign:'center', padding:'2rem', color:'#555' }}>Sin movimientos registrados</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
