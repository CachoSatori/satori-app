import { describe, it, expect } from 'vitest'
import { quitarFrontMatter, leerFrontMatter, buscarSensibles, armarFila, armarSql, lit, categoriaCompat, compararCodigos, type EntradaIndice, type Mapeo } from './lib.ts'

const MD = `---
codigo: "2.5"
titulo: "Cobro de mesa"
---

# SOP 2.5 — Cobro de mesa

## Ficha franquicia

| A | B |
|---|---|
| 1 | 2 |
`

const E: EntradaIndice = {
  codigo: '2.5', titulo: 'Cobro de mesa', tipo: 'SOP', area: '2. Salón y recepción', orden: 50,
  version: '2026-11', libro_empleado: true, markdown: 'sops/2.5.md', pdf: 'x.pdf',
}

describe('front matter', () => {
  it('lo quita y deja el markdown desde el título', () => {
    const out = quitarFrontMatter(MD)
    expect(out.startsWith('# SOP 2.5 — Cobro de mesa')).toBe(true)
    expect(out).not.toContain('codigo:')
  })
  it('sin front matter devuelve el texto igual', () => {
    expect(quitarFrontMatter('# Hola\n')).toBe('# Hola\n')
  })
  it('lee las claves', () => {
    expect(leerFrontMatter(MD)).toEqual({ codigo: '2.5', titulo: 'Cobro de mesa' })
  })
})

describe('datos sensibles', () => {
  it('detecta correo, teléfono, cédulas y contraseñas', () => {
    const t = [
      'Escribí a alguien@gmail.com',
      'SINPE al 8774 2257',
      'WhatsApp +506 8774-2257',
      'Cédula Jurídica 3102864433',
      'cédula 1-1234-5678',
      'contraseña: Satori2026',
    ].join('\n')
    const tipos = buscarSensibles(t).map(h => h.tipo)
    expect(tipos).toEqual(expect.arrayContaining(['correo', 'teléfono', 'cédula', 'contraseña']))
    expect(buscarSensibles(t).length).toBeGreaterThanOrEqual(6)
  })
  it('no marca montos, años, horas ni menciones genéricas', () => {
    const t = [
      'Perfect Check ₡25.000 y cajas de ₡50.000–80.000',
      'Temporada 2025-2026, versión 2026-11',
      'Apertura a las 16:00; mesa 12; 15 % de descuento',
      'Accede con el usuario y la contraseña guardados.',
      'Formato 107500.98 / 15000',
    ].join('\n')
    expect(buscarSensibles(t)).toEqual([])
  })
})

describe('armarFila', () => {
  it('mapea el índice a columnas y quita el front matter', () => {
    const f = armarFila(E, MD)
    expect(f).toMatchObject({ code: '2.5', area: '2. Salón y recepción', doc_type: 'SOP', display_order: 50, category: 'Servicio', employee_book: true })
    expect(f.content).not.toContain('---\ncodigo')
  })
  it('falla si el front matter no coincide con el índice', () => {
    expect(() => armarFila({ ...E, codigo: '2.6' }, MD)).toThrow(/2\.5/)
  })
  it('falla con un área desconocida', () => {
    expect(() => armarFila({ ...E, area: '9. Otra' }, MD)).toThrow(/área/)
  })
})

describe('categoriaCompat', () => {
  it('mantiene categorías existentes', () => {
    expect(categoriaCompat('1.1', '1. Cultura y servicio')).toBe('Servicio')
    expect(categoriaCompat('2.9', '2. Salón y recepción')).toBe('Delivery')
    expect(categoriaCompat('3.6', '3. Menú y producto')).toBe('Barra')
    expect(categoriaCompat('3.2', '3. Menú y producto')).toBe('General')
    expect(categoriaCompat('4.1', '4. Administración y caja')).toBe('General')
  })
})

describe('SQL', () => {
  it('escapa comillas simples', () => {
    expect(lit("O'Brien")).toBe("'O''Brien'")
    expect(lit(null)).toBe('null')
    expect(lit(true)).toBe('true')
  })
  const mapeo: Mapeo = {
    reemplazadas: { '703ea077-80d8-4af6-9a2c-6c84906d7943': { titulo: 'Cobro', codigo: '2.5' } },
    solo_app: { 'fd0a7ba8-4cd4-4613-a322-168bd67f3546': { titulo: 'Montaje', area: '2. Salón y recepción' } },
  }
  it('arma upsert por code, desactiva sin borrar y no tiene delete', () => {
    const sql = armarSql([armarFila(E, MD)], mapeo)
    expect(sql).toContain('on conflict (code) where code is not null do update')
    expect(sql).toContain('set is_active = false')
    expect(sql.toLowerCase()).not.toMatch(/\bdelete\b|\btruncate\b|\bdrop table\b/)
  })
  it('rechaza un mapeo que apunta a un código que no está', () => {
    expect(() => armarSql([armarFila(E, MD)], { ...mapeo, reemplazadas: { '703ea077-80d8-4af6-9a2c-6c84906d7943': { titulo: 'x', codigo: '9.9' } } })).toThrow(/9\.9/)
  })
  it('rechaza ids que no son uuid', () => {
    expect(() => armarSql([armarFila(E, MD)], { ...mapeo, solo_app: { "x'; drop": { titulo: 'x', area: '2. Salón y recepción' } } })).toThrow(/id inválido/)
  })
})

describe('compararCodigos', () => {
  it('orden natural', () => {
    expect(['2.10', '1.2', '2.9', '10.1', '2.1'].sort(compararCodigos)).toEqual(['1.2', '2.1', '2.9', '2.10', '10.1'])
  })
})
