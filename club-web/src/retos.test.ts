// Mig 169: lectura y textos del reto de temporada baja en «Mi Club» (en «usted», ES/EN; datos raros no se muestran).
import { describe, it, expect } from 'vitest'
import { TEXTOS } from './i18n'
import { leerRetos, textosReto, cuando } from './retos'

const base = { nombre: '3 almuerzos este mes', nombre_en: '3 lunches this month', desde: '2026-12-01', hasta: '2026-12-31',
  dias: [1, 2, 3, 4, 5], hora_desde: '11:30', hora_hasta: '15:00', meta: 3, avance: 1, ganada: false, vence_en: null,
  locales: ['Local Ficticio'] }
const f = (d: string) => d   // fecha tal cual (lo formatea el portal)

describe('club-web · retos (mig 169)', () => {
  it('lee un reto válido y descarta los raros (avance > meta, sin fechas, ganado sin vencimiento, horas a medias)', () => {
    const l = leerRetos({ retos: [base, { ...base, avance: 4 }, { ...base, desde: 'x' }, { ...base, ganada: true },
      { ...base, hora_hasta: null }, { ...base, dias: [] }, null, 'x'] })
    expect(l).toHaveLength(1)
    expect(leerRetos(null)).toEqual([])
    expect(leerRetos({ retos: 'x' })).toEqual([])
  })

  it('en curso: «Visita 1 de 3», días, franja, local y fecha de fin, en «usted»', () => {
    const [r] = leerRetos({ retos: [base] })
    const x = textosReto(r, TEXTOS.es, 'es', f, '2026-12-05')
    expect(x.principal).toBe('Visita 1 de 3')
    expect(x.detalle).toBe('Visítenos 3 veces de lunes a viernes de 11:30 a 15:00 en Local Ficticio hasta el 2026-12-31 y le regalamos una cortesía.')
    expect(x.titulo).toBe('3 almuerzos este mes')
  })

  it('por empezar: avisa la fecha de inicio · en inglés usa nombre_en', () => {
    const [r] = leerRetos({ retos: [base] })
    expect(textosReto(r, TEXTOS.es, 'es', f, '2026-11-20').detalle).toMatch(/Empieza el 2026-12-01\.$/)
    const en = textosReto(r, TEXTOS.en, 'en', f, '2026-12-05')
    expect(en.titulo).toBe('3 lunches this month')
    expect(en.principal).toBe('Visit 1 of 3')
    expect(en.detalle).toContain('Monday to Friday from 11:30 to 15:00 at Local Ficticio')
  })

  it('ganado: muestra la cortesía y hasta cuándo vale (barra llena)', () => {
    const [r] = leerRetos({ retos: [{ ...base, ganada: true, vence_en: '2027-01-10', avance: 3 }] })
    const x = textosReto(r, TEXTOS.es, 'es', f, '2026-12-20')
    expect(x.ganada).toBe(true)
    expect(x.avance).toBe(3)
    expect(x.detalle).toBe('Muestre su QR de socio en caja en su próxima visita (vale hasta el 2027-01-10).')
  })

  it('días: todos, sueltos y fin de semana', () => {
    const [r] = leerRetos({ retos: [base] })
    expect(cuando({ ...r, dias: [1, 2, 3, 4, 5, 6, 7], hora_desde: null, hora_hasta: null }, TEXTOS.es)).toBe('cualquier día')
    expect(cuando({ ...r, dias: [6, 7], hora_desde: null, hora_hasta: null }, TEXTOS.es)).toBe('los sábados y domingos')
    expect(cuando({ ...r, dias: [2], hora_desde: null, hora_hasta: null }, TEXTOS.en)).toBe('on Tuesdays')
  })
})
