-- PROPUESTA de caja para la sesión del Club — opción a del catálogo único (decisión del dueño, 08-nov).
-- NO es una migración de caja y NO se aplica desde esta rama: la 075 y club_local_crear son del Club. Si la sesión del
-- Club está de acuerdo, la copia a una migración de su bloque (100+), que va DESPUÉS de la 075. Sirve en cualquier orden
-- respecto de la 091: los dos crean `locations` con la misma definición (`create table if not exists`).
-- Prueba: scripts/sql/091_pruebas.sh, sección «opción a» (staging, transacción descartada).
--
-- Qué hace:
--   1. Asegura el catálogo `locations` (misma definición que la 091 y la 022) con santa-teresa.
--   2. Copia al catálogo cada local que hoy está solo en club_config (inactivo para caja).
--   3. FK club_config.location_id → locations(id).
--   4. club_local_crear: crea primero el local en `locations` (o lo reutiliza) y después su club_config. Es la función de
--      la 075 (rama del Club @ da3bc9a) con UNA inserción agregada; misma firma, así que los grants no cambian.
begin;

create table if not exists public.locations (
  id          text primary key,
  name        text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
insert into public.locations (id, name) values ('santa-teresa', 'Satori Santa Teresa') on conflict (id) do nothing;

insert into public.locations (id, name, is_active)
select c.location_id, coalesce(nullif(btrim(to_jsonb(c) ->> 'nombre'), ''), c.location_id), false
  from public.club_config c
on conflict (id) do nothing;

alter table public.club_config drop constraint if exists club_config_location_fk;
alter table public.club_config add constraint club_config_location_fk
  foreign key (location_id) references public.locations(id);

create or replace function public.club_local_crear(p_id text, p_nombre text, p_direccion text default null,
                                                   p_mapa text default null, p_copiar_de text default null)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol public.user_role := public.get_my_role();
  v_id  text := lower(btrim(coalesce(p_id, '')));
  v_nom text := nullif(regexp_replace(btrim(coalesce(p_nombre, '')), '\s+', ' ', 'g'), '');
  v_dir text := nullif(btrim(coalesce(p_direccion, '')), '');
  v_map text := nullif(btrim(coalesce(p_mapa, '')), '');
  v_base public.club_config%rowtype;
  v_nuevo public.club_config%rowtype;
begin
  if v_rol is null or v_rol <> 'owner' then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if v_id !~ '^[a-z0-9-]{2,40}$' then
    raise exception 'El id del local va en minúsculas, números y guiones (2 a 40), por ejemplo «playa-nueva»' using errcode = 'P0001';
  end if;
  if v_nom is null or length(v_nom) > 60 then raise exception 'Falta el nombre del local (hasta 60 caracteres)' using errcode = 'P0001'; end if;
  if v_map is not null and v_map !~ '^https://' then raise exception 'El enlace del mapa tiene que empezar con https://' using errcode = 'P0001'; end if;
  if exists (select 1 from public.club_config where location_id = v_id) then
    raise exception 'Ya existe un local con ese id' using errcode = 'P0001';
  end if;
  -- (opción a) El catálogo único es public.locations: el local se crea primero ahí. Si ya existe (por ejemplo, un
  -- local de caja sin Club), se reutiliza. Un local nuevo entra INACTIVO para caja: lo activa el owner.
  insert into public.locations (id, name, is_active) values (v_id, v_nom, false) on conflict (id) do nothing;
  if p_copiar_de is not null then
    select * into v_base from public.club_config where location_id = p_copiar_de;
    if not found then raise exception 'No existe el local a copiar' using errcode = 'P0001'; end if;
    v_nuevo := jsonb_populate_record(v_base, jsonb_build_object('location_id', v_id, 'nombre', v_nom, 'direccion', v_dir,
                 'mapa_url', v_map, 'club_activo', false, 'lc_excepciones_desde', null, 'created_at', now(), 'updated_at', now()));
    insert into public.club_config select v_nuevo.*;
  else
    insert into public.club_config (location_id, nombre, direccion, mapa_url, club_activo)
    values (v_id, v_nom, v_dir, v_map, false);
  end if;
  perform public.club_auditar('local_alta', 'club_config', null, null,
                              (select to_jsonb(c) from public.club_config c where c.location_id = v_id));
  return v_id;
end;
$$;

commit;
