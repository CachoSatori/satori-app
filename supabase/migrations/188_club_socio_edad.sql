-- 188 (bloque de pase) · «¿Pide la casilla de mayor de 18?»: la app lee el rol de socio por una función de la base con
-- control de local, en vez de leer la tabla directo.
--
-- Backlog del Club firmado por el dueño (16-nov), arreglo 2 de 4 (lo marcó el verificador de la 176): getEdadSocio
-- (Miembros y Escanear) leía club_miembro_roles por la API. Con la RLS de la 176, a un manager con una ficha de otro
-- local la lectura le devolvía «no es socio» (null) en silencio, y la pantalla escondía la casilla «Es mayor de 18
-- años» (estado equivocado, sin aviso). Ahora:
--   club_socio_edad(miembro) (NUEVA, SECURITY DEFINER): los mismos roles que hoy leen la tabla (owner, manager, cajero,
--   contador; el resto 42501 «Sin permiso»). Manager: club_exigir_local_de(local del miembro) → 42501 «Ficha de otro
--   local» (como la 172/176). Cajero sin filtro de local (decisión de la 176: el socio vale en todos los locales).
--   Devuelve {estado, baja_por, alta_por, validado_en, mayor_edad_en} del rol de socio, o null si no es socio (o la
--   persona no existe). La app, ante un error, muestra la casilla (preguntar de más no rompe nada).
-- No reemplaza ninguna función (R13 no aplica) ni toca la RLS: la lectura directa sigue como está.
--
-- Vuelta atrás: scripts/sql/188_rollback.sql. Pruebas: scripts/sql/188_pruebas.sql (+ .py).
begin;

do $$
begin
  if to_regprocedure('public.club_exigir_local_de(text)') is null or to_regclass('public.club_miembro_roles') is null then
    raise exception '188: falta la 172/176 (club_exigir_local_de) o club_miembro_roles';
  end if;
  if to_regprocedure('public.club_socio_edad(uuid)') is not null then
    raise exception '188: ya existe club_socio_edad: se para sin tocar nada';
  end if;
end $$;

create function public.club_socio_edad(p_miembro uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if public.get_my_role() is null or public.get_my_role() not in ('owner','manager','cajero','contador') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  perform public.club_exigir_local_de((select m.location_id from public.club_miembros m where m.id = p_miembro));
  return (select jsonb_build_object('estado', r.estado, 'baja_por', r.baja_por, 'alta_por', r.alta_por,
                                    'validado_en', r.validado_en, 'mayor_edad_en', r.mayor_edad_en)
            from public.club_miembro_roles r
           where r.miembro_id = p_miembro and r.rol = 'socio');
end;
$$;
revoke all on function public.club_socio_edad(uuid) from public, anon, authenticated;
grant execute on function public.club_socio_edad(uuid) to authenticated;
comment on function public.club_socio_edad(uuid) is
  '188: rol de socio de una persona (estado, baja_por, alta_por, validado_en, mayor_edad_en) o null. Manager: solo fichas de sus locales («Ficha de otro local»).';

do $$
begin
  if has_function_privilege('anon', 'public.club_socio_edad(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.club_socio_edad(uuid)', 'execute') then
    raise exception '188: los permisos no quedaron como se esperaba';
  end if;
end $$;

commit;
