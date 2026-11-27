-- 203 · vuelta atrás. ANTES: guardar lo que no se puede rehacer (lo decidió una persona):
--   select * from public.fe_emisores_bitacora order by ts;
--   select cedula, activo, nombre, origen, aprobado_por, aprobado_en from public.fe_emisores_conocidos order by cedula;
-- Los emisores recordados se QUEDAN en fe_emisores_conocidos (activos: son dato, la 201 los sigue usando); se pierden
-- solo nombre, origen y quién/cuándo lo aprobó. Los comprobantes que pasaron a «ok» quedan «ok» (dato).
-- Con uso real NO se borra la bitácora: se apagan las dos funciones (revoke execute) y se corrige con migración nueva.
-- Si la 203 ya está en el ledger de prod, el .sql NO se borra (regla 10).
drop function if exists public.fe_emisor_desactivar(text);
drop function if exists public.fe_emisor_recordar(text);
drop table if exists public.fe_emisores_bitacora;
alter table public.fe_emisores_conocidos
  drop column if exists aprobado_en,
  drop column if exists aprobado_por,
  drop column if exists origen,
  drop column if exists nombre;
