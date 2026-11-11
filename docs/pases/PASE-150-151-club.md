# Pase a PROD del Club Satori: migraciones 150 `club_satori_esquema` (antes 075) y 151 `club_catalogo_locales` (antes 100)

> **Estado: preparado, SIN ejecutar.** Formato del `PASE-089` (`docs/pases/PASE-089-anon-sin-politica.md`, rama
> `claude/anon-default-privs`): qué cambia, lecturas previas, prueba en staging, humo antes y después, vuelta atrás y firma.
>
> **Nada de este documento se ejecuta en prod hasta que el dueño lo firme (§10).** Si algo no coincide con lo que dice
> acá, **se para y se avisa**: no se improvisa en prod.
>
> - **Fecha prevista: jueves 12-nov, por la mañana** (nunca entre las 17:00 y las 23:00 CR). La tarde del mismo día es la
>   prueba interna con el personal (plan: `docs/club-satori/PLAN-ACTIVACION-PILOTO.md` §3).
> - **Orden en prod: 085 → 089 → 090 → 091 → 092 → 093 → 094 → 095 (todas en prod desde el 10-nov noche: ledger 65 · 095) → 150 → 151.** Supabase no
>   aplica una migración con número menor que la última aplicada: el Club va **después** de toda la caja que esté en prod.
>   La 087, la 088 (y cualquier migración de caja que quede después del Club) toman **152+** cuando se arme su paquete.
> - **Regla del ledger (Grok 122):** Branching guarda las migraciones **partidas** en varios statements. La verificación es
>   «exactamente 1 fila con su `name`» más el catálogo (§5). **No se compara md5.**
> - **Una sola vía: merge → Branching** (como la 085 y la 089). No se aplica nada a mano (§2.1 explica por qué no hace falta).

## Qué pasa y qué no
- **Pasa:** el merge del PR #59 (con este paquete adentro) a `main`. Branching aplica, en ese orden y en el mismo push:
  - **150** (`club_satori_esquema`, 6.898 líneas): todo el Club: 38 tablas `club_*` con RLS, sus funciones, las 10
    puertas públicas de club-web para `anon` (todas exigen el header `x-club-web`), la tarea diaria
    `club_socios_mantenimiento` en `pg_cron` y **un trigger en `employees`** (`club_employees_pos_login_guardia_trg`: solo
    el owner cambia el login del PoS o el perfil con login de un empleado, y el cambio queda en un historial).
  - **151** (`club_catalogo_locales`): FK `club_config.location_id → locations(id)` y un trigger `BEFORE INSERT` en
    `club_config` que da de alta el local en el catálogo de caja **inactivo para caja** (si ya existe, lo reutiliza sin
    tocarlo). Repite, igual que la 091, la RLS de `locations` (idempotente).
  - La app publicada trae `/club` (pantallas del Club) y club-web se construye desde `main`.
- **No pasa:**
  - **no hay ningún local del Club**: la 150 no trae locales (multilocal genérico). Hasta el alta de §6.1 nadie puede operar
    el Club, y en §6.1 los locales se crean **apagados**;
  - no cambia nada de caja, propinas, ventas ni SoP: las tablas y políticas de caja no se tocan. Lo único fuera de `club_*`
    es el trigger de `employees` (arriba) y las filas que la 151 agrega a `locations` cuando se da de alta un local;
  - no carga saldos ni socios (eso es la carga única del lanzamiento, §6.5, con su propio gate G-56);
  - no enciende club-web para el público hasta que se cargue la clave (§6.3) y el dominio apunte al proyecto.

## SHA y huellas
| Qué | Valor |
|---|---|
| Rama del paquete | `claude/pase-club` (PR contra el #59, `claude/epic-tesla-pyo77m` @ `fd39819`) |
| 150 | `supabase/migrations/150_club_satori_esquema.sql`: la 075 renombrada (10-nov mañana, blob `cf16b82b…`) **más los arreglos de la auditoría del 10-nov** (Grok 159, 160, 182 y la condición de MAINTAIN) y de la segunda vuelta (Grok 162–164). Hoy: blob git `44d12e03aa1cd170dfca1b0e9f263a25a9571355`, md5 `04681f41e4861972134b6f46b4132f87`, 427.895 bytes |
| 151 | `supabase/migrations/151_club_catalogo_locales.sql`: renombre puro de la 100 (blob `a61d7d4f2b73b0cacac5d000fa0b0323d7bfb76c`), md5 `7a27ab08ee4a292a8ac255ecfae612c9` |
| Rollbacks | `scripts/sql/151_rollback.sql` (FK y trigger; no toca `locations`) y `scripts/sql/150_rollback.sql` (todo `club_*`; desde el 10-nov se verifica solo: aborta si queda algo) |
| Pruebas | `scripts/sql/150_pruebas_staging.sql` (batería, 5 tramos, 623 casos, `bateria_club.py`) y `scripts/sql/151_pruebas.sql` (12 casos, `151_pruebas.py`) |
| Registro | `supabase/migraciones-reservadas.json`: 150 y 151 en el bloque `pase`, con `origen` 075 y 100 |

Los md5 sirven para comprobar el archivo, **no** para el ledger de prod (Grok 122).

**Nombres viejos → nuevos** (los documentos anteriores al 10-nov dicen los viejos): `075_club_satori_esquema.sql` → `150_…`,
`075_rollback.sql` → `150_rollback.sql`, `075_pruebas_staging.sql` → `150_pruebas_staging.sql`,
`100_club_catalogo_locales.sql` → `151_…`, `100_rollback.sql` → `151_rollback.sql`, `100_pruebas.sql` → `151_pruebas.sql`.

## Responsables
- **Ejecución:** el dueño. Firma, lee el catálogo de prod en el editor SQL, mergea (o autoriza el merge), corre la prueba
  de humo y carga los datos de §6.
- **Control:** el encargado del turno. Lee en voz alta cada resultado esperado contra el obtenido. No es la misma persona.
- **Claude no corre nada en prod.** Prepara, revisa y lee los resultados que le pasan (incluido el CSV del catálogo de §1.5).

## 0. Prerrequisitos
| # | Qué | Cómo se verifica |
|---|---|---|
| 0.1 | Firma del dueño en §10, con el SHA de la cabeza del #59 que se mergea | firma |
| 0.2 | Los dos responsables presentes | §10 |
| 0.3 | **No se mergea entre las 17:00 y las 23:00 CR**; ninguna otra sesión mergeando a `main` en la ventana | hora en §10 |
| 0.4 | **✅ Cumplido (10-nov noche, lo informó el dueño):** la **091** en prod (merge `b8cb74d`, pase cerrado) y la tanda **092–095** (merge `c41e18b`). **Ledger de prod: 65 · 095.** La 151 se apoya en el `locations` de la 091. El día del pase se vuelve a leer en 1.1: tiene que seguir en **65 · 095**. Ninguna migración con número de 096 a 149 ni ≥ 150 en `main` ni en el ledger (si caja pasa otra antes del jueves, se para y se rehace §1 con el número nuevo) | 1.1 |
| 0.5 | El paquete (este PR) y el plan B de club-web (#98, el Worker, con el binding activo) mergeados en el #59 (el #98 **antes del miércoles**, para crear el Worker), y el #59 **al día con `main`** (con la 089–093 adentro): el diff del #59 contra `main` tiene solo lo del Club (§2.2) | `git merge-base --is-ancestor`, `git diff --name-only` |
| 0.6 | Checks del #59 en verde: `supabase/migraciones.test.ts` (150 y 151 registradas con su origen), vitest y build | checks del PR |
| 0.7 | Staging en verde con estos mismos archivos (§3), **el día del pase** | anotado |
| 0.8 | **✅ Cumplido (11-nov).** Pages `satori-club` (rama de producción `main`, sin previews, variables de §11.1) y **Turnstile de prod** (10-nov); el dominio queda en **SiteGround** (CNAME `club` → `satori-club.pages.dev`, §11.2). **Worker `satori-club-api`** desplegado **a mano** con `wrangler deploy` desde el #59 @ `66c950d` (Version `ae142f3a…`), **sin** rutas ni `workers.dev` ni repositorio conectado, con `RL_CREAR` y `RL_LEER` y sus 4 variables apuntando a **prod** (`SUPABASE_URL`, `SUPABASE_ANON_KEY`; `TURNSTILE_SECRET` y `CLUB_WEB_KEY` como Secret). **`CLUB_WEB_KEY` de prod creada el 11-nov y cargada en el Worker y en Pages**; su sha256 lo tiene el dueño y va a la base el jueves, **después de la 150** (§6.3 paso 2). Ningún valor en este documento. **Falta una cosa (§11.4 paso 4b):** volver a desplegar el Worker, a mano, desde la **cabeza nueva del #59** (la que se firma): el #93 cambió `club-web/functions/_lib/api.js` (la baja por POST, Grok 183), y el Worker corre ese código | §10 |
| 0.9 | G-61 «antes» hecho y sus diferencias esperadas **firmadas en este PR** (`scripts/sql/gate61_esperadas.txt`) | §1.5 |
| 0.10 | **✅ Cumplido (11-nov, firmado a las 10:14).** `carga.sql` sha256 **`150f0c8e5ba0de07369bd42f0e52866aa905628549c40696c58ae6817d6b461f`**, emitido con el código de `d6c117b` desde el export final del 10-nov 15:46; esperados de los restos firmados **115 / 174** (`vencimientos_restos` / `vencimientos_restos_personas`, Grok 171); sin papel; ensayo en staging OK (`guardado: false`). Los archivos, fuera del repo. Se aplica el jueves con `aplicar-firmado`, sobre la base del Club **vacía** y antes de la prueba interna (§6.5) | §10 |
| 0.11 | **✅ Cumplido.** El agente nuevo del puente (#83) en prod (11-nov). Era recomendado, no bloqueaba | anotado |

## 1. Lecturas previas (SOLO LECTURA, en PROD)
Editor SQL de PROD. **Leer el ref en pantalla.** Anotar cada resultado en §10.
```sql
-- 1.1 ledger: igual que después del pase de caja del 10-nov (65 · 095) y nada del Club
select count(*), max(version) from supabase_migrations.schema_migrations;                         -- 65 · 095
select version, name from supabase_migrations.schema_migrations
 where version between '096' and '149' or version >= '150'
    or name in ('club_satori_esquema', 'club_catalogo_locales') or version in ('075', '100');      -- 0 filas
select version from supabase_migrations.schema_migrations where version between '089' and '095' order by 1;  -- 089 090 091 092 093 094 095

-- 1.2 no hay ningún objeto del Club en prod
begin read only;
select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname like 'club\_%') as relaciones,
       (select count(*) from pg_proc  where pronamespace = 'public'::regnamespace and proname like 'club\_%') as funciones,
       (select count(*) from pg_trigger where not tgisinternal and tgname like 'club\_%') as triggers;
rollback;
-- esperado: 0 · 0 · 0
```
```sql
-- 1.3 lo que la 150 y la 151 necesitan de prod
begin read only;
select position('is_active' in pg_get_functiondef('public.get_my_role()'::regprocedure)) > 0           as get_my_role_069,
       to_regclass('public.locations') is not null                                                    as locations_091,
       (select is_active from public.locations where id = 'santa-teresa')                             as santa_teresa_activa,
       -- (nota de Grok, 10-nov) las políticas de locations se comparan por DEFINICIÓN, no solo por nombre: las de la 091
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'locations' and permissive = 'PERMISSIVE'
          and roles = array['authenticated']::name[] and (
              (policyname = 'locations_select_activos' and cmd = 'SELECT'
                 and qual = '(get_my_role() IS NOT NULL)' and with_check is null)
           or (policyname = 'locations_write_owner' and cmd = 'ALL'
                 and qual = '(get_my_role() = ''owner''::user_role)'
                 and with_check = '(get_my_role() = ''owner''::user_role)')))                         as politicas_091_iguales,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'locations')     as politicas_locations_total,
       has_table_privilege('anon', 'public.locations', 'SELECT')                                      as anon_lee_locations,
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'employees'
                 and column_name = 'pos_login')                                                       as employees_pos_login,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'pos_ndf_tickets'
          and column_name in ('mesa_factura', 'consecutivo_fe', 'clave_fe'))                          as columnas_081,
       to_regprocedure('public.pos_ndf_ingestar(text, jsonb, jsonb, jsonb, jsonb)') is not null       as ingestar_082,
       (select extversion from pg_extension where extname = 'pgcrypto')                               as pgcrypto,
       (select extversion from pg_extension where extname = 'pg_cron')                                as pg_cron;
rollback;
-- esperado: true · true · true · 2 · 2 · false · true · 3 · true · ≥ 1.3 · ≥ 1.4
```
- **`politicas_091_iguales` distinto de 2, o `politicas_locations_total` distinto de 2:** prod tiene otra RLS en
  `locations` que la de la 091 (la 151 la reescribe con los mismos nombres, pero no borra otras). **Se para** y se anota
  cada política (`select policyname, cmd, roles, qual, with_check from pg_policies where tablename = 'locations'`).
  En staging hay 4: las 2 de la 091 y `pos_locations_select` / `pos_locations_write` de la 022 (PoS propio, solo staging).
- **`pg_cron` vacío (null):** la 150 no programa la tarea diaria de socios. Se anota y **se para**: sin ella las altas
  provisionales no vuelven a pendiente y las autoaltas no se purgan. Se decide con el dueño antes de seguir.

**1.4 Respaldo** (solo lectura): export de `employees`, `profiles` y `locations` desde el panel (Table editor → Export to
CSV). Son las tablas fuera del Club que el pase toca (un trigger y filas nuevas del catálogo).
- **(Grok 154) `employees` y `profiles` tienen datos personales** (nombres, correos, logins). Los tres CSV se guardan
  **cifrados** apenas se bajan (un `.zip` con cifrado AES-256 o un volumen cifrado), con la contraseña en el gestor de
  contraseñas del dueño, en una carpeta a la que **solo accede el dueño**. Nunca en el repo, el chat, un correo, una carpeta
  compartida ni la PC del PoS. Se borra la copia sin cifrar de Descargas.
- **Fecha de borrado:** el día 7 después del pase si no hubo vuelta atrás, o el día que se cierre la vuelta atrás. En §10
  se anota dónde quedó (sin la contraseña), el sha256 del archivo cifrado y la fecha de borrado; el día del borrado, que
  se borró.

**1.5 G-61 «antes» (mié 11, después de la caja que pase antes del Club; se repite el día del pase):**
1. En el editor SQL de PROD: pegar `scripts/sql/gate61_catalogo.sql` entero entre `begin read only;` y `rollback;`, correrlo y
   **Download CSV**. Sale una fila con una columna `cat` (unos 3.000–3.700 hechos: nombres de objetos, roles y md5; **sin
   datos de personas**).
2. Pasarle el CSV a Claude, que **no lee prod**: lo convierte (`python3 -I scripts/sql/gate61_desde_csv.py prod.csv prod.txt`)
   y lo compara con staging.
3. **Antes del pase, prod no tiene el Club:** lo que importa son los hechos de afuera (`grep -v club_`): privilegios por
   defecto, extensiones, roles, `user_role`, `get_my_role`, triggers de `auth.users`, columnas de `profiles`, `employees` y
   `pos_ndf_*`, y las políticas que dependen de `get_my_role`. Cada diferencia se explica por su origen. **Las que ya se
   saben** (staging tiene cosas que prod no):
   - columnas de Salarios en `employees` (055–061 y 084, solo staging): `cuenta_iban_alias`, `fecha_ingreso`,
     `fixed_salary_crc`, `hora_entrada_habitual`, `hora_salida_habitual`, `hourly_rate_crc`, `nombre_homebanking` y
     `participa_servicio`;
   - políticas de tablas que solo existen en staging (PoS propio 022–024, Salarios 055–061 y 084, la 070 y la 083), con su
     dependencia de `get_my_role`; entre ellas `pos_locations_select` y `pos_locations_write` sobre `locations` (022);
   - la 089–095 están en staging y en prod (10-nov): lo que cambian **no** debería aparecer como diferencia. Si aparece
     (por ejemplo, una versión de la 094 o la 095 aplicada en staging antes de su último cambio), se explica por su
     origen antes de firmar.
4. Las diferencias que tienen explicación van a `scripts/sql/gate61_esperadas.txt` con su motivo y la firma, **en este PR**
   (lo revisa el dueño). Una diferencia **sin** explicación **para** el pase hasta entenderla.

Más la **prueba de humo de antes** (§4).

**Para (no se sigue)** si:
- el ledger no da **65 · 095** (otra migración de caja entró después del 10-nov, o falta una), o ya tiene algo del Club;
- 1.2 no da 0 · 0 · 0;
- 1.3 da distinto (en particular, sin `locations` o sin `santa-teresa` activa: **la 091 no está**);
- el G-61 «antes» tiene una diferencia sin explicación.

## 2. El cambio: merge del #59 → Supabase Branching aplica la 150 y la 151

### 2.1 Por qué no se aplica nada a mano
La pregunta es si algo tiene que pasar **entre** la 150 y la 151 (un dato que la 151 necesite y la 150 no traiga). **No:**
- la 150 no crea ningún local, así que la 151 no tiene nada que pasar al catálogo;
- la 151 solo agrega la FK y el trigger, y repite la RLS de `locations` que ya puso la 091;
- el alta de los locales (§6.1), la clave de club-web (§6.3) y la carga única (§6.5) van **después** de las dos, y
  necesitan las dos.

Por eso las dos entran con el merge, como la 085 y la 089: **no hay filas de ledger a mano** y Branching no tiene nada que
«saltear». Si el día del pase apareciera una razón para aplicar a mano, se para: el paquete se rehace con la fila exacta
del ledger y la prueba de que el próximo push no la vuelve a aplicar.

### 2.2 Qué se mergea
- El #59 trae el Club entero: las dos migraciones con sus rollbacks y pruebas; `src/modules/club/` y
  `src/shared/api/club.ts`; `club-web/`; `scripts/club/` y `scripts/sql/`; los documentos del Club y de `docs/sop-app/`;
  el registro (`migraciones-reservadas.json` y `ESTADO.md`). Fuera del Club: la ruta `/club` en `src/App.tsx`, su acceso en
  `src/pages/HomePage.tsx`, la dependencia `jsqr` (lector de QR de la caja) en `package.json`, `index.html` y dos pruebas
  del repo (`src/refProdEnPruebas.test.ts`, `src/dominioRepo.test.ts`).
- **Merge commit**, con la firma de §10. Anotar el SHA y la hora (`-06:00`).
- Branching aplica las dos en el mismo push, cada una en su transacción. Si la 150 aborta, no queda nada a medias y la
  151 no se intenta. Si la 151 aborta, la 150 queda aplicada: §8.2.

## 3. Prueba en staging (10-nov)
**Staging quedó igual que va a quedar prod** (10-nov 11:40 CR, con el OK del dueño, después de que caja confirmó la 091 →
095 en staging). Una transacción con precondición (fila 075 única, ninguna 100/150/151, la 091 con sus 2 políticas de
`locations`, sin la FK) y verificación final (md5 de las filas = archivos, FK validada, trigger presente):
- la fila **075** pasó a **150** con el texto exacto del archivo (antes tenía una versión vieja: 90.708 caracteres contra
  416.138 bytes; el catálogo ya coincidía, por la paridad);
- se aplicó la **151** y se registró su fila.
- **Ledger de staging: 91 filas, última 151** (antes 90 · 095). Filas 150 y 151 con md5 `5da6a357…` y `7a27ab08…`, iguales
  a los archivos.

Todo lo demás, en transacciones descartadas:

| Cuándo | Qué | Resultado |
|---|---|---|
| 10-nov | Batería del Club (`150_pruebas_staging.sql`, 5 tramos, con el #59 consolidado y `main` adentro) | **597/597** (tramos de 4,5 a 9,2 s) |
| 10-nov | Paridad: catálogo `club_*` de staging contra la 150 aplicada desde cero | **977 = 977**, sin diferencias |
| 10-nov | `151_pruebas.sql` sobre staging (la 151 en una transacción descartada) | **8/8** |
| 10-nov | **150 → 151 desde cero** (rollback de la 150, la 150, la 151 y sus 8 casos, en una transacción descartada) | **8/8** |
| 10-nov | **Vuelta atrás:** 150 → 151 → un local de prueba → `151_rollback` → fila 151 → `150_rollback` | **0 objetos `club_*`**, 0 triggers del Club en otras tablas, 0 tareas de `pg_cron`; `locations` conserva sus filas |
| 10-nov | El `150_rollback` anterior con la guarda nueva | **aborta**: dejaba 3 tablas y 2 secuencias (corregido en este PR) |
| 10-nov | `gate61.sh` staging contra staging; `gate61_staging_con_151.sh` (antes de aplicar la 151) | 0 diferencias (3.701 hechos); con la 151: 3.714 (los 13 hechos de la 151) |
| 10-nov, con la 150 y la 151 en staging | Batería (`bateria_club.py --esperado 597`, con un conteo por tramo, Grok 153) | **597/597** (107 · 225 · 72 · 17 · 176) |
| ídem | Paridad: staging contra la 150 **y la 151** aplicadas desde cero | **980 = 980** |
| ídem | Vuelta atrás contra staging: `151_rollback` → fila 151 → `150_rollback` (con el desprogramado de `pg_cron` adentro, Grok 150) | **0** objetos del Club, 0 tareas `club_*` de `pg_cron`, 0 filas 150/151; `locations` intacta |
| ídem | Lo mismo **sin** el desprogramado (falla sin el arreglo) | **aborta**: «queda: cron.job club_socios_mantenimiento» |
| ídem | Mutaciones S2 y 136 | caen 1 y 4, como antes |
| 10-nov | `gate61_test.sh` (sin red) · `migraciones.test.ts` · vitest | 25/25 · 6/6 · 1526 |

Desde ahora el G-61 se corre con `gate61.sh` tal cual (staging ya tiene la 151; `gate61_staging_con_151.sh` se niega).

**Auditoría del 10-nov (partes A y B): arreglos en la 150, probados sin escribir en staging.** Staging tiene la 150 del
mediodía. La 150 nueva se probó **aplicada encima, dentro de la transacción descartada** de cada tramo
(`bateria_club.py --antes`, `mutar_bateria.py --antes`, `club_paridad.sh --antes`):

| Qué | Resultado |
|---|---|
| Batería con la 150 nueva (`--esperado 613`: 108 · 225 · 72 · 17 · 191) | **613/613** |
| Paridad: staging + la 150 nueva encima contra la 150 + 151 desde cero | **992 = 992** |
| Mutaciones 160 (sin el trigger), 159 (replay viejo) y 182 (contacto viejo) | caen **6**, **1** y **3** |
| `mutar_bateria.py` con una mutación que no muerde o sin ancla | sale **1** (Grok 161) |
| `151_pruebas.py` (Grok 180: control positivo del owner, INSERT y DELETE del cajero, RLS encendida) | **12/12** |

**Staging alineado con la 150 nueva (10-nov tarde, con el OK del dueño).** Una transacción con precondición (91 filas,
filas 150 y 151 únicas, md5 de la fila 150 = `5da6a357…`, el del mediodía): la 150 entera encima (idempotente) y la
fila 150 con el texto nuevo; verificación final dentro de la misma transacción. Resultado: **ledger de staging 91 filas,
última 151**; fila 150 md5 **`919bcd5473fb68cc84dfdb5af28e5b98`** (= el archivo) y fila 151 `7a27ab08…` (sin cambios).
Después, **sin `--antes`**:

| Qué | Resultado |
|---|---|
| Batería (`bateria_club.py --esperado 613`) | **613/613** (tramos de 5,7 · 6,2 · 6,6 · 6,0 · 9,2 s) |
| Paridad (`club_paridad.sh`): staging contra la 150 + 151 desde cero | **992 = 992**, sin diferencias |
| `151_pruebas.py` | **12/12** |
| `gate61.sh` staging contra staging | **0** diferencias (3.765 hechos) |

Desde ahora la batería, la paridad y las mutaciones se corren **sin** `--antes`.

**Segunda vuelta de la auditoría (Grok 162–164), aplicada en staging el 10-nov 18:10 CR** (autorizado por el dueño), de la
misma forma: precondición (91 filas, última 151, fila 150 = `919bcd54…`, fila 151 única), la 150 entera encima y la fila
150 con el texto nuevo, verificación dentro de la transacción (md5, trigger, las funciones con 162 y 163). Resultado:
**91 filas, última 151**; fila 150 md5 **`04681f41e4861972134b6f46b4132f87`** (= el archivo); fila 151 `7a27ab08…`.
Después, sin `--antes`:

| Qué | Resultado |
|---|---|
| Batería (`--esperado 623`: 108 · 225 · 72 · 17 · 201), con la 93 (MAINTAIN) y la 95 (162–164) | **623/623** |
| Paridad (`club_paridad.sh`, catálogo con ACL ordenadas) | **992 = 992** |
| `151_pruebas.py` | **12/12** |
| `gate61.sh` staging contra staging | **0** diferencias (3.765 hechos) |
| Migrador (`test_migrar_firestore`, `test_saldos_papel`, `test_sql_g56`; ensayos en staging con ROLLBACK) | **132** (1 omitida: la de prod) |
| Mutaciones 162 y 163 | caen **4** y **1** |
| Las 14 mutaciones de `mutaciones_r7.json` (`mutar_bateria.py`, Grok 161) | **14 muerden · 0 con problema** (S0b y 160 caen 11 cada una: las tarjetas de la puesta a punto de la 92 y la 94 ahora se atrapan) |

**La caja de staging es la misma que la de prod (10-nov noche, lectura).** Las filas 089–095 del ledger de staging tienen el
mismo md5 que los archivos de `main` (`88ecdc81` · `53aa0e0a` · `1838dd21` · `03f2dfed` · `d5b5173c` · `bfa5a786` ·
`a8959a18`), que son las que entraron a prod (091 por `b8cb74d`; 092–095 por `c41e18b`). Todas las pruebas del Club de
arriba corrieron sobre esa caja: el pase de la 091–095 no cambia nada de la 150 ni de la 151.

## 4. Prueba de humo en PROD (SOLO LECTURA: `begin read only` … `rollback`)
Se corre **antes** del merge y **después** (§5.5).

**4a. `anon` (sin sesión):**
```sql
begin read only;
select (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'club\_%'
          and has_function_privilege('anon', p.oid, 'EXECUTE'))                                 as anon_club_ejecuta,
       (select string_agg(p.proname, ', ' order by p.proname) from pg_proc p
         where p.pronamespace = 'public'::regnamespace and p.proname like 'club\_%'
           and has_function_privilege('anon', p.oid, 'EXECUTE'))                                as cuales,
       (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname like 'club\_%'
          and c.relkind in ('r', 'v') and has_table_privilege('anon', c.oid, 'SELECT'))         as anon_club_lee;
rollback;
```
- **Antes:** `0` · `null` · `0`.
- **Después:** **`10`** · `club_canje_codigo_generar, club_canje_codigo_generar_pase, club_cupon_contacto,
  club_cupon_contacto_baja, club_cupon_crear, club_cupon_ver, club_locales_activos, club_portal, club_socio_autoalta,
  club_socio_baja_portal` · **`0`**.

**4b. Cuentas con sesión: no cambian.** La consulta 4b del PASE-085 (`docs/pases/PASE-085-rls-lectura-rol-activo.md`:
owner, manager, cajero, contador y salonero, solo conteos) dentro de `begin read only`. **Regla: después = antes**, con la
misma excepción de `base` que en el PASE-085.

**4c. Pantallas:** con sesión de owner, Caja, Propinas, Ventas, Admin → Empleados (abrir un empleado, **sin guardar**) y
SoP: nada nuevo en rojo. **Después**, además: la app muestra el acceso al Club; Club → Locales dice que no hay locales.

## 5. Verificación después del merge
1. **Branching:** «Supabase Preview» del merge commit en `success`; en el log, `Applying migration
   150_club_satori_esquema.sql` y después `151_club_catalogo_locales.sql`.
2. **Ledger** (solo lectura): **exactamente 1 fila de cada una, con su `name`**. No se compara md5.
   ```sql
   select count(*), max(version) from supabase_migrations.schema_migrations;                      -- 67 · 151 (65 + 2)
   select version, name, array_length(statements, 1) as statements
     from supabase_migrations.schema_migrations where version in ('150', '151') order by 1;
   -- 150 · club_satori_esquema · (anotar) ; 151 · club_catalogo_locales · (anotar)
   ```
3. **Catálogo** (solo lectura):
   ```sql
   begin read only;
   select (select count(*) from public.club_config)                                               as locales,          -- 0
          (select count(*) from public.club_config_global)                                        as fila_global,      -- 1
          (select count(*) from public.club_entorno)                                              as marca_staging,    -- 0 (¡prod no es staging!)
          (select convalidated from pg_constraint where conname = 'club_config_location_fk')      as fk_151,           -- true
          (select count(*) from pg_trigger where tgname = 'club_config_catalogo_trg')             as trigger_151,      -- 1
          (select count(*) from pg_trigger where tgname = 'club_employees_pos_login_guardia_trg') as trigger_employees,-- 1
          (select schedule from cron.job where jobname = 'club_socios_mantenimiento')             as tarea_diaria,     -- 15 9 * * *
          has_table_privilege('authenticated', 'public.club_miembros_contacto', 'SELECT')         as lee_contactos,    -- false
          has_table_privilege('authenticated', 'public.club_cupones_contactos', 'SELECT')         as lee_contactos_tur,-- false
          (select is_active from public.locations where id = 'santa-teresa')                      as caja_intacta,     -- true
          (select count(*) from pg_trigger where tgname = 'club_factura_r_anulada_trg')           as trigger_160,      -- 1
          (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','m')
             and (c.relname like 'club\_%' or c.relname = 'locations')
             and has_table_privilege('authenticated', c.oid, 'MAINTAIN'))                           as con_maintain;     -- 0
   rollback;
   ```
4. **G-61 después** (bloquea la prueba interna): el dueño vuelve a bajar el CSV del catálogo (§1.5, paso 1). Claude:
   `gate61_desde_csv.py`, el lado staging con `gate61.sh` (staging ya tiene la 150 y la 151) y
   `bash scripts/sql/gate61.sh --archivos staging.txt prod.txt --modo-prod` con las esperadas firmadas de §1.5.
   **Tiene que salir 0.**
5. **Humo:** 4a con los valores de «Después», 4b igual que antes y 4c sin rojos.

## 6. Configuración del local (datos; después de §5, el mismo jueves)
Todo es dato: se carga en la app (owner) o en el editor SQL de prod. **El orden importa:** alta → dominio y clave → valores
del local → carga única → encender en la prueba interna.

**6.1 Alta de los locales, los dos APAGADOS.** El RUNBOOK daba de alta Santa Teresa encendido; ahora no: se enciende en la
prueba interna (§6.6), así nadie opera antes.
```sql
insert into public.club_config (location_id, nombre, direccion, mapa_url, club_activo) values
  ('santa-teresa', 'Santa Teresa', 'Santa Teresa, Puntarenas, Costa Rica', 'https://maps.google.com/?q=Satori+Sushi+Bar+Santa+Teresa+Costa+Rica', false),
  ('nosara',       'Nosara',       null, null, false);
select location_id, club_activo from public.club_config order by 1;                               -- 2 filas, las dos false
select id, is_active from public.locations order by 1;   -- santa-teresa true (la de caja, sin tocar) · nosara false (la creó la 151)
```
Cada alta siembra sus marcadores de descuento (856 y 857) y la promoción «Local Club» en borrador.

**6.2 Dominio del Club:** `update public.club_config_global set club_url = 'https://club.satoricostarica.com';`
(el mismo de `VITE_CLUB_URL` de club-web). Verificar: `select club_url from public.club_config_global;`.

**6.3 Clave de club-web (la clave ya está en Pages y en el Worker desde el 11-nov; hoy va su sha256 a la base):**
1. ✅ (11-nov) El dueño generó la clave **nueva de prod** en su PC (nunca la de staging) y la cargó como **Secret**
   `CLUB_WEB_KEY` en Pages `satori-club` (producción) y en el Worker `satori-club-api`. **Nunca por chat.**
2. En el editor SQL de prod: `select public.club_web_clave_cargar('<sha256 de la clave>');` (el sha256, nunca la clave).
3. Volver a desplegar `satori-club` (los Secrets toman efecto en el próximo deploy).
4. **Plan B (activo desde el merge, §11.4 paso 6):** ✅ la misma clave ya está como Secret `CLUB_WEB_KEY` del Worker
   `satori-club-api` (11-nov). En Pages queda igual, para poder volver al plan A sin esperar.

Verificar: `/api/salud` → todo en `true` (`club_web_key` y `turnstile` incluidos). Una llamada directa a
`/rest/v1/rpc/club_cupon_crear` con la anon key y sin el header responde «Código no válido».

**6.4 Valores del local: decisiones del dueño (10-nov).**

| Valor | Dónde | Decisión | Por defecto en la 150 |
|---|---|---|---|
| `socio_visitas_por_dia` | `club_config_global` (único para todo el Club) | **1** | 1 (se confirma, no se cambia) |
| `socio_visitas_semana_max` | `club_config` de Santa Teresa | **7** | 5 |
| `anfitrion_tope_mes_crc` | `club_config` de Santa Teresa | **150000** | 25000 |
| Los otros topes (`socios_por_factura`, `cupones_max_dia_referente`, `cupones_max_minuto_local`, `socio_autoalta_max_dia`, `buscar_tope_minuto`) y los valores del crédito | `club_config` | **los de la migración** | 1 · 30 · 20 · 60 · 30 · ₡18.000 cada 6 personas |
| `lc_excepciones_desde` | `club_config` de Santa Teresa | **Provisorio: `2026-11-12`** (el día de la prueba interna; decisión del dueño, 10-nov), para que la revisión del vie 13 vea las excepciones de la prueba. **El día de la apertura a clientes** (vie 13 o lun 16) se cambia a esa fecha, antes de abrir | vacío |
| Cortesías del sorteo | Club → Promociones (datos) | **abiertas**: las carga el dueño cuando las defina. Con **una activa** alcanza para encender | — |
| `pos_login` de los empleados | Admin → Empleados | **ya están cargados**: no se carga nada (solo se verifica) | — |
| Códigos del PoS y sección de cortesías | `club_config` | 856 (LOCAL CLUB), 857 (INVITADO), 1123 (PROMO CLUB 10 %); cortesías 17 / 40 | 856 · 857 · — |
| Aviso de privacidad | `club_config.aviso_privacidad_version` | el de club-web: `v1.1` | `v1.1` |
| Retención de contactos de ofertas | `club_config_global.contactos_ofertas_meses` | 24 (09-nov) | 24 |
| Tarjeta física | `club_config.tarjeta_manual_activa` | apagada | false |

```sql
update public.club_config set socio_visitas_semana_max = 7, anfitrion_tope_mes_crc = 150000,
                              promo_articulo_codigo = '1123', cortesia_familia = 17, cortesia_subclasificacion = 40,
                              lc_excepciones_desde = '2026-11-12'   -- PROVISORIO: el día de la prueba interna
 where location_id = 'santa-teresa';
-- verificar (anotar en §10)
select g.socio_visitas_por_dia, g.contactos_ofertas_meses, c.socio_visitas_semana_max, c.anfitrion_tope_mes_crc,
       c.socios_por_factura, c.cupones_max_dia_referente, c.cupones_max_minuto_local, c.socio_autoalta_max_dia,
       c.buscar_tope_minuto, c.valor_credito_crc, c.personas_por_credito, c.lc_articulo_codigo, c.lc_invitado_codigo,
       c.promo_articulo_codigo, c.cortesia_familia, c.cortesia_subclasificacion, c.aviso_privacidad_version,
       c.tarjeta_manual_activa, c.lc_excepciones_desde, c.club_activo
  from public.club_config c cross join public.club_config_global g where c.location_id = 'santa-teresa';
-- 1 · 24 · 7 · 150000 · 1 · 30 · 20 · 60 · 30 · 18000 · 6 · 856 · 857 · 1123 · 17 · 40 · v1.1 · false · 2026-11-12 · false
select count(*) filter (where pos_login is not null) as con_login, count(*) as activos
  from public.employees where is_active;                                                          -- anotar
```
- **`lc_excepciones_desde`, el día de la apertura** (antes de abrir): `update public.club_config set lc_excepciones_desde =
  '<día de la apertura>' where location_id = 'santa-teresa';`. Desde ahí, las excepciones del Local Club cuentan solo desde
  la apertura y lo de la prueba interna deja de aparecer (ya se revisó el vie 13). **Nunca vacío:** vacío, las excepciones
  del Local Club miran todo el historial (en staging: 275 `LC_SIN_REGISTRO` en 120 días).

**6.5 Carga única del lanzamiento** (Firestore + papel; G-56), **antes de encender**: exige la base del Club **vacía**
(«cero socios»), y la prueba interna ya crea socios. Procedimiento: RUNBOOK §8 y `docs/club-satori/piloto/saldos-papel.md`
§A (`migrar_firestore.py aplicar-firmado` con el sha256 firmado; con restos vencidos, el dueño firma también `vencimientos_restos` y `vencimientos_restos_personas`, que van en `--esperados` dentro del `carga.sql`, Grok 171). Si los datos no están el jueves, la prueba interna se hace
sin ellos y la carga se replanifica con firma (el migrador frena con la base no vacía).

**6.6 Encender Santa Teresa: en la prueba interna** (jue 12 por la tarde, antes del servicio). Owner → Club → Locales →
**Encender**. Antes: una cortesía activa (§6.4), §5.4 en 0 y `/api/salud` en verde. Nosara queda apagado.
- **`lc_excepciones_desde` = `2026-11-12`** (provisorio, cargado en §6.4): la revisión del vie 13 ve las excepciones del
  Local Club de la prueba y nada de antes. Se cambia al día de la apertura cuando se abra (§6.4).

## 7. Criterios de parada → vuelta atrás (§8)
- Branching en error (`MIGRATIONS_FAILED`) o aplicando otra cosa que la 150 y la 151.
- §5.2 sin exactamente 1 fila 150 y 1 fila 151 con su `name`.
- §5.3 distinto de lo esperado; en particular `marca_staging` distinto de 0 o `anon_club_lee` distinto de 0.
- §5.4 (G-61) distinto de 0.
- 4a distinto de «Después», 4b distinto de antes, o 4c con una pantalla de caja rota.

## 8. Vuelta atrás (todo en la misma ventana; nadie más pushea a `main`)
**Mientras no haya actividad del Club** (antes de §6.5 y de encender un local). Con actividad **no se borra nada**: §8.4.

**8.1 La 150 abortó** (Branching en error, ledger sin 150): se corre **1.2 otra vez** (Grok 151).
- **Da `0 · 0 · 0`:** no quedó nada en la base. Revert del merge en `main` y avisar.
- **Da otra cosa: se para.** Algo quedó a medias aunque el ledger no lo diga. No se hace el revert ni ningún rollback hasta
  entender qué quedó: se anota la salida de 1.2 y se avisa.

**8.2 La 150 entró y la 151 abortó:** en prod, UN bloque:
```sql
begin;
do $$ begin
  -- (Grok 152) las mismas guardas de 8.3, más: de la 151 no quedó nada (ni su fila ni su trigger)
  if (select count(*) from supabase_migrations.schema_migrations where version = '150') <> 1
     or exists (select 1 from supabase_migrations.schema_migrations where version = '151')
     or exists (select 1 from pg_trigger where tgname = 'club_config_catalogo_trg')
     or exists (select 1 from public.club_miembros) or exists (select 1 from public.club_movimientos)
     or exists (select 1 from public.club_cupones) or exists (select 1 from public.club_config where club_activo) then
    raise exception 'precondición: se esperaba la 150 sin nada de la 151, sin actividad y sin locales encendidos: no se toca nada';
  end if;
end $$;
-- … pegar acá el cuerpo de scripts/sql/150_rollback.sql, sin su begin/commit (borra la fila 150 y se verifica solo) …
commit;
```
Enseguida, revert del merge en `main` (si el `.sql` queda en `main`, Branching lo vuelve a aplicar en el próximo push).

**8.3 Las dos entraron y hay que volver** (sin actividad): en prod, UN bloque:
```sql
begin;
do $$ begin
  if (select count(*) from supabase_migrations.schema_migrations where version in ('150', '151')) <> 2
     or exists (select 1 from public.club_miembros) or exists (select 1 from public.club_movimientos)
     or exists (select 1 from public.club_cupones) or exists (select 1 from public.club_config where club_activo) then
    raise exception 'precondición: se esperaban la 150 y la 151, sin actividad y sin locales encendidos: no se toca nada';
  end if;
end $$;
-- … el cuerpo de scripts/sql/151_rollback.sql, sin su begin/commit …
delete from supabase_migrations.schema_migrations where version = '151';
-- … el cuerpo de scripts/sql/150_rollback.sql, sin su begin/commit …
commit;
```
- Enseguida, revert del merge en `main`.
- Club-web: sacar el dominio del proyecto `satori-club` (la base ya no acepta su clave).
- `locations` **no se toca**: quedan las filas que la 151 creó al dar de alta locales del Club (inactivas para caja). Se
  anotan; no molestan a caja.
- **Verificar:** 1.2 da `0 · 0 · 0`; 4a y 4b como «Antes»; Branching del revert: «All migrations are up to date».

**8.4 Con actividad** (socios, movimientos o cupones reales): **no se borra.** Owner → Club → Locales → **Apagar** (corta
altas, visitas, cupones, canjes y premios; la caja cobra como antes) y se arregla con una migración nueva (152+).
Si falla solo la app (`/club`): revert del código; **los `.sql` que ya están en el ledger de prod no se borran nunca**.

## 9. Orden en prod y después
- **085 → 089 → 090 → 091 → 092 → 093 → 094 → 095 (en prod, 10-nov) → 150 → 151.** La 087 y la 088 (y cualquier migración de caja que
  quede después del Club) toman **152+** al armar su paquete.
- Después del pase: actualizar `ESTADO.md` (ledger de prod) y el «Resultado» abajo. Staging ya está alineado (§3).
- Después del pase, en un PR aparte: sacar el nombre del dueño de los comentarios de `supabase/migrations/` (decisión del
  dueño, 10-nov; backlog 22c). En la 150 solo los comentarios de afuera de las funciones: los 4 de adentro quedan.
- **Pendiente después del piloto** (decisión del dueño, 10-nov): la cédula jurídica de la sociedad está escrita en el
  texto del Edge `extract-document` (`supabase/functions/extract-document/index.ts`). Es un dato público del Registro y
  queda por ahora; después del piloto pasa a una variable del Edge. Va al backlog (`PROMPT-CONTINUACION.md`) con el #95.
- El RUNBOOK (`docs/club-satori/RUNBOOK-piloto.md`) sigue valiendo para el detalle de cada verificación, pero el **orden**
  es el de este paquete: se mergea **una vez**, y la base entra con el merge.

## 10. Firma y bitácora
| Paso | Esperado | Obtenido |
|---|---|---|
| Firma del dueño (fecha y hora `-06:00`, SHA de la cabeza del #59) | | |
| Responsables (ejecución / control) | | |
| 0.4 la 091–095 en prod | ledger 65 · 095 | ✅ 10-nov noche (lo informó el dueño): 091 por el merge `b8cb74d` (pase cerrado), 092–095 por el merge `c41e18b`; ledger 65 · 095 |
| 0.5 el #59 al día con `main` · diff solo lo del Club | | |
| 0.8 Cloudflare: `satori-club` y Turnstile de prod (10-nov) · dominio y CNAME en SiteGround (§11.2) · Worker `satori-club-api` con `wrangler deploy` manual, sin repositorio conectado, sin URL pública, con sus variables (§11.4) · `CLUB_WEB_KEY` en Pages y en el Worker | | ✅ 11-nov: Worker desde `66c950d` (Version `ae142f3a…`), 4 variables a prod; `CLUB_WEB_KEY` creada y cargada en los dos |
| §11.4 paso 4b · Worker otra vez a mano desde la cabeza firmada (SHA, Version nueva) | | |
| 0.9 G-61 «antes»: diferencias explicadas y esperadas firmadas en el PR | | |
| 0.10 carga única: export, sha256 de `carga.sql` y esperados de restos (N y personas) firmados (o «la prueba va sin carga») | | ✅ 11-nov 10:14: sha256 `150f0c8e…6b461f`, esperados 115 / 174, ensayo en staging OK |
| 1.1 ledger: 65 · 095 · 089–095 presentes · nada del Club (Grok 181) | 65 · 095 | |
| 1.2 0 · 0 · 0 | | |
| 1.3 true · true · true · 2 · 2 · false · true · 3 · true · pgcrypto · pg_cron | | |
| 1.4 respaldo de `employees`, `profiles` y `locations`: cifrado, dónde quedó (sin la contraseña), sha256 y fecha de borrado | | |
| 4a antes: 0 · null · 0 | | |
| 4b antes (activas), justo antes del merge | | |
| Gate de CI en la cabeza del #59 (enlace), o la aceptación del dueño sin ese verde, con el motivo | | |
| §2 merge (SHA, hora) | | |
| 5.1 Branching success · log con la 150 y la 151 | | |
| 5.2 ledger 67 · 151 · 1 fila 150 y 1 fila 151 con su `name` (statements: anotar) | | |
| 5.3 0 · 1 · 0 · true · 1 · 1 · `15 9 * * *` · false · false · true · 1 · 0 | | |
| 5.4 G-61 después: sale 0 | | |
| 4a después: 10 · (las 10) · 0 · 4b = antes · 4c sin rojos | | |
| 6.1 dos locales, los dos apagados · `locations` como se espera | | |
| 6.2 dominio | | |
| 6.3 `CLUB_WEB_KEY` cargada, sha256 en la base, `/api/salud` en verde | | |
| **§11.4 paso 7 · CORTE BLOQUEANTE:** Worker conectado a `main` y desplegado desde `main` (SHA, hora); sin despliegues desde otra rama. Sin esto no se sigue | | |
| §11.3 `/api/salud`: `x-club-api: worker` y todo en `true` · prueba de fuego | | |
| 6.4 valores del local (la fila de verificación) · empleados con login | | |
| 6.5 carga única (sha256, conteos) o «replanificada» | | |
| 6.6 Santa Teresa encendido en la prueba interna (hora) | | |
| `lc_excepciones_desde`: `2026-11-12` en §6.4 (provisorio) | 2026-11-12 | |
| `lc_excepciones_desde`: el día de la apertura, antes de abrir | (fecha) | |
| Cierre: pasa / vuelta atrás (hasta qué paso de §8) | | |
| Respaldo de 1.4 borrado (fecha) | | |

## 11. Cloudflare: el proyecto de Pages, el dominio en SiteGround y `/api` con o sin Worker
> Pasos de panel. La documentación oficial de Cloudflare no se pudo abrir desde la sesión de Claude: lo de abajo sale de
> búsquedas en esa documentación y de pruebas locales con wrangler 4 (sin publicar nada). Los nombres de los menús pueden
> variar un poco. **El DNS de `satoricostarica.com` queda en SiteGround** (decisión del dueño, 10-nov): la zona no está en
> Cloudflare, así que **no hay Workers Routes**.

### 11.1 El proyecto de Pages `satori-club` (✅ creado el 10-nov)
Producción en `main`, root `club-web`, previews en **None**. En Production: `NODE_VERSION`, `VITE_CLUB_URL`,
`VITE_TURNSTILE_SITEKEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `TURNSTILE_SECRET` (Secret). El build falla hasta que
`club-web/` esté en `main`: es lo esperado, y no se publica nada. **Falta:** `CLUB_WEB_KEY` (Secret, el jueves, §6.3).

### 11.2 El dominio `club.satoricostarica.com` con el DNS en SiteGround
Pages acepta un **subdominio** con un CNAME en otro proveedor (el dominio raíz, no: ese necesita la zona en Cloudflare).
El certificado lo emite Cloudflare solo, cuando ve el CNAME.
1. **Cloudflare primero:** Pages → `satori-club` → **Custom domains** → **Set up a custom domain** → `club.satoricostarica.com`
   → **Continue**. El panel pide un CNAME en el proveedor de DNS y deja el dominio en «verificando». (Si el CNAME existe
   pero el dominio no está agregado en el proyecto, el sitio da error 522: por eso va primero.)
2. **SiteGround** → **Site Tools** del sitio → **Domain** → **DNS Zone Editor** → elegir `satoricostarica.com`:
   - en la lista de registros, **que no haya ningún A, AAAA ni CNAME llamado `club`** (si hay, borrarlo antes);
   - pestaña **CNAME** → Name **`club`** → Resolves to **`satori-club.pages.dev`** → TTL el que viene → **Create**;
   - **registros CAA:** si la zona **no tiene** ninguno, no hay que hacer nada. Si tiene, el certificado de Cloudflare no
     sale hasta agregar los que autorizan a sus emisoras: CAA `0 issue "letsencrypt.org"` y CAA `0 issue "pki.goog"`
     (si el panel de Pages muestra un error de CAA, agregar exactamente lo que diga ahí).
3. **Volver a Pages** y esperar que el dominio pase a **Active**: el certificado puede tardar desde unos minutos hasta
   algunas horas, según la propagación del DNS. **No borrarlo y volver a agregarlo** mientras verifica.
4. **Verificar** (después del primer deploy que funcione, §2): `https://club.satoricostarica.com/alta` abre el formulario.

**Cuándo:** el dueño eligió el jueves. Se puede adelantar al miércoles sin publicar nada: sin un deploy que funcione, el
dominio no sirve ningún sitio, y así el certificado ya está listo el jueves.

### 11.3 Plan B desde el merge: cómo se verifica con `/api/salud` (jueves, después del merge y de §6.3)
**Decisión del dueño (10-nov): el plan B entra activo con el #59.** El `[[services]]` de `club-web/wrangler.toml` va
descomentado en el #98: desde el primer deploy, la Pages Function le pasa `/api` al Worker `satori-club-api` (§11.4), que
tiene los topes. El plan A (la Pages Function con sus propios topes) queda como vuelta atrás.

Abrir `https://club.satoricostarica.com/api/salud` y mirar el JSON y el encabezado `x-club-api` (DevTools → Network → la
llamada → Headers). El Worker contesta `x-club-api: worker`; la Pages Function, `x-club-api: pages`.

| Lo que dice | Qué pasa | Qué se hace |
|---|---|---|
| `x-club-api: worker` · todo en `true` | **B funciona** | Prueba de fuego (abajo) |
| `x-club-api: worker` · `club_web_key` en `false` | Falta el Secret en el Worker | §11.4 paso 6 (y §6.3) |
| `x-club-api: worker` · `rl_crear` o `rl_leer` en `false` | El Worker no tomó los topes | Revisar el log del deploy del Worker (§11.4 paso 4). Mientras tanto, crear cupones y el alta responden 503 (falla cerrada) |
| `x-club-api: pages` | Pages no tomó el binding | **Se para** y se revisa el log del deploy de Pages (¿el Worker existía cuando se desplegó?) |
| Error 500 o sin respuesta | El binding apunta a un Worker que no está | **Se para**: §11.4 pasos 1–5 |

En todos los casos, `club_web_key`, `turnstile` y `supabase` tienen que estar en `true`. **Prueba de fuego:** 6 «Obtener mi
cupón» seguidos desde un teléfono con datos móviles → el sexto dice «Demasiados intentos seguidos»; desde otro teléfono
en **otra** red, pasa; desde dos teléfonos en el **mismo** wifi, el tope es compartido (prefijo de red). Que el tope sea
por teléfono y no global prueba que llega la IP real.

### 11.4 El Worker `satori-club-api` (#98): se crea el MIÉRCOLES, antes del merge
**Cómo funciona:** la Pages Function recibe el pedido del cliente (ahí `CF-Connecting-IP` es la IP real) y se lo pasa al
Worker por el binding `CLUB_API`, con un host interno que no existe en ningún DNS y la IP en `x-club-ip` (pisa cualquier
`x-club-ip` que mande el cliente). El Worker no tiene URL pública (`workers_dev = false`, sin rutas): rechaza otro host
(404) y, sin IP, responde 503. No depende de lo que haga Cloudflare con `CF-Connecting-IP` dentro de un service binding
(eso no está documentado). **Si aun así faltara la IP**, el Worker falla cerrado (503) y quedan como red Turnstile (cupón y
alta) y los topes de la base (`cupones_max_dia_referente`, `cupones_max_minuto_local`, `socio_autoalta_max_dia`).

**Por qué el miércoles:** el binding está activo en el `wrangler.toml` que llega a `main` con el #59. El Worker tiene que
existir **antes** de ese deploy de Pages. Creado el miércoles no publica nada: sin URL pública ni rutas, el único que lo
puede llamar es el binding, y el binding recién existe cuando el #59 llega a `main`.

**Antes de empezar:** el #98 mergeado en el #59 (lo hace Claude con el OK del dueño; no toca prod), así la rama del #59
trae `club-web/worker/`.

**Miércoles (el dueño): despliegue MANUAL, una vez, y SIN despliegues automáticos** (Grok 167). El Worker **no** se conecta
a la rama del #59: una rama de trabajo conectada desplegaría sola con cada push. Se conecta a `main` recién en el paso 7.
1. En su Mac, en el repo: `git fetch origin claude/epic-tesla-pyo77m && git checkout claude/epic-tesla-pyo77m` (la rama del
   #59, que ya trae `club-web/worker/`) y anotar el SHA (`git rev-parse --short HEAD`).
2. `cd club-web/worker && npx wrangler login` (abre el navegador; la cuenta de Cloudflare de Satori) y **`npx wrangler
   deploy`**. El nombre **`satori-club-api`** sale del `wrangler.toml` (igual al `service` del binding). **No** agregar un
   dominio ni una ruta.
3. En Cloudflare → Workers & Pages → `satori-club-api` → Settings → **Build**: **sin** repositorio conectado (si aparece
   uno, desconectarlo). Así nada lo vuelve a desplegar hasta el paso 7.
4. En la salida del deploy tienen que aparecer `env.RL_CREAR (ratelimit)` y `env.RL_LEER (ratelimit)`. En Settings →
   **Domains & Routes**: sin rutas y **sin** la URL `*.workers.dev` (si aparece encendida, apagarla). Anotar en §10 el SHA
   del paso 1 y la hora. ✅ Hecho el 11-nov desde `66c950d` (Version `ae142f3a…`).
4b. **Antes del merge (mié 11 a la noche o jue 12 temprano), otra vez a mano y desde la cabeza que se firma.** Lo mismo
   que los pasos 1 a 4, con `git checkout <cabeza firmada del #59>`. Motivo: el #93 entró al #59 después del primer
   despliegue y cambia `club-web/functions/_lib/api.js` (la baja por POST con la llave en el cuerpo, Grok 183), que es el
   código que corre el Worker. Sin esto, entre el merge y el paso 7 la página nueva le pediría al Worker una ruta que no
   tiene. Las variables no se tocan (`keep_vars = true`). Anotar en §10 el SHA y la Version nueva.
5. Worker → Settings → **Variables and Secrets** (Production), los mismos valores que en Pages:

| Nombre | Tipo | Cuándo |
|---|---|---|
| `SUPABASE_URL` (prod) | texto | miércoles |
| `SUPABASE_ANON_KEY` (prod; es pública) | texto | miércoles |
| `TURNSTILE_SECRET` | **Secret** | miércoles |
| `CLUB_WEB_KEY` | **Secret** | **jueves** (paso 6) |

   El `wrangler.toml` del Worker tiene `keep_vars = true`: un deploy nuevo no borra estas variables.

**Jueves:**
6. ✅ (11-nov, adelantado) Con la clave nueva de prod de §6.3 (la misma de Pages): Worker → Settings → Variables and
   Secrets → **Secret** `CLUB_WEB_KEY`. **Nunca por chat.**
7. **Después del merge del #59 — CORTE BLOQUEANTE (§10):** Worker → Settings → **Build** → **Connect** → `satori-app`, rama
   de producción **`main`**, Root directory **`club-web/worker`**, Build command vacío, Deploy command **`npx wrangler
   deploy`**, y **Deploy** una vez desde `main`. En el log, los dos `ratelimit`; en Variables, las 4 siguen (`keep_vars`).
   Desde ahí los arreglos del Worker salen solo de `main`. **Sin este paso no se sigue con §11.3 ni se enciende el local**
   (el Worker quedaría con el código de una rama de trabajo).
8. §11.3.

**Vuelta atrás al plan A:** un PR de tres líneas a `main` que comenta el `[[services]]` de `club-web/wrangler.toml`
(merge fuera de 17:00–23:00). Pages vuelve a desplegar y `/api` lo atiende la Pages Function: si Pages no toma los topes,
crear cupones y el alta responden 503 (falla cerrada). El Worker puede quedar creado y sin uso.

### 11.5 Qué se probó hoy (10-nov, sin publicar nada) y qué queda para el jueves
**Probado hoy, en local** (wrangler 4: `wrangler dev` para el Worker y `wrangler pages dev` para Pages, con el binding):
- `/api/salud` por Pages lo contesta el Worker (`x-club-api: worker`, todo en `true`); el Worker llamado directo → 404;
- 6 cupones desde una IP → el sexto 429; otra IP de la misma /24 → 429; otra red → pasa; un `x-club-ip` falso del
  cliente se pisa con la IP real;
- con el `[[services]]` descomentado en el toml, Pages toma el binding sin flags;
- `wrangler pages dev` también lista `RL_CREAR` y `RL_LEER` como bindings de Pages (modo remoto): **no se sabe** si el deploy
  real los toma (lo dice 11.3);
- **arreglo encontrado:** con `_redirects` a `/index.html`, `/alta` y `/privacidad` redirigían con 308 a «/» (el alta de
  socios por QR mostraba la portada). En el #98 las reglas van a «/» y las 9 rutas dan 200 con la URL intacta.
- `npx wrangler deploy --dry-run` del Worker (los dos topes) y `wrangler pages functions build` de Pages: sin errores.

**Queda para el miércoles o el jueves (en Cloudflare, el dueño):** crear el Worker (11.4, pasos 1–4), el dominio y el
CNAME (11.2), `CLUB_WEB_KEY` en Pages (y en el Worker), el deploy real, 11.3 y la prueba de fuego con teléfonos.

## 12. Hallazgos de la auditoría del 10-nov (partes A y B) y decisiones del dueño
### Grok 158 (Alta) · contraseña de prueba de staging en el historial del repo
- **Contraseña de prueba rotada (09-nov) y revisada, con residual: sin logs de auth entre jun y nov.**
- Revisión (10-nov, solo lectura en staging): toda la actividad visible de las cuentas de prueba tiene origen conocido
  (el recorrido con capturas del 08-nov y sesiones del dueño del 09-nov y del 10-nov, que el dueño confirmó). Lo de junio
  a noviembre no se puede revisar desde la base. Opcional para el dueño: el panel de Supabase (Logs → Auth).

### Grok 160 · un crédito sobre una factura R que después se anula
**Decisión del dueño (10-nov): MITIGAR con una alerta, sin bloquear.** Cuando una factura R sobre la que se acreditó un
cupón o se aprobó un pendiente (S0/S0b/S8) pasa a X y no queda otra factura C o R de ese pedido, se crea una **alerta
prioritaria** (`club_alertas`, tipo `factura_r_anulada`) que Excepciones muestra **arriba**, para la revisión diaria
(owner y manager, «Revisado» con nota). El crédito no se revierte. **Bloquear el canje** de esos créditos queda para
**después del piloto** (backlog).

### Los demás (bajos), hechos en este PR
- **159:** el replay de `club_tarjeta_manual` exige las mismas personas.
- **161:** `mutar_bateria.py` sale 1 si una mutación no muerde, da ERROR, no encuentra su ancla o un tramo da otra
  cantidad que la esperada.
- **180:** `151_pruebas.sql` documenta sus marcadores y suma el control positivo, las negativas de INSERT y DELETE y la RLS
  encendida; `151_pruebas.py` lo corre.
- **181:** §10, «la última de caja que pasó (093 o 095)».
- **182:** el turista que deja su contacto recibe en la respuesta, **una sola vez**, su link de baja (`/b/<llave>`), y el
  aviso corto lo dice.
- **183:** la llave de baja viaja en el **cuerpo** del POST (`/api/baja`), no en la ruta; la página `/b/` la saca de la
  barra de direcciones y `/b/*` va con `Referrer-Policy: no-referrer` y sin caché.
- **184:** al backlog. Los commits de Claude salen con `noreply@anthropic.com`; los merges hechos por la API de GitHub salen
  con el correo de la cuenta del dueño: se corrige en GitHub (Settings → Emails → «Keep my email addresses private»).
  El historial no se reescribe.
- **Condición de la 150 (MAINTAIN):** `authenticated` (y `anon`) sin MAINTAIN en ninguna tabla `club_*` ni en `locations`,
  con verificación dentro de la migración y la prueba 93. Las tablas de caja, después de abrir (bloque 152+).

### Auditoría del 10-nov, segunda vuelta (delta hasta `f8bc602` y migrador hasta `e91b294`): sin NO-GO
**Alertas (en la 150):**
- **162:** `club_alerta_revisar` rechaza (42501) a quien registró el movimiento (`registrado_por`) o aprobó su pendiente
  (`club_personas_pendientes.resuelto_por`); la revisa otro manager y, si no hay otra persona, el owner (la misma regla
  que CLUB-AUD-25: el owner no queda frenado). `club_alertas_prioritarias` devuelve `revisada_por` (nombre del perfil) y
  Excepciones lo muestra. Prueba 95 y mutación `162` (caen 4).
- **163:** el cuerpo de `club_factura_r_anulada_trg` va en `begin … exception when others then raise warning`: un error de
  la alerta **nunca** frena la ingesta R→X del puente. Prueba 95 (la alerta forzada a fallar: el UPDATE pasa y no queda
  alerta a medias) y mutación `163` (cae 1).
- **164:** negativas en la prueba 95 (cajero → 42501; `authenticated` sin INSERT ni UPDATE en `club_alertas`). El residual
  (C→X, cruce manual, más de 7 días, solo UPDATE) va al backlog 22f.

**Migrador de la primera carga (toca saldos):**
- **170:** la validación dentro de la transacción cuenta `restos_invalidos` y aborta si algún «resto del sistema viejo» no
  cumple `-personas*2 < personas_por_credito`, miembro activo y saldo final 0. Los `assert` pasaron a `if … sys.exit`
  (`python -O` los ignora). Prueba en staging (ROLLBACK): dos restos trucados → `restos_invalidos=2`, no queda nada.
- **171:** con `--vencer-restos-inactivos`, `--ensayo` y `--emitir` exigen `--esperados` con `vencimientos_restos` y
  `vencimientos_restos_personas`; se comparan con el plan antes de emitir y con la base dentro de la transacción. El dueño
  los firma **junto con el sha256 de `carga.sql`** (van dentro del SQL; `resumen.json` los muestra en `esperados_firmados`).
- **172:** «hoy» y la última actividad, en hora de Costa Rica (`hoy_cr`, `fecha_cr`). Prueba en el borde: 10-nov 23:30 CR
  (11-nov 05:30 UTC) queda fuera del plazo con hoy = 11-nov-2026; 11-nov 00:30 CR, dentro.
- **173:** `--papel` y `--vencer-restos-inactivos` no se combinan (sale con «NEGADO (Grok 173)»).

**PASE, scripts y repo:**
- **165:** `club_paridad.sh`: `cuerpo()` normaliza como `con_antes` (espacios y mayúsculas) y aborta (sale 3) si queda
  cualquier control de transacción. Pruebas sin red: `club_paridad_cuerpo_test.sh` (10/10). Además, el catálogo lista las
  ACL con sus entradas ordenadas: aplicar la 150 dos veces en staging reordena las entradas sin cambiar ningún permiso.
- **166:** §12 / Grok 158 reducido a lo que corresponde en un repo público.
- **167:** el Worker se crea el miércoles con un `wrangler deploy` manual, sin repositorio conectado; se conecta a `main`
  después del merge (§11.4 paso 7, **corte bloqueante** en §10).
- **168:** al backlog, después del piloto: secreto compartido Pages → Worker.
- **169:** sacado del backlog (`PROMPT-CONTINUACION.md`, #94 y #95) el correo de login de la cuenta de prueba de prod;
  `walletRepo.test.ts` detecta correos `@gmail` y el nombre del dueño (#94 y #95).
- **181:** §10, fila 0.4.

