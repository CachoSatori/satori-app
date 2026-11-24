import { useState } from 'react'
import type { DiasMap, ProductMap, Comp } from '../../shared/types/ventas'
import { aggSalonero, allSaloneros, datesInRange, allDates } from './ventasUtils'
import { todayCR } from '../../shared/utils'
import { estadoCompetencia, progresoCompetencia } from './rangosPorDefecto'
import { saveComp, deleteComp } from '../../shared/api/ventas'
import { puedeEditarCompetencias } from '../../shared/permisosCompetencias'
import { alEscribir, errorDeNumeros, leerCuadro, valorInput } from '../../shared/cuadrosNumericos'

// Puntos del formulario: '' vacío, NaN ilegible («0-450», «5-»). Se guardan como número (Comp no cambia). R35.
type FormComp = Omit<Comp, 'id' | 'prods'> & { prods: { name: string; pts: number | '' }[] }

interface Props {
  dias:  DiasMap
  pm:    ProductMap
  comps: Comp[]
  onRefresh: () => void
  /** Rol de quien mira. D18 (23-nov ~23:50 CR): el contador la ve solo para mirar (sin «+ Nueva» ni «×»). */
  role: string
}

// «Hoy» en hora de Costa Rica: con la fecha UTC, desde las 18:00 CR una competencia que termina
// hoy figuraba «Finalizada» en pleno servicio.
const todayISO = (): string => todayCR()

export default function VentasCompetencias({ dias, pm, comps, onRefresh, role }: Props) {
  const puedeEditar = puedeEditarCompetencias(role)
  const [tab, setTab] = useState<'active'|'new'>('active')
  const [saving, setSaving] = useState(false)
  const sals = allSaloneros(dias)

  // New comp form
  const emptyComp = (): FormComp => ({
    nombre: '',
    tipo:   'semanal',
    inicio: todayISO(),
    fin:    todayISO(),
    premio: '',
    prods:  [{ name: '', pts: 1 }],
    parts:  [...sals],
  })
  const [form, setForm] = useState(emptyComp())

  // Antes `Number(x) || 1` guardaba 1 punto con texto ilegible («0-450», «5-»), con «0» o con el cuadro vacío, sin aviso.
  const avisoPts = errorDeNumeros(form.prods.map((p, i) => ({
    nombre: `Puntos · ${p.name.trim() || `producto ${i + 1}`}`, valor: p.pts, entero: true, min: 1, ejemplo: '2',
  })))

  const handleSaveComp = async () => {
    if (!puedeEditar || !form.nombre.trim() || avisoPts) return
    setSaving(true)
    try {
      await saveComp({ ...form, prods: form.prods.map(p => ({ name: p.name, pts: Number(p.pts) })), id: String(Date.now()) }, role)
      setForm(emptyComp())
      setTab('active')
      onRefresh()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!puedeEditar) return
    if (!window.confirm('¿Eliminar esta competencia?')) return
    await deleteComp(id, role)
    onRefresh()
  }

  const getStatus = (c: Comp): 'active' | 'upcoming' | 'ended' => estadoCompetencia(c, todayISO())

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
        {puedeEditar && (
          <button className={`vt-tab-btn ${tab === 'new' ? 'active' : ''}`}
            onClick={() => setTab('new')}>+ Nueva</button>
        )}
      </div>

      {tab === 'active' && (
        <>
          {comps.length === 0 && (
            <div className="vt-empty">
              <div className="vt-empty-icon">🏆</div>
              <div className="vt-empty-title">Sin competencias</div>
              <div className="vt-empty-sub">{puedeEditar ? 'Creá una para motivar al equipo' : 'Gerencia todavía no creó ninguna'}</div>
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
              const { total, elapsed } = progresoCompetencia(c, todayISO())

              return (
                <div key={c.id} className="vt-comp-card">
                  <div className="vt-comp-head">
                    <div>
                      <div className="vt-comp-name">{c.nombre}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--c-gris)', marginTop: '0.2rem' }}>
                        {c.inicio} → {c.fin} ·
                        <span style={{
                          marginLeft: '0.4rem',
                          color: status === 'active' ? 'var(--vt-green)' : status === 'upcoming' ? 'var(--c-oro-texto)' : 'var(--c-gris)'
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
                      {puedeEditar && (
                        <button className="cd-mov-del" aria-label={`Eliminar ${c.nombre}`} onClick={() => handleDelete(c.id)}>×</button>
                      )}
                    </div>
                  </div>

                  <div style={{ marginBottom: '0.5rem' }}>
                    <span style={{ fontSize: '0.72rem', color: 'var(--c-gris)' }}>Premio: </span>
                    <span style={{ fontSize: '0.82rem', color: 'var(--c-oro-texto)' }}>{c.premio}</span>
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
                  <div style={{ fontSize: '0.7rem', color: 'var(--c-gris)', marginTop: '0.25rem' }}>
                    {elapsed} / {total} días
                  </div>

                  {/* Ranking */}
                  {expandedComp === c.id && (
                    <div className="vt-comp-ranking">
                      {ranking.map((r, i) => (
                        <div key={r.sal} className="vt-comp-rank-row">
                          <span className="vt-comp-rank-num" style={{
                            color: i === 0 ? '#f4d03f' : i === 1 ? 'var(--c-gris-claro)' : i === 2 ? '#cd7f32' : 'var(--c-gris)',
                          }}>{i + 1}</span>
                          <span style={{ flex: 1, fontWeight: i < 3 ? 700 : 400 }}>{r.sal}</span>
                          <span style={{ color: 'var(--c-oro-texto)', fontWeight: 700 }}>{r.pts} pts</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
        </>
      )}

      {puedeEditar && tab === 'new' && (
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
                aria-label={`Puntos · ${p.name.trim() || `producto ${i + 1}`}`}
                value={valorInput(p.pts)} min={1}
                {...alEscribir(el => {
                  const pts = leerCuadro(el)
                  setForm(prev => ({ ...prev, prods: prev.prods.map((x, j) => (j === i ? { ...x, pts } : x)) }))
                })} />
              <span style={{ fontSize: '0.75rem', color: 'var(--c-gris)' }}>pts</span>
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

          {avisoPts && <p className="field-error" role="alert" style={{ marginBottom: '0.5rem' }}>{avisoPts}</p>}
          <button className="tips-btn-teal" onClick={handleSaveComp} disabled={saving || !form.nombre || !!avisoPts}>
            {saving ? 'Guardando…' : '✓ Crear competencia'}
          </button>
        </div>
      )}
    </div>
  )
}
