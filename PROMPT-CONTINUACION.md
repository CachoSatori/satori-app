# Continuación — lo único que queda del PoS

Rama base: `staging` (incluye todo el PoS: F1-F3 + comandero pro + cobro + splits + paridad).
Guardrails de siempre: nada a main, nada a PROD, DDL solo migraciones aditivas en staging,
sagrados intactos (cashUtils, tipCalculations, cierres, `computeTotals` no cambia su fórmula),
builds+tests verdes por commit. Fuente de verdad del flujo: `SPEC-LAVU-FLUJO-MESA.md` (semáforo
casi todo ✅ — paridad con Lavu alcanzada).

## ✅ Hecho (Sprints 1-3)
- Cobro base + doble moneda + vuelto (mig 027). Splits 3 modos + propina captura (mig 028).
- Paridad: combinar mesas, anular enviado, otra ronda, cantidad rápida (mig 029).

## ⭐ 1. Integración propina → pool (P1, SAGRADO — va solo, con máximo cuidado)
Conectar `pos_payments.tip_crc` con el sistema de propinas (`tip_sessions`/`tip_entries`, reparto
por `tipCalculations`). **No reimplementar el reparto** — solo alimentar el `pool_*` del turno.
Pasos: (1) al cerrar turno (o en vivo) sumar las `tip_crc` de los pagos del período al pool del
`tip_session`; (2) decisión de la dueña: ¿propina de tarjeta/SINPE al mismo pool que efectivo o
separada?; (3) conservar atribución por `current_salonero_id`. Tests dedicados + validación física
antes de mergear (es plata del equipo). Ver "Cómo conecta" en la entrada de splits de ESTADO.md.

## 2. Reabrir / re-cerrar orden con permiso (F20, P2)
Reabrir una mesa ya cobrada (corrección) con `requireManager` + traza; recalcular si se agrega algo.
Edge cases: revertir el pago/cierre, manejar la factura ya emitida (cuando exista la fiscal real).

## 3. Pase a PRODUCCIÓN de todo el PoS (cuando la dueña valide staging)
Consolidar migraciones **022–029** en UN archivo con guard anti-staging (patrón de los pases
anteriores), ejecutar en prod con autorización única + verificación de hash, y merge selectivo a
main. Incluye: locales/catálogo/salón (022), orders (023), precios/KDS (024), refinamiento (025),
roles+bucket facturas (026), cobro (027), splits+propina (028), paridad (029).
Recordar: regenerar los tipos de Supabase post-merge (hoy el PoS usa el cliente laxo `sb`).

## Integración futura (no es sprint de UI)
- **Factura electrónica fiscal** (Almendro/Alanube) sobre `pos_payments` — emitir XML al confirmar
  el pago (hoy ticket SIM). Pendiente contadora: CIIU/CABYS.
- **HUB LOCAL (F5)**: impresoras ESC/POS reales vía `print-bridge/` (hoy SIM).
