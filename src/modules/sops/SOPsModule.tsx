import { useState, useEffect, useMemo } from 'react'
import DOMPurify from 'dompurify'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../shared/hooks/useAuth'
import { getSOPs, saveSOPItem, deleteSOPItem, SOP_CATEGORIES, SOP_AREAS } from '../../shared/api/sops'
import type { SOP } from '../../shared/api/sops'
import { agruparSops, compararGrupos, grupoDe, nombreCorto } from './sopsOrden'
import { renderContent, resumenTarjeta } from './sopsRender'
import SopLector from './SopLector'
import SopLibros from './SopLibros'

const CATEGORY_ICONS: Record<string, string> = {
  'Apertura':    '🌅',
  'Cierre':      '🌙',
  'Servicio':    '🍽️',
  'Barra':       '🍸',
  'Cocina':      '👨‍🍳',
  'Delivery':    '🛵',
  'Propinas':    '💰',
  'Emergencias': '🚨',
  'General':     '📋',
  // Áreas del paquete de SoP (mig 076)
  '1. Cultura y servicio':    '🎌',
  '2. Salón y recepción':     '🍽️',
  '3. Menú y producto':       '🍣',
  '4. Administración y caja': '🧾',
  '5. Equipo':                '👥',
}

export default function SOPsModule() {
  const { profile } = useAuth()
  const navigate    = useNavigate()
  const canEdit     = profile?.role === 'owner' || profile?.role === 'manager'

  const [sops, setSops]         = useState<SOP[]>([])
  const [loading, setLoading]   = useState(true)
  const [catFilter, setCatFilter] = useState<string>('all')
  const [search, setSearch]     = useState('')
  const [selectedSOP, setSelectedSOP] = useState<SOP | null>(null)
  const [showEditor, setShowEditor]   = useState(false)
  const [editSOP, setEditSOP]         = useState<Partial<SOP> | null>(null)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    getSOPs().then(setSops).catch(console.error).finally(() => setLoading(false))
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect -- patrón existente (carga/reset dentro del effect); refactor aparte, sin cambio de comportamiento
  useEffect(() => { load() }, [])

  // Agrupado por área (o por categoría si la fila todavía no tiene área), orden por código.
  const grupos = useMemo(() => agruparSops(sops, catFilter, search), [sops, catFilter, search])

  const categories = useMemo(() => [...new Set(sops.map(grupoDe))].sort(compararGrupos), [sops])

  const handleSave = async () => {
    if (!editSOP || !profile) return
    if (!editSOP.title?.trim()) { setError('Título requerido'); return }
    if (!editSOP.content?.trim()) { setError('Contenido requerido'); return }
    setSaving(true); setError(null)
    try {
      await saveSOPItem({
        id:         editSOP.id,
        title:      editSOP.title!,
        category:   editSOP.category ?? 'General',
        content:    editSOP.content!,
        display_order: editSOP.display_order ?? 0,
        created_by: profile.id,
        code:       editSOP.code ?? null,
        area:       editSOP.area ?? null,
      })
      setShowEditor(false)
      setEditSOP(null)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error guardando')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm('¿Eliminar este procedimiento?')) return
    try { await deleteSOPItem(id); load() }
    catch { /* noop */ }
  }

  return (
    <div className="sop-module">

      {/* Header */}
      <div className="sop-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontFamily: 'var(--font-serif)', fontSize: '1.4rem', color: 'var(--t-gold)' }}>書</span>
          <div>
            <div style={{ fontFamily: 'var(--font-serif)', fontWeight: 700, fontSize: '1rem', color: 'var(--t-gold)' }}>
              Procedimientos
            </div>
            <div style={{ fontSize: '0.6rem', letterSpacing: '0.25em', color: '#555', textTransform: 'uppercase' }}>
              SOPs · Satori
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
          {canEdit && (
            <button className="tips-btn-teal" style={{ fontSize: '0.8rem' }}
              onClick={() => { setEditSOP({ category: 'General', display_order: 0 }); setShowEditor(true) }}>
              + Nuevo procedimiento
            </button>
          )}
          <button className="cash-back-btn" style={{ borderColor: '#333', color: '#888' }}
            onClick={() => navigate('/')}>← Inicio</button>
        </div>
      </div>

      {/* Filters */}
      <div className="sop-filters">
        <input
          type="search"
          className="sop-search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por código, título o texto…"
        />
        <div className="sop-cat-tabs">
          <button className={`sop-cat-tab ${catFilter === 'all' ? 'active' : ''}`}
            onClick={() => setCatFilter('all')}>
            Todos ({sops.length})
          </button>
          {categories.map(cat => (
            <button key={cat} className={`sop-cat-tab ${catFilter === cat ? 'active' : ''}`}
              onClick={() => setCatFilter(cat)}>
              {CATEGORY_ICONS[cat] ?? '📋'} {nombreCorto(cat)}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="sop-body">
        {!loading && sops.length > 0 && <SopLibros rol={profile?.role} />}
        {loading ? (
          <div style={{ padding: '4rem', textAlign: 'center', color: '#888' }}>Cargando…</div>
        ) : sops.length === 0 ? (
          <div className="sop-empty">
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>書</div>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: '1.1rem', marginBottom: '0.5rem' }}>
              Sin procedimientos cargados
            </div>
            <div style={{ fontSize: '0.82rem', color: '#888', marginBottom: '1.5rem' }}>
              Documentá los procesos del restaurante para que todo el equipo trabaje igual
            </div>
            {canEdit && (
              <button className="tips-btn-teal"
                onClick={() => { setEditSOP({ category: 'General' }); setShowEditor(true) }}>
                Crear primer procedimiento
              </button>
            )}
          </div>
        ) : grupos.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#888', fontSize: '0.85rem' }}>
            Sin resultados para "{search}"
          </div>
        ) : (
          grupos.map(([cat, items]) => (
            <div key={cat} className="sop-category-section">
              <div className="sop-category-header">
                <span>{CATEGORY_ICONS[cat] ?? '📋'}</span>
                <span>{nombreCorto(cat)}</span>
                <span className="sop-category-count">{items.length}</span>
              </div>
              <div className="sop-cards">
                {items.map(sop => (
                  <div key={sop.id} className="sop-card"
                    onClick={() => setSelectedSOP(sop)}>
                    <div className="sop-card-title">
                      {sop.code && <span className="sop-code">{sop.code}</span>}
                      {sop.title}
                    </div>
                    <div className="sop-card-preview">
                      {resumenTarjeta(sop.content)}
                    </div>
                    {sop.pdf_path && sop.doc_type === 'Documento' && <div className="sop-card-pdf">PDF con fotos</div>}
                    {canEdit && (
                      <div className="sop-card-actions" onClick={e => e.stopPropagation()}>
                        <button className="sop-edit-btn"
                          onClick={() => { setEditSOP({...sop}); setShowEditor(true) }}>
                          Editar
                        </button>
                        <button className="sop-del-btn" onClick={() => handleDelete(sop.id)}>×</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Lector del SoP (detalle) */}
      {selectedSOP && (
        <SopLector
          sop={selectedSOP}
          canEdit={canEdit}
          onClose={() => setSelectedSOP(null)}
          onEdit={() => { setEditSOP({ ...selectedSOP }); setSelectedSOP(null); setShowEditor(true) }}
        />
      )}

      {/* Editor modal */}
      {showEditor && editSOP !== null && (
        <div className="sop-overlay" onClick={() => setShowEditor(false)}>
          <div className="sop-editor" onClick={e => e.stopPropagation()}>
            <div className="sop-editor-header">
              <div className="sop-detail-title">
                {editSOP.id ? 'Editar procedimiento' : 'Nuevo procedimiento'}
              </div>
              <button className="sop-close-btn" onClick={() => setShowEditor(false)}>✕</button>
            </div>

            {error && (
              <div className="tips-error" style={{ margin: '0 1.5rem 0.75rem' }}>
                <span>{error}</span><button onClick={() => setError(null)}>✕</button>
              </div>
            )}

            <div className="sop-editor-body">
              <div className="sop-editor-row">
                <div className="tips-field" style={{ flex: 2 }}>
                  <div className="tips-field-label">Título *</div>
                  <input className="tips-input-dark"
                    value={editSOP.title ?? ''}
                    onChange={e => setEditSOP(p => ({ ...p, title: e.target.value }))}
                    placeholder="ej: Apertura de salón" />
                </div>
                <div className="tips-field" style={{ flex: 1 }}>
                  <div className="tips-field-label">Categoría</div>
                  <select className="tips-input-dark"
                    value={editSOP.category ?? 'General'}
                    onChange={e => setEditSOP(p => ({ ...p, category: e.target.value }))}>
                    {SOP_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div className="tips-field" style={{ width: 70 }}>
                  <div className="tips-field-label">Orden</div>
                  <input type="number" className="tips-input-dark"
                    value={editSOP.display_order ?? 0} min={0}
                    style={{ width: '100%' }}
                    onChange={e => setEditSOP(p => ({ ...p, display_order: Number(e.target.value) }))} />
                </div>
              </div>

              <div className="sop-editor-row">
                <div className="tips-field" style={{ width: 90 }}>
                  <div className="tips-field-label">Código</div>
                  <input className="tips-input-dark"
                    value={editSOP.code ?? ''}
                    style={{ width: '100%' }}
                    onChange={e => setEditSOP(p => ({ ...p, code: e.target.value }))}
                    placeholder="ej: 2.5" />
                </div>
                <div className="tips-field" style={{ flex: 1 }}>
                  <div className="tips-field-label">Área</div>
                  <select className="tips-input-dark"
                    value={editSOP.area ?? ''}
                    onChange={e => setEditSOP(p => ({ ...p, area: e.target.value || null }))}>
                    <option value="">— Sin área (se agrupa por categoría) —</option>
                    {SOP_AREAS.map(a => <option key={a}>{a}</option>)}
                  </select>
                </div>
              </div>

              <div className="tips-field">
                <div className="tips-field-label">
                  Contenido * — **negrita**, ## Sección, ### Subsección, 1. pasos, - viñetas, &gt; nota, | tablas |
                </div>
                <textarea
                  className="sop-textarea"
                  value={editSOP.content ?? ''}
                  onChange={e => setEditSOP(p => ({ ...p, content: e.target.value }))}
                  placeholder={`## Objetivo\nQué se busca con este procedimiento.\n\n## Procedimiento\n1. Primer paso del proceso\n2. Segundo paso\n3. Tercer paso\n\n### Detalle\n- **Siempre** verificar que...\n- En caso de duda, consultar al encargado\n\n> Nota importante destacada.`}
                  rows={14}
                />
              </div>

              {/* Live preview */}
              {editSOP.content && (
                <div>
                  <div style={{ fontSize: '0.68rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#888', marginBottom: '0.5rem' }}>
                    Vista previa
                  </div>
                  <div className="sop-preview-box">
                    <div className="sop-content"
                      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(renderContent(editSOP.content ?? ''), { ADD_ATTR: ['target'] }) }}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="sop-editor-footer">
              <button className="tips-btn-ghost" onClick={() => setShowEditor(false)}>Cancelar</button>
              <button className="tips-btn-teal" onClick={handleSave} disabled={saving}>
                {saving ? 'Guardando…' : 'Guardar procedimiento'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
