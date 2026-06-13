import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../shared/hooks/useAuth'
import { useManagerOverride } from '../../shared/ManagerOverride'
import { useRealtimeRefetch } from '../../shared/hooks/useRealtimeRefetch'
import {
  getLocations, getSalonTables, getOpenOrders, openOrder, updateOrderPax,
  getOrderItems, addOrderItem, updateItemCourse, deleteOrderItem, marchar,
  getProductGroups, getPriceMap, getProductMetaMap,
  unmarchar, cancelEmptyOrder, appendOrderNote,
  getOrderChecks, clearOrderChecks,
  voidOrderItem, unmergeOrder, VOID_REASONS,
} from '../../shared/api/pos'
import type { PosCheck } from '../../shared/api/pos'
import type { PosLocation, SalonTable, PosOrder, PosOrderItem, PosPrice } from '../../shared/api/pos'
import { defaultCourseForTipo, nextCourse } from '../../shared/utils/posPricing'
import type { PosCourse } from '../../shared/utils/posPricing'
import { computeTotals } from '../../shared/utils/posFiscal'
import { fi } from '../../shared/utils'
import { toBillItem, COURSE_LABEL, KS_LABEL, CierreTurnoModal, PaxModal, Tile, QtyPopup, EmptyState } from './comanderoShared'
import { ReabrirModal, ReorderModal, MergeModal, TransferModal, CuentaView, SplitModal, CheckoutModal, ItemPicker } from './comanderoModals'
import { buildMenuTree, searchTiles } from '../../shared/utils/comanderoMenu'
import type { CatMap, FamilyDef } from '../../shared/utils/comanderoMenu'
import { getMenuFamilies, getMenuCategories } from '../../shared/api/pos'


/** PoS F2 — Comandero de tablet: plano del salón → mesa con pax OBLIGATORIO ≥1 →
 *  pedido con modificadores (obligatorios bloquean) → cursos → marchar por partes. */
export default function ComanderoModule() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [locations, setLocations] = useState<PosLocation[]>([])
  const [loc, setLoc]             = useState('santa-teresa')
  const [tables, setTables]       = useState<SalonTable[]>([])
  const [orders, setOrders]       = useState<PosOrder[]>([])
  const [sel, setSel]             = useState<PosOrder | null>(null)   // pedido abierto en pantalla
  const [error, setError]         = useState<string | null>(null)
  const [paxModal, setPaxModal]   = useState<{ table: SalonTable | null; editOrder: PosOrder | null } | null>(null)
  const [priceMap, setPriceMap]   = useState<Map<string, PosPrice>>(new Map())
  const [showCierre, setShowCierre] = useState(false)
  const [showReabrir, setShowReabrir] = useState(false)   // reabrir orden cerrada (F20)
  const [loadingPlano, setLoadingPlano] = useState(true)  // T3: estado de carga del plano

  const load = useCallback(async () => {
    try {
      setTables(await getSalonTables(loc))
      const os = await getOpenOrders(loc)
      setOrders(os)
      setSel(prev => prev ? os.find(o => o.id === prev.id) ?? null : prev)
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo cargar el salón. Revisá la conexión y reintentá.') }
    finally { setLoadingPlano(false) }
  }, [loc])
  useEffect(() => {
    getLocations().then(setLocations).catch(() => { /* selector queda con default */ })
    getPriceMap(loc).then(setPriceMap).catch(() => { /* sin precios: el ítem se bloquea al enviar */ })
    load()
  }, [load, loc])
  useRealtimeRefetch('rt-comandero', ['pos_orders', 'pos_order_items', 'salon_tables'], load)

  const orderByTable = useMemo(() => new Map(orders.map(o => [o.table_id, o])), [orders])

  const abrirMesa = async (pax: number) => {
    if (!paxModal || !profile) return
    try {
      if (paxModal.editOrder) {
        const oldPax = paxModal.editOrder.pax
        await updateOrderPax(paxModal.editOrder.id, pax)
        // Traza liviana (SPEC C4/D3): quién y cuándo corrigió el pax — en notes, cero DDL.
        if (oldPax !== pax) {
          appendOrderNote(paxModal.editOrder.id,
            `pax ${oldPax}→${pax} · ${profile.full_name ?? ''} · ${new Date().toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' })}`,
          ).catch(() => { /* la traza nunca bloquea la operación */ })
        }
      } else if (paxModal.table) {
        const o = await openOrder({
          location_id: loc, table_id: paxModal.table.id, table_name: paxModal.table.name,
          opened_by: profile.id, salonero_name: profile.full_name ?? '', pax,
        })
        setSel(o)
      }
      setPaxModal(null); load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Error abriendo mesa') }
  }

  return (
    <div className="tips-module" style={{ minHeight: '100vh' }}>
      <header className="vt-header" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem' }}>
        <span style={{ fontFamily: 'var(--font-serif)', fontSize: '1.4rem' }}>卓</span>
        <h1 style={{ fontSize: '1rem', margin: 0 }}>Comandero</h1>
        <select className="tips-input-dark" value={loc} onChange={e => { setSel(null); setLoc(e.target.value) }}>
          {(locations.length ? locations : [{ id: loc, name: loc, is_active: true }]).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <button onClick={() => setShowReabrir(true)} title="Reabrir una mesa ya cerrada (requiere gerencia)"
          style={{ marginLeft: 'auto', background: 'none', border: '1px solid #333', color: '#c8a96e', borderRadius: 3, padding: '4px 12px', cursor: 'pointer' }}>
          ↺ Reabrir
        </button>
        <button onClick={() => setShowCierre(true)} title="Chequear cierre de turno"
          style={{ background: 'none', border: '1px solid #333', color: '#c8a96e', borderRadius: 3, padding: '4px 12px', cursor: 'pointer' }}>
          🔒 Cierre de turno
        </button>
        <button onClick={() => navigate('/')} style={{ background: 'none', border: '1px solid #333', color: '#c8a96e', borderRadius: 3, padding: '4px 12px', cursor: 'pointer' }}>← Inicio</button>
      </header>
      {error && <div style={{ color: '#c23b22', padding: '0.5rem 1rem', fontSize: '0.8rem' }} onClick={() => setError(null)}>⚠ {error} (tocá para cerrar)</div>}

      {!sel && (
        <div style={{ position: 'relative', minHeight: 520, margin: '0.75rem', background: '#f5f0e8', borderRadius: 6, overflow: 'auto' }}>
          {tables.filter(t => t.is_active).map(t => {
            const o = orderByTable.get(t.id)
            const decor = t.kind === 'decor'   // barra/macetero/pared: decorativo, NO abre pedidos
            const w = t.width ?? (t.shape === 'bar' ? 96 : 72)
            const h = t.height ?? (t.shape === 'bar' ? 40 : 72)
            return (
              <div key={t.id}
                onClick={decor ? undefined : () => o ? setSel(o) : setPaxModal({ table: t, editOrder: null })}
                style={{ position: 'absolute', left: t.pos_x, top: t.pos_y, cursor: decor ? 'default' : 'pointer',
                  width: w, height: h,
                  borderRadius: decor ? 4 : (t.shape === 'round' ? '50%' : 8),
                  background: decor ? '#d8d2c4' : o ? '#a04030' : '#2a7a6a',
                  color: decor ? '#5a5040' : '#fff',
                  border: decor ? '2px dashed #8a8378' : '2px solid #0d0d0d',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.66rem', fontWeight: 700, userSelect: 'none', overflow: 'hidden' }}>
                <div>{t.name}</div>
                {!decor && <div style={{ fontWeight: 400 }}>{o ? `${o.pax} pax · abierta` : `${t.capacity} pax`}</div>}
              </div>
            )
          })}
          {loadingPlano && tables.length === 0 && (
            <EmptyState icon="⏳" title="Cargando salón…" />
          )}
          {!loadingPlano && tables.filter(t => t.is_active).length === 0 && (
            <EmptyState tone="satori" icon="🪑" title="Sin mesas en este local" hint="Armá el salón en Admin → 🍣 PoS → Editor de Salón." />
          )}
        </div>
      )}

      {sel && (
        <OrderScreen order={sel} priceMap={priceMap} cajeroName={profile?.full_name ?? ''} onBack={() => { setSel(null); load() }} onError={setError}
          onEditPax={() => setPaxModal({ table: null, editOrder: sel })} />
      )}

      {paxModal && <PaxModal initial={paxModal.editOrder?.pax ?? null} onCancel={() => setPaxModal(null)} onConfirm={abrirMesa} />}
      {showCierre && <CierreTurnoModal openTables={orders.map(o => o.table_name)} onClose={() => setShowCierre(false)} />}
      {showReabrir && <ReabrirModal loc={loc} onClose={() => setShowReabrir(false)}
        onReopened={o => { setShowReabrir(false); load(); setSel(o) }} onError={setError} />}
    </div>
  )
}

/** Chequeo de cierre de turno (regla de la dueña): el turno mañana puede cerrar
 *  con mesas abiertas; el último turno NO. Informativo — no toca la Caja. */
function OrderScreen({ order, priceMap, cajeroName, onBack, onError, onEditPax }: {
  // (meta de productos para snapshots de estación/subcategoría/servicio)
  order: PosOrder; priceMap: Map<string, PosPrice>; cajeroName: string; onBack: () => void; onError: (e: string) => void; onEditPax: () => void
}) {
  const { profile } = useAuth()
  const profileId = profile?.id ?? null
  const [metaMap, setMetaMap] = useState<Map<string, { tipo: string; subclasificacion: string; station: string; aplica_servicio: boolean; photo_url: string | null; allergens: string }>>(new Map())
  // Jerarquía de menú (mig 032): familias + mapeo categoría→familia
  const [families, setFamilies] = useState<FamilyDef[]>([])
  const [catMap, setCatMap]     = useState<Map<string, CatMap>>(new Map())
  useEffect(() => {
    getProductMetaMap().then(setMetaMap).catch(() => { /* snapshots con defaults */ })
    getMenuFamilies().then(setFamilies).catch(() => { /* sin familias: cae a 'otros' */ })
    getMenuCategories().then(cs => setCatMap(new Map(cs.map(c => [c.category.trim().toUpperCase(), { family_id: c.family_id, hidden_comandero: c.hidden_comandero, sort_order: c.sort_order }])))).catch(() => {})
  }, [])
  const [items, setItems]   = useState<PosOrderItem[]>([])
  const [search, setSearch] = useState('')
  const [picking, setPicking] = useState<{ nombre: string; tipo: string } | null>(null)
  const [showBill, setShowBill] = useState(false)
  const [showCheckout, setShowCheckout] = useState<{ check: PosCheck | null } | null>(null)
  const [showTransfer, setShowTransfer] = useState(false)
  const [checks, setChecks] = useState<PosCheck[]>([])
  const [showSplit, setShowSplit] = useState(false)
  // Navegación 3 niveles (mig 032): familia → categoría → productos
  const [fam, setFam]           = useState<string | null>(null)   // familia activa (null = mostrar familias)
  const [cat, setCat]           = useState<string | null>(null)   // categoría activa dentro de la familia
  // Asiento/curso ACTIVO global (patrón Lavu "Active Seat/Course"): el quick-add del
  // grid lo respeta, así CUALQUIER producto (con o sin modificadores) cae en el asiento
  // y curso elegidos sin abrir el picker. T2 del sprint carta-real.
  const [activeSeat, setActiveSeat]     = useState(1)
  const [activeCourse, setActiveCourse] = useState<PosCourse | null>(null)  // null = curso por tipo
  const [undo, setUndo]         = useState<{ ids: string[]; until: number } | null>(null)
  const [nowTs, setNowTs]       = useState(() => Date.now())
  const [editItem, setEditItem] = useState<PosOrderItem | null>(null)
  const [adding, setAdding]     = useState<string | null>(null)   // tile en quick-add (feedback)
  const [qtyPopup, setQtyPopup] = useState<{ nombre: string; tipo: string } | null>(null)  // mini-popup cantidad (T3)
  const [voiding, setVoiding]   = useState<PosOrderItem | null>(null)  // ítem enviado a anular (T2)
  const [showReorder, setShowReorder] = useState(false)               // otra ronda (T3)
  const [showMerge, setShowMerge]     = useState(false)               // combinar mesas (T1)
  const requireManager = useManagerOverride()
  useEffect(() => {
    if (!undo) return
    const t = window.setInterval(() => setNowTs(Date.now()), 500)
    return () => window.clearInterval(t)
  }, [undo])
  const tree = useMemo(() => buildMenuTree(metaMap, priceMap, families, catMap), [metaMap, priceMap, families, catMap])
  const searchResults = useMemo(() => searchTiles(metaMap, priceMap, catMap, search), [metaMap, priceMap, catMap, search])
  // Total SIEMPRE visible mientras se comanda (SPEC C5) — misma matemática que la cuenta.
  const totals = computeTotals(items.map(toBillItem), order.channel)
  // Mesas combinadas EN esta: ids de origen presentes en los ítems (para des-combinar).
  const mergedFrom = useMemo(() => [...new Set(items.map(i => i.merged_from_order).filter((x): x is string => !!x))], [items])
  const enviados = items.filter(i => i.kitchen_status !== 'pendiente')   // elegibles para ronda/void

  const load = useCallback(() => {
    // Los ítems ANULADOS (T2) no se muestran ni cuentan; la traza queda en la base.
    getOrderItems(order.id).then(rows => setItems(rows.filter(r => r.kitchen_status !== 'anulado'))).catch(e => onError(e.message))
    getOrderChecks(order.id).then(setChecks).catch(() => { /* sin split */ })
  }, [order.id, onError])
  useEffect(() => { load() }, [load])
  // T2.2: NO refrescar la lista mientras hay un modal abierto (no pisarle al salonero lo
  // que está editando). El refetch se pospone hasta cerrar el modal (reintenta cada 4s).
  const modalOpen = !!(picking || editItem || qtyPopup || showBill || showCheckout || showTransfer || showSplit || showReorder || showMerge || voiding)
  useRealtimeRefetch(`rt-order-${order.id}`, ['pos_order_items', 'pos_checks'], load, { pauseWhile: () => modalOpen })

  // T2 — anular un ítem ya enviado: permiso de gerencia + motivo obligatorio.
  const doVoid = async (it: PosOrderItem, reason: string) => {
    if (!(await requireManager())) { setVoiding(null); return }
    if (!profileId) return
    try {
      await voidOrderItem(it.id, reason, profileId)
      appendOrderNote(order.id, `anuló ${it.product_name} (enviado) · ${reason} · ${new Date().toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' })}`).catch(() => {})
      setVoiding(null); load()
    } catch (e) { onError(e instanceof Error ? e.message : 'No se pudo anular el ítem') }
  }

  const pendientes = (c: PosCourse | null) => items.filter(i => i.kitchen_status === 'pendiente' && (!c || i.course === c)).length
  // Marchar devuelve los ids → ventana de gracia de 20s para DESHACER (SPEC C2).
  const doMarchar = (c: PosCourse | null) =>
    marchar(order.id, c)
      .then(ids => { if (ids.length) setUndo({ ids, until: Date.now() + 20_000 }); load() })
      .catch(e => onError(e instanceof Error ? e.message : 'Error al marchar'))
  const doUndo = async () => {
    if (!undo) return
    try {
      await unmarchar(undo.ids)
      appendOrderNote(order.id, `deshizo marchar (${undo.ids.length} ítem/s) · ${new Date().toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' })}`)
        .catch(() => { /* la traza nunca bloquea */ })
      setUndo(null); load()
    } catch (e) { onError(e instanceof Error ? e.message : 'No se pudo deshacer el marchar') }
  }

  // Tap en el tile: si el producto tiene modificadores OBLIGATORIOS abre el picker
  // (que ya trae cantidad); si NO, abre el mini-popup de cantidad (default 1, un tap
  // confirma). Así CUALQUIER producto deja elegir cantidad — un solo comportamiento.
  const quickAdd = async (nombre: string) => {
    const m = metaMap.get(nombre); const pr = priceMap.get(nombre)
    if (!m || !pr || pr.price_final_crc == null || adding) return
    setAdding(nombre)
    try {
      const groups = await getProductGroups(nombre)
      if (groups.some(g => g.required)) { setPicking({ nombre, tipo: m.tipo }); return }
      setQtyPopup({ nombre, tipo: m.tipo })   // mini-popup de cantidad (T3)
    } catch (e) { onError(e instanceof Error ? e.message : 'Error abriendo el producto') }
    finally { setAdding(null) }
  }

  // Alta directa con cantidad (desde el mini-popup): respeta asiento/curso activo.
  const addDirect = async (nombre: string, qty: number) => {
    const m = metaMap.get(nombre); const pr = priceMap.get(nombre)
    if (!m || !pr || pr.price_final_crc == null) return
    try {
      await addOrderItem({
        order_id: order.id, product_name: nombre, qty: Math.max(1, qty),
        base_price_crc: pr.price_final_crc, modifiers: [],
        price_crc: pr.price_final_crc, tax_type: pr.tax_type ?? 'iva13',
        seat: Math.min(activeSeat, order.pax),
        course: activeCourse ?? defaultCourseForTipo(m.tipo),
        station: (m.station as 'cocina' | 'barra' | 'ninguna') ?? 'cocina',
        subcategory: m.subclasificacion ?? '', aplica_servicio: m.aplica_servicio ?? true,
      })
      setQtyPopup(null); load()
    } catch (e) { onError(e instanceof Error ? e.message : 'Error agregando el ítem') }
  }

  // Cancelar una mesa abierta por error (SPEC C1) — solo sin ítems (D2).
  const cancelMesa = async () => {
    if (!window.confirm(`¿Cancelar ${order.table_name}? La mesa no tiene ítems y desaparece del plano.`)) return
    try { await cancelEmptyOrder(order.id); onBack() }
    catch (e) { onError(e instanceof Error ? e.message : 'No se pudo cancelar la mesa') }
  }

  return (
    <div style={{ padding: '0.75rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button className="tips-btn-ghost" onClick={onBack}>← Salón</button>
        <strong>{order.table_name}</strong>
        <button onClick={onEditPax} title="Editar pax"
          style={{ background: '#0d0d0d', color: '#c8a96e', border: 'none', borderRadius: 12, padding: '3px 12px', fontWeight: 800, cursor: 'pointer' }}>
          👥 {order.pax} pax ✎
        </button>
        <span style={{ fontSize: '0.7rem', color: '#5a5040' }} title="Salonero a cargo (atribución de métricas)">{order.salonero_name}</span>
        {/* Menú maestro de la orden (patrón Lavu): combinar / otra ronda / transferir */}
        <button onClick={() => setShowMerge(true)} title="Combinar con otra mesa abierta"
          style={{ marginLeft: 'auto', background: 'none', border: '1px solid #5a5040', color: '#5a5040', borderRadius: 4, padding: '4px 10px', fontWeight: 700, cursor: 'pointer' }}>
          ⧉ Combinar
        </button>
        {mergedFrom.length > 0 && (
          <button onClick={async () => { try { for (const f of mergedFrom) await unmergeOrder(order.id, f); load() } catch (e) { onError(e instanceof Error ? e.message : 'Error') } }}
            title="Deshacer la combinación de mesas"
            style={{ background: 'none', border: '1px solid #a07030', color: '#a07030', borderRadius: 4, padding: '4px 10px', fontWeight: 700, cursor: 'pointer' }}>
            ↩ Separar
          </button>
        )}
        <button onClick={() => setShowReorder(true)} disabled={!enviados.length} title="Otra ronda de lo ya enviado (barra)"
          style={{ background: 'none', border: '1px solid #5a5040', color: '#5a5040', borderRadius: 4, padding: '4px 10px', fontWeight: 700, cursor: 'pointer', opacity: enviados.length ? 1 : 0.4 }}>
          🔁 Otra ronda
        </button>
        <button onClick={() => setShowTransfer(true)} title="Transferir la mesa a otro salonero"
          style={{ background: 'none', border: '1px solid #5a5040', color: '#5a5040', borderRadius: 4, padding: '4px 10px', fontWeight: 700, cursor: 'pointer' }}>
          ↔ Transferir
        </button>
        <button className="cm-tap" onClick={() => setShowBill(true)} disabled={!items.length} title="Ver la cuenta de la mesa"
          style={{ background: '#2a7a6a', color: '#fff', border: 'none', borderRadius: 4, padding: '10px 14px', minHeight: 44, fontWeight: 700, cursor: 'pointer', opacity: items.length ? 1 : 0.4 }}>
          🧾 Cuenta
        </button>
        {/* Total SIEMPRE visible mientras se comanda (SPEC C5) */}
        <span title="Total con servicio e IVA — igual que la cuenta"
          style={{ background: '#0d0d0d', color: '#c8a96e', borderRadius: 4, padding: '8px 12px', fontWeight: 800, fontSize: '0.92rem', fontVariantNumeric: 'tabular-nums' }}>
          {fi(totals.total)}
        </span>
        {items.length === 0 && (
          <button className="cm-tap" onClick={cancelMesa} title="La mesa se abrió por error — cancelarla (solo sin ítems)"
            style={{ background: 'none', border: '1px solid #e0b0b0', color: '#c0392b', borderRadius: 4, padding: '8px 12px', minHeight: 44, fontWeight: 700, cursor: 'pointer' }}>
            ✕ Cancelar mesa
          </button>
        )}
      </div>

      {/* Asiento/curso ACTIVO (Lavu): aplica a lo que agregás desde el grid o la búsqueda,
          tenga o no modificadores. Editable después tocando el ítem. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '0.5rem 0', padding: '0.4rem 0.6rem', background: 'rgba(200,169,110,.1)', borderRadius: 6 }}>
        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#5a5040' }}>Asiento</span>
        <div style={{ display: 'flex', gap: 3 }}>
          {Array.from({ length: order.pax }, (_, i) => i + 1).map(n => (
            <button key={n} className="cm-tap" onClick={() => setActiveSeat(n)}
              style={{ minWidth: 36, minHeight: 36, borderRadius: 6, cursor: 'pointer', fontWeight: 800, fontSize: '0.8rem',
                border: '1px solid var(--t-border,#d4cfc4)', background: activeSeat === n ? '#2a7a6a' : '#fff', color: activeSeat === n ? '#fff' : '#5a5040' }}>{n}</button>
          ))}
        </div>
        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#5a5040', marginLeft: 6 }}>Curso</span>
        <div style={{ display: 'flex', gap: 3 }}>
          {([['auto', null], ['bebida', 'bebida'], ['entrada', 'entrada'], ['principal', 'principal']] as const).map(([label, val]) => (
            <button key={label} className="cm-tap" onClick={() => setActiveCourse(val)}
              style={{ minHeight: 36, padding: '0 10px', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: '0.74rem',
                border: '1px solid var(--t-border,#d4cfc4)', background: activeCourse === val ? '#0d0d0d' : '#fff', color: activeCourse === val ? '#c8a96e' : '#5a5040' }}>
              {val ? COURSE_LABEL[val] : 'auto'}
            </button>
          ))}
        </div>
      </div>

      {/* Búsqueda transversal (a todas las familias) */}
      <div style={{ position: 'relative', margin: '0.625rem 0' }}>
        <input className="tips-input-dark" style={{ width: '100%' }} placeholder="Buscar producto en toda la carta…"
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* Navegación 3 niveles (mig 032): FAMILIA → categoría → productos.
          Si hay búsqueda activa, muestra resultados transversales (ignora la navegación). */}
      {search.trim().length >= 2 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))', gap: 8, marginBottom: '0.75rem' }}>
          {searchResults.map(t => <Tile key={t.nombre} t={t} busy={adding === t.nombre} onAdd={() => { quickAdd(t.nombre); setSearch('') }} />)}
          {searchResults.length === 0 && <EmptyState tone="satori" icon="🔍" title={`Sin resultados para «${search}»`} hint="Probá con otro nombre o mirá las familias." />}
        </div>
      ) : (
        <>
          {/* Breadcrumb / volver */}
          {(fam || cat) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '4px 0', fontSize: '0.8rem', flexWrap: 'wrap' }}>
              <button className="cm-tap" onClick={() => { setFam(null); setCat(null) }}
                style={{ minHeight: 40, padding: '0 12px', borderRadius: 6, border: '1px solid var(--t-border,#d4cfc4)', background: '#fff', cursor: 'pointer', fontWeight: 700 }}>← Familias</button>
              {fam && <><span style={{ color: '#5a5040' }}>{tree.families.find(f => f.id === fam)?.icon} {tree.families.find(f => f.id === fam)?.label}</span>
                {cat && <button className="cm-tap" onClick={() => setCat(null)} style={{ minHeight: 40, padding: '0 12px', borderRadius: 6, border: '1px solid var(--t-border,#d4cfc4)', background: '#fff', cursor: 'pointer' }}>‹ {cat}</button>}</>}
            </div>
          )}

          {/* Nivel 1: familias */}
          {!fam && (
            <div className="cm-fade-in" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginBottom: '0.75rem' }}>
              {tree.families.map(f => (
                <button key={f.id} className="cm-tap" onClick={() => setFam(f.id)}
                  style={{ minHeight: 72, borderRadius: 10, cursor: 'pointer', fontWeight: 800, fontSize: '1rem',
                    border: '1px solid var(--t-border,#d4cfc4)', background: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                  <span style={{ fontSize: '1.6rem' }}>{f.icon}</span>{f.label}
                </button>
              ))}
              {tree.families.length === 0 && <EmptyState tone="satori" icon="🍱" title="Carta sin productos con precio" hint="Cargá precios en Admin → 🍣 PoS → Productos." />}
            </div>
          )}

          {/* Nivel 2: categorías de la familia */}
          {fam && !cat && (
            <div className="cm-fade-in" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginBottom: '0.75rem' }}>
              {(tree.byFamily.get(fam) ?? []).map(c => (
                <button key={c} className="cm-tap" onClick={() => setCat(c)}
                  style={{ minHeight: 60, borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: '0.86rem',
                    border: '1px solid var(--t-border,#d4cfc4)', background: '#fff', padding: '8px 10px', textAlign: 'left' }}>
                  {c} <span style={{ color: '#5a5040', fontSize: '0.7rem' }}>({(tree.byCategory.get(c) ?? []).length})</span>
                </button>
              ))}
            </div>
          )}

          {/* Nivel 3: productos de la categoría */}
          {fam && cat && (
            <div className="cm-fade-in" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))', gap: 8, marginBottom: '0.75rem' }}>
              {(tree.byCategory.get(cat) ?? []).map(t => <Tile key={t.nombre} t={t} busy={adding === t.nombre} onAdd={() => quickAdd(t.nombre)} />)}
            </div>
          )}
        </>
      )}

      {items.length === 0 && <EmptyState tone="satori" icon="🧾" title="Mesa sin pedido" hint="Elegí una familia y un producto, o buscá arriba." />}
      {(['bebida', 'entrada', 'principal'] as PosCourse[]).map(c => {
        const list = items.filter(i => i.course === c)
        if (!list.length) return null
        return (
          <div key={c} style={{ marginBottom: '0.625rem' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#5a5040', textTransform: 'uppercase' }}>{COURSE_LABEL[c]}</div>
            {list.map(i => (
              <div key={i.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0', borderBottom: '1px solid var(--t-border,#d4cfc4)', fontSize: '0.82rem' }}>
                {/* Tocar el nombre abre el popup de detalles (asiento/curso/nota) para
                    CUALQUIER ítem pendiente, tenga o no modificadores (T2 carta-real). */}
                <span style={{ minWidth: 0, flex: 1, cursor: i.kitchen_status === 'pendiente' ? 'pointer' : 'default' }}
                  onClick={i.kitchen_status === 'pendiente' ? () => setEditItem(i) : undefined}
                  title={i.kitchen_status === 'pendiente' ? 'Tocá para editar asiento, curso o nota' : undefined}>
                  {i.qty > 1 && <strong style={{ color: '#a04030' }}>{i.qty}× </strong>}<strong>{i.product_name}</strong>
                  {i.modifiers.length > 0 && <span style={{ color: '#5a5040', fontSize: '0.72rem' }}> · {i.modifiers.map(m => m.name).join(', ')}</span>}
                  <span style={{ color: '#5a5040', fontSize: '0.7rem' }}> · asiento {i.seat}{i.merged_from_order ? ' · combinada' : ''}</span>
                  {i.note ? <span style={{ color: '#a07030', fontSize: '0.7rem', display: 'block' }}>📝 {i.note}</span> : null}
                </span>
                {i.kitchen_status === 'pendiente' && (
                  <button className="cm-tap" onClick={() => updateItemCourse(i.id, nextCourse(i.course)).then(load).catch(e => onError(e.message))}
                    style={{ background: 'none', border: '1px solid var(--t-border,#d4cfc4)', borderRadius: 10, padding: '8px 12px', minHeight: 40, fontSize: '0.7rem', cursor: 'pointer', color: '#5a5040' }}>
                    curso ⟳
                  </button>
                )}
                <span style={{ fontSize: '0.68rem', color: i.kitchen_status === 'marchado' ? '#a04030' : '#2a7a6a' }}>{KS_LABEL[i.kitchen_status]}</span>
                {i.kitchen_status === 'pendiente' && (
                  <button className="cm-tap" onClick={() => setEditItem(i)} title="Editar modificadores, asiento o curso (SPEC C3)"
                    style={{ background: 'none', border: '1px solid var(--t-border,#d4cfc4)', color: '#5a5040', borderRadius: 4, padding: '8px 12px', minHeight: 40, cursor: 'pointer' }}>✎</button>
                )}
                {i.kitchen_status === 'pendiente' && (
                  <button className="cm-tap" onClick={() => deleteOrderItem(i.id).then(load).catch(e => onError(e.message))} title="Quitar el ítem (aún no marchado)"
                    style={{ background: 'none', border: '1px solid #e0b0b0', color: '#c0392b', borderRadius: 4, padding: '8px 14px', minHeight: 40, cursor: 'pointer', fontWeight: 700 }}>×</button>
                )}
                {/* T2: anular un ítem YA enviado (void con permiso + motivo) */}
                {i.kitchen_status !== 'pendiente' && (
                  <button className="cm-tap" onClick={() => setVoiding(i)} title="Anular este ítem enviado (requiere gerencia)"
                    style={{ background: 'none', border: '1px solid #e0b0b0', color: '#c0392b', borderRadius: 4, padding: '8px 12px', minHeight: 40, cursor: 'pointer', fontSize: '0.7rem', fontWeight: 700 }}>⊘ anular</button>
                )}
              </div>
            ))}
          </div>
        )
      })}

      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
        {(['bebida', 'entrada', 'principal'] as PosCourse[]).map(c => (
          <button key={c} className="cd-btn-green cm-tap" disabled={!pendientes(c)} style={{ opacity: pendientes(c) ? 1 : 0.35, minHeight: 48 }}
            onClick={() => doMarchar(c)}>🔥 Marchar {c}s ({pendientes(c)})</button>
        ))}
        <button className="cd-btn-green cm-tap" disabled={!pendientes(null)} style={{ opacity: pendientes(null) ? 1 : 0.35, minHeight: 48 }}
          onClick={() => doMarchar(null)}>🔥🔥 Marchar TODO ({pendientes(null)})</button>
      </div>

      {/* Ventana de gracia del marchar (SPEC C2): 20s para deshacer un toque por error.
          Solo revierte lo aún 'marchado' (si cocina ya lo bumpeó, no se toca). */}
      {undo && undo.until > nowTs && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, padding: '0.6rem 0.8rem',
          borderRadius: 6, background: 'rgba(160,64,48,.1)', border: '1px solid #a04030', fontSize: '0.84rem' }}>
          <span>🔥 Marchado ✓ ({undo.ids.length} ítem/s)</span>
          <button className="cm-tap" onClick={doUndo}
            style={{ marginLeft: 'auto', background: '#a04030', color: '#fff', border: 'none', borderRadius: 5,
              padding: '10px 16px', minHeight: 44, fontWeight: 800, cursor: 'pointer' }}>
            ↩ DESHACER ({Math.max(0, Math.ceil((undo.until - nowTs) / 1000))}s)
          </button>
        </div>
      )}

      {/* T4 — barra de total SIEMPRE visible al pie: queda pegada abajo aunque el
          pedido sea largo (estética Satori oscuro+dorado). Solo presentación. */}
      {items.length > 0 && (
        <div className="cm-total-bar">
          <span style={{ fontSize: '0.8rem', fontWeight: 700, opacity: 0.85 }}>
            🧾 {order.table_name} · {items.reduce((n, i) => n + (i.qty ?? 1), 0)} ítem{items.reduce((n, i) => n + (i.qty ?? 1), 0) === 1 ? '' : 's'}
          </span>
          <span className="cm-total-val" title="Total con servicio e IVA — igual que la cuenta">{fi(totals.total)}</span>
        </div>
      )}

      {/* T3 — mini-popup de cantidad para alta directa (productos sin obligatorios) */}
      {qtyPopup && (
        <QtyPopup nombre={qtyPopup.nombre} precio={priceMap.get(qtyPopup.nombre)?.price_final_crc ?? 0}
          allergens={metaMap.get(qtyPopup.nombre)?.allergens}
          onCancel={() => setQtyPopup(null)} onConfirm={qty => addDirect(qtyPopup.nombre, qty)} />
      )}

      {(picking || editItem) && (() => {
        const nombre = picking?.nombre ?? editItem!.product_name
        return (
          <ItemPicker
            product={picking ?? { nombre, tipo: metaMap.get(nombre)?.tipo ?? '' }}
            price={priceMap.get(nombre) ?? null} pax={order.pax} orderId={order.id}
            meta={metaMap.get(nombre) ?? null} editItem={editItem}
            defaultSeat={Math.min(activeSeat, order.pax)} defaultCourse={activeCourse}
            onDone={() => { setPicking(null); setEditItem(null); load() }}
            onCancel={() => { setPicking(null); setEditItem(null) }} onError={onError} />
        )
      })()}

      {showBill && <CuentaView order={order} items={items} checks={checks}
        onClose={() => setShowBill(false)}
        onCobrar={() => { setShowBill(false); setShowCheckout({ check: null }) }}
        onCobrarCheck={c => { setShowBill(false); setShowCheckout({ check: c }) }}
        onSplit={() => { setShowBill(false); setShowSplit(true) }}
        onUnsplit={async () => { try { await clearOrderChecks(order.id); load() } catch (e) { onError(e instanceof Error ? e.message : 'Error') } }} />}
      {showSplit && <SplitModal order={order} items={items}
        onClose={() => setShowSplit(false)}
        onDone={() => { setShowSplit(false); load(); setShowBill(true) }} onError={onError} />}
      {showCheckout && <CheckoutModal order={order} items={items} cajero={cajeroName} check={showCheckout.check}
        onClose={() => setShowCheckout(null)}
        onDone={({ orderClosed }) => {
          const eraCheck = !!showCheckout.check
          setShowCheckout(null); load()
          if (orderClosed) onBack()
          else if (eraCheck) setShowBill(true)   // split a medias → volver a la cuenta para cobrar el resto
        }} onError={onError} />}
      {showTransfer && <TransferModal order={order} onClose={() => setShowTransfer(false)}
        onDone={() => { setShowTransfer(false); onBack() }} onError={onError} />}

      {/* T2 — motivo de anulación (tras el OK de gerencia) */}
      {voiding && (
        <div className="cd-modal-overlay" onClick={() => setVoiding(null)}>
          <div className="cd-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 340 }}>
            <div className="cd-modal-title">⊘ Anular · {voiding.product_name}</div>
            <div style={{ fontSize: '0.74rem', color: '#5a5040', margin: '0.25rem 0 0.5rem' }}>Ya fue a cocina. Elegí el motivo (lo autoriza gerencia):</div>
            {VOID_REASONS.map(r => (
              <button key={r} className="cm-tap" onClick={() => doVoid(voiding, r)}
                style={{ display: 'block', width: '100%', textAlign: 'left', minHeight: 48, marginBottom: 6, borderRadius: 6, cursor: 'pointer',
                  border: '1px solid var(--t-border,#d4cfc4)', background: '#fff', padding: '0 12px', fontWeight: 700, fontSize: '0.84rem' }}>
                {r}
              </button>
            ))}
            <div className="cd-modal-actions" style={{ marginTop: 6 }}>
              <button className="tips-btn-ghost cm-tap" style={{ minHeight: 48 }} onClick={() => setVoiding(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* T3 — otra ronda */}
      {showReorder && <ReorderModal order={order} enviados={enviados}
        onClose={() => setShowReorder(false)}
        onDone={() => { setShowReorder(false); load() }} onError={onError} />}

      {/* T1 — combinar mesas */}
      {showMerge && <MergeModal order={order} cajero={cajeroName}
        onClose={() => setShowMerge(false)}
        onDone={() => { setShowMerge(false); load() }} onError={onError} />}
    </div>
  )
}
