import { describe, it, expect } from 'vitest'
import { reporteHtml, reporteCsv, nombreMes } from './reporteHtml'
import type { ReporteMes, FilaReporte } from '../../shared/api/club'

const fila = (i: number, extra: Partial<FilaReporte> = {}): FilaReporte =>
  ({ nombre: `Referente con un nombre bastante largo ${i}`, negocio: `Hotel de prueba ${i}`, tipo: 'referente', personas: 10 - i, prom_3m: 4, creditos: 3, ultima_actividad: '2025-01-10T12:00:00Z', ...extra })

const rep: ReporteMes = {
  mes: '2026-10', local: 'santa-teresa', generado_en: '2026-11-05T12:00:00Z',
  config: { valor_credito_crc: 18000, personas_por_credito: 6, vencimiento_meses: 12, pm_pausado: true },
  kpis: { tarjetas: 31, personas: 84, creditos_generados: 14, canjes: 6, creditos_canjeados: 7.5, valor_canjeado_crc: 135000, personas_vencidas: 0,
          referentes_con_visitas: 12, cupones_generados: 40, cupones_usados: 25, saldo_creditos_al_cierre: 148, cuentas_con_saldo: 120,
          anterior: { tarjetas: 20, personas: 50, canjes: 10, creditos_canjeados: 17 } },
  ranking: Array.from({ length: 12 }, (_, i) => fila(i)), subiendo: [fila(1, { nuevo_ritmo: true, prom_3m: 0 })], bajando: [fila(2)],
  a_contactar: [fila(3, { vence_en: '2026-11-30T12:00:00Z' })],
  dormidos: { cuentas: 105, creditos: 105.5, lista: Array.from({ length: 30 }, (_, i) => fila(i)) },
  nuevos: { cuentas: 8, lista: Array.from({ length: 8 }, (_, i) => fila(i)) },
  equipo: { personas_mes: 0, creditos: 27.5, lista: Array.from({ length: 8 }, (_, i) => fila(i, { tipo: 'equipo' })) },
  antiguedad: [{ tramo: 'menos de 3 meses', cuentas: 16, creditos: 28.5, valor_crc: 513000 }],
  pm: { pausado: true, nota: 'Programa PM en pausa.', pendiente_crc: 300873.23, cargos_mes_crc: 0, pagos_mes_crc: 0 },
  calidad: { abiertas: 3, resueltas: 0, por_tipo: { CREDITOS_SIN_CANJE: 3 }, promo_activa: false },
}

describe('reporte mensual (ESTANDAR-reportes)', () => {
  const html = reporteHtml(rep)
  it('3 páginas A4 con pie «n de 3» y fuentes incrustadas', () => {
    expect(html.match(/class="pagina"/g)).toHaveLength(3)
    expect(html).toContain('3 de 3')
    expect(html).toMatch(/@font-face\{font-family:'Cormorant Garamond'/)
    expect(html).toContain('size:A4')
  })
  it('máximo 10 filas por tabla y nada truncado con «…»', () => {
    const filas = [...html.matchAll(/<tbody>(.*?)<\/tbody>/gs)].map(m => (m[1].match(/<tr>/g) ?? []).length)
    expect(Math.max(...filas)).toBeLessThanOrEqual(10)
    expect(html).not.toContain('…')
  })
  it('formatos: punto de miles, coma decimal, ₡ pegado, % con espacio', () => {
    expect(html).toContain('₡135.000')
    expect(html).toContain('7,5')
    expect(html).toMatch(/\+68 % vs\. 50/)
  })
  it('el CSV trae todas las filas (30 dormidos) y ningún contacto', () => {
    const csv = reporteCsv(rep)
    expect(csv.split('\r\n').filter(l => l.startsWith('"dormidos"'))).toHaveLength(30)
    expect(csv).not.toMatch(/@|\+506/)
  })
  it('nombre del mes en minúscula', () => { expect(nombreMes('2026-10')).toBe('octubre 2026') })
})
