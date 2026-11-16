-- Rollback de la 182 (origen club 127): «Reservar una mesa» para todo anfitrión. Vuelve club_portal a la de la 180
-- byte a byte (cuerpo, comentario y permisos): el anfitrión deja de recibir `reserva_url` arriba; el socio sigue con
-- `socio.reserva_url`. Nada de datos que devolver (la 182 no tiene tablas ni columnas). club-web sin la 182 sigue andando:
-- `urlReservaAnfitrion` cae a `socio.reserva_url` y, sin él, no muestra la tarjeta.
-- Borra la fila 182 del ledger. Si se corre en prod, en el mismo momento sale el .sql de la 182 de main (si queda,
-- Branching la vuelve a aplicar; regla 10 / satori-migraciones-y-prod §6).
begin;

-- club_portal: la de la 180
create or replace function public.club_portal(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_j   jsonb;
  v_id  uuid;
  v_loc text;
  v_r   record;
begin
  v_j := public.club_portal_datos(p_token);   -- portón, formato del token y socio activo: igual que siempre
  select m.id, m.location_id into v_id, v_loc from public.club_miembros m
   where m.token_portal = lower(btrim(coalesce(p_token, ''))) and m.estado = 'activo';
  select * into v_r from public.club_resena_socio_toca(v_id) limit 1;
  -- 167: la reseña de Google del local de la última visita, cada N visitas con beneficio (a todos, sin premio)
  v_j := v_j || jsonb_build_object('resena', case when v_r.url is not null
                                                  then jsonb_build_object('url', v_r.url, 'local', v_r.local_nombre) end);
  -- 179/180: «Reservar» de «Mi Club» → el OpenTable del local del socio (Club → Locales), tal cual; sin link → null
  if jsonb_typeof(v_j->'socio') = 'object' then
    v_j := jsonb_set(v_j, '{socio,reserva_url}',
                     coalesce(to_jsonb((select g.reserva_url from public.club_config g
                                         where g.location_id = v_loc and public.club_reserva_url_ok(g.reserva_url))), 'null'::jsonb));
  end if;
  return v_j;
end;
$$;
comment on function public.club_portal(text) is
  '167 + 179 + 180: envoltorio de club_portal_datos + la clave `resena` ({url, local} o null) + `socio.reserva_url` (el '
  'OpenTable del local del socio, de club_config.reserva_url, tal cual, o null). El resto del portal se cambia en club_portal_datos.';
revoke all on function public.club_portal(text) from public, anon, authenticated;
grant execute on function public.club_portal(text) to anon, authenticated;

delete from supabase_migrations.schema_migrations where version = '182';

commit;
