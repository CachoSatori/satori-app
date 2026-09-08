// P2 — el swap de fuente: el módulo Ventas pasa a leer del PoS, con el Excel de respaldo.
//
// Lo que se prueba acá es la REGLA DE FUSIÓN y el rango que se le pide al PoS. El armado del
// día en sí ya está probado en `ventasDiasDesdePos.test.ts` (P1b) y en
// `ventasEnVivoDatos.test.ts`; esto es la capa que decide quién gana en cada fecha.
import { describe, it, expect, vi, beforeEach } from 'vitest'

import type { DiaData, DiasMap, HistDay, HistMap } from '../../shared/types/ventas'

const api = vi.hoisted(() => ({
  getVentasDias:    vi.fn(),
  getAllVentasDias: vi.fn(),
  getVentasHist:    vi.fn(),
}))
const pos = vi.hoisted(() => ({
  getDiasMapDesdePos: vi.fn(),
  getHistDesdePos:    vi.fn(),
}))

vi.mock('../../shared/api/ventas', () => api)
vi.mock('./ventasDiasDesdePos', () => ({
  ...pos,
  LOCAL_POR_DEFECTO: 'santa-teresa',
}))

const {
  DIAS_EAGER, PRIMERA_JORNADA_POS, cargarDiasEager, cargarDiasFull, cargarHist,
  fusionarDias, fusionarHist, hoyCR, rangoPos, restarDias,
} = await import('./ventasFuente')

/** Un `DiaData` mínimo, con una marca para saber de qué fuente salió. */
const dia = (marca: string, total = 100_000): DiaData => ({
  fileName: marca, uploadedAt: '2026-09-08',
  saloneros: { MAXO: {
    pax: 10, total, com: 0, beb: 0, iCom: 0, iBeb: 0, iva: 0, serv: 0,
    promPax: 0, promPlato: 0, promBebida: 0, ratioCB: 0, ratioU: 0, bebPax: 0, prods: [],
  } },
})

const hd = (ventaNeta: number): HistDay => ({
  ventaBruta: ventaNeta, ventaNeta, iva: 0, serv: 0, salon: ventaNeta, delivery: 0,
  pax: 10, promPax: 0, source: 'hist',
})

beforeEach(() => { vi.clearAllMocks() })

// ── La regla ───────────────────────────────────────────────────────────────────────────────

describe('fusionarDias — el PoS se SUPERPONE al Excel, no lo reemplaza', () => {
  const xls: DiasMap = {
    '2023-06-15': dia('xls 2023'),          // el PoS no existía
    '2025-03-02': dia('xls 2025'),          // hay las dos: gana el PoS
    '2025-03-03': dia('xls sin lote'),      // el PoS no tiene lote de ese día
  }
  const delPos: DiasMap = { '2025-03-02': dia('pos 2025') }

  it('2023 queda INTACTO: es el año que el PoS no cubre', () => {
    expect(fusionarDias(xls, delPos)['2023-06-15'].fileName).toBe('xls 2023')
  })

  it('donde hay lote del PoS, el PoS pisa', () => {
    expect(fusionarDias(xls, delPos)['2025-03-02'].fileName).toBe('pos 2025')
  })

  it('una jornada sin lote del PoS se sigue sirviendo del Excel — sin huecos', () => {
    expect(fusionarDias(xls, delPos)['2025-03-03'].fileName).toBe('xls sin lote')
  })

  it('no se pierde ni se inventa ninguna fecha', () => {
    expect(Object.keys(fusionarDias(xls, delPos)).sort())
      .toEqual(['2023-06-15', '2025-03-02', '2025-03-03'])
  })

  it('una jornada que solo tiene el PoS entra igual', () => {
    expect(fusionarDias({}, { '2026-09-07': dia('pos') })['2026-09-07']).toBeDefined()
  })

  it('no muta ninguno de los dos mapas de entrada', () => {
    const a = { ...xls }, b = { ...delPos }
    fusionarDias(xls, delPos)
    expect(xls).toEqual(a)
    expect(delPos).toEqual(b)
  })
})

describe('fusionarHist — misma regla para el histórico', () => {
  it('2023 del Excel sobrevive y de 2024 en adelante manda el PoS', () => {
    const xls: HistMap = { '2023-06-15': hd(1), '2024-06-15': hd(2) }
    const r = fusionarHist(xls, { '2024-06-15': hd(99) })
    expect(r['2023-06-15'].ventaNeta).toBe(1)
    expect(r['2024-06-15'].ventaNeta).toBe(99)
  })
})

// ── El rango que se le pide al PoS ─────────────────────────────────────────────────────────

describe('rangoPos — en JORNADAS, y nunca antes de que el PoS exista', () => {
  const AHORA = new Date('2026-09-08T15:00:00Z')   // 09:00 en CR

  it('el eager pide los últimos 400 días', () => {
    expect(rangoPos(DIAS_EAGER, AHORA)).toEqual({ desde: '2025-08-04', hasta: '2026-09-08' })
  })

  it('el full arranca en la primera jornada del PoS, no en 2023', () => {
    // Pedir 2023 serían viajes al pedo: ahí no hay una sola fila que traer.
    expect(rangoPos('todo', AHORA)).toEqual({ desde: PRIMERA_JORNADA_POS, hasta: '2026-09-08' })
    expect(PRIMERA_JORNADA_POS >= '2024-01-01').toBe(true)
  })

  it('un rango largo se recorta a la primera jornada del PoS', () => {
    expect(rangoPos(2_000, AHORA).desde).toBe(PRIMERA_JORNADA_POS)
  })

  it('`hasta` es HOY en Costa Rica, no en la zona del navegador', () => {
    // 01:00 UTC del 9 son las 19:00 CR del 8: la jornada sigue siendo la del 8.
    expect(hoyCR(new Date('2026-09-09T01:00:00Z'))).toBe('2026-09-08')
    expect(hoyCR(new Date('2026-09-09T06:30:00Z'))).toBe('2026-09-09')
  })

  it('restarDias cruza meses y años', () => {
    expect(restarDias('2026-03-01', 1)).toBe('2026-02-28')
    expect(restarDias('2026-01-01', 1)).toBe('2025-12-31')
  })
})

// ── Las cargas ─────────────────────────────────────────────────────────────────────────────

describe('cargarDiasEager / cargarDiasFull / cargarHist', () => {
  const AHORA = new Date('2026-09-08T15:00:00Z')

  it('el eager fusiona el Excel con el PoS', async () => {
    api.getVentasDias.mockResolvedValue({ '2023-06-15': dia('xls'), '2026-09-07': dia('xls') })
    pos.getDiasMapDesdePos.mockResolvedValue({ '2026-09-07': dia('pos') })

    const r = await cargarDiasEager('pos', 'santa-teresa', AHORA)

    expect(r['2023-06-15'].fileName).toBe('xls')
    expect(r['2026-09-07'].fileName).toBe('pos')
    expect(api.getVentasDias).toHaveBeenCalledWith(DIAS_EAGER)
  })

  it('el full pide el rango entero del PoS y fusiona igual', async () => {
    api.getAllVentasDias.mockResolvedValue({ '2023-01-01': dia('xls') })
    pos.getDiasMapDesdePos.mockResolvedValue({ '2024-05-05': dia('pos') })

    const r = await cargarDiasFull('pos', 'santa-teresa', AHORA)

    expect(Object.keys(r).sort()).toEqual(['2023-01-01', '2024-05-05'])
    expect(pos.getDiasMapDesdePos).toHaveBeenCalledWith(
      { desde: PRIMERA_JORNADA_POS, hasta: '2026-09-08' }, 'santa-teresa')
  })

  it('el hist fusiona `ventas_hist` con el HistMap del PoS', async () => {
    api.getVentasHist.mockResolvedValue({ '2023-06-15': hd(1), '2024-06-15': hd(2) })
    pos.getHistDesdePos.mockResolvedValue({ '2024-06-15': hd(99) })

    const r = await cargarHist('pos', 'santa-teresa', AHORA)

    expect(r['2023-06-15'].ventaNeta).toBe(1)
    expect(r['2024-06-15'].ventaNeta).toBe(99)
  })
})

describe("FUENTE_VENTAS = 'xls' — el camino viejo, intacto", () => {
  const AHORA = new Date('2026-09-08T15:00:00Z')

  it('devuelve el Excel tal cual y NO consulta el PoS', async () => {
    const soloXls = { '2026-09-07': dia('xls') }
    api.getVentasDias.mockResolvedValue(soloXls)
    api.getAllVentasDias.mockResolvedValue(soloXls)
    api.getVentasHist.mockResolvedValue({ '2026-09-07': hd(1) })

    expect(await cargarDiasEager('xls', 'santa-teresa', AHORA)).toBe(soloXls)
    expect(await cargarDiasFull('xls', 'santa-teresa', AHORA)).toBe(soloXls)
    expect((await cargarHist('xls', 'santa-teresa', AHORA))['2026-09-07'].ventaNeta).toBe(1)

    // La aserción que importa: con el flag en `xls` no se pisa `pos_ndf_*` ni una vez.
    expect(pos.getDiasMapDesdePos).not.toHaveBeenCalled()
    expect(pos.getHistDesdePos).not.toHaveBeenCalled()
  })
})

// ── Eager == full en las fechas que se solapan ─────────────────────────────────────────────

describe('el eager y el full no se pelean', () => {
  it('la MISMA función de fusión decide en los dos, así que una fecha da lo mismo', async () => {
    const AHORA = new Date('2026-09-08T15:00:00Z')
    const delPos = { '2026-09-07': dia('pos', 123_456) }

    api.getVentasDias.mockResolvedValue({ '2026-09-07': dia('xls', 999) })
    api.getAllVentasDias.mockResolvedValue({ '2023-01-01': dia('xls'), '2026-09-07': dia('xls', 999) })
    pos.getDiasMapDesdePos.mockResolvedValue(delPos)

    const eager = await cargarDiasEager('pos', 'santa-teresa', AHORA)
    const full  = await cargarDiasFull('pos', 'santa-teresa', AHORA)

    // Si el eager y el full usaran fusiones distintas, «Hoy» y «Análisis» mostrarían números
    // distintos de la misma fecha y algo saltaría al terminar de cargar el full.
    expect(eager['2026-09-07']).toEqual(full['2026-09-07'])
    // Y el full agrega historia sin tocar lo que el eager ya mostraba.
    expect(full['2023-01-01']).toBeDefined()
  })
})
