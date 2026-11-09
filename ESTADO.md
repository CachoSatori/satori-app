# Satori App — Estado del proyecto

## ⚡ ARRANQUE — foto real del repo y de las bases (se REEMPLAZA en cada entrega, no se acumula)
**Al día: 2026-11-07.** Cada dato de este bloque se verificó contra `origin` y contra las dos bases
(Management API, solo lectura) el mismo día. Lo de julio (pozo único, ramas viejas, ledger de 39 filas)
está archivado en [ESTADO-ARCHIVO.md](ESTADO-ARCHIVO.md), no borrado.

> **Regla (Definition of Done):** ninguna entrega se cierra sin actualizar este bloque ⚡ARRANQUE, en el
> mismo commit. **El repo manda:** si este archivo y la realidad no coinciden, gana la realidad y se
> corrige el archivo.

| Puntero | Hash | Qué es |
|---|---|---|
| `main` | **`6bcfafb`** + el merge de este PR | **PROD.** GitHub Pages (base `/satori-app/`). Último merge antes de este PR: #57 (limpieza de comentarios). |
| `staging` | **`fb29872`** | Desarrollo: PoS propio + Salarios/BioTime + FE SIM + inventario COGS. Proyecto Supabase de staging. Al día con `main` hasta `6bcfafb` (#53–#57) + Prom/PAX (07/11 04:44 UTC, merge commits). **Es la rama de producción de Cloudflare Pages:** `satori-staging.pages.dev` publica `staging` con deploy automático (confirmado por Ismael en el panel el 06/11; `fb29872` = deploy `751a0c60`). Cada push a `staging` republica la URL principal; las demás ramas salen como preview. |
| `integracion/analitica-staging` | **`850a22f`** | ⚠️ Rama vieja, 123 commits atrás de `staging`. **No la publica Cloudflare** (lo de septiembre ya no vale: la rama de producción es `staging`). |
| `feat/pos-desglose` | **`14bd278`** | Rama del **agente** del PoS (`pos-bridge/`). No se mergea a `main`. |

**Merges a `main` del 05 y 06/11** (los de octubre: #13 `9ada841`, #14 `c7b2f4b`, #15 `ba23a24` y #16 `43e843d`, FUENTE_VENTAS = 'pos'; el detalle está en `git show 44da704:ESTADO.md`):

| PR | Merge | Fecha | Qué entró |
|---|---|---|---|
| #25 | `781eb72` | 05/11 | Fix «Borrar TODO el día» por día operativo. |
| #23 | `b82ed81` | 05/11 | SEC-01b, mig 069 (`get_my_role()` mira `is_active`). |
| #24 · #26 · #27 | `bb91623` · `5631681` · `93801b4` | 05/11 | Docs: estabilización de caja, staging y modal, backlog del 05/11. |
| #29 | `7dc66c1` | 05/11 | Cierre del día atómico, mig 071. |
| #28 | `c0a8a8b` | 05/11 | Club Satori docs + F0; migs 072 (SEC-03) y 073 (SEC-04). |
| #31 | `9f8483a` | 05/11 | Conteo ciego (mig 074). **Revertido por #32** (`f73a8e9`, merge `57204d3`); el revert borró también el `.sql` de la 074 (ver Branching abajo). |
| #33 | `37e11ee` | 05/11 | Reserva de la mig 075 para el Club Satori F1a. |
| #36 | `342c5f0` | 05/11 | «Recontar» una vez en el cierre del día (usa la 074). |
| #39 · #41 | `bddbef2` · `28f5333` | 05/11 | Alta de empleados desde Admin; docs del cierre del 05/11. |
| #44 | `efa85bd` | 06/11 | Cierre de turno como antes del #36. |
| #42 · #46 | `3b95890` · `39995e1` | 06/11 | SEC-02: botón de reportes con el JWT del owner; docs. |
| #43 | `8c992fc` | 06/11 | Alerta de días sin cierre (owner/manager, solo lectura). |
| #48 | `44da704` | 06/11 | Handoff del 06/11. |
| #51 | `4babdc5` | 06/11 | Vuelve el `.sql` de la 074 y su rollback (byte a byte desde `d4012ec`) + docs. |
| #52 | `d1e7902` | 06/11 | `.sql` de la 076 y la 077 (byte a byte = ledger de prod) + sus rollbacks + docs. Solo versiona: ya estaban aplicadas. |
| #49 | `e7de76e` | 06/11 | **SoP noviembre 2026 en prod**: módulo por área y código, lector con el Estándar SOP, «Ver PDF» y «Libros». Solo SoP (cherry-pick de #45/#47 + fix del `@page`). |
| #53 | `c20e688` | 06/11 | Docs: SoP en prod, nota de rollbacks y Branching, pendiente de la 079 y handoff de SoP. |
| #54 | `d192549` | 06/11 | Mig 079 (SoP solo para usuarios activos), la aplicó el merge (Branching). |
| #55 | `4288fd2` | 06/11 | Guías de uso del área 6 (`docs/sop-app/`) y regla en `CLAUDE.md` (squash). |
| #56 · #57 | `bb1a488` · `6bcfafb` | 06/11 | Saca nombres y correos reales de comentarios, tests y docs. |
| este PR | — | 07/11 | **Prom/PAX explicado** (Ventas → Análisis) + **mig 080** `pos_prompax_agregado`, que la aplica el merge (Branching). Firmado por Ismael el 06/11. |

- **⚠️ Supabase Branching falló en cada push a `main` desde el revert del #31 hasta este PR** (10 runs, del 05/11
  20:32 UTC al 06/11 16:55 UTC: `migrate` → `ERROR Remote migration versions not found in local migrations
  directory.`). La causa era la 074: estaba en el ledger de prod y su `.sql` ya no estaba en `main`. No se aplicó
  ni se rompió nada en la base; solo que Branching no corría `migrate` ni `deploy`. Este PR devuelve el archivo
  (idéntico al statement del ledger de prod y a la función viva) y Branching vuelve a «All migrations are up to date».
  - **Esperado:** entre que una migración se aplica a mano en prod y su PR se mergea, cualquier push a `main` hace
    fallar a Branching con ese mismo error (pasó el 05/11 a las 15:26 y 17:53 UTC con la 069 y la 071, y el 06/11 a las 18:05 UTC con la 076 y la 077 hasta el #52). Se corrige solo con el merge.
- **📚 SoP noviembre 2026 en prod (06/11, firmado por Ismael, PR #49, merge `e7de76e`):** el módulo SoP muestra **27 documentos** con código (1.1 … 5.4, incluidos 2.10, 2.11 y 4.4) agrupados en **5 áreas** (Cultura y servicio · Salón y recepción · Menú y producto · Administración y caja · Equipo), con el lector del Estándar SOP (Cormorant Garamond + DM Sans), «Ver PDF» con URL firmada (10 min) y la sección «Libros» (empleado para todos; franquicia solo owner y manager).
  - **Orden en prod (06/11, UTC):** respaldo de `public.sops` (18:01) → migs **076** y **077** a mano (18:03–18:05) → merge del #52 (`.sql` en `main`, 19:45) → merge del #49 (19:53; deploy de Pages 19:55, run 274 OK; Branching «All migrations are up to date») → `sync_sops` (19:56: **27 insertadas, 20 viejas → `is_active=false`, nada borrado**, una transacción) → PDF y libros subidos por Ismael con `subir_pdfs.ts --entorno prod`.
  - **Verificado en prod (solo lectura):** 27 activas con código, 0 viejas activas, 20 inactivas con su contenido intacto, todas con `area`; **29 objetos** bajo `documents/sops/` (27 PDF + 2 libros) y `pdf_path` en los 27. Por rol, con usuarios reales: owner y manager ven el libro de franquicia; cajero, contador y salonero no; los cinco ven el libro del empleado y los 27 PDF.
  - **Respaldos en Drive** (carpeta `respaldo` del paquete): `sops_prod_2026-11-06T18-01-15.json` (antes de las migs), `storage_policies_prod_antes_077.json` y `sops_prod_2026-11-06T19-56-10.json` (antes del sync).
  - **Rollback:** app = revert de `e7de76e`; datos = `update public.sops set is_active=false where code is not null` + `set is_active=true where code is null` (sin borrar); PDF = `pdf_path = null`; base = `077_rollback.sql` y después `076_rollback.sql` (ver Migraciones).
- **`FUENTE_VENTAS = 'pos'` en prod desde el 30/10, validado físicamente por Ismael.** Ventas y Mi Rendimiento
  leen el PoS fusionado con el Excel de respaldo (`{...xls, ...pos}`). Volver atrás = revert del merge de #16.
- **🧯 Fix «Borrar TODO el día» (05/11, rama `claude/fix-borrar-dia`):** elige por día operativo, no por `created_at`; vista previa antes de confirmar; ningún delete sin chequear el error. Validado por Ismael en la preview de staging; **en prod desde el 05/11** (PR #25, merge `781eb72`). Rollback = revert del merge. Ver [HALLAZGOS.md](HALLAZGOS.md).
- **🧾 Cierre del día atómico (05/11, rama `claude/cierre-atomico`, mig 071):** aplicada en staging (ledger 70) y **en prod el 05/11 a las 19:20 UTC** (ledger 47 → 48), a mano **antes** del merge del #29. En prod se verificó el catálogo (idéntico a staging) y se corrieron pruebas sin escribir datos. Rollback: revert del merge + `scripts/sql/071_rollback.sql`. Ver [HALLAZGOS.md](HALLAZGOS.md).
- **🔐 SEC-02 cerrado en prod (06/11, firmado por Ismael):** `monthly-report` v10 (`verify_jwt` on) exige service_role u owner activo, valida los parámetros y no devuelve montos ni nombres. El cron (jobs 3 y 4, 02:00 CR) manda `Authorization` desde el Vault (`service_role_key`), y el botón de Admin manda el JWT (PR #42). En staging se apagaron los jobs del cron (apuntaban a prod). Ver [HALLAZGOS.md](HALLAZGOS.md).
- **👤 Alta de empleados desde Admin (06/11, firmado por Ismael, PR #39):** el owner crea las cuentas desde Admin → Usuarios → «+ Nuevo empleado», con la Edge Function `alta-empleado` (prod v1, `verify_jwt` on, desplegada a mano; su código vive en la rama `claude/alta-empleado-fn`, **no en `main`** hasta el ítem 11). Contraseña temporal que se muestra una vez, y cambio obligatorio en el primer ingreso (flag en `app_metadata.cambiar_password`, que solo baja la función). El login ya no tiene «Crear cuenta». **Auth de prod (06/11, Management API, GET antes y después):** `site_url` `http://localhost:3000` → `https://cachosatori.github.io/satori-app/`, redirects `''` → `https://cachosatori.github.io/satori-app/**` y `password_min_length` 6 → 8. Nada más cambió y `disable_signup` sigue en `true`. Ver [HALLAZGOS.md](HALLAZGOS.md).
- **↩️ Cierre de TURNO vuelto a como estaba antes del #36 (06/11, firmado por Ismael):** el cierre de turno sin efectivo dejó al encargado sin el total de caja ni el total de gastos, y no podía verificar. `CashTurno.tsx`, `CashResumen.tsx` y su test vuelven **idénticos** al código previo al #36 (`342c5f0^1`): campo de efectivo, «Debería quedar en la Caja Diaria», «Cuadra / Diferencia», totales, resumen y «Disponible» con su aviso de déficit. `final_cash_*` se vuelve a guardar. **El «Recontar» del cierre del día se queda** (`CashCierre.tsx` sin cambios).
- **🔁 «Recontar» una vez en el cierre del día + cierre de turno sin efectivo (06/11, rama `claude/recontar-cierre`, firmado por Ismael):** sin migración nueva, usa las columnas `primer_conteo_crc/usd` de la **074**, que ya estaba en prod. Primero se probó un conteo ciego (#31) y se revirtió (#32) a pedido de Ismael. La versión final mantiene la verificación en vivo. Recorrido real en staging con la pantalla montada contra la base: 4 casos, ver [HALLAZGOS.md](HALLAZGOS.md).
- **🔐 SEC-03 y SEC-04 (05/11, rama `claude/brave-brown-m45jd7`, PR #28, migs 072 y 073):** escritura anónima en el CRM y lectura anónima de propinas y empleados. Aplicadas en staging (ledger 72) y **en prod el 05/11 ~20:05 UTC** (ledger 48 → 50), a mano antes del merge. `/registro` y el QR del CRM quedan apagados hasta la F1 del Club Satori. Rollback: `scripts/sql/072_rollback.sql` y `073_rollback.sql`. Ver [HALLAZGOS.md](HALLAZGOS.md).
- **Sagrados (hash de blob):** `tipCalculations.ts` **`7603ba5a`** · `cashUtils.ts` **`b597c697`** (iguales en
  `main` y `staging`) · `posFiscal.ts` **`a3fd445f`** (solo existe en `staging`).
- **Gate de `main`:** `tsc -b` 0 · `vite build` (production) OK · **1425 tests** (con env dummy, 06/11, con los de SoP) · lint 86 (sin nuevos).
- **Refs Supabase:** **PROD = `yiczgdtirrkdvohdquzf`** (`satori-app`) · **STAGING = `hwiatgicyyqyezqwldia`** (`satori-staging`).
- **🔐 SEC-01 (04/11, rama `claude/sec-01-perfiles`):**
  - **Paso A hecho en prod y staging:** `disable_signup=true` (antes `false`). El signup con anon da `422`.
  - **Bans firmados en prod:** Rosaura (`f54e3eff…`) y LE - Consultorias (`e317ac97…`), por `banned_until` directo (desvío aceptado), `is_active=false`, y borrado de sus 6 sesiones y 15 refresh tokens.
  - **Mig 068 en staging (04/11) y en prod (04/11 23:30 CR = 05/11 05:30 UTC, ledger 45 → 46), aplicada a mano antes del merge.** PR #22 mergeado el 05/11 (`81ac2d4`); el deploy de Pages (run #252) dio OK.
  - **Mig 069 (SEC-01b) en prod el 05/11 15:22 UTC (ledger 46 → 47).** Ismael validó en staging.
    - En prod se verificó el catálogo y se corrieron la prueba 4 (anon, por SQL y REST) y la prueba 1 (manager, con rollback). No se corrió ninguna prueba que mute datos.
    - El merge del PR queda como no-op para la base. Detalle en [HALLAZGOS.md](HALLAZGOS.md).

Documentos: fases → [ROADMAP.md](ROADMAP.md) · backlog → [PROMPT-CONTINUACION.md](PROMPT-CONTINUACION.md) ·
hallazgos → [HALLAZGOS.md](HALLAZGOS.md) · historial → [ESTADO-ARCHIVO.md](ESTADO-ARCHIVO.md) ·
pozo de caja → [PASE-POZO-A-PROD.md](PASE-POZO-A-PROD.md) · índice de SPECs → [docs/README.md](docs/README.md).

---

## 🛑 Reglas operativas (leer antes de tocar `main` o una base)

1. **Supabase Branching corre `migrate` contra PROD en cada push a `main`.** La integración de GitHub está atada
   a `main` (una sola rama, `main`, sin previews). El log del run lo dice explícito
   (`Connecting to database... All migrations are up to date.`). **Por eso las migraciones se aplican a mano en
   prod ANTES del merge** (Management API, una transacción con el archivo exacto + su fila en
   `supabase_migrations.schema_migrations`), se verifican, y recién después se mergea: Branching queda sin nada
   que hacer. Así entraron 062–066 y la 067.
2. **Ningún PR a `main` con archivos bajo `supabase/functions/` hasta cerrar el ítem 11** (versionar
   `ingest-ndf` con `config.toml`). Sin `config.toml`, Branching despliega las funciones que cambian con
   `verify_jwt=true`, y el agente del PoS solo manda `x-ingest-secret` → 401 en cada ciclo.
   **Ojo:** `supabase/functions/monthly-report/` de `main` es el código **anterior a SEC-02** (sin chequeo de
   service_role/owner). El ítem 11 tiene que traer el código de la **v10** (y el de `alta-empleado`, que vive en
   `claude/alta-empleado-fn`) **antes** de que Branching despliegue funciones; si no, pisaría la v10 de prod.
3. **No mergear a `main` durante el servicio (19–22 h CR).** Una sola sesión de CC mergea a `main` a la vez, cada una
   solo sus PRs, y con el OK de Ismael.
4. **«Ver como» usa los permisos del owner.** Sirve para ver lo que ve otro empleado, no para probar permisos:
   **los permisos se prueban con un usuario real de ese rol** (o simulando su JWT en una transacción
   `read only` + `rollback`).
5. **ICP = propina electrónica declarada (solo la voluntaria del cliente: tarjeta/SINPE) / neta de sus mesas.**
   El 10 % de servicio es un impuesto aparte: **no entra** ni al numerador ni al denominador. Lo cobrado del
   reparto del pool (`payout_crc`) no es ICP. Barra (barman/barback): «no aplica».
6. **La lectura del PoS para cualquier rol va por las funciones de la 067** (`pos_ventas_tickets_rango`,
   `pos_ventas_lineas`, `pos_ventas_latido`), **sin medios de pago ni `clase_ingreso`**. **Las tablas
   `pos_ndf_*` quedan cerradas a gerencia** (`owner/manager/contador`); no se les abre una policy.
   Excepción vigente y legítima: «En vivo» (solo gerencia) todavía lee las tablas directo
   (`getTicketsJornada`, `getTicketsDeJornadas`, `getMesasAbiertas`, `getUltimoPollPoS`,
   `getPedidosCerradosJornada`).
7. **Ritual antes de cualquier comando de base:** confirmar el *ref* del proyecto (`yiczgdti…` = PROD,
   `hwiatgic…` = staging). Nunca correr SQL de escritura sin haber leído el ref.
8. **Sagrados por hash de blob, no por `git diff`** (ver arriba). Nunca reimplementarlos sin acuerdo explícito.
9. **Verificar un deploy por contenido, no por HTTP 200:** el fallback del SPA devuelve `index.html` para
   cualquier ruta.
10. **Nunca revertir (ni borrar) el `.sql` de una migración que ya está en el ledger de prod.** Si se revierte el
    código de un PR, el archivo de su migración se queda en `supabase/migrations/`; si no, Branching falla en cada
    push a `main` (pasó con la 074 entre el 05 y el 06/11).

---

## 🔁 El camino de las ventas: PoS → app

```
PoS «Nube de Fuego» (SQL Server, PC del PoS DESKTOP-25PRDR1)
   │  lee FAC_* (read-only)
   ▼
agente pos-bridge (tarea programada de Windows; dos instancias, una por entorno)
   │  POST + x-ingest-secret
   ▼
Edge Function ingest-ndf (verify_jwt = false; service-role)  ──►  escribe
   ▼
pos_ndf_tickets · pos_ndf_ticket_lines · pos_ndf_open · pos_ndf_cursor   (RLS: solo gerencia; sin policies de escritura)
   │
   ├──► funciones 067 (SECURITY DEFINER, rol chequeado adentro, sin medios de pago)
   │        pos_ventas_tickets_rango · pos_ventas_lineas · pos_ventas_latido
   │        ▼
   │     app: ventasFuente.cargarDias / cargarDiasEager / cargarDeFondo ({...xls, ...pos})
   │          → Ventas (Hoy, Cajeros, Mix, Saloneros, ICP, Histórico…) · Mi Rendimiento · lentes de saloneros
   │          → si el PoS no se puede leer: estadoPos ≠ 'ok' + franja «Mostrando solo el Excel…»
   │
   └──► lectura directa (solo gerencia): «En vivo» (mesas abiertas, jornada, latido del agente)
```

- **Tickets en prod:** 40.549 (2024-01-06 → 2026-10-30). En staging: 40.781.
- **Día del reporte** = fecha CR de `fecha_registra` (el mismo corte que el reporte del PoS). «En vivo» y los
  turnos siguen usando la jornada por lote de cierre.
- **El Excel (`ventas_dias`) quedó como respaldo:** en prod el último día cargado es el **20/10**. La pestaña
  «Cargar XLS» y Paridad siguen vivas hasta que se retiren (backlog).

### Agentes en las PCs

| Agente | PC | Carpeta / versión | Publica a | Latido 30/10 |
|---|---|---|---|---|
| «Satori PoS Bridge» | PoS (`DESKTOP-25PRDR1`) | `C:\satori\satori-app` @ `14bd278` ¹ | staging · `ingest-ndf` v10 | `last_poll_at` 18:13 UTC, `last_error` null |
| «Satori PoS Bridge PROD» | PoS (`DESKTOP-25PRDR1`) | `C:\satori\satori-app-prod` @ `4d3513a` ¹ | **prod** · `ingest-ndf` v1 | `last_poll_at` 18:12 UTC, `last_error` null |
| `biotime-bridge` | PC del reloj (ST) | — | staging · `ingest-punches` v6 | ⚠️ **última sync 14/09 17:12 UTC** (22.969 marcas): parado desde entonces |

¹ Versión según el backlog del 29/10 (no verificable desde fuera de la PC). Las dos tareas del PoS arrancan
solas tras un reinicio (validado el 29/10).

### Edge Functions (Management API, 30/10; `alta-empleado` 06/11)

| Función | PROD | STAGING |
|---|---|---|
| `monthly-report` | **v10 · on** (06/11, SEC-02; a mano, código en `claude/sec-02-monthly-report-fn`) | v2 · on |
| `extract-document` | v7 · on | v15 · on |
| `cierre-email` | v2 · on | v8 · on |
| `pago-notificar` | v2 · on | — |
| `ingest-ndf` | **v1 · off** (desplegada a mano; su código no está en `main`) | v10 · off |
| `ingest-punches` | — | v6 · off |
| `alta-empleado` | v1 · on (06/11, a mano; código en `claude/alta-empleado-fn`, no en `main`) | v1 · on |

---

## 🗃️ Migraciones

### Numeración de migraciones (regla de Ismael, 08/11)

> **Fuente de verdad:** `supabase/migraciones-reservadas.json`, que lee el test del gate
> `supabase/migraciones.test.ts`. Esta tabla lo repite para leerlo rápido; el test exige que coincidan.

**Reglas**
1. **Bloques por rama:**
   - **CAJA / operación: 087–99** (caja, Salarios, PoS propio, seguridad de la app);
   - **CLUB SATORI + puente: 100–149**;
   - **PASE A PROD: 150–199**, que no es de creación: solo recibe renumeraciones del pase (regla 3).

   La **086** queda libre, fuera de bloque. Si un bloque se acaba, se le asigna uno nuevo **en esta tabla y
   en el registro antes de usarlo**.
2. **Cada PR que agrega una migración actualiza esta tabla y el registro** (`asignadas`, con el siguiente
   número libre de su bloque). El gate falla si una migración nueva no está registrada, si queda fuera del
   bloque de su rama o si repite un número.
3. **Pase a prod:** ninguna migración entra a prod con número **≤ al último del ledger de prod**. Si pasa,
   se renombra al **siguiente libre del bloque de PASE (150–199)**, nunca dentro de un bloque de creación
   (ahí chocaría con números reservados que todavía no se desplegaron; ajuste de Ismael tras la auditoría,
   hallazgo 97). Va en el mismo PR del pase: archivo, rollback, pruebas, scripts y la fila del ledger de
   staging. En el registro se anota con bloque `pase` y su `origen` (ej. `083 → 150`); el gate lo exige.
   (Branching rechaza una versión menor que la última aplicada: por eso la 078 de Prom/PAX pasó a 080.)
4. Un número usado no se reutiliza aunque la rama se abandone. Las versiones son **texto**, como en el
   ledger: `0090` y `0095` son históricas y distintas de una futura `090` / `095`.

**Orden previsto del pase a prod** (prod va hasta la 080):
1. **081 → 082** (puente) primero, con su número.
2. Después la **085** (SEC-01c), con su número: queda arriba de la 082.
3. Las que queden atrás (≤ al último de prod en su momento: la **083** y la **084**, la **075** del Club)
   toman **150+**, en el orden en que pasen.

**Ya usados (antes de los bloques)**

| Número | Nombre | De | Rama | Dónde está aplicada |
|---|---|---|---|---|
| 075 | `club_satori_esquema` | Club | `claude/brave-brown-m45jd7` y ramas del Club | staging. Al pasar a prod se renombra al bloque de pase (regla 3) |
| 078 | — | — | — | **No usar** (fue Prom/PAX, renumerada a 080) |
| 080 | `pos_prompax_agregado` | Prom/PAX | `main` (#58) | staging y prod (último de prod al 08/11) |
| 081 | `pos_ndf_campos_factura` | puente (Club) | `claude/epic-tesla-pyo77m`, `claude/club-integracion`, `claude/club-wallet` (PR #59) | staging |
| 082 | `pos_ndf_ingesta_transaccional` | puente (Club) | `claude/puente-item11` | staging, **sin su fila en el ledger** (08/11): falta registrarla |
| 083 | `my_turno_stats_higiene` | caja | `claude/higiene-r5` | staging (08/11). Va a prod con el PoS propio; ahí toma 150+ (regla 3) |
| 084 | `employee_payroll` (SAL-AUD-01, paso 1) | caja | `claude/salarios-rls` | staging (08/11). Va a prod con Salarios; ahí toma 150+ (regla 3) |
| 085 | `rls_lectura_rol_activo` (SEC-01c) | caja | `claude/rls-is-active` | staging (08/11) |

**Bloques**

| Bloque | Rango | Asignadas | Próximo libre |
|---|---|---|---|
| CAJA / operación | 087–99 | — | **087** |
| CLUB SATORI + puente | 100–149 | 100 (`club_catalogo_locales`, sin aplicar; va después de la 075) | **101** |
| PASE A PROD (solo renumeraciones) | 150–199 | — | **150** |
| (fuera de bloque) | 086 | — | libre |

**Asignadas en los bloques**

| Número | Nombre | Bloque | Rama | Dónde está aplicada |
|---|---|---|---|---|
| 100 | `club_catalogo_locales` | club | `claude/club-100-catalogo` | **sin aplicar**. Orden en prod 085 → 091 → 092 → 100: **no se mergea antes que la 091 y la 092**. Necesita la 075: va en el pase del Club, después de la 075 (si la 075 toma 150+, la 100 se renumera al siguiente) |


| Entorno | Ledger (`schema_migrations`) | Detalle |
|---|---|---|
| **PROD** | **55 filas** | `001–008 · 0090 · 0095 · 010–021 · 038–054 · 062–069 · 071–074 · 076–077 · 079–080` (068 el 05/11 05:30 UTC, SEC-01; 069 el 05/11 15:22 UTC, SEC-01b; 071 el 05/11 19:20 UTC, cierre atómico; 072 y 073 el 05/11 ~20:05 UTC, SEC-03 y SEC-04; 074 el 05/11 20:20 UTC, conteo ciego; **076 y 077 el 06/11 entre 18:03:48 y 18:05:14 UTC**, SoP, una después de la otra — ver abajo; **079 el 06/11 21:22 UTC** y **080 el 07/11**, las dos aplicadas por Branching al mergear). **055–061 NO están en prod** (Salarios/BioTime, solo staging). La 067 se aplicó a mano el 30/10 antes del merge de #15. |
| **STAGING** | **82 filas** (08/11) | Hasta la 064 + la 067 + **la 068 (04/11, SEC-01) + la 070 y la 069 (05/11, SEC-01b; la 070 se aplicó primero) + la 071 (cierre atómico) + la 072 y la 073 (05/11, SEC-03 y SEC-04) + la 074 (05/11, conteo ciego) + la 075 (Club Satori F1a, reservada, solo staging) + la 076 y la 077 (SoP; 076 el 06/11 ~06:00–06:07 UTC, 077 el 06/11 ~16:36–16:40 UTC) + la 079 (SoP solo para usuarios activos, 06/11 ~21:08 UTC) + la 080 (Prom/PAX; aplicada el 06/11 como 078 y renumerada el 07/11, antes de ir a prod)**. Además, desde el 08/11: la 081 (puente), la 083, la 084 y la 085 (auditoría r5); la 082 del puente está aplicada **con su fila** (08/11, md5 `5db915c8a422519ce77050f1fb1b916a`, igual al archivo de `claude/puente-item11-prod`). ⚠️ **Le faltan las filas 065 y 066** aunque sus columnas existen (deuda de ledger, en el backlog). |

- **Próximo número libre: por bloque** (08/11): **CAJA / operación 087**, **CLUB SATORI + puente 100**. Ver «Numeración de migraciones» abajo. Antes de crear una migración, leer esa sección **en `main`** y registrar el número en el mismo PR.
  - La **076** (`sops_code_area`: columnas `code`, `area`, `doc_type`, `version`, `employee_book`, `pdf_path` en `public.sops` + índice único parcial `sops_code_key` + check `sops_doc_type_check`) y la **077** (`sops_pdf_storage`: policies `sops_storage_read` y `sops_franquicia_solo_gerencia` en `storage.objects`, bucket privado `documents`) están **en staging y en prod**. Prod: 06/11 entre 18:03:48 y 18:05:14 UTC, aplicadas a mano por la Management API (sesión de Claude Code de los SoP, con OK del dueño), verificando el ref antes de cada escritura y **antes** del merge del código (PR #49). Sus `.sql` son **idénticos byte a byte** a los statements del ledger de prod y de staging (md5 `fc26bfea…` y `ef17f371…`). Rollback: `scripts/sql/077_rollback.sql` y, solo después de revertir el sync de SoP, `scripts/sql/076_rollback.sql`.
  - **⚠️ Si se corre un rollback de la 076 o la 077, en el mismo momento hay que quitar su `.sql` de `supabase/migrations/` en `main`** (PR propio). Los rollbacks borran la fila del ledger; si el archivo sigue en `main`, Branching intentaría volver a aplicarla en el próximo push, y si el archivo sale de `main` sin el rollback, falla con «Remote migration versions not found in local migrations directory» (regla 10: nunca sacar de `main` el `.sql` de algo que está en el ledger).
  - La **079** (`sops_lectura_activos`, PR de `claude/mig-079-sops-activos`) cierra el hueco de lectura de SoP para usuarios **inactivos** con sesión vigente: `sops_read` (010) pasa de `USING (true)` a `USING (public.get_my_role() is not null)`, y `sops_storage_read` (077) suma `and public.get_my_role() is not null`. Nada más cambia (`sops_write`, `sops_franquicia_solo_gerencia`, `documents_storage_rw` y el resto quedan igual; usa `ALTER POLICY`). **Staging: aplicada el 06/11 ~21:08 UTC** y probada en solo lectura: owner, cajero y salonero reales (y los 5 roles simulados) leen igual que antes —47 filas de `sops` (27 activas), 27 PDF y el libro del empleado; la franquicia solo owner y manager—, un manager inactivo real ve **0 filas y 0 objetos** de `sops/*`, y `anon` 0. **Prod: la aplica Supabase Branching con el merge del PR** (Branching ON auto-aplica las migraciones de `main`), con OK de Ismael y respaldo previo de las dos policies. Rollback: `scripts/sql/079_rollback.sql` (y quitar el `.sql` de `main` en el mismo momento).
  - La **074** (`cash_cierres_dia.primer_conteo_crc/usd` + `cerrar_dia_completo` las escribe; null si no vienen) está en staging y en prod (prod: 05/11 20:20 UTC). Su primer cliente, el conteo ciego (#31), se revirtió (#32). Desde el 06/11 la usa el «Recontar» del cierre del día (`claude/recontar-cierre`). El `.sql` y su rollback volvieron a `main` el 06/11 (`supabase/migrations/074_cierre_primer_conteo.sql` y `scripts/sql/074_rollback.sql`, byte a byte desde `d4012ec`).
  - La **072** (SEC-03, cierre de la escritura anónima del CRM) y la **073** (SEC-04, lecturas sin sesión → `authenticated`) están en staging y en prod (prod: 05/11 ~20:05 UTC, a mano antes del merge del PR #28).
  - La **071** (cierre del día atómico, `claude/cierre-atomico`, PR #29) está en staging y en prod (prod: 05/11 19:20 UTC, a mano antes del merge).
  - La 068 está en staging y en prod (PR de `claude/sec-01-perfiles`).
  - La **069** (SEC-01b, `claude/sec-01b-is-active`) está **aplicada en staging y en prod** (prod: 05/11 15:22 UTC, a mano antes del merge).
  - La **070** (guardas del PoS propio, `claude/sec-01b-pos-guardas`, desde `staging`) está **aplicada solo en staging**. Se aplicó antes que la 069 y no va a prod hasta el pase del PoS.
- 🚫 Nunca `repair --status reverted` sobre algo aplicado. El CLI ordena archivos por **nombre** y el ledger por
  **versión** (por eso `009` → `0090`). La `026` en prod es una excepción permanente documentada.

**Mig 067 · `pos_ventas_lectura_equipo`** (prod y staging): tres funciones `SECURITY DEFINER`, `search_path=public`,
rol chequeado adentro (`owner, manager, contador, salonero, barman, barback, runner, cocina`), `revoke` a
`public`/`anon`, paginación con orden total adentro. `pos_ventas_tickets_rango` devuelve **17 columnas** (las que
usan `armarDia` y las lentes); nunca medios de pago, vuelto, dólares, cxc, `numero_pedido`, `total_fuente`,
`ingested_at` ni `clase_ingreso`. Verificada en prod (30/10): owner y manager función = tabla fila por fila
(40.538 tickets / 3.476 líneas de octubre, 0 diferencias) · salonero: tabla 0, función 563 tickets de octubre ·
cajero y sin perfil: 0 · `anon`: `permission denied`. El contrato de columnas lo fija
`src/shared/api/posNdf.contrato067.test.ts`.

---

## 🧩 Qué hay en PROD y qué solo en STAGING

Leyenda: ✅ en prod y validado en piso · 🟢 en prod, falta validar en piso · 🧪 solo staging · 🔲 no construido.

| Módulo | Estado |
|---|---|
| **Caja: POZO único + T3 (los 8 ítems)** | ✅ prod |
| Propinas (pool por `covered_role`, `pool_total_crc` fuente única) | ✅ prod |
| Bandeja unificada + Revisión de inventario · autorización por contraseña (045) · elegibilidad de propina (048) | ✅ prod |
| Finanzas/P&L · reportes + emails · admin · auth · realtime · offline | ✅ prod |
| Proveedores A (notificación de pago, mig 047) + B (saldo a favor, migs 053/054) + comprobantes | 🟢 prod, sin validar en piso; el correo sale recién con el DNS de Resend |
| **Ventas desde el PoS** (puente, migs 062–066, `FUENTE_VENTAS='pos'`, Paridad, En vivo, Frente C, lentes por línea) | ✅ prod (30/10) |
| **Mi Rendimiento** (casa del empleado; «Ver como» solo owner; sigue `FUENTE_VENTAS`) | ✅ prod |
| **ICP** (propina electrónica declarada; barra «no aplica»; benchmark único) | ✅ prod (30/10) |
| **Lectura del PoS para el equipo** (mig 067 + franja de aviso) | ✅ prod (30/10); probada con salonero real en staging |
| Salarios F0 (055) · U0a/U0b (056/058) · BioTime F1 (057, `ingest-punches`) | 🧪 staging · BioTime parado desde el 14/09 |
| PoS propio (comandero, KDS, cobro + splits, ticket/FE SIM, inventario COGS; migs 022–037, `posFiscal.ts`) | 🧪 staging · bloqueado por el PILAR de auth |
| PILAR de auth multi-tenant · FE-CR real | 🔲 |

### Pendientes de estabilización

- **Propinas · reparto semanal de cocina:** mover la exclusión del reparto de cocina de un nombre fijo en el código a una marca en la base (requiere spec y firma: toca propinas).
- **Privacidad · datos reales que siguen en el repo público** (tras #56 y #57, que limpiaron comentarios, tests y docs).
  No se sacaron porque hacerlo cambia el comportamiento o porque la zona está bloqueada:
  - **Listas de personal que usa la app** (`src/shared/ndf/personasNdf.ts`, `src/modules/ventas/ventasEnVivoDatos.ts`
    y los tests que dependen de ellas): la app las usa para mapear los tickets del PoS a personas. Moverlas a la base
    pide spec y firma.
  - **Correo y filtro por correo en `scripts/`** (`scripts/clone_prod_to_staging.py` y 4 scripts `.ts` de
    `refresh-staging/` y `t0-reconciliacion-cajas/`): sacarlos cambia cómo se ubica la cuenta. Pasar a una variable
    de entorno o a una búsqueda por rol.
  - **Nombres de proveedores** en los docs de `scripts/refresh-staging/` (corte e informes T0) y en
    `ESTADO-ARCHIVO.md`: son registros históricos. Anonimizarlos en un PR de docs.
  - **Alias de correo** en la pantalla de alta (`NuevoEmpleado` / `UserApprovals`) y en la función `cierre-email`:
    bloqueado hasta el ítem 11 (`supabase/functions/` no se toca).

### Seguridad que sigue abierta en prod (medido 30/10; SEC-01 al 04/11)

- **SEC-01 (escalada de roles):** ✅ cerrada en prod: Paso A (signup apagado + bans) y mig 068 (05/11). Rollback: `scripts/sql/068_rollback.sql`.
- **SEC-03 y SEC-04:** ✅ cerradas en prod con la 072 y la 073 (05/11). `anon` ya no escribe en el CRM ni lee propinas, sesiones, puntos por rol, tipo de cambio ni empleados.
- **SEC-01b:** ✅ cerrada en prod con la 069 (05/11). Las cuentas inactivas pierden permisos. Rollback: `scripts/sql/069_rollback.sql`. Ver [HALLAZGOS.md](HALLAZGOS.md).

- **4 funciones `SECURITY DEFINER` ejecutables por `anon`:** `get_my_role`, `handle_new_user`,
  `log_movement_edit` (052) y `unif_on_cash_movement`. Las de la 067 y las de plata no.
- **Sin `supabase/config.toml`:** el `verify_jwt` de las funciones no está versionado.
- **`deploy.yml` no corre `vitest`** antes de publicar a prod.
- ~~**`monthly-report` con `verify_jwt` off.**~~ ✅ Cerrado el 06/11 (SEC-02).

---

## 📝 Notas que ahorran una sesión

- **Análisis mediodía, Local Club y descuentos (nov 2026), cerrado:** conclusiones vigentes en `docs/analisis/2026-11-mediodia-localclub/README.md` §0. Resumen: menú por temporada (inserto en baja, a pedido en alta) sin platos que canibalizan; Local Club 2.0 al 10 % + regalo; créditos de ₡18.000 cada 6 personas; conciliar comisiones PM; código de empleado para el 30 %. Escenario 2027: +₡3,9–9,1M de margen por año.

- **Qué cubre cada fuente de ventas:** `ventas_dias` (detalle diario con saloneros) = enero 2026 → 20/10/2026 en
  prod · `ventas_hist` (reporte general, sin salonero) = 2023–2025 · `pos_ndf_*` = 6-ene-2024 → hoy. 2023 no tiene
  detalle diario en ninguna fuente; sobrevive por `ventas_hist`.
- **El delivery baja ~4-5 % con el PoS y no es un bug:** el Excel llamaba delivery a toda venta sin servicio; el PoS
  usa el canal real.
- **La historia 2024-2025 da −0,057 % contra el Excel** (concentrado en días viejos puntuales, p. ej. 7-mar-2024).
  Ruido para analítica; resolver el drill-down antes de usarlo para algo contable.
- **2024 no tiene salonero** (cobertura 0 %): Saloneros/Evaluación/ICP salen vacíos en 2024. No es regresión.
- **ICP del equipo de octubre:** con el Excel daba 15,7 % (inflado: ventas al 20/10, propinas al 28/10); con el PoS
  da 10,6 %. Los umbrales de la pestaña (≥13 % excelente, <10 % a mejorar) están pendientes de recalibrar.
- **`version.json` desde el navegador lleva al login:** el service worker responde `index.html` a toda navegación
  bajo `/satori-app/` (su denylist solo tiene `/inbox/share`). Con Cmd+Shift+R, `view-source:` o una ventana de
  incógnito nueva se ve el JSON. Arreglo en el backlog.
- **`database.ts` puede mentir la nullability** frente a `supabase.gen.ts`; las lecturas castean la fila cruda.
- **`navigator.share` es no-opcional en el lib DOM de TS:** chequear con `typeof nav.share === 'function'`.
- **Para cherry-picks a prod, usar un git worktree aislado**; los untracked del árbol principal bloquean el checkout.
