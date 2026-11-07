/**
 * Club Satori — páginas públicas (sin login, sin el bundle de la app):
 *   /r/{codigo8}  turista: obtiene su cupón 10 % (o ve el que ya tiene en este teléfono)
 *   /c/{codigo10} cupón: vigente → lo muestra; usado o vencido → aviso
 *   /p/{token}    portal del referente: saldo, QR para compartir, «Canjear» (código de 10 min) e historial
 *   /k/{codigo6}  código de canje: lo lee la caja; abierto en un navegador, solo un aviso
 * Todo pasa por /api/* (Pages Function con tope por IP). El DOM se arma sin innerHTML.
 */
import './styles.css'
import { urlCanje, urlCupon, urlReferente } from './qrFormato'
import { LOCAL } from './config'
import { TEXTOS, idiomaInicial, guardarIdioma, type Idioma } from './i18n'

let idioma: Idioma = idiomaInicial()
let t = TEXTOS[idioma]
const app = document.getElementById('app') as HTMLElement
const aviso = document.getElementById('aviso') as HTMLElement

// ── DOM mínimo ───────────────────────────────────────────────────────────────
type Hijo = Node | string | null | undefined | false
function h(tag: string, attrs: Record<string, string | boolean | ((e: Event) => void)> = {}, ...hijos: Hijo[]): HTMLElement {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') el.addEventListener(k.slice(2), v)
    else if (v === true) el.setAttribute(k, '')
    else if (v !== false) el.setAttribute(k, v)
  }
  for (const c of hijos) if (c !== null && c !== undefined && c !== false) el.append(c)
  return el
}
function pintar(...nodos: Hijo[]) {
  app.replaceChildren(...(nodos.filter(Boolean) as Node[]))
  app.focus({ preventScroll: true })
}
const avisoEl = (tono: 'ok' | 'err', txt: string) => h('p', { class: `aviso ${tono}`, role: tono === 'err' ? 'alert' : 'status' }, txt)
function anunciar(txt: string) { aviso.textContent = txt }

// ── API ──────────────────────────────────────────────────────────────────────
type Res<T> = { ok: true; data: T } | { ok: false; error: string }
async function api<T>(path: string, init?: RequestInit): Promise<Res<T>> {
  try {
    const r = await fetch(`/api/${path}`, { ...init, headers: { 'Content-Type': 'application/json' } })
    const j = await r.json().catch(() => ({}))
    return r.ok ? { ok: true, data: j.data as T } : { ok: false, error: j.error || 'servicio' }
  } catch {
    return { ok: false, error: 'red' }
  }
}
const msgError = (e: string) =>
  ({ referente_invalido: t.ref_invalido, cupon_invalido: t.cupon_invalido, portal_invalido: t.portal_invalido,
     tope_referente: t.tope_ref, demasiados_pedidos: t.demasiados, red: t.red, tope_canje: t.tope_canje,
     sin_saldo_canje: t.sin_saldo_canje } as Record<string, string>)[e] ?? t.servicio

// ── Formatos ─────────────────────────────────────────────────────────────────
const fecha = (iso: string, conHora = true) =>
  new Intl.DateTimeFormat(idioma === 'es' ? 'es-CR' : 'en-US', {
    day: 'numeric', month: 'long', ...(conHora ? { hour: 'numeric', minute: '2-digit' } : { year: 'numeric' }),
    timeZone: 'America/Costa_Rica',
  }).format(new Date(iso))
const num = (n: number) => new Intl.NumberFormat(idioma === 'es' ? 'es-CR' : 'en-US', { maximumFractionDigits: 1 }).format(n)

async function qr(texto: string, etiqueta: string): Promise<HTMLCanvasElement> {
  const { toCanvas } = await import('qrcode')
  const c = document.createElement('canvas')
  c.setAttribute('role', 'img'); c.setAttribute('aria-label', etiqueta)
  await toCanvas(c, texto, { width: 560, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#0d0d0d', light: '#ffffff' } })
  // qrcode fija width/height en línea (560px) y pisa el CSS: se quitan para que el QR entre en la pantalla.
  c.style.removeProperty('width'); c.style.removeProperty('height')
  return c
}

// ── Almacenamiento local (con try/catch: modo privado, storage bloqueado) ───
interface CuponGuardado { codigo: string; vence_en: string }
const claveRef = (ref: string) => `club.cupon.${ref}`
function leerCupon(ref: string): CuponGuardado | null {
  try {
    const v = JSON.parse(localStorage.getItem(claveRef(ref)) || 'null')
    return v && typeof v.codigo === 'string' && typeof v.vence_en === 'string' ? v : null
  } catch { return null }
}
function guardarCupon(ref: string, c: CuponGuardado) { try { localStorage.setItem(claveRef(ref), JSON.stringify(c)) } catch { /* nada */ } }
function borrarCupon(ref: string) { try { localStorage.removeItem(claveRef(ref)) } catch { /* nada */ } }
const optinHecho = (c: string) => { try { return localStorage.getItem(`club.optin.${c}`) === '1' } catch { return false } }
const marcarOptin = (c: string) => { try { localStorage.setItem(`club.optin.${c}`, '1') } catch { /* nada */ } }

// ── Vistas ───────────────────────────────────────────────────────────────────
interface CuponVer { estado: 'vigente' | 'usado' | 'vencido'; vence_en: string; referente: string | null }

async function vistaCupon(codigo: string, venceEn: string, referente: string | null, titulo = true) {
  const canvas = await qr(urlCupon(codigo), `QR ${codigo}`)
  pintar(
    titulo && h('h1', {}, t.titulo_r),
    titulo && h('p', { class: 'sub' }, t.sub_r(referente)),
    h('section', { class: 'tarjeta cupon', 'aria-label': t.cupon_titulo },
      h('p', { class: 'etq' }, t.cupon_titulo),
      canvas,
      h('p', { class: 'codigo' }, codigo.replace(/(.{5})/, '$1 ')),
      h('p', {}, h('strong', {}, t.vale_hasta(fecha(venceEn)))),
      h('p', {}, t.un_uso),
      h('p', { class: 'local' }, `${LOCAL.nombre} · ${LOCAL.direccion} · `,
        h('a', { href: LOCAL.mapa, target: '_blank', rel: 'noopener' }, t.ver_mapa))),
    optinHecho(codigo) ? avisoEl('ok', t.optin_gracias) : formOptin(codigo),
  )
}

function formOptin(codigo: string): HTMLElement {
  const err = h('div')
  const nombre = h('input', { type: 'text', id: 'o-nombre', autocomplete: 'given-name', maxlength: '80' }) as HTMLInputElement
  const wa = h('input', { type: 'tel', id: 'o-wa', autocomplete: 'tel', inputmode: 'tel', maxlength: '32' }) as HTMLInputElement
  const em = h('input', { type: 'email', id: 'o-em', autocomplete: 'email', maxlength: '254' }) as HTMLInputElement
  const ok = h('input', { type: 'checkbox', id: 'o-ok' }) as HTMLInputElement
  const enviar = h('button', { type: 'submit', class: 'btn sec' }, t.optin_enviar) as HTMLButtonElement
  const form = h('form', {
    onsubmit: async (e: Event) => {
      e.preventDefault()
      err.replaceChildren()
      if (!ok.checked || (!wa.value.trim() && !em.value.trim())) { err.append(avisoEl('err', t.optin_falta)); return }
      enviar.disabled = true
      const r = await api<boolean>(`cupon/${codigo}/contacto`, { method: 'POST',
        body: JSON.stringify({ contacto: { nombre: nombre.value, whatsapp: wa.value, email: em.value, optin: true } }) })
      enviar.disabled = false
      if (r.ok) { marcarOptin(codigo); form.replaceWith(avisoEl('ok', t.optin_gracias)); anunciar(t.optin_gracias) }
      else err.append(avisoEl('err', r.error === 'datos_invalidos' ? t.optin_falta : msgError(r.error)))
    },
  },
    h('label', { for: 'o-nombre' }, t.optin_nombre), nombre,
    h('label', { for: 'o-wa' }, t.optin_whatsapp), wa,
    h('label', { for: 'o-em' }, t.optin_email), em,
    h('label', { class: 'check', for: 'o-ok' }, ok, h('span', {}, t.optin_acepto)),
    err, enviar)
  return h('details', { class: 'tarjeta' }, h('summary', {}, t.optin_titulo), form)
}

async function paginaReferente(ref: string) {
  const guardado = leerCupon(ref)
  if (guardado && new Date(guardado.vence_en) > new Date()) {
    const r = await api<CuponVer>(`cupon/${guardado.codigo}`)
    if (r.ok && r.data.estado === 'vigente') return vistaCupon(guardado.codigo, r.data.vence_en, r.data.referente)
    if (!r.ok && r.error === 'red') return vistaCupon(guardado.codigo, guardado.vence_en, null)   // sin señal: el guardado sirve igual
    borrarCupon(ref)
  }
  const err = h('div')
  const boton = h('button', { type: 'button', class: 'btn' }, t.obtener) as HTMLButtonElement
  boton.addEventListener('click', async () => {
    boton.disabled = true; boton.textContent = t.obteniendo; err.replaceChildren()
    const r = await api<Array<{ codigo: string; vence_en: string }>>('cupon', { method: 'POST', body: JSON.stringify({ referente: ref }) })
    if (r.ok && r.data?.[0]) {
      const c = r.data[0]
      guardarCupon(ref, c)
      const v = await api<CuponVer>(`cupon/${c.codigo}`)
      await vistaCupon(c.codigo, c.vence_en, v.ok ? v.data.referente : null)
      anunciar(t.cupon_titulo)
      return
    }
    boton.disabled = false; boton.textContent = r.ok ? t.obtener : t.reintentar
    const e = r.ok ? 'servicio' : r.error
    err.append(avisoEl('err', msgError(e)))
    if (e === 'referente_invalido') boton.remove()
  })
  pintar(h('h1', {}, t.titulo_r), h('p', { class: 'sub' }, t.sub_r(null)), err, boton)
}

async function paginaCupon(codigo: string) {
  const r = await api<CuponVer>(`cupon/${codigo}`)
  if (!r.ok) return pintar(h('h1', {}, t.cupon_titulo), avisoEl('err', msgError(r.error)))
  if (r.data.estado === 'vigente') return vistaCupon(codigo, r.data.vence_en, r.data.referente, false)
  pintar(h('h1', {}, t.cupon_titulo), avisoEl('err', r.data.estado === 'usado' ? t.cupon_usado : t.cupon_vencido))
}

interface Portal {
  nombre: string; codigo: string; personas: number; creditos: number; personas_proximo_credito: number
  movimientos: Array<{ tipo: string; personas: number; creditos: number | null; fecha: string }>
}

// R-01: código de canje de un solo uso (10 min). El QR del portal (/r/) ya no sirve para canjear.
let reloj: ReturnType<typeof setInterval> | null = null
function pararReloj() { if (reloj) { clearInterval(reloj); reloj = null } }

function seccionCanje(token: string): HTMLElement {
  const sec = h('section', { class: 'tarjeta canje', 'aria-label': t.canje_titulo })
  const inicial = () => {
    pararReloj()
    const err = h('div')
    const boton = h('button', { type: 'button', class: 'btn' }, t.canje_boton) as HTMLButtonElement
    boton.addEventListener('click', async () => {
      boton.disabled = true; boton.textContent = t.canje_generando; err.replaceChildren()
      const r = await api<Array<{ codigo: string; vence_en: string }>>(`portal/${token}/canje`, { method: 'POST' })
      if (r.ok && r.data?.[0]) return mostrar(r.data[0].codigo, r.data[0].vence_en)
      boton.disabled = false; boton.textContent = t.canje_boton
      err.append(avisoEl('err', msgError(r.ok ? 'servicio' : r.error)))
    })
    sec.replaceChildren(h('h2', {}, t.canje_titulo), h('p', {}, t.canje_txt), err, boton)
  }
  const mostrar = async (codigo: string, venceEn: string) => {
    const canvas = await qr(urlCanje(codigo), `QR ${codigo}`)
    const cuenta = h('p', { class: 'cuenta', role: 'timer', 'aria-live': 'off' })
    const otro = h('button', { type: 'button', class: 'btn sec' }, t.canje_otro)
    otro.addEventListener('click', () => { inicial(); (sec.querySelector('button') as HTMLButtonElement | null)?.click() })
    const fin = new Date(venceEn).getTime()
    const tic = () => {
      const s = Math.max(0, Math.round((fin - Date.now()) / 1000))
      if (s === 0) {
        pararReloj()
        canvas.remove(); codigoEl.remove()
        cuenta.replaceWith(avisoEl('err', t.canje_vencido)); anunciar(t.canje_vencido)
        return
      }
      cuenta.textContent = t.canje_vence(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`)
    }
    const codigoEl = h('p', { class: 'codigo', style: 'text-align:center' }, codigo)
    sec.replaceChildren(h('h2', {}, t.canje_qr), canvas, codigoEl, cuenta, h('p', { class: 'sub' }, t.canje_privado), otro)
    pararReloj(); tic(); reloj = setInterval(tic, 1000)
    anunciar(t.canje_qr)
  }
  inicial()
  return sec
}

async function paginaPortal(token: string) {
  const r = await api<Portal>(`portal/${token}`)
  if (!r.ok) return pintar(h('h1', {}, t.inicio), avisoEl('err', msgError(r.error)))
  const p = r.data
  const canvas = await qr(urlReferente(p.codigo), `QR ${p.codigo}`)
  const compartir = h('button', { type: 'button', class: 'btn sec' }, t.compartir)
  compartir.addEventListener('click', () => canvas.toBlob(async b => {
    if (!b) return
    const f = new File([b], `satori-${p.codigo}.png`, { type: 'image/png' })
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
    try {
      if (nav.canShare?.({ files: [f] })) await navigator.share({ files: [f], title: 'Satori', url: urlReferente(p.codigo) })
      else if (navigator.share) await navigator.share({ title: 'Satori', url: urlReferente(p.codigo) })
      else descargar.click()
    } catch { /* cancelado */ }
  }, 'image/png'))
  const descargar = h('a', { class: 'btn sec', href: canvas.toDataURL('image/png'), download: `satori-${p.codigo}.png` }, t.descargar)
  pintar(
    h('h1', {}, t.portal_hola(p.nombre)),
    h('section', { class: 'tarjeta' },
      h('p', { class: 'saldo' }, h('span', { class: 'num' }, num(p.creditos)), h('span', {}, t.portal_creditos)),
      h('p', { class: 'sub' }, t.portal_personas(p.personas)),
      h('p', {}, h('strong', {}, t.portal_faltan(p.personas_proximo_credito)))),
    p.creditos >= 1 && seccionCanje(token),
    h('section', { class: 'tarjeta portal-qr' },
      h('h2', {}, t.portal_qr), canvas, h('p', { class: 'codigo', style: 'text-align:center' }, p.codigo),
      h('p', {}, t.portal_indicaciones),
      h('div', { class: 'fila' }, compartir, descargar),
      // F1e: botón «Agregar a Wallet» (oculto hasta tener la clase del pase).
    ),
    h('section', { class: 'tarjeta' },
      h('h2', {}, t.historial),
      p.movimientos.length === 0 ? h('p', { class: 'sub' }, t.sin_movimientos) :
        h('ul', { class: 'movs' }, ...p.movimientos.map(m => h('li', {},
          h('span', {}, h('span', {}, t.mov[m.tipo] ?? m.tipo), h('br'), h('span', { class: 'f' }, fecha(m.fecha, false))),
          h('span', { class: m.personas > 0 ? 'mas' : 'menos' },
            // el canje se muestra en créditos (lo que el referente canjeó); el resto, en personas
            m.tipo === 'canje' && m.creditos != null ? t.canje_creditos(num(Number(m.creditos)), Number(m.creditos))
              : `${m.personas > 0 ? '+' : '−'}${Math.abs(m.personas)}`)))),
    ),
  )
}

// ── Router ───────────────────────────────────────────────────────────────────
function ruta() {
  pararReloj()
  document.documentElement.lang = idioma
  document.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === idioma)))
  const m = location.pathname.match(/^\/([rcpk])\/([^/]+)\/?$/)
  if (!m) return pintar(h('h1', {}, t.inicio), h('p', { class: 'sub' }, t.inicio_txt))
  const [, tipo, cod] = m
  if (tipo === 'r') return paginaReferente(cod.toUpperCase())
  if (tipo === 'c') return paginaCupon(cod.toUpperCase())
  if (tipo === 'k') return pintar(h('h1', {}, t.canje_qr), h('p', { class: 'sub' }, t.k_txt))
  return paginaPortal(cod.toLowerCase())
}

document.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach(b => b.addEventListener('click', () => {
  idioma = b.dataset.lang as Idioma; t = TEXTOS[idioma]; guardarIdioma(idioma); ruta()
}))
ruta()
