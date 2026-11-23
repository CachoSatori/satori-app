// @vitest-environment happy-dom
//
// La premisa de R30, probada: con React 19, un cuadro type="number" VACÍO al que se le escribe algo ilegible
// («-», «--450») NO dispara onChange (el valor leído pasa de '' a ''); onInput sí. Si React cambia esto, esta prueba
// avisa y hay que revisar los cuadros de monto (validarMovimiento.ts, R28/R30).
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { teclearNumero } from './teclearNumero.testutil'

const Cuadro = ({ onChange, onInput }: { onChange: () => void; onInput: () => void }) => (
  <input type="number" aria-label="monto" defaultValue="" onChange={onChange} onInput={onInput} />
)

describe('teclearNumero — cómo ve React un cuadro type="number"', () => {
  it('vacío + «-»: onInput corre, onChange NO (el valor leído sigue siendo "")', () => {
    const onChange = vi.fn(); const onInput = vi.fn()
    render(<Cuadro onChange={onChange} onInput={onInput} />)
    const c = screen.getByLabelText('monto') as HTMLInputElement
    teclearNumero(c, '-')
    expect(onInput).toHaveBeenCalledTimes(1)
    expect(onChange).not.toHaveBeenCalled()
    expect(c.value).toBe('')
    expect(c.validity.badInput).toBe(true)
  })
  it('vacío + «--450» y después borrar: onChange nunca corre; onInput dos veces', () => {
    const onChange = vi.fn(); const onInput = vi.fn()
    render(<Cuadro onChange={onChange} onInput={onInput} />)
    const c = screen.getByLabelText('monto') as HTMLInputElement
    teclearNumero(c, '--450')
    teclearNumero(c, '')
    expect(onChange).not.toHaveBeenCalled()
    expect(onInput).toHaveBeenCalledTimes(2)
    expect(c.validity.badInput).toBe(false)
  })
  it('con número: onChange e onInput corren', () => {
    const onChange = vi.fn(); const onInput = vi.fn()
    render(<Cuadro onChange={onChange} onInput={onInput} />)
    const c = screen.getByLabelText('monto') as HTMLInputElement
    teclearNumero(c, '12500.50')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onInput).toHaveBeenCalledTimes(1)
    expect(c.value).toBe('12500.50')
  })
})
