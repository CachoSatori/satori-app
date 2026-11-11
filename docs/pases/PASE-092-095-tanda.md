# Pase a PROD de la tanda 092 → 095 (un solo merge)

> **Estado: EJECUTADO y CERRADO (10-nov-2026, adelantado del 11 por decisión del dueño). La 092, la 093, la 094 y la 095 están en prod (PR #107, merge `c41e18b`, 22:57:17 -06:00; ledger 65 · 095). Resultado en §9.**
>
> Antes: preparado. Formato del `PASE-089`. **Decisión del dueño (10-nov):** el 11-nov van **dos tandas**:
> 1. la **091 sola**, con su `PASE-091` (cabeza `5b6cd05`);
> 2. **la 092, la 093, la 094 y la 095 juntas, en UN merge** de `claude/contador-lee-caja` (`c78b4c2`, que trae las
>    cuatro), **después** de que la 091 esté en prod con su pase cerrado.
>
> Este documento reemplaza, para la tanda, la secuencia de los §1–§9 de los cuatro PASE individuales. Esos PASE siguen
> valiendo como detalle de cada migración (qué hace, pruebas, vuelta atrás). **Nada se ejecuta en prod hasta que el dueño
> firme el §9.** Si algo no coincide con lo que dice acá, **se para y se avisa**.
>
> - **Regla del ledger (Grok 122):** Branching guarda cada migración partida en varios statements. La verificación es
>   «exactamente 1 fila por versión con su `name`» más el catálogo. **No se compara md5.**
> - **Repo público:** en la bitácora se anotan conteos y huellas, nunca montos ni nombres.

## Qué pasa y qué no
| Mig | Qué cambia (una línea) | PASE con el detalle |
|---|---|---|
| 092 | Solo el owner borra un empleado con login del PoS. Cada borrado deja en `employee_bajas` solo lo mínimo (id, login, nombre, fechas, quién y cuándo) | `PASE-092-borrado-solo-owner.md` |
| 093 | Las 5 lecturas de ventas (`*_read`) exigen cuenta activa | `PASE-093-ventas-lectura-rol-activo.md` |
| 094 | `anon` pierde MAINTAIN en las 20 tablas de la 089; la migración se verifica sola | `PASE-094-anon-sin-maintain.md` |
| 095 | El contador activo **lee** `cash_movements`, `cash_sessions` y `suppliers`, sin ninguna escritura nueva (OK explícito del dueño; la 038 queda como está) | `PASE-095-contador-lee-caja.md` |

**No pasa:** ningún cambio de pantalla salvo que el contador ve datos en Caja (guía 6.2). Los usuarios activos ven lo
mismo. No toca dinero, sagrados ni el cierre.

## SHA y huellas (completos; se comparan enteros)
| Mig | Cabeza de su rama (cada una sobre la anterior) | md5 migración | md5 rollback |
|---|---|---|---|
| 092 | `claude/employees-borrado-owner` @ `e31fc886635871a9d598c6b7fcf3a2b703d923b0` | `03f2dfed3f86502c2b9043e85d340b0d` | `1c02bb0b16188d2ef4822cb3cbf2ee80` |
| 093 | `claude/ventas-lectura-rol-activo` @ `8a1f1c64d6a8e976f284675d6577b9e84eb59a45` | `d5b5173c595600cd4f52dfa1052e0d1e` | `10bc50a1cb6739956ba21a42f530335f` |
| 094 | `claude/anon-sin-maintain` @ `ab80c1671657f31b8f6de4806a8ac24a723747c7` | `bfa5a7866684c732493e60542b022168` | `f0827dfb814407b356fe8c8eb8bec9c0` |
| 095 | `claude/contador-lee-caja` @ `c78b4c20b26a0a103d1b5fa91f58462fa7128c3a` hoy (la que se mergea: trae las cuatro). **Se firma la cabeza nueva**, al día con `main` con la 091 (Grok 176) | `a8959a18071320f6af63aaafeddd4166` | `3af4c58fa9bab50435c61f47079d8129` |

- **Los PR ya existen (#103 a #107). La tanda 092→095 se mergea por el #107 (`claude/contador-lee-caja`); al entrar, el #104, #105 y #106 quedan incluidos.** La 091 va antes, sola, por el #103.
- **Grok 176: la firma de la tanda NO va sobre `c78b4c2`.** Mañana, con la 091 ya en `main` (merge del #103) y su pase
  cerrado, se trae `main` a `claude/contador-lee-caja` con un merge commit. Después se verifica, contra `c78b4c2`:
  - que solo entró ese merge;
  - que los blobs de las cuatro migraciones y sus rollbacks son los mismos (md5 de esta tabla).
  La **cabeza nueva** es la que se firma (§9).
- **El #108 (este PASE combinado, solo docs) NO se mergea a `main` antes que el #107.**
- Los #104, #105 y #106 (092, 093 y 094) quedan incluidos: sus cabezas son ancestros de `c78b4c2`, y GitHub los marca
  como mergeados al entrar.
- Los md5 sirven para comprobar los archivos, **no** para el ledger de prod.

## Responsables
- **Ejecución:** el dueño. Firma, corre las lecturas en el editor SQL de prod, mergea (o autoriza el merge) y corre la
  prueba de humo.
- **Control:** el encargado del turno. Lee en voz alta cada esperado contra lo obtenido. No es la misma persona.
- **Claude no corre nada en prod.** Prepara, revisa y lee los resultados que le pasan.

## 0. Prerrequisitos
| # | Qué | Cómo se verifica |
|---|---|---|
| 0.1 | Firma del dueño en §9, con la cabeza `c78b4c2` y los md5 de las cuatro | firma |
| 0.2 | Los dos responsables presentes | §9 |
| 0.3 | **No se mergea entre las 17:00 y las 23:00 CR** (regla fija; cualquier excepción la escribe el dueño en su firma del §9), y ninguna otra sesión mergeando a `main` | hora en §9 |
| 0.4 | **La 091 en prod con su pase CERRADO** (PR #103 mergeado; §9 del PASE-091 «pasa»): **ledger 61 · 091** | bloque A, `ledger` |
| 0.5 | **Ninguna versión ≥ 092 en el ledger de prod**, y ninguna `09[2-9]_*.sql` en `main` antes del merge | bloque A, `desde_092` = `[]` |
| 0.6 | `claude/contador-lee-caja` al día con `main` (con la 091 ya mergeada): `main` es ancestro de la cabeza, y el diff contra `main` trae **solo** los archivos de la 092 a la 095 (registro, guías 6.6 y 6.2, PASE, scripts y las 4 migraciones) | `git merge-base --is-ancestor`, `git diff --name-only` |
| 0.7 | Gate del PR: `supabase/migraciones.test.ts` (las cuatro registradas) y build; o la aceptación del dueño sin CI de pruebas (125) | checks del PR |
| 0.8 | Staging en verde con estas mismas migraciones (§3) | anotado |

**Pase seguido:** la 091 puede haber entrado minutos antes, en la misma mañana. No se pide tiempo de espera. Se pide que su
pase esté **cerrado** (merge con «Supabase Preview» en `success`, §5 en verde y §9 «pasa»). Si el run de Branching de la
091 todavía corre, **se espera a que termine**. Si la 091 hizo vuelta atrás, **la tanda no se hace**.

## 1. Lecturas previas (SOLO LECTURA, en PROD)
Editor SQL de PROD. **Leer el ref en pantalla.** Se agrupan en **dos bloques**, más el respaldo del ACL que pide la 094.
Los bloques son los archivos `scripts/sql/tanda_092_095_bloque_*.sql`, copiados acá tal cual.

**Bloque A (ANTES) — catálogo de las cuatro, una sola fila JSON** (reúne el 1.1–1.4 de la 092, el 1.2–1.3 de la 093, el
1.2 de la 094 y el 1.2 de la 095). **Grok 178:** trae un freno (`do … raise`) que da PARADA y lista qué no dio si algo no
coincide con lo esperado. Igual se lee el JSON en voz alta. **Grok 177:** suma la huella (md5) de las 5 `_read` y de las 3
`*_contador_select`: tabla, nombre, cmd, roles, `qual` y `with_check`, con el texto para diagnosticar.
```sql
-- BLOQUE A (ANTES) · catálogo de la tanda 092 → 095, una sola fila JSON, con freno (Grok 178). SOLO LECTURA.
begin read only;
select set_config('tanda.a', (json_build_object(
  -- 1.1 ledger
  'ledger', (select json_build_object('filas', count(*),
               'ultima', max(version) filter (where version ~ '^[0-9]{3}$'),
               'desde_092', coalesce(json_agg(version order by version) filter (where version ~ '^[0-9]{3}$' and version >= '092'), '[]'::json))
             from supabase_migrations.schema_migrations),
  -- 092 · 1.2 la verificación (scripts/sql/092_verificacion.sql)
  'v092', (select json_build_object(
  'ledger_092',        exists (select 1 from supabase_migrations.schema_migrations where version = '092'),
  'tabla',             to_regclass('public.employee_bajas') is not null,
  'rls_tabla',         coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.employee_bajas')), false),
  'politicas',         (select coalesce(json_agg(policyname || ':' || cmd order by policyname), '[]'::json)
                          from pg_policies where schemaname = 'public' and tablename = 'employee_bajas'),
  'anon_sin_permisos', to_regclass('public.employee_bajas') is null
                       or not exists (select 1 from information_schema.role_table_grants
                                       where table_schema = 'public' and table_name = 'employee_bajas' and grantee = 'anon'),
  'funcion_definer',   coalesce((select prosecdef from pg_proc where oid = to_regprocedure('public.employees_borrado_guardia()')), false),
  'funcion_no_publica', to_regprocedure('public.employees_borrado_guardia()') is null
                       or not (has_function_privilege('anon', 'public.employees_borrado_guardia()', 'execute')
                            or has_function_privilege('authenticated', 'public.employees_borrado_guardia()', 'execute')),
  'trigger_activo',    exists (select 1 from pg_trigger where tgname = 'trg_employees_borrado_guardia'
                                and tgrelid = 'public.employees'::regclass and tgenabled = 'O'),
  'bajas',             case when to_regclass('public.employee_bajas') is null then null
                            else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.employee_bajas', false, true, '')))[1]::text::int end
)),
  -- 092 · 1.3 qué protege (solo conteos) y 1.4 los triggers de employees
  'v092_empleados', (select json_build_object('con_login', count(*) filter (where pos_login is not null),
                        'con_login_sin_propinas', count(*) filter (where pos_login is not null
                          and not exists (select 1 from public.tip_entries t where t.employee_id = e.id)))
                     from public.employees e),
  'v092_triggers_employees', (select coalesce(json_agg(tgname order by tgname), '[]'::json) from pg_trigger
                               where tgrelid = 'public.employees'::regclass and not tgisinternal),
  -- 093 · 1.2 las 10 policies de ventas (las _read y la huella de las _write) y la RLS de las 5
  'v093', (select json_build_object(
              'read_abiertas', count(*) filter (where policyname = tablename || '_read' and qual = 'true'),
              'read_con_rol',  count(*) filter (where policyname = tablename || '_read' and qual ~ 'get_my_role' and qual ~ 'IS NOT NULL'),
              'write', count(*) filter (where policyname = tablename || '_write'),
              'write_md5', md5(coalesce(string_agg(tablename || '|' || qual || '|' || coalesce(with_check, ''), E'\n' order by tablename)
                                        filter (where policyname = tablename || '_write'), '')))
           from pg_policies where schemaname = 'public'
            and tablename in ('ventas_dias','ventas_hist','ventas_metas','ventas_comps','product_map')),
  'v093_rls', (select count(*) filter (where relrowsecurity) from pg_class where relnamespace = 'public'::regnamespace
                 and relname in ('ventas_dias','ventas_hist','ventas_metas','ventas_comps','product_map')),
  -- 093 · 1.3 vistas y funciones SECURITY DEFINER que leen ventas sin pasar por las policies
  'v093_lectores_sin_rls', (select coalesce(json_agg(x order by x), '[]'::json) from (
      select distinct 'vista ' || r.ev_class::regclass::text as x
        from pg_depend d join pg_rewrite r on r.oid = d.objid
       where d.classid = 'pg_rewrite'::regclass and d.refclassid = 'pg_class'::regclass
         and d.refobjid in ('public.ventas_dias'::regclass, 'public.ventas_hist'::regclass, 'public.ventas_metas'::regclass,
                            'public.ventas_comps'::regclass, 'public.product_map'::regclass)
         and r.ev_class not in ('public.ventas_dias'::regclass, 'public.ventas_hist'::regclass, 'public.ventas_metas'::regclass,
                                'public.ventas_comps'::regclass, 'public.product_map'::regclass)
      union all
      select 'funcion ' || p.oid::regprocedure::text from pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.prosecdef
         and p.prosrc ~* '\m(ventas_dias|ventas_hist|ventas_metas|ventas_comps|product_map)\M') q),
  -- 094 · 1.2 la verificación (scripts/sql/094_verificacion.sql)
  'v094', (with lista(t) as (values ('accounting_entries'),('cash_movements'),('cash_sessions'),('credit_applications'),
  ('movement_deletions'),('movement_edits'),('pos_ndf_cursor'),('pos_ndf_open'),('pos_ndf_ticket_lines'),('pos_ndf_tickets'),
  ('product_map'),('punch_exceptions'),('sops'),('supplier_credits'),('suppliers'),('time_punches'),('tip_entries'),
  ('tip_sessions'),('ventas_comps'),('ventas_dias'),('ventas_hist'),('ventas_metas'),('salary_periods')),
ex as (select t, ('public.' || t)::regclass as r from lista where to_regclass('public.' || t) is not null)
select json_build_object(
  'tablas', (select count(*) from ex),
  'anon_maintain', (select count(*) from ex where has_table_privilege('anon', r, 'MAINTAIN')),
  'anon_otros', (select count(*) from ex cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) p where has_table_privilege('anon', r, p)),
  'anon_trt', (select count(*) from ex cross join unnest(array['TRUNCATE','REFERENCES','TRIGGER']) p where has_table_privilege('anon', r, p)),
  'public', (select count(*) from ex join pg_class c on c.oid = ex.r cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a where a.grantee = 0),
  'authenticated_maintain', (select count(*) from ex where has_table_privilege('authenticated', r, 'MAINTAIN')),
  'ledger_094', exists (select 1 from supabase_migrations.schema_migrations where version = '094')
)),
  -- 095 · 1.2 las policies de las 3 tablas de caja
  'v095', (select json_build_object('contador_select', count(*) filter (where policyname like '%\_contador\_select'),
              'policies', json_agg(tablename || '.' || policyname || ':' || cmd order by tablename, policyname))
           from pg_policies where schemaname = 'public' and tablename in ('cash_movements','cash_sessions','suppliers')),
  -- 177 · huella de las 5 _read y de las 3 *_contador_select (tabla, nombre, cmd, roles, qual, with_check)
  'v093_read_md5', (select md5(coalesce(string_agg(tablename || '|' || policyname || '|' || cmd || '|' || roles::text || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''), E'\n' order by tablename), ''))
                      from pg_policies where schemaname = 'public' and policyname = tablename || '_read'
                       and tablename in ('ventas_dias','ventas_hist','ventas_metas','ventas_comps','product_map')),
  'v095_contador_md5', (select md5(coalesce(string_agg(tablename || '|' || policyname || '|' || cmd || '|' || roles::text || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''), E'\n' order by tablename), ''))
                      from pg_policies where schemaname = 'public'
                       and policyname in ('cash_movements_contador_select','cash_sessions_contador_select','suppliers_contador_select')),
  'v093_v095_texto', (select json_agg(tablename || '|' || policyname || '|' || cmd || '|' || roles::text || '|' || permissive || '|' || coalesce(qual, '') order by tablename, policyname)
                      from pg_policies where schemaname = 'public' and (policyname = tablename || '_read'
                       and tablename in ('ventas_dias','ventas_hist','ventas_metas','ventas_comps','product_map')
                       or policyname in ('cash_movements_contador_select','cash_sessions_contador_select','suppliers_contador_select')))
))::text, true);
-- 178 · freno: si algo no da lo esperado, PARADA (el error lista qué). Se sigue leyendo en voz alta el JSON igual.
do $chk$
declare j jsonb := current_setting('tanda.a')::jsonb; m text := '';
begin
  if not ((j#>>'{ledger,filas}')::int = 61) then m := m || ' · ledger.filas≠61'; end if;
  if not (j#>>'{ledger,ultima}' = '091') then m := m || ' · ledger.ultima≠091'; end if;
  if not (j#>'{ledger,desde_092}' = '[]'::jsonb) then m := m || ' · hay versiones ≥092'; end if;
  if not (j->'v092' = '{"ledger_092":false,"tabla":false,"rls_tabla":false,"politicas":[],"anon_sin_permisos":true,"funcion_definer":false,"funcion_no_publica":true,"trigger_activo":false,"bajas":null}'::jsonb) then m := m || ' · v092≠antes'; end if;
  if not (not (j->'v092_triggers_employees') ? 'trg_employees_borrado_guardia') then m := m || ' · ya existe trg_employees_borrado_guardia'; end if;
  if not ((j#>>'{v093,read_abiertas}')::int = 5 and (j#>>'{v093,read_con_rol}')::int = 0 and (j#>>'{v093,write}')::int = 5) then m := m || ' · v093≠5·0·5'; end if;
  if not ((j->>'v093_rls')::int = 5) then m := m || ' · v093_rls≠5'; end if;
  if not (j->'v093_lectores_sin_rls' = '[]'::jsonb) then m := m || ' · hay lectores de ventas sin RLS'; end if;
  if not ((j#>>'{v094,tablas}')::int = 20 and (j#>>'{v094,anon_maintain}')::int = 20 and (j#>>'{v094,anon_trt}')::int = 0 and (j#>>'{v094,public}')::int = 0 and (j#>>'{v094,ledger_094}')::boolean = false) then m := m || ' · v094≠20·20·0·0·false'; end if;
  if not ((j#>>'{v095,contador_select}')::int = 0) then m := m || ' · v095.contador_select≠0'; end if;
  if m <> '' then raise exception 'PARADA (bloque A antes): no da%', m; end if;
end $chk$;
select current_setting('tanda.a')::json as tanda_antes;
rollback;
```
**Esperado ANTES en prod** (anotar el JSON entero en §9):
- `ledger`: `filas` **61**, `ultima` **091**, `desde_092` **[]** (las históricas 0090 y 0095 no entran: no son de 3 dígitos);
- `v092`: estado de «antes»: `ledger_092` false, `tabla` false, `rls_tabla` false, `politicas` [],
  `anon_sin_permisos` true, `funcion_definer` false, `funcion_no_publica` true, `trigger_activo` false, `bajas` null;
- `v092_empleados`: anotar `con_login` y `con_login_sin_propinas`;
- `v092_triggers_employees`: anotar; **no** puede estar `trg_employees_borrado_guardia`;
- `v093`: `read_abiertas` **5**, `read_con_rol` **0**, `write` **5**, `write_md5` anotar; `v093_rls` **5**;
  `v093_lectores_sin_rls` **[]**;
- `v094`: `tablas` **20**, `anon_maintain` **20**, `anon_trt` 0, `public` 0, `ledger_094` false; `anon_otros` y
  `authenticated_maintain` anotar;
- `v095`: `contador_select` **0**; `policies` anotar (la lista entera: en 5.3 tiene que ser la misma más las 3 nuevas);
- `v093_read_md5` y `v095_contador_md5`: anotar (antes de la tanda la segunda es el md5 de la nada).

**Bloque B — respaldo del ACL de las 20 tablas** (el 1.2b de la 094, que es el 1.2b del PASE-089). Correr (a) y (b) por
separado. Guardar las 20 filas de (a) fuera del repo y anotar los dos sha256:
```sql
-- BLOQUE B · respaldo del ACL de las 20 tablas (lo pide la 094; es la consulta 1.2b del PASE-089). SOLO LECTURA.
-- Correr (a) y (b) por separado: el editor muestra el resultado de la última sentencia. Guardar las 20 filas de (a) fuera
-- del repo y anotar los dos sha256 de (b).
-- (a) el ACL tal cual, tabla por tabla
select c.relname, c.relacl::text as relacl
  from pg_class c
 where c.relnamespace = 'public'::regnamespace
   and c.relname in ('accounting_entries','cash_movements','cash_sessions','credit_applications','movement_deletions',
     'movement_edits','pos_ndf_cursor','pos_ndf_open','pos_ndf_ticket_lines','pos_ndf_tickets','product_map','sops',
     'supplier_credits','suppliers','tip_entries','tip_sessions','ventas_comps','ventas_dias','ventas_hist','ventas_metas')
 order by 1;
-- (b) sus dos huellas: la del texto tal cual y la normalizada (permiso por permiso, ordenada)
with lista(t) as (values ('accounting_entries'),('cash_movements'),('cash_sessions'),('credit_applications'),
  ('movement_deletions'),('movement_edits'),('pos_ndf_cursor'),('pos_ndf_open'),('pos_ndf_ticket_lines'),('pos_ndf_tickets'),
  ('product_map'),('sops'),('supplier_credits'),('suppliers'),('tip_entries'),('tip_sessions'),('ventas_comps'),
  ('ventas_dias'),('ventas_hist'),('ventas_metas')),
acl as (
  select c.relname, c.relacl::text as relacl,
         (select string_agg(coalesce(nullif(a.grantee, 0)::regrole::text, 'PUBLIC') || ':' || a.privilege_type || ':' || a.is_grantable,
                            ',' order by 1) from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a) as normalizado
    from lista join pg_class c on c.oid = to_regclass('public.' || lista.t))
select count(*) as tablas,
       encode(sha256(convert_to(string_agg(relname || '|' || coalesce(relacl, '(null)'), E'\n' order by relname), 'UTF8')), 'hex') as sha256_relacl,
       encode(sha256(convert_to(string_agg(relname || '|' || normalizado, E'\n' order by relname), 'UTF8')), 'hex') as sha256_normalizado
  from acl;
```

**Para (no se sigue)** si:
- el ledger no da 61 · 091, o ya hay alguna versión ≥ 092;
- `v092` no da el estado de «antes», o ya existe `trg_employees_borrado_guardia`;
- `v093` no da 5 lecturas abiertas, o `v093_lectores_sin_rls` no está vacío;
- `v094.anon_maintain` no es 20, o `public` / `anon_trt` no son 0;
- `v095.contador_select` no es 0;
- **Grok 185:** el bloque B no dio **20** tablas, o el respaldo **no quedó guardado fuera del repo** con sus **dos sha256**
  anotados.

## 2. El cambio: UN merge → Branching aplica 092, 093, 094 y 095, en orden
- **UN merge commit** del PR #107 (`claude/contador-lee-caja` @ `c78b4c2`), con la firma del §9. Anotar el SHA y la hora
  (`-06:00`).
- **Qué hace Branching** (como `supabase migration up`): aplica los archivos pendientes **en orden de versión**: 092,
  093, 094 y 095. Cada archivo corre en **su propia transacción** y escribe su fila del ledger al confirmarse.
  - Si uno falla, **ese no queda** y los siguientes **no se intentan**. Los anteriores **sí** quedan.
  - El comportamiento se confirma con el log del panel (`Applying migration 09x_….sql`, uno por uno) y con el ledger
    (bloque D). No se da por supuesto.
- La 094 y la 095 se verifican solas: si su verificación interna falla, abortan.

## 3. Prueba en staging (hecha; las cuatro aplicadas en staging el 10-nov)
| Mig | Aplicada en staging | Prueba (transacciones descartadas) |
|---|---|---|
| 092 | 10-nov 11:03:09 CR (transacción con precondición y su fila) | `092_pruebas.sh` **12 OK · 0 FALLA** |
| 093 | 10-nov 11:03:11 CR | `093_pruebas.sh` **21 OK · 0 FALLA** (antes de aplicarla) |
| 094 | 10-nov 11:03:30 CR | `094_pruebas.sh` **8 OK · 0 FALLA** (antes de aplicarla) |
| 095 | 10-nov 11:03:32 CR | `095_pruebas.sh` **24 OK · 0 FALLA** |

**Los bloques de este documento, probados en staging el 10-nov a la noche (solo lectura).** Staging tiene las cuatro
aplicadas y, además, la 150 y la 151 del Club (91 filas, última 151):
- **A (ANTES):** frena, listando todo lo que ya no está como «antes». Es lo esperado: staging está en «después».
- **A (DESPUÉS):** frena solo por el ledger (91 · 151) y por la 094, porque staging tiene 23 tablas y prod 20. Las
  comprobaciones de la 092, la 093 y la 095 **pasan**, con los dos md5 de la 177.
- **D:** frena solo por `filas≠65 · última≠095` (la 150 y la 151 del Club). La tanda da 4 filas con su `name`.
- **E con la precondición de la 175, en READ ONLY:** **las cuatro frenan** con «la última versión del ledger no es la
  09x», porque la última es la 151. Es justo el caso de la 175: una versión posterior impide deshacer.

Las corridas de la versión anterior de los bloques (antes de la 175–178):
- **A, B y D:** corren y dan la forma esperada. Staging ya tiene las cuatro, así que muestran el estado de «después»:
  - **A:** `v093.read_con_rol` 5, `v094.anon_maintain` 0, `v095.contador_select` 3;
  - **D:** 4 filas con su `name`, 1 statement cada una y `repetidas` vacía.
- **C:** corre en `begin read only`:
  - en staging no hay manager ni contador activos, así que dan `hay_cuenta` false;
  - la cuenta inactiva da 0 en todo;
  - el owner da lo mismo que `base`.
- **E (vuelta atrás) en una transacción READ ONLY:**
  - **E.095** pasa su precondición y frena en la primera escritura (25006). Eso prueba la precondición sin escribir nada;
  - **E.092** frena en su precondición, porque hay versiones mayores de la tanda en el ledger: «hay una versión mayor de
    la tanda en el ledger: deshacerla antes que la 092». Es el orden al revés que se busca.

## 4. Prueba de humo combinada (SOLO LECTURA: `begin read only` … `rollback`)
**Bloque C — humo de las cuatro en un solo bloque.** Incluye:
- la 4a de la 093: la cuenta **inactiva**, con `hay_cuenta`;
- la 4a de la 095: el **contador** activo;
- la 4b de la 092, la 093 y la 094: owner, manager, cajero, contador y salonero.

Solo conteos de 10 tablas, sin nombres ni ids. Se corre **antes**, justo antes del merge, y **después**.
```sql
-- BLOQUE C · humo combinado de la tanda (4a/4b de la 093 y la 095, y 4b de la 092 y la 094). SOLO LECTURA: solo conteos.
begin read only;
select set_config('request.jwt.claims', json_build_object('sub', (select p.id from public.profiles p where p.role = 'owner' and p.is_active
         order by p.created_at, p.id limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('humo.owner', json_build_object('hay_cuenta', (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub') is not null,
       'rol_visto', public.get_my_role(), 'ventas_dias', (select count(*) from public.ventas_dias), 'ventas_hist', (select count(*) from public.ventas_hist), 'ventas_metas', (select count(*) from public.ventas_metas), 'ventas_comps', (select count(*) from public.ventas_comps), 'product_map', (select count(*) from public.product_map), 'cash_movements', (select count(*) from public.cash_movements), 'cash_sessions', (select count(*) from public.cash_sessions), 'suppliers', (select count(*) from public.suppliers), 'employees', (select count(*) from public.employees), 'tip_entries', (select count(*) from public.tip_entries))::text, true);
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select p.id from public.profiles p where p.role = 'manager' and p.is_active
         order by p.created_at, p.id limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('humo.manager', json_build_object('hay_cuenta', (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub') is not null,
       'rol_visto', public.get_my_role(), 'ventas_dias', (select count(*) from public.ventas_dias), 'ventas_hist', (select count(*) from public.ventas_hist), 'ventas_metas', (select count(*) from public.ventas_metas), 'ventas_comps', (select count(*) from public.ventas_comps), 'product_map', (select count(*) from public.product_map), 'cash_movements', (select count(*) from public.cash_movements), 'cash_sessions', (select count(*) from public.cash_sessions), 'suppliers', (select count(*) from public.suppliers), 'employees', (select count(*) from public.employees), 'tip_entries', (select count(*) from public.tip_entries))::text, true);
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select p.id from public.profiles p where p.role = 'cajero' and p.is_active
         order by p.created_at, p.id limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('humo.cajero', json_build_object('hay_cuenta', (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub') is not null,
       'rol_visto', public.get_my_role(), 'ventas_dias', (select count(*) from public.ventas_dias), 'ventas_hist', (select count(*) from public.ventas_hist), 'ventas_metas', (select count(*) from public.ventas_metas), 'ventas_comps', (select count(*) from public.ventas_comps), 'product_map', (select count(*) from public.product_map), 'cash_movements', (select count(*) from public.cash_movements), 'cash_sessions', (select count(*) from public.cash_sessions), 'suppliers', (select count(*) from public.suppliers), 'employees', (select count(*) from public.employees), 'tip_entries', (select count(*) from public.tip_entries))::text, true);
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select p.id from public.profiles p where p.role = 'contador' and p.is_active
         order by p.created_at, p.id limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('humo.contador', json_build_object('hay_cuenta', (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub') is not null,
       'rol_visto', public.get_my_role(), 'ventas_dias', (select count(*) from public.ventas_dias), 'ventas_hist', (select count(*) from public.ventas_hist), 'ventas_metas', (select count(*) from public.ventas_metas), 'ventas_comps', (select count(*) from public.ventas_comps), 'product_map', (select count(*) from public.product_map), 'cash_movements', (select count(*) from public.cash_movements), 'cash_sessions', (select count(*) from public.cash_sessions), 'suppliers', (select count(*) from public.suppliers), 'employees', (select count(*) from public.employees), 'tip_entries', (select count(*) from public.tip_entries))::text, true);
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select p.id from public.profiles p where p.role = 'salonero' and p.is_active
         order by p.created_at, p.id limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('humo.salonero', json_build_object('hay_cuenta', (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub') is not null,
       'rol_visto', public.get_my_role(), 'ventas_dias', (select count(*) from public.ventas_dias), 'ventas_hist', (select count(*) from public.ventas_hist), 'ventas_metas', (select count(*) from public.ventas_metas), 'ventas_comps', (select count(*) from public.ventas_comps), 'product_map', (select count(*) from public.product_map), 'cash_movements', (select count(*) from public.cash_movements), 'cash_sessions', (select count(*) from public.cash_sessions), 'suppliers', (select count(*) from public.suppliers), 'employees', (select count(*) from public.employees), 'tip_entries', (select count(*) from public.tip_entries))::text, true);
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select p.id from public.profiles p where p.is_active = false
         order by p.created_at, p.id limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('humo.inactiva', json_build_object('hay_cuenta', (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub') is not null,
       'rol_visto', public.get_my_role(), 'ventas_dias', (select count(*) from public.ventas_dias), 'ventas_hist', (select count(*) from public.ventas_hist), 'ventas_metas', (select count(*) from public.ventas_metas), 'ventas_comps', (select count(*) from public.ventas_comps), 'product_map', (select count(*) from public.product_map), 'cash_movements', (select count(*) from public.cash_movements), 'cash_sessions', (select count(*) from public.cash_sessions), 'suppliers', (select count(*) from public.suppliers), 'employees', (select count(*) from public.employees), 'tip_entries', (select count(*) from public.tip_entries))::text, true);
reset role;
select current_setting('humo.owner')::json as owner, current_setting('humo.manager')::json as manager, current_setting('humo.cajero')::json as cajero, current_setting('humo.contador')::json as contador, current_setting('humo.salonero')::json as salonero, current_setting('humo.inactiva')::json as inactiva,
       json_build_object('ventas_dias', (select count(*) from public.ventas_dias), 'ventas_hist', (select count(*) from public.ventas_hist), 'ventas_metas', (select count(*) from public.ventas_metas), 'ventas_comps', (select count(*) from public.ventas_comps), 'product_map', (select count(*) from public.product_map), 'cash_movements', (select count(*) from public.cash_movements), 'cash_sessions', (select count(*) from public.cash_sessions), 'suppliers', (select count(*) from public.suppliers), 'employees', (select count(*) from public.employees), 'tip_entries', (select count(*) from public.tip_entries)) as base;
rollback;
```
**Reglas:**
- **`inactiva.hay_cuenta` tiene que ser `true`.** Sin cuenta inactiva, la 4a de la 093 queda NO PROBADO y es **PARADA**
  (Grok 141).
- **Después, la inactiva** da 0 en todo, incluidas las 5 de ventas: es lo que cierra la 093.
- **Después, el contador** (si `hay_cuenta` es true) ve en `cash_movements`, `cash_sessions` y `suppliers` lo mismo que
  `base`: es lo que abre la 095. En las otras 7 tablas, lo mismo que antes. Si no hay contador activo en prod, la 4a de la
  095 se anota «sin cuenta» y vale la prueba de staging.
- **Owner, manager, cajero y salonero:** después = antes. Una diferencia que también está en `base` (algo cargado entre
  las dos lecturas) no es parada.

**Pantallas (4c):**
- **sin sesión (Grok 179): `/login` y `/registro`** abren como siempre;
- el owner abre Caja, Propinas, Ventas y Admin → Empleados;
- el contador abre Caja y ve datos;
- nada nuevo en rojo.

## 5. Verificación después del merge
1. **Branching:** el «Supabase Preview» del merge commit que termina en `success`. Los otros con el mismo nombre que
   quedan en «in progress» no cuentan. En el log, las cuatro `Applying migration …`, en orden.
2. **Ledger, bloque D:** **65 filas, última 095**, `tanda` con exactamente 4 filas (092, 093, 094 y 095), cada una con su
   `name`, `repetidas` [] y `names_ok` 4. **Grok 178:** el bloque frena (PARADA) si algo de eso no da. Anotar `statements`
   de cada una (sin valor esperado).
   ```sql
-- BLOQUE D · el ledger de la tanda después del merge (5.2), con freno (Grok 178). SOLO LECTURA.
-- Frena si no da: 65 filas, última 095, 4 filas de la tanda, names_ok 4, repetidas []. Se sigue leyendo en voz alta igual.
begin read only;
select set_config('tanda.d', (json_build_object(
  'filas', (select count(*) from supabase_migrations.schema_migrations),
  'ultima', (select max(version) from supabase_migrations.schema_migrations where version ~ '^[0-9]{3}$'),
  'tanda', (select coalesce(json_agg(json_build_object('v', version, 'name', name, 'statements', array_length(statements, 1)) order by version), '[]'::json)
              from supabase_migrations.schema_migrations where version in ('092','093','094','095')),
  'repetidas', (select coalesce(json_agg(version), '[]'::json) from (select version from supabase_migrations.schema_migrations
                  where version in ('092','093','094','095') group by version having count(*) <> 1) r),
  'names_ok', (select count(*) from supabase_migrations.schema_migrations where (version, name) in
                 (('092','employees_borrado_solo_owner'), ('093','ventas_lectura_rol_activo'), ('094','anon_sin_maintain'), ('095','contador_lee_caja')))
))::text, true);
do $chk$
declare j jsonb := current_setting('tanda.d')::jsonb; m text := '';
begin
  if (j->>'filas')::int <> 65 then m := m || ' · filas≠65'; end if;
  if j->>'ultima' <> '095' then m := m || ' · última≠095'; end if;
  if jsonb_array_length(j->'tanda') <> 4 then m := m || ' · la tanda no tiene 4 filas'; end if;
  if (j->>'names_ok')::int <> 4 then m := m || ' · names_ok≠4'; end if;
  if j->'repetidas' <> '[]'::jsonb then m := m || ' · hay versiones repetidas'; end if;
  if m <> '' then raise exception 'PARADA (bloque D): no da%', m; end if;
end $chk$;
select current_setting('tanda.d')::json as ledger_tanda;
rollback;
   ```
3. **Catálogo: bloque A (DESPUÉS)**, el mismo JSON con el freno del estado de «después» (Grok 177 y 178):
   ```sql
-- BLOQUE A (DESPUÉS) · el mismo JSON, con el freno del estado de «después» (Grok 177 y 178). SOLO LECTURA.
-- Las huellas esperadas de las _read y de las *_contador_select son las de staging (10-nov), con las cuatro aplicadas.
begin read only;
select set_config('tanda.a', (json_build_object(
  -- 1.1 ledger
  'ledger', (select json_build_object('filas', count(*),
               'ultima', max(version) filter (where version ~ '^[0-9]{3}$'),
               'desde_092', coalesce(json_agg(version order by version) filter (where version ~ '^[0-9]{3}$' and version >= '092'), '[]'::json))
             from supabase_migrations.schema_migrations),
  -- 092 · 1.2 la verificación (scripts/sql/092_verificacion.sql)
  'v092', (select json_build_object(
  'ledger_092',        exists (select 1 from supabase_migrations.schema_migrations where version = '092'),
  'tabla',             to_regclass('public.employee_bajas') is not null,
  'rls_tabla',         coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.employee_bajas')), false),
  'politicas',         (select coalesce(json_agg(policyname || ':' || cmd order by policyname), '[]'::json)
                          from pg_policies where schemaname = 'public' and tablename = 'employee_bajas'),
  'anon_sin_permisos', to_regclass('public.employee_bajas') is null
                       or not exists (select 1 from information_schema.role_table_grants
                                       where table_schema = 'public' and table_name = 'employee_bajas' and grantee = 'anon'),
  'funcion_definer',   coalesce((select prosecdef from pg_proc where oid = to_regprocedure('public.employees_borrado_guardia()')), false),
  'funcion_no_publica', to_regprocedure('public.employees_borrado_guardia()') is null
                       or not (has_function_privilege('anon', 'public.employees_borrado_guardia()', 'execute')
                            or has_function_privilege('authenticated', 'public.employees_borrado_guardia()', 'execute')),
  'trigger_activo',    exists (select 1 from pg_trigger where tgname = 'trg_employees_borrado_guardia'
                                and tgrelid = 'public.employees'::regclass and tgenabled = 'O'),
  'bajas',             case when to_regclass('public.employee_bajas') is null then null
                            else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.employee_bajas', false, true, '')))[1]::text::int end
)),
  -- 092 · 1.3 qué protege (solo conteos) y 1.4 los triggers de employees
  'v092_empleados', (select json_build_object('con_login', count(*) filter (where pos_login is not null),
                        'con_login_sin_propinas', count(*) filter (where pos_login is not null
                          and not exists (select 1 from public.tip_entries t where t.employee_id = e.id)))
                     from public.employees e),
  'v092_triggers_employees', (select coalesce(json_agg(tgname order by tgname), '[]'::json) from pg_trigger
                               where tgrelid = 'public.employees'::regclass and not tgisinternal),
  -- 093 · 1.2 las 10 policies de ventas (las _read y la huella de las _write) y la RLS de las 5
  'v093', (select json_build_object(
              'read_abiertas', count(*) filter (where policyname = tablename || '_read' and qual = 'true'),
              'read_con_rol',  count(*) filter (where policyname = tablename || '_read' and qual ~ 'get_my_role' and qual ~ 'IS NOT NULL'),
              'write', count(*) filter (where policyname = tablename || '_write'),
              'write_md5', md5(coalesce(string_agg(tablename || '|' || qual || '|' || coalesce(with_check, ''), E'\n' order by tablename)
                                        filter (where policyname = tablename || '_write'), '')))
           from pg_policies where schemaname = 'public'
            and tablename in ('ventas_dias','ventas_hist','ventas_metas','ventas_comps','product_map')),
  'v093_rls', (select count(*) filter (where relrowsecurity) from pg_class where relnamespace = 'public'::regnamespace
                 and relname in ('ventas_dias','ventas_hist','ventas_metas','ventas_comps','product_map')),
  -- 093 · 1.3 vistas y funciones SECURITY DEFINER que leen ventas sin pasar por las policies
  'v093_lectores_sin_rls', (select coalesce(json_agg(x order by x), '[]'::json) from (
      select distinct 'vista ' || r.ev_class::regclass::text as x
        from pg_depend d join pg_rewrite r on r.oid = d.objid
       where d.classid = 'pg_rewrite'::regclass and d.refclassid = 'pg_class'::regclass
         and d.refobjid in ('public.ventas_dias'::regclass, 'public.ventas_hist'::regclass, 'public.ventas_metas'::regclass,
                            'public.ventas_comps'::regclass, 'public.product_map'::regclass)
         and r.ev_class not in ('public.ventas_dias'::regclass, 'public.ventas_hist'::regclass, 'public.ventas_metas'::regclass,
                                'public.ventas_comps'::regclass, 'public.product_map'::regclass)
      union all
      select 'funcion ' || p.oid::regprocedure::text from pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.prosecdef
         and p.prosrc ~* '\m(ventas_dias|ventas_hist|ventas_metas|ventas_comps|product_map)\M') q),
  -- 094 · 1.2 la verificación (scripts/sql/094_verificacion.sql)
  'v094', (with lista(t) as (values ('accounting_entries'),('cash_movements'),('cash_sessions'),('credit_applications'),
  ('movement_deletions'),('movement_edits'),('pos_ndf_cursor'),('pos_ndf_open'),('pos_ndf_ticket_lines'),('pos_ndf_tickets'),
  ('product_map'),('punch_exceptions'),('sops'),('supplier_credits'),('suppliers'),('time_punches'),('tip_entries'),
  ('tip_sessions'),('ventas_comps'),('ventas_dias'),('ventas_hist'),('ventas_metas'),('salary_periods')),
ex as (select t, ('public.' || t)::regclass as r from lista where to_regclass('public.' || t) is not null)
select json_build_object(
  'tablas', (select count(*) from ex),
  'anon_maintain', (select count(*) from ex where has_table_privilege('anon', r, 'MAINTAIN')),
  'anon_otros', (select count(*) from ex cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) p where has_table_privilege('anon', r, p)),
  'anon_trt', (select count(*) from ex cross join unnest(array['TRUNCATE','REFERENCES','TRIGGER']) p where has_table_privilege('anon', r, p)),
  'public', (select count(*) from ex join pg_class c on c.oid = ex.r cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a where a.grantee = 0),
  'authenticated_maintain', (select count(*) from ex where has_table_privilege('authenticated', r, 'MAINTAIN')),
  'ledger_094', exists (select 1 from supabase_migrations.schema_migrations where version = '094')
)),
  -- 095 · 1.2 las policies de las 3 tablas de caja
  'v095', (select json_build_object('contador_select', count(*) filter (where policyname like '%\_contador\_select'),
              'policies', json_agg(tablename || '.' || policyname || ':' || cmd order by tablename, policyname))
           from pg_policies where schemaname = 'public' and tablename in ('cash_movements','cash_sessions','suppliers')),
  -- 177 · huella de las 5 _read y de las 3 *_contador_select (tabla, nombre, cmd, roles, qual, with_check)
  'v093_read_md5', (select md5(coalesce(string_agg(tablename || '|' || policyname || '|' || cmd || '|' || roles::text || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''), E'\n' order by tablename), ''))
                      from pg_policies where schemaname = 'public' and policyname = tablename || '_read'
                       and tablename in ('ventas_dias','ventas_hist','ventas_metas','ventas_comps','product_map')),
  'v095_contador_md5', (select md5(coalesce(string_agg(tablename || '|' || policyname || '|' || cmd || '|' || roles::text || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''), E'\n' order by tablename), ''))
                      from pg_policies where schemaname = 'public'
                       and policyname in ('cash_movements_contador_select','cash_sessions_contador_select','suppliers_contador_select')),
  'v093_v095_texto', (select json_agg(tablename || '|' || policyname || '|' || cmd || '|' || roles::text || '|' || permissive || '|' || coalesce(qual, '') order by tablename, policyname)
                      from pg_policies where schemaname = 'public' and (policyname = tablename || '_read'
                       and tablename in ('ventas_dias','ventas_hist','ventas_metas','ventas_comps','product_map')
                       or policyname in ('cash_movements_contador_select','cash_sessions_contador_select','suppliers_contador_select')))
))::text, true);
-- 178 · freno: si algo no da lo esperado, PARADA (el error lista qué). Se sigue leyendo en voz alta el JSON igual.
do $chk$
declare j jsonb := current_setting('tanda.a')::jsonb; m text := '';
begin
  if not ((j#>>'{ledger,filas}')::int = 65) then m := m || ' · ledger.filas≠65'; end if;
  if not (j#>>'{ledger,ultima}' = '095') then m := m || ' · ledger.ultima≠095'; end if;
  if not (j#>'{ledger,desde_092}' = '["092","093","094","095"]'::jsonb) then m := m || ' · desde_092≠[092..095]'; end if;
  if not (j->'v092' = '{"ledger_092":true,"tabla":true,"rls_tabla":true,"politicas":["employee_bajas_select_owner:SELECT"],"anon_sin_permisos":true,"funcion_definer":true,"funcion_no_publica":true,"trigger_activo":true,"bajas":0}'::jsonb) then m := m || ' · v092≠después'; end if;
  if not ((j->'v092_triggers_employees') ? 'trg_employees_borrado_guardia') then m := m || ' · falta trg_employees_borrado_guardia'; end if;
  if not ((j#>>'{v093,read_abiertas}')::int = 0 and (j#>>'{v093,read_con_rol}')::int = 5 and (j#>>'{v093,write}')::int = 5) then m := m || ' · v093≠0·5·5'; end if;
  if not ((j->>'v093_rls')::int = 5) then m := m || ' · v093_rls≠5'; end if;
  if not (j->>'v093_read_md5' = 'c25aabee6ae97e32a55119725ba95d99') then m := m || ' · v093_read_md5≠staging'; end if;
  if not ((j#>>'{v094,tablas}')::int = 20 and (j#>>'{v094,anon_maintain}')::int = 0 and (j#>>'{v094,anon_trt}')::int = 0 and (j#>>'{v094,public}')::int = 0 and (j#>>'{v094,ledger_094}')::boolean) then m := m || ' · v094≠20·0·0·0·true'; end if;
  if not ((j#>>'{v095,contador_select}')::int = 3) then m := m || ' · v095.contador_select≠3'; end if;
  if not (j->>'v095_contador_md5' = 'bd9d17e15125957009e90a37bcf068bd') then m := m || ' · v095_contador_md5≠staging'; end if;
  if m <> '' then raise exception 'PARADA (bloque A despues): no da%', m; end if;
end $chk$;
select current_setting('tanda.a')::json as tanda_despues;
rollback;
   ```
   Tiene que dar (el freno lo controla):
   - `v092`: `ledger_092` true, `tabla` true, `rls_tabla` true, `politicas` `["employee_bajas_select_owner:SELECT"]`,
     `anon_sin_permisos` true, `funcion_definer` true, `funcion_no_publica` true, `trigger_activo` true, `bajas` 0;
   - `v092_triggers_employees`: lo de antes más `trg_employees_borrado_guardia`;
   - `v093`: `read_abiertas` 0, `read_con_rol` 5, `write` 5, **`write_md5` igual al de antes**; `v093_rls` 5;
   - `v094`: `anon_maintain` **0**, con `tablas`, `anon_otros`, `anon_trt`, `public` y `authenticated_maintain` iguales a
     los de antes; `ledger_094` true;
   - `v095`: `contador_select` **3**, y `policies` = la lista de antes más las 3 `*_contador_select`;
   - **`v093_read_md5` = `c25aabee6ae97e32a55119725ba95d99`** y **`v095_contador_md5` = `bd9d17e15125957009e90a37bcf068bd`**
     (los de staging del 10-nov, con las cuatro aplicadas). Si una no da, se compara `v093_v095_texto` con el texto de
     staging antes de decidir: una diferencia de cómo Postgres escribe la expresión no es lo mismo que otra condición.
4. **Humo:** bloque C con las reglas del §4, y las pantallas sin rojos.

## 6. Criterios de parada → vuelta atrás (§7)
- Branching en error (`MIGRATIONS_FAILED`): una de las cuatro falló a mitad de camino.
- El bloque D frena (no da 65 · 095, o falta alguna versión, o alguna está repetida o con otro `name`).
- El bloque A (DESPUÉS) frena.
- El bloque A después con algún valor distinto de lo esperado en 5.3.
- El bloque C después: la inactiva con algo en ventas; el contador sin ver caja (con `hay_cuenta` true); otro rol que
  cambió sin que `base` lo explique.
- Una pantalla rota.

## 7. Vuelta atrás (todo en la misma ventana; nadie más pushea a `main`)
**7.1 Qué quedó aplicado se sabe por el ledger** (bloque D, `tanda`):

| `tanda` en el ledger | Qué pasó | Qué se deshace, en este orden |
|---|---|---|
| `[]` | Falló la 092: nada aplicado | nada; solo el revert del merge (7.3) |
| `[092]` | Falló la 093 | E.092 |
| `[092, 093]` | Falló la 094 | E.093 → E.092 |
| `[092, 093, 094]` | Falló la 095 | E.094 → E.093 → E.092 |
| `[092, 093, 094, 095]` | Entraron las cuatro, pero falló la verificación del §5 | E.095 → E.094 → E.093 → E.092 |

Por defecto, ante cualquier falla se deshace **toda la tanda**. No se deja `main` con archivos de la tanda sin su fila:
Branching volvería a intentarlos en cada push. Dejar aplicadas las que pasaron y sacar solo las que fallaron es otra
decisión del dueño, con un PR propio.

**7.2 Los rollbacks, al revés, cada uno en UNA transacción con su precondición.** Exactamente 1 fila de esa versión y
ninguna versión mayor de la tanda: así no se puede deshacer una antes que la de arriba. Es el archivo
`scripts/sql/tanda_092_095_bloque_E_vuelta_atras.sql`, copiado tal cual.
```sql
-- BLOQUE E · vuelta atrás de la tanda, AL REVÉS: 095 → 094 → 093 → 092. Cada bloque es UNA transacción y se corre solo
-- si su versión está en el ledger (ver la tabla de §7). La precondición exige exactamente 1 fila de esa versión, que sea la
-- ÚLTIMA del ledger y que el ledger tenga 61+n filas (Grok 175). Después de la última: el bloque D0 tiene que dar la tanda
-- vacía, y recién ahí el revert del merge (Grok 186).

-- ── E.095 ─────────────────────────────────────────────────────────────────────
begin;
do $pre$ begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '095') <> 1 then
    raise exception 'precondición: se esperaba exactamente 1 fila 095 en el ledger: no se toca nada';
  end if;
  -- Grok 175: la ÚLTIMA versión del ledger tiene que ser exactamente la 095 y tiene que haber 65 filas. Una 096, una 150
  -- o cualquier otra que haya entrado después la frena.
  if (select max(version) from supabase_migrations.schema_migrations where version ~ '^[0-9]{3}$') <> '095' then
    raise exception 'precondición: la última versión del ledger no es la 095: no se toca nada';
  end if;
  if (select count(*) from supabase_migrations.schema_migrations) <> 65 then
    raise exception 'precondición: el ledger no tiene 65 filas: no se toca nada';
  end if;
end $pre$;
drop policy if exists cash_movements_contador_select on public.cash_movements;
drop policy if exists cash_sessions_contador_select on public.cash_sessions;
drop policy if exists suppliers_contador_select on public.suppliers;
delete from supabase_migrations.schema_migrations where version = '095';
commit;

-- ── E.094 ─────────────────────────────────────────────────────────────────────
begin;
do $pre$ begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '094') <> 1 then
    raise exception 'precondición: se esperaba exactamente 1 fila 094 en el ledger: no se toca nada';
  end if;
  -- Grok 175: la ÚLTIMA versión del ledger tiene que ser exactamente la 094 y tiene que haber 64 filas. Una 096, una 150
  -- o cualquier otra que haya entrado después la frena.
  if (select max(version) from supabase_migrations.schema_migrations where version ~ '^[0-9]{3}$') <> '094' then
    raise exception 'precondición: la última versión del ledger no es la 094: no se toca nada';
  end if;
  if (select count(*) from supabase_migrations.schema_migrations) <> 64 then
    raise exception 'precondición: el ledger no tiene 64 filas: no se toca nada';
  end if;
end $pre$;
do $$
declare v_t text;
begin
  foreach v_t in array array[
    'accounting_entries','cash_movements','cash_sessions','credit_applications','movement_deletions','movement_edits',
    'pos_ndf_cursor','pos_ndf_open','pos_ndf_ticket_lines','pos_ndf_tickets','product_map','punch_exceptions','sops',
    'supplier_credits','suppliers','time_punches','tip_entries','tip_sessions','ventas_comps','ventas_dias','ventas_hist',
    'ventas_metas','salary_periods'] loop
    continue when to_regclass('public.' || v_t) is null;
    execute format('grant maintain on table public.%I to anon', v_t);
  end loop;
end $$;
delete from supabase_migrations.schema_migrations where version = '094';
commit;

-- ── E.093 ─────────────────────────────────────────────────────────────────────
begin;
do $pre$ begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '093') <> 1 then
    raise exception 'precondición: se esperaba exactamente 1 fila 093 en el ledger: no se toca nada';
  end if;
  -- Grok 175: la ÚLTIMA versión del ledger tiene que ser exactamente la 093 y tiene que haber 63 filas. Una 096, una 150
  -- o cualquier otra que haya entrado después la frena.
  if (select max(version) from supabase_migrations.schema_migrations where version ~ '^[0-9]{3}$') <> '093' then
    raise exception 'precondición: la última versión del ledger no es la 093: no se toca nada';
  end if;
  if (select count(*) from supabase_migrations.schema_migrations) <> 63 then
    raise exception 'precondición: el ledger no tiene 63 filas: no se toca nada';
  end if;
end $pre$;
alter policy ventas_dias_read  on public.ventas_dias  using (true);
alter policy ventas_hist_read  on public.ventas_hist  using (true);
alter policy ventas_metas_read on public.ventas_metas using (true);
alter policy ventas_comps_read on public.ventas_comps using (true);
alter policy product_map_read  on public.product_map  using (true);
delete from supabase_migrations.schema_migrations where version = '093';
commit;

-- ── E.092 ─────────────────────────────────────────────────────────────────────
begin;
do $pre$ begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '092') <> 1 then
    raise exception 'precondición: se esperaba exactamente 1 fila 092 en el ledger: no se toca nada';
  end if;
  -- Grok 175: la ÚLTIMA versión del ledger tiene que ser exactamente la 092 y tiene que haber 62 filas. Una 096, una 150
  -- o cualquier otra que haya entrado después la frena.
  if (select max(version) from supabase_migrations.schema_migrations where version ~ '^[0-9]{3}$') <> '092' then
    raise exception 'precondición: la última versión del ledger no es la 092: no se toca nada';
  end if;
  if (select count(*) from supabase_migrations.schema_migrations) <> 62 then
    raise exception 'precondición: el ledger no tiene 62 filas: no se toca nada';
  end if;
end $pre$;
do $$ begin
  if to_regclass('public.employee_bajas') is not null and exists (select 1 from public.employee_bajas) then
    raise exception '092 rollback: employee_bajas tiene filas: exportarlas antes; no se toca nada';
  end if;
end $$;
drop trigger if exists trg_employees_borrado_guardia on public.employees;
drop function if exists public.employees_borrado_guardia();
drop table if exists public.employee_bajas;
delete from supabase_migrations.schema_migrations where version = '092';
commit;
```
- **E.092 frena si `employee_bajas` tiene filas** (Grok 140): el owner las exporta, decide, y recién ahí se sigue.
- **Grok 175:** cada precondición exige que la versión que se deshace sea **la ÚLTIMA del ledger** y que haya **61+n
  filas** (E.095: 095 y 65; E.094: 094 y 64; E.093: 093 y 63; E.092: 092 y 62). Una 096, una 150 o cualquiera que haya
  entrado después la frena.
- **Después de cada bloque E se corre el bloque D0** (lectura, sin freno), que tiene que mostrar esa versión fuera de
  `tanda`:
  ```sql
-- BLOQUE D0 · el ledger de la tanda, SOLO LECTURA y SIN freno: para la vuelta atrás (después de cada bloque E) y para el
-- revert (Grok 186: el revert recién cuando `tanda` dé []).
select json_build_object(
  'filas', (select count(*) from supabase_migrations.schema_migrations),
  'ultima', (select max(version) from supabase_migrations.schema_migrations where version ~ '^[0-9]{3}$'),
  'tanda', (select coalesce(json_agg(json_build_object('v', version, 'name', name, 'statements', array_length(statements, 1)) order by version), '[]'::json)
              from supabase_migrations.schema_migrations where version in ('092','093','094','095')),
  'repetidas', (select coalesce(json_agg(version), '[]'::json) from (select version from supabase_migrations.schema_migrations
                  where version in ('092','093','094','095') group by version having count(*) <> 1) r),
  'names_ok', (select count(*) from supabase_migrations.schema_migrations where (version, name) in
                 (('092','employees_borrado_solo_owner'), ('093','ventas_lectura_rol_activo'), ('094','anon_sin_maintain'), ('095','contador_lee_caja')))
) as ledger_tanda;
  ```

**7.3 Revert del merge en `main` (Grok 186):** `git revert -m 1 <SHA del merge del #107>`, **recién cuando el bloque D0
muestre `tanda` = `[]`**, y **nadie pushea a `main` en el medio** (desde el merge hasta el revert). Saca los cuatro `.sql`,
sus guías y sus documentos:
- si los archivos quedan en `main` sin su fila, Branching los vuelve a aplicar en el próximo push;
- si se sacan sin borrar la fila, Branching falla en cada push (el caso de la 074).

**7.4 Verificar:**
- Branching del revert: «All migrations are up to date»;
- bloque D0: 61 · 091, con `tanda` `[]`;
- bloque A (ANTES): sin PARADA, el JSON de «antes»;
- bloque B: `sha256_normalizado` igual al respaldo; si difiere, se anota tabla por tabla y **no** se arregla a mano sin
  la firma del dueño;
- bloque C: igual que «antes».

## 8. Orden en prod
**085 ✅ → 089 ✅ → 090 ✅ → 091 ✅ (10-nov) → 092 + 093 + 094 + 095 ✅ (10-nov, un merge) → sigue el Club (075 como 150,
100 como 151).** La tanda 2 arranca solo con la tanda 1 cerrada. Si la tanda 2 hace vuelta atrás, el pase del Club espera.
La MAINTAIN de `authenticated` (75 tablas) va después de abrir el Club, en el bloque 152+ (decisión del dueño).

## 9. Firma única de la tanda y bitácora
| Paso | Esperado | Obtenido |
|---|---|---|
| **Firma del dueño** (fecha y hora `-06:00`): «autorizo el pase de la tanda 092–095 en un merge del PR #107 @ **<cabeza nueva de `claude/contador-lee-caja`, al día con `main` con la 091 (Grok 176)>**», con los md5 de las cuatro migraciones y rollbacks de la tabla de huellas y el PASE combinado (#108 @ <su cabeza>) | | 10-nov: firma del dueño sobre el **#107 @ `44b0db80d4b7a66d6c05e4c8f9148cd2034dbe26`** (el texto completo está en su conversación con Claude, fuera del repo; el cuerpo del merge lleva su autorización textual, los md5 y la referencia al PASE combinado, #108 @ `570e292`). **Excepción a la regla de las 17:00–23:00, escrita por el dueño:** restaurante cerrado, caja sin movimiento |
| **Condición 3 de Grok, texto que firma el dueño:** «Para esta tanda, el humo combinado después del merge y la vuelta atrás de la tanda entera por defecto reemplazan la condición de cerrar cada pase antes del siguiente» | | **firmada, textual**, dentro de la firma del dueño |
| 176: la cabeza nueva contra `c78b4c2`: solo el merge de `main`; blobs de 092–095 (migraciones y rollbacks) iguales | | cabeza `44b0db8` = `c78b4c2` + el merge de `main` @ `b8cb74d` (único commit nuevo; 0 archivos distintos); los 8 md5 iguales a la tabla de huellas |
| Responsables (ejecución / control) | | el dueño (el merge lo hizo Claude por su indicación explícita) / la encargada |
| 0.4 la 091 en prod con su pase cerrado | 61 · 091 | ✅ pase de la 091 cerrado a las 22:51 (61 · 091) |
| 0.5 ninguna versión ≥ 092 | `desde_092` [] | ✅ (bloque A antes sin parada) |
| 0.6 rama al día con `main` (con la 091) · diff solo 092–095 | | `main` @ `b8cb74d` ancestro; 22 archivos, todos de la 092–095; ninguna `09[2-9]` en `main` antes del merge |
| Bloque A antes (el JSON entero) | §1 | OK, **freno sin parada**: 61 · 091 · `write_md5` `6ffc8c73…` · `anon_otros` 14 · `authenticated_maintain` 20 (el JSON entero, fuera del repo) |
| Bloque B: **20** tablas · respaldo **guardado fuera del repo** · `sha256_relacl` · `sha256_normalizado` (Grok 185) | | **20** tablas · respaldo guardado fuera del repo · `sha256_relacl` `86b111cc29c7712d8d31f78576437fc0c7654d1668ffcd6b3ff98d37ef4072e1` · `sha256_normalizado` `79813f6a4f2f96bb4df0edc7b40982c174a5098fbc5b9e9ee40db5738cec13eb`. Salieron de la corrida en **PROD** (editor SQL de prod, 10-nov 22:53 CR), no del documento. Coinciden con los de staging del 10-nov porque los dos tienen la 089 aplicada: es lo esperado |
| Bloque C antes (justo antes del merge; `inactiva.hay_cuenta` true) | | OK (22:56) |
| Gate de CI en la cabeza del PR (enlace), o la aceptación explícita del dueño sin ese verde, con el motivo | | el PR no corre pruebas (125); en la cabeza `44b0db8`, `supabase/migraciones.test.ts` 6/6 en local. Aceptación del dueño, texto de la firma: «Acepto mergear sin CI de pruebas en el PR (125): el repo no corre pruebas en PRs; las cuatro se aplicaron y probaron en staging el 10-nov y las auditó Grok.» |
| §2 merge (SHA, hora) | | PR #107 · `c41e18bd8dd34bbeccd726c910433696ca392780`, 10-nov **22:57:17 -06:00** (padres `b8cb74d` y `44b0db8`). Los #104, #105 y #106 quedaron incluidos |
| 5.1 Branching success · log con 092, 093, 094 y 095 en orden | | «Supabase Preview» **success** (run 130332556647, 22:58:21 -06:00). Log de Applying no visto en panel; lo reemplaza el bloque D: 4 filas con su name, 092–095, statements 12/7/3/9 |
| 5.2 bloque D: 65 · 095 · `tanda` con 4 filas y su `name` · `repetidas` [] · `names_ok` 4 · statements (anotar) | | **65 · 095** · `names_ok` 4 · statements: 092 = 12, 093 = 7, 094 = 3, 095 = 9 |
| 5.3 bloque A después, como lo esperado (`write_md5` igual; `policies` de antes + 3) | | **freno sin parada**; huellas `c25aabee…` y `bd9d17e1…`, iguales a staging |
| 5.4 bloque C después según las reglas · pantallas sin rojos | | OK (23:05) · pantallas OK. **Nota:** `employees` pasó de 45 a 46 entre antes (22:56) y después (23:05) en owner, manager y `base`. **No es parada:** también está en `base` (una fila nueva, no un cambio de permisos). Origen (confirmado por el dueño): el dueño creó un empleado al revisar Admin → Empleados, en la prueba de pantallas 4c |
| Cierre: pasa / vuelta atrás (qué se deshizo según 7.1; bloque D final) | | **PASA · tanda CERRADA (10-nov)**, sin vuelta atrás |
