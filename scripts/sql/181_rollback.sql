-- 181_rollback · vuelve al tope de «una visita con beneficio por día» (cuerpo de la 150 en club_socio_visita_base).
-- No hay datos nuevos de la 181 (solo una columna de config y dos funciones internas): se puede correr en cualquier momento.
-- En prod, además, en el MISMO momento, un PR que saca supabase/migrations/181_… de main (si queda, Branching la vuelve a
-- aplicar). Si la 181 ya está en el ledger de prod desde hace rato, la vuelta atrás es una migración NUEVA hacia adelante
-- con este cuerpo (regla 10: el .sql que está en el ledger no se saca).
begin;

create or replace function public.club_socio_visita_base(p_miembro uuid, p_pos jsonb, p_op uuid, p_location text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol   public.user_role := public.get_my_role();
  v_m     public.club_miembros%rowtype;
  v_r     public.club_miembro_roles%rowtype;
  v_cfg   public.club_config%rowtype;
  v_prev  public.club_visitas_socio%rowtype;
  v_pos   jsonb;
  v_clave text;
  v_hoy   date := (now() at time zone 'America/Costa_Rica')::date;
  v_promo public.club_promociones%rowtype;
  v_cort  jsonb := '[]'::jsonb;
  v_est   text;
  v_pct   numeric := 0;
  v_avis  jsonb := '[]'::jsonb;
  v_texto text;
  v_n     int;
  v_id    uuid;
  v_prem  public.club_premios%rowtype;
  v_extra jsonb;
  v_loc   text;
  v_tope  int;
  r       jsonb;
begin
  if v_rol is null or v_rol not in ('owner','manager','cajero') then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if p_op is null then raise exception 'Falta el id de la operación: cerrá la cuenta en pantalla y escaneá de nuevo' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended('club_op:' || p_op::text, 0));
  select * into v_prev from public.club_visitas_socio where client_op_id = p_op;
  if found then
    if v_prev.miembro_id <> p_miembro then
      raise exception 'Esta operación ya se usó para otro registro: cerrá la cuenta en pantalla y escaneá de nuevo' using errcode = 'P0001';
    end if;
    return v_prev.aplicar || jsonb_build_object('repetida', true);
  end if;

  select * into v_m from public.club_miembros where id = p_miembro;
  if not found then raise exception 'No se encontró al socio: escaneá su QR de nuevo' using errcode = 'P0001'; end if;
  v_loc := public.club_local(p_location, true);   -- Club compartido: el local de la CAJA, encendido (el del socio puede estar apagado)
  perform pg_advisory_xact_lock(hashtextextended('club_socio_visita:' || p_miembro::text, 0));
  select * into v_r from public.club_miembro_roles where miembro_id = p_miembro and rol = 'socio';
  if not found or v_m.estado <> 'activo' or v_r.estado = 'baja' then
    raise exception 'No es socio activo: seguí con la cuenta normal, sin beneficio' using errcode = 'P0001';
  end if;
  if v_r.estado = 'pendiente' then
    raise exception 'Socio pendiente: validalo primero (botón «Validar socio») y después registrá la visita' using errcode = 'P0001';
  end if;
  select * into v_cfg from public.club_config where location_id = v_loc;

  if p_pos is null or p_pos = '{}'::jsonb or jsonb_typeof(p_pos) = 'null' then
    raise exception 'Falta el pedido: elegí el pedido de la lista' using errcode = 'P0001';
  end if;
  v_pos := public.club_pos_ref(p_pos, v_loc);
  v_clave := coalesce(v_pos->>'visita', public.club_visita_canonica(v_loc, v_pos, null));

  -- (09-nov, B5) MISMO pedido, el mismo día: SIEMPRE la visita que ya está (misma cortesía, sin re-sorteo y sin otra
  -- visita), con cualquier tope. Antes solo pasaba al llegar al tope: con un tope de 2 o más, un segundo escaneo del
  -- mismo pedido registraba otra visita y volvía a sortear.
  select * into v_prev from public.club_visitas_socio
   where miembro_id = p_miembro and fecha = v_hoy and location_id = v_loc and visita_clave is not distinct from v_clave
   order by registrada_en desc limit 1;
  if v_prev.id is not null then
    return v_prev.aplicar || jsonb_build_object('repetida', true,
      'avisos', coalesce(v_prev.aplicar->'avisos', '[]'::jsonb) || to_jsonb('Ya registró su visita de hoy en este pedido: es la misma de antes (la cortesía no se vuelve a sortear).'::text));
  end if;
  -- Tope por día: cuentan SOLO las visitas CON beneficio (B5). Una visita sin beneficio (paga con créditos, va como
  -- invitado, sin promoción) no le gasta el día al socio.
  -- Grok 90: en OTRO pedido, con el tope cumplido → «ya_uso_hoy», NO aplicar beneficio (no se registra nada).
  select count(*) into v_n from public.club_visitas_socio
   where miembro_id = p_miembro and fecha = v_hoy and estado_beneficio in ('aplica','pendiente_configuracion');
  select g.socio_visitas_por_dia into v_tope from public.club_config_global g;   -- tope ÚNICO del Club (08-nov noche)
  v_tope := coalesce(v_tope, 1);
  if v_n >= v_tope then
    return jsonb_build_object('visita_id', null, 'socio', public.club_nombre_limpio(v_m.nombre), 'estado', 'ya_uso_hoy',
      'porcentaje', 0, 'cortesias', '[]'::jsonb, 'texto', 'Ya usó su beneficio hoy en otro pedido: NO aplicar beneficio',
      'avisos', jsonb_build_array(case when v_tope = 1 then 'Una visita con beneficio por día, en cualquier Satori.'
                                       else 'Hasta ' || v_tope || ' visitas con beneficio por día, en cualquier Satori.' end
                                  || ' Si viene con otro socio, puede ir como su invitado (857).'),
      'articulo_lc', v_cfg.lc_articulo_codigo, 'repetida', false, 'promo', null);
  end if;

  -- Regla fija: pagada con créditos → sin descuento ni cortesía.
  if v_clave is not null and exists (select 1 from public.club_movimientos mv where mv.tipo = 'canje' and mv.location_id = v_loc and mv.visita_clave = v_clave) then
    v_est := 'paga_con_creditos';
  -- Grok 91: ya hay `socios_por_factura` socio(s) con beneficio en esta factura → este va como invitado (857).
  elsif v_clave is not null and (select count(*) from public.club_visitas_socio x
                                   where x.location_id = v_loc and x.visita_clave = v_clave and x.miembro_id <> p_miembro
                                     and x.estado_beneficio in ('aplica','pendiente_configuracion')) >= v_cfg.socios_por_factura then
    v_est := 'como_invitado';
  else
    select p.* into v_promo from public.club_promociones_vigentes(v_loc, now(), array['socio']) p limit 1;
    if v_promo.id is null then
      v_est := 'sin_promocion';
    else
      v_est := 'aplica';
      v_pct := v_promo.porcentaje;
      if v_promo.cortesias > 0 and v_cfg.cortesias_por_visita > 0 then
        select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'codigo', c.codigo_producto, 'nombre', c.nombre, 'motivo', 'promo')), '[]'::jsonb)
          into v_cort
          from (select * from public.club_cortesias c where c.location_id = v_loc and c.activa
                 order by random() limit least(v_promo.cortesias, v_cfg.cortesias_por_visita)) c;
        if jsonb_array_length(v_cort) = 0 then
          v_est := 'pendiente_configuracion';
          v_avis := v_avis || to_jsonb('Cortesía: pendiente de configuración (no hay artículos de «CORTESÍA CLUB» activos). Aplicá solo el descuento.'::text);
        end if;
      end if;
    end if;
  end if;

  -- A4.3: premio por referir disponible → una cortesía extra sorteada (no en una visita pagada con créditos ni sin promo).
  if v_est in ('aplica','pendiente_configuracion') then
    select * into v_prem from public.club_premios p
     where p.beneficiario = p_miembro and p.estado = 'disponible' and p.vence_en > now()
     order by p.vence_en limit 1 for update;
    if v_prem.id is not null then
      select jsonb_build_object('id', c.id, 'codigo', c.codigo_producto, 'nombre', c.nombre, 'motivo', 'premio_referido') into v_extra
        from public.club_cortesias c
       where c.location_id = v_loc and c.activa
         and not exists (select 1 from jsonb_array_elements(v_cort) y where y->>'id' = c.id::text)
       order by random() limit 1;
      if v_extra is null then   -- todas ya salieron en el sorteo de la promo: puede repetirse el producto
        select jsonb_build_object('id', c.id, 'codigo', c.codigo_producto, 'nombre', c.nombre, 'motivo', 'premio_referido') into v_extra
          from public.club_cortesias c where c.location_id = v_loc and c.activa order by random() limit 1;
      end if;
      if v_extra is null then
        v_avis := v_avis || to_jsonb('Tiene un premio por referir guardado: pendiente de configuración (no hay cortesías activas). Queda para la próxima.'::text);
        v_prem.id := null;
      else
        v_cort := v_cort || v_extra;
        if v_est = 'pendiente_configuracion' then v_est := 'aplica'; end if;
      end if;
    end if;
  end if;

  -- Antiautocanje (al revés): si este socio ya usó un cupón propio en este pedido, se avisa (A5: CUPON_AUTOREFERIDO).
  if v_clave is not null and exists (select 1 from public.club_movimientos mv where mv.tipo = 'tarjeta' and mv.miembro_id = p_miembro and mv.location_id = v_loc and mv.visita_clave = v_clave) then
    v_avis := v_avis || to_jsonb('Este socio ya registró un cupón propio en este pedido: queda para revisión.'::text);
  end if;

  v_texto := case v_est
    when 'paga_con_creditos' then 'Paga con créditos: NO aplicar descuento ni cortesía'
    when 'como_invitado' then 'Ya hay un socio con beneficio en esta factura: este socio va como invitado (marcá el ' || v_cfg.lc_invitado_codigo || '). El % se aplica una sola vez.'
    when 'sin_promocion' then case when exists (select 1 from public.club_promociones p where p.location_id = v_loc and p.estado = 'borrador' and 'socio' = any(p.para))
                                   then 'Promoción del Local Club en borrador (pendiente de configuración): NO aplicar beneficio'
                                   else 'Sin promoción vigente para socios ahora: NO aplicar beneficio' end
    else concat_ws(' + ',
           case when v_pct > 0 then trim(to_char(v_pct, 'FM990.##'), '.') || ' % LC' end,
           (select string_agg(case when x->>'motivo' = 'premio_referido' then '1 cortesía de premio: ' else '1 cortesía: ' end || (x->>'nombre'), ' + ')
              from jsonb_array_elements(v_cort) x))
    end;
  if v_est in ('aplica','pendiente_configuracion') then
    v_avis := v_avis || to_jsonb(format('Acompañantes: el artículo %s (INVITADO) por cada uno.', v_cfg.lc_invitado_codigo));
    v_avis := v_avis || to_jsonb(format('Marcá el artículo %s (LOCAL CLUB) en la factura%s.', v_cfg.lc_articulo_codigo,
      case when jsonb_array_length(v_cort) > 0 then ' y la cortesía con su artículo de «CORTESÍA CLUB»' else '' end));
  end if;

  v_id := gen_random_uuid();
  r := jsonb_build_object('visita_id', v_id, 'socio', public.club_nombre_limpio(v_m.nombre), 'estado', v_est,
                          'porcentaje', v_pct, 'cortesias', v_cort, 'texto', coalesce(nullif(v_texto, ''), 'Sin beneficio'),
                          'avisos', v_avis, 'articulo_lc', v_cfg.lc_articulo_codigo, 'repetida', false,
                          'promo', case when v_promo.id is not null then v_promo.nombre end);
  insert into public.club_visitas_socio (id, location_id, miembro_id, fecha, registrado_por, client_op_id, pos_ref, visita_clave,
                                         promo_id, porcentaje, cortesias, estado_beneficio, aplicar)
  values (v_id, v_loc, p_miembro, v_hoy, auth.uid(), p_op, v_pos, v_clave, v_promo.id, v_pct, v_cort, v_est, r);
  insert into public.club_pase_eventos (miembro_id, motivo) values (p_miembro, 'cortesia');
  if v_prem.id is not null then
    update public.club_premios set estado = 'usado', usado_en = now(), visita_id = v_id where id = v_prem.id;
  end if;
  return r;
end;
$$;

revoke all on function public.club_socio_visita_base(uuid, jsonb, uuid, text) from public, anon, authenticated;
comment on function public.club_socio_visita_base(uuid, jsonb, uuid, text) is
  '168: la visita del socio de antes (150), sin la cortesía de los primeros 90 días. La llama club_socio_visita. Para '
  'cambiar la visita, se cambia ESTA (create or replace club_socio_visita_base), no club_socio_visita.';
drop function if exists public.club_socio_tope_comida(uuid, text, timestamptz);
drop function if exists public.club_comida(text, timestamptz);
alter table public.club_config_global drop column if exists socio_visitas_por_comida;
comment on column public.club_config_global.socio_visitas_por_dia is null;
delete from supabase_migrations.schema_migrations where version = '181';

commit;
