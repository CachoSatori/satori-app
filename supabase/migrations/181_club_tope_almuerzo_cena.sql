-- 181 · club_tope_almuerzo_cena (origen club 126; regla 3: prod va por la 180)
-- Decisión firmada por el dueño (16-nov 13:36 CR, opción B): el tope del socio del Local Club pasa de «una visita con
-- beneficio por día» a «UNA en el ALMUERZO y UNA en la CENA por día», en cualquier Satori. No son 2 libres: no puede
-- usarlo dos veces en la misma comida. El resto de las reglas, igual (invitados en la misma mesa sin límite, 857 si ya hay
-- un socio con beneficio en la factura, paga con créditos = sin beneficio, mismo pedido = misma visita, sin re-sorteo).
--
-- El corte almuerzo/cena: el que el sistema YA tiene, club_config.turno_corte (time, por local, hora de Costa Rica;
-- default 16:00 y así está en los dos locales de prod y staging el 16-nov). Es el mismo corte «mañana/tarde» que usan las
-- excepciones del Club (150/155) y el del PoS en la app (HORA_CORTE_TURNO = 16 en src/shared/ndf/mapTicket.ts). Lo
-- cambia el owner por local (política club_config_update, queda en club_config_historial). Almuerzo = hora CR < corte;
-- cena = desde el corte (16:00:00 en punto ya es cena). El día sigue siendo el día calendario CR (cambia a medianoche).
--
-- Qué cambia:
--   1. club_config_global.socio_visitas_por_comida (1, entre 1 y 3): visitas con beneficio por comida, ÚNICO del Club.
--      club_config_global.socio_visitas_por_dia queda SIN USO (no se borra: la vuelta atrás la necesita).
--   2. club_comida(local, momento) (interna): 'almuerzo' | 'cena' con el corte de ESE local, en hora CR.
--   3. club_socio_tope_comida(socio, local, momento) (interna): cuenta las visitas con beneficio del mismo día CR y la
--      misma comida, en TODOS los locales (cada visita con el corte de su propio local), y arma el texto para la caja.
--   4. club_socio_visita_base (la de la 150, que envuelven la 168 y la 170): solo cambia el bloque del tope. Con el tope
--      cumplido sigue devolviendo estado «ya_uso_hoy» (la app no cambia de contrato) con un texto que dice qué comida y
--      cuándo lo vuelve a tener, y dos campos nuevos: comida y vuelve.
--   5. Alertas antiabuso con la MISMA sensibilidad (firma del dueño 16-nov 14:51, opción A), contando DÍAS con visita:
--      club_excepciones__nucleo (cuerpo de la 155, envuelto por la 170): SOCIO_USO_ANOMALO «dos mesas el mismo día» pasa
--      a «dos mesas en la MISMA COMIDA» (ref socio-comida:<socio>:<día>:<comida>; en prod no hay ninguna resuelta) y el
--      máximo semanal (club_config.socio_visitas_semana_max) cuenta DÍAS con visita, no visitas.
--   6. club_alertas_inicio (164): MISMO_USUARIO, para socios, cuenta DÍAS (CR) con visita registrada por el mismo usuario
--      (mismo umbral alerta_mismo_usuario_max / _dias). Las tarjetas del equipo, igual que antes (veces).
-- Qué NO cambia: envoltorios de la 168 y la 170, invitados/857, créditos, el resto de las excepciones y alertas, umbrales,
-- sagrados, cierres.
-- Vuelta atrás: scripts/sql/181_rollback.sql (sin datos nuevos: se puede correr en cualquier momento).
begin;

-- 1. Tope por comida (único del Club)
alter table public.club_config_global add column if not exists socio_visitas_por_comida int not null default 1
  check (socio_visitas_por_comida between 1 and 3);
grant update (socio_visitas_por_comida) on public.club_config_global to authenticated;   -- solo owner (policy club_config_global_owner)
comment on column public.club_config_global.socio_visitas_por_comida is
  '181: visitas con beneficio del socio por comida (almuerzo / cena, corte club_config.turno_corte del local), en cualquier Satori.';
comment on column public.club_config_global.socio_visitas_por_dia is
  'SIN USO desde la 181 (el tope es por comida: socio_visitas_por_comida). Se deja para la vuelta atrás.';

-- 2. ¿Almuerzo o cena? Con el corte del local, en hora de Costa Rica.
create or replace function public.club_comida(p_location text, p_ts timestamptz)
returns text
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select case when (p_ts at time zone 'America/Costa_Rica')::time
                   < coalesce((select c.turno_corte from public.club_config c where c.location_id = p_location), time '16:00')
              then 'almuerzo' else 'cena' end
$$;
revoke all on function public.club_comida(text, timestamptz) from public, anon, authenticated;
comment on function public.club_comida(text, timestamptz) is
  '181 (interna): almuerzo antes de club_config.turno_corte del local (hora CR), cena desde el corte. Sin local configurado, 16:00.';

-- 3. El tope del socio en ESTA comida (interna; la llama club_socio_visita_base con now(); las pruebas, con un momento fijo)
create or replace function public.club_socio_tope_comida(p_miembro uuid, p_location text, p_ahora timestamptz)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_dia    date := (p_ahora at time zone 'America/Costa_Rica')::date;
  v_comida text := public.club_comida(p_location, p_ahora);
  v_corte  text := to_char(coalesce((select c.turno_corte from public.club_config c where c.location_id = p_location), time '16:00'), 'HH24:MI');
  v_tope   int;
  v_n      int;
  v_vuelve text;
  v_regla  text;
begin
  select g.socio_visitas_por_comida into v_tope from public.club_config_global g;   -- tope ÚNICO del Club
  v_tope := coalesce(v_tope, 1);
  -- en TODOS los locales; cada visita, con el corte de SU local
  select count(*) into v_n from public.club_visitas_socio v
   where v.miembro_id = p_miembro and v.fecha = v_dia and v.estado_beneficio in ('aplica','pendiente_configuracion')
     and public.club_comida(v.location_id, v.registrada_en) = v_comida;
  v_vuelve := case v_comida when 'almuerzo' then 'Vuelve a tenerlo en la cena, desde las ' || v_corte || '.'
                            else 'Vuelve a tenerlo mañana en el almuerzo.' end;
  v_regla := case when v_tope = 1 then 'Una visita con beneficio en el almuerzo y una en la cena, en cualquier Satori.'
                  else 'Hasta ' || v_tope || ' visitas con beneficio en el almuerzo y ' || v_tope || ' en la cena, en cualquier Satori.' end;
  return jsonb_build_object(
    'libre', v_n < v_tope, 'comida', v_comida, 'usadas', v_n, 'tope', v_tope, 'corte', v_corte, 'vuelve', v_vuelve,
    'texto', case v_comida when 'almuerzo' then 'Ya usó su beneficio del almuerzo hoy: NO aplicar beneficio'
                           else 'Ya usó su beneficio de la cena hoy: NO aplicar beneficio' end,
    'avisos', jsonb_build_array(v_vuelve, v_regla || ' Si viene con otro socio, puede ir como su invitado (857).'));
end;
$$;
revoke all on function public.club_socio_tope_comida(uuid, text, timestamptz) from public, anon, authenticated;
comment on function public.club_socio_tope_comida(uuid, text, timestamptz) is
  '181 (interna): visitas con beneficio del socio en el mismo día CR y la misma comida (todos los locales) contra '
  'club_config_global.socio_visitas_por_comida, con el texto para la caja.';

-- 4. La visita del socio (cuerpo de la 150; solo cambia el bloque del tope). Envuelta por la 168 y la 170, sin cambios.
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
  v_tc    jsonb;   -- 181: tope por comida
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
  -- 181 (firma del dueño 16-nov 13:36, opción B): el tope es por COMIDA, no por día. Cuentan SOLO las visitas CON
  -- beneficio (B5) del mismo día CR y de la misma comida (almuerzo antes de club_config.turno_corte del local de cada
  -- visita, cena desde el corte), en cualquier Satori. Con el tope cumplido → «ya_uso_hoy», NO aplicar beneficio (no se
  -- registra nada), y la caja lee qué comida ya usó y cuándo lo vuelve a tener.
  v_tc := public.club_socio_tope_comida(p_miembro, v_loc, now());
  if not coalesce((v_tc->>'libre')::boolean, false) then
    return jsonb_build_object('visita_id', null, 'socio', public.club_nombre_limpio(v_m.nombre), 'estado', 'ya_uso_hoy',
      'porcentaje', 0, 'cortesias', '[]'::jsonb, 'texto', v_tc->>'texto', 'avisos', v_tc->'avisos',
      'articulo_lc', v_cfg.lc_articulo_codigo, 'repetida', false, 'promo', null,
      'comida', v_tc->>'comida', 'vuelve', v_tc->>'vuelve');
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
  'cambiar la visita, se cambia ESTA (create or replace club_socio_visita_base), no club_socio_visita. '
  '181: tope por comida (almuerzo / cena) con club_socio_tope_comida.';

-- 5. Excepciones: SOCIO_USO_ANOMALO por comida y semana por días. Se cambia el NÚCLEO (después de la 170 el envoltorio
--    no se toca). En vez de copiar el cuerpo entero de la 155, se toma la definición viva, se exige que sea la de la 155
--    (md5 de prod y staging el 16-nov), se reemplazan SOLO los 5 fragmentos de abajo (cada uno tiene que estar una sola
--    vez) y se exige el md5 final. Así el diff es exactamente lo que se ve acá (y el PASE lo muestra).
do $$
declare
  v_fn  constant regprocedure := 'public.club_excepciones__nucleo(date,date,text,text)'::regprocedure;
  v_def text := pg_get_functiondef('public.club_excepciones__nucleo(date,date,text,text)'::regprocedure);
  r     record;
begin
  if md5(v_def) <> '5ad4ff8cf91646c6406fc3ebc24b498e' then
    raise exception '181: club_excepciones__nucleo no es la esperada (la de la 155, md5 de prod 16-nov) (md5 %): se para sin tocar nada', md5(v_def);
  end if;
  for r in select * from (values
    (1, $v1$    -- SOCIO_USO_ANOMALO: dos mesas el mismo día. CLUB COMPARTIDO (08-nov): cuenta las visitas del socio en TODOS los
    -- locales (vsa) y sale en cada local donde tuvo una de esas visitas; dice en qué locales.
    select 'SOCIO_USO_ANOMALO', 'socio-dia:' || v.miembro_id || ':' || v.fecha, min(v.registrada_en), null, 'probable',
           jsonb_build_object('miembro', public.club_nombre_limpio(min(mi.nombre)), 'motivo', 'dos mesas el mismo día',
$v1$, $n1$    -- SOCIO_USO_ANOMALO: dos mesas en la MISMA COMIDA (181, firma del dueño 16-nov 14:51, opción A: con el tope por
    -- comida, almuerzo + cena es normal; almuerzo y cena con el corte turno_corte del local de CADA visita, hora CR).
    -- CLUB COMPARTIDO (08-nov): cuenta las visitas del socio en TODOS los locales (vsa) y sale en cada local donde tuvo
    -- una de esas visitas; dice en qué locales.
    select 'SOCIO_USO_ANOMALO', 'socio-comida:' || v.miembro_id || ':' || v.fecha || ':' || public.club_comida(v.location_id, v.registrada_en),
           min(v.registrada_en), null, 'probable',
           jsonb_build_object('miembro', public.club_nombre_limpio(min(mi.nombre)), 'motivo', 'dos mesas en la misma comida',
                              'comida', public.club_comida(v.location_id, v.registrada_en),
$n1$),
    (2, $v2$     group by v.miembro_id, v.fecha
    having count(distinct v.location_id$v2$, $n2$     group by v.miembro_id, v.fecha, public.club_comida(v.location_id, v.registrada_en)
    having count(distinct v.location_id$n2$),
    (3, $v3$    -- SOCIO_USO_ANOMALO: más de N visitas en la semana (en todos los locales)
$v3$, $n3$    -- SOCIO_USO_ANOMALO: más de N DÍAS con visita en la semana (en todos los locales; 181: días, no visitas, para que
    -- almuerzo + cena el mismo día no cuente doble y el umbral siga con la misma sensibilidad)
$n3$),
    (4, $v4$'motivo', 'muchas visitas en la semana',
                              'visitas', count(*), 'maximo'$v4$, $n4$'motivo', 'muchos días con visita en la semana',
                              'visitas', count(*), 'dias', count(distinct v.fecha), 'maximo'$n4$),
    (5, $v5$    having count(*) > v_cfg.socio_visitas_semana_max and bool_or$v5$, $n5$    having count(distinct v.fecha) > v_cfg.socio_visitas_semana_max and bool_or$n5$)
  ) f(i, viejo, nuevo) order by f.i loop
    if position(r.viejo in v_def) = 0 or position(r.viejo in substr(v_def, position(r.viejo in v_def) + 1)) > 0 then
      raise exception '181: el fragmento % no está exactamente una vez', r.i;
    end if;
    v_def := replace(v_def, r.viejo, r.nuevo);
  end loop;
  execute v_def;
  if md5(pg_get_functiondef(v_fn)) <> '94cf0df9d0b189322b27d4d8b208a3e0' then
    raise exception '181: club_excepciones__nucleo quedó con md5 % (se esperaba 94cf0df9d0b189322b27d4d8b208a3e0)', md5(pg_get_functiondef(v_fn));
  end if;
end
$$;
revoke all on function public.club_excepciones__nucleo(date, date, text, text) from public, anon, authenticated;

-- 6. Alertas del Inicio: MISMO_USUARIO de socios por días (cuerpo de la 164)
create or replace function public.club_alertas_inicio(p_location text default null)
returns table (tipo text, ref text, cantidad int, umbral int, fecha timestamptz, detalle jsonb)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol   public.user_role := public.get_my_role();
  v_cfg   public.club_config%rowtype;
  v_hoy   date := (now() at time zone 'America/Costa_Rica')::date;
  v_desde timestamptz;
  v_n     int;
  v_loc   record;
  v_multi boolean;
begin
  if v_rol is null or v_rol not in ('owner','manager') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  -- Sin local (el Inicio): TODOS los locales con el Club encendido que el usuario ve, cada aviso con su local. Así, con
  -- dos locales encendidos y ninguno elegido en el aparato, el Inicio no queda en «sin comprobar» (verificador #183).
  if p_location is null then
    select count(*) > 1 into v_multi from public.club_config c
     where c.club_activo and public.puede_ver_local(c.location_id);
    for v_loc in select c.location_id from public.club_config c
                  where c.club_activo and public.puede_ver_local(c.location_id) order by c.location_id loop
      return query select a.tipo, a.ref, a.cantidad, a.umbral, a.fecha,
                          a.detalle || jsonb_build_object('multilocal', v_multi)
                     from public.club_alertas_inicio(v_loc.location_id) a;
    end loop;
    return;
  end if;
  p_location := public.club_local(p_location, false);
  if not public.puede_ver_local(p_location) then        -- 091: el manager ve solo sus locales
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if not public.club_local_activo(p_location) then return; end if;   -- Club apagado en el local: nada que revisar
  select * into v_cfg from public.club_config c where c.location_id = p_location;
  v_desde := (v_hoy - 1)::timestamp at time zone 'America/Costa_Rica';   -- ayer 00:00 hora CR

  -- (a) más de N acumulaciones del mismo anfitrión en 24 h
  return query
  with ac as (
    select m.miembro_id, m.fecha_visita as f
      from public.club_movimientos m
     where m.location_id = p_location and m.tipo = 'tarjeta' and m.personas > 0
       and m.origen <> 'migracion'                                     -- la carga inicial no cuenta (como la 155)
       and m.fecha_visita >= v_desde - interval '24 hours' and m.fecha_visita <= now()
    union all
    select pp.miembro_id, pp.fecha_visita
      from public.club_personas_pendientes pp
     where pp.location_id = p_location and pp.movimiento_id is null   -- aprobada = ya es movimiento (no se cuenta dos veces)
       and pp.fecha_visita >= v_desde - interval '24 hours' and pp.fecha_visita <= now()),
  ve as (   -- por cada acumulación de la ventana de revisión: cuántas del mismo anfitrión en las 24 h que terminan ahí
    select a.miembro_id, a.f as hasta,
           (select count(*) from ac b where b.miembro_id = a.miembro_id and b.f > a.f - interval '24 hours' and b.f <= a.f) as n
      from ac a where a.f >= v_desde),
  mx as (
    select distinct on (ve.miembro_id) ve.miembro_id, ve.n, ve.hasta
      from ve order by ve.miembro_id, ve.n desc, ve.hasta desc)
  select 'ANFITRION_24H'::text, 'anfitrion-24h:' || mx.miembro_id, mx.n::int, v_cfg.alerta_anfitrion_24h_max, mx.hasta,
         jsonb_build_object('local', p_location, 'local_nombre', coalesce(v_cfg.nombre, p_location),
                            'miembro_id', mx.miembro_id, 'miembro', public.club_nombre_limpio(mi.nombre),
                            'tipo_miembro', mi.tipo, 'desde', mx.hasta - interval '24 hours', 'hasta', mx.hasta)
    from mx join public.club_miembros mi on mi.id = mx.miembro_id
   where mx.n > v_cfg.alerta_anfitrion_24h_max
   order by mx.n desc, mx.hasta desc;

  -- (b) el mismo usuario registra al mismo socio (visitas) o al mismo del equipo (tarjetas) más de M veces en D días
  return query
  with rg as (
    select v.miembro_id, v.registrado_por as usuario, v.registrada_en as f, 'socio'::text as que
      from public.club_visitas_socio v
     where v.location_id = p_location and v.registrado_por is not null
       and v.registrada_en >= v_desde - make_interval(days => v_cfg.alerta_mismo_usuario_dias) and v.registrada_en <= now()
    union all
    select m.miembro_id, m.registrado_por, m.registrado_en, 'equipo'
      from public.club_movimientos m join public.club_miembros mi on mi.id = m.miembro_id
     where m.location_id = p_location and m.tipo = 'tarjeta' and m.personas > 0 and m.origen <> 'migracion'
       and mi.tipo = 'equipo' and m.registrado_por is not null
       and m.registrado_en >= v_desde - make_interval(days => v_cfg.alerta_mismo_usuario_dias) and m.registrado_en <= now()),
  ve as (
    select a.miembro_id, a.usuario, a.que, a.f as hasta,
           -- 181 (opción A): para socios cuentan los DÍAS (CR) con visita, no las visitas: almuerzo + cena = 1 día
           (select case when a.que = 'socio' then count(distinct (b.f at time zone 'America/Costa_Rica')::date) else count(*) end
              from rg b where b.miembro_id = a.miembro_id and b.usuario = a.usuario and b.que = a.que
               and b.f > a.f - make_interval(days => v_cfg.alerta_mismo_usuario_dias) and b.f <= a.f) as n
      from rg a where a.f >= v_desde),
  mx as (
    select distinct on (ve.miembro_id, ve.usuario, ve.que) ve.*
      from ve order by ve.miembro_id, ve.usuario, ve.que, ve.n desc, ve.hasta desc)
  select 'MISMO_USUARIO'::text, 'mismo-usuario:' || mx.que || ':' || mx.miembro_id || ':' || mx.usuario, mx.n::int,
         v_cfg.alerta_mismo_usuario_max, mx.hasta,
         jsonb_build_object('local', p_location, 'local_nombre', coalesce(v_cfg.nombre, p_location),
                            'miembro_id', mx.miembro_id, 'miembro', public.club_nombre_limpio(mi.nombre), 'que', mx.que,
                            'usuario', coalesce((select p.full_name from public.profiles p where p.id = mx.usuario), 'Sin perfil'),
                            'dias', v_cfg.alerta_mismo_usuario_dias,
                            'cuenta', case when mx.que = 'socio' then 'dias' else 'veces' end)
    from mx join public.club_miembros mi on mi.id = mx.miembro_id
   where mx.n > v_cfg.alerta_mismo_usuario_max
   order by mx.n desc, mx.hasta desc;

  -- (c) visitas de socio sin factura cruzada (ayer y hoy): la misma cuenta que «Reportes → Visitas de socios por usuario»
  select coalesce(sum(r.sin_factura), 0)::int into v_n from public.club_reporte_visitas(v_hoy - 1, v_hoy, p_location) r;
  if v_n > v_cfg.alerta_visitas_sin_factura_max then
    return query select 'VISITAS_SIN_FACTURA'::text, 'visitas-sin-factura:' || p_location || ':' || v_hoy, v_n,
                        v_cfg.alerta_visitas_sin_factura_max, now(),
                        jsonb_build_object('local', p_location, 'local_nombre', coalesce(v_cfg.nombre, p_location),
                                           'desde', v_hoy - 1, 'hasta', v_hoy);
  end if;

  -- (d) canjes sin código sin resolver (30 días): las mismas filas de Excepciones, solo el conteo
  select count(*)::int into v_n
    from public.club_excepciones(v_hoy - 30, v_hoy, p_location, 'CANJE_SIN_CODIGO') e where not e.resuelta;
  if v_n > v_cfg.alerta_canjes_sin_codigo_max then
    return query select 'CANJE_SIN_CODIGO'::text, 'canjes-sin-codigo:' || p_location || ':' || v_hoy, v_n,
                        v_cfg.alerta_canjes_sin_codigo_max, now(),
                        jsonb_build_object('local', p_location, 'local_nombre', coalesce(v_cfg.nombre, p_location), 'dias', 30);
  end if;
end;
$$;
revoke all on function public.club_alertas_inicio(text) from public, anon, authenticated;
grant execute on function public.club_alertas_inicio(text) to authenticated;

-- Verificación (si algo no quedó, aborta y no se aplica nada)
do $$
begin
  if to_regprocedure('public.club_socio_visita(uuid,jsonb,uuid,text)') is null
     or to_regprocedure('public.club_socio_visita_base(uuid,jsonb,uuid,text)') is null then
    raise exception '181: falta club_socio_visita o club_socio_visita_base (necesita la 168)';
  end if;
  if position('club_socio_tope_comida' in pg_get_functiondef('public.club_socio_visita_base(uuid,jsonb,uuid,text)'::regprocedure)) = 0 then
    raise exception '181: club_socio_visita_base no quedó con el tope por comida';
  end if;
  if has_function_privilege('authenticated', 'public.club_socio_tope_comida(uuid,text,timestamptz)', 'execute')
     or has_function_privilege('anon', 'public.club_comida(text,timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.club_socio_visita_base(uuid,jsonb,uuid,text)', 'execute')
     or has_function_privilege('authenticated', 'public.club_excepciones__nucleo(date,date,text,text)', 'execute') then
    raise exception '181: una función interna quedó abierta a la API';
  end if;
  if position('socio-comida:' in pg_get_functiondef('public.club_excepciones__nucleo(date,date,text,text)'::regprocedure)) = 0
     or position('count(distinct (b.f at time zone' in pg_get_functiondef('public.club_alertas_inicio(text)'::regprocedure)) = 0 then
    raise exception '181: las alertas no quedaron por comida / por días';
  end if;
  if not has_function_privilege('authenticated', 'public.club_alertas_inicio(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.club_excepciones(date,date,text,text)', 'execute') then
    raise exception '181: se perdió el EXECUTE de club_alertas_inicio o del envoltorio de club_excepciones';
  end if;
end
$$;

commit;
