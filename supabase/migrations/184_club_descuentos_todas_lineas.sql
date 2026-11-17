-- 184 (origen club 129) · Reporte de descuentos del Club: suma TODAS las líneas con descuento sin respaldo.
-- Decisión firmada por el dueño (17-nov-2026 02:13 CR, opción A).
--
-- Antes: club_reporte_descuentos (Club → Marcadores → «Reporte de descuentos sin artículo») sumaba, por factura con la
-- excepción DESCUENTO_SIN_RESPALDO, solo el descuento_crc de su «línea ejemplo» (la de mayor %; desde la 183, a igual %
-- la de mayor monto) y la clasificaba con el % de esa línea. Cuando el descuento es a toda la cuenta, todas las líneas
-- cumplen la regla y el reporte veía una sola: en staging, 400 días, ~1/3 del descuento sin respaldo.
--
-- Qué cambia (mínimo):
--   1. Núcleo de excepciones (club_excepciones__nucleo), 3 fragmentos exactos con guarda de md5 antes (el de la 183,
--      100caed1…) y después. La excepción sigue siendo UNA fila por factura con su línea ejemplo (la lista de Excepciones,
--      el contador del Inicio y la resolución no cambian). Se agregan al detalle:
--        · lineas_sin_respaldo: todas las líneas de la factura que cumplen la regla (mismas condiciones que la ejemplo),
--          cada una con su descuento_crc y SU clasificación (tipo del local por % ±1,5 puntos, o null = sin clasificar);
--        · descuento_crc_lineas: la suma de esas líneas.
--      La clasificación se calcula una vez por línea (la de la ejemplo sale de ahí: es la misma expresión).
--   2. club_reporte_descuentos__nucleo: suma las líneas (no la ejemplo), agrupando por la clasificación de cada línea.
--      «Facturas» = facturas con al menos una línea de esa clasificación en ese mes y turno (una factura con líneas de
--      dos clasificaciones cuenta en las dos filas).
--
-- Qué NO cambia: el envoltorio club_reporte_descuentos (a821af24…) ni club_excepciones / _abiertas, permisos
-- (EXECUTE, SECURITY DEFINER, search_path), la regla de qué línea es «sin respaldo», la línea ejemplo y su descuento_crc,
-- textos de la lista, índices y datos. Mes y turno: los de la factura en hora de Costa Rica, como antes.
--
-- Orden: DESPUÉS de la 183 (exige su núcleo). Vuelta atrás: scripts/sql/184_rollback.sql.
begin;

-- 1. Núcleo de excepciones: 3 fragmentos
do $$
declare
  v_fn  constant regprocedure := 'public.club_excepciones__nucleo(date,date,text,text)'::regprocedure;
  v_def text := pg_get_functiondef('public.club_excepciones__nucleo(date,date,text,text)'::regprocedure);
  r     record;
begin
  if md5(v_def) <> '100caed16f137eda0888deec497f9103' then
    raise exception '184: club_excepciones__nucleo no es la esperada (la de la 183) (md5 %): se para sin tocar nada', md5(v_def);
  end if;
  for r in select * from (values
    (0, $v0$      from (select k.*, r.ref
              from dcand k
$v0$, $n0$      from (select k.*, r.ref,
                   -- 184: la clasificación de CADA línea (antes solo la de la línea ejemplo; misma expresión)
                   (select dt.nombre from public.club_descuentos_tipo dt
                     where dt.location_id = p_location and dt.activo
                       and abs(100 * (1 - k.u / r.ref) - dt.pct) <= 1.5
                     order by abs(100 * (1 - k.u / r.ref) - dt.pct), dt.pct limit 1) as clas
              from dcand k
$n0$),
    (1, $v1$                              'clasificacion', (select dt.nombre from public.club_descuentos_tipo dt
                                                 where dt.location_id = p_location and dt.activo
                                                   and abs(100 * (1 - c.u / c.ref) - dt.pct) <= 1.5
                                                 order by abs(100 * (1 - c.u / c.ref) - dt.pct), dt.pct limit 1))
$v1$, $n1$                              'clasificacion', c.clas,
                              -- 184 (firma del dueño 17-nov 02:13, opción A): TODAS las líneas sin respaldo de la factura,
                              -- cada una con su clasificación; club_reporte_descuentos suma estas, no la ejemplo
                              'lineas_sin_respaldo', jsonb_agg(jsonb_build_object(
                                  'articulo', c.cod, 'nombre', c.nombre, 'precio', c.u, 'referencia', c.ref, 'cantidad', c.q,
                                  'descuento_pct', round(100 * (1 - c.u / c.ref), 1),
                                  'descuento_crc', round((c.ref - c.u) * c.q), 'clasificacion', c.clas)) over w,
                              'descuento_crc_lineas', sum(round((c.ref - c.u) * c.q)) over w)
$n1$),
    (2, $v2$      join tk t on t.id = c.tid
$v2$, $n2$      join tk t on t.id = c.tid
    -- 184: la ventana es toda la factura (todas sus líneas sin respaldo), en el mismo orden que elige la ejemplo
    window w as (partition by c.tid order by c.u / c.ref, round((c.ref - c.u) * c.q) desc, c.cod, c.nombre, c.u, c.q
                 rows between unbounded preceding and unbounded following)
$n2$)
  ) f(i, viejo, nuevo) order by f.i loop
    if position(r.viejo in v_def) = 0 or position(r.viejo in substr(v_def, position(r.viejo in v_def) + 1)) > 0 then
      raise exception '184: el fragmento % no está exactamente una vez', r.i;
    end if;
    v_def := replace(v_def, r.viejo, r.nuevo);
  end loop;
  execute v_def;
  if md5(pg_get_functiondef(v_fn)) <> '0b7b956e5670f617ace9ff9e6637f222' then
    raise exception '184: club_excepciones__nucleo quedó con md5 % (se esperaba 0b7b956e5670f617ace9ff9e6637f222)', md5(pg_get_functiondef(v_fn));
  end if;
end
$$;
revoke all on function public.club_excepciones__nucleo(date, date, text, text) from public, anon, authenticated;

-- 2. Reporte de descuentos: todas las líneas
do $$
begin
  if md5(pg_get_functiondef('public.club_reporte_descuentos__nucleo(date,date,text)'::regprocedure)) <> '30bba89bd3642f54b9e8ad95b08e1a29' then
    raise exception '184: club_reporte_descuentos__nucleo no es la esperada (md5 %): se para sin tocar nada',
      md5(pg_get_functiondef('public.club_reporte_descuentos__nucleo(date,date,text)'::regprocedure));
  end if;
end
$$;

create or replace function public.club_reporte_descuentos__nucleo(p_desde date, p_hasta date, p_location text default null)
returns table (mes text, tipo text, turno text, facturas int, descuento_crc numeric)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_rol public.user_role := public.get_my_role();
begin
  if v_rol is null or v_rol not in ('owner','manager') then raise exception 'Sin permiso' using errcode = '42501'; end if;
  p_location := public.club_local(p_location, false);
  if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 400 then
    raise exception 'Rango de fechas no válido (máximo 400 días)' using errcode = 'P0001';
  end if;
  -- 184: suma TODAS las líneas sin respaldo de cada factura (detalle.lineas_sin_respaldo), cada una en su clasificación.
  -- Facturas = facturas con al menos una línea de esa clasificación (n: una por fila de la excepción = una por factura).
  return query
    select to_char(e.fecha at time zone 'America/Costa_Rica', 'YYYY-MM'),
           coalesce(l.v->>'clasificacion', 'sin clasificar'), coalesce(e.detalle->>'turno', '—'),
           count(distinct e.n)::int, coalesce(sum((l.v->>'descuento_crc')::numeric), 0)
      from public.club_excepciones(p_desde, p_hasta, p_location, 'DESCUENTO_SIN_RESPALDO')
             with ordinality e(tipo, ref, fecha, factura, certeza, detalle, resuelta, nota, resuelta_en, n)
     cross join lateral jsonb_array_elements(e.detalle->'lineas_sin_respaldo') l(v)
     group by 1, 2, 3
     order by 1, (coalesce(l.v->>'clasificacion', 'sin clasificar') = 'sin clasificar') desc, 2, 3;
end;
$$;
revoke all on function public.club_reporte_descuentos__nucleo(date, date, text) from public, anon, authenticated;

-- Verificación (si algo no quedó como se espera, la transacción entera se deshace)
do $$
begin
  if md5(pg_get_functiondef('public.club_reporte_descuentos__nucleo(date,date,text)'::regprocedure)) <> '7a5e33e2565a1dc493965c007fa76058' then
    raise exception '184: club_reporte_descuentos__nucleo quedó con md5 %',
      md5(pg_get_functiondef('public.club_reporte_descuentos__nucleo(date,date,text)'::regprocedure));
  end if;
  if has_function_privilege('authenticated', 'public.club_excepciones__nucleo(date,date,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.club_reporte_descuentos__nucleo(date,date,text)', 'execute')
     or has_function_privilege('anon', 'public.club_reporte_descuentos(date,date,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.club_reporte_descuentos(date,date,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.club_excepciones(date,date,text,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.club_excepciones_abiertas(integer,text)', 'execute') then
    raise exception '184: los permisos no quedaron como antes';
  end if;
  if exists (select 1 from pg_proc p
              where p.oid in ('public.club_excepciones__nucleo(date,date,text,text)'::regprocedure,
                              'public.club_reporte_descuentos__nucleo(date,date,text)'::regprocedure)
                and not (p.prosecdef and p.proconfig = array['search_path=public, pg_temp'])) then
    raise exception '184: un núcleo perdió SECURITY DEFINER o su search_path';
  end if;
end
$$;

commit;
