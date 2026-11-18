// ── La lógica PURA del «Detalle por día», para la pantalla Y para la Edge `ventas-dia-contador` ──
//
// 17-nov-2026 (pedido del dueño): los días 1 y 16 sale un correo al negocio con el detalle por día de la
// quincena cerrada (Excel + CSV) para reenviárselo al contador. La Edge no puede importar `src/`
// (Deno), así que, como `monthly-report`, usa un PAQUETE de esta entrada:
//   node scripts/edge/empaquetar-ventas-pos.mjs --entrada src/modules/ventas/ventasDiaContadorPuro.ts \
//        supabase/functions/ventas-dia-contador/ventasPos.gen.js
// Lo que exporta es lo MISMO que usa «Ventas → Contabilidad»: el armado del día desde el PoS
// (`armarDiasMap` → `getDayStats`), las filas (`getContabilidadDays`), la fila TOTAL
// (`totalesContabilidad`) y el día de la semana (`dayOfWeek` + `dowLabel`).
// La prueba de contrato (`supabase/functions/ventas-dia-contador/contrato.test.ts`) arma el paquete en
// memoria y exige que coincida con el archivo commiteado y con la pantalla para el mismo rango.

export * from './ventasPosPuro'
export { getContabilidadDays, totalesContabilidad, dayOfWeek, dowLabel } from './ventasUtils'
