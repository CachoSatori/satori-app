begin; create function pg_temp.como(p_rol text, p_uid text) returns void language plpgsql as $f$ begin perform set_config('request.jwt.claims', json_build_object('role', p_rol, 'sub', p_uid)::text, true); execute format('set local role %I', p_rol); end $f$;
select pg_temp.como('authenticated', '<OWNER_UUID>');
select public.club_miembro_guardar('00000000-0000-4000-8000-0000000c0007', 'referente', 'Carrera 07 baja', null, 'baja', null);
select pg_sleep(4);
commit;
