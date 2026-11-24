-- 198 · lecturas previas del pase (PASE-198 §4). SOLO LECTURA: `begin read only` … `rollback`, sirve en prod
-- (yiczgdti…) y en staging (hwiatgic…). Un solo resultado (jsonb), para que entre en una llamada del conector.
-- Devuelve CÓDIGOS y CONTEOS, nunca nombres de productos ni de personas (el repo es público): los nombres de la lista
-- de los 82 códigos y de los que heredan «rinde» los mira el dueño en la consulta, no se copian al repo.
-- Fechas: «hoy» = 24-nov-2026 (último mes cerrado = octubre; 12 meses = 2025-11-24..2026-11-23; último 31-dic = 2025-12-31).
begin read only;
with
lista (codigo, categoria) as (
  select unnest(array['124', '125', '373', '679', '680', '681', '682', '685', '686', '687', '688', '689', '691', '692', '693',
                      '694', '698', '740', '304', '306', '577', '579', '930', '934']), 'comida'
  union all
  select unnest(array['235', '238', '245', '643', '700', '701', '702', '714', '722', '727', '728', '738', '742', '743', '746',
                      '747', '750', '753', '757', '758', '308', '312', '455', '5', '519', '559', '695', '843', '844', '860',
                      '861', '862', '863', '864', '866', '867', '870', '871', '872', '879', '880', '881', '882', '917', '918',
                      '921', '922', '925', '926', '1026', '1027', '1036', '1037', '1038', '1056', '1057', '1062']), 'bebida'
  union all select '192', 'menu_especial'
),
l as (
  select t.id as ticket_id, t.estado, t.canal, (t.fecha_registra at time zone 'America/Costa_Rica')::date as dia,
         case when coalesce(t.pax_articulo, 0) > 0 then t.pax_articulo else coalesce(t.pax, 0) end as pax_t,
         btrim(x.codigo_producto) as codigo, x.familia, floor(coalesce(x.cantidad, 0) + 0.5) as u,
         floor(coalesce(x.monto, 0) * 100 + 0.5) as cts, x.monto
  from public.pos_ndf_tickets t join public.pos_ndf_ticket_lines x on x.ticket_id = t.id
  where t.local = 'santa-teresa'
),
-- categoría de HOY (antes de la 198: la familia; 11, 15 y 25 caen en «otros») y la de DESPUÉS (lista + mayoría)
c as (
  select l.*,
         case when familia in (2, 3, 4, 13, 16, 29) then 'comida' when familia = 5 then 'bebida'
              when familia in (6, 17, 20) then 'no_venta' else 'otros' end as antes,
         case when familia in (6, 17, 20) then 'no_venta'
              when familia in (11, 15, 25) then coalesce(li.categoria, case when familia = 25 then 'bebida' else 'comida' end)
              when familia in (2, 3, 4, 13, 16, 29, 9) then 'comida' when familia in (5, 1) then 'bebida' else 'otros' end as despues
  from l left join lista li on li.codigo = l.codigo
),
periodos (p, d, h) as (values ('ultimo_mes_cerrado', date '2026-10-01', date '2026-10-31'),
                              ('ultimos_12_meses', date '2025-11-24', date '2026-11-23'),
                              ('ultimo_31_dic', date '2025-12-31', date '2025-12-31')),
reparto as (
  select pe.p, x.lado, x.cat, sum(c.cts) as cts
  from periodos pe join c on c.estado = 'C' and c.dia between pe.d and pe.h
  cross join lateral (values ('antes', c.antes), ('despues', c.despues)) x(lado, cat)
  group by 1, 2, 3
),
bebidas as (
  -- bebidas por persona (salón): unidades VENDIDAS (monto > 0) de categoría bebida ÷ personas de salón
  select pe.p,
         sum(c.u) filter (where c.canal = 'salon' and c.antes = 'bebida' and c.cts > 0) as u_antes,
         sum(c.u) filter (where c.canal = 'salon' and c.despues = 'bebida' and c.cts > 0) as u_despues,
         sum(c.u) filter (where c.canal = 'salon' and c.despues = 'bebida' and c.cts = 0) as u_incluidas_despues,
         (select sum(x.pax_t) from (select distinct c2.ticket_id, c2.pax_t from c c2
                                    where c2.estado = 'C' and c2.canal = 'salon' and c2.dia between pe.d and pe.h) x) as pax_salon
  from periodos pe join c on c.estado = 'C' and c.dia between pe.d and pe.h
  group by pe.p, pe.d, pe.h
)
select jsonb_build_object(
  'ref_y_ledger', (select max(version) from supabase_migrations.schema_migrations),
  'ya_existe_algo_de_la_198', jsonb_build_array(to_regclass('public.pos_familias'), to_regclass('public.pos_productos'),
      to_regclass('public.pos_producto_ajustes'), to_regprocedure('public.pos_ventas_productos(text,date,date)'),
      to_regprocedure('public.pos_catalogo_productos(text)'), to_regprocedure('public.pos_producto_ajuste_guardar(text,text,integer,text)')),
  'disparadores_en_lineas', (select count(*) from pg_trigger where tgrelid = 'public.pos_ndf_ticket_lines'::regclass and not tgisinternal),
  'lineas_facturas_locales', jsonb_build_array((select count(*) from public.pos_ndf_ticket_lines), (select count(*) from public.pos_ndf_tickets),
      (select count(distinct local) from public.pos_ndf_tickets)),
  'lineas_con_fraccion_de_centimo', (select count(*) from public.pos_ndf_ticket_lines where monto * 100 <> floor(monto * 100)),
  'codigos', (select count(distinct (t.local, btrim(x.codigo_producto))) from public.pos_ndf_ticket_lines x join public.pos_ndf_tickets t on t.id = x.ticket_id
              where nullif(btrim(x.codigo_producto), '') is not null),
  'codigos_largos_o_vacios', (select count(*) from public.pos_ndf_ticket_lines where nullif(btrim(codigo_producto), '') is null or length(btrim(codigo_producto)) > 40),
  'codigos_con_mas_de_un_nombre_o_familia', (select count(*) from (select btrim(codigo_producto) from public.pos_ndf_ticket_lines
              where nullif(btrim(codigo_producto), '') is not null group by 1
              having count(distinct btrim(nombre)) > 1 or count(distinct familia) > 1) x),
  'familias_con_productos', (select jsonb_agg(f order by f) from (select distinct familia f from l where familia is not null) x),
  'codigos_11_15_25_por_familia', (select jsonb_object_agg(familia, n) from (select familia, count(distinct codigo) n from l
              where familia in (11, 15, 25) group by 1) x),
  'codigos_11_15_25_fuera_de_la_lista', (select coalesce(jsonb_agg(distinct codigo), '[]') from l where familia in (11, 15, 25)
              and codigo not in (select codigo from lista)),
  'codigos_de_la_lista_en_otra_familia', (select coalesce(jsonb_agg(distinct codigo), '[]') from l join lista using (codigo)
              where l.familia not in (11, 15, 25)),
  'familia_11_con_monto', (select coalesce(jsonb_agg(distinct codigo), '[]') from l where familia = 11 and cts <> 0),
  'product_map', jsonb_build_object('filas', (select count(*) from public.product_map),
      'multiplicador_mayor_a_1', (select count(*) from public.product_map where multiplicador >= 2),
      'codigos_que_heredan_rinde', (select coalesce(jsonb_agg(jsonb_build_array(codigo, rinde) order by codigo), '[]') from (
          select distinct btrim(x.codigo_producto) codigo, least(pm.multiplicador, 20) rinde
          from public.pos_ndf_ticket_lines x join public.product_map pm on upper(btrim(pm.nombre)) = upper(btrim(x.nombre))
          where pm.multiplicador >= 2 and nullif(btrim(x.codigo_producto), '') is not null) y),
      'codigos_vendidos_sin_fila', (select count(distinct btrim(x.codigo_producto)) from public.pos_ndf_ticket_lines x
          where not exists (select 1 from public.product_map pm where upper(btrim(pm.nombre)) = upper(btrim(x.nombre))))),
  'reparto_antes_despues_cts', (select jsonb_object_agg(p, r) from (select p, jsonb_object_agg(lado || ':' || cat, cts) r from reparto group by p) x),
  'bebidas_por_persona_salon', (select jsonb_object_agg(p, jsonb_build_object('antes', round(u_antes::numeric / nullif(pax_salon, 0), 3),
      'despues', round(u_despues::numeric / nullif(pax_salon, 0), 3), 'incluidas_aparte', u_incluidas_despues,
      'unidades_antes', u_antes, 'unidades_despues', u_despues, 'pax', pax_salon)) from bebidas)
) as lecturas_198;
rollback;
