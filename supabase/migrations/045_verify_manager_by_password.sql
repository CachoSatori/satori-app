-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 045 — verify_manager_password: autorización de gerencia por SOLO CONTRASEÑA.            ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- ✅ FIRMADA POR LA DUEÑA (sesión 2026-07-02). ⚠ NO APLICADA TODAVÍA — este archivo solo se
--    escribe en la rama; se aplica después con el procedimiento de staging (ref
--    hwiatgicyyqyezqwldia), NUNCA directo en producción. Tras aplicarla: regenerar los tipos
--    de Supabase.
--
-- ── QUÉ CAMBIA ─────────────────────────────────────────────────────────────────────────
-- El modal de autorización de gerencia (ManagerOverride) pasa de email+contraseña a UN solo
-- campo: la contraseña. La contraseña IDENTIFICA quién autoriza: esta RPC la valida contra
-- TODOS los owner/manager activos y devuelve la identidad del ÚNICO que matchea.
--
-- ── COLISIONES ─────────────────────────────────────────────────────────────────────────
-- Si la misma contraseña matchea a MÁS DE UN owner/manager, la atribución sería ambigua →
-- se RECHAZA con error explícito ('Contraseñas de gerencia duplicadas…') en vez de atribuir
-- a ciegas. La auditoría (movement_deletions.authorized_by) exige saber QUIÉN autorizó.
--
-- ── CÓMO SE RE-VERIFICA EN LAS RPCs DE PLATA (sin tocar delete_movement_cascade) ────────
-- Esta RPC es el gate del modal (UX + identidad). Para el borrado/edición, el front reenvía
-- a delete_movement_cascade (mig 044) el PAR (email devuelto por ESTA RPC, contraseña
-- ingresada) — la RPC de borrado re-valida ese par server-side con el mismo crypt, exactamente
-- como hasta ahora. No hace falta cambiarle la firma: la identidad viene del server (no la
-- tipea el cajero) y el server la re-verifica igual. Por eso esta migración NO toca 044.
--
-- ── COMPATIBILIDAD ─────────────────────────────────────────────────────────────────────
-- verify_manager (mig 019, email+contraseña) NO se borra: queda por compatibilidad hasta el
-- cleanup (clientes viejos cacheados podrían seguir llamándola durante el deploy).
--
-- Espeja el estilo/seguridad de 019: SECURITY DEFINER + search_path vacío, crypt de pgcrypto
-- contra auth.users.encrypted_password, exige owner/manager ACTIVO, no expone hashes, no toca
-- la sesión del llamador. Idempotente (create or replace).

create or replace function public.verify_manager_password(p_password text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_matches int;
  v_user_id uuid;
  v_email   text;
  v_role    text;
begin
  -- Contraseña vacía: rechazo directo (con el mismo freno del camino de fallo).
  if coalesce(p_password, '') = '' then
    perform pg_sleep(0.5);
    raise exception 'Contraseña inválida o sin permiso de gerencia';
  end if;

  -- ¿Cuántos owner/manager ACTIVOS matchean esta contraseña? (crypt de pgcrypto, igual que
  -- verify_manager 019 y delete_movement_cascade 044; encrypted_password null nunca matchea).
  select count(*) into v_matches
    from auth.users u
    join public.profiles p on p.id = u.id
   where u.encrypted_password = extensions.crypt(p_password, u.encrypted_password)
     and p.role in ('owner', 'manager')
     and p.is_active;

  if v_matches = 1 then
    -- Exactamente UNO → esa es la identidad del autorizante. Éxito sin sleep: el freno
    -- anti-fuerza-bruta solo castiga los intentos fallidos, no la operación legítima.
    select u.id, u.email, p.role
      into v_user_id, v_email, v_role
      from auth.users u
      join public.profiles p on p.id = u.id
     where u.encrypted_password = extensions.crypt(p_password, u.encrypted_password)
       and p.role in ('owner', 'manager')
       and p.is_active;
    return jsonb_build_object('user_id', v_user_id, 'email', v_email, 'role', v_role);
  end if;

  -- Freno anti-fuerza-bruta simple: todo camino de fallo cuesta 0.5s (mismo espíritu que el
  -- pg_sleep(0.3) de 019; acá un poco más porque esta RPC prueba contra TODAS las cuentas).
  perform pg_sleep(0.5);

  if v_matches > 1 then
    -- Colisión: atribuir a ciegas rompería la auditoría (authorized_by). Rechazo explícito.
    raise exception 'Contraseñas de gerencia duplicadas: más de un encargado/dueño usa esta contraseña. Uno de ellos debe cambiarla para poder autorizar.';
  end if;

  raise exception 'Contraseña inválida o sin permiso de gerencia';
end;
$$;

-- Solo usuarios logueados pueden invocarla (nunca anon) — igual que verify_manager (019).
revoke all on function public.verify_manager_password(text) from public, anon;
grant execute on function public.verify_manager_password(text) to authenticated;
