-- BLOQUE D0 · el ledger de la tanda, SOLO LECTURA y SIN freno: para la vuelta atrás (después de cada bloque E) y para el
-- revert (Grok 186: el revert recién cuando `tanda` dé []).
select json_build_object(
  'filas', (select count(*) from supabase_migrations.schema_migrations),
  'ultima', (select max(version) from supabase_migrations.schema_migrations where version ~ '^[0-9]{3}$'),
  'tanda', (select coalesce(json_agg(json_build_object('v', version, 'name', name, 'statements', array_length(statements, 1)) order by version), '[]'::json)
              from supabase_migrations.schema_migrations where version in ('092','093','094','095')),
  'repetidas', (select coalesce(json_agg(version), '[]'::json) from (select version from supabase_migrations.schema_migrations
                  where version in ('092','093','094','095') group by version having count(*) <> 1) r),
  'names_ok', (select count(*) from supabase_migrations.schema_migrations where (version, name) in
                 (('092','employees_borrado_solo_owner'), ('093','ventas_lectura_rol_activo'), ('094','anon_sin_maintain'), ('095','contador_lee_caja')))
) as ledger_tanda;
