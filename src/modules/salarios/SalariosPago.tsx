import { useState, useEffect, useCallback, useMemo } from 'react'
import type { Employee, EmployeePayment, EmployeeWageRate, SalaryPeriod, WorkDay } from '../../shared/types/database'
import {
  getSalaryPeriods, createSalaryPeriod, getWorkDays, upsertWorkDay, getWageRatesUpTo,
  getPeriodPayments, markPeriodPaid, consolidarPeriodo, getPunchExceptions, LOCAL_DEFAULT,
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
  const [rates, setRates]       = useState<EmployeeWageRate[]>([])
  const [workDays, setWorkDays] = useState<WorkDay[]>([])
  const [pagos, setPagos]       = useState<EmployeePayment[]>([])
  // F1d: un período con fichajes sin resolver no se paga. La lectura es null-safe
  // (devuelve [] si la tabla no está o la RLS dice que no), así que no puede tumbar
  // esta pantalla — solo puede FRENAR el pago, nunca habilitarlo por error.
  const [excAbiertas, setExcAbiertas] = useState(0)

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
    if (!p) { setWorkDays([]); setRates([]); setPagos([]); setExcAbiertas(0); return }
    try {
      const [wd, rs, pg, ex] = await Promise.all([
        getWorkDays(p.fecha_ini, p.fecha_fin),
        getWageRatesUpTo(p.fecha_fin),
        getPeriodPayments(p.id),
        getPunchExceptions(p.fecha_ini, p.fecha_fin, LOCAL_DEFAULT),
      ])
      setWorkDays(wd)
      setRates(rs)
      setPagos(pg)
      setExcAbiertas(ex.filter(x => x.estado === 'abierta').length)
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

  const lineas: LineaConsolidado[] = useMemo(
    () => (period ? consolidarPeriodo(activos, rates, workDays, period, LOCAL_DEFAULT) : []),
    [activos, rates, workDays, period],
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

  // Las horas se guardan al salir del campo (mismo gesto que el resto de la app: se
  // escribe, se sale, quedó). Se persiste SOLO la parte manual del total.
  const saveHoras = async (l: LineaConsolidado) => {
    const draft = horasDraft[l.employee.id]
    if (!period || draft == null) return
    const totalNuevo = num(draft)
    // Lo editable es la fila manual: si mañana BioTime aporta horas propias, no las pisamos.
    const manualNuevo = Math.max(0, totalNuevo - l.horasOtras)
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
    if (excAbiertas > 0) {
      setError(
        `El período tiene ${excAbiertas} excepción(es) de fichaje sin resolver. ` +
        'Resolvelas en la pestaña Horas antes de pagar: las horas de esos días todavía no son confiables.',
      )
      return
    }
    const ok = window.confirm(
      `¿Marcar el período ${period.fecha_ini} → ${period.fecha_fin} como PAGADO?\n\n` +
      `${aPagar.length} empleado(s) · ${fi(total)}\n\n` +
      'Queda el registro del pago por transferencia. No genera movimiento de caja.',
    )
    if (!ok) return
    setSaving(true); setError(null)
    try {
      const n = await markPeriodPaid(
        period.id,
        aPagar.map(x => ({ employee_id: x.l.employee.id, monto_neto: x.monto })),
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

          {excAbiertas > 0 && !pagado && (
            <p style={{ padding: '0 12px 8px', fontSize: '0.74rem', color: 'var(--t-red, #b04a3a)' }}>
              ⚠️ {excAbiertas} excepción(es) de fichaje sin resolver en este período. El pago queda
              bloqueado hasta que se cierren en la pestaña <strong>Horas</strong>.
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
                    <td>{l.rate ? fi(l.rate.hourly_rate_crc) : <span style={{ opacity: 0.35 }}>sin tarifa</span>}</td>
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
              disabled={saving || aPagar.length === 0}
            >
              Descargar Excel para el banco
            </button>
            <button
              className="btn-primary"
              onClick={handlePagar}
              disabled={saving || pagado || aPagar.length === 0 || !puedePagar || excAbiertas > 0}
              title={
                excAbiertas > 0
                  ? `${excAbiertas} excepción(es) de fichaje sin resolver (pestaña Horas)`
                  : puedePagar ? undefined : 'Solo el dueño o el gerente marcan el pago'
              }
            >
              {pagado ? 'Pagado' : 'Marcar pagado'}
            </button>
          </div>

          <p style={{ padding: '0 12px 12px', fontSize: '0.68rem', color: '#888' }}>
            El neto se calcula como horas × tarifa vigente + salario fijo. Editarlo a mano ajusta
            solo lo que se paga en este período. El pago se registra como transferencia:
            <strong> no genera movimiento de caja</strong>.
          </p>
        </>
      )}
    </div>
  )
}
