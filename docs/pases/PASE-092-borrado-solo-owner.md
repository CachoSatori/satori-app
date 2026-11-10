# Pase a PROD de la mig 092 `employees_borrado_solo_owner` (R7-01)

> **Estado: preparado, SIN ejecutar.** Formato del `PASE-089` (`docs/pases/PASE-089-anon-sin-politica.md`): qué cambia,
> lecturas previas, prueba en staging, humo de solo lectura, vuelta atrás y firma.
>
> **Nada de este documento se ejecuta en prod hasta que el dueño lo firme (§9).** Si algo no coincide con lo que dice
> acá, **se para y se avisa**: no se improvisa en prod.
>
> - **Orden en prod: 085 → 089 → 090 → 091 → 092 → 093.** La 092 va **después** de la 091 y **antes** de la 093. El
>   11-nov a la mañana van 091 → 092 → 093 **seguidas, en la misma ventana** (§8).
> - **Regla del ledger (Grok 122):** Branching guarda las migraciones **partidas** en varios statements. La verificación
>   es «exactamente 1 fila 092 con su `name`» más el catálogo (5.3). **No se compara md5.**

## Qué pasa y qué no
- **Hoy:** un manager puede borrar la ficha de un empleado. Si esa ficha tiene el login del PoS y todavía no tiene
  propinas, se borra sin dejar rastro, y se pierde el vínculo entre el login y la persona (ventas, ranking). Al 09-nov
  eso podía pasar con 2 de los 15 empleados que tienen login.
- **Pasa:**
  1. Un trigger `BEFORE DELETE` en `employees`: si la ficha tiene `pos_login` y quien borra es un usuario que **no** es
     owner activo, la base responde 42501 «Solo el owner borra un empleado con login del PoS. Para sacarlo,
     desactivalo.» y no borra nada.
  2. Cada borrado que sí pasa (owner, o el canal admin sin usuario) deja un registro en una tabla nueva,
     `employee_bajas`, **solo con lo mínimo** (Grok 142, decisión del dueño): id, login del PoS, nombre, las fechas de
     alta y de última edición de la ficha, quién la borró y cuándo. **No** guarda la ficha completa (nada de salario,
     banco ni horarios). Solo el owner la lee y nadie la escribe a mano: la escribe solo el trigger, con una función
     `SECURITY DEFINER` que nadie más puede ejecutar.
- **No pasa:**
  - desactivar sigue igual: es el camino normal para sacar a alguien;
  - la app no tiene botón de borrar empleados, así que nadie ve un cambio en pantalla (la guía 6.6 Admin ya lo dice);
  - no se tocan las columnas de `employees`, su policy, la FK de `tip_entries` ni las propinas;
  - no toca dinero ni archivos sagrados.

## SHA y huellas
| Qué | Valor |
|---|---|
| Rama | `claude/employees-borrado-owner`, encima de `claude/multilocal-fase0` (la 091 sobre la 090 y la 089). Cuando la 091 esté en prod, se trae `main` con un merge commit y se verifica 0.4 |
| Migración | `supabase/migrations/092_employees_borrado_solo_owner.sql`, md5 `df1047a3e31c02f95a41911842d1bfd2` |
| Rollback | `scripts/sql/092_rollback.sql`, md5 `5a29a15b1ecb815748392ec9a51b10bd` |
| Verificación | `scripts/sql/092_verificacion.sql` (solo lectura: catálogo y un conteo), md5 `a5690026f53e847f0ae9608541e30ee6` |
| Pruebas | `scripts/sql/092_pruebas.sh` (solo staging, transacciones descartadas) |
| Guía | `docs/sop-app/6.6 Admin.md` (desactivar es el camino; el mensaje nuevo en la tabla de errores) |

Los md5 sirven para comprobar el archivo, **no** para el ledger de prod (Grok 122).

## Responsables
- **Ejecución:** el dueño. Firma, lee el catálogo de prod en el editor SQL, mergea (o autoriza el merge) y corre la
  prueba de humo.
- **Control:** el encargado del turno. Lee en voz alta cada resultado esperado contra el obtenido. No es la misma
  persona.
- **Claude no corre nada en prod.** Prepara, revisa y lee los resultados que le pasan.

## 0. Prerrequisitos
**Base del pase: `main` con la 091 ya mergeada y en prod** (ledger **61 · 091**).

| # | Qué | Cómo se verifica |
|---|---|---|
| 0.1 | Firma del dueño en §9 (con el SHA de la cabeza del PR) | firma |
| 0.2 | Los dos responsables presentes | §9 |
| 0.3 | **No se mergea entre las 17:00 y las 23:00 CR**, y ninguna otra sesión mergeando a `main` | hora en §9 |
| 0.4 | La rama al día con `main` (con la 091 ya mergeada), y el diff con **solo** los archivos de la 092 (§2) | `git merge-base --is-ancestor`, `git diff --name-only` |
| 0.5 | Gate del PR en verde: `supabase/migraciones.test.ts` (la 092 está registrada) y build | checks del PR |
| 0.6 | Staging en verde con este mismo archivo (§3) | anotado |
| 0.7 | **La 091 ya está en prod con su pase cerrado** (puede haber sido minutos antes: ver §1) y no hay ninguna migración con número mayor que 092 en `main` ni en el ledger de prod | 1.1 |

## 1. Lecturas previas (SOLO LECTURA, en PROD)
Editor SQL de PROD. **Leer el ref en pantalla.** Anotar cada resultado en §9.

**Pase seguido: la 091 puede haber entrado minutos antes, en la misma ventana.** Estas lecturas no piden ningún tiempo
de espera; piden que el pase de la 091 esté **cerrado**: su merge con «Supabase Preview» en `success`, su §5 en verde y
su §9 firmado («pasa»). Si el run de Branching de la 091 todavía corre, **se espera a que termine**: no se mergea con
otro run en curso. Con eso, el ledger tiene que dar **61 filas, la última 091**, y ninguna 092 o mayor. Si la 091 hizo
vuelta atrás, este pase **no se hace**.

```sql
-- 1.1 ledger: 61 · 091 y la 092 no está
select count(*), max(version) from supabase_migrations.schema_migrations;               -- 61 · 091
select version from supabase_migrations.schema_migrations where version >= '092';       -- 0 filas
-- 1.2 la consulta de verificación (scripts/sql/092_verificacion.sql), estado de «antes»
--     esperado: {"ledger_092":false,"tabla":false,"rls_tabla":false,"politicas":[],"anon_sin_permisos":true,
--                "funcion_definer":false,"funcion_no_publica":true,"trigger_activo":false,"bajas":null}
-- 1.3 qué hay hoy en employees que la 092 protege (solo conteos)
select count(*) filter (where pos_login is not null) as con_login,
       count(*) filter (where pos_login is not null
                          and not exists (select 1 from public.tip_entries t where t.employee_id = e.id)) as con_login_sin_propinas
  from public.employees e;                                                               -- anotar los dos números
-- 1.4 los triggers de employees (la 092 suma uno; ninguno se llama igual)
select tgname from pg_trigger where tgrelid = 'public.employees'::regclass and not tgisinternal order by 1;   -- anotar
```

**Para (no se sigue)** si:
- el ledger no da 61 · 091, o ya tiene la 092;
- 1.2 no da el estado de «antes» (algo de la 092 ya existe);
- 1.4 ya tiene un trigger `trg_employees_borrado_guardia`.

## 2. El cambio: merge del PR → Supabase Branching aplica la 092
- El PR trae **solo**: la migración, `scripts/sql/092_rollback.sql`, `scripts/sql/092_verificacion.sql`,
  `scripts/sql/092_pruebas.sh`, la guía `docs/sop-app/6.6 Admin.md`, el registro (`migraciones-reservadas.json` y
  `ESTADO.md`) y este documento.
- **Se aplica con el merge, no a mano:** Branching corre `migrate` contra prod en cada push a `main`.
- **Merge commit**, con la firma de §9. Anotar el SHA y la hora (`-06:00`).

## 3. Prueba en staging
| Cuándo | Qué | Resultado |
|---|---|---|
| 09-nov 23:37 CR (script @ `26ecde5`) | `092_pruebas.sh hwiatgicyyqyezqwldia`, transacciones descartadas | **10 OK · 0 FALLA · VERDE** |
| 09-nov 23:37 CR | Falla sin el arreglo (transacción descartada, sin la 092): un manager borra un empleado con login | `ok`, 1 fila: **el hueco existe** |
| 09-nov 23:38 CR | Estado de staging al terminar | 0 empleados sintéticos; sin `employee_bajas` ni el trigger; ledger 85 / 090 |

Los 10 casos:
- manager borra un empleado **con** login → 42501, nada borrado ni registrado;
- manager **sin** login, owner y canal admin → se borra y queda el rastro (el canal admin, sin autor);
- owner **inactivo** y cajero → 0 filas (la RLS no los deja);
- anónimo no lee el registro (42501);
- la consulta de verificación da lo esperado con la 092 puesta y sin ella;
- la vuelta atrás deja sin tabla, sin trigger y sin función.

## 4. Prueba de humo en PROD (SOLO LECTURA)
Un borrado es una escritura: en prod **no** se prueba borrar (un `begin read only` lo rechaza con 25006 antes de llegar
al trigger). La regla ya se probó en staging (§3). En prod se mira:
- **4a.** La consulta de verificación (1.2): antes, el estado de «antes»; después, el de 5.3.
- **4b.** 1.3 después igual que antes: la 092 no borra ni cambia ninguna ficha.
- **4c. Pantalla:** el owner abre Admin → Empleados y ve la lista de siempre, con «Desactivar» / «Activar».

## 5. Verificación después del merge
1. **Branching:** «Supabase Preview» del merge commit en `success`; en el log,
   `Applying migration 092_employees_borrado_solo_owner.sql`.
2. **Ledger** (solo lectura): **exactamente 1 fila 092 con su `name`**. No se compara md5.
   ```sql
   select count(*), max(version) from supabase_migrations.schema_migrations;                      -- 62 · 092
   select count(*) from supabase_migrations.schema_migrations
    where version = '092' and name = 'employees_borrado_solo_owner';                              -- 1
   select array_length(statements, 1) from supabase_migrations.schema_migrations where version = '092';  -- anotar
   ```
3. **Catálogo:** `scripts/sql/092_verificacion.sql` tiene que dar
   `{"ledger_092":true,"tabla":true,"rls_tabla":true,"politicas":["employee_bajas_select_owner:SELECT"],"anon_sin_permisos":true,"funcion_definer":true,"funcion_no_publica":true,"trigger_activo":true,"bajas":0}`.
4. **Humo:** 4b igual que antes y 4c sin rojos.

## 6. Criterios de parada → vuelta atrás (§7)
- Branching en error (`MIGRATIONS_FAILED`) o aplicando otra cosa.
- 5.2 sin exactamente 1 fila 092 con `name = 'employees_borrado_solo_owner'`.
- 5.3 con algún valor distinto (en especial `funcion_no_publica` false, o `anon_sin_permisos` false).
- 4b distinto de antes, o 4c con la lista de empleados rota.

## 7. Vuelta atrás (todo en la misma ventana; nadie más pushea a `main`)
1. **En prod, UN bloque** (editor SQL). **Si `employee_bajas` tiene filas, el bloque frena sin tocar nada** (Grok 140):
   el owner las exporta, decide, y recién ahí se sigue.
   ```sql
   begin;
   do $$ begin
     if (select count(*) from supabase_migrations.schema_migrations where version = '092') <> 1 then
       raise exception 'precondición: se esperaba exactamente 1 fila 092 en el ledger: no se toca nada';
     end if;
     if exists (select 1 from public.employee_bajas) then
       raise exception 'precondición: employee_bajas tiene filas: exportarlas antes; no se toca nada';
     end if;
   end $$;
   drop trigger if exists trg_employees_borrado_guardia on public.employees;
   drop function if exists public.employees_borrado_guardia();
   drop table if exists public.employee_bajas;
   delete from supabase_migrations.schema_migrations where version = '092';
   commit;
   ```
   Es `scripts/sql/092_rollback.sql` con la precondición.
2. **Enseguida, revert del merge en `main`**, que saca el `.sql`:
   - si el archivo se queda en `main`, Branching la vuelve a aplicar en el próximo push;
   - si se saca el archivo sin borrar la fila, Branching falla en cada push (el caso de la 074).
3. **Verificar:** Branching del revert «All migrations are up to date»; la consulta de verificación con el estado de
   «antes»; 1.3 igual.
4. **La 093 no pasa** ese día: tiene número mayor y espera a que la 092 vuelva a estar en `main` y en prod.

## 8. Orden en prod
**085 → 089 → 090 → 091 → 092 → 093.** Supabase no aplica una migración con número menor que la última aplicada, así
que los merges a `main` van en ese orden, sin saltos. El 11-nov, la 091, la 092 y la 093 van **seguidas en la misma
ventana**. Cada una arranca cuando la anterior cerró su pase (§9 «pasa»). Si una hace vuelta atrás, las siguientes no
pasan.
- La 092 y la 085 tocan `employees` sin chocar: la 085 cambió una policy de lectura; la 092 agrega un trigger de borrado
  y la tabla `employee_bajas`.

## 9. Firma y bitácora
| Paso | Esperado | Obtenido |
|---|---|---|
| Firma del dueño (fecha y hora `-06:00`, SHA de la cabeza del PR) | | |
| Responsables (ejecución / control) | | |
| 0.4 rama al día con `main` · diff solo los archivos de la 092 | | |
| 0.7 la 091 en prod con su pase cerrado | | |
| 1.1 ledger 61 · 091 · ninguna versión ≥ 092 | 61 · 091 | |
| 1.2 verificación en estado de «antes» | | |
| 1.3 con login · con login sin propinas | | |
| 1.4 triggers de employees (lista) | | |
| Gate de CI en la cabeza del PR (enlace), o la aceptación explícita del dueño sin ese verde, con el motivo | | |
| §2 merge (SHA, hora) | | |
| 5.1 Branching success · log con la 092 | | |
| 5.2 exactamente 1 fila 092 con `name = 'employees_borrado_solo_owner'` (statements: anotar) | 62 · 092 · 1 | |
| 5.3 verificación como lo esperado | | |
| 4b igual que antes · 4c sin rojos | | |
| Cierre: pasa / vuelta atrás (hasta qué paso de §7) | | |
