// Solo para pruebas. happy-dom no imita un <input type="number"> de Chrome o Safari: si se escribe «-450» detrás
// del «0» que trae el cuadro, borra el texto que no es número; el navegador real lo DEJA a la vista («0-450»),
// devuelve `value === ""` (igual que vacío) y marca `validity.badInput`. Ese es el camino de la validación física
// del dueño (23-nov) que las pruebas con `fireEvent.change` no veían. Esto lo imita sobre el prototipo:
//   - el texto que se tipea queda guardado tal cual (lo que se ve: `textoVisible`);
//   - `value` devuelve ese texto si es un número válido y "" si no;
//   - `validity.badInput` es true cuando hay texto y no es número.
// Verificado en Chrome headless (23-nov): «0-450» → value "" y badInput true; «-450» → value "-450".

const NUMERO_VALIDO = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?$/
const textos = new WeakMap<HTMLInputElement, string>()

const esNumero = (el: HTMLInputElement) => el.type === 'number'
const leible = (t: string) => t === '' || NUMERO_VALIDO.test(t)

/** Lo que la persona ve en el cuadro (no lo que lee el código). */
export function textoVisible(el: HTMLInputElement): string {
  return textos.get(el) ?? el.value
}

/** Instala la imitación; devuelve la función que la saca. Llamar ANTES de render (user-event copia el descriptor). */
export function imitarInputNumeroDeChrome(): () => void {
  const proto = window.HTMLInputElement.prototype
  const valor = Object.getOwnPropertyDescriptor(proto, 'value')!
  const validez = Object.getOwnPropertyDescriptor(proto, 'validity')!
  Object.defineProperty(proto, 'value', {
    configurable: true,
    enumerable: valor.enumerable,
    get(this: HTMLInputElement) {
      if (!esNumero(this) || !textos.has(this)) return valor.get!.call(this)
      const t = textos.get(this)!
      return leible(t) ? t : ''
    },
    set(this: HTMLInputElement, v: unknown) {
      if (esNumero(this)) textos.set(this, String(v))
      valor.set!.call(this, esNumero(this) && !leible(String(v)) ? '' : v)
    },
  })
  Object.defineProperty(proto, 'validity', {
    configurable: true,
    enumerable: validez.enumerable,
    get(this: HTMLInputElement) {
      const base = validez.get!.call(this) as ValidityState
      if (!esNumero(this)) return base
      const malo = !leible(textos.get(this) ?? '')
      return new Proxy(base, {
        get: (o, k) => (k === 'badInput' ? malo : k === 'valid' ? !malo && o.valid : Reflect.get(o, k)),
      })
    },
  })
  return () => {
    Object.defineProperty(proto, 'value', valor)
    Object.defineProperty(proto, 'validity', validez)
  }
}
