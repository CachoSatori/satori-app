-- Vuelta atrás de la 195, como MIGRACIÓN NUEVA HACIA ADELANTE (regla 10 de ESTADO: la fila 195 del ledger y el archivo
-- supabase/migrations/195_locations_correo_base.sql se QUEDAN; nunca se borran ni se revierten).
-- Listo para usar, SIN NUMERAR: si hace falta, se copia a supabase/migrations/NNN_locations_correo_base_fuera.sql con el
-- siguiente número libre del bloque de pase (registro + ESTADO en el mismo PR) y entra por merge → Branching, con firma.
-- Saca el check y la columna `locations.correo_base`: SE PIERDE el correo cargado de cada local (anotarlo antes, en un
-- lugar privado, si se va a volver a cargar). No toca otras columnas, políticas ni datos.
-- La app sigue andando sin la columna: Admin → Usuarios muestra «No se pudo leer el correo del local» en lugar del alias
-- y Admin → Locales muestra el error de lectura; nada más depende de ella. Revertir el código de la app en el mismo PR.
begin;
alter table public.locations drop constraint if exists locations_correo_base_formato;
alter table public.locations drop column if exists correo_base;
commit;
