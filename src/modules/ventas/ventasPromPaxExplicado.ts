// ── «Prom/PAX explicado» — el cálculo (SPEC v2.3 §5–§6) ────────────────────────────────────
//
// Módulo PURO: recibe las filas del RPC de agregado (`pos_prompax_agregado`, mig 080) y devuelve
// números, tablas y frases. Sin I/O, sin reloj, sin redondeos: se calcula con todos los decimales
// y se redondea al mostrar (§0 #8).
//
// ── DEFINICIONES (las mismas de toda la app) ───────────────────────────────────────────────
// · Neta: la de `netaVenta.ts`, ya sumada en la base por el RPC (test de contrato aparte).
// · Día: día CR de la factura (`fecha_registra`). NO cambia (§5).
// · Turno: por la HORA CR de la factura, no por `pos_ndf_tickets.turno` (el turno de caja está mal
//   anotado en los dos sentidos, r8/Q27). El RPC trae la franja: 06–16 mañana · 17–23 noche ·
//   00–05 madrugada. **Madrugada = noche del MISMO día calendario** (decisión del dueño, 06/11,
//   opción B): así el día y el mes siguen siendo idénticos a los de Ventas. Vive SOLO acá:
//   `turnoDeFranja`.
// · Prom/pax = neta de salón ÷ pax de salón, incluida la neta de las facturas de salón sin pax.

import { DIAS_SEMANA, diaSemana, lunesDe, type Rango } from './periodosPromPax'

// ── Entrada ────────────────────────────────────────────────────────────────────────────────

export type Franja = 'mañana' | 'noche' | 'madrugada'
export type TurnoPromPax = 'mañana' | 'noche'
export type FiltroTurno = TurnoPromPax | 'ambos'

/** Una fila del RPC: (día CR, franja, login del salonero, canal) → facturas, pax y neta. */
export interface FilaAgregada {
  dia:             string
  franja:          Franja
  salonero_login:  string | null
  canal:           string
  tickets:         number
  pax:             number
  neta:            number
  /** La parte de `neta` que viene de facturas con pax = 0. */
  neta_sin_pax:    number
  tickets_sin_pax: number
}

/** La franja horaria → turno. Madrugada = noche del mismo día (opción B). */
export function turnoDeFranja(f: Franja): TurnoPromPax {
  return f === 'mañana' ? 'mañana' : 'noche'
}

/** Quién es el salonero de un login ese día. Se inyecta (en la app: `personasNdf.ts`). */
export type ResolverSalonero = (login: string | null, dia: string) => { clave: string; nombre: string }

/** Sin resolver: el login tal cual y «Caja / sin mesero» para null. Para tests. */
export const resolverCrudo: ResolverSalonero = (login) =>
  login ? { clave: login, nombre: `login ${login}` } : { clave: 'caja', nombre: 'Caja / sin mesero' }

/** Las filas del período y del turno pedidos. */
export function filtrar(filas: readonly FilaAgregada[], r: Rango, turno: FiltroTurno = 'ambos'): FilaAgregada[] {
  return filas.filter(f => f.dia >= r.desde && f.dia <= r.hasta
    && (turno === 'ambos' || turnoDeFranja(f.franja) === turno))
}

// ── Totales (§5) y cuadre de ventas (§6.1) ─────────────────────────────────────────────────

export type LineaCanal = 'salon' | 'barra' | 'delivery' | 'llevar/otros'
export const LINEAS_CANAL: readonly LineaCanal[] = ['salon', 'barra', 'delivery', 'llevar/otros']

export function lineaDeCanal(canal: string): LineaCanal {
  return canal === 'salon' || canal === 'barra' || canal === 'delivery' ? canal : 'llevar/otros'
}

export interface Totales {
  ventas:      number
  porLinea:    Record<LineaCanal, number>
  tickets:     number
  /** Salón: neta CON pax (N), neta SIN pax (N0), pax y facturas. */
  salonN:      number
  salonN0:     number
  paxSalon:    number
  ticketsSalon: number
  /** Pax de todos los canales (la diferencia con el salón es barra/delivery). */
  paxTotal:    number
  /** (N + N0) / pax de salón. `null` sin pax. */
  promPax:     number | null
}

export function totales(filas: readonly FilaAgregada[]): Totales {
  const porLinea: Record<LineaCanal, number> = { 'salon': 0, 'barra': 0, 'delivery': 0, 'llevar/otros': 0 }
  let ventas = 0, tickets = 0, salonN = 0, salonN0 = 0, paxSalon = 0, ticketsSalon = 0, paxTotal = 0
  for (const f of filas) {
    ventas += f.neta
    tickets += f.tickets
    paxTotal += f.pax
    porLinea[lineaDeCanal(f.canal)] += f.neta
    if (f.canal === 'salon') {
      salonN += f.neta - f.neta_sin_pax
      salonN0 += f.neta_sin_pax
      paxSalon += f.pax
      ticketsSalon += f.tickets
    }
  }
  return {
    ventas, porLinea, tickets, salonN, salonN0, paxSalon, ticketsSalon, paxTotal,
    promPax: paxSalon > 0 ? (salonN + salonN0) / paxSalon : null,
  }
}

export interface CuadreVentas {
  delta:      number
  porLinea:   Record<LineaCanal, number>
  /** Apertura del salón. `null` si algún período no tiene pax de salón. */
  salon:      { volumen: number; gasto: number } | null
}

/** §6.1: Δ ventas = Σ Δ líneas; Δ salón = volumen + gasto (exacto). */
export function cuadreVentas(v: Totales, n: Totales): CuadreVentas {
  const porLinea = {} as Record<LineaCanal, number>
  for (const l of LINEAS_CANAL) porLinea[l] = n.porLinea[l] - v.porLinea[l]
  let salon: CuadreVentas['salon'] = null
  if (v.promPax !== null && n.promPax !== null) {
    salon = {
      volumen: (n.paxSalon - v.paxSalon) * v.promPax,
      gasto:   (n.promPax - v.promPax) * n.paxSalon,
    }
  }
  return { delta: n.ventas - v.ventas, porLinea, salon }
}

// ── Cortes y descomposición del prom/pax (§6.2) ────────────────────────────────────────────

/**
 * `saloneroTurno` es interno: la tabla de saloneros con turno = «ambos» tiene una fila por
 * salonero y turno (§7.3), y su rendimiento/mezcla sale de este corte (también cuadra).
 */
export type Corte = 'turno' | 'dia' | 'salonero' | 'semana' | 'saloneroTurno'
export const CORTES: readonly Corte[] = ['turno', 'dia', 'salonero', 'semana', 'saloneroTurno']

export const NOMBRE_CORTE: Record<Corte, string> = {
  turno: 'turno', dia: 'día', salonero: 'salonero', semana: 'semana', saloneroTurno: 'salonero',
}

/** Un grupo de un corte en UN período: solo salón. `neta` = la parte CON pax (N_i). */
export interface Grupo {
  clave:    string
  etiqueta: string
  orden:    number
  pax:      number
  neta:     number
  /** Neta total del grupo (con y sin pax), para las tablas. */
  netaTotal: number
  tickets:  number
}

/**
 * La clave de un corte para una fila. Semana: ordinal dentro del período («Sem 1» = la semana
 * ISO del primer día), así un período se compara con el otro posición contra posición.
 */
function claveDe(corte: Corte, f: FilaAgregada, periodo: Rango, resolver: ResolverSalonero):
  { clave: string; etiqueta: string; orden: number } {
  switch (corte) {
    case 'turno': {
      const t = turnoDeFranja(f.franja)
      return { clave: t, etiqueta: t === 'mañana' ? 'Mañana' : 'Noche', orden: t === 'mañana' ? 0 : 1 }
    }
    case 'dia': {
      const d = diaSemana(f.dia)
      return { clave: String(d), etiqueta: DIAS_SEMANA[d], orden: d }
    }
    case 'salonero': {
      const s = resolver(f.salonero_login, f.dia)
      return { clave: s.clave, etiqueta: s.nombre, orden: 0 }
    }
    case 'saloneroTurno': {
      const s = resolver(f.salonero_login, f.dia)
      const t = turnoDeFranja(f.franja)
      return { clave: `${s.clave}|${t}`, etiqueta: `${s.nombre} · ${t === 'mañana' ? 'Mañana' : 'Noche'}`, orden: t === 'mañana' ? 0 : 1 }
    }
    case 'semana': {
      const k = Math.round((Date.parse(lunesDe(f.dia)) - Date.parse(lunesDe(periodo.desde))) / (7 * 86_400_000))
      return { clave: String(k), etiqueta: `Sem ${k + 1}`, orden: k }
    }
  }
}

/** Los grupos de salón de un corte en un período. */
export function agrupar(
  filas: readonly FilaAgregada[], corte: Corte, periodo: Rango, resolver: ResolverSalonero = resolverCrudo,
): Grupo[] {
  const m = new Map<string, Grupo>()
  for (const f of filas) {
    if (f.canal !== 'salon') continue
    const k = claveDe(corte, f, periodo, resolver)
    let g = m.get(k.clave)
    if (!g) {
      g = { ...k, pax: 0, neta: 0, netaTotal: 0, tickets: 0 }
      m.set(k.clave, g)
    }
    g.pax += f.pax
    g.neta += f.neta - f.neta_sin_pax
    g.netaTotal += f.neta
    g.tickets += f.tickets
  }
  return [...m.values()]
}

export type EstadoGrupo = 'ambos' | 'entra' | 'sale'

export interface AporteGrupo {
  clave:       string
  etiqueta:    string
  orden:       number
  estado:      EstadoGrupo
  pax_v:       number
  pax_n:       number
  s_v:         number
  s_n:         number
  /** Prom/pax del grupo (neta con pax ÷ pax). `null` si el grupo no tiene pax en ese período. */
  p_v:         number | null
  p_n:         number | null
  rendimiento: number
  mezcla:      number
  aporte:      number
}

export interface Descomposicion {
  P_v:         number
  P_n:         number
  delta:       number
  /** P* = N / PAX (solo la neta con pax). */
  Pstar_v:     number
  Pstar_n:     number
  /** N0_n/PAX_n − N0_v/PAX_v. */
  ventaSinPax: number
  grupos:      AporteGrupo[]
  /** delta − (Σ rendimiento + Σ mezcla + ventaSinPax). Tiene que ser ~0 (1e-9). */
  residuo:     number
}

export interface TotSalon { N: number; N0: number; PAX: number }

export const totSalon = (t: Totales): TotSalon => ({ N: t.salonN, N0: t.salonN0, PAX: t.paxSalon })

/**
 * §6.2. `null` si algún período no tiene pax de salón.
 * Un grupo con pax = 0 en un período cuenta como ausente en ese período (su neta con pax es 0).
 */
export function descomponerPromPax(gv: readonly Grupo[], gn: readonly Grupo[], v: TotSalon, n: TotSalon): Descomposicion | null {
  if (v.PAX <= 0 || n.PAX <= 0) return null
  const P_v = (v.N + v.N0) / v.PAX
  const P_n = (n.N + n.N0) / n.PAX
  const Pstar_v = v.N / v.PAX
  const Pstar_n = n.N / n.PAX
  const ventaSinPax = n.N0 / n.PAX - v.N0 / v.PAX

  const claves = new Map<string, { v?: Grupo; n?: Grupo }>()
  for (const g of gv) if (g.pax > 0) claves.set(g.clave, { ...claves.get(g.clave), v: g })
  for (const g of gn) if (g.pax > 0) claves.set(g.clave, { ...claves.get(g.clave), n: g })

  const grupos: AporteGrupo[] = []
  for (const [clave, { v: a, n: b }] of claves) {
    const ref = (b ?? a)!
    const s_v = a ? a.pax / v.PAX : 0
    const s_n = b ? b.pax / n.PAX : 0
    const p_v = a ? a.neta / a.pax : null
    const p_n = b ? b.neta / b.pax : null
    let rendimiento = 0
    let mezcla: number
    let estado: EstadoGrupo
    if (a && b) {
      estado = 'ambos'
      rendimiento = s_n * (p_n! - p_v!)
      mezcla = (s_n - s_v) * (p_v! - Pstar_v)
    } else if (b) {
      estado = 'entra'
      mezcla = s_n * (p_n! - Pstar_v)
    } else {
      estado = 'sale'
      mezcla = -s_v * (p_v! - Pstar_v)
    }
    grupos.push({
      clave, etiqueta: ref.etiqueta, orden: ref.orden, estado,
      pax_v: a?.pax ?? 0, pax_n: b?.pax ?? 0, s_v, s_n, p_v, p_n,
      rendimiento, mezcla, aporte: rendimiento + mezcla,
    })
  }
  const delta = P_n - P_v
  const suma = grupos.reduce((s, g) => s + g.aporte, 0) + ventaSinPax
  return { P_v, P_n, delta, Pstar_v, Pstar_n, ventaSinPax, grupos, residuo: delta - suma }
}

// ── Texto «Qué explica el cambio» (§6.3) ───────────────────────────────────────────────────

export const PAX_MIN_ANALISIS = 30
export const PAX_ORIENTACION = 100
export const PAX_MIN_CAUSA = 15

export type CalidadDatos = 'pocos' | 'orientacion' | 'ok'

/** Pax de salón < 30 en algún período → pocos; < 100 → orientación. */
export function calidadDatos(paxV: number, paxN: number): CalidadDatos {
  const m = Math.min(paxV, paxN)
  if (m < PAX_MIN_ANALISIS) return 'pocos'
  if (m < PAX_ORIENTACION) return 'orientacion'
  return 'ok'
}

/**
 * Un grupo puede ser causa si tiene ≥ 15 pax en el período en que tiene MENOS (un grupo que
 * entra o sale tiene 0 en uno de los dos, así que nunca es causa: queda en la tabla).
 */
export function puedeSerCausa(g: Pick<AporteGrupo, 'pax_v' | 'pax_n'>): boolean {
  return Math.min(g.pax_v, g.pax_n) >= PAX_MIN_CAUSA
}

/**
 * Los cortes que compiten por el texto, en el orden de desempate (§6.3). La semana no entra.
 * Del salonero compite el corte de la tabla VISIBLE: `saloneroTurno` con turno = «ambos», si no
 * `salonero` (`analizar` pasa uno solo de los dos).
 */
export const CORTES_TEXTO: readonly Corte[] = ['turno', 'dia', 'salonero', 'saloneroTurno']

export interface CausasCorte {
  corte:  Corte
  /** Las 2 mayores contribuciones (|aporte|) entre los grupos que pueden ser causa. */
  causas: AporteGrupo[]
  /** Σ |aporte| de esas causas: lo que «explica» el corte. */
  peso:   number
}

/** El corte que más explica el Δ prom/pax. Empate: turno → día → salonero. `null` si ninguno tiene causas. */
export function elegirCorte(porCorte: Partial<Record<Corte, Descomposicion | null>>): CausasCorte | null {
  let mejor: CausasCorte | null = null
  for (const corte of CORTES_TEXTO) {
    const d = porCorte[corte]
    if (!d) continue
    const causas = d.grupos.filter(puedeSerCausa)
      .sort((a, b) => Math.abs(b.aporte) - Math.abs(a.aporte) || a.orden - b.orden || a.etiqueta.localeCompare(b.etiqueta))
      .slice(0, 2)
      .filter(g => g.aporte !== 0)
    if (!causas.length) continue
    const peso = causas.reduce((s, g) => s + Math.abs(g.aporte), 0)
    if (!mejor || peso > mejor.peso + 1e-9) mejor = { corte, causas, peso }
  }
  return mejor
}

/** ₡ redondeado, con separador de miles fijo (no depende del locale del navegador). */
export function crc(n: number): string {
  const r = Math.round(Math.abs(n))
  return `₡${String(r).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`
}

/** «+₡1.719» / «−₡425». Lo usan la tabla y las frases: así cada número de la frase está tal cual en la tabla. */
export const signoCrc = (x: number | null): string => x === null ? '—' : `${x >= 0 ? '+' : '−'}${crc(x)}`
/** «1.234» (pax). */
export const entero = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
/** «33,0%» (% de pax de la tabla). */
export const pctPax = (x: number | null): string => x === null ? '—' : `${(x * 100).toFixed(1).replace('.', ',')}%`

/** Las líneas que no son salón y «pesan»: ≥ 15 % del total de los movimientos por línea. */
export const PESO_LINEA = 0.15

/** Frase 1: ventas — gente y gasto por persona en el salón, y las otras líneas si pesan. */
export function fraseVentas(c: CuadreVentas): string {
  const partes: string[] = []
  const signo = c.delta >= 0 ? 'subieron' : 'bajaron'
  partes.push(`Las ventas ${signo} ${crc(c.delta)}.`)
  if (c.salon) {
    const vol = c.salon.volumen, gas = c.salon.gasto
    partes.push(`En el salón, ${crc(vol)} ${vol >= 0 ? 'más' : 'menos'} por ${vol >= 0 ? 'más' : 'menos'} gente`
      + ` y ${crc(gas)} ${gas >= 0 ? 'más' : 'menos'} por ${gas >= 0 ? 'más' : 'menos'} gasto por persona.`)
  }
  const totalMov = LINEAS_CANAL.reduce((s, l) => s + Math.abs(c.porLinea[l]), 0)
  const otras = LINEAS_CANAL.filter(l => l !== 'salon' && totalMov > 0 && Math.abs(c.porLinea[l]) / totalMov >= PESO_LINEA)
  if (otras.length) {
    partes.push(otras.map(l => `${l === 'barra' ? 'Barra' : l === 'delivery' ? 'Delivery' : 'Llevar y otros'}`
      + ` ${c.porLinea[l] >= 0 ? 'sumó' : 'restó'} ${crc(c.porLinea[l])}`).join('; ') + '.')
  }
  return partes.join(' ')
}

/**
 * Una causa, en lenguaje descriptivo (nunca califica a la persona). Usa SOLO números que la tabla
 * visible del corte muestra por defecto (`fila` = su fila en `tablaCorte`), con los mismos
 * formatos: prom/pax de la comparación → actual y Δ ₡, o pax y % de pax. El aporte en ₡ al
 * prom/pax ordena las causas pero no se escribe: está en «Ver detalle» (rendimiento + mezcla).
 */
export function fraseCausa(g: AporteGrupo, fila: FilaTabla): string {
  if (Math.abs(g.rendimiento) >= Math.abs(g.mezcla) && fila.promPax !== null && fila.promPaxComp !== null && fila.delta !== null) {
    return `${fila.etiqueta}: ${fila.delta >= 0 ? 'subió' : 'bajó'} el gasto por persona`
      + ` (${crc(fila.promPaxComp)} → ${crc(fila.promPax)}, ${signoCrc(fila.delta)}).`
  }
  return `${fila.etiqueta}: atendió ${g.s_n >= g.s_v ? 'más' : 'menos'} parte de la gente`
    + ` (${entero(fila.pax)} pax, ${pctPax(fila.pctPax)} del total).`
}

export interface Explicacion {
  calidad:     CalidadDatos
  frases:      string[]
  /** «Pocos datos: tomalo como orientación» cuando calidad = orientación. */
  etiqueta:    string | null
  corte:       Corte | null
}

export function explicar(
  c: CuadreVentas, v: Totales, n: Totales, porCorte: Partial<Record<Corte, Descomposicion | null>>,
  tablas: Partial<Record<Corte, readonly FilaTabla[]>> = {},
): Explicacion {
  const calidad = calidadDatos(v.paxSalon, n.paxSalon)
  const frases = [fraseVentas(c)]
  if (calidad === 'pocos') {
    frases.push('Pocos datos para sacar conclusiones.')
    return { calidad, frases, etiqueta: null, corte: null }
  }
  const elegido = elegirCorte(porCorte)
  if (elegido) {
    const filas = new Map((tablas[elegido.corte] ?? []).map(f => [f.clave, f]))
    const frase = (g: AporteGrupo) => {
      const f = filas.get(g.clave)
      if (!f) throw new Error(`La causa ${g.clave} no está en la tabla de ${elegido.corte}`)
      return fraseCausa(g, f)
    }
    frases.push(`Por ${NOMBRE_CORTE[elegido.corte]}: ${frase(elegido.causas[0])}`)
    if (elegido.causas[1]) frases.push(frase(elegido.causas[1]))
  }
  return {
    calidad, frases, corte: elegido?.corte ?? null,
    etiqueta: calidad === 'orientacion' ? 'Pocos datos: tomalo como orientación' : null,
  }
}

// ── Tablas (§7) ─────────────────────────────────────────────────────────────────────────────

export interface FilaTabla {
  clave:       string
  etiqueta:    string
  pax:         number
  pctPax:      number | null
  /** Prom/pax del grupo con TODA su neta de salón (incluida la de facturas sin pax). */
  promPax:     number | null
  promPaxComp: number | null
  delta:       number | null
  deltaPct:    number | null
  rendimiento: number | null
  mezcla:      number | null
}

/** La tabla de un corte: período actual contra comparación, con rendimiento/mezcla si hay. */
export function tablaCorte(gv: readonly Grupo[], gn: readonly Grupo[], d: Descomposicion | null): FilaTabla[] {
  const paxN = gn.reduce((s, g) => s + g.pax, 0)
  const porV = new Map(gv.map(g => [g.clave, g]))
  const porD = new Map((d?.grupos ?? []).map(g => [g.clave, g]))
  const claves = new Map<string, Grupo>()
  for (const g of gv) claves.set(g.clave, g)
  for (const g of gn) claves.set(g.clave, g)
  const porN = new Map(gn.map(g => [g.clave, g]))
  const filas: FilaTabla[] = []
  for (const [clave, ref] of claves) {
    const a = porV.get(clave), b = porN.get(clave), x = porD.get(clave)
    const promPax = b && b.pax > 0 ? b.netaTotal / b.pax : null
    const promPaxComp = a && a.pax > 0 ? a.netaTotal / a.pax : null
    const delta = promPax !== null && promPaxComp !== null ? promPax - promPaxComp : null
    filas.push({
      clave, etiqueta: ref.etiqueta, pax: b?.pax ?? 0,
      pctPax: paxN > 0 ? (b?.pax ?? 0) / paxN : null,
      promPax, promPaxComp, delta,
      deltaPct: delta !== null && promPaxComp ? delta / promPaxComp : null,
      rendimiento: x ? x.rendimiento : null,
      mezcla: x ? x.mezcla : null,
    })
  }
  const orden = new Map([...claves.values()].map(g => [g.clave, g.orden]))
  return filas.sort((p, q) => (orden.get(p.clave)! - orden.get(q.clave)!) || q.pax - p.pax || p.etiqueta.localeCompare(q.etiqueta))
}

export interface FilaSalonero {
  clave:    string
  etiqueta: string
  turno:    TurnoPromPax
  pax:      number
  promPax:  number | null
  /** Prom/pax del salonero ÷ prom/pax de su turno en el período − 1. */
  vsTurno:  number | null
}

/**
 * Por salonero y turno, con «vs promedio del turno» (§7.3). Con turno = ambos, una fila por
 * salonero y turno. Prom/pax con toda la neta de salón del grupo (incluida la sin pax).
 */
export function tablaSaloneros(filas: readonly FilaAgregada[], resolver: ResolverSalonero = resolverCrudo): FilaSalonero[] {
  const porTurno = new Map<TurnoPromPax, { pax: number; neta: number }>()
  const m = new Map<string, { clave: string; etiqueta: string; turno: TurnoPromPax; pax: number; neta: number }>()
  for (const f of filas) {
    if (f.canal !== 'salon') continue
    const turno = turnoDeFranja(f.franja)
    const t = porTurno.get(turno) ?? { pax: 0, neta: 0 }
    t.pax += f.pax; t.neta += f.neta
    porTurno.set(turno, t)
    const s = resolver(f.salonero_login, f.dia)
    const k = `${s.clave}|${turno}`
    const e = m.get(k) ?? { clave: s.clave, etiqueta: s.nombre, turno, pax: 0, neta: 0 }
    e.pax += f.pax; e.neta += f.neta
    m.set(k, e)
  }
  return [...m.values()].map(e => {
    const t = porTurno.get(e.turno)!
    const promPax = e.pax > 0 ? e.neta / e.pax : null
    const promTurno = t.pax > 0 ? t.neta / t.pax : null
    return {
      clave: e.clave, etiqueta: e.etiqueta, turno: e.turno, pax: e.pax, promPax,
      vsTurno: promPax !== null && promTurno ? promPax / promTurno - 1 : null,
    }
  }).sort((a, b) => (a.turno === b.turno ? b.pax - a.pax : a.turno === 'mañana' ? -1 : 1))
}

// ── Todo junto ──────────────────────────────────────────────────────────────────────────────

export interface Analisis {
  v:          Totales
  n:          Totales
  cuadre:     CuadreVentas
  cortes:     Record<Corte, { gv: Grupo[]; gn: Grupo[]; d: Descomposicion | null }>
  explicacion: Explicacion
  saloneros:  FilaSalonero[]
}

/**
 * El análisis completo de un período contra su comparación. `filas` puede traer los dos
 * períodos (y de más): acá se filtran por rango y por turno.
 */
export function analizar(
  filas: readonly FilaAgregada[], actual: Rango, comparacion: Rango,
  turno: FiltroTurno = 'ambos', resolver: ResolverSalonero = resolverCrudo,
): Analisis {
  const fn = filtrar(filas, actual, turno)
  const fv = filtrar(filas, comparacion, turno)
  const n = totales(fn), v = totales(fv)
  const cuadre = cuadreVentas(v, n)
  const cortes = {} as Analisis['cortes']
  for (const corte of CORTES) {
    const gv = agrupar(fv, corte, comparacion, resolver)
    const gn = agrupar(fn, corte, actual, resolver)
    cortes[corte] = { gv, gn, d: descomponerPromPax(gv, gn, totSalon(v), totSalon(n)) }
  }
  // Compiten los cortes de las tablas VISIBLES (§7): turno solo con «ambos»; el salonero, con
  // «ambos», es salonero × turno (una fila por salonero y turno, como la tabla).
  const corteSal: Corte = turno === 'ambos' ? 'saloneroTurno' : 'salonero'
  const enTexto: Corte[] = [...(turno === 'ambos' ? ['turno' as Corte] : []), 'dia', corteSal]
  const porCorte: Partial<Record<Corte, Descomposicion | null>> = {}
  const tablas: Partial<Record<Corte, FilaTabla[]>> = {}
  for (const c of enTexto) {
    porCorte[c] = cortes[c].d
    tablas[c] = tablaCorte(cortes[c].gv, cortes[c].gn, cortes[c].d)
  }
  const explicacion = explicar(cuadre, v, n, porCorte, tablas)
  return { v, n, cuadre, cortes, explicacion, saloneros: tablaSaloneros(fn, resolver) }
}

// ── CSV ─────────────────────────────────────────────────────────────────────────────────────

/** CSV con BOM (Excel en español lo abre bien), todo entre comillas. */
export function aCsv(encabezados: readonly string[], filas: readonly (readonly (string | number | null)[])[]): string {
  const q = (v: string | number | null) => `"${v === null ? '' : String(v).replace(/"/g, '""')}"`
  return '﻿' + [encabezados.map(q).join(','), ...filas.map(f => f.map(q).join(','))].join('\n')
}
