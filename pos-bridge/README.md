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
   - los **dólares** y el **vuelto**, que se imprimen aparte: el total es la suma de los
     medios de pago **en colones** y `total_fuente` dice `provisorio` justamente hasta que
     una factura con efectivo + dólares se verifique a mano.

## Las reglas que aplica (y por qué)

| Tema | Regla |
|---|---|
| Facturas del día | `Estado='C'` y `FechaRegistra` dentro del día. `X` (anulada) **no suma**; `R` se ignora y se reporta. |
| Total | `Efectivo + Tarjeta + MontoElectronico + Deposito + Cheque + CuentaCobrar`, con `COALESCE(...,0)`. **No** suma dólares (el PoS ya los convirtió) y **no** resta el vuelto: los tres se imprimen igual. |
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
