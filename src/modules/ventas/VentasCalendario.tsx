/**
 * VentasCalendario — Análisis por día de semana + listado histórico por mes
 * Port of renderSemana from SATORI DASHBOARD standalone
 */
import { useState, useMemo } from 'react'
import type { DiasMap, HistMap, ProductMap } from '../../shared/types/ventas'
import { getContabilidadDays, fi } from './ventasUtils'

interface Props { dias: DiasMap; hist: HistMap; pm?: ProductMap }

const DAYS_SHORT = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb']
const DOW_ORDER  = [1, 2, 3, 4, 5, 6, 0]   // Mon→Sun
const MN_FULL    = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

function safeDOW(date: string): number {
  return new Date(date + 'T12:00:00').getDay()
}

export default function VentasCalendario({ dias, hist }: Props) {
  // Collect all dates from both dias and hist
  const allDays = useMemo(() => {
    const all = [...new Set([...Object.keys(dias), ...Object.keys(hist)])].sort()
    const years = [...new Set(all.map(d => Number(d.slice(0,4))))].sort().reverse()
    // Get contabilidad for all data
    const items = years.flatMap(y => getContabilidadDays(y, null, dias, hist))
    return items.sort((a,b) => a.fecha.localeCompare(b.fecha))
  }, [dias, hist])

  // ── Day-of-week averages ──────────────────────────────────────
  const dowAvgs = useMemo(() => {
    const byDow: Record<number, { sum: number; paxSum: number; cnt: number }> = {}
    for (const d of allDays) {
      const dow = safeDOW(d.fecha)
      if (!byDow[dow]) byDow[dow] = { sum: 0, paxSum: 0, cnt: 0 }
      byDow[dow].sum    += d.ventaNeta
      byDow[dow].paxSum += d.pax
      byDow[dow].cnt++
    }
    const avgs: Record<number, { neta: number; promPax: number; cnt: number } | null> = {}
    for (let d = 0; d < 7; d++) {
      const b = byDow[d]
      if (!b || !b.cnt) { avgs[d] = null; continue }
      avgs[d] = {
        neta:    Math.round(b.sum / b.cnt),
        promPax: b.paxSum > 0 ? Math.round(b.sum / b.paxSum) : 0,
        cnt:     b.cnt,
      }
    }
    return avgs
  }, [allDays])

  // Best / worst day
  const validAvgs  = Object.entries(dowAvgs).filter(([,v]) => v !== null).map(([d,v]) => ({ dow: Number(d), neta: v!.neta }))
  const sortedNegas = [...validAvgs].sort((a,b) => b.neta - a.neta)

  // ── Group by month ────────────────────────────────────────────
  const byMonth = useMemo(() => {
    const m: Record<string, typeof allDays> = {}
    for (const d of allDays) {
      const mk = d.fecha.slice(0,7)
      if (!m[mk]) m[mk] = []
      m[mk].push(d)
    }
    return m
  }, [allDays])

  const monthKeys = Object.keys(byMonth).sort().reverse()

  // Which months are expanded (default: most recent one open)
  const [openMonths, setOpenMonths] = useState<Set<string>>(() => new Set([monthKeys[0] ?? '']))
  function toggleMonth(mk: string) {
    setOpenMonths(prev => { const s = new Set(prev); s.has(mk) ? s.delete(mk) : s.add(mk); return s })
  }

  if (!allDays.length) {
    return (
      <div className="vt-empty">
        <div className="vt-empty-icon">📅</div>
        <div className="vt-empty-title">Sin datos</div>
        <div className="vt-empty-sub">Subí los XLS diarios para ver el calendario</div>
      </div>
    )
  }

  return (
    <div className="vt-section">

      {/* ── Day-of-week averages ─────────────────────────────── */}
      <div className="vt-sl">Promedios por día de semana</div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:'0.5rem', marginBottom:'1.75rem' }}>
        {DOW_ORDER.map(d => {
          const data = dowAvgs[d]
          const rank = data ? sortedNegas.findIndex(v => v.dow === d) : -1
          const n    = sortedNegas.length
          let bg = 'var(--vt-ink)', valColor = 'var(--vt-gold)'
          if (rank === 0)      { bg = 'rgba(46,125,50,.18)'; valColor = 'var(--vt-green)' }
          else if (rank===n-1) { bg = 'rgba(194,59,34,.14)'; valColor = 'var(--vt-red)' }
          return (
            <div key={d} style={{ background:bg, padding:'0.625rem 0.4rem', borderRadius:2, textAlign:'center' }}>
              <div style={{ fontSize:'0.62rem', letterSpacing:'0.1em', textTransform:'uppercase', color:'#888', marginBottom:4 }}>
                {DAYS_SHORT[d]}
              </div>
              {data ? (
                <>
                  <div style={{ fontSize:'0.6rem', color:'#555', marginBottom:2 }}>{data.cnt}×</div>
                  <div style={{ fontFamily:"'DM Mono',monospace", fontSize:'clamp(0.7rem,1.2vw,0.88rem)', fontWeight:800, color:valColor }}>
                    {fi(data.neta)}
                  </div>
                  <div style={{ fontSize:'0.62rem', color:'#888', marginTop:3 }}>
                    {fi(data.promPax)}/PAX
                  </div>
                </>
              ) : (
                <div style={{ fontSize:'0.72rem', color:'#333', marginTop:6 }}>—</div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Monthly detail (collapsible) ────────────────────── */}
      <div className="vt-sl">Detalle por fecha</div>
      <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
        {monthKeys.map(mk => {
          const [yr, mo]   = mk.split('-')
          const monthLabel = `${MN_FULL[Number(mo)]} ${yr}`
          const days       = byMonth[mk]
          const monthTotal = days.reduce((s,d) => s + d.ventaNeta, 0)
          const monthPAX   = days.reduce((s,d) => s + d.pax, 0)
          const sortedByTotal = [...days].sort((a,b) => b.ventaNeta - a.ventaNeta)
          const bestDate   = sortedByTotal[0]?.fecha
          const worstDate  = sortedByTotal.length > 1 ? sortedByTotal[sortedByTotal.length-1]?.fecha : undefined
          const isOpen     = openMonths.has(mk)

          return (
            <div key={mk}>
              {/* Month header */}
              <div
                style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0.625rem 0.875rem', background:'var(--vt-ink)', borderRadius:2, cursor:'pointer', borderLeft:'3px solid var(--vt-border)' }}
                onClick={() => toggleMonth(mk)}>
                <div style={{ display:'flex', gap:'0.75rem', alignItems:'baseline' }}>
                  <span style={{ fontSize:'0.88rem', fontWeight:700, color:'var(--vt-paper)' }}>{monthLabel}</span>
                  <span style={{ fontSize:'0.72rem', color:'#888' }}>{days.length} días</span>
                </div>
                <div style={{ display:'flex', gap:'1rem', alignItems:'center' }}>
                  <span style={{ fontSize:'0.88rem', fontWeight:700, color:'var(--vt-gold)' }}>{fi(monthTotal)}</span>
                  {monthPAX > 0 && <span style={{ fontSize:'0.72rem', color:'#888' }}>{monthPAX.toLocaleString('es-CR')} PAX</span>}
                  <span style={{ color:'#555', fontSize:'0.78rem' }}>{isOpen ? '▼' : '▶'}</span>
                </div>
              </div>

              {/* Day rows */}
              {isOpen && (
                <div className="vt-tbl-wrap" style={{ marginTop:1 }}>
                  <table className="vt-tbl">
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Día</th>
                        <th className="r">Ventas</th>
                        <th className="r">PAX</th>
                        <th className="r">Prom/PAX</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...days].sort((a,b) => b.fecha.localeCompare(a.fecha)).map((d, i) => {
                        const isBest  = d.fecha === bestDate
                        const isWorst = d.fecha === worstDate && days.length > 1
                        const dow     = safeDOW(d.fecha)
                        const [, ,dd] = d.fecha.split('-')
                        const ppax    = d.pax > 0 ? d.ventaNeta / d.pax : 0
                        let color = 'inherit'
                        let badge = ''
                        let rowBg = i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,.02)'
                        if (isBest)  { color = 'var(--vt-green)'; badge = '★ '; rowBg = 'rgba(46,125,50,.1)' }
                        if (isWorst) { color = 'var(--vt-red)';   badge = '▼ '; rowBg = 'rgba(194,59,34,.1)' }
                        return (
                          <tr key={d.fecha} style={{ background:rowBg }}>
                            <td style={{ color, fontWeight: isBest||isWorst ? 700 : 400 }}>
                              {badge}{dd}/{mo}/{yr}
                            </td>
                            <td style={{ color:'#666', fontSize:'0.8rem' }}>{DAYS_SHORT[dow]}</td>
                            <td className="r vt-bold" style={{ color: isBest ? 'var(--vt-green)' : isWorst ? 'var(--vt-red)' : 'var(--vt-gold)' }}>
                              {fi(d.ventaNeta)}
                            </td>
                            <td className="r" style={{ color:'#888' }}>{d.pax > 0 ? d.pax.toLocaleString('es-CR') : '—'}</td>
                            <td className="r" style={{ color:'#888' }}>{ppax > 0 ? fi(ppax) : '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="vt-tbl-footer">
                        <td colSpan={2}>TOTAL {monthLabel}</td>
                        <td className="r">{fi(monthTotal)}</td>
                        <td className="r">{monthPAX > 0 ? monthPAX.toLocaleString('es-CR') : '—'}</td>
                        <td className="r">{monthPAX > 0 ? fi(monthTotal / monthPAX) : '—'}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
