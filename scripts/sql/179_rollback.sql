-- Rollback de la 179 (origen club 124): «Reservar» del portal con el OpenTable del local del socio. Vuelve club_portal al
-- envoltorio de la 167 y club_cumple_config_guardar al de la 173 (byte a byte) y borra club_reserva_url_ok. No toca datos:
-- los links guardados quedan. club-web sin la 179 sigue andando (sin `socio.reserva_url` usa el rid por defecto).
-- Borra la fila 179 del ledger. Si se corre en prod, en el mismo momento sale el .sql de la 179 de main (si queda,
-- Branching la vuelve a aplicar; regla 10 / satori-migraciones-y-prod §6).
begin;

-- 3. club_portal: el de la 167
create or replace function public.club_portal(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_j  jsonb;
  v_id uuid;
  v_r  record;
begin
  v_j := public.club_portal_datos(p_token);   -- portón, formato del token y socio activo: igual que siempre
  select m.id into v_id from public.club_miembros m
   where m.token_portal = lower(btrim(coalesce(p_token, ''))) and m.estado = 'activo';
  select * into v_r from public.club_resena_socio_toca(v_id) limit 1;
  -- 167: la reseña de Google del local de la última visita, cada N visitas con beneficio (a todos, sin premio)
  return v_j || jsonb_build_object('resena', case when v_r.url is not null
                                                  then jsonb_build_object('url', v_r.url, 'local', v_r.local_nombre) end);
end;
$$;
comment on function public.club_portal(text) is
  '167: envoltorio de club_portal_datos + la clave `resena` ({url, local} o null). El portal se cambia en club_portal_datos.';
revoke all on function public.club_portal(text) from public, anon, authenticated;
grant execute on function public.club_portal(text) to anon, authenticated;

-- 2. club_cumple_config_guardar: el de la 173
create or replace function public.club_cumple_config_guardar(p_datos jsonb, p_location text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_antes public.club_cumple_config%rowtype;
  v_n     public.club_cumple_config%rowtype;
  v_k     public.club_cortesias%rowtype;
  v_url   text;
begin
  if public.get_my_role() is null or public.get_my_role() not in ('owner','manager') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  perform public.club_exigir_local(p_location);
  p_location := public.club_local(p_location, false);
  if jsonb_typeof(p_datos) is distinct from 'object'
     or jsonb_typeof(p_datos->'activo') is distinct from 'boolean' or jsonb_typeof(p_datos->'uno_por_mesa') is distinct from 'boolean'
     or jsonb_typeof(p_datos->'solo_reserva') is distinct from 'boolean'
     or jsonb_typeof(p_datos->'min_personas') is distinct from 'number' or jsonb_typeof(p_datos->'dias_antes') is distinct from 'number'
     or jsonb_typeof(p_datos->'dias_despues') is distinct from 'number' or jsonb_typeof(p_datos->'beneficio') is distinct from 'string'
     or (p_datos->>'min_personas') !~ '^[0-9]{1,2}$' or (p_datos->>'dias_antes') !~ '^[0-9]{1,2}$'
     or (p_datos->>'dias_despues') !~ '^[0-9]{1,2}$' then
    raise exception 'Datos incompletos: recargá la pantalla y volvé a guardar' using errcode = 'P0001';
  end if;
  v_antes := public.club_cumple_cfg(p_location);
  v_n := v_antes;
  v_n.activo := (p_datos->>'activo')::boolean;
  v_n.beneficio := btrim(p_datos->>'beneficio');
  v_n.min_personas := (p_datos->>'min_personas')::int;
  v_n.dias_antes := (p_datos->>'dias_antes')::int;
  v_n.dias_despues := (p_datos->>'dias_despues')::int;
  v_n.uno_por_mesa := (p_datos->>'uno_por_mesa')::boolean;
  v_n.solo_reserva := (p_datos->>'solo_reserva')::boolean;
  v_url := nullif(btrim(coalesce(p_datos->>'reserva_url', '')), '');
  v_n.reserva_url := v_url;
  v_n.cortesia_id := nullif(p_datos->>'cortesia_id', '')::uuid;
  if length(v_n.beneficio) not between 3 and 120 then
    raise exception 'El beneficio va de 3 a 120 letras (por ejemplo «postre de cortesía»)' using errcode = 'P0001';
  end if;
  if v_n.min_personas not between 1 and 50 then
    raise exception 'El mínimo de personas va de 1 a 50' using errcode = 'P0001';
  end if;
  if v_n.dias_antes not between 0 and 30 or v_n.dias_despues not between 0 and 30 then
    raise exception 'Los días antes y después van de 0 a 30' using errcode = 'P0001';
  end if;
  if v_url is not null and (v_url !~ '^https://[^\s<>"]{4,}$' or length(v_url) > 300) then
    raise exception 'El link de reserva tiene que empezar con https:// (copialo del navegador)' using errcode = 'P0001';
  end if;
  if v_n.solo_reserva and v_url is null then
    raise exception 'Con «solo con reserva» hace falta el link de reserva' using errcode = 'P0001';
  end if;
  if v_n.cortesia_id is not null then
    select * into v_k from public.club_cortesias k where k.id = v_n.cortesia_id and k.location_id = p_location;
    if not found then raise exception 'Esa cortesía no es de este local: recargá la lista' using errcode = 'P0001'; end if;
    if not v_k.activa then raise exception 'Esa cortesía está inactiva: activala primero' using errcode = 'P0001'; end if;
  end if;
  if v_n.activo and v_n.cortesia_id is null then
    raise exception 'Para encenderlo, elegí el artículo de cortesía que marca la caja' using errcode = 'P0001';
  end if;
  insert into public.club_cumple_config as k (location_id, activo, beneficio, min_personas, dias_antes, dias_despues,
                                              uno_por_mesa, solo_reserva, reserva_url, cortesia_id, actualizado_por, actualizado_en)
  values (p_location, v_n.activo, v_n.beneficio, v_n.min_personas, v_n.dias_antes, v_n.dias_despues,
          v_n.uno_por_mesa, v_n.solo_reserva, v_n.reserva_url, v_n.cortesia_id, auth.uid(), now())
  on conflict (location_id) do update set
    activo = excluded.activo, beneficio = excluded.beneficio, min_personas = excluded.min_personas,
    dias_antes = excluded.dias_antes, dias_despues = excluded.dias_despues, uno_por_mesa = excluded.uno_por_mesa,
    solo_reserva = excluded.solo_reserva, reserva_url = excluded.reserva_url, cortesia_id = excluded.cortesia_id,
    actualizado_por = excluded.actualizado_por, actualizado_en = excluded.actualizado_en;
  v_n := public.club_cumple_cfg(p_location);
  perform public.club_auditar('cumple_config', 'club_cumple_config', null,
    public.club_cumple_cfg_json(v_antes) - 'cortesia' - 'actualizado_en' || jsonb_build_object('cortesia_id', v_antes.cortesia_id),
    public.club_cumple_cfg_json(v_n) - 'cortesia' - 'actualizado_en' || jsonb_build_object('cortesia_id', v_n.cortesia_id));
  return public.club_cumple_cfg_json(v_n);
end;
$$;
revoke all on function public.club_cumple_config_guardar(jsonb, text) from public, anon, authenticated;
grant execute on function public.club_cumple_config_guardar(jsonb, text) to authenticated;

-- 1. la interna
drop function if exists public.club_reserva_url_ok(text);

delete from supabase_migrations.schema_migrations where version = '179';

commit;
