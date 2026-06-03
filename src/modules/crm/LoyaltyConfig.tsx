/**
 * LoyaltyConfig — Reglas de puntos + catálogo de recompensas (Fase 2.2, solo gerencia)
 */
import { useState, useEffect } from 'react'
import {
  getLoyaltyRules, saveLoyaltyRules, getRewards, upsertReward, deleteReward,
} from '../../shared/api/crm'
import type { LoyaltyRules, LoyaltyReward } from '../../shared/types/crm'
import { DEFAULT_RULES, REWARD_CATEGORIES } from '../../shared/types/crm'

const selStyle: React.CSSProperties = { background: 'var(--t-ink,#111)', border: '1px solid #2a2a2a', color: '#f0ece4', padding: '5px 8px', borderRadius: 2, fontSize: '0.82rem' }

const RULE_FIELDS: Array<{ key: keyof LoyaltyRules; label: string; hint: string }> = [
  { key: 'points_per_1000',         label: 'Puntos por ₡1.000',        hint: 'acumulación base por gasto' },
  { key: 'bonus_first_visit_month', label: 'Bonus 1ª visita del mes',  hint: 'puntos extra' },
  { key: 'bonus_birthday',          label: 'Bonus cumpleaños',         hint: 'en el mes de cumple' },
  { key: 'bonus_referral',          label: 'Bonus referido',           hint: 'por traer un cliente' },
  { key: 'tier_regular_visits',     label: 'Regular: visitas',         hint: 'umbral de tier' },
  { key: 'tier_regular_spent',      label: 'Regular: gasto ₡',         hint: 'umbral de tier' },
  { key: 'tier_vip_visits',         label: 'VIP: visitas',             hint: 'umbral de tier' },
  { key: 'tier_vip_spent',          label: 'VIP: gasto ₡',             hint: 'umbral de tier' },
]

export default function LoyaltyConfig() {
  const [rules, setRules]     = useState<LoyaltyRules>(DEFAULT_RULES)
  const [rewards, setRewards] = useState<LoyaltyReward[]>([])
  const [loading, setLoading] = useState(true)
  const [savingRules, setSavingRules] = useState(false)
  const [msg, setMsg]         = useState<string | null>(null)
  const [error, setError]     = useState<string | null>(null)

  // Nueva recompensa
  const [rName, setRName] = useState('')
  const [rDesc, setRDesc] = useState('')
  const [rCost, setRCost] = useState('')
  const [rCat,  setRCat]  = useState<string>('cortesia')

  async function load() {
    setLoading(true); setError(null)
    try {
      const [r, rw] = await Promise.all([getLoyaltyRules(), getRewards(false)])
      setRules(r); setRewards(rw)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  async function handleSaveRules() {
    setSavingRules(true); setError(null); setMsg(null)
    try {
      await saveLoyaltyRules(rules)
      setMsg('✓ Reglas guardadas')
      setTimeout(() => setMsg(null), 3000)
    } catch (e) { setError(e instanceof Error ? e.message : 'Error') }
    finally { setSavingRules(false) }
  }

  async function handleAddReward() {
    if (!rName.trim() || !rCost) { setError('Nombre y costo en puntos son obligatorios'); return }
    setError(null)
    try {
      await upsertReward({ name: rName.trim(), description: rDesc || null, points_cost: Number(rCost), category: rCat, active: true })
      setRName(''); setRDesc(''); setRCost(''); setRCat('cortesia')
      load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Error') }
  }

  async function toggleReward(r: LoyaltyReward) {
    try { await upsertReward({ id: r.id, name: r.name, points_cost: r.points_cost, active: !r.active }); load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Error') }
  }
  async function removeReward(r: LoyaltyReward) {
    if (!window.confirm(`¿Eliminar "${r.name}"?`)) return
    try { await deleteReward(r.id); load() } catch (e) { setError(e instanceof Error ? e.message : 'Error') }
  }

  if (loading) return <div style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>Cargando…</div>

  return (
    <div className="tips-body" style={{ display: 'grid', gridTemplateColumns: 'minmax(280px,1fr) minmax(280px,1fr)', gap: '1.5rem', alignItems: 'start' }}>
      {error && <div className="tips-error" style={{ gridColumn: '1/-1' }}><span>{error}</span><button onClick={() => setError(null)}>✕</button></div>}

      {/* Reglas */}
      <div style={{ border: '1px solid var(--t-border,#d4cfc4)', borderRadius: 4, padding: '1rem', background: '#faf7f0' }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#a07830', marginBottom: '0.875rem' }}>⚙ Reglas de puntos</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
          {RULE_FIELDS.map(f => (
            <div key={f.key}>
              <div style={{ fontSize: '0.62rem', color: '#777', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{f.label}</div>
              <input type="number" value={rules[f.key]}
                onChange={e => setRules(p => ({ ...p, [f.key]: Number(e.target.value) }))}
                style={{ ...selStyle, width: '100%', boxSizing: 'border-box' }} />
              <div style={{ fontSize: '0.58rem', color: '#555', marginTop: 1 }}>{f.hint}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.875rem' }}>
          <button onClick={handleSaveRules} disabled={savingRules}
            style={{ padding: '6px 16px', borderRadius: 2, background: 'var(--t-teal,#2a7a6a)', color: '#fff', border: 'none', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer' }}>
            {savingRules ? '⟳ Guardando…' : '✓ Guardar reglas'}
          </button>
          {msg && <span style={{ color: '#2a7a6a', fontSize: '0.8rem', fontWeight: 600 }}>{msg}</span>}
        </div>
      </div>

      {/* Recompensas */}
      <div style={{ border: '1px solid var(--t-border,#d4cfc4)', borderRadius: 4, padding: '1rem', background: '#faf7f0' }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#a07830', marginBottom: '0.875rem' }}>🎁 Catálogo de recompensas</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', marginBottom: '1rem' }}>
          {rewards.length === 0 && <div style={{ color: '#666', fontSize: '0.8rem' }}>Sin recompensas. Agregá la primera abajo.</div>}
          {rewards.map(r => (
            <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.45rem 0.6rem', borderRadius: 2, background: 'rgba(0,0,0,0.04)', border: '1px solid var(--t-border,#d4cfc4)', opacity: r.active ? 1 : 0.5 }}>
              <div>
                <span style={{ fontWeight: 600, fontSize: '0.84rem' }}>{r.name}</span>
                <span style={{ fontSize: '0.66rem', color: '#777', marginLeft: 6, textTransform: 'uppercase' }}>{r.category}</span>
                {r.description && <div style={{ fontSize: '0.72rem', color: '#888' }}>{r.description}</div>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', whiteSpace: 'nowrap' }}>
                <span style={{ color: '#a07830', fontWeight: 700, fontSize: '0.84rem' }}>{r.points_cost} pts</span>
                <button onClick={() => toggleReward(r)} title={r.active ? 'Desactivar' : 'Activar'}
                  style={{ background: 'none', border: '1px solid var(--t-border,#d4cfc4)', color: r.active ? '#2a7a6a' : '#8a8170', borderRadius: 2, padding: '2px 8px', fontSize: '0.66rem', cursor: 'pointer' }}>
                  {r.active ? 'activa' : 'inactiva'}
                </button>
                <button onClick={() => removeReward(r)} style={{ background: 'none', border: '1px solid #3a1a1a', color: '#c0392b', borderRadius: 2, padding: '2px 7px', fontSize: '0.66rem', cursor: 'pointer' }}>✕</button>
              </div>
            </div>
          ))}
        </div>

        {/* Nueva recompensa */}
        <div style={{ borderTop: '1px solid #1a1a1a', paddingTop: '0.75rem' }}>
          <div style={{ fontSize: '0.62rem', color: '#777', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>Nueva recompensa</div>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
            <input value={rName} onChange={e => setRName(e.target.value)} placeholder="Nombre" style={{ ...selStyle, flex: '2 1 140px' }} />
            <input type="number" value={rCost} onChange={e => setRCost(e.target.value)} placeholder="Puntos" style={{ ...selStyle, width: 80 }} />
            <select value={rCat} onChange={e => setRCat(e.target.value)} style={selStyle}>
              {REWARD_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <input value={rDesc} onChange={e => setRDesc(e.target.value)} placeholder="Descripción (opcional)" style={{ ...selStyle, flex: 1 }} />
            <button onClick={handleAddReward}
              style={{ padding: '5px 14px', borderRadius: 2, background: 'var(--t-teal,#2a7a6a)', color: '#fff', border: 'none', fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              + Agregar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
