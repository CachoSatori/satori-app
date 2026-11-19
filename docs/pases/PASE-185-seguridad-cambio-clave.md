# Pase a PROD de la mig 185 `seguridad_cambio_clave` (origen caja 099)

> **⛔ Seguridad + esquema: firma del dueño sobre el SHA exacto + verificador independiente.** Decisión del dueño por el
> chat, 17-nov-2026 14:44 -06:00: poder **obligar** a un usuario a cambiar la contraseña la próxima vez que entra (dos
> cuentas cuyo hash de contraseña estuvo copiado en staging; el dueño ya cambió la suya). Si algo no coincide, **se para
> y se avisa**.
>
> - **Vía:** merge → Branching. No se aplica nada a mano. La 185 es el siguiente número del ledger de prod (184).
> - **Numeración:** creada en el bloque CAJA como 099 (el último libre: el bloque queda lleno) y renumerada a 185 en el
>   mismo PR porque 099 ≤ 184 (regla 3). Registro: `099 → 185`, `185 ← 099`.
> - **Regla del ledger:** exactamente 1 fila `185` / `seguridad_cambio_clave`.
> - **Responsables:** ejecución = el merge (Branching); control = una persona distinta de quien mergea (§3 y §4).

## 1. Qué pasa y qué no
**Pasa:** tabla `seguridad_cambio_clave` (una fila por usuario marcado: `marcado_en`, `marcado_por`, `huella_hash` =
md5 del hash de contraseña al marcar) con RLS (cada uno lee solo su fila y sin la huella; nadie escribe directo) y cuatro
funciones SECURITY DEFINER con `search_path = public, pg_temp`, ejecutables solo por `authenticated`:
`seguridad_marcar_cambio_clave(uuid)`, `seguridad_desmarcar_cambio_clave(uuid)`, `seguridad_cambio_clave_pendientes()`
(las tres solo owner activo) y `seguridad_debo_cambiar_clave()` (el usuario de la sesión; si la contraseña ya cambió,
borra la marca y devuelve false). La app: con la marca y conexión, solo deja estar en `/mi-cuenta`; Admin → Usuarios
tiene «Pedir cambio de contraseña».

**No pasa:** nada en `profiles` (ni columnas ni triggers: la bitácora 165 no se dispara), nada en `auth` salvo LEER
`auth.users.encrypted_password`, ningún dato cargado (la tabla nace vacía), ningún sagrado, ninguna Edge Function.

**Qué ve el personal:** nada, hasta que el owner marque a alguien. El marcado ve «Cambiar mi contraseña» con el aviso
«Por seguridad tenés que cambiar tu contraseña antes de seguir.» y «Cerrar sesión» en lugar de «Cancelar». Sin conexión
la app no lo bloquea.

## 2. Prerrequisitos
- Firma del dueño sobre el SHA de la cabeza del PR. Merge fuera de 15:50–19:00 (regla D1).
- Gate verde en esa cabeza; verificador independiente sobre el SQL (permisos y huella).
- Nadie más pushea a `main` en la ventana del merge.

## 3. Antes del merge (prod, solo lectura)
```sql
begin read only;
select max(version) as ultima from supabase_migrations.schema_migrations;          -- esperado: 184
select to_regclass('public.seguridad_cambio_clave') as tabla;                      -- esperado: null
select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname like 'seguridad\_%clave%';              -- esperado: 0
select count(*) filter (where role = 'owner' and is_active) as owners_activos from public.profiles;   -- anotar
rollback;
```
Si la última versión no es 184 o ya existe algo de la 185: **no se mergea**.

## 4. Después del merge (prod)
- Check «Supabase Preview» del merge en success, con «All migrations are up to date» en el log.
- Solo lectura:
```sql
begin read only;
select version, name from supabase_migrations.schema_migrations where version = '185';   -- 1 fila, seguridad_cambio_clave
select relrowsecurity from pg_class where oid = 'public.seguridad_cambio_clave'::regclass;  -- true
select count(*) from public.seguridad_cambio_clave;                                       -- 0
select has_column_privilege('authenticated', 'public.seguridad_cambio_clave', 'huella_hash', 'SELECT') as huella_visible, -- false
       has_table_privilege('authenticated', 'public.seguridad_cambio_clave', 'INSERT,UPDATE,DELETE') as escribe,          -- false
       has_table_privilege('anon', 'public.seguridad_cambio_clave', 'SELECT') as anon_lee;                                -- false
select p.proname, p.prosecdef, p.proconfig, has_function_privilege('anon', p.oid, 'EXECUTE') as anon_ejecuta
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname like 'seguridad\_%clave%' order by 1;          -- 4 filas: t · {search_path=public, pg_temp} · f
select count(*) filter (where role = 'owner' and is_active) as owners_activos from public.profiles;   -- = §3
rollback;
```
- **Humo** (transacción descartada; escribe solo si hubiera marcas viejas, y no hay): como un owner real, por su id,
  `pendientes()` devuelve 0 filas y `debo_cambiar_clave()` devuelve false; como un usuario no owner, `pendientes()` da
  42501.
```sql
begin;
select set_config('request.jwt.claims', json_build_object('sub', '<UUID_OWNER>', 'role', 'authenticated')::text, true);
set local role authenticated;
select count(*) from public.seguridad_cambio_clave_pendientes();   -- 0
select public.seguridad_debo_cambiar_clave();                      -- false
rollback;
```
- App (por contenido, regla 9): con un usuario sin marca, la app entra normal (Inicio / Caja).

## 5. Marcar a las dos cuentas (después de §4 OK)
**Preferido: desde la pantalla.** El dueño, en Admin → Usuarios, toca «Pedir cambio de contraseña» en la fila de cada
una y confirma. Debajo del nombre aparece «🔑 Cambio de contraseña pendiente · pedido el …».

**Alternativa por SQL** (Management API, una transacción; por id, sin correos en el repo; `<UUID_OWNER>` = el id del
dueño, así `marcado_por` queda a su nombre):
```sql
begin;
select set_config('request.jwt.claims', json_build_object('sub', '<UUID_OWNER>', 'role', 'authenticated')::text, true);
select public.seguridad_marcar_cambio_clave('<UUID_CUENTA_1>'), public.seguridad_marcar_cambio_clave('<UUID_CUENTA_2>');
select user_id, marcado_en, marcado_por from public.seguridad_cambio_clave order by marcado_en;   -- 2 filas
commit;
```
**Verificación:** cada persona, al abrir la app, ve solo «Cambiar mi contraseña» con el aviso; después de cambiarla,
su fila desaparece de «Usuarios» (al volver a abrir la pestaña) y la app la deja seguir.

> Ojo: esto empuja al dueño de la cuenta a cambiar la contraseña, pero no impide que alguien con la contraseña vieja
> entre por fuera de la app mientras tanto. Si hay sospecha concreta de uso, además: deshabilitar la cuenta (6.6,
> Tarea 3) o cambiarle la contraseña desde Supabase Auth.

## 6. Criterios de parada
- §3 no da lo esperado → no se mergea.
- Branching falla o el ledger no tiene exactamente 1 fila 185 → se para y se avisa (no se aplica nada a mano).
- §4 no coincide (RLS apagada, huella visible, `anon` ejecuta, owners activos distintos) → se para y vuelta atrás.
- La app bloquea a alguien sin marca → se para: revertir el código de la app (las funciones pueden quedar).

## 7. Vuelta atrás
`scripts/sql/185_rollback.sql` (borra las 4 funciones, la tabla con sus marcas y la fila 185 del ledger) y, **en el
mismo momento**, un PR que saca `supabase/migrations/185_seguridad_cambio_clave.sql` de `main` (regla 10) y revierte la
app. Sin las funciones la app no bloquea a nadie (si la consulta falla, deja pasar). Probada en la batería (caso 18).

## 8. Pruebas hechas (PR)
- `scripts/sql/185_pruebas.sql` (runner `185_pruebas.py --local`): Postgres 16 local de cero (todas las migraciones,
  rollback de la 185 antes, así la batería la aplica ella dentro de la transacción descartada): **21/21** casos y
  **12/12 mutaciones muerden**; el ASSERT aborta con «185-FALLAN» si algo cae (comprobado rompiendo la huella).
- **Staging: NO corrida.** La herramienta de SQL de la sesión cancela las escrituras (pide confirmación y no hay quien
  confirme) y el proxy bloquea la Management API. Para correrla en staging (todo en una transacción descartada; usa los
  owner/manager/salonero activos que ya existen sin cambiarles nada):
  `python3 scripts/sql/185_pruebas.py --armar > /tmp/b185.sql` y correr ese archivo contra `hwiatgic…`.
- App: `src/App.cambioClave.test.tsx` (7, enrutado real) y `src/modules/admin/UserApprovals.clave.test.tsx` (6), con
  mutaciones (§ del PR).

## 9. Firma y bitácora
| Cuándo (-06:00) | Quién | Qué |
|---|---|---|
| 2026-11-17 14:44 | dueño | Decide poder obligar a cambiar la contraseña (diseño en el chat) |
| | verificador independiente | Revisión SQL + batería |
| | dueño | Firma para prod sobre el SHA |
| | sesión | Merge; Branching aplica la 185 |
| | control | §4 OK |
| | dueño | Marca las dos cuentas (§5) |
