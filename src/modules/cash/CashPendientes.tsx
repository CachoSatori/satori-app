import type { CashMovement, CashSession } from '../../shared/types/database'
import { updateMovementStatus } from '../../shared/api/cash'
import { MOVEMENT_LABELS, fi, fd } from './cashUtils'
import type { MovementType } from '../../shared/types/database'

interface Props {
  movements: CashMovement[]
  sessions:  CashSession[]
  onRefresh: () => void
}

export default function CashPendientes({ movements, sessions, onRefresh }: Props) {
  const sesionMap = new Map(sessions.map(s => [s.id, s]))
  const pendientes = movements
    .filter(m => m.status === 'pendiente')
    .sort((a, b) => b.created_at.localeCompare(a.created_at))

  const totalCRC = pendientes.reduce((s, m) => s + m.amount_crc, 0)
  const totalUSD = pendientes.reduce((s, m) => s + m.amount_usd, 0)

  const confirmar = async (id: string) => {
    await updateMovementStatus(id, 'aprobado')
    onRefresh()
  }
  const rechazar = async (id: string) => {
    await updateMovementStatus(id, 'rechazado')
    onRefresh()
  }

  if (!pendientes.length) {
    return (
      <div className="tips-empty-state">
        <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>✓</div>
        <p className="tips-empty-text">Sin movimientos pendientes</p>
      </div>
    )
  }

  return (
    <div>
      <div className="cd-pend-summary">
        <div>
          <div className="cd-saldo-label">Total pendiente</div>
          <div className="cd-saldo-val" style={{ color: '#c8a030' }}>{fi(totalCRC)}</div>
          {totalUSD > 0 && <div style={{ fontSize: '0.85rem', color: '#7ab4d4' }}>{fd(totalUSD)}</div>}
        </div>
        <div className="cd-saldo-label" style={{ alignSelf: 'center' }}>
          {pendientes.length} movimiento{pendientes.length !== 1 ? 's' : ''} pendiente{pendientes.length !== 1 ? 's' : ''}
        </div>
      </div>

      {pendientes.map(m => {
        const ses = sesionMap.get(m.session_id)
        return (
          <div key={m.id} className="cd-pend-card">
            <div className="cd-pend-head">
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>
                  {m.supplier_name || m.employee_name || m.description}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#888', marginTop: '0.2rem' }}>
                  {MOVEMENT_LABELS[m.movement_type as MovementType] ?? m.movement_type}
                  {ses ? ` · ${ses.session_date} · ${ses.shift_type}` : ''}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 700, color: '#c8a030' }}>{fi(m.amount_crc)}</div>
                {m.amount_usd > 0 && <div style={{ fontSize: '0.8rem', color: '#7ab4d4' }}>{fd(m.amount_usd)}</div>}
              </div>
            </div>
            <div className="cd-pend-detail">
              <div className="cd-pend-fila">
                <span>Método</span><span>{m.method}</span>
              </div>
              <div className="cd-pend-fila">
                <span>Caja origen</span><span>{m.caja_origen}</span>
              </div>
              {m.description && (
                <div className="cd-pend-fila">
                  <span>Descripción</span><span>{m.description}</span>
                </div>
              )}
            </div>
            <div className="cd-pend-actions">
              <button className="tips-btn-ghost" style={{ color: '#c0392b', borderColor: '#f0b0b0', fontSize: '0.8rem' }}
                onClick={() => rechazar(m.id)}>
                Rechazar
              </button>
              <button className="tips-btn-teal" style={{ fontSize: '0.8rem' }}
                onClick={() => confirmar(m.id)}>
                ✓ Confirmar pago
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
