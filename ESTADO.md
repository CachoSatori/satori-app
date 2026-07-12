# Satori App — Estado del proyecto

> Restaurant POS + analítica · Satori Sushi Bar, Santa Teresa & Nosara, Costa Rica
> **Handoff: 2026-07-09. ✅ OLA 2026-07 CERRADA — pase a prod + smoke físico + sinceramiento USD, todo completo.** El pase único quedó **validado en piso por el dueño** (smoke en PROD ✓: `version.json` ✓ · Caja Diaria sin errores · asistente foto + lectura IA Sonnet — efectivo y pendientes, genera tarea de revisión · borrado con contraseña de manager elimina movimiento + tarea · Cierre del Día con diferencias USD y gate de ajuste · propinas sin parpadeo, pago por la vía real) y el **sinceramiento USD de Caja Fuerte se realizó en prod** ✓. **`main` código = `6c65f25`** (post-pase propinas ef/elec + cierre 2026-07-09/10; antes `92c0831`) · **`staging` código = `1daef0c`** (migs PROD out-of-band: **≤021 + 038–046 + subset core de la 026**; secret **`ANTHROPIC_MODEL=claude-sonnet-4-5` en prod**). Los HEAD de ambas ramas avanzan solo por commits **docs-only** desde entonces. **➡️ Ahora: ESTABILIZACIÓN** (1–2 semanas de observación, sin construir).
>
> **En una línea:** prod dejó de ir ~143 commits atrás — ahora tiene Caja/Cierre/USD/Revisión/asistente + Bandeja + unificación completos; lo único que queda solo-en-staging es el **PoS** (comandero/KDS/cobro/FE/inventario activo), diferido y bloqueado por el pilar de auth.
>
> **🆕 2026-07-06 → 09 (solo estabilización + docs · CERO código/esquema en prod):** tokens GitHub ✅ rotados; pagos "huérfanos" reencuadrados + **decisión FIRMADA** (rojo = deuda real registrada; agenda de ciclo con indicador/etiqueta aparte; 2 huérfanos = basura → rechazar — todo post-ventana); hallazgo "convención de ventas" **CERRADO**; **migración del histórico ejecutada y CANCELADA en staging** (revertida quirúrgico, prod NUNCA se tocó); nuevo hallazgo **`saldoCajaFuerte` sin ancla** registrado. **HEADs actuales: `main` `cf50724` · `staging` `508853a`** (código sin cambios: `92c0831`/`1daef0c`). La **ventana de estabilización cierra ~semana del 13-jul**.
>
> **🆕 2026-07-09 — ✅ Propinas efectivo/electrónico EN STAGING, VALIDADO FÍSICAMENTE por el dueño.** La **cuenta por pagar de propinas se genera SOLO por la porción electrónica** (datáfono/SINPE); el **efectivo se lo queda el equipo y NUNCA genera movimiento ni pendiente**; el *take-home* por empleado NO cambia (SPEC **FIRMADO** [docs/SPEC-propinas-efectivo-electronico.md](docs/SPEC-propinas-efectivo-electronico.md)). Mig **046** aplicada a STAGING **out-of-band** (Management API `db query --linked`; `schema_migrations` **intacto**); rama `feat/propinas-efectivo-electronico` **mergeada** (**`staging` = `2a0852e`**); **smoke en piso ✓** (distribución idéntica al modelo viejo · solo el electrónico genera "por pagar" · turno solo-efectivo no genera nada). `tipCalculations.ts` byte-idéntico; `cashUtils`/`computeTotals`/`posFiscal` intactos. **✅ 2026-07-10: EN PROD, VALIDADO EN PISO** — mig 046 aplicada a prod out-of-band (verificada) + código deployado (`main` = `6c65f25`). Backlog → PROMPT-CONTINUACION P2 #6.
>
> **🆕 2026-07-09 — ✅ Cierre del día: ventas ₡0 con confirmación explícita + resumen previo al confirmar — EN STAGING, VALIDADO EN PISO (4/4).** El Cierre del Día (`CashCierre.tsx`) ahora permite cerrar un turno con ventas en **₡0** SOLO con un checkbox de confirmación explícita (campo vacío sigue bloqueando como siempre), y muestra un **modal de resumen** (ventas Mediodía/Noche, propinas pagadas, distribución Caja Diaria mañana/Registradora/Remanente CF, diferencia) **antes** de confirmar. Smoke del dueño ✓ los 4 casos: (a) cierre normal desde el modal · (b) ventas ₡0 sin check bloquea / con check cierra (ambas fases) · (c) campo vacío bloquea · (d) noche solo-dólares cierra (fix del gate viejo). **Sin esquema, sin sagrados** (`cashUtils`/`computeTotals`/`tipCalculations` intactos; el persistido del cierre NO cambió). `staging` = `c26df15`. **✅ 2026-07-10: EN PROD, VALIDADO EN PISO** (pasó junto con propinas ef/elec; `main` = `6c65f25`). Backlog → PROMPT-CONTINUACION P2 #6.
>
> Historia detallada del pase → [ESTADO-ARCHIVO.md](ESTADO-ARCHIVO.md) (bloque 2026-07-04) · Fases → [ROADMAP.md](ROADMAP.md) · Backlog / próxima sesión → [PROMPT-CONTINUACION.md](PROMPT-CONTINUACION.md) · Hallazgos → [HALLAZGOS.md](HALLAZGOS.md) · Índice de SPECs → [docs/README.md](docs/README.md).

**Stack:** React 19 + TS strict + Vite + PWA · Supabase (Postgres + RLS + Edge Functions) · realtime.
**Despliegue:** `main` → PROD (GitHub Pages, base `/satori-app/`) · `staging` → Cloudflare Pages (`satori-staging.pages.dev`).

---

## (a) Ramas y proyectos Supabase

| Rama | Hash | Qué es |
|---|---|---|
| `main` | `6c65f25` | **PROD (estable, en uso).** Recibió el **PASE ÚNICO** de la ola 2026-07 (Caja/Cierre/USD/Revisión/asistente + Bandeja + unificación F41–F43, **SIN PoS**) y **🆕 el pase 2026-07-09/10** (propinas efectivo/electrónico + cierre ventas-0/resumen, validado en piso en prod). Ya tenía Olas 1/1.1, pantalla negra, `createDayMovement`, IDOR `extract-document`, outbox `SIGNED_IN`, render Propinas, Actions Node 24. Migs en el ledger **≤021** + **038–046 + subset core de 026, out-of-band**. |
| `staging` | `1daef0c` | **Fuente de verdad del desarrollo.** Todo lo de `main` **+ el PoS/KDS/comandero + FE (SIM) + inventario activo COGS** (migs 022–037). Eso es hoy lo único que separa staging de prod. Migs **022–046** (039–046 out-of-band). |

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
| **STAGING** | **022–038** | **039–046** | 039 dashboard · 040–044 `db query` · 045 `db query --linked` · **046** `db query --linked` (columna `tip_sessions.pool_barra_electronico_crc`, 2026-07-09). |

**⚠️ Reconciliación del ledger = sesión dedicada (NO tocar el historial):** ahora **los dos entornos** arrastran migraciones out-of-band (prod suma **038–046 + subset core de 026**; staging **039–046**). Persisten 009 (drift) y 035 (fantasma, solo en `propina-pool`). **`db push`/`repair` FRENADOS** hasta esa sesión. Todo idempotente. **`schema_migrations` NO se tocó** (ni en el pase ni en el hotfix).

> **🆕 Staging — migración de histórico CANCELADA (2026-07-09):** la tabla **`ventas_efectivo_hist` fue creada y luego DROPeada** — **NO está viva**, no la busques. `cash_movements`/`suppliers` volvieron a **pre-migración (967 / 83)**. Quedan **2 backups en staging** como red 30 días (borrar tras confirmar): `cash_movements_pre_migracion_2026_07` (967) · `suppliers_pre_migracion_2026_07` (83). **Prod nunca se tocó.** Detalle → HALLAZGOS (2026-07-08 + cierre 09).

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

1. **🔴 Reconciliación del ledger de migraciones — ahora en AMBOS entornos.** Sesión dedicada; resolver 009/035 y las out-of-band (prod **038–046 + subset core de 026**, staging 039–046). Bloquea `db push`.
2. **✅ CONSTRUIDO 2026-07-10 (rama `fix/proveedores-rojo-deuda-real`, SIN merge — review + smoke pendientes). Pagos pendientes en Proveedores.** El "14" en rojo **NO eran pendientes**: era `overdueCount` (agenda de ciclo, etiqueta engañosa). Ya construido (UI/lógica, sin esquema, sagrados intactos): el **rojo cuenta `pendCount`** (deuda real `status='pendiente'`, incluye los **2 huérfanos** `supplier_id` NULL de ₡150.043,52); la **agenda de ciclo** es un **indicador ámbar aparte**; proveedor **'Puntual'** sale de la agenda (mata el "14"); la pestaña **Pendientes** ahora permite **rechazar** (con gerencia, anda con `supplier_id` NULL) → el dueño rechaza los 2 huérfanos en prod tras el pase. Detalle → HALLAZGOS + PROMPT-CONTINUACION P1 #1 / P2 #5.
3. **✅ Tokens de GitHub rotados (2026-07-06).** PAT "Claude CLI" regenerado con scopes mínimos (`repo`+`workflow`, sin `admin:org`) + OAuth "GitHub CLI" revocado (`gho_` invalidado, re-login limpio en keyring). Ya no hay tokens comprometidos.
4. **🖊️👁️ Hora-CR en bordes de período** — las queries de plata (P&L, `finance.ts`) acotan `created_at` en UTC (+6h vs CR) → un cierre de noche puede caer en el período equivocado. Cambia números → valida la dueña.
5. **🖊️ Decisión Etapa 2 de la Bandeja** (entrada foto-primero 100% dentro de Caja Diaria, hoy diseñada sin código) — construir **solo si** tras usar la Etapa 1 en prod sigue haciendo falta.
6. **🚧 PILAR — arquitectura de sesión/auth escalable y multi-tenant** — **bloquea el GRAN PASE del PoS** a prod (~10 dispositivos concurrentes; hotelería/franquicias).
7. **🧹🖊️ Arranque limpio de PROD (post-estabilización · NO es migración, es LIMPIEZA).** Reemplaza al import histórico **cancelado** (2026-07-09). Cuando el dueño declare prod confiable: eliminar los datos **pre-arranque** (doble registro viejo), conservar el sinceramiento USD y la operación viva. Corte a definir; **diseño + firma**. Detalle → PROMPT-CONTINUACION P1 #7.
8. **🧮 `saldoCajaFuerte` sin ancla + no lee el efectivo de ventas** (hallazgo 2026-07-09, registrado). No tiene saldo inicial ancla y suma solo `cash_movements` (el efectivo de ventas vive en `ventas_dias`); la dirección del traspaso depende de una convención textual frágil (`→ caja fuerte`). Relevante para el arranque limpio y cualquier tesorería. **NO accionar ahora.** Detalle → HALLAZGOS.

---

## Sagrados (NUNCA reimplementar sin acuerdo explícito)
`cashUtils` · `tipCalculations` · `computeTotals` (fórmula fiscal) · cierres de caja (la matemática del "debería") · cobro/vuelto/conversión · `posFiscal`.
La ola tocó la *plomería* del cierre con firma, pero `tipCalculations`/`calcTurno`/`saldoCajaFuerte` quedaron byte-idénticos. **Gate 5 del pase:** `tipCalculations.ts` vs prod = **+2 líneas** (etiqueta del rol `proveedor`); `cashUtils.ts`/`computeTotals` **idénticos a staging**.
