// Logins viejos del PoS con VIGENCIA (firmado por el dueño, 2026-11-03).
//
// Los códigos del PoS se reciclan, así que el nombre de `0909`, `03`, `333`, `999` y `04` vale solo
// dentro de su ventana (día CR de `fecha_registra`, puntas incluidas). Afuera la fila queda como
// «login XXXX», sin nombre, y la plata NO se mueve: sigue en la misma fila del ranking, solo
// cambia cómo se llama. `02` (genérico) nunca entra al ranking. CHEMA y MARISOL, sin vigencia,
// quedan idénticos a antes.
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

import {
  clasificarCodigo, nombreDeCodigo, nombreDePersona, personasConocidas,
} from '../../shared/ndf/personasNdf'
import { mapSalonero } from '../../shared/ndf/mapTicket'
import { armarDia, claveSalonero, esSinAsignar, nombreSalonero } from './ventasEnVivoDatos'
import { calcularLentes, type LineaLente, type TicketLente } from './saloneroLentes'
import type { LineaNdfRow, TicketNdfConId } from '../../shared/api/posNdf'

const ticket = (id: string, login: string, fecha: string): TicketNdfConId => ({
  id, numero_factura: id, estado: 'C', fecha_registra: `${fecha}T19:00:00-06:00`, fecha_cierra: null,
  cajero_login: '222', canal: 'salon', mesa: id, salonero_login: login, registrado_por: 'salonero',
  turno: 'noche', con_servicio: true, servicio_crc: 0, total_crc: 0, valor_servido_crc: 1000,
  iva_crc: 0, regalia_crc: 0, descuento_crc: 0, clase_ingreso: 'cobrada',
  pax: 2, pax_nativo: 2, pax_articulo: 2, pax_alerta: 'ok',
})
const linea = (ticketId: string, login: string, monto = 1000): LineaNdfRow => ({
  ticket_id: ticketId, codigo_producto: '100', nombre: 'ROLL', cantidad: 1, monto, familia: 3,
  usuario_registra: login,
})

/** [código, nombre, primer día vigente, último día vigente]: lo firmado por el dueño el 2026-11-03. */
const VIGENCIAS: [string, string, string, string][] = [
  ['0909', 'Rocío',  '2025-01-07', '2026-05-09'],
  ['03',   'Alan',   '2025-01-01', '2026-01-18'],
  ['333',  'Emma',   '2025-01-01', '2025-10-22'],
  ['999',  'Jazmín', '2025-01-01', '2025-07-02'],
  ['04',   'Wesley', '2025-02-23', '2025-05-07'],
]

/** El día anterior / siguiente a `YYYY-MM-DD`. */
const dia = (f: string, delta: number): string =>
  new Date(Date.parse(`${f}T12:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10)

describe.each(VIGENCIAS)('login %s (%s)', (codigo, nombre, desde, hasta) => {
  it('dentro de la vigencia (las dos puntas incluidas) sale con su nombre', () => {
    for (const f of [desde, hasta]) {
      expect(clasificarCodigo(codigo, f).etiqueta).toBe(nombre)
      expect(nombreSalonero(codigo, {}, f)).toBe(nombre)
    }
  })

  it('un día antes o después sale «login XXXX», sin nombre y sin la marca de «sin asignar»', () => {
    for (const f of [dia(desde, -1), dia(hasta, 1), '2024-06-15']) {
      const p = clasificarCodigo(codigo, f)
      expect(p.fueraDeVigencia).toBe(true)
      expect(p.rol).toBe('mesero')
      expect(nombreDePersona(p, { [codigo]: 'NO USAR' })).toBe(`login ${codigo}`)
      expect(nombreSalonero(codigo, { [codigo]: 'NO USAR' }, f)).toBe(`login ${codigo}`)
      expect(esSinAsignar(nombreSalonero(codigo, {}, f))).toBe(false)
    }
  })

  it('ranking por factura: misma plata, una fila por nombre según el día', () => {
    const adentro = armarDia(hasta, [ticket('t1', codigo, hasta)], [linea('t1', codigo)], 's', {}).dia
    const afuera = armarDia(dia(hasta, 1), [ticket('t2', codigo, dia(hasta, 1))], [linea('t2', codigo)], 's', {}).dia
    expect(Object.keys(adentro.saloneros)).toEqual([nombre])
    expect(Object.keys(afuera.saloneros)).toEqual([`login ${codigo}`])
    expect(afuera.saloneros[`login ${codigo}`].total).toBe(adentro.saloneros[nombre].total)
  })

  it('lentes por línea: afuera es una fila propia «login XXXX», en el ranking, con su plata', () => {
    const t = (id: string, f: string): TicketLente => ({
      id, cajero_login: '222', valor_servido_crc: 0, iva_crc: 0, servicio_crc: 0, pax: 2, mesa: id,
      fecha_registra: `${f}T19:00:00-06:00`,
    })
    const l = (tid: string): LineaLente => ({
      ticket_id: tid, codigo_producto: '100', cantidad: 1, monto: 1000, familia: 3, usuario_registra: codigo,
    })
    const r = calcularLentes([t('t1', desde), t('t2', dia(desde, -1))], [l('t1'), l('t2')])
    const nombres = r.ventaPropia.map(f => nombreDePersona(f.persona, {})).sort()
    expect(nombres).toEqual([nombre, `login ${codigo}`].sort())
    expect(r.ventaPropia.every(f => f.rol === 'mesero' && f.netaCrc === 1000)).toBe(true)
    expect(r.mesaPropia.map(f => nombreDePersona(f.persona, {})).sort()).toEqual(nombres)
    expect(r.netaDiaCrc).toBe(2000)
  })
})

describe('la vigencia cambia el NOMBRE del dueño de la mesa, nunca quién es', () => {
  // Caso real de prod (2024-07-25): el `03` y la caja `222` empatan en 677 y en plata. Por id,
  // `'03' < '222'` pero `'login 03' > '222'`: sin el desempate por código la mesa se iba a la caja.
  it.each(['2024-07-25', '2025-07-25'])('empate 03 vs 222, %s: gana el 03 (con o sin nombre)', f => {
    const l = (c: string): LineaLente => ({
      ticket_id: 't1', codigo_producto: '100', cantidad: 1, monto: 1000, familia: 3, usuario_registra: c,
    })
    const r = calcularLentes(
      [{ id: 't1', cajero_login: '222', valor_servido_crc: 0, iva_crc: 0, servicio_crc: 0, pax: 2,
        fecha_registra: `${f}T19:00:00-06:00` }],
      [l('222'), l('03')],
    )
    expect(r.mesaPropia).toHaveLength(1)
    expect(r.mesaPropia[0].persona.codigos[0]).toBe('03')
    expect(nombreDePersona(r.mesaPropia[0].persona, {})).toBe(f.startsWith('2024') ? 'login 03' : 'Alan')
  })
})

describe('sin fecha no se mira la vigencia (vínculo empleado → ventas, lo de antes)', () => {
  it.each(VIGENCIAS)('%s → %s', (codigo, nombre) => {
    expect(clasificarCodigo(codigo).etiqueta).toBe(nombre)
    expect(nombreDeCodigo(codigo, {})).toBe(nombre)
  })
})

describe('`02` (genérico) nunca entra al ranking', () => {
  it.each(['2024-08-01', '2025-01-24', '2026-10-30'])('lente por línea, %s: rol genérico, cuenta en el total', f => {
    expect(clasificarCodigo('02', f).rol).toBe('generico')
    const r = calcularLentes(
      [{ id: 't1', cajero_login: '222', valor_servido_crc: 0, iva_crc: 0, servicio_crc: 0, pax: 2,
        fecha_registra: `${f}T19:00:00-06:00` }],
      [{ ticket_id: 't1', codigo_producto: '100', cantidad: 1, monto: 1500, familia: 3, usuario_registra: '02' }],
    )
    expect(r.ventaPropia.filter(x => x.rol === 'mesero')).toHaveLength(0)
    expect(r.netaDiaCrc).toBe(1500)
  })

  it('ranking por factura: la ingesta no lo acredita y, si un ticket vino así, tampoco', () => {
    expect(mapSalonero('02')).toBeNull()
    expect(claveSalonero({ salonero_login: '02', registrado_por: 'salonero' })).toBeNull()
    const { dia: d } = armarDia('2025-01-10', [ticket('t1', '02', '2025-01-10')], [linea('t1', '02')], 's', {})
    const meseros = Object.entries(d.saloneros).filter(([, s]) => !('esCajero' in s)).map(([k]) => k)
    expect(meseros).toEqual([])
    expect(Object.values(d.saloneros).reduce((t, s) => t + s.total, 0)).toBe(1000)
  })
})

describe('CHEMA y MARISOL (y todo código sin vigencia): idénticos a hoy, cualquier día', () => {
  const FECHAS = ['2024-01-05', '2024-12-31', '2025-01-01', '2025-07-15', '2026-05-10', '2026-10-30', '2030-01-01']
  const PROD = { '038': 'CHEMA', '235': 'MARISOL M' }

  it.each(['266', '038', '01', '235'])('%s: misma persona y mismo nombre con o sin fecha', codigo => {
    for (const f of FECHAS) {
      expect(clasificarCodigo(codigo, f)).toBe(clasificarCodigo(codigo))
      for (const nombres of [{}, PROD]) {
        expect(nombreSalonero(codigo, nombres, f)).toBe(nombreSalonero(codigo, nombres))
      }
    }
    expect(nombreSalonero('266', PROD, '2024-07-25')).toBe('CHEMA')
    expect(nombreSalonero('01', PROD, '2024-01-06')).toBe('MARISOL M')
  })

  it('ninguna persona de la tabla sin `vigencias` cambia por la fecha', () => {
    for (const p of personasConocidas().filter(x => !x.vigencias)) {
      for (const c of p.codigos) {
        for (const f of FECHAS) expect(clasificarCodigo(c, f)).toBe(p)
      }
    }
  })

  it('las vigencias de la tabla son exactamente las firmadas', () => {
    const conVigencia = personasConocidas()
      .flatMap(p => Object.entries(p.vigencias ?? {}).map(([c, v]) => [c, p.etiqueta, v.desde, v.hasta]))
    expect(conVigencia.sort()).toEqual([...VIGENCIAS].sort())
  })
})
