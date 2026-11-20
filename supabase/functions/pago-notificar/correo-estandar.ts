// ─────────────────────────────────────────────────────────────────────────────────────────────
//  Correo con el estándar de reportes Satori (docs/club-satori/ESTANDAR-reportes.md, v1, 05-nov-2026)
//  adaptado a correo (16-nov-2026, pedido del dueño): papel blanco, tinta y gris, oro solo como filete,
//  laca y musgo solo para malas y buenas noticias, Cormorant Garamond + DM Sans (link de Google Fonts
//  con respaldo Georgia / Helvetica, Arial: en correo NO va base64), cifras con filetes y sin cajas,
//  tablas sin fondo con filete de oro bajo el encabezado y máximo 10 filas.
//
//  HTML de correo: tablas para el layout, CSS inline, 640 px de ancho, sin fondos de color (así el modo
//  oscuro de Gmail lo invierte limpio), sin sombras, sin mayúsculas para etiquetas, sin monoespaciadas.
//  Números y fechas a mano (sin toLocaleString: depende del ICU del runtime de Deno).
//
//  ⚠️ Este archivo está COPIADO igual en cada función que manda correo (monthly-report, cierre-email,
//  pago-notificar): hasta el ítem 11 cada función se despliega sola desde su rama. Con el ítem 11 pasa a
//  `supabase/functions/_shared/`. Si cambiás uno, cambiá los tres.
// ─────────────────────────────────────────────────────────────────────────────────────────────

export const COLOR = {
  tinta: '#1f2120',
  gris: '#6e706c',
  grisClaro: '#9a9b96',
  linea: '#e6e4de',
  oro: '#b48e50',       // solo filetes y barras, nunca texto chico
  oroTexto: '#8a6a33',
  laca: '#a3392d',      // solo malas noticias
  musgo: '#3e6a4c',     // subas, «cuadra», estados cerrados
  barra: '#cfcbc1',
  papel: '#ffffff',
} as const

export const SERIF = "'Cormorant Garamond', Georgia, 'Times New Roman', serif"
export const SANS = "'DM Sans', Helvetica, Arial, sans-serif"
const NUM = 'font-variant-numeric:tabular-nums lining-nums'
export const ANCHO = 640

const FUENTES = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=DM+Sans:wght@400;500;600&display=swap'

// ── Texto seguro ──────────────────────────────────────────────────────────────────────────────
export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

// ── Números (estándar §7: punto de miles, coma decimal, ₡ pegado, «60 %») ─────────────────────
const n0 = (v: unknown): number => (typeof v === 'number' && isFinite(v) ? v : 0)

/** 1234567.4 → «1.234.567» (redondeo al entero; el signo menos va como «−»). */
export function miles(v: number): string {
  const r = Math.round(n0(v))
  const s = String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return (r < 0 ? '−' : '') + s
}
/** ₡ pegado: «₡226.375» · negativo «−₡1.200». */
export function crc(v: number): string {
  const r = Math.round(n0(v))
  return (r < 0 ? '−' : '') + '₡' + miles(Math.abs(r))
}
/** Dólares con dos decimales: «$1.234,50». */
export function usd(v: number): string {
  const c = Math.round(n0(v) * 100)
  const abs = Math.abs(c)
  return (c < 0 ? '−' : '') + '$' + miles(Math.floor(abs / 100)) + ',' + String(abs % 100).padStart(2, '0')
}
/** Porcentaje con espacio: «60 %». Entero; con un decimal (coma) solo si redondeado daría 0 sin serlo. */
export function pct(v: number): string {
  const x = n0(v)
  const r = Math.round(x)
  if (r === 0 && x !== 0) return x.toFixed(1).replace('.', ',').replace('-', '−') + ' %'
  return (r < 0 ? '−' : '') + Math.abs(r) + ' %'
}

// ── Fechas (estándar §7: «15 jun 26» en tablas, «15 de junio» en texto, meses en minúscula) ────
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

function partesFecha(iso: string): { y: number; m: number; d: number } | null {
  const r = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''))
  if (!r) return null
  const m = Number(r[2])
  if (m < 1 || m > 12) return null
  return { y: Number(r[1]), m, d: Number(r[3]) }
}
/** «2026-11-15» → «15 nov 26». Si no es fecha, el texto tal cual (escapado por quien lo use). */
export function fechaCorta(iso: string): string {
  const p = partesFecha(iso)
  return p ? `${p.d} ${MES_CORTO[p.m - 1]} ${String(p.y).slice(2)}` : String(iso ?? '')
}
/** «2026-11-15» → «15 de noviembre de 2026». */
export function fechaLarga(iso: string): string {
  const p = partesFecha(iso)
  return p ? `${p.d} de ${MESES[p.m - 1]} de ${p.y}` : String(iso ?? '')
}

/** «MARÍA JOSÉ» → «María José» (nombres que el sistema guarda en mayúsculas; solo para mostrar). */
export function nombrePropio(s: string): string {
  return String(s ?? '').toLocaleLowerCase('es').replace(/(^|[\s\-/(])(\p{L})/gu, (_m, a: string, b: string) => a + b.toLocaleUpperCase('es'))
}
/** «SALMON ROLL ESPECIAL» → «Salmon roll especial» (productos: solo la primera letra). */
export function nombreFrase(s: string): string {
  const t = String(s ?? '').toLocaleLowerCase('es')
  return t.charAt(0).toLocaleUpperCase('es') + t.slice(1)
}

// ── Variación (estándar §5): ▲ musgo si > 130 % del anterior, ▼ laca si < 70 %, el resto gris sin flecha ─
export type Tono = 'sube' | 'baja' | 'igual'
export function tonoVariacion(actual: number, anterior: number): Tono | null {
  if (!(anterior > 0)) return null
  const r = actual / anterior
  return r > 1.3 ? 'sube' : r < 0.7 ? 'baja' : 'igual'
}
/** «▲ +45 %» / «▼ −40 %» / «+12 %», con su color; `null` si no hay base (anterior ≤ 0). */
export function variacion(actual: number, anterior: number, contra: string): string {
  const t = tonoVariacion(actual, anterior)
  if (!t) return ''
  const d = (actual - anterior) / anterior * 100
  const signo = d > 0 ? '+' : ''
  const texto = `${signo}${pct(d)}`
  const color = t === 'sube' ? COLOR.musgo : t === 'baja' ? COLOR.laca : COLOR.gris
  const flecha = t === 'sube' ? '▲ ' : t === 'baja' ? '▼ ' : ''
  return `<span style="color:${color};font-weight:600">${flecha}${texto}</span>` +
    `<span style="color:${COLOR.gris}"> ${esc(contra)}</span>`
}

// ── Piezas ────────────────────────────────────────────────────────────────────────────────────
const P = `margin:0;font-family:${SANS};color:${COLOR.tinta}`

/** Documento completo. `cuerpo` = filas <tr> de la tabla principal. */
export function documento(tituloHtml: string, cuerpo: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(tituloHtml)}</title>
<link href="${FUENTES}" rel="stylesheet">
<style>
  body { margin:0; padding:0; -webkit-text-size-adjust:100%; }
  table { border-collapse:collapse; }
  @media only screen and (max-width:520px) {
    .contenedor { width:100% !important; }
    .margen { padding-left:18px !important; padding-right:18px !important; }
    .cifra { display:inline-block !important; width:50% !important; box-sizing:border-box; border-left:0 !important; padding:0 8px 14px 0 !important; }
    .titulo { font-size:30px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${COLOR.papel}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLOR.papel}">
<tr><td align="center" style="padding:0">
<table role="presentation" class="contenedor" width="${ANCHO}" cellpadding="0" cellspacing="0" border="0" style="width:${ANCHO}px;max-width:100%">
${cuerpo}
</table>
</td></tr>
</table>
</body>
</html>`
}

/** Cabecera: «Satori» a la izquierda; nombre del reporte y período en gris a la derecha; filete de oro. */
export function cabecera(reporte: string, periodo: string): string {
  return `<tr><td class="margen" style="padding:28px 32px 0 32px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-bottom:1px solid ${COLOR.oro}">
<tr>
<td valign="bottom" style="padding:0 0 10px 0;font-family:${SERIF};font-size:23px;line-height:1;font-weight:600;letter-spacing:.02em;color:${COLOR.tinta}">Satori</td>
<td valign="bottom" align="right" style="padding:0 0 10px 0;font-family:${SANS};font-size:11px;line-height:1.4;color:${COLOR.gris};text-align:right">${esc(reporte)}<br>${esc(periodo)}</td>
</tr>
</table>
</td></tr>`
}

/** Título de página (Cormorant 500) y bajada con la conclusión (DM Sans gris). */
export function titulo(texto: string, bajadaHtml: string): string {
  return `<tr><td class="margen" style="padding:22px 32px 0 32px">
<h1 class="titulo" style="margin:0;font-family:${SERIF};font-size:34px;line-height:1.05;font-weight:500;color:${COLOR.tinta}">${esc(texto)}</h1>
${bajadaHtml ? `<p style="${P};margin-top:8px;font-size:13px;line-height:1.5;color:${COLOR.gris};max-width:560px">${bajadaHtml}</p>` : ''}
</td></tr>`
}

export interface Cifra { valor: string; etiqueta: string; variacionHtml?: string }

/** Fila de cifras clave: hasta 4 columnas separadas por filetes color línea, sin cajas. */
export function cifras(lista: Cifra[]): string {
  const cs = lista.slice(0, 4)
  if (!cs.length) return ''
  const ancho = Math.floor(100 / cs.length)
  const celdas = cs.map((c, i) => `<td class="cifra" valign="top" width="${ancho}%" style="width:${ancho}%;padding:0 10px 0 ${i === 0 ? 0 : 12}px;${i === 0 ? '' : `border-left:1px solid ${COLOR.linea};`}">
<div style="font-family:${SERIF};font-size:30px;line-height:1;font-weight:500;color:${COLOR.tinta};${NUM};white-space:nowrap">${c.valor}</div>
<div style="font-family:${SANS};font-size:11px;line-height:1.35;color:${COLOR.gris};margin-top:6px">${esc(c.etiqueta)}</div>
${c.variacionHtml ? `<div style="font-family:${SANS};font-size:11px;line-height:1.35;margin-top:3px;${NUM}">${c.variacionHtml}</div>` : ''}
</td>`).join('\n')
  return `<tr><td class="margen" style="padding:22px 32px 0 32px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr>
${celdas}
</tr>
</table>
</td></tr>`
}

/** Título de sección (Cormorant 600, minúscula normal) + nota gris de una línea. */
export function seccion(tituloSeccion: string, nota?: string): string {
  return `<tr><td class="margen" style="padding:26px 32px 0 32px">
<h2 style="margin:0;font-family:${SERIF};font-size:19px;line-height:1.2;font-weight:600;color:${COLOR.tinta}">${esc(tituloSeccion)}</h2>
${nota ? `<p style="${P};margin-top:3px;font-size:11px;line-height:1.4;color:${COLOR.gris}">${esc(nota)}</p>` : ''}
</td></tr>`
}

export interface Columna { titulo: string; ancho: number; derecha?: boolean }

/** Barrita fina (gráfico de barras en correo): oro la destacada, gris cálido el resto. */
export function barrita(valor: number, max: number, destacada = false): string {
  const w = max > 0 ? Math.max(0, Math.min(100, Math.round(valor / max * 100))) : 0
  if (w <= 0) return ''
  return `<table role="presentation" width="${w}%" cellpadding="0" cellspacing="0" border="0" style="width:${w}%"><tr><td height="6" style="height:6px;line-height:6px;font-size:0;background:${destacada ? COLOR.oro : COLOR.barra}" bgcolor="${destacada ? COLOR.oro : COLOR.barra}">&nbsp;</td></tr></table>`
}

export const MAX_FILAS = 10

/**
 * Tabla del estándar: sin fondo ni borde exterior, filete de oro bajo el encabezado, líneas finas entre
 * filas, anchos fijos con <colgroup>, números a la derecha, textos largos en dos líneas (nunca «…»).
 * Máximo 10 filas: si vienen más, se muestran 10 y una nota gris dice cuántas quedaron afuera.
 * Las celdas llegan como HTML ya escapado.
 */
export function tabla(cols: Columna[], filas: string[][], notaPie?: string): string {
  const visibles = filas.slice(0, MAX_FILAS)
  const resto = filas.length - visibles.length
  const th = (c: Columna, i: number) => `<th align="${c.derecha ? 'right' : 'left'}" style="padding:0 ${i === cols.length - 1 ? 0 : 8}px 6px ${i === 0 ? 0 : 8}px;font-family:${SANS};font-size:10.5px;line-height:1.3;font-weight:500;color:${COLOR.gris};text-align:${c.derecha ? 'right' : 'left'};border-bottom:1px solid ${COLOR.oro}">${esc(c.titulo)}</th>`
  const td = (html: string, c: Columna, i: number, ultima: boolean) => `<td valign="top" align="${c.derecha ? 'right' : 'left'}" style="padding:7px ${i === cols.length - 1 ? 0 : 8}px 7px ${i === 0 ? 0 : 8}px;font-family:${SANS};font-size:12px;line-height:1.35;color:${COLOR.tinta};text-align:${c.derecha ? 'right' : 'left'};${NUM};${ultima ? '' : `border-bottom:1px solid ${COLOR.linea};`}">${html}</td>`
  const pie = [resto > 0 ? `Se muestran ${MAX_FILAS} de ${filas.length}.` : '', notaPie ?? ''].filter(Boolean).join(' ')
  return `<tr><td class="margen" style="padding:10px 32px 0 32px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed">
<colgroup>${cols.map((c) => `<col width="${c.ancho}%" style="width:${c.ancho}%">`).join('')}</colgroup>
<tr>${cols.map(th).join('')}</tr>
${visibles.map((f, k) => `<tr>${cols.map((c, i) => td(f[i] ?? '', c, i, k === visibles.length - 1)).join('')}</tr>`).join('\n')}
</table>
${pie ? `<p style="${P};margin-top:6px;font-size:10.5px;line-height:1.4;color:${COLOR.gris}">${esc(pie)}</p>` : ''}
</td></tr>`
}

/** Celda de nombre: en 600, con el detalle en gris debajo si hace falta. */
export function celdaNombre(nombre: string, detalle?: string): string {
  return `<span style="font-weight:600">${esc(nombre)}</span>${detalle ? `<br><span style="color:${COLOR.gris}">${esc(detalle)}</span>` : ''}`
}
/** Texto gris dentro de una celda. */
export function gris(texto: string): string {
  return `<span style="color:${COLOR.gris}">${esc(texto)}</span>`
}

/** Párrafo de cuerpo (DM Sans 13 px). `html` ya escapado. */
export function parrafo(html: string, color: string = COLOR.tinta): string {
  return `<tr><td class="margen" style="padding:12px 32px 0 32px"><p style="${P};font-size:13px;line-height:1.5;color:${color}">${html}</p></td></tr>`
}

/** Verbo de acción (Cormorant itálica) con su color: laca, musgo, oro texto o tinta. */
export function verbo(texto: string, color: string): string {
  return `<span style="font-family:${SERIF};font-style:italic;font-size:19px;font-weight:500;color:${color}">${esc(texto)}</span>`
}

/** Pie: «Satori, [reporte], [período]» en gris claro, con un filete color línea arriba. */
export function pie(reporte: string, periodo: string, extra?: string): string {
  return `<tr><td class="margen" style="padding:30px 32px 28px 32px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${COLOR.linea}">
<tr><td style="padding:8px 0 0 0;font-family:${SANS};font-size:10px;line-height:1.5;color:${COLOR.grisClaro}">Satori, ${esc(reporte)}, ${esc(periodo)}${extra ? `<br>${esc(extra)}` : ''}</td></tr>
</table>
</td></tr>`
}
