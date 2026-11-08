# Puente · locales genéricos (LC-ML, 08-nov) — NO entra en el pase del lunes 09-nov

> El pase del lunes despliega `claude/puente-item11-prod` @ `e4678b3` (SHA fijo). Esta rama sale de ahí y se despliega
> **después**, con su propia firma.

## Qué cambia
- **Edge `ingest-ndf` / `src/shared/ndf/ingestNdf.ts`:** ya no hay lista fija de locales. Un local es un id
  `^[a-z0-9-]{2,40}$` y **los que pueden escribir son las claves de `POS_INGEST_SECRETS`** (cada uno con su secreto de
  32+ caracteres, sin repetir). Abrir un local nuevo = sumar `"<id>": "<secreto>"` al mapa. El sobre sigue teniendo que
  ser del local de su secreto.
- **Secreto único de antes (`POS_INGEST_SECRET`):** ya no se supone un local; vale solo para el de
  `POS_INGEST_LOCAL_LEGADO`. Sin esa variable, no autoriza a nadie.
- **Agente (`pos-bridge/configAgente.ts`):** `LOCAL` se valida por formato (el mismo id de `club_config` y del mapa), no
  contra una lista.

## Antes de desplegarla
- `POS_INGEST_SECRETS` cargado con todos los locales que tienen agente (en el pase del lunes ya queda con
  santa-teresa y nosara), **o** `POS_INGEST_LOCAL_LEGADO=<id>` si todavía se usa el secreto único.
- Mismo deploy y mismo rollback que el paquete del lunes (`docs/puente/PASE-PROD-2026-11-09.md` §5, §6 y §9).

## Pruebas
vitest `src/shared/ndf` + `pos-bridge`: 471/471 (nuevas: un local nuevo entra con su clave en el mapa; un id inválido
no; el secreto único sin `POS_INGEST_LOCAL_LEGADO` no autoriza; el agente acepta un local nuevo por formato).

## Queda fuera del puente (lista, sin cambios)
`supabase/functions/ingest-punches/index.ts:41` (BioTime) tiene la misma lista fija de locales; ver
`docs/MULTILOCAL-relevamiento.md`.
