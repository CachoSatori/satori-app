# Pase a PROD de la mig 094 `anon_sin_maintain`

> **Estado: preparado, SIN ejecutar.** Formato del `PASE-089` (`docs/pases/PASE-089-anon-sin-politica.md`): qué cambia,
> lecturas previas, prueba en staging, humo de solo lectura, vuelta atrás y firma.
>
> **Nada de este documento se ejecuta en prod hasta que el dueño lo firme (§9).** Si algo no coincide con lo que dice
> acá, **se para y se avisa**: no se improvisa en prod.
>
> - **Orden en prod: 085 → 089 → 090 → 091 → 092 → 093 → 094 → 095.** La 094 va **después** de la 093. El 11-nov a la
>   mañana van **seguidas, en la misma ventana** (§8).
> - **Regla del ledger (Grok 122):** Branching guarda las migraciones **partidas** en varios statements. La verificación
>   es «exactamente 1 fila 094 con su `name`» más el catálogo (5.3). **No se compara md5.**

## Qué pasa y qué no
- **Hallazgo del pase de la 089 en prod (10-nov):** en Postgres 17 el ACL de las 20 tablas de la 089 muestra
  `anon=arwdDxtm`. La `m` es **MAINTAIN** (VACUUM, ANALYZE, REINDEX, CLUSTER, REFRESH MATERIALIZED VIEW y LOCK TABLE).
  La 089 no la saca porque su lista de permisos no la tenía.
- **Pasa:** se le revoca MAINTAIN a `anon` en las mismas 20 tablas (23 en staging). La migración **se verifica sola**,
  con el patrón de la 089 y MAINTAIN en la lista: si al final `anon` conserva MAINTAIN, TRUNCATE, REFERENCES o TRIGGER,
  o algún SELECT/INSERT/UPDATE/DELETE sin policy, o si `PUBLIC` tiene algún permiso, **aborta todo**.
- **No pasa:**
  - hoy no hay fuga ni riesgo práctico: PostgREST no ejecuta SQL suelto como `anon`. Es defensa en profundidad;
  - nadie con sesión nota nada; `/login` y `/registro` siguen igual;
  - no toca `authenticated` ni `service_role`, ni policies, RLS o privilegios por defecto. La 090 ya los sacó para
    `anon`, MAINTAIN incluido;
  - **`authenticated` también tiene MAINTAIN** (CLAUDE-HALL-05: 75 de las 105 tablas de `public` en staging, con todas
    las de caja). **No entra en esta migración** sin la decisión del dueño (ver el informe del 10-nov).

## SHA y huellas
| Qué | Valor |
|---|---|
| Rama | `claude/anon-sin-maintain`, encima de `claude/ventas-lectura-rol-activo` (la 093 sobre la 092, la 091, la 090 y `main` @ `fa1cbef`). Cuando la 093 esté en prod, se trae `main` con un merge commit y se verifica 0.4 |
| Migración | `supabase/migrations/094_anon_sin_maintain.sql` (md5 en el informe y en §9) |
| Rollback | `scripts/sql/094_rollback.sql` (devuelve MAINTAIN a `anon` en las tablas de la lista que existan) |
| Verificación | `scripts/sql/094_verificacion.sql` (solo lectura: catálogo, sin datos de personas) |
| Pruebas | `scripts/sql/094_pruebas.sh` (solo staging, transacciones descartadas) |

Los md5 sirven para comprobar el archivo, **no** para el ledger de prod (Grok 122).

## Responsables
- **Ejecución:** el dueño. Firma, lee el catálogo de prod en el editor SQL, mergea (o autoriza el merge) y corre la
  prueba de humo.
- **Control:** el encargado del turno. Lee en voz alta cada resultado esperado contra el obtenido. No es la misma
  persona.
- **Claude no corre nada en prod.** Prepara, revisa y lee los resultados que le pasan.

## 0. Prerrequisitos
**Base del pase: `main` con la 093 ya mergeada y en prod** (ledger **63 · 093**).

| # | Qué | Cómo se verifica |
|---|---|---|
| 0.1 | Firma del dueño en §9 (con el SHA de la cabeza del PR) | firma |
| 0.2 | Los dos responsables presentes | §9 |
| 0.3 | **No se mergea entre las 17:00 y las 23:00 CR** (salvo que el dueño lo autorice ese día), y ninguna otra sesión mergeando a `main` | hora en §9 |
| 0.4 | La rama al día con `main` (con la 093 ya mergeada), y el diff con **solo** los archivos de la 094 (§2) | `git merge-base --is-ancestor`, `git diff --name-only` |
| 0.5 | Gate del PR: `supabase/migraciones.test.ts` (la 094 está registrada) y build | checks del PR |
| 0.6 | Staging en verde con este mismo archivo (§3) | anotado |
| 0.7 | **La 093 ya está en prod con su pase cerrado** (puede haber sido minutos antes: ver §1) y no hay ninguna migración con número mayor que 094 en `main` ni en el ledger de prod | 1.1 |

## 1. Lecturas previas (SOLO LECTURA, en PROD)
Editor SQL de PROD. **Leer el ref en pantalla.** Anotar cada resultado en §9.

**Pase seguido: la 093 puede haber entrado minutos antes, en la misma ventana.** Estas lecturas no piden ningún tiempo
de espera; piden que el pase de la 093 esté **cerrado**: su merge con «Supabase Preview» en `success`, su §5 en verde y
su §9 firmado («pasa»). Si el run de Branching de la 093 todavía corre, **se espera a que termine**: no se mergea con
otro run en curso. Con eso, el ledger tiene que dar **63 filas, la última 093**, y ninguna 094 o mayor. Si la 093 hizo
vuelta atrás, este pase **no se hace**.

```sql
-- 1.1 ledger: 63 · 093 y la 094 no está
select count(*), max(version) from supabase_migrations.schema_migrations;               -- 63 · 093
select version from supabase_migrations.schema_migrations where version >= '094';       -- 0 filas
-- 1.2 la verificación de la 094 (scripts/sql/094_verificacion.sql), estado de «antes»
--     esperado en prod: tablas 20 · anon_maintain 20 · anon_trt 0 · public 0 · ledger_094 false
--     (anon_otros y authenticated_maintain: anotar; la 094 no los cambia)
```
**1.2b Respaldo del ACL de las 20 tablas** (la consulta 1.2b del PASE-089, tal cual): guardar las 20 filas
`relname · relacl` y anotar `sha256_relacl` y `sha256_normalizado`. Es la referencia para §7.3.

Más la **prueba de humo de antes** (§4).

**Para (no se sigue)** si:
- el ledger no da 63 · 093, o ya tiene la 094;
- 1.2 no da 20 tablas, o `anon_maintain` no es 20 (algo cambió desde la 089: avisar), o `public` / `anon_trt` no son 0.

## 2. El cambio: merge del PR → Supabase Branching aplica la 094
- El PR trae **solo**: la migración, `scripts/sql/094_rollback.sql`, `scripts/sql/094_verificacion.sql`,
  `scripts/sql/094_pruebas.sh`, el registro (`migraciones-reservadas.json` y `ESTADO.md`) y este documento.
- **Se aplica con el merge, no a mano:** Branching corre `migrate` contra prod en cada push a `main`. Si la
  autoverificación aborta, no queda nada a medias (una transacción) y Branching queda en error: se sigue §6.
- **Merge commit**, con la firma de §9. Anotar el SHA y la hora (`-06:00`).

## 3. Prueba en staging
| Cuándo | Qué | Resultado |
|---|---|---|
| 10-nov 10:40 CR (script @ `084c4ba`) | `094_pruebas.sh hwiatgicyyqyezqwldia`, transacciones descartadas | **8 OK · 0 FALLA · VERDE** |

Los 8 casos:
- sin la 094, `anon` tiene MAINTAIN en las 23 tablas (el hueco existe);
- con la 094, `anon` queda sin MAINTAIN y todo lo demás igual (sus otros permisos, `PUBLIC` y `authenticated`);
- con la 094, el ACL de las 23 tablas cambia **solo** en `anon:MAINTAIN`;
- la autoverificación **aborta** si se planta un TRUNCATE para `anon` o un SELECT para `PUBLIC`;
- la 094 + el rollback vuelve a la verificación de hoy y al ACL completo de hoy (normalizado);
- staging terminó igual que al empezar: la 094 no quedó aplicada.

## 4. Prueba de humo en PROD (SOLO LECTURA)
Es solo de catálogo: la 094 no cambia lo que ve nadie.
- **4a.** 1.2: antes, el estado de «antes»; después, el de 5.3.
- **4b.** La consulta 4b del PASE-089 (cuentas activas, solo conteos) dentro de `begin read only`: **después = antes**,
  con la misma excepción de `base`.
- **4c. Pantallas:** abrir la app sin sesión (`/login`, `/registro`) y con sesión de owner (Caja, Propinas, Ventas): nada
  nuevo en rojo.

## 5. Verificación después del merge
1. **Branching:** el «Supabase Preview» del merge commit que termina en `success`. Quedan otros con el mismo nombre en
   «in progress» que no cierran: pasó igual con la 085 y la 089. En el log, `Applying migration 094_anon_sin_maintain.sql`.
2. **Ledger** (solo lectura): **exactamente 1 fila 094 con su `name`**. No se compara md5.
   ```sql
   select count(*), max(version) from supabase_migrations.schema_migrations;                     -- 64 · 094
   select count(*) from supabase_migrations.schema_migrations where version = '094' and name = 'anon_sin_maintain';   -- 1
   select array_length(statements, 1) from supabase_migrations.schema_migrations where version = '094';  -- anotar
   ```
3. **Catálogo:** 1.2 → `tablas` 20 · **`anon_maintain` 0** · `anon_trt` 0 · `public` 0 · `ledger_094` true;
   `anon_otros` y `authenticated_maintain` **iguales** a los de antes. Y 1.2b: `sha256_normalizado` distinto del de antes
   **solo** porque falta `anon:MAINTAIN` (se puede comprobar con la versión de 1.2b que excluye esa entrada).
4. **Humo:** 4b igual que antes y 4c sin rojos.

## 6. Criterios de parada → vuelta atrás (§7)
- Branching en error (`MIGRATIONS_FAILED`; por ejemplo, la autoverificación abortó) o aplicando otra cosa. Si abortó, no
  hay nada que deshacer en la base: se hace el revert del merge (§7.2) y se avisa.
- 5.2 sin exactamente 1 fila 094 con `name = 'anon_sin_maintain'`.
- 5.3 con `anon_maintain` distinto de 0, o con `anon_otros` / `authenticated_maintain` distintos de antes.
- 4b distinto de antes, o 4c con una pantalla rota.

## 7. Vuelta atrás (todo en la misma ventana; nadie más pushea a `main`)
1. **En prod, UN bloque** (editor SQL): precondición + el cuerpo de `scripts/sql/094_rollback.sql`, sin su
   `begin`/`commit`:
   ```sql
   begin;
   do $$ begin
     if (select count(*) from supabase_migrations.schema_migrations where version = '094') <> 1 then
       raise exception 'precondición: se esperaba exactamente 1 fila 094 en el ledger: no se toca nada';
     end if;
   end $$;
   -- … pegar acá el cuerpo de scripts/sql/094_rollback.sql, sin su begin/commit …
   commit;
   ```
2. **Enseguida, revert del merge en `main`**, que saca el `.sql`:
   - si el archivo se queda en `main`, Branching la vuelve a aplicar en el próximo push;
   - si se saca el archivo sin borrar la fila, Branching falla en cada push (el caso de la 074).
3. **Verificar:** Branching del revert «All migrations are up to date»; 1.2 con el estado de «antes»; **1.2b con
   `sha256_normalizado` igual al respaldo**, o la diferencia anotada tabla por tabla. Un permiso que falta o que sobra
   **no** se arregla a mano sin la firma del dueño.
4. **La 095 no pasa** ese día: tiene número mayor y espera a que la 094 vuelva a estar en `main` y en prod.

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
| 0.4 rama al día con `main` · diff solo los archivos de la 094 | | |
| 0.7 la 093 en prod con su pase cerrado | | |
| 1.1 ledger 63 · 093 · ninguna versión ≥ 094 | 63 · 093 | |
| 1.2 verificación «antes»: 20 · 20 · anon_otros (anotar) · 0 · 0 · authenticated (anotar) · false | | |
| 1.2b respaldo del ACL: 20 filas · `sha256_relacl` · `sha256_normalizado` | | |
| 4b antes (activas), justo antes del merge | | |
| Gate de CI en la cabeza del PR (enlace), o la aceptación explícita del dueño sin ese verde, con el motivo | | |
| §2 merge (SHA, hora) | | |
| 5.1 Branching success · log con la 094 | | |
| 5.2 exactamente 1 fila 094 con `name = 'anon_sin_maintain'` (statements: anotar) | 64 · 094 · 1 | |
| 5.3 anon_maintain 0 · lo demás igual | | |
| 4b después = antes · 4c sin rojos | | |
| Cierre: pasa / vuelta atrás (hasta qué paso de §7) | | |
