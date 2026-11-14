-- Rollback de la 158 (origen 105): vuelve club_cupon_ver a la versión de la 150, byte a byte (md5 de pg_get_functiondef
-- d6f98caf…, el de prod y staging antes de la 158), saca club_cupon_resena_clic, el CHECK y las dos columnas
-- (club_config.resena_url y club_cupones.resena_clic_en: se pierden los links cargados y las marcas de clic; no hay plata
-- ni datos personales). Borra la fila 158 del ledger (la 105 nunca se aplicó con ese número).
-- Si se corre en prod, en el mismo momento sale el .sql de main (regla 10 / satori-migraciones-y-prod §6).
-- Orden: primero el código de club-web (revert del merge), así la página deja de pedir `resena` y el clic.
begin;

drop function if exists public.club_cupon_resena_clic(text);

create or replace function public.club_cupon_ver(p_codigo text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_cod text := upper(btrim(coalesce(p_codigo, '')));
  v_c   public.club_cupones%rowtype;
  v_m   public.club_miembros%rowtype;
begin
  if not public.club_web_ok() then   -- CLUB-AUD-06: solo por club-web
    raise exception 'Cupón no válido' using errcode = 'P0001';
  end if;
  if v_cod !~ '^[A-HJ-NP-Z2-9]{10}$' then
    raise exception 'Cupón no válido' using errcode = 'P0001';
  end if;
  select * into v_c from public.club_cupones c where c.codigo = v_cod;
  if not found then
    raise exception 'Cupón no válido' using errcode = 'P0001';
  end if;
  select * into v_m from public.club_miembros m where m.id = v_c.referente_id;
  return jsonb_build_object(
    'estado', case
                when v_c.estado = 'usado' then 'usado'
                when v_c.estado = 'anulado' or v_m.estado <> 'activo' or v_c.vence_en <= now() then 'vencido'
                else 'vigente' end,
    'vence_en', v_c.vence_en,
    'referente', public.club_nombre_pila(v_m.nombre),
    -- LC-ML: el local del cupón sale de club_config (nombre, dirección y mapa), no de club-web
    'local', (select jsonb_build_object('id', c.location_id, 'nombre', coalesce(c.nombre, c.location_id), 'direccion', c.direccion,
                                       'mapa', c.mapa_url) from public.club_config c where c.location_id = v_c.location_id));
end;
$$;

revoke all on function public.club_cupon_ver(text)    from public, anon, authenticated;
grant execute on function public.club_cupon_ver(text) to anon, authenticated;

alter table public.club_config  drop constraint if exists club_config_resena_url_google;
alter table public.club_config  drop column if exists resena_url;
alter table public.club_cupones drop column if exists resena_clic_en;

delete from supabase_migrations.schema_migrations where version = '158';

do $$
begin
  if md5(pg_get_functiondef('public.club_cupon_ver(text)'::regprocedure)) <> 'd6f98caf8a564261b7eb39e636f6ab73' then
    raise exception '158 rollback: club_cupon_ver no quedó igual a la de la 150';
  end if;
end
$$;

commit;
