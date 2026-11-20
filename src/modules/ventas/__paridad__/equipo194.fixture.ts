// ── Fixture de PARIDAD de la 194 (agregados del equipo en la base vs las reglas de la app) ─────
//
// Datos FICTICIOS y deterministas (un LCG con semilla fija): locales, logins y productos inventados.
// Lo usan dos lados:
//   · `equipo194.paridad.test.ts` arma con esto el `DiasMap` por el MISMO camino que la app
//     (`armarDiasMap` → `aggSalonero` / `aggGeneral`) y lo compara con `equipo194.staging.json`, que es lo
//     que devolvió `pos_mi_rendimiento_equipo` en staging para estos mismos datos (transacción con ROLLBACK).
//   · `scripts/sql/194_paridad.sql` (lo genera `npx vitest run … -t "imprime el SQL"` con PARIDAD194_SQL=1)
//     inserta exactamente estas filas.
// Cubre a propósito: alias de persona (038/266), un código con vigencia (0909, dentro y fuera), un login con
// espacios, cajas, delivery de mesero, facturas X, familias 6/17/20 y sin familia, el artículo PAX, nombres
// vacíos (cae al código), cantidades con medio, y una bebida clasificada a mano con multiplicador.

import type { LineaNdfRow, TicketVentaRow } from '../../../shared/api/posNdf'
import type { ProductMap } from '../../../shared/types/ventas'

export const LOCAL_194 = 'paridad194'
export const DESDE_194 = '2026-05-08'
export const HASTA_194 = '2026-05-10'
/** Mi login (el del usuario que pide). */
export const YO_194 = 'p1'

/** Nombres por login (lo que la app saca de `employees`). El alias 266 NO tiene: sale por la persona 038. */
export const NOMBRES_194: Record<string, string> = {
  p1: 'Persona Uno', p2: 'Persona Dos', p3: 'Persona Tres', p4: 'Persona Cuatro', p5: 'Persona Cinco',
  '038': 'Persona Alias', '0909': 'Persona Vigencia',
}

/** Bebida clasificada a mano (multiplicador 2) — `product_map`. */
export const CURADO_194: ProductMap = {
  'TRAGO PARIDAD': { tipo: 'bebida', clasificacion: '', subclasificacion: '', multiplicador: 2, costo_unitario: 0 },
}

function lcg(semilla: number) {
  let s = semilla >>> 0
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32 }
}

const PRODUCTOS: Array<{ nombre: string | null; codigo: string; familia: number | null; precio: number }> = [
  { nombre: 'ROLL PARIDAD',   codigo: 'R1', familia: 3,  precio: 7876.11 },
  { nombre: 'Entrada Paridad', codigo: 'E1', familia: 2,  precio: 4247.79 },
  { nombre: 'POSTRE PARIDAD', codigo: 'D1', familia: 16, precio: 9646.02 },
  { nombre: 'CERVEZA PARIDAD', codigo: 'B1', familia: 5,  precio: 2477.88 },
  { nombre: 'TRAGO PARIDAD',  codigo: 'B2', familia: 5,  precio: 5752.21 },
  { nombre: '',               codigo: 'K1', familia: 29, precio: 1747.79 },
  { nombre: null,             codigo: 'K2', familia: 4,  precio: 4601.77 },
  { nombre: 'EXTRA PARIDAD',  codigo: 'X1', familia: 19, precio: 442.47 },
  { nombre: 'CORTESIA PAR',   codigo: 'C1', familia: 17, precio: 3000 },
  { nombre: 'PERSONAL PAR',   codigo: 'S1', familia: 6,  precio: 0 },
  { nombre: 'INGREDIENTE',    codigo: 'I1', familia: 20, precio: 1200 },
  { nombre: 'SIN FAMILIA',    codigo: 'N1', familia: null, precio: 999.5 },
]

function armar(): { tickets: TicketVentaRow[]; lineas: LineaNdfRow[] } {
  const r = lcg(192)   // semilla fija: con ella se capturó equipo194.staging.json (no cambiar)
  const tickets: TicketVentaRow[] = []
  const lineas: LineaNdfRow[] = []
  const dias = ['2026-05-08', '2026-05-09', '2026-05-10']
  // Quién vende cada día (el 10 el 0909 ya está fuera de su vigencia → «login 0909»).
  const logins = ['p1', 'p2', ' p3 ', 'p4', 'p5', '038', '266', '0909']
  let n = 0
  for (const dia of dias) {
    for (let k = 0; k < 14; k++) {
      n++
      const hora = 11 + Math.floor(r() * 13)            // 11 a 23 h CR
      const min = Math.floor(r() * 60)
      const u = r()
      const esCaja = u < 0.15
      const sinPedido = !esCaja && u < 0.22
      const login = esCaja || sinPedido ? null : logins[Math.floor(r() * logins.length)]
      const canal = r() < 0.12 ? 'delivery' : 'salon'
      const estado = r() < 0.06 ? 'X' : 'C'
      const paxArt = r() < 0.7 ? 1 + Math.floor(r() * 4) : 0
      const pax = paxArt > 0 ? paxArt : (r() < 0.5 ? 1 + Math.floor(r() * 3) : 0)
      const id = `00000000-0000-4000-8194-${String(n).padStart(12, '0')}`
      const sinLineas = r() < 0.04
      tickets.push({
        id, numero_factura: `P194-${n}`, estado, fecha_registra: `${dia}T${String(hora).padStart(2, '0')}:${String(min).padStart(2, '0')}:00-06:00`,
        fecha_cierra: null, cajero_login: hora < 16 ? '111' : '222', canal, mesa: null,
        salonero_login: login, registrado_por: esCaja ? 'cajero' : sinPedido ? 'sin_pedido' : 'salonero',
        servicio_crc: 0, total_crc: 0, valor_servido_crc: sinLineas ? 5000 + Math.round(r() * 1000) : 0,
        iva_crc: 0, regalia_crc: 0, pax, pax_articulo: paxArt,
      } as TicketVentaRow)
      if (sinLineas) continue
      const nl = 1 + Math.floor(r() * 5)
      for (let j = 0; j < nl; j++) {
        const p = PRODUCTOS[Math.floor(r() * PRODUCTOS.length)]
        const cant = r() < 0.1 ? 1.5 : 1 + Math.floor(r() * 2)
        lineas.push({ ticket_id: id, codigo_producto: p.codigo, nombre: p.nombre, cantidad: cant,
                      monto: Math.round(p.precio * cant * 100) / 100, familia: p.familia, usuario_registra: null } as LineaNdfRow)
      }
      if (paxArt > 0) {
        lineas.push({ ticket_id: id, codigo_producto: 'PAX', nombre: 'PAX', cantidad: paxArt, monto: 0, familia: 19,
                      usuario_registra: null } as LineaNdfRow)
      }
    }
  }
  return { tickets, lineas }
}

export const FIXTURE_194 = armar()

/** El SQL que inserta la fixture (para pegar en staging dentro de la transacción de la batería). */
export function sqlFixture194(): string {
  const q = (v: string | number | null) => (v === null ? 'null' : typeof v === 'number' ? String(v) : `'${v.replace(/'/g, "''")}'`)
  const t = FIXTURE_194.tickets.map(x =>
    `(${q(x.id)},${q(LOCAL_194)},${q(x.numero_factura)},${q(x.fecha_registra)},${q(x.estado)},${q(x.canal)},${q(x.salonero_login)},${q(x.cajero_login)},${q(x.registrado_por)},true,'ok',0,${q(x.valor_servido_crc)},${q(x.pax)},${q(x.pax_articulo)})`)
  const l = FIXTURE_194.lineas.map(x =>
    `(${q(x.ticket_id)},${q(x.codigo_producto)},${q(x.nombre)},${q(x.cantidad)},${q(x.monto)},${q(x.familia)})`)
  return [
    'insert into public.pos_ndf_tickets (id, local, numero_factura, fecha_registra, estado, canal, salonero_login, cajero_login, registrado_por, con_servicio, pax_alerta, total_crc, valor_servido_crc, pax, pax_articulo) values',
    t.join(',\n') + ';',
    'insert into public.pos_ndf_ticket_lines (ticket_id, codigo_producto, nombre, cantidad, monto, familia) values',
    l.join(',\n') + ';',
  ].join('\n')
}
