-- Vuelta atrás de la 194, como MIGRACIÓN NUEVA HACIA ADELANTE (regla 10 de ESTADO: la fila 194 del ledger y el archivo
-- supabase/migrations/194_mi_rendimiento_equipo.sql se QUEDAN; nunca se borran ni se revierten).
-- Listo para usar, SIN NUMERAR: si hace falta, se copia a supabase/migrations/NNN_mi_rendimiento_equipo_fuera.sql con el
-- siguiente número libre del bloque de pase (registro + ESTADO en el mismo PR) y entra por merge → Branching, con firma.
-- Borra las seis funciones de la 194. No toca datos ni otras funciones (la 191 queda como está).
-- La app sigue andando sin ellas: si la RPC no está, Mi Rendimiento muestra «comparación no disponible» y la
-- evolución personal (que sale de las propias facturas) no cambia.
begin;
drop function if exists public.pos_mi_competencia(text, text);
drop function if exists public.pos_mi_rendimiento_equipo(text, date, date);
drop function if exists public.pos_rend_yo(text);
drop function if exists public.pos_rend_productos(text, date, date);
drop function if exists public.pos_rend_base(text, date, date);
drop function if exists public.pos_persona_clave(text, date);
commit;
