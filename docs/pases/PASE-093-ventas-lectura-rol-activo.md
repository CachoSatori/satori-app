# Pase a PROD de la mig 093 `ventas_lectura_rol_activo` (Grok 126)

> **Estado: preparado, SIN ejecutar.** Formato del `PASE-085` (rama `claude/pase-085`,
> `docs/pases/PASE-085-rls-lectura-rol-activo.md`): qué cambia, lecturas previas, prueba en staging, humo de solo
> lectura, vuelta atrás y firma.
>
> **Nada de este documento se ejecuta en prod hasta que el dueño lo firme (§9).** Si algo no coincide con lo que dice
> acá, **se para y se avisa**: no se improvisa en prod.
>
> - **Orden en prod: 085 → 089 → 090 → 091 → 092 → 093.** Supabase no aplica una migración con número menor que la
>   última aplicada: la 093 va **después** de la 092 (§8).
> - **Regla del ledger (Grok 122):** Branching guarda las migraciones **partidas** en varios statements. La verificación
>   es «exactamente 1 fila 093 con su `name`» más el catálogo (5.3). **No se compara md5.**

## Qué pasa y qué no
- **Pasa:** las lecturas de ventas dejan de responder a una cuenta **inactiva** que conserva su sesión. Es el mismo
  hueco que la 085 cerró en empleados y propinas (Grok 126, auditoría de la 085).

  | Tabla | Policy | Antes (`USING`) | Después (`USING`) |
  |---|---|---|---|
  | ventas_dias | `ventas_dias_read` (SELECT) | `true` | `(select get_my_role()) is not null` |
  | ventas_hist | `ventas_hist_read` (SELECT) | `true` | `(select get_my_role()) is not null` |
  | ventas_metas | `ventas_metas_read` (SELECT) | `true` | `(select get_my_role()) is not null` |
  | ventas_comps | `ventas_comps_read` (SELECT) | `true` | `(select get_my_role()) is not null` |
  | product_map | `product_map_read` (SELECT) | `true` | `(select get_my_role()) is not null` |

  Desde la 069, `get_my_role()` da null para una cuenta inactiva. El `(select …)` hace que se calcule una vez por
  consulta y no por fila.
- **No pasa:**
  - los usuarios **activos** ven exactamente lo mismo;
  - las policies `<tabla>_write` (owner, manager y contador) no cambian;
  - `exchange_rates` no se toca (ya la cubrió la 085);
  - `anon` sigue sin leer;
  - sin datos, sin funciones, sin tablas: solo 5 `alter policy` en una transacción.

## SHA y huellas (completos; se comparan enteros)
| Qué | Valor |
|---|---|
| Rama | `claude/ventas-lectura-rol-activo` (desde `main` @ `5a22478`) |
| `supabase/migrations/093_ventas_lectura_rol_activo.sql` | md5 `d5b5173c595600cd4f52dfa1052e0d1e` · sha256 `faca1dc89d7ebc8694b45545228dcffbda4e2c6b4fab6c38d887a7f9238b55c3` |
| `scripts/sql/093_rollback.sql` | sha256 `4309631ec5dcbcc014d567dfe267def67ed45c596f3e0f9d317ea4594d20df1a` |

Los md5 sirven para comprobar el archivo, **no** para el ledger de prod (Grok 122).

## Responsables
- **Ejecución:** el dueño. Firma, lee el catálogo de prod en el editor SQL, mergea (o autoriza el merge) y corre la
  prueba de humo.
- **Control:** el encargado del turno. Lee en voz alta cada resultado esperado contra el obtenido. No es la misma
  persona.
- **Claude no corre nada en prod.** Prepara, revisa y lee los resultados que le pasan.

## 0. Prerrequisitos
| # | Qué | Cómo se verifica |
|---|---|---|
| 0.1 | Firma del dueño en §9 (con el SHA de la cabeza del PR) | firma |
| 0.2 | Los dos responsables presentes | §9 |
| 0.3 | **No se mergea entre las 17:00 y las 23:00 CR**, y ninguna otra sesión mergeando a `main` | hora en §9 |
| 0.4 | La rama al día con `main` y el diff con **solo** los archivos del PR (§2) | `git merge-base --is-ancestor`, `git diff --name-only` |
| 0.5 | Gate del PR en verde: `supabase/migraciones.test.ts` (la 093 está registrada) y build | checks del PR |
| 0.6 | Staging en verde con este mismo archivo (§3) | anotado |
| 0.7 | **La 092 ya está en prod** y no hay ninguna migración con número mayor que 093 en `main` ni en el ledger de prod | 1.1 |

## 1. Lecturas previas (SOLO LECTURA, en PROD)
Editor SQL de PROD. **Leer el ref en pantalla.** Anotar cada resultado en §9.
```sql
-- 1.1 ledger: el último es la 092 y la 093 no está
select count(*), max(version) from supabase_migrations.schema_migrations;               -- anotar · 092
select version from supabase_migrations.schema_migrations where version >= '093';       -- 0 filas
-- 1.2 las 10 policies de las 5 tablas (5 _read con using true, 5 _write) y RLS activa
select tablename, policyname, cmd, qual, with_check from pg_policies
 where schemaname = 'public' and tablename in ('ventas_dias','ventas_hist','ventas_metas','ventas_comps','product_map')
 order by 1, 2;                                    -- 10 filas: las _read con qual «true»; anotar las _write tal cual
select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace
   and relname in ('ventas_dias','ventas_hist','ventas_metas','ventas_comps','product_map');   -- 5 · true
-- 1.3 qué más lee estas tablas sin pasar por las policies (vistas y funciones SECURITY DEFINER)
begin read only;
select x.tipo, x.objeto from (
  select distinct 'vista' as tipo, r.ev_class::regclass::text as objeto
    from pg_depend d join pg_rewrite r on r.oid = d.objid
   where d.classid = 'pg_rewrite'::regclass and d.refclassid = 'pg_class'::regclass
     and d.refobjid in ('public.ventas_dias'::regclass, 'public.ventas_hist'::regclass, 'public.ventas_metas'::regclass,
                        'public.ventas_comps'::regclass, 'public.product_map'::regclass)
     and r.ev_class not in ('public.ventas_dias'::regclass, 'public.ventas_hist'::regclass, 'public.ventas_metas'::regclass,
                            'public.ventas_comps'::regclass, 'public.product_map'::regclass)
  union all
  select 'funcion SECURITY DEFINER', p.oid::regprocedure::text
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef
     and p.prosrc ~* '\m(ventas_dias|ventas_hist|ventas_metas|ventas_comps|product_map)\M'
) x order by 1, 2;
rollback;
```
- **1.3 esperado: 0 filas.** Si aparece una función, tiene que estar en `supabase/migrations/` de `main` y no devolver
  filas de estas tablas a cualquier usuario. **Una vista, o una función que no está en el repo: PARADA.**

Más la **prueba de humo de antes** (§4): 4a con una cuenta inactiva (las cinco tablas con filas) y **4b justo antes del
merge**.

**Para (no se sigue)** si:
- el ledger no termina en 092 o ya tiene la 093;
- alguna de las 5 policies `_read` no existe o no tiene `qual` = `true` (un `alter policy` sobre una policy que no
  existe hace fallar la migración, y Branching queda en `MIGRATIONS_FAILED`);
- no hay ninguna cuenta inactiva para la prueba de humo;
- 1.3 da una vista, o una función que no está en el repo.

## 2. El cambio: merge del PR → Supabase Branching aplica la 093
- El PR trae **solo** estos archivos:
  - `supabase/migrations/093_ventas_lectura_rol_activo.sql`;
  - `scripts/sql/093_rollback.sql`;
  - `scripts/sql/093_pruebas.sh` (sin el ref de prod: solo acepta el de staging);
  - `supabase/migraciones-reservadas.json` y `ESTADO.md` (registro de la 093);
  - este documento.
- **Se aplica con el merge, no a mano:** Branching corre `migrate` contra prod en cada push a `main`.
- **Merge commit**, con la firma de §9. Anotar el SHA y la hora (`-06:00`).

## 3. Prueba en staging (transacciones descartadas; la 093 NO queda aplicada)
`scripts/sql/093_pruebas.sh hwiatgicyyqyezqwldia`, 21 casos:
- cada tabla recibe una fila sintética dentro de la transacción, para no comparar nunca «0 = 0»;
- catálogo: hoy las 5 lecturas abiertas; con la 093, las 5 exigen rol y las 5 escrituras no cambian;
- owner, manager, contador, cajero y salonero **activos**: ven lo mismo que la base, sin y con la 093 (10 casos);
- cajero y owner **inactivos**: sin la 093 leen todo (el hueco); con la 093, 0 en las cinco (4 casos);
- `anon`: no lee ninguna, sin y con la 093;
- vuelta atrás: la 093 + el rollback deja a la cuenta inactiva leyendo como antes y las 5 lecturas en `using (true)`;
- estado final: staging sin la 093, sin filas de prueba y sin fila 093 en el ledger.

| Cuándo | Qué | Resultado |
|---|---|---|
| _pendiente_ (10-nov, después de la ventana de las 23:35) | `093_pruebas.sh hwiatgicyyqyezqwldia` | _pendiente_ |

## 4. Prueba de humo en PROD (SOLO LECTURA: `begin read only` … `rollback`)
Se corre **antes** del merge (§1) y **después** (5.4).

**4a. Cuenta INACTIVA** (sin escribir nada):
```sql
begin read only;
select set_config('request.jwt.claims', json_build_object('sub', p.id::text, 'role', 'authenticated')::text, true)
  from public.profiles p where p.is_active = false order by (p.role = 'manager') desc, p.id limit 1;
set local role authenticated;
select public.get_my_role() as rol_visto, (select count(*) from public.ventas_dias) as ventas_dias,
       (select count(*) from public.ventas_hist) as ventas_hist, (select count(*) from public.ventas_metas) as ventas_metas,
       (select count(*) from public.ventas_comps) as ventas_comps, (select count(*) from public.product_map) as product_map;
rollback;
```
- **Antes:** `rol_visto` null y las cinco tablas con filas.
- **Después:** `rol_visto` null y **las cinco en 0**.

**4b. Cuentas ACTIVAS: owner, manager, cajero, contador y salonero** (la más antigua de cada rol; solo conteos, sin
nombres ni ids):
```sql
begin read only;
select set_config('request.jwt.claims', json_build_object('sub', (select p.id from public.profiles p where p.role = 'owner' and p.is_active
         order by p.created_at, p.id limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('humo.owner', json_build_object('hay_cuenta', current_setting('request.jwt.claims')::json->>'sub' is not null,
       'rol_visto', public.get_my_role(), 'ventas_dias', (select count(*) from public.ventas_dias), 'ventas_hist', (select count(*) from public.ventas_hist),
       'ventas_metas', (select count(*) from public.ventas_metas), 'ventas_comps', (select count(*) from public.ventas_comps),
       'product_map', (select count(*) from public.product_map))::text, true);
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select p.id from public.profiles p where p.role = 'manager' and p.is_active
         order by p.created_at, p.id limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('humo.manager', json_build_object('hay_cuenta', current_setting('request.jwt.claims')::json->>'sub' is not null,
       'rol_visto', public.get_my_role(), 'ventas_dias', (select count(*) from public.ventas_dias), 'ventas_hist', (select count(*) from public.ventas_hist),
       'ventas_metas', (select count(*) from public.ventas_metas), 'ventas_comps', (select count(*) from public.ventas_comps),
       'product_map', (select count(*) from public.product_map))::text, true);
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select p.id from public.profiles p where p.role = 'cajero' and p.is_active
         order by p.created_at, p.id limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('humo.cajero', json_build_object('hay_cuenta', current_setting('request.jwt.claims')::json->>'sub' is not null,
       'rol_visto', public.get_my_role(), 'ventas_dias', (select count(*) from public.ventas_dias), 'ventas_hist', (select count(*) from public.ventas_hist),
       'ventas_metas', (select count(*) from public.ventas_metas), 'ventas_comps', (select count(*) from public.ventas_comps),
       'product_map', (select count(*) from public.product_map))::text, true);
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select p.id from public.profiles p where p.role = 'contador' and p.is_active
         order by p.created_at, p.id limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('humo.contador', json_build_object('hay_cuenta', current_setting('request.jwt.claims')::json->>'sub' is not null,
       'rol_visto', public.get_my_role(), 'ventas_dias', (select count(*) from public.ventas_dias), 'ventas_hist', (select count(*) from public.ventas_hist),
       'ventas_metas', (select count(*) from public.ventas_metas), 'ventas_comps', (select count(*) from public.ventas_comps),
       'product_map', (select count(*) from public.product_map))::text, true);
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select p.id from public.profiles p where p.role = 'salonero' and p.is_active
         order by p.created_at, p.id limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('humo.salonero', json_build_object('hay_cuenta', current_setting('request.jwt.claims')::json->>'sub' is not null,
       'rol_visto', public.get_my_role(), 'ventas_dias', (select count(*) from public.ventas_dias), 'ventas_hist', (select count(*) from public.ventas_hist),
       'ventas_metas', (select count(*) from public.ventas_metas), 'ventas_comps', (select count(*) from public.ventas_comps),
       'product_map', (select count(*) from public.product_map))::text, true);
reset role;
select current_setting('humo.owner')::json as owner, current_setting('humo.manager')::json as manager,
       current_setting('humo.cajero')::json as cajero, current_setting('humo.contador')::json as contador,
       current_setting('humo.salonero')::json as salonero,
       -- base: lo que hay en cada tabla, como postgres (sin policies), en la misma transacción
       json_build_object('ventas_dias', (select count(*) from public.ventas_dias), 'ventas_hist', (select count(*) from public.ventas_hist),
       'ventas_metas', (select count(*) from public.ventas_metas), 'ventas_comps', (select count(*) from public.ventas_comps),
       'product_map', (select count(*) from public.product_map)) as base;
rollback;
```
- **El «antes» de 4b se corre justo antes del merge.**
- **Regla: después = antes** en cada rol con `hay_cuenta: true`. Un rol sin cuenta activa no se compara.
- **Una diferencia que también aparece en `base`** (por ejemplo, se cargó un día de ventas entre las dos lecturas) **no es
  parada**. Es parada si la diferencia de un rol no está en `base`, o si es distinta.

## 5. Verificación después del merge
1. **Branching:** el check «Supabase Preview» del merge commit en `success`; en el log,
   `Applying migration 093_ventas_lectura_rol_activo.sql`.
2. **Ledger** (solo lectura): **exactamente 1 fila 093 con su `name`**. No se compara md5 (Grok 122).
   ```sql
   select count(*), max(version) from supabase_migrations.schema_migrations;                      -- anterior + 1 · 093
   select count(*) from supabase_migrations.schema_migrations
    where version = '093' and name = 'ventas_lectura_rol_activo';                                 -- 1
   select array_length(statements, 1) from supabase_migrations.schema_migrations where version = '093';  -- anotar
   ```
3. **Catálogo:** 1.2 de nuevo. Las 5 `_read` con `( SELECT get_my_role() AS get_my_role) IS NOT NULL`, y las 5 `_write`
   iguales a lo anotado en 1.2.
4. **Humo:** 4a con los números de «Después» y 4b igual que antes.
5. **Pantalla:** el owner abre Ventas (días, histórico, metas, comparaciones). Tiene que ver lo de siempre.

## 6. Criterios de parada → vuelta atrás (§7)
- Branching en error (`MIGRATIONS_FAILED`) o aplicando algo que no sea la 093.
- 5.2 sin exactamente 1 fila 093 con `name = 'ventas_lectura_rol_activo'`, o 5.3 con alguna policy distinta.
- 4a «Después» con alguna tabla en más de 0.
- 4b «Después» distinto de «Antes» en algún rol con cuenta (salvo que la diferencia también esté en `base`).
- 5.5: un usuario **activo** deja de ver algo que veía.

## 7. Vuelta atrás (todo en la misma ventana; nadie más pushea a `main`)
1. **En prod, UN bloque** (editor SQL): precondición, las 5 sentencias de `scripts/sql/093_rollback.sql` y el borrado de
   la fila del ledger. O pasa todo o no pasa nada:
   ```sql
   begin;
   do $$ begin
     if (select count(*) from supabase_migrations.schema_migrations where version = '093') <> 1 then
       raise exception 'precondición: se esperaba exactamente 1 fila 093 en el ledger: no se toca nada';
     end if;
   end $$;
   alter policy ventas_dias_read  on public.ventas_dias  using (true);
   alter policy ventas_hist_read  on public.ventas_hist  using (true);
   alter policy ventas_metas_read on public.ventas_metas using (true);
   alter policy ventas_comps_read on public.ventas_comps using (true);
   alter policy product_map_read  on public.product_map  using (true);
   delete from supabase_migrations.schema_migrations where version = '093';
   commit;
   ```
2. **Enseguida, revert del merge en `main`**, que saca el `.sql`:
   - si el archivo se queda en `main`, Branching la vuelve a aplicar en el próximo push;
   - si se saca el archivo sin borrar la fila, Branching falla en cada push (el caso de la 074).
3. **Verificar:** Branching del revert «All migrations are up to date»; 1.2 con las 5 `_read` en `true`; 4a y 4b con
   los números de «Antes».

## 8. Orden en prod
**085 → 089 → 090 → 091 → 092 → 093.** Supabase no aplica una migración con número menor que la última aplicada, así
que los merges a `main` van en ese orden, sin saltos. Si se decide que la 093 pase **antes** de alguna de esas, esa otra
se renumera al bloque de pase (150+) con su «origen» (regla 3 de ESTADO.md). Después va el pase del Club (075 → 150,
100 → 151).

## 9. Firma y bitácora
| Paso | Esperado | Obtenido |
|---|---|---|
| Firma del dueño (fecha y hora `-06:00`, SHA de la cabeza del PR) | | |
| Responsables (ejecución / control) | | |
| 0.4 rama al día con `main` · diff solo los archivos del PR | | |
| 0.7 la 092 en prod | | |
| 1.1 ledger: último 092 · ninguna versión ≥ 093 | | |
| 1.2 5 `_read` en `true` · 5 `_write` anotadas · RLS en las 5 | | |
| 1.3 vistas · funciones SECURITY DEFINER: 0 | | |
| 4a antes (cuenta inactiva): las 5 con filas | | |
| 4b antes (activas), justo antes del merge | | |
| Gate de CI en la cabeza del PR (enlace), o la aceptación explícita del dueño sin ese verde, con el motivo | | |
| §2 merge (SHA, hora) | | |
| 5.1 Branching success · log con la 093 | | |
| 5.2 exactamente 1 fila 093 con `name = 'ventas_lectura_rol_activo'` (statements: anotar) | | |
| 5.3 las 5 `_read` en «Después» · las 5 `_write` iguales | | |
| 4a después: 0 · 0 · 0 · 0 · 0 | | |
| 4b después = 4b antes (una diferencia que también está en `base` no es parada) | | |
| 5.5 pantalla de Ventas OK (owner) | | |
| Cierre: pasa / vuelta atrás (hasta qué paso de §7) | | |
