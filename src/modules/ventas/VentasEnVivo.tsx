import { useState, useEffect, useCallback } from 'react'
import { fi, getDayStats, topProds } from './ventasUtils'
import VentasEnVivoRitmo from './VentasEnVivoRitmo'
import { getSnapshotEnVivo, horaCorteCR, REFRESH_MS } from './ventasEnVivoDatos'
import {
  LOCALES, mixPorCategoria, prodsDelDia, ticketsDelDia, ticketPromedioDe,
  variacionPct, paxEsConfiable, UMBRAL_PAX_CONFIABLE,
} from './ventasEnVivoTypes'
import type { LocalId, SnapshotEnVivo } from './ventasEnVivoTypes'
import './ventasEnVivo.css'

// ╔══════════════════════════════════════════════════════════════════════════════════════╗
// ║ Ventas · pestaña EN VIVO (preliminar — datos simulados)                                ║
// ╚══════════════════════════════════════════════════════════════════════════════════════╝
//
// ── ADITIVA, Y NADA MÁS ────────────────────────────────────────────────────────────────────
// Esta pestaña no toca ninguna otra. No escribe, no modifica `dias`, no llama a `xlsParser` ni
// a los cierres. Lee su snapshot del mock y pinta. El resto de Ventas se comporta exactamente
// como antes de que este archivo existiera.
//
// ── LOS NÚMEROS DEL DÍA SALEN DE `getDayStats` ─────────────────────────────────────────────
// Venta neta, bruta, IVA, servicio, salón, delivery, pax y promPax NO se calculan acá: se
// piden a la MISMA función que usan «Hoy» y Contabilidad, sobre el mismo `DiaData`. Si esta
// pestaña sumara por su cuenta, tarde o temprano diría un total distinto para la misma fecha
// y nadie sabría cuál vale.
//
// Solo tres cifras son propias, porque el modelo del xls no las tiene: el conteo de tickets
// (el xls solo cuenta `ordenes` de caja), el ticket promedio del día, y la proyección — que
// además es una ESTIMACIÓN nuestra y la pantalla lo dice con esas palabras.
//
// ── LO QUE ES DATO Y LO QUE ES EJEMPLO ─────────────────────────────────────────────────────
// La calidad del pax depende del campo nativo de comensales del PoS, que todavía no tenemos.
// Se renderiza para fijar la forma, pero marcada — visual Y textualmente. Un número sin fuente
// que se lee como si la tuviera es peor que no mostrarlo.

/** «hace 12 s» — el sello de frescura. Sin esto, un dashboard congelado se ve igual que uno vivo. */
function haceCuanto(iso: string, ahora: number): string {
  const seg = Math.max(0, Math.round((ahora - new Date(iso).getTime()) / 1000))
  if (seg < 5)  return 'recién'
  if (seg < 60) return `hace ${seg} s`
  return `hace ${Math.round(seg / 60)} min`
}

/** ▲/▼ + porcentaje. La flecha es la codificación secundaria: el color nunca va solo. */
function Delta({ actual, referencia }: { actual: number; referencia: number }) {
  const pct = variacionPct(actual, referencia)
  if (pct == null) return <span className="apos-delta is-nulo">sin referencia</span>
  return (
    <span className={`apos-delta ${pct >= 0 ? 'is-arriba' : 'is-abajo'}`}>
      {pct >= 0 ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%
    </span>
  )
}

export default function VentasEnVivo() {
  const [local, setLocal]     = useState<LocalId>('santa-teresa')
  const [snap, setSnap]       = useState<SnapshotEnVivo | null>(null)
  const [error, setError]     = useState<string | null>(null)
  const [ahora, setAhora]     = useState(() => Date.now())
  const [prodPor, setProdPor] = useState<'monto' | 'unidades'>('monto')

  const cargar = useCallback(async (l: LocalId) => {
    try {
      setSnap(await getSnapshotEnVivo(l))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron leer las ventas')
    }
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { cargar(local) }, [cargar, local])

  // «Siempre actualizado»: se vuelve a pedir cada 30 s. El `setAhora` del mismo tick es lo que
  // hace avanzar el «hace X s» aunque el snapshot no cambie.
  useEffect(() => {
    const id = setInterval(() => { setAhora(Date.now()); cargar(local) }, REFRESH_MS)
    return () => clearInterval(id)
  }, [cargar, local])

  // El sello corre más fino que el refresco, o el texto quedaría clavado en «hace 30 s».
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 5_000)
    return () => clearInterval(id)
  }, [])

  if (error) {
    return (
      <div className="vt-section">
        <div className="apos">
          <div className="apos-panel apos-stop">
            <strong>No se pudieron leer las ventas</strong>
            <p>{error}</p>
          </div>
        </div>
      </div>
    )
  }

  if (!snap) {
    return (
      <div className="vt-section">
        <div className="apos"><div className="apos-cargando"><span className="loading-mark">売</span></div></div>
      </div>
    )
  }

  const { dia, pm, porHora, historico, calidadPax, proyeccionCierre } = snap

  // ── El día, con la MISMA función que el resto del módulo ──
  const stats = getDayStats(dia)

  // ── Las tres cifras que el modelo del xls no tiene ──
  const tickets   = ticketsDelDia(porHora)
  const ticketProm = ticketPromedioDe(stats.ventaNeta, tickets)
  const hora      = horaCorteCR()

  // ── Mix y top, con el mismo par (DiaData + ProductMap) que usa Mix Ventas ──
  const mix   = mixPorCategoria(dia, pm)
  const prods = topProds(prodsDelDia(dia), prodPor, 8)

  const maxCat  = Math.max(...mix.map(c => c.monto), 1)
  const maxProd = Math.max(...prods.map(p => (prodPor === 'monto' ? p.m : p.q)), 1)

  return (
    <div className="vt-section">
      <div className="apos">

        {/* ── Aviso: esto todavía no es un dato ─────────────────────────────── */}
        <div className="apos-panel is-preliminar">
          <div className="apos-panel-hd">
            <h3>En vivo</h3>
            <span className="apos-tag-pendiente">Preliminar — datos simulados</span>
          </div>
          <p className="apos-nota" style={{ marginBottom: 0 }}>
            Todavía no hay lectura del PoS. Lo que se ve sale de un generador local con la
            <strong> misma forma</strong> que el import de xls (<code>DiaData</code>), para poder
            discutir la pantalla antes de cablear. El total del día, el pax y el mix se calculan
            con las mismas funciones que <strong>Hoy</strong> y <strong>Mix Ventas</strong>: cuando
            llegue el feed real, cambia de dónde salen los datos, no cómo se leen.
          </p>
        </div>

        {/* ── Barra: local + frescura ───────────────────────────────────────── */}
        <div className="apos-bar">
          <div className="apos-locales" role="group" aria-label="Local">
            {LOCALES.map(l => (
              <button
                key={l.id}
                type="button"
                className={`apos-chip ${local === l.id ? 'is-on' : ''}`}
                aria-pressed={local === l.id}
                onClick={() => setLocal(l.id)}
              >
                {l.label}
              </button>
            ))}
          </div>
          <span className="apos-spacer" />
          {snap.servicioEnCurso ? (
            <span className="apos-fresco">
              <span className="apos-pulso" aria-hidden="true" />
              en servicio · actualizado {haceCuanto(snap.generadoEn, ahora)}
            </span>
          ) : (
            <span className="apos-fresco is-cerrado">
              ● servicio cerrado · mostrando el cierre del {snap.fecha}
            </span>
          )}
        </div>

        {/* ── KPIs ──────────────────────────────────────────────────────────── */}
        <div className="apos-kpis">
          <div className="apos-kpi is-principal">
            <span className="apos-kpi-lbl">Venta neta</span>
            <span className="apos-kpi-val">{fi(stats.ventaNeta)}</span>
            <span className="apos-kpi-sub">
              {snap.servicioEnCurso ? `al cierre de las ${String(hora).padStart(2, '0')}:00` : 'servicio completo'}
            </span>
          </div>
          <div className="apos-kpi">
            <span className="apos-kpi-lbl">Venta bruta</span>
            {/* Con el feed real la bruta es el dato del PoS (Σ medios de pago − vuelto); con el
                mock se sigue derivando como antes. El IVA se muestra PENDIENTE cuando el PoS lo
                informa en cero: NO se deriva de neta × 0,13 (SPEC-valor-servido-regalias). */}
            <span className="apos-kpi-val">{fi(snap.bruto ?? stats.ventaBruta)}</span>
            <span className="apos-kpi-sub">
              neta + IVA {snap.ivaPendiente ? <em>pendiente</em> : fi(snap.iva ?? stats.iva)}
              {' '}+ serv. {fi(snap.servicio ?? stats.serv)}
            </span>
          </div>
          <div className="apos-kpi">
            <span className="apos-kpi-lbl">Tickets</span>
            <span className="apos-kpi-val">{tickets.toLocaleString('es-CR')}</span>
            <span className="apos-kpi-sub">cuentas cerradas · solo en vivo</span>
          </div>
          <div className="apos-kpi">
            <span className="apos-kpi-lbl">Ticket promedio</span>
            <span className="apos-kpi-val">{ticketProm > 0 ? fi(ticketProm) : '—'}</span>
            <span className="apos-kpi-sub">venta NETA / tickets</span>
          </div>
          <div className="apos-kpi">
            <span className="apos-kpi-lbl">Promedio por pax</span>
            <span className="apos-kpi-val">{stats.promPax > 0 ? fi(Math.round(stats.promPax)) : '—'}</span>
            <span className="apos-kpi-sub">
              NETO / pax · {stats.pax.toLocaleString('es-CR')} pax vía artículo pax (§3.F)
            </span>
          </div>
          <div className="apos-kpi is-proyeccion">
            <span className="apos-kpi-lbl">Proyección de cierre</span>
            {/* Con el servicio cerrado no hay nada que proyectar: la proyección ES la venta
                acumulada. Mostrar el mismo número dos veces hace dudar de los dos. */}
            <span className="apos-kpi-val">
              {snap.servicioEnCurso && proyeccionCierre > 0 ? fi(proyeccionCierre) : '—'}
            </span>
            <span className="apos-kpi-sub">
              {snap.servicioEnCurso ? 'estimado, no es venta real' : 'el servicio ya cerró'}
            </span>
          </div>
        </div>

        {/* ── Ritmo por hora ────────────────────────────────────────────────── */}
        <section className="apos-panel">
          <div className="apos-panel-hd">
            <h3>Ritmo por hora</h3>
            <span className="apos-panel-sub">venta cerrada en cada hora · hora de Costa Rica</span>
          </div>
          <VentasEnVivoRitmo datos={porHora} horaActual={hora} />
        </section>

        {/* ── Contra el histórico ───────────────────────────────────────────── */}
        <section className="apos-panel">
          <div className="apos-panel-hd">
            <h3>Cómo viene contra el histórico</h3>
            <span className="apos-panel-sub">comparado a la misma hora, no contra el día cerrado</span>
          </div>
          <div className="apos-comp">
            <div className="apos-comp-fila">
              <span className="apos-comp-lbl">Mismo día, semana pasada</span>
              <span className="apos-comp-val">{fi(historico.mismoDiaSemanaPasada)}</span>
              <Delta actual={stats.ventaNeta} referencia={historico.mismoDiaSemanaPasada} />
            </div>
            <div className="apos-comp-fila">
              <span className="apos-comp-lbl">Promedio de 4 semanas</span>
              <span className="apos-comp-val">{fi(historico.promedio4Semanas)}</span>
              <Delta actual={stats.ventaNeta} referencia={historico.promedio4Semanas} />
            </div>
          </div>
        </section>

        {/* ── Mix por categoría ─────────────────────────────────────────────── */}
        <section className="apos-panel">
          <div className="apos-panel-hd">
            <h3>Ventas por categoría</h3>
            <span className="apos-panel-sub">
              en NETO, por familia del PoS · suma el neto del día · sin el artículo PAX
            </span>
          </div>
          <ul className="apos-barras">
            {mix.map(c => (
              <li key={c.categoria}>
                <span className="apos-barra-lbl">{c.categoria}</span>
                <span className="apos-barra-pista">
                  <span className="apos-barra-fill" style={{ width: `${(c.monto / maxCat) * 100}%` }} />
                </span>
                <span className="apos-barra-val">{fi(c.monto)}</span>
                <span className="apos-barra-pct">{c.pctMix.toFixed(1)}%</span>
                <span className="apos-barra-uds">{c.unidades.toLocaleString('es-CR')} u.</span>
              </li>
            ))}
          </ul>
        </section>

        {/* ── Top productos ─────────────────────────────────────────────────── */}
        <section className="apos-panel">
          <div className="apos-panel-hd">
            <h3>Lo que más se vendió</h3>
            <span className="apos-spacer" />
            <div className="apos-toggle" role="group" aria-label="Ordenar por">
              <button
                type="button"
                className={prodPor === 'monto' ? 'is-on' : ''}
                aria-pressed={prodPor === 'monto'}
                onClick={() => setProdPor('monto')}
              >
                Por monto
              </button>
              <button
                type="button"
                className={prodPor === 'unidades' ? 'is-on' : ''}
                aria-pressed={prodPor === 'unidades'}
                onClick={() => setProdPor('unidades')}
              >
                Por unidades
              </button>
            </div>
          </div>
          <ul className="apos-barras">
            {prods.map(p => {
              const v = prodPor === 'monto' ? p.m : p.q
              return (
                <li key={p.nombre}>
                  <span className="apos-barra-lbl">
                    {p.nombre}
                    <em className="apos-barra-cat">{pm[p.nombre]?.clasificacion ?? 'SIN CLASIFICAR'}</em>
                  </span>
                  <span className="apos-barra-pista">
                    <span className="apos-barra-fill" style={{ width: `${(v / maxProd) * 100}%` }} />
                  </span>
                  <span className="apos-barra-val">{fi(p.m)}</span>
                  <span className="apos-barra-uds">{p.q.toLocaleString('es-CR')} u.</span>
                </li>
              )
            })}
          </ul>
        </section>

        {/* ── Fase B ────────────────────────────────────────────────────────── */}
        <section className="apos-panel is-pendiente">
          <div className="apos-panel-hd">
            <h3>Calidad del pax</h3>
            <span className="apos-tag-pendiente">Datos de ejemplo — pendiente de cablear</span>
          </div>
          <p className="apos-nota">
            No mide ventas: mide si se puede confiar en el <strong>promedio por pax</strong>. Hoy
            el pax sale del artículo <code>PAX</code> del xls, y si el salonero no lo carga, el
            parser <strong>descarta al salonero del día entero</strong> — un pax mal cargado no
            se ve como un error, se ve como alguien que no trabajó. Con el PoS en línea se puede
            medir antes. Por debajo de {UMBRAL_PAX_CONFIABLE}% de mesas con pax cargado, ese
            promedio no se puede usar para decidir.
          </p>
          <div className="apos-tabla-wrap">
            <table className="apos-tabla">
              <thead>
                <tr>
                  <th>Salonero</th>
                  <th className="r">Mesas</th>
                  <th className="r">Pax nativo cargado</th>
                  <th className="r">Match artículo vs nativo</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {calidadPax.map(c => {
                  const ok = paxEsConfiable(c)
                  return (
                    <tr key={c.salonero}>
                      <td>{c.salonero}</td>
                      <td className="r">{c.mesas}</td>
                      <td className="r">{c.pctPaxNativoCargado}%</td>
                      <td className="r">{c.matchArticuloVsNativo}%</td>
                      <td>
                        <span className={`apos-estado ${ok ? 'is-ok' : 'is-flojo'}`}>
                          {ok ? '✓ confiable' : '⚠ con huecos'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        <p className="apos-pie">
          El día se arma como <code>DiaData</code>, el mismo tipo que produce el import de xls y
          que guarda <code>ventas_dias</code>. Cablear el PoS es reemplazar{' '}
          <code>ventasEnVivoMock.ts</code>: la forma de los datos y esta pantalla no cambian.
        </p>
      </div>
    </div>
  )
}
