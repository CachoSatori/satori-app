import { describe, it, expect, vi, afterEach } from 'vitest'
import { feProviderSim, buildSimConsecutivo, buildSimClave } from './feProvider'

describe('feProvider SIM — emisión simulada (NO llama a Hacienda)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('emite estado=emitido con provider_ref emitido-sim, sin fetch externo', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as never)
    const r = await feProviderSim.emitir({
      tipo: 'tiquete', total_neto: 10000, total_iva: 1300, total_servicio: 1000, total: 12300,
    })
    expect(r.estado).toBe('emitido')
    expect(r.provider).toBe('sim')
    expect(r.provider_ref).toBe('emitido-sim')
    expect(r.error_msg).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()       // 🔒 jamás contacta un servicio externo
  })

  it('consecutivo de 20 dígitos y clave de 50 dígitos', async () => {
    const r = await feProviderSim.emitir({ tipo: 'tiquete', total_neto: 0, total_iva: 0, total_servicio: 0, total: 0 })
    expect(r.consecutivo).toMatch(/^\d{20}$/)
    expect(r.clave).toMatch(/^\d{50}$/)
  })
})

describe('buildSimConsecutivo / buildSimClave — puros y deterministas', () => {
  it('consecutivo: tiquete usa tipo 04, factura usa 01; mismo seed = mismo valor', () => {
    expect(buildSimConsecutivo('tiquete', 7).slice(8, 10)).toBe('04')
    expect(buildSimConsecutivo('factura', 7).slice(8, 10)).toBe('01')
    expect(buildSimConsecutivo('tiquete', 7)).toBe(buildSimConsecutivo('tiquete', 7))
    expect(buildSimConsecutivo('tiquete', 7)).toHaveLength(20)
  })
  it('clave: 50 dígitos, empieza con 506 (CR) y contiene el consecutivo', () => {
    const cons = buildSimConsecutivo('tiquete', 42)
    const clave = buildSimClave(cons, 42, new Date('2026-06-13T12:00:00Z'))
    expect(clave).toHaveLength(50)
    expect(clave.startsWith('506')).toBe(true)
    expect(clave).toContain(cons)
  })
})
