import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../shared/hooks/useAuth'
import { useRealtimeRefetch } from '../../shared/hooks/useRealtimeRefetch'
import {
  getLocations, getSalonTables, getOpenOrders, openOrder, updateOrderPax,
  getOrderItems, addOrderItem, updateItemCourse, deleteOrderItem, marchar,
  searchProducts, getProductGroups, getPriceMap, transferOrder, getProductMetaMap,
  unmarchar, cancelEmptyOrder, appendOrderNote,
} from '../../shared/api/pos'
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
        <OrderScreen order={sel} priceMap={priceMap} onBack={() => { setSel(null); load() }} onError={setError}
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

function OrderScreen({ order, priceMap, onBack, onError, onEditPax }: {
  // (meta de productos para snapshots de estación/subcategoría/servicio)
  order: PosOrder; priceMap: Map<string, PosPrice>; onBack: () => void; onError: (e: string) => void; onEditPax: () => void
}) {
  const [metaMap, setMetaMap] = useState<Map<string, { tipo: string; subclasificacion: string; station: string; aplica_servicio: boolean }>>(new Map())
  useEffect(() => { getProductMetaMap().then(setMetaMap).catch(() => { /* snapshots con defaults */ }) }, [])
  const [items, setItems]   = useState<PosOrderItem[]>([])
  const [search, setSearch] = useState('')
  const [opts, setOpts]     = useState<Array<{ nombre: string; tipo: string }>>([])
  const [picking, setPicking] = useState<{ nombre: string; tipo: string } | null>(null)
  const [showBill, setShowBill] = useState(false)
  const [showTransfer, setShowTransfer] = useState(false)
  // Comandero pro (SPEC): grid por categorías, deshacer marchar, edición de ítems
  const [cat, setCat]           = useState<string | null>(null)   // categoría activa del grid
  const [lastSeat]              = useState(1)                     // asiento default del quick-add (P2: recordar el último)
  const [undo, setUndo]         = useState<{ ids: string[]; until: number } | null>(null)
  const [nowTs, setNowTs]       = useState(() => Date.now())
  const [editItem, setEditItem] = useState<PosOrderItem | null>(null)
  const [adding, setAdding]     = useState<string | null>(null)   // tile en quick-add (feedback)
  useEffect(() => {
    if (!undo) return
    const t = window.setInterval(() => setNowTs(Date.now()), 500)
    return () => window.clearInterval(t)
  }, [undo])
  const menu = useMemo(() => buildMenu(metaMap, priceMap), [metaMap, priceMap])
  const activeCat = cat && menu.byCategory.has(cat) ? cat : (menu.categories[0] ?? null)
  // Total SIEMPRE visible mientras se comanda (SPEC C5) — misma matemática que la cuenta.
  const totals = computeTotals(items.map(toBillItem), order.channel)

  const load = useCallback(() => { getOrderItems(order.id).then(setItems).catch(e => onError(e.message)) }, [order.id, onError])
  useEffect(() => { load() }, [load])
  useRealtimeRefetch(`rt-order-${order.id}`, ['pos_order_items'], load)

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
        <button onClick={() => setShowTransfer(true)} title="Transferir la mesa a otro salonero"
          style={{ marginLeft: 'auto', background: 'none', border: '1px solid #5a5040', color: '#5a5040', borderRadius: 4, padding: '4px 10px', fontWeight: 700, cursor: 'pointer' }}>
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
                style={{ minHeight: 64, padding: '8px 10px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                  border: '1px solid var(--t-border,#d4cfc4)',
                  borderLeft: `5px solid ${t.station === 'barra' ? '#c8a96e' : '#2a7a6a'}`,
                  background: adding === t.nombre ? 'rgba(42,122,106,.18)' : '#fff',
                  display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 4 }}>
                <span style={{ fontWeight: 700, fontSize: '0.8rem', lineHeight: 1.15 }}>{t.nombre}</span>
                <span style={{ fontSize: '0.74rem', color: '#5a5040', fontVariantNumeric: 'tabular-nums' }}>{fi(t.price_final_crc)}</span>
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
                  <strong>{i.product_name}</strong>
                  {i.modifiers.length > 0 && <span style={{ color: '#5a5040', fontSize: '0.72rem' }}> · {i.modifiers.map(m => m.name).join(', ')}</span>}
                  <span style={{ color: '#5a5040', fontSize: '0.7rem' }}> · asiento {i.seat}</span>
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

      {showBill && <CuentaView order={order} items={items} onClose={() => setShowBill(false)} />}
      {showTransfer && <TransferModal order={order} onClose={() => setShowTransfer(false)}
        onDone={() => { setShowTransfer(false); onBack() }} onError={onError} />}
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
function CuentaView({ order, items, onClose }: { order: PosOrder; items: PosOrderItem[]; onClose: () => void }) {
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
        <div style={{ fontSize: '0.64rem', color: '#5a5040', marginTop: 6 }}>
          Solo lectura — sin cobro ni impresión (eso llega en F3). Base del servicio y si lleva IVA: PENDIENTE-CONTADORA.
        </div>
        <div className="cd-modal-actions" style={{ marginTop: '0.75rem' }}>
          <button className="cd-btn-green" onClick={onClose}>Cerrar</button>
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
        order_id: orderId, product_name: product.nombre, qty: 1,
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
          {!sinPrecio && <span style={{ fontSize: '0.82rem' }}>precio: <strong>{fi(total)}</strong></span>}
        </div>
        {sinPrecio && <div style={{ color: '#c23b22', fontSize: '0.74rem', marginTop: 6 }}>⚠ Sin precio cargado — cargalo en Admin → 🍣 PoS → Precios para poder enviarlo.</div>}
        {valErr && <div style={{ color: '#c23b22', fontSize: '0.74rem', marginTop: 6 }}>⛔ {valErr}</div>}
        <div className="cd-modal-actions" style={{ marginTop: '0.75rem' }}>
          <button className="tips-btn-ghost cm-tap" style={{ minHeight: 48 }} onClick={tryCancel}>Cancelar</button>
          <button className="cd-btn-green cm-tap" disabled={!!valErr || saving || sinPrecio} style={{ opacity: valErr || saving || sinPrecio ? 0.4 : 1, minHeight: 48 }} onClick={enviar}>
            {saving ? 'Guardando…' : editItem ? '✓ Guardar cambios' : '✓ Agregar al pedido'}
          </button>
        </div>
      </div>
    </div>
  )
}
