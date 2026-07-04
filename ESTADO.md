# Satori App — Estado del proyecto

> Restaurant POS + analítica · Satori Sushi Bar, Santa Teresa & Nosara, Costa Rica
> **Handoff: 2026-07-04. ✅ PASE ÚNICO A PROD COMPLETADO.** Toda la ola 2026-07 + Bandeja + unificación Bandeja↔Caja (**SIN PoS**) pasó a producción por FF de `prod/pase-ola-2026-07`. **`main` = `92c0831`** (avanzó desde `a14da50`) · **`staging` = `1daef0c`** (fuente de desarrollo; sigue con el PoS). Migs **038–045 aplicadas a PROD** (out-of-band vía Management API curl, verificadas por privilegio). Secret **`ANTHROPIC_MODEL=claude-sonnet-4-5` en prod**. Deploy verificado (`version.json.commit = 92c0831`).
>
> **En una línea:** prod dejó de ir ~143 commits atrás — ahora tiene Caja/Cierre/USD/Revisión/asistente + Bandeja + unificación completos; lo único que queda solo-en-staging es el **PoS** (comandero/KDS/cobro/FE/inventario activo), diferido y bloqueado por el pilar de auth.
>
> Historia detallada del pase → [ESTADO-ARCHIVO.md](ESTADO-ARCHIVO.md) (bloque 2026-07-04) · Fases → [ROADMAP.md](ROADMAP.md) · Backlog / próxima sesión → [PROMPT-CONTINUACION.md](PROMPT-CONTINUACION.md) · Hallazgos → [HALLAZGOS.md](HALLAZGOS.md) · Índice de SPECs → [docs/README.md](docs/README.md).

**Stack:** React 19 + TS strict + Vite + PWA · Supabase (Postgres + RLS + Edge Functions) · realtime.
**Despliegue:** `main` → PROD (GitHub Pages, base `/satori-app/`) · `staging` → Cloudflare Pages (`satori-staging.pages.dev`).

---

## (a) Ramas y proyectos Supabase

| Rama | Hash | Qué es |
|---|---|---|
| `main` | `92c0831` | **PROD (estable, en uso).** 🆕 Recibió el **PASE ÚNICO** de la ola 2026-07: toda la Caja/Cierre/USD/Revisión/asistente + Bandeja + unificación Bandeja↔Caja (F41–F43) — **SIN PoS**. Ya tenía Olas 1/1.1, pantalla negra, `createDayMovement`, IDOR `extract-document`, outbox `SIGNED_IN`, render Propinas, Actions Node 24. Migs en el ledger **≤021** + **038–045 out-of-band**. |
| `staging` | `1daef0c` | **Fuente de verdad del desarrollo.** Todo lo de `main` **+ el PoS/KDS/comandero + FE (SIM) + inventario activo COGS** (migs 022–037). Eso es hoy lo único que separa staging de prod. Migs **022–045** (039–045 out-of-band). |

> **Supabase refs:** **PROD = `yiczgdtirrkdvohdquzf`** ("satori-app") · **STAGING = `hwiatgicyyqyezqwldia`** ("satori-staging").
> 🛑 **RITUAL antes de CUALQUIER comando de base:** `cat supabase/.temp/project-ref` → confirmar el proyecto correcto (NO existe `linked-project.json` en el CLI v2.105). 🆕 **`db query --linked` CUELGA en algunos entornos/sandboxes** (visto 2026-07-04, prod y staging) → workaround: **curl directo a la Management API** (`POST https://api.supabase.com/v1/projects/<ref>/database/query`, token del Keychain macOS, servicio `Supabase CLI`). Ver HALLAZGOS.

## (b) PROD vs STAGING — 🆕 el gran cambio: la unificación ENTERA está en PROD

- **En PROD (`main` `92c0831`):** ventas/analítica, propinas, caja (turnos + cierre 2 fases + movimientos + pendientes), finanzas/P&L, reportes+emails, admin, auth Fase 2, realtime, offline · estabilidad (Olas 1/1.1, pantalla negra, `createDayMovement`, IDOR, outbox `SIGNED_IN`, render Propinas) · **🆕 Bandeja unificada + unificación Bandeja↔Caja** (asistente "➕ Agregar", Revisión de inventario) · **🆕 toda la ola de cierre/USD:** cierre visual + tema claro + fórmula USD firmada, autorización SOLO por contraseña (mig 045), Tier 3 Revisión/asistente, Opción B (ajuste al ledger), **propinas por la vía real** (faltante fantasma enterrado).
- **Solo en STAGING (NO en prod):** **el PoS completo** (catálogo/salón, comandero, KDS, cobro+splits+ticket SIM, FE estructura SIM, inventario activo COGS) — migs 022–037. **Es lo único que queda por pasar**, y es un proyecto aparte, **DIFERIDO** (bloqueado por el pilar de auth, §f-5).
- **En rama aparte (sin merge):** `propina-pool` (espera decisión). La rama `prod/pase-ola-2026-07` (vehículo del pase) quedó mergeada a `main` por FF y sigue viva en origin.

## (c) Migraciones — 🆕 ahora AMBOS entornos tienen deuda out-of-band

| Entorno | En el ledger (`schema_migrations`) | Aplicadas FUERA del ledger | Notas |
|---|---|---|---|
| **PROD** | **≤021** | **🆕 038–045** (Management API curl, esta sesión; verificadas por privilegio) | 022–037 (PoS) NO están: el pase fue sin PoS. La ola necesitaba exactamente 038–045 sobre el ≤021 de prod (aplicaron limpias, HTTP 201). |
| **STAGING** | **022–038** | **039–045** | 039 dashboard · 040–044 `db query` · 045 `db query --linked`. |

**⚠️ Reconciliación del ledger = sesión dedicada (NO tocar el historial):** ahora **los dos entornos** arrastran migraciones out-of-band (prod suma 038–045; staging 039–045). Persisten 009 (drift) y 035 (fantasma, solo en `propina-pool`). **`db push`/`repair` FRENADOS** hasta esa sesión. Todo idempotente. **`schema_migrations` NO se tocó en el pase.**

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

1. **🔴 Sinceramiento USD de Caja Fuerte en PROD — PENDIENTE.** Repetir el ajuste inicial (los −$2678 son espejo de staging) con el **conteo físico USD del día** (Movimientos → Ingreso · Otro CF, USD = físico − saldo ledger, ₡ = 0). Recién ahí la fórmula USD firmada empieza a cuadrar en prod.
2. **👁️ Smoke físico en PROD — PENDIENTE.** Validar en piso con la dueña el flujo real (cierre, Revisión, Bandeja) sobre datos de producción. Ninguna de las piezas 🟢 está confirmada en dispositivo todavía.
3. **🖊️ Foto de comprobante obligatoria al pagar propina** — firmado, **DIFERIDO** (fuera de scope de esta ola; pase siguiente). Toca `pagarPropina`/`propinaPago.ts`.
4. **`propina-pool`** (rama, sin merge) → decisión: propina de tarjeta/SINPE ¿al mismo pool que efectivo o separada?

> **Tier 1 (monto-on-modify desde Revisión) = DESCARTADO por la dueña** (la Revisión NO modifica caja). No reabrir sin nueva firma.

## (f) Deuda técnica / decisiones que siguen vivas (detalle en PROMPT-CONTINUACION)

1. **🔴 Reconciliación del ledger de migraciones — ahora en AMBOS entornos.** Sesión dedicada; resolver 009/035 y las out-of-band (prod 038–045, staging 039–045). Bloquea `db push`.
2. **🔐 Rotar los 2 tokens de GitHub** (`gho_` + PAT classic "Claude CLI") — **la fecha objetivo ya pasó, rotar YA.**
3. **🖊️👁️ Hora-CR en bordes de período** — las queries de plata (P&L, `finance.ts`) acotan `created_at` en UTC (+6h vs CR) → un cierre de noche puede caer en el período equivocado. Cambia números → valida la dueña.
4. **🖊️ Decisión Etapa 2 de la Bandeja** (entrada foto-primero 100% dentro de Caja Diaria, hoy diseñada sin código) — construir **solo si** tras usar la Etapa 1 en prod sigue haciendo falta.
5. **🚧 PILAR — arquitectura de sesión/auth escalable y multi-tenant** — **bloquea el GRAN PASE del PoS** a prod (~10 dispositivos concurrentes; hotelería/franquicias).

---

## Sagrados (NUNCA reimplementar sin acuerdo explícito)
`cashUtils` · `tipCalculations` · `computeTotals` (fórmula fiscal) · cierres de caja (la matemática del "debería") · cobro/vuelto/conversión · `posFiscal`.
La ola tocó la *plomería* del cierre con firma, pero `tipCalculations`/`calcTurno`/`saldoCajaFuerte` quedaron byte-idénticos. **Gate 5 del pase:** `tipCalculations.ts` vs prod = **+2 líneas** (etiqueta del rol `proveedor`); `cashUtils.ts`/`computeTotals` **idénticos a staging**.
