// D4 (14-nov, el dueño) · Autoalta en /alta: el socio puede validar su alta en caja HOY MISMO (no recién «en su
// próxima visita»). Mientras no la valide, el beneficio no aplica. ES y EN dicen lo mismo.
import { test, expect } from 'vitest'
import { TEXTOS } from './i18n'

test('alta_listo (ES): puede validarla hoy mismo; hasta entonces no hay beneficio', () => {
  expect(TEXTOS.es.alta_listo).toBe('¡Listo! Muestre su portal en caja para validar su alta; puede ser hoy mismo. Hasta entonces el beneficio no aplica.')
  expect(TEXTOS.es.alta_listo).not.toMatch(/próxima visita/i)
})

test('alta_listo (EN): el mismo mensaje', () => {
  expect(TEXTOS.en.alta_listo).toMatch(/it can be today/)
  expect(TEXTOS.en.alta_listo).toMatch(/Until then the benefit does not apply\.$/)
  expect(TEXTOS.en.alta_listo).not.toMatch(/next visit/i)
})
