import type {
  DiasMap, DiaData, SaloneroDay, CajeroDay,
  AggSalonero, AggGeneral, AggCajero, ContabilidadDay,
  ProductMap, HistMap, Meta,
} from '../../shared/types/ventas'
import { isCajeroName, todayCR } from '../../shared/utils'

// ── Cajeros detection ────────────────────────────────────────
export function esCajero(name: string): boolean { return isCajeroName(name) }

// ── Formatters ───────────────────────────────────────────────
export function fi(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '—'
  return '₡ ' + Math.round(n).toLocaleString('es-CR')
}
export function fip(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '—'
  return n >= 0 ? '+' + fi(n) : fi(n)
}
export function pct(a: number, b: number): string {
  if (!b) return '—'
  return ((a - b) / Math.abs(b) * 100).toFixed(1) + '%'
}
export function fmtDate(d: string): string {
  if (!d) return ''
  const [y, m, dd] = d.split('-')
  const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
  return `${Number(dd)} ${months[Number(m)-1]} ${y}`
}
export function fmtMonthLabel(ym: string): string {
  const [y, m] = ym.split('-')
  const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
    'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
  return `${months[Number(m)-1]} ${y}`
}
// Timezone-safe today (Costa Rica UTC-6)
export function todayISO(): string { return todayCR() }
export function daysInMonth(ym: string): number {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}
export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000)
}
export function dayOfWeek(date: string): number {
  return new Date(date + 'T12:00:00').getDay()
}
const DOW_LABELS = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb']
export function dowLabel(d: number): string { return DOW_LABELS[d] }

// ── Meta helpers ─────────────────────────────────────────────
export function getMeta(metas: Meta, salName: string, metric: keyof Meta['global']): number {
  return metas.salMetas?.[salName]?.[metric] ?? metas.global?.[metric] ?? 0
}
export function metaColor(actual: number, meta: number, dir: 'hi'|'lo' = 'hi'): string {
  if (!meta) return ''
  const ratio = dir === 'hi' ? actual / meta : meta / actual
  if (ratio >= 1)    return 'var(--vt-green)'
  if (ratio >= 0.85) return 'var(--vt-gold)'
  return 'var(--vt-red)'
}

// ── All active dates ──────────────────────────────────────────
export function allDates(dias: DiasMap, hist: HistMap = {}): string[] {
  const all = new Set([...Object.keys(dias), ...Object.keys(hist)])
  return [...all].sort()
}

export function datesInRange(dates: string[], from: string, to: string): string[] {
  return dates.filter(d => d >= from && d <= to)
}

export function allSaloneros(dias: DiasMap): string[] {
  const names = new Set<string>()
  for (const dia of Object.values(dias)) {
    for (const name of Object.keys(dia.saloneros)) {
      if (!esCajero(name)) names.add(name)
    }
  }
  return [...names].sort()
}

/**
 * Los BUCKETS DE CAJA que aparecen en las fechas dadas, por la MARCA `esCajero` del dato y no
 * por cómo se llame la clave.
 *
 * Es la diferencia entre leer el PoS y leer solo el .xls. `esCajero(nombre)` compara contra
 * `CAJEROS_IDS` (`shared/utils`), la lista de nombres que escribía el Excel. El adaptador del
 * PoS (`armarDia` → `etiquetaNoMesero`) sí produce esos dos nombres para los logins 111 y 222,
 * pero manda a la MISMA rama `CajeroDay` otros tres buckets que no están en esa lista:
 * `«Caja · <login>»` (cualquier otro login de caja), `«Sistema · <login>»` y `«Sin salonero»`.
 * Filtrando por nombre esa plata se volvía invisible en la pestaña Cajeros aunque
 * `aggGeneral` sí la contara en `cajTotal` — la pestaña mostraba MENOS de lo que el resto de
 * la app decía que había pasado por caja.
 *
 * Por la marca no se puede fallar: la ponen las DOS fuentes (`xlsParser` y `armarDia`) y es la
 * misma que ya usan `aggGeneral`, `aggSalonero` y `getDayStats` para decidir quién es mesero.
 *
 * Solo LISTA: no suma nada. La plata la sigue sacando `aggCajero` de `CajeroDay`.
 */
export function cajerosEnRango(dias: DiasMap, dates: string[]): string[] {
  const names = new Set<string>()
  for (const date of dates) {
    const dia = dias[date]
    if (!dia) continue
    for (const [name, s] of Object.entries(dia.saloneros)) {
      if ((s as CajeroDay).esCajero) names.add(name)
    }
  }
  return [...names].sort()
}

/** El mix comida/bebida en ₡ de un período. Ver `mixPorFamilia`. */
export interface MixPorFamilia {
  com: number
  beb: number
}

/**
 * El mix comida/bebida en ₡ **por FAMILIA del PoS**, sumado de los buckets de mesero.
 *
 * POR QUÉ EXISTE: la otra forma de sacar este número —recorrer `AggGeneral.prods` y sumar lo
 * que el `ProductMap` marque `tipo: 'comida' | 'bebida'`— cruza el nombre del producto contra
 * la tabla `product_map`, que se carga a mano y con los nombres de la era del .xls. Los
 * nombres que trae el PoS no son los mismos, así que `pm[nombre]` sale `undefined`, la suma da
 * ₡0 y la pantalla queda mostrando «₡ 0» al lado de un contador de unidades que sí tiene
 * decenas de platos.
 *
 * De dónde sale el número que sí cierra: `SaloneroDay.com` / `.beb` los llena `armarDia`
 * (`modules/ventas/ventasEnVivoDatos.ts`) recorriendo las líneas de `pos_ndf_ticket_lines`,
 * quedándose con las familias de `FAMILIAS_VALOR_SERVIDO` (`shared/ndf/mapTicket.ts`) y
 * partiéndolas en bebida (familia 5) contra todo lo demás. Es EXACTAMENTE el mismo recorrido,
 * la misma línea y el mismo `if`, que llenan `iCom`/`iBeb`. Por eso ₡ y unidades cierran: son
 * dos acumuladores del mismo bucle, no dos criterios distintos.
 *
 * ⚠️ NO ES LA NETA DEL DÍA y no se puede usar como tal: acá solo entran los buckets de MESERO
 * —los mismos que `aggGeneral` manda a `total`, `iCom` e `iBeb`— y queda afuera todo lo que
 * pasó por caja (`cajTotal`). La neta del día la sigue dando `getDayStats`.
 */
export function mixPorFamilia(dates: string[], dias: DiasMap): MixPorFamilia {
  let com = 0, beb = 0
  for (const date of dates) {
    const dia = dias[date]
    if (!dia) continue
    for (const s of Object.values(dia.saloneros)) {
      if ((s as CajeroDay).esCajero) continue
      const sl = s as SaloneroDay
      com += sl.com ?? 0
      beb += sl.beb ?? 0
    }
  }
  return { com, beb }
}

// ── Per-day combined stats ───────────────────────────────────
export function getDayStats(dia: DiaData): ContabilidadDay & { saloneroNames: string[] } {
  let ventaNeta = 0, iva = 0, serv = 0, salon = 0, delivery = 0, pax = 0
  const saloneroNames: string[] = []
  for (const [name, s] of Object.entries(dia.saloneros)) {
    if ((s as CajeroDay).esCajero) {
      const c = s as CajeroDay
      ventaNeta += c.total
      iva       += c.iva ?? 0
      serv      += c.serv ?? 0
      delivery  += c.delivery
      salon     += c.salon
      // El PAX de caja TAMBIÉN cuenta. En el PoS hay tickets de salón cobrados bajo un login
      // de caja (111/222/388): su plata ya venía sumando acá (`c.total`, `c.salon`), pero su
      // pax se descartaba, así que el día informaba menos comensales de los que hubo — ~9%
      // menos que el xls en la Paridad, con el crudo (`pax_articulo`) dando idéntico.
      // `?? 0`: el `xlsParser` nunca llenó este campo, así que los días del xls no se mueven.
      pax       += c.pax ?? 0
    } else {
      const sl = s as SaloneroDay
      ventaNeta += sl.total
      iva       += sl.iva ?? 0
      serv      += sl.serv ?? 0
      salon     += sl.total
      pax       += sl.pax ?? 0
      saloneroNames.push(name)
    }
  }
  const ventaBruta = ventaNeta + iva + serv
  return {
    fecha:      '',
    ventaBruta,
    ventaNeta,
    iva,
    serv,
    salon,
    delivery,
    pax,
    promPax:    pax > 0 ? salon / pax : 0,
    saloneroNames,
  }
}

// ── aggSalonero ──────────────────────────────────────────────
export function aggSalonero(name: string, dates: string[], dias: DiasMap, pm: ProductMap): AggSalonero {
  let total = 0, com = 0, beb = 0, pax = 0, iCom = 0, iBeb = 0, iva = 0, serv = 0
  let days = 0
  const prods: Record<string, { q: number; m: number }> = {}

  for (const date of dates) {
    const dia = dias[date]
    if (!dia) continue
    const raw = dia.saloneros[name]
    if (!raw || (raw as unknown as CajeroDay).esCajero) continue
    const s = raw as SaloneroDay
    days++
    total += s.total
    com   += s.com
    beb   += s.beb
    pax   += s.pax ?? 0
    iCom  += s.iCom ?? 0
    iBeb  += s.iBeb ?? 0
    iva   += s.iva ?? 0
    serv  += s.serv ?? 0
    for (const [pname, qty, monto] of (s.prods ?? [])) {
      if (!prods[pname]) prods[pname] = { q: 0, m: 0 }
      prods[pname].q += qty
      prods[pname].m += monto
    }
  }

  const mult = (n: string) => pm[n]?.multiplicador ?? 1
  const iBebAdj = Object.entries(prods).reduce((acc, [n, v]) => {
    const info = pm[n]
    if (info?.tipo === 'bebida') acc += v.q * mult(n)
    return acc
  }, 0) || iBeb

  return {
    nombre:     name,
    days,
    total,
    com,
    beb,
    pax,
    iCom,
    iBeb:       iBebAdj,
    promPax:    pax > 0 ? total / pax : 0,
    promPlato:  iCom > 0 ? com / iCom : 0,
    promBebida: iBebAdj > 0 ? beb / iBebAdj : 0,
    ratioCB:    beb > 0 ? com / beb : 0,
    ratioU:     iBebAdj > 0 ? iCom / iBebAdj : 0,
    bebPax:     pax > 0 ? iBebAdj / pax : 0,
    promTicket: (iCom + iBebAdj) > 0 ? total / (iCom + iBebAdj) : 0,
    prods,
  }
}

// ── aggGeneral ───────────────────────────────────────────────
export function aggGeneral(dates: string[], dias: DiasMap, pm: ProductMap): AggGeneral {
  let total = 0, cajTotal = 0, cajDelivery = 0, cajSalon = 0
  // DOS contadores de pax, a propósito (ver `AggGeneral.paxSaloneros`):
  //   · `pax`          = todos los comensales del día, caja incluida. Es "cuánta gente vino".
  //   · `paxSaloneros` = solo los de meseros. Es el denominador de `promPax`/`bebPax`, cuyos
  //     numeradores (`total`, `iBeb`) también son de meseros. Ese ratio es el BENCHMARK contra
  //     el que «En vivo» y Evaluación comparan a cada mesero: tiene que seguir siendo
  //     comparable con `aggSalonero`, así que no se le mete el pax de caja abajo.
  let pax = 0, paxSaloneros = 0, iCom = 0, iBeb = 0
  let cortTotal = 0, persTotal = 0
  const prods: Record<string, { q: number; m: number }> = {}

  for (const date of dates) {
    const dia = dias[date]
    if (!dia) continue
    for (const [, s] of Object.entries(dia.saloneros)) {
      if ((s as CajeroDay).esCajero) {
        const c = s as CajeroDay
        cajTotal    += c.total
        cajDelivery += c.delivery
        cajSalon    += c.salon
        pax         += c.pax ?? 0     // los comensales de caja cuentan en el pax del día
      } else {
        const sl = s as SaloneroDay
        total += sl.total
        pax          += sl.pax ?? 0
        paxSaloneros += sl.pax ?? 0
        iCom  += sl.iCom ?? 0
        iBeb  += sl.iBeb ?? 0
        for (const [pname, qty, monto] of (sl.prods ?? [])) {
          if (!prods[pname]) prods[pname] = { q: 0, m: 0 }
          prods[pname].q += qty
          prods[pname].m += monto
          const info = pm[pname]
          if (info?.tipo === 'cortesia') cortTotal += monto
          if (info?.tipo === 'personal') persTotal += monto
        }
      }
    }
  }

  const totalRest = total + cajTotal
  const beb = Object.entries(prods).reduce((a, [n, v]) => a + (pm[n]?.tipo === 'bebida' ? v.m : 0), 0)
  const com = Object.entries(prods).reduce((a, [n, v]) => a + (pm[n]?.tipo === 'comida' ? v.m : 0), 0)

  return {
    total,
    cajTotal,
    cajDelivery,
    cajSalon,
    totalRest,
    salon:      total + cajSalon,
    pax,
    paxSaloneros,
    // Sobre `paxSaloneros` y no sobre `pax`: los dos numeradores son de meseros. Es el mismo
    // valor que devolvían antes de que `pax` pasara a contar también el de caja.
    promPax:    paxSaloneros > 0 ? total / paxSaloneros : 0,
    iCom,
    iBeb,
    ratioCB:    beb > 0 ? com / beb : 0,
    ratioU:     iBeb > 0 ? iCom / iBeb : 0,
    bebPax:     paxSaloneros > 0 ? iBeb / paxSaloneros : 0,
    promTicket: (iCom + iBeb) > 0 ? total / (iCom + iBeb) : 0,
    cortTotal,
    persTotal,
    prods,
  }
}

// ── aggCajero ────────────────────────────────────────────────
export function aggCajero(name: string, dates: string[], dias: DiasMap): AggCajero {
  let total = 0, salon = 0, delivery = 0, ordenes = 0, days = 0
  const prods: Record<string, { q: number; m: number }> = {}
  for (const date of dates) {
    const dia = dias[date]
    if (!dia) continue
    const c = dia.saloneros[name] as CajeroDay | undefined
    if (!c?.esCajero) continue
    days++
    total    += c.total
    salon    += c.salon
    delivery += c.delivery
    ordenes  += c.ordenes
    for (const [pname, qty, monto] of (c.prods ?? [])) {
      if (!prods[pname]) prods[pname] = { q: 0, m: 0 }
      prods[pname].q += qty
      prods[pname].m += monto
    }
  }
  return {
    nombre:     name,
    days,
    total,
    salon,
    delivery,
    ordenes,
    ticketProm: ordenes > 0 ? total / ordenes : 0,
    prods,
  }
}

// ── contabilidad: monthly table ──────────────────────────────
export function getContabilidadDays(year: number, month: number | null, dias: DiasMap, hist: HistMap): ContabilidadDay[] {
  const result: ContabilidadDay[] = []
  const allD = [...new Set([...Object.keys(dias), ...Object.keys(hist)])].sort()
  for (const date of allD) {
    const [y, m] = date.split('-').map(Number)
    if (y !== year) continue
    if (month !== null && m !== month) continue
    if (dias[date]) {
      const stats = getDayStats(dias[date])
      result.push({ ...stats, fecha: date })
    } else if (hist[date]) {
      const h = hist[date]
      result.push({
        fecha:      date,
        ventaBruta: h.ventaBruta,
        ventaNeta:  h.ventaNeta,
        iva:        h.iva,
        serv:       h.serv,
        salon:      h.salon,
        delivery:   h.delivery,
        pax:        h.pax,
        promPax:    h.promPax,
      })
    }
  }
  return result
}

// ── Top products ──────────────────────────────────────────────
export function topProds(
  prods: Record<string, { q: number; m: number }>,
  by: 'monto'|'unidades' = 'monto',
  limit = 10,
  tipos?: string[],
  pm?: ProductMap,
): Array<{ nombre: string; q: number; m: number }> {
  let entries = Object.entries(prods)
  if (tipos && pm) {
    entries = entries.filter(([n]) => tipos.includes(pm[n]?.tipo ?? ''))
  }
  return entries
    .sort((a, b) => (by === 'monto' ? b[1].m - a[1].m : b[1].q - a[1].q))
    .slice(0, limit)
    .map(([nombre, v]) => ({ nombre, q: v.q, m: v.m }))
}

// ── Available months/years ────────────────────────────────────
export function availableMonths(dias: DiasMap, hist: HistMap): string[] {
  const months = new Set<string>()
  for (const d of [...Object.keys(dias), ...Object.keys(hist)]) months.add(d.slice(0, 7))
  return [...months].sort().reverse()
}

export function availableYears(dias: DiasMap, hist: HistMap): number[] {
  const years = new Set<number>()
  for (const d of [...Object.keys(dias), ...Object.keys(hist)]) years.add(Number(d.slice(0, 4)))
  return [...years].sort().reverse()
}

// ── Meta progress ─────────────────────────────────────────────
export function metaProgress(metas: Meta, dias: DiasMap, hist: HistMap, ym: string) {
  const meta = metas.restaurante?.[ym] ?? 0
  if (!meta) return null
  const days = getContabilidadDays(Number(ym.slice(0,4)), Number(ym.slice(5,7)), dias, hist)
  const today = todayISO()
  const passed = days.filter(d => d.fecha <= today)
  const ventasMes = days.reduce((s, d) => s + d.ventaNeta, 0)
  const passDays  = passed.length
  const monthDays = daysInMonth(ym)
  const projection = passDays > 0 ? (ventasMes / passDays) * monthDays : 0
  const remaining  = monthDays - passDays
  const effort     = remaining > 0 ? (meta - ventasMes) / remaining : 0
  return {
    meta, ventasMes, passDays, monthDays, projection, effort,
    pct: ventasMes / meta * 100,
    onTrack: projection >= meta,
    metaDia: meta / monthDays,
  }
}

// ── Ratio color classes ────────────────────────────────────────
export function ratioCBClass(r: number): string {
  if (!r) return ''
  if (r >= 2.5 && r <= 4.5) return 'ratio-ok'
  if (r < 2.5) return 'ratio-low'
  return 'ratio-high'
}

// ── Day of week averages ──────────────────────────────────────
export function dowAverages(days: ContabilidadDay[]): Record<number, { sum: number; cnt: number }> {
  const r: Record<number, { sum: number; cnt: number }> = {}
  for (const d of days) {
    const dow = dayOfWeek(d.fecha)
    if (!r[dow]) r[dow] = { sum: 0, cnt: 0 }
    r[dow].sum += d.ventaNeta
    r[dow].cnt++
  }
  return r
}

// ── Análisis helpers ──────────────────────────────────────────
export function yearlyTotals(year: number, dias: DiasMap, hist: HistMap) {
  const days = getContabilidadDays(year, null, dias, hist)
  return {
    ventaNeta:  days.reduce((s, d) => s + d.ventaNeta, 0),
    ventaBruta: days.reduce((s, d) => s + d.ventaBruta, 0),
    pax:        days.reduce((s, d) => s + d.pax, 0),
    salon:      days.reduce((s, d) => s + d.salon, 0),
    delivery:   days.reduce((s, d) => s + d.delivery, 0),
    days:       days.length,
    promPax:    0,
  }
}
