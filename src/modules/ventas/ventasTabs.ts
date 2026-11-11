// Navegación de Ventas (rediseño A2): las 18 vistas de siempre, agrupadas en entradas.
// Solo pantalla: ninguna vista se borra, los roles de cada vista son los mismos de antes y la
// pestaña de arranque de cada rol no cambia (es la primera vista visible en el orden de `TABS`).

export type Tab =
  | 'hoy' | 'envivo' | 'paridad' | 'ventas' | 'saloneros' | 'salolineas' | 'evaluacion' | 'icp'
  | 'cajeros' | 'historico' | 'mix' | 'analisis' | 'calendario' | 'menueng' | 'metas'
  | 'competencias' | 'xls' | 'config'

export interface TabDef { id: Tab; label: string; roles: string[] }

/**
 * Las 18 vistas, en el MISMO orden que tenían antes del rediseño. El orden importa: la pestaña
 * por defecto de cada rol es la primera de esta lista que el rol puede ver.
 */
export const TABS: TabDef[] = [
  { id: 'hoy',          label: 'Hoy',               roles: ['owner','manager','contador'] },
  { id: 'envivo',       label: 'En vivo',           roles: ['owner','manager','contador'] },
  // P3, TEMPORAL: diagnóstico para firmar el swap de fuente. Solo owner.
  { id: 'paridad',      label: 'Paridad (validación)', roles: ['owner'] },
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
  { id: 'xls',          label: 'Cargar XLS',        roles: ['owner','manager'] },
  { id: 'config',       label: 'Productos',         roles: ['owner','manager'] },
]

export interface Entrada { id: string; label: string; vistas: Tab[] }

/** Las entradas del menú de Ventas (`PLAN.md`): 7 + «Ajustes». */
export const ENTRADAS: Entrada[] = [
  { id: 'hoy',       label: 'Hoy',         vistas: ['hoy'] },
  { id: 'envivo',    label: 'En vivo',     vistas: ['envivo'] },
  { id: 'saloneros', label: 'Saloneros',   vistas: ['saloneros', 'salolineas', 'evaluacion', 'icp', 'competencias'] },
  { id: 'analisis',  label: 'Análisis',    vistas: ['analisis'] },
  { id: 'historico', label: 'Histórico',   vistas: ['historico', 'calendario', 'mix', 'ventas', 'cajeros'] },
  { id: 'menueng',   label: 'Ing. Menú',   vistas: ['menueng'] },
  { id: 'metas',     label: 'Metas',       vistas: ['metas'] },
  { id: 'ajustes',   label: 'Ajustes',     vistas: ['paridad', 'xls', 'config'] },
]

const TAB_POR_ID = new Map(TABS.map(t => [t.id, t]))

export function vistasVisibles(role: string): TabDef[] {
  return TABS.filter(t => t.roles.includes(role))
}

export function puedeVer(role: string, id: string): id is Tab {
  const t = TAB_POR_ID.get(id as Tab)
  return !!t && t.roles.includes(role)
}

/** La pestaña de arranque: la misma de antes del rediseño (primera visible en `TABS`). */
export function tabPorDefecto(role: string): Tab {
  return vistasVisibles(role)[0]?.id ?? 'hoy'
}

/** `?tab=` válido y visible para el rol → esa vista; si no, la de arranque. */
export function resolverTab(role: string, param: string | null): Tab {
  return param && puedeVer(role, param) ? param : tabPorDefecto(role)
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
