// ─────────────────────────────────────────────────────────────────────────────────────────────
//  Plantilla del correo del cierre de caja (cierre del día COMPLETO), con el estándar de reportes Satori
//  adaptado a correo (correo-estandar.ts). SOLO forma y redacción: las cifras son las mismas del correo
//  anterior (las mismas columnas de cash_cierres_dia, las mismas sumas y el mismo umbral de «cuadra»,
//  |diferencia| < ₡500). No reimplementa la matemática del cierre: muestra lo que el cierre ya selló.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import {
  COLOR, cabecera, celdaNombre, cifras, crc, documento, esc, fechaCorta, gris, miles, parrafo, pie,
  seccion, tabla, titulo, usd, verbo, type Cifra,
} from './correo-estandar.ts'

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

export function buildHtml(c: CierreCorreo): string {
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

  // Bajada: la conclusión primero.
  const conclusion = cuadra
    ? 'La caja cuadra, sin diferencia.'
    : `${ajusteTipo} de ${crc(Math.abs(dif))}${motivo ? `: ${motivo}` : ''}.`
  const quien = `${manager ? `Cerró ${manager}` : 'Cierre'}, con tipo de cambio ${tipoCambio(tc)}.`
  const bajada = esc(`${conclusion} ${quien}`)

  const lista: Cifra[] = [
    { valor: crc(N(c.vm_crc)), etiqueta: 'ventas mediodía', variacionHtml: usdGris(N(c.vm_usd)) },
    { valor: crc(N(c.vn_crc)), etiqueta: 'ventas noche', variacionHtml: usdGris(N(c.vn_usd)) },
  ]
  if (propPagadas > 0) lista.push({ valor: crc(-propPagadas), etiqueta: 'propinas pagadas en el cierre' })
  lista.push({ valor: crc(totalCRC), etiqueta: 'total contado', variacionHtml: usdGris(totalUSD) })

  let html = cabecera(reporte, fecha) + titulo(tituloFecha(c.session_date), bajada) + cifras(lista)

  // Diferencia: verbo de acción en musgo («Cuadra») o laca (faltante / sobrante), con el monto y el motivo.
  html += seccion('Diferencia')
  html += cuadra
    ? parrafo(`${verbo('Cuadra', COLOR.musgo)}&nbsp;&nbsp;${gris('sin diferencia')}`)
    : parrafo(`${verbo(ajusteTipo, COLOR.laca)}&nbsp;&nbsp;<span style="font-weight:600;color:${COLOR.laca}">${dif >= 0 ? '+' : ''}${crc(dif)}</span>${motivo ? `<br>${gris(motivo)}` : ''}`)

  // Conteo físico
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

  if (notas) {
    html += seccion('Notas')
    html += parrafo(esc(notas), COLOR.gris)
  }

  html += pie('cierre de caja', fecha)
  return documento(`Satori, cierre de caja, ${fecha}`, html)
}
