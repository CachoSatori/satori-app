# Continuación — backlog priorizado (handoff 2026-06-18)

Rama base: `staging` (PoS completo + FE estructura + inventario activo + Bandeja fusionada + enlace
proveedor + visibilidad pendientes Caja Diaria). Guardrails de siempre: **nada a `main`, nada a
PROD, DDL solo migraciones aditivas en staging, sagrados intactos** (`cashUtils`, `tipCalculations`,
`computeTotals`, cierres, cobro/vuelto), builds+tests+eslint verdes por commit. Estado actual →
[ESTADO.md](ESTADO.md). Plan por fases → [ROADMAP.md](ROADMAP.md).

Marcadores: 🖊️ **espera FIRMA de la dueña (plata)** · 👁️ **espera VALIDACIÓN FÍSICA en staging** ·
🟢 ingeniería lista para arrancar.

---

## 1. 🖊️ Aplicar la MIGRACIÓN 038 a staging (cuando la dueña firme) — DESBLOQUEANTE
`supabase/migrations/038_bandeja_fusion.sql` ya existe, es **aditiva e idempotente**, y **NO está
aplicada a ninguna base**. Habilita PLATA, por eso espera firma. Agrega:
- `cash_movements.factura_verified_by/at` (quién + cuándo verificó la factura),
- policy RLS de INSERT no-efectivo para el rol **`contador`**,
- RPC `mark_factura_verified` (SECURITY DEFINER).

**Hasta aplicarla:** el contador NO puede registrar desde la Bandeja y el botón "✓ Verificar" falla
por RLS (gating intencional). **Tras firmar:** aplicar SOLO en staging (`hwiatgicyyqyezqwldia`),
**nunca** en prod; luego **regenerar los tipos de Supabase**.

> `fix/fecha-cr-consistente` ya está **MERGEADO a staging** (merge `cb25672`). **Pendiente
> validación física:** Movimientos de noche + P&L borde de mes (validar contra un cierre mensual).

## 2. 🟢 ETAPA 2 — entrada única foto-primero 100% dentro de Caja Diaria (diseñada, pendiente)
La Bandeja Etapa 1 ya está validada por la dueña. Etapa 2 lleva el flujo entero adentro de Caja:
- **Una sola entrada foto-primero** dentro de **Caja Diaria**; se **retira** el camino `facturas`
  (queda legacy, no se borra).
- **Foto OBLIGATORIA** por pago (objetivo: toda factura termina con foto).
- **La IA lee todo y SUGIERE** tipo/categoría (mercadería / operativo / personal / socios) mapeando a
  las **categorías existentes**; el **humano confirma** (la IA puede equivocarse, nunca auto-commit).
- **Propinas:** en vez de pedir proveedor, pide **turno (AM/PM) + fecha** y **concilia el pendiente**
  de propinas correspondiente.
- **Offline — Opción A:** se registra el pago igual sin red; la IA procesa la foto al volver internet.

## 3. 👁️🟢 Estabilidad de la PWA — URGENTE
La app **se traba** y hay que **borrar la caché** para ver datos nuevos (service worker). Es el
problema #1 reportado por la operación. Atacar el ciclo de vida del SW / estrategia de cache /
auto-update. Ver notas previas en `HANG-RCA.md` y `OFFLINE.md`.

## 4. 👁️ Validación FÍSICA pendiente en staging (ya construido, verde, sin probar en piso)
Checklist en [REPORTE-NOCHE-2.md](REPORTE-NOCHE-2.md). En orden de riesgo:
1. **Cobro + anti-doble-cobro** (mig 033): cobrar desde 2 tablets la misma mesa → "ya fue cobrada".
2. **Comandero pro**: alérgenos ⚠️ en tile, búsqueda en vivo, total sticky, estados vacíos Satori.
3. **FE estructura (SIM)**: ticket "TIQUETE ELECTRÓNICO (SIM)" — no se manda nada a Hacienda.
4. **Inventario activo**: cargar receta + stock, vender y cerrar → el stock baja por receta + COGS.

## 5. 🟢 Deudas a futuro (documentadas, no urgentes)
- **Cuentas por pagar / crédito a proveedores 7-15-30 días** (fecha de PAGO ≠ fecha de registro).
- **Alerta de cambio de precio** de un producto (que el contador la detecte → ajustar la receta).
- **Offline robusto** con base local que sincroniza con Supabase al volver internet.
- **P&L — borde de año en UTC:** `getLiveActuals` (`finance.ts`) todavía **acota por `created_at`
  en UTC** en el rango de la consulta → un gasto del 31-dic de noche puede caer en el año/mes
  equivocado. Pasar también ese filtro a CR (el mes ya se atribuye con `dateCR` tras
  `fix/fecha-cr-consistente`).
- **Unidades de inventario por presentación** (kilo/litro/gramos; huevos por maple/caja) editables
  por ingrediente y recordadas por proveedor.
- **Pase del PoS a PROD:** consolidar 022–038 con guard anti-staging; buckets `facturas`/`productos`/
  `documents` en prod; regenerar tipos. Requiere autorización única + verificación de hash.
- **DECISIÓN dueña — propina PoS → pool** (rama `propina-pool`): ¿tarjeta/SINPE al mismo pool que
  efectivo o separada? `git show propina-pool:ESTADO-PROPINA-POOL.md`.
- **FE real:** emisor certificado CR (Hacienda 4.4) detrás de `FeProvider`. Bloqueado por CIIU/CABYS.
