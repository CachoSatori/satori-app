// D15 = A (dueño, 13-nov-2026): la Edge Function extract-document no puede tener datos reales en el repo público
// (cédula jurídica, razón social, nombres de proveedores o de personas). La identidad del cliente sale de los secretos
// NEGOCIO_NOMBRE / NEGOCIO_RAZON_SOCIAL / NEGOCIO_CEDULA; los ejemplos del prompt son genéricos.
//
// Los nombres vigilados NO están escritos acá: solo su sha256 (minúsculas, sin tildes, palabras separadas por un
// espacio). La prueba parte cada archivo en palabras y compara el hash de cada secuencia de 1 a 4 palabras.
import { test, expect, describe } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { armarPrompt, leerNegocio } from './functions/extract-document/prompt.ts'

const DIR = new URL('./functions/extract-document/', import.meta.url).pathname

const VIGILADOS = new Set([
  'c6146d4b4679327a329830f763bbb1837ba94fb9a56e01b78a68b62c07f79f97',
  'c6d03b3bd28354693f9686733c001328026f77be4eee0fd38f8294fdc7e410c8',
  '5cbbeb6b5bc2d93b521970e8ee7346dd08903a8c08c48bd9833d1f47741d1965',
  'aa189adfd4cdf8527f379f079a8f2910673fc03c6b2ea03a9a076f8a31376d32',
  'dac0f1ae31b18d0c1fae7123c100d1149741a0498796d10db31d3a451c7c3423',
  '2ccdf2c9f0ff5cf9fe954e9b44771f7e099289792cff3da3dd624800db9cdeb1',
  '223e110fe8e7c02e402e27b2530bb27f85a98d62648b582b30c06ac20261f4a2',
  '9453114add302716d1667b617151f1cedde3cb145943c55c6e732692deff7116',
  '72985bf4f2c684c251f0c882f60e615f84d9e0252fd6ed42b26835e715d5bd2d',
  '6bc22da5057fc94e4fa6b25fa7e92cab76dfc29bf24bafac22ed27ea52e3d435',
])

// Cédula jurídica CR: 3-1XX-XXXXXX (con guiones) o 31XXXXXXXX (10 dígitos seguidos).
const CEDULA_JURIDICA = /(?<!\d)3-1\d\d-\d{6}(?!\d)|(?<!\d)31\d{8}(?!\d)/

const sha = (s: string) => createHash('sha256').update(s).digest('hex')

function palabras(texto: string): string[] {
  return texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]+/g) ?? []
}

/** Cantidad de secuencias de 1 a 4 palabras del texto cuyo hash está en `vigilados`. */
function coincidencias(texto: string, vigilados: Set<string>): number {
  const p = palabras(texto)
  let n = 0
  for (let i = 0; i < p.length; i++) {
    for (let k = 1; k <= 4 && i + k <= p.length; k++) {
      if (vigilados.has(sha(p.slice(i, i + k).join(' ')))) n++
    }
  }
  return n
}

const archivos = existsSync(DIR) ? readdirSync(DIR).filter(n => n.endsWith('.ts')) : []

describe('extract-document sin datos reales (D15)', () => {
  test('la carpeta de la función existe y tiene index.ts y prompt.ts (si no, esta prueba no prueba nada)', () => {
    expect(archivos).toEqual(expect.arrayContaining(['index.ts', 'prompt.ts']))
  })

  test('el detector muerde: encuentra un nombre ficticio por hash y una cédula ficticia en los dos formatos', () => {
    const ficticio = new Set([sha('frutas del bosque')])
    expect(coincidencias('Proveedor: FRUTAS DEL BOSQUE S.A.', ficticio)).toBe(1)
    expect(coincidencias('Proveedor: Frutas del Valle', ficticio)).toBe(0)
    expect(CEDULA_JURIDICA.test('cédula 3-101-000000')).toBe(true)
    expect(CEDULA_JURIDICA.test('ced 3101000000')).toBe(true)
    expect(CEDULA_JURIDICA.test('total 13101000000')).toBe(false)
  })

  for (const nombre of archivos) {
    test(`${nombre}: sin cédula jurídica ni nombres vigilados`, () => {
      const texto = readFileSync(join(DIR, nombre), 'utf8')
      expect(CEDULA_JURIDICA.exec(texto)?.[0] ?? null).toBeNull()
      expect(coincidencias(texto, VIGILADOS)).toBe(0)
    })
  }

  test('con los 3 secretos, el prompt los usa', () => {
    const { negocio, faltantes } = leerNegocio(k => ({
      NEGOCIO_NOMBRE: 'Restaurante Ficticio',
      NEGOCIO_RAZON_SOCIAL: 'Ficticia Sociedad Anónima',
      NEGOCIO_CEDULA: '3-101-000000',
    } as Record<string, string>)[k])
    expect(faltantes).toEqual([])
    const p = armarPrompt(negocio)
    expect(p).toContain('Restaurante Ficticio, razón social Ficticia Sociedad Anónima, cédula 3-101-000000')
    expect(p).toContain('NUNCA pongas al cliente (Restaurante Ficticio) como proveedor')
    expect(p).not.toContain('el restaurante cliente')
  })

  test('sin secretos (o en blanco), el prompt usa el texto genérico y avisa cuáles faltan', () => {
    const { negocio, faltantes } = leerNegocio(k => (k === 'NEGOCIO_CEDULA' ? '   ' : undefined))
    expect(faltantes).toEqual(['NEGOCIO_NOMBRE', 'NEGOCIO_RAZON_SOCIAL', 'NEGOCIO_CEDULA'])
    const p = armarPrompt(negocio)
    expect(p).toContain('restaurante en Costa Rica (el restaurante cliente)')
    expect(p).not.toMatch(/undefined|\(null|cédula null|social null|cédula ,/)
  })

  test('las reglas de extracción siguen en el prompt (solo cambiaron los nombres)', () => {
    const p = armarPrompt({ nombre: null, razonSocial: null, cedula: null })
    for (const regla of [
      'DÍA/MES/AÑO', '"9/11/2026" = 9 de noviembre de 2026 → "2026-11-09"', 'dígitos 4 a 9', '50 dígitos',
      'alimentos básicos llevan 1% y el resto 13%', 'Ítems en dos líneas', 'PROFORMA', 'comprobante_pago',
      'propinas', 'NO el banco', 'plazo_dias', '164035.53', 'confianza baja (≤0.5)', 'cuenta_qb_sugerida',
      'Devolvé únicamente el JSON.',
    ]) expect(p).toContain(regla)
  })
})
