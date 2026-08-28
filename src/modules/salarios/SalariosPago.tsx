import { useState, useEffect, useCallback, useMemo } from 'react'
import type { Employee, EmployeePayment, PunchException, SalaryPeriod, SalaryPeriodEstado, WorkDay } from '../../shared/types/database'
import {
  getSalaryPeriods, createSalaryPeriod, getWorkDays, upsertWorkDay,
  getPeriodPayments, markPeriodPaid, consolidarPeriodo, getPunchExceptionsTodosLosLocales,
  semaforoPago, inactivosConHoras, HORAS_DEFAULT_IMPAR, LOCAL_DEFAULT,
  setPeriodoEnRevision, cerrarPeriodo, reabrirPeriodo,
  estaCongelado, motivoBloqueoExcepciones, avisoHorasDefault, ESTADO_LABEL,
  ingresoTotalDe, aPagarDe,
  // 10% de SERVICIO (v3): el reparto vive en SALARIOS. `tipCalculations` es el pozo de
  // propinas y no se toca — son tres conceptos distintos (ver el bloque en salarios.ts).
  getServicioPorDia, servicioDelPeriodo, diasDelPeriodo, participaServicio,
  autoDerivarSiVacio, type DerivacionResumen,
  PARTICIPA_SERVICIO_DEFAULT,
  type LineaConsolidado, type ServicioPeriodo,
} from '../../shared/api/salarios'
import { getTipPayoutsPorEmpleado } from '../../shared/api/tips'
import {
  downloadPlanillaXlsx, planillaFileName, CONCEPTO_SALARIOS_DEFAULT,
} from '../../shared/utils/planillaBanco'
import { fi, todayCR } from '../../shared/utils'
import { useAuth } from '../../shared/hooks/useAuth'

// Salarios · U0b (MVP): el ciclo mínimo de pago en una sola pantalla —
// cargar horas del período → ver el neto → bajar el archivo del banco → marcar pagado.
//
// Lo que NO hace (a propósito, va en los pases siguientes): horas automáticas de BioTime
// (F1d), comprobante por WhatsApp o email, y datos bancarios completos. El pago NO toca caja.
//
// LOS TRES CONCEPTOS de esta pantalla, que NO se mezclan:
//   · TOTAL HORAS (₡)  → horas × tarifa + fijo. Se transfiere.
//   · 10% DE SERVICIO  → cargo de salón/barra repartido por horas. TAMBIÉN se transfiere,
//                        junto con las horas. NO es IVA (eso es un impuesto y va en la
//                        factura) y NO es propina.
//   · PROPINAS         → pozo del módulo Propinas, hoy solo efectivo. NO va al banco.
// A pagar = horas + 10% de servicio. Ingreso total = eso + propinas (informativo).

// El estado del período de un vistazo. `cerrado` va en ámbar a propósito: no es un
// final (todavía falta pagar), es "esto ya no se toca".
// El ciclo, en orden. Es la misma secuencia que declara `TRANSICIONES` en la API: acá
// solo se dibuja.
const CICLO: SalaryPeriodEstado[] = ['abierto', 'en_revision', 'cerrado', 'pagado']

// CCSS: PLACEHOLDER declarado. No es el porcentaje real (patrono + obrero) y no está en
// el camino del pago al banco — solo en el bloque gerencial de costo laboral. Se ajusta
// cuando el contador firme la base.
const CCSS_PLACEHOLDER = 0.26

const COLOR_ESTADO: Record<string, string> = {
  abierto:     '#888',
  en_revision: '#8a6d3b',
  cerrado:     '#8a6d3b',
  pagado:      'var(--t-teal)',
}

// Filtro de local (v3 "Local primero"). El dato existe en `work_days.local`; en
// `employees` NO hay columna de local, así que el filtro vive donde el dato vive: sobre
// las HORAS del período, no sobre la ficha de la persona.
type LocalFiltro = 'todos' | 'santa-teresa' | 'nosara'
const LOCAL_FILTROS: LocalFiltro[] = ['todos', 'santa-teresa', 'nosara']
const LOCAL_LABEL: Record<LocalFiltro, string> = {
  'todos':        'Todos',
  'santa-teresa': 'Santa Teresa',
  'nosara':       'Nosara',
}

// El texto del input a número, tolerando el campo a medio escribir.
function num(s: string): number {
  const n = Number(String(s).replace(/[^\d.-]/g, ''))
  return isNaN(n) ? 0 : n
}

interface Props {
  employees: Employee[]
}

export default function SalariosPago({ employees }: Props) {
  const { user, profile } = useAuth()
  // Registrar el pago es evento de plata: la RLS de la mig 056 lo deja solo a
  // owner/manager. El contador arma la nómina y baja el archivo, pero no paga.
  const puedePagar = profile?.role === 'owner' || profile?.role === 'manager'
  // Mover el período por su ciclo (revisar / cerrar / reabrir) NO es plata: es el trabajo
  // del que arma la nómina, y el contador es justamente quien lo hace.
  const puedeCerrar = puedePagar || profile?.role === 'contador'

  const [periods, setPeriods]   = useState<SalaryPeriod[]>([])
  const [periodId, setPeriodId] = useState<string>('')
  const [workDays, setWorkDays] = useState<WorkDay[]>([])
  const [pagos, setPagos]       = useState<EmployeePayment[]>([])
  // F1d: el estado del fichaje del período. La lectura es null-safe (devuelve [] si la
  // tabla no está o la RLS dice que no), así que no puede tumbar esta pantalla — solo
  // puede FRENAR el pago, nunca habilitarlo por error.
  const [excs, setExcs] = useState<PunchException[]>([])
  // Destrabe explícito del único caso que sí frena: horas contadas dos veces.
  const [okDobles, setOkDobles] = useState(false)
  // Propinas del período por empleado. SOLO PARA MOSTRAR: no entran al neto, ni al archivo
  // del banco, ni a `markPeriodPaid`. Su error vive aparte del de la pantalla — que no se
  // puedan leer no puede frenar una nómina, pero tampoco puede disfrazarse de ₡0.
  const [propinas, setPropinas] = useState<Map<string, number>>(new Map())
  const [errPropinas, setErrPropinas] = useState<string | null>(null)

  // 10% de SERVICIO del período: `fecha → servicio cobrado ese día`, leído de las ventas
  // ya cargadas (SOLO LECTURA). `null` = TODAVÍA NO SE PUEDE SABER, que no es ₡0: con
  // null la columna va en "—" y "A pagar" queda en solo horas, en vez de inventar un monto.
  const [servicioDia, setServicioDia] = useState<Map<string, number> | null>(null)
  const [errServicio, setErrServicio] = useState<string | null>(null)
  // v3 · resumen de la derivación automática al abrir un período vivo y vacío.
  const [autoDeriv, setAutoDeriv] = useState<DerivacionResumen | null>(null)

  // v3 · "Local primero". Es un filtro de VISTA sobre las horas: el pay run es global, así
  // que con un local elegido se puede mirar y comparar, pero no pagar (ver `alcanceParcial`).
  const [localFiltro, setLocalFiltro] = useState<LocalFiltro>('todos')

  const [concepto, setConcepto] = useState(CONCEPTO_SALARIOS_DEFAULT)
  // Borradores por empleado. Las horas se persisten (work_days); el neto pisado a mano
  // vive solo en la pantalla hasta que se exporta o se marca pagado — ahí queda
  // congelado en employee_payments.monto_neto.
  const [horasDraft, setHorasDraft] = useState<Record<string, string>>({})
  const [netoDraft, setNetoDraft]   = useState<Record<string, string>>({})

  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [aviso, setAviso]     = useState<string | null>(null)

  // Alta de período
  const [showForm, setShowForm] = useState(false)
  const [newTipo, setNewTipo]   = useState<'quincena' | 'adhoc'>('quincena')
  const [newIni, setNewIni]     = useState(todayCR())
  const [newFin, setNewFin]     = useState(todayCR())

  // Reapertura: el motivo es obligatorio y viaja a la fila del período (mig 056).
  const [reabriendo, setReabriendo]   = useState(false)
  const [motivoReab, setMotivoReab]   = useState('')

  const period    = periods.find(p => p.id === periodId) ?? null
  const estado    = period?.estado ?? 'abierto'
  const pagado    = estado === 'pagado'
  // `cerrado` y `pagado` congelan el período: horas y netos dejan de editarse hasta que
  // alguien lo reabra con motivo. Es la promesa que hace cerrar, y sin esto es una etiqueta.
  const congelado = period != null && estaCongelado(estado)

  const loadPeriods = useCallback(async () => {
    try {
      const ps = await getSalaryPeriods()
      setPeriods(ps)
      setPeriodId(prev => prev || (ps[0]?.id ?? ''))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando los períodos')
    } finally {
      setLoading(false)
    }
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadPeriods() }, [loadPeriods])

  // Datos del período elegido: horas, tarifas vigentes a su fecha de fin y pagos ya hechos.
  const loadPeriodData = useCallback(async (p: SalaryPeriod | null) => {
    if (!p) {
      setWorkDays([]); setPagos([]); setExcs([]); setOkDobles(false); setAutoDeriv(null)
      setPropinas(new Map()); setErrPropinas(null)
      setServicioDia(null); setErrServicio(null)
      return
    }
    // Las propinas van por su propio try: son informativas, así que su fallo no puede
    // tumbar la carga del período (que es la que arma el pago).
    getTipPayoutsPorEmpleado(p.fecha_ini, p.fecha_fin)
      .then(m => { setPropinas(m); setErrPropinas(null) })
      .catch(e => {
        setPropinas(new Map())
        setErrPropinas(e instanceof Error ? e.message : 'No se pudieron leer las propinas del período')
      })
    // El servicio también va aparte, pero por el motivo CONTRARIO: sí es plata que se
    // transfiere. Si no se puede leer, la pantalla lo dice y paga solo las horas — nunca
    // rellena el 10% con un número inventado ni frena la nómina entera por él.
    getServicioPorDia(p.fecha_ini, p.fecha_fin)
      .then(m => { setServicioDia(m); setErrServicio(null) })
      .catch(e => {
        setServicioDia(null)
        setErrServicio(e instanceof Error ? e.message : 'No se pudo leer el servicio del período')
      })
    try {
      let [wd, pg, ex] = await Promise.all([
        getWorkDays(p.fecha_ini, p.fecha_fin),
        getPeriodPayments(p.id),
        // TODOS los locales: el neto del período suma las horas de cualquier local
        // (el pay run es global), así que el semáforo tiene que mirar el mismo conjunto.
        getPunchExceptionsTodosLosLocales(p.fecha_ini, p.fecha_fin),
      ])
      // v3 · un período VIVO que abre sin una sola hora deriva solo (mismas guardas que
      // en Horas: nada de períodos congelados, nada de pisar horas manuales, y si falla
      // devuelve null sin tumbar la pantalla que mueve la plata).
      const auto = await autoDerivarSiVacio(p, wd, LOCAL_DEFAULT)
      setAutoDeriv(auto)
      if (auto) {
        [wd, ex] = await Promise.all([
          getWorkDays(p.fecha_ini, p.fecha_fin),
          getPunchExceptionsTodosLosLocales(p.fecha_ini, p.fecha_fin),
        ])
      }
      setWorkDays(wd)
      setPagos(pg)
      setExcs(ex)
      setOkDobles(false)
      setHorasDraft({})
      setNetoDraft({})
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando el período')
    }
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadPeriodData(period) }, [loadPeriodData, period])

  // Solo activos: un inactivo conserva su historial pero no entra a una nómina nueva.
  const activos = useMemo(() => employees.filter(e => e.is_active), [employees])

  // El semáforo del fichaje: qué avisa, qué pide confirmación y qué frena. La regla de
  // las 3 h (mig 059) le sacó el filo a los impares —esos días ya valen algo—, así que
  // lo único que frena de verdad es la doble carga de horas.
  const semaforo = useMemo(
    () => (period ? semaforoPago(excs, workDays, period.fecha_fin, activos.map(e => e.id))
                  : semaforoPago([], [], '', [])),
    [excs, workDays, period, activos],
  )
  const nombresDobles = useMemo(
    () => semaforo.dobles.map(id => employees.find(e => e.id === id)?.full_name ?? id),
    [semaforo.dobles, employees],
  )
  const frenado = semaforo.dobles.length > 0 && !okDobles

  // Espejo en pantalla del guard que la API aplica igual (`cerrarPeriodo` /
  // `markPeriodPaid` releen el semáforo de la base antes de escribir). Acá es para que el
  // botón diga POR QUÉ está apagado en vez de rebotar recién al apretarlo.
  const bloqueoCerrar = useMemo(
    () => (period ? motivoBloqueoExcepciones(semaforo, 'cerrar') : null),
    [period, semaforo],
  )
  const bloqueoPagar = useMemo(
    () => (period ? motivoBloqueoExcepciones(semaforo, 'pagar') : null),
    [period, semaforo],
  )
  // A8 · las horas que no midió el reloj NO frenan: se muestran y se aceptan a mano.
  const avisoCerrar = useMemo(
    () => (period ? avisoHorasDefault(semaforo, 'cerrar') : null),
    [period, semaforo],
  )
  const avisoPagar = useMemo(
    () => (period ? avisoHorasDefault(semaforo, 'pagar') : null),
    [period, semaforo],
  )

  // ── 10% de SERVICIO ───────────────────────────────────────────────────────────
  const empById = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees])

  // Quién entra al reparto. Default `true` (mig 055: `participa_servicio not null default
  // true`), incluido el caso raro de horas de alguien que no está en la lista: dejarlo
  // afuera por defecto sería sacarle plata a alguien por un dato que la base dice que sí.
  const participaDe = useCallback(
    (id: string) => {
      const e = empById.get(id)
      return e ? participaServicio(e) : PARTICIPA_SERVICIO_DEFAULT
    },
    [empById],
  )

  const diasPeriodo = useMemo(
    () => (period ? diasDelPeriodo(period.fecha_ini, period.fecha_fin) : []),
    [period],
  )

  // El reparto usa SIEMPRE las horas completas del período (`workDays`), nunca las del
  // filtro de local: el pool del día es del negocio entero, y dividirlo entre las horas de
  // un solo local le daría a media plantilla la plata de toda.
  const servicio: ServicioPeriodo | null = useMemo(
    () => (servicioDia ? servicioDelPeriodo(workDays, servicioDia, participaDe, diasPeriodo) : null),
    [servicioDia, workDays, participaDe, diasPeriodo],
  )
  const servicioDisponible = servicio != null

  // ── Filtro de local (vista) ───────────────────────────────────────────────────
  // El pay run es global: con un local elegido se MIRA, no se paga ni se editan horas
  // (el input de horas escribe siempre en la fila de LOCAL_DEFAULT).
  const alcanceParcial = localFiltro !== 'todos'
  const wdVista = useMemo(
    () => (alcanceParcial ? workDays.filter(w => w.local === localFiltro) : workDays),
    [workDays, alcanceParcial, localFiltro],
  )

  const lineas: LineaConsolidado[] = useMemo(
    () => (period
      ? consolidarPeriodo(activos, wdVista, period, LOCAL_DEFAULT, propinas, servicio?.porEmpleado)
      : []),
    [activos, wdVista, period, propinas, servicio],
  )
  // Con un local elegido, quien no tuvo horas ahí no es parte de esa vista.
  const lineasVista = useMemo(
    () => (alcanceParcial ? lineas.filter(l => l.horas > 0) : lineas),
    [lineas, alcanceParcial],
  )
  const totalPropinas = useMemo(() => lineasVista.reduce((s, l) => s + l.propinasPeriodo, 0), [lineasVista])

  // Promedio de tarifa SOBRE EL FILTRO ACTIVO (v3). Solo cuenta a quien cobra por hora:
  // meter los ₡0 de un sueldo fijo lo hundiría y el número dejaría de querer decir nada.
  const tarifas = useMemo(
    () => lineasVista.filter(l => l.hourlyRate > 0).map(l => l.hourlyRate),
    [lineasVista],
  )
  const promedioTarifa = tarifas.length > 0
    ? tarifas.reduce((s, t) => s + t, 0) / tarifas.length
    : 0
  const horasVista = useMemo(() => lineasVista.reduce((s, l) => s + l.horas, 0), [lineasVista])

  // Un activo con horas y sin tarifa cargada da neto ₡0 y queda fuera del archivo del
  // banco sin decir nada. Es el mismo silencio que el inactivo: alguien no cobra.
  const sinTarifa = useMemo(() => lineasVista.filter(l => l.sinTarifa), [lineasVista])

  // El que trabajó media quincena y lo desactivaron antes de cerrarla: sus horas están
  // cargadas pero su línea no existe en esta pantalla. No se lo mete a la nómina —
  // irse a mitad de período puede ser legítimo — pero no puede desaparecer callado.
  const inactivos = useMemo(
    () => (period ? inactivosConHoras(employees, workDays, period) : []),
    [employees, workDays, period],
  )
  const nombresInactivos = useMemo(
    () => inactivos.map(id => employees.find(e => e.id === id)?.full_name ?? id),
    [inactivos, employees],
  )

  // Neto efectivo = el pisado a mano si lo hay, el calculado si no.
  const netoEfectivo = useCallback(
    (l: LineaConsolidado) => {
      const d = netoDraft[l.employee.id]
      return d != null && d.trim() !== '' ? num(d) : l.neto
    },
    [netoDraft],
  )

  // Los montos que salen por el banco. Se redondea POR PARTES y después se suma: si se
  // redondeara el total, el pie quedaría desfasado en ₡1 respecto de la suma de columnas
  // y la grilla y el Excel dirían cosas distintas por un centavo.
  const montoHoras    = useCallback((l: LineaConsolidado) => Math.round(netoEfectivo(l)), [netoEfectivo])
  const montoServicio = useCallback((l: LineaConsolidado) => Math.round(l.servicio), [])
  const montoAPagar   = useCallback(
    (l: LineaConsolidado) => aPagarDe(montoHoras(l), montoServicio(l)),
    [montoHoras, montoServicio],
  )

  const aPagar = lineasVista
    .map(l => ({ l, horas: montoHoras(l), servicio: montoServicio(l), monto: montoAPagar(l) }))
    .filter(x => x.monto > 0)
  const total          = aPagar.reduce((s, x) => s + x.monto, 0)
  const totalHoras     = aPagar.reduce((s, x) => s + x.horas, 0)
  const totalServicio  = aPagar.reduce((s, x) => s + x.servicio, 0)
  const totalIngreso   = total + totalPropinas

  // Costo laboral (bloque gerencial, NO la transferencia). El CCSS es un placeholder
  // sobre el salario por horas: las propinas y el 10% no son salario base.
  const ccss         = Math.round(totalHoras * CCSS_PLACEHOLDER)
  const costoLaboral = totalHoras + totalServicio + totalPropinas + ccss

  // El 10% que este período cobró y que esta nómina NO transfiere: días sin nadie que
  // participe, más lo que le tocó a gente que no está en la grilla (inactivos con horas).
  // Es plata que existe: se muestra en vez de evaporarse en la diferencia de dos totales.
  const servicioSinRepartir = servicio
    ? Math.max(0, Math.round(servicio.totalRepartido + servicio.totalSinRepartir - totalServicio))
    : 0

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user?.id) { setError('Sesión sin usuario.'); return }
    if (newFin < newIni) { setError('La fecha de fin no puede ser anterior a la de inicio.'); return }
    setSaving(true); setError(null)
    try {
      const p = await createSalaryPeriod({
        tipo: newTipo, fecha_ini: newIni, fecha_fin: newFin, created_by: user.id,
      })
      setShowForm(false)
      await loadPeriods()
      setPeriodId(p.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error creando el período')
    } finally {
      setSaving(false)
    }
  }

  // Todas las transiciones pasan por acá: la API valida el salto y las guardas, la
  // pantalla solo muestra el resultado y recarga. `loadPeriods` refresca la lista y el
  // efecto de arriba vuelve a traer horas, pagos y excepciones del período.
  const transicionar = async (accion: () => Promise<unknown>, ok: string) => {
    setSaving(true); setError(null); setAviso(null)
    try {
      await accion()
      setAviso(ok)
      await loadPeriods()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cambiando el estado del período')
    } finally {
      setSaving(false)
    }
  }

  const handleEnRevision = () => {
    if (!period || !user?.id) return
    transicionar(
      () => setPeriodoEnRevision(period.id, user.id),
      'Período en revisión: las horas se siguen editando.',
    )
  }

  const handleCerrar = () => {
    if (!period || !user?.id) return
    // A8 · paso consciente: cerrar congela el número, así que las horas que puso la regla
    // se aceptan ACÁ, en su propio confirm, y no mezcladas con el resto.
    if (avisoCerrar && !window.confirm(`${avisoCerrar}\n\n¿Cerrar igual?`)) return
    const ok = window.confirm(
      `¿Cerrar el período ${period.fecha_ini} → ${period.fecha_fin}?\n\n` +
      'Las horas y las tarifas quedan CONGELADAS: para volver a tocarlas hay que reabrirlo ' +
      'con un motivo, que queda registrado.\n\nDespués de cerrar se puede marcar el pago.',
    )
    if (!ok) return
    transicionar(() => cerrarPeriodo(period.id, user.id), 'Período cerrado.')
  }

  const handleReabrir = () => {
    if (!period || !user?.id) return
    const motivo = motivoReab.trim()
    if (!motivo) { setError('Escribí el motivo de la reapertura: queda registrado en el período.'); return }
    transicionar(
      () => reabrirPeriodo(period.id, user.id, motivo),
      'Período reabierto: vuelve a revisión y las horas se pueden corregir.',
    ).then(() => { setReabriendo(false); setMotivoReab('') })
  }

  // Las horas se guardan al salir del campo (mismo gesto que el resto de la app: se
  // escribe, se sale, quedó). Se persiste SOLO la parte manual del total.
  const saveHoras = async (l: LineaConsolidado) => {
    const draft = horasDraft[l.employee.id]
    if (!period || draft == null) return
    // Con un local elegido el total de la fila es PARCIAL, y el upsert escribe siempre en
    // la fila de LOCAL_DEFAULT: guardar acá le borraría a la persona las horas del otro
    // local. El input ya va deshabilitado; esto es la segunda llave.
    if (alcanceParcial) return
    const totalNuevo = num(draft)
    // Lo editable es la fila manual, que comparte PK con la jornada del último día: si
    // BioTime derivó ESE día, el upsert la reemplaza. Esas horas están dentro de
    // `horasOtras` pero no van a sobrevivir, así que se descuentan del resto — restarlas
    // igual dejaría el total por debajo de lo tecleado y se pagaría de menos.
    const sobreviven  = Math.max(0, l.horasOtras - l.horasPisadas)
    const manualNuevo = Math.max(0, totalNuevo - sobreviven)
    if (manualNuevo === l.horasManual) {
      setHorasDraft(d => { const rest = { ...d }; delete rest[l.employee.id]; return rest })
      return
    }
    setSaving(true); setError(null)
    try {
      await upsertWorkDay({
        employee_id: l.employee.id,
        work_date:   period.fecha_fin,
        local:       LOCAL_DEFAULT,
        hours:       manualNuevo,
      })
      setHorasDraft(d => { const rest = { ...d }; delete rest[l.employee.id]; return rest })
      setWorkDays(await getWorkDays(period.fecha_ini, period.fecha_fin))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error guardando las horas')
    } finally {
      setSaving(false)
    }
  }

  const handleDownload = () => {
    if (!period) return
    setError(null)
    try {
      // `x.monto` = total de horas + 10% de servicio: EXACTAMENTE la columna "A pagar" de
      // la grilla. La pantalla es la promesa de lo que la persona va a cobrar; el archivo
      // del banco es lo que la cumple, y no pueden decir números distintos.
      downloadPlanillaXlsx(
        aPagar.map(x => ({ nombre: x.l.nombreBanco, monto: x.monto })),
        concepto,
        planillaFileName('planilla-salarios', `${period.fecha_ini}-a-${period.fecha_fin}`),
      )
      setAviso(
        `Archivo generado: ${aPagar.length} transferencia(s) por ${fi(total)}` +
        (totalServicio > 0 ? ` (${fi(totalHoras)} de horas + ${fi(totalServicio)} de 10% de servicio).` : '.'),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error generando el archivo')
    }
  }

  const handlePagar = async () => {
    if (!period || !user?.id) return
    // El pay run es GLOBAL: pagar mirando un solo local dejaría afuera las horas del otro.
    if (alcanceParcial) {
      setError(`Estás viendo solo ${LOCAL_LABEL[localFiltro]}. Poné el filtro en «Todos» para pagar: el período se paga completo.`)
      return
    }
    // Lo único que frena: las horas contadas dos veces. Se destraba tildando la casilla,
    // no acá — este chequeo es la segunda llave por si el botón quedó habilitado.
    if (frenado) {
      setError(
        `${nombresDobles.join(', ')} tiene(n) horas cargadas a mano Y horas de BioTime en este ` +
        'período: el total las SUMA. Revisá cuál vale y confirmá la casilla antes de pagar.',
      )
      return
    }

    // Fichajes sin resolver (marcas abiertas / sin mapear): eso sí frena. La API aplica la
    // misma guarda releyendo la base, así que este chequeo es la primera llave, no la única.
    if (bloqueoPagar) { setError(bloqueoPagar); return }

    // A8 · paso consciente, no bloqueo: las horas que NO midió el reloj se pagan, pero
    // quien paga tiene que decir que sí. Va en su propio confirm y no mezclado con el
    // resto, porque es la única cifra de la nómina que salió de una política y no de un dato.
    if (avisoPagar && !window.confirm(`${avisoPagar}\n\n¿Pagar igual?`)) return

    // Mismo riesgo que sin_mapear —alguien que no cobra— y misma respuesta: no se frena la
    // nómina de los demás, se pregunta. La decisión de pagarle a alguien que se fue a
    // mitad de quincena es del dueño, no del código.
    if (nombresInactivos.length > 0) {
      const sigue = window.confirm(
        `${nombresInactivos.length} inactivo(s) con horas SIN PAGAR en este período:\n\n` +
        `${nombresInactivos.join(', ')}\n\n` +
        'No entran a esta nómina ni al archivo del banco. ¿Trabajaron y hay que pagarles?\n\n' +
        'Si sí: cancelá, reactivalos en Empleados / Tarifas y volvé a intentar.\n' +
        '¿Pagar igual, dejándolos afuera?',
      )
      if (!sigue) return
    }

    const avisos: string[] = []
    if (nombresInactivos.length > 0) {
      avisos.push(`⛔ Quedan AFUERA (inactivos con horas): ${nombresInactivos.join(', ')}.`)
    }
    if (sinTarifa.length > 0) {
      avisos.push(
        `⛔ SIN TARIFA (neto ₡0, quedan fuera del archivo): ${sinTarifa.map(l => l.employee.full_name).join(', ')}.`,
      )
    }
    if (semaforo.dobles.length > 0) {
      avisos.push(`⚠️ Horas dobles confirmadas a mano: ${nombresDobles.join(', ')}.`)
    }
    if (!servicioDisponible) {
      avisos.push('⚠️ SIN el 10% de servicio: no se pudo leer el servicio del período y se transfieren SOLO las horas.')
    } else if (servicio && servicio.diasSinVentas.length > 0) {
      avisos.push(
        `⚠️ ${servicio.diasSinVentas.length} día(s) del período SIN ventas cargadas: su 10% de servicio no se repartió.`,
      )
    }

    const ok = window.confirm(
      `¿Marcar el período ${period.fecha_ini} → ${period.fecha_fin} como PAGADO?\n\n` +
      `${aPagar.length} empleado(s) · ${fi(total)}\n` +
      `${fi(totalHoras)} de horas + ${fi(totalServicio)} de 10% de servicio\n\n` +
      (avisos.length > 0 ? avisos.join('\n') + '\n\n' : '') +
      'Las PROPINAS no van en esta transferencia: se pagan en efectivo por su propio camino.\n\n' +
      'Queda el registro del pago por transferencia. No genera movimiento de caja.',
    )
    if (!ok) return
    setSaving(true); setError(null)
    try {
      const n = await markPeriodPaid(
        period.id,
        aPagar.map(x => ({
          employee_id: x.l.employee.id,
          // El neto registrado es lo que SE TRANSFIRIÓ: horas + 10% de servicio, el mismo
          // número de la grilla y del Excel. `servicio` viaja aparte para que
          // `salary_lines.aporte_servicio` guarde de qué está hecho ese total.
          monto_neto:  x.monto,
          horas:       x.l.horas,
          hourly_rate: x.l.hourlyRate,
          fijo:        x.l.fijo,
          servicio:    x.servicio,
        })),
        user.id,
      )
      setAviso(`Período marcado como pagado: ${n} pago(s) registrado(s).`)
      // No recargamos a mano el detalle: al refrescar los períodos cambia `period` y el
      // efecto de arriba vuelve a traer horas, tarifas y los pagos recién registrados.
      await loadPeriods()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error marcando el pago')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center', opacity: 0.4 }}>⏳</div>
  }

  return (
    <div className="admin-section">
      <div className="admin-section-header">
        <span className="admin-section-title">Pago del período</span>
        <button className="btn-secondary" onClick={() => { setShowForm(v => !v); setError(null) }}>
          {showForm ? 'Cancelar' : '+ Nuevo período'}
        </button>
      </div>

      {showForm && (
        <form className="admin-form" onSubmit={handleCreate}>
          <div className="field">
            <label>Tipo</label>
            <select value={newTipo} onChange={e => setNewTipo(e.target.value as 'quincena' | 'adhoc')} disabled={saving}>
              <option value="quincena">Quincena</option>
              <option value="adhoc">Ad-hoc</option>
            </select>
          </div>
          <div className="field">
            <label>Desde</label>
            <input type="date" value={newIni} onChange={e => setNewIni(e.target.value)} required disabled={saving} />
          </div>
          <div className="field">
            <label>Hasta</label>
            <input type="date" value={newFin} onChange={e => setNewFin(e.target.value)} required disabled={saving} />
          </div>
          <div className="form-actions">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Creando…' : 'Crear período'}
            </button>
          </div>
        </form>
      )}

      {/* v3 · Local primero. Filtra la VISTA de las horas (work_days.local); el pay run
          sigue siendo global, así que con un local elegido no se paga ni se editan horas. */}
      <div className="sal-bar">
        <span className="sal-bar-label">Local</span>
        <div className="sal-pills" role="group" aria-label="Filtrar por local">
          {LOCAL_FILTROS.map(f => (
            <button
              key={f}
              type="button"
              className={`sal-pill ${localFiltro === f ? 'is-active' : ''}`}
              aria-pressed={localFiltro === f}
              onClick={() => setLocalFiltro(f)}
              disabled={saving}
            >
              {LOCAL_LABEL[f]}
            </button>
          ))}
        </div>
      </div>

      <div className="sal-bar">
        <span className="sal-bar-label">Período</span>
        <select
          className="tip-input"
          aria-label="Período de pago"
          value={periodId}
          onChange={e => setPeriodId(e.target.value)}
          disabled={saving}
        >
          <option value="">— elegir —</option>
          {periods.map(p => (
            <option key={p.id} value={p.id}>
              {p.fecha_ini} → {p.fecha_fin} · {p.tipo} · {p.estado}
            </option>
          ))}
        </select>
        {period && (
          <span className="role-badge" style={{ color: COLOR_ESTADO[estado] ?? '#888' }}>
            {ESTADO_LABEL[estado]}{pagado ? ` · ${pagos.length} registro(s)` : ''}
          </span>
        )}
      </div>

      {/* Ciclo del período con la forma del prototipo (`.steps`): dónde está hoy y qué
          falta. Los estados y su orden son los de `TRANSICIONES`, no una lista aparte. */}
      {period && (
        <div className="sal-card">
          <p className="sal-mini-hd">Estado del período</p>
          <div className="sal-steps">
            {CICLO.map((e, i) => {
              const idx  = CICLO.indexOf(estado)
              const done = i < idx
              const now  = i === idx
              return (
                <span key={e} style={{ display: 'contents' }}>
                  {i > 0 && <span className="sal-step-arrow">→</span>}
                  <span className={`sal-step ${done ? 'is-done' : now ? 'is-now' : ''}`}>
                    <span className="sal-step-n">{done ? '✓' : i + 1}</span>
                    {ESTADO_LABEL[e]}
                  </span>
                </span>
              )
            })}
          </div>
        </div>
      )}

      {alcanceParcial && (
        <p className="sal-note is-info">
          👁️ Vista de <strong>{LOCAL_LABEL[localFiltro]}</strong>: se muestran solo las horas de
          ese local. El período se <strong>paga completo</strong>, así que mientras el filtro esté
          puesto no se editan horas ni se baja el archivo del banco. Volvé a{' '}
          <strong>Todos</strong> para pagar.
        </p>
      )}

      {period && (
        <div style={{ padding: '0 12px 8px', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {estado === 'abierto' && (
            <button
              className="btn-secondary"
              onClick={handleEnRevision}
              disabled={saving || !puedeCerrar}
              title={puedeCerrar ? undefined : 'Lo hacen el dueño, el gerente o el contador'}
            >
              Marcar en revisión
            </button>
          )}

          {!congelado && (
            <button
              className="btn-secondary"
              onClick={handleCerrar}
              disabled={saving || !puedeCerrar || !!bloqueoCerrar}
              title={bloqueoCerrar ?? (puedeCerrar ? undefined : 'Lo hacen el dueño, el gerente o el contador')}
            >
              Cerrar período
            </button>
          )}

          {congelado && !reabriendo && (
            <button
              className="btn-secondary"
              onClick={() => { setReabriendo(true); setError(null) }}
              disabled={saving || !puedeCerrar}
              title={puedeCerrar ? undefined : 'Lo hacen el dueño, el gerente o el contador'}
            >
              Reabrir período
            </button>
          )}

          {congelado && reabriendo && (
            <>
              <input
                className="tip-input"
                type="text"
                aria-label="Motivo de la reapertura"
                placeholder="Motivo de la reapertura (obligatorio)"
                value={motivoReab}
                onChange={e => setMotivoReab(e.target.value)}
                disabled={saving}
                style={{ width: '320px' }}
              />
              <button className="btn-primary" onClick={handleReabrir} disabled={saving || !motivoReab.trim()}>
                Reabrir
              </button>
              <button
                className="btn-delete-inline"
                onClick={() => { setReabriendo(false); setMotivoReab('') }}
                disabled={saving}
              >
                Cancelar
              </button>
            </>
          )}

          {congelado && (
            <span style={{ fontSize: '0.7rem', color: '#888' }}>
              🔒 Horas y tarifas congeladas hasta reabrirlo.
            </span>
          )}
          {period.reopen_motivo && (
            <span style={{ fontSize: '0.68rem', color: '#888' }}>
              Última reapertura: «{period.reopen_motivo}»
            </span>
          )}
        </div>
      )}

      {period && bloqueoCerrar && !congelado && (
        <p style={{ padding: '0 12px 8px', fontSize: '0.78rem', color: 'var(--t-red, #b04a3a)' }}>
          ⛔ {bloqueoCerrar}
        </p>
      )}

      {error && <p className="field-error" style={{ padding: '0 12px' }}>{error}</p>}
      {aviso && (
        <p style={{ padding: '0 12px', fontSize: '0.75rem', color: 'var(--t-teal)' }}>
          {aviso} <button className="btn-delete-inline" onClick={() => setAviso(null)}>✕</button>
        </p>
      )}

      {!period ? (
        <p style={{ padding: '1.5rem', textAlign: 'center', opacity: 0.45, fontSize: '0.8rem' }}>
          Elegí un período (o creá uno) para cargar las horas y armar el pago.
        </p>
      ) : (
        <>
          <div style={{ padding: '0 12px 8px', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ fontSize: '0.72rem', color: '#888' }}>Concepto para el banco</label>
            <input
              className="tip-input"
              type="text"
              aria-label="Concepto para el banco"
              value={concepto}
              onChange={e => setConcepto(e.target.value)}
              style={{ width: '260px' }}
            />
            <span style={{ fontSize: '0.68rem', color: '#888' }}>
              va en las columnas D y E del archivo
            </span>
          </div>

          {!pagado && sinTarifa.length > 0 && (
            <p style={{ padding: '0 12px 8px', fontSize: '0.8rem', color: 'var(--t-red, #b04a3a)' }}>
              ⛔ <strong>{sinTarifa.map(l => l.employee.full_name).join(', ')}</strong> tiene(n) horas
              en este período y <strong>NINGUNA tarifa cargada</strong>: su neto da ₡0 y{' '}
              {sinTarifa.length === 1 ? 'queda' : 'quedan'} fuera del archivo del banco. Cargale(s) la
              tarifa en <strong>Empleados / Tarifas</strong> antes de pagar.
            </p>
          )}

          {!pagado && nombresInactivos.length > 0 && (
            <p style={{ padding: '0 12px 8px', fontSize: '0.8rem', color: 'var(--t-red, #b04a3a)' }}>
              ⛔ <strong>{nombresInactivos.join(', ')}</strong> tiene(n) horas en este período y
              está(n) <strong>inactivo(s)</strong>: no entra(n) a esta nómina, no van al archivo del
              banco y <strong>no van a cobrar</strong>. Las horas se ven en la pestaña{' '}
              <strong>Horas</strong>. Si trabajaron, reactivalos en{' '}
              <strong>Empleados / Tarifas</strong> antes de cerrar.
            </p>
          )}

          {autoDeriv && (
            <p className="sal-note sal-note-teal" role="status">
              <span className="sal-note-mk">◆</span>
              <span>
                El período no tenía horas: se derivaron solas desde BioTime{' '}
                (<strong>{autoDeriv.marcas} marca(s)</strong> · {autoDeriv.dias} jornada(s) ·{' '}
                {Number(autoDeriv.horas).toFixed(2)} h).
                {autoDeriv.dias_omitidos_manual > 0 && (
                  <> {autoDeriv.dias_omitidos_manual} jornada(s) cargada(s) a mano{' '}
                    <strong>no se tocaron</strong>.</>
                )}{' '}
                Revisalas en <strong>Horas</strong> antes de pagar.
              </span>
            </p>
          )}

          {!pagado && semaforo.sinMapearDias > 0 && (
            <p style={{ padding: '0 12px 8px', fontSize: '0.78rem', color: 'var(--t-red, #b04a3a)' }}>
              ⚠️ <strong>{semaforo.sinMapearMarcas} marca(s) de fichaje sin empleado asignado</strong>{' '}
              ({semaforo.sinMapearDias} jornada(s)) en este período: puede que alguien no esté
              cobrando. Asignale el código en <strong>Empleados / Tarifas</strong> y recalculá las
              horas antes de pagar.
            </p>
          )}

          {!pagado && semaforo.diasIncompletos > 0 && (
            <p style={{ padding: '0 12px 8px', fontSize: '0.76rem', color: '#8a6d3b' }}>
              🕒 <strong>{semaforo.diasIncompletos} jornada(s) con marca incompleta</strong> en esta
              nómina: {semaforo.tramos} tramo(s) sin cerrar ={' '}
              <strong>{semaforo.horasDefault.toFixed(0)} h</strong> puestas por la regla
              ({HORAS_DEFAULT_IMPAR} h por tramo), no medidas por el reloj. Los tramos bien marcados
              de esos días sí cuentan sus horas reales. <strong>No frenan</strong> el cierre ni el
              pago — se piden a mano —, pero se corrigen día por día en la pestaña{' '}
              <strong>Horas</strong>.
            </p>
          )}

          {!pagado && semaforo.fichajeDias > 0 && (
            <p style={{ padding: '0 12px 8px', fontSize: '0.72rem', color: 'var(--t-red, #b04a3a)' }}>
              ⛔ {semaforo.fichajeDias} jornada(s) con fichaje incompleto sin resolver en la bandeja
              (pestaña <strong>Horas</strong>). <strong>Frenan el cierre y el pago.</strong>
            </p>
          )}

          {!pagado && semaforo.dobles.length > 0 && (
            <div style={{ padding: '0 12px 8px', fontSize: '0.78rem', color: 'var(--t-red, #b04a3a)' }}>
              <p style={{ margin: 0 }}>
                ⛔ <strong>{nombresDobles.join(', ')}</strong> tiene(n) el total del período cargado
                a mano <em>y</em> horas de BioTime: el neto las <strong>SUMA</strong>. Es el único
                caso que puede pagar de más.
              </p>
              <p style={{ margin: '0.2rem 0 0', fontSize: '0.72rem', opacity: 0.85 }}>
                Esto <strong>no</strong> se destraba resolviendo marcas en la pestaña Horas: o borrás
                la carga manual duplicada (el total del período), o confirmás acá abajo que el total
                que ves es el correcto.
              </p>
              <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginTop: '0.3rem' }}>
                <input
                  type="checkbox"
                  checked={okDobles}
                  onChange={e => setOkDobles(e.target.checked)}
                  disabled={saving}
                />
                Revisé las horas de {semaforo.dobles.length} empleado(s) y el total es correcto
              </label>
            </div>
          )}

          {/* Si el 10% no se puede leer, se DICE y se paga solo lo que sí se sabe. Un ₡0
              inventado sería una transferencia de menos que nadie iba a notar. */}
          {!servicioDisponible && (
            <p className="sal-note is-stop">
              ⛔ <strong>No se pudo leer el 10% de servicio de este período</strong>
              {errServicio ? ` (${errServicio})` : ''}. La columna <strong>10% serv.</strong> va en
              «—» y <strong>A pagar = solo las horas</strong>: no se inventa el monto.
              <br />
              Falta el <strong>servicio por día</strong>, que sale de las ventas del POS que carga el
              módulo <strong>Ventas</strong>. Las horas por día y el flag{' '}
              <em>participa del 10%</em> ya están.
            </p>
          )}

          {servicioDisponible && servicio && servicio.diasSinVentas.length > 0 && (
            <p className="sal-note is-warn">
              ⚠️ <strong>{servicio.diasSinVentas.length} día(s) del período sin ventas cargadas</strong>{' '}
              ({servicio.diasSinVentas.slice(0, 6).join(', ')}
              {servicio.diasSinVentas.length > 6 ? '…' : ''}): de esos días{' '}
              <strong>no se sabe</strong> cuánto servicio se cobró, así que su 10% no se repartió.
              No es que hayan sido ₡0 — cargá las ventas en <strong>Ventas</strong> y volvé.
            </p>
          )}

          {/* Con un local elegido la resta compara un pool global contra una vista parcial:
              el número no querría decir nada, así que no se muestra. */}
          {servicioDisponible && !alcanceParcial && servicioSinRepartir > 0 && (
            <p className="sal-note is-plum">
              ℹ️ <strong>{fi(servicioSinRepartir)}</strong> del 10% de servicio del período{' '}
              <strong>no se reparte en esta nómina</strong>: son días sin horas de nadie que
              participe, o le tocan a alguien que no está en esta grilla (por ejemplo un inactivo
              con horas). No se transfiere y no se pierde de vista.
            </p>
          )}

          {errPropinas && (
            <p style={{ padding: '0 12px 8px', fontSize: '0.75rem', color: '#8a6d3b' }}>
              ⚠️ No se pudieron leer las propinas del período ({errPropinas}). Las columnas
              informativas quedan en ₡0 — <strong>no es que nadie haya cobrado propinas</strong>.
              El pago por transferencia no depende de esto.
            </p>
          )}

          {/* ── Stats del filtro activo (v3) ───────────────────────────────────── */}
          <div className="sal-stats">
            <div className="sal-stat">
              <span className="sal-stat-label">Personas</span>
              <span className="sal-stat-value">{lineasVista.length}</span>
              <span className="sal-stat-note">{aPagar.length} con transferencia</span>
            </div>
            <div className="sal-stat">
              <span className="sal-stat-label">Horas</span>
              <span className="sal-stat-value">{horasVista.toLocaleString('es-CR')}</span>
              <span className="sal-stat-note">{LOCAL_LABEL[localFiltro]}</span>
            </div>
            <div className="sal-stat">
              <span className="sal-stat-label">Tarifa promedio</span>
              <span className="sal-stat-value is-teal">
                {promedioTarifa > 0 ? fi(Math.round(promedioTarifa)) : '—'}
              </span>
              <span className="sal-stat-note">
                {tarifas.length} por hora · sobre el filtro activo
              </span>
            </div>
            <div className="sal-stat">
              <span className="sal-stat-label">10% de servicio</span>
              <span className="sal-stat-value is-plum">
                {servicioDisponible ? fi(totalServicio) : '—'}
              </span>
              <span className="sal-stat-note">
                {servicioDisponible ? 'se transfiere con las horas' : 'sin dato del período'}
              </span>
            </div>
            <div className="sal-stat">
              <span className="sal-stat-label">Propinas</span>
              <span className="sal-stat-value is-gold">{fi(totalPropinas)}</span>
              <span className="sal-stat-note">efectivo · NO se transfieren</span>
            </div>
          </div>

          {/* La grilla de pago v3. Orden de columnas del SPEC:
              Nombre | Horas | Total horas (₡) | 10% serv. | A pagar | Propinas | Ingreso total
              Lo operativo que la nómina igual necesita (alias del banco, tarifa, fijo,
              flag del 10%) baja a la celda del nombre en vez de perderse. */}
          {/* Los tres conceptos de plata, a la vista arriba de la grilla (`.moneykey` del
              prototipo): qué sale por el banco y qué no. */}
          <div className="sal-moneykey">
            <span style={{ color: 'var(--sal-ink)' }}>
              <i style={{ background: 'var(--sal-ink)' }} />Salario por horas → banco
            </span>
            <span style={{ color: 'var(--sal-plum)' }}>
              <i style={{ background: 'var(--sal-plum)' }} />10% de servicio → banco (con el salario)
            </span>
            <span style={{ color: 'var(--sal-gold)' }}>
              <i style={{ background: 'var(--sal-gold)' }} />Propinas (pozo) → efectivo (por ahora)
            </span>
          </div>

          <div className="sal-table-wrap">
            <table className="sal-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th className="is-num">Horas</th>
                  <th className="is-num">Total horas (₡)</th>
                  <th className="is-num">10% serv.</th>
                  <th className="is-num">A pagar</th>
                  <th className="is-num">Propinas</th>
                  <th className="is-num">Ingreso total</th>
                </tr>
              </thead>
              <tbody>
                {lineasVista.map(l => {
                  const id       = l.employee.id
                  const horasVal = horasDraft[id] ?? String(l.horas)
                  const netoVal  = netoDraft[id]  ?? ''
                  const pisado   = netoVal.trim() !== ''
                  const participa = participaServicio(l.employee)
                  const serv     = montoServicio(l)
                  return (
                    <tr key={id}>
                      <td>
                        <div className="sal-name">{l.employee.full_name}</div>
                        <div className="sal-name-meta">
                          {/* El banco identifica al beneficiario POR EL NOMBRE: sin alias
                              cargado se exporta el nombre del empleado. */}
                          {l.employee.nombre_homebanking
                            ? `banco: ${l.employee.nombre_homebanking}`
                            : `banco: ${l.employee.full_name} (sin alias)`}
                          {' · '}
                          {l.hourlyRate > 0
                            ? `${fi(l.hourlyRate)}/h`
                            : l.sinTarifa
                              ? <strong style={{ color: 'var(--sal-red)' }}>sin tarifa</strong>
                              : 'sin tarifa por hora'}
                          {l.fijo > 0 && ` · fijo ${fi(l.fijo)}`}
                          {!participa && ' · no participa del 10%'}
                        </div>
                      </td>
                      <td className="is-num">
                        <input
                          className="tip-input"
                          type="number"
                          min="0"
                          step="0.25"
                          aria-label={`Horas del período: ${l.employee.full_name}`}
                          value={horasVal}
                          onChange={e => setHorasDraft(d => ({ ...d, [id]: e.target.value }))}
                          onBlur={() => saveHoras(l)}
                          disabled={saving || congelado || alcanceParcial}
                          style={{ width: '76px', textAlign: 'right' }}
                        />
                      </td>
                      {/* Total horas (₡) = horas × tarifa + fijo. Es lo que en B se llamaba
                          "Salario calculado", y sigue siendo lo único que se pisa a mano. */}
                      <td className="is-num">
                        <input
                          className="tip-input"
                          type="number"
                          min="0"
                          step="1"
                          aria-label={`Total de horas a pagar: ${l.employee.full_name}`}
                          placeholder={String(Math.round(l.neto))}
                          value={netoVal}
                          onChange={e => setNetoDraft(d => ({ ...d, [id]: e.target.value }))}
                          disabled={saving || congelado}
                          style={{ width: '110px', textAlign: 'right' }}
                        />
                        {pisado && (
                          <div className="sal-name-meta">calculado {fi(l.neto)}</div>
                        )}
                      </td>
                      {/* 10% de SERVICIO — NO es IVA y NO es propina. Se transfiere. */}
                      <td className="is-num">
                        {!servicioDisponible
                          ? <span className="sal-dash" title="No se pudo leer el servicio del período">—</span>
                          : serv > 0
                            ? <span className="sal-money-serv">{fi(serv)}</span>
                            : <span className="sal-dash">—</span>}
                      </td>
                      {/* A pagar = Total horas + 10% de servicio. Es lo que sale por el banco. */}
                      <td className="is-num">
                        <span className="sal-money-pagar">{fi(montoAPagar(l))}</span>
                      </td>
                      {/* Informativas: NO se transfieren. Van en su propio color y fuera de
                          cualquier total del archivo del banco. */}
                      <td className="is-num">
                        {l.propinasPeriodo > 0
                          ? <span className="sal-money-tip">{fi(l.propinasPeriodo)}</span>
                          : <span className="sal-dash">—</span>}
                      </td>
                      <td className="is-num">
                        <span className="sal-money-total">
                          {fi(ingresoTotalDe(montoHoras(l), l.propinasPeriodo, serv))}
                        </span>
                      </td>
                    </tr>
                  )
                })}
                {lineasVista.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ padding: '1.5rem', textAlign: 'center', opacity: 0.4, fontSize: '0.8rem' }}>
                      {alcanceParcial
                        ? `Nadie con horas en ${LOCAL_LABEL[localFiltro]} en este período.`
                        : 'No hay empleados activos.'}
                    </td>
                  </tr>
                )}
              </tbody>
              {lineasVista.length > 0 && (
                <tfoot>
                  <tr className="sal-foot">
                    <td>Total</td>
                    <td className="is-num">{horasVista.toLocaleString('es-CR')}</td>
                    <td className="is-num">{fi(totalHoras)}</td>
                    <td className="is-num">
                      {servicioDisponible
                        ? <span className="sal-money-serv">{fi(totalServicio)}</span>
                        : <span className="sal-dash">—</span>}
                    </td>
                    <td className="is-num"><span className="sal-money-pagar">{fi(total)}</span></td>
                    <td className="is-num"><span className="sal-money-tip">{fi(totalPropinas)}</span></td>
                    <td className="is-num"><span className="sal-money-total">{fi(totalIngreso)}</span></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* `.totalbar` del prototipo: lo que SALE POR TRANSFERENCIA, en grande, con las
              acciones al lado. Es el número del archivo del banco — no el ingreso total. */}
          <div className="sal-totalbar">
            <div>
              <div className="sal-totalbar-lbl">
                Sale por transferencia (salario + 10% de servicio)
              </div>
              <div className="sal-totalbar-big">{fi(total)}</div>
              <div style={{ fontSize: '12.5px', color: 'var(--sal-muted)', marginTop: '4px' }}>
                {aPagar.length} transferencia(s) = <strong>{fi(totalHoras)}</strong> de horas
                {servicioDisponible && <> + <strong className="sal-money-serv">{fi(totalServicio)}</strong> de 10% de servicio</>}
                {totalPropinas > 0 && (
                  <> · <span className="sal-money-tip">
                    + {fi(totalPropinas)} de propinas <strong>que NO se transfieren</strong>
                  </span></>
                )}
              </div>
            </div>
            <span className="sal-spacer" />
            <button
              className="btn-secondary"
              onClick={handleDownload}
              // El archivo del banco es lo que MUEVE la plata: "Marcar pagado" es solo el
              // registro. Frenar el registro y dejar bajar el Excel sería frenar la puerta
              // equivocada — se transferiría de más y recién después aparecería el bloqueo.
              // Por eso lo frena TODO lo que frena el pago, fichajes sin resolver incluidos.
              disabled={saving || aPagar.length === 0 || frenado || !!bloqueoPagar || alcanceParcial}
              title={
                alcanceParcial ? `Estás viendo solo ${LOCAL_LABEL[localFiltro]}: el período se paga completo. Poné el filtro en «Todos».`
                : frenado ? `Horas contadas dos veces: ${nombresDobles.join(', ')}`
                        : bloqueoPagar ?? undefined
              }
            >
              Descargar Excel para el banco
            </button>
            <button
              className="btn-primary"
              onClick={handlePagar}
              // Se paga lo que se CERRÓ: sin saltos. Un período abierto o en revisión
              // todavía se está moviendo, y transferir contra un número que se mueve es
              // justamente lo que el ciclo viene a evitar.
              disabled={
                saving || pagado || estado !== 'cerrado' || aPagar.length === 0 ||
                !puedePagar || frenado || !!bloqueoPagar || alcanceParcial
              }
              title={
                pagado ? undefined
                : alcanceParcial ? `Estás viendo solo ${LOCAL_LABEL[localFiltro]}: el período se paga completo. Poné el filtro en «Todos».`
                : estado !== 'cerrado' ? 'Cerrá el período antes de marcar el pago'
                : frenado ? `Horas contadas dos veces: ${nombresDobles.join(', ')}`
                : bloqueoPagar ? bloqueoPagar
                : puedePagar ? undefined : 'Solo el dueño o el gerente marcan el pago'
              }
            >
              {pagado ? 'Pagado' : 'Marcar pagado'}
            </button>
          </div>

          {/* COSTO LABORAL — bloque APARTE (`.costbox` del prototipo). Mezcla lo que sale
              por el banco con lo que sale por otros caminos y con las cargas: es lo que
              CUESTA el equipo, no lo que se transfiere. Por eso vive fuera de la barra de
              transferencia y lo dice en su propia etiqueta. */}
          <div className="sal-costbox">
            <div className="sal-costbox-head">
              <span className="sal-note-mk" style={{ color: 'var(--sal-teal)' }}>▦</span>
              <b>Costo laboral del período</b>
              <span className="sal-spacer" />
              <span className="sal-pill is-plain">gerencial · no es la transferencia</span>
            </div>
            <div className="sal-costrow">
              <span className="sal-costrow-l">
                <span className="sal-swatch" style={{ background: 'var(--sal-ink)' }} />
                Salarios por horas
              </span>
              <span className="sal-costrow-r is-num">{fi(totalHoras)}</span>
            </div>
            <div className="sal-costrow">
              <span className="sal-costrow-l">
                <span className="sal-swatch" style={{ background: 'var(--sal-plum)' }} />
                10% de servicio
              </span>
              <span className="sal-costrow-r is-num">
                {servicioDisponible ? fi(totalServicio) : <span className="sal-dash">—</span>}
              </span>
            </div>
            <div className="sal-costrow">
              <span className="sal-costrow-l">
                <span className="sal-swatch" style={{ background: 'var(--sal-gold)' }} />
                Propinas (pozo) · efectivo
              </span>
              <span className="sal-costrow-r is-num">{fi(totalPropinas)}</span>
            </div>
            <div className="sal-costrow">
              <span className="sal-costrow-l">
                <span className="sal-swatch" style={{ background: 'var(--sal-muted)' }} />
                CCSS / cargas sociales
                <span className="sal-pill is-plain" style={{ fontSize: '11px' }}>
                  placeholder ≈{Math.round(CCSS_PLACEHOLDER * 100)}% s/salario
                </span>
              </span>
              <span className="sal-costrow-r is-num">{fi(ccss)}</span>
            </div>
            <div className="sal-costrow">
              <span className="sal-costrow-l">
                <span className="sal-swatch" style={{ background: 'var(--sal-crit)' }} />
                Liquidaciones del período
              </span>
              <span className="sal-costrow-r is-num">
                <span className="sal-dash">sin registrar</span>
              </span>
            </div>
            <div className="sal-costrow is-total">
              <span className="sal-costrow-l">Costo laboral real</span>
              <span className="sal-costrow-r">{fi(costoLaboral)}</span>
            </div>
          </div>

          <p className="sal-legend">
            El costo laboral vive <strong>aparte</strong> de la transferencia: mezcla banco
            + otros caminos + cargas. <strong>El {Math.round(CCSS_PLACEHOLDER * 100)}% de
            CCSS es un placeholder</strong>, no el porcentaje real (patrono + obrero): sirve
            para tener el orden de magnitud y <strong>no se puede usar para presupuestar</strong>{' '}
            hasta que lo firme el contador. Las <strong>liquidaciones</strong> todavía no se
            guardan en ninguna tabla, así que este total no las incluye — se arman en su
            pestaña y se suman a mano.
          </p>

          <p className="sal-legend">
            <strong>Total horas (₡)</strong> = horas × la tarifa del empleado (Empleados / Tarifas)
            + su salario fijo. Editarlo a mano ajusta solo lo que se paga en este período.
            <br />
            <span className="is-plum">10% de servicio</span> = el cargo de servicio de salón y barra
            del período (delivery no lo cobra), repartido por las horas de cada día entre quienes
            participan. <strong>No es el IVA</strong> —eso es un impuesto, va en la factura y no se
            reparte— y <strong>no es propina</strong>.
            <br />
            Se transfieren <span className="is-teal">salario + 10% de servicio</span>: eso, y solo
            eso, es la columna <strong>A pagar</strong> y lo que baja en el Excel del banco.
            Las <span className="is-gold">propinas NO se transfieren</span> (se pagan en efectivo,
            por el módulo Propinas), así que <strong>Propinas</strong> e{' '}
            <strong>Ingreso total</strong> son de solo lectura e informativas.
            <br />
            El pago se registra como transferencia: <strong>no genera movimiento de caja</strong>.
          </p>
        </>
      )}
    </div>
  )
}
