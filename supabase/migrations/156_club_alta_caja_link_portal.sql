-- ╔══════════════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 156 (origen 103) — Alta de socio en caja: devuelve el link del portal del socio RECIÉN CREADO.  ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════════════╝
--
-- ⚠ Cambia una función del Club en prod (permisos de un dato sensible): no se mergea sin el OK del dueño. Creada como
-- 103 (bloque CLUB); prod va por la 155, así que va como 156 del bloque de PASE (regla 3), con origen 103.
-- Firma del dueño: 14-nov 06:04 -06:00 («que el cajero también pueda mandarle el link al socio recién dado de alta»).
--
-- ── QUÉ CIERRA ─────────────────────────────────────────────────────────────────────────────────
-- El #169 muestra «Mandarle su link por WhatsApp ↗» al terminar el alta en caja, pero solo a owner y manager:
-- club_miembro_token (150) le niega el token al cajero, que es quien hace casi todas las altas.
--
-- ── DISEÑO (mínimo privilegio) ─────────────────────────────────────────────────────────────────
-- NO se abre club_miembro_token al cajero (le daría el portal de CUALQUIER miembro, también de los anfitriones, que
-- generan códigos de canje). En cambio, club_socio_alta_caja devuelve `token_portal` en su misma respuesta, y SOLO si
-- la persona se creó en esa llamada:
--   · el teléfono no era de nadie (club_miembro_por_telefono = null, bajo el candado del teléfono que ya tomaba), y
--   · la fila de club_miembros tiene created_at = now() (creada en esta transacción).
-- Si el número ya era de alguien (socio dado de baja que vuelve, anfitrión que se hace socio), club_socio_crear REUSA
-- esa persona: ahí `token_portal` va null y el link lo manda un manager desde Miembros, como hoy.
-- No hay función nueva que llamar ni ventana de tiempo: el token no se puede volver a pedir después.
-- Queda auditado como «ver_link_portal» (CLUB-AUD-25, la misma acción que club_miembro_token), con via = alta_caja.
--
-- ── QUÉ HACE ───────────────────────────────────────────────────────────────────────────────────
--   · `create or replace` de public.club_socio_alta_caja(text, text, text, boolean, text): copia EXACTA de la vigente
--     (150; md5 de pg_get_functiondef 22c4e664… igual en prod y staging, leído el 14-nov) + dos variables, el chequeo
--     «persona nueva», la auditoría y la clave nueva `token_portal` en el jsonb. Las claves de antes no cambian.
--   · Permisos iguales a los de la 150: revoke a public/anon/authenticated y grant execute a authenticated. Roles
--     adentro sin cambios (owner, manager, cajero).
--
-- ── LO QUE NO TOCA ─────────────────────────────────────────────────────────────────────────────
--   · Ni tablas, ni datos, ni plata. club_miembro_token sigue solo para owner y manager.
--   · club_socio_validar (validar en caja una autoalta del sitio) no cambia: ese socio ya recibió su link en el sitio.
--
-- Pruebas: scripts/sql/156_pruebas.sql (+ 156_pruebas.py; solo staging, transacción descartada).
-- Rollback: scripts/sql/156_rollback.sql (la versión anterior exacta).

begin;

create or replace function public.club_socio_alta_caja(p_nombre text, p_whatsapp text, p_email text, p_verifico_residencia boolean,
                                                       p_location text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol public.user_role := public.get_my_role();
  v_cfg public.club_config%rowtype;
  v_tel text;
  v_em  text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_id  uuid;
  v_nuevo boolean;   -- 156: el teléfono no era de nadie → esta llamada crea la persona
  v_tok text;        -- 156: token del portal, SOLO si la persona es nueva
begin
  p_location := public.club_local(p_location, true);   -- LC-ML: el local sale de datos
  if v_rol is null or v_rol not in ('owner','manager','cajero') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  select * into v_cfg from public.club_config where location_id = p_location;
  if not found then raise exception 'Local no válido: elegí el local de la lista' using errcode = 'P0001'; end if;
  if length(btrim(coalesce(p_nombre, ''))) not between 2 and 120 then
    raise exception 'Falta el nombre: escribí nombre y apellido' using errcode = 'P0001';
  end if;
  if coalesce(p_verifico_residencia, false) is not true then
    raise exception 'Falta «verifiqué residencia»: confirmá que es local antes del alta' using errcode = 'P0001';
  end if;
  begin
    v_tel := public.club_norm_telefono(p_whatsapp);
  exception when others then
    raise exception 'WhatsApp no válido: revisá el número (8 dígitos o con código de país)' using errcode = 'P0001';
  end;
  if v_tel is null then raise exception 'Falta el WhatsApp: es obligatorio para el alta' using errcode = 'P0001'; end if;
  if v_em is not null and (v_em !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_em) > 254) then
    raise exception 'Email no válido: corregilo o dejalo vacío' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('club_socio_tel:' || v_tel, 0));
  -- 156: bajo el mismo candado del teléfono. Si el número ya es de alguien (un socio dado de baja, un anfitrión),
  -- club_socio_crear REUSA esa persona: entonces NO se devuelve su token (sería abrirle a la caja el portal de otro).
  v_nuevo := public.club_miembro_por_telefono(v_tel) is null;
  begin
    v_id := public.club_socio_crear(p_nombre, v_tel, v_em, 'activo', 'caja', null, null, p_location);
  exception when others then
    if sqlerrm = 'YA_ES_SOCIO' then
      raise exception 'Ya es socio (o tiene el alta pendiente): escaneá su QR o validalo desde ahí' using errcode = 'P0001';
    end if;
    raise;
  end;
  perform public.club_socio_provisional(v_id, v_cfg.socio_provisional_dias);
  -- CLAUDE-HALL-03: el alta en caja también registra la versión del aviso que la caja le muestra al socio.
  update public.club_miembro_roles set aviso_version = v_cfg.aviso_privacidad_version, aviso_aceptado_en = now()
   where miembro_id = v_id and rol = 'socio';
  perform public.club_auditar('socio_alta_caja', 'club_miembro_roles', v_id, null,
                              jsonb_build_object('verifico_residencia', true, 'provisional_dias', v_cfg.socio_provisional_dias));
  -- 156: el link del portal para mandárselo por WhatsApp (también al cajero), solo de la persona recién creada en
  -- ESTA llamada y solo en esta respuesta. Queda en la auditoría como «ver_link_portal», igual que club_miembro_token.
  if v_nuevo then
    select m.token_portal into v_tok from public.club_miembros m
     where m.id = v_id and m.created_at = now();   -- creada en esta misma transacción
    if v_tok is not null then
      perform public.club_auditar('ver_link_portal', 'club_miembros', v_id, null, jsonb_build_object('via', 'alta_caja'));
    end if;
  end if;
  return jsonb_build_object('miembro_id', v_id, 'estado', 'activo', 'provisional_hasta', now() + make_interval(days => v_cfg.socio_provisional_dias),
                            'token_portal', v_tok);
end;
$$;

revoke all on function public.club_socio_alta_caja(text, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.club_socio_alta_caja(text, text, text, boolean, text) to authenticated;

-- Verificación (si algo no quedó como se espera, aborta y no queda nada)
do $$
declare v_src text; v_def boolean;
begin
  select p.prosrc, p.prosecdef into v_src, v_def from pg_proc p
   where p.oid = 'public.club_socio_alta_caja(text,text,text,boolean,text)'::regprocedure;
  if position('v_nuevo := public.club_miembro_por_telefono(v_tel) is null' in v_src) = 0
     or position($q$'token_portal', v_tok$q$ in v_src) = 0 then
    raise exception '156: club_socio_alta_caja no tiene el token solo para la persona nueva';
  end if;
  if not v_def then
    raise exception '156: club_socio_alta_caja tiene que ser SECURITY DEFINER';
  end if;
  if has_function_privilege('anon', 'public.club_socio_alta_caja(text,text,text,boolean,text)', 'EXECUTE') then
    raise exception '156: anon no puede ejecutar club_socio_alta_caja';
  end if;
  if not has_function_privilege('authenticated', 'public.club_socio_alta_caja(text,text,text,boolean,text)', 'EXECUTE') then
    raise exception '156: authenticated tiene que poder ejecutar club_socio_alta_caja';
  end if;
  if has_function_privilege('anon', 'public.club_miembro_token(uuid)', 'EXECUTE') then
    raise exception '156: club_miembro_token no se abre';
  end if;
end
$$;

commit;
