# Pase a PROD de la mig 204 `pos_familia_nombre` — Ventas v2 3.1b, EN ESPERA DE FIRMA

> **⛔ Esquema: firma del dueño sobre el SHA exacto del PR 3.1b.** Viene de [SPEC-3.1-catalogo](../ventas/SPEC-3.1-catalogo.md)
> §2.2 («Rótulos neutros», decisión del dueño 24-nov ~16:30 CR: la 3.1b trae una puerta «owner, solo el nombre» o una
> carga con firma). Si algo no coincide, **se para y se avisa**.
>
> - **Número:** 204 (bloque `operacion2`, 200–249; la 201 es de #369, la 202 de #373 y la 203 de #376).
> - **⛔ Orden:** 202 (#373) → 203 (#376) → 204 (este PR, que espera a la 3.2). La 204 entra **DESPUÉS** de la 203 (Branching rechaza una versión menor que la última aplicada). Si al mergear la 204 ya está
>   tomada o el ledger de prod pasó de 204, se renumera al siguiente libre del bloque en el mismo PR.
> - **Vía:** merge → Branching. No se aplica nada a mano.
> - **Ledger:** exactamente 1 fila `204` con su `name` (`pos_familia_nombre`).
> - **Responsables:** ejecución = el merge (Branching); control = una persona distinta de quien mergea (§4).
> - **Franja:** cualquiera de la libre (23:30–15:00 CR). No toca ninguna tabla del PoS ni de plata.

## 1. Qué pasa y qué no
**Pasa** (nuevo; no reemplaza ninguna función ni tabla viva, por eso la guarda no compara md5: frena si la función ya
existe o si falta la 198):
- Función `pos_familia_nombre_guardar(p_local text, p_familia integer, p_nombre text) returns text`, `SECURITY DEFINER`,
  `search_path = public, pg_temp`. **Solo el owner activo**; el resto `42501`; `anon` sin `execute`.
- Cambia **solo el nombre** de una fila que **ya existe** en `pos_familias`. Lo deja sin espacios a los costados ni
  repetidos; 1 a 40 caracteres; letras (con tildes y ñ), números, espacio y `( ) . , - / & ' + #`. Otra cosa,
  familia o local desconocidos → `22023`. Devuelve el nombre guardado.
- Se actualiza el comentario de `pos_familias` (decía «nadie la edita desde la app»).

**No pasa:** no crea familias ni toca categoría u orden (la categoría decide qué es venta: 6, 17, 20) · no toca
`pos_ndf_*`, `pos_productos`, `pos_producto_ajustes`, `product_map` ni ninguna función de la 198 · no mueve ningún número.

## 2. Pruebas (antes de aplicar)
- `scripts/sql/204_pruebas.sql` (se arma con `204_pruebas.py`; termina en `ROLLBACK`; local `prueba-204` y usuarios
  ficticios): **21 casos** (01–20 y 15b). **Postgres 16 local** (base armada con `scripts/sql/local_armar_base.sh`
  hasta la 200, + `204_preludio_local.sql`), 26-nov: **21/21 OK** y **15/15 mutaciones muerden**
  (`--mutar todas`, salida 0). Casos: el owner cambia y normaliza · solo ese nombre se mueve (huella md5 de toda la
  tabla) · tildes y signos permitidos · 40 entran y 41 no · renombrar la familia de regalías no cambia su categoría ·
  `pos_catalogo_productos` devuelve el nombre nuevo · manager (aun en su local), contador, salonero, cajero, owner
  inactivo y `anon` → `42501` · nadie escribe la tabla directo · vacío, `@ < ; " $ % _ \`, emoji y espacio invisible
  → `22023` · salto de línea y tab se vuelven un espacio · familia o local desconocidos → `22023` y no se crea nada ·
  `SECURITY DEFINER` + `search_path` · la guarda frena una segunda corrida · después del rollback no queda nada.
- **Staging: NO PROBADO** desde este PR (regla 14: la batería la corre la sesión de CC del dueño o la coordinadora,
  ref `hwiatgic…` fijo, `ROLLBACK`): `python3 scripts/sql/204_pruebas.py --armar` y correr el SQL armado. Esperado:
  `{"ok": 21, "fallas": 0}`.

## 3. Lecturas previas en prod (solo lectura; antes de la firma)
```sql
begin read only;
select max(version) from supabase_migrations.schema_migrations;                      -- = 203 (202 de #373 y 203 de #376 ya entraron), y la 204 libre
select to_regprocedure('public.pos_familia_nombre_guardar(text,integer,text)');       -- null
select count(*) from public.pos_familias;                                              -- 29 (santa-teresa, de la 198)
select md5(string_agg(format('%s|%s|%s|%s', local, familia, categoria, orden), ';' order by local, familia))
  from public.pos_familias;                                                            -- anotar la huella (sin nombres)
rollback;
```

## 4. Después del merge (prod, solo lectura; control ≠ quien mergea)
- Ledger: 1 fila `204` / `pos_familia_nombre`. «Supabase Preview» en success.
- `select prosecdef, proconfig from pg_proc where oid = 'public.pos_familia_nombre_guardar(text,integer,text)'::regprocedure;`
  → `true`, `{search_path=public, pg_temp}`.
- `select has_function_privilege('anon', 'public.pos_familia_nombre_guardar(text,integer,text)', 'execute');` → `false`.
- La huella de §3 (categoría y orden) es la misma.
- Humo físico (el dueño): «Ajustes → Catálogo» → «Familias del PoS» → cambiar el nombre de la 7 → se ve el nuevo.
  El nombre real **no** se escribe en el repo, en el PASE ni en un chat público del proyecto.

## 5. Criterios de parada
- La guarda frena («ya existe» o «falta pos_familias»), el ledger no queda con exactamente 1 fila, o la huella de
  categoría y orden cambia → se para y se avisa.

## 6. Vuelta atrás
`scripts/sql/204_rollback.sql`: saca la función y devuelve el comentario de la 198. Los nombres que el owner ya cambió
**quedan** (son datos; volver a los rótulos neutros sería otra migración con firma). En el mismo momento, el PR que saca
el `.sql` de `main`; si la 204 ya está en el ledger de prod, el `.sql` NO se borra (regla 10) y la vuelta atrás es una
migración nueva con ese cuerpo. Sin la función la pantalla sigue andando: solo «Cambiar nombre» da error.

## 7. Firma y bitácora
| Fecha y hora (-06:00) | Qué | Quién | SHA |
|---|---|---|---|
| — | Firma del dueño | — | — |
