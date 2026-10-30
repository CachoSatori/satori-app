# HALLAZGOS — backlog triado de las auditorías (al día: 2026-10-30)

> **Cómo leer este archivo:** arriba está **lo vigente** — el triage al 30/10 de todo lo anterior y los hallazgos
> nuevos de octubre. Abajo, en **📚 Histórico**, quedan completas y sin editar las entradas de junio a agosto (la
> versión de `staging`, que contiene toda la de `main`). Cada estado de arriba se verificó contra el repo o contra
> las bases el 30/10. El backlog accionable está en [PROMPT-CONTINUACION.md](PROMPT-CONTINUACION.md).

---

## 🆕 Hallazgos de octubre 2026 (go-live del PoS)

1. **Branching corre `migrate` contra PROD en cada push a `main`** (confirmado de nuevo en los logs de #13–#16:
   `Connecting to database... All migrations are up to date.`). **Decisión vigente:** las migraciones se aplican a
   mano en prod **antes** del merge y se verifican; el merge queda como no-op para la base. Así entraron 062–066 y la
   067. Regla escrita en [ESTADO.md](ESTADO.md).
2. **Un PR con `supabase/functions/` re-desplegaría las funciones con `verify_jwt=true`** (no hay `config.toml`).
   `ingest-ndf` corre en prod como v1 con `verify_jwt=false` y el agente solo manda `x-ingest-secret`: un redeploy
   automático le daría 401 en cada ciclo. Por eso #13 se mergeó sin la carpeta. Abierto hasta el ítem 11.
3. **El RLS de `pos_ndf_*` devuelve 0 filas a un salonero, sin error** (medido el 29/10 con el JWT de un salonero
   real). Con `'pos'` la app caía en silencio al Excel. **Resuelto (30/10):** mig 067 (funciones sin medios de pago,
   un solo camino para todos los roles) + `estadoPos` y franja «Mostrando solo el Excel…» cuando no se puede leer.
4. **Las tablas `pos_ndf_*` no tienen PII** (sin nombre, teléfono, dirección ni cédula de cliente; texto libre
   revisado). Sí tienen datos sensibles del negocio: medios de pago por factura, descuentos y `clase_ingreso`
   (`duenos` 322, `cortesia` 1.732). Las funciones 067 no los devuelven.
5. **«Ver como» usa los permisos del owner:** no sirve para probar permisos. La 067 se probó con un salonero real
   en staging y simulando el JWT en prod.
6. **El ICP de la pestaña del owner dividía `payout_crc`** (lo cobrado del reparto), no la propina generada: FRANCO
   (barman) daba 411 % y los saloneros la mitad. **Resuelto (#15):** propina electrónica declarada, barra «no
   aplica», benchmark único con Mi Rendimiento.
7. **Con el Excel, el ICP de octubre salía inflado** (15,7 %): las ventas del Excel cortan el 20/10 y las propinas
   llegan al 28/10. Con el PoS da 10,6 %. Los umbrales (≥13 / <10 %) siguen sin recalibrar contra el histórico 5–9 %.
8. **`version.json` desde el navegador lleva al login:** el service worker (`NavigationRoute` con allowlist
   `^/satori-app/` y denylist solo `/inbox/share`) responde `index.html` a esa navegación. El archivo sí se publica.
   Abierto: agregar `/\/version\.json$/` a `navigateFallbackDenylist`.
9. **El deploy de #16 quedó en `waiting`** ~13 min (job `deploy` del run #247): regla de protección del environment
   `github-pages`, que el deploy de #15 no tuvo. Abierto: revisar si es a propósito.
10. **Cloudflare Pages:** según el ESTADO de septiembre, la URL principal de staging publica desde
    `integracion/analitica-staging`, que quedó 4 commits atrás de `staging`. Lo validado el 30/10 en staging fue un
    deploy de *preview* de `staging`. Abierto: alinear las ramas.
11. **Agente de BioTime parado desde el 14/09** (última sync 17:12 UTC). Abierto.
12. **Ledger de staging sin las filas 065 y 066** (las columnas existen). Abierto.
13. **«Contexto jueves» de Hoy mostró un promedio mal** (₡235.773 vs ₡406.064) mientras cargaba el histórico.
    Abierto: revisar si mezcla Excel y PoS.

## 🧭 Triage al 30/10 de lo anterior

| Hallazgo (sección del histórico) | Estado al 30/10 | Evidencia |
|---|---|---|
| Branching auto-aplica migraciones a prod (2026-08-07 noche) | ✅ **Adoptado y vigente** | Logs de Branching de #13–#16; regla en ESTADO.md |
| Mig 052 auditoría de ediciones + ledger de staging reconciliado (2026-08-07 tarde) | ✅ Resuelto · 🆕 el ledger de staging volvió a quedar sin 065/066 | 052 en el ledger de prod (45 filas) |
| `delete_movement_cascade` no se puede llamar por la Management API (2026-08-07) | ✅ Vigente como aprendizaje | — |
| El auto-disparo de «Deploy to GitHub Pages» falló en 2 pases (2026-08-07) | ✅ Ya no pasa (runs #244–#247 dispararon solos) · 🆕 ver octubre #9 | Runs de Actions |
| `revoke … from anon` inefectivo en `SECURITY DEFINER` (B1, 2026-07-23) | 🟠 **Parcial:** B2 endureció las de plata; **quedan 4** ejecutables por `anon` (`get_my_role`, `handle_new_user`, `log_movement_edit`, `unif_on_cash_movement`) | `has_function_privilege('anon', …)` en prod, 30/10 |
| Pagos pendientes huérfanos en Proveedores (smoke 2026-07-06) | ✅ Resuelto | El dueño rechazó los huérfanos desde la UI; T3 #7 |
| Subset core de la 026 en prod (hotfix 2026-07-06) | ✅ Resuelto · excepción permanente | Documentado en ESTADO.md |
| Faltante fantasma del cierre · déficit USD de CF · edición de pago = cascade (2026-07-03) | ✅ Resuelto / histórico | Pozo único + T3 en prod |
| Ritual de `project-ref` antes de comandos de base (2026-07-03) | ✅ **Vigente** | Regla 7 de ESTADO.md |
| Accionados 2026-06-26/27/28 (IDOR, cascadas, IA desde el teléfono, outbox, render de Propinas, pantalla negra) | ✅ Resueltos y en prod | — |
| Seguridad #1 IDOR `extract-document` | ✅ Resuelto (prod v7, `verify_jwt` on) | Management API |
| Seguridad #2 `monthly-report` sin auth | 🔴 **Abierto** (prod v9, `verify_jwt` off) | Management API, 30/10 |
| Seguridad #3 falta `supabase/config.toml` | 🔴 **Abierto** (= ítem 11) | No existe en `main` |
| Seguridad #14 `deploy.yml` sin gate de tests | 🔴 **Abierto** | `deploy.yml` no corre `vitest` |
| Seguridad #5 RLS de `cash_cierres_dia` | ✅ Verificado: prod y staging tienen las mismas 2 policies (lectura: cualquier autenticado; escritura: owner/manager/cajero/contador) | `pg_policies`, 30/10 |
| Deep-dive auth C–J (watchdog, doble refresh, latido, re-suscripciones…) | ⏸️ Parqueado, va con el PILAR | — |
| Testing: entorno DOM en vitest | ✅ Resuelto | — |

---

# 📚 Histórico — entradas de junio a agosto 2026, sin editar

## HALLAZGOS — backlog triado de las auditorías (handoff 2026-06-25, addenda 2026-06-26/27/28, 2026-07-03, hotfix 2026-07-06)

> **SOLO evaluación.** Nada de esto fue accionado salvo lo indicado como ✅. Es el inventario de lo que
> las auditorías de esta sesión encontraron, para decidir qué atacar y en qué orden. No implementa nada.
> Estado/pase a prod → [ESTADO.md](ESTADO.md) · backlog priorizado → [PROMPT-CONTINUACION.md](PROMPT-CONTINUACION.md).

### 🔌 2026-08-07 (noche) — HALLAZGO: la base de prod tiene auto-deploy de migraciones (Supabase Branching)

Al pasar la mig 052 a prod, el pre-check read-only encontró que **prod YA la tenía aplicada** — sin apply manual.
Investigado 100% read-only (`gh api` checks + Management API GET `/branches` + `git log`). Resumen ejecutivo →
[`_handoff/INTEGRACION-SUPABASE.md`](_handoff/INTEGRACION-SUPABASE.md).

- **Mecanismo:** lo hace la **Supabase GitHub App** (`app_slug: supabase`) con **Branching** activo — **NO** un
  workflow del repo (el único es `.github/workflows/deploy.yml`, solo frontend con la anon key) y **NO** hay
  `supabase/config.toml`. Es la app la que postea el check **"Supabase Preview"**.
- **Alcance = SOLO PROD.** Management API `/branches` del proyecto prod (`yiczgdti`) devuelve 1 rama: `name:"main"`,
  `is_default:true`, `git_branch:"main"` (la base de producción atada a git `main`). En commits de la rama git
  `staging` el check sale **`skipped`** → el proyecto **STAGING (`hwiatgic`) NO está atado a la integración**
  (sus migraciones siguen manuales por CLI/Management API).
- **Disparo:** push a `main`. La app corre `db push` contra prod; si el commit trae un `.sql` nuevo en
  `supabase/migrations/`, lo **aplica + registra en `schema_migrations`**. Evidencia: `6bb9c33` (mig 052) → prod
  **35→36 filas**, `movement_edits` creada, fila 052 con **9 statements** (formato db push).
- **Condición (por qué antes NO aplicaba):** el `db push` a prod solo entra si el **ledger de prod está
  consistente**. Evidencia gh api: en commits de main **pre-B2** (≤ 2026-07-23: c77ced0, 1c8a9ad, 3df4feb) el
  check era **`failure`** (drift del ledger → db push fallaba); **desde el B2** (2026-07-27, prod reconciliado)
  es **`success`** en todos. → El viejo "Supabase Preview rojo crónico" era ESO, y ya se dio vuelta. Los pases
  viejos evitaban el auto-apply **aplicando la mig out-of-band ANTES de pushear** (nada pendiente → verde no-op).
- **Superficie de riesgo:** (1) **cualquier `.sql` nuevo/modificado en `supabase/migrations/` que llegue a
  `main`** (push directo o merge de PR) → auto-aplicado a prod. (2) **Edge functions PROBABLEMENTE también**
  (la rama reporta `status: FUNCTIONS_DEPLOYED`) → **A CONFIRMAR** si cambios en `supabase/functions/` en main
  se despliegan solos a prod. (3) NO toca el frontend (eso es Pages) ni staging.
- **⚠️ Implicación:** el orden "git primero (reversible) · base al final" **NO se sostiene para prod**: pushear
  el `.sql` a `main` YA es el apply. Un `Supabase Preview` verde sobre un commit de main con `.sql` nuevo = ya
  está en prod → **NO correr apply/repair manual después** (el repair duplicaría la fila del ledger).
- **DECISIÓN: ADOPTADA** (el pase a prod pasa a ser el push a main + verificar). **Guardrails:** (1) una mig
  llega a `main` **solo cuando ya va para prod** y con el **ledger de prod consistente**; (2) **staging sigue
  manual**. **Interruptor** si se quiere desactivar: Dashboard de Supabase → proyecto `yiczgdti` → **Branches**
  (o Settings → Integrations → GitHub). No tocado (solo identificado).

### 🧾 2026-08-07 (tarde) — Auditoría de EDICIONES (mig 052) + ledger de STAGING reconciliado

- **Mig `052` — auditoría de EDICIONES de `cash_movements`** (espejo de `movement_deletions`/039, pero para
  UPDATE). Tabla `movement_edits` **append-only** + trigger `AFTER UPDATE` `log_movement_edit()` (`SECURITY
  DEFINER`) que registra **solo** cambios en 10 columnas sensibles (`amount_crc, amount_usd, method,
  movement_type, caja_origen, status, subcategory, classification, account_id, supplier_id`); ignora no-op /
  cosméticos / el toque de `updated_at`. RLS **solo-SELECT** owner/manager/contador (ningún cliente forja o borra
  trazas; escribe únicamente el trigger). **Aplicada out-of-band a staging + verificada punta a punta** (una
  edición real por la app dejó su fila con `edited_by` = usuario). Cero código de app, sagrados byte-idénticos.
  **Commit `2ccdfa0`, FF-merged a `staging`.**
- **Ledger de STAGING reconciliado.** `schema_migrations` cortaba en **049** con `050`/`051`/`052` aplicadas
  FUERA del ledger. `supabase migration repair --status applied 050 051 052` → **49 → 52 filas**, `migration
  list` alineado (local==remote, sin huérfanos), **`db push` desbloqueado** (`Remote database is up to date`,
  no-op). Con **backups antes/después** (`_handoff/ledger-staging-2026-08-07-{pre,post}-reconciliacion.json`) y
  **`--status applied`** (NUNCA `reverted` — le mentiría al ledger sobre plata real).
- **PROD ya estaba consistente — NO se tocó.** Foto read-only por el canal firmado (`comun.ts`/`prod-gate`,
  `read_only:true` + smoke `25006`): prod tiene **35 filas** y `050`/`051` **ya están en su ledger** (los docs
  viejos decían "33 filas + `051` out-of-band" → desactualizado). El **único pendiente de prod es la `052`**.
- **Pase de `052` a PROD = su propia sesión, con firma.** Como el ledger de prod SÍ es consistente, allá la `052`
  lleva **`migration repair --status applied 052`** además del SQL out-of-band (a diferencia de staging, donde
  se registró junto con el arrastre `050`/`051`).

### 🧭 2026-08-07 — 2 aprendizajes operativos (pases ítems 1/7/8)

- **`delete_movement_cascade` NO se puede llamar por el canal admin (Management API).** La versión de prod
  (mig 044) exige en su FASE 1 de autorización una de dos: `get_my_role() in ('owner','manager')` (sesión de
  app con JWT) **o** `p_manager_email` + `p_manager_password` validados server-side (crypt). Por la Management
  API el contexto corre como `supabase_read_only_user` con `get_my_role() = null` y `auth.uid() = null` → cae
  al `else` → `raise 'No autorizado para borrar movimientos'`. **Conclusión:** los **borrados** de movimientos
  van **desde la app** logueado como owner/manager; por SQL admin solo se pueden hacer **correcciones** (UPDATE
  directo, que NO pasa por esa RPC). Por eso el ítem 7 se **corrigió** en vez de borrarse. (Un `DELETE` crudo
  tampoco sirve: `inventory_movements.cash_movement_id` es `ON DELETE SET NULL` → dejaría inventario huérfano
  + el documento colgando + sin auditoría — justo lo que la mig 039/044 existe para evitar.)
- **El auto-disparo del workflow "Deploy to GitHub Pages" falló en 2 pases seguidos.** El push a `main` **no
  disparó** el workflow (Actions habilitado, sin `[skip ci]`); hubo que lanzarlo a mano con
  `gh workflow run deploy.yml --ref main` (`workflow_dispatch`). Además, con congestión de runners, algunos
  jobs quedaron en cola ~15 min y fueron **cancelados** (`build`/`deploy: cancelled` → run `failure`, aunque el
  código compile local), y dispatches repetidos **colisionan en el grupo de concurrencia `pages`**. **A revisar
  en `deploy.yml`:** por qué el trigger `on: push` no dispara (¿filtros de `paths`? ¿webhook?) y la
  `concurrency`. Workaround: verificar que no haya runs `queued`/`in_progress`, lanzar **UN** dispatch limpio y
  monitorear; confirmar por `version.json.commit` + grafo de chunks, **nunca por HTTP 200** (el fallback SPA
  responde 200 a cualquier `/assets/*.js` inexistente).

### 🔐 2026-07-23 (Fase B1) — `revoke ... from anon` INEFECTIVO: funciones SECURITY DEFINER ejecutables por `anon`

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

- **🔴 ALCANCE REAL: 12 de 17.** Al barrer TODAS las `SECURITY DEFINER` de `public` con
  [`scripts/ledger-reconciliacion/acl-funciones.ts`](scripts/ledger-reconciliacion/acl-funciones.ts)
  (staging) resultó que **no son 2, son 12** las ejecutables por `anon`:

  🔴 `delete_movement_cascade` · `get_my_role` · `handle_new_user` · `mark_factura_verified` ·
  `my_turno_stats` · `pos_cobrar_check` · `pos_cobrar_orden` · `pos_merge_orden` ·
  `pos_reopen_orden` · `pos_unmerge_orden` · `sync_pos_tips_to_pool` · `unif_on_cash_movement`

  ✅ Cerradas correctamente (patrón `from public, anon`): `complete_inventory_review` ·
  `discard_inventory_review` · `post_accounting_entry` · `verify_manager` · `verify_manager_password`

  **De las 12, las de COBRO del PoS (`pos_cobrar_*`) son plata.** El PoS **no está en prod**, pero
  `delete_movement_cascade`, `mark_factura_verified`, `unif_on_cash_movement`, `get_my_role` y
  `handle_new_user` **sí**. Correr el mismo script contra prod es parte de B2.

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

- **✅ MEDIDO Y ENDURECIDO EN PROD (B2, 2026-07-27, con firma).** `acl-funciones.ts prod` (read-only)
  dio **5/10** `SECURITY DEFINER` ejecutables por `anon`: `delete_movement_cascade`,
  `mark_factura_verified`, `get_my_role`, `handle_new_user`, `unif_on_cash_movement` (las `pos_*`
  **no existen en prod**). La **mig 049** aplicó `revoke all ... from public, anon` a las **2 RPC
  directas de plata/auditoría** (`delete_movement_cascade(uuid,text,text,text)` +
  `mark_factura_verified(uuid)`) → ambas `anon`=false; prod quedó en **3/10**. Se dejaron **afuera a
  propósito**: `get_my_role` (helper de RLS `TO public` → revocarlo puede cambiar "RLS niega" por
  "permission denied"; a `anon` no le filtra nada) y los 2 triggers (`unif_on_cash_movement`,
  `handle_new_user` — no invocables directo; el revoke no frena el disparo). Detalle →
  [`_handoff/acl-prod-2026-07-27.md`](_handoff/acl-prod-2026-07-27.md). La 049 se portó también a
  staging (12/17 → **10/17**; las `pos_*` van con el pase del PoS).

### 🔎 Smoke físico PROD 2026-07-06 — TODO PASÓ · 1 hallazgo: pagos pendientes huérfanos

El dueño validó en piso el pase completo en PROD y **todo pasó**: `version.json` ✓ · Caja Diaria sin errores ✓ · asistente con foto + lectura IA Sonnet (efectivo y pendientes, genera tarea de revisión) ✓ · borrado con contraseña de manager (elimina movimiento + tarea asociada) ✓ · Cierre del Día con diferencias USD y gate de ajuste ✓ · sinceramiento USD realizado ✓ · Propinas sin parpadeo, pago por la vía real ✓. **La ola 2026-07 queda cerrada.**

- **🆕 [P1 estabilización] Pagos pendientes huérfanos en Proveedores.** **Síntoma:** en la pestaña **Proveedores** de Caja aparecen **"14 PAGOS PENDIENTES"** en rojo. **Dónde se ve:** vista de proveedores / pendientes de Caja Diaria. **El problema:** son pendientes de **proveedores que ya no existen** — datos huérfanos, **error viejo** (no lo introdujo el pase; el smoke solo lo hizo visible). **Hipótesis:** al borrar un proveedor, sus pagos/pendientes **no se limpiaron en cascada** → quedaron colgados sin fila de proveedor viva que los respalde; y/o la query de pendientes no filtra por proveedor existente. **Acción (registrar, NO arreglar ahora — estabilización):** (1) **limpieza de datos** — identificar los pendientes sin proveedor vivo y saldarlos/eliminarlos con criterio; (2) **prevención** — evaluar FK con `on delete` adecuado (o `set null` + filtro) y/o filtrar la query de pendientes por proveedor existente. NO tocar en caliente; entra al backlog P1.

### 🔥 Hotfix 2026-07-06 — faltaba el subset core de la mig 026 en PROD (columna `attachments`)

- **Síntoma:** en prod, la Bandeja/Caja tiraba `Could not find the 'attachments' column of 'cash_movements' in the schema cache`. **Causa raíz:** el pase único (2026-07-04) excluyó las migs **022–037 como "PoS"**, pero la **026 (`operacion_roles`) tiene 4 secciones core que la Bandeja/Caja SÍ necesitan** — no son PoS. Se colaron en el corte por estar en un archivo "de PoS".
- **Fix (out-of-band, Management API curl, mismo canal del pase):** se aplicaron a PROD (`yiczgdtirrkdvohdquzf`) las **secciones 1–4 de la 026** en una request: (1) `alter type user_role add value 'proveedor'`; (2) `cash_movements.attachments jsonb` (la columna del error); (3) bucket privado `facturas` + 3 políticas de Storage; (4) 4 políticas RLS del rol proveedor. Luego `NOTIFY pgrst, 'reload schema'`. **La sección 5 (`my_turno_stats`) quedó EXCLUIDA** — referencia `pos_orders`/`tip_entries` que prod no tiene y nada en prod la llama. Todo idempotente (`if not exists` / `on conflict` / `drop policy if exists`); aplicó limpio (HTTP 201).
- **Verificado (PROD):** columna `attachments` (jsonb) ✅ · enum `user_role='proveedor'` ✅ · bucket `facturas` ✅ · las 7 políticas creadas ✅ (`facturas_{insert,select,delete}` + `suppliers_proveedor_select` + `cash_sessions_proveedor_select` + `cash_movements_proveedor_{insert,select_own}`; una 8ª política pre-existente, `"Managers y owners ven proveedores"`, matchea el LIKE por el nombre pero es ajena).
- **Ledger NO tocado · NO se creó archivo de migración nuevo** (es un subset de la 026 que ya existe; numerarlo duplicado ensuciaría la secuencia). Queda como **más deuda out-of-band de prod** (`038–045 + subset core de 026`), a saldar en la reconciliación del ledger. Prod ahora tiene lo core de la 026 aplicado FUERA del `schema_migrations`.

### 🆕 Hallazgos 2026-07-03 (ola grande de Caja/Cierre/Revisión — todo en STAGING)

- **El FALTANTE FANTASMA del cierre — CAUSA RAÍZ ENCONTRADA Y ENTERRADA.** El cierre tiraba un faltante que no era real. Venía de un **desacople**: la fórmula del "debería" **restaba las propinas** (tipeadas), pero el movimiento `'Ventas cierre'` ingresaba el efectivo **BRUTO** a Caja Fuerte (sin descontar propinas). Resultado: el ledger de CF quedaba en `contado + propinas` → faltante fantasma cada día con propinas. **Muerto con "propinas por la vía real"** (`380cb9a`): ahora las propinas se pagan como movimiento real (egreso desde Registradora), la matemática resta las **efectivamente pagadas**, y `'Ventas cierre'` ingresa el **NETO** → `ledger = contado` exacto. El test del gap, que **documentaba** el desfase, se **dio vuelta** y ahora lo **afirma**. Validado físicamente: el cierre "cuadra correctamente" con propinas pagadas y el ledger arranca sincero a la mañana siguiente.
- **Ledger de Caja Fuerte con DÉFICIT HISTÓRICO USD (−$2678).** La fórmula USD firmada (`46ab5c6`: `calcDeberiaUSD` ahora suma `saldoBase.usd`) **destapó** que el ledger de CF nunca contó bien los dólares — retiros USD sin registrar eran **invisibles** para el cuadre viejo (solo miraba ventas). El −$2678 de staging es **espejo de prod**. **Reconciliado en staging** con un ajuste inicial firmado (Ismael cargó Movimientos → Ingreso · Otro CF, USD = físico + 2678). **Prod pendiente:** repetir con el conteo físico del día del pase (§PASE A PROD paso 5).
- **La EDICIÓN de un pago NO es un UPDATE — es `delete_movement_cascade` + `persistPago` recreate.** Por eso "editar un pago como cajero" fallaba sin pedir credenciales: el bloqueo real no estaba en un UPDATE (no existe) sino en el **reenvío de credenciales al path de plata** (la RPC de borrado re-valida server-side). Fundamenta por qué la mig 045 (autorización por contraseña) y el envolver el edit-path con `requireManager` + reenvío de credenciales. Confirmado leyendo `CashTurno.confirmPago` en modo edición.
- **El cambio de modelo de IA de `extract-document` es una ENV VAR, no código.** `ANTHROPIC_MODEL` (leído en `extract-document/index.ts` con default `claude-haiku-4-5`) → cambiar a `claude-sonnet-4-5` es `supabase secrets set`, **sin deploy de código, reversible al instante**. Aplica a las functions sin redeploy. **Trampa de handoff:** no viaja con el cherry-pick a prod → hay que replicarlo aparte (§PASE A PROD paso 4).
- **La verificación de la migración out-of-band se hace por privilegio, no por ledger.** `verify_manager_password` (045) se aplicó a staging con `db query --linked` y se verificó con `has_function_privilege('anon', ..., 'execute') = false` + `pg_proc.prosecdef = true`. Patrón repetible para el pase a prod.

### 🔄 CAMBIO DE RITUAL (2026-07-03) — el guardrail pre-comando-de-base ahora chequea `project-ref`

**El archivo del link del CLI cambió: `supabase/.temp/linked-project.json` YA NO EXISTE en el CLI v2.105.** El estado del link vive ahora en **`supabase/.temp/project-ref`** (texto plano con el ref; el mismo ref aparece también en `supabase/.temp/pooler-url`). El ritual obligatorio de abajo se actualiza: chequear **`cat supabase/.temp/project-ref`** (no `linked-project.json`). Debe decir `hwiatgicyyqyezqwldia` para staging. Si una checklist vieja pide verificar `linked-project.json`, el equivalente real es `project-ref`.

### ✅ Accionado 2026-06-28
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

### ✅ Accionado 2026-06-27
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

### ⚠⚠ APRENDIZAJE CRÍTICO DE PROCESO (2026-06-26) — el CLI estaba enlazado a PRODUCCIÓN
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

### ✅ Accionado esta sesión
- **Hallazgo A — PANTALLA NEGRA (bootstrap de `useAuth` sin tope).** Diagnosticado y **arreglado + validado en
  staging** (3 commits `0adf30e`/`f0f8127`/`8bed794` + palanca de diag `ee5878a`). Ver ESTADO §b-ter / PROMPT §0-ter.
  **Pendiente: pase a prod (PRIORIDAD 1).**

### ✅ Accionado 2026-06-28 (cont.) — Hallazgo B (PLATA)
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

### ✅ Accionado 2026-06-28 (cont.) — Render de Propinas estabilizado (PLATA)
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

### 🧪 Testing
- **✅ RESUELTO (2026-06-26) — entorno DOM en vitest.** Se agregó `happy-dom` + React Testing Library + `vitest.setup.ts`
  (mergeado a staging `69d7749`). Default `node` a propósito; los tests DOM piden `// @vitest-environment happy-dom`.
  El smoke `src/App.smoke.test.tsx` **renderiza el árbol con router y falla si reaparece el loop `/`↔`/login`** (el bug que
  antes era invisible). Gates verdes: build prod EXIT 0 + vitest 19 files/141 tests.

### 🔐 Seguridad (audit de la sesión — triado)
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

### 🔧 Deep-dive auth / recuperación (parqueado — varios solapan con el PILAR de escalabilidad de auth del PoS)
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

### 🎓 Lección de la sesión
**Arreglar la capa donde está el síntoma, no la de al lado.** El RCA de realtime (máquina de 3 estados) era correcto pero
**incompleto**: el BOOTSTRAP de `useAuth` era el gemelo sin topear y **nadie lo había topeado** → causaba la pantalla negra
una semana después. El síntoma ("no carga / negro") apuntaba al arranque, no a realtime.
