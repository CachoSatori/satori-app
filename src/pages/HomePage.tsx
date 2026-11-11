import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../shared/hooks/useAuth'
import type { UserRole } from '../shared/types/database'
import { supabase } from '../shared/api/supabase'
import { todayCR, fi } from '../shared/utils'
import { monthRangeBounds } from '../shared/utils/dateRange'
import { ROLE_LABELS } from '../shared/constants'
import { modulosPara } from '../shared/layout/modulos'
import { calcularPendientes, fraseEstado, TODAS_LAS_SENALES, type Pendiente, type Senal } from '../shared/layout/pendientes'
import type { AlertaCierres } from '../modules/cash/diasSinCierre'
import { alertaGuardada, leerAlertaInicio } from './alertaInicio'

// La lista de módulos vive en `shared/layout/modulos.ts`: es la misma fuente del menú global (B3).

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
  /**
   * B5: lecturas que fallaron (rechazadas o con `error`). Sus valores quedan en 0, pero NO valen:
   * las señales van como «sin comprobar» y los números como «—» con la píldora.
   */
  fallas:           Lectura[]
}

/** Las lecturas del Inicio que se pueden marcar «sin comprobar» (las de `pendientes.ts`). */
type Lectura = Senal

/** Una lectura falló si se rechazó o si la base devolvió `error` (supabase-js casi nunca rechaza). */
function fallo(r: PromiseSettledResult<{ error?: unknown }>): boolean {
  return r.status === 'rejected' || !!r.value?.error
}

async function fetchHomeStatus(): Promise<HomeStatus> {
  const today = todayCR()
  const curMonth = today.slice(0, 7)

  const [tipRes, cashRes, pendRes, metaRes, sopsRes, ventasRes, suppliersRes,
         tipDetailRes, cashSessionsRes, cashMovsRes, ingredientsRes] = await Promise.allSettled([
    // Open tip session
    supabase.from('tip_sessions').select('shift_type,created_at').eq('status', 'open').limit(1).maybeSingle(),
    // Open cash session
    supabase.from('cash_sessions').select('cajero_name,created_at').eq('status', 'open').limit(1).maybeSingle(),
    // Pending cash movements
    supabase.from('cash_movements').select('id', { count: 'exact', head: true }).eq('status', 'pendiente'),
    // Meta mensual
    supabase.from('ventas_metas').select('value').eq('key', 'all').maybeSingle(),
    // SOPs count
    supabase.from('sops').select('id', { count: 'exact', head: true }).eq('is_active', true),
    // Today's ventas with salonero data
    supabase.from('ventas_dias').select('data').eq('session_date', today).maybeSingle(),
    // Suppliers
    supabase.from('suppliers').select('id,ciclo_pago').eq('is_active', true),
    // Today's tip session (open OR closed) for pool total
    supabase.from('tip_sessions')
      .select('id,status,pool_efectivo_crc,pool_efectivo_usd,pool_barra_crc,pool_barra_electronico_crc,exchange_rate')
      .eq('session_date', today)
      .order('status', { ascending: true })  // 'closed' < 'open' alphabetically
      .limit(1).maybeSingle(),
    // Today's cash sessions
    supabase.from('cash_sessions')
      .select('id,status,cajero_name').eq('session_date', today)
      .order('created_at', { ascending: false }),
    // Today's cash movements (need session IDs — will filter below)
    supabase.from('cash_movements')
      .select('session_id,movement_type,amount_crc')
      .gte('created_at', today + 'T00:00:00')
      .neq('status', 'rechazado'),
    // Ingredients (stock levels for low-stock alert)
    supabase.from('ingredients').select('current_stock,min_stock'),
  ])

  const fallas = new Set<Lectura>()
  if (fallo(tipRes))         fallas.add('propinas')
  if (fallo(cashRes))        fallas.add('caja')
  if (fallo(pendRes))        fallas.add('movimientos')
  if (fallo(sopsRes))        fallas.add('procedimientos')
  if (fallo(ingredientsRes)) fallas.add('inventario')
  if (fallo(metaRes))        fallas.add('meta')
  if (fallo(ventasRes))      fallas.add('venta')
  if (fallo(tipDetailRes))   fallas.add('propinasDia')
  if (fallo(cashSessionsRes) || fallo(cashMovsRes)) fallas.add('cajaDia')

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
      // Get current month ventas total. Límite superior EXCLUSIVO = 1° del mes siguiente
      // (no `${curMonth}-31`, que es fecha inválida y daba 400 en meses de 30 días/feb).
      const { start, endExclusive } = monthRangeBounds(curMonth)
      const { data: dias, error: diasError } = await supabase
        .from('ventas_dias')
        .select('data')
        .gte('session_date', start)
        .lt('session_date', endExclusive)
      if (diasError) fallas.add('meta')
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
    ? (tipDetailRes.value.data as { id:string; status:string; pool_efectivo_crc:number; pool_efectivo_usd:number; pool_barra_crc:number; pool_barra_electronico_crc:number; exchange_rate:number } | null)
    : null
  let tipPool = 0, tipWorkers = 0
  const tipStatus = tipDetail?.status ?? ''
  if (tipDetail) {
    const rate = tipDetail.exchange_rate ?? 640
    tipPool = (tipDetail.pool_efectivo_crc ?? 0) + (tipDetail.pool_efectivo_usd ?? 0) * rate + (tipDetail.pool_barra_crc ?? 0) + (tipDetail.pool_barra_electronico_crc ?? 0)
    // Load tip entries to count workers
    if (tipDetail.status === 'closed') {
      const { data: entries, error: entriesError } = await supabase.from('tip_entries').select('payout_crc').eq('session_id', tipDetail.id)
      if (entriesError) fallas.add('propinasDia')
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
    fallas:           [...fallas],
  }
}

/** Si `fetchHomeStatus` falla entero: ninguna señal vale, todas «sin comprobar». */
const SIN_DATOS = {
  cashOpen: false, cashOpenHours: 0, tipOpen: false, tipOpenHours: 0, pendingCount: 0,
  invOutStock: 0, invLowStock: 0, sopsCount: 0, esLunes: false,
  diasSinCierre: null, turnosViejos: null, sinComprobar: TODAS_LAS_SENALES,
}

// ── Aterrizaje por rol (operación por roles, 06-12) ───────────
// Al ABRIR la app, cada puesto cae directo en SU pantalla: la compu del cajero en
// Caja, la tablet del salonero en el Comandero. Sucede UNA vez por sesión de pestaña
// (clave = profile.id, así un cambio de usuario en la misma pestaña re-aterriza) — el
// botón Home sigue navegando normal después.
const ROLE_LANDING: Partial<Record<UserRole, string>> = {
  cajero:    '/caja',
}

// ── Main component ─────────────────────────────────────────────
export default function HomePage() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [status, setStatus] = useState<HomeStatus | null>(null)
  const [clubAbiertas, setClubAbiertas] = useState(0)   // excepciones del puente abiertas (owner, manager)
  // B5: si `fetchHomeStatus` falla entero, se dice — no «Revisando el día…» para siempre.
  const [statusFallo, setStatusFallo] = useState(false)

  const landing = profile ? ROLE_LANDING[profile.role] : undefined
  const landKey = profile ? `satori-landed-${profile.id}` : ''
  const mustLand = !!profile && !!landing && sessionStorage.getItem(landKey) !== '1'

  useEffect(() => {
    if (!mustLand || !landing) return
    sessionStorage.setItem(landKey, '1')
    navigate(landing, { replace: true })
  }, [mustLand, landing, landKey, navigate])

  useEffect(() => {
    if (mustLand) return   // nos vamos ya — no dispares las consultas del Home
    let vivo = true
    fetchHomeStatus()
      .then(s => { if (vivo) setStatus(s) })
      .catch(() => { if (vivo) setStatusFallo(true) })
    return () => { vivo = false }
  }, [mustLand])

  const gestionaClub = profile?.role === 'owner' || profile?.role === 'manager'
  useEffect(() => {
    if (mustLand || !gestionaClub) return
    import('../shared/api/club').then(m => m.getExcepcionesAbiertas(30)).then(setClubAbiertas).catch(() => {})
  }, [mustLand, gestionaClub])

  const role = profile?.role ?? ''
  const isManager = ['owner', 'manager', 'contador'].includes(role)

  // Días sin cierre (B4): la MISMA alerta que ve Caja, con las mismas lecturas y el mismo filtro de rol
  // (owner y manager). Solo lectura. B5: se lee una vez por sesión (`alertaInicio.ts`, auditoría 197) y
  // si alguna de sus lecturas falla queda «sin comprobar» (antes quedaba en cero y el Inicio podía decir
  // «Todo en orden»).
  const veAlerta = role === 'owner' || role === 'manager'
  const usuario = profile?.id ?? ''
  const [alerta, setAlerta] = useState<AlertaCierres | 'fallo' | null>(
    () => (veAlerta ? alertaGuardada(usuario, todayCR()) : null))
  useEffect(() => {
    if (mustLand || !veAlerta) return
    const hoy = todayCR()
    if (alertaGuardada(usuario, hoy)) return   // ya leída en esta sesión: el estado inicial la trae
    let vivo = true
    leerAlertaInicio(usuario, hoy)
      .then(a => { if (vivo) setAlerta(a) })
      .catch(() => { if (vivo) setAlerta('fallo') })
    return () => { vivo = false }
  }, [mustLand, veAlerta, usuario])
  // Mientras se lee la alerta, los otros pendientes ya se muestran (sin «Todo en orden» todavía).
  const alertaCargando = veAlerta && !alerta

  const pendientes = useMemo<Pendiente[] | null>(() => {
    if (!isManager) return null
    const visibles = new Set(modulosPara(role).map(m => m.id))
    // Falló todo `fetchHomeStatus`: no hay señales; solo el aviso «sin comprobar».
    const esLunes = new Date(todayCR() + 'T12:00:00').getDay() === 1
    if (statusFallo) return calcularPendientes({ ...SIN_DATOS, esLunes }, visibles)
    if (!status) return null
    const alertaOk = alerta && alerta !== 'fallo' ? alerta : null
    const sinComprobar = [...status.fallas]
    if (alerta === 'fallo') sinComprobar.push('cierres')
    return calcularPendientes({
      cashOpen:      status.cashOpen,
      cashOpenHours: status.cashOpenHours,
      tipOpen:       status.tipOpen,
      tipOpenHours:  status.tipOpenHours,
      pendingCount:  status.pendingCount,
      invOutStock:   status.invOutStock,
      invLowStock:   status.invLowStock,
      sopsCount:     status.sopsCount,
      esLunes,
      diasSinCierre: alertaOk ? alertaOk.dias.length : null,
      turnosViejos:  alertaOk ? alertaOk.turnos.length : null,
      sinComprobar,
    }, visibles)
  }, [status, statusFallo, alerta, isManager, role])

  if (!profile) return null
  if (mustLand) return null   // redirigiendo al aterrizaje del rol

  const available = modulosPara(profile.role)

  return (
    <div className="home-container">
      <header className="app-header">
        <div className="header-brand">
          <img src={`${import.meta.env.BASE_URL}marca/daruma.png`} alt="" className="header-daruma" width={22} height={24} />
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
        <div className="inicio">
          {isManager && (
            <ResumenDelDia
              status={status}
              statusFallo={statusFallo}
              alertaCargando={alertaCargando}
              pendientes={pendientes}
              onIr={path => navigate(path)}
            />
          )}

          <section className="inicio-seccion" aria-labelledby="inicio-modulos">
            <h2 id="inicio-modulos" className="inicio-subtitulo">{isManager ? 'Módulos' : 'Tus módulos'}</h2>
            <div className="modules-grid">
              {available.map(mod => (
                <button
                  key={mod.id}
                  type="button"
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
          </section>
        </div>
      </main>

      <footer className="app-footer">
        <span>Satori App v2.0 · Propinas · Caja · Ventas</span>
      </footer>
    </div>
  )
}

// ── Frase, 3 números del día y «Para hacer hoy» (owner, manager y contador) ──
function ResumenDelDia({ status, statusFallo, alertaCargando, pendientes, onIr }: {
  status:         HomeStatus | null
  statusFallo:    boolean
  /** La alerta de días sin cierre todavía no llegó: no se puede decir «Todo en orden». */
  alertaCargando: boolean
  pendientes:     Pendiente[] | null
  onIr:        (path: string) => void
}) {
  const cargando = !pendientes
  const falta = (l: Lectura) => statusFallo || !!status?.fallas.includes(l)
  // Valor de una cifra: «…» cargando, «—» si no hay dato o si no se pudo comprobar.
  const cifra = (l: Lectura, valor: (s: HomeStatus) => string) =>
    falta(l) ? '—' : status ? valor(status) : '…'
  const sub = (l: Lectura, texto: string) =>
    falta(l) ? <span className="pildora pildora-pendiente">sin comprobar</span> : texto
  const frase = statusFallo ? 'No se pudo cargar el día.'
    : cargando || (alertaCargando && pendientes.length === 0) ? 'Revisando el día…' : fraseEstado(pendientes)
  const tipSub = !status ? '' : status.tipStatus === 'closed'
    ? `Cerrado · ${status.tipWorkers} ${status.tipWorkers === 1 ? 'persona' : 'personas'}`
    : status.tipOpen ? `Abierto · ${status.tipShift}` : 'Sin turno hoy'
  const cajaSub = !status ? '' : status.cajaStatus === 'open' ? 'Turno abierto'
    : status.cajaStatus === 'closed' ? 'Turno cerrado' : 'Sin turno hoy'
  const ventaSub = !status ? '' : [
    status.ventaPax > 0 ? `${status.ventaPax} PAX` : (status.ventasHoy ? '' : 'Sin datos hoy'),
    status.metaPct !== null ? `meta del mes ${status.metaPct.toFixed(0)} %`
      : status.fallas.includes('meta') ? 'meta sin comprobar' : '',
  ].filter(Boolean).join(' · ')

  return (
    <>
      <p className="inicio-frase" aria-live="polite">
        {frase}
      </p>

      <dl className="inicio-cifras">
        <div className="inicio-cifra">
          <dt>Venta de hoy</dt>
          <dd className="inicio-cifra-valor">{cifra('venta', s => s.ventaNeta > 0 ? fi(s.ventaNeta) : '—')}</dd>
          <dd className="inicio-cifra-sub">{sub('venta', ventaSub)}</dd>
        </div>
        <div className="inicio-cifra">
          <dt>Propinas del día</dt>
          <dd className="inicio-cifra-valor">{cifra('propinasDia', s => s.tipPool > 0 ? fi(s.tipPool) : '—')}</dd>
          <dd className="inicio-cifra-sub">{sub('propinasDia', tipSub)}</dd>
        </div>
        <div className="inicio-cifra">
          <dt>Caja de hoy</dt>
          <dd className="inicio-cifra-valor">
            {cifra('cajaDia', s => s.cajaIngresos > 0 || s.cajaSaldo !== 0
              ? `${s.cajaSaldo > 0 ? '+' : ''}${fi(s.cajaSaldo)}` : '—')}
          </dd>
          <dd className="inicio-cifra-sub">{sub('cajaDia', cajaSub)}</dd>
        </div>
      </dl>

      <section className="inicio-seccion" aria-labelledby="inicio-hoy">
        <h2 id="inicio-hoy" className="inicio-subtitulo">Para hacer hoy</h2>
        {cargando || (alertaCargando && pendientes.length === 0) ? (
          <p className="inicio-vacio">Cargando…</p>
        ) : pendientes.length === 0 && !statusFallo ? (
          <div className="inicio-en-orden">
            <img src={`${import.meta.env.BASE_URL}marca/daruma.png`} alt="" width={44} height={48} />
            <div>
              <p className="inicio-en-orden-titulo">Todo en orden</p>
              <p className="inicio-vacio">No hay nada pendiente en tus módulos.</p>
            </div>
          </div>
        ) : (
          <ul className="inicio-pendientes">
            {pendientes.map(p => (
              <li key={p.id}>
                <button type="button" className="inicio-pendiente" onClick={() => onIr(p.path)}>
                  <span className="inicio-pendiente-texto">{p.texto}</span>
                  <span className={`pildora pildora-${p.tono}`}>{p.estado}</span>
                  <span className="inicio-pendiente-ir" aria-hidden="true">›</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {!cargando && alertaCargando && pendientes.length > 0 && (
          <p className="inicio-vacio">Revisando los días sin cierre…</p>
        )}
      </section>
    </>
  )
}
