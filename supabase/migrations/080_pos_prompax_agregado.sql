-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 080 · Prom/PAX explicado: RPC de agregado de ventas del PoS (SPEC v2.3 §8)            ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- `pos_prompax_agregado(p_local, p_desde, p_hasta)` → jsonb: una fila por
--   (día CR de la factura, franja horaria CR, salonero_login, canal)
-- con facturas, pax y neta. Solo lectura. Solo owner / manager / contador ACTIVOS
-- (`get_my_role()` exige `is_active` desde la 069). Cualquier otro → 42501.
--
-- REGLAS (las mismas de la app; test de contrato contra `netaVenta.ts` con oct-2026):
--   · Solo `estado = 'C'`.
--   · Día = (fecha_registra AT TIME ZONE 'America/Costa_Rica')::date (el de Ventas).
--   · Neta de una factura (`netaDelTicket`): Σ monto de sus líneas cuya familia es null o no está
--     en {6, 17, 20}; una factura SIN ninguna línea guardada cuenta `valor_servido_crc`.
--   · Pax (`paxDelTicket`): `pax_articulo` si es > 0; si no, `pax` (null = 0).
--   · Franja por la HORA CR de la factura: 06–16 'mañana' · 17–23 'noche' · 00–05 'madrugada'.
--     El turno de caja (`pos_ndf_tickets.turno`) NO se usa: está mal anotado (r8/Q27). Qué se hace
--     con la madrugada (noche del mismo día, decisión de Ismael 06/11) lo decide el cliente, en
--     un solo lugar (`ventasPromPaxExplicado.ts`).
--   · `neta_sin_pax` / `tickets_sin_pax`: la parte de la fila que viene de facturas con pax = 0.
-- No devuelve medios de pago, `clase_ingreso`, mesas ni el turno de caja.
--
-- Devuelve jsonb (no `setof`) porque el tope de filas de PostgREST es distinto en cada base
-- (prod 10.000, staging 1.000) y un año son ~6.400 filas: un `setof` se cortaría sin avisar.
-- Rango máximo: 731 días. Rendimiento medido en prod (1 año, 12.477 facturas): ~375 ms con los
-- índices que ya existen (`pos_ndf_tickets_local_fecha_idx`, `pos_ndf_ticket_lines_ticket_idx`).
--
-- Re-ejecutable. Rollback: scripts/sql/080_rollback.sql.

create or replace function public.pos_prompax_agregado(
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
  v_out jsonb;
begin
  if public.get_my_role() is null or public.get_my_role() not in ('owner', 'manager', 'contador') then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_local is null or p_desde is null or p_hasta is null or p_hasta < p_desde then
    raise exception 'Parámetros inválidos' using errcode = '22023';
  end if;
  if p_hasta - p_desde > 730 then
    raise exception 'El rango no puede pasar de 731 días' using errcode = '22023';
  end if;

  with t as (
    select
      tk.id,
      coalesce(tk.canal, 'otro') as canal,
      tk.salonero_login,
      tk.valor_servido_crc,
      (tk.fecha_registra at time zone 'America/Costa_Rica') as ts_cr,
      case when coalesce(tk.pax_articulo, 0) > 0 then tk.pax_articulo else coalesce(tk.pax, 0) end as pax
    from public.pos_ndf_tickets tk
    where tk.local = p_local
      and tk.estado = 'C'
      and tk.fecha_registra >= (p_desde::timestamp at time zone 'America/Costa_Rica')
      and tk.fecha_registra <  ((p_hasta + 1)::timestamp at time zone 'America/Costa_Rica')
  ),
  l as (
    select ln.ticket_id,
           count(*) as n,
           coalesce(sum(ln.monto) filter (where ln.familia is null or ln.familia not in (6, 17, 20)), 0) as neta
    from public.pos_ndf_ticket_lines ln
    where ln.ticket_id in (select id from t)
    group by ln.ticket_id
  ),
  b as (
    select
      t.ts_cr::date as dia,
      case when extract(hour from t.ts_cr) between 6 and 16 then 'mañana'
           when extract(hour from t.ts_cr) between 17 and 23 then 'noche'
           else 'madrugada' end as franja,
      t.salonero_login,
      t.canal,
      t.pax,
      case when l.n is null then coalesce(t.valor_servido_crc, 0) else l.neta end as neta
    from t left join l on l.ticket_id = t.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'dia', g.dia, 'franja', g.franja, 'salonero_login', g.salonero_login, 'canal', g.canal,
           'tickets', g.tickets, 'pax', g.pax, 'neta', g.neta,
           'neta_sin_pax', g.neta_sin_pax, 'tickets_sin_pax', g.tickets_sin_pax)
         order by g.dia, g.franja, g.canal, g.salonero_login), '[]'::jsonb)
    into v_out
  from (
    select dia, franja, salonero_login, canal,
           count(*)                                  as tickets,
           sum(pax)                                  as pax,
           sum(neta)                                 as neta,
           coalesce(sum(neta) filter (where pax = 0), 0) as neta_sin_pax,
           count(*) filter (where pax = 0)           as tickets_sin_pax
    from b
    group by dia, franja, salonero_login, canal
  ) g;

  return v_out;
end;
$function$;

revoke all on function public.pos_prompax_agregado(text, date, date) from public, anon;
grant execute on function public.pos_prompax_agregado(text, date, date) to authenticated;
