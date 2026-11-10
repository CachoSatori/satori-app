# Pase a PROD de la mig 089 `anon_sin_politica`

> **Estado: preparado, SIN ejecutar.** Formato del `PASE-085` (rama `claude/pase-085`,
> `docs/pases/PASE-085-rls-lectura-rol-activo.md`): qué cambia, lecturas previas, prueba en staging, humo de solo
> lectura, vuelta atrás y firma.
>
> **Nada de este documento se ejecuta en prod hasta que el dueño lo firme (§9).** Si algo no coincide con lo que dice
> acá, **se para y se avisa**: no se improvisa en prod.
>
> - **Orden en prod: 085 → 089 → 090 → 091 → 092 → 093.** Supabase no aplica una migración con número menor que la
>   última aplicada: la 089 va **después** de la 085 y **antes** de la 090 y la 091 (§8).
> - **Regla del ledger (Grok 122):** Branching guarda las migraciones **partidas** en varios statements. La verificación
>   es «exactamente 1 fila 089 con su `name`» más el catálogo (5.3). **No se compara md5.**
> - Evidencia de staging: [`089-prueba-staging-2026-11-08.md`](089-prueba-staging-2026-11-08.md).

## Qué pasa y qué no
- **Pasa:** el rol `anon` (cualquiera **sin** sesión) pierde en 20 tablas de prod (23 en staging) los permisos que
  ninguna policy justifica:
  - **siempre** TRUNCATE, REFERENCES y TRIGGER (las policies no los controlan; TRUNCATE ni pasa por RLS);
  - de SELECT, INSERT, UPDATE y DELETE, **solo** los que no tienen una policy para `anon` o `public`;
  - a `PUBLIC` se le revoca todo en esas tablas, para que `anon` no lo herede.
  - Tablas: `accounting_entries`, `cash_movements`, `cash_sessions`, `credit_applications`, `movement_deletions`,
    `movement_edits`, `pos_ndf_cursor`, `pos_ndf_open`, `pos_ndf_ticket_lines`, `pos_ndf_tickets`, `product_map`,
    `sops`, `supplier_credits`, `suppliers`, `tip_entries`, `tip_sessions`, `ventas_comps`, `ventas_dias`,
    `ventas_hist`, `ventas_metas` (más `time_punches`, `punch_exceptions` y `salary_periods`, que solo existen en
    staging; la migración las salta si no existen).
  - La migración **se verifica sola**: si al final `anon` conserva algo sin policy o `PUBLIC` tiene algún permiso,
    aborta todo.
- **No pasa:**
  - **hoy no hay fuga**: las 20 tienen RLS prendida y ninguna policy deja pasar a `anon`. Esto es defensa en
    profundidad: si mañana alguien apaga la RLS de una tabla, `anon` no hereda nada;
  - nadie con sesión nota nada: `authenticated` y `service_role` no cambian;
  - no toca policies, RLS, funciones, vistas, el Club (`club_*`) ni los privilegios por defecto (eso es la 090);
  - `/login` y `/registro` (la única pantalla sin login que escribe: `customers`, que no está en la lista) siguen igual.

## SHA y huellas
| Qué | Valor |
|---|---|
| Rama | `claude/anon-revoke` (al día con `main` @ `5a22478`) |
| Migración | `supabase/migrations/089_anon_sin_politica.sql` @ `d59d3a9`, md5 `88ecdc8122bf42efbf57df66824000ae` (igual a la fila 089 de staging, aplicada a mano en un solo statement) |
| Rollback | `scripts/sql/089_rollback.sql` (devuelve exactamente lo que la 089 saca, tabla por tabla, si existe) |
| Pruebas | `scripts/sql/089_pruebas.sql` (8 casos) |

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
| 0.4 | La rama al día con `main`, y el diff con **solo** los archivos del PR (§2) | `git merge-base --is-ancestor`, `git diff --name-only` |
| 0.5 | Gate del PR en verde: `supabase/migraciones.test.ts` (la 089 está registrada) y build | checks del PR |
| 0.6 | Staging en verde con este mismo archivo (§3) | anotado |
| 0.7 | **La 085 ya está en prod** y no hay ninguna migración con número mayor que 089 en `main` ni en el ledger de prod | 1.1 |

## 1. Lecturas previas (SOLO LECTURA, en PROD)
Editor SQL de PROD. **Leer el ref en pantalla.** Anotar cada resultado en §9.
```sql
-- 1.1 ledger: el último es la 085 y la 089 no está
select count(*), max(version) from supabase_migrations.schema_migrations;               -- 58 · 085 (si la 085 pasó sola)
select version from supabase_migrations.schema_migrations where version >= '089';       -- 0 filas
-- 1.2 qué tiene anon hoy en la lista, sin política que lo justifique (lo que la 089 va a sacar)
begin read only;
with lista(t) as (values ('accounting_entries'),('cash_movements'),('cash_sessions'),('credit_applications'),
  ('movement_deletions'),('movement_edits'),('pos_ndf_cursor'),('pos_ndf_open'),('pos_ndf_ticket_lines'),('pos_ndf_tickets'),
  ('product_map'),('punch_exceptions'),('sops'),('supplier_credits'),('suppliers'),('time_punches'),('tip_entries'),
  ('tip_sessions'),('ventas_comps'),('ventas_dias'),('ventas_hist'),('ventas_metas'),('salary_periods'))
select count(distinct t) filter (where to_regclass('public.' || t) is not null) as tablas_existentes,
       count(*) filter (where has_table_privilege('anon', ('public.' || t)::regclass, p)
         and (p in ('TRUNCATE','REFERENCES','TRIGGER') or not exists (select 1 from pg_policies pp where pp.schemaname = 'public'
              and pp.tablename = t and pp.roles && array['anon','public']::name[] and pp.cmd in ('ALL', p)))) as permisos_sin_politica,
       count(*) filter (where (select relrowsecurity from pg_class where oid = to_regclass('public.' || t))) / 7 as con_rls
  from lista cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
 where to_regclass('public.' || t) is not null;
rollback;
-- esperado: tablas_existentes 20 · permisos_sin_politica > 0 (anotar el número) · con_rls 20
```
**1.3 Qué de la app usa `anon`** (repetir la lista de verificación de la migración contra `main` del día):
- rutas sin login de `src/App.tsx`: solo `/login` y `/registro` (`customers`, fuera de la lista);
- Edge Functions: `service_role` o el JWT del usuario; ninguna lee estas tablas como `anon`;
- funciones `SECURITY INVOKER` ejecutables por `anon` que nombren estas tablas, y vistas legibles por `anon` sobre
  ellas: **0** (verificado en prod y staging el 08-nov; volver a mirar si entró alguna migración nueva).

Más la **prueba de humo de antes** (§4).

**Para (no se sigue)** si:
- el ledger no termina en 085 o ya tiene la 089;
- 1.2 no da 20 tablas existentes, o alguna sin RLS;
- 1.3 encuentra algo nuevo que `anon` necesite de estas tablas.

## 2. El cambio: merge del PR → Supabase Branching aplica la 089
- El PR trae **solo**: la migración, `scripts/sql/089_rollback.sql`, `scripts/sql/089_pruebas.sql`, el registro
  (`migraciones-reservadas.json` y `ESTADO.md`) y los documentos de `docs/pases/` de la 089.
- **Se aplica con el merge, no a mano:** Branching corre `migrate` contra prod en cada push a `main`.
- **Merge commit**, con la firma de §9. Anotar el SHA y la hora (`-06:00`).
- Si la migración aborta por su verificación final, **no queda nada a medias** (una transacción) y Branching queda en
  error: se sigue §6.

## 3. Prueba en staging
| Cuándo | Qué | Resultado |
|---|---|---|
| 08-nov 23:41 CR | La 089 (`d59d3a9`) + `089_pruebas.sql` en una transacción descartada | **7/7** |
| 09-nov 08:27 CR | `089_pruebas.sql` ANTES de aplicar | 3 fallas esperadas (el hueco y la 089 sin fila) y 5 OK |
| 09-nov 08:27 CR | **Aplicada en staging** (firma del dueño para staging): una transacción con la migración y su fila del ledger | ledger de staging 84 / 089 |
| 09-nov 08:27 CR | `089_pruebas.sql` DESPUÉS | **8/8** |
| 09-nov 08:30 CR | Batería del Club (con la 089 y la 090 puestas) | **580/580**; prueba 82 **4/4** («conocidas: 0») |

## 4. Prueba de humo en PROD (SOLO LECTURA: `begin read only` … `rollback`)
Se corre **antes** del merge y **después** (5.4).

**4a. Como `anon`** (sin sesión): lo que ve y lo que podría hacer.
```sql
begin read only;
set local role anon;
select has_table_privilege('public.customers', 'INSERT') as insert_customers,               -- /registro: no cambia
       has_table_privilege('public.cash_movements', 'TRUNCATE') as truncate_cash_movements,
       has_table_privilege('public.sops', 'SELECT') as select_sops,
       has_table_privilege('public.ventas_dias', 'SELECT') as select_ventas_dias;
reset role;
rollback;
```
- **Antes:** `insert_customers` true · `truncate_cash_movements` true · `select_sops` true · `select_ventas_dias` true.
- **Después:** `insert_customers` **true** (no cambia) · **las otras tres en false**.
- Si `insert_customers` da false **antes**, se anota: es el estado de prod, no lo cambia la 089 (`customers` no está en la lista).

**4b. Cuentas con sesión: no cambian.** La consulta 4b del PASE-085 (owner, manager, cajero, contador y salonero, solo
conteos) dentro de `begin read only`. **Regla: después = antes**, con la misma excepción de `base` que en el PASE-085.

**4c. Pantallas:** abrir la app **sin sesión** (`/login` y `/registro`) y **con sesión** de owner (Caja, Propinas,
Ventas, Admin, SoP): nada nuevo en rojo.

## 5. Verificación después del merge
1. **Branching:** «Supabase Preview» del merge commit en `success`; en el log, `Applying migration 089_anon_sin_politica.sql`.
2. **Ledger** (solo lectura): **exactamente 1 fila 089 con su `name`**. No se compara md5.
   ```sql
   select count(*), max(version) from supabase_migrations.schema_migrations;                   -- anterior + 1 · 089
   select count(*) from supabase_migrations.schema_migrations
    where version = '089' and name = 'anon_sin_politica';                                      -- 1
   select array_length(statements, 1) from supabase_migrations.schema_migrations where version = '089';   -- anotar
   ```
3. **Catálogo:** 1.2 de nuevo → `tablas_existentes` 20 · **`permisos_sin_politica` 0** · `con_rls` 20. Y `PUBLIC` sin nada:
   ```sql
   select count(*) from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where c.relnamespace = 'public'::regnamespace and a.grantee = 0
      and c.relname in ('accounting_entries','cash_movements','cash_sessions','credit_applications','movement_deletions',
        'movement_edits','pos_ndf_cursor','pos_ndf_open','pos_ndf_ticket_lines','pos_ndf_tickets','product_map','sops',
        'supplier_credits','suppliers','tip_entries','tip_sessions','ventas_comps','ventas_dias','ventas_hist','ventas_metas');  -- 0
   ```
4. **Humo:** 4a con los valores de «Después», 4b igual que antes y 4c sin rojos.

## 6. Criterios de parada → vuelta atrás (§7)
- Branching en error (`MIGRATIONS_FAILED`; por ejemplo, la verificación de la 089 abortó) o aplicando otra cosa.
- 5.2 sin exactamente 1 fila 089 con `name = 'anon_sin_politica'`.
- 5.3 con `permisos_sin_politica` distinto de 0, o `PUBLIC` con algún permiso.
- 4b distinto de antes, o 4c con una pantalla rota (con o sin sesión).
- Si Branching falló **sin** aplicar (la migración abortó): no hay nada que deshacer en la base; se hace el revert del
  merge (§7.2) y se avisa.

## 7. Vuelta atrás (todo en la misma ventana; nadie más pushea a `main`)
1. **En prod, UN bloque** (editor SQL): precondición + `scripts/sql/089_rollback.sql`, que devuelve a `anon` exactamente
   lo que tenía el 08-nov y borra la fila del ledger:
   ```sql
   begin;
   do $$ begin
     if (select count(*) from supabase_migrations.schema_migrations where version = '089') <> 1 then
       raise exception 'precondición: se esperaba exactamente 1 fila 089 en el ledger: no se toca nada';
     end if;
   end $$;
   -- … pegar acá el cuerpo de scripts/sql/089_rollback.sql, sin su begin/commit …
   commit;
   ```
2. **Enseguida, revert del merge en `main`**, que saca el `.sql`:
   - si el archivo se queda en `main`, Branching la vuelve a aplicar en el próximo push;
   - si se saca el archivo sin borrar la fila, Branching falla en cada push (el caso de la 074).
3. **Verificar:** Branching del revert «All migrations are up to date»; 1.2 y 4a con los valores de «Antes».

## 8. Orden en prod
**085 → 089 → 090 → 091 → 092 → 093.** Los merges a `main` van en ese orden, sin saltos. La 090 (privilegios por
defecto) va justo después y depende de la 089 (la 089 limpia lo que ya existe; la 090, lo que se cree después). Si se
decide pasar la 089 **después** de alguna de número mayor, se renumera al bloque de pase (150+) con su «origen» (regla 3
de ESTADO.md). Después de las dos, sacar estas tablas de la lista «conocidas» de la prueba 82 del Club.

## 9. Firma y bitácora
| Paso | Esperado | Obtenido |
|---|---|---|
| Firma del dueño (fecha y hora `-06:00`, SHA de la cabeza del PR) | | |
| Responsables (ejecución / control) | | |
| 0.4 rama al día con `main` · diff solo los archivos del PR | | |
| 0.7 la 085 en prod | | |
| 1.1 ledger: último 085 · ninguna versión ≥ 089 | | |
| 1.2 20 tablas · permisos sin política (anotar) · 20 con RLS | | |
| 1.3 nada nuevo que `anon` use | | |
| 4a antes: true · true · true · true | | |
| 4b antes (activas), justo antes del merge | | |
| Gate de CI en la cabeza del PR (enlace), o la aceptación explícita del dueño sin ese verde, con el motivo | | |
| §2 merge (SHA, hora) | | |
| 5.1 Branching success · log con la 089 | | |
| 5.2 exactamente 1 fila 089 con `name = 'anon_sin_politica'` (statements: anotar) | | |
| 5.3 permisos sin política 0 · PUBLIC 0 | | |
| 4a después: true (igual que antes) · false · false · false | | |
| 4b después = antes · 4c sin rojos | | |
| Cierre: pasa / vuelta atrás (hasta qué paso de §7) | | |
