# Pase a PROD de la mig 196 `pos_catalogo_productos` (origen club/puente 140) — Ventas v2 3.1a, EN ESPERA DE FIRMA

> **⛔ Esquema: firma del dueño (D-9) sobre el SHA exacto del PR 3.1a.** Decisiones del 24-nov-2026 (dos rondas) en
> [SPEC-3.1-catalogo](../ventas/SPEC-3.1-catalogo.md) §9.3 (PR #350). La firma va **después** de: (1) los seis nombres
> de familia leídos en la PC del PoS (§2), (2) las lecturas previas en prod (§4) y (3) la corrida completa en staging
> (§3). Mientras falte (1), una prueba del gate (`posNdf.contrato196.test.ts`) **falla a propósito**.
> Si algo no coincide, **se para y se avisa**.
>
> - **Número:** 196 (bloque de pase, origen 140). Si al mergear ya está tomado, se renumera al siguiente libre del
>   bloque 150–199 en el mismo PR (archivo, rollback, pruebas, lecturas, registro, ESTADO).
> - **Vía:** merge → Branching. No se aplica nada a mano.
> - **Ledger:** exactamente 1 fila `196` con su `name` (`pos_catalogo_productos`).
> - **Responsables:** ejecución = el merge (Branching); control = una persona distinta de quien mergea (§5).
> - **Franja:** la libre (23:30–15:00 CR), fuera del servicio: el disparador se crea sobre la tabla de líneas del PoS.

## 1. Qué pasa y qué no
**Pasa** (todo nuevo; no reemplaza nada vivo, por eso no lleva guarda de md5; una guarda frena si algo ya existe):
- Tablas `pos_familias` (local, familia → nombre, categoría por defecto, orden), `pos_productos` (local, código →
  nombre y familia de la factura más reciente, primer y último día) y `pos_producto_ajustes` («rinde» 1–20 y categoría
  propia). RLS: leen owner y contador activos, y el manager solo sus locales; **nadie escribe por la API**; `anon` nada.
- Disparador `AFTER INSERT … FOR EACH STATEMENT` en `pos_ndf_ticket_lines` (un llamado por lote de la ingesta): suma al
  catálogo lo nuevo. **Si falla, avisa (WARNING) y la factura entra igual.**
- Funciones: `pos_catalogo_absorber`, `pos_catalogo_registrar` (la del disparador), `pos_catalogo_refrescar`,
  `pos_categoria_efectiva` (internas, sin EXECUTE para la API) · `pos_ventas_productos` y `pos_catalogo_productos`
  (lectura, jsonb) · `pos_producto_ajuste_guardar` (única puerta de escritura; owner y manager de su local).
- Carga inicial: el catálogo desde toda la historia de facturas; las **24 familias** de santa-teresa; «rinde» heredado
  de `product_map.multiplicador ≥ 2` (por nombre, sin mayúsculas ni espacios); la categoría de los **82 códigos** de
  las familias 11, 15 y 25 (lista confirmada por el dueño el 24-nov; el 192 a `menu_especial`).

**No pasa:** nada en `product_map`, la 067, la 190, la 193 ni la 194; ninguna policy nueva sobre `pos_ndf_*`; ninguna
Edge (la `ingest-ndf` y el agente no se tocan); ningún sagrado. **Ninguna pantalla cambia**: la 3.1b y la 3.2 son las
que leen esto. **La venta neta no se mueve**: la decide la familia de la línea (fuera: 6, 17, 20), nunca la categoría.

## 2. Prerrequisitos (los hace el dueño en la PC del PoS, solo lectura, de a un paso)
Los nombres de familia salen de la tabla de familias del PoS (`FAC_Clasificaciones`). Hay que **confirmar** tres y
**traer** tres; sin los seis la 196 no se firma:

| Familia | En la 196 hoy | Qué hacer |
|---|---|---|
| 11 | nombre propuesto (menú de fin de año) | **POR CONFIRMAR**: leer el nombre exacto |
| 15 | nombre propuesto (eventos de terraza) | **POR CONFIRMAR**: leer el nombre exacto |
| 25 | nombre propuesto (promociones) | **POR CONFIRMAR**: leer el nombre exacto |
| 1 | marcador `POR CONFIRMAR (1)`, categoría bebida | **POR CONFIRMAR**: traer el nombre; confirmar bebida |
| 9 | marcador `POR CONFIRMAR (9)`, categoría comida | **POR CONFIRMAR**: traer el nombre; confirmar comida |
| 27 | marcador `POR CONFIRMAR (27)`, categoría merch | **POR CONFIRMAR**: traer el nombre; confirmar merch |

Pasos en la PC del PoS (se guían de a uno en el chat; nada se escribe en el PoS):
1. Abrir la consulta de la base del PoS que ya se usa para leer (la misma de las visitas anteriores).
2. Leer la tabla de familias y anotar el **nombre exacto** (mayúsculas y espacios como están) de las familias 1, 9, 11,
   15, 25 y 27. Una foto de la pantalla sirve; los nombres de familia no son datos personales.
3. Pasárselos al coordinador. El agente los pone en la carga de la 196 (y saca el comentario «POR CONFIRMAR» de esas
   filas); la prueba del gate pasa a verde y el SHA cambia: **la firma va sobre el SHA nuevo**.
4. (Opcional, misma visita: paso 0 de la 3.1c) dónde guarda el PoS la subcategoría de cada producto.

Además: la **familia 19** se carga como «A PAX» (categoría `pax`), pero un comentario viejo de `netaVenta.ts` la llama
de otra forma. Conviene leer su nombre en la misma visita.

## 3. Pruebas (antes de aplicar, R15)
- **Postgres 16 vacío (local, 24-nov)**, con `scripts/sql/193_base_local.sql` + la 190 + `196_preludio_local.sql`,
  transacción descartada: `sudo -u postgres python3 scripts/sql/196_pruebas.py --psql dbname=<base> --local --mutar todas`
  → **92/92 casos OK y 21/21 mutaciones muerden** (lista y casos que caen en el PR). Con las tres defensas de la
  categoría rotas a la vez, el reparto por categoría se rompe pero la neta contra la 190 **no cae**.
- **Staging (`hwiatgic…`): NO PROBADO.** El 24-nov el conector MCP pidió confirmación para la batería (lleva `drop` y
  `delete` dentro del `begin … rollback`) y nadie respondió a tiempo; por la regla 14 no se reescribió el SQL para
  esquivarla. **La corre la sesión de CC del dueño** (Management API, ref de staging fijo, termina en ROLLBACK):
  `python3 scripts/sql/196_pruebas.py --armar --medir --compacto` → pegar el resultado. Trae los casos de staging
  (carga inicial con el volumen real, herencia, paridad con la 190 en ayer, mes a la fecha, último mes cerrado y un
  año) y las mediciones (`mediciones` del resultado):

| Medición | Para qué | Resultado |
|---|---|---|
| `carga_inicial_ms` | La carga de ~234 mil líneas | pendiente |
| `crear_disparador_ms` | Lo que tarda tomar el lock de `pos_ndf_ticket_lines` | pendiente |
| `disparador_hasta_fin_de_la_migracion_ms` | **Cuánto queda bloqueada la ingesta**: el lock del `create trigger` dura hasta el commit de la migración (carga, herencia y funciones van después) | pendiente |
| `ventas_productos_1_anio_ms` y `_forma` | La función con un año (tiempo, filas, bytes) | pendiente |
| casos 40–43 | Neta = 190 al céntimo: ayer, mes a la fecha, último mes cerrado, un año | pendiente |
| caso 09 (detalle) | Herencia real: comida / bebida / menu_especial (esperado 24 / 57 / 1) | pendiente |

  Medido en staging antes (solo lectura, 24-nov): ledger 195 · 233.781 líneas · 41.635 facturas · 1 local · 704
  códigos · **0 líneas con fracción de céntimo** (la 196 redondea por línea y la 190 por factura: con fracciones
  podrían separarse en un céntimo) · 0 disparadores en `pos_ndf_ticket_lines` · `to_regclass('public.pos_productos')`
  null. Después de la corrida, confirmar otra vez que es null.
- **Si `disparador_hasta_fin_de_la_migracion_ms` pasa de unos segundos**: se mueve el `create trigger` al final del
  archivo (el lock dura milisegundos) y se suma, después del disparador, un `pos_catalogo_absorber` de las facturas
  entradas durante la migración. Es un cambio de la 196: nuevo SHA, se vuelve a correr la batería.

## 4. Lecturas previas en prod (solo lectura; antes de la firma)
`scripts/sql/196_lecturas_prod.sql` (`begin read only` … `rollback`; un solo jsonb, **sin nombres**). Lo que tiene que dar:

| Lectura | Esperado | Prod |
|---|---|---|
| `ref_y_ledger` | 195 (o el último de ESTADO; si hay una `196`, no se mergea) | pendiente |
| `ya_existe_algo_de_la_196` | todo null | pendiente |
| `disparadores_en_lineas` | 0 | pendiente |
| `lineas_con_fraccion_de_centimo` | 0 | pendiente |
| `codigos_con_mas_de_un_nombre_o_familia` | 0 (staging: 0) | pendiente |
| `familias_con_productos` | ⊆ las 24 de la carga | pendiente |
| `codigos_11_15_25_por_familia` / `_fuera_de_la_lista` | 39 / 7 / 36 · `[]` (si sale alguno, el dueño decide su categoría antes de firmar) | pendiente |
| `codigos_de_la_lista_en_otra_familia` | `[]` | pendiente |
| `familia_11_con_monto` | `["192"]` | pendiente |
| `product_map.codigos_que_heredan_rinde` | la lista (código, rinde) que va a heredar; el dueño la mira con nombres en la consulta | pendiente |
| `reparto_antes_despues_cts` y `bebidas_por_persona_salon` | el antes y el después de D-3 (último mes cerrado, 12 meses, último 31-dic): la neta total igual; se mueven comida, bebida, `otros` y aparece `menu_especial` | pendiente |

La lista de los 82 códigos **con nombre** (código, nombre, líneas y unidades) la mira el dueño en la consulta; en el repo
van solo los códigos (SPEC §2.5).

## 5. Después del merge (prod, solo lectura)
- Ledger: 1 fila `196` / `pos_catalogo_productos`; «Supabase Preview» en success.
- Catálogo: tres tablas con RLS y una policy de lectura cada una; `pos_familias` = 24 filas de santa-teresa;
  `pos_productos` = códigos distintos de las líneas (prod); `pos_producto_ajustes` = 82 con categoría + los de «rinde».
- Funciones `prosecdef`, `search_path = public, pg_temp`; `anon` sin EXECUTE; las internas sin EXECUTE para `authenticated`.
- **Humo** (como owner, `begin read only`): `pos_ventas_productos('santa-teresa', ayer, ayer)->>'neta_cts'` =
  Σ `dias[].neta_cts` de `pos_ventas_resumen` del mismo día, al céntimo. Como salonero (JWT simulado): 42501.
- **La ingesta sigue entrando:** latido del PoS al día y facturas nuevas en `pos_ndf_tickets` después del merge (antes =
  después); sin `WARNING 196 pos_catalogo_registrar` en el log de Postgres. Un producto vendido hoy aparece en
  `pos_productos` con `visto_hasta` = hoy.
- App: ninguna pantalla cambia (Resumen, Mix, Ing. Menú y Mi Rendimiento iguales).

## 6. Criterios de parada
- Ledger distinto, algo de la 196 ya existe, o Branching en rojo: no se sigue.
- La ingesta se frena (latido viejo, facturas que no entran) o aparecen `WARNING 196`: se para y se apaga solo el
  disparador (§7, con firma).
- El humo de §5 no cuadra, un rol que no es gerencia entra o el manager ve otro local: se para y se decide la vuelta
  atrás. No se arregla a mano.

## 7. Vuelta atrás
- **Entera:** `scripts/sql/196_rollback.sql` como **migración nueva hacia adelante** (regla 10: la fila y el `.sql` de la
  196 se quedan). Antes, guardar lo que cargó una persona: `select * from public.pos_producto_ajustes order by local, codigo;`.
  `product_map` y la 194 no se tocaron: la app queda exactamente como hoy.
- **Solo el disparador** (si frenara la ingesta): `drop trigger trg_pos_catalogo_registrar on public.pos_ndf_ticket_lines`
  (con firma). El catálogo deja de actualizarse; la lectura sigue dando bien la plata; `pos_catalogo_refrescar` lo pone
  al día cuando se reponga.

## 8. Firma y bitácora
| Cuándo (-06:00) | Quién | Qué |
|---|---|---|
| 2026-11-24 | dueño | Decisiones D-1…D-8 y A-1…A-5 (SPEC §9.3, dos rondas) |
| 2026-11-24 | agente | PR 3.1a: Postgres local 92/92 y 21/21 mutaciones; staging NO PROBADO (§3); prod sin leer (§4) |
| | dueño | Seis nombres de familia leídos en la PC del PoS (§2) |
| | sesión del dueño | Batería en staging con `--medir` (§3) y lecturas de prod (§4) |
| | verificador | Revisión independiente: esquema, permisos y que la categoría no toque la neta |
| | dueño | **Firma D-9** sobre el SHA exacto |
| | merge | PR 3.1a a `main`; Branching aplica la 196 |
| | control | §5 hecho |
