import type { CajeroDay, DiaData, ProductMap, SaloneroDay } from '../../shared/types/ventas'
import {
  businessDateDe, getLineasDeTickets, getMesasAbiertas, getNetoPorJornada, getSaloneroNombres,
  getTicketsJornada, HORA_CORTE_JORNADA, type LineaNdfRow, type MesaAbiertaRow,
  type TicketNdfConId,
} from '../../shared/api/posNdf'
import {
  agruparEnLotes, etiquetaTurno, turnosConocidos, type Turno,
} from '../../shared/ndf/jornada'
import {
  esCajeroTurno, esLoginSistema, FAMILIAS_VALOR_SERVIDO, SALONEROS_CONOCIDOS,
} from '../../shared/ndf/mapTicket'
import { claveNoMesero, etiquetaNoMesero, etiquetaTurnoPoS } from './baldesNoMesero'
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
  29: 'GreenSeason',
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
  /**
   * Cuántas FACTURAS lleva cada clave de `dia.saloneros` (meseros, caja y sistema).
   *
   * `SaloneroDay` no tiene campo para las órdenes —el modelo del xls nunca las tuvo—, pero
   * `armarDia` ya las cuenta para poder sacar el ticket promedio de la caja. Se expone en vez
   * de recontarlas afuera, así el denominador del "neto ÷ órdenes" de cada mesero es el MISMO
   * número que usa la fila de caja.
   */
  ordenes:  Record<string, number>
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
      // El balde sale de (registrado_por, cajero que cobró, canal) — NO del login de la
      // factura. `cajero_login` es la CAJA que cerró, que es la que define el turno.
      : claveNoMesero(t.registrado_por, t.cajero_login, t.canal)
    const e = acc.get(clave) ?? {
      esCajero: !esMesero,
      pax: 0, total: 0, com: 0, beb: 0, iCom: 0, iBeb: 0, iva: 0, serv: 0,
      delivery: 0, ordenes: 0,
      prods: new Map<string, { q: number; m: number }>(),
    }
    e.pax     += paxDelTicket(t)
    e.total   += n(t.valor_servido_crc)   // el NETO — ver el bloque de arriba
    e.serv    += n(t.servicio_crc)
    e.iva     += n(t.iva_crc)
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
          // Todo lo de acá sale de la familia, no de una persona. Es un no-op para «En vivo»
          // (su multiplicador es 1, así que la cuenta da lo mismo por los dos caminos) pero
          // deja la marca coherente en el único lugar que la produce.
          tipoDeFamilia: true,
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
        // El pax VIAJA aunque el bucket sea de caja. En el PoS hay tickets de salón cobrados
        // bajo un login de caja; su plata siempre contó en el total del día, y tirar su pax
        // hacía que el día entero informara menos comensales de los que hubo. No compite con
        // nadie —`esCajero` lo saca igual del ranking—, pero suma al total.
        pax:        e.pax,
        total,
        salon:      total - delivery,
        delivery,
        iva: Math.round(e.iva), serv: Math.round(e.serv),
        ordenes:    e.ordenes,
        ticketProm: e.ordenes ? total / e.ordenes : 0,
        prods,
      }
      continue
    }

    saloneros[nombre] = {
      pax: e.pax, total, com: Math.round(e.com), beb: Math.round(e.beb),
      iCom: e.iCom, iBeb: e.iBeb,
      // IVA y servicio ATRIBUIDOS, los dos igual: Σ de los tickets de este salonero
      // (`iva_crc` / `servicio_crc`), tal como los informa el PoS. El IVA estaba clavado en 0
      // porque el bridge leía mal la columna y venía 0 en toda la base; con `IV` resuelto ya
      // trae el dato, y dejarlo en 0 acá hacía que `getDayStats` —que lee el IVA POR
      // SALONERO— calculara la bruta ~11% corta. NUNCA se deriva del 13%: se suma lo que vino.
      iva: Math.round(e.iva), serv: Math.round(e.serv),
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
    ordenes: Object.fromEntries([...acc.entries()].map(([k, v]) => [k, v.ordenes])),
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
  iva: number; serv: number; delivery: number; ordenes: number
  prods: Map<string, { q: number; m: number }>
}

/**
 * El login del PoS → cómo se muestra, en TRES CAPAS y en este orden:
 *
 *   1. `employees.pos_login` — el mapeo que mantiene el negocio en Empleados. Manda siempre:
 *      si alguien corrigió un nombre ahí, eso es lo que tiene que verse.
 *   2. `SALONEROS_CONOCIDOS` — el roster de `FAC_Empleados` que viaja con el código. Es el
 *      respaldo para el login que todavía nadie cargó en Empleados, y es lo que hace que la
 *      pantalla deje de mostrar números.
 *   3. El número **marcado** `«026 · sin asignar»` — cuando no está en ninguna de las dos. No
 *      se inventa un nombre y tampoco se lo esconde: sigue en el ranking, con la marca puesta,
 *      que es lo que hace visible el mapeo que falta.
 */
export function nombreSalonero(login: string, nombres: Record<string, string>): string {
  const deEmpleados = nombres[login]?.trim()
  if (deEmpleados) return deEmpleados
  const delRoster = SALONEROS_CONOCIDOS[login]?.trim()
  if (delRoster) return delRoster
  return `${login} · sin asignar`
}

/** ¿Este salonero quedó sin mapear a un empleado? */
export function esSinAsignar(clave: string): boolean {
  return clave.endsWith(' · sin asignar')
}

/**
 * Cuántas facturas y cuánto neto hay en cada turno **según el PoS** (el que decide 111/222).
 *
 * Es la otra lectura del mismo día: el corte de las 16:00 se calcula del reloj de cada ticket,
 * este sale de qué caja estaba abierta. Cuando las dos no coinciden hay algo que mirar.
 */
export function ventasPorTurnoPoS(tickets: TicketNdfConId[]): { turno: string; neto: number; tickets: number }[] {
  const acc = new Map<string, { neto: number; tickets: number }>()
  for (const t of tickets) {
    const k = etiquetaTurnoPoS(t.turno)
    const e = acc.get(k) ?? { neto: 0, tickets: 0 }
    e.neto += n(t.valor_servido_crc)
    e.tickets += 1
    acc.set(k, e)
  }
  return [...acc.entries()]
    .map(([turno, e]) => ({ turno, neto: Math.round(e.neto), tickets: e.tickets }))
    .sort((a, b) => b.neto - a.neto)
}

// Las etiquetas de turno y los baldes de no-mesero viven en `baldesNoMesero` (módulo PURO):
// las pantallas los necesitan y no pueden arrastrar el cliente de Supabase por eso. Se
// re-exportan acá para no romper a quien ya los importaba desde este módulo.
export {
  ETIQUETA_TURNO_POS, etiquetaTurnoPoS, claveNoMesero, etiquetaNoMesero,
  CLAVE_CAJERO_MANANA, CLAVE_CAJERO_TARDE, CLAVE_SALON_SIN_MESERO, CLAVE_SISTEMA_OTROS,
  CLAVES_CAJERO_TURNO,
} from './baldesNoMesero'


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
//
// ── LO QUE CAMBIÓ (P1a) ────────────────────────────────────────────────────────────────────
// Antes el turno salía del RELOJ: la jornada 07→07 partida a las 16:00 CR. Era un relleno
// mientras `fecha_cierra` venía NULL en toda la tabla. Ya no viene NULL: el PoS dice quién
// cerró la caja y cuándo, así que el turno lo define el CAJERO (`111` mañana · `222` tarde) y
// el día lo define la APERTURA del lote de cierre. La definición vive en `shared/ndf/jornada.ts`
// y la comparten esta pantalla y (en P1b) el adaptador, para que no puedan discrepar.
//
// El corte de las 16:00 murió acá. La mesa que se abre a las 15:50 y se cobra a las 16:30 ya no
// se decide por la hora: cuenta en el turno del cajero que la cobró.

export type { Turno } from '../../shared/ndf/jornada'

export interface BloqueTurno {
  /** Id del turno, del mapa de cajas. `null` en el bloque de las facturas sin caja conocida. */
  turno:    Turno | null
  etiqueta: string
  neto:     number
  tickets:  number
  pax:      number
}

export interface VentasTurno {
  /**
   * Un bloque por turno DEL MAPA, en el orden del mapa. Siempre están todos, aunque un turno
   * no haya vendido nada: la tabla tiene que ser estable entre jornadas.
   */
  turnos:   BloqueTurno[]
  /**
   * Las facturas que no cerró ninguna caja del mapa (login vacío, un salonero, un login de
   * sistema, o histórico). NO se reparten a ojo — pero SÍ cuentan en el total del día.
   */
  sinTurno: BloqueTurno
}

/**
 * Cuánto vendió cada turno, agrupando por LOTE de cierre.
 *
 * Los bloques salen del MAPA de cajas (`CAJAS_POR_LOGIN`): sumar una caja de barra o un
 * desayuno agrega su fila sola, sin tocar esta función ni la pantalla.
 *
 * Invariante: Σ turnos + sinTurno = el neto del día. Ninguna factura se cae por no tener turno.
 */
export function ventasPorTurno(tickets: TicketNdfConId[]): VentasTurno {
  const vacio = (turno: Turno | null, etiqueta: string): BloqueTurno =>
    ({ turno, etiqueta, neto: 0, tickets: 0, pax: 0 })

  const turnos = turnosConocidos().map(t => vacio(t.turno, t.etiqueta))
  const porId  = new Map(turnos.map(b => [b.turno, b]))
  const sinTurno = vacio(null, etiquetaTurno(null))

  for (const lote of agruparEnLotes(tickets)) {
    // Un turno que el mapa no conoce (login mapeado y después borrado del mapa) cae igual acá
    // en vez de perderse: el total del día manda sobre la prolijidad de la tabla.
    const b = (lote.turno !== null ? porId.get(lote.turno) : undefined) ?? sinTurno
    for (const t of lote.tickets) {
      b.neto    += n(t.valor_servido_crc)
      b.tickets += 1
      b.pax     += paxDelTicket(t)
    }
  }

  for (const b of [...turnos, sinTurno]) b.neto = Math.round(b.neto)
  return { turnos, sinTurno }
}

// ── El día PARTIDO POR TURNO ───────────────────────────────────────────────────────────────
//
// La partición que va a reusar el dashboard por empleado: **por turno + general**. Cada turno
// arma su propio `DiaData` con el MISMO `armarDia`, así que todo lo que sabe leer un `DiaData`
// (`aggSalonero`, `aggGeneral`, `getDayStats`, el mix) funciona igual sobre un turno suelto.
// Nada de agregadores nuevos: cambia el conjunto de tickets, no la matemática.

export interface DiaDeTurno {
  turno:    Turno | null
  etiqueta: string
  /** El día de ESE turno, con la misma forma que el día completo. */
  dia:      DiaData
  pm:       ProductMap
  /** Órdenes por clave de `dia.saloneros`, para el "neto ÷ órdenes" de cada mesero. */
  ordenes:  Record<string, number>
  neto:     number
  tickets:  number
  pax:      number
}

/**
 * La jornada partida en turnos, cada uno con su `DiaData` completo.
 *
 * Los turnos salen del MAPA de cajas y del lote de cierre (`shared/ndf/jornada.ts`), igual que
 * `ventasPorTurno`: un turno es una pasada de caja, no una franja horaria. Solo se devuelven
 * los turnos que efectivamente vendieron — una tabla con un turno en cero por cada caja del
 * mapa sería ruido.
 */
export function diasPorTurno(
  fecha: string,
  tickets: TicketNdfConId[],
  lineas: LineaNdfRow[],
  uploadedAt: string,
  nombres: Record<string, string> = {},
): DiaDeTurno[] {
  const porTurno = new Map<Turno | null, TicketNdfConId[]>()
  for (const lote of agruparEnLotes(tickets)) {
    const lista = porTurno.get(lote.turno)
    if (lista) lista.push(...lote.tickets)
    else porTurno.set(lote.turno, [...lote.tickets])
  }

  const lineasPorTicket = new Map<string, LineaNdfRow[]>()
  for (const l of lineas) {
    const lista = lineasPorTicket.get(l.ticket_id)
    if (lista) lista.push(l)
    else lineasPorTicket.set(l.ticket_id, [l])
  }

  const orden = new Map(turnosConocidos().map((t, i) => [t.turno, i]))
  const salida: DiaDeTurno[] = []
  for (const [turno, delTurno] of porTurno) {
    const suyas = delTurno.flatMap(t => lineasPorTicket.get(t.id) ?? [])
    const armado = armarDia(fecha, delTurno, suyas, uploadedAt, nombres)
    salida.push({
      turno,
      etiqueta: etiquetaTurno(turno),
      dia:      armado.dia,
      pm:       armado.pm,
      ordenes:  armado.ordenes,
      neto:     Math.round(Object.values(armado.dia.saloneros).reduce((a, v) => a + v.total, 0)),
      tickets:  delTurno.length,
      pax:      delTurno.reduce((a, t) => a + paxDelTicket(t), 0),
    })
  }
  // En el orden del mapa; lo que no está en el mapa (sin caja conocida), al final.
  return salida.sort((a, b) =>
    (orden.get(a.turno ?? '') ?? 99) - (orden.get(b.turno ?? '') ?? 99))
}

/**
 * Los lotes de cierre de la jornada que se está mirando, en orden de apertura.
 *
 * Es el detalle detrás del panel de turnos: cada fila es una pasada de caja real (quién cerró,
 * cuándo, cuántas facturas). Un lote nunca se parte entre dos turnos.
 */
export interface LoteResumen {
  clave:       string
  cajeroLogin: string | null
  turno:       Turno | null
  etiqueta:    string
  jornada:     string | null
  apertura:    string | null
  fechaCierra: string | null
  abierto:     boolean
  neto:        number
  tickets:     number
  pax:         number
}

export function lotesDeCierre(tickets: TicketNdfConId[]): LoteResumen[] {
  return agruparEnLotes(tickets).map(l => ({
    clave:       l.clave,
    cajeroLogin: l.cajeroLogin,
    turno:       l.turno,
    etiqueta:    etiquetaTurno(l.turno),
    jornada:     l.jornada,
    apertura:    l.apertura,
    fechaCierra: l.fechaCierra,
    abierto:     l.abierto,
    neto:        Math.round(l.tickets.reduce((s, t) => s + n(t.valor_servido_crc), 0)),
    tickets:     l.tickets.length,
    pax:         l.tickets.reduce((s, t) => s + paxDelTicket(t), 0),
  }))
}

// ── Mesas abiertas AHORA ───────────────────────────────────────────────────────────────────

export interface MesaAbiertaResumen {
  salonero: string
  mesas:    number
  pax:      number
}

/**
 * Lo que está abierto en este momento, agrupado por quién lo tiene.
 *
 * ⚠️ SIN MONTO, a propósito: `pos_ndf_open` todavía no trae lo consumido por mesa. Mostrar un
 * monto acá obligaría a inventarlo, y una mesa abierta con una cifra al lado se lee como venta.
 * // TODO monto: pendiente de columna en el bridge.
 */
export function resumirMesasAbiertas(
  abiertas: MesaAbiertaRow[],
  nombres: Record<string, string> = {},
): MesaAbiertaResumen[] {
  const acc = new Map<string, { mesas: number; pax: number }>()
  for (const m of abiertas) {
    const login = m.salonero_login
    const clave =
      login === null || login === ''      ? 'Sin salonero'
      : esCajeroTurno(login)              ? etiquetaNoMesero('cajero', login)
      : esLoginSistema(login)             ? etiquetaNoMesero('sistema', login)
      : nombreSalonero(login, nombres)
    const e = acc.get(clave) ?? { mesas: 0, pax: 0 }
    e.mesas += 1
    e.pax   += n(m.pax)
    acc.set(clave, e)
  }
  return [...acc.entries()]
    .map(([salonero, e]) => ({ salonero, mesas: e.mesas, pax: e.pax }))
    .sort((a, b) => b.mesas - a.mesas || a.salonero.localeCompare(b.salonero, 'es'))
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
    turnosPoS: ventasPorTurnoPoS(e.tickets),
    canales: armado.canales,
    // Órdenes por clave: el denominador del "neto ÷ órdenes" de cada mesero.
    ordenes: armado.ordenes,
    // La jornada partida por turno, cada uno con su `DiaData` completo.
    porTurno: diasPorTurno(e.fecha, e.tickets, e.lineas, e.ahora.toISOString(), e.nombres ?? {}),
  }
}

// ── Qué jornada se está mirando ────────────────────────────────────────────────────────────

/**
 * La jornada en curso, con la regla del negocio: **07:00 → 07:00 hora de Costa Rica**.
 *
 * ⚠️ P1a: esto YA NO define a qué jornada pertenece un ticket — eso lo decide el LOTE de cierre
 * (`shared/ndf/jornada.ts`). Lo que sigue haciendo es elegir QUÉ VENTANA se pide a la base y
 * cuál es el día que abre el selector, y para eso el 07→07 sirve: es un superset que contiene
 * los lotes del día (incluidas las facturas de después de medianoche). No se puede reemplazar
 * por la definición del lote sin caer en un círculo — habría que leer los tickets para saber
 * qué tickets pedir. Si algún día un cajero abriera antes de las 07:00 CR, su lote caería en la
 * ventana del día anterior; con los turnos reales (111 abre ~11:00) no pasa.
 *
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

/**
 * La jornada N días para adelante o para atrás. Es aritmética de CALENDARIO sobre la etiqueta
 * de la jornada (`YYYY-MM-DD`), no de instantes: la jornada anterior al 1-sep es el 31-ago,
 * dure lo que dure cada servicio. Se hace en UTC para que no la corra la zona del navegador.
 */
export function jornadaDesplazada(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split('-').map(Number)
  if (!y || !m || !d) return fecha
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10)
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
    abiertasPorSalonero: enCurso ? resumirMesasAbiertas(abiertas, nombres) : undefined,
  }
}

export { horaCorteCR, businessDateDe }
export const REFRESH_MS = 30_000
