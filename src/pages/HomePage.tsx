import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../shared/hooks/useAuth'
import type { UserRole } from '../shared/types/database'
import { supabase } from '../shared/api/supabase'
import { todayCR } from '../shared/utils'

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
  id:          string
  path:        string
  label:       string
  kanji:       string
  description: string
  ready:       boolean
  roles:       UserRole[]
}

const MODULES: Module[] = [
  {
    id: 'resumen', path: '/resumen', label: 'Resumen', kanji: '日',
    description: 'Cuadre del día', ready: true,
    roles: ['owner', 'manager', 'contador'],
  },
  {
    id: 'mis-propinas', path: '/mis-propinas', label: 'Mis Propinas', kanji: '¥',
    description: 'Mi historial', ready: true,
    roles: ['salonero', 'barman', 'barback', 'runner', 'cocina', 'cajero'],
  },
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
    description: 'KPIs y metas', ready: true,
    roles: ['owner', 'manager', 'contador'],
  },
  {
    id: 'sops', path: '/sops', label: 'SOPs', kanji: '書',
    description: 'Procedimientos', ready: true,
    roles: ['owner', 'manager', 'cajero', 'salonero', 'barman', 'barback', 'runner', 'cocina'],
  },
  {
    id: 'admin', path: '/admin', label: 'Admin', kanji: '管',
    description: 'Empleados · Config', ready: true,
    roles: ['owner'],
  },
]

// ── Live status per module ─────────────────────────────────────
interface HomeStatus {
  tipOpen:      boolean
  tipShift:     string
  cashOpen:     boolean
  cashCajero:   string
  pendingCount: number
  metaPct:      number | null
  sopsCount:    number
  ventasHoy:    boolean
}

async function fetchHomeStatus(): Promise<HomeStatus> {
  const today = todayCR()
  const curMonth = today.slice(0, 7)

  const [tipRes, cashRes, pendRes, metaRes, sopsRes, ventasRes] = await Promise.allSettled([
    // Open tip session
    supabase.from('tip_sessions' as never).select('shift_type').eq('status', 'open').limit(1).maybeSingle(),
    // Open cash session
    supabase.from('cash_sessions' as never).select('cajero_name').eq('status', 'open').limit(1).maybeSingle(),
    // Pending cash movements count
    supabase.from('cash_movements' as never).select('id', { count: 'exact', head: true }).eq('status', 'pendiente'),
    // Meta mensual
    supabase.from('ventas_metas' as never).select('value').eq('key', 'all').maybeSingle(),
    // SOPs count
    supabase.from('sops' as never).select('id', { count: 'exact', head: true }).eq('is_active', true),
    // Today's ventas
    supabase.from('ventas_dias' as never).select('session_date').eq('session_date', today).maybeSingle(),
  ])

  const tipSession  = tipRes.status  === 'fulfilled' ? (tipRes.value.data  as { shift_type: string } | null)    : null
  const cashSession = cashRes.status === 'fulfilled' ? (cashRes.value.data as { cajero_name: string } | null)   : null
  const pendCount   = pendRes.status === 'fulfilled' ? (pendRes.value.count ?? 0) : 0
  const metaData    = metaRes.status === 'fulfilled' ? (metaRes.value.data as { value: { restaurante: Record<string,number>; margen?: Record<string,number> } } | null) : null
  const sopsCount   = sopsRes.status === 'fulfilled' ? (sopsRes.value.count ?? 0) : 0
  const ventasHoy   = ventasRes.status === 'fulfilled' && !!ventasRes.value.data

  // Calculate meta progress
  let metaPct: number | null = null
  if (metaData?.value?.restaurante) {
    const meta = metaData.value.restaurante[curMonth]
    if (meta > 0) {
      // Get current month ventas total
      const { data: dias } = await supabase
        .from('ventas_dias' as never)
        .select('data')
        .gte('session_date', curMonth + '-01')
        .lte('session_date', curMonth + '-31')
      if (dias) {
        const ventas = (dias as { data: { saloneros: Record<string, { total?: number; esCajero?: boolean }> } }[])
          .reduce((s, row) => {
            const sals = row.data.saloneros ?? {}
            return s + Object.values(sals).reduce((ss, sal) => ss + (sal.total ?? 0), 0)
          }, 0)
        metaPct = Math.min(100, (ventas / meta) * 100)
      }
    }
  }

  return {
    tipOpen:      !!tipSession,
    tipShift:     tipSession?.shift_type ?? '',
    cashOpen:     !!cashSession,
    cashCajero:   cashSession?.cajero_name ?? '',
    pendingCount: pendCount,
    metaPct,
    sopsCount,
    ventasHoy,
  }
}

// ── Status badge component ─────────────────────────────────────
function StatusBadge({ color, text }: { color: 'open' | 'ok' | 'warn' | 'dim'; text: string }) {
  const styles: Record<string, string> = {
    open: 'var(--t-teal)',
    ok:   '#27874f',
    warn: '#c0392b',
    dim:  '#888',
  }
  return (
    <span style={{
      display:      'inline-flex',
      alignItems:   'center',
      gap:          '0.2rem',
      fontSize:     '0.6rem',
      fontWeight:   700,
      letterSpacing:'0.06em',
      textTransform:'uppercase',
      color:        styles[color],
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: styles[color], display: 'inline-block' }} />
      {text}
    </span>
  )
}

// ── Main component ─────────────────────────────────────────────
export default function HomePage() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [status, setStatus] = useState<HomeStatus | null>(null)

  useEffect(() => {
    fetchHomeStatus().then(setStatus).catch(() => {})
  }, [])

  if (!profile) return null

  const available = MODULES.filter(m => m.roles.includes(profile.role))
  const isManager = ['owner', 'manager', 'contador'].includes(profile.role)

  // Build status for each module
  const getStatus = (id: string) => {
    if (!status || !isManager) return null
    switch (id) {
      case 'tips':
        if (status.tipOpen) return <StatusBadge color="open" text={`● ${status.tipShift} abierto`} />
        return null
      case 'cash':
        if (status.cashOpen) return <StatusBadge color="open" text={`● ${status.cashCajero || 'Abierto'}`} />
        if (status.pendingCount > 0) return <StatusBadge color="warn" text={`${status.pendingCount} pendiente${status.pendingCount > 1 ? 's' : ''}`} />
        return null
      case 'dashboard':
        if (status.metaPct !== null) {
          const color = status.metaPct >= 100 ? 'ok' : status.metaPct >= 70 ? 'open' : 'warn'
          return <StatusBadge color={color} text={`Meta ${status.metaPct.toFixed(0)}%`} />
        }
        if (status.ventasHoy) return <StatusBadge color="ok" text="Hoy cargado" />
        return <StatusBadge color="dim" text="Sin datos hoy" />
      case 'sops':
        if (status.sopsCount > 0) return <StatusBadge color="dim" text={`${status.sopsCount} procedimientos`} />
        return <StatusBadge color="warn" text="Sin contenido" />
      case 'resumen':
        return <StatusBadge color="dim" text={todayCR()} />
      default:
        return null
    }
  }

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
          {available.map(mod => {
            const badge = getStatus(mod.id)
            return (
              <button
                key={mod.id}
                className={`module-card ${mod.ready ? 'ready' : ''}`}
                disabled={!mod.ready}
                onClick={() => mod.ready && navigate(mod.path)}
              >
                <span className="module-kanji">{mod.kanji}</span>
                <span className="module-label">{mod.label}</span>
                <span className="module-desc">{mod.description}</span>
                {badge && <span className="module-status">{badge}</span>}
                {!mod.ready && <span className="module-badge">Próximamente</span>}
              </button>
            )
          })}
        </div>
      </main>

      <footer className="app-footer">
        <span>Satori App v2.0 · Propinas · Caja · Ventas</span>
      </footer>
    </div>
  )
}
