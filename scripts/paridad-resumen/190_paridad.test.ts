// Paridad de la 190 (`pos_ventas_resumen`) contra el camino de filas de la 067, con datos REALES de prod leídos en
// solo lectura. Los datos NO van al repo (montos reales): se bajan a una carpeta local y se apunta con
// PARIDAD190_RAW=/ruta npx vitest run scripts/paridad-resumen. Sin la variable, la prueba se saltea (no da verde).
//
// Qué hay en la carpeta (cada archivo es un objeto JSON):
//   · c1.json … c8.json: { t: [[id, numero_factura, estado, fecha_registra, fecha_cierra, cajero_login, canal, mesa,
//     salonero_login, registrado_por, servicio_crc, total_crc, valor_servido_crc, iva_crc, regalia_crc, pax,
//     pax_articulo]…], l: [[ticket_id, codigo_producto, cantidad, monto, familia]…] }: las facturas C (y sus líneas,
//     en orden ticket_id, id) de 2024-12-01 a 2026-11-19 CR, en tramos de tres meses, las mismas columnas que la 067.
//   · f_<periodo>_<a|b>.json: { r: <lo que devuelve el cuerpo de la 190> } para cada tramo de `tramosDeLectura` del
//     período (ancla 2026-11-18), en el orden de los tramos.
// Escribe el resultado (solo banderas y conteos, sin montos) en $PARIDAD190_RAW/../resultado.json.
import { describe, it, expect, vi } from 'vitest'
vi.mock('../../src/shared/api/supabase', () => ({ supabase: {} }))
import * as fs from 'fs'
import type { LineaNdfRow, TicketVentaRow } from '../../src/shared/api/posNdf'
import { ventanaRangoJornadas } from '../../src/shared/api/posNdf'
import { calcularPeriodo, type Rango } from '../../src/modules/ventas/periodos'
import { alertaDeAyer, armarLectura, armarLecturaAgregada, cifrasDelRango } from '../../src/modules/ventas/resumenV2'
import { parsearResumenAgregado } from '../../src/modules/ventas/resumenV2Agregado'
import { juntarPartes, partirTramo, tramosDeLectura } from '../../src/modules/ventas/resumenV2Datos'

const RAW = process.env.PARIDAD190_RAW ?? ''
const tickets: TicketVentaRow[] = []
const lineas: LineaNdfRow[] = []
for (let i = 1; RAW && i <= 8; i++) {
  const j = JSON.parse(fs.readFileSync(`${RAW}/c${i}.json`, 'utf8'))
  for (const r of j.t) tickets.push({ id: r[0], numero_factura: r[1], estado: r[2], fecha_registra: r[3], fecha_cierra: r[4],
    cajero_login: r[5], canal: r[6], mesa: r[7], salonero_login: r[8], registrado_por: r[9], servicio_crc: r[10], total_crc: r[11],
    valor_servido_crc: r[12], iva_crc: r[13], regalia_crc: r[14], pax: r[15], pax_articulo: r[16] } as TicketVentaRow)
  for (const r of j.l) lineas.push({ ticket_id: r[0], codigo_producto: r[1], nombre: null, cantidad: r[2], monto: r[3], familia: r[4], usuario_registra: null } as LineaNdfRow)
}
const porTicket = new Map<string, LineaNdfRow[]>()
for (const l of lineas) { const a = porTicket.get(l.ticket_id); if (a) a.push(l); else porTicket.set(l.ticket_id, [l]) }

const CASOS = { ayer: ['f_ayer_a', 'f_ayer_b'], mesALaFecha: ['f_mtd_a', 'f_mtd_b'], anioALaFecha: ['f_ytd_a', 'f_ytd_b'] } as const
const sinNombres = (d: object) => { const { saloneroNames: _s, ...r } = d as { saloneroNames?: unknown }; return r }

describe.skipIf(!RAW)('paridad 190 con datos de prod', () => {
it('ayer, mes a la fecha y año a la fecha: igual que el camino de filas', () => {
  const out: Record<string, unknown> = {}
  for (const [tipo, archivos] of Object.entries(CASOS)) {
    const p = calcularPeriodo({ tipo: tipo as 'ayer', ancla: '2026-11-18' })
    const tr = tramosDeLectura(p).flatMap(r => partirTramo(r))
    expect(tr.length).toBe(archivos.length)
    let t0 = performance.now()
    const partes = tramosDeLectura(p).map(r => {
      const v = ventanaRangoJornadas(r.desde, r.hasta)
      const d0 = Date.parse(v.desde), d1 = Date.parse(v.hasta)
      const ts = tickets.filter(x => { const m = Date.parse(x.fecha_registra); return m >= d0 && m < d1 })
      return { tickets: ts, lineas: ts.flatMap(x => porTicket.get(x.id) ?? []) }
    })
    const a = armarLectura(...juntarPartes(partes))
    const lecturaFilasMs = performance.now() - t0
    t0 = performance.now()
    const b = armarLecturaAgregada(archivos.map(f => parsearResumenAgregado(JSON.parse(fs.readFileSync(`${RAW}/${f}.json`, 'utf8')).r)))
    const lecturaAgrMs = performance.now() - t0
    const rangos: [string, Rango][] = [['periodo', p], ...Object.entries(p.bases).filter(([, x]) => !!x).map(([k, x]) => [k, x!] as [string, Rango])]
    const res: Record<string, unknown> = { tickets: a.tickets.length, lineas: a.lineas.length, facturasAgr: b.facturas.length, lecturaFilasMs, lecturaAgrMs }
    for (const [nom, r] of rangos) {
      t0 = performance.now(); const ca = cifrasDelRango(a, r); const msA = performance.now() - t0
      t0 = performance.now(); const cb = cifrasDelRango(b, r); const msB = performance.now() - t0
      const diasIguales = JSON.stringify(cb.dias) === JSON.stringify(ca.dias.map(sinNombres))
      const totIguales = JSON.stringify(cb.totales) === JSON.stringify(ca.totales)
      const totalEsSuma = ca.totales.ventaNeta === ca.dias.reduce((s, d) => s + d.ventaNeta, 0) && cb.totales.ventaNeta === cb.dias.reduce((s, d) => s + d.ventaNeta, 0)
      const { valor: va, valorSoloConPax: sa, netaSalon: na, netaSinReferencia: ra, netaMesasDuenos: da, netaRegaliasTotales: ga, ...ia } = ca.vpp
      const { valor: vb, valorSoloConPax: sb, netaSalon: nb, netaSinReferencia: rb, netaMesasDuenos: db, netaRegaliasTotales: gb, ...ib } = cb.vpp
      const conteosVpp = JSON.stringify(ia) === JSON.stringify(ib)
      const dif = (x: number | null, y: number | null) => (x === null || y === null ? (x === y ? 0 : Infinity) : Math.abs(x - y))
      const maxDifVpp = Math.max(dif(va, vb), dif(sa, sb), dif(na, nb), dif(ra, rb), dif(da, db), dif(ga, gb))
      res[nom] = { rango: `${r.desde}..${r.hasta}`, dias: ca.dias.length, diasIguales, totIguales, totalEsSuma,
        facturasIguales: ca.facturas === cb.facturas, paxIguales: ca.totales.pax === cb.totales.pax, conteosVpp,
        vppValorIgualExacto: va === vb, vppRedondeadoIgual: Math.round(va ?? -1) === Math.round(vb ?? -1), maxDifVpp,
        personasCargadas: ca.vpp.personasCargadas === cb.vpp.personasCargadas, personasEstimadas: ca.vpp.personasEstimadas === cb.vpp.personasEstimadas,
        msFilas: Math.round(msA), msAgr: Math.round(msB) }
    }
    res.alertaIgual = JSON.stringify(alertaDeAyer(a, p)) === JSON.stringify(alertaDeAyer(b, p))
    out[tipo] = res
  }
  fs.writeFileSync(`${RAW}/../resultado.json`, JSON.stringify(out, null, 1))
  for (const r of Object.values(out) as Record<string, unknown>[]) {
    expect(r.alertaIgual).toBe(true)
    for (const v of Object.values(r)) if (v && typeof v === 'object') {
      const c = v as Record<string, unknown>
      for (const k of ['diasIguales', 'totIguales', 'totalEsSuma', 'facturasIguales', 'paxIguales', 'conteosVpp', 'vppRedondeadoIgual', 'personasCargadas', 'personasEstimadas']) expect(c[k], k).toBe(true)
      expect(c.maxDifVpp as number).toBeLessThan(1e-6)
    }
  }
})
})
