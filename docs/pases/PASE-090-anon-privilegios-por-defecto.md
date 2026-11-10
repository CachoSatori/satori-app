# Pase a PROD de la mig 090 `anon_privilegios_por_defecto`

> **Estado: preparado, SIN ejecutar.** Formato del `PASE-085` (rama `claude/pase-085`,
> `docs/pases/PASE-085-rls-lectura-rol-activo.md`): qué cambia, lecturas previas, prueba en staging, humo de solo
> lectura, vuelta atrás y firma.
>
> **Nada de este documento se ejecuta en prod hasta que el dueño lo firme (§9).** Si algo no coincide con lo que dice
> acá, **se para y se avisa**: no se improvisa en prod.
>
> - **Orden en prod: 085 → 089 → 090 → 091 → 092 → 093.** La 090 va **después** de la 089 y **antes** de la 091 (§8).
> - **Regla del ledger (Grok 122):** Branching guarda las migraciones **partidas** en varios statements. La verificación
>   es «exactamente 1 fila 090 con su `name`» más el catálogo (5.3). **No se compara md5.**
> - Gate de catálogo y residual aceptado: [`GATE-090-catalogo.md`](GATE-090-catalogo.md).

## Qué pasa y qué no
- **Pasa:** una tabla **nueva** de `public` creada por `postgres` (las migraciones, Branching, el editor SQL y el editor de
  tablas del panel crean como `postgres`) **nace sin ningún permiso para `anon`**. Hoy nace con todo
  (`anon=arwdDxtm`). Es una sola sentencia:
  `alter default privileges for role postgres in schema public revoke all on tables from anon;`
  y la migración se verifica sola (si el valor por defecto todavía menciona a `anon`, aborta).
- **No pasa:**
  - las tablas que **ya existen** no cambian (eso lo hace la 089);
  - `authenticated` y `service_role` siguen recibiendo lo de siempre en las tablas nuevas;
  - secuencias y funciones nuevas quedan como hoy;
  - otros esquemas (`storage`, `auth`, `realtime`, …) no se tocan;
  - **residual aceptado por el dueño por escrito (09-nov):** los privilegios por defecto de `supabase_admin` en `public`
    siguen dando todo a `anon` (`postgres` no es miembro de `supabase_admin` y no los puede cambiar). Solo afectan a
    lo que cree la plataforma en `public`, que hoy es nada: las 106 tablas y vistas de `public` son de `postgres`.
- **Lo que cambia para quien escriba migraciones:** una tabla nueva que una pantalla **sin login** tenga que usar
  necesita su `grant … to anon` explícito (y su policy). Hoy no hay ninguna: `/registro` usa `customers`, que ya existe.

## SHA y huellas
| Qué | Valor |
|---|---|
| Rama | `claude/anon-default-privs`, al día con `main` @ `fa1cbef` (la 089 en prod) con un merge commit. Si `main` se mueve, se vuelve a verificar 0.4 |
| Migración | `supabase/migrations/090_anon_privilegios_por_defecto.sql`, md5 `53aa0e0ab1df440057403e8b5ce15332` (10-nov, Grok 134: **solo cambió un comentario**; el SQL ejecutable es idéntico). **La fila 090 del ledger de staging se actualizó al texto nuevo el 10-nov a las 08:53 CR** (OK del dueño; franja de la mañana levantada por el dueño): una transacción con precondición (1 fila, 1 statement, md5 `0d93a8db…`) y postcondición, solo `statements` de esa fila; antes, sin consultas ajenas y el último commit del Club con 5 minutos. **Queda md5 `53aa0e0ab1df440057403e8b5ce15332`**, igual al archivo; ledger 85 filas, última 090; privilegios por defecto de `public` sin cambios (sin `anon`). En prod no se compara md5 (Grok 122). |
| Rollback | `scripts/sql/090_rollback.sql` (las tablas nuevas vuelven a nacer con todo para `anon`, como hoy) |
| Pruebas | `scripts/sql/090_pruebas.sql` (8 casos, en una transacción descartada) |
| Gate de catálogo (staging, solo lectura, 09-nov) | 106 tablas y vistas y 167 funciones de `public`, todas de `postgres`; salida sha256 `b12da126e2836991…` (fuera del repo) |

Los md5 sirven para comprobar el archivo, **no** para el ledger de prod (Grok 122).

## Responsables
- **Ejecución:** el dueño. Firma, lee el catálogo de prod en el editor SQL, mergea (o autoriza el merge) y corre la
  prueba de humo.
- **Control:** el encargado del turno. Lee en voz alta cada resultado esperado contra el obtenido. No es la misma
  persona.
- **Claude no corre nada en prod.** Prepara, revisa y lee los resultados que le pasan.

## 0. Prerrequisitos
**Base del pase: `main` @ `fa1cbef`, con la 089 en prod** (merge del #90 el 10-nov a las 10:22:11 -06:00; ledger **59 · 089**). La 085 está en prod desde el 10-nov
(ledger 58 · 085, `bb12652`).

| # | Qué | Cómo se verifica |
|---|---|---|
| 0.1 | Firma del dueño en §9 (con el SHA de la cabeza del PR) | firma |
| 0.2 | Los dos responsables presentes | §9 |
| 0.3 | **No se mergea entre las 17:00 y las 23:00 CR**, y ninguna otra sesión mergeando a `main` | hora en §9 |
| 0.4 | La rama al día con `main` (con la 089 ya mergeada), y el diff con **solo** los archivos de la 090 | `git merge-base --is-ancestor`, `git diff --name-only` |
| 0.5 | Gate del PR en verde: `supabase/migraciones.test.ts` (la 090 está registrada) y build | checks del PR |
| 0.6 | Staging en verde con este mismo archivo (§3) | anotado |
| 0.7 | **La 089 ya está en prod con su pase cerrado** (puede haber sido minutos antes: ver 1.1) y no hay ninguna migración con número mayor que 090 en `main` ni en el ledger de prod | 1.1 |

## 1. Lecturas previas (SOLO LECTURA, en PROD)
Editor SQL de PROD. **Leer el ref en pantalla.** Anotar cada resultado en §9.

**Pase seguido: la 089 puede haber entrado minutos antes, en la misma ventana.** Estas lecturas no piden ningún
tiempo de espera; piden que el pase de la 089 esté **cerrado**: su merge con «Supabase Preview» en `success`, su §5
en verde y su §9 firmado («pasa»). Si el run de Branching de la 089 todavía corre, **se espera a que termine**: no se
mergea con otro run en curso. Con eso, el ledger tiene que dar **59 filas, la última 089**, y ninguna 090 o mayor.
Si la 089 hizo vuelta atrás, este pase **no se hace**.

```sql
-- 1.1 ledger: el último es la 089 y la 090 no está
select count(*), max(version) from supabase_migrations.schema_migrations;               -- 59 · 089
select version from supabase_migrations.schema_migrations where version >= '090' and version <> '0090' and version <> '0095';  -- 0 filas
-- 1.2 privilegios por defecto de public (tablas): el de postgres menciona a anon
select pg_get_userbyid(d.defaclrole) as rol, d.defaclacl::text as acl
  from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
 where n.nspname = 'public' and d.defaclobjtype = 'r' order by 1;
-- esperado: una fila de postgres con «anon=arwdDxtm/postgres» (anotar el texto entero) y la de supabase_admin (residual)
-- 1.3 gate de catálogo (Grok, 09-nov): todas las tablas y vistas de public son de postgres
select pg_get_userbyid(c.relowner) as dueño, count(*) from pg_class c
 where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m','f') group by 1;   -- una sola fila: postgres
```
Más la **prueba de humo de antes** (§4).

**Para (no se sigue)** si:
- el ledger no termina en 089 o ya tiene la 090;
- 1.2 no tiene la fila de `postgres` con `anon=` (la 090 no haría nada; avisar);
- 1.3 da alguna tabla o vista de un dueño que no sea `postgres` (el gate no se cumple en prod).

## 2. El cambio: merge del PR → Supabase Branching aplica la 090
- El PR trae **solo**: la migración, `scripts/sql/090_rollback.sql`, `scripts/sql/090_pruebas.sql`, el registro
  (`migraciones-reservadas.json` y `ESTADO.md`) y los documentos de `docs/pases/` de la 090.
- **Se aplica con el merge, no a mano:** Branching corre `migrate` contra prod en cada push a `main`, como `postgres`.
- **Merge commit**, con la firma de §9. Anotar el SHA y la hora (`-06:00`).
- **Prueba 82 del Club (Grok 134):** La prueba 82 del Club **no se invierte ni se cambia** con la 090. Su caso «negativa» le da un `grant select … to anon` explícito a la tabla de prueba (rama del Club @ `8b8f529`, `scripts/sql/075_pruebas_staging.sql` ~4282–4290), así que vale con y sin la 090: en staging, con la 090 puesta, la batería dio 580/580 y la prueba 82 4/4. El PR de la 090 no toca la prueba 82.

## 3. Prueba en staging
| Cuándo | Qué | Resultado |
|---|---|---|
| 09-nov 08:2x CR | Gate de catálogo re-corrido (solo lectura) | igual al de la noche anterior: 106 tablas y vistas y 167 funciones, todas de `postgres` |
| 09-nov 08:28 CR | `090_pruebas.sql` en una transacción descartada, ANTES de aplicar | **8/8** |
| 09-nov 08:28 CR | **Aplicada en staging** (firma del dueño para staging): una transacción con la migración y su fila del ledger | ledger de staging 85 / 090 |
| 09-nov 08:28 CR | Después, en una transacción descartada: el valor por defecto sin `anon`; una tabla nueva no le da nada a `anon`, y `authenticated` y `service_role` conservan su acceso | OK |
| 09-nov 08:30 CR | Batería del Club (con la 089 y la 090 puestas) | **580/580**; prueba 82 **4/4** («conocidas: 0») |

## 4. Prueba de humo en PROD (SOLO LECTURA)
En prod **no** se crea una tabla de prueba (sería una escritura, aunque se descarte). La prueba de que una tabla nueva
nace sin `anon` ya se hizo en staging (§3). En prod se mira el catálogo:

**4a. El valor por defecto** (la consulta 1.2).
- **Antes:** la fila de `postgres` con `anon=arwdDxtm/postgres`.
- **Después:** la fila de `postgres` **sin `anon=`** (`authenticated` y `service_role` siguen ahí, igual que antes), y la
  de `supabase_admin` sin cambios (residual aceptado).

**4b. Las tablas que ya existen no cambian:**
```sql
begin read only;
select count(*) filter (where a.grantee = 'anon'::regrole) as permisos_anon,
       count(*) filter (where a.grantee = 'authenticated'::regrole) as permisos_authenticated,
       count(*) filter (where a.grantee = 'service_role'::regrole) as permisos_service_role
  from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
 where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m','f');
rollback;
```
- **Regla: después = antes** en las tres columnas (la 090 no toca tablas existentes).

**4c. Pantallas:** abrir la app sin sesión (`/login`, `/registro`) y con sesión de owner: nada nuevo en rojo.

## 5. Verificación después del merge
1. **Branching:** «Supabase Preview» del merge commit en `success`; en el log,
   `Applying migration 090_anon_privilegios_por_defecto.sql`.
2. **Ledger** (solo lectura): **exactamente 1 fila 090 con su `name`**. No se compara md5.
   ```sql
   select count(*) from supabase_migrations.schema_migrations
    where version = '090' and name = 'anon_privilegios_por_defecto';                          -- 1
   select array_length(statements, 1) from supabase_migrations.schema_migrations where version = '090';   -- anotar
   ```
   (La `0090_user_selfsignup` es otra migración, histórica: no confundir.)
3. **Catálogo:** 4a con los valores de «Después».
4. **Humo:** 4b igual que antes y 4c sin rojos.

## 6. Criterios de parada → vuelta atrás (§7)
- Branching en error (`MIGRATIONS_FAILED`; por ejemplo, la verificación de la 090 abortó) o aplicando otra cosa.
- 5.2 sin exactamente 1 fila 090 con `name = 'anon_privilegios_por_defecto'`.
- 4a «Después» con `anon=` en la fila de `postgres`, o `authenticated` / `service_role` fuera de esa fila.
- 4b distinto de antes, o 4c con una pantalla rota.

## 7. Vuelta atrás (todo en la misma ventana; nadie más pushea a `main`)
1. **En prod, UN bloque** (editor SQL):
   ```sql
   begin;
   do $$ begin
     if (select count(*) from supabase_migrations.schema_migrations where version = '090') <> 1 then
       raise exception 'precondición: se esperaba exactamente 1 fila 090 en el ledger: no se toca nada';
     end if;
   end $$;
   alter default privileges for role postgres in schema public grant all on tables to anon;
   delete from supabase_migrations.schema_migrations where version = '090';
   commit;
   ```
   Es `scripts/sql/090_rollback.sql` con la precondición. No toca ninguna tabla que ya exista.
2. **Enseguida, revert del merge en `main`**, que saca el `.sql`:
   - si el archivo se queda en `main`, Branching la vuelve a aplicar en el próximo push;
   - si se saca el archivo sin borrar la fila, Branching falla en cada push (el caso de la 074).
3. **Verificar:** Branching del revert «All migrations are up to date»; 4a con el texto de «Antes».
4. Si entre el merge y la vuelta atrás se creó alguna tabla nueva, nació sin `anon`: se anota (no se le agrega nada si
   no lo necesita).

## 8. Orden en prod
**085 → 089 → 090 → 091 → 092 → 093.** Los merges a `main` van en ese orden, sin saltos. La 090 depende de la 089: la
089 limpia lo que ya existe y la 090, lo que se cree después. Si se decide pasarla **después** de alguna de número mayor,
se renumera al bloque de pase (150+) con su «origen» (regla 3 de ESTADO.md).
- **Prueba 82 del Club (Grok 134), lo mismo que en §2 y en el encabezado de la migración:** La prueba 82 del Club **no se invierte ni se cambia** con la 090. Su caso «negativa» le da un `grant select … to anon` explícito a la tabla de prueba (rama del Club @ `8b8f529`, `scripts/sql/075_pruebas_staging.sql` ~4282–4290), así que vale con y sin la 090: en staging, con la 090 puesta, la batería dio 580/580 y la prueba 82 4/4. El PR de la 090 no toca la prueba 82.

## 9. Firma y bitácora
| Paso | Esperado | Obtenido |
|---|---|---|
| Firma del dueño (fecha y hora `-06:00`, SHA de la cabeza del PR) | | |
| Responsables (ejecución / control) | | |
| 0.4 rama al día con `main` · diff solo los archivos de la 090 | | |
| 0.7 la 089 en prod | | |
| 1.1 ledger: 59 · 089 · ninguna versión ≥ 090 (salvo las históricas 0090 y 0095) · pase de la 089 cerrado | 59 · 089 | |
| 1.2 fila de postgres con `anon=` (texto entero) · fila de supabase_admin | | |
| 1.3 todas las tablas y vistas de public son de postgres | | |
| 4b antes: permisos de anon · authenticated · service_role | | |
| Gate de CI en la cabeza del PR (enlace), o la aceptación explícita del dueño sin ese verde, con el motivo | | |
| §2 merge (SHA, hora) | | |
| 5.1 Branching success · log con la 090 | | |
| 5.2 exactamente 1 fila 090 con `name = 'anon_privilegios_por_defecto'` (statements: anotar) | | |
| 4a después: fila de postgres sin `anon=` · supabase_admin igual | | |
| 4b después = antes · 4c sin rojos | | |
| Cierre: pasa / vuelta atrás (hasta qué paso de §7) | | |
