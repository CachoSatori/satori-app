// ── La lógica PURA de «ventas desde el PoS», para la app Y para la Edge `monthly-report` ────
//
// 16-nov-2026 (decisión firmada del dueño): todo lo que lee ventas lee del PoS. La Edge no puede
// importar `src/` (Deno, otra rama de despliegue), así que en vez de reescribir el armado del día
// en otro lado (dos implementaciones que con el tiempo divergen) se EMPAQUETA esta misma entrada
// con `scripts/edge/empaquetar-ventas-pos.mjs` → `supabase/functions/monthly-report/ventasPos.gen.js`.
//
// Paridad: `ventasPosPuro.paridad.test.ts` corre el MISMO caso (`__paridad__/caso.json`) por esta
// entrada y por el paquete recién armado, y los dos tienen que dar `__paridad__/esperado.json`.
// La Edge tiene su propia prueba contra el mismo `esperado.json`.
//
// Solo cosas puras: nada de acá lee la base. La Edge lee las tablas con service_role y le pasa las
// filas con las MISMAS columnas que devuelven las funciones de la 067 (`COLS_*_067`).

export { armarDiasMap, aHistMap } from './ventasDiasDesdePos'
export { ventanaRangoJornadas } from '../../shared/api/posNdf'
export { getDayStats, fusionarProductMap } from './ventasUtils'

/** Las columnas que devuelve `pos_ventas_tickets_rango` (mig 067), en orden. */
export const COLS_TICKETS_067 = [
  'id', 'numero_factura', 'estado', 'fecha_registra', 'fecha_cierra', 'cajero_login', 'canal', 'mesa',
  'salonero_login', 'registrado_por', 'servicio_crc', 'total_crc', 'valor_servido_crc', 'iva_crc',
  'regalia_crc', 'pax', 'pax_articulo',
] as const

/** Las columnas que devuelve `pos_ventas_lineas` (mig 067), en orden. */
export const COLS_LINEAS_067 = [
  'ticket_id', 'codigo_producto', 'nombre', 'cantidad', 'monto', 'familia', 'usuario_registra',
] as const
