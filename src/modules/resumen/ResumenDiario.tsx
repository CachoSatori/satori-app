import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../shared/hooks/useAuth'
import { supabase } from '../../shared/api/supabase'
import { todayCR, fi } from '../../shared/utils'
import { CORTE_POS, restarDias, ventasDelRango } from '../ventas/ventasFuente'
import { totalesDelDia } from '../ventas/totalesVentas'

// ── Types ─────────────────────────────────────────────────────
interface DaySnapshot {
  date: string

  // Ventas (del PoS, día CR de factura; `totalesDelDia` = la misma suma que el módulo Ventas)
  ventaNeta:   number
  ventaBruta:  number
  salon:       number
  delivery:    number
  pax:         number
  promPax:     number
  hasVentas:   boolean
  /** La lectura del PoS falló (no es lo mismo que «no hubo ventas»). */
  ventasError: boolean

  // Caja (from cash_sessions + cash_movements)
  cajaIngresos:  number
  cajaEgresos:   number
  cajaSaldo:     number
  cajeroName:    string
  hasCaja:       boolean
  cajaStatus:    string

  // Propinas (from tip_sessions + tip_entries)
  tipPool:    number
  tipPayout:  number
  tipWorkers: number
  hasTips:    boolean
  tipsStatus: string
}

async function fetchSnapshot(date: string): Promise<DaySnapshot> {
  const snap: DaySnapshot = {
    date, hasVentas: false, ventasError: false, hasCaja: false, hasTips: false,
    ventaNeta: 0, ventaBruta: 0, salon: 0, delivery: 0, pax: 0, promPax: 0,
    cajaIngresos: 0, cajaEgresos: 0, cajaSaldo: 0, cajeroName: '', cajaStatus: '',
    tipPool: 0, tipPayout: 0, tipWorkers: 0, tipsStatus: '',
  }

  // Run all 3 queries in parallel
  const [ventasRes, cajaRes, tipsRes] = await Promise.allSettled([
    // Ventas: del PoS (16-nov: nunca más el xls)
    ventasDelRango(date, date),

    // Caja — load ALL sessions for the day (BUG-8 FIX: was only loading latest)
    supabase.from('cash_sessions')
      .select('id, status, cajero_name, initial_cash_crc, initial_suppliers_crc')
      .eq('session_date', date)
      .order('created_at', { ascending: false }),

    // Tips — show open OR closed sessions (INT-4 FIX)
    supabase.from('tip_sessions')
      .select('id, status, pool_efectivo_crc, pool_efectivo_usd, exchange_rate, pool_barra_crc, pool_barra_electronico_crc')
      .eq('session_date', date)
      .order('status', { ascending: true }) // 'closed' before 'open' alphabetically → prefer closed
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  // Process ventas
  if (ventasRes.status === 'fulfilled') {
    const t = totalesDelDia(ventasRes.value.dias[date])
    snap.hasVentas  = t.ventaNeta > 0
    snap.ventaNeta  = t.ventaNeta
    snap.ventaBruta = t.ventaBruta
    snap.salon      = t.salon
    snap.delivery   = t.delivery
    snap.pax        = t.pax
    snap.promPax    = t.promPax
  } else {
    snap.ventasError = true
  }

  // Process caja — now handles ALL sessions for the day (BUG-8 FIX)
  if (cajaRes.status === 'fulfilled' && cajaRes.value.data) {
    const sessions = cajaRes.value.data as { id: string; status: string; cajero_name: string }[]
    if (sessions.length > 0) {
      snap.hasCaja    = true
      // Show most recent cajero name; prefer open session if any
      const openSess  = sessions.find(s => s.status === 'open') ?? sessions[0]
      snap.cajaStatus = openSess.status
      snap.cajeroName = openSess.cajero_name ?? ''

      // Get movements for ALL sessions of the day
      const sessionIds = sessions.map(s => s.id)
      for (const sid of sessionIds) {
        const { data: movs } = await supabase
          .from('cash_movements')
          .select('movement_type, amount_crc')
          .eq('session_id', sid)
          .neq('status', 'rechazado')
        if (movs) {
          const ms = movs as { movement_type: string; amount_crc: number }[]
          snap.cajaIngresos += ms.filter(m => m.movement_type === 'ingreso').reduce((s, m) => s + m.amount_crc, 0)
          snap.cajaEgresos  += ms.filter(m => m.movement_type !== 'ingreso' && m.movement_type !== 'traspaso').reduce((s, m) => s + m.amount_crc, 0)
        }
      }
      snap.cajaSaldo = snap.cajaIngresos - snap.cajaEgresos
    }
  }

  // Process propinas
  if (tipsRes.status === 'fulfilled' && tipsRes.value.data) {
    const ts = tipsRes.value.data as { id: string; pool_efectivo_crc: number; pool_efectivo_usd: number; exchange_rate: number; pool_barra_crc: number; pool_barra_electronico_crc: number; status: string }
    snap.hasTips   = true
    snap.tipsStatus = ts.status
    snap.tipPool   = (ts.pool_efectivo_crc ?? 0)
      + (ts.pool_efectivo_usd ?? 0) * (ts.exchange_rate ?? 640)
      + (ts.pool_barra_crc ?? 0)
      + (ts.pool_barra_electronico_crc ?? 0)

    const { data: entries } = await supabase
      .from('tip_entries')
      .select('payout_crc')
      .eq('session_id', ts.id)
    if (entries) {
      const es = entries as { payout_crc: number | null }[]
      snap.tipPayout  = es.reduce((s, e) => s + (e.payout_crc ?? 0), 0)
      snap.tipWorkers = es.filter(e => e.payout_crc != null && e.payout_crc > 0).length
    }
  }

  return snap
}

// ── Share helper ──────────────────────────────────────────────
function buildShareText(date: string, snap: DaySnapshot): string {
  const dayLabel = new Date(date + 'T12:00:00').toLocaleDateString('es-CR', { weekday: 'long', day: 'numeric', month: 'long' })
  const lines: string[] = [
    `🍣 *SATORI — ${dayLabel}*`,
    '━━━━━━━━━━━━━━━━━━━━━',
  ]
  if (snap.hasVentas) {
    lines.push(`💰 Ventas: *${fi(snap.ventaNeta)}*`)
    if (snap.pax > 0) {
      lines.push(`👥 PAX: ${snap.pax}  •  Prom/PAX: *${fi(snap.promPax)}*`)
    }
    if (snap.delivery > 0) {
      lines.push(`🛵 Delivery: ${fi(snap.delivery)}  •  Salón: ${fi(snap.salon)}`)
    }
  } else {
    lines.push('📂 Ventas: sin ventas en el PoS')
  }
  lines.push('━━━━━━━━━━━━━━━━━━━━━')
  if (snap.hasTips) {
    const status = snap.tipsStatus === 'closed' ? '✅ cerrado' : '🔴 abierto'
    lines.push(`💵 Propinas: *${fi(snap.tipPool)}* (${snap.tipWorkers} emps) ${status}`)
  } else {
    lines.push('💵 Propinas: sin turno')
  }
  if (snap.hasCaja) {
    const status = snap.cajaStatus === 'closed' ? '✅ cerrado' : '🔴 abierto'
    lines.push(`🏦 Caja: +${fi(snap.cajaIngresos)} / -${fi(snap.cajaEgresos)} ${status}`)
    if (snap.cajaSaldo !== 0) lines.push(`   Saldo neto: *${fi(snap.cajaSaldo)}*`)
  } else {
    lines.push('🏦 Caja: sin turno')
  }
  lines.push('━━━━━━━━━━━━━━━━━━━━━')
  lines.push('_Satori Sushi Bar · Santa Teresa, CR_')
  return lines.join('\n')
}

async function shareResumen(text: string, setCopied: (v: boolean) => void) {
  // Try Web Share API (mobile)
  if (navigator.share) {
    try { await navigator.share({ text }); return } catch (_) { /* fallback */ }
  }
  // Fallback: clipboard
  try {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  } catch (_) {
    // Last resort: prompt
    window.prompt('Copiá el texto:', text)
  }
}

// ── Component ─────────────────────────────────────────────────
export default function ResumenDiario() {
  const { profile } = useAuth()
  const navigate    = useNavigate()
  const today       = todayCR()
  const [date, setDate]         = useState(today)
  const [snap, setSnap]         = useState<DaySnapshot | null>(null)
  const [loading, setLoading]   = useState(true)
  const [copied, setCopied]     = useState(false)
  useEffect(() => {
    setLoading(true)
    fetchSnapshot(date)
      .then(setSnap)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [date])

  // Día a día (antes saltaba entre los días con xls cargado; ahora todo día tiene PoS).
  const hasPrev  = date > CORTE_POS
  const hasNext  = date < today
  const goPrev   = () => { if (hasPrev) setDate(restarDias(date, 1)) }
  const goNext   = () => { if (hasNext) setDate(restarDias(date, -1)) }
  const goToday  = () => setDate(today)

  const isOwner = profile?.role === 'owner' || profile?.role === 'manager' || profile?.role === 'contador'

  return (
    <div className="resumen-module">
      {/* Header */}
      <div className="resumen-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontFamily: 'var(--font-serif)', fontSize: '1.4rem', color: 'var(--c-oro-texto)' }}>日</span>
          <div>
            <div style={{ fontFamily: 'var(--font-serif)', fontWeight: 700, fontSize: '1rem', color: 'var(--c-oro-texto)' }}>
              Resumen del Día
            </div>
            <div style={{ fontSize: '0.6rem', color: 'var(--c-gris)' }}>
              Satori · Santa Teresa
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <input
            type="date"
            value={date}
            max={todayCR()}
            onChange={e => setDate(e.target.value)}
            style={{ background: 'var(--c-panel)', border: '1px solid var(--c-linea)', borderRadius: 2, padding: '0.35rem 0.5rem', color: 'var(--c-tinta)', fontSize: '0.82rem', fontFamily: 'var(--font-sans)', fontVariantNumeric: 'tabular-nums' }}
          />
          {snap && (snap.hasVentas || snap.hasTips || snap.hasCaja) && (
            <button
              onClick={() => shareResumen(buildShareText(date, snap), setCopied)}
              style={{ padding:'0.35rem 0.75rem', borderRadius:2, border:'1px solid var(--c-musgo-borde)', background: copied ? 'var(--c-musgo-fondo)' : 'transparent', color: copied ? 'var(--c-musgo)' : 'var(--c-musgo)', fontSize:'0.75rem', cursor:'pointer', whiteSpace:'nowrap', transition:'all .2s' }}>
              {copied ? '✓ Copiado' : '📤 Compartir'}
            </button>
          )}
          <button className="cash-back-btn" style={{ borderColor: 'var(--c-linea)', color: 'var(--c-gris)' }}
            onClick={() => navigate('/')}>← Inicio</button>
        </div>
      </div>

      {/* Day navigation bar */}
      <div style={{ background:'var(--c-panel)', borderBottom:'1px solid var(--c-linea)', padding:'0.4rem 1rem', display:'flex', alignItems:'center', justifyContent:'space-between', gap:'0.5rem' }}>
        <button onClick={goPrev} disabled={!hasPrev}
          style={{ padding:'4px 12px', borderRadius:2, border:'1px solid var(--c-linea)', background:'transparent', color: hasPrev ? 'var(--c-gris)' : 'var(--c-gris-claro)', cursor: hasPrev ? 'pointer' : 'default', fontSize:'0.8rem' }}>
          ‹ Anterior
        </button>
        <div style={{ fontSize:'0.72rem', color:'var(--c-gris)', textAlign:'center' }}>
          {new Date(date + 'T12:00:00').toLocaleDateString('es-CR', { weekday:'long', day:'numeric', month:'long', year:'numeric' })}
          {date !== today && (
            <button onClick={goToday}
              style={{ marginLeft:'0.75rem', fontSize:'0.65rem', padding:'2px 8px', border:'1px solid var(--c-linea)', background:'transparent', color:'var(--c-oro-texto)', borderRadius:10, cursor:'pointer' }}>
              Hoy
            </button>
          )}
        </div>
        <button onClick={goNext} disabled={!hasNext}
          style={{ padding:'4px 12px', borderRadius:2, border:'1px solid var(--c-linea)', background:'transparent', color: hasNext ? 'var(--c-gris)' : 'var(--c-gris-claro)', cursor: hasNext ? 'pointer' : 'default', fontSize:'0.8rem' }}>
          Siguiente ›
        </button>
      </div>

      {loading ? (
        <div className="resumen-body">
          <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--c-gris)' }}>Cargando…</div>
        </div>
      ) : snap ? (
        <div className="resumen-body">
          <div className="resumen-date-label" style={{ display:'none' }}>
            {new Date(date + 'T12:00:00').toLocaleDateString('es-CR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </div>

          <div className="resumen-grid">

            {/* ── VENTAS ── */}
            <div className={`resumen-card ${snap.hasVentas ? '' : 'empty'}`} onClick={() => navigate('/ventas')}>
              <div className="resumen-card-header">
                <span className="resumen-card-kanji">売</span>
                <div>
                  <div className="resumen-card-title">Ventas</div>
                  <div className="resumen-card-sub">POS del día</div>
                </div>
                {snap.hasVentas
                  ? <span className="resumen-status ok">✓ Cargado</span>
                  : <span className="resumen-status pending">Sin datos</span>}
              </div>
              {snap.hasVentas ? (
                <div className="resumen-card-body">
                  <div className="resumen-kpi-row">
                    <div className="resumen-kpi">
                      <div className="resumen-kpi-label">Venta Neta</div>
                      <div className="resumen-kpi-val gold">{fi(snap.ventaNeta)}</div>
                    </div>
                    <div className="resumen-kpi">
                      <div className="resumen-kpi-label">PAX</div>
                      <div className="resumen-kpi-val">{snap.pax}</div>
                    </div>
                    <div className="resumen-kpi">
                      <div className="resumen-kpi-label">Prom/PAX</div>
                      <div className="resumen-kpi-val">{fi(snap.promPax)}</div>
                    </div>
                  </div>
                  <div className="resumen-split-bar">
                    <div style={{ fontSize: '0.72rem', color: 'var(--c-gris)', marginBottom: '0.3rem' }}>
                      Salón {fi(snap.salon)} · Delivery {fi(snap.delivery)}
                    </div>
                    {snap.ventaNeta > 0 && (
                      <div style={{ height: 4, background: 'var(--c-panel)', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${snap.salon/snap.ventaNeta*100}%`, background: 'var(--c-teal)' }} />
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="resumen-empty-hint">{snap.ventasError ? 'No se pudieron leer las ventas del PoS' : 'El PoS no tiene ventas de este día'}</div>
              )}
            </div>

            {/* ── CAJA ── */}
            {isOwner && (
              <div className={`resumen-card ${snap.hasCaja ? '' : 'empty'}`} onClick={() => navigate('/caja')}>
                <div className="resumen-card-header">
                  <span className="resumen-card-kanji">金</span>
                  <div>
                    <div className="resumen-card-title">Caja</div>
                    <div className="resumen-card-sub">{snap.cajeroName || 'Movimientos del día'}</div>
                  </div>
                  {snap.hasCaja ? (
                    <span className={`resumen-status ${snap.cajaStatus === 'closed' ? 'ok' : 'open'}`}>
                      {snap.cajaStatus === 'closed' ? '✓ Cerrado' : '● Abierto'}
                    </span>
                  ) : <span className="resumen-status pending">Sin turno</span>}
                </div>
                {snap.hasCaja ? (
                  <div className="resumen-card-body">
                    <div className="resumen-kpi-row">
                      <div className="resumen-kpi">
                        <div className="resumen-kpi-label">Ingresos</div>
                        <div className="resumen-kpi-val" style={{ color: 'var(--c-musgo)' }}>{fi(snap.cajaIngresos)}</div>
                      </div>
                      <div className="resumen-kpi">
                        <div className="resumen-kpi-label">Egresos</div>
                        <div className="resumen-kpi-val" style={{ color: 'var(--c-laca)' }}>{fi(snap.cajaEgresos)}</div>
                      </div>
                      <div className="resumen-kpi">
                        <div className="resumen-kpi-label">Saldo neto</div>
                        <div className="resumen-kpi-val" style={{ color: snap.cajaSaldo >= 0 ? 'var(--c-musgo)' : 'var(--c-laca)' }}>
                          {fi(snap.cajaSaldo)}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="resumen-empty-hint">Abrí el turno de caja</div>
                )}
              </div>
            )}

            {/* ── PROPINAS ── */}
            {isOwner && (
              <div className={`resumen-card ${snap.hasTips ? '' : 'empty'}`} onClick={() => navigate('/propinas')}>
                <div className="resumen-card-header">
                  <span className="resumen-card-kanji">心</span>
                  <div>
                    <div className="resumen-card-title">Propinas</div>
                    <div className="resumen-card-sub">Pool del turno</div>
                  </div>
                  {snap.hasTips ? (
                    <span className={`resumen-status ${snap.tipsStatus === 'closed' ? 'ok' : 'open'}`}>
                      {snap.tipsStatus === 'closed' ? '✓ Cerrado' : '● Abierto'}
                    </span>
                  ) : <span className="resumen-status pending">Sin turno</span>}
                </div>
                {snap.hasTips ? (
                  <div className="resumen-card-body">
                    <div className="resumen-kpi-row">
                      <div className="resumen-kpi">
                        <div className="resumen-kpi-label">Pool total</div>
                        <div className="resumen-kpi-val gold">{fi(snap.tipPool)}</div>
                      </div>
                      <div className="resumen-kpi">
                        <div className="resumen-kpi-label">Distribuido</div>
                        <div className="resumen-kpi-val" style={{ color: 'var(--c-musgo)' }}>{fi(snap.tipPayout)}</div>
                      </div>
                      <div className="resumen-kpi">
                        <div className="resumen-kpi-label">Empleados</div>
                        <div className="resumen-kpi-val">{snap.tipWorkers}</div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="resumen-empty-hint">Cerrá el turno de propinas</div>
                )}
              </div>
            )}

          </div>

          {/* Cross-module reconciliation */}
          {isOwner && snap.hasVentas && snap.hasTips && snap.hasCaja && (
            <div className="resumen-reconcile">
              <div className="resumen-reconcile-title">Cuadre del día</div>
              <div className="resumen-reconcile-row">
                <span>Venta neta (POS)</span>
                <strong>{fi(snap.ventaNeta)}</strong>
              </div>
              <div className="resumen-reconcile-row">
                <span>Ingresos caja registrados</span>
                <strong>{fi(snap.cajaIngresos)}</strong>
              </div>
              <div className="resumen-reconcile-row">
                <span>Propinas distribuidas</span>
                <strong style={{ color: 'var(--c-laca)' }}>- {fi(snap.tipPayout)}</strong>
              </div>
              <div className="resumen-reconcile-row resumen-reconcile-total">
                <span>Diferencia ventas vs caja</span>
                <strong style={{ color: Math.abs(snap.ventaNeta - snap.cajaIngresos) < 10000 ? 'var(--c-musgo)' : 'var(--c-laca)' }}>
                  {fi(snap.ventaNeta - snap.cajaIngresos)}
                </strong>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
