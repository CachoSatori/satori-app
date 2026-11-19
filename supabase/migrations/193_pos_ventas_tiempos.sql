-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 193 · Ventas v2 «Tiempos»: horas de todos los canales, tiempo sentado y mesas internas ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- Decisiones del dueño, 18-nov-2026 13:08 -06:00 (la firma final va sobre el SHA del PR, #294 «294 B»).
-- El NÚMERO se fija al mergear: hay otros PRs con migración en curso. Si al mergear 193 ya está tomado, se
-- renumera al siguiente libre del bloque de pase (archivo, rollback, pruebas, registro y ESTADO en el mismo PR).
--
-- NO toca la 190 ni la 191: agrega una tabla y dos funciones HERMANAS de solo lectura. Por eso no lleva guarda
-- de md5 (R13 aplica al REEMPLAZAR una función viva) y es re-ejecutable.
--
-- 1. `pos_mesas_internas` (local, mesa): las mesas INTERNAS de cada local (dueños, regalías, errores). Valor
--    inicial: 51, 52 y 53 en santa-teresa. Decisión del dueño (18-nov 13:45): sus facturas SON VENTA («si se
--    cerraron con IVA es porque se vendió») y siguen en todo (Contabilidad, venta por persona, promedios, horas,
--    meta). Solo salen del TIEMPO SENTADO y de la ALERTA de mesas sin pax: ahí no se sientan clientes ni se cargan
--    personas. La edita el owner (Ajustes → «Mesas internas»);
--    la leen owner, manager y contador activos. La mesa se compara sin espacios ni ceros a la izquierda contra
--    la mesa del pedido (`mesa`) Y la de la factura (`mesa_factura`): basta con que una coincida. El área no se
--    mira (las mesas internas tienen número propio).
--
-- 2. `pos_ventas_internas(p_local, p_desde, p_hasta)` → jsonb, lista de facturas C de mesas internas en la
--    MISMA ventana que la 190 ([desde − 1 día, hasta + 2 días) por `fecha_registra`, hora CR):
--      [id, dia, hora, canal, neta_cts, pax]
--    La app marca esas facturas (`interna`) y las saca SOLO de la alerta de mesas sin pax.
--
-- 3. `pos_ventas_tiempos(p_local, p_desde, p_hasta)` → jsonb:
--    · `horas`    — por (día CR de la factura, hora CR), SOLO de [desde, hasta], TODOS los canales (mesas internas
--                   incluidas: son venta): [dia, hora, neta_cts, facturas, pax]. Misma neta que la 190 (Σ por
--                   factura de round(₡ × 100)), así Σ horas del día = `neta_cts` del día de la 190, al céntimo.
--    · `sentados` — tiempo que la gente está sentada, por tamaño de mesa: [tamano, n, mediana_min, promedio_min].
--                   Tamaños: '2' = 1–2 personas · '4' = 3–4 · '6' = 5–6 · '7+' = 7 o más.
--                   Unidad = el PEDIDO (`numero_pedido` + `pedido_abierto_en`, la clave completa: el número se
--                   reinicia cada día). Una mesa grande que se parte en varias facturas es UN pedido: dura desde
--                   la apertura hasta el cobro de su ÚLTIMA factura (`fecha_registra`, la hora real de cobro) y
--                   sus personas son la SUMA del pax de sus facturas (el pax por artículo se cobra en una sola
--                   factura; no se repite). Solo salón, sin mesas internas. El pedido cuenta en el día CR de su
--                   último cobro, si cae en [desde, hasta].
--    · `descartes` — {sin_pedido, sin_pax, menos_de_5, mas_de_240, internas}: lo que quedó afuera y por qué.
--                   Sin pedido = cuentas divididas o cobros de caja sin apertura. Menos de 5 min = cobro sin
--                   servicio o error de carga. Más de 240 min (4 h) = pedido que quedó abierto (la mediana medida
--                   en prod el 18-nov es ~62 min: 4 h es casi cuatro veces eso y deja las sobremesas largas).
--
-- REGLAS (las de la 190): solo `estado = 'C'`; día y hora = `fecha_registra AT TIME ZONE 'America/Costa_Rica'`;
-- neta de una factura = Σ monto de sus líneas cuya familia es null o no está en {6, 17, 20}, y sin líneas,
-- `valor_servido_crc`; pax = `pax_articulo` si es > 0, si no `pax`.
-- NO devuelve medios de pago, vuelto, `clase_ingreso`, números de mesa ni nombres (regla 6). No abre `pos_ndf_*`.
-- Permisos: owner / manager / contador ACTIVOS (`get_my_role()` exige `is_active`); el manager, además, solo de
-- sus locales (`puede_ver_local`, 091). El resto → 42501. Rango máximo: 731 días. Devuelve jsonb (sin tope de filas).
--
-- Vuelta atrás: una migración NUEVA hacia adelante (scripts/sql/193_rollback.sql, sin numerar; regla 10).
-- Pruebas: scripts/sql/193_pruebas.sql (transacción que termina en ROLLBACK).

-- ── 1. Mesas internas por local ──────────────────────────────────────────────────────────
create table if not exists public.pos_mesas_internas (
  local      text        not null,
  mesa       text        not null check (mesa ~ '^[1-9][0-9A-Za-z]{0,9}$'),
  creado_en  timestamptz not null default now(),
  creado_por uuid        default auth.uid(),
  primary key (local, mesa)
);
comment on table public.pos_mesas_internas is
  'Mig 193. Mesas internas por local (dueños, regalías, errores): son venta y cuentan en todo; solo salen del tiempo sentado y de la alerta de mesas sin pax. Mesa sin ceros a la izquierda.';

alter table public.pos_mesas_internas enable row level security;

drop policy if exists pos_mesas_internas_leer on public.pos_mesas_internas;
create policy pos_mesas_internas_leer on public.pos_mesas_internas
  for select to authenticated
  using (public.get_my_role() in ('owner', 'manager', 'contador'));

drop policy if exists pos_mesas_internas_agregar on public.pos_mesas_internas;
create policy pos_mesas_internas_agregar on public.pos_mesas_internas
  for insert to authenticated
  with check (public.get_my_role() = 'owner');

drop policy if exists pos_mesas_internas_quitar on public.pos_mesas_internas;
create policy pos_mesas_internas_quitar on public.pos_mesas_internas
  for delete to authenticated
  using (public.get_my_role() = 'owner');

revoke all on table public.pos_mesas_internas from public, anon;
grant select, insert, delete on table public.pos_mesas_internas to authenticated;

insert into public.pos_mesas_internas (local, mesa, creado_por)
values ('santa-teresa', '51', null), ('santa-teresa', '52', null), ('santa-teresa', '53', null)
on conflict (local, mesa) do nothing;

-- ── Helper interno: el portón de las dos funciones ───────────────────────────────────────
create or replace function public.pos_ventas_tiempos_porton(p_local text, p_desde date, p_hasta date)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol public.user_role := public.get_my_role();
begin
  if v_rol is null or v_rol not in ('owner', 'manager', 'contador') then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_local is null or p_desde is null or p_hasta is null or p_hasta < p_desde then
    raise exception 'Parámetros inválidos' using errcode = '22023';
  end if;
  if p_hasta - p_desde > 730 then
    raise exception 'El rango no puede pasar de 731 días' using errcode = '22023';
  end if;
  if v_rol = 'manager' and not public.puede_ver_local(p_local) then
    raise exception 'No autorizado para este local' using errcode = '42501';
  end if;
end
$$;
revoke all on function public.pos_ventas_tiempos_porton(text, date, date) from public, anon, authenticated;
grant execute on function public.pos_ventas_tiempos_porton(text, date, date) to service_role;

-- ── 2. Facturas de mesas internas (la ventana de la 190) ─────────────────────────────────
create or replace function public.pos_ventas_internas(p_local text, p_desde date, p_hasta date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_out jsonb;
begin
  perform public.pos_ventas_tiempos_porton(p_local, p_desde, p_hasta);

  with t as (
    select tk.id, tk.canal, tk.pax, tk.pax_articulo, tk.valor_servido_crc,
           (tk.fecha_registra at time zone 'America/Costa_Rica') as ts_cr
    from public.pos_ndf_tickets tk
    where tk.local = p_local
      and tk.estado = 'C'
      and tk.fecha_registra >= ((p_desde - 1)::timestamp at time zone 'America/Costa_Rica')
      and tk.fecha_registra <  ((p_hasta + 2)::timestamp at time zone 'America/Costa_Rica')
      and exists (select 1 from public.pos_mesas_internas mi   -- en línea (no en una función aparte: el planificador la mete en la consulta)
                  where mi.local = p_local
                    and mi.mesa in (nullif(ltrim(btrim(tk.mesa), '0'), ''), nullif(ltrim(btrim(tk.mesa_factura), '0'), '')))
  ),
  l as (
    select ln.ticket_id, count(*) as n,
           coalesce(sum(ln.monto) filter (where ln.familia is null or ln.familia not in (6, 17, 20)), 0) as neta
    from public.pos_ndf_ticket_lines ln
    where ln.ticket_id = any (array(select id from t))
    group by ln.ticket_id
  )
  select coalesce(jsonb_agg(jsonb_build_array(
           t.id, t.ts_cr::date, extract(hour from t.ts_cr)::int, t.canal,
           floor((case when l.n is null then coalesce(t.valor_servido_crc, 0) else l.neta end) * 100 + 0.5),
           case when coalesce(t.pax_articulo, 0) > 0 then t.pax_articulo else coalesce(t.pax, 0) end)
         order by t.ts_cr, t.id), '[]'::jsonb)
    into v_out
  from t left join l on l.ticket_id = t.id;

  return v_out;
end;
$function$;

revoke all on function public.pos_ventas_internas(text, date, date) from public, anon;
grant execute on function public.pos_ventas_internas(text, date, date) to authenticated;
comment on function public.pos_ventas_internas(text, date, date) is
  'Mig 193. Facturas C de mesas internas (pos_mesas_internas) en la ventana de la 190: [id, dia, hora, canal, neta_cts, pax]. Sin medios de pago. Owner/manager/contador; manager solo sus locales.';

-- ── 3. Horas de todos los canales y tiempo sentado ───────────────────────────────────────
create or replace function public.pos_ventas_tiempos(p_local text, p_desde date, p_hasta date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_out jsonb;
begin
  perform public.pos_ventas_tiempos_porton(p_local, p_desde, p_hasta);

  with t as (
    -- Un día antes y dos después (como la 190): un pedido que cruza la medianoche se ve entero.
    select tk.id, tk.canal, tk.pax, tk.pax_articulo, tk.valor_servido_crc, tk.fecha_registra,
           tk.numero_pedido, tk.pedido_abierto_en,
           (tk.fecha_registra at time zone 'America/Costa_Rica') as ts_cr,
           exists (select 1 from public.pos_mesas_internas mi   -- en línea (no en una función aparte: el planificador la mete en la consulta)
                  where mi.local = p_local
                    and mi.mesa in (nullif(ltrim(btrim(tk.mesa), '0'), ''), nullif(ltrim(btrim(tk.mesa_factura), '0'), ''))) as interna
    from public.pos_ndf_tickets tk
    where tk.local = p_local
      and tk.estado = 'C'
      and tk.fecha_registra >= ((p_desde - 1)::timestamp at time zone 'America/Costa_Rica')
      and tk.fecha_registra <  ((p_hasta + 2)::timestamp at time zone 'America/Costa_Rica')
  ),
  l as (
    select ln.ticket_id, count(*) as n,
           coalesce(sum(ln.monto) filter (where ln.familia is null or ln.familia not in (6, 17, 20)), 0) as neta
    from public.pos_ndf_ticket_lines ln
    where ln.ticket_id = any (array(select id from t))
    group by ln.ticket_id
  ),
  f as (
    select t.*, t.ts_cr::date as dia, extract(hour from t.ts_cr)::int as hora,
           floor((case when l.n is null then coalesce(t.valor_servido_crc, 0) else l.neta end) * 100 + 0.5) as neta_cts,
           case when coalesce(t.pax_articulo, 0) > 0 then t.pax_articulo else coalesce(t.pax, 0) end as pax_d
    from t left join l on l.ticket_id = t.id
  ),
  h as (
    select dia, hora, sum(neta_cts) as neta_cts, count(*) as facturas, sum(pax_d) as pax
    from f
    where dia between p_desde and p_hasta
    group by dia, hora
  ),
  -- Tiempo sentado: salón, por pedido.
  s as (
    select f.* from f where f.canal = 'salon'
  ),
  ped as (
    select s.numero_pedido, s.pedido_abierto_en,
           max(s.fecha_registra) as cobro,
           sum(s.pax_d) as pax,
           bool_or(s.interna) as interna
    from s
    where s.pedido_abierto_en is not null and nullif(btrim(s.numero_pedido), '') is not null
    group by s.numero_pedido, s.pedido_abierto_en
  ),
  pd as (
    select ped.*, extract(epoch from (ped.cobro - ped.pedido_abierto_en)) / 60.0 as minutos,
           case when ped.pax <= 2 then '2' when ped.pax <= 4 then '4' when ped.pax <= 6 then '6' else '7+' end as tamano
    from ped
    where (ped.cobro at time zone 'America/Costa_Rica')::date between p_desde and p_hasta
  ),
  ok as (
    select * from pd where not interna and pax > 0 and minutos >= 5 and minutos <= 240
  ),
  sg as (
    select tamano, count(*) as n,
           percentile_cont(0.5) within group (order by minutos) as mediana,
           avg(minutos) as promedio
    from ok group by tamano
  )
  select jsonb_build_object(
    'horas', coalesce((select jsonb_agg(jsonb_build_array(h.dia, h.hora, h.neta_cts, h.facturas, h.pax)
               order by h.dia, h.hora) from h), '[]'::jsonb),
    'sentados', coalesce((select jsonb_agg(jsonb_build_array(sg.tamano, sg.n, round(sg.mediana::numeric, 1),
               round(sg.promedio::numeric, 1)) order by array_position(array['2', '4', '6', '7+'], sg.tamano))
             from sg), '[]'::jsonb),
    'descartes', jsonb_build_object(
      'sin_pedido', (select count(*) from s
                     where s.dia between p_desde and p_hasta and not s.interna
                       and (s.pedido_abierto_en is null or nullif(btrim(s.numero_pedido), '') is null)),
      'internas',   (select count(*) from pd where interna),
      'sin_pax',    (select count(*) from pd where not interna and pax <= 0),
      'menos_de_5', (select count(*) from pd where not interna and pax > 0 and minutos < 5),
      'mas_de_240', (select count(*) from pd where not interna and pax > 0 and minutos > 240)
    )
  ) into v_out;

  return v_out;
end;
$function$;

revoke all on function public.pos_ventas_tiempos(text, date, date) from public, anon;
grant execute on function public.pos_ventas_tiempos(text, date, date) to authenticated;
comment on function public.pos_ventas_tiempos(text, date, date) is
  'Mig 193. Ventas v2 Tiempos: horas (día × hora CR, todos los canales, céntimos), tiempo sentado por tamaño de mesa (pedido = numero_pedido + pedido_abierto_en; 5–240 min) y descartes. Sin medios de pago. Owner/manager/contador; manager solo sus locales.';
