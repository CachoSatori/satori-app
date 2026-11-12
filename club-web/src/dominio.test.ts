// (08-nov noche) El dominio del Club sale de VITE_CLUB_URL: no puede estar escrito en club-web (código, textos, docs).
import { test, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { normalizarClubUrl } from './config'

const RAIZ = new URL('..', import.meta.url).pathname
function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n)
    if (['node_modules', 'dist'].includes(n)) return []
    return statSync(p).isDirectory() ? archivos(p) : [p]
  })
}

test('ningún archivo de club-web tiene el dominio escrito', () => {
  const con = archivos(RAIZ).filter(p => /\.(ts|js|mjs|html|json|toml|css|md|txt)$/.test(p) && !p.endsWith('dominio.test.ts'))
    .filter(p => new RegExp(['satori', 'costarica'].join(''), 'i').test(readFileSync(p, 'utf8')))
  expect(con).toEqual([])
})

test('VITE_CLUB_URL: https sin barra final; mal formada o vacía → el origen donde corre', () => {
  expect(normalizarClubUrl('https://club.ejemplo.com/', 'https://otro.test')).toBe('https://club.ejemplo.com')
  expect(normalizarClubUrl(' https://club.ejemplo.com ', '')).toBe('https://club.ejemplo.com')
  expect(normalizarClubUrl('http://club.ejemplo.com', 'https://origen.test')).toBe('https://origen.test')
  expect(normalizarClubUrl('javascript:alert(1)', 'https://origen.test')).toBe('https://origen.test')
  expect(normalizarClubUrl(undefined, 'https://origen.test')).toBe('https://origen.test')
})

test('(09-nov) en producción, sin VITE_CLUB_URL o mal formada → error claro, nunca el origen', () => {
  for (const malo of [undefined, '', 'http://club.ejemplo.com', 'https://club.ejemplo.com/ruta', 'javascript:alert(1)']) {
    expect(() => normalizarClubUrl(malo, 'https://origen.test', true)).toThrow(/falta VITE_CLUB_URL/)
  }
  expect(normalizarClubUrl('https://club.ejemplo.com/', 'https://origen.test', true)).toBe('https://club.ejemplo.com')
})

test('(09-nov) el build de producción se frena sin VITE_CLUB_URL (vite.config.ts usa la misma validación)', () => {
  const cfg = readFileSync(join(RAIZ, 'vite.config.ts'), 'utf8')
  expect(cfg).toMatch(/command === 'build' && mode === 'production'/)
  expect(cfg).toMatch(/if \(!clubUrlValida\(env\.VITE_CLUB_URL\)\) throw new Error\(ERROR_SIN_CLUB_URL\)/)
})
