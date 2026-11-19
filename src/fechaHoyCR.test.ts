// (16-nov) «Hoy» es Costa Rica (UTC-6): `new Date().toISOString().slice(0, 10)` es la fecha UTC y desde las 18:00 CR ya
// es «mañana». Guarda: ningún archivo de src/ (fuera de pruebas) usa ese patrón, salvo los lugares listados abajo.
import { test, expect, vi, afterEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const SRC = new URL('.', import.meta.url).pathname
const PATRON = /new Date\(\)\.toISOString\(\)\.(?:slice\(0, ?10\)|split\('T'\)\[0\]|substring\(0, ?10\))/g
// Lugares permitidos (con motivo). Un lugar nuevo hace caer la prueba.
const PERMITIDOS: Record<string, number> = {
  // carpeta del archivo en Storage (no la ve nadie ni se compara con fechas CR)
  'shared/api/documents.ts': 1,
  'shared/api/facturas.ts': 1,
}

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? archivos(p) : [p]
  })
}

test('ningún «hoy» con la fecha UTC del aparato en src/ fuera de los lugares permitidos', () => {
  const malos: string[] = []
  for (const p of archivos(SRC)) {
    const rel = relative(SRC, p).split(sep).join('/')
    if (!/\.(ts|tsx)$/.test(rel) || /\.test\.tsx?$/.test(rel)) continue
    const n = (readFileSync(p, 'utf8').match(PATRON) ?? []).length
    if (n > (PERMITIDOS[rel] ?? 0)) malos.push(`${rel}: ${n}`)
  }
  expect(malos).toEqual([])
})

const H = vi.hoisted(() => ({ filas: [] as unknown[] }))
vi.mock('./shared/api/supabase', () => ({
  supabase: { from: () => ({ insert: async (fila: unknown) => { H.filas.push(fila); return { error: null } } }) },
}))
afterEach(() => { vi.useRealTimers(); H.filas.length = 0 })

test('ajuste de stock a las 23:30 CR (05:30 UTC del día siguiente): reference_id = el día CR', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-17T05:30:00Z'))   // 16-nov 23:30 en Costa Rica
  const { setStockLevel } = await import('./shared/api/inventario')
  await setStockLevel('ing-ficticio', 5, 2, 'kg', 'Persona Ficticia')
  expect(H.filas).toHaveLength(1)
  expect((H.filas[0] as { reference_id: string }).reference_id).toBe('2026-11-16')
})
