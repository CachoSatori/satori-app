// Ventas v2 · 3.1 — `product_map` queda CONGELADO (SPEC-3.1-catalogo §7.3): el catálogo nuevo es por código
// (`pos_productos`, mig 196). Esta lista cerrada son los archivos que todavía leen o escriben `product_map` (por nombre).
// Solo puede ACHICARSE: un archivo nuevo que vuelva a depender del catálogo por nombre hace caer la prueba, y uno que deja
// de usarlo también (hay que sacarlo de la lista, para que no vuelva a entrar callado).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const RAIZ = path.resolve(__dirname, '..')
const USA_PRODUCT_MAP = /\bgetProductMap\b|\bsaveProductMapItems\b|\bupdateProductInfo\b|from\(\s*['"]product_map['"]/

/** Los que hoy lo usan (24-nov). La 3.1b saca `VentasConfig.tsx`; la 3.6, el resto de Ventas. */
const PERMITIDOS = [
  'src/modules/inventario/InvRecetas.tsx',          // sincroniza el costo desde Recetas (D-6 = A)
  'src/modules/ventas/MiRendimientoWrap.tsx',
  'src/modules/ventas/VentasConfig.tsx',            // «Ajustes → Productos»: se retira en la 3.1b
  'src/modules/ventas/VentasModule.tsx',
  'src/modules/ventas/lineasPeriodo.ts',
  'src/shared/api/ventas.ts',                       // el lector y los dos escritores
  'supabase/functions/monthly-report/index.ts',
]

function archivos(dir: string): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(path.join(RAIZ, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) { if (e.name !== 'node_modules') out.push(...archivos(rel)) }
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(rel)
  }
  return out
}

describe('product_map congelado', () => {
  it('solo la lista cerrada lee o escribe product_map (y la lista no tiene sobrantes)', () => {
    const usan = [...archivos('src'), ...archivos('supabase/functions')]
      .filter(f => USA_PRODUCT_MAP.test(fs.readFileSync(path.join(RAIZ, f), 'utf8')))
      .sort()
    expect(usan).toEqual([...PERMITIDOS].sort())
  })
})
