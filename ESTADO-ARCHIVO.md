# Satori App — Estado del proyecto

> Restaurant POS analytics dashboard · Satori Sushi Bar, Santa Teresa & Nosara, Costa Rica
> Última actualización: 2026-06-28 (handoff CI/infra: GitHub Actions del deploy a Node 24 `@v5` en main `52d1475` + staging `3b821f0`, `deploy.yml` byte-idéntico; `supabase/.temp/` untrackeado también en main → clon fresco no arranca en prod).

## 🆕 2026-06-28 (cont.) — GitHub Actions del deploy a Node 24 (`@v5`) en main+staging + `supabase/.temp/` untrackeado en main
> Histórico archivado del header de `ESTADO.md`. Sesión de **CI/infraestructura — sin código de app, sin esquema, sin datos.** `main` = `52d1475` · `staging` = `3b821f0`.

1. **GitHub Actions del `deploy.yml` → Node 24 (`@v5`), en MAIN y STAGING.** Las 4 acciones (`checkout@v5`, `setup-node@v5`, `upload-pages-artifact@v5`, `deploy-pages@v5`) subidas de Node 20 a Node 24 (GitHub lo forzaba desde 2-jun-2026, retira Node 20 el 16-sep). **MAIN `52d1475`** (FF; deploy de GitHub Pages verde, build 29s + deploy 10s, **warning de Node 20 desaparecido / 0 anotaciones**). **STAGING `3b821f0`** (FF; el workflow **no** corre en staging — solo cierra el drift). `deploy.yml` quedó **byte-idéntico entre main y staging**. **NO se tocó `node-version: 20` del build** (Node del build de prod, cambio aparte → Node 22). **Proceso:** la rama de prep del bump a main se había creado del main viejo (`a0d9f0d`); cuando main avanzó con el bump (`1788520`) hubo que **rebasar la rama del untrack sobre `origin/main` antes del FF** — si no, el diff mostraba reversión espuria de `deploy.yml` y `--ff-only` fallaba (force-with-lease al remoto de la rama, **nunca** a main).
2. **`supabase/.temp/` untrackeado + ignorado también en MAIN** (`52d1475`, FF; recreado a mano, **no** cherry-pick, porque el `.gitignore` de main no tenía la línea `.claude/` de staging). Antes vivía solo en staging → en main `linked-project.json` seguía trackeado apuntando a PROD (`yiczgdtirrkdvohdquzf`). Ahora un clon fresco de main **no** arranca enlazado a prod; los archivos quedan en disco (solo se untrackean). Build `VITE_APP_ENV=production npm run build` → EXIT 0.
3. **Ramas de prep integradas y borradas.** `chore/gitignore-supabase-temp-a-main` (→ main) y `chore/bump-actions-node24` (→ staging) mergeadas por FF y borradas del remoto (verificadas como contenidas antes de borrar). **Nota CI:** el check **"Supabase Preview"** del GitHub App sale rojo de forma **crónica y pre-existente** (idéntico en `a0d9f0d`/`1788520`/`52d1475`), ajeno a este cambio; `build`+`deploy` (Pages) y `Cloudflare Pages` dan verde.

## 🆕 2026-06-28 — IDOR de `extract-document` CERRADO EN PROD + main alineado + footgun del link tapado en staging
> Histórico archivado del header de `ESTADO.md`. Sesión de **infraestructura/seguridad — sin código de app, sin esquema, sin datos.** `staging` = `bb93335` · `main` = `a0d9f0d`.

1. **IDOR de la Edge Function `extract-document` → CERRADO EN PROD.** El fix (`c38a252`, "exigir JWT + RLS en el download") estaba **solo en staging**; en main vivía la versión vieja (descarga con `service_role`, ignora RLS) que estaba **desplegada en el Supabase de prod** → el IDOR estaba **vivo en producción**. Se **desplegó la versión segura al Supabase de prod** (`supabase functions deploy extract-document --project-ref yiczgdtirrkdvohdquzf` — **NO va por git**; la función vive en Supabase). **Smoke negativo:** `POST` sin `Authorization` → **`401`** (gateway, `UNAUTHORIZED_NO_AUTH_HEADER`). ✅ **Validación física:** la dueña leyó una factura real en prod con rol de caja → OK (RLS deja pasar a owner/manager/contador/cajero, mig 016). **Pendiente OPCIONAL no bloqueante:** prueba cross-user (rol fuera de caja → debe dar `403` "Sin acceso al documento"); no se hizo. El cierre está fundamentado en código + RLS + lectura OK.
2. **`main` alineado con prod** (`a0d9f0d`, FF `79d8004`→`a0d9f0d`): un solo archivo, `supabase/functions/extract-document/index.ts`, traído de staging y **byte-idéntico** a prod (blob `65d1c3d`). El push a main disparó el deploy de **GitHub Pages → success** (sitio idéntico: la Edge Function no entra al bundle del frontend; warning no bloqueante de Node 20 deprecado en las actions). Pase quirúrgico de 1 archivo, **no** un merge `staging`→`main`.
3. **Footgun del link de Supabase → tapado en STAGING** (`bb93335`, rama `chore/gitignore-supabase-temp`): `supabase/.temp/linked-project.json` estaba **trackeado apuntando a PROD** y `.temp/` no estaba ignorado → cualquier clon fresco arrancaba enlazado a prod. `git rm --cached supabase/.temp/` (sin borrar de disco) + línea `supabase/.temp/` en `.gitignore`. Mergeado a staging por FF. **Solo en STAGING, NO en main** (pendiente de portar).

## 🆕 2026-06-27 — Limpieza de código muerto + borrar-día/descartar-turno por la cascada + foto de factura normalizada (todo en staging `eefa056`)
> Histórico archivado de `ESTADO.md` §(b27). Detalle de hallazgos en `HALLAZGOS.md` (✅ Accionado 2026-06-27); lo NO tocado en `INFORME-LIMPIEZA.md`.

1. **Limpieza de código muerto no-money — MERGEADA a staging** (`9b1127c`→`abb2a25`, FF): se borró `src/shared/api/auth.ts` (huérfano; el auth real es `useAuth.tsx`), exports sin uso (`crm.ts:findCustomerByPhone`, `ventasUtils.ts:fmtPct/monthKey/metaDot` + import muerto `fi as _fi`) y 3 assets del scaffold (`src/assets/{hero,react,vite}`). Lo money-adjacent/sagrado/dudoso quedó documentado pero NO tocado en `INFORME-LIMPIEZA.md`. Build + tests verdes.
2. **Borrar-día y descartar-turno por la CASCADA — MERGEADO a staging** (`b8ab78c`, front-only, sin migración): `discardDiaCompleto`/`discardCashSession` (`src/shared/api/cash.ts`) borraban `cash_movements` con `.delete()` crudo → salteaban `delete_movement_cascade` (mig 039/044) → `accounting_entries` huérfanos + `inventory_review_task` colgadas. Ahora borran **cada** movimiento por el RPC (credenciales de gerencia de mig 044), orden movimientos→cierre→sesiones; error parcial recuperable. Test `cash.discardDia.test.ts`. **✅ Validada físicamente** (pruebas A y B: la tarea de Inventario→Revisión desaparece). *Opcional no bloqueante:* verificación SQL directa de 0 `accounting_entries` huérfanos.
3. **Bandeja: foto de factura normalizada en el navegador — MERGEADO a staging** (`eefa056`, FF desde `fix/bandeja-normalizar-imagen`, front-only sin migración): la captura del teléfono daba "sin leer" (HEIC/peso/orientación EXIF → Anthropic vacío). Nuevo helper `src/shared/utils/imageNormalize.ts` (`normalizeInvoiceImage`: decodifica con `createImageBitmap` respetando EXIF + convierte HEIC en iOS Safari, reescala el lado largo a ≤1568px, re-exporta JPEG 0.82; fallback al original) usado al inicio de `InboxModule.processFile`. Storage queda `.jpg`+`image/jpeg`. **✅ Validada físicamente** (captura directa con el teléfono). Follow-up opcional: endurecer `mediaType()` de la Edge Function (defensa en profundidad).

## 🆕 2026-06-26 — Esquema unificación 040–043 (firmado + aplicado a staging) + OPCIÓN A + tests DOM + IDOR cerrado en staging + cascada mig 039
> Histórico archivado de `ESTADO.md` §(b). Detalle vivo en `PROMPT-CONTINUACION.md` (§★ PRÓXIMO, §0-quater) y `ROADMAP.md` §1ter; SPEC firmado en `docs/SPEC-unificacion-bandeja-caja.md`.

1. **Migraciones 040–043 (unificación Bandeja↔Caja) FIRMADAS y APLICADAS a la base de staging** vía `supabase db query` (NO `db push` → **no quedaron en `schema_migrations`**). Esquema verificado 10/10. Archivos **MERGEADOS a staging** (`63ca7ce`). 040 `inventory_review_task` · 041 columnas de clasificación en `cash_movements` · 042 `accounting_entries` (append-only) + `post_accounting_entry` + trigger `unif_on_cash_movement` · 043 `delete_movement_cascade` extendida + `complete/discard_inventory_review`.
2. **Decisión OPCIÓN A (firmada):** `accounting_entries` es libro de **auditoría/reversión únicamente; NO alimenta el P&L** (evita doble-conteo). El P&L se sigue derivando en vivo de `getLiveActuals`. Propagación automática = visión futura (SPEC §19).
3. **Entorno de tests DOM** (happy-dom + RTL + smoke anti-loop `/`↔`/login`) mergeado a staging (`69d7749`).
4. **IDOR de `extract-document` CERRADO en staging** (`c38a252`): exige JWT, baja bajo RLS sin `service_role`, CORS por allowlist. Validado los 2 lados. (Pasó a PROD el 2026-06-28, ver arriba.)
5. **Borrado de caja → cascada de inventario (mig 039)** (`82d55cd`) — `delete_movement_cascade` cierra el inventario huérfano del `ON DELETE SET NULL` de mig 017. Validado e2e por la dueña. Aplicada por dashboard → fuera de `schema_migrations`.
6. **⚠️ Aprendizaje crítico:** el CLI de Supabase estaba **enlazado a PROD**; lo cazó el guardrail → **RITUAL obligatorio** del link antes de cualquier comando de DB (ver `HALLAZGOS.md`).

## 🆕 2026-06-24 — REALTIME tras suspensión profunda: SAGA CERRADA ✅ (resuelta y validada en staging `3a0fd20`)
> Histórico archivado de `ESTADO.md` §(b). El estado vivo y compacto quedó en `ESTADO.md`; el RCA completo
> (diagnóstico + cronología + resolución) en `docs/rca/2026-06-22-realtime-suspension.md`. **100% client-side.**

**El problema (dos capas).** (1) Desync token HTTP↔socket: tras ~25 min suspendido el socket Realtime queda con
**JWT vencido** pero `isConnected()=true` y heartbeat ok → el SDK lo cree vivo y el join falla con
`InvalidJWTToken`. (2) Más grave: la conexión TCP queda **zombi** y las auth-ops (`getSession`/`refreshSession`)
que la recuperación usaba **se colgaban y nunca settleaban** → `ensureRealtimeHealthy` quedaba clavado
(`healthInFlight` rehén) → app muerta hasta recargar.

**Cómo se cerró, en orden:**
1. **Blindaje anti-clavado** (jun-23): `withTimeout` 8s por auth-op + cinturón por edad `HEALTH_MAX_AGE_MS=40s` +
   single-flight con liberación en `finally`. Resolvió el **deadlock permanente** (la app ya no quedaba muerta).
   PERO el approach de entonces **emitía `rt:healthy` en el TIMEOUT del refresh** → el hook re-suscribía con el
   token **VENCIDO** → `InvalidJWTToken` → **loop infinito de CHANNEL_ERROR** (visto en una suspensión de 3–5 h).
   Ese emit-on-timeout (+ revive-on-timeout) fue un approach **intermedio que dejaba un loop** → **reemplazado**.
2. **Máquina de 3 estados** (`63ef0bb`): se rediseñó `ensureRealtimeHealthy` para clasificar el resultado de las
   auth-ops en EXACTAMENTE uno de `ONLINE_SUBSCRIBED` / `OFFLINE_WAITING` / `SESSION_EXPIRED`. **Regla madre:
   nunca emitir `rt:healthy` ni re-suscribir sin token fresco CONFIRMADO; ningún camino termina en loop.** Mató
   el loop `InvalidJWT`: `OFFLINE_WAITING` no emite, renueva el TCP y reintenta con backoff (3s→30s, un único
   timer cancelable); solo `ONLINE_SUBSCRIBED` (token fresco) emite. `useRealtimeRefetch` quedó byte-idéntico
   (su contrato `rt:healthy`→re-suscribe no cambió).
3. **Gateo del emit + endurecimiento de SESSION_EXPIRED** (`3a0fd20`): (FIX 1) flag `healthyAwaited` — la emisión
   de `rt:healthy` corre SOLO si hay recuperación pendiente (`channel-stuck` previo u `OFFLINE_WAITING`); arregló
   la **regresión de arranque** (el emit incondicional re-suscribía el canal inicial → CLOSED ×5 → FRENO → tiempo
   real muerto al abrir). (FIX 2) `getSession→null` ya **no** es deslogueo directo (en el arranque puede dar null
   un tick antes de hidratar desde storage); el árbitro ÚNICO de `SESSION_EXPIRED` es `refresh.error`.

**Validación física (staging desplegado, `window.__satoriDiag`):** `armZombie` → `OFFLINE_WAITING` + backoff, sin
loop ni `InvalidJWT`; `disarm` → `ONLINE_SUBSCRIBED` emite y recupera a `SUBSCRIBED`; ARRANQUE sin cascada CLOSED;
foco rutinario → `setAuth` SIN emit (sin churn). Asesor: build/lint(81 baseline)/test 122/122 verdes.

**Saga de ramas (todas mergeadas a staging):** `fix/realtime-jwt-refresh` (R1, en prod vía canario) ·
`fix/realtime-socket-revive` (R2, **REVERTIDO**) · `fix/auth-lock-contention` (en prod vía canario) ·
`fix/realtime-resume-refresh` · `fix/realtime-worker-heartbeat` (`worker:true`) · `fix/realtime-resume-diagnostics`
(`[rt-diag]` + R1 freno) · `fix/realtime-reauth-emit` + `fix/realtime-reauth-timeout` + `fix/realtime-resume-revive`
(blindaje, **approach intermedio reemplazado**) · **`fix/realtime-3state-machine` (`63ef0bb`)** ·
**`fix/realtime-emit-gating` (`3a0fd20`)**. Switch de reproducción solo-staging: `fix/realtime-resume-diagnostics`
(`window.__satoriDiag`, logs `[diag-repro]`). **Logs `[rt-diag]`/`[diag-repro]` siguen ACTIVOS** hasta el pase
quirúrgico a main.

## 🆕 2026-06-12 (noche) — FIX 🔴 DOBLE COBRO — EN STAGING (rama `fix-doble-cobro`)
Resuelto el hallazgo crítico de la auditoría. **La matemática del cobro NO se tocó** (computeTotals,
vuelto, conversión, splits intactos y testeados); solo cambió **cómo se persiste** el pago. 93/93
tests + script de idempotencia 10/10 + smoke E2E verdes. **NO en prod** (gateado).
- **Diagnóstico**: `cobrarOrden`/`cobrarCheck` hacían INSERT pago + UPDATE cierre como statements
  separados (no atómicos); `pos_payments` sin candado → dos cajas podían dejar 2 filas de pago.
  Modelo: 1 pago por check / 1 por orden entera; split PAYMENT (varias tarjetas/cuenta) NO existe hoy
  (es backlog) — por eso el candado es por INTENTO (client_op_id), no "máx 1 fila por check".
- **Mecanismo (doble capa)**: (1) `pos_payments.client_op_id` + **UNIQUE parcial** → un reenvío del
  MISMO intento (doble-tap / dos dispositivos con el mismo cobro) colapsa en una fila; (2) **RPC
  SECURITY DEFINER atómica** `pos_cobrar_orden` / `pos_cobrar_check` (mig 033) con `FOR UPDATE` +
  precondición → dos cajas DISTINTAS sobre la misma mesa: una gana, la otra recibe **"Esta cuenta ya
  fue cobrada"**. La RPC **no recalcula montos**: recibe los totales ya calculados y solo persiste.
- **Cliente**: el checkout genera el `client_op_id` UNA vez al abrir la pantalla (no por tap) y lo
  manda; `cobrarOrden`/`cobrarCheck` ahora invocan la RPC. El camino feliz se comporta idéntico a hoy.
- **Tests de concurrencia** (`scripts/test-cobro-idempotente.py`, reproducible): cobro normal → 1
  fila + mesa cerrada ✓ · doble-tap (mismo cop) → idempotente, sigue 1 fila ✓ · otra caja sobre
  cuenta cobrada → ERROR claro sin fila nueva ✓ · split 2 checks → 2 pagos legítimos, mesa cierra al
  último ✓ · doble-tap de un check → idempotente ✓ · otra caja sobre check pagado → ERROR ✓.
- **Migración 033** aplicada y registrada SOLO en staging.

### Plan de prueba física para la dueña (doble cobro)
1. Cobrá una mesa normal → funciona igual que siempre (ticket, mesa cerrada).
2. Pedile a otra persona que intente cobrar la MISMA mesa desde otra tablet (o reintentá vos tras
   cerrarla) → debe aparecer **"Esta cuenta ya fue cobrada"**, sin duplicar el pago.
3. En una mesa dividida, cobrá cada cuenta por separado → cada una se cobra una sola vez; la mesa
   recién cierra al pagar la última.

## 🆕 2026-06-12 (noche) — AUDITORÍA + CONSOLIDACIÓN — EN STAGING (rama `consolidacion`)
Auditoría de staff engineer (`AUDITORIA-CONSOLIDACION.md`) + limpieza segura. **Comportamiento
preservado**: 93/93 tests, tsc y build verdes; sagrados intocados. El `AUDITORIA.md` raíz es una
auditoría ANTERIOR (5 jun, otra rama) — se conservó intacta; la de este sprint va en archivo aparte.
- **Ejecutado (seguro, verificado)**: extracción de 8 piezas hoja del comandero a
  `comanderoShared.tsx` (toBillItem, COURSE_LABEL, KS_LABEL, CierreTurnoModal, PaxModal, Tile,
  QtyPopup, Row) → **ComanderoModule 1406→1281 líneas**, mover + importar, sin cambio de conducta.
- **Hallazgos clave para DECISIÓN HUMANA (no se tocaron)**:
  - 🔴 **Cobro concurrente de la misma mesa desde 2 cajas** → el `UPDATE` de cierre es idempotente
    pero el `INSERT` en `pos_payments` no, puede duplicar la fila de pago. Fix = precondición/UNIQUE
    server-side o RPC transaccional (cambia esquema → requiere acuerdo).
  - 🔴 `react-hooks/rules-of-hooks` en `MiRendimiento.tsx` (módulo viejo de ventas): `useMemo`
    condicionales — bug latente, sprint propio con validación física.
  - 🟡 Atomicidad de merge/reopen (envolver en RPC plpgsql) + pausar el refetch de Realtime mientras
    hay un modal abierto (patrón `pauseWhileTyping` de Propinas).
  - 🟡 Seguir extrayendo los modales autónomos del comandero (CheckoutModal/SplitModal/ItemPicker/…)
    → ~500 líneas; mecánico y verificable por tsc, queda listo para el próximo paso.
- **Confirmado sano**: outbox offline (lock multi-pestaña + idempotencia + orden estricto), RLS de
  todas las tablas nuevas, 0 `any`, lazy-load ya implementado, migraciones 022-032 registradas.

## 🆕 2026-06-12 (noche) — JERARQUÍA DE MENÚ (3 niveles) + CANTIDAD EN TODO PRODUCTO — EN STAGING (rama `menu-jerarquia`)
93/93 tests, builds OK, smoke E2E verde (navegación 3 niveles + ×2 verificados + DB). Sagrados intactos.
- **Migración 032 — modelo de familia EDITABLE** (no hardcodeado): `menu_families` (4: 🍱Comida /
  🍹Bebida / 🛍️Merch / 🏠Interno, con orden e ícono) + `menu_categories` (categoría→familia,
  subfamilia, oculto, orden). Mapeo exacto del sprint sembrado; **A PAX oculto** del comandero;
  **bebidas → estación barra** (328 productos; el XLS no traía estación). La dueña reasigna familias
  desde el Gestor (RLS gerencia).
- **T2 — Navegación de 3 niveles en el comandero**: FAMILIA → categoría → productos, con
  **breadcrumb/volver** siempre visible y **búsqueda transversal** arriba (a toda la carta).
  Respeta tiles con precio, color por estación, foto y el selector de asiento/curso activo. Solo
  activos con precio se comandan; A PAX no aparece.
- **T3 — Cantidad para TODOS los productos** (bug de la dueña): tocar un producto **sin
  modificadores** abre un **mini-popup de cantidad** (default 1, un tap en "Agregar" confirma —
  el caso común sigue siendo rápido; ± para pedir varios en un gesto, no N toques). Unificado con
  la cantidad del ItemPicker (productos con obligatorios) → **un solo comportamiento**. Ítems
  idénticos se agrupan con su cantidad; con modificadores distintos siguen separados.
- **T4 — Árbol de familia en el Gestor**: la lista de Productos se agrupa por FAMILIA → categoría →
  productos, con los filtros activos/inactivos/todos dentro del árbol; **la familia de cada
  categoría se reasigna inline** (selector → guarda al instante), sin tocar código.
- **Decisiones**: familia y estación son **dato editable** (la dueña reacomoda desde el Gestor);
  categorías sin familia mapeada caen en "Otros" al final (no se pierden); el mini-popup de cantidad
  agrega 1 tap al caso común a cambio de que pedir 3 sea un gesto (decisión avalada por el prompt).

### Plan de prueba física para la dueña (jerarquía + cantidad, en staging)
1. **Navegar**: Comandero → abrí una mesa → vas a ver **4 familias** (Comida/Bebida/Merch/Interno).
   Tocá **Comida → Sushi Rolls** y elegí un roll; usá **← Familias** / el breadcrumb para volver.
2. **Cantidad**: tocá un producto simple (ej. una cerveza) → aparece el **±**; dejá 1 y "Agregar"
   (rápido), o subí a 3 y agregá → entra como una sola línea con la cantidad.
3. **Buscar**: escribí arriba (ej. "mojito") → busca en toda la carta sin importar la familia.
4. **A PAX**: confirmá que NO aparece en el comandero (el pax se pide al abrir la mesa).
5. **Familias en el Gestor**: Admin → 🍣 PoS → Productos → la lista está agrupada por familia; si
   algo quedó en la familia equivocada, cambiala con el selector de cada categoría.
6. **Bebidas al bar**: marchá una bebida y verificá que cae en el KDS de **barra** (no cocina).

## 🆕 2026-06-12 (noche) — CARTA REAL IMPORTADA + ASIENTO/CURSO PARA TODOS — EN STAGING (rama `carta-real`)
90/90 tests, builds OK, smoke E2E verde. Sagrados intactos. La carta va SOLO a staging.
- **T1 — Carta real importada** (542 productos, `import/productos.csv` → script idempotente
  `scripts/import-carta.py` vía Management API): **520 actualizados** (precio final IVA incl. — sin
  re-multiplicar — + costo + categoría/subcategoría, conservando is_active) · **22 nuevos INACTIVOS**
  para revisión en el Gestor · **57 sin precio** (cortesías/dueños/personal, precio null) · IVA 13%
  a todos · servicio 10% según flag (**142 merch/giftcards = false**; canal igual manda, delivery
  nunca). Re-correr no duplica (verificado: 717/542 estables). **Spot-checks OK**: Coca ₡1.900,
  Pilsen ₡2.800, Mojito ₡5.800, Merlot ₡4.000. Conteo por categoría: BEBIDAS 235, TSHIRTS 121,
  SUSHI ROLLS 42, PERSONAL 24, TAPAS ASIATICAS 23, GREENSEASON 22, XX DUEÑOS 18, POKES 10, X
  CORTESIAS 8, T-GORRAS 8, REMERAS 7, KIDS 6, POSTRES 5, A PAX 4, GIFT CARDS 3, T-STICKERS 2, otros.
- **T2 — Asiento/curso/nota para TODOS los productos** (bug de la dueña: antes solo los productos
  CON modificadores dejaban elegir asiento/curso, porque el selector vivía dentro del flujo de
  modificadores): (1) **selector de asiento/curso ACTIVO global** (patrón Lavu) sobre el menú — el
  quick-add del grid lo respeta, así CUALQUIER producto cae en el asiento/curso elegidos sin abrir
  nada; (2) **tocar el nombre del ítem** en la comanda abre el popup de detalles (asiento/curso/nota)
  para cualquier pendiente, con o sin modificadores; (3) **nota por ítem** (mig 031) visible en la
  comanda y el **KDS** (📝). Verificado E2E + DB: COCA COLA (sin mods) → asiento 2 + principal + nota
  → marchado al KDS con todo.
- **Nota de datos**: el import no trae `station` (no estaba en el CSV) → los productos nuevos quedan
  con station por defecto 'cocina'; la dueña la ajusta en el Gestor (Productos → estación) para el
  ruteo correcto del KDS (bebidas→barra). No es regresión.

### Plan de prueba física para la dueña (carta + asiento/curso, en staging)
1. **Carta**: Admin → 🍣 PoS → Productos → vas a ver toda la carta con precios. Los **22 nuevos** salen
   como *desactivados* (revisá y activá los que correspondan); los de **cortesías/dueños** quedan sin
   precio a propósito. Ajustá la **estación** (cocina/barra) de los productos para que el KDS rutee bien.
2. **Asiento/curso para todo**: en el Comandero, arriba del menú, fijá **Asiento** (1/2/3…) y **Curso**
   (auto/bebida/entrada/principal). Tocá un producto **sin modificadores** (ej. una gaseosa) → entra
   en ese asiento y curso. Tocá el **nombre del ítem** en la comanda para cambiarle asiento/curso o
   ponerle una **nota** (ej. "sin hielo"). Marchá y verificá que la nota aparece en el KDS.

## 🆕 2026-06-12 (noche) — FOTO DE PRODUCTO + REABRIR ORDEN — EN STAGING (rama `pos-fotos`)
90/90 tests, builds OK, smoke E2E verde (verificado en DB). **Sagrados intactos.**
- **Migración 030** (staging): `product_map.photo_url` + bucket **público** `productos` con RLS
  (admin sube / todos leen), creado vía API. **NO en prod.**
- **T1 Foto de producto (patrón Lavu)**: en Admin → Productos, subir/cambiar/quitar foto con
  preview (cámara directa en móvil + archivo en desktop), **comprimida a thumbnail 480px** antes de
  subir (las tablets no cargan imágenes pesadas). En el **comandero**, el tile del grid muestra la
  foto si existe; **fallback con gracia** al diseño actual (color por estación + nombre) si no hay —
  no rompe el "2-taps" ni el target táctil. `loading="lazy"` + `onError` (se oculta sola si falla).
  URL **pública cacheable** → sirve offline una vez vista. Verificado: tile AGUA con foto, 11 tiles
  sin foto con fallback intacto, quick-add funciona.
- **T2 Reabrir/recerrar orden (F20, cierra la paridad Lavu)**: ↺ Reabrir en el comandero → lista las
  mesas **cerradas de hoy** → **`requireManager`** (owner/manager directo; otros piden credenciales)
  + **motivo obligatorio** → reabre (status→open, limpia cierre y checks para re-cobro limpio). **Los
  pagos previos quedan como historial/auditoría — NO se revierten** (revertir/reembolsar = alcance
  futuro, ver PROMPT-CONTINUACION). Recierre manual cobrando de nuevo (no auto-cierra). Traza
  completa (quién/motivo/cuándo). Verificado en DB.
- **Paridad Lavu: completa** (incluye F20 + foto en tile). Solo queda la integración propina→pool
  (sagrado) y el pase a producción.

### Plan de prueba física para la dueña (fotos + reabrir, en staging)
1. **Foto**: Admin → 🍣 PoS → Productos → elegí un producto → 📷 Agregar foto (en el cel abre la
   cámara) → mirá el preview. Después, en el **Comandero**, abrí una mesa y mirá el grid del menú:
   ese producto sale con su foto; los demás siguen con su color y nombre.
2. **Reabrir**: cobrá una mesa (se cierra). Tocá **↺ Reabrir** arriba → escribí el motivo → elegí la
   mesa → (si no sos gerente, pide credenciales) → la mesa vuelve a abrirse para corregir/recobrar.

## 🆕 2026-06-12 (noche) — F3 PARIDAD FINAL (combinar + anular + ronda + cantidad) — EN STAGING (rama `f3-paridad`)
Cierra el estándar de mesa: el comandero de Satori cubre las 21 funciones del flujo Lavu (semáforo
de `SPEC-LAVU-FLUJO-MESA.md` casi todo ✅). 90/90 tests, builds OK, smoke E2E verde en las 4 tareas
(verificado en DB; Mesa 8 demo combinada y restaurada intacta).
- **Migración 029** (staging): combinar (`pos_orders.merged_into/merge_trace`, status `merged`,
  `pos_order_items.merged_from_order`) · anular (`kitchen_status='anulado'` + `void_reason/voided_by/
  voided_at`) · check kind `merge`. **NO en prod.**
- **T1 Combinar mesas (F14)**: desde el menú maestro de la orden, ⧉ Combinar → mesa abierta → sus
  ítems pasan acá marcados "combinada" y quedan como **checks separados por mesa** (cobrables aparte,
  invariante Σ=total garantizado vía `splitByGroup`). ↩ Separar deshace mientras nada esté pago.
  Traza de quién combinó. Reusa transferencias y splits ya construidos.
- **T2 Anular ítem enviado (F10)**: ⊘ anular en ítems ya marchados → **`requireManager`** (owner/
  manager directo; otros piden credenciales) + **motivo obligatorio** (error de toma / cliente
  cambió / producto agotado / otro). Sale del KDS (deja de estar 'marchado') y **no cuenta en la
  cuenta**; traza completa (quién, motivo, cuándo). NO toca caja.
- **T3 Otra ronda (F11)**: 🔁 lista los ítems ya enviados (únicos por producto+modificadores+asiento)
  con ± → los reenvía como nuevos (pendientes) con sus modificadores. Pensado para la barra.
- **T4 Cantidad rápida (F12)**: ± en el picker (×N) → una sola fila con la cantidad; modificadores
  distintos siguen separados. El grid de 2-taps mantiene el alta rápida de a 1.
- **SAGRADOS intactos**: cashUtils, tipCalculations, computeTotals, cierres. La integración
  propina↔tipCalculations sigue **sin tocarse** (sprint propio). Invariante de splits/merge probado
  al colón (test nuevo de merge por origen).

### Plan de prueba física para la dueña (paridad, en staging)
1. **Cantidad**: comandá un ítem y subí la cantidad con ± (×2, ×3) → entra como una sola línea con la cantidad.
2. **Otra ronda** (barra): con ítems ya enviados, tocá 🔁 Otra ronda → elegí cuántos repetir → se reenvían a barra/cocina.
3. **Anular enviado**: en un ítem ya en cocina tocá ⊘ anular → (si no sos gerente, pide credenciales) → elegí el motivo → desaparece del KDS y de la cuenta.
4. **Combinar**: en una mesa, ⧉ Combinar → elegí otra mesa abierta → sus ítems se suman como una cuenta aparte; cobralas por separado o tocá ↩ Separar para deshacer (si no cobraste nada).

## 🆕 2026-06-12 (noche) — F3 SPLITS + PROPINA — EN STAGING (rama `f3-splits`)
Paridad con PoS profesional: **dividir cuenta en 3 modos** + **captura de propina** en el cobro.
89/89 tests, builds OK, smoke E2E verde (split por ítem → 2 checks → cobro check1 efectivo ₡ con
propina 10% → cobro check2 en $ → mesa cerró; verificado en DB: propina ₡425 capturada, cierre al
pagar todo). **SAGRADOS intactos**: `tipCalculations` NO se tocó (la propina se CAPTURA, no se
distribuye); `computeTotals` solo se reutiliza por grupo.
- **Migración 028** (staging): `pos_checks` (checks congelados con monto + snapshot de líneas) +
  `pos_payments.check_id` + `pos_payments.tip_crc/tip_currency`; RLS y realtime. **NO en prod.**
- **Modelo de datos elegido — "checks congelados"**: cada check guarda el MONTO que debe (ya con
  servicio+IVA prorrateados) y un snapshot de sus líneas. Evita tocar `pos_order_items` y resuelve
  el ítem compartido (se prorratea como monto). **Invariante garantizado en código y test:
  Σ checks = total de la mesa al colón** (el último check absorbe el redondeo).
- **Dividir (SPEC F15)**: 3 modos — **parejo** en N (numpad ±), **por asiento** (usa los asientos
  del comandero), **por ítem** (asignar cada ítem a una cuenta; sin asignar = compartido,
  prorrateado). **Des-dividir** vuelve a un solo check (solo si nada está pago). Cada check se cobra
  independiente con el flujo F3 (método, doble moneda, vuelto, ticket); **la mesa cierra cuando
  TODOS los checks están pagos**. Funciones puras `posSplit.ts` (splitEven/splitByGroup/splitByItem)
  con 10 tests incl. el invariante en los 3 modos.
- **Propina (SPEC F19, CAPTURA — no distribución)**: en el checkout, 10% / 15% / manual en la
  moneda del pago → se guarda en `pos_payments.tip_crc`; suma al efectivo a cobrar y sale en el
  ticket. La propina queda registrada por pago/cajero/salonero. **La integración con el sistema de
  propinas (`tipCalculations`) NO se implementó** (es sagrado) — ver "Cómo conecta" abajo y
  `PROMPT-CONTINUACION.md`.
- **Decisiones**: split limpio (no se redivide ni des-divide con un check ya pago); un pago por
  check; el cobro de un check que no cierra la mesa **vuelve a la Cuenta** para cobrar el resto
  (hallazgo del smoke).

### Cómo conecta la propina capturada con el flujo de propinas actual (diseño para después)
Hoy el pool de propinas vive en `tip_sessions`/`tip_entries` y se reparte con `tipCalculations`
(por puntos de rol: salonero/barman/barback/runner/cajero…). La propina capturada en el cobro queda
en `pos_payments.tip_crc` con `created_by` (cajero) y la orden tiene `current_salonero_id` (a quién
atribuir). **La integración futura** (sprint propio, con tests dedicados) debe: (1) sumar las
`tip_crc` del turno al pool del `tip_session` correspondiente SIN reimplementar el reparto —
solo alimentar el `pool_*`; (2) decidir si la propina de tarjeta/SINPE entra al mismo pool que la de
efectivo o se separa (decisión de la dueña); (3) conservar la atribución por salonero para reportes.
NADA de esto toca la matemática de `tipCalculations`: es solo un ingreso al pool.

### Plan de prueba física para la dueña (splits + propina, en staging)
1. **Comandero** → mesa con varios ítems → **🧾 Cuenta** → **🔀 Dividir**.
2. **Parejo**: elegí en cuántas (± ) → mirá que las cuentas sumen exacto el total → Dividir.
3. **Por asiento**: usa los asientos que pusiste al comandar (cada asiento, una cuenta).
4. **Por ítem**: tocá los números para mandar cada ítem a una cuenta; lo que dejes sin asignar se
   reparte entre todas. Verificá que la suma cuadre.
5. **Cobrar cada cuenta por separado** (💳 al lado de cada una): la mesa recién se cierra cuando
   pagás la última. **Des-dividir** vuelve atrás si todavía no cobraste ninguna.
6. **Propina**: en el cobro tocá 10% / 15% / Otro → mirá cómo suma a lo que el cliente paga y sale
   en el ticket. (La propina queda registrada; el reparto al equipo es el siguiente paso.)

## 🆕 2026-06-12 (noche) — F3 COBRO BASE + DOBLE MONEDA — EN STAGING (rama `f3-cobro`)
Cierra el lazo que faltaba del PoS: **cuenta → método → emisión → impresión → cierre** (orden real
de Nube de Fuego). SPEC en `SPEC-LAVU-FLUJO-MESA.md` (21 funciones Lavu vs Satori, backlog, pax
obligatorio firme). 79/79 tests, builds OK, smoke E2E verde (2 casos cobrados, verificados en DB).
- **Migración 027** (staging): `pos_payments` (método, monto, moneda, TC usado, recibido, vuelto,
  created_by) + `pos_orders.closed_by`; RLS y realtime. **NO aplicada en prod** (gateada).
- **Cobro** desde la Cuenta de mesa (🧾 → 💳 Cobrar): pantalla que **reusa `computeTotals`** (no
  recalcula nada), método efectivo/tarjeta/transferencia-SINPE, numpad de recibido con ⌫/C +
  atajos de billetes + "exacto", **vuelto en vivo**; al confirmar registra el pago, **cierra la
  mesa** y muestra el **ticket SIM** (texto en pantalla + log; impresora/factura fiscal = futuro,
  con el hueco hecho en `pos_payments`).
- **Doble moneda** (patrón Lavu): total en **₡ primario + $ secundario** con el TC de
  `exchange_rates` (la última registrada), **TC ajustable por orden** (se guarda en el pago, NO
  toca el TC del día). Efectivo en **$ con vuelto en ₡** (turista) — verificado en DB:
  $20 × TC470 = ₡9.400, total ₡4.245, vuelto ₡5.155 ✓.
- **Funciones puras nuevas, todas testeadas** (la plata): `posCobro.ts` (calcularVuelto,
  convertir CRC↔USD, vueltoPagoUsd) + `posTicket.ts` (renderTicketCobro). **SAGRADOS intactos**:
  cashUtils, tipCalculations, cierres y `computeTotals` (solo se reutiliza).
- **Decisiones**: el cobro cierra la mesa siempre (el gate `canCloseShift` es del cierre de TURNO,
  no del cobro individual); un pago por orden (splits/parciales = P1, la tabla ya los admite); TC
  override por-orden con traza; ticket SIM (impresora real y factura electrónica = futuro).

### Plan de prueba física para la dueña (cobro, en staging)
1. **Comandero** → mesa → comandá algunos ítems → tocá **🧾 Cuenta** → **💳 Cobrar**.
2. **Efectivo ₡**: tecleá lo que te dio el cliente (o tocá un billete / "exacto") → mirá el
   **vuelto**. Confirmá → sale el **ticket** y la mesa se cierra (desaparece del plano).
3. **Turista paga en $**: en el cobro tocá **$ Dólares**, tecleá los dólares → te muestra a cuánto
   equivale en ₡ y el **vuelto en colones**. Si el TC del día no es el que querés para esa cuenta,
   tocá **ajustar TC** y ponelo — queda guardado solo en ese pago.
4. **Tarjeta / Transferencia-SINPE**: elegí el método y confirmá (sin numpad de vuelto).
5. Revisá que el **total del ticket** coincida con la cuenta (consumo + servicio 10% + IVA).

## 🆕 2026-06-12 (noche, sprint largo) — COMANDERO PROFESIONAL — EN STAGING (rama `comandero-pro`)
Investigación de PoS comerciales + auditoría de callejones sin salida + implementación. SPEC en
`SPEC-COMANDERO-UX.md` (Lavu/Toast/TouchBistro/Square con fuentes, mapeo, 8 dead-ends con severidad,
backlog P0/P1/P2, decisiones D1-D4). Smoke E2E completo verde en staging, 63/63 tests, builds OK.
- **P0-a Numpad pax pro**: dígitos ≥56px, ⌫ (borra último), C (limpia), tope 99, valor grande,
  confirmación "✓ Confirmar N pax". Pax **editable post-apertura con traza** en `pos_orders.notes`
  (cero DDL). Verificado E2E: 1→2→⌫→C→5 y edición 5→3 con traza `pax 5→3 · usuario · hora`.
- **P0-b Menú visual en grid**: pestañas de categoría (subclasificación→tipo→Otros) + tiles grandes
  con nombre y **precio final**, borde de color por estación (teal cocina / dorado barra), solo
  productos activos con precio. **Tap directo agrega** (2 taps) si no hay modificadores obligatorios;
  si los hay, abre el picker (D1). Búsqueda por texto sigue arriba. Helper puro `comanderoMenu.ts` + 3 tests.
- **P1 callejones sin salida**: cancelar mesa vacía (C1) · **deshacer marchar** con ventana de 20s
  que solo revierte lo aún 'marchado' (C2, el KDS lo saca por realtime) · **editar ítem no marchado**
  (✎ → picker prefilled, reemplazo seguro: entra el nuevo y sale el viejo) (C3) · confirmación al
  descartar selección (C6). Todo con traza en notes.
- **P1-b táctil**: targets ≥44-48px en numpad/grid/marchar/×/✎, feedback `:active` (.cm-tap),
  **total de la mesa siempre visible** en el header mientras se comanda (C5, mismo `computeTotals`).
- **API** (`pos.ts`): `marchar` devuelve ids · `unmarchar` · `cancelEmptyOrder` · `appendOrderNote`.
  Cero DDL nuevo, sagrados intactos, `computeTotals` solo se reusa.
- **Pendiente (P2, presupuesto)**: cantidad rápida ×N, repetir ítem, favoritos/más-vendidos,
  void post-cocina con motivo (necesita F3/impresión). Anotado en `SPEC-COMANDERO-UX.md` §4 y en
  `PROMPT-CONTINUACION.md`.

### Plan de prueba física para la dueña (comandero pro, en staging)
1. **Comandero** → tocá una mesa libre. **Numpad nuevo**: marcá 1, 2, tocá ⌫ (queda 1), tocá C
   (se limpia), marcá tu número real, Confirmar. Probá pasar de 99 (no deja).
2. **Menú grid**: tocá una **categoría** (pestañas arriba) y un **producto** — si no tiene
   obligatorios entra de una; si los tiene, se abre el detalle. Mirá el **total arriba** subir.
3. **Corregir**: tocá `👥 N pax ✎` y cambiá el número. Tocá `✎` en un ítem para cambiar
   asiento/curso/modificadores. Tocá `×` para quitar un ítem que aún no mandaste.
4. **Marchar y arrepentirte**: tocá "Marchar TODO" → aparece **↩ DESHACER (20s)** → tocalo:
   el ítem vuelve a "por marchar" y desaparece del KDS.
5. **Mesa por error**: abrí una mesa sin cargar nada → botón **✕ Cancelar mesa** la borra del plano.
6. Confirmá que todo se siente **grande y con respuesta al tocar** en la tablet.

## 🆕 2026-06-12 (noche) — Hardening del update de la PWA (incidente prod) — EN STAGING
- **Bug real encontrado**: el `rm -f dist/404.html` del fix de deep links dejaba `404.html` en el
  manifest del SW de staging → instalación fallaba → SW `redundant` (PWA de staging muerta desde la
  mañana). Fix: `globIgnores: ['404.html']` (prod no lo precachea tampoco — es fallback server-side).
- **Watchdog de arranque** (index.html): si la app no marca boot OK en 15s y hay un SW controlando,
  se des-registra el SW + se vacía Cache Storage + recarga UNA vez (guard sessionStorage anti-loop).
  IndexedDB (outbox/caché de datos offline) intacto. Señal de boot: useAuth al resolver la sesión.
- **Anti-loop del auto-reload** por controllerchange (máx 1 recarga/60s) + **chequeo de updates
  cada 60 min** (tablets/TVs abiertas días enteros también actualizan).
- **Probado con harness local de 2 versiones + SW saboteado** (Playwright): SW de staging instala y
  controla ✓ · deploy nuevo se recupera solo ✓ · cliente con SW roto se auto-sana al llegar el
  deploy bueno ✓. Pase a main PREPARADO, gateado a validación en staging.

## 🆕 Novedades 2026-06-12 (tarde) — Operación por roles EN STAGING (rama `operacion-roles` → staging)
- **Foto de factura de proveedor — guardada y visible** (prioridad máxima de la dueña): bucket
  privado `facturas` (creado vía API, sin pasos manuales), fotos vinculadas al pago
  (`cash_movements.attachments`, mig 026), miniatura → tap = foto completa en Caja Diaria,
  historial y bandeja. Cámara directa en móvil (`capture`), múltiples fotos por pago. Sin red:
  el pago entra igual y avisa que la foto no subió (se reintenta editando el pago).
- **Aterrizaje por rol**: cajero → `/caja`, salonero → `/comandero`, **rol nuevo `proveedor`**
  (bandeja) → `/proveedor` (siempre; única pantalla, botón de foto gigante), manager/owner →
  Home. Una vez por sesión de pestaña; rutas fuera del rol bloqueadas también por URL.
- **Mi Turno (`/mi-turno`)**: ventas/ticket promedio/propinas PROPIAS del salonero + cierre con
  `canCloseShift`. RPC `my_turno_stats` SECURITY DEFINER — solo computa `auth.uid()` (verificado
  con JWT simulado en staging).
- **Admin → Usuarios** ya cubría rol + habilitar/deshabilitar; se agregó `proveedor` y el flujo
  de alta documentado en pantalla (registro con alias `satorisushibar+nombre@gmail.com` → owner
  asigna rol). Crear cuentas server-side requeriría Edge Function con service key — innecesario.
- **PWA**: shortcuts nuevos (Registrar proveedor / Comandero / Caja / Propinas).
- **Migración 026** aplicada y registrada SOLO en staging (rol+bucket+políticas+RPC+attachments).
- ROADMAP: spec del sprint + fase futura "reportes quincenales por correo" (Resend + Edge Function).

## Novedades 2026-06-12 (mañana) — PoS F1+F2+F3 completos EN STAGING · prod preparado para offline

### En STAGING esperando validación física de la dueña (rama `staging` = `8697226`+)
- **PoS completo de la noche** (tramos 1-3, verificado por el asesor: 54/54 tests, sagrados intactos):
  F1 (locales/catálogo con modificadores/editor de salón en Admin → 🍣 PoS) · F2 (comandero `/comandero`
  con pax ≥1 obligatorio, modificadores, cursos, marchar) · F3 (KDS `/kds` con timers y bump, precios
  con **modelo fiscal CR** — final IVA incluido, desglose derivado, servicio 10% por canal vía
  `computeTotals` único —, cuenta de mesa, transferencia de mesas + reglas de turno, `print-bridge/`
  en modo simulación). Migraciones **022/023/024** aplicadas SOLO en staging.
- **Offline-first** (caché + outbox idempotente) y **fix de transferencias visibles** también en staging.
- Login de prueba: `test-manager@staging.satori` / `staging-test-2026` (rol owner en staging).

### PROD: DDL listo, código gateado
- **Migración 021 + housekeeping 018-021 APLICADOS en prod** (autorización única, 3 ok=true).
- **A.3 (merge a `main` hasta `f06c6d3`** — offline + transferencias, NADA del PoS): ⏸ **EN PAUSA**
  hasta que la dueña confirme la prueba física de transferencias en staging.

### ⏳ PENDIENTE-CONTADORA (decisión fiscal, parámetro centralizado en `posFiscal.ts`)
- Base exacta del **servicio 10%** (¿sobre neto o sobre total con IVA?) y si el servicio lleva IVA.
  Default implementado: 10% sobre subtotal neto, desglose visible. CIIU/CABYS del menú (combos 4.4).
  Informe de proveedores de facturación electrónica: `~/Desktop/investigacion-fiscal-cr.md`.

### 🧹 Housekeeping de baja prioridad
- **Historial de migraciones de staging (009)**: `db push` choca con una discrepancia vieja del
  historial — las migraciones se aplican por Management API (patrón establecido); reconciliar el
  historial cuando haya un rato. No bloquea nada.
- Fábrica nocturna cerrada: job launchd eliminado, ramas mergeadas borradas (quedan `main`+`staging`).

## 🆕 Novedades 2026-06-11/12 — Sprint validado por la dueña y EN PRODUCCIÓN (`main`)

### En producción (todo validado físicamente por la dueña en staging antes del merge)
- **Auth Fase 2 (cirugía de sesión)**: `noLock` → `safeNavigatorLock` (lock real de `navigator.locks` con escape a los 10s — serializa pestañas sin poder colgarse jamás; detalle y prueba del RCA en `HANG-RCA.md`). **ManagerOverride server-side**: RPC `verify_manager` (mig 019, SECURITY DEFINER + pgcrypto, exige owner/manager ACTIVO, anon bloqueado) con timeout de 10s y errores visibles — se eliminó el cliente Supabase temporal del navegador.
- **Tiempo real multi-dispositivo** (mig 020 + `useRealtimeRefetch`): dos dispositivos con Caja/Propinas abiertas se ven sin recargar. Reconexión con backoff, refetch al volver el foco, `pauseWhileTyping` en Propinas (no pisa lo que se está tipeando), recarga silenciosa (sin spinner).
- **Correcciones de pago (decisión de la dueña)**: pagos a PROVEEDORES solo **Efectivo o Transferencia** (SINPE/Bitcoin fuera del modal; prefill viejo defaultea a Transferencia; históricos intactos). Gasto operativo con **categorías únicas**: Delivery (detalle en la nota) · Delivery dueños · Propinas (detalle en la nota) · Operativo · Salario · Otro. La nota deriva la contabilidad del Delivery (electrónico = pass-through sin P&L) y es visible en los listados. Verificado: los 97 deliveries históricos tienen `account_id` explícito → cero reclasificación.
- **UX**: subtotal de barra visible en el turno de Propinas; modal de pago con caja origen derivada (Efectivo→Caja Proveedores, Transferencia→Banco, ROADMAP 2D-A).
- **Tests** (`npm test`, vitest): `saldoCajaFuerte` (8 casos) y `calcTurno` (6 casos) — 14/14 verdes. Las fórmulas sagradas ahora tienen red.
- **Base dinámica PWA**: prod sigue en `/satori-app/` (GitHub Pages), staging sirve en `/` (Cloudflare Pages) — un solo código.

### Migraciones 018+019+020 APLICADAS EN PROD ✅ (2026-06-12)
Ejecutadas con autorización única de la dueña vía Management API (`MIGRACIONES-PROD-JUN11.sql`, archivo exacto del repo, guardia anti-staging probada). Verificación: 3 filas `ok=true`. El **check de mediodía (018) ya funciona en producción**.

> ⚠️ **Housekeeping pendiente (instrucción de la dueña):** las versiones **018/019/020 NO quedaron registradas** en `supabase_migrations.schema_migrations` de prod (se corrió solo el archivo consolidado). **El día que se use `supabase db push` contra prod, ANTES anotarlas**:
> `insert into supabase_migrations.schema_migrations(version) values ('018'),('019'),('020') on conflict do nothing;`
> Si se olvida, `db push` las re-intenta — son idempotentes, no rompe, pero ensucia el log.

### Staging = ESPEJO de datos reales + entorno operativo completo
- `scripts/clone-prod-to-staging.sh --yes` re-sincroniza todo con un comando (guardrails adentro; verificación 30/30 tablas + 3 spot-checks financieros al centavo). Login en staging = credenciales de prod. Usuarios de prueba: `test-cajero@staging.satori` / `test-manager@staging.satori` (pass `staging-test-2026`).
- En el camino se arregló el **drift de precisión numérica**: 40 columnas de staging redondeaban plata (`amount_crc` 12,0 vs 12,2) — corregidas en `staging-drift-sync.sql`.

### P1c y P1d — ✅ CERRADOS (2026-06-12, confirmación de la dueña)
La dueña confirmó que el **Historial de propinas** actual y el **tracking de datáfono por empleado** (Propinas→Stats, "Generó vs Recibió") son exactamente lo esperado — no se requiere ningún cambio. No reabrir sin pedido nuevo.

### Próxima gran meta técnica
**Offline-first** (base local + cola de sincronización + resolución de conflictos) — prerequisito del futuro módulo PoS. Se desarrolla y prueba en staging. Pendientes menores: P3c (estados vacíos — único ítem del backlog P3 sin iniciar; P3b errores visibles y P3d bundle ya están en main). ✅ Credenciales ROTADAS (2026-06-12): token de staging (el viejo devuelve 401) y contraseña de la DB de staging — checklist de seguridad del ciclo CERRADO.

## 🆕 Novedades 2026-06-10 — Sesión sólida (Fase 1) + entorno STAGING

### Sesión sólida — Fase 1 ✅ (en producción, `main`)
Fixes de bajo riesgo del "se queda pensando" (RCA en `HANG-RCA.md`):
- **Refresco proactivo del token** en `visibilitychange`/`focus` (`useAuth`): al volver a la app tras tenerla en background, `getSession()` refresca antes de que el usuario escriba → cura la causa principal del hang.
- **Timeout de 15s** (`withWriteTimeout` en `cash.ts`) en TODAS las escrituras críticas de caja: apertura, cierre, movimiento, ventas de cierre, retiro y "Borrar TODO el día" → si algo cuelga, falla visible con aviso, nunca se queda girando.
- **Fase 2 (cirugía de auth) DIFERIDA a staging**: reemplazar el `noLock` no-op por lock real y la verificación de manager por Edge Function se desarrollan y prueban en el entorno staging antes de tocar producción.

### Entorno STAGING ✅ (construido) — deploy Cloudflare Pages ⏳ pendiente del dueño
- **Proyecto Supabase staging separado**: ref `hwiatgicyyqyezqwldia`. **Producción (`yiczgdtirrkdvohdquzf`) nunca se tocó** — solo SELECTs de lectura para detectar drift.
- **Migraciones aplicadas en staging** + **baseline de drift `0095`**: 11 tablas que existían en prod fuera de migraciones (sops, cash_cierres_dia, ventas_*, product_map, recipes, ingredients, inventory_movements…) reconstruidas **solo estructura** — el archivo tiene **CERO sentencias de RLS/políticas** para que jamás pueda debilitar la RLS de prod. La RLS permisiva de staging vive en `staging-rls.sql` (raíz, FUERA de `migrations/`, solo para staging).
- **Banner rojo STAGING** (no-cerrable, `VITE_APP_ENV=staging`) + script `build:staging` + guía `STAGING.md`.
- **Rama `staging`** creada + **fix de base dinámico** (3 commits, solo en `staging`): `vite.config` computa `BASE` (`/` staging, `/satori-app/` prod) para base + manifest PWA completo (start_url/scope/iconos/shortcuts/share_target/workbox); Router `basename` y ErrorBoundary vía `import.meta.env.BASE_URL`; `sw-share.js` relativo al scope; `public/_redirects` (SPA fallback Cloudflare, GitHub Pages lo ignora). **Ambos builds verificados verdes**; prod sigue idéntico en `/satori-app/`.
- ⚠️ ~~**Deuda técnica**: baseline 0095 es aproximado~~ → **RESUELTO con `staging-drift-sync.sql`** (ver abajo).

### Drift prod→staging RECONCILIADO (2026-06-10, `staging-drift-sync.sql`)
- **Síntoma**: staging daba 500 en `profiles` (policies `owner_select/update_all_profiles` con `EXISTS (select from profiles)` = **recursión infinita de RLS**; prod las corrigió a mano usando `get_my_role()` SECURITY DEFINER) y 400 por **18 columnas faltantes** (`cash_sessions.status/shift_type/initial_*`, `cash_movements.caja_origen/method/subcategory/...`, `suppliers.metodo_pago/...`, `employees.pos_name`).
- **Diff completo prod vs staging** (columnas/policies/índices/constraints/funciones/triggers/enums): **223 diferencias** → parche idempotente `staging-drift-sync.sql` (raíz del repo) aplicado a staging: columnas, enums→text+CHECK (prod usa text), `currency_type`→`currency`, constraints/FKs/uniques, funciones (`update_ingredient_stock` faltaba), triggers renombrados a `trg_*`, y **espejo exacto de las 63 policies de prod** (74 de staging dropeadas, incluida la RLS permisiva `_all` de las 11 tablas drift → ya no hace falta `staging-rls.sql`).
- **Resultado: 223 → 8 diferencias, todas intencionales**: 7 índices de performance extra en staging (inocuos) + orden interno del enum `user_role` (valores idénticos, no se puede reordenar).
- **Verificado como usuario autenticado** (`set local role authenticated` + JWT claims): el perfil del owner carga sin 500, el owner ve todos los perfiles, y las queries con `status='open'`/`caja_origen`/`is_active` responden sin 400.
- Prod fue **solo lectura** en todo el proceso (information_schema/pg_catalog).

### ⚠️ Pendientes del DUEÑO (bloquean lo de arriba)
1. **Migración 018 en PROD** (Supabase → SQL Editor, `supabase/migrations/018_caja_dia_unico.sql`) — el check de mediodía no funciona hasta correrla.
2. ✅ ~~Rotar credenciales~~ (hecho 2026-06-12): token de staging y contraseña DB staging rotados.
3. **Cloudflare (consola)**: borrar el Worker `satori-app` auto-creado + su integración (la rama `cloudflare/workers-autoconfig` reaparece hasta hacerlo), y crear el proyecto **Pages**: repo `CachoSatori/satori-app`, rama de producción `staging`, build `npm run build:staging`, output `dist`, env vars `VITE_SUPABASE_URL=https://hwiatgicyyqyezqwldia.supabase.co`, `VITE_SUPABASE_ANON_KEY` (de staging), `VITE_APP_ENV=staging`. **Nunca poner el ref de prod ahí.**
4. Pasarme la URL `*.pages.dev` → verifico carga + banner + que el bundle apunte a staging.

## 🆕 Novedades 2026-06-09

> Todo lo de abajo está **en producción** (`main`). ⚠️ **Pendiente del dueño:** correr la **migración 018** (`supabase/migrations/018_caja_dia_unico.sql`) en Supabase → SQL Editor (columnas `midday_check_by/at`); el check de mediodía no funciona hasta correrla. Y **rotar el token de Supabase**.

### Caja — rediseño de flujo: Caja Diaria de proveedores ÚNICA por día
- **Una caja por día** (no más turnos Mediodía/Noche separados): se abre UNA vez a la mañana con el carryover del saldo inicial y corre todo el día (`shift_type='Día'`). Si ya hay sesión de esa fecha, no abre otra.
- **Check de proveedores (mediodía)**: botón de gerencia que registra el visto (quién + cuándo, mig. 018) sin cerrar la caja. Muestra "✓ Revisado dd/mm HH:MM".
- **Cierre de la Caja Diaria de proveedores**: paso propio EOD, obligatorio aunque esté en cero.
- **Cierre del día / bóveda**: gateado → solo se habilita si la Caja Diaria de proveedores de esa fecha está cerrada ("Cerrá primero la Caja Diaria de proveedores del día").
- Las **ventas** siguen igual (dos cargas POS Mediodía/Noche). Días viejos quedan como legacy (turnos separados).

### Caja — cierre por LEDGER + saldo de Caja Fuerte unificado
- **Cierre del día usa `saldoCajaFuerte`** (Paso 2): `Debería quedar = saldo Caja Fuerte (según sistema) + ventas − propinas − retiro`. Idempotente (excluye las ventas-de-cierre de la fecha, que se re-suman del formulario).
- **Una sola fórmula del saldo de Caja Fuerte** (bug de doble cálculo resuelto): la tarjeta de Movimientos, el cierre y el simulador usan el **mismo** `saldoCajaFuerte` → siempre el mismo número. Lógica canónica: solo `caja_origen='Caja Fuerte'`, traspasos por dirección, incluye el ajuste de saldo inicial. Label "Saldo Caja Fuerte (según sistema)".
- **Carryover en la apertura**: muestra "El cierre del {fecha} asignó a Caja Proveedores ₡X", lo precarga y **valida** (confirma si el cajero ingresa otro monto). TC fuera de la apertura (automático).

### Caja — cierre robusto (no perder ventas)
- El registro de ventas en el ledger (Fase 3) **ya no traga el error**: si falla, avisa explícito ("El día se guardó pero las VENTAS no se registraron: {error}") y no reporta cierre limpio.
- **Orden de fases obligatorio**: no se cierra la noche sin el Mediodía (Fase 1).
- **"Deshacer cierre"** avisa que no borra los movimientos del día; botón aparte **"🗑 Borrar TODO el día"** (doble confirmación + gerencia) para recargar de cero sin duplicar. No toca propinas.

### Caja — taxonomía + pass-through electrónico
- Tipos/categorías completas. **Pass-through**: propinas/delivery por **SINPE/Lafise/Bitcoin** = retiro de efectivo → reducen caja pero **no son P&L** (`account_id=null` / regla en `finance.ts`). Lafise = canal de cobro, no método. Delivery dueños = Egreso-Socios. Alta rápida de proveedor desde la caja; dropdown completo+scrollable; "Otro (especificar)".

### Propinas — por pagar en Caja (no se pierden)
- "Propinas por pagar" muestra la **fecha** y persiste **30 días** (no se pierde si se cierra caja sin pagarla; reaparece hasta pagar/dejar pendiente, sin duplicar).
- **Corte:** las propinas cerradas **hasta el 2026-06-05** se dan por pagadas (corte de visualización, sin tocar datos). Constante `PROPINAS_POR_PAGAR_DESDE`.

### Módulo "Prueba" (admin-only)
- Simulador de cierre de Caja Fuerte, **solo lectura** (datos reales, no guarda nada). Usa el mismo `saldoCajaFuerte` que el cierre real → validar ahí = validar el cierre.

## 🆕 Novedades 2026-06-08

### Caja — 4 mejoras (rama `feat/caja-datos-propinas-tipos`)
1. **Propinas pagadas cross-turno:** la detección de "propina ya registrada" mira **todos** los movimientos del día (no solo el turno actual) → evita doble pago entre turnos. (`allMovements` pasa a `CashTurno`.)
2. **Anti doble-click + confirmación** al pagar propinas (botones se deshabilitan + `confirm` con monto) → evita doble-registro de plata.
3. **`saldoCajaFuerte(movements)`** — helper puro (regla del canónico: +ingresos efectivo −egresos efectivo no-pendientes, traspasos/no-efectivo no afectan). **SCAFFOLD sin cablear**: se valida primero en el módulo Prueba antes de usarlo como número visible.
4. **Guard anti doble-submit** en `confirmPago`/`confirmIngreso`. Además: **CashPendientes ya maneja las propinas dejadas pendientes** (agrupa por `description` → aparecen como "Propinas turno…" y se pagan con el botón normal) — verificado, sin cambios.

### Validación (2026-06-08)
- ✅ `npm run build` (tsc -b + vite build) verde · `eslint` limpio en los archivos tocados (los errores que quedan son pre-existentes en `TipsModule`/`CashModule`, no introducidos acá).
- ✅ **Contrato con la base viva**: `supabase.gen.ts` está generado del esquema real → el build tipado confirma que las columnas/campos que usa Caja/Propinas existen (`cash_movements`, `tip_sessions`, `tip_entries`).
- ⏳ **Runtime con sesión (Caja/Propinas logueado) + escritura de prueba en el ledger = lo corre el dueño** (no tipeo contraseñas ni escribo datos de prueba en producción). Checklist de smoke-test en el reporte y abajo.


## 🧹 Auditoría de limpieza (`audit/cleanup-nocturna` — MERGEADA a `main` en `4fca841`)
Auditoría nocturna autónoma (Pase 1 + Pase 2), sin tocar la base (excepto generar tipos read-only). Aplicado seguro: −4 deps sin uso, exports muertos, dedup de `fi`/`ROLE_LABELS`(8→1)/helper day-level. **Titular A:** tipos Supabase regenerados del esquema vivo → `as never` **151→2**, luego **→0** (ver Novedades 06-05). **Titular B:** RCA del "se queda pensando" en `HANG-RCA.md` (refresh de token frágil) + fix seguro (storageKey propio del cliente de ManagerOverride) + diseño de fondo para aprobar. Caja/Propinas sin cambio de cálculo.
**Errata honesta (06-05):** el gate del Pase 2 estaba roto (`tsc --noEmit` sobre el tsconfig raíz = no-op); el HEAD tenía 20 errores reales (3 TS1011 + 17 de tipo) → corregidos con el gate real `npm run build`, reconciliada con `main` y **mergeada**. Detalle: `AUDITORIA.md`, `HANG-RCA.md`, `RESUMEN-MAÑANA.md`.

## 🆕 Novedades 2026-06-05

### Propinas — hotfixes EN PRODUCCIÓN (`main`)
- **Bug crítico al cerrar turno** (`tip_entries.session_id` viola NOT NULL): `savePayouts` hacía un `upsert` parcial y Postgres evalúa el NOT NULL sobre la tupla de INSERT **antes** de resolver el conflicto → reventaba el cierre aunque la fila ya existiera. Fix: **UPDATE por id** (las entradas ya existen con su `session_id`) + guardas (nunca persistir entradas sin turno con id).
- **Quitada la verificación/conteo de pool**: Propinas es **solo el cálculo de cuánta propina se generó y su reparto** entre empleados — no maneja ingreso/egreso de plata. Se removió "Monto contado" y la alerta de "Diferencia en el pool" que trababa el cierre con falsos positivos (el pool ya contabiliza efectivo + propinas individuales/datáfono). Flujo: ingresar montos → calcular → repartir → cerrar.

### Caja — fix `onMovAdded` (✅ en `main`)
- Al borrar/editar un pago a proveedor **ya persistido** se inyectaba un `PagoRow` fantasma en la lista de movimientos (se pasaba a `onMovAdded`, que agrega en memoria). Ahora **refresca desde la fuente de verdad** (`onRefresh`). `as never` en todo `src` → **0**.

### Caja — Bug A / Bug C / taxonomía (rama `feat/caja-datos-propinas-tipos`, pendiente de merge)
- **Bug A — no perder datos al recargar:** las listas del turno (pagos a proveedores, ingresos adicionales) se **derivan de la base** (`sessionMovements`) + borradores en memoria no persistidos → recargar nunca pierde ni duplica. Los **ingresos adicionales se persisten al instante** (antes sólo al cierre → se perdían). Dedup por `persistedId`.
- **Bug C — propinas por pagar:** cerrar Propinas **ya no crea el egreso solo**; en Caja aparece **"Propinas por pagar"** → el cajero **Paga ahora** (egreso `aprobado`) o **Deja pendiente** (`pendiente`, va a Pendientes; el efectivo sigue en caja hasta pagarse). `getTipPayoutsForDate` (nuevo) + `status` opcional en `createCashMovement`. Pass-through P&L = `null`. `reconcilePropinaEgreso` intacto.
- **Taxonomía de movimientos:** categorías completas + **pass-through electrónico** (propinas/delivery por SINPE/Lafise/Bitcoin = retiro de efectivo, **no P&L**). Lafise = canal de cobro, no método. Delivery dueños = Egreso-Socios. (`cashUtils`, `CONCEPTOS_EGRESO`, `finance.ts`.)
- ⚠️ *Conservador/documentado:* "propina ya registrada" se detecta contra los movimientos del **turno actual** (no de todo el día); `caja_origen 'Registradora'` por consistencia con el flujo previo; `ajuste` (faltante/sobrante) no se agregó como `movement_type` (requeriría enum nuevo en DB).

### Caja — cierre del día: la lógica correcta es el SALDO DE CAJA FUERTE por LEDGER
- El "debería quedar" debe partir del **saldo corrido de Caja Fuerte derivado del ledger** (canónico de `satori-caja`): `+ ingresos efectivo que entran a Caja Fuerte − egresos efectivo no pendientes ± ajustes`; traspasos internos y transferencias **no** afectan el saldo. Eso ya contempla el arrastre de noches anteriores y los pagos/ingresos del turno (ya están en el ledger): no hay que sumar nada a mano.
- ⚠️ El intento previo `fix/caja-cierre-cf` (sumar a mano el **remanente del cierre anterior**, un snapshot) queda **DESCARTADO** por riesgo de doble-conteo. El fix real usará un helper compartido `saldoCajaFuerte(movements)`.
- **Plan:** validar primero en el **módulo Prueba** (simulador read-only, con datos reales, sin guardar) y luego enchufar el mismo helper al cierre real.

### Módulo "Prueba" (admin-only) — EN DESARROLLO
- Entorno de **simulación de solo lectura** para validar lógica con datos reales **sin escribir** en la base. Contenedor reutilizable: hoy aloja el **simulador del cierre de Caja Fuerte** (helper `saldoCajaFuerte`); a futuro se reusa para lo que el desarrollo necesite probar.

### Limpieza de ramas
- `audit/cleanup-nocturna` (ya en `main`) y `fix/caja-cierre-cf` (obsoleta) **eliminadas** en origin. El fix de Caja + estas docs viven en `chore/limpiar-y-docs` (un solo branch para que el dueño mergee).

## 🆕 Novedades 2026-06-04

### Caja v2 (rediseño operativo)
- **Caja Diaria = solo proveedores** (se quitó "Registradora"; la maneja el PoS). Top cards y verificación del turno unificados en una sola caja física. Fondo inicial viene por carryover del cierre anterior.
- **Cierre del turno**: solo pide efectivo ₡/$ (se quitaron Caja Fuerte y Depósito banco).
- **Cierre del día**: efectivo real ₡ = ventas PoS ₡ − dólares al **TC configurable** (último de `exchange_rates`, editable, sellado en Fase 1). Único egreso = **propinas** + **retiro de dueños a banco**. Verificación de dólares. Bloqueado si hay un turno abierto. Genera movimientos de ventas en el ledger (Fase 3).
- `cash_movements.session_id` nullable → movimientos a nivel día (ventas del cierre, retiros, importación).

### Datos reales cargados (vía Management API)
- **Ledger real importado**: 1234 movimientos (ene–jun 2026) verificados contra Excel (₡54.884.640 / $70.614). Sesiones placeholder "Importado histórico" por fecha para que el Resumen mensual los agrupe.
- **Ajuste de apertura Caja Fuerte**: saldo real al 04/06 = **₡534.750 / $1.054** (egreso de ajuste por el histórico pre-2022 no capturado).
- **Proveedores**: 39 activos de la planilla (upsert sin duplicar) + 14 deudas pendientes reales (₡641.904). Pendientes anteriores saldados por transferencia.
- **Propinas mayo**: empleados duplicados fusionados (12 vacíos borrados); turnos faltantes pendientes de cargar (ver archivo `filas_faltantes_mayo`). MAXI reactivado (barman).

### Propinas
- **Estadísticas**: promedio de pool separado por turno (Prom. general / Prom. AM / Prom. PM) — los pools AM/PM son muy distintos y el promedio general distorsionaba.

### Caja → Pendientes (vista nueva)
- **Facturas agrupadas por proveedor** (fecha, turno, ₡/$, referencia/nota, total). Pagar **individual**, **seleccionar cuáles** (checkbox) o **marcar todos**. **Descargar comprobante PNG** (Canvas) de las seleccionadas o todas, para enviar al proveedor. A prueba de NaN.

### Bandeja de documentos — ingesta por foto con IA (Fase 2D-B v2) — OPERATIVA ✅
- Módulo **Bandeja** (`/inbox`, tile en Home con badge): subís/compartís foto de factura/comprobante → la IA de visión la lee.
- **Migración 016**: tabla `documents` + bucket Storage `documents` + RLS + `suppliers.aliases[]`.
- **Edge Function `extract-document`** (Deno → Anthropic visión, **Claude Haiku 4.5**, JSON estricto). **Desplegada** + secret `ANTHROPIC_API_KEY` cargado + **probada end-to-end** (lee proveedor/total/ítems/clave FE/método). Modelo por env `ANTHROPIC_MODEL`.
- **Multi-documento**: una foto puede traer varias facturas → `documentos[]` → N filas en `documents`. Esquema CR rico: factura/proforma/comprobante/propinas/otro, clave FE 50 díg., IVA 1%/13% por línea, ítems en 2 líneas, unidades (K/UN/CJ/GL), `condicion_pago`, banco/referencia, moneda USD.
- **Auto-genera el movimiento al subir** (lo pidió el dueño): si confianza ≥0.4, cuadra y no requiere revisión → crea el movimiento solo (factura→cuenta por pagar; crédito→pendiente; comprobante→concilia pendiente único o egreso). El encargado revisa todo en Caja → Movimientos con las facturas físicas. Manuscritas/baja confianza/no cuadra → quedan en Bandeja con aviso **⚠ revisar** + checkbox de validación obligatorio.
- **PWA Share Target** (WhatsApp → Satori, `public/sw-share.js`) + subida manual/cámara. Anti-duplicado SHA-256 / clave FE.
- **Propinas** (recibo de tips) → no es gasto del P&L. **USD** → guarda dólares + TC del día.

### Auto-inventario desde la Bandeja (Fase 2D-C) ✅
- Migración 017: `supplier_item_map` (mapeo aprendido), `ingredient_prices` (historial), trazas en `inventory_movements`.
- Bandeja → **"Inventario pendiente"**: facturas con gasto creado → `InventoryStep` empareja ítem↔ingrediente (mapeo aprendido por código del proveedor → fuzzy → vincular/crear/no-inventario), **factor de conversión explícito**, entra stock + costo + historial de precios, y **aprende** para auto-emparejar la próxima. Idempotente por `document_id`. Trazas: badge "📄 factura" en movimientos + historial de precios al editar ingrediente. El catálogo se construye al vuelo.

### Caja — mejoras operativas (2026-06-04)
- **Caja Fuerte** muestra ₡ **y** $. Tarjeta **"Ajustes de cierre"** = suma de las diferencias de los cierres del día (ver si netean a cero a fin de mes); el ajuste de apertura ya no la ensucia.
- **Pagos operativos** en el turno (delivery → cuenta 7100, operativo, salario en efectivo) — salen de la Caja Diaria. Orden de Caja Diaria: Ingresos adicionales (compacto) → Pagos a proveedores → Pagos operativos.
- **"+ Nuevo movimiento"** en Movimientos: Banco→Caja Fuerte (suma al saldo), retiro, egresos sueltos. Selector **Cuenta P&L** por movimiento.
- **Pendientes agrupados por proveedor** (fecha/turno/₡/$/ref, total) con pago individual/selectivo/total y **descarga de comprobante PNG**.
- **TC al abrir turno** = el de Admin (`exchange_rates`). **Cajero** agregado a Puntos por rol (propinas).
- **Descartar turno** (Caja Diaria) y **Deshacer cierre** (Cierre del día) con contraseña de manager — para errores de fecha / empezar de 0.
- **Datos**: deliverys históricos recategorizados a operativo (7100); directorio de proveedores depurado (no-proveedores desactivados).
- **Timeout en apertura/cierre del turno** (15s) + en la Bandeja: si la sesión de login vence, el cliente Supabase puede colgar una request (refresh de token); ahora surge un aviso "recargá la app y reintentá" en vez de quedar girando. ⚠️ Pendiente de fondo: investigar el hang del refresh de token (afecta cualquier escritura tras sesión vencida).

### Fase A finanzas (modelo de pagos/P&L) — ver ROADMAP Fase 2D
- Retiro a banco = **traspaso** (fuera del P&L). `egreso_socios` ya no alimenta el P&L. **Ingresos de caja selectos** (aceite/reciclaje) → cuenta `otros_ingresos` (mig. 014). **`cash_movements.account_id`** (mig. 015) + selector "Cuenta P&L". **Bitcoin** en métodos de proveedor.
- **Pendiente** (en ROADMAP): recategorizar histórico `egreso_socios` (deliverys vs retiros), separar gerencia/staff, y todo el sistema de **ingesta por foto** (Fases B/C/D).

## Stack & deploy
- React 19 + TypeScript + Vite · Supabase (PostgreSQL + PostgREST + Auth + RLS) · PWA
- Repo: github.com/CachoSatori/satori-app — push a `main` despliega (GitHub Pages, base `/satori-app/`)
- Supabase project ref PROD: `yiczgdtirrkdvohdquzf`
- **STAGING**: rama `staging` → Cloudflare Pages (base `/`, pendiente de crear) · Supabase ref `hwiatgicyyqyezqwldia` · `npm run build:staging` · ver `STAGING.md`
- Management token (para queries SQL directas): guardado en sesiones previas
- Owner profile id: 48ef8af5-25d9-4990-a0b0-5140026da2ba (Cacho)
- Build/verificar: `cd /Users/ismaelgutierrezpechemiel/Downloads/satori-app && npm run build`

## ⚠️ SISTEMA DE DISEÑO (NO romper — costó iteraciones)
Tema **papel claro** dentro de los módulos (NO oscuro). Tokens en src/index.css :root.
- Fondos: `--t-paper`/`--vt-paper` (#f5f0e8 crema) = ÚNICO fondo de contenido. NO usar #fff ni #faf7f0 (tarjetas blancas se ven mal).
- Tarjetas oscuras de acento (KPI): `--t-ink`/`--vt-ink` (#0d0d0d) CON texto claro explícito.
- Texto: principal = ink (oscuro); muteado = `#5a5040`; NO usar #aaa (muy claro sobre papel).
- **Fuentes** (unificadas 2026-06 — `Syne` ELIMINADA de toda la app): el sistema de Propinas es el estándar para todo Satori → LETRAS/texto en `var(--font-sans)` (Noto Sans JP, fina, peso 300). NÚMEROS/montos/fechas en `'DM Mono'` (la fuente numérica de Propinas). Kanji/wordmark en `var(--font-serif)` (Noto Serif JP). NO reintroducir Syne ni fuentes del sistema (Arial/Helvetica).
- Dorado sobre papel: `#a07830` (no #c8a96e, muy claro). Teal `#2a7a6a`. Rojo `#c23b22`. Bordes `--t-border` (#d4cfc4).
- Inputs oscuros (#111 + texto claro) sobre papel = patrón OK probado.

## Estética unificada (estilo "dashboard") en TODOS los módulos
- Header: kanji + título (serif) + **badge de rol** (.role-badge) + botón ← Inicio.
- Nav: **barra oscura separada** (.vt-nav-tabs / .cd-nav-tabs) con tabs gris, activo dorado + subrayado.
  Ventas además tiene **etiquetas de grupo** (Operaciones/Equipo/Finanzas/Config) — .vt-nav-group.
- Selección de fecha: desplegable **.date-filter** (estilo del filtro de Propinas) en TODAS las pantallas
  con selección de mes (Ventas/Contabilidad, Mix, Ing.Menú, ICP, Evaluación, Caja/Resumen, Propinas, Food Cost).
  En Ventas/Mix/MenuEng: por año → botón "Todo {año}" + desplegable de meses, en horizontal.
- Proyección de ventas: componente MetaProgressBar.tsx (días, ₡actual/meta, %, proyección, meta diaria,
  promedio/día, esfuerzo req.) en pestaña HOY y Ventas — aparece si hay meta del mes cargada.
- **Listas de empleados con "recuadro"** (estilo de los empleados de Propinas): `.admin-table` es contenedor
  blanco con borde `--t-border`, filas separadas por línea + hover, nombre en negrita. Aplica a Admin →
  Empleados / Puntos por rol / Horas, y a las tablas de Stats de Propinas.

## Autenticación / Usuarios (2026-06-03)
- Login por correo + contraseña (Supabase Auth). LoginPage tiene toggle **Ingresar / Crear cuenta**.
- **Auto-registro**: el empleado se registra solo (nombre completo + correo + contraseña, `supabase.auth.signUp`).
  La cuenta **nace pendiente** (`profiles.is_active=false`, migration 009) → ve la pantalla "Cuenta pendiente"
  (App.tsx `PendingApproval`) y NO accede a nada hasta que la gerencia la habilite. Protege la página pública de registro.
- **Aprobación del owner**: Admin → pestaña **Usuarios** (UserApprovals.tsx): lista cuentas pendientes y activas,
  asigna **rol** y **Habilita/Deshabilita**. No te podés deshabilitar a vos mismo. Vincular a empleado (para "Mis
  Propinas") se hace en Admin → Empleados.
- Confirmación por correo **desactivada** en Auth (la cuenta entra al instante; el acceso lo da la aprobación).
- El correo queda en `profiles.email` para enviar reportes de pago a futuro.
- Cuenta de la compu principal (caja+propinas): rol **cajero** (solo operar). "Mis Propinas" oculto para cajero.
- **Rutas gateadas por rol** (App.tsx `PrivateRoute roles={...}`): además de ocultar tiles, cada ruta valida
  el rol del perfil y redirige al inicio si no corresponde (defensa por URL, sobre la RLS de la base).
- Admin → pestaña Usuarios muestra **badge rojo** con la cantidad de cuentas pendientes.

## PWA / Versionado
- `registerType: autoUpdate` + main.tsx: al abrir la app se busca versión nueva y, si el nuevo service
  worker toma control, **recarga una sola vez automáticamente** (guard anti-loop). Ya no hace falta "abrir y
  cerrar 2 veces" para ver lo último. El chequeo es solo al iniciar, no interrumpe el turno en curso.

## Módulos (TODOS completos y en producción)
### Ventas (売)
Hoy (delta vs ayer + Regalías + Ticket/item + vs General + contexto día-semana + compartir),
Mix (7 secciones, comparar, productos sin ventas), Análisis (quarterly/quincenal/YoY/proyección),
Calendario (DOW avg + listado mensual), MenuEng (matriz ⭐🐄🎯🐕),
Evaluación (consistencia/tendencia/racha + tabla scorecard + selector período + imprimir),
ICP (índice conversión propina), Saloneros (tarjetas + tabla ordenable),
Cajeros, Contabilidad, Metas, Competencias, XLS (batch + drag-drop), Config (bulk edit cascading), Histórico

### Propinas / Tips (心) — ✅ AUDITADO CONTRA FLUJO OPERATIVO REAL — listo para reemplazar Excel
- Turno: coberturas dinámicas (picker + badge COB) **persistidas en DB** (columna `tip_entries.covered_role`, migration 008). Regla: la cobertura usa el **rol efectivo (cubierto)** en TODO el cálculo → recibe los puntos de ese rol **Y entra al pool de barra** si cubrió en barra. Sobrevive al recargar, en el Historial y al editar. Verificación pool con tipo+motivo si dif >₡500 (bloquea cierre + persiste en notas), banner turno activo
- Datáfono individual por empleado de sala (propina ₡/$); bar/cocina reciben del pool
- Pool: general por puntos (efectivo + datáfonos de sala) **+** pool barra repartido por horas entre bartenders del turno. Barra muestra desglose Pool barra + Servicio en la fila
- Cierre AM/PM independiente (cada sesión se abre y cierra por separado)
- Registrar propinas atrasadas: al abrir turno se elige **fecha + turno (AM/PM)**, no solo el día actual. **Bloqueo de duplicados**: nunca crea sesión si ya existe registro (abierto o cerrado) para esa fecha+turno → aviso + "Ir a Historial"
- Historial: monto visible sin click + botón Ver → modal con desglose. **Edición dentro del mismo modal** (mini-formulario tipo creación: pools efectivo ₡/$, pool barra, por empleado check+horas+datáfono **+ selector "Cubrió como"**, reparto recalculado en vivo) — sin salir de Historial ni reabrir el turno. Acciones: editar/eliminar/copiar. Sesiones pre-mayo sin datáfono se manejan sin romper (generado ₡0)
- Quincenal, Stats (desglose AM/PM por empleado + top earners + **datáfono Generó vs Recibió** del mes). Ambos **cargan sus propios cálculos** del mes (fetch entradas + calcHistory) — ya NO dependen de visitar Historial primero (antes Stats salía vacío)
- Cocina (admin): pool semanal de cocina, reparto por semana ISO, Selena entra al pool pero no recibe (TipCocina.tsx)
- **Permisos**: `canOperate` (owner/manager/**cajero**) abre/edita/cierra el turno y carga coberturas — la cuenta de caja diaria opera propinas. `isManager` (owner/manager) queda para gestión: borrar sesiones, tabs Quincenal/Stats/Cocina, editar/eliminar en Historial. El cajero ve Historial en solo lectura.

### Caja / Cash (金) — ✅ AUDITADO CONTRA FLUJO OPERATIVO REAL — listo para reemplazar Excel
- Turno: apertura **dual** (registradora/servicio + caja proveedores) con TC dinámico ₡/$
- Dos cajas físicas separadas: los pagos a proveedor en efectivo salen de la **Caja Proveedores**, no de la registradora. Conciliación en vivo (fondo − pagos = restante)
- Caja proveedores abierta todo el día (AM y PM registran pagos); no se cierra por turno — se concilia en el Cierre del día
- Pago a proveedor por **modal** (proveedor/monto ₡-$/método/factura); lista más reciente arriba con editar/eliminar
- Cierre por turno: verificación de la registradora (fondo + ingresos − egresos efectivo) vs conteo
- Cierre del día (2 FASES): mediodía se sella → noche con separaciones (Caja Diaria mañana/Registradora/Remanente CF)
  + verificación automática (diferencia >₡500 exige tipo+motivo). Tabla: cash_cierres_dia
- Integración Caja↔Propinas: al cerrar propinas se registra egreso_personal (Registradora) por el payout
- **Cajero con acceso completo**: el rol cajero ve y opera TODAS las pestañas (Caja Diaria, Cierre del día, Movimientos, Proveedores, Pendientes, Resumen) — puede cerrar turnos/día y agregar proveedores. Lo único restringido: **eliminar registros guardados**.
- **Override de gerencia para eliminar** (src/shared/ManagerOverride.tsx): borrar un movimiento, desactivar un proveedor o quitar un pago YA guardado pide correo+contraseña de un owner/manager. Se verifica con un cliente Supabase temporal (persistSession=false) **sin tocar la sesión del cajero**. Para owner/manager logueado es instantáneo (sin pedir nada). Provider envuelve la app; hook `useManagerOverride()`.
- Movimientos, Proveedores, Pendientes
- Resumen (filtro mes + ingresos por método + egresos por subcategoría + tendencia mensual 6m)

### Otros
- MiRendimiento (人): vista salonero — Hoy/Historial/Semana/Competencias + metas personales
- MisPropinas (¥): tabla mensual histórica por empleado + Q1/Q2
- Resumen Diario (navegación días ‹›  + botón compartir WhatsApp) + Resumen Semanal (compartir)
- Reporte Mensual unificado (/reporte-mensual): ventas+propinas+caja de un mes en 1 vista, selector de mes, compartir + imprimir (ReporteMensual.tsx en resumen/)
- Admin: Empleados (bulk import en masa), Puntos por rol, Tipo cambio, Horas trabajadas, Email reports (cron día 1)
- SOPs / Procedimientos (書): CRUD + búsqueda + categorías. **20 SOPs reales migrados** (2026-06-03)
  desde Drive + carpeta local, estandarizados al formato Claude e insertados en la tabla `sops`
  (Montaje, Bienvenida, Servicio, Cobro/Separación, Créditos, Local Club, Link de Pago, SINPE/Bitcoin,
  Reservas, Pizarra, Delivery, SIPP, Cierre de Caja, Planilla Proveedores, Transferencias, Factura
  Electrónica, Reporte de Horas, Reportes de Ventas, Regalías). Demos placeholder desactivados.
  Render de markdown reescrito como parser real (encabezados, listas numeradas/viñetas, tablas, notas,
  negrita/código) — formato limpio de uso diario. created_by = owner.
- Inventario (Fase 1 COMPLETA en código, falta cargar datos reales):
  · Ingredientes: CRUD + import/export CSV masivo (1.1)
  · Recetas: BOM + costo teórico + ⇄ sincroniza costo_unitario a product_map → enciende food cost (1.2)
  · Consumo: motor de deducción por ventas del día, idempotente, preview + procesar (1.3)
  · Food Cost: teórico (COGS recetas) vs real (compras Caja) + merma + ajustes, por mes (1.3)
  · Movimientos: compra→Caja (genera egreso_mercaderia en turno abierto) (1.4)
  · Stock dashboard + alerta de stock en HomePage (sin stock / stock bajo) (1.4)
  · Orden de compra sugerida por proveedor (agrupa bajo-mínimo, qty a 2× min, copiar pedido) (1.4)
  → FASE 1 COMPLETA en código
- HomePage: dashboard con métricas reales en vivo (ventas/propinas/caja/stock del día en las tarjetas)
- Clientes / CRM (客) — Fase 2.1+2.2 (requiere migrations 004 y 005 aplicadas):
  · /clientes — búsqueda por teléfono/nombre, alta/edición rápida, perfil con agregados
  · puntos/visitas/gasto por interacción, tier sugerido (nuevo/regular/vip/embajador), historial
  · Fidelización (gerencia): reglas de puntos configurables (puntos/₡, bonus 1ª visita/cumple)
    + catálogo de recompensas; motor computeEarnedPoints; canje en el perfil (descuenta saldo)
  · Segmentos (2.3 parcial): cumpleañeros del mes, frecuentes/VIP, dormidos, nuevos
    + copiar lista + link wa.me por cliente (sin APIs externas)
  · Métricas (2.5): dashboard de fidelización — adquisición, retención, valor/LTV,
    puntos (emitidos/canjeados), comportamiento (CrmMetricas.tsx)
  · QR auto-registro (2.4): pestaña "QR registro" (gerencia) genera el QR del formulario
    público /registro (CrmQR.tsx, lib qrcode) para compartir por WhatsApp. El cliente
    escanea → formulario público RegistroCliente.tsx (sin login) → se crea en customers
    (channel_origin='whatsapp'). Policy de insert anónimo (migration 007). PROBADO end-to-end.
  · tablas customers, customer_interactions, loyalty_config, loyalty_rewards · src/modules/crm/
- Finanzas / P&L (財) — Fase 2C (requiere migration 006 aplicada):
  · /finanzas — Estado de Resultados estilo QuickBooks (Ingresos→COGS→Utilidad bruta→Gastos→Neta)
  · plan de cuentas jerárquico + budget 2026 importado de QB (Net proyectado ₡66.2M), por mes/año
  · columnas Presupuesto·Real·Variación. Falta: migrar reales históricos + conectar datos vivos (ventas/caja/inventario)
  · tablas finance_accounts, finance_budget, finance_actuals · src/modules/finanzas/

## Flujo operativo validado (2026-06-03)
Recorrido mental del día completo (Caja + Propinas) contra el flujo real del restaurante
(2 turnos AM/PM, encargado cierra cada uno, caja proveedores abierta todo el día, cada
salonero/bartender con su datáfono). Caja y Propinas quedan **listos para reemplazar el Excel**.

Pasos de prueba para confirmar en producción:
1. **Apertura AM** — abrir turno de caja: registrar fondo de registradora **y** fondo de caja
   proveedores por separado + TC. Verificar que aparecen las dos cajas en las top cards.
2. **Pagos a proveedor (AM y PM)** — agregar pagos por el modal (efectivo y transferencia).
   El efectivo descuenta de la **caja proveedores** (no de la registradora); la transferencia
   queda pendiente. La lista muestra el más reciente arriba; editar/eliminar funciona.
3. **Propinas del turno** — abrir sesión de propinas, cargar efectivo + datáfonos de sala +
   pool barra + horas. Confirmar que bartenders reciben pool general (por puntos) **+** pool
   barra (por horas) y que la fila muestra el desglose Pool barra / Servicio. Cerrar AM.
4. **Cierre de turno (registradora)** — contar la registradora: "debería quedar" = fondo +
   ingresos − egresos efectivo (propinas tarjeta/otros), **sin** pagos a proveedor. La caja
   proveedores se muestra como informativa (restante), no se cierra por turno.
5. **Cierre del día** — Fase 1 mediodía se sella; Fase 2 noche + conteo físico (separaciones:
   Caja Diaria mañana / Registradora / Remanente CF) + verificación. El resumen final muestra
   el Remanente de Caja Fuerte esperado y asigna el efectivo del día siguiente.

## Datos cargados en DB (migración histórica COMPLETA)
- ventas_dias: 151 días (2026, vía XLS)
- ventas_hist: 1096 días (2023-2025)
- product_map: 695 productos clasificados (tipo→clas→subcl)  ·  costo_unitario: UI de carga lista (inline + import CSV en Ventas→Config); food cost se activa solo al cargar
- tip_sessions: 137 cerradas (Ene-May 2026) + actuales  ·  tip_entries: 878 = ₡10,611,341
- cash_movements: 1116 (1106 históricos Ene-May + 10 actuales) — created_at corregido a fecha real
- cash_sessions: 137 históricas  ·  suppliers: 38  ·  employees: 24
- Fuentes CSV importadas: "movimientos" (1106 rows) + "propinas_turnos" (138 turnos con datos_json)

## Arquitectura clave
- Code splitting: cada tab es lazy() chunk (bundle 800KB→6KB shell)
- Cascading dropdowns derivados de product_map (no hardcoded)
- Pending-changes queue pattern para batch saves
- Sticky headers + botón 🏠 flotante universal (navegación en todos los módulos)
- Email cron: pg_net + net.http_post. Edge fn `monthly-report` envía ventas Y propinas.
  Cron día 1 08:00 CR (mes anterior, ambos) + día 15 08:00 CR (propinas quincenal mes en curso).
  Migration `supabase/migrations/003_tips_email_cron.sql` — APLICAR con acceso Supabase (service_role_key en Vault)
- Compartir: navigator.share (mobile→WhatsApp) con fallback clipboard

## ── ROADMAP — estado por fase (para revisar y decidir qué profundizar) ──
Detalle completo en ROADMAP.md. Resumen:

- **Fase 0 — Pendientes**: ⏳ depende del dueño (ver "Pendientes" abajo).
- **Fase 1 — Inventario/Recetas/COGS**: ✅ COMPLETA en código (1.1–1.4 + food cost teórico vs real).
  Falta sólo cargar datos reales (ingredientes/recetas/stock) — la UI ya está toda.
- **Fase 2 — Fidelización/CRM**:
  · 2.1 Base de clientes ✅ · 2.2 Programa de puntos ✅ · 2.3 Segmentos ✅ (parcial) · 2.5 Métricas ✅
  · 2.3 Tarjeta Apple/Google Wallet 🔴 (credenciales Apple Developer / Google Wallet API)
  · 2.4 Lector QR 🔴 (cámara real + deep-links GitHub Pages — testeo en dispositivo)
  · 2B Chatbot WhatsApp 🔴 (Twilio + Meta + OpenTable + Stripe)
- **Fase 3 — POS nativo**: 🔴 decisión buy-vs-build + factura electrónica Hacienda CR.

**Conclusión:** todo lo que NO depende de cuentas/credenciales externas está construido.
Lo que sigue necesita acción del dueño (trámites externos o decisión estratégica).

## ── SPRINT inicial (histórico, ✅ todo hecho) ──
1. ✅ ReporteMensual unificado — src/modules/resumen/ReporteMensual.tsx (ruta /reporte-mensual, card en Home)
2. ✅ EmployeeHours — fetch 24 meses, selector de año, fila de totales (src/modules/admin/EmployeeHours.tsx)
3. ✅ Registro de turno propinas — verificación ₡500 con tipo+motivo que bloquea cierre + persiste en notas
4. ✅ Email propinas día 1/15 — Edge fn ya tenía template; migration 003 programa el cron (APLICAR en Supabase)
5. ✅ Pool semanal cocina — TipCocina.tsx (pestaña Cocina admin, exclusión Selena)
6. ✅ UI carga costos — VentasConfig: import CSV + tabla paginada 50/pág + filtro clasificación; food cost se activa solo

(Previo: ✅ VentasICP extendido — Horas, Prop/turno, Prop/hora)

## Migraciones — TODAS APLICADAS en Supabase (2026-06-03, vía Management API)
- ✅ 004_customers (Clientes/CRM) · ✅ 005_loyalty (puntos+recompensas) · ✅ 006_finance (P&L + budget 2026)
- ✅ 007_customer_selfsignup (insert anónimo para auto-registro por QR) — probado HTTP 201
- ✅ 008_tips_covered_role (columna `tip_entries.covered_role` para persistir la cobertura de rol en propinas) — aplicada 2026-06-03
- ✅ 009_user_selfsignup (columna `profiles.email` + trigger: cuentas nuevas nacen `is_active=false` pendientes) — aplicada 2026-06-03. Además se desactivó la confirmación por correo en Auth (`mailer_autoconfirm=true`) vía Management API.
- ✅ 012_cajero_operativo_rls — el cajero puede escribir (operar) cash_sessions/movements/suppliers/tip_sessions/entries. Arregla que no podía registrar pagos/abrir turnos/agregar proveedores/borrar. Aplicada 2026-06-03.
- ✅ 011_ventas_exchange_rls — RLS de exchange_rates/product_map/ventas_* : lectura abierta, escritura solo owner/manager/contador. Aplicada 2026-06-03.
- ✅ 010_sops_rls — RLS de `sops`: lectura para todos, escritura solo owner/manager (antes cualquier autenticado podía escribir). Aplicada 2026-06-03.

## Auditoría de calidad / hardening (2026-06-03)
- **TS `strict` activado** (tsconfig.app + node) — 0 errores; el código ya era null-safe. Previene null-derefs / any implícitos a futuro.
- **ErrorBoundary** a nivel raíz (src/shared/ErrorBoundary.tsx) — un módulo que tire excepción ya no deja la app en blanco.
- **Tokens `--t-*` movidos a `:root`** (eran solo de `.tips-module`) — arregla el módulo SOPs (se veía oscuro/ilegible) y previene el bug para módulos futuros.
- **RLS SOPs endurecida** (migration 010).
- **RLS Ventas/exchange endurecida** (migration 011): `exchange_rates`, `product_map`, `ventas_dias/hist/comps/metas` → lectura abierta (intacta), escritura solo owner/manager/contador. Antes cualquier autenticado escribía.
- Código limpio: 0 console.log, 0 `as any`, lazy-loading + code-splitting, queries en paralelo (Promise.all).
- ⚠️ 003_tips_email_cron: era REDUNDANTE — ya existían crons `satori-monthly-report` (día 1) y
  `satori-quincenal-report` (día 15) que llaman a la edge fn `monthly-report` con body {} (tipo='ambos',
  envían ventas Y propinas, sin auth porque la fn es pública). Se eliminaron los crons duplicados de 003.
  · Mejora futura opcional: el cron día 15 manda body {} (mes anterior); para "quincenal del mes en curso"
    habría que pasarle month=mes actual. No crítico.

## Pendientes generales (necesitan acción del usuario)
- DNS SiteGround para email desde @satoricostarica.com (hoy sale de onboarding@resend.dev)
- Cargar los costos unitarios reales (la UI ya está: Ventas→Config→Costos, inline o import CSV)
- Definir meta mensual del mes en curso (Ventas→Metas) → enciende el bloque de proyección en HOY y Ventas
- Cargar datos de inventario reales (Inventario→Ingredientes import CSV, luego Recetas) → enciende COGS/food cost/consumo
