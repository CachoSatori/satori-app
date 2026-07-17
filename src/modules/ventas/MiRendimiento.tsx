/**
 * MiRendimiento — "La casa del empleado" (TEMA CLARO, espeja Caja)
 * Ruta /mi-rendimiento — roles: salonero, barman, barback, runner, cocina.
 *
 * Hub personal donde el empleado ve su rendimiento y sus propinas:
 *   Resumen      — KPIs ricos del período (vs general y vs meta)
 *   Por día      — promedios por día de la semana + gráfico + yo-vs-resto
 *   Productos    — top General / Comidas / Bebidas (toggle ₡ / uds)
 *   Semana       — semanas calendario (actual + 4 previas)
 *   Propinas     — historial mensual + ICP + benchmark del equipo (Q1/Q2)
 *   Competencias — mis competencias activas
 *
 * Un FILTRO DE PERÍODO GLOBAL (Hoy · Esta semana · Este mes · Rango) gobierna
 * las sub-vistas de ventas. Propinas tiene su propio selector de mes.
 * CERO esquema, CERO migración: solo display sobre datos que ya existen.
 * Read-only sobre lo ya calculado (sagrados intactos).
 */
import { useState, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../shared/hooks/useAuth'
import type { DiasMap, ProductMap, Meta, Comp } from '../../shared/types/ventas'
import type { Employee } from '../../shared/types/database'
import type { AttendanceRow } from '../../shared/api/tips'
import {
  aggSalonero, aggGeneral, allSaloneros, allDates,
  fi, getMeta, topProds, dowLabel,
} from './ventasUtils'
import {
  resolvePeriod, datesInPeriod, dowBreakdown, bestDowIndex,
  icpVsTeam, sumElectronicTips, shiftMonth, monthLabelLong,
  type PeriodKind,
} from './miRendimientoUtils'
import { todayCR } from '../../shared/utils'
import { ROLE_LABELS } from '../../shared/constants'

interface Props {
  dias:       DiasMap
  pm:         ProductMap
  metas?:     Meta
  comps?:     Comp[]
  employee:   Employee | null    // empleado vinculado (para propinas)
  attendance: AttendanceRow[]     // TODAS las filas (para benchmark del equipo)
  noLink:     boolean             // perfil sin empleado vinculado
}

type Tab = 'resumen' | 'dia' | 'productos' | 'semana' | 'propinas' | 'competencias'

const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0]  // Lun … Dom
const MONTHS_SHORT = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

// Colores Caja: verde/dorado/rojo según % de meta
function metaCol(ratio: number): string {
  if (!isFinite(ratio) || ratio <= 0) return '#8a8070'
  if (ratio >= 1)    return '#27874f'
  if (ratio >= 0.85) return '#c8a030'
  return '#c0392b'
}

const PERIODS: { id: PeriodKind; label: string }[] = [
  { id: 'hoy',    label: 'Hoy' },
  { id: 'semana', label: 'Esta semana' },
  { id: 'mes',    label: 'Este mes' },
  { id: 'rango',  label: 'Rango' },
]

export default function MiRendimiento({ dias, pm, metas, comps = [], employee, attendance, noLink }: Props) {
  const { profile } = useAuth()
  const navigate    = useNavigate()
  const [params]    = useSearchParams()
  const today       = todayCR()

  const allSals = useMemo(() => allSaloneros(dias), [dias])
  const dates   = useMemo(() => allDates(dias), [dias])

  // ── Match nombre ↔ empleado (heurístico ACTUAL, sin cambios) ──
  const inferredName = useMemo(() => {
    if (!profile?.full_name) return null
    const firstName = profile.full_name.split(' ')[0].toUpperCase()
    const exact = allSals.find(n => n.toUpperCase() === profile.full_name!.toUpperCase())
    if (exact) return exact
    return allSals.find(n => n.toUpperCase().startsWith(firstName)) ?? null
  }, [profile, allSals])

  const [salName, setSalName] = useState<string>('')
  const activeName = salName || inferredName || ''

  // Rol sin venta individual (cocina/runner/barback) → arranca en Propinas.
  const isTipsFirst = !activeName || ['cocina', 'runner', 'barback'].includes(profile?.role ?? '')
  const urlTab = params.get('tab') as Tab | null
  const [tab, setTab] = useState<Tab>(
    urlTab ?? (isTipsFirst ? 'propinas' : 'resumen'),
  )

  // ── Período global ───────────────────────────────────────────
  const [periodKind, setPeriodKind] = useState<PeriodKind>('mes')
  const [rangeFrom, setRangeFrom]   = useState<string>('')
  const [rangeTo, setRangeTo]       = useState<string>('')
  const period = useMemo(
    () => resolvePeriod(periodKind, today, { from: rangeFrom, to: rangeTo }),
    [periodKind, today, rangeFrom, rangeTo],
  )
  const periodDates = useMemo(() => datesInPeriod(dates, period), [dates, period])

  // ── Agregados de ventas del período ──────────────────────────
  const myAgg  = useMemo(
    () => (activeName ? aggSalonero(activeName, periodDates, dias, pm) : null),
    [activeName, periodDates, dias, pm],
  )
  const genAgg = useMemo(() => aggGeneral(periodDates, dias, pm), [periodDates, dias, pm])

  // Ranking del día — solo cuando el período es un único día con datos
  const dayRank = useMemo(() => {
    if (!activeName || periodDates.length !== 1) return null
    const d = periodDates[0]
    const ranked = allSals
      .map(n => ({ n, total: aggSalonero(n, [d], dias, pm).total }))
      .filter(r => r.total > 0)
      .sort((a, b) => b.total - a.total)
    const idx = ranked.findIndex(r => r.n === activeName)
    if (idx < 0) return null
    return { pos: idx + 1, of: ranked.length }
  }, [activeName, periodDates, allSals, dias, pm])

  // ── Por día de la semana ─────────────────────────────────────
  const dowRows = useMemo(
    () => dowBreakdown(activeName, periodDates, dias, pm),
    [activeName, periodDates, dias, pm],
  )
  const bestDow = useMemo(() => bestDowIndex(dowRows), [dowRows])
  const maxDowProm = Math.max(1, ...dowRows.map(r => r.mine.promPax))

  // ── Semana calendario (actual + 4 previas) ───────────────────
  const weekData = useMemo(() => {
    if (!activeName) return []
    const weeks: Array<{ label: string; promPax: number; bebPax: number; total: number; pax: number; days: number }> = []
    const now = new Date(today + 'T12:00:00')
    const dow = now.getDay()
    const monday = new Date(now); monday.setDate(monday.getDate() - (dow === 0 ? 6 : dow - 1))
    for (let w = 0; w < 5; w++) {
      const from = new Date(monday); from.setDate(from.getDate() - w * 7)
      const to   = new Date(from);   to.setDate(to.getDate() + 6)
      const fromStr = from.toISOString().slice(0, 10)
      const toStr   = to.toISOString().slice(0, 10)
      const wDates  = dates.filter(d => d >= fromStr && d <= toStr)
      const agg     = aggSalonero(activeName, wDates, dias, pm)
      if (w === 0 || agg.days > 0) {
        const label = w === 0 ? 'Esta semana' : w === 1 ? 'Semana pasada' : `Hace ${w} sem`
        weeks.push({ label, promPax: agg.promPax, bebPax: agg.bebPax, total: agg.total, pax: agg.pax, days: agg.days })
      }
    }
    return weeks
  }, [activeName, dates, dias, pm, today])

  // ── Productos: toggle ₡ / uds ────────────────────────────────
  const [prodMode, setProdMode] = useState<'monto' | 'unidades'>('monto')

  // ── Propinas: mes seleccionado + agregados ───────────────────
  const myAttendance = useMemo(
    () => attendance.filter(r => employee && r.employee_id === employee.id),
    [attendance, employee],
  )
  const [selMonth, setSelMonth] = useState<string>(today.slice(0, 7))

  // Agrupar mis propinas por mes (Q1/Q2) — misma lógica que Mis Propinas
  const byMonth = useMemo(() => {
    const acc: Record<string, { q1Days: number; q1Hours: number; q1Earn: number; q2Days: number; q2Hours: number; q2Earn: number }> = {}
    for (const r of myAttendance) {
      const ym  = r.session_date.slice(0, 7)
      const day = Number(r.session_date.slice(8, 10))
      if (!acc[ym]) acc[ym] = { q1Days: 0, q1Hours: 0, q1Earn: 0, q2Days: 0, q2Hours: 0, q2Earn: 0 }
      const e = acc[ym]
      if (day <= 15) { e.q1Days++; e.q1Hours += r.hours_worked; e.q1Earn += r.payout_crc ?? 0 }
      else           { e.q2Days++; e.q2Hours += r.hours_worked; e.q2Earn += r.payout_crc ?? 0 }
    }
    return acc
  }, [myAttendance])

  const monthsWithData = useMemo(
    () => Object.keys(byMonth).sort((a, b) => b.localeCompare(a)),
    [byMonth],
  )

  // ICP ELECTRÓNICO del mes: propina electrónica GENERADA / ventas × 100 + benchmark equipo.
  // Numerador = tip_amount_crc + tip_amount_usd×TC (lo que el empleado registra), NO payout_crc.
  const icp = useMemo(() => {
    const monthDates = dates.filter(d => d.startsWith(selMonth))
    const myVentas   = activeName ? aggSalonero(activeName, monthDates, dias, pm).total : 0
    const teamVentas = aggGeneral(monthDates, dias, pm).total
    const myGen      = sumElectronicTips(myAttendance.filter(r => r.session_date.startsWith(selMonth)))
    const teamGen    = sumElectronicTips(attendance.filter(r => r.session_date.startsWith(selMonth)))
    const res = icpVsTeam(myGen, myVentas, teamGen, teamVentas)
    return { ...res, myGen, myVentas, teamGen, teamVentas }
  }, [selMonth, dates, activeName, dias, pm, myAttendance, attendance])

  // Totales de propinas (12m)
  const totalEarned = myAttendance.reduce((s, r) => s + (r.payout_crc ?? 0), 0)
  const totalHours  = myAttendance.reduce((s, r) => s + r.hours_worked, 0)
  const totalShifts = myAttendance.length
  const curEarn     = myAttendance.filter(r => r.session_date.startsWith(today.slice(0, 7))).reduce((s, r) => s + (r.payout_crc ?? 0), 0)

  // ── Estado vacío total: sin ventas y sin propinas ────────────
  if (allSals.length === 0 && !employee && noLink) {
    return (
      <div className="tips-module">
        <Header profile={profile} name={activeName} navigate={navigate} />
        <div className="cd-content">
          <div className="mr-empty">
            <div className="mr-empty-icon">🔗</div>
            <div className="mr-empty-title">Perfil no vinculado</div>
            <div className="mr-empty-sub">Pedile al dueño que vincule tu perfil en Admin → Empleados para ver tus propinas.</div>
          </div>
        </div>
      </div>
    )
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'resumen',      label: '心 Resumen' },
    { id: 'dia',          label: '📅 Por día' },
    { id: 'productos',    label: '🍱 Productos' },
    { id: 'semana',       label: '🗓️ Semana' },
    { id: 'propinas',     label: '¥ Propinas' },
    { id: 'competencias', label: '🏆 Competencias' },
  ]

  const salesTab = tab === 'resumen' || tab === 'dia' || tab === 'productos'
  const wide = tab === 'dia' || tab === 'productos' || tab === 'propinas'

  return (
    <div className="tips-module">
      <Header profile={profile} name={activeName} navigate={navigate} />

      {/* Selector de nombre si el match automático falló o hay varios */}
      {allSals.length > 0 && (!inferredName || allSals.length > 1) && (
        <div style={{ padding: '0.75rem 1.5rem 0', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="mr-period-lbl">Tu nombre:</span>
          <select className="mr-select" value={activeName} onChange={e => setSalName(e.target.value)}>
            {!inferredName && <option value="">— Seleccioná —</option>}
            {allSals.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      )}

      {/* Nav tabs (shell de Caja) */}
      <div className="cd-nav-tabs">
        {tabs.map(t => (
          <div key={t.id} className={`cd-nav-tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </div>
        ))}
      </div>

      <div className={`cd-content ${wide ? 'cd-content-wide' : ''}`}>

        {/* Filtro de período global (solo sub-vistas de ventas) */}
        {salesTab && (
          <div className="mr-period-bar">
            <span className="mr-period-lbl">Período</span>
            <div className="vt-range-bar" style={{ margin: 0 }}>
              {PERIODS.map(p => (
                <button key={p.id}
                  className={`vt-range-btn ${periodKind === p.id ? 'active' : ''}`}
                  onClick={() => setPeriodKind(p.id)}>
                  {p.label}
                </button>
              ))}
            </div>
            {periodKind === 'rango' && (
              <span style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                <input type="date" className="vt-date-input" value={rangeFrom} max={today} onChange={e => setRangeFrom(e.target.value)} />
                <span style={{ color: '#8a8070' }}>→</span>
                <input type="date" className="vt-date-input" value={rangeTo} max={today} onChange={e => setRangeTo(e.target.value)} />
              </span>
            )}
            <span className="vt-range-label">{period.label}</span>
          </div>
        )}

        {/* Aviso: rol sin venta individual */}
        {salesTab && !activeName && (
          <div className="mr-empty">
            <div className="mr-empty-icon">¥</div>
            <div className="mr-empty-title">Tu rol trabaja con propinas</div>
            <div className="mr-empty-sub">
              No tenés ventas individuales registradas. Andá a la pestaña <strong>¥ Propinas</strong> para ver tu historial.
            </div>
            <button className="vt-range-btn active" style={{ marginTop: '1rem' }} onClick={() => setTab('propinas')}>Ver mis propinas →</button>
          </div>
        )}

        {/* ══════════════ RESUMEN ══════════════ */}
        {tab === 'resumen' && activeName && (
          <ResumenTab myAgg={myAgg} genAgg={genAgg} metas={metas} activeName={activeName} pm={pm} dayRank={dayRank} period={period} />
        )}

        {/* ══════════════ POR DÍA ══════════════ */}
        {tab === 'dia' && activeName && (
          <DiaTab dowRows={dowRows} bestDow={bestDow} maxDowProm={maxDowProm} />
        )}

        {/* ══════════════ PRODUCTOS ══════════════ */}
        {tab === 'productos' && activeName && (
          <ProductosTab myAgg={myAgg} pm={pm} mode={prodMode} setMode={setProdMode} />
        )}

        {/* ══════════════ SEMANA ══════════════ */}
        {tab === 'semana' && (
          activeName
            ? <SemanaTab weekData={weekData} />
            : <div className="mr-empty"><div className="mr-empty-icon">🗓️</div><div className="mr-empty-title">Sin ventas individuales</div></div>
        )}

        {/* ══════════════ PROPINAS ══════════════ */}
        {tab === 'propinas' && (
          <PropinasTab
            noLink={noLink} employee={employee}
            byMonth={byMonth} monthsWithData={monthsWithData}
            selMonth={selMonth} setSelMonth={setSelMonth} today={today}
            icp={icp} activeName={activeName}
            totals={{ curEarn, totalShifts, totalHours, totalEarned }}
          />
        )}

        {/* ══════════════ COMPETENCIAS ══════════════ */}
        {tab === 'competencias' && (
          activeName
            ? <CompetenciasTab comps={comps} activeName={activeName} dates={dates} dias={dias} pm={pm} today={today} />
            : <div className="mr-empty"><div className="mr-empty-icon">🏆</div><div className="mr-empty-title">Sin competencias</div><div className="mr-empty-sub">Las competencias aplican a roles con venta individual.</div></div>
        )}
      </div>
    </div>
  )
}

// ── Header (shell de Caja) ────────────────────────────────────
function Header({ profile, name, navigate }: { profile: { role?: string; full_name?: string | null } | null; name: string; navigate: (to: string) => void }) {
  return (
    <div className="cd-module-header">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <span className="tips-kanji" style={{ fontSize: '1.6rem' }}>人</span>
        <div>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: '1.1rem', fontWeight: 700, color: 'var(--t-ink)' }}>Mi Rendimiento</div>
          <div style={{ fontSize: '0.68rem', letterSpacing: '0.15em', color: '#888', textTransform: 'uppercase' }}>
            Satori · {name || profile?.full_name || 'Empleado'}
          </div>
        </div>
        {profile?.role && <span className="role-badge">{ROLE_LABELS[profile.role] ?? profile.role}</span>}
      </div>
      <button className="cash-back-btn" onClick={() => navigate('/')}>← Inicio</button>
    </div>
  )
}

// ── KPI card (reutiliza .cd-saldo-card) ───────────────────────
function Kpi({ label, value, accent, delta, meta, sub }: {
  label: string; value: string; accent?: string
  delta?: { pct: number; ref: string } | null
  meta?: { pctOfMeta: number } | null
  sub?: string
}) {
  return (
    <div className="cd-saldo-card" style={accent ? { borderLeftColor: accent } : undefined}>
      <div className="cd-saldo-label">{label}</div>
      <div className="cd-saldo-val" style={accent ? { color: accent } : undefined}>{value}</div>
      {delta && (
        <div className={`mr-delta ${delta.pct >= 0 ? 'up' : 'down'}`}>
          {delta.pct >= 0 ? '▲ +' : '▼ '}{Math.abs(delta.pct).toFixed(1)}% {delta.ref}
        </div>
      )}
      {meta && (
        <div className="mr-meta-chip" style={{ background: metaCol(meta.pctOfMeta / 100) + '22', color: metaCol(meta.pctOfMeta / 100) }}>
          {meta.pctOfMeta.toFixed(0)}% de meta
        </div>
      )}
      {sub && <div className="mr-kpi-sub">{sub}</div>}
    </div>
  )
}

// ── RESUMEN ───────────────────────────────────────────────────
function ResumenTab({ myAgg, genAgg, metas, activeName, pm, dayRank, period }: {
  myAgg: ReturnType<typeof aggSalonero> | null
  genAgg: ReturnType<typeof aggGeneral>
  metas?: Meta; activeName: string; pm: ProductMap
  dayRank: { pos: number; of: number } | null
  period: ReturnType<typeof resolvePeriod>
}) {
  if (!myAgg || myAgg.days === 0) {
    return (
      <div className="mr-empty">
        <div className="mr-empty-icon">🌙</div>
        <div className="mr-empty-title">Sin datos en este período</div>
        <div className="mr-empty-sub">Probá con “Este mes” o un rango más amplio. El turno puede no estar cargado aún.</div>
      </div>
    )
  }
  const delta = (mine: number, gen: number) => (gen > 0 ? { pct: (mine - gen) / gen * 100, ref: 'vs general' } : null)
  const metaChip = (metric: 'promPax' | 'bebPax' | 'ratioCB' | 'ventas' | 'ticketItem', actual: number) => {
    if (!metas) return null
    const m = getMeta(metas, activeName, metric)
    if (!m) return null
    return { pctOfMeta: actual / m * 100 }
  }
  const top5 = topProds(myAgg.prods, 'monto', 5, undefined, pm)

  return (
    <>
      <div className="vt-sl">{period.label} · {activeName} · {myAgg.days} día{myAgg.days !== 1 ? 's' : ''}</div>

      {dayRank && (
        <div className="mr-card accent" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '1.5rem' }}>{dayRank.pos === 1 ? '🥇' : dayRank.pos === 2 ? '🥈' : dayRank.pos === 3 ? '🥉' : '🏅'}</span>
          <div>
            <div style={{ fontWeight: 800, fontFamily: "'DM Mono',monospace", fontSize: '1.05rem', color: 'var(--t-ink)' }}>
              #{dayRank.pos} <span style={{ color: '#8a8070', fontWeight: 400 }}>de {dayRank.of} en ventas hoy</span>
            </div>
          </div>
        </div>
      )}

      <div className="cd-saldos-bar">
        <Kpi label="Ventas"   value={fi(myAgg.total)} accent="#c8a96e" delta={delta(myAgg.total, genAgg.total)} meta={metaChip('ventas', myAgg.total)} />
        <Kpi label="PAX"      value={String(Math.round(myAgg.pax))} delta={delta(myAgg.pax, genAgg.pax)} />
        <Kpi label="Prom/PAX" value={fi(myAgg.promPax)} accent="#27874f" delta={delta(myAgg.promPax, genAgg.promPax)} meta={metaChip('promPax', myAgg.promPax)} />
        <Kpi label="Beb/PAX"  value={myAgg.bebPax.toFixed(2)} accent="#2a7a6a" delta={delta(myAgg.bebPax, genAgg.bebPax)} meta={metaChip('bebPax', myAgg.bebPax)} />
      </div>

      <div className="vt-sl">Detalle</div>
      <div className="cd-saldos-bar">
        <Kpi label="Ratio C/B (₡)"  value={`${myAgg.ratioCB.toFixed(2)}:1`} sub="ideal 2.5–4.5" meta={metaChip('ratioCB', myAgg.ratioCB)} />
        <Kpi label="Ratio C/B (uds)" value={`${myAgg.ratioU.toFixed(2)}:1`} sub={`${Math.round(myAgg.iCom)} com · ${Math.round(myAgg.iBeb)} beb`} />
        <Kpi label="Prom/Plato"     value={fi(myAgg.promPlato)} />
        <Kpi label="Prom/Bebida"    value={fi(myAgg.promBebida)} />
        <Kpi label="Ticket / item"  value={fi(myAgg.promTicket)} meta={metaChip('ticketItem', myAgg.promTicket)}
             delta={genAgg.promTicket > 0 ? { pct: (myAgg.promTicket - genAgg.promTicket) / genAgg.promTicket * 100, ref: 'vs general' } : null} />
      </div>

      {top5.length > 0 && (
        <>
          <div className="vt-sl">Top productos del período</div>
          <div className="mr-prod-block">
            {top5.map((p, i) => (
              <div key={p.nombre} className="mr-prod-row">
                <span className="mr-prod-rank">{i + 1}</span>
                <span className="mr-prod-name">
                  {p.nombre}
                  {pm[p.nombre] && <span className={`vt-prod-tipo ${pm[p.nombre].tipo}`} style={{ marginLeft: '0.4rem' }}>{pm[p.nombre].tipo}</span>}
                </span>
                <span style={{ fontSize: '0.72rem', color: '#8a8070', flexShrink: 0 }}>{p.q} uds</span>
                <span className="mr-prod-val">{fi(p.m)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  )
}

// ── POR DÍA ───────────────────────────────────────────────────
function DiaTab({ dowRows, bestDow, maxDowProm }: {
  dowRows: ReturnType<typeof dowBreakdown>; bestDow: number; maxDowProm: number
}) {
  const worked = dowRows.filter(r => r.days > 0)
  if (worked.length === 0) {
    return <div className="mr-empty"><div className="mr-empty-icon">📅</div><div className="mr-empty-title">Sin datos en este período</div><div className="mr-empty-sub">Elegí un período con turnos trabajados.</div></div>
  }
  const ordered = DOW_ORDER.map(d => dowRows[d])

  return (
    <>
      <div className="vt-sl">Promedio por día de la semana</div>
      <div className="mr-dow-grid">
        {ordered.map(r => {
          const has = r.days > 0
          const best = r.dow === bestDow
          return (
            <div key={r.dow} className={`mr-dow-card ${best ? 'best' : ''} ${has ? '' : 'empty'}`}>
              <div className="mr-dow-day">{dowLabel(r.dow)}</div>
              <div className="mr-dow-val">{has ? fi(r.mine.promPax) : '—'}</div>
              {has && (
                <>
                  <div className="mr-dow-sub">{Math.round(r.mine.pax / r.days)} PAX · {r.mine.bebPax.toFixed(2)} b/px</div>
                  <div className="mr-dow-sub">C/B {r.mine.ratioCB.toFixed(1)}</div>
                </>
              )}
              {best && <span className="mr-dow-badge">★ Mejor día</span>}
            </div>
          )
        })}
      </div>

      {/* Gráfico de barras Prom/PAX */}
      <div className="vt-sl">Prom/PAX por día</div>
      <div className="mr-bars">
        {ordered.map(r => {
          const h = r.days > 0 ? Math.max(6, Math.round(r.mine.promPax / maxDowProm * 100)) : 0
          return (
            <div key={r.dow} className="mr-bar-col">
              <div className="mr-bar-track">
                {r.days > 0 && <div className={`mr-bar-fill ${r.dow === bestDow ? 'best' : ''}`} style={{ height: `${h}%` }} title={fi(r.mine.promPax)} />}
              </div>
              <div className="mr-bar-lbl">{dowLabel(r.dow)}</div>
            </div>
          )
        })}
      </div>

      {/* Tabla yo vs resto del restaurante */}
      <div className="vt-sl" style={{ marginTop: '1.25rem' }}>Yo vs restaurante</div>
      <div className="mr-tbl-wrap">
        <table className="mr-tbl">
          <thead>
            <tr>
              <th>Día</th>
              <th className="r">Días</th>
              <th className="r">Mi Prom/PAX</th>
              <th className="r">Rest. Prom/PAX</th>
              <th className="r">Dif.</th>
            </tr>
          </thead>
          <tbody>
            {ordered.filter(r => r.days > 0).map(r => {
              const diff = r.rest.promPax > 0 ? (r.mine.promPax - r.rest.promPax) / r.rest.promPax * 100 : 0
              return (
                <tr key={r.dow} className={r.dow === bestDow ? 'best' : ''}>
                  <td>{dowLabel(r.dow)}{r.dow === bestDow ? ' ★' : ''}</td>
                  <td className="r muted">{r.days}</td>
                  <td className="r" style={{ fontWeight: 700 }}>{fi(r.mine.promPax)}</td>
                  <td className="r muted">{fi(r.rest.promPax)}</td>
                  <td className="r" style={{ color: diff >= 0 ? '#27874f' : '#c0392b', fontWeight: 700 }}>
                    {diff >= 0 ? '+' : ''}{diff.toFixed(0)}%
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ── PRODUCTOS ─────────────────────────────────────────────────
function ProductosTab({ myAgg, pm, mode, setMode }: {
  myAgg: ReturnType<typeof aggSalonero> | null; pm: ProductMap
  mode: 'monto' | 'unidades'; setMode: (m: 'monto' | 'unidades') => void
}) {
  if (!myAgg || Object.keys(myAgg.prods).length === 0) {
    return <div className="mr-empty"><div className="mr-empty-icon">🍱</div><div className="mr-empty-title">Sin productos en este período</div></div>
  }
  const blocks: { title: string; tipos?: string[] }[] = [
    { title: 'General' },
    { title: 'Comidas', tipos: ['comida'] },
    { title: 'Bebidas', tipos: ['bebida'] },
  ]
  return (
    <>
      <div className="mr-period-bar">
        <span className="mr-period-lbl">Ver por</span>
        <div className="vt-tab-group">
          <button className={`vt-tab-btn ${mode === 'monto' ? 'active' : ''}`} onClick={() => setMode('monto')}>₡ Monto</button>
          <button className={`vt-tab-btn ${mode === 'unidades' ? 'active' : ''}`} onClick={() => setMode('unidades')}>Unidades</button>
        </div>
      </div>
      {blocks.map(b => {
        const list = topProds(myAgg.prods, mode, 8, b.tipos, pm)
        if (list.length === 0) return null
        const max = Math.max(1, ...list.map(p => (mode === 'monto' ? p.m : p.q)))
        return (
          <div key={b.title} className="mr-prod-block">
            <div className="mr-prod-hd">{b.title}</div>
            {list.map((p, i) => {
              const val = mode === 'monto' ? p.m : p.q
              return (
                <div key={p.nombre} className="mr-prod-row">
                  <span className="mr-prod-rank">{i + 1}</span>
                  <span className="mr-prod-name">
                    {p.nombre}
                    {pm[p.nombre] && <span className={`vt-prod-tipo ${pm[p.nombre].tipo}`} style={{ marginLeft: '0.4rem' }}>{pm[p.nombre].tipo}</span>}
                  </span>
                  <div className="mr-prod-bar"><div className="mr-prod-bar-fill" style={{ width: `${val / max * 100}%` }} /></div>
                  <span className="mr-prod-val">{mode === 'monto' ? fi(p.m) : `${p.q} uds`}</span>
                </div>
              )
            })}
          </div>
        )
      })}
    </>
  )
}

// ── SEMANA ────────────────────────────────────────────────────
function SemanaTab({ weekData }: { weekData: Array<{ label: string; promPax: number; bebPax: number; total: number; pax: number; days: number }> }) {
  if (weekData.length === 0) return <div className="mr-empty"><div className="mr-empty-icon">🗓️</div><div className="mr-empty-title">Sin datos semanales</div></div>
  return (
    <>
      <div className="vt-sl">Semanas calendario</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        {weekData.map((w, i) => (
          <div key={w.label} className={`mr-card ${i === 0 ? 'accent' : ''}`}>
            <div style={{ fontSize: '0.62rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: i === 0 ? '#a07830' : '#8a8070', fontWeight: 700, marginBottom: '0.4rem' }}>{w.label}</div>
            {w.days > 0 ? (
              <>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: '1.05rem', fontWeight: 800, color: 'var(--t-ink)' }}>{fi(w.total)}</div>
                <div style={{ fontSize: '0.72rem', color: '#8a8070', marginTop: 2 }}>{w.days} días · {w.pax} PAX</div>
                <div style={{ fontSize: '0.74rem', color: '#5a5040', marginTop: 2 }}>{fi(w.promPax)}/PAX · {w.bebPax.toFixed(2)} b/px</div>
              </>
            ) : <div style={{ color: '#b8ad98', fontSize: '0.78rem' }}>Sin datos</div>}
          </div>
        ))}
      </div>
      <div className="mr-tbl-wrap">
        <table className="mr-tbl">
          <thead><tr><th>Semana</th><th className="r">Días</th><th className="r">PAX</th><th className="r">Ventas</th><th className="r">Prom/PAX</th></tr></thead>
          <tbody>
            {weekData.filter(w => w.days > 0).map((w, i) => (
              <tr key={w.label} style={{ fontWeight: i === 0 ? 700 : 400 }}>
                <td style={{ color: i === 0 ? '#a07830' : undefined }}>{w.label}</td>
                <td className="r muted">{w.days}</td>
                <td className="r">{w.pax}</td>
                <td className="r" style={{ fontWeight: 700 }}>{fi(w.total)}</td>
                <td className="r">{fi(w.promPax)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ── PROPINAS ──────────────────────────────────────────────────
function PropinasTab({ noLink, employee, byMonth, monthsWithData, selMonth, setSelMonth, today, icp, activeName, totals }: {
  noLink: boolean; employee: Employee | null
  byMonth: Record<string, { q1Days: number; q1Hours: number; q1Earn: number; q2Days: number; q2Hours: number; q2Earn: number }>
  monthsWithData: string[]
  selMonth: string; setSelMonth: (m: string) => void; today: string
  icp: { mine: number; team: number; diff: number; myGen: number; myVentas: number; teamGen: number; teamVentas: number }
  activeName: string
  totals: { curEarn: number; totalShifts: number; totalHours: number; totalEarned: number }
}) {
  if (noLink && !employee) {
    return (
      <div className="mr-empty">
        <div className="mr-empty-icon">🔗</div>
        <div className="mr-empty-title">Perfil no vinculado</div>
        <div className="mr-empty-sub">Tu cuenta no está vinculada a un empleado todavía. Pedile al dueño que la vincule en Admin → Empleados.</div>
      </div>
    )
  }

  const curYm = today.slice(0, 7)
  const sel = byMonth[selMonth]
  const total = sel ? sel.q1Earn + sel.q2Earn : 0
  const canNext = selMonth < curYm
  const showIcp = activeName && icp.myVentas > 0

  return (
    <>
      {/* Totales */}
      <div className="cd-saldos-bar">
        <Kpi label="Este mes"        value={fi(totals.curEarn)} accent="#2a7a6a" />
        <Kpi label="Turnos (12m)"    value={String(totals.totalShifts)} />
        <Kpi label="Horas (12m)"     value={totals.totalHours.toFixed(0) + 'h'} />
        <Kpi label="Total cobrado"   value={fi(totals.totalEarned)} accent="#c8a96e" sub="últimos 12 meses" />
      </div>

      {/* Selector de mes */}
      <div className="mr-period-bar" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button className="vt-range-btn" onClick={() => setSelMonth(shiftMonth(selMonth, -1))}>← Mes ant.</button>
          <span style={{ fontFamily: "'DM Mono',monospace", fontWeight: 800, color: 'var(--t-ink)', minWidth: 120, textAlign: 'center' }}>{monthLabelLong(selMonth)}</span>
          <button className="vt-range-btn" disabled={!canNext} style={canNext ? undefined : { opacity: 0.4, cursor: 'default' }} onClick={() => canNext && setSelMonth(shiftMonth(selMonth, 1))}>Mes sig. →</button>
        </div>
        {monthsWithData.length > 0 && (
          <select className="mr-select" value={monthsWithData.includes(selMonth) ? selMonth : ''} onChange={e => e.target.value && setSelMonth(e.target.value)}>
            <option value="">Ir a mes…</option>
            {monthsWithData.map(ym => <option key={ym} value={ym}>{monthLabelLong(ym)}</option>)}
          </select>
        )}
      </div>

      {/* ICP electrónico + benchmark del equipo */}
      {showIcp ? (
        <>
          <div className="vt-sl">ICP electrónico · propina electrónica generada / ventas</div>
          <div className="mr-icp">
            <div className="mr-icp-card">
              <div className="mr-icp-label">Mi ICP electrónico · {monthLabelLong(selMonth)}</div>
              <div className="mr-icp-val">{icp.mine.toFixed(1)}%</div>
              <div className="mr-icp-sub">{fi(icp.myGen)} generado / {fi(icp.myVentas)} ventas</div>
            </div>
            <div className="mr-icp-card team">
              <div className="mr-icp-label">Equipo (benchmark)</div>
              <div className="mr-icp-val">{icp.team.toFixed(1)}%</div>
              <div className="mr-icp-sub" style={{ color: icp.diff >= 0 ? '#27874f' : '#c0392b', fontWeight: 700 }}>
                {icp.diff >= 0 ? '▲ +' : '▼ '}{Math.abs(icp.diff).toFixed(1)} pts vs equipo
              </div>
            </div>
          </div>
          <div className="mr-icp-sub" style={{ marginTop: '-0.5rem', marginBottom: '1.25rem' }}>
            Mide la propina <strong>electrónica</strong> que generaste (tarjeta/SINPE), no lo cobrado del reparto del pool (eso es tu take-home, arriba).
          </div>
        </>
      ) : (
        <div className="mr-icp-sub" style={{ marginBottom: '1rem' }}>
          {activeName ? 'Sin ventas registradas este mes para calcular el ICP electrónico.' : 'El ICP electrónico compara la propina electrónica generada vs tus ventas (roles con venta individual).'}
        </div>
      )}

      {/* Detalle quincenal del mes */}
      <div className="vt-sl">Detalle · {monthLabelLong(selMonth)}</div>
      {!sel ? (
        <div className="mr-empty"><div className="mr-empty-icon">📭</div><div className="mr-empty-title">Sin registros ese mes</div></div>
      ) : (
        <div className="mr-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <span style={{ fontWeight: 700, color: 'var(--t-ink)' }}>{monthLabelLong(selMonth)}</span>
            <span style={{ fontFamily: "'DM Mono',monospace", fontWeight: 800, color: '#2a7a6a', fontSize: '1.05rem' }}>{fi(total)}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
            {[
              { label: 'Q1 (1–15)',   days: sel.q1Days, hours: sel.q1Hours, earn: sel.q1Earn, color: '#2a7a6a' },
              { label: 'Q2 (16–fin)', days: sel.q2Days, hours: sel.q2Hours, earn: sel.q2Earn, color: '#a07830' },
            ].map(q => (
              <div key={q.label} style={{ background: 'var(--t-panel)', borderRadius: 3, padding: '0.6rem 0.75rem' }}>
                <div style={{ fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#6a6250', marginBottom: '0.25rem' }}>{q.label}</div>
                <div style={{ fontFamily: "'DM Mono',monospace", fontWeight: 800, fontSize: '0.95rem', color: q.color }}>{q.earn > 0 ? fi(q.earn) : '—'}</div>
                <div style={{ fontSize: '0.64rem', color: '#8a8070', marginTop: '0.15rem' }}>{q.days} turnos · {q.hours.toFixed(1)}h</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Histórico por mes */}
      {monthsWithData.length > 0 && (
        <>
          <div className="vt-sl">Histórico</div>
          <div className="mr-tbl-wrap">
            <table className="mr-tbl">
              <thead><tr><th>Mes</th><th className="r">Turnos</th><th className="r">Horas</th><th className="r">Q1</th><th className="r">Q2</th><th className="r">Total</th></tr></thead>
              <tbody>
                {monthsWithData.map(ym => {
                  const d = byMonth[ym]
                  const t = d.q1Earn + d.q2Earn
                  const isSel = ym === selMonth
                  return (
                    <tr key={ym} className={isSel ? 'best' : ''} style={{ cursor: 'pointer' }} onClick={() => setSelMonth(ym)}>
                      <td style={{ fontWeight: isSel ? 700 : 400 }}>{MONTHS_SHORT[Number(ym.slice(5, 7)) - 1]} {ym.slice(2, 4)}</td>
                      <td className="r muted">{d.q1Days + d.q2Days}</td>
                      <td className="r muted">{(d.q1Hours + d.q2Hours).toFixed(0)}h</td>
                      <td className="r" style={{ color: '#2a7a6a' }}>{d.q1Earn > 0 ? fi(d.q1Earn) : '—'}</td>
                      <td className="r" style={{ color: '#a07830' }}>{d.q2Earn > 0 ? fi(d.q2Earn) : '—'}</td>
                      <td className="r" style={{ fontWeight: 700 }}>{fi(t)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
}

// ── COMPETENCIAS ──────────────────────────────────────────────
function CompetenciasTab({ comps, activeName, dates, dias, pm, today }: {
  comps: Comp[]; activeName: string; dates: string[]; dias: DiasMap; pm: ProductMap; today: string
}) {
  const myComps = comps.filter(c => c.parts?.includes(activeName))
  if (myComps.length === 0) {
    return (
      <div className="mr-empty">
        <div className="mr-empty-icon">🏆</div>
        <div className="mr-empty-title">Sin competencias activas</div>
        <div className="mr-empty-sub">El encargado puede crear competencias en Ventas → Competencias.</div>
      </div>
    )
  }
  const sorted = [...myComps].sort((a, b) => {
    const st = (c: Comp) => today > c.fin ? 2 : today < c.inicio ? 1 : 0
    return st(a) - st(b)
  })
  return (
    <>
      <div className="vt-sl">Mis competencias · {activeName}</div>
      {sorted.map(comp => {
        const status = today > comp.fin ? 'finished' : today < comp.inicio ? 'upcoming' : 'active'
        const ranking = (comp.parts ?? []).map(sal => {
          const compDates = dates.filter(d => d >= comp.inicio && d <= comp.fin)
          const salAgg = aggSalonero(sal, compDates, dias, pm)
          let pts = 0
          for (const prod of (comp.prods ?? [])) {
            const q = Object.entries(salAgg.prods).find(([n]) => n === (typeof prod === 'string' ? prod : prod.name))?.[1]?.q ?? 0
            pts += q * (typeof prod === 'string' ? 1 : prod.pts)
          }
          return { sal, pts }
        }).sort((a, b) => b.pts - a.pts)
        const myRank = ranking.findIndex(r => r.sal === activeName) + 1
        const myPts  = ranking.find(r => r.sal === activeName)?.pts ?? 0
        const leader = ranking[0]
        const statusColor = status === 'active' ? '#27874f' : status === 'upcoming' ? '#c8a030' : '#8a8070'
        const statusLabel = status === 'active' ? '● En curso' : status === 'upcoming' ? '○ Próxima' : '✓ Finalizada'
        return (
          <div key={comp.id} className="mr-card" style={{ borderLeft: `3px solid ${statusColor}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.6rem' }}>
              <div>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: '0.95rem', fontWeight: 800, color: 'var(--t-ink)' }}>{comp.nombre}</div>
                <div style={{ fontSize: '0.66rem', color: '#8a8070', marginTop: 2 }}>
                  {comp.inicio} → {comp.fin}
                  {comp.premio && <span style={{ color: '#a07830', marginLeft: '0.5rem' }}>🏅 {comp.premio}</span>}
                </div>
              </div>
              <span style={{ fontSize: '0.66rem', color: statusColor, fontWeight: 700 }}>{statusLabel}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <div style={{ background: 'var(--t-panel)', borderRadius: 3, padding: '0.5rem', textAlign: 'center' }}>
                <div style={{ fontSize: '0.58rem', color: '#6a6250', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Mi posición</div>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: '1.3rem', fontWeight: 800, color: myRank === 1 ? '#a07830' : '#2a7a6a' }}>
                  {myRank === 1 ? '🥇' : myRank === 2 ? '🥈' : myRank === 3 ? '🥉' : `#${myRank}`}
                </div>
              </div>
              <div style={{ background: 'var(--t-panel)', borderRadius: 3, padding: '0.5rem', textAlign: 'center' }}>
                <div style={{ fontSize: '0.58rem', color: '#6a6250', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Mis puntos</div>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: '1.3rem', fontWeight: 800, color: '#a07830' }}>{myPts}</div>
              </div>
              <div style={{ background: 'var(--t-panel)', borderRadius: 3, padding: '0.5rem', textAlign: 'center' }}>
                <div style={{ fontSize: '0.58rem', color: '#6a6250', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Líder</div>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#5a5040', marginTop: 4 }}>{leader?.sal ?? '—'}</div>
                <div style={{ fontSize: '0.66rem', color: '#8a8070' }}>{leader?.pts ?? 0} pts</div>
              </div>
            </div>
            {ranking.length > 0 && (
              <div className="mr-tbl-wrap" style={{ marginBottom: 0 }}>
                <table className="mr-tbl">
                  <thead><tr><th style={{ width: 32 }}>#</th><th>Salonero</th><th className="r">Puntos</th></tr></thead>
                  <tbody>
                    {ranking.map((r, i) => (
                      <tr key={r.sal} className={r.sal === activeName ? 'best' : ''}>
                        <td style={{ fontWeight: 700, color: i === 0 ? '#a07830' : '#8a8070' }}>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</td>
                        <td style={{ fontWeight: r.sal === activeName ? 700 : 400 }}>{r.sal === activeName ? `▶ ${r.sal}` : r.sal}</td>
                        <td className="r" style={{ fontWeight: 700 }}>{r.pts}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}
