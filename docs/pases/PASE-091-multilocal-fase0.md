# Pase a PROD de la mig 091 `multilocal_fase0`

> **Estado: preparado, SIN ejecutar.** Formato del `PASE-089` (`docs/pases/PASE-089-anon-sin-politica.md`): qué cambia,
> lecturas previas, prueba en staging, humo de solo lectura, vuelta atrás y firma.
>
> **Nada de este documento se ejecuta en prod hasta que el dueño lo firme (§9).** Si algo no coincide con lo que dice
> acá, **se para y se avisa**: no se improvisa en prod.
>
> - **Orden en prod: 085 → 089 → 090 → 091 → 092 → 093.** La 091 va **después** de la 090 y **antes** de la 092. El
>   11-nov a la mañana van 091 → 092 → 093 **seguidas, en la misma ventana** (§8).
> - **Regla del ledger (Grok 122):** Branching guarda las migraciones **partidas** en varios statements. La verificación
>   es «exactamente 1 fila 091 con su `name`» más el catálogo (5.3). **No se compara md5.**
> - **Repo público:** en la bitácora (§9) se anotan conteos y huellas, **nunca montos**.
> - Diseño y decisiones: [`docs/MULTILOCAL-fase0.md`](../MULTILOCAL-fase0.md) (las 12 decisiones las aprobó el dueño el
>   08-nov).

## Qué pasa y qué no
- **Pasa (solo esquema; ningún dato cambia de valor):**
  1. Se crea el catálogo de locales `public.locations`, con una sola fila: `santa-teresa`.
  2. `cash_sessions`, `cash_movements`, `cash_cierres_dia` y `tip_sessions` reciben la columna
     `location_id text not null default 'santa-teresa'`, con FK al catálogo e índice. Es un default constante: Postgres
     no reescribe la tabla, y **todas las filas de hoy quedan en Santa Teresa**.
  3. Se crean `profile_locations` (qué locales ve cada usuario; vacía) y las funciones `mis_locales()` y
     `puede_ver_local(local)`. Owner y contador ven todos los locales. Los demás ven los suyos; sin filas, Santa Teresa.
  4. Cada una de esas 4 tablas recibe una policy **restrictiva** `<tabla>_por_local`, que se suma con AND a las de hoy.
     Las policies de hoy **no se tocan**.
- **No pasa:**
  - **con un solo local y `profile_locations` vacía, cada usuario ve y escribe exactamente lo mismo que hoy**. La app no
    manda `location_id` y toma el default;
  - no toca el cierre, el pozo, las cajas físicas, el banco, los proveedores ni las propinas por local (fases con firma);
  - ningún archivo sagrado y ninguna pantalla;
  - **no habilita un segundo local.** Gate del dueño (08-nov): no se abre otro local solo con la fase 0, porque el
    cierre todavía mezclaría locales. Y el día que haya selector de local, `location_id` pierde el default en el mismo PR;
  - `tip_entries`, `movement_deletions` y `movement_edits` no llevan columna. Las RPC `SECURITY DEFINER` (por ejemplo,
    `delete_movement_cascade`) no pasan por la policy por local. Las dos cosas son conocidas y quedan para las fases con
    firma ([`MULTILOCAL-fase0.md`](../MULTILOCAL-fase0.md), «Lo que la fase 0 NO aísla»).

## SHA y huellas
| Qué | Valor |
|---|---|
| Rama | `claude/multilocal-fase0`, encima de `claude/anon-default-privs` (la 090 sobre la 089). Cuando la 090 esté en prod, se trae `main` con un merge commit y se verifica 0.4 |
| Migración | `supabase/migrations/091_multilocal_fase0.sql`, md5 `1838dd21762a13236728e2d092c090a3` |
| Rollback | `scripts/sql/091_rollback.sql`, md5 `dc53fccc9f34d4f01738a5506fdbc8ec` |
| Pruebas | `scripts/sql/091_pruebas.sh` (solo staging, transacciones descartadas) |

Los md5 sirven para comprobar el archivo, **no** para el ledger de prod (Grok 122).

## Responsables
- **Ejecución:** el dueño. Firma, lee el catálogo de prod en el editor SQL, mergea (o autoriza el merge) y corre la
  prueba de humo.
- **Control:** el encargado del turno. Lee en voz alta cada resultado esperado contra el obtenido. No es la misma
  persona.
- **Claude no corre nada en prod.** Prepara, revisa y lee los resultados que le pasan.

## 0. Prerrequisitos
**Base del pase: `main` con la 090 ya mergeada y en prod** (ledger **60 · 090**).

| # | Qué | Cómo se verifica |
|---|---|---|
| 0.1 | Firma del dueño en §9 (con el SHA de la cabeza del PR) | firma |
| 0.2 | Los dos responsables presentes | §9 |
| 0.3 | **No se mergea entre las 17:00 y las 23:00 CR**, ni con la caja abierta en servicio, y ninguna otra sesión mergeando a `main` | hora en §9 |
| 0.4 | La rama al día con `main` (con la 090 ya mergeada), y el diff con **solo** los archivos de la 091 (§2) | `git merge-base --is-ancestor`, `git diff --name-only` |
| 0.5 | Gate del PR en verde: `supabase/migraciones.test.ts` (la 091 está registrada) y build | checks del PR |
| 0.6 | Staging en verde con este mismo archivo (§3) | anotado |
| 0.7 | **La 090 ya está en prod con su pase cerrado** (puede haber sido minutos antes: ver §1) y no hay ninguna migración con número mayor que 091 en `main` ni en el ledger de prod | 1.1 |

## 1. Lecturas previas (SOLO LECTURA, en PROD)
Editor SQL de PROD. **Leer el ref en pantalla.** Anotar cada resultado en §9.

**Pase seguido: la 090 puede haber entrado minutos antes, en la misma ventana.** Estas lecturas no piden ningún tiempo
de espera; piden que el pase de la 090 esté **cerrado**: su merge con «Supabase Preview» en `success`, su §5 en verde y
su §9 firmado («pasa»). Si el run de Branching de la 090 todavía corre, **se espera a que termine**: no se mergea con
otro run en curso. Con eso, el ledger tiene que dar **60 filas, la última 090**, y ninguna 091 o mayor. Si la 090 hizo
vuelta atrás, este pase **no se hace**.

```sql
-- 1.1 ledger: 60 · 090 y la 091 no está
select count(*), max(version) from supabase_migrations.schema_migrations;               -- 60 · 090
select version from supabase_migrations.schema_migrations where version >= '091';       -- 0 filas
-- 1.2 nada de la 091 existe todavía en prod
select json_build_object(
  'locations', to_regclass('public.locations') is not null,
  'profile_locations', to_regclass('public.profile_locations') is not null,
  'columnas_location_id', (select count(*) from information_schema.columns where table_schema = 'public' and column_name = 'location_id'
                             and table_name in ('cash_sessions','cash_movements','cash_cierres_dia','tip_sessions')),
  'mis_locales', to_regprocedure('public.mis_locales()') is not null,
  'puede_ver_local', to_regprocedure('public.puede_ver_local(text)') is not null,
  'policies_por_local', (select count(*) from pg_policies where schemaname = 'public' and policyname like '%\_por\_local')) as x;
-- esperado: {"locations":false,"profile_locations":false,"columnas_location_id":0,"mis_locales":false,"puede_ver_local":false,"policies_por_local":0}
```

**1.3 Foto de Santa Teresa (solo lectura): conteos y huellas, sin montos en la bitácora.** Esta es la foto contra la
que se compara 5.4:
```sql
begin read only;
select json_build_object(
  'cash_movements',   (select json_build_object('n', count(*), 'h', md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), ''))) from public.cash_movements x),
  'cash_sessions',    (select json_build_object('n', count(*), 'h', md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), ''))) from public.cash_sessions x),
  'cash_cierres_dia', (select json_build_object('n', count(*), 'h', md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), ''))) from public.cash_cierres_dia x),
  'tip_sessions',     (select json_build_object('n', count(*), 'h', md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), ''))) from public.tip_sessions x),
  'tip_entries',      (select json_build_object('n', count(*), 'h', md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), ''))) from public.tip_entries x)
) as foto;
rollback;
```
- En 5.4 la misma consulta se corre **sin** la columna nueva: `to_jsonb(x) - 'location_id'` en las 4 tablas que la
  reciben. Así, si nadie cargó nada entre las dos lecturas, las huellas tienen que dar iguales.
- **Se corre justo antes del merge, con la caja sin movimiento.** Un movimiento cargado entre las dos lecturas cambia
  la huella de esa tabla: en ese caso se compara solo `n` (tiene que subir exactamente lo que se cargó) y se anota.

**1.4 (informativo) Funciones `SECURITY DEFINER` que leen estas tablas** (no pasan por la policy por local; con un
solo local no cambia nada, pero se anotan para las fases con firma):
```sql
select p.oid::regprocedure::text from pg_proc p
 where p.pronamespace = 'public'::regnamespace and p.prosecdef
   and p.prosrc ~* '\m(cash_sessions|cash_movements|cash_cierres_dia|tip_sessions)\M' order by 1;        -- anotar la lista
```

Más la **prueba de humo de antes** (§4).

**Para (no se sigue)** si:
- el ledger no da 60 · 090, o ya tiene la 091;
- 1.2 encuentra algo de la 091 en prod (por ejemplo, una tabla `locations` creada a mano);
- la caja está abierta en servicio o hay alguien cargando movimientos (se espera).

## 2. El cambio: merge del PR → Supabase Branching aplica la 091
- El PR trae **solo**: la migración, `scripts/sql/091_rollback.sql`, `scripts/sql/091_pruebas.sh`,
  `scripts/sql/091_propuesta_club_catalogo.sql` (propuesta para el Club: **no** es una migración y no se aplica),
  `docs/MULTILOCAL-fase0.md`, el registro (`migraciones-reservadas.json` y `ESTADO.md`) y este documento.
- **Se aplica con el merge, no a mano:** Branching corre `migrate` contra prod en cada push a `main`. La migración es una
  sola transacción: o entra entera o no entra nada.
- **Merge commit**, con la firma de §9. Anotar el SHA y la hora (`-06:00`).

## 3. Prueba en staging
`scripts/sql/091_pruebas.sh hwiatgicyyqyezqwldia`. Corre en transacciones descartadas: la 091 **no** queda aplicada en
staging.
- **Santa Teresa idéntica, como postgres:** mismas filas (md5 de cada fila sin `location_id`), mismos totales, mismo
  saldo de Caja Fuerte y mismos cierres.
- **Owner, manager, contador, cajero y salonero ven lo mismo antes y después.** Los roles se simulan sobre un perfil
  dentro de la transacción, así ninguno queda sin probar.
- **Aislamiento con un segundo local de prueba:** owner y contador lo ven; manager y cajero sin asignación, no. Un
  manager asignado solo a ese local ve ese y deja de ver Santa Teresa. Una escritura en un local ajeno la rechaza la
  RLS (42501).
- **Las 4 policies son restrictivas**, con `using` y `with check`; el rollback deja todo como antes.
- **Opción «a» del catálogo** (con la 100 del Club, que va después): compatible en los dos órdenes.

Tabla en orden por hora (Grok 174).

| Cuándo | Qué | Resultado |
|---|---|---|
| 10-nov 10:06 CR (script @ `2eba291`) | `091_pruebas.sh hwiatgicyyqyezqwldia` | 18 OK · **1 FALLA** (contados de la salida guardada; antes decía 23 por error): «contador ve 1 fila del otro local» dio 0. **Error de la expectativa, no de la 091:** hoy el contador no tiene ninguna policy de SELECT en `cash_movements` (las de lectura son owner, manager y cajero) y ve 0 filas también **sin** la 091 (verificado en una transacción descartada). Una policy restrictiva solo achica |
| 10-nov 10:06 CR (script @ `7ec3567`: contador espera 0; 4 casos nuevos de `mis_locales()`) | `091_pruebas.sh hwiatgicyyqyezqwldia` | **23 OK · 0 FALLA · VERDE** (contados de la salida guardada; antes decía 24 por error) |
| 10-nov 10:07 CR | Estado de staging al terminar | sin columnas `location_id`, sin `profile_locations`, sin `mis_locales()`, sin policies por local, sin el local de prueba, sin la FK del Club; ledger 85 / 090: **la 091 no quedó aplicada** |
| 10-nov 10:59 CR (script @ `47829f6`, Grok 138/139) | `091_pruebas.sh hwiatgicyyqyezqwldia` | **24 OK · 0 FALLA · VERDE**: la evidencia válida de «antes/después» (su salida literal quedó en el PASE-091 @ `1cdd505`; la de abajo es la de las ~11:56) |
| 10-nov 11:02:50 CR | **Aplicada en staging** (transacción con precondición y su fila del ledger) | ver el párrafo de abajo |
| 10-nov ~11:56 CR (script @ `e265da8`: guarda del rollback, Grok 137; contador según la 095; **la 091 → 095 ya aplicadas en staging**) | `091_pruebas.sh hwiatgicyyqyezqwldia` | Salida 27 OK · 0 FALLA, pero **Grok 174: 21 OK válidos + 6 NO PROBADO**. Los 6 casos de «antes/después» (postgres y los 5 roles) compararon la base CON la 091 contra la base CON la 091 y no prueban nada. **La evidencia válida de esos 6 es la corrida de las 10:59 (24 OK), antes de aplicar la 091.** Desde el 11-nov el script los marca NO PROBADO solo y no da verde (salida literal abajo) |
| 10-nov noche (script con Grok 174, en la rama del #108) | `091_pruebas.sh hwiatgicyyqyezqwldia`, con la 091 ya aplicada | **21 OK · 0 FALLA · 6 NO PROBADO**: salida 1, no da verde. Los 6 de «antes/después» se marcan NO PROBADO solos |

Antes de correr: sin consultas ajenas en staging y el último commit del Club con más de 5 minutos.

**Grok 138 — salida literal de la última corrida** (10-nov, `scripts/sql/091_pruebas.sh hwiatgicyyqyezqwldia`, script @ `e265da8`,
con la 091 → 095 ya aplicadas en staging; transacciones descartadas). Suma la guarda de la vuelta atrás (Grok 137, 3 casos)
y el caso del contador según la 095. Salida 0: **27 OK · 0 FALLA**. **Grok 174:** de esos 27, los 6 de «antes/después» (postgres y los 5 roles)
corrieron con la 091 ya aplicada y **no prueban nada** (21 OK válidos + 6 NO PROBADO); su evidencia es la corrida de las 10:59. La corrida de las 10:59 (24 OK, script @ `47829f6`)
está en la tabla de arriba.
```text
== Santa Teresa idéntica (postgres) ==
OK    postgres: filas, totales, saldo CF y cierres
== Lo que ve cada rol, antes y después ==
OK    owner ve lo mismo
OK    manager ve lo mismo
OK    contador ve lo mismo
OK    cajero ve lo mismo
OK    salonero ve lo mismo
== Aislamiento con un segundo local (todo descartado) ==
      la 095 está aplicada: true → el contador espera 1 fila(s) del otro local
OK    owner ve 1 fila(s) del otro local
OK    contador ve 1 fila(s) del otro local
OK    manager ve 0 fila(s) del otro local
OK    cajero ve 0 fila(s) del otro local
OK    control positivo: el cajero sin asignación ve todos los movimientos de santa-teresa (= postgres)
OK    mis_locales() de owner incluye el otro local: true
OK    mis_locales() de contador incluye el otro local: true
OK    mis_locales() de manager incluye el otro local: false
OK    mis_locales() de cajero incluye el otro local: false
OK    manager asignado al otro local lo ve
OK    manager asignado SOLO al otro local deja de ver santa-teresa
== Una escritura de un manager sin asignación a otro local se rechaza ==
OK    insert en otro local rechazado por RLS (42501)
== Las políticas se crean con la forma correcta y el rollback deja todo como antes (descartado) ==
OK    las 4 políticas por local existen, restrictivas, con using y with check
OK    guarda: con un local de más en locations (staging tal cual) el rollback frena
OK    guarda: con una fila de caja fuera de santa-teresa el rollback frena
OK    guarda: con locales asignados en profile_locations el rollback frena
OK    rollback: filas, totales, saldo y cierres iguales a antes
OK    rollback: sin columnas, sin políticas y sin función
== Opción a: catálogo único con el Club (propuesta para la sesión del Club; todo descartado) ==
      locales del Club que entrarían nuevos al catálogo: (ninguno)
OK    opción a (MIG → PROP): FK validada, ningún local del Club fuera del catálogo, 4 columnas
OK    opción a (PROP → MIG): FK validada, ningún local del Club fuera del catálogo, 4 columnas
OK    club_local_crear (owner): el local queda en locations (inactivo para caja) y en club_config
== Resultado: 27 OK · 0 falla(s) ==
```

**Lo que dejó a la vista la corrida:** el contador hoy **no lee** `cash_movements` (ni con la 091 ni sin ella). La decisión 2
(«owner y contador ven todos los locales») queda en `mis_locales()`; para que el contador lea caja hace falta una policy
de lectura propia, que **no** es parte de esta fase.

**Aplicada en STAGING el 10-nov a las 11:02:50 CR** (autorizado por el dueño): una transacción con precondición (la anterior es la última del ledger y la 091 no está), la migración y su fila del ledger (1 statement, md5 = el archivo). Antes, sin consultas ajenas y el último commit del Club con más de 5 minutos. Verificación después: `{"cols":4,"pols":4,"fns":2,"profile_locations":true,"fuera_st":0,"ledger":1}`.

## 4. Prueba de humo en PROD (SOLO LECTURA: `begin read only` … `rollback`)
Se corre **antes** del merge y **después** (5.4).

**4a. Lo que ve cada rol activo** (owner, manager, cajero, contador y salonero; la cuenta activa más antigua de cada
uno). La misma forma que el 4b del PASE-089, con las 4 tablas de caja y `tip_entries`. Solo conteos, sin nombres ni ids:
```sql
begin read only;
select set_config('request.jwt.claims', json_build_object('sub', (select p.id from public.profiles p where p.role = 'owner' and p.is_active
         order by p.created_at, p.id limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('humo.owner', json_build_object('hay_cuenta', current_setting('request.jwt.claims')::json->>'sub' is not null,
       'cash_movements', (select count(*) from public.cash_movements), 'cash_sessions', (select count(*) from public.cash_sessions),
       'cash_cierres_dia', (select count(*) from public.cash_cierres_dia), 'tip_sessions', (select count(*) from public.tip_sessions),
       'tip_entries', (select count(*) from public.tip_entries))::text, true);
reset role;
-- … el mismo bloque para manager, cajero, contador y salonero (cambiar el rol en las dos líneas) …
select current_setting('humo.owner')::json as owner, json_build_object(
       'cash_movements', (select count(*) from public.cash_movements), 'cash_sessions', (select count(*) from public.cash_sessions),
       'cash_cierres_dia', (select count(*) from public.cash_cierres_dia), 'tip_sessions', (select count(*) from public.tip_sessions),
       'tip_entries', (select count(*) from public.tip_entries)) as base;
rollback;
```
- **Regla: después = antes** en cada rol con `hay_cuenta: true`. Una diferencia que también está en `base` (se cargó
  algo entre las dos lecturas) no es parada.

**4b. Pantallas** (sin escribir nada a propósito): el owner abre Caja, el cierre del día y Propinas; alguien con rol de
cajero abre Caja. Tienen que ver lo de siempre. El primer movimiento normal del turno, cargado por el cajero, tiene que
aparecer como siempre (entra con `location_id = 'santa-teresa'` por el default).

## 5. Verificación después del merge
1. **Branching:** «Supabase Preview» del merge commit en `success`; en el log,
   `Applying migration 091_multilocal_fase0.sql`.
2. **Ledger** (solo lectura): **exactamente 1 fila 091 con su `name`**. No se compara md5.
   ```sql
   select count(*), max(version) from supabase_migrations.schema_migrations;                     -- 61 · 091
   select count(*) from supabase_migrations.schema_migrations
    where version = '091' and name = 'multilocal_fase0';                                         -- 1
   select array_length(statements, 1) from supabase_migrations.schema_migrations where version = '091';   -- anotar
   ```
3. **Catálogo:**
   ```sql
   select json_build_object(
     'locations', (select json_agg(id order by id) from public.locations),
     'columnas', (select count(*) from information_schema.columns where table_schema = 'public' and column_name = 'location_id'
                    and is_nullable = 'NO' and column_default like '%santa-teresa%'
                    and table_name in ('cash_sessions','cash_movements','cash_cierres_dia','tip_sessions')),
     'filas_fuera_de_santa_teresa', (select count(*) from public.cash_movements where location_id <> 'santa-teresa')
                                  + (select count(*) from public.cash_sessions where location_id <> 'santa-teresa')
                                  + (select count(*) from public.cash_cierres_dia where location_id <> 'santa-teresa')
                                  + (select count(*) from public.tip_sessions where location_id <> 'santa-teresa'),
     'policies_restrictivas', (select count(*) from pg_policies where schemaname = 'public' and policyname like '%\_por\_local'
                                 and permissive = 'RESTRICTIVE' and qual ~ 'mis_locales' and with_check ~ 'mis_locales'),
     'profile_locations', (select count(*) from public.profile_locations),
     'rls_profile_locations', (select relrowsecurity from pg_class where oid = 'public.profile_locations'::regclass),
     'rls_locations', (select relrowsecurity from pg_class where oid = 'public.locations'::regclass),
     'anon_en_locations', has_table_privilege('anon', 'public.locations', 'SELECT'),
     'funciones', (select count(*) from pg_proc where oid in (to_regprocedure('public.mis_locales()'), to_regprocedure('public.puede_ver_local(text)')))
   ) as x;
   -- esperado: locations ["santa-teresa"] · columnas 4 · filas_fuera_de_santa_teresa 0 · policies_restrictivas 4 ·
   --           profile_locations 0 · rls_profile_locations true · rls_locations true · anon_en_locations false
   --           (la 090 ya está: la tabla nueva nace sin anon) · funciones 2
   ```
4. **Foto y humo:** 1.3 con `- 'location_id'` en las 4 tablas, igual a la de antes (o solo `n`, si se cargó algo); 4a
   igual que antes; 4b sin rojos.

## 6. Criterios de parada → vuelta atrás (§7)
- Branching en error (`MIGRATIONS_FAILED`) o aplicando otra cosa.
- 5.2 sin exactamente 1 fila 091 con `name = 'multilocal_fase0'`.
- 5.3 con algún valor distinto de lo esperado (en especial `filas_fuera_de_santa_teresa` mayor que 0, o
  `policies_restrictivas` distinto de 4).
- 5.4: la foto de Santa Teresa distinta de la de antes (sin una carga que lo explique), o 4a distinto de antes en algún
  rol con cuenta.
- 4b: un usuario no ve su caja o no puede cargar un movimiento como siempre.

## 7. Vuelta atrás (todo en la misma ventana; nadie más pushea a `main`)
1. **En prod, UN bloque** (editor SQL): precondición + el cuerpo de `scripts/sql/091_rollback.sql`. Saca las policies
   por local, las funciones, `profile_locations` y las 4 columnas; `locations` se borra si nadie más la referencia; borra
   la fila del ledger. O pasa todo o no pasa nada:
   ```sql
   begin;
   do $$ begin
     if (select count(*) from supabase_migrations.schema_migrations where version = '091') <> 1 then
       raise exception 'precondición: se esperaba exactamente 1 fila 091 en el ledger: no se toca nada';
     end if;
     if exists (select 1 from public.profile_locations) then
       raise exception 'precondición: profile_locations tiene filas (alguien asignó locales): avisar antes de borrar';
     end if;
     -- Grok 137: borrar la columna no puede perder a qué local pertenece una fila
     if exists (select 1 from public.cash_sessions    where location_id <> 'santa-teresa')
        or exists (select 1 from public.cash_movements   where location_id <> 'santa-teresa')
        or exists (select 1 from public.cash_cierres_dia where location_id <> 'santa-teresa')
        or exists (select 1 from public.tip_sessions     where location_id <> 'santa-teresa') then
       raise exception 'precondición: hay filas fuera de santa-teresa: no se toca nada';
     end if;
     if (select coalesce(array_agg(id order by id), '{}') from public.locations) <> array['santa-teresa'] then
       raise exception 'precondición: locations no tiene solo santa-teresa: no se toca nada';
     end if;
   end $$;
   -- … pegar acá el cuerpo de scripts/sql/091_rollback.sql, sin su begin/commit (desde el 10-nov el archivo trae la
   --     misma guarda de Grok 137: si se pega entero, frena igual) …
   commit;
   ```
   No se pierde ningún dato de caja: la precondición exige (Grok 137) que las 4 tablas tengan **0 filas fuera de
   `santa-teresa`** y que `locations` tenga **solo `santa-teresa`**; si no, frena sin tocar nada.
2. **Enseguida, revert del merge en `main`**, que saca el `.sql`:
   - si el archivo se queda en `main`, Branching la vuelve a aplicar en el próximo push;
   - si se saca el archivo sin borrar la fila, Branching falla en cada push (el caso de la 074).
3. **Verificar:** Branching del revert «All migrations are up to date»; 1.2 con el estado de «antes»; 1.3 y 4a iguales a
   los de antes.
4. **La 092 y la 093 no pasan** ese día: tienen número mayor y esperan a que la 091 vuelva a estar en `main` y en prod.
5. **Si ya entró el pase del Club (la 150 y la 151), primero se deshace la 151.** La 151 (la 100 del Club) pone la FK
   `club_config.location_id → locations` y puede haber sumado locales al catálogo. Con ella puesta, la guarda de la 137
   frena («locations no tiene solo santa-teresa»). Además, Supabase no deja deshacer una versión que no sea la última.
   Orden: la vuelta atrás de la 151 (paquete del Club, PASE-150-151) → las de 095 a 092 si están → recién ahí la 091.

## 8. Orden en prod
**085 → 089 → 090 → 091 → 092 → 093.** Supabase no aplica una migración con número menor que la última aplicada, así
que los merges a `main` van en ese orden, sin saltos. El 11-nov, la 091, la 092 y la 093 van **seguidas en la misma
ventana**. Cada una arranca cuando la anterior cerró su pase (§9 «pasa»). Si una hace vuelta atrás, las siguientes no
pasan. Después va el pase del Club (la 075 como 150 y la 100 como 151). La 100 trae el catálogo único del Club sobre
`locations` (opción «a»).

## 9. Firma y bitácora
| Paso | Esperado | Obtenido |
|---|---|---|
| Firma del dueño (fecha y hora `-06:00`, SHA de la cabeza del PR) | | |
| Responsables (ejecución / control) | | |
| 0.4 rama al día con `main` · diff solo los archivos de la 091 | | |
| 0.7 la 090 en prod con su pase cerrado | | |
| 1.1 ledger 60 · 090 · ninguna versión ≥ 091 | 60 · 090 | |
| 1.2 nada de la 091 en prod | todo false / 0 | |
| 1.3 foto de Santa Teresa (n y huella por tabla; **sin montos**) | | |
| 1.4 funciones SECURITY DEFINER sobre las 4 tablas (lista) | | |
| 4a antes (activas), justo antes del merge | | |
| Gate de CI en la cabeza del PR (enlace), o la aceptación explícita del dueño sin ese verde, con el motivo | | |
| §2 merge (SHA, hora) | | |
| 5.1 Branching success · log con la 091 | | |
| 5.2 exactamente 1 fila 091 con `name = 'multilocal_fase0'` (statements: anotar) | 61 · 091 · 1 | |
| 5.3 catálogo como lo esperado | | |
| 5.4 foto igual a 1.3 · 4a después = antes · 4b sin rojos | | |
| Cierre: pasa / vuelta atrás (hasta qué paso de §7) | | |
