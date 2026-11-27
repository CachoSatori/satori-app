-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 205 · Catálogo del PoS: la falla del disparador queda a la vista y se repara sin       ║
-- ║       service_role (hallazgo 256)                                                      ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- La 198 (en el ledger de prod; su .sql NO se toca, regla 10) mantiene `pos_productos` con un disparador por sentencia
-- en `pos_ndf_ticket_lines`. Si `pos_catalogo_absorber` falla, el disparador lo traga y deja SOLO un WARNING en el log
-- de Postgres: nadie se entera, y la reparación (`pos_catalogo_refrescar`) solo la puede correr service_role.
--
-- Agrega / cambia:
--   1. `pos_catalogo_fallas`: una fila ABIERTA por (local, código SQLSTATE, patrón del mensaje). El patrón es el mensaje
--      sin lo que va entre comillas ni los números: la misma falla con otro valor suma `veces` y `facturas` en la misma
--      fila (no crece sin tope); el último mensaje crudo queda en `mensaje`. Lectura: owner y contador todo; manager,
--      solo sus locales (patrón de la 198). Nadie la escribe por la API.
--   2. `pos_catalogo_registrar()` (create or replace, misma firma, mismo SECURITY DEFINER y search_path): además del
--      WARNING de siempre, anota la falla. **La ingesta manda:** anotar NUNCA espera (toma un candado propio por local
--      con `pg_try_advisory_xact_lock`; si está tomado, solo avisa) y si anotar falla, otro WARNING y la factura entra
--      igual. El disparador no cambia (sigue apuntando a la misma función).
--   3. `pos_catalogo_reparar(p_local)`: SECURITY DEFINER. Owner (cualquier local, o null = todos, de a uno) y manager
--      (solo sus locales; decisión del dueño 26-nov). Toma el MISMO candado por local que `pos_ndf_ingestar` (082) y el
--      de las fallas, corre la regla de la 198 sobre toda la historia del local y cierra sus fallas abiertas. Enfriamiento:
--      una reparación por local por minuto (si no, «ya reparado hace N s», sin trabajo). Si la regla vuelve a fallar, da
--      el error, las fallas quedan abiertas y no cuenta para el enfriamiento.
--   4. `pos_catalogo_reparaciones`: última reparación por local (para el enfriamiento). Interna: nadie la lee por la API.
--
-- GUARDA: corre SOLO si `pos_catalogo_registrar` y `pos_catalogo_absorber` en la base son EXACTAMENTE los de la 198
-- (md5 de prosrc sin espacios, medidos del archivo de la 198 = prod 26-nov). Si ya está la 205, o cualquier otra cosa,
-- se para sin tocar nada.
-- NO toca `pos_ndf_*` (ni sus políticas ni el disparador), `pos_catalogo_absorber`, `pos_catalogo_refrescar`, ni datos.
-- Vuelta atrás: scripts/sql/205_rollback.sql. Pruebas: scripts/sql/205_pruebas.sql (terminan en ROLLBACK).

-- ── 0. Guarda por huella ──────────────────────────────────────────────────────────────────────
do $guarda205$
declare
  v_reg text;
  v_abs text;
begin
  if to_regprocedure('public.puede_ver_local(text)') is null or to_regprocedure('public.get_my_role()') is null then
    raise exception '205: falta puede_ver_local o get_my_role';
  end if;
  if to_regclass('public.pos_catalogo_fallas') is not null or to_regclass('public.pos_catalogo_reparaciones') is not null
     or to_regprocedure('public.pos_catalogo_reparar(text)') is not null then
    raise exception '205: ya aplicada (pos_catalogo_fallas, pos_catalogo_reparaciones o pos_catalogo_reparar ya existen): se para sin tocar nada';
  end if;
  if to_regprocedure('public.pos_catalogo_registrar()') is null or to_regprocedure('public.pos_catalogo_absorber(uuid[])') is null
     or not exists (select 1 from pg_trigger where tgrelid = 'public.pos_ndf_ticket_lines'::regclass
                    and tgname = 'trg_pos_catalogo_registrar') then
    raise exception '205: falta la 198 (pos_catalogo_registrar / pos_catalogo_absorber / disparador): se para sin tocar nada';
  end if;
  select md5(regexp_replace(prosrc, '\s', '', 'g')) into v_reg
    from pg_proc where oid = 'public.pos_catalogo_registrar()'::regprocedure;
  select md5(regexp_replace(prosrc, '\s', '', 'g')) into v_abs
    from pg_proc where oid = 'public.pos_catalogo_absorber(uuid[])'::regprocedure;
  if v_reg <> '85609c26a1736ff174aec2832d101dc6' or v_abs <> '75d332953001efe0734e99759106be19' then
    raise exception '205: los cuerpos en la base no son los de la 198 (registrar %, absorber %): se para sin tocar nada',
      left(v_reg, 8), left(v_abs, 8);
  end if;
end
$guarda205$;

-- ── 1. Avisos de falla del catálogo ───────────────────────────────────────────────────────────
create table public.pos_catalogo_fallas (
  id           bigint      generated always as identity primary key,
  local        text,                                   -- null = no se pudo saber de qué local era el lote
  codigo       text        not null,                   -- SQLSTATE del error
  patron       text        not null,                   -- mensaje sin valores entre comillas ni números (la clave)
  mensaje      text        not null,                   -- el ÚLTIMO sqlerrm crudo, hasta 500 caracteres (sin DETAIL)
  primera_en   timestamptz not null default now(),
  ultima_en    timestamptz not null default now(),
  veces        integer     not null default 1 check (veces >= 1),          -- lotes que fallaron así
  facturas     integer     not null default 0 check (facturas >= 0),       -- facturas de esos lotes (con repetidas)
  resuelta_en  timestamptz,
  resuelta_por uuid,
  check (primera_en <= ultima_en),
  check (resuelta_por is null or resuelta_en is not null)
);
-- Una sola fila abierta por (local, falla): la misma falla en cada lote suma, no agrega filas.
create unique index pos_catalogo_fallas_abierta_uq
  on public.pos_catalogo_fallas ((coalesce(local, '')), codigo, patron) where resuelta_en is null;
comment on table public.pos_catalogo_fallas is
  'Mig 205. Fallas del disparador del catálogo (pos_catalogo_registrar): una fila abierta por (local, SQLSTATE, patrón del mensaje), con veces, facturas, último mensaje y primera/última hora. La escribe SOLO el disparador; la cierra pos_catalogo_reparar. Lectura: owner y contador; manager, sus locales.';

alter table public.pos_catalogo_fallas enable row level security;
create policy pos_catalogo_fallas_leer on public.pos_catalogo_fallas
  for select to authenticated
  using ((select public.get_my_role()) in ('owner', 'contador')
         or ((select public.get_my_role()) = 'manager' and local is not null and public.puede_ver_local(local)));
revoke all on table public.pos_catalogo_fallas from public, anon, authenticated;
grant select on table public.pos_catalogo_fallas to authenticated;

-- Última reparación por local (enfriamiento de pos_catalogo_reparar). Interna.
create table public.pos_catalogo_reparaciones (
  local      text        primary key,
  ultima_en  timestamptz not null,
  ultima_por uuid
);
comment on table public.pos_catalogo_reparaciones is
  'Mig 205. Última reparación del catálogo por local (una por minuto). La escribe SOLO pos_catalogo_reparar. Interna: sin lectura por la API.';
alter table public.pos_catalogo_reparaciones enable row level security;
revoke all on table public.pos_catalogo_reparaciones from public, anon, authenticated;

-- ── 2. El disparador: avisa y anota sin esperar nunca; nunca frena la ingesta ─────────────────
create or replace function public.pos_catalogo_registrar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_estado text;
  v_msg    text;
  v_patron text;
  r        record;
  v_hubo   boolean := false;
begin
  begin
    perform public.pos_catalogo_absorber(array(select distinct ticket_id from nuevas));
  exception when others then
    v_estado := sqlstate;
    v_msg := left(sqlerrm, 500);
    raise warning '198 pos_catalogo_registrar: % (%)', v_msg, v_estado;
    -- 205: la falla queda anotada por local. Anotar NUNCA espera: candado propio por local con try (si otro lote lo
    -- tiene, solo avisa). Si anotar falla, otro aviso y la factura entra igual.
    v_patron := regexp_replace(regexp_replace(v_msg, '"[^"]*"|''[^'']*''', '?', 'g'), '[0-9]+', '#', 'g');
    begin
      for r in select t.local, count(*)::integer as n
                 from public.pos_ndf_tickets t
                where t.id in (select distinct ticket_id from nuevas)
                group by t.local
                order by t.local
      loop
        v_hubo := true;
        if pg_try_advisory_xact_lock(hashtextextended('pos_catalogo_fallas:' || coalesce(r.local, ''), 0)) then
          insert into public.pos_catalogo_fallas as f (local, codigo, patron, mensaje, facturas)
          values (r.local, v_estado, v_patron, v_msg, r.n)
          on conflict ((coalesce(local, '')), codigo, patron) where resuelta_en is null do update set
            ultima_en = now(), veces = f.veces + 1, facturas = f.facturas + excluded.facturas, mensaje = excluded.mensaje;
        else
          raise warning '205 pos_catalogo_registrar: fallas de % ocupadas, no se anotó (no se espera)', r.local;
        end if;
      end loop;
      if not v_hubo then
        if pg_try_advisory_xact_lock(hashtextextended('pos_catalogo_fallas:', 0)) then
          insert into public.pos_catalogo_fallas as f (local, codigo, patron, mensaje, facturas)
          select null, v_estado, v_patron, v_msg, count(distinct ticket_id)::integer from nuevas
          on conflict ((coalesce(local, '')), codigo, patron) where resuelta_en is null do update set
            ultima_en = now(), veces = f.veces + 1, facturas = f.facturas + excluded.facturas, mensaje = excluded.mensaje;
        else
          raise warning '205 pos_catalogo_registrar: fallas sin local ocupadas, no se anotó (no se espera)';
        end if;
      end if;
    exception when others then
      raise warning '205 pos_catalogo_registrar: no se pudo anotar la falla: % (%)', sqlerrm, sqlstate;
    end;
  end;
  return null;
end;
$function$;
revoke all on function public.pos_catalogo_registrar() from public, anon, authenticated;
comment on function public.pos_catalogo_registrar() is
  'Mig 198 + 205. Disparador por sentencia de pos_ndf_ticket_lines: mantiene pos_productos con pos_catalogo_absorber. Si falla: WARNING y una fila en pos_catalogo_fallas, sin esperar nunca (try-lock por local); la factura entra igual (la ingesta manda).';

-- ── 3. Reparar sin service_role ───────────────────────────────────────────────────────────────
create function public.pos_catalogo_reparar(p_local text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_rol      public.user_role := public.get_my_role();
  v_loc      text;
  v_hace     integer;
  v_escritos integer := 0;
  v_cerradas integer := 0;
  v_k        integer;
  v_huerf    integer;
  v_saltados jsonb := '[]'::jsonb;
  v_hechos   text[] := '{}';
begin
  if v_rol is null or v_rol not in ('owner', 'manager') then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  -- null = todos los locales (y las fallas sin local): solo el owner.
  if p_local is null and v_rol <> 'owner' then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if v_rol = 'manager' and not public.puede_ver_local(p_local) then
    raise exception 'No autorizado para este local' using errcode = '42501';
  end if;

  -- De a un local por vez, en orden fijo (los candados quedan hasta el fin de la transacción).
  for v_loc in
    select x.local from (select p_local as local where p_local is not null
                         union
                         select distinct t.local from public.pos_ndf_tickets t where p_local is null
                         union
                         select distinct f.local from public.pos_catalogo_fallas f
                          where p_local is null and f.local is not null and f.resuelta_en is null) x
     order by x.local
  loop
    -- El MISMO candado que pos_ndf_ingestar (082): no se pisa con un lote del PoS de ese local.
    perform pg_advisory_xact_lock(hashtextextended('pos_ndf_ingest:' || v_loc, 0));
    perform pg_advisory_xact_lock(hashtextextended('pos_catalogo_fallas:' || v_loc, 0));
    -- Enfriamiento: una reparación por local por minuto.
    select floor(extract(epoch from (now() - r.ultima_en)))::integer into v_hace
      from public.pos_catalogo_reparaciones r where r.local = v_loc and r.ultima_en > now() - interval '60 seconds';
    if found then
      v_saltados := v_saltados || jsonb_build_array(jsonb_build_object('local', v_loc, 'hace_s', v_hace));
      continue;
    end if;
    -- La misma regla de la 198, sobre toda la historia (si vuelve a fallar, el error sube y nada se cierra ni se anota).
    v_escritos := v_escritos + public.pos_catalogo_absorber(array(
      select t.id from public.pos_ndf_tickets t where t.local = v_loc));
    update public.pos_catalogo_fallas f
       set resuelta_en = now(), resuelta_por = auth.uid()
     where f.resuelta_en is null and f.local = v_loc;
    get diagnostics v_k = row_count;
    v_cerradas := v_cerradas + v_k;
    insert into public.pos_catalogo_reparaciones as r (local, ultima_en, ultima_por) values (v_loc, now(), auth.uid())
    on conflict (local) do update set ultima_en = excluded.ultima_en, ultima_por = excluded.ultima_por;
    v_hechos := v_hechos || v_loc;
  end loop;

  -- Las fallas sin local: solo con null (owner), después de haber pasado por todos los locales.
  if p_local is null then
    perform pg_advisory_xact_lock(hashtextextended('pos_catalogo_fallas:', 0));
    update public.pos_catalogo_fallas f
       set resuelta_en = now(), resuelta_por = auth.uid()
     where f.resuelta_en is null and f.local is null;
    get diagnostics v_k = row_count;
    v_cerradas := v_cerradas + v_k;
  end if;

  -- Comprobación sobre lo reparado: códigos vendidos que siguen sin fila de catálogo (tiene que dar 0).
  select count(*)::integer into v_huerf
    from (select distinct t.local, btrim(l.codigo_producto) as codigo
            from public.pos_ndf_tickets t
            join public.pos_ndf_ticket_lines l on l.ticket_id = t.id
           where t.local = any (v_hechos)
             and nullif(btrim(l.codigo_producto), '') is not null
             and length(btrim(l.codigo_producto)) <= 40) x
   where not exists (select 1 from public.pos_productos p where p.local = x.local and p.codigo = x.codigo);

  return jsonb_build_object('productos_escritos', v_escritos, 'fallas_cerradas', v_cerradas, 'sin_catalogo', v_huerf,
                            'saltados', v_saltados);
end;
$function$;
revoke all on function public.pos_catalogo_reparar(text) from public, anon;
grant execute on function public.pos_catalogo_reparar(text) to authenticated;
comment on function public.pos_catalogo_reparar(text) is
  'Mig 205. Repara el catálogo del PoS con la regla de la 198 (pos_catalogo_absorber) sobre toda la historia del local y cierra sus fallas abiertas, con el candado de la ingesta (082) por local y una vez por minuto por local. Owner (null = todos, de a uno); manager solo sus locales. Devuelve {productos_escritos, fallas_cerradas, sin_catalogo, saltados: [{local, hace_s}]}.';
