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
import { useState, useMemo, useCallback, useEffect } from 'react'
import type { DiasMap, ProductMap } from '../../shared/types/ventas'
import { saveProductMapItems } from '../../shared/api/ventas'

const PAGE_SIZE = 50

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
  const [clasFilter,   setClasFilter]   = useState('')
  const [search,       setSearch]       = useState('')
  const [showPending,  setShowPending]  = useState(false)
  const [page,         setPage]         = useState(0)
  const [importMsg,    setImportMsg]    = useState<string | null>(null)

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
      const matchClas   = !clasFilter || info.clasificacion === clasFilter
      const matchSearch = !search || n.toLowerCase().includes(search.toLowerCase())
      const matchPend   = !showPending || hasPending(n)
      return matchType && matchClas && matchSearch && matchPend
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allProds, typeFilter, clasFilter, search, showPending, pending, pm])

  // Reset a la primera página cuando cambian los filtros
  useEffect(() => { setPage(0) }, [typeFilter, clasFilter, search, showPending])

  // Página actual (50 por página)
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage  = Math.min(page, pageCount - 1)
  const paged     = useMemo(
    () => filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [filtered, safePage],
  )

  // Clasificaciones disponibles para el filtro (según tipo activo)
  const clasOptions = useMemo(
    () => (typeFilter === 'todos' ? [] : clasForTipo(typeFilter)),
    [typeFilter, clasForTipo],
  )

  // ── Import de costos desde CSV ───────────────────────────────
  // Columnas esperadas: producto_id, nombre, costo_unitario (con o sin encabezado)
  function handleCostCsv(file: File) {
    setImportMsg(null)
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const text  = String(reader.result)
        const lines = text.split(/\r?\n/).filter(l => l.trim())
        if (!lines.length) { setImportMsg('✗ Archivo vacío'); return }

        const splitRow = (l: string) => l.split(',').map(c => c.trim().replace(/^"|"$/g, ''))
        const header   = splitRow(lines[0]).map(h => h.toLowerCase())
        let nombreIdx  = header.findIndex(h => h === 'nombre' || h === 'producto' || h === 'product')
        let costoIdx   = header.findIndex(h => h.includes('costo') || h.includes('cost'))
        let startRow   = 1
        if (nombreIdx === -1 || costoIdx === -1) {
          // sin encabezado reconocible → asumir orden producto_id, nombre, costo_unitario
          nombreIdx = 1; costoIdx = 2; startRow = 0
        }

        // mapa uppercase → key real del product_map / lista de productos
        const keyByUpper = new Map<string, string>()
        for (const k of [...Object.keys(pm), ...allProds]) keyByUpper.set(k.toUpperCase().trim(), k)

        const updates: Record<string, number> = {}
        let matched = 0, unmatched = 0
        for (let i = startRow; i < lines.length; i++) {
          const cols = splitRow(lines[i])
          const rawNombre = cols[nombreIdx]
          const rawCosto  = cols[costoIdx]
          if (!rawNombre) continue
          const costo = Number(String(rawCosto).replace(/[^\d.-]/g, ''))
          if (!isFinite(costo)) continue
          const key = keyByUpper.get(rawNombre.toUpperCase().trim())
          if (key) { updates[key] = costo; matched++ } else { unmatched++ }
        }

        if (!matched) { setImportMsg(`✗ Ningún producto coincidió (${unmatched} sin match)`); return }

        setPending(prev => {
          const next = { ...prev }
          for (const [nombre, costo] of Object.entries(updates)) {
            const curr = next[nombre] ?? effective(nombre)
            next[nombre] = { ...curr, costo_unitario: costo }
          }
          return next
        })
        setShowPending(true)
        setImportMsg(`✓ ${matched} costo${matched !== 1 ? 's' : ''} cargado${matched !== 1 ? 's' : ''} a la cola${unmatched ? ` · ${unmatched} sin match` : ''} — revisá y guardá`)
        setTimeout(() => setImportMsg(null), 8000)
      } catch (e) {
        setImportMsg(`✗ ${e instanceof Error ? e.message : 'Error leyendo CSV'}`)
      }
    }
    reader.readAsText(file)
  }

  // ── Exportar plantilla de costos (todos los productos) ───────
  // Genera un CSV con columnas nombre,tipo,clasificacion,costo_unitario que
  // round-trip con el importador: el usuario llena la columna y lo re-importa.
  function exportCostsTemplate() {
    const safe = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
    const header = 'nombre,tipo,clasificacion,costo_unitario'
    const rows = allProds.map(n => {
      const e = effective(n)
      return [safe(n), e.tipo, safe(e.clasificacion), e.costo_unitario].join(',')
    })
    const csv  = [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `satori-costos-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    setImportMsg(`✓ Plantilla con ${allProds.length} productos descargada — llená la columna costo_unitario y re-importá`)
    setTimeout(() => setImportMsg(null), 8000)
  }

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
        {/* Reload button — forces fresh fetch from Supabase */}
        <button
          onClick={onRefresh}
          title="Recargar clasificaciones desde la base de datos"
          style={{ marginLeft:'auto', padding:'5px 12px', borderRadius:2, background:'transparent', border:'1px solid #2a2a2a', color:'#888', fontSize:'0.78rem', cursor:'pointer', display:'flex', alignItems:'center', gap:'0.3rem' }}>
          ↺ Recargar
        </button>
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

      {/* ── Costos de productos: filtro por clasificación + import CSV ─ */}
      <div style={{ display:'flex', gap:'0.5rem', flexWrap:'wrap', alignItems:'center', marginBottom:'0.75rem', padding:'0.6rem 0.75rem', background:'rgba(126,200,160,0.05)', border:'1px solid rgba(126,200,160,0.2)', borderRadius:2 }}>
        <span style={{ fontSize:'0.72rem', fontWeight:700, color:'#7ec8a0', letterSpacing:'0.06em', textTransform:'uppercase' }}>₡ Costos</span>
        {clasOptions.length > 0 && (
          <select value={clasFilter} onChange={e => setClasFilter(e.target.value)}
            style={{ background:'var(--vt-ink)', color:'var(--vt-paper)', border:'1px solid #2a2a2a', padding:'4px 8px', fontSize:'0.78rem', borderRadius:2 }}>
            <option value="">Toda clasificación</option>
            {clasOptions.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <button onClick={exportCostsTemplate}
          style={{ fontSize:'0.78rem', color:'#c8a96e', cursor:'pointer', padding:'4px 10px', border:'1px solid rgba(200,169,110,0.4)', borderRadius:2, background:'transparent' }}>
          ⬇ Exportar plantilla CSV
        </button>
        <label style={{ fontSize:'0.78rem', color:'#7ec8a0', cursor:'pointer', padding:'4px 10px', border:'1px solid rgba(126,200,160,0.4)', borderRadius:2 }}>
          📄 Importar costos CSV
          <input type="file" accept=".csv,text/csv" style={{ display:'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleCostCsv(f); e.target.value = '' }} />
        </label>
        <span style={{ fontSize:'0.68rem', color:'#666' }}>exportá → llená costo_unitario → importá</span>
        {importMsg && (
          <span style={{ fontSize:'0.78rem', fontWeight:600, color: importMsg.startsWith('✓') ? 'var(--vt-green)' : 'var(--vt-red)', marginLeft:'auto' }}>
            {importMsg}
          </span>
        )}
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
            {paged.map(nombre => {
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

      {/* ── Pagination ───────────────────────────────────────── */}
      {filtered.length > PAGE_SIZE && (
        <div style={{ display:'flex', justifyContent:'center', alignItems:'center', gap:'0.75rem', marginTop:'0.75rem' }}>
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={safePage === 0}
            style={{ padding:'4px 12px', borderRadius:2, background:'transparent', border:'1px solid #2a2a2a', color: safePage === 0 ? '#444' : '#aaa', fontSize:'0.78rem', cursor: safePage === 0 ? 'default' : 'pointer' }}>
            ← Anterior
          </button>
          <span style={{ fontSize:'0.75rem', color:'#888' }}>
            Página {safePage + 1} de {pageCount} · {filtered.length} productos
          </span>
          <button onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))} disabled={safePage >= pageCount - 1}
            style={{ padding:'4px 12px', borderRadius:2, background:'transparent', border:'1px solid #2a2a2a', color: safePage >= pageCount - 1 ? '#444' : '#aaa', fontSize:'0.78rem', cursor: safePage >= pageCount - 1 ? 'default' : 'pointer' }}>
            Siguiente →
          </button>
        </div>
      )}

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
