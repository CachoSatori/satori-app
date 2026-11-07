begin; create function pg_temp.como(p_rol text, p_uid text) returns void language plpgsql as $f$ begin perform set_config('request.jwt.claims', json_build_object('role', p_rol, 'sub', p_uid)::text, true); execute format('set local role %I', p_rol); end $f$;
select pg_temp.como('authenticated', '<CAJERO_UUID>');
select row_to_json(t) as canje from public.club_canje('00000000-0000-4000-8000-0000000c0003', 1, 'FCARRERA03', gen_random_uuid()) t;
select pg_sleep(4);
commit;
