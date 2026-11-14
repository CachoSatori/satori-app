-- 163_rollback (origen 109) — deshace la 163 y deja la 159 como estaba. Una transacción.
-- Orden de la vuelta atrás (skill satori-migraciones-y-prod §6): esto + en el MISMO momento un PR que saca
-- supabase/migrations/163_club_edad_validar_reactivar.sql de main (si queda, Branching la vuelve a aplicar) y revierte
-- la app (que llama a club_socio_validar_v2 y club_miembro_guardar_v2: sin ellas, «Validar socio» y «Guardar» de un
-- miembro fallan). La 159 y su trigger quedan.
-- Los mayor_edad_en registrados por la 163 y sus filas de club_auditoria («socio_mayor_edad») se QUEDAN: son
-- confirmaciones reales que dio el personal (la auditoría es inmutable).
begin;

drop function if exists public.club_miembro_guardar_v2(uuid, text, text, uuid, text, jsonb, boolean, text);
drop function if exists public.club_socio_validar_v2(uuid, boolean, boolean, text);
drop function if exists public.club_socio_mayor_edad_registrar(uuid, boolean, text);

-- el trigger de edad vuelve a la versión EXACTA de la 159 (solo el alta)
create or replace function public.club_roles_mayor_edad_chk()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare r public.club_miembro_roles%rowtype;
begin
  if new.rol <> 'socio' then return null; end if;
  -- solo un alta (fila nueva o re-alta, que mueve `desde`) o un intento de borrar la confirmación
  if tg_op = 'UPDATE' and old.desde is not distinct from new.desde and old.mayor_edad_en is not distinct from new.mayor_edad_en then
    return null;
  end if;
  -- diferido: se mira la fila como queda al final de la transacción (club_socio_crear la inserta y después la completa)
  select * into r from public.club_miembro_roles where miembro_id = new.miembro_id and rol = 'socio';
  if not found then return null; end if;
  if r.estado <> 'baja' and r.alta_por in ('caja', 'autoalta') and r.mayor_edad_en is null then
    raise exception 'Falta confirmar que es mayor de 18 años: el Local Club es solo para mayores de edad' using errcode = 'P0001';
  end if;
  return null;
end;
$$;
revoke all on function public.club_roles_mayor_edad_chk() from public, anon, authenticated;

commit;
