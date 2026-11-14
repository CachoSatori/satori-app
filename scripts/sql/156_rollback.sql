-- Rollback de la 156 (origen 103): vuelve club_socio_alta_caja a la versión de la 150, byte a byte (md5 de
-- pg_get_functiondef 22c4e664…, el de prod y staging al 14-nov): el alta en caja deja de devolver `token_portal`.
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

delete from supabase_migrations.schema_migrations where version = '156';
commit;
