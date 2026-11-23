// Navegación de Ventas. Ventas v2 · 3.5.1 (SPEC-ventas-v2 §12.4): el menú pasó a entradas —Resumen ·
// Productos · Equipo · Tiempos · En vivo · Ajustes— y las vistas viejas, SIN TOCARLAS, a sub-vistas de su
// entrada nueva (mapa de §12.2).
//
// 3.5.2 (§12.4): se suma «Regalías» (D11 = A) y se RETIRAN «Hoy», «Ventas» e «Histórico» (D15): lo suyo
// quedó en «Resumen» (período «Ayer», «Mes» o «Rango» de la barra) y en «Regalías». «Análisis» queda solo
// con «Año vs Año» y pasa al lado de «Calendario», en «Tiempos» (su destino de la 3.5.3), así «Resumen» no
// lleva sub-pestañas. Los roles de cada vista que queda son los mismos de antes.
//
// 3.5.3 (§12.4): se RETIRAN «Calendario» y «Análisis» (ya solo «Año vs Año»). Lo suyo quedó en «Tiempos»
// («Meses y temporadas», «Calendario», «Día de semana») y en «Resumen» («Detalle por día»). «Tiempos» queda sin
// sub-pestañas. Sus enlaces abren «Tiempos» con el período que las reemplaza.
//
// La dirección es `/ventas?tab=<entrada>&v=<sub-vista>` (sin `v`, la primera sub-vista que el rol ve).
// Los `?tab=<vista vieja>` siguen abriendo algo con sentido: se reemplaza la dirección por la nueva.
// «Paridad» y «Cargar XLS» se retiraron el 16-nov: su `?tab=` viejo abre «Resumen».

import { todayCR } from '../../shared/utils'
import { sumarDias, type TipoPeriodoV2 } from './periodos'

export type Tab =
  | 'envivo' | 'saloneros' | 'salolineas' | 'evaluacion' | 'icp'
  | 'cajeros' | 'mix' | 'menueng' | 'metas'
  | 'competencias' | 'config' | 'resumen' | 'tiempos' | 'internas' | 'regalias'

export interface TabDef { id: Tab; label: string; roles: string[] }

/**
 * Las vistas y quién ve cada una: los MISMOS roles de antes de la 3.5 (SPEC §6). «Regalías» la ven los
 * tres (el contador, completa: D7). El orden no decide la pestaña de arranque (es «Resumen»).
 */
export const TABS: TabDef[] = [
  { id: 'envivo',       label: 'En vivo',           roles: ['owner','manager','contador'] },
  { id: 'saloneros',    label: 'Saloneros',         roles: ['owner','manager'] },
  { id: 'salolineas',   label: 'Por línea',         roles: ['owner','manager'] },
  { id: 'evaluacion',   label: 'Evaluación',        roles: ['owner','manager'] },
  { id: 'icp',          label: 'ICP',               roles: ['owner','manager','contador'] },
  { id: 'cajeros',      label: 'Cajeros',           roles: ['owner','manager','contador'] },
  { id: 'mix',          label: 'Mix',               roles: ['owner','manager','contador'] },
  { id: 'menueng',      label: 'Ing. Menú',         roles: ['owner','manager'] },
  { id: 'metas',        label: 'Metas',             roles: ['owner','manager','contador'] },
  { id: 'competencias', label: 'Competencias',      roles: ['owner','manager'] },
  { id: 'config',       label: 'Productos',         roles: ['owner','manager'] },
  // Ventas v2 · fase 2.1 (SPEC-ventas-v2 §5.1).
  { id: 'resumen',      label: 'Resumen',           roles: ['owner','manager','contador'] },
  // Ventas v2 · fase 2.3 (SPEC-ventas-v2 §5.4).
  { id: 'tiempos',      label: 'Tiempos',           roles: ['owner','manager','contador'] },
  // Ventas v2 · 3.5.2 (D11 = A; el contador la ve completa, D7).
  { id: 'regalias',     label: 'Regalías',          roles: ['owner','manager','contador'] },
  // Ajustes → «Mesas internas» (mig 193; decisión del dueño 18-nov). Edita solo el owner.
  { id: 'internas',     label: 'Mesas internas',    roles: ['owner','manager'] },
]

/** 3.5.1: arranque en «Resumen» para los tres roles (SPEC §12.1; el período «Ayer» lo pone la barra). */
export const TAB_POR_DEFECTO: Tab = 'resumen'

export type EntradaId = 'resumen' | 'productos' | 'equipo' | 'tiempos' | 'regalias' | 'envivo' | 'ajustes'

export interface Entrada { id: EntradaId; label: string; vistas: Tab[] }

/**
 * Las entradas del menú de Ventas (SPEC §12.1), en orden, con sus sub-vistas en orden. La primera
 * sub-vista de cada entrada es la que abre la entrada (si el rol no la ve, la primera que ve).
 */
export const ENTRADAS: Entrada[] = [
  { id: 'resumen',   label: 'Resumen',   vistas: ['resumen'] },
  { id: 'productos', label: 'Productos', vistas: ['mix', 'menueng'] },
  { id: 'equipo',    label: 'Equipo',    vistas: ['saloneros', 'salolineas', 'evaluacion', 'icp', 'cajeros', 'competencias'] },
  { id: 'tiempos',   label: 'Tiempos',   vistas: ['tiempos'] },
  { id: 'regalias',  label: 'Regalías',  vistas: ['regalias'] },
  { id: 'envivo',    label: 'En vivo',   vistas: ['envivo'] },
  { id: 'ajustes',   label: 'Ajustes',   vistas: ['metas', 'config', 'internas'] },
]

/**
 * El `v` de cada sub-vista en la dirección (SPEC §12.2, columna de la derecha: `menu`, `productos`,
 * `internas`, `lineas`, `icp`, `cajas`, `competencias`; el resto, su id de siempre). La primera
 * sub-vista de cada entrada se escribe sin `v`.
 */
export const CLAVE_V: Record<Tab, string> = {
  resumen: 'resumen',
  mix: 'mix', menueng: 'menu',
  saloneros: 'saloneros', salolineas: 'lineas', evaluacion: 'evaluacion', icp: 'icp', cajeros: 'cajas',
  competencias: 'competencias',
  tiempos: 'tiempos',
  regalias: 'regalias',
  envivo: 'envivo',
  metas: 'metas', config: 'productos', internas: 'internas',
}

/** Las vistas retiradas en la 3.5 (su `?tab=` de antes y su `v` mientras convivieron). */
export type Retirada = 'hoy' | 'ventas' | 'historico' | 'analisis' | 'calendario'

/**
 * Las vistas RETIRADAS y a dónde lleva su enlace viejo: la pestaña nueva con el período de la barra que la
 * reemplaza, el mismo con que abría la vista vieja (SPEC §12.2). Vale para el `?tab=` de antes de la 3.5 y
 * para las direcciones de sub-vista que tuvieron mientras convivieron (`desde`: `?tab=<entrada>&v=<vista>`).
 *   · 3.5.2 (D15): «Hoy» abría el último día cerrado → «Resumen», «Ayer».
 *   · 3.5.2: «Ventas» abría el mes en curso → «Resumen», «Mes» a la fecha (`mesALaFecha`; `mes` sin día es el
 *     último cerrado).
 *   · 3.5.2: «Histórico» abría los últimos 30 días → «Resumen», «Rango» con los 30 días que terminan ayer.
 *   · 3.5.3: «Análisis» (solo «Año vs Año») abría el año en curso a la fecha → «Tiempos», «Año a la fecha»
 *     (ahí está «Meses y temporadas»). Su `v` vivió en «Resumen» (3.5.1) y en «Tiempos» (3.5.2).
 *   · 3.5.3: «Calendario» abría con el mes en curso desplegado → «Tiempos», «Mes» a la fecha (el período con que
 *     abre «Tiempos»; `mes` sin día sería el último cerrado, como en «Ventas»).
 */
export const RETIRADAS: Readonly<Record<Retirada, { vista: Tab; p: TipoPeriodoV2; ultimosDias?: number; desde: readonly EntradaId[] }>> = {
  hoy:        { vista: 'resumen', p: 'ayer',         desde: ['resumen'] },
  ventas:     { vista: 'resumen', p: 'mesALaFecha',  desde: ['resumen'] },
  historico:  { vista: 'resumen', p: 'rango', ultimosDias: 30, desde: ['resumen'] },
  analisis:   { vista: 'tiempos', p: 'anioALaFecha', desde: ['resumen', 'tiempos'] },
  calendario: { vista: 'tiempos', p: 'mesALaFecha',  desde: ['tiempos'] },
}

const TAB_POR_ID = new Map(TABS.map(t => [t.id, t]))
const ENTRADA_POR_ID = new Map(ENTRADAS.map(e => [e.id as string, e]))
const esRetirada = (s: string | null): s is Retirada =>
  !!s && Object.prototype.hasOwnProperty.call(RETIRADAS, s)

export function vistasVisibles(role: string): TabDef[] {
  return TABS.filter(t => t.roles.includes(role))
}

export function puedeVer(role: string, id: string): id is Tab {
  const t = TAB_POR_ID.get(id as Tab)
  return !!t && t.roles.includes(role)
}

/** La pestaña de arranque: «Resumen» (3.5.1). Si el rol no la ve, la primera que ve. */
export function tabPorDefecto(role: string): Tab {
  if (puedeVer(role, TAB_POR_DEFECTO)) return TAB_POR_DEFECTO
  return vistasVisibles(role)[0]?.id ?? TAB_POR_DEFECTO
}

/** La dirección de una vista: su entrada y, si no es la primera de la entrada, su `v`. */
export interface Direccion { tab: EntradaId; v: string | null }

export function direccionDe(vista: Tab): Direccion {
  const e = entradaDe(vista)
  return { tab: e.id, v: e.vistas[0] === vista ? null : CLAVE_V[vista] }
}

/**
 * La corrección de la dirección. `tab === null` = se limpian `tab` y `v` (abre el arranque). `p`, si
 * viene, es el período de la barra que reemplaza a una vista retirada (y se limpian `d`, `desde`, `hasta`).
 */
export interface Correccion { tab: EntradaId | null; v: string | null; p?: TipoPeriodoV2; desde?: string; hasta?: string }

/**
 * Qué vista abre una dirección y, si hay que corregirla, la dirección que la reemplaza (sin sumar
 * un paso al «Atrás»).
 *   · `?tab=<entrada>[&v=<clave>]` → esa sub-vista, si el rol la ve.
 *   · `?tab=<vista vieja>` que el rol ve → esa vista; se reemplaza por su dirección nueva.
 *   · `?tab=hoy|ventas|historico|analisis|calendario` (o la dirección de sub-vista que tuvo mientras convivió,
 *     `RETIRADAS[x].desde`) → su pestaña nueva con el período que la reemplaza (SPEC §12.2).
 *   · Lo que el rol no ve o no existe (incluidos `paridad` y `xls`) → «Resumen», dirección limpia.
 */
export function resolverDireccion(
  role: string, tab: string | null, v: string | null, hoy: string = todayCR(),
): { vista: Tab; corregir: Correccion | null } {
  const inicio = tabPorDefecto(role)
  const limpiar = { vista: inicio, corregir: { tab: null, v: null } }
  const retirada = (clave: Retirada) => {
    const r = RETIRADAS[clave]
    if (!puedeVer(role, r.vista)) return limpiar
    const corregir: Correccion = { ...direccionDe(r.vista), p: r.p }
    if (r.ultimosDias) {
      corregir.hasta = sumarDias(hoy, -1)
      corregir.desde = sumarDias(hoy, -r.ultimosDias)
    }
    return { vista: r.vista, corregir }
  }
  if (!tab) return v ? limpiar : { vista: inicio, corregir: null }
  const entrada = ENTRADA_POR_ID.get(tab)
  if (entrada) {
    if (v === null) {
      const primera = entrada.vistas.find(x => puedeVer(role, x))
      return primera ? { vista: primera, corregir: null } : limpiar
    }
    const vista = entrada.vistas.find(x => CLAVE_V[x] === v)
    if (vista) return puedeVer(role, vista) ? { vista, corregir: null } : limpiar
    if (esRetirada(v) && RETIRADAS[v].desde.includes(entrada.id)) return retirada(v)
    return limpiar
  }
  if (esRetirada(tab)) return retirada(tab)
  if (puedeVer(role, tab)) return { vista: tab, corregir: direccionDe(tab) }
  return limpiar
}

/** La vista que abren unos parámetros de la dirección (lo que usa el menú lateral para marcar). */
export function resolverVista(role: string, sp: URLSearchParams): Tab {
  return resolverDireccion(role, sp.get('tab'), sp.get('v')).vista
}

/** Entradas que el rol ve, cada una solo con sus vistas visibles. */
export function entradasVisibles(role: string): Entrada[] {
  return ENTRADAS
    .map(e => ({ ...e, vistas: e.vistas.filter(v => puedeVer(role, v)) }))
    .filter(e => e.vistas.length > 0)
}

export function entradaDe(tab: Tab): Entrada {
  const e = ENTRADAS.find(x => x.vistas.includes(tab))
  if (!e) throw new Error(`Vista sin entrada: ${tab}`)
  return e
}

export function labelDe(tab: Tab): string {
  return TAB_POR_ID.get(tab)?.label ?? tab
}

// ── A5 · Cuándo se piden los datos de cada vista ─────────────────────────────────────────────
// Ninguna vista cambia lo que lee ni cómo calcula: cambia CUÁNDO el shell pide los datos.

/**
 * Vistas que no reciben `dias` ni `pm` (leen lo suyo): se pintan sin esperar la carga de los
 * 90 días del PoS. «Regalías» lee las líneas del período elegido en la barra (`lineasPeriodo.ts`).
 * «Tiempos» (3.5.3) lee sus años por la 190 y recibe solo `hist` (2023, lo liviano que el shell baja siempre).
 */
export const VISTAS_SIN_DIAS: ReadonlySet<Tab> = new Set<Tab>(['envivo', 'salolineas', 'resumen', 'tiempos', 'internas', 'regalias'])

/**
 * Vistas que pueden mirar más atrás de los 90 días (Mix → Comparar, rangos «Todo», competencias
 * viejas, catálogo completo): al abrirse piden la historia completa del PoS (`cargarDeFondo`).
 * Mientras llega, muestran lo mismo que antes: los 90 días + el Excel.
 */
export const VISTAS_CON_FONDO: ReadonlySet<Tab> = new Set<Tab>([
  'mix', 'metas', 'menueng', 'evaluacion', 'icp',
  'saloneros', 'cajeros', 'competencias', 'config',
])
