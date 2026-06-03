/**
 * MetaProgressBar — bloque de proyección de ventas (estilo dashboard app)
 * Muestra: días transcurridos, ₡ actual / meta, % completado, estado + proyección,
 * meta diaria implícita, promedio actual/día y esfuerzo requerido para los días que faltan.
 * Toda la data viene de metaProgress() (ventasUtils).
 */
import { fi } from './ventasUtils'

export interface MetaProgress {
  meta:      number
  ventasMes: number
  passDays:  number
  monthDays: number
  projection: number
  effort:    number
  pct:       number
  onTrack:   boolean
  metaDia:   number
}

const MN = ['','Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
function fmtYM(ym: string) { const [y, m] = ym.split('-'); return `${MN[Number(m)]} ${y}` }

export default function MetaProgressBar({ ym, p }: { ym: string; p: MetaProgress }) {
  const remaining = Math.max(0, p.monthDays - p.passDays)
  const promDia   = p.passDays > 0 ? p.ventasMes / p.passDays : 0
  const projPct   = p.meta > 0 ? p.projection / p.meta * 100 : 0
  const col       = p.onTrack ? 'var(--vt-green)' : 'var(--vt-red)'

  return (
    <div className="vt-meta-bar">
      <div className="vt-meta-bar-top">
        <span>Meta {fmtYM(ym)} · {p.passDays} de {p.monthDays} días</span>
        <span><strong>{fi(p.ventasMes)}</strong> <span style={{ opacity: 0.6 }}>de {fi(p.meta)}</span></span>
      </div>

      <div className="vt-progress-track">
        <div className="vt-progress-fill" style={{ width: `${Math.min(p.pct, 100)}%`, background: col }} />
      </div>

      <div className="vt-meta-bar-bottom">
        <span><strong>{p.pct.toFixed(1)}%</strong> completado</span>
        <span style={{ color: col }}>
          {p.onTrack ? '✓ En camino' : '⚠ Por debajo'} · Proyección: <strong>{fi(p.projection)}</strong> ({projPct.toFixed(0)}%)
        </span>
      </div>

      <div className="vt-meta-bar-bottom" style={{ marginTop: '0.3rem', flexWrap: 'wrap', gap: '0.5rem 1.25rem', color: '#b8ad97' }}>
        <span>Meta diaria implícita: <strong>{fi(p.metaDia)}</strong></span>
        <span>Promedio actual/día: <strong style={{ color: col }}>{fi(promDia)}</strong></span>
        {remaining > 0 && <span>⚡ Esfuerzo req. ({remaining}d): <strong>{fi(p.effort)}</strong>/día</span>}
      </div>
    </div>
  )
}
