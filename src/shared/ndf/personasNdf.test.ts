// El mapa de códigos: que clasifique por la TABLA y no por la forma del código, que unifique
// las dos personas con dos logins, y —lo más importante— que no se le pierda la plata de nadie.
import { describe, it, expect } from 'vitest'

import {
  SIN_CODIGO, clasificarCodigo, esMesero, nombreDePersona, personasConocidas, rolDeCodigo,
} from './personasNdf'

describe('clasificarCodigo — la tabla manda, no la forma del código', () => {
  it('`01` es ROSAURA, una salonera — NO "sistema"', () => {
    // El supuesto viejo del esquema decía que `01`/`02` eran logins de sistema. Con eso, las
    // ventas de Rosaura se tiraban a la basura. Esta es la aserción de ese bug.
    const p = clasificarCodigo('01')
    expect(p.rol).toBe('mesero')
    expect(p.etiqueta).toBe('Rosaura')
  })

  it('`266` y `333` son meseros reales (Nacho y Emma), no ruido', () => {
    expect(rolDeCodigo('266')).toBe('mesero')
    expect(rolDeCodigo('333')).toBe('mesero')
  })

  it('`02` es el login compartido: genérico, fuera del ranking', () => {
    expect(rolDeCodigo('02')).toBe('generico')
    expect(esMesero('02')).toBe(false)
  })

  it('`111`, `222` y `388` son caja: cobran, no comandan', () => {
    expect(['111', '222', '388'].map(rolDeCodigo)).toEqual(['caja', 'caja', 'caja'])
  })

  it('dos códigos con la misma forma pueden tener roles distintos', () => {
    // `03` mesero (Alan) vs `02` genérico: dos dígitos los dos. No hay regla, hay tabla.
    expect(rolDeCodigo('03')).toBe('mesero')
    expect(rolDeCodigo('02')).toBe('generico')
  })
})

describe('unificación de personas — un código no es una persona', () => {
  it('ROSAURA = `01` + `235`: la misma persona, una sola fila', () => {
    const a = clasificarCodigo('01')
    const b = clasificarCodigo('235')   // su login de manager "M"
    expect(a.id).toBe(b.id)
    expect(a.id).toBe('01')             // el canónico es el de salonera
    expect(a.codigos).toEqual(['01', '235'])
  })

  it('ESTEBAN = `023` + `555`: el activo manda como canónico', () => {
    const a = clasificarCodigo('023')
    const b = clasificarCodigo('555')   // el viejo, inactivo
    expect(a.id).toBe(b.id)
    expect(a.id).toBe('023')
  })

  it('el resto son uno a uno', () => {
    const unificados = personasConocidas().filter(p => p.codigos.length > 1)
    expect(unificados.map(p => p.id).sort()).toEqual(['01', '023'])
  })

  it('ningún código está en dos personas', () => {
    const todos = personasConocidas().flatMap(p => [...p.codigos])
    expect(todos).toHaveLength(new Set(todos).size)
  })
})

describe('no se tira la plata de nadie', () => {
  it('una línea sin código cae en el balde "otro", no se descarta', () => {
    // Son 10 líneas en todo el histórico (₡40k), pero tienen que estar.
    for (const vacio of [null, undefined, '', '   ']) {
      const p = clasificarCodigo(vacio)
      expect(p.rol).toBe('otro')
      expect(p.id).toBe(SIN_CODIGO)
    }
  })

  it('un código que la tabla NO conoce va a "otro" con su código a la vista', () => {
    // Un mesero nuevo aparece acá con plata: esa es la señal de agregarlo a la tabla. Lo que NO
    // se hace es adivinar que es mesero — adivinar es el error que `01` ya nos costó.
    const p = clasificarCodigo('777')
    expect(p.rol).toBe('otro')
    expect(p.id).toBe('777')
    expect(p.etiqueta).toBe('777')
    expect(esMesero('777')).toBe(false)
  })

  it('el mismo código desconocido devuelve la MISMA persona (agrupa, no se dispersa)', () => {
    expect(clasificarCodigo('777').id).toBe(clasificarCodigo('777').id)
    expect(clasificarCodigo('777')).toBe(clasificarCodigo('777'))
  })

  it('los cuatro baldes cubren todo: nunca hay un rol fuera de la lista', () => {
    const roles = new Set(['mesero', 'caja', 'generico', 'otro'])
    const codigos = [...personasConocidas().flatMap(p => [...p.codigos]), '777', '', null]
    for (const c of codigos) expect(roles.has(rolDeCodigo(c))).toBe(true)
  })

  it('recorta espacios antes de buscar', () => {
    expect(clasificarCodigo('  032  ').etiqueta).toBe('Gonza')
  })
})

describe('nombreDePersona — manda `employees`, la etiqueta es respaldo', () => {
  const rosaura = clasificarCodigo('235')

  it('usa el nombre de la tabla del dueño', () => {
    expect(nombreDePersona(rosaura, { '01': 'Rosaura Jiménez' })).toBe('Rosaura Jiménez')
  })

  it('busca por el canónico PRIMERO: Rosaura no se llama como su login de manager', () => {
    const nombres = { '01': 'Rosaura Jiménez', '235': 'Manager' }
    expect(nombreDePersona(rosaura, nombres)).toBe('Rosaura Jiménez')
  })

  it('si el canónico no está en `employees`, cae al alias antes que a la etiqueta', () => {
    expect(nombreDePersona(rosaura, { '235': 'Rosaura M.' })).toBe('Rosaura M.')
  })

  it('sin fila en `employees`, la etiqueta curada — nunca un número pelado', () => {
    expect(nombreDePersona(rosaura, {})).toBe('Rosaura')
    expect(nombreDePersona(clasificarCodigo('777'), {})).toBe('777')
    expect(nombreDePersona(clasificarCodigo(null), {})).toBe('Sin código')
  })

  it('un `full_name` vacío no gana: se ignora y sigue buscando', () => {
    expect(nombreDePersona(rosaura, { '01': '   ', '235': 'Rosaura M.' })).toBe('Rosaura M.')
  })
})

describe('la tabla firmada 2026-09-07', () => {
  it('tiene los 19 meseros de la SPEC', () => {
    expect(personasConocidas().filter(p => p.rol === 'mesero')).toHaveLength(19)
  })

  it('marca a los inactivos que la SPEC anota con (I)', () => {
    const inactivos = personasConocidas().filter(p => p.inactivo).map(p => p.etiqueta)
    expect(inactivos.sort()).toEqual(['Jazmín', 'Wesley'])
  })

  it('los 21 códigos de mesero de la SPEC clasifican como mesero', () => {
    const codigos = [
      '0909', '333', '999', '266', '444', '026', '028', '03', '027', '025', '032', '029',
      '034', '024', '04', '030', '033', '01', '235', '023', '555',
    ]
    expect(codigos.filter(c => !esMesero(c))).toEqual([])
    expect(codigos).toHaveLength(21)
  })
})
