# PoS Bridge — agente local (Analítica PoS · **Fase A: esqueleto**)

Espeja `tools/biotime-bridge/`, que ya corre en producción en la PC del reloj. La idea es que
cablear esto sea llenar tres huecos, no escribir un agente.

> ## ⚠ Este agente NO se conecta a nada
>
> Todavía **no tenemos permiso de lectura** sobre la base `ndf` del PoS (SQL Server), y la
> Edge Function `ingest-ventas` **no existe**. El agente compila y corre, pero cada ciclo
> avisa que está en Fase A y se va a dormir. No abre ninguna conexión.
>
> No lo instales en una PC de local todavía.

## Qué va a hacer (cuando esté cableado)

Un proceso por local. Cada 2 minutos lee las cuentas **cerradas** nuevas del PoS y las empuja
a Supabase. No calcula nada: ni mix, ni ticket promedio, ni promedio por pax — eso se deriva
después, del lado de la app.

### El objetivo: reemplazar el import manual de xls

Este feed **no introduce un modelo nuevo**. Tiene que terminar produciendo exactamente lo que
hoy produce el import manual:

```
ventas_dias.data = DiaData = {
  fileName, uploadedAt,
  saloneros: { "<nombre>": SaloneroDay | CajeroDay }
}
```

(ver `src/shared/types/ventas.ts` y `src/modules/ventas/xlsParser.ts`)

…más el **detalle que solo existe en vivo** — el ritmo por hora —, que el xls no puede dar
porque trae el día entero sin repartir.

Con eso, la pestaña «En vivo» de Ventas y todas las pestañas de siempre leen la misma cosa, y
el día que esto ande, el import de xls deja de hacer falta sin que ninguna pantalla cambie.

**El agente transporta, no agrega.** Manda las cuentas cerradas una por una; la agregación a
`SaloneroDay` / `CajeroDay` (sumar por mesero, separar comida de bebida, contar pax) la hace
la Edge Function del lado del servidor, igual que hoy la hace `xlsParser` del lado del
navegador.

- **El PoS nunca se escribe.** Usuario de solo lectura, y el único SQL del agente es un SELECT.
- **Solo sale, nunca entra.** El agente abre la conexión hacia Supabase; no abre ningún puerto
  en la PC ni hace falta tocar el router.
- **Un agente por local.** Dos PCs, dos `.env`, con distinto `LOCAL`.

## Qué falta cablear

Tres huecos, en este orden. Todos están marcados con `⚠ TODO CABLEAR` en el código.

### 1. La consulta real — `src/fetchVentas.ts` → `FETCH_SQL`

Hoy es una plantilla con nombres inventados. Necesita el esquema real de `ndf`:

- ¿Cuál es la tabla de cuentas y cuál su PK incremental?
- ¿Cómo se marca una cuenta **cerrada**? (Una cuenta abierta cambia de monto: si se empuja y
  después se modifica, la base queda con un número que ya no existe.)
- ¿Cuál es el campo **nativo de comensales**? Es el que decide si el `promedio por pax`
  significa algo — ver `CalidadPax` en `src/modules/ventas/ventasEnVivoTypes.ts`.
- ¿Hay un identificador de mesero por cuenta?

> **Lección cara del biotime-bridge (sep-2026).** El supuesto «el id crece con el tiempo» no
> siempre vale: aparecieron marcas más nuevas con id más bajo que el corte y quedaron
> invisibles para siempre al `WHERE id > lastId`. Se perdieron cuatro días de fichajes.
> Cuando se escriba la consulta real, va **además** una red por tiempo:
> `WHERE id > @lastId OR fecha_cierre >= @desde` con una ventana móvil de algunos días.
> Reenviar un puñado de filas por ciclo no cuesta nada; perder un día de ventas sí.

### 2. El mapeo de campos — `src/fetchVentas.ts` → `PosRow` y `mapRow`

Los nombres reales de las columnas y su traducción a nuestro modelo. **Este es el único lugar
donde la forma del PoS existe**: de acá para arriba nadie sabe cómo se llaman sus columnas, y
por eso cambiar de PoS mañana no toca la pantalla.

Tres cosas que no se pueden aplastar en el mapeo:

- **El artículo `PAX` no es un producto.** En el xls el pax viaja como una línea llamada `PAX`
  y `xlsParser` la saca del mix. Si el PoS lo trae como artículo, va a `SaloneroDay.pax`,
  nunca a `prods` — si se cuela, infla las unidades del mix y encabeza «lo que más se vendió».
- **`pax: null` ≠ `pax: 0`.** «No se cargó el comensal» es distinto de «vinieron cero
  personas», y esa diferencia es justamente lo que mide el indicador de calidad del pax. Hoy
  `xlsParser` descarta al salonero entero cuando falta el pax, o sea que un pax mal cargado se
  ve como alguien que no trabajó.
- **El mesero se casa por CÓDIGO, nunca por nombre.** Casar por nombre ya produjo drift real
  en BioTime (SPEC §9). Ojo: en `DiaData` la clave de `saloneros` **es el nombre**, así que el
  puente código → nombre lo tiene que resolver el edge antes de escribir.

### 3. El destino — `src/pushVentas.ts` + la Edge Function

`pushVentas` está completo y espeja `pushIngest` del biotime-bridge, incluidas sus decisiones
de manejo de error. Falta la función del otro lado. Cuando exista, tiene que:

- validar con un **secreto compartido** (`x-ingest-secret`), no con JWT: el que llama es un
  proceso headless sin sesión;
- insertar con **clave única `(local, pos_id)`** y `on conflict do nothing`, para que
  reenviar nunca duplique;
- **agregar las cuentas al `DiaData` del día** y escribirlo en `ventas_dias`, con la misma
  forma que produce `xlsParser` (esa agregación es el corazón de la Fase B);
- devolver los contadores `received / inserted / duplicates / unmapped / invalid`.

### Y además — `src/db.ts` → `createDb` y `checkEsquema`

La conexión está escrita y comentada. Al descomentarla, mirar el comentario sobre `useUTC`:
un `datetime` de SQL Server **no lleva zona horaria**, y las dos opciones del driver son una
trampa (una corre las ventas 6 horas, la otra las deja a merced de cómo esté configurada la
PC). Por eso `normalizarInstante` estampa el offset de Costa Rica —**UTC−6 FIJO, sin horario
de verano**— a mano, en vez de confiar en el driver.

`checkEsquema` tiene que dejar en el log, en cada arranque: el tipo real de la columna de
fecha, la última venta tal cual está en el PoS, el instante que se va a enviar, y la hora en
que se verá en la app. Esas tres líneas juntas convierten un desfase silencioso en algo que se
ve en un minuto — en BioTime, sin eso, un error de una hora pasó semanas invisible.

## Instalación (cuando llegue el momento)

1. Node 20 o superior.
2. Copiar la carpeta a la PC, por ejemplo en `C:\satori\pos-bridge`.
3. `npm install`
4. Copiar `.env.example` a `.env` y completar `POS_PASSWORD` e `INGEST_SECRET`.
   El `.env` **no va al repo** (ya está en el `.gitignore`) y no se manda por WhatsApp ni por mail.
5. `npm run build`
6. Programador de tareas de Windows apuntando a `start-bridge.bat`, disparador «al iniciar el
   equipo». El `.bat` hace el `cd` solo y manda la salida a `bridge.log`.

## Los archivos

```
src/config.ts       lee y valida el .env
src/db.ts           conexión a SQL Server (mssql) — ESQUELETO, no conecta
src/fetchVentas.ts  el SELECT incremental + fila -> nuestro modelo — STUB
src/pushVentas.ts   POST a la Edge Function ingest-ventas — completo, sin destino
src/state.ts        last_id por local (escritura atómica)
src/index.ts        el loop
```

## Estado

| Pieza | Estado |
|---|---|
| Loop, estado, corte incremental | ✅ completo (copiado del biotime-bridge) |
| Manejo de error del empuje | ✅ completo |
| Config y validación del `.env` | ✅ completo |
| Conexión a SQL Server | ⚠ escrita y comentada — falta el permiso de lectura |
| Consulta real | ❌ plantilla con nombres inventados |
| Mapeo de campos | ❌ falta el esquema de `ndf` |
| Edge Function `ingest-ventas` | ❌ no existe |
| Agregación cuentas → `DiaData` | ❌ va en el edge (Fase B) |
| Persistencia del ritmo por hora | ❌ TBD dónde se guarda |
