// Datos FICTICIOS para las pruebas del Resumen v2 (no se importa desde la app).
import type { LineaNdfRow, TicketVentaRow } from '../../shared/api/posNdf'

export const t = (o: Partial<TicketVentaRow> & { id: string }): TicketVentaRow => ({
  numero_factura: o.id, estado: 'C', fecha_registra: '2026-10-01T19:00:00-06:00',
  fecha_cierra: '2026-10-01T23:50:00-06:00', cajero_login: '222', canal: 'salon', mesa: null,
  salonero_login: '026', registrado_por: 'salonero', servicio_crc: 0, total_crc: 10_000,
  valor_servido_crc: 0, iva_crc: 0, regalia_crc: 0, pax: 2, pax_articulo: 2, ...o,
})
export const l = (ticket_id: string, monto: number, familia = 2): LineaNdfRow => ({
  ticket_id, codigo_producto: `P${familia}`, nombre: `PRODUCTO ${familia}`, cantidad: 1, monto, familia, usuario_registra: null,
})

// Generador sembrado (determinista): octubre y noviembre 2026 con céntimos, delivery, mesas sin pax,
// una mesa de dueños por semana y una regalía total. Es donde muerde el redondeo por día (#288).
function prng(semilla: number) {
  let a = semilla >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let x = a
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}
export function datos(desde: string, dias: number, semilla = 7) {
  const r = prng(semilla)
  const tickets: TicketVentaRow[] = []
  const lineas: LineaNdfRow[] = []
  const d0 = new Date(`${desde}T12:00:00Z`)
  for (let i = 0; i < dias; i++) {
    const f = new Date(d0.getTime() + i * 86_400_000).toISOString().slice(0, 10)
    const n = 3 + Math.floor(r() * 6)
    for (let k = 0; k < n; k++) {
      const id = `${f}-${k}`
      const hora = 12 + Math.floor(r() * 10)
      const monto = Math.round(r() * 4_000_000) / 100 + (r() < 0.3 ? 0.5 : 0)
      const canal = r() < 0.2 ? 'delivery' : 'salon'
      const sinPax = r() < 0.15
      tickets.push(t({
        id, fecha_registra: `${f}T${String(hora).padStart(2, '0')}:10:00-06:00`,
        fecha_cierra: `${f}T23:50:00-06:00`, cajero_login: hora < 17 ? '111' : '222', canal,
        salonero_login: k % 3 === 0 ? null : `0${26 + (k % 3)}`,
        pax: sinPax ? 0 : 1 + Math.floor(r() * 4), pax_articulo: sinPax ? 0 : null,
        iva_crc: Math.round(monto * 13) / 100, servicio_crc: canal === 'salon' ? Math.round(monto * 10) / 100 : 0,
        total_crc: monto * 1.23,
      }))
      lineas.push(l(id, monto * 0.7, 2), l(id, monto * 0.3, 5), l(id, 0, 20))
    }
    if (i % 7 === 3) { // mesa de dueños (familia 28 > 50 %)
      const id = `${f}-D`
      tickets.push(t({ id, fecha_registra: `${f}T20:00:00-06:00`, fecha_cierra: `${f}T23:50:00-06:00`, pax: 0, pax_articulo: 0, total_crc: 0 }))
      lineas.push(l(id, 30_000, 28), l(id, 2_000, 2))
    }
    if (i % 9 === 4) { // regalía total: neta y total en 0
      const id = `${f}-R`
      tickets.push(t({ id, fecha_registra: `${f}T13:00:00-06:00`, fecha_cierra: `${f}T16:00:00-06:00`, cajero_login: '111', pax: 2, total_crc: 0 }))
      lineas.push(l(id, 9_000, 17))
    }
  }
  return { tickets, lineas }
}

