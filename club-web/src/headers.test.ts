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

// D 16-nov: widget de OpenTable en «Mi Club». La CSP abre SOLO https://www.opentable.com y SOLO para script y frame.
function csp(): Record<string, string[]> {
  const l = bloque('/*').split('\n').find(x => x.startsWith('Content-Security-Policy:')) ?? ''
  const out: Record<string, string[]> = {}
  for (const d of l.replace('Content-Security-Policy:', '').split(';').map(x => x.trim()).filter(Boolean)) {
    const [k, ...v] = d.split(/\s+/); out[k] = v
  }
  return out
}

test('CSP (#214): OpenTable SOLO en frame-src, host exacto; NUNCA en script-src ni en ningún otro', () => {
  const c = csp()
  expect(c['script-src']).toEqual(["'self'", 'https://challenges.cloudflare.com'])
  expect(c['frame-src']).toEqual(['https://challenges.cloudflare.com', 'https://www.opentable.com'])
  for (const [k, v] of Object.entries(c)) if (k !== 'frame-src') expect(v.join(' ')).not.toMatch(/opentable/i)
  expect(Object.values(c).flat().filter(v => /opentable/i.test(v))).toEqual(['https://www.opentable.com'])
})

test('CSP: connect-src sigue en self, sin comodines', () => {
  const c = csp()
  expect(c['connect-src']).toEqual(["'self'"])
  expect(c['default-src']).toEqual(["'self'"])
  expect(c['frame-ancestors']).toEqual(["'none'"])
  expect(Object.values(c).flat()).not.toContain('*')
  expect(Object.values(c).flat().some(v => v.includes('*'))).toBe(false)
})
