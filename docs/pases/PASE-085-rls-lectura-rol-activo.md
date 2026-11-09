# Pase a PROD de la mig 085 `rls_lectura_rol_activo` (SEC-01c)

> **Estado: preparado, SIN ejecutar.** Formato de [`docs/puente/PASE-PROD-PLANTILLA.md`](../puente/PASE-PROD-PLANTILLA.md):
> qué cambia, la prueba en staging, la vuelta atrás y la firma.
>
> **Nada de este documento se ejecuta en prod hasta que el dueño lo firme (§9).** Si algo no coincide con lo que dice
> acá, **se para y se avisa**: no se improvisa en prod.
>
> - **Ya no espera al puente:** el puente pasó el 09-nov (081 y 082 v3 en prod, #71 mergeado en `2953994`,
>   [`RESULTADO-PASE-2026-11-09.md`](../puente/RESULTADO-PASE-2026-11-09.md)).
> - **Orden en prod: 085 → 089 → 090 → 091 → 092** (§8, Grok 127). Supabase no aplica una migración con número menor que
>   la última aplicada: la 085 entra antes que todas esas. La 100 del Club va después, con la 075 (#81).
> - **Re-auditoría (GO condicionado de Grok @ `ebe2d4a`):** 122–125, 127, 129 y 130 resueltos acá. Lo nuevo se probó en
>   STAGING, en transacciones `read only` o descartadas (marcado «staging»).
> - **Reemplaza** el paquete anterior de la rama `claude/rls-is-active`, escrito cuando la 085 esperaba al puente.

## Qué pasa y qué no
- **Pasa:** las lecturas «para todos» de cinco tablas dejan de responder a una cuenta **inactiva** que conserva su
  contraseña. La condición nueva es `get_my_role() is not null`: desde la 069, `get_my_role()` devuelve null si la
  cuenta está inactiva.

  | Tabla | Policy | Antes (`USING`) | Después (`USING`) |
  |---|---|---|---|
  | employees | «Todos ven empleados activos» | `is_active = true` | `is_active = true and get_my_role() is not null` |
  | tip_entries | «Todos ven entradas de propinas» | `true` | `get_my_role() is not null` |
  | tip_sessions | «Todos ven sesiones de propinas» | `true` | `get_my_role() is not null` |
  | role_tip_points | «Todos ven puntos por rol» | `true` | `get_my_role() is not null` |
  | exchange_rates | «Todos ven tipos de cambio» | `true` | `get_my_role() is not null` |
  | exchange_rates | `exchange_rates_read` | `true` | `get_my_role() is not null` |
  | profiles | «Solo owners crean/editan perfiles» (ALL) | `USING get_my_role() = 'owner'`, `WITH CHECK` null | igual `USING` + **`WITH CHECK` explícito** igual |

- **No pasa:**
  - los usuarios **activos** ven exactamente lo mismo;
  - «Perfil propio visible» no cambia: el propio perfil se sigue viendo con la cuenta inactiva (decisión del dueño,
    07-nov);
  - `anon` sigue sin permiso;
  - sin datos, sin funciones, sin tablas: solo 7 `alter policy` en una transacción.

## SHA y huellas (completos; se comparan enteros)
| Qué | Valor |
|---|---|
| Rama del pase | `claude/pase-085` (desde `main` @ `5a22478`: el puente ya en `main` y el #77, que no trae migraciones) |
| `supabase/migrations/085_rls_lectura_rol_activo.sql` | md5 `68b6384bd860dcc334919813888cae83` · sha256 `5d6c70fa15f99995606d6207f0143ab8e35e5d1aeeff900a22a83ee7d8d1ae6e` |
| Ledger de STAGING, fila 085 | `md5(statements[1])` = `68b6384b…` (igual al archivo, byte a byte) |
| `scripts/sql/085_rollback.sql` | sha256 `99ffeedc155b8464253f1dfc449b20b37a99dee9853424d3c273477a3dfc312e` |
| Respaldo del catálogo de prod antes de la 085 (fuera del repo) | `respaldo_catalogo_prod_antes_085_2026-11-08T15-20-24Z.json`, sha256 `4db2c15b5847e9b73459ce0a5ef538cdf2ed3293f7d3ec4f27fc5d41bba90b58` (ledger 55/080, 15 policies de las 6 tablas) |

**Cambio de hoy en el archivo:** un comentario decía el nombre del dueño. Ahora dice «el dueño», por la regla del repo.
El SQL ejecutable no cambió. El md5 anterior era `afd4403e…`; la fila 085 del ledger de staging se actualizó al texto
nuevo en una transacción con precondición (el md5 viejo y exactamente una fila), sin tocar las policies.

## Responsables
- **Ejecución:** el dueño. Firma, lee el catálogo de prod en el editor SQL, mergea (o autoriza el merge) y corre la
  prueba de humo.
- **Control:** el encargado del turno. Lee en voz alta cada resultado esperado contra el obtenido. No es la misma
  persona.
- **Claude no corre nada en prod** (ni consultas, ni el merge sin autorización). Prepara, revisa y lee los resultados
  que le pasan.

## 0. Prerrequisitos
| # | Qué | Cómo se verifica |
|---|---|---|
| 0.1 | Firma del dueño en §9 (con el SHA de la cabeza del PR) | firma |
| 0.2 | Los dos responsables presentes | §9 |
| 0.3 | **No se mergea entre las 17:00 y las 23:00 CR** (regla del dueño), y ninguna otra sesión mergeando a `main` | hora en §9 |
| 0.4 | `main` sin moverse desde que se armó el PR: la cabeza del PR tiene a `main` como ancestro, y el diff tiene **solo** los archivos del PR (§2) | `git merge-base --is-ancestor`, `git diff --name-only` |
| 0.5 | Gate del PR en verde: `supabase/migraciones.test.ts` (la 085 está registrada) y build | checks del PR |
| 0.6 | Staging en verde con este mismo archivo (§3) | anotado |
| 0.7 | **Ninguna migración con número mayor que 085 en `main` ni en el ledger de prod** (la 091, la 092 y la 100 van después, §8): si entrara una antes, la 085 ya no se podría aplicar | `main` sin `09[1-9]_*.sql` ni `1??_*.sql`; 1.1 |

## 1. Lecturas previas (SOLO LECTURA, en PROD)
Editor SQL de PROD. **Leer el ref en pantalla.** Anotar cada resultado en §9.
```sql
-- 1.0 (Grok 122) cómo guarda Branching una migración en el ledger: ¿un statement o varios?
select version, array_length(statements, 1), md5(statements[1]) from supabase_migrations.schema_migrations
 where version in ('079', '080');                                                          -- anotar: n de statements de cada una
-- 1.1 ledger: el último es la 082 (pase del puente) y la 085 no está
select count(*), max(version) from supabase_migrations.schema_migrations;                 -- 57 · 082
select version from supabase_migrations.schema_migrations where version > '082';                        -- 0 filas
-- 1.2 las 7 policies existen con las condiciones de «Antes» (§ Qué pasa) y RLS activa en las 6 tablas
select tablename, policyname, qual, with_check from pg_policies
 where schemaname = 'public' and tablename in ('employees','tip_entries','tip_sessions','role_tip_points','exchange_rates','profiles')
 order by 1, 2;                                                                            -- 15 filas, iguales al respaldo
select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace
   and relname in ('employees','tip_entries','tip_sessions','role_tip_points','exchange_rates','profiles');   -- 6 · true
```
**1.0 → regla para 5.2 (Grok 122):** la 079 y la 080 las aplicó Branching.
- **Si la 079 tiene más de un statement** (Branching parte el archivo), `md5(statements[1])` no es el md5 del archivo. Entonces
  **5.2 verifica «exactamente 1 fila 085 con `name = 'rls_lectura_rol_activo'`» más el catálogo de 5.3**, y en §6 **no
  aplica «5.2 con otro md5»**.
- **Si tiene uno solo**, 5.2 verifica el md5 como está escrito.
- *El dueño corre 1.0 el 09-nov a las 16:05; con el resultado, esta regla queda definitiva.* En staging (aplicadas a mano), la
  079, la 080 y la 085 tienen 1 statement cada una.

**1.3 (Grok 130) qué más lee estas tablas sin pasar por las políticas** (solo lectura):
```sql
begin read only;
select x.tipo, x.objeto, x.grants from (
  select distinct 'vista' as tipo, r.ev_class::regclass::text as objeto, null::text as grants
    from pg_depend d join pg_rewrite r on r.oid = d.objid
   where d.classid = 'pg_rewrite'::regclass and d.refclassid = 'pg_class'::regclass
     and d.refobjid in ('public.employees'::regclass, 'public.tip_entries'::regclass, 'public.tip_sessions'::regclass,
                        'public.role_tip_points'::regclass, 'public.exchange_rates'::regclass)
     and r.ev_class not in ('public.employees'::regclass, 'public.tip_entries'::regclass, 'public.tip_sessions'::regclass,
                            'public.role_tip_points'::regclass, 'public.exchange_rates'::regclass)
  union all
  select 'funcion SECURITY DEFINER', p.oid::regprocedure::text, coalesce(p.proacl::text, '(sin acl: EXECUTE para public)')
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef
     and p.prosrc ~* '\m(employees|tip_entries|tip_sessions|role_tip_points|exchange_rates)\M'
) x order by 1, 2;
rollback;
```
- **Esperado en prod: 0 filas.** Ninguna vista y ninguna función `SECURITY DEFINER` que nombre las 5 tablas.
- **Si aparece alguna:** la función tiene que estar definida en `supabase/migrations/` de `main` (buscar
  `function public.<nombre>`). **Si no está en el repo, o si hay una vista: PARADA.**
- **staging (09-nov):** 0 vistas y 6 funciones (`club_employees_pos_login_guardia`, `club_excepcion_actor`,
  `club_excepcion_segregacion` y `club_pedidos_abiertos` son de la 075 del Club; `my_turno_stats` es de la 026 y
  `sync_pos_tips_to_pool` de la 035, del PoS propio). **Ninguna está en prod.**

Más la **prueba de humo de antes** (§4): con una cuenta inactiva, **las cinco tablas tienen que dar más de 0** (hoy lo ven) y
`profiles` 1; y **4b con las cuentas activas**. Anotar los números.

**Para (no se sigue)** si:
- el ledger no termina en 082 o ya tiene la 085;
- alguna de las 7 policies no existe o no tiene la condición de «Antes» (un `alter policy` sobre una policy que no
  existe hace fallar la migración, y Branching queda en `MIGRATIONS_FAILED`);
- las 15 policies no coinciden con el respaldo;
- no hay ninguna cuenta inactiva para la prueba de humo;
- 1.3 da una vista, o una función que no está en el repo (Grok 130).

## 2. El cambio: merge del PR → Supabase Branching aplica la 085
- El PR trae **solo** estos archivos:
  - `supabase/migrations/085_rls_lectura_rol_activo.sql`;
  - `scripts/sql/085_rollback.sql`;
  - `scripts/sql/085_pruebas.sh` (sin el ref de prod: lo lee de `SATORI_REF_PROD`);
  - este documento.
- **Se aplica con el merge, no a mano:** Branching corre `migrate` contra prod en cada push a `main`, aplica la 085 y
  escribe su fila en el ledger. Así pasaron la 079 y la 080.
- **Merge commit**, con la firma de §9. Anotar el SHA y la hora (`-06:00`).
- **Plan B, solo si Branching no la aplica y no da error** (por ejemplo, la integración apagada): en el editor de PROD, el
  `.sql` entero **y** su fila del ledger (`insert into supabase_migrations.schema_migrations (version, name, statements)
  values ('085', 'rls_lectura_rol_activo', array[<el archivo entero>])`), en UNA transacción. Después, un push vacío
  **no** se hace: se espera al próximo merge y se confirma «All migrations are up to date».

## 3. Prueba en staging (hecha; staging tiene la 085 desde el 08-nov 07:17 CR)
| Cuándo | Qué | Resultado |
|---|---|---|
| 08-nov 23:39 CR | `085_pruebas.sh hwiatgicyyqyezqwldia DESPUES` | **31 OK · 0 FALLA · VERDE** |
| 08-nov 23:39 CR | `085_pruebas.sh hwiatgicyyqyezqwldia ROLLBACK <respaldo>`: rollback en transacción descartada, 15 policies comparadas con el respaldo campo por campo | **33 OK · 0 FALLA · VERDE** |
| **09-nov ~14:10 CR** (con la 089 y la 090 de caja puestas en staging, con este archivo) | `085_pruebas.sh hwiatgicyyqyezqwldia DESPUES` | **31 OK · 0 FALLA · 0 NO PROBADO · VERDE** |
| 09-nov | Prueba de humo de §4 con una cuenta inactiva | 0 · 0 · 0 · 0 · 0 · profiles 1 |
| 09-nov ~15:30 CR (Grok 123) | `085_pruebas.sh` con `begin read only` en el modo prod y en las lecturas: modo DESPUES en staging | **31 OK · 0 FALLA · VERDE** |
| 09-nov ~15:30 CR (Grok 123) | El **camino de prod** del script contra staging (copia local que trata a staging como prod; todo `read only`) | **13 OK · 0 FALLA** · 19 NO PROBADO (los que escribirían) · salida 3, como está diseñado |
| 09-nov (Grok 123) | Una escritura dentro de `begin read only` | rechazada: **25006** «cannot execute UPDATE in a read-only transaction» |
| 09-nov (Grok 123/129/130) | Los bloques 4a, 4b y 1.3 de este documento, copiados tal cual | 4a: 0 · 0 · 0 · 0 · 0 · 1 · 4b: igual con y sin la 085 · 1.3: 0 vistas, 6 funciones que no están en prod |
| 09-nov | **Vuelta atrás:** `085_rollback.sql` + la prueba de humo en una transacción descartada | la cuenta inactiva vuelve a ver 21 · 17 · 3 · 7 · 3 (= la matriz «Antes» del 08-nov); al descartar, vuelve a 0 |

La matriz completa del 08-nov da lo mismo antes y después para las cuentas activas (owner, cajero y salonero), 0 para
las inactivas, 42501 para anon y todo para service_role. Está en el paquete anterior de `claude/rls-is-active`,
`docs/pases/PASE-085-…` @ `50c8855` §7.

## 4. Prueba de humo en PROD (SOLO LECTURA: `begin read only` … `rollback`; la base rechaza cualquier escritura, Grok 123)
Se corre **antes** del merge (§1) y **después** (5.4).

**4a. Cuenta INACTIVA.** Simula a un manager inactivo (hay 2 en prod) sin escribir nada:
```sql
begin read only;
select set_config('request.jwt.claims', json_build_object('sub', p.id::text, 'role', 'authenticated')::text, true)
  from public.profiles p where p.is_active = false order by (p.role = 'manager') desc, p.id limit 1;
set local role authenticated;
select public.get_my_role() as rol_visto,
       (select count(*) from public.employees) as employees, (select count(*) from public.tip_entries) as tip_entries,
       (select count(*) from public.tip_sessions) as tip_sessions, (select count(*) from public.role_tip_points) as role_tip_points,
       (select count(*) from public.exchange_rates) as exchange_rates, (select count(*) from public.profiles) as profiles;
rollback;
```
- **Antes:** `rol_visto` null, las cinco tablas con filas y `profiles` 1.
- **Después:** `rol_visto` null, **las cinco en 0** y `profiles` 1.

**4b (Grok 129). Cuentas ACTIVAS: owner, manager, cajero, contador y salonero.** Usa la cuenta activa más antigua de cada rol.
Muestra solo conteos, sin nombres ni ids, en una sola fila:
```sql
begin read only;
-- una cuenta ACTIVA por rol (la más antigua); sin nombres ni ids en el resultado, solo conteos
select set_config('request.jwt.claims', json_build_object('sub', (select p.id from public.profiles p where p.role = 'owner' and p.is_active
         order by p.created_at, p.id limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('humo.owner', json_build_object('hay_cuenta', current_setting('request.jwt.claims')::json->>'sub' is not null, 'rol_visto', public.get_my_role(),
       'employees', (select count(*) from public.employees), 'tip_entries', (select count(*) from public.tip_entries),
       'tip_sessions', (select count(*) from public.tip_sessions), 'role_tip_points', (select count(*) from public.role_tip_points),
       'exchange_rates', (select count(*) from public.exchange_rates), 'profiles', (select count(*) from public.profiles))::text, true);
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select p.id from public.profiles p where p.role = 'manager' and p.is_active
         order by p.created_at, p.id limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('humo.manager', json_build_object('hay_cuenta', current_setting('request.jwt.claims')::json->>'sub' is not null, 'rol_visto', public.get_my_role(),
       'employees', (select count(*) from public.employees), 'tip_entries', (select count(*) from public.tip_entries),
       'tip_sessions', (select count(*) from public.tip_sessions), 'role_tip_points', (select count(*) from public.role_tip_points),
       'exchange_rates', (select count(*) from public.exchange_rates), 'profiles', (select count(*) from public.profiles))::text, true);
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select p.id from public.profiles p where p.role = 'cajero' and p.is_active
         order by p.created_at, p.id limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('humo.cajero', json_build_object('hay_cuenta', current_setting('request.jwt.claims')::json->>'sub' is not null, 'rol_visto', public.get_my_role(),
       'employees', (select count(*) from public.employees), 'tip_entries', (select count(*) from public.tip_entries),
       'tip_sessions', (select count(*) from public.tip_sessions), 'role_tip_points', (select count(*) from public.role_tip_points),
       'exchange_rates', (select count(*) from public.exchange_rates), 'profiles', (select count(*) from public.profiles))::text, true);
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select p.id from public.profiles p where p.role = 'contador' and p.is_active
         order by p.created_at, p.id limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('humo.contador', json_build_object('hay_cuenta', current_setting('request.jwt.claims')::json->>'sub' is not null, 'rol_visto', public.get_my_role(),
       'employees', (select count(*) from public.employees), 'tip_entries', (select count(*) from public.tip_entries),
       'tip_sessions', (select count(*) from public.tip_sessions), 'role_tip_points', (select count(*) from public.role_tip_points),
       'exchange_rates', (select count(*) from public.exchange_rates), 'profiles', (select count(*) from public.profiles))::text, true);
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select p.id from public.profiles p where p.role = 'salonero' and p.is_active
         order by p.created_at, p.id limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('humo.salonero', json_build_object('hay_cuenta', current_setting('request.jwt.claims')::json->>'sub' is not null, 'rol_visto', public.get_my_role(),
       'employees', (select count(*) from public.employees), 'tip_entries', (select count(*) from public.tip_entries),
       'tip_sessions', (select count(*) from public.tip_sessions), 'role_tip_points', (select count(*) from public.role_tip_points),
       'exchange_rates', (select count(*) from public.exchange_rates), 'profiles', (select count(*) from public.profiles))::text, true);
reset role;
select current_setting('humo.owner')::json as owner, current_setting('humo.manager')::json as manager,
       current_setting('humo.cajero')::json as cajero, current_setting('humo.contador')::json as contador,
       current_setting('humo.salonero')::json as salonero;
rollback;
```
- **Regla: después = antes**, para cada rol con `hay_cuenta: true`. Un rol con `hay_cuenta: false` (sin cuenta activa) no se
  compara.
- **staging (09-nov), con la 085 y con la 085 deshecha en la misma transacción:** idéntico.
  - owner 45 · 17 · 3 · 7 · 3 · 10;
  - cajero y salonero 21 · 17 · 3 · 7 · 3 · 1;
  - manager y contador sin cuenta activa en staging.

## 5. Verificación después del merge
1. **Branching:** el check «Supabase Preview» del merge commit en `success`. En el log del panel:
   `Applying migration 085_rls_lectura_rol_activo.sql`. El dueño lo confirma en el panel o con 5.2.
2. **Ledger** (editor SQL de PROD, solo lectura). Si 1.0 dio más de un statement para la 079, en vez del md5: **exactamente
   1 fila 085 con `name = 'rls_lectura_rol_activo'`**, más 5.3 (Grok 122).
   ```sql
   select count(*), max(version) from supabase_migrations.schema_migrations;                       -- 58 · 085
   select md5(statements[1]) from supabase_migrations.schema_migrations where version = '085';    -- 68b6384bd860dcc334919813888cae83
   ```
3. **Catálogo:** la consulta 1.2. Las 7 policies con la condición de «Después», y las otras 8 **sin cambios** contra el
   respaldo.
4. **Humo:** 4a con los números de «Después», y 4b **igual que antes** para cada rol con cuenta (Grok 129).
5. **Pantalla:** el owner abre Caja y Propinas, y alguien con rol de salonero abre Mi Rendimiento. Tienen que ver lo de
   siempre.

## 6. Criterios de parada → vuelta atrás (§7)
- Branching en error (`MIGRATIONS_FAILED`) o aplicando algo que no sea la 085.
- 5.2 con otro md5 (**solo si 1.0 dio un statement**; si dio más, 5.2 es «1 fila 085 con su name»), o 5.3 con alguna policy
  distinta de lo esperado.
- 4a «Después» con alguna de las cinco tablas en más de 0, o `profiles` distinto de 1.
- 4b «Después» distinto de «Antes» en algún rol con cuenta.
- 5.5: un usuario **activo** deja de ver algo que veía.

## 7. Vuelta atrás (todo en la misma ventana; nadie más pushea a `main`)
1. **En prod, UN bloque** (editor SQL, Grok 124). Lleva la precondición, las 8 sentencias de `scripts/sql/085_rollback.sql`
   (sha256 `99ffeedc…`) y el borrado de la fila del ledger. O pasa todo o no pasa nada:
   ```sql
   begin;
   do $$ begin
     if (select count(*) from supabase_migrations.schema_migrations where version = '085') <> 1 then
       raise exception 'precondición: se esperaba exactamente 1 fila 085 en el ledger: no se toca nada';
     end if;
   end $$;
   alter policy "Todos ven empleados activos" on public.employees using (is_active = true);
   alter policy "Todos ven entradas de propinas" on public.tip_entries using (true);
   alter policy "Todos ven sesiones de propinas" on public.tip_sessions using (true);
   alter policy "Todos ven puntos por rol" on public.role_tip_points using (true);
   alter policy "Todos ven tipos de cambio" on public.exchange_rates using (true);
   alter policy exchange_rates_read on public.exchange_rates using (true);
   drop policy if exists "Solo owners crean/editan perfiles" on public.profiles;
   create policy "Solo owners crean/editan perfiles" on public.profiles
     for all to public using (public.get_my_role() = 'owner'::public.user_role);
   delete from supabase_migrations.schema_migrations where version = '085';
   commit;
   ```
   - **staging (09-nov), el mismo bloque con `rollback` en vez de `commit`:**
     - pasó la precondición;
     - dentro de la transacción: fila 085 0, las 6 lecturas con la condición vieja, `profiles` sin `WITH CHECK` y 15
       policies en las 6 tablas;
     - al descartar, la 085 sigue puesta;
     - **con 0 filas 085** (simulado), la precondición frena: «precondición: se esperaba exactamente 1 fila 085…».
   - La comparación campo por campo con el respaldo la hace `085_pruebas.sh … ROLLBACK <respaldo>`: 33/33 el 08-nov, con
     las mismas 8 sentencias.
2. **Enseguida, revert del merge en `main`**, que saca el `.sql`:
   - si el archivo se queda en `main`, Branching la vuelve a aplicar en el próximo push;
   - si se saca el archivo sin borrar la fila, Branching falla en cada push (el caso de la 074).
3. **Verificar:**
   - Branching del revert: «All migrations are up to date»;
   - 1.2: las 15 policies iguales al respaldo;
   - 4a y 4b: los números de «Antes».

## 8. Después del pase
- **Orden en prod: 085 → 089 → 090 → 091 → 092** (Grok 127). Supabase no aplica una migración con número menor que la
  última aplicada, así que los merges a `main` van en ese orden, sin saltos:
  - **085** (este paquete);
  - **089** y **090** de caja (`anon_sin_politica` y `anon_privilegios_por_defecto`; hoy solo en staging), con su paquete y
    firma. Si se decide que pasen **después** de la 091 o la 092, se renumeran al bloque de pase (**150+**) con su
    «origen» (regla 3 de ESTADO.md);
  - **091** de caja (`multilocal_fase0`, rama `claude/multilocal-fase0`);
  - **092** de caja (abajo);
  - después, el **pase del Club**: la 075 como **150** y la 100 como **151** (#81).
- **La 092 de caja** (`092_employees_borrado_solo_owner`, rama `claude/employees-borrado-owner`) va **después** de la 085,
  con su propio paquete y firma.
  - Las dos tocan `employees`: la 085 cambia una policy de lectura, y la 092 agrega un trigger de borrado y la tabla
    `employee_bajas`. No chocan.
  - El orden queda fijo para que el ledger de prod suba en orden: 082 → 085 → 089 → 090 → 091 → 092 → 150 → 151.
- Anotar en `ESTADO.md` la 085 en prod (ledger 58), con el SHA del merge.
- Volver a correr `085_pruebas.sh` en staging en modo DESPUES después de cualquier cambio en esas 6 tablas.

## 9. Firma y bitácora
| Paso | Esperado | Obtenido |
|---|---|---|
| Firma del dueño (fecha y hora `-06:00`, SHA de la cabeza del PR) | | |
| Responsables (ejecución / control) | | |
| 0.4 `main` sin moverse · diff solo los archivos del PR | | |
| 1.1 ledger 57 · 082 · ninguna versión mayor que 082 | | |
| 1.0 statements de la 079 y la 080 → regla de 5.2 (Grok 122) | | |
| 1.2 15 policies = respaldo · RLS en las 6 | | |
| 1.3 vistas · funciones SECURITY DEFINER sobre las 5 tablas: 0 (Grok 130) | | |
| 4a antes (cuenta inactiva): 5 tablas con filas · profiles 1 | | |
| 4b antes (activas): owner / manager / cajero / contador / salonero, conteos de las 6 tablas | | |
| **Gate de CI en la cabeza del PR** (Grok 125): los checks del PR en verde en el SHA que se firma (enlace a la corrida), **o** la aceptación explícita del dueño de mergear sin ese verde, con el motivo | | |
| §2 merge (SHA, hora) | | |
| 5.1 Branching success · log con la 085 | | |
| 5.2 ledger 58 · 085 · md5 `68b6384b…` (o «1 fila 085 con su name» según 1.0) | | |
| 5.3 las 7 policies en «Después» · las otras 8 iguales | | |
| 4a después: 0 · 0 · 0 · 0 · 0 · profiles 1 | | |
| 4b después = 4b antes, en cada rol con cuenta | | |
| 5.5 pantalla OK (owner, salonero) | | |
| Cierre: pasa / vuelta atrás (hasta qué paso de §7) | | |
