import { useNavigate } from 'react-router-dom'
import { useAuth } from '../shared/hooks/useAuth'

const ROLE_LABELS: Record<string, string> = {
  owner: 'Propietario', manager: 'Encargado', cajero: 'Cajero',
  salonero: 'Salonero', barman: 'Barman', barback: 'Barback',
  runner: 'Runner', cocina: 'Cocina',
}

const MODULES = [
  { id: 'tips', path: '/propinas', label: 'Propinas', kanji: '心', description: 'Pool del turno', ready: true,
    roles: ['owner','manager','cajero','salonero','barman','barback','runner','cocina'] },
  { id: 'cash', path: '/caja', label: 'Caja', kanji: '金', description: 'Turnos y movimientos', ready: false,
    roles: ['owner','manager','cajero'] },
  { id: 'dashboard', path: '/ventas', label: 'Ventas', kanji: '売', description: 'KPIs y metas', ready: false,
    roles: ['owner','manager'] },
]

export default function HomePage() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  if (!profile) return null

  const availableModules = MODULES.filter(m => m.roles.includes(profile.role))

  return (
    <div className="home-container">
      <header className="app-header">
        <div className="header-brand">
          <span className="header-mark">祭</span>
          <span className="header-title">Satori · Santa Teresa, Costa Rica</span>
        </div>
        <div className="header-user">
          <span className="user-name">{profile.full_name}</span>
          <span className="user-role">{ROLE_LABELS[profile.role] ?? profile.role}</span>
          <button className="btn-signout" onClick={signOut} title="Cerrar sesión">✕</button>
        </div>
      </header>
      <main className="home-main">
        <div className="modules-grid">
          {availableModules.map(mod => (
            <button
              key={mod.id}
              className={`module-card ${mod.ready ? 'ready' : ''}`}
              disabled={!mod.ready}
              onClick={() => mod.ready && navigate(mod.path)}
            >
              <span className="module-kanji">{mod.kanji}</span>
              <span className="module-label">{mod.label}</span>
              <span className="module-desc">{mod.description}</span>
              {!mod.ready && <span className="module-badge">Próximamente</span>}
            </button>
          ))}
        </div>
      </main>
      <footer className="app-footer">
        <span>Satori App v1.0</span>
      </footer>
    </div>
  )
}
