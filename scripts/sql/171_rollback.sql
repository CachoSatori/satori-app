-- Rollback de la 171 (origen club 117): vuelve club_miembro_guardar a la definición de la 157 (la que estaba en prod
-- antes de la 171: md5 del cuerpo 18ff76b9d77ee92d88ac07d3ff3e4c89, leído en prod el 14-nov) y borra la fila 171 del
-- ledger. Con la 170 aplicada, vuelve el NÚCLEO (club_miembro_guardar__nucleo) y no toca el envoltorio; sin la 170, la
-- pública. Permisos: create or replace los conserva (y el núcleo vuelve a quedar sin EXECUTE para la API).
-- ⚠ Volver a la 157 es volver al error de prod («Editar» un socio → «Tipo no válido»; socio → anfitrión sin link nuevo).
--   Solo si la 171 rompe algo peor. No toca tablas ni datos: lo que se guardó con la 171 (tokens nuevos, auditoría) queda.
-- Si se corre en prod, en el mismo momento sale el .sql de main en un PR (regla 10 / satori-migraciones-y-prod §6): si
-- queda, Branching la vuelve a aplicar en el próximo push.
-- ORDEN: antes de revertir la 157 o la 170 (sus rollbacks parten de la versión anterior a la 171).
begin;

do $rb$
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
    execute 'revoke all on function public.club_miembro_guardar__nucleo(uuid, text, text, uuid, text, jsonb, text) from public, anon, authenticated';
  end if;
  assert (select md5(p.prosrc) from pg_proc p
           where p.oid = to_regprocedure('public.' || v_fn || '(uuid,text,text,uuid,text,jsonb,text)')) = '18ff76b9d77ee92d88ac07d3ff3e4c89',
         '171 rollback: el cuerpo no quedó como el de la 157';
end
$rb$;

delete from supabase_migrations.schema_migrations where version = '171';

commit;
