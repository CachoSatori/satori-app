# Gate de la 090 (Grok) — catálogo de staging, solo lectura · 09-nov-2026 ~19:15 CR

> Consultas de solo lectura en staging (`hwiatgicyyqyezqwldia`, ledger 83 filas / máx 085) y, para «quién crea las
> tablas de Branching», en prod (`yiczgdtirrkdvohdquzf`, solo lectura). Nada se cambió. Sin esto la 090 no va a staging.

## Resultado
| Qué | Staging | Lectura |
|---|---|---|
| Dueño de las tablas/vistas de `public` | **postgres: 105 de 105** | todas las crea `postgres` |
| Dueño de las funciones de `public` | **postgres: 166 de 166** | ídem |
| Dueño del esquema `public` | `pg_database_owner` | normal en Supabase |
| ACL del esquema `public` | USAGE para PUBLIC, postgres, anon, authenticated y service_role; CREATE solo el dueño | normal |
| Privilegios por defecto **globales** (todas las bases/esquemas) | **ninguno** | no hay que tocar nada global |
| Privilegios por defecto en `public`, rol **postgres** | tablas `anon=arwdDxtm`, funciones `anon=X`, secuencias `anon=rwU` (más authenticated y service_role) | **esto es lo que cambia la 090** (solo tablas, solo anon) |
| Privilegios por defecto en `public`, rol **supabase_admin** | los mismos (anon con todo) | postgres **no es miembro** de supabase_admin: no se pueden cambiar desde la migración. Solo afectan a lo que cree la plataforma en `public` (hoy: nada; las 105 son de postgres) |
| PUBLIC: grants en tablas de `public` | **0** | nada que anon herede por tablas |
| PUBLIC: EXECUTE en funciones de `public` | 7: `get_my_role`, `handle_new_user`, `handle_updated_at`, `log_movement_edit`, `touch_updated_at`, `unif_on_cash_movement`, `update_ingredient_stock` (igual en prod) | casi todas son de trigger (no se llaman directo); `get_my_role` la necesitan todas las políticas. Fuera del alcance de la 090 |
| Membresías | `postgres` es miembro de anon, authenticated, authenticator, service_role (+ roles pg_*); **no** de supabase_admin. `authenticator` es miembro de anon/authenticated/service_role. `supabase_admin` es superusuario | `alter default privileges for role postgres` lo puede correr postgres sobre sí mismo |
| Dueño del ledger `supabase_migrations.schema_migrations` | postgres | — |

## ¿Quién crea las tablas de Branching?
**`postgres`.** Evidencia en prod: la función `pos_prompax_agregado`, creada por Branching al mergear el #58 (mig 080),
es de `postgres`; las tablas de las migraciones aplicadas a mano (Management API / editor SQL, p. ej. `sops`) también.
El ledger no guarda quién aplicó cada versión (columnas: `version`, `statements`, `name`).

**Conclusión:** la 090 (`alter default privileges for role postgres in schema public revoke all on tables from anon`)
cubre las tablas que crean Branching, el editor SQL y la Management API. No cubre lo que cree `supabase_admin` en
`public` (hoy nada). **Gate cumplido para pasar a staging** (con firma), en una ventana nocturna, con
`scripts/sql/090_pruebas.sql` en una transacción descartada.

## Re-corrida del gate — 09-nov, 08:27 CR (antes de aplicar)
Mismas consultas, solo lectura, salida guardada fuera del repo (sha256 de la salida `b12da126e2836991…`).
Resultado igual al de las 19:15: **106** tablas/vistas y **167** funciones de `public`, todas de `postgres` (una tabla
más que ayer, también de `postgres`); sin privilegios por defecto globales; en `public`, los de `postgres` y los de
`supabase_admin` le dan todo a anon; PUBLIC con 0 permisos en tablas y EXECUTE en las mismas 7 funciones; `postgres`
no es miembro de `supabase_admin` (superusuario); ledger 83 / 085.

## ✅ Residual aceptado por el dueño (por escrito, 09-nov)
Los privilegios por defecto del rol **`supabase_admin`** en `public` siguen dándole todo a anon en las tablas que ese
rol cree. La 090 no puede cambiarlos (postgres no es miembro de supabase_admin). Hoy `supabase_admin` no crea nada en
`public` (las 106 son de postgres). **El dueño aceptó este residual por escrito el 09-nov.** La red sigue siendo la
prueba 82 del Club, que marca cualquier tabla nueva con permisos de anon sin política.

## ✅ Aplicada en staging — 09-nov, 08:28 CR (firmada por el dueño para staging)
- Después de la 089 (08:27, 8/8).
- `scripts/sql/090_pruebas.sql` ANTES (transacción descartada): **8/8 OK**.
- Aplicación: UNA transacción con la 090 y su fila del ledger (md5 `0d93a8db…` = el archivo). Ledger de staging 85 / 090.
- DESPUÉS (transacción descartada, con una tabla nueva de prueba): el valor por defecto de `public` para tablas de
  postgres ya no menciona a anon; la tabla nueva: anon sin permisos, authenticated y service_role sí. (Un chequeo de
  «tablas viejas iguales» que miré sobre `customers` dio anon sin INSERT: ya era así antes —la mig 072 se lo sacó, en
  prod y en staging—; la 090 no toca tablas existentes.)
- Batería del Club `075_pruebas_staging.sql` (rama `claude/epic-tesla-pyo77m` @ `da3bc9a`, en su transacción
  descartada): **580/580**. Prueba 82: **4/4** — «fuera del Club: ninguna tabla NUEVA con permisos de anon sin
  política (marcadas hoy, conocidas: 0)» y la negativa en verde.
- Residuos: ninguna tabla de prueba; sin consultas activas al terminar (08:30 CR). Staging libre.
