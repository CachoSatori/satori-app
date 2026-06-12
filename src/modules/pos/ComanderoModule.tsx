import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../shared/hooks/useAuth'
import { useRealtimeRefetch } from '../../shared/hooks/useRealtimeRefetch'
import {
  getLocations, getSalonTables, getOpenOrders, openOrder, updateOrderPax,
  getOrderItems, addOrderItem, updateItemCourse, deleteOrderItem, marchar,
  searchProducts, getProductGroups, getPriceMap,
} from '../../shared/api/pos'
import type { PosLocation, SalonTable, PosOrder, PosOrderItem, ModifierGroupRow, ModifierRow, PosPrice } from '../../shared/api/pos'
import { computeItemPrice, validateItemSelections, defaultCourseForTipo, nextCourse } from '../../shared/utils/posPricing'
import type { PosCourse } from '../../shared/utils/posPricing'
import { computeTotals, groupBySeat } from '../../shared/utils/posFiscal'
import type { BillItem } from '../../shared/utils/posFiscal'
import { fi } from '../../shared/utils'

/** PosOrderItem → BillItem para la matemática fiscal (única verdad: computeTotals). */
function toBillItem(it: PosOrderItem): BillItem {
  return {
    product_name: it.product_name, qty: it.qty, price_final_crc: it.base_price_crc,
    modifiers: it.modifiers.map(m => ({ name: m.name, price_delta_crc: m.price_delta_crc })),
    tax_type: it.tax_type, seat: it.seat,
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
        await updateOrderPax(paxModal.editOrder.id, pax)
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
        <button onClick={() => navigate('/')} style={{ marginLeft: 'auto', background: 'none', border: '1px solid #333', color: '#c8a96e', borderRadius: 3, padding: '4px 12px', cursor: 'pointer' }}>← Inicio</button>
      </header>
      {error && <div style={{ color: '#c23b22', padding: '0.5rem 1rem', fontSize: '0.8rem' }} onClick={() => setError(null)}>⚠ {error} (tocá para cerrar)</div>}

      {!sel && (
        <div style={{ position: 'relative', minHeight: 520, margin: '0.75rem', background: '#f5f0e8', borderRadius: 6, overflow: 'auto' }}>
          {tables.filter(t => t.is_active).map(t => {
            const o = orderByTable.get(t.id)
            return (
              <div key={t.id}
                onClick={() => o ? setSel(o) : setPaxModal({ table: t, editOrder: null })}
                style={{ position: 'absolute', left: t.pos_x, top: t.pos_y, cursor: 'pointer',
                  width: t.shape === 'bar' ? 96 : 72, height: t.shape === 'bar' ? 40 : 72,
                  borderRadius: t.shape === 'round' ? '50%' : 8,
                  background: o ? '#a04030' : '#2a7a6a', color: '#fff', border: '2px solid #0d0d0d',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.68rem', fontWeight: 700, userSelect: 'none' }}>
                <div>{t.name}</div>
                <div style={{ fontWeight: 400 }}>{o ? `${o.pax} pax · abierta` : `${t.capacity} pax`}</div>
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
    </div>
  )
}

/** Pax obligatorio ≥1 — teclado numérico, confirmar deshabilitado sin pax válido. */
function PaxModal({ initial, onCancel, onConfirm }: { initial: number | null; onCancel: () => void; onConfirm: (pax: number) => void }) {
  const [pax, setPax] = useState<number | null>(initial)
  const valid = pax !== null && Number.isInteger(pax) && pax >= 1
  return (
    <div className="cd-modal-overlay" onClick={onCancel}>
      <div className="cd-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 320, textAlign: 'center' }}>
        <div className="cd-modal-title">¿Cuántas personas? (pax)</div>
        <div style={{ fontSize: '2rem', fontWeight: 800, margin: '0.5rem 0', minHeight: 44 }}>{pax ?? '—'}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
            <button key={n} className="tips-btn-ghost" style={{ padding: '12px 0', fontSize: '1.1rem' }}
              onClick={() => setPax(p => (p && p < 10 ? p * 10 + n : n))}>{n}</button>
          ))}
          <button className="tips-btn-ghost" onClick={() => setPax(null)}>C</button>
          <button className="tips-btn-ghost" style={{ padding: '12px 0', fontSize: '1.1rem' }}
            onClick={() => setPax(p => (p ? p * 10 : null))}>0</button>
          <button className="tips-btn-ghost" onClick={() => setPax(p => (p && p >= 10 ? Math.floor(p / 10) : null))}>⌫</button>
        </div>
        <div style={{ fontSize: '0.68rem', color: '#5a5040', marginTop: 6 }}>El pax es obligatorio — mínimo 1, el 0 no existe.</div>
        <div className="cd-modal-actions" style={{ marginTop: '0.75rem' }}>
          <button className="tips-btn-ghost" onClick={onCancel}>Cancelar</button>
          <button className="cd-btn-green" disabled={!valid} style={{ opacity: valid ? 1 : 0.4 }}
            onClick={() => valid && onConfirm(pax)}>✓ Confirmar</button>
        </div>
      </div>
    </div>
  )
}

function OrderScreen({ order, priceMap, onBack, onError, onEditPax }: {
  order: PosOrder; priceMap: Map<string, PosPrice>; onBack: () => void; onError: (e: string) => void; onEditPax: () => void
}) {
  const [items, setItems]   = useState<PosOrderItem[]>([])
  const [search, setSearch] = useState('')
  const [opts, setOpts]     = useState<Array<{ nombre: string; tipo: string }>>([])
  const [picking, setPicking] = useState<{ nombre: string; tipo: string } | null>(null)
  const [showBill, setShowBill] = useState(false)

  const load = useCallback(() => { getOrderItems(order.id).then(setItems).catch(e => onError(e.message)) }, [order.id, onError])
  useEffect(() => { load() }, [load])
  useRealtimeRefetch(`rt-order-${order.id}`, ['pos_order_items'], load)

  useEffect(() => {
    if (search.trim().length < 2) { setOpts([]); return }
    const t = setTimeout(() => searchProducts(search).then(setOpts).catch(() => setOpts([])), 300)
    return () => clearTimeout(t)
  }, [search])

  const pendientes = (c: PosCourse | null) => items.filter(i => i.kitchen_status === 'pendiente' && (!c || i.course === c)).length
  const doMarchar = (c: PosCourse | null) =>
    marchar(order.id, c).then(load).catch(e => onError(e instanceof Error ? e.message : 'Error al marchar'))

  return (
    <div style={{ padding: '0.75rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button className="tips-btn-ghost" onClick={onBack}>← Salón</button>
        <strong>{order.table_name}</strong>
        <button onClick={onEditPax} title="Editar pax"
          style={{ background: '#0d0d0d', color: '#c8a96e', border: 'none', borderRadius: 12, padding: '3px 12px', fontWeight: 800, cursor: 'pointer' }}>
          👥 {order.pax} pax ✎
        </button>
        <span style={{ fontSize: '0.7rem', color: '#5a5040' }}>{order.salonero_name}</span>
        <button onClick={() => setShowBill(true)} disabled={!items.length} title="Ver la cuenta de la mesa"
          style={{ marginLeft: 'auto', background: '#2a7a6a', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 12px', fontWeight: 700, cursor: 'pointer', opacity: items.length ? 1 : 0.4 }}>
          🧾 Cuenta
        </button>
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

      {items.length === 0 && <div style={{ color: '#5a5040', fontSize: '0.8rem', padding: '0.75rem 0' }}>Mesa sin ítems — buscá un producto para empezar el pedido.</div>}
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
                  <button onClick={() => updateItemCourse(i.id, nextCourse(i.course)).then(load).catch(e => onError(e.message))}
                    style={{ background: 'none', border: '1px solid var(--t-border,#d4cfc4)', borderRadius: 10, padding: '1px 8px', fontSize: '0.66rem', cursor: 'pointer', color: '#5a5040' }}>
                    curso ⟳
                  </button>
                )}
                <span style={{ fontSize: '0.68rem', color: i.kitchen_status === 'marchado' ? '#a04030' : '#2a7a6a' }}>{KS_LABEL[i.kitchen_status]}</span>
                {i.kitchen_status === 'pendiente' && (
                  <button onClick={() => deleteOrderItem(i.id).then(load).catch(e => onError(e.message))}
                    style={{ background: 'none', border: '1px solid #e0b0b0', color: '#c0392b', borderRadius: 3, padding: '1px 7px', cursor: 'pointer' }}>×</button>
                )}
              </div>
            ))}
          </div>
        )
      })}

      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
        {(['bebida', 'entrada', 'principal'] as PosCourse[]).map(c => (
          <button key={c} className="cd-btn-green" disabled={!pendientes(c)} style={{ opacity: pendientes(c) ? 1 : 0.35 }}
            onClick={() => doMarchar(c)}>🔥 Marchar {c}s ({pendientes(c)})</button>
        ))}
        <button className="cd-btn-green" disabled={!pendientes(null)} style={{ opacity: pendientes(null) ? 1 : 0.35 }}
          onClick={() => doMarchar(null)}>🔥🔥 Marchar TODO ({pendientes(null)})</button>
      </div>

      {picking && (
        <ItemPicker product={picking} price={priceMap.get(picking.nombre) ?? null} pax={order.pax} orderId={order.id}
          onDone={() => { setPicking(null); load() }} onCancel={() => setPicking(null)} onError={onError} />
      )}

      {showBill && <CuentaView order={order} items={items} onClose={() => setShowBill(false)} />}
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

/** Modal de ítem: modificadores (obligatorios bloquean), curso y asiento. */
function ItemPicker({ product, price, pax, orderId, onDone, onCancel, onError }: {
  product: { nombre: string; tipo: string }; price: PosPrice | null; pax: number; orderId: string
  onDone: () => void; onCancel: () => void; onError: (e: string) => void
}) {
  const [groups, setGroups] = useState<Array<ModifierGroupRow & { modifiers: ModifierRow[] }>>([])
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [course, setCourse] = useState<PosCourse>(defaultCourseForTipo(product.tipo))
  const [seat, setSeat]     = useState(1)
  const [saving, setSaving] = useState(false)

  useEffect(() => { getProductGroups(product.nombre).then(setGroups).catch(e => onError(e.message)) }, [product.nombre, onError])

  const chosen = groups.flatMap(g => g.modifiers.filter(m => (picked[g.id] ?? []).includes(m.id)))
  const counts = Object.fromEntries(groups.map(g => [g.id, (picked[g.id] ?? []).length]))
  const valErr = validateItemSelections(groups.map(g => ({ ...g, modifiers: g.modifiers })), counts)
  // TRAMO 3: el precio de venta es FINAL (IVA incluido) y vive en pos_prices.
  // Sin precio → no se puede enviar (el comandero no manda ítems sin precio).
  const base = price?.price_final_crc ?? null
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
      })
      onDone()
    } catch (e) { onError(e instanceof Error ? e.message : 'Error agregando ítem'); setSaving(false) }
  }

  return (
    <div className="cd-modal-overlay" onClick={onCancel}>
      <div className="cd-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="cd-modal-title">{product.nombre}</div>
        {groups.map(g => (
          <div key={g.id} style={{ marginBottom: 8 }}>
            <div style={{ fontSize: '0.74rem', fontWeight: 700 }}>{g.name}{g.required && <span style={{ color: '#c23b22' }}> * obligatorio</span>}</div>
            {g.modifiers.map(m => {
              const on = (picked[g.id] ?? []).includes(m.id)
              return (
                <button key={m.id} onClick={() => setPicked(prev => {
                  const cur = prev[g.id] ?? []
                  return { ...prev, [g.id]: on ? cur.filter(x => x !== m.id) : (g.max_selections === 1 ? [m.id] : [...cur, m.id]) }
                })}
                  style={{ margin: '2px 4px 2px 0', padding: '6px 12px', borderRadius: 14, fontSize: '0.78rem', cursor: 'pointer',
                    border: `1px solid ${on ? '#2a7a6a' : 'var(--t-border,#d4cfc4)'}`, background: on ? 'rgba(42,122,106,.15)' : 'transparent' }}>
                  {m.name}{m.price_delta_crc > 0 ? ` +${fi(m.price_delta_crc)}` : ''}
                </button>
              )
            })}
          </div>
        ))}
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
          <button onClick={() => setCourse(nextCourse(course))}
            style={{ border: '1px solid var(--t-border,#d4cfc4)', background: 'none', borderRadius: 12, padding: '4px 12px', fontSize: '0.76rem', cursor: 'pointer' }}>
            {COURSE_LABEL[course]} ⟳
          </button>
          <label style={{ fontSize: '0.76rem' }}>asiento
            <select className="tips-input-dark" style={{ marginLeft: 4 }} value={seat} onChange={e => setSeat(Number(e.target.value))}>
              {Array.from({ length: pax }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          {!sinPrecio && <span style={{ fontSize: '0.82rem' }}>precio: <strong>{fi(total)}</strong></span>}
        </div>
        {sinPrecio && <div style={{ color: '#c23b22', fontSize: '0.74rem', marginTop: 6 }}>⚠ Sin precio cargado — cargalo en Admin → 🍣 PoS → Precios para poder enviarlo.</div>}
        {valErr && <div style={{ color: '#c23b22', fontSize: '0.74rem', marginTop: 6 }}>⛔ {valErr}</div>}
        <div className="cd-modal-actions" style={{ marginTop: '0.75rem' }}>
          <button className="tips-btn-ghost" onClick={onCancel}>Cancelar</button>
          <button className="cd-btn-green" disabled={!!valErr || saving || sinPrecio} style={{ opacity: valErr || saving || sinPrecio ? 0.4 : 1 }} onClick={enviar}>
            {saving ? 'Agregando…' : '✓ Agregar al pedido'}
          </button>
        </div>
      </div>
    </div>
  )
}
