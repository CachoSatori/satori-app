// ───────────────────────────────────────────────────────────────────────────────────────────
//  Plantilla del correo del cierre de caja (cierre del día COMPLETO), con el estándar de reportes Satori
//  adaptado a correo (correo-estandar.ts). SOLO forma y redacción: las cifras son las mismas del correo
//  anterior (las mismas columnas de cash_cierres_dia, las mismas sumas y el mismo umbral de «cuadra»,
//  |diferencia| < ₡500). No reimplementa la matemática del cierre: muestra lo que el cierre ya selló.
// ───────────────────────────────────────────────────────────────────────────────────────────

import {
  COLOR, cabecera, celdaNombre, cifras, crc, documento, esc, fechaCorta, gris, miles, nombrePropio, parrafo, pct, pie,
  seccion, tabla, usd, variacion, verbo, type Cifra,
} from './correo-estandar.ts'
import type { Destacado, ResumenCorreo, ResumenDia } from './resumen.ts'

/** Campos de cash_cierres_dia que usa el correo (tipo estructural: index.ts pasa la fila tal cual). */
export interface CierreCorreo {
  session_date: string
  manager: string | null
  vm_crc: number | null; vm_usd: number | null
  vn_crc: number | null; vn_usd: number | null
  propinas_m_crc: number | null; propinas_n_crc: number | null
  sep_diaria_crc: number | null; sep_diaria_usd: number | null
  sep_registradora_crc: number | null; sep_registradora_usd: number | null
  remanente_crc: number | null; remanente_usd: number | null
  diferencia_crc: number | null
  ajuste_tipo: string | null; ajuste_motivo: string | null
  notas: string | null; tipo_cambio: number | null
}

const N = (v: unknown): number => (typeof v === 'number' && isFinite(v) ? v : 0)

/** Umbral de «cuadra» del correo anterior (sin cambios): diferencia menor a ₡500 en valor absoluto. */
export const UMBRAL_CUADRA = 500

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** «2026-11-15» → «15 de noviembre» (título de página). */
export function tituloFecha(iso: string): string {
  const r = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  if (!r) return String(iso ?? '')
  return `${Number(r[3])} de ${MESES[Number(r[2]) - 1] ?? ''}`
}

/** Tipo de cambio con coma decimal y hasta 2 decimales: 505.2 → «₡505,20»; 510 → «₡510». */
export function tipoCambio(v: number): string {
  const x = N(v)
  if (Number.isInteger(x)) return crc(x)
  const c = Math.round(x * 100)
  return '₡' + miles(Math.floor(c / 100)) + ',' + String(c % 100).padStart(2, '0')
}

const usdGris = (v: number) => (N(v) > 0 ? `<span style="color:${COLOR.gris}">${usd(N(v))}</span>` : '')

/**
 * El correo del cierre. `resumen`:
 *   · `undefined` → sin sección de ventas (el correo de antes, tal cual);
 *   · `null`      → la sección dice «Resumen de ventas no disponible» (falló la lectura, cierre viejo…);
 *   · objeto      → la sección «Ventas del día».
 *
 * Orden (v18, decisión del dueño 20-nov: más corto y lo importante arriba):
 *   cabecera → Resumen del día (lo que escribió el encargado; si viene vacío, no va) → Diferencia (con «Cerró X,
 *   tipo de cambio Y» en gris) → Ventas del día → Salonero destacado → cifras de caja → Distribución del conteo
 *   físico → pie. Sin título ni bajada (repetían la diferencia) y sin la sección «Notas» del final (ahora es el
 *   Resumen del día).
 */
export function buildHtml(c: CierreCorreo, resumen?: ResumenCorreo | null): string {
  const reporte = 'Cierre de caja'
  const fecha = fechaCorta(c.session_date)
  // Mismas cuentas que el correo anterior.
  const propPagadas = N(c.propinas_m_crc) + N(c.propinas_n_crc)
  const totalCRC = N(c.sep_diaria_crc) + N(c.sep_registradora_crc) + N(c.remanente_crc)
  const totalUSD = N(c.sep_diaria_usd) + N(c.sep_registradora_usd) + N(c.remanente_usd)
  const dif = N(c.diferencia_crc)
  const cuadra = Math.abs(dif) < UMBRAL_CUADRA
  const tc = N(c.tipo_cambio)
  const manager = (c.manager ?? '').trim()
  const ajusteTipo = (c.ajuste_tipo ?? '').trim() || (dif < 0 ? 'Faltante' : 'Sobrante')
  const motivo = (c.ajuste_motivo ?? '').trim()
  const notas = (c.notas ?? '').trim()

  let html = cabecera(reporte, fecha)

  // 1. Resumen del día: el texto del encargado, tal cual (escapado, con sus saltos de línea).
  if (notas) {
    html += seccion('Resumen del día')
    html += parrafo(textoConSaltos(notas))
  }

  // 2. Diferencia: verbo de acción en musgo («Cuadra») o laca (faltante / sobrante), con el monto y el motivo;
  //    abajo, en gris, quién cerró y con qué tipo de cambio.
  const quien = gris(`${manager ? `Cerró ${manager}, tipo` : 'Tipo'} de cambio ${tipoCambio(tc)}`)
  html += seccion('Diferencia')
  html += cuadra
    ? parrafo(`${verbo('Cuadra', COLOR.musgo)}&nbsp;&nbsp;${gris('sin diferencia')}<br>${quien}`)
    : parrafo(`${verbo(ajusteTipo, COLOR.laca)}&nbsp;&nbsp;<span style="font-weight:600;color:${COLOR.laca}">${dif >= 0 ? '+' : ''}${crc(dif)}</span>${motivo ? `<br>${gris(motivo)}` : ''}<br>${quien}`)

  // 3. Ventas del día y salonero destacado (resumen del PoS).
  if (resumen !== undefined) html += seccionVentas(resumen)

  // 4. Cifras de la caja (las mismas de siempre).
  const lista: Cifra[] = [
    { valor: crc(N(c.vm_crc)), etiqueta: 'ventas mediodía', variacionHtml: usdGris(N(c.vm_usd)) },
    { valor: crc(N(c.vn_crc)), etiqueta: 'ventas noche', variacionHtml: usdGris(N(c.vn_usd)) },
  ]
  if (propPagadas > 0) lista.push({ valor: crc(-propPagadas), etiqueta: 'propinas pagadas en el cierre' })
  lista.push({ valor: crc(totalCRC), etiqueta: 'total contado', variacionHtml: usdGris(totalUSD) })
  html += seccion('Caja del día') + cifras(lista)

  // 5. Conteo físico
  html += seccion('Distribución del conteo físico', 'A dónde fue el efectivo contado.')
  const fila = (nombre: string, colones: number, dolares: number) =>
    [celdaNombre(nombre), crc(colones), dolares > 0 ? usd(dolares) : gris('—')]
  html += tabla(
    [{ titulo: 'destino', ancho: 46 }, { titulo: 'colones', ancho: 30, derecha: true }, { titulo: 'dólares', ancho: 24, derecha: true }],
    [
      fila('Caja diaria mañana', N(c.sep_diaria_crc), N(c.sep_diaria_usd)),
      fila('Caja registradora', N(c.sep_registradora_crc), N(c.sep_registradora_usd)),
      fila('Remanente CF', N(c.remanente_crc), N(c.remanente_usd)),
      [celdaNombre('Total contado'), `<span style="font-weight:600">${crc(totalCRC)}</span>`, totalUSD > 0 ? `<span style="font-weight:600">${usd(totalUSD)}</span>` : gris('—')],
    ],
  )

  html += pie('cierre de caja', fecha, resumen ? NOTA_VENTAS(resumen) : undefined)
  return documento(`Satori, cierre de caja, ${fecha}`, html)
}

/** Texto libre escapado, con los saltos de línea como <br> (CRLF incluido). */
export function textoConSaltos(t: string): string {
  return esc(t).replace(/\r\n|\r|\n/g, '<br>')
}

// ── Ventas del día (resumen del PoS) ─────────────────────────────────────────────────────────

/** Definiciones, al pie (el estándar: cada número dice de dónde sale). */
export const NOTA_VENTAS = (r: ResumenCorreo): string =>
  'Ventas: del PoS, por la jornada de la caja (una factura de madrugada cobrada por la caja de la noche es del día del cierre). ' +
  'Neta: sin IVA ni servicio; bruta: neta + IVA + servicio. ' +
  'Promedio por pax: neta de salón ÷ personas de salón, sin mesas de dueños ni regalías totales; las mesas sin pax suman personas estimadas. ' +
  'Bebidas por pax: unidades de bebida de los meseros ÷ pax de los meseros (el «Beb/PAX» de la app). ' +
  `Mejor promedio por pax: solo saloneros con al menos ${r.minMesas} mesas y ${r.minPersonas} personas. ` +
  'Las flechas comparan con el mismo día de la semana pasada.'

const dec2 = (v: number): string => {
  const c = Math.round(v * 100)
  return `${Math.floor(Math.abs(c) / 100)},${String(Math.abs(c) % 100).padStart(2, '0')}`
}
const promTxt = (v: number | null): string => (v === null ? '—' : crc(v))
const bebTxt = (v: number | null): string => (v === null ? '—' : dec2(v))
const nombreDe = (s: Destacado): string => (s.nombre ? nombrePropio(s.nombre) : `código ${s.login}`)

function seccionVentas(resumen: ResumenCorreo | null): string {
  let html = seccion('Ventas del día')
  if (!resumen) return html + parrafo(gris('Resumen de ventas no disponible.'))
  const a = resumen.actual
  const b: ResumenDia | null = resumen.anterior && resumen.anterior.facturas > 0 ? resumen.anterior : null
  const contra = b ? `vs ${fechaCorta(b.dia)}` : ''
  if (a.facturas === 0) {
    return html + parrafo(gris(`No hay ventas cerradas en el PoS para esta jornada.${b ? ` El ${fechaCorta(b.dia)} se vendieron ${crc(b.ventaNeta)} netos.` : ''}`))
  }
  const v = (x: number | null, y: number | null | undefined) => (b && x !== null && y !== null && y !== undefined ? variacion(x, y, contra) : '')
  html += cifras([
    { valor: crc(a.ventaNeta), etiqueta: 'venta neta', variacionHtml: v(a.ventaNeta, b?.ventaNeta) },
    { valor: miles(a.pax), etiqueta: 'pax', variacionHtml: v(a.pax, b?.pax) },
    { valor: promTxt(a.promPax), etiqueta: 'promedio por pax', variacionHtml: v(a.promPax, b?.promPax) },
    { valor: bebTxt(a.bebPax), etiqueta: 'bebidas por pax' },
  ])
  const otra = (txt: string) => (b ? txt : gris('—'))
  const filas: string[][] = [
    [celdaNombre('Venta bruta'), crc(a.ventaBruta), otra(b ? crc(b.ventaBruta) : '')],
    [celdaNombre('Venta neta'), `<span style="font-weight:600">${crc(a.ventaNeta)}</span>`, otra(b ? crc(b.ventaNeta) : '')],
    [celdaNombre('Salón'), crc(a.salon), otra(b ? crc(b.salon) : '')],
    [celdaNombre('Delivery'), a.delivery ? crc(a.delivery) : gris('—'), otra(b ? (b.delivery ? crc(b.delivery) : gris('—')) : '')],
    [celdaNombre('Pax'), miles(a.pax), otra(b ? miles(b.pax) : '')],
    [celdaNombre('Promedio por pax'), promTxt(a.promPax), otra(b ? promTxt(b.promPax) : '')],
    [celdaNombre('Bebidas por pax'), bebTxt(a.bebPax), otra(b ? bebTxt(b.bebPax) : '')],
  ]
  const notas: string[] = []
  if (a.pctEstimado > 0) notas.push(`El promedio por pax incluye ${pct(a.pctEstimado)} de personas estimadas.`)
  const fuera = [
    a.mesasDuenos ? `${a.mesasDuenos} ${a.mesasDuenos === 1 ? 'mesa' : 'mesas'} de dueños` : '',
    a.regaliasTotales ? `${a.regaliasTotales} ${a.regaliasTotales === 1 ? 'regalía total' : 'regalías totales'}` : '',
  ].filter(Boolean)
  if (fuera.length) notas.push(`Fuera del promedio: ${fuera.join(' y ')}.`)
  html += tabla(
    [{ titulo: 'concepto', ancho: 40 }, { titulo: 'este día', ancho: 30, derecha: true },
      { titulo: b ? `${fechaCorta(b.dia)}` : 'semana pasada', ancho: 30, derecha: true }],
    filas,
    notas.join(' ') || undefined,
  )
  // Salonero destacado, con los dos criterios.
  const mv = a.masVendio
    ? `Más vendió: <span style="font-weight:600">${esc(nombreDe(a.masVendio))}</span>&nbsp;&nbsp;${gris(`${crc(a.masVendio.netaSalon)} de salón`)}`
    : gris('Más vendió: ningún salonero con ventas de salón.')
  const mp = a.mejorPromPax
    ? `Mejor promedio por pax: <span style="font-weight:600">${esc(nombreDe(a.mejorPromPax))}</span>&nbsp;&nbsp;${gris(`${promTxt(a.mejorPromPax.promPax)} · ${a.mejorPromPax.personas} pax en ${a.mejorPromPax.mesas} mesas`)}`
    : gris(`Mejor promedio por pax: nadie llegó a ${resumen.minMesas} mesas y ${resumen.minPersonas} personas.`)
  html += seccion('Salonero destacado')
  html += parrafo(`${mv}<br>${mp}`)
  return html
}
