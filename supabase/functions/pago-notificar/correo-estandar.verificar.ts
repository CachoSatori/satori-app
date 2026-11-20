// Chequeos de estructura del estándar de reportes adaptado a correo (solo para pruebas; no se despliega:
// index.ts no lo importa). Copiado igual en cada función que manda correo, como correo-estandar.ts.
import { expect } from 'vitest'
import { COLOR, MAX_FILAS } from './correo-estandar.ts'

const PALETA = new Set<string>(Object.values(COLOR).map((c) => c.toLowerCase()))

/** Falla si el HTML del correo se sale del estándar. Devuelve el texto visible (sin etiquetas). */
export function verificarCorreo(html: string, opciones: { pie: string }): string {
  // Documento de correo: doctype, ancho 640, fuentes por <link> con respaldo seguro, sin base64.
  expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
  expect(html).toContain('width="640"')
  expect(html).toMatch(/<link href="https:\/\/fonts\.googleapis\.com\/css2\?family=Cormorant\+Garamond[^"]*DM\+Sans[^"]*" rel="stylesheet">/)
  expect(html).toContain("Georgia, 'Times New Roman', serif")
  expect(html).toContain('Helvetica, Arial, sans-serif')
  expect(html).not.toMatch(/base64/)

  // Prohibidos del estándar: mayúsculas para etiquetas, monoespaciadas, sombras, esquinas de tarjeta, fondos de color.
  expect(html).not.toMatch(/text-transform\s*:\s*uppercase/i)
  expect(html).not.toMatch(/monospace|DM Mono/i)
  expect(html).not.toMatch(/box-shadow|border-radius/i)
  const fondos = [...html.matchAll(/background(?:-color)?\s*:\s*(#[0-9a-f]{3,6})/gi)].map((m) => m[1].toLowerCase())
  for (const f of fondos) expect([COLOR.papel, COLOR.oro, COLOR.barra]).toContain(f)
  // Todo color usado sale de la paleta.
  for (const m of html.matchAll(/#[0-9a-fA-F]{6}\b/g)) expect(PALETA.has(m[0].toLowerCase())).toBe(true)
  // Escala tipográfica: nada por debajo de 7,5 pt (10 px).
  for (const m of html.matchAll(/font-size\s*:\s*([\d.]+)px/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(10)
  // Negrita: solo 500/600 (nada de bold/700 para resaltar).
  expect(html).not.toMatch(/font-weight\s*:\s*(bold|700|800|900)/)

  // Tablas: máximo 10 filas de datos (+1 de encabezado) en cada tabla con <colgroup>.
  for (const t of html.split('<colgroup>').slice(1)) {
    const cuerpo = t.split('</table>')[0]
    const filas = (cuerpo.match(/<tr>/g) ?? []).length - 1
    expect(filas).toBeLessThanOrEqual(MAX_FILAS)
  }

  const texto = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')
  // Números del estándar: ₡ pegado, «60 %» con espacio, sin «.0%» de toFixed.
  expect(texto).not.toMatch(/₡\s/)
  expect(texto).not.toMatch(/\d%/)
  // Sin emojis ni el 里 de la cabecera vieja.
  expect(texto).not.toMatch(/[\u{1F300}-\u{1FAFF}☀-➿里]/u)
  // Privacidad: sin correos, teléfonos ni cédulas en el cuerpo.
  expect(texto).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i)
  expect(texto).not.toMatch(/\+?506[\s-]?\d{4}/)
  expect(texto).not.toMatch(/\b\d{8,}\b|\b\d-\d{4}-\d{4}\b/)
  // Pie del estándar.
  expect(texto).toContain(opciones.pie)
  return texto
}
