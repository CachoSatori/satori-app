# Continuación — lo único que queda del PoS

Rama base: `staging` (PoS completo: F1-F3 + comandero pro + cobro + splits + paridad + fotos + F20).
Guardrails de siempre: nada a main, nada a PROD, DDL solo migraciones aditivas en staging, sagrados
intactos (cashUtils, tipCalculations, cierres, `computeTotals` no cambia su fórmula), builds+tests
verdes por commit. Fuente de verdad del flujo: `SPEC-LAVU-FLUJO-MESA.md` — **paridad Lavu completa**.

## ✅ Hecho (Sprints 1-4)
- Cobro base + doble moneda + vuelto (027). Splits 3 modos + propina captura (028).
- Paridad: combinar, anular enviado, otra ronda, cantidad rápida (029). Reabrir/recerrar F20 (029).
- Foto de producto en el tile (030).

## ⭐ 1. Integración propina → pool (P1, SAGRADO — va solo, máximo cuidado)
Conectar `pos_payments.tip_crc` con el sistema de propinas (`tip_sessions`/`tip_entries`, reparto
por `tipCalculations`). **No reimplementar el reparto** — solo alimentar el `pool_*` del turno.
Pasos: (1) al cerrar turno (o en vivo) sumar las `tip_crc` de los pagos del período al pool del
`tip_session`; (2) decisión de la dueña: ¿propina de tarjeta/SINPE al mismo pool que efectivo o
separada?; (3) conservar atribución por `current_salonero_id`. Tests dedicados + validación física
antes de mergear (es plata del equipo).

## 2. Pase a PRODUCCIÓN de todo el PoS (cuando la dueña valide staging)
Consolidar migraciones **022–030** en UN archivo con guard anti-staging (patrón de los pases
anteriores), ejecutar en prod con autorización única + verificación de hash, y merge selectivo a
main. Incluye: locales/catálogo/salón (022), orders (023), precios/KDS (024), refinamiento (025),
roles+bucket facturas (026), cobro (027), splits+propina (028), paridad (029), foto producto (030).
**Buckets a crear en prod**: `facturas` (privado), `productos` (público) — vía API como en staging.
Recordar: regenerar los tipos de Supabase post-merge (hoy el PoS usa el cliente laxo `sb`).

## Alcance que quedó FUERA (documentado, no urgente)
- **Reabrir orden — revertir/reembolsar el pago previo**: hoy reabrir deja los pagos como historial
  (no los revierte). Si se necesita anular un cobro/devolver plata, es función pura testeada +
  máxima cautela, en su propio sprint (toca caja).
- **Factura electrónica fiscal** (Almendro/Alanube) sobre `pos_payments` — emitir XML al confirmar
  el pago (hoy ticket SIM). Pendiente contadora: CIIU/CABYS.
- **HUB LOCAL (F5)**: impresoras ESC/POS reales vía `print-bridge/` (hoy SIM).
