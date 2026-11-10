#!/usr/bin/env bash
# Prueba de la comparación de 4b del PASE-085 (Grok 131), SOLO en STAGING. Corre el bloque 4b TAL CUAL está en el PASE
# (begin read only … rollback) y después la consulta de comparación con 7 casos armados a partir de ese resultado. La
# comparación no lee ninguna tabla. Salida 0 = los 7 casos dan lo esperado.
# Uso: bash scripts/sql/085_comparacion_4b_pruebas.sh   (token de la Management API: el proxy o SUPABASE_ACCESS_TOKEN)
set -euo pipefail
REF=hwiatgicyyqyezqwldia   # SOLO staging
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"; DOC="$RAIZ/docs/pases/PASE-085-rls-lectura-rol-activo.md"
q() { jq -n --arg q "$1" '{query:$q}' | curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
        -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN:-x}" -H "Content-Type: application/json" --data-binary @-; }
B4=$(awk '/^\*\*4b \(Grok 129\)/{f=1} f&&/^```sql/{g=1;next} g&&/^```/{exit} g' "$DOC")
COMP=$(awk '/^-- 4b · comparación/{g=1} g&&/^```/{exit} g' "$DOC")
[[ "$B4" == "begin read only;"* ]] || { echo "el bloque 4b no empieza con «begin read only;»"; exit 2; }
H=$(q "$B4" | jq -c '.[-1].humo'); [[ "$H" == "{"* ]] || { echo "4b no devolvió humo: $H"; exit 2; }
fallas=0
caso() {   # $1 nombre · $2 filtro jq que arma el «después» · $3 paradas esperadas (rol.tabla separados por coma, o vacío)
  local D r
  D=$(jq -c "$2" <<<"$H")
  r=$(q "$(sed -e "s|<ANTES>|$H|" -e "s|<DESPUES>|$D|" <<<"$COMP")" | jq -r '[.[] | select(.veredicto|startswith("PARADA")) | "\(.rol).\(.tabla)"] | sort | join(",")')
  if [ "$r" = "$3" ]; then echo "OK     $1"; else echo "FALLA  $1 · esperado [$3] · dio [$r]"; fallas=$((fallas+1)); fi
}
caso 'igual antes y después'                              '.'                                                                   ''
caso 'base +2 y los que ven todo +2'                      '.base.tip_entries+=2|.owner.tip_entries+=2|.cajero.tip_entries+=2|.salonero.tip_entries+=2' ''
caso '131: base +2 y owner (ve todo) +0'                  '.base.tip_entries+=2|.cajero.tip_entries+=2|.salonero.tip_entries+=2' 'owner.tip_entries'
caso 'base +1; cajero ve una parte y no cambia'           '.base.employees+=1|.owner.employees+=1|.salonero.employees+=1'      ''
caso 'cajero +1 sin cambio en base'                       '.cajero.profiles+=1'                                                 'cajero.profiles'
caso 'cajero +2 con base +1'                              '.base.employees+=1|.owner.employees+=1|.cajero.employees+=2'        'cajero.employees'
caso 'salonero pierde la cuenta'                          '.salonero.hay_cuenta=false' \
     'salonero.employees,salonero.exchange_rates,salonero.profiles,salonero.role_tip_points,salonero.tip_entries,salonero.tip_sessions'
echo "── $((7 - fallas))/7 OK"; [ "$fallas" -eq 0 ]
