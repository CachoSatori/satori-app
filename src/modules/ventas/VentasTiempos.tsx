// ── Ventas v2 · «Tiempos» (SPEC-ventas-v2 §5.4, fase 2.3) ──────────────────────────────────────
// Barra global (la misma del Resumen, en la URL) + día de semana + hora y turno + quincenas +
// tiempo sentado + calendario. El cálculo es `tiemposV2.ts`; la lectura, `tiemposV2Datos.ts` (190 + 193; sin la
// 193, la 080 y el mapa solo de salón). Las mesas internas (Ajustes) son venta: solo salen del tiempo sentado.
// Convive con «Calendario» y «Análisis» hasta la fase 3.5.
// Queda para después: «Meses y temporadas» (§5.4 ítem 4) y las fechas especiales del calendario (fase 3).
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../shared/hooks/useAuth'
import type { FilaPromPaxRpc } from '../../shared/api/posNdf'
import { fi } from './ventasUtils'
import BarraVentasV2 from './BarraVentasV2'
import { basesALeer, basesDe, conArticulo, nombreBase, escribirBarra, leerBarra, periodoDeBarra, rotuloBase } from './barraVentasV2'
import { estimadorPorNeta, ventaPorPersona } from './indicadores'
import type { BaseId, PeriodoV2 } from './periodos'
import { cifrasDelRango, MUESTRA_CHICA_PERSONAS, type Lectura } from './resumenV2'
import {
  calendario, claseDeCambio, compararDiaSemana, DIAS_SEMANA_LARGO, fmtPctSigno, filasQuincenas, mapaHoras, mapaHorasTodos, nombreQuincena, porDiaSemana, porTurno,
  porTurnoHoras, rangosDeTiempos, ultimasQuincenas, vppPorDiaSemana,
} from './tiemposV2'
import { cargarLecturaDeRangos, cargarTiempos, cargarTurnos, getLocalesVentas } from './tiemposV2Datos'
import { TAMANOS, type TiemposRpc } from './tiemposV2Rpc'
import type { LocalVentas } from './resumenV2Datos'
import { LOCAL_POR_DEFECTO } from './ventasDiasDesdePos'

/** «Tiempos» abre en el mes en curso, a la fecha («Mes» en la barra): con un solo día no hay día de semana ni calendario. */
export const PERIODO_TIEMPOS = 'mesALaFecha' as const

const fmtPct = (x: number | null) => x === null ? 'sin comparación'
  : Math.abs(x) < 0.05 ? '0,0 %' : `${x > 0 ? '▲ +' : '▼ −'}${Math.abs(x).toFixed(1).replace('.', ',')} %`
const claseCambio = (x: number | null) => x === null || Math.abs(x) < 0.05 ? 'gris' : x > 0 ? 'sube' : 'baja'
const fmtVpp = (v: number | null) => v === null ? '—' : fi(Math.round(v))

export default function VentasTiempos() {
  const { profile } = useAuth()
  const role = profile?.role ?? ''
  const [sp, setSp] = useSearchParams()
  const estado = useMemo(() => leerBarra(sp, PERIODO_TIEMPOS), [sp])
  const { tipo, dia, desde, hasta, comparar } = estado
  const [baseA, baseB] = basesALeer(comparar)
  const { periodo, aviso } = useMemo(() => periodoDeBarra({ tipo, dia, desde, hasta }), [tipo, dia, desde, hasta])
  const quincenas = useMemo(() => ultimasQuincenas(periodo), [periodo])

  const [locales, setLocales] = useState<LocalVentas[]>([])
  useEffect(() => {
    let vivo = true
    getLocalesVentas(role).then(l => { if (vivo) setLocales(l) }).catch(() => { if (vivo) setLocales([]) })
    return () => { vivo = false }
  }, [role])
  const local = estado.local && (locales.length === 0 || locales.some(l => l.id === estado.local))
    ? estado.local : (locales[0]?.id ?? LOCAL_POR_DEFECTO)

  const clave = `${local}|${periodo.tipo}|${periodo.desde}|${periodo.hasta}|${baseA}|${baseB}`
  const [lectura, setLectura] = useState<{ clave: string; l: Lectura; turnos: FilaPromPaxRpc[] | null; tiempos: TiemposRpc | null } | null>(null)
  const [fallo, setFallo] = useState<{ clave: string; msg: string } | null>(null)
  useEffect(() => {
    if (periodo.tipo === 'hoy') return
    let vivo = true
    const rangos = rangosDeTiempos(periodo, baseA, baseB, quincenas)
    Promise.all([
      cargarLecturaDeRangos(local, rangos),
      // Horas, turno y tiempo sentado son un extra: si fallan, el resto de la pestaña se ve igual.
      cargarTiempos(local, periodo).then(t => ({ t, ok: true }), () => ({ t: null, ok: false })),
    ])
      .then(async ([l, { t, ok }]) => {
        // Sin la 193 (base vieja): el turno por la 080, como antes.
        const turnos = t === null && ok ? await cargarTurnos(local, periodo).catch(() => null) : null
        if (vivo) setLectura({ clave, l, turnos, tiempos: t })
      })
      .catch(e => { if (vivo) setFallo({ clave, msg: e instanceof Error ? e.message : 'No se pudo leer el PoS' }) })
    return () => { vivo = false }
  }, [clave, local, periodo, quincenas, baseA, baseB])

  const error = fallo && fallo.clave === clave ? fallo.msg : null
  const barra = <BarraVentasV2 estado={estado} periodo={periodo} locales={locales} aviso={aviso}
    onCambio={e => setSp(escribirBarra(sp, e))} />

  if (periodo.tipo === 'hoy') {
    return (
      <div className="vt-section">
        {barra}
        <div className="vt2-hoy">
          Hoy está en curso y no entra en «Tiempos». El ritmo por hora de hoy se mira en «En vivo».
          {' '}<button type="button" className="vt-period-btn active"
            onClick={() => { const n = new URLSearchParams(sp); n.set('tab', 'envivo'); setSp(n) }}>Ir a En vivo →</button>
        </div>
      </div>
    )
  }

  const listo = lectura && lectura.clave === clave ? lectura : null
  return (
    <div className="vt-section">
      {barra}
      {error && <div className="tips-error" role="alert"><span>No se pudo leer el PoS: {error}</span></div>}
      {!listo && !error && (
        <div className="vt2-cargando" role="status">
          Leyendo las ventas del PoS (el período, sus bases y las últimas 12 quincenas)…
        </div>
      )}
      {listo && <Contenido periodo={periodo} quincenas={quincenas} l={listo.l} turnos={listo.turnos} tiempos={listo.tiempos} bases={basesDe(comparar)} leidas={[baseA, baseB]} />}
    </div>
  )
}

interface ContenidoProps {
  periodo:   PeriodoV2
  quincenas: PeriodoV2[]
  l:         Lectura
  turnos:    FilaPromPaxRpc[] | null
  tiempos:   TiemposRpc | null
  /** Las bases que se muestran (una o las dos), en orden. */
  bases:     BaseId[]
  /** Las dos bases que se leyeron (`basesALeer`): las que se muestran salen de acá. */
  leidas:    [BaseId, BaseId]
}

function Contenido({ periodo, quincenas, l, turnos, tiempos, bases, leidas: [baseA, baseB] }: ContenidoProps) {
  const d = useMemo(() => {
    const estimador = estimadorPorNeta(l.facturas)
    const p = cifrasDelRango(l, periodo)
    const ra = periodo.bases[baseA], rb = periodo.bases[baseB]
    const semana = porDiaSemana(p.dias)
    const vppTurno = {
      'mañana': ventaPorPersona(l.facturas, periodo, { estimador, turno: 'mañana' }),
      noche: ventaPorPersona(l.facturas, periodo, { estimador, turno: 'noche' }),
    }
    const abiertos = semana.map(s => s.diasAbiertos)
    const vsBase = (r: typeof ra) => {
      if (!r) return compararDiaSemana(semana, p.ventaPorDiaAbierto, null, null)
      const c = cifrasDelRango(l, r)
      return compararDiaSemana(semana, p.ventaPorDiaAbierto, porDiaSemana(c.dias), c.ventaPorDiaAbierto)
    }
    return {
      p, semana,
      vs: { [baseA]: vsBase(ra), [baseB]: vsBase(rb) } as Record<BaseId, ReturnType<typeof compararDiaSemana>>,
      vppSemana: vppPorDiaSemana(l, periodo, estimador),
      mapa: tiempos ? mapaHorasTodos(tiempos.horas, periodo, abiertos) : mapaHoras(l.facturas, periodo, abiertos),
      turnos: tiempos ? porTurnoHoras(p.dias, tiempos.horas, vppTurno)
        : turnos ? porTurno(p.dias, turnos, vppTurno) : null,
      quincenas: filasQuincenas(l, quincenas, baseA, baseB),
      cal: calendario(p.dias, periodo),
    }
  }, [l, periodo, quincenas, turnos, tiempos, baseA, baseB])

  const qCerrada = { tipo: 'quincena' as const, enCurso: false, dias: 15 }
  const sumaSemana = d.semana.reduce((s, f) => s + f.neta, 0)
  const contraQue = bases.map(id => { const n = nombreBase(periodo, id); return `${conArticulo(n, 'de')} ${n.texto}` }).join(' y ')

  return (
    <>
      {/* 1. Día de semana */}
      <section className="vt2t-bloque" data-bloque="dia-semana">
        <div className="vt-sl">Día de semana (lunes a domingo)</div>
        <p className="vt2-nota" data-nota="que-compara">El % compara el promedio por día de cada día de semana con el del mismo día de semana {contraQue}.</p>
        <div style={{ overflowX: 'auto' }}>
          <table className="vt-tbl" aria-label="Día de semana">
            <thead><tr>
              <th>Día</th><th>Promedio por día</th>
              {bases.map(id => <th key={id}>vs {rotuloBase(periodo, id).toLowerCase()}</th>)}
              <th>Venta por persona</th>
            </tr></thead>
            <tbody>
              {d.semana.map((f, i) => {
                const detalle = `${f.diasAbiertos} ${f.diasAbiertos === 1 ? 'día abierto' : 'días abiertos'} · venta neta ${fi(f.neta)}`
                return (
                  <tr key={f.dow} data-dow={f.dow} title={detalle}>
                    <td>{f.nombre}<div className="vt2-delta-base vt2-sub" data-detalle="dia">{detalle}</div></td>
                    <td>{f.promedio === null ? '—' : fi(Math.round(f.promedio))}</td>
                    {bases.map(id => {
                      const x = d.vs[id].porDia[i]
                      return <td key={id} data-vs={id} className={`vt2-delta ${claseDeCambio(x)}`}
                        title={periodo.bases[id]?.rotulo ?? periodo.motivos[id] ?? ''}>{fmtPctSigno(x)}</td>
                    })}
                    <td className={d.vppSemana[i].personasCargadas + d.vppSemana[i].personasEstimadas < MUESTRA_CHICA_PERSONAS ? 'vt2-delta gris' : ''}>
                      {fmtVpp(d.vppSemana[i].valor)}
                    </td>
                  </tr>
                )
              })}
              <tr className="vt2-total" data-fila="total" title={`${d.p.diasAbiertos} días abiertos · venta neta ${fi(sumaSemana)}`}>
                <td>TOTAL<div className="vt2-delta-base vt2-sub" data-detalle="total">{d.p.diasAbiertos} días abiertos · venta neta <span data-neta="total">{fi(sumaSemana)}</span></div></td>
                <td>{d.p.ventaPorDiaAbierto === null ? '—' : fi(Math.round(d.p.ventaPorDiaAbierto))}</td>
                {bases.map(id => {
                  const x = d.vs[id].total
                  return <td key={id} data-vs={id} className={`vt2-delta ${claseDeCambio(x)}`}><b>{fmtPctSigno(x)}</b></td>
                })}
                <td>{fmtVpp(d.p.vpp.valor)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="vt2-nota">La venta es la de Contabilidad (día de la factura). La venta por persona es la de siempre (D4: el día lo pone la caja que estaba abierta); en gris, con menos de {MUESTRA_CHICA_PERSONAS} personas.</p>
      </section>

      {/* 2. Hora y turno */}
      <section className="vt2t-bloque" data-bloque="hora-turno">
        <div className="vt-sl">Turno (por la hora de la factura)</div>
        {d.turnos ? (
          <>
            <table className="vt-tbl" aria-label="Turno">
              <thead><tr><th>Turno</th><th>Venta neta</th><th>% de la venta</th><th>Venta por persona</th></tr></thead>
              <tbody>
                {d.turnos.filas.map(t => (
                  <tr key={t.turno} data-turno={t.turno}>
                    <td>{t.turno === 'mañana' ? 'Mediodía (hasta las 16:59)' : 'Noche (desde las 17:00)'}</td>
                    <td>{fi(t.neta)}</td><td>{t.pct.toFixed(1).replace('.', ',')} %</td><td>{fmtVpp(t.vpp.valor)}</td>
                  </tr>
                ))}
                <tr className="vt2-total" data-fila="total-turno">
                  <td>TOTAL</td><td>{fi(d.turnos.filas[0].neta + d.turnos.filas[1].neta)}</td><td>100 %</td><td />
                </tr>
              </tbody>
            </table>
            <p className="vt2-nota">Todos los canales. La venta va por la hora de la factura; la venta por persona, por el turno de la caja (D4). Lo de la madrugada va a la noche.</p>
            {d.turnos.descuadres.length > 0 && (
              <div className="vt2-aviso" role="status">
                El reparto por turno no cuadra con Contabilidad en {d.turnos.descuadres.length} {d.turnos.descuadres.length === 1 ? 'día' : 'días'} ({d.turnos.descuadres.slice(0, 5).join(', ')}{d.turnos.descuadres.length > 5 ? '…' : ''}). Avisá al owner.
              </div>
            )}
          </>
        ) : <div className="vt2-aviso" role="status">No se pudo leer el reparto por turno. El resto de la pestaña está bien.</div>}

        <div className="vt-sl" style={{ marginTop: '1rem' }}>{tiempos ? 'Mapa por hora · todos los canales' : 'Mapa por hora · solo salón'}</div>
        <p className="vt2-nota">{tiempos
          ? 'Venta neta promedio por día abierto, por día de semana y hora de la factura.'
          : 'Venta neta de salón promedio por día abierto, por día de semana y hora de la factura. Barra, delivery y llevar no traen la hora todavía.'}</p>
        {d.mapa.horas.length === 0 ? <p className="vt2-nota">Sin ventas de salón en el período.</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="vt2t-mapa" aria-label="Mapa por hora">
              <thead><tr><th />{d.mapa.horas.map(h => <th key={h}>{String(h).padStart(2, '0')}</th>)}</tr></thead>
              <tbody>
                {DIAS_SEMANA_LARGO.map((n, dow) => (
                  <tr key={n}>
                    <th>{n.slice(0, 3)}</th>
                    {d.mapa.horas.map(h => {
                      const v = d.mapa.celdas[dow][h]
                      const a = d.mapa.max > 0 ? v / d.mapa.max : 0
                      return (
                        <td key={h} data-celda={`${dow}-${h}`} title={`${n} ${h}:00 · ${fi(Math.round(v))}`}
                          style={{ background: `color-mix(in srgb, var(--c-oro) ${Math.round(a * 85)}%, transparent)` }}>
                          {v > 0 ? `${Math.round(v / 1000)}k` : ''}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Tiempo sentado */}
      <section className="vt2t-bloque" data-bloque="sentados">
        <div className="vt-sl">Tiempo sentado, por tamaño de mesa</div>
        {!tiempos ? <p className="vt2-nota">Todavía no disponible (falta la función de la base).</p> : (
          <>
            <table className="vt-tbl" aria-label="Tiempo sentado">
              <thead><tr><th>Mesa de</th><th>Mesas (N)</th><th>Mediana</th><th>Promedio</th></tr></thead>
              <tbody>
                {TAMANOS.map(t => {
                  const s = tiempos.sentados.find(x => x.tamano === t.id)
                  return (
                    <tr key={t.id} data-tamano={t.id}>
                      <td>{t.label}</td><td>{s?.n ?? 0}</td>
                      <td>{s && Number.isFinite(s.mediana) ? `${Math.round(s.mediana)} min` : '—'}</td>
                      <td>{s ? `${Math.round(s.promedio)} min` : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="vt2-nota">
              Salón, desde que se abre el pedido hasta que se cobra su última factura (una mesa partida en varias cuentas es una sola mesa, con la suma de sus personas).
              Quedan afuera: {tiempos.descartes.sin_pedido} cuentas sin pedido (divididas o de caja), {tiempos.descartes.sin_pax} mesas sin pax,
              {' '}{tiempos.descartes.menos_de_5} de menos de 5 min, {tiempos.descartes.mas_de_240} de más de 4 horas (pedido que quedó abierto) y {tiempos.descartes.internas} de mesas internas (Ajustes: ahí no se sientan clientes).
            </p>
          </>
        )}
      </section>

      {/* 3. Quincenas */}
      <section className="vt2t-bloque" data-bloque="quincenas">
        <div className="vt-sl">Quincenas (las últimas {d.quincenas.length})</div>
        <p className="vt2-nota">1.ª = del 1 al 15; 2.ª = del 16 a fin de mes (13 a 16 días): por eso mirá también la venta por día abierto. La que está en curso va a la fecha (hasta ayer).</p>
        <div style={{ overflowX: 'auto' }}>
          <table className="vt-tbl" aria-label="Quincenas">
            <thead><tr>
              <th>Quincena</th><th>Venta neta</th><th>Días abiertos</th><th>Venta por día abierto</th><th>Personas</th>
              <th>Venta por persona</th>
              {bases.map(id => <th key={id}>vs {rotuloBase(qCerrada, id).toLowerCase()}</th>)}
            </tr></thead>
            <tbody>
              {d.quincenas.map(f => (
                <tr key={f.q.desde} data-quincena={f.q.desde}>
                  <td title={f.q.rotulo}>{nombreQuincena(f.q)}{f.q.enCurso ? ` · a la fecha (al ${Number(f.q.hasta.slice(8))})` : ''}</td>
                  <td>{fi(f.cifras.totales.ventaNeta)}</td><td>{f.cifras.diasAbiertos}</td>
                  <td>{f.cifras.ventaPorDiaAbierto === null ? '—' : fi(Math.round(f.cifras.ventaPorDiaAbierto))}</td>
                  <td>{f.cifras.totales.pax}</td><td>{fmtVpp(f.cifras.vpp.valor)}</td>
                  {bases.map(id => {
                    const [cambio, cambioDia] = id === baseA ? [f.cambioA, f.cambioDiaA] : [f.cambioB, f.cambioDiaB]
                    return (
                      <td key={id} data-vs={id} className={`vt2-delta ${claseCambio(cambio)}`} title={f.q.bases[id]?.rotulo ?? f.q.motivos[id] ?? ''}>
                        {fmtPct(cambio)}{cambioDia !== null && <span className="vt2-delta-base"> · por día {fmtPct(cambioDia).replace(/[▲▼] /, '')}</span>}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 5. Calendario */}
      <section className="vt2t-bloque" data-bloque="calendario">
        <div className="vt-sl">Calendario</div>
        {d.cal.mejor && d.cal.peor && (
          <p className="vt2-nota">
            Mejor día: <b>{d.cal.mejor.fecha}</b> ({fi(d.cal.mejor.ventaNeta)}) · Peor día abierto: <b>{d.cal.peor.fecha}</b> ({fi(d.cal.peor.ventaNeta)}).
          </p>
        )}
        <div className="vt2t-meses">
          {d.cal.meses.map(m => (
            <div key={m.mes}>
              <div className="vt2-nota">{m.mes}</div>
              <div className="vt2t-cal" role="grid" aria-label={`Calendario ${m.mes}`}>
                {DIAS_SEMANA_LARGO.map(n => <div key={n} className="cab">{n.slice(0, 2)}</div>)}
                {m.semanas.flat().map((c, i) => {
                  if (!c) return <div key={i} />
                  const venta = 'vacio' in c ? 0 : c.ventaNeta
                  const marca = d.cal.mejor?.fecha === c.fecha ? ' mejor' : d.cal.peor?.fecha === c.fecha ? ' peor' : ''
                  const a = d.cal.max > 0 ? venta / d.cal.max : 0
                  return (
                    <div key={c.fecha} className={`dia${marca}`} data-fecha={c.fecha} title={`${c.fecha}: ${fi(venta)}`}
                      style={{ background: `color-mix(in srgb, var(--c-oro) ${Math.round(a * 60)}%, transparent)` }}>
                      <div className="num">{Number(c.fecha.slice(8))}</div>
                      <div>{venta > 0 ? fi(venta) : '—'}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
        <p className="vt2-nota">Cada día es la venta neta de Contabilidad. Las fechas especiales (Semana Santa, feriados) se marcan en una fase siguiente.</p>
      </section>
    </>
  )
}
