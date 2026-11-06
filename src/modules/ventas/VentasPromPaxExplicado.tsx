// ── Ventas → Análisis → «Prom/PAX explicado» (SPEC v2.3 §7) ────────────────────────────────
//
// Solo lectura, owner/manager/contador (la pestaña Análisis ya es solo para ellos; la barrera real
// es el RPC 078, que valida rol + is_active en la base). Todo el cálculo vive en
// `ventasPromPaxExplicado.ts`; acá solo se piden los datos, se arma el período y se muestra.

import { useEffect, useMemo, useState } from 'react'
import { getPromPaxAgregado, getSaloneroNombres } from '../../shared/api/posNdf'
import { fechaCR } from '../../shared/ndf/jornada'
import { LOCAL_POR_DEFECTO } from './ventasDiasDesdePos'
import {
  cubrir, largoEnDias, periodoDeComparacion, periodoMes, periodoRango, periodoSemana, periodoTemporada,
  type ModoComparacion, type Periodo, type TipoPeriodo,
} from './periodosPromPax'
import { resolverPersonas } from './promPaxSaloneros'
import { diaLegible, etiquetaTramo, rangoDeTramo, TRAMOS, tramoDe, type TramoId } from './temporadas'
import {
  aCsv, analizar, crc, tablaCorte, tablaSaloneros, type Analisis, type Corte, type FilaAgregada,
  type FilaTabla, type FiltroTurno,
} from './ventasPromPaxExplicado'

const NOMBRE_TRAMO: Record<TramoId, string> = {
  'alta': 'Alta', 'baja-may': 'Baja de mayo', 'media': 'Media', 'baja-sepdic': 'Baja sep–dic',
}

const pctTxt = (x: number | null, dec = 1) => x === null ? '—' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(dec).replace('.', ',')}%`
const signoCrc = (x: number | null) => x === null ? '—' : `${x >= 0 ? '+' : '−'}${crc(x)}`
const entero = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
const color = (x: number | null) => x === null || Math.abs(x) < 1e-9 ? '#888' : x > 0 ? 'var(--vt-green)' : 'var(--vt-red)'
const rangoTxt = (p: Periodo) => p.tramo ? etiquetaTramo(rangoDeTramo(p.tramo.id, p.tramo.anio)) : `${diaLegible(p.desde)} – ${diaLegible(p.hasta)}`

function descargar(nombre: string, csv: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  a.download = nombre
  a.click()
  URL.revokeObjectURL(a.href)
}

/** Pide los dos períodos: una sola llamada si caben juntos en 731 días; si no, dos. */
async function cargar(actual: Periodo, comp: Periodo): Promise<FilaAgregada[]> {
  const todo = cubrir(actual, comp)
  if (largoEnDias(todo) <= 731) return getPromPaxAgregado(LOCAL_POR_DEFECTO, todo.desde, todo.hasta)
  const [a, b] = await Promise.all([
    getPromPaxAgregado(LOCAL_POR_DEFECTO, actual.desde, actual.hasta),
    getPromPaxAgregado(LOCAL_POR_DEFECTO, comp.desde, comp.hasta),
  ])
  return [...a, ...b]
}

export default function VentasPromPaxExplicado() {
  const hoy = fechaCR(new Date().toISOString()) ?? new Date().toISOString().slice(0, 10)
  const mesAnterior = (() => {
    const [a, m] = hoy.split('-').map(Number)
    return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`
  })()

  const [tipo, setTipo] = useState<TipoPeriodo>('mes')
  const [mes, setMes] = useState(mesAnterior)
  const [diaSemana, setDiaSemana] = useState(hoy)
  const [tramo, setTramo] = useState<TramoId>(tramoDe(hoy).id)
  const [anioTramo, setAnioTramo] = useState(tramoDe(hoy).anio)
  const [desde, setDesde] = useState(`${mesAnterior}-01`)
  const [hasta, setHasta] = useState(hoy)
  const [modo, setModo] = useState<ModoComparacion>('anterior')
  const [turno, setTurno] = useState<FiltroTurno>('ambos')
  const [detalle, setDetalle] = useState(false)

  const [carga, setCarga] = useState<{ clave: string; filas: FilaAgregada[] | null; error: string | null } | null>(null)
  const [nombres, setNombres] = useState<Record<string, string>>({})

  const periodos = useMemo((): { actual: Periodo; comp: Periodo } | { error: string } => {
    try {
      let actual: Periodo
      if (tipo === 'mes') { const [a, m] = mes.split('-').map(Number); actual = periodoMes(a, m) }
      else if (tipo === 'semana') actual = periodoSemana(diaSemana)
      else if (tipo === 'temporada') actual = periodoTemporada(tramo, anioTramo)
      else actual = periodoRango(desde, hasta)
      if (largoEnDias(actual) > 731) return { error: 'El período no puede pasar de 731 días.' }
      const m = modo === 'tramo-anio-anterior' && tipo !== 'temporada' ? 'anio-anterior' : modo
      return { actual, comp: periodoDeComparacion(actual, m) }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  }, [tipo, mes, diaSemana, tramo, anioTramo, desde, hasta, modo])

  useEffect(() => {
    getSaloneroNombres().then(setNombres).catch(() => { /* sin nombres: se usa el roster del código */ })
  }, [])

  const claveCarga = 'error' in periodos ? null : `${periodos.actual.desde}|${periodos.actual.hasta}|${periodos.comp.desde}|${periodos.comp.hasta}`
  useEffect(() => {
    if ('error' in periodos || !claveCarga) return
    let vivo = true
    cargar(periodos.actual, periodos.comp)
      .then(f => { if (vivo) setCarga({ clave: claveCarga, filas: f, error: null }) })
      .catch(e => { if (vivo) setCarga({ clave: claveCarga, filas: null, error: e instanceof Error ? e.message : String(e) }) })
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveCarga])

  // Los datos que se muestran son los de la última carga que TERMINÓ para estos períodos.
  const vigente = carga && carga.clave === claveCarga ? carga : null
  const filas = vigente?.filas ?? null
  const error = vigente?.error ?? null
  const cargando = !vigente && claveCarga !== null

  const resolver = useMemo(() => resolverPersonas(nombres), [nombres])
  const analisis: Analisis | null = useMemo(() => {
    if (!filas || 'error' in periodos) return null
    return analizar(filas, periodos.actual, periodos.comp, turno, resolver)
  }, [filas, periodos, turno, resolver])

  const anios = useMemo(() => {
    const a = Number(hoy.slice(0, 4))
    return [a + 1, a, a - 1, a - 2]
  }, [hoy])

  return (
    <div className="vt-section">
      {/* ── Filtros ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', marginBottom: '0.75rem' }}>
        <div className="vt-tab-group">
          {(['mes', 'semana', 'temporada', 'rango'] as TipoPeriodo[]).map(t => (
            <button key={t} className={`vt-tab-btn ${tipo === t ? 'active' : ''}`} onClick={() => setTipo(t)}>
              {t === 'mes' ? 'Mes' : t === 'semana' ? 'Semana' : t === 'temporada' ? 'Temporada' : 'Rango'}
            </button>
          ))}
        </div>
        {tipo === 'mes' && <input aria-label="Mes" className="vt-date-input" type="month" value={mes} onChange={e => e.target.value && setMes(e.target.value)} />}
        {tipo === 'semana' && <input aria-label="Un día de la semana" className="vt-date-input" type="date" value={diaSemana} onChange={e => e.target.value && setDiaSemana(e.target.value)} />}
        {tipo === 'temporada' && (
          <>
            <select aria-label="Tramo" className="vt-date-input" value={tramo} onChange={e => setTramo(e.target.value as TramoId)}>
              {TRAMOS.map(t => <option key={t} value={t}>{NOMBRE_TRAMO[t]}</option>)}
            </select>
            <select aria-label="Año del tramo" className="vt-date-input" value={anioTramo} onChange={e => setAnioTramo(Number(e.target.value))}>
              {anios.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </>
        )}
        {tipo === 'rango' && (
          <>
            <input aria-label="Desde" className="vt-date-input" type="date" value={desde} onChange={e => e.target.value && setDesde(e.target.value)} />
            <input aria-label="Hasta" className="vt-date-input" type="date" value={hasta} onChange={e => e.target.value && setHasta(e.target.value)} />
          </>
        )}
        <select aria-label="Comparar contra" className="vt-date-input" value={modo} onChange={e => setModo(e.target.value as ModoComparacion)}>
          <option value="anterior">vs período anterior de igual largo</option>
          <option value="anio-anterior">vs mismo período del año anterior</option>
          {tipo === 'temporada' && <option value="tramo-anio-anterior">vs mismo tramo del año anterior</option>}
        </select>
        <div className="vt-tab-group">
          {(['mañana', 'noche', 'ambos'] as FiltroTurno[]).map(t => (
            <button key={t} className={`vt-tab-btn ${turno === t ? 'active' : ''}`} onClick={() => setTurno(t)}>
              {t === 'mañana' ? 'Mañana' : t === 'noche' ? 'Noche' : 'Ambos turnos'}
            </button>
          ))}
        </div>
      </div>

      {'error' in periodos ? (
        <div className="vt-empty"><div className="vt-empty-sub">{periodos.error}</div></div>
      ) : (
        <div style={{ fontSize: '0.78rem', color: '#888', marginBottom: '1rem' }} data-testid="pp-periodos">
          <strong>{rangoTxt(periodos.actual)}</strong> · comparado con {rangoTxt(periodos.comp)}.
          {' '}Turno por la hora de la factura (mañana 6–16 h, noche 17–24 h; después de medianoche cuenta como noche del mismo día).
        </div>
      )}

      {error && <div className="vt-empty"><div className="vt-empty-title">No se pudieron leer los datos</div><div className="vt-empty-sub">{error}</div></div>}
      {cargando && !analisis && <div className="vt-empty"><div className="vt-empty-sub">Cargando…</div></div>}

      {analisis && !error && !('error' in periodos) && (
        <Contenido a={analisis} turno={turno} detalle={detalle} setDetalle={setDetalle}
          filasActual={filas!} periodos={periodos} resolver={resolver} />
      )}
    </div>
  )
}

interface ContenidoProps {
  a: Analisis
  turno: FiltroTurno
  detalle: boolean
  setDetalle: (b: boolean) => void
  filasActual: FilaAgregada[]
  periodos: { actual: Periodo; comp: Periodo }
  resolver: ReturnType<typeof resolverPersonas>
}

function Contenido({ a, turno, detalle, setDetalle, filasActual, periodos, resolver }: ContenidoProps) {
  const tarjeta = (label: string, n: number | null, v: number | null, fmt: (x: number) => string) => {
    const d = n !== null && v !== null ? n - v : null
    const dp = d !== null && v ? d / v : null
    return (
      <div className="vt-kpi" style={{ borderLeft: '3px solid var(--vt-gold)' }}>
        <div className="vt-kpi-label">{label}</div>
        <div className="vt-kpi-val">{n === null ? 'sin pax' : fmt(n)}</div>
        <div className="vt-kpi-delta" style={{ color: color(d) }}>
          {d === null ? '—' : `${d >= 0 ? '+' : '−'}${fmt(Math.abs(d))} · ${pctTxt(dp)}`}
        </div>
        <div className="vt-kpi-sub">comparación: {v === null ? 'sin pax' : fmt(v)}</div>
      </div>
    )
  }

  // Salonero: con «ambos», una fila por salonero y turno (corte saloneroTurno); si no, por salonero.
  const corteSal: Corte = turno === 'ambos' ? 'saloneroTurno' : 'salonero'
  const vsTurno = useMemo(() => {
    const filasN = filasActual.filter(f => f.dia >= periodos.actual.desde && f.dia <= periodos.actual.hasta
      && (turno === 'ambos' || (f.franja === 'mañana' ? 'mañana' : 'noche') === turno))
    return new Map(tablaSaloneros(filasN, resolver).map(s => [turno === 'ambos' ? `${s.clave}|${s.turno}` : s.clave, s.vsTurno]))
  }, [filasActual, periodos, turno, resolver])

  const tablas: { corte: Corte; titulo: string }[] = [
    ...(turno === 'ambos' ? [{ corte: 'turno' as Corte, titulo: 'Por turno' }] : []),
    { corte: 'dia', titulo: 'Por día de la semana' },
    { corte: corteSal, titulo: 'Por salonero' },
    { corte: 'semana', titulo: 'Por semana' },
  ]

  const ex = a.explicacion
  return (
    <>
      <div className="vt-kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }} data-testid="pp-tarjetas">
        {tarjeta('Ventas (todos los canales)', a.n.ventas, a.v.ventas, crc)}
        {tarjeta('Pax de salón', a.n.paxSalon, a.v.paxSalon, entero)}
        {tarjeta('Prom/PAX de salón', a.n.promPax, a.v.promPax, crc)}
      </div>

      <div className="vt-sl">Qué explica el cambio</div>
      <div data-testid="pp-explicacion" style={{ background: 'var(--vt-panel)', color: 'var(--vt-ink)', border: '1px solid var(--vt-border)', padding: '0.875rem 1rem', borderRadius: 2, marginBottom: '1.25rem', lineHeight: 1.5 }}>
        {ex.etiqueta && <div style={{ fontSize: '0.72rem', color: 'var(--vt-gold-dark)', fontWeight: 700, marginBottom: '0.4rem' }}>{ex.etiqueta}</div>}
        {ex.frases.map((f, i) => <p key={i} style={{ margin: '0 0 0.35rem' }}>{f}</p>)}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.5rem' }}>
        <button className="vt-tab-btn" onClick={() => setDetalle(!detalle)}>{detalle ? 'Ocultar detalle' : 'Ver detalle'}</button>
      </div>
      {detalle && (
        <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: '0.75rem' }} data-testid="pp-leyenda">
          Rendimiento = el grupo vendió más o menos por persona. Mezcla = cambió cuánta gente atendió ese grupo.
          {a.cortes.dia.d && <> Venta de salón sin pax: {signoCrc(a.cortes.dia.d.ventaSinPax)} al prom/pax.</>}
        </div>
      )}

      {tablas.map(({ corte, titulo }) => (
        <TablaCorte key={corte} titulo={titulo} corte={corte} a={a} detalle={detalle}
          vsTurno={corte === corteSal ? vsTurno : null} />
      ))}
    </>
  )
}

function TablaCorte({ titulo, corte, a, detalle, vsTurno }: {
  titulo: string; corte: Corte; a: Analisis; detalle: boolean; vsTurno: Map<string, number | null> | null
}) {
  const { gv, gn, d } = a.cortes[corte]
  const filas: FilaTabla[] = tablaCorte(gv, gn, d)
  if (!filas.length) return null

  // «Ajuste por redondeo»: lo que falta para que los aportes redondeados sumen el Δ redondeado.
  const ajuste = d ? Math.round(d.delta) - Math.round(d.ventaSinPax)
    - filas.reduce((s, f) => s + Math.round(f.rendimiento ?? 0) + Math.round(f.mezcla ?? 0), 0) : 0

  const encabezados = ['Grupo', 'Pax', '% pax', 'Prom/PAX', 'Comparación', 'Δ ₡', 'Δ %',
    ...(vsTurno ? ['vs promedio del turno'] : []), ...(detalle ? ['Rendimiento', 'Mezcla'] : [])]
  const csv = () => aCsv(encabezados, filas.map(f => [
    f.etiqueta, f.pax, f.pctPax === null ? null : Number((f.pctPax * 100).toFixed(2)),
    f.promPax === null ? 'sin pax' : Math.round(f.promPax), f.promPaxComp === null ? 'sin pax' : Math.round(f.promPaxComp),
    f.delta === null ? null : Math.round(f.delta), f.deltaPct === null ? null : Number((f.deltaPct * 100).toFixed(2)),
    ...(vsTurno ? [vsTurno.get(f.clave) == null ? null : Number((vsTurno.get(f.clave)! * 100).toFixed(2))] : []),
    ...(detalle ? [f.rendimiento === null ? null : Math.round(f.rendimiento), f.mezcla === null ? null : Math.round(f.mezcla)] : []),
  ]))

  return (
    <div style={{ marginBottom: '1.25rem' }} data-testid={`pp-tabla-${corte}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div className="vt-sl">{titulo}</div>
        <button className="vt-tab-btn" onClick={() => descargar(`prompax-${corte}.csv`, csv())}>CSV</button>
      </div>
      <div className="vt-tbl-wrap">
        <table className="vt-tbl">
          <thead>
            <tr>{encabezados.map((h, i) => <th key={h} className={i ? 'r' : undefined}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {filas.map(f => {
              const vt = vsTurno?.get(f.clave) ?? null
              return (
                <tr key={f.clave}>
                  <td style={{ fontWeight: 600 }}>{f.etiqueta}</td>
                  <td className="r">{entero(f.pax)}</td>
                  <td className="r">{f.pctPax === null ? '—' : `${(f.pctPax * 100).toFixed(1).replace('.', ',')}%`}</td>
                  <td className="r vt-bold">{f.promPax === null ? 'sin pax' : crc(f.promPax)}</td>
                  <td className="r">{f.promPaxComp === null ? 'sin pax' : crc(f.promPaxComp)}</td>
                  <td className="r" style={{ color: color(f.delta) }}>{signoCrc(f.delta)}</td>
                  <td className="r" style={{ color: color(f.deltaPct) }}>{pctTxt(f.deltaPct)}</td>
                  {vsTurno && <td className="r" style={{ color: color(vt) }}>{pctTxt(vt)}</td>}
                  {detalle && <td className="r">{f.rendimiento === null ? '—' : signoCrc(f.rendimiento)}</td>}
                  {detalle && <td className="r">{f.mezcla === null ? '—' : signoCrc(f.mezcla)}</td>}
                </tr>
              )
            })}
          </tbody>
          {detalle && d && (
            <tfoot>
              <tr className="vt-tbl-footer">
                <td colSpan={encabezados.length - 2}>Δ prom/pax {signoCrc(d.delta)} = rendimiento + mezcla + venta sin pax ({signoCrc(d.ventaSinPax)})
                  {ajuste !== 0 && <> · ajuste por redondeo {signoCrc(ajuste)}</>}</td>
                <td className="r">{signoCrc(d.grupos.reduce((s, g) => s + g.rendimiento, 0))}</td>
                <td className="r">{signoCrc(d.grupos.reduce((s, g) => s + g.mezcla, 0))}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}

