import { useMemo } from 'react'
import type { DiasMap, HistMap } from '../../shared/types/ventas'
import { getContabilidadDays, availableYears, fi } from './ventasUtils'
// «A la fecha» (Ventas v2, fases 0.2 y 1.3): todo rango sale de `aLaFecha.ts`, que usa el motor
// `periodos.ts`. Un período en curso llega hasta AYER (hora CR) y su base se corta a los mismos días.
import {
  alineadoAlCorte, corteDe, enCurso, hastaN, nombreMes, rangoAnioNatural, rangoMesNatural, rangoTrimestreNatural,
  rotulo, totalesEnRango, variacion, type Rango, type Totales,
} from './aLaFecha'

// Ventas v2 · 3.5.2 (SPEC §12.2): «Detalle anual», «Proyección» y «Prom/PAX explicado» se retiraron. Lo suyo
// está en «Resumen» (períodos «Mes» y «Año a la fecha», «Meta de {mes}» y «Qué explica el cambio») y en
// «Tiempos» → «Quincenas». Queda «Año vs Año», que pasa a «Tiempos» → «Meses y temporadas» en la 3.5.3.

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
}

/** Venta por persona para mostrar (D4, `indicadores.ts`): «—» sin personas. */
const vpp = (t: Totales) => (t.ventaPorPersona === null ? '—' : fi(t.ventaPorPersona))
const TITULO_VPP = 'Venta de salón ÷ personas de salón (una sola fórmula en toda la app)'

export default function VentasAnalisis({ dias, hist }: Props) {
  // El corte (hoy y ayer en hora CR) se fija al abrir la pantalla.
  const c = useMemo(() => corteDe(), [])
  // Los años y todos los días (resumen por día) una sola vez; cada número es una suma por rango.
  const { years, todos } = useMemo(() => {
    const ys = availableYears(dias, hist)
    return { years: ys, todos: ys.flatMap(y => getContabilidadDays(y, null, dias, hist)) }
  }, [dias, hist])

  const MONTHS = [1,2,3,4,5,6,7,8,9,10,11,12]
  const T = (r: Rango | null) => totalesEnRango(todos, r)
  /** El contenedor del año `y`, alineado al corte si el mismo contenedor del año en curso no terminó. */
  const al = (nat: Rango, vivo: boolean) => alineadoAlCorte(nat, vivo, c)

  const anioVivo = enCurso(rangoAnioNatural(c.anio), c)
  const rangoYTD = hastaN(rangoAnioNatural(c.anio), c)
  const txtYTD   = rangoYTD ? rotulo(rangoYTD, c) : ''

  const mNames = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

  const selector = (
    <div className="vt-kpi-sub" data-testid="an-movido" style={{ marginBottom: '1rem' }}>
      Año vs Año. El detalle por mes y por quincena, la proyección y «Prom/PAX explicado» pasaron a «Resumen» (períodos
      «Mes» y «Año a la fecha», «Meta del mes» y «Qué explica el cambio») y a «Tiempos» → «Quincenas».
    </div>
  )

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
      {selector}

      {(
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

    </div>
  )
}
