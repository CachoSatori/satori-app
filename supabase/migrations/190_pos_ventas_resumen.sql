-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 190 · Ventas v2: `pos_ventas_resumen` — el Resumen sin bajar las líneas (origen 134)   ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- Firma del dueño, 18-nov-2026 10:36 -06:00 («1. B firmo»): función nueva de SOLO LECTURA para que
-- Ventas v2 («Resumen», y después «Tiempos») no lea decenas de miles de facturas y líneas en «Año
-- a la fecha» o «Temporada» (hoy ~10–15 s por `pos_ventas_tickets_rango` + `pos_ventas_lineas`).
--
-- `pos_ventas_resumen(p_local, p_desde, p_hasta)` → jsonb con TRES listas, para el MISMO tramo que
-- hoy lee la app (`tramosDeLectura` → `getTicketsRango`, ventana `ventanaRangoJornadas`:
-- [desde − 1 día 00:00 CR, hasta + 2 días 00:00 CR) sobre `fecha_registra`):
--
--   · `dias`     — por día CR de la factura, SOLO de [p_desde, p_hasta]:
--                  [dia, neta_cts, iva_cts, serv_cts, delivery_cts, pax, facturas]
--                  Los *_cts son Σ por factura de round(₡ × 100) (céntimos enteros, como `aCts` de
--                  `armarDia`); la app los redondea UNA vez por día con `getDayStats`, igual que
--                  Contabilidad. `pax` = Σ `paxDelTicket`. `facturas` = facturas C del día.
--   · `facturas` — una por factura de SALÓN (`canal = 'salon'`) de la ventana, en orden
--                  (fecha_registra, id): lo que necesita la venta por persona D4 y la alerta de
--                  mesas sin pax, y nada más:
--                  [id, fecha_registra, salonero_login, pax, pax_articulo, neta, neta_duenos,
--                   total_crc, cajero_login, fecha_cierra]
--                  `neta_duenos` = Σ monto de la familia 28; null si la factura no tiene líneas
--                  (la app decide «mesa de dueños» con `esMesaDeDuenos`, una sola definición).
--   · `lotes`    — una por (caja, cierre) de la ventana, con TODAS las facturas C (salón o no):
--                  [cajero_login, fecha_cierra, apertura]. `apertura` = mínimo `fecha_registra`.
--                  Es lo que necesita `agruparEnLotes` para que el día y el turno de cada factura
--                  sean los de su sesión de caja aunque la primera factura del lote no sea de salón.
--                  Un lote todavía abierto (sin cierre) va por día CR de la venta, como `claveLote`.
--
-- REGLAS (las mismas de la app; las cuida la prueba de paridad del PR):
--   · Solo `estado = 'C'`.
--   · Día = (fecha_registra AT TIME ZONE 'America/Costa_Rica')::date.
--   · Neta de una factura (`netaDelTicket`): Σ monto de sus líneas cuya familia es null o no está en
--     {6, 17, 20}; una factura SIN ninguna línea guardada cuenta `valor_servido_crc` (null = 0).
--   · Pax (`paxDelTicket`): `pax_articulo` si es > 0; si no, `pax` (null = 0).
--   · Delivery = `canal = 'delivery'` (`esDelivery`).
--   · Redondeo a céntimos: floor(x × 100 + 0,5), el `Math.round` de la app (los montos del PoS
--     tienen 2 decimales: medido en prod el 18-nov, escala máxima 2).
--
-- NO devuelve medios de pago, vuelto, `clase_ingreso`, `numero_pedido`, mesas ni nombres (regla 6
-- de ESTADO). No abre `pos_ndf_*`: sin policy nueva. Solo owner / manager / contador ACTIVOS
-- (`get_my_role()` exige `is_active`); cualquier otro → 42501. Igual que la 067 y la 080, no filtra
-- por local para el manager (hoy hay un solo local en el PoS).
--
-- Devuelve jsonb (no `setof`): el tope de filas de PostgREST cortaría un año sin avisar.
-- Rango máximo: 731 días.
--
-- Re-ejecutable. Rollback: scripts/sql/190_rollback.sql.

create or replace function public.pos_ventas_resumen(
  p_local text,
  p_desde date,
  p_hasta date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_rol  public.user_role;
  v_out  jsonb;
begin
  v_rol := public.get_my_role();
  if v_rol is null or v_rol not in ('owner', 'manager', 'contador') then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_local is null or p_desde is null or p_hasta is null or p_hasta < p_desde then
    raise exception 'Parámetros inválidos' using errcode = '22023';
  end if;
  if p_hasta - p_desde > 730 then
    raise exception 'El rango no puede pasar de 731 días' using errcode = '22023';
  end if;

  with t as (
    -- La MISMA ventana que `ventanaRangoJornadas` (un día antes, dos después).
    select tk.id, tk.fecha_registra, tk.fecha_cierra, tk.cajero_login, tk.canal, tk.salonero_login,
           tk.pax, tk.pax_articulo, tk.total_crc, tk.valor_servido_crc, tk.iva_crc, tk.servicio_crc,
           (tk.fecha_registra at time zone 'America/Costa_Rica')::date as dia
    from public.pos_ndf_tickets tk
    where tk.local = p_local
      and tk.estado = 'C'
      and tk.fecha_registra >= ((p_desde - 1)::timestamp at time zone 'America/Costa_Rica')
      and tk.fecha_registra <  ((p_hasta + 2)::timestamp at time zone 'America/Costa_Rica')
  ),
  l as (
    select ln.ticket_id,
           count(*) as n,
           coalesce(sum(ln.monto) filter (where ln.familia is null or ln.familia not in (6, 17, 20)), 0) as neta,
           coalesce(sum(ln.monto) filter (where ln.familia = 28), 0) as neta_duenos
    from public.pos_ndf_ticket_lines ln
    -- `= any (array(...))`: búsqueda por el índice de ticket_id. Con `in (select …)` el planificador
    -- recorría la tabla de líneas entera (medido en prod el 18-nov, un año: 1,7 s contra 0,27 s).
    where ln.ticket_id = any (array(select id from t))
    group by ln.ticket_id
  ),
  f as (
    select t.*,
           case when l.n is null then coalesce(t.valor_servido_crc, 0) else l.neta end as neta,
           case when l.n is null then null else l.neta_duenos end                     as neta_duenos,
           case when coalesce(t.pax_articulo, 0) > 0 then t.pax_articulo else coalesce(t.pax, 0) end as pax_d
    from t left join l on l.ticket_id = t.id
  ),
  d as (
    select f.dia,
           sum(floor(f.neta * 100 + 0.5))                                         as neta_cts,
           sum(floor(coalesce(f.iva_crc, 0) * 100 + 0.5))                         as iva_cts,
           sum(floor(coalesce(f.servicio_crc, 0) * 100 + 0.5))                    as serv_cts,
           coalesce(sum(floor(f.neta * 100 + 0.5)) filter (where f.canal = 'delivery'), 0) as delivery_cts,
           sum(f.pax_d)                                                           as pax,
           count(*)                                                               as facturas
    from f
    where f.dia between p_desde and p_hasta
    group by f.dia
  ),
  lo as (
    -- Por la caja TAL CUAL viene (la app recorta espacios al agrupar: juntar acá sería más grueso,
    -- nunca más fino) y el cierre; abiertos, además por día CR de la venta (`claveLote`).
    select f.cajero_login, f.fecha_cierra, min(f.fecha_registra) as apertura
    from f
    group by f.cajero_login, f.fecha_cierra, case when f.fecha_cierra is null then f.dia end
  )
  select jsonb_build_object(
    'dias', coalesce((select jsonb_agg(jsonb_build_array(
               d.dia, d.neta_cts, d.iva_cts, d.serv_cts, d.delivery_cts, d.pax, d.facturas) order by d.dia)
             from d), '[]'::jsonb),
    'facturas', coalesce((select jsonb_agg(jsonb_build_array(
               f.id, f.fecha_registra, f.salonero_login, f.pax, f.pax_articulo, f.neta, f.neta_duenos,
               f.total_crc, f.cajero_login, f.fecha_cierra) order by f.fecha_registra, f.id)
             from f where f.canal = 'salon'), '[]'::jsonb),
    'lotes', coalesce((select jsonb_agg(jsonb_build_array(lo.cajero_login, lo.fecha_cierra, lo.apertura)
               order by lo.apertura, lo.cajero_login, lo.fecha_cierra)
             from lo), '[]'::jsonb)
  ) into v_out;

  return v_out;
end;
$function$;

revoke all on function public.pos_ventas_resumen(text, date, date) from public, anon;
grant execute on function public.pos_ventas_resumen(text, date, date) to authenticated;

comment on function public.pos_ventas_resumen(text, date, date) is
  'Mig 190 (origen 134). Ventas v2 Resumen: días (céntimos), facturas de salón para la venta por persona D4 y lotes de caja. Sin medios de pago ni clase_ingreso. Solo owner/manager/contador; el resto 42501.';
