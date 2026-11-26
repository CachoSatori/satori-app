-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 203 · Compras F1: «Es un proveedor real · recordar» (la lista de emisores se arma sola) ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- Decisión del dueño (26-nov): `fe_emisores_conocidos` (201) no se carga a mano; se arma mientras se revisa. En la
-- pestaña «📨 Facturas electrónicas», un comprobante «revisar» por emisor no conocido muestra nombre y cédula del emisor
-- y el botón «Es un proveedor real · recordar». Lo pueden tocar el owner y el contador (validado ACÁ, no en la pantalla).
--
-- Qué agrega (no toca el .sql de la 199 ni de la 201, regla 10; no reemplaza ninguna función):
--   1. `fe_emisores_conocidos` gana `nombre` (del XML), `origen` ('manual' | 'revision'), `aprobado_por` y `aprobado_en`.
--   2. `fe_emisores_bitacora`: quién recordó, reactivó, resolvió o desactivó qué cédula, cuándo, con qué rol y cuántos
--      comprobantes cambió. No va en `fe_ingesta_bitacora` a propósito: esa alimenta «Última ingesta» (max(ts)) y el
--      conteo por día del resumen; una fila de la app haría ver «al día» un script caído.
--   3. `fe_emisor_recordar(cedula)` (owner y contador), en UNA transacción:
--        · alta del emisor activo (o, si estaba inactivo, lo reactiva SOLO el owner: lo desactivó él);
--        · cada comprobante «revisar» / «receptor_distinto» de ese emisor pierde SOLO el motivo «emisor no conocido»;
--          si era su único motivo y estaba «revisar», pasa a «ok»; si tiene otro (otro XML con la misma clave,
--          respuesta de Hacienda distinta, receptor, lo que marcó la Edge) se queda como está con el resto del motivo.
--        · idempotente: tocar dos veces no duplica (PK por cédula) ni deja otra fila de bitácora si no cambió nada.
--      Solo se recuerda una cédula que llegó en algún comprobante (no se cargan cédulas inventadas desde la API).
--   4. `fe_emisor_desactivar(cedula)` (solo owner): activo = false con su fila de bitácora. No toca comprobantes.
-- Las dos son SECURITY DEFINER con search_path fijo; las ejecuta `authenticated` y el rol se mira adentro (42501).
-- Entra a prod por merge → Branching, con la firma del dueño (docs/pases/PASE-203-fe-emisor-recordar.md).
-- Vuelta atrás: scripts/sql/203_rollback.sql. Pruebas: scripts/sql/203_pruebas.sql (terminan en ROLLBACK).

-- ── 0. Guarda: necesita la 201 tal cual y no puede correr dos veces ──────────────────────
do $guarda203$
declare
  o text;
  h text;
begin
  foreach o in array array['public.fe_comprobantes', 'public.fe_emisores_conocidos'] loop
    if to_regclass(o) is null then
      raise exception '203: falta % (migraciones 199/201)', o;
    end if;
  end loop;
  -- R13: el motivo que este botón quita lo escribe fe_ingestar de la 201. Si su cuerpo no es el de la 201 (md5 del
  -- prosrc sin espacios, medido del archivo de la 201 aplicado en Postgres 16), el texto podría ser otro: se para.
  for o, h in select x.f, x.h from (values
      ('fe_ingestar',     '927be5f667795b2632ec30daa90a9c85'),
      ('fe_motivo_sumar', '28958827da223d801698c8772036cb72')) x(f, h) loop
    if (select md5(regexp_replace(p.prosrc, '\s', '', 'g'))
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = o) is distinct from h then
      raise exception '203: public.% no es la de la 201 (md5 distinto): se para sin tocar nada', o;
    end if;
  end loop;
  if to_regclass('public.fe_emisores_bitacora') is not null
     or to_regprocedure('public.fe_emisor_recordar(text)') is not null
     or to_regprocedure('public.fe_emisor_desactivar(text)') is not null
     or exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'fe_emisores_conocidos'
                  and column_name in ('nombre', 'origen', 'aprobado_por', 'aprobado_en')) then
    raise exception '203: ya corrió (bitácora, funciones o columnas nuevas): se para sin tocar nada';
  end if;
end
$guarda203$;

-- ── 1. Emisores conocidos: nombre, origen y quién lo aprobó ──────────────────────────────
alter table public.fe_emisores_conocidos
  add column nombre       text check (nombre is null or length(nombre) <= 200),
  add column origen       text not null default 'manual' check (origen in ('manual', 'revision')),
  add column aprobado_por uuid,
  add column aprobado_en  timestamptz;
comment on column public.fe_emisores_conocidos.origen is
  'Mig 203. manual = lo cargó el owner directo en la tabla · revision = «Es un proveedor real · recordar» en la pestaña de facturas electrónicas.';
-- las columnas nuevas NO se escriben por la API (la 201 solo da insert (cedula, activo) y update (activo)):
-- las llenan fe_emisor_recordar / fe_emisor_desactivar.

-- ── 2. Bitácora de emisores ──────────────────────────────────────────────────────────────
create table public.fe_emisores_bitacora (
  id             bigint      generated always as identity primary key,
  ts             timestamptz not null default now(),
  cedula         text        not null,
  accion         text        not null check (accion in ('recordar', 'reactivar', 'resolver', 'desactivar')),
  por            uuid        not null,
  rol            text        not null,
  pasan_a_ok     integer     not null default 0 check (pasan_a_ok >= 0),
  siguen_revisar integer     not null default 0 check (siguen_revisar >= 0)
);
create index fe_emisores_bitacora_cedula_idx on public.fe_emisores_bitacora (cedula, ts desc);
comment on table public.fe_emisores_bitacora is
  'Mig 203. Rastro de «recordar» (alta), «reactivar», «resolver» (ya estaba activo y se limpiaron comprobantes) y «desactivar». La escriben SOLO fe_emisor_recordar y fe_emisor_desactivar.';
alter table public.fe_emisores_bitacora enable row level security;
create policy fe_emisores_bitacora_leer on public.fe_emisores_bitacora
  for select to authenticated
  using ((select public.get_my_role()) in ('owner', 'contador'));
revoke all on table public.fe_emisores_bitacora from public, anon, authenticated;
grant select on table public.fe_emisores_bitacora to authenticated;

-- ── 3. «Es un proveedor real · recordar» ─────────────────────────────────────────────────
-- → { resultado: 'recordar'|'reactivar'|'resolver'|'ya_estaba', pasan_a_ok, siguen_revisar }
create function public.fe_emisor_recordar(p_cedula text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_uid    uuid := auth.uid();
  v_rol    text := (select public.get_my_role())::text;
  v_nombre text;
  v_prev   record;
  v_c      record;
  v_resto  text;
  v_accion text;
  v_ok     integer := 0;
  v_siguen integer := 0;
  -- el texto EXACTO que escribe fe_ingestar (201); lo cuida la guarda (md5) y src/shared/api/feIngesta.contrato203.test.ts
  m_emisor constant text := 'emisor no conocido (cédula sin cargar en emisores conocidos)';
begin
  if v_uid is null or v_rol is null or v_rol not in ('owner', 'contador') then
    raise exception 'Solo el owner y el contador recuerdan emisores' using errcode = '42501';
  end if;
  if p_cedula is null or p_cedula !~ '^[0-9A-Za-z]{9,20}$' then
    raise exception 'fe_emisor_recordar: cédula inválida' using errcode = '22023';
  end if;
  -- dos toques a la vez (owner y contador): el segundo espera y ve lo que dejó el primero
  perform pg_advisory_xact_lock(hashtextextended('fe-emisor:' || p_cedula, 203));

  select left(coalesce(nullif(btrim(c.emisor_nombre), ''), nullif(btrim(c.emisor_nombre_comercial), '')), 200)
    into v_nombre
    from public.fe_comprobantes c
   where c.emisor_cedula = p_cedula
   order by c.recibido_en desc
   limit 1;
  if not found then
    raise exception 'fe_emisor_recordar: no llegó ningún comprobante de esa cédula' using errcode = '22023';
  end if;

  select e.* into v_prev from public.fe_emisores_conocidos e where e.cedula = p_cedula for update;
  if not found then
    insert into public.fe_emisores_conocidos (cedula, activo, nombre, origen, aprobado_por, aprobado_en)
    values (p_cedula, true, v_nombre, 'revision', v_uid, now());
    v_accion := 'recordar';
  elsif not v_prev.activo then
    if v_rol <> 'owner' then
      raise exception 'Ese emisor lo desactivó el owner: solo el owner lo vuelve a activar' using errcode = '42501';
    end if;
    update public.fe_emisores_conocidos e
       set activo = true, nombre = coalesce(e.nombre, v_nombre), aprobado_por = v_uid, aprobado_en = now()
     where e.cedula = p_cedula;
    v_accion := 'reactivar';
  end if;

  -- comprobantes de ese emisor con el motivo «emisor no conocido»: se quita SOLO ese motivo
  for v_c in
    select c.id, c.estado_parseo, c.motivo
      from public.fe_comprobantes c
     where c.emisor_cedula = p_cedula
       and c.estado_parseo in ('revisar', 'receptor_distinto')
       and m_emisor = any (string_to_array(c.motivo, ' · '))
     order by c.id
       for update
  loop
    v_resto := nullif(btrim(array_to_string(array(
                 select u.x from unnest(string_to_array(v_c.motivo, ' · ')) with ordinality u(x, i)
                  where u.x <> m_emisor order by u.i), ' · ')), '');
    if v_resto is null and v_c.estado_parseo = 'revisar' then
      update public.fe_comprobantes c set estado_parseo = 'ok', motivo = null where c.id = v_c.id;
      v_ok := v_ok + 1;
    elsif v_resto is not null then
      update public.fe_comprobantes c set motivo = v_resto where c.id = v_c.id;
      v_siguen := v_siguen + 1;
    end if;
    -- receptor_distinto sin otro motivo no existe (la 199 siempre suma el del receptor): no se toca
  end loop;

  if v_accion is null and v_ok + v_siguen > 0 then
    v_accion := 'resolver';
  end if;
  if v_accion is not null then
    insert into public.fe_emisores_bitacora (cedula, accion, por, rol, pasan_a_ok, siguen_revisar)
    values (p_cedula, v_accion, v_uid, v_rol, v_ok, v_siguen);
  end if;
  return jsonb_build_object('resultado', coalesce(v_accion, 'ya_estaba'), 'pasan_a_ok', v_ok, 'siguen_revisar', v_siguen);
end;
$function$;
revoke all on function public.fe_emisor_recordar(text) from public, anon, authenticated;
grant execute on function public.fe_emisor_recordar(text) to authenticated;

-- ── 4. Desactivar (solo owner) ───────────────────────────────────────────────────────────
-- → { resultado: 'desactivar'|'ya_estaba' }. No toca comprobantes: lo que ya entró «ok» queda «ok».
create function public.fe_emisor_desactivar(p_cedula text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_uid uuid := auth.uid();
  v_rol text := (select public.get_my_role())::text;
  v_n   integer;
begin
  if v_uid is null or v_rol is distinct from 'owner' then
    raise exception 'Solo el owner desactiva emisores' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('fe-emisor:' || coalesce(p_cedula, ''), 203));
  update public.fe_emisores_conocidos e set activo = false where e.cedula = p_cedula and e.activo;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    if not exists (select 1 from public.fe_emisores_conocidos e where e.cedula = p_cedula) then
      raise exception 'fe_emisor_desactivar: esa cédula no está en emisores conocidos' using errcode = '22023';
    end if;
    return jsonb_build_object('resultado', 'ya_estaba');
  end if;
  insert into public.fe_emisores_bitacora (cedula, accion, por, rol) values (p_cedula, 'desactivar', v_uid, v_rol);
  return jsonb_build_object('resultado', 'desactivar');
end;
$function$;
revoke all on function public.fe_emisor_desactivar(text) from public, anon, authenticated;
grant execute on function public.fe_emisor_desactivar(text) to authenticated;
