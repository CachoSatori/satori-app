import { useState, useEffect, useMemo } from 'react'
import DOMPurify from 'dompurify'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../shared/hooks/useAuth'
import { getSOPs, saveSOPItem, deleteSOPItem, SOP_CATEGORIES } from '../../shared/api/sops'
import type { SOP } from '../../shared/api/sops'

// ── Markdown renderer (parser por líneas → HTML limpio) ───────
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function inline(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/\[(.+?)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
}
function renderContent(text: string): string {
  const lines = text.replace(/\r/g, '').split('\n')
  const out: string[] = []
  let i = 0
  let h1done = false
  let list: 'ul' | 'ol' | null = null
  const closeList = () => { if (list) { out.push(list === 'ul' ? '</ul>' : '</ol>'); list = null } }

  while (i < lines.length) {
    const t = lines[i].trim()
    if (t === '') { closeList(); i++; continue }

    // Saltar el primer "# Título" (ya se muestra en el encabezado del modal)
    if (/^#\s+/.test(t) && !h1done) { h1done = true; i++; continue }

    // Línea meta: **Categoría:** … · **Aplica a:** …  → subtítulo "Aplica a"
    if (/^\*\*(Categoría|Aplica a)/.test(t)) {
      closeList()
      const m = t.match(/\*\*Aplica a:\*\*\s*(.+)$/)
      if (m) out.push(`<div class="sop-meta">👥 ${inline(m[1].replace(/\s*·\s*$/, ''))}</div>`)
      i++; continue
    }

    // Encabezados ## ### ####
    const h = t.match(/^(#{2,5})\s+(.*)/)
    if (h) { closeList(); const cls = h[1].length === 2 ? 'sop-h2' : h[1].length === 3 ? 'sop-h3' : 'sop-h4'; out.push(`<div class="${cls}">${inline(h[2])}</div>`); i++; continue }

    // Cita / nota (>)
    if (t.startsWith('>')) {
      closeList()
      const parts: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('>')) { parts.push(lines[i].trim().replace(/^>\s?/, '')); i++ }
      out.push(`<div class="sop-note">${inline(parts.join(' '))}</div>`)
      continue
    }

    // Tabla
    if (t.startsWith('|') && i + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[i + 1].trim())) {
      closeList()
      const head = t.split('|').slice(1, -1).map(c => c.trim())
      i += 2
      const body: string[][] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) { body.push(lines[i].trim().split('|').slice(1, -1).map(c => c.trim())); i++ }
      let tb = '<table class="sop-table"><thead><tr>' + head.map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>'
      for (const r of body) tb += '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>'
      out.push(tb + '</tbody></table>'); continue
    }

    // Lista numerada
    const ol = t.match(/^\d+\.\s+(.*)/)
    if (ol) { if (list !== 'ol') { closeList(); out.push('<ol class="sop-ol">'); list = 'ol' } out.push(`<li>${inline(ol[1])}</li>`); i++; continue }

    // Lista con viñetas
    const ul = t.match(/^[-*]\s+(.*)/)
    if (ul) { if (list !== 'ul') { closeList(); out.push('<ul class="sop-ul">'); list = 'ul' } out.push(`<li>${inline(ul[1])}</li>`); i++; continue }

    // Párrafo
    closeList()
    out.push(`<p class="sop-p">${inline(t)}</p>`)
    i++
  }
  closeList()
  return out.join('\n')
}

// Resumen plano para la tarjeta (sin markdown ni título)
function cardPreview(content: string): string {
  const text = content.split('\n').map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && !/^\*\*(Categoría|Aplica a)/.test(l))
    .join(' ')
    .replace(/[*#>`|]/g, '').replace(/\s+/g, ' ').trim()
  return text.slice(0, 120)
}

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
  useEffect(() => { load() }, [])

  // Group by category
  const byCategory = useMemo(() => {
    const filtered = sops.filter(s => {
      if (catFilter !== 'all' && s.category !== catFilter) return false
      if (search && !s.title.toLowerCase().includes(search.toLowerCase()) &&
          !s.content.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
    const groups: Record<string, SOP[]> = {}
    for (const s of filtered) {
      if (!groups[s.category]) groups[s.category] = []
      groups[s.category].push(s)
    }
    return groups
  }, [sops, catFilter, search])

  const categories = [...new Set(sops.map(s => s.category))].sort()

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
          placeholder="Buscar procedimiento…"
        />
        <div className="sop-cat-tabs">
          <button className={`sop-cat-tab ${catFilter === 'all' ? 'active' : ''}`}
            onClick={() => setCatFilter('all')}>
            Todos ({sops.length})
          </button>
          {categories.map(cat => (
            <button key={cat} className={`sop-cat-tab ${catFilter === cat ? 'active' : ''}`}
              onClick={() => setCatFilter(cat)}>
              {CATEGORY_ICONS[cat] ?? '📋'} {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="sop-body">
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
        ) : Object.keys(byCategory).length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#888', fontSize: '0.85rem' }}>
            Sin resultados para "{search}"
          </div>
        ) : (
          Object.entries(byCategory).map(([cat, items]) => (
            <div key={cat} className="sop-category-section">
              <div className="sop-category-header">
                <span>{CATEGORY_ICONS[cat] ?? '📋'}</span>
                <span>{cat}</span>
                <span className="sop-category-count">{items.length}</span>
              </div>
              <div className="sop-cards">
                {items.map(sop => (
                  <div key={sop.id} className="sop-card"
                    onClick={() => setSelectedSOP(sop)}>
                    <div className="sop-card-title">{sop.title}</div>
                    <div className="sop-card-preview">
                      {cardPreview(sop.content)}…
                    </div>
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

      {/* SOP Detail modal */}
      {selectedSOP && (
        <div className="sop-overlay" onClick={() => setSelectedSOP(null)}>
          <div className="sop-detail" onClick={e => e.stopPropagation()}>
            <div className="sop-detail-header">
              <div>
                <div className="sop-detail-cat">
                  {CATEGORY_ICONS[selectedSOP.category] ?? '📋'} {selectedSOP.category}
                </div>
                <div className="sop-detail-title">{selectedSOP.title}</div>
              </div>
              <button className="sop-close-btn" onClick={() => setSelectedSOP(null)}>✕</button>
            </div>
            <div className="sop-detail-body">
              <div className="sop-content"
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(renderContent(selectedSOP.content), { ADD_ATTR: ['target'] }) }}
              />
            </div>
            {canEdit && (
              <div className="sop-detail-footer">
                <button className="tips-btn-ghost" style={{ fontSize: '0.8rem' }}
                  onClick={() => { setEditSOP({...selectedSOP}); setSelectedSOP(null); setShowEditor(true) }}>
                  Editar
                </button>
              </div>
            )}
          </div>
        </div>
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

              <div className="tips-field">
                <div className="tips-field-label">
                  Contenido * — soporta **negrita**, *cursiva*, # Título, - lista, 1. numerado
                </div>
                <textarea
                  className="sop-textarea"
                  value={editSOP.content ?? ''}
                  onChange={e => setEditSOP(p => ({ ...p, content: e.target.value }))}
                  placeholder={`# Pasos a seguir\n\n1. Paso uno del proceso\n2. Paso dos\n3. Paso tres\n\n## Notas importantes\n\n- **Siempre** verificar que...\n- En caso de duda, consultar al encargado`}
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
