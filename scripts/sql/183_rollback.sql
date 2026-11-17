-- Rollback de la 183 (origen club 128): excepciones del Club más rápidas. Vuelve club_excepciones__nucleo a la de la
-- 181 (md5 94cf0df9…) deshaciendo EXACTAMENTE los 4 fragmentos de la 183: exige el md5 de la 183 antes y el de la 181
-- después. Los fragmentos son los mismos de la migración (columnas «anterior» y «actual»). No toca datos ni índices
-- (la 183 no crea ninguno): el resultado de las excepciones es el mismo antes y después; solo vuelve a ser arbitraria la
-- línea ejemplo de las facturas con empate en DESCUENTO_SIN_RESPALDO. Borra la fila 183 del ledger. Si se corre en prod,
-- en el mismo momento sale el .sql de la 183 de main (si queda, Branching la vuelve a aplicar; regla 10 /
-- satori-migraciones-y-prod §6).
begin;

do $$
declare
  v_fn  constant regprocedure := 'public.club_excepciones__nucleo(date,date,text,text)'::regprocedure;
  v_def text := pg_get_functiondef('public.club_excepciones__nucleo(date,date,text,text)'::regprocedure);
  r     record;
begin
  if md5(v_def) <> '100caed16f137eda0888deec497f9103' then
    raise exception '183-rollback: club_excepciones__nucleo no es la de la 183 (md5 %): se para sin tocar nada', md5(v_def);
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
  ) f(i, anterior, actual) order by f.i loop
    if position(r.actual in v_def) = 0 or position(r.actual in substr(v_def, position(r.actual in v_def) + 1)) > 0 then
      raise exception '183-rollback: el fragmento % no está exactamente una vez', r.i;
    end if;
    v_def := replace(v_def, r.actual, r.anterior);
  end loop;
  execute v_def;
  if md5(pg_get_functiondef(v_fn)) <> '94cf0df9d0b189322b27d4d8b208a3e0' then
    raise exception '183-rollback: el núcleo quedó con md5 % (se esperaba el de la 181, 94cf0df9…)', md5(pg_get_functiondef(v_fn));
  end if;
end
$$;
revoke all on function public.club_excepciones__nucleo(date, date, text, text) from public, anon, authenticated;

delete from supabase_migrations.schema_migrations where version = '183';

commit;
