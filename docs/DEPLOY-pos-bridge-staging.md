# Puesta en marcha del pos-bridge en STAGING

> **Qué es esto.** La secuencia exacta para poner a andar el puente del PoS "Nube de Fuego"
> contra **staging**: la migración `062`, la Edge Function `ingest-ndf` y el agente en la PC del
> PoS. Escrito para ejecutarse en orden, de arriba abajo, leyendo el "qué ver" de cada paso antes
> de pasar al siguiente.
>
> **Rama:** **`deploy/pos-bridge-staging`** (= `feat/pos-bridge-a3`, el mismo commit; el primer
> nombre es el que se usa para desplegar). **NO se mergea** — ni a `staging` ni a `main`.
> Decisiones firmadas por Ismael: `local` en el sobre · RLS `owner/manager/contador` · el Edge
> recalcula el total (medios − vuelto) y gana el Edge.

---

## ⚠️ Las dos reglas que no se negocian

**1. En este repo las migraciones a staging NO van por merge.** Van por `supabase db push` contra
el proyecto **linkeado**, a mano. Staging **no** está atado a ninguna integración automática
(ESTADO.md §c; así entraron las 055–058 de BioTime).

**2. `main` SÍ auto-aplica.** El proyecto de prod tiene **Supabase Branching ON**: pushear o
mergear una migración a `main` **la aplica sola a la base de producción**
(ESTADO.md, `_handoff/INTEGRACION-SUPABASE.md`). Por eso esta rama **no se mergea a `main`**
hasta que exista su propio ciclo de pase a prod, con firma.

| | |
|---|---|
| **STAGING** | `hwiatgicyyqyezqwldia` — acá va todo lo de este documento |
| **PROD** | `yiczgdtirrkdvohdquzf` — **no se toca en ningún paso** |

---

## Pasos y firmas

| # | Paso | ¿Firma de Ismael? |
|---|---|---|
| 1 | Verificar que el link apunta a STAGING | — (guardrail, siempre) |
| 2 | `migration list` + `db push --dry-run` | 🖊 **SÍ** — decidir si se aplica |
| 3 | `db push` (aplica la 062) | 🖊 **SÍ** — escribe esquema |
| 4 | `secrets set` + `functions deploy` | 🖊 **SÍ** — crea un secreto y publica un endpoint |
| 5 | Humo del ingest con `curl` | — (escribe 1 ticket de prueba en staging) |
| 6 | Montar el agente en la PC del PoS | 🖊 **SÍ** — instalación en la máquina del local |
| 7 | Cuadre del día contra el reporte de Nube | 🖊 **SÍ** — es el criterio de aceptación |

---

## Paso 0 — Precondiciones

En la máquina desde la que se administra (la de Ismael, no la del PoS):

```bash
supabase --version                 # CLI de Supabase instalada
git fetch origin
git checkout deploy/pos-bridge-staging
git rev-parse --abbrev-ref HEAD    # tiene que decir: deploy/pos-bridge-staging
ls supabase/migrations | tail -3   # 060… 061… 062_pos_ndf_ingesta.sql
```

- El checkout **tiene que estar en `deploy/pos-bridge-staging`**: `db push` mira los **archivos**
  de la rama en la que estás parado.

> ### ⚠️ La rama sale de `staging`, NO de `main` — y tiene que ser así
>
> `main` es **producción** y su última migración es la **054**: no tiene las 055–061 (Salarios y
> BioTime viven solo en staging, ESTADO.md §b). Una rama basada en `main` traería la `062` con un
> hueco de siete migraciones: contra la base de staging —cuyo ledger ya tiene esas versiones— el
> CLI lo lee como **drift** y `migration list` / `db push` fallan.
>
> Y hay algo peor: con **Branching ON**, cualquier cosa que llegue a `main` **se auto-aplica a la
> base de producción**. Por eso la rama sale de `staging`, donde el ledger calza, y no se mergea
> a ningún lado.
- El CLI conecta a la base con el **access token del Keychain** (servicio `Supabase CLI`), no con
  `SUPABASE_DB_PASSWORD`. Si pide login: `supabase login`.

---

## Paso 1 — Guardrail: ¿a qué proyecto estoy linkeado?

**Antes de CUALQUIER comando de base.** Es el ritual del repo (ESTADO.md §a), y existe porque el
error que evita es irreversible.

```bash
cat supabase/.temp/project-ref
```

**Qué ver si salió bien:**

```
hwiatgicyyqyezqwldia
```

- Si dice **`yiczgdtirrkdvohdquzf`** → **PARÁ.** Eso es **PRODUCCIÓN**. Re-linkeá a staging antes
  de seguir.
- Si el archivo no existe o dice otra cosa:

```bash
supabase link --project-ref hwiatgicyyqyezqwldia
cat supabase/.temp/project-ref      # verificar OTRA VEZ
```

> **Truco que evita accidentes** (ESTADO.md §a): linkear dentro de un `git worktree` aparte. El
> `.temp` es propio de ese árbol y el link del árbol principal no se toca.
>
> `supabase/.temp/` está en el `.gitignore`: el link es de tu máquina, no del repo.

---

## Paso 2 — 🖊 Ver qué está pendiente ANTES de aplicar nada

**Este es el paso importante de todo el documento.** `db push` **no aplica solo la 062**: aplica
**todo lo que el ledger tenga pendiente**, en orden. Hay que mirar la lista antes.

```bash
supabase migration list --linked
```

**Qué ver si salió bien:** una tabla `Local | Remote | Time`. Las filas con `Local` lleno y
`Remote` vacío son **las pendientes**.

### La regla, y por qué acá importa de verdad

> **Si aparece cualquier pendiente que NO sea la `062` → PARÁ. No pushees.** Lo revisa Ismael y
> se decide qué se aplica.

No es una precaución teórica. Según ESTADO.md §c, el ledger de staging llegaba hasta la **058**, y
en el repo hay migraciones posteriores cuyo estado no está anotado ahí:

| Mig | Qué es | Estado conocido |
|---|---|---|
| `059_derivar_work_days` | BioTime F1d — deriva horas a `work_days` | Aplicada (el header de la 060 dice "ledger real de staging, última = 059") |
| `060_pago_idempotente` | Salarios U0b — el pago de la quincena no se duplica | Probable, sin confirmar en los docs |
| `061_employee_hora_habitual` | Salarios Capa 3 — hora habitual del empleado | **Sin confirmar** |
| `062_pos_ndf_ingesta` | **Lo de este documento** | Pendiente (recién creada) |

**Lo más probable es que aparezcan la `061` y la `062` como pendientes.** Las dos son aditivas,
pero **la 061 no es de este trabajo** y aplicarla de rebote es exactamente lo que este paso está
para impedir. Es decisión de Ismael, no del que corre el comando.

### Confirmación adicional antes de escribir

```bash
supabase db push --dry-run
```

**Qué ver si salió bien:** el listado de lo que aplicaría — y que sea **exactamente** lo que se
decidió en el punto anterior. Si nombra algo más, volver a parar.

**Si el `migration list` falla por drift** (el remoto tiene versiones que el repo no tiene, o al
revés): **no repares nada por tu cuenta.** `repair --status applied` sobre una migración que no
creó sus columnas la marca aplicada **sin haberla aplicado** (ESTADO.md §c lo tiene documentado
como error real). Eso es una sesión aparte, con Ismael.

---

## Paso 3 — 🖊 Aplicar la migración

Solo si el Paso 2 dio verde y con la firma de Ismael.

```bash
cat supabase/.temp/project-ref      # SÍ, otra vez. Es el ritual.
echo "y" | supabase db push
```

(`db push` pregunta `[Y/n]`; el `echo "y"` lo responde sin abrir un prompt interactivo.)

**Qué ver si salió bien:**

```
Applying migration 062_pos_ndf_ingesta.sql...
Finished supabase db push.
```

Y después, en el **SQL Editor del proyecto de staging** (Dashboard → `satori-staging`):

```sql
-- 1. Las cuatro tablas existen
select table_name from information_schema.tables
where table_schema = 'public' and table_name like 'pos_ndf%'
order by 1;
-- esperado: pos_ndf_cursor · pos_ndf_open · pos_ndf_ticket_lines · pos_ndf_tickets

-- 2. La columna nueva de employees
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'employees' and column_name = 'pos_login';
-- esperado: 1 fila. (Sin backfill: todos los empleados quedan con pos_login = null.)

-- 3. RLS: cuatro policies de SELECT, todas por rol
select tablename, policyname, cmd, qual
from pg_policies where tablename like 'pos_ndf%' order by 1;
-- esperado: 4 filas, cmd = SELECT, qual con get_my_role() in ('owner','manager','contador')
-- ⚠ si alguna dijera "true" o el rol fuera "authenticated", NO es esta migración.

-- 4. Que no haya policies de escritura (la escritura es solo del service-role)
select count(*) from pg_policies where tablename like 'pos_ndf%' and cmd <> 'SELECT';
-- esperado: 0
```

**Si algo de esto no da:** no sigas al paso 4. La función escribiría contra tablas que no están
como se espera.

**Anotar en `ESTADO.md` §c** que la `062` quedó aplicada a staging (y la fecha), como se hizo con
las 055–058.

---

## Paso 4 — 🖊 Secreto y deploy de la Edge Function

### 4.1 El secreto

Tiene que ser **largo, aleatorio y DISTINTO del `INGEST_SECRET` de BioTime**. Si se reusa, quien
tenga el de BioTime puede escribir ventas.

```bash
supabase secrets set POS_INGEST_SECRET="$(openssl rand -base64 48)" \
  --project-ref hwiatgicyyqyezqwldia
```

**Guardá el valor** en el momento de generarlo: lo vas a necesitar para el `curl` del paso 5 y
para el `.env` de la PC del PoS. Después no se puede volver a leer.

```bash
# Para verlo una vez y copiarlo:
SECRETO="$(openssl rand -base64 48)"
echo "$SECRETO"
supabase secrets set POS_INGEST_SECRET="$SECRETO" --project-ref hwiatgicyyqyezqwldia
```

**Qué ver si salió bien:** `Finished supabase secrets set.` y

```bash
supabase secrets list --project-ref hwiatgicyyqyezqwldia | grep POS_INGEST_SECRET
```

muestra el nombre con su digest (nunca el valor).

### 4.2 El deploy

```bash
supabase functions deploy ingest-ndf \
  --project-ref hwiatgicyyqyezqwldia \
  --no-verify-jwt
```

`--no-verify-jwt` es a propósito: el que llama es un proceso headless en la PC del PoS, sin sesión
de Supabase. El portón es el secreto compartido, igual que en `ingest-punches`. **Si se despliega
sin ese flag**, el gateway exige además `Authorization: Bearer <anon key>` y el agente falla con
401 sin decir por qué.

**Qué ver si salió bien:** `Deployed Function ingest-ndf` y la función listada en
Dashboard → Edge Functions con fecha de hoy.

**Si el deploy se queja de un import fuera de `supabase/functions/`:** es el import de
`../../../src/shared/ndf/ingestNdf.ts`, que existe a propósito para no duplicar la lógica. La
salida lo dice explícitamente. **La solución es actualizar el CLI**, no copiar el módulo adentro
(ver la nota final de `supabase/functions/ingest-ndf/README.md`: dos copias de la regla del vuelto
es justo el bug que la Fase 1a cerró).

---

## Paso 5 — Humo del ingest, sin el agente

Probar la función sola, antes de instalar nada en la PC del PoS. El payload completo está en
**`supabase/functions/ingest-ndf/README.md`** (generado con el mapper real); acá va uno mínimo
equivalente.

```bash
REF=hwiatgicyyqyezqwldia
SECRETO='<el POS_INGEST_SECRET del paso 4>'

curl -s -X POST "https://$REF.supabase.co/functions/v1/ingest-ndf" \
  -H "content-type: application/json" \
  -H "x-ingest-secret: $SECRETO" \
  -d '{
    "local": "santa-teresa",
    "tickets": [{
      "numero_factura": "HUMO-1",
      "fecha_registra": "2026-09-01T19:42:07-06:00",
      "fecha": "2026-09-01", "hora": "19:42:07",
      "estado": "C", "canal": "salon", "area": "SALON 1",
      "usuario_registra": "026", "salonero_login": "026", "salonero_nombre": "MAXO",
      "salonero": "MAXO", "registrado_por": "salonero", "login_cajero": "222",
      "turno": "noche", "con_servicio": true, "imp_servicio": 1200,
      "pedidos": 1, "saloneros_varios": false,
      "pax": 2, "pax_nativo": 0, "pax_articulo": 2, "pax_alerta": "falta_nativo",
      "total": 12000, "total_fuente": "provisorio",
      "medios": { "efectivo": 15000, "tarjeta": 0, "monto_electronico": 0, "deposito": 0,
                  "cheque": 0, "cuenta_cobrar": 0, "dolares_efectivo": 20,
                  "dolares_tarjeta": 0, "vuelto": 3000 },
      "comida": 12000, "bebida": 0, "unidades_comida": 2, "unidades_bebida": 0,
      "cortesias": 0, "duenos": 0, "mesa": "12", "numero_pedido": "4477",
      "items": [{ "codigo": "100", "nombre": "ROLL SATORI", "cantidad": 2, "monto": 12000,
                  "imp_servicio": 1200, "familia": 2, "familia_nombre": "SUSHI",
                  "categoria": "comida", "es_pax": false, "es_extra": false, "es_cortesia": false }]
    }],
    "open": [{ "clave": "pedido:HUMO", "id_pedido": "HUMO", "mesa": "14",
               "salonero_login": "027", "canal": "salon", "pax": 4,
               "pax_alerta": "falta_articulo", "updated_at": "2026-09-01T20:05:00-06:00" }],
    "cursor": { "last_factura": "HUMO-1" }
  }' | jq
```

**Qué ver si salió bien:**

```json
{ "ok": true, "local": "santa-teresa", "tickets_recibidos": 1, "tickets_guardados": 1,
  "lineas_guardadas": 1, "open_guardadas": 1, "open_borradas": 0,
  "invalid": 0, "recalculados": 0, "problemas": [],
  "cursor": { "local": "santa-teresa", "last_factura": "HUMO-1", ... } }
```

Y en el SQL Editor de staging:

```sql
select numero_factura, fecha_registra, canal, salonero_login, registrado_por, turno,
       con_servicio, servicio_crc, pax, pax_alerta, total_crc, vuelto_crc, dolares_efectivo
from pos_ndf_tickets order by ingested_at desc limit 5;
```

Lo que tiene que decir esa fila, y **por qué**:

| Columna | Valor | Por qué |
|---|---|---|
| `total_crc` | **12000** | 15.000 de efectivo **menos** 3.000 de vuelto. El Edge lo recalcula: si dijera 15.000, el vuelto no se restó. |
| `dolares_efectivo` | 20 | Se guarda pero **no** suma al total (el PoS ya convirtió a colones). |
| `con_servicio` / `servicio_crc` | `true` / 1200 | Es lo que parte el día en con 10% / sin 10%. |
| `pax` / `pax_alerta` | 2 / `falta_nativo` | El pax salió del artículo 677: el mesero no cargó *Personas*. |

**La verificación de zona horaria** — la lección del desfase de BioTime:

```sql
select numero_factura,
       fecha_registra,
       fecha_registra at time zone 'America/Costa_Rica' as hora_pared_cr
from pos_ndf_tickets where numero_factura = 'HUMO-1';
-- hora_pared_cr TIENE que decir 2026-09-01 19:42:07 — la hora que muestra el PoS.
-- Si dice 13:42 o 01:42, el instante entró corrido y hay que parar.
```

### Idempotencia (correr el mismo `curl` dos veces)

```sql
select count(*) from pos_ndf_tickets where numero_factura = 'HUMO-1';   -- 1, no 2
select count(*) from pos_ndf_ticket_lines;                              -- 1, no 2
select * from pos_ndf_cursor;                                           -- 1 fila, last_error null
```

### Que el portón esté cerrado

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  "https://$REF.supabase.co/functions/v1/ingest-ndf" \
  -H 'content-type: application/json' -d '{"local":"santa-teresa","tickets":[]}'
# esperado: 401
```

### Limpiar el ticket de humo

```sql
delete from pos_ndf_tickets where numero_factura = 'HUMO-1';   -- las líneas caen por cascade
delete from pos_ndf_open where clave = 'pedido:HUMO';
update pos_ndf_cursor set last_factura = null where local = 'santa-teresa';
```

> El `update` del cursor importa: si queda `'HUMO-1'`, el agente arranca creyendo que ya sincronizó
> hasta ahí. `HUMO-1` no es un número, así que el agente lo descarta al normalizarlo — pero es más
> limpio dejarlo en null.

---

## Paso 6 — 🖊 El agente en la PC del PoS (`DESKTOP-25PRDR1`)

**Instalación limpia:** esa PC **no tiene BioTime** (el agente de BioTime vive en la PC del reloj
de Santa Teresa). Acá se instala todo desde cero.

### 6.1 Node

Instalar **Node 22.18 o superior** desde https://nodejs.org (versión LTS). El agente usa el
type-stripping nativo de Node — sin `tsx`, sin build.

```powershell
node --version    # v22.18.0 o mayor
```

### 6.2 El código

Con git, o copiando la carpeta desde un pendrive/red:

```powershell
cd C:\satori
git clone https://github.com/CachoSatori/satori-app.git
cd satori-app
git checkout deploy/pos-bridge-staging
```

**Sin git:** copiar la carpeta del repo **sin `node_modules`** y verificar que estén
`pos-bridge\`, `src\shared\ndf\` y `package.json`.

### 6.3 Dependencias

Dos `npm install`: el de la raíz y el de `pos-bridge` (que trae el driver `mssql`).

```powershell
npm install
cd pos-bridge
npm install
cd ..
```

### 6.4 El `.env`

```powershell
copy pos-bridge\.env.example pos-bridge\.env
notepad pos-bridge\.env
```

Completar:

```
POS_DB_HOST=DESKTOP-25PRDR1\SQLNUBE
POS_DB_PORT=1433
POS_DB_DATABASE=ndf
POS_DB_USER=ClienteConsulta
POS_DB_PASSWORD=<clave de ClienteConsulta>
POS_DB_ENCRYPT=false
POS_DB_TRUST_CERT=true

LOCAL=santa-teresa
ENV=staging
INGEST_URL=https://hwiatgicyyqyezqwldia.supabase.co/functions/v1/ingest-ndf
INGEST_SECRET=<el POS_INGEST_SECRET del paso 4>
```

- `ClienteConsulta` es de **solo lectura** (`db_datareader`). **`ciosa` no se usa jamás**: el
  agente aborta si aparece en el `.env`.
- `ENV=staging` no es decorativo: con cualquier otro valor el agente **no arranca** sin la firma
  `POS_AGENTE_PROD_FIRMADO`.
- El `.env` está en el `.gitignore`. **No se manda por WhatsApp ni por mail.**

### 6.5 Primero el dry-run de un día (sin escribir nada)

Antes del agente, el extractor solo. No toca Supabase:

```powershell
npm run pos:dia -- 2026-09-01
```

**Qué ver si salió bien:** el reporte del día con `Venta total ₡`, `con 10%`, `sin 10%`, la venta
por salonero y el detalle por factura. Si acá falla, el problema es la conexión al PoS o un nombre
de columna — y el error dice cuál y cómo forzarlo desde el `.env`. **No sigas al agente hasta que
este comando funcione.**

### 6.6 El agente, a mano, mirando el log

```powershell
npm run pos:agente
```

**Qué ver si salió bien** — una línea por ciclo:

```
[2026-09-05T18:00:00.000Z] agente pos-ndf arriba · local=santa-teresa · entorno=staging · ingest=hwiatgicyyqyezqwldia.supabase.co · poll 75s/300s · ventana 36h
[2026-09-05T18:00:00.500Z] PoS (solo lectura): DESKTOP-25PRDR1:1433/ndf · usuario ClienteConsulta · encrypt=false · trustCert=true
[2026-09-05T18:00:01.000Z] saludo · cursor guardado=(vacío)
[2026-09-05T18:00:04.000Z] cerradas=37 guardadas=37 abiertas=4 cursor=5218
[2026-09-05T18:01:19.000Z] cerradas=1 guardadas=1 abiertas=5 cursor=5219
```

- El **saludo** sale una sola vez, al arrancar: lee el cursor guardado.
- El primer ciclo real trae todo lo de la ventana (36 h). Los siguientes traen solo lo nuevo.
- `abiertas=N` sube y baja con las mesas del salón.
- Ni la clave del PoS ni el secreto aparecen en ninguna línea. Si los ves, **pará y avisá**.

**Si en vez de eso ves:**

| Línea | Qué pasa | Qué hacer |
|---|---|---|
| `error_pos · ECONNREFUSED …SQLNUBE:1433 · cursor=… (no avanza)` | No llega al SQL Server | Ver que el PoS esté prendido y el puerto 1433 abierto. El agente reintenta solo. |
| `error_envio · ingest-ndf rechazó el lote (401)` | El `INGEST_SECRET` no coincide | Copiar de nuevo el secreto del paso 4. |
| `error_envio · ingest-ndf rechazó el lote (400)` | `local` inválido o body mal armado | Revisar `LOCAL` en el `.env`. |
| `no se pudo arrancar: ABORTADO: ENV="…"` | El `.env` no dice `staging` | Es el candado. Corregir el `.env`. |
| `no se pudo arrancar: … esquema de ndf no coincide` | Un nombre de columna distinto | El error dice cuál y el `POS_COL_*` que lo fuerza. |

Dejalo un rato corriendo y mirá que el cursor avance. `Ctrl+C` lo corta limpio.

### 6.7 Servicio de Windows (recién cuando el paso 7 haya cuadrado)

**Programador de tareas** (Task Scheduler), mismo método que el agente BioTime:

- Acción: `Iniciar un programa`
- Programa: `C:\Program Files\nodejs\node.exe`
- Argumentos: `--import ./pos-bridge/register.mjs pos-bridge/agente.ts`
- Iniciar en: `C:\satori\satori-app`
- Marcar **Ejecutar aunque el usuario no haya iniciado sesión** y **Reiniciar si falla**
- Disparador: **Al iniciar el equipo**

El agente solo sale con código ≠ 0 si **no pudo arrancar**; los errores de ciclo no lo matan, así
que el "reiniciar si falla" solo se dispara ante un problema real de configuración.

---

## Paso 7 — 🖊 El cuadre (criterio de aceptación)

Con un día completo ya ingestado, en el SQL Editor de **staging**:

```sql
-- Reemplazar la fecha. El borde del día va en hora de Costa Rica (-06), no en UTC.
select
  count(*)                                             as tickets,
  sum(total_crc)                                       as total,
  sum(total_crc) filter (where con_servicio)           as con_10,
  sum(total_crc) filter (where not con_servicio)       as sin_10,
  sum(servicio_crc)                                    as servicio_10,
  sum(pax)                                             as pax
from pos_ndf_tickets
where local = 'santa-teresa'
  and fecha_registra >= timestamptz '2026-09-01 00:00:00-06'
  and fecha_registra <  timestamptz '2026-09-02 00:00:00-06';
```

**Qué tiene que dar:** `total`, `con_10` y `sin_10` **iguales** a "Ventas Netas por Día" del PoS
para esa fecha. Ese es el cuadre **primario**.

Segundo check, la venta por mesero:

```sql
select coalesce(salonero_login, '(' || registrado_por || ')') as quien,
       count(*) as tickets,
       sum(total_crc) as total,
       sum(total_crc) filter (where con_servicio) as con_10
from pos_ndf_tickets
where local = 'santa-teresa'
  and fecha_registra >= timestamptz '2026-09-01 00:00:00-06'
  and fecha_registra <  timestamptz '2026-09-02 00:00:00-06'
group by 1 order by total desc;
```

Las facturas de los cajeros `111`/`222` y las de sistema aparecen en su propia línea
(`(cajero)`, `(sistema)`, `(sin_pedido)`): **cuentan en el total del día** pero no se le acreditan
a ningún mesero.

**El contraste que vale doble:** el mismo día leído por los dos caminos tiene que dar igual.

```powershell
npm run pos:dia -- 2026-09-01     # en la PC del PoS: lee el PoS directo, no la base
```

Si el dry-run y el `select` de arriba coinciden, y los dos coinciden con el reporte de Nube, el
puente está validado.

**Si NO cuadra**, mirar en este orden:

1. **La línea del cajero** — ¿el reporte del PoS incluye esas facturas? Deberían estar en los dos.
2. **`invalid` / `recalculados`** en la respuesta del agente y `pos_ndf_cursor.last_error`.
3. **Facturas sin detalle** — su `servicio_crc` queda en 0 y caen del lado "sin 10%".
4. **El borde del día** — si el `where` se escribe sin el `-06`, se corre 6 horas y se mezclan dos
   días.

```sql
select * from pos_ndf_cursor where local = 'santa-teresa';
-- last_error null = el último lote entró limpio.
-- last_poll_at reciente = el agente está vivo.
```

---

## Rollback

| Qué | Cómo |
|---|---|
| **Parar el agente** | `Ctrl+C`, o deshabilitar la tarea en el Programador. Es lo primero y alcanza para frenar todo: sin agente no entra un solo dato. |
| **La función** | `supabase functions delete ingest-ndf --project-ref hwiatgicyyqyezqwldia`. Queda inerte si simplemente no se llama. |
| **El secreto** | `supabase secrets unset POS_INGEST_SECRET --project-ref hwiatgicyyqyezqwldia` → la función pasa a responder **401 a todo** (fail-closed). Es el corte más rápido. |
| **Los datos** | `delete from pos_ndf_tickets where local = 'santa-teresa';` (las líneas caen por cascade) + `delete from pos_ndf_open;` + `delete from pos_ndf_cursor;`. **Solo en staging.** |

**La migración no tiene rollback automático** (`db push` no revierte). Las cuatro tablas son
nuevas y **ninguna pantalla de la app las lee todavía**, así que dejarlas puestas no rompe nada:
el rollback real es parar el agente. Si aun así hay que sacarlas, es un SQL a mano **solo contra
staging** y con firma — y hay que borrar además su fila del ledger
(`supabase_migrations.schema_migrations`) para poder re-aplicarla después.

🚫 **Nunca `repair --status reverted`** sobre algo que sí se aplicó: le miente al ledger.

---

## Lo que este documento NO autoriza

- ❌ **Mergear a `staging` o a `main`.** La rama se entrega para revisión. `main` **auto-aplica a
  producción**.
- ❌ **Tocar el proyecto de prod** (`yiczgdtirrkdvohdquzf`) en ningún paso.
- ❌ **Apuntar el agente a producción.** `ENV=staging`, y el candado pide firma explícita para
  cualquier otra cosa.
- ❌ **`db push` con pendientes ajenas.** Si el Paso 2 muestra algo que no es la `062`, se para.
- ❌ **Escribir en el PoS.** El agente solo hace `SELECT`, con `assertSoloSelect` antes de cada
  sentencia y con un usuario que solo tiene `db_datareader`.

## Para el que viene después

| | |
|---|---|
| La migración | `supabase/migrations/062_pos_ndf_ingesta.sql` |
| La función y su payload | `supabase/functions/ingest-ndf/README.md` |
| El extractor y el agente | `pos-bridge/README.md` |
| La lógica de dominio | `src/shared/ndf/mapTicket.ts` (pura, con tests) |
| El contrato del payload | `src/shared/ndf/ingestNdf.ts` (puro, con tests) |
| Ritual del ref y ledger | `ESTADO.md` §a y §c · `_handoff/INTEGRACION-SUPABASE.md` |
