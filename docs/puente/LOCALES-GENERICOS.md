# Puente · locales genéricos (LC-ML, 08-nov) — NO entra en el pase del lunes 09-nov

> El pase del lunes despliega `claude/puente-item11-prod` @ `e4678b3` (SHA fijo). Esta rama sale de ahí y se despliega
> **después**, con su propia firma.

## Qué cambia
- **Edge `ingest-ndf` / `src/shared/ndf/ingestNdf.ts`:** ya no hay lista fija de locales. Un local es un id
  `^[a-z0-9-]{2,40}$` y **los que pueden escribir son las claves de `POS_INGEST_SECRETS`** (cada uno con su secreto de
  32+ caracteres, sin repetir). Abrir un local nuevo = sumar `"<id>": "<secreto>"` al mapa. El sobre sigue teniendo que
  ser del local de su secreto.
- **Secreto único de antes (`POS_INGEST_SECRET`):** vale para el local de `POS_INGEST_LOCAL_LEGADO`. **Si la variable
  falta, no corta** (08-nov, pedido de Ismael): vale para el local histórico de ese secreto (`LOCAL_LEGADO_HISTORICO`,
  santa-teresa) y **cada respuesta trae un aviso** («Falta POS_INGEST_LOCAL_LEGADO…») que se ve en el log del Edge y en
  la respuesta al agente. Si la variable está **mal escrita**, el secreto único no autoriza a nadie (y avisa): un error
  de tipeo no puede mandar las ventas a un local inventado.
- **Catálogo de locales (08-nov):** el local que escribe tiene que existir en `locations` (id) o en `club_config`
  (`location_id`). Si no existe → **403 «Local no registrado»** y no se escribe nada (las `pos_ndf_*` no tienen FK sobre
  `local`: sin esto, un error de tipeo en una clave del mapa crearía un local fantasma). Las otras claves del mapa que no
  están en el catálogo dan aviso, sin frenar a los demás. **Sin catálogo** (la base no tiene ninguna de las dos tablas,
  como prod hoy) no se puede validar: pasa, con un aviso por instancia. El catálogo se lee con service_role y se
  guarda 5 minutos.
- **Agente (`pos-bridge/configAgente.ts`):** `LOCAL` se valida por formato (el mismo id de `club_config` y del mapa), no
  contra una lista.

## Antes de desplegarla
- **Rama:** rebasada el 08-nov sobre `claude/puente-item11-prod` @ `384c0ae` (el paquete del lunes con A1–A7).
- `POS_INGEST_SECRETS` cargado con todos los locales que tienen agente (en el pase del lunes ya queda con
  santa-teresa y nosara), **o** `POS_INGEST_LOCAL_LEGADO=<id>` si todavía se usa el secreto único.
- Mismo deploy y mismo rollback que el paquete del lunes (`docs/puente/PASE-PROD-2026-11-09.md` §5, §6 y §9).

## Pruebas
vitest `src/shared/ndf`: 211/211 (08-nov, con las 7 nuevas de legado y catálogo); antes, con `pos-bridge`: 471/471 (nuevas: un local nuevo entra con su clave en el mapa; un id inválido
no; el secreto único sin `POS_INGEST_LOCAL_LEGADO` no autoriza; el agente acepta un local nuevo por formato).

## Queda fuera del puente (lista, sin cambios)
`supabase/functions/ingest-punches/index.ts:41` (BioTime) tiene la misma lista fija de locales; ver
`docs/MULTILOCAL-relevamiento.md`.
