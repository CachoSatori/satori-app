/**
 * CashCierre — Cierre del día en 2 fases
 * Port of renderCierreTurno from SATORI CAJA standalone
 *
 * Fase 1 — Mediodía: Ventas PoS ₡/$, propinas, otros egresos → se sella
 * Fase 2 — Noche   : ídem + conteo físico (separaciones) + verificación
 *
 * Separaciones:
 *   - Caja Diaria mañana (para el próximo turno)
 *   - Caja Registradora (vuelto)
 *   - Remanente CF (queda en Caja Fuerte)
 *
 * Verificación: compara "debería quedar" vs total contado.
 * Si diferencia > ₡500 → campo obligatorio tipo + motivo.
 */
import { useState, useEffect } from 'react'
import { useAuth } from '../../shared/hooks/useAuth'
import { useManagerOverride } from '../../shared/ManagerOverride'
import type { CashCierreDia, CashSession, CashMovement } from '../../shared/types/database'
import { getCierresDia, getAllCashMovements, getCashSessions, saveCierreParcial, updateCierreCompleto, recordCierreSales, recordCierreRetiro, recordCierreAjuste, discardCierreDia, discardDiaCompleto, createDayMovement, sendCierreEmail } from '../../shared/api/cash'
import { getCurrentRate } from '../../shared/api/exchangeRate'
import { getTipPayoutsSince, type TipPayoutSummary } from '../../shared/api/tips'
import { fi, todayStr, formatDate, saldoCajaFuerte } from './cashUtils'
import { propinaEgresoFields, propinasPorPagarDe, propinasPagadasEnFecha } from './propinaPago'
import { shiftLabel } from '../../shared/utils'

const fi2 = (n: number | undefined) => fi(n ?? 0)

interface Props { onRefresh: () => void; openSession?: CashSession | null }

function N(v: number | ''): number { return Number(v) || 0 }

// Cuadre USD del cierre — espeja la fórmula CRC (saldo base + mediodía + noche).
// En Caja Fuerte los dólares solo salen por retiro de socios o depósito a banco,
// así que el "debería" SIEMPRE incluye el saldo USD del ledger. Exportada para test.
export function calcDeberiaUSD(saldoBaseUsd: number, vmUsd: number, vnUsd: number): number {
  return saldoBaseUsd + vmUsd + vnUsd
}

// Gate del ajuste — Opción B FIRMADA por la dueña: el motivo es obligatorio si la diferencia
// en ₡ supera su tolerancia (₡500) O la de US$ supera la suya ($1, con datos USD presentes:
// difUsd viene null cuando no hay ni contado ni "debería" en dólares). Antes el gate era solo ₡.
// Mismas tolerancias que cuadra/cuadraUSD del componente — mantener en sync. Exportada para test.
export function cierreNecesitaAjuste(difCrc: number | null, difUsd: number | null): boolean {
  return (difCrc !== null && Math.abs(difCrc) >= 500) || (difUsd !== null && Math.abs(difUsd) >= 1)
}

// Gate de ventas en 0 (CAMBIO A). N() no distingue '' (vacío) de 0 (cero explícito), así que se
// mira el estado CRUDO de los campos ₡/$:
//   'vacio' → ambos campos sin cargar → BLOQUEA (hay que ingresar las ventas).
//   'cero'  → total del turno = 0 con algún 0 explícito → venta real de ₡0 → permite SOLO con confirmación.
//   'ok'    → algún monto > 0 → cierra normal.
// Exportada para test.
export function ventasGateEstado(crc: number | '', usd: number | ''): 'vacio' | 'cero' | 'ok' {
  if (crc === '' && usd === '') return 'vacio'
  if ((Number(crc) || 0) === 0 && (Number(usd) || 0) === 0) return 'cero'
  return 'ok'
}

// ¿Se puede cerrar la fase con estas ventas? Vacío nunca; cero solo si se confirmó; >0 siempre.
export function puedeCerrarVentas(crc: number | '', usd: number | '', confirmadoCero: boolean): boolean {
  const estado = ventasGateEstado(crc, usd)
  return estado === 'ok' || (estado === 'cero' && confirmadoCero)
}

export default function CashCierre({ onRefresh, openSession }: Props) {
  const { profile } = useAuth()
  const requireManager = useManagerOverride()
  const today       = todayStr()
  const turnoAbierto = !!openSession  // bloquea SOLO la Fase 2 (noche); la Fase 1 se sella igual

  const [cierres,  setCierres]  = useState<CashCierreDia[]>([])
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [msg,      setMsg]      = useState<string | null>(null)
  const [fecha,    setFecha]    = useState(today)
  const [movs,     setMovs]     = useState<CashMovement[]>([])   // ledger para saldoCajaFuerte
  const [sessions, setSessions] = useState<CashSession[]>([])    // para gatear: caja de proveedores cerrada

  const loadCierres = async () => {
    setLoading(true)
    try {
      const [cs, ms, ss] = await Promise.all([getCierresDia(fecha), getAllCashMovements(), getCashSessions()])
      setCierres(cs)
      setMovs(ms)
      setSessions(ss)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { loadCierres() }, [fecha])

  // Find partial (mediodía) and full (completo) for selected date
  const parcial  = cierres.find(c => c.tipo === 'parcial_mediodia')
  const completo = cierres.find(c => c.tipo === 'completo')
  // El cierre de bóveda (Fase 2) requiere que la Caja Diaria de proveedores del día
  // ya esté CERRADA (paso propio en Caja Diaria), aunque haya estado en cero.
  const cajaProvCerrada = sessions.some(s => s.session_date === fecha && s.status === 'closed')

  const manager = profile?.full_name ?? ''

  // Tipo de cambio configurado (último de exchange_rates). Editable por el
  // manager en el cierre. Default 640 hasta que cargue.
  const [tc, setTc] = useState<number>(640)
  useEffect(() => {
    const saved = parcial?.tipo_cambio
    if (saved && saved > 0) { setTc(saved); return }
    getCurrentRate().then(r => { if (r > 0) setTc(r) }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parcial?.tipo_cambio])

  // ── Propinas del día — VÍA REAL (FIRMADO: una sola fuente de verdad) ─────────
  // Los turnos de propinas pendientes se PAGAN desde acá (misma vía que Caja Diaria:
  // propinaEgresoFields → egreso real que salda el pendiente). La matemática del cierre
  // resta SOLO lo efectivamente pagado (movimientos del libro), nunca un número tipeado.
  const [propinasPagables, setPropinasPagables] = useState<TipPayoutSummary[]>([])
  const [payingProp,       setPayingProp]       = useState<string | null>(null)   // anti doble-click
  useEffect(() => {
    let cancelled = false
    const since = new Date(fecha + 'T12:00:00')
    since.setDate(since.getDate() - 30)   // mismo corte que CashTurno: una impaga vieja reaparece
    getTipPayoutsSince(since.toISOString().slice(0, 10))
      .then(r => { if (!cancelled) setPropinasPagables(r) })
      .catch(() => { if (!cancelled) setPropinasPagables([]) })
    return () => { cancelled = true }
  }, [fecha])
  const propinasPorPagar = propinasPorPagarDe(propinasPagables, movs)
  // Sección plegable (default: cerrada) — solo UI, estado en memoria y sin storage.
  const [propinasOpen, setPropinasOpen] = useState(false)
  const propinasPorPagarTotal = propinasPorPagar.reduce((s, p) => s + (p.total_electronico_crc || 0), 0)

  // ── FASE 1 state ──────────────────────────────────────────────
  const [vmCRC,       setVmCRC]       = useState<number | ''>('')
  const [vmUSD,       setVmUSD]       = useState<number | ''>('')

  // Efectivo real en COLONES del mediodía = ventas PoS ₡ − dólares al TC.
  // (El PoS registra toda venta en colones; los dólares físicos se cuentan
  // aparte, así que se restan de la parte en colones.)
  const efRealM = Math.round(N(vmCRC) - N(vmUSD) * tc)

  // ── FASE 2 state ──────────────────────────────────────────────
  const [vnCRC,       setVnCRC]       = useState<number | ''>('')
  const [vnUSD,       setVnUSD]       = useState<number | ''>('')
  const [retiroN,     setRetiroN]     = useState<number | ''>('')   // retiro de dueños a banco (egreso administrativo)

  const efRealN = Math.round(N(vnCRC) - N(vnUSD) * tc)

  // Separaciones
  const [sepDiariaCRC,  setSepDiariaCRC]  = useState<number | ''>('')
  const [sepDiariaUSD,  setSepDiariaUSD]  = useState<number | ''>('')
  const [sepRegCRC,     setSepRegCRC]     = useState<number | ''>('')
  const [sepRegUSD,     setSepRegUSD]     = useState<number | ''>('')
  const [remCRC,        setRemCRC]        = useState<number | ''>('')
  const [remUSD,        setRemUSD]        = useState<number | ''>('')

  const totalContadoCRC = N(sepDiariaCRC) + N(sepRegCRC) + N(remCRC)
  const totalContadoUSD = N(sepDiariaUSD) + N(sepRegUSD) + N(remUSD)

  // Verification calculation — las propinas que restan son las PAGADAS (vía real, FIRMADO):
  // movimientos 'Propinas por turno' con status aprobado cuya plata salió HOY (fecha del turno
  // pagador, o fecha del movimiento a nivel día si se pagó desde este cierre). Las PENDIENTES
  // no restan nada — la plata sigue en la caja hasta pagarse (flujo proveedor).
  const propinasPagadasDia = propinasPagadasEnFecha(movs, sessions, fecha)
  const efRealMFromParcial = parcial ? parcial.ef_real_m_crc : efRealM
  // Pierna M = lo sellado en Fase 1 (propinas_m_crc ahora guarda la SUMA PAGADA al sellar —
  // mismo campo, compat con cierres históricos y KPIs). Antes del sellado, el total pagado vivo.
  const propMFromParcial   = parcial ? parcial.propinas_m_crc : propinasPagadasDia
  // Pierna N = lo pagado después del sellado (clamp ≥0 por robustez ante ediciones raras).
  const propNLeg           = Math.max(0, propinasPagadasDia - propMFromParcial)
  const vmUSDFromParcial   = parcial ? parcial.vm_usd : N(vmUSD)

  // Saldo de Caja Fuerte según el ledger, EXCLUYENDO las ventas-de-cierre de esta fecha
  // (esas se re-suman desde el formulario → evitar doble conteo). Idempotente al re-cerrar.
  // El AJUSTE de cierre de esta MISMA fecha recibe el mismo tratamiento (Opción B): el deshacer
  // lo borra, pero si quedara colgado (deshacer parcial), contarlo acá corrompería el "debería"
  // del re-cierre. Los ajustes de fechas ANTERIORES sí cuentan — son los que dejan el saldo
  // arrancando del físico contado de su día.
  const saldoBase = saldoCajaFuerte(
    movs.filter(m => !(
      (m.subcategory === 'Ventas cierre' || m.subcategory === 'Ajuste de cierre')
      && (m.description || '').includes(fecha))))
  const netoM    = efRealMFromParcial - propMFromParcial
  const netoN    = efRealN - propNLeg - N(retiroN)
  // Debería quedar en Caja Fuerte = saldo del ledger + ventas efectivo − propinas − retiro.
  const deberia  = saldoBase.crc + netoM + netoN
  const diferencia = totalContadoCRC > 0 ? totalContadoCRC - deberia : null
  const cuadra     = diferencia !== null && Math.abs(diferencia) < 500

  // Dólares: lo que debería haber físicamente = saldo USD de Caja Fuerte (ledger,
  // ya filtrado anti-doble-conteo) + dólares de ventas (mediodía + noche).
  const deberiaUSD   = calcDeberiaUSD(saldoBase.usd, vmUSDFromParcial, N(vnUSD))
  const difUSD       = totalContadoUSD > 0 || deberiaUSD > 0 ? totalContadoUSD - deberiaUSD : null
  const cuadraUSD    = difUSD === null || Math.abs(difUSD) < 1

  // Ajuste
  const [ajusteTipo,   setAjusteTipo]   = useState('Faltante')
  const [ajusteMotivo, setAjusteMotivo] = useState('')
  const [notas,        setNotas]        = useState('')

  // CAMBIO A — cerrar con ventas en ₡0: confirmación explícita por fase (checkbox).
  const [confirmVentasCeroM, setConfirmVentasCeroM] = useState(false)
  const [confirmVentasCeroN, setConfirmVentasCeroN] = useState(false)
  // CAMBIO B — resumen del cierre ANTES de confirmar (modal de solo lectura).
  const [showResumen, setShowResumen] = useState(false)

  // Ventas en 0 (CAMBIO A) — estado crudo por fase (ver ventasGateEstado).
  const ventasMVacias   = ventasGateEstado(vmCRC, vmUSD) === 'vacio'
  const ventasMCeroReal = ventasGateEstado(vmCRC, vmUSD) === 'cero'
  const ventasNVacias   = ventasGateEstado(vnCRC, vnUSD) === 'vacio'
  const ventasNCeroReal = ventasGateEstado(vnCRC, vnUSD) === 'cero'

  // Opción B (firmada): el gate cubre AMBAS monedas — antes un faltante solo-USD cerraba sin motivo.
  const requiresAjuste = cierreNecesitaAjuste(diferencia, difUSD)

  // ── Confirmar cierre parcial (Fase 1) ─────────────────────────
  // El turno abierto NO bloquea el sellado del Mediodía: al mediodía la caja sigue operando
  // y la Fase 1 solo sella las ventas de ese tramo (no toca conteo físico ni Caja Fuerte).
  // El bloqueo por turno abierto vive donde importa: la Fase 2 (ver handleConfirmCompleto).
  const handleConfirmParcial = async () => {
    if (!navigator.onLine) { setError('El cierre requiere conexión — esperá a que vuelva la señal y reintentá.'); return }
    if (ventasMVacias) { setError('Ingresá las ventas de mediodía'); return }
    if (ventasMCeroReal && !confirmVentasCeroM) {
      setError('Marcá la casilla para confirmar que las ventas de mediodía fueron ₡0, o corregí el monto'); return
    }
    setSaving(true); setError(null)
    try {
      await saveCierreParcial({
        session_date:    fecha,
        manager,
        tipo:            'parcial_mediodia',
        vm_crc:          N(vmCRC),
        vm_usd:          N(vmUSD),
        // Suma PAGADA (vía real) al momento del sellado — mismo campo que siempre (compat).
        propinas_m_crc:  propinasPagadasDia,
        otros_m_crc:     0,
        ef_real_m_crc:   efRealM,
        // Fase 2 vacía
        vn_crc:0, vn_usd:0, propinas_n_crc:0, otros_n_crc:0, ef_real_n_crc:0,
        sep_diaria_crc:0, sep_diaria_usd:0, sep_registradora_crc:0, sep_registradora_usd:0,
        remanente_crc:0, remanente_usd:0, diferencia_crc:0, ajuste_tipo:'', ajuste_motivo:'',
        notas:'', tipo_cambio: tc,
      })
      setMsg('✓ Fase 1 confirmada — Mediodía sellado')
      await loadCierres()
      onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error guardando')
    } finally {
      setSaving(false)
    }
  }

  // ── Confirmar cierre completo (Fase 2) ───────────────────────
  const handleConfirmCompleto = async () => {
    if (!navigator.onLine) { setError('El cierre requiere conexión — esperá a que vuelva la señal y reintentá.'); return }
    if (turnoAbierto) { setError('Cerrá el turno abierto en Caja Diaria antes del cierre del día'); return }
    if (!cajaProvCerrada) { setError('Cerrá primero la Caja Diaria de proveedores del día.'); return }
    if (ventasNVacias) { setError('Ingresá las ventas de noche'); return }
    if (ventasNCeroReal && !confirmVentasCeroN) {
      setError('Marcá la casilla para confirmar que las ventas de noche fueron ₡0, o corregí el monto'); return
    }
    if (totalContadoCRC === 0) { setError('Completá el conteo físico (separaciones)'); return }
    if (requiresAjuste && !ajusteMotivo.trim()) {
      setError('⚠ Hay diferencia — el motivo es obligatorio antes de cerrar'); return
    }
    // Orden de fases: la noche NO se puede cerrar sin el Mediodía confirmado (Fase 1).
    // Sin `parcial`, las ventas de mediodía se perderían y el cierre quedaría a medias.
    if (!parcial) { setError('Cerrá primero el Mediodía (Fase 1) antes de cerrar la noche.'); return }
    setSaving(true); setError(null)
    try {
      // Fase 1 ya confirmada → pasar el cierre a 'completo'.
      await updateCierreCompleto(parcial.id, {
        tipo:                 'completo',
        vn_crc:               N(vnCRC),
        vn_usd:               N(vnUSD),
        // Pierna N pagada (vía real) — mismo campo que siempre (compat con KPIs e históricos).
        propinas_n_crc:       propNLeg,
        otros_n_crc:          N(retiroN),
        ef_real_n_crc:        efRealN,
        sep_diaria_crc:       N(sepDiariaCRC),
        sep_diaria_usd:       N(sepDiariaUSD),
        sep_registradora_crc: N(sepRegCRC),
        sep_registradora_usd: N(sepRegUSD),
        remanente_crc:        N(remCRC),
        remanente_usd:        N(remUSD),
        diferencia_crc:       diferencia ?? 0,
        ajuste_tipo:          requiresAjuste ? ajusteTipo : '',
        ajuste_motivo:        requiresAjuste ? ajusteMotivo : '',
        notas,
        tipo_cambio:          tc,
      })
      // Fase 3 — registrar las ventas en EFECTIVO en el ledger. ES PARTE ESENCIAL del
      // cierre (alimenta el saldo de Caja Fuerte), NO es complementario. Si falla, el día
      // quedó guardado pero las ventas NO están → avisar explícito, nunca ocultar.
      try {
        // IDENTIDAD (FIRMADA): 'Ventas cierre' ingresa a Caja Fuerte el NETO de propinas
        // pagadas (efReal − pierna pagada de cada fase) — lo que efectivamente llega a la
        // bóveda. Así ledger post-cierre = deberia + ajuste = físico contado, EXACTO.
        // (Los egresos de propinas viven en Registradora — no tocan el ledger de CF.)
        await recordCierreSales({
          session_date:  fecha,
          created_by:    profile?.id ?? '',
          exchange_rate: tc,
          mediodia: { crc: efRealMFromParcial - propMFromParcial, usd: vmUSDFromParcial },
          noche:    { crc: efRealN - propNLeg,                    usd: N(vnUSD) },
        })
        await recordCierreRetiro({
          session_date:  fecha,
          created_by:    profile?.id ?? '',
          exchange_rate: tc,
          amount_crc:    N(retiroN),
        })
      } catch (e3) {
        await loadCierres(); onRefresh()
        setError(`El día se guardó pero las VENTAS no se registraron en movimientos: ${e3 instanceof Error ? e3.message : String(e3)}. Deshacé el cierre y volvé a cerrarlo.`)
        return
      }
      // Fase 4 — Opción B (FIRMADA): materializar la diferencia como movimiento(s) de AJUSTE en
      // Caja Fuerte (faltante → egreso resta · sobrante → ingreso suma), para que el ledger
      // arranque mañana del físico contado. ORDEN CRÍTICO: va DESPUÉS de sellar el cierre y
      // registrar ventas/retiro — la diferencia ya quedó calculada y guardada SIN este ajuste.
      // Se llama SIEMPRE (aun cuadrando): su limpieza inicial borra ajustes viejos del día.
      try {
        await recordCierreAjuste({
          session_date:  fecha,
          created_by:    profile?.id ?? '',
          exchange_rate: tc,
          motivo:        ajusteMotivo.trim(),
          dif_crc:       diferencia !== null && !cuadra    ? diferencia : 0,
          dif_usd:       difUSD     !== null && !cuadraUSD ? difUSD     : 0,
        })
      } catch (e4) {
        await loadCierres(); onRefresh()
        setError(`El día se cerró pero el AJUSTE de la diferencia no quedó en movimientos: ${e4 instanceof Error ? e4.message : String(e4)}. Deshacé el cierre y volvé a cerrarlo.`)
        return
      }
      setMsg('✓ Día cerrado completamente')
      // C3 — email de cortesía al owner con el resumen (fire-and-forget). La plata ya
      // quedó sellada arriba; si el email falla no rompe ni bloquea el cierre.
      void sendCierreEmail(parcial.id)
      await loadCierres()
      onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error guardando')
    } finally {
      setSaving(false)
    }
  }

  // Deshacer SOLO el cierre del día (no toca los movimientos del día).
  const handleDeshacer = async () => {
    if (!parcial && !completo) return
    if (!window.confirm(
      `¿Deshacer el cierre del ${fecha}?\n\n` +
      `Se borran SOLO los datos del cierre y lo que generó (ventas del cierre + retiro + ajuste de diferencia).\n\n` +
      `⚠ NO se borran los pagos a proveedores, gastos ni ingresos manuales del día — esos quedan. ` +
      `Si querés recargar el día desde cero (sin duplicar), usá el botón "Borrar TODO el día".`)) return
    if (!(await requireManager()).ok) return
    setSaving(true); setError(null)
    try {
      await discardCierreDia(fecha)
      setMsg('✓ Cierre deshecho — los movimientos del día se mantienen.')
      await loadCierres(); onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al deshacer')
    } finally { setSaving(false) }
  }

  // Acción EXPLÍCITA y aparte: deshacer el cierre Y borrar TODOS los movimientos del día
  // (para recargar el día de cero sin duplicar pagos). Destructivo — confirmación doble.
  const handleBorrarDia = async () => {
    if (!window.confirm(
      `¿BORRAR TODO el día ${fecha}?\n\n` +
      `Esto borra el cierre, las ventas, el retiro, los PAGOS A PROVEEDORES, gastos, ingresos manuales ` +
      `y los turnos de caja del ${fecha}. Sirve para recargar el día desde cero.\n\n` +
      `NO toca propinas. NO se puede deshacer.`)) return
    const auth = await requireManager()
    if (!auth.ok) return
    setSaving(true); setError(null)
    try {
      await discardDiaCompleto(fecha, auth.managerEmail, auth.managerPassword)
      setMsg('✓ Día borrado completo — podés recargar desde cero.')
      await loadCierres(); onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al borrar el día')
    } finally { setSaving(false) }
  }

  // Pagar un turno de propinas DESDE el cierre — misma vía que Caja Diaria (propinaEgresoFields),
  // a nivel día y con la FECHA DEL CIERRE: la plata sale HOY del físico aunque el turno de
  // propinas sea de un día anterior (así la resta cae en el día correcto). El movimiento salda
  // el pendiente (description = propKey) y la matemática se recalcula sola al refrescar.
  const pagarPropinaCierre = async (p: TipPayoutSummary) => {
    if (!profile || payingProp || saving) return
    if (!window.confirm(`¿PAGAR ahora las propinas de ${shiftLabel(p.shift_type)} del ${formatDate(p.session_date)} por ${fi(p.total_electronico_crc)}?\n\n(Solo el electrónico — el efectivo ya está en mano del equipo.) Se registra el egreso real y se descuenta del cierre.`)) return
    setPayingProp(p.session_id)
    setError(null)
    try {
      await createDayMovement({ created_by: profile.id, ...propinaEgresoFields(p), status: 'aprobado', fecha })
      await loadCierres()   // refresca el libro → lista y matemática se actualizan
      onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo registrar el pago de propinas')
    } finally { setPayingProp(null) }
  }

  // Diferencia US$ del día YA cerrado — derivada del movimiento de Ajuste de cierre (no hay
  // columna diferencia_usd en cash_cierres_dia y NO hace falta migración: el ajuste ES el
  // registro durable; una dif sub-tolerancia (<$1) no genera ajuste y se considera que cuadra).
  const ajusteUsdCerrado = (() => {
    const m = movs.find(m => m.subcategory === 'Ajuste de cierre'
      && (m.description || '').startsWith(`Ajuste de cierre ${fecha}`)
      && (m.amount_usd || 0) !== 0)
    return m ? (m.movement_type === 'ingreso' ? 1 : -1) * (m.amount_usd || 0) : 0
  })()

  if (loading) return <div style={{ padding:'2rem', textAlign:'center', color:'#888' }}>Cargando…</div>

  // ── Propinas del día — la VÍA REAL (una sola fuente de verdad, FIRMADO) ──
  // Plegada por defecto y ubicada DEBAJO de los campos de venta de la fase en curso (Fase 1
  // si el mediodía no está sellado, Fase 2 si ya lo está): las ventas primero, las propinas
  // después. Se renderiza en un solo lugar por vez — las dos ramas son excluyentes.
  const propinasDelDia = (
    <CollapsibleSection
      title={`Propinas del día · ${propinasPorPagar.length} · ${fi2(propinasPorPagarTotal)}`}
      icon="💁" color="#8a5aa8" open={propinasOpen} onToggle={() => setPropinasOpen(o => !o)}>
      <div style={{ fontSize:'0.74rem', color:'#6a6250', marginBottom:'0.6rem' }}>
        Pagadas hoy (movimientos reales): <strong style={{ color:'#8a5aa8' }}>{fi2(propinasPagadasDia)}</strong>.
        Lo que pagués acá crea el egreso real y se descuenta del cierre; lo pendiente <strong>no resta</strong> (la plata sigue en la caja).
      </div>
      {propinasPorPagar.length === 0 ? (
        <div style={{ fontSize:'0.76rem', color:'#8a8272' }}>✓ Sin propinas por pagar.</div>
      ) : propinasPorPagar.map(p => (
        <div key={p.session_id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'0.5rem', padding:'0.45rem 0.25rem', borderBottom:'1px solid var(--t-border, #d4cfc4)' }}>
          <div>
            <div style={{ fontSize:'0.8rem', fontWeight:600 }}>Propinas {shiftLabel(p.shift_type)} · {formatDate(p.session_date)}</div>
            <div style={{ fontSize:'0.68rem', color:'#8a8272' }}>pendiente de pago</div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:'0.6rem' }}>
            <span style={{ fontFamily:"'DM Mono',monospace", fontWeight:700 }}>{fi2(p.total_electronico_crc)}</span>
            <button onClick={() => pagarPropinaCierre(p)} disabled={payingProp !== null || saving}
              className="cierre-btn gold" style={{ padding:'5px 12px', fontSize:'0.74rem', width:'auto' }}>
              {payingProp === p.session_id ? 'Pagando…' : '💵 Pagar ahora'}
            </button>
          </div>
        </div>
      ))}
    </CollapsibleSection>
  )

  return (
    <div className="cierre-tab" style={{ maxWidth:680, margin:'0 auto' }}>

      {/* Date selector */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'1.25rem', flexWrap:'wrap', gap:'0.5rem' }}>
        <div>
          <div style={{ fontSize:'0.95rem', fontWeight:700, letterSpacing:'0.03em' }}>Cierre del día</div>
          <div style={{ fontSize:'0.72rem', color:'#6a6250', marginTop:4, display:'flex', alignItems:'center', gap:'0.4rem' }}>
            <span>TC ₡/$</span>
            <input type="number" min={300} max={900} step={5} value={tc}
              disabled={!!parcial}
              onChange={e => setTc(Number(e.target.value) || tc)}
              title={parcial ? 'Sellado en Fase 1' : 'Tipo de cambio del día'}
              className="cierre-input"
              style={{ width:64, color:'#8a6d1f', padding:'2px 6px', fontSize:'0.74rem', fontFamily:'DM Mono, monospace', opacity: parcial ? 0.6 : 1 }} />
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:'0.5rem' }}>
          {(parcial || completo) && (
            <button onClick={handleDeshacer} disabled={saving} title="Deshacer SOLO el cierre (no borra los movimientos del día)"
              style={{ background:'transparent', border:'1px solid #c23b22', color:'#c23b22', borderRadius:2, padding:'5px 10px', fontSize:'0.76rem', cursor:'pointer' }}>
              ↩ Deshacer cierre
            </button>
          )}
          <button onClick={handleBorrarDia} disabled={saving} title="Deshacer el cierre Y borrar TODOS los movimientos del día (recargar de cero)"
            style={{ background:'#c23b22', border:'none', color:'#fff', borderRadius:2, padding:'5px 10px', fontSize:'0.76rem', cursor:'pointer' }}>
            🗑 Borrar TODO el día
          </button>
          <input type="date" value={fecha} max={today}
            onChange={e => setFecha(e.target.value)}
            className="cierre-input"
            style={{ color:'#8a6d1f', padding:'5px 10px', fontSize:'0.82rem' }} />
        </div>
      </div>

      {turnoAbierto && (
        <div className="cd-warn" style={{ marginBottom:'1rem' }}>
          ℹ Hay un turno de caja abierto{openSession?.cajero_name ? ` (${openSession.cajero_name})` : ''}. Podés sellar el <strong>Mediodía (Fase 1)</strong> igual.
          Para cerrar la <strong>Noche (Fase 2)</strong> sí hay que cerrar antes el turno en <strong>Caja Diaria</strong>.
        </div>
      )}

      {/* Messages */}
      {error && (
        <div className="cierre-hint red" style={{ fontSize:'0.82rem', display:'flex', justifyContent:'space-between' }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{ background:'none', border:'none', color:'#c23b22', cursor:'pointer' }}>✕</button>
        </div>
      )}
      {msg && (
        <div className="cierre-hint green" style={{ fontSize:'0.82rem' }}>{msg}</div>
      )}

      {/* Barra de fases */}
      <div style={{ display:'flex', alignItems:'center', gap:'0.75rem', marginBottom:'1.25rem' }}>
        <div className={`cierre-fase ${parcial ? 'ok' : 'pend'}`}>
          <span style={{ fontSize:'0.9rem' }}>{parcial ? '✅' : '☀️'}</span>
          <span>Fase 1 — Mediodía {parcial ? '(sellado)' : '(pendiente)'}</span>
        </div>
        <span style={{ color:'#b0a890', fontSize:'1rem', flexShrink:0 }}>→</span>
        <div className={`cierre-fase ${completo ? 'ok' : parcial ? 'pend' : 'wait'}`}>
          <span style={{ fontSize:'0.9rem' }}>{completo ? '✅' : '🌙'}</span>
          <span>Fase 2 — Noche {completo ? '(cerrado)' : parcial ? '(en progreso)' : '(esperando)'}</span>
        </div>
      </div>

      {/* ── CIERRE YA COMPLETO ── */}
      {completo && (
        <div style={{ background:'#e8f5ec', border:'2px solid #4a9a6a', borderRadius:2, padding:'1.25rem' }}>
          <div style={{ fontSize:'0.88rem', fontWeight:700, color:'#2a7a4a', marginBottom:'1rem', display:'flex', alignItems:'center', gap:'0.5rem' }}>
            ✅ Día cerrado — {fecha}
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'0.75rem', marginBottom:'1rem' }}>
            {[
              { label:'Remanente CF',    val: completo.remanente_crc,    color:'#8a6d1f' },
              { label:'Caja Diaria mañana', val: completo.sep_diaria_crc, color:'#2a7a4a' },
            ].map(k => (
              <div key={k.label} style={{ background:'#fff', border:'1px solid var(--t-border, #d4cfc4)', padding:'0.75rem', borderRadius:2, textAlign:'center' }}>
                <div style={{ fontSize:'0.6rem', color:'#6a6250', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:4 }}>{k.label}</div>
                <div style={{ fontFamily:"'DM Mono',monospace", fontSize:'1.1rem', fontWeight:800, color:k.color }}>
                  {fi2(k.val)}
                </div>
              </div>
            ))}
            {/* Diferencia — ₡ y US$ discriminadas con signo y color por moneda (verde sobrante /
                rojo faltante); una moneda en 0 no se muestra. ₡ del cierre guardado; US$ derivada
                del movimiento de ajuste (Opción B). Solo presentación — la lógica no cambia. */}
            <div style={{ background:'#fff', border:'1px solid var(--t-border, #d4cfc4)', padding:'0.75rem', borderRadius:2, textAlign:'center' }}>
              <div style={{ fontSize:'0.6rem', color:'#6a6250', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:4 }}>Diferencia</div>
              {completo.diferencia_crc === 0 && ajusteUsdCerrado === 0 ? (
                <div style={{ fontFamily:"'DM Mono',monospace", fontSize:'0.9rem', fontWeight:700, color:'#2a7a4a' }}>✓ Sin diferencia</div>
              ) : (
                <>
                  {completo.diferencia_crc !== 0 && (
                    <div style={{ fontFamily:"'DM Mono',monospace", fontSize:'1.1rem', fontWeight:800, color: completo.diferencia_crc < 0 ? '#c23b22' : '#2a7a4a' }}>
                      {completo.diferencia_crc >= 0 ? '+' : ''}{fi2(completo.diferencia_crc)}
                    </div>
                  )}
                  {ajusteUsdCerrado !== 0 && (
                    <div style={{ fontFamily:"'DM Mono',monospace", fontSize: completo.diferencia_crc !== 0 ? '0.82rem' : '1.1rem', fontWeight:800, color: ajusteUsdCerrado < 0 ? '#c23b22' : '#2a7a4a', marginTop: completo.diferencia_crc !== 0 ? 2 : 0 }}>
                      US$ {ajusteUsdCerrado >= 0 ? '+' : ''}{ajusteUsdCerrado.toFixed(2)}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
          {completo.notas && (
            <div style={{ fontSize:'0.78rem', color:'#6a6250', padding:'0.5rem 0.75rem', background:'var(--t-panel, #ede8de)', borderRadius:2 }}>
              📝 {completo.notas}
            </div>
          )}
        </div>
      )}

      {/* ── FASE 1: Mediodía ── */}
      {!completo && (
        <>
          {!parcial ? (
            /* Formulario Fase 1 */
            <Section title="Ventas mediodía" icon="☀️" color="#8a6d1f">
              <Row2>
                <Field label="Ventas PoS ₡">
                  <MontoInput prefix="₡" value={vmCRC} onChange={setVmCRC} />
                </Field>
                <Field label={`Dólares físicos $ → ₡${N(vmUSD) > 0 ? (N(vmUSD)*tc).toLocaleString('es-CR') : '—'}`}>
                  <MontoInput prefix="$" value={vmUSD} onChange={setVmUSD} />
                </Field>
              </Row2>
              {(N(vmCRC) > 0 || N(vmUSD) > 0) && (
                <div className="cierre-hint gold">
                  Efectivo real ₡ (ventas − dólares): <strong>{fi2(efRealM)}</strong>
                  {N(vmUSD) > 0 && <span style={{ color:'#6a6250' }}> · dólares físicos: <strong>${N(vmUSD).toFixed(2)}</strong></span>}
                </div>
              )}
              {/* Propinas: ya NO se tipean — se pagan por la vía real (sección "Propinas del día")
                  y acá se muestra lo efectivamente pagado, que es lo que resta del neto. */}
              <Row2>
                <Field label="Propinas pagadas ₡ (vía real — se sella con la Fase 1)">
                  <div className="cierre-monto" style={{ height:38, alignItems:'center', display:'flex', padding:'0 10px', fontFamily:"'DM Mono',monospace", fontWeight:700, color:'#8a5aa8' }}>
                    {fi2(propinasPagadasDia)}
                  </div>
                </Field>
                <div />
              </Row2>
              {ventasMCeroReal && (
                <label style={{ display:'flex', alignItems:'flex-start', gap:'0.5rem', padding:'0.6rem 0.75rem', background:'#fdf6e3', border:'1px solid #d8b84a', borderRadius:2, fontSize:'0.78rem', color:'#6a5320', cursor:'pointer', marginTop:'0.25rem' }}>
                  <input type="checkbox" checked={confirmVentasCeroM} onChange={e => setConfirmVentasCeroM(e.target.checked)} style={{ marginTop:2, flexShrink:0 }} />
                  <span>Confirmo que las ventas del turno fueron <strong>₡0</strong> — no es un error de carga.</span>
                </label>
              )}
              {/* Sin `turnoAbierto` en el disabled: la Fase 1 se sella con la caja operando. */}
              <button
                onClick={handleConfirmParcial} disabled={saving || (ventasMCeroReal && !confirmVentasCeroM)}
                className="cierre-btn gold" style={{ marginTop:'0.75rem' }}>
                💾 Confirmar cierre mediodía → sellar Fase 1
              </button>
            </Section>
          ) : (
            /* Mediodía sellado */
            <div className="cierre-card" style={{ marginBottom:'1rem' }}>
              <div className="cierre-card-head" style={{ justifyContent:'space-between' }}>
                <div style={{ display:'flex', alignItems:'center', gap:'0.5rem' }}>
                  <span>🔒</span>
                  <div>
                    <div style={{ fontSize:'0.82rem', fontWeight:600, color:'var(--t-ink, #0d0d0d)' }}>Ventas mediodía — sellado</div>
                    <div style={{ fontSize:'0.65rem', color:'#8a8272' }}>Registrado · no editable</div>
                  </div>
                </div>
                <span style={{ fontSize:'0.65rem', color:'#2a7a4a', background:'#e8f5ec', padding:'2px 8px', borderRadius:10, border:'1px solid #b0d8b8' }}>✓ Confirmado</span>
              </div>
              {[
                { l:'Ventas PoS ₡', v: fi2(parcial.vm_crc) },
                { l:'Dólares $',    v: '$' + parcial.vm_usd.toFixed(2) },
                { l:'Efectivo real ₡', v: fi2(parcial.ef_real_m_crc) },
                { l:'Propinas ₡',   v: fi2(parcial.propinas_m_crc) },
                parcial.otros_m_crc > 0 ? { l:'Otros egresos ₡', v: fi2(parcial.otros_m_crc) } : null,
              ].filter(Boolean).map((row, i) => (
                <div key={i} className="cierre-kv">
                  <span className="lbl">{(row as {l:string;v:string}).l}</span>
                  <span className="val">{(row as {l:string;v:string}).v}</span>
                </div>
              ))}
              <div className="cierre-kv total">
                <span style={{ color:'#6a6250', fontSize:'0.68rem', textTransform:'uppercase', letterSpacing:'0.08em' }}>Efectivo neto mediodía</span>
                <span style={{ fontFamily:"'DM Mono',monospace", fontSize:'0.9rem', fontWeight:700, color:'#8a6d1f' }}>
                  {fi2((parcial.ef_real_m_crc||0) - (parcial.propinas_m_crc||0) - (parcial.otros_m_crc||0))}
                </span>
              </div>
            </div>
          )}

          {/* Propinas del día, debajo de las ventas de la Fase 1 (mientras sea la fase en curso) */}
          {!parcial && propinasDelDia}

          {/* ── FASE 2: Noche (solo si Fase 1 cerrada) ── */}
          {parcial && (
            <>
              <Section title="Ventas noche" icon="🌙" color="#3a7794">
                <Row2>
                  <Field label="Ventas PoS ₡">
                    <MontoInput prefix="₡" value={vnCRC} onChange={setVnCRC} />
                  </Field>
                  <Field label={`Dólares $ → ₡${N(vnUSD) > 0 ? (N(vnUSD)*tc).toLocaleString('es-CR') : '—'}`}>
                    <MontoInput prefix="$" value={vnUSD} onChange={setVnUSD} />
                  </Field>
                </Row2>
                {(N(vnCRC) > 0 || N(vnUSD) > 0) && (
                  <div className="cierre-hint blue">
                    Efectivo real ₡ (ventas − dólares): <strong>{fi2(efRealN)}</strong>
                    {N(vnUSD) > 0 && <span style={{ color:'#6a6250' }}> · dólares físicos: <strong>${N(vnUSD).toFixed(2)}</strong></span>}
                  </div>
                )}
                {ventasNCeroReal && (
                  <label style={{ display:'flex', alignItems:'flex-start', gap:'0.5rem', padding:'0.6rem 0.75rem', background:'#fdf6e3', border:'1px solid #d8b84a', borderRadius:2, fontSize:'0.78rem', color:'#6a5320', cursor:'pointer', marginBottom:'0.6rem' }}>
                    <input type="checkbox" checked={confirmVentasCeroN} onChange={e => setConfirmVentasCeroN(e.target.checked)} style={{ marginTop:2, flexShrink:0 }} />
                    <span>Confirmo que las ventas del turno fueron <strong>₡0</strong> — no es un error de carga.</span>
                  </label>
                )}
                <Row2>
                  {/* Pierna N = pagadas por la vía real DESPUÉS del sellado de Fase 1. */}
                  <Field label="Propinas pagadas tras Fase 1 ₡ (vía real)">
                    <div className="cierre-monto" style={{ height:38, alignItems:'center', display:'flex', padding:'0 10px', fontFamily:"'DM Mono',monospace", fontWeight:700, color:'#8a5aa8' }}>
                      {fi2(propNLeg)}
                    </div>
                  </Field>
                  <Field label="Retiro dueños → banco ₡">
                    <MontoInput prefix="₡" value={retiroN} onChange={setRetiroN} />
                  </Field>
                </Row2>
                {N(retiroN) > 0 && (
                  <div className="cierre-hint red" style={{ padding:'0.4rem 0.7rem', fontSize:'0.72rem', marginTop:'-0.25rem', marginBottom:'0.5rem' }}>
                    Retiro de dueños a banco: <strong>−{fi2(N(retiroN))}</strong> · queda registrado como egreso (Retiro de socios) en Movimientos.
                  </div>
                )}
              </Section>

              {/* Propinas del día, debajo de las ventas de la Fase 2 (la fase en curso) */}
              {propinasDelDia}

              {/* Separaciones */}
              <Section title="Conteo físico — separaciones" icon="📊" color="#2a7a4a">
                <div style={{ fontSize:'0.72rem', color:'#6a6250', marginBottom:'0.75rem' }}>
                  Juntá todo el efectivo, separás las asignaciones y contás el remanente de Caja Fuerte.
                </div>
                <table className="cierre-table">
                  <thead>
                    <tr>
                      <th />
                      <th>₡ Colones</th>
                      <th>$ Dólares</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { label:'Caja Diaria mañana', sub:'separación día siguiente', color:'#2a7a4a', crc:sepDiariaCRC, setCRC:setSepDiariaCRC, usd:sepDiariaUSD, setUSD:setSepDiariaUSD },
                      { label:'Caja Registradora',  sub:'para vuelto mañana',       color:'#6a6250', crc:sepRegCRC,    setCRC:setSepRegCRC,    usd:sepRegUSD,    setUSD:setSepRegUSD    },
                      { label:'Remanente CF',        sub:'queda en Caja Fuerte',     color:'#8a5aa8', crc:remCRC,       setCRC:setRemCRC,       usd:remUSD,       setUSD:setRemUSD       },
                    ].map(row => (
                      <tr key={row.label} style={{ background: row.color === '#8a5aa8' ? 'rgba(138,90,168,.06)' : undefined }}>
                        <td style={{ padding:'0.625rem 0.75rem' }}>
                          <div style={{ fontSize:'0.8rem', fontWeight:600, color:row.color }}>{row.label}</div>
                          <div style={{ fontSize:'0.65rem', color:'#8a8272', marginTop:1 }}>{row.sub}</div>
                        </td>
                        <td style={{ padding:'0.3rem 0.5rem' }}>
                          <MontoInput prefix="₡" value={row.crc} onChange={row.setCRC} compact />
                        </td>
                        <td style={{ padding:'0.3rem 0.5rem' }}>
                          <MontoInput prefix="$" value={row.usd} onChange={row.setUSD} compact />
                        </td>
                      </tr>
                    ))}
                    <tr className="total">
                      <td style={{ padding:'0.625rem 0.75rem', fontSize:'0.78rem', color:'#6a6250' }}>Total contado</td>
                      <td style={{ padding:'0.625rem 0.5rem', fontFamily:"'DM Mono',monospace", fontSize:'0.95rem', fontWeight:800, color:'#2a7a4a', textAlign:'center' }}>
                        {totalContadoCRC > 0 ? fi2(totalContadoCRC) : '—'}
                      </td>
                      <td style={{ padding:'0.625rem 0.5rem', fontFamily:"'DM Mono',monospace", fontSize:'0.95rem', fontWeight:800, color:'#2a7a4a', textAlign:'center' }}>
                        {totalContadoUSD > 0 ? `$${totalContadoUSD.toFixed(2)}` : '—'}
                      </td>
                    </tr>
                  </tbody>
                </table>

                {/* Verificación */}
                {totalContadoCRC > 0 && (
                  <>
                    <div className="cierre-resumen">
                      <div className="cierre-resumen-header">Verificación — Cierre del Día</div>
                      <div className="cierre-resumen-cols">
                        <span />
                        <span>₡ Colones</span>
                        <span>US$</span>
                      </div>
                      <div className="cierre-resumen-row">
                        <span className="lbl">Saldo Caja Fuerte (según sistema)</span>
                        <span className="val">{fi2(saldoBase.crc)}</span>
                        <span className="val">${saldoBase.usd.toFixed(2)}</span>
                      </div>
                      <div className="cierre-resumen-row">
                        <span className="lbl">+ Mediodía neto</span>
                        <span className="val">{fi2(netoM)}</span>
                        <span className="val">${vmUSDFromParcial.toFixed(2)}</span>
                      </div>
                      <div className="cierre-resumen-row">
                        <span className="lbl">+ Noche neto</span>
                        <span className="val">{fi2(netoN)}</span>
                        <span className="val">${N(vnUSD).toFixed(2)}</span>
                      </div>
                      <div className="cierre-resumen-row destacada">
                        <span className="lbl">= Debería quedar en Caja Fuerte</span>
                        <span className="val">{fi2(deberia)}</span>
                        <span className="val">${deberiaUSD.toFixed(2)}</span>
                      </div>
                      <div className="cierre-resumen-row">
                        <span className="lbl">Total contado (conteo físico)</span>
                        <span className="val">{fi2(totalContadoCRC)}</span>
                        <span className="val">${totalContadoUSD.toFixed(2)}</span>
                      </div>
                    </div>
                    <div className={`cd-cierre-resultado ${cuadra ? 'ok' : 'fail'}`}>
                      <span>{cuadra ? '✅ Cuadra correctamente (₡)' : `⚠️ Diferencia ₡: ${diferencia! >= 0 ? '+' : ''}${fi2(diferencia ?? 0)}`}</span>
                    </div>
                    {deberiaUSD > 0 && (
                      <div className={`cierre-resumen-usd ${cuadraUSD ? 'ok' : 'fail'}`}>
                        Dólares: debería ${deberiaUSD.toFixed(2)} · contado ${totalContadoUSD.toFixed(2)}
                        {cuadraUSD ? ' ✅' : ` ⚠️ ${difUSD! >= 0 ? '+' : ''}$${(difUSD ?? 0).toFixed(2)}`}
                      </div>
                    )}
                  </>
                )}

                {/* Ajuste obligatorio si hay diferencia */}
                {requiresAjuste && (
                  <div style={{ background:'#fdf0ee', border:'2px solid #c23b22', borderRadius:2, padding:'0.875rem', marginBottom:'0.75rem' }}>
                    <div style={{ fontSize:'0.82rem', fontWeight:700, color:'#c23b22', marginBottom:'0.4rem' }}>
                      ⚠ Diferencia detectada — registrá el motivo para cerrar
                    </div>
                    {/* Ambas monedas con la MISMA jerarquía (columnas moneda | monto), cada una con
                        signo — solo las que superan su tolerancia (misma condición de siempre). */}
                    <div style={{ display:'grid', gridTemplateColumns:'6em 1fr', rowGap:4, alignItems:'baseline', marginBottom:'0.75rem' }}>
                      {diferencia !== null && !cuadra && (
                        <>
                          <span style={{ fontSize:'0.66rem', color:'#8a5040', textTransform:'uppercase', letterSpacing:'0.1em' }}>₡ Colones</span>
                          <span style={{ fontFamily:"'DM Mono',monospace", fontSize:'0.95rem', fontWeight:800, color:'#c23b22' }}>
                            {diferencia >= 0 ? '+' : ''}{fi2(diferencia)}
                          </span>
                        </>
                      )}
                      {difUSD !== null && !cuadraUSD && (
                        <>
                          <span style={{ fontSize:'0.66rem', color:'#8a5040', textTransform:'uppercase', letterSpacing:'0.1em' }}>US$ Dólares</span>
                          <span style={{ fontFamily:"'DM Mono',monospace", fontSize:'0.95rem', fontWeight:800, color:'#c23b22' }}>
                            {difUSD >= 0 ? '+' : ''}${difUSD.toFixed(2)}
                          </span>
                        </>
                      )}
                    </div>
                    <div style={{ fontSize:'0.68rem', color:'#8a5040', marginBottom:'0.75rem' }}>
                      Al confirmar, la diferencia queda registrada como movimiento de <strong>Ajuste de cierre</strong> en Caja Fuerte (faltante resta · sobrante suma) — el saldo del sistema arranca mañana del físico contado.
                    </div>
                    <div style={{ display:'grid', gridTemplateColumns:'160px 1fr', gap:'0.5rem', alignItems:'end' }}>
                      <Field label="Tipo">
                        <select value={ajusteTipo} onChange={e => setAjusteTipo(e.target.value)}
                          className="cierre-input" style={{ width:'100%', padding:'6px 8px', fontSize:'0.82rem' }}>
                          <option>Faltante</option><option>Sobrante</option><option>Error cobro</option><option>Otro</option>
                        </select>
                      </Field>
                      <Field label="Motivo *">
                        <input value={ajusteMotivo} onChange={e => setAjusteMotivo(e.target.value)}
                          placeholder="Descripción obligatoria…"
                          className="cierre-input"
                          style={{ width:'100%', padding:'6px 10px', fontSize:'0.82rem', ...(ajusteMotivo ? {} : { border:'1px solid #c23b22' }) }} />
                      </Field>
                    </div>
                  </div>
                )}
              </Section>

              {/* Notas + Confirmar */}
              <div style={{ marginBottom:'0.75rem' }}>
                <Field label="Notas del cierre">
                  <input value={notas} onChange={e => setNotas(e.target.value)}
                    placeholder="Observaciones, incidentes…"
                    className="cierre-input" style={{ width:'100%', padding:'6px 10px', fontSize:'0.82rem' }} />
                </Field>
              </div>

              <button
                onClick={() => setShowResumen(true)}
                disabled={saving || turnoAbierto || ventasNVacias || (ventasNCeroReal && !confirmVentasCeroN) || totalContadoCRC === 0 || (requiresAjuste && !ajusteMotivo.trim())}
                className="cierre-btn green">
                👁 Revisar resumen y cerrar el día →
              </button>
            </>
          )}
        </>
      )}

      {/* ── CAMBIO B: resumen del cierre ANTES de confirmar (solo lectura; nada se recalcula) ── */}
      {showResumen && parcial && !completo && (
        <div className="cd-modal-overlay" onClick={() => setShowResumen(false)}>
          <div className="cd-modal" onClick={e => e.stopPropagation()}>
            <div className="cd-modal-title">Resumen del cierre del día</div>
            <div className="cd-modal-meta">{fecha} · TC ₡{tc.toLocaleString('es-CR')} · revisá antes de confirmar</div>

            {/* Ventas + propinas pagadas */}
            <div className="cd-resumen-block">
              <div className="cd-resumen-row">
                <span>Ventas Mediodía</span>
                <strong>{fi2(parcial.vm_crc)}{parcial.vm_usd > 0 ? ` · $${parcial.vm_usd.toFixed(2)}` : ''}</strong>
              </div>
              <div className="cd-resumen-row">
                <span>Ventas Noche</span>
                <strong>{fi2(N(vnCRC))}{N(vnUSD) > 0 ? ` · $${N(vnUSD).toFixed(2)}` : ''}</strong>
              </div>
              {propinasPagadasDia > 0 && (
                <div className="cd-resumen-row">
                  <span>Propinas pagadas en el cierre</span>
                  <strong style={{ color:'#8a5aa8' }}>− {fi2(propinasPagadasDia)}</strong>
                </div>
              )}
            </div>

            {/* Distribución del conteo físico */}
            <div className="cd-resumen-block">
              <div className="cd-resumen-row">
                <span>Caja Diaria mañana</span>
                <strong style={{ color:'#2a7a4a' }}>{fi2(N(sepDiariaCRC))}{N(sepDiariaUSD) > 0 ? ` · $${N(sepDiariaUSD).toFixed(2)}` : ''}</strong>
              </div>
              <div className="cd-resumen-row">
                <span>Caja Registradora</span>
                <strong>{fi2(N(sepRegCRC))}{N(sepRegUSD) > 0 ? ` · $${N(sepRegUSD).toFixed(2)}` : ''}</strong>
              </div>
              <div className="cd-resumen-row">
                <span>Remanente CF</span>
                <strong style={{ color:'#8a6d1f' }}>{fi2(N(remCRC))}{N(remUSD) > 0 ? ` · $${N(remUSD).toFixed(2)}` : ''}</strong>
              </div>
              <div className="cd-resumen-row total">
                <span>Total contado</span>
                <strong>{fi2(totalContadoCRC)}{totalContadoUSD > 0 ? ` · $${totalContadoUSD.toFixed(2)}` : ''}</strong>
              </div>
            </div>

            {/* Diferencia / ajuste (ya calculado) */}
            {requiresAjuste ? (
              <div className="cd-cierre-resultado fail" style={{ marginBottom:'1rem', flexDirection:'column', alignItems:'flex-start', gap:'0.25rem' }}>
                <span>⚠ Ajuste: {ajusteTipo}{ajusteMotivo.trim() ? ` — ${ajusteMotivo.trim()}` : ''}</span>
                <span>
                  {diferencia !== null && !cuadra ? `${diferencia >= 0 ? '+' : ''}${fi2(diferencia)}` : ''}
                  {difUSD !== null && !cuadraUSD ? `${diferencia !== null && !cuadra ? ' · ' : ''}US$ ${difUSD >= 0 ? '+' : ''}${difUSD.toFixed(2)}` : ''}
                </span>
              </div>
            ) : (
              <div className="cd-cierre-resultado ok" style={{ marginBottom:'1rem' }}>
                <span>✅ Cuadra — sin diferencia</span>
              </div>
            )}

            {notas.trim() && <div className="cd-modal-note">📝 {notas.trim()}</div>}

            <div className="cd-modal-actions">
              <button className="tips-btn-ghost" onClick={() => setShowResumen(false)}>Volver a editar</button>
              <button className="cd-btn-green" disabled={saving}
                onClick={() => { setShowResumen(false); handleConfirmCompleto() }}>
                {saving ? 'Cerrando…' : '✓ CONFIRMAR CIERRE DEL DÍA'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────
function Section({ title, icon, color, children }: { title:string; icon:string; color:string; children: React.ReactNode }) {
  return (
    <div className="cierre-card">
      <div className="cierre-card-head">
        <span style={{ fontSize:'1.1rem' }}>{icon}</span>
        <div style={{ fontSize:'0.85rem', fontWeight:600, color }}>{title}</div>
      </div>
      <div className="cierre-card-body">{children}</div>
    </div>
  )
}

// Igual que Section pero plegable — el encabezado resume (cantidad · total) y el cuerpo
// se despliega a pedido. Estado en memoria (lo maneja el padre), sin storage.
function CollapsibleSection({ title, icon, color, open, onToggle, children }: {
  title:string; icon:string; color:string; open:boolean; onToggle:() => void; children: React.ReactNode
}) {
  return (
    <div className="cierre-card">
      <button type="button" className="cierre-card-head" aria-expanded={open} onClick={onToggle}
        style={{ width:'100%', font:'inherit', textAlign:'left', cursor:'pointer', border:'none',
                 borderBottom: open ? '1px solid var(--t-border, #d4cfc4)' : 'none' }}>
        <span style={{ fontSize:'1.1rem' }}>{icon}</span>
        <div style={{ fontSize:'0.85rem', fontWeight:600, color, flex:1 }}>{title}</div>
        <span style={{ color:'#8a8272', fontSize:'0.8rem' }}>{open ? '▼' : '▶'}</span>
      </button>
      {open && <div className="cierre-card-body">{children}</div>}
    </div>
  )
}

function Row2({ children }: { children: React.ReactNode }) {
  return <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.625rem', marginBottom:'0.75rem' }}>{children}</div>
}

function Field({ label, children }: { label:string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize:'0.65rem', color:'#6a6250', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:4 }}>{label}</div>
      {children}
    </div>
  )
}

function MontoInput({ prefix, value, onChange, compact }: {
  prefix: string; value: number|''; onChange: (v: number|'') => void; compact?: boolean
}) {
  return (
    <div className="cierre-monto" style={{ height: compact ? 34 : 38 }}>
      <span className="pfx" style={{ fontSize: compact ? '0.72rem' : '0.82rem' }}>{prefix}</span>
      <input
        type="number" min={0} step={100} value={value}
        onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        style={{ fontSize: compact ? '0.82rem' : '0.9rem' }}
        placeholder="0"
      />
    </div>
  )
}
