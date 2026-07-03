import { useState, useCallback, useEffect, useMemo } from 'react'
import { useAuth } from '../../shared/hooks/useAuth'
import { useManagerOverride, type ManagerAuth } from '../../shared/ManagerOverride'
import type { CashSession, CashMovement, Supplier, MovementType } from '../../shared/types/database'
import {
  createCashSession,
  closeCashSession,
  createCashMovement,
  deleteCashMovement,
  getPreviousCierre,
  discardCashSession,
  upsertSupplier,
  updateMiddayCheck,
} from '../../shared/api/cash'
import { fi, fd, todayStr, formatDate, METODOS_PAGO_PROVEEDOR, CATEGORIAS_PROV } from './cashUtils'
import { propinaEgresoFields, propinasPorPagarDe } from './propinaPago'
import { useDeletionNote } from './deletionNote'
import { tipShiftToCaja, shiftLabel, dateCR } from '../../shared/utils'
import { getActiveEmployees, getTipPayoutsSince, type TipPayoutSummary } from '../../shared/api/tips'
import { getCurrentRate } from '../../shared/api/exchangeRate'
import { uploadFacturaPhoto, movementAttachments } from '../../shared/api/facturas'
import { listLinkedDocs } from '../../shared/api/documents'
import FacturaThumbs from '../../shared/FacturaThumbs'
import AgregarAsistente from './AgregarAsistente'
import type { Employee } from '../../shared/types/database'

interface Props {
  openSession:    CashSession | null
  suppliers:      Supplier[]
  sessions:           CashSession[]         // to detect if Mediodía/Noche already exists today
  sessionMovements:   CashMovement[]        // DB movements for current open session
  allMovements:       CashMovement[]        // todos los movimientos (para detección cross-turno)
  onSessionOpen:      (s: CashSession) => void
  onSessionClose:     () => void
  onMovAdded:         (m: CashMovement) => void
  onError:            (msg: string) => void
  onRefresh:          () => void
}

// Unificación Bandeja↔Caja (040-043): el pago a proveedor en Caja Diaria ES mercadería por
// definición. Marcamos su egreso_mercaderia con classification='mercaderia' → el trigger del
// server (unif_on_cash_movement) crea la tarea de Revisión de inventario (inventory_review_task
// PENDIENTE, INV-1). No afecta montos ni la forma de pago. Espejo de InboxModule.MERCADERIA_CLASS.
const MERCADERIA_CLASS = { classification: 'mercaderia', suggested_classification: 'mercaderia', suggested_confidence: 1 } as const

// Evita que una request colgada (token vencido / red) deje "Cerrando…" para siempre.
function withTimeout<T>(p: Promise<T>, ms = 15000): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error('Tardó demasiado — recargá la app (sesión vencida) y reintentá.')), ms)),
  ])
}

type ViewState = 'apertura' | 'turno' | 'cierre'

interface PagoRow {
  id:            string
  supplier_id:   string
  supplier_name: string
  supplier_cat:  string
  amount_crc:    number | ''
  amount_usd:    number | ''
  method:        string   // 'Efectivo' | 'Transferencia' para pagos nuevos; históricos pueden traer SINPE/Bitcoin
  reference:     string
  at:            number          // hora de registro (para ordenar más reciente primero)
  attachments:   string[]        // paths de fotos de factura (bucket 'facturas', mig 026)
  // persistedId: movement ID in DB — set once saved, null if unsaved
  persistedId:   string | null
  pending?:      boolean        // en la cola offline, esperando sincronizar
  readonly?:     boolean        // nivel-día (Bandeja): se muestra pero no se edita/borra acá
}

export default function CashTurno({
  openSession, suppliers, sessions, sessionMovements, allMovements,
  onSessionOpen, onSessionClose, onMovAdded, onError, onRefresh,
}: Props) {
  const { profile } = useAuth()
  const requireManager = useManagerOverride()
  const askNote = useDeletionNote()
  const canManage = profile?.role === 'owner' || profile?.role === 'manager' || profile?.role === 'cajero'
  const canClose  = profile?.role === 'owner' || profile?.role === 'manager' || profile?.role === 'cajero'

  const today = todayStr()
  // Modelo nuevo: la Caja Diaria de proveedores es ÚNICA por día (no hay turno
  // Mediodía/Noche). Se abre UNA vez por fecha. Si ya hay una sesión (abierta o
  // cerrada) de esa fecha, no se abre otra.
  const [apFecha,   setApFecha]   = useState(today)
  const apTurno = 'Día'
  const sesionDelDia = sessions.find(s => s.session_date === apFecha)
  const yaExisteDia  = !!sesionDelDia   // abierta → se continúa (es openSession); cerrada → bloquear

  const [view, setView] = useState<ViewState>(openSession ? 'turno' : 'apertura')
  // F4.3a: el "➕ Agregar" único (asistente manual). Convive con los 3 botones viejos (F4.3c los retira).
  const [agregarOpen, setAgregarOpen] = useState(false)

  // Apertura form
  const [apCajero,  setApCajero]  = useState(profile?.full_name ?? '')
  const [employees, setEmployees] = useState<Employee[]>([])
  useState(() => { getActiveEmployees().then(setEmployees).catch(() => {}) })
  const [apProvCRC,  setApProvCRC]  = useState<number | ''>(0)   // fondo de la Caja Diaria (proveedores)
  const [apUSD,      setApUSD]      = useState<number | ''>(0)
  const [tc,         setTc]         = useState<number>(640)       // tipo de cambio USD→CRC (del módulo Admin)
  // TC por defecto = el configurado en Admin (exchange_rates). Editable.
  useEffect(() => { getCurrentRate().then(r => { if (r > 0) setTc(r) }).catch(() => {}) }, [])
  const [saving,       setSaving]       = useState(false)
  // Facturas enlazadas (documents.linked_movement_id) — espejo del mecanismo de CashMovimientos
  // (listLinkedDocs, una consulta al montar). Solo lectura: alimenta la nota "⚠ sin foto" en los
  // pagos de mercadería persistidos sin factura enlazada NI fotos adjuntas (control del manager).
  const [linkedDocMovs, setLinkedDocMovs] = useState<Set<string>>(new Set())
  const [docsLoaded, setDocsLoaded] = useState(false)
  useEffect(() => {
    listLinkedDocs().then(ds => {
      setLinkedDocMovs(new Set(ds.map(d => d.linked_movement_id).filter((x): x is string => !!x)))
    }).catch(() => {}).finally(() => setDocsLoaded(true))
  }, [])
  const [carryFrom,  setCarryFrom]  = useState<string | null>(null) // fecha del cierre que asignó el fondo
  const [carrySugerido, setCarrySugerido] = useState<number | null>(null) // ₡ asignado a Caja Proveedores por ese cierre

  // Carryover: la Caja Proveedores arranca con lo que dejó el cierre del día
  // anterior (sep_diaria del último cierre completo). Se sugiere, se precarga, y se
  // valida al confirmar si el cajero ingresa un monto distinto.
  useEffect(() => {
    if (openSession) return
    let cancelled = false
    getPreviousCierre(apFecha).then(c => {
      if (cancelled) return
      if (c) {
        const x = c.sep_diaria_crc || 0
        setApProvCRC(x); setApUSD(c.sep_diaria_usd || 0)
        setCarryFrom(c.session_date); setCarrySugerido(x)
      } else { setCarryFrom(null); setCarrySugerido(null) }
    }).catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apFecha, openSession])

  // Turno state: pagos + ingresos adicionales.
  // BUG A FIX: estos arrays guardan SÓLO borradores aún NO persistidos. Las listas
  // que se muestran (displayPagos/displayIngresos) se derivan SIEMPRE de la base
  // (sessionMovements) + estos borradores → al recargar nada se pierde ni se duplica.
  type IngresoRow = { id: string; crc: number | ''; usd: number | ''; nota: string; persistedId: string | null }
  const [pagos,    setPagos]    = useState<PagoRow[]>([])
  const [ingresos, setIngresos] = useState<IngresoRow[]>([])

  // Pagos a proveedor ya persistidos en la base (fuente de verdad).
  // VISIBILIDAD (fix 06-12): desde la corrección de pagos del 06-11 las
  // Transferencias se guardan con caja_origen='Banco' (no tocan la caja física)
  // y el filtro viejo (solo 'Caja Proveedores') las dejaba fuera de esta lista.
  // El manager necesita ver TODOS los pagos del día (efectivo Y transferencia).
  // La matemática NO cambia: provEfDB/pagosEf/restante filtran por method='Efectivo'.
  const dbPagos: PagoRow[] = useMemo(() => sessionMovements
    .filter(m => m.movement_type === 'egreso_mercaderia' && m.status !== 'rechazado'
      && (m.caja_origen === 'Caja Proveedores' || (m.caja_origen === 'Banco' && m.method !== 'Efectivo')))
    .map(m => ({
      id:            m.id,
      supplier_id:   m.supplier_id ?? '',
      supplier_name: m.supplier_name ?? '',
      supplier_cat:  suppliers.find(s => s.id === m.supplier_id)?.category ?? '',
      amount_crc:    m.amount_crc,
      amount_usd:    m.amount_usd,
      method:        m.method || 'Efectivo',
      reference:     m.description ?? '',
      at:            new Date(m.created_at).getTime(),
      attachments:   movementAttachments(m),
      persistedId:   m.id,
      pending:       m._pending === true,
    })), [sessionMovements, suppliers])
  // VISIBILIDAD (fix nivel-día): la Bandeja crea los pagos por transferencia como
  // pendientes a NIVEL-DÍA (session_id=null) → no están en sessionMovements y por eso
  // no aparecían en la Caja Diaria (sí en Proveedores y Pendientes). Acá los derivamos
  // de allMovements, acotados al DÍA DE REGISTRO del turno abierto. Son SOLO-LECTURA: NO
  // entran en ningún cómputo de efectivo (method≠Efectivo) — solo suman al aviso amarillo
  // de transferencias pendientes (pagosTr), igual que las del propio turno.
  // Comparamos por fecha LOCAL CR (dateCR) — no slice UTC — para que un pago registrado de
  // noche (después de 18:00 CR) caiga en la Caja Diaria del día correcto y no en el siguiente.
  const dayPendientesPagos: PagoRow[] = useMemo(() => {
    if (!openSession) return []
    const fechaTurno = openSession.session_date
    return allMovements
      .filter(m => m.movement_type === 'egreso_mercaderia' && m.session_id === null
        && m.status !== 'rechazado' && m.caja_origen === 'Banco' && m.method !== 'Efectivo'
        && dateCR(m.created_at) === fechaTurno)
      .map(m => ({
        id:            m.id,
        supplier_id:   m.supplier_id ?? '',
        supplier_name: m.supplier_name ?? '',
        supplier_cat:  suppliers.find(s => s.id === m.supplier_id)?.category ?? '',
        amount_crc:    m.amount_crc,
        amount_usd:    m.amount_usd,
        method:        m.method || 'Transferencia',
        reference:     m.description ?? '',
        at:            new Date(m.created_at).getTime(),
        attachments:   movementAttachments(m),
        persistedId:   m.id,
        pending:       m._pending === true,
        readonly:      true,
      }))
  }, [openSession, allMovements, suppliers])

  // Lista mostrada = borradores no persistidos + persistidos del turno + pendientes
  // nivel-día (Bandeja), más reciente primero. Ids disjuntos (sesión vs session_id=null)
  // → sin duplicados.
  const displayPagos = useMemo(
    () => [...pagos.filter(p => !p.persistedId), ...dbPagos, ...dayPendientesPagos].sort((a, b) => b.at - a.at),
    [pagos, dbPagos, dayPendientesPagos])

  // Ingresos adicionales ya persistidos en la base
  const dbIngresos: IngresoRow[] = useMemo(() => sessionMovements
    .filter(m => m.movement_type === 'ingreso' && m.status !== 'rechazado')
    .map(m => ({ id: m.id, crc: m.amount_crc || '', usd: m.amount_usd || '', nota: m.description ?? '', persistedId: m.id })),
    [sessionMovements])
  const displayIngresos = useMemo(
    () => [...ingresos.filter(i => !i.persistedId), ...dbIngresos],
    [ingresos, dbIngresos])

  // ── Propinas por pagar (Bug C) ──────────────────────────────
  // Cerrar Propinas ya NO crea el egreso solo. Acá se listan las sesiones de propinas
  // CERRADAS cuyo payout aún no se registró en Caja, desde 30 días atrás de la fecha del
  // turno → una propina impaga de un día anterior NO se pierde, reaparece hasta pagarla.
  const [propinasPagables, setPropinasPagables] = useState<TipPayoutSummary[]>([])
  const [payingProp, setPayingProp] = useState<string | null>(null)   // session_id en curso (anti doble-click)
  useEffect(() => {
    if (!openSession) return   // la sección sólo se muestra con turno abierto
    let cancelled = false
    const since = new Date(openSession.session_date + 'T12:00:00')
    since.setDate(since.getDate() - 30)
    getTipPayoutsSince(since.toISOString().slice(0, 10))
      .then(r => { if (!cancelled) setPropinasPagables(r) })
      .catch(() => { if (!cancelled) setPropinasPagables([]) })
    return () => { cancelled = true }
  }, [openSession])
  // Turnos aún sin registrar — criterio COMPARTIDO con el Cierre del Día (propinaPago:
  // un movimiento con esa description, pagado o pendiente, lo salda). Misma vía, dos puertas.
  const propinasPorPagar = propinasPorPagarDe(propinasPagables, allMovements)
  const pagarPropina = async (p: TipPayoutSummary, status: 'aprobado' | 'pendiente') => {
    if (!openSession || !profile || payingProp) return   // anti doble-registro
    const accion = status === 'aprobado' ? 'PAGAR ahora' : 'dejar PENDIENTE'
    if (!window.confirm(`¿${accion} las propinas de ${shiftLabel(p.shift_type)} por ${fi(p.total_payout_crc)}?`)) return
    setPayingProp(p.session_id)
    try {
      // Forma del egreso COMPARTIDA (propinaEgresoFields) — idéntica a la histórica de esta puerta.
      const mov = await createCashMovement({
        session_id:    openSession.id,
        created_by:    profile.id,
        exchange_rate: null,
        ...propinaEgresoFields(p),
        status,                                 // 'pendiente' = el efectivo sigue en caja hasta pagarse
      })
      onMovAdded(mov)
    } catch (e) { onError(e instanceof Error ? e.message : 'Error registrando propinas') }
    finally { setPayingProp(null) }
  }

  // Cierre form
  const [cierreCRC,   setCierreCRC]   = useState<number | ''>(0)
  const [cierreUSD,   setCierreUSD]   = useState<number | ''>(0)
  const [cierreNotas, setCierreNotas] = useState('')
  const [showResumen, setShowResumen] = useState(false)

  // ── Calculated totals ────────────────────────────────────
  // Caja Diaria = ÚNICA caja física de efectivo (uso: pagos a proveedores).
  // La registradora la maneja el PoS, no se cuenta acá. El fondo inicial viene
  // del carryover del cierre del día anterior (initial_suppliers_crc).
  const initProvCRC = openSession ? openSession.initial_suppliers_crc : 0
  const initUSD     = openSession ? openSession.initial_cash_usd : 0

  // Pagos a proveedor en efectivo. Fuente de verdad: movimientos persistidos
  // (caja_origen 'Caja Proveedores') + los que aún están en memoria sin guardar.
  const provEfDB = sessionMovements
    .filter(m => m.caja_origen === 'Caja Proveedores' && m.method === 'Efectivo' && m.status !== 'rechazado')
    .reduce((s, m) => s + m.amount_crc, 0)
  const provEfMem = pagos
    .filter(p => p.supplier_id && p.method === 'Efectivo' && !p.persistedId)
    .reduce((s, p) => s + (Number(p.amount_crc) || 0), 0)
  const provGastadoEf = provEfDB + provEfMem

  // Pagos visibles en esta vista (lista en memoria) — para totales del panel
  const pagosEf  = displayPagos.filter(p => p.supplier_id && p.method === 'Efectivo')
                        .reduce((s, p) => s + (Number(p.amount_crc) || 0), 0)
  const pagosTrList = displayPagos.filter(p => p.supplier_id && p.method === 'Transferencia')
  const pagosTr  = pagosTrList.reduce((s, p) => s + (Number(p.amount_crc) || 0), 0)
  // SINPE/Bitcoin: pagados al instante desde el Banco (no tocan la caja física)
  const pagosElec = displayPagos.filter(p => p.supplier_id && p.method !== 'Efectivo' && p.method !== 'Transferencia')
                        .reduce((s, p) => s + (Number(p.amount_crc) || 0), 0)
  const ingresosTotal = displayIngresos.reduce((s, i) => s + (Number(i.crc) || 0), 0)
  const totalAsig = initProvCRC + ingresosTotal

  // Otros egresos en efectivo operativos (no proveedores, no ingreso/traspaso)
  // registrados en esta caja. Salen de la misma Caja Diaria.
  const otrosEgresosEf = sessionMovements
    .filter(m => m.movement_type !== 'ingreso' && m.movement_type !== 'traspaso'
              && m.caja_origen !== 'Caja Proveedores'
              && m.method === 'Efectivo' && m.status !== 'pendiente' && m.status !== 'rechazado')
    .reduce((s, m) => s + m.amount_crc, 0)

  // Lo que debería quedar físicamente en la Caja Diaria al cierre.
  const cajaDeberia  = totalAsig - provGastadoEf - otrosEgresosEf
  const cierreVal    = Number(cierreCRC) || 0
  const diferencia   = cierreVal ? cierreVal - cajaDeberia : null
  const cuadra       = diferencia !== null && Math.abs(diferencia) < 500

  // ── Apertura ─────────────────────────────────────────────
  const handleApertura = useCallback(async () => {
    if (!profile) return
    if (!apCajero) { onError('Seleccioná un cajero'); return }
    // Caja única por día: si ya hay una sesión de esa fecha, no abrir otra.
    const dup = sessions.find(s => s.session_date === apFecha)
    if (dup) {
      onError(dup.status === 'open'
        ? `Ya hay una Caja Diaria abierta el ${apFecha}.`
        : `La Caja Diaria del ${apFecha} ya está cerrada. Para rehacerla, usá "Borrar TODO el día" en el Cierre del día.`)
      return
    }

    // Validación: el monto de Caja Proveedores debe coincidir con lo que asignó el
    // cierre anterior. Si difiere, exigir confirmación explícita (no avanzar en silencio).
    if (carrySugerido != null && carryFrom && Math.abs((Number(apProvCRC) || 0) - carrySugerido) > 0) {
      const ok = window.confirm(
        `El cierre del ${carryFrom} asignó ₡${carrySugerido.toLocaleString('es-CR')} a Caja Proveedores ` +
        `y estás ingresando ₡${(Number(apProvCRC) || 0).toLocaleString('es-CR')}. Revisá. ¿Continuar con ese monto?`)
      if (!ok) return
    }

    setSaving(true)
    try {
      const session = await withTimeout(createCashSession({
        session_date:          apFecha,
        shift_type:            apTurno,
        opened_by:             profile.id,
        cajero_name:           apCajero,
        initial_cash_crc:      0,                                 // registradora deshabilitada (la maneja el PoS)
        initial_cash_usd:      Number(apUSD) || 0,
        initial_suppliers_crc: Number(apProvCRC) || 0,
      }))
      onSessionOpen(session)
      setView('turno')
      setPagos([])
      setIngresos([])
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Error abriendo turno')
    } finally {
      setSaving(false)
    }
  }, [profile, apCajero, apTurno, apFecha, apProvCRC, apUSD, carrySugerido, carryFrom, sessions, onSessionOpen, onError])

  // ── Add pago ──────────────────────────────────────────────
  // ── Crash-safe pago persistence ──────────────────────────
  // Pagos are persisted to DB as soon as supplier + amount are set.
  // This means they survive browser crashes / phone dying.
  const persistPago = useCallback(async (pago: PagoRow) => {
    if (!openSession || !profile) return
    if (!pago.supplier_id || !Number(pago.amount_crc)) return
    if (pago.persistedId) return  // already in DB

    try {
      const mov = await createCashMovement({
        session_id:    openSession.id,
        created_by:    profile.id,
        movement_type: 'egreso_mercaderia',
        amount_crc:    Number(pago.amount_crc) || 0,
        amount_usd:    Number(pago.amount_usd) || 0,
        currency:      'CRC',
        exchange_rate: tc,
        description:   pago.reference || pago.supplier_name || 'Proveedor',
        subcategory:   'Proveedor mercadería',
        supplier_id:   pago.supplier_id || null,
        supplier_name: pago.supplier_name,
        method:        pago.method,
        // Efectivo sale de la caja física; lo electrónico (Transferencia/SINPE/
        // Bitcoin) sale del Banco y NO toca la caja (ROADMAP Fase 2D-A).
        caja_origen:   pago.method === 'Efectivo' ? 'Caja Proveedores' : 'Banco',
        shift:         tipShiftToCaja(openSession.shift_type),
        attachments:   pago.attachments,
        // Pago a proveedor = mercadería → el trigger del server crea la tarea de Revisión de inventario.
        ...MERCADERIA_CLASS,
      })
      // Ya está en la base → se mostrará vía dbPagos; quitamos el borrador en memoria.
      setPagos(prev => prev.filter(p => p.id !== pago.id))
      onMovAdded(mov)
    } catch (e) {
      // Queda como borrador (badge "sin guardar") y se reintenta al cierre — pero avisamos.
      onError(`El pago quedó SIN GUARDAR (${e instanceof Error ? e.message : 'sin conexión'}). Queda como borrador y se reintenta al cerrar — no lo borres.`)
    }
  }, [openSession, profile, tc, onMovAdded, onError])

  // ── Modal de pago a proveedor ──────────────────────────────
  const [pagoModal,   setPagoModal]   = useState(false)
  const [editId,      setEditId]      = useState<string | null>(null)
  const [draftSup,    setDraftSup]    = useState('')
  const [draftCRC,    setDraftCRC]    = useState<number | ''>('')
  const [draftUSD,    setDraftUSD]    = useState<number | ''>('')
  const [draftMethod, setDraftMethod] = useState<string>('Efectivo')
  const [draftRef,    setDraftRef]    = useState('')
  const [supSearch,   setSupSearch]   = useState('')   // texto de búsqueda del proveedor
  const [supOpen,     setSupOpen]     = useState(false) // dropdown de proveedores abierto
  const [movSaving,   setMovSaving]   = useState(false) // anti doble-submit (pago/ingreso)
  // Fotos de la factura: las nuevas (File, aún sin subir) + las ya subidas (paths,
  // al editar un pago existente). Se suben al confirmar — Storage requiere red.
  const [draftFotos,     setDraftFotos]     = useState<File[]>([])
  const [draftFotosPrev, setDraftFotosPrev] = useState<string[]>([])
  // Previews locales de las fotos nuevas (objectURL); se revocan al cambiar la lista.
  const fotoPreviews = useMemo(() => draftFotos.map(f => URL.createObjectURL(f)), [draftFotos])
  useEffect(() => () => { fotoPreviews.forEach(u => URL.revokeObjectURL(u)) }, [fotoPreviews])

  // Alta rápida de proveedor desde la caja (cuando llega uno no registrado)
  const [addSupOpen,   setAddSupOpen]   = useState(false)
  const [newSupName,   setNewSupName]   = useState('')
  const [newSupCat,    setNewSupCat]    = useState('Otros')
  const [newSupMethod, setNewSupMethod] = useState('Transferencia')
  const [addSupSaving, setAddSupSaving] = useState(false)
  const crearProveedor = async () => {
    if (!newSupName.trim() || addSupSaving) return
    setAddSupSaving(true)
    try {
      const s = await upsertSupplier({ name: newSupName.trim(), category: newSupCat, metodo_pago: newSupMethod, moneda: 'CRC' })
      setDraftSup(s.id); setSupSearch(s.name); setSupOpen(false)
      setAddSupOpen(false); setNewSupName('')
      onRefresh()  // recargar la lista de proveedores en el padre
    } catch (e) { onError(e instanceof Error ? e.message : 'Error creando proveedor') }
    finally { setAddSupSaving(false) }
  }

  // El ALTA de pagos nuevos ahora es por el asistente "➕ Agregar" (F4.3c). El modal de pago sobrevive
  // SOLO para EDITAR un pago existente (openEditPago) y para el guardado en el cierre (persistPago).
  const openEditPago = (p: PagoRow) => {
    setEditId(p.id); setDraftSup(p.supplier_id); setDraftCRC(p.amount_crc); setDraftUSD(p.amount_usd)
    setDraftMethod(p.method); setDraftRef(p.reference)
    setSupSearch(suppliers.find(s => s.id === p.supplier_id)?.name ?? ''); setSupOpen(false)
    setDraftFotos([]); setDraftFotosPrev(p.attachments)
    setPagoModal(true)
  }

  const removePago = async (id: string) => {
    const pago = displayPagos.find(p => p.id === id)
    if (pago?.persistedId) {
      // Borrado de un pago YA guardado → requiere autorización de gerencia
      const auth = await requireManager()
      if (!auth.ok) return
      // Motivo obligatorio: el borrado arrastra el inventario ligado y queda en la auditoría (mig 039).
      const note = await askNote('pago a proveedor')
      if (!note) return
      // Refrescar desde la fuente de verdad (re-fetch en el padre). Antes se pasaba un
      // PagoRow a onMovAdded, que lo agregaba en memoria → fila fantasma tras el borrado.
      try { await deleteCashMovement(pago.persistedId, note, auth.managerEmail, auth.managerPassword); onRefresh() }
      catch (e) { onError(`No se pudo eliminar el pago: ${e instanceof Error ? e.message : 'reintentá'}`) }
    } else {
      setPagos(prev => prev.filter(p => p.id !== id))
    }
  }

  const confirmPago = async () => {
    if (!draftSup || !Number(draftCRC) || movSaving) return  // proveedor + monto requeridos · anti doble-submit
    // Editar un pago YA guardado = reemplazo (borra el movimiento viejo + re-crea) → requiere la
    // MISMA autorización de gerencia que el borrado. Antes este camino llamaba la cascada SIN
    // credenciales y la RPC (mig 044) rechazaba al cajero con "No autorizado" sin pedirle nada.
    const old = editId ? displayPagos.find(p => p.id === editId) : null
    let auth: ManagerAuth = { ok: true }
    if (old?.persistedId) {
      auth = await requireManager()
      if (!auth.ok) return   // canceló o contraseña inválida → no se toca nada (el modal de edición queda abierto)
    }
    setMovSaving(true)
    const prov = suppliers.find(s => s.id === draftSup)
    // Subir las fotos nuevas ANTES de tocar el movimiento. Si una falla (sin red),
    // el pago entra igual sin esa foto y se avisa — la plata no espera a Storage.
    const fotoPaths: string[] = [...draftFotosPrev]
    let fotosFallidas = 0
    for (const f of draftFotos) {
      try { fotoPaths.push(await uploadFacturaPhoto(f)) }
      catch { fotosFallidas++ }
    }
    if (fotosFallidas > 0) {
      onError(`${fotosFallidas} foto(s) de la factura no se pudieron subir (¿sin conexión?). El pago se registra igual — volvé a editarlo con red para reintentar la foto.`)
    }
    // Si edito uno ya persistido, borro su movimiento viejo antes de re-crear
    if (old?.persistedId) {
      // Edición = reemplazo: borra el movimiento viejo (cascada de inventario incluida) y re-crea.
      // Nota automática (no es un borrado "a mano" del usuario, es parte del flujo de editar).
      // Las credenciales de gerencia (si autorizó un cajero) viajan a la RPC, que las re-valida
      // server-side y audita al autorizante en movement_deletions.authorized_by (mig 044).
      try { await deleteCashMovement(old.persistedId, 'Reemplazo por edición de pago a proveedor', auth.managerEmail, auth.managerPassword); onRefresh() }
      catch (e) { onError(`No se pudo reemplazar el pago anterior: ${e instanceof Error ? e.message : 'reintentá'}`); setMovSaving(false); return }
    }
    const pago: PagoRow = {
      id:            old && !old.persistedId ? old.id : crypto.randomUUID(),
      supplier_id:   draftSup,
      supplier_name: prov?.name ?? '',
      supplier_cat:  prov?.category ?? '',
      amount_crc:    Number(draftCRC) || 0,
      amount_usd:    Number(draftUSD) || 0,
      method:        draftMethod,
      reference:     draftRef,
      at:            old?.at ?? Date.now(),
      attachments:   fotoPaths,
      persistedId:   null,
    }
    // más reciente arriba
    setPagos(prev => [pago, ...prev.filter(p => p.id !== pago.id)])
    setPagoModal(false)
    await persistPago(pago)
    setMovSaving(false)
  }

  // Cerrar modal con Escape
  useEffect(() => {
    if (!pagoModal) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPagoModal(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pagoModal])

  // ── Ingresos adicionales ───────────────────────────────────
  // El ALTA de ingresos nuevos ahora es por el asistente "➕ Agregar" (F4.3c). Se conserva el estado
  // `ingresos` (drafts en memoria) porque el cierre (handleCierre) y la lista lo siguen usando, y el ×
  // para quitar un ingreso ya registrado.
  const removeIngreso = async (id: string) => {
    const row = displayIngresos.find(i => i.id === id)
    if (row?.persistedId) {
      const auth = await requireManager()
      if (!auth.ok) return
      const note = await askNote('ingreso')
      if (!note) return
      try { await deleteCashMovement(row.persistedId, note, auth.managerEmail, auth.managerPassword); onRefresh() }
      catch (e) { onError(`No se pudo eliminar el ingreso: ${e instanceof Error ? e.message : 'reintentá'}`) }
    } else {
      setIngresos(prev => prev.filter(i => i.id !== id))
    }
  }

  // ── Otros egresos del turno (delivery, operativo, salario) ──
  // El ALTA de egresos operativos nuevos ahora es por el asistente "➕ Agregar" (F4.3c). Se conservan la
  // lista (otrosEgresosList) y el × para quitar uno ya registrado.
  // Egresos del turno que NO son mercadería (los pagos a proveedor van aparte)
  const otrosEgresosList = sessionMovements.filter(m =>
    m.movement_type !== 'ingreso' && m.movement_type !== 'traspaso'
    && m.movement_type !== 'egreso_mercaderia' && m.status !== 'rechazado')
  const removeEgreso = async (id: string) => {
    const auth = await requireManager()
    if (!auth.ok) return
    const note = await askNote('egreso')
    if (!note) return
    try { await deleteCashMovement(id, note, auth.managerEmail, auth.managerPassword); onRefresh() }
    catch (e) { onError(`No se pudo eliminar el egreso: ${e instanceof Error ? e.message : 'reintentá'}`) }
  }

  // Descartar el turno (apertura por error / fecha equivocada) → empezar de 0
  const descartarTurno = async () => {
    if (!openSession) return
    if (!window.confirm(`¿Descartar el turno ${openSession.shift_type} del ${openSession.session_date}?\nSe borra el turno y todos sus movimientos. No se puede deshacer.`)) return
    const auth = await requireManager()
    if (!auth.ok) return
    try { await discardCashSession(openSession.id, auth.managerEmail, auth.managerPassword); onSessionClose() }
    catch (e) { onError(e instanceof Error ? e.message : 'Error al descartar') }
  }

  // ── Check de proveedores (mediodía) — registra el visto, NO cierra la caja ──
  const [checking, setChecking] = useState(false)
  const handleMiddayCheck = async () => {
    if (!openSession || !profile || checking) return
    if (!(await requireManager()).ok) return
    setChecking(true)
    try {
      await updateMiddayCheck(openSession.id, profile.id)
      onRefresh()
    } catch (e) {
      onError((e instanceof Error ? e.message : 'Error') + ' — ¿corriste la migración 018 (midday_check)?')
    } finally { setChecking(false) }
  }

  // ── Confirmar cierre ──────────────────────────────────────
  const handleCierre = useCallback(async () => {
    if (!openSession || !profile) return
    if (!navigator.onLine) {
      onError('El cierre de la Caja Diaria requiere conexión — los pagos quedan guardados en cola; cerrá cuando vuelva la señal.')
      return
    }
    setSaving(true)
    try {
      // Persistir cualquier pago a proveedor que aún no esté en DB.
      // persistPago tiene guarda (if persistedId return) y crea el movimiento
      // egreso_mercaderia en Caja Proveedores. No re-crear aparte: hacerlo
      // duplicaba el movimiento al cerrar.
      await withTimeout(Promise.all(pagos
        .filter(p => p.supplier_id && Number(p.amount_crc) > 0 && !p.persistedId)
        .map(p => persistPago(p))
      ))

      // Persistir SÓLO ingresos que quedaron como borrador (p.ej. falló la
      // persistencia instantánea por red). Los ya persistidos NO se recrean → no duplica.
      await withTimeout(Promise.all(ingresos.filter(i => !i.persistedId && (Number(i.crc) > 0 || Number(i.usd) > 0)).map(i =>
        createCashMovement({
          session_id:    openSession.id,
          created_by:    profile.id,
          movement_type: 'ingreso' as MovementType,
          amount_crc:    Number(i.crc) || 0,
          amount_usd:    Number(i.usd) || 0,
          currency:      'CRC',
          exchange_rate: tc,
          description:   i.nota || 'Ingreso adicional',
          subcategory:   'Ingreso adicional',
          method:        'Efectivo',
          caja_origen:   'Registradora',
          shift:         tipShiftToCaja(openSession.shift_type),
        }).then(m => onMovAdded(m))
      )))
      // Close session
      await withTimeout(closeCashSession(
        openSession.id,
        {
          final_cash_crc: Number(cierreCRC) || 0,
          final_cash_usd: Number(cierreUSD) || 0,
          final_safe_crc: 0,
          final_bank_crc: 0,
          notes:          cierreNotas || undefined,
        },
        profile.id,
      ))
      onSessionClose()
      setPagos([])
      setIngresos([])
      setShowResumen(false)
      setCierreCRC(0)
      setCierreUSD(0)
      setView('apertura')
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Error cerrando turno')
    } finally {
      setSaving(false)
    }
  }, [openSession, profile, pagos, ingresos, cierreCRC, cierreUSD, cierreNotas,
      onSessionClose, onMovAdded, onError])

  // ────────────────────────────────────────────────────────
  // ── APERTURA VIEW ─────────────────────────────────────
  // ────────────────────────────────────────────────────────
  if (!openSession) {
    return (
      <div className="cd-wrap">
        <div className="cd-apertura-header">
          <div className="cd-apertura-title">Apertura de Caja Diaria</div>
          <div className="cd-apertura-sub">Una caja por día · confirmá el saldo inicial antes de empezar</div>
        </div>
        <div className="cd-apertura-body">

          {/* Cajero · Fecha (la Caja Diaria es única por día — sin turno) */}
          <div className="cd-grid2" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="tips-field">
              <div className="tips-field-label">Cajero / encargado</div>
              <select className="tips-input-dark" value={apCajero}
                onChange={e => setApCajero(e.target.value)}>
                <option value="">-- Seleccioná --</option>
                {employees.map(e => <option key={e.id} value={e.full_name}>{e.full_name}</option>)}
              </select>
            </div>
            <div className="tips-field">
              <div className="tips-field-label">Fecha</div>
              <input type="date" className="tips-input-dark" value={apFecha}
                onChange={e => setApFecha(e.target.value)}
                onClick={e => { try { (e.currentTarget as HTMLInputElement).showPicker?.() } catch { /* noop */ } }} />
            </div>
          </div>

          {yaExisteDia ? (
            <div className="cd-warn" style={{ marginTop: '1rem' }}>
              ⚠ Ya existe la Caja Diaria del {apFecha} ({sesionDelDia?.status === 'open' ? 'abierta' : 'cerrada'}). Elegí otra fecha.
            </div>
          ) : (
            <>

              {carrySugerido != null && carryFrom && (
                <div style={{ padding: '0.625rem 0.875rem', background: 'rgba(42,122,106,.1)', border: '1px solid var(--t-teal,#2a7a6a)', borderRadius: 4, marginBottom: '0.75rem', fontSize: '0.82rem' }}>
                  El cierre del <strong>{carryFrom}</strong> asignó a Caja Proveedores: <strong style={{ fontFamily: "'DM Mono', monospace" }}>₡{carrySugerido.toLocaleString('es-CR')}</strong>. Confirmá que es el efectivo con el que arrancás (si es otro monto, te va a pedir confirmar).
                </div>
              )}

              <div className="cd-ap-saldo-label">Saldo inicial de la Caja Diaria</div>
              <div className="cd-grid2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
                <div className="tips-field">
                  <div className="tips-field-label">Caja Diaria — Proveedores (₡)</div>
                  <div className="cd-monto-wrap">
                    <span className="cd-prefix">₡</span>
                    <input type="number" className="cd-monto-input" value={apProvCRC} min={0} step={1000}
                      placeholder="0" onChange={e => setApProvCRC(e.target.value === '' ? '' : Number(e.target.value))} />
                  </div>
                  {carryFrom && (
                    <div style={{ fontSize: '0.66rem', color: 'var(--t-teal)', marginTop: 2 }}>
                      ↻ asignado en el cierre del {carryFrom}{carrySugerido != null ? `: ₡${carrySugerido.toLocaleString('es-CR')}` : ''}
                    </div>
                  )}
                </div>
                <div className="tips-field">
                  <div className="tips-field-label">$ Dólares (efectivo)</div>
                  <div className="cd-monto-wrap usd">
                    <span className="cd-prefix">$</span>
                    <input type="number" className="cd-monto-input" value={apUSD} min={0} step={1}
                      placeholder="0" onChange={e => setApUSD(e.target.value === '' ? '' : Number(e.target.value))} />
                  </div>
                  {Number(apUSD) > 0 && (
                    <div style={{ fontSize:'0.68rem', color:'#888', marginTop:2 }}>
                      ≈ ₡{(Number(apUSD) * tc).toLocaleString('es-CR')} al TC {tc}
                    </div>
                  )}
                </div>
              </div>

              <button
                className="cd-btn-green"
                onClick={handleApertura}
                disabled={saving || !apCajero}
              >
                {saving ? 'Abriendo…' : '✓ CONFIRMAR APERTURA Y EMPEZAR EL DÍA'}
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  // ────────────────────────────────────────────────────────
  // ── TURNO VIEW ────────────────────────────────────────
  // ────────────────────────────────────────────────────────
  return (
    <div className="cd-wrap">

      {/* Status bar */}
      <div className="cd-status-bar">
        <div className="cd-status-left">
          <div className="cd-status-title">Caja Diaria</div>
          <div className="cd-status-sub">
            {openSession.cajero_name} · {openSession.shift_type} · {openSession.session_date}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          {canManage && (
            <button onClick={descartarTurno} title="Descartar turno (error de fecha) y empezar de 0"
              style={{ background: 'none', border: '1px solid #e0b0b0', color: '#c0392b', borderRadius: 4, padding: '4px 10px', fontSize: '0.74rem', cursor: 'pointer' }}>
              ↩ Descartar turno
            </button>
          )}
          <span className="cd-badge-open">Turno activo</span>
        </div>
      </div>

      {/* Top cards */}
      <div className="cd-top-cards">
        <div className="cd-top-card green">
          <div className="cd-tc-label">Caja Diaria — fondo</div>
          <div className="cd-tc-val">{fi(initProvCRC)}</div>
          {initUSD > 0 && <div className="cd-tc-usd">{fd(initUSD)}</div>}
          <div className="cd-tc-sub">para pago de proveedores</div>
        </div>
        <div className="cd-top-card gold">
          <div className="cd-tc-label">Gastado efectivo</div>
          <div className="cd-tc-val" style={{ color: provGastadoEf > 0 ? '#a07030' : '#aaa' }}>{fi(provGastadoEf)}</div>
          <div className="cd-tc-sub">proveedores + otros egresos</div>
        </div>
        <div className="cd-top-card red">
          <div className="cd-tc-label">Disponible</div>
          <div className="cd-tc-val" style={{ color: cajaDeberia < 0 ? '#c0392b' : cajaDeberia < 10000 ? '#a07030' : '#444' }}>
            {fi(cajaDeberia)}
          </div>
          <div className="cd-tc-sub">{cajaDeberia < 0 ? '⚠ déficit en caja' : 'restante en caja'}</div>
        </div>
      </div>

      {/* F4.3a — "➕ Agregar" único: asistente manual (captura + clasificación advisory + matriz RN-3).
          Additivo: los botones por sección (pago/ingreso/egreso) siguen abajo hasta F4.3c. */}
      {canManage && (
        <button className="cd-btn-green" style={{ width: '100%', marginBottom: '0.75rem', padding: '0.7rem' }}
          onClick={() => setAgregarOpen(true)}>
          ➕ Agregar (asistente)
        </button>
      )}

      {/* Check de proveedores (mediodía) — visto, NO cierra la caja */}
      <div className="cd-section" style={{ marginBottom: '0.75rem' }}>
        <div className="cd-section-head" style={{ padding: '0.5rem 0.75rem' }}>
          <div className="cd-section-icon">✅</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="cd-section-title" style={{ fontSize: '0.85rem' }}>Check de proveedores (mediodía)</div>
            <div className="cd-section-sub" style={{ fontSize: '0.66rem' }}>
              {openSession.midday_check_at
                ? `✓ Revisado ${new Date(openSession.midday_check_at).toLocaleString('es-CR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}${openSession.midday_check_by === profile?.id ? ` · ${profile?.full_name}` : ''}`
                : 'Sin revisar — el gerente AM da el visto (no cierra la caja)'}
            </div>
          </div>
          {canManage && (
            <button className="cd-section-add" onClick={handleMiddayCheck} disabled={checking}>
              {checking ? '…' : openSession.midday_check_at ? 'Re-revisar' : 'Dar visto'}
            </button>
          )}
        </div>
      </div>

      {/* Ingresos adicionales (compacto, arriba) */}
      <div className="cd-section" style={{ maxWidth: 460 }}>
        <div className="cd-section-head" style={{ padding: '0.5rem 0.75rem' }}>
          <div className="cd-section-icon">💵</div>
          <div>
            <div className="cd-section-title" style={{ fontSize: '0.85rem' }}>Ingresos adicionales</div>
            <div className="cd-section-sub" style={{ fontSize: '0.66rem' }}>Aceite, otros ingresos en efectivo</div>
          </div>
        </div>
        {displayIngresos.length > 0 && (
          <div className="cd-section-body">
            {displayIngresos.map(i => (
              <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.5rem', borderBottom: '1px solid var(--t-border,#d4cfc4)' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: '0.82rem' }}>
                    {Number(i.crc) > 0 && fi(Number(i.crc))}
                    {Number(i.usd) > 0 && <span style={{ color: '#1a4a7a' }}>{Number(i.crc) > 0 ? ' · ' : ''}${Number(i.usd)}</span>}
                  </div>
                  <div style={{ fontSize: '0.66rem', color: '#5a5040' }}>{i.nota || 'Ingreso adicional'}</div>
                </div>
                {canManage && (
                  <button onClick={() => removeIngreso(i.id)} title="Quitar"
                    style={{ background: 'none', border: '1px solid #e0b0b0', color: '#c0392b', borderRadius: 3, padding: '2px 8px', fontSize: '0.8rem', cursor: 'pointer', lineHeight: 1 }}>×</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pagos a proveedores */}
      <div className="cd-section">
        <div className="cd-section-head">
          <div className="cd-section-icon">🏪</div>
          <div>
            <div className="cd-section-title">Pagos a proveedores</div>
            <div className="cd-section-sub">
              {displayPagos.filter(p => p.supplier_id).length === 0
                ? 'Sin pagos registrados'
                : `${displayPagos.filter(p => p.supplier_id).length} registrado${displayPagos.filter(p => p.supplier_id).length !== 1 ? 's' : ''} · efectivo: ${fi(pagosEf)}`
              }
            </div>
          </div>
        </div>
        <div className="cd-section-body">
          {displayPagos.length === 0 && <div className="cd-empty-row">ℹ Sin pagos registrados</div>}
          {displayPagos.map(p => (
            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', padding: '0.55rem 0.5rem', borderBottom: '1px solid var(--t-border,#d4cfc4)' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '0.85rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.supplier_name || 'Proveedor'}</div>
                <div style={{ fontSize: '0.68rem', color: '#5a5040' }}>
                  {p.method === 'Efectivo' ? '💵 Efectivo' : p.method === 'Transferencia' ? '🏦 Transferencia' : p.method === 'SINPE' ? '📲 SINPE' : `₿ ${p.method}`}
                  {p.reference ? ` · ${p.reference}` : ''}
                  {` · ${new Date(p.at).toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' })}`}
                  {p.method === 'Transferencia' && <span style={{ color: '#a07030' }}> · pendiente · no descuenta efectivo</span>}
                  {p.method !== 'Efectivo' && p.method !== 'Transferencia' && <span style={{ color: '#2a7a6a' }}> · banco</span>}
                  {p.readonly && <span style={{ color: '#a07030' }}> · desde Bandeja (se gestiona en Pendientes)</span>}
                  {!p.persistedId && <span style={{ color: '#c0392b' }}> · sin guardar</span>}
                  {p.pending && <span style={{ color: '#a07830', fontWeight: 700 }}> · ⏳ por sincronizar</span>}
                  {/* T3-B: pago de mercadería guardado SIN factura enlazada (documents) NI fotos adjuntas
                      → nota para control del manager. Mismo color que "falta factura" (FacturaVerify). */}
                  {docsLoaded && p.persistedId && p.attachments.length === 0 && !linkedDocMovs.has(p.persistedId) && (
                    <span style={{ color: '#c8a030', fontWeight: 700 }}> · ⚠ sin foto</span>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', whiteSpace: 'nowrap' }}>
                {p.attachments.length > 0 && <FacturaThumbs paths={p.attachments} />}
                <span style={{ fontWeight: 700, fontFamily: 'var(--font-serif)' }}>{fi(Number(p.amount_crc) || 0)}</span>
                {canManage && !p.readonly && (
                  <>
                    <button onClick={() => openEditPago(p)} title="Editar"
                      style={{ background: 'none', border: '1px solid var(--t-border,#d4cfc4)', color: '#5a5040', borderRadius: 3, padding: '2px 7px', fontSize: '0.72rem', cursor: 'pointer' }}>✏</button>
                    <button onClick={() => removePago(p.id)} title="Eliminar"
                      style={{ background: 'none', border: '1px solid #e0b0b0', color: '#c0392b', borderRadius: 3, padding: '2px 8px', fontSize: '0.8rem', cursor: 'pointer', lineHeight: 1 }}>×</button>
                  </>
                )}
              </div>
            </div>
          ))}
          {displayPagos.filter(p => p.supplier_id).length > 0 && (
            <div className="cd-pagos-total">
              <span className="cd-tc-label">Pagado en efectivo</span>
              <span className="cd-total-val">{fi(pagosEf)}</span>
            </div>
          )}
          {pagosTr > 0 && (
            <div className="cd-pend-bar">
              <span>🕐</span>
              <div>Pagos por transferencia (pendientes): <strong>{pagosTrList.length}</strong> por <strong>{fi(pagosTr)}</strong> — no descuentan efectivo (se confirman en Pendientes)</div>
            </div>
          )}
          {pagosElec > 0 && (
            <div className="cd-pend-bar">
              <span>📲</span>
              <div><strong>{fi(pagosElec)}</strong> electrónico (SINPE/Bitcoin) — pagado desde el Banco, no toca la caja</div>
            </div>
          )}
        </div>
      </div>

      {/* Pagos operativos del turno (delivery, operativo, salario) */}
      <div className="cd-section">
        <div className="cd-section-head">
          <div className="cd-section-icon">🛵</div>
          <div>
            <div className="cd-section-title">Pagos operativos</div>
            <div className="cd-section-sub">Delivery, operativo, salario en efectivo — salen de la Caja Diaria</div>
          </div>
        </div>
        <div className="cd-section-body">
          {otrosEgresosList.length === 0 && <div className="cd-empty-row">ℹ Sin otros egresos registrados</div>}
          {otrosEgresosList.map(m => (
            <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', padding: '0.55rem 0.5rem', borderBottom: '1px solid var(--t-border,#d4cfc4)' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{m.subcategory || m.description}</div>
                <div style={{ fontSize: '0.68rem', color: '#5a5040' }}>
                  {m.method === 'Efectivo' ? '💵 Efectivo' : '🏦 Transferencia'}
                  {m.description && m.description !== m.subcategory ? ` · ${m.description}` : ''}
                  {m.status === 'pendiente' && <span style={{ color: '#a07030' }}> · pendiente</span>}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', whiteSpace: 'nowrap' }}>
                <span style={{ fontWeight: 700, color: '#c0392b' }}>{fi(m.amount_crc)}</span>
                {canManage && (
                  <button onClick={() => removeEgreso(m.id)} title="Eliminar"
                    style={{ background: 'none', border: '1px solid #e0b0b0', color: '#c0392b', borderRadius: 3, padding: '2px 8px', fontSize: '0.8rem', cursor: 'pointer', lineHeight: 1 }}>×</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Propinas por pagar (Bug C) */}
      {propinasPorPagar.length > 0 && (
        <div className="cd-section">
          <div className="cd-section-head">
            <div className="cd-section-icon">🎁</div>
            <div>
              <div className="cd-section-title">Propinas por pagar</div>
              <div className="cd-section-sub">Cerradas en Propinas — pagá ahora o dejá pendiente (como un proveedor)</div>
            </div>
          </div>
          <div className="cd-section-body">
            {propinasPorPagar.map(p => (
              <div key={p.session_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', padding: '0.55rem 0.5rem', borderBottom: '1px solid var(--t-border,#d4cfc4)' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>Propinas {shiftLabel(p.shift_type)} · {formatDate(p.session_date)}</div>
                  <div style={{ fontSize: '0.68rem', color: '#5a5040' }}>{fi(p.total_payout_crc)} a entregar al staff</div>
                </div>
                {canManage && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', whiteSpace: 'nowrap' }}>
                    <span style={{ fontWeight: 700, color: '#c0392b', marginRight: '0.25rem' }}>{fi(p.total_payout_crc)}</span>
                    <button onClick={() => pagarPropina(p, 'aprobado')} disabled={payingProp === p.session_id} title="Registrar el pago ahora"
                      style={{ background: 'var(--t-ink,#0d0d0d)', border: 'none', color: 'var(--t-gold,#c8a96e)', borderRadius: 3, padding: '4px 10px', fontSize: '0.72rem', cursor: payingProp === p.session_id ? 'wait' : 'pointer', opacity: payingProp === p.session_id ? 0.5 : 1 }}>
                      {payingProp === p.session_id ? 'Guardando…' : 'Pagar ahora'}</button>
                    <button onClick={() => pagarPropina(p, 'pendiente')} disabled={payingProp === p.session_id} title="Dejar pendiente (se paga después, como un proveedor)"
                      style={{ background: 'none', border: '1px solid #a07030', color: '#a07030', borderRadius: 3, padding: '4px 8px', fontSize: '0.72rem', cursor: payingProp === p.session_id ? 'wait' : 'pointer', opacity: payingProp === p.session_id ? 0.5 : 1 }}>Dejar pendiente</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cierre de la Caja Diaria de proveedores (paso propio, EOD) */}
      {canClose && view !== 'cierre' && (
        <div className="cd-section" style={{ borderColor: '#2a4a7a', borderWidth: 2 }}>
          <div className="cd-section-head" style={{ background: '#e0edf8', borderBottomColor: '#8ab0d0' }}>
            <div className="cd-section-icon" style={{ background: '#b0cce8' }}>🔒</div>
            <div>
              <div className="cd-section-title" style={{ color: '#1a4a7a' }}>Cerrar Caja Diaria de proveedores</div>
              <div className="cd-section-sub" style={{ color: '#3a6a9a' }}>Una vez al final del día (obligatorio aunque esté en cero) · solo el encargado</div>
            </div>
            <span className="cd-badge-manager">Manager</span>
          </div>
          <div className="cd-section-body">
            <div className="cd-grid2">
              <div className="tips-field">
                <div className="tips-field-label">Efectivo al cierre ₡</div>
                <div className="cd-monto-wrap">
                  <span className="cd-prefix">₡</span>
                  <input type="number" className="cd-monto-input" value={cierreCRC} min={0}
                    placeholder="0" onChange={e => setCierreCRC(e.target.value === '' ? '' : Number(e.target.value))} />
                </div>
              </div>
              <div className="tips-field">
                <div className="tips-field-label">Efectivo al cierre $</div>
                <div className="cd-monto-wrap usd">
                  <span className="cd-prefix">$</span>
                  <input type="number" className="cd-monto-input" value={cierreUSD} min={0}
                    placeholder="0" onChange={e => setCierreUSD(e.target.value === '' ? '' : Number(e.target.value))} />
                </div>
              </div>
            </div>

            {/* Verificación — Caja Diaria */}
            <div className="cd-verificacion">
              <div className="cd-verif-header">Verificación — Caja Diaria</div>
              <div className="cd-verif-row">
                <span>Fondo inicial{ingresosTotal > 0 ? ' + ingresos' : ''}</span>
                <strong>{fi(totalAsig)}</strong>
              </div>
              {provGastadoEf > 0 && (
                <div className="cd-verif-row">
                  <span>− Pagos efectivo (proveedores + otros)</span>
                  <strong style={{ color: '#c0392b' }}>− {fi(provGastadoEf)}</strong>
                </div>
              )}
              {otrosEgresosEf > 0 && (
                <div className="cd-verif-row">
                  <span>− Otros egresos efectivo</span>
                  <strong style={{ color: '#c0392b' }}>− {fi(otrosEgresosEf)}</strong>
                </div>
              )}
              <div className="cd-verif-row">
                <span>Debería quedar en la Caja Diaria</span>
                <strong>{fi(cajaDeberia)}</strong>
              </div>
              <div style={{ fontSize: '0.68rem', color: '#888', marginTop: 4 }}>
                ℹ La registradora la maneja el PoS — acá solo se cuenta la caja de proveedores.
              </div>
            </div>

            {cierreVal > 0 && (
              <div className={`cd-cierre-resultado ${cuadra ? 'ok' : 'fail'}`}>
                <span>{cuadra ? '✓' : '⚠'}</span>
                <span>{cuadra
                  ? 'Cuadra correctamente'
                  : `Diferencia: ${fi(Math.abs(diferencia!))}${diferencia! > 0 ? ' de más' : ' faltante'}`
                }</span>
              </div>
            )}

            <div className="tips-field" style={{ marginTop: '1rem' }}>
              <div className="tips-field-label">Notas del turno</div>
              <input type="text" className="tips-input-dark" value={cierreNotas}
                placeholder="Observaciones, incidentes..."
                onChange={e => setCierreNotas(e.target.value)} />
            </div>

            <button className="cd-btn-primary" style={{ marginTop: '1rem', width: '100%', justifyContent: 'center' }}
              onClick={() => setShowResumen(true)}>
              👁 VER RESUMEN Y CONFIRMAR CIERRE
            </button>
          </div>
        </div>
      )}

      {!canClose && (
        <div className="cd-locked">
          <span>🔒</span>
          <span>El cierre lo realiza el encargado al finalizar el turno</span>
        </div>
      )}

      {/* Resumen modal before confirm */}
      {showResumen && openSession && (
        <div className="cd-modal-overlay" onClick={() => setShowResumen(false)}>
          <div className="cd-modal" onClick={e => e.stopPropagation()}>
            <div className="cd-modal-title">Resumen del Turno</div>
            <div className="cd-modal-meta">
              {openSession.cajero_name} · {openSession.shift_type} · {openSession.session_date}
            </div>

            <div className="cd-resumen-block">
              <div className="cd-resumen-row">
                <span>Caja Diaria inicial</span>
                <strong>{fi(initProvCRC)}{initUSD ? ' / ' + fd(initUSD) : ''}</strong>
              </div>
              {ingresosTotal > 0 && (
                <div className="cd-resumen-row">
                  <span>Ingresos adicionales</span>
                  <strong style={{ color: '#c8a96e' }}>+ {fi(ingresosTotal)}</strong>
                </div>
              )}
              <div className="cd-resumen-row total">
                <span>Total asignado</span>
                <strong>{fi(totalAsig)}</strong>
              </div>
            </div>

            <div className="cd-resumen-block">
              {displayPagos.filter(p => p.supplier_id).map(p => (
                <div key={p.id} className="cd-resumen-pago">
                  <div>
                    <span>{p.supplier_name || '—'}</span>
                    <span className={`cd-method-badge ${p.method === 'Efectivo' ? 'ef' : 'tr'}`}>{p.method}</span>
                  </div>
                  <span>{fi(Number(p.amount_crc) || 0)}</span>
                </div>
              ))}
              <div className="cd-resumen-row">
                <span>Efectivo que debería quedar (Caja Diaria)</span>
                <strong style={{ color: '#27874f' }}>{fi(cajaDeberia)}</strong>
              </div>
            </div>

            {cierreVal > 0 && (
              <div className={`cd-cierre-resultado ${cuadra ? 'ok' : 'fail'}`} style={{ marginBottom: '1rem' }}>
                <span>Efectivo real al cierre: <strong>{fi(cierreVal)}</strong></span>
                <span>{cuadra ? '✓ Cuadra' : `⚠ Dif: ${fi(Math.abs(diferencia!))}`}</span>
              </div>
            )}

            <div className="cd-modal-note">
              Los pagos en efectivo quedan como Pagados. Las transferencias quedan como Pendientes hasta confirmar.
            </div>
            <div className="cd-modal-actions">
              <button className="tips-btn-ghost" onClick={() => setShowResumen(false)}>Volver a editar</button>
              <button className="cd-btn-green" onClick={handleCierre} disabled={saving}>
                {saving ? 'Cerrando…' : '✓ Confirmar y cerrar turno'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: agregar / editar pago a proveedor */}
      {agregarOpen && openSession && profile && (
        <AgregarAsistente
          openSession={openSession}
          suppliers={suppliers}
          role={profile.role}
          createdBy={profile.id}
          tc={tc}
          onCreated={mov => { onMovAdded(mov); setAgregarOpen(false) }}
          onClose={() => setAgregarOpen(false)}
          onError={onError}
        />
      )}

      {pagoModal && (
        <div className="cd-modal-overlay" onClick={() => setPagoModal(false)}>
          <div className="cd-modal" onClick={e => e.stopPropagation()}>
            <div className="cd-modal-title">{editId ? 'Editar pago' : 'Agregar pago a proveedor'}</div>

            <div className="tips-field" style={{ marginTop: '0.5rem', position: 'relative' }}>
              <div className="tips-field-label">Proveedor</div>
              <input type="text" className="tips-input-dark" style={{ width: '100%' }}
                placeholder="Escribí para buscar proveedor…"
                value={supSearch}
                onChange={e => { setSupSearch(e.target.value); setDraftSup(''); setSupOpen(true) }}
                onFocus={() => setSupOpen(true)}
                onBlur={() => setTimeout(() => setSupOpen(false), 150)} />
              {supOpen && (() => {
                const matches = suppliers.filter(s => s.is_active && s.name.toLowerCase().includes(supSearch.toLowerCase()))
                return (
                  <div className="cd-sup-dropdown" style={{ maxHeight: 260, overflowY: 'auto' }}>
                    {matches.length === 0 && <div className="cd-sup-empty">Sin coincidencias</div>}
                    {matches.map(s => (
                      <div key={s.id} className="cd-sup-option"
                        onMouseDown={() => {
                          setDraftSup(s.id); setSupSearch(s.name); setSupOpen(false)
                          // Prefill con la preferencia del proveedor; SINPE/Bitcoin ya no son
                          // opciones de pago a proveedor → defaultean a Transferencia.
                          if (!editId && s.metodo_pago) setDraftMethod(s.metodo_pago === 'Efectivo' ? 'Efectivo' : 'Transferencia')
                        }}>
                        {s.name}{s.category && <span className="cd-sup-cat"> · {s.category}</span>}
                        {s.metodo_pago && s.metodo_pago !== 'Efectivo' && <span className="cd-sup-cat"> · {s.metodo_pago}{s.moneda === 'USD' ? ' · USD' : ''}</span>}
                      </div>
                    ))}
                  </div>
                )
              })()}
            </div>

            {/* Alta rápida de proveedor (sin salir de la caja) */}
            <div style={{ marginTop: '0.5rem' }}>
              {!addSupOpen ? (
                <button type="button" onClick={() => { setAddSupOpen(true); setNewSupName(supSearch) }}
                  style={{ background: 'none', border: '1px dashed var(--t-border,#d4cfc4)', color: '#5a5040', borderRadius: 3, padding: '5px 10px', fontSize: '0.74rem', cursor: 'pointer' }}>
                  + Proveedor nuevo
                </button>
              ) : (
                <div style={{ border: '1px solid var(--t-border,#d4cfc4)', borderRadius: 4, padding: '0.625rem' }}>
                  <div style={{ fontSize: '0.7rem', color: '#5a5040', marginBottom: 6, fontWeight: 700 }}>Nuevo proveedor</div>
                  <input type="text" className="tips-input-dark" style={{ width: '100%', marginBottom: 6 }} placeholder="Nombre del proveedor"
                    value={newSupName} onChange={e => setNewSupName(e.target.value)} />
                  <div style={{ display: 'flex', gap: '0.5rem', marginBottom: 6 }}>
                    <select className="tips-input-dark" style={{ flex: 1 }} value={newSupCat} onChange={e => setNewSupCat(e.target.value)}>
                      {CATEGORIAS_PROV.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <select className="tips-input-dark" style={{ flex: 1 }} value={newSupMethod} onChange={e => setNewSupMethod(e.target.value)}>
                      {METODOS_PAGO_PROVEEDOR.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                    <button type="button" onClick={() => setAddSupOpen(false)}
                      style={{ background: 'none', border: '1px solid var(--t-border,#d4cfc4)', color: '#5a5040', borderRadius: 3, padding: '5px 10px', fontSize: '0.74rem', cursor: 'pointer' }}>Cancelar</button>
                    <button type="button" onClick={crearProveedor} disabled={addSupSaving || !newSupName.trim()}
                      style={{ background: 'var(--t-ink,#0d0d0d)', border: 'none', color: 'var(--t-gold,#c8a96e)', borderRadius: 3, padding: '5px 12px', fontSize: '0.74rem', cursor: 'pointer', opacity: addSupSaving || !newSupName.trim() ? 0.5 : 1 }}>
                      {addSupSaving ? 'Creando…' : 'Crear y usar'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="cd-grid2" style={{ marginTop: '0.75rem' }}>
              <div className="tips-field">
                <div className="tips-field-label">Monto ₡ colones</div>
                <div className="cd-monto-wrap">
                  <span className="cd-prefix">₡</span>
                  <input type="number" className="cd-monto-input" value={draftCRC} placeholder="0" autoFocus
                    onChange={e => setDraftCRC(e.target.value === '' ? '' : Number(e.target.value))} />
                </div>
              </div>
              <div className="tips-field">
                <div className="tips-field-label">Monto $ dólares</div>
                <div className="cd-monto-wrap usd">
                  <span className="cd-prefix">$</span>
                  <input type="number" className="cd-monto-input" value={draftUSD} placeholder="0"
                    onChange={e => setDraftUSD(e.target.value === '' ? '' : Number(e.target.value))} />
                </div>
              </div>
            </div>

            <div className="tips-field" style={{ marginTop: '0.75rem' }}>
              <div className="tips-field-label">Método de pago</div>
              <div className="cd-metodo-tabs">
                {METODOS_PAGO_PROVEEDOR.map(m => (
                  <div key={m} className={`cd-metodo-tab ${m === 'Efectivo' ? 'ef' : 'tr'} ${draftMethod === m ? 'active' : ''}`}
                    onClick={() => setDraftMethod(m)}>{m === 'Efectivo' ? '💵' : '🏦'} {m}</div>
                ))}
              </div>
              {draftMethod === 'Transferencia' && <div className="cd-method-info pend">→ Transferencia — queda como pendiente hasta confirmar · sale del Banco</div>}
              <div style={{ fontSize: '0.68rem', color: '#5a5040', marginTop: 4 }}>
                Caja origen: <strong>{draftMethod === 'Efectivo' ? 'Caja Proveedores' : 'Banco'}</strong>
              </div>
            </div>

            <div className="tips-field" style={{ marginTop: '0.75rem' }}>
              <div className="tips-field-label">Nota / Nº Factura</div>
              <input type="text" className="tips-input-dark" value={draftRef} placeholder="Nº factura, descripción del pago..."
                onChange={e => setDraftRef(e.target.value)} />
            </div>

            {/* Fotos de la factura — en móvil abre la cámara directo (capture).
                Quedan guardadas en el bucket 'facturas' y vinculadas al pago (mig 026). */}
            <div className="tips-field" style={{ marginTop: '0.75rem' }}>
              <div className="tips-field-label">Fotos de la factura</div>
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                border: '2px dashed var(--t-border,#d4cfc4)', borderRadius: 6, padding: '0.8rem',
                cursor: 'pointer', fontSize: '0.9rem', fontWeight: 700, color: '#5a5040' }}>
                📷 Sacar foto / agregar imagen
                <input type="file" accept="image/*" capture="environment" multiple
                  style={{ display: 'none' }}
                  onChange={e => {
                    const files = Array.from(e.target.files ?? [])
                    if (files.length) setDraftFotos(prev => [...prev, ...files])
                    e.target.value = ''   // permite re-sacar la misma foto
                  }} />
              </label>
              {(draftFotosPrev.length > 0 || draftFotos.length > 0) && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8, alignItems: 'center' }}>
                  {draftFotosPrev.length > 0 && <FacturaThumbs paths={draftFotosPrev} size={52} />}
                  {draftFotosPrev.length > 0 && (
                    <button type="button" onClick={() => setDraftFotosPrev([])} title="Quitar las fotos ya guardadas de este pago"
                      style={{ background: 'none', border: '1px solid #e0b0b0', color: '#c0392b', borderRadius: 3, padding: '2px 7px', fontSize: '0.68rem', cursor: 'pointer' }}>
                      quitar guardadas
                    </button>
                  )}
                  {draftFotos.map((f, i) => (
                    <span key={i} style={{ position: 'relative', display: 'inline-block' }}>
                      <img src={fotoPreviews[i]} alt={f.name}
                        style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--t-border,#d4cfc4)' }} />
                      <button type="button" onClick={() => setDraftFotos(prev => prev.filter((_, j) => j !== i))}
                        style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%',
                          background: '#c0392b', color: '#fff', border: 'none', fontSize: '0.62rem', lineHeight: 1, cursor: 'pointer' }}>✕</button>
                    </span>
                  ))}
                </div>
              )}
              <div style={{ fontSize: '0.66rem', color: '#8a8378', marginTop: 4 }}>
                Se suben al confirmar el pago (necesitan conexión). Después se ven como miniatura en la lista — tap para verla completa.
              </div>
            </div>

            <div className="cd-modal-actions" style={{ marginTop: '1rem' }}>
              <button className="tips-btn-ghost" onClick={() => setPagoModal(false)}>Cancelar</button>
              <button className="cd-btn-green" onClick={confirmPago} disabled={!draftSup || !Number(draftCRC) || movSaving}>
                {movSaving ? 'Guardando…' : editId ? '✓ Guardar cambios' : '✓ Confirmar pago'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

// ── (PagoCard eliminado: el alta/edición de pagos ahora se hace por modal) ──

