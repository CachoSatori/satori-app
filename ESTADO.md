# Satori App — Estado del proyecto

## ⚡ ARRANQUE — foto real del repo y de las bases (se REEMPLAZA en cada entrega, no se acumula)
**Al día: 2026-11-14, 01:30 hora de Costa Rica.** `main` verificado contra `origin`; lo de prod fuera de `main` y lo de
Cloudflare lo informó el dueño (en prod, Claude solo hizo lo que firmó el dueño). El bloque del 13/11 (Edge, `club-pase`,
pases de octubre y noviembre) está archivado en [ESTADO-ARCHIVO.md](ESTADO-ARCHIVO.md), no borrado.
**Punto de entrada: [docs/handoffs/HANDOFF-2026-11-13.md](docs/handoffs/HANDOFF-2026-11-13.md).**

> **Regla (Definition of Done):** ninguna entrega se cierra sin ⚡ARRANQUE al día; puede ir en el mismo PR o
> en un PR de docs inmediato después del merge. **El repo manda:** si este archivo y la realidad no coinciden, gana la realidad y se
> corrige el archivo.

| Puntero | Hash | Qué es |
|---|---|---|
| `main` | **`93a5bf7`** (13/11 23:33 -06:00: merge del #166, fechas día/mes en las facturas). **Sin regla de protección** (el dueño activa «Gate» como requisito en GitHub). | **PROD.** GitHub Pages (base `/satori-app/`). Ledger de prod: **153**. |
| `staging` | sin cambios desde el 13/11 (`4726b7f`, merge del #162) | Desarrollo y proyecto Supabase de staging. Cloudflare Pages (`satori-staging.pages.dev`) publica esta rama. |
| `feat/pos-desglose` | **`14bd278`** | Rama del **agente** del PoS (`pos-bridge/`). No se mergea a `main`. |

- **Prod, dato (firma del dueño, 14/11 00:09):** `employees.pos_login` **041** quedó asignado a un salonero nuevo. Consta
  en `club_pos_login_historial`. Sin nombres en el repo.
- **Edge `extract-document`:** staging en **v29** desde `190b5f5`, con los secretos `NEGOCIO_*`. **Prod sigue en la versión
  de `8a8dfb6`.** D15 firmado; falta una **prueba funcional en staging**: la sesión no puede invocar la función (el proxy
  bloquea `*.supabase.co`), así que la hace el dueño con una foto o se habilita el dominio.
- **PR en borrador (ninguno mergeado):**
  - **#168:** migración **155**, alerta `ANFITRION_SOBRE_TOPE` sin la carga inicial. Verificador independiente: CAMBIOS
    menores, corregidos en `70c00dc`.
  - **#169:** UI: link del portal al socio, login del PoS en Empleados y tope sin monto fijo.
  - **#170:** `club-web`: texto final del alta («puede ser hoy mismo»).
  - **#169 y #170 tocan la guía 6.13:** el segundo en mergear tiene un conflicto chico.
- **Decisión firmada, pendiente de construir: D6 A** (alta del Local Club): mayor de 18 obligatorio, cumpleaños día/mes
  opcional con permiso, aviso de privacidad v1.2 junto con el #140. Numeración: **154** solo si entra antes que la 155; si
  no, **156+**.
- **Local Club sigue en 15 %** hasta el lanzamiento del Club.
- **Regla de merges D1 vigente:** libre 23:30–15:50 · bloqueado 15:50–19:00 · 19:00–23:30 solo con OK del dueño. El bloqueo es
  solo de merges.
- **Sagrados (hash de blob):** `tipCalculations.ts` **`7603ba5a`** · `cashUtils.ts` **`b597c697`** (iguales en
  `main` y `staging`) · `posFiscal.ts` **`a3fd445f`** (solo existe en `staging`).
- **Gate de `main`:** `vitest run` **1998 tests** pasan (4 skipped; 161 archivos; 14/11, sobre `main` = `93a5bf7`). `tsc` y
  lint: último dato en el archivo (13/11: lint 83 problemas); se vuelve a medir en cada PR de código.
- **Refs Supabase:** **PROD = `yiczgdtirrkdvohdquzf`** (`satori-app`) · **STAGING = `hwiatgicyyqyezqwldia`** (`satori-staging`).

Documentos: fases → [ROADMAP.md](ROADMAP.md) · backlog → [PROMPT-CONTINUACION.md](PROMPT-CONTINUACION.md) ·
hallazgos → [HALLAZGOS.md](HALLAZGOS.md) · historial → [ESTADO-ARCHIVO.md](ESTADO-ARCHIVO.md) ·
pozo de caja → [PASE-POZO-A-PROD.md](PASE-POZO-A-PROD.md) · índice de SPECs → [docs/README.md](docs/README.md).

---

## 🛑 Reglas operativas (leer antes de tocar `main` o una base)

1. **Supabase Branching corre `migrate` contra PROD en cada push a `main`.** La integración de GitHub está atada
   a `main` (una sola rama, `main`, sin previews). El log del run lo dice explícito
   (`Connecting to database... All migrations are up to date.`). **Desde la 085, las migraciones entran por
   merge → Supabase Branching**: el PR con el `.sql` se mergea y Branching corre `migrate` contra prod (así
   entraron 085 y 089–095). **Lo de «a mano antes del merge» es histórico** (Management API, una
   transacción con el archivo exacto + su fila en `supabase_migrations.schema_migrations`): así entraron 062–077
   y la 081–082 del puente. Sigue valiendo solo si el dueño lo firma como excepción, y antes se verifica
   el ref de la base.
2. **Ningún PR a `main` con archivos bajo `supabase/functions/` hasta cerrar el ítem 11** (versionar
   `ingest-ndf` con `config.toml`). Sin `config.toml`, Branching despliega las funciones que cambian con
   `verify_jwt=true`, y el agente del PoS solo manda `x-ingest-secret` → 401 en cada ciclo.
   **Ojo:** `supabase/functions/monthly-report/` de `main` es el código **anterior a SEC-02** (sin chequeo de
   service_role/owner). El ítem 11 tiene que traer el código de la **v10** (y el de `alta-empleado`, que vive en
   `claude/alta-empleado-fn`) **antes** de que Branching despliegue funciones; si no, pisaría la v10 de prod.
   **Ojo (12/11):** lo mismo con `extract-document`. El código desplegado en prod (v9 del 12/11, `8a8dfb6`, rama
   `claude/busy-brown-ssjq4e`) **no está en `main`**: `main` tiene el código anterior, que lee `content[0].text` y con
   `claude-sonnet-5-5` (el modelo de prod desde el 12/11) devuelve la Bandeja vacía sin error. El ítem 11 tiene que
   traer `8a8dfb6` **antes** de que Branching despliegue funciones; si no, un despliegue desde `main` pisaría prod con
   el código viejo y la lectura de facturas dejaría de funcionar.
   **`club-pase` (Google Wallet, 12-nov):** cuando entre a `main` con el ítem 11, el `config.toml` tiene que declararla
   con **`verify_jwt = false`**. club-web (Pages y el Worker) la llama solo con `apikey` y el portón es `x-club-web`: con
   `verify_jwt = true`, «Agregar a Google Wallet» y «Actualizar mi pase» responden 401. Hasta el ítem 11 su código vive
   en la rama `claude/club-pase-edge` y se despliega a mano (`docs/club-satori/WALLET-GOOGLE-ACTIVACION.md`).
3. **Regla de merges D1 (decidida por el dueño el 13/11, hora de Costa Rica):** libre de 23:30 a 15:50 ·
   bloqueado de 15:50 a 19:00 (cierre de caja de la mañana y preparación del servicio) · de 19:00 a 23:30 solo
   con OK explícito del dueño en el momento. Una sola sesión de CC mergea a `main` a la vez, cada una
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
PoS «Nube de Fuego» (SQL Server, PC del PoS)
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
| «Satori PoS Bridge» | PC del PoS | carpeta de staging @ `14bd278` ¹ | staging · `ingest-ndf` v10 | `last_poll_at` 18:13 UTC, `last_error` null |
| «Satori PoS Bridge PROD» | PC del PoS | carpeta de prod nueva @ **`5da233a`** (pase del agente nuevo, 10/11 23:37:18 -06:00, cerrado el 11/11; la tarea corre el `.cmd` nuevo con la cuenta SYSTEM). La carpeta de prod vieja (@ `4d3513a`) y el `.cmd` viejo se quedan 7 días como vuelta atrás. Los nombres y las rutas, en el registro privado del dueño | **prod** · `ingest-ndf` **v3** (09/11) | `last_poll_at` 18:12 UTC, `last_error` null |
| `biotime-bridge` | PC del reloj (ST) | — | staging · `ingest-punches` v6 | ⚠️ **última sync 14/09 17:12 UTC** (22.969 marcas): parado desde entonces |

¹ Versión según el backlog del 29/10 (no verificable desde fuera de la PC). Las dos tareas del PoS arrancan
solas tras un reinicio (validado el 29/10).

### Edge Functions (Management API, 12/11)

«on» / «off» = `verify_jwt`. Cambiar un secreto de Edge **puede o no** subir la versión de las funciones (el 13/11 se
cargaron secretos en prod y ninguna cambió de versión): la versión no prueba nada. Para confirmar un secreto, mirar la lista
de secretos (nombre + huella); para saber si cambió el código, el hash (`ezbr_sha256`) y la fecha de actualización.

| Función | PROD | STAGING |
|---|---|---|
| `monthly-report` | **v12 · on** (código de la v10 del 06/11, SEC-02; a mano, código en `claude/sec-02-monthly-report-fn`) | v9 · on |
| `extract-document` | **v10 · on** (código de la v9 del 12/11 15:32 CR, desde `8a8dfb6`, hash `2f88ef52…`; `ANTHROPIC_MODEL` = `claude-sonnet-5-5` desde las 16:19 CR) | v23 · on (código de la v21 del 12/11 14:07 CR, desde `8a8dfb6`, hash `67095c19…`; 5.5) |
| `cierre-email` | v4 · on | v15 · on |
| `pago-notificar` | v4 · on | — |
| `ingest-ndf` | **v4 · off** (código de la v3 del 09/11, pase del puente, desde `5da233a` con `--use-api`; su código vive en `claude/puente-item11-prod-v2`, no en `main`) | v21 · off |
| `ingest-punches` | — | v13 · off |
| `alta-empleado` | v3 · on (código de la v1 del 06/11, a mano; código en `claude/alta-empleado-fn`, no en `main`) | v8 · on |
| `club-pase` | — (no está en prod) | v1 · off (12/11, desde `c6b54fc`, rama `claude/club-pase-edge`; `WALLET_ENTORNO` = `stg`) |

Leídas el 12/11 a la noche (solo lectura). En staging, los cambios de secretos del 12/11 (evaluación del modelo y `club-pase`) subieron las versiones sin tocar el código.

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

**Orden del pase a prod** (prod va hasta la **151** desde el 11/11): **085 ✅ → 089 ✅ → 090 ✅ → 091 ✅ → 092–095 ✅ (tanda, un merge) → Club ✅ (075 como 150 y 100 como 151, 11/11) → sigue el bloque 152+.**
1. ~~**081 → 082** (puente) primero, con su número.~~ **Hecho el 09/11** (pase del puente).
2. ~~Después la **085** (SEC-01c), con su número: queda arriba de la 082.~~ **Hecho el 10/11** (#80, `bb12652`).
3. Las que queden atrás (≤ al último de prod en su momento) toman **150+**, en el orden en que pasen:
   **150 ← 075 y 151 ← 100** (pase del Club, `docs/pases/PASE-150-151-club.md`); la **083**, la **084**, la 087 y la 088
   (y cualquier migración de caja posterior al Club) toman **152+** cuando se arme su paquete.
4. **Hecho el 10/11:** la **089** (#90, `fa1cbef`), la **090** (#97, `7543347`), la **091** (#103, `b8cb74d`) y la tanda
   **092–095** (#107, `c41e18b`). Detalle en el §9 de cada PASE (`docs/pases/`).
5. **Hecho el 11/11:** el Club (#59, `17a9efd`), la 075 como **150** y la 100 como **151**. La MAINTAIN de `authenticated` va después de abrir el
   Club, en el bloque 152+ (decisión del dueño).

**Ya usados (antes de los bloques)**

| Número | Nombre | De | Rama | Dónde está aplicada |
|---|---|---|---|---|
| 075 | `club_satori_esquema` | Club | `claude/brave-brown-m45jd7` y ramas del Club | **Renumerada a 150** en el pase del Club (`claude/pase-club`, 10-nov; regla 3). En staging la fila ya es la 150 |
| 078 | — | — | — | **No usar** (fue Prom/PAX, renumerada a 080) |
| 080 | `pos_prompax_agregado` | Prom/PAX | `main` (#58) | staging y prod (último de prod al 08/11) |
| 081 | `pos_ndf_campos_factura` | puente (Club) | `main` (#71, 09/11) | staging y **prod** (09/11 10:57 -06:00, a mano en el pase del puente) |
| 082 | `pos_ndf_ingesta_transaccional` (v3) | puente (Club) | `main` (#71, 09/11) | staging (v3, 09/11 01:43) y **prod** (v3, 09/11 ~12:00 -06:00, a mano en el pase del puente) |
| 083 | `my_turno_stats_higiene` | caja | `claude/higiene-r5` | staging (08/11). Va a prod con el PoS propio; ahí toma 150+ (regla 3) |
| 084 | `employee_payroll` (SAL-AUD-01, paso 1) | caja | `claude/salarios-rls` | staging (08/11). Va a prod con Salarios; ahí toma 150+ (regla 3) |
| 085 | `rls_lectura_rol_activo` (SEC-01c) | caja | `main` (#80, 10/11) | staging (08/11) y **prod** (10/11 08:24:48 -06:00, Branching al mergear el #80, `bb12652`) |
| 087 | `employee_edits_audit` (propuesta, sin firma) — **no se usa con este número: cuando esté lista va al bloque de pase (152+) con origen 087** (dueño, 10/11) | caja | `claude/employees-audit` | ninguna: propuesta |
| 088 | `employees_recibe_reparto_cocina` (PROP-AUD-01, sin firma) — **no se usa con este número: cuando esté lista va al bloque de pase (152+) con origen 088** (dueño, 10/11) | caja | `claude/prop-aud-01` | ninguna |
| 089 | `anon_sin_politica` | caja | `main` (#90, 10/11) | staging (09/11 08:27 CR) y **prod** (10/11 10:22:11 -06:00, Branching al mergear el #90, `fa1cbef`, 3 statements) |
| 090 | `anon_privilegios_por_defecto` | caja | `main` (#97, 10/11) | staging (09/11 08:28 CR) y **prod** (10/11 11:33:38 -06:00, Branching al mergear el #97, `7543347`, 4 statements) |
| 091 | `multilocal_fase0` | caja | `main` (#103, 10/11) | staging (10/11 11:02 CR) y **prod** (10/11 22:44:57 -06:00, Branching al mergear el #103, `b8cb74d`, 31 statements) |
| 092 | `employees_borrado_solo_owner` | caja | `main` (#107, tanda 092–095, 10/11) | staging (10/11 11:03 CR) y **prod** (10/11 22:57:17 -06:00, Branching al mergear el #107, `c41e18b`, 12 statements) |
| 093 | `ventas_lectura_rol_activo` | caja | `main` (#107, tanda 092–095, 10/11) | staging (10/11 11:03 CR) y **prod** (10/11 22:57:17 -06:00, Branching al mergear el #107, `c41e18b`, 7 statements) |
| 094 | `anon_sin_maintain` | caja | `main` (#107, tanda 092–095, 10/11) | staging (10/11 11:03 CR) y **prod** (10/11 22:57:17 -06:00, Branching al mergear el #107, `c41e18b`, 3 statements) |
| 095 | `contador_lee_caja` | caja | `main` (#107, tanda 092–095, 10/11) | staging (10/11 11:03 CR) y **prod** (10/11 22:57:17 -06:00, Branching al mergear el #107, `c41e18b`, 9 statements) |

**Bloques**

| Bloque | Rango | Asignadas | Próximo libre |
|---|---|---|---|
| CAJA / operación | 087–99 | 087, 088, 089, 090, 091, 092, 093, 094, 095, 096 | **097** |
| CLUB SATORI + puente | 100–149 | 100 (`club_catalogo_locales`; renumerada a 151 en el pase) | **101** |
| PASE A PROD (solo renumeraciones) | 150–199 | 150 (← 075), 151 (← 100): pase del Club, rama `claude/pase-club` · 153 (← 096): `claude/alias-proveedor-rpc` (sin aplicar) | **152** la usa el #140 (borrador, aún no en `main`); **154** después de la 153 (la 087, la 088 y cualquier migración de caja posterior al Club toman 152+ al armar su paquete) |
| (fuera de bloque) | 086 | — | libre |

**Asignadas en los bloques**

| Número | Nombre | Bloque | Rama | Dónde está aplicada |
|---|---|---|---|---|
| 096 | `proveedor_agregar_alias` (RPC atómica para el alias del proveedor; sin firma) | caja | `claude/alias-proveedor-rpc` | **renumerada a 153** en el mismo PR (13-nov; regla 3: prod va por la 151). El número 096 no se reutiliza (regla 4) |
| 100 | `club_catalogo_locales` | club | `claude/club-100-catalogo` | **renumerada a 151** en el pase del Club (`claude/pase-club`, 10-nov). El número 100 no se reutiliza (regla 4) |
| 150 | `club_satori_esquema` | pase (origen **075**) | `claude/pase-club` | staging (desde el 10/11 con la fila **150**: la 075 se renumeró con el texto del archivo). Prod: con el merge del pase del Club (Branching), después de la 091–093. Paquete: `docs/pases/PASE-150-151-club.md` · **En prod desde el 11/11 23:22:08 -06:00** (merge del #59, `17a9efd`; pase cerrado, local apagado) |
| 151 | `club_catalogo_locales` | pase (origen **100**) | `claude/pase-club` | staging (10/11, con su fila). Prod: en el mismo merge, justo después de la 150; necesita la 091 en prod. Paquete: `docs/pases/PASE-150-151-club.md` · **En prod desde el 11/11 23:22:08 -06:00** (merge del #59, `17a9efd`; pase cerrado, local apagado) |
| 153 | `proveedor_agregar_alias` | pase (origen **096**) | `claude/alias-proveedor-rpc` | **Sin aplicar** (13/11: PR en borrador a `main`, espera firma). RPC `proveedor_agregar_alias` (SECURITY INVOKER) para que dos cajas no se pisen los alias. La **152** la usa el #140 (aviso del Club). Rollback: `scripts/sql/153_rollback.sql` |


| Entorno | Ledger (`schema_migrations`) | Detalle |
|---|---|---|
| **PROD** | **67 filas** (11/11, según el pase del Club; antes 65 con la tanda 092–095) | `001–008 · 0090 · 0095 · 010–021 · 038–054 · 062–069 · 071–074 · 076–077 · 079–082 · 085 · 089 · 090 · 091 · 092 · 093 · 094 · 095 · 150 · 151` (**092, 093, 094 y 095 el 10/11 22:57:17 -06:00, en UN merge del #107 (`c41e18b`), Branching las aplicó en orden: 12, 7, 3 y 9 statements; pase de la tanda cerrado**; **091 el 10/11 22:44:57 -06:00, Branching al mergear el #103 (`b8cb74d`), 31 statements; pase cerrado 22:51**; **090 el 10/11 11:33:38 -06:00, Branching al mergear el #97 (`7543347`), 4 statements; pase cerrado**; **089 el 10/11 10:22:11 -06:00, Branching al mergear el #90 (`fa1cbef`), 3 statements; pase cerrado**; **085 el 10/11 08:24:48 -06:00, Branching al mergear el #80 (`bb12652`), 9 statements**; **081 y 082 v3 el 09/11, a mano en el pase del puente, antes del merge del #71**; 068 el 05/11 05:30 UTC, SEC-01; 069 el 05/11 15:22 UTC, SEC-01b; 071 el 05/11 19:20 UTC, cierre atómico; 072 y 073 el 05/11 ~20:05 UTC, SEC-03 y SEC-04; 074 el 05/11 20:20 UTC, conteo ciego; **076 y 077 el 06/11 entre 18:03:48 y 18:05:14 UTC**, SoP, una después de la otra — ver abajo; **079 el 06/11 21:22 UTC** y **080 el 07/11**, las dos aplicadas por Branching al mergear). **055–061 NO están en prod** (Salarios/BioTime, solo staging). La 067 se aplicó a mano el 30/10 antes del merge de #15. |
| **STAGING** | **91 filas, última 151** (leído el 11/11; el 10/11 a las 11:03 CR entraron la 091–095, y después la sesión del Club renumeró la 075 a 150 y aplicó la 151) | Hasta la 064 + la 067 + **la 068 (04/11, SEC-01) + la 070 y la 069 (05/11, SEC-01b; la 070 se aplicó primero) + la 071 (cierre atómico) + la 072 y la 073 (05/11, SEC-03 y SEC-04) + la 074 (05/11, conteo ciego) + la 075 (Club Satori F1a, reservada, solo staging) + la 076 y la 077 (SoP; 076 el 06/11 ~06:00–06:07 UTC, 077 el 06/11 ~16:36–16:40 UTC) + la 079 (SoP solo para usuarios activos, 06/11 ~21:08 UTC) + la 080 (Prom/PAX; aplicada el 06/11 como 078 y renumerada el 07/11, antes de ir a prod)**. Además, desde el 08/11: la 081 (puente), la 083, la 084 y la 085 (auditoría r5); la 082 del puente está aplicada **sin su fila**. ⚠️ **Le faltan las filas 065 y 066** aunque sus columnas existen (deuda de ledger, en el backlog). **10/11 tarde:** la 150 nueva (auditoría A/B, md5 `919bcd54…`) aplicada encima con su fila, con el OK del dueño; batería 613/613 y paridad 992 = 992 sin `--antes`. **10/11 18:10 CR:** la 150 de la segunda vuelta (Grok 162–164, md5 `04681f41…`) con su fila, mismo procedimiento; batería 623/623, paridad 992 = 992. La 082 del puente está aplicada **con su fila**: la v3 (09/11), md5 `edb7ffc58976804e55968f75df530a05`, igual al archivo de `main`. ⚠️ **Le faltan las filas 065 y 066** aunque sus columnas existen (deuda de ledger, en el backlog). |

- **Próximo número libre: por bloque** (08/11; caja al 13/11): **CAJA / operación 097**, **CLUB SATORI + puente 100**. Ver «Numeración de migraciones» abajo. Antes de crear una migración, leer esa sección **en `main`** y registrar el número en el mismo PR.
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

- **Caja · documentos huérfanos al borrar un movimiento. DESPUÉS DEL PILOTO** (decisión del dueño, 12-nov: Inventario
  todavía no se usa). Sin migración ni script por ahora.
  - **Qué pasa:** `delete_movement_cascade` (en prod, la versión de la 053; el bug viene desde la 043) busca los
    documentos por `linked_movement_id = p_movement_id` en la FASE 8, **después** de que la FASE 7 borró el movimiento.
    Para entonces la FK `documents_linked_movement_id_fkey … ON DELETE SET NULL` ya dejó el vínculo en null: el
    documento queda `procesado`, sin vínculo y sin limpiar (huérfano). Solo se limpian los que salen de
    `inventory_movements` (`v_doc_ids`).
  - **Medido en prod (solo lectura, 12-nov):** 114 documentos `procesado` sin vínculo. 112 se pueden limpiar; los
    otros 2 los referencian `inventory_movements` o `ingredient_prices` y se deciden aparte. 9 de ellos se
    ven hoy en «Inventario pendiente» de la Bandeja.
  - **No tocan la plata:** caja, caja fuerte y cierres leen solo `cash_movements` (confirmado leyendo el código, 12-nov).
    En el front, `documents` solo da la foto (FacturaVerify) y la nota «⚠ sin foto» de CashTurno. En la base, solo la
    leen `delete_movement_cascade` y el trigger `unif_on_cash_movement`, que toma el `document_id` para la tarea de
    revisión de inventario. Ninguna vista la usa.
  - **Propuesta:**
    1. Una migración nueva que, antes de la FASE 7, sume a `v_doc_ids` los documentos con
       `linked_movement_id = p_movement_id`, con una prueba que falla sin el arreglo.
    2. Un script en una transacción, con conteo antes y después y respaldo, que limpie los 112. Hay que decidir si se
       marcan `descartado`, que guarda la fila y la foto (lo recomendado), o si se borran como pretendía la D5.
    3. Las dos cosas, con la firma del dueño.
  - **Mientras tanto:** el control de duplicados del #149 ignora los huérfanos y los descartados, así que un huérfano no
    bloquea la recarga legítima de su factura.

- **Lectura de facturas (después del piloto; salieron del pase de `extract-document` del 12/11, nada construido):**
  - **«Agregar» de Caja** (`AgregarAsistente.tsx`): guarda solo el **primer** documento de una foto (una foto con dos
    proformas registra una) y **no detecta duplicados** (la misma foto entra dos veces). La Bandeja sí hace las dos cosas.
  - **Caja/Proveedores** («➕ Agregar foto», `CashProveedores.tsx`): cuando la lectura falla, crea el documento vacío
    **sin avisar**. Ninguna pantalla muestra el motivo (`extractImage` descarta el error de la función).
  - **Validación de la clave FE:** 50 dígitos, empieza con 506, y la fecha, la cédula y el consecutivo que lleva adentro
    coinciden con lo leído. En la evaluación de staging habría marcado todas las claves mal leídas, con 4.5 y con 5.5.
  - **Texto «Requiere revisión»:** el aviso «⚠ Confianza baja» del «Agregar» de Caja sale también cuando el modelo marca
    `requiere_revision` con confianza alta (85 %). Cuando ese es el motivo, el texto tiene que decir «Requiere revisión».
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
