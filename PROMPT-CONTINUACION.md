# Continuación — backlog priorizado (handoff 2026-06-17)

Rama base: `staging` (PoS completo + FE estructura + inventario activo). Guardrails de siempre:
**nada a `main`, nada a PROD, DDL solo migraciones aditivas en staging, sagrados intactos**
(`cashUtils`, `tipCalculations`, `computeTotals`, cierres, cobro/vuelto), builds+tests verdes por
commit. Estado actual → [ESTADO.md](ESTADO.md). Flujo de mesa → `SPEC-LAVU-FLUJO-MESA.md`.

---

## 🔴 A. Espera DECISIÓN de la dueña (no avanzar sin su OK — es plata)
1. **Propina PoS → pool** (rama `propina-pool`, sin merge). Decidir: ¿propina de **tarjeta/SINPE**
   al **mismo** pool que efectivo (implementado, conservador) o **separada**? Tras su OK: validar
   físicamente y mergear a staging. Detalle: `ESTADO-PROPINA-POOL.md` en la rama `propina-pool`
   (`git show propina-pool:ESTADO-PROPINA-POOL.md`).
2. **Pase del PoS a PRODUCCIÓN.** Solo cuando la dueña valide staging. Es un programa propio (ver C).

## 🟡 B. Espera VALIDACIÓN FÍSICA en staging (ya construido, verde, sin probar en piso)
Checklist completo en [REPORTE-NOCHE-2.md](REPORTE-NOCHE-2.md). En orden de riesgo:
1. **Cobro + anti-doble-cobro** (mig 033): cobrar normal; intentar cobrar la misma mesa desde 2
   tablets → "Esta cuenta ya fue cobrada", sin duplicar.
2. **Comandero pro**: alérgenos ⚠️ en el tile, búsqueda en vivo, total sticky al pie, transiciones,
   estados vacíos con estética Satori.
3. **FE estructura (SIM)**: el ticket muestra "TIQUETE ELECTRÓNICO (SIM)" con consecutivo/clave
   simulados — **no se manda nada a Hacienda**. CIIU/CABYS editables en Gestor.
4. **Inventario activo**: cargar receta + stock, vender y **cerrar** la mesa → el stock baja por
   receta; el ticket reporta ingredientes descontados, COGS, sin-receta y bajo-stock.

## 🟢 C. Próximo trabajo de ingeniería (cuando A/B desbloqueen)
1. **Consolidar migraciones 022–037** en un pase a PROD con guard anti-staging (patrón de pases
   previos): catálogo/salón (022), orders (023), precios/KDS (024), refinamiento (025), roles+bucket
   facturas (026), cobro (027), splits+propina (028), paridad (029), foto (030), nota (031), familias
   (032), idempotencia cobro (033), ops atómicas (034), FE estructura (036), inventario COGS (037).
   **Buckets a crear en prod:** `facturas` (privado), `productos` (público), vía API como en staging.
   **Regenerar tipos de Supabase** post-merge (hoy el PoS usa el cliente laxo `sb`).
2. **FE real** (sustituir el SIM): elegir emisor certificado CR (Hacienda 4.4), implementar
   `FeProvider` real detrás de la interfaz ya existente (`src/shared/fe/feProvider.ts`). Bloqueado
   por: CIIU/CABYS de la contadora.
3. **Inventario F1 — completar** (1.4 del roadmap): orden de compra sugerida por proveedor + puente
   compra→`egreso_mercaderia`→stock al recibir (toca caja: cautela). La depleción por venta y el
   COGS ya están.

## ⚪ D. Fuera de alcance inmediato (documentado, no urgente)
- **Reabrir orden → revertir/reembolsar el pago previo** (hoy reabrir deja los pagos como historial).
  Toca caja → función pura testeada, sprint propio, máxima cautela.
- **HUB LOCAL (F5)**: impresoras ESC/POS reales vía `print-bridge/` (hoy ticket SIM).
- **Loyalty en mesa (F4)** + réplica Nosara (segundo `location_id`).
- **QuickBooks**: recategorizar el histórico de delivery/propinas electrónicas (pass-through, no gasto).
