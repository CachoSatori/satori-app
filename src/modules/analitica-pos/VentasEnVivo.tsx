import { useState, useEffect, useCallback } from 'react'
import { fi } from '../../shared/utils'
import RitmoPorHora from './RitmoPorHora'
import { getSnapshotVentasEnVivo, horaCorteCR, REFRESH_MS } from './mock'
import { LOCALES, variacionPct, paxEsConfiable, UMBRAL_PAX_CONFIABLE } from './types'
import type { LocalId, SnapshotVentasEnVivo } from './types'

// ── Analítica PoS · «Ventas en vivo» (Fase A) ───────────────────────────────────
//
// La pantalla NO sabe de dónde salen los datos: pide `getSnapshotVentasEnVivo(local)` y pinta.
// Hoy eso devuelve mock; mañana devuelve el PoS. Ese es todo el punto del recorte.
//
// LO QUE ES DATO Y LO QUE ES EJEMPLO. Las secciones que dependen del pax nativo y del salonero
// no se pueden cablear todavía (ver `types.ts`). Están renderizadas para que la forma exista y
// se pueda discutir, pero marcadas: un número sin fuente que se lee como si la tuviera es peor
// que no mostrarlo. La marca es visual Y textual, no solo un color.

/** «hace 12 s» — el sello de frescura. Sin esto, un dashboard congelado se ve igual que uno vivo. */
function haceCuanto(iso: string, ahora: number): string {
  const seg = Math.max(0, Math.round((ahora - new Date(iso).getTime()) / 1000))
  if (seg < 5)  return 'recién'
  if (seg < 60) return `hace ${seg} s`
  const min = Math.round(seg / 60)
  return `hace ${min} min`
}

/** ▲/▼ + porcentaje. La flecha es la codificación secundaria: el color nunca va solo. */
function Delta({ actual, referencia }: { actual: number; referencia: number }) {
  const pct = variacionPct(actual, referencia)
  if (pct == null) return <span className="apos-delta is-nulo">sin referencia</span>
  const signo = pct >= 0 ? 'is-arriba' : 'is-abajo'
  return (
    <span className={`apos-delta ${signo}`}>
      {pct >= 0 ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%
    </span>
  )
}

interface Props {
  local: LocalId
  onLocalChange: (l: LocalId) => void
}

export default function VentasEnVivo({ local, onLocalChange }: Props) {
  const [snap, setSnap]       = useState<SnapshotVentasEnVivo | null>(null)
  const [error, setError]     = useState<string | null>(null)
  const [ahora, setAhora]     = useState(() => Date.now())
  const [prodPor, setProdPor] = useState<'monto' | 'unidades'>('monto')

  const cargar = useCallback(async (l: LocalId) => {
    try {
      setSnap(await getSnapshotVentasEnVivo(l))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron leer las ventas')
    }
  }, [])

  // Carga al montar y cada vez que cambia el local.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { cargar(local) }, [cargar, local])

  // «Siempre actualizado»: se vuelve a pedir cada 30 s. El `setAhora` del mismo tick es lo que
  // hace avanzar el «hace X s» aunque el snapshot no cambie.
  //
  // `local` va en las dependencias: cambiar de local rearma el temporizador. Es lo que se
  // quiere — el efecto de arriba ya trajo el snapshot del local nuevo, así que volver a
  // contar 30 s desde ahí es exactamente el intervalo correcto.
  useEffect(() => {
    const id = setInterval(() => {
      setAhora(Date.now())
      cargar(local)
    }, REFRESH_MS)
    return () => clearInterval(id)
  }, [cargar, local])

  // El reloj del sello corre más fino que el refresco, o el texto quedaría clavado en «hace 30 s».
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 5_000)
    return () => clearInterval(id)
  }, [])

  if (error) {
    return (
      <div className="apos-panel apos-stop">
        <strong>No se pudieron leer las ventas</strong>
        <p>{error}</p>
      </div>
    )
  }

  if (!snap) {
    return <div className="apos-cargando"><span className="loading-mark">売</span></div>
  }

  const { dia, porHora, porCategoria, topProductos, historico, saloneros, calidadPax } = snap
  // Fuera de horario esto es la hora de cierre, no la del reloj: lo que se muestra es el
  // último servicio terminado (ver `fechaServicioCR` en mock.ts).
  const hora = horaCorteCR()
  const maxCat = Math.max(...porCategoria.map(c => c.monto), 1)
  const prods = [...topProductos].sort((a, b) =>
    prodPor === 'monto' ? b.monto - a.monto : b.unidades - a.unidades)
  const maxProd = Math.max(...prods.map(p => (prodPor === 'monto' ? p.monto : p.unidades)), 1)

  return (
    <div className="apos-screen">

      {/* ── Barra de control: local + frescura ─────────────────────────────── */}
      <div className="apos-bar">
        <div className="apos-locales" role="group" aria-label="Local">
          {LOCALES.map(l => (
            <button
              key={l.id}
              type="button"
              className={`apos-chip ${local === l.id ? 'is-on' : ''}`}
              aria-pressed={local === l.id}
              onClick={() => onLocalChange(l.id)}
            >
              {l.label}
            </button>
          ))}
        </div>
        <span className="apos-spacer" />
        {/* Un dashboard «en vivo» abierto a las 3 de la mañana no puede mostrar la noche
            anterior como si fuera de hoy: se dice cuál de las dos cosas se está viendo. */}
        {snap.servicioEnCurso ? (
          <span className="apos-fresco">
            <span className="apos-pulso" aria-hidden="true" />
            en servicio · actualizado {haceCuanto(snap.generadoEn, ahora)}
          </span>
        ) : (
          <span className="apos-fresco is-cerrado">
            ● servicio cerrado · mostrando el cierre del {dia.fecha}
          </span>
        )}
      </div>

      {/* ── KPIs del día ───────────────────────────────────────────────────── */}
      <div className="apos-kpis">
        <div className="apos-kpi is-principal">
          <span className="apos-kpi-lbl">Venta acumulada</span>
          <span className="apos-kpi-val">{fi(dia.ventaAcumulada)}</span>
          <span className="apos-kpi-sub">
            {snap.servicioEnCurso
              ? `al cierre de las ${String(hora).padStart(2, '0')}:00`
              : 'servicio completo'}
          </span>
        </div>
        <div className="apos-kpi">
          <span className="apos-kpi-lbl">Tickets</span>
          <span className="apos-kpi-val">{dia.tickets.toLocaleString('es-CR')}</span>
          <span className="apos-kpi-sub">cuentas cerradas</span>
        </div>
        <div className="apos-kpi">
          <span className="apos-kpi-lbl">Ticket promedio</span>
          <span className="apos-kpi-val">{dia.ticketPromedio > 0 ? fi(dia.ticketPromedio) : '—'}</span>
          <span className="apos-kpi-sub">venta / tickets</span>
        </div>
        <div className="apos-kpi">
          <span className="apos-kpi-lbl">Venta por pax</span>
          <span className="apos-kpi-val">{dia.ventaPorPax > 0 ? fi(dia.ventaPorPax) : '—'}</span>
          <span className="apos-kpi-sub">
            {dia.pax.toLocaleString('es-CR')} pax · depende de lo cargado
          </span>
        </div>
        <div className="apos-kpi is-proyeccion">
          <span className="apos-kpi-lbl">Proyección de cierre</span>
          {/* Con el servicio cerrado no hay nada que proyectar: la proyección ES la venta
              acumulada. Mostrar el mismo número dos veces, uno al lado del otro, hace dudar
              de los dos — así que se dice que ya no aplica. */}
          <span className="apos-kpi-val">
            {snap.servicioEnCurso && dia.proyeccionCierre > 0 ? fi(dia.proyeccionCierre) : '—'}
          </span>
          <span className="apos-kpi-sub">
            {snap.servicioEnCurso ? 'estimado, no es venta real' : 'el servicio ya cerró'}
          </span>
        </div>
      </div>

      {/* ── Ritmo por hora ─────────────────────────────────────────────────── */}
      <section className="apos-panel">
        <div className="apos-panel-hd">
          <h3>Ritmo por hora</h3>
          <span className="apos-panel-sub">venta cerrada en cada hora · hora de Costa Rica</span>
        </div>
        <RitmoPorHora datos={porHora} horaActual={hora} />
      </section>

      {/* ── Comparativa contra el histórico ────────────────────────────────── */}
      <section className="apos-panel">
        <div className="apos-panel-hd">
          <h3>Cómo viene contra el histórico</h3>
          <span className="apos-panel-sub">
            comparado a la misma hora, no contra el día cerrado
          </span>
        </div>
        <div className="apos-comp">
          <div className="apos-comp-fila">
            <span className="apos-comp-lbl">Mismo día, semana pasada</span>
            <span className="apos-comp-val">{fi(historico.mismoDiaSemanaPasada)}</span>
            <Delta actual={dia.ventaAcumulada} referencia={historico.mismoDiaSemanaPasada} />
          </div>
          <div className="apos-comp-fila">
            <span className="apos-comp-lbl">Promedio de 4 semanas</span>
            <span className="apos-comp-val">{fi(historico.promedio4Semanas)}</span>
            <Delta actual={dia.ventaAcumulada} referencia={historico.promedio4Semanas} />
          </div>
        </div>
      </section>

      {/* ── Mix por categoría ──────────────────────────────────────────────── */}
      <section className="apos-panel">
        <div className="apos-panel-hd">
          <h3>Ventas por categoría</h3>
          <span className="apos-panel-sub">participación sobre la venta del día</span>
        </div>
        <ul className="apos-barras">
          {porCategoria.map(c => (
            <li key={c.categoria}>
              <span className="apos-barra-lbl">{c.categoria}</span>
              <span className="apos-barra-pista">
                <span
                  className="apos-barra-fill"
                  style={{ width: `${(c.monto / maxCat) * 100}%` }}
                />
              </span>
              <span className="apos-barra-val">{fi(c.monto)}</span>
              <span className="apos-barra-pct">{c.pctMix.toFixed(1)}%</span>
              <span className="apos-barra-uds">{c.unidades.toLocaleString('es-CR')} u.</span>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Top productos ──────────────────────────────────────────────────── */}
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
            const v = prodPor === 'monto' ? p.monto : p.unidades
            return (
              <li key={p.nombre}>
                <span className="apos-barra-lbl">
                  {p.nombre}
                  <em className="apos-barra-cat">{p.categoria}</em>
                </span>
                <span className="apos-barra-pista">
                  <span className="apos-barra-fill" style={{ width: `${(v / maxProd) * 100}%` }} />
                </span>
                <span className="apos-barra-val">{fi(p.monto)}</span>
                <span className="apos-barra-uds">{p.unidades.toLocaleString('es-CR')} u.</span>
              </li>
            )
          })}
        </ul>
      </section>

      {/* ══ FASE B · lo que todavía no tiene fuente ═══════════════════════════
          Se muestran para fijar la forma, NO para leerlos. Ver `types.ts`. */}

      <section className="apos-panel is-pendiente">
        <div className="apos-panel-hd">
          <h3>Por salonero</h3>
          <span className="apos-tag-pendiente">Datos de ejemplo — pendiente de cablear</span>
        </div>
        <p className="apos-nota">
          Falta que el PoS identifique al mesero por cuenta <em>y</em> poder casar ese
          identificador con <code>employees</code>. El puente va por código, nunca por nombre:
          casar por nombre ya produjo drift real con BioTime.
        </p>
        <ul className="apos-barras">
          {saloneros.map(s => (
            <li key={s.salonero}>
              <span className="apos-barra-lbl">{s.salonero}</span>
              <span className="apos-barra-pista">
                <span
                  className="apos-barra-fill is-ejemplo"
                  style={{ width: `${(s.ventas / Math.max(...saloneros.map(x => x.ventas), 1)) * 100}%` }}
                />
              </span>
              <span className="apos-barra-val">{fi(s.ventas)}</span>
              <span className="apos-barra-uds">{s.pax} pax · {fi(s.ventaPorPax)}/pax</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="apos-panel is-pendiente">
        <div className="apos-panel-hd">
          <h3>Calidad del pax</h3>
          <span className="apos-tag-pendiente">Datos de ejemplo — pendiente de cablear</span>
        </div>
        <p className="apos-nota">
          No mide ventas: mide si se puede confiar en <strong>venta por pax</strong>. Si el
          comensal no se carga en el campo nativo del PoS, el denominador tiene huecos y la
          métrica miente sin que nada falle. Por debajo de {UMBRAL_PAX_CONFIABLE}% de mesas con
          pax cargado, ese número no se puede usar para decidir.
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
        Fase A · la pantalla corre con un proveedor de datos simulado
        (<code>mock.ts</code>). Cablear el PoS es reemplazar ese archivo: la forma de los datos
        y esta pantalla no cambian.
      </p>
    </div>
  )
}
