-- Vuelta atrás de la 185 (seguridad_cambio_clave). Borra las cuatro funciones y la tabla (con las marcas pendientes: se
-- pierden, no hay otra cosa que dependa de ellas) y la fila 185 del ledger. EN EL MISMO MOMENTO: un PR que saca
-- supabase/migrations/185_seguridad_cambio_clave.sql de main (si queda, Branching la vuelve a aplicar; regla 10) y que
-- revierte el código de la app (sin las funciones, la app no bloquea a nadie: si la consulta falla, deja pasar).
-- No toca profiles, auth ni otra tabla.
begin;

drop function if exists public.seguridad_cambio_clave_pendientes();
drop function if exists public.seguridad_desmarcar_cambio_clave(uuid);
drop function if exists public.seguridad_debo_cambiar_clave();
drop function if exists public.seguridad_marcar_cambio_clave(uuid);
drop table if exists public.seguridad_cambio_clave;

delete from supabase_migrations.schema_migrations where version = '185';

commit;
