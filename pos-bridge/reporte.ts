// ── pos-bridge · el dry-run ────────────────────────────────────────────────────
//
// PURO: agrega y formatea, no lee nada y no escribe nada. Devuelve líneas de texto
// para que el CLI las imprima (y para poder probar el desglose sin base de datos).
//
// El resumen está armado para CUADRAR CONTRA EL EXCEL, en este orden:
//   1. venta total ₡ · venta CON 10% · venta SIN 10%   ← cuadre primario
//   2. venta por salonero                              ← segundo check

import { fi } from '../src/shared/utils'
import {
  CLAVE_SISTEMA,
  LOGIN_CAJERO_MANANA,
  LOGIN_CAJERO_NOCHE,
  LOGIN_CAJERO_TARDE_SIN_CONFIRMAR,
  SIN_SALONERO,
  type CategoriaMix,
  type PaxAlerta,
  type TicketMapeado,
  type Turno,
} from '../src/shared/ndf/mapTicket'
import type { LecturaDia } from './consulta.ts'

const redondear = (n: number): number => Math.round(n * 100) / 100

export interface Bloque {
  tickets:      number
  total:        number
  /** Venta de las facturas CON servicio 10% (consumo en salón). */
  con10:        number
  /** Venta de las facturas SIN servicio (delivery / llevar). */
  sin10:        number
  imp_servicio: number
  pax:          number
}

export interface LineaSalonero extends Bloque {
  clave:  string
  login:  string | null
  /** `022` figura como "cajero turno tarde" en el maestro: se marca hasta confirmar. */
  marca:  string | null
}

export interface LineaMix {
  categoria: CategoriaMix
  unidades:  number
  monto:     number
  /** % sobre el monto de todas las categorías del mix. */
  porcentaje: number
}

export interface ResumenDia {
  fecha:            string
  tickets:          number
  total:            number
  con10:            number
  sin10:            number
  imp_servicio:     number
  ticket_promedio:  number
  pax:              number
  alertas_pax:      Record<PaxAlerta, number>
  turnos:           Record<Turno, Bloque>
  saloneros:        LineaSalonero[]
  cajero:           Bloque & { por_turno: Record<Turno, Bloque> }
  sistema:          Bloque
  sin_pedido:       Bloque
  mix:              LineaMix[]
  cortesias:        number
  duenos:           number
  dolares_efectivo: number
  dolares_tarjeta:  number
  vuelto:           number
  estados:          Record<string, number>
  avisos:           string[]
}

export function bloqueVacio(): Bloque {
  return { tickets: 0, total: 0, con10: 0, sin10: 0, imp_servicio: 0, pax: 0 }
}

export function acumular(b: Bloque, t: TicketMapeado): Bloque {
  b.tickets      += 1
  b.total        += t.total
  b.imp_servicio += t.imp_servicio
  b.pax          += t.pax
  if (t.con_servicio) b.con10 += t.total
  else                b.sin10 += t.total
  return b
}

function cerrar(b: Bloque): Bloque {
  b.total        = redondear(b.total)
  b.con10        = redondear(b.con10)
  b.sin10        = redondear(b.sin10)
  b.imp_servicio = redondear(b.imp_servicio)
  return b
}

/** Las facturas del día → el desglose que se compara con la planilla. */
export function resumirDia(lectura: LecturaDia): ResumenDia {
  const { tickets } = lectura

  const alertas_pax: Record<PaxAlerta, number> =
    { ok: 0, falta_nativo: 0, falta_articulo: 0, difiere: 0, sin_pax: 0 }
  const turnos: Record<Turno, Bloque> = { 'mañana': bloqueVacio(), 'noche': bloqueVacio() }
  const cajeroPorTurno: Record<Turno, Bloque> = { 'mañana': bloqueVacio(), 'noche': bloqueVacio() }
  const cajero  = bloqueVacio()
  const sistema = bloqueVacio()
  const sinPedido = bloqueVacio()
  const porSalonero = new Map<string, LineaSalonero>()
  const mix = new Map<CategoriaMix, { unidades: number; monto: number }>()

  let total = 0, con10 = 0, sin10 = 0, imp_servicio = 0, pax = 0
  let cortesias = 0, duenos = 0
  let dolares_efectivo = 0, dolares_tarjeta = 0, vuelto = 0

  for (const t of tickets) {
    total        += t.total
    imp_servicio += t.imp_servicio
    pax          += t.pax
    if (t.con_servicio) con10 += t.total
    else                sin10 += t.total
    alertas_pax[t.pax_alerta] += 1
    cortesias += t.cortesias
    duenos    += t.duenos
    dolares_efectivo += t.medios.dolares_efectivo
    dolares_tarjeta  += t.medios.dolares_tarjeta
    vuelto           += t.medios.vuelto

    acumular(turnos[t.turno], t)

    switch (t.registrado_por) {
      case 'salonero': {
        const linea = porSalonero.get(t.salonero) ?? {
          ...bloqueVacio(),
          clave: t.salonero,
          login: t.salonero_login,
          marca: t.salonero_login === LOGIN_CAJERO_TARDE_SIN_CONFIRMAR
            ? 'maestro: "cajero turno tarde" — sin confirmar'
            : null,
        }
        acumular(linea, t)
        porSalonero.set(t.salonero, linea)
        break
      }
      case 'cajero':
        acumular(cajero, t)
        acumular(cajeroPorTurno[t.turno], t)
        break
      case 'sistema':
        acumular(sistema, t)
        break
      default:
        acumular(sinPedido, t)
    }

    for (const it of t.items) {
      const acc = mix.get(it.categoria) ?? { unidades: 0, monto: 0 }
      acc.unidades += it.cantidad
      acc.monto    += it.monto
      mix.set(it.categoria, acc)
    }
  }

  const montoMix = [...mix.values()].reduce((s, v) => s + v.monto, 0)

  return {
    fecha:   lectura.fecha,
    tickets: tickets.length,
    total:   redondear(total),
    con10:   redondear(con10),
    sin10:   redondear(sin10),
    imp_servicio: redondear(imp_servicio),
    ticket_promedio: tickets.length ? redondear(total / tickets.length) : 0,
    pax,
    alertas_pax,
    turnos: { 'mañana': cerrar(turnos['mañana']), 'noche': cerrar(turnos['noche']) },
    saloneros: [...porSalonero.values()].map(cerrar).sort((a, b) => b.total - a.total) as LineaSalonero[],
    cajero: {
      ...cerrar(cajero),
      por_turno: { 'mañana': cerrar(cajeroPorTurno['mañana']), 'noche': cerrar(cajeroPorTurno['noche']) },
    },
    sistema:    cerrar(sistema),
    sin_pedido: cerrar(sinPedido),
    mix: [...mix.entries()]
      .map(([categoria, v]) => ({
        categoria,
        unidades:   v.unidades,
        monto:      redondear(v.monto),
        porcentaje: montoMix ? redondear((v.monto / montoMix) * 100) : 0,
      }))
      .sort((a, b) => b.monto - a.monto),
    cortesias: redondear(cortesias),
    duenos:    redondear(duenos),
    dolares_efectivo: redondear(dolares_efectivo),
    dolares_tarjeta:  redondear(dolares_tarjeta),
    vuelto:           redondear(vuelto),
    estados: lectura.conteoEstados,
    avisos:  lectura.avisos,
  }
}

// ── Formato ────────────────────────────────────────────────────────────────────

type Alineacion = 'izq' | 'der'

/** Tabla de ancho fijo. Nada de dependencias: es un dry-run de consola. */
export function tabla(
  encabezados: string[],
  filas: (string | number)[][],
  alineaciones: Alineacion[] = [],
): string[] {
  const celdas = filas.map(f => f.map(c => String(c)))
  const anchos = encabezados.map((h, i) =>
    Math.max(h.length, ...celdas.map(f => (f[i] ?? '').length)))
  const alinear = (v: string, i: number): string =>
    (alineaciones[i] ?? 'izq') === 'der' ? v.padStart(anchos[i]) : v.padEnd(anchos[i])

  return [
    encabezados.map(alinear).join('  ').trimEnd(),
    anchos.map(a => '─'.repeat(a)).join('  '),
    ...celdas.map(f => f.map((c, i) => alinear(c, i)).join('  ').trimEnd()),
  ]
}

const pct = (n: number): string => `${n.toFixed(1)} %`

function lineasBloque(nombre: string, b: Bloque): (string | number)[] {
  return [nombre, b.tickets, fi(b.total), fi(b.con10), fi(b.sin10), b.pax]
}

export interface OpcionesReporte {
  /** Una línea con el destino (sin contraseña). */
  origen?:  string
  /** Detalle factura por factura. Por defecto sí: es el que sirve para cuadrar. */
  detalle?: boolean
}

/** El dry-run completo, listo para `console.log`. */
export function formatearReporte(r: ResumenDia, tickets: TicketMapeado[], opts: OpcionesReporte = {}): string[] {
  const L: string[] = []
  const titulo = (t: string) => { L.push('', `── ${t} ${'─'.repeat(Math.max(0, 74 - t.length))}`, '') }

  L.push(`SATORI · PoS "Nube de Fuego" — día ${r.fecha}  (DRY-RUN, cero escritura)`)
  if (opts.origen) L.push(`origen: ${opts.origen}`)

  titulo('Resumen del día (cuadre primario contra el Excel)')
  L.push(...tabla(
    ['', 'valor'],
    [
      ['Venta total ₡',        fi(r.total)],
      ['  · con 10% (salón)',  fi(r.con10)],
      ['  · sin 10% (delivery/llevar)', fi(r.sin10)],
      ['Servicio 10% cobrado', fi(r.imp_servicio)],
      ['Tickets',              String(r.tickets)],
      ['Ticket promedio',      fi(r.ticket_promedio)],
      ['Pax total',            String(r.pax)],
    ],
    ['izq', 'der'],
  ))

  titulo('Facturas del día por estado')
  const estados = Object.entries(r.estados)
  L.push(...tabla(
    ['estado', 'facturas', 'qué se hizo'],
    estados.length
      ? estados.map(([e, n]) => [
          e, n,
          e === 'C' ? 'cuentan en el día'
          : e === 'X' ? 'anuladas — NO suman'
          : e === 'R' ? 'raras — se ignoran'
          : 'estado no previsto — se ignora',
        ])
      : [['—', 0, 'no hay facturas en esa fecha']],
    ['izq', 'der', 'izq'],
  ))

  titulo('Por turno de caja')
  L.push(...tabla(
    ['turno', 'tickets', 'total', 'con 10%', 'sin 10%', 'pax'],
    [
      lineasBloque(`mañana (${LOGIN_CAJERO_MANANA})`, r.turnos['mañana']),
      lineasBloque(`noche (${LOGIN_CAJERO_NOCHE})`,   r.turnos['noche']),
    ],
    ['izq', 'der', 'der', 'der', 'der', 'der'],
  ))

  titulo('Venta por salonero')
  const filasSal: (string | number)[][] = r.saloneros.map(s => [
    s.clave, s.login ?? '—', s.tickets, fi(s.total), fi(s.con10), fi(s.sin10), s.pax,
  ])
  L.push(...tabla(
    ['salonero', 'login', 'tickets', 'total', 'con 10%', 'sin 10%', 'pax'],
    filasSal.length ? filasSal : [['(ninguno)', '—', 0, fi(0), fi(0), fi(0), 0]],
    ['izq', 'izq', 'der', 'der', 'der', 'der', 'der'],
  ))
  for (const s of r.saloneros) {
    if (s.marca) L.push(`   ⚠ ${s.clave} (${s.login}): ${s.marca}`)
  }

  titulo(`Registrado por cajero (${LOGIN_CAJERO_MANANA}/${LOGIN_CAJERO_NOCHE}) y otros`)
  L.push(
    'Estas facturas SÍ cuentan en el total del día; NO se le acreditan a ningún mesero.',
    '',
  )
  L.push(...tabla(
    ['línea', 'tickets', 'total', 'con 10%', 'sin 10%', 'pax'],
    [
      lineasBloque('cajero — total',                 r.cajero),
      lineasBloque(`  · turno mañana (${LOGIN_CAJERO_MANANA})`, r.cajero.por_turno['mañana']),
      lineasBloque(`  · turno noche (${LOGIN_CAJERO_NOCHE})`,   r.cajero.por_turno['noche']),
      lineasBloque(`${CLAVE_SISTEMA} (002 / 01 / 02)`, r.sistema),
      lineasBloque(SIN_SALONERO,                       r.sin_pedido),
    ],
    ['izq', 'der', 'der', 'der', 'der', 'der'],
  ))
  L.push(
    '',
    'con 10% = le comandaron a un salonero (favor a salón) · sin 10% = delivery/cajero.',
  )

  titulo('Mix por categoría')
  L.push(...tabla(
    ['categoría', 'unidades', 'monto', '%', 'ingreso'],
    r.mix.map(m => [
      m.categoria, m.unidades, fi(m.monto), pct(m.porcentaje),
      m.categoria === 'comida' || m.categoria === 'bebida' ? 'sí' : 'no',
    ]),
    ['izq', 'der', 'der', 'der', 'izq'],
  ))
  L.push('', `Cortesías (17): ${fi(r.cortesias)} · Dueños (28): ${fi(r.duenos)} — NO son venta.`)

  titulo('Pax — de dónde salió')
  L.push(...tabla(
    ['alerta', 'facturas', 'qué significa'],
    [
      ['ok',             r.alertas_pax.ok,             'Personas y artículo 677/678 coinciden'],
      ['falta_nativo',   r.alertas_pax.falta_nativo,   'el mesero NO cargó Personas — pax salió del artículo'],
      ['falta_articulo', r.alertas_pax.falta_articulo, 'hay Personas pero no se cobró 677/678'],
      ['difiere',        r.alertas_pax.difiere,        'las dos fuentes no coinciden — manda Personas'],
      ['sin_pax',        r.alertas_pax.sin_pax,        'no hay ninguna de las dos'],
    ],
    ['izq', 'der', 'izq'],
  ))

  if (opts.detalle !== false) {
    titulo('Detalle por factura')
    L.push(...tabla(
      ['factura', 'hora', 'turno', 'salonero', 'reg.', 'canal', '10%', 'pax', 'nat', 'art', 'alerta', 'total'],
      tickets.map(t => [
        t.numero_factura, t.hora, t.turno, t.salonero,
        t.registrado_por === 'salonero' ? '' : t.registrado_por,
        t.canal, t.con_servicio ? 'sí' : 'no',
        t.pax, t.pax_nativo, t.pax_articulo, t.pax_alerta, fi(t.total),
      ]),
      ['izq', 'izq', 'izq', 'izq', 'izq', 'izq', 'izq', 'der', 'der', 'der', 'izq', 'der'],
    ))
  }

  titulo('Notas')
  L.push(
    `· total_fuente = provisorio: el total es la suma de los medios de pago en colones`,
    `  (efectivo + tarjeta + electrónico + depósito + cheque + cuenta por cobrar) MENOS el vuelto.`,
    `· Vuelto del día ${fi(r.vuelto)}: se RESTA — el campo Efectivo del PoS lo trae adentro`,
    `  (cuadre contra "Ventas Netas por Día", 1-sep-2026).`,
    `· Dólares del día — efectivo $ ${r.dolares_efectivo} · tarjeta $ ${r.dolares_tarjeta}: NO se suman`,
    `  (el PoS ya los convirtió a colones).`,
    `· El IVA no se calcula en esta fase; el servicio 10% sí sale del dato real (SUM(ImpS)).`,
  )
  for (const a of r.avisos) L.push(`· ⚠ ${a}`)

  return L
}
