-- ╔══════════════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 155 (origen 102) — ANFITRION_SOBRE_TOPE sin la carga inicial del Club (decisión D5 A del dueño). ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════════════╝
--
-- ⚠ Cambia una función del Club en prod: no se mergea sin el OK del dueño. Creada como 102 (bloque CLUB); prod va por
-- la 153, así que se renumeró a la 155 del bloque de PASE (regla 3), con origen 102. La 101 (→ 152) es del #140 (aviso
-- del Club): usa la 154 solo si entra antes que la 155; si no, la siguiente libre del bloque PASE (156+).
--
-- ── QUÉ CIERRA ─────────────────────────────────────────────────────────────────────────────────
-- La carga inicial de tarjetas del sistema anterior (club_movimientos.origen = 'migracion') entró con fecha de visita
-- de este mes. ANFITRION_SOBRE_TOPE la sumaba como «ganado en el mes» y marcaba sobre el tope a casi todos los
-- anfitriones migrados: alertas falsas en Excepciones. El reporte del mes (club_reporte_mes) ya deja la carga aparte
-- («migracion»); acá, mismo criterio.
--
-- ── QUÉ HACE ───────────────────────────────────────────────────────────────────────────────────
--   · `create or replace` de `public.club_excepciones(date, date, text, text)`: copia EXACTA de la versión vigente
--     (150_club_satori_esquema.sql; en prod y staging el md5 del cuerpo es feaeb1b4…, igual al archivo) con UNA
--     condición nueva en la rama ANFITRION_SOBRE_TOPE: `and m.origen <> 'migracion'` sobre las tarjetas del mes.
--   · Lo demás no cambia: firma, columnas, STABLE, SECURITY DEFINER, search_path y las otras verificaciones. Las
--     personas pendientes (club_personas_pendientes) y las tarjetas de papel (origen 'papel') siguen contando.
--   · Permisos iguales a los de la 150: revoke a public/anon/authenticated y grant execute a authenticated.
--
-- ── LO QUE NO TOCA ─────────────────────────────────────────────────────────────────────────────
--   · Ni tablas, ni datos, ni plata, ni saldos. Las excepciones ya resueltas quedan en club_excepciones_resueltas (no
--     se borra nada); esas filas simplemente dejan de salir.
--   · No cambia la retención del anfitrión nuevo (A4.4, al registrar el cupón): es otra lógica.
--
-- Pruebas: scripts/sql/155_pruebas.sql (+ 155_pruebas.py; solo staging, transacción descartada).
-- Rollback: scripts/sql/155_rollback.sql (la versión anterior exacta).

begin;

create or replace function public.club_excepciones(p_desde date, p_hasta date, p_location text default null, p_tipo text default null)
returns table (tipo text, ref text, fecha timestamptz, factura text, certeza text, detalle jsonb,
               resuelta boolean, nota text, resuelta_en timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol public.user_role := public.get_my_role();
  v_cfg public.club_config%rowtype;
  v_ini timestamptz;
  v_fin timestamptz;
begin
  p_location := public.club_local(p_location, false);   -- LC-ML
  if not public.club_local_activo(p_location) then return; end if;   -- Club apagado en el local: sin excepciones LC
  if v_rol is null or v_rol not in ('owner','manager') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 400 then
    raise exception 'Rango de fechas no válido (máximo 400 días)' using errcode = 'P0001';
  end if;
  select * into v_cfg from public.club_config c where c.location_id = p_location;
  if not found then
    raise exception 'Local no válido' using errcode = 'P0001';
  end if;
  v_ini := p_desde::timestamp at time zone 'America/Costa_Rica';
  v_fin := (p_hasta + 1)::timestamp at time zone 'America/Costa_Rica';

  return query
  with tk as (
    select t.id, t.numero_factura, ltrim(t.numero_factura, '0') as clave,
           coalesce(t.fecha_registra, t.fecha_cierra) as f, coalesce(t.cxc_crc, 0) as cxc, t.total_crc, t.estado,
           coalesce(t.mesa_factura, t.mesa) as mesa,
           -- LC-A5 (Ismael, 08-nov): quién cobró la factura en el PoS, para la segregación de las que salen solo del PoS
           array_remove(array[nullif(btrim(t.cajero_login), ''), nullif(btrim(t.salonero_login), '')], null) as pos_logins,
           -- (08-nov) turno de la factura (corte del local) y los logins fijos de caja que aparecen en ella
           case when (coalesce(t.fecha_registra, t.fecha_cierra) at time zone 'America/Costa_Rica')::time < v_cfg.turno_corte
                then 'mañana' else 'tarde' end as turno,
           array(select x from unnest(array[nullif(btrim(t.cajero_login), ''), nullif(btrim(t.salonero_login), '')]) x
                  where x = any(v_cfg.pos_logins_caja)) as logins_fijos
      from public.pos_ndf_tickets t
     where t.local = p_location and coalesce(t.fecha_registra, t.fecha_cierra) >= v_ini
       and coalesce(t.fecha_registra, t.fecha_cierra) < v_fin),
  mv0 as (
    select m.*, public.club_factura_clave(m.factura_pos) as clave
      from public.club_movimientos m
     where m.location_id = p_location and m.origen = 'app' and m.tipo in ('tarjeta','canje')
       and (m.factura_pos is not null or m.pos_ref is not null)
       -- CLUB-AUD-13: solo el rango pedido (más un día de margen para los canjes de facturas del borde),
       -- no todo el historial: cada registro dispara su cruce con pos_ndf_tickets.
       and m.fecha_visita >= v_ini - interval '1 day' and m.fecha_visita < v_fin + interval '1 day'),
  -- Facturas del puente de cada registro: la elegida a mano por el manager (si hay) o el cruce
  -- automático (club_cruce_facturas: la del pedido + las divididas de la misma mesa). La primera es
  -- la principal.
  mv as (
    select m.*, a.auto_ids,
           case when cm_t.id is not null then array[cm_t.id] else a.auto_ids end as ticket_ids,
           case when cm.movimiento_id is not null then 'manual' else 'exacta' end as cert,
           coalesce(m.factura_pos,
                    case m.pos_ref->>'modo'
                      when 'pedido'  then concat('pedido ', m.pos_ref->>'pedido', coalesce(' · área ' || (m.pos_ref->>'area'), ''),
                                                 coalesce(' · mesa ' || (m.pos_ref->>'mesa'), ''))
                      when 'factura' then m.pos_ref->>'numero_factura' end) as ref_factura
      from mv0 m
      cross join lateral (select public.club_cruce_facturas(p_location, m.pos_ref, m.factura_pos) as auto_ids) a
      left join public.club_cruces_manuales cm on cm.movimiento_id = m.id
      left join public.pos_ndf_tickets cm_t on cm_t.local = p_location and cm_t.numero_factura = cm.numero_factura
     -- LC-A5: con p_tipo, el cruce de cada registro (lo caro) solo para los tipos que lo usan
     where p_tipo is null or p_tipo not in ('LC_SIN_REGISTRO','REGISTRO_LC_SIN_856','SOCIO_USO_ANOMALO','CORTESIA_DISTINTA',
                                            'CORTESIA_SIN_SOCIO','CORTESIA_NO_CONFIGURADA','ANFITRION_SOBRE_TOPE',
                                            'SOCIO_ALTA_SIN_CONFIRMAR','TARJETA_MANUAL','CANJE_SIN_CODIGO')),
  -- LC-A5: visitas de socio con sus facturas (la del pedido + divididas)
  vs as (
    select v.*, public.club_cruce_facturas(v.location_id, v.pos_ref, null) as ticket_ids
      from public.club_visitas_socio v
     where v.location_id = p_location and v.registrada_en >= v_ini - interval '1 day' and v.registrada_en < v_fin + interval '1 day'
       and (p_tipo is null or p_tipo in ('LC_SIN_REGISTRO','REGISTRO_LC_SIN_856','SOCIO_USO_ANOMALO','CUPON_AUTOREFERIDO',
                                         'CORTESIA_DISTINTA','CORTESIA_SIN_SOCIO'))),
  -- Club compartido: las visitas de esos socios en TODOS los locales (para SOCIO_USO_ANOMALO entre locales)
  vsa as (
    select v.* from public.club_visitas_socio v
     where v.registrada_en >= v_ini - interval '7 days' and v.registrada_en < v_fin + interval '1 day'
       and (p_tipo is null or p_tipo = 'SOCIO_USO_ANOMALO')
       and v.miembro_id in (select x.miembro_id from public.club_visitas_socio x
                             where x.location_id = p_location and x.registrada_en >= v_ini - interval '7 days'
                               and x.registrada_en < v_fin + interval '1 day')),
  -- líneas de las facturas C del rango, marcadas
  ln as (
    select l.*, t.clave, t.f, t.numero_factura, t.cxc,
           (l.codigo_producto in (v_cfg.lc_articulo_codigo, v_cfg.lc_invitado_codigo)) as es_lc,   -- 856 y 857
           (l.codigo_producto = v_cfg.lc_invitado_codigo) as es_invitado,
           (v_cfg.promo_articulo_codigo is not null and l.codigo_producto = v_cfg.promo_articulo_codigo) as es_promo,
           -- LC-MD: marcador de descuento configurado (activo) del local
           (select mk.nombre from public.club_marcadores_descuento mk
             where mk.location_id = p_location and mk.activo and mk.codigo_producto = l.codigo_producto) as marcador,
           ((v_cfg.cortesia_familia is not null and l.familia = v_cfg.cortesia_familia)
             or exists (select 1 from public.club_cortesias c where c.location_id = p_location and c.codigo_producto = l.codigo_producto)) as es_seccion
      from public.pos_ndf_ticket_lines l join tk t on t.id = l.ticket_id
     where t.estado = 'C'
       and (p_tipo is null or p_tipo in ('LC_SIN_REGISTRO','CANJE_CON_DESCUENTO','CORTESIA_DISTINTA','CORTESIA_SIN_SOCIO','CORTESIA_NO_CONFIGURADA'))),
  seccion_ok as (
    select (v_cfg.cortesia_familia is not null or exists (select 1 from public.club_cortesias c where c.location_id = p_location)) as ok),
  -- LC-MD: facturas con un MARCADOR DE DESCUENTO activo del local (club_marcadores_descuento, configurable). Un marcador
  -- sin % esperado respalda cualquier descuento de la factura; con % esperado, solo un descuento de ese % (±1,5 puntos).
  dmk as materialized (
    select t.id as tid, bool_or(mk.pct_esperado is null) as total,
           array_agg(mk.pct_esperado) filter (where mk.pct_esperado is not null) as pcts
      from public.pos_ndf_ticket_lines z join public.pos_ndf_tickets t on t.id = z.ticket_id
      join public.club_marcadores_descuento mk on mk.location_id = p_location and mk.activo and mk.codigo_producto = z.codigo_producto
     where t.local = p_location and t.estado = 'C'
       and t.fecha_registra >= v_ini - interval '30 days' and t.fecha_registra < v_fin
       and (p_tipo is null or p_tipo = 'DESCUENTO_SIN_RESPALDO')
     group by t.id),
  -- DESCUENTO_SIN_RESPALDO: precios unitarios de las facturas C, desde 30 días antes del rango (una pasada)
  dpr as materialized (
    select l.ticket_id as tid, l.codigo_producto as cod, l.nombre, round(l.monto / l.cantidad, 2) as u, l.cantidad as q,
           (t.fecha_registra at time zone 'America/Costa_Rica')::date as dia,
           (k.tid is not null) as mk, coalesce(k.total, false) as mk_total, k.pcts as mk_pcts
      from public.pos_ndf_ticket_lines l join public.pos_ndf_tickets t on t.id = l.ticket_id
      left join dmk k on k.tid = t.id
     where t.local = p_location and t.estado = 'C'
       and t.fecha_registra >= v_ini - interval '30 days' and t.fecha_registra < v_fin
       and l.cantidad > 0 and l.monto > 0 and not l.es_cortesia and not l.es_pax and l.codigo_producto is not null
       and (p_tipo is null or p_tipo = 'DESCUENTO_SIN_RESPALDO')),
  -- candidatas: del rango, en facturas sin cupón ni marcador sin %, por debajo del precio más alto del artículo
  -- (el precio de referencia sale solo de las facturas SIN marcador)
  dcand as materialized (
    select p.* from dpr p
      join (select cod, max(u) as umax from dpr where not mk group by cod) mx on mx.cod = p.cod
     where p.dia >= p_desde and p.dia <= p_hasta and p.u < mx.umax * 0.99 and not p.mk_total
       and (v_cfg.lc_excepciones_desde is null or p.dia >= v_cfg.lc_excepciones_desde)
       and not exists (select 1 from mv m where m.cupon_id is not null and p.tid = any(m.ticket_ids))),
  -- referencia: la moda de los 30 días anteriores, solo para los (artículo, día) candidatos. Con conteos por
  -- (artículo, día, precio) y un join (no una subconsulta por candidato); empate → el precio más alto.
  dday as materialized (select cod, dia, u, count(*) as n from dpr where not mk group by cod, dia, u),
  -- para la regla del cambio de lista: todas las ventas del día salvo las respaldadas del todo (marcador sin %)
  ddia as materialized (select cod, dia, u, count(*) as n from dpr where not mk_total group by cod, dia, u),
  dref as (
    select distinct on (z.cod, z.dia) z.cod, z.dia, z.u as ref
      from (select d.cod, d.dia, x.u, sum(x.n) as n
              from (select distinct cod, dia from dcand) d
              join dday x on x.cod = d.cod and x.dia >= d.dia - 30 and x.dia < d.dia
             group by d.cod, d.dia, x.u) z
     order by z.cod, z.dia, z.n desc, z.u desc),
  ex0 as (
    -- REGISTRO_SIN_FACTURA
    select 'REGISTRO_SIN_FACTURA'::text as tipo, m.id::text as ref, m.fecha_visita as fecha, m.ref_factura as factura,
           m.cert as certeza,
           jsonb_build_object('movimiento', case when m.cupon_id is not null then 'cupon' when m.tipo = 'canje' then 'canje' else 'tarjeta_manual' end,
                              'personas', m.personas, 'creditos', m.creditos,
                              'miembro', public.club_nombre_limpio(mi.nombre),
                              'registradores', jsonb_build_array(m.registrado_por)) as detalle
      from mv m join public.club_miembros mi on mi.id = m.miembro_id
     where m.fecha_visita >= v_ini and m.fecha_visita < v_fin
       and m.registrado_en < now() - make_interval(mins => v_cfg.puente_latencia_min)
       and cardinality(m.ticket_ids) = 0
       and coalesce(m.pos_ref->>'modo', '') <> 'pedido'
       and not public.club_cruce_provisional(p_location, m.pos_ref)   -- S0b: factura del plan B en R (falta el cierre)
    union all
    -- SIN_CRUCE: pedido sin su factura. Se marca cuando ya pasó la latencia del puente y el pedido no
    -- sigue abierto (o pasaron las 18 h). Sigue listada (resuelta) aunque el manager elija la factura.
    -- S0 (09-nov): con una factura R del pedido (cobrada, falta el cierre de caja) NO se marca.
    select 'SIN_CRUCE', m.id::text, m.fecha_visita, m.ref_factura, 'probable',
           jsonb_build_object('motivo', 'posible cuenta dividida',
                              'movimiento', case when m.cupon_id is not null then 'cupon' when m.tipo = 'canje' then 'canje' else 'tarjeta_manual' end,
                              'personas', m.personas, 'creditos', m.creditos,
                              'miembro', public.club_nombre_limpio(mi.nombre),
                              'pedido', m.pos_ref->>'pedido', 'area', m.pos_ref->>'area', 'mesa', m.pos_ref->>'mesa',
                              'total_crc', (m.pos_ref->>'total')::numeric, 'hora_escaneo', m.pos_ref->>'hora',
                              'registradores', jsonb_build_array(m.registrado_por),
                              'factura_elegida', cm.numero_factura, 'elegida_en', cm.elegido_en,
                              'elegida_por', (select p.full_name from public.profiles p where p.id = cm.elegido_por))
      from mv m
      join public.club_miembros mi on mi.id = m.miembro_id
      left join public.club_cruces_manuales cm on cm.movimiento_id = m.id
     where m.fecha_visita >= v_ini and m.fecha_visita < v_fin
       and m.pos_ref->>'modo' = 'pedido'
       and cardinality(m.auto_ids) = 0
       and not public.club_cruce_provisional(p_location, m.pos_ref)   -- S0: cobrada (R), falta el cierre de caja
       and m.registrado_en < now() - make_interval(mins => v_cfg.puente_latencia_min)
       and (now() >= (m.pos_ref->>'hora')::timestamptz + interval '18 hours'
            or not exists (select 1 from public.pos_ndf_open o where o.local = p_location and o.id_pedido = m.pos_ref->>'pedido'))
    union all
    -- AMBIGUA: una por factura (aunque la vean varios registros), con los pedidos del Club que la tocan
    select 'AMBIGUA', 'ambigua:' || ltrim(t.numero_factura, '0'), min(m.fecha_visita), t.numero_factura, 'probable',
           jsonb_build_object('mesa', t.mesa_factura, 'total_crc', t.total_crc, 'hora', t.fecha_registra,
                              'pedidos', jsonb_agg(distinct m.pos_ref->>'pedido'),
                              'registradores', jsonb_agg(distinct m.registrado_por),
                              'miembro', string_agg(distinct public.club_nombre_limpio(mi.nombre), ', '))
      from mv m
      join public.club_miembros mi on mi.id = m.miembro_id
      cross join lateral public.club_cruce_detalle(p_location, m.pos_ref, m.factura_pos) d
      join public.pos_ndf_tickets t on t.id = d.ticket_id
     where m.pos_ref->>'modo' = 'pedido' and d.rol = 'ambigua' and m.fecha_visita >= v_ini and m.fecha_visita < v_fin
     group by t.id, t.numero_factura, t.mesa_factura, t.total_crc, t.fecha_registra
    union all
    -- VISITA_REPETIDA (CLUB-AUD-02): mismo miembro, misma factura principal, más de una tarjeta
    select 'VISITA_REPETIDA', 'visita:' || v.miembro_id || ':' || ltrim(t.numero_factura, '0'), v.f, t.numero_factura, 'exacta',
           jsonb_build_object('tarjetas', v.n, 'personas', v.personas, 'miembro', public.club_nombre_limpio(mi.nombre),
                              'registradores', v.registradores,
                              'mesa', coalesce(t.mesa_factura, t.mesa), 'pax', t.pax)
      from (select m.miembro_id, m.ticket_ids[1] as principal, count(*) as n, sum(m.personas) as personas, min(m.fecha_visita) as f,
                   jsonb_agg(distinct m.registrado_por) as registradores
              from mv m
             where m.tipo = 'tarjeta' and cardinality(m.ticket_ids) > 0 and m.fecha_visita >= v_ini and m.fecha_visita < v_fin
             group by 1, 2 having count(*) > 1) v
      join public.pos_ndf_tickets t on t.id = v.principal
      join public.club_miembros mi on mi.id = v.miembro_id
    union all
    -- PERSONAS_SOBRE_PAX (CLUB-AUD-02): Σ personas de todas las tarjetas de la visita (todos los referentes)
    -- contra el pax DEL PEDIDO, nunca el de cada factura: en una cuenta dividida las facturas sin pedido llegan
    -- con pax 0 o con parte de los artículos de pax (677/678). Pax del pedido = el mayor entre las Personas
    -- del pedido (pax_nativo de la factura principal) y la suma del pax de todas las facturas de la visita
    -- (principal + divididas). Pax 0 = desconocido: no se compara.
    select 'PERSONAS_SOBRE_PAX', 'pax:' || ltrim(t.numero_factura, '0'), v.f, t.numero_factura, 'probable',
           jsonb_build_object('personas', v.personas, 'pax', x.pax, 'pax_personas_pedido', t.pax_nativo, 'pax_facturas', x.pax_facturas,
                              'tarjetas', v.n, 'referentes', v.miembros, 'mesa', coalesce(t.mesa_factura, t.mesa),
                              'registradores', v.registradores)
      from (select m.ticket_ids[1] as principal,
                   count(*) as n, sum(m.personas) as personas, min(m.fecha_visita) as f,
                   string_agg(distinct public.club_nombre_limpio(mi.nombre), ', ') as miembros,
                   jsonb_agg(distinct m.registrado_por) as registradores
              from mv m join public.club_miembros mi on mi.id = m.miembro_id
             where m.tipo = 'tarjeta' and cardinality(m.ticket_ids) > 0 and m.fecha_visita >= v_ini and m.fecha_visita < v_fin
             group by 1) v
      join public.pos_ndf_tickets t on t.id = v.principal
      cross join lateral (select greatest(coalesce(t.pax_nativo, 0), coalesce(sum(z.pax), 0)) as pax, coalesce(sum(z.pax), 0) as pax_facturas
                            from public.pos_ndf_tickets z
                           where z.id in (select unnest(m2.ticket_ids) from mv m2
                                           where m2.tipo = 'tarjeta' and m2.ticket_ids[1] = v.principal)) x
     where x.pax > 0 and v.personas > x.pax
    union all
    -- CREDITOS_SIN_CANJE (heurística: cxc múltiplo de medio crédito)
    select 'CREDITOS_SIN_CANJE', 'factura:' || t.clave, t.f, t.numero_factura, 'probable',
           jsonb_build_object('cxc_crc', t.cxc, 'creditos_estimados', round(t.cxc / v_cfg.valor_credito_crc, 1), 'total_crc', t.total_crc)
      from tk t
     where t.cxc > 0 and t.cxc % (v_cfg.valor_credito_crc / 2.0) = 0
       and not exists (select 1 from mv m where m.tipo = 'canje' and t.id = any(m.ticket_ids))
    union all
    -- CANJE_MONTO_DISTINTO (por visita: Σ créditos × valor vs Σ cxc de sus facturas, principal + divididas)
    select 'CANJE_MONTO_DISTINTO', 'factura:' || ltrim(t.numero_factura, '0'), c.f, t.numero_factura, 'probable',
           jsonb_build_object('canje_crc', c.valor, 'cxc_crc', x.cxc, 'diferencia_crc', c.valor - x.cxc,
                              'creditos', c.creditos, 'miembro', c.miembro, 'mesa', coalesce(t.mesa_factura, t.mesa), 'total_crc', x.total,
                              'facturas', x.n, 'registradores', c.registradores)
      from (select m.ticket_ids, min(m.fecha_visita) as f,
                   sum(m.creditos * m.valor_credito_crc) as valor, sum(m.creditos) as creditos,
                   string_agg(distinct public.club_nombre_limpio(mi.nombre), ', ') as miembro,
                   jsonb_agg(distinct m.registrado_por) as registradores
              from mv m join public.club_miembros mi on mi.id = m.miembro_id
             where m.tipo = 'canje' and cardinality(m.ticket_ids) > 0 and m.fecha_visita >= v_ini and m.fecha_visita < v_fin
             group by m.ticket_ids) c
      join public.pos_ndf_tickets t on t.id = c.ticket_ids[1]
      cross join lateral (select coalesce(sum(coalesce(z.cxc_crc, 0)), 0) as cxc, sum(z.total_crc) as total, count(*) as n
                            from public.pos_ndf_tickets z where z.id = any(c.ticket_ids)) x
     where abs(c.valor - x.cxc) > 1
    union all
    -- PROMO_SIN_CUPON (apagada mientras no haya artículo marcador)
    select 'PROMO_SIN_CUPON', 'factura:' || t.clave, t.f, t.numero_factura, 'exacta',
           jsonb_build_object('articulo', v_cfg.promo_articulo_codigo, 'total_crc', t.total_crc)
      from tk t
     where v_cfg.promo_articulo_codigo is not null
       and exists (select 1 from public.pos_ndf_ticket_lines l where l.ticket_id = t.id and l.codigo_producto = v_cfg.promo_articulo_codigo)
       and not exists (select 1 from mv m where m.tipo = 'tarjeta' and t.id = any(m.ticket_ids))
    union all
    -- CUPON_SIN_PROMO (R-02, apagada mientras no haya artículo marcador): cupón usado cuyas facturas de la
    -- visita (principal + divididas) no tienen el artículo de la promo: dio personas sin descuento aplicado.
    select 'CUPON_SIN_PROMO', 'cupon:' || m.cupon_id, m.fecha_visita, t.numero_factura, 'exacta',
           jsonb_build_object('articulo', v_cfg.promo_articulo_codigo, 'cupon', c.codigo, 'personas', m.personas,
                              'miembro', public.club_nombre_limpio(mi.nombre), 'facturas', cardinality(m.ticket_ids),
                              'mesa', coalesce(t.mesa_factura, t.mesa), 'total_crc', t.total_crc,
                              'registradores', jsonb_build_array(m.registrado_por))
      from mv m
      join public.club_miembros mi on mi.id = m.miembro_id
      join public.club_cupones c on c.id = m.cupon_id
      join public.pos_ndf_tickets t on t.id = m.ticket_ids[1]
     where v_cfg.promo_articulo_codigo is not null
       and m.cupon_id is not null and cardinality(m.ticket_ids) > 0
       and m.registrado_en < now() - make_interval(mins => v_cfg.puente_latencia_min)
       and m.fecha_visita >= v_ini and m.fecha_visita < v_fin
       and not exists (select 1 from public.pos_ndf_ticket_lines l
                        where l.ticket_id = any(m.ticket_ids) and l.codigo_producto = v_cfg.promo_articulo_codigo)
    union all
    -- R02 (ronda 5): sin el código del artículo de la promo, las dos verificaciones NO pueden correr. En vez de
    -- desaparecer (que se lee como «ok»), sale una fila por verificación en «pendiente de configuración». No se
    -- resuelve con nota: se resuelve cargando club_config.promo_articulo_codigo.
    select x.tipo, 'config:promo_articulo_codigo', now(), null::text, 'pendiente_configuracion',
           jsonb_build_object('estado', 'pendiente_configuracion', 'falta', 'promo_articulo_codigo',
                              'texto', 'Falta el código del artículo «PROMO CLUB 10%» del PoS: esta verificación no corre hasta cargarlo')
      from (values ('PROMO_SIN_CUPON'), ('CUPON_SIN_PROMO')) x(tipo)
     where v_cfg.promo_articulo_codigo is null
    union all
    -- TARJETA_MANUAL (CLUB-AUD-26): toda tarjeta física cargada a mano. Siempre visible; no la resuelve quien la cargó.
    select 'TARJETA_MANUAL', m.id::text, m.fecha_visita, rf.ref_factura, 'exacta',
           jsonb_build_object('movimiento', 'tarjeta_manual', 'personas', m.personas, 'miembro', public.club_nombre_limpio(mi.nombre),
                              'cargada_por', (select p.full_name from public.profiles p where p.id = m.registrado_por),
                              'registradores', jsonb_build_array(m.registrado_por))
      from mv0 m join public.club_miembros mi on mi.id = m.miembro_id
      left join lateral (select coalesce(m.factura_pos,
                    case m.pos_ref->>'modo'
                      when 'pedido'  then concat('pedido ', m.pos_ref->>'pedido', coalesce(' · área ' || (m.pos_ref->>'area'), ''),
                                                 coalesce(' · mesa ' || (m.pos_ref->>'mesa'), ''))
                      when 'factura' then m.pos_ref->>'numero_factura' end) as ref_factura) rf on true
     where m.tipo = 'tarjeta' and m.cupon_id is null and m.fecha_visita >= v_ini and m.fecha_visita < v_fin
    union all
    -- CANJE_SIN_CODIGO (R-01): canje sin celular aprobado por owner o manager. Siempre visible; no lo resuelve quien lo aprobó.
    select 'CANJE_SIN_CODIGO', m.id::text, m.fecha_visita, coalesce(m.factura_pos, m.pos_ref->>'numero_factura', 'pedido ' || (m.pos_ref->>'pedido')), 'exacta',
           jsonb_build_object('movimiento', 'canje', 'creditos', m.creditos, 'miembro', public.club_nombre_limpio(mi.nombre),
                              'motivo', substr(m.nota, length('Canje aprobado sin código: ') + 1),
                              'aprobado_por', (select p.full_name from public.profiles p where p.id = m.registrado_por),
                              'registradores', jsonb_build_array(m.registrado_por))
      from mv0 m join public.club_miembros mi on mi.id = m.miembro_id
     where m.tipo = 'canje' and m.nota like 'Canje aprobado sin código:%' and m.fecha_visita >= v_ini and m.fecha_visita < v_fin
    union all
    -- ═══ LC-A5 ═══
    -- LC_SIN_REGISTRO: factura C con el 856 sin visita de socio que la cruce
    select 'LC_SIN_REGISTRO', 'lc:' || t.clave, t.f, t.numero_factura, 'exacta',
           jsonb_build_object('articulos', (select jsonb_agg(distinct ln.codigo_producto) from ln where ln.ticket_id = t.id and ln.es_lc),
                              'mesa', t.mesa, 'total_crc', t.total_crc, 'pos_logins', to_jsonb(t.pos_logins), 'turno', t.turno, 'logins_fijos', to_jsonb(t.logins_fijos))
      from tk t
     where t.estado = 'C' and t.f < now() - make_interval(mins => v_cfg.puente_latencia_min)
       and (v_cfg.lc_excepciones_desde is null or t.f >= v_cfg.lc_excepciones_desde::timestamp at time zone 'America/Costa_Rica')
       and exists (select 1 from ln where ln.ticket_id = t.id and ln.es_lc)
       and not exists (select 1 from vs where t.id = any(vs.ticket_ids))
    union all
    -- REGISTRO_LC_SIN_856: visita con beneficio cuya factura (ya cruzada) no tiene el 856
    select 'REGISTRO_LC_SIN_856', 'visita:' || v.id, v.registrada_en, t.numero_factura, 'exacta',
           jsonb_build_object('miembro', public.club_nombre_limpio(mi.nombre), 'beneficio', v.aplicar->>'texto',
                              'registradores', jsonb_build_array(v.registrado_por))
      from vs v join public.club_miembros mi on mi.id = v.miembro_id
      join public.pos_ndf_tickets t on t.id = v.ticket_ids[1]
     where v.registrada_en >= v_ini and v.registrada_en < v_fin and cardinality(v.ticket_ids) > 0
       and v.estado_beneficio = 'aplica' and t.estado = 'C'
       and not exists (select 1 from public.pos_ndf_ticket_lines l where l.ticket_id = any(v.ticket_ids)
                         and l.codigo_producto in (v_cfg.lc_articulo_codigo, v_cfg.lc_invitado_codigo))
    union all
    -- CANJE_CON_DESCUENTO: pagada con créditos y con 856, PROMO CLUB o una cortesía
    select 'CANJE_CON_DESCUENTO', 'canje-desc:' || t.clave, t.f, t.numero_factura, 'exacta',
           jsonb_build_object('cxc_crc', t.cxc, 'turno', t.turno, 'pos_logins', to_jsonb(t.pos_logins), 'logins_fijos', to_jsonb(t.logins_fijos), 'con', (select jsonb_agg(distinct case when ln.es_lc then 'LC' when ln.es_promo then 'PROMO'
                                                                                   when ln.marcador is not null then ln.marcador else 'cortesia' end)
                                                      from ln where ln.ticket_id = t.id and (ln.es_lc or ln.es_promo or ln.marcador is not null or ln.es_cortesia or ln.es_seccion)),
                              'registradores', (select coalesce(jsonb_agg(distinct m.registrado_por), '[]'::jsonb) from mv m where m.tipo = 'canje' and t.id = any(m.ticket_ids)))
      from tk t
     where t.estado = 'C'
       and (v_cfg.lc_excepciones_desde is null or t.f >= v_cfg.lc_excepciones_desde::timestamp at time zone 'America/Costa_Rica')
       and (t.cxc > 0 or exists (select 1 from mv m where m.tipo = 'canje' and t.id = any(m.ticket_ids)))
       and exists (select 1 from ln where ln.ticket_id = t.id and (ln.es_lc or ln.es_promo or ln.marcador is not null or ln.es_cortesia or ln.es_seccion))
    union all
    -- DESCUENTO_SIN_RESPALDO (ver el encabezado): una por factura, la línea con más descuento
    (select distinct on (c.tid) 'DESCUENTO_SIN_RESPALDO', 'desc:' || t.clave, t.f, t.numero_factura, 'probable',
           jsonb_build_object('articulo', c.cod, 'nombre', c.nombre, 'precio', c.u, 'referencia', c.ref,
                              'descuento_pct', round(100 * (1 - c.u / c.ref), 1), 'pos_logins', to_jsonb(t.pos_logins), 'turno', t.turno, 'logins_fijos', to_jsonb(t.logins_fijos),
                              'marcador_pct', to_jsonb(c.mk_pcts),
                              -- (08-nov) monto estimado de la línea y su CLASIFICACIÓN: el tipo por porcentaje más cercano del local
                              -- (±1,5 puntos). Sin tipo = «sin clasificar», la alarma real.
                              'descuento_crc', round((c.ref - c.u) * c.q),
                              'clasificacion', (select dt.nombre from public.club_descuentos_tipo dt
                                                 where dt.location_id = p_location and dt.activo
                                                   and abs(100 * (1 - c.u / c.ref) - dt.pct) <= 1.5
                                                 order by abs(100 * (1 - c.u / c.ref) - dt.pct), dt.pct limit 1))
      from (select k.*, r.ref
              from dcand k
              join dref r on r.cod = k.cod and r.dia = k.dia
             where k.u < r.ref * 0.99
               -- cambio de lista: si ese día ≥ 60 % de las ventas del artículo van a ese precio (o menos), es el precio nuevo
               and (select sum(q.n) filter (where q.u <= k.u * 1.001)::numeric / nullif(sum(q.n), 0)
                      from ddia q where q.cod = k.cod and q.dia = k.dia) < 0.6
               -- LC-MD: con un marcador de % esperado, el descuento que coincide (±1,5 puntos) está respaldado
               and (k.mk_pcts is null or not exists (select 1 from unnest(k.mk_pcts) x(p)
                                                       where abs(100 * (1 - k.u / r.ref) - x.p) <= 1.5))) c
      join tk t on t.id = c.tid
     order by c.tid, c.u / c.ref)
    union all
    -- SOCIO_USO_ANOMALO: dos mesas el mismo día. CLUB COMPARTIDO (08-nov): cuenta las visitas del socio en TODOS los
    -- locales (vsa) y sale en cada local donde tuvo una de esas visitas; dice en qué locales.
    select 'SOCIO_USO_ANOMALO', 'socio-dia:' || v.miembro_id || ':' || v.fecha, min(v.registrada_en), null, 'probable',
           jsonb_build_object('miembro', public.club_nombre_limpio(min(mi.nombre)), 'motivo', 'dos mesas el mismo día',
                              'mesas', jsonb_agg(distinct v.pos_ref->>'mesa'), 'locales', jsonb_agg(distinct v.location_id),
                              'registradores', jsonb_agg(distinct v.registrado_por))
      from vsa v join public.club_miembros mi on mi.id = v.miembro_id
     where v.registrada_en >= v_ini and v.registrada_en < v_fin
     group by v.miembro_id, v.fecha
    having count(distinct v.location_id || ':' || coalesce(v.pos_ref->>'mesa', v.visita_clave)) > 1
       and bool_or(v.location_id = p_location)
    union all
    -- SOCIO_USO_ANOMALO: más de N visitas en la semana (en todos los locales)
    select 'SOCIO_USO_ANOMALO', 'socio-semana:' || v.miembro_id || ':' || to_char(v.fecha, 'IYYY-IW'), min(v.registrada_en), null, 'probable',
           jsonb_build_object('miembro', public.club_nombre_limpio(min(mi.nombre)), 'motivo', 'muchas visitas en la semana',
                              'visitas', count(*), 'maximo', v_cfg.socio_visitas_semana_max, 'locales', jsonb_agg(distinct v.location_id),
                              'registradores', jsonb_agg(distinct v.registrado_por))
      from vsa v join public.club_miembros mi on mi.id = v.miembro_id
     where v.registrada_en >= v_ini and v.registrada_en < v_fin
     group by v.miembro_id, to_char(v.fecha, 'IYYY-IW')
    having count(*) > v_cfg.socio_visitas_semana_max and bool_or(v.location_id = p_location)
    union all
    -- CUPON_AUTOREFERIDO: cupón usado en una visita (misma clave o misma factura) donde su anfitrión es socio
    select 'CUPON_AUTOREFERIDO', 'autoref:' || m.id, m.fecha_visita, m.ref_factura, 'exacta',
           jsonb_build_object('miembro', public.club_nombre_limpio(mi.nombre), 'personas', m.personas,
                              'registradores', jsonb_build_array(m.registrado_por))
      from mv m join public.club_miembros mi on mi.id = m.miembro_id
     where m.tipo = 'tarjeta' and m.cupon_id is not null and m.fecha_visita >= v_ini and m.fecha_visita < v_fin
       and exists (select 1 from vs where vs.miembro_id = m.miembro_id
                    and (vs.visita_clave = m.visita_clave or vs.ticket_ids && m.ticket_ids))
    union all
    -- CORTESIA_DISTINTA: en las facturas de la visita, un artículo de la sección distinto del sorteado, o más
    select 'CORTESIA_DISTINTA', 'cort-dist:' || v.id, v.registrada_en, null, 'exacta',
           jsonb_build_object('miembro', public.club_nombre_limpio(mi.nombre),
                              'sorteadas', (select coalesce(jsonb_agg(x->>'codigo'), '[]'::jsonb) from jsonb_array_elements(v.cortesias) x),
                              'cobradas', (select jsonb_agg(ln.codigo_producto) from ln where ln.ticket_id = any(v.ticket_ids) and ln.es_seccion),
                              'registradores', jsonb_build_array(v.registrado_por))
      from vs v join public.club_miembros mi on mi.id = v.miembro_id
     where (select ok from seccion_ok) and v.registrada_en >= v_ini and v.registrada_en < v_fin and cardinality(v.ticket_ids) > 0
       and ((select count(*) from ln where ln.ticket_id = any(v.ticket_ids) and ln.es_seccion) > jsonb_array_length(v.cortesias)
            or exists (select 1 from ln where ln.ticket_id = any(v.ticket_ids) and ln.es_seccion
                        and ln.codigo_producto not in (select x->>'codigo' from jsonb_array_elements(v.cortesias) x)))
    union all
    -- CORTESIA_SIN_SOCIO: artículo de la sección en una factura sin visita de socio
    select 'CORTESIA_SIN_SOCIO', 'cort-sin-socio:' || t.clave, t.f, t.numero_factura, 'exacta',
           jsonb_build_object('articulos', (select jsonb_agg(ln.codigo_producto) from ln where ln.ticket_id = t.id and ln.es_seccion), 'mesa', t.mesa,
                              'pos_logins', to_jsonb(t.pos_logins), 'turno', t.turno, 'logins_fijos', to_jsonb(t.logins_fijos))
      from tk t
     where (select ok from seccion_ok) and t.estado = 'C' and t.f < now() - make_interval(mins => v_cfg.puente_latencia_min)
       -- (08-nov) la sección se usa también fuera del Club hasta el lanzamiento: cuenta SOLO desde lc_excepciones_desde
       and v_cfg.lc_excepciones_desde is not null and t.f >= v_cfg.lc_excepciones_desde::timestamp at time zone 'America/Costa_Rica'
       and exists (select 1 from ln where ln.ticket_id = t.id and ln.es_seccion)
       and not exists (select 1 from vs where t.id = any(vs.ticket_ids))
    union all
    -- CORTESIA_NO_CONFIGURADA: línea a ₡0 fuera de la sección (ni PAX, ni LC, ni PROMO, ni las permitidas)
    select 'CORTESIA_NO_CONFIGURADA', 'cort-nc:' || t.clave, t.f, t.numero_factura, 'probable',
           jsonb_build_object('articulos', (select jsonb_agg(jsonb_build_object('codigo', ln.codigo_producto, 'nombre', ln.nombre))
                                              from ln where ln.ticket_id = t.id and ln.monto = 0 and ln.cantidad > 0 and not ln.es_pax
                                               and not ln.es_seccion and not ln.es_lc and not ln.es_promo
                                               and not (coalesce(ln.codigo_producto, '') = any(v_cfg.articulos_cero_permitidos))),
                              'mesa', t.mesa, 'pos_logins', to_jsonb(t.pos_logins), 'turno', t.turno, 'logins_fijos', to_jsonb(t.logins_fijos))
      from tk t
     where (select ok from seccion_ok) and t.estado = 'C'
       and (v_cfg.lc_excepciones_desde is null or t.f >= v_cfg.lc_excepciones_desde::timestamp at time zone 'America/Costa_Rica')
       and exists (select 1 from ln where ln.ticket_id = t.id and ln.monto = 0 and ln.cantidad > 0 and not ln.es_pax
                    and not ln.es_seccion and not ln.es_lc and not ln.es_promo
                    and not (coalesce(ln.codigo_producto, '') = any(v_cfg.articulos_cero_permitidos)))
    union all
    -- Sin la sección configurada, las tres de cortesía no pueden correr: «pendiente de configuración» (nunca «ok»)
    select x.tipo, 'config:cortesia_club', now(), null::text, 'pendiente_configuracion',
           jsonb_build_object('estado', 'pendiente_configuracion', 'falta', 'cortesia_familia',
                              'texto', 'Falta la sección «CORTESÍA CLUB» del PoS (familia o artículos): esta verificación no corre hasta cargarla')
      from (values ('CORTESIA_DISTINTA'), ('CORTESIA_SIN_SOCIO'), ('CORTESIA_NO_CONFIGURADA')) x(tipo)
     where not (select ok from seccion_ok)
    union all
    -- ANFITRION_SOBRE_TOPE: ganado en el mes (tarjetas + pendientes) por encima del tope
    select 'ANFITRION_SOBRE_TOPE', 'tope:' || g.miembro_id || ':' || to_char(g.mes, 'YYYY-MM'), g.ultimo, null, 'exacta',
           jsonb_build_object('miembro', public.club_nombre_limpio(mi.nombre), 'mes', to_char(g.mes, 'YYYY-MM'),
                              'ganado_crc', round(g.personas * v_cfg.valor_credito_crc / v_cfg.personas_por_credito),
                              'tope_crc', v_cfg.anfitrion_tope_mes_crc, 'pendientes', g.pend,
                              'registradores', coalesce(to_jsonb(g.regs), '[]'::jsonb))
      from (select x.miembro_id, x.mes, sum(x.personas) as personas, sum(x.pend) as pend, max(x.f) as ultimo,
                   array_remove(array_agg(distinct x.reg), null) as regs
              from (select m.miembro_id, date_trunc('month', m.fecha_visita at time zone 'America/Costa_Rica') as mes, m.personas, 0 as pend, m.fecha_visita as f,
                           m.registrado_por as reg
                      from public.club_movimientos m
                     where m.location_id = p_location and m.tipo = 'tarjeta' and m.personas > 0 and m.fecha_visita >= v_ini and m.fecha_visita < v_fin
                       -- 155 (D5, 14-nov): la carga inicial (origen 'migracion') no cuenta para el tope, como en el reporte del mes
                       and m.origen <> 'migracion'
                    union all
                    select pp.miembro_id, date_trunc('month', pp.fecha_visita at time zone 'America/Costa_Rica'), pp.personas, pp.personas, pp.fecha_visita,
                           pp.registrado_por
                      from public.club_personas_pendientes pp
                     where pp.location_id = p_location and pp.estado = 'pendiente' and pp.fecha_visita >= v_ini and pp.fecha_visita < v_fin) x
             group by x.miembro_id, x.mes) g
      join public.club_miembros mi on mi.id = g.miembro_id
     where v_cfg.anfitrion_tope_mes_crc > 0
       and g.personas * v_cfg.valor_credito_crc / v_cfg.personas_por_credito > v_cfg.anfitrion_tope_mes_crc
    union all
    -- SOCIO_ALTA_SIN_CONFIRMAR: alta provisional que nadie distinto confirmó (vigente o ya vencida)
    select 'SOCIO_ALTA_SIN_CONFIRMAR', 'alta:' || r.miembro_id, coalesce(r.validado_en, r.desde), null, 'exacta',
           jsonb_build_object('miembro', public.club_nombre_limpio(mi.nombre), 'alta_por', r.alta_por, 'estado', r.estado,
                              'provisional_hasta', r.provisional_hasta,
                              'cargada_por', (select p.full_name from public.profiles p where p.id = r.registrado_por),
                              'registradores', jsonb_build_array(r.registrado_por))
      from public.club_miembro_roles r join public.club_miembros mi on mi.id = r.miembro_id
     where mi.location_id = p_location and r.rol = 'socio' and r.registrado_por is not null and r.confirmado_en is null
       and r.estado in ('activo','pendiente') and coalesce(r.validado_en, r.desde) >= v_ini and coalesce(r.validado_en, r.desde) < v_fin
  ),
  -- LC-A5: con p_tipo, solo esa verificación (el planificador descarta las otras ramas; lo usa la segregación)
  ex as (select * from ex0 where p_tipo is null or ex0.tipo = p_tipo)
  select ex.tipo, ex.ref, ex.fecha, ex.factura, ex.certeza,
         ex.detalle || case when r.id is null then '{}'::jsonb
                            else jsonb_build_object('resuelta_por', (select p.full_name from public.profiles p where p.id = r.resuelto_por)) end,
         r.id is not null, r.nota, r.resuelto_en
    from ex
    left join lateral (select x.* from public.club_excepciones_resueltas x
                        where x.location_id = p_location and x.tipo = ex.tipo and x.ref = ex.ref
                        order by x.resuelto_en desc, x.id desc limit 1) r on true
   order by ex.fecha desc;
end;
$$;

revoke all on function public.club_excepciones(date, date, text, text) from public, anon, authenticated;
grant execute on function public.club_excepciones(date, date, text, text) to authenticated;

-- Verificación (si algo no quedó como se espera, aborta y no queda nada)
do $$
declare v_src text;
begin
  select p.prosrc into v_src from pg_proc p where p.oid = 'public.club_excepciones(date,date,text,text)'::regprocedure;
  if position($q$and m.origen <> 'migracion'$q$ in v_src) = 0 then
    raise exception '155: club_excepciones no tiene el filtro de la carga inicial';
  end if;
  if not (select prosecdef from pg_proc where oid = 'public.club_excepciones(date,date,text,text)'::regprocedure) then
    raise exception '155: club_excepciones tiene que ser SECURITY DEFINER';
  end if;
  if has_function_privilege('anon', 'public.club_excepciones(date,date,text,text)', 'EXECUTE') then
    raise exception '155: anon no puede ejecutar club_excepciones';
  end if;
  if not has_function_privilege('authenticated', 'public.club_excepciones(date,date,text,text)', 'EXECUTE') then
    raise exception '155: authenticated tiene que poder ejecutar club_excepciones';
  end if;
end
$$;

commit;
