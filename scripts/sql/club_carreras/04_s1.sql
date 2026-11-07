-- Los cierres son inmutables (CLUB-AUD-16): esta sesión termina SIEMPRE en ROLLBACK.
begin; create function pg_temp.como(p_rol text, p_uid text) returns void language plpgsql as $f$ begin perform set_config('request.jwt.claims', json_build_object('role', p_rol, 'sub', p_uid)::text, true); execute format('set local role %I', p_rol); end $f$;
select pg_temp.como('authenticated', '<OWNER_UUID>');
select set_config('club.v', (public.club_reporte_cerrar((date_trunc('month', now() at time zone 'America/Costa_Rica') - interval '3 months')::date, null))->>'version', true);
select pg_sleep(4);
select current_setting('club.v') as version, clock_timestamp() as fin_tx;
rollback;
