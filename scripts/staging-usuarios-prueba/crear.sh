#!/usr/bin/env bash
# Crea (o completa) 1 usuario de prueba por rol en STAGING. Idempotente: si el usuario ya existe, solo reafirma rol,
# activación y empleado. NO toca ningún usuario que no sea del dominio de prueba.
#   SUPABASE_ACCESS_TOKEN=... bash scripts/staging-usuarios-prueba/crear.sh
# Sin contraseña: los usuarios se crean SIN password (no hay secreto que guardar). Se entra con una sesión de un solo
# uso que arma sesion.sh (magic link generado por la API de admin; no manda correo). Ver
# docs/seguridad/PLAN-usuarios-prueba-staging.md.
# NO EJECUTAR sin el OK del dueño (plan en revisión).
source "$(dirname "$0")/lib.sh"
cargar_claves

for ROL in $ROLES_PRUEBA; do
  CORREO=$(correo_de "$ROL")
  ID=$(sql "select id from auth.users where lower(email) = lower('$CORREO')" | jq -r '.[0].id // empty')
  if [ -z "$ID" ]; then
    jq -nc --arg e "$CORREO" --arg n "Prueba ${ROL^}" \
      '{email: $e, email_confirm: true, user_metadata: {full_name: $n}, app_metadata: {usuario_prueba: true}}' > "$T/alta.json"
    ID=$(curl -sS -X POST "$URL/auth/v1/admin/users" -H @"$H_SRV" -H 'Content-Type: application/json' \
           --data-binary @"$T/alta.json" | jq -r '.id // empty')
    rm -f -- "$T/alta.json"
    [ -n "$ID" ] || { echo "{\"rol\":\"$ROL\",\"ok\":false,\"etapa\":\"createUser\"}"; exit 2; }
  fi
  # handle_new_user (068) lo creó salonero + inactivo. Rol y activación SIN JWT (Management API): la guarda SEC-01
  # deja pasar y la bitácora 165 lo anota con origen 'sistema'. Si la bitácora está caída, esto FALLA (regla 12): parar.
  sql "update public.profiles set role = '$ROL', is_active = true, full_name = 'Prueba ${ROL^}'
        where id = '$ID' and (role is distinct from '$ROL' or not is_active or full_name is distinct from 'Prueba ${ROL^}')" >/dev/null
  if [[ " $ROLES_CON_EMPLEADO " == *" $ROL "* ]]; then
    # participa_servicio = false: el empleado de prueba NO entra al reparto de propinas de staging.
    sql "insert into public.employees (full_name, role, profile_id, is_active, participa_servicio)
         select 'Prueba ${ROL^}', '$ROL', '$ID', true, false
         where not exists (select 1 from public.employees where profile_id = '$ID')" >/dev/null
  fi
  ESTADO=$(sql "select p.role::text r, p.is_active a, (u.encrypted_password is null or u.encrypted_password = '') sin_pw,
                       exists(select 1 from public.employees e where e.profile_id = p.id) emp
                from public.profiles p join auth.users u on u.id = p.id where p.id = '$ID'")
  jq -c --arg rol "$ROL" '.[0] | {rol: $rol, rol_ok: (.r == $rol), activo: .a, sin_password: .sin_pw, empleado: .emp}' <<<"$ESTADO"
done
unset CORREO ID
