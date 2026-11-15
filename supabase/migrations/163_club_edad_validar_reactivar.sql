-- ╔══════════════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 163 (origen 109) — D6 A, segunda parte: «Validar socio» y la reactivación piden «es mayor de 18» ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════════════╝
--
-- ⚠ Toca esquema (funciones y un trigger del Club): no se mergea sin la firma del dueño. Creada como 109 (bloque CLUB);
-- prod va por la 155 y 156–162 son de otros PRs, así que va como 163 del bloque de PASE (regla 3), origen 109.
-- Necesita la 159 (#140): va DESPUÉS de ella (este PR está apilado sobre el #140).
-- Decisión del dueño (14-nov): las autoaltas pendientes de antes de la 159 no confirmaron la edad, así que «Validar
-- socio» y la reactivación de un socio también piden la confirmación cuando la persona no la tiene registrada.
--
-- ── QUÉ HACE ───────────────────────────────────────────────────────────────────────────────────
--  1. club_roles_mayor_edad_chk (trigger diferido de la 159): además del alta, mira el PASO A ACTIVO del rol de socio
--     (pendiente → activo al validar; baja → activo al reactivar a la persona), venga de la función que venga. Si al
--     confirmar la transacción el rol quedó activo sin mayor_edad_en, la rechaza. Para el alta, igual que la 159.
--     Es la red: un cliente viejo (o cualquier otra vía) no activa a un socio sin la edad.
--  2. club_socio_mayor_edad_registrar(miembro, mayor_edad, via): interna (sin EXECUTE para nadie). Si el rol de socio
--     no tiene la edad: con mayor_edad = true la registra (mayor_edad_en = now()) y deja el rastro en club_auditoria
--     («socio_mayor_edad», con quién —actor y rol— y cuándo, y la vía); sin ella, rechaza con un mensaje para la caja.
--  3. club_socio_validar_v2(miembro, verifico_residencia, mayor_edad, location): envuelve a club_socio_validar (150,
--     sin tocarla) y, en la misma transacción, pide/registra la edad si falta. Mismos roles (owner, manager, cajero).
--  4. club_miembro_guardar_v2(…, mayor_edad, location): envuelve a club_miembro_guardar (la vigente: 150 o 156, sin
--     tocarla). Solo si la llamada REACTIVA a la persona (estaba de baja y pasa a activo) y su rol de socio queda activo
--     sin la edad, la pide/registra. Las demás ediciones pasan igual que antes. Mismos roles (owner, manager).
--
-- ── LO QUE NO TOCA ─────────────────────────────────────────────────────────────────────────────
--  · Ni plata, ni tablas, ni columnas, ni datos existentes. club_socio_validar y club_miembro_guardar NO se reescriben
--    y conservan su EXECUTE: un cliente viejo sigue funcionando con quien ya tiene la edad; sin ella, el trigger (1)
--    rechaza la activación al confirmar.
--  · club_socio_confirmar («Altas por confirmar»): no cambia el estado (el socio ya está activo), como los socios
--    activos de antes de la 159, que no se tocan (decisión D6 A: no se pide la edad hacia atrás).
--  · Un rol que vuelve a «pendiente» (autoalta sin validar) no pide la edad: la pide «Validar socio».
--
-- ⚠ ORDEN: 159 → 163 → app que llama a las *_v2. La app nueva sin la 163 falla al validar y al guardar un miembro
-- («function … does not exist»): la migración (Branching) y el deploy de la app entran en el MISMO merge.
-- Pruebas: scripts/sql/163_pruebas.sql (transacción descartada). Rollback: scripts/sql/163_rollback.sql.

-- ── 1. El trigger de la 159 también mira el paso a activo ───────────────────────────────────────
create or replace function public.club_roles_mayor_edad_chk()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.club_miembro_roles%rowtype;
  v_activa boolean := tg_op = 'UPDATE' and old.estado is distinct from 'activo' and new.estado = 'activo';   -- 163
begin
  if new.rol <> 'socio' then return null; end if;
  -- un alta (fila nueva o re-alta, que mueve `desde`), un intento de borrar la confirmación o (163) un paso a activo
  if tg_op = 'UPDATE' and old.desde is not distinct from new.desde and old.mayor_edad_en is not distinct from new.mayor_edad_en
     and not v_activa then
    return null;
  end if;
  -- diferido: se mira la fila como queda al final de la transacción (club_socio_crear la inserta y después la completa)
  select * into r from public.club_miembro_roles where miembro_id = new.miembro_id and rol = 'socio';
  if not found then return null; end if;
  if r.mayor_edad_en is null
     and ((r.estado <> 'baja' and r.alta_por in ('caja', 'autoalta'))
          or (v_activa and r.estado = 'activo')) then   -- 163: validar o reactivar, cualquier origen del alta
    raise exception 'Falta confirmar que es mayor de 18 años: el Local Club es solo para mayores de edad' using errcode = 'P0001';
  end if;
  return null;
end;
$$;
revoke all on function public.club_roles_mayor_edad_chk() from public, anon, authenticated;

-- ── 2. Registrar la edad (interna) ─────────────────────────────────────────────────────────────
create or replace function public.club_socio_mayor_edad_registrar(p_miembro uuid, p_mayor_edad boolean, p_via text)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.club_miembro_roles
                  where miembro_id = p_miembro and rol = 'socio' and mayor_edad_en is null) then
    return;   -- ya la tiene (o no es socio): nada que pedir
  end if;
  if coalesce(p_mayor_edad, false) is not true then
    raise exception 'Falta «es mayor de 18»: preguntale y marcá la casilla (el Local Club es solo para mayores)' using errcode = 'P0001';
  end if;
  update public.club_miembro_roles set mayor_edad_en = now(), actualizado_en = now()
   where miembro_id = p_miembro and rol = 'socio' and mayor_edad_en is null;
  -- quién (actor y rol) y cuándo los pone club_auditar; la vía dice desde dónde
  perform public.club_auditar('socio_mayor_edad', 'club_miembro_roles', p_miembro, jsonb_build_object('mayor_edad', false),
                              jsonb_build_object('mayor_edad', true, 'via', p_via));
end;
$$;
revoke all on function public.club_socio_mayor_edad_registrar(uuid, boolean, text) from public, anon, authenticated;

-- ── 3. «Validar socio» con la edad (envuelve a la de la 150, sin reescribirla) ──────────────────
create or replace function public.club_socio_validar_v2(p_miembro uuid, p_verifico_residencia boolean, p_mayor_edad boolean,
                                                        p_location text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_r jsonb;
begin
  -- mismo chequeo de rol que club_socio_validar (antes de mirar los datos)
  if public.get_my_role() is null or public.get_my_role() not in ('owner','manager','cajero') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  v_r := public.club_socio_validar(p_miembro, p_verifico_residencia, p_location);   -- sus reglas y mensajes, primero
  perform public.club_socio_mayor_edad_registrar(p_miembro, p_mayor_edad, 'validar');
  return v_r;
end;
$$;
revoke all on function public.club_socio_validar_v2(uuid, boolean, boolean, text) from public, anon, authenticated;
grant execute on function public.club_socio_validar_v2(uuid, boolean, boolean, text) to authenticated;

-- ── 4. Guardar miembro con la edad al reactivar (envuelve a la vigente, sin reescribirla) ────────
create or replace function public.club_miembro_guardar_v2(
  p_id uuid, p_tipo text, p_nombre text, p_negocio_id uuid, p_estado text, p_contacto jsonb, p_mayor_edad boolean,
  p_location text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_reactiva boolean := false;
  v_id uuid;
begin
  if public.get_my_role() is null or public.get_my_role() not in ('owner','manager') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if p_id is not null and p_estado = 'activo' then
    select m.estado = 'baja' into v_reactiva from public.club_miembros m where m.id = p_id;
  end if;
  v_id := public.club_miembro_guardar(p_id, p_tipo, p_nombre, p_negocio_id, p_estado, p_contacto, p_location);
  -- solo la reactivación, y solo si el rol de socio volvió a ACTIVO (si volvió a pendiente, la pide «Validar socio»)
  if coalesce(v_reactiva, false)
     and exists (select 1 from public.club_miembro_roles where miembro_id = v_id and rol = 'socio' and estado = 'activo') then
    perform public.club_socio_mayor_edad_registrar(v_id, p_mayor_edad, 'reactivacion');
  end if;
  return v_id;
end;
$$;
revoke all on function public.club_miembro_guardar_v2(uuid, text, text, uuid, text, jsonb, boolean, text) from public, anon, authenticated;
grant execute on function public.club_miembro_guardar_v2(uuid, text, text, uuid, text, jsonb, boolean, text) to authenticated;
