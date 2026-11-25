// Partes PURAS de la anonimización de staging (SPEC-anonimizar-staging), espejo de las funciones de comun.sql y
// anonimizar.sql. El SQL es el que corre; esto existe para probar las reglas con vitest sin base (anon.test.ts) y para que
// un cambio de constante en un lado sin el otro haga caer la prueba de sincronía.

export const CEDULA_FICTICIA = '999999999999'       // D7: posiciones 10–21 de la clave FE
export const IMAGEN_FICTICIA = 'anon/ficticia.png'   // D3
export const NOTA = 'Nota de prueba'
export const DOMINIO_PRUEBA = 'staging-satori.test'
export const PREFIJOS = { empleado: 'Empleado', proveedor: 'Proveedor', socio: 'Socio', cliente: 'Cliente' } as const
export type TipoAlias = keyof typeof PREFIJOS

const RE_ALIAS = /^(Empleado|Proveedor|Socio|Cliente) [0-9]{2,}$/
const RE_PRUEBA = /^(Prueba \p{L}+|Manager Prueba)$/u
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const esAlias = (v: string) => RE_ALIAS.test(v.trim())
export const esPrueba = (v: string) => RE_PRUEBA.test(v.trim())
/** Clave del mapa de alias: el mismo nombre con otra mayúscula o espacios en los bordes es la misma persona. */
export const claveAlias = (v: string) => v.trim().toLowerCase()

/** «Empleado 07» · «Socio 123» (nunca se trunca: lpad de Postgres sí truncaría, por eso el SQL usa greatest(2, largo)). */
export function aliasNumerado(tipo: TipoAlias, n: number): string {
  if (!Number.isInteger(n) || n < 1) throw new Error(`número de alias inválido: ${n}`)
  return `${PREFIJOS[tipo]} ${String(n).padStart(2, '0')}`
}

/**
 * Mapa clave → alias de un tipo, como anon_alias_grupo: cada grupo (p. ej. nombre del empleado + nombre del PoS + nombre
 * de su perfil) recibe UN alias; un valor que ya es alias o de prueba se mapea a sí mismo y arrastra a su grupo; el
 * contador arranca después del alias más alto que ya exista; los uuid quedan (inventory_movements.created_by).
 */
export function asignarAlias(tipo: TipoAlias, grupos: (string | null | undefined)[][], existentes: string[] = []): Map<string, string> {
  const mapa = new Map<string, string>()
  const re = new RegExp(`^${PREFIJOS[tipo]} ([0-9]+)$`)
  let n = Math.max(0, ...existentes.map(e => Number(re.exec(e.trim())?.[1] ?? 0)))
  for (const grupo of grupos) {
    const vals = grupo.filter((v): v is string => !!v && v.trim() !== '' && !RE_UUID.test(v.trim()))
    let alias = vals.map(v => mapa.get(claveAlias(v))).find(Boolean)
      ?? vals.find(v => esAlias(v) || esPrueba(v))?.trim()
    for (const v of vals) {
      const k = claveAlias(v)
      if (mapa.has(k)) continue
      if (esAlias(v) || esPrueba(v)) { mapa.set(k, v.trim()); continue }
      if (!alias) alias = aliasNumerado(tipo, ++n)
      mapa.set(k, alias)
    }
  }
  return mapa
}

/** Clave FE (50 dígitos): solo cambia la cédula del emisor (10–21); con otra forma, queda igual. */
export function reemplazarCedulaClave(clave: string): string {
  return /^[0-9]{50}$/.test(clave) ? clave.slice(0, 9) + CEDULA_FICTICIA + clave.slice(21) : clave
}

const D = '[0-9]{4}-[0-9]{2}-[0-9]{2}'
const TURNOS = '(Mediodía|Noche|Mañana|Tarde|AM|PM)'
const RE_SISTEMA = new RegExp(`^(Ventas efectivo ${TURNOS} |Ventas del día |Apertura pozo |Retiro dueños a banco )${D}$`)
const RE_PROPINAS = new RegExp(`^Propinas turno ${D} ${TURNOS}$`)
const RE_AJUSTE = new RegExp(`^(Ajuste de cierre ${D} · (Sobrante|Faltante))( · |$)`)
const RE_FACT = /·\s*fact\s+([0-9]{4}-[0-9]{2}-[0-9]{2})(?![0-9])/g

/** Descripción de un movimiento de caja (anon_descripcion): lo que arma el sistema queda; el texto libre no. */
export function descripcionAnonima(v: string | null): string | null {
  if (v == null || v.trim() === '') return v
  if (RE_SISTEMA.test(v) || RE_PROPINAS.test(v)) return v
  const aj = RE_AJUSTE.exec(v)
  if (aj) return `${aj[1]} · ${NOTA}`
  const facts = [...v.matchAll(RE_FACT)]
  return facts.length ? `${NOTA} · fact ${facts[facts.length - 1][1]}` : NOTA
}

/** Teléfono n (0–99) del bloque ficticio 8000 00NN, con el formato E.164 que piden los check del Club. */
export function telefonoFicticio(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 99) throw new Error(`fuera del bloque ficticio: ${n}`)
  return `+506800000${String(n).padStart(2, '0')}`
}
export const esTelefonoFicticio = (v: string) => /^(506)?800000[0-9]{2}$/.test(v.replace(/[^0-9]/g, ''))
export const esCorreoFicticio = (v: string) => /@(staging-satori\.test|example\.com)$/.test(v.trim().toLowerCase())
