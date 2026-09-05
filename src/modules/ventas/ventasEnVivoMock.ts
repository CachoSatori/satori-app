import type { CajeroDay, DiaData, ProductMap, SaloneroDay } from '../../shared/types/ventas'
import type { CalidadPax, ComparativaHistorico, LocalId, SnapshotEnVivo, VentaPorHora } from './ventasEnVivoTypes'
import { ARTICULO_PAX } from './ventasEnVivoTypes'

// ╔══════════════════════════════════════════════════════════════════════════════════════╗
// ║ Ventas · En vivo — EL PROVEEDOR MOCK (preliminar)                                      ║
// ╚══════════════════════════════════════════════════════════════════════════════════════╝
//
// ESTE ES EL ÚNICO ARCHIVO QUE SE REEMPLAZA para pasar a datos reales.
//
// La pestaña llama `getSnapshotEnVivo(local)` y no sabe de dónde sale. Cuando el pos-bridge
// esté cableado, esta función se convierte en una lectura de Supabase y la UI no cambia una
// línea. Por eso todo lo de acá adentro es privado salvo esa función.
//
// ── LO IMPORTANTE ──────────────────────────────────────────────────────────────────────────
// El mock arma un `DiaData` DE VERDAD: la misma forma que produce `xlsParser` y que guarda
// `ventas_dias`. Saloneros con `SaloneroDay`, cajero con `CajeroDay`, `prods` como
// `[nombre, qty, monto]`. Eso es lo que hace que «En vivo» y las pestañas de siempre hablen
// el mismo idioma — y es también la forma que el feed del PoS va a tener que producir.
//
// Y respeta la regla del artículo PAX: `prods` NUNCA trae `PAX`, igual que después de pasar
// por `xlsParser`.
//
// Los números son INVENTADOS pero plausibles: un sushi bar de playa, ticket ~₡25.000, servicio
// que arranca a las 17:00 y pica entre 19:00 y 21:00. Sirven para ver si la pantalla se lee
// bien, no para decidir nada. NO hay lógica de plata real: ni IVA ni servicio calculados por
// fórmula fiscal — los porcentajes de abajo son de relleno y no tocan `posFiscal`.

// ── Aleatorio DETERMINISTA ──────────────────────────────────────────────────────
// Un `Math.random()` suelto haría que cada refresco de 30 s repinte todo el gráfico y la
// pantalla parezca rota. Con una semilla derivada del local y de la hora, el mismo día a la
// misma hora da SIEMPRE lo mismo: se ve viva (avanza con el reloj) pero estable.
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function ruido(clave: string, amplitud: number): number {
  const n = (hash(clave) % 1000) / 1000
  return 1 + (n - 0.5) * 2 * amplitud
}

// ── El reloj de Costa Rica ──────────────────────────────────────────────────────
// UTC−6 FIJO, sin horario de verano. Misma regla que el biotime-bridge y la mig 059: si
// alguien mete una librería de zonas con DST, esto se rompe en agosto y nadie se entera.
const CR_OFFSET_MS = 6 * 3600_000

function ahoraCR(): Date {
  return new Date(Date.now() - CR_OFFSET_MS)
}

export function fechaHoyCR(): string {
  return ahoraCR().toISOString().slice(0, 10)
}

export function horaActualCR(): number {
  return ahoraCR().getUTCHours()
}

// ── La forma del servicio ───────────────────────────────────────────────────────
const CURVA_HORARIA: Record<number, number> = {
  11: 2, 12: 6, 13: 8, 14: 5, 15: 2, 16: 3,
  17: 7, 18: 11, 19: 16, 20: 17, 21: 12, 22: 7, 23: 3,
}

const HORA_APERTURA = 11
const HORA_CIERRE   = 23

/**
 * ── LA JORNADA DE SERVICIO, NO EL DÍA CIVIL ────────────────────────────────────────────
 * Entre la medianoche y la apertura no hay «día de hoy» que mostrar: el servicio que interesa
 * es el que acaba de terminar. Mismo criterio del corte de jornada que ya usa Salarios (059).
 */
export function servicioEnCursoCR(): boolean {
  const h = horaActualCR()
  return h >= HORA_APERTURA && h <= HORA_CIERRE
}

/** La fecha del servicio que se muestra: hoy en servicio, ayer si ya cerró. */
export function fechaServicioCR(): string {
  const d = ahoraCR()
  if (!servicioEnCursoCR()) d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/** La hora hasta la que hay datos: la actual en servicio, el cierre completo si ya terminó. */
export function horaCorteCR(): number {
  return servicioEnCursoCR() ? horaActualCR() : HORA_CIERRE
}

/** Cuánto del día ya pasó, según la curva: 0 antes de abrir, 1 con el servicio terminado. */
function fraccionTranscurrida(hora: number): number {
  const total = Object.values(CURVA_HORARIA).reduce((s, v) => s + v, 0)
  let acum = 0
  for (const [h, peso] of Object.entries(CURVA_HORARIA)) {
    if (Number(h) <= hora) acum += peso
  }
  return total > 0 ? acum / total : 0
}

const VENTA_DIA_COMPLETO: Record<LocalId, number> = {
  'santa-teresa': 1_850_000,
  'nosara':         980_000,
}

const TICKET_PROMEDIO_OBJETIVO: Record<LocalId, number> = {
  'santa-teresa': 26_000,
  'nosara':       23_000,
}

/** Del total del día, cuánto pasa por caja (delivery / mostrador). El resto es de salón. */
const PARTE_CAJERO = 0.18

// ── El catálogo del mock ────────────────────────────────────────────────────────
// Cada producto trae su `clasificacion` y `tipo`, porque el snapshot devuelve también un
// `ProductMap`: el mix por categoría se arma igual que en Mix Ventas, con `pm[nombre]`.
// Cuando el feed sea real, este `pm` se reemplaza por el que ya carga el módulo.
//
// ⚠ NO hay ninguna entrada `PAX` acá. El pax es un conteo de comensales, no un artículo del
//   mix — `xlsParser` lo saca, y el mock nace sin él.
interface ProdMock {
  nombre:        string
  clasificacion: string
  tipo:          'comida' | 'bebida'
  peso:          number
  precio:        number
}

const CATALOGO: ProdMock[] = [
  { nombre: 'ROLL SATORI',          clasificacion: 'SUSHI',    tipo: 'comida', peso: 100, precio: 11_500 },
  { nombre: 'ROLL TEMPURA CAMARON', clasificacion: 'SUSHI',    tipo: 'comida', peso:  86, precio: 12_000 },
  { nombre: 'SASHIMI MIXTO',        clasificacion: 'SUSHI',    tipo: 'comida', peso:  35, precio: 14_000 },
  { nombre: 'POKE BOWL ATUN',       clasificacion: 'COCINA',   tipo: 'comida', peso:  74, precio: 13_500 },
  { nombre: 'RAMEN TONKOTSU',       clasificacion: 'COCINA',   tipo: 'comida', peso:  47, precio: 12_800 },
  { nombre: 'GYOZAS (6)',           clasificacion: 'ENTRADAS', tipo: 'comida', peso:  62, precio:  5_800 },
  { nombre: 'IMPERIAL 350ML',       clasificacion: 'BEBIDAS',  tipo: 'bebida', peso:  58, precio:  3_200 },
  { nombre: 'AGUA 600ML',           clasificacion: 'BEBIDAS',  tipo: 'bebida', peso:  30, precio:  1_800 },
  { nombre: 'MARGARITA MARACUYA',   clasificacion: 'COCTELES', tipo: 'bebida', peso:  41, precio:  7_200 },
  { nombre: 'MOCHI (2)',            clasificacion: 'POSTRES',  tipo: 'comida', peso:  22, precio:  4_800 },
]

const PM_MOCK: ProductMap = Object.fromEntries(
  CATALOGO.map(p => [p.nombre, {
    tipo:             p.tipo,
    clasificacion:    p.clasificacion,
    subclasificacion: '',
    multiplicador:    1,
    costo_unitario:   0,
  }]),
)

const SALONEROS = ['FRAN', 'MAXO', 'NACHO', 'INE']
const CAJERO    = 'CAJERO TURNO TARDE'   // `isCajeroName` lo reconoce como caja, no como mesero

// ── Las piezas ──────────────────────────────────────────────────────────────────

function armarPorHora(local: LocalId, fecha: string, hora: number): VentaPorHora[] {
  const totalPesos = Object.values(CURVA_HORARIA).reduce((s, v) => s + v, 0)
  const ventaDia   = VENTA_DIA_COMPLETO[local]
  const ticketProm = TICKET_PROMEDIO_OBJETIVO[local]

  const out: VentaPorHora[] = []
  for (let h = HORA_APERTURA; h <= HORA_CIERRE; h++) {
    // Las horas que todavía no llegaron van en 0: el gráfico muestra el día a medias, no un
    // día completo inventado.
    if (h > hora) { out.push({ hora: h, monto: 0, tickets: 0 }); continue }
    const peso  = CURVA_HORARIA[h] ?? 0
    const monto = Math.round((ventaDia * peso / totalPesos) * ruido(`${local}|${fecha}|h${h}`, 0.18))
    out.push({ hora: h, monto, tickets: Math.max(0, Math.round(monto / ticketProm)) })
  }
  return out
}

/**
 * Reparte un entero según pesos, de forma que la suma dé EXACTAMENTE el total.
 *
 * No es una sutileza: si cada parte se redondea por su cuenta, la suma queda unos miles
 * arriba o abajo, y entonces el KPI de venta neta (que sale de `getDayStats`) no coincide
 * con la suma del gráfico por hora. Dos números distintos para lo mismo en la misma
 * pantalla, y ninguna forma de saber cuál vale. El resto de la división se le da a la
 * parte más grande, donde un colón no se nota.
 */
function repartirEntero(total: number, pesos: number[]): number[] {
  const suma = pesos.reduce((s, p) => s + p, 0)
  if (suma <= 0 || total <= 0) return pesos.map(() => 0)
  const partes = pesos.map(p => Math.round((total * p) / suma))
  const diff = total - partes.reduce((s, p) => s + p, 0)
  if (diff !== 0) {
    let mayor = 0
    for (let i = 1; i < partes.length; i++) if (partes[i] > partes[mayor]) mayor = i
    partes[mayor] += diff
  }
  return partes
}

/**
 * Reparte una venta entre los productos del catálogo → `prods` de `DiaData`.
 *
 * Los montos suman EXACTAMENTE `venta`, igual que en el xls real: ahí `total` es la suma de
 * los montos de las mismas filas de las que sale `prodMap`, así que el mix cierra contra el
 * total por construcción.
 *
 * ⚠️ Por eso una línea CON PLATA vale al menos 1 unidad. Redondear la cantidad a 0 y después
 * filtrarla le sacaba el monto a `prods` pero se lo dejaba a `total`, y el mix dejaba de cerrar.
 * Con una venta chica —la primera hora del servicio— TODAS las líneas caían en ese caso: el día
 * quedaba con total y sin un solo producto, que es un día que no puede existir.
 */
function armarProds(local: LocalId, fecha: string, quien: string, venta: number): [string, number, number][] {
  const pesos  = CATALOGO.map(p => p.peso * ruido(`${local}|${fecha}|${quien}|${p.nombre}`, 0.16))
  const montos = repartirEntero(venta, pesos)
  return CATALOGO
    .map((p, i): [string, number, number] =>
      [p.nombre, montos[i] > 0 ? Math.max(1, Math.round(montos[i] / p.precio)) : 0, montos[i]])
    .filter(([, q, m]) => q > 0 && m > 0)
    .sort((a, b) => b[2] - a[2])
}

/**
 * El día completo, en el modelo de siempre: 4 saloneros + 1 cajero.
 *
 * Saloneros y cajero son ADITIVOS, igual que en el xls real: `aggGeneral` hace
 * `totalRest = total(saloneros) + cajTotal`. El cajero es delivery y mostrador, no una copia
 * de las mesas.
 */
function armarDiaData(local: LocalId, fecha: string, ventaAcum: number, ticketsTotal: number): DiaData {
  const saloneros: Record<string, SaloneroDay | CajeroDay> = {}

  const ventaCaja  = Math.round(ventaAcum * PARTE_CAJERO)
  const ventaSalon = ventaAcum - ventaCaja

  // ── Los saloneros ──
  // El reparto es EXACTO: Σ totales de salón = `ventaSalon`, y con la caja cierra contra
  // `ventaAcum`, que es la suma del gráfico por hora. Ver `repartirEntero`.
  const pesos   = [0.31, 0.27, 0.23, 0.19].map((w, i) => w * ruido(`${local}|${fecha}|sal${i}`, 0.08))
  const totales = repartirEntero(ventaSalon, pesos)

  SALONEROS.forEach((nombre, i) => {
    const total = totales[i]
    if (total <= 0) return

    const prods = armarProds(local, fecha, nombre, total)
    // `com`/`beb` e `iCom`/`iBeb` salen del catálogo, con el mismo criterio que el xls: monto
    // y unidades separados por tipo de producto.
    let com = 0, beb = 0, iCom = 0, iBeb = 0
    for (const [pn, q, m] of prods) {
      if (PM_MOCK[pn]?.tipo === 'bebida') { beb += m; iBeb += q }
      else                                { com += m; iCom += q }
    }

    // ~2,4 comensales por ticket. El pax NO se deriva de la venta a propósito: en el PoS son
    // dos datos independientes, y por eso `CalidadPax` tiene sentido.
    const pax = Math.max(1, Math.round((total / TICKET_PROMEDIO_OBJETIVO[local]) * 2.4 * ruido(`${local}|${fecha}|pax${i}`, 0.08)))

    // IVA 13 % y servicio 10 % de relleno, para que la fila tenga la forma completa. NO es
    // cálculo fiscal: `posFiscal` no se toca ni se importa.
    saloneros[nombre] = {
      pax, total, com, beb, iCom, iBeb,
      iva:        Math.round(total * 0.13),
      serv:       Math.round(total * 0.10),
      promPax:    pax  ? total / pax  : 0,
      promPlato:  iCom ? com   / iCom : 0,
      promBebida: iBeb ? beb   / iBeb : 0,
      ratioCB:    beb  ? com   / beb  : 0,
      ratioU:     iBeb ? iCom  / iBeb : 0,
      bebPax:     pax  ? iBeb  / pax  : 0,
      prods,
    }
  })

  // ── La caja ──
  if (ventaCaja > 0) {
    const prodsCaja = armarProds(local, fecha, CAJERO, ventaCaja)
    const delivery  = Math.round(ventaCaja * 0.62)
    // Los tickets del día son los del PoS; los de caja son la parte proporcional.
    const ordenes   = Math.max(1, Math.round(ticketsTotal * PARTE_CAJERO))
    saloneros[CAJERO] = {
      esCajero:   true,
      total:      ventaCaja,
      salon:      ventaCaja - delivery,
      delivery,
      iva:        Math.round(ventaCaja * 0.13),
      serv:       Math.round((ventaCaja - delivery) * 0.10),   // el delivery no cobra servicio
      ordenes,
      ticketProm: Math.round(ventaCaja / ordenes),
      prods:      prodsCaja,
    }
  }

  return {
    // El feed real va a escribir estos dos igual que el import: de dónde salió y cuándo.
    fileName:   `en-vivo · ${local} · ${fecha}`,
    uploadedAt: new Date().toISOString(),
    saloneros,
  }
}

function armarHistorico(local: LocalId, fecha: string, ventaAcum: number): ComparativaHistorico {
  return {
    mismoDiaSemanaPasada: Math.round(ventaAcum * ruido(`${local}|${fecha}|sem`, 0.22)),
    promedio4Semanas:     Math.round(ventaAcum * ruido(`${local}|${fecha}|prom4`, 0.14)),
  }
}

/**
 * ⚠ FASE B · datos de EJEMPLO. Existe para que la pantalla tenga su forma, NO para leerse.
 * A propósito NO todos pasan el umbral: el indicador solo sirve si puede dar mal.
 */
function armarCalidadPax(local: LocalId, fecha: string): CalidadPax[] {
  const base = [
    { salonero: SALONEROS[0], mesas: 14, nativo: 96, match: 91 },
    { salonero: SALONEROS[1], mesas: 11, nativo: 72, match: 58 },
    { salonero: SALONEROS[2], mesas: 12, nativo: 89, match: 84 },
    { salonero: SALONEROS[3], mesas:  9, nativo: 41, match: 30 },
  ]
  return base.map(b => ({
    salonero:              b.salonero,
    mesas:                 b.mesas,
    pctPaxNativoCargado:   Math.min(100, Math.round(b.nativo * ruido(`${local}|${fecha}|${b.salonero}|nat`, 0.04))),
    matchArticuloVsNativo: Math.min(100, Math.round(b.match  * ruido(`${local}|${fecha}|${b.salonero}|mat`, 0.06))),
  }))
}

// ── La única puerta de salida ───────────────────────────────────────────────────

/**
 * El snapshot de «En vivo» para un local.
 *
 * ⚠ CABLEAR: reemplazar el cuerpo por la lectura real. La FIRMA se mantiene — es lo que hace
 * que la pantalla no se entere del cambio. Por eso es `async` aunque hoy no espere nada: si
 * fuera síncrona, cablearla obligaría a tocar el componente.
 */
export async function getSnapshotEnVivo(local: LocalId): Promise<SnapshotEnVivo> {
  // Fuera de horario devuelve la jornada de AYER, completa. Ver `fechaServicioCR`.
  const fecha   = fechaServicioCR()
  const hora    = horaCorteCR()
  const enCurso = servicioEnCursoCR()

  const porHora   = armarPorHora(local, fecha, hora)
  const ventaAcum = porHora.reduce((s, h) => s + h.monto, 0)
  const tickets   = porHora.reduce((s, h) => s + h.tickets, 0)

  // La proyección es NUESTRA, no del PoS: lo que falta del día según la curva. Antes de abrir
  // no se proyecta nada — dividir por una fracción casi cero daría un número absurdo.
  const transcurrido = fraccionTranscurrida(hora)

  return {
    local,
    fecha,
    generadoEn:       new Date().toISOString(),
    servicioEnCurso:  enCurso,
    dia:              armarDiaData(local, fecha, ventaAcum, tickets),
    pm:               PM_MOCK,
    porHora,
    proyeccionCierre: transcurrido > 0.02 ? Math.round(ventaAcum / transcurrido) : 0,
    historico:        armarHistorico(local, fecha, ventaAcum),
    calidadPax:       armarCalidadPax(local, fecha),
  }
}

/** Cada cuánto la pantalla vuelve a pedir el snapshot. 30 s: «siempre actualizado» sin ruido. */
export const REFRESH_MS = 30_000

/** Se exporta solo para los tests: verifican que el mock nunca emita el artículo PAX. */
export const CATALOGO_NOMBRES = CATALOGO.map(p => p.nombre)
export { ARTICULO_PAX }
