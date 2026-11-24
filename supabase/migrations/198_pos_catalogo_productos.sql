-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 198 · Ventas v2 3.1: catálogo único por código desde el PoS + `pos_ventas_productos`   ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- PR 3.1a (SPEC docs/ventas/SPEC-3.1-catalogo.md §6, PR #350). Entra a prod por merge → Branching, SOLO con la firma
-- del dueño (D-9) sobre el SHA del PR y con los nombres de familia leídos en la PC del PoS (docs/pases/PASE-198.md).
-- D8 (catálogo único por código), D17 (el catálogo sale del PoS) y las decisiones del 24-nov: D-2 = C (categoría
-- por código en la app), D-3 (las familias mixtas 1, 9, 11, 15 y 25 van a comida o bebida, código por código) y la categoría
-- `menu_especial` (el ítem por comensal de un menú cerrado). La SUBCATEGORÍA no entra acá: viene del PoS (3.1c).
--
-- Agrega (no reemplaza nada vivo; por eso no lleva guarda de md5, R13):
--   1. `pos_familias`          (local, familia)  → nombre de la familia del PoS y su categoría POR DEFECTO.
--   2. `pos_productos`         (local, codigo)   → nombre y familia vigentes de cada producto visto en facturas.
--   3. `pos_producto_ajustes`  (local, codigo)   → lo que carga una persona: `rinde_personas` (1 a 20) y `categoria`
--      (null = la de su familia).
--   4. `pos_catalogo_absorber` + disparador en `pos_ndf_ticket_lines` (AFTER INSERT, por sentencia): mantiene 2.
--      Nunca frena la ingesta: si falla, avisa (WARNING) y la factura entra igual.
--   5. `pos_catalogo_refrescar(p_local)`: la misma regla sobre toda la historia (carga inicial y reparación).
--   6. `pos_categoria_efectiva(familia de la línea, categoría de la familia, categoría del código)`: la ÚNICA
--      definición de qué categoría le toca a una línea.
--   7. `pos_ventas_productos(p_local, p_desde, p_hasta)` → jsonb de SOLO LECTURA para «Productos».
--   8. `pos_catalogo_productos(p_local)` → jsonb de SOLO LECTURA: el catálogo entero, para «Ajustes → Catálogo».
--   9. `pos_producto_ajuste_guardar(p_local, p_codigo, p_rinde, p_categoria)`: la única puerta de escritura de 3.
--
-- LA CATEGORÍA NUNCA DECIDE LA VENTA. Qué plata es venta lo decide SOLO la familia de la línea (fuera: 6, 17 y 20,
-- `FAMILIAS_NO_VENTA`, firmada). La categoría por código solo reparte lo que YA es venta entre comida, bebida y las
-- demás: no puede sacar ni meter un producto de la venta neta. Lo cuidan tres cosas: el `check` de 3 (una persona
-- no puede guardar `cortesia`, `personal` ni `ingredientes`), la función de 9 y `pos_categoria_efectiva`.
--
-- NO toca `pos_ndf_*` (salvo sumar el disparador), `product_map`, la 067, la 190, la 193 ni la 194.
-- NO devuelve medios de pago, mesas, saloneros ni `clase_ingreso` (regla 6 de ESTADO).
-- Vuelta atrás: scripts/sql/198_rollback.sql. Pruebas: scripts/sql/198_pruebas.sql (terminan en ROLLBACK).

-- ── 0. Guarda: si algo de esto ya existe, se para sin tocar nada ─────────────────────────
do $guarda198$
declare
  o text;
begin
  if to_regprocedure('public.puede_ver_local(text)') is null or to_regprocedure('public.get_my_role()') is null then
    raise exception '198: falta puede_ver_local (091) o get_my_role';
  end if;
  foreach o in array array['public.pos_familias', 'public.pos_productos', 'public.pos_producto_ajustes'] loop
    if to_regclass(o) is not null then
      raise exception '198: % ya existe: se para sin tocar nada', o;
    end if;
  end loop;
  foreach o in array array['public.pos_catalogo_absorber(uuid[])', 'public.pos_catalogo_registrar()',
                           'public.pos_catalogo_refrescar(text)', 'public.pos_categoria_efectiva(integer,text,text)',
                           'public.pos_ventas_productos(text,date,date)', 'public.pos_catalogo_productos(text)',
                           'public.pos_producto_ajuste_guardar(text,text,integer,text)'] loop
    if to_regprocedure(o) is not null then
      raise exception '198: % ya existe: se para sin tocar nada', o;
    end if;
  end loop;
end
$guarda198$;

-- ── 1. Familias del PoS por local ────────────────────────────────────────────────────────
create table public.pos_familias (
  local     text    not null,
  familia   integer not null,
  nombre    text    not null check (nombre = btrim(nombre) and nombre <> ''),
  categoria text    not null check (categoria in ('comida', 'bebida', 'menu_especial', 'extras', 'otros', 'merch',
                                                  'giftcard', 'pax', 'duenos', 'cortesia', 'personal',
                                                  'ingredientes')),
  orden     integer not null default 999,
  primary key (local, familia),
  -- Fuera de la venta = familias 6, 17 y 20, ni una más ni una menos (FAMILIAS_NO_VENTA, firmada).
  constraint pos_familias_no_venta_chk
    check ((familia in (6, 17, 20)) = (categoria in ('cortesia', 'personal', 'ingredientes')))
);
comment on table public.pos_familias is
  'Mig 198. Familias del PoS (FAC_Clasificaciones) por local: nombre y categoría por defecto de sus productos. La carga la migración; nadie la edita desde la app. Una familia sin fila se muestra «Familia N» en «otros».';

-- ── 2. Catálogo por código ───────────────────────────────────────────────────────────────
create table public.pos_productos (
  local          text        not null,
  codigo         text        not null check (codigo = btrim(codigo) and codigo <> '' and length(codigo) <= 40),
  nombre         text        not null check (nombre <> ''),
  familia        integer,
  visto_desde    date        not null,
  visto_hasta    date        not null,
  actualizado_en timestamptz not null default now(),
  primary key (local, codigo),
  check (visto_desde <= visto_hasta)
);
create index pos_productos_local_familia_idx on public.pos_productos (local, familia);
comment on table public.pos_productos is
  'Mig 198. Catálogo único por (local, código) del PoS. Lo escribe SOLO el disparador de pos_ndf_ticket_lines (y pos_catalogo_refrescar). Nombre y familia = los de la factura más reciente. visto_* = día CR de la primera y la última factura (cualquier estado) que lo trae.';

-- ── 3. Lo que carga una persona, por código ──────────────────────────────────────────────
-- Sin fila = todo por defecto: rinde 1 y la categoría de su familia.
create table public.pos_producto_ajustes (
  local           text        not null,
  codigo          text        not null,
  rinde_personas  integer     not null default 1 check (rinde_personas between 1 and 20),
  -- null = la de su familia. Una persona solo elige entre categorías que SON venta y no tienen otra regla
  -- colgada: nunca `cortesia`, `personal` ni `ingredientes` (fuera de la venta), ni `giftcard`, `pax` o `duenos`.
  categoria       text        check (categoria in ('comida', 'bebida', 'menu_especial', 'extras', 'merch', 'otros')),
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid,
  primary key (local, codigo),
  foreign key (local, codigo) references public.pos_productos (local, codigo),
  constraint pos_producto_ajustes_algo_chk check (rinde_personas > 1 or categoria is not null)
);
comment on table public.pos_producto_ajustes is
  'Mig 198. Lo que una persona carga por producto: cuántas personas rinde (1 a 20) y la categoría si no es la de su familia (null = hereda). Sin fila = todo por defecto. Se escribe solo por pos_producto_ajuste_guardar (owner; manager de su local). La categoría nunca cambia qué es venta neta.';

-- ── RLS: gerencia activa lee; el manager, solo sus locales; nadie escribe por la API ─────
alter table public.pos_familias         enable row level security;
alter table public.pos_productos        enable row level security;
alter table public.pos_producto_ajustes enable row level security;

create policy pos_familias_leer on public.pos_familias
  for select to authenticated
  using ((select public.get_my_role()) in ('owner', 'contador')
         or ((select public.get_my_role()) = 'manager' and public.puede_ver_local(local)));
create policy pos_productos_leer on public.pos_productos
  for select to authenticated
  using ((select public.get_my_role()) in ('owner', 'contador')
         or ((select public.get_my_role()) = 'manager' and public.puede_ver_local(local)));
create policy pos_producto_ajustes_leer on public.pos_producto_ajustes
  for select to authenticated
  using ((select public.get_my_role()) in ('owner', 'contador')
         or ((select public.get_my_role()) = 'manager' and public.puede_ver_local(local)));

revoke all on table public.pos_familias, public.pos_productos, public.pos_producto_ajustes from public, anon, authenticated;
grant select on table public.pos_familias, public.pos_productos, public.pos_producto_ajustes to authenticated;

-- ── 4. La regla del catálogo, en un solo lugar ───────────────────────────────────────────
-- De las líneas de esas facturas: por (local, código) → nombre y familia de la factura MÁS RECIENTE y el
-- primer y último día CR. Solo escribe si hay algo nuevo (código nuevo, otro nombre, otra familia o un día
-- fuera de [visto_desde, visto_hasta]): en un día normal, una escritura por producto.
create function public.pos_catalogo_absorber(p_ticket_ids uuid[])
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_n integer;
begin
  with n as (
    select t.local, btrim(l.codigo_producto) as codigo,
           coalesce(nullif(btrim(l.nombre), ''), btrim(l.codigo_producto)) as nombre,
           l.familia, t.fecha_registra,
           (t.fecha_registra at time zone 'America/Costa_Rica')::date as dia
    from public.pos_ndf_tickets t
    join public.pos_ndf_ticket_lines l on l.ticket_id = t.id
    where t.id = any (p_ticket_ids)
      and nullif(btrim(l.codigo_producto), '') is not null
      and length(btrim(l.codigo_producto)) <= 40
  ),
  a as (
    select local, codigo, min(dia) as desde, max(dia) as hasta from n group by local, codigo
  ),
  u as (
    select distinct on (local, codigo) local, codigo, nombre, familia
    from n
    order by local, codigo, fecha_registra desc, nombre, familia
  )
  insert into public.pos_productos as p (local, codigo, nombre, familia, visto_desde, visto_hasta)
  select a.local, a.codigo, u.nombre, u.familia, a.desde, a.hasta
  from a join u using (local, codigo)
  where not exists (select 1 from public.pos_productos q
                    where q.local = a.local and q.codigo = a.codigo
                      and q.nombre = u.nombre and q.familia is not distinct from u.familia
                      and q.visto_desde <= a.desde and q.visto_hasta >= a.hasta)
  on conflict (local, codigo) do update set
    nombre         = case when excluded.visto_hasta >= p.visto_hasta then excluded.nombre  else p.nombre  end,
    familia        = case when excluded.visto_hasta >= p.visto_hasta then excluded.familia else p.familia end,
    visto_desde    = least(p.visto_desde, excluded.visto_desde),
    visto_hasta    = greatest(p.visto_hasta, excluded.visto_hasta),
    actualizado_en = now();
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;
revoke all on function public.pos_catalogo_absorber(uuid[]) from public, anon, authenticated;
grant execute on function public.pos_catalogo_absorber(uuid[]) to service_role;

-- El disparador: por sentencia (un llamado por lote de la ingesta, no por línea). Si el catálogo falla,
-- la factura entra igual: el catálogo es derivado y `pos_catalogo_refrescar` lo repara.
create function public.pos_catalogo_registrar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  begin
    perform public.pos_catalogo_absorber(array(select distinct ticket_id from nuevas));
  exception when others then
    raise warning '198 pos_catalogo_registrar: % (%)', sqlerrm, sqlstate;
  end;
  return null;
end;
$function$;
revoke all on function public.pos_catalogo_registrar() from public, anon, authenticated;

create trigger trg_pos_catalogo_registrar
  after insert on public.pos_ndf_ticket_lines
  referencing new table as nuevas
  for each statement execute function public.pos_catalogo_registrar();

-- ── 5. Carga inicial y reparación ────────────────────────────────────────────────────────
create function public.pos_catalogo_refrescar(p_local text)
returns integer
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select public.pos_catalogo_absorber(array(select t.id from public.pos_ndf_tickets t where t.local = p_local))
$$;
revoke all on function public.pos_catalogo_refrescar(text) from public, anon, authenticated;
grant execute on function public.pos_catalogo_refrescar(text) to service_role;

select x.local, public.pos_catalogo_refrescar(x.local) as productos
from (select distinct local from public.pos_ndf_tickets) x;

-- Familias de santa-teresa: las 29 del PoS (`FAC_Clasificaciones`, leídas por el dueño el 24-nov 15:43 CR), menos las
-- que no existen. Nombres como están en el PoS. La 1 NO existe en el PoS: sus códigos vienen de una clasificación
-- borrada y se cargan con un rótulo propio. Ningún nombre puede quedar «POR CONFIRMAR» (lo frena una prueba del gate).
-- Categoría (decisiones del dueño, 24-nov ~15:50 CR): la que ya usan las cuentas firmadas (comida 2,3,4,13,16,29 ·
-- bebida 5 · fuera de la venta 6, 17 y 20) · 18 → bebida · 10 → merch · 17 → regalías (`cortesia`: no es venta,
-- fijada por la familia) · 6 → consumo del personal (`personal`: aparte, fuera de la venta neta de carta) · 20 sin
-- ventas. MIXTAS, categoría por código (D-3 y A-2): 1, 9, 11, 15 y 25 llevan acá la categoría de un código NUEVO
-- (la de la mayoría de sus líneas) y sus códigos de hoy la suya, uno por uno, más abajo. 7, 8 y 14 también van por
-- código, pero hoy no tienen ninguna venta: un código nuevo entra en `otros` hasta que alguien le ponga la suya.
insert into public.pos_familias (local, familia, nombre, categoria, orden) values
  ('santa-teresa',  2, 'TAPAS ASIATICAS',          'comida',       10),
  ('santa-teresa',  3, 'SUSHI ROLLS',              'comida',       20),
  ('santa-teresa', 16, 'POKES BOWLS CEVICHES',     'comida',       30),
  ('santa-teresa', 13, 'KIDS MENU',                'comida',       40),
  ('santa-teresa',  4, 'POSTRES',                  'comida',       50),
  ('santa-teresa', 29, 'GREENSEASON',              'comida',       60),
  ('santa-teresa', 11, 'MENU AÑO NUEVO',           'comida',       70),  -- mixta, por código
  ('santa-teresa', 15, 'EVENTOS TERRAZA',          'comida',       80),  -- mixta, por código
  ('santa-teresa',  9, 'BELIEVE',                  'comida',       90),  -- mixta, por código
  ('santa-teresa',  5, 'BEBIDAS',                  'bebida',       10),
  ('santa-teresa', 18, 'Y HAPPY HOUR',             'bebida',       20),
  ('santa-teresa', 25, 'PROMOCIONES',              'bebida',       30),  -- mixta, por código (mismo nombre que la 14)
  ('santa-teresa',  1, '(clasificación borrada)',  'bebida',       40),  -- no existe en el PoS · por código
  ('santa-teresa', 22, 'EXTRAS',                   'extras',       10),
  ('santa-teresa',  7, 'ACADEMY SURFCAMP',         'otros',        10),  -- por código
  ('santa-teresa',  8, 'LAPOINT SURFCAMP',         'otros',        20),  -- por código
  ('santa-teresa', 14, 'PROMOCIONES',              'otros',        30),  -- por código
  ('santa-teresa', 21, 'TSHIRTS',                  'merch',        10),
  ('santa-teresa', 23, 'T-GORRAS',                 'merch',        20),
  ('santa-teresa', 24, 'T-DARUMAS',                'merch',        30),
  ('santa-teresa', 26, 'T-STICKERS',               'merch',        40),
  ('santa-teresa', 10, 'REMERAS',                  'merch',        50),
  ('santa-teresa', 27, 'T-XABANICOS',              'merch',        60),
  ('santa-teresa', 12, 'GIFT CARDS',               'giftcard',     10),
  ('santa-teresa', 19, 'A PAX',                    'pax',          10),
  ('santa-teresa', 28, 'XX DUEÑOS',                'duenos',       10),
  ('santa-teresa', 17, 'X CORTESIAS',              'cortesia',     10),
  ('santa-teresa',  6, 'PERSONAL',                 'personal',     10),
  ('santa-teresa', 20, 'Ingredientes',             'ingredientes', 10);

-- Lo que ya estaba decidido, por código, en UNA sola carga:
--   · «rinde»   = `product_map.multiplicador` ≥ 2 (tope 20), cruzando por nombre sin mirar mayúsculas ni espacios.
--     Si varios códigos comparten el nombre, heredan todos (es lo que hoy pasa al cruzar por nombre). Dos filas
--     de product_map que solo difieren en mayúsculas: gana el mayor.
--   · categoría = SOLO los códigos de las familias mixtas de santa-teresa: los 82 de 11, 15 y 25 (D-3, lista
--     confirmada por el dueño el 24-nov), comida o bebida uno por uno y el 192 (ítem por comensal del menú cerrado)
--     a `menu_especial`; los 2 de la 9 BELIEVE (comida) y el 1 de la 1 borrada (bebida), los únicos que hay en
--     staging y en prod (lectura del 24-nov). Solo se aplica si el código sigue en esas familias.
-- `product_map.subclasificacion` NO se hereda: la subcategoría viene del PoS (3.1c).
with pm as (
  select upper(btrim(nombre)) as nom, max(least(multiplicador, 20)) as rinde
  from public.product_map
  where multiplicador >= 2
  group by 1
),
cc as (
  select 'santa-teresa'::text as local, 'comida'::text as categoria, unnest(array[
    '124', '125', '373', '679', '680', '681', '682', '685', '686', '687', '688', '689', '691', '692', '693', '694', '698',
    '740',
    '304', '306', '577', '579',
    '930', '934',
    '166', '207']) as codigo
  union all
  select 'santa-teresa', 'bebida', unnest(array[
    '235', '238', '245', '643', '700', '701', '702', '714', '722', '727', '728', '738', '742', '743', '746', '747', '750',
    '753', '757', '758',
    '308', '312', '455',
    '5', '519', '559', '695', '843', '844', '860', '861', '862', '863', '864', '866', '867', '870', '871', '872', '879',
    '880', '881', '882', '917', '918', '921', '922', '925', '926', '1026', '1027', '1036', '1037', '1038', '1056',
    '1057', '1062',
    '1'])
  union all
  select 'santa-teresa', 'menu_especial', '192'
)
insert into public.pos_producto_ajustes (local, codigo, rinde_personas, categoria, actualizado_por)
select p.local, p.codigo, coalesce(pm.rinde, 1), cc.categoria, null
from public.pos_productos p
left join pm on pm.nom = upper(btrim(p.nombre))
left join cc on cc.local = p.local and cc.codigo = p.codigo and p.familia in (1, 9, 11, 15, 25)
where pm.rinde is not null or cc.categoria is not null;

-- ── 6. La categoría que le toca a una línea: UNA sola definición ─────────────────────────
-- 1.º La familia de la línea manda sobre lo que NO es venta (6, 17, 20): ahí ninguna categoría por código opina.
-- 2.º `giftcard`, `pax` y `duenos` las fija la familia (tienen sus propias cuentas).
-- 3.º Si no, la del código (si una persona la cargó); si no, la de la familia; si no, «otros».
create function public.pos_categoria_efectiva(p_familia integer, p_de_familia text, p_de_codigo text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_familia = 17 then 'cortesia'
    when p_familia = 6  then 'personal'
    when p_familia = 20 then 'ingredientes'
    when p_de_familia in ('giftcard', 'pax', 'duenos') then p_de_familia
    else coalesce(p_de_codigo, p_de_familia, 'otros')
  end
$$;
revoke all on function public.pos_categoria_efectiva(integer, text, text) from public, anon, authenticated;

-- ── 7. Ventas por producto (solo lectura) ────────────────────────────────────────────────
create function public.pos_ventas_productos(p_local text, p_desde date, p_hasta date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_rol public.user_role := public.get_my_role();
  v_out jsonb;
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

  with t as materialized (
    -- Facturas C cuyo día CR cae en [desde, hasta] (Costa Rica no cambia la hora: el corte es exacto).
    select tk.id, tk.canal, tk.valor_servido_crc,
           (tk.fecha_registra at time zone 'America/Costa_Rica')::date as dia
    from public.pos_ndf_tickets tk
    where tk.local = p_local
      and tk.estado = 'C'
      and tk.fecha_registra >= (p_desde::timestamp at time zone 'America/Costa_Rica')
      and tk.fecha_registra <  ((p_hasta + 1)::timestamp at time zone 'America/Costa_Rica')
  ),
  l as materialized (
    select t.id as ticket_id, t.canal, t.dia,
           nullif(btrim(ln.codigo_producto), '') as codigo,
           nullif(btrim(ln.nombre), '')          as nombre,
           ln.familia,
           floor(coalesce(ln.cantidad, 0) + 0.5)        as unidades,   -- Math.round de la app, por línea
           floor(coalesce(ln.monto, 0) * 100 + 0.5)     as monto_cts   -- céntimos enteros, como la 190
    from t join public.pos_ndf_ticket_lines ln on ln.ticket_id = t.id
  ),
  pr0 as (
    -- La plata sigue a la familia DE LA LÍNEA (así cierra contra la neta de la 190 al céntimo).
    select l.codigo, max(l.nombre) as nombre, l.familia, l.canal,
           sum(l.unidades) as unidades, sum(l.monto_cts) as monto_cts, count(distinct l.ticket_id) as facturas,
           -- Unidades de líneas en ₡0 (pasos de un menú cerrado, invitaciones): se sirvieron, no se vendieron.
           coalesce(sum(l.unidades) filter (where l.monto_cts = 0), 0) as unidades_cero
    from l
    group by l.codigo, case when l.codigo is null then upper(coalesce(l.nombre, '')) end, l.familia, l.canal
  ),
  pr as (
    -- La categoría se resuelve sobre lo ya sumado (cientos de filas, no cientos de miles de líneas).
    select pr0.*, public.pos_categoria_efectiva(pr0.familia, f.categoria, a.categoria) as categoria
    from pr0
    left join public.pos_familias f on f.local = p_local and f.familia = pr0.familia
    left join public.pos_producto_ajustes a on a.local = p_local and a.codigo = pr0.codigo
  ),
  ms0 as (
    select to_char(l.dia, 'YYYY-MM') as mes, l.codigo, l.familia, l.canal,
           sum(l.unidades) as unidades, sum(l.monto_cts) as monto_cts
    from l group by 1, 2, 3, 4
  ),
  ms as (
    select ms0.mes, ms0.familia, ms0.canal,
           public.pos_categoria_efectiva(ms0.familia, f.categoria, a.categoria) as categoria,
           sum(ms0.unidades) as unidades, sum(ms0.monto_cts) as monto_cts
    from ms0
    left join public.pos_familias f on f.local = p_local and f.familia = ms0.familia
    left join public.pos_producto_ajustes a on a.local = p_local and a.codigo = ms0.codigo
    group by 1, 2, 3, 4
  ),
  sl as (
    -- Facturas sin ninguna línea guardada: la 190 cuenta su `valor_servido_crc`. Acá van aparte.
    select count(*) as facturas, coalesce(sum(floor(coalesce(t.valor_servido_crc, 0) * 100 + 0.5)), 0) as cts
    from t where not exists (select 1 from l where l.ticket_id = t.id)
  ),
  cat as (
    -- El catálogo que la pantalla necesita: lo vendido en el período + lo visto desde 90 días antes.
    -- Acá la categoría es la del producto HOY (por su familia vigente); la de `productos` es la de cada línea.
    select p.codigo, p.nombre, p.familia, coalesce(a.rinde_personas, 1) as rinde, p.visto_desde, p.visto_hasta,
           public.pos_categoria_efectiva(p.familia, f.categoria, a.categoria) as categoria
    from public.pos_productos p
    left join public.pos_producto_ajustes a on a.local = p.local and a.codigo = p.codigo
    left join public.pos_familias f on f.local = p.local and f.familia = p.familia
    where p.local = p_local
      and (p.visto_hasta >= p_desde - 90 or p.codigo in (select pr.codigo from pr))
  )
  select jsonb_build_object(
    'productos', coalesce((select jsonb_agg(jsonb_build_array(pr.codigo, pr.nombre, pr.familia, pr.canal,
                             pr.unidades, pr.monto_cts, pr.facturas, pr.categoria, pr.unidades_cero)
                           order by pr.codigo nulls last, pr.nombre, pr.familia, pr.canal) from pr), '[]'::jsonb),
    'meses',     coalesce((select jsonb_agg(jsonb_build_array(ms.mes, ms.familia, ms.canal, ms.unidades, ms.monto_cts,
                             ms.categoria)
                           order by ms.mes, ms.familia, ms.canal, ms.categoria) from ms), '[]'::jsonb),
    'catalogo',  coalesce((select jsonb_agg(jsonb_build_array(cat.codigo, cat.nombre, cat.familia, cat.rinde,
                             cat.visto_desde, cat.visto_hasta, cat.categoria)
                           order by cat.codigo) from cat), '[]'::jsonb),
    'familias',  coalesce((select jsonb_agg(jsonb_build_array(f.familia, f.nombre, f.categoria, f.orden)
                           order by f.familia) from public.pos_familias f where f.local = p_local), '[]'::jsonb),
    'sin_lineas', (select jsonb_build_object('facturas', sl.facturas, 'cts', sl.cts) from sl),
    -- La neta mira SOLO la familia de la línea: ninguna categoría por código entra en esta cuenta.
    'neta_cts',  (select coalesce(sum(l.monto_cts) filter (where l.familia is null or l.familia not in (6, 17, 20)), 0)
                  from l) + (select sl.cts from sl)
  ) into v_out;

  return v_out;
end;
$function$;
revoke all on function public.pos_ventas_productos(text, date, date) from public, anon;
grant execute on function public.pos_ventas_productos(text, date, date) to authenticated;
comment on function public.pos_ventas_productos(text, date, date) is
  'Mig 198. Ventas v2 Productos: por (código, familia de la línea, canal) unidades, céntimos, facturas, categoría y unidades en ₡0; por mes × familia × canal × categoría; catálogo con «rinde» y categoría; familias con su categoría por defecto; neta_cts = la de la 190 (la decide la familia de la línea, nunca la categoría). Solo facturas C, día CR. Sin medios de pago. Owner/manager/contador; manager solo sus locales.';

-- ── 8. El catálogo entero, para «Ajustes → Catálogo» (solo lectura) ──────────────────────
create function public.pos_catalogo_productos(p_local text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_rol public.user_role := public.get_my_role();
begin
  if v_rol is null or v_rol not in ('owner', 'manager', 'contador') then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_local is null then
    raise exception 'Parámetros inválidos' using errcode = '22023';
  end if;
  if v_rol = 'manager' and not public.puede_ver_local(p_local) then
    raise exception 'No autorizado para este local' using errcode = '42501';
  end if;

  return jsonb_build_object(
    -- `categoria` = la que vale hoy; `categoria_propia` = la que cargó una persona (null = la de su familia).
    'productos', coalesce((select jsonb_agg(jsonb_build_array(p.codigo, p.nombre, p.familia,
                             public.pos_categoria_efectiva(p.familia, f.categoria, a.categoria), a.categoria,
                             coalesce(a.rinde_personas, 1), p.visto_desde, p.visto_hasta)
                           order by p.codigo)
                           from public.pos_productos p
                           left join public.pos_producto_ajustes a on a.local = p.local and a.codigo = p.codigo
                           left join public.pos_familias f on f.local = p.local and f.familia = p.familia
                           where p.local = p_local), '[]'::jsonb),
    'familias',  coalesce((select jsonb_agg(jsonb_build_array(f.familia, f.nombre, f.categoria, f.orden)
                           order by f.familia) from public.pos_familias f where f.local = p_local), '[]'::jsonb),
    -- Lo que una persona puede elegir, y las categorías que fija la familia: la pantalla no guarda otra copia.
    'categorias_editables', jsonb_build_array('comida', 'bebida', 'menu_especial', 'extras', 'merch', 'otros'),
    'categorias_fijas',     jsonb_build_array('giftcard', 'pax', 'duenos', 'cortesia', 'personal', 'ingredientes')
  );
end;
$function$;
revoke all on function public.pos_catalogo_productos(text) from public, anon;
grant execute on function public.pos_catalogo_productos(text) to authenticated;
comment on function public.pos_catalogo_productos(text) is
  'Mig 198. Catálogo entero de un local para «Ajustes → Catálogo»: código, nombre, familia, categoría vigente, categoría cargada a mano, «rinde» y fechas. Solo lectura. Owner/manager/contador; manager solo sus locales.';

-- ── 9. La única puerta de escritura de lo que carga una persona ──────────────────────────
-- Guarda los DOS valores juntos (la pantalla manda la ficha entera): p_rinde 1 a 20 · p_categoria null = la de su
-- familia. Si los dos quedan por defecto, borra la fila.
create function public.pos_producto_ajuste_guardar(p_local text, p_codigo text, p_rinde integer, p_categoria text)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_rol     public.user_role := public.get_my_role();
  v_cod     text := nullif(btrim(p_codigo), '');
  v_fam     integer;
  v_cat_fam text;
begin
  if v_rol is null or v_rol not in ('owner', 'manager') then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if v_rol = 'manager' and not public.puede_ver_local(p_local) then
    raise exception 'No autorizado para este local' using errcode = '42501';
  end if;
  if p_local is null or v_cod is null or p_rinde is null or p_rinde < 1 or p_rinde > 20 then
    raise exception 'Parámetros inválidos' using errcode = '22023';
  end if;
  if p_categoria is not null
     and p_categoria not in ('comida', 'bebida', 'menu_especial', 'extras', 'merch', 'otros') then
    raise exception 'Categoría fuera de la lista' using errcode = '22023';
  end if;

  select p.familia, f.categoria into v_fam, v_cat_fam
  from public.pos_productos p
  left join public.pos_familias f on f.local = p.local and f.familia = p.familia
  where p.local = p_local and p.codigo = v_cod;
  if not found then
    raise exception 'Producto desconocido' using errcode = '22023';
  end if;
  -- Lo que no es venta (6, 17, 20) y las familias con cuenta propia no se recategorizan a mano.
  if p_categoria is not null and (v_fam in (6, 17, 20) or v_cat_fam in ('giftcard', 'pax', 'duenos')) then
    raise exception 'La categoría de este producto la fija su familia' using errcode = '22023';
  end if;

  if p_rinde = 1 and p_categoria is null then
    delete from public.pos_producto_ajustes a where a.local = p_local and a.codigo = v_cod;
  else
    insert into public.pos_producto_ajustes as a (local, codigo, rinde_personas, categoria, actualizado_por)
    values (p_local, v_cod, p_rinde, p_categoria, auth.uid())
    on conflict (local, codigo) do update set
      rinde_personas = excluded.rinde_personas, categoria = excluded.categoria,
      actualizado_en = now(), actualizado_por = excluded.actualizado_por;
  end if;
end;
$function$;
revoke all on function public.pos_producto_ajuste_guardar(text, text, integer, text) from public, anon;
grant execute on function public.pos_producto_ajuste_guardar(text, text, integer, text) to authenticated;
comment on function public.pos_producto_ajuste_guardar(text, text, integer, text) is
  'Mig 198. Guarda lo que una persona carga de un producto: «rinde» (1 a 20) y categoría (null = la de su familia; solo comida, bebida, menu_especial, extras, merch u otros). Todo por defecto = borra el ajuste. Owner; manager solo de sus locales. No cambia qué es venta neta.';
