// ── PoS "Nube de Fuego" (SQL Server, base `ndf`) → forma del dashboard ──────────
//
// Módulo PURO: sin I/O, sin driver, sin Supabase, sin reloj. Toda la lógica de
// dominio del PoS (canal, salonero, turno, servicio 10%, pax, familias, total)
// vive acá y en ningún otro lado: hoy lo importa el extractor local
// (`pos-bridge/`) y mañana lo importa el Edge de ingesta (A2) sin reescribirse.
//
// Fase 1a: el total es PROVISORIO (suma de medios de pago en colones) hasta que un
// día real cuadre contra el Excel. Ver `pos-bridge/README.md`.

// Extensiones explícitas (`.ts`) a propósito, en contra de la convención del resto de
// `src/`: este módulo lo importa TAMBIÉN el Edge `ingest-ndf`, que corre en Deno y ahí
// el import sin extensión no resuelve. Vite y vitest resuelven las dos formas
// (`allowImportingTsExtensions` en tsconfig.app.json), así que la app no cambia.
import type { CajeroDay, DiaData, SaloneroDay } from '../types/ventas.ts'
import { isCajeroName } from '../utils/index.ts'

// ── Vocabulario ────────────────────────────────────────────────────────────────

/** Canal de venta. `area` se guarda cruda y NO decide el canal en v1. */
export type Canal = 'barra' | 'delivery' | 'salon' | 'llevar' | 'otro'

/** `C` cerrada (venta), `X` anulada (no suma), `R` rara (se ignora del día). */
export type EstadoFactura = 'C' | 'X' | 'R'

export type PaxAlerta = 'ok' | 'falta_nativo' | 'falta_articulo' | 'difiere' | 'sin_pax'

/** Corte del Excel: caja de la mañana / caja de la noche. */
export type Turno = 'mañana' | 'noche'

/** Quién registró el pedido. Solo `salonero` entra al breakdown de mesero. */
export type RegistradoPor = 'salonero' | 'cajero' | 'sistema' | 'sin_pedido'

/**
 * De dónde sale el total del ticket. Hoy solo hay una fuente: la suma de los medios
 * de pago en colones. Cuando Ismael cuadre una factura con efectivo + dólares se
 * podrá agregar `'fiscal'` sin tocar a los consumidores del tipo.
 */
export type TotalFuente = 'provisorio'

/** Cuando la factura no tiene pedido (histórico 2024) no hay salonero: se tolera. */
export const SIN_SALONERO = '(sin salonero)'

// ── Logins del PoS ─────────────────────────────────────────────────────────────

/**
 * Cajeros del PoS. NO son saloneros y sus facturas NO se filtran del total: van a
 * la línea aparte "registrado por cajero (111/222)".
 *   · 111 = cajero turno mañana (abre y cierra ~11:00–16:00)
 *   · 222 = cajero turno noche  (post-cierre de la mañana → cierre del día)
 */
export const LOGIN_CAJERO_MANANA = '111'
export const LOGIN_CAJERO_NOCHE  = '222'

/**
 * `022` figura como "cajero turno tarde" en el maestro, pero puede ser un usuario
 * viejo: hasta confirmarlo NO se mezcla con 111/222 y se trata como salonero (sale
 * en el breakdown, marcado). Ver `pos-bridge/README.md`.
 */
export const LOGIN_CAJERO_TARDE_SIN_CONFIRMAR = '022'

/**
 * Logins de sistema: fuera del breakdown de mesero, NUNCA fuera del total.
 *   · 002 = cocina express · 01 / 02 = bajas
 */
export const LOGINS_SISTEMA = ['002', '01', '02'] as const

/** Maestro de saloneros conocido. Solo para mostrar cuando `FAC_Empleados` no da nombre. */
export const SALONEROS_CONOCIDOS: Record<string, string> = {
  '023': 'ESTEBAN',
  '024': 'JUANCHO',
  '025': 'DOLORES',
  '026': 'MAXO',
  '027': 'GUILLE',
  '028': 'FRANCISCO',
}

/**
 * Hora de corte mañana/noche cuando el registra NO es 111/222 (o sea: cuando hay
 * que derivar el turno del reloj). El cajero de la mañana cierra ~16:00.
 * PROVISORIO: el turno real lo dan 111/222; esto es solo el relleno.
 */
export const HORA_CORTE_TURNO = 16

/** Nombre con el que las facturas del cajero entran a `DiaData.saloneros`. */
export const CLAVE_CAJERO: Record<Turno, string> = {
  'mañana': 'Cajero turno mañana',
  'noche':  'Cajero turno noche',
}

/** Nombre con el que entran las facturas de un login de sistema. */
export const CLAVE_SISTEMA = '(sistema)'

// ── Familias (FAC_Clasificaciones) ─────────────────────────────────────────────
// Los ids son los de la base `ndf`. Cambiarlos acá cambia el mix en todos lados.

export const FAMILIAS_COMIDA    = [2, 3, 4, 6, 13, 16] as const
export const FAMILIA_BEBIDA     = 5
export const FAMILIA_GIFT_CARDS = 12
export const FAMILIA_CORTESIAS  = 17
export const FAMILIA_PAX        = 19
export const FAMILIA_INGREDIENT = 20
export const FAMILIA_EXTRAS     = 22
export const FAMILIA_DUENOS     = 28
export const FAMILIAS_MERCH     = [21, 23, 24, 26, 27] as const

/** Códigos de producto que ACREDITAN pax. Son venta real, no el artículo 192. */
export const COD_PAX_1 = '677'   // 1 persona
export const COD_PAX_2 = '678'   // 2 personas

export type CategoriaMix =
  | 'comida' | 'bebida' | 'pax' | 'ingredientes' | 'extras'
  | 'giftcard' | 'merch' | 'cortesia' | 'duenos' | 'otro'

// ── Coerción ───────────────────────────────────────────────────────────────────
// El driver puede devolver `null`, `number` o `string` según la columna y la
// versión de tedious. Nada de `Number(x)` suelto: un NaN silencioso arruina el día.

/** Cualquier cosa → número finito. `null`/`undefined`/basura → 0 (el COALESCE). */
export function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'bigint') return Number(v)
  if (typeof v === 'string') {
    const n = Number(v.trim())
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

/** Cualquier cosa → entero >= 0. Para cantidades y personas. */
export function entero(v: unknown): number {
  const n = Math.round(num(v))
  return n > 0 ? n : 0
}

/** Id de familia como número, o `null` si no se pudo determinar. */
export function familiaId(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(typeof v === 'string' ? v.trim() : v)
  return Number.isInteger(n) ? n : null
}

/** Texto limpio o `null`. Nunca `undefined`, nunca `''`. */
export function texto(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

const redondear = (n: number): number => Math.round(n * 100) / 100

// ── mapCanal ───────────────────────────────────────────────────────────────────

/**
 * `FAC_Pedidos.Tipo` → canal. Provisorio (v1): B barra · D delivery · M salón ·
 * L llevar · P/E/otro/null → otro.
 *
 * `_area` se acepta a propósito y NO se usa: en v1 el área se guarda CRUDA y no
 * decide el canal. El parámetro existe para que la firma no cambie cuando (y si)
 * el área entre a la decisión.
 */
// `_area` es parte del contrato a propósito (ver arriba): se acepta y no se usa.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function mapCanal(tipo: string | null | undefined, _area?: string | null): Canal {
  switch ((tipo ?? '').trim().toUpperCase()) {
    case 'B': return 'barra'
    case 'D': return 'delivery'
    case 'M': return 'salon'
    case 'L': return 'llevar'
    default:  return 'otro'
  }
}

// ── Salonero, cajero de turno y turno ──────────────────────────────────────────

/** `111` / `222`: los dos cajeros del PoS. `022` NO entra hasta confirmarlo. */
export function esCajeroTurno(login: unknown): boolean {
  const l = texto(login)
  return l === LOGIN_CAJERO_MANANA || l === LOGIN_CAJERO_NOCHE
}

/** Login de sistema (`002` cocina express, `01`/`02` bajas). */
export function esLoginSistema(login: unknown): boolean {
  const l = texto(login)
  return l !== null && (LOGINS_SISTEMA as readonly string[]).includes(l)
}

/**
 * `FAC_Pedidos.UsuarioRegistra` → login del salonero, o `null`.
 *
 * `null` cuando registró un cajero de turno (111/222), un login de sistema, o
 * cuando no hay pedido. La factura SIGUE contando en el día: lo único que pasa es
 * que no se le acredita a ningún mesero. **No se adivina el mesero por la mesa.**
 */
export function mapSalonero(usuarioRegistra: unknown): string | null {
  const l = texto(usuarioRegistra)
  if (l === null) return null
  if (esCajeroTurno(l)) return null
  if (esLoginSistema(l)) return null
  return l
}

export interface TurnoInput {
  /** El login que decide el turno: 111 → mañana, 222 → noche. */
  cajeroLogin?: unknown
  /** `FechaRegistra` naive (hora CR). Solo se usa si el login no es 111/222. */
  fechaRegistra?: string | null
}

/**
 * Turno de caja del ticket (el corte mañana/noche del Excel).
 *
 * `111` → mañana y `222` → noche mandan siempre. Si registró un salonero, se
 * deriva de la HORA (naive = hora de Costa Rica, sin convertir). Esto sirve para
 * saber quién tenía la caja; **no** para inventar el mesero.
 */
export function mapTurno(input: TurnoInput): Turno {
  const l = texto(input.cajeroLogin)
  if (l === LOGIN_CAJERO_MANANA) return 'mañana'
  if (l === LOGIN_CAJERO_NOCHE)  return 'noche'
  const { hora } = partirFechaHora(input.fechaRegistra)
  if (hora === '') return 'noche'   // sin hora legible: se asume el cierre del día
  const h = Number(hora.slice(0, 2))
  return Number.isInteger(h) && h < HORA_CORTE_TURNO ? 'mañana' : 'noche'
}

// ── Servicio 10% ───────────────────────────────────────────────────────────────

/**
 * `con_servicio` de la factura = `SUM(ImpS del detalle) > 0`.
 *
 * Es la partición que usa el Excel: **con 10%** = consumo en salón · **sin 10%** =
 * delivery / llevar. El cuadre PRIMARIO de la Fase 1a se hace contra estos dos
 * subtotales, así que esta función es la bisagra del día.
 */
export function conServicio(sumImpS: unknown): boolean {
  return num(sumImpS) > 0
}

// ── mapPax ─────────────────────────────────────────────────────────────────────

export interface PaxInput {
  /** `FAC_Pedidos.Personas` — hoy 0 en 24.054 de 24.054 pedidos. */
  personas?: unknown
  /** Unidades del código 677 (1 persona). */
  qty677?: unknown
  /** Unidades del código 678 (2 personas). */
  qty678?: unknown
}

export interface PaxResuelto {
  pax:          number
  pax_nativo:   number
  pax_articulo: number
  pax_alerta:   PaxAlerta
}

/**
 * Las dos fuentes de pax del PoS, resueltas a UNA. **Nunca se suman**: son dos
 * mediciones de lo mismo y sumarlas duplicaría la mesa. El nativo manda cuando
 * está; el artículo cubre el hueco de hoy (nativo siempre 0).
 *
 * Los tres valores viajan juntos a propósito: el dry-run los imprime los tres para
 * poder exigirle el campo al personal con el dato en la mano.
 */
export function mapPax(input: PaxInput): PaxResuelto {
  const pax_nativo   = entero(input.personas)
  const pax_articulo = entero(input.qty677) * 1 + entero(input.qty678) * 2

  if (pax_nativo === 0 && pax_articulo > 0) {
    return { pax: pax_articulo, pax_nativo, pax_articulo, pax_alerta: 'falta_nativo' }
  }
  if (pax_nativo > 0 && pax_articulo === 0) {
    return { pax: pax_nativo, pax_nativo, pax_articulo, pax_alerta: 'falta_articulo' }
  }
  if (pax_nativo > 0 && pax_articulo > 0) {
    return {
      pax: pax_nativo,
      pax_nativo,
      pax_articulo,
      pax_alerta: pax_nativo === pax_articulo ? 'ok' : 'difiere',
    }
  }
  return { pax: 0, pax_nativo: 0, pax_articulo: 0, pax_alerta: 'sin_pax' }
}

// ── mapFamiliaFlags ────────────────────────────────────────────────────────────

export interface FamiliaFlags {
  es_pax:      boolean
  es_extra:    boolean
  es_cortesia: boolean
}

/** Banderas de la familia de un ítem: 19 A PAX · 22 EXTRAS · 17 Cortesías. */
export function mapFamiliaFlags(familia: unknown): FamiliaFlags {
  const id = familiaId(familia)
  return {
    es_pax:      id === FAMILIA_PAX,
    es_extra:    id === FAMILIA_EXTRAS,
    es_cortesia: id === FAMILIA_CORTESIAS,
  }
}

/**
 * Familia → categoría del mix. Solo `comida` y `bebida` son ingreso; el resto se
 * muestra aparte para que el mix cierre y nadie infle la venta con extras, PAX,
 * ingredientes, gift cards ni merch. Cortesías (17) y Dueños (28) no son venta.
 */
export function mapCategoria(familia: unknown): CategoriaMix {
  const id = familiaId(familia)
  if (id === null) return 'otro'
  if ((FAMILIAS_COMIDA as readonly number[]).includes(id)) return 'comida'
  if ((FAMILIAS_MERCH  as readonly number[]).includes(id)) return 'merch'
  switch (id) {
    case FAMILIA_BEBIDA:     return 'bebida'
    case FAMILIA_PAX:        return 'pax'
    case FAMILIA_INGREDIENT: return 'ingredientes'
    case FAMILIA_EXTRAS:     return 'extras'
    case FAMILIA_GIFT_CARDS: return 'giftcard'
    case FAMILIA_CORTESIAS:  return 'cortesia'
    case FAMILIA_DUENOS:     return 'duenos'
    default:                 return 'otro'
  }
}

/** Las únicas categorías que suman al ingreso del día. */
export function esIngreso(cat: CategoriaMix): boolean {
  return cat === 'comida' || cat === 'bebida'
}

// ── mapEstado ──────────────────────────────────────────────────────────────────

/** Solo `C|X|R` son estados conocidos. Cualquier otra cosa → `null` (se reporta). */
export function mapEstado(e: string | null | undefined): EstadoFactura | null {
  const s = (e ?? '').trim().toUpperCase()
  return s === 'C' || s === 'X' || s === 'R' ? s : null
}

// ── mapTotalProvisorio ─────────────────────────────────────────────────────────

export interface MediosPago {
  efectivo?:         unknown
  tarjeta?:          unknown
  montoElectronico?: unknown
  deposito?:         unknown
  cheque?:           unknown
  cuentaCobrar?:     unknown
  /** Informativos: el PoS YA los convirtió a colones. NO entran al total. */
  dolaresEfectivo?:  unknown
  dolaresTarjeta?:   unknown
  /** `Efectivo` viene CON el vuelto adentro: se RESTA del total. */
  vuelto?:           unknown
}

/**
 * Total del ticket en COLONES. Los campos vienen NULL en la base → COALESCE a 0.
 *
 * El **vuelto se resta**: el cuadre contra el reporte oficial del PoS ("Ventas Netas
 * por Día", 1-sep-2026) mostró que `Efectivo` viene con el vuelto adentro — o sea,
 * con lo que el cliente entregó, no con lo que quedó en la caja.
 *
 * Los dólares NO se suman (el PoS ya los convirtió a colones y sumarlos contaría
 * doble); se imprimen igual en el dry-run para poder cuadrarlos.
 */
export function mapTotalProvisorio(medios: MediosPago): number {
  return redondear(
    num(medios.efectivo) +
    num(medios.tarjeta) +
    num(medios.montoElectronico) +
    num(medios.deposito) +
    num(medios.cheque) +
    num(medios.cuentaCobrar) -
    num(medios.vuelto),
  )
}

// ── Ticket ─────────────────────────────────────────────────────────────────────

/** Una línea de `FAC_FacturasDet` ya resuelta contra Productos/Clasificaciones. */
export interface ItemCrudo {
  codigo:         unknown
  nombre:         unknown
  cantidad:       unknown
  monto:          unknown
  familia:        unknown
  familia_nombre: unknown
  /** `ImpS` de la línea: impuesto de servicio 10%. */
  impS?:          unknown
  /** `EsExtra`/`Compuesto` del detalle: la línea NO cuenta como unidad vendida. */
  no_cuenta_unidad?: boolean
}

/** Una factura del día, tal como sale del SELECT (sin interpretar). */
export interface TicketCrudo {
  /** SIEMPRE string: `NumeroFactura` es decimal y `Number` pierde precisión. */
  numero_factura:   string
  /** `FechaRegistra` cruda, naive = hora de Costa Rica. NO se convierte a UTC. */
  fecha_hora:       string
  estado:           string | null
  tipo:             unknown
  area:             unknown
  /** `FAC_Facturas.Login` = cajero que cobró. Informativo; no pisa al salonero. */
  login_cajero:     unknown
  /** `FAC_Pedidos.UsuarioRegistra` (LOGIN, p. ej. `026`; o `111`/`222`). */
  usuario_registra: unknown
  /** Nombre desde `FAC_Empleados`. */
  salonero_nombre:  unknown
  /** `FAC_Pedidos.Personas` (sumado si la factura consolidó varios pedidos). */
  personas:         unknown
  /** `SUM(ImpS)` del detalle. Si viene de la consulta, gana sobre la suma de ítems. */
  imp_servicio?:    unknown
  /** Cuántos pedidos trae la factura, y si hay más de un salonero. */
  pedidos?:         number
  saloneros_varios?: boolean
  medios:           MediosPago
  items:            ItemCrudo[]
}

export interface ItemMapeado {
  codigo:         string | null
  nombre:         string
  cantidad:       number
  monto:          number
  imp_servicio:   number
  familia:        number | null
  familia_nombre: string | null
  categoria:      CategoriaMix
  es_pax:         boolean
  es_extra:       boolean
  es_cortesia:    boolean
}

export interface TicketMapeado {
  numero_factura:  string
  fecha:           string          // YYYY-MM-DD (hora CR)
  hora:            string          // HH:MM:SS  (hora CR)
  estado:          EstadoFactura | null
  canal:           Canal
  /** Cruda, sin interpretar: en v1 no decide el canal. */
  area:            string | null
  /** El login que registró el pedido, tal cual (incluye 111/222 y sistema). */
  usuario_registra: string | null
  /** Solo si es un mesero de verdad. `null` para cajero/sistema/sin pedido. */
  salonero_login:  string | null
  salonero_nombre: string | null
  /** Clave con la que aparece en `DiaData.saloneros`. */
  salonero:        string
  registrado_por:  RegistradoPor
  login_cajero:    string | null
  turno:           Turno
  con_servicio:    boolean
  imp_servicio:    number
  pedidos:         number
  saloneros_varios: boolean
  pax:             number
  pax_nativo:      number
  pax_articulo:    number
  pax_alerta:      PaxAlerta
  total:           number
  total_fuente:    TotalFuente
  medios:          Record<string, number>
  comida:          number
  bebida:          number
  unidades_comida: number
  unidades_bebida: number
  /** Aparte: NO son venta. */
  cortesias:       number
  duenos:          number
  items:           ItemMapeado[]
}

/** `'2026-09-01 19:42:07'` → `{ fecha, hora }`. Naive: no se toca la zona. */
export function partirFechaHora(v: string | null | undefined): { fecha: string; hora: string } {
  const s = (v ?? '').trim().replace('T', ' ')
  const [fecha = '', resto = ''] = s.split(' ')
  return { fecha, hora: resto.slice(0, 8) }
}

/** Factura cruda → factura interpretada. Puro: mismo input, mismo output. */
export function mapTicket(t: TicketCrudo): TicketMapeado {
  const { fecha, hora } = partirFechaHora(t.fecha_hora)

  const items: ItemMapeado[] = t.items.map(it => {
    const familia = familiaId(it.familia)
    return {
      codigo:         texto(it.codigo),
      nombre:         texto(it.nombre) ?? texto(it.codigo) ?? '(sin nombre)',
      cantidad:       entero(it.cantidad),
      monto:          redondear(num(it.monto)),
      imp_servicio:   redondear(num(it.impS)),
      familia,
      familia_nombre: texto(it.familia_nombre),
      categoria:      mapCategoria(familia),
      ...mapFamiliaFlags(familia),
    }
  })

  // Pax por artículo: unidades de 677 y 678. Se cuentan por CÓDIGO, no por familia:
  // la familia 19 tiene más artículos y no todos acreditan pax.
  const qtyCodigo = (cod: string): number =>
    items.reduce((s, it) => (it.codigo === cod ? s + it.cantidad : s), 0)

  const pax = mapPax({
    personas: t.personas,
    qty677:   qtyCodigo(COD_PAX_1),
    qty678:   qtyCodigo(COD_PAX_2),
  })

  let comida = 0, bebida = 0, unidades_comida = 0, unidades_bebida = 0
  let cortesias = 0, duenos = 0
  items.forEach((it, i) => {
    // `EsExtra`/`Compuesto`: la línea vale plata pero NO es una unidad vendida.
    const unidad = t.items[i]?.no_cuenta_unidad === true ? 0 : it.cantidad
    if (it.categoria === 'comida')   { comida += it.monto; unidades_comida += unidad }
    if (it.categoria === 'bebida')   { bebida += it.monto; unidades_bebida += unidad }
    if (it.categoria === 'cortesia') { cortesias += it.monto }
    if (it.categoria === 'duenos')   { duenos += it.monto }
  })

  // El SUM(ImpS) de la consulta manda; si no vino, se suma línea por línea.
  const imp_servicio = redondear(
    t.imp_servicio === undefined || t.imp_servicio === null
      ? items.reduce((s, it) => s + it.imp_servicio, 0)
      : num(t.imp_servicio),
  )

  const registra = texto(t.usuario_registra)
  const cajero   = texto(t.login_cajero)
  const salonero_login = mapSalonero(registra)
  // El turno lo decide 111/222 mire donde mire; si ninguno lo es, manda el reloj.
  const loginTurno = [cajero, registra].find(esCajeroTurno) ?? cajero ?? registra
  const turno = mapTurno({ cajeroLogin: loginTurno, fechaRegistra: t.fecha_hora })

  const registrado_por: RegistradoPor =
    salonero_login !== null ? 'salonero'
    : esCajeroTurno(registra) ? 'cajero'
    : esLoginSistema(registra) ? 'sistema'
    : 'sin_pedido'

  const nombre = texto(t.salonero_nombre)
    ?? (salonero_login !== null ? SALONEROS_CONOCIDOS[salonero_login] ?? null : null)

  const salonero =
    registrado_por === 'salonero' ? (nombre ?? salonero_login ?? SIN_SALONERO)
    : registrado_por === 'cajero' ? CLAVE_CAJERO[turno]
    : registrado_por === 'sistema' ? CLAVE_SISTEMA
    : SIN_SALONERO

  return {
    numero_factura:   String(t.numero_factura),
    fecha,
    hora,
    estado:           mapEstado(t.estado),
    canal:            mapCanal(texto(t.tipo), texto(t.area)),
    area:             texto(t.area),
    usuario_registra: registra,
    salonero_login,
    salonero_nombre:  registrado_por === 'salonero' ? nombre : null,
    salonero,
    registrado_por,
    login_cajero:     cajero,
    turno,
    con_servicio:     conServicio(imp_servicio),
    imp_servicio,
    pedidos:          entero(t.pedidos ?? 0),
    saloneros_varios: t.saloneros_varios === true,
    ...pax,
    total:            mapTotalProvisorio(t.medios),
    total_fuente:     'provisorio',
    medios: {
      efectivo:          num(t.medios.efectivo),
      tarjeta:           num(t.medios.tarjeta),
      monto_electronico: num(t.medios.montoElectronico),
      deposito:          num(t.medios.deposito),
      cheque:            num(t.medios.cheque),
      cuenta_cobrar:     num(t.medios.cuentaCobrar),
      dolares_efectivo:  num(t.medios.dolaresEfectivo),
      dolares_tarjeta:   num(t.medios.dolaresTarjeta),
      vuelto:            num(t.medios.vuelto),
    },
    comida:          redondear(comida),
    bebida:          redondear(bebida),
    unidades_comida,
    unidades_bebida,
    cortesias:       redondear(cortesias),
    duenos:          redondear(duenos),
    items,
  }
}

// ── DiaData ────────────────────────────────────────────────────────────────────

export interface OpcionesDia {
  /** Identidad del origen. Por defecto `ndf <fecha>` (el .xls trae el nombre real). */
  fileName?:   string
  /** `todayCR()` lo pone el llamador: este módulo no mira el reloj. */
  uploadedAt:  string
}

/** Las claves que van por la rama `CajeroDay` de `DiaData`. */
function esClaveCajero(nombre: string): boolean {
  return isCajeroName(nombre)
    || nombre === CLAVE_CAJERO['mañana']
    || nombre === CLAVE_CAJERO['noche']
}

/**
 * Facturas del día → la MISMA forma que produce `xlsParser.parseVentasFile()`, para
 * que el cuadre contra el Excel sea campo a campo y el dashboard no distinga origen.
 *
 * Diferencia deliberada con el .xls: el parser del Excel descarta al salonero sin
 * `pax` o sin `total`. Acá NO se descarta a nadie — hoy `Personas` viene 0 en toda
 * la base y descartar dejaría el día en cero. El pax faltante se ve en las alertas.
 */
export function construirDiaData(
  fecha: string,
  tickets: TicketMapeado[],
  opciones: OpcionesDia,
): DiaData {
  const saloneros: Record<string, SaloneroDay | CajeroDay> = {}

  const porSalonero = new Map<string, TicketMapeado[]>()
  for (const t of tickets) {
    const lista = porSalonero.get(t.salonero)
    if (lista) lista.push(t)
    else porSalonero.set(t.salonero, [t])
  }

  for (const [nombre, propios] of porSalonero) {
    const prodMap = new Map<string, { q: number; m: number }>()
    for (const t of propios) {
      for (const it of t.items) {
        const clave = it.nombre.toUpperCase()
        const acc = prodMap.get(clave) ?? { q: 0, m: 0 }
        acc.q += it.cantidad
        acc.m += it.monto
        prodMap.set(clave, acc)
      }
    }
    const prods: [string, number, number][] = [...prodMap.entries()]
      .sort((a, b) => b[1].m - a[1].m)
      .map(([n, { q, m }]) => [n, q, Math.round(m)])

    const total = redondear(propios.reduce((s, t) => s + t.total, 0))
    const com   = redondear(propios.reduce((s, t) => s + t.comida, 0))
    const beb   = redondear(propios.reduce((s, t) => s + t.bebida, 0))
    const serv  = redondear(propios.reduce((s, t) => s + t.imp_servicio, 0))
    const iCom  = propios.reduce((s, t) => s + t.unidades_comida, 0)
    const iBeb  = propios.reduce((s, t) => s + t.unidades_bebida, 0)
    const pax   = propios.reduce((s, t) => s + t.pax, 0)

    // `iva` queda en 0: la Fase 1a NO toca impuestos de venta. `serv` SÍ sale del
    // dato real (`SUM(ImpS)`), que es lo que parte el día en con 10% / sin 10%.
    if (esClaveCajero(nombre)) {
      const delivery = redondear(propios.filter(t => t.canal === 'delivery').reduce((s, t) => s + t.total, 0))
      saloneros[nombre] = {
        esCajero:   true,
        total,
        salon:      redondear(total - delivery),
        delivery,
        iva:        0,
        serv,
        ordenes:    propios.length,
        ticketProm: propios.length ? redondear(total / propios.length) : 0,
        prods,
      }
      continue
    }

    saloneros[nombre] = {
      pax, total, com, beb, iCom, iBeb,
      iva:        0,
      serv,
      promPax:    pax  ? total / pax  : 0,
      promPlato:  iCom ? com   / iCom : 0,
      promBebida: iBeb ? beb   / iBeb : 0,
      ratioCB:    beb  ? com   / beb  : 0,
      ratioU:     iBeb ? iCom  / iBeb : 0,
      bebPax:     pax  ? iBeb  / pax  : 0,
      prods,
    }
  }

  return {
    fileName:   opciones.fileName ?? `ndf ${fecha}`,
    uploadedAt: opciones.uploadedAt,
    saloneros,
  }
}
