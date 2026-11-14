// B10 (mig 165): textos de «Cambios» (Admin → Usuarios).
import { describe, it, expect } from 'vitest'
import { describirCambio, fechaHoraCR, ordenarCambios, quienCambio } from './bitacoraPermisos'

describe('bitácora de permisos: textos', () => {
  it('fecha y hora de Costa Rica, también de noche (05:30 UTC = 23:30 CR del día anterior)', () => {
    expect(fechaHoraCR('2026-11-15T05:30:00Z')).toBe('14-nov-2026 23:30')
    expect(fechaHoraCR('2026-11-14T15:05:00+00:00')).toBe('14-nov-2026 09:05')
    expect(fechaHoraCR('no-es-fecha')).toBe('—')
  })

  it('de qué a qué, con las etiquetas de la app', () => {
    expect(describirCambio({ campo: 'rol', antes: 'salonero', despues: 'cajero' })).toBe('Rol: Salonero → Cajero')
    expect(describirCambio({ campo: 'rol', antes: 'manager', despues: 'owner' })).toBe('Rol: Encargado → Propietario')
    expect(describirCambio({ campo: 'activo', antes: 'true', despues: 'false' })).toBe('Cuenta: habilitada → deshabilitada')
    expect(describirCambio({ campo: 'local', antes: null, despues: 'santa-teresa' })).toBe('Local: — → santa-teresa')
  })

  it('quién: nombre, sistema o usuario borrado', () => {
    const nombres = new Map([['u1', 'Dueña Ficticia']])
    expect(quienCambio({ cambiado_por: 'u1', origen: 'sesion' }, nombres)).toBe('Dueña Ficticia')
    expect(quienCambio({ cambiado_por: null, origen: 'sistema' }, nombres)).toBe('Sistema')
    expect(quienCambio({ cambiado_por: null, origen: 'service_role' }, nombres)).toBe('Sistema (servicio)')
    expect(quienCambio({ cambiado_por: 'zz', origen: 'sesion' }, nombres)).toBe('usuario borrado')
  })

  it('más reciente primero; empate de hora, el id más alto primero', () => {
    const xs = [
      { id: 1, cambiado_en: '2026-11-14T10:00:00Z' },
      { id: 3, cambiado_en: '2026-11-14T12:00:00Z' },
      { id: 2, cambiado_en: '2026-11-14T12:00:00Z' },
    ]
    expect(ordenarCambios(xs).map(x => x.id)).toEqual([3, 2, 1])
  })
})
