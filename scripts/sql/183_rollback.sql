-- Rollback de la 183 (origen club 128): excepciones del Club más rápidas. Vuelve club_excepciones__nucleo a la de la
-- 181 (md5 94cf0df9…) deshaciendo EXACTAMENTE los dos fragmentos de la 183 (exige el md5 de la 183 antes y el de la 181
-- después) y borra el índice pos_ndf_tickets_local_fecha_efectiva_idx. No toca datos: el resultado de las excepciones es
-- el mismo antes y después (solo cambia el tiempo). Borra la fila 183 del ledger. Si se corre en prod, en el mismo
-- momento sale el .sql de la 183 de main (si queda, Branching la vuelve a aplicar; regla 10 / satori-migraciones-y-prod §6).
begin;

do $$
declare
  v_fn  constant regprocedure := 'public.club_excepciones__nucleo(date,date,text,text)'::regprocedure;
  v_def text := pg_get_functiondef('public.club_excepciones__nucleo(date,date,text,text)'::regprocedure);
  r     record;
begin
  if md5(v_def) <> 'bd1b4d15e6ec6453d540c59b61d80d76' then
    raise exception '183-rollback: club_excepciones__nucleo no es la de la 183 (md5 %): se para sin tocar nada', md5(v_def);
  end if;
  for r in select * from (values
    (1, $n1$  -- 183: una fila por (artículo, día) con sus precios y conteos (mismos datos que antes), para cruzarla con un join
  ddia as materialized (select z.cod, z.dia, array_agg(z.u) as us, array_agg(z.n) as ns
                          from (select cod, dia, u, count(*) as n from dpr where not mk_total group by cod, dia, u) z
                         group by z.cod, z.dia),
$n1$, $v1$  ddia as materialized (select cod, dia, u, count(*) as n from dpr where not mk_total group by cod, dia, u),
$v1$),
    (2, $n2$              join dref r on r.cod = k.cod and r.dia = k.dia
              left join ddia q on q.cod = k.cod and q.dia = k.dia   -- 183: un join, no una pasada por candidata
             where k.u < r.ref * 0.99
               -- cambio de lista: si ese día ≥ 60 % de las ventas del artículo van a ese precio (o menos), es el precio nuevo
               and (select sum(x.n) filter (where x.u <= k.u * 1.001)::numeric / nullif(sum(x.n), 0)
                      from unnest(q.us, q.ns) x(u, n)) < 0.6
$n2$, $v2$              join dref r on r.cod = k.cod and r.dia = k.dia
             where k.u < r.ref * 0.99
               -- cambio de lista: si ese día ≥ 60 % de las ventas del artículo van a ese precio (o menos), es el precio nuevo
               and (select sum(q.n) filter (where q.u <= k.u * 1.001)::numeric / nullif(sum(q.n), 0)
                      from ddia q where q.cod = k.cod and q.dia = k.dia) < 0.6
$v2$)
  ) f(i, actual, anterior) order by f.i loop
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

drop index if exists public.pos_ndf_tickets_local_fecha_efectiva_idx;

delete from supabase_migrations.schema_migrations where version = '183';

commit;
