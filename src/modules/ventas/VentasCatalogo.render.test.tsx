// @vitest-environment happy-dom
// Ventas v2 · 3.1b — «Ajustes → Catálogo» (SPEC-3.1-catalogo §8.2). Por rol: owner edita (también el nombre de una
// familia), manager edita solo su local (sin nombres de familia), contador / cajero / salonero no editan (y no ven la
// vista: ventasTabs.test.ts). Estados vacío / carga / error y 390 px. Datos ficticios.
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { CatalogoProductosRpc } from '../../shared/api/posNdf'
import { teclearNumero } from '../cash/teclearNumero.testutil'

let role = 'owner'
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { role } }) }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

const H = vi.hoisted(() => ({
  locales: [{ id: 'santa-teresa', nombre: 'Local A' }] as { id: string; nombre: string }[],
  getLocales: vi.fn(),
  getCatalogo: vi.fn(),
  guardar: vi.fn(),
  guardarNombre: vi.fn(),
}))
vi.mock('./resumenV2Datos', () => ({ getLocalesVentas: (r: string) => H.getLocales(r) }))
vi.mock('../../shared/api/posNdf', () => ({
  getCatalogoProductos: (l: string) => H.getCatalogo(l),
  guardarAjusteProducto: (...a: unknown[]) => H.guardar(...a),
  guardarNombreFamilia: (...a: unknown[]) => H.guardarNombre(...a),
}))

import VentasCatalogo from './VentasCatalogo'
import { POR_PAGINA } from './catalogoAjustes'

const prod = (codigo: string, nombre: string, familia: number | null, categoria: string, extra: Partial<CatalogoProductosRpc['productos'][number]> = {}) =>
  ({ codigo, nombre, familia, categoria, categoriaPropia: null, rinde: 1, vistoDesde: '2025-01-01', vistoHasta: '2026-11-20', ...extra })
const familias = [
  { familia: 3, nombre: 'ROLLS FICTICIOS', categoria: 'comida', orden: 20 },
  { familia: 5, nombre: 'BEBIDAS FICTICIAS', categoria: 'bebida', orden: 10 },
  { familia: 7, nombre: 'Grupo A (surf)', categoria: 'otros', orden: 10 },
  { familia: 17, nombre: 'CORTESIAS FICTICIAS', categoria: 'cortesia', orden: 10 },
]
const base = (): CatalogoProductosRpc => ({
  productos: [
    prod('10', 'ROLLO FICTICIO', 3, 'comida'),
    prod('20', 'CERVEZA FICTICIA', 5, 'bebida', { rinde: 4 }),
    prod('30', 'REGALO FICTICIO', 17, 'cortesia'),
    prod('50', 'PROMO NUEVA FICTICIA', 5, 'bebida', { vistoDesde: '2026-11-20' }),
  ],
  familias,
  categoriasEditables: ['comida', 'bebida', 'menu_especial', 'extras', 'merch', 'otros'],
  categoriasFijas: ['giftcard', 'pax', 'duenos', 'cortesia', 'personal', 'ingredientes'],
})
let catalogo: Record<string, CatalogoProductosRpc>

// Reloj: 26-nov 23:30 CR (= 27-nov 05:30 UTC). «Nuevo» se cuenta desde el día CR, no desde el UTC.
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-27T05:30:00Z')) })
afterAll(() => { vi.useRealTimers() })
beforeEach(() => {
  role = 'owner'
  H.locales = [{ id: 'santa-teresa', nombre: 'Local A' }]
  catalogo = { 'santa-teresa': base() }
  H.getLocales.mockReset().mockImplementation(async () => H.locales)
  H.getCatalogo.mockReset().mockImplementation(async (l: string) => {
    if (!catalogo[l]) throw new Error('No autorizado para este local')
    return catalogo[l]
  })
  H.guardar.mockReset().mockResolvedValue(undefined)
  H.guardarNombre.mockReset().mockImplementation(async (_l: string, _f: number, n: string) => n)
})
afterEach(cleanup)

const lista = () => screen.getByRole('list', { name: 'Productos del catálogo' })
const filas = () => within(lista()).getAllByRole('listitem')
const codigos = () => filas().map(li => li.getAttribute('data-codigo'))
const abrir = async () => { render(<VentasCatalogo />); await screen.findByRole('list', { name: 'Productos del catálogo' }) }

describe('owner', () => {
  it('lista todo el catálogo del local, ordenado categoría → familia → nombre', async () => {
    await abrir()
    expect(H.getCatalogo).toHaveBeenCalledWith('santa-teresa')
    expect(codigos()).toEqual(['10', '20', '50', '30'])
    expect(screen.getByText('4 de 4 productos')).toBeTruthy()
  })

  it('buscador y filtros (categoría, familia, los que cambié, nuevos) filtran', async () => {
    await abrir()
    fireEvent.change(screen.getByLabelText('Buscar producto'), { target: { value: 'cerveza' } })
    expect(codigos()).toEqual(['20'])
    fireEvent.change(screen.getByLabelText('Buscar producto'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Filtrar por categoría'), { target: { value: 'bebida' } })
    expect(codigos()).toEqual(['20', '50'])
    fireEvent.change(screen.getByLabelText('Filtrar por categoría'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Filtrar por familia'), { target: { value: '3' } })
    expect(codigos()).toEqual(['10'])
    fireEvent.change(screen.getByLabelText('Filtrar por familia'), { target: { value: '' } })
    fireEvent.click(screen.getByLabelText('Los que cambié'))
    expect(codigos()).toEqual(['20'])
    fireEvent.click(screen.getByLabelText('Los que cambié'))
    fireEvent.click(screen.getByLabelText(/Nuevos/))
    expect(codigos()).toEqual(['50'])
    fireEvent.change(screen.getByLabelText('Filtrar por categoría'), { target: { value: 'comida' } })
    expect(screen.getByText('Ningún producto con estos filtros.')).toBeTruthy()
  })

  it('cambiar la categoría guarda con local, código y LOS DOS valores (el rinde que ya tenía)', async () => {
    await abrir()
    fireEvent.change(screen.getByLabelText('Categoría · CERVEZA FICTICIA'), { target: { value: 'otros' } })
    await waitFor(() => expect(H.guardar).toHaveBeenCalledWith('santa-teresa', '20', 4, 'otros'))
    await waitFor(() => expect(H.getCatalogo).toHaveBeenCalledTimes(2))   // relee: la categoría vigente la da la base
  })

  it('«De su familia» manda null', async () => {
    catalogo['santa-teresa'].productos[0] = prod('10', 'ROLLO FICTICIO', 3, 'menu_especial', { categoriaPropia: 'menu_especial' })
    await abrir()
    const sel = screen.getByLabelText('Categoría · ROLLO FICTICIO') as HTMLSelectElement
    expect(sel.value).toBe('menu_especial')
    expect(within(sel).getByRole('option', { name: 'De su familia (Comida)' })).toBeTruthy()
    fireEvent.change(sel, { target: { value: '' } })
    await waitFor(() => expect(H.guardar).toHaveBeenCalledWith('santa-teresa', '10', 1, null))
  })

  it('cambiar el «rinde» guarda con la categoría propia que ya tenía; fuera de 1–20 o ilegible no se envía', async () => {
    await abrir()
    const rinde = () => screen.getByLabelText('Rinde · ROLLO FICTICIO') as HTMLInputElement
    for (const malo of ['0', '21', '2.5']) {
      teclearNumero(rinde(), malo)
      fireEvent.blur(rinde())
      expect(screen.getByRole('alert').textContent).toContain('«Rinde · ROLLO FICTICIO»')
    }
    teclearNumero(rinde(), '')
    teclearNumero(rinde(), '5-')
    fireEvent.blur(rinde())
    expect(screen.getByRole('alert').textContent).toContain('«Rinde · ROLLO FICTICIO»')
    expect(H.guardar).not.toHaveBeenCalled()
    teclearNumero(rinde(), '3')
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.keyDown(rinde(), { key: 'Enter' })
    await waitFor(() => expect(H.guardar).toHaveBeenCalledWith('santa-teresa', '10', 3, null))
  })

  it('un producto de regalías muestra la categoría bloqueada («Regalías», la fija su familia); su rinde sí se edita', async () => {
    await abrir()
    const fila = filas().find(li => li.getAttribute('data-codigo') === '30')!
    expect(within(fila).queryByRole('combobox')).toBeNull()
    expect(within(fila).getByLabelText('Categoría · REGALO FICTICIO').textContent).toBe('Regalías (la fija su familia)')
    expect(within(fila).getByRole('spinbutton', { name: 'Rinde · REGALO FICTICIO' })).toBeTruthy()
  })

  it('si la función devuelve error, la fila vuelve a su valor y se avisa', async () => {
    H.guardar.mockRejectedValueOnce(new Error('La categoría de este producto la fija su familia'))
    await abrir()
    const sel = () => screen.getByLabelText('Categoría · CERVEZA FICTICIA') as HTMLSelectElement
    fireEvent.change(sel(), { target: { value: 'merch' } })
    await waitFor(() => expect(screen.getAllByRole('alert')[0].textContent).toContain('Quedó como estaba'))
    expect(sel().value).toBe('')
    expect(H.getCatalogo).toHaveBeenCalledTimes(1)
  })

  it('no hay ningún campo de subcategoría, tipo, clasificación ni costo (D-6 = A)', async () => {
    await abrir()
    const etiquetas = [...document.querySelectorAll('[aria-label]')].map(e => e.getAttribute('aria-label')!.toLowerCase())
    expect(etiquetas.filter(t => /subcat|subclas|clasificaci|tipo|costo/.test(t))).toEqual([])
    expect(document.body.textContent).toContain('El costo ya no se carga acá')
  })

  it('cambia el nombre de una familia (solo el nombre); un nombre con «@» no se manda', async () => {
    await abrir()
    fireEvent.click(screen.getByText(/Familias del PoS/))
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar el nombre de la familia 7' }))
    const campo = () => screen.getByLabelText('Nombre de la familia 7') as HTMLInputElement
    fireEvent.change(campo(), { target: { value: 'alguien@ejemplo.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(screen.getByRole('alert').textContent).toContain('Solo letras')
    expect(H.guardarNombre).not.toHaveBeenCalled()
    fireEvent.change(campo(), { target: { value: '  Escuela   Ficticia (surf) ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(H.guardarNombre).toHaveBeenCalledWith('santa-teresa', 7, 'Escuela Ficticia (surf)'))
    await waitFor(() => expect(H.getCatalogo).toHaveBeenCalledTimes(2))
  })

  it('con dos locales elige local (Santa Teresa primero) y guarda en el elegido', async () => {
    H.locales = [{ id: 'santa-teresa', nombre: 'Local A' }, { id: 'nosara', nombre: 'Local B' }]
    catalogo.nosara = { ...base(), productos: [prod('900', 'ROLLO DE OTRO LOCAL', 3, 'comida')] }
    let soltar: () => void = () => {}
    const espera = new Promise<void>(r => { soltar = r })
    const real = H.getCatalogo.getMockImplementation()!
    H.getCatalogo.mockImplementation(async (l: string) => { if (l === 'nosara') await espera; return real(l) })
    await abrir()
    fireEvent.change(screen.getByLabelText('Local'), { target: { value: 'nosara' } })
    // Mientras llega el otro local, no queda a la vista (ni editable) el catálogo del anterior.
    expect(screen.queryByRole('list', { name: 'Productos del catálogo' })).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('Leyendo el catálogo')
    soltar()
    await screen.findByText('ROLLO DE OTRO LOCAL')
    expect(H.getCatalogo).toHaveBeenLastCalledWith('nosara')
    fireEvent.change(screen.getByLabelText('Categoría · ROLLO DE OTRO LOCAL'), { target: { value: 'extras' } })
    await waitFor(() => expect(H.guardar).toHaveBeenCalledWith('nosara', '900', 1, 'extras'))
  })

  it(`muestra ${POR_PAGINA} y «Mostrar N más»`, async () => {
    catalogo['santa-teresa'].productos = Array.from({ length: 150 }, (_, i) => prod(String(1000 + i), `ROLLO ${1000 + i}`, 3, 'comida'))
    await abrir()
    expect(filas()).toHaveLength(POR_PAGINA)
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar 50 más' }))
    expect(filas()).toHaveLength(150)
  })
})

describe('manager', () => {
  beforeEach(() => { role = 'manager' })
  it('edita «rinde» y categoría en SU local; no ve otro local ni cambia nombres de familia', async () => {
    H.locales = [{ id: 'santa-teresa', nombre: 'Local A' }]   // getLocalesVentas ya filtra por mis_locales
    await abrir()
    expect(H.getLocales).toHaveBeenCalledWith('manager')
    expect(screen.queryByLabelText('Local')).toBeNull()
    fireEvent.change(screen.getByLabelText('Categoría · ROLLO FICTICIO'), { target: { value: 'extras' } })
    await waitFor(() => expect(H.guardar).toHaveBeenCalledWith('santa-teresa', '10', 1, 'extras'))
    fireEvent.click(screen.getByText(/Familias del PoS/))
    expect(screen.queryByRole('button', { name: /Cambiar el nombre/ })).toBeNull()
    expect(document.body.textContent).toContain('El nombre lo cambia el dueño')
  })
  it('sin locales asignados: lo dice y no pide el catálogo', async () => {
    H.locales = []
    render(<VentasCatalogo />)
    expect((await screen.findByRole('alert')).textContent).toContain('No tenés ningún local asignado')
    expect(H.getCatalogo).not.toHaveBeenCalled()
  })
})

describe.each(['contador', 'cajero', 'salonero'])('%s (no ve la vista; si llegara, no edita nada)', r => {
  it('sin selectores ni cuadros, sin botones de familia', async () => {
    role = r
    await abrir()
    expect(within(lista()).queryAllByRole('combobox')).toEqual([])
    expect(within(lista()).queryAllByRole('spinbutton')).toEqual([])
    fireEvent.click(screen.getByText(/Familias del PoS/))
    expect(screen.queryByRole('button', { name: /Cambiar el nombre/ })).toBeNull()
  })
})

describe('estados', () => {
  it('carga: «Leyendo el catálogo…» mientras llega', async () => {
    H.getCatalogo.mockImplementation(() => new Promise(() => {}))
    render(<VentasCatalogo />)
    expect((await screen.findByRole('status')).textContent).toContain('Leyendo el catálogo')
  })
  it('vacío: dice que los productos aparecen con la primera factura', async () => {
    catalogo['santa-teresa'] = { ...base(), productos: [] }
    render(<VentasCatalogo />)
    expect(await screen.findByText(/aparecen solos con la primera factura del PoS/)).toBeTruthy()
  })
  it('error: lo avisa y «Reintentar» vuelve a pedir', async () => {
    H.getCatalogo.mockRejectedValueOnce(new Error('falla ficticia'))
    render(<VentasCatalogo />)
    expect((await screen.findByRole('alert')).textContent).toContain('No se pudo leer el catálogo (falla ficticia)')
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    await screen.findByRole('list', { name: 'Productos del catálogo' })
    expect(H.getCatalogo).toHaveBeenCalledTimes(2)
  })
  it('una familia sin fila sale «Familia N» con aviso', async () => {
    catalogo['santa-teresa'].productos.push(prod('60', 'SIN FAMILIA FICTICIA', 99, 'otros'))
    await abrir()
    expect(screen.getByRole('note').textContent).toContain('la familia 99')
    expect(document.body.textContent).toContain('99 Familia 99')
  })
})

describe('390 px', () => {
  it('cada producto es una tarjeta que se acomoda (flex-wrap) y nada lleva un ancho fijo en línea', async () => {
    ;(window as unknown as { happyDOM?: { setViewport?: (v: object) => void } }).happyDOM?.setViewport?.({ width: 390, height: 800 })
    await abrir()
    const conAncho = [...document.querySelectorAll<HTMLElement>('[style]')].filter(e => /width/.test(e.getAttribute('style') ?? ''))
    expect(conAncho).toEqual([])
    const src = readFileSync(resolve(process.cwd(), 'src/modules/ventas/VentasCatalogo.tsx'), 'utf8')
    expect(src).not.toMatch(/style=\{\{/)
    const css = readFileSync(resolve(process.cwd(), 'src/modules/ventas/ventasCatalogo.css'), 'utf8')
    const regla = (sel: string) => css.match(new RegExp(`\\${sel} \\{([^}]*)\\}`))?.[1] ?? ''
    expect(regla('.vc-fila')).toMatch(/flex-wrap: wrap/)
    expect(regla('.vc-fila')).toMatch(/min-width: 0/)
    expect(regla('.vc-controles')).toMatch(/flex-wrap: wrap/)
    expect(regla('.vc-controles')).toMatch(/max-width: 100%/)
    expect(regla('.vc-nombre')).toMatch(/overflow-wrap: anywhere/)
    // Ningún ancho fijo mayor que la pantalla en el CSS de la vista.
    for (const m of css.matchAll(/(?:^|[^-])width: (\d+(?:\.\d+)?)(px|rem)/g)) {
      const px = Number(m[1]) * (m[2] === 'rem' ? 16 : 1)
      expect(px).toBeLessThanOrEqual(390)
    }
  })
})
