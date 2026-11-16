-- ╔══════════════════════════════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 175 (origen club 121) — Beneficio de cumpleaños: UNA vez por año por socio, lo marca la caja                     ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════════════════════════════╝
--
-- ⚠ Lleva firma: esquema y cortesías. Decisión del dueño (15-nov 21:49, por el chat):
--  · Al registrar la visita del socio dentro de la ventana de su cumpleaños, la caja marca «usó el beneficio de
--    cumpleaños», vinculado a esa visita (y con eso a su factura). Queda el año DEL CUMPLEAÑOS, quién, local y la visita.
--  · Una vez por socio y por año, en CUALQUIER local: si ya lo usó, la caja lo ve («Ya usó su beneficio de cumpleaños
--    este año») y el servidor rechaza otra marca (chequeo + índice único parcial por socio y año).
--  · Solo el owner deshace una marca hecha por error, con nota; queda en club_auditoria. Deshecha, se puede volver a marcar.
--  · Tablero y Excepciones cuentan los usos y sus cortesías a costo (club_cumple_usos_resumen; solo totales).
--  · La caja nunca ve la fecha ni el año del cumpleaños.
--
-- ── QUÉ HACE ─────────────────────────────────────────────────────────────────────────────────────────────────────
--  1. Tabla club_cumple_usos (sin acceso de la API) + índice único (miembro, año) y (visita) entre las marcas vigentes
--     + guardia: la fila no se cambia, salvo deshacerla una vez (owner, con nota).
--  2. club_cumple_en_caja_dia (173, interna) rehecha: suma `ya_uso` (true si ya hay marca vigente del año del cumpleaños
--     de la ventana de hoy) y CRUCE DE SOCIOS (el dueño aceptó el 15-nov que un socio de Nosara se atienda en Santa Teresa):
--     el socio activo de CUALQUIER local recibe el beneficio en el local de la caja, con la configuración (encendido,
--     ventana, texto, artículo) del LOCAL DE LA CAJA. Sigue siendo una vez por año en total. Quien llama tiene que estar
--     autorizado en ese local (club_exigir_local en las públicas); sin beneficio, `{"aplica": false}` exacto, sin la fecha.
--  3. club_cumple_usar(p_visita, p_location): owner, manager o cajero, con club_exigir_local. La visita tiene que ser de
--     hoy (día CR), de este local, y el socio estar en la ventana con el beneficio encendido y el artículo listo.
--     Núcleo interno club_cumple_usar_dia (p_hoy fijo en las pruebas; sin EXECUTE para la API).
--  4. club_cumple_uso_deshacer(p_uso, p_nota): solo owner; nota de 5 a 300 letras.
--  5. club_cumple_usos_listar(desde, hasta, local): owner y manager de su local (para ver y deshacer).
--  6. club_cumple_usos_resumen(desde, hasta, local): owner, manager de su local y contador; solo totales (usos, deshechos,
--     cortesías a costo con la regla del Tablero y usos sin el artículo en su factura). Solo cuenta la unidad VINCULADA a
--     una marca de cumpleaños: una cortesía sorteada (o de reto / primeros 90) con el mismo artículo no es de cumpleaños.
--
-- ── LO QUE NO TOCA ───────────────────────────────────────────────────────────────────────────────────────────────
--  · Ni plata nueva ni movimientos: es una marca; la cortesía sigue siendo el artículo de «CORTESÍA CLUB» a ₡0 en el PoS.
--  · Ni club_socio_visita, ni club_tablero_mes, ni club_excepciones, ni sagrados, ni envoltorios de la 170.
--
-- Va DESPUÉS de la 173 (y de la 174). Pruebas: scripts/sql/175_pruebas.sql (+ 175_pruebas.py; transacción descartada).
-- Rollback: scripts/sql/175_rollback.sql (antes que el de la 173).
begin;

do $$
begin
  if to_regprocedure('public.club_cumple_en_caja_dia(uuid,text,date)') is null
     or to_regprocedure('public.club_exigir_local(text)') is null
     or to_regclass('public.club_cumple_config') is null then
    raise exception '175: faltan la 173 o la 170 (club_cumple_en_caja_dia, club_cumple_config, club_exigir_local)';
  end if;
end $$;

-- ── 1. Las marcas ────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.club_cumple_usos (
  id              uuid primary key default gen_random_uuid(),
  miembro_id      uuid not null references public.club_miembros(id),
  anio            int not null check (anio between 2026 and 2200),        -- año DEL CUMPLEAÑOS (no el de la visita)
  location_id     text not null,
  visita_id       uuid not null references public.club_visitas_socio(id),
  visita_clave    text,                                                   -- copia de la visita: el pedido/factura
  cortesia_id     uuid references public.club_cortesias(id),
  cortesia_codigo text,                                                   -- el artículo configurado al marcar
  usado_por       uuid,
  usado_en        timestamptz not null default now(),
  deshecho_en     timestamptz,
  deshecho_por    uuid,
  deshecho_nota   text,
  check ((deshecho_en is null) = (deshecho_por is null) and (deshecho_en is null) = (deshecho_nota is null)),
  check (deshecho_nota is null or length(btrim(deshecho_nota)) between 5 and 300)
);
-- UNA marca vigente por socio y año del cumpleaños (en cualquier local) y una por visita
create unique index if not exists club_cumple_usos_anio_uq on public.club_cumple_usos (miembro_id, anio) where deshecho_en is null;
create unique index if not exists club_cumple_usos_visita_uq on public.club_cumple_usos (visita_id) where deshecho_en is null;
create index if not exists club_cumple_usos_local_idx on public.club_cumple_usos (location_id, usado_en);
alter table public.club_cumple_usos enable row level security;
revoke all on public.club_cumple_usos from public, anon, authenticated;
comment on table public.club_cumple_usos is
  '175: uso del beneficio de cumpleaños (una vez por socio y AÑO DEL CUMPLEAÑOS, en cualquier local). Lo marca la caja con '
  'club_cumple_usar sobre la visita del socio; solo el owner lo deshace (club_cumple_uso_deshacer, con nota y auditoría).';

-- La marca no se edita: solo se deshace UNA vez (de vigente a deshecha), con quién y nota
create or replace function public.club_cumple_usos_guardia()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.deshecho_en is not null
     or (new.id, new.miembro_id, new.anio, new.location_id, new.visita_id, new.visita_clave, new.cortesia_id,
         new.cortesia_codigo, new.usado_por, new.usado_en)
        is distinct from
        (old.id, old.miembro_id, old.anio, old.location_id, old.visita_id, old.visita_clave, old.cortesia_id,
         old.cortesia_codigo, old.usado_por, old.usado_en)
     or new.deshecho_en is null then
    raise exception 'La marca del cumpleaños no se cambia: solo el owner la deshace una vez' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.club_cumple_usos_guardia() from public, anon, authenticated;
drop trigger if exists club_cumple_usos_guardia_trg on public.club_cumple_usos;
create trigger club_cumple_usos_guardia_trg before update on public.club_cumple_usos
  for each row execute function public.club_cumple_usos_guardia();

-- ── 2. Caja: ¿hoy cae en su ventana? + ¿ya lo usó este año? (sin la fecha ni el año) ─────────────────────────────
create or replace function public.club_cumple_en_caja_dia(p_miembro uuid, p_location text, p_hoy date)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_cfg public.club_cumple_config%rowtype := public.club_cumple_cfg(p_location);
  v_c   public.club_miembros_contacto%rowtype;
  v_f   date;
begin
  select * into v_c from public.club_miembros_contacto c where c.miembro_id = p_miembro;
  if v_c.cumple_dia is not null then
    v_f := public.club_cumple_en_ventana(v_c.cumple_dia, v_c.cumple_mes, p_hoy, v_cfg.dias_antes, v_cfg.dias_despues);
  end if;
  if not v_cfg.activo or v_c.cumple_dia is null or v_c.cumple_permiso_en is null
     -- 175 · cruce de socios (dueño, 15-nov): socio activo de CUALQUIER local; la config es la del local de la CAJA
     or not exists (select 1 from public.club_miembros m where m.id = p_miembro and m.estado = 'activo')
     or not exists (select 1 from public.club_miembro_roles r where r.miembro_id = p_miembro and r.rol = 'socio' and r.estado = 'activo')
     or v_f is null then
    return jsonb_build_object('aplica', false);
  end if;
  -- 175: una vez por año DEL CUMPLEAÑOS, en cualquier local (el 3-ene en la ventana de un 30-dic cuenta para ese año)
  return jsonb_build_object('aplica', true,
           'ya_uso', exists (select 1 from public.club_cumple_usos u
                              where u.miembro_id = p_miembro and u.anio = extract(year from v_f)::int and u.deshecho_en is null))
         || (public.club_cumple_cfg_json(v_cfg) - 'reserva_url' - 'actualizado_en' - 'location_id');
end;
$$;
revoke all on function public.club_cumple_en_caja_dia(uuid, text, date) from public, anon, authenticated;

-- ── 3. Caja: marcar el uso sobre la visita registrada ────────────────────────────────────────────────────────────
-- Núcleo (sin permisos: lo llama club_cumple_usar; p_hoy fijo en las pruebas)
create or replace function public.club_cumple_usar_dia(p_visita uuid, p_location text, p_hoy date)
returns jsonb
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_v   public.club_visitas_socio%rowtype;
  v_cfg public.club_cumple_config%rowtype := public.club_cumple_cfg(p_location);
  v_c   public.club_miembros_contacto%rowtype;
  v_en  jsonb;
  v_f   date;
  v_k   public.club_cortesias%rowtype;
  v_id  uuid;
begin
  -- ORDEN DE CANDADOS (verificador, 15-nov): primero el candado del socio y DESPUÉS la fila de la visita, igual que
  -- club_socio_visita y club_reto_en_visita (169). Al revés, con un reto en la misma visita, las dos cajas se trababan.
  select * into v_v from public.club_visitas_socio s where s.id = p_visita;   -- sin candado: solo para saber el socio
  if not found then
    raise exception 'Esa visita no es de hoy en este local: registrá la visita del socio y marcalo ahí' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('club_socio_visita:' || v_v.miembro_id::text, 0));
  select * into v_v from public.club_visitas_socio s where s.id = p_visita for update;
  if not found or v_v.location_id is distinct from p_location or v_v.fecha is distinct from p_hoy then
    raise exception 'Esa visita no es de hoy en este local: registrá la visita del socio y marcalo ahí' using errcode = 'P0001';
  end if;
  v_en := public.club_cumple_en_caja_dia(v_v.miembro_id, p_location, p_hoy);
  if not coalesce((v_en->>'aplica')::boolean, false) then
    raise exception 'Hoy no le corresponde el beneficio de cumpleaños' using errcode = 'P0001';
  end if;
  if coalesce((v_en->>'ya_uso')::boolean, false) then
    raise exception 'Ya usó su beneficio de cumpleaños este año' using errcode = 'P0001';
  end if;
  select * into v_k from public.club_cortesias k where k.id = v_cfg.cortesia_id and k.location_id = p_location and k.activa;
  if not found then
    raise exception 'En este local no hay un artículo de cortesía activo para el cumpleaños: avisale al owner o al manager' using errcode = 'P0001';
  end if;
  select * into v_c from public.club_miembros_contacto c where c.miembro_id = v_v.miembro_id;
  v_f := public.club_cumple_en_ventana(v_c.cumple_dia, v_c.cumple_mes, p_hoy, v_cfg.dias_antes, v_cfg.dias_despues);
  begin
    insert into public.club_cumple_usos (miembro_id, anio, location_id, visita_id, visita_clave, cortesia_id, cortesia_codigo, usado_por)
    values (v_v.miembro_id, extract(year from v_f)::int, p_location, v_v.id, v_v.visita_clave, v_k.id, v_k.codigo_producto, auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Ya usó su beneficio de cumpleaños este año' using errcode = 'P0001';
  end;
  perform public.club_auditar('cumple_usar', 'club_cumple_usos', v_id, null,
    jsonb_build_object('miembro_id', v_v.miembro_id, 'local', p_location, 'visita_id', v_v.id));
  -- a la caja: sin la fecha ni el año
  return jsonb_build_object('ok', true, 'uso_id', v_id,
    'cortesia', jsonb_build_object('codigo', v_k.codigo_producto, 'nombre', v_k.nombre));
end;
$$;
revoke all on function public.club_cumple_usar_dia(uuid, text, date) from public, anon, authenticated;

create or replace function public.club_cumple_usar(p_visita uuid, p_location text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if public.get_my_role() is null or public.get_my_role() not in ('owner','manager','cajero') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  perform public.club_exigir_local(p_location);
  p_location := public.club_local(p_location, true);
  return public.club_cumple_usar_dia(p_visita, p_location, (now() at time zone 'America/Costa_Rica')::date);
end;
$$;
revoke all on function public.club_cumple_usar(uuid, text) from public, anon, authenticated;
grant execute on function public.club_cumple_usar(uuid, text) to authenticated;

-- ── 4. Deshacer (solo owner, con nota) ───────────────────────────────────────────────────────────────────────────
create or replace function public.club_cumple_uso_deshacer(p_uso uuid, p_nota text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_u    public.club_cumple_usos%rowtype;
  v_nota text := btrim(coalesce(p_nota, ''));
begin
  if public.get_my_role() is distinct from 'owner'::public.user_role then
    raise exception 'Solo el owner deshace una marca de cumpleaños' using errcode = '42501';
  end if;
  if length(v_nota) not between 5 and 300 then
    raise exception 'Escribí una nota de 5 a 300 letras: por qué se deshace' using errcode = 'P0001';
  end if;
  select * into v_u from public.club_cumple_usos u where u.id = p_uso for update;
  if not found then raise exception 'No se encontró esa marca: recargá la lista' using errcode = 'P0001'; end if;
  if v_u.deshecho_en is not null then raise exception 'Esa marca ya estaba deshecha' using errcode = 'P0001'; end if;
  update public.club_cumple_usos set deshecho_en = now(), deshecho_por = auth.uid(), deshecho_nota = v_nota where id = p_uso;
  perform public.club_auditar('cumple_uso_deshacer', 'club_cumple_usos', p_uso,
    jsonb_build_object('vigente', true, 'local', v_u.location_id, 'visita_id', v_u.visita_id),
    jsonb_build_object('vigente', false, 'nota', v_nota));
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.club_cumple_uso_deshacer(uuid, text) from public, anon, authenticated;
grant execute on function public.club_cumple_uso_deshacer(uuid, text) to authenticated;

-- ── 5. Lista de marcas (owner y manager de su local) ─────────────────────────────────────────────────────────────
create or replace function public.club_cumple_usos_listar(p_desde date, p_hasta date, p_location text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if public.get_my_role() is null or public.get_my_role() not in ('owner','manager') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  perform public.club_exigir_local(p_location);
  p_location := public.club_local(p_location, false);
  if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 400 then
    raise exception 'Período no válido (hasta 400 días)' using errcode = 'P0001';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', u.id, 'usado_en', u.usado_en, 'anio', u.anio, 'socio', public.club_nombre_limpio(m.nombre),
             'operador', coalesce((select p.full_name from public.profiles p where p.id = u.usado_por), 'Sin perfil'),
             'visita_clave', u.visita_clave, 'cortesia_codigo', u.cortesia_codigo,
             'deshecho_en', u.deshecho_en, 'deshecho_nota', u.deshecho_nota,
             'deshecho_por', (select p.full_name from public.profiles p where p.id = u.deshecho_por))
           order by u.usado_en desc)
      from public.club_cumple_usos u join public.club_miembros m on m.id = u.miembro_id
     where u.location_id = p_location
       and (u.usado_en at time zone 'America/Costa_Rica')::date between p_desde and p_hasta), '[]'::jsonb);
end;
$$;
revoke all on function public.club_cumple_usos_listar(date, date, text) from public, anon, authenticated;
grant execute on function public.club_cumple_usos_listar(date, date, text) to authenticated;

-- ── 6. Resumen para Tablero y Excepciones (solo totales) ─────────────────────────────────────────────────────────
-- Unidad de cumpleaños de una marca (la VINCULADA a la marca): en las facturas de su visita, las unidades del artículo
-- de la marca a ₡0 MENOS las que explica otra cortesía del Club de esa misma visita con el mismo artículo (sorteada o de
-- reto en club_visitas_socio.cortesias; la de primeros 90 en aplicar->primeros90 si se ofreció). Si queda ≥ 1, la marca
-- tiene su unidad (una por marca: el beneficio es uno). Así una cortesía sorteada no se cuenta como de cumpleaños.
-- Costo = la regla del Tablero (160) para cortesías: precio de lista = la referencia (moda del precio unitario cobrado
-- del artículo en los 30 días anteriores al día de la factura, en facturas C del local sin marcador de descuento activo;
-- empate → el más alto) o, sin referencia, el precio de la línea; × cantidad (1) × club_config.cortesia_costo_pct.
-- Diferencia con el Tablero: allá la referencia excluye además las facturas cruzadas con el Club del mes; el artículo de
-- «CORTESÍA CLUB» no se vende cobrado, así que en la práctica las dos caen al precio de la línea.
create or replace function public.club_cumple_usos_resumen_rango(p_desde date, p_hasta date, p_location text)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  with u as (
    select u.id, u.deshecho_en is null as vigente, u.cortesia_codigo as cod, v.cortesias, v.aplicar,
           public.club_cruce_facturas(u.location_id, v.pos_ref, null) as tids
      from public.club_cumple_usos u join public.club_visitas_socio v on v.id = u.visita_id
     where u.location_id = p_location
       and (u.usado_en at time zone 'America/Costa_Rica')::date between p_desde and p_hasta),
  x as (
    select u.*,
           coalesce((select sum(l.cantidad) from public.pos_ndf_ticket_lines l
                      where l.ticket_id = any (u.tids) and l.codigo_producto = u.cod
                        and coalesce(l.monto, 0) = 0 and coalesce(l.cantidad, 0) > 0), 0) as unidades,
           (select count(*) from jsonb_array_elements(coalesce(u.cortesias, '[]'::jsonb)) k where k->>'codigo' = u.cod)
           + case when u.aplicar->'primeros90'->>'estado' = 'ofrecida' and u.aplicar->'primeros90'->>'codigo' = u.cod then 1 else 0 end
             as otras,
           (select l.precio from public.pos_ndf_ticket_lines l
             where l.ticket_id = any (u.tids) and l.codigo_producto = u.cod
               and coalesce(l.monto, 0) = 0 and coalesce(l.cantidad, 0) > 0
             order by l.precio desc nulls last limit 1) as precio_linea,
           (select (coalesce(t.fecha_registra, t.fecha_cierra) at time zone 'America/Costa_Rica')::date
              from public.pos_ndf_tickets t where t.id = any (u.tids)
             order by t.fecha_registra limit 1) as dia
      from u),
  y as (
    select x.*, (x.unidades - x.otras) >= 1 as con_linea,
           coalesce(
             (select z.u from (
                select round(l.monto / l.cantidad, 2) as u, count(*) as n
                  from public.pos_ndf_ticket_lines l join public.pos_ndf_tickets t on t.id = l.ticket_id
                 where t.local = p_location and t.estado = 'C' and l.codigo_producto = x.cod
                   and l.cantidad > 0 and l.monto > 0 and not coalesce(l.es_cortesia, false) and not coalesce(l.es_pax, false)
                   and (t.fecha_registra at time zone 'America/Costa_Rica')::date >= x.dia - 30
                   and (t.fecha_registra at time zone 'America/Costa_Rica')::date < x.dia
                   and not exists (select 1 from public.pos_ndf_ticket_lines z2
                                     join public.club_marcadores_descuento k on k.location_id = p_location and k.activo
                                                                            and k.codigo_producto = z2.codigo_producto
                                    where z2.ticket_id = t.id)
                 group by 1) z order by z.n desc, z.u desc limit 1),
             nullif(x.precio_linea, 0)) as precio
      from x),
  t as (
    select count(*) filter (where vigente) as usos,
           count(*) filter (where not vigente) as deshechos,
           count(*) filter (where vigente and con_linea) as con_cortesia,
           count(*) filter (where vigente and cardinality(tids) > 0 and not con_linea) as sin_articulo,
           count(*) filter (where vigente and cardinality(tids) = 0) as sin_factura,
           count(*) filter (where vigente and con_linea and precio is null) as sin_precio,
           coalesce(sum(precio) filter (where vigente and con_linea), 0) as lista
      from y)
  select jsonb_build_object(
    'desde', p_desde, 'hasta', p_hasta, 'local', p_location,
    'usos', t.usos, 'deshechos', t.deshechos, 'con_cortesia', t.con_cortesia,
    'sin_articulo_en_factura', t.sin_articulo, 'sin_factura', t.sin_factura, 'sin_precio', t.sin_precio,
    'cortesia_costo_pct', c.cortesia_costo_pct,
    'cortesias_lista_crc', round(t.lista),
    'cortesias_costo_crc', round(t.lista * coalesce(c.cortesia_costo_pct, 0) / 100))
  from t left join public.club_config c on c.location_id = p_location
$$;
revoke all on function public.club_cumple_usos_resumen_rango(date, date, text) from public, anon, authenticated;

create or replace function public.club_cumple_usos_resumen(p_desde date, p_hasta date, p_location text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if public.get_my_role() is null or public.get_my_role() not in ('owner','manager','contador') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  perform public.club_exigir_local(p_location);
  p_location := public.club_local(p_location, false);
  if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 400 then
    raise exception 'Período no válido (hasta 400 días)' using errcode = 'P0001';
  end if;
  return public.club_cumple_usos_resumen_rango(p_desde, p_hasta, p_location);
end;
$$;
revoke all on function public.club_cumple_usos_resumen(date, date, text) from public, anon, authenticated;
grant execute on function public.club_cumple_usos_resumen(date, date, text) to authenticated;

-- Verificación (si algo no quedó como se espera, aborta y no queda nada)
do $$
begin
  if not has_function_privilege('authenticated', 'public.club_cumple_usar(uuid,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.club_cumple_uso_deshacer(uuid,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.club_cumple_usos_listar(date,date,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.club_cumple_usos_resumen(date,date,text)', 'EXECUTE') then
    raise exception '175: la caja, el owner y los reportes tienen que poder llamar a sus funciones';
  end if;
  if has_function_privilege('authenticated', 'public.club_cumple_usar_dia(uuid,text,date)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.club_cumple_usos_resumen_rango(date,date,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.club_cumple_usar(uuid,text)', 'EXECUTE')
     or has_table_privilege('authenticated', 'public.club_cumple_usos', 'SELECT')
     or has_table_privilege('authenticated', 'public.club_cumple_usos', 'INSERT')
     or has_table_privilege('anon', 'public.club_cumple_usos', 'SELECT') then
    raise exception '175: las internas y la tabla no se abren a la API';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'club_cumple_usos_anio_uq') then
    raise exception '175: falta el índice único por socio y año';
  end if;
end
$$;

commit;
