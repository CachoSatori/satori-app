// Ayuda de PRUEBAS (no la carga la app): escribe en un cuadro `<input type="number">` como lo haría el navegador.
//
// Por qué existe (hallazgo del 23-nov, verificador de propinas; R30): con texto que no es número («-», «--450»,
// «12abc») el navegador deja `value === ''` y marca `validity.badInput`. Con React 19, onChange solo se dispara si
// el valor LEÍDO cambia: un cuadro VACÍO al que se le escribe algo ilegible pasa de '' a '' y onChange NO corre.
// Lo que dependa solo de onChange no se entera (se guardaría 0) y, al borrar el texto ilegible, la marca puede quedar
// trabada. Esta ayuda manda UN solo evento `input` nativo (como una tecla real): React decide si corre onChange igual
// que en el navegador, y onInput corre siempre.
import { fireEvent } from '@testing-library/react'

// Número de punto flotante válido según HTML (lo que un cuadro type="number" acepta como value).
const FLOTANTE_VALIDO = /^-?(\d+(\.\d+)?|\.\d+)([eE][-+]?\d+)?$/

/** Deja el cuadro como quedaría después de teclear `texto` (cuadro entero) y dispara un único evento `input`. */
export function teclearNumero(input: HTMLElement, texto: string): void {
  const legible = texto === '' || FLOTANTE_VALIDO.test(texto)
  Object.defineProperty(input, 'validity', {
    configurable: true,
    get: () => ({ badInput: !legible, valid: legible }),
  })
  fireEvent.input(input, { target: { value: legible ? texto : '' } })
}
