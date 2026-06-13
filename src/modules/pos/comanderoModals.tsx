// Modales del comandero — extraídos de ComanderoModule.tsx (consolidación, SIN cambio
// de comportamiento: mover + importar). Cada uno recibe todo por props.
import { useState, useEffect, useMemo } from 'react'
import {
  addOrderItem, deleteOrderItem,
  transferOrder, cobrarOrden, setOrderChecks, cobrarCheck,
  reorderRound, mergeOrders, getOpenOrders, getClosedOrdersToday, reopenOrder, getProductGroups,
  getPaymentByClientOpId,
} from '../../shared/api/pos'
import { emitirFeDocumento } from '../../shared/api/fe'
import { depleteOrderInventory } from '../../shared/api/inventario'
import { getCurrentRate } from '../../shared/api/exchangeRate'
import { calcularVuelto, vueltoPagoUsd, convertirCrcAUsd, convertirUsdACrc } from '../../shared/utils/posCobro'
import { renderTicketCobro } from '../../shared/utils/posTicket'
import type { TicketFiscal } from '../../shared/utils/posTicket'
import type { PosPayment, PosCheck, PosOrder, PosOrderItem, ModifierGroupRow, ModifierRow, PosPrice } from '../../shared/api/pos'
import { splitEven, splitByGroup, splitByItem } from '../../shared/utils/posSplit'
import type { SplitCheck } from '../../shared/utils/posSplit'
import { getAllProfiles } from '../../shared/api/admin'
import type { Profile } from '../../shared/types/database'
import { computeItemPrice, validateItemSelections, defaultCourseForTipo, nextCourse } from '../../shared/utils/posPricing'
import type { PosCourse } from '../../shared/utils/posPricing'
import { computeTotals, groupBySeat } from '../../shared/utils/posFiscal'
import type { BillItem } from '../../shared/utils/posFiscal'
import { useAuth } from '../../shared/hooks/useAuth'
import { useManagerOverride } from '../../shared/ManagerOverride'
import { fi } from '../../shared/utils'
import { toBillItem, COURSE_LABEL, Row, AllergenLine } from './comanderoShared'

/** F20 — Reabrir una orden cerrada (patrón Lavu): lista las cerradas de hoy → permiso
 *  de gerencia + motivo → reabre (los pagos previos quedan como historial). Recierre
 *  manual cobrando de nuevo. */
export function ReabrirModal({ loc, onClose, onReopened, onError }: {
  loc: string; onClose: () => void; onReopened: (o: PosOrder) => void; onError: (e: string) => void
}) {
  const { profile } = useAuth()
  const requireManager = useManagerOverride()
  const [cerradas, setCerradas] = useState<PosOrder[]>([])
  const [motivo, setMotivo] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { getClosedOrdersToday(loc).then(setCerradas).catch(e => onError(e instanceof Error ? e.message : 'Error')) }, [loc, onError])

  const reabrir = async (o: PosOrder) => {
    if (busy || !profile) return
    if (!motivo.trim()) { onError('Indicá el motivo para reabrir'); return }
    if (!(await requireManager())) return
    setBusy(true)
    try {
      await reopenOrder(o.id, profile.full_name ?? '', motivo.trim())
      onReopened({ ...o, status: 'open' })
    } catch (e) { onError(e instanceof Error ? e.message : 'No se pudo reabrir'); setBusy(false) }
  }

  return (
    <div className="cd-modal-overlay" onClick={onClose}>
      <div className="cd-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400, maxHeight: '82vh', overflowY: 'auto' }}>
        <div className="cd-modal-title">↺ Reabrir mesa cerrada</div>
        <div style={{ fontSize: '0.74rem', color: '#5a5040', margin: '0.25rem 0 0.5rem' }}>
          Para corregir o reimprimir. Los pagos anteriores quedan como historial (no se revierten). Requiere gerencia. La mesa se recierra cobrando de nuevo.
        </div>
        <input className="tips-input-dark" style={{ width: '100%', marginBottom: 8 }} placeholder="Motivo (obligatorio)…" value={motivo} onChange={e => setMotivo(e.target.value)} />
        {cerradas.length === 0 && <div style={{ color: '#5a5040', fontSize: '0.82rem' }}>No hay mesas cerradas hoy en este local.</div>}
        {cerradas.map(o => (
          <button key={o.id} disabled={busy} className="cm-tap" onClick={() => reabrir(o)}
            style={{ display: 'block', width: '100%', textAlign: 'left', minHeight: 48, marginBottom: 6, borderRadius: 6, cursor: 'pointer',
              border: '1px solid var(--t-border,#d4cfc4)', background: '#fff', padding: '0 12px', fontWeight: 700, fontSize: '0.84rem' }}>
            {o.table_name} <span style={{ color: '#5a5040', fontWeight: 400, fontSize: '0.72rem' }}>· {o.pax}p · {o.salonero_name}{o.closed_at ? ` · cerró ${new Date(o.closed_at).toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
          </button>
        ))}
        <div className="cd-modal-actions" style={{ marginTop: 6 }}>
          <button className="tips-btn-ghost cm-tap" style={{ minHeight: 48 }} onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  )
}

/** T3 — Otra ronda (SPEC F11): reenvía ítems ya enviados como nuevos (pendientes),
 *  con cantidad ± por ítem. Pensado para la barra (otra vuelta sin navegar el menú). */
export function ReorderModal({ order, enviados, onClose, onDone, onError }: {
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
export function MergeModal({ order, cajero, onClose, onDone, onError }: {
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
export function TransferModal({ order, onClose, onDone, onError }: {
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
export function CuentaView({ order, items, checks, onClose, onCobrar, onCobrarCheck, onSplit, onUnsplit }: {
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
export function SplitModal({ order, items, onClose, onDone, onError }: {
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
export function CheckoutModal({ order, items, cajero, check, onClose, onDone, onError }: {
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
  const [invMsg, setInvMsg] = useState<string | null>(null)   // resumen depleción de inventario (F1)
  // Idempotencia del cobro (mig 033): UN client_op_id por pantalla de checkout (no por tap)
  // → un doble-tap o reintento colapsa en una sola fila de pago.
  const [clientOpId] = useState(() => crypto.randomUUID())

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
        created_by: profile.id, client_op_id: clientOpId,
      }
      const res = check
        ? await cobrarCheck(check.id, payment, profile.id)
        : (await cobrarOrden(payment, profile.id), { orderClosed: true })
      setClosed(res.orderClosed)

      // FE estructura: generar el documento electrónico (SIM) del cobro. NO llama a
      // Hacienda. Si algo falla acá, el cobro YA quedó hecho → no se revierte; el ticket
      // sale con el bloque fiscal en error/pendiente. Totales fiscales DERIVADOS de
      // computeTotals (para un check, escalados al monto cobrado).
      let fiscal: TicketFiscal | null = null
      try {
        const pago = payment.client_op_id ? await getPaymentByClientOpId(payment.client_op_id) : null
        // Escala neto/IVA/servicio al monto del check si es un split; full order = 1.
        const factor = check && totals.total > 0 ? payTotal / totals.total : 1
        const r2 = (n: number) => Math.round(n * factor * 100) / 100
        const fe = await emitirFeDocumento({
          order_id: order.id, payment_id: pago?.id ?? null, check_id: check?.id ?? null,
          tipo: 'tiquete',
          total_neto: r2(totals.neto), total_iva: r2(totals.iva),
          total_servicio: r2(totals.servicio), total: payTotal,
        })
        fiscal = { tipo: fe.tipo, estado: fe.estado, consecutivo: fe.consecutivo, clave: fe.clave,
          provider_ref: fe.provider_ref, receptor_nombre: fe.receptor_nombre, receptor_id: fe.receptor_id }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('FE SIM no emitió (cobro ya registrado):', e)
        fiscal = { tipo: 'tiquete', estado: 'error' }
      }

      // Inventario Activo F1: al CERRAR el pedido, descontar stock por receta (idempotente
      // por order.id). Best-effort: si falla, el cobro YA quedó hecho (no se revierte).
      // Solo cuando se cierra la mesa entera (no en cobros parciales de un split).
      if (res.orderClosed) {
        try {
          const dep = await depleteOrderInventory(order, items, profile.id)
          if (dep.alreadyDone) setInvMsg(null)
          else {
            const parts: string[] = []
            if (dep.movements > 0) parts.push(`📉 ${dep.movements} ingrediente${dep.movements === 1 ? '' : 's'} descontado${dep.movements === 1 ? '' : 's'} · COGS ₡${Math.round(dep.cogs_crc).toLocaleString('es-CR')}`)
            if (dep.noRecipe.length > 0) parts.push(`⚠ ${dep.noRecipe.length} producto${dep.noRecipe.length === 1 ? '' : 's'} sin receta (no descontó)`)
            if (dep.lowStock.length > 0) parts.push(`🟡 bajo stock: ${dep.lowStock.map(l => l.name).slice(0, 4).join(', ')}`)
            setInvMsg(parts.length ? parts.join(' · ') : null)
          }
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('Depleción de inventario falló (cobro ya registrado):', e)
        }
      }

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
        fiscal,
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
        {invMsg && (
          <div style={{ fontSize: '0.64rem', color: '#7a6a2a', marginTop: 4, background: '#1a1808', borderRadius: 4, padding: '4px 6px' }}>
            {invMsg}
          </div>
        )}
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


/** Modal de ítem: modificadores (obligatorios bloquean), curso y asiento.
 *  Con editItem (SPEC C3) edita un ítem NO marchado: prefill de todo, y al guardar
 *  reemplaza el ítem (agrega el nuevo y borra el viejo). */
export function ItemPicker({ product, price, pax, orderId, meta, editItem, defaultSeat, defaultCourse, onDone, onCancel, onError }: {
  meta: { tipo: string; subclasificacion: string; station: string; aplica_servicio: boolean; allergens?: string } | null
  product: { nombre: string; tipo: string }; price: PosPrice | null; pax: number; orderId: string
  editItem?: PosOrderItem | null
  defaultSeat?: number; defaultCourse?: PosCourse | null
  onDone: () => void; onCancel: () => void; onError: (e: string) => void
}) {
  const [groups, setGroups] = useState<Array<ModifierGroupRow & { modifiers: ModifierRow[] }>>([])
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [course, setCourse] = useState<PosCourse>(editItem?.course ?? defaultCourse ?? defaultCourseForTipo(product.tipo))
  const [seat, setSeat]     = useState(editItem?.seat ?? defaultSeat ?? 1)
  const [qty, setQty]       = useState(editItem?.qty ?? 1)   // T4: cantidad rápida (no en edición)
  const [note, setNote]     = useState(editItem?.note ?? '')   // T2 carta-real: nota por ítem
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
        price_crc: total, tax_type: taxType, seat, course, note: note.trim(),
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
        <AllergenLine raw={meta?.allergens} />
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
        {/* T2 carta-real: nota por ítem (sin cebolla, término, etc.) → va a cocina */}
        <input className="tips-input-dark" style={{ width: '100%', marginTop: 8 }} value={note}
          placeholder="Nota para cocina (opcional): sin cebolla, término…"
          onChange={e => { setDirty(true); setNote(e.target.value) }} />
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
