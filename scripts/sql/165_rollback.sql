-- 165_rollback (origen club 111) · Vuelta atrás de la bitácora de permisos (B10).
-- Saca los dos triggers de permisos (profiles y profile_locations), las funciones y la tabla. NO toca `profiles`,
-- sus policies ni sus otros triggers (guarda de roles, último owner, updated_at).
--
-- OJO: borrar la tabla borra la historia registrada. Con filas reales, la regla de la skill de migraciones es NO
-- borrar: se apaga el registro (solo los triggers, bloque A) y se arregla con una migración nueva. El bloque B
-- (tabla) frena solo si la tabla tiene filas, salvo que se lo pida explícitamente con
--   set satori.rollback_165_borrar_historia = 'si';   -- en la misma sesión, antes de correr este archivo
-- Borra la fila 165 del ledger. Si se corre en prod, en el mismo momento sale el .sql de la 165 de main (si queda, Branching la vuelve a aplicar; regla 10 / satori-migraciones-y-prod §6).
-- Si la 165 ya está en el ledger de prod y hay filas reales, se apaga con una migración nueva (bloque A).

begin;

-- ── A. Apagar el registro (siempre seguro) ──────────────────────────────────────────────────
drop trigger if exists trg_profiles_bitacora_permisos on public.profiles;
drop trigger if exists trg_profile_locations_bitacora_permisos on public.profile_locations;
drop function if exists public.bitacora_permisos_profiles();
drop function if exists public.bitacora_permisos_locales();
drop function if exists public.bitacora_permisos_actor();

-- ── B. La tabla (solo vacía, o con el permiso explícito) ────────────────────────────────────
do $$
begin
  if to_regclass('public.bitacora_permisos') is not null
     and exists (select 1 from public.bitacora_permisos)
     and coalesce(current_setting('satori.rollback_165_borrar_historia', true), '') <> 'si' then
    raise exception '165 rollback: bitacora_permisos tiene filas (historia real); no se hizo nada. Para solo apagar '
                    'el registro corré el bloque A solo; para borrar la historia, repetí con '
                    'satori.rollback_165_borrar_historia = si';
  end if;
end $$;

drop table if exists public.bitacora_permisos;   -- se lleva sus triggers, policy, índice y secuencia
drop function if exists public.bitacora_permisos_inmutable();

delete from supabase_migrations.schema_migrations where version = '165';
commit;
