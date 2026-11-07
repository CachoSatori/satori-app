begin; create function pg_temp.como(p_rol text, p_uid text) returns void language plpgsql as $f$ begin perform set_config('request.jwt.claims', json_build_object('role', p_rol, 'sub', p_uid)::text, true); execute format('set local role %I', p_rol); end $f$;
select pg_temp.como('authenticated', '<CAJERO_UUID>');
-- otra operación (otro p_op), otra factura, el MISMO código: espera a s1 y falla
create function pg_temp.intento() returns text language plpgsql as $f$
begin
  perform public.club_canje('00000000-0000-4000-8000-0000000c0016', 'CARRZG', 1, 'FCARRERA16B', gen_random_uuid());
  return 'aceptó';
exception when others then return sqlerrm;
end $f$;
select pg_temp.intento() as resultado;
commit;
