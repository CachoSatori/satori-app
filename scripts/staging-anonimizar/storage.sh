#!/usr/bin/env bash
# Storage de STAGING (SPEC-anonimizar-staging §4, D3 opción A): borra TODO lo que no sea `documents/sops/` y sube una
# imagen ficticia única (`anon/ficticia.png`) a los buckets a los que apuntan documents.image_path y
# cash_movements.attachments (anonimizar.sql ya los apuntó ahí). Desde SQL no se borran objetos: va por la API de
# Storage con la llave de servicio de staging (lib.sh de los usuarios de prueba). SOLO staging: ref fijo en lib.sh.
#   SUPABASE_ACCESS_TOKEN=... bash scripts/staging-anonimizar/storage.sh          # ENSAYO: solo cuenta, no toca nada
#   SUPABASE_ACCESS_TOKEN=... bash scripts/staging-anonimizar/storage.sh --si     # sube la imagen y borra (no se deshace)
# El borrado no se deshace ni hace falta: prod no se toca (SPEC §5). Nunca imprime nombres de objetos, claves ni URLs
# firmadas: solo conteos por bucket. Correr DESPUÉS de `correr.py real --si` y ANTES de `correr.py verificar`.
source "$(dirname "$0")/../staging-usuarios-prueba/lib.sh"

FICTICIA="anon/ficticia.png"
BUCKETS_FICTICIA="documents facturas"
FILTRO="not (bucket_id = 'documents' and name like 'sops/%') and name <> '$FICTICIA'"

# Guarda (la misma idea que comun.sql): base marcada como staging y con los usuarios de prueba. En prod no existen.
GUARDA=$(sql "select (exists (select 1 from public.club_entorno where nombre = 'staging')
                and (select count(*) from auth.users where email ~ '^prueba-[a-z]+@staging-satori\\.test\$') >= 5) as ok" | jq -r '.[0].ok // false')
[ "$GUARDA" = true ] || { echo '{"ok":false,"etapa":"guarda: la base no es staging o faltan los usuarios de prueba"}'; exit 2; }

contar() { sql "select bucket_id, count(*) as objetos from storage.objects where $FILTRO group by bucket_id order by bucket_id" | jq -c '.'; }

echo "Antes (objetos a borrar por bucket): $(contar)"
if [ "${1:-}" != "--si" ]; then
  echo "ENSAYO: no se tocó nada. Con --si sube la imagen ficticia y borra (necesita el OK del dueño)."
  exit 0
fi

cargar_claves
# 64×64 gris claro, sin texto ni metadatos.
base64 -d > "$T/ficticia.png" <<'PNG'
iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAUElEQVR42u3PMQ0AAAgDsPnXyMmBDCRwkzSpgWa6XouAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAwGUBB4OCd3qx0ZAAAAAASUVORK5CYII=
PNG
for B in $BUCKETS_FICTICIA; do
  COD=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$URL/storage/v1/object/$B/$FICTICIA" -H @"$H_SRV" \
          -H 'Content-Type: image/png' -H 'x-upsert: true' --data-binary @"$T/ficticia.png")
  echo "{\"bucket\":\"$B\",\"imagen_ficticia\":$COD}"
  case "$COD" in 200|201) ;; *) echo '{"ok":false,"etapa":"subir la imagen ficticia"}'; exit 2;; esac
done

# Borrado por tandas de 100 (la API de Storage borra por lista de rutas). Los nombres quedan en archivos 0600 dentro del
# mktemp de lib.sh (se borran al salir); no se imprimen.
for VUELTA in $(seq 1 500); do
  sql "select bucket_id, name from storage.objects where $FILTRO order by bucket_id, name limit 100" > "$T/tanda.json"
  N=$(jq 'length' "$T/tanda.json")
  [ "$N" -gt 0 ] || break
  for B in $(jq -r '[.[].bucket_id] | unique | .[]' "$T/tanda.json"); do
    jq -c --arg b "$B" '{prefixes: [.[] | select(.bucket_id == $b) | .name]}' "$T/tanda.json" > "$T/borrar.json"
    COD=$(curl -sS -o /dev/null -w '%{http_code}' -X DELETE "$URL/storage/v1/object/$B" -H @"$H_SRV" \
            -H 'Content-Type: application/json' --data-binary @"$T/borrar.json")
    case "$COD" in 200) ;; *) rm -f -- "$T/tanda.json" "$T/borrar.json"; echo "{\"ok\":false,\"etapa\":\"borrar\",\"bucket\":\"$B\",\"http\":$COD}"; exit 2;; esac
  done
  rm -f -- "$T/tanda.json" "$T/borrar.json"
done

echo "Después (debe ser []): $(contar)"
QUEDAN=$(sql "select count(*) as n from storage.objects where $FILTRO" | jq -r '.[0].n')
[ "$QUEDAN" = 0 ] || { echo "{\"ok\":false,\"quedan\":$QUEDAN}"; exit 2; }
echo '{"ok":true}'
