// Piezas del estándar de reportes adaptado a correo (correo-estandar.ts). Copiado igual en cada función.
import { describe, it, expect } from 'vitest'
import {
  COLOR, crc, usd, pct, miles, fechaCorta, fechaLarga, nombrePropio, nombreFrase, tonoVariacion, variacion,
  tabla, esc, MAX_FILAS, cifras, documento, cabecera, pie,
} from './correo-estandar.ts'
import { verificarCorreo } from './correo-estandar.verificar.ts'

describe('números y fechas del estándar (§7)', () => {
  it('colones con ₡ pegado y punto de miles; sin decimales', () => {
    expect(crc(226375)).toBe('₡226.375')
    expect(crc(1234567.4)).toBe('₡1.234.567')
    expect(crc(999)).toBe('₡999')
    expect(crc(0)).toBe('₡0')
    expect(crc(-1200)).toBe('−₡1.200')
    expect(crc(Number.NaN)).toBe('₡0')
    expect(miles(3120)).toBe('3.120')
  })
  it('dólares con coma decimal', () => {
    expect(usd(1234.5)).toBe('$1.234,50')
    expect(usd(0.07)).toBe('$0,07')
  })
  it('porcentajes con espacio', () => {
    expect(pct(60)).toBe('60 %')
    expect(pct(17.7)).toBe('18 %')
    expect(pct(0.4)).toBe('0,4 %')
    expect(pct(-12.6)).toBe('−13 %')
  })
  it('fechas: «15 jun 26» en tablas y «15 de junio de 2026» en texto', () => {
    expect(fechaCorta('2026-06-15')).toBe('15 jun 26')
    expect(fechaCorta('2026-11-01T18:00:00Z')).toBe('1 nov 26')
    expect(fechaLarga('2026-06-15')).toBe('15 de junio de 2026')
    expect(fechaCorta('sin fecha')).toBe('sin fecha')
  })
  it('nombres en mayúsculas del sistema se muestran en minúscula normal', () => {
    expect(nombrePropio('MARÍA JOSÉ PRUEBA')).toBe('María José Prueba')
    expect(nombreFrase('ROLL DE EJEMPLO')).toBe('Roll de ejemplo')
  })
})

describe('variaciones (§5): ▲ musgo > 130 %, ▼ laca < 70 %, el resto gris sin flecha', () => {
  it('umbrales', () => {
    expect(tonoVariacion(131, 100)).toBe('sube')
    expect(tonoVariacion(130, 100)).toBe('igual')
    expect(tonoVariacion(70, 100)).toBe('igual')
    expect(tonoVariacion(69, 100)).toBe('baja')
    expect(tonoVariacion(50, 0)).toBeNull()
  })
  it('texto y color', () => {
    const sube = variacion(160, 100, 'vs. ₡100')
    expect(sube).toContain(`color:${COLOR.musgo}`)
    expect(sube).toContain('▲ +60 %')
    const baja = variacion(40, 100, 'vs. ₡100')
    expect(baja).toContain(`color:${COLOR.laca}`)
    expect(baja).toContain('▼ −60 %')
    const igual = variacion(112, 100, 'vs. ₡100')
    expect(igual).not.toMatch(/[▲▼]/)
    expect(igual).toContain('+12 %')
    expect(igual).not.toContain(COLOR.musgo)
    expect(variacion(10, 0, 'x')).toBe('')
  })
})

describe('tabla: máximo 10 filas, sin fondo, filete de oro', () => {
  it('corta en 10 y avisa cuántas quedaron afuera', () => {
    const filas = Array.from({ length: 12 }, (_, i) => [`fila ${i + 1}`, crc(i)])
    const t = tabla([{ titulo: 'nombre', ancho: 70 }, { titulo: 'monto', ancho: 30, derecha: true }], filas)
    expect((t.split('<colgroup>')[1].match(/<tr>/g) ?? []).length).toBe(MAX_FILAS + 1)
    expect(t).toContain('Se muestran 10 de 12.')
    expect(t).toContain(`border-bottom:1px solid ${COLOR.oro}`)
    expect(t).toContain('<colgroup>')
    expect(t).not.toContain('fila 11')
  })
})

describe('escape y documento', () => {
  it('escapa el texto que viene de la base', () => {
    expect(esc('<b>"x" & \'y\'</b>')).toBe('&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;')
    expect(cabecera('<script>', 'p')).not.toContain('<script>')
  })
  it('un documento mínimo pasa la verificación; uno con fondo de color o MAYÚSCULAS no', () => {
    const bien = documento('t', cabecera('Reporte', 'período') + cifras([{ valor: crc(1), etiqueta: 'x' }]) + pie('reporte', 'período'))
    verificarCorreo(bien, { pie: 'Satori, reporte, período' })
    expect(() => verificarCorreo(bien.replace('</body>', '<div style="background:#2a4a6b">x</div></body>'), { pie: 'Satori, reporte, período' })).toThrow()
    expect(() => verificarCorreo(bien.replace('</body>', '<div style="text-transform:uppercase">x</div></body>'), { pie: 'Satori, reporte, período' })).toThrow()
    expect(() => verificarCorreo(bien.replace('</body>', '<p>₡ 1.000</p></body>'), { pie: 'Satori, reporte, período' })).toThrow()
  })
})
