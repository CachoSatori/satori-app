import type { CashMovement, CashSession } from '../../shared/types/database'
import type { MovementType } from '../../shared/types/database'
import { MOVEMENT_LABELS, EGRESO_TYPES, isEgreso, fi } from './cashUtils'

interface Props {
  movements: CashMovement[]
  sessions:  CashSession[]
}

export default function CashResumen({ movements, sessions }: Props) {
  const closed = sessions.filter(s => s.status === 'closed')

  // By category
  const byType: Record<string, { crc: number; usd: number }> = {}
  movements.forEach(m => {
    if (m.status === 'rechazado') return
    const label = MOVEMENT_LABELS[m.movement_type as MovementType] ?? m.movement_type
    if (!byType[label]) byType[label] = { crc: 0, usd: 0 }
    byType[label].crc += m.amount_crc
    byType[label].usd += m.amount_usd
  })

  const totalIngresos = movements
    .filter(m => m.movement_type === 'ingreso' && m.status !== 'rechazado')
    .reduce((s, m) => s + m.amount_crc, 0)
  const totalEgresos = movements
    .filter(m => isEgreso(m.movement_type as MovementType) && m.status !== 'rechazado')
    .reduce((s, m) => s + m.amount_crc, 0)
  const resultado = totalIngresos - totalEgresos

  const totalPendiente = movements.filter(m => m.status === 'pendiente').reduce((s, m) => s + m.amount_crc, 0)

  const ingresoTypes: MovementType[] = ['ingreso']
  const egresoTypes: MovementType[]  = EGRESO_TYPES

  return (
    <div className="cd-resumen">
      {/* Summary bar */}
      <div className="cd-saldos-bar" style={{ marginBottom: '1.5rem' }}>
        <div className="cd-saldo-card" style={{ borderLeftColor: '#27874f' }}>
          <div className="cd-saldo-label">Total Ingresos</div>
          <div className="cd-saldo-val" style={{ color: '#27874f' }}>{fi(totalIngresos)}</div>
        </div>
        <div className="cd-saldo-card" style={{ borderLeftColor: '#c0392b' }}>
          <div className="cd-saldo-label">Total Egresos</div>
          <div className="cd-saldo-val" style={{ color: '#c0392b' }}>{fi(totalEgresos)}</div>
        </div>
        <div className="cd-saldo-card" style={{ borderLeftColor: resultado >= 0 ? '#27874f' : '#c0392b' }}>
          <div className="cd-saldo-label">Resultado</div>
          <div className="cd-saldo-val" style={{ color: resultado >= 0 ? '#27874f' : '#c0392b' }}>
            {resultado >= 0 ? '+' : ''}{fi(resultado)}
          </div>
        </div>
        <div className="cd-saldo-card" style={{ borderLeftColor: totalPendiente > 0 ? '#c8a030' : '#444' }}>
          <div className="cd-saldo-label">Pendientes</div>
          <div className="cd-saldo-val" style={{ color: totalPendiente > 0 ? '#c8a030' : '#555', fontSize: totalPendiente > 0 ? '17px' : '13px' }}>
            {totalPendiente > 0 ? fi(totalPendiente) : 'Sin pendientes'}
          </div>
        </div>
      </div>

      {/* Ingresos section */}
      <div className="cd-resumen-section">
        <div className="cd-resumen-section-hdr">INGRESOS</div>
        {ingresoTypes.map(t => {
          const label = MOVEMENT_LABELS[t]
          const d = byType[label]
          if (!d || d.crc === 0) return null
          return (
            <div key={t} className="cd-resumen-row">
              <span>{label}</span>
              <span className="cd-resumen-val pos">{fi(d.crc)}</span>
            </div>
          )
        })}
        <div className="cd-resumen-row total">
          <span>TOTAL INGRESOS</span>
          <span className="cd-resumen-val">{fi(totalIngresos)}</span>
        </div>
      </div>

      {/* Egresos section */}
      <div className="cd-resumen-section" style={{ marginTop: '1rem' }}>
        <div className="cd-resumen-section-hdr">EGRESOS</div>
        {egresoTypes.map(t => {
          const label = MOVEMENT_LABELS[t]
          const d = byType[label]
          if (!d || d.crc === 0) return null
          return (
            <div key={t} className="cd-resumen-row">
              <span>{label}</span>
              <span className="cd-resumen-val neg">{fi(d.crc)}</span>
            </div>
          )
        })}
        <div className="cd-resumen-row total">
          <span>TOTAL EGRESOS</span>
          <span className="cd-resumen-val neg">{fi(totalEgresos)}</span>
        </div>
      </div>

      {/* Resultado */}
      <div className={`cd-resumen-resultado ${resultado >= 0 ? 'pos' : 'neg'}`}>
        <span>RESULTADO NETO</span>
        <span>{resultado >= 0 ? '+' : ''}{fi(resultado)}</span>
      </div>

      {/* Turnos table */}
      {closed.length > 0 && (
        <div style={{ marginTop: '2rem' }}>
          <div className="cd-resumen-section-hdr" style={{ marginBottom: '0.5rem' }}>TURNOS CERRADOS ({closed.length})</div>
          {closed.map(s => {
            const movs = movements.filter(m => m.session_id === s.id && m.status !== 'rechazado')
            const ing  = movs.filter(m => m.movement_type === 'ingreso').reduce((a, m) => a + m.amount_crc, 0)
            const egr  = movs.filter(m => isEgreso(m.movement_type as MovementType)).reduce((a, m) => a + m.amount_crc, 0)
            return (
              <div key={s.id} className="cd-resumen-row">
                <div>
                  <span style={{ fontWeight: 600 }}>{s.session_date}</span>
                  <span style={{ color: '#888', marginLeft: '0.5rem', fontSize: '0.8rem' }}>
                    {s.shift_type} · {s.cajero_name}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                  <span style={{ color: '#27874f', fontSize: '0.85rem' }}>+{fi(ing)}</span>
                  <span style={{ color: '#c0392b', fontSize: '0.85rem' }}>-{fi(egr)}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
