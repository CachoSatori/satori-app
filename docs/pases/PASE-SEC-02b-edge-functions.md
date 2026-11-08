# Paquete de pase a PROD · SEC-02b · Edge Functions versionadas (ítem 11, PR #61)

> **Estado: preparado, SIN ejecutar.** Lo firma Ismael después de la auditoría, con una firma **aparte** de la del
> puente y de la 085. Nada de este documento se corrió en prod: no se leyó ni se tocó la base ni la Management API
> para armarlo. Todo sale del repo.
> PR: **#61** (borrador), rama `claude/item-11-config`, head **`fa8ffd1`**.

## 1. Qué hace
El merge del #61 a `main` hace que **Supabase Branching despliegue Edge Functions en PROD**
(`yiczgdtirrkdvohdquzf`). Hasta hoy las funciones de prod se subieron a mano; con este PR su código y su
`verify_jwt` quedan versionados en `main`.

**Qué trae el PR (sin migraciones):**

| Archivo | Cambio |
|---|---|
| `supabase/config.toml` | **Nuevo.** Solo secciones `[functions.*]` con el `verify_jwt` de cada función. Sin `[auth]`, `[api]` ni `[db]`. |
| `supabase/functions/monthly-report/index.ts` | Pasa del código de antes de SEC-02 (el de `main`) al de la **v10** de prod, con la guarda movida a `acceso.ts`. |
| `supabase/functions/monthly-report/acceso.ts` | **Nuevo.** Guarda pura: service_role u owner activo; valida `month`, `tipo`, `dry_run`; respuesta sin montos ni nombres; CORS con allowlist. |
| `supabase/functions/monthly-report/acceso.test.ts` | **Nuevo.** Pruebas vitest de la guarda. No se despliega (nadie lo importa). |
| `supabase/functions/alta-empleado/index.ts` | **Nuevo en `main`.** Idéntico a `claude/alta-empleado-fn` (la v1 de prod, desplegada a mano el 06/11). |
| `monthly-report/index.ts` y `cierre-email/index.ts` (08/11) | **Sin correo real por defecto.** El destinatario sale solo del secreto `REPORT_TO_EMAIL` (`destinatarioReporte` en `acceso.ts`). Sin secreto o inválido: `monthly-report` responde **500 «Falta configurar el destinatario del reporte»** en un envío real (el modo seco sigue igual) y `cierre-email` responde `ok:false` «REPORT_TO_EMAIL no configurada», como ya hacía sin `RESEND_API_KEY`. **`cierre-email` cambia: Branching la redespliega.** |
| `supabase/config.test.ts` (08/11) | **Nuevo.** Gate: toda función del repo tiene `verify_jwt` explícito, e `ingest-ndf`, si está en el repo, con `verify_jwt = false`. No se despliega. |

**`verify_jwt` esperado (el del `config.toml` del PR, igual al de prod según ESTADO.md, leído el 07/11):**

| Función | `verify_jwt` | Quién la llama |
|---|---|---|
| `monthly-report` | **true** | cron (service_role del Vault) y botón de Admin (JWT del owner) |
| `extract-document` | **true** | usuario con sesión |
| `cierre-email` | **true** | usuario con sesión |
| `pago-notificar` | **true** | usuario con sesión |
| `alta-empleado` | **true** | owner activo, o el propio usuario para cambiar su contraseña |

**Lo que NO está en el #61:**
- **`ingest-ndf`**: no está ni en `config.toml` ni en `supabase/functions/`. Va con el ítem 11 del puente
  (decisión de Ismael, 08/11). Branching no la toca. En prod sigue `verify_jwt = false`.
- **`ingest-punches`**: tampoco está (solo existe en staging).
- **Nada de base**: no hay migraciones, así que el ledger de prod no cambia.

**Lo que no cambia para el usuario:** el cron del día 1 y del día 15, el botón de reportes de Admin, el alta de
empleados, el escaneo de documentos, el correo de cierre y el aviso de pagos se comportan igual que hoy.

## 2. Orden respecto del puente y de la 085
1. **Primero el puente** (081 → 082 y el Edge `ingest-ndf` a mano), el **lunes 09/11 a la mañana**
   (paquete: `docs/puente/PASE-PROD-2026-11-09.md`, rama `claude/puente-item11-prod`).
2. **Después la 085** (SEC-01c), por merge de su PR (paquete: `docs/pases/PASE-085-rls-lectura-rol-activo.md`,
   rama `claude/rls-is-active`).
3. **Recién después, el #61.** Va solo, en su propia ventana.

## 3. Precondiciones (todas antes de mergear)
- [ ] **Firma de Ismael** sobre este paquete (aparte de la del puente y de la 085).
- [ ] **Puente hecho:** 081 y 082 en el ledger de prod, `ingest-ndf` nueva en prod con `verify_jwt = false`.
- [ ] **085 hecha.** Ledger de prod: **`max(version) = '085'`** y **58 filas** (55 + 081 + 082 + 085), salvo que
  ESTADO.md diga otra cosa ese día. Si el último no es la 085, **no se sigue**.
- [ ] **Último run de Branching en verde** («All migrations are up to date»). Si quedó en `MIGRATIONS_FAILED`,
  primero se arregla eso: con la migración fallida Branching no llega a desplegar funciones.
- [ ] **Rama del #61 al día con `main`** (con la 085 ya adentro), el PR sale de borrador y el gate está verde
  (incluye `acceso.test.ts`). El diff contra `main` tiene que seguir siendo **solo** los 5 archivos del §1.
- [ ] **Respaldo del §4 hecho y guardado fuera del repo.**
- [ ] **Prod igual a lo esperado** (sale del respaldo):
  - `monthly-report` v10, `extract-document` v7, `cierre-email` v2, `pago-notificar` v2, `alta-empleado` v1,
    todas con `verify_jwt = true` (referencia de ESTADO.md; si alguna versión cambió, se anota y se pregunta);
  - `ingest-ndf` con `verify_jwt = false` y la versión que dejó el puente;
  - jobs 3 y 4 del cron sin cambios contra el respaldo del §4.
- [ ] **Código de prod contra el de la rama:** el body descargado de `extract-document`, `cierre-email` y
  `pago-notificar` es igual al de `main`. Si alguna difiere, **frenar**: si Branching la redespliega, pisaría lo
  que hay en prod.
- [ ] **Secretos (solo nombres):** `supabase secrets list --project-ref yiczgdtirrkdvohdquzf` muestra
  `REPORT_TO_EMAIL`, `RESEND_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` y `SUPABASE_ANON_KEY`. Sin `REPORT_TO_EMAIL`,
  **no sale ningún correo**: el cron del día 1/15 respondería 500 y el cierre no mandaría su correo. Si falta,
  **frenar** y cargarlo antes (no se escribe su valor en ningún lado del repo).
- [ ] **Horario:** fuera del servicio (**19–22 h CR**) y lejos de las **02:00 CR del día 1 y del 15** (hora del cron).
- [ ] **Una sola sesión mergeando a `main`**, y nadie más pushea hasta terminar el §6.

## 4. Respaldo (solo lectura, antes del merge, fuera del repo)
Confirmar el ref en pantalla antes de cada comando: `yiczgdtirrkdvohdquzf` = PROD.
Todo se guarda en una carpeta **fuera del repo** (por ejemplo `respaldo_funciones_prod_antes_sec02b_<fecha>/`),
con el sha256 de cada archivo anotado en el §8 de este documento el día del pase. Ningún token ni clave se escribe
en esa carpeta ni en este documento.

**4.1 Lista de funciones** (versión, `verify_jwt`, entrypoint, fecha):
```bash
curl -sS -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>" \
  https://api.supabase.com/v1/projects/yiczgdtirrkdvohdquzf/functions > funciones.json
jq '.[] | {slug, version, verify_jwt, entrypoint_path, import_map, updated_at}' funciones.json
```

**4.2 Código de cada función** (un archivo por función):
```bash
for f in monthly-report extract-document cierre-email pago-notificar alta-empleado ingest-ndf; do
  curl -sS -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>" \
    "https://api.supabase.com/v1/projects/yiczgdtirrkdvohdquzf/functions/$f/body" > "body_$f.bin"
done
sha256sum body_*.bin funciones.json
```
Además, para leer el código: `supabase functions download <slug> --project-ref yiczgdtirrkdvohdquzf --use-api`
en esa misma carpeta, y comparar con el repo (precondición del §3).

**4.3 Cron** (editor SQL de PROD, solo lectura). En prod los jobs son **`satori-monthly-report` (3)** y
**`satori-quincenal-report` (4)**. Un filtro `like '%monthly%'` deja afuera al 4: se filtra por `report`.
```sql
select jobid, jobname, schedule, active, command
  from cron.job
 where jobname like '%report%' or jobid in (3, 4)
 order by jobid;
-- esperado (HALLAZGOS.md, SEC-02): 2 filas, a las 08:00 UTC (02:00 CR) del día 1 y del 15, active true,
-- command con net.http_post a /functions/v1/monthly-report y Authorization desde vault.decrypted_secrets
```
Se guarda la salida completa (`command` incluido: no trae la clave, solo la lectura del Vault).

**4.4 Últimos runs del cron** (referencia):
```sql
select jobid, status, start_time, end_time, left(return_message, 120)
  from cron.job_run_details where jobid in (3, 4)
 order by start_time desc limit 6;
```

## 5. Ejecución paso a paso
1. **Merge del #61 a `main`** (con la firma, en la ventana, con el respaldo hecho). Anotar la hora (`<HORA_MERGE>`).
2. **Esperar el run de Branching** y leer su log:
   - migraciones: «All migrations are up to date» (el PR no trae ninguna);
   - funciones: anotar **cuáles** desplegó. Seguro `monthly-report`, `alta-empleado` y `cierre-email` (cambian). Puede
     que también `extract-document` y `pago-notificar` (no cambian, pero `config.toml` es nuevo): a confirmar en el log.
   - `ingest-ndf` **no** tiene que aparecer.
3. Si el run falla, **frenar** y ir al §7 según lo que haya quedado desplegado.
4. Nadie toca el cron ni los secretos en este pase.

## 6. Verificación después del merge
**6.1 Funciones** (Management API, el mismo GET del §4.1):

| Función | Versión | `verify_jwt` |
|---|---|---|
| `monthly-report` | v11 (una más que la del respaldo) | **true** |
| `alta-empleado` | v2 (una más) | **true** |
| `cierre-email` | v3 (una más) | **true** |
| `extract-document`, `pago-notificar` | igual al respaldo, o +1 si Branching las redesplegó | **true** |
| `ingest-ndf` | **igual al respaldo** | **false** |

Si alguna quedó con `verify_jwt` distinto al de la tabla, **§7 enseguida**.

**6.2 Cron** (solo lectura):
1. `cron.job` de los jobs 3 y 4 **idéntico** al respaldo del §4.3 (mismo `schedule`, `active`, `command`).
2. `cron.job_run_details`: los últimos runs no cambian (el próximo es el día 1 o el 15 a las 02:00 CR).
3. **Llamada en seco desde la base**, igual a la del cron pero con `dry_run`. La clave sale del Vault y no se ve:
   ```sql
   select net.http_post(
     url     := 'https://yiczgdtirrkdvohdquzf.supabase.co/functions/v1/monthly-report',
     headers := jsonb_build_object(
       'Content-Type',  'application/json',
       'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')),
     body    := jsonb_build_object('tipo', 'ambos', 'dry_run', true)
   ) as request_id;
   -- unos segundos después:
   select id, status_code, left(content::text, 200) as content
     from net._http_response where id = <request_id>;
   -- esperado: status_code 200, content con "dry_run":true y "enviados"/"sin_datos", sin montos ni nombres
   ```
   **No** se corre sin `dry_run`: mandaría los correos de verdad.

**6.3 Log de las funciones** (panel): sin errores `no_controlado` desde `<HORA_MERGE>`.

## 7. Pruebas después del merge (sin datos reales y sin montos en las salidas)
Todas por `curl` contra `https://yiczgdtirrkdvohdquzf.supabase.co/functions/v1/<slug>`. Se anota **solo el
código HTTP** y el `code` del cuerpo. No se pegan cuerpos con datos en ningún lado.

**7.1 `monthly-report`** (siempre con `"dry_run": true`):

| Caso | Header `Authorization` | Esperado |
|---|---|---|
| Sin token | — | **401** (la puerta de entrada) |
| Anon key | `Bearer <ANON_KEY>` | **401** `sin_sesion` |
| Manager, cajero, owner inactivo | `Bearer <JWT_DE_PRUEBA>` | **403** `no_autorizado` |
| service_role | `Bearer <SERVICE_ROLE_KEY>` | **200**, `dry_run: true`, sin montos ni nombres |
| Mes inválido (`"month": "2026-13"`) con service_role | `Bearer <SERVICE_ROLE_KEY>` | **400** `mes` |
| CORS | `OPTIONS` con `Origin: https://cachosatori.github.io` y con un origen ajeno | el primero con `Access-Control-Allow-Origin`, el ajeno sin él |

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
  -H 'Content-Type: application/json' -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -d '{"tipo":"ambos","dry_run":true}' \
  https://yiczgdtirrkdvohdquzf.supabase.co/functions/v1/monthly-report
```
Las claves se pasan por variable de entorno de la terminal, nunca escritas en un archivo ni en el historial
compartido. Los casos 403 necesitan una cuenta de prueba de ese rol en prod; si no la hay, se anota «no corrido» y
vale la prueba de staging del 06/11 más `acceso.test.ts`.

**7.2 Humo de las otras cuatro** (sin cuerpo con datos):

| Función | Sin token | Anon key |
|---|---|---|
| `extract-document` | **401** | **401** (`getUser` sin usuario) |
| `cierre-email` | **401** | **401** |
| `pago-notificar` | **401** | **401** |
| `alta-empleado` | **401** | **401** `sin_sesion` |

**7.3 Pantalla** (Ismael, owner, en prod): Admin → Usuarios abre bien y el formulario de «+ Nuevo empleado» aparece
(sin crear a nadie). El botón de reportes de Admin **no** se toca: manda los correos de verdad.

**7.4 `ingest-ndf` sigue sana:** `pos_ndf_cursor.last_poll_at` avanza y `last_error` es null durante 3 ciclos.

## 8. Vuelta atrás
El cron **no se toca** en ningún caso: sigue mandando la service_role del Vault, que sirve con la v10 y con la nueva.

**8.1 Plan a — redeploy a mano de las versiones de antes** (el más seguro):
```bash
# monthly-report = la v10, desde 9ac28b0, con verify_jwt on
git checkout --detach 9ac28b0
supabase functions deploy monthly-report --project-ref yiczgdtirrkdvohdquzf
# alta-empleado = la v1, desde la rama claude/alta-empleado-fn
git checkout --detach origin/claude/alta-empleado-fn
supabase functions deploy alta-empleado --project-ref yiczgdtirrkdvohdquzf
# extract-document / cierre-email / pago-notificar: solo si Branching las redesplegó y algo falla,
# desde el commit de main anterior al merge (<SHA_MAIN_ANTES>)
```
- Sin `config.toml` en esos commits, el CLI despliega con `verify_jwt = true`, que es el valor de antes para estas
  cinco. **No usar `--no-verify-jwt`.**
- Verificar con el GET del §4.1: versión +1 y `verify_jwt = true`. Repetir el §6.2.3 (seco desde la base → 200).

**8.2 Plan b — PR de revert del merge.** ⚠️ **Ojo:** el revert deja en `main` el `monthly-report` de **antes de
SEC-02** (sin guarda). Si Branching lo redespliega, la puerta solo pide un JWT, y la anon key es un JWT: **SEC-02
vuelve a quedar abierto** (ventas y correos para cualquiera). Por eso:
- el revert solo va **junto con** el redeploy a mano de la v10 del §8.1, enseguida después del run de Branching;
- o, mejor, en vez de revertir todo, un PR que saque solo lo que falló y deje la guarda de `monthly-report`.
- Sacar `alta-empleado/` de `main` no borra la función de prod (Branching no borra funciones): queda la última desplegada.

**8.3 Verificar la vuelta:** versiones y `verify_jwt` iguales al respaldo del §4.1 (con la versión +1), el body
igual al descargado en el §4.2, cron igual al §4.3, y las pruebas del §7.1 y §7.2 dan lo mismo.

## 9. Pendientes antes de la firma
- **Firma de Ismael**, aparte de la del puente y la de la 085.
- **Que pasen el puente y la 085** y que el ledger de prod termine en la 085 (§3).
- **Rotación de claves (pospuesta).** El cron manda la service_role del Vault, que hoy es un JWT. Si se pasa a las
  claves nuevas (`sb_secret_…`, que **no** son JWT) o se apagan las JWT viejas, la puerta de entrada rechaza al
  cron con 401. En ese mismo cambio, `monthly-report` pasa a `verify_jwt = false` en `config.toml` (la guarda de
  `acceso.ts` ya acepta los dos formatos), y se vuelve a probar el cron con el §6.2.3. No es parte de este pase.
- **`REPORT_TO_EMAIL` ya sin valor por defecto en el código** (08/11, en el #61). Por eso el §3 exige que el secreto
  exista en prod **antes** del merge: sin él no sale ningún correo (falla visible, no un envío a una dirección fija).
  Prueba extra después del merge: el envío real del cierre del día siguiente llega (o un `dry_run` de
  `monthly-report` responde 200, que no depende del destinatario).
- **Cuándo despliega Branching las funciones que no cambian** (`extract-document`, `cierre-email`,
  `pago-notificar`): no está confirmado. El §5.2 lo deja anotado y el §3 exige que su código en prod sea igual al de `main`.
- **Después del merge:** actualizar ESTADO.md (regla operativa 2 cumplida para estas funciones; tabla de Edge
  Functions con las versiones nuevas) y el comentario de cabecera de `monthly-report/index.ts`, que todavía dice
  «Deploy A MANO».
- **⛔ GATE de `ingest-ndf` (Ismael, 08/11):** el día que `supabase/functions/ingest-ndf/` llegue a `main`, el
  **mismo PR** agrega a `config.toml`:
  ```toml
  [functions.ingest-ndf]
  verify_jwt = false
  ```
  Si no, Branching la despliega con `verify_jwt = true` y el agente del PoS recibe **401 en cada ciclo** (manda
  `x-ingest-secret`, no un JWT). Lo exige `supabase/config.test.ts` en el gate (falla si la carpeta está y la
  sección no, o si dice `true`). Lo mismo para `ingest-punches/`: necesita su sección con `verify_jwt` explícito.
- **Guías de uso (`docs/sop-app/`):** este pase no cambia pantallas, botones ni roles; no hace falta tocarlas.

**Registro del día del pase** (completar):
- Hora del merge: `<HORA_MERGE>` · run de Branching: `<RUN>` · funciones desplegadas: `<LISTA>`
- sha256 del respaldo: `funciones.json` `<…>`, `body_*.bin` `<…>`, cron `<…>`
- Resultado del §6 y del §7: `<…>`
