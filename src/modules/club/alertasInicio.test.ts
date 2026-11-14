// 164 (SPEC-club-v2 ítem 10, B6): cada aviso del Inicio se entiende sin explicación. Datos ficticios.
import { describe, it, expect } from 'vitest'
import { avisoClub, rutaClub } from './alertasInicio'
import type { AlertaInicio } from '../../shared/api/club'

const base = { ref: 'r', fecha: '2001-03-01T12:00:00Z' }
const a = (x: Partial<AlertaInicio>): AlertaInicio => ({ ...base, tipo: 'ANFITRION_24H', cantidad: 6, umbral: 5, detalle: {}, ...x } as AlertaInicio)

describe('avisoClub', () => {
  it('(a) anfitrión: nombre, cuántas en 24 h, el umbral y su ficha', () => {
    const v = avisoClub(a({ detalle: { miembro_id: 'm1', miembro: 'Hotel Ficticio', tipo_miembro: 'concierge_pm' } }))
    expect(v.titulo).toBe('Hotel Ficticio sumó 6 visitas con cupón o tarjeta en 24 horas')
    expect(v.texto).toContain('más de 5')
    expect(v.estado).toBe('6 en 24 h')
    expect(v.path).toBe('/club?vista=miembros&miembro=m1')
  })
  it('(a) del equipo lo dice', () => {
    expect(avisoClub(a({ detalle: { miembro: 'Persona Ficticia', tipo_miembro: 'equipo' } })).titulo).toMatch(/^Persona Ficticia \(equipo\) sumó/)
  })
  it('(a) sin miembro_id: va a Miembros igual; sin nombre: «Sin nombre»', () => {
    const v = avisoClub(a({ detalle: {} }))
    expect(v.path).toBe('/club?vista=miembros')
    expect(v.titulo).toMatch(/^Sin nombre sumó/)
  })
  it('(b) socio: quién registró a quién, cuántas veces en cuántos días → Reportes', () => {
    const v = avisoClub(a({ tipo: 'MISMO_USUARIO', cantidad: 3, umbral: 2,
      detalle: { miembro_id: 'm2', miembro: 'Socio Ficticio', que: 'socio', usuario: 'Cajero Ficticio', dias: 1 } }))
    expect(v.titulo).toBe('Cajero Ficticio registró al socio Socio Ficticio 3 veces en 1 día')
    expect(v.texto).toContain('Visitas de socios por usuario')
    expect(v.path).toBe('/club?vista=reportes')
  })
  it('(b) equipo: tarjetas cargadas por el mismo usuario → ficha del del equipo', () => {
    const v = avisoClub(a({ tipo: 'MISMO_USUARIO', cantidad: 4, umbral: 2,
      detalle: { miembro_id: 'm3', miembro: 'Equipo Ficticio', que: 'equipo', usuario: 'Cajero Ficticio', dias: 3 } }))
    expect(v.titulo).toBe('Cajero Ficticio cargó 4 tarjetas de Equipo Ficticio (equipo) en 3 días')
    expect(v.texto).toContain('ranking del equipo')
    expect(v.path).toBe('/club?vista=miembros&miembro=m3')
  })
  it('(c) visitas sin factura: singular y plural', () => {
    expect(avisoClub(a({ tipo: 'VISITAS_SIN_FACTURA', cantidad: 1, umbral: 0 })).titulo).toBe('1 visita de socio sin factura (ayer y hoy)')
    expect(avisoClub(a({ tipo: 'VISITAS_SIN_FACTURA', cantidad: 3, umbral: 0 })).estado).toBe('3 visitas')
  })
  it('(d) canjes sin código → Excepciones filtradas por ese tipo', () => {
    const v = avisoClub(a({ tipo: 'CANJE_SIN_CODIGO', cantidad: 2, umbral: 0 }))
    expect(v.titulo).toBe('2 canjes sin código sin resolver')
    expect(v.path).toBe('/club?vista=excepciones&tipo=CANJE_SIN_CODIGO')
  })
  it('rutaClub codifica los parámetros', () => {
    expect(rutaClub('miembros', { miembro: 'a b' })).toBe('/club?vista=miembros&miembro=a+b')
  })
  it('con local: el link elige ese local; con varios locales, el título dice cuál', () => {
    const uno = avisoClub(a({ tipo: 'CANJE_SIN_CODIGO', cantidad: 1, umbral: 0, detalle: { local: 'loc-a', local_nombre: 'Playa', multilocal: false } }))
    expect(uno.titulo).toBe('1 canje sin código sin resolver')
    expect(uno.path).toBe('/club?vista=excepciones&tipo=CANJE_SIN_CODIGO&local=loc-a')
    const varios = avisoClub(a({ detalle: { miembro_id: 'm1', miembro: 'Hotel Ficticio', local: 'loc-b', local_nombre: 'Monte', multilocal: true } }))
    expect(varios.titulo).toBe('Monte · Hotel Ficticio sumó 6 visitas con cupón o tarjeta en 24 horas')
    expect(varios.path).toBe('/club?vista=miembros&miembro=m1&local=loc-b')
  })
})
