-- BLOQUE C · humo combinado de la tanda (4a/4b de la 093 y la 095, y 4b de la 092 y la 094). SOLO LECTURA: solo conteos.
begin read only;
select set_config('request.jwt.claims', json_build_object('sub', (select p.id from public.profiles p where p.role = 'owner' and p.is_active
         order by p.created_at, p.id limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('humo.owner', json_build_object('hay_cuenta', (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub') is not null,
       'rol_visto', public.get_my_role(), 'ventas_dias', (select count(*) from public.ventas_dias), 'ventas_hist', (select count(*) from public.ventas_hist), 'ventas_metas', (select count(*) from public.ventas_metas), 'ventas_comps', (select count(*) from public.ventas_comps), 'product_map', (select count(*) from public.product_map), 'cash_movements', (select count(*) from public.cash_movements), 'cash_sessions', (select count(*) from public.cash_sessions), 'suppliers', (select count(*) from public.suppliers), 'employees', (select count(*) from public.employees), 'tip_entries', (select count(*) from public.tip_entries))::text, true);
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select p.id from public.profiles p where p.role = 'manager' and p.is_active
         order by p.created_at, p.id limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('humo.manager', json_build_object('hay_cuenta', (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub') is not null,
       'rol_visto', public.get_my_role(), 'ventas_dias', (select count(*) from public.ventas_dias), 'ventas_hist', (select count(*) from public.ventas_hist), 'ventas_metas', (select count(*) from public.ventas_metas), 'ventas_comps', (select count(*) from public.ventas_comps), 'product_map', (select count(*) from public.product_map), 'cash_movements', (select count(*) from public.cash_movements), 'cash_sessions', (select count(*) from public.cash_sessions), 'suppliers', (select count(*) from public.suppliers), 'employees', (select count(*) from public.employees), 'tip_entries', (select count(*) from public.tip_entries))::text, true);
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select p.id from public.profiles p where p.role = 'cajero' and p.is_active
         order by p.created_at, p.id limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('humo.cajero', json_build_object('hay_cuenta', (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub') is not null,
       'rol_visto', public.get_my_role(), 'ventas_dias', (select count(*) from public.ventas_dias), 'ventas_hist', (select count(*) from public.ventas_hist), 'ventas_metas', (select count(*) from public.ventas_metas), 'ventas_comps', (select count(*) from public.ventas_comps), 'product_map', (select count(*) from public.product_map), 'cash_movements', (select count(*) from public.cash_movements), 'cash_sessions', (select count(*) from public.cash_sessions), 'suppliers', (select count(*) from public.suppliers), 'employees', (select count(*) from public.employees), 'tip_entries', (select count(*) from public.tip_entries))::text, true);
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select p.id from public.profiles p where p.role = 'contador' and p.is_active
         order by p.created_at, p.id limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('humo.contador', json_build_object('hay_cuenta', (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub') is not null,
       'rol_visto', public.get_my_role(), 'ventas_dias', (select count(*) from public.ventas_dias), 'ventas_hist', (select count(*) from public.ventas_hist), 'ventas_metas', (select count(*) from public.ventas_metas), 'ventas_comps', (select count(*) from public.ventas_comps), 'product_map', (select count(*) from public.product_map), 'cash_movements', (select count(*) from public.cash_movements), 'cash_sessions', (select count(*) from public.cash_sessions), 'suppliers', (select count(*) from public.suppliers), 'employees', (select count(*) from public.employees), 'tip_entries', (select count(*) from public.tip_entries))::text, true);
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select p.id from public.profiles p where p.role = 'salonero' and p.is_active
         order by p.created_at, p.id limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('humo.salonero', json_build_object('hay_cuenta', (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub') is not null,
       'rol_visto', public.get_my_role(), 'ventas_dias', (select count(*) from public.ventas_dias), 'ventas_hist', (select count(*) from public.ventas_hist), 'ventas_metas', (select count(*) from public.ventas_metas), 'ventas_comps', (select count(*) from public.ventas_comps), 'product_map', (select count(*) from public.product_map), 'cash_movements', (select count(*) from public.cash_movements), 'cash_sessions', (select count(*) from public.cash_sessions), 'suppliers', (select count(*) from public.suppliers), 'employees', (select count(*) from public.employees), 'tip_entries', (select count(*) from public.tip_entries))::text, true);
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select p.id from public.profiles p where p.is_active = false
         order by p.created_at, p.id limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('humo.inactiva', json_build_object('hay_cuenta', (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub') is not null,
       'rol_visto', public.get_my_role(), 'ventas_dias', (select count(*) from public.ventas_dias), 'ventas_hist', (select count(*) from public.ventas_hist), 'ventas_metas', (select count(*) from public.ventas_metas), 'ventas_comps', (select count(*) from public.ventas_comps), 'product_map', (select count(*) from public.product_map), 'cash_movements', (select count(*) from public.cash_movements), 'cash_sessions', (select count(*) from public.cash_sessions), 'suppliers', (select count(*) from public.suppliers), 'employees', (select count(*) from public.employees), 'tip_entries', (select count(*) from public.tip_entries))::text, true);
reset role;
select current_setting('humo.owner')::json as owner, current_setting('humo.manager')::json as manager, current_setting('humo.cajero')::json as cajero, current_setting('humo.contador')::json as contador, current_setting('humo.salonero')::json as salonero, current_setting('humo.inactiva')::json as inactiva,
       json_build_object('ventas_dias', (select count(*) from public.ventas_dias), 'ventas_hist', (select count(*) from public.ventas_hist), 'ventas_metas', (select count(*) from public.ventas_metas), 'ventas_comps', (select count(*) from public.ventas_comps), 'product_map', (select count(*) from public.product_map), 'cash_movements', (select count(*) from public.cash_movements), 'cash_sessions', (select count(*) from public.cash_sessions), 'suppliers', (select count(*) from public.suppliers), 'employees', (select count(*) from public.employees), 'tip_entries', (select count(*) from public.tip_entries)) as base;
rollback;
