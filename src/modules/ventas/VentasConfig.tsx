/**
 * VentasConfig — Clasificación masiva de productos
 *
 * Features:
 *  - Cascading dropdowns: tipo → clasificacion → subclasificacion (derived from pm)
 *  - Multi-select rows + bulk edit panel
 *  - Pending-changes queue → single "Guardar todo" batch save
 *  - Individual row editing inline
 *  - Filtros por tipo, search, y "solo con cambios pendientes"
 */
import { useState, useMemo, useCallback } from 'react'
import type { DiasMap, ProductMap } from '../../shared/types/ventas'
import { saveProductMapItems } from '../../shared/api/ventas'

interface Props {
  dias:      DiasMap
  pm:        ProductMap
  onRefresh: () => void
}

const TIPOS = ['comida','bebida','cortesia','personal','nofood','comensales','merchandising','desconocido']

interface PendingEdit {
  tipo:            string
  clasificacion:   string
  subclasificacion: string
  multiplicador:   number
  costo_unitario:  number
}

// Build cascading options from full pm
function useCascadeOptions(pm: ProductMap) {
  return useMemo(() => {
    const clasByTipo:  Record<string, Set<string>> = {}
    const subclByKey:  Record<string, Set<string>> = {} // key = tipo|clas

    for (const info of Object.values(pm)) {
      const t = info.tipo ?? ''
      const c = info.clasificacion ?? ''
      const s = info.subclasificacion ?? ''
      if (t) {
        if (!clasByTipo[t]) clasByTipo[t] = new Set()
        if (c) clasByTipo[t].add(c)
      }
      if (t && c && s) {
        const k = `${t}|${c}`
        if (!subclByKey[k]) subclByKey[k] = new Set()
        subclByKey[k].add(s)
      }
    }

    return {
      clasForTipo:  (tipo: string) => [...(clasByTipo[tipo] ?? new Set())].sort(),
      subclForKey:  (tipo: string, clas: string) => [...(subclByKey[`${tipo}|${clas}`] ?? new Set())].sort(),
    }
  }, [pm])
}

export default function VentasConfig({ dias, pm, onRefresh }: Props) {
  // ── Filters ─────────────────────────────────────────────────
  const [typeFilter,   setTypeFilter]   = useState('desconocido')
  const [search,       setSearch]       = useState('')
  const [showPending,  setShowPending]  = useState(false)

  // ── Pending edits queue ──────────────────────────────────────
  const [pending,  setPending]  = useState<Record<string, PendingEdit>>({})
  const [saving,   setSaving]   = useState(false)
  const [saveMsg,  setSaveMsg]  = useState<string | null>(null)

  // ── Multi-select ─────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // ── Bulk edit state ──────────────────────────────────────────
  const [bulkTipo,  setBulkTipo]  = useState('')
  const [bulkClas,  setBulkClas]  = useState('')
  const [bulkSubcl, setBulkSubcl] = useState('')
  const [bulkMult,  setBulkMult]  = useState('')

  const { clasForTipo, subclForKey } = useCascadeOptions(pm)

  // ── Derived product list ─────────────────────────────────────
  const allProds = useMemo(() => {
    const names = new Set<string>()
    for (const dia of Object.values(dias))
      for (const s of Object.values(dia.saloneros))
        for (const [name] of (s as { prods?: [string,number,number][] }).prods ?? [])
          names.add(name.toUpperCase())
    return [...names].sort()
  }, [dias])

  // Effective info: pending edit or pm
  function effective(nombre: string): PendingEdit {
    const p = pending[nombre]
    const m = pm[nombre]
    return {
      tipo:             p?.tipo             ?? m?.tipo             ?? 'desconocido',
      clasificacion:    p?.clasificacion     ?? m?.clasificacion     ?? '',
      subclasificacion: p?.subclasificacion  ?? m?.subclasificacion  ?? '',
      multiplicador:    p?.multiplicador     ?? m?.multiplicador     ?? 1,
      costo_unitario:   p?.costo_unitario    ?? m?.costo_unitario    ?? 0,
    }
  }

  function hasPending(nombre: string): boolean {
    return nombre in pending
  }

  const filtered = useMemo(() => {
    return allProds.filter(n => {
      const info = effective(n)
      const matchType   = typeFilter === 'todos' || info.tipo === typeFilter
      const matchSearch = !search || n.toLowerCase().includes(search.toLowerCase())
      const matchPend   = !showPending || hasPending(n)
      return matchType && matchSearch && matchPend
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allProds, typeFilter, search, showPending, pending, pm])

  const counts = useMemo(() => {
    const c: Record<string, number> = { todos: allProds.length }
    for (const n of allProds) {
      const t = effective(n).tipo
      c[t] = (c[t] ?? 0) + 1
    }
    return c
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allProds, pending, pm])

  // ── Edit a single row ────────────────────────────────────────
  function setField(nombre: string, field: keyof PendingEdit, value: string | number) {
    setPending(prev => {
      const curr = prev[nombre] ?? effective(nombre)
      const next = { ...curr, [field]: value }
      // Reset downstream on tipo/clas change
      if (field === 'tipo')  { next.clasificacion = ''; next.subclasificacion = '' }
      if (field === 'clasificacion') { next.subclasificacion = '' }
      return { ...prev, [nombre]: next }
    })
  }

  // ── Multi-select ─────────────────────────────────────────────
  function toggleSelect(n: string) {
    setSelected(prev => { const s = new Set(prev); s.has(n) ? s.delete(n) : s.add(n); return s })
  }
  function selectAll()    { setSelected(new Set(filtered)) }
  function deselectAll()  { setSelected(new Set()) }
  const allFilteredSelected = filtered.length > 0 && filtered.every(n => selected.has(n))

  // ── Apply bulk edit to selected ──────────────────────────────
  function applyBulk() {
    if (selected.size === 0) return
    setPending(prev => {
      const next = { ...prev }
      for (const n of selected) {
        const curr = next[n] ?? effective(n)
        const upd: PendingEdit = { ...curr }
        if (bulkTipo)  { upd.tipo = bulkTipo; upd.clasificacion = ''; upd.subclasificacion = '' }
        if (bulkClas)  { upd.clasificacion = bulkClas; upd.subclasificacion = '' }
        if (bulkSubcl) { upd.subclasificacion = bulkSubcl }
        if (bulkMult)  { upd.multiplicador = Number(bulkMult) }
        next[n] = upd
      }
      return next
    })
    setBulkTipo(''); setBulkClas(''); setBulkSubcl(''); setBulkMult('')
  }

  // ── Discard pending ──────────────────────────────────────────
  function discardOne(n: string) {
    setPending(prev => { const p = { ...prev }; delete p[n]; return p })
  }
  function discardAll() { setPending({}); setSelected(new Set()) }

  // ── Save all pending ─────────────────────────────────────────
  const handleSaveAll = useCallback(async () => {
    const items = Object.entries(pending).map(([nombre, e]) => ({
      nombre,
      tipo:             e.tipo,
      clasificacion:    e.clasificacion,
      subclasificacion: e.subclasificacion,
      multiplicador:    e.multiplicador,
      costo_unitario:   e.costo_unitario,
    }))
    if (!items.length) return
    setSaving(true); setSaveMsg(null)
    try {
      await saveProductMapItems(items)
      setPending({})
      setSelected(new Set())
      setSaveMsg(`✓ ${items.length} producto${items.length > 1 ? 's' : ''} guardado${items.length > 1 ? 's' : ''}`)
      setTimeout(() => setSaveMsg(null), 4000)
      onRefresh()
    } catch (e) {
      setSaveMsg(`✗ ${e instanceof Error ? e.message : 'Error'}`)
    } finally {
      setSaving(false)
    }
  }, [pending, onRefresh])

  const pendingCount = Object.keys(pending).length

  // ── Dropdown helpers ─────────────────────────────────────────
  function ClasSelect({ nombre, tipo, value }: { nombre: string; tipo: string; value: string }) {
    const opts = clasForTipo(tipo)
    return (
      <select className="cd-tbl-select" value={value}
        onChange={e => setField(nombre, 'clasificacion', e.target.value)}>
        <option value="">— sin clasificar —</option>
        {opts.map(o => <option key={o}>{o}</option>)}
        {value && !opts.includes(value) && <option value={value}>{value}</option>}
      </select>
    )
  }

  function SubclSelect({ nombre, tipo, clas, value }: { nombre: string; tipo: string; clas: string; value: string }) {
    const opts = subclForKey(tipo, clas)
    if (!opts.length && !value) {
      return (
        <input className="cd-tbl-input" value={value} placeholder="—"
          onChange={e => setField(nombre, 'subclasificacion', e.target.value)} />
      )
    }
    return (
      <select className="cd-tbl-select" value={value}
        onChange={e => setField(nombre, 'subclasificacion', e.target.value)}>
        <option value="">— sin subcl. —</option>
        {opts.map(o => <option key={o}>{o}</option>)}
        {value && !opts.includes(value) && <option value={value}>{value}</option>}
      </select>
    )
  }

  return (
    <div className="vt-section">

      {/* ── Save bar ─────────────────────────────────────────── */}
      {(pendingCount > 0 || saveMsg) && (
        <div style={{ position:'sticky', top:52, zIndex:90, background:'rgba(10,10,10,0.97)', border:'1px solid #2a2a2a', borderRadius:2, padding:'0.625rem 1rem', marginBottom:'0.75rem', display:'flex', alignItems:'center', gap:'0.75rem', flexWrap:'wrap' }}>
          {saveMsg ? (
            <span style={{ color: saveMsg.startsWith('✓') ? 'var(--vt-green)' : 'var(--vt-red)', fontSize:'0.82rem', fontWeight:600 }}>{saveMsg}</span>
          ) : (
            <>
              <span style={{ fontSize:'0.82rem', color:'#c8a96e', fontWeight:700 }}>
                ⚠ {pendingCount} cambio{pendingCount > 1 ? 's' : ''} pendiente{pendingCount > 1 ? 's' : ''} sin guardar
              </span>
              <button
                style={{ padding:'0.35rem 1rem', borderRadius:2, background:'var(--vt-green)', color:'#0a0a0a', fontWeight:800, fontSize:'0.82rem', border:'none', cursor:'pointer' }}
                disabled={saving} onClick={handleSaveAll}>
                {saving ? '⟳ Guardando…' : `💾 Guardar ${pendingCount} cambio${pendingCount > 1 ? 's' : ''}`}
              </button>
              <button
                style={{ padding:'0.35rem 0.75rem', borderRadius:2, background:'transparent', color:'#888', fontSize:'0.78rem', border:'1px solid #333', cursor:'pointer' }}
                onClick={discardAll}>
                Descartar todo
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Bulk edit panel (shown when items selected) ──────── */}
      {selected.size > 0 && (
        <div style={{ background:'rgba(200,169,110,0.08)', border:'1px solid rgba(200,169,110,.3)', borderRadius:2, padding:'0.75rem 1rem', marginBottom:'0.75rem' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.6rem' }}>
            <span style={{ fontSize:'0.75rem', fontWeight:700, color:'#c8a96e', letterSpacing:'0.1em', textTransform:'uppercase' }}>
              ✏ Edición masiva — {selected.size} producto{selected.size > 1 ? 's' : ''} seleccionado{selected.size > 1 ? 's' : ''}
            </span>
            <button onClick={deselectAll} style={{ background:'none', border:'none', color:'#888', cursor:'pointer', fontSize:'0.75rem' }}>✕ Deseleccionar todo</button>
          </div>
          <div style={{ display:'flex', gap:'0.5rem', flexWrap:'wrap', alignItems:'flex-end' }}>
            {/* Tipo */}
            <div>
              <div style={{ fontSize:'0.62rem', color:'#777', marginBottom:2, textTransform:'uppercase', letterSpacing:'0.08em' }}>Tipo</div>
              <select className="cd-tbl-select" value={bulkTipo}
                onChange={e => { setBulkTipo(e.target.value); setBulkClas(''); setBulkSubcl('') }}>
                <option value="">— no cambiar —</option>
                {TIPOS.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            {/* Clasificacion */}
            <div>
              <div style={{ fontSize:'0.62rem', color:'#777', marginBottom:2, textTransform:'uppercase', letterSpacing:'0.08em' }}>Clasificación</div>
              <select className="cd-tbl-select" value={bulkClas}
                onChange={e => { setBulkClas(e.target.value); setBulkSubcl('') }}
                disabled={!bulkTipo}>
                <option value="">— no cambiar —</option>
                {clasForTipo(bulkTipo).map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            {/* Subclasificacion */}
            <div>
              <div style={{ fontSize:'0.62rem', color:'#777', marginBottom:2, textTransform:'uppercase', letterSpacing:'0.08em' }}>Subclasificación</div>
              <select className="cd-tbl-select" value={bulkSubcl}
                onChange={e => setBulkSubcl(e.target.value)}
                disabled={!bulkTipo || !bulkClas}>
                <option value="">— no cambiar —</option>
                {subclForKey(bulkTipo, bulkClas).map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            {/* Multiplicador */}
            <div>
              <div style={{ fontSize:'0.62rem', color:'#777', marginBottom:2, textTransform:'uppercase', letterSpacing:'0.08em' }}>Mult. ×</div>
              <input className="cd-tbl-input" type="number" min={1} max={20} step={1}
                placeholder="—" value={bulkMult} onChange={e => setBulkMult(e.target.value)}
                style={{ width:60 }} />
            </div>
            <button
              style={{ padding:'0.45rem 1rem', borderRadius:2, background:'#c8a96e', color:'#0a0a0a', fontWeight:800, fontSize:'0.78rem', border:'none', cursor:'pointer', flexShrink:0 }}
              onClick={applyBulk}
              disabled={!bulkTipo && !bulkClas && !bulkSubcl && !bulkMult}>
              Aplicar a {selected.size}
            </button>
          </div>
        </div>
      )}

      {/* ── Filters ──────────────────────────────────────────── */}
      <div style={{ display:'flex', gap:'0.5rem', flexWrap:'wrap', alignItems:'center', marginBottom:'0.75rem' }}>
        <input type="text" placeholder="Buscar producto…" value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ background:'var(--vt-ink)', color:'var(--vt-paper)', border:'1px solid #2a2a2a', padding:'5px 10px', fontSize:'0.8rem', borderRadius:2, width:200 }} />
        <label style={{ display:'flex', alignItems:'center', gap:'0.35rem', fontSize:'0.75rem', color:'#888', cursor:'pointer' }}>
          <input type="checkbox" checked={showPending} onChange={e => setShowPending(e.target.checked)} />
          Solo con cambios
        </label>
        {pendingCount > 0 && (
          <span style={{ fontSize:'0.72rem', color:'#c8a96e' }}>{pendingCount} pendiente{pendingCount>1?'s':''}</span>
        )}
      </div>

      {/* Type filter tabs */}
      <div className="vt-range-bar" style={{ marginBottom:'0.75rem', flexWrap:'wrap' }}>
        {['todos','desconocido',...TIPOS.filter(t => t !== 'desconocido')].map(t => (
          <button key={t} className={`vt-range-btn ${typeFilter === t ? 'active' : ''}`}
            onClick={() => setTypeFilter(t)}>
            {t} ({counts[t] ?? 0})
          </button>
        ))}
      </div>

      {/* ── Table ────────────────────────────────────────────── */}
      <div className="vt-tbl-wrap">
        <table className="vt-tbl">
          <thead>
            <tr>
              <th style={{ width:32 }}>
                <input type="checkbox"
                  checked={allFilteredSelected}
                  ref={el => { if (el) el.indeterminate = selected.size > 0 && !allFilteredSelected }}
                  onChange={allFilteredSelected ? deselectAll : selectAll} />
              </th>
              <th>Producto</th>
              <th>Tipo</th>
              <th>Clasificación</th>
              <th>Subclasificación</th>
              <th className="r" title="Multiplicador para bebidas (botella vino = 5)">Mult. ×</th>
              <th className="r" title="Costo de insumos por unidad vendida">Costo ₡</th>
              <th style={{ width:32 }}/>
            </tr>
          </thead>
          <tbody>
            {filtered.map(nombre => {
              const info = effective(nombre)
              const dirty = hasPending(nombre)
              const isSel = selected.has(nombre)
              return (
                <tr key={nombre}
                  style={{ background: isSel ? 'rgba(200,169,110,.06)' : dirty ? 'rgba(200,169,110,.03)' : undefined }}>
                  {/* Checkbox */}
                  <td>
                    <input type="checkbox" checked={isSel}
                      onChange={() => toggleSelect(nombre)} />
                  </td>
                  {/* Nombre */}
                  <td style={{ fontSize:'0.78rem', fontWeight: dirty ? 600 : 400 }}>
                    {dirty && <span style={{ color:'#c8a96e', marginRight:4, fontSize:'0.65rem' }}>●</span>}
                    {nombre}
                  </td>
                  {/* Tipo */}
                  <td>
                    <select className="cd-tbl-select" value={info.tipo}
                      onChange={e => setField(nombre, 'tipo', e.target.value)}>
                      {TIPOS.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </td>
                  {/* Clasificacion — cascading from tipo */}
                  <td>
                    <ClasSelect nombre={nombre} tipo={info.tipo} value={info.clasificacion} />
                  </td>
                  {/* Subclasificacion — cascading from tipo+clas */}
                  <td>
                    <SubclSelect nombre={nombre} tipo={info.tipo} clas={info.clasificacion} value={info.subclasificacion} />
                  </td>
                  {/* Multiplicador */}
                  <td className="r">
                    <input type="number" className="cd-tbl-input r"
                      value={info.multiplicador} min={1} max={20} step={1}
                      style={{ width:44, color: info.multiplicador > 1 ? 'var(--vt-gold-dark,#a07830)' : undefined, fontWeight: info.multiplicador > 1 ? 700 : undefined }}
                      onChange={e => setField(nombre, 'multiplicador', Number(e.target.value))} />
                  </td>
                  {/* Costo */}
                  <td className="r">
                    <input type="number" className="cd-tbl-input r"
                      value={info.costo_unitario} min={0} step={100}
                      style={{ width:72, color: info.costo_unitario > 0 ? '#7ec8a0' : undefined }}
                      onChange={e => setField(nombre, 'costo_unitario', Number(e.target.value))} />
                  </td>
                  {/* Discard */}
                  <td>
                    {dirty && (
                      <button onClick={() => discardOne(nombre)}
                        style={{ background:'none', border:'none', color:'#555', cursor:'pointer', fontSize:'0.75rem', padding:'0 4px' }}
                        title="Descartar cambio">
                        ↩
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} style={{ textAlign:'center', padding:'2rem', color:'#555', fontSize:'0.85rem' }}>
                  Sin productos para este filtro
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Bottom save button (also sticky at bottom) */}
      {pendingCount > 0 && (
        <div style={{ position:'sticky', bottom:'1.25rem', display:'flex', justifyContent:'center', marginTop:'1rem' }}>
          <button
            style={{ padding:'0.625rem 2rem', borderRadius:24, background:'var(--vt-green)', color:'#0a0a0a', fontWeight:800, fontSize:'0.88rem', border:'none', cursor:'pointer', boxShadow:'0 4px 16px rgba(0,0,0,0.5)' }}
            disabled={saving} onClick={handleSaveAll}>
            {saving ? '⟳ Guardando…' : `💾 Guardar ${pendingCount} cambio${pendingCount > 1 ? 's' : ''}`}
          </button>
        </div>
      )}
    </div>
  )
}
