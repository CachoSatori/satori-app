// @vitest-environment happy-dom
// Piezas del estándar (SPEC-caja-estandar §3) y su hoja acotada a `.est` (§2). Datos ficticios.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { Cifra, Cifras, Aviso, Pildora, Fases, Boton } from './estandar'
import * as iconos from './iconos'

afterEach(cleanup)
// Separa selectores por las comas de primer nivel (las de :is(...) no cuentan).
const porComa = (r: string) => { const out: string[] = []; let d = 0, cur = ''
  for (const c of r) { if (c === '(') d++; if (c === ')') d--; if (c === ',' && d === 0) { out.push(cur.trim()); cur = '' } else cur += c }
  return [...out, cur.trim()] }
const leer = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')

describe('Cifra', () => {
  it('etiqueta, valor y nota; la principal lleva su clase y el tono va al valor', () => {
    const { container } = render(<Cifras><Cifra principal etiqueta="Disponible" valor="₡40.000" nota="Fondo ₡50.000" tono="laca" /><Cifra etiqueta="Pagado" valor="₡10.000" /></Cifras>)
    const [p, s] = container.querySelectorAll('.est-cifra')
    expect(p.className).toContain('principal')
    expect(s.className).not.toContain('principal')
    expect(p.querySelector('.est-cifra-val')?.getAttribute('data-tono')).toBe('laca')
    expect(screen.getByText('Fondo ₡50.000')).toBeTruthy()
    expect(s.querySelector('.est-cifra-nota')).toBeNull()
  })
})

describe('Aviso', () => {
  it('error es alerta; el resto, status; el título va en negrita', () => {
    render(<><Aviso tipo="error" titulo="Faltan ₡1.951.">Recontá antes de cerrar.</Aviso><Aviso tipo="hecho" titulo="Día cerrado." /></>)
    expect(screen.getByRole('alert').querySelector('strong')?.textContent).toBe('Faltan ₡1.951.')
    expect(screen.getByRole('alert').className).toContain('error')
    expect(screen.getByRole('status').className).toContain('hecho')
  })
})

describe('Pildora', () => {
  it('lleva la clase de su estado', () => {
    render(<Pildora estado="pendiente">Pendiente</Pildora>)
    expect(screen.getByText('Pendiente').className).toBe('est-pildora pendiente')
  })
})

describe('Fases', () => {
  it('hecho con tilde (svg), los otros con su número; la actual marcada como paso actual', () => {
    const { container } = render(<Fases pasos={[
      { titulo: 'Mediodía', estado: 'hecho', detalle: 'Sellado' },
      { titulo: 'Noche', estado: 'actual', detalle: 'En curso' },
    ]} />)
    const pasos = container.querySelectorAll('.est-paso')
    expect(pasos[0].querySelector('svg')).not.toBeNull()
    expect(pasos[1].textContent).toBe('2')
    expect(container.querySelector('[aria-current="step"]')?.textContent).toContain('Noche')
  })
})

describe('Boton', () => {
  it('por defecto type=button (no envía formularios) y secundario', () => {
    const fn = vi.fn()
    render(<form onSubmit={fn}><Boton>Volver</Boton></form>)
    const b = screen.getByRole('button', { name: 'Volver' })
    expect(b.getAttribute('type')).toBe('button')
    expect(b.className).toBe('est-btn secundario')
    fireEvent.click(b)
    expect(fn).not.toHaveBeenCalled()
  })
  it('peligro muestra qué borra; en otra variante el detalle no aparece', () => {
    render(<><Boton variante="peligro" detalle="Borra el cierre, no los movimientos">Deshacer cierre</Boton><Boton variante="primario" detalle="no va">Cerrar el día</Boton></>)
    expect(screen.getByText('Borra el cierre, no los movimientos')).toBeTruthy()
    expect(screen.queryByText('no va')).toBeNull()
  })
})

describe('Hoja `.est` (src/styles/estandar.css)', () => {
  const css = leer('src/styles/estandar.css')
  const bloqueEst = css.slice(css.indexOf('.est {'), css.indexOf('}', css.indexOf('.est {')))
  it('crema #faf8f4 como fondo del módulo (decisión del dueño 24-nov)', () => {
    expect(bloqueEst).toMatch(/--c-crema:\s*#faf8f4/)
    expect(bloqueEst).toMatch(/--c-fondo:\s*var\(--c-crema\)/)
    expect(bloqueEst).toMatch(/background:\s*var\(--c-fondo\)/)
  })
  it('redefine los alias que :root resuelve con la línea y el panel viejos', () => {
    for (const a of ['--t-border', '--t-panel', '--vt-border', '--vt-panel']) expect(bloqueEst).toContain(a + ':')
  })
  it('todo selector de la hoja está acotado a .est', () => {
    const reglas = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '').match(/[^{}]+\{/g) ?? []
    const malas = reglas.map(r => r.replace('{', '').trim()).filter(Boolean)
      .flatMap(r => porComa(r)).filter(sel => !sel.startsWith('.est'))
    expect(malas).toEqual([])
  })
  it('se carga después de index.css (si no, .tips-module le pisa el fondo)', () => {
    const main = leer('src/main.tsx')
    const i = main.indexOf("import './index.css'"), j = main.indexOf("import './styles/estandar.css'")
    expect(i).toBeGreaterThanOrEqual(0)
    expect(j).toBeGreaterThan(i)
  })
  it('Caja lleva la clase .est en su raíz', () => {
    expect(leer('src/modules/cash/CashModule.tsx')).toContain('className="tips-module est"')
  })
})

describe('Íconos (src/shared/ui/iconos.ts)', () => {
  it('los diez de Caja y las props estándar', () => {
    for (const n of ['IconPlus', 'IconCheck', 'IconChevronRight', 'IconChevronDown', 'IconCalendar', 'IconDownload', 'IconPencil', 'IconTrash', 'IconArrowBackUp', 'IconSearch'])
      expect((iconos as Record<string, unknown>)[n], n).toBeTruthy()
    expect(iconos.PROPS_ICONO).toMatchObject({ size: 20, stroke: 1.5, 'aria-hidden': true })
  })
  it('nadie importa @tabler/icons-react directo: la lista vive en iconos.ts', () => {
    const malos: string[] = []
    const recorrer = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f)
      if (statSync(p).isDirectory()) recorrer(p)
      else if (/\.(ts|tsx)$/.test(f) && !p.endsWith(join('shared', 'ui', 'iconos.ts')) && !p.endsWith('estandar.test.tsx') && readFileSync(p, 'utf8').includes('@tabler/icons-react')) malos.push(p) } }
    recorrer(resolve(process.cwd(), 'src'))
    expect(malos).toEqual([])
  })
})

// ── Ronda 2 (verificador #349): guardas para lo que antes ninguna prueba cuidaba ──
const lum = (h: string) => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] }
const contraste = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
// Valor hex de un token: primero en `.est` (estandar.css), si no en :root (index.css).
const tokenHex = (n: string): string => {
  for (const css of [leer('src/styles/estandar.css'), leer('src/index.css')]) {
    const m = css.match(new RegExp(`${n}:\\s*([^;]+);`))
    if (!m) continue
    const v = m[1].trim()
    if (v.startsWith('#')) return v
    const ref = v.match(/^var\((--[\w-]+)\)$/)
    if (ref) return tokenHex(ref[1])
  }
  throw new Error('token sin valor: ' + n)
}

describe('contraste mínimo de los tokens sobre la crema', () => {
  const crema = () => tokenHex('--c-crema')
  it.each([['--c-tinta'], ['--c-gris'], ['--c-oro-texto'], ['--c-laca'], ['--c-musgo']])('texto %s sobre crema ≥ 4,5:1', t => {
    expect(contraste(tokenHex(t), crema())).toBeGreaterThanOrEqual(4.5)
  })
  it('píldora «pendiente»: oro-texto sobre su fondo ≥ 4,5:1 (12 px)', () => {
    const css = leer('src/styles/estandar.css')
    const fondo = css.match(/\.est-pildora\.pendiente \{[^}]*background:\s*var\((--[\w-]+)\)/)![1]
    expect(contraste(tokenHex('--c-oro-texto'), tokenHex(fondo))).toBeGreaterThanOrEqual(4.5)
  })
  it('foco visible de los botones: contorno ≥ 3:1 sobre crema', () => {
    const css = leer('src/styles/estandar.css')
    const m = css.match(/\.est \.est-btn:focus-visible \{\s*outline:\s*2px solid var\((--[\w-]+)\)/)
    expect(m, 'falta la regla de foco de .est-btn').not.toBeNull()
    expect(contraste(tokenHex(m![1]), crema())).toBeGreaterThanOrEqual(3)
  })
})

describe('dependencia de íconos', () => {
  it('iconos.ts exporta por nombre (nada de `export *`) y solo los diez de la lista', () => {
    const src = leer('src/shared/ui/iconos.ts').replace(/\/\/.*$/gm, '')
    expect(src).not.toMatch(/export\s*\*/)
    const bloque = src.match(/export\s*\{([^}]*)\}\s*from\s*'@tabler\/icons-react'/)
    expect(bloque).not.toBeNull()
    const nombres = bloque![1].split(',').map(x => x.trim()).filter(Boolean).sort()
    expect(nombres).toEqual(['IconArrowBackUp', 'IconCalendar', 'IconCheck', 'IconChevronDown', 'IconChevronRight', 'IconDownload', 'IconPencil', 'IconPlus', 'IconSearch', 'IconTrash'])
  })
  it('@tabler/icons-react con versión FIJA en package.json (sin ^ ni ~)', () => {
    const pkg = JSON.parse(leer('package.json')) as { dependencies: Record<string, string> }
    expect(pkg.dependencies['@tabler/icons-react']).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
