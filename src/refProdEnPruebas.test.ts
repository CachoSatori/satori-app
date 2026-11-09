// (09-nov, regla del dueño tras el incidente de G-61) Ningún script de PRUEBA puede tener escrito el ref de prod: si
// un caso lo necesita, lo lee de una variable (SATORI_REF_PROD) que en las pruebas no existe. Así una regresión en el
// candado de una herramienta no puede llevar una prueba a prod.
// Esta prueba no tiene el ref: lo lee de una HERRAMIENTA (scripts/club/migrar_firestore.py, PROD_REF), donde sí va como
// candado. «Archivo de prueba» = el nombre o la carpeta dice test, prueba(s), carrera(s), ensayo o spec.
import { test, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const RAIZ = new URL('..', import.meta.url).pathname
const FUERA = new Set(['.git', 'node_modules', 'dist', 'coverage', '.claude'])
const ES_PRUEBA = /(test|prueba|carrera|ensayo|spec)/i
const BINARIOS = /\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|zip|gz)$/i

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    if (FUERA.has(n)) return []
    const p = join(dir, n)
    return statSync(p).isDirectory() ? archivos(p) : [p]
  })
}

const REF_PROD = /PROD_REF = '([a-z]{20})'/.exec(readFileSync(join(RAIZ, 'scripts/club/migrar_firestore.py'), 'utf8'))?.[1]

test('el ref de prod se puede leer de la herramienta (si no, esta prueba no prueba nada)', () => {
  expect(REF_PROD).toMatch(/^[a-z]{20}$/)
})

test('ningún archivo de prueba tiene escrito el ref de prod', () => {
  const con = archivos(RAIZ)
    .filter(p => ES_PRUEBA.test(relative(RAIZ, p)) && !p.endsWith('.md') && !BINARIOS.test(p) && statSync(p).size < 5_000_000)
    .filter(p => REF_PROD !== undefined && readFileSync(p, 'utf8').includes(REF_PROD))
    .map(p => relative(RAIZ, p))
  expect(con).toEqual([])
})
