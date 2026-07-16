# Satori App — Estado del proyecto

> Restaurant POS + analítica · Satori Sushi Bar, Santa Teresa & Nosara, Costa Rica
> **Handoff: 2026-07-06. ✅ OLA 2026-07 CERRADA — pase a prod + smoke físico + sinceramiento USD, todo completo.** El pase único quedó **validado en piso por el dueño** (smoke en PROD ✓: `version.json` ✓ · Caja Diaria sin errores · asistente foto + lectura IA Sonnet — efectivo y pendientes, genera tarea de revisión · borrado con contraseña de manager elimina movimiento + tarea · Cierre del Día con diferencias USD y gate de ajuste · propinas sin parpadeo, pago por la vía real) y el **sinceramiento USD de Caja Fuerte se realizó en prod** ✓. **`main` código = `6c65f25`** (post-pase propinas ef/elec + cierre 2026-07-09/10; antes `92c0831`) · **`staging` código = `1daef0c`** (migs PROD out-of-band: **≤021 + 038–046 + subset core de la 026**; secret **`ANTHROPIC_MODEL=claude-sonnet-4-5` en prod**). Los HEAD de ambas ramas avanzan solo por commits **docs-only** desde entonces. **➡️ Ahora: ESTABILIZACIÓN** (1–2 semanas de observación, sin construir).
>
> **En una línea:** prod dejó de ir ~143 commits atrás — ahora tiene Caja/Cierre/USD/Revisión/asistente + Bandeja + unificación completos; lo único que queda solo-en-staging es el **PoS** (comandero/KDS/cobro/FE/inventario activo), diferido y bloqueado por el pilar de auth.
>
> **🆕 2026-07-09 — PASE A PROD de 2 features (validadas en piso en staging).** Vehículo: rama **`prod/pase-propinas-cierre`** sobre `main` (`cf50724`) — cherry-pick **limpio** de 3 commits (`611afca` → `2a0852e` → `c26df15`; solo ESTADO/PROMPT-CONTINUACION divergían y se resolvieron con la versión de `main`). Las 2 features: **(i) propinas efectivo/electrónico** (la cuenta por pagar de propinas es **SOLO lo electrónico** — datáfono/SINPE; el efectivo se lo queda el equipo, nunca genera movimiento ni pendiente; el *take-home* no cambia) y **(ii) cierre del día: ventas ₡0 con confirmación explícita + modal de resumen antes de confirmar**. Gates verdes: `VITE_APP_ENV=production npm run build` EXIT 0 · **207 tests sin env** · `tipCalculations.ts`/`cashUtils.ts` **byte-idénticos a `main`**. **Esquema:** la **mig 046** (`tip_sessions.pool_barra_electronico_crc`, aditiva/idempotente) se aplica a **PROD out-of-band** (Management API + `NOTIFY pgrst,'reload schema'`; `schema_migrations` NO se toca → prod pasa a **038–046 + subset core de 026**), y fue **ANTES** del código (si no, `getTipPayoutsSince` rompe pidiendo una columna inexistente). **✅ COMPLETADO 2026-07-10:** (1) mig 046 aplicada a prod out-of-band (verificada: columna `numeric NOT NULL default 0`; `schema_migrations` intacto) · (2) merge FF a `main` (**`main` código ahora = `6c65f25`**) + deploy GitHub Pages (`version.json` live = `6c65f25`) · (3) **SMOKE EN PISO EN PROD ✓ (2026-07-10)** — el dueño validó el cierre real con las 2 features (solo el electrónico genera cuenta por pagar · cierre ventas-0 + resumen OK). **Las 2 features salen de la cola de pendientes.** Queda solo la deuda ya conocida: **reconciliación del ledger** (prod out-of-band **038–046 + subset 026**; staging **039–046**). Rollback si hiciera falta: revert de los commits + redeploy (la 046 queda, aditiva e inofensiva). Detalle → PROMPT-CONTINUACION.
>
> **🆕 2026-07-16 — PASE CORTO A PROD: Proveedores, el rojo = DEUDA REAL (validado en staging).** Vehículo: rama **`prod/pase-proveedores-rojo`** sobre `main` (`6eb939a`) — cherry-pick de `f7bff9a` (staging); **solo ESTADO/PROMPT-CONTINUACION divergían** y se resolvieron con la versión de `main`; **el código entró limpio**. **SIN esquema — solo código** (4 archivos). Qué cambia: **(a)** el badge **rojo** de Proveedores cuenta **deuda real registrada** (`pendCount` = movimientos `status='pendiente'`, **incluye los 2 huérfanos** `supplier_id` NULL) — antes mostraba `overdueCount` con la etiqueta engañosa "pagos pendientes"; **(b)** la **agenda de ciclo** pasa a un **indicador ámbar aparte** ("N con ciclo de compra vencido"), nunca rojo — es agenda de recompra, no deuda; **(c)** proveedor **'Puntual'** (nuevo valor de `ciclo_pago`, **texto libre, sin migración**) queda **fuera de la agenda** → **mata el "14"**; **(d)** la pestaña **Pendientes** ahora tiene **✕ Rechazar** (exige **autorización de gerencia**; anda con `supplier_id` NULL porque agrupa por nombre y rechaza por `id`). Gates verdes: `VITE_APP_ENV=production npm run build` **EXIT 0** · **218 tests sin env** · **diff de sagrados vs `main` VACÍO** · los 4 archivos **byte-idénticos** a los smokeados en staging. **⏳ SMOKE EN PROD PENDIENTE:** que el dueño (1) vea el rojo en **5** y no 14, y (2) **rechace los 2 huérfanos** él mismo desde la UI — Distribuidora Isleña 2020-07-09 ₡74.126,92 y GRUPO PAMPA 2026-07-06 ₡75.916,60 (**₡150.043,52**, **cero SQL**). Rollback: **revert del commit** + redeploy (sin migración → trivial). Detalle → PROMPT-CONTINUACION P1 #1 + HALLAZGOS.
>
> **🆕 2026-07-16 (2º pase del día) — PASE CORTO A PROD: Proveedores = SOLO la lista (OK visual del dueño en staging).** Vehículo: rama **`prod/pase-proveedores-simplificar`** sobre `main` (`7377240`) — cherry-pick de `d85453a` (staging); **solo ESTADO/PROMPT-CONTINUACION divergían** → versión de `main`; **el código entró limpio**. **SIN esquema — solo UI** (3 archivos; **125 líneas menos**). **Decisión de producto FIRMADA por el dueño el mismo día, tras ver el pase anterior en prod:** la pestaña Proveedores es **SOLO la lista de proveedores**. **Se eliminan:** el badge **rojo** "N pendientes por pagar" + su panel (**era duplicado** — la pestaña Pendientes, al lado, ya notifica con su propio `cd-pend-badge`, `CashModule.tsx:135`), el **chip ámbar** de agenda de ciclo, y los **banners** "Agenda de compra". **La información NO se pierde: vive en la tarjeta de cada proveedor** (su deuda `pendingCRC`, su ciclo acordado —incluida **'Puntual'** y su semántica—, último/próximo pago, total pagado). **`CashPendientes` intacto** (✕ Rechazar sigue → el rechazo de los 2 huérfanos sigue disponible). **Sin código muerto:** `contarAgenda`/`contarPendientes`/`totalPendienteCRC` quedaron sin uso (ningún otro módulo los importaba) → borrados con sus tests; `computeSupplierStatus`/`esProveedorPuntual` siguen (los usan las tarjetas). Gates verdes: `VITE_APP_ENV=production npm run build` **EXIT 0** · **216 tests sin env** · **diff de sagrados vs `main` VACÍO** · los 3 archivos **byte-idénticos** a los aprobados en staging (`d85453a`, OK visual del dueño). Rollback: **revert del commit** + redeploy (sin migración → trivial). Detalle → PROMPT-CONTINUACION P1 #1.
>
> Historia detallada del pase → [ESTADO-ARCHIVO.md](ESTADO-ARCHIVO.md) (bloque 2026-07-04) · Fases → [ROADMAP.md](ROADMAP.md) · Backlog / próxima sesión → [PROMPT-CONTINUACION.md](PROMPT-CONTINUACION.md) · Hallazgos → [HALLAZGOS.md](HALLAZGOS.md) · Índice de SPECs → [docs/README.md](docs/README.md).

**Stack:** React 19 + TS strict + Vite + PWA · Supabase (Postgres + RLS + Edge Functions) · realtime.
**Despliegue:** `main` → PROD (GitHub Pages, base `/satori-app/`) · `staging` → Cloudflare Pages (`satori-staging.pages.dev`).

---

## (a) Ramas y proyectos Supabase

| Rama | Hash | Qué es |
|---|---|---|
| `main` | `6c65f25` | **PROD (estable, en uso).** Recibió el **PASE ÚNICO** de la ola 2026-07 (Caja/Cierre/USD/Revisión/asistente + Bandeja + unificación F41–F43, **SIN PoS**) y **🆕 el pase 2026-07-09/10** (propinas efectivo/electrónico + cierre ventas-0/resumen, validado en piso en prod). Ya tenía Olas 1/1.1, pantalla negra, `createDayMovement`, IDOR `extract-document`, outbox `SIGNED_IN`, render Propinas, Actions Node 24. Migs en el ledger **≤021** + **038–046 + subset core de 026, out-of-band**. |
| `staging` | `1daef0c` | **Fuente de verdad del desarrollo.** Todo lo de `main` **+ el PoS/KDS/comandero + FE (SIM) + inventario activo COGS** (migs 022–037). Eso es hoy lo único que separa staging de prod. Migs **022–045** (039–045 out-of-band). |

> **Supabase refs:** **PROD = `yiczgdtirrkdvohdquzf`** ("satori-app") · **STAGING = `hwiatgicyyqyezqwldia`** ("satori-staging").
> 🛑 **RITUAL antes de CUALQUIER comando de base:** `cat supabase/.temp/project-ref` → confirmar el proyecto correcto (NO existe `linked-project.json` en el CLI v2.105). 🆕 **`db query --linked` CUELGA en algunos entornos/sandboxes** (visto 2026-07-04, prod y staging) → workaround: **curl directo a la Management API** (`POST https://api.supabase.com/v1/projects/<ref>/database/query`, token del Keychain macOS, servicio `Supabase CLI`). Ver HALLAZGOS.

## (b) PROD vs STAGING — 🆕 el gran cambio: la unificación ENTERA está en PROD

- **En PROD (`main`, código `92c0831`) — ✅ VALIDADO FÍSICAMENTE por el dueño (smoke 2026-07-06):** ventas/analítica, propinas, caja (turnos + cierre 2 fases + movimientos + pendientes), finanzas/P&L, reportes+emails, admin, auth Fase 2, realtime, offline · estabilidad (Olas 1/1.1, pantalla negra, `createDayMovement`, IDOR, outbox `SIGNED_IN`, render Propinas) · **🆕 Bandeja unificada + unificación Bandeja↔Caja** (asistente "➕ Agregar", Revisión de inventario) · **🆕 toda la ola de cierre/USD:** cierre visual + tema claro + fórmula USD firmada, autorización SOLO por contraseña (mig 045), Tier 3 Revisión/asistente, Opción B (ajuste al ledger), **propinas por la vía real** (faltante fantasma enterrado). Todo el flujo core probado en piso sin errores.
- **Solo en STAGING (NO en prod):** **el PoS completo** (catálogo/salón, comandero, KDS, cobro+splits+ticket SIM, FE estructura SIM, inventario activo COGS) — migs 022–037. **Es lo único que queda por pasar**, y es un proyecto aparte, **DIFERIDO** (bloqueado por el pilar de auth, §f-5).
- **En rama aparte (sin merge):** `propina-pool` (espera decisión). La rama `prod/pase-ola-2026-07` (vehículo del pase) quedó mergeada a `main` por FF y sigue viva en origin.

> ℹ️ **Nota `version.json`:** tras un commit **docs-only** el bundle no cambia; `version.json` en el dispositivo puede seguir mostrando un **hash viejo** hasta que el Service Worker del PWA recicle. No es un fallo de deploy — el sitio se re-buildeó igual.

## (c) Migraciones — 🆕 ahora AMBOS entornos tienen deuda out-of-band

| Entorno | En el ledger (`schema_migrations`) | Aplicadas FUERA del ledger | Notas |
|---|---|---|---|
| **PROD** | **≤021** | **🆕 038–046 + subset core de la 026** (Management API curl; verificadas por privilegio) | 022–037 (PoS) NO están. El pase aplicó 038–045; el **hotfix 2026-07-06** sumó las **secciones 1–4 de la mig 026** (rol `proveedor`, columna `cash_movements.attachments`, bucket `facturas` + 7 políticas); la **046** (`tip_sessions.pool_barra_electronico_crc`, aditiva) entró en el pase **2026-07-10** (+ `NOTIFY pgrst`). Todo aplicó limpio. |
| **STAGING** | **022–038** | **039–045** | 039 dashboard · 040–044 `db query` · 045 `db query --linked`. |

**⚠️ Reconciliación del ledger = sesión dedicada (NO tocar el historial):** ahora **los dos entornos** arrastran migraciones out-of-band (prod suma **038–046 + subset core de 026**; staging **039–046**). Persisten 009 (drift) y 035 (fantasma, solo en `propina-pool`). **`db push`/`repair` FRENADOS** hasta esa sesión. Todo idempotente. **`schema_migrations` NO se tocó** (ni en el pase ni en el hotfix).

## (d) Build por módulo

Gate del pase: **`VITE_APP_ENV=production npm run build` → EXIT 0** (`tsc -b`, **NO** `tsc --noEmit`, falso verde por `tsconfig` raíz con `files:[]`) + suite completa verde (**192 tests** — bajó de 272 al quedar los tests del PoS fuera con sus fuentes). ⚠️ El check **"Supabase Preview"** es **rojo crónico ajeno**; validan `build`+`deploy` (Pages, prod) y `Cloudflare Pages` (staging).

Leyenda: ✅ en prod, maduro / 🟢 en prod, **smoke físico pendiente** / 🧪 solo staging.

| Módulo | Estado | Dónde |
|---|---|---|
| Ventas · Propinas · Caja+cierre · Finanzas/P&L · Reportes · Admin · Auth · Realtime · Offline | ✅ | prod (`cashUtils`/`tipCalculations`/`computeTotals` SAGRADOS) |
| Estabilidad (Olas 1/1.1 · pantalla negra · `createDayMovement` · IDOR · outbox `SIGNED_IN` · render Propinas) | ✅ | prod |
| Unificación Bandeja↔Caja (asistente "➕ Agregar" + Revisión de inventario) | 🟢 EN PROD | prod + staging |
| Cierre visual + tema claro + **fórmula USD firmada** (`calcDeberiaUSD` con `saldoBase.usd`) | 🟢 EN PROD | prod + staging |
| **Autorización de gerencia SOLO por contraseña** (mig 045) + edición de pagos exige autorización | 🟢 EN PROD | prod (mig 045 aplicada) + staging |
| Tier 3 Revisión (foto/panel/adjuntar) + asistente (orden/flujo guiado) | 🟢 EN PROD | prod + staging |
| **Opción B — Ajuste de cierre al ledger** (idempotente por `client_op_id`) | 🟢 EN PROD | prod + staging |
| **Propinas por la VÍA REAL** (resta propinas pagadas; faltante fantasma enterrado) | 🟢 EN PROD | prod + staging |
| PoS (comandero/KDS/cobro/ticket SIM) · FE SIM · Inventario activo COGS | 🧪 solo staging | staging (migs 022–037) |

## (e) Pendientes de PLATA / humanos / fiscales (siguen vivos)

1. **✅ Sinceramiento USD de Caja Fuerte en PROD — HECHO (2026-07-06).** El ajuste inicial (espejo de los −$2678 de staging) se cargó con el conteo físico USD del día → la fórmula USD firmada ya cuadra en prod desde ese punto.
2. **✅ Smoke físico en PROD — HECHO (2026-07-06).** El dueño validó en piso el flujo real (Caja Diaria, asistente foto+IA Sonnet, borrado con contraseña, Cierre con diferencias USD + gate de ajuste, propinas por la vía real) sobre datos de producción — todo pasó.
3. **🖊️ Foto de comprobante obligatoria al pagar propina** — firmado, **DIFERIDO** (fuera de scope de esta ola; pase siguiente). Toca `pagarPropina`/`propinaPago.ts`.
4. **`propina-pool`** (rama, sin merge) → decisión: propina de tarjeta/SINPE ¿al mismo pool que efectivo o separada?

> **Tier 1 (monto-on-modify desde Revisión) = DESCARTADO por la dueña** (la Revisión NO modifica caja). No reabrir sin nueva firma.

## (f) Deuda técnica / decisiones que siguen vivas (detalle en PROMPT-CONTINUACION)

1. **🔴 Reconciliación del ledger de migraciones — ahora en AMBOS entornos.** Sesión dedicada; resolver 009/035 y las out-of-band (prod **038–046 + subset core de 026**, staging **039–046**). Bloquea `db push`.
2. **✅ EN PROD 2026-07-16 (smoke pendiente) — Proveedores: el rojo = deuda real.** ⚠️ **El encuadre viejo de este punto era equivocado:** el **"14" NO eran datos huérfanos** de proveedores inexistentes ni hacía falta FK/limpieza — era **`overdueCount`** (agenda de **ciclo de compra**) con la etiqueta engañosa "pagos pendientes"; el diagnóstico read-only (2026-07-06) probó **FK íntegra, 0 dangling**, y **5** pendientes reales (3 legítimos + **2 huérfanos** `supplier_id` NULL, ₡150.043,52). **Decisión FIRMADA (2026-07-09) y ya construida + pasada a prod** (UI/lógica, sin esquema, sagrados intactos): rojo = `pendCount` (deuda real) · agenda de ciclo = indicador **ámbar** aparte · proveedor **'Puntual'** fuera de la agenda (mata el "14") · **✕ Rechazar** en Pendientes con autorización de gerencia. **⏳ Falta el smoke del dueño en prod: rechazar los 2 huérfanos desde la UI (cero SQL).**
    **🆕 SIMPLIFICADO EL MISMO DÍA (2º pase 2026-07-16, OK visual del dueño en staging):** viéndolo en prod, el dueño firmó que Proveedores sea **SOLO la lista**. **Ya NO existen en prod** el badge rojo ni el chip ámbar ni los banners de agenda — el rojo era **duplicado** de la pestaña Pendientes (que conserva su badge y su ✕ Rechazar). **La info vive ahora en la tarjeta de cada proveedor** (deuda, ciclo incluido **'Puntual'**, último/próximo pago). ⚠️ **Ojo con el smoke pendiente:** el rechazo de los 2 huérfanos **sigue disponible** en la pestaña Pendientes, pero **el badge rojo en "5" ya no está** — ese indicador confirmaba el fix anterior y se retiró por decisión de producto. Detalle → HALLAZGOS + PROMPT-CONTINUACION P1 #1.
3. **🔐 Rotar los 2 tokens de GitHub** (`gho_` + PAT classic "Claude CLI") — **la fecha objetivo ya pasó, rotar YA.**
4. **🖊️👁️ Hora-CR en bordes de período** — las queries de plata (P&L, `finance.ts`) acotan `created_at` en UTC (+6h vs CR) → un cierre de noche puede caer en el período equivocado. Cambia números → valida la dueña.
5. **🖊️ Decisión Etapa 2 de la Bandeja** (entrada foto-primero 100% dentro de Caja Diaria, hoy diseñada sin código) — construir **solo si** tras usar la Etapa 1 en prod sigue haciendo falta.
6. **🚧 PILAR — arquitectura de sesión/auth escalable y multi-tenant** — **bloquea el GRAN PASE del PoS** a prod (~10 dispositivos concurrentes; hotelería/franquicias).

---

## Sagrados (NUNCA reimplementar sin acuerdo explícito)
`cashUtils` · `tipCalculations` · `computeTotals` (fórmula fiscal) · cierres de caja (la matemática del "debería") · cobro/vuelto/conversión · `posFiscal`.
La ola tocó la *plomería* del cierre con firma, pero `tipCalculations`/`calcTurno`/`saldoCajaFuerte` quedaron byte-idénticos. **Gate 5 del pase:** `tipCalculations.ts` vs prod = **+2 líneas** (etiqueta del rol `proveedor`); `cashUtils.ts`/`computeTotals` **idénticos a staging**.
