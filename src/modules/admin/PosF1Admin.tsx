import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  getLocations, upsertLocation,
  getModifierGroups, saveModifierGroup, getModifiers, saveModifier, deleteModifier,
  getProductGroupLinks, linkProductGroup, unlinkProductGroup, searchProducts,
  getSalonTables, saveSalonTable, deactivateSalonTable,
  getAllProducts, getProductsFull, getKdsSettings, saveKdsSettings,
} from '../../shared/api/pos'
import type { PosLocation, ModifierGroupRow, ModifierRow, ProductGroupLink, SalonTable, KdsSettings } from '../../shared/api/pos'
import { computeItemPrice, validateItemSelections } from '../../shared/utils/posPricing'
import type { PosModifierGroup } from '../../shared/utils/posPricing'
import { fmtElapsed } from '../../shared/utils/kds'
import { fi } from '../../shared/utils'
import ProductosAdmin from './ProductosAdmin'

type Section = 'locales' | 'catalogo' | 'salon' | 'productos' | 'kds'

/** PoS F1 (ROADMAP "PoS Satori + KDS"): locales, catálogo con modificadores y
 *  editor de salón. Solo gerencia (la pestaña vive en Admin, ruta OwnerRoute). */
export default function PosF1Admin() {
  const [section, setSection]   = useState<Section>('salon')
  const [locations, setLocations] = useState<PosLocation[]>([])
  const [activeLoc, setActiveLoc] = useState('santa-teresa')   // local activo del editor
  const [error, setError]       = useState<string | null>(null)

  useEffect(() => { getLocations().then(setLocations).catch(e => setError(e.message)) }, [])

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.875rem' }}>
        {(['salon', 'catalogo', 'productos', 'kds', 'locales'] as Section[]).map(s => (
          <button key={s} onClick={() => setSection(s)}
            style={{ padding: '5px 14px', borderRadius: 3, fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer',
              border: '1px solid var(--t-border,#d4cfc4)',
              background: section === s ? 'var(--t-ink,#0d0d0d)' : 'transparent',
              color: section === s ? 'var(--t-gold,#c8a96e)' : '#5a5040' }}>
            {s === 'salon' ? '🪑 Editor de Salón' : s === 'catalogo' ? '🍹 Catálogo PoS'
              : s === 'productos' ? '📦 Productos' : s === 'kds' ? '🖥 KDS' : '🏝 Locales'}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: '#5a5040' }}>Local activo:</span>
        <select className="tips-input-dark" value={activeLoc} onChange={e => setActiveLoc(e.target.value)}>
          {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>
      {error && <div style={{ color: 'var(--t-red,#c23b22)', fontSize: '0.8rem', marginBottom: '0.5rem' }}>{error}</div>}
      {section === 'locales'  && <LocalesSection locations={locations} onChange={setLocations} onError={setError} />}
      {section === 'catalogo' && <CatalogoSection locationId={activeLoc} onError={setError} />}
      {section === 'salon'    && <SalonSection locationId={activeLoc} onError={setError} />}
      {section === 'productos' && <ProductosAdmin locationId={activeLoc} onError={setError} />}
      {section === 'kds'      && <KdsSection locationId={activeLoc} onError={setError} />}
    </div>
  )
}

// ── Locales ──────────────────────────────────────────────────
function LocalesSection({ locations, onChange, onError }: {
  locations: PosLocation[]; onChange: (l: PosLocation[]) => void; onError: (e: string) => void
}) {
  const [newId, setNewId]     = useState('')
  const [newName, setNewName] = useState('')
  const save = async (loc: { id: string; name: string; is_active?: boolean }) => {
    try { await upsertLocation(loc); onChange(await getLocations()) }
    catch (e) { onError(e instanceof Error ? e.message : 'Error guardando local') }
  }
  return (
    <div className="admin-table" style={{ padding: '0.875rem' }}>
      <div style={{ fontSize: '0.72rem', color: '#5a5040', marginBottom: '0.625rem' }}>
        Multi-local desde el diseño: todo lo nuevo del PoS (catálogo, salón, pedidos) cuelga de un local.
      </div>
      {locations.map(l => (
        <div key={l.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', padding: '0.4rem 0', borderBottom: '1px solid var(--t-border,#d4cfc4)' }}>
          <code style={{ fontSize: '0.7rem', color: '#5a5040', minWidth: 110 }}>{l.id}</code>
          <input className="tips-input-dark" defaultValue={l.name} onBlur={e => { if (e.target.value !== l.name) save({ id: l.id, name: e.target.value }) }} />
          <label style={{ fontSize: '0.72rem', color: '#5a5040' }}>
            <input type="checkbox" checked={l.is_active} onChange={e => save({ id: l.id, name: l.name, is_active: e.target.checked })} /> activo
          </label>
        </div>
      ))}
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
        <input className="tips-input-dark" placeholder="id (ej: tamarindo)" value={newId} onChange={e => setNewId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} />
        <input className="tips-input-dark" placeholder="Nombre del local" value={newName} onChange={e => setNewName(e.target.value)} />
        <button className="cd-btn-green" disabled={!newId.trim() || !newName.trim()}
          onClick={() => { save({ id: newId.trim(), name: newName.trim() }); setNewId(''); setNewName('') }}>+ Agregar</button>
      </div>
    </div>
  )
}

// ── Catálogo: grupos de modificadores ────────────────────────
function CatalogoSection({ locationId, onError }: { locationId: string; onError: (e: string) => void }) {
  const [groups, setGroups]   = useState<ModifierGroupRow[]>([])
  const [mods, setMods]       = useState<ModifierRow[]>([])
  const [links, setLinks]     = useState<ProductGroupLink[]>([])
  const [sel, setSel]         = useState<string | null>(null)      // grupo seleccionado
  const [prodSearch, setProdSearch] = useState('')
  const [prodOpts, setProdOpts]     = useState<Array<{ nombre: string; tipo: string }>>([])
  const [previewSel, setPreviewSel] = useState<Record<string, string[]>>({})  // groupId → modifierIds (vista previa)

  const load = useCallback(async () => {
    try {
      const gs = await getModifierGroups(locationId)
      setGroups(gs)
      setMods(await getModifiers(gs.map(g => g.id)))
      setLinks(await getProductGroupLinks())
    } catch (e) { onError(e instanceof Error ? e.message : 'Error cargando catálogo') }
  }, [locationId, onError])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (prodSearch.trim().length < 2) { setProdOpts([]); return }
    const t = setTimeout(() => searchProducts(prodSearch).then(setProdOpts).catch(() => setProdOpts([])), 300)
    return () => clearTimeout(t)
  }, [prodSearch])

  const group = groups.find(g => g.id === sel) ?? null
  const groupMods = mods.filter(m => m.group_id === sel)
  const groupLinks = links.filter(l => l.group_id === sel)

  const saveG = async (g: Partial<ModifierGroupRow> & { name: string }) => {
    try { const saved = await saveModifierGroup({ ...g, location_id: locationId }); await load(); setSel(saved.id) }
    catch (e) { onError(e instanceof Error ? e.message : 'Error guardando grupo') }
  }

  // Vista previa: cómo lo verá el salonero (precio en vivo + bloqueo de obligatorios)
  const previewGroups: PosModifierGroup[] = useMemo(() => groups
    .filter(g => g.is_active && (sel ? g.id === sel : true))
    .map(g => ({ ...g, modifiers: mods.filter(m => m.group_id === g.id && m.is_active) })), [groups, mods, sel])
  const previewPicked = previewGroups.flatMap(g => g.modifiers.filter(m => (previewSel[g.id] ?? []).includes(m.id)))
  const previewCounts = Object.fromEntries(previewGroups.map(g => [g.id, (previewSel[g.id] ?? []).length]))
  const previewError = validateItemSelections(previewGroups, previewCounts)
  const PREVIEW_BASE = 4500

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) 2fr', gap: '0.875rem' }}>
      <div className="admin-table" style={{ padding: '0.75rem' }}>
        <div style={{ fontWeight: 700, fontSize: '0.8rem', marginBottom: '0.5rem' }}>Grupos de modificadores</div>
        {groups.map(g => (
          <div key={g.id} onClick={() => { setSel(g.id); setPreviewSel({}) }}
            style={{ padding: '0.4rem 0.5rem', cursor: 'pointer', borderRadius: 3, marginBottom: 2,
              background: sel === g.id ? 'rgba(160,120,48,.12)' : 'transparent', border: '1px solid var(--t-border,#d4cfc4)' }}>
            <strong style={{ fontSize: '0.82rem' }}>{g.name}</strong>
            <div style={{ fontSize: '0.66rem', color: '#5a5040' }}>
              {g.required ? `OBLIGATORIO · ${Math.max(1, g.min_selections)}–${g.max_selections}` : `opcional · hasta ${g.max_selections}`}
              {!g.is_active && ' · inactivo'}
            </div>
          </div>
        ))}
        <button className="cd-btn-green" style={{ marginTop: '0.5rem', width: '100%' }}
          onClick={() => saveG({ name: 'Nuevo grupo', required: false, min_selections: 0, max_selections: 1 })}>+ Nuevo grupo</button>
      </div>

      <div className="admin-table" style={{ padding: '0.75rem' }}>
        {!group && <div style={{ color: '#5a5040', fontSize: '0.8rem' }}>Elegí un grupo (o creá uno) para editarlo. Caso de referencia: "Licor" obligatorio para Mojito.</div>}
        {group && (
          <>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <input className="tips-input-dark" defaultValue={group.name} key={group.id}
                onBlur={e => e.target.value !== group.name && saveG({ ...group, name: e.target.value })} />
              <label style={{ fontSize: '0.74rem' }}><input type="checkbox" checked={group.required}
                onChange={e => saveG({ ...group, required: e.target.checked, min_selections: e.target.checked ? Math.max(1, group.min_selections) : group.min_selections })} /> obligatorio</label>
              <label style={{ fontSize: '0.74rem' }}>mín <input type="number" className="tips-input-dark" style={{ width: 56 }} value={group.min_selections}
                onChange={e => saveG({ ...group, min_selections: Math.max(0, Number(e.target.value) || 0) })} /></label>
              <label style={{ fontSize: '0.74rem' }}>máx <input type="number" className="tips-input-dark" style={{ width: 56 }} value={group.max_selections}
                onChange={e => saveG({ ...group, max_selections: Math.max(1, Number(e.target.value) || 1) })} /></label>
              <label style={{ fontSize: '0.74rem' }}><input type="checkbox" checked={group.is_active}
                onChange={e => saveG({ ...group, is_active: e.target.checked })} /> activo</label>
            </div>

            <div style={{ fontWeight: 700, fontSize: '0.76rem', margin: '0.75rem 0 0.25rem' }}>Opciones (delta ₡ sobre el precio base)</div>
            {groupMods.map(m => (
              <div key={m.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: 4 }}>
                <input className="tips-input-dark" defaultValue={m.name}
                  onBlur={e => e.target.value !== m.name && saveModifier({ ...m, name: e.target.value }).then(load).catch(er => onError(er.message))} />
                <span style={{ fontSize: '0.74rem' }}>+₡</span>
                <input type="number" className="tips-input-dark" style={{ width: 100 }} defaultValue={m.price_delta_crc}
                  onBlur={e => Number(e.target.value) !== m.price_delta_crc && saveModifier({ ...m, price_delta_crc: Number(e.target.value) || 0 }).then(load).catch(er => onError(er.message))} />
                <button onClick={() => deleteModifier(m.id).then(load).catch(er => onError(er.message))}
                  style={{ background: 'none', border: '1px solid #e0b0b0', color: '#c0392b', borderRadius: 3, padding: '2px 8px', cursor: 'pointer' }}>×</button>
              </div>
            ))}
            <button onClick={() => saveModifier({ group_id: group.id, name: 'Nueva opción', price_delta_crc: 0, sort_order: groupMods.length }).then(load).catch(er => onError(er.message))}
              style={{ background: 'none', border: '1px dashed var(--t-border,#d4cfc4)', color: '#5a5040', borderRadius: 3, padding: '4px 10px', fontSize: '0.74rem', cursor: 'pointer' }}>+ Opción</button>

            <div style={{ fontWeight: 700, fontSize: '0.76rem', margin: '0.875rem 0 0.25rem' }}>Productos con este grupo</div>
            {groupLinks.map(l => (
              <span key={l.product_name} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(42,122,106,.1)', border: '1px solid #2a7a6a', borderRadius: 12, padding: '2px 10px', fontSize: '0.72rem', margin: '0 4px 4px 0' }}>
                {l.product_name}
                <button onClick={() => unlinkProductGroup(l.product_name, group.id).then(load).catch(er => onError(er.message))}
                  style={{ background: 'none', border: 'none', color: '#c0392b', cursor: 'pointer' }}>×</button>
              </span>
            ))}
            <div style={{ position: 'relative', marginTop: 4 }}>
              <input className="tips-input-dark" style={{ width: '100%' }} placeholder="Buscar producto para vincular (ej: MOJITO)…"
                value={prodSearch} onChange={e => setProdSearch(e.target.value)} />
              {prodOpts.length > 0 && (
                <div className="cd-sup-dropdown" style={{ maxHeight: 180, overflowY: 'auto' }}>
                  {prodOpts.map(p => (
                    <div key={p.nombre} className="cd-sup-option"
                      onMouseDown={() => { linkProductGroup(p.nombre, group.id).then(load).catch(er => onError(er.message)); setProdSearch(''); setProdOpts([]) }}>
                      {p.nombre} <span className="cd-sup-cat">· {p.tipo}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ marginTop: '1rem', border: '1px solid var(--t-border,#d4cfc4)', borderRadius: 4, padding: '0.75rem', background: 'rgba(0,0,0,.02)' }}>
              <div style={{ fontWeight: 700, fontSize: '0.76rem', marginBottom: 4 }}>👁 Vista previa — así lo verá el salonero (base de ejemplo ₡{PREVIEW_BASE.toLocaleString()})</div>
              {previewGroups.map(g => (
                <div key={g.id} style={{ marginBottom: 6 }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700 }}>{g.name}{g.required && <span style={{ color: '#c23b22' }}> *</span>}</div>
                  {g.modifiers.map(m => {
                    const picked = (previewSel[g.id] ?? []).includes(m.id)
                    return (
                      <button key={m.id} onClick={() => setPreviewSel(prev => {
                        const cur = prev[g.id] ?? []
                        const next = picked ? cur.filter(x => x !== m.id)
                          : (g.max_selections === 1 ? [m.id] : [...cur, m.id])
                        return { ...prev, [g.id]: next }
                      })}
                        style={{ margin: '2px 4px 2px 0', padding: '4px 10px', borderRadius: 14, fontSize: '0.74rem', cursor: 'pointer',
                          border: `1px solid ${picked ? '#2a7a6a' : 'var(--t-border,#d4cfc4)'}`,
                          background: picked ? 'rgba(42,122,106,.15)' : 'transparent' }}>
                        {m.name}{m.price_delta_crc > 0 ? ` +${fi(m.price_delta_crc)}` : ''}
                      </button>
                    )
                  })}
                </div>
              ))}
              <div style={{ fontSize: '0.82rem', fontWeight: 700, marginTop: 4 }}>
                Total: {fi(computeItemPrice(PREVIEW_BASE, previewPicked))}
                {previewError && <span style={{ color: '#c23b22', fontWeight: 400, fontSize: '0.72rem' }}> · ⛔ {previewError}</span>}
                {!previewError && <span style={{ color: '#2a7a6a', fontWeight: 400, fontSize: '0.72rem' }}> · ✓ se puede enviar</span>}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Editor de Salón ──────────────────────────────────────────
const STEP = 20  // px por toque — controles +/- robustos en tablet (sin drag)
function SalonSection({ locationId, onError }: { locationId: string; onError: (e: string) => void }) {
  const [tables, setTables] = useState<SalonTable[]>([])
  const [sel, setSel]       = useState<string | null>(null)

  const load = useCallback(() => {
    getSalonTables(locationId).then(setTables).catch(e => onError(e.message))
  }, [locationId, onError])
  useEffect(() => { load() }, [load])

  const save = (t: Partial<SalonTable> & { location_id: string; name: string }) =>
    saveSalonTable(t).then(load).catch(e => onError(e instanceof Error ? e.message : 'Error guardando mesa'))

  const t = tables.find(x => x.id === sel) ?? null
  const move = (dx: number, dy: number) => {
    if (!t) return
    save({ ...t, pos_x: Math.max(0, t.pos_x + dx * STEP), pos_y: Math.max(0, t.pos_y + dy * STEP) })
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '3fr minmax(220px, 1fr)', gap: '0.875rem' }}>
      {/* Plano (vista previa del salón) */}
      <div className="admin-table" style={{ position: 'relative', minHeight: 460, overflow: 'auto', background: '#f5f0e8' }}>
        {tables.filter(x => x.is_active).map(x => (
          <div key={x.id} onClick={() => setSel(x.id)}
            style={{ position: 'absolute', left: x.pos_x, top: x.pos_y, cursor: 'pointer',
              width: x.shape === 'bar' ? 96 : 64, height: x.shape === 'bar' ? 36 : 64,
              borderRadius: x.shape === 'round' ? '50%' : 8,
              border: `2px solid ${sel === x.id ? '#a07830' : '#0d0d0d'}`,
              background: sel === x.id ? '#a07830' : '#0d0d0d', color: '#f5f0e8',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.66rem', fontWeight: 700, userSelect: 'none' }}>
            <div>{x.name}</div>
            <div style={{ fontWeight: 400 }}>{x.capacity} pax</div>
          </div>
        ))}
        {tables.filter(x => x.is_active).length === 0 && (
          <div style={{ padding: '2rem', color: '#5a5040', fontSize: '0.8rem' }}>Sin mesas en este local — agregá la primera con "+ Mesa".</div>
        )}
      </div>

      {/* Controles */}
      <div className="admin-table" style={{ padding: '0.75rem' }}>
        <button className="cd-btn-green" style={{ width: '100%', marginBottom: '0.625rem' }}
          onClick={() => save({ location_id: locationId, name: `Mesa ${tables.length + 1}`, capacity: 4, shape: 'square', pos_x: 20, pos_y: 20 })}>
          + Mesa
        </button>
        {!t && <div style={{ fontSize: '0.74rem', color: '#5a5040' }}>Tocá una mesa del plano para editarla.</div>}
        {t && (
          <>
            <input className="tips-input-dark" style={{ width: '100%' }} defaultValue={t.name} key={t.id}
              onBlur={e => e.target.value !== t.name && save({ ...t, name: e.target.value })} />
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', margin: '0.5rem 0' }}>
              <label style={{ fontSize: '0.74rem' }}>pax
                <input type="number" className="tips-input-dark" style={{ width: 60, marginLeft: 4 }} value={t.capacity}
                  onChange={e => save({ ...t, capacity: Math.max(1, Number(e.target.value) || 1) })} /></label>
              <select className="tips-input-dark" value={t.shape} onChange={e => save({ ...t, shape: e.target.value as SalonTable['shape'] })}>
                <option value="square">cuadrada</option><option value="round">redonda</option><option value="bar">barra</option>
              </select>
            </div>
            {/* Posición con botones (robusto en tablet, sin drag) */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 44px)', gap: 4, justifyContent: 'center', margin: '0.5rem 0' }}>
              <span /><button className="tips-btn-ghost" onClick={() => move(0, -1)}>↑</button><span />
              <button className="tips-btn-ghost" onClick={() => move(-1, 0)}>←</button>
              <span style={{ fontSize: '0.62rem', color: '#5a5040', alignSelf: 'center', textAlign: 'center' }}>{t.pos_x},{t.pos_y}</span>
              <button className="tips-btn-ghost" onClick={() => move(1, 0)}>→</button>
              <span /><button className="tips-btn-ghost" onClick={() => move(0, 1)}>↓</button><span />
            </div>
            <button onClick={() => deactivateSalonTable(t.id).then(() => { setSel(null); load() }).catch(e => onError(e.message))}
              style={{ width: '100%', background: 'none', border: '1px solid #e0b0b0', color: '#c0392b', borderRadius: 3, padding: '5px', fontSize: '0.74rem', cursor: 'pointer' }}>
              Quitar mesa del plano
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ── KDS: orden de categorías + umbrales del timer por curso ──
function KdsSection({ locationId, onError }: { locationId: string; onError: (e: string) => void }) {
  const [settings, setSettings] = useState<KdsSettings | null>(null)
  const [allTipos, setAllTipos] = useState<string[]>([])
  const [allSubcats, setAllSubcats] = useState<string[]>([])

  const load = useCallback(async () => {
    try {
      const [s, ps, full] = await Promise.all([getKdsSettings(locationId), getAllProducts(), getProductsFull()])
      setSettings(s)
      setAllTipos([...new Set(ps.map(p => p.tipo).filter(Boolean))].sort())
      setAllSubcats([...new Set(full.map(p => p.subclasificacion).filter(Boolean))].sort())
    } catch (e) { onError(e instanceof Error ? e.message : 'Error cargando config del KDS') }
  }, [locationId, onError])
  useEffect(() => { load() }, [load])

  const persist = async (next: KdsSettings) => {
    setSettings(next)
    try {
      await saveKdsSettings({ location_id: locationId, category_order: next.category_order, course_thresholds: next.course_thresholds,
        subcategory_order: next.subcategory_order, postres_priority: next.postres_priority, postres_threshold: next.postres_threshold })
    } catch (e) { onError(e instanceof Error ? e.message : 'Error guardando config del KDS'); load() }
  }

  if (!settings) return <div style={{ padding: '1rem', color: '#5a5040', fontSize: '0.8rem' }}>Cargando…</div>
  const order = settings.category_order
  const notInOrder = allTipos.filter(t => !order.includes(t))

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= order.length) return
    const next = [...order];[next[i], next[j]] = [next[j], next[i]]
    persist({ ...settings, category_order: next })
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) 1fr', gap: '0.875rem' }}>
      <div className="admin-table" style={{ padding: '0.875rem' }}>
        <div style={{ fontWeight: 700, fontSize: '0.8rem', marginBottom: 4 }}>Orden de categorías en el KDS</div>
        <div style={{ fontSize: '0.7rem', color: '#5a5040', marginBottom: '0.625rem' }}>Define en qué orden aparecen los ítems dentro de cada comanda (por categoría del catálogo).</div>
        {order.map((c, i) => (
          <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0.3rem 0', borderBottom: '1px solid var(--t-border,#eee)' }}>
            <span style={{ width: 18, color: '#5a5040', fontSize: '0.72rem' }}>{i + 1}.</span>
            <strong style={{ flex: 1, fontSize: '0.82rem' }}>{c}</strong>
            <button className="tips-btn-ghost" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
            <button className="tips-btn-ghost" disabled={i === order.length - 1} onClick={() => move(i, 1)}>↓</button>
            <button onClick={() => persist({ ...settings, category_order: order.filter(x => x !== c) })}
              style={{ background: 'none', border: '1px solid #e0b0b0', color: '#c0392b', borderRadius: 3, padding: '1px 7px', cursor: 'pointer' }}>×</button>
          </div>
        ))}
        {order.length === 0 && <div style={{ fontSize: '0.74rem', color: '#5a5040' }}>Sin orden configurado — los ítems salen por categoría alfabética.</div>}
        {notInOrder.length > 0 && (
          <div style={{ marginTop: '0.625rem' }}>
            <div style={{ fontSize: '0.7rem', color: '#5a5040', marginBottom: 4 }}>Agregar categoría:</div>
            {notInOrder.map(t => (
              <button key={t} onClick={() => persist({ ...settings, category_order: [...order, t] })}
                style={{ margin: '0 4px 4px 0', padding: '3px 10px', borderRadius: 12, fontSize: '0.72rem', cursor: 'pointer', border: '1px dashed var(--t-border,#d4cfc4)', background: 'transparent', color: '#5a5040' }}>+ {t}</button>
            ))}
          </div>
        )}
      </div>

      <div className="admin-table" style={{ padding: '0.875rem' }}>
        <div style={{ fontWeight: 700, fontSize: '0.8rem', marginBottom: 4 }}>Umbrales del timer (verde→rojo) por curso</div>
        <div style={{ fontSize: '0.7rem', color: '#5a5040', marginBottom: '0.625rem' }}>Segundos desde que se marcha hasta ponerse en rojo. Ámbar al 66%.</div>
        {(['bebida', 'entrada', 'principal'] as const).map(course => {
          const v = settings.course_thresholds[course] ?? 0
          return (
            <div key={course} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.35rem 0' }}>
              <strong style={{ width: 90, fontSize: '0.8rem', textTransform: 'capitalize' }}>{course}</strong>
              <input type="number" className="tips-input-dark" style={{ width: 90 }} defaultValue={v} key={course + v}
                onBlur={e => {
                  const n = Math.max(0, Number(e.target.value) || 0)
                  if (n !== v) persist({ ...settings, course_thresholds: { ...settings.course_thresholds, [course]: n } })
                }} />
              <span style={{ fontSize: '0.72rem', color: '#5a5040' }}>seg · {fmtElapsed(v)} min</span>
            </div>
          )
        })}

        <div style={{ fontWeight: 700, fontSize: '0.8rem', margin: '0.875rem 0 4px' }}>🍰 Postres (refinamiento 06-12)</div>
        <label style={{ fontSize: '0.74rem', display: 'block' }}>
          <input type="checkbox" checked={settings.postres_priority ?? true}
            onChange={e => persist({ ...settings, postres_priority: e.target.checked })} />{' '}
          Prioridad en rush: destacados y arriba en la comanda (no quedan al fondo)
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
          <span style={{ fontSize: '0.74rem' }}>Timer propio de postres</span>
          <input type="number" className="tips-input-dark" style={{ width: 80 }} defaultValue={settings.postres_threshold ?? 240} key={'pt' + (settings.postres_threshold ?? 240)}
            onBlur={e => { const n = Math.max(0, Number(e.target.value) || 0); if (n !== settings.postres_threshold) persist({ ...settings, postres_threshold: n }) }} />
          <span style={{ fontSize: '0.72rem', color: '#5a5040' }}>seg (más corto que los cursos)</span>
        </div>
        <div style={{ fontSize: '0.64rem', color: '#5a5040', marginTop: 4 }}>Evolución documentada en ROADMAP: carril propio de postres en el KDS.</div>
      </div>

      <div className="admin-table" style={{ padding: '0.875rem', gridColumn: '1 / -1' }}>
        <div style={{ fontWeight: 700, fontSize: '0.8rem', marginBottom: 4 }}>Orden ESCALONADO por subcategoría (dentro de cada comanda)</div>
        <div style={{ fontSize: '0.7rem', color: '#5a5040', marginBottom: '0.625rem' }}>Ej. de la dueña: 1° crudos/pesca local · 2° nigiris y sashimis · 3° rolls/principales. Los postres prioritarios saltan al frente igual.</div>
        {(settings.subcategory_order ?? []).map((c, i) => {
          const order = settings.subcategory_order ?? []
          const move = (dir: -1 | 1) => {
            const j = i + dir
            if (j < 0 || j >= order.length) return
            const next = [...order];[next[i], next[j]] = [next[j], next[i]]
            persist({ ...settings, subcategory_order: next })
          }
          return (
            <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0.3rem 0', borderBottom: '1px solid var(--t-border,#eee)' }}>
              <span style={{ width: 18, color: '#5a5040', fontSize: '0.72rem' }}>{i + 1}.</span>
              <strong style={{ flex: 1, fontSize: '0.82rem' }}>{c}</strong>
              <button className="tips-btn-ghost" disabled={i === 0} onClick={() => move(-1)}>↑</button>
              <button className="tips-btn-ghost" disabled={i === order.length - 1} onClick={() => move(1)}>↓</button>
              <button onClick={() => persist({ ...settings, subcategory_order: order.filter(x => x !== c) })}
                style={{ background: 'none', border: '1px solid #e0b0b0', color: '#c0392b', borderRadius: 3, padding: '1px 7px', cursor: 'pointer' }}>×</button>
            </div>
          )
        })}
        {allSubcats.filter(t => !(settings.subcategory_order ?? []).includes(t)).map(t => (
          <button key={t} onClick={() => persist({ ...settings, subcategory_order: [...(settings.subcategory_order ?? []), t] })}
            style={{ margin: '4px 4px 0 0', padding: '3px 10px', borderRadius: 12, fontSize: '0.72rem', cursor: 'pointer', border: '1px dashed var(--t-border,#d4cfc4)', background: 'transparent', color: '#5a5040' }}>+ {t}</button>
        ))}
      </div>
    </div>
  )
}
