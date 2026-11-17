// @vitest-environment happy-dom
//
// La franja «no se pudo leer el PoS»: se ve en cualquier estado que no sea 'ok'. Desde el 16-nov
// (todo del PoS) ya no menciona el Excel: no hay respaldo, la pantalla queda sin ventas.
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
import AvisoFuentePos from './AvisoFuentePos'

describe('AvisoFuentePos', () => {
  it.each([
    ['sin_acceso', 'Tu usuario no puede ver las ventas del PoS.'],
    ['vacio', 'El PoS no tiene ventas en este período.'],
    ['error', 'No se pudieron leer las ventas del PoS. Probá recargar en un rato.'],
  ] as const)("'%s' → muestra la franja", (estado, texto) => {
    const { getByRole } = render(<AvisoFuentePos estado={estado} />)
    const franja = getByRole('status')
    expect(franja.textContent).toBe(texto)
    expect(franja.getAttribute('data-estado-pos')).toBe(estado)
  })

  it.each([['ok'], [null], [undefined]] as const)('%s → no muestra nada', estado => {
    const { container } = render(<AvisoFuentePos estado={estado} />)
    expect(container.innerHTML).toBe('')
  })

  it('ningún texto menciona el Excel', () => {
    for (const e of ['sin_acceso', 'vacio', 'error'] as const) {
      const { getByRole, unmount } = render(<AvisoFuentePos estado={e} />)
      expect(getByRole('status').textContent ?? '').not.toMatch(/excel|xls/i)
      unmount()
    }
  })
})
