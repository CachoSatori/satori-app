-- Vuelta atrás de la 193, como MIGRACIÓN NUEVA HACIA ADELANTE (regla 10 de ESTADO: la fila 193 del ledger y el archivo
-- supabase/migrations/193_propinas_cada_uno_lo_suyo.sql se QUEDAN; nunca se borran ni se revierten).
-- Listo para usar, SIN NUMERAR: si hace falta, se copia a supabase/migrations/NNN_propinas_vuelve_085.sql con el
-- siguiente número libre del bloque de pase (registro + ESTADO en el mismo PR) y entra por merge → Branching, con firma.
-- Vuelve la policy de lectura de tip_entries a la de la 085 (lo verifica por md5 al final) y borra el helper.
-- OJO: REABRE la fuga (cualquier rol activo lee las propinas de todo el equipo). Solo si la 193 rompe algo peor.
-- La app funciona igual con la 085 (no cambió de llamada).
begin;

drop policy if exists tip_entries_lee_lo_propio on public.tip_entries;
drop policy if exists tip_entries_lee_gestion   on public.tip_entries;

-- Tal cual la 073 + 085: lectura para cualquier rol activo.
create policy "Todos ven entradas de propinas" on public.tip_entries
  for select to authenticated
  using (public.get_my_role() is not null);

drop function if exists public.propinas_mis_empleados();

do $verifica193r$
declare
  n integer;
begin
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'tip_entries';
  if n <> 2 then
    raise exception '193 rollback: tip_entries quedó con % policies (se esperaban 2)', n;
  end if;
  if (select md5(coalesce(p.qual, '') || '|' || coalesce(p.with_check, '') || '|' || p.cmd || '|' || p.permissive
                 || '|' || p.roles::text)
      from pg_policies p
      where p.schemaname = 'public' and p.tablename = 'tip_entries' and p.policyname = 'Todos ven entradas de propinas')
     is distinct from 'a4d0a0e9aacc129de8d082c512aeeb3c' then
    raise exception '193 rollback: la policy de lectura no quedó igual a la de la 085';
  end if;
end
$verifica193r$;

commit;
