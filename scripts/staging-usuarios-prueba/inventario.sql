-- Inventario de usuarios de STAGING (hwiatgicyyqyezqwldia). SOLO LECTURA. Devuelve solo conteos y roles:
-- ningún correo, nombre, id, hash ni token. Correr antes y después de cada paso del plan.
select coalesce(p.role::text, '(sin perfil)')                                         as rol,
       count(*)                                                                       as usuarios,
       count(*) filter (where p.is_active)                                            as activos,
       count(*) filter (where u.email like '%@staging-satori.test')                   as de_prueba,
       count(*) filter (where u.banned_until > now())                                 as baneados,
       count(*) filter (where coalesce(u.encrypted_password, '') = '')                as sin_password,
       max(u.last_sign_in_at)                                                         as ultimo_login
from auth.users u
left join public.profiles p on p.id = u.id
group by 1
order by 1;
