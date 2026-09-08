import { useState, useMemo } from 'react'
import { todayCR } from '../../shared/utils'
import type { DiasMap } from '../../shared/types/ventas'
import {
  aggCajero, allCajeros, esEntradaCajero,
  fi, fmtDate, datesInRange, allDates, dowLabel, dayOfWeek,
} from './ventasUtils'

interface Props {
  dias: DiasMap
}

function nDaysAgo(n: number): string {
  const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0,10)
}


const PRESETS = [
  { label: '7 días',  from: () => nDaysAgo(7) },
  { label: '15 días', from: () => nDaysAgo(14) },
  { label: 'Mes',     from: () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01` } },
  { label: 'Todo',    from: () => '2020-01-01' },
]

export default function VentasCajeros({ dias }: Props) {
  const [preset, setPreset] = useState(2)
  const [from, setFrom] = useState(PRESETS[2].from())
  const [to,   setTo]   = useState(todayCR())

  const dates = useMemo(() => allDates(dias), [dias])
  const range = useMemo(() => datesInRange(dates, from, to), [dates, from, to])

  // Los buckets de caja del PoS (`CajeroDay`), por la MARCA `esCajero` de cada entrada y no
  // por el nombre de la clave: el PoS etiqueta la caja con `etiquetaNoMesero()` y solo dos de
  // esas etiquetas caen en `CAJEROS_IDS`, la lista de nombres del .xls. Filtrando por nombre,
  // `Caja · 388`, `Sistema · …` y `Sin salonero` quedaban INVISIBLES acá aunque su plata sí
  // contara en el total del día (`getDayStats`/`aggGeneral` ya leen la marca).
  const cajerosCargados = useMemo(() => allCajeros(dias), [dias])
  // Las columnas y las tarjetas son las del PERÍODO elegido, no las de todo lo cargado.
  const cajeroNames     = useMemo(() => allCajeros(dias, range), [dias, range])

  const cajAggs = useMemo(() =>
    cajeroNames.map(n => aggCajero(n, range, dias)),
  [cajeroNames, range, dias])

  const totTotal    = cajAggs.reduce((s, c) => s + c.total, 0)
  const totSalon    = cajAggs.reduce((s, c) => s + c.salon, 0)
  const totDelivery = cajAggs.reduce((s, c) => s + c.delivery, 0)

  // Day-of-week averages
  const dowData = useMemo(() => {
    const acc: Record<number, { sum: number; cnt: number }> = {}
    for (const date of range) {
      if (!dias[date]) continue
      const dow  = dayOfWeek(date)
      const cajTotal = Object.values(dias[date].saloneros)
        .filter(esEntradaCajero)
        .reduce((s, c) => s + c.total, 0)
      if (!acc[dow]) acc[dow] = { sum: 0, cnt: 0 }
      acc[dow].sum += cajTotal; acc[dow].cnt++
    }
    return acc
  }, [range, dias])

  // Vacío de verdad: no hay NINGÚN día cargado con ventas de caja. Solo acá se esconde la
  // barra de rango — si el período elegido es el que está vacío, la barra tiene que seguir
  // en pantalla para poder cambiarlo (ver el vacío de período, más abajo).
  if (!cajerosCargados.length) {
    return (
      <div className="vt-empty">
        <div className="vt-empty-icon">🏦</div>
        <div className="vt-empty-title">Sin datos de cajeros</div>
        <div className="vt-empty-sub">Todavía no hay ventas de caja en los días cargados</div>
      </div>
    )
  }

  return (
    <div className="vt-section">
      {/* Range bar */}
      <div className="vt-range-bar">
        {PRESETS.map((p, i) => (
          <button key={i} className={`vt-range-btn ${preset === i ? 'active' : ''}`}
            onClick={() => { setFrom(p.from()); setTo(todayCR()); setPreset(i) }}>
            {p.label}
          </button>
        ))}
        <input className="vt-date-input" type="date" value={from}
          onChange={e => { setFrom(e.target.value); setPreset(-1) }} />
        <span>→</span>
        <input className="vt-date-input" type="date" value={to}
          onChange={e => { setTo(e.target.value); setPreset(-1) }} />
        <span className="vt-range-label">{range.length} días</span>
      </div>

      {!cajeroNames.length ? (
        <div className="vt-empty">
          <div className="vt-empty-icon">🏦</div>
          <div className="vt-empty-title">Sin ventas de caja en el período</div>
          <div className="vt-empty-sub">
            No hay movimiento de caja entre {fmtDate(from)} y {fmtDate(to)}. Elegí otro rango.
          </div>
        </div>
      ) : (
      <>
      {/* KPIs */}
      <div className="vt-kpi-grid">
        <div className="vt-kpi red">
          <div className="vt-kpi-label">Total cajeros</div>
          <div className="vt-kpi-val">{fi(totTotal)}</div>
        </div>
        <div className="vt-kpi">
          <div className="vt-kpi-label">Salón</div>
          <div className="vt-kpi-val">{fi(totSalon)}</div>
          <div className="vt-kpi-sub">{totTotal > 0 ? (totSalon/totTotal*100).toFixed(1) : 0}%</div>
        </div>
        <div className="vt-kpi blue">
          <div className="vt-kpi-label">Delivery</div>
          <div className="vt-kpi-val">{fi(totDelivery)}</div>
          <div className="vt-kpi-sub">{totTotal > 0 ? (totDelivery/totTotal*100).toFixed(1) : 0}%</div>
        </div>
        <div className="vt-kpi">
          <div className="vt-kpi-label">Ticket prom.</div>
          <div className="vt-kpi-val">
            {fi(cajAggs.reduce((s,c) => s + c.ordenes, 0) > 0
              ? totTotal / cajAggs.reduce((s,c) => s + c.ordenes, 0)
              : 0)}
          </div>
        </div>
      </div>

      {/* Per-cajero cards */}
      <div className="vt-sl">Por cajero</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.875rem', marginBottom: '1.5rem' }}>
        {cajAggs.filter(c => c.total > 0).map(c => (
          <div key={c.nombre} style={{ background: 'var(--vt-paper)', border: '1px solid var(--vt-border)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ background: 'var(--vt-ink)', padding: '0.75rem 1rem', borderBottom: '2px solid var(--vt-gold)' }}>
              <div style={{ fontFamily: "'DM Mono',monospace", fontWeight: 800, color: 'var(--vt-gold)', fontSize: '0.95rem' }}>
                {c.nombre}
              </div>
              <div style={{ fontSize: '0.62rem', color: '#555', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: '0.15rem' }}>
                {c.days} días · {c.ordenes} órdenes
              </div>
            </div>
            <div style={{ padding: '0.875rem 1rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', marginBottom: '0.75rem' }}>
                {[
                  { label: 'Total', val: fi(c.total), color: 'var(--vt-gold-dark,#a07830)' },
                  { label: 'Salón', val: fi(c.salon), color: 'var(--vt-ink)' },
                  { label: 'Delivery', val: fi(c.delivery), color: 'var(--vt-delivery,#2a6080)' },
                ].map(kpi => (
                  <div key={kpi.label} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#888', marginBottom: '0.2rem' }}>{kpi.label}</div>
                    <div style={{ fontFamily: "'DM Mono',monospace", fontSize: '0.82rem', fontWeight: 700, color: kpi.color }}>{kpi.val}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', padding: '0.4rem 0', borderTop: '1px solid var(--vt-border)' }}>
                <span style={{ color: '#888' }}>Ticket promedio</span>
                <strong>{fi(c.ticketProm)}</strong>
              </div>
              {/* Delivery % bar */}
              {c.total > 0 && (
                <div style={{ marginTop: '0.5rem' }}>
                  <div style={{ fontSize: '0.6rem', color: '#888', marginBottom: '0.2rem' }}>
                    Delivery {(c.delivery/c.total*100).toFixed(1)}% · Salón {(c.salon/c.total*100).toFixed(1)}%
                  </div>
                  <div className="vt-progress-track">
                    <div className="vt-progress-fill" style={{ width: `${c.delivery/c.total*100}%`, background: 'var(--vt-delivery,#2a6080)' }} />
                  </div>
                </div>
              )}
              {/* Top 3 products */}
              {Object.entries(c.prods).sort((a,b) => b[1].m - a[1].m).slice(0,3).map(([name, v]) => (
                <div key={name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', padding: '0.2rem 0', color: '#555' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '65%' }}>{name}</span>
                  <span style={{ fontWeight: 600, flexShrink: 0 }}>{fi(v.m)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Day-of-week averages */}
      <div className="vt-sl">Promedio por día de semana</div>
      <div className="vt-dow-grid">
        {[1,2,3,4,5,6,0].map(d => {
          const v   = dowData[d]
          const avg = v ? Math.round(v.sum / v.cnt) : 0
          const all = [1,2,3,4,5,6,0].map(dd => dowData[dd] ? dowData[dd].sum/dowData[dd].cnt : 0)
          const max = Math.max(...all), min = Math.min(...all.filter(x => x > 0))
          return (
            <div key={d} className={`vt-dow-card ${avg === max && avg > 0 ? 'best' : avg === min && min !== max && avg > 0 ? 'worst' : ''}`}>
              <div className="vt-dow-label">{dowLabel(d)}</div>
              <div className="vt-dow-val">{avg > 0 ? fi(avg) : '—'}</div>
              {v && <div className="vt-dow-sub">{v.cnt} días</div>}
            </div>
          )
        })}
      </div>

      {/* Detail table */}
      <div className="vt-sl">Detalle diario</div>
      <div className="vt-tbl-wrap">
        <table className="vt-tbl">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Día</th>
              {cajeroNames.map(n => (
                <th key={n} className="r">{n.replace(/cajero turno /i,'')}</th>
              ))}
              <th className="r">Total</th>
            </tr>
          </thead>
          <tbody>
            {range.filter(d => dias[d]).map(date => {
              // El guard `esEntradaCajero` es el mismo con el que se armó `cajeroNames`: la
              // fila nunca puede sumar una clave que ese día no sea un bucket de caja.
              const cajDelDia = (n: string) => {
                const e = dias[date]?.saloneros[n]
                return esEntradaCajero(e) ? e : undefined
              }
              const rowTotal = cajeroNames.reduce((s, n) => s + (cajDelDia(n)?.total ?? 0), 0)
              if (rowTotal === 0) return null
              return (
                <tr key={date}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(date)}</td>
                  <td className="vt-muted">{dowLabel(dayOfWeek(date))}</td>
                  {cajeroNames.map(n => {
                    const e = cajDelDia(n)
                    return (
                      <td key={n} className="r">
                        {e?.total ? fi(e.total) : '—'}
                      </td>
                    )
                  })}
                  <td className="r vt-bold">{fi(rowTotal)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      </>
      )}
    </div>
  )
}
