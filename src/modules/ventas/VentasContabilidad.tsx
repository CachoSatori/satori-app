import { useState, useMemo, lazy, Suspense } from 'react'
import type { DiasMap, HistMap, Meta, ProductMap } from '../../shared/types/ventas'
import {
  getContabilidadDays, availableMonths, availableYears,
  fi, fmtDate, metaProgress,
  dowAverages, dowLabel, dayOfWeek,
} from './ventasUtils'

const ReporteMensual = lazy(() => import('./ReporteMensual'))

interface Props {
  dias:  DiasMap
  hist:  HistMap
  metas: Meta
  pm:    ProductMap
}

export default function VentasContabilidad({ dias, hist, metas, pm }: Props) {
  const months = useMemo(() => availableMonths(dias, hist), [dias, hist])
  const years  = useMemo(() => availableYears(dias, hist), [dias, hist])
  const [selected, setSelected] = useState<string>(months[0] ?? '')
  const [showReport, setShowReport] = useState(false)

  const isYear = selected.startsWith('todo-')
  const yearNum = isYear ? Number(selected.slice(5)) : Number(selected.slice(0, 4))
  const monthNum = isYear ? null : Number(selected.slice(5, 7))

  const days = useMemo(() =>
    getContabilidadDays(yearNum, monthNum, dias, hist),
  [yearNum, monthNum, dias, hist])

  const totVentaNeta  = days.reduce((s, d) => s + d.ventaNeta, 0)
  const totVentaBruta = days.reduce((s, d) => s + d.ventaBruta, 0)
  const totIVA        = days.reduce((s, d) => s + d.iva, 0)
  const totServ       = days.reduce((s, d) => s + d.serv, 0)
  const totSalon      = days.reduce((s, d) => s + d.salon, 0)
  const totDelivery   = days.reduce((s, d) => s + d.delivery, 0)
  const totPax        = days.reduce((s, d) => s + d.pax, 0)
  const totPromPax    = totPax > 0 ? totSalon / totPax : 0

  const progress = !isYear ? metaProgress(metas, dias, hist, selected) : null

  const maxVenta = Math.max(...days.map(d => d.ventaNeta))
  const minVenta = Math.min(...days.map(d => d.ventaNeta))

  const dowAvg = useMemo(() => dowAverages(days), [days])

  const exportCSV = () => {
    const BOM = '﻿'
    const hdrs = ['Fecha','Día','Venta Bruta','IVA','Servicio','Venta Neta','Salón','Delivery','PAX','Prom/PAX']
    const rows = days.map(d => [
      d.fecha, dowLabel(dayOfWeek(d.fecha)),
      d.ventaBruta, d.iva, d.serv, d.ventaNeta,
      d.salon, d.delivery, d.pax,
      Math.round(d.promPax),
    ].map(v => `"${v}"`).join(','))
    const csv = BOM + [hdrs.join(','), ...rows].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    a.download = `satori_ventas_${selected}.csv`
    a.click()
  }

  return (
    <div className="vt-section">
      {/* Period picker */}
      <div className="vt-period-picker">
        {years.map(y => (
          <div key={y} style={{ marginBottom: '0.5rem' }}>
            <button
              className={`vt-period-btn year ${selected === `todo-${y}` ? 'active' : ''}`}
              onClick={() => setSelected(`todo-${y}`)}>
              Todo {y}
            </button>
            {months.filter(m => m.startsWith(String(y))).map(m => {
              const [, mo] = m.split('-')
              const mNames = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
              return (
                <button key={m}
                  className={`vt-period-btn ${selected === m ? 'active' : ''}`}
                  onClick={() => setSelected(m)}>
                  {mNames[Number(mo)-1]}
                </button>
              )
            })}
          </div>
        ))}
      </div>

      {/* Meta progress bar */}
      {progress && (
        <div className="vt-meta-bar">
          <div className="vt-meta-bar-top">
            <span>Meta {selected} — {fi(progress.meta)}</span>
            <span style={{ color: progress.onTrack ? 'var(--vt-green)' : 'var(--vt-red)' }}>
              {progress.pct.toFixed(1)}% · Proyección: {fi(progress.projection)}
            </span>
          </div>
          <div className="vt-progress-track">
            <div className="vt-progress-fill" style={{
              width: `${Math.min(progress.pct, 100)}%`,
              background: progress.onTrack ? 'var(--vt-green)' : 'var(--vt-red)',
            }} />
          </div>
        </div>
      )}

      {/* KPIs */}
      <div className="vt-kpi-grid">
        <div className="vt-kpi red">
          <div className="vt-kpi-label">Venta Bruta</div>
          <div className="vt-kpi-val">{fi(totVentaBruta)}</div>
        </div>
        <div className="vt-kpi">
          <div className="vt-kpi-label">IVA (13%)</div>
          <div className="vt-kpi-val">{fi(totIVA)}</div>
        </div>
        <div className="vt-kpi">
          <div className="vt-kpi-label">Servicio</div>
          <div className="vt-kpi-val">{fi(totServ)}</div>
        </div>
        <div className="vt-kpi green">
          <div className="vt-kpi-label">Venta Neta</div>
          <div className="vt-kpi-val">{fi(totVentaNeta)}</div>
        </div>
        <div className="vt-kpi">
          <div className="vt-kpi-label">Salón</div>
          <div className="vt-kpi-val">{fi(totSalon)}</div>
        </div>
        <div className="vt-kpi blue">
          <div className="vt-kpi-label">Delivery</div>
          <div className="vt-kpi-val">{fi(totDelivery)}</div>
        </div>
        <div className="vt-kpi">
          <div className="vt-kpi-label">PAX</div>
          <div className="vt-kpi-val">{totPax.toLocaleString('es-CR')}</div>
        </div>
        <div className="vt-kpi">
          <div className="vt-kpi-label">Prom/PAX</div>
          <div className="vt-kpi-val">{fi(totPromPax)}</div>
        </div>
      </div>

      {/* Day of week averages */}
      {days.length > 0 && (
        <>
          <div className="vt-sl">Promedio por día de semana</div>
          <div className="vt-dow-grid">
            {[1,2,3,4,5,6,0].map(d => {
              const avg = dowAvg[d]
              const val = avg ? Math.round(avg.sum / avg.cnt) : 0
              const allVals = [1,2,3,4,5,6,0].map(dd => dowAvg[dd] ? dowAvg[dd].sum/dowAvg[dd].cnt : 0)
              const max = Math.max(...allVals)
              const min = Math.min(...allVals.filter(v => v > 0))
              const isBest  = val > 0 && val === max
              const isWorst = val > 0 && val === min && min !== max
              return (
                <div key={d} className={`vt-dow-card ${isBest ? 'best' : isWorst ? 'worst' : ''}`}>
                  <div className="vt-dow-label">{dowLabel(d)}</div>
                  <div className="vt-dow-val">{val > 0 ? fi(val) : '—'}</div>
                  {avg && <div className="vt-dow-sub">{avg.cnt} días</div>}
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Daily table */}
      <div className="vt-table-actions">
        <div className="vt-sl" style={{ margin: 0, flex: 1 }}>
          Detalle por día ({days.length} días)
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {!isYear && (
            <button className="tips-btn-teal" style={{ fontSize: '0.8rem' }}
              onClick={() => setShowReport(true)}>
              🖨 Reporte
            </button>
          )}
          <button className="tips-btn-ghost" style={{ fontSize: '0.8rem' }} onClick={exportCSV}>⬇ CSV</button>
        </div>
      </div>
      <div className="vt-tbl-wrap">
        <table className="vt-tbl">
          <thead>
            <tr>
              <th>#</th>
              <th>Fecha</th>
              <th>Día</th>
              <th className="r">Venta Bruta</th>
              <th className="r">IVA</th>
              <th className="r">Servicio</th>
              <th className="r">Venta Neta</th>
              <th className="r">Salón</th>
              <th className="r">Delivery</th>
              <th className="r">PAX</th>
              <th className="r">Prom/PAX</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d, i) => {
              const isBest  = d.ventaNeta === maxVenta && maxVenta > 0
              const isWorst = d.ventaNeta === minVenta && minVenta > 0 && minVenta !== maxVenta
              return (
                <tr key={d.fecha} className={isBest ? 'tr-best' : isWorst ? 'tr-worst' : ''}>
                  <td className="vt-muted">{i + 1}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(d.fecha)}</td>
                  <td className="vt-muted">{dowLabel(dayOfWeek(d.fecha))}</td>
                  <td className="r">{fi(d.ventaBruta)}</td>
                  <td className="r vt-muted" style={{ fontSize: '0.8rem' }}>{fi(d.iva)}</td>
                  <td className="r vt-muted" style={{ fontSize: '0.8rem' }}>{fi(d.serv)}</td>
                  <td className="r vt-bold">{fi(d.ventaNeta)}</td>
                  <td className="r">{fi(d.salon)}</td>
                  <td className="r vt-delivery">{fi(d.delivery)}</td>
                  <td className="r">{d.pax}</td>
                  <td className="r">{fi(d.promPax)}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="vt-tbl-footer">
              <td colSpan={3}>TOTAL</td>
              <td className="r">{fi(totVentaBruta)}</td>
              <td className="r">{fi(totIVA)}</td>
              <td className="r">{fi(totServ)}</td>
              <td className="r vt-bold">{fi(totVentaNeta)}</td>
              <td className="r">{fi(totSalon)}</td>
              <td className="r">{fi(totDelivery)}</td>
              <td className="r">{totPax}</td>
              <td className="r">{fi(totPromPax)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Reporte modal */}
      {showReport && !isYear && (
        <Suspense fallback={null}>
          <ReporteMensual
            ym={selected}
            dias={dias}
            hist={hist}
            pm={pm}
            metas={metas}
            onClose={() => setShowReport(false)}
          />
        </Suspense>
      )}
    </div>
  )
}
