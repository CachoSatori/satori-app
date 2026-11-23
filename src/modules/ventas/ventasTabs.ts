// Navegación de Ventas. Ventas v2 · 3.5.1 (SPEC-ventas-v2 §12.4): el menú pasa a seis entradas
// —Resumen · Productos · Equipo · Tiempos · En vivo · Ajustes— y las vistas viejas pasan, SIN
// TOCARLAS, a ser sub-vistas de su entrada nueva (mapa de §12.2). «Regalías» se suma en el 3.5.2.
//
// Solo pantalla: ninguna vista se borra y los roles de cada vista son los mismos de antes. La
// dirección es `/ventas?tab=<entrada>&v=<sub-vista>` (sin `v`, la primera sub-vista que el rol ve).
// Los `?tab=<vista vieja>` siguen abriendo lo mismo: se reemplaza la dirección por la nueva.
// «Paridad» y «Cargar XLS» se retiraron el 16-nov: su `?tab=` viejo abre «Resumen».

export type Tab =
  | 'hoy' | 'envivo' | 'ventas' | 'saloneros' | 'salolineas' | 'evaluacion' | 'icp'
  | 'cajeros' | 'historico' | 'mix' | 'analisis' | 'calendario' | 'menueng' | 'metas'
  | 'competencias' | 'config' | 'resumen' | 'tiempos' | 'internas'

export interface TabDef { id: Tab; label: string; roles: string[] }

/**
 * Las 19 vistas y quién ve cada una: los MISMOS roles de antes de la 3.5 (SPEC §6). El orden ya no
 * decide la pestaña de arranque (es «Resumen», `TAB_POR_DEFECTO`).
 */
export const TABS: TabDef[] = [
  { id: 'hoy',          label: 'Hoy',               roles: ['owner','manager','contador'] },
  { id: 'envivo',       label: 'En vivo',           roles: ['owner','manager','contador'] },
  { id: 'saloneros',    label: 'Saloneros',         roles: ['owner','manager'] },
  { id: 'salolineas',   label: 'Por línea',         roles: ['owner','manager'] },
  { id: 'evaluacion',   label: 'Evaluación',        roles: ['owner','manager'] },
  { id: 'icp',          label: 'ICP',               roles: ['owner','manager','contador'] },
  { id: 'cajeros',      label: 'Cajeros',           roles: ['owner','manager','contador'] },
  { id: 'ventas',       label: 'Ventas',            roles: ['owner','manager','contador'] },
  { id: 'historico',    label: 'Histórico',         roles: ['owner','manager','contador'] },
  { id: 'mix',          label: 'Mix',               roles: ['owner','manager','contador'] },
  { id: 'analisis',     label: 'Análisis',          roles: ['owner','manager','contador'] },
  { id: 'calendario',   label: 'Calendario',        roles: ['owner','manager','contador'] },
  { id: 'menueng',      label: 'Ing. Menú',         roles: ['owner','manager'] },
  { id: 'metas',        label: 'Metas',             roles: ['owner','manager','contador'] },
  { id: 'competencias', label: 'Competencias',      roles: ['owner','manager'] },
  { id: 'config',       label: 'Productos',         roles: ['owner','manager'] },
  // Ventas v2 · fase 2.1 (SPEC-ventas-v2 §5.1).
  { id: 'resumen',      label: 'Resumen',           roles: ['owner','manager','contador'] },
  // Ventas v2 · fase 2.3 (SPEC-ventas-v2 §5.4).
  { id: 'tiempos',      label: 'Tiempos',           roles: ['owner','manager','contador'] },
  // Ajustes → «Mesas internas» (mig 193; decisión del dueño 18-nov). Edita solo el owner.
  { id: 'internas',     label: 'Mesas internas',    roles: ['owner','manager'] },
]

/** 3.5.1: arranque en «Resumen» para los tres roles (SPEC §12.1; el período «Ayer» lo pone la barra). */
export const TAB_POR_DEFECTO: Tab = 'resumen'

export type EntradaId = 'resumen' | 'productos' | 'equipo' | 'tiempos' | 'envivo' | 'ajustes'

export interface Entrada { id: EntradaId; label: string; vistas: Tab[] }

/**
 * Las entradas del menú de Ventas (SPEC §12.4, 3.5.1), en orden, con sus sub-vistas en orden. La
 * primera sub-vista de cada entrada es la que abre la entrada (si el rol no la ve, la primera que ve).
 */
export const ENTRADAS: Entrada[] = [
  { id: 'resumen',   label: 'Resumen',   vistas: ['resumen', 'hoy', 'ventas', 'historico', 'analisis'] },
  { id: 'productos', label: 'Productos', vistas: ['mix', 'menueng'] },
  { id: 'equipo',    label: 'Equipo',    vistas: ['saloneros', 'salolineas', 'evaluacion', 'icp', 'cajeros', 'competencias'] },
  { id: 'tiempos',   label: 'Tiempos',   vistas: ['tiempos', 'calendario'] },
  { id: 'envivo',    label: 'En vivo',   vistas: ['envivo'] },
  { id: 'ajustes',   label: 'Ajustes',   vistas: ['metas', 'config', 'internas'] },
]

/**
 * El `v` de cada sub-vista en la dirección (SPEC §12.2, columna de la derecha: `menu`, `productos`,
 * `internas`, `lineas`, `icp`, `cajas`, `competencias`; el resto, su id de siempre). La primera
 * sub-vista de cada entrada se escribe sin `v`.
 */
export const CLAVE_V: Record<Tab, string> = {
  resumen: 'resumen', hoy: 'hoy', ventas: 'ventas', historico: 'historico', analisis: 'analisis',
  mix: 'mix', menueng: 'menu',
  saloneros: 'saloneros', salolineas: 'lineas', evaluacion: 'evaluacion', icp: 'icp', cajeros: 'cajas',
  competencias: 'competencias',
  tiempos: 'tiempos', calendario: 'calendario',
  envivo: 'envivo',
  metas: 'metas', config: 'productos', internas: 'internas',
}

const TAB_POR_ID = new Map(TABS.map(t => [t.id, t]))
const ENTRADA_POR_ID = new Map(ENTRADAS.map(e => [e.id as string, e]))

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
 * Qué vista abre una dirección y, si hay que corregirla, la dirección que la reemplaza (sin sumar
 * un paso al «Atrás»). `corregir.tab === null` = se limpian `tab` y `v` (abre el arranque).
 *   · `?tab=<entrada>[&v=<clave>]` → esa sub-vista, si el rol la ve.
 *   · `?tab=<vista vieja>` que el rol ve → esa vista; se reemplaza por su dirección nueva.
 *   · Lo que el rol no ve o no existe (incluidos `paridad` y `xls`) → «Resumen», dirección limpia.
 */
export function resolverDireccion(
  role: string, tab: string | null, v: string | null,
): { vista: Tab; corregir: { tab: EntradaId | null; v: string | null } | null } {
  const inicio = tabPorDefecto(role)
  const limpiar = { vista: inicio, corregir: { tab: null, v: null } }
  if (!tab) return v ? limpiar : { vista: inicio, corregir: null }
  const entrada = ENTRADA_POR_ID.get(tab)
  if (entrada) {
    if (v === null) {
      const primera = entrada.vistas.find(x => puedeVer(role, x))
      return primera ? { vista: primera, corregir: null } : limpiar
    }
    const vista = entrada.vistas.find(x => CLAVE_V[x] === v)
    return vista && puedeVer(role, vista) ? { vista, corregir: null } : limpiar
  }
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
 * 90 días del PoS.
 */
export const VISTAS_SIN_DIAS: ReadonlySet<Tab> = new Set<Tab>(['envivo', 'salolineas', 'resumen', 'tiempos', 'internas'])

/**
 * Vistas que pueden mirar más atrás de los 90 días (historia, año contra año, rangos «Todo»,
 * competencias viejas, catálogo completo): al abrirse piden la historia completa del PoS
 * (`cargarDeFondo`). Mientras llega, muestran lo mismo que antes: los 90 días + el Excel.
 *
 * Quedan afuera «Hoy» (mira el último día y las 4 semanas anteriores) y las de `VISTAS_SIN_DIAS`.
 */
export const VISTAS_CON_FONDO: ReadonlySet<Tab> = new Set<Tab>([
  'analisis', 'historico', 'calendario', 'mix', 'ventas', 'metas', 'menueng', 'evaluacion', 'icp',
  'saloneros', 'cajeros', 'competencias', 'config',
])
