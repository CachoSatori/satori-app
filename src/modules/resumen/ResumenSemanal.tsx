/**
 * ResumenSemanal — Digest de la semana para revisión del lunes
 * Compara esta semana vs semana anterior en ventas, propinas y equipo.
 */
import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../shared/hooks/useAuth'
import { supabase } from '../../shared/api/supabase'
import { todayCR, fi } from '../../shared/utils'

// ── Date helpers ───────────────────────────────────────────────
function startOfWeek(date: string): string {
  const d = new Date(date + 'T12:00:00')
  const day = d.getDay() // 0=Dom, 1=Lun...
  const diff = day === 0 ? -6 : 1 - day // CR week starts Monday
  d.setDate(d.getDate() + diff)
  return d.toISOString().slice(0, 10)
}
function addDays(date: string, n: number): string {
  const d = new Date(date + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}
function fmtShort(d: string): string {
  const [, m, dd] = d.split('-')
  const MSHORT = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
  return `${Number(dd)} ${MSHORT[Number(m)-1]}`
}

const DAYS_CR = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb']
function dowLabel(date: string): string {
  return DAYS_CR[new Date(date + 'T12:00:00').getDay()]
}

// ── Weekly snapshot ─────────────────────────────────────────────
interface DayData { fecha: string; ventaNeta: number; pax: number }
interface SalData { nombre: string; total: number; pax: number; promPax: number; days: number }
interface WeekSnapshot {
  from: string; to: string
  ventaNeta: number; ventaBruta: number; pax: number; promPax: number
  days: DayData[]
  topSal: SalData[]
  propinas: number; propTurnos: number
  bestDay: DayData | null; worstDay: DayData | null
}

async function fetchWeek(from: string, to: string): Promise<WeekSnapshot> {
  const { data: diasRows } = await supabase
    .from('ventas_dias')
    .select('session_date, data')
    .gte('session_date', from).lte('session_date', to) as {
      data: Array<{ session_date: string; data: { saloneros: Record<string, {
        total?: number; iva?: number; serv?: number; pax?: number
        esCajero?: boolean; delivery?: number
      }> } }> | null
    }

  let ventaNeta = 0, ventaBruta = 0, pax = 0
  const days: DayData[] = []
  const salMap: Record<string, { total: number; pax: number; days: number }> = {}

  for (const row of diasRows ?? []) {
    let dayVenta = 0, dayIVA = 0, dayServ = 0, dayPax = 0
    for (const [name, s] of Object.entries(row.data?.saloneros ?? {})) {
      dayVenta += s.total ?? 0
      dayIVA   += (s as { iva?: number }).iva ?? 0
      dayServ  += (s as { serv?: number }).serv ?? 0
      if (!(s as { esCajero?: boolean }).esCajero) {
        dayPax += s.pax ?? 0
        const k = name.toUpperCase().trim()
        if (!salMap[k]) salMap[k] = { total: 0, pax: 0, days: 0 }
        salMap[k].total += s.total ?? 0
        salMap[k].pax   += s.pax ?? 0
        salMap[k].days++
      }
    }
    ventaNeta  += dayVenta
    ventaBruta += dayVenta + dayIVA + dayServ
    pax        += dayPax
    days.push({ fecha: row.session_date, ventaNeta: dayVenta, pax: dayPax })
  }

  // Propinas
  const { data: tipSess } = await supabase
    .from('tip_sessions').select('pool_efectivo_crc,pool_efectivo_usd,exchange_rate,pool_barra_crc')
    .eq('status','closed').gte('session_date', from).lte('session_date', to)
  let propinas = 0
  for (const s of (tipSess ?? []) as Array<{pool_efectivo_crc:number;pool_efectivo_usd:number;exchange_rate:number;pool_barra_crc:number}>) {
    propinas += (s.pool_efectivo_crc ?? 0) + (s.pool_efectivo_usd ?? 0) * (s.exchange_rate ?? 640) + (s.pool_barra_crc ?? 0)
  }

  const sortedDays = [...days].sort((a, b) => b.ventaNeta - a.ventaNeta)
  const topSal = Object.entries(salMap)
    .map(([nombre, d]) => ({ nombre, ...d, promPax: d.pax > 0 ? d.total / d.pax : 0 }))
    .sort((a, b) => b.promPax - a.promPax)
    .slice(0, 5)

  return {
    from, to, ventaNeta, ventaBruta, pax,
    promPax: pax > 0 ? ventaNeta / pax : 0,
    days: days.sort((a, b) => a.fecha.localeCompare(b.fecha)),
    topSal,
    propinas,
    propTurnos: (tipSess ?? []).length,
    bestDay:  sortedDays[0]  ?? null,
    worstDay: sortedDays[sortedDays.length - 1] ?? null,
  }
}

// ── Component ───────────────────────────────────────────────────
export default function ResumenSemanal() {
  const { profile } = useAuth()
  const navigate    = useNavigate()
  const today       = todayCR()

  const weekStarts = useMemo(() => {
    const current  = startOfWeek(today)
    const previous = startOfWeek(addDays(current, -1))
    return { current, previous }
  }, [today])

  const [thisWeek, setThisWeek]   = useState<WeekSnapshot | null>(null)
  const [lastWeek, setLastWeek]   = useState<WeekSnapshot | null>(null)
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    const tw_from = weekStarts.current
    const tw_to   = addDays(tw_from, 6)
    const lw_from = weekStarts.previous
    const lw_to   = addDays(lw_from, 6)

    setLoading(true)
    Promise.all([fetchWeek(tw_from, tw_to), fetchWeek(lw_from, lw_to)])
      .then(([tw, lw]) => { setThisWeek(tw); setLastWeek(lw) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [weekStarts])

  const varVenta = thisWeek && lastWeek && lastWeek.ventaNeta > 0
    ? ((thisWeek.ventaNeta - lastWeek.ventaNeta) / lastWeek.ventaNeta * 100)
    : null
  const varProp = thisWeek && lastWeek && lastWeek.propinas > 0
    ? ((thisWeek.propinas - lastWeek.propinas) / lastWeek.propinas * 100)
    : null

  const isManager = ['owner','manager','contador'].includes(profile?.role ?? '')
  const [copied, setCopied] = useState(false)

  const buildWeekShare = () => {
    if (!thisWeek) return ''
    const pctV = varVenta !== null ? ` (${varVenta >= 0 ? '▲' : '▼'}${Math.abs(varVenta).toFixed(1)}% vs sem ant)` : ''
    const pctP = varProp !== null ? ` (${varProp >= 0 ? '▲' : '▼'}${Math.abs(varProp).toFixed(1)}% vs sem ant)` : ''
    return [
      `📅 *SATORI — Semana ${fmtShort(thisWeek.from)} al ${fmtShort(thisWeek.to)}*`,
      '━━━━━━━━━━━━━━━━━━━━',
      `💰 Ventas: *${fi(thisWeek.ventaNeta)}*${pctV}`,
      thisWeek.pax > 0 ? `👥 PAX: ${thisWeek.pax}  •  Prom/PAX: *${fi(thisWeek.ventaNeta / thisWeek.pax)}*` : '',
      thisWeek.propinas > 0 ? `💵 Propinas: *${fi(thisWeek.propinas)}*${pctP}` : '',
      thisWeek.days.length > 0 ? `📆 ${thisWeek.days.length} días trabajados` : '',
      '━━━━━━━━━━━━━━━━━━━━',
      '_Satori · Santa Teresa, CR_',
    ].filter(Boolean).join('\n')
  }

  async function doShare() {
    const text = buildWeekShare()
    if (navigator.share) { try { await navigator.share({ text }); return } catch (_) {} }
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2500) }
    catch (_) { window.prompt('Copiá:', text) }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0d0d0d', fontFamily: 'var(--font-sans)', color: '#f5f0e8' }}>

      {/* Header */}
      <div style={{ background: '#0d0d0d', borderBottom: '1px solid #1a1a1a', padding: '0 1.75rem', height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontFamily: 'var(--font-serif)', fontSize: '1.3rem', color: '#c8a96e' }}>週</span>
          <div>
            <div style={{ fontFamily: 'var(--font-serif)', fontWeight: 700, fontSize: '0.9rem', color: '#c8a96e' }}>Semana</div>
            <div style={{ fontSize: '0.6rem', letterSpacing: '0.2em', color: '#555', textTransform: 'uppercase' }}>Satori</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {thisWeek && (
            <span style={{ fontSize: '0.72rem', color: '#666' }}>
              {fmtShort(thisWeek.from)} — {fmtShort(thisWeek.to)}
            </span>
          )}
          {thisWeek && thisWeek.ventaNeta > 0 && (
            <button onClick={doShare}
              style={{ padding:'4px 10px', borderRadius:2, border:'1px solid #2a4a2a', background: copied ? 'rgba(74,154,106,.15)' : 'transparent', color: copied ? '#4a9a6a' : '#888', fontSize:'0.72rem', cursor:'pointer' }}>
              {copied ? '✓ Copiado' : '📤 Compartir'}
            </button>
          )}
          <button className="cash-back-btn" style={{ borderColor: '#333', color: '#888' }} onClick={() => navigate('/')}>← Inicio</button>
        </div>
      </div>

      <div style={{ background: '#f5f0e8', color: '#0d0d0d', minHeight: 'calc(100vh - 52px)', padding: '1.5rem' }}>
        {loading ? (
          <div style={{ padding: '4rem', textAlign: 'center', color: '#888' }}>Cargando semana…</div>
        ) : !thisWeek ? null : (
          <>
            {/* Main KPIs vs last week */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.875rem', marginBottom: '1.5rem' }}>
              {[
                {
                  label: 'Ventas esta semana',
                  val: fi(thisWeek.ventaNeta),
                  sub: lastWeek && lastWeek.ventaNeta > 0 ? fi(lastWeek.ventaNeta) + ' sem. ant.' : undefined,
                  var: varVenta,
                  color: '#c8a96e',
                  border: '#c8a96e',
                },
                {
                  label: 'PAX totales',
                  val: String(thisWeek.pax),
                  sub: 'Prom/PAX: ' + fi(thisWeek.promPax),
                  color: '#f5f0e8',
                  border: '#4a7c59',
                },
                {
                  label: 'Propinas pagadas',
                  val: fi(thisWeek.propinas),
                  sub: `${thisWeek.propTurnos} turnos`,
                  var: varProp,
                  color: '#7ec8a0',
                  border: '#4a7c59',
                },
                {
                  label: 'Días trabajados',
                  val: String(thisWeek.days.filter(d => d.ventaNeta > 0).length),
                  sub: `de ${thisWeek.days.length} días esta semana`,
                  color: '#f5f0e8',
                  border: '#555',
                },
              ].map(k => (
                <div key={k.label} style={{ background: '#0d0d0d', color: '#e8e2d8', borderRadius: 3, padding: '1rem 1.1rem', borderLeft: `3px solid ${k.border}` }}>
                  <div style={{ fontSize: '0.62rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#555', marginBottom: '0.3rem' }}>{k.label}</div>
                  <div style={{ fontFamily: "'DM Mono',monospace", fontSize: '1.1rem', fontWeight: 800, color: k.color, lineHeight: 1 }}>{k.val}</div>
                  {k.sub && <div style={{ fontSize: '0.65rem', color: '#555', marginTop: '0.2rem' }}>{k.sub}</div>}
                  {k.var !== null && k.var !== undefined && (
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, marginTop: '0.2rem', color: k.var >= 0 ? '#7ec8a0' : '#f08070' }}>
                      {k.var >= 0 ? '▲' : '▼'} {Math.abs(k.var).toFixed(1)}% vs sem. ant.
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Day-by-day bars */}
            {thisWeek.days.filter(d => d.ventaNeta > 0).length > 0 && (
              <div style={{ background: '#0d0d0d', color: '#e8e2d8', borderRadius: 3, padding: '1.1rem', marginBottom: '1.25rem' }}>
                <div style={{ fontSize: '0.68rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#c8a96e', marginBottom: '0.75rem', fontWeight: 700 }}>Ventas por día</div>
                {(() => {
                  const maxV = Math.max(...thisWeek.days.map(d => d.ventaNeta), 1)
                  return thisWeek.days.filter(d => d.ventaNeta > 0).map(d => (
                    <div key={d.fecha} style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '0.4rem' }}>
                      <div style={{ width: 36, fontSize: '0.68rem', color: '#555', flexShrink: 0 }}>
                        {dowLabel(d.fecha)}
                      </div>
                      <div style={{ flex: 1, height: 14, background: '#1a1a1a', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{
                          height: '100%',
                          width: `${d.ventaNeta / maxV * 100}%`,
                          background: d.fecha === thisWeek.bestDay?.fecha ? '#c8a96e' : '#2a4a6b',
                          borderRadius: 2,
                          transition: 'width 0.4s',
                        }} />
                      </div>
                      <div style={{ width: 100, fontSize: '0.72rem', textAlign: 'right', fontFamily: "'DM Mono',monospace", fontWeight: 600, color: d.fecha === thisWeek.bestDay?.fecha ? '#c8a96e' : '#aaa' }}>
                        {fi(d.ventaNeta)}
                      </div>
                    </div>
                  ))
                })()}
                {thisWeek.bestDay && (
                  <div style={{ marginTop: '0.5rem', fontSize: '0.68rem', color: '#555', borderTop: '1px solid #1a1a1a', paddingTop: '0.5rem' }}>
                    Mejor día: <strong style={{ color: '#c8a96e' }}>{dowLabel(thisWeek.bestDay.fecha)} {fmtShort(thisWeek.bestDay.fecha)}</strong> — {fi(thisWeek.bestDay.ventaNeta)}
                    {thisWeek.worstDay && thisWeek.worstDay.fecha !== thisWeek.bestDay.fecha && (
                      <span style={{ marginLeft: '1rem' }}>
                        Más bajo: <strong style={{ color: '#888' }}>{dowLabel(thisWeek.worstDay.fecha)}</strong> — {fi(thisWeek.worstDay.ventaNeta)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Split: saloneros + last week comparison */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>

              {/* Top saloneros */}
              {thisWeek.topSal.length > 0 && (
                <div style={{ background: '#0d0d0d', color: '#e8e2d8', borderRadius: 3, padding: '1.1rem' }}>
                  <div style={{ fontSize: '0.68rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#c8a96e', marginBottom: '0.75rem', fontWeight: 700 }}>
                    🏆 Top Prom/PAX
                  </div>
                  {thisWeek.topSal.map((s, i) => (
                    <div key={s.nombre} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.35rem 0', borderBottom: '1px solid #1a1a1a' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontSize: '0.82rem' }}>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`}</span>
                        <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>{s.nombre}</span>
                        <span style={{ fontSize: '0.62rem', color: '#555' }}>{s.days}d</span>
                      </div>
                      <span style={{ fontFamily: "'DM Mono',monospace", fontWeight: 700, fontSize: '0.85rem', color: '#c8a96e' }}>
                        {fi(s.promPax)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* vs last week */}
              {lastWeek && lastWeek.ventaNeta > 0 && (
                <div style={{ background: '#0d0d0d', color: '#e8e2d8', borderRadius: 3, padding: '1.1rem' }}>
                  <div style={{ fontSize: '0.68rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#555', marginBottom: '0.75rem', fontWeight: 700 }}>
                    vs Semana anterior ({fmtShort(lastWeek.from)}–{fmtShort(lastWeek.to)})
                  </div>
                  {[
                    { label: 'Ventas', cur: thisWeek.ventaNeta, prev: lastWeek.ventaNeta },
                    { label: 'PAX', cur: thisWeek.pax, prev: lastWeek.pax },
                    { label: 'Prom/PAX', cur: thisWeek.promPax, prev: lastWeek.promPax },
                    { label: 'Propinas', cur: thisWeek.propinas, prev: lastWeek.propinas },
                  ].map(row => {
                    const diff = row.prev > 0 ? (row.cur - row.prev) / row.prev * 100 : null
                    const col  = diff === null ? '#555' : diff >= 0 ? '#7ec8a0' : '#f08070'
                    return (
                      <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.35rem 0', borderBottom: '1px solid #1a1a1a', fontSize: '0.8rem' }}>
                        <span style={{ color: '#888' }}>{row.label}</span>
                        <div style={{ textAlign: 'right' }}>
                          <span style={{ fontFamily: "'DM Mono',monospace", fontWeight: 600 }}>{fi(row.cur)}</span>
                          {diff !== null && (
                            <span style={{ marginLeft: '0.5rem', fontSize: '0.65rem', fontWeight: 700, color: col }}>
                              {diff >= 0 ? '▲' : '▼'}{Math.abs(diff).toFixed(0)}%
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Quick links */}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {isManager && [
                { path: '/ventas',   label: '売 Ventas completo' },
                { path: '/propinas', label: '心 Propinas' },
                { path: '/caja',     label: '金 Caja' },
                { path: '/resumen',  label: '日 Resumen diario' },
              ].map(l => (
                <button key={l.path} onClick={() => navigate(l.path)}
                  style={{ background: '#0d0d0d', border: '1px solid #2a2a2a', borderRadius: 2, padding: '0.4rem 0.875rem', color: '#888', fontSize: '0.72rem', cursor: 'pointer', letterSpacing: '0.06em' }}>
                  {l.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
