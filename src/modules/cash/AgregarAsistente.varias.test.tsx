// @vitest-environment happy-dom
// (#149, decisión del dueño 13-nov) Una foto con VARIAS facturas se carga UNA POR UNA en el asistente «➕ Agregar
// factura / movimiento» de Caja Diaria (el único lugar donde la cajera carga facturas): cada factura su movimiento y su
// documento «procesado» enlazado; nada a la Bandeja como «nuevo». «➕ Agregar foto» enlaza solo una y avisa.
// Las consultas de duplicados y createDocumentRow son las REALES contra una tabla `documents` en memoria.
//
// Mutaciones anotadas (verificadas el 13-nov: cada una tumba las pruebas indicadas y al deshacerla vuelven a verde):
//  M1. confirmar: volver a cerrar después de la primera (sacar el bloque `if (photo && varias && idx + 1 < …)`)
//      → caen 5 (todas las del asistente: ninguna llega a la factura 2).
//  M2. confirmar: sacar el candado (`guardandoRef.current` y `registradasRef`) del arranque → cae «doble toque…».
//  M3. intentarCerrar: sacar la confirmación (`setConfirmarSalida`) → cae «cancelar en la 2 de 3…».
//  M4. mostrarFactura: ignorar `rev.claveRepetida` → caen las dos de «clave FE repetida…».
//  M5. PagoFoto: volver a mandar las demás a la Bandeja (`createDocumentRow(path, sha, d, createdBy)`) → cae «Agregar foto con 2…».
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import type { CashMovement, CashSession, Supplier } from '../../shared/types/database'
import { tablaDocs, vaciarDocs } from '../../shared/api/documentosEnMemoria.testutil'

const clave = (n: number) => `506131126003101000000001000010100000${String(n).padStart(4, '0')}1100000001`
const fac = (n: number, total: number, over: Record<string, unknown> = {}) => ({
  tipo: 'factura', proveedor: 'Pescadería del Pacífico', proveedor_cedula: '3101000000', numero_documento: `0010000101000000${n}`,
  moneda: 'CRC', fecha: '2026-11-13', total, confianza: 0.9, items: [], clave_fe: clave(n), ...over,
})
const m = vi.hoisted(() => {
  let n = 0
  return {
    crearMov: vi.fn(async (x: Record<string, unknown>) => ({ ...x, id: `mov-${++n}`, _pending: false })),
    leer: vi.fn(),
    reiniciar: () => { n = 0 },
  }
})
vi.mock('../../shared/api/supabase', async () => ({ supabase: (await import('../../shared/api/documentosEnMemoria.testutil')).supabaseEnMemoria }))
vi.mock('../../shared/api/documents', async (orig) => {
  const actual = await orig<typeof import('../../shared/api/documents')>()
  return {
    ...actual,                                    // findDuplicate / findDuplicateClave / findFacturaParecida / createDocumentRow REALES
    sha256File: async () => 'sha-varias',
    uploadImage: async () => ({ path: 'docs/varias.jpg', sha: 'sha-varias' }),
    extractImageDetalle: m.leer,
    signedUrl: async () => null,
    listLinkedDocs: async () => [],
  }
})
vi.mock('../../shared/utils/imageNormalize', () => ({ normalizeInvoiceImage: async () => ({ blob: new Blob(['x']), filename: 'f.jpg' }) }))
vi.mock('../../shared/api/cash', () => ({ createCashMovement: m.crearMov, upsertSupplier: vi.fn(), deactivateSupplier: vi.fn(), sendPagoProveedorEmail: vi.fn() }))
vi.mock('../../shared/api/finance', () => ({ getFinanceAccounts: async () => [] }))
vi.mock('../../shared/FacturaVerify', () => ({ default: () => <span>📷 factura</span> }))

import AgregarAsistente from './AgregarAsistente'
import { PagoFoto } from './CashProveedores'

const sup: Supplier = { id: 'p1', name: 'Pescadería del Pacífico', category: null, contact: null, moneda: 'CRC', ciclo_pago: 'Semanal',
  metodo_pago: 'Efectivo', cuenta_iban: '', aliases: null, is_active: true, email: null, whatsapp: null, notificar_pago: 'no',
  created_at: '2026-06-29T00:00:00Z', updated_at: '2026-06-29T00:00:00Z' }
const session = { id: 's1', shift_type: 'AM' } as unknown as CashSession
const subirFoto = () => fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement,
  { target: { files: [new File(['d'], 'f.jpg', { type: 'image/jpeg' })] } })
const monto = () => (screen.getByLabelText('Monto colones') as HTMLInputElement).value
const confirmarBtn = () => screen.findByRole('button', { name: /Confirmar y registrar/ }) as Promise<HTMLButtonElement>
const progreso = () => screen.getByTestId('varias-progreso').textContent
const nuevos = () => tablaDocs.filter(d => d.estado === 'nuevo')

function abrir() {
  const p = { onCreated: vi.fn(), onClose: vi.fn() }
  render(<AgregarAsistente openSession={session} suppliers={[sup]} role="cajero" createdBy="u1" tc={600} {...p} />)
  subirFoto()
  return p
}
async function enFactura(i: number, n: number, total: number) {
  await waitFor(() => expect(progreso()).toBe(i === 1 ? `Esta foto tiene ${n} facturas: las vas a cargar una por una. Factura 1 de ${n}.` : `Factura ${i} de ${n}.`))
  await waitFor(() => expect(monto()).toBe(String(total)))
}

beforeEach(() => { cleanup(); vaciarDocs(); m.reiniciar(); m.crearMov.mockClear(); m.leer.mockReset() })

describe('asistente «Agregar»: varias facturas en una foto, una por una (#149)', () => {
  it('foto con 2 → 2 movimientos y 2 documentos «procesado», cada uno enlazado a SU movimiento; 0 «nuevo»; se cierra al final', async () => {
    m.leer.mockResolvedValue({ documentos: [fac(1, 10000), fac(2, 25000)], fallo: false })
    const p = abrir()
    await enFactura(1, 2, 10000)
    fireEvent.click(await confirmarBtn())
    // NO se cierra: pasa a la 2 con lo de la factura 2 precargado.
    await enFactura(2, 2, 25000)
    expect(p.onClose).not.toHaveBeenCalled()
    expect(p.onCreated).toHaveBeenCalledTimes(1)
    fireEvent.click(await confirmarBtn())
    await waitFor(() => expect(p.onClose).toHaveBeenCalledTimes(1))
    expect(m.crearMov).toHaveBeenCalledTimes(2)
    expect(m.crearMov.mock.calls.map(c => c[0].amount_crc)).toEqual([10000, 25000])
    expect(p.onCreated).toHaveBeenCalledTimes(2)
    expect(tablaDocs.map(d => [d.estado, d.linked_movement_id, d.clave_fe, d.sha256, d.image_path])).toEqual([
      ['procesado', 'mov-1', clave(1), 'sha-varias', 'docs/varias.jpg'],
      ['procesado', 'mov-2', clave(2), 'sha-varias', 'docs/varias.jpg'],
    ])
    expect(nuevos()).toHaveLength(0)
  })

  it('clave FE repetida en la 2 (ya cargada de otra foto) → aviso en el modal y «Saltear esta factura»; no se registra', async () => {
    tablaDocs.push({ id: 'viejo', created_at: '2026-11-12T20:00:00Z', image_path: 'x', sha256: 'otra-foto', estado: 'procesado',
      linked_movement_id: 'mov-viejo', clave_fe: clave(2), tipo: 'factura', raw_json: fac(2, 25000), created_by: 'u1' })
    m.leer.mockResolvedValue({ documentos: [fac(1, 10000), fac(2, 25000)], fallo: false })
    const p = abrir()
    await enFactura(1, 2, 10000)
    fireEvent.click(await confirmarBtn())
    const aviso = await screen.findByTestId('aviso-asistente')
    expect(aviso.textContent).toBe('⚠ Factura 2 de 2: Esta factura (misma clave FE) ya fue cargada (el 12-nov 14:00). No se registró nada. Para volver a cargarla, primero descartá la anterior. Tocá «Saltear esta factura».')
    expect(screen.queryByRole('button', { name: /Confirmar y registrar/ })).toBeNull()   // no se puede registrar
    fireEvent.click(screen.getByRole('button', { name: 'Saltear esta factura' }))
    await screen.findByText('⚠ Se registraron 1 de 2 facturas de la foto. 1 se salteó (no se registró).')
    expect(screen.getByText('✓ Quedó registrada 1 factura.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(p.onClose).toHaveBeenCalledTimes(1)
    expect(m.crearMov).toHaveBeenCalledTimes(1)
    expect(tablaDocs.filter(d => d.linked_movement_id === 'mov-1')).toHaveLength(1)
    expect(tablaDocs).toHaveLength(2)
    expect(nuevos()).toHaveLength(0)
  })

  it('clave FE repetida DENTRO de la misma foto (la IA leyó la misma factura dos veces) → la 2 se ofrece saltear', async () => {
    m.leer.mockResolvedValue({ documentos: [fac(1, 10000), fac(1, 10000)], fallo: false })
    abrir()
    await enFactura(1, 2, 10000)
    fireEvent.click(await confirmarBtn())
    await screen.findByRole('button', { name: 'Saltear esta factura' })
    expect(screen.getByTestId('aviso-asistente').textContent).toMatch(/^⚠ Factura 2 de 2: Esta factura \(misma clave FE\) ya fue cargada/)
    expect(screen.queryByRole('button', { name: /Confirmar y registrar/ })).toBeNull()
    expect(m.crearMov).toHaveBeenCalledTimes(1)
  })

  it('cancelar en la 2 de 3 → pide confirmación dentro del modal; «Salir» no registra la 2 ni la 3 y el aviso final lo dice', async () => {
    m.leer.mockResolvedValue({ documentos: [fac(1, 10000), fac(2, 25000), fac(3, 7000)], fallo: false })
    const p = abrir()
    await enFactura(1, 3, 10000)
    fireEvent.click(await confirmarBtn())
    await enFactura(2, 3, 25000)
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    const pregunta = await screen.findByTestId('confirmar-salida')
    expect(pregunta.textContent).toBe('⚠ Quedan 2 facturas de esta foto sin cargar. ¿Salir igual?')
    expect(pregunta.closest('.cd-modal')).not.toBeNull()
    expect(p.onClose).not.toHaveBeenCalled()
    // «Seguir cargando» vuelve a la 2 con sus datos.
    fireEvent.click(screen.getByRole('button', { name: 'Seguir cargando' }))
    await enFactura(2, 3, 25000)
    // Tocar afuera del modal también pregunta.
    fireEvent.click(document.querySelector('.cd-modal-overlay') as HTMLElement)
    await screen.findByTestId('confirmar-salida')
    fireEvent.click(screen.getByRole('button', { name: 'Salir' }))
    await screen.findByText('⚠ Se registraron 1 de 3 facturas de la foto. 2 no se cargaron: cargalas con ➕ Agregar factura y otra foto (esta ya quedó cargada).')
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(p.onClose).toHaveBeenCalledTimes(1)
    expect(m.crearMov).toHaveBeenCalledTimes(1)
    expect(tablaDocs).toHaveLength(1)
    expect(nuevos()).toHaveLength(0)
  })

  it('doble toque en «Confirmar» (dos toques en el mismo render) → 1 solo movimiento y sigue en la factura 2 sin registrarla', async () => {
    m.leer.mockResolvedValue({ documentos: [fac(1, 10000), fac(2, 25000)], fallo: false })
    const p = abrir()
    await enFactura(1, 2, 10000)
    const btn = await confirmarBtn()
    act(() => { btn.click(); btn.click() })
    await enFactura(2, 2, 25000)
    await new Promise(r => setTimeout(r, 20))
    expect(m.crearMov).toHaveBeenCalledTimes(1)
    expect(tablaDocs).toHaveLength(1)
    expect(p.onClose).not.toHaveBeenCalled()
    // En la última también: dos toques → un movimiento.
    const btn2 = await confirmarBtn()
    act(() => { btn2.click(); btn2.click() })
    await waitFor(() => expect(p.onClose).toHaveBeenCalledTimes(1))
    expect(m.crearMov).toHaveBeenCalledTimes(2)
    expect(tablaDocs.map(d => d.linked_movement_id)).toEqual(['mov-1', 'mov-2'])
  })
})

describe('«➕ Agregar foto» con varias facturas (#149)', () => {
  it('foto con 2 → enlaza SOLO la del pago (total más parecido) y avisa; 0 «nuevo»', async () => {
    m.leer.mockResolvedValue({ documentos: [fac(1, 10000), fac(2, 25000)], fallo: false })
    const mov = { id: 'mov-pago', amount_crc: 25000, amount_usd: 0 } as CashMovement
    const onAdded = vi.fn()
    const { rerender } = render(<PagoFoto movement={mov} doc={null} createdBy="u1" onAdded={onAdded} onRefresh={vi.fn()} />)
    subirFoto()
    await waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1))
    expect(tablaDocs).toHaveLength(1)
    expect(tablaDocs[0]).toMatchObject({ estado: 'procesado', linked_movement_id: 'mov-pago', clave_fe: clave(2) })
    expect(nuevos()).toHaveLength(0)
    rerender(<PagoFoto movement={mov} doc={{ id: tablaDocs[0].id } as never} createdBy="u1" onAdded={onAdded} onRefresh={vi.fn()} />)
    expect(screen.getByRole('alert').textContent).toBe('⚠ La foto tiene 2 facturas: solo se enlazó una; cargá las otras con ➕ Agregar factura.')
  })
})
