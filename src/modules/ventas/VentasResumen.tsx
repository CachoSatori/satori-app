// ── Ventas v2 · «Resumen» (SPEC-ventas-v2 §5.1, fase 2.1) ──────────────────────────────────────
// Barra global + bajada + cuatro cifras con dos bases + gráfico por día + alerta de ayer + detalle
// por día (el de Contabilidad). Lee el PoS por las funciones de la 067 (`resumenV2Datos.ts`); el
// cálculo es `resumenV2.ts`. Convive con las vistas viejas hasta la fase 3.5.
// Fase 2.2: bloque «Meta del mes» (`proyeccion.ts`) y bases con nombre concreto y fechas
// («vs mes anterior a la misma fecha (1–17 oct)», pedido del dueño del 18-nov). Quincenas (2.3), todavía no.
// 3.5.2 (SPEC §5.1 ítems 6, 7 y 10): «Qué explica el cambio» (lo de «Análisis → Prom/PAX explicado»), el
// detalle por día con Prom/PAX, margen bruto y «🖨 Reporte» del mes (lo de «Ventas»), y «Salón en detalle»
// (lo de «Hoy» e «Histórico»). «Hoy», «Ventas» e «Histórico» se retiraron: lo suyo está acá y en «Regalías».
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../shared/hooks/useAuth'
import { dayOfWeek, dowLabel, fi } from './ventasUtils'
import BarraVentasV2 from './BarraVentasV2'
import { baseConFechas, basesDe, escribirBarra, fechasDeBase, leerBarra, nombreBase, periodoDeBarra, rotuloBase } from './barraVentasV2'
import { BASES, fechasCortas, sumarDias, type BaseId } from './periodos'
import { mesDe, proyectarMes, rangoDeLecturaProyeccion, type Proyeccion } from './proyeccion'
import type { DiasMap, HistMap, Meta, ProductMap } from '../../shared/types/ventas'
import { QueExplicaElCambio } from './VentasPromPaxExplicado'
import SalonEnDetalle from './SalonEnDetalle'
import { cargarLineasDeRangos } from './lineasPeriodo'
import { cargarHistEager } from './ventasFuente'
import { csvPorDia, margenDelMes, rangosDelReporte } from './resumenDetalle'
import {
  alertaDeAyer, avisoCalidad, bajada, cifrasDelRango, compararCifras, csvResumen, CIFRAS,
  UMBRAL_SIN_PAX_PCT, type CifrasRango, type Lectura,
} from './resumenV2'
import { cargarLecturaRango, cargarLecturaResumen, getLocalesVentas, type LocalVentas } from './resumenV2Datos'
import { LOCAL_POR_DEFECTO } from './ventasDiasDesdePos'
import { localPorDefecto } from '../../shared/utils/ordenLocales'
import { PRIMERA_JORNADA_POS } from './ventasFuente'

const casiCero = (x: number) => Math.abs(x) < 0.05
const fmtPct = (x: number) => casiCero(x) ? '0,0 %' : `${x > 0 ? '+' : '−'}${Math.abs(x).toFixed(1).replace('.', ',')} %`
const fmtNum = (x: number) => Math.round(x).toLocaleString('es-CR')
/** «Sin 2 mesas de dueños ni 1 regalía total.» Solo lo que hay. */
function fueraTxt(duenos: number, regalias: number): string {
  const partes = [
    duenos > 0 ? `${duenos} ${duenos === 1 ? 'mesa' : 'mesas'} de dueños` : null,
    regalias > 0 ? `${regalias} ${regalias === 1 ? 'regalía total' : 'regalías totales'}` : null,
  ].filter(Boolean)
  return partes.length ? ` Sin ${partes.join(' ni ')}.` : ''
}
const fmtCifra = (id: string, v: number | null) =>
  v === null ? '—' : id === 'personas' ? fmtNum(v) : fi(Math.round(v))

// El reporte mensual imprimible (el «🖨 Reporte» de la vieja «Ventas»), sin cambios: se carga al tocarlo.
const ReporteMensual = lazy(() => import('./ReporteMensual'))

export default function VentasResumen({ metas }: { metas?: Meta } = {}) {
  const { profile } = useAuth()
  const role = profile?.role ?? ''
  const [sp, setSp] = useSearchParams()
  const estado = useMemo(() => leerBarra(sp), [sp])
  // El período depende solo de tipo y fechas: cambiar «Comparar con» no lo rehace ni vuelve a leer.
  const { tipo, dia, desde, hasta } = estado
  const { periodo, aviso } = useMemo(() => periodoDeBarra({ tipo, dia, desde, hasta }), [tipo, dia, desde, hasta])

  const [locales, setLocales] = useState<LocalVentas[]>([])
  useEffect(() => {
    let vivo = true
    getLocalesVentas(role).then(l => { if (vivo) setLocales(l) }).catch(() => { if (vivo) setLocales([]) })
    return () => { vivo = false }
  }, [role])
  // D16: el elegido en la URL si lo ve; si no, Santa Teresa; si no, el primero que ve. Antes de que lleguen los
  // locales se respeta la URL y, sin URL, Santa Teresa.
  const local = locales.length === 0
    ? (estado.local ?? LOCAL_POR_DEFECTO)
    : (localPorDefecto(locales, estado.local) ?? LOCAL_POR_DEFECTO)

  const [lectura, setLectura] = useState<{ clave: string; l: Lectura } | null>(null)
  const [fallo, setFallo] = useState<{ clave: string; msg: string } | null>(null)
  const clave = `${local}|${periodo.tipo}|${periodo.desde}|${periodo.hasta}`
  useEffect(() => {
    const p = periodo
    if (p.tipo === 'hoy') return
    let vivo = true
    cargarLecturaResumen(local, p)
      .then(l => { if (vivo) setLectura({ clave, l }) })
      .catch(e => { if (vivo) setFallo({ clave, msg: e instanceof Error ? e.message : 'No se pudo leer el PoS' }) })
    return () => { vivo = false }
  }, [clave, local, periodo])

  const error = fallo && fallo.clave === clave ? fallo.msg : null
  const cambiar = (e: typeof estado) => setSp(escribirBarra(sp, e))

  const datos = useMemo(() => {
    if (!lectura || lectura.clave !== clave) return null
    const p = cifrasDelRango(lectura.l, periodo)
    const bases = Object.fromEntries(BASES.map(id => {
      const b = periodo.bases[id]
      return [id, b ? cifrasDelRango(lectura.l, b) : null]
    })) as Record<BaseId, CifrasRango | null>
    return { p, bases, alerta: alertaDeAyer(lectura.l, periodo) }
  }, [lectura, clave, periodo])

  const barra = <BarraVentasV2 estado={estado} periodo={periodo} locales={locales} aviso={aviso} onCambio={cambiar} />

  if (periodo.tipo === 'hoy') {
    return (
      <div className="vt-section">
        {barra}
        <div className="vt2-hoy">
          Hoy está en curso y no entra en las comparaciones. El servicio de hoy, contra la misma hora, se mira en «En vivo».
          {' '}<button type="button" className="vt-period-btn active"
            onClick={() => { const n = new URLSearchParams(sp); n.set('tab', 'envivo'); setSp(n) }}>Ir a En vivo →</button>
        </div>
      </div>
    )
  }

  return (
    <div className="vt-section">
      {barra}
      {error && <div className="tips-error" role="alert"><span>No se pudo leer el PoS: {error}</span></div>}
      {!datos && !error && (
        <div className="vt2-cargando" role="status">
          Leyendo las ventas del PoS{periodo.dias > 62 ? ' (período largo: puede tardar unos segundos)' : ''}…
        </div>
      )}
      {datos && <Contenido periodo={periodo} datos={datos} bases={basesDe(estado.comparar)}
        nombres={lectura?.l.nombres ?? {}} abrirDetalle={role === 'contador'} local={local}
        nombreLocal={locales.find(l => l.id === local)?.nombre ?? local} metas={metas}
        meta={<MetaDelMes local={local} N={periodo.N} ancla={periodo.ancla} metas={metas} />} />}
    </div>
  )
}

interface ContenidoProps {
  periodo: ReturnType<typeof periodoDeBarra>['periodo']
  datos: { p: CifrasRango; bases: Record<BaseId, CifrasRango | null>; alerta: ReturnType<typeof alertaDeAyer> }
  /** Las bases que se muestran (una o las dos), en orden. */
  bases: BaseId[]
  nombres: Record<string, string>
  abrirDetalle: boolean
  meta?: React.ReactNode
  local: string
  nombreLocal: string
  metas?: Meta
}

function Contenido({ periodo, datos, bases: visibles, nombres, abrirDetalle, meta, local, nombreLocal, metas }: ContenidoProps) {
  const { p, bases, alerta } = datos
  const cmps = visibles.map(id => ({ id, cmp: compararCifras(p, bases[id]) }))
  const valores = compararCifras(p, null)
  // El gráfico dibuja la última base elegida (con «Los dos», la del año pasado, como antes).
  const baseGrafico = visibles[visibles.length - 1]
  const enFrase = (id: BaseId) => ({ id, cifras: bases[id], nombre: { ...nombreBase(periodo, id), fechas: fechasDeBase(periodo, id) } })
  const calidad = avisoCalidad(p)
  // «Qué explica el cambio» contra la primera base elegida (con «Los dos», el período anterior).
  const baseExplica = periodo.bases[visibles[0]]
  const esMes = periodo.tipo === 'mes' || periodo.tipo === 'mesALaFecha'
  const ym = periodo.desde.slice(0, 7)
  const margen = esMes ? margenDelMes(metas, ym, p.totales.ventaBruta) : null
  const fechasPeriodo = fechasCortas(periodo, Number(periodo.ancla.slice(0, 4)))
  const maxNeta = Math.max(0, ...p.dias.map(d => d.ventaNeta))
  const minNeta = Math.min(...p.dias.map(d => d.ventaNeta))

  const exportar = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csvResumen(periodo, p, bases)], { type: 'text/csv;charset=utf-8' }))
    a.download = `satori_resumen_${periodo.desde}_${periodo.hasta}.csv`
    a.click()
  }
  // El «⬇ CSV» por día de la vieja «Ventas» (el del contador), con las mismas columnas.
  const exportarPorDia = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csvPorDia(p.dias)], { type: 'text/csv;charset=utf-8' }))
    a.download = `satori_ventas_${periodo.desde}_${periodo.hasta}.csv`
    a.click()
  }

  return (
    <>
      <p className="vt2-bajada">{bajada(p, enFrase(visibles[0]), visibles[1] ? enFrase(visibles[1]) : undefined)}</p>

      <div className="vt-kpi-grid vt2-cifras">
        {CIFRAS.map((c, i) => (
          <div className={`vt-kpi ${c.id === 'ventaNeta' ? 'green' : ''}`} key={c.id} data-cifra={c.id}>
            <div className="vt-kpi-label">{c.label}</div>
            <div className="vt-kpi-val">{fmtCifra(c.id, valores[i].valor)}</div>
            {cmps.map(({ cmp: todas, id }) => ({ cmp: todas[i], id })).map(({ cmp, id }) => (
              <div key={id} className={`vt-kpi-delta vt2-delta ${cmp.cambio === null || cmp.muestraChica || casiCero(cmp.cambio) ? 'gris' : cmp.cambio >= 0 ? 'sube' : 'baja'}`}
                title={periodo.bases[id]?.rotulo ?? periodo.motivos[id] ?? ''}>
                {cmp.cambio === null ? 'sin comparación' : `${cmp.muestraChica || casiCero(cmp.cambio) ? '' : cmp.cambio >= 0 ? '▲ ' : '▼ '}${fmtPct(cmp.cambio)}`}
                <span className="vt2-delta-base"> vs {baseConFechas(periodo, id)}: {fmtCifra(c.id, cmp.base)}</span>
              </div>
            ))}
            {c.id === 'ventaPorPersona' && (
              <div className="vt-kpi-sub">
                Neta de salón ÷ personas de salón; incluye {p.vpp.pctEstimado.toFixed(1).replace('.', ',')} % estimado.
                {fueraTxt(p.vpp.mesasDuenos, p.vpp.regaliasTotales)}
              </div>
            )}
            {c.id === 'personas' && <div className="vt-kpi-sub">PAX cargado (como Contabilidad).</div>}
            {c.id === 'cuentaPromedio' && <div className="vt-kpi-sub">{fmtNum(p.facturas)} facturas</div>}
            {c.id === 'ventaNeta' && p.ventaPorDiaAbierto !== null && (
              <div className="vt-kpi-sub">{fi(Math.round(p.ventaPorDiaAbierto))} por día abierto ({p.diasAbiertos} días)</div>
            )}
          </div>
        ))}
      </div>

      {visibles.map(id => (!periodo.bases[id] || periodo.bases[id]?.notaLargo || periodo.bases[id]?.nota) && (
        <div key={id} className="vt2-nota">
          {rotuloBase(periodo, id)}: {periodo.bases[id]
            ? [periodo.bases[id]!.notaLargo, periodo.bases[id]!.nota].filter(Boolean).join(' · ')
            : periodo.motivos[id]}
        </div>
      ))}

      {calidad.supera && (
        <div className="vt2-aviso" role="status">
          Dato incompleto: {calidad.pctSinPax.toFixed(1).replace('.', ',')} % de las mesas de salón del período no tienen pax
          (umbral {UMBRAL_SIN_PAX_PCT} %). La venta por persona las estima.
        </div>
      )}

      {meta}

      <AlertaAyer alerta={alerta} nombres={nombres} dia={periodo.N} />

      <Grafico p={p} base={bases[baseGrafico]} desdeBase={periodo.bases[baseGrafico]?.desde ?? null} rotuloBase={baseConFechas(periodo, baseGrafico)} />

      <QueExplicaElCambio local={local} actual={{ desde: periodo.desde, hasta: periodo.hasta }}
        base={baseExplica ? { desde: baseExplica.desde, hasta: baseExplica.hasta } : null}
        nombreBase={baseConFechas(periodo, visibles[0])} />

      <details className="vt2-detalle" open={abrirDetalle}>
        <summary>Detalle por día (igual que Contabilidad)</summary>
        <div className="vt-table-actions">
          <button type="button" className="vt-period-btn" onClick={exportarPorDia}>⬇ CSV por día</button>
          <button type="button" className="vt-period-btn" onClick={exportar}>⬇ CSV (con las tres bases)</button>
          {esMes && metas && <ReporteDelMes local={local} ym={ym} metas={metas} />}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="vt-tbl" aria-label="Detalle por día">
            <thead><tr><th>Fecha</th><th>Día</th><th>Bruta</th><th>IVA</th><th>Servicio</th><th>Neta</th><th>Salón</th><th>Delivery</th><th>PAX</th><th title="Salón ÷ PAX cargado, como Contabilidad">Prom/PAX</th></tr></thead>
            <tbody>
              {p.dias.map(d => (
                <tr key={d.fecha} className={p.dias.length > 1 && d.ventaNeta === maxNeta && maxNeta > 0 ? 'tr-best'
                  : p.dias.length > 1 && d.ventaNeta === minNeta && minNeta > 0 && minNeta !== maxNeta ? 'tr-worst' : ''}>
                  <td>{d.fecha}</td><td>{dowLabel(dayOfWeek(d.fecha))}</td>
                  <td>{fi(d.ventaBruta)}</td><td>{fi(d.iva)}</td><td>{fi(d.serv)}</td><td>{fi(d.ventaNeta)}</td>
                  <td>{fi(d.salon)}</td><td>{fi(d.delivery)}</td><td>{d.pax}</td><td>{fi(d.promPax)}</td>
                </tr>
              ))}
              <tr className="vt2-total" data-fila="total">
                <td>TOTAL</td><td />
                <td>{fi(p.totales.ventaBruta)}</td><td>{fi(p.totales.iva)}</td><td>{fi(p.totales.serv)}</td>
                <td>{fi(p.totales.ventaNeta)}</td><td>{fi(p.totales.salon)}</td><td>{fi(p.totales.delivery)}</td>
                <td>{p.totales.pax}</td><td>{fi(p.totales.promPax)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {margen && (
          <p className="vt2-nota" data-fila="margen">
            Margen bruto (contador) de {fechasPeriodo}: {margen.pct.toFixed(1).replace('.', ',')} % de la venta bruta del
            período ({fi(p.totales.ventaBruta)}) = <strong>{fi(margen.crc)}</strong>. El % se carga en «Ajustes» → «Metas».
          </p>
        )}
        <p className="vt2-nota">
          Prom/PAX de esta tabla = salón ÷ PAX cargado, como Contabilidad. La «Venta por persona» de arriba estima las mesas
          sin pax (incluye {p.vpp.pctEstimado.toFixed(1).replace('.', ',')} % estimado) y deja afuera las mesas de dueños y las
          regalías totales: por eso no da igual.
        </p>
      </details>

      <SalonEnDetalle local={local} nombreLocal={nombreLocal} periodo={{ desde: periodo.desde, hasta: periodo.hasta }}
        rotulo={periodo.rotulo} metas={metas}
        personas={{ total: p.vpp.personasCargadas + p.vpp.personasEstimadas, pctEstimado: p.vpp.pctEstimado }} />
    </>
  )
}

/**
 * El «🖨 Reporte» del mes, el mismo de la vieja «Ventas» (`ReporteMensual`, sin cambios). Sus datos se leen
 * al tocarlo: el mes, el anterior y el mismo mes del año pasado (contra los que compara), más el histórico
 * viejo de `ventas_hist` (antes del PoS).
 */
function ReporteDelMes({ local, ym, metas }: { local: string; ym: string; metas?: Meta }) {
  const [abierto, setAbierto] = useState(false)
  const [d, setD] = useState<{ ym: string; dias: DiasMap; hist: HistMap; pm: ProductMap } | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  useEffect(() => {
    if (!abierto) return
    let vivo = true
    Promise.all([cargarLineasDeRangos(local, rangosDelReporte(ym)), cargarHistEager()])
      .then(([l, hist]) => { if (vivo) setD({ ym, dias: l.dias, hist, pm: l.pm }) })
      .catch(e => { if (vivo) { setFallo(e instanceof Error ? e.message : 'No se pudo leer el PoS'); setAbierto(false) } })
    return () => { vivo = false }
  }, [abierto, local, ym])
  const listo = abierto && d && d.ym === ym
  return (
    <>
      <button type="button" className="tips-btn-teal" style={{ fontSize: '0.8rem' }} onClick={() => { setFallo(null); setAbierto(true) }} disabled={abierto && !listo}>
        {abierto && !listo ? 'Armando el reporte…' : '🖨 Reporte'}
      </button>
      {fallo && <span className="vt2-nota" role="alert">No se pudo armar el reporte: {fallo}</span>}
      {listo && metas && (
        <Suspense fallback={null}>
          <ReporteMensual ym={ym} dias={d.dias} hist={d.hist} pm={d.pm} metas={metas} onClose={() => setAbierto(false)} />
        </Suspense>
      )}
    </>
  )
}

function AlertaAyer({ alerta, nombres, dia }: { alerta: ReturnType<typeof alertaDeAyer>; nombres: Record<string, string>; dia: string }) {
  const conFalta = alerta.porSalonero.filter(s => s.sinPax > 0)
  const desdeCaja = alerta.sinSalonero.facturasSalon
  if (alerta.total.facturasSalon === 0) return null
  return (
    <div className="vt2-alerta" data-bloque="alerta-ayer">
      <div className="vt-sl">Ayer ({dia}): mesas sin pax</div>
      <p>
        {alerta.total.sinPax === 0
          ? 'Todas las mesas de salón de ayer tienen pax.'
          : `${alerta.total.sinPax} de ${alerta.total.facturasSalon} mesas de salón sin pax (${alerta.total.pct.toFixed(1).replace('.', ',')} %).`}
        {' '}{desdeCaja > 0 && `${desdeCaja === 1 ? '1 mesa se cargó entera' : `${desdeCaja} mesas se cargaron enteras`} desde la caja (sin salonero)${alerta.sinSalonero.sinPax > 0 ? `, ${alerta.sinSalonero.sinPax} sin pax` : ''}.`}
        {alerta.mesasInternas > 0 && ` No cuenta ${alerta.mesasInternas === 1 ? '1 factura de mesa interna' : `${alerta.mesasInternas} facturas de mesas internas`} (Ajustes): ahí no se cargan personas.`}
      </p>
      {conFalta.length > 0 && (
        <ul>
          {conFalta.map(s => (
            <li key={s.salonero_login}>{nombres[s.salonero_login] ?? s.salonero_login}: {s.sinPax} de {s.facturasSalon}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Grafico({ p, base, desdeBase, rotuloBase }: { p: CifrasRango; base: CifrasRango | null; desdeBase: string | null; rotuloBase: string }) {
  if (p.dias.length < 2) return null
  const fechas: string[] = []
  for (let d = p.rango.desde; d <= p.rango.hasta; d = sumarDias(d, 1)) fechas.push(d)
  const porFecha = new Map(p.dias.map(d => [d.fecha, d.ventaNeta]))
  const porFechaBase = new Map((base?.dias ?? []).map(d => [d.fecha, d.ventaNeta]))
  const vals = fechas.map(f => porFecha.get(f) ?? 0)
  const valsBase = desdeBase ? fechas.map((_, i) => porFechaBase.get(sumarDias(desdeBase, i)) ?? null) : []
  const max = Math.max(1, ...vals, ...valsBase.map(v => v ?? 0))
  const W = 640, H = 160, ancho = W / fechas.length
  const y = (v: number) => H - (v / max) * (H - 10)
  const linea = valsBase.map((v, i) => (v === null ? null : `${(i + 0.5) * ancho},${y(v)}`)).filter(Boolean).join(' ')
  return (
    <figure className="vt2-grafico" aria-label="Venta neta por día">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img">
        {vals.map((v, i) => (
          <rect key={fechas[i]} x={i * ancho + 1} y={y(v)} width={Math.max(1, ancho - 2)} height={H - y(v)} fill="var(--c-oro)">
            <title>{`${fechas[i]}: ${fi(v)}`}</title>
          </rect>
        ))}
        {linea && <polyline points={linea} fill="none" stroke="var(--c-azul)" strokeWidth={2} />}
      </svg>
      <figcaption>Barras: venta neta por día. Línea: {rotuloBase}, alineada día por día.</figcaption>
    </figure>
  )
}

// ── Meta del mes (SPEC §4.3, fase 2.2) ──────────────────────────────────────────────────────

const MESES_LARGOS = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre'] as const
const pct0 = (x: number) => `${Math.round(x)} %`

/**
 * El mes de AYER (`N`), a la fecha: lo mismo que el resto del Resumen (hoy no entra). Siempre el mes
 * en curso, sea cual sea el período elegido arriba. La meta es la de «Metas» (una por mes, del local
 * principal): en otro local no se muestra.
 */
function MetaDelMes({ local, N, ancla, metas }: { local: string; N: string; ancla: string; metas?: Meta }) {
  const mes = useMemo(() => mesDe(N), [N])
  const ym = N.slice(0, 7)
  const nombreMes = MESES_LARGOS[Number(N.slice(5, 7))]
  const meta = metas?.restaurante?.[ym] ?? 0
  const esPrincipal = local === LOCAL_POR_DEFECTO
  const [r, setR] = useState<{ clave: string; p: Proyeccion } | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  const clave = `${local}|${N}|${meta}`
  useEffect(() => {
    if (!esPrincipal || meta <= 0) return
    let vivo = true
    const rango = rangoDeLecturaProyeccion(mes, N)
    cargarLecturaRango(local, rango)
      .then(l => {
        if (!vivo) return
        const netaPorDia = new Map(cifrasDelRango(l, rango).dias.map(d => [d.fecha, d.ventaNeta]))
        setR({ clave, p: proyectarMes({ meta, mes, N, netaPorDia, primerDiaConDatos: PRIMERA_JORNADA_POS }) })
      })
      .catch(e => { if (vivo) setFallo(e instanceof Error ? e.message : 'No se pudo leer el PoS') })
    return () => { vivo = false }
  }, [clave, esPrincipal, local, meta, mes, N])

  const titulo = <div className="vt-sl">Meta de {nombreMes}</div>
  if (!esPrincipal) {
    return <div className="vt2-meta" data-bloque="meta-mes">{titulo}<p className="vt2-nota">Las metas de «Metas» son del local principal: este local todavía no tiene meta propia.</p></div>
  }
  if (meta <= 0) {
    return <div className="vt2-meta" data-bloque="meta-mes">{titulo}<p className="vt2-nota">No hay meta cargada para {nombreMes}. Se carga en «Metas».</p></div>
  }
  if (fallo) return <div className="vt2-meta" data-bloque="meta-mes">{titulo}<p className="vt2-nota">No se pudo calcular la meta: {fallo}</p></div>
  const p = r && r.clave === clave ? r.p : null
  if (!p) return <div className="vt2-meta" data-bloque="meta-mes">{titulo}<p className="vt2-nota" role="status">Calculando la meta del mes…</p></div>
  if (p.estado === 'sinDiasCerrados') {
    return <div className="vt2-meta" data-bloque="meta-mes">{titulo}<p className="vt2-nota">{nombreMes[0].toUpperCase() + nombreMes.slice(1)} todavía no tiene días cerrados.</p></div>
  }
  const anio = Number(ancla.slice(0, 4))
  const aLaFecha = p.cerrados ? fechasCortas(p.cerrados, anio) : ''
  const cerrado = p.estado === 'mesCerrado'
  const ritmoTxt = p.ritmo === null ? '—' : pct0(p.ritmo * 100)
  return (
    <div className="vt2-meta" data-bloque="meta-mes">
      <div className="vt-sl">Meta de {nombreMes} · {cerrado ? `mes cerrado (${aLaFecha})` : `a la fecha (hasta ayer, ${aLaFecha})`}</div>
      <div className="vt-kpi-grid">
        <div className="vt-kpi" data-meta="meta"><div className="vt-kpi-label">Meta del mes</div><div className="vt-kpi-val">{fi(Math.round(p.meta))}</div>
          <div className="vt-kpi-sub">{fi(Math.round(p.meta / p.diasMes))} por día en promedio ({p.diasMes} días)</div></div>
        <div className="vt-kpi" data-meta="vendido"><div className="vt-kpi-label">Vendido</div><div className="vt-kpi-val">{fi(Math.round(p.vendido))}</div>
          <div className="vt-kpi-sub">{pct0(p.avancePct ?? 0)} de la meta · {p.diasCerrados} de {p.diasMes} días</div></div>
        {!cerrado && <>
          <div className="vt-kpi" data-meta="ritmo"><div className="vt-kpi-label">Ritmo</div><div className="vt-kpi-val">{ritmoTxt}</div>
            <div className="vt-kpi-sub">de lo que tocaba a la fecha ({fi(Math.round(p.metaALaFecha ?? 0))}). Si sigue así, cierra en ese % de la meta</div></div>
          <div className={`vt-kpi ${p.proyeccion >= p.meta ? 'green' : ''}`} data-meta="proyeccion"><div className="vt-kpi-label">Proyección del mes</div>
            <div className="vt-kpi-val">{fi(Math.round(p.proyeccion))}</div>
            <div className="vt-kpi-sub">{p.ponderada ? `± ${fi(Math.round(p.rango))} · ` : ''}{p.proyeccion >= p.meta
              ? `${fi(Math.round(p.proyeccion - p.meta))} sobre la meta` : `${fi(Math.round(p.meta - p.proyeccion))} debajo de la meta`}</div></div>
          <div className="vt-kpi" data-meta="necesario"><div className="vt-kpi-label">Necesario por día</div>
            <div className="vt-kpi-val">{fi(Math.round(p.necesarioPorDia ?? 0))}</div>
            <div className="vt-kpi-sub">Faltan {fi(Math.max(0, Math.round(p.meta - p.vendido)))} para la meta · {p.diasQueFaltan} {p.diasQueFaltan === 1 ? 'día que falta' : 'días que faltan'} (con hoy)</div></div>
        </>}
      </div>
      {!cerrado && (
        <p className="vt2-nota">
          {p.ponderada
            ? 'Proyección: lo vendido más los días que faltan, cada uno con el peso de su día de semana (promedio de las últimas 8 semanas cerradas, lunes a domingo). El ritmo compara lo vendido con la parte de la meta que tocaba a la fecha, repartida con esos mismos pesos. El ± es lo que suele apartarse un día de lo esperado, sin contar la temporada. No usa el día de hoy.'
            : 'Sin 8 semanas cerradas de historia para pesar los días de semana: la proyección es lineal (lo vendido por día × los días del mes) y sin ±. No usa el día de hoy.'}
        </p>
      )}
    </div>
  )
}
