# Continuación — Backlog del PoS (post F3 cobro)

Rama base: `staging` (incluye comandero-pro + f3-cobro). Guardrails de siempre: nada a main,
nada a PROD, DDL solo migraciones aditivas en staging, sagrados intactos (cashUtils,
tipCalculations, cierres, `computeTotals` no cambia su fórmula), builds+tests verdes por commit.
Fuente de verdad del flujo: `SPEC-LAVU-FLUJO-MESA.md`.

## ✅ Hecho (Sprint 1 + 2)
- F16 cobro base, F17 doble moneda, F18 vuelto (rama `f3-cobro`, mig 027).
- F15 split 3 modos + des-dividir, F19 **captura** de propina (rama `f3-splits`, mig 028).

## ⭐ Próximo sprint sugerido — "Propina → pool" (P1, SAGRADO, va solo y con cuidado)
Integrar `pos_payments.tip_crc` con el sistema de propinas existente (`tip_sessions`/`tip_entries`,
reparto por `tipCalculations`). **No reimplementar el reparto** — solo alimentar el `pool_*` del
turno. Pasos: (1) al cerrar el turno (o en tiempo real), sumar las `tip_crc` de los pagos del
período al pool del `tip_session`; (2) decisión de la dueña: ¿propina de tarjeta/SINPE al mismo pool
que efectivo o separada?; (3) conservar atribución por `current_salonero_id` para reportes.
Tests dedicados + validación física antes de mergear (es plata del equipo). Ver "Cómo conecta" en
ESTADO.md.

## Otros P1 (en orden)
1. **Anular ítem ENVIADO / void (F10)**: con motivo + `verify_manager` (server-side, ya existe) +
   ticket de anulación (cuando llegue impresión real). Hoy solo se deshace marchar dentro de 20s.
2. **Repetir ronda / qty rápida (F11/F12)**: re-tocar tile suma qty; "repetir ítem" clona fila.

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
