-- Neutraliza en STAGING todo usuario que NO sea de prueba (copias de prod y cuentas viejas), SIN borrar filas:
-- contraseña nueva al azar que nadie conoce (se genera y se hashea DENTRO de la base; no sale en ningún log ni
-- respuesta), ban por 100 años y cierre de todas sus sesiones. Los perfiles, empleados, cajas, movimientos y
-- bitácora quedan intactos (hay FKs sin cascade hacia profiles: borrarlos rompería datos de staging).
-- NO toca public.profiles (no dispara la bitácora 165; ESTADO regla 12, paso 1 «ban o cambio de clave»).
--
-- SOLO STAGING. Ritual (ESTADO regla 7): confirmar el ref hwiatgicyyqyezqwldia ANTES de correr.
-- Guarda adicional: aborta si no existen los usuarios de prueba (en prod no existen nunca) y si no queda al menos
-- un owner de prueba activo para seguir entrando a staging.
-- NO EJECUTAR sin el OK del dueño.
begin;

do $$
begin
  if (select count(*) from auth.users where email like '%@staging-satori.test') < 5 then
    raise exception 'ABORT: no están los usuarios de prueba (¿es staging? ¿se corrió crear.sh?)';
  end if;
  if not exists (select 1 from public.profiles p join auth.users u on u.id = p.id
                  where u.email like '%@staging-satori.test' and p.role = 'owner' and p.is_active) then
    raise exception 'ABORT: falta el owner de prueba activo';
  end if;
end $$;

create temp table _neutralizar on commit drop as
  select id from auth.users where email not like '%@staging-satori.test';

update auth.users
   set encrypted_password = extensions.crypt(encode(extensions.gen_random_bytes(32), 'base64'), extensions.gen_salt('bf')),
       banned_until       = now() + interval '100 years',
       recovery_token     = '',
       updated_at         = now()
 where id in (select id from _neutralizar);

delete from auth.refresh_tokens where user_id in (select id::text from _neutralizar);
delete from auth.sessions       where user_id in (select id from _neutralizar);

-- Comprobación (solo conteos): todos los no-prueba baneados y sin sesiones.
select (select count(*) from _neutralizar)                                                       as neutralizados,
       (select count(*) from auth.users u join _neutralizar n using (id) where u.banned_until > now()) as baneados,
       (select count(*) from auth.sessions s join _neutralizar n on n.id = s.user_id)            as sesiones_vivas;

commit;
