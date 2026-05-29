import { useState, useMemo } from 'react'
import type { DiasMap, ProductMap } from '../../shared/types/ventas'
import {
  allDates, availableMonths,
  fi, fmtMonthLabel,
} from './ventasUtils'

interface PM_Item {
  nombre: string
  tipo: string
  clas: string
  subcl: string
  salon: number
  delivery: number
  unidades: number
  monto: number
}

function buildPM(dates: string[], dias: DiasMap, pm: ProductMap): Record<string, PM_Item> {
  const result: Record<string, PM_Item> = {}
  for (const date of dates) {
    const dia = dias[date]
    if (!dia) continue
    for (const [, s] of Object.entries(dia.saloneros)) {
      const prods = (s as { prods?: [string, number, number][] }).prods ?? []
      for (const [name, qty, monto] of prods) {
        if (!result[name]) {
          const info = pm[name]
          result[name] = {
            nombre: name,
            tipo:   info?.tipo ?? 'desconocido',
            clas:   info?.clasificacion ?? '',
            subcl:  info?.subclasificacion ?? '',
            salon:  0, delivery: 0, unidades: 0, monto: 0,
          }
        }
        const mult = pm[name]?.multiplicador ?? 1
        result[name].monto    += monto
        result[name].unidades += qty * mult
      }
    }
  }
  return result
}

interface Props {
  dias: DiasMap
  pm:   ProductMap
}

export default function VentasMix({ dias, pm }: Props) {
  const months = useMemo(() => availableMonths(dias, {}), [dias])
  const [selected, setSelected] = useState(months[0] ?? '')
  const [canal, setCanal] = useState<'todos'|'salon'|'delivery'>('todos')
  const [sortBy, setSortBy] = useState<'monto'|'unidades'>('monto')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const dates = useMemo(() => {
    const all = allDates(dias)
    if (!selected) return all
    return all.filter(d => d.startsWith(selected))
  }, [dias, selected])

  const pmData = useMemo(() => buildPM(dates, dias, pm), [dates, dias, pm])

  const totalMonto = Object.values(pmData).reduce((s, p) => s + p.monto, 0)
  const totBeb     = Object.values(pmData).filter(p => p.tipo === 'bebida').reduce((s, p) => s + p.monto, 0)
  const totCom     = Object.values(pmData).filter(p => p.tipo === 'comida').reduce((s, p) => s + p.monto, 0)
  const totUds     = Object.values(pmData).reduce((s, p) => s + p.unidades, 0)

  // Group by tipo → clas → subcl → prod
  const TIPO_ORDER = ['comida','bebida','nofood','cortesia','personal','desconocido']
  const byTipo: Record<string, Record<string, Record<string, PM_Item[]>>> = {}
  for (const item of Object.values(pmData)) {
    const tipo = item.tipo || 'desconocido'
    const clas = item.clas || '(sin clasificar)'
    const subcl = item.subcl || ''
    if (!byTipo[tipo]) byTipo[tipo] = {}
    if (!byTipo[tipo][clas]) byTipo[tipo][clas] = {}
    if (!byTipo[tipo][clas][subcl]) byTipo[tipo][clas][subcl] = []
    byTipo[tipo][clas][subcl].push(item)
  }

  const toggle = (key: string) => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }))

  return (
    <div className="vt-section">
      {/* Period picker */}
      <div className="vt-range-bar" style={{ flexWrap: 'wrap' }}>
        {months.slice(0, 18).map(m => (
          <button key={m} className={`vt-range-btn ${selected === m ? 'active' : ''}`}
            onClick={() => setSelected(m)}>
            {fmtMonthLabel(m).slice(0, 8)}
          </button>
        ))}
      </div>

      {/* Controls */}
      <div className="vt-mix-controls">
        <div className="vt-tab-group">
          {(['todos','salon','delivery'] as const).map(c => (
            <button key={c} className={`vt-tab-btn ${canal === c ? 'active' : ''}`}
              onClick={() => setCanal(c)}>
              {c.charAt(0).toUpperCase() + c.slice(1)}
            </button>
          ))}
        </div>
        <div className="vt-tab-group">
          {(['monto','unidades'] as const).map(v => (
            <button key={v} className={`vt-tab-btn ${sortBy === v ? 'active' : ''}`}
              onClick={() => setSortBy(v)}>
              Por {v}
            </button>
          ))}
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="vt-kpi-grid">
        <div className="vt-kpi red">
          <div className="vt-kpi-label">Total Mix</div>
          <div className="vt-kpi-val">{fi(totalMonto)}</div>
        </div>
        <div className="vt-kpi blue">
          <div className="vt-kpi-label">Bebidas</div>
          <div className="vt-kpi-val">{fi(totBeb)}</div>
          <div className="vt-kpi-sub">{totalMonto > 0 ? (totBeb/totalMonto*100).toFixed(1) : 0}%</div>
        </div>
        <div className="vt-kpi green">
          <div className="vt-kpi-label">Comidas</div>
          <div className="vt-kpi-val">{fi(totCom)}</div>
          <div className="vt-kpi-sub">{totalMonto > 0 ? (totCom/totalMonto*100).toFixed(1) : 0}%</div>
        </div>
        <div className="vt-kpi">
          <div className="vt-kpi-label">Unidades</div>
          <div className="vt-kpi-val">{totUds.toLocaleString('es-CR')}</div>
        </div>
      </div>

      {/* Hierarchical product table */}
      <div className="vt-mix-table">
        {TIPO_ORDER.filter(tipo => byTipo[tipo]).map(tipo => {
          const tipoKey = `tipo-${tipo}`
          const tipoTotal = Object.values(byTipo[tipo]).reduce((s, clases) =>
            s + Object.values(clases).reduce((s2, prods) =>
              s2 + prods.reduce((s3, p) => s3 + p.monto, 0), 0), 0)
          const tipoUds = Object.values(byTipo[tipo]).reduce((s, clases) =>
            s + Object.values(clases).reduce((s2, prods) =>
              s2 + prods.reduce((s3, p) => s3 + p.unidades, 0), 0), 0)

          return (
            <div key={tipo}>
              {/* Tipo header */}
              <div className="vt-mix-tipo-hdr" onClick={() => toggle(tipoKey)}>
                <span>{collapsed[tipoKey] ? '▶' : '▼'} {tipo.toUpperCase()}</span>
                <span>{fi(tipoTotal)} · {tipoUds.toLocaleString('es-CR')} uds · {totalMonto > 0 ? (tipoTotal/totalMonto*100).toFixed(1) : 0}%</span>
              </div>

              {!collapsed[tipoKey] && Object.entries(byTipo[tipo]).sort().map(([clas, subclMap]) => {
                const clasKey = `clas-${tipo}-${clas}`
                const clasTotal = Object.values(subclMap).reduce((s, prods) =>
                  s + prods.reduce((s2, p) => s2 + p.monto, 0), 0)

                return (
                  <div key={clas}>
                    <div className="vt-mix-clas-hdr" onClick={() => toggle(clasKey)}>
                      <span style={{ paddingLeft: '1rem' }}>{collapsed[clasKey] ? '▶' : '▼'} {clas}</span>
                      <span>{fi(clasTotal)} · {tipoTotal > 0 ? (clasTotal/tipoTotal*100).toFixed(1) : 0}%</span>
                    </div>

                    {!collapsed[clasKey] && Object.entries(subclMap).map(([, prods]) => {
                      const sorted = [...prods].sort((a, b) =>
                        sortBy === 'monto' ? b.monto - a.monto : b.unidades - a.unidades)
                      return sorted.map(p => (
                        <div key={p.nombre} className="vt-mix-prod-row">
                          <span style={{ paddingLeft: '3rem' }}>{p.nombre}</span>
                          <span className={`vt-prod-tipo ${p.tipo}`}>{p.tipo}</span>
                          <span>{p.unidades.toLocaleString('es-CR')} uds</span>
                          <span className="vt-bold">{fi(p.monto)}</span>
                          <span style={{ color: '#888' }}>{totalMonto > 0 ? (p.monto/totalMonto*100).toFixed(2) : 0}%</span>
                        </div>
                      ))
                    })}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
