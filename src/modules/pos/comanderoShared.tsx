// Piezas compartidas del comandero — extraídas de ComanderoModule.tsx (consolidación,
// SIN cambio de comportamiento): helper fiscal, etiquetas y widgets hoja (solo props).
import { useState } from 'react'
import type { PosOrderItem } from '../../shared/api/pos'
import type { BillItem } from '../../shared/utils/posFiscal'
import type { PosCourse, Turno } from '../../shared/utils/posPricing'
import { canCloseShift } from '../../shared/utils/posPricing'
import type { MenuTile } from '../../shared/utils/comanderoMenu'
import { fi } from '../../shared/utils'

/** PosOrderItem → BillItem para la matemática fiscal (única verdad: computeTotals). */
export function toBillItem(it: PosOrderItem): BillItem {
  return {
    product_name: it.product_name, qty: it.qty, price_final_crc: it.base_price_crc,
    modifiers: it.modifiers.map(m => ({ name: m.name, price_delta_crc: m.price_delta_crc })),
    tax_type: it.tax_type, seat: it.seat, applies_service: it.aplica_servicio !== false,
  }
}

export const COURSE_LABEL: Record<PosCourse, string> = { bebida: '🥤 Bebida', entrada: '🥢 Entrada', principal: '🍣 Principal' }
export const KS_LABEL: Record<string, string> = { pendiente: '· por marchar', marchado: '🔥 en cocina', listo: '✅ listo', entregado: '✓ entregado' }

/** Chequeo de cierre de turno (regla de la dueña): el turno mañana puede cerrar con
 *  mesas abiertas; el último turno NO. Informativo — no toca la Caja. */
export function CierreTurnoModal({ openTables, onClose }: { openTables: string[]; onClose: () => void }) {
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
export function PaxModal({ initial, onCancel, onConfirm }: { initial: number | null; onCancel: () => void; onConfirm: (pax: number) => void }) {
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

/** Tile de producto del grid (foto si hay + fallback color por estación + nombre + precio). */
export function Tile({ t, busy, onAdd }: { t: MenuTile; busy: boolean; onAdd: () => void }) {
  return (
    <button className="cm-tap" disabled={busy} onClick={onAdd} title={`Agregar ${t.nombre}`}
      style={{ minHeight: 64, padding: 0, borderRadius: 8, cursor: 'pointer', textAlign: 'left', overflow: 'hidden',
        border: '1px solid var(--t-border,#d4cfc4)', borderLeft: `5px solid ${t.station === 'barra' ? '#c8a96e' : '#2a7a6a'}`,
        background: busy ? 'rgba(42,122,106,.18)' : '#fff', display: 'flex', flexDirection: 'column' }}>
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
  )
}

/** T3 — mini-popup de cantidad para alta directa: default 1, un tap en "Agregar"
 *  confirma (caso común rápido); ± para pedir varios sin tocar N veces. */
export function QtyPopup({ nombre, precio, onCancel, onConfirm }: {
  nombre: string; precio: number; onCancel: () => void; onConfirm: (qty: number) => void
}) {
  const [qty, setQty] = useState(1)
  const [saving, setSaving] = useState(false)
  const confirm = () => { if (saving) return; setSaving(true); onConfirm(qty) }
  return (
    <div className="cd-modal-overlay" onClick={onCancel}>
      <div className="cd-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 320, textAlign: 'center' }}>
        <div className="cd-modal-title" style={{ fontSize: '0.95rem' }}>{nombre}</div>
        <div style={{ fontSize: '0.78rem', color: '#5a5040', marginBottom: 8 }}>{fi(precio)} c/u</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, margin: '0.5rem 0' }}>
          <button className="cm-tap" onClick={() => setQty(q => Math.max(1, q - 1))} style={{ minWidth: 56, minHeight: 56, borderRadius: 8, border: '1px solid #5a5040', background: '#fff', fontSize: '1.6rem', cursor: 'pointer' }}>−</button>
          <strong style={{ fontSize: '2rem', minWidth: 40 }}>{qty}</strong>
          <button className="cm-tap" onClick={() => setQty(q => Math.min(99, q + 1))} style={{ minWidth: 56, minHeight: 56, borderRadius: 8, border: '1px solid #5a5040', background: '#fff', fontSize: '1.6rem', cursor: 'pointer' }}>+</button>
        </div>
        <div className="cd-modal-actions" style={{ marginTop: '0.5rem', gap: 8 }}>
          <button className="tips-btn-ghost cm-tap" style={{ minHeight: 52 }} onClick={onCancel}>Cancelar</button>
          <button className="cd-btn-green cm-tap" style={{ minHeight: 52, fontWeight: 800, flex: 1 }} disabled={saving} onClick={confirm}>
            {saving ? 'Agregando…' : `✓ Agregar${qty > 1 ? ` ×${qty}` : ''} · ${fi(precio * qty)}`}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Fila label/valor de la cuenta. */
export function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', color: muted ? '#5a5040' : 'inherit', fontSize: muted ? '0.76rem' : '0.86rem', padding: '1px 0' }}>
      <span>{label}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  )
}
