// @vitest-environment happy-dom
// Bug del 16-nov (lo vio el dueño en el celular): en `@media (max-width: 760px)` la regla
// `.vt-nav-tab:nth-child(n+9) { display: none }` escondía toda pestaña después de la 8.ª y no había
// menú de desborde. En Club el celular no mostraba Embudo, Promociones, Descuentos, Campañas ni Locales.
// La barra `.vt-nav-tabs` la usan Admin, Club, Clientes, Inventario, Propinas y Ventas.
//
// Dos pruebas:
//  1. Render real de ClubModule (owner, 13 pestañas) a 390 px con el CSS de la app cargado: happy-dom
//     evalúa el @media y el :nth-child, así que si vuelve una regla que esconde pestañas, esto cae.
//  2. Escaneo de todos los .css de src/: ninguna regla sobre `.vt-nav-tab` puede esconderla.
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('./shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: 'owner', full_name: 'Prueba' } }) }))
vi.mock('./shared/api/supabase', () => ({ supabase: {} }))
vi.mock('./modules/club/Escanear', () => ({ default: () => <div>PANTALLA-ESCANEAR</div> }))
vi.mock('./shared/api/club', async orig => ({
  ...(await orig<typeof import('./shared/api/club')>()),
  getLocalesClubParaRol: async () => [{ id: 'nav-a', nombre: 'Local Nav A', activo: true }],
  getLocalesClub: async () => [{ id: 'nav-a', nombre: 'Local Nav A', activo: true }],
  getClubUrl: async () => null,
}))

import ClubModule from './modules/club/ClubModule'

const SRC = join(process.cwd(), 'src')

function cssDeSrc(dir = SRC): string[] {
  const out: string[] = []
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) out.push(...cssDeSrc(p))
    else if (n.endsWith('.css')) out.push(p)
  }
  return out
}

/** Reglas «selector { declaraciones }» de un CSS, con @media aplanado (solo para el escaneo). */
function reglas(css: string): { selector: string; cuerpo: string }[] {
  const limpio = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: { selector: string; cuerpo: string }[] = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(limpio))) out.push({ selector: m[1].trim(), cuerpo: m[2] })
  return out
}

const PESTANAS_OWNER = ['Escanear', 'Miembros', 'Negocios', 'Excepciones', 'Reportes', 'Tablero', 'Cohortes',
  'Ranking', 'Embudo', 'Promociones', 'Descuentos', 'Campañas', 'Locales']

describe('barra de pestañas en el celular (.vt-nav-tabs)', () => {
  beforeAll(() => {
    const hd = (window as unknown as { happyDOM?: { setViewport?: (v: { width: number; height: number }) => void } }).happyDOM
    hd?.setViewport?.({ width: 390, height: 800 })
    const style = document.createElement('style')
    style.textContent = ['src/index.css', 'src/modules/ventas/ventasNav.css']
      .map(f => readFileSync(join(process.cwd(), f), 'utf8')).join('\n')
    document.head.appendChild(style)
  })

  it('Club (owner) a 390 px: se ven las 13 pestañas, también de la 9.ª en adelante', async () => {
    expect(window.innerWidth).toBe(390)
    render(<MemoryRouter><ClubModule /></MemoryRouter>)
    expect(await screen.findByText('PANTALLA-ESCANEAR')).toBeTruthy()
    const barra = document.querySelector('.vt-nav-tabs') as HTMLElement
    const tabs = Array.from(barra.querySelectorAll<HTMLElement>('.vt-nav-tab'))
    expect(tabs.map(t => t.textContent)).toEqual(PESTANAS_OWNER)
    const escondidas = tabs.filter(t => getComputedStyle(t).display === 'none' || getComputedStyle(t).visibility === 'hidden')
    expect(escondidas.map(t => t.textContent)).toEqual([])
    // Con 4 filas la barra no queda pegada arriba en el celular (no tapa el contenido).
    expect(getComputedStyle(barra).display).toBe('grid')
    expect(getComputedStyle(barra).position).toBe('static')
  })

  it('ningún CSS de src/ esconde una pestaña de la barra (ni con :nth-child ni de otra forma)', () => {
    const malas: string[] = []
    for (const f of cssDeSrc()) {
      for (const { selector, cuerpo } of reglas(readFileSync(f, 'utf8'))) {
        if (!/\.vt-nav-tab(?![-\w])/.test(selector)) continue
        if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(cuerpo)) malas.push(`${f.slice(SRC.length + 1)}: ${selector}`)
      }
    }
    expect(malas).toEqual([])
  })
})
