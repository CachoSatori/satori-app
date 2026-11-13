-- Rollback de la 096: saca las dos funciones (proveedor_agregar_alias y proveedor_clave_alias). No toca datos: los alias
-- que ya se guardaron quedan en suppliers.aliases. El cliente sigue andando: si la función no existe, vuelve al UPDATE
-- de antes (src/shared/api/proveedorAlias.ts).
-- Borra la fila del ledger con el número con que se aplicó (096, o el del bloque de pase si se renumeró: ajustar acá).
-- Si se corre en prod, en el mismo momento sale el .sql de main (regla 10 / satori-migraciones-y-prod §6).
begin;
drop function if exists public.proveedor_agregar_alias(uuid, text);
drop function if exists public.proveedor_clave_alias(text);
delete from supabase_migrations.schema_migrations where version = '096';
commit;
