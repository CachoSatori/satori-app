import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../shared/hooks/useAuth'
import { supabase } from '../../shared/api/supabase'
import { todayCR, fi } from '../../shared/utils'

// ── Types ─────────────────────────────────────────────────────
interface DaySnapshot {
  date: string

  // Ventas (from ventas_dias)
  ventaNeta:   number
  ventaBruta:  number
  salon:       number
  delivery:    number
  pax:         number
  promPax:     number
  hasVentas:   boolean

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
    date, hasVentas: false, hasCaja: false, hasTips: false,
    ventaNeta: 0, ventaBruta: 0, salon: 0, delivery: 0, pax: 0, promPax: 0,
    cajaIngresos: 0, cajaEgresos: 0, cajaSaldo: 0, cajeroName: '', cajaStatus: '',
    tipPool: 0, tipPayout: 0, tipWorkers: 0, tipsStatus: '',
  }

  // Run all 3 queries in parallel
  const [ventasRes, cajaRes, tipsRes] = await Promise.allSettled([
    // Ventas
    supabase.from('ventas_dias').select('data').eq('session_date', date).maybeSingle(),

    // Caja — load ALL sessions for the day (BUG-8 FIX: was only loading latest)
    supabase.from('cash_sessions')
      .select('id, status, cajero_name, initial_cash_crc, initial_suppliers_crc')
      .eq('session_date', date)
      .order('created_at', { ascending: false }),

    // Tips — show open OR closed sessions (INT-4 FIX)
    supabase.from('tip_sessions')
      .select('id, status, pool_efectivo_crc, pool_efectivo_usd, exchange_rate, pool_barra_crc')
      .eq('session_date', date)
      .order('status', { ascending: true }) // 'closed' before 'open' alphabetically → prefer closed
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  // Process ventas
  if (ventasRes.status === 'fulfilled' && ventasRes.value.data) {
    const d = (ventasRes.value.data as { data: { saloneros: Record<string, {
      total?: number; iva?: number; serv?: number; pax?: number
      salon?: number; delivery?: number; esCajero?: boolean
    }> } }).data
    let vn = 0, iva = 0, serv = 0, salon = 0, delivery = 0, pax = 0
    for (const s of Object.values(d.saloneros ?? {})) {
      vn  += s.total ?? 0
      iva += s.iva   ?? 0
      serv+= s.serv  ?? 0
      if (s.esCajero) {
        delivery += (s as { delivery?: number }).delivery ?? 0
        salon    += (s as { salon?: number }).salon ?? 0
      } else {
        salon += s.total ?? 0
        pax   += s.pax   ?? 0
      }
    }
    snap.hasVentas  = vn > 0
    snap.ventaNeta  = vn
    snap.ventaBruta = vn + iva + serv
    snap.salon      = salon
    snap.delivery   = delivery
    snap.pax        = pax
    snap.promPax    = pax > 0 ? salon / pax : 0
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
    const ts = tipsRes.value.data as { id: string; pool_efectivo_crc: number; pool_efectivo_usd: number; exchange_rate: number; pool_barra_crc: number; status: string }
    snap.hasTips   = true
    snap.tipsStatus = ts.status
    snap.tipPool   = (ts.pool_efectivo_crc ?? 0)
      + (ts.pool_efectivo_usd ?? 0) * (ts.exchange_rate ?? 640)
      + (ts.pool_barra_crc ?? 0)

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
    lines.push('📂 Ventas: sin datos cargados')
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
  // Available dates with ventas data for prev/next navigation
  const [availDates, setAvailDates] = useState<string[]>([])

  useEffect(() => {
    // Load available dates once on mount
    import('../../shared/api/supabase').then(({ supabase }) => {
      supabase.from('ventas_dias' as never)
        .select('session_date')
        .order('session_date', { ascending: true })
        .then(({ data }) => {
          const dates = ((data ?? []) as { session_date: string }[]).map(r => r.session_date)
          setAvailDates(dates)
        })
    })
  }, [])

  useEffect(() => {
    setLoading(true)
    fetchSnapshot(date)
      .then(setSnap)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [date])

  const dateIdx  = availDates.indexOf(date)
  const hasPrev  = dateIdx > 0
  const hasNext  = dateIdx < availDates.length - 1 && date < today
  const goPrev   = () => { if (hasPrev) setDate(availDates[dateIdx - 1]) }
  const goNext   = () => { if (hasNext) setDate(availDates[dateIdx + 1]) }
  const goToday  = () => setDate(today)

  const isOwner = profile?.role === 'owner' || profile?.role === 'manager' || profile?.role === 'contador'

  return (
    <div className="resumen-module">
      {/* Header */}
      <div className="resumen-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontFamily: 'var(--font-serif)', fontSize: '1.4rem', color: 'var(--t-gold)' }}>日</span>
          <div>
            <div style={{ fontFamily: 'var(--font-serif)', fontWeight: 700, fontSize: '1rem', color: 'var(--t-gold)' }}>
              Resumen del Día
            </div>
            <div style={{ fontSize: '0.6rem', letterSpacing: '0.25em', color: '#555', textTransform: 'uppercase' }}>
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
            style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 2, padding: '0.35rem 0.5rem', color: '#f0ece4', fontSize: '0.82rem', fontFamily: 'DM Mono, monospace' }}
          />
          {snap && (snap.hasVentas || snap.hasTips || snap.hasCaja) && (
            <button
              onClick={() => shareResumen(buildShareText(date, snap), setCopied)}
              style={{ padding:'0.35rem 0.75rem', borderRadius:2, border:'1px solid #2a4a2a', background: copied ? 'rgba(74,154,106,.2)' : 'transparent', color: copied ? '#4a9a6a' : '#7aaa7a', fontSize:'0.75rem', cursor:'pointer', whiteSpace:'nowrap', transition:'all .2s' }}>
              {copied ? '✓ Copiado' : '📤 Compartir'}
            </button>
          )}
          <button className="cash-back-btn" style={{ borderColor: '#333', color: '#888' }}
            onClick={() => navigate('/')}>← Inicio</button>
        </div>
      </div>

      {/* Day navigation bar */}
      <div style={{ background:'#0d0d0d', borderBottom:'1px solid #1a1a1a', padding:'0.4rem 1rem', display:'flex', alignItems:'center', justifyContent:'space-between', gap:'0.5rem' }}>
        <button onClick={goPrev} disabled={!hasPrev}
          style={{ padding:'4px 12px', borderRadius:2, border:'1px solid #2a2a2a', background:'transparent', color: hasPrev ? '#888' : '#333', cursor: hasPrev ? 'pointer' : 'default', fontSize:'0.8rem' }}>
          ‹ Anterior
        </button>
        <div style={{ fontSize:'0.72rem', color:'#555', textAlign:'center' }}>
          {new Date(date + 'T12:00:00').toLocaleDateString('es-CR', { weekday:'long', day:'numeric', month:'long', year:'numeric' })}
          {date !== today && (
            <button onClick={goToday}
              style={{ marginLeft:'0.75rem', fontSize:'0.65rem', padding:'2px 8px', border:'1px solid #2a2a2a', background:'transparent', color:'#c8a030', borderRadius:10, cursor:'pointer' }}>
              Hoy
            </button>
          )}
        </div>
        <button onClick={goNext} disabled={!hasNext}
          style={{ padding:'4px 12px', borderRadius:2, border:'1px solid #2a2a2a', background:'transparent', color: hasNext ? '#888' : '#333', cursor: hasNext ? 'pointer' : 'default', fontSize:'0.8rem' }}>
          Siguiente ›
        </button>
      </div>

      {loading ? (
        <div className="resumen-body">
          <div style={{ padding: '4rem', textAlign: 'center', color: '#555' }}>Cargando…</div>
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
                    <div style={{ fontSize: '0.72rem', color: '#555', marginBottom: '0.3rem' }}>
                      Salón {fi(snap.salon)} · Delivery {fi(snap.delivery)}
                    </div>
                    {snap.ventaNeta > 0 && (
                      <div style={{ height: 4, background: '#2a2a2a', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${snap.salon/snap.ventaNeta*100}%`, background: 'var(--t-teal)' }} />
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="resumen-empty-hint">Subí el XLS del turno</div>
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
                        <div className="resumen-kpi-val" style={{ color: '#7ec8a0' }}>{fi(snap.cajaIngresos)}</div>
                      </div>
                      <div className="resumen-kpi">
                        <div className="resumen-kpi-label">Egresos</div>
                        <div className="resumen-kpi-val" style={{ color: '#f08070' }}>{fi(snap.cajaEgresos)}</div>
                      </div>
                      <div className="resumen-kpi">
                        <div className="resumen-kpi-label">Saldo neto</div>
                        <div className="resumen-kpi-val" style={{ color: snap.cajaSaldo >= 0 ? '#7ec8a0' : '#f08070' }}>
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
                        <div className="resumen-kpi-val" style={{ color: '#7ec8a0' }}>{fi(snap.tipPayout)}</div>
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
                <strong style={{ color: '#f08070' }}>- {fi(snap.tipPayout)}</strong>
              </div>
              <div className="resumen-reconcile-row resumen-reconcile-total">
                <span>Diferencia ventas vs caja</span>
                <strong style={{ color: Math.abs(snap.ventaNeta - snap.cajaIngresos) < 10000 ? '#7ec8a0' : '#f08070' }}>
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
