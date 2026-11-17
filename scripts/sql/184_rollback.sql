-- Vuelta atrás de la 184 (club_descuentos_todas_lineas). Exige el estado exacto de la 184 (md5 de los dos núcleos);
-- vuelve el núcleo de excepciones al de la 183 (100caed1…) y el reporte de descuentos al de la 170 (30bba89b…), y borra
-- la fila 184 del ledger. EN EL MISMO MOMENTO: un PR que saca supabase/migrations/184_club_descuentos_todas_lineas.sql de
-- main (si queda, Branching la vuelve a aplicar; regla 10). No hay datos ni índices que volver.
begin;

do $$
declare
  v_fn  constant regprocedure := 'public.club_excepciones__nucleo(date,date,text,text)'::regprocedure;
  v_def text := pg_get_functiondef('public.club_excepciones__nucleo(date,date,text,text)'::regprocedure);
  r     record;
begin
  if md5(v_def) <> '0b7b956e5670f617ace9ff9e6637f222' then
    raise exception '184 rollback: club_excepciones__nucleo no es la de la 184 (md5 %): se para sin tocar nada', md5(v_def);
  end if;
  if md5(pg_get_functiondef('public.club_reporte_descuentos__nucleo(date,date,text)'::regprocedure)) <> '7a5e33e2565a1dc493965c007fa76058' then
    raise exception '184 rollback: club_reporte_descuentos__nucleo no es la de la 184: se para sin tocar nada';
  end if;
  for r in select * from (values
    (0, $v0$      from (select k.*, r.ref,
                   -- 184: la clasificación de CADA línea (antes solo la de la línea ejemplo; misma expresión)
                   (select dt.nombre from public.club_descuentos_tipo dt
                     where dt.location_id = p_location and dt.activo
                       and abs(100 * (1 - k.u / r.ref) - dt.pct) <= 1.5
                     order by abs(100 * (1 - k.u / r.ref) - dt.pct), dt.pct limit 1) as clas
              from dcand k
$v0$, $n0$      from (select k.*, r.ref
              from dcand k
$n0$),
    (1, $v1$                              'clasificacion', c.clas,
                              -- 184 (firma del dueño 17-nov 02:13, opción A): TODAS las líneas sin respaldo de la factura,
                              -- cada una con su clasificación; club_reporte_descuentos suma estas, no la ejemplo
                              'lineas_sin_respaldo', jsonb_agg(jsonb_build_object(
                                  'articulo', c.cod, 'nombre', c.nombre, 'precio', c.u, 'referencia', c.ref, 'cantidad', c.q,
                                  'descuento_pct', round(100 * (1 - c.u / c.ref), 1),
                                  'descuento_crc', round((c.ref - c.u) * c.q), 'clasificacion', c.clas)) over w,
                              'descuento_crc_lineas', sum(round((c.ref - c.u) * c.q)) over w)
$v1$, $n1$                              'clasificacion', (select dt.nombre from public.club_descuentos_tipo dt
                                                 where dt.location_id = p_location and dt.activo
                                                   and abs(100 * (1 - c.u / c.ref) - dt.pct) <= 1.5
                                                 order by abs(100 * (1 - c.u / c.ref) - dt.pct), dt.pct limit 1))
$n1$),
    (2, $v2$      join tk t on t.id = c.tid
    -- 184: la ventana es toda la factura (todas sus líneas sin respaldo), en el mismo orden que elige la ejemplo
    window w as (partition by c.tid order by c.u / c.ref, round((c.ref - c.u) * c.q) desc, c.cod, c.nombre, c.u, c.q
                 rows between unbounded preceding and unbounded following)
$v2$, $n2$      join tk t on t.id = c.tid
$n2$)
  ) f(i, viejo, nuevo) order by f.i desc loop
    if position(r.viejo in v_def) = 0 or position(r.viejo in substr(v_def, position(r.viejo in v_def) + 1)) > 0 then
      raise exception '184 rollback: el fragmento % no está exactamente una vez', r.i;
    end if;
    v_def := replace(v_def, r.viejo, r.nuevo);
  end loop;
  execute v_def;
  if md5(pg_get_functiondef(v_fn)) <> '100caed16f137eda0888deec497f9103' then
    raise exception '184 rollback: el núcleo no volvió al de la 183 (md5 %)', md5(pg_get_functiondef(v_fn));
  end if;
end
$$;
revoke all on function public.club_excepciones__nucleo(date, date, text, text) from public, anon, authenticated;

-- El reporte, como lo dejó la 150 (renombrado a __nucleo por la 170)
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
  return query
    select to_char(e.fecha at time zone 'America/Costa_Rica', 'YYYY-MM'),
           coalesce(e.detalle->>'clasificacion', 'sin clasificar'), coalesce(e.detalle->>'turno', '—'),
           count(*)::int, coalesce(sum((e.detalle->>'descuento_crc')::numeric), 0)
      from public.club_excepciones(p_desde, p_hasta, p_location, 'DESCUENTO_SIN_RESPALDO') e
     group by 1, 2, 3
     order by 1, (coalesce(e.detalle->>'clasificacion', 'sin clasificar') = 'sin clasificar') desc, 2, 3;
end;
$$;
revoke all on function public.club_reporte_descuentos__nucleo(date, date, text) from public, anon, authenticated;

do $$
begin
  if md5(pg_get_functiondef('public.club_reporte_descuentos__nucleo(date,date,text)'::regprocedure)) <> '30bba89bd3642f54b9e8ad95b08e1a29' then
    raise exception '184 rollback: el reporte no volvió al de antes (md5 %)',
      md5(pg_get_functiondef('public.club_reporte_descuentos__nucleo(date,date,text)'::regprocedure));
  end if;
  if has_function_privilege('authenticated', 'public.club_reporte_descuentos__nucleo(date,date,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.club_reporte_descuentos(date,date,text)', 'execute') then
    raise exception '184 rollback: permisos distintos de los de antes';
  end if;
end
$$;

delete from supabase_migrations.schema_migrations where version = '184';

commit;
