import { useState } from 'react'
import type { DiasMap, ProductMap, Comp } from '../../shared/types/ventas'
import { aggSalonero, allSaloneros, datesInRange, allDates } from './ventasUtils'
import { saveComp, deleteComp } from '../../shared/api/ventas'

interface Props {
  dias:  DiasMap
  pm:    ProductMap
  comps: Comp[]
  onRefresh: () => void
}

function todayISO(): string { return new Date().toISOString().slice(0, 10) }

export default function VentasCompetencias({ dias, pm, comps, onRefresh }: Props) {
  const [tab, setTab] = useState<'active'|'new'>('active')
  const [saving, setSaving] = useState(false)
  const sals = allSaloneros(dias)

  // New comp form
  const emptyComp = (): Omit<Comp, 'id'> => ({
    nombre: '',
    tipo:   'semanal',
    inicio: todayISO(),
    fin:    todayISO(),
    premio: '',
    prods:  [{ name: '', pts: 1 }],
    parts:  [...sals],
  })
  const [form, setForm] = useState(emptyComp())

  const handleSaveComp = async () => {
    if (!form.nombre.trim()) return
    setSaving(true)
    try {
      await saveComp({ ...form, id: String(Date.now()) })
      setForm(emptyComp())
      setTab('active')
      onRefresh()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm('¿Eliminar esta competencia?')) return
    await deleteComp(id)
    onRefresh()
  }

  const getStatus = (c: Comp): 'active' | 'upcoming' | 'ended' => {
    const today = todayISO()
    if (today < c.inicio) return 'upcoming'
    if (today > c.fin)    return 'ended'
    return 'active'
  }

  const getRanking = (c: Comp) => {
    const dates = datesInRange(allDates(dias), c.inicio, c.fin)
    return [...c.parts].map(sal => {
      const agg = aggSalonero(sal, dates, dias, pm)
      let pts = 0
      for (const p of c.prods) {
        const q = agg.prods[p.name.toUpperCase()]?.q ?? 0
        pts += q * p.pts
      }
      return { sal, pts, days: agg.days }
    }).sort((a, b) => b.pts - a.pts)
  }

  const [expandedComp, setExpandedComp] = useState<string | null>(null)

  return (
    <div className="vt-section">
      <div className="vt-tab-group" style={{ marginBottom: '1.25rem' }}>
        <button className={`vt-tab-btn ${tab === 'active' ? 'active' : ''}`}
          onClick={() => setTab('active')}>Competencias ({comps.length})</button>
        <button className={`vt-tab-btn ${tab === 'new' ? 'active' : ''}`}
          onClick={() => setTab('new')}>+ Nueva</button>
      </div>

      {tab === 'active' && (
        <>
          {comps.length === 0 && (
            <div className="vt-empty">
              <div className="vt-empty-icon">🏆</div>
              <div className="vt-empty-title">Sin competencias</div>
              <div className="vt-empty-sub">Creá una para motivar al equipo</div>
            </div>
          )}
          {[...comps]
            .sort((a, b) => {
              const order = { active: 0, upcoming: 1, ended: 2 }
              return order[getStatus(a)] - order[getStatus(b)]
            })
            .map(c => {
              const status  = getStatus(c)
              const ranking = expandedComp === c.id ? getRanking(c) : []
              const total   = Math.max(1, Math.ceil((new Date(c.fin).getTime() - new Date(c.inicio).getTime()) / 86400000))
              const elapsed = Math.min(total, Math.max(0, Math.ceil((new Date().getTime() - new Date(c.inicio).getTime()) / 86400000)))

              return (
                <div key={c.id} className="vt-comp-card">
                  <div className="vt-comp-head">
                    <div>
                      <div className="vt-comp-name">{c.nombre}</div>
                      <div style={{ fontSize: '0.72rem', color: '#888', marginTop: '0.2rem' }}>
                        {c.inicio} → {c.fin} ·
                        <span style={{
                          marginLeft: '0.4rem',
                          color: status === 'active' ? 'var(--vt-green)' : status === 'upcoming' ? 'var(--vt-gold)' : '#888'
                        }}>
                          {status === 'active' ? '● En curso' : status === 'upcoming' ? '○ Próxima' : '✓ Finalizada'}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <button className="tips-btn-ghost" style={{ fontSize: '0.75rem' }}
                        onClick={() => setExpandedComp(expandedComp === c.id ? null : c.id)}>
                        {expandedComp === c.id ? '▲' : '▼ Ver ranking'}
                      </button>
                      <button className="cd-mov-del" onClick={() => handleDelete(c.id)}>×</button>
                    </div>
                  </div>

                  <div style={{ marginBottom: '0.5rem' }}>
                    <span style={{ fontSize: '0.72rem', color: '#888' }}>Premio: </span>
                    <span style={{ fontSize: '0.82rem', color: 'var(--vt-gold)' }}>{c.premio}</span>
                  </div>

                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                    {c.prods.map(p => (
                      <span key={p.name} className="vt-comp-prod-tag">
                        {p.name} · {p.pts} pts
                      </span>
                    ))}
                  </div>

                  {/* Progress bar */}
                  <div className="vt-progress-track">
                    <div className="vt-progress-fill" style={{ width: `${elapsed/total*100}%`, background: 'var(--vt-gold)' }} />
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#888', marginTop: '0.25rem' }}>
                    {elapsed} / {total} días
                  </div>

                  {/* Ranking */}
                  {expandedComp === c.id && (
                    <div className="vt-comp-ranking">
                      {ranking.map((r, i) => (
                        <div key={r.sal} className="vt-comp-rank-row">
                          <span className="vt-comp-rank-num" style={{
                            color: i === 0 ? '#f4d03f' : i === 1 ? '#aaa' : i === 2 ? '#cd7f32' : '#555',
                          }}>{i + 1}</span>
                          <span style={{ flex: 1, fontWeight: i < 3 ? 700 : 400 }}>{r.sal}</span>
                          <span style={{ color: 'var(--vt-gold)', fontWeight: 700 }}>{r.pts} pts</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
        </>
      )}

      {tab === 'new' && (
        <div className="vt-comp-form">
          <div className="cash-form-grid">
            <div className="tips-field cash-form-desc">
              <div className="tips-field-label">Nombre de la competencia</div>
              <input className="tips-input-dark" value={form.nombre}
                onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))}
                placeholder="ej: Batalla de bebidas — Julio" />
            </div>
            <div className="tips-field">
              <div className="tips-field-label">Tipo</div>
              <select className="tips-input-dark" value={form.tipo}
                onChange={e => setForm(p => ({ ...p, tipo: e.target.value as Comp['tipo'] }))}>
                <option value="semanal">Semanal</option>
                <option value="mensual">Mensual</option>
                <option value="especial">Especial</option>
              </select>
            </div>
            <div className="tips-field">
              <div className="tips-field-label">Inicio</div>
              <input type="date" className="tips-input-dark" value={form.inicio}
                onChange={e => setForm(p => ({ ...p, inicio: e.target.value }))} />
            </div>
            <div className="tips-field">
              <div className="tips-field-label">Fin</div>
              <input type="date" className="tips-input-dark" value={form.fin}
                onChange={e => setForm(p => ({ ...p, fin: e.target.value }))} />
            </div>
            <div className="tips-field cash-form-desc">
              <div className="tips-field-label">Premio</div>
              <input className="tips-input-dark" value={form.premio}
                onChange={e => setForm(p => ({ ...p, premio: e.target.value }))}
                placeholder="ej: Cena para dos, bono ₡25,000..." />
            </div>
          </div>

          {/* Productos con puntos */}
          <div className="vt-sl" style={{ marginTop: '1rem' }}>Productos y puntos</div>
          {form.prods.map((p, i) => (
            <div key={i} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.4rem', alignItems: 'center' }}>
              <input className="tips-input-dark" style={{ flex: 3 }} value={p.name}
                placeholder="Nombre del producto (mayúsculas)"
                onChange={e => {
                  const prods = [...form.prods]
                  prods[i] = { ...prods[i], name: e.target.value.toUpperCase() }
                  setForm(prev => ({ ...prev, prods }))
                }} />
              <input type="number" className="tips-input-dark" style={{ flex: 1, width: 60 }}
                value={p.pts} min={1}
                onChange={e => {
                  const prods = [...form.prods]
                  prods[i] = { ...prods[i], pts: Number(e.target.value) || 1 }
                  setForm(prev => ({ ...prev, prods }))
                }} />
              <span style={{ fontSize: '0.75rem', color: '#888' }}>pts</span>
              <button className="cd-btn-remove"
                onClick={() => setForm(p => ({ ...p, prods: p.prods.filter((_, j) => j !== i) }))}>×</button>
            </div>
          ))}
          <button className="tips-btn-ghost" style={{ fontSize: '0.8rem', marginBottom: '1rem' }}
            onClick={() => setForm(p => ({ ...p, prods: [...p.prods, { name: '', pts: 1 }] }))}>
            + Agregar producto
          </button>

          {/* Participantes */}
          <div className="vt-sl">Participantes</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '1rem' }}>
            {sals.map(n => (
              <button key={n}
                className={`vt-sal-pill ${form.parts.includes(n) ? 'active' : ''}`}
                onClick={() => setForm(p => ({
                  ...p,
                  parts: p.parts.includes(n) ? p.parts.filter(x => x !== n) : [...p.parts, n],
                }))}>
                {n}
              </button>
            ))}
          </div>

          <button className="tips-btn-teal" onClick={handleSaveComp} disabled={saving || !form.nombre}>
            {saving ? 'Guardando…' : '✓ Crear competencia'}
          </button>
        </div>
      )}
    </div>
  )
}
