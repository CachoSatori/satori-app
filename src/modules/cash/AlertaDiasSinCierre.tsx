// Aviso en Caja (owner/manager): días post-corte sin cierre completo y turnos de días anteriores
// que siguen abiertos. Cada fecha lleva a su día con un clic. Solo lectura.
import { useState } from 'react'
import type { AlertaCierres } from './diasSinCierre'
import { ETIQUETA_MOTIVO } from './diasSinCierre'
import { fi, formatDate } from './cashUtils'

const MAX_VISIBLES = 6

interface Props {
  alerta: AlertaCierres
  onIrADia: (fecha: string) => void
  onIrATurno: () => void
}

export default function AlertaDiasSinCierre({ alerta, onIrADia, onIrATurno }: Props) {
  const { dias, turnos } = alerta
  const [verTodos, setVerTodos] = useState(false)
  if (dias.length === 0 && turnos.length === 0) return null
  // Los más viejos primero (son los que traban el cierre de los siguientes); el resto, a pedido.
  const visibles = verTodos ? dias : dias.slice(0, MAX_VISIBLES)
  return (
    <div role="alert" className="alerta-cierres"
      style={{ margin: '0.75rem 1.5rem 0', padding: '0.7rem 0.9rem', border: '2px solid #c23b22', borderRadius: 3, background: '#fdf0ee', fontSize: '0.78rem' }}>
      {dias.length > 0 && (
        <>
          <div style={{ fontWeight: 700, color: '#c23b22', marginBottom: '0.35rem' }}>
            ⚠ {dias.length === 1 ? 'Hay 1 día sin cierre completo' : `Hay ${dias.length} días sin cierre completo`}
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {visibles.map(d => (
              <li key={d.fecha} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', padding: '0.15rem 0' }}>
                <button type="button" className="tips-btn-ghost" style={{ fontSize: '0.74rem', padding: '0.15rem 0.55rem' }}
                  onClick={() => onIrADia(d.fecha)} aria-label={`Ir al cierre del ${d.fecha}`}>
                  {formatDate(d.fecha)} →
                </button>
                <span style={{ color: '#8a5040' }}>
                  {d.motivos.map(m => ETIQUETA_MOTIVO[m]).join(' · ')}
                  {d.movimientos > 0 ? ` (${d.movimientos} mov · ${fi(d.crc)})` : ''}
                </span>
              </li>
            ))}
          </ul>
          {dias.length > MAX_VISIBLES && (
            <button type="button" className="tips-btn-ghost" style={{ fontSize: '0.72rem', padding: '0.15rem 0.55rem', marginTop: '0.25rem' }}
              onClick={() => setVerTodos(v => !v)}>
              {verTodos ? 'Ver menos' : `Ver los ${dias.length}`}
            </button>
          )}
        </>
      )}
      {turnos.length > 0 && (
        <div style={{ marginTop: dias.length ? '0.5rem' : 0 }}>
          <span style={{ fontWeight: 700, color: '#c23b22' }}>
            ⚠ {turnos.length === 1 ? 'Turno de Caja Diaria abierto de un día anterior' : `${turnos.length} turnos de Caja Diaria abiertos de días anteriores`}:
          </span>{' '}
          {turnos.map(t => `${formatDate(t.fecha)}${t.cajero ? ` (${t.cajero})` : ''}`).join(' · ')}{' '}
          <button type="button" className="tips-btn-ghost" style={{ fontSize: '0.74rem', padding: '0.15rem 0.55rem' }} onClick={onIrATurno}>
            Ir a Caja Diaria →
          </button>
        </div>
      )}
    </div>
  )
}
