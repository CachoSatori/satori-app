# HALLAZGOS — backlog triado de las auditorías (handoff 2026-06-25)

> **SOLO evaluación.** Nada de esto fue accionado salvo lo indicado como ✅. Es el inventario de lo que
> las auditorías de esta sesión encontraron, para decidir qué atacar y en qué orden. No implementa nada.
> Estado/pase a prod → [ESTADO.md](ESTADO.md) · backlog priorizado → [PROMPT-CONTINUACION.md](PROMPT-CONTINUACION.md).

## ✅ Accionado esta sesión
- **Hallazgo A — PANTALLA NEGRA (bootstrap de `useAuth` sin tope).** Diagnosticado y **arreglado + validado en
  staging** (3 commits `0adf30e`/`f0f8127`/`8bed794` + palanca de diag `ee5878a`). Ver ESTADO §b-ter / PROMPT §0-ter.
  **Pendiente: pase a prod (PRIORIDAD 1).**

## 🔜 Siguiente rama (PLATA)
- **B — drain del outbox en `SIGNED_IN`.** `outbox.ts` flushea por `'online'` / arranque / un backoff que **se apaga con
  la cola vacía**; **NO** hay flush atado a `SIGNED_IN`/re-login. La premisa "el outbox drena al reloguear" (del fix de
  auth-recovery) **no está garantizada**. Es plata. Fix propuesto: `flushNow()` en el `onAuthStateChange` con sesión fresca.
  → PRIORIDAD 2 en PROMPT-CONTINUACION.

## 🧪 Testing
- **Sin entorno DOM en vitest.** Los tests corren en node (no hay `@testing-library/react` ni `jsdom`/`happy-dom`), así que
  **no renderizan router ni guards**: el LOOP de redirección `/`↔`/login` (introducido por `f0f8127`) fue **invisible** para
  los tests y solo se vio al razonar las rutas. Propuesta: agregar `happy-dom` + RTL (cambia `package.json`/lock → NO entró
  en los fixes quirúrgicos de esta sesión) para poder testear PrivateRoute/PublicRoute/AuthProvider de verdad.

## 🔐 Seguridad (audit de la sesión — triado)
- **#1 IDOR en `extract-document`** (edge function): no valida auth/rol ni que el `image_path` pertenezca al usuario; baja
  CUALQUIER path del bucket privado `documents` con el service-role key. CORS `*`. **PRE-REQUISITO de la Ola 2/Bandeja:**
  no subir la Bandeja a prod con esto abierto.
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
