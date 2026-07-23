# HALLAZGOS — backlog triado de las auditorías (handoff 2026-06-25, addenda 2026-06-26/27/28, 2026-07-03, hotfix 2026-07-06)

> **SOLO evaluación.** Nada de esto fue accionado salvo lo indicado como ✅. Es el inventario de lo que
> las auditorías de esta sesión encontraron, para decidir qué atacar y en qué orden. No implementa nada.
> Estado/pase a prod → [ESTADO.md](ESTADO.md) · backlog priorizado → [PROMPT-CONTINUACION.md](PROMPT-CONTINUACION.md).

## 🔐 2026-07-23 (Fase B1) — `revoke ... from anon` INEFECTIVO: funciones SECURITY DEFINER ejecutables por `anon`

**Hallado auditando el DDL del `035` antes de traer su archivo.** No se arregló nada — solo se documenta.

- **El bug de patrón.** `create function` otorga **EXECUTE a PUBLIC** por defecto. Revocarle a `anon`
  (`revoke execute on function ... from anon`) **NO le quita lo que hereda de PUBLIC** → `anon` sigue
  pudiendo ejecutar. El patrón correcto es el de la **mig 045**: `revoke all on function ... from
  public, anon`.
- **Evidencia (STAGING, `proacl` crudo).** El `=X/postgres` inicial (sin rol antes del `=`) **es**
  PUBLIC con EXECUTE:

  | función | mig | `proacl` | `anon` puede ejecutar |
  |---|---|---|---|
  | `sync_pos_tips_to_pool` | 035 | `=X/postgres` \| … | 🔴 **sí** |
  | `delete_movement_cascade` | 039/043/044 | `=X/postgres` \| … | 🔴 **sí** |
  | `verify_manager_password` | 045 | *(sin `=X/`)* | ✅ no |

- **⚠️ Alcance PROD.** `delete_movement_cascade` **está en producción** (migs 039/043/044). En Fase A se
  verificó en prod que `verify_manager_password` sí está cerrada (`anon`=false), pero **no** se midió el
  ACL de `delete_movement_cascade` en prod → **verificarlo en B2** (lectura, read-only).
- **Mitigación vigente (por qué no es una emergencia):** ambas funciones tienen **guard interno de rol**
  — `sync_pos_tips_to_pool` hace `if get_my_role() not in ('owner','manager') then raise exception`, y
  `delete_movement_cascade` exige auth de manager desde la 044. Un `anon` que las invoque muere en el
  guard. Lo roto es la **defensa en profundidad**, no el control de acceso efectivo.
- **Acción propuesta (NO ejecutada):** una migración nueva que haga
  `revoke all on function <fn> from public, anon` para las funciones afectadas, y auditar el resto de
  las `SECURITY DEFINER` con el mismo criterio. **Toca privilegios de funciones de plata → firma.**
  El archivo `035_propina_pos_pool.sql` traído en B1 **conserva el DDL original a propósito** (debe
  reflejar lo aplicado) y lleva la advertencia en su cabecera.

## 🔎 Smoke físico PROD 2026-07-06 — TODO PASÓ · 1 hallazgo: pagos pendientes huérfanos

El dueño validó en piso el pase completo en PROD y **todo pasó**: `version.json` ✓ · Caja Diaria sin errores ✓ · asistente con foto + lectura IA Sonnet (efectivo y pendientes, genera tarea de revisión) ✓ · borrado con contraseña de manager (elimina movimiento + tarea asociada) ✓ · Cierre del Día con diferencias USD y gate de ajuste ✓ · sinceramiento USD realizado ✓ · Propinas sin parpadeo, pago por la vía real ✓. **La ola 2026-07 queda cerrada.**

- **🆕 [P1 estabilización] Pagos pendientes huérfanos en Proveedores.** **Síntoma:** en la pestaña **Proveedores** de Caja aparecen **"14 PAGOS PENDIENTES"** en rojo. **Dónde se ve:** vista de proveedores / pendientes de Caja Diaria. **El problema:** son pendientes de **proveedores que ya no existen** — datos huérfanos, **error viejo** (no lo introdujo el pase; el smoke solo lo hizo visible). **Hipótesis:** al borrar un proveedor, sus pagos/pendientes **no se limpiaron en cascada** → quedaron colgados sin fila de proveedor viva que los respalde; y/o la query de pendientes no filtra por proveedor existente. **Acción (registrar, NO arreglar ahora — estabilización):** (1) **limpieza de datos** — identificar los pendientes sin proveedor vivo y saldarlos/eliminarlos con criterio; (2) **prevención** — evaluar FK con `on delete` adecuado (o `set null` + filtro) y/o filtrar la query de pendientes por proveedor existente. NO tocar en caliente; entra al backlog P1.

## 🔥 Hotfix 2026-07-06 — faltaba el subset core de la mig 026 en PROD (columna `attachments`)

- **Síntoma:** en prod, la Bandeja/Caja tiraba `Could not find the 'attachments' column of 'cash_movements' in the schema cache`. **Causa raíz:** el pase único (2026-07-04) excluyó las migs **022–037 como "PoS"**, pero la **026 (`operacion_roles`) tiene 4 secciones core que la Bandeja/Caja SÍ necesitan** — no son PoS. Se colaron en el corte por estar en un archivo "de PoS".
- **Fix (out-of-band, Management API curl, mismo canal del pase):** se aplicaron a PROD (`yiczgdtirrkdvohdquzf`) las **secciones 1–4 de la 026** en una request: (1) `alter type user_role add value 'proveedor'`; (2) `cash_movements.attachments jsonb` (la columna del error); (3) bucket privado `facturas` + 3 políticas de Storage; (4) 4 políticas RLS del rol proveedor. Luego `NOTIFY pgrst, 'reload schema'`. **La sección 5 (`my_turno_stats`) quedó EXCLUIDA** — referencia `pos_orders`/`tip_entries` que prod no tiene y nada en prod la llama. Todo idempotente (`if not exists` / `on conflict` / `drop policy if exists`); aplicó limpio (HTTP 201).
- **Verificado (PROD):** columna `attachments` (jsonb) ✅ · enum `user_role='proveedor'` ✅ · bucket `facturas` ✅ · las 7 políticas creadas ✅ (`facturas_{insert,select,delete}` + `suppliers_proveedor_select` + `cash_sessions_proveedor_select` + `cash_movements_proveedor_{insert,select_own}`; una 8ª política pre-existente, `"Managers y owners ven proveedores"`, matchea el LIKE por el nombre pero es ajena).
- **Ledger NO tocado · NO se creó archivo de migración nuevo** (es un subset de la 026 que ya existe; numerarlo duplicado ensuciaría la secuencia). Queda como **más deuda out-of-band de prod** (`038–045 + subset core de 026`), a saldar en la reconciliación del ledger. Prod ahora tiene lo core de la 026 aplicado FUERA del `schema_migrations`.

## 🆕 Hallazgos 2026-07-03 (ola grande de Caja/Cierre/Revisión — todo en STAGING)

- **El FALTANTE FANTASMA del cierre — CAUSA RAÍZ ENCONTRADA Y ENTERRADA.** El cierre tiraba un faltante que no era real. Venía de un **desacople**: la fórmula del "debería" **restaba las propinas** (tipeadas), pero el movimiento `'Ventas cierre'` ingresaba el efectivo **BRUTO** a Caja Fuerte (sin descontar propinas). Resultado: el ledger de CF quedaba en `contado + propinas` → faltante fantasma cada día con propinas. **Muerto con "propinas por la vía real"** (`380cb9a`): ahora las propinas se pagan como movimiento real (egreso desde Registradora), la matemática resta las **efectivamente pagadas**, y `'Ventas cierre'` ingresa el **NETO** → `ledger = contado` exacto. El test del gap, que **documentaba** el desfase, se **dio vuelta** y ahora lo **afirma**. Validado físicamente: el cierre "cuadra correctamente" con propinas pagadas y el ledger arranca sincero a la mañana siguiente.
- **Ledger de Caja Fuerte con DÉFICIT HISTÓRICO USD (−$2678).** La fórmula USD firmada (`46ab5c6`: `calcDeberiaUSD` ahora suma `saldoBase.usd`) **destapó** que el ledger de CF nunca contó bien los dólares — retiros USD sin registrar eran **invisibles** para el cuadre viejo (solo miraba ventas). El −$2678 de staging es **espejo de prod**. **Reconciliado en staging** con un ajuste inicial firmado (Ismael cargó Movimientos → Ingreso · Otro CF, USD = físico + 2678). **Prod pendiente:** repetir con el conteo físico del día del pase (§PASE A PROD paso 5).
- **La EDICIÓN de un pago NO es un UPDATE — es `delete_movement_cascade` + `persistPago` recreate.** Por eso "editar un pago como cajero" fallaba sin pedir credenciales: el bloqueo real no estaba en un UPDATE (no existe) sino en el **reenvío de credenciales al path de plata** (la RPC de borrado re-valida server-side). Fundamenta por qué la mig 045 (autorización por contraseña) y el envolver el edit-path con `requireManager` + reenvío de credenciales. Confirmado leyendo `CashTurno.confirmPago` en modo edición.
- **El cambio de modelo de IA de `extract-document` es una ENV VAR, no código.** `ANTHROPIC_MODEL` (leído en `extract-document/index.ts` con default `claude-haiku-4-5`) → cambiar a `claude-sonnet-4-5` es `supabase secrets set`, **sin deploy de código, reversible al instante**. Aplica a las functions sin redeploy. **Trampa de handoff:** no viaja con el cherry-pick a prod → hay que replicarlo aparte (§PASE A PROD paso 4).
- **La verificación de la migración out-of-band se hace por privilegio, no por ledger.** `verify_manager_password` (045) se aplicó a staging con `db query --linked` y se verificó con `has_function_privilege('anon', ..., 'execute') = false` + `pg_proc.prosecdef = true`. Patrón repetible para el pase a prod.

## 🔄 CAMBIO DE RITUAL (2026-07-03) — el guardrail pre-comando-de-base ahora chequea `project-ref`

**El archivo del link del CLI cambió: `supabase/.temp/linked-project.json` YA NO EXISTE en el CLI v2.105.** El estado del link vive ahora en **`supabase/.temp/project-ref`** (texto plano con el ref; el mismo ref aparece también en `supabase/.temp/pooler-url`). El ritual obligatorio de abajo se actualiza: chequear **`cat supabase/.temp/project-ref`** (no `linked-project.json`). Debe decir `hwiatgicyyqyezqwldia` para staging. Si una checklist vieja pide verificar `linked-project.json`, el equivalente real es `project-ref`.

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
> `db push`, `db dump`, `db pull`…): correr **`cat supabase/.temp/project-ref`** → **DEBE** decir
> `hwiatgicyyqyezqwldia`. **🆕 CAMBIÓ (CLI v2.105): es `project-ref`, no `linked-project.json` (ya no existe).**
> Si no es staging: `supabase link --project-ref hwiatgicyyqyezqwldia` y **re-verificar**.
> **NUNCA correr un comando de DB sin confirmar el ref primero.** Bajo ningún concepto apuntar a `yiczgdtirrkdvohdquzf`.
> (En esta ola 2026-07-03 se usó `db query --linked` con doble check del `project-ref` para aplicar la mig 045 a staging.)

## ✅ Accionado esta sesión
- **Hallazgo A — PANTALLA NEGRA (bootstrap de `useAuth` sin tope).** Diagnosticado y **arreglado + validado en
  staging** (3 commits `0adf30e`/`f0f8127`/`8bed794` + palanca de diag `ee5878a`). Ver ESTADO §b-ter / PROMPT §0-ter.
  **Pendiente: pase a prod (PRIORIDAD 1).**

## ✅ Accionado 2026-06-28 (cont.) — Hallazgo B (PLATA)
- **B — drain del outbox en `SIGNED_IN` → RESUELTO en STAGING y 🆕 EN PROD** (`a14da50`, cherry-pick `52d26b9`; origen `492eaa5`, rama `fix/outbox-flush-on-signin`, mergeada por
  FF; client-side, **sin migración**). Antes `outbox.ts` flusheaba por `'online'` / arranque / un backoff que se apaga con la
  cola vacía; **NO** había flush atado a `SIGNED_IN`/re-login → la premisa "el outbox drena al reloguear" (del fix de
  auth-recovery) no estaba garantizada. **Fix:** `initOutbox` registra `supabase.auth.onAuthStateChange` y, vía el predicado
  exportado/testeable `shouldFlushOnAuthEvent` (SOLO `SIGNED_IN`; `TOKEN_REFRESHED`/`INITIAL_SESSION`/`SIGNED_OUT` **no**
  drenan), dispara el **mismo patrón que el handler de `online`** (reset de backoff + `autoFlush`, **no** `flushNow` directo —
  distinto del "Fix propuesto" original). Guard `outboxWired` contra doble-registro (blinda también el listener `online`).
  **NO** toca el `onAuthStateChange` global de `supabase.ts` ni `flushNow`/`supabaseExecutor`. Tests: +4 del gateo
  (`outbox.test.ts` 9→13); build prod **EXIT 0** + **155** verdes. 🆕 **PORTADO A PROD** (`a14da50`); validado en staging, smoke en prod pendiente del OK de la dueña.
  ✅ **Desbloquea la PRECONDICIÓN del auth-recovery** (hoy DIFERIDO; ver ESTADO §f / PROMPT §0-bis).

## ✅ Accionado 2026-06-28 (cont.) — Render de Propinas estabilizado (PLATA)
- **Render de Propinas inestable → ESTABILIZADO en STAGING y 🆕 EN PROD** (`a14da50`, cherry-pick; origen `ec70598`, rama `fix/propinas-render-estabilidad`, FF;
  client-side, **sin migración**). Bug de PROD que dejaba Propinas **inusable**: `take_home`/`pts_val` se guardaban en el
  estado `lines` y un `useEffect` los recalculaba con `setLines` → cada refetch de realtime (auto-eco de las escrituras
  propias) dejaba un frame con `take_home: 0` ("₡ —"); y el picker de Coberturas no excluía a los activos ni persistía.
  **Fix (4 partes):** (1) `take_home`/`pts_val` **DERIVADOS en un `useMemo`** (no en estado → síncrono, nunca un frame en 0);
  (2) el picker excluye a quienes ya participan (helper puro `availableForCobertura` + node-test); (3) `addCobertura`/
  `removeCobertura` **persisten** (upsert/delete → sobreviven un refetch); (4) refetch por auto-eco cortado con `pauseWhile`
  (3s) + `lastLocalWriteRef`. **SAGRADO intacto:** `tipCalculations.ts`/`calcTurno` **byte-idéntico**, payout al cerrar
  **idéntico** (merge 1:1 verificado; el `?? 0` es código muerto); `tips.ts` sin cambios de firma. Build EXIT 0, 159 tests
  (+4 del helper), **verificación adversarial 4/4 PASS**. 🆕 **PORTADO A PROD** (`a14da50`, cherry-pick limpio: `TipsModule.tsx`
  byte-idéntico en main); **crisis prod-down cerrada**; validado en staging, smoke en prod pendiente del OK de la dueña.

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
