-- Rollback de la 159 (origen 101): aviso v1.2 + D6 A (mayor de 18 y cumpleaños). Hacerlo JUNTO con volver club-web
-- y la app a la versión anterior (git revert del merge): si no, club-web manda v1.2 y la app llama a club_socio_alta_caja_v2,
-- que ya no existe. Orden inverso al de la migración. La fila 'v1.2' de club_avisos_privacidad NO se borra (la tabla es
-- inmutable por trigger) y no molesta.
-- Datos: los cumpleaños se BORRAN (se quitan las columnas: sin la guardia no hay que guardarlos). La columna
-- mayor_edad_en se CONSERVA (es la constancia del consentimiento de quienes se anotaron con la 159); nadie la lee.
-- Con actividad real (socios que ya dieron su cumpleaños) pensarlo dos veces: ver satori-migraciones-y-prod §6.

-- 8. alta en caja: vuelve el EXECUTE a la de 5 argumentos y se va la v2
grant execute on function public.club_socio_alta_caja(text, text, text, boolean, text) to authenticated;
drop function if exists public.club_socio_alta_caja_v2(text, text, text, boolean, boolean, text);

-- 7. autoalta: la versión EXACTA de la 150
create or replace function public.club_socio_autoalta(p_datos jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_loc  text;
  v_cfg  public.club_config%rowtype;
  v_nom  text := btrim(coalesce(p_datos->>'nombre', ''));
  v_tel  text;
  v_ref  uuid;
  v_id   uuid;
  v_tok  text;
  v_hoy  int;
begin
  if not public.club_web_ok() then
    raise exception 'Datos no válidos' using errcode = 'P0001';
  end if;
  -- LC-ML: el local lo manda club-web (`local`); sin él, el único local con el Club activo
  v_loc := public.club_local(nullif(btrim(coalesce(p_datos->>'local', '')), ''), true);
  select * into v_cfg from public.club_config where location_id = v_loc;
  if jsonb_typeof(p_datos) <> 'object' or length(v_nom) not between 2 and 80
     or coalesce(p_datos->>'acepto', '') <> v_cfg.aviso_privacidad_version then
    raise exception 'Datos no válidos' using errcode = 'P0001';
  end if;
  begin v_tel := public.club_norm_telefono(p_datos->>'whatsapp'); exception when others then v_tel := null; end;
  if v_tel is null then raise exception 'Datos no válidos' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended('club_socio_autoalta:' || v_loc, 0));
  v_hoy := (select count(*) from public.club_miembro_roles r join public.club_miembros m on m.id = r.miembro_id
             where m.location_id = v_loc and r.rol = 'socio' and r.alta_por = 'autoalta'
               and r.desde >= date_trunc('day', now() at time zone 'America/Costa_Rica') at time zone 'America/Costa_Rica')
         + (select count(*) from public.club_socio_solicitudes q where q.location_id = v_loc
             and q.creada_en >= date_trunc('day', now() at time zone 'America/Costa_Rica') at time zone 'America/Costa_Rica');
  if v_hoy >= v_cfg.socio_autoalta_max_dia then
    raise exception 'Demasiadas altas hoy' using errcode = 'P0001';
  end if;
  -- CLAUDE-HALL-04: al llegar al 80 % del cupo diario, una alerta (una por día) para gerencia.
  if v_hoy + 1 >= ceil(v_cfg.socio_autoalta_max_dia * 0.8)
     and not exists (select 1 from public.club_alertas a where a.location_id = v_loc and a.tipo = 'autoalta_cupo'
                      and a.creado_en >= date_trunc('day', now() at time zone 'America/Costa_Rica') at time zone 'America/Costa_Rica') then
    insert into public.club_alertas (location_id, tipo, detalle)
    values (v_loc, 'autoalta_cupo', jsonb_build_object('altas_hoy', v_hoy + 1, 'cupo', v_cfg.socio_autoalta_max_dia));
  end if;
  select m.id into v_ref from public.club_miembros m
   where m.codigo = upper(btrim(coalesce(p_datos->>'ref', ''))) and m.estado = 'activo'
     and exists (select 1 from public.club_miembro_roles r where r.miembro_id = m.id and r.rol = 'socio' and r.estado = 'activo');
  perform pg_advisory_xact_lock(hashtextextended('club_socio_tel:' || v_tel, 0));
  -- CLAUDE-HALL-02: si el teléfono ya existe, la autoalta NO toca nada (ni roles, ni estado, ni baja, ni aviso):
  -- deja una solicitud que la caja valida en persona y responde lo mismo que siempre.
  v_id := public.club_miembro_por_telefono(v_tel);
  if v_id is not null then
    insert into public.club_socio_solicitudes (location_id, miembro_id, aviso_version, referido_por)
    values (v_loc, v_id, v_cfg.aviso_privacidad_version, nullif(v_ref, v_id))
    on conflict (miembro_id) where atendida_en is null do nothing;
    return jsonb_build_object('ok', true);
  end if;
  v_id := public.club_socio_crear(v_nom, v_tel, null, 'pendiente', 'autoalta', v_ref, v_cfg.aviso_privacidad_version, v_loc);
  select token_portal into v_tok from public.club_miembros where id = v_id;
  return jsonb_build_object('ok', true, 'portal', public.club_url() || '/p/' || v_tok);
end;
$$;
revoke all on function public.club_socio_autoalta(jsonb) from public, anon, authenticated;
grant execute on function public.club_socio_autoalta(jsonb) to anon, authenticated;

-- 6 y 5. triggers y funciones del cumpleaños
drop trigger if exists club_roles_baja_borra_cumple_trg on public.club_miembro_roles;
drop function if exists public.club_roles_baja_borra_cumple();
drop function if exists public.club_socio_cumple_corregir(uuid, int, int, text);
drop trigger if exists club_contacto_cumple_auditar_trg on public.club_miembros_contacto;
drop function if exists public.club_contacto_cumple_auditar();
drop trigger if exists club_contacto_cumple_guardia_trg on public.club_miembros_contacto;
drop function if exists public.club_contacto_cumple_guardia();

-- 4. trigger de edad
drop trigger if exists club_roles_mayor_edad_trg on public.club_miembro_roles;
drop function if exists public.club_roles_mayor_edad_chk();

-- 3. columnas del cumpleaños (se borran los datos); 2. mayor_edad_en se conserva (ver arriba)
alter table public.club_miembros_contacto drop constraint if exists club_contacto_cumple_valido;
alter table public.club_miembros_contacto drop column if exists cumple_permiso_en;
alter table public.club_miembros_contacto drop column if exists cumple_mes;
alter table public.club_miembros_contacto drop column if exists cumple_dia;

-- 1. aviso: vuelve a pedir v1.1
alter table public.club_config alter column aviso_privacidad_version set default 'v1.1';
update public.club_config set aviso_privacidad_version = 'v1.1' where aviso_privacidad_version = 'v1.2';
