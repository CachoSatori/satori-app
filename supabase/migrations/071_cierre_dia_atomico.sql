-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 071 · Cierre del día + ajuste ATÓMICOS (estabilización de caja, ítem 1)              ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- Antes: la Fase 2 del cierre eran 4 llamadas separadas desde el cliente (updateCierreCompleto
-- → recordCierreSales → recordCierreRetiro → recordCierreAjuste). Si una fallaba, el cierre
-- quedaba «completo» a medias; los deletes previos no chequeaban error y el 23505 del ajuste se
-- tragaba. «Deshacer» eran 4 deletes sueltos y la contraseña de gerencia se validaba solo en el
-- cliente.
--
-- Ahora: TODO en una transacción de la base, o nada.
--   · Los MONTOS los sigue calculando el cliente exactamente igual (cashUtils, cierrePozo,
--     CashCierre). La RPC NO recalcula el «debería» NI replica la tolerancia de ₡500: solo valida
--     coherencia (ajuste ∈ {0, diferencia}, signo = tipo, motivo si hay ajuste, sin negativos).
--   · Las filas que escribe son las MISMAS que antes (descripciones, cajas, tipos, montos, y el
--     client_op_id determinístico del ajuste), así el pozo y cashUtils no notan la diferencia.
--
-- Decisiones de Ismael (05/11): contador EXCLUIDO de cerrar y deshacer (como en la práctica; no
-- se tocan policies). El turno abierto aplica EXACTAMENTE la regla de la pantalla:
--   · `turnoAbierto` (CashCierre.tsx:76 ← getOpenCashSession): cualquier turno status='open';
--   · `cajaProvCerrada` (CashCierre.tsx:112): un turno de ESA fecha con status='closed'.
--
-- SECURITY INVOKER: corre con los permisos de quien llama → el RLS de cash_cierres_dia y
-- cash_movements sigue aplicando igual que hoy. La credencial de gerencia de «deshacer» se
-- verifica con `verify_manager` (SECURITY DEFINER, misma regla que mig 044).
--
-- Esquema: `close_op_id` (nullable; los cierres viejos quedan en null) + UNIQUE(session_date).
-- Multi-local: hoy ni cash_cierres_dia ni cash_sessions tienen columna de local → UNIQUE por
-- fecha. Cuando entre Nosara pasa a (local, session_date) (anotado en ROADMAP).
--
-- Re-ejecutable. Rollback: scripts/sql/071_rollback.sql.

-- ── Esquema ─────────────────────────────────────────────────────────────────────────────────
alter table public.cash_cierres_dia add column if not exists close_op_id uuid;
create unique index if not exists cash_cierres_dia_session_date_key on public.cash_cierres_dia (session_date);

-- ── client_op_id del ajuste: el MISMO que calcula el cliente (cierreAjusteOpId en cash.ts) ──
-- SHA-256 de 'cierre-ajuste-{fecha}-{crc|usd}', primeros 16 bytes, bits de versión 4 / variante.
create or replace function public.cierre_ajuste_op_id(p_fecha date, p_moneda text)
returns uuid
language sql
immutable
set search_path = public, pg_temp
as $function$
  select (
    substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-' ||
    '4' || substr(h, 14, 3) || '-' ||
    to_hex((('x' || substr(h, 17, 2))::bit(8)::int & 63) | 128) || substr(h, 19, 2) || '-' ||
    substr(h, 21, 12)
  )::uuid
  from (select encode(extensions.digest(convert_to('cierre-ajuste-' || p_fecha::text || '-' || p_moneda, 'UTF8'), 'sha256'), 'hex') h) x
$function$;

-- ── Cerrar el día (Fase 2) ──────────────────────────────────────────────────────────────────
create or replace function public.cerrar_dia_completo(
  p_fecha         date,
  p_client_op_id  uuid,
  p_cierre        jsonb,     -- campos de la Fase 2, tal cual los arma CashCierre
  p_ventas        jsonb,     -- [{"turno":"Mediodía"|"Noche","crc":n,"usd":n}]
  p_retiro_crc    numeric,
  p_ajuste        jsonb,     -- {"crc":n,"usd":n,"motivo":"…"} ya filtrado por tolerancia en el cliente
  p_exchange_rate numeric
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_row        public.cash_cierres_dia%rowtype;
  v_uid        uuid := auth.uid();
  v_dif        numeric;
  v_tipo       text;
  v_aj_crc     numeric := coalesce((p_ajuste->>'crc')::numeric, 0);
  v_aj_usd     numeric := coalesce((p_ajuste->>'usd')::numeric, 0);
  v_motivo     text    := coalesce(p_ajuste->>'motivo', '');
  v_venta      jsonb;
  v_n_ventas   int := 0;
  v_n_ajustes  int := 0;
  v_turno      text;
  v_crc        numeric;
  v_usd        numeric;
begin
  -- 1) Rol: owner/manager/cajero ACTIVOS (desde la 069 get_my_role() exige is_active). Sin contador.
  if get_my_role() is null or get_my_role() not in ('owner', 'manager', 'cajero') then
    raise exception 'No autorizado para cerrar el día' using errcode = '42501';
  end if;
  if p_client_op_id is null then
    raise exception 'Falta el identificador de la operación (client_op_id)';
  end if;

  -- 2) Lock de la fila del día (UNIQUE por fecha → como mucho una).
  select * into v_row from public.cash_cierres_dia where session_date = p_fecha for update;

  -- 3) Idempotencia: el mismo intento ya se aplicó → devolver sin escribir.
  if found and v_row.tipo = 'completo' then
    if v_row.close_op_id = p_client_op_id then
      return jsonb_build_object('cierre_id', v_row.id, 'idempotente', true);
    end if;
    raise exception 'El día % ya está cerrado', p_fecha;
  end if;
  if not found or v_row.tipo <> 'parcial_mediodia' then
    raise exception 'Cerrá primero el Mediodía (Fase 1) antes de cerrar la noche.';
  end if;

  -- 4) Turno: la MISMA regla que la pantalla (ver encabezado).
  if exists (select 1 from public.cash_sessions where status = 'open') then
    raise exception 'Cerrá el turno abierto en Caja Diaria antes del cierre del día';
  end if;
  if not exists (select 1 from public.cash_sessions where session_date = p_fecha and status = 'closed') then
    raise exception 'Cerrá primero la Caja Diaria de proveedores del día.';
  end if;

  -- 5) Coherencia de montos (sin recalcular nada).
  v_dif  := coalesce((p_cierre->>'diferencia_crc')::numeric, 0);
  v_tipo := coalesce(p_cierre->>'ajuste_tipo', '');
  if coalesce((p_cierre->>'sep_diaria_crc')::numeric, 0) < 0 or coalesce((p_cierre->>'sep_diaria_usd')::numeric, 0) < 0
     or coalesce((p_cierre->>'sep_registradora_crc')::numeric, 0) < 0 or coalesce((p_cierre->>'sep_registradora_usd')::numeric, 0) < 0
     or coalesce((p_cierre->>'remanente_crc')::numeric, 0) < 0 or coalesce((p_cierre->>'remanente_usd')::numeric, 0) < 0
     or coalesce(p_retiro_crc, 0) < 0 then
    raise exception 'Montos negativos en el conteo o el retiro';
  end if;
  if coalesce((p_cierre->>'tipo_cambio')::numeric, 0) <= 0 or coalesce(p_exchange_rate, 0) <= 0 then
    raise exception 'Tipo de cambio inválido';
  end if;
  if v_aj_crc <> 0 and v_aj_crc <> v_dif then
    raise exception 'El ajuste en ₡ (%) no coincide con la diferencia (%)', v_aj_crc, v_dif;
  end if;
  if v_aj_crc <> 0 or v_aj_usd <> 0 then
    if btrim(v_motivo) = '' then
      raise exception 'Hay diferencia — el motivo es obligatorio';
    end if;
    -- mismo criterio que ajusteTipoPorSigno: manda ₡; si no hay ajuste ₡, manda US$
    if v_tipo <> (case when (case when v_aj_crc <> 0 then v_aj_crc else v_aj_usd end) < 0 then 'Faltante' else 'Sobrante' end) then
      raise exception 'El tipo de ajuste (%) no coincide con el signo de la diferencia', v_tipo;
    end if;
  elsif v_tipo <> '' then
    raise exception 'Hay tipo de ajuste (%) sin ajuste', v_tipo;
  end if;

  -- 6) Fila del cierre → completo (mismos campos que updateCierreCompleto).
  update public.cash_cierres_dia set
    tipo                 = 'completo',
    vn_crc               = coalesce((p_cierre->>'vn_crc')::numeric, 0),
    vn_usd               = coalesce((p_cierre->>'vn_usd')::numeric, 0),
    propinas_n_crc       = coalesce((p_cierre->>'propinas_n_crc')::numeric, 0),
    otros_n_crc          = coalesce((p_cierre->>'otros_n_crc')::numeric, 0),
    ef_real_n_crc        = coalesce((p_cierre->>'ef_real_n_crc')::numeric, 0),
    sep_diaria_crc       = coalesce((p_cierre->>'sep_diaria_crc')::numeric, 0),
    sep_diaria_usd       = coalesce((p_cierre->>'sep_diaria_usd')::numeric, 0),
    sep_registradora_crc = coalesce((p_cierre->>'sep_registradora_crc')::numeric, 0),
    sep_registradora_usd = coalesce((p_cierre->>'sep_registradora_usd')::numeric, 0),
    remanente_crc        = coalesce((p_cierre->>'remanente_crc')::numeric, 0),
    remanente_usd        = coalesce((p_cierre->>'remanente_usd')::numeric, 0),
    diferencia_crc       = v_dif,
    ajuste_tipo          = v_tipo,
    ajuste_motivo        = coalesce(p_cierre->>'ajuste_motivo', ''),
    notas                = coalesce(p_cierre->>'notas', ''),
    tipo_cambio          = (p_cierre->>'tipo_cambio')::numeric,
    close_op_id          = p_client_op_id,
    updated_at           = now()
  where id = v_row.id;

  -- 7) Limpieza de filas del cierre de esta fecha (mismos filtros que antes) — dentro de la tx.
  delete from public.cash_movements where subcategory = 'Ventas cierre' and description like '%' || p_fecha::text;
  delete from public.cash_movements where description = 'Retiro dueños a banco ' || p_fecha::text;
  delete from public.cash_movements where subcategory = 'Ajuste de cierre' and description like 'Ajuste de cierre ' || p_fecha::text || '%';

  -- 8) Ventas en efectivo (= recordCierreSales).
  for v_venta in select * from jsonb_array_elements(coalesce(p_ventas, '[]'::jsonb)) loop
    v_turno := v_venta->>'turno';
    v_crc   := coalesce((v_venta->>'crc')::numeric, 0);
    v_usd   := coalesce((v_venta->>'usd')::numeric, 0);
    if v_turno is null or v_turno not in ('Mediodía', 'Noche') then
      raise exception 'Turno de venta inválido: %', v_turno;
    end if;
    continue when v_crc = 0 and v_usd = 0;
    insert into public.cash_movements (session_id, created_by, movement_type, amount_crc, amount_usd, currency, exchange_rate,
      description, subcategory, supplier_id, supplier_name, employee_name, shift, caja_origen, method, status)
    values (null, v_uid, 'ingreso', v_crc, v_usd, 'CRC', p_exchange_rate,
      'Ventas efectivo ' || v_turno || ' ' || p_fecha::text, 'Ventas cierre', null, '', '', v_turno, 'Caja Fuerte', 'Efectivo', 'aprobado');
    v_n_ventas := v_n_ventas + 1;
  end loop;

  -- 9) Retiro de dueños a banco (= recordCierreRetiro).
  if coalesce(p_retiro_crc, 0) <> 0 then
    insert into public.cash_movements (session_id, created_by, movement_type, amount_crc, amount_usd, currency, exchange_rate,
      description, subcategory, supplier_id, supplier_name, employee_name, shift, caja_origen, method, status)
    values (null, v_uid, 'traspaso', p_retiro_crc, 0, 'CRC', p_exchange_rate,
      'Retiro dueños a banco ' || p_fecha::text, 'Caja Fuerte → Banco', null, '', '', '', 'Caja Fuerte', 'Transferencia', 'aprobado');
  end if;

  -- 10) Ajuste(s) de la diferencia (= recordCierreAjuste, con el mismo client_op_id determinístico).
  if v_aj_crc <> 0 then
    insert into public.cash_movements (client_op_id, session_id, created_by, movement_type, amount_crc, amount_usd, currency, exchange_rate,
      description, subcategory, supplier_id, supplier_name, employee_name, shift, caja_origen, method, status)
    values (public.cierre_ajuste_op_id(p_fecha, 'crc'), null, v_uid,
      case when v_aj_crc > 0 then 'ingreso' else 'egreso_operativo' end, abs(v_aj_crc), 0, 'CRC', p_exchange_rate,
      'Ajuste de cierre ' || p_fecha::text || ' · ' || case when v_aj_crc > 0 then 'Sobrante' else 'Faltante' end || ' · ' || v_motivo,
      'Ajuste de cierre', null, '', '', '', 'Caja Fuerte', 'Efectivo', 'aprobado');
    v_n_ajustes := v_n_ajustes + 1;
  end if;
  if v_aj_usd <> 0 then
    insert into public.cash_movements (client_op_id, session_id, created_by, movement_type, amount_crc, amount_usd, currency, exchange_rate,
      description, subcategory, supplier_id, supplier_name, employee_name, shift, caja_origen, method, status)
    values (public.cierre_ajuste_op_id(p_fecha, 'usd'), null, v_uid,
      case when v_aj_usd > 0 then 'ingreso' else 'egreso_operativo' end, 0, abs(v_aj_usd), 'CRC', p_exchange_rate,
      'Ajuste de cierre ' || p_fecha::text || ' · ' || case when v_aj_usd > 0 then 'Sobrante' else 'Faltante' end || ' · ' || v_motivo,
      'Ajuste de cierre', null, '', '', '', 'Caja Fuerte', 'Efectivo', 'aprobado');
    v_n_ajustes := v_n_ajustes + 1;
  end if;

  return jsonb_build_object('cierre_id', v_row.id, 'idempotente', false,
    'ventas', v_n_ventas, 'retiro', coalesce(p_retiro_crc, 0) <> 0, 'ajustes', v_n_ajustes);
end;
$function$;

-- ── Deshacer el cierre del día ──────────────────────────────────────────────────────────────
create or replace function public.deshacer_cierre_dia(
  p_fecha            date,
  p_manager_email    text default null,
  p_manager_password text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_id      uuid;
  v_ventas  int;
  v_retiro  int;
  v_ajustes int;
begin
  -- Rol: owner/manager directo; cajero con contraseña de gerencia verificada EN EL SERVIDOR
  -- (verify_manager: owner/manager activo, misma regla que mig 044). Sin contador.
  if get_my_role() in ('owner', 'manager') then
    null;
  elsif get_my_role() = 'cajero'
        and p_manager_email is not null and p_manager_password is not null
        and public.verify_manager(p_manager_email, p_manager_password) then
    null;
  else
    raise exception 'No autorizado para deshacer el cierre' using errcode = '42501';
  end if;

  select id into v_id from public.cash_cierres_dia where session_date = p_fecha for update;
  if not found then
    raise exception 'No hay cierre del % para deshacer', p_fecha;
  end if;

  delete from public.cash_movements where subcategory = 'Ventas cierre' and description like '%' || p_fecha::text;
  get diagnostics v_ventas = row_count;
  delete from public.cash_movements where description = 'Retiro dueños a banco ' || p_fecha::text;
  get diagnostics v_retiro = row_count;
  delete from public.cash_movements where subcategory = 'Ajuste de cierre' and description like 'Ajuste de cierre ' || p_fecha::text || '%';
  get diagnostics v_ajustes = row_count;
  delete from public.cash_cierres_dia where id = v_id;

  return jsonb_build_object('cierre_id', v_id, 'ventas', v_ventas, 'retiro', v_retiro, 'ajustes', v_ajustes);
end;
$function$;

-- ── Permisos ────────────────────────────────────────────────────────────────────────────────
revoke all on function public.cerrar_dia_completo(date, uuid, jsonb, jsonb, numeric, jsonb, numeric) from public, anon;
revoke all on function public.deshacer_cierre_dia(date, text, text) from public, anon;
revoke all on function public.cierre_ajuste_op_id(date, text) from public, anon;
grant execute on function public.cerrar_dia_completo(date, uuid, jsonb, jsonb, numeric, jsonb, numeric) to authenticated;
grant execute on function public.deshacer_cierre_dia(date, text, text) to authenticated;
grant execute on function public.cierre_ajuste_op_id(date, text) to authenticated;
