/**
 * InvFoodCost — Food cost teórico vs real (Fase 1.3 / control de merma)
 *
 * Para un mes compara:
 *  - Ventas netas (ventas_dias)
 *  - COGS teórico = Σ deducción por venta × costo del ingrediente (lo que las recetas
 *    dicen que se debió consumir)
 *  - Compras reales de mercadería (cash_movements egreso_mercaderia — dato real de Caja)
 *  - Merma registrada (waste) y ajustes de conteo físico (shrinkage)
 * La diferencia entre compras y consumo teórico es la señal de merma/variación.
 */
import { useState, useEffect, useMemo } from 'react'
import type { Ingredient } from '../../shared/types/inventario'
import { supabase } from '../../shared/api/supabase'
import { todayCR } from '../../shared/utils'
import { monthRangeBounds } from '../../shared/utils/dateRange'

interface Props { ingredients: Ingredient[] }

const MN = ['','Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
function fi(n: number) { return '₡ ' + Math.round(n).toLocaleString('es-CR') }
function pctStr(a: number, b: number) { return b > 0 ? (a / b * 100).toFixed(1) + '%' : '—' }
function fmtMonth(ym: string) { const [y, m] = ym.split('-'); return `${MN[Number(m)]} ${y}` }

interface Calc {
  ventas:      number
  cogsTeorico: number
  compras:     number
  merma:       number
  ajustes:     number
  topConsumo:  Array<{ name: string; value: number }>
}

export default function InvFoodCost({ ingredients }: Props) {
  const now = todayCR()
  const [ym, setYm]         = useState(now.slice(0, 7))
  const [loading, setLoad]  = useState(false)
  const [calc, setCalc]     = useState<Calc | null>(null)
  const [error, setError]   = useState<string | null>(null)

  const costById = useMemo(() => new Map(ingredients.map(i => [i.id, { cost: i.cost_per_unit, name: i.name }])), [ingredients])

  // Meses recientes (18) para el selector
  const months = useMemo(() => {
    const [y, m] = now.slice(0, 7).split('-').map(Number)
    return Array.from({ length: 18 }, (_, i) => {
      const d = new Date(y, m - 1 - i, 1)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    })
  }, [now])

  useEffect(() => {
    let cancel = false
    async function run() {
      setLoad(true); setError(null)
      try {
        // Límite superior EXCLUSIVO = 1° del mes siguiente (no `${ym}-31`, inválido → 400).
        // Cubre los TRES usos: created_at (timestamptz) en inventory/cash y session_date (DATE) en ventas.
        const mb = monthRangeBounds(ym)
        const [movsRes, cashRes, diasRes] = await Promise.all([
          supabase.from('inventory_movements')
            .select('ingredient_id, movement_type, qty_delta, created_at')
            .gte('created_at', mb.startTs).lt('created_at', mb.endExclusiveTs),
          supabase.from('cash_movements')
            .select('amount_crc, movement_type, status, created_at')
            .eq('movement_type', 'egreso_mercaderia')
            .gte('created_at', mb.startTs).lt('created_at', mb.endExclusiveTs),
          supabase.from('ventas_dias')
            .select('data').gte('session_date', mb.start).lt('session_date', mb.endExclusive),
        ])
        if (cancel) return

        // COGS teórico + merma + ajustes desde movimientos de inventario
        let cogsTeorico = 0, merma = 0, ajustes = 0
        const consumo: Record<string, number> = {}
        for (const m of (movsRes.data ?? []) as Array<{ ingredient_id: string; movement_type: string; qty_delta: number }>) {
          const info = costById.get(m.ingredient_id)
          const cost = info?.cost ?? 0
          const val  = Math.abs(m.qty_delta) * cost
          if (m.movement_type === 'sale_deduction') {
            cogsTeorico += val
            consumo[m.ingredient_id] = (consumo[m.ingredient_id] ?? 0) + val
          } else if (m.movement_type === 'waste') {
            merma += val
          } else if (m.movement_type === 'count_adjustment') {
            ajustes += m.qty_delta * cost   // negativo = pérdida detectada en conteo
          }
        }

        // Compras reales de mercadería (Caja)
        const compras = ((cashRes.data ?? []) as Array<{ amount_crc: number; status: string }>)
          .filter(c => c.status !== 'rechazado')
          .reduce((s, c) => s + c.amount_crc, 0)

        // Ventas netas del mes
        let ventas = 0
        for (const row of (diasRes.data ?? []) as Array<{ data: { saloneros?: Record<string, { total?: number }> } }>) {
          for (const s of Object.values(row.data?.saloneros ?? {})) ventas += s.total ?? 0
        }

        const topConsumo = Object.entries(consumo)
          .map(([id, value]) => ({ name: costById.get(id)?.name ?? id, value }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 8)

        setCalc({ ventas, cogsTeorico, compras, merma, ajustes, topConsumo })
      } catch (e) {
        if (!cancel) setError(e instanceof Error ? e.message : 'Error')
      } finally {
        if (!cancel) setLoad(false)
      }
    }
    run()
    return () => { cancel = true }
  }, [ym, costById])

  const variacion = calc ? calc.compras - calc.cogsTeorico : 0

  return (
    <div className="vt-section">
      <div style={{ display:'flex', gap:'0.6rem', alignItems:'center', flexWrap:'wrap', marginBottom:'1rem' }}>
        <div className="vt-sl" style={{ margin:0 }}>💰 Food cost: teórico vs real</div>
        <select value={ym} onChange={e => setYm(e.target.value)}
          style={{ marginLeft:'auto', background:'var(--vt-ink)', color:'var(--vt-gold)', border:'1px solid #2a2a2a', padding:'5px 10px', fontSize:'0.82rem', borderRadius:2, fontWeight:600 }}>
          {months.map(m => <option key={m} value={m}>{fmtMonth(m)}</option>)}
        </select>
      </div>

      {error && <div style={{ color:'#c23b22', fontSize:'0.78rem', marginBottom:'0.5rem' }}>{error}</div>}
      {loading ? (
        <div style={{ padding:'2rem', textAlign:'center', color:'#888' }}>Calculando…</div>
      ) : calc && (
        <>
          <div className="vt-kpi-grid" style={{ marginBottom:'1.25rem' }}>
            <div className="vt-kpi">
              <div className="vt-kpi-label">Ventas netas</div>
              <div className="vt-kpi-val">{fi(calc.ventas)}</div>
            </div>
            <div className="vt-kpi" style={{ borderLeftColor:'#4a9a6a' }}>
              <div className="vt-kpi-label">COGS teórico (recetas)</div>
              <div className="vt-kpi-val" style={{ color:'#4a9a6a' }}>{fi(calc.cogsTeorico)}</div>
              <div className="vt-kpi-sub">Food cost teórico: {pctStr(calc.cogsTeorico, calc.ventas)}</div>
            </div>
            <div className="vt-kpi" style={{ borderLeftColor:'#c8a96e' }}>
              <div className="vt-kpi-label">Compras mercadería (Caja)</div>
              <div className="vt-kpi-val" style={{ color:'#c8a96e' }}>{fi(calc.compras)}</div>
              <div className="vt-kpi-sub">{pctStr(calc.compras, calc.ventas)} de ventas</div>
            </div>
            <div className="vt-kpi" style={{ borderLeftColor: variacion > 0 ? '#c23b22' : '#4a9a6a' }}>
              <div className="vt-kpi-label">Variación (compras − teórico)</div>
              <div className="vt-kpi-val" style={{ color: variacion > 0 ? '#c23b22' : '#4a9a6a' }}>
                {variacion >= 0 ? '+' : ''}{fi(variacion)}
              </div>
              <div className="vt-kpi-sub">merma / acopio / variación de stock</div>
            </div>
          </div>

          {/* Merma + ajustes */}
          <div style={{ display:'flex', gap:'1.5rem', flexWrap:'wrap', fontSize:'0.82rem', marginBottom:'1.25rem' }}>
            <span style={{ color:'#5a5040' }}>🗑 Merma registrada: <strong style={{ color:'#c23b22' }}>{fi(calc.merma)}</strong></span>
            <span style={{ color:'#5a5040' }}>📋 Ajustes de conteo: <strong style={{ color: calc.ajustes < 0 ? '#c23b22' : '#4a9a6a' }}>{calc.ajustes >= 0 ? '+' : ''}{fi(calc.ajustes)}</strong></span>
          </div>

          {/* Interpretación */}
          <div style={{ fontSize:'0.78rem', color:'#888', background:'var(--vt-ink)', border:'1px solid #222', borderRadius:2, padding:'0.75rem 1rem', marginBottom:'1.25rem', lineHeight:1.5 }}>
            {calc.cogsTeorico === 0
              ? 'Aún no hay consumo teórico registrado este mes. Procesá el consumo por ventas (pestaña Consumo) con recetas cargadas para ver el food cost teórico.'
              : variacion > calc.cogsTeorico * 0.15
                ? '⚠ Las compras superan al consumo teórico por un margen amplio: puede ser acopio (stock subiendo), merma no registrada o desvío. Cruzá con un conteo físico.'
                : '✓ Compras y consumo teórico están alineados. Diferencias chicas son normales por acopio y timing de compras.'}
          </div>

          {/* Top consumo teórico */}
          {calc.topConsumo.length > 0 && (
            <>
              <div className="vt-sl" style={{ fontSize:'0.7rem' }}>Top ingredientes por consumo teórico</div>
              <div className="vt-tbl-wrap">
                <table className="vt-tbl">
                  <thead><tr><th>Ingrediente</th><th className="r">Consumo teórico</th></tr></thead>
                  <tbody>
                    {calc.topConsumo.map(t => (
                      <tr key={t.name}>
                        <td style={{ fontSize:'0.82rem' }}>{t.name}</td>
                        <td className="r" style={{ color:'#4a9a6a', fontWeight:600 }}>{fi(t.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
