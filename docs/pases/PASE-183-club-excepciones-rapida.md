# Pase a PROD de la mig 183 `club_excepciones_rapida` (origen club 128)

> **⛔ Firma SQL para prod (esquema; roza plata: fija el monto que suma el reporte de descuentos).** Firma del dueño por el
> chat, 16-nov-2026 21:40 -06:00: arreglar la lentitud de `club_excepciones_abiertas`, el contador de excepciones del Club
> que llama el Inicio (logs de prod: hasta 9,3 s, media 1,5 s en 71 llamadas, un 500 por timeout el 16-nov 14:34 CR;
> `authenticated` tiene `statement_timeout` de 8 s). Revisión del verificador independiente (16-nov): desempate fijo de la
> línea ejemplo (§4), sin índice nuevo (§2) y humo del reporte de descuentos (§5–6). El merge necesita el OK del dueño
> sobre el SHA exacto. Si algo no coincide, **se para y se avisa**.
>
> - **Vía:** merge → Branching. No se aplica nada a mano.
> - **Orden obligatorio:** va **después de la 181 y de la 182** (entran el 16-nov 23:31). La 183 exige el núcleo de la 181
>   (md5 `94cf0df9d0b189322b27d4d8b208a3e0`) y que `pos_ndf_tickets.fecha_registra` sea NOT NULL. Si no, aborta **sin tocar
>   nada** (probados los dos casos en local).
> - **Regla del ledger:** exactamente 1 fila `183` con su `name`.
> - **Responsables:** ejecución = el merge (Branching); control = una persona distinta de quien mergea (lecturas de §5 y §6).

## 1. Diagnóstico (16-nov; prod solo lectura, EXPLAIN ANALYZE en staging con el mismo volumen)
- `club_excepciones_abiertas` (SQL, SECURITY DEFINER) **no tiene lógica propia**: cuenta las filas no resueltas que
  devuelve `club_excepciones` → `club_excepciones__nucleo` (las 22 verificaciones). **Todo el costo está en el núcleo.**
- Tablas (prod): `pos_ndf_tickets` 41 mil filas (23 MB), `pos_ndf_ticket_lines` 231 mil (47 MB). Prod: `shared_buffers`
  224 MB, `work_mem` 2 MB, sin JIT.
- **Cuello 1 (en frío): la ventana de facturas (CTE `tk`).** Filtra por `coalesce(fecha_registra, fecha_cierra)`. Ningún
  índice resuelve esa expresión, así que recorre **todas** las facturas del local en cada llamada (seq scan, ~600 ms en
  frío; ~10 ms en caliente). Ya existe `pos_ndf_tickets_local_fecha_idx (local, fecha_registra)`, pero no sirve para la
  expresión con `coalesce`.
- **Cuello 2 (siempre): DESCUENTO_SIN_RESPALDO, regla del «cambio de lista».** Una subconsulta por candidata recorre el CTE
  `ddia` entero (~570 candidatas × ~3.500 filas ≈ 2 M filas): ~230 ms por llamada aunque todo esté en memoria.
- Advisors de performance de prod: nada sobre estas tablas o funciones.

## 2. Qué cambia y qué no (todo en el núcleo: 4 fragmentos exactos, con guarda de md5 antes y después, como la 181)
1. **`tk` filtra por `fecha_registra`** en vez de por `coalesce(fecha_registra, fecha_cierra)`. Como `fecha_registra` es
   NOT NULL (en prod y en staging; la migración lo exige), es la misma condición. Escrita así usa el índice que **ya
   existe** `(local, fecha_registra)`. **No se crea ningún índice:** en staging, el índice de expresión de la primera
   versión y el existente dieron el mismo plan, las mismas páginas (832 y 835) y el mismo tiempo de la función (~174 ms).
   Sin índice nuevo no hay bloqueo de la tabla (el `create or replace function` no toca `pos_ndf_tickets`), ni
   `lock_timeout`, ni espacio extra.
2. y 3. **Regla del cambio de lista:** `ddia` pasa a una fila por (artículo, día) con sus precios y conteos en arreglos, y
   se cruza con un `left join` en vez de una subconsulta por candidata. La cuenta es la misma (Σ ventas con
   precio ≤ precio×1,001 / Σ ventas, sobre las mismas filas; sin filas → NULL → no pasa).
4. **Desempate fijo de la línea ejemplo** de DESCUENTO_SIN_RESPALDO (§4): a igual %, la de **mayor monto**; después,
   artículo, nombre, precio y cantidad.

**No cambia:** `club_excepciones_abiertas` (md5 `3c3c963d…`), el envoltorio `club_excepciones` (`7e0b7ae5…`),
`club_reporte_descuentos`, los permisos (EXECUTE de `authenticated` en el envoltorio y el contador, núcleo cerrado, `anon`
afuera), SECURITY DEFINER, `search_path`, el resto de las verificaciones, los índices, los datos, la app y los sagrados.
Las excepciones y el conteo son los mismos. Lo único que queda fijo es el ejemplo de las facturas con empate.

**Por qué no un «conteo directo» aparte:** duplicaría las 22 verificaciones (~400 líneas) y, con el próximo cambio del
núcleo, el número del Inicio podría dejar de coincidir con la lista de Excepciones.

## 3. Antes y después (staging, datos reales de Santa Teresa, 16-nov)
| Medida | Antes (181) | Después (183) |
|---|---|---|
| `club_excepciones_abiertas(30, 'santa-teresa')`, 5 llamadas seguidas | 441–474 ms | 174–176 ms |
| EXPLAIN ANALYZE del núcleo (30 días, todas las verificaciones) | 1.480 ms (planificación 97 ms) | ~200 ms (planificación 11–14 ms) |
| CTE `tk` | Seq Scan, 598 ms en frío | Index Scan `pos_ndf_tickets_local_fecha_idx`, ~1 ms |
| Regla del cambio de lista | 231 ms (570 pasadas por `ddia`) | sin pasadas |
| Excepciones y conteos (todos los roles, días y locales) | 1.424 filas | idénticas (normalizando solo el ejemplo de un empate, §4) |
| Contador a 30 días, Santa Teresa | 78 | 78 |

## 4. La línea ejemplo de DESCUENTO_SIN_RESPALDO y el reporte de descuentos
**El problema (preexistente):** DESCUENTO_SIN_RESPALDO deja **una** fila por factura: `distinct on (factura) order by
factura, precio/referencia`, o sea, la línea con mayor %. Si varias líneas empatan en ese %, cuál sale era arbitrario y
dependía del plan de ejecución. `club_reporte_descuentos` (Club → Marcadores) **suma el `descuento_crc` de esa línea**, así
que el total del reporte también dependía del plan.

Staging, Santa Teresa, 400 días (998 facturas con la excepción):
- 695 facturas tienen más de una línea con descuento sin respaldo; 105 tienen empate en el %; **17 empatan con montos
  distintos**.
- **Antes:** el mismo reporte con 4 juegos del planificador (por defecto, sin hash join, sin merge ni hash join, sin seq
  scan) dio **4 totales distintos**, separados hasta un 0,5 %. Con solo crear un índice ya cambiaba.
- **Después:** los 4 juegos dan **el mismo total** (md5 del reporte `974daa37`). Ese total queda **+0,72 %** sobre el que
  daba el plan por defecto, porque en las 17 facturas sale la línea de mayor monto. Es el máximo posible entre los empates
  (el mínimo posible era −0,17 %).
- La batería lo prueba con datos ficticios: la factura con empate muestra siempre la línea de ₡400 (no la de ₡200), y el
  reporte suma ₡600 con 8 juegos distintos del planificador (caso 08 y 09).

**Pregunta del verificador: ¿el reporte debería sumar todas las líneas con descuento sin respaldo, no solo el ejemplo?**
Diagnóstico, sin cambiar nada:
- El reporte suma **un monto por factura**: el de la línea con mayor %. El núcleo lo documenta como «monto estimado de la
  línea» (08-nov). No es el descuento total de la factura.
- Cuando un descuento se aplica a toda la factura (lo común: un % a la cuenta), todas las líneas cumplen la regla y el
  reporte toma una sola. En staging, la suma de **todas** las líneas que cumplen la regla es **2,94 veces** la del reporte
  (el reporte ve ~34 % del descuento sin respaldo). El conteo de facturas no cambia.
- **Recomendación:** si el reporte quiere decir «cuánta plata se fue en descuentos sin respaldo», debería sumar todas las
  líneas que cumplen la regla, con la clasificación de cada línea. Es un cambio de número que ve el dueño (y quizá del
  texto de Marcadores). Va en un PR aparte, con su decisión. **La 183 no lo cambia.**

## 5. Antes del merge (prod, solo lectura, `begin read only` … `rollback`)
- Ledger: última versión = **182** (la 181 y la 182 ya entraron). Si no, **no se mergea**.
- Núcleo md5 = `94cf0df9d0b189322b27d4d8b208a3e0`; `pos_ndf_tickets.fecha_registra` NOT NULL.
- Como owner (`set_config('request.jwt.claims', …)`), anotar:
  - `club_excepciones_abiertas(30, 'santa-teresa')`, el número del Inicio;
  - `count(*)` de `club_excepciones(hoy-30, hoy, 'santa-teresa')`;
  - del reporte de descuentos `club_reporte_descuentos(hoy-30, hoy, 'santa-teresa')`: `sum(facturas)` y
    `sum(descuento_crc)`.

## 6. Después del merge (prod, solo lectura)
- Ledger: exactamente 1 fila `183` / `club_excepciones_rapida`; check «Supabase Preview» en success.
- Núcleo md5 = `100caed16f137eda0888deec497f9103`. Contador `3c3c963df0468e7843e0bbd5e5547cbc` y envoltorio
  `7e0b7ae5c466b5885de3b8d7547381f5` sin cambio. `pg_indexes` de `pos_ndf_tickets` igual que antes (no hay índice nuevo).
- Permisos: `has_function_privilege('authenticated', …abiertas…, 'execute')` = true; `anon` = false; núcleo para
  `authenticated` = false.
- **Humo del contador:** los dos primeros números de §5, **iguales** (si entró una factura nueva en el medio, repetir las
  lecturas juntas).
- **Humo del reporte de descuentos:** `sum(facturas)` **igual** al de §5. `sum(descuento_crc)` igual o algo mayor
  (solo cambia en facturas con empate de % y montos distintos; en staging, +0,72 % a 400 días). Repetirlo dos veces
  seguidas debe dar el mismo número.
- Tiempo: el contador, varias veces, con `clock_timestamp()`. Se espera < 0,5 s. En los logs de la API,
  `club_excepciones_abiertas` sin 500 y con una media muy por debajo de 1,5 s.

## 7. Criterio de parada y vuelta atrás
- Si el ledger no está en 182, o el núcleo no tiene el md5 de la 181, o `fecha_registra` admite nulos: **no se mergea**
  (la 183 abortaría igual sin tocar nada).
- Si después el número del Inicio o las facturas del reporte no coinciden con los de antes: se para y se corre la vuelta atrás.
- **Vuelta atrás exacta:** `scripts/sql/183_rollback.sql`. Exige el md5 de la 183, deshace **solo** los 4 fragmentos
  (vuelve a `94cf0df9…`) y borra la fila `183` del ledger. **En el mismo momento**, un PR que saca
  `supabase/migrations/183_club_excepciones_rapida.sql` de `main` (si queda, Branching la vuelve a aplicar; regla 10).
  No hay datos ni índices que volver.
- Probada en local (aplicar + rollback reales: md5 `94cf0df9…`) y en la batería (caso 07).

## 8. Pruebas
- `scripts/sql/183_pruebas.sql` (runner `183_pruebas.py`), ANTES de aplicar, en una transacción descartada. Datos
  ficticios:
  - dos locales;
  - la regla del cambio de lista justo en el borde del 60 % y en la tolerancia de 0,1 %;
  - una excepción resuelta y un descuento clasificado que no cuenta;
  - una factura con empate de % y montos distintos;
  - una factura que se registra antes de la ventana y se cierra adentro.

  Compara antes / después / rollback, en cada local, sin local y a 7/30/90 días. También prueba: el contador como owner,
  manager, cajero y `authenticated` real; permisos; que `tk` use el índice existente y que no haya índices nuevos; el
  desempate y el reporte con 8 juegos del planificador; y el tiempo.
  - Postgres 16 local (todas + 181 + 182): **10/10**.
  - Mutaciones (`--mutar todas`), **5/5 muerden**:
    - `umbral_sin_tolerancia`, `cuenta_por_filas` y `join_sin_dia` (caen 01–04, 07 y otros);
    - `tk_usa_cierra` (01–05, 07);
    - `desempate_menor_monto` (01, 07, 08, 09).
  - Guardas: la 183 para sin tocar nada sobre el núcleo de la 155 y con `fecha_registra` sin NOT NULL.
- Staging (ref `hwiatgic…`): la herramienta de SQL cancela sola las sentencias que escriben en tablas, así que la batería
  con datos ficticios no corrió ahí. Sí corrieron, en transacciones descartadas, con **datos reales**: la foto
  antes/después/rollback (0 diferencias), los 4 planes del reporte (§4) y EXPLAIN ANALYZE.

**Estado de staging:**
- 16-nov 22:04 CR: primera versión aplicada, con su fila `183` en el ledger (versión con índice de expresión, núcleo
  `bd1b4d15…`).
- 22:30 CR: núcleo pasado a la versión final `100caed1…` (fragmentos 1 y 4, con guarda de md5). El ledger sigue con su
  fila `183`.
- **Pendiente en staging:** borrar el índice de la primera versión. La herramienta cancela los `drop`, así que lo corre una
  sesión de CC del dueño, en staging solamente:
  `drop index if exists public.pos_ndf_tickets_local_fecha_efectiva_idx;`. En prod nunca existió.

## 9. Firma y bitácora
| Cuándo (-06:00) | Quién | Qué |
|---|---|---|
| 2026-11-16 21:40 | dueño | Firma el arreglo (diagnóstico + migración nueva + staging) |
| 2026-11-16 22:04 | sesión | 183 v1 aplicada en staging (ledger staging 183) |
| 2026-11-16 ~22:15 | verificador independiente | CAMBIOS: desempate fijo, sin índice nuevo si alcanza, humo del reporte |
| 2026-11-16 22:30 | sesión | Staging pasa al núcleo final `100caed1…`; queda el `drop` del índice v1 (pendiente, CC del dueño) |
| | dueño | Firma SQL para prod sobre el SHA: ________ |
| | control | §5 antes / §6 después |
