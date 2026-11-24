// ── Ventas v2 · 3.5.4 · «Equipo» (SPEC-ventas-v2 §5.3) ─────────────────────────────────────────
//
// Junta «Saloneros» y «Evaluación» en una tabla por salonero, con la barra global (local, período y comparación:
// la misma de «Resumen» y «Tiempos», en la URL). El cálculo es `equipoV2.ts`; la lectura:
//   · `cargarLineasPeriodo` (el lector de siempre, solo el período): venta, personas, bebidas, comida/bebida,
//     precios por ítem, días y productos de cada salonero (lo mismo que «Saloneros»);
//   · `cargarLecturaResumen` (190, la misma del «Resumen»): la venta por persona D4 y su comparación con las bases;
//   · owner y manager: propinas del período (ICP, regla 5) y, al abrir la ficha, 12 semanas (`cargarLecturaRango`).
// Quién ve qué: los tres roles ven el ranking (decisión del dueño 23-nov 21:40 CR: el contador ve el «Ranking del
// día»); las columnas de evaluación, el ICP y la ficha son de owner y manager (`veDetalleEquipo`, SPEC §6).
// Solo lectura. No arma ninguna fecha: todas salen de `periodos.ts` por la barra.
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../shared/hooks/useAuth'
import { getAllEmployees } from '../../shared/api/admin'
import type { AttendanceRow } from '../../shared/api/tips'
import type { Employee } from '../../shared/types/database'
import type { Meta } from '../../shared/types/ventas'
import { clavesPropinaDeEmpleado, nombresDeEmpleados } from '../../shared/ndf/personasNdf'
import { localPorDefecto } from '../../shared/utils/ordenLocales'
import BarraVentasV2 from './BarraVentasV2'
import { baseConFechas, basesDe, escribirBarra, leerBarra, periodoDeBarra, rotuloBase } from './barraVentasV2'
import {
  armarEquipo, doceSemanas, evaluarEquipo, icpPorNombre, normNombreIcp, ordenarEquipo, ventana12Semanas, vppPorSalonero,
  DIAS_PARA_TENDENCIA, umbralMuestraChica, type Equipo, type Evaluacion, type FilaEquipo, type IcpFila, type OrdenEquipo,
} from './equipoV2'
import { getPropinasRango } from './equipoPropinas'
import { ventaPorPersona, type VentaPorPersona } from './indicadores'
import { cargarLineasPeriodo, fechasDe, type LineasPeriodo } from './lineasPeriodo'
import { electronicTipCrc } from './miRendimientoUtils'
import { fechasCortas, type BaseId, type PeriodoV2 } from './periodos'
import { cambioPct, type Lectura } from './resumenV2'
import { cargarLecturaRango, cargarLecturaResumen, getLocalesVentas, type LocalVentas } from './resumenV2Datos'
import { veDetalleEquipo } from './ventasTabs'
import { LOCAL_POR_DEFECTO } from './ventasDiasDesdePos'
import { fi, getMeta, metaColor, ratioCBClass } from './ventasUtils'

const pct1 = (x: number) => `${x.toFixed(1).replace('.', ',')} %`
const fmtCambio = (x: number | null) => x === null ? 'sin comparación'
  : Math.abs(x) < 0.05 ? '0,0 %' : `${x > 0 ? '▲ +' : '▼ −'}${Math.abs(x).toFixed(1).replace('.', ',')} %`
const claseCambio = (x: number | null, chica = false) => x === null || chica || Math.abs(x) < 0.05 ? 'gris' : x > 0 ? 'sube' : 'baja'
const fmtVpp = (v: number | null | undefined) => v === null || v === undefined ? '—' : fi(Math.round(v))
const personasD4 = (v: VentaPorPersona) => v.personasCargadas + v.personasEstimadas

const ORDENES: { id: OrdenEquipo; label: string }[] = [
  { id: 'vpp', label: 'Venta por persona' },
  { id: 'venta', label: 'Venta' },
  { id: 'personas', label: 'Personas' },
  { id: 'promPax', label: 'Prom/PAX cargado' },
  { id: 'ticketItem', label: 'Ticket/ítem' },
  { id: 'bebPax', label: 'Bebidas por persona' },
  { id: 'ratioCB', label: 'Comida/bebida' },
  { id: 'dias', label: 'Días' },
]

interface Datos {
  clave:    string
  lectura:  Lectura
  lineas:   LineasPeriodo
  /** Solo owner y manager. `null` = no se pudieron leer (la columna dice «—»). */
  propinas: AttendanceRow[] | null
  empleados: Employee[] | null
}

export default function VentasEquipo({ metas }: { metas: Meta }) {
  const { profile } = useAuth()
  const role = profile?.role ?? ''
  const detalle = veDetalleEquipo(role)
  const [sp, setSp] = useSearchParams()
  const estado = useMemo(() => leerBarra(sp), [sp])
  const { tipo, dia, desde, hasta, comparar } = estado
  const { periodo, aviso } = useMemo(() => periodoDeBarra({ tipo, dia, desde, hasta }), [tipo, dia, desde, hasta])
  const bases = basesDe(comparar)

  const [locales, setLocales] = useState<LocalVentas[]>([])
  useEffect(() => {
    let vivo = true
    getLocalesVentas(role).then(l => { if (vivo) setLocales(l) }).catch(() => { if (vivo) setLocales([]) })
    return () => { vivo = false }
  }, [role])
  // D16: el elegido en la URL si lo ve; si no, Santa Teresa; si no, el primero que ve (igual que «Resumen»).
  const local = locales.length === 0
    ? (estado.local ?? LOCAL_POR_DEFECTO)
    : (localPorDefecto(locales, estado.local) ?? LOCAL_POR_DEFECTO)

  const clave = `${local}|${periodo.tipo}|${periodo.desde}|${periodo.hasta}|${detalle ? 'd' : 'r'}`
  const [datos, setDatos] = useState<Datos | null>(null)
  const [fallo, setFallo] = useState<{ clave: string; msg: string } | null>(null)
  useEffect(() => {
    const p = periodo
    if (p.tipo === 'hoy') return
    let vivo = true
    const extra = detalle
      ? Promise.all([getPropinasRango(p.desde, p.hasta, local), getAllEmployees()]).then(([t, e]) => ({ t, e }), () => ({ t: null, e: null }))
      : Promise.resolve({ t: null, e: null })
    Promise.all([cargarLecturaResumen(local, p), cargarLineasPeriodo(local, p), extra])
      .then(([lectura, lineas, { t, e }]) => { if (vivo) setDatos({ clave, lectura, lineas, propinas: t, empleados: e }) })
      .catch(err => { if (vivo) setFallo({ clave, msg: err instanceof Error ? err.message : 'No se pudo leer el PoS' }) })
    return () => { vivo = false }
  }, [clave, local, periodo, detalle])

  const barra = <BarraVentasV2 estado={estado} periodo={periodo} locales={locales} aviso={aviso}
    onCambio={e => setSp(escribirBarra(sp, e))} />

  if (periodo.tipo === 'hoy') {
    return (
      <div className="vt-section">
        {barra}
        <div className="vt2-hoy">
          Hoy está en curso: el ranking de hoy, mientras se vende, se mira en «En vivo». Elegí «Ayer» u otro período.
        </div>
      </div>
    )
  }

  const error = fallo && fallo.clave === clave ? fallo.msg : null
  const d = datos && datos.clave === clave ? datos : null
  return (
    <div className="vt-section">
      {barra}
      {error && <div className="tips-error" role="alert"><span>No se pudo leer el PoS: {error}</span></div>}
      {!d && !error && (
        <div className="vt2-cargando" role="status">
          Leyendo las ventas del equipo en el PoS{periodo.dias > 62 ? ' (período largo: puede tardar unos segundos)' : ''}…
        </div>
      )}
      {d && <Contenido d={d} periodo={periodo} bases={bases} metas={metas} detalle={detalle} local={local} />}
    </div>
  )
}

interface ContenidoProps {
  d:       Datos
  periodo: PeriodoV2
  bases:   BaseId[]
  metas:   Meta
  detalle: boolean
  local:   string
}

function Contenido({ d, periodo, bases, metas, detalle, local }: ContenidoProps) {
  const { lectura, lineas } = d
  const fechas = useMemo(() => fechasDe(lineas.dias, periodo), [lineas, periodo])
  const vpp = useMemo(() => vppPorSalonero(lectura.facturas, lectura.nombres, periodo), [lectura, periodo])
  const equipo: Equipo = useMemo(() => armarEquipo(lineas.dias, lineas.pm, fechas, vpp.porNombre, umbralMuestraChica(periodo.dias)), [lineas, fechas, vpp, periodo.dias])
  const evaluacion = useMemo(
    () => detalle ? evaluarEquipo(equipo.filas.map(f => f.nombre), fechas, lineas.dias, lineas.pm, metas) : null,
    [detalle, equipo, fechas, lineas, metas],
  )
  const icp = useMemo(() => {
    if (!detalle || !d.propinas || !d.empleados) return null
    const sals = equipo.filas.map(f => f.nombre)
    const nombresEmp = nombresDeEmpleados(d.empleados)
    const venta = new Map(equipo.filas.map(f => [f.nombre, f.venta]))
    return icpPorNombre(d.propinas, d.empleados, periodo, sals, n => venta.get(n) ?? 0,
      (emp, s) => clavesPropinaDeEmpleado(emp, nombresEmp, s, normNombreIcp), electronicTipCrc)
  }, [detalle, d.propinas, d.empleados, equipo, periodo])

  const [orden, setOrden] = useState<OrdenEquipo>('vpp')
  const [ficha, setFicha] = useState<string | null>(null)
  const filas = useMemo(() => ordenarEquipo(equipo.filas, orden), [equipo, orden])
  const fechasPeriodo = fechasCortas(periodo, Number(periodo.ancla.slice(0, 4)))

  // Las cifras del equipo contra cada base (la venta por persona D4 del equipo: la misma del «Resumen»).
  const cifrasBase = bases.map(id => {
    const r = periodo.bases[id]
    return { id, v: r ? ventaPorPersona(lectura.facturas, r) : null }
  })
  const eq = vpp.equipo
  const mejor = filas.find(f => !f.muestraChica) ?? null

  if (equipo.filas.length === 0) {
    return <div className="vt2-hoy" role="status">En {fechasPeriodo} no hay ventas de saloneros en el PoS.</div>
  }

  return (
    <>
      <p className="vt2-bajada" data-testid="equipo-bajada">
        {`En ${fechasPeriodo}: ${equipo.filas.length} ${equipo.filas.length === 1 ? 'salonero' : 'saloneros'} con ventas; venta por persona del equipo ${fmtVpp(eq.valor)}.`}
        {mejor && mejor.vpp?.vpp.valor != null ? ` La más alta (con muestra suficiente): ${mejor.nombre}, ${fmtVpp(mejor.vpp.vpp.valor)}.` : ''}
      </p>

      <div className="vt-kpi-grid vt2-cifras">
        <Cifra id="vpp" label="Venta por persona del equipo" valor={fmtVpp(eq.valor)} periodo={periodo}
          cmps={cifrasBase.map(c => ({ id: c.id, actual: eq.valor, base: c.v?.valor ?? null, txt: fmtVpp(c.v?.valor), chica: personasD4(eq) < umbralMuestraChica(periodo.dias) }))}
          sub={`Neta de salón ÷ personas de salón; incluye ${pct1(eq.pctEstimado)} estimado (como «Resumen»).`} />
        <Cifra id="personas" label="Personas (cargadas + estimadas)" valor={personasD4(eq).toLocaleString('es-CR')} periodo={periodo}
          cmps={cifrasBase.map(c => {
            const b = c.v && c.v.facturasSalon > 0 ? personasD4(c.v) : null
            return { id: c.id, actual: personasD4(eq), base: b, txt: b === null ? '—' : b.toLocaleString('es-CR') }
          })} />
        <Cifra id="venta" label="Venta de saloneros" valor={fi(equipo.general.venta)} periodo={periodo} cmps={[]}
          sub={`${fechas.length} ${fechas.length === 1 ? 'día' : 'días'} · por factura, como «Saloneros»`} />
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', margin: '0.75rem 0' }}>
        <label className="vt2-campo">
          <span>Ordenar por</span>
          <select className="date-filter" aria-label="Ordenar por" value={orden} onChange={e => setOrden(e.target.value as OrdenEquipo)}>
            {ORDENES.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </label>
        {detalle && <span className="vt2-sub">Tocá un salonero para ver su ficha.</span>}
      </div>

      <div className="vt-tbl-wrap" style={{ overflowX: 'auto' }}>
        <table className="vt-tbl" aria-label="Equipo" style={{ fontSize: '0.8rem' }}>
          <thead>
            <tr>
              <th>#</th>
              <th style={{ textAlign: 'left' }}>Salonero</th>
              <th className="r">Venta</th>
              <th className="r">Personas (PAX)</th>
              <th className="r">Venta por persona</th>
              <th className="r">vs equipo de su turno</th>
              <th className="r">Prom/PAX cargado</th>
              <th className="r">Beb/PAX</th>
              <th className="r">Comida/bebida</th>
              <th className="r">Prom/plato</th>
              <th className="r">Ticket/ítem</th>
              {detalle && <>
                <th className="r">ICP</th>
                <th className="r">% meta</th>
                <th className="r">Días</th>
                <th className="r">Consistencia</th>
                <th className="r">Tendencia</th>
                <th className="r">Racha</th>
              </>}
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => (
              <FilaTabla key={f.nombre} f={f} i={i} metas={metas} detalle={detalle}
                ev={evaluacion?.get(f.nombre) ?? null} icp={icp ? icp.get(f.nombre) ?? null : undefined}
                abierta={ficha === f.nombre} onAbrir={() => setFicha(ficha === f.nombre ? null : f.nombre)} />
            ))}
          </tbody>
          <tfoot>
            {equipo.sinMesero.total !== 0 && (
              <tr data-fila="sin-mesero" style={{ color: 'var(--c-gris)', fontStyle: 'italic' }}>
                <td>—</td>
                <td>Salón sin mesero<span className="vt2-sub">la factura no se la acredita a nadie · no compite en el ranking · quién comandó se ve en «Por línea»</span></td>
                <td className="r">{fi(equipo.sinMesero.total)}</td>
                <td className="r" colSpan={detalle ? 14 : 8} style={{ textAlign: 'right' }}>{equipo.sinMesero.ordenes} órdenes</td>
              </tr>
            )}
            <tr className="vt-tbl-footer" data-fila="general">
              <td colSpan={2}>EQUIPO</td>
              <td className="r">{fi(equipo.general.venta)}</td>
              <td className="r">{equipo.general.personas}</td>
              <td className="r">{fmtVpp(eq.valor)}</td>
              <td />
              <td className="r">{fi(equipo.general.promPax)}</td>
              <td className="r">{equipo.general.bebPax.toFixed(2)}</td>
              <td className={`r ${ratioCBClass(equipo.general.ratioCB)}`}>{equipo.general.ratioCB.toFixed(2)}:1</td>
              <td />
              <td className="r">{fi(equipo.general.ticketItem)}</td>
              {detalle && <td colSpan={6} />}
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="vt2-nota" style={{ marginTop: '0.5rem' }}>
        Venta por persona: neta de salón de SUS mesas ÷ sus personas, con las mesas sin pax estimadas (D4, como «Resumen»).
        «Prom/PAX cargado» es la cifra de antes, solo con personas cargadas. «vs equipo de su turno»: contra la venta por
        persona del equipo en los mismos turnos de caja que trabajó. En gris: menos de {umbralMuestraChica(periodo.dias)} personas en el
        período (muestra chica; 10 por día, hasta 30).
        {detalle && ` ICP = propina electrónica declarada ÷ neta de sus mesas (sin el 10 % de servicio; barra: no aplica).
        Consistencia = % de sus días sobre el Prom/PAX del restaurante ese día. Tendencia = últimos 7 días trabajados contra
        los 7 anteriores (hace falta ${DIAS_PARA_TENDENCIA} días trabajados en el período). Racha = días seguidos sobre su meta de Prom/PAX.`}
      </div>

      {detalle && ficha && (() => {
        const f = equipo.filas.find(x => x.nombre === ficha)
        return f ? <Ficha f={f} periodo={periodo} bases={bases} lectura={lectura} local={local} onCerrar={() => setFicha(null)} /> : null
      })()}
    </>
  )
}

function Cifra({ id, label, valor, periodo, cmps, sub }: {
  id: string; label: string; valor: string; periodo: PeriodoV2
  cmps: { id: BaseId; actual: number | null; base: number | null; txt: string; chica?: boolean }[]
  sub?: string
}) {
  return (
    <div className="vt-kpi" data-cifra={id}>
      <div className="vt-kpi-label">{label}</div>
      <div className="vt-kpi-val">{valor}</div>
      {cmps.map(c => {
        const cambio = cambioPct(c.actual, c.base)
        return (
          <div key={c.id} className={`vt-kpi-delta vt2-delta ${claseCambio(cambio, c.chica)}`}
            title={periodo.bases[c.id]?.rotulo ?? periodo.motivos[c.id] ?? ''}>
            {periodo.bases[c.id] ? fmtCambio(cambio) : `sin comparación (${periodo.motivos[c.id] ?? rotuloBase(periodo, c.id)})`}
            {periodo.bases[c.id] && <span className="vt2-delta-base"> vs {baseConFechas(periodo, c.id)}: {c.txt}</span>}
          </div>
        )
      })}
      {sub && <div className="vt-kpi-sub">{sub}</div>}
    </div>
  )
}

function FilaTabla({ f, i, metas, detalle, ev, icp, abierta, onAbrir }: {
  f: FilaEquipo; i: number; metas: Meta; detalle: boolean
  ev: Evaluacion | null
  /** `undefined` = no se pudieron leer las propinas. */
  icp: IcpFila | undefined
  abierta: boolean; onAbrir: () => void
}) {
  // Muestra chica: la fila entera atenuada (las celdas de la tabla traen su propio color, así que no alcanza con `color`).
  const gris = f.muestraChica ? { color: 'var(--c-gris)', opacity: 0.6 } : undefined
  const metaPP = getMeta(metas, f.nombre, 'promPax')
  const metaBP = getMeta(metas, f.nombre, 'bebPax')
  const vt = f.vpp?.vsTurno ?? null
  return (
    <tr data-salonero={f.nombre} data-muestra-chica={f.muestraChica ? 'si' : undefined} style={gris}
      className={abierta ? 'tr-best' : undefined}
      onClick={detalle ? onAbrir : undefined} role={detalle ? 'button' : undefined} tabIndex={detalle ? 0 : undefined}
      onKeyDown={detalle ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAbrir() } } : undefined}
      aria-expanded={detalle ? abierta : undefined}>
      <td style={{ fontWeight: 700 }}>{i + 1}</td>
      <td>
        <div style={{ fontWeight: 600 }}>{f.nombre}</div>
        <div className="vt2-sub">{f.dias} {f.dias === 1 ? 'día' : 'días'} · {pct1(f.pctDelEquipo)} del equipo{f.muestraChica ? ' · muestra chica' : ''}</div>
      </td>
      <td className="r vt-bold" data-col="venta">{fi(f.venta)}</td>
      <td className="r" data-col="personas">{f.personas}</td>
      <td className="r" data-col="vpp">
        {fmtVpp(f.vpp?.vpp.valor)}
        {f.vpp && f.vpp.vpp.pctEstimado > 0 && <span className="vt2-sub">incluye {pct1(f.vpp.vpp.pctEstimado)} est.</span>}
      </td>
      <td className={`r vt2-delta ${claseCambio(vt, f.muestraChica)}`} data-col="vsTurno">{vt === null ? '—' : fmtCambio(vt)}</td>
      <td className="r" data-col="promPax" style={gris ?? { color: metaColor(f.promPax, metaPP) }}>{fi(f.promPax)}</td>
      <td className="r" data-col="bebPax" style={gris ?? { color: metaColor(f.bebPax, metaBP) }}>{f.bebPax.toFixed(2)}</td>
      <td className={`r ${f.muestraChica ? '' : ratioCBClass(f.ratioCB)}`} data-col="ratioCB">{f.ratioCB.toFixed(2)}:1</td>
      <td className="r" data-col="promPlato">{f.promPlato > 0 ? fi(f.promPlato) : '—'}</td>
      <td className="r" data-col="ticketItem">{fi(f.ticketItem)}</td>
      {detalle && <>
        <td className="r" data-col="icp">{icp === undefined || icp === null ? '—' : icp === 'barra' ? 'no aplica' : pct1(icp.icp)}</td>
        <td className="r" data-col="pctMeta">{ev?.pctMeta == null ? '—' : `${ev.pctMeta.toFixed(0)} %`}</td>
        <td className="r" data-col="dias">{f.dias}</td>
        <td className="r" data-col="consistencia">{ev ? `${ev.consistencia.toFixed(0)} %` : '—'}</td>
        <td className="r" data-col="tendencia">{ev?.tendencia == null ? '—' : fmtCambio(ev.tendencia)}</td>
        <td className="r" data-col="racha">{ev && ev.racha > 0 ? `${ev.racha} d` : '—'}</td>
      </>}
    </tr>
  )
}

function Ficha({ f, periodo, bases, lectura, local, onCerrar }: {
  f: FilaEquipo; periodo: PeriodoV2; bases: BaseId[]; lectura: Lectura; local: string; onCerrar: () => void
}) {
  const ventana = useMemo(() => ventana12Semanas(periodo.hasta), [periodo.hasta])
  const claveV = `${local}|${ventana.desde}|${ventana.hasta}`
  const [doce, setDoce] = useState<{ clave: string; l: Lectura } | null>(null)
  const [falloV, setFalloV] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    cargarLecturaRango(local, ventana)
      .then(l => { if (vivo) setDoce({ clave: claveV, l }) })
      .catch(e => { if (vivo) setFalloV(e instanceof Error ? e.message : 'No se pudo leer el PoS') })
    return () => { vivo = false }
  }, [claveV, local, ventana])
  const semanas = useMemo(
    () => doce && doce.clave === claveV ? doceSemanas(doce.l.facturas, doce.l.nombres, f.nombre, periodo.hasta) : null,
    [doce, claveV, f.nombre, periodo.hasta],
  )
  const contraBases = bases.map(id => {
    const r = periodo.bases[id]
    const suya = r ? vppPorSalonero(lectura.facturas, lectura.nombres, r).porNombre.get(f.nombre)?.vpp ?? null : null
    return { id, r, suya }
  })
  const actual = f.vpp?.vpp ?? null
  const maxSem = semanas ? Math.max(1, ...semanas.map(s => Math.max(s.suya ?? 0, s.equipo ?? 0))) : 1
  return (
    <section className="vt-panel" aria-label={`Ficha de ${f.nombre}`} data-testid="ficha-salonero"
      style={{ marginTop: '1.25rem', padding: '1rem', background: 'var(--c-panel)', borderRadius: 2 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div className="vt-sl">Ficha · {f.nombre}</div>
        <button type="button" className="vt-period-btn" onClick={onCerrar} aria-label="Cerrar la ficha">✕</button>
      </div>

      <div className="vt-kpi-grid" style={{ marginTop: '0.5rem' }}>
        <div className="vt-kpi" data-cifra="ficha-vpp">
          <div className="vt-kpi-label">Venta por persona</div>
          <div className="vt-kpi-val">{fmtVpp(actual?.valor)}</div>
          {contraBases.map(c => {
            const cambio = cambioPct(actual?.valor, c.suya?.valor)
            return (
              <div key={c.id} className={`vt-kpi-delta vt2-delta ${claseCambio(cambio, f.muestraChica)}`}>
                {c.r ? fmtCambio(cambio) : 'sin comparación'}
                <span className="vt2-delta-base"> vs {baseConFechas(periodo, c.id)}: {fmtVpp(c.suya?.valor)}</span>
              </div>
            )
          })}
        </div>
        <div className="vt-kpi" data-cifra="ficha-personas">
          <div className="vt-kpi-label">Personas (cargadas + estimadas)</div>
          <div className="vt-kpi-val">{actual ? personasD4(actual) : '—'}</div>
          {contraBases.map(c => {
            const cambio = cambioPct(actual ? personasD4(actual) : null, c.suya ? personasD4(c.suya) : null)
            return (
              <div key={c.id} className={`vt-kpi-delta vt2-delta ${claseCambio(cambio)}`}>
                {c.r ? fmtCambio(cambio) : 'sin comparación'}
                <span className="vt2-delta-base"> vs {baseConFechas(periodo, c.id)}: {c.suya ? personasD4(c.suya) : '—'}</span>
              </div>
            )
          })}
        </div>
        <div className="vt-kpi">
          <div className="vt-kpi-label">Prom/plato · Prom/bebida</div>
          <div className="vt-kpi-val" style={{ fontSize: '0.95rem' }}>{f.promPlato > 0 ? fi(f.promPlato) : '—'} · {f.promBebida > 0 ? fi(f.promBebida) : '—'}</div>
        </div>
      </div>

      <div className="vt-sl" style={{ marginTop: '1rem' }}>Sus productos del período (los 5 de más venta)</div>
      {f.productos.length === 0 ? <div className="vt2-sub">Sin productos en el período.</div> : (
        <table className="vt-tbl" aria-label={`Productos de ${f.nombre}`}>
          <tbody>
            {f.productos.map(p => (
              <tr key={p.nombre}><td>{p.nombre}</td><td className="r">{p.q} uds</td><td className="r">{fi(p.m)}</td></tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="vt-sl" style={{ marginTop: '1rem' }}>Venta por persona — 12 semanas que terminan el {fechasCortas({ desde: periodo.hasta, hasta: periodo.hasta }, Number(periodo.ancla.slice(0, 4)))}</div>
      {falloV && <div className="tips-error" role="alert"><span>No se pudo leer el PoS: {falloV}</span></div>}
      {!semanas && !falloV && <div className="vt2-cargando" role="status">Leyendo las 12 semanas…</div>}
      {semanas && (
        <table className="vt-tbl" aria-label={`12 semanas de ${f.nombre}`} data-testid="doce-semanas">
          <thead><tr><th>Semana</th><th className="r">{f.nombre}</th><th className="r">Equipo</th><th style={{ width: '40%' }} /></tr></thead>
          <tbody>
            {semanas.map(s => (
              <tr key={s.desde}>
                <td>{fechasCortas(s, Number(periodo.ancla.slice(0, 4)))}</td>
                <td className="r">{fmtVpp(s.suya)}</td>
                <td className="r" style={{ color: 'var(--c-gris)' }}>{fmtVpp(s.equipo)}</td>
                <td>
                  <div style={{ height: 6, background: 'var(--c-oro)', width: `${((s.suya ?? 0) / maxSem) * 100}%`, borderRadius: 1 }} />
                  <div style={{ height: 3, marginTop: 2, background: 'var(--c-gris-claro)', width: `${((s.equipo ?? 0) / maxSem) * 100}%`, borderRadius: 1 }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
