-- ╔══════════════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 160 (origen 106) — Club → Tablero: «¿El Club deja plata?» y pasivo de créditos (Fase 1B).        ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════════════╝
--
-- ⚠ Esquema (una columna nueva en club_config) y una función que lee plata: no se mergea sin el OK del dueño. Creada
-- como 106 (bloque CLUB); prod va por la 155, así que va al bloque de PASE con origen 106 (regla 3). La 156 es del #174,
-- la 157 del #176 (D7) y la 158 del #177; la 159 es de otro PR.
--
-- SPEC Club v2 (14-nov), ítems 3, 4 y 5:
--   3 · «¿El Club deja plata?» por mes y local: venta respaldada, descuento ESTIMADO por línea, cortesías A COSTO (% del
--       owner, inicial 35 %), créditos canjeados × valor del crédito del movimiento, tasa efectiva; facturas con socio
--       contra sin socio. Una factura cuenta una vez.
--   4 · Pasivo de créditos del mes: saldo inicial → emitidos → canjeados → vencidos → ajustes → saldo final (personas,
--       créditos y colones). El equipo (y lo congelado por D7) va fuera, en una línea aparte.
--   5 · El contador lo lee: totales, sin nombres ni contactos.
--
-- ── QUÉ HACE ───────────────────────────────────────────────────────────────────────────────────
--   · club_config.cortesia_costo_pct numeric(5,2), default 35, 0–100. La edita solo el owner (policy club_config_update de
--     la 150, sin cambios) y queda en club_config_historial (trigger club_config_auditar de la 150, sin cambios). No toca
--     el pase (club_config_pase_evento solo mira valor y tasa del crédito).
--   · public.club_tablero_mes(p_mes date, p_location text default null) → jsonb. SECURITY DEFINER, search_path fijo.
--     Rol adentro: owner, manager o contador ACTIVOS (get_my_role() da null con la cuenta inactiva: 069, como la 093/095),
--     y el local tiene que estar en mis_locales() (091). Deja rastro en club_auditoria (quién, mes y local; sin datos).
--     Devuelve SOLO totales: ningún nombre, código, teléfono, correo ni número de factura.
--
-- ── DEFINICIONES (las mismas que ya usa la app) ────────────────────────────────────────────────
--   · Mes: hora de Costa Rica ([día 1 00:00, día 1 del mes siguiente) en America/Costa_Rica).
--   · Factura del mes: pos_ndf_tickets del local en estado C (cerrada), por coalesce(fecha_registra, fecha_cierra). Una
--     anulada (X) o provisional (R) no cuenta (decisión del dueño 14-nov: la anulada queda anulada).
--   · Venta neta de una factura: Σ monto de sus líneas, menos las familias 6, 17 y 20 (src/modules/ventas/netaVenta.ts,
--     firmado por el dueño). Es la que cuadra con la «Venta Neta» del reporte del PoS. Incluye lo regalado.
--   · Venta COBRADA (decisión del dueño 14-nov, base de la tasa): neta − regalia_crc de la factura (mínimo 0). Así un canje
--     o una cortesía que el PoS registra como regalía no cuenta a la vez como costo y como venta. La neta va al lado.
--   · Factura del Club (venta respaldada): factura del mes que cruza con un registro del Club del local: visita de socio
--     (club_visitas_socio), cupón usado (club_movimientos tarjeta con cupón) o canje (club_movimientos canje). El cruce es
--     el de Excepciones (club_cruce_facturas, o la factura elegida a mano en club_cruces_manuales). La factura se cuenta
--     UNA vez aunque tenga varios motivos.
--   · Descuento ESTIMADO: el PoS manda descuento_crc en cero, así que se estima por línea con las MISMAS reglas que
--     DESCUENTO_SIN_RESPALDO (club_excepciones): referencia = el precio unitario más vendido (moda; empate → el más alto)
--     de los 30 días anteriores en facturas C SIN marcador (y, acá, fuera del Club); la línea cuenta si está > 1 % por
--     debajo de la referencia y del precio más alto del período, y NO es cambio de lista (si ese día ≥ 60 % de las
--     ventas del artículo, sin las respaldadas del todo y sin las del Club, van a ese precio o menos, es la lista nueva).
--     Descuento = (referencia − cobrado) × cantidad. Sin referencia, la línea no se estima (se cuenta aparte). Lo que
--     NO se copia de Excepciones: allá se descartan las facturas con marcador o cupón (están respaldadas); acá son
--     justamente las del Club.
--   · Cortesías: líneas de la sección de cortesías (cortesia_familia o club_cortesias) a ₡0 en facturas del Club. Valor de
--     lista = la misma referencia (o el precio de la línea si no hay); a costo = lista × cortesia_costo_pct.
--   · Canjes: club_movimientos canje del local en el mes, créditos × valor_credito_crc del movimiento.
--   · Tasa efectiva = (descuento estimado + cortesías a costo + canjes) ÷ venta respaldada COBRADA.
--   · Regalía (decisión del dueño 14-nov: lo no cobrado va como regalía en el PoS): Σ regalia_crc de las facturas del
--     Club. Se muestra aparte y NO se suma al costo (ya está en canjes y cortesías): sirve para conciliar con el PoS.
--   · Pasivo: Σ personas de club_movimientos del local (el libro de solo inserción), créditos = personas ÷ personas por
--     crédito del movimiento, colones = créditos × valor del crédito DE CADA MOVIMIENTO (decisión del dueño 14-nov: sin
--     revaluación; si el valor del crédito cambia, el saldo en ₡ deja de ser créditos × valor vigente). «Congelado» (fuera del pasivo): las
--     cuentas de tipo equipo y, con la 157 (D7), lo registrado hasta el último corte del equipo (club_auditoria
--     accion 'equipo_corte'). Sin la 157 no hay cortes y solo sale el tipo equipo. Funciona con y sin la 157.
--
-- ── LO QUE NO TOCA ─────────────────────────────────────────────────────────────────────────────
--   · Ninguna tabla de plata ni del PoS, ningún saldo, ningún movimiento. Solo lectura (más la fila de auditoría).
--   · Ninguna función existente. Ni sagrados, ni caja, ni Edge.
--
-- Pruebas: scripts/sql/160_pruebas.sql (transacción con rollback; corre en Postgres 16 local y en staging).
-- Rollback: scripts/sql/160_rollback.sql.

begin;

alter table public.club_config add column if not exists cortesia_costo_pct numeric(5,2) not null default 35
  check (cortesia_costo_pct >= 0 and cortesia_costo_pct <= 100);
comment on column public.club_config.cortesia_costo_pct is
  'Tablero del Club: % del precio de lista que cuesta una cortesía (costo de producto). Lo edita el owner; queda en club_config_historial. Inicial 35 (decisión del dueño, 14-nov).';

create or replace function public.club_tablero_mes(p_mes date, p_location text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol   public.user_role := public.get_my_role();
  v_cfg   public.club_config%rowtype;
  v_mes   date;
  v_ini   timestamptz;
  v_fin   timestamptz;
  v_corte date := date_trunc('month', (now() at time zone 'America/Costa_Rica'))::date;
  r       jsonb;
begin
  -- Rol primero (antes de decir si el local existe). get_my_role() es null sin sesión o con la cuenta inactiva.
  if v_rol is null or v_rol not in ('owner','manager','contador') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if p_mes is null then
    raise exception 'Mes no válido' using errcode = 'P0001';
  end if;
  p_location := public.club_local(p_location, false);   -- LC-ML: el local sale de datos (club_config)
  if not public.puede_ver_local(p_location) then        -- 091: el manager ve solo sus locales
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  select * into v_cfg from public.club_config c where c.location_id = p_location;
  v_mes := date_trunc('month', p_mes)::date;
  v_ini := v_mes::timestamp at time zone 'America/Costa_Rica';
  v_fin := (v_mes + interval '1 month')::timestamp at time zone 'America/Costa_Rica';

  perform public.club_auditar('ver_tablero', 'club_tablero_mes', null, null,
    jsonb_build_object('mes', to_char(v_mes, 'YYYY-MM'), 'local', p_location));

  with
  -- Facturas cerradas del mes en el local (hora CR)
  tk as (
    select t.id, coalesce(t.pax, 0) as pax, coalesce(t.regalia_crc, 0) as regalia,
           coalesce(t.fecha_registra, t.fecha_cierra) as f
      from public.pos_ndf_tickets t
     where t.local = p_location and t.estado = 'C'
       and coalesce(t.fecha_registra, t.fecha_cierra) >= v_ini
       and coalesce(t.fecha_registra, t.fecha_cierra) < v_fin),
  neta as (
    select l.ticket_id, sum(l.monto) filter (where l.familia is null or l.familia not in (6, 17, 20)) as neta
      from public.pos_ndf_ticket_lines l join tk on tk.id = l.ticket_id
     group by l.ticket_id),
  -- Registros del Club del local (± 1 día: la factura del borde decide el mes) y sus facturas
  reg as (
    select 'socio'::text as motivo, x.tid
      from public.club_visitas_socio v
      cross join lateral unnest(public.club_cruce_facturas(v.location_id, v.pos_ref, null)) as x(tid)
     where v.location_id = p_location
       and v.registrada_en >= v_ini - interval '1 day' and v.registrada_en < v_fin + interval '1 day'
    union all
    select case when m.tipo = 'canje' then 'canje' else 'cupon' end, x.tid
      from public.club_movimientos m
      left join public.club_cruces_manuales cm on cm.movimiento_id = m.id
      left join public.pos_ndf_tickets cm_t on cm_t.local = p_location and cm_t.numero_factura = cm.numero_factura
      cross join lateral unnest(case when cm_t.id is not null then array[cm_t.id]
                                     else public.club_cruce_facturas(p_location, m.pos_ref, m.factura_pos) end) as x(tid)
     where m.location_id = p_location and m.origen = 'app'
       and (m.tipo = 'canje' or (m.tipo = 'tarjeta' and m.cupon_id is not null))
       and (m.factura_pos is not null or m.pos_ref is not null)
       and m.fecha_visita >= v_ini - interval '1 day' and m.fecha_visita < v_fin + interval '1 day'),
  fl as (
    select tid, bool_or(motivo = 'socio') as socio, bool_or(motivo = 'cupon') as cupon, bool_or(motivo = 'canje') as canje
      from reg where tid is not null group by tid),
  -- Una fila por factura del mes: una factura cuenta una vez
  fa as (
    select tk.id, tk.pax, tk.regalia, tk.f, coalesce(n.neta, 0) as neta,
           -- venta COBRADA (decisión del dueño 14-nov): la neta menos lo regalado. Un canje o una cortesía que el PoS
           -- registra como regalía no suma a la vez como costo (abajo) y como venta.
           greatest(coalesce(n.neta, 0) - tk.regalia, 0) as cobrada,
           (fl.tid is not null) as club, coalesce(fl.socio, false) as socio,
           coalesce(fl.cupon, false) as cupon, coalesce(fl.canje, false) as canje
      from tk left join neta n on n.ticket_id = tk.id left join fl on fl.tid = tk.id),
  -- ── Descuento estimado: las MISMAS reglas que DESCUENTO_SIN_RESPALDO de club_excepciones (150/155: dmk, dpr, dday,
  -- ddia, dref), aplicadas a las líneas de las facturas del Club. Si se cambia una, se cambia la otra (la batería 160
  -- compara las dos sobre los mismos datos: caso 9b).
  -- Facturas con un marcador de descuento activo (856, 857, PROMO, tarjetas de hotel…); «total» = alguno sin % esperado
  mk as materialized (
    select z.ticket_id as tid, bool_or(k.pct_esperado is null) as total
      from public.pos_ndf_ticket_lines z join public.pos_ndf_tickets t on t.id = z.ticket_id
      join public.club_marcadores_descuento k on k.location_id = p_location and k.activo and k.codigo_producto = z.codigo_producto
     where t.local = p_location and t.estado = 'C'
       and t.fecha_registra >= v_ini - interval '31 days' and t.fecha_registra < v_fin
     group by z.ticket_id),
  -- Precios unitarios cobrados de los 30 días anteriores y del mes, por artículo, día y precio, con sus marcas
  pr as materialized (
    select l.codigo_producto as cod, (t.fecha_registra at time zone 'America/Costa_Rica')::date as dia,
           round(l.monto / l.cantidad, 2) as u,
           (k.tid is not null) as con_mk, coalesce(k.total, false) as mk_total,
           exists (select 1 from fl where fl.tid = t.id) as club,
           count(*) as n
      from public.pos_ndf_ticket_lines l join public.pos_ndf_tickets t on t.id = l.ticket_id
      left join mk k on k.tid = t.id
     where t.local = p_location and t.estado = 'C'
       and t.fecha_registra >= v_ini - interval '31 days' and t.fecha_registra < v_fin
       and l.cantidad > 0 and l.monto > 0 and not coalesce(l.es_cortesia, false) and not coalesce(l.es_pax, false)
       and l.codigo_producto is not null
     group by 1, 2, 3, 4, 5, 6),
  -- dday: base de la referencia (sin marcador; además, fuera del Club)
  dday as (select cod, dia, u, sum(n) as n from pr where not con_mk and not club group by 1, 2, 3),
  -- ddia: regla del cambio de lista: todas las ventas del día salvo las respaldadas del todo (marcador sin %) y, acá,
  -- las del Club (si no, un socio que pidió el artículo solo ese día haría «lista nueva» de su propio descuento)
  ddia as (select cod, dia, u, sum(n) as n from pr where not mk_total and not club group by 1, 2, 3),
  umax as (select cod, max(u) as umax from pr where not con_mk and not club group by cod),
  -- Líneas de las facturas del Club, marcadas
  lc as (
    select l.codigo_producto as cod, l.cantidad, l.monto, l.precio, (fa.f at time zone 'America/Costa_Rica')::date as dia,
           fa.id as tid,
           coalesce(l.es_cortesia, false) as es_cortesia, coalesce(l.es_pax, false) as es_pax,
           (coalesce(v_cfg.cortesia_familia is not null and l.familia = v_cfg.cortesia_familia, false)
             or exists (select 1 from public.club_cortesias c where c.location_id = p_location and c.codigo_producto = l.codigo_producto)) as es_seccion,
           -- coalesce: sin PROMO cargada (promo_articulo_codigo null) el «in» daría null y la línea se perdería
           coalesce(l.codigo_producto in (v_cfg.lc_articulo_codigo, v_cfg.lc_invitado_codigo, v_cfg.promo_articulo_codigo), false)
             or exists (select 1 from public.club_marcadores_descuento k
                         where k.location_id = p_location and k.activo and k.codigo_producto = l.codigo_producto) as es_marca
      from public.pos_ndf_ticket_lines l join fa on fa.id = l.ticket_id
     where fa.club),
  -- Referencia: la moda de los 30 días anteriores al día de la línea (empate → el precio más alto)
  ref as (
    select distinct on (z.cod, z.dia) z.cod, z.dia, z.u as ref
      from (select d.cod, d.dia, p.u, sum(p.n) as n
              from (select distinct cod, dia from lc where cod is not null) d
              join dday p on p.cod = d.cod and p.dia >= d.dia - 30 and p.dia < d.dia
             group by d.cod, d.dia, p.u) z
     order by z.cod, z.dia, z.n desc, z.u desc),
  -- Cada línea candidata con su referencia y la parte de las ventas del día a ese precio o menos (cambio de lista)
  dl as (
    select x.tid, x.cantidad, round(x.monto / x.cantidad, 2) as u, r.ref, m.umax,
           (select sum(q.n) filter (where q.u <= round(x.monto / x.cantidad, 2) * 1.001)::numeric / nullif(sum(q.n), 0)
              from ddia q where q.cod = x.cod and q.dia = x.dia) as parte_dia
      from lc x left join ref r on r.cod = x.cod and r.dia = x.dia left join umax m on m.cod = x.cod
     where x.cantidad > 0 and x.monto > 0 and x.cod is not null
       and not x.es_cortesia and not x.es_pax and not x.es_seccion and not x.es_marca),
  dsc as (
    select dl.*, (dl.ref is not null and dl.u < dl.ref * 0.99 and dl.u < dl.umax * 0.99
                  -- cambio de lista: si ese día ≥ 60 % de las ventas (fuera del Club) van a ese precio o menos, es precio nuevo
                  and coalesce(dl.parte_dia, 0) < 0.6) as es_desc
      from dl),
  ds as (
    select coalesce(sum((ref - u) * cantidad) filter (where es_desc), 0) as crc,
           count(*) filter (where es_desc) as lineas,
           count(distinct tid) filter (where es_desc) as facturas,
           count(*) filter (where ref is null) as sin_referencia
      from dsc),
  ct as (
    select count(*) as lineas, coalesce(sum(x.cantidad), 0) as unidades,
           coalesce(sum(coalesce(r.ref, nullif(x.precio, 0)) * x.cantidad), 0) as lista_crc,
           count(*) filter (where r.ref is null and coalesce(x.precio, 0) <= 0) as sin_precio
      from lc x left join ref r on r.cod = x.cod and r.dia = x.dia
     where x.es_seccion and coalesce(x.monto, 0) = 0 and x.cantidad > 0),
  cj as (
    select count(*) as canjes, coalesce(sum(m.creditos), 0) as creditos,
           coalesce(sum(m.creditos * m.valor_credito_crc), 0) as crc
      from public.club_movimientos m
     where m.location_id = p_location and m.tipo = 'canje' and m.fecha_visita >= v_ini and m.fecha_visita < v_fin),
  -- ── Pasivo: el libro del local, con cada movimiento en «pasivo» o «congelado» ─────────────────────────────────────
  cortes as (
    select a.objeto_id as miembro_id, max(a.en) as corte
      from public.club_auditoria a where a.accion = 'equipo_corte' and a.objeto_id is not null group by a.objeto_id),
  lb as (
    select m.tipo as mtipo, v.tipo, v.origen, v.personas, v.fecha_visita,
           v.personas::numeric / v.personas_por_credito as cr,
           v.personas::numeric / v.personas_por_credito * v.valor_credito_crc as crc,
           (m.tipo = 'equipo' or (k.corte is not null and v.registrado_en <= k.corte)) as congelado,
           v.miembro_id
      from public.club_movimientos v
      join public.club_miembros m on m.id = v.miembro_id
      left join cortes k on k.miembro_id = v.miembro_id
     where v.location_id = p_location and v.fecha_visita < v_fin),
  pz as (
    select
      coalesce(sum(personas) filter (where fecha_visita < v_ini), 0) as ini_p,
      coalesce(sum(cr)       filter (where fecha_visita < v_ini), 0) as ini_cr,
      coalesce(sum(crc)      filter (where fecha_visita < v_ini), 0) as ini_crc,
      coalesce(sum(personas) filter (where fecha_visita >= v_ini and tipo = 'tarjeta' and origen = 'app'), 0) as em_p,
      coalesce(sum(cr)       filter (where fecha_visita >= v_ini and tipo = 'tarjeta' and origen = 'app'), 0) as em_cr,
      coalesce(sum(crc)      filter (where fecha_visita >= v_ini and tipo = 'tarjeta' and origen = 'app'), 0) as em_crc,
      coalesce(sum(personas) filter (where fecha_visita >= v_ini and tipo = 'tarjeta' and origen <> 'app'), 0) as ci_p,
      coalesce(sum(cr)       filter (where fecha_visita >= v_ini and tipo = 'tarjeta' and origen <> 'app'), 0) as ci_cr,
      coalesce(sum(crc)      filter (where fecha_visita >= v_ini and tipo = 'tarjeta' and origen <> 'app'), 0) as ci_crc,
      coalesce(sum(personas) filter (where fecha_visita >= v_ini and tipo = 'canje'), 0) as cj_p,
      coalesce(sum(cr)       filter (where fecha_visita >= v_ini and tipo = 'canje'), 0) as cj_cr,
      coalesce(sum(crc)      filter (where fecha_visita >= v_ini and tipo = 'canje'), 0) as cj_crc,
      coalesce(sum(personas) filter (where fecha_visita >= v_ini and tipo = 'vencimiento'), 0) as ve_p,
      coalesce(sum(cr)       filter (where fecha_visita >= v_ini and tipo = 'vencimiento'), 0) as ve_cr,
      coalesce(sum(crc)      filter (where fecha_visita >= v_ini and tipo = 'vencimiento'), 0) as ve_crc,
      coalesce(sum(personas) filter (where fecha_visita >= v_ini and tipo in ('ajuste','restitucion')), 0) as aj_p,
      coalesce(sum(cr)       filter (where fecha_visita >= v_ini and tipo in ('ajuste','restitucion')), 0) as aj_cr,
      coalesce(sum(crc)      filter (where fecha_visita >= v_ini and tipo in ('ajuste','restitucion')), 0) as aj_crc,
      coalesce(sum(personas), 0) as fin_p, coalesce(sum(cr), 0) as fin_cr, coalesce(sum(crc), 0) as fin_crc
      from lb where not congelado),
  -- Lo canjeable al cierre, cuenta por cuenta (club_creditos redondea a medio crédito): la diferencia con el saldo final
  -- son las personas que todavía no completan medio crédito.
  pc as (
    select coalesce(sum(public.club_creditos(greatest(s.p, 0), v_cfg.personas_por_credito)), 0) as canjeable_cr,
           count(*) filter (where s.p > 0) as cuentas
      from (select miembro_id, sum(personas) as p from lb where not congelado group by miembro_id) s),
  cg as (
    select coalesce(sum(personas), 0) as p, coalesce(sum(cr), 0) as cr, coalesce(sum(crc), 0) as crc,
           count(distinct miembro_id) filter (where true) as cuentas
      from lb where congelado),
  -- Totales del mes
  t as (
    select count(*) as facturas, coalesce(sum(cobrada), 0) as venta, coalesce(sum(neta), 0) as venta_neta,
           coalesce(sum(neta) filter (where club), 0) as club_neta,
           count(*) filter (where club) as club_f, coalesce(sum(cobrada) filter (where club), 0) as club_v,
           coalesce(sum(pax) filter (where club), 0) as club_pax,
           count(*) filter (where socio) as socio_f, coalesce(sum(cobrada) filter (where socio), 0) as socio_v,
           coalesce(sum(pax) filter (where socio), 0) as socio_pax,
           count(*) filter (where not socio) as nosocio_f, coalesce(sum(cobrada) filter (where not socio), 0) as nosocio_v,
           coalesce(sum(pax) filter (where not socio), 0) as nosocio_pax,
           count(*) filter (where cupon) as cupon_f, coalesce(sum(cobrada) filter (where cupon), 0) as cupon_v,
           coalesce(sum(pax) filter (where cupon), 0) as cupon_pax,
           count(*) filter (where canje) as canje_f, coalesce(sum(cobrada) filter (where canje), 0) as canje_v,
           count(*) filter (where club and regalia > 0) as reg_f,
           coalesce(sum(regalia) filter (where club), 0) as reg_crc,
           coalesce(sum(regalia) filter (where canje), 0) as reg_canje_crc
      from fa)
  select jsonb_build_object(
    'mes', to_char(v_mes, 'YYYY-MM'), 'local', p_location,
    'local_nombre', coalesce(v_cfg.nombre, v_cfg.location_id),
    'parcial', v_mes >= v_corte,
    'generado_en', now(),
    'pos_sin_datos', t.facturas = 0,
    'config', jsonb_build_object('cortesia_costo_pct', v_cfg.cortesia_costo_pct, 'valor_credito_crc', v_cfg.valor_credito_crc,
                                 'personas_por_credito', v_cfg.personas_por_credito),
    'plata', jsonb_build_object(
      'venta_respaldada_crc', round(t.club_v),            -- cobrada: neta − regalía (base de la tasa)
      'venta_respaldada_neta_crc', round(t.club_neta),    -- neta de Ventas, de referencia (incluye lo regalado)
      'facturas_club', t.club_f,
      'facturas_mes', t.facturas,
      'venta_mes_crc', round(t.venta),
      'venta_mes_neta_crc', round(t.venta_neta),
      'descuento_estimado_crc', round(ds.crc),
      'descuento_lineas', ds.lineas, 'descuento_facturas', ds.facturas, 'lineas_sin_referencia', ds.sin_referencia,
      'cortesias_lineas', ct.lineas, 'cortesias_unidades', ct.unidades,
      'cortesias_lista_crc', round(ct.lista_crc),
      'cortesias_costo_crc', round(ct.lista_crc * v_cfg.cortesia_costo_pct / 100),
      'cortesias_sin_precio', ct.sin_precio,
      'canjes', cj.canjes, 'creditos_canjeados', cj.creditos, 'canjes_crc', round(cj.crc),
      'costo_total_crc', round(ds.crc) + round(ct.lista_crc * v_cfg.cortesia_costo_pct / 100) + round(cj.crc),
      'tasa_efectiva_pct', case when t.club_v > 0
        then round(100 * (round(ds.crc) + round(ct.lista_crc * v_cfg.cortesia_costo_pct / 100) + round(cj.crc)) / t.club_v, 1) end,
      'por_motivo', jsonb_build_object(
        'socio', jsonb_build_object('facturas', t.socio_f, 'venta_crc', round(t.socio_v)),
        'cupon', jsonb_build_object('facturas', t.cupon_f, 'venta_crc', round(t.cupon_v)),
        'canje', jsonb_build_object('facturas', t.canje_f, 'venta_crc', round(t.canje_v)))),
    'regalia', jsonb_build_object('facturas', t.reg_f, 'crc', round(t.reg_crc), 'en_canjes_crc', round(t.reg_canje_crc)),
    'comparacion', jsonb_build_object(
      'con_socio', jsonb_build_object('facturas', t.socio_f, 'venta_crc', round(t.socio_v), 'personas', t.socio_pax,
                                      'tiquete_crc', case when t.socio_f > 0 then round(t.socio_v / t.socio_f) end,
                                      'personas_por_factura', case when t.socio_f > 0 then round(t.socio_pax::numeric / t.socio_f, 1) end,
                                      'por_persona_crc', case when t.socio_pax > 0 then round(t.socio_v / t.socio_pax) end),
      'sin_socio', jsonb_build_object('facturas', t.nosocio_f, 'venta_crc', round(t.nosocio_v), 'personas', t.nosocio_pax,
                                      'tiquete_crc', case when t.nosocio_f > 0 then round(t.nosocio_v / t.nosocio_f) end,
                                      'personas_por_factura', case when t.nosocio_f > 0 then round(t.nosocio_pax::numeric / t.nosocio_f, 1) end,
                                      'por_persona_crc', case when t.nosocio_pax > 0 then round(t.nosocio_v / t.nosocio_pax) end),
      'con_cupon', jsonb_build_object('facturas', t.cupon_f, 'venta_crc', round(t.cupon_v), 'personas', t.cupon_pax,
                                      'tiquete_crc', case when t.cupon_f > 0 then round(t.cupon_v / t.cupon_f) end,
                                      'personas_por_factura', case when t.cupon_f > 0 then round(t.cupon_pax::numeric / t.cupon_f, 1) end,
                                      'por_persona_crc', case when t.cupon_pax > 0 then round(t.cupon_v / t.cupon_pax) end)),
    'pasivo', jsonb_build_object(
      'saldo_inicial', jsonb_build_object('personas', pz.ini_p, 'creditos', round(pz.ini_cr, 1), 'crc', round(pz.ini_crc)),
      'emitidos',      jsonb_build_object('personas', pz.em_p,  'creditos', round(pz.em_cr, 1),  'crc', round(pz.em_crc)),
      'carga_inicial', jsonb_build_object('personas', pz.ci_p,  'creditos', round(pz.ci_cr, 1),  'crc', round(pz.ci_crc)),
      'canjeados',     jsonb_build_object('personas', pz.cj_p,  'creditos', round(pz.cj_cr, 1),  'crc', round(pz.cj_crc)),
      'vencidos',      jsonb_build_object('personas', pz.ve_p,  'creditos', round(pz.ve_cr, 1),  'crc', round(pz.ve_crc)),
      'ajustes',       jsonb_build_object('personas', pz.aj_p,  'creditos', round(pz.aj_cr, 1),  'crc', round(pz.aj_crc)),
      'saldo_final',   jsonb_build_object('personas', pz.fin_p, 'creditos', round(pz.fin_cr, 1), 'crc', round(pz.fin_crc)),
      'canjeable_creditos', pc.canjeable_cr, 'cuentas_con_saldo', pc.cuentas,
      'congelado', jsonb_build_object('personas', cg.p, 'creditos', round(cg.cr, 1), 'crc', round(cg.crc), 'cuentas', cg.cuentas))
  ) into r
  from t, ds, ct, cj, pz, pc, cg;
  return r;
end;
$$;

revoke all on function public.club_tablero_mes(date, text) from public, anon, authenticated;
grant execute on function public.club_tablero_mes(date, text) to authenticated;

comment on function public.club_tablero_mes(date, text) is
  'Club → Tablero (160): ¿el Club deja plata? y pasivo de créditos, por mes (hora CR) y local. owner, manager y contador activos; solo totales, sin datos personales; deja rastro en club_auditoria.';

-- Verificación: la función existe, es SECURITY DEFINER con search_path fijo, anon no la ejecuta y la columna tiene su
-- CHECK. Si algo no está, aborta.
do $$
declare v_p pg_proc%rowtype;
begin
  select * into v_p from pg_proc where oid = 'public.club_tablero_mes(date, text)'::regprocedure;
  if not v_p.prosecdef then raise exception '160: club_tablero_mes no es SECURITY DEFINER'; end if;
  if not exists (select 1 from unnest(v_p.proconfig) c where c like 'search_path=%') then
    raise exception '160: club_tablero_mes sin search_path fijo';
  end if;
  if has_function_privilege('anon', 'public.club_tablero_mes(date, text)', 'execute') then
    raise exception '160: anon puede ejecutar club_tablero_mes';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'club_config' and column_name = 'cortesia_costo_pct') then
    raise exception '160: falta club_config.cortesia_costo_pct';
  end if;
end $$;

commit;
