/**
 * ReporteMensual — Reporte ejecutivo mensual imprimible
 * Accesible desde VentasContabilidad vía botón "🖨 Reporte"
 * Usa window.print() — el browser lo convierte en PDF via "Guardar como PDF"
 */
import { useMemo } from 'react'
import type { DiasMap, HistMap, ProductMap, Meta } from '../../shared/types/ventas'
import {
  getContabilidadDays, aggGeneral, aggSalonero, allSaloneros,
  fi, fmtDate, fmtMonthLabel, metaProgress,
  topProds, dowAverages, dowLabel, daysInMonth,
} from './ventasUtils'

interface Props {
  ym:    string      // "YYYY-MM"
  dias:  DiasMap
  hist:  HistMap
  pm:    ProductMap
  metas: Meta
  onClose: () => void
}

export default function ReporteMensual({ ym, dias, hist, pm, metas, onClose }: Props) {
  const [y, m] = ym.split('-').map(Number)

  const days = useMemo(() => getContabilidadDays(y, m, dias, hist), [y, m, dias, hist])

  // Previous month for comparison
  const prevYM = m === 1 ? `${y-1}-12` : `${y}-${String(m-1).padStart(2,'0')}`
  const [py, pm2] = prevYM.split('-').map(Number)
  const prevDays = useMemo(() => getContabilidadDays(py, pm2, dias, hist), [py, pm2, dias, hist])

  // Aggregations
  const rangeDates = useMemo(() => days.map(d => d.fecha), [days])
  const gen = useMemo(() => aggGeneral(rangeDates, dias, pm), [rangeDates, dias, pm])
  const sals = useMemo(() => allSaloneros(dias), [dias])
  const salAggs = useMemo(() =>
    sals
      .map(n => ({ name: n, agg: aggSalonero(n, rangeDates, dias, pm) }))
      .filter(s => s.agg.days > 0)
      .sort((a, b) => b.agg.promPax - a.agg.promPax)
      .slice(0, 5),
  [sals, rangeDates, dias, pm])

  const prods10 = useMemo(() => topProds(gen.prods, 'monto', 10, undefined, pm), [gen.prods, pm])
  const dow     = useMemo(() => dowAverages(days), [days])

  // Financial totals
  const totVN   = days.reduce((s, d) => s + d.ventaNeta, 0)
  const totVB   = days.reduce((s, d) => s + d.ventaBruta, 0)
  const totIVA  = days.reduce((s, d) => s + d.iva, 0)
  const totServ = days.reduce((s, d) => s + d.serv, 0)
  const totSal  = days.reduce((s, d) => s + d.salon, 0)
  const totDel  = days.reduce((s, d) => s + d.delivery, 0)
  const totPax  = days.reduce((s, d) => s + d.pax, 0)

  const prevVN  = prevDays.reduce((s, d) => s + d.ventaNeta, 0)
  const varVN   = prevVN > 0 ? ((totVN - prevVN) / prevVN * 100).toFixed(1) : null
  const maxDay  = days.length ? days.reduce((a, b) => a.ventaNeta > b.ventaNeta ? a : b) : null
  const minDay  = days.length ? days.reduce((a, b) => a.ventaNeta < b.ventaNeta ? a : b) : null

  const prog    = metaProgress(metas, dias, hist, ym)
  const today   = new Date().toLocaleDateString('es-CR', { day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <>
      {/* Print overlay */}
      <div className="rpt-overlay" onClick={onClose}>
        <div className="rpt-paper" onClick={e => e.stopPropagation()}>

          {/* Toolbar — hidden on print */}
          <div className="rpt-toolbar no-print">
            <div>
              <strong>Reporte {fmtMonthLabel(ym)}</strong>
              <span style={{ fontSize: '0.78rem', color: '#888', marginLeft: '0.75rem' }}>
                Usá Ctrl+P (o Cmd+P) para guardar como PDF
              </span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="tips-btn-teal" style={{ fontSize: '0.8rem' }}
                onClick={() => window.print()}>
                🖨 Imprimir / PDF
              </button>
              <button className="tips-btn-ghost" style={{ fontSize: '0.8rem' }}
                onClick={onClose}>
                ✕ Cerrar
              </button>
            </div>
          </div>

          {/* ── REPORT CONTENT ── */}
          <div className="rpt-content">

            {/* Header */}
            <div className="rpt-header">
              <div>
                <div className="rpt-logo">SATORI</div>
                <div className="rpt-logo-sub">Santa Teresa, Costa Rica</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="rpt-period">{fmtMonthLabel(ym)}</div>
                <div className="rpt-generated">Generado el {today}</div>
              </div>
            </div>

            {/* Section 1: Resumen Financiero */}
            <div className="rpt-section-title">Resumen Financiero</div>
            <div className="rpt-kpi-grid">
              {[
                { label: 'Venta Bruta',    val: fi(totVB),   bold: false },
                { label: 'IVA (13%)',       val: fi(totIVA),  bold: false, muted: true },
                { label: 'Servicio (10%)',  val: fi(totServ), bold: false, muted: true },
                { label: 'Venta Neta',      val: fi(totVN),   bold: true  },
                { label: 'Salón',           val: fi(totSal),  bold: false },
                { label: 'Delivery',        val: fi(totDel),  bold: false },
                { label: 'PAX Total',       val: totPax.toLocaleString('es-CR'), bold: false },
                { label: 'Prom/PAX',        val: fi(totPax > 0 ? totSal / totPax : 0), bold: false },
              ].map(k => (
                <div key={k.label} className={`rpt-kpi ${k.muted ? 'muted' : ''}`}>
                  <div className="rpt-kpi-label">{k.label}</div>
                  <div className={`rpt-kpi-val ${k.bold ? 'bold' : ''}`}>{k.val}</div>
                </div>
              ))}
            </div>

            {/* vs previous month */}
            <div className="rpt-compare-row">
              <span>vs {fmtMonthLabel(prevYM)}: <strong style={{ color: varVN !== null ? (Number(varVN) >= 0 ? '#2a6a42' : '#c0392b') : '#888' }}>{varVN !== null ? (Number(varVN) >= 0 ? '▲ +' : '▼ ') + varVN + '%' : '—'}</strong> en venta neta</span>
              {prog && <span>· Meta {fmtMonthLabel(ym)}: <strong>{prog.pct.toFixed(1)}%</strong> alcanzado ({fi(prog.ventasMes)} de {fi(prog.meta)})</span>}
            </div>

            {/* Section 2: Highlights */}
            <div className="rpt-row-2">
              <div style={{ flex: 1 }}>
                <div className="rpt-section-title">Días destacados</div>
                <table className="rpt-table">
                  <tbody>
                    <tr>
                      <td className="rpt-td-label">Mejor día</td>
                      <td>{maxDay ? fmtDate(maxDay.fecha) : '—'}</td>
                      <td className="rpt-td-val">{maxDay ? fi(maxDay.ventaNeta) : '—'}</td>
                    </tr>
                    <tr>
                      <td className="rpt-td-label">Peor día</td>
                      <td>{minDay ? fmtDate(minDay.fecha) : '—'}</td>
                      <td className="rpt-td-val">{minDay ? fi(minDay.ventaNeta) : '—'}</td>
                    </tr>
                    <tr>
                      <td className="rpt-td-label">Promedio/día</td>
                      <td></td>
                      <td className="rpt-td-val">{days.length > 0 ? fi(totVN / days.length) : '—'}</td>
                    </tr>
                    <tr>
                      <td className="rpt-td-label">Días trabajados</td>
                      <td></td>
                      <td className="rpt-td-val">{days.length} de {daysInMonth(ym)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div style={{ flex: 1 }}>
                <div className="rpt-section-title">Por día de semana</div>
                <table className="rpt-table">
                  <thead>
                    <tr>
                      <th className="rpt-th">Día</th>
                      <th className="rpt-th" style={{ textAlign: 'right' }}>Promedio</th>
                      <th className="rpt-th" style={{ textAlign: 'right' }}>Días</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[1,2,3,4,5,6,0].map(d => {
                      const v = dow[d]
                      return v ? (
                        <tr key={d}>
                          <td>{dowLabel(d)}</td>
                          <td className="rpt-td-val">{fi(Math.round(v.sum / v.cnt))}</td>
                          <td style={{ textAlign: 'right', color: '#888', fontSize: '0.75rem' }}>{v.cnt}</td>
                        </tr>
                      ) : null
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Section 3: Top Saloneros */}
            {salAggs.length > 0 && (
              <>
                <div className="rpt-section-title">Top Saloneros</div>
                <table className="rpt-table" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th className="rpt-th">#</th>
                      <th className="rpt-th">Salonero</th>
                      <th className="rpt-th" style={{ textAlign: 'right' }}>Días</th>
                      <th className="rpt-th" style={{ textAlign: 'right' }}>Ventas</th>
                      <th className="rpt-th" style={{ textAlign: 'right' }}>PAX</th>
                      <th className="rpt-th" style={{ textAlign: 'right' }}>Prom/PAX</th>
                      <th className="rpt-th" style={{ textAlign: 'right' }}>Beb/PAX</th>
                      <th className="rpt-th" style={{ textAlign: 'right' }}>Ratio C/B</th>
                    </tr>
                  </thead>
                  <tbody>
                    {salAggs.map(({ name, agg }, i) => (
                      <tr key={name}>
                        <td style={{ color: '#888' }}>{i + 1}</td>
                        <td style={{ fontWeight: 600 }}>{name}</td>
                        <td className="rpt-td-val">{agg.days}</td>
                        <td className="rpt-td-val">{fi(agg.total)}</td>
                        <td className="rpt-td-val">{agg.pax}</td>
                        <td className="rpt-td-val bold">{fi(agg.promPax)}</td>
                        <td className="rpt-td-val">{agg.bebPax.toFixed(2)}</td>
                        <td className="rpt-td-val">{agg.ratioCB.toFixed(2)}:1</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {/* Section 4: Top 10 Productos */}
            {prods10.length > 0 && (
              <div className="rpt-row-2">
                <div style={{ flex: 1 }}>
                  <div className="rpt-section-title">Top 10 Productos</div>
                  <table className="rpt-table">
                    <thead>
                      <tr>
                        <th className="rpt-th">#</th>
                        <th className="rpt-th">Producto</th>
                        <th className="rpt-th" style={{ textAlign: 'right' }}>Uds</th>
                        <th className="rpt-th" style={{ textAlign: 'right' }}>Monto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prods10.map((p, i) => (
                        <tr key={p.nombre}>
                          <td style={{ color: '#888' }}>{i + 1}</td>
                          <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nombre}</td>
                          <td className="rpt-td-val">{p.q}</td>
                          <td className="rpt-td-val">{fi(p.m)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="rpt-footer">
              Satori App · {fmtMonthLabel(ym)} · Generado el {today}
            </div>
          </div>
        </div>
      </div>

      {/* Print styles — @media print ensures this is PDF-clean */}
      <style>{`
        @media print {
          body > * { display: none !important; }
          .rpt-overlay { display: block !important; position: static !important; background: none !important; }
          .rpt-paper { box-shadow: none !important; margin: 0 !important; max-height: none !important; overflow: visible !important; }
          .no-print { display: none !important; }
          .rpt-content { padding: 0 !important; }
          @page { margin: 1.5cm; size: A4 portrait; }
        }
      `}</style>
    </>
  )
}
