// ─────────────────────────────────────────────────────────────────────────────────────────────
//  Plantillas de los dos correos de monthly-report (ventas y propinas), con el estándar de reportes
//  Satori adaptado a correo (correo-estandar.ts). SOLO forma y redacción: las cifras llegan ya
//  calculadas por index.ts (calcVentas / calcPropinas) y acá no se calcula nada nuevo, salvo porcentajes
//  y promedios de presentación que el correo anterior ya mostraba.
//
//  Los tipos de entrada son estructurales (solo los campos que el correo usa), así index.ts puede
//  cambiar de dónde lee los datos (p. ej. del PoS) sin tocar este archivo, mientras entregue estos campos.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import {
  cabecera, celdaNombre, cifras, crc, documento, esc, gris, miles, nombreFrase, nombrePropio, pct,
  pie, seccion, tabla, titulo, variacion, barrita, type Cifra,
} from './correo-estandar.ts'
import type { PlanReporte } from './periodo.ts'

export interface VentasCorreo {
  total: number; salon: number; caj: number; delivery: number
  pax: number; iCom: number; iBeb: number; diasVentas: number; prevNeta: number
  topSal: Array<{ nombre: string; ventas: number; servicios: number; ticketProm: number; constancia: number; irs: number }>
  topComida: Array<{ nombre: string; qty: number; monto: number }>
  topBebidas: Array<{ nombre: string; qty: number; monto: number }>
  semanas: Array<{ sem: string; total: number; dias: number; avg: number }>
  diasSem: Array<{ dia: string; avg: number; count: number }>
}

export interface PropinasCorreo {
  pool: number; barra: number; turnos: number
  amCount: number; pmCount: number; amPool: number; pmPool: number
  topProp: Array<{ nombre: string; take: number; dias: number; rol: string; prom: number; constancia: number }>
  sectores: Array<{ rol: string; total: number; pct: number }>
  semanas: Array<{ sem: string; total: number; avg: number; count: number }>
  diasSem: Array<{ dia: string; avg: number; count: number }>
}

type Plan = Pick<PlanReporte, 'periodo' | 'ym' | 'etiqueta' | 'comparacion'>

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** Título de página: «Octubre 2026» (mes) · «1.ª quincena de noviembre» (quincena). */
export function tituloPeriodo(plan: Plan): string {
  const [y, m] = plan.ym.split('-')
  const mes = MESES[Number(m) - 1] ?? ''
  if (plan.periodo === 'quincena') return `1.ª quincena de ${mes}`
  return `${mes.charAt(0).toUpperCase()}${mes.slice(1)} ${y}`
}

/** «vs mes anterior (septiembre)» → «vs. mes anterior (septiembre)» (estándar: «vs.»). */
export function contra(plan: Plan): string {
  return plan.comparacion.replace(/^vs\.?\s+/, 'vs. ')
}

const dias = (n: number) => `${n} ${n === 1 ? 'día' : 'días'}`
const turnosTxt = (n: number) => `${n} ${n === 1 ? 'turno' : 'turnos'}`
const minus = (s: string) => s.toLocaleLowerCase('es')

// ── Ventas ────────────────────────────────────────────────────────────────────────────────────
export function buildVentasEmail(v: VentasCorreo, plan: Plan): string {
  const reporte = 'Reporte de ventas'
  const vs = contra(plan)

  // Bajada: la conclusión en una o dos oraciones.
  const partes: string[] = []
  let frase = `Se vendieron ${crc(v.total)} en ${dias(v.diasVentas)} con registro`
  if (v.prevNeta > 0) {
    const d = (v.total - v.prevNeta) / v.prevNeta * 100
    frase += `, ${d > 0 ? '+' : ''}${pct(d)} ${vs}`
  }
  partes.push(frase + '.')
  const extra: string[] = []
  if (v.total > 0 && v.salon > 0) extra.push(`el salón hizo el ${pct(v.salon / v.total * 100)} de la venta`)
  if (v.diasSem.length > 0) extra.push(`el mejor día de la semana fue el ${minus(v.diasSem[0].dia)}`)
  if (extra.length) partes.push(extra.join(' y ').replace(/^./, (c) => c.toUpperCase()) + '.')
  const bajada = esc(partes.join(' '))

  const lista: Cifra[] = [
    { valor: crc(v.total), etiqueta: 'ventas totales', variacionHtml: variacion(v.total, v.prevNeta, `vs. ${crc(v.prevNeta)}`) },
  ]
  if (v.diasVentas > 0) lista.push({ valor: crc(v.total / v.diasVentas), etiqueta: 'promedio por día' })
  if (v.pax > 0) lista.push({ valor: miles(v.pax), etiqueta: 'personas en salón' })
  if (v.pax > 0 && v.salon > 0) lista.push({ valor: crc(v.salon / v.pax), etiqueta: 'ticket promedio por persona' })

  let html = cabecera(reporte, plan.etiqueta) + titulo(tituloPeriodo(plan), bajada) + cifras(lista)

  // Por canal
  const canales: Array<[string, number]> = []
  if (v.salon > 0) canales.push(['Salón', v.salon])
  if (v.delivery > 0) canales.push(['Delivery', v.delivery])
  if (v.caj > 0) canales.push(['Caja y para llevar', v.caj])
  if (canales.length) {
    const max = Math.max(...canales.map((c) => c[1]))
    html += seccion('Por canal', 'Cuánto vendió cada canal y qué parte del total es.')
    html += tabla(
      [{ titulo: 'canal', ancho: 34 }, { titulo: '', ancho: 28 }, { titulo: 'ventas', ancho: 22, derecha: true }, { titulo: 'del total', ancho: 16, derecha: true }],
      canales.map(([n, m]) => [celdaNombre(n), barrita(m, max, m === max), crc(m), pct(m / v.total * 100)]),
    )
  }

  // Comida y bebidas
  const iTotal = v.iCom + v.iBeb
  if (iTotal > 0) {
    const max = Math.max(v.iCom, v.iBeb)
    html += seccion('Comida y bebidas', 'Ítems vendidos de cada tipo.')
    html += tabla(
      [{ titulo: 'tipo', ancho: 34 }, { titulo: '', ancho: 28 }, { titulo: 'ítems', ancho: 22, derecha: true }, { titulo: 'del total', ancho: 16, derecha: true }],
      [
        [celdaNombre('Comida'), barrita(v.iCom, max, v.iCom === max), miles(v.iCom), pct(v.iCom / iTotal * 100)],
        [celdaNombre('Bebidas'), barrita(v.iBeb, max, v.iBeb > v.iCom), miles(v.iBeb), pct(v.iBeb / iTotal * 100)],
      ],
    )
  }

  // Semana a semana
  if (v.semanas.length > 0) {
    const max = Math.max(...v.semanas.map((s) => s.total))
    html += seccion('Semana a semana', 'Venta de salón por semana del mes y su promedio por día.')
    html += tabla(
      [{ titulo: 'semana', ancho: 30 }, { titulo: '', ancho: 26 }, { titulo: 'ventas', ancho: 22, derecha: true }, { titulo: 'por día', ancho: 22, derecha: true }],
      v.semanas.map((s, i) => [celdaNombre(`Semana ${i + 1}`, dias(s.dias)), barrita(s.total, max, s.total === max), crc(s.total), crc(s.avg)]),
    )
  }

  // Por día de la semana
  if (v.diasSem.length > 0) {
    const max = v.diasSem[0].avg
    html += seccion('Por día de la semana', 'Venta de salón promedio de cada día, de mayor a menor.')
    html += tabla(
      [{ titulo: 'día', ancho: 30 }, { titulo: '', ancho: 30 }, { titulo: 'días', ancho: 16, derecha: true }, { titulo: 'promedio', ancho: 24, derecha: true }],
      v.diasSem.map((d, i) => [celdaNombre(d.dia), barrita(d.avg, max, i === 0), String(d.count), crc(d.avg)]),
    )
  }

  // Saloneros
  if (v.topSal.length > 0) {
    html += seccion('Saloneros', 'Ordenados por IRS: 45 % ticket por persona, 35 % constancia y 20 % personas por servicio.')
    html += tabla(
      [{ titulo: 'salonero', ancho: 30 }, { titulo: 'IRS', ancho: 10, derecha: true }, { titulo: 'ticket por persona', ancho: 20, derecha: true }, { titulo: 'días y constancia', ancho: 20, derecha: true }, { titulo: 'ventas', ancho: 20, derecha: true }],
      v.topSal.map((s) => [
        celdaNombre(nombrePropio(s.nombre)),
        String(s.irs),
        s.ticketProm > 0 ? crc(s.ticketProm) : gris('—'),
        `${s.servicios}${gris(`, ${pct(s.constancia)}`)}`,
        crc(s.ventas),
      ]),
    )
  }

  // Productos
  const prod = (lista: VentasCorreo['topComida']) => lista.slice(0, 5).map((p) => [
    celdaNombre(nombreFrase(p.nombre)), miles(p.qty), crc(p.monto),
  ])
  const colsProd = [{ titulo: 'producto', ancho: 56 }, { titulo: 'unidades', ancho: 18, derecha: true }, { titulo: 'ventas', ancho: 26, derecha: true }]
  if (v.topComida.length > 0) {
    html += seccion('Comida más vendida', 'Los 5 platos con más venta del período.')
    html += tabla(colsProd, prod(v.topComida))
  }
  if (v.topBebidas.length > 0) {
    html += seccion('Bebidas más vendidas', 'Las 5 bebidas con más venta del período.')
    html += tabla(colsProd, prod(v.topBebidas))
  }

  html += pie(minus(reporte), plan.etiqueta)
  return documento(`Satori, ${minus(reporte)}, ${plan.etiqueta}`, html)
}

// ── Propinas ──────────────────────────────────────────────────────────────────────────────────
const SECTOR: Record<string, string> = {
  salonero: 'Saloneros', barman: 'Barra', cocina: 'Cocina', runner: 'Runners',
  manager: 'Gerencia', cajero: 'Cajeros', barback: 'Barback',
}

export function buildPropinasEmail(p: PropinasCorreo, plan: Plan): string {
  const reporte = 'Reporte de propinas'
  const prom = p.turnos > 0 ? p.pool / p.turnos : 0

  let bajada = `Se repartieron ${crc(p.pool)} en ${turnosTxt(p.turnos)}`
  bajada += p.turnos > 0 ? `: ${crc(prom)} por turno en promedio.` : '.'
  if (p.diasSem.length > 0) {
    const mejor = p.diasSem[0], peor = p.diasSem[p.diasSem.length - 1]
    bajada += ` El mejor día fue el ${minus(mejor.dia)} (${crc(mejor.avg)} por turno)`
    bajada += p.diasSem.length > 1 ? ` y el más bajo, el ${minus(peor.dia)} (${crc(peor.avg)}).` : '.'
  }

  const lista: Cifra[] = [
    { valor: crc(p.pool), etiqueta: 'pozo repartido' },
    { valor: String(p.turnos), etiqueta: `turnos: ${p.amCount} mediodía, ${p.pmCount} noche` },
  ]
  if (p.turnos > 0) lista.push({ valor: crc(prom), etiqueta: 'promedio por turno' })
  if (p.barra > 0) lista.push({ valor: crc(p.barra), etiqueta: `pozo de barra, ${pct(p.pool > 0 ? p.barra / p.pool * 100 : 0)} del total` })

  let html = cabecera(reporte, plan.etiqueta) + titulo(tituloPeriodo(plan), esc(bajada)) + cifras(lista)

  // Mediodía y noche
  const turnos: string[][] = []
  if (p.amCount > 0) turnos.push([celdaNombre('Mediodía'), String(p.amCount), crc(p.amPool / p.amCount)])
  if (p.pmCount > 0) turnos.push([celdaNombre('Noche'), String(p.pmCount), crc(p.pmPool / p.pmCount)])
  if (turnos.length) {
    html += seccion('Mediodía y noche', 'Pozo promedio por turno de cada servicio.')
    html += tabla([{ titulo: 'turno', ancho: 46 }, { titulo: 'turnos', ancho: 24, derecha: true }, { titulo: 'promedio por turno', ancho: 30, derecha: true }], turnos)
  }

  // Semana a semana
  if (p.semanas.length > 0) {
    const max = Math.max(...p.semanas.map((s) => s.avg))
    html += seccion('Semana a semana', 'Pozo promedio por turno en cada semana del mes.')
    html += tabla(
      [{ titulo: 'semana', ancho: 30 }, { titulo: '', ancho: 30 }, { titulo: 'turnos', ancho: 16, derecha: true }, { titulo: 'promedio', ancho: 24, derecha: true }],
      p.semanas.map((s, i) => [celdaNombre(`Semana ${i + 1}`), barrita(s.avg, max, s.avg === max), String(s.count), crc(s.avg)]),
    )
  }

  // Por día de la semana
  if (p.diasSem.length > 0) {
    const max = p.diasSem[0].avg
    html += seccion('Por día de la semana', 'Pozo promedio por turno de cada día, de mayor a menor.')
    html += tabla(
      [{ titulo: 'día', ancho: 30 }, { titulo: '', ancho: 30 }, { titulo: 'turnos', ancho: 16, derecha: true }, { titulo: 'promedio', ancho: 24, derecha: true }],
      p.diasSem.map((d, i) => [celdaNombre(d.dia), barrita(d.avg, max, i === 0), String(d.count), crc(d.avg)]),
    )
  }

  // Lo que se llevó cada uno
  if (p.topProp.length > 0) {
    html += seccion('Lo que se llevó cada uno', 'Las 8 personas con más propina en el período; constancia = turnos trabajados sobre el total.')
    html += tabla(
      [{ titulo: 'persona', ancho: 32 }, { titulo: 'turnos', ancho: 12, derecha: true }, { titulo: 'total', ancho: 20, derecha: true }, { titulo: 'por turno', ancho: 20, derecha: true }, { titulo: 'constancia', ancho: 16, derecha: true }],
      p.topProp.map((e) => [celdaNombre(nombrePropio(e.nombre), e.rol), String(e.dias), crc(e.take), crc(e.prom), pct(e.constancia)]),
    )
  }

  // Por sector
  if (p.sectores.length > 0) {
    const max = p.sectores[0].total
    html += seccion('Por sector', 'Cuánto se llevó cada sector y qué parte del pozo es.')
    html += tabla(
      [{ titulo: 'sector', ancho: 30 }, { titulo: '', ancho: 30 }, { titulo: 'total', ancho: 24, derecha: true }, { titulo: 'del pozo', ancho: 16, derecha: true }],
      p.sectores.map((s, i) => [celdaNombre(SECTOR[s.rol] ?? s.rol), barrita(s.total, max, i === 0), crc(s.total), pct(s.pct)]),
    )
  }

  html += pie(minus(reporte), plan.etiqueta)
  return documento(`Satori, ${minus(reporte)}, ${plan.etiqueta}`, html)
}
