-- Rollback de la 152 (origen 101) (aviso de privacidad del Club v1.2). Vuelve a pedir v1.1.
-- La fila 'v1.2' de club_avisos_privacidad NO se borra (la tabla es inmutable por trigger) y no molesta.
-- Hacerlo junto con volver club-web a v1.1 (git revert), o el alta y el opt-in quedan rechazados.
alter table public.club_config alter column aviso_privacidad_version set default 'v1.1';
update public.club_config set aviso_privacidad_version = 'v1.1' where aviso_privacidad_version = 'v1.2';
