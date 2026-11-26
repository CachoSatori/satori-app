// Lector de XML mínimo y PURO para los comprobantes electrónicos de Hacienda (F1 de
// docs/inventario/SPEC-compras-stock-costos.md §4.3–4.4). Lo usan vitest (Node) y la Edge `fe-ingesta` (Deno), por eso
// no depende de DOMParser ni de ninguna librería.
//
// Seguridad (spec §4.3): NO resuelve entidades externas ni DTD. Un `<!DOCTYPE` o `<!ENTITY` en cualquier lugar hace
// caer la lectura entera (así no hay XXE ni «billion laughs»). Solo entiende las cinco entidades predefinidas y las
// referencias numéricas. Topes de profundidad y de cantidad de nodos.
//
// Los nombres se guardan SIN prefijo de espacio de nombres (`ds:Signature` → `Signature`): el parser de Hacienda lee
// por nombre local, así sirve igual para v4.3 y v4.4 (spec §4.4).

export interface NodoXml {
  nombre: string
  atributos: Record<string, string>
  hijos: NodoXml[]
  texto: string
}

export type LecturaXml = { ok: true; raiz: NodoXml } | { ok: false; motivo: string }

export const TOPE_PROFUNDIDAD = 64
export const TOPE_NODOS = 50_000

const ENTIDADES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

class ErrorXml extends Error {}

function decodificar(s: string): string {
  if (!s.includes('&')) return s
  if (/&(?![^;&\s]{1,10};)/.test(s)) throw new ErrorXml('«&» suelto en el texto')
  return s.replace(/&([^;&\s]{1,10});/g, (_, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) throw new ErrorXml(`referencia numérica inválida &${e};`)
      return String.fromCodePoint(n)
    }
    const v = ENTIDADES[e]
    if (v === undefined) throw new ErrorXml(`entidad desconocida &${e};`)
    return v
  })
}

const sinPrefijo = (n: string) => n.slice(n.indexOf(':') + 1)
const NOMBRE = /^[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?$/

function leerAtributos(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g
  let resto = s
  for (const m of s.matchAll(re)) {
    if (!NOMBRE.test(m[1])) throw new ErrorXml(`atributo inválido «${m[1].slice(0, 30)}»`)
    out[m[1]] = decodificar(m[3] ?? m[4] ?? '')
    resto = resto.replace(m[0], '')
  }
  if (resto.trim() !== '') throw new ErrorXml('atributos mal formados')
  return out
}

/** Lee el texto entero. Nunca tira: devuelve `{ ok: false, motivo }`. */
export function leerXml(entrada: string): LecturaXml {
  try {
    const s = entrada.charCodeAt(0) === 0xfeff ? entrada.slice(1) : entrada
    if (/<!DOCTYPE|<!ENTITY/i.test(s)) return { ok: false, motivo: 'trae DTD o entidades (no se aceptan)' }
    const pila: NodoXml[] = []
    let raiz: NodoXml | null = null
    let nodos = 0
    let i = 0
    const n = s.length
    while (i < n) {
      const lt = s.indexOf('<', i)
      const texto = s.slice(i, lt === -1 ? n : lt)
      if (texto) {
        if (pila.length) pila[pila.length - 1].texto += decodificar(texto)
        else if (texto.trim()) throw new ErrorXml('texto fuera del elemento raíz')
      }
      if (lt === -1) break
      if (s.startsWith('<?', lt)) {
        const fin = s.indexOf('?>', lt + 2)
        if (fin === -1) throw new ErrorXml('instrucción <? sin cerrar')
        i = fin + 2
      } else if (s.startsWith('<!--', lt)) {
        const fin = s.indexOf('-->', lt + 4)
        if (fin === -1) throw new ErrorXml('comentario sin cerrar')
        i = fin + 3
      } else if (s.startsWith('<![CDATA[', lt)) {
        const fin = s.indexOf(']]>', lt + 9)
        if (fin === -1) throw new ErrorXml('CDATA sin cerrar')
        if (!pila.length) throw new ErrorXml('CDATA fuera del elemento raíz')
        pila[pila.length - 1].texto += s.slice(lt + 9, fin)
        i = fin + 3
      } else if (s.startsWith('<!', lt)) {
        throw new ErrorXml('declaración <! no permitida')
      } else if (s.startsWith('</', lt)) {
        const fin = s.indexOf('>', lt)
        if (fin === -1) throw new ErrorXml('etiqueta de cierre sin «>»')
        const nombre = s.slice(lt + 2, fin).trim()
        const abierto = pila.pop()
        if (!abierto || abierto.nombre !== sinPrefijo(nombre)) throw new ErrorXml(`cierre </${nombre.slice(0, 40)}> sin su apertura`)
        i = fin + 1
      } else {
        // apertura: buscar el «>» que no esté dentro de comillas
        let j = lt + 1
        let q = ''
        for (; j < n; j++) {
          const c = s[j]
          if (q) { if (c === q) q = '' } else if (c === '"' || c === "'") q = c
          else if (c === '>') break
        }
        if (j >= n) throw new ErrorXml('etiqueta sin «>»')
        let cuerpo = s.slice(lt + 1, j)
        const autocierre = cuerpo.endsWith('/')
        if (autocierre) cuerpo = cuerpo.slice(0, -1)
        const m = /^([^\s/>]+)([\s\S]*)$/.exec(cuerpo)
        if (!m || !NOMBRE.test(m[1])) throw new ErrorXml('nombre de elemento inválido')
        if (++nodos > TOPE_NODOS) throw new ErrorXml('demasiados elementos')
        const nodo: NodoXml = { nombre: sinPrefijo(m[1]), atributos: leerAtributos(m[2]), hijos: [], texto: '' }
        if (pila.length) pila[pila.length - 1].hijos.push(nodo)
        else if (raiz) throw new ErrorXml('más de un elemento raíz')
        else raiz = nodo
        if (!autocierre) {
          pila.push(nodo)
          if (pila.length > TOPE_PROFUNDIDAD) throw new ErrorXml('demasiada profundidad')
        }
        i = j + 1
      }
    }
    if (pila.length) throw new ErrorXml(`<${pila[pila.length - 1].nombre}> sin cerrar`)
    if (!raiz) throw new ErrorXml('no hay elemento raíz')
    return { ok: true, raiz }
  } catch (e) {
    return { ok: false, motivo: e instanceof ErrorXml ? e.message : 'XML ilegible' }
  }
}

/** Primer hijo directo con ese nombre local. */
export function hijo(n: NodoXml | null | undefined, nombre: string): NodoXml | null {
  return n?.hijos.find(h => h.nombre === nombre) ?? null
}

/** Todos los hijos directos con ese nombre local. */
export function hijos(n: NodoXml | null | undefined, nombre: string): NodoXml[] {
  return n ? n.hijos.filter(h => h.nombre === nombre) : []
}

/** Sigue un camino de hijos directos (`'Emisor/Identificacion/Numero'`). */
export function camino(n: NodoXml | null | undefined, ruta: string): NodoXml | null {
  let x: NodoXml | null = n ?? null
  for (const p of ruta.split('/')) x = hijo(x, p)
  return x
}

/** Texto (recortado) de un camino; null si falta o está vacío. Un nodo con hijos no tiene «texto» propio. */
export function textoDe(n: NodoXml | null | undefined, ruta: string): string | null {
  const x = camino(n, ruta)
  if (!x || x.hijos.length) return null
  const t = x.texto.trim()
  return t === '' ? null : t
}
