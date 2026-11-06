import { describe, it, expect } from 'vitest'
import { renderContent, resumenTarjeta } from './sopsRender'

const SOP_44 = `# SOP 4.4 — Inventario de bebidas

## Ficha franquicia

**Objetivo:** Conteos de bebidas precisos y a tiempo, para controlar costos, mermas y compras.

**Código:** SOP 4.4

**Área:** Administración y caja
`

const DOC_32 = `# 3.2 — Platos

## Platos

Seis platos principales: dos con pescado crudo (ceviche y poke), dos bowls calientes, ramen y tonkatsu.
`

describe('resumenTarjeta', () => {
  it('usa solo el objetivo, sin Código ni Área', () => {
    const r = resumenTarjeta(SOP_44)
    expect(r).toBe('Conteos de bebidas precisos y a tiempo, para controlar costos, mermas y compras.')
    expect(r).not.toMatch(/Código|Área/)
  })
  it('sin objetivo, usa el primer párrafo', () => {
    expect(resumenTarjeta(DOC_32)).toMatch(/^Seis platos principales/)
  })
  it('sin objetivo y con ficha, salta las líneas de ficha', () => {
    expect(resumenTarjeta('# X\n\n**Código:** SOP 9.9\n\n**Área:** Equipo\n\nTexto real.')).toBe('Texto real.')
  })
  it('recorta en palabra y agrega …', () => {
    const r = resumenTarjeta(`**Objetivo:** ${'palabra '.repeat(40)}`, 30)
    expect(r.endsWith('…')).toBe(true)
    expect(r.length).toBeLessThanOrEqual(31)
  })
})

describe('renderContent', () => {
  it('omite el H1 y respeta el número de inicio de los pasos', () => {
    const html = renderContent('# T\n\n### 3. Efectivo\n\n9.  Registra lo recibido\n10. En dólares')
    expect(html).not.toContain('>T<')
    expect(html).toContain('<li data-n="9">Registra lo recibido</li>')
    expect(html).toContain('<li data-n="10">En dólares</li>')
    expect(html).toContain('<div class="sop-h3">3. Efectivo</div>')
  })
  it('tablas envueltas para scroll horizontal', () => {
    const html = renderContent('| A | B |\n|---|---|\n| 1 | 2 |')
    expect(html).toContain('<div class="sop-table-wrap"><table class="sop-table">')
    expect(html).toContain('<th>A</th>')
  })
  it('notas de advertencia en laca, las demás normales', () => {
    expect(renderContent('> Nunca cobres dos veces.')).toContain('sop-note sop-note-alerta')
    expect(renderContent('> Resultado: cobro ordenado.')).toContain('<div class="sop-note">')
  })
  it('separador --- y escape de cualquier signo (\\$)', () => {
    const html = renderContent('Antes\n\n---\n\nEn «\\$ Total»')
    expect(html).toContain('<hr class="sop-hr">')
    expect(html).not.toContain('<p class="sop-p">---</p>')
    expect(html).toContain('&#36; Total')
  })
  it('escapes y HTML', () => {
    const html = renderContent('Soy \\[Nombre\\] <script>')
    expect(html).toContain('&#91;Nombre&#93;')
    expect(html).not.toContain('<script>')
  })
})
