-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 194 · Mi Rendimiento: el equipo en AGREGADOS (sin filas ni montos de otras personas)  ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- Pedido del dueño, 18-nov-2026 12:55 -06:00 (opción A; la firma va sobre el SHA final del PR): «quiero que ellos
-- evalúen su propio rendimiento personal […] y poder evaluarlos personalmente además de en equipo».
--
-- Desde la 191 el personal lee SOLO sus facturas; las comparaciones contra el equipo de Mi Rendimiento quedaron
-- ocultas. Esta migración devuelve esas comparaciones calculadas EN LA BASE y entregadas solo como agregados:
--   · pos_mi_rendimiento_equipo(local, desde, hasta) → jsonb: las proporciones del local (venta por PAX D4,
--     comida/PAX, bebidas/PAX, ticket/ítem; también por día de semana y en la misma ventana del año pasado) y, con 4 o
--     más personas, mi posición en ventas («3.º de 7»), la mediana y el promedio del equipo por persona, mi posición en
--     cada indicador y el ICP del equipo. Nunca una fila, un login, un nombre ni un monto de otra persona.
--   · pos_mi_competencia(local, id) → jsonb: en una competencia, mi posición, de cuántos, mis puntos y el líder con su
--     nombre y sus puntos (decisión «A»); la mediana solo con 4 o más participantes.
--
-- Qué sale y cuándo (decisión del dueño 18-nov 13:58, opción C; K = 4):
--   · SIEMPRE: las proporciones del local (venta por PAX D4, comida/PAX, bebidas/PAX, ticket/ítem), también por día
--     de semana y en la misma ventana del año pasado (−364 días, mismo día de semana). Sin plata total, sin PAX total.
--   · SOLO con K o más personas con venta en el período (yo incluido): mi POSICIÓN («2.º de N»), la mediana y el
--     promedio por persona y mi posición en cada indicador, y el ICP del equipo. Con menos, la función NO devuelve esos
--     campos (null) y `motivo = 'grupo_chico'`.
--   · Competencias (decisión «A»): mi posición, mis puntos y el líder CON su nombre y sus puntos; la mediana solo con K.
--   · Los ₡ van redondeados a ₡100, las razones a 2 decimales y el ICP a 1: corta la resta exacta entre consultas
--     parecidas (p. ej. dos rangos que difieren en un día).
--   · Sin percentiles 25/75 a propósito: con 7 personas, mediana + promedio + cuartiles reconstruyen casi a todos.
--
-- Mismas reglas que la app (paridad; la cuida src/shared/api/rendimientoEquipo.contrato194.test.ts):
--   · Día = día CR de `fecha_registra` (ventasDiasDesdePos.ts). Solo facturas `C`.
--   · Neta de la factura (netaVenta.ts, firmada): Σ monto de sus líneas salvo familias 6, 17 y 20 (la línea sin
--     familia cuenta); sin ninguna línea → valor_servido_crc.
--   · Personas (PAX): artículo pax si > 0; si no, `pax` (paxDelTicket).
--   · Mesero = registrado_por 'salonero' y login que no es de sistema (02/002). Su clave es la PERSONA del PoS
--     (personasNdf.ts: 01/235, 023/555, 038/266 son la misma; un código fuera de su vigencia es «login XXXX»).
--   · Comida/bebida: líneas de FAMILIAS_NETO (2, 3, 4, 5, 13, 16, 29) sin el artículo «PAX»; bebida = familia 5;
--     unidades = Math.round(cantidad) por línea. Cada mesero-día redondea su total, su delivery y su comida/bebida
--     como `armarDia`; la caja (los baldes que no son de un mesero) igual, por balde (`claveNoMesero`).
--   · Por persona (aggSalonero): venta por persona D4 = neta de salón ÷ PAX; bebida/PAX con el multiplicador SOLO de
--     las bebidas que clasificó una persona en `product_map` (si no hay ninguna, las de familia); ticket/ítem =
--     neta ÷ (comida + bebida). General (aggGeneral): D4 de todo el salón (meseros + caja) ÷ todo el PAX; bebida/PAX
--     sobre el PAX de meseros; ticket/ítem sin multiplicador.
--   · ICP del equipo (icpEquipoDelMes): Σ propina electrónica (crc + usd × TC de la sesión) de las sesiones cerradas
--     del rango ÷ Σ neta de los meseros × 100. Diferencia a propósito con la app: acá solo las sesiones DEL MISMO
--     local (`tip_sessions.location_id = p_local`); la app sumaba las de todos (hoy hay un solo local).
--   · Diferencia a propósito con aggSalonero: una persona sin PAX (solo delivery) no entra a la mediana ni al
--     promedio de venta por persona / bebida por PAX (la app le pondría 0); sí cuenta en el ranking de ventas.
--
-- Permisos: `security definer`, search_path fijo, rol validado ADENTRO. Personal (salonero, barman, barback, runner,
-- cocina) activo y con login del PoS: los agregados, solo si vendió en el período. owner / contador: cualquier local;
-- manager: sus locales (`mis_locales()`). Cualquier otro rol o inactivo: 42501. anon y public: sin EXECUTE.
-- No lee nada que el usuario no pueda leer hoy por otro lado más que en forma de agregado; no agrega policies
-- (regla 6), no toca `employees` salvo leer `full_name` para resolver los participantes de una competencia.
-- Vuelta atrás: scripts/sql/194_rollback.sql (migración nueva hacia adelante, regla 10). Pruebas por rol:
-- scripts/sql/194_pruebas.sql (+ 194_pruebas.py; transacción que termina en ROLLBACK).
begin;

-- ── 0. Código del PoS → clave de PERSONA (espejo de personasNdf.ts; interno) ────────────────────
-- Solo los códigos con alias o con vigencia; el resto es su propio código. Fuera de la vigencia: «login XXXX».
create or replace function public.pos_persona_clave(p_codigo text, p_dia date)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  with c as (select nullif(btrim(p_codigo), '') as cod),
  m(cod, clave, desde, hasta) as (values
    ('0909', '0909', date '2025-01-07', date '2026-05-09'),
    ('333',  '333',  date '2025-01-01', date '2025-10-22'),
    ('999',  '999',  date '2025-01-01', date '2025-07-02'),
    ('03',   '03',   date '2025-01-01', date '2026-01-18'),
    ('04',   '04',   date '2025-02-23', date '2025-05-07'),
    ('01',   '01',   null::date, null::date),
    ('235',  '01',   null::date, null::date),
    ('023',  '023',  null::date, null::date),
    ('555',  '023',  null::date, null::date),
    ('038',  '038',  null::date, null::date),
    ('266',  '038',  null::date, null::date)
  )
  select case
           when c.cod is null then null
           when m.cod is null then c.cod
           when p_dia is not null and ((m.desde is not null and p_dia < m.desde) or (m.hasta is not null and p_dia > m.hasta))
             then 'login ' || c.cod
           else m.clave
         end
  from c left join m on m.cod = c.cod
$$;
revoke all on function public.pos_persona_clave(text, date) from public, anon, authenticated;
grant execute on function public.pos_persona_clave(text, date) to service_role;
comment on function public.pos_persona_clave(text, date) is
  'Mig 194. Código del PoS → clave de persona (espejo de personasNdf.ts: alias y vigencias). Interno.';

-- ── 1. Base por mesero-día y por balde de caja (interno; SIN EXECUTE para la API) ───────────────
create or replace function public.pos_rend_base(p_local text, p_desde date, p_hasta date)
returns table (
  clave      text,      -- persona (mesero) o balde de caja
  es_mesero  boolean,
  dia        date,
  total      numeric,   -- neta, redondeada por clave-día (como armarDia)
  delivery   numeric,
  pax        numeric,
  com        numeric,
  beb        numeric,
  icom       numeric,
  ibeb       numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with tk as (
    select t.id,
           (t.fecha_registra at time zone 'America/Costa_Rica')::date as dia,
           t.canal, t.registrado_por, t.cajero_login, t.valor_servido_crc,
           case when coalesce(t.pax_articulo, 0) > 0 then t.pax_articulo else coalesce(t.pax, 0) end as pax,
           (t.registrado_por = 'salonero' and t.salonero_login is not null
              and coalesce(nullif(btrim(t.salonero_login), ''), '') not in ('02', '002')) as es_mesero,
           t.salonero_login
    from public.pos_ndf_tickets t
    where t.local = p_local
      and t.estado = 'C'
      and t.fecha_registra >= (p_desde::timestamp at time zone 'America/Costa_Rica')
      and t.fecha_registra <  ((p_hasta + 1)::timestamp at time zone 'America/Costa_Rica')
  ),
  lt as (
    select l.ticket_id,
           count(*) as n,
           coalesce(sum(l.monto) filter (where l.familia is null or l.familia not in (6, 17, 20)), 0) as neta,
           coalesce(sum(l.monto) filter (where l.familia in (2, 3, 4, 13, 16, 29)
                     and upper(btrim(coalesce(l.nombre, l.codigo_producto, ''))) not in ('', 'PAX')), 0) as com,
           coalesce(sum(l.monto) filter (where l.familia = 5
                     and upper(btrim(coalesce(l.nombre, l.codigo_producto, ''))) not in ('', 'PAX')), 0) as beb,
           coalesce(sum(floor(coalesce(l.cantidad, 0) + 0.5)) filter (where l.familia in (2, 3, 4, 13, 16, 29)
                     and upper(btrim(coalesce(l.nombre, l.codigo_producto, ''))) not in ('', 'PAX')), 0) as icom,
           coalesce(sum(floor(coalesce(l.cantidad, 0) + 0.5)) filter (where l.familia = 5
                     and upper(btrim(coalesce(l.nombre, l.codigo_producto, ''))) not in ('', 'PAX')), 0) as ibeb
    from public.pos_ndf_ticket_lines l
    join tk on tk.id = l.ticket_id
    group by l.ticket_id
  ),
  f as (
    select tk.dia, tk.es_mesero, tk.pax,
           case when tk.es_mesero then coalesce(public.pos_persona_clave(tk.salonero_login, tk.dia), '')
                when tk.registrado_por = 'cajero' and tk.canal = 'salon' then '~caja salon'
                when tk.registrado_por = 'cajero' then case when tk.cajero_login = '222' then '~caja tarde' else '~caja manana' end
                when tk.registrado_por = 'sin_pedido' and tk.canal = 'salon' then '~salon sin mesero'
                else '~sistema y otros' end as clave,
           case when coalesce(lt.n, 0) > 0 then lt.neta else coalesce(tk.valor_servido_crc, 0) end as neta,
           tk.canal = 'delivery' as es_delivery,
           coalesce(lt.com, 0) as com, coalesce(lt.beb, 0) as beb, coalesce(lt.icom, 0) as icom, coalesce(lt.ibeb, 0) as ibeb
    from tk left join lt on lt.ticket_id = tk.id
  )
  select f.clave, f.es_mesero, f.dia,
         floor(sum(f.neta) + 0.5),
         floor(coalesce(sum(f.neta) filter (where f.es_delivery), 0) + 0.5),
         sum(f.pax),
         floor(sum(f.com) + 0.5), floor(sum(f.beb) + 0.5),
         sum(f.icom), sum(f.ibeb)
  from f
  group by f.clave, f.es_mesero, f.dia
$$;
revoke all on function public.pos_rend_base(text, date, date) from public, anon, authenticated;
grant execute on function public.pos_rend_base(text, date, date) to service_role;
comment on function public.pos_rend_base(text, date, date) is
  'Mig 194. Base por mesero-día y balde de caja (misma regla que armarDia). Interno: sin EXECUTE para la API.';

-- ── 2. Productos por mesero en un rango (interno): para el multiplicador y las competencias ─────
create or replace function public.pos_rend_productos(p_local text, p_desde date, p_hasta date)
returns table (clave text, prod text, q numeric)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.pos_persona_clave(t.salonero_login, (t.fecha_registra at time zone 'America/Costa_Rica')::date),
         upper(btrim(coalesce(l.nombre, l.codigo_producto, ''))),
         sum(floor(coalesce(l.cantidad, 0) + 0.5))
  from public.pos_ndf_tickets t
  join public.pos_ndf_ticket_lines l on l.ticket_id = t.id
  where t.local = p_local
    and t.estado = 'C'
    and t.fecha_registra >= (p_desde::timestamp at time zone 'America/Costa_Rica')
    and t.fecha_registra <  ((p_hasta + 1)::timestamp at time zone 'America/Costa_Rica')
    and t.registrado_por = 'salonero' and t.salonero_login is not null
    and coalesce(nullif(btrim(t.salonero_login), ''), '') not in ('02', '002')
    and l.familia in (2, 3, 4, 5, 13, 16, 29)
    and upper(btrim(coalesce(l.nombre, l.codigo_producto, ''))) not in ('', 'PAX')
  group by 1, 2
$$;
revoke all on function public.pos_rend_productos(text, date, date) from public, anon, authenticated;
grant execute on function public.pos_rend_productos(text, date, date) to service_role;
comment on function public.pos_rend_productos(text, date, date) is
  'Mig 194. Unidades por mesero y producto en un rango (Math.round por línea). Interno: sin EXECUTE para la API.';

-- ── 3. Quién soy y qué puedo pedir (interno) ────────────────────────────────────────────────────
-- Devuelve las claves de persona del usuario (vacío para gerencia sin login). Corta con 42501 a quien no puede.
create or replace function public.pos_rend_yo(p_local text)
returns text[]
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol text := public.get_my_role();
  v_claves text[];
begin
  if v_rol is null or v_rol not in ('owner', 'contador', 'manager', 'salonero', 'barman', 'barback', 'runner', 'cocina') then
    raise exception 'sin permiso' using errcode = '42501';
  end if;
  if v_rol = 'manager' and not (p_local = any (public.mis_locales())) then
    raise exception 'sin permiso para ese local' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct public.pos_persona_clave(x, null)), array[]::text[])
    into v_claves
  from unnest(public.pos_mis_logins()) x;
  if v_rol in ('salonero', 'barman', 'barback', 'runner', 'cocina') and cardinality(v_claves) = 0 then
    raise exception 'sin login del PoS' using errcode = '42501';
  end if;
  return v_claves;
end
$$;
revoke all on function public.pos_rend_yo(text) from public, anon, authenticated;
grant execute on function public.pos_rend_yo(text) to service_role;

-- ── 4. Los agregados del equipo para Mi Rendimiento (API) ───────────────────────────────────────
-- Una sola consulta (sin tablas temporales: corre igual en una transacción de solo lectura).
create or replace function public.pos_mi_rendimiento_equipo(p_local text, p_desde date, p_hasta date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  k_min constant integer := 4;
  v_yo text[];
  v_gerencia boolean;
  v_out jsonb;
begin
  if p_desde is null or p_hasta is null or p_desde > p_hasta or p_hasta - p_desde > 400 then
    raise exception 'rango inválido (máximo 401 días)' using errcode = '22023';
  end if;
  v_yo := public.pos_rend_yo(p_local);
  v_gerencia := public.get_my_role() in ('owner', 'contador', 'manager');

  with
  base as materialized (select * from public.pos_rend_base(p_local, p_desde, p_hasta)),
  adj as (
    select p.clave, sum(p.q * coalesce(nullif(pm.multiplicador, 0), 1)) as q
    from public.pos_rend_productos(p_local, p_desde, p_hasta) p
    join public.product_map pm on pm.nombre = p.prod and pm.tipo = 'bebida'
    group by p.clave
  ),
  por as materialized (
    select b.clave, count(*)::int as dias, sum(b.total) as total, sum(b.total - b.delivery) as salon,
           sum(b.pax) as pax, sum(b.icom) as icom, sum(b.ibeb) as ibeb
    from base b where b.es_mesero group by b.clave
  ),
  rp as materialized (
    select por.*, case when coalesce(adj.q, 0) <> 0 then adj.q else por.ibeb end as ibeb_adj,
           por.clave = any (v_yo) as soy
    from por left join adj on adj.clave = por.clave
  ),
  pers as materialized (   -- una fila por persona con venta: NUNCA sale de la función como fila
    select soy, total,
           case when pax > 0 then salon / pax end as prom_pax,
           case when pax > 0 then ibeb_adj / pax end as beb_pax,
           case when pax > 0 then icom / pax end as comida_pax,
           case when icom + ibeb_adj > 0 then total / (icom + ibeb_adj) end as prom_ticket,
           case when dias > 0 then pax / dias end as pax_dia
    from rp where total > 0
  ),
  yo as (   -- mis indicadores (pueden ser varias claves si tengo alias: se suman)
    select sum(total) as total,
           case when sum(pax) > 0 then sum(salon) / sum(pax) end as prom_pax,
           case when sum(pax) > 0 then sum(ibeb_adj) / sum(pax) end as beb_pax,
           case when sum(pax) > 0 then sum(icom) / sum(pax) end as comida_pax,
           case when sum(icom + ibeb_adj) > 0 then sum(total) / sum(icom + ibeb_adj) end as prom_ticket,
           case when sum(dias) > 0 then sum(pax) / sum(dias) end as pax_dia
    from rp where soy and total > 0
  ),
  cuenta as (select count(*)::int as n, bool_or(soy) as soy from pers),
  gen as (
    select coalesce(sum(total) filter (where es_mesero), 0) as total,
           coalesce(sum(total - delivery), 0) as salon_todo,
           coalesce(sum(pax), 0) as pax,
           coalesce(sum(pax) filter (where es_mesero), 0) as pax_sal,
           coalesce(sum(icom) filter (where es_mesero), 0) as icom,
           coalesce(sum(ibeb) filter (where es_mesero), 0) as ibeb
    from base
  ),
  -- La misma ventana corrida 364 días (52 semanas: mismo día de semana), solo para las proporciones del local.
  gen_ap as (
    select count(*) as filas,
           coalesce(sum(total) filter (where es_mesero), 0) as total,
           coalesce(sum(total - delivery), 0) as salon_todo,
           coalesce(sum(pax), 0) as pax,
           coalesce(sum(pax) filter (where es_mesero), 0) as pax_sal,
           coalesce(sum(icom) filter (where es_mesero), 0) as icom,
           coalesce(sum(ibeb) filter (where es_mesero), 0) as ibeb
    from public.pos_rend_base(p_local, p_desde - 364, p_hasta - 364)
  ),
  tips as (
    select coalesce(sum(coalesce(e.tip_amount_crc, 0) + coalesce(e.tip_amount_usd, 0) * coalesce(s.exchange_rate, 0)), 0) as gen
    from public.tip_sessions s join public.tip_entries e on e.session_id = s.id
    where s.status = 'closed' and s.location_id = p_local and s.session_date between p_desde and p_hasta
  ),
  dow as (
    select extract(dow from b.dia)::int as dow,
           count(distinct b.clave) filter (where b.es_mesero and b.total > 0) as personas,
           sum(b.total - b.delivery) as salon_todo, sum(b.pax) as pax
    from base b group by 1
  ),
  pos as (   -- mi posición en cada indicador (1 = el mejor); null si no tengo el dato
    select
      case when y.prom_pax    is not null then 1 + (select count(*) from pers p where not p.soy and p.prom_pax    > y.prom_pax)    end as prom_pax,
      case when y.beb_pax     is not null then 1 + (select count(*) from pers p where not p.soy and p.beb_pax     > y.beb_pax)     end as beb_pax,
      case when y.comida_pax  is not null then 1 + (select count(*) from pers p where not p.soy and p.comida_pax  > y.comida_pax)  end as comida_pax,
      case when y.prom_ticket is not null then 1 + (select count(*) from pers p where not p.soy and p.prom_ticket > y.prom_ticket) end as prom_ticket,
      case when y.pax_dia     is not null then 1 + (select count(*) from pers p where not p.soy and p.pax_dia     > y.pax_dia)     end as pax_dia,
      case when y.total       is not null then 1 + (select count(*) from pers p where not p.soy and p.total       > y.total)       end as ventas
    from yo y
  )
  select case
    when not v_gerencia and not coalesce(c.soy, false) then
      jsonb_build_object('desde', p_desde, 'hasta', p_hasta, 'k_min', k_min, 'yo', false, 'personas', null,
                         'motivo', 'sin_ventas')
    else jsonb_build_object(
      'desde', p_desde, 'hasta', p_hasta, 'k_min', k_min,
      'yo', coalesce(c.soy, false),
      'personas', c.n,
      'motivo', case when c.n < k_min then 'grupo_chico' end,
      -- Posición y equipo (mediana/promedio): SOLO con K o más personas (decisión del dueño 18-nov 13:58, opción C).
      'ranking', case when coalesce(c.soy, false) and c.n >= k_min then
          jsonb_build_object('posicion', (select ventas from pos), 'de', c.n) end,
      -- Proporciones del local: SIEMPRE (sin plata total, sin posición).
      'general', (
          select jsonb_build_object(
            'prom_pax',    case when g.pax > 0 then round(g.salon_todo / g.pax, -2) end,
            'comida_pax',  case when g.pax > 0 then round(g.icom / g.pax, 2) end,
            'beb_pax',     case when g.pax_sal > 0 then round(g.ibeb / g.pax_sal, 2) end,
            'prom_ticket', case when g.icom + g.ibeb > 0 then round(g.total / (g.icom + g.ibeb), -2) end)
          from gen g),
      -- Las mismas proporciones, misma ventana del año pasado (−364 días). `general` null = sin datos del año pasado.
      'anio_pasado', (
          select jsonb_build_object(
            'desde', p_desde - 364, 'hasta', p_hasta - 364,
            'general', case when g.filas > 0 then jsonb_build_object(
              'prom_pax',    case when g.pax > 0 then round(g.salon_todo / g.pax, -2) end,
              'comida_pax',  case when g.pax > 0 then round(g.icom / g.pax, 2) end,
              'beb_pax',     case when g.pax_sal > 0 then round(g.ibeb / g.pax_sal, 2) end,
              'prom_ticket', case when g.icom + g.ibeb > 0 then round(g.total / (g.icom + g.ibeb), -2) end) end)
          from gen_ap g),
      'equipo', case when c.n >= k_min then (
          select jsonb_build_object(
            'de', c.n,
            'mediana', jsonb_build_object(
               'prom_pax',    round((percentile_cont(0.5) within group (order by p.prom_pax))::numeric, -2),
               'beb_pax',     round((percentile_cont(0.5) within group (order by p.beb_pax))::numeric, 2),
               'comida_pax',  round((percentile_cont(0.5) within group (order by p.comida_pax))::numeric, 2),
               'prom_ticket', round((percentile_cont(0.5) within group (order by p.prom_ticket))::numeric, -2),
               'pax_dia',     round((percentile_cont(0.5) within group (order by p.pax_dia))::numeric, 1)),
            'promedio', jsonb_build_object(
               'prom_pax',    round(avg(p.prom_pax), -2),
               'beb_pax',     round(avg(p.beb_pax), 2),
               'comida_pax',  round(avg(p.comida_pax), 2),
               'prom_ticket', round(avg(p.prom_ticket), -2),
               'pax_dia',     round(avg(p.pax_dia), 1)),
            'mi_posicion', case when coalesce(c.soy, false) then (select to_jsonb(pos) from pos) end)
          from pers p) end,
      'por_dow', (select coalesce(jsonb_agg(jsonb_build_object('dow', d.dow,
                     'prom_pax', case when d.pax > 0 then round(d.salon_todo / d.pax, -2) end)
                     order by d.dow), '[]'::jsonb) from dow d),
      'icp_equipo', case when c.n >= k_min then (
          select case when g.total > 0 then round(t.gen / g.total * 100, 1) end from gen g, tips t) end)
    end
  into v_out
  from cuenta c;
  return v_out;
end
$$;
revoke all on function public.pos_mi_rendimiento_equipo(text, date, date) from public, anon;
grant execute on function public.pos_mi_rendimiento_equipo(text, date, date) to authenticated;
comment on function public.pos_mi_rendimiento_equipo(text, date, date) is
  'Mig 194. Agregados del equipo para Mi Rendimiento (posición, general, mediana/promedio por persona, Prom/PAX por día de semana, ICP del equipo). Sin filas ni montos de otras personas; con menos de 4 personas, sin agregados.';

-- ── 5. Mi lugar en una competencia (API) ────────────────────────────────────────────────────────
-- Los participantes de `ventas_comps.data->'parts'` son NOMBRES (los de la app). Se resuelven a códigos del PoS por
-- `employees.full_name` (btrim, exacto); el que no se resuelve cuenta con 0 puntos y se informa en `sin_resolver`.
create or replace function public.pos_mi_competencia(p_local text, p_comp text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  k_min constant integer := 4;
  v_yo text[];
  v_c jsonb;
  v_desde date;
  v_hasta date;
  v_hoy date := (now() at time zone 'America/Costa_Rica')::date;
  v_out jsonb;
begin
  v_yo := public.pos_rend_yo(p_local);
  select c.data into v_c from public.ventas_comps c where c.data->>'id' = p_comp order by c.created_at desc limit 1;
  if v_c is null then
    return jsonb_build_object('participa', false, 'motivo', 'no_existe');
  end if;
  v_desde := (v_c->>'inicio')::date;
  v_hasta := least((v_c->>'fin')::date, v_hoy);
  if v_hasta < v_desde or v_hasta - v_desde > 400 then
    return jsonb_build_object('participa', false, 'motivo', 'sin_dias');
  end if;

  with
  parts as (
    select distinct btrim(p) as nombre from jsonb_array_elements_text(coalesce(v_c->'parts', '[]'::jsonb)) p
    where nullif(btrim(p), '') is not null
  ),
  claves as (   -- participante → claves de persona (por los logins de los empleados con ese nombre)
    select pa.nombre, public.pos_persona_clave(e.pos_login, null) as clave
    from parts pa
    join public.employees e on btrim(e.full_name) = pa.nombre and nullif(btrim(e.pos_login), '') is not null
  ),
  prods as (
    select upper(btrim(x->>'name')) as prod, coalesce((x->>'pts')::numeric, 1) as pts
    from jsonb_array_elements(coalesce(v_c->'prods', '[]'::jsonb)) x where jsonb_typeof(x) = 'object'
    union all
    select upper(btrim(x #>> '{}')), 1 from jsonb_array_elements(coalesce(v_c->'prods', '[]'::jsonb)) x where jsonb_typeof(x) = 'string'
  ),
  q as (select * from public.pos_rend_productos(p_local, v_desde, v_hasta)),
  puntos as (
    select pa.nombre,
           coalesce((select sum(q.q * pr.pts) from q join prods pr on pr.prod = q.prod
                     where q.clave in (select c.clave from claves c where c.nombre = pa.nombre)), 0) as pts,
           exists (select 1 from claves c where c.nombre = pa.nombre and c.clave = any (v_yo)) as soy
    from parts pa
  ),
  r as (select count(*) as n, count(*) filter (where soy) as yo_n,
               max(pts) filter (where soy) as mis,
               (select count(*) from parts pa where not exists (select 1 from claves c where c.nombre = pa.nombre)) as sin_res
        from puntos)
  select case when r.yo_n = 0 then jsonb_build_object('participa', false, 'motivo', 'no_participa')
         else jsonb_build_object(
           'participa', true,
           'de', r.n,
           'posicion', 1 + (select count(*) from puntos where not soy and pts > r.mis),
           'mis_puntos', r.mis,
           -- Decisión del dueño 18-nov 13:58 («A»): el líder se muestra CON su nombre (es el juego del local; son puntos).
           'lider_nombre', (select nombre from puntos order by pts desc, nombre limit 1),
           'lider_puntos', (select max(pts) from puntos),
           'mediana_puntos', case when r.n >= k_min then (select percentile_cont(0.5) within group (order by pts) from puntos) end,
           'sin_resolver', r.sin_res,
           'motivo', case when r.n < k_min then 'grupo_chico' end)
         end
  into v_out
  from r;
  return v_out;
end
$$;
revoke all on function public.pos_mi_competencia(text, text) from public, anon;
grant execute on function public.pos_mi_competencia(text, text) to authenticated;
comment on function public.pos_mi_competencia(text, text) is
  'Mig 194. Mi posición y mis puntos en una competencia; puntos del líder y mediana solo con 4+ participantes y sin nombre.';

commit;
