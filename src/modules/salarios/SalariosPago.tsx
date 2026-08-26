import { useState, useEffect, useCallback, useMemo } from 'react'
import type { Employee, EmployeePayment, PunchException, SalaryPeriod, WorkDay } from '../../shared/types/database'
import {
  getSalaryPeriods, createSalaryPeriod, getWorkDays, upsertWorkDay,
  getPeriodPayments, markPeriodPaid, consolidarPeriodo, getPunchExceptionsTodosLosLocales,
  semaforoPago, inactivosConHoras, HORAS_DEFAULT_IMPAR, LOCAL_DEFAULT,
  setPeriodoEnRevision, cerrarPeriodo, reabrirPeriodo,
  estaCongelado, motivoBloqueoExcepciones, avisoHorasDefault, ESTADO_LABEL,
  ingresoTotalDe,
  type LineaConsolidado,
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
// Lo que NO hace (a propósito, va en los pases siguientes): 10% de servicio y propinas
// en el consolidado (F2), horas automáticas de BioTime (F1d), comprobante por WhatsApp
// o email, y datos bancarios completos. El pago NO toca caja.

// El estado del período de un vistazo. `cerrado` va en ámbar a propósito: no es un
// final (todavía falta pagar), es "esto ya no se toca".
const COLOR_ESTADO: Record<string, string> = {
  abierto:     '#888',
  en_revision: '#8a6d3b',
  cerrado:     '#8a6d3b',
  pagado:      'var(--t-teal)',
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
      setWorkDays([]); setPagos([]); setExcs([]); setOkDobles(false)
      setPropinas(new Map()); setErrPropinas(null)
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
    try {
      const [wd, pg, ex] = await Promise.all([
        getWorkDays(p.fecha_ini, p.fecha_fin),
        getPeriodPayments(p.id),
        // TODOS los locales: el neto del período suma las horas de cualquier local
        // (el pay run es global), así que el semáforo tiene que mirar el mismo conjunto.
        getPunchExceptionsTodosLosLocales(p.fecha_ini, p.fecha_fin),
      ])
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

  const lineas: LineaConsolidado[] = useMemo(
    () => (period ? consolidarPeriodo(activos, workDays, period, LOCAL_DEFAULT, propinas) : []),
    [activos, workDays, period, propinas],
  )
  const totalPropinas = useMemo(() => lineas.reduce((s, l) => s + l.propinasPeriodo, 0), [lineas])

  // Un activo con horas y sin tarifa cargada da neto ₡0 y queda fuera del archivo del
  // banco sin decir nada. Es el mismo silencio que el inactivo: alguien no cobra.
  const sinTarifa = useMemo(() => lineas.filter(l => l.sinTarifa), [lineas])

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

  const aPagar = lineas
    .map(l => ({ l, monto: Math.round(netoEfectivo(l)) }))
    .filter(x => x.monto > 0)
  const total = aPagar.reduce((s, x) => s + x.monto, 0)

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
      downloadPlanillaXlsx(
        aPagar.map(x => ({ nombre: x.l.nombreBanco, monto: x.monto })),
        concepto,
        planillaFileName('planilla-salarios', `${period.fecha_ini}-a-${period.fecha_fin}`),
      )
      setAviso(`Archivo generado: ${aPagar.length} transferencia(s) por ${fi(total)}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error generando el archivo')
    }
  }

  const handlePagar = async () => {
    if (!period || !user?.id) return
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

    const ok = window.confirm(
      `¿Marcar el período ${period.fecha_ini} → ${period.fecha_fin} como PAGADO?\n\n` +
      `${aPagar.length} empleado(s) · ${fi(total)}\n\n` +
      (avisos.length > 0 ? avisos.join('\n') + '\n\n' : '') +
      'Queda el registro del pago por transferencia. No genera movimiento de caja.',
    )
    if (!ok) return
    setSaving(true); setError(null)
    try {
      const n = await markPeriodPaid(
        period.id,
        aPagar.map(x => ({
          employee_id: x.l.employee.id,
          monto_neto:  x.monto,
          horas:       x.l.horas,
          hourly_rate: x.l.hourlyRate,
          fijo:        x.l.fijo,
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

      <div style={{ padding: '0 12px 8px', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: '0.72rem', color: '#888' }}>Período</label>
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

          {errPropinas && (
            <p style={{ padding: '0 12px 8px', fontSize: '0.75rem', color: '#8a6d3b' }}>
              ⚠️ No se pudieron leer las propinas del período ({errPropinas}). Las columnas
              informativas quedan en ₡0 — <strong>no es que nadie haya cobrado propinas</strong>.
              El pago por transferencia no depende de esto.
            </p>
          )}

          <table className="admin-table">
            <thead>
              <tr>
                <th>Empleado</th>
                <th>Nombre en el banco</th>
                <th>Tarifa/hora</th>
                <th>Horas</th>
                <th>Fijo</th>
                <th>Salario calculado</th>
                <th>A pagar (transferencia)</th>
                <th>Propinas del período</th>
                <th>Ingreso total</th>
              </tr>
            </thead>
            <tbody>
              {lineas.map(l => {
                const id = l.employee.id
                const horasVal = horasDraft[id] ?? String(l.horas)
                const netoVal  = netoDraft[id]  ?? ''
                return (
                  <tr key={id} className="admin-row">
                    <td className="admin-emp-name">{l.employee.full_name}</td>
                    <td style={{ fontSize: '0.75rem' }}>
                      {l.employee.nombre_homebanking
                        ? l.employee.nombre_homebanking
                        : <span style={{ opacity: 0.45 }}>{l.employee.full_name} (sin alias)</span>}
                    </td>
                    <td>
                      {l.hourlyRate > 0
                        ? fi(l.hourlyRate)
                        : l.sinTarifa
                          ? <strong style={{ color: 'var(--t-red, #b04a3a)' }}>sin tarifa</strong>
                          : <span style={{ opacity: 0.35 }}>—</span>}
                    </td>
                    <td>
                      <input
                        className="tip-input"
                        type="number"
                        min="0"
                        step="0.25"
                        aria-label={`Horas del período: ${l.employee.full_name}`}
                        value={horasVal}
                        onChange={e => setHorasDraft(d => ({ ...d, [id]: e.target.value }))}
                        onBlur={() => saveHoras(l)}
                        disabled={saving || congelado}
                        style={{ width: '80px' }}
                      />
                    </td>
                    <td>{l.fijo > 0 ? fi(l.fijo) : <span style={{ opacity: 0.35 }}>—</span>}</td>
                    <td>{fi(l.neto)}</td>
                    <td>
                      <input
                        className="tip-input"
                        type="number"
                        min="0"
                        step="1"
                        aria-label={`Neto a pagar: ${l.employee.full_name}`}
                        placeholder={String(Math.round(l.neto))}
                        value={netoVal}
                        onChange={e => setNetoDraft(d => ({ ...d, [id]: e.target.value }))}
                        disabled={saving || congelado}
                        style={{ width: '110px' }}
                      />
                    </td>
                    {/* Informativas: NO se transfieren. Van en gris y fuera de cualquier
                        total del archivo del banco, para que no se confundan con plata
                        que sale por esta pantalla. */}
                    <td style={{ color: '#8a6d3b' }}>
                      {l.propinasPeriodo > 0
                        ? fi(l.propinasPeriodo)
                        : <span style={{ opacity: 0.35 }}>—</span>}
                    </td>
                    <td style={{ fontWeight: 600 }}>
                      {fi(ingresoTotalDe(netoEfectivo(l), l.propinasPeriodo))}
                    </td>
                  </tr>
                )
              })}
              {lineas.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ padding: '1.5rem', textAlign: 'center', opacity: 0.4, fontSize: '0.8rem' }}>
                    No hay empleados activos.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div style={{ padding: '10px 12px', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <strong style={{ fontFamily: 'var(--font-serif)' }}>{fi(total)}</strong>
            <span style={{ fontSize: '0.72rem', color: '#888' }}>
              {aPagar.length} transferencia(s) · el resto queda fuera del archivo
            </span>
            {totalPropinas > 0 && (
              <span style={{ fontSize: '0.72rem', color: '#8a6d3b' }}>
                + {fi(totalPropinas)} de propinas <strong>que NO se transfieren</strong>
              </span>
            )}
            <span style={{ flex: 1 }} />
            <button
              className="btn-secondary"
              onClick={handleDownload}
              // El archivo del banco es lo que MUEVE la plata: "Marcar pagado" es solo el
              // registro. Frenar el registro y dejar bajar el Excel sería frenar la puerta
              // equivocada — se transferiría de más y recién después aparecería el bloqueo.
              // Por eso lo frena TODO lo que frena el pago, fichajes sin resolver incluidos.
              disabled={saving || aPagar.length === 0 || frenado || !!bloqueoPagar}
              title={
                frenado ? `Horas contadas dos veces: ${nombresDobles.join(', ')}`
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
                !puedePagar || frenado || !!bloqueoPagar
              }
              title={
                pagado ? undefined
                : estado !== 'cerrado' ? 'Cerrá el período antes de marcar el pago'
                : frenado ? `Horas contadas dos veces: ${nombresDobles.join(', ')}`
                : bloqueoPagar ? bloqueoPagar
                : puedePagar ? undefined : 'Solo el dueño o el gerente marcan el pago'
              }
            >
              {pagado ? 'Pagado' : 'Marcar pagado'}
            </button>
          </div>

          <p style={{ padding: '0 12px 12px', fontSize: '0.68rem', color: '#888' }}>
            El neto se calcula como horas × la tarifa del empleado (Empleados / Tarifas) + su salario
            fijo. Editarlo a mano ajusta
            solo lo que se paga en este período. El pago se registra como transferencia:
            <strong> no genera movimiento de caja</strong>.
            <br />
            <strong>Propinas del período</strong> e <strong>Ingreso total</strong> son{' '}
            <strong>solo informativas</strong>: las propinas ya se pagan aparte (efectivo / Caja)
            y <strong>no</strong> entran en la transferencia ni en el archivo del banco. Lo único
            que se transfiere es la columna <strong>A pagar (transferencia)</strong>.
          </p>
        </>
      )}
    </div>
  )
}
