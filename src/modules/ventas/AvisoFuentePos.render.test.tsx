// @vitest-environment happy-dom
//
// La franja «no se pudo leer el PoS» (firma de Ismael, 2026-10-30): se ve en cualquier estado
// que no sea 'ok', con el último día del Excel, y en 'ok' / 'xls' no aparece.
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
import AvisoFuentePos from './AvisoFuentePos'

const TEXTO = 'Mostrando solo el Excel (último día: 20/10). No se pudo leer el PoS.'

describe('AvisoFuentePos', () => {
  it.each(['sin_acceso', 'vacio', 'error'] as const)("'%s' → muestra la franja con el último día", estado => {
    const { getByRole } = render(<AvisoFuentePos estado={estado} ultimoDiaXls="2026-10-20" />)
    const franja = getByRole('status')
    expect(franja.textContent).toBe(TEXTO)
    expect(franja.getAttribute('data-estado-pos')).toBe(estado)
  })

  it.each([['ok'], [null], [undefined]] as const)('%s → no muestra nada', estado => {
    const { container } = render(<AvisoFuentePos estado={estado} ultimoDiaXls="2026-10-20" />)
    expect(container.innerHTML).toBe('')
  })

  it('sin días del Excel → «último día: —»', () => {
    const { getByRole } = render(<AvisoFuentePos estado="sin_acceso" ultimoDiaXls={null} />)
    expect(getByRole('status').textContent).toBe('Mostrando solo el Excel (último día: —). No se pudo leer el PoS.')
  })
})
