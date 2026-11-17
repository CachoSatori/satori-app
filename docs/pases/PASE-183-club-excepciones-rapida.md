# Pase a PROD de la mig 183 `club_excepciones_rapida` (origen club 128)

> **⛔ Firma SQL para prod (esquema).** Firma del dueño por el chat, 16-nov-2026 21:40 -06:00: arreglar la lentitud de
> `club_excepciones_abiertas`, el contador de excepciones del Club que llama el Inicio. En los logs de prod: hasta 9,3 s,
> media 1,5 s en 71 llamadas y un 500 por timeout el 16-nov a las 14:34 CR (`authenticated` tiene `statement_timeout`
> de 8 s). El merge necesita el OK del dueño sobre el SHA exacto. Si algo no coincide, **se para y se avisa**.
>
> - **Vía:** merge → Branching. No se aplica nada a mano.
> - **Orden obligatorio:** va **después de la 181 y de la 182** (entran el 16-nov a las 23:31). La 183 exige el núcleo de
>   excepciones de la 181 (md5 `94cf0df9d0b189322b27d4d8b208a3e0`). Si no lo encuentra, aborta **sin tocar nada**
>   (probado en local con el núcleo de la 155).
> - **Regla del ledger:** exactamente 1 fila `183` con su `name`.
> - **Responsables:** ejecución = el merge (Branching); control = una persona distinta de quien mergea (lecturas de §2 y §3).

## 1. Diagnóstico (16-nov, prod solo lectura; EXPLAIN ANALYZE en staging, mismo volumen)
- `club_excepciones_abiertas` (SQL, SECURITY DEFINER) **no tiene lógica propia**: cuenta las filas no resueltas que
  devuelve `club_excepciones` → `club_excepciones__nucleo` (las 22 verificaciones). **Todo el costo está en el núcleo**,
  no en el conteo.
- Tablas (prod): `pos_ndf_tickets` 41 mil filas (23 MB), `pos_ndf_ticket_lines` 231 mil (47 MB), `club_movimientos` 2,7 mil.
  Prod: `shared_buffers` 224 MB, `work_mem` 2 MB, sin JIT.
- **Cuello 1 (en frío): la ventana de facturas (CTE `tk`).** Filtra por `coalesce(fecha_registra, fecha_cierra)`, una
  expresión que ningún índice cubre: recorre **todas** las facturas del local en cada llamada (seq scan, ~470–600 ms con la
  caché fría; con la caché caliente ~10 ms). Esto explica los picos de prod.
- **Cuello 2 (siempre): DESCUENTO_SIN_RESPALDO, regla del «cambio de lista».** Una subconsulta por candidata recorre el CTE
  `ddia` entero (~570 candidatas × ~3.500 filas ≈ 2 M filas): ~230 ms por llamada aunque todo esté en memoria.
- Advisors de performance de prod: nada sobre estas tablas o funciones (solo FKs sin índice en otras tablas, RLS initplan y
  políticas múltiples, ajenos a esto).

## 2. Qué cambia y qué no
- **Índice nuevo** `pos_ndf_tickets_local_fecha_efectiva_idx` sobre `(local, coalesce(fecha_registra, fecha_cierra))`: es
  la MISMA expresión del filtro de `tk`, así que el planificador lo usa sin tocar la consulta. Le sigue un `analyze` de la
  tabla para que el planificador tenga las estadísticas de la expresión (sin ellas, en staging siguió con seq scan). Armarlo
  toma menos de un segundo con 41 mil filas. Durante ese segundo el puente espera para insertar y no pierde nada.
- **Núcleo** (`club_excepciones__nucleo`), **dos fragmentos exactos** con guarda de md5 antes (181) y después (`bd1b4d15…`),
  igual que hizo la 181: `ddia` pasa a una fila por (artículo, día) con sus precios y conteos en arreglos, y se cruza con un
  `left join` en vez de una subconsulta por candidata. La cuenta es la misma: Σ ventas con precio ≤ precio×1,001 / Σ ventas,
  sobre las mismas filas. Sin filas da NULL y la candidata no pasa, igual que antes.
- **No cambia:** `club_excepciones_abiertas` (md5 `3c3c963d…`), el envoltorio `club_excepciones` (`7e0b7ae5…`), los permisos
  (EXECUTE de `authenticated` en el envoltorio y el contador, núcleo cerrado, `anon` afuera), SECURITY DEFINER,
  `search_path`, el resto de las verificaciones, los textos, la app y los sagrados. No toca datos ni Edge.
- **Por qué no un «conteo directo» aparte:** duplicaría las 22 verificaciones (~400 líneas). Con el próximo cambio del
  núcleo, el número del Inicio podría dejar de coincidir con la lista de Excepciones. Acelerar el núcleo acelera también
  la lista de Excepciones y las alertas del Inicio que lo usan.

## 3. Antes y después (staging, datos reales de Santa Teresa, 16-nov)
| Medida | Antes (181) | Después (183) |
|---|---|---|
| `club_excepciones_abiertas(30, 'santa-teresa')`, 5 llamadas seguidas | 474 / 447 / 443 / 441 / 442 ms | 192 / 186 / 184 / 185 / 190 ms |
| EXPLAIN ANALYZE del núcleo (30 días, todas las verificaciones) | 1.480 ms (planificación 97 ms) | 210 ms (planificación 14 ms) |
| CTE `tk` | Seq Scan, 598 ms (frío) | Index Scan `pos_ndf_tickets_local_fecha_efectiva_idx`, 5 ms |
| Regla del cambio de lista (`dcand k` con su subconsulta) | 231 ms (570 pasadas por `ddia`) | sin pasadas: lo que queda es armar `dpr` (≤ 54 ms) |
| Primera llamada en frío (staging, antes) | 1.697 ms | n/m (en prod: hasta 9,3 s → se espera < 0,5 s) |

Resultado **idéntico**: 1.424 filas del núcleo (Santa Teresa, Nosara y «sin local» × 7/30/90 días) y todos los conteos de
`club_excepciones_abiertas` (owner, manager de prueba, contador, salonero × 1/7/30/90/null días × cada local) iguales antes,
después y tras el rollback. Contador a 30 días de Santa Teresa en staging: 78 antes y 78 después.

**Hallazgo (preexistente, no lo causa la 183):** DESCUENTO_SIN_RESPALDO muestra **una** línea por factura
(`distinct on (factura) order by factura, precio/referencia`). Si varias líneas empatan en ese cociente (un mismo % aplicado
a toda la factura), cuál sale como ejemplo es arbitrario y depende del plan. **Hoy ya cambia con solo crear el índice, sin
tocar el núcleo** (6 filas de 1.424 en staging). La excepción, su `ref`, el %, la clasificación y el conteo son los mismos.
Solo puede cambiar el artículo de ejemplo (artículo, nombre, precio, referencia y monto de esa línea). La batería compara
todo salvo esos cinco campos de ese tipo (`pg_temp.norm`). Si se quiere un ejemplo estable, se agrega un desempate (p. ej.
por artículo) en un PR aparte: es una **decisión del dueño**, porque cambia qué línea se muestra hoy.

## 4. Antes del merge (prod, solo lectura, `begin read only` … `rollback`)
- Ledger: última versión = **182** (la 181 y la 182 ya entraron). Si no, **no se mergea**.
- `md5(pg_get_functiondef('public.club_excepciones__nucleo(date,date,text,text)'::regprocedure))` = `94cf0df9d0b189322b27d4d8b208a3e0`.
- `to_regclass('public.pos_ndf_tickets_local_fecha_efectiva_idx')` = null.
- Anotar, como owner (`set_config('request.jwt.claims', …)`), `club_excepciones_abiertas(30, 'santa-teresa')` y
  `count(*)` de `club_excepciones(hoy-30, hoy, 'santa-teresa')`. Ese número es el que el Inicio muestra.

## 5. Después del merge (prod, solo lectura)
- Ledger: exactamente 1 fila `183` / `club_excepciones_rapida`; check «Supabase Preview» en success.
- Núcleo md5 = `bd1b4d15e6ec6453d540c59b61d80d76`; contador `3c3c963df0468e7843e0bbd5e5547cbc` y envoltorio
  `7e0b7ae5c466b5885de3b8d7547381f5` sin cambio.
- `pg_indexes`: `pos_ndf_tickets_local_fecha_efectiva_idx` = `(local, COALESCE(fecha_registra, fecha_cierra))`.
- Permisos: `has_function_privilege('authenticated', …abiertas…, 'execute')` = true; `anon` = false; núcleo para
  `authenticated` = false.
- Humo: los dos números de §4 **iguales** (si entró una factura nueva en el medio, repetir las dos lecturas juntas).
- Tiempo: el mismo llamado varias veces, con `clock_timestamp()` en un bloque `do` o en `begin read only`. Se espera
  < 0,5 s. En los logs de la API, `club_excepciones_abiertas` sin 500 y con una media muy por debajo de 1,5 s.

## 6. Criterio de parada y vuelta atrás
- Si el ledger no está en 182, o el núcleo no tiene el md5 de la 181: **no se mergea** (la 183 abortaría igual sin tocar nada).
- Si después el número del Inicio no coincide con el de antes: se para y se corre la vuelta atrás.
- **Vuelta atrás exacta:** `scripts/sql/183_rollback.sql`. Exige el md5 de la 183 y deshace **solo** los dos fragmentos
  (vuelve a `94cf0df9…`). Después hace `drop index if exists public.pos_ndf_tickets_local_fecha_efectiva_idx` y borra la
  fila `183` del ledger. **En el mismo momento**, un PR que saca `supabase/migrations/183_club_excepciones_rapida.sql` de
  `main`: si queda, Branching la vuelve a aplicar (regla 10). No hay datos que volver: el resultado es el mismo antes y después.
- Probada: en local (aplicar + rollback reales: md5 `94cf0df9…`, sin índice) y en la batería (caso 07). En staging, dentro
  de una transacción descartada: el núcleo vuelve al md5 de la 181 y las 1.424 filas y todos los conteos son iguales a los
  de antes. (El `drop index` del rollback no se pudo correr en staging por la herramienta; en local sí).

## 7. Pruebas
- `scripts/sql/183_pruebas.sql` (runner `183_pruebas.py`), ANTES de aplicar, en una transacción descartada. Datos
  ficticios: dos locales, la regla del cambio de lista justo en el borde del 60 % y en la tolerancia de 0,1 %, una
  excepción resuelta y un descuento clasificado que no cuenta. Compara antes / después / rollback, todas las columnas, en
  cada local, sin local y 7/30/90 días. Además: el contador como owner, manager, cajero y `authenticated` real; permisos;
  que el plan use el índice; y el tiempo.
  - Postgres 16 local (todas las migraciones + 181 + 182): **8/8**.
  - Mutaciones (`--mutar todas`), **5/5 muerden**: `umbral_sin_tolerancia` (caen 01–04, 07), `cuenta_por_filas` (01–04, 07),
    `join_sin_dia` (01–04, 07), `sin_indice` (05) y `rollback_deja_indice` (07).
- Staging (ref `hwiatgic…`): la herramienta de SQL cancela sola las sentencias que escriben en tablas (insert/update/delete,
  aun dentro de una transacción descartada), así que la batería con datos ficticios no corrió ahí. Lo que sí corrió, en
  transacciones descartadas: la 183 + la foto con **datos reales** antes/después/rollback (§3) y EXPLAIN ANALYZE.
  **Aplicada en staging el 16-nov a las 22:04 CR** con su fila del ledger (staging: 181, 182, 183). Lo que se aplicó son
  las sentencias del archivo, con comentarios recortados fuera de la función (el md5 del núcleo es el mismo).

## 8. Firma y bitácora
| Cuándo (-06:00) | Quién | Qué |
|---|---|---|
| 2026-11-16 21:40 | dueño | Firma el arreglo (diagnóstico + migración nueva + staging) |
| 2026-11-16 22:04 | sesión | 183 aplicada en staging (ledger staging 183) |
| | dueño | Firma SQL para prod sobre el SHA: ________ |
| | control | §4 antes / §5 después |
