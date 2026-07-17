# Satori App — Estado del proyecto

> Restaurant POS + analítica · Satori Sushi Bar, Santa Teresa & Nosara, Costa Rica
> **Foto compacta — actualizado 2026-07-17.** El detalle histórico vive en [ESTADO-ARCHIVO.md](ESTADO-ARCHIVO.md). Fases → [ROADMAP.md](ROADMAP.md) · Backlog → [PROMPT-CONTINUACION.md](PROMPT-CONTINUACION.md) · Hallazgos → [HALLAZGOS.md](HALLAZGOS.md) · Índice de SPECs → [docs/README.md](docs/README.md).

**Stack:** React 19 + TS strict + Vite + PWA · Supabase (Postgres + RLS + Edge Functions) · realtime.
**Despliegue:** `main` → PROD (GitHub Pages, base `/satori-app/`) · `staging` → Cloudflare Pages (`satori-staging.pages.dev`). Verificar versión live con `{base}version.json`.

> **En una línea:** TODO lo operativo está en PROD y validado en piso por el dueño (Caja/Cierre/USD/Propinas ef-elec/Revisión/asistente/Bandeja + Proveedores lista simple + quick-wins C2/C3). **Lo ÚNICO que queda solo en `staging` es el PoS** (comandero/KDS/cobro/FE/inventario activo, migs 022–037), diferido y bloqueado por el PILAR de auth. La ventana de **estabilización quedó CERRADA**.

---

## (a) Ramas y proyectos Supabase

| Rama | Hash | Qué es |
|---|---|---|
| `main` | **`880c863`** | **PROD (estable, en uso).** Toda la capa de inteligencia + estabilidad + ola 2026-07 (Caja/Cierre/USD/Revisión/asistente + Bandeja + unificación) + propinas ef/elec + cierre ventas-0/resumen + Proveedores (lista simple, buscador, 'Puntual', Rechazar) + hotfix buscador Movimientos null-safe + quick-wins C2/C3 + buscador Proveedores. **SIN PoS.** Migs: ledger **≤021** + **038–046 + subset core de 026** out-of-band. |
| `staging` | **`8c41965`** | **Fuente de verdad del desarrollo.** Todo lo de `main` **+ el PoS/KDS/comandero + FE (SIM) + inventario activo COGS** (migs 022–037). Es lo único que separa staging de prod. Migs: ledger **022–038** + **039–046** out-of-band. |

> **Supabase refs:** **PROD = `yiczgdtirrkdvohdquzf`** ("satori-app") · **STAGING = `hwiatgicyyqyezqwldia`** ("satori-staging").
> 🛑 **RITUAL antes de CUALQUIER comando de base:** `cat supabase/.temp/project-ref` → confirmar el proyecto (NO existe `linked-project.json`). **`db query --linked` CUELGA en algunos entornos** → workaround: curl a la Management API (`POST .../v1/projects/<ref>/database/query`, token del Keychain macOS, servicio `Supabase CLI`). Ver HALLAZGOS.
> **Edge Functions (prod + staging):** `extract-document` (IA facturas; JWT + RLS) · `monthly-report` (Resend; ⚠️ sin auth — hallazgo #2) · **`cierre-email`** (C3; Resend; **JWT + RLS**, ACTIVE en ambos).

## (b) PROD vs STAGING

- **En PROD (`main` `880c863`) — ✅ TODO validado en piso por el dueño:** ventas/analítica · propinas (incl. **efectivo/electrónico**, mig 046) · caja (turnos + cierre 2 fases + movimientos + pendientes) · **cierre: ventas ₡0 con confirmación + resumen previo + fórmula USD firmada + Opción B (ajuste al ledger) + propinas por la vía real** · finanzas/P&L · reportes+emails · admin · auth F2 · realtime · offline · estabilidad (Olas 1/1.1, pantalla negra, IDOR, outbox) · Bandeja + unificación Bandeja↔Caja · Tier 3 Revisión/asistente · autorización de gerencia por contraseña (mig 045) · **Proveedores = lista simple con buscador** (rojo=deuda saldado → simplificado; ciclo 'Puntual'; Rechazar con gerencia) · **quick-wins C2 (historial over/short) + C3 (email del cierre)**.
- **Solo en STAGING:** el **PoS completo** (catálogo/salón, comandero, KDS, cobro+splits+ticket SIM, FE estructura SIM, inventario activo COGS) — migs 022–037. **Es lo único que queda por pasar**, DIFERIDO (bloqueado por el PILAR de auth, §f).
- **En rama aparte (sin merge):** `propina-pool` (espera decisión, §e).

## (c) Migraciones — ambos entornos con deuda out-of-band

| Entorno | En el ledger (`schema_migrations`) | Fuera del ledger | Notas |
|---|---|---|---|
| **PROD** | **≤021** | **038–046 + subset core de 026** | 022–037 (PoS) NO están. mig 046 = `tip_sessions.pool_barra_electronico_crc` (propinas ef/elec, 2026-07-10). Idempotentes, verificadas por privilegio. |
| **STAGING** | **022–038** | **039–046** | mig 046 aplicada 2026-07-09 (`db query --linked`). |

**⚠️ Reconciliación del ledger = sesión dedicada (NO tocar el historial):** ambos entornos arrastran migraciones out-of-band; persisten **009** (drift) y **035** (fantasma, solo en la rama `propina-pool`). **`db push`/`repair` FRENADOS** hasta esa sesión. Todo idempotente. `schema_migrations` intacto. **mig 047** (para la notificación de pago a proveedores) aún NO existe en ninguna base — depende de la firma de esa SPEC (§f-2).

> **Staging — migración de histórico CANCELADA (2026-07-09):** la tabla `ventas_efectivo_hist` fue creada y luego DROPeada (**no está viva, no la busques**). `cash_movements`/`suppliers` volvieron a pre-migración (**967 / 83**). Quedan **2 backups 30 días** (borrar tras confirmar): `cash_movements_pre_migracion_2026_07` · `suppliers_pre_migracion_2026_07`. **Prod nunca se tocó.** Detalle → HALLAZGOS.

## (d) Build por módulo

Gate de todo pase: **`VITE_APP_ENV=production npm run build` → EXIT 0** (`tsc -b`, **NO** `tsc --noEmit` — falso verde por `tsconfig` raíz con `files:[]`) + **suite SIN variables de entorno** (main ≈**231** tests · staging ≈**311**, arrastra los tests del PoS). El check **"Supabase Preview" es rojo crónico ajeno**; los que validan son `build`+`deploy` (Pages, prod) y `Cloudflare Pages` (staging).

Leyenda: ✅ en prod, **validado en piso** · 🧪 solo staging.

| Módulo | Estado | Dónde |
|---|---|---|
| Ventas · Propinas · Caja+cierre · Finanzas/P&L · Reportes · Admin · Auth · Realtime · Offline | ✅ | prod (`cashUtils`/`tipCalculations`/`computeTotals` SAGRADOS) |
| Estabilidad (Olas 1/1.1 · pantalla negra · IDOR `extract-document` · outbox `SIGNED_IN` · render Propinas) | ✅ | prod |
| Propinas efectivo/electrónico (mig 046) · Cierre ventas-0 + resumen · fórmula USD firmada · Opción B · propinas vía real | ✅ | prod + staging |
| Bandeja + unificación Bandeja↔Caja · Tier 3 Revisión/asistente · autorización por contraseña (mig 045) | ✅ | prod + staging |
| Proveedores = lista simple + buscador (ciclo 'Puntual' · Rechazar con gerencia) | ✅ | prod + staging |
| Quick-wins **C2** (historial over/short en Resumen) + **C3** (email del cierre, Edge Fn `cierre-email`) + buscador Proveedores | ✅ | prod + staging (⏳ smoke real de C3, §e-1) |
| Hotfix buscador Movimientos null-safe (`database.ts` mentía la nulabilidad vs `supabase.gen.ts`) | ✅ | prod + staging |
| PoS (comandero/KDS/cobro/ticket SIM) · FE SIM · Inventario activo COGS | 🧪 solo staging | staging (migs 022–037) |

## (e) Pendientes de PLATA / validación (sin firma o esperando validación de la dueña)

1. **⏳ Smoke real de C3** — el email del cierre nocturno (a **`cachorrogp@gmail.com`** por la restricción sandbox de Resend) manda el primer correo **solo** al confirmarse el cierre completo. **Lo confirma el dueño en piso.**
2. **🖊️ Edición de propinas en Historial por CAJERO con autorización de gerencia** — FIRMADO 2026-07-17. Contraseña manager/dueño, patrón mig 045 `requireManager` (igual que editar-pago en Caja). Sin esquema; **plata-adyacente → revisión estricta del asesor**.
3. **🖊️ Foto de comprobante obligatoria al pagar propina** — firmado, DIFERIDO. Toca `pagarPropina`/`propinaPago.ts`.
4. **🖊️ `propina-pool`** (rama, sin merge) — propina de tarjeta/SINPE ¿al mismo pool que efectivo o separada?

> **Tier 1 (monto-on-modify desde Revisión) = DESCARTADO por la dueña** (la Revisión NO modifica caja). No reabrir sin nueva firma.

## (f) Pendientes humanos / fiscales / técnicos (detalle → PROMPT-CONTINUACION)

1. **✅ SALDADO 2026-07-16 — Proveedores: el rojo = deuda real → simplificado a lista sola.** Los 2 huérfanos (`supplier_id` NULL, ₡150.043,52) **rechazados en prod por el dueño** → pestaña Pendientes 5→3, validado en piso. **P1 #1 / P2 #5 cerrados.**
2. **🖊️ SPEC notificación de pago a proveedores** — firma pendiente (vive en el **proyecto de Claude**, `claude/SPEC-notificacion-pago-proveedores.md`, fuera del repo). Requiere **mig 047** + **prerequisito DNS** (§f-6).
3. **🔴 Reconciliación del ledger de migraciones** (§c) — sesión dedicada; el asesor prepara el **plan read-only primero**. NO tocar el historial. Bloquea `db push`.
4. **🖊️👁️ Hora-CR en bordes de período (PLATA fiscal)** — las queries de plata (P&L, `finance.ts`) acotan `created_at` en UTC (+6h vs CR) → un cierre de noche puede caer en el período equivocado. Cambia números → valida la dueña.
5. **🧾 FE-CR (facturación electrónica Costa Rica)** — sesión dedicada propia; **bloquea F3 del PoS** (emisor certificado ante Hacienda, CIIU/CABYS).
6. **🖊️ DNS SiteGround (tarea corta)** — habilita remitente propio `@satoricostarica.com` + destinatario `satorisushibar@gmail.com` (hoy Resend solo entrega a `cachorrogp@gmail.com`). Momento natural para **rotar `RESEND_API_KEY`** (la de staging quedó expuesta en un transcript 2026-07-17; riesgo aceptado por el dueño). ⚠️ `REPORT_TO_EMAIL` es variable **COMPARTIDA con `monthly-report`** — no setearla sin mirar ambos.
7. **🚧 PILAR — arquitectura de sesión/auth escalable y multi-tenant** — bloquea el GRAN PASE del PoS a prod (~10 dispositivos concurrentes; hotelería/franquicias). Incorporar **C4/C5/B1** del research al diseño.
8. **🧹 Arranque limpio de PROD** (post-estabilización · NO es migración, es LIMPIEZA) + **🧮 `saldoCajaFuerte` sin ancla** (hallazgo 2026-07-09) — **NO accionar ahora.** Detalle → HALLAZGOS.

---

## Sagrados (NUNCA reimplementar sin acuerdo explícito)
`cashUtils` · `tipCalculations` · `computeTotals` (fórmula fiscal) · cierres de caja (la matemática del "debería") · cobro/vuelto/conversión · `posFiscal`. **Gate de todo pase:** estos archivos **byte-idénticos** (diff vacío) contra la rama destino.
