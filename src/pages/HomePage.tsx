import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../shared/hooks/useAuth'
import type { UserRole } from '../shared/types/database'
import { supabase } from '../shared/api/supabase'
import { todayCR, fi } from '../shared/utils'

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
    id: 'semana', path: '/semana', label: 'Semana', kanji: '週',
    description: 'Digest semanal', ready: true,
    roles: ['owner', 'manager', 'contador'],
  },
  {
    id: 'reporte-mensual', path: '/reporte-mensual', label: 'Reporte Mensual', kanji: '月',
    description: 'Ventas · Propinas · Caja', ready: true,
    roles: ['owner', 'manager', 'contador'],
  },
  {
    id: 'mi-rendimiento', path: '/mi-rendimiento', label: 'Mi Rendimiento', kanji: '人',
    description: 'Mis stats del turno', ready: true,
    roles: ['salonero', 'barman', 'barback', 'runner', 'cocina'],
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
    id: 'inventario', path: '/inventario', label: 'Inventario', kanji: '庫',
    description: 'Stock · Recetas · Costos', ready: true,
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
  tipOpen:          boolean
  tipShift:         string
  tipOpenHours:     number
  cashOpen:         boolean
  cashCajero:       string
  cashOpenHours:    number
  pendingCount:     number
  overdueSuppliers: number
  metaPct:          number | null
  sopsCount:        number
  ventasHoy:        boolean
  // Actual numbers for today
  ventaNeta:        number
  ventaPax:         number
  ventaPromPax:     number
  tipPool:          number
  tipWorkers:       number
  tipStatus:        string  // 'open'|'closed'|''
  cajaIngresos:     number
  cajaEgresos:      number
  cajaSaldo:        number
  cajaStatus:       string  // 'open'|'closed'|''
  invTotal:         number
  invLowStock:      number
  invOutStock:      number
}

async function fetchHomeStatus(): Promise<HomeStatus> {
  const today = todayCR()
  const curMonth = today.slice(0, 7)

  const [tipRes, cashRes, pendRes, metaRes, sopsRes, ventasRes, suppliersRes,
         tipDetailRes, cashSessionsRes, cashMovsRes, ingredientsRes] = await Promise.allSettled([
    // Open tip session
    supabase.from('tip_sessions' as never).select('shift_type,created_at').eq('status', 'open').limit(1).maybeSingle(),
    // Open cash session
    supabase.from('cash_sessions' as never).select('cajero_name,created_at').eq('status', 'open').limit(1).maybeSingle(),
    // Pending cash movements
    supabase.from('cash_movements' as never).select('id', { count: 'exact', head: true }).eq('status', 'pendiente'),
    // Meta mensual
    supabase.from('ventas_metas' as never).select('value').eq('key', 'all').maybeSingle(),
    // SOPs count
    supabase.from('sops' as never).select('id', { count: 'exact', head: true }).eq('is_active', true),
    // Today's ventas with salonero data
    supabase.from('ventas_dias' as never).select('data').eq('session_date', today).maybeSingle(),
    // Suppliers
    supabase.from('suppliers' as never).select('id,ciclo_pago').eq('is_active', true),
    // Today's tip session (open OR closed) for pool total
    supabase.from('tip_sessions' as never)
      .select('id,status,pool_efectivo_crc,pool_efectivo_usd,pool_barra_crc,exchange_rate')
      .eq('session_date', today)
      .order('status', { ascending: true })  // 'closed' < 'open' alphabetically
      .limit(1).maybeSingle(),
    // Today's cash sessions
    supabase.from('cash_sessions' as never)
      .select('id,status,cajero_name').eq('session_date', today)
      .order('created_at', { ascending: false }),
    // Today's cash movements (need session IDs — will filter below)
    supabase.from('cash_movements' as never)
      .select('session_id,movement_type,amount_crc')
      .gte('created_at', today + 'T00:00:00')
      .neq('status', 'rechazado'),
    // Ingredients (stock levels for low-stock alert)
    supabase.from('ingredients' as never).select('current_stock,min_stock'),
  ])

  const tipSession  = tipRes.status  === 'fulfilled' ? (tipRes.value.data  as { shift_type: string; created_at: string } | null)   : null
  const cashSession = cashRes.status === 'fulfilled' ? (cashRes.value.data as { cajero_name: string; created_at: string } | null) : null
  const pendCount   = pendRes.status === 'fulfilled' ? (pendRes.value.count ?? 0) : 0

  // Hours since session opened (for stale session alerts)
  const hoursOpen = (iso: string | undefined) => iso
    ? Math.round((Date.now() - new Date(iso).getTime()) / 3600000) : 0
  const tipOpenHours  = hoursOpen(tipSession?.created_at)
  const cashOpenHours = hoursOpen(cashSession?.created_at)

  // Count suppliers with overdue payments (simplified: has ciclo_pago set)
  const suppliersData = suppliersRes.status === 'fulfilled'
    ? (suppliersRes.value.data as Array<{id: string; ciclo_pago: string}> | null) ?? []
    : []
  // For now count suppliers with Diario/Semanal cycle as potentially overdue if it's evening
  const overdueSuppliers = suppliersData.filter(s => ['Diario','Semanal'].includes(s.ciclo_pago ?? '')).length > 3
    ? 1 : 0  // simplified — full logic is in CashProveedores
  const metaData    = metaRes.status === 'fulfilled' ? (metaRes.value.data as { value: { restaurante: Record<string,number>; margen?: Record<string,number> } } | null) : null
  const sopsCount   = sopsRes.status === 'fulfilled' ? (sopsRes.value.count ?? 0) : 0

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

  // ── Ventas numbers ──────────────────────────────────────────
  let ventaNeta = 0, ventaPax = 0
  const ventasData = ventasRes.status === 'fulfilled' ? ventasRes.value.data : null
  if (ventasData) {
    const sals = Object.values((ventasData as { data: { saloneros: Record<string,{ total?:number; pax?:number; esCajero?:boolean }> } }).data?.saloneros ?? {})
    ventaNeta = sals.reduce((s, sl) => s + (sl.total ?? 0), 0)
    ventaPax  = sals.filter(sl => !(sl as { esCajero?: boolean }).esCajero).reduce((s, sl) => s + (sl.pax ?? 0), 0)
  }
  const ventaPromPax = ventaPax > 0 ? ventaNeta / ventaPax : 0

  // ── Tip numbers ─────────────────────────────────────────────
  const tipDetail = tipDetailRes.status === 'fulfilled'
    ? (tipDetailRes.value.data as { id:string; status:string; pool_efectivo_crc:number; pool_efectivo_usd:number; pool_barra_crc:number; exchange_rate:number } | null)
    : null
  let tipPool = 0, tipWorkers = 0
  const tipStatus = tipDetail?.status ?? ''
  if (tipDetail) {
    const rate = tipDetail.exchange_rate ?? 640
    tipPool = (tipDetail.pool_efectivo_crc ?? 0) + (tipDetail.pool_efectivo_usd ?? 0) * rate + (tipDetail.pool_barra_crc ?? 0)
    // Load tip entries to count workers
    if (tipDetail.status === 'closed') {
      const { data: entries } = await supabase.from('tip_entries' as never).select('payout_crc').eq('session_id', tipDetail.id)
      tipWorkers = ((entries ?? []) as { payout_crc: number | null }[]).filter(e => (e.payout_crc ?? 0) > 0).length
    }
  }

  // ── Caja numbers ─────────────────────────────────────────────
  const todaySessions = cashSessionsRes.status === 'fulfilled'
    ? (cashSessionsRes.value.data as Array<{ id:string; status:string; cajero_name:string }> ?? [])
    : []
  const todaySessionIds = new Set(todaySessions.map(s => s.id))
  const cajaStatus = todaySessions.find(s => s.status === 'open') ? 'open'
    : todaySessions.length > 0 ? 'closed' : ''
  const todayMovs = cashMovsRes.status === 'fulfilled'
    ? (cashMovsRes.value.data as Array<{ session_id:string; movement_type:string; amount_crc:number }> ?? []).filter(m => todaySessionIds.has(m.session_id))
    : []
  const cajaIngresos = todayMovs.filter(m => m.movement_type === 'ingreso').reduce((s,m) => s + m.amount_crc, 0)
  const cajaEgresos  = todayMovs.filter(m => m.movement_type !== 'ingreso' && m.movement_type !== 'traspaso').reduce((s,m) => s + m.amount_crc, 0)
  const cajaSaldo    = cajaIngresos - cajaEgresos

  // ── Inventario: stock bajo / sin stock ──────────────────────
  const ingData = ingredientsRes.status === 'fulfilled'
    ? (ingredientsRes.value.data as Array<{ current_stock: number; min_stock: number }> ?? [])
    : []
  const invTotal    = ingData.length
  const invOutStock = ingData.filter(i => i.current_stock <= 0).length
  const invLowStock = ingData.filter(i => i.min_stock > 0 && i.current_stock > 0 && i.current_stock <= i.min_stock).length

  return {
    tipOpen:          !!tipSession,
    tipShift:         tipSession?.shift_type ?? '',
    tipOpenHours,
    cashOpen:         !!cashSession,
    cashCajero:       cashSession?.cajero_name ?? '',
    cashOpenHours,
    pendingCount:     pendCount,
    overdueSuppliers,
    metaPct,
    sopsCount,
    ventasHoy:        ventaNeta > 0,
    ventaNeta,
    ventaPax,
    ventaPromPax,
    tipPool,
    tipWorkers,
    tipStatus,
    cajaIngresos,
    cajaEgresos,
    cajaSaldo,
    cajaStatus,
    invTotal,
    invLowStock,
    invOutStock,
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
        if (status.tipPool > 0) {
          if (status.tipStatus === 'closed') {
            return <StatusBadge color="ok" text={`${fi(status.tipPool)} · ${status.tipWorkers} emps`} />
          }
          if (status.tipOpenHours >= 20) return <StatusBadge color="warn" text={`⚠ Abierto ${status.tipOpenHours}h`} />
          return <StatusBadge color="open" text={`● ${status.tipShift} · ${fi(status.tipPool)}`} />
        }
        if (status.tipOpen) {
          if (status.tipOpenHours >= 20) return <StatusBadge color="warn" text={`⚠ Abierto ${status.tipOpenHours}h`} />
          return <StatusBadge color="open" text={`● ${status.tipShift} abierto`} />
        }
        return null
      case 'cash':
        if (status.cajaSaldo !== 0 || status.cajaIngresos > 0) {
          const saldoColor = status.cajaStatus === 'closed' ? 'ok' : status.cashOpenHours >= 20 ? 'warn' : 'open'
          const prefix = status.cajaStatus === 'closed' ? '' : '● '
          return <StatusBadge color={saldoColor} text={`${prefix}Saldo ${status.cajaSaldo >= 0 ? '+' : ''}${fi(status.cajaSaldo)}`} />
        }
        if (status.cashOpen) {
          if (status.cashOpenHours >= 20) return <StatusBadge color="warn" text={`⚠ Abierto ${status.cashOpenHours}h`} />
          return <StatusBadge color="open" text={`● ${status.cashCajero || 'Abierto'}`} />
        }
        if (status.pendingCount > 0) return <StatusBadge color="warn" text={`${status.pendingCount} pendiente${status.pendingCount > 1 ? 's' : ''}`} />
        return null
      case 'dashboard':
        if (status.ventaNeta > 0) {
          const metaTxt = status.metaPct !== null ? ` · Meta ${status.metaPct.toFixed(0)}%` : ''
          const color = status.metaPct !== null ? (status.metaPct >= 100 ? 'ok' : status.metaPct >= 70 ? 'open' : 'warn') : 'ok'
          return <StatusBadge color={color} text={`${fi(status.ventaNeta)}${metaTxt}`} />
        }
        if (status.ventasHoy) return <StatusBadge color="ok" text="Hoy cargado" />
        return <StatusBadge color="dim" text="Sin datos hoy" />
      case 'inventario':
        if (status.invOutStock > 0) return <StatusBadge color="warn" text={`${status.invOutStock} sin stock`} />
        if (status.invLowStock > 0) return <StatusBadge color="warn" text={`${status.invLowStock} stock bajo`} />
        if (status.invTotal > 0)    return <StatusBadge color="ok" text="Stock OK" />
        return <StatusBadge color="dim" text="Sin datos" />
      case 'sops':
        if (status.sopsCount > 0) return <StatusBadge color="dim" text={`${status.sopsCount} procedimientos`} />
        return <StatusBadge color="warn" text="Sin contenido" />
      case 'resumen':
        return <StatusBadge color="dim" text={todayCR()} />
      case 'semana': {
        const dayN = new Date(todayCR() + 'T12:00:00').getDay()
        if (dayN === 1) return <StatusBadge color="open" text="Lunes — revisar" />
        return <StatusBadge color="dim" text="esta semana" />
      }
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
