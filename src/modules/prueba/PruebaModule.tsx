/**
 * PruebaModule — contenedor de pruebas, SOLO owner/admin.
 *
 * Entorno de validación de solo lectura. Hoy renderiza el simulador de cierre de
 * Caja Fuerte. Para cambiar lo que se prueba, reemplazar el componente de abajo.
 */
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../shared/hooks/useAuth'
import { ROLE_LABELS } from '../../shared/constants'
import CierreSimulator from './CierreSimulator'

export default function PruebaModule() {
  const { profile } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="tips-module">
      <div className="cd-module-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span className="tips-kanji" style={{ fontSize: '1.6rem' }}>試</span>
          <div>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: '1.1rem', fontWeight: 700, color: 'var(--t-ink)' }}>Prueba</div>
            <div style={{ fontSize: '0.72rem', letterSpacing: '0.15em', color: '#888', textTransform: 'uppercase' }}>
              Entorno de validación · solo lectura
            </div>
          </div>
          {profile?.role && <span className="role-badge">{ROLE_LABELS[profile.role] ?? profile.role}</span>}
        </div>
        <button className="cash-back-btn" onClick={() => navigate('/')}>← Inicio</button>
      </div>

      <div className="cd-content" style={{ padding: '1rem' }}>
        {/* Para cambiar lo que se prueba, reemplazar este componente. */}
        <CierreSimulator />
      </div>
    </div>
  )
}
