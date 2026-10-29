// ── El mapa de códigos del PoS: código → PERSONA y ROL (Parte B, paso 2) ───────────────────
//
// Módulo PURO: sin I/O, sin Supabase, sin reloj. Es la única fuente de verdad sobre "quién es
// el código que comandó esta línea y si cuenta para el ranking de meseros".
//
// ── POR QUÉ UN MAPA Y NO UNA REGLA ─────────────────────────────────────────────────────────
// La forma del código NO dice nada. El supuesto viejo del esquema («`01`/`02` = sistema») está
// MAL: `01` es ROSAURA, una salonera de carne y hueso, y sus ventas se estaban tirando a la
// basura. Los "misterios" `266` y `333` tampoco eran ruido: son NACHO y Emma. Por eso acá no
// hay heurística ninguna — se clasifica por esta tabla, curada a mano contra la data 2024-2026
// y FIRMADA por el dueño el 2026-09-07 (ver `claude/SPEC-saloneros-por-linea.md`).
//
// ── DOS EJES DISTINTOS, NO MEZCLAR ─────────────────────────────────────────────────────────
//   · Este mapa clasifica el `usuario_registra` de la LÍNEA: quién comandó.
//   · `jornada.ts` clasifica el `cajero_login` de la FACTURA: qué caja cobró (= el turno).
//   Un mismo número puede vivir en los dos ejes sin contradicción: `111` es una CAJA acá
//   (rol `caja`, fuera del ranking) y es el turno mañana allá.
//
// ── NO SE TIRA LA PLATA DE NADIE ───────────────────────────────────────────────────────────
// Todo código cae en algún balde, y los cuatro baldes suman la neta del día:
//   Σ(meseros) + caja + genérico + otro = neta del día
// El ranking muestra solo `mesero`; los otros tres cuentan igual en el total. Esa igualdad es
// la que hace que la lente A sea auditable, y está clavada en un test.

import { SALONEROS_CONOCIDOS } from './mapTicket.ts'

/**
 * En qué balde cae un código.
 *
 * · `mesero`   → va al ranking.
 * · `caja`     → `111` / `222` / `388`. Cobra, no comanda; fuera del ranking.
 * · `generico` → `02`, el login compartido. Son ventas REALES (₡44,9M en 1.126 facturas con
 *                plata, solo 6 en ₡0 → NO es comida de personal), pero no se le pueden atribuir
 *                a una persona, así que no entran al ranking.
 * · `otro`     → la línea vino sin código (10 en todo el histórico, ₡40k) o con uno que este
 *                mapa no conoce. Ver `clasificarCodigo`.
 */
export type RolCodigo = 'mesero' | 'caja' | 'generico' | 'otro'

/** Una persona (o balde) del PoS. Varios códigos pueden ser la MISMA persona. */
export interface PersonaNdf {
  /** Clave estable. Para una persona real es su código canónico (el activo / principal). */
  id:       string
  rol:      RolCodigo
  /**
   * Nombre de RESPALDO, curado a mano.
   *
   * El nombre bueno sale de `employees` (alimentada de `FAC_Empleados`, roster completo
   * incluidos INACTIVOS) buscando por el código canónico; este solo se usa si esa tabla no
   * tiene la fila, para que la pantalla nunca muestre un número pelado.
   */
  etiqueta: string
  /** Todos los códigos que son esta persona, el canónico primero. */
  codigos:  readonly string[]
  /** Ya no trabaja acá. Solo informativo: su histórico se muestra igual. */
  inactivo?: boolean
}

/** El código que se usa como id cuando la línea no trae ninguno. */
export const SIN_CODIGO = '(sin codigo)'

// ── La tabla ───────────────────────────────────────────────────────────────────────────────
//
// Para agregar un mesero nuevo: UNA fila acá. Para unificar dos códigos en una persona: los dos
// códigos en `codigos`, el canónico primero. Nada más se toca.

const PERSONAS: readonly PersonaNdf[] = [
  // ── MESEROS (los del ranking) ──
  { id: '0909', rol: 'mesero', etiqueta: 'Rocío',     codigos: ['0909'] },
  { id: '333',  rol: 'mesero', etiqueta: 'Emma',      codigos: ['333']  },
  { id: '999',  rol: 'mesero', etiqueta: 'Jazmín',    codigos: ['999'],  inactivo: true },
  { id: '444',  rol: 'mesero', etiqueta: 'Maxi',      codigos: ['444']  },
  { id: '026',  rol: 'mesero', etiqueta: 'Maxo',      codigos: ['026']  },
  { id: '028',  rol: 'mesero', etiqueta: 'Francisco', codigos: ['028']  },
  { id: '03',   rol: 'mesero', etiqueta: 'Alan',      codigos: ['03']   },
  { id: '027',  rol: 'mesero', etiqueta: 'Guille',    codigos: ['027']  },
  { id: '025',  rol: 'mesero', etiqueta: 'Dolores',   codigos: ['025']  },
  { id: '032',  rol: 'mesero', etiqueta: 'Gonza',     codigos: ['032']  },
  { id: '029',  rol: 'mesero', etiqueta: 'Ignacio',   codigos: ['029']  },
  { id: '034',  rol: 'mesero', etiqueta: 'Ine',       codigos: ['034']  },
  { id: '024',  rol: 'mesero', etiqueta: 'Juancho',   codigos: ['024']  },
  { id: '04',   rol: 'mesero', etiqueta: 'Wesley',    codigos: ['04'],   inactivo: true },
  { id: '030',  rol: 'mesero', etiqueta: 'Jota',      codigos: ['030']  },
  { id: '033',  rol: 'mesero', etiqueta: 'Federico',  codigos: ['033']  },
  // Barmen: también comandan y van al ranking (firmado por Ismael, 2026-10-29).
  { id: '035',  rol: 'mesero', etiqueta: 'Rodri',     codigos: ['035']  },
  { id: '036',  rol: 'mesero', etiqueta: 'Franco',    codigos: ['036']  },
  { id: '037',  rol: 'mesero', etiqueta: 'Valentino', codigos: ['037']  },
  // Los casos de unificación, curados a mano. Una sola fila cada uno, el canónico primero:
  //   · `01` es la salonera ROSAURA y `235` su login de manager ("M").
  //   · `023` es el activo de ESTEBAN y `555` el viejo.
  //   · `038` es el login NUEVO de NACHO; `266` es su histórico (borrado del PoS 2026-10-29).
  { id: '01',   rol: 'mesero', etiqueta: 'Rosaura',   codigos: ['01', '235']  },
  { id: '023',  rol: 'mesero', etiqueta: 'Esteban',   codigos: ['023', '555'] },
  { id: '038',  rol: 'mesero', etiqueta: 'Nacho',     codigos: ['038', '266'] },

  // ── CAJA (cobra, no comanda) ──
  // Son los mismos logins que en `jornada.ts` definen el turno. Acá aparecen como AUTORES de
  // línea, que es otra cosa: una línea comandada desde la caja no es de ningún mesero.
  { id: '111',  rol: 'caja', etiqueta: 'Caja mañana', codigos: ['111'] },
  { id: '222',  rol: 'caja', etiqueta: 'Caja noche',  codigos: ['222'] },
  { id: '388',  rol: 'caja', etiqueta: 'Caja bar',    codigos: ['388'] },

  // ── GENÉRICO ──
  { id: '02',   rol: 'generico', etiqueta: 'Login compartido (xx)', codigos: ['02'] },
]

/** `código → persona`. Se arma una sola vez; incluye TODOS los alias, no solo el canónico. */
const POR_CODIGO: ReadonlyMap<string, PersonaNdf> = new Map(
  PERSONAS.flatMap(p => p.codigos.map(c => [c, Object.freeze(p)] as const)),
)

/** El balde de los códigos sin dueño conocido. Uno por código, para no perder de vista cuál era. */
const desconocidas = new Map<string, PersonaNdf>()

/**
 * `usuario_registra` de una línea → su persona.
 *
 * NUNCA devuelve `null`: la plata de una línea siempre tiene que caer en algún balde (regla 4
 * de la firma). Los tres casos que no están en la tabla:
 *
 * · Sin código (`null` / vacío) → la persona `(sin codigo)`, rol `otro`. Son 10 líneas en todo
 *   el histórico (₡40k).
 * · Código que la tabla no conoce → rol `otro`, conservando el código como id y como etiqueta.
 *   NO se adivina que es un mesero: si mañana entra alguien nuevo, su plata aparece en el balde
 *   "otro" con su código a la vista, y eso es justamente la señal de que hay que agregarlo a la
 *   tabla de arriba. Adivinar sería repetir el error de `01`.
 * · Espacios alrededor → se recortan antes de buscar.
 */
export function clasificarCodigo(codigo: string | null | undefined): PersonaNdf {
  const c = (codigo ?? '').trim()
  if (c === '') return PERSONA_SIN_CODIGO
  const conocida = POR_CODIGO.get(c)
  if (conocida) return conocida
  let suelta = desconocidas.get(c)
  if (!suelta) {
    suelta = Object.freeze({ id: c, rol: 'otro' as const, etiqueta: c, codigos: Object.freeze([c]) })
    desconocidas.set(c, suelta)
  }
  return suelta
}

const PERSONA_SIN_CODIGO: PersonaNdf = Object.freeze({
  id:       SIN_CODIGO,
  rol:      'otro' as const,
  etiqueta: 'Sin código',
  codigos:  Object.freeze([]),
})

/** El rol de un código, sin pasar por la persona. */
export function rolDeCodigo(codigo: string | null | undefined): RolCodigo {
  return clasificarCodigo(codigo).rol
}

/** ¿Va al ranking de meseros? */
export function esMesero(codigo: string | null | undefined): boolean {
  return rolDeCodigo(codigo) === 'mesero'
}

/** Las personas de la tabla, en el orden en que están escritas. Para tests y para la vista. */
export function personasConocidas(): readonly PersonaNdf[] {
  return PERSONAS
}

/**
 * El nombre a mostrar de una persona. Es LA regla de nombre de todas las vistas de ventas:
 * el ranking por factura (`nombreSalonero`) y las lentes por línea la usan igual, así que una
 * persona con dos códigos sale con el MISMO nombre en una sola fila en todas partes.
 *
 * Tres capas, y en cada una se busca por TODOS los códigos de la persona, el canónico primero:
 *   1. `employees` (`pos_login → full_name`): el nombre que el dueño mantiene. Así ROSAURA sale
 *      con su nombre aunque el `pos_login` cargado sea el de su login de manager.
 *   2. `SALONEROS_CONOCIDOS`, el roster que viaja con el código, para el entorno que todavía
 *      no tiene `pos_login` cargado.
 *   3. La etiqueta curada. Nunca se muestra un número solo.
 */
export function nombreDePersona(
  persona: PersonaNdf,
  nombres: Readonly<Record<string, string>>,
): string {
  for (const c of persona.codigos) {
    const n = nombres[c]?.trim()
    if (n) return n
  }
  for (const c of persona.codigos) {
    const n = SALONEROS_CONOCIDOS[c]?.trim()
    if (n) return n
  }
  return persona.etiqueta
}

// ── El vínculo empleado → ventas ───────────────────────────────────────────────────────────
//
// Mi Rendimiento e ICP tienen un EMPLEADO y buscan su fila de ventas, que es la clave del ranking
// (`DiaData.saloneros`). Antes buscaban solo por `pos_name`, el nombre del Excel: con ventas del
// PoS la clave es el nombre de la persona y no coincide (034 PECHE/INE, 035 RODRI/RODRIGO BAR,
// 444 MAXI BARRA/Maxi, mayúsculas de 025/029/030, FRANCO y VALENTINO sin `pos_name`), y esos
// empleados se veían en cero. Ahora se busca primero por `pos_login` con LA MISMA regla de nombre
// que arma el ranking, y solo si no hay match se cae a `pos_name` — el modo Excel queda igual.

/**
 * El nombre con el que un login del PoS aparece en el ranking, o `null` si no hay ninguno.
 *
 * Persona conocida → `nombreDePersona` (sus alias dan el mismo nombre). Si no: `employees` y
 * después el roster. Es la regla que usa `nombreSalonero` (que además marca «sin asignar").
 */
export function nombreDeCodigo(
  codigo: string | null | undefined,
  nombres: Readonly<Record<string, string>>,
): string | null {
  const c = (codigo ?? '').trim()
  if (c === '') return null
  const persona = clasificarCodigo(c)
  if (persona.rol === 'mesero') return nombreDePersona(persona, nombres)
  return nombres[c]?.trim() || SALONEROS_CONOCIDOS[c]?.trim() || null
}

/** Lo mínimo de un empleado para vincularlo. `pos_login` es opcional en el tipo de la app. */
export interface EmpleadoVinculable {
  full_name?: string | null
  pos_name?:  string | null
  pos_login?: string | null
}

/**
 * `pos_login → full_name` de una lista de empleados: el mismo mapa que lee el ranking
 * (`getSaloneroNombres`), armado de lo que la vista ya tiene cargado.
 */
export function nombresDeEmpleados(empleados: readonly EmpleadoVinculable[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const e of empleados) {
    const login = (e.pos_login ?? '').trim()
    const nombre = (e.full_name ?? '').trim()
    if (login && nombre) out[login] = nombre
  }
  return out
}

/**
 * La clave de ventas del empleado POR SU `pos_login`, solo si esa clave existe en los datos
 * cargados (`claves` = `allSaloneros(dias)`). `null` = no hay match: el que llama sigue con su
 * regla de antes (`pos_name`).
 */
export function claveDeEmpleadoPorLogin(
  empleado: EmpleadoVinculable | null | undefined,
  nombres: Readonly<Record<string, string>>,
  claves: readonly string[],
): string | null {
  const clave = nombreDeCodigo(empleado?.pos_login, nombres)
  return clave !== null && claves.includes(clave) ? clave : null
}

/**
 * La clave de ventas del empleado: por `pos_login` si matchea; si no, su `pos_name` tal cual
 * (el comportamiento de siempre, que es el del modo Excel). `null` = sin vínculo.
 */
export function claveDeEmpleado(
  empleado: EmpleadoVinculable | null | undefined,
  nombres: Readonly<Record<string, string>>,
  claves: readonly string[],
): string | null {
  return claveDeEmpleadoPorLogin(empleado, nombres, claves) ?? (empleado?.pos_name?.trim() || null)
}

/**
 * Bajo qué claves (ya normalizadas con `norm`) van las propinas de un empleado en el ICP.
 *
 * Si su `pos_login` da una clave que existe en los datos, va SOLO ahí. Si no, las claves de
 * siempre: `pos_name` y `full_name` (las dos, si difieren) — el comportamiento del modo Excel.
 */
export function clavesPropinaDeEmpleado(
  empleado: EmpleadoVinculable,
  nombres: Readonly<Record<string, string>>,
  claves: readonly string[],
  norm: (s: string) => string,
): string[] {
  const porLogin = claveDeEmpleadoPorLogin(empleado, nombres, claves)
  if (porLogin) return [norm(porLogin)]
  const fullKey = norm(empleado.full_name ?? '')
  const posKey  = empleado.pos_name ? norm(empleado.pos_name) : null
  return posKey && posKey !== fullKey ? [posKey, fullKey] : [posKey ?? fullKey]
}

