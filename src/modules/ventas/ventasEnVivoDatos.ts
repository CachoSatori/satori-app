import type { CajeroDay, DiaData, ProductMap, SaloneroDay } from '../../shared/types/ventas'
import {
  businessDateDe, getLineasDeTickets, getMesasAbiertas, getNetoPorJornada, getSaloneroNombres,
  getTicketsJornada, HORA_CORTE_JORNADA, type LineaNdfRow, type TicketNdfConId,
} from '../../shared/api/posNdf'
import {
  FAMILIAS_VALOR_SERVIDO, LOGIN_CAJERO_MANANA, LOGIN_CAJERO_NOCHE,
} from '../../shared/ndf/mapTicket'
import { horaCorteCR } from './ventasEnVivoMock'
import { ARTICULO_PAX, type CalidadPax, type ComparativaHistorico, type LocalId,
         type SnapshotEnVivo, type VentaPorHora } from './ventasEnVivoTypes'

// ╔══════════════════════════════════════════════════════════════════════════════════════╗
// ║ Ventas · EN VIVO — el snapshot REAL, armado desde `pos_ndf_*` de staging                ║
// ╚══════════════════════════════════════════════════════════════════════════════════════╝
//
// Reemplaza al mock sin cambiarle una coma al contrato: produce el MISMO `SnapshotEnVivo`, así
// que la pantalla no sabe de dónde salió. Todo lo de acá es SOLO LECTURA y ADITIVO: no se toca
// `xlsParser`, ni `ventasUtils`, ni ninguna pestaña que ya existía.
//
// ── DE DÓNDE SALE CADA NÚMERO ──────────────────────────────────────────────────────────────
// Ninguno se recalcula acá: los resolvió el mapper del puente en la ingesta y viven en columnas.
//   neto      → `valor_servido_crc`   (comida 2,3,4,13,16,29 + bebida 5; ver la spec de regalías)
//   bruto     → `total_crc`           (Σ medios de pago − vuelto)
//   servicio  → `servicio_crc`        (Σ ImpS, el 10 %)
//   IVA       → `iva_crc`             (ImpV del PoS; hoy 0 en el histórico — no se deriva)
//   regalía   → `regalia_crc` · clase → `clase_ingreso` · pax → `pax`
//
// ── EL NETO ES EL QUE MANDA ────────────────────────────────────────────────────────────────
// `SaloneroDay.total` se llena con el NETO, no con el bruto: la pestaña muestra «venta» y el
// resto del módulo (`getDayStats`) trata ese campo como la venta del salonero. El bruto y el
// servicio viajan igual, en los extras del snapshot, para poder mirarlos al lado.

/**
 * Familias que suman al valor servido. **Importadas de la fuente de verdad**, no copiadas:
 * `FAMILIAS_VALOR_SERVIDO` de `src/shared/ndf/mapTicket.ts` es el mismo conjunto que usa el
 * mapper del puente para calcular `valor_servido_crc` en la ingesta.
 *
 * Acá solo sirve para FILTRAR el mix de producto — los montos ya vienen resueltos. Que sea el
 * MISMO array es lo que garantiza la invariante: la suma del mix es el neto del día.
 */
export const FAMILIAS_NETO = FAMILIAS_VALOR_SERVIDO

/** La familia de bebidas. Lo único que parte el mix en comida/bebida. */
export const FAMILIA_BEBIDA = 5

/**
 * Familia del PoS → la etiqueta con la que se agrupa el mix.
 *
 * Se agrupa por el NÚMERO de familia, que es dato duro del PoS, y no por el `ProductMap` de
 * la app: el ProductMap se carga a mano producto por producto y un producto sin cargar caería
 * en «SIN CLASIFICAR» aunque el PoS sí sepa qué es. Esto es ETIQUETAR, no recalcular plata.
 *
 * ⚠️ INVARIANTE: las claves de este mapa son EXACTAMENTE `FAMILIAS_NETO`, las mismas que
 * alimentan `valor_servido_crc`. Por eso **la suma del mix es el neto del día**. Agregar acá
 * una familia que no esté en el neto rompería esa igualdad — hay un test que lo fija.
 */
const CATEGORIA_FAMILIA: Record<number, string> = {
  3:  'Rolls',
  5:  'Bebidas',
  2:  'Entradas',
  16: 'Platos fuertes',
  29: 'Bentos',
  4:  'Otros',
  13: 'Otros',
}

const esFamiliaNeto = (f: number | null): boolean =>
  f !== null && (FAMILIAS_NETO as readonly number[]).includes(f)

const n = (v: number | null | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/**
 * Los comensales de un ticket, con la **fuente primaria del SPEC §3.F: el ARTÍCULO pax**.
 *
 * NO se usa la columna `pax` directamente. Esa la resuelve el mapper con la regla del puente
 * (manda el nativo cuando está), y el SPEC dice lo contrario mientras el nativo no sea
 * confiable: el campo nativo no es obligatorio y hoy viene sin cargar. Si no hay artículo, se
 * cae al `pax` ya resuelto — así un ticket con solo nativo no queda en cero.
 *
 * El día que el nativo llegue al 100 % (§3.F) esto se invierte y el artículo se retira.
 */
export function paxDelTicket(t: Pick<TicketNdfConId, 'pax' | 'pax_articulo'>): number {
  const articulo = n(t.pax_articulo)
  return articulo > 0 ? articulo : n(t.pax)
}

/** Con quién se acredita el ticket. `null` = cajero, sistema o sin pedido: no es un mesero. */
export function claveSalonero(t: Pick<TicketNdfConId, 'salonero_login' | 'registrado_por'>): string | null {
  if (t.registrado_por !== 'salonero') return null
  return t.salonero_login ?? null
}

// ── El día, en el modelo de siempre ────────────────────────────────────────────────────────

export interface DiaArmado {
  dia:      DiaData
  pm:       ProductMap
  /** Extras del PoS que `DiaData` no tiene campo para guardar. */
  bruto:    number
  servicio: number
  iva:      number
  regalia:  number
  tickets:  number
  /** El neto partido en salón / delivery. */
  canales:  VentasPorCanal
}

export interface VentasPorCanal { salon: number; delivery: number }

/**
 * Salón vs delivery, en NETO y **ticket por ticket**.
 *
 * En el modelo del xls el delivery solo se puede ver por el cajero que lo cobró; el PoS lo sabe
 * factura por factura (`canal`), así que acá se parte por el dato duro y no por quién la cerró.
 * Todo lo que no es delivery cuenta como salón: barra, para llevar y mesa son piso.
 */
export function ventasPorCanal(tickets: TicketNdfConId[]): VentasPorCanal {
  let salon = 0, delivery = 0
  for (const t of tickets) {
    const v = n(t.valor_servido_crc)
    if (t.canal === 'delivery') delivery += v
    else salon += v
  }
  return { salon: Math.round(salon), delivery: Math.round(delivery) }
}

/**
 * Tickets + líneas → `DiaData`, exactamente la forma que produce el import de xls.
 *
 * Las facturas que no son de un mesero (cajero 111/222, sistema, sin pedido) NO se pierden:
 * van a su propia clave, porque cuentan en el día aunque no se le acrediten a nadie.
 */
export function armarDia(
  fecha: string,
  tickets: TicketNdfConId[],
  lineas: LineaNdfRow[],
  uploadedAt: string,
  nombres: Record<string, string> = {},
): DiaArmado {
  const porTicket = new Map<string, LineaNdfRow[]>()
  for (const l of lineas) {
    const lista = porTicket.get(l.ticket_id)
    if (lista) lista.push(l)
    else porTicket.set(l.ticket_id, [l])
  }

  const acc = new Map<string, AccEntrada>()
  const pm: ProductMap = {}
  let bruto = 0, servicio = 0, iva = 0, regalia = 0

  for (const t of tickets) {
    bruto    += n(t.total_crc)
    servicio += n(t.servicio_crc)
    iva      += n(t.iva_crc)
    regalia  += n(t.regalia_crc)

    const login = claveSalonero(t)
    const esMesero = login !== null
    const clave = esMesero
      ? nombreSalonero(login, nombres)
      : etiquetaNoMesero(t.registrado_por, t.salonero_login)
    const e = acc.get(clave) ?? {
      esCajero: !esMesero,
      pax: 0, total: 0, com: 0, beb: 0, iCom: 0, iBeb: 0, serv: 0,
      delivery: 0, ordenes: 0,
      prods: new Map<string, { q: number; m: number }>(),
    }
    e.pax     += paxDelTicket(t)
    e.total   += n(t.valor_servido_crc)   // el NETO — ver el bloque de arriba
    e.serv    += n(t.servicio_crc)
    e.ordenes += 1
    if (t.canal === 'delivery') e.delivery += n(t.valor_servido_crc)

    for (const l of porTicket.get(t.id) ?? []) {
      // El "artículo pax" cuenta comensales, no es algo que se venda: fuera del mix, igual
      // que hace `xlsParser`. Y fuera también todo lo que no es neto (extras, gift, merch…).
      if (!esFamiliaNeto(l.familia)) continue
      const nombre = (l.nombre ?? l.codigo_producto ?? '').trim().toUpperCase()
      if (nombre === '' || nombre === ARTICULO_PAX) continue

      const cat = CATEGORIA_FAMILIA[l.familia as number] ?? 'Otros'
      const esBebida = l.familia === FAMILIA_BEBIDA
      const monto = n(l.monto), qty = Math.round(n(l.cantidad))
      if (esBebida) { e.beb += monto; e.iBeb += qty }
      else          { e.com += monto; e.iCom += qty }

      const p = e.prods.get(nombre) ?? { q: 0, m: 0 }
      p.q += qty; p.m += monto
      e.prods.set(nombre, p)

      if (!pm[nombre]) {
        pm[nombre] = {
          tipo: esBebida ? 'bebida' : 'comida',
          clasificacion: cat, subclasificacion: '', multiplicador: 1, costo_unitario: 0,
        }
      }
    }
    acc.set(clave, e)
  }

  const saloneros: Record<string, SaloneroDay | CajeroDay> = {}
  for (const [nombre, e] of acc) {
    const prods = [...e.prods.entries()]
      .sort((a, b) => b[1].m - a[1].m)
      .map(([nom, v]) => [nom, v.q, Math.round(v.m)] as [string, number, number])
    const total = Math.round(e.total)

    if (e.esCajero) {
      // Caja y sistema NO son meseros: van con la marca `esCajero`, que es lo que hace que
      // `aggSalonero` los saltee, `aggGeneral` los mande a `cajTotal` y el ranking del día no
      // los liste. `getDayStats` los sigue sumando al total del restaurante — que es el punto:
      // su venta cuenta, pero no compite con la de nadie.
      const delivery = Math.round(e.delivery)
      saloneros[nombre] = {
        esCajero: true,
        total,
        salon:      total - delivery,
        delivery,
        iva: 0, serv: Math.round(e.serv),
        ordenes:    e.ordenes,
        ticketProm: e.ordenes ? total / e.ordenes : 0,
        prods,
      }
      continue
    }

    saloneros[nombre] = {
      pax: e.pax, total, com: Math.round(e.com), beb: Math.round(e.beb),
      iCom: e.iCom, iBeb: e.iBeb,
      // IVA a nivel salonero queda en 0: el PoS lo informa por ticket y hoy viene 0 en el
      // histórico. `serv` sí es el dato real (Σ ImpS).
      iva: 0, serv: Math.round(e.serv),
      promPax:    e.pax  ? e.total / e.pax  : 0,
      promPlato:  e.iCom ? e.com   / e.iCom : 0,
      promBebida: e.iBeb ? e.beb   / e.iBeb : 0,
      ratioCB:    e.beb  ? e.com   / e.beb  : 0,
      ratioU:     e.iBeb ? e.iCom  / e.iBeb : 0,
      bebPax:     e.pax  ? e.iBeb  / e.pax  : 0,
      prods,
    }
  }

  return {
    dia: { fileName: `ndf ${fecha}`, uploadedAt, saloneros },
    pm,
    bruto: Math.round(bruto), servicio: Math.round(servicio),
    iva: Math.round(iva), regalia: Math.round(regalia),
    tickets: tickets.length,
    canales: ventasPorCanal(tickets),
  }
}

/** Lo que se va acumulando por clave mientras se recorren los tickets. */
interface AccEntrada {
  esCajero: boolean
  pax: number; total: number; com: number; beb: number; iCom: number; iBeb: number
  serv: number; delivery: number; ordenes: number
  prods: Map<string, { q: number; m: number }>
}

/**
 * El login del PoS → cómo se muestra. Con el empleado cargado, su nombre; sin cargar, el
 * número **marcado**, para que se vea que falta el mapeo en vez de desaparecer del ranking.
 */
export function nombreSalonero(login: string, nombres: Record<string, string>): string {
  const n = nombres[login]?.trim()
  return n && n !== '' ? n : `${login} · sin asignar`
}

/** ¿Este salonero quedó sin mapear a un empleado? */
export function esSinAsignar(clave: string): boolean {
  return clave.endsWith(' · sin asignar')
}

/**
 * Las facturas que no son de un mesero, con nombre propio para que se vean en el desglose.
 *
 * Los dos cajeros se separan por login (111 mañana · 222 noche) y salen con el MISMO nombre que
 * usa el xls — `isCajeroName` los reconoce, así que el resto del módulo los trata como caja sin
 * que haya que enseñarle nada nuevo. El sistema (002/01/02) va aparte: no es una caja, es el
 * PoS facturando solo, y mezclarlo con la caja escondería que existe.
 */
export function etiquetaNoMesero(registradoPor: string, login: string | null = null): string {
  if (registradoPor === 'cajero') {
    if (login === LOGIN_CAJERO_MANANA) return 'Cajero turno mañana'
    if (login === LOGIN_CAJERO_NOCHE)  return 'Cajero turno tarde'
    return login ? `Caja · ${login}` : 'Caja'
  }
  if (registradoPor === 'sistema') return login ? `Sistema · ${login}` : 'Sistema'
  return 'Sin salonero'
}

// ── Ritmo por hora ─────────────────────────────────────────────────────────────────────────

/**
 * El neto y las cuentas hora por hora, en hora de RELOJ de Costa Rica.
 *
 * Se recorren solo las horas con movimiento: un día que arrancó a las 11 no tiene por qué
 * mostrar diez horas en cero adelante.
 */
export function ritmoPorHora(tickets: TicketNdfConId[]): VentaPorHora[] {
  const acc = new Map<number, { monto: number; tickets: number }>()
  for (const t of tickets) {
    const h = horaCRDe(t.fecha_registra)
    if (h === null) continue
    const e = acc.get(h) ?? { monto: 0, tickets: 0 }
    e.monto += n(t.valor_servido_crc)
    e.tickets += 1
    acc.set(h, e)
  }
  return [...acc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([hora, e]) => ({ hora, monto: Math.round(e.monto), tickets: e.tickets }))
}

/** Hora de pared de Costa Rica (0–23) de un instante con zona. */
export function horaCRDe(instante: string): number | null {
  const t = Date.parse(instante)
  if (Number.isNaN(t)) return null
  return new Date(t - 6 * 3_600_000).getUTCHours()
}

// ── Turnos: mañana / tarde ─────────────────────────────────────────────────────────────────

/** Corte entre turnos, hora de pared CR. La jornada 07→07 se parte acá. */
export const HORA_CORTE_TURNO = 16

export type Turno = 'manana' | 'tarde'

/**
 * A qué turno pertenece un ticket: **mañana** si cerró entre las 07:00 y las 16:00 CR,
 * **tarde** entre las 16:00 y las 07:00 del día siguiente.
 *
 * Se mide por `fecha_cierra` —cuándo se cobró la cuenta, que es lo que define el turno— y se
 * cae a `fecha_registra` cuando no está.
 *
 * ⚠️ HOY SIEMPRE SE CAE AL FALLBACK: el extractor no selecciona la fecha de cierre del PoS, así
 * que `fecha_cierra` viene NULL en todas las filas. Para una mesa que se abre y se cobra en el
 * mismo turno da igual; la que se abre a las 15:50 y se cobra a las 16:30 hoy cuenta como
 * mañana. Está reportado.
 *
 * Los dos turnos son excluyentes y cubren la jornada entera: mañana + tarde = el neto del día.
 */
export function turnoDeTicket(t: Pick<TicketNdfConId, 'fecha_cierra' | 'fecha_registra'>): Turno {
  const h = horaCRDe(t.fecha_cierra ?? t.fecha_registra)
  if (h === null) return 'tarde'
  return h >= HORA_CORTE_JORNADA && h < HORA_CORTE_TURNO ? 'manana' : 'tarde'
}

export interface BloqueTurno { neto: number; tickets: number; pax: number }

export interface VentasTurno {
  manana: BloqueTurno
  tarde:  BloqueTurno
}

export function ventasPorTurno(tickets: TicketNdfConId[]): VentasTurno {
  const vacio = (): BloqueTurno => ({ neto: 0, tickets: 0, pax: 0 })
  const out: VentasTurno = { manana: vacio(), tarde: vacio() }
  for (const t of tickets) {
    const b = out[turnoDeTicket(t)]
    b.neto    += n(t.valor_servido_crc)
    b.tickets += 1
    b.pax     += paxDelTicket(t)
  }
  out.manana.neto = Math.round(out.manana.neto)
  out.tarde.neto  = Math.round(out.tarde.neto)
  return out
}

// ── Calidad del pax (§3.F) ─────────────────────────────────────────────────────────────────

/**
 * Por salonero: cuántas de sus mesas traen el pax en el campo NATIVO del PoS, y de las que
 * además lo traen como artículo, en cuántas coinciden.
 *
 * Sale de `pax_nativo` / `pax_articulo` / `pax_alerta`, que el mapper ya resolvió por ticket.
 * Solo se miden los meseros de verdad: al cajero de turno no se le exige cargar comensales.
 */
export function calidadPaxPorSalonero(
  tickets: TicketNdfConId[],
  nombres: Record<string, string> = {},
): CalidadPax[] {
  const acc = new Map<string, { mesas: number; conNativo: number; conAmbos: number; coinciden: number }>()
  for (const t of tickets) {
    const clave = claveSalonero(t)
    if (clave === null) continue
    const e = acc.get(clave) ?? { mesas: 0, conNativo: 0, conAmbos: 0, coinciden: 0 }
    e.mesas += 1
    const nativo = n(t.pax_nativo), articulo = n(t.pax_articulo)
    if (nativo > 0) e.conNativo += 1
    if (nativo > 0 && articulo > 0) {
      e.conAmbos += 1
      if (t.pax_alerta === 'ok') e.coinciden += 1
    }
    acc.set(clave, e)
  }
  return [...acc.entries()]
    .map(([login, e]) => ({
      salonero: nombreSalonero(login, nombres),
      mesas: e.mesas,
      pctPaxNativoCargado:   e.mesas ? (e.conNativo / e.mesas) * 100 : 0,
      matchArticuloVsNativo: e.conAmbos ? (e.coinciden / e.conAmbos) * 100 : 0,
    }))
    .sort((a, b) => b.mesas - a.mesas)
}

// ── Comparativa ────────────────────────────────────────────────────────────────────────────

/** Las cuatro jornadas del mismo día de semana, hacia atrás. */
export function jornadasComparables(businessDate: string, semanas = 4): string[] {
  const [y, m, d] = businessDate.split('-').map(Number)
  const base = Date.UTC(y, m - 1, d)
  return Array.from({ length: semanas }, (_, i) =>
    new Date(base - (i + 1) * 7 * 86_400_000).toISOString().slice(0, 10))
}

export function compararContra(netoPorJornada: Record<string, number>, comparables: string[]): ComparativaHistorico {
  const valores = comparables.map(f => netoPorJornada[f] ?? 0)
  const conVenta = valores.filter(v => v > 0)
  return {
    mismoDiaSemanaPasada: Math.round(valores[0] ?? 0),
    // Promedio de los días que EXISTIERON: incluir un cero de un día cerrado hundiría la
    // referencia y la comparación diría que hoy va bárbaro.
    promedio4Semanas: conVenta.length
      ? Math.round(conVenta.reduce((s, v) => s + v, 0) / conVenta.length)
      : 0,
  }
}

// ── El snapshot completo ───────────────────────────────────────────────────────────────────

export interface EntradaSnapshot {
  local:      LocalId
  fecha:      string
  tickets:    TicketNdfConId[]
  lineas:     LineaNdfRow[]
  neto4Sem:   Record<string, number>
  ahora:      Date
  enServicio: boolean
  /** `pos_login` → nombre del empleado. Sin él, los saloneros salen por número. */
  nombres?:   Record<string, string>
}

/** PURO: todo lo de arriba junto. Se prueba sin Supabase. */
export function armarSnapshot(e: EntradaSnapshot): SnapshotEnVivo {
  const armado = armarDia(e.fecha, e.tickets, e.lineas, e.ahora.toISOString(), e.nombres ?? {})
  const neto = Object.values(armado.dia.saloneros).reduce((s, v) => s + v.total, 0)
  const comparables = jornadasComparables(e.fecha)

  return {
    local: e.local,
    fecha: e.fecha,
    generadoEn: e.ahora.toISOString(),
    servicioEnCurso: e.enServicio,
    dia: armado.dia,
    pm: armado.pm,
    porHora: ritmoPorHora(e.tickets),
    // La proyección no es un dato del PoS: con el servicio terminado no se proyecta nada.
    proyeccionCierre: neto,
    historico: compararContra(e.neto4Sem, comparables),
    calidadPax: calidadPaxPorSalonero(e.tickets, e.nombres ?? {}),

    // Extras del feed real (campos opcionales del contrato).
    bruto:    armado.bruto,
    servicio: armado.servicio,
    iva:      armado.iva,
    regalia:  armado.regalia,
    // El PoS informa el IVA en 0 en todo el histórico. Se marca PENDIENTE en vez de mostrar
    // un cero que se lee como "no hubo impuesto" — y NUNCA se deriva de neto × 0,13.
    ivaPendiente: armado.iva === 0,
    // Todo lo de acá salió de `pos_ndf_*`. El generador de ejemplo no pasa por esta función.
    fuente: 'pos',
    turnos: ventasPorTurno(e.tickets),
    canales: armado.canales,
  }
}

// ── Qué jornada se está mirando ────────────────────────────────────────────────────────────

/**
 * La jornada en curso, con la regla del negocio: **07:00 → 07:00 hora de Costa Rica**.
 *
 * ⚠️ NO se usa el `fechaServicioCR()` del mock. Ese decide con un horario de atención
 * (11:00–23:00) y devuelve "ayer" entre las 00:00 y las 11:00 — o sea que a las 09:00 de la
 * mañana pedía el día equivocado. La jornada del negocio y el horario de atención son dos
 * cosas distintas, y la que manda acá es la primera: es la misma con la que se filtran los
 * tickets (`ventanaJornada`) y la que usa el cuadre contra el reporte del PoS.
 */
export function jornadaActualCR(ahora: Date = new Date()): string {
  const cr = new Date(ahora.getTime() - 6 * 3_600_000 - HORA_CORTE_JORNADA * 3_600_000)
  return cr.toISOString().slice(0, 10)
}

/** ¿La jornada que se está mirando es la de hoy? Solo entonces hay "en vivo" que refrescar. */
export function esJornadaEnCurso(fecha: string, ahora: Date = new Date()): boolean {
  return fecha === jornadaActualCR(ahora)
}

// ── La carga (I/O) ─────────────────────────────────────────────────────────────────────────

/**
 * Misma firma que el mock (más una fecha opcional): la pantalla no se entera del resto.
 *
 * `fecha` permite mirar CUALQUIER jornada ya cargada — es lo que hace falta para cuadrar
 * contra el reporte del PoS sin esperar a que el día de hoy tenga ventas. Sin fecha, la
 * jornada en curso.
 *
 * **Nunca simula.** Un día sin ventas devuelve un snapshot en cero, y la pantalla lo dice.
 */
export async function getSnapshotEnVivo(local: LocalId, fecha?: string): Promise<SnapshotEnVivo> {
  const ahora = new Date()
  const jornada = fecha ?? jornadaActualCR(ahora)
  const enCurso = esJornadaEnCurso(jornada, ahora)

  const tickets = await getTicketsJornada(local, jornada)
  const lineas  = await getLineasDeTickets(tickets.map(t => t.id))
  const nombres = await getSaloneroNombres()
  const neto4Sem = await getNetoPorJornada(local, jornadasComparables(jornada))
  // El snapshot de mesas abiertas es de AHORA: mirando un día viejo no significa nada.
  const abiertas = enCurso ? await getMesasAbiertas(local) : []

  const snap = armarSnapshot({
    local, fecha: jornada, tickets, lineas, neto4Sem, ahora, enServicio: enCurso, nombres,
  })
  return {
    ...snap,
    mesasAbiertas: enCurso ? abiertas.length : undefined,
    paxAbierto:    enCurso ? abiertas.reduce((s, m) => s + n(m.pax), 0) : undefined,
  }
}

export { horaCorteCR, businessDateDe }
export const REFRESH_MS = 30_000
