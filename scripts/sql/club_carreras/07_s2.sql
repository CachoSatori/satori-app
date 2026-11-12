begin; create function pg_temp.como(p_rol text, p_uid text) returns void language plpgsql as $f$ begin perform set_config('request.jwt.claims', json_build_object('role', p_rol, 'sub', p_uid)::text, true); execute format('set local role %I', p_rol); end $f$;
select pg_temp.como('authenticated', '<CAJERO_UUID>');
do $$ begin
  perform public.club_cupon_usar('CARRERA777', 4, 'FCARRERA07', gen_random_uuid());
  perform set_config('club.res', 'acreditó', true);
exception when others then perform set_config('club.res', sqlerrm, true); end $$;
select current_setting('club.res', true) as resultado;
commit;
