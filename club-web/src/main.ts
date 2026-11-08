/**
 * Club Satori — páginas públicas (sin login, sin el bundle de la app):
 *   /r/{codigo8}  turista: obtiene su cupón 10 % (o ve el que ya tiene en este teléfono)
 *   /c/{codigo10} cupón: vigente → lo muestra; usado o vencido → aviso
 *   /p/{token}    portal del referente: saldo, QR para compartir, «Canjear» (código de 10 min) e historial
 *   /k/{codigo6}  código de canje: lo lee la caja; abierto en un navegador, solo un aviso
 *   /s/{codigo9}  QR fijo del socio del Local Club: lo lee la caja; abierto en un navegador, solo un aviso
 *   /alta         autoalta del socio (LC-DES-07): nombre + WhatsApp + aviso de privacidad + Turnstile → pendiente
 *   /w/{token}    botón «Canjear» del pase de Wallet (token de pase, CLUB-AUD-69): solo genera el código de canje
 *   /b/{codigo10} baja del turista (LC-PRIV): borra el contacto que dejó con ese cupón
 *   /privacidad   aviso de privacidad completo (la versión vigente)
 * Todo pasa por /api/* (Pages Function con tope por IP). El DOM se arma sin innerHTML.
 */
import './styles.css'
import { CLUB_BASE_URL, urlCanje, urlCupon, urlReferente, urlSocio } from './qrFormato'
import { LOCAL, AVISO_PRIVACIDAD_VERSION, TURNSTILE_SITEKEY, WALLET_GOOGLE_ACTIVO } from './config'
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
     sin_saldo_canje: t.sin_saldo_canje, tope_altas: t.tope_altas, verificacion: t.alta_verificacion,
     datos_invalidos: t.alta_falta, elegir_local: t.alta_local_falta, local_no_disponible: t.local_no_disponible } as Record<string, string>)[e] ?? t.servicio

// ── Formatos ─────────────────────────────────────────────────────────────────
const fecha = (iso: string, conHora = true) =>
  new Intl.DateTimeFormat(idioma === 'es' ? 'es-CR' : 'en-US', {
    day: 'numeric', month: 'long', ...(conHora ? { hour: 'numeric', minute: '2-digit' } : { year: 'numeric' }),
    timeZone: 'America/Costa_Rica',
  }).format(new Date(iso))
const num = (n: number) => new Intl.NumberFormat(idioma === 'es' ? 'es-CR' : 'en-US', { maximumFractionDigits: 1 }).format(n)
/** ₡ con separador de miles fijo, igual que el pase: «₡36.000» (ES) / «₡36,000» (EN). */
const colones = (n: number) => '₡' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, idioma === 'es' ? '.' : ',')

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
interface LocalPub { id: string; nombre: string; direccion: string | null; mapa: string | null }
interface CuponVer { estado: 'vigente' | 'usado' | 'vencido'; vence_en: string; referente: string | null; local?: LocalPub | null }

async function vistaCupon(codigo: string, venceEn: string, referente: string | null, titulo = true, local: LocalPub | null = null) {
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
      // LC-ML: el local del cupón viene de la base; sin señal, solo la marca
      h('p', { class: 'local' }, [local?.nombre ? `${LOCAL.nombre} · ${local.nombre}` : LOCAL.nombre, local?.direccion].filter(Boolean).join(' · '),
        local?.mapa?.startsWith('https://') ? ' · ' : '',
        local?.mapa?.startsWith('https://') ? h('a', { href: local.mapa, target: '_blank', rel: 'noopener' }, t.ver_mapa) : '')),
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
        body: JSON.stringify({ contacto: { nombre: nombre.value, whatsapp: wa.value, email: em.value, optin: true, acepto: AVISO_PRIVACIDAD_VERSION } }) })
      enviar.disabled = false
      if (r.ok) { marcarOptin(codigo); form.replaceWith(avisoEl('ok', t.optin_gracias)); anunciar(t.optin_gracias) }
      else err.append(avisoEl('err', r.error === 'datos_invalidos' ? t.optin_falta : msgError(r.error)))
    },
  },
    h('label', { for: 'o-nombre' }, t.optin_nombre), nombre,
    h('label', { for: 'o-wa' }, t.optin_whatsapp), wa,
    h('label', { for: 'o-em' }, t.optin_email), em,
    avisoCorto(codigo),
    h('label', { class: 'check', for: 'o-ok' }, ok, h('span', {}, t.optin_acepto)),
    err, enviar)
  return h('details', { class: 'tarjeta' }, h('summary', {}, t.optin_titulo), form)
}

/** LC-PRIV (Grok 63): el aviso corto del turista, con link al aviso v1 completo y a la baja (con el código del cupón). */
function avisoCorto(codigo: string): HTMLElement {
  return h('div', { class: 'aviso-priv corto' },
    h('p', {}, t.optin_aviso),
    h('p', { class: 'sub' },
      h('a', { href: '/privacidad', target: '_blank', rel: 'noopener' }, `${t.optin_aviso_completo} (${AVISO_PRIVACIDAD_VERSION})`),
      ' · ',
      h('a', { href: `/b/${codigo}` }, t.optin_baja)))
}

function paginaPrivacidad() {
  pintar(h('h1', {}, t.priv_titulo),
    h('section', { class: 'tarjeta aviso-priv' }, ...t.alta_aviso.split('\n').map((p) => h('p', {}, p)),
      h('p', { class: 'sub' }, `(${AVISO_PRIVACIDAD_VERSION})`)))
}

/** LC-PRIV (Grok 63): baja del turista. El link va en el aviso corto y en cada mensaje de ofertas: /b/{código del cupón}. */
function paginaBajaTurista(codigo: string) {
  if (!/^[A-HJ-NP-Z2-9]{10}$/.test(codigo)) return pintar(h('h1', {}, t.baja_t_titulo), avisoEl('err', t.cupon_invalido))
  const err = h('div')
  const boton = h('button', { type: 'button', class: 'btn sec' }, t.baja_t_boton) as HTMLButtonElement
  boton.addEventListener('click', async () => {
    boton.disabled = true; err.replaceChildren()
    const r = await api<boolean>(`cupon/${codigo}/baja`, { method: 'POST', body: '{}' })
    if (r.ok) { boton.replaceWith(avisoEl('ok', t.baja_t_listo)); anunciar(t.baja_t_listo); return }
    boton.disabled = false; err.append(avisoEl('err', msgError(r.error)))
  })
  pintar(h('h1', {}, t.baja_t_titulo), h('p', { class: 'sub' }, t.baja_t_txt), err, boton)
}

async function paginaReferente(ref: string) {
  const guardado = leerCupon(ref)
  if (guardado && new Date(guardado.vence_en) > new Date()) {
    const r = await api<CuponVer>(`cupon/${guardado.codigo}`)
    if (r.ok && r.data.estado === 'vigente') return vistaCupon(guardado.codigo, r.data.vence_en, r.data.referente, true, r.data.local ?? null)
    if (!r.ok && r.error === 'red') return vistaCupon(guardado.codigo, guardado.vence_en, null)   // sin señal: el guardado sirve igual
    borrarCupon(ref)
  }
  const err = h('div')
  const boton = h('button', { type: 'button', class: 'btn' }, t.obtener) as HTMLButtonElement
  // Grok 24: Turnstile también al crear el cupón (como en el alta). El script se carga solo si hay que pedir uno.
  const caja = h('div', { class: 'turnstile' })
  let token = ''
  const widget: { id?: string; ts?: TurnstileApi | null } = {}
  boton.addEventListener('click', async () => {
    err.replaceChildren()
    if (!token) { err.append(avisoEl('err', widget.ts === null ? t.alta_verificacion : t.cupon_verifica)); return }
    boton.disabled = true; boton.textContent = t.obteniendo
    const r = await api<Array<{ codigo: string; vence_en: string }>>('cupon', { method: 'POST', body: JSON.stringify({ referente: ref, turnstile: token }) })
    token = ''; widget.ts?.reset(widget.id)
    if (r.ok && r.data?.[0]) {
      const c = r.data[0]
      guardarCupon(ref, c)
      const v = await api<CuponVer>(`cupon/${c.codigo}`)
      await vistaCupon(c.codigo, c.vence_en, v.ok ? v.data.referente : null, true, v.ok ? v.data.local ?? null : null)
      anunciar(t.cupon_titulo)
      return
    }
    boton.disabled = false; boton.textContent = r.ok ? t.obtener : t.reintentar
    const e = r.ok ? 'servicio' : r.error
    err.append(avisoEl('err', msgError(e)))
    if (e === 'referente_invalido') boton.remove()
  })
  pintar(h('h1', {}, t.titulo_r), h('p', { class: 'sub' }, t.sub_r(null)), caja, err, boton)
  widget.ts = await cargarTurnstile()
  if (!widget.ts) { err.append(avisoEl('err', t.alta_verificacion)); return }
  widget.id = widget.ts.render(caja, { sitekey: TURNSTILE_SITEKEY, language: idioma,
    callback: (v: string) => { token = v }, 'expired-callback': () => { token = '' }, 'error-callback': () => { token = '' } })
}

async function paginaCupon(codigo: string) {
  const r = await api<CuponVer>(`cupon/${codigo}`)
  if (!r.ok) return pintar(h('h1', {}, t.cupon_titulo), avisoEl('err', msgError(r.error)))
  if (r.data.estado === 'vigente') return vistaCupon(codigo, r.data.vence_en, r.data.referente, false, r.data.local ?? null)
  pintar(h('h1', {}, t.cupon_titulo), avisoEl('err', r.data.estado === 'usado' ? t.cupon_usado : t.cupon_vencido))
}

interface Portal {
  nombre: string; codigo: string; personas: number; creditos: number; personas_proximo_credito: number
  /** (08-nov noche) «vencen a los N meses sin actividad» */
  vencimiento_meses?: number
  /** (08-nov) créditos y colones juntos, como el pase y la caja */
  valor_credito_crc?: number
  anfitrion?: boolean
  socio?: {
    estado: 'pendiente' | 'activo'; desde: string; codigo_socio: string | null; beneficio: string | null; visitas_mes: number | null
    cortesias: Array<{ sorpresa: boolean; cantidad: number; motivo: string; vence_en: string | null }> | null
  } | null
  movimientos: Array<{ tipo: string; personas: number; creditos: number | null; fecha: string }>
}

// R-01: código de canje de un solo uso (10 min). El QR del portal (/r/) ya no sirve para canjear.
let reloj: ReturnType<typeof setInterval> | null = null
function pararReloj() { if (reloj) { clearInterval(reloj); reloj = null } }

function seccionCanje(token: string, via: 'portal' | 'pase' = 'portal'): HTMLElement {
  const sec = h('section', { class: 'tarjeta canje', 'aria-label': t.canje_titulo })
  const inicial = () => {
    pararReloj()
    const err = h('div')
    const boton = h('button', { type: 'button', class: 'btn' }, t.canje_boton) as HTMLButtonElement
    boton.addEventListener('click', async () => {
      boton.disabled = true; boton.textContent = t.canje_generando; err.replaceChildren()
      const r = await api<Array<{ codigo: string; vence_en: string }>>(`${via}/${token}/canje`, { method: 'POST' })
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
  const esAnfitrion = p.anfitrion !== false
  const anfitrion: HTMLElement[] = !esAnfitrion ? [] : [
    h('section', { class: 'tarjeta' },
      h('p', { class: 'saldo' }, h('span', { class: 'num' }, num(p.creditos)),
        h('span', {}, (p.creditos === 1 ? t.portal_creditos_uno : t.portal_creditos) + (p.valor_credito_crc ? ` · ${colones(p.creditos * p.valor_credito_crc)}` : ''))),
      h('p', { class: 'sub' }, t.portal_personas(p.personas)),
      h('p', {}, h('strong', {}, t.portal_faltan(p.personas_proximo_credito))),
      p.vencimiento_meses ? h('p', { class: 'sub' }, t.portal_vence(p.vencimiento_meses)) : null),
    ...(p.creditos >= 1 ? [seccionCanje(token)] : []),
    h('section', { class: 'tarjeta portal-qr' },
      h('h2', {}, t.portal_qr), canvas, h('p', { class: 'codigo', style: 'text-align:center' }, p.codigo),
      h('p', {}, t.portal_indicaciones),
      h('div', { class: 'fila' }, compartir, descargar),
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
  ]
  pintar(
    h('h1', {}, t.portal_hola(p.nombre)),
    botonWallet(token),   // B2: un pase por persona (socio y/o anfitrión)
    ...pestanas(p.socio ? [seccionSocio(token, p.socio)] : [], anfitrion),
  )
}

// ── B2: «Agregar a Google Wallet» (apagado por flag hasta desplegar el Edge) ──
function botonWallet(token: string): HTMLElement | null {
  if (!WALLET_GOOGLE_ACTIVO || !/^[0-9a-f]{64}$/.test(token)) return null
  const err = h('div')
  const b = h('button', { type: 'button', class: 'btn sec' }, t.wallet_boton) as HTMLButtonElement
  b.addEventListener('click', async () => {
    b.disabled = true; b.textContent = t.wallet_generando; err.replaceChildren()
    const r = await api<{ url: string }>(`portal/${token}/wallet`, { method: 'POST' })
    if (r.ok && r.data?.url?.startsWith('https://pay.google.com/gp/v/save/')) { location.href = r.data.url; return }
    b.disabled = false; b.textContent = t.wallet_boton
    err.append(avisoEl('err', r.ok ? t.wallet_error : r.error === 'servicio' || r.error === 'servicio_no_disponible' ? t.wallet_error : msgError(r.error)))
  })
  return h('div', { class: 'wallet' }, b, err)
}

// ── LC-A2: socio del Local Club ──────────────────────────────────────────────
function seccionSocio(token: string, socio: NonNullable<Portal['socio']>): HTMLElement {
  const err = h('div')
  const baja = h('button', { type: 'button', class: 'btn sec' }, t.socio_baja_boton) as HTMLButtonElement
  const activo = socio.estado === 'activo'
  const cort = socio.cortesias ?? []
  const sorpresas = cort.filter(c => c.motivo === 'promo').reduce((n, c) => n + c.cantidad, 0)
  const premios = cort.filter(c => c.motivo === 'premio_referido')
  const qrBox = h('div', { class: 'socio-qr' })
  if (socio.codigo_socio) {
    const cod = socio.codigo_socio
    void qr(urlSocio(cod), `QR ${cod}`).then(c => qrBox.replaceChildren(
      h('h2', {}, t.socio_qr), c, h('p', { class: 'codigo', style: 'text-align:center' }, cod), h('p', { class: 'sub' }, t.socio_qr_txt)))
  }
  const sec = h('section', { class: 'tarjeta', 'aria-label': t.socio_titulo },
    h('h2', {}, t.socio_titulo),
    h('p', {}, activo ? t.socio_activo : t.socio_pendiente),
    // Club compartido (08-nov): texto genérico, no la promo de un local
    activo && h('p', {}, h('strong', {}, t.socio_vale_todos)),
    activo && sorpresas > 0 && h('p', {}, t.socio_sorpresa(sorpresas)),
    ...premios.map(p => h('p', {}, t.socio_premio(p.vence_en ? fecha(p.vence_en + 'T12:00:00-06:00', false) : '—'))),
    activo && socio.visitas_mes != null && h('p', { class: 'sub' }, t.socio_visitas(socio.visitas_mes)),
    qrBox,
    err, baja)
  baja.addEventListener('click', async () => {
    if (!window.confirm(t.socio_baja_confirmar)) return
    baja.disabled = true; err.replaceChildren()
    const r = await api<boolean>(`portal/${token}/baja`, { method: 'POST' })
    if (r.ok) { sec.replaceChildren(h('h2', {}, t.socio_titulo), avisoEl('ok', t.socio_baja_listo)); anunciar(t.socio_baja_listo); return }
    baja.disabled = false; err.append(avisoEl('err', msgError(r.error)))
  })
  return sec
}

/** A4.5: con los dos roles, dos pestañas («Mi Club» y «Anfitrión»); con uno, una sola sección. */
function pestanas(miClub: HTMLElement[], anfitrion: HTMLElement[]): HTMLElement[] {
  if (miClub.length === 0) return anfitrion
  if (anfitrion.length === 0) return miClub
  const panelA = h('div', { role: 'tabpanel', id: 'panel-mi-club', 'aria-labelledby': 'tab-mi-club' }, ...miClub)
  const panelB = h('div', { role: 'tabpanel', id: 'panel-anfitrion', 'aria-labelledby': 'tab-anfitrion', hidden: true }, ...anfitrion)
  const bA = h('button', { type: 'button', role: 'tab', id: 'tab-mi-club', 'aria-controls': 'panel-mi-club', 'aria-selected': 'true', class: 'tab' }, t.pestana_mi_club) as HTMLButtonElement
  const bB = h('button', { type: 'button', role: 'tab', id: 'tab-anfitrion', 'aria-controls': 'panel-anfitrion', 'aria-selected': 'false', class: 'tab' }, t.pestana_anfitrion) as HTMLButtonElement
  const elegir = (a: boolean) => {
    bA.setAttribute('aria-selected', String(a)); bB.setAttribute('aria-selected', String(!a))
    panelA.hidden = !a; panelB.hidden = a
  }
  bA.addEventListener('click', () => elegir(true)); bB.addEventListener('click', () => elegir(false))
  return [h('div', { class: 'tabs', role: 'tablist' }, bA, bB), panelA, panelB]
}

// Turnstile (Cloudflare): el script se carga solo en /alta y al pedir un cupón (/r/).
type TurnstileApi = { render: (el: HTMLElement, o: Record<string, unknown>) => string; reset: (id?: string) => void }
function cargarTurnstile(): Promise<TurnstileApi | null> {
  const w = window as unknown as { turnstile?: TurnstileApi }
  if (w.turnstile) return Promise.resolve(w.turnstile)
  return new Promise(res => {
    const sc = document.createElement('script')
    sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    sc.async = true
    sc.onload = () => res(w.turnstile ?? null)
    sc.onerror = () => res(null)
    document.head.append(sc)
  })
}

async function paginaAlta() {
  const ref = (new URLSearchParams(location.search).get('ref') || '').toUpperCase()
  // LC-ML: el local viene en el enlace o el QR del local (`?local=<id>`); si hay más de uno encendido y no vino, se elige
  const localUrl = (new URLSearchParams(location.search).get('local') || '').toLowerCase()
  let localElegido = /^[a-z0-9-]{2,40}$/.test(localUrl) ? localUrl : ''
  const selLocal = h('select', { id: 'a-local' }) as HTMLSelectElement
  const filaLocal = h('div')
  const err = h('div')
  const nombre = h('input', { type: 'text', id: 'a-nombre', autocomplete: 'name', maxlength: '80' }) as HTMLInputElement
  const wa = h('input', { type: 'tel', id: 'a-wa', autocomplete: 'tel', inputmode: 'tel', maxlength: '32' }) as HTMLInputElement
  const ok = h('input', { type: 'checkbox', id: 'a-ok' }) as HTMLInputElement
  const caja = h('div', { class: 'turnstile' })
  const enviar = h('button', { type: 'submit', class: 'btn' }, t.alta_enviar) as HTMLButtonElement
  let token = ''
  const widget: { id?: string } = {}
  const form = h('form', {
    onsubmit: async (e: Event) => {
      e.preventDefault(); err.replaceChildren()
      if (nombre.value.trim().length < 2 || !wa.value.trim() || !ok.checked || !token) { err.append(avisoEl('err', t.alta_falta)); return }
      if (filaLocal.childElementCount > 0) localElegido = selLocal.value
      if (filaLocal.childElementCount > 0 && !localElegido) { err.append(avisoEl('err', t.alta_local_falta)); return }
      enviar.disabled = true; enviar.textContent = t.alta_enviando
      const r = await api<{ ok: boolean; portal?: string }>('alta', { method: 'POST', body: JSON.stringify({
        nombre: nombre.value, whatsapp: wa.value, acepto: AVISO_PRIVACIDAD_VERSION, ref: /^[A-HJ-NP-Z2-9]{8}$/.test(ref) ? ref : '', turnstile: token,
        ...(localElegido ? { local: localElegido } : {}) }) })
      if (r.ok) {
        const portal = r.data?.portal
        pintar(h('h1', {}, t.alta_titulo), avisoEl('ok', portal ? t.alta_listo : t.alta_listo_sin_link),
          portal && portal.startsWith(`${CLUB_BASE_URL}/p/`)
            ? h('a', { class: 'btn', href: new URL(portal).pathname }, t.alta_portal) : null,
          // B2: el pase en estado pendiente, al final de la autoalta (solo con el link del portal de una persona nueva)
          portal && portal.startsWith(`${CLUB_BASE_URL}/p/`) ? botonWallet(new URL(portal).pathname.split('/').pop() ?? '') : null)
        anunciar(portal ? t.alta_listo : t.alta_listo_sin_link)
        return
      }
      enviar.disabled = false; enviar.textContent = t.alta_enviar
      token = ''; ts?.reset(widget.id)
      err.append(avisoEl('err', msgError(r.error)))
    },
  },
    h('label', { for: 'a-nombre' }, t.alta_nombre), nombre,
    h('label', { for: 'a-wa' }, t.alta_whatsapp), wa,
    filaLocal,
    h('details', { class: 'aviso-priv', open: true }, h('summary', {}, t.alta_aviso_titulo), ...t.alta_aviso.split('\n').map((p) => h('p', {}, p)),
      h('p', { class: 'sub' }, `(${AVISO_PRIVACIDAD_VERSION})`)),
    h('label', { class: 'check', for: 'a-ok' }, ok, h('span', {}, t.alta_acepto)),
    caja, err, enviar)
  pintar(h('h1', {}, t.alta_titulo), h('p', { class: 'sub' }, t.alta_sub), h('section', { class: 'tarjeta' }, form))
  // LC-ML: con más de un local encendido (y sin uno válido en el enlace), la persona elige
  void api<LocalPub[]>('locales').then(r => {
    if (!r.ok || !Array.isArray(r.data) || r.data.length < 2 || r.data.some(l => l.id === localElegido)) return
    localElegido = ''
    selLocal.append(h('option', { value: '' }, t.alta_local_elegir), ...r.data.map(l => h('option', { value: l.id }, l.nombre)))
    filaLocal.append(h('label', { for: 'a-local' }, t.alta_local), selLocal)
  })
  const ts = await cargarTurnstile()
  if (!ts) { err.append(avisoEl('err', t.alta_verificacion)); return }
  widget.id = ts.render(caja, { sitekey: TURNSTILE_SITEKEY, language: idioma,
    callback: (v: string) => { token = v }, 'expired-callback': () => { token = '' }, 'error-callback': () => { token = '' } })
}

function paginaPase(token: string) {
  if (!/^[0-9a-f]{64}$/.test(token)) return pintar(h('h1', {}, t.w_titulo), avisoEl('err', t.portal_invalido))
  pintar(h('h1', {}, t.w_titulo), h('p', { class: 'sub' }, t.w_txt), seccionCanje(token, 'pase'))
}

// ── Router ───────────────────────────────────────────────────────────────────
function ruta() {
  pararReloj()
  document.documentElement.lang = idioma
  document.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === idioma)))
  if (/^\/alta\/?$/.test(location.pathname)) return paginaAlta()
  if (/^\/privacidad\/?$/.test(location.pathname)) return paginaPrivacidad()
  const m = location.pathname.match(/^\/([rcpkswb])\/([^/]+)\/?$/)
  if (!m) return pintar(h('h1', {}, t.inicio), h('p', { class: 'sub' }, t.inicio_txt))
  const [, tipo, cod] = m
  if (tipo === 'r') return paginaReferente(cod.toUpperCase())
  if (tipo === 'c') return paginaCupon(cod.toUpperCase())
  if (tipo === 'k') return pintar(h('h1', {}, t.canje_qr), h('p', { class: 'sub' }, t.k_txt))
  if (tipo === 's') return pintar(h('h1', {}, t.s_titulo), h('p', { class: 'sub' }, t.s_txt))
  if (tipo === 'w') return paginaPase(cod.toLowerCase())
  if (tipo === 'b') return paginaBajaTurista(cod.toUpperCase())
  return paginaPortal(cod.toLowerCase())
}

document.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach(b => b.addEventListener('click', () => {
  idioma = b.dataset.lang as Idioma; t = TEXTOS[idioma]; guardarIdioma(idioma); ruta()
}))
ruta()
