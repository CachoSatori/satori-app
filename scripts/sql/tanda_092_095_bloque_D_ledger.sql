-- BLOQUE D · el ledger de la tanda después del merge (5.2), con freno (Grok 178). SOLO LECTURA.
-- Frena si no da: 65 filas, última 095, 4 filas de la tanda, names_ok 4, repetidas []. Se sigue leyendo en voz alta igual.
begin read only;
select set_config('tanda.d', (json_build_object(
  'filas', (select count(*) from supabase_migrations.schema_migrations),
  'ultima', (select max(version) from supabase_migrations.schema_migrations where version ~ '^[0-9]{3}$'),
  'tanda', (select coalesce(json_agg(json_build_object('v', version, 'name', name, 'statements', array_length(statements, 1)) order by version), '[]'::json)
              from supabase_migrations.schema_migrations where version in ('092','093','094','095')),
  'repetidas', (select coalesce(json_agg(version), '[]'::json) from (select version from supabase_migrations.schema_migrations
                  where version in ('092','093','094','095') group by version having count(*) <> 1) r),
  'names_ok', (select count(*) from supabase_migrations.schema_migrations where (version, name) in
                 (('092','employees_borrado_solo_owner'), ('093','ventas_lectura_rol_activo'), ('094','anon_sin_maintain'), ('095','contador_lee_caja')))
))::text, true);
do $chk$
declare j jsonb := current_setting('tanda.d')::jsonb; m text := '';
begin
  if (j->>'filas')::int <> 65 then m := m || ' · filas≠65'; end if;
  if j->>'ultima' <> '095' then m := m || ' · última≠095'; end if;
  if jsonb_array_length(j->'tanda') <> 4 then m := m || ' · la tanda no tiene 4 filas'; end if;
  if (j->>'names_ok')::int <> 4 then m := m || ' · names_ok≠4'; end if;
  if j->'repetidas' <> '[]'::jsonb then m := m || ' · hay versiones repetidas'; end if;
  if m <> '' then raise exception 'PARADA (bloque D): no da%', m; end if;
end $chk$;
select current_setting('tanda.d')::json as ledger_tanda;
rollback;
