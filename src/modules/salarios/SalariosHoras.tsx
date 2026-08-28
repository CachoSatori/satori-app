import { useState, useEffect, useCallback, useMemo } from 'react'
import type { Employee, PunchException, SalaryPeriod, TimePunch, WorkDay } from '../../shared/types/database'
import {
  getSalaryPeriods, getWorkDays, getPunchExceptions, getPunchesDeJornada,
  derivarWorkDays, resolvePunchException, overrideHorasDia,
  agruparExcepciones, etiquetaTipo, empleadosConHorasDobles, resumenImpares, marcasDelCaso,
  HORAS_DEFAULT_IMPAR, LOCAL_DEFAULT,
  // Capa 3 (mig 061): la regla de horario del empleado.
  imparesConRegla, horaHabitualFaltante, motivoRegla, hhmmCR as hhmm, MOTIVO_REGLA,
  // v3 · la pantalla se abre con horas: si el período está vivo y vacío, se derivan solas.
  autoDerivarSiVacio, codigosSinMapear,
  type DerivacionResumen, type GrupoExcepciones,
} from '../../shared/api/salarios'
import { useAuth } from '../../shared/hooks/useAuth'
import { ROLE_LABELS } from '../../shared/constants'
import {
  horasEntreMarcas, motivoCorreccion, marcaUnicaDeImpar, HORAS_SOSPECHOSAS,
} from '../../shared/utils/horasCorreccion'

// Salarios · BioTime F1d: la pantalla que convierte marcas en HORAS.
//
// Dos mitades: arriba el recálculo del período (la RPC `derivar_work_days` hace el
// emparejamiento en el servidor, esta pantalla solo lo pide y muestra el resumen), abajo
// la bandeja de lo que el emparejamiento NO pudo resolver, agrupada por persona.
//
// Acá no se calcula plata: ni tarifas, ni 10%, ni netos. Solo horas (eso es la Fase 2).

const LOCALES = ['santa-teresa', 'nosara']
// v3 · el slug es la clave (cruza con `locations.id` y con `work_days.local`); la etiqueta
// es lo que se lee. Antes se mostraba el slug crudo.
const LOCAL_LABEL: Record<string, string> = {
  'santa-teresa': 'Santa Teresa',
  'nosara':       'Nosara',
}

// Las horas de un empleado en el rango, separadas por origen: lo derivado y lo cargado a
// mano. Se muestran separadas a propósito — sumarlas a ciegas es justo el error que
// `empleadosConHorasDobles` avisa.
interface FilaHoras {
  employee_id: string
  nombre:      string
  biotime:     number
  manual:      number
  dias:        number
  // Lo que el contador tiene que ver antes de pagar (A8): cuántas jornadas quedaron
  // incompletas y qué parte de las horas la puso la regla en vez del reloj.
  incompletos:  number   // jornadas con algún tramo sin cerrar
  tramos:       number   // tramos sin cerrar (cada uno vale HORAS_DEFAULT_IMPAR)
  horasDefault: number   // las horas que puso la regla
  horasMedidas: number   // las que midió el reloj
}

// De qué lado quedó la marca real: lo que dijo BioTime, salvo que alguien lo haya
// volteado en la pantalla. BioTime se equivoca seguido con quien marca UNA sola vez.
type LadoMap = Record<string, 'in' | 'out'>
function ladoConDraft(id: string, porDefecto: 'in' | 'out', draft: LadoMap): 'in' | 'out' {
  return draft[id] ?? porDefecto
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
  // Capa 2 · corrección por resta, por caso (keyed por x.id, sin fuga entre filas):
  // de qué lado va la marca real, y la mitad que falta en formato reloj.
  const [ladoDraft, setLado]    = useState<Record<string, 'in' | 'out'>>({})
  const [compDraft, setComp]    = useState<Record<string, string>>({})

  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState<string | null>(null)
  // Aviso ≠ error: la regla puede dar un turno absurdo y eso se avisa SIN teñir de rojo
  // ni frenar nada, igual que en Capa 2.
  const [aviso, setAviso]     = useState<string | null>(null)
  // v3 · resumen de la derivación AUTOMÁTICA (la del botón vive en `resumen`). Se separan
  // porque dicen cosas distintas: una la pidió el usuario, la otra pasó sola al abrir.
  const [autoDeriv, setAutoDeriv] = useState<DerivacionResumen | null>(null)

  const period = periods.find(p => p.id === periodId) ?? null
  const empById = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees])

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
    if (!p) { setWorkDays([]); setExcs([]); setAutoDeriv(null); return }
    try {
      let [wd, ex] = await Promise.all([
        getWorkDays(p.fecha_ini, p.fecha_fin),
        getPunchExceptions(p.fecha_ini, p.fecha_fin, loc),
      ])
      // v3 · un período VIVO y sin una sola hora en este local se deriva solo. Antes la
      // pantalla abría vacía y había que saber que existía un botón. Las guardas viven en
      // `autoDerivarSiVacio`: no toca períodos congelados, no pisa horas cargadas a mano,
      // y si falla devuelve null en vez de tumbar la pantalla.
      const auto = await autoDerivarSiVacio(p, wd, loc)
      setAutoDeriv(auto)
      if (auto) {
        [wd, ex] = await Promise.all([
          getWorkDays(p.fecha_ini, p.fecha_fin),
          getPunchExceptions(p.fecha_ini, p.fecha_fin, loc),
        ])
      }
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
        incompletos: imp?.diasIncompletos ?? 0, tramos: imp?.tramos ?? 0,
        horasDefault: imp?.horasDefault ?? 0, horasMedidas: imp?.horasMedidas ?? 0,
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

  const totalIncompletos = useMemo(() => filas.reduce((s, f) => s + f.incompletos, 0), [filas])
  const totalDefault     = useMemo(() => filas.reduce((s, f) => s + f.horasDefault, 0), [filas])

  const grupos: GrupoExcepciones[] = useMemo(
    () => agruparExcepciones(excs, employees),
    [excs, employees],
  )

  // Misma definición que usa la pantalla de pago: solo el TOTAL del período cargado a
  // mano (fila manual del último día) choca con lo derivado. Sin filtrar local, porque el
  // neto que se paga tampoco filtra.
  // Solo presentación: el conteo de resueltas sale de las mismas `excs` que ya se
  // cargaron (`getPunchExceptions` trae el período entero, `agruparExcepciones` es la que
  // se queda con las abiertas). No hay lectura nueva.
  const abiertasTotal = useMemo(() => grupos.reduce((n, g) => n + g.abiertas, 0), [grupos])
  const resueltasTotal = useMemo(
    () => excs.filter(x => x.estado === 'resuelta').length,
    [excs],
  )
  // El puesto para el badge del grupo. La clave del grupo es el employee_id, salvo en las
  // `sin_mapear`, que se agrupan por `code:NN` y no tienen empleado todavía.
  const puestoDe = useMemo(() => {
    const m = new Map(employees.map(e => [e.id, ROLE_LABELS[e.role] ?? e.role]))
    return (key: string) => (key.startsWith('code:') ? null : m.get(key) ?? null)
  }, [employees])

  const dobles = useMemo(
    () => (period ? empleadosConHorasDobles(workDays, period.fecha_fin) : []),
    [workDays, period],
  )

  /**
   * Los impares de un grupo que la regla del empleado puede completar. El rótulo del botón
   * y lo que el botón hace salen de ACÁ, así el número que se lee es exactamente el número
   * que se va a escribir.
   *
   * Se descuenta lo que la persona ya escribió a mano en ese caso: si alguien puso una hora
   * distinta para un día puntual, la regla no se la pisa.
   */
  const aplicablesDe = useCallback(
    (g: GrupoExcepciones) =>
      imparesConRegla(
        g.items,
        empById.get(g.key) ?? null,
        (x, porDefecto) => ladoConDraft(x.id, porDefecto, ladoDraft),
      ).filter(a => !compDraft[a.x.id]),
    [empById, ladoDraft, compDraft],
  )

  // v3 · marcas que no son de nadie del maestro. Van ARRIBA y siempre: son horas que
  // alguien trabajó y que hoy no se le pagan a nadie.
  const sinMapear = useMemo(() => codigosSinMapear(excs), [excs])

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

  /**
   * Capa 2: guardar la corrección por RESTA. Mismo camino de siempre —override manual +
   * resolver— pero las horas salen de dos marcas de reloj en vez de que alguien las
   * estime. El `motivo` deja escrito cuál mitad la puso el reloj y cuál la persona.
   */
  const handleGuardarReloj = async (x: PunchException, entrada: string, salida: string, horas: number) => {
    if (!user?.id || !x.employee_id || !x.work_date) return
    const marca = marcaUnicaDeImpar(x)
    if (!marca) return
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
        motivo:        motivoCorreccion(entrada, salida, ladoConDraft(x.id, marca.punch_state, ladoDraft), hhmm(marca.punch_at)),
      })
      await resolvePunchException(x.id, user.id)
      setComp(d => { const r = { ...d }; delete r[x.id]; return r })
      setLado(d => { const r = { ...d }; delete r[x.id]; return r })
      setResumen(null)
      await loadDatos(period, local)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error guardando la corrección')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Capa 3: aplicar el horario habitual del empleado a TODOS sus impares del período.
   *
   * Es el mismo camino de Capa 2 repetido —override manual + resolver— sin ningún atajo:
   * cada día se escribe con sus horas por resta y su propio motivo. Lo único que cambia es
   * quién puso la mitad que faltaba, y el motivo lo deja dicho.
   *
   * Nunca alcanza a un día sin marcas: `imparesConRegla` solo devuelve impares de UNA
   * marca, donde el reloj ya probó que la persona estuvo.
   */
  const handleAplicarRegla = async (g: GrupoExcepciones) => {
    if (!user?.id) { setError('Sesión sin usuario.'); return }
    const aplicables = aplicablesDe(g)
    if (aplicables.length === 0) return
    setBusy(true); setError(null); setAviso(null)
    // Se va a escribir sí o sí (aplicables > 0) → el resumen del último recálculo deja de
    // ser cierto desde acá.
    setResumen(null)
    let hechos = 0
    try {
      const sospechosos: string[] = []
      for (const a of aplicables) {
        const x = a.x
        if (!x.employee_id || !x.work_date) continue
        const loc = x.local ?? local
        const wd = workDays.find(
          w => w.employee_id === x.employee_id && w.work_date === x.work_date && w.local === loc,
        )
        await overrideHorasDia({
          employee_id:   x.employee_id,
          work_date:     x.work_date,
          local:         loc,
          hours:         a.horas,
          userId:        user.id,
          horas_biotime: wd ? Number(wd.hours) || 0 : null,
          motivo:        motivoRegla(a.entrada, a.salida, a.lado, a.horaReal),
        })
        await resolvePunchException(x.id, user.id)
        hechos += 1
        if (a.horas > HORAS_SOSPECHOSAS) sospechosos.push(`${x.work_date} (${a.horas} h)`)
      }
      await loadDatos(period, local)
      // Avisa, no bloquea: un turno largo de verdad existe y frenar obligaría a inventar
      // un número más chico.
      if (sospechosos.length > 0) {
        setAviso(`Se aplicó la regla. Revisá: más de ${HORAS_SOSPECHOSAS} h en ${sospechosos.join(', ')}.`)
      }
    } catch (e) {
      // A mitad de camino: unos días ya quedaron escritos y otros no. Decir CUÁNTOS, y
      // releer para que la bandeja muestre lo que de verdad quedó — apretar de nuevo sigue
      // por los que faltan, porque los hechos ya salieron de la lista de abiertas.
      await loadDatos(period, local).catch(() => {})
      const msg = e instanceof Error ? e.message : 'Error aplicando el horario habitual'
      setError(hechos > 0
        ? `${msg}. Se corrigieron ${hechos} de ${aplicables.length} días; apretá de nuevo para seguir con el resto.`
        : msg)
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

      {/* v3 · Local primero. Acá el filtro NO es cosmético: la bandeja de excepciones se
          lee por local (cada BioTime tiene su propia secuencia de marcas). */}
      <div className="sal-bar">
        <span className="sal-bar-label">Local</span>
        <div className="sal-pills" role="group" aria-label="Local">
          {LOCALES.map(l => (
            <button
              key={l}
              type="button"
              className={`sal-pill ${local === l ? 'is-active' : ''}`}
              aria-pressed={local === l}
              onClick={() => { setLocal(l); setResumen(null) }}
              disabled={busy}
            >
              {LOCAL_LABEL[l] ?? l}
            </button>
          ))}
        </div>
      </div>

      <div className="sal-bar">
        <span className="sal-bar-label">Período</span>
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
        <span className="sal-spacer" />
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
      {aviso && (
        <p className="fx-aviso" role="status" style={{ padding: '0 12px' }}>⚠️ {aviso}</p>
      )}

      {!period ? (
        <p style={{ padding: '1.5rem', textAlign: 'center', opacity: 0.45, fontSize: '0.8rem' }}>
          Elegí un período para ver y recalcular las horas.
        </p>
      ) : (
        <>
          {autoDeriv && (
            <p className="sal-note sal-note-teal" role="status">
              <span className="sal-note-mk">◆</span>
              <span>
                El período no tenía horas cargadas: se derivaron solas desde BioTime{' '}
                (<strong>{autoDeriv.marcas} marca(s)</strong> · {autoDeriv.dias} jornada(s) ·{' '}
                {Number(autoDeriv.horas).toFixed(2)} h).
                {autoDeriv.dias_omitidos_manual > 0 && (
                  <> {autoDeriv.dias_omitidos_manual} jornada(s) con horas cargadas a mano{' '}
                    <strong>no se tocaron</strong>.</>
                )}{' '}
                Para forzar un recálculo está el botón.
              </span>
            </p>
          )}

          {sinMapear.length > 0 && (
            <div className="sal-nomap">
              <div className="sal-nomap-head">
                <span className="sal-note-mk">!</span>
                <strong>{sinMapear.length} código(s) de BioTime sin empleado</strong>
                <span className="sal-spacer" />
                <span className="sal-nomap-hint">
                  Estas horas hoy no se le pagan a nadie
                </span>
              </div>
              <ul className="sal-nomap-list">
                {sinMapear.map(c => (
                  <li key={c.code}>
                    <span className="sal-nomap-code">{c.code}</span>
                    <span className="sal-nomap-meta">
                      {c.marcas} marca(s) · {c.dias} jornada(s)
                    </span>
                  </li>
                ))}
              </ul>
              <p className="sal-legend" style={{ margin: '0 14px 12px' }}>
                Asignale el código a la persona en <strong>Empleados / Tarifas</strong> (campo
                «Cód. BioTime») y volvé a recalcular. Acá solo se listan: el mapeo
                código→persona lo firma quien corresponde.
              </p>
            </div>
          )}

          {resumen && (
            <p style={{ padding: '0 12px 8px', fontSize: '0.75rem', color: 'var(--t-teal)' }}>
              {resumen.marcas} marca(s) · {resumen.dias} jornada(s) · {Number(resumen.horas).toFixed(2)} h ·{' '}
              {resumen.excepciones.impar + resumen.excepciones.turno_largo +
               resumen.excepciones.solapado + resumen.excepciones.sin_mapear} excepción(es)
              {resumen.dias_incompletos > 0 && (
                <> · <strong>{resumen.dias_incompletos} jornada(s) incompleta(s)</strong>:{' '}
                  {resumen.tramos_sin_cerrar} tramo(s) sin cerrar ={' '}
                  {Number(resumen.horas_default).toFixed(0)} h a {HORAS_DEFAULT_IMPAR} h por tramo</>
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

          {totalIncompletos > 0 && (
            <p style={{ padding: '0 12px 8px', fontSize: '0.74rem', color: '#8a6d3b' }}>
              🕒 <strong>{totalIncompletos} jornada(s) incompleta(s)</strong> en el período:{' '}
              <strong>{totalDefault.toFixed(0)} h</strong> las puso la regla ({HORAS_DEFAULT_IMPAR} h
              por cada tramo sin cerrar), no el reloj. Los tramos que SÍ cerraron cuentan sus horas
              reales — revisá estas antes de cerrar la nómina.
            </p>
          )}

          <div className="sal-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Empleado</th>
                <th>Jornadas</th>
                <th>Incompletas</th>
                <th>Horas medidas</th>
                <th>Horas default</th>
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
                    {f.incompletos > 0
                      ? <span title={`${f.tramos} tramo(s) sin cerrar`}>
                          <strong>{f.incompletos}</strong> ({f.tramos} tramo{f.tramos === 1 ? '' : 's'})
                        </span>
                      : <span style={{ opacity: 0.35 }}>—</span>}
                  </td>
                  <td>{f.horasMedidas.toFixed(2)}</td>
                  <td>
                    {f.horasDefault > 0
                      ? <strong title="horas puestas por la regla, no medidas por el reloj">{f.horasDefault.toFixed(0)}</strong>
                      : <span style={{ opacity: 0.35 }}>—</span>}
                  </td>
                  <td>{f.biotime.toFixed(2)}</td>
                  <td>{f.manual > 0 ? f.manual.toFixed(2) : <span style={{ opacity: 0.35 }}>—</span>}</td>
                  <td><strong>{(f.biotime + f.manual).toFixed(2)}</strong></td>
                </tr>
              ))}
              {filas.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: '1.5rem', textAlign: 'center', opacity: 0.4, fontSize: '0.8rem' }}>
                    Todavía no hay horas para este período. Recalculá para derivarlas de las marcas.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>

          {/* ── Bandeja ─────────────────────────────────────────────────────── */}
          <div className="admin-section-header" style={{ marginTop: '1rem' }}>
            <span className="admin-section-title">Excepciones de fichaje</span>
          </div>

          <div className="fx-head">
            <span className="fx-count fx-count-abiertas" aria-label="Excepciones por revisar">
              {abiertasTotal} por revisar
            </span>
            {resueltasTotal > 0 && (
              <span className="fx-count fx-count-resueltas" aria-label="Excepciones resueltas">
                {resueltasTotal} resueltas
              </span>
            )}
            <span className="fx-spacer" />
            {/* Re-dispara la MISMA carga del período; no trae nada nuevo ni recalcula. */}
            <button className="btn-secondary fx-btn" onClick={() => loadDatos(period, local)} disabled={busy}>
              Actualizar
            </button>
          </div>

          {grupos.length === 0 ? (
            <p style={{ padding: '0 12px 1rem', fontSize: '0.78rem', opacity: 0.5 }}>
              Sin excepciones abiertas en este período.
            </p>
          ) : (
            <div className="fx-list">
              {grupos.map(g => {
                const expandido = abierto === g.key
                const puesto = puestoDe(g.key)
                return (
                  <div key={g.key} className={`fx-card${expandido ? ' fx-card-abierta' : ''}`}>
                    <div
                      className="fx-card-head"
                      onClick={() => setAbierto(a => (a === g.key ? null : g.key))}
                    >
                      <span className="fx-caret">{expandido ? '▾' : '▸'}</span>
                      <span className="fx-nombre">{g.nombre}</span>
                      {puesto && <span className="role-badge">{puesto}</span>}
                      <span className="fx-tipos">
                        {Object.entries(g.tipos).map(([t, n]) => `${etiquetaTipo(t)} ×${n}`).join(' · ')}
                      </span>
                      <span className="fx-spacer" />
                      <span className="fx-count fx-count-abiertas">{g.abiertas} por revisar</span>
                    </div>

                    {expandido && (
                      <div className="fx-body">
                        {(() => {
                          // Solo aparece si HAY algo que aplicar: sin regla cargada, o con
                          // la regla del lado que no falta, esta persona no lo ve nunca.
                          const aplicables = aplicablesDe(g)
                          if (aplicables.length === 0) return null
                          return (
                            <div className="fx-caso-acciones" style={{ padding: '0 0 6px' }}>
                              <button
                                className="btn-primary fx-btn"
                                onClick={() => handleAplicarRegla(g)}
                                disabled={busy}
                              >
                                Aplicar el horario de {g.nombre} a {aplicables.length}{' '}
                                {aplicables.length === 1 ? 'impar' : 'impares'}
                              </button>
                              <span style={{ fontSize: '0.7rem', opacity: 0.55 }}>
                                queda auditado como «{MOTIVO_REGLA}»
                              </span>
                            </div>
                          )
                        })()}
                        {g.items.map(x => {
                          const k = `${x.local ?? local}|${x.work_date}`
                          const ms = marcas[k]
                          return (
                            <div key={x.id}>
                              <div className="fx-caso">
                                <div className="fx-caso-info">
                                  <span className="fx-fecha">{x.work_date}</span>
                                  <span className="role-badge">{etiquetaTipo(x.tipo)}</span>
                                  <button className="btn-secondary fx-btn" onClick={() => verMarcas(x)} disabled={busy}>
                                    Ver marcas
                                  </button>
                                </div>
                                {(() => {
                                  // Solo el impar de UNA marca se corrige por resta: es el
                                  // único caso donde no hay ambigüedad sobre qué falta.
                                  const marca = marcaUnicaDeImpar(x)
                                  if (!marca) {
                                    return (
                                      <div className="fx-caso-acciones">
                                        {x.employee_id && x.work_date && (
                                          <>
                                            <input
                                              className="tip-input fx-input"
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
                                            <button className="btn-primary fx-btn" onClick={() => handleOverride(x)} disabled={busy}>
                                              Corregir a mano
                                            </button>
                                          </>
                                        )}
                                        <button className="btn-secondary fx-btn" onClick={() => handleResolver(x)} disabled={busy}>
                                          Marcar resuelta
                                        </button>
                                      </div>
                                    )
                                  }

                                  const lado      = ladoConDraft(x.id, marca.punch_state, ladoDraft)
                                  const horaReal  = hhmm(marca.punch_at)
                                  // Capa 3: si esta persona tiene cargada la hora habitual
                                  // del lado que FALTA, se propone — editable, y lo que la
                                  // persona escriba manda. Voltear el lado vuelve a proponer
                                  // la otra hora, que es la que pasa a faltar.
                                  const habitual  = horaHabitualFaltante(
                                    x.employee_id ? empById.get(x.employee_id) ?? null : null,
                                    lado,
                                  )
                                  const comp      = compDraft[x.id] ?? habitual ?? ''
                                  const entrada   = lado === 'in' ? horaReal : comp
                                  const salida    = lado === 'in' ? comp : horaReal
                                  const horas     = horasEntreMarcas(entrada, salida)
                                  const sospechoso = horas != null && horas > HORAS_SOSPECHOSAS

                                  return (
                                    <div className="fx-caso-acciones fx-reloj">
                                      <span className="fx-marca fx-marca-real" title="hora real del reloj">
                                        {horaReal}
                                      </span>
                                      {/* Voltear el lado es la corrección clave: BioTime
                                          etiqueta mal a quien marca una sola vez. */}
                                      <button
                                        className="btn-secondary fx-btn fx-toggle"
                                        aria-label={`Lado de la marca ${x.work_date}`}
                                        onClick={() => setLado(d => ({ ...d, [x.id]: lado === 'in' ? 'out' : 'in' }))}
                                        disabled={busy}
                                      >
                                        {lado === 'in' ? 'Entrada' : 'Salida'} ⇄
                                      </button>
                                      <span className="fx-reloj-sep">
                                        {lado === 'in' ? 'salió' : 'entró'}
                                      </span>
                                      <input
                                        className="tip-input fx-input fx-input-reloj"
                                        type="time"
                                        aria-label={`${lado === 'in' ? 'Salida' : 'Entrada'} ${x.work_date}`}
                                        value={comp}
                                        onChange={e => setComp(d => ({ ...d, [x.id]: e.target.value }))}
                                        disabled={busy}
                                      />
                                      <span className={`fx-horas${sospechoso ? ' fx-horas-alerta' : ''}`}>
                                        {horas != null ? `= ${horas} h` : '= —'}
                                      </span>
                                      {sospechoso && (
                                        <span className="fx-aviso" role="status">
                                          ⚠️ más de {HORAS_SOSPECHOSAS} h, revisalo
                                        </span>
                                      )}
                                      <button
                                        className="btn-primary fx-btn"
                                        onClick={() => horas != null && handleGuardarReloj(x, entrada, salida, horas)}
                                        disabled={busy || horas == null}
                                      >
                                        Guardar
                                      </button>
                                      {/* Aceptar el default derivado, sin override. */}
                                      <button className="btn-secondary fx-btn" onClick={() => handleResolver(x)} disabled={busy}>
                                        {HORAS_DEFAULT_IMPAR} h
                                      </button>
                                    </div>
                                  )
                                })()}
                              </div>

                              {ms && (() => {
                                const { lista, ampliado } = marcasDelCaso(ms, x)
                                return (
                                  <div className="fx-marcas">
                                    {lista.length === 0 ? (
                                      <em>Sin marcas crudas en esa jornada.</em>
                                    ) : (
                                      <>
                                        {lista.map(m => (
                                          <span
                                            key={m.id}
                                            className={`fx-marca fx-marca-${m.punch_state}`}
                                          >
                                            {hhmm(m.punch_at)} {m.punch_state}
                                          </span>
                                        ))}
                                        {ampliado && (
                                          <span style={{ opacity: 0.75 }}>
                                            — <em>todas las de la jornada</em> (ninguna quedó
                                            asociada a este caso)
                                          </span>
                                        )}
                                      </>
                                    )}
                                  </div>
                                )
                              })()}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <p className="fx-nota">
            El recálculo empareja entrada/salida por jornada (corte 05:00) y reescribe SOLO las horas
            derivadas de BioTime: lo cargado a mano no se toca nunca. Corregir a mano una jornada la deja
            como manual, así que el próximo recálculo la respeta. Cada <em>tramo sin cerrar</em> (una
            marca que quedó sin su otra mitad) se cuenta a <strong>{HORAS_DEFAULT_IMPAR} h por
            defecto</strong>, y los tramos que sí cerraron cuentan sus horas reales: un turno cortado
            con la salida olvidada no pierde la mañana. Ese default lo puso la regla, no el reloj — si
            tenés el dato real, corregilo desde la bandeja.
            <strong> Acá no se calcula plata.</strong>
          </p>
        </>
      )}
    </div>
  )
}
