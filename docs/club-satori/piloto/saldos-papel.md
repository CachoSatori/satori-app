# Carga de saldos de las tarjetas de papel (y la carga única del lanzamiento)

> Decisión del dueño (08-nov): «Tu saldo de la tarjeta de papel pasa a tu portal». (09-nov) El dueño hace **UNA sola
> carga al lanzar**, desde una **fuente limpia** que consolida todo (los créditos de la página vieja y las tarjetas de
> papel), con **la fecha de carga para todos**, sobre la **base del Club vacía** y **sin borrar nada en prod**.
> **Nada contra prod desde esta sesión:** en prod va con el paquete del pase y la firma (G-56, RUNBOOK §12).

## A. La carga única del lanzamiento (el camino del dueño)
1. **La fuente limpia** son dos archivos, fuera del repo:
   - el **export de la página vieja** (Firestore), depurado por el dueño (es lo que lee el migrador);
   - el **CSV de papel con `legacy_id`**: `legacy_id,personas,fecha_tarjeta,referencia`. El `legacy_id` es el id del
     anfitrión en la página vieja: los códigos del Club todavía no existen (nacen en esta carga).
2. **Chequeo de 12 meses sin actividad, SOBRE LA FUENTE y antes de cargar.** Con la fecha de carga, una cuenta o una
   tarjeta sin actividad desde hace más que el vencimiento volvería a contar los 12 meses el día del lanzamiento. Por eso
   el migrador **frena** (sale con error) si hay alguna, en la página vieja (`inactivos.csv`: legacy_id, personas y última
   actividad, sin nombres) o en el papel (línea, referencia y meses). El dueño las decide en la fuente; si decide
   cargarlas igual, pasa `--acepto-inactivos N` con el **número exacto** (si cambia la fuente, cambia el número y vuelve a
   frenar).
3. **Ensayo en staging** (no deja nada: vacía el Club **dentro** de la transacción, solo en una base marcada como staging,
   y termina en ROLLBACK):
   ```
   python3 -I scripts/club/migrar_firestore.py --export <export> --local <id> --primera-carga --papel <papel.csv> \
     --ensayo --vaciar-para-ensayo
   ```
4. **Emitir para prod** (no conecta): `… --primera-carga --papel <papel.csv> --emitir <carpeta fuera del repo>` →
   `carga.sql` (0600, tiene datos personales: nunca al repo ni por chat) y `resumen.json` (conteos y el **sha256** del
   SQL: es lo que firma el dueño). En prod, una sola transacción:
   - precondición **«cero socios»**: si hay **cualquier** fila en `club_miembros`, `club_movimientos`, `club_negocios` o
     `club_cargas_papel`, aborta entero. **No hay ningún `delete`** (el script se niega a emitir si apareciera uno);
   - los anfitriones y los créditos de la página vieja (origen `migracion`), **todos con la fecha de la carga**;
   - las tarjetas de papel (origen **`papel`**, por `legacy_id`), con su lock, su línea de base, el registro del lote y su
     validación (§B);
   - la validación de todo contra la fuente (el papel no se mezcla con el cuadre de la página vieja) y `commit` al final.

   **Lista cerrada del migrador** (`scripts/club/sql_g56.py`, `revisar_migrador`; análisis real, el mismo tokenizador
   que la carga de papel). `--emitir` se niega si el `carga.sql` no la pasa. Solo admite lo siguiente:
   - `begin`;
   - `set local statement_timeout|lock_timeout`;
   - `do $tag$ … $tag$`, con lo de siempre más `for <variable> in select … loop … end loop`;
   - `create temp table _<nombre> [(columnas)] on commit drop [as select|with …]`: temporales, sin esquema y con `_`
     adelante;
   - `insert into public.<tabla>` solo en las tablas que carga el migrador (`club_negocios`, `club_miembros`,
     `club_miembros_contacto`, `club_movimientos`, `club_pm_cargos`, `club_pm_pagos` y, con papel, `club_cargas_papel`),
     con `on conflict` solo como `do nothing`;
   - con papel, el `lock` de `club_cargas_papel`;
   - el `select <columna> from _<temporal>` final;
   - `commit`.

   Prohibido: `delete`, `truncate`, `update`, `alter`, `drop`, `execute`, cualquier `set` que no sea uno de los dos
   timeouts (tampoco `club.libro_mantenimiento` ni `session_replication_role`), `pg_*` (salvo tres catálogos de solo
   lectura que usa la validación: `pg_class`, `pg_namespace`, `pg_policies`), `dblink` y `lo_*`. Las barras invertidas
   dentro de literales (las regex de la normalización) se aceptan porque quien aplica exige
   `standard_conforming_strings = on`. El modo de staging del migrador (`--apply`, que borra) **no** pasa por esta lista:
   no es para prod.
4b. **Aplicar firmado** (G-56, modo PROD): `python3 -I scripts/club/migrar_firestore.py aplicar-firmado --archivo
   <carga.sql> --sha256 <el firmado> --ref <prod> --confirmo-ref <prod>`, con `CLUB_G56_PROD=si` en la consola. Hace,
   en orden:
   1. recalcula el sha256 (si no es el firmado, se niega);
   2. vuelve a pasar la lista cerrada;
   3. exige que sea el `carga.sql` (termina en `commit`, sin `delete`);
   4. verifica `standard_conforming_strings = on` en el servidor;
   5. lo manda tal cual.

   **Probado solo en staging:** allí la base no está vacía y la precondición «cero socios» lo frena sin escribir nada.
5. **Después de la carga**, el migrador **no vuelve a correr**: frena si encuentra una carga de papel (nunca la borra), y
   en prod la precondición «cero socios» lo frena igual.

## B. La carga de papel sola (por código del Club, en un local que ya tiene anfitriones)
1. **Plantilla:** `scripts/club/plantilla_saldos_papel.csv` (datos ficticios): `codigo_anfitrion` (el código de 8 de su QR),
   `personas` (entero 1–600: 6 personas = 1 crédito), `fecha_tarjeta` (AAAA-MM-DD, la última marca), `referencia`
   (el identificador de la tarjeta física, obligatorio). En la carga única, `legacy_id` en vez de `codigo_anfitrion` (§A).
2. **Validar** (el archivo real va fuera del repo):
   `python3 scripts/club/migrar_firestore.py saldos-papel --csv <archivo> --local <id> --validar`. Con un solo error se
   rechaza entero (línea y motivo, sin repetir el contenido): código o `legacy_id` mal formado, personas fuera de rango,
   fecha futura o mal escrita, referencia vacía, columnas de más o de menos, filas duplicadas y la misma tarjeta dos
   veces. Con la fecha de carga, **frena** también por las tarjetas de más de 12 meses sin actividad (§A.2).
3. **Emitir** (no conecta): `… --emitir <carpeta fuera del repo>` → `carga.sql`, `ensayo.sql` (el mismo, con ROLLBACK) y
   `resumen.json` (filas, anfitriones, personas, créditos, **clave del lote** y sha256; sin códigos ni referencias).
4. **Lo que hace el SQL** (una transacción):
   1. `lock_timeout` 5 s y `statement_timeout` 5 min;
   2. **`lock table public.club_cargas_papel in exclusive mode`** (Grok 109): dos sesiones a la vez se ponen en fila; la
      segunda espera y recién ahí mira la línea de base;
   3. precondiciones que abortan: el local existe; el entorno es el esperado (prod: sin la marca de staging); **línea de
      base:** ninguna carga de papel de este local ni de este lote; todos los anfitriones activos del local;
   4. el **registro del lote** en `club_cargas_papel` (un local, una carga; la clave del lote = sha256 de las filas
      canónicas, única: el mismo archivo no entra dos veces, ni en otro local; la tabla es de solo inserción);
   5. `insert into public.club_movimientos` (tipo `tarjeta`, **origen `papel`**, nota «saldo tarjeta de papel ·
      <referencia> · tarjeta AAAA-MM-DD»);
   6. la validación de filas y personas de **origen `papel` del local**, y `commit`.
5. **Filtro G-56 = análisis real del SQL** (`scripts/club/sql_g56.py`), al emitir y otra vez antes de aplicar: un
   tokenizador como el de Postgres (literales con `''`, `E'…'`, `"identificadores"`, `$tag$…$tag$`, comentarios `--` y
   `/* */` anidados) y una **lista cerrada** de sentencias: `begin`, `set local lock_timeout|statement_timeout`, el `lock`
   de arriba, `do $tag$ … $tag$` (dentro: `declare`, `if … then … end if`, `raise exception`, `select … into`), `insert`
   solo en `club_movimientos` y `club_cargas_papel`, y `commit`/`rollback` al final. Prohibido en cualquier lado:
   `execute`, `delete`, `update`, `truncate`, `drop`, `alter`, `grant`, `revoke`, `create`, `copy`, `perform`, `set`
   fuera de los dos timeouts, `session_replication_role`, `pg_…`, `dblink`, `lo_…`, y más. Los 4 archivos trucados de la
   auditoría (una comilla en un comentario que escondía un `delete`, `execute` dentro de un `do`, `set local
   session_replication_role` y un `insert` en `club_entorno`) son pruebas: los cuatro se rechazan.
6. **Modo PROD (G-56):** `python3 scripts/club/migrar_firestore.py saldos-papel --aplicar-firmado <carga.sql> --sha256
   <el firmado> --ref <prod> --confirmo-ref <prod>`, con `CLUB_G56_PROD=si` en la consola. Recalcula el sha256 (si no es
   el firmado, se niega), vuelve a pasar el filtro, exige que sea el `carga.sql` (termina en `commit`) y lo manda tal cual.
   **Se probó solo en staging:** el `carga.sql` de prod aplicado en staging aborta en «el entorno no es prod» sin escribir
   nada; contra prod sin las dos confirmaciones, se niega.
7. **Ensayo en staging** (anfitriones ficticios, termina en ROLLBACK):
   `python3 scripts/club/migrar_firestore.py saldos-papel --ficticios 6 --local <id> --ensayo`.
8. **Doble carga con Firestore (solo lectura, antes de cargar):** `… doble-carga-papel --export <export> --csv <saldos>
   --mapa <mapa>` (o `--mapa-staging`). Lista las tarjetas que ya están en la página vieja: mismo anfitrión, las mismas
   personas a ≤ 3 días. Sale 2 si hay alguna. En la carga única el mapa es directo (el CSV ya trae `legacy_id`).

## C. En la app
- La carga de papel tiene **su propio origen** (`papel`): el migrador nunca la borra.
- **No infla el reporte del mes:** las tarjetas de origen `papel` y `migracion` no cuentan como actividad del mes
  (tarjetas, personas, ranking, nuevos); salen aparte en `carga_inicial`. Sí suman al saldo.
- Con la fecha de carga, cuentan como actividad para el vencimiento desde el día de la carga.

## D. Pruebas
- `python3 -m unittest scripts/club/test_saldos_papel.py` (30), `scripts/club/test_sql_g56.py` (54: suma la lista
  cerrada del migrador, con 17 trucados) y `scripts/club/test_migrar_firestore.py` (16: suma `--emitir` que pasa la
  lista y `aplicar-firmado` que niega sin firma, sin confirmar prod, un ensayo o un trucado).
- Contra staging, sin dejar nada (`CLUB_ENSAYO_STAGING=1`, desde `scripts/club`): 111 en total. Papel +4:
  - ensayo;
  - dos veces en la misma transacción;
  - **dos sesiones a la vez**;
  - el modo PROD, que se niega en staging.

  Migrador +7:
  - primera carga que frena con la base llena;
  - primera carga sobre la base vaciada;
  - la carga única con papel en la misma transacción;
  - **la primera carga firmada aplicada con `aplicar-firmado`, que frena por «cero socios» sin escribir nada**.
