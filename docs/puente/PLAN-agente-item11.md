# Plan · actualizar el agente del PoS (ítem 11) — paso a paso por AnyDesk

> **Para el dueño.** Solo el agente de **STAGING**, en **`C:\satori\satori-app`**. **Prod no se toca.**
> **Ventana: de día y fuera del servicio. Nunca de 17:00 a 23:00.** Duración: unos 30 minutos, más el
> backfill, que corre solo.
> Si algo no coincide con lo que dice este plan, **parar y avisar** antes de seguir.

## Las dos carpetas (confirmado en PAQUETE-PC-pos y en el handoff del 29-oct)
| | Carpeta | Arranque | Log | Tarea programada | Hoy |
|---|---|---|---|---|---|
| **Staging (este plan)** | `C:\satori\satori-app` | `pos-agente.cmd` | `C:\satori\logs\pos-agente.log` | «Satori PoS Bridge» | `claude/puente-item11` @ `e84c388` (desde el 07-nov 13:44Z) |
| Prod (no se toca) | `C:\satori\satori-app-prod` | `pos-agente-prod.cmd` | `C:\satori\logs\pos-agente-prod.log` | «Satori PoS Bridge PROD» | `4d3513a` |

**Antes de cada comando, mirar que la consola esté en `C:\satori\satori-app`.** Si dice
`satori-app-prod`, parar.

## Qué cambia
El agente empieza a mandar, por cada factura: la **mesa de la factura** (`NumeroMesa`), el **consecutivo
electrónico** (20 dígitos), la **clave electrónica** (50 dígitos) y la **hora de apertura del pedido**.
En las mesas abiertas manda también la apertura del pedido. Nada de nombres ni teléfonos. No cambia
ningún monto.

La rama **`claude/puente-item11`** sale de **`feat/pos-desglose` @ `14bd278`**, el mismo commit que corre
hoy en staging, con el fix del IVA. Le suma un solo commit, `e84c388`.

## Lo que ya está hecho en staging (Claude Code, 07-nov)
1. Migración **081** aplicada en staging. Agrega columnas que aceptan vacío; no cambia nada de lo que ya hay.
2. Edge `ingest-ndf` **v11** en staging. Con el agente de hoy sigue funcionando: los campos nuevos
   quedan vacíos. Se verificó un ciclo real sin error.
3. Rama `claude/puente-item11` en GitHub.

## Paso 0 · Mirar antes de tocar (solo lectura)
1. Conectarse por AnyDesk a la PC del PoS.
2. Abrir una consola (`cmd`) y entrar a la carpeta de staging:
   ```
   cd /d C:\satori\satori-app
   cd
   ```
   El segundo `cd` muestra la carpeta actual. Tiene que decir **`C:\satori\satori-app`**, no `-prod`.
3. En el Programador de tareas, confirmar que la tarea **«Satori PoS Bridge»** (sin «PROD») inicia
   en `C:\satori\satori-app`.

## Paso 1 · Punto de vuelta atrás
En `C:\satori\satori-app`:
```
git rev-parse HEAD
git status
```
- Anotar el hash. Se espera `14bd278…`; si es otro, avisar.
- `git status` no tiene que mostrar archivos modificados. Si muestra alguno, parar y avisar.

## Paso 2 · Parar el agente de staging
En el Programador de tareas, sobre **«Satori PoS Bridge»** (no la PROD): clic derecho → **Finalizar**.

## Paso 3 · Traer el código nuevo
En `C:\satori\satori-app` (verificar con `cd`):
```
git fetch origin claude/puente-item11
git checkout claude/puente-item11
git log --oneline -2
```
`git log` tiene que mostrar `e84c388` arriba y `14bd278` abajo. Después:
```
npm install
cd pos-bridge
npm install
cd ..
```
(Los `npm install` no deberían cambiar nada: el ítem 11 no agrega dependencias.)

## Paso 4 · Prueba en seco (no envía nada)
En `C:\satori\satori-app\pos-bridge` (verificar con `cd`):
```
npm run backfill -- --desde 2026-11-05 --hasta 2026-11-05 --dry-run
```
- **Bien:** lista el día con sus facturas y termina sin error.
- **Mal:** cualquier error. Ir al **Rollback** y avisar.
- Ojo: si una de las columnas nuevas se llamara distinto en esta PC, el agente **no falla**, la
  manda vacía. Por eso lo que confirma de verdad es la verificación de Claude Code (paso 7).

## Paso 5 · Volver a arrancar el agente de staging
1. En el Programador de tareas, sobre **«Satori PoS Bridge»**: clic derecho → **Ejecutar**.
2. Mirar `C:\satori\logs\pos-agente.log` durante 2 o 3 ciclos (unos 3 minutos). Cada
   ciclo tiene que terminar **sin error**.
3. Avisarle a Claude Code: él confirma en staging que el agente sigue entrando y que llegan los campos nuevos.

## Paso 6 · Backfill desde el 1 de septiembre (solo staging)
En `C:\satori\satori-app` (verificar con `cd`), con el agente corriendo (no hace falta pararlo):
```
npm run pos:backfill -- --desde 2026-09-01 --hasta <AYER, AAAA-MM-DD>
```
- Va del día más reciente al más viejo, con pausa entre días: tarda unos minutos.
- Si se corta, se vuelve a correr el mismo comando; no duplica nada.
- **Nunca** en `satori-app-prod`.

## Paso 7 · Verificación (Claude Code, en staging)
Claude Code corre `scripts/sql/club_verificar_backfill.sql`, que es solo lectura y termina en ROLLBACK:
- **Cobertura en salón desde el 1-sep:** facturas con mesa de la factura, con consecutivo y con
  apertura. Según el conteo del dueño, quedan 5 sin mesa ni pedido.
- **Ejemplos:**
  - 112430 → consecutivo …16197, apertura 2026-11-05 18:39:48.
  - 112310 y 112311 → mesa 19, sin pedido.
- **Mesa 19 del 31-oct con los datos reales:** el pedido 33, con su apertura y su mesa reales, tiene
  que dar **112313 + 112310 + 112311** (o «ambigua», si otra mesa 19 se superpone).
- Después vuelve a correr `scripts/sql/075_pruebas_staging.sql`.

## Rollback (si algo sale mal en cualquier paso)
1. Programador de tareas: **Finalizar** «Satori PoS Bridge».
2. En `C:\satori\satori-app` (verificar con `cd`): `git checkout <el hash del Paso 1>` (se espera `14bd278`).
3. Programador de tareas: **Ejecutar** «Satori PoS Bridge».
4. Avisar. El Edge v11 de staging funciona con el agente viejo: los campos nuevos quedan vacíos.
   - Solo si hiciera falta volver todo atrás: Claude Code sube otra vez el Edge desde
     `feat/pos-desglose` y después corre `scripts/sql/081_rollback.sql`. **En ese orden.**

## Segunda actualización del agente de staging: el área de la mesa (07-nov)
La mesa es (área, mesa): la mesa 3 del área '3' no es la mesa 3 del área 'M' (decisión del dueño). El
agente ahora manda también:
- `area_factura` (`FAC_Facturas.Area`) en cada factura;
- `area` (`FAC_Pedidos.Area`) en cada mesa abierta.

**Ya está hecho en staging:** la 081 con las dos columnas nuevas y el Edge `ingest-ndf` **v12**. El agente
de hoy, `e84c388`, sigue entrando bien con este Edge: se verificó un ciclo a las 14:45Z.

**Falta, en la PC, con los mismos pasos 1 a 7 de arriba:**
1. La rama ahora es `claude/puente-item11` @ **`283e3c4`** (el área de la mesa; ya sin la 081). Hay que hacer `git pull` en `C:\satori\satori-app` y reiniciar la tarea «Satori PoS Bridge».
2. Repetir el backfill desde el 1-sep. Así se llena `area_factura` en el histórico. Re-correrlo no duplica nada.
3. Mientras tanto el cruce usa `area`, que en las facturas sin pedido ya es la de la factura. El cruce queda bien también antes del backfill.

## Tercera actualización del agente de staging: ronda 3 de la auditoría (07-nov)
Cambios del agente (rama `claude/puente-item11` @ **`0cf4d87`**):
- **CLUB-AUD-31:** la clave del pedido abierto lleva la fecha: `pedido:AAAA-MM-DD:N`. Un pedido de ayer que quedó
  abierto y uno de hoy con el mismo número ya no se pisan en la lista de la caja.
- **CLUB-AUD-32:** el candado de prod mira `INGEST_URL`, no la etiqueta `ENV`. En la PC de staging no cambia nada,
  siempre que el `.env` tenga la URL de staging y `ENV` vacío o `staging`. Si no coinciden, el agente **no arranca** y lo
  dice en el log.

**Falta, en la PC, con los mismos pasos 1 a 5 de arriba (no hace falta backfill):**
1. En `C:\satori\satori-app` (verificar con `cd`): `git pull` → `git log --oneline -1` tiene que mostrar `0cf4d87`.
2. Prueba en seco (paso 4). Si dice «ABORTADO: … no coincide con INGEST_URL», parar y avisar: el `.env` está mezclado.
3. Reiniciar «Satori PoS Bridge» y mirar `C:\satori\logs\pos-agente.log` durante 2 o 3 ciclos.
4. Avisarle a Claude Code: él confirma en staging que `pos_ndf_open.clave` llega como `pedido:AAAA-MM-DD:N`.

La base ya acepta las dos claves, la vieja y la nueva: el orden entre la PC y la base no importa.

## Pase a prod — anotado, NO se hace ahora (lleva firma del dueño)
Orden obligatorio, sin saltos:
1. **Migración 081** en prod, a mano, con el ritual del ref y registrada en el ledger. Hay **una sola versión**, la final, en el PR #59 (con el área de la mesa y los índices del CLUB-AUD-13). Las ramas del agente ya no la traen, así que no hay ninguna 081 vieja para aplicar por error. El agente no la usa.
2. **Edge `ingest-ndf` v11** en prod, a mano. Con el Edge nuevo y sin la 081, el upsert falla y no
   entra ninguna venta: **la migración va siempre primero**.
3. **Agente de prod** en `C:\satori\satori-app-prod`. **Ojo con la base:** prod corre `4d3513a`, que viene de la línea `staging`, y no `feat/pos-desglose`. Para que prod cambie **solo** el ítem 11, su rama es **`claude/puente-item11-prod`** (`4d3513a` + los commits del ítem 11; hoy @ `eee0515`, con el área y sin la 081; 459/459 pruebas), **no** `claude/puente-item11`.
   - Pasar prod a `claude/puente-item11` cambiaría además `mapTicket.ts`: la lista de nombres de saloneros que se usa solo para mostrar en el dry-run, y el nombre de la constante de la familia 29, que vale lo mismo. Ninguno de los dos llega a la base, pero no es lo que se firma.
   - Las facturas en curso (R) y las anuladas (X) se releen igual en las dos versiones: en ese comportamiento no cambia nada. Mismo procedimiento que este plan, con la
   tarea «Satori PoS Bridge PROD» y su log `C:\satori\logs\pos-agente-prod.log`. Después, el backfill.

Regla vigente: los archivos de `supabase/functions` (el Edge) **no van en PRs a `main`** hasta que exista
`supabase/config.toml` (ítem 11 del backlog de seguridad).
