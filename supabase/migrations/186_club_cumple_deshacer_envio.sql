-- 186 (bloque de pase) · Cumpleaños: el OWNER puede deshacer la marca «enviado» de un saludo, con nota obligatoria.
--
-- Backlog del Club firmado por el dueño (16-nov), arreglo 1 de 4: hoy el botón «WhatsApp ↗» del Inicio (mig 173) marca
-- «enviado» al tocarlo y no hay vuelta atrás: si se tocó por error (o WhatsApp no se abrió), el socio desaparece de la
-- lista hasta el año siguiente.
--
-- Qué hace (SOLO funciones NUEVAS; no reemplaza ninguna existente, así que no lleva guarda de md5 — R13 no aplica):
--   1. club_cumple_enviados_lista(local, hoy) (interna, como club_cumple_lista de la 173): los socios del local cuyo
--      próximo cumpleaños cae en [hoy, hoy + días antes] y que YA tienen la marca de ese año. Es el complemento exacto
--      de la lista del Inicio. No mira si el beneficio está encendido (deshacer una marca no da nada a nadie).
--   2. club_cumple_enviados(local) (API): solo OWNER. Lo que ve en el Inicio bajo «Ya saludados».
--   3. club_cumple_deshacer_envio(miembro, nota, local) (API): solo OWNER. Nota obligatoria (3 a 500 caracteres, como
--      club_socio_confirmar). Borra la fila de club_cumple_envios del año del próximo cumpleaños, bajo el mismo candado
--      del socio que club_cumple_marcar (FOR UPDATE), y deja en club_auditoria la acción «cumple_deshacer_envio» con
--      la fila borrada (antes) y la nota (después). El socio vuelve a la lista y se le puede volver a mandar el saludo.
--      Manager, cajero, contador, sin sesión: 42501. Owner con un local que no existe o apagado: lo corta
--      club_exigir_local / club_local, igual que club_cumple_enviar.
--
-- Vuelta atrás: scripts/sql/186_rollback.sql (borra las tres funciones y la fila 186 del ledger; no toca datos: las
-- marcas borradas por un «deshacer» quedan en club_auditoria). Pruebas: scripts/sql/186_pruebas.sql (+ .py).
begin;

do $$
begin
  if to_regclass('public.club_cumple_envios') is null
     or to_regprocedure('public.club_cumple_proximo(integer,integer,date)') is null
     or to_regprocedure('public.club_cumple_cfg(text)') is null
     or to_regprocedure('public.club_exigir_local(text)') is null
     or to_regprocedure('public.club_auditar(text,text,uuid,jsonb,jsonb)') is null then
    raise exception '186: falta la 173 (club_cumple_envios / club_cumple_proximo / club_cumple_cfg) o la 170';
  end if;
  if to_regprocedure('public.club_cumple_deshacer_envio(uuid,text,text)') is not null
     or to_regprocedure('public.club_cumple_enviados(text)') is not null
     or to_regprocedure('public.club_cumple_enviados_lista(text,date)') is not null then
    raise exception '186: ya hay una función con ese nombre: se para sin tocar nada';
  end if;
end $$;

-- ── 1. Lista interna (sin permisos; p_hoy fijo en las pruebas) ─────────────────────────────────────────────────────
create function public.club_cumple_enviados_lista(p_location text, p_hoy date)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  with cfg as (select * from public.club_cumple_cfg(p_location)),
  s as (
    select m.id, m.nombre, f.cumple, (f.cumple - p_hoy) as faltan, e.enviado_en
      from public.club_miembros m
      join public.club_miembros_contacto c on c.miembro_id = m.id and c.cumple_dia is not null
      cross join cfg
      cross join lateral (select public.club_cumple_proximo(c.cumple_dia, c.cumple_mes, p_hoy) as cumple) f
      join public.club_cumple_envios e on e.miembro_id = m.id and e.anio = extract(year from f.cumple)::int
     where m.location_id = p_location
       and f.cumple <= p_hoy + cfg.dias_antes)
  select coalesce(jsonb_agg(jsonb_build_object('miembro_id', s.id, 'nombre', s.nombre, 'faltan', s.faltan,
                                               'enviado_en', s.enviado_en)
                            order by s.faltan, s.nombre, s.id), '[]'::jsonb)
    from s
$$;
revoke all on function public.club_cumple_enviados_lista(text, date) from public, anon, authenticated;
comment on function public.club_cumple_enviados_lista(text, date) is
  '186: socios del local con la marca «enviado» del año de su próximo cumpleaños, dentro de los días antes. Interna.';

-- ── 2. «Ya saludados» del Inicio (solo owner) ──────────────────────────────────────────────────────────────────────
create function public.club_cumple_enviados(p_location text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if public.get_my_role() is distinct from 'owner'::public.user_role then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  perform public.club_exigir_local(p_location);
  p_location := public.club_local(p_location, false);
  return public.club_cumple_enviados_lista(p_location, (now() at time zone 'America/Costa_Rica')::date);
end;
$$;
revoke all on function public.club_cumple_enviados(text) from public, anon, authenticated;
grant execute on function public.club_cumple_enviados(text) to authenticated;

-- ── 3. Deshacer la marca (solo owner, nota obligatoria, auditado) ──────────────────────────────────────────────────
create function public.club_cumple_deshacer_envio(p_miembro uuid, p_nota text, p_location text default null)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_hoy  date := (now() at time zone 'America/Costa_Rica')::date;
  v_m    public.club_miembros%rowtype;
  v_c    public.club_miembros_contacto%rowtype;
  v_anio int;
  v_e    public.club_cumple_envios%rowtype;
begin
  if public.get_my_role() is distinct from 'owner'::public.user_role then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if p_nota is null or length(btrim(p_nota)) < 3 or length(p_nota) > 500 then
    raise exception 'Escribí una nota (de 3 a 500 caracteres) con el motivo' using errcode = 'P0001';
  end if;
  perform public.club_exigir_local(p_location);
  p_location := public.club_local(p_location, false);
  -- mismo candado que club_cumple_marcar: un «deshacer» y un «WhatsApp» del mismo socio no se cruzan
  select * into v_m from public.club_miembros m where m.id = p_miembro and m.location_id = p_location for update;
  select * into v_c from public.club_miembros_contacto c where c.miembro_id = p_miembro;
  if v_m.id is null or v_c.cumple_dia is null then
    raise exception 'Ese saludo no está marcado como enviado: recargá el Inicio' using errcode = 'P0001';
  end if;
  v_anio := extract(year from public.club_cumple_proximo(v_c.cumple_dia, v_c.cumple_mes, v_hoy))::int;
  delete from public.club_cumple_envios e
   where e.miembro_id = p_miembro and e.anio = v_anio and e.location_id = p_location
  returning * into v_e;
  if v_e.miembro_id is null then
    raise exception 'Ese saludo no está marcado como enviado: recargá el Inicio' using errcode = 'P0001';
  end if;
  perform public.club_auditar('cumple_deshacer_envio', 'club_cumple_envios', p_miembro, to_jsonb(v_e),
                              jsonb_build_object('nota', btrim(p_nota), 'anio', v_anio, 'local', p_location));
  return true;
end;
$$;
revoke all on function public.club_cumple_deshacer_envio(uuid, text, text) from public, anon, authenticated;
grant execute on function public.club_cumple_deshacer_envio(uuid, text, text) to authenticated;
comment on function public.club_cumple_deshacer_envio(uuid, text, text) is
  '186: el owner deshace la marca «enviado» del saludo de cumpleaños del año del próximo cumpleaños. Nota obligatoria; queda en club_auditoria (cumple_deshacer_envio).';

-- ── Chequeo final ──────────────────────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if has_function_privilege('anon', 'public.club_cumple_deshacer_envio(uuid,text,text)', 'execute')
     or has_function_privilege('anon', 'public.club_cumple_enviados(text)', 'execute')
     or has_function_privilege('authenticated', 'public.club_cumple_enviados_lista(text,date)', 'execute')
     or not has_function_privilege('authenticated', 'public.club_cumple_deshacer_envio(uuid,text,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.club_cumple_enviados(text)', 'execute') then
    raise exception '186: los permisos no quedaron como se esperaba';
  end if;
end $$;

commit;
