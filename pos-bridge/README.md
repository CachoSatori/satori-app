# pos-bridge — extractor del PoS "Nube de Fuego" (Fase 1a)

Lee, **en solo lectura**, las ventas cerradas de un día en la base `ndf` del PoS y las
imprime desglosadas como el Excel (con 10% / sin 10%) para poder **cuadrar el día contra
la planilla**. Nada más: no escribe en el PoS, no habla con Supabase, no toca la app.

> **Dónde se corre:** en la **PC del PoS (`DESKTOP-25PRDR1`)** o desde otra máquina con un
> **túnel abierto** hasta `SQLNUBE`. El clon del repositorio en la nube **no tiene red a esa
> máquina**, así que el `SELECT` nunca se probó desde ahí: la primera corrida real es la de
> Ismael. Por eso el extractor primero le pregunta a la base qué columnas tiene y, si algo no
> calza, lo dice con nombre y apellido en vez de morir con un "Invalid column name".

## Qué produce

La forma `DiaData` — la misma que produce `src/modules/ventas/xlsParser.ts` con el `.xls`
diario — más un dry-run que imprime:

- **Venta total ₡ · con 10% · sin 10%** ← el cuadre primario contra el Excel
- facturas por estado (`C` cuentan · `X` anuladas no suman · `R` se ignoran)
- por turno de caja (mañana `111` / noche `222`)
- **venta por salonero**, y aparte la línea **"registrado por cajero (111/222)"**
- mix por categoría (comida / bebida / lo que no es ingreso)
- pax con sus **tres** valores: nativo, artículo y alerta
- detalle factura por factura

## Instalación (una sola vez, en la PC del PoS)

1. Instalar **Node 22.18 o superior** (https://nodejs.org — la versión LTS).
2. Traer el repo a la PC (o solo esta carpeta, ver *"Sin el repo entero"* más abajo).
3. Desde la raíz del repo:

   ```
   npm install
   cd pos-bridge && npm install && cd ..
   ```

4. Copiar `pos-bridge/.env.example` a `pos-bridge/.env` y completar la contraseña:

   ```
   POS_DB_HOST=DESKTOP-25PRDR1\SQLNUBE
   POS_DB_PORT=1433
   POS_DB_DATABASE=ndf
   POS_DB_USER=ClienteConsulta
   POS_DB_PASSWORD=<la clave de ClienteConsulta>
   ```

   > ⚠️ El `.env` tiene la clave. **No se manda por WhatsApp ni por mail, y no va al
   > repositorio** (ya está en el `.gitignore`). El usuario administrador del PoS (`ciosa`)
   > **no se usa jamás**: el bridge aborta si aparece en el `.env`.

## Correrlo

```bash
npm run pos:dia -- 2026-09-01              # resumen + detalle por factura
npm run pos:dia -- 2026-09-01 --sin-detalle
npm run pos:dia -- 2026-09-01 --json > dia.json   # el DiaData crudo
```

También se puede correr desde esta carpeta: `npm run dia -- 2026-09-01`.

**No escribe nada.** Solo imprime en pantalla (lo que se redirige a un archivo lo redirige
quien corre el comando).

## Cómo cuadrar el día contra el Excel

1. Correr `npm run pos:dia -- <la fecha del Excel>`.
2. Comparar, en este orden:
   1. **Venta total ₡** y el par **con 10% / sin 10%** ← si esto cuadra, el resto es afinar.
   2. **Venta por salonero**.
3. Si el total no cuadra, mirar primero:
   - la línea **"registrado por cajero (111/222)"** (esas facturas cuentan en el día pero no
     se le acreditan a ningún mesero),
   - **facturas sin detalle** en los avisos del pie (su 10% queda en 0 y caen del lado
     "sin 10%"),
   - los **dólares**, que se imprimen aparte y **no** se suman (el PoS ya los convirtió a
     colones); `total_fuente` dice `provisorio` justamente hasta que una factura con
     efectivo + dólares se verifique a mano.

## Las reglas que aplica (y por qué)

| Tema | Regla |
|---|---|
| Facturas del día | `Estado='C'` y `FechaRegistra` dentro del día. `X` (anulada) **no suma**; `R` se ignora y se reporta. |
| Total | `Efectivo + Tarjeta + MontoElectronico + Deposito + Cheque + CuentaCobrar − Vuelto`, con `COALESCE(...,0)`. El **vuelto se resta**: el cuadre contra el reporte oficial del PoS (*Ventas Netas por Día*, 1-sep-2026) mostró que `Efectivo` viene con el vuelto adentro. Los dólares **no** se suman (el PoS ya los convirtió) pero se imprimen igual. |
| Servicio 10% | `con_servicio` = `SUM(ImpS del detalle) > 0`. Con 10% = consumo en salón · sin 10% = delivery/llevar. Es lo que parte el día como en el Excel. |
| Salonero | `FAC_Pedidos.UsuarioRegistra` (login: `023` Esteban, `024` Juancho, `025` Dolores, `026` MAXO, `027` GUILLE, `028` FRANCISCO). El join es por `NumeroFactura` — **nunca** por `Facturas.NumeroPedido`, que viene vacío en mesa. `Facturas.Login` (el cajero que cobró) es informativo y **no pisa** al salonero. |
| Cajeros `111` / `222` | No son saloneros. Sus facturas **cuentan en el total** pero van a su línea aparte: `111` = turno mañana, `222` = turno noche. Con `ImpS > 0` es "favor a salón"; con `ImpS = 0`, delivery/cajero. **No se adivina el mesero por la mesa.** |
| `022` | Figura como "cajero turno tarde" en el maestro, pero puede ser un usuario viejo: hasta confirmarlo se trata como salonero y sale **marcado** en el reporte. |
| Sistema | `002` (cocina express), `01` y `02` (bajas): fuera del breakdown de mesero, **nunca** fuera del total. |
| Turno | Lo deciden `111`/`222`. Si registró un salonero, se deriva de la hora (corte a las 16:00, provisorio). Sirve para saber quién tenía la caja, **no** para inventar el mesero. |
| Pax | `pax_nativo` = `Pedidos.Personas` (hoy 0 en toda la base) · `pax_articulo` = `qty(677)×1 + qty(678)×2`. **Nunca se suman**: manda el nativo cuando está. El reporte muestra siempre los tres (nativo, artículo, alerta). |
| Mix | Comida `2,3,4,6,13,16` · bebida `5`. Fuera del ingreso: `19 A PAX`, `20 Ingredientes`, `22 EXTRAS`, `12 Gift Cards` y merch `21,23,24,26,27`. Aparte (no son venta): `17 Cortesías` y `28 Dueños`. Las líneas marcadas `EsExtra`/`Compuesto` no inflan las unidades. |
| Factura sin pedido | Histórico 2024: `salonero = null`, `pax = 0`. Se tolera y se reporta. |
| Zona horaria | Los `datetime` del PoS son **naive = hora de Costa Rica**. Vienen del `SELECT` ya convertidos a **texto** (`CONVERT(..., 120)`) y no se pasan por ninguna zona: es la misma lección del desfase de 1 hora de BioTime. |
| `NumeroFactura` | **Siempre string.** Es un decimal y `Number` pierde precisión arriba de 2^53. |

## Si el esquema no calza

El extractor resuelve cada columna contra una lista de candidatos. Si no encuentra una, el
error dice qué falta, qué columnas hay de verdad y cómo forzar la buena desde el `.env`:

```
· FAC_FacturasDet.monto (monto de la línea): ninguno de Monto / MontoTotal / Total / SubTotal existe.
    columnas reales: NumeroFactura, CodigoProducto, Cantidad, Importe, ImpS, ImpV
    forzalo con  POS_COL_FACTURASDET_MONTO=<nombre real>  en el .env
```

Las tablas `FAC_Empleados` y `FAC_Clasificaciones` son opcionales: si no están (o el usuario
no las puede leer), el extractor sigue sin ellas — los saloneros salen por login y el mix
por número de familia.

## Seguridad

- **Read-only por partida triple:** el usuario del `.env` es `ClienteConsulta`
  (`db_datareader`), cada sentencia pasa por `assertSoloSelect` antes de salir a la red, y no
  existe en el bridge ningún camino que arme un `INSERT`/`UPDATE`/DDL.
- **Consultas livianas:** filtro por fecha con rango sargable, sin `SELECT *`.
- **No se leen blobs** (`FacturaXML`, `FacturaPDF`, `XMLHacienda`) **ni PII de delivery**
  (`Telefono`, `Direccion`, `NombreCliente`, `Lat`, `Long`).
- La contraseña vive solo en el `.env` y **nunca** se imprime (el encabezado del dry-run
  muestra servidor, base y usuario, nada más).

## Sin el repo entero

`mapTicket.ts` vive en `src/shared/ndf/` a propósito: es el módulo **puro** que va a reusar
el Edge de ingesta (A2) sin reescribirse. Por eso esta carpeta necesita el repo al lado. Si
hiciera falta correrlo suelto en la PC del PoS, copiar el repo completo (son unos pocos MB
sin `node_modules`) y hacer los dos `npm install`.

## Para el técnico

```
config.ts       lee y valida el .env (y bloquea al usuario admin)
esquema.ts      resuelve los nombres de columna contra INFORMATION_SCHEMA
consulta.ts     los tres SELECT + filas crudas -> facturas mapeadas   (sin driver)
sqlGuard.ts     el candado read-only
db.ts           el pool de mssql/tedious (ÚNICO archivo que importa el driver)
extraerDia.ts   extraerDia(fecha) -> DiaData[]  ·  extraerDiaDetalle() para el dry-run
reporte.ts      el desglose del día y su formato de consola            (puro)
dia.ts          el CLI

../src/shared/ndf/mapTicket.ts   la lógica de dominio, PURA y reusable en A2/A3
```

Los tests (`*.test.ts`) corren con el vitest del repo (`npm test` desde la raíz) y **no**
necesitan base de datos: el SQL, el mapeo y el reporte se prueban con filas sintéticas.

Typecheck del extractor: `cd pos-bridge && npm run typecheck`.

## Qué NO hace esta fase

Cero Supabase, cero migración, cero Edge, cero UI y cero escritura. Las tablas y el Edge de
ingesta (A1 + A2) vienen **después** de que un día real cuadre contra el Excel.

---

# El agente (A3)

El mismo extractor, pero en loop y empujando a Supabase. Corre **en la PC del PoS**, lee las
ventas nuevas y las mesas abiertas cada minuto y pico, y se las manda al Edge `ingest-ndf`
(A2), que las guarda en `pos_ndf_*` (mig 062).

```
npm run pos:agente        # desde la raíz del repo
npm run agente            # desde pos-bridge/
```

> **Apunta a STAGING.** El `.env` trae `ENV=staging` y el agente **aborta** con cualquier otro
> entorno salvo que se firme explícitamente (`POS_AGENTE_PROD_FIRMADO=<fecha>`). Primero se
> valida un día real comparando `pos_ndf_*` de staging contra el reporte del PoS; recién
> después se habla de producción.

## Qué hace cada ciclo

1. **Saludo (solo al arrancar).** Manda un lote vacío y el Edge le devuelve el cursor
   guardado: por ahí sigue. Como no manda `cursor` ni `open`, el Edge no toca nada.
2. **Cerradas nuevas.** `Estado='C'` con `NumeroFactura` mayor al cursor, dentro de la ventana
   reciente (36 h por defecto: cubre el turno que cruza la medianoche y un reinicio).
3. **Abiertas.** `FAC_Pedidos` sin factura todavía → el snapshot. El Edge **borra** las que no
   vinieron, así que la mesa que se cerró desaparece sola.
4. **Envía** `{ local, tickets, open, cursor }` y avanza el cursor **con lo que el Edge
   confirmó**, no con lo que el agente propuso.

Una línea de log por ciclo:

```
[2026-09-01T20:10:00.000Z] saludo · cursor guardado=5000
[2026-09-01T20:11:15.000Z] cerradas=2 guardadas=2 abiertas=1 cursor=5002
[2026-09-01T20:12:30.000Z] error_pos · ECONNREFUSED DESKTOP-25PRDR1\SQLNUBE:1433 · cursor=5002 (no avanza)
[2026-09-01T20:13:45.000Z] cerradas=0 guardadas=0 abiertas=0 cursor=5002
```

## Ritmo

| | |
|---|---|
| En operación (10:00–02:00 CR) | cada **75 s** — la mesa abierta tiene que verse casi en vivo |
| De madrugada | cada **300 s** — el PoS no factura; machacarlo no aporta nada |

Configurable: `POLL_OPERACION_MS`, `POLL_MADRUGADA_MS`, `HORA_APERTURA`, `HORA_CIERRE`.
La ventana cruza la medianoche a propósito (abre 10, cierra 2).

## Qué pasa cuando algo falla

El agente **no se cae nunca** por un ciclo malo: un proceso que muere a las 2 de la mañana no
se entera nadie hasta el otro día.

| Situación | Qué hace |
|---|---|
| **PoS apagado** o sin red local | No inventa el día. Manda un lote vacío solo para dejar el motivo en `pos_ndf_cursor.last_error` (que se vea en la base, no solo en esta consola), no toca las mesas abiertas y reintenta el próximo ciclo. |
| **Supabase caído** o 5xx | Un reintento a los 3 s; si sigue, el cursor **no avanza** y el próximo ciclo relee y reenvía. El `(local, numero_factura)` de la base hace que reenviar nunca duplique. |
| **401 / 400 del Edge** | No reintenta: el secreto equivocado o un body mal armado no se arreglan repitiendo. Se ve en el log el primer ciclo. |
| **El Edge descartó una factura** | El cursor queda en la última que el Edge confirmó, así que esa factura se vuelve a mandar. |
| **Se pierde el estado** (reinicio de la PC) | No pasa nada: el cursor vive en Supabase, no en un archivo local. El saludo lo recupera. |
| **`FAC_Pedidos` sin `NumeroPedido`** | Sin clave estable no hay snapshot confiable: manda `open` **ausente** y el Edge no toca las mesas abiertas (mejor no saber que borrar mesas vivas). |

## `.env` del agente

Sobre el `.env` del extractor (`POS_DB_*`, ver arriba) se agregan:

```
LOCAL=santa-teresa
ENV=staging
INGEST_URL=https://<ref>.supabase.co/functions/v1/ingest-ndf
INGEST_SECRET=<el POS_INGEST_SECRET que cargó Ismael en Supabase>
```

El secreto es el **mismo** que se cargó con `supabase secrets set POS_INGEST_SECRET=…`, y es
distinto del de BioTime. Viaja en el header `x-ingest-secret`, siempre por **https** (el agente
aborta si `INGEST_URL` no es https). El `.env` no va al repo y no se manda por WhatsApp.

## Dejarlo corriendo siempre (Windows)

Mismo método que el agente BioTime en esa PC — **Programador de tareas** (Task Scheduler):

- Acción: `Iniciar un programa`
- Programa: `C:\Program Files\nodejs\node.exe`
- Argumentos: `--import ./pos-bridge/register.mjs pos-bridge/agente.ts`
- Iniciar en: `C:\satori\satori-app` (la carpeta del repo en esa PC)
- Marcar *Ejecutar aunque el usuario no haya iniciado sesión* y *Reiniciar si falla*
- Disparador: `Al iniciar el equipo`

El agente solo sale con código ≠ 0 si **no pudo arrancar** (config incompleta, entorno no
habilitado): ahí el Programador lo marca como fallido y lo reintenta. Los errores de ciclo no
lo matan. `Ctrl+C` lo corta limpio: termina el ciclo en curso y cierra la conexión.

Si estuvo apagado un rato no se pierde nada: al volver, el saludo recupera el cursor y la
ventana de 36 h cubre lo que pasó mientras tanto.

## Orden de puesta en marcha

1. Aplicar la **mig 062** en staging (crea las tablas).
2. `supabase secrets set POS_INGEST_SECRET=…` y `supabase functions deploy ingest-ndf --no-verify-jwt`.
3. Completar el `.env` en la PC del PoS y correr `npm run pos:agente` **a mano**, mirando el log.
4. Cuadrar `pos_ndf_tickets` de staging contra el reporte del PoS del mismo día.
5. Recién ahí, dejarlo como tarea programada.

## Archivos del agente

```
configAgente.ts   el .env del agente + el candado de STAGING
ventana.ts        hora CR, ritmo del poll y ventana de lectura       (puro)
factura.ts        comparación de NumeroFactura decimal como string   (puro)
consultaAgente.ts las dos lecturas: cerradas incrementales y abiertas (sin driver)
pushIngest.ts     POST a ingest-ndf, con un reintento
ciclo.ts          la decisión de un ciclo, con los puertos inyectados (puro)
agente.ts         el loop
```

`ciclo.ts` no toca ni la base ni la red: las tres operaciones con el mundo entran como puertos.
Por eso el ciclo entero —el saludo, el avance del cursor, el PoS apagado, Supabase caído— se
prueba con mocks, que es lo único validable desde el repo: la PC del PoS es la única máquina
con red al PoS y a Supabase a la vez.

---

# El backfill histórico (A4)

El segundo camino, **en paralelo al agente en vivo**: trae el histórico de ventas cerradas a
`pos_ndf_tickets` / `pos_ndf_ticket_lines` de staging, día por día, agrupando el log por mes.

```
npm run pos:backfill -- --desde 2026-08-05 --hasta 2026-09-03
npm run pos:backfill -- --desde 2026-07-01 --hasta 2026-07-31     # mes a mes hacia atrás
npm run pos:backfill -- --desde 2026-09-01 --hasta 2026-09-03 --dry-run
npm run pos:backfill -- --todo                                     # desde la venta más vieja hasta AYER
```

| Opción | |
|---|---|
| `--desde` / `--hasta` | El rango, inclusive. Es el modo principal: permite ir mes a mes y **retomar tras un corte**. |
| `--todo` | Descubre `min(FechaRegistra)` de las cerradas y barre hasta **ayer** (hoy lo cubre el agente). |
| `--dry-run` | Lee y cuenta, **no envía**. Para sondear un tramo viejo antes de cargarlo. |
| `--orden asc` | Del más viejo al más reciente. Por defecto va **al revés**. |
| `--pausa-ms N` | Pausa entre días (default 500; 300–800 es lo sano para no machacar el SQL Server). |

**Va del más reciente al más viejo a propósito:** si el barrido se corta a la mitad, lo que ya
entró es lo último —que es lo que se está cuadrando— y no un pedazo suelto de 2024.

## No hay que parar el agente

El lote del backfill lleva **solo `{ local, tickets }`**:

- **sin `open`** — `open: []` le borraría a staging las mesas abiertas de HOY. Ausente, el Edge
  no toca `pos_ndf_open`.
- **sin `cursor`** — ni siquiera `{ last_error: null }`: eso le limpiaría al agente un error
  recién escrito. Ausente, el Edge **lee** la fila para devolverla y **no la escribe**:
  `last_factura`, `last_error` y `last_poll_at` quedan como los dejó el agente.

> ⚠️ Esa última parte **es un cambio en la Edge Function** (`ingest-ndf`): antes, un lote sin
> `cursor` igual pisaba `last_poll_at`. **Hay que redesplegarla antes de correr el backfill.**
> Para el agente en vivo no cambia nada: él siempre manda `cursor`.

Reingestar un ticket ya guardado no duplica (upsert por `(local, numero_factura)`) y el detalle
se reemplaza entero, así que tampoco duplica líneas. **Re-correr un rango es seguro** — es la
forma de retomar después de un corte.

## Cómo se ve

```
[…] backfill pos-ndf · local=santa-teresa · entorno=staging · ingest=hwiatgic….supabase.co
[…] rango 2026-08-28 … 2026-09-02 · 6 día(s) · orden reciente-primero · pausa 500 ms
[…] el agente en vivo NO se toca: el lote va sin 'open' y sin 'cursor'.
[…]  ── 2026-09 · 2 día(s) ──
[…]    2026-09-02  tickets=38 guardados=38 líneas=173
[…]    2026-09-01  tickets=41 guardados=41 líneas=190
[…]  2026-09 · días=2 (vacíos 0) · tickets=79 guardados=79 · líneas=363 · errores=0 · 2026-09-01…2026-09-02
[…]  ── 2026-08 · 4 día(s) ──
[…]    2026-08-31  tickets=29 guardados=29 líneas=131
[…]    ⚠ 2026-08-30 · 2 factura(s) sin pedido (histórico): salonero null y pax 0.
[…]    2026-08-30  tickets=44 guardados=44 líneas=201
[…]    2026-08-29  sin ventas
[…]    2026-08-28  ✖ ECONNREFUSED DESKTOP-25PRDR1\SQLNUBE:1433
[…]  2026-08 · días=4 (vacíos 1) · tickets=73 guardados=73 · líneas=332 · errores=1 · 2026-08-30…2026-08-31
[…] TOTAL · días=6 (vacíos 1) · tickets=152 guardados=152 · líneas=695 · errores=1 · 2026-08-30…2026-09-02
```

**Un día que falla no frena el barrido**: se anota, se sigue, y al final el proceso sale con
código ≠ 0 para que se vea. La cura es re-correr **ese** rango (reenviar no duplica). Un tramo
viejo raro —saloneros reciclados, sin artículo de pax, una columna que no estaba— sale como
aviso y no cuesta el resto del histórico.

## Archivos

```
backfillPlan.ts   args, enumeración de días, tramos mensuales y contadores   (puro)
backfill.ts       el barrido con los puertos inyectados + el CLI
```

`correrBackfill` recibe los puertos (leer un día, enviar, pausar, loguear), así que el barrido
entero —el orden, los tramos, el día roto, la idempotencia y **la forma exacta del payload**— se
prueba con mocks sin tocar el PoS ni Supabase.
