import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../shared/hooks/useAuth'
import { useManagerOverride } from '../../shared/ManagerOverride'
import { useRealtimeRefetch } from '../../shared/hooks/useRealtimeRefetch'
import {
  getLocations, getSalonTables, getOpenOrders, openOrder, updateOrderPax,
  getOrderItems, addOrderItem, updateItemCourse, deleteOrderItem, marchar,
  searchProducts, getProductGroups, getPriceMap, transferOrder, getProductMetaMap,
  unmarchar, cancelEmptyOrder, appendOrderNote, cobrarOrden,
  getOrderChecks, setOrderChecks, clearOrderChecks, cobrarCheck,
  voidOrderItem, reorderRound, mergeOrders, unmergeOrder, VOID_REASONS,
} from '../../shared/api/pos'
import { getCurrentRate } from '../../shared/api/exchangeRate'
import { calcularVuelto, vueltoPagoUsd, convertirCrcAUsd, convertirUsdACrc } from '../../shared/utils/posCobro'
import { renderTicketCobro } from '../../shared/utils/posTicket'
import type { PosPayment, PosCheck } from '../../shared/api/pos'
import { splitEven, splitByGroup, splitByItem } from '../../shared/utils/posSplit'
import type { SplitCheck } from '../../shared/utils/posSplit'
import type { PosLocation, SalonTable, PosOrder, PosOrderItem, ModifierGroupRow, ModifierRow, PosPrice } from '../../shared/api/pos'
import { getAllProfiles } from '../../shared/api/admin'
import type { Profile } from '../../shared/types/database'
import { computeItemPrice, validateItemSelections, defaultCourseForTipo, nextCourse, canCloseShift } from '../../shared/utils/posPricing'
import type { PosCourse, Turno } from '../../shared/utils/posPricing'
import { computeTotals, groupBySeat } from '../../shared/utils/posFiscal'
import type { BillItem } from '../../shared/utils/posFiscal'
import { fi } from '../../shared/utils'
import { buildMenu } from '../../shared/utils/comanderoMenu'

/** PosOrderItem → BillItem para la matemática fiscal (única verdad: computeTotals). */
function toBillItem(it: PosOrderItem): BillItem {
  return {
    product_name: it.product_name, qty: it.qty, price_final_crc: it.base_price_crc,
    modifiers: it.modifiers.map(m => ({ name: m.name, price_delta_crc: m.price_delta_crc })),
    tax_type: it.tax_type, seat: it.seat, applies_service: it.aplica_servicio !== false,
  }
}

const COURSE_LABEL: Record<PosCourse, string> = { bebida: '🥤 Bebida', entrada: '🥢 Entrada', principal: '🍣 Principal' }
const KS_LABEL: Record<string, string> = { pendiente: '· por marchar', marchado: '🔥 en cocina', listo: '✅ listo', entregado: '✓ entregado' }

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

  const load = useCallback(async () => {
    try {
      setTables(await getSalonTables(loc))
      const os = await getOpenOrders(loc)
      setOrders(os)
      setSel(prev => prev ? os.find(o => o.id === prev.id) ?? null : prev)
    } catch (e) { setError(e instanceof Error ? e.message : 'Error cargando salón') }
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
        <button onClick={() => setShowCierre(true)} title="Chequear cierre de turno"
          style={{ marginLeft: 'auto', background: 'none', border: '1px solid #333', color: '#c8a96e', borderRadius: 3, padding: '4px 12px', cursor: 'pointer' }}>
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
          {tables.filter(t => t.is_active).length === 0 && (
            <div style={{ padding: '2rem', color: '#5a5040' }}>Sin mesas en este local — armalas en Admin → 🍣 PoS → Editor de Salón.</div>
          )}
        </div>
      )}

      {sel && (
        <OrderScreen order={sel} priceMap={priceMap} cajeroName={profile?.full_name ?? ''} onBack={() => { setSel(null); load() }} onError={setError}
          onEditPax={() => setPaxModal({ table: null, editOrder: sel })} />
      )}

      {paxModal && <PaxModal initial={paxModal.editOrder?.pax ?? null} onCancel={() => setPaxModal(null)} onConfirm={abrirMesa} />}
      {showCierre && <CierreTurnoModal openTables={orders.map(o => o.table_name)} onClose={() => setShowCierre(false)} />}
    </div>
  )
}

/** Chequeo de cierre de turno (regla de la dueña): el turno mañana puede cerrar
 *  con mesas abiertas; el último turno NO. Informativo — no toca la Caja. */
function CierreTurnoModal({ openTables, onClose }: { openTables: string[]; onClose: () => void }) {
  const [turno, setTurno] = useState<Turno>('noche')
  const r = canCloseShift(turno, openTables)
  return (
    <div className="cd-modal-overlay" onClick={onClose}>
      <div className="cd-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 380 }}>
        <div className="cd-modal-title">🔒 Cierre de turno</div>
        <div style={{ display: 'flex', gap: 6, margin: '0.5rem 0' }}>
          {(['mañana', 'noche'] as Turno[]).map(t => (
            <button key={t} onClick={() => setTurno(t)}
              style={{ flex: 1, padding: '8px', borderRadius: 4, cursor: 'pointer', fontWeight: 700, fontSize: '0.82rem',
                border: '1px solid var(--t-border,#d4cfc4)', background: turno === t ? '#0d0d0d' : 'transparent', color: turno === t ? '#c8a96e' : '#5a5040' }}>
              {t === 'mañana' ? '☀️ Turno mañana' : '🌙 Último turno'}
            </button>
          ))}
        </div>
        <div style={{ fontSize: '0.78rem', color: '#5a5040', marginBottom: 6 }}>
          {openTables.length ? `${openTables.length} mesa(s) abierta(s): ${openTables.join(', ')}` : 'Sin mesas abiertas.'}
        </div>
        <div style={{ padding: '0.6rem', borderRadius: 4, fontSize: '0.82rem', fontWeight: 600,
          background: r.ok ? 'rgba(42,122,106,.12)' : 'rgba(194,59,34,.1)', color: r.ok ? '#1f6f3f' : '#c23b22', border: `1px solid ${r.ok ? '#2a7a6a' : '#c23b22'}` }}>
          {r.ok ? '✓ ' : '⛔ '}{r.message}
        </div>
        <div className="cd-modal-actions" style={{ marginTop: '0.75rem' }}>
          <button className="cd-btn-green" onClick={onClose}>Entendido</button>
        </div>
      </div>
    </div>
  )
}

/** Pax obligatorio ≥1 — teclado numérico, confirmar deshabilitado sin pax válido. */
function PaxModal({ initial, onCancel, onConfirm }: { initial: number | null; onCancel: () => void; onConfirm: (pax: number) => void }) {
  const [pax, setPax] = useState<number | null>(initial)
  const valid = pax !== null && Number.isInteger(pax) && pax >= 1 && pax <= 99
  return (
    <div className="cd-modal-overlay" onClick={onCancel}>
      <div className="cd-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 320, textAlign: 'center' }}>
        <div className="cd-modal-title">¿Cuántas personas? (pax)</div>
        <div style={{ fontSize: '2.6rem', fontWeight: 800, margin: '0.5rem 0', minHeight: 52, fontVariantNumeric: 'tabular-nums' }}>{pax ?? '—'}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
            <button key={n} className="tips-btn-ghost cm-tap" style={{ minHeight: 56, fontSize: '1.35rem', fontWeight: 700 }}
              onClick={() => setPax(p => (p == null ? n : p < 10 ? p * 10 + n : p))}>{n}</button>
          ))}
          <button className="tips-btn-ghost cm-tap" style={{ minHeight: 56, fontSize: '1.1rem', color: '#c0392b', fontWeight: 800 }}
            onClick={() => setPax(null)} title="Limpiar">C</button>
          <button className="tips-btn-ghost cm-tap" style={{ minHeight: 56, fontSize: '1.35rem', fontWeight: 700 }}
            onClick={() => setPax(p => (p ? Math.min(p * 10, 99) : null))}>0</button>
          <button className="tips-btn-ghost cm-tap" style={{ minHeight: 56, fontSize: '1.2rem' }}
            onClick={() => setPax(p => (p && p >= 10 ? Math.floor(p / 10) : null))} title="Borrar último dígito">⌫</button>
        </div>
        <div style={{ fontSize: '0.68rem', color: '#5a5040', marginTop: 6 }}>El pax es obligatorio — mínimo 1, máximo 99. ⌫ borra el último dígito · C limpia todo.</div>
        <div className="cd-modal-actions" style={{ marginTop: '0.75rem' }}>
          <button className="tips-btn-ghost cm-tap" style={{ minHeight: 48 }} onClick={onCancel}>Cancelar</button>
          <button className="cd-btn-green cm-tap" disabled={!valid} style={{ opacity: valid ? 1 : 0.4, minHeight: 48, fontSize: '1rem' }}
            onClick={() => valid && onConfirm(pax)}>✓ Confirmar {valid ? `${pax} pax` : ''}</button>
        </div>
      </div>
    </div>
  )
}

function OrderScreen({ order, priceMap, cajeroName, onBack, onError, onEditPax }: {
  // (meta de productos para snapshots de estación/subcategoría/servicio)
  order: PosOrder; priceMap: Map<string, PosPrice>; cajeroName: string; onBack: () => void; onError: (e: string) => void; onEditPax: () => void
}) {
  const { profile } = useAuth()
  const profileId = profile?.id ?? null
  const [metaMap, setMetaMap] = useState<Map<string, { tipo: string; subclasificacion: string; station: string; aplica_servicio: boolean }>>(new Map())
  useEffect(() => { getProductMetaMap().then(setMetaMap).catch(() => { /* snapshots con defaults */ }) }, [])
  const [items, setItems]   = useState<PosOrderItem[]>([])
  const [search, setSearch] = useState('')
  const [opts, setOpts]     = useState<Array<{ nombre: string; tipo: string }>>([])
  const [picking, setPicking] = useState<{ nombre: string; tipo: string } | null>(null)
  const [showBill, setShowBill] = useState(false)
  const [showCheckout, setShowCheckout] = useState<{ check: PosCheck | null } | null>(null)
  const [showTransfer, setShowTransfer] = useState(false)
  const [checks, setChecks] = useState<PosCheck[]>([])
  const [showSplit, setShowSplit] = useState(false)
  // Comandero pro (SPEC): grid por categorías, deshacer marchar, edición de ítems
  const [cat, setCat]           = useState<string | null>(null)   // categoría activa del grid
  const [lastSeat]              = useState(1)                     // asiento default del quick-add (P2: recordar el último)
  const [undo, setUndo]         = useState<{ ids: string[]; until: number } | null>(null)
  const [nowTs, setNowTs]       = useState(() => Date.now())
  const [editItem, setEditItem] = useState<PosOrderItem | null>(null)
  const [adding, setAdding]     = useState<string | null>(null)   // tile en quick-add (feedback)
  const [voiding, setVoiding]   = useState<PosOrderItem | null>(null)  // ítem enviado a anular (T2)
  const [showReorder, setShowReorder] = useState(false)               // otra ronda (T3)
  const [showMerge, setShowMerge]     = useState(false)               // combinar mesas (T1)
  const requireManager = useManagerOverride()
  useEffect(() => {
    if (!undo) return
    const t = window.setInterval(() => setNowTs(Date.now()), 500)
    return () => window.clearInterval(t)
  }, [undo])
  const menu = useMemo(() => buildMenu(metaMap, priceMap), [metaMap, priceMap])
  const activeCat = cat && menu.byCategory.has(cat) ? cat : (menu.categories[0] ?? null)
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
  useRealtimeRefetch(`rt-order-${order.id}`, ['pos_order_items', 'pos_checks'], load)

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

  useEffect(() => {
    if (search.trim().length < 2) { setOpts([]); return }
    const t = setTimeout(() => searchProducts(search).then(setOpts).catch(() => setOpts([])), 300)
    return () => clearTimeout(t)
  }, [search])

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

  // SPEC D1: tap en el tile agrega DIRECTO si el producto no tiene modificadores
  // OBLIGATORIOS (2 taps: categoría → ítem); si los tiene, abre el picker.
  const quickAdd = async (nombre: string) => {
    const m = metaMap.get(nombre); const pr = priceMap.get(nombre)
    if (!m || !pr || pr.price_final_crc == null || adding) return
    setAdding(nombre)
    try {
      const groups = await getProductGroups(nombre)
      if (groups.some(g => g.required)) { setPicking({ nombre, tipo: m.tipo }); return }
      await addOrderItem({
        order_id: order.id, product_name: nombre, qty: 1,
        base_price_crc: pr.price_final_crc, modifiers: [],
        price_crc: pr.price_final_crc, tax_type: pr.tax_type ?? 'iva13', seat: lastSeat,
        course: defaultCourseForTipo(m.tipo),
        station: (m.station as 'cocina' | 'barra' | 'ninguna') ?? 'cocina',
        subcategory: m.subclasificacion ?? '', aplica_servicio: m.aplica_servicio ?? true,
      })
      load()
    } catch (e) { onError(e instanceof Error ? e.message : 'Error agregando el ítem') }
    finally { setAdding(null) }
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

      <div style={{ position: 'relative', margin: '0.625rem 0' }}>
        <input className="tips-input-dark" style={{ width: '100%' }} placeholder="Buscar producto (ej: MOJITO, SATORI ROLL)…"
          value={search} onChange={e => setSearch(e.target.value)} />
        {opts.length > 0 && (
          <div className="cd-sup-dropdown" style={{ maxHeight: 220, overflowY: 'auto' }}>
            {opts.map(p => {
              const pr = priceMap.get(p.nombre)
              const noPrice = !pr || pr.price_final_crc == null
              return (
                <div key={p.nombre} className="cd-sup-option"
                  onMouseDown={() => { if (!noPrice) { setPicking(p); setSearch(''); setOpts([]) } }}
                  style={noPrice ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
                  title={noPrice ? 'Sin precio — cargalo en Admin → 🍣 PoS → Precios' : undefined}>
                  {p.nombre} <span className="cd-sup-cat">· {p.tipo}</span>
                  {noPrice ? <span style={{ color: '#c23b22', fontSize: '0.66rem' }}> · ⚠ sin precio</span>
                    : <span style={{ color: '#2a7a6a', fontSize: '0.7rem' }}> · {fi(pr!.price_final_crc!)}</span>}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Menú visual (SPEC P0-b): pestañas de categoría + tiles grandes con precio.
          Color del borde por estación (D4): teal = cocina · dorado = barra. */}
      {menu.categories.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '2px 0 6px', WebkitOverflowScrolling: 'touch' }}>
            {menu.categories.map(c => (
              <button key={c} className="cm-tap" onClick={() => setCat(c)}
                style={{ minHeight: 48, padding: '8px 16px', borderRadius: 8, whiteSpace: 'nowrap', fontWeight: 800, fontSize: '0.85rem', cursor: 'pointer',
                  border: '1px solid var(--t-border,#d4cfc4)',
                  background: activeCat === c ? '#0d0d0d' : '#fff', color: activeCat === c ? '#c8a96e' : '#5a5040' }}>
                {c}
              </button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))', gap: 8, marginBottom: '0.75rem' }}>
            {(activeCat ? menu.byCategory.get(activeCat) ?? [] : []).map(t => (
              <button key={t.nombre} className="cm-tap" disabled={adding === t.nombre} onClick={() => quickAdd(t.nombre)}
                title={`Agregar ${t.nombre}`}
                style={{ minHeight: 64, padding: 0, borderRadius: 8, cursor: 'pointer', textAlign: 'left', overflow: 'hidden',
                  border: '1px solid var(--t-border,#d4cfc4)',
                  borderLeft: `5px solid ${t.station === 'barra' ? '#c8a96e' : '#2a7a6a'}`,
                  background: adding === t.nombre ? 'rgba(42,122,106,.18)' : '#fff',
                  display: 'flex', flexDirection: 'column' }}>
                {/* Foto del menú si existe; si no, cae al diseño actual (color + nombre).
                    Lazy + onError → si la imagen falla (offline sin caché), se oculta sola. */}
                {t.photo_url && (
                  <img src={t.photo_url} alt="" loading="lazy"
                    onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                    style={{ width: '100%', height: 72, objectFit: 'cover', display: 'block', pointerEvents: 'none' }} />
                )}
                <span style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 4, padding: '8px 10px', flex: 1 }}>
                  <span style={{ fontWeight: 700, fontSize: '0.8rem', lineHeight: 1.15 }}>{t.nombre}</span>
                  <span style={{ fontSize: '0.74rem', color: '#5a5040', fontVariantNumeric: 'tabular-nums' }}>{fi(t.price_final_crc)}</span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {items.length === 0 && <div style={{ color: '#5a5040', fontSize: '0.8rem', padding: '0.75rem 0' }}>Mesa sin ítems — tocá una categoría y un producto del menú (o buscá arriba).</div>}
      {(['bebida', 'entrada', 'principal'] as PosCourse[]).map(c => {
        const list = items.filter(i => i.course === c)
        if (!list.length) return null
        return (
          <div key={c} style={{ marginBottom: '0.625rem' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#5a5040', textTransform: 'uppercase' }}>{COURSE_LABEL[c]}</div>
            {list.map(i => (
              <div key={i.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0', borderBottom: '1px solid var(--t-border,#d4cfc4)', fontSize: '0.82rem' }}>
                <span style={{ minWidth: 0, flex: 1 }}>
                  {i.qty > 1 && <strong style={{ color: '#a04030' }}>{i.qty}× </strong>}<strong>{i.product_name}</strong>
                  {i.modifiers.length > 0 && <span style={{ color: '#5a5040', fontSize: '0.72rem' }}> · {i.modifiers.map(m => m.name).join(', ')}</span>}
                  <span style={{ color: '#5a5040', fontSize: '0.7rem' }}> · asiento {i.seat}{i.merged_from_order ? ' · combinada' : ''}</span>
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

      {(picking || editItem) && (() => {
        const nombre = picking?.nombre ?? editItem!.product_name
        return (
          <ItemPicker
            product={picking ?? { nombre, tipo: metaMap.get(nombre)?.tipo ?? '' }}
            price={priceMap.get(nombre) ?? null} pax={order.pax} orderId={order.id}
            meta={metaMap.get(nombre) ?? null} editItem={editItem}
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

/** T3 — Otra ronda (SPEC F11): reenvía ítems ya enviados como nuevos (pendientes),
 *  con cantidad ± por ítem. Pensado para la barra (otra vuelta sin navegar el menú). */
function ReorderModal({ order, enviados, onClose, onDone, onError }: {
  order: PosOrder; enviados: PosOrderItem[]; onClose: () => void; onDone: () => void; onError: (e: string) => void
}) {
  // Ítems únicos por (producto + modificadores + asiento) → cantidad a repetir.
  const base = useMemo(() => {
    const seen = new Map<string, PosOrderItem>()
    for (const it of enviados) {
      const k = it.product_name + '|' + it.modifiers.map(m => m.id).sort().join(',') + '|' + it.seat
      if (!seen.has(k)) seen.set(k, it)
    }
    return [...seen.values()]
  }, [enviados])
  const [qty, setQty] = useState<Record<string, number>>({})
  const [saving, setSaving] = useState(false)
  const total = Object.values(qty).reduce((a, b) => a + b, 0)

  const confirmar = async () => {
    if (saving || !total) return
    setSaving(true)
    try {
      await reorderRound(order.id, base.filter(it => (qty[it.id] ?? 0) > 0).map(it => ({ src: it, qty: qty[it.id] })))
      onDone()
    } catch (e) { onError(e instanceof Error ? e.message : 'Error al reordenar'); setSaving(false) }
  }

  return (
    <div className="cd-modal-overlay" onClick={onClose}>
      <div className="cd-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 420, maxHeight: '85vh', overflowY: 'auto' }}>
        <div className="cd-modal-title">🔁 Otra ronda · {order.table_name}</div>
        <div style={{ fontSize: '0.74rem', color: '#5a5040', margin: '0.25rem 0 0.5rem' }}>Elegí cuántos repetir (se reenvían a cocina/barra como nuevos):</div>
        {base.map(it => {
          const q = qty[it.id] ?? 0
          return (
            <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.4rem 0', borderBottom: '1px solid var(--t-border,#e6e1d6)' }}>
              <span style={{ flex: 1, fontSize: '0.84rem' }}>{it.product_name}
                {it.modifiers.length > 0 && <span style={{ color: '#5a5040', fontSize: '0.72rem' }}> · {it.modifiers.map(m => m.name).join(', ')}</span>}
                <span style={{ color: '#5a5040', fontSize: '0.7rem' }}> · as.{it.seat}</span>
              </span>
              <button className="cm-tap" onClick={() => setQty(p => ({ ...p, [it.id]: Math.max(0, q - 1) }))} style={{ minWidth: 40, minHeight: 40, borderRadius: 6, border: '1px solid #5a5040', background: '#fff', fontSize: '1.1rem', cursor: 'pointer' }}>−</button>
              <strong style={{ minWidth: 20, textAlign: 'center' }}>{q}</strong>
              <button className="cm-tap" onClick={() => setQty(p => ({ ...p, [it.id]: q + 1 }))} style={{ minWidth: 40, minHeight: 40, borderRadius: 6, border: '1px solid #5a5040', background: '#fff', fontSize: '1.1rem', cursor: 'pointer' }}>+</button>
            </div>
          )
        })}
        <div className="cd-modal-actions" style={{ marginTop: '0.75rem', gap: 8 }}>
          <button className="tips-btn-ghost cm-tap" style={{ minHeight: 48 }} onClick={onClose}>Cancelar</button>
          <button className="cd-btn-green cm-tap" style={{ minHeight: 48, fontWeight: 800, opacity: total && !saving ? 1 : 0.4 }} disabled={!total || saving} onClick={confirmar}>
            {saving ? 'Reenviando…' : `🔁 Reenviar ${total} ítem${total === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  )
}

/** T1 — Combinar mesas (SPEC F14, patrón Lavu con deshacer): trae los ítems de otra
 *  mesa abierta a esta; quedan como checks separados (cobrables aparte) y se puede
 *  des-combinar mientras nada esté pago. */
function MergeModal({ order, cajero, onClose, onDone, onError }: {
  order: PosOrder; cajero: string; onClose: () => void; onDone: () => void; onError: (e: string) => void
}) {
  const { profile } = useAuth()
  const [abiertas, setAbiertas] = useState<PosOrder[]>([])
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    getOpenOrders(order.location_id)
      .then(os => setAbiertas(os.filter(o => o.id !== order.id)))
      .catch(e => onError(e instanceof Error ? e.message : 'Error cargando mesas'))
  }, [order.id, order.location_id, onError])

  const combinar = async (from: PosOrder) => {
    if (saving || !profile) return
    setSaving(true)
    try {
      await mergeOrders(order, from, { id: profile.id, name: cajero || profile.full_name || '' }, order.channel)
      onDone()
    } catch (e) { onError(e instanceof Error ? e.message : 'Error al combinar'); setSaving(false) }
  }

  return (
    <div className="cd-modal-overlay" onClick={onClose}>
      <div className="cd-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 380, maxHeight: '80vh', overflowY: 'auto' }}>
        <div className="cd-modal-title">⧉ Combinar en {order.table_name}</div>
        <div style={{ fontSize: '0.74rem', color: '#5a5040', margin: '0.25rem 0 0.5rem' }}>
          Los ítems de la otra mesa pasan acá como una cuenta separada (se puede separar de nuevo si no cobraste nada).
        </div>
        {abiertas.length === 0 && <div style={{ color: '#5a5040', fontSize: '0.82rem' }}>No hay otras mesas abiertas en este local.</div>}
        {abiertas.map(o => (
          <button key={o.id} disabled={saving} className="cm-tap" onClick={() => combinar(o)}
            style={{ display: 'block', width: '100%', textAlign: 'left', minHeight: 48, marginBottom: 6, borderRadius: 6, cursor: 'pointer',
              border: '1px solid var(--t-border,#d4cfc4)', background: '#fff', padding: '0 12px', fontWeight: 700, fontSize: '0.84rem' }}>
            {o.table_name} <span style={{ color: '#5a5040', fontWeight: 400, fontSize: '0.72rem' }}>· {o.pax}p · {o.salonero_name}</span>
          </button>
        ))}
        <div className="cd-modal-actions" style={{ marginTop: 6 }}>
          <button className="tips-btn-ghost cm-tap" style={{ minHeight: 48 }} onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  )
}

/** Transferir mesa abierta a otro salonero: traza en jsonb + las métricas (ventas,
 *  propinas, ICP) siguen al receptor desde este momento (current_salonero_id). */
function TransferModal({ order, onClose, onDone, onError }: {
  order: PosOrder; onClose: () => void; onDone: () => void; onError: (e: string) => void
}) {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [saving, setSaving] = useState(false)
  const currentId = order.current_salonero_id ?? order.opened_by

  useEffect(() => {
    getAllProfiles()
      .then(ps => setProfiles(ps.filter(p => ['owner', 'manager', 'cajero', 'salonero', 'barman'].includes(p.role))))
      .catch(e => onError(e instanceof Error ? e.message : 'Error cargando saloneros'))
  }, [onError])

  const transfer = async (to: Profile) => {
    if (saving) return
    setSaving(true)
    try {
      await transferOrder(order, { id: to.id, name: to.full_name }, { id: currentId, name: order.salonero_name })
      onDone()
    } catch (e) { onError(e instanceof Error ? e.message : 'Error transfiriendo la mesa'); setSaving(false) }
  }

  return (
    <div className="cd-modal-overlay" onClick={onClose}>
      <div className="cd-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 380, maxHeight: '80vh', overflowY: 'auto' }}>
        <div className="cd-modal-title">↔ Transferir {order.table_name}</div>
        <div style={{ fontSize: '0.74rem', color: '#5a5040', marginBottom: 8 }}>
          A cargo ahora: <strong>{order.salonero_name}</strong>. Desde la transferencia, las métricas van al receptor.
        </div>
        {order.transfers?.length > 0 && (
          <div style={{ fontSize: '0.68rem', color: '#5a5040', marginBottom: 8, borderLeft: '2px solid #d4cfc4', paddingLeft: 6 }}>
            {order.transfers.map((t, i) => <div key={i}>↪ {t.from_name} → {t.to_name}</div>)}
          </div>
        )}
        {profiles.filter(p => p.id !== currentId).map(p => (
          <button key={p.id} disabled={saving} onClick={() => transfer(p)}
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.55rem 0.75rem', marginBottom: 4, borderRadius: 4, cursor: 'pointer',
              border: '1px solid var(--t-border,#d4cfc4)', background: 'transparent', fontSize: '0.84rem' }}>
            <strong>{p.full_name}</strong> <span style={{ color: '#5a5040', fontSize: '0.7rem' }}>· {p.role}</span>
          </button>
        ))}
        <div className="cd-modal-actions" style={{ marginTop: '0.5rem' }}>
          <button className="tips-btn-ghost" onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  )
}

/** Cuenta de mesa (pre-F3, solo lectura): consumo + servicio 10% por canal + IVA
 *  + total, con vista por mesa completa o por asiento/cliente. SIN cobro, SIN impresión. */
function CuentaView({ order, items, checks, onClose, onCobrar, onCobrarCheck, onSplit, onUnsplit }: {
  order: PosOrder; items: PosOrderItem[]; checks: PosCheck[]
  onClose: () => void; onCobrar: () => void; onCobrarCheck: (c: PosCheck) => void; onSplit: () => void; onUnsplit: () => void
}) {
  const dividido = checks.length > 0
  const algunPago = checks.some(c => c.paid)
  const [porAsiento, setPorAsiento] = useState(false)
  const bill = items.map(toBillItem)
  const totals = computeTotals(bill, order.channel)
  const seats = [...groupBySeat(bill).entries()].sort((a, b) => a[0] - b[0])

  const Linea = ({ b }: { b: BillItem }) => (
    <div style={{ display: 'flex', gap: 8, padding: '0.25rem 0', borderBottom: '1px solid var(--t-border,#e6e1d6)', fontSize: '0.82rem' }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        {b.qty > 1 && <strong>{b.qty}× </strong>}{b.product_name}
        {b.modifiers.length > 0 && <span style={{ color: '#5a5040', fontSize: '0.72rem' }}> · {b.modifiers.map(m => m.name).join(', ')}</span>}
      </span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fi((b.price_final_crc + b.modifiers.reduce((s, m) => s + m.price_delta_crc, 0)) * b.qty)}</span>
    </div>
  )

  return (
    <div className="cd-modal-overlay" onClick={onClose}>
      <div className="cd-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460, maxHeight: '88vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="cd-modal-title" style={{ flex: 1 }}>🧾 Cuenta · {order.table_name}</div>
          <span style={{ fontSize: '0.68rem', color: '#5a5040' }}>{order.channel} · {order.pax}p</span>
        </div>
        <div style={{ display: 'flex', gap: 4, margin: '0.25rem 0 0.5rem' }}>
          {([['mesa', false], ['por asiento', true]] as const).map(([label, val]) => (
            <button key={label} onClick={() => setPorAsiento(val)}
              style={{ padding: '3px 12px', borderRadius: 12, fontSize: '0.72rem', cursor: 'pointer',
                border: '1px solid var(--t-border,#d4cfc4)', background: porAsiento === val ? '#0d0d0d' : 'transparent', color: porAsiento === val ? '#c8a96e' : '#5a5040' }}>
              {label}
            </button>
          ))}
        </div>

        {!porAsiento && bill.map((b, i) => <Linea key={i} b={b} />)}
        {porAsiento && seats.map(([seat, its]) => (
          <div key={seat} style={{ marginBottom: 8 }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#5a5040', textTransform: 'uppercase', marginTop: 6 }}>Asiento {seat || '—'}</div>
            {its.map((b, i) => <Linea key={i} b={b} />)}
            <div style={{ textAlign: 'right', fontSize: '0.74rem', color: '#5a5040' }}>subtotal asiento: <strong>{fi(computeTotals(its, order.channel).consumo)}</strong></div>
          </div>
        ))}

        <div style={{ marginTop: '0.75rem', borderTop: '2px solid #0d0d0d', paddingTop: 8, fontSize: '0.86rem' }}>
          <Row label="Consumo (IVA incl.)" value={fi(totals.consumo)} />
          <Row label="— Neto" value={fi(totals.neto)} muted />
          <Row label="— IVA" value={fi(totals.iva)} muted />
          {totals.servicioAplica
            ? <Row label={`Servicio 10% (s/ ${totals.servicioBase})`} value={fi(totals.servicio)} />
            : <Row label="Servicio 10%" value="no aplica (delivery)" muted />}
          {totals.servicioIva > 0 && <Row label="— IVA servicio" value={fi(totals.servicioIva)} muted />}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: '1.05rem', marginTop: 6, borderTop: '1px solid var(--t-border,#d4cfc4)', paddingTop: 6 }}>
            <span>TOTAL</span><span>{fi(totals.total)}</span>
          </div>
        </div>
        {/* Split: lista de checks (cada uno se cobra aparte) o botón Dividir */}
        {dividido && (
          <div style={{ marginTop: '0.75rem', borderTop: '1px dashed #5a5040', paddingTop: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <strong style={{ fontSize: '0.8rem' }}>Dividida en {checks.length} cuentas</strong>
              {!algunPago && <button className="cm-tap" onClick={onUnsplit}
                style={{ marginLeft: 'auto', background: 'none', border: '1px solid #5a5040', color: '#5a5040', borderRadius: 4, padding: '4px 10px', fontSize: '0.7rem', cursor: 'pointer' }}>↩ Des-dividir</button>}
            </div>
            {checks.map(c => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.4rem 0', borderBottom: '1px solid var(--t-border,#e6e1d6)' }}>
                <span style={{ flex: 1, fontSize: '0.84rem' }}>{c.label} <span style={{ color: '#5a5040', fontVariantNumeric: 'tabular-nums' }}>{fi(c.amount_crc)}</span></span>
                {c.paid
                  ? <span style={{ color: '#1f6f3f', fontWeight: 800, fontSize: '0.8rem' }}>✓ pagada</span>
                  : <button className="cd-btn-green cm-tap" style={{ minHeight: 40, fontWeight: 700, fontSize: '0.78rem' }} onClick={() => onCobrarCheck(c)}>💳 Cobrar</button>}
              </div>
            ))}
          </div>
        )}
        <div style={{ fontSize: '0.64rem', color: '#5a5040', marginTop: 6 }}>
          Ticket en modo SIM (impresora real y factura electrónica: futuro). Base del servicio y si lleva IVA: PENDIENTE-CONTADORA.
        </div>
        <div className="cd-modal-actions" style={{ marginTop: '0.75rem', gap: 8, flexWrap: 'wrap' }}>
          <button className="tips-btn-ghost cm-tap" style={{ minHeight: 48 }} onClick={onClose}>Cerrar</button>
          {!dividido && <button className="cm-tap" style={{ minHeight: 48, padding: '0 14px', borderRadius: 6, border: '1px solid #5a5040', background: '#fff', color: '#5a5040', fontWeight: 700, cursor: 'pointer' }} onClick={onSplit}>🔀 Dividir</button>}
          {!dividido && <button className="cd-btn-green cm-tap" style={{ minHeight: 48, fontWeight: 800 }} onClick={onCobrar}>💳 Cobrar {fi(totals.total)}</button>}
        </div>
      </div>
    </div>
  )
}

/** F3 — Dividir cuenta (SPEC F15): 3 modos (parejo N / por asiento / por ítem),
 *  todo prorrateado por posSplit (invariante: Σ checks = total). Crea los pos_checks. */
function SplitModal({ order, items, onClose, onDone, onError }: {
  order: PosOrder; items: PosOrderItem[]; onClose: () => void; onDone: () => void; onError: (e: string) => void
}) {
  const bill = useMemo(() => items.map(toBillItem), [items])
  const [mode, setMode] = useState<'even' | 'seat' | 'item'>('even')
  const [n, setN] = useState(2)
  const [assign, setAssign] = useState<Record<number, number | null>>({})  // ítem idx → check idx (null = compartido)
  const [saving, setSaving] = useState(false)
  const total = computeTotals(bill, order.channel).total

  // Preview de los checks según el modo
  const preview: SplitCheck[] = useMemo(() => {
    if (mode === 'even') return splitEven(total, n).map((amt, i) => ({ key: String(i), label: `Cuenta ${i + 1}`, amount_crc: amt, lines: [] }))
    if (mode === 'seat') return splitByGroup(bill, b => String(b.seat ?? 0), k => `Asiento ${k}`, order.channel).checks
    return splitByItem(bill, i => assign[i] ?? null, n, order.channel).checks
  }, [mode, n, assign, bill, total, order.channel])

  const guardar = async () => {
    if (saving) return
    setSaving(true)
    try {
      const lineLabel = (b: BillItem) => ({ product_name: b.product_name, qty: b.qty, line_total_crc: (b.price_final_crc + b.modifiers.reduce((s, m) => s + m.price_delta_crc, 0)) * b.qty, modifiers: b.modifiers.map(m => m.name) })
      await setOrderChecks(order.id, preview.map((c, i) => ({ idx: i + 1, label: c.label, kind: mode, amount_crc: c.amount_crc, items_snapshot: c.lines.map(lineLabel) })))
      onDone()
    } catch (e) { onError(e instanceof Error ? e.message : 'Error al dividir'); setSaving(false) }
  }

  return (
    <div className="cd-modal-overlay" onClick={onClose}>
      <div className="cd-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440, maxHeight: '88vh', overflowY: 'auto' }}>
        <div className="cd-modal-title">🔀 Dividir · {order.table_name}</div>
        <div style={{ display: 'flex', gap: 6, margin: '0.5rem 0' }}>
          {([['even', 'Parejo'], ['seat', 'Por asiento'], ['item', 'Por ítem']] as const).map(([m, label]) => (
            <button key={m} className="cm-tap" onClick={() => setMode(m)}
              style={{ flex: 1, minHeight: 44, borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: '0.78rem',
                border: '1px solid var(--t-border,#d4cfc4)', background: mode === m ? '#0d0d0d' : '#fff', color: mode === m ? '#c8a96e' : '#5a5040' }}>
              {label}
            </button>
          ))}
        </div>

        {(mode === 'even' || mode === 'item') && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: '0.8rem' }}>¿En cuántas cuentas?</span>
            <button className="cm-tap" style={{ minWidth: 44, minHeight: 44, borderRadius: 6, border: '1px solid #5a5040', background: '#fff', fontSize: '1.2rem', cursor: 'pointer' }} onClick={() => setN(v => Math.max(2, v - 1))}>−</button>
            <strong style={{ fontSize: '1.3rem', minWidth: 24, textAlign: 'center' }}>{n}</strong>
            <button className="cm-tap" style={{ minWidth: 44, minHeight: 44, borderRadius: 6, border: '1px solid #5a5040', background: '#fff', fontSize: '1.2rem', cursor: 'pointer' }} onClick={() => setN(v => Math.min(12, v + 1))}>+</button>
          </div>
        )}

        {mode === 'item' && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: '0.72rem', color: '#5a5040', marginBottom: 4 }}>Tocá cada ítem para asignarlo a una cuenta (volvé a tocar para compartir):</div>
            {bill.map((b, i) => {
              const cur = assign[i] ?? null
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0.3rem 0', borderBottom: '1px solid var(--t-border,#e6e1d6)' }}>
                  <span style={{ flex: 1, fontSize: '0.8rem' }}>{b.product_name} <span style={{ color: '#5a5040' }}>{fi((b.price_final_crc + b.modifiers.reduce((s, m) => s + m.price_delta_crc, 0)) * b.qty)}</span></span>
                  <div style={{ display: 'flex', gap: 3 }}>
                    {Array.from({ length: n }, (_, c) => (
                      <button key={c} className="cm-tap" onClick={() => setAssign(a => ({ ...a, [i]: cur === c ? null : c }))}
                        style={{ minWidth: 32, minHeight: 32, borderRadius: 4, cursor: 'pointer', fontWeight: 700, fontSize: '0.72rem',
                          border: '1px solid var(--t-border,#d4cfc4)', background: cur === c ? '#2a7a6a' : '#fff', color: cur === c ? '#fff' : '#5a5040' }}>
                        {c + 1}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
            <div style={{ fontSize: '0.66rem', color: '#8a8378', marginTop: 2 }}>Sin asignar = compartido (se prorratea entre todas).</div>
          </div>
        )}

        {/* Preview con reconciliación */}
        <div style={{ borderTop: '1px solid #0d0d0d', paddingTop: 8 }}>
          {preview.map(c => (
            <div key={c.key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.84rem', padding: '2px 0' }}>
              <span>{c.label}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{fi(c.amount_crc)}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, marginTop: 4, borderTop: '1px solid var(--t-border,#d4cfc4)', paddingTop: 4 }}>
            <span>Σ = total</span><span>{fi(preview.reduce((s, c) => s + c.amount_crc, 0))} / {fi(total)}</span>
          </div>
        </div>

        <div className="cd-modal-actions" style={{ marginTop: '0.75rem', gap: 8 }}>
          <button className="tips-btn-ghost cm-tap" style={{ minHeight: 48 }} onClick={onClose}>Cancelar</button>
          <button className="cd-btn-green cm-tap" style={{ minHeight: 48, fontWeight: 800 }} disabled={saving} onClick={guardar}>{saving ? 'Dividiendo…' : '✓ Dividir cuenta'}</button>
        </div>
      </div>
    </div>
  )
}

/** F3 — Checkout: reúsa computeTotals (sin recalcular), método de pago, doble moneda
 *  con TC ajustable por orden, vuelto (función pura), registra el pago + cierra la
 *  mesa + muestra el ticket SIM. */
function CheckoutModal({ order, items, cajero, check, onClose, onDone, onError }: {
  order: PosOrder; items: PosOrderItem[]; cajero: string; check: PosCheck | null
  onClose: () => void; onDone: (r: { orderClosed: boolean }) => void; onError: (e: string) => void
}) {
  const { profile } = useAuth()
  const totals = useMemo(() => computeTotals(items.map(toBillItem), order.channel), [items, order.channel])
  // Monto a cobrar: el del check si es un split, si no el total de la mesa.
  const payTotal = check ? check.amount_crc : totals.total
  const [method, setMethod] = useState<'efectivo' | 'tarjeta' | 'transferencia'>('efectivo')
  const [tc, setTc] = useState<number>(0)               // TC del día (editable por orden)
  const [tcEdit, setTcEdit] = useState(false)
  const [efMoneda, setEfMoneda] = useState<'CRC' | 'USD'>('CRC')
  const [recibido, setRecibido] = useState<number | null>(null)  // en la moneda elegida
  const [tipMode, setTipMode] = useState<0 | 10 | 15 | 'manual'>(0)   // propina: %, manual o sin
  const [tipManual, setTipManual] = useState<number | null>(null)     // monto manual en moneda del pago
  const [saving, setSaving] = useState(false)
  const [ticket, setTicket] = useState<string | null>(null)
  const [closed, setClosed] = useState(false)

  useEffect(() => { getCurrentRate().then(setTc).catch(() => setTc(640)) }, [])

  // Propina capturada (F19, NO se distribuye acá). En la moneda del pago → convertida a ₡.
  const tipInPayCcy = tipMode === 'manual' ? (tipManual ?? 0) : tipMode === 0 ? 0 : Math.round(payTotal * tipMode / 100)
  const tipCrc = (method === 'efectivo' && efMoneda === 'USD') ? convertirUsdACrc(tipInPayCcy, tc) : Math.round(tipInPayCcy)
  // Si hay propina en efectivo, el cliente debe cubrir total + propina.
  const aCobrar = payTotal + (method === 'efectivo' ? tipCrc : 0)

  // Vuelto según moneda del efectivo recibido (funciones puras testeadas).
  const calc = (() => {
    if (method !== 'efectivo' || recibido == null) return null
    return efMoneda === 'USD' ? vueltoPagoUsd(aCobrar, recibido, tc) : { recibido_crc: Math.round(recibido), ...calcularVuelto(aCobrar, recibido) }
  })()
  const totalUsd = tc > 0 ? convertirCrcAUsd(payTotal, tc) : 0

  const confirmar = async () => {
    if (saving || !profile) return
    if (method === 'efectivo' && (!calc || !calc.alcanza)) { onError('El efectivo recibido no cubre el total'); return }
    setSaving(true)
    try {
      const payment: PosPayment = {
        order_id: order.id, method,
        amount_crc: payTotal, currency: method === 'efectivo' ? efMoneda : 'CRC',
        exchange_rate_used: (method === 'efectivo' && efMoneda === 'USD') ? tc : (tcEdit ? tc : null),
        received_crc: method === 'efectivo' ? (calc?.recibido_crc ?? 0) : 0,
        received_usd: method === 'efectivo' && efMoneda === 'USD' ? (recibido ?? 0) : 0,
        change_crc: method === 'efectivo' ? (calc?.vuelto_crc ?? 0) : 0,
        tip_crc: tipCrc, tip_currency: method === 'efectivo' ? efMoneda : 'CRC',
        created_by: profile.id,
      }
      const res = check
        ? await cobrarCheck(check.id, payment, profile.id)
        : (await cobrarOrden(payment, profile.id), { orderClosed: true })
      setClosed(res.orderClosed)
      // Ticket SIM (D4): texto en pantalla + log; impresora real = futuro.
      const txt = renderTicketCobro({
        table: order.table_name, channel: order.channel, pax: order.pax,
        salonero: order.salonero_name, cajero,
        lines: items.map(it => ({
          name: it.product_name, qty: it.qty,
          line_total_crc: (it.base_price_crc + it.modifiers.reduce((a, m) => a + m.price_delta_crc, 0)) * it.qty,
          modifiers: it.modifiers.map(m => m.name),
        })),
        totals,
        pago: { method, currency: payment.currency, exchange_rate_used: payment.exchange_rate_used,
          received_crc: payment.received_crc, received_usd: payment.received_usd, change_crc: payment.change_crc,
          tip_crc: tipCrc, check_label: check?.label, check_amount_crc: check?.amount_crc },
      })
      // eslint-disable-next-line no-console
      console.log('🖨️ TICKET SIM\n' + txt)
      setTicket(txt)
    } catch (e) { onError(e instanceof Error ? e.message : 'Error al cobrar'); setSaving(false) }
  }

  // Pantalla del ticket emitido → cerrar vuelve al plano (si la mesa cerró) o a la cuenta.
  if (ticket) return (
    <div className="cd-modal-overlay" onClick={() => onDone({ orderClosed: closed })}>
      <div className="cd-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 380 }}>
        <div className="cd-modal-title">✅ Cobrado{check ? ` · ${check.label}` : ''} · {order.table_name}</div>
        <pre style={{ background: '#0d0d0d', color: '#e8e2d0', padding: '0.75rem', borderRadius: 6, fontSize: '0.7rem', lineHeight: 1.35, overflowX: 'auto', whiteSpace: 'pre-wrap' }}>{ticket}</pre>
        <div style={{ fontSize: '0.64rem', color: '#5a5040', marginTop: 4 }}>
          {closed ? 'Mesa cerrada.' : 'Quedan cuentas por cobrar en esta mesa.'} Ticket SIM (impresora/factura real: futuro).
        </div>
        <div className="cd-modal-actions" style={{ marginTop: '0.75rem' }}>
          <button className="cd-btn-green cm-tap" style={{ minHeight: 48 }} onClick={() => onDone({ orderClosed: closed })}>Listo</button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="cd-modal-overlay" onClick={onClose}>
      <div className="cd-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
        <div className="cd-modal-title">💳 Cobrar{check ? ` · ${check.label}` : ''} · {order.table_name}</div>

        {/* Total: ₡ primario + $ secundario con TC */}
        <div style={{ background: '#0d0d0d', color: '#c8a96e', borderRadius: 8, padding: '0.75rem', textAlign: 'center', margin: '0.25rem 0 0.5rem' }}>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{fi(payTotal)}</div>
          <div style={{ fontSize: '0.82rem', opacity: 0.85 }}>
            ≈ ${totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · TC ₡{tc}/$
            <button className="cm-tap" onClick={() => setTcEdit(v => !v)} style={{ marginLeft: 6, background: 'none', border: '1px solid #5a5040', color: '#c8a96e', borderRadius: 4, padding: '2px 8px', fontSize: '0.68rem', cursor: 'pointer' }}>ajustar TC</button>
          </div>
          {tcEdit && (
            <input type="number" className="tips-input-dark" value={tc} onChange={e => setTc(Number(e.target.value) || 0)}
              style={{ marginTop: 6, width: 120, textAlign: 'center' }} placeholder="TC ₡/$" />
          )}
        </div>

        {/* Propina (F19): se CAPTURA acá; la distribución al pool es sprint aparte (sagrado) */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: '0.72rem', color: '#5a5040', marginBottom: 3 }}>Propina (opcional)</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {([[0, 'Sin'], [10, '10%'], [15, '15%'], ['manual', 'Otro']] as const).map(([v, label]) => (
              <button key={String(v)} className="cm-tap" onClick={() => { setTipMode(v); if (v !== 'manual') setTipManual(null) }}
                style={{ flex: 1, minHeight: 40, borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: '0.76rem',
                  border: '1px solid var(--t-border,#d4cfc4)', background: tipMode === v ? '#c8a96e' : '#fff', color: tipMode === v ? '#0d0d0d' : '#5a5040' }}>
                {label}
              </button>
            ))}
          </div>
          {tipMode === 'manual' && (
            <input type="number" className="tips-input-dark" value={tipManual ?? ''} placeholder={`Monto propina (${method === 'efectivo' && efMoneda === 'USD' ? '$' : '₡'})`}
              onChange={e => setTipManual(e.target.value === '' ? null : Number(e.target.value))}
              style={{ marginTop: 6, width: '100%' }} />
          )}
          {tipCrc > 0 && <div style={{ fontSize: '0.72rem', color: '#1f6f3f', marginTop: 4 }}>Propina: {fi(tipCrc)}{method === 'efectivo' && efMoneda === 'USD' ? ` (${'$' + tipInPayCcy})` : ''} → a cobrar {fi(aCobrar)}</div>}
        </div>

        {/* Método */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          {(['efectivo', 'tarjeta', 'transferencia'] as const).map(m => (
            <button key={m} className="cm-tap" onClick={() => setMethod(m)}
              style={{ flex: 1, minHeight: 48, borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: '0.78rem',
                border: '1px solid var(--t-border,#d4cfc4)', background: method === m ? '#0d0d0d' : '#fff', color: method === m ? '#c8a96e' : '#5a5040' }}>
              {m === 'efectivo' ? '💵 Efectivo' : m === 'tarjeta' ? '💳 Tarjeta' : '📲 Transf/SINPE'}
            </button>
          ))}
        </div>

        {/* Efectivo: moneda + numpad de recibido + vuelto */}
        {method === 'efectivo' && (
          <>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              {(['CRC', 'USD'] as const).map(c => (
                <button key={c} className="cm-tap" onClick={() => { setEfMoneda(c); setRecibido(null) }}
                  style={{ flex: 1, minHeight: 40, borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: '0.78rem',
                    border: '1px solid var(--t-border,#d4cfc4)', background: efMoneda === c ? '#2a7a6a' : '#fff', color: efMoneda === c ? '#fff' : '#5a5040' }}>
                  {c === 'CRC' ? '₡ Colones' : '$ Dólares'}
                </button>
              ))}
            </div>
            <div style={{ fontSize: '0.72rem', color: '#5a5040' }}>Recibido ({efMoneda === 'CRC' ? '₡' : '$'})</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, textAlign: 'center', minHeight: 40, fontVariantNumeric: 'tabular-nums' }}>
              {recibido == null ? '—' : (efMoneda === 'CRC' ? fi(recibido) : '$' + recibido)}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
              {[1,2,3,4,5,6,7,8,9].map(n => (
                <button key={n} className="tips-btn-ghost cm-tap" style={{ minHeight: 48, fontSize: '1.2rem', fontWeight: 700 }}
                  onClick={() => setRecibido(p => (p == null ? n : p * 10 + n))}>{n}</button>
              ))}
              <button className="tips-btn-ghost cm-tap" style={{ minHeight: 48, color: '#c0392b', fontWeight: 800 }} onClick={() => setRecibido(null)}>C</button>
              <button className="tips-btn-ghost cm-tap" style={{ minHeight: 48, fontSize: '1.2rem', fontWeight: 700 }} onClick={() => setRecibido(p => (p == null ? 0 : p * 10))}>0</button>
              <button className="tips-btn-ghost cm-tap" style={{ minHeight: 48 }} onClick={() => setRecibido(p => (p == null ? null : Math.floor(p / 10) || null))}>⌫</button>
            </div>
            {/* atajos de billetes frecuentes */}
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              {(efMoneda === 'CRC' ? [5000, 10000, 20000, 50000] : [20, 50, 100]).map(b => (
                <button key={b} className="cm-tap" onClick={() => setRecibido(b)}
                  style={{ flex: 1, minHeight: 40, borderRadius: 6, cursor: 'pointer', border: '1px solid var(--t-border,#d4cfc4)', background: '#fff', fontSize: '0.76rem', fontWeight: 700 }}>
                  {efMoneda === 'CRC' ? fi(b) : '$' + b}
                </button>
              ))}
              <button className="cm-tap" onClick={() => setRecibido(efMoneda === 'CRC' ? aCobrar : Math.ceil(convertirCrcAUsd(aCobrar, tc)))}
                style={{ flex: 1, minHeight: 40, borderRadius: 6, cursor: 'pointer', border: '1px solid #2a7a6a', background: 'rgba(42,122,106,.12)', fontSize: '0.76rem', fontWeight: 700 }}>
                exacto
              </button>
            </div>
            {calc && (
              <div style={{ marginTop: 8, padding: '0.5rem 0.75rem', borderRadius: 6, fontWeight: 800,
                background: calc.alcanza ? 'rgba(42,122,106,.12)' : 'rgba(194,59,34,.1)', color: calc.alcanza ? '#1f6f3f' : '#c23b22' }}>
                {efMoneda === 'USD' && <div style={{ fontWeight: 400, fontSize: '0.74rem' }}>= {fi(calc.recibido_crc)} al TC ₡{tc}</div>}
                {calc.alcanza ? `Vuelto: ${fi(calc.vuelto_crc)}` : `Falta: ${fi(calc.falta_crc)}`}
              </div>
            )}
          </>
        )}

        {method !== 'efectivo' && (
          <div style={{ fontSize: '0.78rem', color: '#5a5040', padding: '0.5rem 0' }}>
            {method === 'tarjeta' ? 'Cobro con datáfono — pasá la tarjeta por el POS físico y confirmá acá.' : 'Transferencia / SINPE — confirmá la recepción y registrá acá.'}
          </div>
        )}

        <div className="cd-modal-actions" style={{ marginTop: '0.75rem', gap: 8 }}>
          <button className="tips-btn-ghost cm-tap" style={{ minHeight: 48 }} onClick={onClose}>Cancelar</button>
          <button className="cd-btn-green cm-tap" style={{ minHeight: 48, fontWeight: 800, opacity: saving || (method === 'efectivo' && !calc?.alcanza) ? 0.5 : 1 }}
            disabled={saving || (method === 'efectivo' && !calc?.alcanza)} onClick={confirmar}>
            {saving ? 'Cobrando…' : `✓ Confirmar cobro ${fi(aCobrar)}`}
          </button>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', color: muted ? '#5a5040' : 'inherit', fontSize: muted ? '0.76rem' : '0.86rem', padding: '1px 0' }}>
      <span>{label}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  )
}

/** Modal de ítem: modificadores (obligatorios bloquean), curso y asiento.
 *  Con editItem (SPEC C3) edita un ítem NO marchado: prefill de todo, y al guardar
 *  reemplaza el ítem (agrega el nuevo y borra el viejo). */
function ItemPicker({ product, price, pax, orderId, meta, editItem, onDone, onCancel, onError }: {
  meta: { tipo: string; subclasificacion: string; station: string; aplica_servicio: boolean } | null
  product: { nombre: string; tipo: string }; price: PosPrice | null; pax: number; orderId: string
  editItem?: PosOrderItem | null
  onDone: () => void; onCancel: () => void; onError: (e: string) => void
}) {
  const [groups, setGroups] = useState<Array<ModifierGroupRow & { modifiers: ModifierRow[] }>>([])
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [course, setCourse] = useState<PosCourse>(editItem?.course ?? defaultCourseForTipo(product.tipo))
  const [seat, setSeat]     = useState(editItem?.seat ?? 1)
  const [qty, setQty]       = useState(editItem?.qty ?? 1)   // T4: cantidad rápida (no en edición)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty]   = useState(false)   // SPEC C6: tocar fuera no descarta sin avisar

  useEffect(() => {
    getProductGroups(product.nombre).then(gs => {
      setGroups(gs)
      if (editItem) {
        // prefill: marcar los modificadores que el ítem ya tiene
        const ids = new Set(editItem.modifiers.map(m => m.id))
        setPicked(Object.fromEntries(gs.map(g => [g.id, g.modifiers.filter(m => ids.has(m.id)).map(m => m.id)])))
      }
    }).catch(e => onError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.nombre, onError])

  const tryCancel = () => {
    if (dirty && !window.confirm('¿Descartar los cambios de este ítem?')) return
    onCancel()
  }

  const chosen = groups.flatMap(g => g.modifiers.filter(m => (picked[g.id] ?? []).includes(m.id)))
  const counts = Object.fromEntries(groups.map(g => [g.id, (picked[g.id] ?? []).length]))
  const valErr = validateItemSelections(groups.map(g => ({ ...g, modifiers: g.modifiers })), counts)
  // TRAMO 3: el precio de venta es FINAL (IVA incluido) y vive en pos_prices.
  // Sin precio → no se puede enviar (el comandero no manda ítems sin precio).
  const base = price?.price_final_crc ?? editItem?.base_price_crc ?? null
  const taxType = price?.tax_type ?? 'iva13'
  const sinPrecio = base == null
  const total = computeItemPrice(base ?? 0, chosen)

  const enviar = async () => {
    if (valErr || saving || sinPrecio) return
    setSaving(true)
    try {
      await addOrderItem({
        order_id: orderId, product_name: product.nombre, qty: editItem ? (editItem.qty ?? 1) : qty,
        base_price_crc: base ?? 0, modifiers: chosen.map(m => ({ id: m.id, name: m.name, price_delta_crc: m.price_delta_crc })),
        price_crc: total, tax_type: taxType, seat, course,
        // Snapshots de la ficha (refinamiento 06-12): ruteo KDS + orden + fiscal
        station: (meta?.station as 'cocina' | 'barra' | 'ninguna') ?? 'cocina',
        subcategory: meta?.subclasificacion ?? '',
        aplica_servicio: meta?.aplica_servicio ?? true,
      })
      // Edición (C3) = reemplazo: primero entra el nuevo (no se pierde nada), después
      // sale el viejo (solo borra pendientes; si falló, queda visible y se quita a mano).
      if (editItem) await deleteOrderItem(editItem.id).catch(() => onError('El ítem editado quedó duplicado — quitá la versión vieja con ×'))
      onDone()
    } catch (e) { onError(e instanceof Error ? e.message : 'Error agregando ítem'); setSaving(false) }
  }

  return (
    <div className="cd-modal-overlay" onClick={tryCancel}>
      <div className="cd-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="cd-modal-title">{editItem ? '✎ ' : ''}{product.nombre}</div>
        {groups.map(g => (
          <div key={g.id} style={{ marginBottom: 8 }}>
            <div style={{ fontSize: '0.74rem', fontWeight: 700 }}>{g.name}{g.required && <span style={{ color: '#c23b22' }}> * obligatorio</span>}</div>
            {g.modifiers.map(m => {
              const on = (picked[g.id] ?? []).includes(m.id)
              return (
                <button key={m.id} className="cm-tap" onClick={() => { setDirty(true); setPicked(prev => {
                  const cur = prev[g.id] ?? []
                  return { ...prev, [g.id]: on ? cur.filter(x => x !== m.id) : (g.max_selections === 1 ? [m.id] : [...cur, m.id]) }
                }) }}
                  style={{ margin: '2px 4px 2px 0', padding: '6px 12px', borderRadius: 14, fontSize: '0.78rem', cursor: 'pointer',
                    border: `1px solid ${on ? '#2a7a6a' : 'var(--t-border,#d4cfc4)'}`, background: on ? 'rgba(42,122,106,.15)' : 'transparent' }}>
                  {m.name}{m.price_delta_crc > 0 ? ` +${fi(m.price_delta_crc)}` : ''}
                </button>
              )
            })}
          </div>
        ))}
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
          <button className="cm-tap" onClick={() => { setDirty(true); setCourse(nextCourse(course)) }}
            style={{ border: '1px solid var(--t-border,#d4cfc4)', background: 'none', borderRadius: 12, padding: '4px 12px', fontSize: '0.76rem', cursor: 'pointer' }}>
            {COURSE_LABEL[course]} ⟳
          </button>
          <label style={{ fontSize: '0.76rem' }}>asiento
            <select className="tips-input-dark" style={{ marginLeft: 4, minHeight: 40 }} value={seat} onChange={e => { setDirty(true); setSeat(Number(e.target.value)) }}>
              {Array.from({ length: pax }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          {/* T4: cantidad rápida (×N). En edición el qty no cambia (es reemplazo 1:1). */}
          {!editItem && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.76rem' }}>cant.
              <button className="cm-tap" onClick={() => setQty(q => Math.max(1, q - 1))} style={{ minWidth: 36, minHeight: 36, borderRadius: 6, border: '1px solid #5a5040', background: '#fff', fontSize: '1.05rem', cursor: 'pointer' }}>−</button>
              <strong style={{ minWidth: 18, textAlign: 'center' }}>{qty}</strong>
              <button className="cm-tap" onClick={() => setQty(q => Math.min(99, q + 1))} style={{ minWidth: 36, minHeight: 36, borderRadius: 6, border: '1px solid #5a5040', background: '#fff', fontSize: '1.05rem', cursor: 'pointer' }}>+</button>
            </span>
          )}
          {!sinPrecio && <span style={{ fontSize: '0.82rem' }}>precio: <strong>{fi(total * (editItem ? 1 : qty))}</strong></span>}
        </div>
        {sinPrecio && <div style={{ color: '#c23b22', fontSize: '0.74rem', marginTop: 6 }}>⚠ Sin precio cargado — cargalo en Admin → 🍣 PoS → Precios para poder enviarlo.</div>}
        {valErr && <div style={{ color: '#c23b22', fontSize: '0.74rem', marginTop: 6 }}>⛔ {valErr}</div>}
        <div className="cd-modal-actions" style={{ marginTop: '0.75rem' }}>
          <button className="tips-btn-ghost cm-tap" style={{ minHeight: 48 }} onClick={tryCancel}>Cancelar</button>
          <button className="cd-btn-green cm-tap" disabled={!!valErr || saving || sinPrecio} style={{ opacity: valErr || saving || sinPrecio ? 0.4 : 1, minHeight: 48 }} onClick={enviar}>
            {saving ? 'Guardando…' : editItem ? '✓ Guardar cambios' : `✓ Agregar${qty > 1 ? ` ×${qty}` : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}
