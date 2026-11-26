// @vitest-environment happy-dom
// Inventario → 📨 Facturas electrónicas → «Emisores por confirmar» (mig 203): por rol (owner y contador ven
// «Es un proveedor real · recordar»; el manager no; «Desactivar» solo el owner), estados vacío / cargando / error,
// el aviso después de recordar y que nada fuerce el ancho a 390 px. Datos ficticios.
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MOTIVO_EMISOR } from '../../shared/fe/emisoresPendientes'

const H = vi.hoisted(() => ({
  pend: null as unknown, conocidos: null as unknown, recordar: null as unknown,
  llamadas: [] as string[],
}))
vi.mock('../../shared/api/feEmisores', () => ({
  getEmisoresPendientes: vi.fn(async () => H.pend),
  getEmisoresConocidos: vi.fn(async () => H.conocidos),
  recordarEmisor: vi.fn(async (c: string) => { H.llamadas.push('recordar:' + c); return H.recordar }),
  desactivarEmisor: vi.fn(async (c: string) => { H.llamadas.push('desactivar:' + c); return { ok: true, data: 'desactivar' } }),
}))

import InvFeEmisores from './InvFeEmisores'

const PEND = [{
  cedula: '310100000331', nombre: 'Proveedor ficticio',
  comprobantes: [
    { fin_clave: '0000000001', fecha: '2026-11-30T15:15:00Z', total: 1000, moneda: 'CRC', otros_motivos: [] },
    { fin_clave: '0000000002', fecha: '2026-11-30T15:15:00Z', total: 2500.5, moneda: 'CRC', otros_motivos: ['misma clave con otro XML: revisar cuál es el real (quedan todas las versiones)'] },
  ],
}]
const CONOCIDOS = [{ cedula: '310100000301', nombre: 'Conocido ficticio', activo: true, origen: 'revision', aprobado_en: '2026-11-30T16:00:00Z' }]

beforeEach(() => {
  H.pend = { ok: true, data: PEND }; H.conocidos = { ok: true, data: CONOCIDOS }
  H.recordar = { ok: true, data: { resultado: 'recordar', pasan_a_ok: 1, siguen_revisar: 1 } }
  H.llamadas = []
  window.confirm = vi.fn(() => true)
})
afterEach(cleanup)

const BOTON = 'Es un proveedor real · recordar'

describe('InvFeEmisores por rol', () => {
  it('owner: nombre y cédula del emisor, sus facturas, el botón y «Desactivar»', async () => {
    render(<InvFeEmisores rol="owner" />)
    expect(await screen.findByText('Proveedor ficticio')).toBeTruthy()
    expect(screen.getByText(/Cédula 310100000331 · 2 facturas/)).toBeTruthy()
    expect(screen.getByText(/clave …0000000002/)).toBeTruthy()
    expect(screen.getByText(/Sigue para revisar aunque lo recordés: misma clave con otro XML/)).toBeTruthy()
    expect(screen.getByRole('button', { name: BOTON })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Desactivar' })).toBeTruthy()
  })
  it('contador: ve el botón de recordar, no «Desactivar»', async () => {
    render(<InvFeEmisores rol="contador" />)
    expect(await screen.findByRole('button', { name: BOTON })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Desactivar' })).toBeNull()
  })
  it('manager (o cualquier otro rol): ve la lista pero ningún botón', async () => {
    for (const rol of ['manager', 'cajero', '']) {
      render(<InvFeEmisores rol={rol} />)
      expect(await screen.findByText('Proveedor ficticio')).toBeTruthy()
      expect(screen.queryByRole('button', { name: BOTON })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Desactivar' })).toBeNull()
      cleanup()
    }
  })
})

describe('InvFeEmisores: acciones y estados', () => {
  it('recordar: confirma, llama con la cédula, avisa cuántas pasaron y cuántas siguen, y recarga', async () => {
    const onCambio = vi.fn()
    render(<InvFeEmisores rol="contador" onCambio={onCambio} />)
    fireEvent.click(await screen.findByRole('button', { name: BOTON }))
    expect(await screen.findByRole('status')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('Listo: Proveedor ficticio quedó como proveedor real. 1 factura pasó a «ok» · 1 sigue para revisar por otro motivo.')
    expect(H.llamadas).toEqual(['recordar:310100000331'])
    await waitFor(() => expect(onCambio).toHaveBeenCalledTimes(1))
  })
  it('si cancela el aviso de confirmación, no llama a la base', async () => {
    window.confirm = vi.fn(() => false)
    render(<InvFeEmisores rol="owner" />)
    fireEvent.click(await screen.findByRole('button', { name: BOTON }))
    expect(H.llamadas).toEqual([])
  })
  it('si la base rechaza (42501), muestra su texto y no inventa un «listo»', async () => {
    H.recordar = { ok: false, error: 'Ese emisor lo desactivó el owner: solo el owner lo vuelve a activar' }
    render(<InvFeEmisores rol="contador" />)
    fireEvent.click(await screen.findByRole('button', { name: BOTON }))
    expect((await screen.findByRole('status')).textContent).toBe('Ese emisor lo desactivó el owner: solo el owner lo vuelve a activar')
  })
  it('desactivar (owner) llama con la cédula', async () => {
    render(<InvFeEmisores rol="owner" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Desactivar' }))
    expect((await screen.findByRole('status')).textContent).toBe('Conocido ficticio quedó desactivado.')
    expect(H.llamadas).toEqual(['desactivar:310100000301'])
  })
  it('vacío: lo dice, sin botón', async () => {
    H.pend = { ok: true, data: [] }; H.conocidos = { ok: true, data: [] }
    render(<InvFeEmisores rol="owner" />)
    expect(await screen.findByTestId('fe-emisores-vacio')).toBeTruthy()
    expect(screen.getByText(/Todavía no hay ninguno/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: BOTON })).toBeNull()
  })
  it('cargando: muestra «Cargando emisores…» mientras no responde', async () => {
    H.pend = new Promise(() => {})
    render(<InvFeEmisores rol="owner" />)
    expect(screen.getByTestId('fe-emisores-cargando')).toBeTruthy()
  })
  it('error de lectura: lo dice y no muestra lista ni botones', async () => {
    H.pend = { ok: false, error: 'No se pudieron leer los emisores por revisar.' }
    render(<InvFeEmisores rol="owner" />)
    expect((await screen.findByTestId('fe-emisores-error')).textContent).toContain('No se pudieron leer')
    expect(screen.queryByRole('button', { name: BOTON })).toBeNull()
  })
  it('390 px: la tarjeta, el nombre y el botón envuelven (happy-dom no mide: se fija el estilo)', async () => {
    H.pend = { ok: true, data: [{ ...PEND[0], nombre: 'Distribuidora ficticia de nombre larguísimo sin espacios'.replace(/ /g, '') }] }
    render(<InvFeEmisores rol="owner" />)
    const tarjeta = await screen.findByTestId('fe-emisor')
    expect(['0', '0px']).toContain(tarjeta.style.minWidth)
    expect(tarjeta.style.overflowWrap).toBe('anywhere')
    expect((tarjeta.firstElementChild as HTMLElement).style.flexWrap).toBe('wrap')
    const b = screen.getByRole('button', { name: BOTON }) as HTMLElement
    expect(b.style.whiteSpace).toBe('normal')
    expect(b.style.maxWidth).toBe('100%')
  })
  it('el filtro exacto del motivo vive en emisoresPendientes (mismo texto que la 201)', () => {
    expect(MOTIVO_EMISOR).toBe('emisor no conocido (cédula sin cargar en emisores conocidos)')
  })
})
