// Grok 183 (10-nov): /b/* (la página de baja del turista, que trae la llave en la URL) va sin Referer y sin caché.
import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const H = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8')

function bloque(ruta: string): string {
  const i = H.split('\n').findIndex(l => l.trim() === ruta)
  if (i < 0) return ''
  const out: string[] = []
  for (const l of H.split('\n').slice(i + 1)) { if (!/^\s/.test(l)) break; out.push(l.trim()) }
  return out.join('\n')
}

test('/b/* lleva Referrer-Policy: no-referrer y Cache-Control: no-store', () => {
  expect(bloque('/b/*')).toContain('Referrer-Policy: no-referrer')
  expect(bloque('/b/*')).toContain('Cache-Control: no-store')
})

test('todo el sitio sigue con no-referrer', () => {
  expect(bloque('/*')).toContain('Referrer-Policy: no-referrer')
})
