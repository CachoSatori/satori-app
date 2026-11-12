-- CLUB-AUD-42: marca esta base como STAGING (habilita el modo `pruebas` de la batería y de la limpieza de las
-- carreras). SOLO en staging (ref hwiatgicyyqyezqwldia). NUNCA en prod: allá club_entorno queda vacía y el libro
-- de movimientos y la auditoría no tienen ninguna puerta de mantenimiento salvo la del migrador.
-- Se corre una vez después de aplicar la 075 (y de nuevo si se corrió el rollback).
insert into public.club_entorno (nombre) values ('staging') on conflict do nothing;
