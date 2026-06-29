# HALLAZGOS — backlog triado de las auditorías (handoff 2026-06-25, addenda 2026-06-26/27/28)

> **SOLO evaluación.** Nada de esto fue accionado salvo lo indicado como ✅. Es el inventario de lo que
> las auditorías de esta sesión encontraron, para decidir qué atacar y en qué orden. No implementa nada.
> Estado/pase a prod → [ESTADO.md](ESTADO.md) · backlog priorizado → [PROMPT-CONTINUACION.md](PROMPT-CONTINUACION.md).

## ✅ Accionado 2026-06-28
- **#1 IDOR en `extract-document` → RESUELTO EN PROD.** La versión segura (`c38a252`) se **desplegó al Supabase de prod**
  (`supabase functions deploy extract-document --project-ref yiczgdtirrkdvohdquzf`; no va por git) y **`main` quedó alineado**
  (`a0d9f0d`, `extract-document/index.ts` byte-idéntico a staging/prod). **Smoke** `POST` sin `Authorization` → **`401`**
  (`UNAUTHORIZED_NO_AUTH_HEADER`). ✅ **Validación física:** la dueña leyó una factura real en prod con rol de caja → OK.
  **Pendiente OPCIONAL no bloqueante:** prueba cross-user (rol fuera de caja → `403` "Sin acceso al documento"). Sale de la
  lista de pendientes de pase (ver §🔐 Seguridad #1).
- **Footgun del link de Supabase → RESUELTO EN STAGING, pendiente en main.** `supabase/.temp/linked-project.json` estaba
  **trackeado apuntando a PROD** y `.temp/` no estaba ignorado → cualquier clon fresco arrancaba enlazado a prod (la causa del
  ⚠⚠ aprendizaje crítico de abajo). Fix `bb93335` (rama `chore/gitignore-supabase-temp`, mergeado a staging por FF):
  `git rm --cached supabase/.temp/` (sin borrar de disco) + `supabase/.temp/` en `.gitignore`. **⚠️ Solo en STAGING — en main
  sigue trackeado apuntando a prod** (portar; ver PROMPT-CONTINUACION ★ PENDIENTES NUEVOS).

## ✅ Accionado 2026-06-27
- **Borrado de día / descarte de turno saltaba la cascada.** `discardDiaCompleto`/`discardCashSession`
  borraban `cash_movements` con `.delete()` crudo → `accounting_entries` huérfanos + `inventory_review_task`
  colgadas (el mismo bug de integridad que mig 039 cerró para el borrado por movimiento, pero por estos dos
  caminos). **ARREGLADO + MERGEADO a staging** (`b8ab78c`): ambos enrutan por `delete_movement_cascade` con
  credenciales de gerencia (mig 044). Test `cash.discardDia.test.ts`. ✅ validada físicamente (pruebas A y B:
  la tarea de Revisión desaparece tras el borrado). Opcional no bloqueante: verificación SQL directa de 0
  `accounting_entries` huérfanos.
- **Lectura de facturas con IA fallaba desde el teléfono** (HEIC/peso/orientación EXIF → Anthropic vacío →
  "sin leer"). **ARREGLADO + MERGEADO a staging (`eefa056`):** se normaliza la foto en el navegador antes de
  subirla (`imageNormalize.ts`). Front-only. ✅ validada físicamente (captura directa con el teléfono).
- **Limpieza de código muerto no-money — MERGEADA a staging** (`9b1127c`→`abb2a25`). Los hallazgos de limpieza
  NO accionados (money-adjacent, sagrados, duplicación de `fi`, `InventoryStep.tsx` huérfano, `@types/dompurify`)
  están catalogados y rankeados en [INFORME-LIMPIEZA.md](INFORME-LIMPIEZA.md). **Follow-up sugerido:** `knip`/`ts-prune`
  en CI (el `noUnusedLocals` del build no detecta exports muertos).
- **Follow-up de seguridad pendiente (Edge Function):** endurecer `mediaType()` de `extract-document` para que NO
  dependa solo de la extensión del archivo. El fix de la foto (front normalizando a JPEG) resuelve el síntoma; el
  endurecimiento server-side queda como defensa en profundidad (no se tocó `supabase/` esta sesión).

## ⚠⚠ APRENDIZAJE CRÍTICO DE PROCESO (2026-06-26) — el CLI estaba enlazado a PRODUCCIÓN
El CLI de Supabase quedó **enlazado a PROD** (`ref yiczgdtirrkdvohdquzf`, "satori-app"), **NO a staging**
(`hwiatgicyyqyezqwldia`, "satori-staging"). Se descubrió al ir a diagnosticar el ledger; **lo cazó el guardrail
ANTES de tocar nada**. El link puede quedar apuntando a prod **sin avisar** (un `supabase/.temp/linked-project.json`
stale).

> 🆕 **MITIGACIÓN PARCIAL (2026-06-28, ver §✅ Accionado 2026-06-28):** `supabase/.temp/` quedó **untrackeado + ignorado en
> STAGING** (`bb93335`) → un clon fresco de staging ya no arranca enlazado a prod. **Pero en main sigue trackeado apuntando a
> prod** (pendiente de portar). El RITUAL de abajo sigue siendo obligatorio igual: el link local puede quedar en prod sin avisar.

> 🛑 **REGLA FIJA, ritual obligatorio — ANTES de CUALQUIER comando de base** (`migration list`, `db query`,
> `db push`, `db dump`, `db pull`…): correr `cat supabase/.temp/linked-project.json` → el `"ref"` **DEBE** ser
> `hwiatgicyyqyezqwldia`. Si no lo es: `supabase link --project-ref hwiatgicyyqyezqwldia` y **re-verificar**.
> **NUNCA correr un comando de DB sin confirmar el ref primero.** Bajo ningún concepto apuntar a `yiczgdtirrkdvohdquzf`.

## ✅ Accionado esta sesión
- **Hallazgo A — PANTALLA NEGRA (bootstrap de `useAuth` sin tope).** Diagnosticado y **arreglado + validado en
  staging** (3 commits `0adf30e`/`f0f8127`/`8bed794` + palanca de diag `ee5878a`). Ver ESTADO §b-ter / PROMPT §0-ter.
  **Pendiente: pase a prod (PRIORIDAD 1).**

## ✅ Accionado 2026-06-28 (cont.) — Hallazgo B (PLATA)
- **B — drain del outbox en `SIGNED_IN` → RESUELTO en STAGING** (`492eaa5`, rama `fix/outbox-flush-on-signin`, mergeada por
  FF; client-side, **sin migración**). Antes `outbox.ts` flusheaba por `'online'` / arranque / un backoff que se apaga con la
  cola vacía; **NO** había flush atado a `SIGNED_IN`/re-login → la premisa "el outbox drena al reloguear" (del fix de
  auth-recovery) no estaba garantizada. **Fix:** `initOutbox` registra `supabase.auth.onAuthStateChange` y, vía el predicado
  exportado/testeable `shouldFlushOnAuthEvent` (SOLO `SIGNED_IN`; `TOKEN_REFRESHED`/`INITIAL_SESSION`/`SIGNED_OUT` **no**
  drenan), dispara el **mismo patrón que el handler de `online`** (reset de backoff + `autoFlush`, **no** `flushNow` directo —
  distinto del "Fix propuesto" original). Guard `outboxWired` contra doble-registro (blinda también el listener `online`).
  **NO** toca el `onAuthStateChange` global de `supabase.ts` ni `flushNow`/`supabaseExecutor`. Tests: +4 del gateo
  (`outbox.test.ts` 9→13); build prod **EXIT 0** + **155** verdes. ⏳ **Validación física pendiente** (es plata).
  ✅ **Desbloquea la PRECONDICIÓN del auth-recovery** (hoy DIFERIDO; ver ESTADO §f / PROMPT §0-bis).

## 🧪 Testing
- **✅ RESUELTO (2026-06-26) — entorno DOM en vitest.** Se agregó `happy-dom` + React Testing Library + `vitest.setup.ts`
  (mergeado a staging `69d7749`). Default `node` a propósito; los tests DOM piden `// @vitest-environment happy-dom`.
  El smoke `src/App.smoke.test.tsx` **renderiza el árbol con router y falla si reaparece el loop `/`↔`/login`** (el bug que
  antes era invisible). Gates verdes: build prod EXIT 0 + vitest 19 files/141 tests.

## 🔐 Seguridad (audit de la sesión — triado)
- **✅ #1 IDOR en `extract-document` — RESUELTO EN PROD (2026-06-28)** (`c38a252`): exige JWT, baja bajo RLS sin service_role,
  CORS por allowlist; validado los 2 lados. **Desplegado al Supabase de prod + `main` alineado (`a0d9f0d`)**; smoke `401` +
  validación física (lectura OK con rol de caja). **Ya NO es prerequisito pendiente de la Ola 2.** Pendiente OPCIONAL: prueba
  cross-user (→ `403`). Ver §✅ Accionado 2026-06-28.
- **#2 `monthly-report` sin auth en el cuerpo** + el cliente lo invoca con `fetch` **sin `Authorization`**. **VERIFICAR** en
  el dashboard de Supabase si `verify_jwt` está on/off y si el botón de reporte de prod realmente manda (corre con service-role).
- **#3 falta `supabase/config.toml`** → el `verify_jwt` de las functions no está versionado (no se puede auditar/reproducir).
- **#14 `deploy.yml` sin gate de tests** — corre `tsc -b` (vía `npm run build`) pero **no `vitest`** antes de publicar a prod.
- **#5 `cash_cierres_dia` RLS** — `staging-rls.sql` tiene `using(true)` pero `staging-drift-sync.sql` la dropea; **verificar la
  policy VIVA contra la base** (no se puede desde el repo). Resto del audit de seguridad **parqueado**.

## 🔧 Deep-dive auth / recuperación (parqueado — varios solapan con el PILAR de escalabilidad de auth del PoS)
- **C — watchdog que borra el precache** (`index.html`, 15s): demasiado agresivo; en una red transitoria al boot puede
  borrar el app-shell offline. Propuesta: primero `reg.update()`+reload; wipe de caches solo ante fallo repetido y con red.
- **D — doble refresh de token** (SDK `startAutoRefresh` + `refreshSession` manual en `classifyRealtime`): refresh tokens de
  un solo uso → posible carrera; el lock lo mitiga salvo en el escape lock-free.
- **E — sin latido periódico:** la recuperación depende de que dispare `visibilitychange`/`focus`/`online`; falta un health-tick.
- **F — tormenta de re-suscripciones en `rt:healthy`:** cada `useRealtimeRefetch` re-suscribe a la vez (relevante para el
  PILAR de ~10 dispositivos).
- **H — `loadProfile` re-corre en cada `TOKEN_REFRESHED`** (cada hora + cada resume): query innecesaria.
- **I — doble carga de sesión al boot** (`getSession()` manual + `INITIAL_SESSION` de `onAuthStateChange`).
- **J — `getSession` perpetuo en `/login`** tras logout forzado (background work hasta sesión fresca).

## 🎓 Lección de la sesión
**Arreglar la capa donde está el síntoma, no la de al lado.** El RCA de realtime (máquina de 3 estados) era correcto pero
**incompleto**: el BOOTSTRAP de `useAuth` era el gemelo sin topear y **nadie lo había topeado** → causaba la pantalla negra
una semana después. El síntoma ("no carga / negro") apuntaba al arranque, no a realtime.
