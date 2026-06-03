/**
 * InvConsumo — Motor de consumo por ventas (Fase 1.3)
 *
 * Toma las ventas de un día → calcula el gasto teórico de ingredientes por receta
 * → previsualiza la deducción → registra movimientos `sale_deduction` (baja stock).
 * Idempotente por fecha (reference_id = 'sale:YYYY-MM-DD').
 */
import { useState } from 'react'
import type { Ingredient, Recipe, RecipeIngredient } from '../../shared/types/inventario'
import type { Profile } from '../../shared/types/database'
import {
  getRecipes, getAllRecipeIngredients, countDeductionsForRef, addMovement,
} from '../../shared/api/inventario'
import { supabase } from '../../shared/api/supabase'
import { todayCR } from '../../shared/utils'
import { computeDepletion, unitsFromDiaData, type DepletionResult } from './depletion'

interface Props {
  ingredients: Ingredient[]
  onRefresh:   () => void
  profile:     Profile | null
}

function n3(n: number) { return n.toLocaleString('es-CR', { maximumFractionDigits: 3 }) }

export default function InvConsumo({ ingredients, onRefresh, profile }: Props) {
  const [date, setDate]       = useState(todayCR())
  const [loading, setLoading] = useState(false)
  const [processing, setProc] = useState(false)
  const [result, setResult]   = useState<DepletionResult | null>(null)
  const [alreadyDone, setDone]= useState(false)
  const [msg, setMsg]         = useState<string | null>(null)
  const [error, setError]     = useState<string | null>(null)

  const ref = `sale:${date}`

  async function calcular() {
    setLoading(true); setError(null); setMsg(null); setResult(null)
    try {
      // ¿Ya se procesó esta fecha?
      const done = await countDeductionsForRef(ref)
      setDone(done > 0)

      // Ventas del día
      const { data: dia, error: dErr } = await supabase
        .from('ventas_dias' as never)
        .select('data')
        .eq('session_date', date)
        .maybeSingle()
      if (dErr) throw new Error(dErr.message)
      if (!dia) { setError(`No hay ventas cargadas para ${date}`); return }

      const units = unitsFromDiaData((dia as { data: Parameters<typeof unitsFromDiaData>[0] }).data)

      // Recetas + ingredientes
      const [recipes, allRis] = await Promise.all([getRecipes(), getAllRecipeIngredients()])
      const riByRecipe: Record<string, RecipeIngredient[]> = {}
      for (const ri of allRis) (riByRecipe[ri.recipe_id] ??= []).push(ri)

      const res = computeDepletion(units, recipes as Recipe[], riByRecipe, ingredients)
      setResult(res)
      if (res.lines.length === 0) setMsg('Ningún producto vendido tiene receta con ingredientes — nada que descontar.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error calculando consumo')
    } finally {
      setLoading(false)
    }
  }

  async function procesar() {
    if (!result || !result.lines.length) return
    if (!window.confirm(`¿Registrar el consumo de ${date}?\n\n${result.lines.length} ingredientes bajarán de stock. Esta acción queda registrada como movimientos.`)) return
    setProc(true); setError(null)
    try {
      for (const l of result.lines) {
        if (l.deduct <= 0) continue
        await addMovement({
          ingredient_id: l.ingredientId,
          movement_type: 'sale_deduction',
          qty_delta:     -l.deduct,
          unit:          l.unit,
          unit_cost:     null,
          reference_id:  ref,
          notes:         `Consumo por ventas ${date}`,
          created_by:    profile?.id ?? '',
        })
      }
      setMsg(`✓ Consumo de ${date} registrado — ${result.lines.length} ingredientes actualizados`)
      setDone(true)
      setResult(null)
      onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error registrando consumo')
    } finally {
      setProc(false)
    }
  }

  const totalShort = result?.lines.filter(l => l.after < 0).length ?? 0
  const mismatch   = result?.lines.filter(l => l.unitMismatch).length ?? 0

  return (
    <div className="vt-section">
      {error && <div style={{ color:'#c23b22', fontSize:'0.78rem', marginBottom:'0.5rem' }}>{error}</div>}

      {/* Controles */}
      <div style={{ display:'flex', gap:'0.6rem', flexWrap:'wrap', alignItems:'center', marginBottom:'1rem' }}>
        <div className="vt-sl" style={{ margin:0 }}>🍽 Consumo por ventas</div>
        <input type="date" value={date} max={todayCR()}
          onChange={e => { setDate(e.target.value); setResult(null); setMsg(null) }}
          style={{ background:'var(--vt-ink)', color:'var(--vt-paper)', border:'1px solid #2a2a2a', padding:'5px 10px', fontSize:'0.82rem', borderRadius:2 }} />
        <button onClick={calcular} disabled={loading}
          style={{ fontSize:'0.8rem', padding:'5px 14px', borderRadius:2, border:'1px solid var(--vt-gold)', background:'transparent', color:'var(--vt-gold)', cursor: loading ? 'default' : 'pointer', fontWeight:700 }}>
          {loading ? '⟳ Calculando…' : 'Calcular consumo'}
        </button>
        {result && result.lines.length > 0 && (
          <button onClick={procesar} disabled={processing}
            style={{ fontSize:'0.8rem', padding:'5px 14px', borderRadius:2, border:'none', background: processing ? '#1a1a1a' : 'var(--vt-green)', color: processing ? '#666' : '#0a0a0a', cursor: processing ? 'default' : 'pointer', fontWeight:800 }}>
            {processing ? '⟳ Registrando…' : `⬇ Procesar y bajar stock (${result.lines.length})`}
          </button>
        )}
      </div>

      {alreadyDone && (
        <div style={{ fontSize:'0.78rem', color:'#c8a030', background:'rgba(200,160,48,.08)', border:'1px solid rgba(200,160,48,.3)', borderRadius:2, padding:'0.5rem 0.75rem', marginBottom:'0.75rem' }}>
          ⚠ Esta fecha ya tiene consumo registrado. Procesar de nuevo descontará el stock por duplicado.
        </div>
      )}
      {msg && <div style={{ fontSize:'0.82rem', color:'var(--vt-green)', fontWeight:600, marginBottom:'0.75rem' }}>{msg}</div>}

      {/* Resumen */}
      {result && (
        <>
          <div style={{ display:'flex', gap:'1.5rem', flexWrap:'wrap', fontSize:'0.8rem', color:'#5a5040', marginBottom:'0.75rem' }}>
            <span><strong style={{ color:'var(--vt-ink,#0d0d0d)' }}>{result.productsMatched}</strong> productos con receta</span>
            <span><strong style={{ color:'var(--vt-ink,#0d0d0d)' }}>{n3(result.unitsConsidered)}</strong> unidades consideradas</span>
            <span><strong style={{ color:'var(--vt-ink,#0d0d0d)' }}>{result.lines.length}</strong> ingredientes afectados</span>
            {totalShort > 0 && <span style={{ color:'#c23b22' }}>⚠ {totalShort} quedarían en negativo</span>}
            {mismatch > 0 && <span style={{ color:'#c8a030' }}>⚠ {mismatch} con unidad distinta</span>}
          </div>

          {result.lines.length > 0 && (
            <div className="vt-tbl-wrap">
              <table className="vt-tbl">
                <thead>
                  <tr>
                    <th>Ingrediente</th>
                    <th className="r">A descontar</th>
                    <th className="r">Stock actual</th>
                    <th className="r">Stock resultante</th>
                  </tr>
                </thead>
                <tbody>
                  {result.lines.map(l => (
                    <tr key={l.ingredientId}>
                      <td style={{ fontSize:'0.82rem' }}>
                        {l.name}
                        {l.unitMismatch && <span title="Unidad de receta distinta a la del ingrediente" style={{ color:'#c8a030', marginLeft:5, fontSize:'0.7rem' }}>⚠ unidad</span>}
                      </td>
                      <td className="r" style={{ color:'#c23b22', fontWeight:700 }}>−{n3(l.deduct)} {l.unit}</td>
                      <td className="r" style={{ color:'#888' }}>{n3(l.current)} {l.unit}</td>
                      <td className="r" style={{ color: l.after < 0 ? '#c23b22' : l.after === 0 ? '#c8a030' : '#4a9a6a', fontWeight:600 }}>
                        {n3(l.after)} {l.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Vendidos sin receta */}
          {result.noRecipe.length > 0 && (
            <div style={{ marginTop:'1rem' }}>
              <div className="vt-sl" style={{ fontSize:'0.7rem' }}>Vendidos sin receta (no descuentan)</div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:'0.4rem' }}>
                {result.noRecipe.map(p => (
                  <span key={p.nombre} style={{ fontSize:'0.72rem', color:'#888', background:'var(--vt-ink)', border:'1px solid #222', borderRadius:2, padding:'2px 8px' }}>
                    {p.nombre} <span style={{ color:'#555' }}>×{n3(p.units)}</span>
                  </span>
                ))}
              </div>
              <div style={{ fontSize:'0.68rem', color:'#555', marginTop:'0.4rem' }}>
                Cargá recetas para estos productos en la pestaña Recetas para incluirlos en el consumo.
              </div>
            </div>
          )}
        </>
      )}

      {!result && !loading && (
        <div style={{ fontSize:'0.8rem', color:'#666', padding:'1.5rem 0' }}>
          Elegí una fecha con ventas cargadas y "Calcular consumo" para ver el gasto de ingredientes según las recetas.
        </div>
      )}
    </div>
  )
}
