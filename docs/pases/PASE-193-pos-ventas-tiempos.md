# Pase a PROD de la mig 193 `pos_ventas_tiempos` (origen club/puente 136) — número PROVISORIO

> **⛔ Esquema: firma del dueño sobre el SHA exacto.** Decisiones del dueño del 18-nov-2026 13:08 -06:00 («294 B»:
> horas de todos los canales; tiempo sentado por tamaño de mesa; mesas 51–53 internas) y la confirmación de las
> mesas internas = «A» (13:20). Esa es la firma de la idea; el pase necesita la firma sobre el SHA.
> Si algo no coincide, **se para y se avisa**.
>
> - **Número:** 193 es **provisorio** (#295, propinas, pide la 192). Se fija al mergear: si al mergear ya está tomado,
>   se renumera al siguiente libre del bloque de pase en el mismo PR (archivo, rollback, pruebas, registro, ESTADO).
> - **Vía:** merge → Branching. No se aplica nada a mano.
> - **Ledger:** exactamente 1 fila `193` con su `name` (`pos_ventas_tiempos`).
> - **Responsables:** ejecución = el merge (Branching); control = una persona distinta de quien mergea (§4 y §5).

## 1. Qué pasa y qué no
**Pasa** (todo nuevo; no reemplaza ninguna función viva, por eso no lleva guarda de md5 y es re-ejecutable):
- Tabla `public.pos_mesas_internas (local, mesa)` con RLS: leen owner / manager / contador activos; agrega y quita
  **solo el owner**; `anon` nada. Valor inicial: `santa-teresa` 51, 52 y 53. Mesa sin ceros a la izquierda (CHECK).
- `pos_ventas_internas(text, date, date) → jsonb`: facturas C de mesas internas en la ventana de la 190 (un día antes,
  dos después): `[id, dia, hora, canal, neta_cts, pax]`.
- `pos_ventas_tiempos(text, date, date) → jsonb`: `horas` (día × hora CR, todos los canales, sin internas, céntimos
  con la regla de la 190), `sentados` (tamaño 2 / 4 / 6 / 7+ → N, mediana y promedio en minutos; pedido =
  `numero_pedido` + `pedido_abierto_en`, desde la apertura hasta el cobro de su última factura, pax = suma de sus
  facturas; solo salón, 5–240 min) y `descartes`.
- Dos helpers internos (`pos_es_mesa_interna`, `pos_ventas_tiempos_porton`) sin EXECUTE para la API.
- Permisos de las dos funciones: owner / manager / contador activos, el **manager solo de sus locales**
  (`puede_ver_local`); el resto 42501. `anon` sin EXECUTE. Rango ≤ 731 días.

**No pasa:** medios de pago, vuelto, `clase_ingreso`, números de mesa ni nombres en lo que devuelven (regla 6);
ninguna policy sobre `pos_ndf_*`; ninguna Edge; sagrados intactos. **Contabilidad y el correo al contador no
cambian**: no leen nada de esto.

## 2. Prerrequisitos
- #293 y #292 en `main` (están). Ledger de prod = el último de ESTADO; nadie tomó el número.
- Prod (solo lectura): `to_regclass('public.pos_mesas_internas')`, `to_regprocedure('public.pos_ventas_tiempos(text, date, date)')`
  y `to_regprocedure('public.pos_ventas_internas(text, date, date)')` = null.
- **Medir en prod (solo lectura) antes del merge:** cómo vienen `mesa` y `mesa_factura` de las mesas 51–53 (con o sin
  ceros, en qué área) y si en los pedidos partidos el pax por artículo se reparte entre las facturas o se repite. Si se
  repite, la suma de pax del pedido sobra: se para y se cambia a `max` (mutación `pax_max` de la batería).

## 3. Pruebas (antes de aplicar, R15)
- **Postgres 16 vacío** (local, con `scripts/sql/193_base_local.sql`), transacción descartada:
  `python3 scripts/sql/193_pruebas.py --psql … --mutar todas` → **10/10 casos OK** y **12/12 mutaciones muerden**
  (`internas_en_horas`, `sin_ceros`, `solo_mesa_pedido`, `pedido_por_factura`, `pax_max`, `sin_tope_240`,
  `dia_de_apertura`, `familia_20`, `manager_cualquier_local`, `sin_rol`, `manager_edita`, `helper_abierto`). La
  migración se aplicó dos veces seguidas (re-ejecutable) y la vuelta atrás la deja sin rastro.
- **Staging: NO PROBADO.** Correr la misma batería (`--psql` contra staging, solo dentro de su transacción
  descartada). Usa un local ficticio y sus propias facturas: no depende de los datos.
- **Tiempo en prod: NO MEDIDO.** `explain analyze` de `pos_ventas_tiempos` para un año en `begin read only`.

## 4. Antes del merge (prod, solo lectura)
- Ledger: último = el de ESTADO; si ya hay una `193`, **no se mergea** (se renumera).
- Lo de §2.

## 5. Después del merge (prod, solo lectura)
- Ledger: 1 fila `193` / `pos_ventas_tiempos`; «Supabase Preview» en success.
- `select * from pos_mesas_internas` = santa-teresa 51, 52, 53. RLS activa con las 3 policies.
- Catálogo: las dos funciones `prosecdef`, `search_path = public, pg_temp`, `STABLE`; `anon` sin EXECUTE; los helpers
  sin EXECUTE para `authenticated`.
- **Humo** (como owner, `begin read only`): `pos_ventas_tiempos('santa-teresa', ayer, ayer)`: Σ `horas` + Σ
  `pos_ventas_internas` del día = `neta_cts` del día de `pos_ventas_resumen` (al céntimo). Mediana del tamaño «2»
  cerca de lo medido (~62 min para todo el salón en 90 días).
- App: «Tiempos» dice «Mapa por hora · todos los canales» y muestra el tiempo sentado; el Resumen y Contabilidad
  siguen dando la misma venta neta.

## 6. Criterios de parada
- Ledger distinto, algo ya existe o Branching en rojo: no se sigue.
- El humo de §5 no cuadra, un rol que no es gerencia entra o el manager ve otro local: se para y se decide la vuelta
  atrás. No se arregla a mano.

## 7. Vuelta atrás
`scripts/sql/193_rollback.sql` como **migración nueva hacia adelante** (regla 10; la fila y el `.sql` de la 193 se
quedan). Antes, anotar el contenido de `pos_mesas_internas`. La app sigue andando: «Tiempos» vuelve a la 080 y al
mapa de salón, y los indicadores dejan de separar las mesas internas.

## 8. Firma y bitácora
| Cuándo (-06:00) | Quién | Qué |
|---|---|---|
| 2026-11-18 13:08 | dueño | Decide «294 B» (horas de todos los canales), tiempo sentado y mesas internas 51–53 |
| 2026-11-18 13:20 | dueño | Confirma mesas internas = «A» (fuera de venta real y tiempos; dentro de Contabilidad y del correo) |
| 2026-11-18 | agente | Batería en Postgres local 10/10, 12/12 mutaciones; staging pendiente |
| | verificador | Revisión independiente (pedida en el PR) |
| | dueño | Firma de esquema sobre el SHA exacto (OK de merge) |
| | control | §4 y §5 |
