# Resultado del pase del puente a PROD · 09-nov-2026

> El pase lo **ejecutó el dueño en la PC del PoS** el 09-nov-2026 y **salió bien**. Horas en **-06:00** (Costa Rica).
>
> **Paquete usado:** `docs/puente/PASE-PROD-2026-11-09.md` de la rama `claude/puente-item11-prod-v2` @ `cd6d5a1`.
> **Código del pase:** `5da233a516d1a6c4c2c95eb165be448be5416697`.
>
> **Claude no corrió nada en prod:** ni consultas, ni deploys, ni secretos. Los datos de este documento son los que
> reportó el dueño. El merge del #71 sí lo hizo Claude, con la autorización del dueño (§5).

## 1. Qué quedó en prod
| Qué | Resultado |
|---|---|
| **Mig 081** (`pos_ndf_campos_factura`) | Aplicada a las **10:57**. Ledger md5 `d4acf8dafc964ed23072aa49098f5b42` (= el `.sql` del #71). **7 columnas** nuevas. |
| **Secretos (3.2)** | OK. El agente manda `pos-bridge\.env`, con un secreto de **largo 64**. La huella del panel es igual a la huella del mapa. `POS_INGEST_SECRET` (el viejo) **sigue cargado**: es el punto de vuelta del Edge anterior. |
| **Agente detenido** | **11:23 → 12:03:42**, ~40 min. **Desvío:** el paquete pedía 15 min o menos (§3, desvío 6). **Causa principal** (hallazgo del dueño, 09-nov noche): la espera de 4.1 filtraba `node.exe` por la palabra `agente` y agarraba también el agente de STAGING. |
| **Mig 082 v3** (`pos_ndf_ingesta_transaccional`) | Aplicada **~12:00**. Ledger md5 `edb7ffc58976804e55968f75df530a05` (= el `.sql` del #71). Columna `pos_ndf_cursor.max_factura_vista`. `md5(prosrc)` de `pos_ndf_ingestar` = `dab8ffdf8d2f82dacf874af22eb6f55d` (= staging). `execute` solo para `service_role`. Prueba en vacío OK. |
| **Edge `ingest-ndf`** | Desplegado desde `5da233a` a las **12:03:30**, con `--no-verify-jwt --use-api` (Supabase CLI **2.122.0**). Quedó en la **versión 3, no 2**: a las 10:57 estaba en la v1 (§4). El `index.ts` bajado de prod es **igual línea por línea** al de `5da233a`; solo cambian los finales de línea (CRLF/LF). |
| **Portón** | **401 del Edge** (el cuerpo es del Edge, no de la plataforma: el JWT quedó apagado). |
| **Agente** | Sigue en **`4d3513a`** (su código no se tocó). Arrancó a las **12:03:42** y saludó con el cursor **112536**: `max_factura_vista = 112536`. |

## 2. Primera hora y primera factura
- **5 controles**, de 12:11 a 13:07. En todos:
  - el latido estuvo por debajo de 1 min, sin error;
  - el corte dio bien (`corte_ok`);
  - **0** líneas duplicadas y **0** `R` por debajo del corte.
- **Primera factura cobrada después del deploy (112538):**
  - entró **una sola vez**, con **9 líneas**;
  - las líneas suman **49292.03** y el total es **60629**, **igual al del tiquete**.
  - **Sigue en `R`:** en este PoS una factura pasa a `C` recién en el **cierre de caja** (16:00 y ~23:00). **El dueño
    controla el paso R → C después del cierre de las 16:00.** Ese control queda **pendiente** en este documento.
- `consecutivo_fe`, `clave_fe` y `mesa_factura` llegan en **null**. **Es lo esperado:** el agente de prod sigue en
  `4d3513a`, que no manda esos campos. Los va a mandar el agente nuevo.

## 3. Desvíos y fallas del paquete
Los vio el pase real. **El ensayo en seco no los vio** porque simulaba `node`, `npm`, `supabase` y la tarea programada
con dobles que no se parecían lo suficiente a la PC real.

| # | Paso | Qué pasó | Qué se hizo el día del pase | Corrección para el próximo pase (§6) |
|---|---|---|---|---|
| 1 | **1.7** | `supabase functions download ingest-ndf --use-api` se niega a extraer `src/shared/...` («refusing to extract outside supabase/functions»). Bajó **solo el `index.ts`**, y su md5 dio igual al de `4d3513a`. | Se siguió con la copia parcial (**OK del dueño**). | La copia de 1.7 se declara **parcial a propósito**: se compara el `index.ts`, y el aviso de `src/shared` es esperado. El punto de vuelta completo es el worktree de `4d3513a` (0.4), no la descarga. |
| 2 | **1.9** | La acción de la tarea es `C:\satori\pos-agente-prod.cmd`, que hace `cd /d C:\satori\satori-app-prod` y llama a `node`. El control busca «satori-app-prod» **en la acción** y corta. La cuenta de la tarea es **SYSTEM**, con el entorno limpio. | Se verificó el `.cmd` **a mano**. | Si la acción es un `.cmd` o un `.bat`, el control **lo lee**. Exige el `cd /d` a la carpeta del agente y que ninguna línea defina `INGEST_…` ni `POS_…`. |
| 3 | **1.9 / 3.2** | El clon está en `5da233a`, y ahí `armar_mapa_secretos.mjs` **no tiene `--solo-medir`**. | Se usó el script de `cd6d5a1` (md5 `73c4d9d207c22c13d5c42498bb63e8ca`), extraído con `git show` a `C:\satori\pase-scripts`. Antes se verificó que entre `5da233a` y `cd6d5a1` no cambia nada en `supabase/` ni en `src/`. | **Los scripts del pase salen del commit del PAQUETE** (no del código), con `git show` y md5 sobre los bytes, a `C:\satori\pase-scripts`. Bloque 0.5b. |
| 4 | **1.10** | `npm` está **bloqueado** por la política de ejecución de PowerShell (`npm.ps1`). | Se usó `npm.cmd`. | El paquete usa **`npm.cmd`**. |
| 5 | **0.6** | La PC **no tenía Supabase CLI**. | Se instaló la **2.122.0** en `C:\satori\supabase-cli`. sha256 del `.tar.gz` = `f891d9bb641f7fa28fd9c61ea0f31be4964254bc84be9ff66f2376b6aaa7a9ed`. | Prerrequisito **0.6** nuevo: el CLI instalado **antes** del día, en esa carpeta, con esa versión y ese sha256 (o uno nuevo, verificado y anotado). |
| 6 | **§4 / 4.1** | El agente estuvo detenido **~40 min** (11:23 → 12:03:42); el paquete pedía 15 min o menos. **Causa principal** (hallazgo del dueño, 09-nov noche): la espera de 4.1 filtraba `node.exe` por la palabra `agente`, y eso agarra también el agente de **STAGING**, que corre en la misma PC con la misma línea de comando. La espera no terminaba y el «cerrar node a mano» **probablemente cerró el de staging** (~11:58: el agente de staging quedó detenido desde las 11:58:10, cursor 112536). | Se cerró `node` a mano y se siguió. | **El proceso de prod se identifica por su carpeta** (`C:\satori\satori-app-prod`, o la carpeta nueva del pase), nunca por la palabra `agente`: la nombra su línea de comando o la de su `.cmd` padre. Sus PID se anotan antes de detener la tarea y la espera mira solo esos. **Ningún bloque cierra procesos**; si hace falta, solo por PID. El kit simula los dos agentes corriendo (#79 y #83). Además, todo lo que se pueda preparar va **antes** de 4.1 (el CLI, los scripts, `--use-api` y la sesión del panel); si igual pasa de 15 min, se anota el motivo en §10 (no es parada). |
| — | **4.4 y §8.2** | El deploy necesitó **`--use-api`**: no hay Docker en la PC. **El rollback de §8.2 no lo tenía.** | El deploy de 4.4 se hizo con `--use-api`. | **`--use-api` en 4.4 y en §8.2.** |
| — | **4.4** | El paquete esperaba la **v2** («una más que 1.6») y quedó la **v3**. | Se siguió: el código desplegado es el de `5da233a` (comparado línea por línea). | El paquete ya no exige «una más». Exige que la versión sea **mayor** que la de 1.6, anota las dos, y compara el código desplegado contra el del SHA del pase. |

## 4. ¿Qué creó la versión 2 del Edge?
**Sin respuesta segura. No se averiguó en prod, por la regla de este pase.** Lo que dice la documentación de Supabase:
- **`supabase secrets set` no requiere volver a desplegar:** los secretos quedan disponibles enseguida en las funciones
  ([Environment Variables](https://supabase.com/docs/guides/functions/secrets)). La documentación **no dice** que
  `secrets set` cree una versión nueva.
- **Las versiones van atadas a los despliegues del código:** el runtime expone `DENO_DEPLOYMENT_ID` =
  `{project_ref}_{function_id}_{version}`
  ([Inspecting edge function environment variables](https://supabase.com/docs/guides/troubleshooting/inspecting-edge-function-environment-variables-wg5qOQ.md)).
- **El panel y la Management API pueden cambiar la configuración de una función** (por ejemplo `verify_jwt`, con
  `PATCH /v1/projects/{ref}/functions/{slug}`). La documentación no aclara si eso suma una versión.

**Candidatos, de más a menos probable:**
1. **Un intento de deploy anterior al de las 12:03:30**, que subió el código y después falló o se repitió. Por ejemplo,
   un primer intento con `--use-api` que se cortó, o uno sin `--use-api` que llegó a subir.
2. **Un cambio de configuración** desde el panel o la API (el interruptor de JWT, por ejemplo).
3. **`secrets set` (§3.2):** la documentación no lo indica.

**Cómo cerrarlo sin tocar prod:**
- **El dueño, en el panel de prod:** Edge Functions → `ingest-ndf` → historial de versiones o de despliegues. Ahí se ve
  la hora de la v2 y se compara con la bitácora del pase: ¿fue a la hora del `secrets set` (3.2) o cerca de las 12:03?
- **En STAGING**, con permiso para cargar un secreto de prueba:
  1. anotar la versión de `ingest-ndf`;
  2. `supabase secrets set` con un secreto ficticio;
  3. volver a leer la versión;
  4. borrar el secreto.

  Lo mismo con el interruptor de JWT. Esto dice qué suma versiones **sin adivinar**.

## 5. #71 y Branching
- **Merge del #71** el 09-nov a las **13:21 -06:00**, autorizado por el dueño en el mensaje de ese día («antes de las
  17:00»). Merge commit **`295399449d143ee0b2b1472067ace5124448b2c1`**. Antes se verificó:
  - cabeza del PR `0a33df42514250509fef82af313fa576dd90aa39`;
  - `main` en `2a05196f37171a8200f58dea4dbcf5248bf1156d` (sin moverse);
  - el diff contra `main` tiene **solo** la 081 y la 082, con md5 `d4acf8dafc964ed23072aa49098f5b42` y
    `edb7ffc58976804e55968f75df530a05`.
- **Branching sobre `2953994`:** el check «Supabase Preview» terminó en **success** (19:21:44Z), sin error y sin anuncio
  de que fuera a aplicar algo.
  - Quedaron además dos corridas del mismo check en «in_progress» («Waiting for branch action run to complete»). Es el
    **mismo patrón** que el merge anterior (`2a05196`, 08-nov: una corrida en success y tres en curso para siempre).
  - **El texto literal «All migrations are up to date» está en el log de la corrida**, en el panel de Supabase de prod.
    Claude **no lo leyó**, porque leerlo es tocar prod. Lo confirma el dueño en el panel (Branches → la corrida de
    `2953994`).
- Pages (`deploy`) y Cloudflare Pages: **success**.
- **Ledger de prod después del merge del #71** (leído por el dueño, 09-nov; Claude no lee prod):
  - **57 filas**, igual que antes del merge;
  - la **081** con `d4acf8da…` y la **082** con `edb7ffc5…`: los mismos md5 del diff del #71 (arriba).
  - **Branching no reaplicó nada.** Es la prueba que faltaba de que el merge del #71 no tocó prod.

## 6. Correcciones para el próximo pase (agente nuevo / Nosara)
Van en `docs/puente/PASE-PROD-PLANTILLA.md` (el paquete del 09-nov, corregido) y en el kit `scripts/puente/` de esta
rama:
- **Scripts del pase:** salen del **commit del paquete** con `git show` y md5 sobre los bytes (bloque 0.5b). Nunca del
  clon del código.
- **Acción de la tarea:** el control de 1.9 acepta una acción `.cmd` o `.bat`, la **lee** y verifica el `cd /d` y que no
  haya variables `INGEST_`/`POS_`.
- **`npm.cmd`** en vez de `npm`.
- **`--use-api`** en el deploy (4.4) **y** en el rollback (§8.2).
- **Descarga del Edge (1.7):** parcial por diseño. Se compara el `index.ts`, y el aviso «refusing to extract outside
  supabase/functions» es esperado. El punto de vuelta completo es el worktree.
- **Supabase CLI:** prerrequisito con carpeta, versión y sha256.
- **Versión del Edge:** «mayor que la de 1.6», no «una más».
- **Tiempo con la tarea detenida:** todo lo preparable va antes de 4.1.
- **El kit** imita la PC real:
  - la tarea corre un `.cmd`;
  - `npm` (el `.ps1`) está bloqueado;
  - `functions download` rechaza `src/shared`;
  - `functions deploy` sin `--use-api` falla («sin Docker»);
  - los scripts llegan por `git show` del commit del paquete.

  Cada una tiene su caso que **frena** si el paquete vuelve atrás.

## 7. Pendientes después del pase
- [ ] **R → C de la 112538** después del cierre de las 16:00 (lo controla el dueño), y conciliación (6.3) al cierre.
- [x] Branching no reaplicó nada con el #71: el ledger de prod sigue en 57 filas, con la 081 y la 082 iguales (§5, leído
  por el dueño). El texto literal del panel («All migrations are up to date») queda como confirmación opcional.
- [ ] Qué creó la v2 del Edge (§4).
- [ ] Conciliación de los 3 días siguientes (paquete §9).
- [ ] Borrar `POS_INGEST_SECRET` del panel a los **7 días sin rollback** (**16-nov** o después).
- [ ] La 085 espera al puente, con su propio paquete (decisión del dueño, 08-nov).
- [ ] El agente nuevo (Nosara, y los campos `consecutivo_fe`, `clave_fe` y `mesa_factura`) va en un pase aparte, con
  la plantilla corregida.
