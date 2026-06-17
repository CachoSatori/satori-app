# Satori App — Estado del proyecto

> Restaurant POS + analítica · Satori Sushi Bar, Santa Teresa & Nosara, Costa Rica
> **Handoff: 2026-06-17.** Este archivo es la foto compacta para ponerse al día de un vistazo.
> Historia detallada (changelog completo sprint a sprint) → [ESTADO-ARCHIVO.md](ESTADO-ARCHIVO.md).
> Plan por fases → [ROADMAP.md](ROADMAP.md) · Backlog priorizado → [PROMPT-CONTINUACION.md](PROMPT-CONTINUACION.md).

**Stack:** React 19 + TS strict + Vite + PWA · Supabase (Postgres + RLS + Edge Functions) · realtime.
**Despliegue:** push a `main` → GitHub Pages (PROD, base `/satori-app/`) · `staging` → Cloudflare Pages (`satori-staging.pages.dev`).

---

## (a) Ramas

| Rama | Hash | Qué es |
|---|---|---|
| `main` | `cb100de` | **PRODUCCIÓN.** Capa de inteligencia (ventas/propinas/caja/reportes). Intacta — el PoS aún NO está acá. |
| `staging` | `956775d` | **Todo el PoS + KDS + comandero pro + FE estructura + inventario activo.** 72 commits delante de main. Fuente de verdad del trabajo nuevo. |
| `propina-pool` | `312f5df` | ⚠️ **SIN merge.** Propina PoS → pool del turno. Espera validación de la dueña (es plata del equipo). |
| `fix-doble-cobro` | `c308dfd` | Fix 🔴 doble-cobro original. Su contenido **ya vive en staging** (mig 033); la rama queda como referencia. |

> Supabase refs: **PROD** = `yiczgdtirrkdvohdquzf` (intocable, solo lectura, requiere OK explícito de la dueña + verificación de hash) · **STAGING** = `hwiatgicyyqyezqwldia`.

## (b) PROD vs STAGING

- **En PROD (`main`):** ventas/analítica (16 vistas), propinas (pool por turno, coberturas, quincenal, stats), caja (turnos, cierre del día 2 fases, movimientos, pendientes por proveedor), ingesta por foto (Claude Haiku), finanzas/P&L, reportes + emails, admin, auth Fase 2, realtime, offline-first. Migraciones **001–021**.
- **Solo en STAGING (no en prod):** **todo el sistema PoS** — catálogo+salón multi-local, comandero en tablet, KDS web, cobro+doble moneda+vuelto, splits, propina capturada en el cobro, paridad Lavu (combinar/anular/otra ronda/cantidad), foto de producto, reabrir orden, jerarquía de menú 3 niveles, carta real (542 productos), modelo fiscal `computeTotals`, **FE estructura (SIM)**, **inventario activo (depleción por venta + COGS)**. Migraciones **022–037** (ver abajo).
- **En rama aparte (ni prod ni staging):** integración propina→pool (mig 035, rama `propina-pool`).

## (c) Migraciones

| Entorno | Hasta | Notas |
|---|---|---|
| **PROD** | **021** | 001–020 = inteligencia/caja/auth/realtime. 021 = offline idempotencia. |
| **STAGING** | **037** | 022–034 PoS · 036 FE estructura · 037 inventario COGS. **035 NO está en staging** (vive solo en `propina-pool`, sin merge). |

> El salto 021→037 (todo el PoS) es exactamente lo que falta consolidar y pasar a prod cuando la dueña valide. Las tablas de inventario (`ingredients`/`recipes`/`recipe_ingredients`/`inventory_movements`) existen en staging desde el baseline `0095_drift_baseline.sql` (no por migración numerada).

## (d) Lo construido, por módulo

Leyenda: ✅ validado por la dueña / 🟢 hecho y verde (tests+build) pero **sin validación física** / ⏳ pendiente.

| Módulo | Estado | Dónde | Nota |
|---|---|---|---|
| Ventas / analítica | ✅ | prod | maduro |
| Propinas (reparto) | ✅ | prod | `tipCalculations` SAGRADO |
| Caja + cierre del día | ✅ | prod | `cashUtils` SAGRADO |
| Ingesta por foto (IA) | ✅ | prod | Claude Haiku, esquema CR |
| Finanzas / P&L · Reportes · Admin · Auth · Realtime · Offline | ✅ | prod | — |
| PoS — catálogo/salón/multi-local (022) | 🟢 | staging | — |
| PoS — comandero tablet (pax, asiento, cursos, marchar) | 🟢 | staging | + comandero "pro" T4 (alérgenos en tile, búsqueda en vivo, total sticky, estética Satori) |
| PoS — KDS web (ruteo estación, timers, postres) | 🟢 | staging | impresión real ESC/POS = futuro (F5) |
| PoS — cobro + doble moneda + vuelto + ticket SIM (027) | 🟢 | staging | `computeTotals` SAGRADO. Anti-doble-cobro (033) incluido |
| PoS — splits 3 modos + propina capturada (028) | 🟢 | staging | la propina se **captura**; el reparto al pool es `propina-pool` (sin merge) |
| PoS — paridad: combinar/anular/otra ronda/cantidad (029) | 🟢 | staging | ops atómicas vía RPC (034) |
| PoS — foto producto (030) · nota ítem (031) · jerarquía menú (032) | 🟢 | staging | — |
| PoS — carta real (542 productos) | 🟢 | staging | solo staging; estación a ajustar en Gestor |
| **FE — estructura (SIM, sin Hacienda)** (036) | 🟢 | staging | `fe_documentos` + `feProvider` SIM + CIIU/CABYS en Gestor. **No emite real.** |
| **Inventario activo F1 — depleción por venta + COGS** (037) | 🟢 | staging | descuenta stock por receta al cerrar pedido (idempotente); COGS real; alertas por mínimo |
| Inventario — carga/recetas/food-cost UI | 🟡 | staging/prod-UI | UI existe; depleción desde PoS = lo nuevo en staging |

## (e) Pendientes de PLATA — sin firma de la dueña (NO mergear sin OK)

1. **`fix-doble-cobro`** → ya está en staging (mig 033). **Falta:** validación física + decisión de pase a PROD. La matemática del cobro NO se tocó; solo la persistencia (RPC atómica + `client_op_id` UNIQUE).
2. **`propina-pool`** (rama, sin merge) → conecta `pos_payments.tip_crc` al pool del turno **sin tocar `tipCalculations`**. **DECISIÓN-PRODUCTO abierta:** propina de tarjeta/SINPE ¿al mismo pool que efectivo (implementado, conservador) o separada (switch documentado)? Reporte `ESTADO-PROPINA-POOL.md` (vive **en la rama `propina-pool`**: `git show propina-pool:ESTADO-PROPINA-POOL.md`).

## (f) Pendientes humanos / fiscales

- **Contadora:** códigos **CIIU/CABYS** del menú (campos ya existen en Gestor con aviso "pendiente"). Necesarios antes de FE real.
- **FE real:** elegir emisor certificado CR (Hacienda 4.4) e implementar `FeProvider` real (hoy solo SIM). Ver F0/F3 del roadmap.
- **Pase del PoS a PROD:** consolidar migraciones 022–037 con guard anti-staging, crear buckets `facturas` (privado) y `productos` (público) en prod, regenerar tipos de Supabase post-merge. Requiere autorización única + verificación de hash.
- **Validación física en staging** (la dueña): comandero pro, FE-SIM en el ticket, inventario que baja al cerrar. Checklist en [REPORTE-NOCHE-2.md](REPORTE-NOCHE-2.md).
- **Hardware piloto:** router con backup LTE, mini-PC (hub/KDS), 3 térmicas 3nStar RPT004, tablets, TVs.

---

## Sagrados (NUNCA reimplementar sin acuerdo explícito)
`cashUtils` · `tipCalculations` · `computeTotals` (fórmula fiscal) · cierres de caja · cobro/vuelto/conversión.
Todo el trabajo nuevo los **alimenta**, no los cambia.
