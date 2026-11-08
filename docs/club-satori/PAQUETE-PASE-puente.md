# Paquete de pase a PROD · puente del PoS (081, 082 y Edge `ingest-ndf`)

> **Para la firma de Ismael. Nada de esto está hecho en prod.** Este documento solo describe el pase; no se corre sin
> la firma de abajo. Ventana: **de día, fuera del servicio (nunca de 17:00 a 23:00)**, con alguien mirando el PoS.
> Si algo no coincide con lo que dice acá, **se para y se avisa** antes de seguir.

## Qué entra

| Pieza | Fuente | Huella |
|---|---|---|
| Mig **081** `pos_ndf_campos_factura` (columnas nuevas, aditivas) | `supabase/migrations/081_pos_ndf_campos_factura.sql` (PR #59) | md5 `d4acf8dafc964ed23072aa49098f5b42` |
| Mig **082** `pos_ndf_ingesta_transaccional` (función `pos_ndf_ingestar`, aditiva) | `supabase/migrations/082_pos_ndf_ingesta_transaccional.sql` en `claude/puente-item11-prod` | md5 `5db915c8a422519ce77050f1fb1b916a` |
| Edge `ingest-ndf` (una transacción por local; secreto por local; cursor que solo avanza) | `supabase/functions/ingest-ndf/` en `claude/puente-item11-prod` @ **`e4678b3`** | commit |
| Secretos `POS_INGEST_SECRETS` (uno por local) | se generan el día del pase (paso 3) | — |

**Qué no entra:** el agente nuevo del PoS. En prod sigue el de hoy (`4d3513a`, carpeta `C:\satori\satori-app-prod`).
El Edge nuevo es compatible con ese agente: el agente solo mira `ok` en la respuesta, el sobre que manda no cambió de
forma y los campos nuevos de la 081 quedan vacíos hasta que se actualice el agente (otra firma, al final).

**La rama `claude/puente-item11-prod`** es la base de lo que corre hoy en prod (`4d3513a`) más el ítem 11, la ronda 3 y,
por cherry-pick, `831b3ee` (CLUB-AUD-46/47/48) y `9461731` (CLUB-AUD-44/45), más las pruebas de Grok 99. `mapTicket.ts`
quedó igual que en esa rama (roster y GreenSeason sin tocar).

**Números:** el último del ledger de prod hoy es `080`. La `081` y la `082` son mayores, así que **entran con su número si
van primero** (regla de numeración del RUNBOOK). Si el día del pase prod ya tiene una `081` o una `082` con otro nombre,
**se para**: se renombran al siguiente libre del bloque de PASE 150–199 en un PR propio y se rehace este paquete.

### Lo que ya se probó (staging, sin deploy)
- `scripts/sql/puente_carreras/pruebas.sql`: **11/11** (ROLLBACK). Incluye Grok 99: un lote con la misma factura dos
  veces y un lote con una línea de tipo inválido **se rechazan enteros** (ni la otra factura, ni las líneas, ni el
  cursor quedan a medias). El Edge además deduplica antes de llamar a la base (gana la última) y normaliza los números,
  así que en la práctica esos lotes no llegan a la función.
- `scripts/sql/puente_carreras/correr.sh`: dos POST simultáneos de la misma factura → viejo 6 líneas (duplicadas),
  nuevo 3.
- vitest del puente (`src/shared/ndf`): 203/203; `tsc` y `eslint` limpios.
- En staging la 081 y la 082 están aplicadas y con su fila del ledger: `md5(statements[1])` coincide con el archivo.

## Paso 0 · Lecturas (solo lectura, en PROD)
Editor SQL de PROD (**leer el ref en pantalla: `yiczgdtirrkdvohdquzf`**):
```sql
select version, name from supabase_migrations.schema_migrations order by version desc limit 5;  -- último: 080
select version, name from supabase_migrations.schema_migrations where version in ('081','082');  -- 0 filas
select to_regprocedure('public.pos_ndf_ingestar(text, jsonb, jsonb, jsonb, jsonb)');               -- null
select local, last_factura, last_fecha_registra, last_poll_at, last_error from public.pos_ndf_cursor;
select count(*) from public.pos_ndf_tickets where local = 'santa-teresa';
-- la 082 escribe usuario_registra (mig 066, en prod desde el 30-oct): tiene que existir
select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'pos_ndf_ticket_lines'
   and column_name = 'usuario_registra';                                                            -- 1
```
Y además, **anotar** (es el punto de vuelta):
1. Panel → Edge Functions → `ingest-ndf`: **versión, fecha** y que **«Enforce JWT verification» esté apagado**.
2. **Copia del Edge que corre hoy**: panel → `ingest-ndf` → Code → descargar (o
   `supabase functions download ingest-ndf --project-ref yiczgdtirrkdvohdquzf` en una carpeta aparte). Se guarda fuera
   del repo. Sin esta copia **no se sigue**.
3. En la PC del PoS, carpeta de prod, el **largo** del secreto del agente (sin mostrarlo), en PowerShell:
   ```powershell
   cd C:\satori\satori-app-prod
   (Select-String -Path .env -Pattern '^INGEST_SECRET=').Line.Substring(14).Length
   ```
   **Tiene que dar 32 o más.** El Edge nuevo rechaza secretos de menos de 32 (CLUB-AUD-47). Si da menos, ver el paso 3.

**Para:** si el ledger tiene `081`/`082`, si `pos_ndf_ingestar` ya existe, si el cursor tiene `last_error`, o si no hay
copia del Edge.

## Paso 1 · Mig 081 + fila del ledger
1. En el editor SQL de PROD, pegar y correr **el archivo entero** `081_pos_ndf_campos_factura.sql` (trae su `begin`/`commit`).
2. Registrar la fila con **el texto exacto del archivo** (el mismo que se corrió):
   ```sql
   insert into supabase_migrations.schema_migrations (version, name, statements)
   values ('081', 'pos_ndf_campos_factura', array[$m$<pegar acá el archivo 081 entero, tal cual>$m$]);
   ```
3. **Verificar:**
   ```sql
   select version, md5(statements[1]) from supabase_migrations.schema_migrations where version = '081';
   -- d4acf8dafc964ed23072aa49098f5b42
   select column_name from information_schema.columns where table_schema = 'public' and table_name = 'pos_ndf_tickets'
      and column_name in ('mesa_factura','consecutivo_fe','clave_fe','pedido_abierto_en','area_factura');  -- 5 filas
   ```
   Si el md5 no da, la fila se borra y se vuelve a insertar con el archivo bajado de GitHub (no copiado de un chat: los
   saltos de línea cambian el md5). El agente de hoy sigue entrando: `last_poll_at` avanza y `last_error` sigue null
   durante 3 ciclos.

## Paso 2 · Mig 082 + fila del ledger
1. Correr **el archivo entero** `082_pos_ndf_ingesta_transaccional.sql` (de `claude/puente-item11-prod`).
2. Fila:
   ```sql
   insert into supabase_migrations.schema_migrations (version, name, statements)
   values ('082', 'pos_ndf_ingesta_transaccional', array[$m$<pegar acá el archivo 082 entero, tal cual>$m$]);
   ```
3. **Verificar:**
   ```sql
   select version, md5(statements[1]) from supabase_migrations.schema_migrations where version = '082';
   -- 5db915c8a422519ce77050f1fb1b916a
   select has_function_privilege('service_role',  'public.pos_ndf_ingestar(text, jsonb, jsonb, jsonb, jsonb)', 'EXECUTE'),  -- true
          has_function_privilege('anon',          'public.pos_ndf_ingestar(text, jsonb, jsonb, jsonb, jsonb)', 'EXECUTE'),  -- false
          has_function_privilege('authenticated', 'public.pos_ndf_ingestar(text, jsonb, jsonb, jsonb, jsonb)', 'EXECUTE');  -- false
   -- llamada en vacío: no escribe nada (sin tickets, sin mesas, sin cursor) y confirma que ve las columnas de la 081
   select public.pos_ndf_ingestar('prueba-pase', '[]', '[]', null, null);
   -- {"tickets": 0, "lineas": 0, "cursor": null, "cursor_escrito": false, ...}
   ```
   El agente de hoy no usa la función: sigue entrando igual.

## Paso 3 · Secretos por local
Panel de PROD → Edge Functions → Secrets → `POS_INGEST_SECRETS`, un JSON con **un secreto por local**:
```
{"santa-teresa":"<secreto de santa-teresa>","nosara":"<secreto de nosara>"}
```
Reglas (el Edge las hace cumplir; si no se cumplen, **nadie entra**, fail-closed):
- **32 caracteres o más** cada uno.
- **Ninguno repetido** entre locales (CLUB-AUD-47).
- **santa-teresa = el mismo secreto que ya tiene el agente de prod** (`INGEST_SECRET` del `.env` de
  `C:\satori\satori-app-prod`) si en el paso 0 dio 32 o más. Así el agente de hoy entra sin tocar la PC y el smoke test
  (paso 5) es con el agente actual.
- **nosara**: uno nuevo, que solo se va a cargar en la PC de Nosara cuando tenga su agente. Generarlo en la PC (PowerShell
  5.1; da 64 caracteres hexadecimales):
  ```powershell
  $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | % { $_.ToString('x2') })
  ```
- Los secretos **no van al repo, ni a un chat, ni a WhatsApp**: del generador al panel y al `.env`, nada más.

**Si el secreto de santa-teresa tiene menos de 32:** se genera uno nuevo con el mismo comando y se cambia **en el mismo
minuto** en el panel (mapa) y en el `.env` de prod (`INGEST_SECRET=`), y se reinicia la tarea «Satori PoS Bridge PROD».
Entre el deploy del paso 4 y ese cambio el agente da 401 y no avanza: no se pierde nada (relee desde su cursor), pero se
hace todo seguido.

`POS_INGEST_SECRET` (el único de antes) **no se borra** hasta que pasen 7 días: el Edge anterior lo necesita si hay que
volver (rollback).

## Paso 4 · Deploy del Edge (`verify_jwt = false`)
Desde un checkout limpio de `claude/puente-item11-prod` @ `e4678b3` (`git status` sin cambios):
```bash
supabase functions deploy ingest-ndf --no-verify-jwt --project-ref yiczgdtirrkdvohdquzf
```
`--no-verify-jwt` es a propósito: quien llama es el agente headless del PoS, sin sesión de usuario; el portón es el
secreto por local. No hay `supabase/config.toml` en el repo, así que **el flag es obligatorio** en cada deploy.

**Verificar** (panel): la versión subió y **«Enforce JWT verification» está apagado**.

## Paso 5 · Smoke test con el agente actual (sin tocar la PC)
1. **Portón** (desde cualquier máquina; no lleva secreto):
   ```bash
   curl -s -i -X POST https://yiczgdtirrkdvohdquzf.supabase.co/functions/v1/ingest-ndf -H 'content-type: application/json' -d '{}'
   ```
   Tiene que dar **401 con `{"ok":false,"error":"No autorizado"}`** (ese cuerpo es del Edge: confirma que el JWT no se
   está verificando en la puerta). Si da `Missing authorization header`, el `verify_jwt` quedó prendido: volver al paso 4.
2. **El agente de hoy entra** (3 ciclos, unos minutos), en el editor SQL de PROD:
   ```sql
   select local, last_factura, last_poll_at, last_error from public.pos_ndf_cursor;      -- last_poll_at avanza; last_error null
   select count(*) from public.pos_ndf_tickets where local = 'santa-teresa';             -- igual o más que en el paso 0
   select max(ingested_at) from public.pos_ndf_tickets where local = 'santa-teresa';     -- después del deploy (si hubo ventas)
   ```
3. **Sin líneas duplicadas** en lo que entró después del deploy:
   ```sql
   select t.numero_factura, count(*) as lineas, count(distinct (l.codigo_producto, l.cantidad, l.monto)) as distintas
     from public.pos_ndf_tickets t join public.pos_ndf_ticket_lines l on l.ticket_id = t.id
    where t.local = 'santa-teresa' and t.ingested_at > '<hora del deploy>'
    group by 1 having count(*) >= 2 * count(distinct (l.codigo_producto, l.cantidad, l.monto));  -- 0 filas
   ```
   Si sale alguna, se mira a mano: una factura con el mismo plato pedido dos veces en líneas separadas también aparece.
4. **Log del agente**: `C:\satori\logs\pos-agente-prod.log` sin `401`, sin `rechazó el lote` y sin `Respuesta inesperada`.
5. **Logs del Edge** (panel → `ingest-ndf` → Logs): sin `ingest-ndf: excepción`.

**Pasa** si los cinco dan bien. **Si cualquiera falla, rollback** (abajo), en ese orden.

## Rollback (el orden importa)
1. **Primero, el Edge anterior.** Redeploy de la copia del paso 0, con el mismo flag:
   `supabase functions deploy ingest-ndf --no-verify-jwt --project-ref yiczgdtirrkdvohdquzf` desde la carpeta de la copia.
   Verificar: versión nueva en el panel, «Enforce JWT verification» apagado, y el agente de hoy entra (paso 5.2).
   El Edge anterior usa `POS_INGEST_SECRET` (por eso no se borró en el paso 3).
2. **Recién después**, si hace falta, la 082 (el Edge anterior no la usa):
   ```sql
   drop function if exists public.pos_ndf_ingestar(text, jsonb, jsonb, jsonb, jsonb);
   delete from supabase_migrations.schema_migrations where version = '082';
   ```
   **Nunca al revés:** con el Edge nuevo y sin la función, no entra ninguna venta.
3. La 081 **no hace falta sacarla** (columnas que aceptan vacío; el Edge anterior no las usa). Si Ismael lo pide, y solo
   con el Edge anterior ya corriendo: `scripts/sql/081_rollback.sql` (saca también la fila del ledger).
4. `POS_INGEST_SECRETS` puede quedar (el Edge anterior no lo lee) o borrarse del panel.

## Después (otra firma, otro día)
- Actualizar el agente de prod a `claude/puente-item11-prod` (RUNBOOK del Club, paso 3.3, y `docs/puente/PLAN-agente-item11.md`
  con la carpeta de prod): recién ahí empiezan a llegar `mesa_factura`, `consecutivo_fe`, `clave_fe` y `area_factura`.
- Borrar `POS_INGEST_SECRET` del panel a los 7 días sin rollback.
- Traer la 082 al PR #59 (hoy vive solo en `claude/puente-item11-prod` y está registrada como «usada antes de los
  bloques»).

## Firma
- [ ] Leí el paquete y el orden del rollback.
- [ ] Ventana: ____ / ____ (de día, fuera del servicio).
- [ ] Quién corre los pasos: ________ · Quién mira el PoS: ________
- [ ] Autorizo el pase de la 081, la 082 y el Edge `ingest-ndf` @ `e4678b3` a PROD. Firma: ________ Fecha: ________
