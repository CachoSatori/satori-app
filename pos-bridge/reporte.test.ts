import { describe, it, expect } from 'vitest'

import { armarTickets, type FilaDetalle, type FilaFactura, type LecturaDia } from './consulta.ts'
import { formatearReporte, resumirDia, tabla } from './reporte.ts'

// Un día ficticio (CC no tiene red al PoS): dos saloneros, una de delivery del
// cajero de la mañana, una "favor a salón" del cajero de la noche y una sin pedido.
const factura = (over: Partial<FilaFactura>): FilaFactura => ({
  numero_factura:    '0',
  fecha_hora:        '2026-09-01 19:00:00',
  estado:            'C',
  login_cajero:      '222',
  tipo_factura:      null,
  area_factura:      null,
  usuario_registra:  '026',
  usuario_max:       '026',
  personas:          0,
  pedidos:           1,
  tipo_pedido:       'M',
  area_pedido:       'SALON 1',
  salonero_nombre:   'MAXO',
  efectivo:          0,
  tarjeta:           0,
  monto_electronico: 0,
  deposito:          0,
  cheque:            0,
  cuenta_cobrar:     0,
  dolares_efectivo:  0,
  dolares_tarjeta:   0,
  vuelto:            0,
  ...over,
})

const linea = (over: Partial<FilaDetalle>): FilaDetalle => ({
  numero_factura: '0',
  codigo:         '100',
  nombre:         'ROLL SATORI',
  cantidad:       1,
  monto:          9000,
  imp_servicio:   900,
  imp_venta:      1170,
  familia:        2,
  familia_nombre: 'SUSHI',
  es_extra:       0,
  compuesto:      null,
  ...over,
})

const FACTURAS: FilaFactura[] = [
  factura({ numero_factura: '5001', fecha_hora: '2026-09-01 12:30:00', login_cajero: '111', efectivo: 22000 }),
  factura({ numero_factura: '5002', usuario_registra: '027', usuario_max: '027', salonero_nombre: 'GUILLE', tarjeta: 31000 }),
  factura({ numero_factura: '5003', usuario_registra: '111', usuario_max: '111', salonero_nombre: null,
            login_cajero: '111', tipo_pedido: 'D', fecha_hora: '2026-09-01 13:10:00', efectivo: 12000 }),
  factura({ numero_factura: '5004', usuario_registra: '222', usuario_max: '222', salonero_nombre: null,
            login_cajero: '222', monto_electronico: 18000 }),
  factura({ numero_factura: '5005', usuario_registra: null, usuario_max: null, salonero_nombre: null,
            pedidos: 0, tipo_pedido: null, efectivo: 5000, dolares_efectivo: 10, vuelto: 1000 }),
]

const DETALLE: FilaDetalle[] = [
  linea({ numero_factura: '5001', monto: 14000, cantidad: 2, imp_servicio: 1400 }),
  linea({ numero_factura: '5001', codigo: '200', nombre: 'IMPERIAL', familia: 5, familia_nombre: 'CERVEZAS',
          monto: 6000, cantidad: 3, imp_servicio: 600 }),
  linea({ numero_factura: '5001', codigo: '677', nombre: 'A PAX', familia: 19, familia_nombre: 'A PAX',
          monto: 0, cantidad: 2, imp_servicio: 0 }),
  linea({ numero_factura: '5002', monto: 26000, cantidad: 4, imp_servicio: 2600 }),
  linea({ numero_factura: '5002', codigo: '678', nombre: 'A PAX 2', familia: 19, familia_nombre: 'A PAX',
          monto: 0, cantidad: 2, imp_servicio: 0 }),
  linea({ numero_factura: '5003', monto: 12000, cantidad: 2, imp_servicio: 0 }),          // delivery: sin 10%
  linea({ numero_factura: '5004', monto: 16000, cantidad: 2, imp_servicio: 1600 }),        // favor a salón: con 10%
  linea({ numero_factura: '5004', codigo: '400', nombre: 'CORTESIA CASA', familia: 17,
          familia_nombre: 'CORTESIAS', monto: 2500, cantidad: 1, imp_servicio: 0 }),
  linea({ numero_factura: '5005', monto: 5000, cantidad: 1, imp_servicio: 0 }),
]

const armado = armarTickets(FACTURAS, DETALLE)
const LECTURA: LecturaDia = {
  fecha:         '2026-09-01',
  tickets:       armado.tickets,
  conteoEstados: { C: 5, X: 2, R: 1 },
  avisos:        armado.avisos,
}

describe('resumirDia — el cuadre primario', () => {
  const r = resumirDia(LECTURA)

  it('el total del día es la suma de TODAS las facturas cerradas, menos el vuelto', () => {
    expect(r.tickets).toBe(5)
    // 22000 + 31000 + 12000 + 18000 + (5000 − 1000 de vuelto)
    expect(r.total).toBe(87000)
    expect(r.ticket_promedio).toBe(17400)
  })

  it('parte el día en con 10% / sin 10% como el Excel', () => {
    expect(r.con10).toBe(71000)     // 5001 + 5002 + 5004 (ImpS > 0)
    expect(r.sin10).toBe(16000)     // 5003 delivery (12000) + 5005 neto de vuelto (4000)
    expect(r.con10 + r.sin10).toBe(r.total)
    expect(r.imp_servicio).toBe(6200)
  })

  it('el breakdown de mesero solo tiene saloneros de verdad', () => {
    expect(r.saloneros.map(s => s.clave)).toEqual(['GUILLE', 'MAXO'])
    expect(r.saloneros.find(s => s.clave === 'MAXO')?.total).toBe(22000)
    expect(r.saloneros.find(s => s.clave === 'MAXO')?.con10).toBe(22000)
  })

  it('lo registrado por 111/222 va a su línea aparte, con y sin servicio', () => {
    expect(r.cajero.tickets).toBe(2)
    expect(r.cajero.total).toBe(30000)
    expect(r.cajero.sin10).toBe(12000)     // 111 delivery
    expect(r.cajero.con10).toBe(18000)     // 222 favor a salón
    expect(r.cajero.por_turno['mañana'].total).toBe(12000)
    expect(r.cajero.por_turno['noche'].total).toBe(18000)
  })

  it('la factura sin pedido cuenta en el día pero no en ningún mesero', () => {
    expect(r.sin_pedido.tickets).toBe(1)
    expect(r.sin_pedido.total).toBe(4000)   // 5000 cobrados − 1000 de vuelto
    expect(r.saloneros.some(s => s.clave.includes('sin salonero'))).toBe(false)
  })

  it('el turno sale de 111/222 y, si no, del reloj', () => {
    expect(r.turnos['mañana'].tickets).toBe(2)   // 5001 (12:30) y 5003 (111)
    expect(r.turnos['noche'].tickets).toBe(3)
    expect(r.turnos['mañana'].total + r.turnos['noche'].total).toBe(r.total)
  })

  it('pax sale del artículo 677/678 mientras Personas siga en 0', () => {
    expect(r.pax).toBe(6)                        // 5001: 677×2 · 5002: 678×2 → 4
    expect(r.alertas_pax.falta_nativo).toBe(2)
    expect(r.alertas_pax.sin_pax).toBe(3)
  })

  it('el mix separa ingreso de lo que no lo es', () => {
    const cat = (c: string) => r.mix.find(m => m.categoria === c)
    expect(cat('comida')?.monto).toBe(73000)
    expect(cat('bebida')?.monto).toBe(6000)
    expect(cat('cortesia')?.monto).toBe(2500)
    expect(r.cortesias).toBe(2500)
    expect(cat('pax')?.unidades).toBe(4)
  })

  it('el vuelto se resta del total y se sigue reportando aparte', () => {
    expect(r.dolares_efectivo).toBe(10)   // los dólares NO se suman
    expect(r.vuelto).toBe(1000)
    expect(r.total).toBe(87000)           // 88000 cobrados − 1000 de vuelto
  })
})

describe('formatearReporte', () => {
  const texto = formatearReporte(resumirDia(LECTURA), LECTURA.tickets, {
    origen: 'DESKTOP-25PRDR1:1433/ndf · usuario ClienteConsulta',
  }).join('\n')

  it('encabeza con la fecha y avisa que no escribe nada', () => {
    expect(texto).toContain('día 2026-09-01')
    expect(texto).toContain('DRY-RUN, cero escritura')
  })

  it('trae el desglose con 10% / sin 10% y los estados X y R', () => {
    expect(texto).toContain('con 10% (salón)')
    expect(texto).toContain('sin 10% (delivery/llevar)')
    expect(texto).toContain('anuladas — NO suman')
    expect(texto).toContain('raras — se ignoran')
  })

  it('muestra las tres fuentes de pax en el detalle', () => {
    expect(texto).toContain('nat')
    expect(texto).toContain('art')
    expect(texto).toContain('falta_nativo')
  })

  it('NUNCA imprime una contraseña ni datos de delivery', () => {
    expect(texto.toLowerCase()).not.toContain('password')
    expect(texto.toLowerCase()).not.toContain('telefono')
  })

  it('--sin-detalle saca la tabla factura por factura', () => {
    const corto = formatearReporte(resumirDia(LECTURA), LECTURA.tickets, { detalle: false }).join('\n')
    expect(corto).not.toContain('Detalle por factura')
    expect(corto).toContain('Resumen del día')
  })
})

describe('tabla', () => {
  it('alinea columnas y no deja espacios colgando', () => {
    const t = tabla(['a', 'n'], [['xx', 1], ['y', 22]], ['izq', 'der'])
    expect(t[0]).toBe('a    n')   // el encabezado sigue la alineación de su columna
    expect(t[2]).toBe('xx   1')
    expect(t[3]).toBe('y   22')
  })
})
