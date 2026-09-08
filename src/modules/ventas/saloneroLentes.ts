// ── Las DOS LENTES de saloneros (Parte B, paso 3) ──────────────────────────────────────────
//
// Módulo PURO: sin I/O, sin Supabase, sin reloj. Recibe tickets + líneas ya leídos y devuelve
// las dos vistas del MISMO día.
//
// ⚠️ LAS DOS LENTES NUNCA SE SUMAN. Es la regla dura de la SPEC firmada, y no es un capricho
// de presentación: cada lente parte la neta del día ENTERA, por un eje distinto. Sumarlas
// contaría dos veces toda mesa partida entre dos meseros. Por eso viven en dos arreglos
// separados, con dos tipos distintos, y no hay ninguna función que los junte.
//
//   · LENTE A — VENTA PROPIA (por LÍNEA): lo que cada uno comandó. Es exactamente aditiva:
//     Σ de todas las personas = neta del día. Es el titular del ranking. Premia el upsell en
//     mesa ajena y no castiga al dueño de la mesa.
//
//   · LENTE B — MESA PROPIA (por FACTURA): quién corrió la mesa. El dueño se lleva la mesa
//     ENTERA, incluidas las líneas que comandó otro. Es contexto —ticket promedio, prom/pax—,
//     no ranking. La plata del ayudante igual está en SU venta propia, en la lente A.
//
// ── QUÉ REEMPLAZA ──────────────────────────────────────────────────────────────────────────
// El modelo viejo era un mesero por TICKET (el del pedido), y con dos meseros en una factura
// "acreditaba al menor". Además daba 0% de cobertura en 2024. Acá se reparte de verdad, por
// línea, con `usuario_registra` (Parte A).
//
// ── LO QUE NO ESTÁ EN v1 (a propósito) ─────────────────────────────────────────────────────
// · Delivery (`tipo = 'D'`) no se separa: cuenta en el día como cualquier factura. Es otro pase.
// · PAX propio cuenta SOLO el código 677 (1 persona). El 678 (×2) queda para v2, firmado así.
// · IVA y servicio propios van PRORRATEADOS, no leídos por línea: ver `prorratear` abajo.

import {
  COD_PAX_1, esValorServido,
} from '../../shared/ndf/mapTicket'
import {
  clasificarCodigo, type PersonaNdf, type RolCodigo,
} from '../../shared/ndf/personasNdf'
import {
  type Turno, etiquetaTurno, turnoDeCajero, turnosConocidos,
} from '../../shared/ndf/jornada'

// ── Turno ──────────────────────────────────────────────────────────────────────────────────
//
// El turno lo define la CAJA que cobró (`FAC_Facturas.Login`), igual que en `jornada.ts` — no
// el reloj ni el BioTime. Acá se le agrega un balde para lo que el mapa de cajas no conoce:
// `jornada.ts` devuelve `null` a propósito (no adivina), pero esta pantalla necesita que TODA
// factura caiga en alguna fila, porque si no se le pierde plata a alguien.

/** El balde de las facturas que no cerró ninguna caja del mapa. */
export const TURNO_DIA = 'dia'

const ORDEN_DIA = 99

/** El turno de una factura. A diferencia de `turnoDeCajero`, nunca es `null`. */
export function turnoDeFactura(cajeroLogin: string | null | undefined): Turno {
  return turnoDeCajero(cajeroLogin) ?? TURNO_DIA
}

/**
 * Cómo se dice el turno en pantalla.
 *
 * Los conocidos salen del mapa de cajas (`111` = "Mañana · almuerzo", `222` = "Tarde · noche"),
 * así que agregar una caja allá agrega su fila acá sola. Ojo con `222`: su id es `tarde` y su
 * etiqueta ya dice "Tarde · noche" — es el turno de la noche, no hace falta un id nuevo.
 */
export function etiquetaTurnoSalonero(turno: Turno): string {
  return turno === TURNO_DIA ? 'Día' : etiquetaTurno(turno)
}

/** Los turnos posibles, ordenados. `dia` va último porque es el balde, no un turno de verdad. */
export function turnosSalonero(): { turno: Turno; etiqueta: string; orden: number }[] {
  return [
    ...turnosConocidos(),
    { turno: TURNO_DIA, etiqueta: 'Día', orden: ORDEN_DIA },
  ]
}

// ── Entradas ───────────────────────────────────────────────────────────────────────────────
// Estructurales a propósito: le sirve tanto la fila de `pos_ndf_tickets` como un fixture.

export interface TicketLente {
  id:                string
  cajero_login:      string | null
  /** La neta de la factura. Es la que reparte la lente B, ENTERA, al dueño de la mesa. */
  valor_servido_crc: number | null
  iva_crc:           number | null
  servicio_crc:      number | null
  pax:               number | null
  mesa?:             string | null
}

export interface LineaLente {
  ticket_id:        string
  codigo_producto:  string | null
  cantidad:         number | null
  monto:            number | null
  familia:          number | null
  usuario_registra: string | null
}

// ── Salidas ────────────────────────────────────────────────────────────────────────────────

/** Una fila de la lente A: una persona, en un turno, con lo que ELLA comandó. */
export interface FilaVentaPropia {
  personaId:   string
  persona:     PersonaNdf
  rol:         RolCodigo
  turno:       Turno
  /** Σ `monto` de sus líneas de valor servido. */
  netaCrc:     number
  /** Prorrateados desde la factura — no vienen por línea. Ver `prorratear`. */
  ivaCrc:      number
  servicioCrc: number
  /** Σ unidades del código 677 que ELLA registró. Solo 677 en v1. */
  paxPropio:   number
  /** Neta propia ÷ pax propio. `null` si no registró ningún pax. */
  promPorPax:  number | null
  /** Cuántas líneas de valor servido comandó. Para ver de dónde sale el número. */
  lineas:      number
}

/** Una fila de la lente B: una persona, en un turno, con las mesas que CORRIÓ. */
export interface FilaMesaPropia {
  personaId:      string
  persona:        PersonaNdf
  rol:            RolCodigo
  turno:          Turno
  /** Mesas distintas. Una factura sin número de mesa cuenta como su propia mesa. */
  mesas:          number
  /** Facturas de las que es dueña. */
  tickets:        number
  /** Σ de la neta ENTERA de esas facturas, incluida la parte que comandó otro. */
  netaMesasCrc:   number
  /** Neta entera ÷ facturas propias. `null` si no tiene ninguna. */
  ticketPromedio: number | null
  /** Σ del `pax` de esas facturas (el de la factura, no el de las líneas de esta persona). */
  paxMesas:       number
  promPorPaxMesa: number | null
}

export interface LentesSaloneros {
  /** Lente A. Ordenada por neta descendente dentro de cada turno. */
  ventaPropia:    FilaVentaPropia[]
  /** Lente B. Ordenada por neta de mesas descendente dentro de cada turno. */
  mesaPropia:     FilaMesaPropia[]
  /** La neta del día según las FACTURAS (`valor_servido_crc`). Es la que muestra el resto de la app. */
  netaDiaCrc:     number
  /** La neta según las LÍNEAS, que es la que reparte la lente A. */
  netaLineasCrc:  number
  /**
   * `netaDiaCrc − netaLineasCrc`. Debería ser 0.
   *
   * No se esconde: si las líneas no suman lo que dice la factura (una factura ingestada sin su
   * detalle, un redondeo raro), el ranking está repartiendo un total distinto al del día y hay
   * que verlo, no taparlo.
   */
  descuadreCrc:   number
  turnos:         { turno: Turno; etiqueta: string; orden: number }[]
}

// ── Utilidades ─────────────────────────────────────────────────────────────────────────────

const num = (v: number | null | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/**
 * Reparte `total` entre los pesos, en enteros y SIN perder ni inventar un colón.
 *
 * Restos mayores primero (largest remainder): la suma de las partes es exactamente `total`,
 * que es lo que hace que el IVA prorrateado siga cuadrando con el de la factura.
 */
export function prorratear(total: number, pesos: readonly number[]): number[] {
  const suma = pesos.reduce((s, p) => s + p, 0)
  const objetivo = Math.round(total)
  if (pesos.length === 0 || suma <= 0) return pesos.map(() => 0)

  const crudos = pesos.map(p => (objetivo * p) / suma)
  const partes = crudos.map(Math.floor)
  let falta = objetivo - partes.reduce((s, p) => s + p, 0)
  const orden = crudos
    .map((c, i) => ({ i, resto: c - Math.floor(c) }))
    .sort((a, b) => b.resto - a.resto || a.i - b.i)
  for (let k = 0; falta > 0 && k < orden.length; k++, falta--) partes[orden[k].i]++
  // `falta` negativa solo puede pasar con pesos negativos; se descuenta por el otro lado.
  for (let k = orden.length - 1; falta < 0 && k >= 0; k--, falta++) partes[orden[k].i]--
  return partes
}

// ── El cálculo ─────────────────────────────────────────────────────────────────────────────

interface AcumA {
  persona: PersonaNdf
  turno:   Turno
  neta:    number
  iva:     number
  servicio:number
  pax:     number
  lineas:  number
}

interface AcumB {
  persona:  PersonaNdf
  turno:    Turno
  mesas:    Set<string>
  tickets:  number
  neta:     number
  pax:      number
}

/** Clave de una fila: la persona Y el turno. Una persona que trabajó los dos turnos da dos filas. */
const clave = (personaId: string, turno: Turno): string => `${personaId}|${turno}`

/**
 * Las dos lentes de un conjunto de facturas + sus líneas.
 *
 * Las facturas que no tienen ninguna línea igual cuentan en `netaDiaCrc` (por eso existe
 * `descuadreCrc`): no se las descarta en silencio.
 */
export function calcularLentes(
  tickets: readonly TicketLente[],
  lineas: readonly LineaLente[],
): LentesSaloneros {
  const porTicket = new Map<string, LineaLente[]>()
  for (const l of lineas) {
    const lista = porTicket.get(l.ticket_id)
    if (lista) lista.push(l)
    else porTicket.set(l.ticket_id, [l])
  }

  const a = new Map<string, AcumA>()
  const b = new Map<string, AcumB>()
  let netaDia = 0
  let netaLineas = 0

  for (const t of tickets) {
    const turno = turnoDeFactura(t.cajero_login)
    const propias = porTicket.get(t.id) ?? []
    netaDia += num(t.valor_servido_crc)

    // ── Lente A: la factura se parte por quién comandó cada línea ──
    // Los pesos del prorrateo salen de la MISMA partición, así que el IVA sigue a la plata.
    const netaPorPersona = new Map<string, { persona: PersonaNdf; neta: number; pax: number; lineas: number }>()
    for (const l of propias) {
      const persona = clasificarCodigo(l.usuario_registra)
      let acc = netaPorPersona.get(persona.id)
      if (!acc) {
        acc = { persona, neta: 0, pax: 0, lineas: 0 }
        netaPorPersona.set(persona.id, acc)
      }
      if (esValorServido(l.familia)) {
        acc.neta += num(l.monto)
        acc.lineas++
        netaLineas += num(l.monto)
      }
      // El pax propio se cuenta por CÓDIGO (677), no por familia, y va aparte de la neta: la
      // familia 19 "A PAX" no es valor servido, así que estas líneas no suman plata.
      if ((l.codigo_producto ?? '').trim() === COD_PAX_1) acc.pax += num(l.cantidad)
    }

    const entradas = [...netaPorPersona.values()]
    const partesIva      = prorratear(num(t.iva_crc),      entradas.map(e => e.neta))
    const partesServicio = prorratear(num(t.servicio_crc), entradas.map(e => e.neta))
    // Si ninguna persona tiene neta en la factura (o no hay líneas), el prorrateo da 0 y el IVA
    // de esa factura queda SIN atribuir. Se manda al balde "sin código" en vez de evaporarse.
    const huerfanoIva      = num(t.iva_crc)      - partesIva.reduce((s, p) => s + p, 0)
    const huerfanoServicio = num(t.servicio_crc) - partesServicio.reduce((s, p) => s + p, 0)
    if (huerfanoIva !== 0 || huerfanoServicio !== 0) {
      sumarA(a, clasificarCodigo(null), turno, { neta: 0, iva: huerfanoIva, servicio: huerfanoServicio, pax: 0, lineas: 0 })
    }
    entradas.forEach((e, i) => {
      sumarA(a, e.persona, turno, {
        neta: e.neta, iva: partesIva[i], servicio: partesServicio[i], pax: e.pax, lineas: e.lineas,
      })
    })

    // ── Lente B: la factura ENTERA va a un solo dueño ──
    const dueno = duenoDeMesa(propias)
    const k = clave(dueno.id, turno)
    let accB = b.get(k)
    if (!accB) {
      accB = { persona: dueno, turno, mesas: new Set(), tickets: 0, neta: 0, pax: 0 }
      b.set(k, accB)
    }
    // Sin número de mesa (delivery, para llevar) la factura es su propia mesa: es un servicio
    // que igual corrió esa persona, y agruparlas todas bajo un `null` las contaría como una.
    accB.mesas.add((t.mesa ?? '').trim() || `factura:${t.id}`)
    accB.tickets++
    accB.neta += num(t.valor_servido_crc)
    accB.pax  += num(t.pax)
  }

  const ventaPropia: FilaVentaPropia[] = [...a.values()].map(x => ({
    personaId:   x.persona.id,
    persona:     x.persona,
    rol:         x.persona.rol,
    turno:       x.turno,
    netaCrc:     Math.round(x.neta),
    ivaCrc:      Math.round(x.iva),
    servicioCrc: Math.round(x.servicio),
    paxPropio:   x.pax,
    promPorPax:  x.pax > 0 ? Math.round(x.neta / x.pax) : null,
    lineas:      x.lineas,
  })).sort(ordenar(f => f.netaCrc))

  const mesaPropia: FilaMesaPropia[] = [...b.values()].map(x => ({
    personaId:      x.persona.id,
    persona:        x.persona,
    rol:            x.persona.rol,
    turno:          x.turno,
    mesas:          x.mesas.size,
    tickets:        x.tickets,
    netaMesasCrc:   Math.round(x.neta),
    ticketPromedio: x.tickets > 0 ? Math.round(x.neta / x.tickets) : null,
    paxMesas:       x.pax,
    promPorPaxMesa: x.pax > 0 ? Math.round(x.neta / x.pax) : null,
  })).sort(ordenar(f => f.netaMesasCrc))

  return {
    ventaPropia,
    mesaPropia,
    netaDiaCrc:    Math.round(netaDia),
    netaLineasCrc: Math.round(netaLineas),
    descuadreCrc:  Math.round(netaDia) - Math.round(netaLineas),
    turnos:        turnosSalonero(),
  }
}

function sumarA(
  a: Map<string, AcumA>,
  persona: PersonaNdf,
  turno: Turno,
  d: { neta: number; iva: number; servicio: number; pax: number; lineas: number },
): void {
  const k = clave(persona.id, turno)
  let acc = a.get(k)
  if (!acc) {
    acc = { persona, turno, neta: 0, iva: 0, servicio: 0, pax: 0, lineas: 0 }
    a.set(k, acc)
  }
  acc.neta     += d.neta
  acc.iva      += d.iva
  acc.servicio += d.servicio
  acc.pax      += d.pax
  acc.lineas   += d.lineas
}

/**
 * El dueño de la mesa: **quien registró el 677**.
 *
 * Desempates, en orden (todos deterministas — mismo input, mismo dueño):
 *   1. Más unidades de 677.
 *   2. Si empatan (o si la factura no tiene ningún 677): más neta en ESA factura.
 *   3. Si siguen empatados: el id de persona, alfabético. Nunca "el primero que apareció",
 *      que dependería del orden en que vinieron las filas.
 *
 * Sin líneas, la factura queda a nombre del balde "sin código": no se la regala a nadie.
 */
export function duenoDeMesa(lineas: readonly LineaLente[]): PersonaNdf {
  const por = new Map<string, { persona: PersonaNdf; pax: number; neta: number }>()
  for (const l of lineas) {
    const persona = clasificarCodigo(l.usuario_registra)
    let acc = por.get(persona.id)
    if (!acc) {
      acc = { persona, pax: 0, neta: 0 }
      por.set(persona.id, acc)
    }
    if ((l.codigo_producto ?? '').trim() === COD_PAX_1) acc.pax += num(l.cantidad)
    if (esValorServido(l.familia)) acc.neta += num(l.monto)
  }
  const candidatos = [...por.values()]
  if (candidatos.length === 0) return clasificarCodigo(null)
  // El orden ES la regla: primero el 677, después la plata, después el id. Una factura sin
  // ningún 677 cae sola en el segundo criterio, porque ahí todos empatan en 0 pax.
  return candidatos.sort((x, y) =>
    y.pax - x.pax || y.neta - x.neta || x.persona.id.localeCompare(y.persona.id))[0].persona
}

/**
 * Orden de las tablas: por turno, y adentro la plata de mayor a menor.
 *
 * El id de persona desempata para que el orden sea ESTABLE: dos personas con la misma plata no
 * pueden cambiar de lugar entre dos renders.
 */
function ordenar<T extends { turno: Turno; personaId: string }>(plata: (f: T) => number) {
  return (x: T, y: T): number =>
    ordenTurno(x.turno) - ordenTurno(y.turno) ||
    plata(y) - plata(x) ||
    x.personaId.localeCompare(y.personaId)
}

function ordenTurno(turno: Turno): number {
  return turnosSalonero().find(t => t.turno === turno)?.orden ?? ORDEN_DIA
}
