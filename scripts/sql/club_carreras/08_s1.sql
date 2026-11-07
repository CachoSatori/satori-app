begin; create function pg_temp.como(p_rol text, p_uid text) returns void language plpgsql as $f$ begin perform set_config('request.jwt.claims', json_build_object('role', p_rol, 'sub', p_uid)::text, true); execute format('set local role %I', p_rol); end $f$;
select pg_temp.como('authenticated', '<CAJERO_UUID>');
select set_config('club.r', (select row_to_json(t)::text from public.club_canje('00000000-0000-4000-8000-0000000c0008', 'CARRZ8', 1, 'FCARRERA08', '00000000-0000-4000-8000-0000000c00aa') t), true);
select pg_sleep(3);
select current_setting('club.r')::json as r;
commit;
