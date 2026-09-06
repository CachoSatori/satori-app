// ── Jornada y turno del PoS — la definición COMPARTIDA (P1a) ───────────────────────────────
//
// Módulo PURO: sin I/O, sin Supabase, sin reloj (salvo los defaults explícitos). Es la única
// fuente de verdad sobre "a qué día y a qué turno pertenece un ticket", y la importan tanto
// «En vivo» como (en P1b) el adaptador, para que las dos pantallas no puedan discrepar.
//
// ── QUÉ REEMPLAZA ──────────────────────────────────────────────────────────────────────────
// La lógica vieja derivaba el turno del RELOJ (jornada 07→07 partida a las 16:00 CR). Eso era
// un relleno mientras `fecha_cierra` venía NULL. Ya no: el PoS dice explícitamente quién cerró
// la caja y cuándo, así que el turno lo define el CAJERO y el día lo define la APERTURA del
// lote, no la hora a la que cae cada factura.
//
// ── EL LOTE DE CIERRE ──────────────────────────────────────────────────────────────────────
// Un turno = un LOTE = la clave (`cajero_login`, `fecha_cierra`). Cuando el cajero cierra la
// caja, el PoS le estampa la MISMA `FechaCierra` a todas las facturas de esa pasada. Ese grupo
// es indivisible: son las facturas que el cajero cuadró de una sentada.
//
// Datos reales de staging que fijan la semántica:
//   · 5-sep → 111 cerró 16:07 CR (mañana) · 222 cerró 22:30 CR (tarde)
//   · 4-sep → 222 cerró 22:07 CR
//
// ── ZONA HORARIA ───────────────────────────────────────────────────────────────────────────
// `fecha_registra` y `fecha_cierra` son `timestamptz` = INSTANTES. El día SIEMPRE se saca en
// hora de Costa Rica (UTC−6 fijo, sin horario de verano), nunca con un `::date` pelado: bajo
// `TimeZone=UTC` eso parte el día a las 18:00 CR y el cierre de las 22:07 cae en el día
// siguiente. Es el equivalente exacto de `(x at time zone 'America/Costa_Rica')::date`.

/** Offset de Costa Rica. Fijo, sin horario de verano. */
export const CR_OFFSET_HORAS = -6

const MS_HORA = 3_600_000

/** Los dos cajeros de caja del PoS. El turno sale de acá, NO del reloj. */
export const LOGIN_CAJERO_MANANA = '111'
export const LOGIN_CAJERO_TARDE  = '222'

/**
 * Los ids del turno.
 *
 * Sin `ñ` a propósito: son los mismos valores que ya usa «En vivo» (`turnos.manana` /
 * `turnos.tarde`), así que la pantalla no se toca. La etiqueta que ve el usuario («Mañana»,
 * «Tarde») se resuelve en la capa de presentación, no acá. Ojo: el valor que el PoS guarda en
 * la columna `turno` para el 222 es `'noche'` — otra cosa, y no se toca.
 */
export type Turno = 'manana' | 'tarde'

/** Lo mínimo que este módulo necesita de un ticket. Deliberadamente estructural. */
export interface TicketJornada {
  /** Instante de la venta, con zona. */
  fecha_registra: string
  /** Instante del cierre de caja, con zona. `null` = el turno sigue abierto. */
  fecha_cierra?:  string | null
  /** `FAC_Facturas.Login`: el cajero que cobró. */
  cajero_login?:  string | null
}

// ── Hora de Costa Rica ─────────────────────────────────────────────────────────────────────

/**
 * Instante con zona → el DÍA en Costa Rica (`YYYY-MM-DD`).
 *
 * Equivale a `(x at time zone 'America/Costa_Rica')::date`. `null` si no es un instante.
 */
export function fechaCR(iso: string | null | undefined): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return new Date(t + CR_OFFSET_HORAS * MS_HORA).toISOString().slice(0, 10)
}

/**
 * Instante con zona → clave canónica del mismo instante.
 *
 * Dos escrituras distintas del mismo momento (`…T22:07:59-06:00` y `…T04:07:59Z`) tienen que
 * caer en el MISMO lote: si se comparara el string crudo, un cambio de formato en la ingesta
 * partiría un turno en dos.
 */
export function instanteCanonico(iso: string | null | undefined): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

// ── Turno ──────────────────────────────────────────────────────────────────────────────────

/**
 * El cajero que cobró → su turno. `111` mañana · `222` tarde.
 *
 * Cualquier otro login (o ninguno) devuelve `null` y **no se adivina por el reloj**: es el
 * error que esta definición viene a corregir. Un `null` acá es información —"esta factura no
 * la cerró ninguno de los dos cajeros"— y el que agrupa decide qué hacer con ella.
 */
export function turnoDeCajero(cajeroLogin: string | null | undefined): Turno | null {
  const l = cajeroLogin?.trim()
  if (l === LOGIN_CAJERO_MANANA) return 'manana'
  if (l === LOGIN_CAJERO_TARDE)  return 'tarde'
  return null
}

/** El turno de un ticket. Lo decide el cajero, punto. */
export function turnoDeTicket(t: Pick<TicketJornada, 'cajero_login'>): Turno | null {
  return turnoDeCajero(t.cajero_login)
}

// ── Lote de cierre ─────────────────────────────────────────────────────────────────────────

export interface LoteCierre<T extends TicketJornada = TicketJornada> {
  /** Identidad estable del lote dentro del local. */
  clave:       string
  cajeroLogin: string | null
  /** Instante canónico del cierre. `null` = turno abierto. */
  fechaCierra: string | null
  turno:       Turno | null
  /**
   * El día del negocio: la fecha en CR del PRIMER ticket del lote (la apertura del turno).
   *
   * NO es el calendario de `fecha_cierra`: el 222 que abre el 5-sep y cierra a la 01:00 del
   * 6-sep sigue perteneciendo a la jornada que abrió.
   */
  jornada:     string | null
  /** `true` mientras el PoS no haya estampado la fecha de cierre. */
  abierto:     boolean
  /** El instante (canónico) de apertura = el mínimo `fecha_registra` del lote. */
  apertura:    string | null
  tickets:     T[]
}

/**
 * La clave del lote de un ticket.
 *
 * · Cerrado → `cajero|<instante de cierre>`: la pasada de caja, tal cual.
 * · Abierto → `cajero|abierto|<día CR de la venta>`: el fallback en vivo, mientras el turno
 *   todavía no cerró. Cuando el PoS estampe la `FechaCierra`, esos tickets se reagrupan solos
 *   bajo la clave cerrada — por eso el prefijo `abierto` está en la clave: para que un lote a
 *   medio cerrar nunca se confunda con uno ya cuadrado.
 */
export function claveLote(t: TicketJornada): string {
  const cajero = t.cajero_login?.trim() || '(sin cajero)'
  const cierre = instanteCanonico(t.fecha_cierra)
  if (cierre !== null) return `${cajero}|${cierre}`
  return `${cajero}|abierto|${fechaCR(t.fecha_registra) ?? '(sin fecha)'}`
}

/**
 * Tickets → lotes de cierre, cada uno con su jornada ya resuelta.
 *
 * Hace falta ver TODOS los tickets del lote para poder sacar el mínimo `fecha_registra`: la
 * jornada es una propiedad del lote, no de la factura suelta. Por eso la API agrupa en vez de
 * ofrecer un `jornadaDeTicket(t)`, que sería imposible de calcular bien.
 *
 * Los lotes salen ordenados por apertura (y la clave desempata), así que el resultado es
 * estable: mismo input, mismo orden.
 */
export function agruparEnLotes<T extends TicketJornada>(tickets: readonly T[]): LoteCierre<T>[] {
  const porClave = new Map<string, T[]>()
  for (const t of tickets) {
    const k = claveLote(t)
    const lista = porClave.get(k)
    if (lista) lista.push(t)
    else porClave.set(k, [t])
  }

  const lotes: LoteCierre<T>[] = []
  for (const [clave, propios] of porClave) {
    const cierre = instanteCanonico(propios[0]?.fecha_cierra)
    // La apertura del turno: el instante más viejo del lote. De acá sale la jornada.
    let apertura: string | null = null
    let aperturaMs = Number.POSITIVE_INFINITY
    for (const t of propios) {
      const ms = Date.parse(t.fecha_registra)
      if (!Number.isNaN(ms) && ms < aperturaMs) {
        aperturaMs = ms
        apertura = new Date(ms).toISOString()
      }
    }
    lotes.push({
      clave,
      cajeroLogin: propios[0]?.cajero_login?.trim() || null,
      fechaCierra: cierre,
      turno:       turnoDeCajero(propios[0]?.cajero_login),
      jornada:     fechaCR(apertura),
      abierto:     cierre === null,
      apertura,
      tickets:     propios,
    })
  }

  return lotes.sort((a, b) =>
    (a.apertura ?? '').localeCompare(b.apertura ?? '') || a.clave.localeCompare(b.clave))
}

// ── Agrupación (jornada, turno) ────────────────────────────────────────────────────────────

export interface GrupoJornadaTurno<T extends TicketJornada = TicketJornada> {
  jornada: string | null
  turno:   Turno | null
  /** Los lotes que cayeron en esta celda. Normalmente uno; más de uno si el cajero cerró dos veces. */
  lotes:   LoteCierre<T>[]
  tickets: T[]
}

/**
 * Tickets → celdas `(jornada, turno)`.
 *
 * Es la unidad con la que se reporta: "la mañana del 5-sep", "la tarde del 4-sep". Un lote
 * nunca se parte entre dos celdas, y dos lotes del mismo cajero en el mismo día (cerró dos
 * veces) se suman en la misma.
 */
export function agruparPorJornadaTurno<T extends TicketJornada>(
  tickets: readonly T[],
): GrupoJornadaTurno<T>[] {
  const celdas = new Map<string, GrupoJornadaTurno<T>>()
  for (const lote of agruparEnLotes(tickets)) {
    const k = `${lote.jornada ?? '(sin jornada)'}|${lote.turno ?? '(sin turno)'}`
    const celda = celdas.get(k)
    if (celda) {
      celda.lotes.push(lote)
      celda.tickets.push(...lote.tickets)
    } else {
      celdas.set(k, {
        jornada: lote.jornada,
        turno:   lote.turno,
        lotes:   [lote],
        tickets: [...lote.tickets],
      })
    }
  }
  return [...celdas.values()].sort((a, b) =>
    (a.jornada ?? '').localeCompare(b.jornada ?? '') ||
    (a.turno ?? '').localeCompare(b.turno ?? ''))
}

/**
 * Ticket → la jornada de SU lote, indexado por el ticket mismo.
 *
 * Atajo para el que ya tiene los tickets sueltos y necesita etiquetarlos: se agrupa una vez y
 * se devuelve el mapa, en vez de recalcular el lote por cada factura.
 */
export function jornadaPorTicket<T extends TicketJornada>(
  tickets: readonly T[],
): Map<T, { jornada: string | null; turno: Turno | null; lote: LoteCierre<T> }> {
  const out = new Map<T, { jornada: string | null; turno: Turno | null; lote: LoteCierre<T> }>()
  for (const lote of agruparEnLotes(tickets)) {
    for (const t of lote.tickets) out.set(t, { jornada: lote.jornada, turno: lote.turno, lote })
  }
  return out
}
