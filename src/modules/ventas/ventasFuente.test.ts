// Todo del PoS (decisión del dueño, 16-nov-2026): el módulo Ventas y Mi Rendimiento leen SOLO del
// PoS. `ventas_dias` (xls) ya no se lee; `ventas_hist` aporta solo lo anterior al corte del PoS.
//
// Lo que se prueba acá es la CARGA (qué se pide y a quién) y la regla del CORTE. El armado del día
// en sí ya está probado en `ventasDiasDesdePos.test.ts` y en `ventasEnVivoDatos.test.ts`.
import { describe, it, expect, vi, beforeEach } from 'vitest'

import type { DiaData, HistDay, HistMap } from '../../shared/types/ventas'

const api = vi.hoisted(() => ({
  getVentasHist: vi.fn(),
}))
const pos = vi.hoisted(() => ({
  getDiasMapDesdePos: vi.fn(),
  aHistMap:           vi.fn(() => ({})),
}))

vi.mock('../../shared/api/ventas', () => api)
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
const latido = vi.hoisted(() => ({ getLatidoVentas: vi.fn() }))
vi.mock('../../shared/api/posNdf', () => latido)
vi.mock('./ventasDiasDesdePos', () => ({
  ...pos,
  LOCAL_POR_DEFECTO: 'santa-teresa',
}))

const {
  CORTE_POS, DIAS_EAGER, PRIMERA_JORNADA_POS, cargarDeFondo, cargarDias, cargarDiasEager,
  cargarHistEager, combinarHist, fmtDiaMes, ultimoDia, hoyCR, rangoPos, restarDias, ventasDelRango,
} = await import('./ventasFuente')
const apiReal = await vi.importActual<Record<string, unknown>>('../../shared/api/ventas')

/** Un `DiaData` mínimo, con una marca para saber de dónde salió. */
const dia = (marca: string, total = 100_000): DiaData => ({
  fileName: marca, uploadedAt: '2026-09-08',
  saloneros: { TITO: {
    pax: 10, total, com: 0, beb: 0, iCom: 0, iBeb: 0, iva: 0, serv: 0,
    promPax: 0, promPlato: 0, promBebida: 0, ratioCB: 0, ratioU: 0, bebPax: 0, prods: [],
  } },
})

const hd = (ventaNeta: number): HistDay => ({
  ventaBruta: ventaNeta, ventaNeta, iva: 0, serv: 0, salon: ventaNeta, delivery: 0,
  pax: 10, promPax: 0, source: 'hist',
})

beforeEach(() => { vi.clearAllMocks() })

// ── El Excel ya no existe para la app ──────────────────────────────────────────────────────

describe('16-nov · el xls se retiró', () => {
  it('la API ya no ofrece leer, cargar ni borrar `ventas_dias`, ni cargar `ventas_hist`', () => {
    for (const f of ['getVentasDias', 'getAllVentasDias', 'saveVentasDia', 'deleteVentasDia', 'saveVentasHist']) {
      expect(apiReal[f], f).toBeUndefined()
    }
    // El histórico viejo se sigue LEYENDO (solo lo anterior al corte).
    expect(typeof apiReal.getVentasHist).toBe('function')
  })
})

// ── El corte ───────────────────────────────────────────────────────────────────────────────

describe('combinarHist — histórico viejo hasta el día anterior al corte, PoS desde el corte', () => {
  it('el corte es el primer día del PoS leído de prod (2024-01-05)', () => {
    expect(CORTE_POS).toBe('2024-01-05')
    expect(CORTE_POS).toBe(PRIMERA_JORNADA_POS)
  })

  const viejo: HistMap = {
    '2023-06-15': hd(1),
    '2024-01-04': hd(2),       // último día del viejo
    '2024-01-05': hd(3),       // el corte: lo tiene el viejo, pero manda el PoS
    '2025-03-02': hd(4),       // después del corte, sin PoS ese día: NO vuelve el viejo
  }
  const delPos: HistMap = {
    '2024-01-04': hd(90),      // PoS antes del corte (no debería existir): se descarta
    '2024-01-05': hd(91),
    '2026-11-05': hd(92),      // un día sin xls: ahora tiene ventas
  }

  it('cada día viene de UNA sola fuente: sin superposición en el corte', () => {
    const r = combinarHist(viejo, delPos)
    expect(r['2023-06-15'].ventaNeta).toBe(1)
    expect(r['2024-01-04'].ventaNeta).toBe(2)
    expect(r['2024-01-05'].ventaNeta).toBe(91)
    expect(r['2025-03-02']).toBeUndefined()
    expect(r['2026-11-05'].ventaNeta).toBe(92)
    expect(Object.keys(r).sort()).toEqual(['2023-06-15', '2024-01-04', '2024-01-05', '2026-11-05'])
  })

  it('la suma no duplica el día del corte (Σ = viejo antes + PoS desde)', () => {
    const r = combinarHist(viejo, delPos)
    const suma = Object.values(r).reduce((s, d) => s + d.ventaNeta, 0)
    expect(suma).toBe(1 + 2 + 91 + 92)
  })

  it('el día del corte es del PoS aunque el PoS no lo tenga: el viejo nunca lo cubre', () => {
    const r = combinarHist({ '2024-01-04': hd(2), '2024-01-05': hd(3) }, {})
    expect(Object.keys(r)).toEqual(['2024-01-04'])
  })

  it('el corte se puede mover (multi-local: cada local tiene su primer día)', () => {
    const r = combinarHist(viejo, delPos, '2025-01-01')
    expect(r['2024-01-05'].ventaNeta).toBe(3)
    expect(r['2025-03-02']).toBeUndefined()
  })
})

// ── El rango que se le pide al PoS ─────────────────────────────────────────────────────────

describe('rangoPos', () => {
  const AHORA = new Date('2026-09-08T15:00:00Z')   // 09:00 en CR

  it('el eager pide solo los últimos DIAS_EAGER días', () => {
    expect(DIAS_EAGER).toBeLessThanOrEqual(90)
    expect(rangoPos(DIAS_EAGER, AHORA))
      .toEqual({ desde: restarDias('2026-09-08', DIAS_EAGER), hasta: '2026-09-08' })
  })

  it('el full arranca en el primer día del PoS, y un rango largo se recorta ahí', () => {
    expect(rangoPos('todo', AHORA)).toEqual({ desde: PRIMERA_JORNADA_POS, hasta: '2026-09-08' })
    expect(rangoPos(2_000, AHORA).desde).toBe(PRIMERA_JORNADA_POS)
  })

  it('`hasta` es HOY en Costa Rica, no en la zona del navegador', () => {
    expect(hoyCR(new Date('2026-09-09T01:00:00Z'))).toBe('2026-09-08')
    expect(hoyCR(new Date('2026-09-09T05:30:00Z'))).toBe('2026-09-08')   // 23:30 CR
    expect(hoyCR(new Date('2026-09-09T06:30:00Z'))).toBe('2026-09-09')
  })

  it('restarDias cruza meses y años', () => {
    expect(restarDias('2026-03-01', 1)).toBe('2026-02-28')
    expect(restarDias('2026-01-01', 1)).toBe('2025-12-31')
  })
})

// ── Las cargas ─────────────────────────────────────────────────────────────────────────────

describe('cargarDias / eager / fondo — solo PoS', () => {
  const AHORA = new Date('2026-11-17T05:30:00Z')   // 23:30 CR del 16-nov

  it('un día SIN xls (después del 20-oct) ahora tiene ventas: viene del PoS', async () => {
    pos.getDiasMapDesdePos.mockResolvedValue({ dias: { '2026-11-05': dia('pos') }, pm: {} })
    const r = await cargarDias(365, 'santa-teresa', AHORA)
    expect(r.estadoPos).toBe('ok')
    expect(r.dias['2026-11-05'].fileName).toBe('pos')
    expect(pos.getDiasMapDesdePos).toHaveBeenCalledWith(rangoPos(365, AHORA), 'santa-teresa')
  })

  it('devuelve EXACTAMENTE lo del PoS (no fusiona con nada)', async () => {
    const delPos = { '2026-11-15': dia('pos') }
    pos.getDiasMapDesdePos.mockResolvedValue({ dias: delPos, pm: { X: { tipo: 'comida' } } })
    const r = await cargarDiasEager('santa-teresa', AHORA)
    expect(r.dias).toBe(delPos)
    expect(r.pm).toEqual({ X: { tipo: 'comida' } })
    expect(pos.getDiasMapDesdePos).toHaveBeenCalledWith(rangoPos(DIAS_EAGER, AHORA), 'santa-teresa')
  })

  it('filtra por local: el local pedido llega al PoS', async () => {
    pos.getDiasMapDesdePos.mockResolvedValue({ dias: { '2026-11-15': dia('pos') }, pm: {} })
    await cargarDias(30, 'nosara', AHORA)
    expect(pos.getDiasMapDesdePos).toHaveBeenCalledWith(rangoPos(30, AHORA), 'nosara')
  })

  it('el hist del eager es `ventas_hist` SOLO antes del corte, y no toca el PoS', async () => {
    api.getVentasHist.mockResolvedValue({ '2023-06-15': hd(1), '2024-01-04': hd(2), '2024-06-15': hd(3) })
    const r = await cargarHistEager()
    expect(Object.keys(r).sort()).toEqual(['2023-06-15', '2024-01-04'])
    expect(pos.getDiasMapDesdePos).not.toHaveBeenCalled()
  })

  it('el fondo: UN pase por el PoS (rango entero) y hist = viejo antes del corte + PoS desde', async () => {
    pos.getDiasMapDesdePos.mockResolvedValue({ dias: { '2024-06-15': dia('pos') }, pm: {} })
    pos.aHistMap.mockReturnValue({ '2024-01-05': hd(91), '2024-06-15': hd(99) })

    const { dias, hist } = await cargarDeFondo({ '2023-06-15': hd(1), '2024-01-05': hd(2) }, 'santa-teresa', AHORA)

    expect(pos.getDiasMapDesdePos).toHaveBeenCalledTimes(1)
    expect(pos.getDiasMapDesdePos).toHaveBeenCalledWith({ desde: PRIMERA_JORNADA_POS, hasta: '2026-11-16' }, 'santa-teresa')
    expect(Object.keys(dias)).toEqual(['2024-06-15'])
    expect(hist['2023-06-15'].ventaNeta).toBe(1)
    expect(hist['2024-01-05'].ventaNeta).toBe(91)    // el corte: manda el PoS
    expect(hist['2024-06-15'].ventaNeta).toBe(99)
  })

  it('el eager y el fondo dan lo mismo en las fechas que comparten', async () => {
    const delPos = { '2026-11-07': dia('pos', 123_456) }
    pos.getDiasMapDesdePos.mockResolvedValue({ dias: delPos, pm: {} })
    const eager = (await cargarDiasEager('santa-teresa', AHORA)).dias
    const full  = (await cargarDeFondo({}, 'santa-teresa', AHORA)).dias
    expect(eager['2026-11-07']).toEqual(full['2026-11-07'])
  })
})

describe('ventasDelRango — la lectura de las pantallas de un día / semana / mes', () => {
  it('pide al PoS el rango y el local, tal cual', async () => {
    pos.getDiasMapDesdePos.mockResolvedValue({ dias: { '2026-11-05': dia('pos') }, pm: {} })
    const r = await ventasDelRango('2026-11-01', '2026-11-30', 'santa-teresa')
    expect(pos.getDiasMapDesdePos).toHaveBeenCalledWith({ desde: '2026-11-01', hasta: '2026-11-30' }, 'santa-teresa')
    expect(r.dias['2026-11-05'].fileName).toBe('pos')
  })

  it('antes del corte no hay PoS: se recorta, y un rango entero anterior no consulta nada', async () => {
    pos.getDiasMapDesdePos.mockResolvedValue({ dias: {}, pm: {} })
    await ventasDelRango('2023-12-01', '2024-01-31')
    expect(pos.getDiasMapDesdePos).toHaveBeenCalledWith({ desde: CORTE_POS, hasta: '2024-01-31' }, 'santa-teresa')
    vi.clearAllMocks()
    expect(await ventasDelRango('2023-06-01', '2023-06-30')).toEqual({ dias: {}, pm: {} })
    expect(pos.getDiasMapDesdePos).not.toHaveBeenCalled()
  })
})

// ── El estado del PoS: sin respaldo, nunca un número viejo ─────────────────────────────────

describe('cargarDias — estadoPos', () => {
  const AHORA = new Date('2026-10-30T18:00:00Z')
  let warn: ReturnType<typeof vi.spyOn>
  beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}) })

  it("'ok': el PoS trae días, sin latido ni warn", async () => {
    pos.getDiasMapDesdePos.mockResolvedValue({ dias: { '2026-10-28': dia('pos') }, pm: {} })
    const r = await cargarDias(365, 'santa-teresa', AHORA)
    expect(r.estadoPos).toBe('ok')
    expect(latido.getLatidoVentas).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it("'sin_acceso': PoS vacío y latido sin fila → vacío + warn", async () => {
    pos.getDiasMapDesdePos.mockResolvedValue({ dias: {}, pm: {} })
    latido.getLatidoVentas.mockResolvedValue({ acceso: false, ultimoPollAt: null })
    const r = await cargarDias(365, 'santa-teresa', AHORA)
    expect(r).toEqual({ dias: {}, pm: {}, estadoPos: 'sin_acceso' })
    expect(warn).toHaveBeenCalledWith('[ventas] PoS sin_acceso: sin ventas que mostrar')
  })

  it("'vacio': PoS vacío pero el latido responde", async () => {
    pos.getDiasMapDesdePos.mockResolvedValue({ dias: {}, pm: {} })
    latido.getLatidoVentas.mockResolvedValue({ acceso: true, ultimoPollAt: '2026-10-30T17:59:00Z' })
    expect((await cargarDias(365, 'santa-teresa', AHORA)).estadoPos).toBe('vacio')
  })

  it("'error': la lectura falla → vacío (no hay Excel al que caer)", async () => {
    pos.getDiasMapDesdePos.mockRejectedValue(new Error('timeout'))
    const r = await cargarDias(365, 'santa-teresa', AHORA)
    expect(r).toEqual({ dias: {}, pm: {}, estadoPos: 'error' })
  })

  it("'error' también si falla el latido", async () => {
    pos.getDiasMapDesdePos.mockResolvedValue({ dias: {}, pm: {} })
    latido.getLatidoVentas.mockRejectedValue(new Error('rpc'))
    expect((await cargarDias(365, 'santa-teresa', AHORA)).estadoPos).toBe('error')
  })

  it('ultimoDia / fmtDiaMes', () => {
    expect(ultimoDia({})).toBeNull()
    expect(ultimoDia({ '2026-10-19': dia('a'), '2026-10-20': dia('b') })).toBe('2026-10-20')
    expect(fmtDiaMes('2026-10-20')).toBe('20/10')
    expect(fmtDiaMes(null)).toBe('—')
  })
})
