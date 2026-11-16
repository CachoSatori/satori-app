-- Rollback de la 174 (origen club 120): la tarjeta física vuelve al plan B de «las últimas 2 h».
--  · club_tarjeta_manual__nucleo vuelve a su cuerpo de la 150 (el de la 172 antes de la 174: md5 5c0ae478…; create or
--    replace conserva los permisos: sin EXECUTE para la API). El envoltorio de la 172 no se toca.
--  · Borra club_facturas_buscar (envoltorio y núcleo) y las internas club_pos_ref_tarjeta, club_facturas_lista,
--    club_factura_usada, club_visita_con_tarjeta, club_facturas_desde y club_facturas_dias_busqueda.
--  · Borra la fila 174 del ledger.
-- No toca tablas ni datos: lo que se registró con la 174 (tarjetas con facturas de más de 2 h) queda.
-- ANTES: el revert del código de la app (la tarjeta física llama a club_facturas_buscar; sin la función, su plan B falla).
-- Si se corre en prod, en el mismo momento sale el .sql de main en un PR (regla 10 / satori-migraciones-y-prod §6).
-- ORDEN: antes de revertir la 172, la 173 o la 170.
begin;

drop function if exists public.club_facturas_buscar(text, text);
drop function if exists public.club_facturas_buscar__nucleo(text, text);

create or replace function public.club_tarjeta_manual__nucleo(p_miembro uuid, p_personas int, p_factura text, p_op uuid, p_pos jsonb default null)
returns table (personas int, creditos numeric)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol   public.user_role := public.get_my_role();
  v_fac   text := public.club_norm_factura(p_factura);
  v_pos   jsonb;
  v_loc   text;
  v_sin_pos boolean := p_pos is null or p_pos = '{}'::jsonb or jsonb_typeof(p_pos) = 'null';
  v_m     public.club_miembros%rowtype;
  v_cfg   public.club_config%rowtype;
  v_prev  public.club_movimientos%rowtype;
  v_saldo int;
begin
  if v_rol is null or v_rol not in ('owner','manager','cajero') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if p_op is null then
    raise exception 'Falta el id de la operación: cerrá la cuenta en pantalla y escaneá de nuevo' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('club_op:' || p_op::text, 0));   -- CLUB-AUD-08
  select * into v_prev from public.club_movimientos where client_op_id = p_op;
  if found then
    -- Grok 159 (10-nov): el replay exige también las mismas personas (si no, la caja creería que registró otra cantidad)
    if v_prev.tipo <> 'tarjeta' or v_prev.miembro_id is distinct from p_miembro or v_prev.cupon_id is not null
       or v_prev.personas is distinct from p_personas then
      raise exception 'Esta operación ya se usó para otro registro: cerrá la cuenta en pantalla y escaneá de nuevo' using errcode = 'P0001';
    end if;
    select * into v_cfg from public.club_config where location_id = v_prev.location_id;
    v_saldo := public.club_saldo_personas(p_miembro);
    personas := v_saldo; creditos := public.club_creditos(v_saldo, v_cfg.personas_por_credito);
    return next; return;
  end if;

  if p_personas is null or p_personas < 1 or p_personas > 30 then
    raise exception 'Personas fuera de rango (1 a 30): corregí el número' using errcode = 'P0001';
  end if;
  if v_sin_pos and (v_fac = '' or length(v_fac) > 40) then
    raise exception 'Falta el pedido o la factura: elegí el pedido de la lista' using errcode = 'P0001';
  end if;
  -- CLUB-AUD-26: apagada (prod) → nadie; prendida (staging, piloto en paralelo) → tope diario por miembro.
  select c.* into v_cfg from public.club_config c
   where c.location_id = (select m.location_id from public.club_miembros m where m.id = p_miembro);
  if not coalesce(v_cfg.tarjeta_manual_activa, false) then
    raise exception 'La tarjeta física está desactivada en este local: registrá la visita con el cupón del turista' using errcode = 'P0001';
  end if;

  -- CLUB-AUD-18: el local es el del miembro. CLUB-AUD-02: control de la visita ANTES del lock del
  -- miembro (orden visita → miembro).
  v_loc := (select m.location_id from public.club_miembros m where m.id = p_miembro);
  if v_loc is null then raise exception 'No se encontró al miembro: escaneá su QR o buscalo de nuevo' using errcode = 'P0001'; end if;
  perform public.club_local(v_loc, true);   -- LC-ML: Club activo en el local del miembro
  v_pos := public.club_pos_ref(p_pos, v_loc);
  perform public.club_visita_control(v_loc, coalesce(v_pos->>'visita', public.club_visita_canonica(v_loc, null, v_fac)),
                                     v_pos, v_fac, p_miembro, p_personas);
  select * into v_m from public.club_miembros m where m.id = p_miembro for update;
  if not found or v_m.tipo not in ('referente','concierge_pm','equipo') then
    raise exception 'No se encontró la cuenta del referente: escaneá de nuevo o buscalo por nombre' using errcode = 'P0001';
  end if;
  if v_m.estado <> 'activo' then
    raise exception 'REFERENTE_INACTIVO' using errcode = 'P0001',
      hint = 'Referente dado de baja: seguí con la cuenta sin crédito';
  end if;
  select * into v_cfg from public.club_config where location_id = v_m.location_id;
  if (select coalesce(sum(mv.personas), 0) from public.club_movimientos mv
       where mv.miembro_id = p_miembro and mv.tipo = 'tarjeta' and mv.cupon_id is null and mv.origen = 'app'
         and mv.fecha_visita >= date_trunc('day', now() at time zone 'America/Costa_Rica') at time zone 'America/Costa_Rica')
     + p_personas > v_cfg.tarjeta_manual_tope_dia then
    raise exception 'Supera el tope diario de tarjeta física (% personas por miembro): cargá el resto mañana o avisale al manager', v_cfg.tarjeta_manual_tope_dia
      using errcode = 'P0001';
  end if;

  insert into public.club_movimientos
    (location_id, miembro_id, tipo, personas, personas_por_credito, valor_credito_crc,
     factura_pos, fecha_visita, registrado_por, origen, client_op_id, nota, pos_ref, visita_clave)
  values
    (v_m.location_id, p_miembro, 'tarjeta', p_personas, v_cfg.personas_por_credito, v_cfg.valor_credito_crc,
     nullif(v_fac, ''), now(), auth.uid(), 'app', p_op, 'manual', v_pos,
     coalesce(v_pos->>'visita', public.club_visita_canonica(v_loc, null, v_fac)));

  v_saldo := public.club_saldo_personas(p_miembro);
  personas := v_saldo; creditos := public.club_creditos(v_saldo, v_cfg.personas_por_credito);
  return next;
end;
$$;
revoke all on function public.club_tarjeta_manual__nucleo(uuid, int, text, uuid, jsonb) from public, anon, authenticated;

drop function if exists public.club_pos_ref_tarjeta(jsonb, text);
drop function if exists public.club_facturas_lista(text, text, timestamptz);
drop function if exists public.club_factura_usada(text, text);
drop function if exists public.club_visita_con_tarjeta(text, text);
drop function if exists public.club_facturas_desde(timestamptz, int);
drop function if exists public.club_facturas_dias_busqueda();

delete from supabase_migrations.schema_migrations where version = '174';

commit;
