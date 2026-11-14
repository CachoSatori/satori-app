// 166 · Campañas con grupo de control: textos, % reservado y CSV.
import { describe, it, expect } from 'vitest'
import { REGLA_BENEFICIO_BASE, pctReserva, avisoNoConcluyente, filasReporte, campanaCsv } from './campanaFormato'
import type { GrupoReporte } from '../../shared/api/club'

const g = (o: Partial<GrupoReporte> = {}): GrupoReporte => ({
  miembros: 0, con_visita: 0, con_visita_pct: null, visitas: 0, visitas_por_miembro: null, facturas: 0,
  venta_respaldada_crc: 0, venta_por_miembro_crc: null, ...o,
})

describe('campanaFormato', () => {
  it('la regla dice que el beneficio base no se toca y solo falta el extra', () => {
    expect(REGLA_BENEFICIO_BASE).toMatch(/no se le quita nada/)
    expect(REGLA_BENEFICIO_BASE).toMatch(/10 % o 15 %/)
    expect(REGLA_BENEFICIO_BASE).toMatch(/cortesía/)
    expect(REGLA_BENEFICIO_BASE).toMatch(/Solo no recibe el mensaje/)
  })
  it('% reservado: de 0 a 50, con coma o punto; fuera de rango o vacío → null', () => {
    expect(pctReserva('15')).toBe(15)
    expect(pctReserva('12,5')).toBe(12.5)
    expect(pctReserva('0')).toBe(0)
    expect(pctReserva('50')).toBe(50)
    expect(pctReserva('51')).toBeNull()
    expect(pctReserva('-1')).toBeNull()
    expect(pctReserva('')).toBeNull()
    expect(pctReserva('abc')).toBeNull()
  })
  it('aviso honesto: dice el tamaño de cada grupo y el mínimo; sin aviso si la base dice que alcanza', () => {
    const r = { no_concluyente: true, umbral_minimo: 30, oferta: g({ miembros: 9 }), control: g({ miembros: 2 }) }
    expect(avisoNoConcluyente(r)).toBe('Con 9 con oferta y 2 reservados, la diferencia no es concluyente: puede ser casualidad. ' +
      'Para empezar a confiar hacen falta al menos 30 en cada grupo.')
    expect(avisoNoConcluyente({ ...r, no_concluyente: false })).toBeNull()
    expect(avisoNoConcluyente({ ...r, control: g({ miembros: 0 }) })).toMatch(/no reservó a nadie/)
  })
  it('tabla del reporte: con oferta y reservados lado a lado; null → «—», nunca 0', () => {
    const f = filasReporte({ oferta: g({ miembros: 40, con_visita: 10, con_visita_pct: 25, venta_respaldada_crc: 90000, venta_por_miembro_crc: 2250 }),
                             control: g({ miembros: 0 }) })
    expect(f.find(x => x[0] === 'Miembros')).toEqual(['Miembros', '40', '0'])
    expect(f.find(x => x[0] === 'Volvieron en 30 días')).toEqual(['Volvieron en 30 días', '10 (25 %)', '0 (—)'])
    expect(f.find(x => x[0] === 'Venta por miembro')).toEqual(['Venta por miembro', '₡2.250', '—'])
  })
  it('CSV: «vence» en el día de Costa Rica (20:00 CR = 02:00 UTC del día siguiente)', () => {
    const csv = campanaCsv([{ miembro_id: 'm1', nombre: 'Prueba Noche', negocio: null, tipo: 'referente', estado: 'activo', creditos: 1,
      vence_en: '2026-12-02T02:00:00Z' }])
    expect(csv).toContain('"2026-12-01"')
    expect(csv).not.toContain('2026-12-02')
  })
  it('CSV: cabecera, una fila por miembro, WhatsApp como texto y fórmulas neutralizadas', () => {
    const csv = campanaCsv([
      { miembro_id: 'm1', nombre: 'Prueba Uno', negocio: 'Hotel Prueba', tipo: 'referente', estado: 'activo', creditos: 1.5,
        vence_en: '2026-12-01T12:00:00Z', whatsapp: '+50600000000', email: null },
      { miembro_id: 'm2', nombre: '=HYPERLINK("x")', negocio: null, tipo: 'concierge_pm', estado: 'activo', creditos: 1, vence_en: null },
    ])
    const [cab, f1, f2] = csv.replace('﻿', '').split('\r\n')
    expect(cab).toBe('nombre;negocio;tipo;creditos;vence;whatsapp;email')
    expect(f1).toBe('"Prueba Uno";"Hotel Prueba";"referente";"1.5";"2026-12-01";"\'+50600000000";""')
    expect(f2.startsWith('"\'=HYPERLINK')).toBe(true)
    expect(csv.split('\r\n')).toHaveLength(3)
  })
})
