# Continuación — Backlog del PoS (post F3 cobro)

Rama base: `staging` (incluye comandero-pro + f3-cobro). Guardrails de siempre: nada a main,
nada a PROD, DDL solo migraciones aditivas en staging, sagrados intactos (cashUtils,
tipCalculations, cierres, `computeTotals` no cambia su fórmula), builds+tests verdes por commit.
Fuente de verdad del flujo: `SPEC-LAVU-FLUJO-MESA.md`.

## Próximo sprint sugerido — "F3 cobro avanzado" (P1, en orden)
1. **Split de cuenta (F15, 3 modos como Lavu)**: por asiento / por ítems / equitativo entre N.
   `pos_payments` ya admite varias filas por `order_id` (no hay deuda de schema). La cuenta cierra
   cuando la suma de pagos cubre el total. Función pura `splitTotalCrc` (firma reservada en SPEC).
2. **Propina en el cobro (F19)**: línea de propina (monto o %) que va al **pool del turno**
   (`tip_sessions`/`tip_entries`) — respetar la matemática sagrada de tipCalculations, solo alimentar.
3. **Anular ítem ENVIADO / void (F10)**: con motivo + `verify_manager` (server-side, ya existe) +
   ticket de anulación (cuando llegue impresión real). Hoy solo se deshace marchar dentro de 20s.
4. **Repetir ronda / qty rápida (F11/F12)**: re-tocar tile suma qty; "repetir ítem" clona fila.

## Backlog P2 (Comandero pro — SPEC-COMANDERO-UX.md §4)
- Cantidad rápida (qty) con merge de filas idénticas no marchadas; "repetir ítem".
- Favoritos / más vendidos primero en cada categoría del grid.
- Combinar mesas con deshacer (F14). Nombres de invitado por asiento (F3). Hold real (F4).
- Reabrir / re-cerrar cuenta con permiso (F20).

## Integración futura (no es sprint de UI)
- **Factura electrónica fiscal** (Almendro/Alanube) sobre `pos_payments` — agregar campos `fiscal_*`
  y emitir el XML al confirmar el pago (hoy es ticket SIM interno). Pendiente contadora: CIIU/CABYS.
- **HUB LOCAL (F5)**: impresoras ESC/POS reales vía `print-bridge/` (hoy en modo SIM).

## Estado de los pases a producción (todo GATEADO a validación física de la dueña)
- `main` = `cb100de` (watchdog PWA, ya en prod).
- En `staging` esperando validación: operación por roles (mig 026), comandero pro, F3 cobro (mig 027).
- Cuando la dueña valide: consolidar migraciones **022–027** en un archivo con guard anti-staging,
  ejecutar en prod con autorización única + verificación de hash, y merge selectivo a main.
