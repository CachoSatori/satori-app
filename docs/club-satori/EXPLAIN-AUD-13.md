# CLUB-AUD-13 · EXPLAIN (ANALYZE) del cruce — staging, 07-nov

Lo pidió la revisión del 07-nov. Corrida sobre los datos reales de staging, después del backfill del
ítem 11: el pedido 33 de la mesa 19 del 31-oct. Todo dentro de una transacción con ROLLBACK.

| Consulta interna | Antes | Después | Cambio |
|---|---|---|---|
| (a) Factura del pedido (`club_cruce_detalle`) | Index Scan `pos_ndf_tickets_pedido_idx` solo por número: 308 filas descartadas, **308,8 ms** | Index Cond con rango de `fecha_registra`: 1 fila, **0,13 ms** | Se acota a [apertura − 2 min, escaneo + 18 h). El número de pedido se repite cada día |
| (b) Divididas (sin pedido, misma mesa) | Index Scan `pos_ndf_tickets_local_fecha_idx`: **12 ms** | igual | — |
| (c) ¿Otro pedido de la mesa? (AMBIGUA) | Index Scan solo por `local`: 13.159 filas descartadas, **1.336,8 ms** | `local_fecha_idx` con rango: 8 filas, **0,06 ms** | Se acota a [factura − 30 min, factura + 18 h] |
| (d) Registros del rango (`mv0`) | Index Scan `club_mov_app_fecha_idx`: **6,5 ms** | igual | — |
| Factura tipeada | Seq Scan de 10.631 filas, 4,1 ms | Index Scan `pos_ndf_tickets_factura_clave_idx`, 0,04 ms | Índice de la 081 |

**De punta a punta**, con 2.000 movimientos sintéticos de la app, `club_excepciones` (30 días), el
contador de la Home y el reporte del mes pasan de ~21 s a 0,1–0,4 s. Con 6.000, de más de 60 s a
menos de 0,4 s.

**Para repetirlo:** `EXPLAIN (ANALYZE, BUFFERS)` de esas consultas con los mismos parámetros. Dentro de
plpgsql no se ven los planes, así que se corren sueltas.
