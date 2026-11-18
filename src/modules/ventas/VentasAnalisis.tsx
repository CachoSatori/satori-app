import React, { useState, useMemo, lazy, Suspense } from 'react'
import type { DiasMap, HistMap, Meta } from '../../shared/types/ventas'
import { getContabilidadDays, availableYears, fi } from './ventasUtils'
// «A la fecha» (Ventas v2, fases 0.2 y 1.3): todo rango sale de `aLaFecha.ts`, que usa el motor
// `periodos.ts`. Un período en curso llega hasta AYER (hora CR) y su base se corta a los mismos días.
import {
  alineadoAlCorte, corteDe, diasCerradosDelAnio, diasDelAnio, enCurso, hastaN, largoEnDias, metaALaFecha,
  nombreMes, primerosDias, rangoAnioNatural, rangoMesNatural, rangoQuincenaNatural, rangoTrimestreNatural,
  rotulo, totalesEnRango, variacion, type Rango, type Totales,
} from './aLaFecha'

// «Prom/PAX explicado» (SPEC v2.3): carga sus propios datos (RPC 078), no usa dias/hist.
const VentasPromPaxExplicado = lazy(() => import('./VentasPromPaxExplicado'))

const MN_FULL = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio',
                 'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const QUARTERS: [number, number, number][] = [[1,2,3],[4,5,6],[7,8,9],[10,11,12]]

function varStr(pct: number | null, big = false): { text: string; color: string } {
  if (pct === null) return { text: '—', color: 'var(--c-gris-claro)' }
  const c = pct > 0 ? 'var(--vt-green)' : pct < 0 ? 'var(--vt-red)' : 'var(--c-gris)'
  const t = `${pct >= 0 ? '▲ +' : '▼ '}${Math.abs(pct).toFixed(big ? 0 : 1)}%`
  return { text: t, color: c }
}

interface Props {
  dias:  DiasMap
  hist:  HistMap
  metas: Meta
}

/** Venta por persona para mostrar (D4, `indicadores.ts`): «—» sin personas. */
const vpp = (t: Totales) => (t.ventaPorPersona === null ? '—' : fi(t.ventaPorPersona))
const TITULO_VPP = 'Venta de salón ÷ personas de salón (una sola fórmula en toda la app)'

export default function VentasAnalisis({ dias, hist, metas }: Props) {
  // El corte (hoy y ayer en hora CR) se fija al abrir la pantalla.
  const c = useMemo(() => corteDe(), [])
  const years = useMemo(() => availableYears(dias, hist), [dias, hist])
  const [mode, setMode] = useState<'compare'|'year'|'proyeccion'|'prompax'>('compare')
  const [selYear, setSelYear] = useState(years[0] ?? c.anio)

  const MONTHS = [1,2,3,4,5,6,7,8,9,10,11,12]

  // Todos los días (resumen por día) una sola vez; cada número es una suma por rango.
  const todos = useMemo(() => years.flatMap(y => getContabilidadDays(y, null, dias, hist)), [years, dias, hist])
  const T = (r: Rango | null) => totalesEnRango(todos, r)
  /** El contenedor del año `y`, alineado al corte si el mismo contenedor del año en curso no terminó. */
  const al = (nat: Rango, vivo: boolean) => alineadoAlCorte(nat, vivo, c)

  const anioVivo = enCurso(rangoAnioNatural(c.anio), c)
  const rangoYTD = hastaN(rangoAnioNatural(c.anio), c)
  const txtYTD   = rangoYTD ? rotulo(rangoYTD, c) : ''

  const mNames = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

  const selector = (
    <div className="vt-tab-group" style={{ marginBottom: '1.25rem' }}>
      <button className={`vt-tab-btn ${mode === 'compare' ? 'active' : ''}`}
        onClick={() => setMode('compare')}>Año vs Año</button>
      <button className={`vt-tab-btn ${mode === 'year' ? 'active' : ''}`}
        onClick={() => setMode('year')}>Detalle anual</button>
      <button className={`vt-tab-btn ${mode === 'proyeccion' ? 'active' : ''}`}
        onClick={() => setMode('proyeccion')}>Proyección</button>
      <button className={`vt-tab-btn ${mode === 'prompax' ? 'active' : ''}`}
        onClick={() => setMode('prompax')}>Prom/PAX explicado</button>
    </div>
  )

  if (mode === 'prompax') {
    return (
      <div className="vt-section">
        {selector}
        <Suspense fallback={<div className="vt-empty"><div className="vt-empty-sub">Cargando…</div></div>}>
          <VentasPromPaxExplicado />
        </Suspense>
      </div>
    )
  }

  if (!years.length) {
    return (
      <div className="vt-section">
        {selector}
        <div className="vt-empty">
          <div className="vt-empty-icon">分</div>
          <div className="vt-empty-title">Sin datos suficientes</div>
          <div className="vt-empty-sub">Cargá datos históricos para ver el análisis</div>
        </div>
      </div>
    )
  }

  return (
    <div className="vt-section">
      {/* Mode selector */}
      {selector}

      {mode === 'compare' && (
        <>
          {anioVivo && (
            <div className="vt-kpi-sub" data-testid="an-aviso-fecha" style={{ marginBottom: '0.75rem' }}>
              {c.anio} va <strong>a la fecha</strong>: {txtYTD}, hasta ayer (hoy no entra). Lo que está en curso se
              compara contra los mismos días de los otros años.
            </div>
          )}
          {/* Annual KPI cards */}
          <div className="vt-kpi-grid" style={{ gridTemplateColumns: `repeat(${Math.min(years.length, 4)}, 1fr)` }}>
            {years.map((y, i) => {
              const vivo = y === c.anio && anioVivo
              const d    = T(al(rangoAnioNatural(y), false))
              const prevY = years[i + 1]
              const prev = prevY ? T(al(rangoAnioNatural(prevY), vivo)) : null
              const vp   = prev ? variacion(d, prev) : null
              const vs   = varStr(vp, true)
              return (
                <div key={y} className="vt-kpi" style={{ borderLeft: '3px solid var(--vt-gold)' }} data-testid={`an-anio-${y}`}>
                  <div className="vt-kpi-label">{y}{vivo ? ' · a la fecha' : ''} · {d.dias} días</div>
                  <div className="vt-kpi-val">{fi(d.ventaNeta)}</div>
                  {vp !== null && (
                    <div className="vt-kpi-delta" style={{ color: vs.color }}>
                      {vs.text} vs {prevY}{vivo ? ' a la misma fecha' : ''}
                    </div>
                  )}
                  <div className="vt-kpi-sub" title={TITULO_VPP}>{d.pax.toLocaleString('es-CR')} PAX · {vpp(d)}/PAX</div>
                  {vivo && <div className="vt-kpi-sub">{txtYTD}</div>}
                </div>
              )
            })}
          </div>

          {/* Monthly comparison table */}
          <div className="vt-sl">Comparativo mensual</div>
          <div className="vt-tbl-wrap">
            <table className="vt-tbl" data-testid="an-tabla-meses">
              <thead>
                <tr>
                  <th>Mes</th>
                  {years.map(y => <th key={y} className="r">{y}</th>)}
                  {years.map((y, i) => i > 0 ? <th key={`v${y}`} className="r" style={{ color:'var(--c-gris)', fontSize:'0.65rem' }}>vs {years[i-1]}</th> : null)}
                </tr>
              </thead>
              <tbody>
                {MONTHS.map(m => {
                  const vivo = enCurso(rangoMesNatural(c.anio, m), c)
                  const vals = years.map(y => T(al(rangoMesNatural(y, m), vivo)))
                  if (!vals.some(v => v.dias > 0)) return null
                  const r = vivo ? hastaN(rangoMesNatural(c.anio, m), c) : null
                  return (
                    <tr key={m} data-testid={vivo ? 'an-mes-en-curso' : undefined}>
                      <td style={{ fontWeight: 600 }} title={r ? rotulo(r, c) : undefined}>
                        {MN_FULL[m]}{vivo && r ? ` · a la fecha (1 al ${c.dia})` : ''}
                      </td>
                      {vals.map((v, i) => <td key={years[i]} className="r vt-bold">{v.dias > 0 ? fi(v.ventaNeta) : '—'}</td>)}
                      {years.map((y, i) => {
                        if (i === 0) return null
                        const vs = varStr(variacion(vals[i-1], vals[i]))
                        return <td key={`v${y}`} className="r" style={{ color: vs.color, fontSize:'0.8rem' }}>{vs.text}</td>
                      })}
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                {anioVivo && (
                  <tr className="vt-tbl-footer" data-testid="an-total-a-la-fecha">
                    <td title={txtYTD}>A LA FECHA (al {c.dia} de {nombreMes(c.mes)})</td>
                    {years.map(y => <td key={y} className="r">{fi(T(al(rangoAnioNatural(y), true)).ventaNeta)}</td>)}
                    {years.map((y, i) => {
                      if (i === 0) return null
                      const vs = varStr(variacion(T(al(rangoAnioNatural(years[i-1]), true)), T(al(rangoAnioNatural(y), true))), true)
                      return <td key={`v${y}`} className="r" style={{ color: vs.color, fontWeight: 700 }}>{vs.text}</td>
                    })}
                  </tr>
                )}
                <tr className="vt-tbl-footer">
                  <td>{anioVivo ? 'AÑO COMPLETO' : 'TOTAL'}</td>
                  {years.map(y => <td key={y} className="r">{fi(T(al(rangoAnioNatural(y), false)).ventaNeta)}</td>)}
                  {years.map((y, i) => {
                    if (i === 0) return null
                    // Un año en curso no se compara contra uno completo: eso va en la fila «a la fecha».
                    const conVivo = anioVivo && (years[i-1] === c.anio || y === c.anio)
                    const vs = varStr(conVivo ? null : variacion(T(al(rangoAnioNatural(years[i-1]), false)), T(al(rangoAnioNatural(y), false))), true)
                    return <td key={`v${y}`} className="r" style={{ color: vs.color, fontWeight: 700 }}>{vs.text}</td>
                  })}
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Quarterly grid */}
          <div className="vt-sl">Por trimestre (Q1–Q4)</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'0.75rem', marginBottom:'1.5rem' }}>
            {QUARTERS.map((qMonths, qi) => {
              const vivo = enCurso(rangoTrimestreNatural(c.anio, qi + 1), c)
              return (
                <div key={qi} style={{ background:'var(--c-panel)', borderRadius:2, padding:'0.875rem' }} data-testid={`an-q${qi+1}`}>
                  <div style={{ fontSize:'0.65rem', color:'var(--c-gris)', marginBottom:'0.625rem', fontWeight:700 }}>
                    Q{qi+1} · {mNames[qMonths[0]-1]}–{mNames[qMonths[2]-1]}{vivo ? ` · a la fecha (al ${c.dia} de ${nombreMes(c.mes)})` : ''}
                  </div>
                  {years.map((y, i) => {
                    const tot  = T(al(rangoTrimestreNatural(y, qi + 1), vivo))
                    const prev = i < years.length-1 ? T(al(rangoTrimestreNatural(years[i+1], qi + 1), vivo)) : null
                    const vp   = prev ? variacion(tot, prev) : null
                    const vs   = varStr(vp)
                    return (
                      <div key={y} style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:'0.4rem', paddingBottom:'0.4rem', borderBottom:'1px solid var(--c-linea)' }}>
                        <span style={{ fontSize:'0.78rem', color:'var(--c-gris)' }}>{y}</span>
                        <div style={{ textAlign:'right' }}>
                          <div style={{ fontSize:'0.85rem', fontWeight:700, color:'var(--c-oro-texto)' }}>{fi(tot.ventaNeta)}</div>
                          {vp !== null && <div style={{ fontSize:'0.68rem', color:vs.color }}>{vs.text}</div>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </>
      )}

      {mode === 'year' && (
        <>
          {/* Year selector */}
          <div className="vt-tab-group" style={{ marginBottom: '1rem' }}>
            {years.map(y => (
              <button key={y} className={`vt-tab-btn ${selYear === y ? 'active' : ''}`}
                onClick={() => setSelYear(y)}>{y}</button>
            ))}
          </div>

          {/* Annual KPIs */}
          {(() => {
            const vivo = selYear === c.anio && anioVivo
            const d    = T(al(rangoAnioNatural(selYear), false))
            const prev = T(al(rangoAnioNatural(selYear - 1), vivo))
            const vsTxt = `vs ${selYear-1}${vivo ? ' a la misma fecha' : ''}`
            function vpKPI(curr: number, p: number) {
              if (!p || prev.dias === 0 || d.dias === 0) return null
              const vp = (curr - p) / p * 100
              return { vp, color: vp >= 0 ? 'var(--vt-green)' : 'var(--vt-red)', text: `${vp >= 0 ? '▲' : '▼'} ${Math.abs(vp).toFixed(1)}%` }
            }
            return (
              <>
                {vivo && (
                  <div className="vt-kpi-sub" data-testid="an-detalle-a-la-fecha" style={{ marginBottom: '0.5rem' }}>
                    {selYear} va <strong>a la fecha</strong>: {txtYTD}, hasta ayer (hoy no entra). Se compara contra
                    los mismos días de {selYear - 1}.
                  </div>
                )}
                <div className="vt-kpi-grid">
                  {[
                    { label:`Venta Neta ${selYear}${vivo ? ' · a la fecha' : ''}`, val:d.ventaNeta, pp:vpKPI(d.ventaNeta, prev.ventaNeta), color:'var(--c-oro-texto)' },
                    { label:'Venta Bruta', val:d.ventaBruta, pp:vpKPI(d.ventaBruta, prev.ventaBruta) },
                    { label:'PAX', val:d.pax, pp:vpKPI(d.pax, prev.pax), fmt:(v:number)=>v.toLocaleString('es-CR') },
                    { label:'Prom/PAX', val:d.ventaPorPersona ?? 0, pp:null, fmt:() => vpp(d), title: TITULO_VPP },
                    { label:'Salón', val:d.salon, pp:vpKPI(d.salon, prev.salon) },
                    { label:'Delivery', val:d.delivery, pp:vpKPI(d.delivery, prev.delivery) },
                  ].map(k => (
                    <div key={k.label} className="vt-kpi" title={'title' in k ? k.title : undefined}>
                      <div className="vt-kpi-label">{k.label}</div>
                      <div className="vt-kpi-val" style={{ color:k.color }}>{k.fmt ? k.fmt(k.val) : fi(k.val)}</div>
                      {k.pp && <div className="vt-kpi-delta" style={{ color:k.pp.color }}>{k.pp.text} {vsTxt}</div>}
                    </div>
                  ))}
                </div>
              </>
            )
          })()}

          {/* Monthly detail table */}
          <div className="vt-sl">Detalle mensual {selYear}</div>
          <div className="vt-tbl-wrap">
            <table className="vt-tbl" data-testid="an-detalle-meses">
              <thead>
                <tr>
                  <th>Mes</th>
                  <th className="r">Venta Neta</th>
                  <th className="r">vs Mes Ant</th>
                  <th className="r">vs {selYear-1}</th>
                  <th className="r">Bruta</th>
                  <th className="r">IVA</th>
                  <th className="r">Servicio</th>
                  <th className="r">PAX</th>
                  <th className="r" title={TITULO_VPP}>Prom/PAX</th>
                  <th className="r">Margen%</th>
                  <th className="r">Margen ₡</th>
                </tr>
              </thead>
              <tbody>
                {MONTHS.map(m => {
                  const nat  = rangoMesNatural(selYear, m)
                  const vivo = enCurso(nat, c)
                  const d    = T(al(nat, false))
                  if (d.dias === 0) return null
                  // Mes anterior: si este va a la fecha, sus días 1 a k (base «anterior equivalente» del motor).
                  const natAnt = m === 1 ? rangoMesNatural(selYear - 1, 12) : rangoMesNatural(selYear, m - 1)
                  const antMes = T(vivo ? primerosDias(natAnt, c.dia) : natAnt)
                  const antAnio = T(al(rangoMesNatural(selYear - 1, m), vivo))
                  const ym      = `${selYear}-${String(m).padStart(2,'0')}`
                  const mPct    = metas.margen?.[ym] ?? 0
                  const mCRC    = mPct > 0 ? d.ventaBruta * mPct / 100 : 0
                  const vMA     = varStr(variacion(d, antMes))
                  const vYA     = varStr(variacion(d, antAnio))
                  const r       = hastaN(nat, c)
                  return (
                    <tr key={m} data-testid={vivo ? 'an-detalle-mes-en-curso' : undefined}>
                      <td style={{ fontWeight:600 }} title={vivo && r ? rotulo(r, c) : undefined}>
                        {MN_FULL[m]}{vivo ? ` · a la fecha (1 al ${c.dia})` : ''}
                      </td>
                      <td className="r vt-bold">{fi(d.ventaNeta)}</td>
                      <td className="r" style={{ color:vMA.color, fontSize:'0.8rem' }}>{vMA.text}</td>
                      <td className="r" style={{ color:vYA.color, fontSize:'0.8rem' }}>{vYA.text}</td>
                      <td className="r" style={{ color:'var(--c-gris)', fontSize:'0.8rem' }}>{fi(d.ventaBruta)}</td>
                      <td className="r vt-muted" style={{ fontSize:'0.78rem' }}>{fi(d.iva)}</td>
                      <td className="r vt-muted" style={{ fontSize:'0.78rem' }}>{fi(d.serv)}</td>
                      <td className="r">{d.pax.toLocaleString('es-CR')}</td>
                      <td className="r">{vpp(d)}</td>
                      <td className="r" style={{ color:mPct>0?'var(--vt-gold-dark)':'var(--vt-muted)' }}>
                        {mPct>0 ? mPct.toFixed(1)+'%' : '—'}
                      </td>
                      <td className="r" style={{ color:mCRC>0?'var(--vt-gold-dark)':'var(--vt-muted)' }}>
                        {mCRC>0 ? fi(mCRC) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                {(() => {
                  const vivo = selYear === c.anio && anioVivo
                  const t = T(al(rangoAnioNatural(selYear), false))
                  return (
                    <tr className="vt-tbl-footer">
                      <td>TOTAL {selYear}{vivo ? ' A LA FECHA' : ''}</td>
                      <td className="r">{fi(t.ventaNeta)}</td>
                      <td/><td/>
                      <td className="r" style={{ color:'var(--c-gris)' }}>{fi(t.ventaBruta)}</td>
                      <td className="r vt-muted" style={{ fontSize:'0.78rem' }}>{fi(t.iva)}</td>
                      <td className="r vt-muted" style={{ fontSize:'0.78rem' }}>{fi(t.serv)}</td>
                      <td className="r">{t.pax.toLocaleString('es-CR')}</td>
                      <td className="r">{vpp(t)}</td>
                      <td/><td/>
                    </tr>
                  )
                })()}
              </tfoot>
            </table>
          </div>

          {/* Quincenal table */}
          <div className="vt-sl">Quincenal {selYear}</div>
          <div className="vt-tbl-wrap">
            <table className="vt-tbl" data-testid="an-quincenas">
              <thead>
                <tr>
                  <th>Período</th>
                  <th className="r">Venta Neta</th>
                  <th className="r">vs Quinc. Ant</th>
                  <th className="r">vs {selYear-1}</th>
                  <th className="r">PAX</th>
                  <th className="r" title={TITULO_VPP}>Prom/PAX</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const rows: React.ReactElement[] = []
                  for (let m = 1; m <= 12; m++) {
                    for (const half of [1, 2] as const) {
                      const nat  = rangoQuincenaNatural(selYear, m, half)
                      const r    = hastaN(nat, c)
                      const q    = T(r)
                      if (!r || !q.dias || !q.ventaNeta) continue
                      const vivo = enCurso(nat, c)
                      const k    = largoEnDias(r)
                      // Quincena anterior (la de antes en el calendario); si esta va a la fecha, sus primeros k días.
                      const natAnt = half === 2 ? rangoQuincenaNatural(selYear, m, 1)
                        : m === 1 ? rangoQuincenaNatural(selYear - 1, 12, 2) : rangoQuincenaNatural(selYear, m - 1, 2)
                      const ant  = T(vivo ? primerosDias(natAnt, k) : natAnt)
                      const antY = T(al(rangoQuincenaNatural(selYear - 1, m, half), vivo))
                      const vsQ = varStr(variacion(q, ant)); const vsY = varStr(variacion(q, antY))
                      rows.push(
                        <tr key={`${m}-${half}`} data-testid={vivo ? 'an-quincena-en-curso' : undefined}>
                          <td style={{ fontWeight:600, fontSize:'0.82rem' }} title={rotulo(r, c)}>
                            {mNames[m-1]} {half===1?'1–15':'16–fin'}{vivo ? ` · a la fecha (al ${c.dia})` : ''}
                          </td>
                          <td className="r vt-bold">{fi(q.ventaNeta)}</td>
                          <td className="r" style={{ color:vsQ.color, fontSize:'0.8rem' }}>{vsQ.text}</td>
                          <td className="r" style={{ color:vsY.color, fontSize:'0.8rem' }}>{vsY.text}</td>
                          <td className="r">{q.pax.toLocaleString('es-CR')}</td>
                          <td className="r">{vpp(q)}</td>
                        </tr>
                      )
                    }
                  }
                  return rows
                })()}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── PROYECCIÓN ANUAL ─────────────────────────────── */}
      {mode === 'proyeccion' && (() => {
        // Hora CR (fase 0.2): el año y el mes son los de HOY en Costa Rica; lo vendido cuenta hasta AYER.
        const curYear    = Number(c.ancla.slice(0, 4))
        const curMonthN  = Number(c.ancla.slice(5, 7))
        const daysInYear = diasDelAnio(curYear)
        const dayOfYear  = c.anio === curYear ? diasCerradosDelAnio(c) : 0
        const ytd        = T(hastaN(rangoAnioNatural(curYear), c))
        const ytdVentas  = ytd.ventaNeta
        const avgPerDay  = ytd.dias > 0 ? ytdVentas / ytd.dias : 0
        const projection = avgPerDay * daysInYear
        const pctYear    = (dayOfYear / daysInYear) * 100

        // Monthly breakdown for current year with projections
        const monthlyData = [1,2,3,4,5,6,7,8,9,10,11,12].map(m => {
          const ym     = `${curYear}-${String(m).padStart(2,'0')}`
          const isPast = m < curMonthN
          const isCur  = m === curMonthN
          const nat    = rangoMesNatural(curYear, m)
          const r      = hastaN(nat, c)
          const actual = T(r).ventaNeta
          const dIM    = largoEnDias(nat)
          // Días CERRADOS del mes (calendario, hasta ayer): el mes en curso se proyecta desde ahí.
          const k      = isCur && r ? largoEnDias(r) : 0
          const projected = isPast ? actual
            : isCur ? (k > 0 ? (actual / k) * dIM : avgPerDay * dIM)
            : avgPerDay * dIM
          const metaAmt = metas.restaurante?.[ym] ?? 0
          // Avance contra la meta: el mes en curso, contra la meta A LA FECHA (prorrateada a sus días
          // cerrados), nunca contra la meta del mes completo.
          const metaRef = isCur ? metaALaFecha(metaAmt, k, dIM) : metaAmt
          const avance  = metaRef > 0 && (isPast || (isCur && k > 0)) ? (actual / metaRef) * 100 : null
          return { m, ym, actual, projected, metaAmt, metaRef, avance, isPast, isCur, k, r }
        })

        // Mes pasado = lo vendido; mes en curso y futuros = lo proyectado (antes el mes en curso
        // sumaba solo lo vendido hasta hoy y la proyección del año quedaba corta).
        const projectedTotal = monthlyData.reduce((s, m) => s + (m.isPast ? m.actual : m.projected), 0)
        const metaYear       = Object.entries(metas.restaurante ?? {})
          .filter(([ym]) => ym.startsWith(String(curYear)))
          .reduce((s, [, v]) => s + v, 0)
        const cur = monthlyData[curMonthN - 1]

        const mNames = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

        return (
          <div>
            {/* Main projection card */}
            <div style={{ background: 'var(--c-fondo)', borderRadius: 3, padding: '1.25rem', marginBottom: '1.5rem', color: 'var(--c-tinta)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '1rem' }} data-testid="an-proyeccion">
                {[
                  { label: `${curYear} a la fecha (${ytd.dias} días, hasta ayer)`, val: fi(ytdVentas), color: 'var(--c-oro-texto)', sub: '' },
                  { label: 'Proyección año completo', val: fi(projection), color: projectedTotal >= metaYear ? 'var(--vt-green)' : 'var(--c-laca)', sub: '' },
                  { label: 'Promedio por día', val: fi(avgPerDay), color: '', sub: '' },
                  { label: `Meta de ${nombreMes(curMonthN)} a la fecha`,
                    val: cur.metaAmt > 0 && cur.k > 0 ? fi(cur.metaRef) : '—',
                    color: cur.avance === null ? 'var(--vt-muted)' : cur.avance >= 100 ? 'var(--vt-green)' : 'var(--c-laca)',
                    sub: cur.metaAmt > 0 && cur.k > 0 && cur.r
                      ? `${rotulo(cur.r, c)} · vendido ${fi(cur.actual)} (${cur.avance!.toFixed(0)}%) · meta del mes ${fi(cur.metaAmt)}`
                      : cur.metaAmt > 0 ? 'Todavía sin días cerrados en el mes' : 'Sin meta cargada para el mes' },
                  { label: `Meta ${curYear}`, val: metaYear > 0 ? fi(metaYear) : '—', color: 'var(--vt-muted)', sub: '' },
                ].map(k => (
                  <div key={k.label}>
                    <div style={{ fontSize: '0.62rem', color: 'var(--c-gris)', marginBottom: '0.3rem' }}>{k.label}</div>
                    <div style={{ fontFamily: 'var(--font-serif)', fontVariantNumeric: 'tabular-nums', fontSize: '1.1rem', fontWeight: 800, color: k.color || 'var(--c-tinta)' }}>{k.val}</div>
                    {k.sub && <div style={{ fontSize: '0.62rem', color: 'var(--c-gris)', marginTop: '0.2rem' }}>{k.sub}</div>}
                  </div>
                ))}
              </div>
              {/* Progress bar: % of year elapsed */}
              <div style={{ marginTop: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: 'var(--c-gris)', marginBottom: '0.3rem' }}>
                  <span>Año transcurrido: {pctYear.toFixed(0)}%</span>
                  <span>{dayOfYear} días cerrados de {daysInYear}</span>
                </div>
                <div style={{ height: 6, background: 'var(--c-panel)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pctYear}%`, background: 'var(--vt-gold)', borderRadius: 3 }} />
                </div>
              </div>
            </div>

            {/* Monthly bar chart */}
            <div className="vt-sl">Ventas reales vs proyección — {curYear}</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.4rem', height: 140, marginBottom: '0.5rem', padding: '0 0.25rem' }}>
              {monthlyData.map(d => {
                const maxVal = Math.max(...monthlyData.map(x => Math.max(x.actual, x.projected, x.metaAmt)))
                const actH   = maxVal > 0 ? Math.round((d.actual / maxVal) * 100) : 0
                const projH  = maxVal > 0 ? Math.round(((d.projected || 0) / maxVal) * 100) : 0
                const metaH  = maxVal > 0 && d.metaAmt > 0 ? Math.round((d.metaAmt / maxVal) * 100) : 0
                return (
                  <div key={d.m} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                    {d.actual > 0 && (
                      <div style={{ width: '100%', height: `${actH}%`, background: d.isCur ? 'var(--vt-gold)' : 'var(--vt-green)', borderRadius: 2, opacity: d.isPast ? 1 : 0.6 }} />
                    )}
                    {!d.actual && d.projected > 0 && (
                      <div style={{ width: '100%', height: `${projH}%`, background: 'var(--c-panel)', borderRadius: 2, borderTop: '2px dashed var(--vt-muted)' }} />
                    )}
                    {metaH > 0 && (
                      <div style={{ position: 'relative', width: '100%', height: 0 }}>
                        <div style={{ position: 'absolute', bottom: 0, width: '100%', borderBottom: '1px solid var(--vt-red)', opacity: 0.6 }} />
                      </div>
                    )}
                    <div style={{ fontSize: '0.55rem', color: d.isCur ? 'var(--c-oro-texto)' : 'var(--c-gris)', fontWeight: d.isCur ? 700 : 400 }}>
                      {mNames[d.m - 1]}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Monthly table */}
            <div className="vt-tbl-wrap">
              <table className="vt-tbl">
                <thead>
                  <tr>
                    <th>Mes</th>
                    <th className="r">Real</th>
                    <th className="r">Proyectado</th>
                    <th className="r">Meta</th>
                    <th className="r">vs Meta</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyData.map(d => (
                    <tr key={d.m} style={{ fontWeight: d.isCur ? 700 : 400 }} data-testid={d.isCur ? 'an-proy-mes-en-curso' : undefined}>
                      <td style={{ color: d.isCur ? 'var(--c-oro-texto)' : undefined }}>
                        {mNames[d.m - 1]} {d.isCur ? `← a la fecha${d.k > 0 ? ` (1 al ${d.k})` : ''}` : ''}
                      </td>
                      <td className="r vt-bold">{d.actual > 0 ? fi(d.actual) : '—'}</td>
                      <td className="r vt-muted" style={{ fontStyle: !d.isPast && !d.isCur ? 'italic' : undefined }}>
                        {fi(d.projected || d.actual)}
                      </td>
                      <td className="r vt-muted">{d.metaAmt > 0 ? fi(d.metaAmt) : '—'}</td>
                      <td className="r" style={{ color: d.avance === null ? undefined : d.avance >= 100 ? 'var(--vt-green)' : 'var(--vt-red)' }}
                        title={d.isCur && d.avance !== null ? `Contra la meta a la fecha: ${fi(d.metaRef)}` : undefined}>
                        {d.avance === null ? '—' : `${d.avance.toFixed(0)}%${d.isCur ? ' a la fecha' : ''}`}
                      </td>
                    </tr>
                  ))}
                  <tr className="vt-tbl-footer" style={{ fontWeight: 700 }}>
                    <td>PROYECCIÓN TOTAL</td>
                    <td className="r" title="Vendido hasta ayer">{fi(ytdVentas)}</td>
                    <td className="r" style={{ color: projectedTotal >= metaYear ? 'var(--vt-green)' : 'var(--vt-red)' }}>{fi(projectedTotal)}</td>
                    <td className="r">{metaYear > 0 ? fi(metaYear) : '—'}</td>
                    <td className="r">{metaYear > 0 ? (projectedTotal / metaYear * 100).toFixed(0) + '%' : '—'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
