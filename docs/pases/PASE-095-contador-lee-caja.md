# Pase a PROD de la mig 095 `contador_lee_caja`

> **Estado: preparado, SIN ejecutar.** Formato del `PASE-089` (`docs/pases/PASE-089-anon-sin-politica.md`): qué cambia,
> lecturas previas, prueba en staging, humo de solo lectura, vuelta atrás y firma.
>
> **Nada de este documento se ejecuta en prod hasta que el dueño lo firme (§9).** Si algo no coincide con lo que dice
> acá, **se para y se avisa**: no se improvisa en prod.
>
> - **Orden en prod: 085 → 089 → 090 → 091 → 092 → 093 → 094 → 095.** La 095 va **después** de la 094 y antes del pase
>   del Club. El 11-nov a la mañana van **seguidas, en la misma ventana** (§8).
> - **Regla del ledger (Grok 122):** Branching guarda las migraciones **partidas** en varios statements. La verificación
>   es «exactamente 1 fila 095 con su `name`» más el catálogo (5.3). **No se compara md5.**
> - **Repo público:** en la bitácora (§9) se anotan conteos, nunca montos ni nombres.

## Qué pasa y qué no
- **Decisión del dueño (10-nov):** el contador tiene que ver caja. Hoy la ruta `/caja` lo deja entrar, pero la pantalla
  le sale **vacía**: las lecturas de `cash_movements`, `cash_sessions` y `suppliers` son solo para owner, manager y
  cajero.
- **Pasa:** una policy permisiva de **SELECT** por tabla para el **contador activo**,
  `(select get_my_role()) = 'contador'`. Con la cuenta inactiva, `get_my_role()` es null, igual que en la 085 y la 093.
  Las tablas, con el motivo de cada una:

  | Tabla | Por qué la necesita la pantalla de Caja |
  |---|---|
  | `cash_movements` | Es lo que muestran «Movimientos», «Pendientes» y «Resumen» (`shared/api/cash.ts`) |
  | `cash_sessions` | Los turnos: a qué turno pertenece cada movimiento y los totales por turno |
  | `suppliers` | Los nombres de proveedor en egresos y créditos, y la pestaña «Proveedores» (`getSuppliers`) |

- **El resto de lo que lee la pantalla el contador ya lo lee hoy** (verificado en staging el 10-nov: ve lo mismo que el
  owner), así que la 095 no lo toca: `cash_cierres_dia`, `movement_edits`, `movement_deletions`, `supplier_credits`,
  `credit_applications`, `documents`, `exchange_rates`, `tip_sessions`, `tip_entries` y las fotos del bucket `facturas`.
  En `employees` ve los activos, como el cajero.
- **No pasa:**
  - **ninguna escritura nueva**: la 095 no agrega policies de INSERT, UPDATE ni DELETE. La prueba lo demuestra en las
    3 tablas (§3);
  - los demás roles no cambian;
  - **convive con la 091**: las policies restrictivas por local siguen aplicando, y el contador ve los locales que le da
    `mis_locales()` (todos, decisión 2 del plan multilocal);
  - **lo que ya existía:** `cash_movements_contador_insert` (mig 038, la bandeja) le deja al contador **crear**
    movimientos que no son en efectivo, pendientes o de Banco. Esta migración no la cambia. Si el dueño quiere que el
    contador no cree nada, es otra migración.

## SHA y huellas
| Qué | Valor |
|---|---|
| Rama | `claude/contador-lee-caja`, encima de `claude/anon-sin-maintain` (la 094 sobre la 093 … la 090 y `main` @ `fa1cbef`). Cuando la 094 esté en prod, se trae `main` con un merge commit y se verifica 0.4 |
| Migración | `supabase/migrations/095_contador_lee_caja.sql`, md5 `a8959a18071320f6af63aaafeddd4166` |
| Rollback | `scripts/sql/095_rollback.sql`, md5 `3af4c58fa9bab50435c61f47079d8129` |
| Pruebas | `scripts/sql/095_pruebas.sh` (solo staging, transacciones descartadas) |
| Guía | `docs/sop-app/6.2 Caja.md`, fila del contador |

Los md5 sirven para comprobar el archivo, **no** para el ledger de prod (Grok 122).

## Responsables
- **Ejecución:** el dueño. Firma, lee el catálogo de prod en el editor SQL, mergea (o autoriza el merge) y corre la
  prueba de humo.
- **Control:** el encargado del turno. Lee en voz alta cada resultado esperado contra el obtenido. No es la misma
  persona.
- **Claude no corre nada en prod.** Prepara, revisa y lee los resultados que le pasan.

## 0. Prerrequisitos
**Base del pase: `main` con la 094 ya mergeada y en prod** (ledger **64 · 094**).

| # | Qué | Cómo se verifica |
|---|---|---|
| 0.1 | Firma del dueño en §9 (con el SHA de la cabeza del PR) | firma |
| 0.2 | Los dos responsables presentes | §9 |
| 0.3 | **No se mergea entre las 17:00 y las 23:00 CR** (salvo que el dueño lo autorice ese día), y ninguna otra sesión mergeando a `main` | hora en §9 |
| 0.4 | La rama al día con `main` (con la 094 ya mergeada), y el diff con **solo** los archivos de la 095 (§2) | `git merge-base --is-ancestor`, `git diff --name-only` |
| 0.5 | Gate del PR: `supabase/migraciones.test.ts` (la 095 está registrada) y build | checks del PR |
| 0.6 | Staging en verde con este mismo archivo (§3) | anotado |
| 0.7 | **La 094 ya está en prod con su pase cerrado** (puede haber sido minutos antes: ver §1) y no hay ninguna migración con número mayor que 095 en `main` ni en el ledger de prod | 1.1 |

## 1. Lecturas previas (SOLO LECTURA, en PROD)
Editor SQL de PROD. **Leer el ref en pantalla.** Anotar cada resultado en §9.

**Pase seguido: la 094 puede haber entrado minutos antes, en la misma ventana.** Estas lecturas no piden ningún tiempo
de espera; piden que el pase de la 094 esté **cerrado**: su merge con «Supabase Preview» en `success`, su §5 en verde y
su §9 firmado («pasa»). Si el run de Branching de la 094 todavía corre, **se espera a que termine**: no se mergea con
otro run en curso. Con eso, el ledger tiene que dar **64 filas, la última 094**, y ninguna 095 o mayor. Si la 094 hizo
vuelta atrás, este pase **no se hace**.

```sql
-- 1.1 ledger: 64 · 094 y la 095 no está
select count(*), max(version) from supabase_migrations.schema_migrations;               -- 64 · 094
select version from supabase_migrations.schema_migrations where version >= '095';       -- 0 filas
-- 1.2 las policies de las 3 tablas (ninguna *_contador_select todavía)
select tablename, policyname, permissive, cmd, qual from pg_policies
 where schemaname = 'public' and tablename in ('cash_movements', 'cash_sessions', 'suppliers') order by 1, 2;
-- esperado: ninguna policy de SELECT que nombre al contador; anotar la lista (la de INSERT del contador de la 038 sí está)
```
Más la **prueba de humo de antes** (§4).

**Para (no se sigue)** si:
- el ledger no da 64 · 094, o ya tiene la 095;
- 1.2 ya tiene alguna `*_contador_select`, o una policy de lectura que ya le dé esas tablas al contador.

## 2. El cambio: merge del PR → Supabase Branching aplica la 095
- El PR trae **solo**: la migración, `scripts/sql/095_rollback.sql`, `scripts/sql/095_pruebas.sh`, la guía
  `docs/sop-app/6.2 Caja.md`, el registro (`migraciones-reservadas.json` y `ESTADO.md`) y este documento.
- **Se aplica con el merge, no a mano:** Branching corre `migrate` contra prod en cada push a `main`. La migración se
  verifica sola: tienen que quedar las 3 policies de SELECT, y ninguna de escritura con el contador en `cash_sessions`
  ni en `suppliers`. Si no, aborta y no queda nada a medias.
- **Merge commit**, con la firma de §9. Anotar el SHA y la hora (`-06:00`).

## 3. Prueba en staging
| Cuándo | Qué | Resultado |
|---|---|---|
| 10-nov 10:43 CR (script @ `75ecbe9`) | `095_pruebas.sh hwiatgicyyqyezqwldia`, transacciones descartadas | **23 OK · 0 FALLA · VERDE** |

Los 23 casos:
- **Lectura:**
  - sin la 095, el contador ve 0 en las 3 tablas (el hueco existe);
  - con la 095, ve lo mismo que la base en las 3, y lo mismo que el owner en las 12 tablas de la pantalla de Caja;
  - con la cuenta inactiva, ve 0;
  - owner, manager, cajero, salonero y proveedor ven lo mismo sin y con la 095.
- **Escritura del contador con la 095, ninguna pasa:**
  - editar o borrar movimientos, turnos o proveedores: 0 filas;
  - crear un movimiento en efectivo aprobado, abrir un turno o crear un proveedor: 42501.
- **Lo de antes (038):** el contador crea un movimiento pendiente que no es en efectivo, y da el mismo resultado sin y
  con la 095. Hoy **pasa** (`ok`).
- **Con la 091:** el contador ve lo mismo que el owner (todos los locales) y el cajero sin asignación no ve el otro local.
- **Vuelta atrás:** el contador vuelve a ver 0. Staging terminó sin las policies ni la fila 095.

## 4. Prueba de humo en PROD (SOLO LECTURA: `begin read only` … `rollback`)
**4a. El contador activo** (la cuenta activa más antigua con ese rol; solo conteos):
```sql
begin read only;
select set_config('request.jwt.claims', json_build_object('sub', (select p.id from public.profiles p where p.role = 'contador' and p.is_active
         order by p.created_at, p.id limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
select current_setting('request.jwt.claims')::json->>'sub' is not null as hay_cuenta, public.get_my_role() as rol_visto,
       (select count(*) from public.cash_movements) as cash_movements, (select count(*) from public.cash_sessions) as cash_sessions,
       (select count(*) from public.suppliers) as suppliers;
reset role;
select (select count(*) from public.cash_movements) as base_cash_movements, (select count(*) from public.cash_sessions) as base_cash_sessions,
       (select count(*) from public.suppliers) as base_suppliers;
rollback;
```
- **Antes:** el contador ve 0 · 0 · 0.
- **Después:** el contador ve lo mismo que `base` en las 3.
- Si `hay_cuenta` es false (no hay contador activo en prod), 4a no se puede medir: se anota y vale la prueba de staging.

**4b. Los demás roles no cambian:** la consulta 4a del PASE-091 (owner, manager, cajero y salonero, solo conteos) dentro
de `begin read only`. **Regla: después = antes**, con la misma excepción de `base`.

**4c. Pantalla:** el contador entra a Caja y ve Movimientos, Pendientes, Proveedores y Resumen con datos. No ve «Caja
Diaria» ni «Cierre del día». El owner ve lo de siempre.

## 5. Verificación después del merge
1. **Branching:** el «Supabase Preview» del merge commit que termina en `success`. Los otros con el mismo nombre que
   quedan en «in progress» no cuentan. En el log, `Applying migration 095_contador_lee_caja.sql`.
2. **Ledger** (solo lectura): **exactamente 1 fila 095 con su `name`**. No se compara md5.
   ```sql
   select count(*), max(version) from supabase_migrations.schema_migrations;                     -- 65 · 095
   select count(*) from supabase_migrations.schema_migrations where version = '095' and name = 'contador_lee_caja';   -- 1
   select array_length(statements, 1) from supabase_migrations.schema_migrations where version = '095';  -- anotar
   ```
3. **Catálogo:** 1.2 de nuevo. Están las 3 `*_contador_select` (SELECT, PERMISSIVE, `( SELECT get_my_role() …) = 'contador'`) y
   el resto de las policies igual que lo anotado en 1.2.
4. **Humo:** 4a con los valores de «después», 4b igual que antes y 4c sin rojos.

## 6. Criterios de parada → vuelta atrás (§7)
- Branching en error (`MIGRATIONS_FAILED`) o aplicando otra cosa.
- 5.2 sin exactamente 1 fila 095 con `name = 'contador_lee_caja'`.
- 5.3 con alguna policy distinta de lo esperado.
- 4a: el contador no ve lo mismo que `base`. 4b: otro rol cambió. 4c: una pantalla rota.

## 7. Vuelta atrás (todo en la misma ventana; nadie más pushea a `main`)
1. **En prod, UN bloque** (editor SQL):
   ```sql
   begin;
   do $$ begin
     if (select count(*) from supabase_migrations.schema_migrations where version = '095') <> 1 then
       raise exception 'precondición: se esperaba exactamente 1 fila 095 en el ledger: no se toca nada';
     end if;
   end $$;
   drop policy if exists cash_movements_contador_select on public.cash_movements;
   drop policy if exists cash_sessions_contador_select on public.cash_sessions;
   drop policy if exists suppliers_contador_select on public.suppliers;
   delete from supabase_migrations.schema_migrations where version = '095';
   commit;
   ```
   Es `scripts/sql/095_rollback.sql` con la precondición. No se pierde ningún dato.
2. **Enseguida, revert del merge en `main`**, que saca el `.sql` y devuelve la guía:
   - si el archivo se queda en `main`, Branching la vuelve a aplicar en el próximo push;
   - si se saca el archivo sin borrar la fila, Branching falla en cada push (el caso de la 074).
3. **Verificar:** Branching del revert «All migrations are up to date»; 1.2 con lo de «antes»; 4a con 0 · 0 · 0.

## 8. Orden en prod
**085 → 089 → 090 → 091 → 092 → 093 → 094 → 095.** Supabase no aplica una migración con número menor que la última
aplicada, así que los merges a `main` van en ese orden, sin saltos. El 11-nov van seguidas en la misma ventana. Cada una
arranca cuando la anterior cerró su pase (§9 «pasa»). Si una hace vuelta atrás, las siguientes no pasan. Después va el
pase del Club (la 075 como 150 y la 100 como 151).

## 9. Firma y bitácora
| Paso | Esperado | Obtenido |
|---|---|---|
| Firma del dueño (fecha y hora `-06:00`, SHA de la cabeza del PR) | | |
| Responsables (ejecución / control) | | |
| 0.4 rama al día con `main` · diff solo los archivos de la 095 | | |
| 0.7 la 094 en prod con su pase cerrado | | |
| 1.1 ledger 64 · 094 · ninguna versión ≥ 095 | 64 · 094 | |
| 1.2 policies de las 3 tablas (lista) · ninguna `*_contador_select` | | |
| 4a antes: contador 0 · 0 · 0 (o sin cuenta: anotar) | | |
| 4b antes (otros roles), justo antes del merge | | |
| Gate de CI en la cabeza del PR (enlace), o la aceptación explícita del dueño sin ese verde, con el motivo | | |
| §2 merge (SHA, hora) | | |
| 5.1 Branching success · log con la 095 | | |
| 5.2 exactamente 1 fila 095 con `name = 'contador_lee_caja'` (statements: anotar) | 65 · 095 · 1 | |
| 5.3 las 3 `*_contador_select` · el resto igual | | |
| 4a después = base · 4b igual que antes · 4c sin rojos | | |
| Cierre: pasa / vuelta atrás (hasta qué paso de §7) | | |
