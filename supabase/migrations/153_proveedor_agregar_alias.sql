-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 153 (origen 096) — agregar un alias de proveedor de forma ATÓMICA (proveedor_agregar_alias). ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- ⚠ SIN FIRMA. No se mergea ni se aplica en prod sin la firma del dueño. Creada como 096 (bloque caja); prod va por la
-- 151, así que se renumeró a la 153 del bloque de PASE (regla 3), con origen 096. La 152 la usa el #140 (aviso del Club).
--
-- ── QUÉ CIERRA ─────────────────────────────────────────────────────────────────────────────
-- El #161 hace que el asistente de Caja guarde el nombre leído de la factura como alias del proveedor. El cliente relee
-- `suppliers.aliases` y hace UPDATE del array entero: si dos cajas agregan un alias al mismo proveedor a la vez, la
-- segunda pisa a la primera (se pierde un alias). Esta función hace el agregado en UN UPDATE: el array nuevo se arma
-- sobre el valor que tiene la fila al momento de escribir, no sobre una lectura anterior.
--
-- ── QUÉ HACE ───────────────────────────────────────────────────────────────────────────────
--   · `public.proveedor_clave_alias(text)`: la misma clave que `claveProveedor` del cliente
--     (src/shared/utils/proveedorAlias.ts): sin tildes (NFD + quitar marcas U+0300–U+036F), minúsculas y solo a-z0-9.
--     No usa la extensión unaccent (no está en el esquema): `normalize()` es del núcleo de Postgres. La paridad con el
--     cliente la cuida src/shared/utils/proveedorAlias.sql.test.ts.
--   · `public.proveedor_agregar_alias(p_supplier_id uuid, p_alias text) returns boolean`, SECURITY INVOKER:
--       - rechaza (22023) un alias vacío o con clave de menos de 4 caracteres (ALIAS_MIN del cliente);
--       - UN UPDATE: `aliases = array_append(coalesce(aliases,'{}'), alias)` solo si el proveedor está activo y ni su
--         nombre ni ningún alias tiene ya la misma clave;
--       - devuelve true si lo agregó; false si ya estaba, si el proveedor está inactivo o no existe, o si la RLS no
--         deja escribir esa fila.
--   · Concurrencia: dos llamadas sobre la misma fila se ordenan por el lock de fila; la segunda vuelve a evaluar el
--     WHERE (incluido el NOT EXISTS sobre `aliases`) contra la versión ya escrita por la primera (READ COMMITTED):
--     mismo alias → la segunda devuelve false; alias distintos → quedan los dos.
--
-- ── PERMISOS ───────────────────────────────────────────────────────────────────────────────
--   · INVOKER: decide la RLS que ya existe. `suppliers_op_write` (mig 012) deja escribir a owner, manager y cajero
--     activos; el contador solo lee (095) → su UPDATE afecta 0 filas → false. No hace falta DEFINER.
--   · `revoke all … from public` y `grant execute … to authenticated` en las dos funciones (anon no las ejecuta).
--
-- ── LO QUE NO TOCA ─────────────────────────────────────────────────────────────────────────
--   · Ni tablas, ni columnas, ni policies, ni plata. El cliente sigue funcionando sin esta migración (cae al UPDATE de
--     hoy si la función no existe).
--
-- Pruebas: scripts/sql/153_pruebas.sql (+ 153_pruebas.py; solo staging, transacción descartada, toma los usuarios de
-- la base: no necesita UUID externos).
-- Rollback: scripts/sql/153_rollback.sql.

begin;

create or replace function public.proveedor_clave_alias(p text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog, pg_temp
as $$
  select regexp_replace(
           lower(regexp_replace(normalize(coalesce(p, ''), NFD), '[\u0300-\u036f]', '', 'g')),
           '[^a-z0-9]', '', 'g')
$$;

comment on function public.proveedor_clave_alias(text) is
  'Clave de nombre de proveedor (sin tildes, minúsculas, solo a-z0-9). Igual a claveProveedor del cliente. Mig 153.';

create or replace function public.proveedor_agregar_alias(p_supplier_id uuid, p_alias text)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_alias text := btrim(coalesce(p_alias, ''));
  v_clave text := public.proveedor_clave_alias(v_alias);
  v_id uuid;
begin
  if v_clave = '' then
    raise exception 'ALIAS_VACIO: el alias no tiene letras ni números' using errcode = '22023';
  end if;
  if length(v_clave) < 4 then
    raise exception 'ALIAS_CORTO: el alias necesita al menos 4 letras o números' using errcode = '22023';
  end if;

  update public.suppliers s
     set aliases = array_append(coalesce(s.aliases, '{}'::text[]), v_alias)
   where s.id = p_supplier_id
     and s.is_active
     and public.proveedor_clave_alias(s.name) <> v_clave
     and not exists (
           select 1 from unnest(coalesce(s.aliases, '{}'::text[])) as a(x)
            where public.proveedor_clave_alias(a.x) = v_clave)
  returning s.id into v_id;

  return v_id is not null;
end
$$;

comment on function public.proveedor_agregar_alias(uuid, text) is
  'Agrega un alias al proveedor activo en un UPDATE atómico, sin duplicar por clave. INVOKER: decide la RLS de suppliers. Mig 153.';

revoke all on function public.proveedor_clave_alias(text) from public;
revoke all on function public.proveedor_agregar_alias(uuid, text) from public;
grant execute on function public.proveedor_clave_alias(text) to authenticated;
grant execute on function public.proveedor_agregar_alias(uuid, text) to authenticated;

-- Verificación (si algo no quedó como se espera, aborta toda la migración)
do $$
begin
  if exists (select 1 from pg_proc where oid = 'public.proveedor_agregar_alias(uuid,text)'::regprocedure and prosecdef) then
    raise exception '153: proveedor_agregar_alias tiene que ser SECURITY INVOKER';
  end if;
  if has_function_privilege('anon', 'public.proveedor_agregar_alias(uuid,text)', 'EXECUTE') then
    raise exception '153: anon no puede ejecutar proveedor_agregar_alias';
  end if;
  if not has_function_privilege('authenticated', 'public.proveedor_agregar_alias(uuid,text)', 'EXECUTE') then
    raise exception '153: authenticated tiene que poder ejecutar proveedor_agregar_alias';
  end if;
  if public.proveedor_clave_alias('Exportadora Ñandú, S.A.') <> 'exportadoranandusa' then
    raise exception '153: la clave no coincide con la del cliente';
  end if;
end
$$;

commit;
