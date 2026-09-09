// ── D · «venta propia por línea» dentro de la tarjeta de Saloneros ──────────────────────────
//
// Lo que fija este test es la REGLA, no el layout: el bloque es una SEGUNDA LECTURA de la misma
// neta, no el desglose del total de la tarjeta.
//
//   · La TARJETA reparte por el salonero DEL PEDIDO: la factura entera va a una persona.
//   · La LENTE A reparte por el `usuario_registra` de CADA LÍNEA: una factura partida entre dos
//     meseros se reparte entre los dos.
//
// Sumarlas contaría dos veces toda mesa compartida — es la regla firmada de `saloneroLentes.ts`.
// Por eso el bloque trae su propio total y la pantalla lo rotula «otra lectura».
import { describe, it, expect } from 'vitest'

import { calcularLentes, type LineaLente, type TicketLente } from './saloneroLentes'
import { ventaPropiaDe } from './saloneroVentaPropia'

/** `026` = MAXO (mañana, caja 111) · `032` = GONZA. Los dos son meseros del mapa firmado. */
const NOMBRES = { '026': 'MAXO', '032': 'GONZA' }

const ticket = (o: Partial<TicketLente> = {}): TicketLente => ({
  id: 'f1', cajero_login: '111', valor_servido_crc: 10_000,
  iva_crc: 1_300, servicio_crc: 1_000, pax: 2, mesa: '7', ...o,
})

const linea = (o: Partial<LineaLente> = {}): LineaLente => ({
  ticket_id: 'f1', usuario_registra: '026', monto: 10_000,
  codigo_producto: 'X1', cantidad: 1, familia: 3, ...o,
})

/**
 * Una mesa COMPARTIDA, que es el caso que hace que los dos ejes no coincidan:
 * la factura la corrió MAXO, pero GONZA comandó ₡4.000 de ella.
 */
const LENTES = calcularLentes(
  [ticket({ id: 'f1', cajero_login: '111', valor_servido_crc: 10_000 }),
   ticket({ id: 'f2', cajero_login: '222', valor_servido_crc:  6_000, mesa: '3' })],
  [
    // f1 (turno mañana): MAXO 6.000 + GONZA 4.000
    linea({ ticket_id: 'f1', usuario_registra: '026', monto: 6_000 }),
    linea({ ticket_id: 'f1', usuario_registra: '032', monto: 4_000, codigo_producto: 'X2' }),
    // el pax de la factura f1 lo registró MAXO
    linea({ ticket_id: 'f1', usuario_registra: '026', monto: 0, codigo_producto: '677', familia: 19, cantidad: 2 }),
    // f2 (turno tarde): todo MAXO
    linea({ ticket_id: 'f2', usuario_registra: '026', monto: 6_000, codigo_producto: 'X3' }),
  ],
)

describe('ventaPropiaDe · el recorte por persona', () => {
  it('parte por turno, con las etiquetas del mapa de cajas', () => {
    const vp = ventaPropiaDe('MAXO', LENTES, NOMBRES)
    expect(vp.hayDatos).toBe(true)
    expect(vp.turnos.map(t => t.etiqueta)).toEqual(['Mañana · almuerzo', 'Tarde · noche'])
    expect(vp.turnos.map(t => t.netaCrc)).toEqual([6_000, 6_000])
  })

  it('el total del bloque es la suma de SUS turnos', () => {
    const vp = ventaPropiaDe('MAXO', LENTES, NOMBRES)
    expect(vp.netaCrc).toBe(12_000)
    expect(vp.netaCrc).toBe(vp.turnos.reduce((s, t) => s + t.netaCrc, 0))
  })

  it('NO es el desglose de la tarjeta: en una mesa compartida los dos ejes difieren', () => {
    // La tarjeta acredita la factura f1 ENTERA (₡10.000) a quien la corrió. La venta propia de
    // MAXO en ese turno es ₡6.000, porque ₡4.000 los comandó GONZA. Los números NO coinciden, y
    // ese es exactamente el motivo por el que el bloque va con su propio total y no se suma.
    const maxo  = ventaPropiaDe('MAXO',  LENTES, NOMBRES)
    const gonza = ventaPropiaDe('GONZA', LENTES, NOMBRES)
    expect(maxo.turnos[0].netaCrc).toBe(6_000)
    expect(gonza.turnos[0].netaCrc).toBe(4_000)
    // Y la lente sigue siendo aditiva: entre los dos reparten la factura entera.
    expect(maxo.turnos[0].netaCrc + gonza.turnos[0].netaCrc).toBe(10_000)
  })

  it('el PAX propio es el del 677 que registró esa persona', () => {
    expect(ventaPropiaDe('MAXO',  LENTES, NOMBRES).paxPropio).toBe(2)
    expect(ventaPropiaDe('GONZA', LENTES, NOMBRES).paxPropio).toBe(0)
  })

  it('sin pax propio, prom/pax es null y no un cero ni un NaN', () => {
    const gonza = ventaPropiaDe('GONZA', LENTES, NOMBRES)
    expect(gonza.paxPropio).toBe(0)
    expect(gonza.promPorPax).toBeNull()
  })

  it('una persona que no está en la lente NO devuelve ceros: devuelve «no hay datos»', () => {
    // Es la diferencia entre «no vendió» y «no lo sabemos». La pantalla dice cosas distintas.
    const vp = ventaPropiaDe('ROSAURA', LENTES, NOMBRES)
    expect(vp.hayDatos).toBe(false)
    expect(vp.netaCrc).toBe(0)
    expect(vp.turnos).toEqual([])
  })

  it('sin lente cargada tampoco inventa nada', () => {
    expect(ventaPropiaDe('MAXO', null, NOMBRES).hayDatos).toBe(false)
  })

  it('el match es por nombre y no distingue mayúsculas ni espacios', () => {
    expect(ventaPropiaDe('  maxo  ', LENTES, NOMBRES).netaCrc).toBe(12_000)
  })

  it('la caja NO es un salonero: no entra al bloque aunque comande líneas', () => {
    // `111` es una CAJA en el mapa de personas (rol `caja`), y su plata tiene su propio lugar
    // en la pestaña «Saloneros x línea». Acá se filtra por rol `mesero`.
    const conCaja = calcularLentes(
      [ticket({ id: 'f9', cajero_login: '111', valor_servido_crc: 5_000 })],
      [linea({ ticket_id: 'f9', usuario_registra: '111', monto: 5_000 })],
    )
    expect(ventaPropiaDe('111', conCaja, {}).hayDatos).toBe(false)
    // …pero la lente sí la tiene, para que la plata no se pierda de vista.
    expect(conCaja.ventaPropia.some(f => f.rol === 'caja')).toBe(true)
  })
})

describe('la lente sigue cuadrando con el día', () => {
  it('Σ de todas las personas = neta de las líneas (lente A es aditiva)', () => {
    const suma = LENTES.ventaPropia.reduce((s, f) => s + f.netaCrc, 0)
    expect(suma).toBe(LENTES.netaLineasCrc)
    expect(suma).toBe(16_000)   // 10.000 (f1) + 6.000 (f2)
  })

  it('el descuadre contra las FACTURAS se expone, no se tapa', () => {
    expect(LENTES.descuadreCrc).toBe(LENTES.netaDiaCrc - LENTES.netaLineasCrc)
    expect(LENTES.descuadreCrc).toBe(0)
  })
})
