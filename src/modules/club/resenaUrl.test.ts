// 158 · Link de reseña: solo direcciones de Google (igual que el CHECK de la base y que club-web/src/resena.ts).
import { describe, it, expect } from 'vitest'
import { normalizarResenaUrl } from './resenaUrl'

describe('normalizarResenaUrl', () => {
  it('acepta las cuatro formas de Google y quita espacios alrededor', () => {
    expect(normalizarResenaUrl(' https://maps.app.goo.gl/Ficticio1 ')).toBe('https://maps.app.goo.gl/Ficticio1')
    expect(normalizarResenaUrl('https://g.page/r/FICTICIO/review')).toBe('https://g.page/r/FICTICIO/review')
    expect(normalizarResenaUrl('https://www.google.com/maps/place/Ficticio')).toBe('https://www.google.com/maps/place/Ficticio')
    expect(normalizarResenaUrl('https://search.google.com/local/writereview?placeid=FICTICIO')).toBe('https://search.google.com/local/writereview?placeid=FICTICIO')
  })
  it('vacío = null (sin link)', () => {
    expect(normalizarResenaUrl('   ')).toBeNull()
  })
  it('rechaza lo que no es Google, http, dominios parecidos, espacios y > 500', () => {
    for (const u of ['http://g.page/r/x', 'https://ejemplo.test/maps', 'https://google.com.ejemplo.test/maps',
                     'https://google.com@ejemplo.test/maps', 'https://g.page/r/x y', 'javascript:alert(1)',
                     'https://g.page/' + 'a'.repeat(500)]) {
      expect(() => normalizarResenaUrl(u), u.slice(0, 40)).toThrow(/tiene que ser de Google/)
    }
  })
})
