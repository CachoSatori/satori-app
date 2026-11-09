import { describe, expect, it } from 'vitest'
import { aliasCorreoEjemplo, MARCADOR_ALIAS } from './aliasCorreo'

describe('aliasCorreoEjemplo', () => {
  it('arma el alias +nombre a partir del correo configurado', () => {
    expect(aliasCorreoEjemplo('local@ejemplo.com')).toBe('local+nombre@ejemplo.com')
  })
  it('sin configuración o con valor inválido muestra el marcador', () => {
    for (const v of [undefined, null, '', '  ', 'sin-arroba', 'a@b', 'x+y@ejemplo.com']) {
      expect(aliasCorreoEjemplo(v)).toBe(MARCADOR_ALIAS)
    }
  })
})
