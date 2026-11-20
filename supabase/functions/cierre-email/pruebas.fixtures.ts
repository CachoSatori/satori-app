// Facturas FICTICIAS del PoS para las pruebas del resumen (repo público: ningún nombre ni monto real).
type Fila = Record<string, unknown>

export interface MesaFicticia {
  login?: string | null
  canal?: 'salon' | 'delivery'
  pax?: number
  hora?: string
  dia: string
  comida?: number
  bebidas?: number
  duenos?: number
  total?: number
}

let seq = 0

export function mesaFicticia(m: MesaFicticia): { t: Fila; l: Fila[] } {
  const id = `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`
  const caja = (m.hora ?? '13:00') >= '17:00' ? '222' : '111'
  const comida = m.comida ?? 10_000
  const beb = (m.bebidas ?? 0) * 2_500
  const neta = comida + beb + (m.duenos ?? 0)
  const l: Fila[] = []
  if (comida) l.push({ ticket_id: id, codigo_producto: '100', nombre: 'ROLL FICTICIO', cantidad: 1, monto: comida, familia: 2, usuario_registra: m.login ?? null })
  if (beb) l.push({ ticket_id: id, codigo_producto: '200', nombre: 'BEBIDA FICTICIA', cantidad: m.bebidas, monto: beb, familia: 5, usuario_registra: m.login ?? null })
  if (m.duenos) l.push({ ticket_id: id, codigo_producto: '300', nombre: 'CONSUMO FICTICIO', cantidad: 1, monto: m.duenos, familia: 28, usuario_registra: m.login ?? null })
  const t: Fila = {
    id, numero_factura: id.slice(-6), estado: 'C', fecha_registra: `${m.dia}T${m.hora ?? '13:00'}:00-06:00`,
    fecha_cierra: `${m.dia}T${caja === '222' ? '23:50' : '16:30'}:00-06:00`, cajero_login: caja,
    canal: m.canal ?? 'salon', mesa: '1', salonero_login: m.login === undefined ? '901' : m.login,
    registrado_por: m.login === null ? 'caja' : 'salonero',
    servicio_crc: Math.round(neta * 0.1), iva_crc: Math.round(neta * 0.13),
    total_crc: m.total ?? Math.round(neta * 1.23), valor_servido_crc: neta, regalia_crc: 0,
    pax: m.pax ?? 0, pax_articulo: m.pax ?? 0,
  }
  return { t, l }
}

/** Un día ficticio con salón, delivery, una mesa sin pax, una de dueños y tres saloneros. */
export function diaFicticio(dia: string, escala = 1): { tickets: Fila[]; lineas: Fila[] } {
  const k = (v: number) => Math.round(v * escala)
  const ms = [
    mesaFicticia({ dia, login: '901', pax: 2, comida: k(24_000), bebidas: 2 }),
    mesaFicticia({ dia, login: '901', pax: 4, comida: k(52_000), bebidas: 5, hora: '19:10' }),
    mesaFicticia({ dia, login: '901', pax: 2, comida: k(21_000), bebidas: 2, hora: '20:30' }),
    mesaFicticia({ dia, login: '902', pax: 3, comida: k(45_000), bebidas: 3, hora: '19:40' }),
    mesaFicticia({ dia, login: '902', pax: 2, comida: k(30_000), bebidas: 1, hora: '20:05' }),
    mesaFicticia({ dia, login: '902', pax: 2, comida: k(28_000), bebidas: 2, hora: '21:00' }),
    mesaFicticia({ dia, login: '903', pax: 0, comida: k(18_000), bebidas: 1, hora: '12:20' }),
    mesaFicticia({ dia, login: '903', pax: 2, comida: 0, duenos: 40_000, hora: '21:15' }),
    mesaFicticia({ dia, login: null, canal: 'delivery', comida: k(16_500), hora: '19:30' }),
  ]
  return { tickets: ms.map(x => x.t), lineas: ms.flatMap(x => x.l) }
}
