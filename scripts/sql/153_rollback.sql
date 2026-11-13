-- Rollback de la 153 (origen 096): saca las dos funciones (proveedor_agregar_alias y proveedor_clave_alias). No toca datos: los alias
-- que ya se guardaron quedan en suppliers.aliases. El cliente sigue andando: si la función no existe, vuelve al UPDATE
-- de antes (src/shared/api/proveedorAlias.ts).
-- Borra la fila 153 del ledger (renumerada desde la 096: la 096 nunca se aplicó con ese número).
-- Si se corre en prod, en el mismo momento sale el .sql de main (regla 10 / satori-migraciones-y-prod §6).
begin;
drop function if exists public.proveedor_agregar_alias(uuid, text);
drop function if exists public.proveedor_clave_alias(text);
delete from supabase_migrations.schema_migrations where version = '153';
commit;
