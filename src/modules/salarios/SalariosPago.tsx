import { useState, useEffect, useCallback, useMemo } from 'react'
import type { Employee, EmployeePayment, PunchException, SalaryPeriod, WorkDay } from '../../shared/types/database'
import {
  getSalaryPeriods, createSalaryPeriod, getWorkDays, upsertWorkDay,
  getPeriodPayments, markPeriodPaid, consolidarPeriodo, getPunchExceptionsTodosLosLocales,
  semaforoPago, HORAS_DEFAULT_IMPAR, LOCAL_DEFAULT,
  type LineaConsolidado,
} from '../../shared/api/salarios'
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

  const period = periods.find(p => p.id === periodId) ?? null
  const pagado = period?.estado === 'pagado'

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
    if (!p) { setWorkDays([]); setPagos([]); setExcs([]); setOkDobles(false); return }
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

  const lineas: LineaConsolidado[] = useMemo(
    () => (period ? consolidarPeriodo(activos, workDays, period, LOCAL_DEFAULT) : []),
    [activos, workDays, period],
  )

  // Un activo con horas y sin tarifa cargada da neto ₡0 y queda fuera del archivo del
  // banco sin decir nada. Es el mismo silencio que el inactivo: alguien no cobra.
  const sinTarifa = useMemo(() => lineas.filter(l => l.sinTarifa), [lineas])

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

    // Los avisos que no frenan viajan al confirm, para que quien paga los vea en el
    // último momento y no en un cartel que ya scrolleó.
    // A8 · paso consciente, no bloqueo: quien paga tiene que decir que sí a las horas que
    // NO midió el reloj. Va en su propio confirm y no mezclado con el resto, porque es la
    // única cifra de la nómina que salió de una política y no de un dato.
    if (semaforo.diasIncompletos > 0) {
      const sigue = window.confirm(
        `${semaforo.diasIncompletos} día(s) con marca incompleta contados a ${HORAS_DEFAULT_IMPAR} h.\n\n` +
        `${semaforo.tramos} tramo(s) sin cerrar = ${semaforo.horasDefault.toFixed(0)} h que no midió ` +
        'el reloj (los tramos bien marcados de esos días sí cuentan sus horas reales).\n\n' +
        'Se pueden corregir uno por uno en la pestaña Horas.\n\n¿Pagar igual?',
      )
      if (!sigue) return
    }

    // Marcas de alguien que no está en el maestro: el riesgo no es pagar de más, es que
    // haya UNA PERSONA que no cobra. No se puede resolver desde acá (falta darla de alta).
    if (semaforo.sinMapearDias > 0) {
      const sigue = window.confirm(
        `Hay ${semaforo.sinMapearMarcas} marca(s) de fichaje sin empleado asignado ` +
        `(${semaforo.sinMapearDias} jornada(s)).\n\n` +
        'Puede que alguien NO ESTÉ COBRANDO este período.\n\n' +
        'Se asigna el código en Empleados / Tarifas y después se recalculan las horas.\n\n' +
        '¿Pagar igual?',
      )
      if (!sigue) return
    }

    const avisos: string[] = []
    if (sinTarifa.length > 0) {
      avisos.push(
        `⛔ SIN TARIFA (neto ₡0, quedan fuera del archivo): ${sinTarifa.map(l => l.employee.full_name).join(', ')}.`,
      )
    }
    if (semaforo.dobles.length > 0) {
      avisos.push(`⚠️ Horas dobles confirmadas a mano: ${nombresDobles.join(', ')}.`)
    }
    if (semaforo.fichajeDias > 0) {
      avisos.push(`${semaforo.fichajeDias} jornada(s) con fichaje incompleto sin revisar en la bandeja.`)
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
        {pagado && (
          <span className="role-badge" style={{ color: 'var(--t-teal)' }}>
            pagado · {pagos.length} registro(s)
          </span>
        )}
      </div>

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
              de esos días sí cuentan sus horas reales.
            </p>
          )}

          {!pagado && semaforo.fichajeDias > 0 && (
            <p style={{ padding: '0 12px 8px', fontSize: '0.72rem', color: '#888' }}>
              {semaforo.fichajeDias} jornada(s) con fichaje incompleto sin revisar en la bandeja
              (pestaña <strong>Horas</strong>). No frenan el pago.
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

          <table className="admin-table">
            <thead>
              <tr>
                <th>Empleado</th>
                <th>Nombre en el banco</th>
                <th>Tarifa/hora</th>
                <th>Horas</th>
                <th>Fijo</th>
                <th>Neto calculado</th>
                <th>Neto a pagar</th>
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
                        disabled={saving || pagado}
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
                        disabled={saving || pagado}
                        style={{ width: '110px' }}
                      />
                    </td>
                  </tr>
                )
              })}
              {lineas.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: '1.5rem', textAlign: 'center', opacity: 0.4, fontSize: '0.8rem' }}>
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
            <span style={{ flex: 1 }} />
            <button
              className="btn-secondary"
              onClick={handleDownload}
              // El archivo del banco es lo que MUEVE la plata: "Marcar pagado" es solo el
              // registro. Frenar el registro y dejar bajar el Excel sería frenar la puerta
              // equivocada — se transferiría de más y recién después aparecería el bloqueo.
              disabled={saving || aPagar.length === 0 || frenado}
              title={frenado ? `Horas contadas dos veces: ${nombresDobles.join(', ')}` : undefined}
            >
              Descargar Excel para el banco
            </button>
            <button
              className="btn-primary"
              onClick={handlePagar}
              disabled={saving || pagado || aPagar.length === 0 || !puedePagar || frenado}
              title={
                frenado
                  ? `Horas contadas dos veces: ${nombresDobles.join(', ')}`
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
          </p>
        </>
      )}
    </div>
  )
}
