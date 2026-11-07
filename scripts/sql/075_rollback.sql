-- 075_rollback.sql — Club Satori F1a: borra TODO lo club_* y la fila 075 del ledger.
-- ⚠️ Destruye los datos del Club (miembros, movimientos, cupones, PM). Pensado para STAGING
-- antes del piloto. En prod, solo con firma y después de exportar los datos.
begin;

drop trigger if exists club_config_auditar_trg on public.club_config;
drop function if exists public.club_config_auditar();
drop function if exists public.club_resolver(text);
drop function if exists public.club_tarjeta_manual(uuid, int, text, uuid, jsonb);
drop function if exists public.club_tarjeta_manual(uuid, int, text, uuid);
drop function if exists public.club_mesas_abiertas(text);
drop function if exists public.club_pedidos_abiertos(text);
drop function if exists public.club_facturas_recientes(text);
drop function if exists public.club_sin_cruce_elegir(uuid, text, text);
drop function if exists public.club_sin_cruce_candidatas(uuid);
drop function if exists public.club_cruce_auto(text, jsonb, text);
drop function if exists public.club_buscar(text);
drop function if exists public.club_miembro_token(uuid);
drop function if exists public.club_miembro_regenerar_codigo(uuid);
drop function if exists public.club_miembro_guardar(uuid, text, text, uuid, text, jsonb);
drop function if exists public.club_negocio_guardar(uuid, text, text, boolean);
drop function if exists public.club_reporte_mes(date, text);
drop function if exists public.club_excepcion_resolver(text, text, text, text);
drop function if exists public.club_excepciones_abiertas(int, text);
drop function if exists public.club_excepciones(date, date, text);
drop function if exists public.club_nombre_limpio(text);
drop function if exists public.club_factura_clave(text);
drop function if exists public.club_cupon_contacto(text, jsonb);
drop function if exists public.club_cupon_ver(text);
drop function if exists public.club_nombre_pila(text);
drop function if exists public.club_vencer(date);
drop function if exists public.club_portal(text);
drop function if exists public.club_ajuste(uuid, int, text, text);
drop function if exists public.club_canje(uuid, numeric, text, uuid, jsonb);
drop function if exists public.club_canje(uuid, numeric, text, uuid);
drop function if exists public.club_cupon_usar(text, int, text, uuid, jsonb);
drop function if exists public.club_cupon_usar(text, int, text, uuid);
drop function if exists public.club_pos_ref(jsonb);
drop function if exists public.club_cupon_crear(text, jsonb);
drop function if exists public.club_saldo_personas(uuid);

drop view if exists public.club_saldos;

drop table if exists public.club_excepciones_resueltas;
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
