-- Vuelta atrás de la 188 (club_socio_edad). Borra la función y la fila 188 del ledger; no hay datos que volver.
-- La app (getEdadSocio) ante el error muestra la casilla de mayor de 18: no se rompe, pero conviene revertir el código
-- en el mismo momento. EN EL MISMO MOMENTO: un PR que saca supabase/migrations/188_club_socio_edad.sql de main (regla 10).
begin;

drop function if exists public.club_socio_edad(uuid);
delete from supabase_migrations.schema_migrations where version = '188';

do $$
begin
  if to_regprocedure('public.club_socio_edad(uuid)') is not null then
    raise exception '188 rollback: quedó club_socio_edad';
  end if;
end $$;

commit;
