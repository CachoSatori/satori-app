-- ════════════════════════════════════════════════════════════════════════════════════════════
--  VERIFICACIÓN MANUAL de la mig 052 (auditoría de ediciones de cash_movements).
--  NO ES UNA MIGRACIÓN: vive fuera de supabase/migrations/, así que `supabase db push` NO lo aplica.
--  Se corre A MANO, SOLO en staging, DESPUÉS de aplicar la 052. Todo va en 1 transacción con
--  ROLLBACK final → no persiste ni el cambio al movimiento ni las trazas de auditoría.
--  Mejor por psql (para ver los RAISE NOTICE). En el editor SQL de Supabase: un fallo sale como error.
-- ════════════════════════════════════════════════════════════════════════════════════════════

-- ── PARTE 1 — comportamiento del trigger (transaccional, con ROLLBACK) ──
begin;
do $$
declare
  v_id   uuid;
  v_amt  numeric;
  v_desc text;
  v_base bigint;   -- filas de auditoría del movimiento ANTES de cada sub-test
  v_cnt  bigint;
  v_chg  jsonb;
begin
  select id, amount_crc, description
    into v_id, v_amt, v_desc
    from public.cash_movements
    order by created_at desc
    limit 1;

  if v_id is null then
    raise exception 'VERIFY: no hay cash_movements en esta base para probar';
  end if;

  -- (A) cambio SENSIBLE (amount_crc) → exactamente 1 fila nueva, con changed.amount_crc correcto
  select count(*) into v_base from public.movement_edits where movement_id = v_id;
  update public.cash_movements set amount_crc = v_amt + 1 where id = v_id;
  select count(*) into v_cnt from public.movement_edits where movement_id = v_id;
  if v_cnt <> v_base + 1 then
    raise exception 'A FALLÓ: esperaba % filas, hay %', v_base + 1, v_cnt;
  end if;
  select changed into v_chg from public.movement_edits
    where movement_id = v_id order by edited_at desc limit 1;
  if (v_chg -> 'amount_crc' ->> 'old')::numeric <> v_amt
     or (v_chg -> 'amount_crc' ->> 'new')::numeric <> v_amt + 1 then
    raise exception 'A FALLÓ: changed.amount_crc = %', v_chg;
  end if;
  raise notice 'A OK — cambio sensible registrado. changed=%', v_chg;

  -- (B) no-op (mismo valor) → 0 filas nuevas
  select count(*) into v_base from public.movement_edits where movement_id = v_id;
  update public.cash_movements set amount_crc = amount_crc where id = v_id;
  select count(*) into v_cnt from public.movement_edits where movement_id = v_id;
  if v_cnt <> v_base then
    raise exception 'B FALLÓ (un no-op quedó registrado): esperaba %, hay %', v_base, v_cnt;
  end if;
  raise notice 'B OK — no-op no registró';

  -- (C) solo cosmético (description, columna NO sensible) → 0 filas nuevas
  select count(*) into v_base from public.movement_edits where movement_id = v_id;
  update public.cash_movements set description = coalesce(v_desc, '') || ' [verify]' where id = v_id;
  select count(*) into v_cnt from public.movement_edits where movement_id = v_id;
  if v_cnt <> v_base then
    raise exception 'C FALLÓ (description quedó registrado): esperaba %, hay %', v_base, v_cnt;
  end if;
  raise notice 'C OK — cambio cosmético (description) no registró';

  raise notice 'TODOS LOS CHECKS PASARON (se hace ROLLBACK; nada persiste).';
end $$;
rollback;

-- ── PARTE 2 — forma de la RLS (read-only, determinista, sin transacción) ──
-- Debe dar: rowsecurity = t, y EXACTAMENTE una policy SELECT para owner/manager/contador,
-- SIN policies de INSERT/UPDATE/DELETE (append-only).
select relrowsecurity as rls_on
  from pg_class where oid = 'public.movement_edits'::regclass;

select polname, cmd, roles, qual
  from pg_policies
  join pg_policy on pg_policy.polname = pg_policies.policyname
 where schemaname = 'public' and tablename = 'movement_edits';

-- Forma esperada: 1 fila, cmd = 'SELECT'. Cualquier fila con cmd INSERT/UPDATE/DELETE = ROJO.

-- ── APÉNDICE (opcional) — probar edited_by = auth.uid() bajo un usuario real ──
-- Como postgres / Management API, auth.uid() es NULL → edited_by NULL (canal admin, a propósito).
-- Para ver edited_by = un usuario, impersoná dentro de una transacción con ROLLBACK y rellená el uuid
-- de un profile owner/manager/cajero (rol con permiso de UPDATE en cash_movements por su RLS):
--
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = json_build_object('sub','<UUID_DE_PROFILE>','role','authenticated')::text;
--   update public.cash_movements set amount_crc = amount_crc + 1
--     where id = (select id from public.cash_movements order by created_at desc limit 1);
--   reset role;  -- para poder leer la traza (la policy SELECT exige rol owner/manager/contador)
--   select movement_id, edited_by, changed from public.movement_edits order by edited_at desc limit 1;
--   rollback;
