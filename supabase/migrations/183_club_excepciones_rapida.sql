-- 183 (origen club 128) · Excepciones del Club más rápidas: el contador del Inicio (club_excepciones_abiertas)
-- tardaba hasta 9,3 s en prod (media 1,5 s en 71 llamadas, un 500 por el statement_timeout de 8 s de `authenticated`
-- el 16-nov 14:34 CR). Firma del dueño: 16-nov 21:40 CR.
--
-- Diagnóstico (16-nov, solo lectura en prod; EXPLAIN ANALYZE en staging, que tiene el mismo volumen):
--   · club_excepciones_abiertas no tiene lógica propia: cuenta lo que devuelve club_excepciones → __nucleo. Todo el
--     costo está en el NÚCLEO (las 22 verificaciones), no en el conteo.
--   · tk (facturas del rango) filtra por coalesce(fecha_registra, fecha_cierra): ningún índice sirve y recorre TODAS
--     las facturas del local (41 mil y creciendo) en cada llamada: ~470 ms con la caché fría.
--   · DESCUENTO_SIN_RESPALDO, regla del «cambio de lista»: una subconsulta por candidata recorre el CTE ddia entero
--     (~570 candidatas × ~3.500 filas ≈ 2 M filas por llamada): ~230–300 ms, también con la caché caliente.
--
-- Qué cambia (y nada más):
--   1. Índice de expresión pos_ndf_tickets (local, coalesce(fecha_registra, fecha_cierra)): la MISMA expresión del
--      filtro de tk, así el planificador lo usa sin tocar la consulta. Sin cambio de semántica.
--   2. NÚCLEO (club_excepciones__nucleo), dos fragmentos exactos de la regla del cambio de lista: ddia pasa a una fila
--      por (artículo, día) con sus precios y conteos en arreglos, y se cruza con un hash join (left join) en vez de una
--      subconsulta por candidata. La cuenta es la MISMA (Σ n con u ≤ u_candidata × 1,001 / Σ n, sobre las mismas filas;
--      sin filas → NULL → no pasa, igual que antes). Como en la 181: se toma la definición viva, se exige el md5 de la
--      181 (94cf0df9…), se reemplazan SOLO esos dos fragmentos (cada uno una sola vez) y se exige el md5 final.
--
-- Qué NO cambia: club_excepciones_abiertas, el envoltorio club_excepciones, permisos (EXECUTE, SECURITY DEFINER,
-- search_path), el resto de las verificaciones, los textos y el resultado (la batería 183 compara fila por fila).
-- No se hace un «conteo directo» aparte: duplicaría las 22 verificaciones (~400 líneas) y el número del Inicio se podría
-- separar de la lista de Excepciones con el próximo cambio del núcleo. Acelerar el núcleo acelera también la lista y las
-- alertas del Inicio.
--
-- Orden: después de la 181 (la exige) y de la 182. Vuelta atrás: scripts/sql/183_rollback.sql.
begin;

-- 1. Índice de la ventana de facturas (tk). 41 mil filas: se arma en menos de un segundo (mientras tanto el puente
--    espera para insertar facturas: no se pierde nada). El analyze le da al planificador las estadísticas de la
--    expresión; sin ellas sigue estimando mal y elige recorrer la tabla (visto en staging el 16-nov).
create index if not exists pos_ndf_tickets_local_fecha_efectiva_idx
  on public.pos_ndf_tickets (local, (coalesce(fecha_registra, fecha_cierra)));
analyze public.pos_ndf_tickets;

-- 2. Núcleo: la regla del cambio de lista sin recorrer ddia por cada candidata.
do $$
declare
  v_fn  constant regprocedure := 'public.club_excepciones__nucleo(date,date,text,text)'::regprocedure;
  v_def text := pg_get_functiondef('public.club_excepciones__nucleo(date,date,text,text)'::regprocedure);
  r     record;
begin
  if md5(v_def) <> '94cf0df9d0b189322b27d4d8b208a3e0' then
    raise exception '183: club_excepciones__nucleo no es la esperada (la de la 181) (md5 %): se para sin tocar nada', md5(v_def);
  end if;
  for r in select * from (values
    (1, $v1$  ddia as materialized (select cod, dia, u, count(*) as n from dpr where not mk_total group by cod, dia, u),
$v1$, $n1$  -- 183: una fila por (artículo, día) con sus precios y conteos (mismos datos que antes), para cruzarla con un join
  ddia as materialized (select z.cod, z.dia, array_agg(z.u) as us, array_agg(z.n) as ns
                          from (select cod, dia, u, count(*) as n from dpr where not mk_total group by cod, dia, u) z
                         group by z.cod, z.dia),
$n1$),
    (2, $v2$              join dref r on r.cod = k.cod and r.dia = k.dia
             where k.u < r.ref * 0.99
               -- cambio de lista: si ese día ≥ 60 % de las ventas del artículo van a ese precio (o menos), es el precio nuevo
               and (select sum(q.n) filter (where q.u <= k.u * 1.001)::numeric / nullif(sum(q.n), 0)
                      from ddia q where q.cod = k.cod and q.dia = k.dia) < 0.6
$v2$, $n2$              join dref r on r.cod = k.cod and r.dia = k.dia
              left join ddia q on q.cod = k.cod and q.dia = k.dia   -- 183: un join, no una pasada por candidata
             where k.u < r.ref * 0.99
               -- cambio de lista: si ese día ≥ 60 % de las ventas del artículo van a ese precio (o menos), es el precio nuevo
               and (select sum(x.n) filter (where x.u <= k.u * 1.001)::numeric / nullif(sum(x.n), 0)
                      from unnest(q.us, q.ns) x(u, n)) < 0.6
$n2$)
  ) f(i, viejo, nuevo) order by f.i loop
    if position(r.viejo in v_def) = 0 or position(r.viejo in substr(v_def, position(r.viejo in v_def) + 1)) > 0 then
      raise exception '183: el fragmento % no está exactamente una vez', r.i;
    end if;
    v_def := replace(v_def, r.viejo, r.nuevo);
  end loop;
  execute v_def;
  if md5(pg_get_functiondef(v_fn)) <> 'bd1b4d15e6ec6453d540c59b61d80d76' then
    raise exception '183: club_excepciones__nucleo quedó con md5 % (se esperaba bd1b4d15e6ec6453d540c59b61d80d76)', md5(pg_get_functiondef(v_fn));
  end if;
end
$$;
-- create or replace conserva los permisos; se repite el revoke de la 170/181 por las dudas
revoke all on function public.club_excepciones__nucleo(date, date, text, text) from public, anon, authenticated;

-- Verificación (si algo no quedó como se espera, la transacción entera se deshace)
do $$
begin
  if to_regclass('public.pos_ndf_tickets_local_fecha_efectiva_idx') is null then
    raise exception '183: falta el índice pos_ndf_tickets_local_fecha_efectiva_idx';
  end if;
  if has_function_privilege('authenticated', 'public.club_excepciones__nucleo(date,date,text,text)', 'execute')
     or has_function_privilege('anon', 'public.club_excepciones_abiertas(integer,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.club_excepciones_abiertas(integer,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.club_excepciones(date,date,text,text)', 'execute') then
    raise exception '183: los permisos de las excepciones no quedaron como antes';
  end if;
  if not (select p.prosecdef and p.proconfig = array['search_path=public, pg_temp'] from pg_proc p
           where p.oid = 'public.club_excepciones__nucleo(date,date,text,text)'::regprocedure) then
    raise exception '183: el núcleo perdió SECURITY DEFINER o su search_path';
  end if;
end
$$;

commit;
