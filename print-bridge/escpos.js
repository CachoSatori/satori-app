// Constructor mínimo de comandos ESC/POS para impresoras térmicas (3nStar RPT004
// y compatibles). Sin dependencias: arma un Buffer de bytes y, en paralelo, un
// render de texto plano para el modo simulación (lo que saldría en papel).

const ESC = 0x1b, GS = 0x1d
const LF = '\n'

class EscPos {
  constructor(width = 42) {
    this.width = width            // columnas de la fuente A en 80mm ≈ 42/48; 58mm ≈ 32
    this.bytes = [ESC, 0x40]      // ESC @ — init/reset
    this.preview = []             // líneas de texto para el modo simulación
    this._align = 'left'
  }

  raw(...b) { this.bytes.push(...b); return this }

  align(a) {
    this._align = a
    this.raw(ESC, 0x61, a === 'center' ? 1 : a === 'right' ? 2 : 0)
    return this
  }

  bold(on) { this.raw(ESC, 0x45, on ? 1 : 0); return this }

  // ESC ! n — tamaño (bit4 doble alto, bit5 doble ancho)
  size(big) { this.raw(ESC, 0x21, big ? 0x30 : 0x00); return this }

  _pushPreview(text) {
    const t = String(text)
    if (this._align === 'center') this.preview.push(this._center(t))
    else if (this._align === 'right') this.preview.push(this._padLeft(t))
    else this.preview.push(t)
  }

  _center(t) { const pad = Math.max(0, Math.floor((this.width - t.length) / 2)); return ' '.repeat(pad) + t }
  _padLeft(t) { return ' '.repeat(Math.max(0, this.width - t.length)) + t }

  line(text = '') {
    this.bytes.push(...Buffer.from(text + LF, 'latin1'))
    this._pushPreview(text)
    return this
  }

  // Una fila "etiqueta .... valor" justificada a lo ancho del papel.
  row(left, right) {
    const space = Math.max(1, this.width - left.length - right.length)
    return this.line(left + ' '.repeat(space) + right)
  }

  rule(ch = '-') { return this.line(ch.repeat(this.width)) }

  feed(n = 1) { this.raw(ESC, 0x64, n); for (let i = 0; i < n; i++) this.preview.push(''); return this }

  cut() { this.raw(GS, 0x56, 0x00); return this }   // GS V 0 — corte total

  buffer() { return Buffer.from(this.bytes) }
  text() { return this.preview.join('\n') }
}

module.exports = { EscPos }
