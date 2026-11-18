-- Vuelta atrás de la 193, como MIGRACIÓN NUEVA HACIA ADELANTE (regla 10 de ESTADO: la fila 193 del ledger y el archivo
-- supabase/migrations/193_pos_ventas_tiempos.sql se QUEDAN; nunca se borran ni se revierten).
-- Listo para usar, SIN NUMERAR: si hace falta, se copia a supabase/migrations/NNN_pos_ventas_tiempos_fuera.sql con el
-- siguiente número libre del bloque de pase (registro + ESTADO en el mismo PR) y entra por merge → Branching, con firma.
-- Borra las dos funciones, el helper y la tabla de mesas internas. OJO: la tabla es configuración del owner (la
-- lista de mesas internas); antes de correrlo, anotá su contenido (`select * from public.pos_mesas_internas`).
-- La app sigue andando: «Tiempos» vuelve a la 080 (turno) y al mapa solo de salón, y los indicadores dejan de separar
-- las mesas internas (como antes de la 193). Ver PASE-193.
begin;

drop function if exists public.pos_ventas_tiempos(text, date, date);
drop function if exists public.pos_ventas_internas(text, date, date);
drop function if exists public.pos_ventas_tiempos_porton(text, date, date);
drop table if exists public.pos_mesas_internas;

do $$
begin
  if to_regprocedure('public.pos_ventas_tiempos(text, date, date)') is not null
     or to_regprocedure('public.pos_ventas_internas(text, date, date)') is not null
     or to_regclass('public.pos_mesas_internas') is not null then
    raise exception '193 vuelta atrás: quedó algo de la 193';
  end if;
end $$;

commit;
