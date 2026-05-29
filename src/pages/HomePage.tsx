import { useNavigate } from 'react-router-dom'
import { useAuth } from '../shared/hooks/useAuth'
import type { UserRole } from '../shared/types/database'

const ROLE_LABELS: Record<UserRole, string> = {
  owner:    'Propietario',
  contador: 'Contador',
  manager:  'Encargado',
  cajero:   'Cajero',
  salonero: 'Salonero',
  barman:   'Barman',
  barback:  'Barback',
  runner:   'Runner',
  cocina:   'Cocina',
}

interface Module {
  id:    string
  path:  string
  label: string
  kanji: string
  description: string
  ready: boolean
  roles: UserRole[]
}

const MODULES: Module[] = [
  {
    id: 'tips', path: '/propinas', label: 'Propinas', kanji: '心',
    description: 'Pool del turno', ready: true,
    roles: ['owner', 'manager', 'cajero', 'salonero', 'barman', 'barback', 'runner', 'cocina'],
  },
  {
    id: 'cash', path: '/caja', label: 'Caja', kanji: '金',
    description: 'Turnos y movimientos', ready: true,
    roles: ['owner', 'manager', 'cajero', 'contador'],
  },
  {
    id: 'dashboard', path: '/ventas', label: 'Ventas', kanji: '売',
    description: 'KPIs y metas', ready: false,
    roles: ['owner', 'manager', 'contador'],
  },
  {
    id: 'sops', path: '/sops', label: 'SOPs', kanji: '書',
    description: 'Procedimientos', ready: false,
    roles: ['owner', 'manager', 'cajero', 'salonero', 'barman', 'barback', 'runner', 'cocina'],
  },
  {
    id: 'admin', path: '/admin', label: 'Admin', kanji: '管',
    description: 'Empleados · Config', ready: true,
    roles: ['owner'],
  },
]

export default function HomePage() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  if (!profile) return null

  const available = MODULES.filter(m => m.roles.includes(profile.role))

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
          {available.map(mod => (
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
        <span>Satori App v1.0 · Módulo 1</span>
      </footer>
    </div>
  )
}
