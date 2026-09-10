import { useState, useEffect, useCallback } from 'react'
import {
  aggCajero, aggGeneral, aggSalonero, dayOfWeek, fi, getDayStats, getMeta,
  metaColor, ratioCBClass, topProds,
} from './ventasUtils'
import VentasEnVivoRitmo from './VentasEnVivoRitmo'
import {
  esSinAsignar, getSnapshotEnVivo, horaCorteCR, jornadaActualCR, jornadaDesplazada, REFRESH_MS,
} from './ventasEnVivoDatos'
import {
  LOCALES, mixPorCategoria, prodsDelDia, ticketsDelDia, ticketPromedioDe,
  variacionPct, paxEsConfiable, UMBRAL_PAX_CONFIABLE,
} from './ventasEnVivoTypes'
import type { LocalId, SnapshotEnVivo } from './ventasEnVivoTypes'
import type { CajeroDay, DiasMap, Meta } from '../../shared/types/ventas'
import './ventasEnVivo.css'

// ╔══════════════════════════════════════════════════════════════════════════════════════╗
// ║ Ventas · pestaña EN VIVO — el SUPERSET de «Hoy», leído de `pos_ndf`                     ║
// ╚══════════════════════════════════════════════════════════════════════════════════════╝
//
// ── ADITIVA, Y NADA MÁS ────────────────────────────────────────────────────────────────────
// Esta pestaña no toca ninguna otra. No escribe, no modifica `dias`, no llama a `xlsParser` ni
// a los cierres. **«Hoy» queda intacta y funcionando**: sigue leyendo el xls y sirve de cotejo.
// Si alguna vez las dos dicen números distintos para la misma fecha, eso es información — por
// eso se conservan las dos.
//
// ── NINGUNA MÉTRICA SE REIMPLEMENTA ────────────────────────────────────────────────────────
// El día del PoS se arma como `DiaData` —el mismo tipo que produce el import de xls— y se le
// pasa a las MISMAS funciones que usa «Hoy»:
//   getDayStats  → venta neta/bruta, IVA, servicio, salón, delivery, pax
//   aggGeneral   → Prom/PAX, Prom/Plato, Prom/Bebida, Beb/PAX, ratio C/B, comidas, bebidas
//   aggSalonero  → la fila de cada mesero en el ranking
//   aggCajero    → la línea de caja
//   topProds     → los productos, general y por salonero
// Si esta pantalla sumara por su cuenta, tarde o temprano diría un total distinto para la misma
// fecha y nadie sabría cuál vale.
//
// ── LO PROPIO DE «EN VIVO» ─────────────────────────────────────────────────────────────────
// Lo que el modelo del xls no tiene: conteo de tickets, ticket promedio, proyección, ritmo por
// hora, mesas abiertas, comparativa contra el mismo día de semana, mix por familia del PoS, y
// el corte por TURNO (07→16 mañana · 16→07 tarde), que es dato del PoS y no del xls.

/** «hace 12 s» — el sello de frescura. Sin esto, un dashboard congelado se ve igual que uno vivo. */
function haceCuanto(iso: string, ahora: number): string {
  const seg = Math.max(0, Math.round((ahora - new Date(iso).getTime()) / 1000))
  if (seg < 5)  return 'recién'
  if (seg < 60) return `hace ${seg} s`
  return `hace ${Math.round(seg / 60)} min`
}

/**
 * El texto del «—» de plata. Es la explicación que el encargado ve al pasar el mouse, y la
 * razón por la que acá NUNCA va un ₡0: cero significaría «no consumió», y lo cierto es que
 * el PoS no lo manda.
 */
const MONTO_PENDIENTE =
  'El agente no pudo estimar esta mesa: el pedido no trae líneas con catálogo, o esta ' +
  'instalación no expone el detalle del pedido. Mostrar ₡0 diría que no consumió nada, que es falso.'

/** El rótulo del estimado. Es un cálculo por catálogo mientras la mesa sigue abierta. */
const MONTO_ESTIMADO =
  'ESTIMADO por catálogo: cantidad × precio de lista − descuento, más IVA y servicio según el ' +
  'canal. No es venta: el cobro real sale al cerrar. Nunca entra en la neta ni en el cuadre.'

/** Cero de verdad: hay líneas en el pedido pero ninguna con valor servido (una cortesía). */
const MONTO_CERO_REAL =
  'El pedido tiene líneas pero ninguna con valor servido: cortesía, dueños o solo pax.'

/**
 * La marca de la mesa arrastrada de otra jornada. Se explica en el `title` porque la fila NO se
 * esconde: el operador tiene que poder decidir si es un olvido del personal o basura del puente.
 */
const REVISAR_JORNADA =
  'Esta mesa figura abierta desde una jornada anterior. Un servicio no cruza jornadas: o quedó ' +
  'sin cerrar en el PoS, o el puente la sigue reportando abierta cuando ya se cobró. No afecta ' +
  'las cifras del día, que salen de las facturas cerradas.'

/**
 * El «—» del tiempo abierta, cuando no se puede afirmar la semántica de `updated_at`. Con una
 * sola mesa ya no es el caso normal: se afirma sola pasada una ventana de poll. Queda para el
 * feed viejo, el primer minuto de una mesa recién abierta, y la instalación sin hora de pedido.
 */
const TIEMPO_PENDIENTE =
  'Todavía no se puede confirmar desde cuándo está abierta: el feed del PoS está viejo, la mesa ' +
  'se abrió hace menos de un minuto, o esta instalación no manda la hora de apertura del pedido.'

/**
 * Cuánto tiempo pasó, en horas y minutos. `haceCuanto` corta en minutos y sirve para el latido
 * de la pantalla; una mesa puede llevar tres horas abierta y «hace 187 min» no se lee.
 */
function duracion(iso: string, ahora: number): string {
  const min = Math.max(0, Math.round((ahora - new Date(iso).getTime()) / 60_000))
  if (min < 1)  return 'recién'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const r = min % 60
  return r === 0 ? `${h} h` : `${h} h ${r} min`
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

/** Porcentaje de una parte sobre un total. Sin total no hay porcentaje, y se dice. */
function porcentaje(parte: number, total: number): string {
  return total > 0 ? `${((parte / total) * 100).toFixed(1)}%` : '—'
}

const DIAS_SEMANA = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados']

/**
 * Sin metas cargadas no hay semáforo: `getMeta` devuelve 0 y `metaColor` devuelve cadena vacía.
 * Es el default explícito — la pestaña se dibuja igual aunque nadie le pase metas.
 */
const META_VACIA: Meta = {
  restaurante: {}, margen: {}, salMetas: {},
  global: { promPax: 0, bebPax: 0, ratioCB: 0, ticketItem: 0, ventas: 0 },
}

type OrdenRanking = 'promPax' | 'total' | 'pax' | 'ticket'
const ORDEN_LABEL: Record<OrdenRanking, string> = {
  promPax: 'Prom/PAX', total: 'Ventas', pax: 'PAX', ticket: 'Ticket/ítem',
}

/**
 * `metas` es OPCIONAL a propósito: sin metas cargadas `getMeta` devuelve 0 y `metaColor`
 * devuelve cadena vacía, así que la pantalla se ve igual pero sin semáforo. La pestaña nunca
 * depende de que le pasen algo.
 */
interface Props { metas?: Meta }

export default function VentasEnVivo({ metas }: Props) {
  const [local, setLocal]     = useState<LocalId>('santa-teresa')
  const [snap, setSnap]       = useState<SnapshotEnVivo | null>(null)
  const [error, setError]     = useState<string | null>(null)
  const [ahora, setAhora]     = useState(() => Date.now())
  const [prodPor, setProdPor] = useState<'monto' | 'unidades'>('monto')
  const [prodTipo, setProdTipo] = useState<'general' | 'comidas' | 'bebidas'>('general')
  const [salFiltro, setSalFiltro] = useState<string>('')
  const [orden, setOrden] = useState<OrdenRanking>('promPax')
  // La jornada que se está mirando. Vacío = la de hoy. Poder pedir un día pasado es lo que
  // permite CUADRAR contra el reporte del PoS sin esperar a que el día de hoy tenga ventas.
  const [fecha, setFecha] = useState<string>('')

  const cargar = useCallback(async (l: LocalId, f: string) => {
    try {
      setSnap(await getSnapshotEnVivo(l, f || undefined))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron leer las ventas')
    }
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { cargar(local, fecha) }, [cargar, local, fecha])

  // «Siempre actualizado»: se vuelve a pedir cada 30 s. El `setAhora` del mismo tick es lo que
  // hace avanzar el «hace X s» aunque el snapshot no cambie. Mirando un día cerrado no hay nada
  // que refrescar, así que el intervalo no se arma.
  useEffect(() => {
    if (fecha) return
    const id = setInterval(() => { setAhora(Date.now()); cargar(local, fecha) }, REFRESH_MS)
    return () => clearInterval(id)
  }, [cargar, local, fecha])

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

  const {
    dia, pm, porHora, historico, calidadPax, proyeccionCierre, turnos, turnosPoS, canales,
    abiertasPorSalonero, mesasDetalle, mesasJornadaAnterior, frescura, ordenes, porTurno,
  } = snap

  // ── El día, con las MISMAS funciones que «Hoy» ─────────────────────────────────────────────
  // `DiasMap` de una sola entrada: es todo lo que necesitan `aggGeneral`/`aggSalonero` para
  // dar exactamente los mismos números que la pestaña «Hoy» da sobre el xls.
  const m = metas ?? META_VACIA
  const dias: DiasMap = { [snap.fecha]: dia }
  const stats = getDayStats(dia)
  const gen   = aggGeneral([snap.fecha], dias, pm)

  // Meseros y caja se separan por la MARCA `esCajero`, no por el nombre: el login 111/222 y el
  // sistema salen marcados desde `armarDia`, así que ni compiten en el ranking ni se pierden.
  const entradas = Object.entries(dia.saloneros)
  const sals = entradas.filter(([, v]) => !(v as CajeroDay).esCajero).map(([k]) => k).sort()
  const cajs = entradas.filter(([,  v]) => (v as CajeroDay).esCajero).map(([k]) => k).sort()

  const salAggs = sals.map(nom => aggSalonero(nom, [snap.fecha], dias, pm))
  const cajAggs = cajs.map(nom => aggCajero(nom, [snap.fecha], dias))

  const ranking = [...salAggs].sort((a, b) => {
    if (orden === 'promPax') return b.promPax - a.promPax
    if (orden === 'total')   return b.total   - a.total
    if (orden === 'ticket')  return b.promTicket - a.promTicket
    return b.pax - a.pax
  })

  // Comidas y bebidas en plata, igual que las deriva «Hoy» a partir de `gen.prods`.
  const com = Object.entries(gen.prods).reduce((s, [n, v]) => s + (pm[n]?.tipo === 'comida' ? v.m : 0), 0)
  const beb = Object.entries(gen.prods).reduce((s, [n, v]) => s + (pm[n]?.tipo === 'bebida' ? v.m : 0), 0)
  const promPlato  = gen.iCom > 0 ? com / gen.iCom : 0
  const promBebida = gen.iBeb > 0 ? beb / gen.iBeb : 0

  // ── Las tres cifras que el modelo del xls no tiene ──
  const tickets    = ticketsDelDia(porHora)
  const ticketProm = ticketPromedioDe(stats.ventaNeta, tickets)
  // La hora actual CR: es el cursor del gráfico de ritmo por hora. Ya NO es el rótulo del KPI
  // principal, que decía «al cierre de las HH:00» con este reloj y se leía como un corte.
  const hora       = horaCorteCR()
  // Lo provisional (cuentas en curso, estado R) viaja APARTE del día en `snap.provisional`,
  // en la misma unidad que la neta (valor_servido). El generador de ejemplo no lo trae: 0.
  const sinCerrar          = snap.provisional?.monto   ?? 0
  const provisionalTickets = snap.provisional?.tickets ?? 0

  // ── LOS TRES TICKET PROMEDIO, cada uno con su regla ────────────────────────────────────────
  // Son cifras DISTINTAS a propósito y por eso van con nombre. Antes había dos sin rótulo y
  // parecían la misma mal calculada:
  //   · restaurante → neto del día ENTERO ÷ tickets del día entero (incluye caja y sistema).
  //   · salón       → neto de los MESEROS ÷ órdenes de los meseros. Es el comparable del panel
  //                   de saloneros, cuyo general nunca tuvo un ticket promedio propio.
  //   · mesero      → su neto ÷ SUS órdenes (la fila del ranking).
  // Qué caja está abierta AHORA: el turno del lote que todavía no cerró. Sirve al encargado
  // más que cualquier badge de origen de datos.
  const turnoEnCurso = snap.servicioEnCurso
    ? porTurno?.find(t => t.turno !== null && t.tickets > 0)?.etiqueta ?? null
    : null

  const ordenesDe = (nombre: string): number => ordenes?.[nombre] ?? 0

  // ── SALONEROS POR TURNO ────────────────────────────────────────────────────────────────────
  // La misma partición que va a usar el dashboard por empleado: por turno + general. Cada turno
  // trae su `DiaData` completo (`snap.porTurno`, armado con el MISMO `armarDia`), así que acá se
  // corre `aggSalonero` igual que sobre el día entero — cambia el conjunto de tickets, no la
  // matemática. Así "trabajó en la tarde" se lee de que TIENE fila en ese turno.
  const saloneroPorTurno = (porTurno ?? [])
    .filter(t => t.turno !== null)
    .map(t => {
      const diasT: DiasMap = { [snap.fecha]: t.dia }
      const nombresT = Object.entries(t.dia.saloneros)
        .filter(([, v]) => !(v as CajeroDay).esCajero)
        .map(([k]) => k)
      const filas = nombresT
        .map(nom => {
          const a = aggSalonero(nom, [snap.fecha], diasT, t.pm)
          const ords = t.ordenes[nom] ?? 0
          return {
            nombre:     nom,
            total:      a.total,
            pax:        a.pax,
            ordenes:    ords,
            ticketProm: ords > 0 ? Math.round(a.total / ords) : 0,
            promPax:    a.promPax,
          }
        })
        .filter(f => f.total > 0 || f.ordenes > 0)
        .sort((a, b) => b.total - a.total)
      const netoMeseros = filas.reduce((acc, f) => acc + f.total, 0)
      return { turno: t.turno, etiqueta: t.etiqueta, filas, netoMeseros }
    })
    .filter(t => t.filas.length > 0)
  const ordenesSalon = sals.reduce((a, nom) => a + ordenesDe(nom), 0)
  const ticketPromSalon = ordenesSalon > 0 ? Math.round(gen.total / ordenesSalon) : 0

  // ── Mix y top, con el mismo par (DiaData + ProductMap) que usa Mix Ventas ──
  const mix = mixPorCategoria(dia, pm)
  // General = el día ENTERO (caja y sistema incluidos), que es lo que hace que la suma del top
  // cierre con el mix y con el neto. Con un salonero elegido, sus productos y nada más.
  const prodsBase = salFiltro
    ? aggSalonero(salFiltro, [snap.fecha], dias, pm).prods
    : prodsDelDia(dia)
  const prods = topProds(
    prodsBase, prodPor, 10,
    prodTipo === 'general' ? undefined : prodTipo === 'comidas' ? ['comida'] : ['bebida'],
    pm,
  )

  const maxCat  = Math.max(...mix.map(c => c.monto), 1)
  const maxProd = Math.max(...prods.map(p => (prodPor === 'monto' ? p.m : p.q)), 1)

  const hoyJornada = jornadaActualCR()
  const enUltimaJornada = snap.fecha >= hoyJornada

  // Todas las filas del panel: los turnos del mapa + las facturas sin caja conocida (solo si
  // hay alguna). Sumar una caja al mapa agrega su fila acá sola, sin tocar esta pantalla.
  const filasTurno = turnos
    ? [...turnos.turnos, ...(turnos.sinTurno.tickets > 0 ? [turnos.sinTurno] : [])]
    : []
  const netoTurnos    = filasTurno.reduce((a, t) => a + t.neto, 0)
  const ticketsTurno  = filasTurno.reduce((a, t) => a + t.tickets, 0)
  const paxTurno      = filasTurno.reduce((a, t) => a + t.pax, 0)
  const dow = dayOfWeek(snap.fecha)

  // Sin una sola factura cerrada en la jornada. No es un error ni algo que rellenar: es que
  // todavía no se vendió nada (o que el agente aún no empujó el primer lote).
  const sinVentas = tickets === 0 && stats.ventaNeta === 0

  return (
    <div className="vt-section">
      <div className="apos">

        {/* ── El feed está viejo ────────────────────────────────────────────────
            Va ANTES y aparte del panel de mesas, y no depende de que haya mesas abiertas:
            justamente cuando el agente se cayó, «0 mesas abiertas» es la mentira más
            peligrosa de la pantalla. `pos_ndf_open` conserva el último snapshot para
            siempre, así que sin este aviso las mesas fantasma se leen como actuales. */}
        {snap.servicioEnCurso && frescura?.desactualizado === true && (
          <section className="apos-panel apos-viejo" role="status">
            <div className="apos-panel-hd">
              <h3>Sin lecturas recientes del PoS</h3>
              <span className="apos-panel-sub">
                {frescura.ultimoPollAt === null
                  ? 'el agente del PoS todavía no reportó para este local'
                  : `última lectura ${duracion(frescura.ultimoPollAt, ahora)} atrás`}
                {' · '}lo que se ve abajo puede estar viejo
              </span>
            </div>
            {/* Un lote que falló deja el snapshot viejo aunque el poll sea de recién. Sin decir
                el motivo, «última lectura hace 1 min · puede estar viejo» se lee como un bug
                de la pantalla en vez de como lo que es: el agente no pudo traer nada. */}
            {frescura.error !== null && (
              <p className="apos-viejo-nota">
                El agente corrió pero el último lote <strong>no entró</strong>:{' '}
                <span className="apos-mono-sm">{frescura.error}</span>
              </p>
            )}
            <p className="apos-viejo-nota">
              Las mesas abiertas y sus tiempos quedan en «—» hasta que el agente vuelva a
              reportar. Las cifras del día no se ven afectadas: salen de las facturas ya
              cerradas, no de este snapshot.
            </p>
          </section>
        )}

        {/* ── LO QUE ESTÁ PASANDO AHORA ──────────────────────────────────────────
            Va primero porque es lo único de esta pantalla que sirve para actuar EN EL
            MOMENTO: el resto ya pasó. Solo aparece mirando la jornada en curso — en un día
            cerrado `pos_ndf_open` está vacía y una barra en cero sería ruido.

            Lo que se lista acá YA tiene excluidas las mesas que se cobraron: entre poll y
            poll una mesa recién cerrada vive en `pos_ndf_open` y en `pos_ndf_tickets` a la
            vez, y sin ese filtro se vería como cerrada en «Hoy» y abierta acá. */}
        {snap.mesasAbiertas !== undefined && snap.mesasAbiertas > 0 && (
          <section className="apos-panel apos-abiertas">
            <div className="apos-panel-hd">
              <h3>
                <span className="apos-pulso" aria-hidden="true" />{' '}
                {snap.mesasAbiertas} {snap.mesasAbiertas === 1 ? 'mesa abierta' : 'mesas abiertas'}
              </h3>
              <span className="apos-panel-sub">
                {snap.paxAbierto ? `${snap.paxAbierto} pax sentados · ` : ''}
                todavía sin cobrar: <strong>no</strong> entran en las cifras de abajo
              </span>
              <span className="apos-spacer" />
              {frescura && (
                <span className={`apos-fresco${frescura.desactualizado ? ' is-cerrado' : ''}`}>
                  {frescura.ultimoPollAt === null
                    ? 'sin lecturas del PoS'
                    : `PoS leído ${duracion(frescura.ultimoPollAt, ahora)} atrás`}
                </span>
              )}
            </div>
            {abiertasPorSalonero && abiertasPorSalonero.length > 0 && (
              <ul className="apos-abiertas-lista">
                {abiertasPorSalonero.map(a => (
                  <li key={a.salonero}>
                    <span className="apos-abiertas-quien">{a.salonero}</span>
                    <span className="apos-abiertas-dato">
                      {a.mesas} {a.mesas === 1 ? 'mesa' : 'mesas'}
                    </span>
                    {a.pax > 0 && <span className="apos-abiertas-dato">{a.pax} pax</span>}
                  </li>
                ))}
              </ul>
            )}

            {/* Mesas arrastradas de otra jornada. Va ARRIBA de la tabla y no la filtra: si el
                puente está metiendo pedidos ya cerrados como abiertos, la pantalla tiene que
                delatarlo. `excluirCerradas` no ataja ese caso — su llave sale del mismo
                back-link del PoS que viene vacío justo ahí. */}
            {mesasJornadaAnterior !== undefined && mesasJornadaAnterior > 0 && (
              <p className="apos-revisar-nota" role="status">
                <span className="apos-revisar" aria-hidden="true">⚠</span>{' '}
                {mesasJornadaAnterior === 1
                  ? '1 mesa lleva abierta desde una jornada anterior'
                  : `${mesasJornadaAnterior} mesas llevan abiertas desde una jornada anterior`}
                {' — revisar en el PoS'}
              </p>
            )}

            {/* Mesa por mesa. Las columnas de plata van SIEMPRE en «—»: `pos_ndf_open` no
                trae monto en ninguna de las tres capas del puente (el SELECT contra el PoS
                no lo pide, el payload no lo lleva, la tabla no tiene la columna). Un «₡0»
                acá se leería como «esta mesa no consumió nada», que es falso.
                // TODO monto abierto: pendiente de columna en el bridge. */}
            {mesasDetalle && mesasDetalle.length > 0 && (
              <div className="apos-tabla-wrap">
                <table className="apos-tabla apos-tabla-abiertas">
                  <thead>
                    <tr>
                      <th scope="col">Mesa</th>
                      <th scope="col">Salonero</th>
                      <th scope="col">Canal</th>
                      <th scope="col" className="r">PAX</th>
                      <th scope="col" className="r">Abierta</th>
                      <th scope="col" className="r">Pedido ₡</th>
                      <th scope="col" className="r">Ticket/mesa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mesasDetalle.map(m => (
                      <tr key={m.clave} className={m.deJornadaAnterior ? 'is-revisar' : undefined}>
                        <td>
                          {m.mesa ?? '—'}
                          {m.deJornadaAnterior && (
                            <>
                              {' '}
                              <span className="apos-revisar" title={REVISAR_JORNADA}>
                                ⚠ revisar
                              </span>
                            </>
                          )}
                        </td>
                        <td>{m.salonero}</td>
                        <td>{m.canal ?? '—'}</td>
                        <td className="r">
                          {m.paxPedido !== null ? m.paxPedido : m.pax > 0 ? m.pax : '—'}
                        </td>
                        <td className="r">
                          {m.abiertaDesde === null
                            ? <span className="apos-pendiente" title={TIEMPO_PENDIENTE}>—</span>
                            : duracion(m.abiertaDesde, ahora)}
                        </td>
                        <td className="r">
                          {m.montoEstimado === null
                            ? <span className="apos-pendiente apos-sin-dato" title={MONTO_PENDIENTE}>sin total</span>
                            : m.montoEstimado === 0
                              ? <span className="apos-pendiente apos-sin-dato" title={MONTO_CERO_REAL}>₡0 · cortesía</span>
                              : <span className="apos-estimado" title={MONTO_ESTIMADO}>
                                  ≈ {fi(m.montoEstimado)} <small>estimado</small>
                                </span>}
                        </td>
                        <td className="r">
                          <span className="apos-pendiente apos-sin-dato" title={MONTO_PENDIENTE}>
                            sin total
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* ── De dónde salen estos números ──────────────────────────────────── */}
        <div className="apos-panel">
          <div className="apos-panel-hd">
            <h3>En vivo</h3>
            {/* El espacio del badge de origen ahora lleva lo que el encargado sí mira: qué hay
                abierto, cuánto va el ticket promedio y en qué turno está la caja. */}
            <span className="apos-panel-sub">
              {snap.mesasAbiertas
                ? `${snap.mesasAbiertas} ${snap.mesasAbiertas === 1 ? 'mesa abierta' : 'mesas abiertas'}`
                : 'sin mesas abiertas'}
              {snap.paxAbierto ? ` · ${snap.paxAbierto} pax sentados` : ''}
              {ticketProm > 0 ? ` · ticket prom. ${fi(ticketProm)}` : ''}
              {turnoEnCurso ? ` · ${turnoEnCurso}` : ''}
            </span>
            <span className="apos-spacer" />
            {/* Ver una jornada pasada: lo que permite cuadrar contra el reporte del PoS.
                Las flechas mueven de a una jornada (7→7), que es la unidad con la que se
                lee este negocio — no de a un día civil. */}
            <div className="apos-nav-jornada">
              <button
                type="button"
                className="apos-btn-nav"
                aria-label="Jornada anterior"
                title="Jornada anterior"
                onClick={() => setFecha(jornadaDesplazada(snap.fecha, -1))}
              >
                ‹
              </button>
              <label className="apos-fecha">
                Jornada{' '}
                <input
                  type="date"
                  value={fecha}
                  max={hoyJornada}
                  onChange={e => setFecha(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="apos-btn-nav"
                aria-label="Jornada siguiente"
                title={enUltimaJornada ? 'Ya estás en la jornada de hoy' : 'Jornada siguiente'}
                disabled={enUltimaJornada}
                onClick={() => {
                  const sig = jornadaDesplazada(snap.fecha, 1)
                  // Volver a "hoy" tiene que dejar el selector VACÍO: es lo que vuelve a
                  // prender el refresco automático. Con la fecha puesta, la pantalla queda
                  // congelada aunque sea el día de hoy.
                  setFecha(sig >= hoyJornada ? '' : sig)
                }}
              >
                ›
              </button>
            </div>
            {fecha && (
              <button type="button" className="apos-btn-hoy" onClick={() => setFecha('')}>
                Volver a hoy
              </button>
            )}
          </div>
        </div>

        {/* ── Jornada sin ventas: se dice, no se rellena ─────────────────────── */}
        {sinVentas && (
          <div className="apos-panel">
            <p className="apos-nota" style={{ marginBottom: 0 }}>
              <strong>Sin ventas todavía en esta jornada</strong> ({snap.fecha}). Ninguna cuenta
              cerrada. Si esperabas movimiento, revisá que el agente del PoS esté corriendo.
            </p>
          </div>
        )}

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

        {/* ── KPIs ──────────────────────────────────────────────────────────────
            El encuadre operable, en TRES cifras rotuladas y una sola unidad (NETO):
              · Cobrado    = la venta oficial (`getDayStats`, solo cuentas cerradas, estado C).
              · Sin cerrar = cuentas en curso (estado R). Plata que existe pero puede cambiar
                             hasta que el cajero cierre el lote. Sale de `snap.provisional`,
                             NUNCA de `getDayStats`: la neta oficial no la lleva.
              · Abierto    = mesas abiertas ahora (conteo, sin monto: el PoS no lo manda).
            La cifra PRINCIPAL es el total de la JORNADA, cobrado + sin cerrar. El desglose por
            turno (mañana / tarde) vive abajo, en «Por turno», como detalle. Antes el principal
            decía «al cierre de las 16:00» con la hora ACTUAL, que se leía como un corte y era
            solo el reloj. */}
        <div className="apos-kpis">
          <div className="apos-kpi is-principal">
            <span className="apos-kpi-lbl">Vendido hasta ahora</span>
            <span className="apos-kpi-val">{fi(stats.ventaNeta + sinCerrar)}</span>
            <span className="apos-kpi-sub">
              neto · cobrado + sin cerrar · {snap.servicioEnCurso ? 'jornada en curso' : 'jornada completa'}
            </span>
          </div>
          <div className="apos-kpi">
            <span className="apos-kpi-lbl">Cobrado</span>
            <span className="apos-kpi-val">{fi(stats.ventaNeta)}</span>
            <span className="apos-kpi-sub">neto oficial · solo cuentas cerradas</span>
          </div>
          <div className={`apos-kpi${sinCerrar > 0 ? ' is-provisional' : ' is-tenue'}`}>
            <span className="apos-kpi-lbl">Sin cerrar</span>
            <span className="apos-kpi-val">{fi(sinCerrar)}</span>
            <span className="apos-kpi-sub">
              {sinCerrar > 0
                ? `${provisionalTickets} ${provisionalTickets === 1 ? 'cuenta' : 'cuentas'} en curso · puede cambiar hasta el cierre`
                : 'nada en curso · cuentas en R'}
            </span>
          </div>
          <div className="apos-kpi">
            <span className="apos-kpi-lbl">Abierto</span>
            <span className="apos-kpi-val">{(snap.mesasAbiertas ?? 0).toLocaleString('es-CR')}</span>
            <span className="apos-kpi-sub">
              {(snap.mesasAbiertas ?? 0) === 1 ? 'mesa abierta ahora' : 'mesas abiertas ahora'} · sin monto: el PoS no lo manda
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
            {/* Rótulo explícito: NO es el mismo número que el ticket promedio de los meseros.
                Este es del restaurante entero e incluye caja y sistema. */}
            <span className="apos-kpi-sub">restaurante · neto ÷ tickets</span>
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

        {/* ── Restaurante: salón vs delivery + la línea de caja ──────────────── */}
        <section className="apos-panel">
          <div className="apos-panel-hd">
            <h3>Restaurante</h3>
            <span className="apos-panel-sub">
              el total de la jornada, en NETO · el mismo <code>getDayStats</code> de «Hoy»
            </span>
          </div>
          <div className="apos-kpis apos-kpis-libre">
            <div className="apos-kpi is-principal">
              <span className="apos-kpi-lbl">Venta total restaurante</span>
              <span className="apos-kpi-val">{fi(stats.ventaNeta)}</span>
              <span className="apos-kpi-sub">salón + delivery + caja + sistema</span>
            </div>
            <div className="apos-kpi">
              <span className="apos-kpi-lbl">Salón</span>
              <span className="apos-kpi-val">{fi(canales ? canales.salon : gen.total + gen.cajSalon)}</span>
              <span className="apos-kpi-sub">
                {porcentaje(canales ? canales.salon : gen.total + gen.cajSalon, stats.ventaNeta)}
                {canales ? ' · por canal de la factura' : ''}
              </span>
            </div>
            <div className="apos-kpi">
              <span className="apos-kpi-lbl">Delivery</span>
              <span className="apos-kpi-val">{fi(canales ? canales.delivery : gen.cajDelivery)}</span>
              <span className="apos-kpi-sub">
                {porcentaje(canales ? canales.delivery : gen.cajDelivery, stats.ventaNeta)}
                {canales ? ' · por canal de la factura' : ''}
              </span>
            </div>
          </div>

          {/* Caja y sistema: LÍNEA APARTE. No son meseros y no compiten en el ranking, pero su
              venta es del restaurante y tiene que verse. */}
          {cajAggs.length > 0 && (
            <details className="apos-detalle">
              {/* Colapsable: al encargado no le sirve todos los días, pero cuando el neto del
                  salón no cuadra con el del restaurante, la diferencia está acá. Por eso el
                  resumen lleva la cifra: se ve sin abrir. */}
              <summary>
                <strong>Caja y sistema</strong> · {fi(cajAggs.reduce((a, c) => a + c.total, 0))}{' '}
                en {cajAggs.reduce((a, c) => a + c.ordenes, 0).toLocaleString('es-CR')} facturas
                {' '}— no se le acreditan a ningún mesero
              </summary>
              <p className="apos-nota">
                <strong>Caja</strong> = lo cobró un cajero de turno (<code>111</code> mañana ·{' '}
                <code>222</code> tarde) sin mesero asignado: delivery, para llevar, o una cuenta
                que pasó directo por caja. <strong>Sistema</strong> = el PoS facturando solo
                (<code>002</code> cocina express, <code>01</code>/<code>02</code> bajas).
                Las dos <strong>suman al total del restaurante</strong> y quedan fuera del
                ranking de saloneros.
              </p>
              <div className="apos-tabla-wrap">
                <table className="apos-tabla">
                  <thead>
                    <tr>
                      <th>Línea</th>
                      <th className="r">Ventas</th>
                      <th className="r">Tickets</th>
                      <th className="r">Ticket prom.</th>
                      <th className="r">Salón</th>
                      <th className="r">Delivery</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cajAggs.map(c => (
                      <tr key={c.nombre}>
                        <td>{c.nombre}</td>
                        <td className="r">{fi(c.total)}</td>
                        <td className="r">{c.ordenes.toLocaleString('es-CR')}</td>
                        <td className="r">{c.ordenes > 0 ? fi(c.ticketProm) : '—'}</td>
                        <td className="r">{fi(c.salon)}</td>
                        <td className="r">{fi(c.delivery)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </section>

        {/* ── Turnos: mañana / tarde ─────────────────────────────────────────── */}
        {turnos && (
          <section className="apos-panel">
            <div className="apos-panel-hd">
              <h3>Por turno</h3>
              <span className="apos-panel-sub">
                por lote de cierre de caja · ticket prom. = neto ÷ tickets del turno · prom/pax = neto ÷ pax del turno
              </span>
            </div>
            <div className="apos-tabla-wrap">
              <table className="apos-tabla">
                <thead>
                  <tr>
                    <th>Turno</th>
                    <th className="r">Venta neta</th>
                    <th className="r">% del día</th>
                    <th className="r">Tickets</th>
                    <th className="r">Ticket prom.</th>
                    <th className="r">PAX</th>
                    <th className="r">Prom/PAX</th>
                  </tr>
                </thead>
                <tbody>
                  {filasTurno.map(t => (
                    <tr key={t.turno ?? '(sin turno)'}>
                      <td>{t.etiqueta}</td>
                      <td className="r">{fi(t.neto)}</td>
                      <td className="r">{porcentaje(t.neto, netoTurnos)}</td>
                      <td className="r">{t.tickets.toLocaleString('es-CR')}</td>
                      {/* Ticket promedio DEL TURNO = su neto ÷ sus tickets. */}
                      <td className="r">{t.tickets > 0 ? fi(Math.round(t.neto / t.tickets)) : '—'}</td>
                      <td className="r">{t.pax.toLocaleString('es-CR')}</td>
                      {/* Promedio por comensal DEL TURNO = su neto ÷ su pax. */}
                      <td className="r">{t.pax > 0 ? fi(Math.round(t.neto / t.pax)) : '—'}</td>
                    </tr>
                  ))}
                  <tr>
                    <td><strong>Jornada completa</strong></td>
                    <td className="r"><strong>{fi(netoTurnos)}</strong></td>
                    <td className="r">100,0%</td>
                    <td className="r"><strong>{ticketsTurno.toLocaleString('es-CR')}</strong></td>
                    <td className="r">
                      <strong>{ticketsTurno > 0 ? fi(Math.round(netoTurnos / ticketsTurno)) : '—'}</strong>
                    </td>
                    <td className="r"><strong>{paxTurno.toLocaleString('es-CR')}</strong></td>
                    <td className="r">
                      <strong>{paxTurno > 0 ? fi(Math.round(netoTurnos / paxTurno)) : '—'}</strong>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            {/* La invariante, a la vista: los dos turnos son excluyentes y cubren la jornada
                entera, así que su suma TIENE que ser el neto del día. Si algún día no cuadra,
                se ve acá y no en una hoja de cálculo tres semanas después. */}
            <p className="apos-nota" style={{ marginBottom: 0 }}>
              {filasTurno.map(t => t.etiqueta).join(' + ')} = {fi(netoTurnos)}{' '}
              {netoTurnos === stats.ventaNeta
                ? <span className="apos-estado is-ok">✓ cuadra con el neto del día</span>
                : <span className="apos-estado is-flojo">
                    ⚠ no cuadra con el neto del día ({fi(stats.ventaNeta)})
                  </span>}
              . El turno lo decide el <strong>cajero que cerró la caja</strong>, no el reloj:
              un turno es un <em>lote</em> = la clave (<code>cajero_login</code>,{' '}
              <code>fecha_cierra</code>), y todas las facturas de una misma pasada de caja van
              juntas. La <strong>fecha de la jornada sale de la apertura</strong> (el primer
              ticket del lote, en hora de Costa Rica): el <code>222</code> que cierra a la 01:00
              sigue perteneciendo al día que abrió. Las cajas salen de un mapa —{' '}
              <code>CAJAS_POR_LOGIN</code>—, así que sumar una barra o un desayuno es una fila
              ahí y esta tabla la muestra sola. Ojo: el <em>canal</em> «barra» de cada factura
              es otra cosa, y no entra en esta cuenta.
            </p>

            {/* La otra lectura del mismo día: la que guarda el PoS según qué caja estaba
                abierta (111 → Mañana · 222 → Tarde). El valor guardado del 222 sigue siendo
                'noche' en la columna `turno`; acá solo se TRADUCE para mostrarlo. */}
            {turnosPoS && turnosPoS.length > 0 && (
              <p className="apos-nota" style={{ marginBottom: 0 }}>
                <strong>Según la caja del PoS</strong> (111 · 222):{' '}
                {turnosPoS.map((t, i) => (
                  <span key={t.turno}>
                    {i > 0 ? ' · ' : ''}
                    {t.turno} {fi(t.neto)} ({t.tickets} {t.tickets === 1 ? 'ticket' : 'tickets'})
                  </span>
                ))}
                . Es el mismo día leído por <em>qué caja estaba abierta</em> en vez de por el
                reloj; si las dos lecturas se separan mucho, hay algo que mirar.
              </p>
            )}
          </section>
        )}

        {/* ── Ritmo por hora ────────────────────────────────────────────────── */}
        <section className="apos-panel">
          <div className="apos-panel-hd">
            <h3>Ritmo por hora</h3>
            <span className="apos-panel-sub">venta cerrada en cada hora · hora de Costa Rica</span>
          </div>
          <VentasEnVivoRitmo datos={porHora} horaActual={hora} />
        </section>

        {/* ── Contra el histórico: el MISMO día de semana ────────────────────── */}
        <section className="apos-panel">
          <div className="apos-panel-hd">
            <h3>Contexto de los {DIAS_SEMANA[dow]}</h3>
            <span className="apos-panel-sub">
              contra los {DIAS_SEMANA[dow]} anteriores, a la misma hora — no contra el día cerrado
            </span>
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

        {/* ── Saloneros POR TURNO ────────────────────────────────────────────
            Va ANTES del general: el encargado cierra por turno, no por jornada. Un mesero que
            solo trabajó la tarde aparece solo en la tarde — "en qué turno trabajó" se lee de en
            qué tabla está, sin una columna que lo repita. */}
        {saloneroPorTurno.length > 0 && (
          <section className="apos-panel">
            <div className="apos-panel-hd">
              <h3>Saloneros por turno</h3>
              <span className="apos-panel-sub">
                cada mesero en el turno que trabajó · ticket prom. = su neto ÷ sus órdenes
              </span>
            </div>
            {saloneroPorTurno.map(t => (
              <div key={t.turno ?? '(sin turno)'} className="apos-turno-bloque">
                <h4 className="apos-subtitulo">
                  {t.etiqueta}
                  <span className="apos-subtitulo-dato">
                    {fi(t.netoMeseros)} · {t.filas.length}{' '}
                    {t.filas.length === 1 ? 'mesero' : 'meseros'}
                  </span>
                </h4>
                <div className="apos-tabla-wrap">
                  <table className="apos-tabla">
                    <thead>
                      <tr>
                        <th>Mesero</th>
                        <th className="r">Ventas</th>
                        <th className="r">% del turno</th>
                        <th className="r">Órdenes</th>
                        <th className="r">Ticket prom.</th>
                        <th className="r">PAX</th>
                        <th className="r">Prom/PAX</th>
                      </tr>
                    </thead>
                    <tbody>
                      {t.filas.map(f => (
                        <tr key={f.nombre}>
                          <td>{f.nombre}</td>
                          <td className="r">{fi(f.total)}</td>
                          <td className="r">{porcentaje(f.total, t.netoMeseros)}</td>
                          <td className="r">{f.ordenes.toLocaleString('es-CR')}</td>
                          <td className="r">{f.ticketProm > 0 ? fi(f.ticketProm) : '—'}</td>
                          <td className="r">{f.pax.toLocaleString('es-CR')}</td>
                          <td className="r">{f.pax > 0 ? fi(Math.round(f.promPax)) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </section>
        )}

        {/* ── Saloneros: el general de la jornada (todos los turnos) ─────────── */}
        <section className="apos-panel">
          <div className="apos-panel-hd">
            <h3>Saloneros · jornada completa</h3>
            <span className="apos-panel-sub">
              solo piso · caja y sistema van aparte, en «Restaurante»
            </span>
          </div>
          <div className="apos-kpis apos-kpis-libre">
            <div className="apos-kpi is-principal">
              <span className="apos-kpi-lbl">Ventas salón</span>
              <span className="apos-kpi-val">{fi(gen.total)}</span>
              <span className="apos-kpi-sub">{porcentaje(gen.total, stats.ventaNeta)} del restaurante</span>
            </div>
            <div className="apos-kpi">
              <span className="apos-kpi-lbl">Ticket promedio salón</span>
              <span className="apos-kpi-val">{ticketPromSalon > 0 ? fi(ticketPromSalon) : '—'}</span>
              {/* El comparable del «Ticket promedio» de arriba: mismo cálculo, otro universo.
                  Arriba es el restaurante entero; acá solo lo que pasó por un mesero. */}
              <span className="apos-kpi-sub">
                mesero · neto ÷ órdenes · {ordenesSalon.toLocaleString('es-CR')} órdenes
              </span>
            </div>
            <div className="apos-kpi">
              <span className="apos-kpi-lbl">PAX</span>
              <span className="apos-kpi-val">{gen.pax.toLocaleString('es-CR')}</span>
              <span className="apos-kpi-sub">comensales atendidos</span>
            </div>
            <div className="apos-kpi">
              <span className="apos-kpi-lbl">Prom/PAX</span>
              <span className="apos-kpi-val" style={{ color: metaColor(gen.promPax, getMeta(m, '', 'promPax')) }}>
                {gen.pax > 0 ? fi(gen.promPax) : '—'}
              </span>
              <span className="apos-kpi-sub">venta de salón / pax</span>
            </div>
            <div className="apos-kpi">
              <span className="apos-kpi-lbl">Prom/plato</span>
              <span className="apos-kpi-val">{gen.iCom > 0 ? fi(promPlato) : '—'}</span>
              <span className="apos-kpi-sub">{gen.iCom.toLocaleString('es-CR')} platos</span>
            </div>
            <div className="apos-kpi">
              <span className="apos-kpi-lbl">Prom/bebida</span>
              <span className="apos-kpi-val">{gen.iBeb > 0 ? fi(promBebida) : '—'}</span>
              <span className="apos-kpi-sub">{gen.iBeb.toLocaleString('es-CR')} bebidas</span>
            </div>
            <div className="apos-kpi">
              <span className="apos-kpi-lbl">Bebidas/PAX</span>
              <span className="apos-kpi-val" style={{ color: metaColor(gen.bebPax, getMeta(m, '', 'bebPax')) }}>
                {gen.pax > 0 ? gen.bebPax.toFixed(2) : '—'}
              </span>
              <span className="apos-kpi-sub">unidades por comensal</span>
            </div>
            <div className="apos-kpi">
              <span className="apos-kpi-lbl">Ratio comida/bebida</span>
              <span className={`apos-kpi-val ${ratioCBClass(gen.ratioCB)}`}>
                {gen.ratioCB > 0 ? `${gen.ratioCB.toFixed(2)}:1` : '—'}
              </span>
              <span className="apos-kpi-sub">en plata</span>
            </div>
            <div className="apos-kpi">
              <span className="apos-kpi-lbl">Comidas</span>
              <span className="apos-kpi-val">{fi(com)}</span>
              <span className="apos-kpi-sub">{gen.iCom.toLocaleString('es-CR')} platos</span>
            </div>
            <div className="apos-kpi">
              <span className="apos-kpi-lbl">Bebidas</span>
              <span className="apos-kpi-val">{fi(beb)}</span>
              <span className="apos-kpi-sub">{gen.iBeb.toLocaleString('es-CR')} bebidas</span>
            </div>
          </div>
        </section>

        {/* ── Ranking del día ────────────────────────────────────────────────── */}
        <section className="apos-panel">
          <div className="apos-panel-hd">
            <h3>Ranking del día</h3>
            <span className="apos-spacer" />
            <div className="apos-toggle" role="group" aria-label="Ordenar el ranking por">
              {(Object.keys(ORDEN_LABEL) as OrdenRanking[]).map(k => (
                <button
                  key={k}
                  type="button"
                  className={orden === k ? 'is-on' : ''}
                  aria-pressed={orden === k}
                  onClick={() => setOrden(k)}
                >
                  {ORDEN_LABEL[k]}
                </button>
              ))}
            </div>
          </div>
          <div className="apos-tabla-wrap">
            <table className="apos-tabla">
              <thead>
                <tr>
                  <th className="r">#</th>
                  <th>Salonero</th>
                  <th className="r">PAX</th>
                  <th className="r">Ventas</th>
                  <th className="r">Prom/PAX</th>
                  <th className="r">Ticket/ítem</th>
                  <th className="r">Beb/PAX</th>
                  <th className="r">Ratio C/B</th>
                  <th className="r">vs general</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((s, i) => (
                  <tr key={s.nombre}>
                    <td className="r">{i + 1}</td>
                    <td>
                      {s.nombre}
                      {/* Un login sin empleado cargado NO desaparece del ranking: se muestra con
                          su número y marcado, para que se vea que falta el mapeo. */}
                      {esSinAsignar(s.nombre) && (
                        <em className="apos-barra-cat" title="Cargá el pos_login del empleado en Empleados">
                          sin asignar
                        </em>
                      )}
                    </td>
                    <td className="r">{s.pax.toLocaleString('es-CR')}</td>
                    <td className="r" style={{ color: metaColor(s.total, getMeta(m, s.nombre, 'ventas')) }}>
                      {fi(s.total)}
                    </td>
                    <td className="r" style={{ color: metaColor(s.promPax, getMeta(m, s.nombre, 'promPax')) }}>
                      {s.pax > 0 ? fi(s.promPax) : '—'}
                    </td>
                    <td className="r">{s.promTicket > 0 ? fi(s.promTicket) : '—'}</td>
                    <td className="r" style={{ color: metaColor(s.bebPax, getMeta(m, s.nombre, 'bebPax')) }}>
                      {s.pax > 0 ? s.bebPax.toFixed(2) : '—'}
                    </td>
                    <td className={`r ${ratioCBClass(s.ratioCB)}`}>
                      {s.ratioCB > 0 ? `${s.ratioCB.toFixed(2)}:1` : '—'}
                    </td>
                    <td className="r">
                      {gen.promPax > 0 && s.pax > 0
                        ? <Delta actual={s.promPax} referencia={gen.promPax} />
                        : <span className="apos-delta is-nulo">sin referencia</span>}
                    </td>
                  </tr>
                ))}
                {ranking.length === 0 && (
                  <tr><td colSpan={9}>Ninguna factura acreditada a un salonero en esta jornada.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="apos-nota" style={{ marginBottom: 0 }}>
            «vs general» compara el Prom/PAX del mesero contra el del salón ({fi(gen.promPax)}).
            El pax sale del <strong>artículo pax</strong> (§3.F) — mirá la calidad del pax al pie
            antes de usar estos promedios para decidir algo.
          </p>
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

        {/* ── Top productos: general y por salonero, por monto y por unidades ── */}
        <section className="apos-panel">
          <div className="apos-panel-hd">
            <h3>Lo que más se vendió</h3>
            <span className="apos-spacer" />
            <div className="apos-toggle" role="group" aria-label="Filtrar por tipo">
              {(['general', 'comidas', 'bebidas'] as const).map(v => (
                <button
                  key={v}
                  type="button"
                  className={prodTipo === v ? 'is-on' : ''}
                  aria-pressed={prodTipo === v}
                  onClick={() => setProdTipo(v)}
                >
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
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

          {/* El filtro por salonero: el mismo top, acotado a lo que vendió una persona. */}
          <div className="apos-locales" role="group" aria-label="Salonero">
            <button
              type="button"
              className={`apos-chip ${salFiltro === '' ? 'is-on' : ''}`}
              aria-pressed={salFiltro === ''}
              onClick={() => setSalFiltro('')}
            >
              General
            </button>
            {sals.map(nom => (
              <button
                key={nom}
                type="button"
                className={`apos-chip ${salFiltro === nom ? 'is-on' : ''}`}
                aria-pressed={salFiltro === nom}
                onClick={() => setSalFiltro(nom)}
              >
                {nom}
              </button>
            ))}
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
            {prods.length === 0 && (
              <li><span className="apos-barra-lbl">Sin productos para ese filtro</span></li>
            )}
          </ul>
        </section>

        {/* ── Calidad del pax (§3.F) ─────────────────────────────────────────── */}
        <section className="apos-panel">
          <div className="apos-panel-hd">
            <h3>Calidad del pax</h3>
            <span className="apos-panel-sub">no mide ventas: mide si se puede confiar en el Prom/PAX</span>
          </div>
          <p className="apos-nota">
            El pax de esta pantalla sale del <strong>artículo PAX</strong> del PoS (§3.F), no del
            campo nativo de comensales: el nativo no es obligatorio y hoy llega sin cargar en buena
            parte de las mesas. Los dos <strong>nunca se suman</strong>. Por debajo de{' '}
            {UMBRAL_PAX_CONFIABLE}% de mesas con pax nativo cargado, el Prom/PAX de ese mesero
            tiene el denominador con huecos — se muestra igual (arriba, en el ranking), pero acá se
            ve cuánto pesa la duda.
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
                      <td className="r">{c.pctPaxNativoCargado.toFixed(0)}%</td>
                      <td className="r">{c.matchArticuloVsNativo.toFixed(0)}%</td>
                      <td>
                        <span className={`apos-estado ${ok ? 'is-ok' : 'is-flojo'}`}>
                          {ok ? '✓ confiable' : '⚠ con huecos'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
                {calidadPax.length === 0 && (
                  <tr><td colSpan={5}>Sin mesas de salonero en esta jornada.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <p className="apos-pie">
          El día se arma como <code>DiaData</code>, el mismo tipo que produce el import de xls, y
          se le pasa a las funciones de <code>ventasUtils</code> que ya usaba «Hoy». Por eso las
          dos pestañas se pueden cotejar: <strong>«Hoy» sigue leyendo el xls y no cambió</strong>,
          «En vivo» lee <code>pos_ndf</code>. Si dicen números distintos para la misma fecha, eso
          es información — no un empate a resolver borrando una de las dos.
        </p>
      </div>
    </div>
  )
}
