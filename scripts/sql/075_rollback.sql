-- 075_rollback.sql — Club Satori F1a: borra TODO lo club_* y la fila 075 del ledger.
-- ⚠️ Destruye los datos del Club (miembros, movimientos, cupones, PM). Pensado para STAGING
-- antes del piloto. En prod, solo con firma y después de exportar los datos.
begin;

drop trigger if exists club_config_auditar_trg on public.club_config;
drop trigger if exists club_config_tasa_guardia_trg on public.club_config;
drop function if exists public.club_config_tasa_guardia();
drop function if exists public.club_reporte_cerrar(date, text, text);
drop function if exists public.club_reporte_mes(date, text, boolean);
drop function if exists public.club_visita_control(text, text, jsonb, text, uuid, int);
drop function if exists public.club_config_auditar();
drop function if exists public.club_resolver(text);
drop function if exists public.club_tarjeta_manual(uuid, int, text, uuid, jsonb);
drop function if exists public.club_tarjeta_manual(uuid, int, text, uuid);
drop function if exists public.club_mesas_abiertas(text);
drop function if exists public.club_pedidos_abiertos(text);
drop function if exists public.club_facturas_recientes(text);
drop function if exists public.club_sin_cruce_elegir(uuid, text, text);
drop function if exists public.club_sin_cruce_candidatas(uuid, text);
drop function if exists public.club_sin_cruce_candidatas(uuid);
drop function if exists public.club_cruce_facturas(text, jsonb, text);
drop function if exists public.club_cruce_detalle(text, jsonb, text);
drop function if exists public.club_cruce_auto(text, jsonb, text);
drop function if exists public.club_buscar(text);
drop function if exists public.club_miembro_token(uuid);
drop function if exists public.club_miembro_regenerar_codigo(uuid);
drop function if exists public.club_miembro_guardar(uuid, text, text, uuid, text, jsonb);
drop function if exists public.club_negocio_guardar(uuid, text, text, boolean);
drop function if exists public.club_miembro_guardar(uuid, text, text, uuid, text, jsonb, text);   -- LC-ML
drop function if exists public.club_negocio_guardar(uuid, text, text, boolean, text);           -- LC-ML
drop function if exists public.club_locales_activos();                                          -- LC-ML
drop function if exists public.club_local(text, boolean) cascade;                                       -- LC-ML
drop function if exists public.club_local_activo(text);                                         -- LC-ML
drop function if exists public.club_reporte_mes(date, text);
drop function if exists public.club_excepcion_resolver(text, text, text, text);
drop function if exists public.club_excepciones_abiertas(int, text);
drop function if exists public.club_excepciones(date, date, text);
drop function if exists public.club_excepciones(date, date, text, text);
drop function if exists public.club_nombre_limpio(text);
drop function if exists public.club_factura_clave(text);
drop function if exists public.club_cupon_contacto(text, jsonb);
drop function if exists public.club_cupon_ver(text);
drop function if exists public.club_nombre_pila(text);
drop function if exists public.club_vencer(date, int);
drop function if exists public.club_vencer_simular(date);
drop function if exists public.club_vencer_candidatos(date);
drop function if exists public.club_vencer(date);
drop function if exists public.club_portal(text);
drop function if exists public.club_ajuste(uuid, int, text, text, uuid);
drop function if exists public.club_ajuste(uuid, int, text, text);
drop function if exists public.club_canje(uuid, text, numeric, text, uuid, jsonb);   -- R-01
drop function if exists public.club_canje_aprobado(uuid, numeric, text, uuid, jsonb, text);
drop function if exists public.club_canje_aplicar(uuid, text, numeric, text, uuid, jsonb, text);
drop function if exists public.club_canje_codigo_generar(text);
drop function if exists public.club_canje(uuid, numeric, text, uuid, jsonb);
drop function if exists public.club_canje(uuid, numeric, text, uuid);
drop function if exists public.club_cupon_usar(text, int, text, uuid, jsonb);
drop function if exists public.club_cupon_usar(text, int, text, uuid);
drop function if exists public.club_pos_ref(jsonb, text);
drop function if exists public.club_pos_ref(jsonb);
drop function if exists public.club_visita_canonica(text, jsonb, text);
drop function if exists public.club_cupon_crear(text, jsonb);
drop function if exists public.club_saldo_personas(uuid);

-- Ronda 3: cualquier función club_* que quede (las nuevas y las que dependen del tipo de una tabla).
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'club\_%' and p.proname <> 'club_saldos' loop
    execute format('drop function if exists %s cascade', r.fn);
  end loop;
end $$;
drop view if exists public.club_saldos;

drop table if exists public.club_excepciones_resueltas;
drop table if exists public.club_reportes_cerrados;
drop table if exists public.club_web_clave;
drop function if exists public.club_web_ok();
drop function if exists public.club_web_clave_cargar(text);
drop function if exists public.club_reportes_cerrados_inmutable();
drop table if exists public.club_codigos_canje;   -- R-01 (antes que club_movimientos)
drop table if exists public.club_pase_eventos;      -- LC-A1
drop table if exists public.club_pase_cursor;
drop table if exists public.club_pases;
drop table if exists public.club_personas_pendientes; -- LC-A4.4
drop table if exists public.club_premios;              -- LC-A4.3
drop table if exists public.club_visitas_socio;       -- LC-A4
drop table if exists public.club_entorno;              -- CLUB-AUD-42 (marca de staging)
drop table if exists public.club_promociones;          -- LC-A3
drop table if exists public.club_marcadores_descuento;   -- LC-MD
drop table if exists public.club_cortesias;
drop table if exists public.club_socio_solicitudes;   -- CLUB-AUD-72
drop table if exists public.club_miembro_roles;
drop table if exists public.club_canje_intentos;
drop table if exists public.club_alertas;
drop table if exists public.club_auditoria;
drop table if exists public.club_cruces_manuales_historial;
drop table if exists public.club_comparacion_vieja;
drop table if exists public.club_cupones_contactos;
drop table if exists public.club_cruces_manuales;
drop table if exists public.club_config_historial;
drop table if exists public.club_visitas;
drop table if exists public.club_pm_cargos;
drop table if exists public.club_pm_pagos;
drop table if exists public.club_movimientos;
drop table if exists public.club_cupones;
drop table if exists public.club_miembros_contacto;
drop table if exists public.club_miembros;
drop table if exists public.club_negocios;
drop table if exists public.club_config;

drop function if exists public.club_personas_proximo(bigint, int);
drop function if exists public.club_norm_factura(text);
drop function if exists public.club_norm_texto(text);
drop function if exists public.club_norm_telefono(text);
drop function if exists public.club_creditos(bigint, int);
drop function if exists public.club_gen_codigo(int);

delete from supabase_migrations.schema_migrations where version = '075';

commit;

-- LC-A2: tarea diaria de socios (si pg_cron está)
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from cron.job where jobname = 'club_socios_mantenimiento') then
    perform cron.unschedule('club_socios_mantenimiento');
  end if;
end $$;
