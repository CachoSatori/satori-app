# ⛔ firma — PASE D9 · descuento por línea del PoS (`descuento_crc` en 0 desde 2024)

> Repo público: sin montos, nombres, rutas de la PC ni secretos. Las verificaciones son conteos y huellas (md5).

> **Paquete de ejecución (PowerShell, fail-stop):** [`docs/puente/PASE-D9-AGENTE-bloques.md`](../puente/PASE-D9-AGENTE-bloques.md)
> (§5 y §7 en bloques: carpeta nueva, `.env` sin mostrarlo, dry-run, cambio de la tarea, vuelta atrás y backfill nocturno
> que se corta solo a las 05:50). Guía de una página: [`GUIA-D9-agente-descuento.md`](../puente/GUIA-D9-agente-descuento.md).

## 0. Qué pasa y qué no
- **Pasa:** el agente del PoS (`pos-bridge/`) empieza a leer `FAC_FacturasDet.Descuento` (₡ por línea) y manda su
  suma por factura en `descuento`. El Edge `ingest-ndf` y la base **ya** lo guardaban en `pos_ndf_tickets.descuento_crc`
  y ya calculaban la clase `descuento` / `mixta`: nadie se lo pasaba (auditoría de Ventas, P1-8).
- **Después**, un re-backfill del histórico (2024 → ayer) con el agente nuevo rellena `descuento_crc` y `clase_ingreso`.
- **No pasa:** sin migraciones, sin desplegar Edge, sin tocar `main`, sin sagrados (`posFiscal`/`computeTotals`,
  `cashUtils`, `tipCalculations` intactos). `total_crc`, `valor_servido_crc`, `iva_crc`, `servicio_crc`, `regalia_crc` y
  `pax` **no cambian**: `Monto` del PoS ya viene neto; el descuento solo se informa.
- **No incluye** guardar el descuento **por línea** (`pos_ndf_ticket_lines` no tiene la columna): va aparte (§9).

## 1. Diagnóstico (17-nov, solo lectura en prod `yiczgdti…`)
| Hipótesis | Evidencia | Conclusión |
|---|---|---|
| La ingesta (Edge/SQL) descarta el dato | Edge vivo v13 (hash `cf6442cf…`): `descuento_crc: num(x.descuento)`; `pos_ndf_ingestar` (082) lo inserta | ❌ El Edge y la base lo pasan bien |
| El agente no lo lee | `pos-bridge/esquema.ts` @ `5da233a` (el que corre en prod): `FAC_FacturasDet` sin `Descuento`; `sqlDetalle` no lo trae; `armarTickets` no llena `descuento` | ✅ **Causa** |
| El NDF no lo exporta | Rondas r7/r8 (`docs/analisis/2026-11-mediodia-localclub/`): `FAC_FacturasDet.Descuento` existe, es un monto en ₡ y trae valores todos los meses | ❌ El dato existe en el origen |
| Va en otro campo (línea negativa, artículo PROMO, precio unitario) | 231.628 líneas: 0 con monto negativo; `precio` siempre null; art. 856 (Local Club) 2.201 líneas, todas en ₡0; sep–nov 2026: 20 % de las líneas de comida/bebida por debajo del precio modal, 53 % de ellas al 85 % y 38 % al 90 % | ✅ `Monto` es **neto**; el descuento no viaja en otra línea |

## 2. SHA y huellas
- Rama `claude/descuento-linea-pos`, base `claude/puente-item11-prod-v2` (la del agente de prod; `pos-bridge/` no está en `main`).
- La firma va sobre el **SHA de la cabeza del PR**, anotado en §10 al firmar.
- Agente de prod hoy: `5da233a` (su carpeta queda como vuelta atrás).

## 3. Responsables
- **Ejecución:** el dueño en la PC del PoS (carpeta nueva del agente + backfill). **Control:** otra persona (p. ej. la
  encargada) o una sesión de Claude que corre el humo de §6 y compara. No la misma persona.

## 4. Prerrequisitos
- [ ] PR revisado (`satori-revision-pr`) y gate verde.
- [ ] Latido del agente de prod al día y sin error (17-nov 01:54 CR: OK).
- [ ] El backfill solo corre de 00:00 a 06:00 CR (§7); el cambio de carpeta del agente, fuera de 15:50–19:00.

## 5. Prueba antes de prod (en la PC del PoS, sin enviar nada)
1. Carpeta nueva con el SHA firmado (como en el pase del 10/11), `.env` del entorno **staging**.
2. `npm run backfill -- --desde <hace 7 días> --hasta <ayer> --dry-run` → cada día imprime `con_descuento=N`.
   **Esperado:** N entre ~15 % y ~30 % de `tickets` en días de temporada; **parar** si es 0 todos los días o > 50 %.
3. Opcional: el mismo rango **sin** `--dry-run` contra staging y correr §6 en staging (`hwiatgic…`).

## 6. Humo antes y después (`scripts/sql/descuento_pos_humo.sql`, `begin read only … rollback`)
La 082 reescribe la fila de cada factura y **reemplaza** sus líneas: por eso las huellas son **por factura** y **de
líneas** (una suma por mes no ve un cambio que se compensa adentro). Bloque 1 = resumen; bloque 2 = lo mismo por mes,
para ubicar una diferencia. Mismo corte antes y después.

**Antes (prod `yiczgdti…`, 17-nov 02:03 CR, corte 17-nov 00:00 CR):**

| Campo | Antes | Después esperado |
|---|---|---|
| `facturas` | 41.045 | **=** |
| `lineas` | 231.217 | **=** |
| `h_facturas` (todas las columnas de la factura salvo las de cambio esperado) | `e3b6557b3e3d` | **=** |
| `h_lineas` (código, cantidad, monto, familia, precio y banderas de cada línea) | `0ff0e84ea80a` | **=** |
| `h_item11_existentes` (mesa, área, FE y apertura desde el 09-nov) | `f4126335550d` | **=** |
| `con_descuento` | 0 | > 0, ~15–30 % |
| `descuento_negativo` | 0 | 0 |
| `item11_en_null` | 40.859 | **baja** (el backfill rellena el ítem 11 de las facturas viejas) |
| `lineas_sin_mesero` | 10 | **baja o igual** (se rellena `usuario_registra` de líneas viejas) |
| `clases` | cobrada 38.148 · cortesía 1.742 · dueños 320 · null 813 · sin_cobro 22 | parte de `cobrada` → `descuento`; parte de cortesía/dueños → `mixta`; el total no cambia |

**Cambios esperados (fuera de las huellas, se miran por conteo):** `descuento_crc`, `clase_ingreso`, las cinco columnas
del ítem 11 que hoy están en null, `pos_ndf_ticket_lines.usuario_registra` de líneas viejas, `ingested_at` y los `id`
de las líneas. Cualquier otra diferencia es parada.

## 7. Orden y horario
**Ventana fija: 00:00–06:00 CR.** Fuera de esa ventana no corre el backfill (a las 06:00 se corta con Ctrl+C y se
sigue la noche siguiente con el `--desde/--hasta` que falte; es idempotente).

0. En la carpeta nueva del agente: `npm ci` **dentro de `pos-bridge/`** (y en la raíz, para las pruebas). Sin el de
   `pos-bridge/` falta `mssql` y las pruebas de `extraerDia` fallan.
1. Prod: carpeta nueva con el SHA firmado (`.env` de prod igual al actual), parar la tarea vieja, arrancar la nueva.
   Verificar latido y que las facturas nuevas traen `descuento_crc` (conteo de las últimas 2 h).
2. Humo «antes» (§6) con el corte del día.
3. Backfill **por mes**, del más nuevo al más viejo, con pausa entre días para no frenar al agente en vivo:
   `npm run backfill -- --desde 2026-10-01 --hasta 2026-10-31 --pausa-ms 800` (y así mes por mes hasta 2024-01).
   El lote es **un día por POST** (fijo en el backfill); con `--pausa-ms 800` el agente en vivo sigue entrando entre
   lote y lote (la 082 los serializa por local con un lock). Mirar el latido del agente después de cada mes.
4. Humo «después» (mismo corte). Si una huella no coincide, correr el bloque 2 antes y después para ver el mes.
5. Bitácora en §10.

## 8. Criterios de parada y vuelta atrás
- **Parar** si cambia `h_facturas`, `h_lineas` o `h_item11_existentes`, si cambian `facturas`/`lineas`, si aparece
  `descuento_negativo`, si `item11_en_null` o `lineas_sin_mesero` **suben**, o si el agente deja de latir. No se
  improvisa: se avisa.
- **Falsa alarma posible:** una factura ingestada con una versión vieja del agente puede tener el mismo valor con otra
  escritura (p. ej. `1500` contra `1500.00`) o una regla de dominio distinta (logins de sistema). Igual se para y se
  mira el mes con el bloque 2: no se da por buena sin entender la diferencia.
- **Vuelta atrás del agente:** volver la tarea a la carpeta de `5da233a` (no se borra).
- **Vuelta atrás de los datos:** re-backfill del mismo rango con la carpeta de `5da233a`: deja `descuento_crc` = 0 y la
  clase como estaba (era 0 en el 100 %). El ítem 11 y el mesero de línea rellenados se quedan (los trae también esa
  versión). Sin SQL a mano.
- **A confirmar en §5:** según r8, `Descuento` viene **sin IVA desde mar-2025**; antes podría incluirlo. Si 2024 sale
  ~13 % más alto que lista − neto, anotarlo como nota de calidad del dato (no cambia ningún total).

## 9. Fuera de este pase (propuesto, con firma aparte)
- **Descuento por línea guardado:** columna `pos_ndf_ticket_lines.descuento_crc` (migración aditiva) + `pos_ndf_ingestar`
  + `normalizarLinea` + Edge. Necesita migración y despliegue de Edge (regla 2, ítem 11). Sirve para separar Local Club,
  tarjeta 10 % y personal 30 % por producto.
- **El % (`FAC_PedidosDet.Descuento`, `TipoDescuento = 'P'`):** para clasificar el tipo de descuento.
- **Si el dato no se pudiera leer** (no es el caso): reconstrucción por precio de lista − neto por línea (Q21 de r7),
  que explica el 75–90 % del descuento mensual; error esperado 10–25 % por mes.

## 10. Firma y bitácora
- Firma del dueño: _pendiente_ (SHA: ______, fecha y hora −06:00).
- Bitácora: _pendiente_.
