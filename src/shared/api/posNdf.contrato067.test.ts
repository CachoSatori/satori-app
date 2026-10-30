// Mig 067 — el contrato de columnas vive en el `returns table` de las funciones, no en un select
// de la app. Este test lee la migración y frena dos regresiones:
//   · que se cuele un medio de pago (o `clase_ingreso`) en lo que lee el equipo;
//   · que falte una columna que el cálculo SÍ usa (p. ej. `mesa` para la lente de mesa propia,
//     `usuario_registra` para las facturas partidas): PostgREST la devolvería `undefined`, callado.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const sql = fs.readFileSync(path.resolve(__dirname, '../../../supabase/migrations/067_pos_ventas_lectura_equipo.sql'), 'utf8')
/** El SQL sin comentarios, para contar lo que de verdad se ejecuta. */
const codigo = sql.replace(/--.*$/gm, '')

/** Las columnas del `returns table (...)` de una función de la migración. */
function columnas(fn: string): string[] {
  const i = sql.indexOf(`create or replace function public.${fn}(`)
  expect(i).toBeGreaterThanOrEqual(0)
  const desde = sql.indexOf('returns table (', i) + 'returns table ('.length
  const hasta = sql.indexOf('\n)', desde)
  return sql.slice(desde, hasta).split('\n')
    .map(l => l.replace(/--.*$/, '').trim().replace(/,$/, ''))
    .filter(Boolean)
    .map(l => l.split(/\s+/)[0])
}

const PROHIBIDAS = [
  'efectivo_crc', 'tarjeta_crc', 'electronico_crc', 'deposito_crc', 'cheque_crc', 'cxc_crc',
  'dolares_efectivo', 'dolares_tarjeta', 'vuelto_crc', 'numero_pedido', 'total_fuente',
  'ingested_at', 'clase_ingreso',
]

describe('mig 067 — columnas de pos_ventas_tickets_rango', () => {
  const cols = columnas('pos_ventas_tickets_rango')

  it('son exactamente las que usan armarDia y las lentes (TicketVentaRow)', () => {
    expect(cols).toEqual([
      'id', 'numero_factura', 'estado', 'fecha_registra', 'fecha_cierra', 'cajero_login', 'canal',
      'mesa', 'salonero_login', 'registrado_por', 'servicio_crc', 'total_crc', 'valor_servido_crc',
      'iva_crc', 'regalia_crc', 'pax', 'pax_articulo',
    ])
  })

  it('ningún medio de pago, ni vuelto, dólares, cxc, numero_pedido, total_fuente, ingested_at, clase_ingreso', () => {
    for (const c of PROHIBIDAS) expect(cols).not.toContain(c)
  })
})

describe('mig 067 — columnas de pos_ventas_lineas', () => {
  it('lleva usuario_registra (facturas partidas) y lo que suma la neta', () => {
    expect(columnas('pos_ventas_lineas')).toEqual([
      'ticket_id', 'codigo_producto', 'nombre', 'cantidad', 'monto', 'familia', 'usuario_registra',
    ])
  })
})

describe('mig 067 — permisos', () => {
  it('revoke a public/anon y execute solo a authenticated, en las tres', () => {
    for (const fn of ['pos_ventas_tickets_rango', 'pos_ventas_lineas', 'pos_ventas_latido']) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\)\\s+from public, anon;`))
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\)\\s+to authenticated;`))
    }
    expect(codigo.match(/security definer/g)).toHaveLength(3)
    expect(codigo.match(/set search_path = public/g)).toHaveLength(3)
  })

  it('el chequeo de rol está en las tres, con la lista firmada', () => {
    const lista = /'owner', 'manager', 'contador',\s+'salonero', 'barman', 'barback', 'runner', 'cocina'/g
    expect(codigo.match(lista)).toHaveLength(3)
  })
})
