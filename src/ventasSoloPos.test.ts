// 16-nov-2026 (decisión firmada del dueño): TODO lo que lee ventas lee del PoS. Nunca más el xls.
// Esta guarda recorre `src/` y falla si una pantalla vuelve a leer `ventas_dias` (la tabla del xls)
// o si `ventas_hist` se lee fuera de la API (que solo sirve lo anterior al corte del PoS).
// Fuera: pruebas y los tipos generados de la base.
import { test, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC = new URL('.', import.meta.url).pathname
const RAIZ = new URL('..', import.meta.url).pathname

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? archivos(p) : [p]
  })
}

const fuentes = archivos(SRC)
  .filter(p => /\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p) && !p.endsWith('supabase.gen.ts'))
  .map(p => ({ ruta: relative(RAIZ, p), texto: readFileSync(p, 'utf8') }))

test('ninguna pantalla lee `ventas_dias` (el xls): las ventas salen del PoS', () => {
  const lectores = fuentes.filter(f => /from\(\s*['"]ventas_dias['"]/.test(f.texto)).map(f => f.ruta)
  expect(lectores).toEqual([])
})

test('`ventas_hist` se lee solo desde la API (que la app recorta al corte del PoS)', () => {
  const lectores = fuentes.filter(f => /from\(\s*['"]ventas_hist['"]/.test(f.texto)).map(f => f.ruta)
  expect(lectores).toEqual(['src/shared/api/ventas.ts'])
})

test('no queda ni la carga del xls ni la pantalla Paridad', () => {
  const rutas = fuentes.map(f => f.ruta)
  for (const r of ['src/modules/ventas/VentasXLS.tsx', 'src/modules/ventas/VentasParidad.tsx',
                   'src/modules/ventas/VentasHistImport.tsx', 'src/modules/ventas/xlsParser.ts']) {
    expect(rutas).not.toContain(r)
  }
  expect(fuentes.filter(f => /\.upsert\(|\.insert\(|\.delete\(/.test(f.texto) && /ventas_(dias|hist)/.test(f.texto)
    && /from\(\s*['"]ventas_(dias|hist)['"]\s*\)\s*\.(upsert|insert|delete)/.test(f.texto)).map(f => f.ruta)).toEqual([])
})
