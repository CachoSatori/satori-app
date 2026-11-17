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
-- Qué cambia (y nada más), todo en el NÚCLEO (club_excepciones__nucleo), con 4 fragmentos exactos. Como en la 181:
-- se toma la definición viva, se exige el md5 de la 181 (94cf0df9…), se reemplazan SOLO esos fragmentos (cada uno una
-- sola vez) y se exige el md5 final.
--   1. tk filtra por fecha_registra en vez de coalesce(fecha_registra, fecha_cierra). fecha_registra es NOT NULL (la
--      migración lo exige), así que es la misma condición; escrita así usa el índice que ya existe
--      pos_ndf_tickets_local_fecha_idx (local, fecha_registra). No hace falta un índice nuevo (medido en staging: mismo
--      plan y mismas páginas que un índice de expresión).
--   2 y 3. Regla del cambio de lista: ddia pasa a una fila por (artículo, día) con sus precios y conteos en arreglos, y
--      se cruza con un hash join (left join) en vez de una subconsulta por candidata. La cuenta es la MISMA (Σ n con
--      u ≤ u_candidata × 1,001 / Σ n, sobre las mismas filas; sin filas → NULL → no pasa, igual que antes).
--   4. DESCUENTO_SIN_RESPALDO muestra una línea por factura (la de mayor %). Si varias empatan en el %, cuál salía era
--      arbitrario y dependía del plan, y club_reporte_descuentos suma el descuento_crc de esa línea: en staging, 17
--      facturas de 998 (400 días) empataban con montos distintos. Desempate FIJO: a igual %, la de mayor monto; después
--      artículo, nombre, precio y cantidad (pedido del verificador independiente, 16-nov).
--
-- Qué NO cambia: club_excepciones_abiertas, el envoltorio club_excepciones, permisos (EXECUTE, SECURITY DEFINER,
-- search_path), el resto de las verificaciones, los textos, índices y datos. El conteo y las excepciones son los mismos;
-- solo el ejemplo de las facturas con empate queda fijo (batería 183).
-- No se hace un «conteo directo» aparte: duplicaría las 22 verificaciones (~400 líneas) y el número del Inicio se podría
-- separar de la lista de Excepciones con el próximo cambio del núcleo. Acelerar el núcleo acelera también la lista y las
-- alertas del Inicio.
--
-- Orden: después de la 181 (la exige) y de la 182. Vuelta atrás: scripts/sql/183_rollback.sql.
begin;

-- La equivalencia del fragmento 1 depende de que fecha_registra no admita nulos: si algún día deja de serlo, se para.
do $$
begin
  if not (select a.attnotnull from pg_attribute a
           where a.attrelid = 'public.pos_ndf_tickets'::regclass and a.attname = 'fecha_registra' and not a.attisdropped) then
    raise exception '183: pos_ndf_tickets.fecha_registra admite nulos: el filtro de tk no sería equivalente; se para sin tocar nada';
  end if;
end
$$;

-- Núcleo: los 4 fragmentos.
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
    (0, $v0$     where t.local = p_location and coalesce(t.fecha_registra, t.fecha_cierra) >= v_ini
       and coalesce(t.fecha_registra, t.fecha_cierra) < v_fin),
$v0$, $n0$     -- 183: fecha_registra es NOT NULL, así que es lo mismo que coalesce(fecha_registra, fecha_cierra); escrito así
     -- usa el índice (local, fecha_registra) en vez de recorrer todas las facturas del local
     where t.local = p_location and t.fecha_registra >= v_ini
       and t.fecha_registra < v_fin),
$n0$),
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
$n2$),
    (3, $v3$     order by c.tid, c.u / c.ref)
$v3$, $n3$     -- 183: a igual %, la línea de mayor monto (y después artículo, nombre, precio, cantidad): el ejemplo ya no depende
     -- del plan y club_reporte_descuentos suma siempre lo mismo
     order by c.tid, c.u / c.ref, round((c.ref - c.u) * c.q) desc, c.cod, c.nombre, c.u, c.q)
$n3$)
  ) f(i, viejo, nuevo) order by f.i loop
    if position(r.viejo in v_def) = 0 or position(r.viejo in substr(v_def, position(r.viejo in v_def) + 1)) > 0 then
      raise exception '183: el fragmento % no está exactamente una vez', r.i;
    end if;
    v_def := replace(v_def, r.viejo, r.nuevo);
  end loop;
  execute v_def;
  if md5(pg_get_functiondef(v_fn)) <> '100caed16f137eda0888deec497f9103' then
    raise exception '183: club_excepciones__nucleo quedó con md5 % (se esperaba 100caed16f137eda0888deec497f9103)', md5(pg_get_functiondef(v_fn));
  end if;
end
$$;
-- create or replace conserva los permisos; se repite el revoke de la 170/181 por las dudas
revoke all on function public.club_excepciones__nucleo(date, date, text, text) from public, anon, authenticated;

-- Verificación (si algo no quedó como se espera, la transacción entera se deshace)
do $$
begin
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
