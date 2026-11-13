-- PROPUESTA (09-nov, Grok 75) · reintentos de la sincronización del pase. NO está en la 075 ni aplicado en ningún lado:
-- la sesión de esta noche tenía prohibido tocar la 075. Cuando el dueño lo apruebe, va al final de la 075 (bloque del
-- contrato del pase). Hasta entonces, `sincronizar` no encuentra estas funciones y cae al modo conservador (el cursor
-- frena antes del primer evento de un miembro con error: nada se pierde, pero ese miembro sí traba el cursor).
-- Prueba: `bash scripts/sql/club_pase_reintentos_prueba.sh` (staging, en una transacción que se descarta).
--
-- Qué guarda: el miembro, la plataforma, el primer evento que no se pudo aplicar, cuántos intentos y un mensaje CORTO
-- (`PATCH HTTP 500`, `datos`, `contrato`, `excepción`…). Nunca teléfonos ni datos del pase. Solo service_role.
create table if not exists public.club_pase_reintentos (
  miembro_id        uuid   not null,
  plataforma        text   not null check (plataforma in ('google','apple')),
  evento_id         bigint,
  intentos          int    not null default 1 check (intentos >= 1),
  ultimo_error      text   not null check (length(ultimo_error) between 1 and 120 and ultimo_error !~ '[0-9]{8}'),
  primer_error_en   timestamptz not null default now(),
  ultimo_intento_en timestamptz not null default now(),
  primary key (miembro_id, plataforma)
);
alter table public.club_pase_reintentos enable row level security;
revoke all on public.club_pase_reintentos from public, anon, authenticated;

-- anotar un intento fallido: suma uno; el evento que queda es el más viejo
create or replace function public.club_pase_reintento_anotar(p_miembro uuid, p_plataforma text, p_evento bigint, p_error text)
returns int
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  insert into public.club_pase_reintentos (miembro_id, plataforma, evento_id, ultimo_error)
  values (p_miembro, p_plataforma, p_evento, left(coalesce(nullif(btrim(p_error), ''), 'error'), 120))
  on conflict (miembro_id, plataforma) do update set
    intentos = public.club_pase_reintentos.intentos + 1,
    evento_id = least(public.club_pase_reintentos.evento_id, excluded.evento_id),
    ultimo_error = excluded.ultimo_error, ultimo_intento_en = now()
  returning intentos
$$;

-- los que todavía se reintentan solos (bajo el tope), los más viejos primero
create or replace function public.club_pase_reintentos_leer(p_plataforma text, p_tope int default 10, p_limite int default 200)
returns table (miembro_id uuid, intentos int, evento_id bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.miembro_id, r.intentos, r.evento_id from public.club_pase_reintentos r
   where r.plataforma = p_plataforma and r.intentos < greatest(coalesce(p_tope, 10), 1)
   order by r.ultimo_intento_en, r.miembro_id
   limit least(greatest(coalesce(p_limite, 200), 1), 1000)
$$;

-- salió bien: se borra la anotación
create or replace function public.club_pase_reintento_resuelto(p_miembro uuid, p_plataforma text)
returns boolean
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  with b as (delete from public.club_pase_reintentos where miembro_id = p_miembro and plataforma = p_plataforma returning 1)
  select exists (select 1 from b)
$$;

revoke all on function public.club_pase_reintento_anotar(uuid, text, bigint, text) from public, anon, authenticated;
revoke all on function public.club_pase_reintentos_leer(text, int, int)           from public, anon, authenticated;
revoke all on function public.club_pase_reintento_resuelto(uuid, text)             from public, anon, authenticated;
grant execute on function public.club_pase_reintento_anotar(uuid, text, bigint, text) to service_role;
grant execute on function public.club_pase_reintentos_leer(text, int, int)           to service_role;
grant execute on function public.club_pase_reintento_resuelto(uuid, text)             to service_role;
