import { useState, useEffect, useCallback, useMemo } from 'react'
import type { Employee, PunchException, SalaryPeriod, TimePunch, WorkDay } from '../../shared/types/database'
import {
  getSalaryPeriods, getWorkDays, getPunchExceptions, getPunchesDeJornada,
  derivarWorkDays, resolvePunchException, overrideHorasDia,
  agruparExcepciones, etiquetaTipo, empleadosConHorasDobles, resumenImpares,
  HORAS_DEFAULT_IMPAR, LOCAL_DEFAULT,
  type DerivacionResumen, type GrupoExcepciones,
} from '../../shared/api/salarios'
import { useAuth } from '../../shared/hooks/useAuth'

// Salarios · BioTime F1d: la pantalla que convierte marcas en HORAS.
//
// Dos mitades: arriba el recálculo del período (la RPC `derivar_work_days` hace el
// emparejamiento en el servidor, esta pantalla solo lo pide y muestra el resumen), abajo
// la bandeja de lo que el emparejamiento NO pudo resolver, agrupada por persona.
//
// Acá no se calcula plata: ni tarifas, ni 10%, ni netos. Solo horas (eso es la Fase 2).

const LOCALES = ['santa-teresa', 'nosara']

// Las horas de un empleado en el rango, separadas por origen: lo derivado y lo cargado a
// mano. Se muestran separadas a propósito — sumarlas a ciegas es justo el error que
// `empleadosConHorasDobles` avisa.
interface FilaHoras {
  employee_id: string
  nombre:      string
  biotime:     number
  manual:      number
  dias:        number
  // Lo que el contador tiene que ver antes de pagar: cuántas de esas jornadas no salieron
  // del reloj sino de la regla de las 3 h, y cuántas midieron pero con marcas sueltas.
  dias3h:      number
  horas3h:     number
  conSuelta:   number
}

function hhmm(iso: string): string {
  // Costa Rica es UTC−6 fijo: la hora local sale del instante sin librería de zonas.
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const cr = new Date(d.getTime() - 6 * 3600_000)
  return `${String(cr.getUTCHours()).padStart(2, '0')}:${String(cr.getUTCMinutes()).padStart(2, '0')}`
}

interface Props {
  employees: Employee[]
}

export default function SalariosHoras({ employees }: Props) {
  const { user, profile } = useAuth()
  const puedeRecalcular =
    profile?.role === 'owner' || profile?.role === 'manager' || profile?.role === 'contador'

  const [periods, setPeriods]   = useState<SalaryPeriod[]>([])
  const [periodId, setPeriodId] = useState('')
  const [local, setLocal]       = useState(LOCAL_DEFAULT)
  const [workDays, setWorkDays] = useState<WorkDay[]>([])
  const [excs, setExcs]         = useState<PunchException[]>([])
  const [resumen, setResumen]   = useState<DerivacionResumen | null>(null)

  const [abierto, setAbierto]   = useState<string | null>(null)     // grupo expandido
  const [marcas, setMarcas]     = useState<Record<string, TimePunch[]>>({})
  const [horasDraft, setHoras]  = useState<Record<string, string>>({})

  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const period = periods.find(p => p.id === periodId) ?? null

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

  const loadDatos = useCallback(async (p: SalaryPeriod | null, loc: string) => {
    if (!p) { setWorkDays([]); setExcs([]); return }
    try {
      const [wd, ex] = await Promise.all([
        getWorkDays(p.fecha_ini, p.fecha_fin),
        getPunchExceptions(p.fecha_ini, p.fecha_fin, loc),
      ])
      setWorkDays(wd)
      setExcs(ex)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando las horas')
    }
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadDatos(period, local) }, [loadDatos, period, local])

  const filas: FilaHoras[] = useMemo(() => {
    const nombreDe = new Map(employees.map(e => [e.id, e.full_name]))
    const impares  = resumenImpares(workDays, local)
    const acc = new Map<string, FilaHoras>()
    for (const w of workDays) {
      if (w.local !== local) continue
      const imp = impares.get(w.employee_id)
      const f = acc.get(w.employee_id) ?? {
        employee_id: w.employee_id,
        nombre: nombreDe.get(w.employee_id) ?? '—',
        biotime: 0, manual: 0, dias: 0,
        dias3h: imp?.dias3h ?? 0, horas3h: imp?.horas3h ?? 0, conSuelta: imp?.diasConSuelta ?? 0,
      }
      const h = Number(w.hours) || 0
      if (w.source === 'biotime') { f.biotime += h; f.dias += 1 }
      else f.manual += h
      acc.set(w.employee_id, f)
    }
    return [...acc.values()]
      .filter(f => f.biotime > 0 || f.manual > 0 || f.dias > 0)
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [workDays, employees, local])

  const total3h = useMemo(() => filas.reduce((s, f) => s + f.dias3h, 0), [filas])

  const grupos: GrupoExcepciones[] = useMemo(
    () => agruparExcepciones(excs, employees),
    [excs, employees],
  )

  // Misma definición que usa la pantalla de pago: solo el TOTAL del período cargado a
  // mano (fila manual del último día) choca con lo derivado. Sin filtrar local, porque el
  // neto que se paga tampoco filtra.
  const dobles = useMemo(
    () => (period ? empleadosConHorasDobles(workDays, period.fecha_fin) : []),
    [workDays, period],
  )

  const handleRecalcular = async () => {
    if (!period) return
    setBusy(true); setError(null)
    try {
      const r = await derivarWorkDays(period.fecha_ini, period.fecha_fin, local)
      setResumen(r)
      await loadDatos(period, local)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error recalculando las horas')
    } finally {
      setBusy(false)
    }
  }

  // Las marcas crudas se traen recién al abrir el día: son la evidencia contra el reporte
  // de BioTime y no hacen falta hasta que alguien mira el caso.
  const verMarcas = async (x: PunchException) => {
    if (!x.work_date) return
    const k = `${x.local ?? local}|${x.work_date}`
    if (marcas[k]) return
    const ms = await getPunchesDeJornada(x.local ?? local, x.work_date)
    setMarcas(m => ({ ...m, [k]: ms }))
  }

  const handleResolver = async (x: PunchException) => {
    if (!user?.id) { setError('Sesión sin usuario.'); return }
    setBusy(true); setError(null)
    try {
      await resolvePunchException(x.id, user.id)
      // El resumen es la foto del último recálculo: apenas los datos cambian por otra
      // vía deja de ser cierto, y dos números distintos del mismo concepto en la misma
      // pantalla es peor que ninguno.
      setResumen(null)
      await loadDatos(period, local)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error resolviendo la excepción')
    } finally {
      setBusy(false)
    }
  }

  // Corregir a mano = escribir la jornada como `manual` (que el recálculo ya no pisa) y
  // dar la excepción por resuelta en el mismo gesto.
  const handleOverride = async (x: PunchException) => {
    if (!user?.id || !x.employee_id || !x.work_date) return
    const draft = horasDraft[x.id]
    if (draft == null || draft.trim() === '') { setError('Escribí las horas del día.'); return }
    const horas = Number(draft)
    if (isNaN(horas) || horas < 0) { setError('Horas inválidas.'); return }
    const wd = workDays.find(
      w => w.employee_id === x.employee_id && w.work_date === x.work_date && w.local === (x.local ?? local),
    )
    setBusy(true); setError(null)
    try {
      await overrideHorasDia({
        employee_id:   x.employee_id,
        work_date:     x.work_date,
        local:         x.local ?? local,
        hours:         horas,
        userId:        user.id,
        horas_biotime: wd ? Number(wd.hours) || 0 : null,
      })
      await resolvePunchException(x.id, user.id)
      setHoras(d => { const r = { ...d }; delete r[x.id]; return r })
      setResumen(null)
      await loadDatos(period, local)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error corrigiendo las horas')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center', opacity: 0.4 }}>⏳</div>
  }

  return (
    <div className="admin-section">
      <div className="admin-section-header">
        <span className="admin-section-title">Horas del período · BioTime</span>
      </div>

      <div style={{ padding: '0 12px 8px', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: '0.72rem', color: '#888' }}>Período</label>
        <select
          className="tip-input"
          aria-label="Período"
          value={periodId}
          onChange={e => { setPeriodId(e.target.value); setResumen(null) }}
          disabled={busy}
        >
          <option value="">— elegir —</option>
          {periods.map(p => (
            <option key={p.id} value={p.id}>{p.fecha_ini} → {p.fecha_fin} · {p.estado}</option>
          ))}
        </select>
        <label style={{ fontSize: '0.72rem', color: '#888' }}>Local</label>
        <select
          className="tip-input"
          aria-label="Local"
          value={local}
          onChange={e => { setLocal(e.target.value); setResumen(null) }}
          disabled={busy}
        >
          {LOCALES.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <button
          className="btn-primary"
          onClick={handleRecalcular}
          disabled={busy || !period || !puedeRecalcular}
          title={puedeRecalcular ? undefined : 'Solo gerencia y contador recalculan'}
        >
          {busy ? 'Recalculando…' : 'Recalcular horas del período'}
        </button>
      </div>

      {error && <p className="field-error" style={{ padding: '0 12px' }}>{error}</p>}

      {!period ? (
        <p style={{ padding: '1.5rem', textAlign: 'center', opacity: 0.45, fontSize: '0.8rem' }}>
          Elegí un período para ver y recalcular las horas.
        </p>
      ) : (
        <>
          {resumen && (
            <p style={{ padding: '0 12px 8px', fontSize: '0.75rem', color: 'var(--t-teal)' }}>
              {resumen.marcas} marca(s) · {resumen.dias} jornada(s) · {Number(resumen.horas).toFixed(2)} h ·{' '}
              {resumen.excepciones.impar + resumen.excepciones.turno_largo +
               resumen.excepciones.solapado + resumen.excepciones.sin_mapear} excepción(es)
              {resumen.dias_3h_default > 0 && (
                <> · <strong>{resumen.dias_3h_default} jornada(s) a {HORAS_DEFAULT_IMPAR} h por defecto</strong> (sin ninguna marca cerrada)</>
              )}
              {resumen.dias_omitidos_manual > 0 && (
                <> · <strong>{resumen.dias_omitidos_manual} jornada(s) NO se tocaron</strong> porque ya tenían horas cargadas a mano</>
              )}
            </p>
          )}

          {dobles.length > 0 && (
            <p style={{ padding: '0 12px 8px', fontSize: '0.72rem', color: 'var(--t-red, #b04a3a)' }}>
              ⚠️ {dobles.length} empleado(s) tienen horas cargadas a mano <em>y</em> horas de BioTime en este
              período: el total del período las SUMA. Revisá cuál de las dos vale antes de pagar.
            </p>
          )}

          {total3h > 0 && (
            <p style={{ padding: '0 12px 8px', fontSize: '0.74rem', color: '#8a6d3b' }}>
              🕒 <strong>{total3h} jornada(s)</strong> del período se contaron a{' '}
              {HORAS_DEFAULT_IMPAR} h por no tener ninguna marca cerrada. Son horas puestas por la
              regla, no medidas por el reloj: revisalas antes de cerrar la nómina.
            </p>
          )}

          <table className="admin-table">
            <thead>
              <tr>
                <th>Empleado</th>
                <th>Jornadas</th>
                <th>Días a {HORAS_DEFAULT_IMPAR} h</th>
                <th>Días c/ marca suelta</th>
                <th>Horas BioTime</th>
                <th>Horas a mano</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {filas.map(f => (
                <tr key={f.employee_id} className="admin-row">
                  <td className="admin-emp-name">{f.nombre}</td>
                  <td>{f.dias}</td>
                  <td>
                    {f.dias3h > 0
                      ? <span title={`${f.horas3h.toFixed(2)} h puestas por la regla, no medidas`}>
                          <strong>{f.dias3h}</strong> ({f.horas3h.toFixed(0)} h)
                        </span>
                      : <span style={{ opacity: 0.35 }}>—</span>}
                  </td>
                  <td>{f.conSuelta > 0 ? f.conSuelta : <span style={{ opacity: 0.35 }}>—</span>}</td>
                  <td>{f.biotime.toFixed(2)}</td>
                  <td>{f.manual > 0 ? f.manual.toFixed(2) : <span style={{ opacity: 0.35 }}>—</span>}</td>
                  <td><strong>{(f.biotime + f.manual).toFixed(2)}</strong></td>
                </tr>
              ))}
              {filas.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: '1.5rem', textAlign: 'center', opacity: 0.4, fontSize: '0.8rem' }}>
                    Todavía no hay horas para este período. Recalculá para derivarlas de las marcas.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* ── Bandeja ─────────────────────────────────────────────────────── */}
          <div className="admin-section-header" style={{ marginTop: '1rem' }}>
            <span className="admin-section-title">
              Excepciones de fichaje ({grupos.reduce((s, g) => s + g.abiertas, 0)})
            </span>
          </div>

          {grupos.length === 0 ? (
            <p style={{ padding: '1rem 12px', fontSize: '0.78rem', opacity: 0.5 }}>
              Sin excepciones abiertas en este período.
            </p>
          ) : (
            <div style={{ padding: '0 12px 12px' }}>
              {grupos.map(g => (
                <div key={g.key} style={{ borderBottom: '1px solid var(--t-line, #e5e2dc)' }}>
                  <div
                    onClick={() => setAbierto(a => (a === g.key ? null : g.key))}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.55rem 0', cursor: 'pointer' }}
                  >
                    <span style={{ opacity: 0.5, fontSize: '0.7rem' }}>{abierto === g.key ? '▾' : '▸'}</span>
                    <strong style={{ fontSize: '0.82rem' }}>{g.nombre}</strong>
                    <span className="role-badge">{g.abiertas}</span>
                    <span style={{ fontSize: '0.7rem', color: '#888' }}>
                      {Object.entries(g.tipos).map(([t, n]) => `${etiquetaTipo(t)} ×${n}`).join(' · ')}
                    </span>
                  </div>

                  {abierto === g.key && (
                    <div style={{ padding: '0 0 0.75rem 1.4rem' }}>
                      {g.items.map(x => {
                        const k = `${x.local ?? local}|${x.work_date}`
                        const ms = marcas[k]
                        return (
                          <div key={x.id} style={{ padding: '0.4rem 0', fontSize: '0.76rem' }}>
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                              <span style={{ fontFamily: 'var(--font-mono, monospace)' }}>{x.work_date}</span>
                              <span className="role-badge">{etiquetaTipo(x.tipo)}</span>
                              <button className="btn-secondary" onClick={() => verMarcas(x)} disabled={busy}>
                                Ver marcas
                              </button>
                              {x.employee_id && x.work_date && (
                                <>
                                  <input
                                    className="tip-input"
                                    type="number"
                                    min="0"
                                    step="0.25"
                                    placeholder="horas"
                                    aria-label={`Horas corregidas ${x.work_date}`}
                                    value={horasDraft[x.id] ?? ''}
                                    onChange={e => setHoras(d => ({ ...d, [x.id]: e.target.value }))}
                                    disabled={busy}
                                    style={{ width: '80px' }}
                                  />
                                  <button className="btn-primary" onClick={() => handleOverride(x)} disabled={busy}>
                                    Corregir a mano
                                  </button>
                                </>
                              )}
                              <button className="btn-secondary" onClick={() => handleResolver(x)} disabled={busy}>
                                Marcar resuelta
                              </button>
                            </div>
                            {ms && (
                              <div style={{ padding: '0.3rem 0 0 0.2rem', fontSize: '0.72rem', color: '#888' }}>
                                {ms.length === 0
                                  ? 'sin marcas crudas para esa jornada'
                                  : ms
                                      // La jornada trae las marcas de TODO el local: se
                                      // muestran solo las del caso (por empleado si está
                                      // resuelto, por código si es una sin_mapear).
                                      .filter(m => x.employee_id
                                        ? m.employee_id === x.employee_id
                                        : m.emp_code === x.emp_code)
                                      .map(m => `${hhmm(m.punch_at)} ${m.punch_state}`)
                                      .join('  ·  ')}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <p style={{ padding: '0 12px 12px', fontSize: '0.68rem', color: '#888' }}>
            El recálculo empareja entrada/salida por jornada (corte 05:00) y reescribe SOLO las horas
            derivadas de BioTime: lo cargado a mano no se toca nunca. Corregir a mano una jornada la deja
            como manual, así que el próximo recálculo la respeta. Un día con marcas pero <em>sin ninguna
            cerrada</em> se cuenta a <strong>{HORAS_DEFAULT_IMPAR} h por defecto</strong>: es un número
            puesto por la regla, no medido — si tenés el real, corregilo desde la bandeja.
            <strong> Acá no se calcula plata.</strong>
          </p>
        </>
      )}
    </div>
  )
}
