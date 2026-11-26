// @vitest-environment happy-dom
//
// Caja PR 3/4 (SPEC-caja-estandar §4): el modal «El conteo no cuadra», el resumen antes de confirmar y el ajuste
// con su motivo se leen sin ambigüedad. SOLO presentación — los montos que se mandan a la RPC no cambian (se
// comprueba con el payload) y el personal sigue cargando montos positivos.
//   · Modal: la diferencia en palabras y con el color del hecho (antes «Diferencia: +₡1.500» siempre en rojo).
//   · Resumen: diferencia en palabras + «Ajuste de cierre en Caja Fuerte» CON SIGNO por moneda (− sale · + entra),
//     el MISMO monto del ajuste que se guarda; propinas pagadas «−₡12.000» (menos tipográfico, sin espacio).
//   · La línea «Dólares: …» sale UNA vez en el cierre en curso (menor del verificador del #348).
//   · 390 px: «Dólares» de Ventas noche y la fecha de la apertura no se salen de su tarjeta.
// Datos ficticios.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { CashCierreDia, CashMovement, CashSession } from '../../shared/types/database'

const api = vi.hoisted(() => ({
  getCierresDia:       vi.fn(async () => [] as unknown[]),
  getCashSessions:     vi.fn(async () => [] as unknown[]),
  getAllCashMovements: vi.fn(async () => [] as unknown[]),
  cerrarDiaCompleto:   vi.fn(async (payload: Record<string, unknown>) => { void payload; return { cierre_id: 'c1', idempotente: false } }),
}))
vi.mock('../../shared/api/cash', () => ({
  ...api,
  saveCierreParcial:   vi.fn(async () => ({})),
  deshacerCierreDia:   vi.fn(async () => {}),
  discardDiaCompleto:  vi.fn(async () => {}),
  previewDiaCompleto:  vi.fn(async () => ({ fecha: '', borrar: [], ajenas: [] })),
  createDayMovement:   vi.fn(async () => ({})),
  sendCierreEmail:     vi.fn(async () => {}),
}))
vi.mock('../../shared/api/exchangeRate', () => ({ getCurrentRate: vi.fn(async () => 600) }))
vi.mock('../../shared/api/tips', () => ({ getTipPayoutsSince: vi.fn(async () => []) }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: 'manager', full_name: 'Prueba' } }) }))
vi.mock('../../shared/ManagerOverride', () => ({ useManagerOverride: () => vi.fn(async () => ({ ok: true })) }))

import CashCierre from './CashCierre'
import { todayStr, fd } from './cashUtils'

const HOY = todayStr()
// Fase 1 sellada con US$10 → debería US$10; en colones el debería es la venta de noche (pozo vacío).
const parcial = {
  id: 'c1', session_date: HOY, manager: 'Prueba', tipo: 'parcial_mediodia',
  vm_crc: 0, vm_usd: 10, propinas_m_crc: 0, otros_m_crc: 0, ef_real_m_crc: 0,
  vn_crc: 0, vn_usd: 0, propinas_n_crc: 0, otros_n_crc: 0, ef_real_n_crc: 0,
  sep_diaria_crc: 0, sep_diaria_usd: 0, sep_registradora_crc: 0, sep_registradora_usd: 0,
  remanente_crc: 0, remanente_usd: 0, diferencia_crc: 0, ajuste_tipo: '', ajuste_motivo: '',
  notas: '', tipo_cambio: 600, created_at: `${HOY}T14:00:00Z`, updated_at: `${HOY}T14:00:00Z`,
} as CashCierreDia
const turno = { id: 's1', session_date: HOY, status: 'closed', shift_type: 'Día', cajero_name: 'Cajero' } as CashSession

// [0]=Ventas noche ₡ · [7]=Remanente CF ₡ · [8]=Remanente CF $ (mismo orden que CashCierre.recontar.test.tsx)
const montos = () => Array.from(document.querySelectorAll<HTMLInputElement>('.cierre-monto input'))
const setMonto = (el: HTMLInputElement, v: number) => fireEvent.change(el, { target: { value: String(v) } })
const bloque = (b: string) => document.querySelector(`[data-bloque="${b}"]`) as HTMLElement | null
const botonCierre = () => screen.getByText(/Revisar resumen y cerrar el día/) as HTMLButtonElement

const contar = async (crc: number, usd: number) => {
  render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
  await screen.findByText(/Revisar resumen y cerrar el día/)
  setMonto(montos()[0], 100000)
  fireEvent.click(screen.getByRole('button', { name: 'Sin novedades' }))
  setMonto(montos()[7], crc)
  setMonto(montos()[8], usd)
}
// Fuera de tolerancia: «No recontar» → motivo → resumen. Dentro: directo al resumen.
const abrirResumen = () => {
  fireEvent.click(botonCierre())
  if (screen.queryByText(/El conteo no cuadra/)) {
    fireEvent.click(screen.getByText(/No recontar/))
    fireEvent.change(screen.getByPlaceholderText('Ej.: vuelto mal dado en una mesa'), { target: { value: 'vuelto mal dado' } })
    fireEvent.click(botonCierre())
  }
  return bloque('resumen-diferencia')!
}
const confirmar = async () => {
  fireEvent.click(await screen.findByText(/CONFIRMAR CIERRE DEL DÍA/))
  await waitFor(() => expect(api.cerrarDiaCompleto).toHaveBeenCalledTimes(1))
  return (api.cerrarDiaCompleto.mock.calls[0][0] as unknown as { ajuste: { crc: number; usd: number } }).ajuste
}

beforeEach(() => {
  cleanup(); vi.clearAllMocks()
  api.getCierresDia.mockResolvedValue([parcial])
  api.getCashSessions.mockResolvedValue([turno])
  api.getAllCashMovements.mockResolvedValue([])
  Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true })
})

describe('Modal «El conteo no cuadra»', () => {
  it('faltan las dos monedas: palabras, laca, sin «+/−₡» ni «US$ -»', async () => {
    await contar(98049, 8)
    fireEvent.click(botonCierre())
    const m = bloque('modal-diferencia')!
    expect(m.querySelector('[data-titular]')!.textContent).toBe('Diferencia: Faltan ₡1.951 y $ 2,00')
    expect(m.textContent).toContain('Colones: faltan ₡1.951, fuera de tolerancia (₡500)')
    expect(m.textContent).toContain('Dólares: faltan $ 2,00, fuera de tolerancia (US$1)')
    expect(m.getAttribute('data-tono')).toBe('laca')
    expect(m.className).toContain('fail')
    expect(m.textContent).not.toMatch(/[+−-]\s?₡|US\$ [+−-]/)
  })
  it('sobran colones: «Sobran ₡2.300» en ORO (antes «+₡2.300» en rojo)', async () => {
    await contar(102300, 10)
    fireEvent.click(botonCierre())
    const m = bloque('modal-diferencia')!
    expect(m.querySelector('[data-titular]')!.textContent).toBe('Diferencia: Sobran ₡2.300')
    expect(m.getAttribute('data-tono')).toBe('oro')
    expect(m.className).toContain('sobra')
    expect(m.className).not.toMatch(/\bfail\b/)
  })
})

describe('Resumen antes de confirmar', () => {
  it('faltante: palabras + ajuste con signo «−₡1.951» y «−$ 2,00» en laca, el MISMO monto que se guarda', async () => {
    await contar(98049, 8)
    const r = abrirResumen()
    expect(r.querySelector('[data-titular]')!.textContent).toBe('Diferencia: Faltan ₡1.951 y $ 2,00')
    const a = bloque('ajuste-signo')!
    expect(a.textContent).toContain('Ajuste de cierre en Caja Fuerte (faltante)')
    const crc = a.querySelector('[data-moneda="crc"]')!
    const usd = a.querySelector('[data-moneda="usd"]')!
    expect(crc.textContent).toBe('Colones−₡1.951')
    expect(usd.textContent).toBe('Dólares−$ 2,00')
    expect(crc.getAttribute('data-tono')).toBe('laca')
    expect(usd.getAttribute('data-tono')).toBe('laca')
    expect(a.querySelector('[data-motivo]')!.textContent).toBe('Motivo: vuelto mal dado')
    // Solo presentación: el ajuste que se manda sigue siendo la diferencia con su signo de siempre.
    expect(await confirmar()).toMatchObject({ crc: -1951, usd: -2 })
  })
  it('sobrante: «+₡2.300» en oro; sin línea de dólares (cuadran)', async () => {
    await contar(102300, 10)
    const r = abrirResumen()
    expect(r.getAttribute('data-tono')).toBe('oro')
    const a = bloque('ajuste-signo')!
    expect(a.querySelector('[data-moneda="crc"]')!.textContent).toBe('Colones+₡2.300')
    expect(a.querySelector('[data-moneda="crc"]')!.getAttribute('data-tono')).toBe('oro')
    expect(a.querySelector('[data-moneda="usd"]')).toBeNull()
    expect(await confirmar()).toMatchObject({ crc: 2300, usd: 0 })
  })
  it('dentro de tolerancia: «Cuadra» con la nota (no «sin diferencia» si faltan ₡300) y sin ajuste', async () => {
    await contar(99700, 10)
    const r = abrirResumen()
    expect(r.querySelector('[data-titular]')!.textContent).toBe('Diferencia: Cuadra')
    expect(r.textContent).toContain('Colones: cuadra, faltan ₡300: dentro de la tolerancia (menos de ₡500)')
    expect(r.getAttribute('data-tono')).toBe('musgo')
    expect(bloque('ajuste-signo')).toBeNull()
    expect(await confirmar()).toMatchObject({ crc: 0, usd: 0 })
  })
  it('propinas pagadas en el cierre: «−₡12.000» (menos tipográfico pegado), no «− ₡12.000»', async () => {
    api.getAllCashMovements.mockResolvedValue([{
      id: 'p1', session_id: 's1', fecha: HOY, created_at: `${HOY}T20:00:00Z`, movement_type: 'egreso_caja_fuerte',
      subcategory: 'Propinas por turno', description: 'Propinas prueba', amount_crc: 12000, amount_usd: 0,
      status: 'aprobado', method: 'Efectivo',
    } as unknown as CashMovement])
    await contar(98049, 8)
    abrirResumen()
    const fila = screen.getByText('Propinas pagadas en el cierre').parentElement!
    expect(fila.querySelector('strong')!.textContent).toBe('−₡12.000')
    // Una salida va en tinta, como los egresos de la línea de diseño (maqueta: «−₡62.500» sin color); el violeta
    // viejo (#8a5aa8) no es un token de .est.
    expect(fila.querySelector('strong')!.getAttribute('style')).toContain('color: var(--c-tinta)')
    expect(fila.querySelector('strong')!.getAttribute('style')).not.toMatch(/8a5aa8/i)
  })
  it('colones fuera de tolerancia y dólares DENTRO pero ≠ 0: solo la línea de colones; el ajuste en $ va en 0 (M5)', async () => {
    await contar(98049, 9.5)
    const r = abrirResumen()
    expect(r.querySelector('[data-titular]')!.textContent).toBe('Diferencia: Faltan ₡1.951')
    expect(r.textContent).toContain('Dólares: cuadra, faltan $ 0,50: dentro de la tolerancia (menos de US$1)')
    const a = bloque('ajuste-signo')!
    expect(a.querySelector('[data-moneda="crc"]')!.textContent).toBe('Colones−₡1.951')
    expect(a.querySelector('[data-moneda="usd"]')).toBeNull()
    expect(a.querySelector('[data-titulo-ajuste]')!.textContent).toBe('Ajuste de cierre en Caja Fuerte (faltante)')
    expect(await confirmar()).toMatchObject({ crc: -1951, usd: 0 })
  })
  it('mezclado (faltan ₡, sobran $): el título va SIN tipo para no decir «(faltante)» sobre «+$ 3,50»', async () => {
    await contar(98049, 13.5)
    const r = abrirResumen()
    const a = bloque('ajuste-signo')!
    expect(a.querySelector('[data-titulo-ajuste]')!.textContent).toBe('Ajuste de cierre en Caja Fuerte')
    expect(a.querySelector('[data-moneda="crc"]')!.textContent).toBe('Colones−₡1.951')
    expect(a.querySelector('[data-moneda="usd"]')!.textContent).toBe('Dólares+$ 3,50')
    expect(a.querySelector('[data-moneda="crc"]')!.getAttribute('data-tono')).toBe('laca')
    expect(a.querySelector('[data-moneda="usd"]')!.getAttribute('data-tono')).toBe('oro')
    expect(r.textContent).not.toMatch(/\((faltante|sobrante)\)/)
    // Lo que se guarda no cambia: el tipo sigue saliendo de ajusteTipoPorSigno (manda ₡) y el ajuste con su signo.
    expect(await confirmar()).toMatchObject({ crc: -1951, usd: 3.5 })
    const cierre = (api.cerrarDiaCompleto.mock.calls[0][0] as unknown as { cierre: { ajuste_tipo: string } }).cierre
    expect(cierre.ajuste_tipo).toBe('Faltante')
  })
})

describe('Dólares con el formato de toda Caja (fd: «$ 2,00», coma decimal)', () => {
  it('el cartel, el resumen y la tabla dicen los dólares igual; ningún «$2.00» con punto decimal', async () => {
    await contar(98049, 8)
    const montoUsd = document.querySelector('.cierre-table tr.total td:last-child')!.textContent
    expect(montoUsd).toBe(fd(8))
    abrirResumen()
    const todo = document.body.textContent ?? ''
    expect(todo).toContain(`Ventas mediodía`)
    expect(todo).toContain(`₡0 · ${fd(10)}`)                 // ventas mediodía en el resumen (antes «$10.00»)
    expect(todo).toContain(`Faltan ₡1.951 y ${fd(2)}`)        // titular (antes «$2,00» sin espacio)
    expect(todo).not.toMatch(/\$\s?\d+\.\d{2}(?!\d)/)
  })
  it('en el código de Caja no queda «$» + toFixed(2) (cada uno formateaba distinto)', () => {
    for (const f of ['CashCierre.tsx', 'textoDiferencia.ts', 'borrarDia.ts']) {
      const src = readFileSync(resolve(process.cwd(), 'src/modules/cash', f), 'utf8')
      expect(src, f).not.toMatch(/\$\{?[^\n]{0,60}toFixed\(2\)/)
    }
  })
})

describe('«Dólares» una sola vez en el cierre en curso', () => {
  it('la línea «Dólares: …» aparece UNA vez (antes en el cartel y en la caja de dólares)', async () => {
    await contar(98049, 8)
    const lineas = Array.from(document.querySelectorAll('body *'))
      .filter(el => el.children.length === 0 && /^Dólares: /.test(el.textContent ?? ''))
    expect(lineas.map(l => l.textContent)).toEqual(['Dólares: faltan $ 2,00, fuera de tolerancia (US$1)'])
    expect(bloque('diferencia-usd')).toBeNull()
  })
})

describe('390 px: nada se sale de su tarjeta', () => {
  it('Ventas noche: las dos columnas pueden achicarse (minmax(0, 1fr)), así «Dólares» no se sale', async () => {
    await contar(0, 0)
    const dolares = screen.getByLabelText('Ventas noche $')
    const fila = dolares.closest('.cierre-monto')!.parentElement!.parentElement as HTMLElement
    expect(fila.style.gridTemplateColumns).toBe('minmax(0, 1fr) minmax(0, 1fr)')
  })
  it('Apertura: la grilla Cajero · Fecha no pisa la regla de .cd-grid2 (una columna hasta 600 px)', () => {
    const turnoSrc = readFileSync(resolve(process.cwd(), 'src/modules/cash/CashTurno.tsx'), 'utf8')
    const grilla = turnoSrc.slice(turnoSrc.indexOf('Cajero · Fecha'), turnoSrc.indexOf('Cajero / encargado'))
    expect(grilla).toContain('<div className="cd-grid2">')
    expect(grilla).not.toMatch(/gridTemplateColumns/)
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
    const media = css.match(/@media \(max-width: 600px\) \{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g) ?? []
    expect(media.some(b => b.includes('.cd-grid2 { grid-template-columns: 1fr; }'))).toBe(true)
  })
  it('Conteo: en celular la etiqueta va arriba a lo ancho y ₡ y $ a media fila (lugar para ₡9.999.999)', () => {
    // happy-dom no mide: se fija la regla. La medida real a 390 px (Chrome) va en el PR: cuadro ₡ ~95 px de texto
    // (antes ~43 px, «98049» se veía «980·»); ₡9.999.999 ≈ 71 px en la mono de 0,82 rem.
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
    const media = (css.match(/@media \(max-width: 600px\) \{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g) ?? []).find(b => b.includes('.cierre-table'))!
    expect(media).toContain('.cierre-table tr { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }')
    expect(media).toContain('.cierre-table td:first-child { grid-column: 1 / -1;')
    expect(media).toContain('.cierre-table th:first-child { display: none; }')
    expect(media).not.toMatch(/table-layout: fixed|width: 34%/)
  })
})
