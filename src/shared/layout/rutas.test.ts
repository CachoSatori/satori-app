// Pase del rediseño a producción (auditoría 195): cada módulo del menú y de la grilla del Inicio
// tiene que tener su <Route> en App.tsx. Si no, el menú llevaría a una pantalla que no existe.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { MODULES } from './modulos'

const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8')

describe('modulos.ts · rutas', () => {
  it.each(MODULES.map(m => [m.id, m.path]))('%s (%s) tiene ruta en App.tsx', (_id, path) => {
    expect(app).toContain(`path="${path}"`)
  })
})
