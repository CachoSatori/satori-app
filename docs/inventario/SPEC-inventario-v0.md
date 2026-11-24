# SPEC — Inventario v0: inicio de spec (catálogo → conteo por lugar → reportes)

**Estado:** BORRADOR de inicio (24-nov-2026). Junta lo aprendido en el piloto de inventario en planillas de barra y
cocina (20–24 nov) y las decisiones del dueño, para que la spec completa (Fable) arranque de algo probado y no de
cero. **No autoriza código ni esquema:** cada fase necesita su spec cerrada, el OK del dueño y, si toca esquema o
plata, su firma.
**Insumos:** el piloto en planillas de Drive (catálogo, app de conteo y planilla de gerencia por área; sus IDs y
links quedan fuera de este repo público) · el módulo actual `src/modules/inventario/` · las tablas `ingredients`,
`recipes`, `recipe_ingredients`, `ingredient_prices`, `inventory_movements`, `inventory_review_task`, `suppliers`,
`supplier_item_map` · la spec de conciliación de compras (docs del proyecto, no está en este repo) · el pedido al
Auditor **G-012** (pedidos, stock e inventario) y **G-014** (este tema, §9).

## 1. El problema

- El módulo Inventario existe (ingredientes, recetas, movimientos, food cost, revisión desde la Bandeja), pero
  **no se usa porque no es preciso**: no hay conteo físico confiable que lo ancle, el stock (`ingredients.current_stock`)
  es un número suelto sin fecha ni lugar, y no distingue local.
- Barra y cocina contaban en planillas propias: formatos distintos, unidades mezcladas y nadie revisaba si el
  conteo estaba completo.
- Prioridad 4 del proyecto: «estandarizar = rentabilidad». Sin un conteo confiable no hay consumo, ni costo
  real, ni pedido sugerido, ni variación teórico vs. real.

## 2. Lo que probó el piloto (planillas, nov-2026)

Tres partes por área, cruzadas por un **ID de producto** (así el orden y los nombres se pueden cambiar sin
romper nada):

| Parte | Qué es | Quién |
|---|---|---|
| **Catálogo** | Lista maestra: ID · activo · categoría · grupo · producto · unidad · proveedor · costo unitario · mínimo · par · **en qué lugares se guarda** · notas · activo desde | Encargado del área + contador |
| **App de conteo** | Pantalla de teléfono, sin login: nombre → área → **lugar** → solo los productos de ese lugar, teclado numérico, decimales («0,5»), borrador local si se corta, «✓ guardado» | Personal |
| **Gerencia** | Inicio (calendario con ✓ por lugar), Conteos (registro crudo), Histórico (total por producto y fecha), Semana, Compras, Contador (consumo), Pedido por proveedor | Dueño + contador |

Reglas que funcionaron (y que el módulo debe conservar):

1. **Se cuenta por lugar, no por producto.** Un producto puede estar en varios lugares; el total de una fecha
   aparece recién cuando se contaron **todos** sus lugares. Así un conteo a medias no se confunde con stock bajo.
2. **Calendario fijo:** día 1 de cada mes y todos los lunes. Un envío va a la última fecha del calendario que ya
   llegó (contar el martes lo del lunes atrasado funciona). Estado por fecha: Hecho · En curso · Incompleto · Atrasado.
3. **Re-envío del mismo lugar y fecha:** vale el último; el anterior queda «Reemplazado» (no se borra).
4. **Envíos de prueba** (nombre «prueba»): se registran marcados y no cuentan. Permite probar en producción.
5. **Fechas viejas no reciben conteos:** cada área tiene una fecha de arranque; antes de esa fecha solo se
   aceptan pruebas (evita pisar el histórico migrado — error que se detectó y corrigió en el piloto).
6. **Una unidad por producto (decisión del dueño, 24-nov):** lo que se pesa en **gramos**; lo que se cuenta en
   unidad, botella, paquete, litro, galón, cubeta u órdenes, con decimales. La app pregunta «¿Son gramos?» si un
   producto en gramos recibe un número entre 0 y 20 (el error típico: anotar kg).
7. **Consumo del mes** = primer conteo del mes + compras − primer conteo del mes siguiente; costo = consumo ×
   costo unitario (en gramos, costo por gramo). Consumo negativo = falta una compra o hubo un error de conteo.
8. **Pedido sugerido** = par − último conteo, por proveedor.
9. **Avisos:** lunes y día 1 a las 21:00, correo si un conteo quedó atrasado o incompleto.

Lo que enseñó el histórico de cocina (jul-2024 → sep-2026, ~110 conteos, migrado y normalizado):

- La columna decía «Kg» pero se anotaba en **gramos** hasta oct-2025, en **kg** de oct-2025 a abr-2026 y otra vez
  en gramos desde may-2026, con meses mezclados. Hubo que decidir **valor por valor**, y cerca de 400 valores
  quedaron en una lista para revisar. → En la app, la **unidad es del producto** y la pantalla la muestra siempre;
  nunca un campo libre.
- Pestañas con la fecha mal escrita y nombres del mismo producto escritos de varias formas. → La **fecha la pone
  el sistema** y el producto se elige del catálogo, nunca se escribe.

## 3. Decisiones ya tomadas (dueño, 24-nov-2026)

| # | Decisión |
|---|---|
| D-INV-1 | Una sola app de conteo para todas las áreas (selector de área), no una por área. |
| D-INV-2 | El catálogo de cada área lo mantienen el encargado del área (productos, lugares, orden) y el contador (costos, proveedores, mínimos, pares). |
| D-INV-3 | Una unidad por producto: gramos para lo que se pesa; unidades contables con decimales para el resto. |
| D-INV-4 | El histórico viejo se migra normalizado, con lista de valores dudosos (no se descarta). |
| D-INV-5 | Multi-local (recomendación aceptada como dirección, falta la confirmación del contador): Nosara entra como áreas nuevas **en la misma app**, con su propio catálogo y gerencia; un solo código para los dos locales. |

## 4. Modelo de datos (borrador para la spec completa — nada de esto está aprobado)

El piloto se traduce a la base así. Todo con `local_id` desde el día uno (regla: siempre multi-local).

| Tabla (propuesta) | Qué guarda | De dónde sale hoy |
|---|---|---|
| `inv_areas` | local · área (barra, cocina, …) · fecha de arranque · calendario | nuevo |
| `inv_lugares` | local · área · nombre · orden | nuevo (hoy son columnas del catálogo) |
| `inv_productos` | local · área · nombre · grupo · categoría · **unidad** (lista cerrada) · proveedor (`suppliers`) · costo unitario · mínimo · par · activo · activo desde · orden | extiende o reemplaza `ingredients` (ver §6) |
| `inv_producto_lugar` | producto · lugar | nuevo |
| `inv_conteo_fechas` | local · área · fecha · tipo (inicio de mes / lunes / extra) | nuevo (hoy, fila 5 del Histórico) |
| `inv_conteos` | fecha de conteo · enviado (ts) · quién · lugar · producto · cantidad · estado (vigente / reemplazado / prueba) | nuevo (hoy, pestaña Conteos) |
| `inv_totales` (vista) | total por producto y fecha, solo si todos sus lugares están contados | hoy, pestaña Histórico |
| compras | mes · producto · cantidad | hoy a mano; en la app, desde la Bandeja / FE (spec de conciliación) |

Notas para la spec:
- `inv_conteos` es un registro (solo inserta; el re-envío marca «reemplazado»), igual que el criterio de
  trazabilidad de caja.
- El total y el estado por fecha son **cálculos**, no se guardan a mano.
- Permisos (borrador): el personal solo inserta conteos de su local; encargado edita catálogo de su área; contador
  edita costos y compras; dueño todo. 🖊️ toca permisos → firma.

## 5. Flujos

1. **Catálogo:** alta de producto (el ID lo pone el sistema) · lugares · orden = orden en pantalla · baja = inactivo,
   nunca borrar (el histórico la necesita).
2. **Conteo:** área → lugar → productos de ese lugar con su unidad → enviar. Offline: borrador en el dispositivo y
   cola de envío (la app ya tiene outbox).
3. **Cierre de fecha:** estado por fecha y por lugar; aviso por correo si queda incompleto o atrasado.
4. **Reportes:** conteo de una fecha vs. el anterior · consumo y costo del mes (contador) · stock valorizado ·
   pedido sugerido por proveedor · lista de valores dudosos.
5. **Después (otras specs):** compras automáticas desde la Bandeja y la FE · recetas → consumo teórico → variación
   teórico vs. real · pedido enviado al proveedor.

## 6. Relación con lo que ya existe

- `ingredients` / `inventory_movements` / `recipes`: modelo de stock por movimientos, sin lugar, sin fecha de
  conteo y sin local. La spec completa decide: **(a)** extender `ingredients` con local, área, unidad cerrada y
  lugares, o **(b)** tablas nuevas `inv_*` y que `ingredients` pase a ser la vista de costeo de recetas. Recomendación
  inicial: **(b)**, porque el conteo físico es la verdad y los movimientos se reconcilian contra él; a confirmar
  con la ENTREGA G-012/G-014.
- `suppliers` y `supplier_item_map`: el proveedor del catálogo debe ser una FK a `suppliers`, no texto.
- Bandeja / revisión de inventario (045, `inventory_review_task`): fuente natural de «compras» en la fase 2.
- Multi-local: hoy el local está fijo en `santa-teresa` en varias vistas (P1 «Ventas multi-local»); Inventario
  nace con local.

## 7. Fases propuestas (a cerrar en la spec completa)

| Fase | Qué | Firma |
|---|---|---|
| F0 | Seguir con el piloto en planillas (barra desde 23-nov, cocina desde 30-nov); medir completitud y errores 4–6 semanas | no |
| F1 | Esquema `inv_*` + catálogo y conteo en la app (reemplaza la app de planillas), importando catálogo e histórico del piloto | 🖊️ esquema y permisos |
| F2 | Reportes: Semana, Contador (consumo y costo), Pedido; compras desde la Bandeja | 🖊️ si toca plata |
| F3 | Recetas → consumo teórico → variación teórico vs. real; Nosara | 🖊️ |

## 8. Preguntas abiertas

1. ¿Se mantiene el calendario día 1 + lunes para cocina, que antes contaba los martes?
2. ¿Conteos parciales de lo caro (pescado, proteínas, licores premium) más seguido que el resto?
3. Compras: ¿mes calendario o por fecha de factura? ¿qué pasa con lo recibido sin factura?
4. ¿El contador quiere un resumen único barra + cocina (+ Nosara) por mes?
5. Recetas en gramos vs. productos en unidades (botella, paquete): factor de conversión por producto.
6. Mermas y producción propia (caldos, preparaciones): ¿se cuentan como producto o se derivan de recetas?

## 9. Pedido al Auditor

**G-014 · conteo físico por lugar, unidades y multi-local** (en «Satori · Grok / Pedidos», 24-nov): complementa
la G-012. La entrega se contrasta contra este documento y el repo antes de usarse, y lo útil se suma acá.
