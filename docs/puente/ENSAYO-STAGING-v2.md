# Ensayo de punta a punta del puente v2 en STAGING · 08-nov-2026 (noche, hora de Costa Rica)

> OK del dueño al ensayo en **staging** (no prod), 08-nov. **v2 queda aplicada en staging** para que se parezca al prod
> que viene. Vuelta atrás: §4. Nada de esto tocó prod.

## 1. Estado anterior (guardado ANTES de tocar)
| Qué | Antes |
|---|---|
| Edge `ingest-ndf` | **versión 12**, `verify_jwt = false`, desplegada 2026-11-07 14:41:14 UTC, `ezbr_sha256` `d4a3c4c62331932f0a17c87633572cff242bf6fe5d885e4b2056b515ed7dc6fe`. El bundle (ESZIP, sha256 `71058dd19f46cbc5…`) es el Edge de **`4d3513a6…`**: sus comentarios coinciden con el `index.ts` de ese commit salvo uno de 81; usa `fusionarCursor` y no la RPC |
| Función `pos_ndf_ingestar` | la 082 original (md5 de `prosrc` `1fbcb164501690092d31444c8a3c7d03`) |
| Fila 082 del ledger | md5 `5db915c8a422519ce77050f1fb1b916a` (la 082 de `e4678b3`) |
| `pos_ndf_cursor` | sin `max_factura_vista`; santa-teresa en `112508`, sin error |

Las copias (metadata y bundle del Edge, definición de la función, fila del ledger, columnas y fila del cursor) quedaron
fuera del repo, en el scratchpad de la sesión; la vuelta atrás no las necesita: sale de `e4678b3` y `4d3513a6…` (§4).

## 2. Qué se hizo
1. **082 v2 + su fila del ledger en UNA transacción** (20:16 -06:00): precondición (la fila 082 tenía que estar en
   `5db915c8…`), la 082 del archivo, `update` de la fila con el archivo entero (conteo = 1) y control de que el ledger
   quedara en **`292dd3aa8f7dfed676d10103870f5d21`**. Resultado: ledger `292dd3aa…`, columna `max_factura_vista`
   creada, función v2.
2. **Edge desde `705b830f1759e39112b761bf7d77f15d6cc70368`** (worktree limpio en ese SHA; CLI 2.122.0,
   `--no-verify-jwt --use-api`): **versión 15**, `verify_jwt = false`, **`<HORA_DEPLOY>` = 2026-11-08 20:16:44-06:00**.

## 3. Resultados (lo que se vio de verdad)
- **Portón:** `POST` sin secreto → **401** del Edge.
- **El agente de staging real** (el que corre contra staging) entró con el Edge nuevo **en el primer ciclo**:
  latido 20:17:38 y siguientes, `last_error` null, **18 facturas** ingresadas (en curso y anuladas), `max_factura_vista`
  = `112508` (la mayor cerrada), `last_factura` = `112508`. Que entrara sin 401 confirma que el secreto de staging
  cumple el mínimo de 32.
- **Consulta C** del paquete (6.2): todo en **0**. Las facturas en curso (`112509`…`112520`) están **por encima** del
  corte, así que no lo retienen; tal como se espera.
- **Duplicados** (5.4): 0 filas.
- **Huella de los secretos (pendiente del paquete §3.2): VERIFICADA en staging con el CLI 2.122.0.**
  - Con un secreto de prueba temporal, cargado con `supabase secrets set --env-file` desde un archivo
    `NOMBRE='<JSON>'`: la huella que muestra el CLI (columna `DIGEST` de la tabla; `value` con `-o json`) es
    **exactamente el sha256 del JSON**, sin las comillas.
  - El secreto de prueba se borró enseguida (`secrets unset`; la lista volvió a no tenerlo).
  - El paquete lee la lista con `-o json`, así no depende del formato de la tabla.
- **Pendiente de ver en staging real:** el paso de una factura de **R a C** con el Edge v2. En este PoS las facturas
  quedan en curso hasta que el cajero cierra el lote, y a la hora del ensayo no había cerrado ninguna. Lo controla la
  sesión de las 04:30, con la consulta C y el cuadre, después del cierre de caja. El camino R → C ya está probado contra
  la RPC v2 real con el agente `4d3513a6…` real en el emulador (`scripts/puente-compat/correr.sh`, 7/7).

## 4. Cómo volver atrás (staging)
`bash scripts/puente/staging_volver_atras.sh` (con `--seco`, la parte SQL termina en ROLLBACK y no despliega; probado
en seco el 08-nov, dos veces, con y sin `SACAR_COLUMNA=1`):
1. **primero** el Edge desde `4d3513a6df8e838dd5c0442b05a580e06ce9db9d` (el que había; el mismo plan que el rollback
   de prod): con el Edge v2 y sin la función v2 no entraría ninguna venta;
2. **después**, en UNA transacción con precondición (la fila 082 tiene que estar en la v2) y conteo de filas, la 082
   **original** (de `e4678b3`, md5 `5db915c8…`) y su fila del ledger; la columna `max_factura_vista` solo con
   `SACAR_COLUMNA=1` (puede quedar: el Edge viejo no la mira).
