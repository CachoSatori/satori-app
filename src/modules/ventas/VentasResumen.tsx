// ── Ventas v2 · «Resumen» (SPEC-ventas-v2 §5.1, fase 2.1) ──────────────────────────────────────
// Barra global + bajada + cuatro cifras con dos bases + gráfico por día + alerta de ayer + detalle
// por día (el de Contabilidad). Lee el PoS por las funciones de la 067 (`resumenV2Datos.ts`); el
// cálculo es `resumenV2.ts`. Convive con las vistas viejas hasta la fase 3.5.
// Fase 2.2: bloque «Meta del mes» (`proyeccion.ts`) y bases con nombre concreto y fechas
// («vs mes anterior a la misma fecha (1–17 oct)», pedido del dueño del 18-nov). Quincenas (2.3), todavía no.
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../shared/hooks/useAuth'
import { dayOfWeek, dowLabel, fi } from './ventasUtils'
import BarraVentasV2 from './BarraVentasV2'
import { baseConFechas, basesDe, escribirBarra, fechasDeBase, leerBarra, nombreBase, periodoDeBarra, rotuloBase } from './barraVentasV2'
import { BASES, fechasCortas, sumarDias, type BaseId } from './periodos'
import { mesDe, proyectarMes, rangoDeLecturaProyeccion, type Proyeccion } from './proyeccion'
import type { Meta } from '../../shared/types/ventas'
import {
  alertaDeAyer, avisoCalidad, bajada, cifrasDelRango, compararCifras, csvResumen, CIFRAS,
  UMBRAL_SIN_PAX_PCT, type CifrasRango, type Lectura,
} from './resumenV2'
import { cargarLecturaRango, cargarLecturaResumen, getLocalesVentas, type LocalVentas } from './resumenV2Datos'
import { LOCAL_POR_DEFECTO } from './ventasDiasDesdePos'
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
  const local = estado.local && (locales.length === 0 || locales.some(l => l.id === estado.local))
    ? estado.local : (locales[0]?.id ?? LOCAL_POR_DEFECTO)

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
        nombres={lectura?.l.nombres ?? {}} abrirDetalle={role === 'contador'}
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
}

function Contenido({ periodo, datos, bases: visibles, nombres, abrirDetalle, meta }: ContenidoProps) {
  const { p, bases, alerta } = datos
  const cmps = visibles.map(id => ({ id, cmp: compararCifras(p, bases[id]) }))
  const valores = compararCifras(p, null)
  // El gráfico dibuja la última base elegida (con «Los dos», la del año pasado, como antes).
  const baseGrafico = visibles[visibles.length - 1]
  const enFrase = (id: BaseId) => ({ id, cifras: bases[id], nombre: { ...nombreBase(periodo, id), fechas: fechasDeBase(periodo, id) } })
  const calidad = avisoCalidad(p)

  const exportar = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csvResumen(periodo, p, bases)], { type: 'text/csv;charset=utf-8' }))
    a.download = `satori_resumen_${periodo.desde}_${periodo.hasta}.csv`
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

      <details className="vt2-detalle" open={abrirDetalle}>
        <summary>Detalle por día (igual que Contabilidad)</summary>
        <div className="vt-table-actions"><button type="button" className="vt-period-btn" onClick={exportar}>⬇ CSV (con las tres bases)</button></div>
        <div style={{ overflowX: 'auto' }}>
          <table className="vt-tbl" aria-label="Detalle por día">
            <thead><tr><th>Fecha</th><th>Día</th><th>Bruta</th><th>IVA</th><th>Servicio</th><th>Neta</th><th>Salón</th><th>Delivery</th><th>PAX</th></tr></thead>
            <tbody>
              {p.dias.map(d => (
                <tr key={d.fecha}>
                  <td>{d.fecha}</td><td>{dowLabel(dayOfWeek(d.fecha))}</td>
                  <td>{fi(d.ventaBruta)}</td><td>{fi(d.iva)}</td><td>{fi(d.serv)}</td><td>{fi(d.ventaNeta)}</td>
                  <td>{fi(d.salon)}</td><td>{fi(d.delivery)}</td><td>{d.pax}</td>
                </tr>
              ))}
              <tr className="vt2-total" data-fila="total">
                <td>TOTAL</td><td />
                <td>{fi(p.totales.ventaBruta)}</td><td>{fi(p.totales.iva)}</td><td>{fi(p.totales.serv)}</td>
                <td>{fi(p.totales.ventaNeta)}</td><td>{fi(p.totales.salon)}</td><td>{fi(p.totales.delivery)}</td>
                <td>{p.totales.pax}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
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
        <div className="vt-kpi" data-meta="meta"><div className="vt-kpi-label">Meta del mes</div><div className="vt-kpi-val">{fi(Math.round(p.meta))}</div></div>
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
            <div className="vt-kpi-sub">{p.diasQueFaltan} {p.diasQueFaltan === 1 ? 'día que falta' : 'días que faltan'} (con hoy)</div></div>
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
