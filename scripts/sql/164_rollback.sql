-- 164_rollback (origen 110) · Vuelta atrás de supabase/migrations/164_club_alertas_umbral.sql.
-- Saca la función del Inicio y los 5 umbrales de club_config. No toca datos del Club (la 164 no escribe nada).
-- Los cambios de umbral que haya hecho el owner quedan en club_config_historial (solo inserción): no se borran.
-- Junto con este rollback, en el MISMO momento, un PR que saque el .sql de la 164 de main (si queda, Branching la vuelve
-- a aplicar). El código de la app sin la función muestra «sin comprobar» en el bloque del Club del Inicio, no rompe.
begin;

drop function if exists public.club_alertas_inicio(text);

alter table public.club_config drop column if exists alerta_anfitrion_24h_max;
alter table public.club_config drop column if exists alerta_mismo_usuario_max;
alter table public.club_config drop column if exists alerta_mismo_usuario_dias;
alter table public.club_config drop column if exists alerta_visitas_sin_factura_max;
alter table public.club_config drop column if exists alerta_canjes_sin_codigo_max;

do $$
begin
  if to_regprocedure('public.club_alertas_inicio(text)') is not null then
    raise exception '164_rollback: club_alertas_inicio sigue';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'club_config'
              and column_name like 'alerta\_%') then
    raise exception '164_rollback: quedan umbrales en club_config';
  end if;
end $$;

commit;
