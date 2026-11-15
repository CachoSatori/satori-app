/**
 * 167 (14-nov, decisión 3 del dueño) · Reseña de Google a socios cada N visitas, en «Mi Club» (portal del socio).
 *
 * La BASE decide si toca (club_portal devuelve `resena` = {url, local} o null): cada N visitas con beneficio (5), máximo
 * una vez cada X días (90), solo socios activos (el equipo nunca), y del local de la última visita (sin link, nada). Esta
 * página solo pinta la tarjeta cerrable «¿Nos cuenta cómo le fue?» y marca, sin datos personales y de mejor esfuerzo,
 * cuándo se mostró, se cerró o se tocó el botón. Política de Google: a todos, sin premio, y no la pide el personal.
 *
 * Sin estado propio en el teléfono: cerrada, la base no la vuelve a mandar hasta la próxima vez que toque.
 */
import { esUrlResena } from './resena'

export type AccionResena = 'mostrada' | 'cerrada' | 'clic'
export interface ResenaSocio { url: string; local: string | null }
export interface TextosResenaSocio { titulo: string; txt: string; boton: string; cerrar: string }

/** Solo un link de Google (la misma expresión que el CHECK de la 158). Cualquier otra cosa: no hay tarjeta. */
export function resenaSocioValida(r: unknown): r is ResenaSocio {
  return !!r && typeof r === 'object' && esUrlResena((r as { url?: unknown }).url)
}

/** Marca de la tarjeta (mejor esfuerzo): no espera ni lanza nunca. El link a Google lo abre el navegador igual. */
export function marcarResenaSocio(token: string, accion: AccionResena, f: typeof fetch = (...a) => fetch(...a)): void {
  try {
    void Promise.resolve(f(`/api/portal/${token}/resena`, {
      method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion }),
    })).catch(() => undefined)
  } catch { /* nada */ }
}

/**
 * La tarjeta, o null si no toca. Al armarla marca «mostrada»; «Cerrar» la saca y marca «cerrada»; el botón abre la
 * reseña en Google (link normal, pestaña nueva), marca «clic» y la saca.
 */
export function tarjetaResenaSocio(resena: unknown, t: TextosResenaSocio, marcar: (a: AccionResena) => void,
                                   doc: Document = document): HTMLElement | null {
  if (!resenaSocioValida(resena)) return null
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, txt?: string) => {
    const e = doc.createElement(tag)
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
    if (txt !== undefined) e.textContent = txt
    return e
  }
  const sec = el('section', { class: 'tarjeta resena-socio', 'aria-label': t.titulo })
  const cerrar = el('button', { type: 'button', class: 'cerrar', 'aria-label': t.cerrar, title: t.cerrar }, '×')
  const cab = el('div', { class: 'resena-socio-cab' })
  cab.append(el('h2', {}, t.titulo), cerrar)
  const boton = el('a', { class: 'btn', href: resena.url, target: '_blank', rel: 'noopener noreferrer' }, t.boton)
  sec.append(cab, el('p', {}, t.txt))
  if (resena.local) sec.append(el('p', { class: 'sub' }, resena.local))
  sec.append(boton)
  cerrar.addEventListener('click', () => { marcar('cerrada'); sec.remove() })
  // la pestaña nueva se abre con el clic; la tarjeta se saca después, para no cortar la navegación
  boton.addEventListener('click', () => { marcar('clic'); setTimeout(() => sec.remove(), 0) })
  marcar('mostrada')
  return sec
}
