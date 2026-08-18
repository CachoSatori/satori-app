// Comprobante compartido (imagen PNG por Canvas + texto para WhatsApp). Lo usan el pago normal
// (CashPendientes) y la liquidación de saldo a favor (CreditoModals). Parametrizado por
// líneas/total/pie — NO conoce la semántica de caja; cada caller arma sus líneas. Solo DISPLAY:
// no toca plata ni muta amount_crc. El output del pago normal quedó byte-idéntico (defaults).

// Normaliza un WhatsApp a formato internacional para wa.me (que EXIGE código de país).
// Local CR = 8 dígitos (ej. 89900324) → 506 + número. Si ya trae 506 (11 díg) o es extranjero, se deja.
// Idempotente: '+506 8990 0324' y '50689900324' → '50689900324' (no duplica el 506).
export const waNumber = (raw: string): string => {
  const d = (raw ?? '').replace(/\D/g, '')
  if (!d) return ''
  if (d.startsWith('506') && d.length === 11) return d   // ya tiene código CR
  if (d.length === 8) return '506' + d                    // local CR 8 dígitos → +506
  return d                                                 // best-effort (ya codeado / extranjero)
}

export interface ComprobanteLinea {
  fecha: string
  nota: string            // columna "REFERENCIA / NOTA" (PNG, cortada a 38); en el texto va tras el monto
  monto: string           // columna "MONTO", ya formateado
  subnotaTexto?: string   // 2da línea del ítem en WhatsApp (entre paréntesis)
  subnotaPNG?: string     // línea gris bajo el monto en el PNG (alineada a la derecha)
}
export interface ComprobanteData {
  tituloTexto: string     // "*Satori Sushi Bar* — {tituloTexto}" (1ra línea del WhatsApp)
  tituloPNG: string       // subtítulo del PNG bajo "Satori Sushi Bar"
  proveedor: string
  lineas: ComprobanteLinea[]
  totalTexto: string      // WhatsApp: "Total: {totalTexto}"
  totalPNG: string        // Canvas: el texto grande del total (puede diferir del de texto en el espaciado del $)
  totalLabel?: string     // Canvas: etiqueta del total (default "TOTAL A PAGAR")
  pie?: string[]          // líneas extra al pie (ambos medios): p.ej. crédito usado / saldo restante
}

/** Texto plano prearmado para WhatsApp (wa.me). Determinista (sin fecha de emisión) → testeable. */
export function comprobanteTexto(d: ComprobanteData): string {
  const lineas = d.lineas.map(l => {
    const base = `• ${l.fecha || '—'}  ${l.monto}${l.nota ? '  ' + l.nota : ''}`
    return l.subnotaTexto ? `${base}\n    (${l.subnotaTexto})` : base
  }).join('\n')
  const pie = d.pie?.length ? `\n\n${d.pie.join('\n')}` : ''
  return `*Satori Sushi Bar* — ${d.tituloTexto}\n${d.proveedor}\n\n${lineas}\n\nTotal: ${d.totalTexto}${pie}`
}

/** Comprobante como imagen PNG (Canvas). Requiere DOM (browser). Resuelve null si no hay líneas
 *  o si el canvas no produce blob. Es LA fuente del PNG: la descarga y el compartir la reusan. */
export function comprobantePNGBlob(d: ComprobanteData): Promise<Blob | null> {
  const rows = d.lineas
  if (!rows.length) return Promise.resolve(null)
  const sumCount = rows.length

  const W = 760, padX = 40, rowH = 38, headerH = 200, noteH = 16
  const footH = 120 + (d.pie?.length ?? 0) * 20   // pie extra abajo (0 en el pago normal → idéntico)
  // Las filas con subnota (desglose) llevan una línea extra → alto variable.
  const H = headerH + rows.reduce((s, l) => s + rowH + (l.subnotaPNG ? noteH : 0), 0) + footH
  const c = document.createElement('canvas')
  const scale = 2
  c.width = W * scale; c.height = H * scale
  const ctx = c.getContext('2d')!
  ctx.scale(scale, scale)

  // fondo
  ctx.fillStyle = '#f5f0e8'; ctx.fillRect(0, 0, W, H)
  // encabezado
  ctx.fillStyle = '#0d0d0d'
  ctx.font = 'bold 30px Georgia, serif'
  ctx.fillText('Satori Sushi Bar', padX, 56)
  ctx.font = '14px Arial'; ctx.fillStyle = '#8a8070'
  ctx.fillText(d.tituloPNG, padX, 80)
  ctx.font = 'bold 24px Arial'; ctx.fillStyle = '#0d0d0d'
  ctx.fillText(d.proveedor, padX, 124)
  ctx.font = '13px Arial'; ctx.fillStyle = '#8a8070'
  ctx.fillText(`Emitido: ${new Date().toLocaleDateString('es-CR')}   ·   ${sumCount} factura(s)`, padX, 148)

  // header tabla
  let y = headerH - 16
  ctx.strokeStyle = '#d4cfc4'; ctx.beginPath(); ctx.moveTo(padX, y - 22); ctx.lineTo(W - padX, y - 22); ctx.stroke()
  ctx.font = 'bold 12px Arial'; ctx.fillStyle = '#8a8070'
  ctx.fillText('FECHA', padX, y - 4)
  ctx.fillText('REFERENCIA / NOTA', padX + 130, y - 4)
  ctx.textAlign = 'right'; ctx.fillText('MONTO', W - padX, y - 4); ctx.textAlign = 'left'

  // filas
  ctx.font = '14px Arial'
  rows.forEach(l => {
    const rh = rowH + (l.subnotaPNG ? noteH : 0)
    ctx.fillStyle = '#0d0d0d'
    ctx.fillText(l.fecha || '—', padX, y + rowH - 14)
    const ref = (l.nota || '—').slice(0, 38)
    ctx.fillStyle = '#5a5040'; ctx.fillText(ref, padX + 130, y + rowH - 14)
    ctx.fillStyle = '#0d0d0d'; ctx.textAlign = 'right'
    ctx.font = 'bold 14px Arial'
    ctx.fillText(l.monto, W - padX, y + rowH - 14)
    ctx.font = '14px Arial'; ctx.textAlign = 'left'
    if (l.subnotaPNG) {
      ctx.textAlign = 'right'; ctx.font = '11px Arial'; ctx.fillStyle = '#8a8070'
      ctx.fillText(l.subnotaPNG, W - padX, y + rowH + 1)
      ctx.textAlign = 'left'; ctx.font = '14px Arial'; ctx.fillStyle = '#0d0d0d'
    }
    ctx.strokeStyle = '#e6e0d4'; ctx.beginPath(); ctx.moveTo(padX, y + rh - 2); ctx.lineTo(W - padX, y + rh - 2); ctx.stroke()
    y += rh
  })

  // total
  y += 18
  ctx.strokeStyle = '#0d0d0d'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(padX, y - 26); ctx.lineTo(W - padX, y - 26); ctx.stroke(); ctx.lineWidth = 1
  ctx.font = 'bold 16px Arial'; ctx.fillStyle = '#0d0d0d'
  ctx.fillText(d.totalLabel ?? 'TOTAL A PAGAR', padX, y)
  ctx.textAlign = 'right'; ctx.font = 'bold 22px Georgia, serif'; ctx.fillStyle = '#2a7a6a'
  ctx.fillText(d.totalPNG, W - padX, y + 2); ctx.textAlign = 'left'
  // pie opcional (crédito usado / saldo restante) — arriba del footer legal.
  if (d.pie?.length) {
    ctx.font = '12px Arial'; ctx.fillStyle = '#5a5040'
    let py = y + 26
    d.pie.forEach(t => { ctx.fillText(t, padX, py); py += 20 })
  }
  ctx.font = '11px Arial'; ctx.fillStyle = '#8a8070'
  ctx.fillText('Documento generado automáticamente · Satori · Santa Teresa, CR', padX, H - 24)

  return new Promise(resolve => c.toBlob(blob => resolve(blob), 'image/png'))
}

/** Nombre de archivo del PNG (compartido por descarga y share). */
const nombrePNG = (d: ComprobanteData): string =>
  `comprobante_${d.proveedor.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.png`

/** Comprobante como imagen PNG y dispara la descarga. Byte-idéntico a antes. */
export function descargarComprobantePNG(d: ComprobanteData): void {
  void comprobantePNGBlob(d).then(blob => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = nombrePNG(d)
    a.click(); URL.revokeObjectURL(url)
  })
}

/**
 * ¿El dispositivo puede compartir ARCHIVOS por el menú del sistema? Se usa solo para decidir la
 * VISIBILIDAD del botón 💬 WhatsApp (así aparece aunque el proveedor no tenga número guardado).
 * Sonda con un File vacío: `canShare` mira el tipo/soporte, no el contenido.
 */
export function puedeCompartirArchivos(): boolean {
  try {
    if (typeof navigator === 'undefined' || !navigator.canShare || typeof File === 'undefined') return false
    return navigator.canShare({ files: [new File([], 'comprobante.png', { type: 'image/png' })] })
  } catch { return false }
}

/**
 * Envía el comprobante por WhatsApp como IMAGEN usando el menú de compartir del sistema
 * (Web Share API con archivo — requiere HTTPS + gesto de usuario; el click lo es).
 * Degradación: sin soporte de archivos → wa.me con el texto prearmado; sin número → descarga el PNG.
 * Cancelar el diálogo de compartir (AbortError) NO es error: no hace nada.
 */
export async function compartirComprobanteWhatsApp(d: ComprobanteData, numero?: string): Promise<void> {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined
  let file: File | undefined
  if (nav?.canShare && typeof nav.share === 'function' && typeof File !== 'undefined') {
    const blob = await comprobantePNGBlob(d)
    if (blob) {
      const f = new File([blob], nombrePNG(d), { type: 'image/png' })
      if (nav.canShare({ files: [f] })) file = f
    }
  }
  if (file) {
    try {
      await nav!.share!({ files: [file], title: 'Comprobante de pago', text: comprobanteTexto(d) })
      return
    } catch (e) {
      // Cancelar el diálogo (AbortError) es una decisión del usuario: se termina acá, sin ruido.
      if ((e as Error)?.name === 'AbortError') return
      // Cualquier otra falla del share → se sigue por la vía de siempre (wa.me / descarga).
    }
  }
  const wa = waNumber(numero ?? '')
  if (wa) window.open(`https://wa.me/${wa}?text=${encodeURIComponent(comprobanteTexto(d))}`, '_blank')
  else descargarComprobantePNG(d)
}
