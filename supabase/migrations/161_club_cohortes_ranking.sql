-- ╔══════════════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 161 (origen 107) — Club: cohortes del Local Club y ranking de socios por consumo (Fase 1C).      ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════════════╝
--
-- ⚠ Dos funciones nuevas que leen plata y datos de socios: no se mergea sin el OK del dueño. Creada como 107 (bloque
-- CLUB); prod va por la 155, así que va al bloque de PASE con origen 107 (regla 3). 156–160 son de otros PRs.
-- No depende de la 160 (#179): rama independiente desde main. Copia su criterio de «venta neta» y de «descuento
-- ESTIMADO por línea» (el de «Descuento sin respaldo»), sin llamarla.
--
-- SPEC Club v2 (14-nov), ítems 6 y 7:
--   6 · Cohortes del Local Club: por mes de alta, socios, con 2.ª visita, con 4.ª visita, activos a 30/60/90 días,
--       visitas por socio. Una celda que todavía no puede medirse sale «aún no» (null), nunca 0.
--   7 · Ranking de socios por consumo: por socio, visitas, venta respaldada (por mesa; una factura cuenta una vez),
--       tiquete promedio, invitados, descuento estimado y última visita. Solo owner y manager; abrirlo (y exportarlo)
--       queda en club_auditoria. Sin teléfonos ni correos.
--
-- ── QUÉ HACE ───────────────────────────────────────────────────────────────────────────────────
--   · public.club_cohortes_socios(p_location text default null, p_apertura uuid default null) → jsonb. owner, manager y contador ACTIVOS
--     (get_my_role() da null con la cuenta inactiva). Solo conteos: ningún nombre, código ni contacto (el contador lo
--     lee). Rastro en club_auditoria ('ver_cohortes', local), una fila por apertura (ver abajo).
--   · public.club_ranking_socios(p_desde date, p_hasta date, p_location text default null, p_exporte boolean default
--     false, p_apertura uuid default null) → jsonb. Solo owner y manager ACTIVOS. Nombre del socio (limpio, como los reportes) y números; nunca
--     teléfono, correo, código ni token. Rastro en club_auditoria: 'ver_ranking_socios' o, con p_exporte,
--     'exporte_ranking_socios_csv' (desde, hasta, local y cuántas filas; sin datos). El CSV de la app SOLO sale de la
--     llamada con p_exporte (como club_reporte_exportar): sin pasar por acá no hay exporte.
--   · p_location null = todos los locales del Club que el usuario ve (mis_locales(), 091). Con local: tiene que estar
--     en club_config y en mis_locales() (el manager ve solo sus locales).
--   · Rastro de una LECTURA (verificador de #180): una fila por APERTURA de la pantalla, no por cada cambio de filtro. La
--     app manda un id por apertura (p_apertura → objeto_id de club_auditoria); el mismo usuario con la misma acción e id
--     en 12 h no deja otra fila (club_auditar_lectura, interna). Sin id, siempre deja fila. El EXPORTE deja fila siempre.
--   · Las dos: SECURITY DEFINER, search_path fijo, EXECUTE solo authenticated (anon no).
--
-- ── DEFINICIONES ───────────────────────────────────────────────────────────────────────────────
--   · Socio: club_miembro_roles rol 'socio' que no está 'pendiente' (activo o de baja: la baja sigue en su cohorte).
--   · Cohorte: el mes de club_miembro_roles.desde en hora de Costa Rica. Local de la cohorte = local del alta
--     (club_miembros.location_id). Visitas en cualquier local (Club compartido).
--   · Visita: una fila de club_visitas_socio del socio desde su alta (un mismo pedido no se registra dos veces: lo
--     cuida club_socio_visita). Se cuenta por su día CR (fecha); «día N» = fecha − día del alta.
--   · Con 2.ª / 4.ª visita: socios con 2 o más / 4 o más visitas registradas, hasta hoy. La visita registrada el día del
--     alta cuenta como la 1.ª (lo normal en caja: alta y visita juntas), así que «con 2.ª visita» = volvió al menos una
--     vez (recomendación adoptada provisoriamente, 14-nov; sin firma). Un alta sin visita registrada no es visita.
--   · Autoalta (club-web): desde = la fecha de la SOLICITUD, no la de la validación en caja (la validación no cambia
--     desde): la cohorte y las ventanas 30/60/90 corren desde la solicitud.
--   · Activo a 30 / 60 / 90 días: con al menos una visita en los días 1–30 / 31–60 / 61–90 después del alta (el día
--     del alta no cuenta). Se mide recién cuando la ventana se cerró para TODOS los socios de la cohorte: último día
--     del mes de la cohorte + N < hoy (CR). Si no, null = «aún no».
--   · Ranking, período: días CR [p_desde, p_hasta] (máximo 400 días). Visitas del período en los locales elegidos.
--   · Facturas de una visita: club_cruce_facturas (la del pedido + divididas; solo cerradas, C). La venta del socio es
--     la de la MESA. Una factura cuenta una vez por socio aunque tenga dos visitas; dos socios en la misma mesa la
--     tienen los dos en su fila, y los TOTALES la cuentan una sola vez.
--   · Venta neta de una factura: Σ monto de sus líneas, menos las familias 6, 17 y 20 (netaVenta.ts, firmado).
--   · Mesas = visitas con factura, contadas por su factura principal (dos visitas a la misma mesa son una).
--   · Tiquete promedio = venta respaldada ÷ mesas.
--   · Invitados: Σ cantidad del artículo de invitado del Local Club (lc_invitado_codigo, 857) en sus facturas.
--   · Descuento ESTIMADO (el PoS manda descuento_crc en cero): por línea, con las MISMAS reglas que
--     DESCUENTO_SIN_RESPALDO (club_excepciones) y el tablero (160 corregida, 62a7636): referencia = el precio unitario más
--     vendido (moda; empate → el más alto) de los 30 días anteriores en facturas C del local SIN marcador y fuera del Club;
--     la línea cuenta si está > 1 % por debajo de la referencia y del precio más alto del período, y NO es cambio de
--     lista (si ese día ≥ 60 % de las ventas del artículo, sin las respaldadas del todo y sin las del Club, van a ese
--     precio o menos, es la lista nueva). Descuento = (referencia − cobrado) × cantidad. No se estiman cortesías, PAX, la
--     sección de cortesías ni las líneas marcador (856, 857, PROMO, marcadores). Sin referencia, la línea no se estima
--     (se cuenta aparte).
--   · Última visita: la más reciente del socio en cualquier local (fecha CR), aunque sea fuera del período.
--   · Local sin facturas del PoS en el período (Nosara hoy): sale en 'locales_sin_pos' (aviso en pantalla, no error).
--
-- ── LO QUE NO TOCA ─────────────────────────────────────────────────────────────────────────────
--   · Ninguna tabla, columna, saldo ni movimiento. Solo lectura (más la fila de auditoría). Ninguna función existente.
--   · Ni sagrados, ni caja, ni Edge.
--
-- Pruebas: scripts/sql/161_pruebas.sql (transacción con rollback; Postgres 16 local y staging).
-- Rollback: scripts/sql/161_rollback.sql.

begin;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Locales que lee un reporte: el pedido (validado) o, sin pedido, todos los del Club que el usuario ve. Interna.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.club_locales_de_reporte(p_location text)
returns text[]
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v text[];
begin
  if p_location is null then
    select coalesce(array_agg(c.location_id order by c.location_id), array[]::text[]) into v
      from public.club_config c where c.location_id = any (public.mis_locales());
    return v;
  end if;
  p_location := public.club_local(p_location, false);   -- tiene que existir en club_config
  if not public.puede_ver_local(p_location) then         -- 091: el manager ve solo sus locales
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  return array[p_location];
end;
$$;
revoke all on function public.club_locales_de_reporte(text) from public, anon, authenticated;

-- Rastro de una LECTURA: una fila por apertura de la pantalla, no por cada cambio de filtro. La app manda un id por
-- apertura (p_apertura, va en objeto_id): si el mismo usuario ya dejó la fila de esa acción con ese id en las últimas
-- 12 h, no se repite. Sin id, siempre deja fila. Un id viejo o repetido no borra nada: la primera fila ya está. Interna.
create or replace function public.club_auditar_lectura(p_accion text, p_tabla text, p_apertura uuid, p_despues jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if p_apertura is not null and exists (
       select 1 from public.club_auditoria a
        where a.actor = auth.uid() and a.accion = p_accion and a.objeto_id = p_apertura
          and a.en > now() - interval '12 hours') then
    return;
  end if;
  perform public.club_auditar(p_accion, p_tabla, p_apertura, null, p_despues);
end;
$$;
revoke all on function public.club_auditar_lectura(text, text, uuid, jsonb) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 6 · Cohortes del Local Club
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.club_cohortes_socios(p_location text default null, p_apertura uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol  public.user_role := public.get_my_role();
  v_locs text[];
  v_hoy  date := (now() at time zone 'America/Costa_Rica')::date;
  r      jsonb;
begin
  -- Rol primero (antes de decir si el local existe). null = sin sesión o cuenta inactiva.
  if v_rol is null or v_rol not in ('owner','manager','contador') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  v_locs := public.club_locales_de_reporte(p_location);

  perform public.club_auditar_lectura('ver_cohortes', 'club_cohortes_socios', p_apertura,
    jsonb_build_object('local', coalesce(p_location, 'todos')));

  with
  so as (
    select m.id, r.desde, (r.desde at time zone 'America/Costa_Rica')::date as alta,
           date_trunc('month', (r.desde at time zone 'America/Costa_Rica'))::date as cohorte, (r.estado = 'baja') as baja
      from public.club_miembro_roles r join public.club_miembros m on m.id = r.miembro_id
     where r.rol = 'socio' and r.estado <> 'pendiente' and m.location_id = any (v_locs)),
  -- visitas desde el alta, en cualquier local (Club compartido)
  vs as (
    select so.id, count(v.id) as n,
           bool_or(v.fecha - so.alta between 1 and 30)  as a30,
           bool_or(v.fecha - so.alta between 31 and 60) as a60,
           bool_or(v.fecha - so.alta between 61 and 90) as a90
      from so left join public.club_visitas_socio v on v.miembro_id = so.id and v.registrada_en >= so.desde
     group by so.id),
  co as (
    select so.cohorte, count(*) as socios, count(*) filter (where so.baja) as bajas,
           count(*) filter (where vs.n >= 2) as con_2, count(*) filter (where vs.n >= 4) as con_4,
           count(*) filter (where vs.a30) as a30, count(*) filter (where vs.a60) as a60, count(*) filter (where vs.a90) as a90,
           coalesce(sum(vs.n), 0) as visitas,
           ((so.cohorte + interval '1 month')::date - 1) as ultimo_dia
      from so join vs on vs.id = so.id
     group by so.cohorte)
  select jsonb_build_object(
    'local', coalesce(p_location, 'todos'),
    'locales', to_jsonb(v_locs),
    'hoy', v_hoy,
    'generado_en', now(),
    'cohortes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'mes', to_char(co.cohorte, 'YYYY-MM'),
               'socios', co.socios, 'bajas', co.bajas,
               'con_2', co.con_2, 'con_4', co.con_4,
               -- null = «aún no»: la ventana no se cerró para todos los socios de la cohorte
               'activos_30', case when co.ultimo_dia + 30 < v_hoy then co.a30 end,
               'activos_60', case when co.ultimo_dia + 60 < v_hoy then co.a60 end,
               'activos_90', case when co.ultimo_dia + 90 < v_hoy then co.a90 end,
               'visitas', co.visitas,
               'visitas_por_socio', round(co.visitas::numeric / co.socios, 1))
             order by co.cohorte desc)
        from co), '[]'::jsonb),
    'totales', (select jsonb_build_object(
                  'socios', coalesce(sum(co.socios), 0), 'bajas', coalesce(sum(co.bajas), 0),
                  'con_2', coalesce(sum(co.con_2), 0), 'con_4', coalesce(sum(co.con_4), 0),
                  'visitas', coalesce(sum(co.visitas), 0),
                  'visitas_por_socio', case when sum(co.socios) > 0 then round(sum(co.visitas)::numeric / sum(co.socios), 1) end)
                from co)
  ) into r;
  return r;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 7 · Ranking de socios por consumo
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.club_ranking_socios(p_desde date, p_hasta date, p_location text default null,
                                                      p_exporte boolean default false, p_apertura uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol  public.user_role := public.get_my_role();
  v_locs text[];
  v_ini  timestamptz;
  v_fin  timestamptz;
  v_n    int;
  r      jsonb;
begin
  -- Solo owner y manager: el ranking tiene nombres (el contador lee totales en otras pantallas).
  if v_rol is null or v_rol not in ('owner','manager') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 400 then
    raise exception 'Período no válido: elegí desde y hasta (máximo 400 días)' using errcode = 'P0001';
  end if;
  v_locs := public.club_locales_de_reporte(p_location);
  v_ini := p_desde::timestamp at time zone 'America/Costa_Rica';
  v_fin := (p_hasta + 1)::timestamp at time zone 'America/Costa_Rica';

  with
  cf as (select c.* from public.club_config c where c.location_id = any (v_locs)),
  -- Visitas del período en los locales elegidos, con sus facturas (C). Solo de socios (no de uno pendiente)
  vp as (
    select v.id, v.miembro_id, v.location_id, v.fecha,
           public.club_cruce_facturas(v.location_id, v.pos_ref, null) as tids
      from public.club_visitas_socio v
      join public.club_miembro_roles rv on rv.miembro_id = v.miembro_id and rv.rol = 'socio' and rv.estado <> 'pendiente'
     where v.location_id = any (v_locs) and v.fecha >= p_desde and v.fecha <= p_hasta),
  -- Socios: los de alta en esos locales y los que vinieron en el período (Club compartido)
  so as (
    select m.id, public.club_nombre_limpio(m.nombre) as nombre, m.location_id as local_alta, r.estado,
           (r.desde at time zone 'America/Costa_Rica')::date as alta
      from public.club_miembro_roles r join public.club_miembros m on m.id = r.miembro_id
     where r.rol = 'socio' and r.estado <> 'pendiente'
       and (m.location_id = any (v_locs) or exists (select 1 from vp where vp.miembro_id = m.id))),
  -- (socio, factura): una factura cuenta UNA vez por socio
  sf as (select distinct vp.miembro_id, x.tid from vp cross join lateral unnest(vp.tids) as x(tid)),
  ft as (
    select t.id, t.local, coalesce(t.pax, 0) as pax, coalesce(t.fecha_registra, t.fecha_cierra) as f
      from public.pos_ndf_tickets t where t.id in (select tid from sf) and t.estado = 'C'),
  neta as (
    select l.ticket_id, sum(l.monto) filter (where l.familia is null or l.familia not in (6, 17, 20)) as neta,
           sum(l.cantidad) filter (where l.codigo_producto = cf.lc_invitado_codigo) as invitados
      from public.pos_ndf_ticket_lines l join ft on ft.id = l.ticket_id join cf on cf.location_id = ft.local
     group by l.ticket_id),
  -- Facturas del Club (no dan precio de referencia): de socios (todas las visitas del rango ampliado), cupones y canjes
  fc as materialized (
    select x.tid
      from public.club_visitas_socio v
      cross join lateral unnest(public.club_cruce_facturas(v.location_id, v.pos_ref, null)) as x(tid)
     where v.location_id = any (v_locs)
       and v.registrada_en >= v_ini - interval '32 days' and v.registrada_en < v_fin + interval '1 day'
    union
    select x.tid
      from public.club_movimientos m
      left join public.club_cruces_manuales cm on cm.movimiento_id = m.id
      left join public.pos_ndf_tickets cm_t on cm_t.local = m.location_id and cm_t.numero_factura = cm.numero_factura
      cross join lateral unnest(case when cm_t.id is not null then array[cm_t.id]
                                     else public.club_cruce_facturas(m.location_id, m.pos_ref, m.factura_pos) end) as x(tid)
     where m.location_id = any (v_locs) and m.origen = 'app'
       and (m.tipo = 'canje' or (m.tipo = 'tarjeta' and m.cupon_id is not null))
       and (m.factura_pos is not null or m.pos_ref is not null)
       and m.fecha_visita >= v_ini - interval '32 days' and m.fecha_visita < v_fin + interval '1 day'),
  -- Facturas con un marcador de descuento activo (856, 857, PROMO, tarjetas de hotel…), y si alguno es SIN % (respalda
  -- todo). Las mismas reglas que DESCUENTO_SIN_RESPALDO (club_excepciones) y el tablero (160, cabeza 62a7636).
  mk as materialized (
    select z.ticket_id as tid, bool_or(k.pct_esperado is null) as total
      from public.pos_ndf_ticket_lines z join public.pos_ndf_tickets t on t.id = z.ticket_id
      join public.club_marcadores_descuento k on k.location_id = t.local and k.activo and k.codigo_producto = z.codigo_producto
     where t.local = any (v_locs) and t.estado = 'C'
       and t.fecha_registra >= v_ini - interval '31 days' and t.fecha_registra < v_fin
     group by z.ticket_id),
  -- Precios unitarios cobrados (30 días antes y el período), por local, artículo, día y precio, con sus marcas
  pr as materialized (
    select t.local, l.codigo_producto as cod, (t.fecha_registra at time zone 'America/Costa_Rica')::date as dia,
           round(l.monto / l.cantidad, 2) as u,
           (k.tid is not null) as con_mk, coalesce(k.total, false) as mk_total,
           exists (select 1 from fc where fc.tid = t.id) as club,
           count(*) as n
      from public.pos_ndf_ticket_lines l join public.pos_ndf_tickets t on t.id = l.ticket_id
      left join mk k on k.tid = t.id
     where t.local = any (v_locs) and t.estado = 'C'
       and t.fecha_registra >= v_ini - interval '31 days' and t.fecha_registra < v_fin
       and l.cantidad > 0 and l.monto > 0 and not coalesce(l.es_cortesia, false) and not coalesce(l.es_pax, false)
       and l.codigo_producto is not null
     group by 1, 2, 3, 4, 5, 6, 7),
  -- dday: base de la referencia (sin marcador y fuera del Club)
  dday as (select local, cod, dia, u, sum(n) as n from pr where not con_mk and not club group by 1, 2, 3, 4),
  -- ddia: regla del cambio de lista: todas las ventas del día salvo las respaldadas del todo (marcador sin %) y las del
  -- Club (si no, un socio que pidió el artículo solo ese día haría «lista nueva» de su propio descuento)
  ddia as (select local, cod, dia, u, sum(n) as n from pr where not mk_total and not club group by 1, 2, 3, 4),
  umax as (select local, cod, max(u) as umax from pr where not con_mk and not club group by 1, 2),
  -- Líneas de las facturas de los socios, marcadas (las mismas exclusiones que el tablero)
  lc as (
    select ft.id as tid, ft.local, l.codigo_producto as cod, l.cantidad, l.monto,
           (ft.f at time zone 'America/Costa_Rica')::date as dia,
           coalesce(l.es_cortesia, false) or coalesce(l.es_pax, false)
             or coalesce(cf.cortesia_familia is not null and l.familia = cf.cortesia_familia, false)
             or exists (select 1 from public.club_cortesias c where c.location_id = ft.local and c.codigo_producto = l.codigo_producto)
             -- coalesce: sin PROMO cargada (promo_articulo_codigo null) el «in» daría null y la línea se perdería
             or coalesce(l.codigo_producto in (cf.lc_articulo_codigo, cf.lc_invitado_codigo, cf.promo_articulo_codigo), false)
             or exists (select 1 from public.club_marcadores_descuento k
                         where k.location_id = ft.local and k.activo and k.codigo_producto = l.codigo_producto) as fuera
      from public.pos_ndf_ticket_lines l join ft on ft.id = l.ticket_id join cf on cf.location_id = ft.local),
  -- Referencia: la moda de los 30 días anteriores al día de la línea (empate → el precio más alto)
  ref as (
    select distinct on (z.local, z.cod, z.dia) z.local, z.cod, z.dia, z.u as ref
      from (select d.local, d.cod, d.dia, p.u, sum(p.n) as n
              from (select distinct local, cod, dia from lc where cod is not null and not fuera) d
              join dday p on p.local = d.local and p.cod = d.cod and p.dia >= d.dia - 30 and p.dia < d.dia
             group by d.local, d.cod, d.dia, p.u) z
     order by z.local, z.cod, z.dia, z.n desc, z.u desc),
  -- Cada línea candidata con su referencia y la parte de las ventas del día a ese precio o menos (cambio de lista)
  dl as (
    select x.tid, x.cantidad, round(x.monto / x.cantidad, 2) as u, r.ref, m.umax,
           (select sum(q.n) filter (where q.u <= round(x.monto / x.cantidad, 2) * 1.001)::numeric / nullif(sum(q.n), 0)
              from ddia q where q.local = x.local and q.cod = x.cod and q.dia = x.dia) as parte_dia
      from lc x left join ref r on r.local = x.local and r.cod = x.cod and r.dia = x.dia
      left join umax m on m.local = x.local and m.cod = x.cod
     where x.cantidad > 0 and x.monto > 0 and x.cod is not null and not x.fuera),
  dsc as (
    select dl.*, (dl.ref is not null and dl.u < dl.ref * 0.99 and dl.u < dl.umax * 0.99
                  -- cambio de lista: si ese día ≥ 60 % de las ventas (fuera del Club) van a ese precio o menos, es precio nuevo
                  and coalesce(dl.parte_dia, 0) < 0.6) as es_desc
      from dl),
  -- Descuento estimado por FACTURA (así una factura compartida no se estima dos veces en los totales)
  dt as (
    select tid, coalesce(sum((ref - u) * cantidad) filter (where es_desc), 0) as crc,
           count(*) filter (where ref is null) as sin_ref
      from dsc group by tid),
  -- Una fila por factura C con sus números
  fa as (
    select ft.id, ft.pax, coalesce(n.neta, 0) as neta, coalesce(n.invitados, 0) as invitados,
           coalesce(dt.crc, 0) as desc_crc, coalesce(dt.sin_ref, 0) as sin_ref
      from ft left join neta n on n.ticket_id = ft.id left join dt on dt.tid = ft.id),
  -- Por socio
  pv as (
    -- mesas = visitas con factura, contadas por su factura principal (dos visitas a la misma mesa son una)
    select vp.miembro_id, count(*) as visitas,
           count(distinct vp.tids[1]) filter (where vp.tids[1] in (select id from ft)) as mesas
      from vp group by vp.miembro_id),
  ps as (
    select sf.miembro_id, count(fa.id) as facturas, coalesce(sum(fa.neta), 0) as venta, coalesce(sum(fa.pax), 0) as personas,
           coalesce(sum(fa.invitados), 0) as invitados, coalesce(sum(fa.desc_crc), 0) as desc_crc
      from sf join fa on fa.id = sf.tid group by sf.miembro_id),
  uv as (
    select v.miembro_id, max(v.fecha) as ultima from public.club_visitas_socio v
     where v.miembro_id in (select id from so) group by v.miembro_id),
  fi as (
    select so.id, so.nombre, so.local_alta, coalesce(cl.nombre, so.local_alta) as local_alta_nombre, so.estado, so.alta,
           coalesce(pv.visitas, 0) as visitas, coalesce(pv.mesas, 0) as mesas,
           coalesce(ps.facturas, 0) as facturas, coalesce(ps.venta, 0) as venta, coalesce(ps.personas, 0) as personas,
           coalesce(ps.invitados, 0) as invitados, coalesce(ps.desc_crc, 0) as desc_crc, uv.ultima
      from so
      left join pv on pv.miembro_id = so.id left join ps on ps.miembro_id = so.id left join uv on uv.miembro_id = so.id
      left join public.club_config cl on cl.location_id = so.local_alta),
  -- Locales sin facturas del PoS en el período (Nosara hoy): aviso
  sp as (
    select coalesce(jsonb_agg(coalesce(c.nombre, c.location_id) order by c.location_id), '[]'::jsonb) as l
      from cf c
     where not exists (select 1 from public.pos_ndf_tickets t
                        where t.local = c.location_id and t.estado = 'C'
                          and coalesce(t.fecha_registra, t.fecha_cierra) >= v_ini
                          and coalesce(t.fecha_registra, t.fecha_cierra) < v_fin))
  select jsonb_build_object(
    'desde', p_desde, 'hasta', p_hasta,
    'local', coalesce(p_location, 'todos'),
    'locales', to_jsonb(v_locs),
    'locales_sin_pos', (select l from sp),
    'generado_en', now(),
    'socios', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', fi.id, 'nombre', fi.nombre, 'local_alta', fi.local_alta_nombre, 'estado', fi.estado, 'alta', fi.alta,
               'visitas', fi.visitas, 'mesas', fi.mesas, 'facturas', fi.facturas,
               'venta_respaldada_crc', round(fi.venta),
               'tiquete_promedio_crc', case when fi.mesas > 0 then round(fi.venta / fi.mesas) end,
               'personas', fi.personas, 'invitados', fi.invitados,
               'descuento_estimado_crc', round(fi.desc_crc),
               'ultima_visita', fi.ultima)
             order by fi.venta desc, fi.visitas desc, fi.nombre)
        from fi), '[]'::jsonb),
    'totales', (select jsonb_build_object(
                  'socios', (select count(*) from fi),
                  'socios_con_visita', (select count(*) from fi where fi.visitas > 0),
                  'visitas', (select count(*) from vp),
                  -- cada factura UNA vez aunque la compartan dos socios
                  'facturas', count(fa.id), 'venta_respaldada_crc', round(coalesce(sum(fa.neta), 0)),
                  'invitados', coalesce(sum(fa.invitados), 0),
                  'descuento_estimado_crc', round(coalesce(sum(fa.desc_crc), 0)),
                  'lineas_sin_referencia', coalesce(sum(fa.sin_ref), 0))
                from fa)
  ) into r;

  v_n := jsonb_array_length(r->'socios');
  -- un exporte SIEMPRE deja fila; una lectura, una por apertura de la pantalla (el primer filtro de esa apertura)
  if p_exporte then
    perform public.club_auditar('exporte_ranking_socios_csv', 'club_ranking_socios', p_apertura, null,
      jsonb_build_object('desde', p_desde, 'hasta', p_hasta, 'local', coalesce(p_location, 'todos'), 'filas', v_n));
  else
    perform public.club_auditar_lectura('ver_ranking_socios', 'club_ranking_socios', p_apertura,
      jsonb_build_object('desde', p_desde, 'hasta', p_hasta, 'local', coalesce(p_location, 'todos'), 'filas', v_n));
  end if;
  return r;
end;
$$;

revoke all on function public.club_cohortes_socios(text, uuid) from public, anon, authenticated;
grant execute on function public.club_cohortes_socios(text, uuid) to authenticated;
revoke all on function public.club_ranking_socios(date, date, text, boolean, uuid) from public, anon, authenticated;
grant execute on function public.club_ranking_socios(date, date, text, boolean, uuid) to authenticated;

comment on function public.club_locales_de_reporte(text) is
  'Interna (161): el local pedido (club_config + puede_ver_local) o, sin local, los del Club que el usuario ve.';
comment on function public.club_auditar_lectura(text, text, uuid, jsonb) is
  'Interna (161): rastro de una lectura en club_auditoria, una fila por apertura de la pantalla (id en objeto_id, 12 h).';
comment on function public.club_cohortes_socios(text, uuid) is
  'Club → Cohortes (161): socios del Local Club por mes de alta (hora CR): 2.ª y 4.ª visita, activos a 30/60/90 días (null = aún no), visitas por socio. owner, manager y contador activos; solo conteos; rastro en club_auditoria.';
comment on function public.club_ranking_socios(date, date, text, boolean, uuid) is
  'Club → Ranking (161): por socio, visitas, venta respaldada por mesa (una factura una vez), tiquete, invitados (857), descuento estimado por línea y última visita. Solo owner y manager activos; sin contactos; cada lectura o exporte queda en club_auditoria.';

-- Verificación: las funciones existen, son SECURITY DEFINER con search_path fijo y anon no las ejecuta.
do $$
declare v_f text; v_p pg_proc%rowtype;
begin
  foreach v_f in array array['public.club_cohortes_socios(text, uuid)', 'public.club_ranking_socios(date, date, text, boolean, uuid)',
                             'public.club_locales_de_reporte(text)', 'public.club_auditar_lectura(text, text, uuid, jsonb)'] loop
    select * into v_p from pg_proc where oid = v_f::regprocedure;
    if not v_p.prosecdef then raise exception '161: % no es SECURITY DEFINER', v_f; end if;
    if not exists (select 1 from unnest(v_p.proconfig) c where c like 'search_path=%') then
      raise exception '161: % sin search_path fijo', v_f;
    end if;
    if has_function_privilege('anon', v_f, 'execute') then raise exception '161: anon puede ejecutar %', v_f; end if;
  end loop;
  if has_function_privilege('authenticated', 'public.club_locales_de_reporte(text)', 'execute')
     or has_function_privilege('authenticated', 'public.club_auditar_lectura(text, text, uuid, jsonb)', 'execute') then
    raise exception '161: club_locales_de_reporte y club_auditar_lectura tienen que ser internas';
  end if;
end $$;

commit;
