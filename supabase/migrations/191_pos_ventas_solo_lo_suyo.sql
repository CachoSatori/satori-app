-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 191 · Ventas del PoS: cada uno ve solo lo suyo (cierra la fuga de la 067)             ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- Decisión del dueño, 18-nov-2026 11:44 -06:00 (opción «Salonero A»); la firma final va sobre el SHA del PR.
--
-- Hallazgo (verificador, staging, JWT de un salonero): las tres funciones de la 067 le devolvían a CUALQUIER usuario
-- con uno de los roles de Mi Rendimiento (salonero, barman, barback, runner, cocina) TODAS las facturas y líneas del
-- local, de todos los saloneros, con montos y pax. Y al manager no le miraban el local (cualquier p_local).
--
-- Después de la 191 (misma firma, mismas columnas, mismo orden y paginación que la 067: la app no cambia de llamada):
--   · owner y contador ACTIVOS → todo, como hoy.
--   · manager activo           → solo las facturas de SUS locales (`mis_locales()`, 091).
--   · salonero / barman / barback / runner / cocina activos → SOLO las facturas cuyo `salonero_login` es uno de SUS
--     logins del PoS (`employees.pos_login` de las filas de empleado atadas a su perfil, activas o no). Es lo que usa
--     Mi Rendimiento para su propia venta. Sin login cargado → 0 filas.
--   · cajero, proveedor, inactivos, anon → nada (como hoy).
--
-- `pos_ventas_lineas` devuelve solo líneas de facturas que el usuario puede ver (mismo criterio, por la factura de la
-- línea): pasar ids de facturas ajenas a mano ya no trae nada. «En vivo» (gerencia) sigue pidiendo líneas de facturas
-- en curso (R): el criterio no mira el estado.
-- `pos_ventas_latido` sigue diciendo «tengo acceso» (1 fila) o «no» (0): ahora el manager de otro local recibe 0.
--
-- Regla 6 de ESTADO: `pos_ndf_*` siguen cerradas a gerencia; no se agrega ninguna policy. No se agregan columnas.
-- `pos_ventas_resumen` (190, rama claude/ventas-v2-resumen-fn) NO se toca acá: es solo owner/manager/contador y
-- tampoco filtra el local del manager; queda anotado para esa rama.
--
-- Helpers nuevos (internos: sin EXECUTE para la API; los llaman las funciones `security definer`):
--   · pos_mis_logins() → text[] con los logins del PoS del usuario actual (recortados, sin vacíos).
-- Función nueva para la API (decisión del dueño 18-nov 11:50, «C»): pos_nombres_por_login() → (login, nombre), solo
-- owner/manager/contador (§5).
--
-- Guarda (R13, como la 183): antes de reemplazar nada, exige que las tres funciones vivas sean EXACTAMENTE las de la
-- 067 (md5 de pg_get_functiondef, leído en prod y en staging el 18-nov). Si alguna no coincide, aborta sin tocar nada.
-- Por eso NO es re-ejecutable: una segunda pasada encuentra el cuerpo de la 191 y para.
-- Vuelta atrás: una migración NUEVA hacia adelante (scripts/sql/191_rollback.sql, sin numerar; regla 10). Pruebas
-- por rol: scripts/sql/191_pruebas.sql (+ 191_pruebas.py; transacción que termina en ROLLBACK).
begin;

-- ── Guarda: las tres funciones tienen que ser las de la 067 ───────────────────────────────
do $guarda191$
declare
  r record;
begin
  for r in select * from (values
    ('public.pos_ventas_tickets_rango(text,timestamptz,timestamptz,integer,integer)', 'ce7245d0f7d960d89e3ebc58ebec3813'),
    ('public.pos_ventas_lineas(uuid[],integer,integer)',                               'ba41d0d5d0336ec079877a730ee804dd'),
    ('public.pos_ventas_latido(text)',                                                 '22ff3225d2cee25ec2228b9598570dce')
  ) as x(fn, esperado) loop
    if to_regprocedure(r.fn) is null then
      raise exception '191: falta % : se para sin tocar nada', r.fn;
    end if;
    if md5(pg_get_functiondef(to_regprocedure(r.fn))) <> r.esperado then
      raise exception '191: % no es la de la 067 (md5 %, se esperaba %): se para sin tocar nada',
        r.fn, md5(pg_get_functiondef(to_regprocedure(r.fn))), r.esperado;
    end if;
  end loop;
end
$guarda191$;

-- ── 0. Mis logins del PoS ─────────────────────────────────────────────────────────────────
create or replace function public.pos_mis_logins()
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(distinct btrim(e.pos_login)), array[]::text[])
  from public.employees e
  where auth.uid() is not null
    and e.profile_id = auth.uid()
    and nullif(btrim(e.pos_login), '') is not null
$$;
revoke all on function public.pos_mis_logins() from public, anon, authenticated;
grant execute on function public.pos_mis_logins() to service_role;
comment on function public.pos_mis_logins() is
  'Mig 191. Logins del PoS (employees.pos_login) del usuario actual. Interno: lo usan las funciones de ventas del PoS.';

-- ── 1. Tickets cerrados de un rango ────────────────────────────────────────────────────────
create or replace function public.pos_ventas_tickets_rango(
  p_local  text,
  p_desde  timestamptz,
  p_hasta  timestamptz,
  p_limit  integer default 1000,
  p_offset integer default 0
)
returns table (
  id                uuid,
  numero_factura    text,
  estado            text,
  fecha_registra    timestamptz,
  fecha_cierra      timestamptz,
  cajero_login      text,
  canal             text,
  mesa              text,
  salonero_login    text,
  registrado_por    text,
  servicio_crc      numeric,
  total_crc         numeric,
  valor_servido_crc numeric,
  iva_crc           numeric,
  regalia_crc       numeric,
  pax               integer,
  pax_articulo      integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with yo as (
    select public.get_my_role()    as rol,
           public.mis_locales()    as locs,
           public.pos_mis_logins() as logins
  )
  select t.id, t.numero_factura, t.estado, t.fecha_registra, t.fecha_cierra, t.cajero_login,
         t.canal, t.mesa, t.salonero_login, t.registrado_por, t.servicio_crc, t.total_crc,
         t.valor_servido_crc, t.iva_crc, t.regalia_crc, t.pax, t.pax_articulo
  from public.pos_ndf_tickets t
  cross join yo
  where t.local = p_local
    and t.estado = 'C'
    and t.fecha_registra >= p_desde
    and t.fecha_registra <  p_hasta
    and (
          yo.rol in ('owner', 'contador')
       or (yo.rol = 'manager' and t.local = any (yo.locs))
       or (yo.rol in ('salonero', 'barman', 'barback', 'runner', 'cocina')
           and btrim(t.salonero_login) = any (yo.logins))
    )
  order by t.fecha_registra, t.id
  limit  least(greatest(coalesce(p_limit, 1000), 0), 1000)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

-- ── 2. Líneas de un conjunto de facturas (solo de facturas que el usuario ve) ──────────────
create or replace function public.pos_ventas_lineas(
  p_ticket_ids uuid[],
  p_limit      integer default 1000,
  p_offset     integer default 0
)
returns table (
  ticket_id        uuid,
  codigo_producto  text,
  nombre           text,
  cantidad         numeric,
  monto            numeric,
  familia          integer,
  usuario_registra text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with yo as (
    select public.get_my_role()    as rol,
           public.mis_locales()    as locs,
           public.pos_mis_logins() as logins
  )
  select l.ticket_id, l.codigo_producto, l.nombre, l.cantidad, l.monto, l.familia, l.usuario_registra
  from public.pos_ndf_ticket_lines l
  join public.pos_ndf_tickets t on t.id = l.ticket_id
  cross join yo
  where l.ticket_id = any (p_ticket_ids)
    and (
          yo.rol in ('owner', 'contador')
       or (yo.rol = 'manager' and t.local = any (yo.locs))
       or (yo.rol in ('salonero', 'barman', 'barback', 'runner', 'cocina')
           and btrim(t.salonero_login) = any (yo.logins))
    )
  order by l.ticket_id, l.id
  limit  least(greatest(coalesce(p_limit, 1000), 0), 1000)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

-- ── 3. Latido: 1 fila a quien puede leer ventas de ESE local, 0 a quien no ────────────────
create or replace function public.pos_ventas_latido(p_local text)
returns table (last_poll_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (select c.last_poll_at from public.pos_ndf_cursor c where c.local = p_local)
  where public.get_my_role() in ('owner', 'contador', 'salonero', 'barman', 'barback', 'runner', 'cocina')
     or (public.get_my_role() = 'manager' and p_local = any (public.mis_locales()))
$$;

-- ── 4. Permisos: los mismos de la 067 ──────────────────────────────────────────────────────
revoke all on function public.pos_ventas_tickets_rango(text, timestamptz, timestamptz, integer, integer) from public, anon;
revoke all on function public.pos_ventas_lineas(uuid[], integer, integer)                             from public, anon;
revoke all on function public.pos_ventas_latido(text)                                                  from public, anon;
grant execute on function public.pos_ventas_tickets_rango(text, timestamptz, timestamptz, integer, integer) to authenticated;
grant execute on function public.pos_ventas_lineas(uuid[], integer, integer)                             to authenticated;
grant execute on function public.pos_ventas_latido(text)                                                  to authenticated;

comment on function public.pos_ventas_tickets_rango(text, timestamptz, timestamptz, integer, integer) is
  'Mig 067 + 191. Tickets C de un rango, SIN medios de pago ni clase_ingreso. owner/contador: todo; manager: sus locales; personal: solo sus facturas (salonero_login = su pos_login).';
comment on function public.pos_ventas_lineas(uuid[], integer, integer) is
  'Mig 067 + 191. Líneas de un conjunto de tickets, solo de tickets que el usuario puede ver (mismo criterio que pos_ventas_tickets_rango).';
comment on function public.pos_ventas_latido(text) is
  'Mig 067 + 191. 1 fila (hora del último poll) a quien puede leer ventas del PoS de ese local; 0 filas a quien no.';

-- ── 5. Login del PoS → nombre visible, para gerencia (decisión del dueño, 18-nov 11:50, «C») ─
-- El contador no lee `employees` inactivos por RLS («Todos ven empleados activos») y en el Resumen («Ayer: mesas sin
-- pax») veía el login del PoS. Esta función devuelve SOLO el par login → nombre (nada más de `employees`), a owner,
-- manager y contador ACTIVOS; al resto, 0 filas. No abre `employees` con ninguna policy nueva.
-- Un login reciclado con varias filas: gana la activa y, si empatan, la más nueva (como `getEmployeeByProfileId`).
create or replace function public.pos_nombres_por_login()
returns table (pos_login text, nombre text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct on (btrim(e.pos_login)) btrim(e.pos_login) as pos_login, btrim(e.full_name) as nombre
  from public.employees e
  where public.get_my_role() in ('owner', 'manager', 'contador')
    and nullif(btrim(e.pos_login), '') is not null
    and nullif(btrim(e.full_name), '') is not null
  order by btrim(e.pos_login), e.is_active desc, e.created_at desc, e.id
$$;
revoke all on function public.pos_nombres_por_login() from public, anon;
grant execute on function public.pos_nombres_por_login() to authenticated;
comment on function public.pos_nombres_por_login() is
  'Mig 191. Login del PoS → nombre visible (solo esas dos columnas de employees). owner/manager/contador activos; el resto 0 filas.';

commit;
