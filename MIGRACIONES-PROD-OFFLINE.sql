-- ════════════════════════════════════════════════════════════════════════
-- MIGRACIONES PARA PRODUCCIÓN — OFFLINE-FIRST (2026-06-12)
-- Pegar TODO este archivo en: Supabase (proyecto satori PROD yiczgdtirrkdvohdquzf)
--   → SQL Editor → Run. Idempotente: correrlo dos veces no rompe nada.
-- Contiene: migración 021 (idempotencia del replay offline) + housekeeping
-- pendiente (registrar 018-021 en schema_migrations, instrucción de la dueña).
-- ════════════════════════════════════════════════════════════════════════

-- ── 0. GUARDIA DE SANIDAD: aborta si esto se corre en STAGING ──
-- (staging tiene usuarios de prueba @staging.satori; prod no)
do $$
begin
  if exists (select 1 from auth.users where email like '%@staging.satori') then
    raise exception 'ESTO ES STAGING (hwiatgicyyqyezqwldia) — abrí el SQL Editor del proyecto de PRODUCCIÓN y volvé a correr';
  end if;
end $$;
select 'OK: proyecto correcto (no es staging) — aplicando…' as sanidad;

-- ── 1. Migración 021: idempotencia del replay offline ──
-- client_op_id UNIQUE (nullable): cada operación encolada sin red viaja con su
-- UUID; un replay repetido rebota con 23505 y el cliente lo descarta de la cola
-- — JAMÁS se duplica plata. Lo histórico/online-directo queda en NULL (no
-- participa de la restricción).
alter table public.cash_movements add column if not exists client_op_id uuid;
alter table public.tip_entries    add column if not exists client_op_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cash_movements_client_op_id_key') then
    alter table public.cash_movements add constraint cash_movements_client_op_id_key unique (client_op_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tip_entries_client_op_id_key') then
    alter table public.tip_entries add constraint tip_entries_client_op_id_key unique (client_op_id);
  end if;
end $$;

-- ── 2. Housekeeping (instrucción de la dueña, ESTADO.md): registrar las
--      versiones aplicadas a mano para que un futuro `supabase db push` no
--      las re-intente. Crea la tabla de historial si nunca se usó la CLI acá.
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text
);
insert into supabase_migrations.schema_migrations(version)
values ('018'), ('019'), ('020'), ('021')
on conflict do nothing;

-- ── VERIFICACIÓN FINAL (debe devolver 3 filas con ok=true) ──
select 'client_op_id en cash_movements (021)' as pieza,
       exists (select 1 from information_schema.columns where table_schema='public' and table_name='cash_movements' and column_name='client_op_id') as ok
union all
select 'client_op_id en tip_entries (021)',
       exists (select 1 from information_schema.columns where table_schema='public' and table_name='tip_entries' and column_name='client_op_id')
union all
select 'housekeeping: versiones 018-021 registradas',
       (select count(*) = 4 from supabase_migrations.schema_migrations where version in ('018','019','020','021'));
