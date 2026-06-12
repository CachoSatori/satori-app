# Continuación — Comandero pro P2 (backlog restante)

Rama base: `comandero-pro` (ya en staging). Guardrails de siempre: nada a main, nada a PROD,
DDL solo migraciones aditivas en staging, sagrados intactos, builds+tests verdes por commit.

Pendiente del backlog (SPEC-COMANDERO-UX.md §4, orden P2):
1. **Cantidad rápida (qty)**: re-tocar un tile ya agregado del mismo ítem/asiento suma a la fila
   (qty++) en vez de crear otra; UI ×2/×3 en la fila. Hoy cada tap = fila qty 1. El modelo ya
   tiene `qty` y computeTotals lo respeta — es UI + un merge de filas idénticas no marchadas.
2. **Repetir ítem**: botón "repetir" en una fila → clona ítem (mismo producto/mods/asiento/curso).
3. **Favoritos / más vendidos**: ordenar los tiles de cada categoría por frecuencia de venta
   (consulta a ventas históricas o contador en pos_order_items). Primero los top.
4. **Void post-cocina con motivo**: anular un ítem YA marchado con motivo (out of stock, error),
   con autorización de gerencia (verify_manager) — necesita el ticket de anulación de F3/impresión.

Pendiente fuera de este sprint: pase del watchdog PWA a main (YA HECHO: main=cb100de) — verificar
que la dueña validó; PoS + roles + comandero-pro a prod cuando ella valide staging.
