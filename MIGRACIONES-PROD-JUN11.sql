-- ════════════════════════════════════════════════════════════════════════
-- MIGRACIONES PARA PRODUCCIÓN — 2026-06-11
-- Pegar TODO este archivo en: Supabase (proyecto satori PROD yiczgdtirrkdvohdquzf)
--   → SQL Editor → Run. Es idempotente: correrlo dos veces no rompe nada.
-- Consolida: 018 (check de mediodía) + 019 (verify_manager) + 020 (realtime).
-- Los pasos 1-2 del sprint (métodos de proveedor, categorías únicas) son solo
-- de interfaz: NO requieren DDL.
-- ════════════════════════════════════════════════════════════════════════

-- ── 0. GUARDIA DE SANIDAD: aborta si esto se corre en STAGING ──
-- (staging tiene usuarios de prueba @staging.satori; prod no)
do $$
begin
  if exists (select 1 from auth.users where email like '%@staging.satori') then
    raise exception 'ESTO ES STAGING (hwiatgicyyqyezqwldia) — abrí el SQL Editor del proyecto de PRODUCCIÓN y volvé a correr';
  end if;
end $$;
select 'OK: proyecto correcto (no es staging) — aplicando migraciones…' as sanidad;


-- ──────────── migración 018_caja_dia_unico ────────────
-- 018 · Caja Diaria de proveedores ÚNICA por día
-- Aditiva (no reescribe datos). Agrega el "visto" del check de mediodía a cash_sessions.
-- El código es defensivo: si estas columnas aún no existen, no rompe (la lectura da
-- undefined y el botón de check avisa que falta correr esta migración).

ALTER TABLE public.cash_sessions
  ADD COLUMN IF NOT EXISTS midday_check_by  UUID        REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS midday_check_at  TIMESTAMPTZ;

-- ──────────── migración 019_verify_manager ────────────
-- 019: verificación de gerencia server-side (Fase 2 cirugía de auth, HANG-RCA.md)
-- Reemplaza el cliente Supabase temporal del ManagerOverride (signInWithPassword
-- en el navegador, que podía colgarse y creaba una sesión paralela) por un RPC
-- SECURITY DEFINER: valida email+contraseña contra auth.users con pgcrypto y
-- exige rol owner/manager ACTIVO. No expone hashes ni toca la sesión del cajero.
-- Idempotente.

create or replace function public.verify_manager(p_email text, p_password text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  ok boolean;
begin
  -- Throttle mínimo anti fuerza-bruta (el endpoint de login de GoTrue tiene
  -- rate-limit propio; este RPC también debe costar algo).
  perform pg_sleep(0.3);
  select exists (
    select 1
    from auth.users u
    join public.profiles p on p.id = u.id
    where lower(u.email) = lower(trim(p_email))
      and u.encrypted_password = extensions.crypt(p_password, u.encrypted_password)
      and p.role in ('owner', 'manager')
      and p.is_active
  ) into ok;
  return coalesce(ok, false);
end;
$$;

-- Solo usuarios logueados pueden invocarla (nunca anon).
revoke all on function public.verify_manager(text, text) from public, anon;
grant execute on function public.verify_manager(text, text) to authenticated;

-- ──────────── migración 020_realtime_caja_propinas ────────────
-- 020: tiempo real multi-dispositivo — publicar caja y propinas en supabase_realtime
-- (postgres_changes respeta RLS: cada cliente solo recibe filas que puede leer).
-- Idempotente.

do $$
declare
  t text;
begin
  foreach t in array array['cash_movements', 'cash_sessions', 'cash_cierres_dia', 'tip_sessions', 'tip_entries']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ── VERIFICACIÓN FINAL (debe devolver 3 filas con ok=true) ──
select 'midday_check (018)' as pieza,
       exists (select 1 from information_schema.columns where table_schema='public' and table_name='cash_sessions' and column_name='midday_check_by') as ok
union all
select 'verify_manager (019)',
       exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='verify_manager')
union all
select 'realtime caja/propinas (020)',
       (select count(*) = 5 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public'
        and tablename in ('cash_movements','cash_sessions','cash_cierres_dia','tip_sessions','tip_entries'));
