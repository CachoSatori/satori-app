# Satori App — Estado del proyecto

> Restaurant POS + analítica · Satori Sushi Bar, Santa Teresa & Nosara, Costa Rica
> **Handoff: 2026-06-22.** Foto compacta para ponerse al día de un vistazo.
> Historia detallada → [ESTADO-ARCHIVO.md](ESTADO-ARCHIVO.md) · Plan por fases → [ROADMAP.md](ROADMAP.md) · Backlog → [PROMPT-CONTINUACION.md](PROMPT-CONTINUACION.md).

**Stack:** React 19 + TS strict + Vite + PWA · Supabase (Postgres + RLS + Edge Functions) · realtime.
**Despliegue:** push a `main` → GitHub Pages (PROD, base `/satori-app/`) · `staging` → Cloudflare Pages (`satori-staging.pages.dev`).

> **Diagnóstico del "se traba" — TRES causas independientes:** (a) **SW viejo pegado** y (b) **fechas de
> borde de mes** (400 por `-31`) → ambas RESUELTAS y EN PROD. (c) **Contención del candado de auth**
> (`navigator.locks`) disparada por Realtime → RESUELTA **solo en STAGING** (saga Realtime/candado, jun-22).
> **⚠️ PROD (`ff836a0`) todavía NO tiene el arreglo (c): el bug de trabarse sigue VIVO en producción**
> hasta el pase por canario. NO era el equipo, ni la red, ni el login. Detalle de (c) → §(d) y §(f).

---

## (a) Ramas

| Rama | Hash | Qué es |
|---|---|---|
| `main` | `ff836a0` | **PRODUCCIÓN.** Capa de inteligencia (ventas/propinas/caja/reportes) **+ fix del SW viejo** (`fde9264`) **+ fix de fechas-borde** (`ff836a0`). El PoS, la Bandeja fusionada y **el arreglo Realtime/candado de auth NO están acá**. |
| `staging` | `23c6bc8` | **Fuente de verdad del trabajo nuevo.** Todo el PoS + KDS + comandero pro + FE estructura + inventario activo + Bandeja fusionada + enlace proveedor + visibilidad pendientes + fechas CR + **los dos fixes que ya están en prod** + **la saga Realtime/candado de auth (jun-22, solo acá)**. |

**Ramas de referencia (ya mergeadas o sin merge):** `fix/pwa-sw-update-prod` (SW fix, en staging `5beb8ff` y prod `fde9264`) · `fix/fechas-borde-mes` (fechas, en staging `e0404a9` y prod `ff836a0`) · `fix/fecha-cr-consistente` (`cb25672`, en staging, **pendiente validación física**) · **saga Realtime/candado (todas mergeadas a staging):** `fix/realtime-jwt-refresh` (round 1) · `fix/realtime-socket-revive` (round 2, **luego REVERTIDO**) · `fix/auth-lock-contention` (fix final, `09480a6`) · `propina-pool` (`312f5df`, **SIN merge**, espera decisión dueña) · `fix-doble-cobro`/`fix/proveedor-link`/`fix/caja-diaria-pendientes-vis` (ya en staging).

> Supabase refs: **PROD** = `yiczgdtirrkdvohdquzf` (intocable, solo lectura, OK explícito + verificación de hash) · **STAGING** = `hwiatgicyyqyezqwldia`.

## (b) PROD vs STAGING

- **En PROD (`main` `ff836a0`):** ventas/analítica (16 vistas), propinas (pool por turno, coberturas, quincenal, stats), caja (turnos, cierre del día 2 fases, movimientos, pendientes por proveedor), ingesta por foto **vieja** (1 bandeja por foto), finanzas/P&L, reportes + emails, admin, auth Fase 2, realtime, offline-first. Migraciones **001–021**.
  - **+ Fix del SW viejo** (`fde9264`): registro manual del SW con `updateViaCache:'none'` + `injectRegister:null` + chequeo de `version.json` con cache-bust → el SW nuevo se toma sin "borrar caché" en GitHub Pages (donde `_headers` no aplica). **Validado** (Mac/iPhone/Lenovo: SW activated, Load ~241ms, LCP 0.25s). RCA → [_handoff/PROD-SW-RCA.md](_handoff/PROD-SW-RCA.md).
  - **+ Fix de fechas de borde de mes** (`ff836a0`): helper `src/shared/utils/dateRange.ts` (`monthRangeBounds`, límite superior EXCLUSIVO = 1° del mes siguiente, robusto contra largo de mes/bisiestos) + fixes en `HomePage`, `resumen/ReporteMensual` (2 queries) e `inventario/InvFoodCost` (3 queries). **Result-preserving** para meses de 31 días. **Validado** (Inicio/Reporte Mensual/Food Cost/Quincenal cargan en junio sin 400, Mac+Lenovo). RCA → [_handoff/RCA-FECHAS-BORDE.md](_handoff/RCA-FECHAS-BORDE.md).
- **Solo en STAGING (no en prod):**
  - **Todo el sistema PoS** — catálogo+salón multi-local, comandero tablet, KDS web, cobro+doble moneda+vuelto, splits, propina capturada, paridad Lavu, foto de producto, jerarquía de menú 3 niveles, carta real (542 productos), `computeTotals`, **FE estructura (SIM)**, **inventario activo (depleción + COGS)**. Migraciones **022–037**.
  - **Bandeja fusionada** (`/inbox`, IA, merge `da53466`) + **enlace proveedor↔caja** (`b44e004`) + **visibilidad pendientes Caja Diaria** (`66686d7`) + **fechas en hora CR** en Movimientos/Pendientes/P&L (`cb25672`). Ver changelog para el detalle.
  - **🔴 Arreglo Realtime/candado de auth (saga jun-22, SOLO staging)** — es la causa (c) del "se traba". **PROD no lo tiene → el bug sigue vivo en producción.** Round 1 (`onAuthStateChange` global propaga el JWT al socket) + fix final (`fix/auth-lock-contention`: saca el `getSession()` por-hook redundante de `useRealtimeRefetch`). Round 2 (revive del socket) se mergeó y se **revirtió**. Validado en staging con 2 dispositivos; **pendiente canario a prod**. Ver §(d) y §(f).
  - **mig 038** (Bandeja fusión) **aplicada SOLO en staging** (ver (c)).
- **En rama aparte (sin merge):** integración propina→pool (código en `propina-pool`). Su **mig 035 figura aplicada en el ledger de staging** pese a no estar mergeada → discrepancia a investigar (ver (c)).

## (c) Migraciones

| Entorno | Hasta | Notas |
|---|---|---|
| **PROD** | **021** | 001–020 = inteligencia/caja/auth/realtime · 021 = offline idempotencia. **Los fixes de SW y fechas son 100% client-side (sin migración).** |
| **STAGING** | **038** | 022–034 PoS · 036 FE estructura · 037 inventario COGS · **038 Bandeja fusión APLICADA** (firmada por la dueña; tipos en `0205654`). ⚠️ **035:** el ledger la tiene como **aplicada** pero el archivo solo vive en `propina-pool` (sin merge) → **discrepancia A INVESTIGAR** (no resuelta; historial sin tocar). Detalle en [_handoff/038-apply.log](_handoff/038-apply.log). |

> **Edge Function `extract-document`:** desplegada al proyecto **STAGING** con `ANTHROPIC_API_KEY` → la lectura por IA de facturas opera en staging. NO en prod.

## (d) Lo construido, por módulo

Leyenda: ✅ validado por la dueña / 🟢 hecho y verde (tests+build) **sin validación física** / 🟡 parcial / ⏳ pendiente.

| Módulo | Estado | Dónde | Nota |
|---|---|---|---|
| Ventas/analítica · Propinas · Caja+cierre · Ingesta foto (vieja) · Finanzas/P&L · Reportes · Admin · Auth · Realtime · Offline | ✅ | prod | maduro. `cashUtils`/`tipCalculations`/`computeTotals` SAGRADOS |
| **Estabilidad PWA — SW viejo (fix prod)** | ✅ **VALIDADA en PROD** | prod (`fde9264`) | updateViaCache:'none' + version.json cache-bust. Carga limpio Mac/iPhone/Lenovo. |
| **Fechas de borde de mes (fix `-31`→400)** | ✅ **VALIDADA en PROD** | prod (`ff836a0`) | `monthRangeBounds`; Inicio/Reporte Mensual/Food Cost/Quincenal cargan en junio sin 400 |
| **Bandeja fusionada + enlace proveedor + visibilidad pendientes** | ✅ **Etapa 1 COMPLETA** | staging | mig 038 aplicada + validada con rol contador (registra + "✓ Verificar"). Cerrada en staging. |
| **Estabilidad PWA (Fases 1+2, staging)** | ✅ validada | staging | F1 `_headers` no-cache (Cloudflare) · F2 refresco de token en foco (`useAuth refreshOnFocus`) |
| **🔴 Saga Realtime / candado de auth** | 🟡 **validada en staging (2 disp.), PENDIENTE canario a PROD** | **solo staging** (`23c6bc8`) | **Causa (c) del "se traba". PROD no lo tiene.** R1 `onAuthStateChange`→`realtime.setAuth` global (cura loop `InvalidJWTToken`/"Token has expired") · R2 revive del socket **REVERTIDO** (subía contención sin beneficio probado) · fix final saca `getSession()` por-hook de `useRealtimeRefetch` (era la causa del `[auth] lock no adquirido en 10s`). Validado Mac+iPhone: consola limpia, sin `CHANNEL_ERROR`, Network 200. **Falta:** maduración +1h en background + canario 1 dispositivo a prod. Hist. → [HANG-RCA.md](HANG-RCA.md) |
| PoS — catálogo/salón (022) · comandero+KDS · cobro+splits+ticket SIM (027–034) · foto/nota/menú (030–032) · carta real | 🟢 | staging | sin validación física; pase a prod pendiente |
| FE — estructura (SIM, sin Hacienda) (036) | 🟢 | staging | no emite real |
| Inventario activo F1 — depleción + COGS (037) | 🟢 | staging | descuenta stock por receta al cerrar; COGS real; alertas por mínimo |

## (e) Pendientes de PLATA — sin firma/decisión de la dueña (NO mergear/aplicar sin OK)

1. **`propina-pool`** (rama, sin merge) → conecta `pos_payments.tip_crc` al pool del turno **sin tocar `tipCalculations`**. **DECISIÓN abierta:** propina de tarjeta/SINPE ¿al mismo pool que efectivo (implementado) o separada? `git show propina-pool:ESTADO-PROPINA-POOL.md`.
2. **Corrección de hora-CR en bordes de período** — **misma familia que el `-31`, NO tocada porque cambia números** (requiere validación física de la dueña): `finance.ts:132/139` (P&L borde de **año** — NO da 400 porque dic tiene 31, pero el rango está en UTC `…Z`) + el offset **+6h** en los `created_at` de queries de plata. Vuelta aparte; ver `_handoff/RCA-FECHAS-BORDE.md` §5.
3. **`fix/fecha-cr-consistente`** (en staging `cb25672`) → atribución de **mes CR** de gastos de noche en el P&L. **Pendiente validación física** (Movimientos de noche + P&L borde de mes contra un cierre conocido).
4. **`fix-doble-cobro`** → ya en staging (mig 033). Falta validación física + decisión de pase a PROD.

## (f) Pendientes humanos / fiscales / prolijidad

- **🔴 INMEDIATO — Pase a PROD del fix de Realtime/candado (`fix/auth-lock-contention`) vía CANARIO en 1 dispositivo.** Es **100% client-side, sin migración** → no toca la base; puede ir a prod independiente del pase del PoS. **PROD tiene el bug de trabarse VIVO** hasta que esto pase. Plan: cherry-pick/merge del fix a `main`, canario en 1 equipo, observar consola (sin `[auth] lock…`, sin `CHANNEL_ERROR`) + maduración +1h en background, luego rollout. Round 1 + fix final juntos; **NO** llevar el round 2 (revertido).
- **Pase del PoS + Bandeja a PROD:** consolidar migraciones **022–038** con guard anti-staging, crear buckets `facturas`/`productos`/`documents` en prod, regenerar tipos post-merge. Autorización única + verificación de hash. (Es el gran salto 021→038.)
- **Discrepancia mig 035** en el ledger de staging → sesión dedicada de propinas, **sin tocar el historial** hasta entender el origen.
- **404 menor en prod sobre `propinas:1`** (recurso faltante, probablemente icono o source-map; **NO afecta operación**, las pantallas cargan). Prolijidad, baja prioridad — falta identificar el archivo exacto (Network con filtro vacío).
- **Contadora:** códigos **CIIU/CABYS** del menú (campos ya existen, con aviso "pendiente"). Necesarios antes de FE real.
- **FE real:** emisor certificado CR (Hacienda 4.4) + `FeProvider` real (hoy solo SIM).
- **Validación física en staging** (la dueña): comandero pro, FE-SIM en el ticket, inventario que baja al cerrar. Checklist en [REPORTE-NOCHE-2.md](REPORTE-NOCHE-2.md).
- **Hardware piloto:** router con backup LTE, mini-PC (hub/KDS), 3 térmicas 3nStar RPT004, tablets, TVs.

> **Nota de ruido:** errores de consola tipo *"message channel closed"* son de **EXTENSIONES de Chrome**, no de la app — no registrar como bug.

---

## Sagrados (NUNCA reimplementar sin acuerdo explícito)
`cashUtils` · `tipCalculations` · `computeTotals` (fórmula fiscal) · cierres de caja · cobro/vuelto/conversión.
Todo el trabajo nuevo los **alimenta**, no los cambia.
