// ── Ventas v2 · 3.1b — «Ajustes → Catálogo» — PURO ─────────────────────────────────────────────────────────────
//
// Sin I/O ni reloj (el «hoy» entra por parámetro). Arma la lista de la pantalla a partir de `pos_catalogo_productos`
// (mig 198) y decide qué se puede tocar. Reglas (SPEC-3.1-catalogo §1.3, §2.2, §2.3, §8.2):
//
//   · LA CATEGORÍA LA DECIDE LA BASE: cada producto trae la vigente. Acá no se recalcula; solo se ofrece cambiarla.
//   · Una categoría FIJA (la de regalías, personal, ingredientes, gift cards, pax y dueños) se muestra bloqueada: la fija
//     la familia. Su «rinde» sí se puede cambiar. La lista de fijas y la de editables vienen en la respuesta.
//   · «cortesia» se muestra «Regalías» (la clave de la base no cambia).
//   · Orden: categoría (orden de `CATEGORIAS`) → orden de la familia → nombre.
//   · «Nuevo» = visto por primera vez en los últimos 30 días (S9). «Los que cambié» = tiene categoría propia o rinde > 1.
//   · Nombre de familia: mismas reglas que la 204 (1 a 40 caracteres, lista cerrada). La base es la que manda; esto es
//     para avisar antes de mandar.

import type { CatalogoAjusteRpc, CatalogoProductosRpc, FamiliaPosRpc } from '../../shared/api/posNdf'
import { CATEGORIAS, nombreFamilia } from './catalogoPos'
import { sumarDias } from './periodos'

/** Cómo se lee cada categoría en pantalla. */
export const ROTULO_CATEGORIA: Readonly<Record<string, string>> = {
  comida: 'Comida',
  bebida: 'Bebida',
  menu_especial: 'Menú especial',
  extras: 'Extras',
  otros: 'Otros',
  merch: 'Merch',
  giftcard: 'Gift cards',
  pax: 'Pax',
  duenos: 'Dueños',
  cortesia: 'Regalías',
  personal: 'Consumo del personal',
  ingredientes: 'Ingredientes',
}

export const rotuloCategoria = (c: string): string => ROTULO_CATEGORIA[c] ?? c

/** Productos por página («Mostrar N más»). */
export const POR_PAGINA = 100
/** Quién edita «rinde» y categoría (D-7). El nombre de una familia, solo el owner (mig 204). */
export const ROLES_EDITAN_CATALOGO: readonly string[] = ['owner', 'manager']

/** El error de la base, en palabras para la persona. */
export function mensajeError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e ?? '')
  if (/No autorizado/i.test(m)) return 'No tenés permiso para cambiar esto en este local.'
  if (/fija su familia/i.test(m)) return 'La categoría de este producto la fija su familia.'
  return m ? `No se pudo guardar: ${m}` : 'No se pudo guardar.'
}

/** Días hacia atrás que cuentan como «nuevo» (S9). */
export const DIAS_NUEVO = 30
export const RINDE_MIN = 1
export const RINDE_MAX = 20

export interface FiltrosCatalogo {
  /** Nombre o código, sin mayúsculas ni tildes. */
  buscar:    string
  /** '' = todas. */
  categoria: string
  /** null = todas. */
  familia:   number | null
  cambiados: boolean
  nuevos:    boolean
}

export const FILTROS_VACIOS: FiltrosCatalogo = { buscar: '', categoria: '', familia: null, cambiados: false, nuevos: false }

export interface FilaCatalogo extends CatalogoAjusteRpc {
  familiaNombre:     string
  /** La categoría por defecto de su familia (la que vuelve con «De su familia»). */
  categoriaFamilia:  string
  /** La categoría la fija la familia: no se puede elegir otra. */
  bloqueada:         boolean
  cambiado:          boolean
  nuevo:             boolean
  /** La familia no tiene fila en `pos_familias` (sale «Familia N»). */
  familiaSinFila:    boolean
}

const sinTildes = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const ordenCategoria = (c: string): number => {
  const i = (CATEGORIAS as readonly string[]).indexOf(c)
  return i === -1 ? CATEGORIAS.indexOf('otros') : i
}

export function esNuevo(vistoDesde: string, hoy: string): boolean {
  return vistoDesde >= sumarDias(hoy, -DIAS_NUEVO)
}

/** Todas las filas del catálogo, con lo que la pantalla necesita, en el orden de la SPEC. */
export function armarCatalogo(rpc: CatalogoProductosRpc, hoy: string): FilaCatalogo[] {
  const fam = new Map<number, FamiliaPosRpc>(rpc.familias.map(f => [f.familia, f]))
  const fijas = new Set(rpc.categoriasFijas)
  const filas = rpc.productos.map((p): FilaCatalogo => {
    const f = p.familia !== null ? fam.get(p.familia) : undefined
    return {
      ...p,
      familiaNombre: nombreFamilia(p.familia, rpc.familias),
      categoriaFamilia: f?.categoria ?? 'otros',
      bloqueada: fijas.has(p.categoria),
      cambiado: p.categoriaPropia !== null || p.rinde > 1,
      nuevo: esNuevo(p.vistoDesde, hoy),
      familiaSinFila: p.familia !== null && !f,
    }
  })
  return filas.sort((a, b) =>
    ordenCategoria(a.categoria) - ordenCategoria(b.categoria)
    || (fam.get(a.familia ?? -1)?.orden ?? 999) - (fam.get(b.familia ?? -1)?.orden ?? 999)
    || (a.familia ?? 9999) - (b.familia ?? 9999)
    || a.nombre.localeCompare(b.nombre, 'es')
    || a.codigo.localeCompare(b.codigo))
}

export function filtrarCatalogo(filas: readonly FilaCatalogo[], f: FiltrosCatalogo): FilaCatalogo[] {
  const q = sinTildes(f.buscar.trim())
  return filas.filter(p =>
    (!q || sinTildes(p.nombre).includes(q) || p.codigo.toLowerCase().includes(q))
    && (!f.categoria || p.categoria === f.categoria)
    && (f.familia === null || p.familia === f.familia)
    && (!f.cambiados || p.cambiado)
    && (!f.nuevos || p.nuevo))
}

/** Lo que se manda al guardar una ficha: los DOS valores, el que cambió y el que ya tenía. */
export interface Ficha { rinde: number; categoria: string | null }

/** Un «rinde» que se puede mandar: entero de 1 a 20. */
export function rindeValido(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= RINDE_MIN && v <= RINDE_MAX
}

/**
 * La ficha a mandar cuando la persona cambia la categoría. '' = «De su familia» → null. En un producto bloqueado la
 * categoría no se manda distinta (la base la rechaza igual): se devuelve null.
 */
export function fichaConCategoria(p: Pick<FilaCatalogo, 'rinde' | 'categoriaPropia' | 'bloqueada'>, elegida: string): Ficha | null {
  if (p.bloqueada) return null
  const categoria = elegida === '' ? null : elegida
  if (categoria === p.categoriaPropia) return null
  return { rinde: p.rinde, categoria }
}

/** La ficha a mandar cuando la persona cambia el «rinde». null = no se manda (inválido o igual). */
export function fichaConRinde(p: Pick<FilaCatalogo, 'rinde' | 'categoriaPropia'>, rinde: unknown): Ficha | null {
  if (!rindeValido(rinde) || rinde === p.rinde) return null
  return { rinde, categoria: p.categoriaPropia }
}

// ── Nombre de una familia (mig 204) ─────────────────────────────────────────────────────────────────────────────
export const NOMBRE_FAMILIA_MAX = 40
const NOMBRE_FAMILIA_OK = /^[A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ ().,/&'+#-]+$/

/** Como lo guarda la 204: sin espacios a los costados ni repetidos (un salto de línea o un tab cuentan como espacio). */
export function normalizarNombreFamilia(s: string): string {
  return s.trim().replace(/\s+/g, ' ')
}

/** null si el nombre se puede mandar; si no, el aviso para la persona. */
export function errorNombreFamilia(s: string): string | null {
  const n = normalizarNombreFamilia(s)
  if (!n) return 'Escribí un nombre.'
  if (n.length > NOMBRE_FAMILIA_MAX) return `Hasta ${NOMBRE_FAMILIA_MAX} caracteres (tiene ${n.length}).`
  if (!NOMBRE_FAMILIA_OK.test(n)) return 'Solo letras, números, espacios y ( ) . , - / & \' + #.'
  return null
}
