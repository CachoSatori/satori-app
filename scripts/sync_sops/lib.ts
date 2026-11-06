// Sync de SoP · lógica pura (sin red ni disco), testeada en lib.test.ts.
//
// Lee el paquete de SoP (indice.json + sops/*.md) y arma el SQL que deja la tabla
// public.sops alineada: upsert por `code`, filas viejas reemplazadas → is_active=false
// (nunca se borra nada) y área provisional para lo que solo existe en la app.

export interface EntradaIndice {
  codigo: string
  titulo: string
  tipo: 'SOP' | 'Documento'
  area: string
  orden: number
  version: string
  libro_empleado: boolean
  markdown: string
  pdf: string
}

export interface FilaSop {
  code: string
  title: string
  category: string
  content: string
  display_order: number
  area: string
  doc_type: 'SOP' | 'Documento'
  version: string
  employee_book: boolean
}

export interface Mapeo {
  /** id de la fila vieja → código del paquete que la reemplaza. */
  reemplazadas: Record<string, { titulo: string; codigo: string }>
  /** id de la fila vieja que sigue activa → área provisional. */
  solo_app: Record<string, { titulo: string; area: string }>
}

export const AREAS = [
  '1. Cultura y servicio',
  '2. Salón y recepción',
  '3. Menú y producto',
  '4. Administración y caja',
  '5. Equipo',
] as const

/** Quita el front matter YAML (`---` … `---`) del principio del markdown. */
export function quitarFrontMatter(md: string): string {
  const txt = md.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  if (!txt.startsWith('---\n')) return txt.trim() + '\n'
  const fin = txt.indexOf('\n---', 4)
  if (fin < 0) throw new Error('Front matter sin cierre (---)')
  const resto = txt.slice(fin + 4).replace(/^[^\n]*\n/, '')
  return resto.trim() + '\n'
}

/** Lee el front matter (clave: valor) para validar que coincide con el índice. */
export function leerFrontMatter(md: string): Record<string, string> {
  const m = /^---\n([\s\S]*?)\n---/.exec(md.replace(/\r\n/g, '\n'))
  if (!m) return {}
  const out: Record<string, string> = {}
  for (const linea of m[1].split('\n')) {
    const i = linea.indexOf(':')
    if (i < 0) continue
    out[linea.slice(0, i).trim()] = linea.slice(i + 1).trim().replace(/^"(.*)"$/, '$1')
  }
  return out
}

/**
 * `category` se mantiene por compatibilidad (filtros viejos, editor). Se deriva del área
 * con las mismas categorías que ya usa la app.
 */
export function categoriaCompat(codigo: string, area: string): string {
  if (codigo === '2.9') return 'Delivery'
  if (codigo === '3.5' || codigo === '3.6') return 'Barra'
  if (area.startsWith('1.') || area.startsWith('2.')) return 'Servicio'
  return 'General'
}

// ── Validación de datos sensibles ────────────────────────────────────────────
// El estándar: ningún documento lleva contraseñas, teléfonos, cédulas ni correos.
// Los nombres de clientes no se pueden detectar con un patrón: se revisan a mano.

export interface Hallazgo { tipo: string; valor: string; linea: number }

const PATRONES: { tipo: string; re: RegExp }[] = [
  { tipo: 'correo', re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi },
  // Contraseña escrita: "contraseña: xxx", "clave = xxx", "password: xxx".
  { tipo: 'contraseña', re: /\b(?:contrase[ñn]a|password|clave)\s*[:=]\s*[^\s,.;]{3,}/gi },
  // Cédula física 1-2345-6789 / 1-234-567, jurídica 3-101-123456 o 3101123456.
  { tipo: 'cédula', re: /\b\d-\d{3,4}-\d{3,6}\b/g },
  { tipo: 'cédula', re: /\b3-?10[0-9]-?\d{6}\b/g },
  // Teléfono de Costa Rica: 8 dígitos que empiezan en 2, 4, 5, 6, 7 u 8, con espacio o guion
  // opcional en el medio y +506 opcional. No se aceptan rangos de años (2025-2026).
  { tipo: 'teléfono', re: /(?:\+?506[\s-]?)?\b[245678]\d{3}[\s-]?\d{4}\b/g },
]

function esRangoDeAnios(v: string): boolean {
  return /^(19|20)\d{2}[\s-](19|20)\d{2}$/.test(v.trim())
}

export function buscarSensibles(texto: string): Hallazgo[] {
  const out: Hallazgo[] = []
  const lineas = texto.split('\n')
  lineas.forEach((l, i) => {
    for (const { tipo, re } of PATRONES) {
      for (const m of l.matchAll(re)) {
        if (tipo === 'teléfono' && esRangoDeAnios(m[0])) continue
        out.push({ tipo, valor: m[0], linea: i + 1 })
      }
    }
  })
  return out
}

// ── Armado de filas y SQL ────────────────────────────────────────────────────

export function armarFila(e: EntradaIndice, markdown: string): FilaSop {
  const fm = leerFrontMatter(markdown)
  if (fm.codigo && fm.codigo !== e.codigo) {
    throw new Error(`${e.markdown}: el front matter dice código ${fm.codigo} y el índice ${e.codigo}`)
  }
  if (!(AREAS as readonly string[]).includes(e.area)) throw new Error(`${e.codigo}: área desconocida «${e.area}»`)
  if (e.tipo !== 'SOP' && e.tipo !== 'Documento') throw new Error(`${e.codigo}: tipo desconocido «${e.tipo}»`)
  return {
    code: e.codigo,
    title: e.titulo,
    category: categoriaCompat(e.codigo, e.area),
    content: quitarFrontMatter(markdown),
    display_order: e.orden,
    area: e.area,
    doc_type: e.tipo,
    version: e.version,
    employee_book: e.libro_empleado,
  }
}

/** Literal SQL seguro (standard_conforming_strings = on en Supabase). */
export function lit(v: string | number | boolean | null): string {
  if (v === null) return 'null'
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('número inválido')
    return String(v)
  }
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (v.includes('\u0000')) throw new Error('texto con NUL')
  return `'${v.replace(/'/g, "''")}'`
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * SQL de la sincronización, en una sola transacción implícita. Idempotente:
 *  · upsert por code; solo actualiza si algo cambió (updated_at no se toca en vano);
 *  · desactiva las filas viejas reemplazadas (sin borrar);
 *  · pone el área provisional a las que siguen activas solo en la app (sin tocar su texto).
 * Devuelve un resumen con lo que cambió.
 */
export function armarSql(filas: FilaSop[], mapeo: Mapeo): string {
  const codigos = new Set(filas.map(f => f.code))
  for (const [id, r] of Object.entries(mapeo.reemplazadas)) {
    if (!UUID.test(id)) throw new Error(`id inválido en mapeo: ${id}`)
    if (!codigos.has(r.codigo)) throw new Error(`${r.titulo}: el código ${r.codigo} no está en el índice`)
  }
  for (const [id, s] of Object.entries(mapeo.solo_app)) {
    if (!UUID.test(id)) throw new Error(`id inválido en mapeo: ${id}`)
    if (!(AREAS as readonly string[]).includes(s.area)) throw new Error(`${s.titulo}: área desconocida «${s.area}»`)
    if (id in mapeo.reemplazadas) throw new Error(`${s.titulo}: está como reemplazada y como solo_app`)
  }

  const valores = filas.map(f => '(' + [
    lit(f.code), lit(f.title), lit(f.category), lit(f.content), lit(f.display_order),
    lit(f.area), lit(f.doc_type), lit(f.version), lit(f.employee_book),
  ].join(', ') + ')').join(',\n  ')

  const reemplazadas = Object.keys(mapeo.reemplazadas).map(lit).join(', ')
  const soloApp = Object.entries(mapeo.solo_app)
    .map(([id, s]) => `(${lit(id)}::uuid, ${lit(s.area)})`).join(',\n  ')

  // Sin begin/commit explícitos: la Management API manda todo como UNA consulta simple y
  // Postgres la ejecuta en una única transacción implícita (o todo o nada). Así el último
  // SELECT es el que vuelve como resultado.
  return `create temp table _sync_sops (
  code text, title text, category text, content text, display_order int,
  area text, doc_type text, version text, employee_book boolean
) on commit drop;

insert into _sync_sops values
  ${valores};

create temp table _sync_res (accion text, code text, title text) on commit drop;

with up as (
  insert into public.sops as s
    (code, title, category, content, display_order, area, doc_type, version, employee_book, is_active)
  select code, title, category, content, display_order, area, doc_type, version, employee_book, true
  from _sync_sops
  on conflict (code) where code is not null do update set
    title = excluded.title, category = excluded.category, content = excluded.content,
    display_order = excluded.display_order, area = excluded.area, doc_type = excluded.doc_type,
    version = excluded.version, employee_book = excluded.employee_book, is_active = true,
    updated_at = now()
  where (s.title, s.category, s.content, s.display_order, s.area, s.doc_type, s.version, s.employee_book, s.is_active)
    is distinct from
        (excluded.title, excluded.category, excluded.content, excluded.display_order, excluded.area,
         excluded.doc_type, excluded.version, excluded.employee_book, true)
  returning s.code, s.title, (xmax = 0) as nueva
)
insert into _sync_res select case when nueva then 'insertada' else 'actualizada' end, code, title from up;

${reemplazadas ? `with d as (
  update public.sops set is_active = false, updated_at = now()
  where id in (${reemplazadas}) and code is null and is_active is distinct from false
  returning title
)
insert into _sync_res select 'desactivada', null, title from d;
` : ''}
${soloApp ? `with a as (
  update public.sops s set area = v.area, updated_at = now()
  from (values
  ${soloApp}
  ) as v(id, area)
  where s.id = v.id and s.code is null and s.area is distinct from v.area
  returning s.title
)
insert into _sync_res select 'area_provisional', null, title from a;
` : ''}
select accion, code, title from _sync_res order by accion, code nulls last, title;
`
}

/** Orden natural de códigos: 2.9 < 2.10 < 3.1. */
export function compararCodigos(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}
