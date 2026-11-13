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
//  M6. onPhoto: con foto repetida, bloquear siempre (sin cruzarConFoto) → caen 3 de «misma foto subida otra vez».
//  M7. mostrarFactura: sin la memoria de la pasada (`enEstaPasada` → null) → caen las 2 de «[1]».
//  M8. saltear: sin el candado por índice/ref → cae «[2]».
//  M9. mostrarFactura: volver a borrar la pregunta de salida (`setConfirmarSalida(null)`) → cae «[3]».
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
    subir: vi.fn(async () => ({ path: 'docs/varias.jpg', sha: 'sha-varias' })),
    // Envoltorios de las funciones REALES (para hacerlas fallar o demorar en una prueba).
    crearDoc: vi.fn<(...a: unknown[]) => Promise<unknown>>(),
    porClave: vi.fn<(...a: unknown[]) => Promise<unknown>>(),
    real: {} as Record<string, (...a: unknown[]) => Promise<unknown>>,
    reiniciar: () => { n = 0 },
  }
})
vi.mock('../../shared/api/supabase', async () => ({ supabase: (await import('../../shared/api/documentosEnMemoria.testutil')).supabaseEnMemoria }))
vi.mock('../../shared/api/documents', async (orig) => {
  const actual = await orig<typeof import('../../shared/api/documents')>()
  m.real.crearDoc = actual.createDocumentRow as never
  m.real.porClave = actual.findDuplicateClave as never
  return {
    ...actual,                                    // findDuplicate / findDuplicateClave / findFacturaParecida / createDocumentRow REALES
    sha256File: async () => 'sha-varias',
    uploadImage: m.subir,
    createDocumentRow: (...a: unknown[]) => m.crearDoc(...a),
    findDuplicateClave: (...a: unknown[]) => m.porClave(...a),
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

beforeEach(() => {
  cleanup(); vaciarDocs(); m.reiniciar(); m.crearMov.mockClear(); m.leer.mockReset(); m.subir.mockClear()
  m.crearDoc.mockReset(); m.crearDoc.mockImplementation((...a) => m.real.crearDoc(...a))
  m.porClave.mockReset(); m.porClave.mockImplementation((...a) => m.real.porClave(...a))
})
// Un documento ya cargado de ESTA foto (mismo sha y path), enlazado a un pago que existe.
const yaCargada = (raw: Record<string, unknown>, i: number, over: Record<string, unknown> = {}) => tablaDocs.push({
  id: `prev-${i}`, created_at: '2026-11-12T20:00:00Z', image_path: 'docs/varias.jpg', sha256: 'sha-varias', estado: 'procesado',
  linked_movement_id: `mov-prev-${i}`, clave_fe: (raw.clave_fe as string | null) ?? null, tipo: 'factura', raw_json: raw, created_by: 'u1', ...over })

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
    await screen.findByText('⚠ Se registraron 1 de 3 facturas de la foto. 2 no se cargaron: cargalas con ➕ Agregar factura subiendo la misma foto: te va a ofrecer solo las que faltan.')
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

// (D11 = B, decisión del dueño 13-nov 09:26) La MISMA foto subida otra vez después de cargar solo algunas facturas.
describe('misma foto subida otra vez: ofrece solo las facturas que faltan (D11 = B)', () => {
  it('foto de 3 con 1 registrada → ofrece 2 y registra 2 (3 en total, sin duplicar); no se sube otra vez', async () => {
    yaCargada(fac(1, 10000), 1)
    m.leer.mockResolvedValue({ documentos: [fac(1, 10000), fac(2, 25000), fac(3, 7000)], fallo: false })
    const p = abrir()
    await waitFor(() => expect(progreso()).toBe('Esta foto ya se cargó en parte: 1 de 3 facturas ya están registradas. Te quedan 2: Factura 1 de 2.'))
    await waitFor(() => expect(monto()).toBe('25000'))
    fireEvent.click(await confirmarBtn())
    await enFactura(2, 2, 7000)
    fireEvent.click(await confirmarBtn())
    await waitFor(() => expect(p.onClose).toHaveBeenCalledTimes(1))
    expect(m.subir).not.toHaveBeenCalled()
    expect(m.leer).toHaveBeenCalledWith('docs/varias.jpg')
    expect(m.crearMov).toHaveBeenCalledTimes(2)
    expect(tablaDocs.map(d => [d.clave_fe, d.estado, d.sha256])).toEqual([
      [clave(1), 'procesado', 'sha-varias'], [clave(2), 'procesado', 'sha-varias'], [clave(3), 'procesado', 'sha-varias'],
    ])
    expect(nuevos()).toHaveLength(0)
  })

  it('con las 3 registradas → el bloqueo de siempre; no registra nada', async () => {
    yaCargada(fac(1, 10000), 1); yaCargada(fac(2, 25000), 2); yaCargada(fac(3, 7000), 3)
    m.leer.mockResolvedValue({ documentos: [fac(1, 10000), fac(2, 25000), fac(3, 7000)], fallo: false })
    abrir()
    expect((await screen.findByTestId('aviso-asistente')).textContent).toBe('⚠ Esta foto ya fue cargada (el 12-nov 14:00). No se registró nada. Para volver a cargarla, primero descartá la anterior.')
    expect(screen.queryByRole('button', { name: /Confirmar y registrar/ })).toBeNull()
    expect(m.crearMov).not.toHaveBeenCalled()
    expect(tablaDocs).toHaveLength(3)
  })

  it('factura SIN clave ya registrada → se reconoce por proveedor + número + total y se saltea sola', async () => {
    yaCargada(fac(1, 10000, { clave_fe: null }), 1)
    m.leer.mockResolvedValue({ documentos: [fac(1, 10000, { clave_fe: null }), fac(2, 25000, { clave_fe: null })], fallo: false })
    abrir()
    await waitFor(() => expect(progreso()).toBe('Esta foto ya se cargó en parte: 1 de 2 facturas ya están registradas. Te quedan 1: Factura 1 de 1.'))
    await waitFor(() => expect(monto()).toBe('25000'))
    expect(screen.queryByRole('button', { name: 'Es otra' })).toBeNull()
  })

  it('factura indeterminada (lo cargado antes no se puede comparar) → «Es otra» o «Saltear»; nunca se registra sola', async () => {
    yaCargada({ tipo: 'factura', numero_documento: null, total: null, clave_fe: null }, 1)
    m.leer.mockResolvedValue({ documentos: [fac(1, 10000, { clave_fe: null }), fac(2, 25000, { clave_fe: null })], fallo: false })
    abrir()
    await screen.findByText('⚠ Esta foto ya se había cargado (el 12-nov 14:00) y no se puede saber si esta factura ya está registrada. Si es otra, tocá «Es otra»; si no, «Saltear esta factura».', { exact: false })
    expect(progreso()).toBe('Esta foto ya se había cargado: no se puede saber cuáles de sus 2 facturas ya están registradas. Factura 1 de 2.')
    expect((await confirmarBtn()).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Es otra' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Saltear esta factura' }))
    await enFactura(2, 2, 25000)
    expect(m.crearMov).not.toHaveBeenCalled()
  })

  it('foto de UNA factura repetida → bloquea como antes (no sube, no registra)', async () => {
    yaCargada(fac(1, 10000), 1)
    m.leer.mockResolvedValue({ documentos: [fac(1, 10000)], fallo: false })
    abrir()
    expect((await screen.findByTestId('aviso-asistente')).textContent).toMatch(/^⚠ Esta foto ya fue cargada \(el 12-nov 14:00\)/)
    expect(m.subir).not.toHaveBeenCalled()
    expect(m.crearMov).not.toHaveBeenCalled()
  })
})

// (verificación independiente del #154, head ff12b26)
describe('hallazgos de la verificación del #154', () => {
  it('[1] misma clave FE dos veces en la foto y falla el enlace de la 1 → la 2 igual se detecta (memoria de la pasada); 1 solo pago', async () => {
    m.leer.mockResolvedValue({ documentos: [fac(1, 10000), fac(1, 10000)], fallo: false })
    m.crearDoc.mockRejectedValueOnce(new Error('red'))
    abrir()
    await enFactura(1, 2, 10000)
    fireEvent.click(await confirmarBtn())
    await screen.findByRole('button', { name: 'Saltear esta factura' })
    expect(screen.getByTestId('aviso-asistente').textContent).toBe('⚠ Factura 2 de 2: Esta factura (misma clave FE) ya se registró en esta misma foto. No se va a registrar otra vez: tocá «Saltear esta factura».')
    expect(screen.queryByRole('button', { name: /Confirmar y registrar/ })).toBeNull()
    expect(m.crearMov).toHaveBeenCalledTimes(1)
  })

  it('[1] lo mismo sin clave (parecida) → «Es otra» o «Saltear», «Confirmar» apagado', async () => {
    m.leer.mockResolvedValue({ documentos: [fac(1, 10000, { clave_fe: null }), fac(1, 10000, { clave_fe: null })], fallo: false })
    m.crearDoc.mockRejectedValueOnce(new Error('red'))
    abrir()
    await enFactura(1, 2, 10000)
    fireEvent.click(await confirmarBtn())
    await screen.findByText(/Ya registraste una factura igual en esta misma foto/)
    expect((await confirmarBtn()).disabled).toBe(true)
    expect(m.crearMov).toHaveBeenCalledTimes(1)
  })

  it('[2] doble toque en «Saltear» → saltea UNA; «Quedan» y el resumen dan bien', async () => {
    m.leer.mockResolvedValue({ documentos: [fac(1, 10000), fac(1, 10000), fac(3, 7000)], fallo: false })
    abrir()
    await enFactura(1, 3, 10000)
    fireEvent.click(await confirmarBtn())
    const saltar = await screen.findByRole('button', { name: 'Saltear esta factura' })
    act(() => { saltar.click(); saltar.click() })
    await enFactura(3, 3, 7000)
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect((await screen.findByTestId('confirmar-salida')).textContent).toBe('⚠ Queda 1 factura de esta foto sin cargar. ¿Salir igual?')
    fireEvent.click(screen.getByRole('button', { name: 'Salir' }))
    await screen.findByText('⚠ Se registraron 1 de 3 facturas de la foto. 1 se salteó (no se registró). 1 no se cargó: cargala con ➕ Agregar factura subiendo la misma foto: te va a ofrecer solo la que falta.')
  })

  it('[3] tocar afuera mientras se revisa la próxima → la pregunta de salida no se pierde', async () => {
    m.leer.mockResolvedValue({ documentos: [fac(1, 10000), fac(2, 25000), fac(3, 7000)], fallo: false })
    abrir()
    await enFactura(1, 3, 10000)
    m.porClave.mockImplementation(async (...a) => { await new Promise(r => setTimeout(r, 60)); return m.real.porClave(...a) })
    fireEvent.click(await confirmarBtn())
    await screen.findByText('Revisando la próxima factura…')
    fireEvent.click(document.querySelector('.cd-modal-overlay') as HTMLElement)
    await screen.findByTestId('confirmar-salida')
    await new Promise(r => setTimeout(r, 120))   // la revisión terminó
    expect(screen.getByTestId('confirmar-salida').textContent).toBe('⚠ Quedan 2 facturas de esta foto sin cargar. ¿Salir igual?')
    fireEvent.click(screen.getByRole('button', { name: 'Seguir cargando' }))
    await enFactura(2, 3, 25000)
  })
})
