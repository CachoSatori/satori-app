-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 202 · Caja: endurecer `reemplazar_pago_caja` (los 4 Menores del verificador de la 200) ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- La 200 (#368) está en el ledger de prod y su .sql NO se toca (regla 10): esta migración reescribe las dos funciones
-- con `create or replace`, misma firma, mismo SECURITY DEFINER, mismo search_path y mismos grants/revokes.
--
--   · M1: en la rama «el nuevo ya está» (viejo todavía en la base), si el id del cliente choca con un movimiento de OTRO
--     local (o de uno que quien llama no ve), la 200 lo devolvía entero en `guardado` (estado 'distinto'). Ahora es un
--     error 42501 SIN datos y el viejo no se toca. El aparato ya trata el 42501 como «no» de la base (`sin_cambios`, no
--     cae al camino viejo): no cambia nada en la app.
--   · M3: `id = v_id or client_op_id = v_id limit 1` sin orden → con orden: manda la fila con ESE id (las dos ramas).
--   · M4: el alta guarda `btrim(method)`; la comparación (`_reemplazo_pago_coincide`) ahora hace btrim de los dos lados.
--   · M2: pruebas nuevas que muerden (scripts/sql/202_pruebas.sql); no cambia código.
--
-- Contrato para la app sin cambios: {estado: 'listo', repetido, nuevo} · {estado: 'distinto', guardado} · errores
-- 42501 / 22023 / P0002 / P0001 como en la 200, más el 42501 de M1.
-- GUARDA: corre SOLO si los dos cuerpos en la base son exactamente los de la 200 (md5 de prosrc sin espacios). Si ya
-- son los de la 202, o cualquier otra cosa, se para sin tocar nada.
-- NO toca ninguna tabla, política, disparador ni otra función (delete_movement_cascade se llama igual). Ningún dato.
-- Vuelta atrás: scripts/sql/202_rollback.sql (vuelve exactamente a la 200). Pruebas: scripts/sql/202_pruebas.sql.

-- ── 0. Guarda por huella ──────────────────────────────────────────────────────────────────────
do $guarda202$
declare
  v_r text;
  v_c text;
begin
  if to_regprocedure('public.delete_movement_cascade(uuid,text,text,text)') is null
     or to_regprocedure('public.puede_ver_local(text)') is null
     or to_regprocedure('public.get_my_role()') is null then
    raise exception '202: falta delete_movement_cascade, puede_ver_local o get_my_role';
  end if;
  if to_regprocedure('public.reemplazar_pago_caja(uuid,jsonb,text,text)') is null
     or to_regprocedure('public._reemplazo_pago_coincide(public.cash_movements,jsonb)') is null then
    raise exception '202: falta la 200 (reemplazar_pago_caja / _reemplazo_pago_coincide): se para sin tocar nada';
  end if;
  select md5(regexp_replace(prosrc, '\s', '', 'g')) into v_r
    from pg_proc where oid = 'public.reemplazar_pago_caja(uuid,jsonb,text,text)'::regprocedure;
  select md5(regexp_replace(prosrc, '\s', '', 'g')) into v_c
    from pg_proc where oid = 'public._reemplazo_pago_coincide(public.cash_movements,jsonb)'::regprocedure;
  if v_r = '3ca9211052b3b977f2e5a4f3432b99f1' and v_c = 'ec56e5b77dad0552543a037e0ccf34c3' then
    raise exception '202: ya aplicada (los cuerpos ya son los de la 202): se para sin tocar nada';
  end if;
  if v_r <> '636d3776826384ff46ed87a1cfe0db25' or v_c <> '98dae10d63e704afd7ff02930e655bbd' then
    raise exception '202: los cuerpos en la base no son los de la 200 (reemplazar_pago_caja %, _reemplazo_pago_coincide %): se para sin tocar nada',
      left(v_r, 8), left(v_c, 8);
  end if;
end
$guarda202$;

-- ── 1. ¿La fila guardada tiene ESTOS datos? (espejo de coincidePago del aparato) ─────────────
create or replace function public._reemplazo_pago_coincide(m public.cash_movements, d jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select m.amount_crc = (d->>'amount_crc')::numeric
     and coalesce(m.amount_usd, 0) = coalesce((d->>'amount_usd')::numeric, 0)
     and m.supplier_id is not distinct from nullif(d->>'supplier_id', '')::uuid
     and btrim(coalesce(m.method, '')) = btrim(coalesce(d->>'method', ''))   -- 202 · M4: = el btrim del alta
     and coalesce(m.caja_origen, '') = coalesce(d->>'caja_origen', '')
     and coalesce(m.description, '') = coalesce(d->>'description', '')
     and (select coalesce(array_agg(x order by x), '{}') from jsonb_array_elements_text(coalesce(m.attachments, '[]')) x)
       = (select coalesce(array_agg(x order by x), '{}') from jsonb_array_elements_text(coalesce(d->'attachments', '[]')) x)
$$;
revoke all on function public._reemplazo_pago_coincide(public.cash_movements, jsonb) from public, anon, authenticated;

-- ── 2. La función ───────────────────────────────────────────────────────────────────────────
create or replace function public.reemplazar_pago_caja(
  p_viejo            uuid,
  p_nuevo            jsonb,
  p_manager_email    text default null,
  p_manager_password text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c_nota    constant text := 'Reemplazo por edición de pago a proveedor';   -- = NOTA_REEMPLAZO del aparato
  v_uid     uuid := auth.uid();
  v_rol     public.user_role := public.get_my_role();
  v_aut     uuid;
  v_aut_rol public.user_role;
  v_id      uuid;
  v_ses_id  uuid;
  v_crc     numeric;
  v_usd     numeric;
  v_metodo  text;
  v_caja    text;
  v_fotos   jsonb;
  v_viejo   public.cash_movements%rowtype;
  v_ya      public.cash_movements%rowtype;
  v_ses     public.cash_sessions%rowtype;
begin
  -- ── A. Quién llama y quién autoriza (igual que delete_movement_cascade) ──
  if v_uid is null or v_rol is null or v_rol not in ('owner', 'manager', 'cajero') then
    raise exception 'No autorizado para cambiar pagos' using errcode = '42501';
  end if;
  if v_rol in ('owner', 'manager') then
    v_aut := v_uid; v_aut_rol := v_rol;
  elsif p_manager_email is not null and p_manager_password is not null then
    select u.id, p.role into v_aut, v_aut_rol
      from auth.users u join public.profiles p on p.id = u.id
     where lower(u.email) = lower(btrim(p_manager_email))
       and u.encrypted_password = extensions.crypt(p_manager_password, u.encrypted_password)
       and p.role in ('owner', 'manager') and p.is_active;
    if v_aut is null then
      raise exception 'No autorizado para cambiar pagos' using errcode = '42501';
    end if;
  else
    raise exception 'No autorizado para cambiar pagos' using errcode = '42501';
  end if;

  -- ── B. Datos del nuevo (antes de bloquear nada) ──
  if p_viejo is null or p_nuevo is null or jsonb_typeof(p_nuevo) <> 'object' then
    raise exception 'Faltan datos del cambio' using errcode = '22023';
  end if;
  v_id := nullif(p_nuevo->>'id', '')::uuid;
  if v_id is null or v_id = p_viejo then
    raise exception 'Falta el id del pago nuevo' using errcode = '22023';
  end if;
  v_crc    := (p_nuevo->>'amount_crc')::numeric;
  v_usd    := coalesce((p_nuevo->>'amount_usd')::numeric, 0);
  v_metodo := btrim(coalesce(p_nuevo->>'method', ''));
  v_caja   := coalesce(p_nuevo->>'caja_origen', '');
  v_fotos  := coalesce(p_nuevo->'attachments', '[]'::jsonb);
  -- (NaN e Infinity son numeric válidos en Postgres: se rechazan explícitamente; 1e12 es un tope de cordura.)
  if v_crc is null or v_crc = 'NaN'::numeric or v_crc <= 0 or v_crc >= 1e12
     or v_usd = 'NaN'::numeric or v_usd < 0 or v_usd >= 1e12 then
    raise exception 'Monto inválido: el pago tiene que ser mayor que 0 (y los dólares, 0 o más)' using errcode = '22023';
  end if;
  if v_metodo = '' or v_caja not in ('Caja Proveedores', 'Banco') or ((v_metodo = 'Efectivo') <> (v_caja = 'Caja Proveedores')) then
    raise exception 'Método o caja inválidos' using errcode = '22023';
  end if;
  if nullif(p_nuevo->>'supplier_id', '') is null then
    raise exception 'Falta el proveedor' using errcode = '22023';
  end if;
  if jsonb_typeof(v_fotos) <> 'array' then
    raise exception 'Fotos inválidas' using errcode = '22023';
  end if;

  -- ── C. Bloqueo del viejo: dos aparatos no lo reemplazan a la vez ──
  select * into v_viejo from public.cash_movements where id = p_viejo for update;
  if not found then
    -- ¿Ya lo reemplazó ESTE mismo cambio (reintento)? Solo si el que está con ese id ES el reemplazo de este viejo se
    -- mira si tiene ESTOS datos: iguales → el mismo resultado; otros → «distinto» (lo guardado manda: nunca «listo» con
    -- otro monto). «Es el reemplazo»: id = client_op_id = el del cliente, pago a proveedor, y el viejo se borró con la
    -- nota de reemplazo, en el mismo local, DESPUÉS de que se creara este (hasta 1 h de reloj del aparato) y este es
    -- más nuevo que el viejo. Un pago anterior al viejo, o creado después del borrado, no es su reemplazo.
    -- 202 · M3: determinista; si hay una fila con ESE id y otra con ese client_op_id, manda la del id.
    select * into v_ya from public.cash_movements where id = v_id or client_op_id = v_id order by (id = v_id) desc limit 1;
    if found and public.puede_ver_local(v_ya.location_id) then
      if v_ya.id = v_id and v_ya.client_op_id = v_id and v_ya.movement_type = 'egreso_mercaderia'
         and exists (select 1 from public.movement_deletions d
                      where d.movement_snapshot->>'id' = p_viejo::text and d.note = c_nota
                        and d.movement_snapshot->>'location_id' = v_ya.location_id
                        and v_ya.created_at > (d.movement_snapshot->>'created_at')::timestamptz
                        and v_ya.created_at <= d.deleted_at + interval '1 hour') then
        if public._reemplazo_pago_coincide(v_ya, p_nuevo) then
          return jsonb_build_object('estado', 'listo', 'repetido', true, 'nuevo', to_jsonb(v_ya));
        end if;
        return jsonb_build_object('estado', 'distinto', 'guardado', to_jsonb(v_ya));
      end if;
      -- Ese id es de OTRO movimiento: no se devuelve como si fuera el reemplazo.
      raise exception 'El pago anterior ya no existe y ese id es de otro movimiento. Recargá la lista.' using errcode = 'P0002';
    end if;
    raise exception 'El pago anterior ya no existe (otro aparato lo cambió o lo borró). Recargá la lista.' using errcode = 'P0002';
  end if;

  -- ── D. Local: el de quien llama y el de quien autoriza ──
  if not public.puede_ver_local(v_viejo.location_id) then
    raise exception 'No autorizado para cambiar pagos de ese local' using errcode = '42501';
  end if;
  if v_aut <> v_uid and v_aut_rol = 'manager'
     and exists (select 1 from public.profile_locations pl where pl.profile_id = v_aut)
     and not exists (select 1 from public.profile_locations pl where pl.profile_id = v_aut and pl.location_id = v_viejo.location_id) then
    raise exception 'No autorizado para cambiar pagos de ese local' using errcode = '42501';
  end if;
  if v_aut <> v_uid and v_aut_rol = 'manager'
     and not exists (select 1 from public.profile_locations pl where pl.profile_id = v_aut)
     and v_viejo.location_id <> 'santa-teresa' then
    raise exception 'No autorizado para cambiar pagos de ese local' using errcode = '42501';   -- = mis_locales sin asignación
  end if;
  if v_viejo.movement_type <> 'egreso_mercaderia' then
    raise exception 'Solo se cambian pagos a proveedor' using errcode = '22023';
  end if;

  -- ── E. ¿El nuevo ya está? (un intento anterior entró sin llegar a borrar el viejo) ──
  -- 202 · M3: determinista (manda la fila con ESE id).
  select * into v_ya from public.cash_movements where id = v_id or client_op_id = v_id order by (id = v_id) desc limit 1 for update;
  if found then
    -- 202 · M1: un id que choca con un movimiento de OTRO local (o de uno que quien llama no ve) no se devuelve:
    -- error sin datos. Antes salía entero en «guardado».
    if v_ya.location_id is distinct from v_viejo.location_id or not public.puede_ver_local(v_ya.location_id) then
      raise exception 'Ese id ya lo usa un movimiento de otro local. Recargá la lista.' using errcode = '42501';
    end if;
    if v_ya.id <> v_id or not public._reemplazo_pago_coincide(v_ya, p_nuevo) then
      return jsonb_build_object('estado', 'distinto', 'guardado', to_jsonb(v_ya));   -- el viejo NO se borra
    end if;
  else
    -- Regla 11: el nuevo va al turno del viejo; si el viejo no tenía turno, a un turno de su local y de su día.
    v_ses_id := nullif(p_nuevo->>'session_id', '')::uuid;
    select * into v_ses from public.cash_sessions where id = v_ses_id;
    if not found or v_ses.location_id <> v_viejo.location_id
       or (v_viejo.session_id is not null and v_ses_id <> v_viejo.session_id)
       or (v_viejo.session_id is null and v_ses.session_date <> (v_viejo.created_at at time zone 'America/Costa_Rica')::date) then
      raise exception 'El pago nuevo tiene que quedar en el turno del pago anterior' using errcode = '22023';
    end if;
    insert into public.cash_movements (
      id, client_op_id, session_id, created_by, movement_type, amount_crc, amount_usd, currency, exchange_rate,
      description, supplier_id, supplier_name, employee_name, method, shift, caja_origen, subcategory, attachments,
      classification, suggested_classification, suggested_confidence, status, location_id
    ) values (
      v_id, v_id, v_ses_id, v_uid, 'egreso_mercaderia', v_crc, v_usd, 'CRC', nullif(p_nuevo->>'exchange_rate', '')::numeric,
      coalesce(p_nuevo->>'description', ''), (p_nuevo->>'supplier_id')::uuid, coalesce(p_nuevo->>'supplier_name', ''), '',
      v_metodo, coalesce(p_nuevo->>'shift', ''), v_caja, coalesce(p_nuevo->>'subcategory', ''), v_fotos,
      nullif(p_nuevo->>'classification', ''), nullif(p_nuevo->>'suggested_classification', ''),
      nullif(p_nuevo->>'suggested_confidence', '')::numeric,
      case when v_metodo = 'Transferencia' then 'pendiente' else 'aprobado' end,   -- = createCashMovement
      v_viejo.location_id
    )
    returning * into v_ya;
  end if;

  -- ── F. Borrado del viejo, el de siempre (misma transacción: si falla, el alta tampoco queda) ──
  perform public.delete_movement_cascade(p_viejo, c_nota, p_manager_email, p_manager_password);
  if exists (select 1 from public.cash_movements where id = p_viejo) then
    raise exception 'No se pudo borrar el pago anterior' using errcode = 'P0001';
  end if;
  return jsonb_build_object('estado', 'listo', 'repetido', false, 'nuevo', to_jsonb(v_ya));
end
$$;

revoke all on function public.reemplazar_pago_caja(uuid, jsonb, text, text) from public, anon;
grant execute on function public.reemplazar_pago_caja(uuid, jsonb, text, text) to authenticated;
comment on function public.reemplazar_pago_caja(uuid, jsonb, text, text) is
  '200 + 202 · Cambiar un pago a proveedor en UNA transacción: alta del nuevo (id del cliente, idempotente) + borrado del viejo por delete_movement_cascade. Hallazgo 252 / R36. 202: id de otro local = 42501 sin datos, búsqueda determinista, método con btrim.';
