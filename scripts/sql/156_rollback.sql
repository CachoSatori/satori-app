-- Rollback de la 156 (origen 103): vuelve club_socio_alta_caja (md5 de pg_get_functiondef 22c4e664…) y
-- club_rol_activar_anfitrion (9ee7b899…) y club_miembro_guardar (5501bf4a…) a la versión de la 150, byte a byte (las de prod y
-- staging al 14-nov): el alta deja de devolver `token_portal` y activar un anfitrión deja de regenerarlo.
-- No toca datos (las filas «ver_link_portal» de club_auditoria quedan: es de solo inserción). Permisos iguales a los
-- de la 150. Borra la fila 156 del ledger (la 103 nunca se aplicó con ese número).
-- Si se corre en prod, en el mismo momento sale el .sql de main (regla 10 / satori-migraciones-y-prod §6). El front
-- sigue andando: sin `token_portal`, al cajero le dice que el link lo manda un manager (como el #169).
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
  return jsonb_build_object('miembro_id', v_id, 'estado', 'activo', 'provisional_hasta', now() + make_interval(days => v_cfg.socio_provisional_dias));
end;
$$;

revoke all on function public.club_socio_alta_caja(text, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.club_socio_alta_caja(text, text, text, boolean, text) to authenticated;

create or replace function public.club_rol_activar_anfitrion(p_miembro uuid, p_rol text, p_nota text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol  public.user_role := public.get_my_role();
  v_nota text := btrim(coalesce(p_nota, ''));
  v_m    public.club_miembros%rowtype;
begin
  if v_rol is null or v_rol not in ('owner','manager') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if p_rol is null or p_rol not in ('referente','concierge_pm','equipo') then
    raise exception 'Rol de anfitrión no válido (referente, concierge_pm o equipo)' using errcode = 'P0001';
  end if;
  if length(v_nota) not between 5 and 300 then
    raise exception 'La nota es obligatoria (de 5 a 300 caracteres): escribí por qué se activa como anfitrión' using errcode = 'P0001';
  end if;
  select * into v_m from public.club_miembros where id = p_miembro for update;
  if not found or v_m.estado <> 'activo' then
    raise exception 'No se encontró la cuenta activa: buscala de nuevo' using errcode = 'P0001';
  end if;
  if public.club_tiene_rol(p_miembro, array['referente','concierge_pm','equipo'], array['activo','baja']) then
    raise exception 'Ya es anfitrión: si estaba de baja, reactivalo desde su ficha' using errcode = 'P0001';
  end if;
  insert into public.club_miembro_roles (miembro_id, rol, estado, alta_por, validado_por, validado_en)
  values (p_miembro, p_rol, 'activo', 'gerencia', auth.uid(), now());
  update public.club_miembros set tipo = p_rol, updated_at = now() where id = p_miembro;
  perform public.club_auditar('activar_anfitrion', 'club_miembro_roles', p_miembro, null,
                              jsonb_build_object('rol', p_rol, 'nota', v_nota));
  return true;
end;
$$;

revoke all on function public.club_rol_activar_anfitrion(uuid, text, text) from public, anon, authenticated;
grant execute on function public.club_rol_activar_anfitrion(uuid, text, text) to authenticated;

create or replace function public.club_miembro_guardar(
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
begin
  if v_rol is null or v_rol not in ('owner','manager') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if length(v_nombre) not between 1 and 120 then
    raise exception 'El nombre es obligatorio (hasta 120 caracteres)' using errcode = 'P0001';
  end if;
  if p_tipo is null or p_tipo not in ('referente','concierge_pm','equipo') then
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
    -- LC-ML: el local se elige (o sale del negocio); sin dato, el único local con el Club activo
    insert into public.club_miembros (location_id, tipo, nombre, negocio_id, estado, origen)
    values (public.club_local(coalesce(p_location, (select n.location_id from public.club_negocios n where n.id = p_negocio_id)), false),
            p_tipo, v_nombre, p_negocio_id, coalesce(p_estado, 'activo'), 'app')
    returning id into v_id;
  else
    select m.estado into v_antes from public.club_miembros m where m.id = p_id for update;
    update public.club_miembros
       set tipo = p_tipo, nombre = v_nombre, negocio_id = p_negocio_id,
           estado = coalesce(p_estado, estado), updated_at = now()
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Miembro no encontrado' using errcode = 'P0001';
    end if;
    -- Baja: el saldo vence en la misma transacción. Volver a activo NO restituye
    -- (eso es club_ajuste tipo restitucion, solo owner).
    if v_antes = 'activo' and p_estado = 'baja' then
      v_saldo := public.club_saldo_personas(v_id);
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
$$;

revoke all on function public.club_miembro_guardar(uuid, text, text, uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.club_miembro_guardar(uuid, text, text, uuid, text, jsonb, text) to authenticated;

delete from supabase_migrations.schema_migrations where version = '156';
commit;
