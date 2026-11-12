// (12-nov, auditoría) Los atajos del ícono de la app (manifest → shortcuts, en vite.config.ts) tienen que
// llevar a una ruta que exista en ESTA rama. «Registrar proveedor» (/proveedor) y «Comandero» (/comandero)
// estuvieron meses en el manifest de producción sin ruta en `main`: el atajo abría el Inicio.
import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const RAIZ = new URL('..', import.meta.url).pathname
const config = readFileSync(`${RAIZ}vite.config.ts`, 'utf8')
const app = readFileSync(`${RAIZ}src/App.tsx`, 'utf8')

const bloque = /shortcuts:\s*\[([\s\S]*?)\n\s*\],/.exec(config)?.[1] ?? ''
const atajos = [...bloque.matchAll(/url:\s*`\$\{BASE\}([^`]*)`/g)].map(m => `/${m[1]}`)

// Rutas con pantalla propia: las que solo redirigen (<Navigate …>) no cuentan.
const rutas = [...app.matchAll(/<Route\s+path="([^"]+)"\s+element=\{<(?!Navigate)/g)].map(m => m[1])

test('el manifest tiene atajos y App.tsx tiene rutas (si no, esta prueba no prueba nada)', () => {
  expect(atajos.length).toBeGreaterThan(0)
  expect(rutas).toContain('/caja')
})

test('cada atajo del ícono lleva a una ruta con pantalla', () => {
  expect(atajos.filter(a => !rutas.includes(a))).toEqual([])
})
