-- ╔══════════════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 171 (origen club 117) — HOTFIX: club_miembro_guardar con lo de la 156 Y lo de la 157            ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════════════╝
--
-- ⚠ Cambia una función del Club en prod (baja de un socio = vencimiento de saldo): no se mergea sin la firma del dueño.
-- Creada como 117 (bloque CLUB); va como 171 del bloque de PASE (regla 3), origen 117. Entra DESPUÉS de la 158–170.
--
-- ── QUÉ PASÓ ───────────────────────────────────────────────────────────────────────────────────
-- La 156 (#174) y la 157 (#176) hicieron `create or replace` de club_miembro_guardar(uuid, text, text, uuid, text, jsonb,
-- text) partiendo, las dos, de la versión de la 150. La 157 entró última y pisó lo de la 156. En prod (leído el 14-nov,
-- md5 del cuerpo 18ff76b9…, = la 157):
--   · «Editar» un socio da «Tipo no válido (referente, concierge_pm o equipo)» (se perdió que acepte tipo 'socio' para
--     editar a quien ya es socio, sin reactivarlo si está de baja: LC-DES-01);
--   · un socio que pasa a anfitrión desde «Editar» NO recibe token_portal nuevo ni queda auditado
--     («tipo_a_anfitrion», token_portal_regenerado): el link del alta abriría un portal que genera códigos de canje.
--
-- ── QUÉ HACE ───────────────────────────────────────────────────────────────────────────────────
-- Cuerpo = fusión de tres vías (diff3: base 150, lados 156 y 157), sin conflictos y sin una línea propia:
--   · de la 157 (D7 A): la baja vence solo lo canjeable (club_saldo_canjeable; 0 en el equipo);
--   · de la 156: tipo 'socio' solo para editar a un socio; crear o pasar a socio por acá sigue rechazado; un socio de
--     baja no vuelve a activo por «Editar»; socio → anfitrión regenera token_portal y lo audita.
-- md5 del cuerpo resultante: e004268dd2d2198d77a3b49cb29ecc50 (lo verifica el ASSERT del final).
--
-- ── DÓNDE LO ESCRIBE (la 170 puede estar o no) ─────────────────────────────────────────────────
--   · Si existe club_miembro_guardar__nucleo (la 170 envolvió la función): se redefine EL NÚCLEO, nunca el envoltorio
--     (receta de la 170), y se le revoca EXECUTE a public/anon/authenticated. El envoltorio (chequeo de local) no se toca.
--   · Si no: se redefine la función pública; `create or replace` conserva dueño y permisos (EXECUTE solo authenticated).
--   El nombre sale de dos constantes; el cuerpo es un literal fijo (no se interpola ningún dato).
--   club_miembro_guardar_v2 (163) llama a la pública: sigue igual.
--
-- ── LO QUE NO TOCA ─────────────────────────────────────────────────────────────────────────────
--   · Ni tablas, ni datos, ni otras funciones, ni permisos de nadie.
--
-- Pruebas: scripts/sql/171_pruebas.sql (+ 171_pruebas.py; transacción descartada). Rollback: scripts/sql/171_rollback.sql.

begin;

do $mig$
declare
  v_nucleo boolean := to_regprocedure('public.club_miembro_guardar__nucleo(uuid,text,text,uuid,text,jsonb,text)') is not null;
  v_fn     text;
  v_cuerpo constant text := $cuerpo$(
  p_id uuid, p_tipo text, p_nombre text, p_negocio_id uuid, p_estado text, p_contacto jsonb, p_location text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol    public.user_role := public.get_my_role();
  v_nombre text := regexp_replace(btrim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_id     uuid;
  v_tel    text;
  v_email  text;
  v_antes  text;
  v_saldo  int;
  v_cfg    public.club_config%rowtype;
  v_tipo_antes text;          -- 156
  v_a_anfitrion boolean := false;   -- 156: pasa de no anfitrión (socio) a anfitrión
begin
  if v_rol is null or v_rol not in ('owner','manager') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if length(v_nombre) not between 1 and 120 then
    raise exception 'El nombre es obligatorio (hasta 120 caracteres)' using errcode = 'P0001';
  end if;
  -- 156: 'socio' solo para editar a alguien que ya es socio (nombre, contacto, estado); no se crea ni se pasa a socio acá
  if p_tipo is null or p_tipo not in ('referente','concierge_pm','equipo','socio') then
    raise exception 'Tipo no válido (referente, concierge_pm o equipo)' using errcode = 'P0001';
  end if;
  if p_estado is not null and p_estado not in ('activo','baja') then
    raise exception 'Estado no válido' using errcode = 'P0001';
  end if;
  if p_negocio_id is not null and not exists (select 1 from public.club_negocios n where n.id = p_negocio_id) then
    raise exception 'Negocio no encontrado' using errcode = 'P0001';
  end if;

  if p_contacto is not null then
    if jsonb_typeof(p_contacto) <> 'object' then
      raise exception 'Contacto no válido' using errcode = 'P0001';
    end if;
    v_tel := public.club_norm_telefono(p_contacto->>'telefono');
    v_email := nullif(lower(btrim(coalesce(p_contacto->>'email', ''))), '');
    if v_email is not null and (length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
      raise exception 'Email no válido' using errcode = 'P0001';
    end if;
  end if;

  if p_id is null then
    if p_tipo = 'socio' then
      raise exception 'Tipo no válido (referente, concierge_pm o equipo)' using errcode = 'P0001';
    end if;
    -- LC-ML: el local se elige (o sale del negocio); sin dato, el único local con el Club activo
    insert into public.club_miembros (location_id, tipo, nombre, negocio_id, estado, origen)
    values (public.club_local(coalesce(p_location, (select n.location_id from public.club_negocios n where n.id = p_negocio_id)), false),
            p_tipo, v_nombre, p_negocio_id, coalesce(p_estado, 'activo'), 'app')
    returning id into v_id;
  else
    select m.estado, m.tipo into v_antes, v_tipo_antes from public.club_miembros m where m.id = p_id for update;
    if p_tipo = 'socio' and v_tipo_antes is distinct from 'socio' then
      raise exception 'Tipo no válido (referente, concierge_pm o equipo)' using errcode = 'P0001';
    end if;
    -- 156 (LC-DES-01): un socio dado de baja no vuelve a activo por «Editar»: el trigger le devolvería el rol de socio
    -- sin verificar residencia ni confirmación de otro manager. Se reactiva con un alta nueva en caja.
    if v_tipo_antes = 'socio' and v_antes = 'baja' and p_estado = 'activo' then
      raise exception 'Para reactivar a un socio, dalo de alta de nuevo en caja' using errcode = 'P0001';
    end if;
    -- 156: un socio que pasa a anfitrión desde «Editar» recibe link nuevo (como club_rol_activar_anfitrion): el link
    -- que tenía como socio (entregado en el alta) no puede abrir un portal que genera códigos de canje.
    v_a_anfitrion := v_tipo_antes is not null and v_tipo_antes not in ('referente','concierge_pm','equipo')
                     and p_tipo in ('referente','concierge_pm','equipo');
    update public.club_miembros
       set tipo = p_tipo, nombre = v_nombre, negocio_id = p_negocio_id,
           token_portal = case when v_a_anfitrion then encode(extensions.gen_random_bytes(32), 'hex') else token_portal end,
           estado = coalesce(p_estado, estado), updated_at = now()
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Miembro no encontrado' using errcode = 'P0001';
    end if;
    if v_a_anfitrion then
      perform public.club_auditar('tipo_a_anfitrion', 'club_miembros', v_id, jsonb_build_object('tipo', v_tipo_antes),
                                  jsonb_build_object('tipo', p_tipo, 'token_portal_regenerado', true));
    end if;
    -- Baja: el saldo vence en la misma transacción. Volver a activo NO restituye
    -- (eso es club_ajuste tipo restitucion, solo owner).
    if v_antes = 'activo' and p_estado = 'baja' then
      -- D7 A (mig 157): vence solo lo canjeable (0 en el equipo). El saldo congelado no se toca: si no, el vencimiento
      -- quedaría después del corte y se comería lo que la cuenta gane si la reactivan.
      v_saldo := coalesce(public.club_saldo_canjeable(v_id), 0);
      if v_saldo > 0 then
        select * into v_cfg from public.club_config c
         where c.location_id = (select m.location_id from public.club_miembros m where m.id = v_id);
        insert into public.club_movimientos
          (location_id, miembro_id, tipo, personas, personas_por_credito, valor_credito_crc,
           fecha_visita, registrado_por, origen, nota)
        values
          (v_cfg.location_id, v_id, 'vencimiento', -v_saldo, v_cfg.personas_por_credito, v_cfg.valor_credito_crc,
           now(), auth.uid(), 'app', 'baja: saldo vencido');
      end if;
    end if;
  end if;

  if p_contacto is not null then
    insert into public.club_miembros_contacto (miembro_id, location_id, telefono, email, optin_whatsapp, optin_email)
    values (v_id, (select location_id from public.club_miembros where id = v_id), v_tel, v_email,
            coalesce((p_contacto->>'optin_whatsapp')::boolean, false) and v_tel is not null,
            coalesce((p_contacto->>'optin_email')::boolean, false) and v_email is not null)
    on conflict (miembro_id) do update
      set telefono = excluded.telefono, email = excluded.email,
          optin_whatsapp = excluded.optin_whatsapp, optin_email = excluded.optin_email, updated_at = now();
  end if;
  return v_id;
end;
$$$cuerpo$;
begin
  v_fn := case when v_nucleo then 'club_miembro_guardar__nucleo' else 'club_miembro_guardar' end;
  execute format('create or replace function public.%I', v_fn) || v_cuerpo;
  if v_nucleo then
    -- receta de la 170: el núcleo no es llamable por la API
    execute 'revoke all on function public.club_miembro_guardar__nucleo(uuid, text, text, uuid, text, jsonb, text) from public, anon, authenticated';
  end if;
end
$mig$;

-- Verificación (si algo no quedó como se espera, aborta y no queda nada)
do $$
declare
  v_nucleo boolean := to_regprocedure('public.club_miembro_guardar__nucleo(uuid,text,text,uuid,text,jsonb,text)') is not null;
  v_obj    regprocedure;
  v_pub    regprocedure := to_regprocedure('public.club_miembro_guardar(uuid,text,text,uuid,text,jsonb,text)');
  v_src    text;
  v_def    boolean;
  v_cfg    text[];
begin
  v_obj := case when v_nucleo then to_regprocedure('public.club_miembro_guardar__nucleo(uuid,text,text,uuid,text,jsonb,text)')
                else v_pub end;
  select p.prosrc, p.prosecdef, p.proconfig into v_src, v_def, v_cfg from pg_proc p where p.oid = v_obj;
  assert md5(v_src) = 'e004268dd2d2198d77a3b49cb29ecc50', '171: el cuerpo no es la fusión 156 + 157';
  assert position('club_saldo_canjeable' in v_src) > 0, '171: falta D7 A (157)';
  assert position('v_a_anfitrion' in v_src) > 0, '171: falta socio → anfitrión regenera token (156)';
  assert v_def and v_cfg = array['search_path=public, pg_temp'], '171: tiene que ser SECURITY DEFINER con search_path fijo';
  assert v_pub is not null and has_function_privilege('authenticated', v_pub, 'EXECUTE')
         and not has_function_privilege('anon', v_pub, 'EXECUTE'), '171: permisos de la función pública';
  if v_nucleo then
    assert not has_function_privilege('authenticated', v_obj, 'EXECUTE')
           and not has_function_privilege('anon', v_obj, 'EXECUTE'), '171: el núcleo no puede ser llamable por la API';
    assert position('club_miembro_guardar__nucleo(' in (select p.prosrc from pg_proc p where p.oid = v_pub)) > 0
           and position('club_exigir_local' in (select p.prosrc from pg_proc p where p.oid = v_pub)) > 0,
           '171: el envoltorio de la 170 tiene que seguir intacto';
  end if;
end
$$;

commit;
