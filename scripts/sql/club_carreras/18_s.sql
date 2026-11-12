-- CLUB-AUD-38: una de las 10 sesiones a la vez. Código equivocado (formato válido) para el miembro de la carrera 16.
-- Sin el lock, las 10 cuentan menos de 5 y anotan todas; con el lock, se anotan 5 y el resto queda bloqueado.
begin; create function pg_temp.como(p_rol text, p_uid text) returns void language plpgsql as $f$ begin perform set_config('request.jwt.claims', json_build_object('role', p_rol, 'sub', p_uid)::text, true); execute format('set local role %I', p_rol); end $f$;
select pg_temp.como('authenticated', '<CAJERO_UUID>');
select (select error from public.club_canje('00000000-0000-4000-8000-0000000c0016', 'ZZZZZ2', 1, 'FCARRERA18', gen_random_uuid())) as r;
select pg_sleep(0.5);
commit;
