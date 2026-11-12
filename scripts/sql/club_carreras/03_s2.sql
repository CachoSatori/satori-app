-- ⚠️ club_vencer vence TODAS las cuentas candidatas: esta sesión termina SIEMPRE en ROLLBACK.
begin; create function pg_temp.como(p_rol text, p_uid text) returns void language plpgsql as $f$ begin perform set_config('request.jwt.claims', json_build_object('role', p_rol, 'sub', p_uid)::text, true); execute format('set local role %I', p_rol); end $f$;
select pg_temp.como('authenticated', '<OWNER_UUID>');
select public.club_vencer((now() at time zone 'America/Costa_Rica')::date,
         (select count(*)::int from public.club_vencer_simular((now() at time zone 'America/Costa_Rica')::date))) as vencidas,
       (select sum(personas) from club_movimientos where miembro_id = '00000000-0000-4000-8000-0000000c0003') as saldo_dentro,
       clock_timestamp() as fin;
rollback;
