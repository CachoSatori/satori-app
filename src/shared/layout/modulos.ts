// Módulos de la app: fuente única de la grilla de «Inicio» y del menú global (rediseño B3).
//
// Solo pantalla: los `roles` de cada módulo son los MISMOS que tenía la grilla del Inicio antes
// del menú. Este arreglo NO es un permiso: la defensa por URL sigue en `PrivateRoute` (App.tsx).
// Si se cambia un `roles` acá, se cambia también lo que ve la grilla, y el test lo marca.
import type { UserRole } from '../types/database'
import { entradasVisibles } from '../../modules/ventas/ventasTabs'

export type Grupo = 'operacion' | 'ventas' | 'equipo' | 'gestion' | 'ajustes'

export interface Module {
  id:          string
  path:        string
  label:       string
  kanji:       string
  description: string
  ready:       boolean
  roles:       UserRole[]
  /** Grupo del menú global (`PLAN.md` · Estructura). */
  grupo:       Grupo
  /** Nombre en el menú, si no es el de la tarjeta. */
  menuLabel?:  string
}

export const MODULES: Module[] = [
  {
    id: 'resumen', path: '/resumen', label: 'Resumen', kanji: '日',
    description: 'Cuadre del día', ready: true,
    roles: ['owner', 'manager', 'contador'], grupo: 'gestion',
  },
  {
    id: 'semana', path: '/semana', label: 'Semana', kanji: '週',
    description: 'Digest semanal', ready: true,
    roles: ['owner', 'manager', 'contador'], grupo: 'gestion',
  },
  {
    id: 'reporte-mensual', path: '/reporte-mensual', label: 'Reporte Mensual', kanji: '月',
    description: 'Ventas · Propinas · Caja', ready: true,
    roles: ['owner', 'manager', 'contador'], grupo: 'gestion',
  },
  {
    id: 'mi-turno', path: '/mi-turno', label: 'Mi Turno', kanji: '番',
    description: 'Mis ventas · propinas · cierre', ready: true,
    roles: ['salonero', 'barman'], grupo: 'equipo',
  },
  {
    id: 'mi-rendimiento', path: '/mi-rendimiento', label: 'Mi Rendimiento', kanji: '人',
    description: 'Mis stats del turno', ready: true,
    // manager: SOLO su propio rendimiento · owner: además «Ver como» a otro empleado (solo lectura).
    roles: ['salonero', 'barman', 'barback', 'runner', 'cocina', 'manager', 'owner'], grupo: 'equipo',
  },
  // "Mis Propinas" ya vive como pestaña dentro de Mi Rendimiento → card redundante removida.
  // La ruta /mis-propinas sigue redirigiendo a /mi-rendimiento?tab=propinas (App.tsx), sin romper links viejos.
  {
    id: 'cash', path: '/caja', label: 'Caja', kanji: '金',
    description: 'Turnos y movimientos', ready: true,
    roles: ['owner', 'manager', 'cajero', 'contador'], grupo: 'operacion',
  },
  {
    id: 'comandero', path: '/comandero', label: 'Comandero', kanji: '卓',
    description: 'Mesas y pedidos (PoS)', ready: true,
    roles: ['owner', 'manager', 'salonero', 'barman', 'cajero'], grupo: 'operacion',
  },
  {
    id: 'kds', path: '/kds', label: 'KDS', kanji: '厨',
    description: 'Pantalla de cocina/barra', ready: true,
    roles: ['owner', 'manager', 'cocina', 'barman'], grupo: 'operacion',
  },
  {
    id: 'tips', path: '/propinas', label: 'Propinas', kanji: '心',
    description: 'Pool del turno', ready: true,
    roles: ['owner', 'manager', 'cajero', 'contador'], grupo: 'operacion',
  },
  {
    id: 'dashboard', path: '/ventas', label: 'Ventas', kanji: '売',
    description: 'KPIs y metas', ready: true,
    roles: ['owner', 'manager', 'contador'], grupo: 'ventas',
  },
  {
    id: 'inventario', path: '/inventario', label: 'Inventario', kanji: '庫',
    description: 'Stock · Recetas · Costos', ready: true,
    roles: ['owner', 'manager', 'contador'], grupo: 'gestion',
  },
  {
    id: 'clientes', path: '/clientes', label: 'Clientes', kanji: '客',
    description: 'CRM · Fidelización', ready: true,
    roles: ['owner', 'manager', 'cajero'], grupo: 'gestion',
  },
  {
    id: 'finanzas', path: '/finanzas', label: 'Finanzas', kanji: '財',
    description: 'P&L · Presupuesto vs Real', ready: true,
    roles: ['owner', 'manager', 'contador'], grupo: 'gestion',
  },
  {
    id: 'salarios', path: '/salarios', label: 'Salarios', kanji: '給',
    description: 'Tarifas · Nómina', ready: true,
    roles: ['owner', 'manager'], grupo: 'equipo',
  },
  {
    id: 'sops', path: '/sops', label: 'SOPs', kanji: '書',
    description: 'Procedimientos', ready: true,
    roles: ['owner', 'manager', 'cajero', 'salonero', 'barman', 'barback', 'runner', 'cocina'],
    grupo: 'equipo', menuLabel: 'Procedimientos',
  },
  {
    id: 'admin', path: '/admin', label: 'Admin', kanji: '管',
    description: 'Empleados · Config', ready: true,
    roles: ['owner'], grupo: 'ajustes',
  },
  {
    id: 'prueba', path: '/prueba', label: 'Prueba', kanji: '試',
    description: '🧪 Simulador · solo lectura', ready: true,
    roles: ['owner'], grupo: 'ajustes',
  },
]

/** Los módulos que ve un rol: el mismo filtro de la grilla del Inicio, en el mismo orden. */
export function modulosPara(role: string): Module[] {
  return MODULES.filter(m => (m.roles as string[]).includes(role))
}

// ── Menú global ────────────────────────────────────────────────

/** Orden y nombre de los grupos del menú (`PLAN.md`). «Inicio» va siempre primero, aparte. */
export const GRUPOS: { id: Grupo; label: string }[] = [
  { id: 'operacion', label: 'Operación' },
  { id: 'ventas',    label: 'Ventas' },
  { id: 'equipo',    label: 'Equipo' },
  { id: 'gestion',   label: 'Gestión' },
  { id: 'ajustes',   label: 'Ajustes' },
]

/** Orden dentro de cada grupo (por id de módulo). */
const ORDEN_EN_GRUPO: Record<Grupo, string[]> = {
  operacion: ['cash', 'tips', 'comandero', 'kds'],
  ventas:    ['dashboard'],
  equipo:    ['mi-turno', 'mi-rendimiento', 'sops', 'salarios'],
  gestion:   ['resumen', 'semana', 'reporte-mensual', 'finanzas', 'inventario', 'clientes'],
  ajustes:   ['admin', 'prueba'],
}

export interface ItemMenu {
  /** Clave única del ítem (módulo, o `dashboard:<entrada>` para Ventas). */
  key:      string
  /** El módulo de la grilla al que pertenece. */
  moduloId: string
  label:    string
  kanji:    string
  /** Destino: ruta del módulo, o `/ventas?tab=…`. */
  to:       string
  /** Solo Ventas: la entrada del menú de Ventas (para marcar la activa). */
  entrada?: string
}

export interface GrupoMenu { id: Grupo; label: string; items: ItemMenu[] }

/** Un rol con esta cantidad de módulos o menos no lleva menú (`PLAN.md`). */
export const MIN_MODULOS_MENU = 4

export function llevaMenu(role: string): boolean {
  return modulosPara(role).length >= MIN_MODULOS_MENU
}

/**
 * El menú global de un rol: los módulos de su grilla, agrupados. Ventas se abre en sus entradas
 * (`/ventas?tab=<primera vista visible de la entrada>`), con el mismo filtro por rol de A2.
 */
export function menuPara(role: string): GrupoMenu[] {
  const mods = modulosPara(role)
  return GRUPOS.map(g => {
    const enGrupo = mods
      .filter(m => m.grupo === g.id)
      .sort((a, b) => ORDEN_EN_GRUPO[g.id].indexOf(a.id) - ORDEN_EN_GRUPO[g.id].indexOf(b.id))
    const items: ItemMenu[] = enGrupo.flatMap(m => {
      if (m.id === 'dashboard') {
        const entradas = entradasVisibles(role)
        if (entradas.length === 0) return [itemDe(m)]
        return entradas.map(e => ({
          key: `dashboard:${e.id}`, moduloId: m.id, label: ENTRADA_LABEL[e.id] ?? e.label, kanji: m.kanji,
          to: `${m.path}?tab=${e.vistas[0]}`, entrada: e.id,
        }))
      }
      return [itemDe(m)]
    })
    return { id: g.id, label: g.label, items }
  }).filter(g => g.items.length > 0)
}

/** En el menú global, «Ajustes» de Ventas se aclara para no confundirse con el grupo «Ajustes». */
const ENTRADA_LABEL: Record<string, string> = { ajustes: 'Ajustes de Ventas' }

function itemDe(m: Module): ItemMenu {
  return { key: m.id, moduloId: m.id, label: m.menuLabel ?? m.label, kanji: m.kanji, to: m.path }
}

// ── Barra inferior (celular) ───────────────────────────────────

/** Qué módulos van primero en la barra inferior. Los que no entran quedan en «Más». */
const PRIORIDAD_BARRA = [
  'cash', 'tips', 'dashboard', 'mi-turno', 'mi-rendimiento', 'comandero', 'kds',
  'resumen', 'sops', 'inventario', 'finanzas', 'clientes', 'semana', 'reporte-mensual',
  'salarios', 'admin', 'prueba',
]

export const MAX_BOTONES_BARRA = 5

export interface Barra {
  /** Botones directos (sin contar «Inicio», que va siempre primero). */
  directos: Module[]
  /** ¿Lleva el botón «Más»? */
  conMas:   boolean
}

/**
 * La barra inferior: «Inicio» + módulos, hasta 5 botones. Si no entran todos, el quinto es «Más»
 * y abre el menú completo.
 */
export function barraPara(role: string): Barra {
  const mods = [...modulosPara(role)].sort(
    (a, b) => PRIORIDAD_BARRA.indexOf(a.id) - PRIORIDAD_BARRA.indexOf(b.id),
  )
  const lugares = MAX_BOTONES_BARRA - 1          // uno es «Inicio»
  if (mods.length <= lugares) return { directos: mods, conMas: false }
  return { directos: mods.slice(0, lugares - 1), conMas: true }
}
