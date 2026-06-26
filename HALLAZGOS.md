# HALLAZGOS — backlog triado de las auditorías (handoff 2026-06-25, addendum 2026-06-26)

> **SOLO evaluación.** Nada de esto fue accionado salvo lo indicado como ✅. Es el inventario de lo que
> las auditorías de esta sesión encontraron, para decidir qué atacar y en qué orden. No implementa nada.
> Estado/pase a prod → [ESTADO.md](ESTADO.md) · backlog priorizado → [PROMPT-CONTINUACION.md](PROMPT-CONTINUACION.md).

## ⚠⚠ APRENDIZAJE CRÍTICO DE PROCESO (2026-06-26) — el CLI estaba enlazado a PRODUCCIÓN
El CLI de Supabase quedó **enlazado a PROD** (`ref yiczgdtirrkdvohdquzf`, "satori-app"), **NO a staging**
(`hwiatgicyyqyezqwldia`, "satori-staging"). Se descubrió al ir a diagnosticar el ledger; **lo cazó el guardrail
ANTES de tocar nada**. El link puede quedar apuntando a prod **sin avisar** (un `supabase/.temp/linked-project.json`
stale).

> 🛑 **REGLA FIJA, ritual obligatorio — ANTES de CUALQUIER comando de base** (`migration list`, `db query`,
> `db push`, `db dump`, `db pull`…): correr `cat supabase/.temp/linked-project.json` → el `"ref"` **DEBE** ser
> `hwiatgicyyqyezqwldia`. Si no lo es: `supabase link --project-ref hwiatgicyyqyezqwldia` y **re-verificar**.
> **NUNCA correr un comando de DB sin confirmar el ref primero.** Bajo ningún concepto apuntar a `yiczgdtirrkdvohdquzf`.

## ✅ Accionado esta sesión
- **Hallazgo A — PANTALLA NEGRA (bootstrap de `useAuth` sin tope).** Diagnosticado y **arreglado + validado en
  staging** (3 commits `0adf30e`/`f0f8127`/`8bed794` + palanca de diag `ee5878a`). Ver ESTADO §b-ter / PROMPT §0-ter.
  **Pendiente: pase a prod (PRIORIDAD 1).**

## 🔜 Siguiente rama (PLATA)
- **B — drain del outbox en `SIGNED_IN`.** `outbox.ts` flushea por `'online'` / arranque / un backoff que **se apaga con
  la cola vacía**; **NO** hay flush atado a `SIGNED_IN`/re-login. La premisa "el outbox drena al reloguear" (del fix de
  auth-recovery) **no está garantizada**. Es plata. Fix propuesto: `flushNow()` en el `onAuthStateChange` con sesión fresca.
  ⚠️ **Es la PRECONDICIÓN para retomar el auth-recovery** (hoy DIFERIDO; ver ESTADO §b3): sin cerrar B, el escape a
  `/login` no garantiza que el pago encolado se sincronice. → PRIORIDAD 2 en PROMPT-CONTINUACION.

## 🧪 Testing
- **✅ RESUELTO (2026-06-26) — entorno DOM en vitest.** Se agregó `happy-dom` + React Testing Library + `vitest.setup.ts`
  (mergeado a staging `69d7749`). Default `node` a propósito; los tests DOM piden `// @vitest-environment happy-dom`.
  El smoke `src/App.smoke.test.tsx` **renderiza el árbol con router y falla si reaparece el loop `/`↔`/login`** (el bug que
  antes era invisible). Gates verdes: build prod EXIT 0 + vitest 19 files/141 tests.

## 🔐 Seguridad (audit de la sesión — triado)
- **✅ #1 IDOR en `extract-document` — CERRADO en staging** (`c38a252`): ahora exige JWT, baja bajo RLS sin service_role,
  CORS por allowlist; validado los 2 lados. **Sigue SOLO en staging** → su pase a prod (cherry-pick con firma) es
  prerequisito de la Ola 2/Bandeja. Ver ESTADO §b-previas.
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
