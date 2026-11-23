-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 195 (origen club 139) · Correo base de cada local, en la base y editable en Admin      ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- Decisión del dueño (20-nov): el correo base del local (con el que la pantalla de alta arma el alias
-- «base+nombre@dominio» para un empleado sin correo propio) se guarda POR LOCAL, EN LA BASE, editable desde
-- Admin → Locales. Reemplaza la variable de compilación del #323 (y el #75): el repo es público y el correo no va en
-- el código ni en el build.
--
-- Qué hace (y nada más):
--   1. `public.locations.correo_base text` NULLABLE. Sin valor = la pantalla pide cargarlo; no se carga ningún dato
--      acá (el owner lo escribe desde la app).
--   2. Check `locations_correo_base_formato`: null, o un correo básico de hasta 254 caracteres SIN «+» en la parte
--      local (el «+nombre» lo agrega la pantalla) y sin espacios. Mismo patrón que `PATRON_CORREO_BASE` de
--      src/modules/admin/aliasCorreo.ts (la prueba de la app compara las dos cadenas).
--
-- Permisos: NO se agrega ni se cambia ninguna política. La RLS de `locations` es por FILA (091/151) y la columna
-- nueva queda bajo las mismas reglas que el resto:
--   · leer: `locations_select_activos` (authenticated con rol: get_my_role() is not null), igual que nombre y estado;
--   · escribir: `locations_write_owner` (solo owner activo; no existe un rol «admin»);
--   · anon: nada (151 hizo `revoke all … from anon`). No hay permisos por columna en `locations`.
--
-- Qué NO hace: no toca otras columnas, ni funciones, ni el Club (ninguna función del Club lee `locations.*`), ni datos.
--
-- Re-ejecutable (`if not exists`, `drop constraint if exists`). La columna nace vacía: el check no valida filas viejas.
-- Vuelta atrás: scripts/sql/195_rollback.sql (migración nueva hacia adelante; regla 10). Pruebas:
-- scripts/sql/195_pruebas.sql (+ 195_pruebas.py), en una transacción que termina en ROLLBACK.

begin;

alter table public.locations add column if not exists correo_base text;

alter table public.locations drop constraint if exists locations_correo_base_formato;
alter table public.locations add constraint locations_correo_base_formato check (
  correo_base is null
  or (char_length(correo_base) <= 254
      and correo_base ~ '^[A-Za-z0-9._%-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

comment on column public.locations.correo_base is
  'Mig 195: correo base del local para el alias de alta de empleados sin correo propio (base+nombre@dominio). '
  'Null = sin cargar. Lo edita el owner en Admin → Locales.';

commit;
