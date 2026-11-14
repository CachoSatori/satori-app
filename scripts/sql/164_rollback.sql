-- 164_rollback (origen 110) · Vuelta atrás de supabase/migrations/164_club_alertas_umbral.sql.
-- Deja la base como antes de la 164: saca la función del Inicio, los 5 umbrales de club_config y la fila 164 del ledger
-- (supabase_migrations.schema_migrations), como los rollbacks de la 153, la 155 y la 157. No toca datos del Club (la 164
-- no escribe nada). Los cambios de umbral que haya hecho el owner quedan en club_config_historial (solo inserción).
-- El .sql de la 164 NO se saca ni se revierte de main (regla 10 de ESTADO). En prod, la vuelta atrás preferida es una
-- migración NUEVA que haga lo mismo que este archivo (hacia adelante, con su propia fila), con firma del dueño; así el
-- .sql de la 164 y su fila quedan en su lugar y Branching no tiene nada que reaplicar. Este archivo, tal cual, es para
-- staging y para la base local (y para la batería, dentro de su transacción descartada).
-- El código de la app sin la función muestra «sin comprobar» en el bloque del Club del Inicio: no rompe.
begin;

drop function if exists public.club_alertas_inicio(text);

alter table public.club_config drop column if exists alerta_anfitrion_24h_max;
alter table public.club_config drop column if exists alerta_mismo_usuario_max;
alter table public.club_config drop column if exists alerta_mismo_usuario_dias;
alter table public.club_config drop column if exists alerta_visitas_sin_factura_max;
alter table public.club_config drop column if exists alerta_canjes_sin_codigo_max;

delete from supabase_migrations.schema_migrations where version = '164';

do $$
begin
  if to_regprocedure('public.club_alertas_inicio(text)') is not null then
    raise exception '164_rollback: club_alertas_inicio sigue';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'club_config'
              and column_name like 'alerta\_%') then
    raise exception '164_rollback: quedan umbrales en club_config';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '164') then
    raise exception '164_rollback: la fila 164 sigue en el ledger';
  end if;
end $$;

commit;
