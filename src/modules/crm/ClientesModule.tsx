/**
 * ClientesModule — CRM / Base de clientes (Fase 2.1)
 *
 * - Búsqueda por teléfono o nombre
 * - Alta/edición rápida de cliente (teléfono = ID natural)
 * - Perfil con agregados (visitas, gasto, puntos, tier) + historial de interacciones
 * - Registrar interacción (visita/delivery/reserva/canje) que actualiza puntos y visitas
 *
 * Requiere la migración 004_customers.sql aplicada en Supabase.
 */
import { useState, useEffect, useMemo, useCallback, Suspense, lazy } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../shared/hooks/useAuth'
import {
  getCustomers, upsertCustomer, deactivateCustomer,
  getInteractions, addInteraction, getLoyaltyRules, getRewards,
} from '../../shared/api/crm'
import type { Customer, CustomerInteraction, CustomerTier, LoyaltyRules, LoyaltyReward } from '../../shared/types/crm'
import {
  TIER_LABELS, TIER_COLORS, INTERACTION_TYPES, INTERACTION_CHANNELS, suggestedTier,
  computeEarnedPoints, DEFAULT_RULES,
} from '../../shared/types/crm'
const LoyaltyConfig = lazy(() => import('./LoyaltyConfig'))
const CrmSegmentos  = lazy(() => import('./CrmSegmentos'))
const CrmMetricas   = lazy(() => import('./CrmMetricas'))

function fi(n: number) { return '₡ ' + Math.round(n).toLocaleString('es-CR') }
function fmtDate(s: string | null) {
  if (!s) return '—'
  const d = new Date(s)
  return d.toLocaleDateString('es-CR', { day: '2-digit', month: 'short', year: '2-digit' })
}

const EMPTY_FORM = { phone: '', name: '', email: '', birth_date: '', channel_origin: 'manual', notes: '', tier: 'nuevo' as CustomerTier }

export default function ClientesModule() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const canManage = ['owner', 'manager', 'cajero'].includes(profile?.role ?? '')

  const [view, setView]           = useState<'clientes' | 'segmentos' | 'metricas' | 'config'>('clientes')
  const [customers, setCustomers] = useState<Customer[]>([])
  const [rules, setRules]         = useState<LoyaltyRules>(DEFAULT_RULES)
  const [rewards, setRewards]     = useState<LoyaltyReward[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [needsMigration, setNeedsMigration] = useState(false)
  const [showRedeem, setShowRedeem] = useState(false)

  const [search, setSearch]       = useState('')
  const [selId, setSelId]         = useState<string | null>(null)
  const [editing, setEditing]     = useState(false)            // editing/creating
  const [form, setForm]           = useState({ ...EMPTY_FORM })
  const [saving, setSaving]       = useState(false)

  const [interactions, setInteractions] = useState<CustomerInteraction[]>([])
  const [loadingInter, setLoadingInter] = useState(false)

  // Interaction form
  const [showInter, setShowInter] = useState(false)
  const [iType, setIType]   = useState<string>('visita')
  const [iChan, setIChan]   = useState<string>('presencial')
  const [iAmount, setIAmount] = useState('')
  const [iEarned, setIEarned] = useState('')
  const [iSpent, setISpent]   = useState('')
  const [iNotes, setINotes]   = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [cs, rl, rw] = await Promise.all([
        getCustomers(),
        getLoyaltyRules().catch(() => DEFAULT_RULES),
        getRewards(true).catch(() => [] as LoyaltyReward[]),
      ])
      setCustomers(cs); setRules(rl); setRewards(rw)
      setNeedsMigration(false)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error'
      if (/relation|does not exist|customers/i.test(msg)) setNeedsMigration(true)
      else setError(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const selected = useMemo(() => customers.find(c => c.id === selId) ?? null, [customers, selId])

  // Cargar interacciones al seleccionar
  useEffect(() => {
    if (!selId) { setInteractions([]); return }
    setLoadingInter(true)
    getInteractions(selId).then(setInteractions).catch(() => {}).finally(() => setLoadingInter(false))
  }, [selId])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return customers
    return customers.filter(c =>
      c.phone.toLowerCase().includes(q) || (c.name ?? '').toLowerCase().includes(q))
  }, [customers, search])

  const stats = useMemo(() => {
    const byTier: Record<string, number> = {}
    for (const c of customers) byTier[c.tier] = (byTier[c.tier] ?? 0) + 1
    return { total: customers.length, byTier }
  }, [customers])

  function startNew() {
    setEditing(true); setSelId(null)
    setForm({ ...EMPTY_FORM, phone: search.replace(/[^\d+]/g, '') })
  }
  function startEdit(c: Customer) {
    setEditing(true)
    setForm({
      phone: c.phone, name: c.name ?? '', email: c.email ?? '', birth_date: c.birth_date ?? '',
      channel_origin: c.channel_origin, notes: c.notes ?? '', tier: c.tier,
    })
  }

  async function handleSave() {
    if (!form.phone.trim()) { setError('El teléfono es obligatorio'); return }
    setSaving(true); setError(null)
    try {
      const saved = await upsertCustomer({
        phone: form.phone, name: form.name || null, email: form.email || null,
        birth_date: form.birth_date || null, channel_origin: form.channel_origin,
        notes: form.notes || null, tier: form.tier,
      })
      await load()
      setSelId(saved.id); setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error guardando')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(c: Customer) {
    if (!window.confirm(`¿Desactivar a ${c.name || c.phone}? No se borra, queda inactivo.`)) return
    try { await deactivateCustomer(c.id); setSelId(null); await load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Error') }
  }

  // Default de puntos según las reglas configuradas (gasto + bonus de contexto)
  function onAmountChange(v: string) {
    setIAmount(v)
    const amt = Number(v) || 0
    if (!selected) return
    const now = new Date()
    const lastSeen = selected.last_seen ? new Date(selected.last_seen) : null
    const firstVisitThisMonth = !lastSeen || lastSeen.getMonth() !== now.getMonth() || lastSeen.getFullYear() !== now.getFullYear()
    const birthdayMonth = !!selected.birth_date && Number(selected.birth_date.slice(5, 7)) === now.getMonth() + 1
    setIEarned(String(computeEarnedPoints(amt, rules, { firstVisitThisMonth, birthdayMonth })))
  }

  // ── Canje de recompensa ──────────────────────────────────────
  async function redeem(reward: LoyaltyReward) {
    if (!selected) return
    if (selected.points < reward.points_cost) { setError('Puntos insuficientes'); return }
    if (!window.confirm(`Canjear "${reward.name}" por ${reward.points_cost} puntos?`)) return
    setSaving(true); setError(null)
    try {
      await addInteraction({
        customer_id:   selected.id,
        type:          'puntos_canje',
        channel:       'presencial',
        amount_crc:    0,
        points_earned: 0,
        points_spent:  reward.points_cost,
        reference_id:  reward.id,
        notes:         `Canje: ${reward.name}`,
        created_by:    profile?.id ?? null,
      }, selected)
      const [ints] = await Promise.all([getInteractions(selected.id), load()])
      setInteractions(ints)
      setShowRedeem(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setSaving(false)
    }
  }

  async function handleAddInteraction() {
    if (!selected) return
    setSaving(true); setError(null)
    try {
      await addInteraction({
        customer_id:   selected.id,
        type:          iType,
        channel:       iChan,
        amount_crc:    Number(iAmount) || 0,
        points_earned: Number(iEarned) || 0,
        points_spent:  Number(iSpent) || 0,
        reference_id:  null,
        notes:         iNotes || null,
        created_by:    profile?.id ?? null,
      }, selected)
      // refrescar
      const [ints] = await Promise.all([getInteractions(selected.id), load()])
      setInteractions(ints)
      setShowInter(false)
      setIAmount(''); setIEarned(''); setISpent(''); setINotes(''); setIType('visita'); setIChan('presencial')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setSaving(false)
    }
  }

  const sugTier = selected ? suggestedTier(selected.total_visits, selected.total_spent_crc, rules) : 'nuevo'
  const affordable = selected ? rewards.filter(r => r.active && r.points_cost <= selected.points) : []

  return (
    <div className="tips-module">
      {/* Header */}
      <div className="tips-header">
        <div className="tips-header-left">
          <span className="tips-kanji">客</span>
          <div>
            <h2 className="tips-title">Clientes</h2>
            <p className="tips-subtitle">CRM · Fidelización · Satori</p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          {canManage && (
            <div className="tips-tabs">
              <button className={`tips-tab ${view === 'clientes' ? 'active' : ''}`} onClick={() => setView('clientes')}>Clientes</button>
              <button className={`tips-tab ${view === 'segmentos' ? 'active' : ''}`} onClick={() => setView('segmentos')}>Segmentos</button>
              <button className={`tips-tab ${view === 'metricas' ? 'active' : ''}`} onClick={() => setView('metricas')}>Métricas</button>
              <button className={`tips-tab ${view === 'config' ? 'active' : ''}`} onClick={() => setView('config')}>Fidelización</button>
            </div>
          )}
          <button className="cash-back-btn" style={{ borderColor: '#333', color: '#888', whiteSpace: 'nowrap' }}
            onClick={() => navigate('/')}>← Inicio</button>
        </div>
      </div>

      {error && <div className="tips-error"><span>{error}</span><button onClick={() => setError(null)}>✕</button></div>}

      {view === 'config' && canManage && !needsMigration && (
        <Suspense fallback={<div style={{ padding: '3rem', textAlign: 'center', opacity: 0.4 }}>⏳</div>}>
          <LoyaltyConfig />
        </Suspense>
      )}

      {view === 'segmentos' && canManage && !needsMigration && !loading && (
        <Suspense fallback={<div style={{ padding: '3rem', textAlign: 'center', opacity: 0.4 }}>⏳</div>}>
          <CrmSegmentos customers={customers} />
        </Suspense>
      )}

      {view === 'metricas' && canManage && !needsMigration && !loading && (
        <Suspense fallback={<div style={{ padding: '3rem', textAlign: 'center', opacity: 0.4 }}>⏳</div>}>
          <CrmMetricas customers={customers} />
        </Suspense>
      )}

      {needsMigration ? (
        <div style={{ padding: '2rem', maxWidth: 620, margin: '2rem auto', textAlign: 'center', color: '#5a5040' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🗄</div>
          <div style={{ fontWeight: 700, color: 'var(--t-ink,#0d0d0d)', marginBottom: '0.5rem' }}>Falta aplicar la migración del CRM</div>
          <div style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>
            Las tablas de clientes todavía no existen. Aplicá <code>supabase/migrations/004_customers.sql</code> en
            Supabase (SQL Editor o <code>supabase db push</code>) y recargá esta pantalla.
          </div>
        </div>
      ) : loading ? (
        <div className="module-loading"><span className="loading-mark">客</span></div>
      ) : view === 'clientes' ? (
        <div className="tips-body">
          {/* KPIs */}
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <Kpi label="Clientes" val={String(stats.total)} />
            {(['nuevo', 'regular', 'vip', 'embajador'] as CustomerTier[]).map(t => (
              <Kpi key={t} label={TIER_LABELS[t]} val={String(stats.byTier[t] ?? 0)} color={TIER_COLORS[t]} />
            ))}
          </div>

          {/* Search + nuevo */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por teléfono o nombre…"
              style={{ flex: 1, minWidth: 200, background: '#111', border: '1px solid #2a2a2a', color: '#e8e2d8', padding: '8px 12px', borderRadius: 2, fontSize: '0.85rem' }} />
            {canManage && (
              <button onClick={startNew}
                style={{ padding: '8px 16px', borderRadius: 2, background: 'var(--t-teal, #2a7a6a)', color: '#fff', border: 'none', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer' }}>
                + Nuevo cliente
              </button>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 1fr) minmax(280px, 1.4fr)', gap: '1rem', alignItems: 'start' }}>
            {/* Lista */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', maxHeight: '60vh', overflowY: 'auto' }}>
              {filtered.length === 0 && (
                <div style={{ color: '#666', fontSize: '0.82rem', padding: '1rem', textAlign: 'center' }}>
                  {customers.length === 0 ? 'Sin clientes todavía. Creá el primero.' : 'Sin resultados.'}
                </div>
              )}
              {filtered.map(c => (
                <div key={c.id} onClick={() => { setSelId(c.id); setEditing(false) }}
                  style={{ padding: '0.6rem 0.75rem', borderRadius: 2, cursor: 'pointer', border: '1px solid', borderColor: selId === c.id ? TIER_COLORS[c.tier] : 'var(--t-border,#d4cfc4)', background: selId === c.id ? 'rgba(160,120,48,0.12)' : 'var(--t-paper)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{c.name || '(sin nombre)'}</span>
                    <span style={{ fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: TIER_COLORS[c.tier] }}>{TIER_LABELS[c.tier]}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: '#888', marginTop: 2 }}>
                    <span>{c.phone}</span>
                    <span>{c.points} pts · {c.total_visits} vis.</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Detalle / form */}
            <div>
              {editing ? (
                <CustomerForm form={form} setForm={setForm} onSave={handleSave} onCancel={() => setEditing(false)} saving={saving} />
              ) : selected ? (
                <div style={{ border: '1px solid var(--t-border,#d4cfc4)', borderRadius: 4, padding: '1rem', background: 'var(--t-paper)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                    <div>
                      <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>{selected.name || '(sin nombre)'}</div>
                      <div style={{ fontSize: '0.8rem', color: '#888' }}>{selected.phone}{selected.email ? ` · ${selected.email}` : ''}</div>
                    </div>
                    <span style={{ fontSize: '0.62rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: TIER_COLORS[selected.tier], border: `1px solid ${TIER_COLORS[selected.tier]}`, borderRadius: 10, padding: '2px 10px' }}>
                      {TIER_LABELS[selected.tier]}
                    </span>
                  </div>

                  {/* Agregados */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem', marginBottom: '0.75rem' }}>
                    <Mini label="Puntos" val={String(selected.points)} color="#a07830" />
                    <Mini label="Visitas" val={String(selected.total_visits)} />
                    <Mini label="Gastado" val={fi(selected.total_spent_crc)} color="#2a7a6a" />
                    <Mini label="Últ. visita" val={fmtDate(selected.last_seen)} />
                  </div>

                  {sugTier !== selected.tier && canManage && (
                    <div style={{ fontSize: '0.72rem', color: '#c8a030', marginBottom: '0.5rem' }}>
                      💡 Por actividad calificaría como <strong>{TIER_LABELS[sugTier]}</strong>.{' '}
                      <button onClick={async () => { await upsertCustomer({ phone: selected.phone, tier: sugTier }); load() }}
                        style={{ background: 'none', border: 'none', color: '#c8a030', textDecoration: 'underline', cursor: 'pointer', fontSize: '0.72rem' }}>
                        Actualizar tier
                      </button>
                    </div>
                  )}

                  {selected.notes && <div style={{ fontSize: '0.78rem', color: '#5a5040', background: 'rgba(0,0,0,0.04)', border: '1px solid var(--t-border,#d4cfc4)', borderRadius: 2, padding: '0.5rem 0.75rem', marginBottom: '0.75rem' }}>📝 {selected.notes}</div>}

                  {canManage && (
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                      <button onClick={() => setShowInter(s => !s)}
                        style={{ padding: '5px 12px', borderRadius: 2, background: 'var(--t-teal,#2a7a6a)', color: '#fff', border: 'none', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer' }}>
                        + Registrar interacción
                      </button>
                      <button onClick={() => setShowRedeem(s => !s)}
                        style={{ padding: '5px 12px', borderRadius: 2, background: 'transparent', color: '#a07830', border: '1px solid #a07830', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer' }}>
                        🎁 Canjear ({affordable.length})
                      </button>
                      <button onClick={() => startEdit(selected)}
                        style={{ padding: '5px 12px', borderRadius: 2, background: 'transparent', color: '#5a5040', border: '1px solid #2a2a2a', fontSize: '0.78rem', cursor: 'pointer' }}>
                        Editar
                      </button>
                      <button onClick={() => handleDelete(selected)}
                        style={{ padding: '5px 12px', borderRadius: 2, background: 'transparent', color: '#c0392b', border: '1px solid #3a1a1a', fontSize: '0.78rem', cursor: 'pointer' }}>
                        Desactivar
                      </button>
                    </div>
                  )}

                  {/* Form interacción */}
                  {showInter && (
                    <div style={{ border: '1px solid var(--t-border,#d4cfc4)', borderRadius: 2, padding: '0.75rem', marginBottom: '1rem', background: '#f0ece4' }}>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                        <Field label="Tipo">
                          <select value={iType} onChange={e => setIType(e.target.value)} style={selStyle}>
                            {INTERACTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </Field>
                        <Field label="Canal">
                          <select value={iChan} onChange={e => setIChan(e.target.value)} style={selStyle}>
                            {INTERACTION_CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </Field>
                        <Field label="Monto ₡">
                          <input type="number" value={iAmount} onChange={e => onAmountChange(e.target.value)} placeholder="0" style={{ ...selStyle, width: 90 }} />
                        </Field>
                        <Field label="Puntos +">
                          <input type="number" value={iEarned} onChange={e => setIEarned(e.target.value)} placeholder="0" style={{ ...selStyle, width: 70 }} />
                        </Field>
                        <Field label="Puntos −">
                          <input type="number" value={iSpent} onChange={e => setISpent(e.target.value)} placeholder="0" style={{ ...selStyle, width: 70 }} />
                        </Field>
                      </div>
                      <input value={iNotes} onChange={e => setINotes(e.target.value)} placeholder="Notas (opcional)"
                        style={{ width: '100%', boxSizing: 'border-box', ...selStyle, marginBottom: '0.5rem' }} />
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button onClick={handleAddInteraction} disabled={saving}
                          style={{ padding: '5px 14px', borderRadius: 2, background: 'var(--t-teal,#2a7a6a)', color: '#fff', border: 'none', fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer' }}>
                          {saving ? '⟳' : 'Guardar'}
                        </button>
                        <button onClick={() => setShowInter(false)} style={{ padding: '5px 14px', borderRadius: 2, background: 'transparent', color: '#888', border: '1px solid #2a2a2a', fontSize: '0.78rem', cursor: 'pointer' }}>Cancelar</button>
                      </div>
                    </div>
                  )}

                  {/* Panel de canje */}
                  {showRedeem && (
                    <div style={{ border: '1px solid var(--t-border,#d4cfc4)', borderRadius: 2, padding: '0.75rem', marginBottom: '1rem', background: '#f0ece4' }}>
                      <div style={{ fontSize: '0.7rem', color: '#a07830', fontWeight: 700, marginBottom: '0.5rem' }}>
                        🎁 Recompensas disponibles · saldo {selected.points} pts
                      </div>
                      {rewards.filter(r => r.active).length === 0 ? (
                        <div style={{ fontSize: '0.78rem', color: '#777' }}>No hay recompensas activas. Cargalas en la pestaña Fidelización.</div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                          {rewards.filter(r => r.active).map(r => {
                            const can = selected.points >= r.points_cost
                            return (
                              <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', opacity: can ? 1 : 0.45 }}>
                                <span>{r.name} <span style={{ color: '#666', fontSize: '0.7rem' }}>· {r.category}</span></span>
                                <button onClick={() => redeem(r)} disabled={!can || saving}
                                  style={{ padding: '3px 10px', borderRadius: 2, border: '1px solid #a07830', background: can ? 'rgba(200,169,110,0.12)' : 'transparent', color: '#a07830', fontSize: '0.72rem', fontWeight: 700, cursor: can ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap' }}>
                                  {r.points_cost} pts
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Historial */}
                  <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#666', marginBottom: '0.4rem' }}>Historial</div>
                  {loadingInter ? <div style={{ color: '#666', fontSize: '0.8rem' }}>Cargando…</div> : interactions.length === 0 ? (
                    <div style={{ color: '#555', fontSize: '0.8rem' }}>Sin interacciones registradas.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', maxHeight: '30vh', overflowY: 'auto' }}>
                      {interactions.map(it => (
                        <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.78rem', borderBottom: '1px solid #161616', padding: '0.35rem 0' }}>
                          <div>
                            <span style={{ fontWeight: 600 }}>{it.type}</span>
                            <span style={{ color: '#666', marginLeft: 6 }}>{it.channel} · {fmtDate(it.created_at)}</span>
                            {it.notes && <span style={{ color: '#777', marginLeft: 6 }}>· {it.notes}</span>}
                          </div>
                          <div style={{ whiteSpace: 'nowrap' }}>
                            {it.amount_crc > 0 && <span style={{ color: '#2a7a6a', marginRight: 8 }}>{fi(it.amount_crc)}</span>}
                            {it.points_earned > 0 && <span style={{ color: '#a07830' }}>+{it.points_earned}</span>}
                            {it.points_spent > 0 && <span style={{ color: '#c0392b', marginLeft: 4 }}>−{it.points_spent}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ color: '#5a5040', fontSize: '0.85rem', padding: '2rem', textAlign: 'center', border: '1px dashed var(--t-border,#d4cfc4)', borderRadius: 4 }}>
                  Elegí un cliente de la lista{canManage ? ' o creá uno nuevo' : ''}.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

// ── Subcomponentes ───────────────────────────────────────────────
const selStyle: React.CSSProperties = { background: '#111', border: '1px solid #2a2a2a', color: '#e8e2d8', padding: '5px 8px', borderRadius: 2, fontSize: '0.8rem' }

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: '0.58rem', color: '#5a5040', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      {children}
    </div>
  )
}
function Kpi({ label, val, color }: { label: string; val: string; color?: string }) {
  return (
    <div style={{ background: 'var(--t-paper)', border: '1px solid var(--t-border,#d4cfc4)', borderRadius: 3, padding: '0.5rem 0.85rem', minWidth: 80 }}>
      <div style={{ fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#5a5040' }}>{label}</div>
      <div style={{ fontSize: '1.1rem', fontWeight: 700, color: color ?? 'var(--t-ink,#0d0d0d)' }}>{val}</div>
    </div>
  )
}
function Mini({ label, val, color }: { label: string; val: string; color?: string }) {
  return (
    <div style={{ background: 'rgba(0,0,0,0.04)', border: '1px solid var(--t-border,#d4cfc4)', borderRadius: 2, padding: '0.4rem 0.5rem' }}>
      <div style={{ fontSize: '0.56rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#5a5040' }}>{label}</div>
      <div style={{ fontSize: '0.82rem', fontWeight: 600, color: color ?? 'var(--t-ink,#0d0d0d)', fontFamily: 'DM Mono, monospace' }}>{val}</div>
    </div>
  )
}

function CustomerForm({ form, setForm, onSave, onCancel, saving }: {
  form: typeof EMPTY_FORM
  setForm: React.Dispatch<React.SetStateAction<typeof EMPTY_FORM>>
  onSave: () => void; onCancel: () => void; saving: boolean
}) {
  const set = (k: keyof typeof EMPTY_FORM, v: string) => setForm(p => ({ ...p, [k]: v }))
  return (
    <div style={{ border: '1px solid var(--t-border,#d4cfc4)', borderRadius: 4, padding: '1rem', background: 'var(--t-paper)' }}>
      <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--t-teal,#2a7a6a)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.75rem' }}>
        {form.phone ? 'Cliente' : 'Nuevo cliente'}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <Field label="Teléfono *"><input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="8888-8888" style={{ ...selStyle, width: '100%', boxSizing: 'border-box' }} /></Field>
        <Field label="Nombre"><input value={form.name} onChange={e => set('name', e.target.value)} style={{ ...selStyle, width: '100%', boxSizing: 'border-box' }} /></Field>
        <Field label="Email"><input value={form.email} onChange={e => set('email', e.target.value)} style={{ ...selStyle, width: '100%', boxSizing: 'border-box' }} /></Field>
        <Field label="Cumpleaños"><input type="date" value={form.birth_date} onChange={e => set('birth_date', e.target.value)} style={{ ...selStyle, width: '100%', boxSizing: 'border-box' }} /></Field>
        <Field label="Origen">
          <select value={form.channel_origin} onChange={e => set('channel_origin', e.target.value)} style={{ ...selStyle, width: '100%' }}>
            {['manual', 'presencial', 'whatsapp'].map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </Field>
        <Field label="Tier">
          <select value={form.tier} onChange={e => set('tier', e.target.value)} style={{ ...selStyle, width: '100%' }}>
            {(['nuevo', 'regular', 'vip', 'embajador'] as CustomerTier[]).map(t => <option key={t} value={t}>{TIER_LABELS[t]}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Notas"><input value={form.notes} onChange={e => set('notes', e.target.value)} style={{ ...selStyle, width: '100%', boxSizing: 'border-box', marginBottom: '0.75rem' }} /></Field>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button onClick={onSave} disabled={saving}
          style={{ padding: '6px 16px', borderRadius: 2, background: 'var(--t-teal,#2a7a6a)', color: '#fff', border: 'none', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer' }}>
          {saving ? '⟳ Guardando…' : '✓ Guardar'}
        </button>
        <button onClick={onCancel} style={{ padding: '6px 16px', borderRadius: 2, background: 'transparent', color: '#888', border: '1px solid #2a2a2a', fontSize: '0.8rem', cursor: 'pointer' }}>Cancelar</button>
      </div>
    </div>
  )
}
