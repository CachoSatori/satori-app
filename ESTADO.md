# Satori App — Estado del proyecto

> Restaurant POS + analítica · Satori Sushi Bar, Santa Teresa & Nosara, Costa Rica
> **Handoff: 2026-06-18.** Este archivo es la foto compacta para ponerse al día de un vistazo.
> Historia detallada (changelog completo sprint a sprint) → [ESTADO-ARCHIVO.md](ESTADO-ARCHIVO.md).
> Plan por fases → [ROADMAP.md](ROADMAP.md) · Backlog priorizado → [PROMPT-CONTINUACION.md](PROMPT-CONTINUACION.md).

**Stack:** React 19 + TS strict + Vite + PWA · Supabase (Postgres + RLS + Edge Functions) · realtime.
**Despliegue:** push a `main` → GitHub Pages (PROD, base `/satori-app/`) · `staging` → Cloudflare Pages (`satori-staging.pages.dev`).

---

## (a) Ramas

| Rama | Hash | Qué es |
|---|---|---|
| `main` | `cb100de` | **PRODUCCIÓN.** Capa de inteligencia (ventas/propinas/caja/reportes). El PoS y la Bandeja fusionada NO están acá. |
| `staging` | `cb25672` | **Fuente de verdad del trabajo nuevo.** Todo el PoS + KDS + comandero pro + FE estructura + inventario activo + **Bandeja fusionada + enlace proveedor + visibilidad pendientes Caja Diaria + fechas CR**. |
| `fix/fecha-cr-consistente` | `eec4281` | **MERGEADO a staging** (merge `cb25672`). Corrige el desfase UTC de noche en Movimientos/Pendientes/P&L (`finance.ts`). **Pendiente validación física:** Movimientos de noche + P&L borde de mes (validar contra un cierre mensual). Rama queda como referencia. |
| `propina-pool` | `312f5df` | ⚠️ **SIN merge.** Propina PoS → pool del turno. Espera DECISIÓN de la dueña (es plata del equipo). |
| `fix-doble-cobro` | `c308dfd` | Fix 🔴 doble-cobro original. Su contenido **ya vive en staging** (mig 033); la rama queda como referencia. |
| `fix/proveedor-link` | `879b541` | Enlace proveedor↔caja. **Ya mergeada** a staging (`b44e004`). Referencia. |
| `fix/caja-diaria-pendientes-vis` | `d732c78` | Visibilidad pendientes Caja Diaria. **Ya mergeada** a staging (`66686d7`). Referencia. |

> Supabase refs: **PROD** = `yiczgdtirrkdvohdquzf` (intocable, solo lectura, requiere OK explícito de la dueña + verificación de hash) · **STAGING** = `hwiatgicyyqyezqwldia`.

## (b) PROD vs STAGING

- **En PROD (`main`):** ventas/analítica (16 vistas), propinas (pool por turno, coberturas, quincenal, stats), caja (turnos, cierre del día 2 fases, movimientos, pendientes por proveedor), ingesta por foto **vieja** (1 bandeja por foto), finanzas/P&L, reportes + emails, admin, auth Fase 2, realtime, offline-first. Migraciones **001–021**.
- **Solo en STAGING (no en prod):**
  - **Todo el sistema PoS** — catálogo+salón multi-local, comandero tablet, KDS web, cobro+doble moneda+vuelto, splits, propina capturada, paridad Lavu, foto de producto, jerarquía de menú 3 niveles, carta real (542 productos), modelo fiscal `computeTotals`, **FE estructura (SIM)**, **inventario activo (depleción + COGS)**. Migraciones **022–037**.
  - **Bandeja fusionada** (`/inbox`, IA): una sola bandeja foto-primero; se eliminó "Bandeja Proveedores" (`/proveedor` + `ProveedorBandeja.tsx` + tile + ROLE_LANDING). El valor de rol `proveedor` queda **muerto** en el enum (DDL solo aditivo, no se borró). Matriz de pago por rol + verificado de factura (`FacturaVerify`). Commits `aa0db28`+`fd3cb03`, merge `da53466`.
  - **Enlace proveedor↔caja** (`b44e004`): la Bandeja resuelve `supplier_id` (match por nombre trim+case-insensitive o alta mínima) en los 4 caminos; el pago aparece bajo su proveedor en Caja→Proveedores con estado + foto (📷 / "⚠ falta factura" + agregar foto → bucket `documents` + IA + inventario). Cambio aditivo `cash.ts`: `createDayMovement` acepta `supplier_id`.
  - **Visibilidad pendientes Caja Diaria** (`66686d7`): muestra los pagos transferencia-pendiente nivel-día (solo-lectura, NO tocan la matemática del efectivo). `created_at` de altas nivel-día = **día de registro** (la fecha de factura va a la descripción como `· fact <fecha>`). Helper `dateCR` (compara en hora CR). **Opción A** elegida por la dueña: el P&L cuenta el gasto por fecha de registro.
  - **Fechas en hora CR** (merge `cb25672`): Movimientos (filtro día), Pendientes (fecha mostrada) y finance.ts (mes del P&L) atribuyen día/mes en hora de Costa Rica (`dateCR`) — corrige el desfase UTC de noche. Solo cambia la atribución en las vistas, no la matemática.
- **En rama aparte (ni prod ni staging):** integración propina→pool (mig 035, rama `propina-pool`, sin merge).

## (c) Migraciones

| Entorno | Hasta | Notas |
|---|---|---|
| **PROD** | **021** | 001–020 = inteligencia/caja/auth/realtime. 021 = offline idempotencia. |
| **STAGING** | **037** | 022–034 PoS · 036 FE estructura · 037 inventario COGS. **035 NO** (vive en `propina-pool`). **038 NO** (ver abajo). |

> ⚠️ **Migración 038 (`supabase/migrations/038_bandeja_fusion.sql`) EXISTE en el repo pero NO está aplicada a NINGUNA base (ni staging ni prod). Espera FIRMA de la dueña** (es permiso de PLATA). Agrega: columnas `cash_movements.factura_verified_by/at`, policy RLS de INSERT no-efectivo para el rol `contador`, y RPC `mark_factura_verified` (SECURITY DEFINER). **Hasta aplicarla:** el contador NO puede registrar desde la Bandeja y el botón "✓ Verificar" falla por RLS (gating intencional, no es bug). El salto 021→037 (todo el PoS) es lo que falta consolidar y pasar a prod cuando la dueña valide.

> **Edge Function `extract-document`:** desplegada al proyecto **STAGING** (ref `hwiatgicyyqyezqwldia`), con `ANTHROPIC_API_KEY` seteado por la dueña → la lectura por IA de facturas ya opera en staging. NO en prod.

## (d) Lo construido, por módulo

Leyenda: ✅ validado por la dueña / 🟢 hecho y verde (tests+build) pero **sin validación física** / 🟡 parcial / ⏳ pendiente.

| Módulo | Estado | Dónde | Nota |
|---|---|---|---|
| Ventas / analítica | ✅ | prod | maduro |
| Propinas (reparto) | ✅ | prod | `tipCalculations` SAGRADO |
| Caja + cierre del día | ✅ | prod | `cashUtils` SAGRADO |
| Ingesta por foto (IA) — bandeja vieja | ✅ | prod | Claude Haiku, esquema CR |
| Finanzas / P&L · Reportes · Admin · Auth · Realtime · Offline | ✅ | prod | — |
| **Bandeja fusionada + enlace proveedor + visibilidad pendientes Caja** | ✅ **Etapa 1** | staging | **Validada físicamente por la dueña en staging.** Foto-primero, matriz de pago por rol, supplier_id real, pendientes nivel-día visibles. Depende de **mig 038** para que el contador registre/verifique. |
| PoS — catálogo/salón/multi-local (022) | 🟢 | staging | — |
| PoS — comandero tablet + "pro" T4 | 🟢 | staging | alérgenos en tile, búsqueda en vivo, total sticky, estética Satori |
| PoS — KDS web | 🟢 | staging | impresión real ESC/POS = futuro (F5) |
| PoS — cobro + doble moneda + vuelto + ticket SIM (027) | 🟢 | staging | `computeTotals` SAGRADO. Anti-doble-cobro (033) incluido |
| PoS — splits + propina capturada (028) | 🟢 | staging | reparto al pool = `propina-pool` (sin merge) |
| PoS — paridad combinar/anular/otra ronda/cantidad (029) | 🟢 | staging | ops atómicas vía RPC (034) |
| PoS — foto producto (030) · nota ítem (031) · jerarquía menú (032) · carta real (542) | 🟢 | staging | — |
| FE — estructura (SIM, sin Hacienda) (036) | 🟢 | staging | `fe_documentos` + `feProvider` SIM. **No emite real.** |
| Inventario activo F1 — depleción + COGS (037) | 🟢 | staging | descuenta stock por receta al cerrar pedido (idempotente); COGS real; alertas por mínimo |

## (e) Pendientes de PLATA — sin firma de la dueña (NO mergear/aplicar sin OK)

1. **Migración 038** (Bandeja fusión) → **espera FIRMA.** Sin ella, el contador no registra desde la Bandeja y "✓ Verificar" falla por RLS. Aplicar SOLO en staging tras firma; luego regenerar tipos de Supabase.
2. **`propina-pool`** (rama, sin merge) → conecta `pos_payments.tip_crc` al pool del turno **sin tocar `tipCalculations`**. **DECISIÓN-PRODUCTO abierta:** propina de tarjeta/SINPE ¿al mismo pool que efectivo (implementado, conservador) o separada? Reporte `ESTADO-PROPINA-POOL.md` (vive en la rama: `git show propina-pool:ESTADO-PROPINA-POOL.md`).
3. **`fix-doble-cobro`** → ya está en staging (mig 033). Falta validación física + decisión de pase a PROD. La matemática del cobro NO se tocó; solo la persistencia (RPC atómica + `client_op_id` UNIQUE).
4. **`fix/fecha-cr-consistente`** — **MERGEADO a staging** (`cb25672`). Cambia la atribución de **mes CR** de gastos de noche en el P&L. **Pendiente validación física:** Movimientos de noche + P&L borde de mes (validar contra un cierre mensual conocido).

## (f) Pendientes humanos / fiscales

- **Firma de la mig 038** (la dueña): habilita contador + verificado de factura en la Bandeja.
- **Contadora:** códigos **CIIU/CABYS** del menú (campos ya existen en Gestor con aviso "pendiente"). Necesarios antes de FE real.
- **FE real:** elegir emisor certificado CR (Hacienda 4.4) e implementar `FeProvider` real (hoy solo SIM).
- **Pase del PoS a PROD:** consolidar migraciones 022–038 con guard anti-staging, crear buckets `facturas`/`productos`/`documents` en prod, regenerar tipos post-merge. Requiere autorización única + verificación de hash.
- **Validación física en staging** (la dueña): comandero pro, FE-SIM en el ticket, inventario que baja al cerrar. (Bandeja Etapa 1 ya validada.) Checklist en [REPORTE-NOCHE-2.md](REPORTE-NOCHE-2.md).
- **Hardware piloto:** router con backup LTE, mini-PC (hub/KDS), 3 térmicas 3nStar RPT004, tablets, TVs.

---

## Sagrados (NUNCA reimplementar sin acuerdo explícito)
`cashUtils` · `tipCalculations` · `computeTotals` (fórmula fiscal) · cierres de caja · cobro/vuelto/conversión.
Todo el trabajo nuevo los **alimenta**, no los cambia.
