import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getProductsFull, createProduct, saveProductFicha,
  getPrices, upsertPrice,
  getModifierGroups, getModifiers, getProductGroupLinks, linkProductGroup, unlinkProductGroup,
  getProductOptions, saveProductOption,
  getMenuFamilies, getMenuCategories, saveMenuCategory,
} from '../../shared/api/pos'
import type { PosProduct, PosPrice, ModifierGroupRow, ModifierRow, ProductModifierOption, MenuFamily, MenuCategory } from '../../shared/api/pos'
import { splitNetIva, TAX_LABEL } from '../../shared/utils/posFiscal'
import type { TaxType } from '../../shared/utils/posFiscal'
import { uploadProductPhoto, deleteProductPhoto } from '../../shared/api/productPhoto'

const TAX_TYPES: TaxType[] = ['iva13', 'iva4', 'iva2', 'iva1', 'exento']
import { fi } from '../../shared/utils'

type Filtro = 'activos' | 'desactivados' | 'todos'
const inp = 'tips-input-dark'

/** GESTOR DE PRODUCTOS UNIFICADO (refinamiento 06-12, prioridad máxima de la dueña):
 *  todo el ciclo de vida en una pantalla — ficha, precio fiscal, costo/margen,
 *  modificadores POR PRODUCTO (variantes + override de delta), receta, estado.
 *  El nombre es inmutable post-creación (PK del histórico de ventas). */
export default function ProductosAdmin({ locationId, onError }: { locationId: string; onError: (e: string) => void }) {
  const navigate = useNavigate()
  const [products, setProducts] = useState<PosProduct[]>([])
  const [prices, setPrices]     = useState<Map<string, PosPrice>>(new Map())
  const [filtro, setFiltro]     = useState<Filtro>('activos')
  const [q, setQ]               = useState('')
  const [sel, setSel]           = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const [families, setFamilies] = useState<MenuFamily[]>([])
  const [catMap, setCatMap]     = useState<Map<string, MenuCategory>>(new Map())
  const load = useCallback(async () => {
    try {
      const [ps, pr, fam, cats] = await Promise.all([getProductsFull(), getPrices(locationId), getMenuFamilies(), getMenuCategories()])
      setProducts(ps)
      setPrices(new Map(pr.map(p => [p.product_name, p])))
      setFamilies(fam)
      setCatMap(new Map(cats.map(c => [c.category.trim().toUpperCase(), c])))
    } catch (e) { onError(e instanceof Error ? e.message : 'Error cargando productos') }
  }, [locationId, onError])
  useEffect(() => { load() }, [load])

  const setCatFamily = async (category: string, family_id: string | null) => {
    const cur = catMap.get(category.trim().toUpperCase())
    try { await saveMenuCategory({ category, family_id, subfamily: cur?.subfamily ?? '', hidden_comandero: cur?.hidden_comandero ?? false, sort_order: cur?.sort_order ?? 0 }); await load() }
    catch (e) { onError(e instanceof Error ? e.message : 'Error guardando familia') }
  }

  const shown = useMemo(() => products.filter(p =>
    (filtro === 'todos' || (filtro === 'activos' ? p.is_active : !p.is_active))
    && (!q.trim() || p.nombre.toLowerCase().includes(q.toLowerCase()) || p.tipo.toLowerCase().includes(q.toLowerCase())
        || (p.subclasificacion || '').toLowerCase().includes(q.toLowerCase()))
  ), [products, filtro, q])

  const product = products.find(p => p.nombre === sel) ?? null
  const sinPrecio = shown.filter(p => p.is_active && (prices.get(p.nombre)?.price_final_crc ?? null) == null).length

  // Árbol familia → categoría → productos (mig 032). Familias en su orden; 'Sin familia' al final.
  const tree = useMemo(() => {
    const famOrder = [...families].sort((a, b) => a.sort_order - b.sort_order)
    const byCat = new Map<string, PosProduct[]>()
    for (const p of shown) {
      const cat = p.tipo.trim() || 'Otros'
      if (!byCat.has(cat)) byCat.set(cat, [])
      byCat.get(cat)!.push(p)
    }
    const famOf = (cat: string) => catMap.get(cat.trim().toUpperCase())?.family_id ?? null
    const groups: Array<{ family: MenuFamily | null; cats: string[] }> = []
    for (const f of famOrder) {
      const cats = [...byCat.keys()].filter(c => famOf(c) === f.id).sort((a, b) => a.localeCompare(b, 'es-CR'))
      if (cats.length) groups.push({ family: f, cats })
    }
    const sinFam = [...byCat.keys()].filter(c => !famOf(c)).sort((a, b) => a.localeCompare(b, 'es-CR'))
    if (sinFam.length) groups.push({ family: null, cats: sinFam })
    return { groups, byCat }
  }, [shown, families, catMap])

  const ficha = async (nombre: string, fields: Partial<Omit<PosProduct, 'nombre'>>) => {
    try { await saveProductFicha(nombre, fields); await load() }
    catch (e) { onError(e instanceof Error ? e.message : 'Error guardando ficha') }
  }

  // Export CSV según el filtro activo (lo que se ve = lo que se exporta)
  const exportCSV = () => {
    const head = ['nombre', 'categoria', 'subcategoria', 'precio_final_crc', 'impuesto', 'aplica_servicio_10', 'costo', 'margen_%', 'estacion', 'prep_min', 'alergenos', 'activo']
    const rows = shown.map(p => {
      const pr = prices.get(p.nombre)
      const final = pr?.price_final_crc ?? null
      const neto = final != null ? splitNetIva(final, pr?.tax_type ?? 'iva13').neto : null
      const margen = neto && p.costo_unitario ? Math.round((1 - p.costo_unitario / neto) * 1000) / 10 : ''
      return [p.nombre, p.tipo, p.subclasificacion, final ?? '', pr?.tax_type ?? '', p.aplica_servicio ? 'SI' : 'NO',
        p.costo_unitario ?? '', margen, p.station, p.prep_time_min ?? '', p.allergens, p.is_active ? 'SI' : 'NO']
    })
    const csv = [head, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    a.download = `productos-${filtro}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1.1fr) 2fr', gap: '0.875rem' }}>
      <div className="admin-table" style={{ padding: '0.75rem' }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
          {(['activos', 'desactivados', 'todos'] as Filtro[]).map(f => (
            <button key={f} onClick={() => setFiltro(f)}
              style={{ padding: '3px 10px', borderRadius: 12, fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer',
                border: '1px solid var(--t-border,#d4cfc4)', background: filtro === f ? '#0d0d0d' : 'transparent', color: filtro === f ? '#c8a96e' : '#5a5040' }}>{f}</button>
          ))}
          <button onClick={exportCSV} title="Exporta lo filtrado"
            style={{ marginLeft: 'auto', padding: '3px 10px', borderRadius: 3, fontSize: '0.7rem', cursor: 'pointer', border: '1px solid var(--t-border,#d4cfc4)', background: 'transparent', color: '#5a5040' }}>⬇ CSV</button>
        </div>
        <input className={inp} placeholder="Buscar nombre / categoría / subcategoría…" value={q} onChange={e => setQ(e.target.value)} style={{ width: '100%', marginBottom: 6 }} />
        {sinPrecio > 0 && <div style={{ fontSize: '0.7rem', color: '#c23b22', fontWeight: 700, marginBottom: 4 }}>⚠ {sinPrecio} activos sin precio (el comandero no los envía)</div>}
        <button className="cd-btn-green" style={{ width: '100%', marginBottom: 6 }} onClick={() => setCreating(true)}>+ Producto nuevo</button>
        {/* Árbol FAMILIA → categoría → productos (mig 032). La familia de cada
            categoría es editable acá mismo (la dueña reacomoda sin tocar código). */}
        <div style={{ maxHeight: 520, overflowY: 'auto' }}>
          {tree.groups.map(({ family, cats }) => (
            <div key={family?.id ?? 'sin'} style={{ marginBottom: 4 }}>
              <div style={{ position: 'sticky', top: 0, background: '#0d0d0d', color: '#c8a96e', padding: '0.3rem 0.4rem', fontWeight: 800, fontSize: '0.78rem', borderRadius: 3 }}>
                {family ? `${family.icon} ${family.label}` : '📦 Sin familia'}
              </div>
              {cats.map(cat => (
                <div key={cat} style={{ marginBottom: 2 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0.25rem 0.4rem', background: 'rgba(0,0,0,.04)' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.72rem', flex: 1 }}>{cat} <span style={{ color: '#5a5040', fontWeight: 400 }}>({tree.byCat.get(cat)!.length})</span></span>
                    <select value={catMap.get(cat.trim().toUpperCase())?.family_id ?? ''} title="Familia de esta categoría"
                      onChange={e => setCatFamily(cat, e.target.value || null)}
                      style={{ fontSize: '0.66rem', border: '1px solid var(--t-border,#d4cfc4)', borderRadius: 3, padding: '1px 3px', background: 'var(--t-paper,#fff)' }}>
                      <option value="">— sin familia —</option>
                      {families.map(f => <option key={f.id} value={f.id}>{f.icon} {f.label}</option>)}
                    </select>
                  </div>
                  {tree.byCat.get(cat)!.map(p => {
                    const pr = prices.get(p.nombre)
                    const noPrice = (pr?.price_final_crc ?? null) == null
                    return (
                      <div key={p.nombre} onClick={() => setSel(p.nombre)}
                        style={{ padding: '0.3rem 0.4rem 0.3rem 0.8rem', cursor: 'pointer', borderBottom: '1px solid var(--t-border,#eee)', fontSize: '0.8rem',
                          background: sel === p.nombre ? 'rgba(160,120,48,.12)' : 'transparent', opacity: p.is_active ? 1 : 0.5 }}>
                        {noPrice && p.is_active && <span style={{ color: '#c23b22' }}>⚠ </span>}
                        <strong>{p.nombre}</strong>
                        <span style={{ color: '#5a5040', fontSize: '0.66rem' }}>{p.subclasificacion ? ` · ${p.subclasificacion}` : ''}
                          {pr?.price_final_crc != null && ` · ${fi(pr.price_final_crc)}`}{!p.is_active && ' · DESACTIVADO'}</span>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          ))}
          {shown.length === 0 && <div style={{ color: '#5a5040', fontSize: '0.78rem', padding: '0.75rem 0' }}>Sin productos en esta vista.</div>}
        </div>
      </div>

      <div className="admin-table" style={{ padding: '0.75rem' }}>
        {!product && !creating && <div style={{ color: '#5a5040', fontSize: '0.8rem' }}>Elegí un producto de la lista (o creá uno) — acá vive TODO su ciclo de vida: ficha, precio fiscal, costo y margen, modificadores, receta y estado.</div>}
        {creating && <NuevoProducto productos={products} onDone={n => { setCreating(false); load().then(() => setSel(n)) }} onCancel={() => setCreating(false)} onError={onError} />}
        {product && !creating && (
          <FichaProducto key={product.nombre} p={product} price={prices.get(product.nombre)} locationId={locationId}
            onFicha={f => ficha(product.nombre, f)} onPriceSaved={load} onError={onError}
            onReceta={() => navigate('/inventario')} />
        )}
      </div>
    </div>
  )
}

function NuevoProducto({ productos, onDone, onCancel, onError }: {
  productos: PosProduct[]; onDone: (nombre: string) => void; onCancel: () => void; onError: (e: string) => void
}) {
  const [nombre, setNombre] = useState('')
  const [tipo, setTipo]     = useState('')
  const [sub, setSub]       = useState('')
  const tipos = useMemo(() => [...new Set(productos.map(p => p.tipo).filter(Boolean))].sort(), [productos])
  const dup = productos.some(p => p.nombre === nombre.trim().toUpperCase())
  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: 6 }}>Producto nuevo</div>
      <div style={{ fontSize: '0.68rem', color: '#5a5040', marginBottom: 6 }}>⚠ El nombre es <strong>inmutable</strong> después de crear (es la llave del histórico de ventas) — elegilo bien.</div>
      <input className={inp} style={{ width: '100%', marginBottom: 6 }} placeholder="NOMBRE (ej: MOJITO MARACUYÁ)" value={nombre} onChange={e => setNombre(e.target.value.toUpperCase())} />
      {dup && <div style={{ color: '#c23b22', fontSize: '0.72rem', marginBottom: 4 }}>Ya existe un producto con ese nombre.</div>}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <input className={inp} style={{ flex: 1 }} placeholder="Categoría" list="tipos-list" value={tipo} onChange={e => setTipo(e.target.value)} />
        <datalist id="tipos-list">{tipos.map(t => <option key={t} value={t} />)}</datalist>
        <input className={inp} style={{ flex: 1 }} placeholder="Subcategoría (ej: Postres)" value={sub} onChange={e => setSub(e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button className="tips-btn-ghost" onClick={onCancel}>Cancelar</button>
        <button className="cd-btn-green" disabled={!nombre.trim() || !tipo.trim() || dup}
          onClick={() => createProduct({ nombre, tipo: tipo.trim(), subclasificacion: sub.trim() }).then(() => onDone(nombre.trim().toUpperCase())).catch(e => onError(e.message))}>
          ✓ Crear
        </button>
      </div>
    </div>
  )
}

function FichaProducto({ p, price, locationId, onFicha, onPriceSaved, onError, onReceta }: {
  p: PosProduct; price: PosPrice | undefined; locationId: string
  onFicha: (f: Partial<Omit<PosProduct, 'nombre'>>) => void; onPriceSaved: () => void
  onError: (e: string) => void; onReceta: () => void
}) {
  const tax = price?.tax_type ?? 'iva13'
  const final = price?.price_final_crc ?? null
  const { neto, iva } = final != null ? splitNetIva(final, tax) : { neto: 0, iva: 0 }
  const costo = p.costo_unitario ?? null
  const margen = final != null && costo ? Math.round((1 - costo / neto) * 1000) / 10 : null

  const savePrice = (patch: { price_final_crc?: number | null; tax_type?: TaxType }) =>
    upsertPrice({ product_name: p.nombre, location_id: locationId,
      price_final_crc: patch.price_final_crc !== undefined ? patch.price_final_crc : final, tax_type: patch.tax_type ?? tax })
      .then(onPriceSaved).catch(e => onError(e.message))

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: '0.95rem' }}>{p.nombre}</strong>
        <span style={{ fontSize: '0.66rem', color: '#5a5040' }}>(nombre inmutable — llave del histórico)</span>
        <label style={{ marginLeft: 'auto', fontSize: '0.74rem', fontWeight: 700, color: p.is_active ? '#2a7a6a' : '#c23b22' }}>
          <input type="checkbox" checked={p.is_active} onChange={e => {
            if (!e.target.checked && !window.confirm(`¿Desactivar "${p.nombre}"? Deja de aparecer en el comandero (el histórico no se toca). "Eliminar" = esto.`)) return
            onFicha({ is_active: e.target.checked })
          }} /> {p.is_active ? 'activo' : 'desactivado'}
        </label>
      </div>

      <div style={{ display: 'flex', gap: 6, margin: '6px 0' }}>
        <input className={inp} style={{ flex: 1 }} defaultValue={p.tipo} placeholder="Categoría" onBlur={e => e.target.value !== p.tipo && onFicha({ tipo: e.target.value })} />
        <input className={inp} style={{ flex: 1 }} defaultValue={p.subclasificacion} placeholder="Subcategoría" onBlur={e => e.target.value !== p.subclasificacion && onFicha({ subclasificacion: e.target.value })} />
      </div>

      {/* Foto del menú (mig 030) — se ve en el tile del comandero. Cámara en móvil. */}
      <FotoProducto p={p} onFicha={onFicha} onError={onError} />


      {/* Precio fiscal */}
      <div style={{ border: '1px solid var(--t-border,#d4cfc4)', borderRadius: 4, padding: '0.5rem', margin: '6px 0' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.74rem', fontWeight: 700 }}>Precio final (IVA incl.)</span>
          ₡<input type="number" className={inp} style={{ width: 100 }} defaultValue={final ?? ''} placeholder="—"
            onBlur={e => { const v = e.target.value.trim() === '' ? null : Math.max(0, Number(e.target.value) || 0); if (v !== final) savePrice({ price_final_crc: v }) }} />
          <select className={inp} value={tax} onChange={e => savePrice({ tax_type: e.target.value as TaxType })}>
            {TAX_TYPES.map(t => <option key={t} value={t}>{TAX_LABEL[t]}</option>)}
          </select>
          <span style={{ fontSize: '0.72rem', color: '#5a5040' }}>neto {final != null ? fi(neto) : '—'} · IVA {final != null ? fi(iva) : '—'} <em>(derivado)</em></span>
        </div>
        <label style={{ fontSize: '0.74rem', display: 'block', marginTop: 4 }}>
          <input type="checkbox" checked={p.aplica_servicio} onChange={e => onFicha({ aplica_servicio: e.target.checked })} />{' '}
          Aplica impuesto de <strong>servicio 10%</strong> (destildar p.ej. merchandising · delivery nunca lo aplica)
        </label>
      </div>

      {/* Costo y margen + receta */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '6px 0' }}>
        <span style={{ fontSize: '0.74rem', fontWeight: 700 }}>Costo</span>
        ₡<input type="number" className={inp} style={{ width: 90 }} defaultValue={costo ?? ''} placeholder="—"
          onBlur={e => { const v = e.target.value.trim() === '' ? null : Math.max(0, Number(e.target.value) || 0); if (v !== costo) onFicha({ costo_unitario: v }) }} />
        <span style={{ fontSize: '0.72rem', color: margen != null && margen < 50 ? '#c23b22' : '#2a7a6a', fontWeight: 700 }}>
          {margen != null ? `margen ${margen}% (sobre neto)` : 'margen — (falta precio o costo)'}
        </span>
        <button className="tips-btn-ghost" onClick={onReceta} title="El costo de receta pisa la carga rápida">🧾 Crear/editar receta</button>
      </div>

      {/* Ficha gastronómica */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '6px 0' }}>
        <label style={{ fontSize: '0.74rem' }}>Estación
          <select className={inp} style={{ marginLeft: 4 }} value={p.station} onChange={e => onFicha({ station: e.target.value as PosProduct['station'] })}>
            <option value="cocina">cocina</option><option value="barra">barra</option><option value="ninguna">ninguna</option>
          </select>
        </label>
        <label style={{ fontSize: '0.74rem' }}>Prep (min)
          <input type="number" className={inp} style={{ width: 60, marginLeft: 4 }} defaultValue={p.prep_time_min ?? ''}
            onBlur={e => { const v = e.target.value.trim() === '' ? null : Math.max(0, Number(e.target.value) || 0); if (v !== p.prep_time_min) onFicha({ prep_time_min: v }) }} />
        </label>
        <label style={{ fontSize: '0.74rem', flex: 1, minWidth: 160 }}>Alérgenos
          <input className={inp} style={{ width: '100%', marginTop: 2 }} defaultValue={p.allergens} placeholder="ej: maní, gluten, mariscos"
            onBlur={e => e.target.value !== p.allergens && onFicha({ allergens: e.target.value })} />
        </label>
      </div>

      {/* Códigos fiscales (FE estructura, mig 036) — los confirma la contadora */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '6px 0' }}>
        <span style={{ fontSize: '0.74rem', fontWeight: 700 }}>Fiscal</span>
        <label style={{ fontSize: '0.74rem' }}>CIIU
          <input className={inp} style={{ width: 90, marginLeft: 4 }} defaultValue={p.ciiu ?? ''} placeholder="—"
            onBlur={e => { const v = e.target.value.trim() === '' ? null : e.target.value.trim(); if (v !== p.ciiu) onFicha({ ciiu: v }) }} />
        </label>
        <label style={{ fontSize: '0.74rem' }}>CABYS
          <input className={inp} style={{ width: 130, marginLeft: 4 }} defaultValue={p.cabys ?? ''} placeholder="—"
            onBlur={e => { const v = e.target.value.trim() === '' ? null : e.target.value.trim(); if (v !== p.cabys) onFicha({ cabys: v }) }} />
        </label>
        {(!p.ciiu || !p.cabys) && (
          <span style={{ fontSize: '0.72rem', color: '#c2861f', fontWeight: 700 }}>⚠ pendiente de código fiscal</span>
        )}
      </div>

      <ModificadoresDelProducto productName={p.nombre} locationId={locationId} onError={onError} />
    </div>
  )
}

/** Modelo de la dueña: el grupo se define una vez; ACÁ se elige qué grupos lleva
 *  este producto, cuáles variantes aplican y el override de delta por producto. */
function ModificadoresDelProducto({ productName, locationId, onError }: { productName: string; locationId: string; onError: (e: string) => void }) {
  const [groups, setGroups] = useState<ModifierGroupRow[]>([])
  const [mods, setMods]     = useState<ModifierRow[]>([])
  const [links, setLinks]   = useState<Set<string>>(new Set())
  const [opts, setOpts]     = useState<Map<string, ProductModifierOption>>(new Map())

  const load = useCallback(async () => {
    try {
      const gs = await getModifierGroups(locationId)
      setGroups(gs.filter(g => g.is_active))
      setMods(await getModifiers(gs.map(g => g.id)))
      setLinks(new Set((await getProductGroupLinks()).filter(l => l.product_name === productName).map(l => l.group_id)))
      setOpts(new Map((await getProductOptions(productName)).map(o => [o.modifier_id, o])))
    } catch (e) { onError(e instanceof Error ? e.message : 'Error cargando modificadores') }
  }, [productName, locationId, onError])
  useEffect(() => { load() }, [load])

  const toggleGroup = (g: ModifierGroupRow, on: boolean) =>
    (on ? linkProductGroup(productName, g.id) : unlinkProductGroup(productName, g.id)).then(load).catch(e => onError(e.message))

  const setOpt = (modifier_id: string, patch: Partial<ProductModifierOption>) => {
    const cur = opts.get(modifier_id) ?? { product_name: productName, modifier_id, enabled: true, price_delta_override_crc: null }
    saveProductOption({ ...cur, ...patch }).then(load).catch(e => onError(e.message))
  }

  return (
    <div style={{ border: '1px solid var(--t-border,#d4cfc4)', borderRadius: 4, padding: '0.5rem', marginTop: 8 }}>
      <div style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: 4 }}>Modificadores de este producto</div>
      {groups.length === 0 && <div style={{ fontSize: '0.72rem', color: '#5a5040' }}>No hay grupos definidos — crealos una vez en la pestaña "🍹 Catálogo PoS" y asignalos acá.</div>}
      {groups.map(g => {
        const linked = links.has(g.id)
        const gmods = mods.filter(m => m.group_id === g.id && m.is_active)
        return (
          <div key={g.id} style={{ marginBottom: 6 }}>
            <label style={{ fontSize: '0.78rem', fontWeight: 700 }}>
              <input type="checkbox" checked={linked} onChange={e => toggleGroup(g, e.target.checked)} />{' '}
              {g.name} {g.required && <span style={{ color: '#c23b22', fontSize: '0.66rem' }}>obligatorio</span>}
            </label>
            {linked && gmods.map(m => {
              const o = opts.get(m.id)
              const enabled = o?.enabled ?? true
              const override = o?.price_delta_override_crc ?? null
              return (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 18, padding: '2px 0', fontSize: '0.76rem' }}>
                  <label style={{ flex: 1, opacity: enabled ? 1 : 0.45 }}>
                    <input type="checkbox" checked={enabled} onChange={e => setOpt(m.id, { enabled: e.target.checked })} /> {m.name}
                  </label>
                  <span style={{ color: '#5a5040', fontSize: '0.68rem' }}>default +{fi(m.price_delta_crc)}</span>
                  <span style={{ fontSize: '0.68rem' }}>override ₡</span>
                  <input type="number" className={inp} style={{ width: 80 }} defaultValue={override ?? ''} placeholder="—" disabled={!enabled}
                    onBlur={e => { const v = e.target.value.trim() === '' ? null : Number(e.target.value) || 0; if (v !== override) setOpt(m.id, { price_delta_override_crc: v }) }} />
                </div>
              )
            })}
          </div>
        )
      })}
      <div style={{ fontSize: '0.64rem', color: '#5a5040' }}>El comandero solo ofrece las variantes habilitadas; el override pisa el delta default SOLO en este producto.</div>
    </div>
  )
}

/** Foto del producto (mig 030): preview + subir/cambiar/quitar. Cámara directa en
 *  móvil (capture) y archivo en desktop; se comprime a thumbnail antes de subir. */
function FotoProducto({ p, onFicha, onError }: {
  p: PosProduct; onFicha: (f: Partial<Omit<PosProduct, 'nombre'>>) => void; onError: (e: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const onPick = async (file: File | undefined) => {
    if (!file || busy) return
    setBusy(true)
    try {
      const url = await uploadProductPhoto(p.nombre, file)
      if (p.photo_url) deleteProductPhoto(p.photo_url).catch(() => {})   // best-effort: borra la anterior
      onFicha({ photo_url: url })
    } catch (e) { onError(e instanceof Error ? e.message : 'No se pudo subir la foto') }
    finally { setBusy(false) }
  }
  const quitar = async () => {
    if (!p.photo_url || busy) return
    setBusy(true)
    try { deleteProductPhoto(p.photo_url).catch(() => {}); onFicha({ photo_url: null }) }
    finally { setBusy(false) }
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '6px 0' }}>
      {p.photo_url
        ? <img src={p.photo_url} alt={p.nombre} style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--t-border,#d4cfc4)' }} />
        : <span style={{ width: 56, height: 56, borderRadius: 6, border: '1px dashed var(--t-border,#d4cfc4)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem', color: '#8a8378' }}>🍽️</span>}
      <label style={{ cursor: 'pointer', fontSize: '0.76rem', fontWeight: 700, color: '#5a5040', border: '1px solid var(--t-border,#d4cfc4)', borderRadius: 6, padding: '8px 12px', minHeight: 40, display: 'inline-flex', alignItems: 'center' }}>
        {busy ? 'Subiendo…' : p.photo_url ? '📷 Cambiar foto' : '📷 Agregar foto'}
        <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} disabled={busy}
          onChange={e => { onPick(e.target.files?.[0]); e.target.value = '' }} />
      </label>
      {p.photo_url && <button type="button" onClick={quitar} disabled={busy}
        style={{ background: 'none', border: '1px solid #e0b0b0', color: '#c0392b', borderRadius: 6, padding: '8px 12px', minHeight: 40, fontSize: '0.74rem', cursor: 'pointer' }}>Quitar</button>}
    </div>
  )
}
