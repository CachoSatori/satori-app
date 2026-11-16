# Satori App — Estado del proyecto

## ⚡ ARRANQUE — foto real del repo y de las bases (se REEMPLAZA en cada entrega, no se acumula)
**Al día: 2026-11-15, 06:45 hora de Costa Rica.** `main` = **`306b5cf`** (merge del #197). **Ledger de prod = 171.** Todos los
merges con firma del dueño. El bloque anterior (02:10 del 15/11) está archivado en [ESTADO-ARCHIVO.md](ESTADO-ARCHIVO.md), no borrado.
**Punto de entrada: [docs/handoffs/HANDOFF-2026-11-13.md](docs/handoffs/HANDOFF-2026-11-13.md).**

> **Regla (Definition of Done):** ninguna entrega se cierra sin ⚡ARRANQUE al día; puede ir en el mismo PR o
> en un PR de docs inmediato después del merge. **El repo manda:** si este archivo y la realidad no coinciden, gana la realidad y se
> corrige el archivo.

| Puntero | Hash | Qué es |
|---|---|---|
| `main` | **`306b5cf`** (15/11 06:32 -06:00: merge del #197, docs; última migración 171 con #193). **Sin regla de protección** (el dueño activa «Gate» como requisito en GitHub). | **PROD.** GitHub Pages (base `/satori-app/`). Ledger de prod: **171**. |
| `staging` | sin cambios desde el 13/11 (`4726b7f`, merge del #162) | Desarrollo y proyecto Supabase de staging. Cloudflare Pages (`satori-staging.pages.dev`) publica esta rama. |
| `feat/pos-desglose` | **`14bd278`** | Rama del **agente** del PoS (`pos-bridge/`). No se mergea a `main`. |

- **Entraron el 15/11 después de la tanda 156–169** (hora CR, merge SHA):

| PR | Mig. | Merge | Hora CR | Nota |
|---|---|---|---|---|
| #194 | | `cb9f155` | 04:47 | docs (ESTADO tras la tanda nocturna) |
| #190 | 170 | `a200b2c` | 05:34 | el manager solo ve y opera sus locales. Antes, con firma del dueño (05:27), se asignó en prod el local Santa Teresa a la única manager activa; **Nosara queda sin manager** |
| #195 | | `591d8d3` | 05:37 | pruebas de #190 que quedaron fuera de su merge; el deploy de Pages de `a200b2c` falló en Tests y quedó resuelto con #195 |
| #193 | 171 | `8ddf79d` | 05:44 | hotfix `club_miembro_guardar` = 156 + 157 sobre el núcleo de la 170 |
| #196 | | `de36ef0` | 05:59 | pase de Wallet del equipo («Personas registradas») y avance de 90 días; Edge `club-pase` redeploy a v6 |
| #197 | | `306b5cf` | 06:32 | docs: definiciones de referente y concierge |

- **Regresión de «Editar» socio: cerrada** con la 171 (ya no da «Tipo no válido» y vuelve a generar el link al pasar socio → anfitrión).
- **Pendiente del dueño / de la sesión:**
  - **Edge `club-pase`:** redeploy hecho el 15/11 de madrugada → prod **v6 · ACTIVE** (`verify_jwt` off), desde la rama `claude/club-pase-edge` (cabeza `6c5848e`, con `main` mergeado).
  - **Validación física** de lo que entró (manager con la 170, «Editar» socio con la 171, tanda 156–169).
  - **Edge `extract-document`:** staging en **v29** desde `190b5f5`, con los secretos `NEGOCIO_*`. **Prod sigue en la versión
    de `8a8dfb6`.** D15 firmado; falta una **prueba funcional en staging** (la sesión no puede invocar la función: el proxy
    bloquea `*.supabase.co`).
- **Seguimientos (backlog, sin fecha):** el contador ve «Cohortes» · funciones por id del manager · funciones nuevas con local
  (159, 163, 166, 168, 169) sin `club_exigir_local` · OpenTable · buscador de Escanear con socios · botón anfitrión → socio ·
  fecha elegida en Bandeja · unificar la auditoría de la 161 y la 162 · pasar a SQL fijo el de la 162.
- **Local Club sigue en 15 %** hasta el lanzamiento del Club.
- **Regla de merges D1 vigente:** libre 23:30–15:50 · bloqueado 15:50–19:00 · 19:00–23:30 solo con OK del dueño. El bloqueo es
  solo de merges.
- **Sagrados (hash de blob):** `tipCalculations.ts` **`7603ba5a`** · `cashUtils.ts` **`b597c697`** (iguales en
  `main` y `staging`) · `posFiscal.ts` **`a3fd445f`** (solo existe en `staging`). (Medidos el 14/11; no se re-midieron en este PR de docs.)
- **Gate de `main`:** último dato medido (14/11): `vitest run` 2068 tests; se vuelve a medir en cada PR de código.
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
11. **La fecha del movimiento de caja es el día en que se registró (el turno), nunca la fecha de la factura** (regla del
    dueño, 14/11). La fecha de la factura es un dato aparte (va a la descripción, «· fact AAAA-MM-DD»): los proveedores
    suelen facturar el día del pedido y entregar 1–3 días después. La fecha de factura se analiza por calendario
    (`src/shared/utils/fechaFactura.ts`): la clave FE manda; sin clave, de las dos lecturas día/mes se toma la única
    posible (no futura, ≤ 60 días) y, si las dos lo son, la pantalla pregunta y no deja guardar hasta elegir; una
    factura de más de 7 días avisa «Factura de hace X días: revisá la fecha.» (no bloquea).
12. **Bitácora de permisos (165, B10) caída = no se cambian roles ni activaciones (fail closed, decisión del dueño
    14/11).** Si hay que cortarle el acceso a alguien igual: (1) ban o cambio de clave en Supabase Auth (no pasa por
    `profiles`); (2) si además hay que desactivarla, soporte, como dueño de la tabla y en UNA transacción:
    `alter table public.profiles disable trigger trg_profiles_bitacora_permisos;` →
    `update public.profiles set is_active = false where id = '<UUID>';` →
    `alter table public.profiles enable trigger trg_profiles_bitacora_permisos;`; (3) anotarlo a mano con
    `origen = 'manual'` y la hora real cuando la bitácora vuelva. SQL completo y pasos: guía 6.6, «Urgencia».
    Vale solo después del merge del PR de la 165.

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
| `club-pase` | **v6 · off** (15/11 de madrugada, a mano desde `claude/club-pase-edge` @ `6c5848e`: pase del equipo con «Personas registradas» y avance de 90 días del socio) | v1 · off (12/11, desde `c6b54fc`, rama `claude/club-pase-edge`; `WALLET_ENTORNO` = `stg`) |

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
| CLUB SATORI + puente | 100–149 | 100 (`club_catalogo_locales`; renumerada a 151 en el pase) · 101 (`club_aviso_v1_2`, #140; renumerada a 159) · 102 (`club_tope_sin_carga_inicial`; renumerada a 155) · 103 (`club_alta_caja_link_portal`; renumerada a 156) · 104 (→ 157) · 105 (→ 158) | **106** |
| PASE A PROD (solo renumeraciones) | 150–199 | 150 (← 075), 151 (← 100): pase del Club, rama `claude/pase-club` · 153 (← 096): `claude/alias-proveedor-rpc` · 155 (← 102): `claude/club-tope-sin-carga-inicial` (en prod desde el merge del #168) · 156 (← 103): `claude/club-link-portal-cajero` · 157 (← 104): `claude/club-equipo-sin-creditos` · 158 (← 105): `claude/club-resena-cupon` (#174/#176/#177, en prod desde el 14/11) · 159 (← 101): `claude/club-aviso-v1.2` (#140, en prod desde el 15/11) | **160** (la 152 y la 154 no se usan: prod ya pasó la 153) |
| (fuera de bloque) | 086 | — | libre |

**Asignadas en los bloques**

| Número | Nombre | Bloque | Rama | Dónde está aplicada |
|---|---|---|---|---|
| 096 | `proveedor_agregar_alias` (RPC atómica para el alias del proveedor; sin firma) | caja | `claude/alias-proveedor-rpc` | **renumerada a 153** en el mismo PR (13-nov; regla 3: prod va por la 151). El número 096 no se reutiliza (regla 4) |
| 100 | `club_catalogo_locales` | club | `claude/club-100-catalogo` | **renumerada a 151** en el pase del Club (`claude/pase-club`, 10-nov). El número 100 no se reutiliza (regla 4) |
| 101 | `club_aviso_v1_2` (aviso v1.2 + D6 A) | club | `claude/club-aviso-v1.2` | **renumerada a 159** en el mismo PR (#140; 12-nov como 152, 14-nov a 159: prod va por la 155 y 156–158 son de otros PRs). El número 101 no se reutiliza (regla 4) |
| 102 | `club_tope_sin_carga_inicial` (D5 A del dueño: ANFITRION_SOBRE_TOPE sin la carga inicial) | club | `claude/club-tope-sin-carga-inicial` | **renumerada a 155** en el mismo PR (14-nov; regla 3: prod va por la 153). El número 102 no se reutiliza (regla 4) |
| 103 | `club_alta_caja_link_portal` (firma del dueño 14-nov 06:04: el cajero manda el link del portal al socio que acaba de dar de alta) | club | `claude/club-link-portal-cajero` | **renumerada a 156** en el mismo PR (14-nov; regla 3: prod va por la 155). El número 103 no se reutiliza (regla 4) |
| 104 | `club_equipo_sin_creditos` (D7 A + saldos A, firma del dueño 14-nov: el equipo no canjea, no vence ni cuenta en el pasivo; saldos congelados) | club | `claude/club-equipo-sin-creditos` | **renumerada a 157** en el mismo PR (14-nov; regla 3: prod va por la 155 y la 156 es del #174). El número 104 no se reutiliza (regla 4) |
| 105 | `club_resena_cupon` (ítem #13 de la spec del Club v2: reseña de Google tras el cupón; firma del dueño 14-nov) | club | `claude/club-resena-cupon` | **renumerada a 158** en el mismo PR (14-nov; regla 3: prod va por la 155; la 156 es del #174 y la 157 queda para D7). El número 105 no se reutiliza (regla 4) |
| 106 | `club_tablero_plata` (SPEC Club v2 ítems 3–5, Fase 1B: tablero «¿El Club deja plata?», pasivo de créditos, contador lee) | club | `claude/club-tablero-plata` | **renumerada a 160** en el mismo PR (14-nov; regla 3: prod va por la 155; 156–159 son de otros PRs). El número 106 no se reutiliza (regla 4) |
| 107 | `club_cohortes_ranking` (SPEC Club v2 ítems 6 y 7, Fase 1C: cohortes del Local Club y ranking de socios por consumo) | club | `claude/club-cohortes-ranking` | **renumerada a 161** en el mismo PR (14-nov; regla 3: prod va por la 155; 156–160 son de otros PRs). El número 107 no se reutiliza (regla 4) |
| 108 | `club_embudo_anfitrion` (SPEC Club v2 ítem 8, Fase 1D: embudo del anfitrión) | club | `claude/club-embudo-anfitrion` | **renumerada a 162** en el mismo PR (14-nov; regla 3: prod va por la 155; 156–161 son de otros PRs). El número 108 no se reutiliza (regla 4) |
| 109 | `club_edad_validar_reactivar` (D6 A, 2.ª parte: «Validar socio» y la reactivación piden «es mayor de 18» si falta) | club | `claude/club-edad-validar` | **renumerada a 163** en el mismo PR (14-nov; regla 3: prod va por la 155; 156–162 son de otros PRs). El número 109 no se reutiliza (regla 4) |
| 110 | `club_alertas_umbral` (SPEC-club-v2 ítem 10, alertas con umbral del Inicio) | club | `claude/club-alertas-umbral` | **renumerada a 164** en el mismo PR (14-nov; regla 3; número asignado por el coordinador). El número 110 no se reutiliza (regla 4) |
| 111 | `admin_bitacora_permisos` (B10: bitácora de permisos de Admin, solo inserción) | club | `claude/admin-bitacora-permisos` | **renumerada a 165** en el mismo PR (14-nov; número asignado por el coordinador, regla 3). El número 111 no se reutiliza (regla 4) |
| 112 | `club_grupo_control` (SPEC Club v2 ítem 12, B8, Fase 2D: campañas con grupo de control) | club | `claude/club-grupo-control` | **renumerada a 166** en el mismo PR (14-nov; regla 3: prod va por la 155; 156–165 son de otros PRs). El número 112 no se reutiliza (regla 4) |
| 113 | `club_resena_socios` (ítem #14 de la spec del Club v2: reseña de Google a socios cada N visitas; decisión 3 del dueño, 14-nov) | club | `claude/club-resena-socios` | **renumerada a 167** en el mismo PR (14-nov; regla 3: prod va por la 155; 156–166 asignadas a otros PRs del Club). El número 113 no se reutiliza (regla 4) |
| 114 | `club_primeros_90` (ítem #15 del Club v2: primeros 90 días y cortesía especial; **toca plata**) | club | `claude/club-primeros-90` | **renumerada a 168** en el mismo PR (14-nov; regla 3: prod va por la 155). El número 114 no se reutiliza (regla 4) |
| 115 | `club_retos` (ítem #16 del Club v2: retos de temporada baja; **toca plata**) | club | `claude/club-retos` | **renumerada a 169** en el mismo PR (14-nov; regla 3: prod va por la 155). El número 115 no se reutiliza (regla 4) |
| 116 | `club_local_manager` (seguridad: el manager solo ve y opera el Club en sus locales) | club | `claude/club-local-manager` | **renumerada a 170** en el mismo PR (14-nov; regla 3: prod va por la 155; 156–169 son de otros PRs). El número 116 no se reutiliza (regla 4) |
| 117 | `club_miembro_guardar_reune_156_157` (HOTFIX 14-nov: la 157 pisó lo de la 156 en `club_miembro_guardar`) | club | `claude/hotfix-miembro-guardar` | **renumerada a 171** en el mismo PR (14-nov; regla 3: entra después de la 158–170). El número 117 no se reutiliza (regla 4) |
| 118 | `club_local_manager_2` (seguridad, hallazgo 231: el manager solo en sus locales, segunda tanda) | club | `claude/club-local-manager-2` | **renumerada a 172** en el mismo PR (15-nov; regla 3: prod va por la 171). El número 118 no se reutiliza (regla 4) |
| 119 | `club_cumple_caja_portal_beneficio` (D-cumple-1 A + D-cumple-2, 15-nov: cumpleaños en el alta en caja y en el portal una vez; beneficio configurable; aviso v1.3) | club | `claude/club-cumple-promo` | **renumerada a 173** en el mismo PR (15-nov; regla 3: prod va por la 171; la 118/172 es del #202). El número 119 no se reutiliza (regla 4) |
| 120 | `club_facturas_dia_busqueda` (plan B de Escanear: facturas cobradas hoy + búsqueda por tiquete de 3 días; decisión del dueño, 15-nov, opción A) | club | `claude/club-facturas-dia-busqueda` | **renumerada a 174** en el mismo PR (15-nov; regla 3: va DESPUÉS de la 172 (#202) y la 173 (#203), ya en prod). El número 120 no se reutiliza (regla 4) |
| 150 | `club_satori_esquema` | pase (origen **075**) | `claude/pase-club` | staging (desde el 10/11 con la fila **150**: la 075 se renumeró con el texto del archivo). Prod: con el merge del pase del Club (Branching), después de la 091–093. Paquete: `docs/pases/PASE-150-151-club.md` · **En prod desde el 11/11 23:22:08 -06:00** (merge del #59, `17a9efd`; pase cerrado, local apagado) |
| 151 | `club_catalogo_locales` | pase (origen **100**) | `claude/pase-club` | staging (10/11, con su fila). Prod: en el mismo merge, justo después de la 150; necesita la 091 en prod. Paquete: `docs/pases/PASE-150-151-club.md` · **En prod desde el 11/11 23:22:08 -06:00** (merge del #59, `17a9efd`; pase cerrado, local apagado) |
| 153 | `proveedor_agregar_alias` | pase (origen **096**) | `claude/alias-proveedor-rpc` | **Aplicada en prod** (verificado 15/11 06:50 CR: ledger y función `proveedor_agregar_alias` presentes). RPC `proveedor_agregar_alias` (SECURITY INVOKER) para que dos cajas no se pisen los alias. (El #140 pasó de la 152 a la **159**.) Rollback: `scripts/sql/153_rollback.sql` |
| 155 | `club_tope_sin_carga_inicial` | pase (origen **102**) | `claude/club-tope-sin-carga-inicial` | **En prod desde el 14/11 00:48 -06:00** (merge del #168, `dac805d`, vía Branching). `create or replace` de `club_excepciones`: ANFITRION_SOBRE_TOPE no cuenta `club_movimientos.origen = 'migracion'` (la carga inicial del 12/11), como el reporte del mes. Prueba en staging en transacción descartada: 9/9. Rollback: `scripts/sql/155_rollback.sql` |
| 156 | `club_alta_caja_link_portal` | pase (origen **103**) | `claude/club-link-portal-cajero` | **Aplicada en prod el 14/11 22:19 -06:00** (merge → Branching; era: 14/11: PR en borrador a `main`, espera OK; vía merge → Branching). `create or replace` de `club_socio_alta_caja`: devuelve `token_portal` solo si esa alta creó a la persona (número que no era de nadie), y lo audita como `ver_link_portal`. `club_miembro_token` sigue solo owner/manager. Además (verificador, 14/11) `club_rol_activar_anfitrion` regenera `token_portal` al activar a un socio como anfitrión (el link del alta deja de servir para canjes), y `club_miembro_guardar` hace lo mismo al pasar un socio a anfitrión desde «Editar» (y acepta editar a un socio como socio, sin reactivarlo si está de baja: LC-DES-01). Prueba en staging en transacción descartada: 20/20; mutaciones muerden. Rollback: `scripts/sql/156_rollback.sql` |
| 157 | `club_equipo_sin_creditos` | pase (origen **104**) | `claude/club-equipo-sin-creditos` | **Aplicada en prod el 14/11 22:33 -06:00** (merge → Branching; era: 14/11: PR en borrador a `main`, espera OK y verificador independiente; vía merge → Branching). D7 A: guarda del equipo en `club_canje_codigo_generar` y `club_canje_aplicar`; `club_saldo_canjeable` / `club_corte_equipo` (saldo congelado que no revive, foto en `club_auditoria`); portal, pase, ficha de caja, vencimiento, reporte del mes, baja (`club_miembro_guardar`), `club_ajuste` y `club_alertas_pendientes` con lo canjeable; `club_reporte_equipo` (ranking). Pruebas: `scripts/sql/157_pruebas.sql` (batería + 13 mutaciones en una transacción descartada; **pendiente de correr en staging**). Rollback: `scripts/sql/157_rollback.sql` |
| 158 | `club_resena_cupon` | pase (origen **105**) | `claude/club-resena-cupon` | **Aplicada en prod el 14/11 23:35 -06:00** (merge → Branching; era: 14/11: PR en borrador a `main`, espera OK). Columnas `club_config.resena_url` (CHECK: solo direcciones de Google) y `club_cupones.resena_clic_en`; `club_cupon_ver` devuelve `resena` solo con el cupón usado hace < 7 días; función pública nueva `club_cupon_resena_clic`. Prueba en staging en transacción descartada: 16/16; el caso 15 (rollback limpia todo, también el historial de `resena_url`) queda pendiente con el dueño (el conector cancela los `drop`). Rollback: `scripts/sql/158_rollback.sql` |
| 159 | `club_aviso_v1_2` | pase (origen **101**) | `claude/club-aviso-v1.2` | **Aplicada en prod el 15/11 01:15 -06:00** (merge → Branching; era: 14/11: #140 en borrador, espera firma). Aviso del Club v1.2 («usted» + edad + cumpleaños) y **D6 A**: `mayor_edad_en` en `club_miembro_roles` (trigger diferido: alta de socio por caja o autoalta sin él → rechazada), cumpleaños día/mes con permiso en `club_miembros_contacto` (guardia: solo en el alta, por el dueño real de la autoalta; después solo el owner; se borra con la baja o al eliminar el rol), autoalta con edad y cumpleaños, `club_socio_alta_caja_v2` (la de 5 argumentos queda interna). Entra en el MISMO merge que club-web y la app. Pruebas: `scripts/sql/159_pruebas.sql` (22 casos; local 22/22 con funciones de `postgres` y de otro dueño, con y sin la 156; 12/12 mutaciones; staging pendiente con el dueño). Rollback: `scripts/sql/159_rollback.sql` |
| 160 | `club_tablero_plata` | pase (origen **106**) | `claude/club-tablero-plata` | **Aplicada en prod el 15/11 01:20 -06:00** (merge → Branching; era: 14/11: PR en borrador a `main`, espera firma). Columna `club_config.cortesia_costo_pct` (default 35, 0–100; la edita el owner, queda en `club_config_historial`) y función `club_tablero_mes(date, text)` (SECURITY DEFINER, owner/manager/contador activos + `puede_ver_local`; solo totales; rastro en `club_auditoria`). Funciona con y sin la 157 (D7). Batería en Postgres 16 local en transacción descartada: 32/32, 15/15 mutaciones muerden; staging pendiente con el dueño. Rollback: `scripts/sql/160_rollback.sql` |
| 161 | `club_cohortes_ranking` | pase (origen **107**) | `claude/club-cohortes-ranking` | **Aplicada en prod el 15/11 01:24 -06:00** (merge → Branching; era: 14/11: PR en borrador a `main`, espera firma). Sin tablas ni columnas: funciones `club_cohortes_socios(text, uuid)` (owner/manager/contador activos; solo conteos) y `club_ranking_socios(date, date, text, boolean, uuid)` (solo owner/manager activos; nombres sin contactos; descuento estimado con la regla del cambio de lista), más las internas `club_locales_de_reporte(text)` y `club_auditar_lectura(text, text, uuid, jsonb)`. SECURITY DEFINER, `puede_ver_local`, rastro en `club_auditoria` (una fila por apertura de la pantalla y una por exporte). No depende de la 160. Batería en Postgres 16 local en transacción descartada: 45/45, 33/33 mutaciones muerden; staging pendiente con el dueño. Rollback: `scripts/sql/161_rollback.sql` |
| 162 | `club_embudo_anfitrion` | pase (origen **108**) | `claude/club-embudo-anfitrion` | **Aplicada en prod el 15/11 01:31 -06:00** (merge → Branching; era: 14/11: PR en borrador a `main`, espera firma). Sin tablas ni columnas: función `club_embudo_anfitrion(date, text, boolean, uuid)` (solo owner/manager activos; nombres sin contactos; SECURITY DEFINER, `puede_ver_local`) y la interna `club_embudo_auditar_lectura` (rastro en `club_auditoria`: una fila por apertura de la pantalla cada 12 h, el exporte siempre; copia de `club_auditar_lectura` de la 161: unificar cuando las dos estén en `main`). Funciona con y sin la 157 (D7) y la 158 (clic de reseña: se detecta en cada llamada; seguimiento: pasarlo a SQL fijo cuando 158 y 162 estén en prod). No depende de la 160 ni de la 161. Batería en Postgres 16 local en transacción descartada: 37/37 con y sin 157/158, mutaciones 31/31 y 32/32; staging pendiente con el dueño. Rollback: `scripts/sql/162_rollback.sql` |
| 163 | `club_edad_validar_reactivar` | pase (origen **109**) | `claude/club-edad-validar` | **Aplicada en prod el 15/11 01:36 -06:00** (merge → Branching; era: 14/11: PR en borrador apilado sobre el #140, espera firma; va DESPUÉS de la 159). Decisión del dueño (14-nov): el trigger de edad de la 159 también mira el paso a activo del rol de socio (validar o reactivar, cualquier origen); `club_socio_validar_v2` y `club_miembro_guardar_v2` envuelven a las vigentes (sin reescribirlas, siguen abiertas para clientes viejos) y piden/registran la edad si falta, auditada (`socio_mayor_edad`, con la vía). Entra en el MISMO merge que la app. Pruebas: `scripts/sql/163_pruebas.sql` (18 casos; Postgres 16 local sobre 155→156→159: 18/18, 12/12 mutaciones; staging pendiente con el dueño). Rollback: `scripts/sql/163_rollback.sql` |
| 164 | `club_alertas_umbral` | pase (origen **110**) | `claude/club-alertas-umbral` | **Aplicada en prod el 15/11 01:41 -06:00** (merge → Branching; era: 14/11: PR en borrador a `main`, espera OK; vía merge → Branching). SPEC-club-v2 ítem 10 (B6): 5 umbrales por local en `club_config` (solo owner; historial) + `club_alertas_inicio` (Inicio, «Club · Para revisar hoy»). Pruebas: `scripts/sql/164_pruebas.sql` (41 casos + 26 mutaciones, Postgres 16 local con y sin la 157; **staging pendiente con el dueño**). Rollback: `scripts/sql/164_rollback.sql` (borra también la fila 164 del ledger; en prod, la vuelta atrás es una migración nueva hacia adelante: el `.sql` de la 164 se queda en `main`, regla 10) |
| 165 | `admin_bitacora_permisos` | pase (origen **111**) | `claude/admin-bitacora-permisos` | **Aplicada en prod el 15/11 01:46 -06:00** (merge → Branching; era: 14/11: PR en borrador a `main`, espera OK; vía merge → Branching). B10: tabla `bitacora_permisos` solo inserción (nadie la edita ni la borra) + triggers sobre `profiles` (rol, activación) y `profile_locations` (local); lee solo owner. Arranca vacía. Pruebas: `scripts/sql/165_pruebas.sql` (21 casos + 12 mutaciones en una transacción descartada; verde en base local nueva con `local_armar_base.sh` + `--local`, 14/11; **staging pendiente con el dueño**). Rollback: `scripts/sql/165_rollback.sql` |
| 166 | `club_grupo_control` | pase (origen **112**) | `claude/club-grupo-control` | **Aplicada en prod el 15/11 01:51 -06:00** (merge → Branching; era: 14/11: PR en borrador a `main`, espera firma). Tablas `club_campanas` y `club_campana_asignaciones` (RLS sin políticas, sin grants; UPDATE/DELETE/TRUNCATE rechazados por trigger; el grupo lo pone el sorteo fijo md5(semilla:campaña:miembro) en un trigger BEFORE INSERT). Funciones solo owner activo: `club_campana_crear`, `club_campana_sumar_nuevos`, `club_campana_cerrar`, `club_campanas_listar`, `club_campana_lista` (solo el grupo con oferta; con exporte, contacto con optin) y `club_campana_reporte` (los dos grupos a 30 días, venta respaldada neta − regalía, aviso «no concluyente» bajo 30 por grupo). Una campaña ABIERTA por local y fuente (índice único parcial + chequeo; `club_campana_cerrar` explícito, con motivo y auditado). El CSV filtra al exportar (activos hoy, optin de hoy). Batería en Postgres 16 local en transacción descartada: 51/51, 37/37 mutaciones muerden; staging pendiente con el dueño. Rollback: `scripts/sql/166_rollback.sql` (frena si hay campañas reales; borra la fila 166 del ledger) |
| 167 | `club_resena_socios` | pase (origen **113**) | `claude/club-resena-socios` (apilada sobre #177: necesita la 158) | **Aplicada en prod el 15/11 01:55 -06:00** (merge → Branching; era: 14/11: PR en borrador, espera OK). `club_config_global.resena_socio_cada` (5) y `resena_socio_espera_dias` (90); tabla `club_resena_socio` (pedidos sin datos personales); `club_portal` pasa a envolver a `club_portal_datos` (la de antes, 150 o 157) y suma `resena`; función pública nueva `club_portal_resena` (marcas mostrada/cerrada/clic). Va DESPUÉS de la 157 y aborta si falta la 158; vuelta atrás: primero 167, después 157 y 158 (sus rollbacks abortan si la 167 sigue). Prueba local (Postgres 16, con y sin la 157): 21/21 y 14 mutaciones muerden; staging pendiente con el dueño. Rollback: `scripts/sql/167_rollback.sql` |
| 168 | `club_primeros_90` | pase (origen **114**) | `claude/club-primeros-90` | **Aplicada en prod el 15/11 02:02 -06:00** (merge → Branching; era: 14/11: PR en borrador a `main`, **toca plata: espera firma**). Apagado por defecto (`club_config_global.primeros90_activo = false`). Envuelve `club_socio_visita` (→ `club_socio_visita_base`) y `club_pase_datos` (→ `club_pase_datos_base`; necesita la 157 ANTES si entra); `club_portal_avance` nueva (club-web); tabla `club_primeros90` (una por socio). Conteo opción B (`primeros90_exige_factura`, true; **firma del dueño**): días anteriores solo con factura C con 856/857. Vence al final del día CR mostrado. **Orden: #176 (157) antes que #187 (168). PASE al mergear** (`docs/pases/`). Pruebas: `scripts/sql/168_pruebas.py` (22/22 local, con y sin la 157) y `168_concurrencia.sh`. Rollback: `scripts/sql/168_rollback.sql` (aborta si hay cortesías ganadas) |
| 169 | `club_retos` | pase (origen **115**) | `claude/club-retos` | **Aplicada en prod el 15/11 02:08 -06:00** (merge → Branching; era: 14/11: PR en borrador a `main`, **toca plata: espera firma**). Sin ningún reto armado (los arma el owner). Tablas `club_retos` (tope 3 armados por año y sin superposición por local, en un trigger) y `club_retos_ganados` (uno por reto y socio); gana con un trigger AFTER INSERT en `club_visitas_socio` y la caja ofrece con `club_reto_en_visita` (paso aparte): **no toca `club_socio_visita` ni `club_pase_datos`** (convive con la 168 en cualquier orden). `club_portal_retos` nueva (club-web). Opción B (`club_config_global.retos_exige_factura`, true: los días anteriores cuentan solo con factura C con 856/857; no se arma un reto en un local sin PoS), jornada de servicio, vence al final del día CR, una cortesía de premio por factura. Pase: `docs/pases/PASE-169-club-retos.md` (orden con la 168: da igual). Pruebas: `scripts/sql/169_pruebas.py` (24/24 local, con y sin la 168; 24 mutaciones muerden) y `169_concurrencia.sh`. Rollback: `scripts/sql/169_rollback.sql` (aborta si hay premios ganados) |
| 170 | `club_local_manager` | pase (origen **116**) | `claude/club-local-manager` | **Aplicada en prod el 15/11 05:34 -06:00** (merge del #190 → Branching; era: 14/11: PR en borrador a `main`, espera firma). Helpers `club_puede_ver_local(text)` y `club_exigir_local(text)`; 26 funciones `club_*` con `p_location` quedan como envoltorio (la original pasa a `<nombre>__nucleo`, mismo cuerpo, sin EXECUTE para la API): el manager solo en `mis_locales()` (091); owner, contador, cajero, salonero y anon igual que hoy. Batería en Postgres 16 local en transacción descartada: 19/19, 9/9 mutaciones muerden; staging pendiente con el dueño. Guardia en el gate (`supabase/club_local_manager.test.ts`): después de la 170 se cambia el `__nucleo`, no el envoltorio. Rollback: `scripts/sql/170_rollback.sql` |
| 171 | `club_miembro_guardar_reune_156_157` | pase (origen **117**) | `claude/hotfix-miembro-guardar` | **Aplicada en prod el 15/11 05:44 -06:00** (merge del #193 → Branching; era: 14/11: PR en borrador a `main`, espera firma, DESPUÉS de la 158–170). HOTFIX: la 157 redefinió `club_miembro_guardar` desde la versión de la 150 y se perdió lo de la 156 (en prod «Editar» un socio da «Tipo no válido»; socio → anfitrión sin link nuevo). Cuerpo = fusión de tres vías 150/156/157 (md5 `e004268d…`); con la 170 cambia el `__nucleo` (no el envoltorio). Pruebas: `scripts/sql/171_pruebas.sql` (Postgres 16 local con 155→157 y con 158–170: verde + 11 mutaciones; **staging pendiente**). Rollback: `scripts/sql/171_rollback.sql` |
| 172 | `club_local_manager_2` | pase (origen **118**) | `claude/club-local-manager-2` | 15/11: PR en borrador a `main`, **lleva firma: esquema** (vía: merge → Branching; va DESPUÉS de la 170, aborta si falta). Hallazgo 231: 20 funciones más con la receta de la 170 (envoltorio + `<nombre>__nucleo`, sin EXECUTE para la API). Con `p_location`: `club_reporte_equipo`, `club_primeros90_config_ver`; `club_reto_en_visita` por el local de la VISITA. Por id, el local del objeto con `club_exigir_local_de` (nueva; manager solo; objeto inexistente → el «no encontrado» de siempre): miembro (`club_miembro_contacto_ver`, `_codigo`, `_token`, `_regenerar_codigo`, `club_pase_token`, `club_rol_activar_anfitrion`, `club_socio_confirmar`, `club_resolver_miembro`, `club_canje`, `club_canje_aprobado`, `club_tarjeta_manual`), cupón (`club_cupon_usar`), movimiento (`club_canje_aviso`, `club_sin_cruce_candidatas`, `club_sin_cruce_elegir`), pendiente (`club_pendiente_resolver`) y alerta (`club_alerta_revisar`). Owner, contador, cajero y anon igual que hoy. Quedan afuera (listas sin local; PR aparte): `club_buscar`, `club_resolver`, `club_socios_por_confirmar`, `club_socio_solicitudes_abiertas`, `club_retos_listar` y la lectura por RLS. Guardia en el gate (`supabase/club_local_manager.test.ts`): también falla con toda función SECURITY DEFINER con `p_location` y EXECUTE para authenticated que no chequee el local. Batería en Postgres 16 local en transacción descartada: 16/16, 9/9 mutaciones muerden; staging pendiente con el dueño. Rollback: `scripts/sql/172_rollback.sql` (ANTES que el de la 170) |
| 173 | `club_cumple_caja_portal_beneficio` | pase (origen **119**) | `claude/club-cumple-promo` | 15/11: PR #203 en borrador a `main`, **lleva firma: esquema y cortesías** (vía: merge → Branching; necesita la 159 y la 170; con o sin la 172). **ORDEN: el #202 (172) entra ANTES que el #203 (173)** — Branching rechaza un número menor después de uno mayor. Paquete: `docs/pases/PASE-173-club-cumple.md`. Aviso **v1.3** (huellas nuevas; club-web y app en el MISMO merge). Guardia del cumpleaños rehecha: además de la autoalta, carga a quien no lo tiene solo `club_socio_alta_caja_v3` (caja, con permiso) o `club_portal_cumple_agregar` (portal, UNA vez: `club_miembros_contacto.cumple_portal_en`). `club_cumple_config` por local (apagado; owner y manager de su local; OpenTable rid 1347736 por defecto; artículo de CORTESÍA CLUB), `club_cumple_envios` (marca «enviado» por socio y año del cumpleaños), `club_cumple_proximos` / `club_cumple_enviar` (Inicio + WhatsApp, auditado) y `club_cumple_en_caja` (solo socios del local; sin la fecha). Funciones con `p_location` llaman a `club_exigir_local`. Batería en Postgres 16 local en transacción descartada: 20/20 (con y sin la 172), 24/24 mutaciones muerden; staging pendiente con el dueño. Rollback: `scripts/sql/173_rollback.sql` (ANTES que el de la 172/170) |
| 174 | `club_facturas_dia_busqueda` | pase (origen **120**) | `claude/club-facturas-dia-busqueda` | **Sin aplicar** (15/11: PR #206 en borrador a `main`, **lleva firma: esquema**; va **después de la 172 y la 173** (ya en `main` y en prod con #202/#203, `4ba922e`); cambia solo el núcleo de `club_tarjeta_manual`, el envoltorio de la 172 queda). **Solo la tarjeta física** del referente (decisión del dueño, 15-nov, opción A; acotado tras el verificador independiente): su «Factura (plan B)» muestra las cobradas **hoy** (día CR) y se busca por los últimos dígitos del tiquete hasta **3 días CR** atrás (`club_facturas_buscar`, envoltorio + núcleo con la receta de la 170); `club_pos_ref_tarjeta` (interna) acepta esa ventana y el núcleo frena una factura del plan B que ya tiene tarjeta, cupón o personas pendientes. **Cupón, canje y visita de socio: igual que antes** (`club_pos_ref`, `club_visita_control` y `club_facturas_recientes` byte a byte; 2 h 15 min). Batería en Postgres 16 local (base nueva con `main`): 31/31 + 15/15 mutaciones; staging pendiente con el dueño. Paquete: `docs/pases/PASE-174-club-facturas-dia.md`. Rollback: `scripts/sql/174_rollback.sql` |


| Entorno | Ledger (`schema_migrations`) | Detalle |
|---|---|---|
| **PROD** | **85 filas, de 001 a 171** (leído de `schema_migrations` de prod el 15/11 05:50 -06:00, solo lectura); última fila **171** (15/11 05:44 -06:00). Coincide con los 85 archivos de `supabase/migrations/`. La lista de abajo llega solo hasta la 151 (11/11) | `001–008 · 0090 · 0095 · 010–021 · 038–054 · 062–069 · 071–074 · 076–077 · 079–082 · 085 · 089 · 090 · 091 · 092 · 093 · 094 · 095 · 150 · 151` (**092, 093, 094 y 095 el 10/11 22:57:17 -06:00, en UN merge del #107 (`c41e18b`), Branching las aplicó en orden: 12, 7, 3 y 9 statements; pase de la tanda cerrado**; **091 el 10/11 22:44:57 -06:00, Branching al mergear el #103 (`b8cb74d`), 31 statements; pase cerrado 22:51**; **090 el 10/11 11:33:38 -06:00, Branching al mergear el #97 (`7543347`), 4 statements; pase cerrado**; **089 el 10/11 10:22:11 -06:00, Branching al mergear el #90 (`fa1cbef`), 3 statements; pase cerrado**; **085 el 10/11 08:24:48 -06:00, Branching al mergear el #80 (`bb12652`), 9 statements**; **081 y 082 v3 el 09/11, a mano en el pase del puente, antes del merge del #71**; 068 el 05/11 05:30 UTC, SEC-01; 069 el 05/11 15:22 UTC, SEC-01b; 071 el 05/11 19:20 UTC, cierre atómico; 072 y 073 el 05/11 ~20:05 UTC, SEC-03 y SEC-04; 074 el 05/11 20:20 UTC, conteo ciego; **076 y 077 el 06/11 entre 18:03:48 y 18:05:14 UTC**, SoP, una después de la otra — ver abajo; **079 el 06/11 21:22 UTC** y **080 el 07/11**, las dos aplicadas por Branching al mergear). **055–061 NO están en prod** (Salarios/BioTime, solo staging). La 067 se aplicó a mano el 30/10 antes del merge de #15. |
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
