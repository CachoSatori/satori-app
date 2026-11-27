# SPEC — Compras → Stock → Costos (spec única, por fases)

**Estado:** PROPUESTA (25-nov-2026). Junta en un solo documento la conciliación de compras con factura electrónica
(borrador del 12-nov, documentos del proyecto), el inicio de spec de inventario
([SPEC-inventario-v0](SPEC-inventario-v0.md)) y las decisiones del dueño del 25-nov (§2).
**No autoriza código ni esquema.** Cada fase se construye con el OK del dueño y, donde la tabla de fases dice
🖊️, con su firma. Todo borrador de esquema de este documento está marcado **«requiere firma»**.
**No cambia nada de hoy:** la Bandeja (`/inbox`), la Caja y sus reglas siguen igual; ningún archivo sagrado se toca.
**Actualización del 27-nov-2026:** suma la entrega privada **G-012 v3** del Auditor (spec ideal compras → stock →
costos → P&L), contrastada contra `main` = `995e462` (§1.1), y las decisiones del dueño del 27-nov (D-CSC-5 a 7, §2).
Las decisiones P1–P5 del dueño (27-nov) están en §12.2. El piloto vive en Drive; sus rutas están en la
entrega privada G-012 v3 y no en este repo (§16).

Ejemplos: todos ficticios («Proveedor de prueba 1», «Producto A», montos inventados). El correo de proveedores, los
nombres reales, las cédulas y los montos no van a este repo (público).

## 0. Resumen en una página

| Fase | Qué resuelve | Qué ve la gente |
|---|---|---|
| **F1** Ingesta | Cada XML de factura electrónica que llega al correo de proveedores queda guardado y leído, solo, en 10–15 min | Nadie ve nada nuevo todavía (pantalla de control para owner y contador) |
| **F2** Cruce | Cada factura electrónica se cruza con lo que el personal subió a la Bandeja y con su pago | Quien paga ve el estado en cada pendiente; el gerente, avisos de «FE sin recepción» |
| **F3** Línea ↔ producto | Cada línea del proveedor se asocia a un producto del catálogo con su conversión de unidad; sale el costo | Gerente: cola «líneas sin asociar» y avisos de suba de precio |
| **F4** Inventario | Conteo por lugar (link instalable por área), gerencia y pedido sugerido | Personal: la pantalla de conteo. Gerencia: bajo mínimo, «se acaba antes», cumplimiento, pedido |
| **P&L-mín** P&L gerencial de mercadería | Costo de ventas por cuenta (inventario inicial + compras − final), gastos por cuenta y prime cost, por mes y por local (§15) | Dueño y contador: vista mensual y CSV. Sin asientos |
| **F5** Recetas con costo | Modelo y ganchos para costo por plato y teórico vs. real | Nada: no se construye en esta spec |

Orden de construcción (D-CSC-6, 27-nov): F1 → F2 → F3-mín → F4a/b → **P&L-mín** → F4c → F5 (§11).

La cadena: **la factura dice qué entró y a qué precio (F1–F3) · el conteo dice qué hay (F4) · la diferencia es el
consumo · la receta dice qué debería haberse consumido (F5).**

## 1. Lo que existe hoy (verificado en el repo, `main` = `e5cab2d9`)

| Pieza | Dónde | Qué importa para esta spec |
|---|---|---|
| Bandeja | `src/modules/inbox/`, tabla `documents` (mig 016) | Foto → `extract-document` → `raw_json` (tipo, proveedor, cédula, número, `clave_fe`, fecha, moneda, condición, totales e ítems). Estados `nuevo → procesado / descartado`, `linked_movement_id` al movimiento de caja. `documents` **no tiene columna de local**: el local sale del movimiento enlazado. |
| Duplicados | `src/shared/utils/facturaDuplicada.ts` | Misma foto (sha256) o misma `clave_fe` de un documento **vigente** bloquea. Un «procesado» sin movimiento es huérfano y no cuenta. |
| Forma de pago | `src/shared/utils/pagoMatrix.ts` | Efectivo (descuenta Caja) · Transferencia pendiente (cuenta por pagar) · Pagado desde Banco. Se reusa tal cual; esta spec no la altera. |
| Caja | `cash_movements` (con `location_id`, mig 091) | Regla 11 de ESTADO: la fecha del movimiento es el día en que se registró, nunca la de la factura. |
| Inventario actual | `src/modules/inventario/`, tablas `ingredients`, `recipes`, `recipe_ingredients`, `inventory_movements`, `inventory_review_task` | Sin local, sin lugar, sin fecha de conteo. No se usa por falta de conteo confiable. |
| Mapa aprendido actual | `supplier_item_map`, `ingredient_prices` (mig 017) | Ya guarda proveedor + código → ingrediente con `factor_conversion`. Es el antecedente directo de F3. |
| Catálogo del PoS | `pos_familias`, `pos_productos`, `pos_producto_ajustes` (mig 198) | Catálogo de lo que se **vende**, por `(local, codigo)`. Es la llave de F5; no es el catálogo de lo que se **compra**. |
| Ingesta con secreto | `supabase/functions/ingest-ndf` | Patrón probado: `verify_jwt` off, cabecera con secreto, el secreto define el local. F1 lo repite. |
| Cola sin señal | `src/shared/offline/` (`outbox.ts`, `rechazadas.ts`) | Idempotencia por `client_op_id`; lo que no se puede clasificar se reintenta, nunca se descarta (R08). F4 la reusa. |
| Roles | `UserRole` en `src/shared/types/database.ts` | `owner`, `manager`, `contador` (gerencia) y empleados: `cajero`, `salonero`, `barman`, `barback`, `runner`, `cocina`; `proveedor` es el puesto fijo de la Bandeja. |
| Locales | `locations`, `profile_locations`, `puede_ver_local()` (mig 091) | Las tablas de caja usan `location_id`; las del PoS usan `local`. `employees` **no tiene local** todavía (ver §11, pregunta 9). |

### 1.1 Contraste del 27-nov-2026 (`main` = `995e462`) para la entrega G-012 v3

Cada afirmación de la entrega sobre el código se abrió en el repo antes de escribirla acá. Dos no coinciden y quedan
corregidas en la tabla (ajuste de conteo y P&L existente).

| Pieza | Dónde | Qué se verificó |
|---|---|---|
| F1 construida | migraciones 199, 201 y 203 · Edge `supabase/functions/fe-ingesta/` · `src/shared/fe/` · `scripts/apps-script/fe-correo/` · `InvFacturasFe.tsx`, `InvFeEmisores.tsx` | Existen `fe_receptores`, `fe_comprobantes` (`tipo` incluye `tiquete`; `ref_clave` para NC/ND), `fe_lineas`, `fe_respuestas`, bitácora y latido. En operación según ESTADO (carga real desde el 30-nov). F2 y F3 siguen siendo solo spec. |
| Entrada a stock desde la foto | `InvRevision.tsx` → RPC `complete_inventory_review` | Al completar la revisión, la mercadería entra a `ingredients.current_stock`. Es el camino que chocaría con F3 (doble entrada). |
| Compra manual | `InvMovimientos.tsx` | Movimiento `purchase` que, con la casilla marcada (`linkCaja`), además registra un egreso en Caja. |
| Ajuste de conteo | `InvMovimientos.tsx` → `setStockLevel` (`src/shared/api/inventario.ts`) | Se teclea el nivel nuevo y se guarda la **diferencia** contra `current_stock` como `count_adjustment`. No pisa el número (la entrega decía que sí), pero el ajuste no tiene fecha de conteo, lugar ni local. |
| Dos motores de consumo | `InvConsumo.tsx` (por día, a mano; llave `sale:AAAA-MM-DD`) · `depleteOrderInventory` en `src/shared/api/inventario.ts` (por pedido; llave = pedido) | Los dos escriben `sale_deduction`. Cada uno es idempotente con **su** llave, así que entre los dos la misma venta puede descontarse dos veces. `depleteOrderInventory` no tiene ningún llamador en `main`: solo la definición. |
| Food cost actual | `InvFoodCost.tsx` | «Variación» = compras de Caja (`egreso_mercaderia`) − costo teórico de recetas. No usa conteos: no es inicial + compras − final. |
| Recetas actuales | `InvRecetas.tsx`, `recipes` / `recipe_ingredients` | El costo del plato sale de `ingredients.cost_per_unit`, cargado a mano. |
| Catálogo actual | `upsertIngredient` (`onConflict: 'name'`), `deleteIngredient`, `InvIngredientes.tsx`, `INGREDIENT_UNITS` | Alta por nombre, proveedor en texto libre, lista de unidades con `kg` y `g` a la vez, y un ingrediente **se puede borrar**. |
| Movimientos actuales | `inventory_movements` (`src/shared/types/inventario.ts`) | Tipos `purchase`, `waste`, `count_adjustment`, `sale_deduction`, `transfer`. Sin local, lugar, origen ni destino. |
| **P&L existente** | `src/modules/finanzas/FinanzasModule.tsx` (ruta `/finanzas`; owner, manager y contador) · `finance_accounts`, `finance_budget`, `finance_actuals` (mig 006) · `getLiveActuals` en `src/shared/api/finance.ts` | **Ya hay un Estado de Resultados** con plan de cuentas y presupuesto vs. real. El real en vivo sale de las ventas del PoS y de `cash_movements` por **fecha de registro** (base caja), con la mercadería en una sola cuenta. La entrega decía que no había P&L en el repo: no es así. Convive con §15 por mapeo: un solo plan de cuentas (decisión P1, §12.2). |

## 2. Decisiones que mandan (dueño, 25-nov-2026)

| # | Decisión |
|---|---|
| D-CSC-1 | El conteo se puede hacer por dos vías, con el mismo código y los mismos datos: pantalla dentro de Satori App y **link aparte instalable**. En la práctica se usa el link. |
| D-CSC-2 | Al empezar un conteo se elige el nombre de un **empleado registrado y activo del local**. El aparato lo habilita un gerente una vez; el empleado no escribe clave. |
| D-CSC-3 | Las facturas electrónicas salen del correo de proveedores con la opción más eficiente de Google. Recomendación a confirmar acá: Apps Script dentro de esa cuenta → Edge Function con secreto (§4.1 la confirma). |
| D-CSC-4 | Orden: F1 → F2 → F3 → F4 → F5. Una sola spec. |

Siguen vigentes D-INV-1 a D-INV-5 de la [v0](SPEC-inventario-v0.md) (una app de conteo, catálogo a cargo del
encargado del área y el contador, una unidad por producto, histórico migrado normalizado, multi-local en la misma app).

**Decisiones del dueño del 27-nov-2026** (sobre la entrega G-012 v3). Fijan la dirección; **no autorizan esquema ni
código**: cada fase sigue necesitando su OK y su firma (§11).

| # | Decisión |
|---|---|
| D-CSC-5 | **Un solo ledger de movimientos de stock**, `inv_movimientos`: solo inserta, con `idem_key` única. Stock, costo, food cost y P&L son **vistas**; ningún total se guarda a mano (principio 8, §6.7). |
| D-CSC-6 | **P&L gerencial de mercadería antes de F5** (§15): método periódico (inventario inicial + compras − final) por cuenta, devengado por fecha de emisión de la FE, prime cost, CSV al contador, sin asientos. Ajusta el orden de D-CSC-4: el P&L-mín va entre F4a/b y F4c (§11). |
| D-CSC-7 | **Consumo teórico con un único motor, al cierre de turno.** Cuando entre, se apagan `depleteOrderInventory` e `InvConsumo` (§8). |

## 3. Principios

1. **La Bandeja y la Caja no cambian.** F1–F3 solo **leen** `documents` y `cash_movements`. Ninguna pantalla nueva
   escribe sobre ellas.
2. **El XML es el dato exacto; la foto es la prueba de que llegó.** Si difieren, se muestra la diferencia; nunca se
   corrige sola una cifra de Caja.
3. **Ante la duda, a revisión.** Ningún cruce ni asociación con más de un candidato se resuelve solo.
4. **Registro, no edición.** Conteos, compras y cruces se insertan; lo corregido queda marcado «reemplazado» con quién
   y cuándo (mismo criterio de trazabilidad que Caja).
5. **Multi-local desde el inicio.** Toda tabla nueva lleva `location_id` (FK a `locations`) y RLS con
   `puede_ver_local()`; nada asume `santa-teresa`.
6. **Nunca un envío automático a un proveedor.** El pedido se copia; lo manda una persona.
7. **Hora de Costa Rica** para «hoy», calendarios de conteo y ventanas (`todayCR()` / `dateCR()`).
8. **Un solo ledger de movimientos (`inv_movimientos`), solo inserta, con `idem_key` única; stock, costo, food cost y
   P&L son vistas** (D-CSC-5). Una corrección es un movimiento inverso o un «reemplazado», nunca un `update` de
   cantidades. El stock de un producto a cualquier fecha se reproduce con una consulta sobre el ledger.

---

## 4. F1 — Ingesta de XML desde el correo de proveedores

### 4.1 Cómo se lee el correo: comparación y elección

| | **A. Apps Script en la cuenta** (elegida) | B. API de Gmail desde el servidor | C. Gmail push + Pub/Sub |
|---|---|---|---|
| Cómo funciona | Un script dentro de la misma cuenta, con disparador cada 10–15 min, busca correos con adjunto sin la etiqueta «fe-procesada» y manda cada XML a la Edge | Una Edge o cron guarda un token OAuth de la cuenta y consulta la API | La cuenta avisa a un tema de Pub/Sub por cada correo; un endpoint lo recibe y recién ahí lee con la API |
| Permiso de Google | El dueño de la cuenta autoriza **su propio** script una vez; no hay app OAuth que publicar | App OAuth con alcance **restringido** de Gmail: o verificación de Google (con evaluación de seguridad) o queda en «modo prueba» con tokens que **vencen cada 7 días** | Lo mismo que B (sigue leyendo por la API), **más** proyecto de Google Cloud, tema, suscripción y renovar el `watch` cada 7 días como máximo |
| Secretos fuera de Google | Ninguno de Google. Solo el secreto de la Edge, guardado en las propiedades del script | Token de actualización de la cuenta guardado en Supabase (da acceso a **todo** el buzón) | Igual que B |
| Demora | 10–15 min | La del cron (igual a A) | Segundos |
| Qué se rompe y cómo se nota | El disparador se apaga si cambia la clave o se revoca el permiso → Google manda un correo de falla a la cuenta y la pantalla de control muestra «sin ingesta hace N h» | Token vencido → ingesta parada hasta que alguien vuelva a autorizar a mano | Lo de B, o el `watch` sin renovar |
| Costo | Sin costo; cuotas de Apps Script de sobra para el volumen esperado (confirmar en F1.0) | Sin costo; trabajo de verificación alto | Costo bajo de Pub/Sub; el más complejo de operar |
| Piezas a mantener | 1 script (~150 líneas) + 1 Edge | 1 app OAuth + flujo de autorización + 1 Edge + cron | Todo lo de B + Pub/Sub + renovación |

**Elección: A.** Para cruzar compras alcanza con 15 minutos de demora; nadie paga una transferencia en ese lapso. A
evita la app OAuth con alcance restringido (el único camino estable de B y C exige la verificación de Google), no saca
de Google ninguna credencial del buzón y deja una sola pieza chica dentro de la cuenta. **C queda documentada como fase
posterior** solo si algún día hace falta tiempo real (p. ej. avisar en el momento de la entrega); la Edge de F1 no
cambiaría: solo cambia quién la llama.

Fuera de Google existe una cuarta vía (regla de reenvío automático a una casilla de entrada con webhook). Queda
descartada por la decisión D-CSC-3 y porque un tercero vería todo el correo reenviado.

> Las condiciones de Google (alcances restringidos, vencimiento de tokens en modo prueba, cuotas de Apps Script y
> duración del `watch`) se releen en la documentación oficial al empezar F1 (paso F1.0); si cambiaron, se trae la
> diferencia al dueño antes de construir.

### 4.2 El script (dentro de la cuenta de correo de proveedores)

- **Disparador** por tiempo cada 10 min (15 si la cuota aprieta). `LockService` para que dos corridas no se pisen.
  Tope por corrida: 20 correos y 4 minutos; lo que sobra queda para la siguiente.
- **Búsqueda:** correos con adjunto `.xml` o `.zip`, sin etiqueta «fe-procesada» ni «fe-error», de los últimos 30
  días. La primera corrida (carga inicial) usa una ventana más larga que decide el dueño (pregunta 2).
- **Por correo:** junta los adjuntos `.xml`; si hay `.zip`, lo abre y toma los `.xml` de adentro (un nivel; un zip
  dentro de otro va a «fe-error»). Los `.pdf` **no se mandan**: es la representación gráfica y no agrega datos. Manda
  a la Edge: identificador del mensaje, fecha de recepción y cada XML en base64. **Nunca** el cuerpo del correo, el
  remitente ni otros adjuntos.
- **Etiquetas:** respuesta 2xx → «fe-procesada». Correo con adjunto pero **sin ningún XML** (solo PDF o imagen) →
  «fe-sin-xml» y se informa a la Edge solo el conteo (para la pantalla de control). Error 4xx de contenido →
  «fe-error». Error de red o 5xx → sin etiqueta: se reintenta en la próxima corrida.
- **Secreto:** en las propiedades del script (no en el código). El código del script vive en el repo
  (`scripts/apps-script/fe-correo/`, PR de F1) sin secretos ni direcciones; el dueño lo pega y autoriza una vez, guiado
  paso a paso.
- **Alcance:** el script puede leer todo ese buzón. Por eso la cuenta debe ser solo de proveedores (pregunta 1) y el
  script solo saca adjuntos XML.

### 4.3 La Edge `fe-ingesta` (nueva) — 🖊️ requiere firma (Edge + secreto en prod, regla 2)

- `verify_jwt` off y cabecera con secreto, como `ingest-ndf`. **Un secreto por local**: el secreto define el
  `location_id` (hoy una sola cuenta de correo → un solo local; ver pregunta 3 para Nosara).
- Comparación del secreto en tiempo constante; tope de tamaño por pedido (p. ej. 2 MB) y por XML; el parser no
  resuelve entidades externas ni DTD.
- Por cada XML:
  1. Mira el elemento raíz: `FacturaElectronica`, `NotaCreditoElectronica`, `NotaDebitoElectronica`,
     `TiqueteElectronico`, `FacturaElectronicaCompra` → comprobante. `MensajeHacienda` → respuesta de Hacienda
     (aceptado / rechazado) de una clave. Cualquier otro XML → se registra «no es comprobante» y se ignora.
  2. **Receptor:** la cédula del receptor tiene que ser la del negocio (secreto `NEGOCIO_CEDULA`, que ya usa
     `extract-document`). Si no coincide → se guarda como «receptor distinto» para revisión; no entra al cruce.
  3. **Idempotencia por clave de 50 dígitos:** `clave` única. Si ya existe → responde «duplicado» (2xx), no escribe
     nada y el correo queda «fe-procesada». El mismo XML reenviado diez veces deja una sola fila.
  4. Guarda el XML original en un bucket privado nuevo (`fe-xml`, ruta `location/AAAA/MM/clave.xml`), la cabecera y
     las líneas. Todo en una transacción por comprobante.
  5. Controles: clave de 50 dígitos numéricos · la fecha de la clave (posiciones 4–9, DDMMAA) coincide con
     `FechaEmision` · suma de líneas = total con margen de redondeo · moneda conocida. Lo que falla queda con
     `estado_parseo = 'revisar'` y el motivo; **no se descarta**.
- No valida la firma digital del XML en la v1: la confianza sale de que llegó al buzón propio, el receptor es el
  negocio y existe la respuesta «aceptado» de Hacienda. Queda anotado como mejora.

### 4.4 Parser del formato de Hacienda

Estructura de la clave (no se inventa un ejemplo numérico en el repo):
`506 · DDMMAA · cédula del emisor (12) · consecutivo (20: sucursal 3 + terminal 5 + tipo 2 + número 10) · situación (1) · código de seguridad (8)`.

| Dato | Elemento del XML (v4.4; entre paréntesis, el de v4.3 si cambia) |
|---|---|
| Clave, consecutivo, fecha | `Clave`, `NumeroConsecutivo`, `FechaEmision` |
| Emisor | `Emisor/Nombre`, `Emisor/Identificacion/Tipo` y `Numero`, `Emisor/NombreComercial` |
| Receptor | `Receptor/Identificacion/Numero` |
| Condición y plazo | `CondicionVenta`, `PlazoCredito` |
| Medio de pago | `ResumenFactura/MedioPago/TipoMedioPago` (`MedioPago` en la cabecera) |
| Moneda y tipo de cambio | `ResumenFactura/CodigoTipoMoneda/CodigoMoneda` y `TipoCambio` |
| Totales | `TotalVentaNeta`, `TotalImpuesto`, `TotalDescuentos`, `TotalOtrosCargos`, `TotalComprobante` |
| Línea: número | `DetalleServicio/LineaDetalle/NumeroLinea` |
| Línea: CABYS | `CodigoCABYS` (`Codigo`) |
| Línea: código comercial | `CodigoComercial/Tipo` y `CodigoComercial/Codigo` (puede venir más de uno; se guarda el primero de tipo «código del vendedor» y, si no hay, el primero) |
| Línea: detalle, cantidad, unidad | `Detalle`, `Cantidad`, `UnidadMedida`, `UnidadMedidaComercial` |
| Línea: precio y montos | `PrecioUnitario`, `MontoTotal`, `Descuento/MontoDescuento`, `SubTotal`, `MontoTotalLinea` |
| Línea: impuestos | cada `Impuesto`: `Codigo`, `CodigoTarifaIVA` (`CodigoTarifa`), `Tarifa`, `Monto`; `ImpuestoNeto` |
| Nota de crédito / débito | `InformacionReferencia`: `TipoDocIR` (`TipoDoc`), `Numero` (la clave de la factura que corrige), `Codigo` (anula / corrige monto / …), `Razon` |
| Respuesta de Hacienda | `MensajeHacienda`: `Clave`, `Mensaje` (aceptado / rechazado), `DetalleMensaje` |

Reglas del parser: lee por nombre de elemento sin depender del espacio de nombres (así sirve para v4.3 y v4.4) ·
números con punto decimal, guardados como `numeric` · un elemento desconocido se ignora, uno obligatorio ausente manda
a «revisar» · función pura con pruebas sobre XML **ficticios** en el repo (emisor «Proveedor de prueba N», cédulas y
montos inventados); las muestras reales se prueban en staging y no se suben.

### 4.5 Casos de F1

| Caso | Qué pasa |
|---|---|
| Mismo XML dos veces (reenvío, dos correos) | Una sola fila; el segundo responde «duplicado» |
| Zip con varias facturas | Cada XML es un comprobante; el correo se etiqueta cuando todos respondieron 2xx |
| Llega la respuesta de Hacienda antes que la factura | Se guarda en `fe_respuestas` por clave; se une al comprobante cuando llegue |
| Hacienda **rechazó** el comprobante | Queda visible como «rechazada por Hacienda»; no entra al cruce ni a costos |
| Correo solo con PDF | «fe-sin-xml»; cuenta en la pantalla de control para pedirle el XML al proveedor |
| XML que no es del negocio | «receptor distinto», a revisión del contador |
| El script deja de correr | Pantalla de control: «última ingesta hace N h» en rojo si pasa de 6 h en horario de proveedores |

### 4.6 Borrador de esquema F1 — **requiere firma**

| Tabla | Columnas principales | Escribe / lee |
|---|---|---|
| `fe_comprobantes` | `id` · `location_id` · `clave` (única, 50) · `tipo` (factura / nota_credito / nota_debito / tiquete / factura_compra) · `consecutivo` · `fecha_emision` · `emisor_cedula` · `emisor_nombre` · `supplier_id` (por cédula, puede ser null) · `moneda` · `tipo_cambio` · `condicion_venta` · `plazo_credito` · `medio_pago` · `total_venta_neta` · `total_impuesto` · `total_comprobante` · `ref_clave` · `ref_codigo` · `ref_razon` · `xml_path` · `xml_sha256` · `estado_parseo` (ok / revisar / receptor_distinto) · `motivo` · `recibido_en` · `creado_en` | Escribe solo la Edge (service role). Lee gerencia de su local. |
| `fe_lineas` | `comprobante_id` · `numero_linea` · `cabys` · `codigo_comercial_tipo` · `codigo_comercial` · `detalle` · `cantidad` · `unidad` · `unidad_comercial` · `precio_unitario` · `monto_total` · `descuento` · `subtotal` · `impuesto_tarifa` · `impuesto_monto` · `total_linea` | Igual |
| `fe_respuestas` | `clave` · `mensaje` (aceptado / rechazado) · `detalle` · `recibido_en` | Igual |
| `fe_ingesta_bitacora` | `location_id` · `ts` · `resultado` (nuevo / duplicado / revisar / no_comprobante / sin_xml / error) · `clave` (si hay) · `motivo` — **sin contenido del correo** | Escribe la Edge. Lee owner y contador. |

Sin `update` ni `delete` por la API. `supplier_id` se resuelve por cédula contra `suppliers`; si el proveedor no
existe, queda null y aparece en la pantalla de control («proveedor nuevo»): **no se crea solo**.

---

## 5. F2 — Cruce con la Bandeja

### 5.1 Reglas

Solo lectura sobre `documents` y `cash_movements`. Se cruzan comprobantes `ok`, aceptados por Hacienda (o sin
respuesta todavía, marcado), contra documentos **vigentes** de la Bandeja (misma definición que `documentoVigente`).

1. **Por clave:** `fe_comprobantes.clave = documents.clave_fe` → cruce directo.
2. **Si no hay clave en la foto:** misma cédula de proveedor **y** total dentro del margen **y** fecha del documento
   dentro de la ventana respecto de la emisión.
   - Margen por defecto: el mayor entre 1 % y un mínimo fijo chico (redondeos); ajustable por proveedor.
   - Ventana por defecto: −15 / +30 días; ajustable por proveedor (hay quien factura antes y quien factura después).
   - Misma moneda. Si la foto no trae cédula, se usa el `supplier_id` del movimiento enlazado.
3. **Más de un candidato → «Para revisar».** Nunca elige solo. Orden de la lista: total y fijo (diferencia de monto,
   distancia de fecha, fecha de carga, `id`) para que dos personas vean lo mismo (R06).
4. Un cruce resuelto a mano queda con quién y cuándo, y no lo pisa una corrida posterior.
5. El cruce corre al entrar un comprobante (F1) y una vez por noche para lo que la Bandeja cargó después.

### 5.2 Estados

| Estado | Cuándo | Quién lo ve y qué hace |
|---|---|---|
| **Conciliada** | FE y recepción cruzadas, totales dentro del margen | Nadie tiene que hacer nada |
| **Montos distintos** | Cruzadas por clave o a mano, pero el total difiere más que el margen | Quien paga: «revisar antes de pagar», con las dos cifras |
| **Recibida, falta FE** | Hay recepción en la Bandeja, el proveedor emite FE y todavía no llegó (dentro de sus días habituales) | Informativo; pasa a aviso si supera la demora habitual |
| **Recibo sin FE** | Recepción de un proveedor marcado «no emite FE» | Estado final válido; no genera aviso |
| **FE sin recepción** | Llegó la FE y nadie subió nada a la Bandeja dentro de la ventana | Aviso al gerente del local: ¿llegó el producto? |
| **Para revisar** | Varios candidatos, receptor distinto o parseo dudoso | Gerente o contador elige o descarta |
| **Nota de crédito** | NC cruzada con su factura por `ref_clave` | Se muestra junto a la factura; ver §5.3 |

### 5.3 Casos borde de F2

| Caso | Regla |
|---|---|
| **Proveedor sin FE** | Ficha del proveedor con «no emite FE» → sus recepciones quedan «Recibo sin FE», sin avisos. Sus compras entran a F3 desde lo que leyó la Bandeja (§6.4). |
| **Factura antes de la entrega** | La FE queda «FE sin recepción» recién cuando vence la ventana **posterior** del proveedor; antes se ve como «en espera de recepción». |
| **Factura después de la entrega** | La recepción queda «Recibida, falta FE» hasta los días habituales del proveedor; después, aviso. |
| **Nota de crédito** | Se une a su factura por `ref_clave`. Total esperado = factura − NC. Si la NC anula todo, la factura queda «Anulada por NC» y sale del pendiente de revisión. Nunca toca el movimiento de caja: si ya se pagó, queda el aviso «pagada con NC posterior» para el contador. |
| **Factura duplicada** | Mismo XML: lo frena F1. Misma compra con dos claves distintas (el proveedor refacturó): mismo proveedor, mismo total y fecha cercana, sin NC que anule la primera → «Para revisar: posible refacturación». |
| **Pago que agrupa varias facturas** | El cruce es FE ↔ recepción, una a una; el pago es otra capa. Si el movimiento de pago no calza con una sola FE, se buscan las FE conciliadas y sin pago de ese proveedor cuya **suma** da el monto (margen) dentro del período; una sola combinación → se **sugiere** «este pago cubre N facturas»; varias → revisión. Solo sugerencia, confirmada por quien paga. |
| **Foto con varias facturas** | Un documento de la Bandeja puede traer 2–3 facturas en `raw_json.documentos`: cada una se cruza por separado. |
| **Movimiento borrado** | Documento huérfano: deja de ser vigente; el cruce se recalcula y la FE vuelve a «FE sin recepción». |

### 5.4 Ficha de proveedor (automática, el owner corrige)

Calculada: emite FE o no · factura antes o después · días de demora habituales · % de cruces con montos distintos ·
cuántas FE por mes. Editable (owner): «no emite FE», ventana y margen propios.

### 5.5 Borrador de esquema F2 — **requiere firma**

| Objeto | Qué guarda |
|---|---|
| `fe_cruces` | `comprobante_id` · `document_id` (null si no hay) · `indice_documento` (posición dentro de `raw_json.documentos`) · `metodo` (clave / cedula_total_fecha / manual) · `estado` · `diferencia` · `resuelto_por` · `resuelto_en` · `nota` · `vigente` |
| `fe_pago_grupos` | sugerencia o confirmación «pago ↔ N comprobantes»: `cash_movement_id` · `comprobante_id` · `confirmado_por` |
| `proveedor_compras_config` | `supplier_id` · `location_id` · `emite_fe` · `ventana_antes` · `ventana_despues` · `margen_pct` · `dias_pedido` · `demora_dias` (estos dos los usa F4) |
| `compras_conciliacion` (vista o función) | Une recepciones y comprobantes con su estado y el estado del pago (`cash_movements.status`), por local. **Solo lectura.** |

Permisos: lee gerencia (`owner`, `contador`; `manager` solo su local). Resuelve «Para revisar»: `owner`, `contador`
y `manager` de su local. `cajero` y el puesto `proveedor` no ven nada nuevo.

---

## 6. F3 — Línea del proveedor ↔ producto del catálogo, y costo

### 6.1 La asociación

- Llave de lo aprendido: **proveedor + código comercial + unidad**. Si la línea no trae código comercial: proveedor +
  CABYS + detalle normalizado (sin acentos, minúsculas, espacios simples) + unidad.
- Lo que se guarda: producto del catálogo (`inv_productos`) · **factor de conversión** a la unidad del producto ·
  o «no es de inventario» (flete, servicio, envase retornable), para que no vuelva a la cola.
- Ejemplo ficticio: Proveedor de prueba 1, código `ABC-24`, unidad «caja», detalle «Producto A caja 24 Ud» → Producto
  A (unidad Ud), factor 24. Una factura con 3 cajas suma 72 Ud; el costo unitario es el precio de la caja ÷ 24.
- **Aprendida por proveedor:** la primera vez la asocia el gerente; desde ahí, toda línea con la misma llave se aplica
  sola. El mismo código en otro proveedor no hereda nada.
- **Línea con unidad nueva:** si llega el mismo código con una unidad que no se vio (antes «caja», ahora «Ud»), **no**
  se aplica el factor viejo: va a la cola con el antecedente a la vista («antes: caja × 24»).
- **Guardas del factor:** si el costo unitario que resulta se aleja más de 3 veces del último costo del producto, la
  línea queda «factor a confirmar» (el error típico: factor 24 aplicado a una línea que ya venía en unidades).
- Producto en gramos: el factor convierte kg, libras o la presentación (bolsa de 5 kg → 5000).

### 6.2 Cola «líneas sin asociar» (gerente)

Agrupada por proveedor y llave: una decisión resuelve todas las líneas iguales, también las pasadas. Acciones:
asociar a un producto (con factor) · crear producto nuevo (lo completa el encargado del área) · «no es de
inventario». Asocian: `owner`, `manager` de su local, `contador`.

### 6.3 Costo

- **Compra registrada** por cada línea asociada: producto, fecha de emisión, cantidad en la unidad del producto,
  costo unitario, origen. Las notas de crédito entran en negativo.
  Propuesta G-014: sumar la **hora de recepción** para el corte del conteo (§7.9 B1).
- **Costo último:** el de la compra más reciente. **Costo promedio:** ponderado por cantidad en una ventana (propuesta:
  últimos 90 días; pregunta 6). Los dos se muestran; cuál usa cada reporte lo decide el contador.
- **Con o sin IVA:** propuesta: costo **sin** IVA, con el impuesto guardado aparte (pregunta 5, contador).
- **Moneda:** se guarda en la moneda de la factura y en colones con el `TipoCambio` del propio XML.
- **Aviso de suba de precio:** cuando el costo unitario de una compra supera en más de un umbral (propuesta 8 %,
  ajustable) al promedio de las tres compras anteriores del mismo producto y proveedor. Se ve en el Inicio de
  gerencia y en la ficha del producto, con el antes y el después. Una baja mayor al umbral también se marca (puede
  ser un factor mal puesto).
- **Avisos ordenados por plata, no por % (G-012 v3):** cada aviso suma el **impacto mensual estimado** = diferencia de
  costo unitario × cantidad comprada en los últimos 30 días, en colones, y la lista se ordena por ese monto. Acciones:
  «Visto» o «Avisar al proveedor», que **copia** un texto (principio 6: nunca envía). Si el factor de conversión de la
  línea es nuevo, no hay aviso de precio: primero se confirma el factor (§6.1).

### 6.4 Compras sin factura electrónica

Proveedor sin FE (o FE que nunca llegó): las líneas salen de lo que `extract-document` leyó de la foto
(`raw_json…items`), entran a la misma cola con la marca «leído de foto» y **siempre** las confirma una persona antes
de contar como compra (la lectura de una foto manuscrita no es exacta). Si después llega la FE de esa misma compra,
la compra «de foto» queda reemplazada por la del XML (una sola cuenta).

**Cómo se garantiza (D-CSC-5):** la compra es un movimiento `compra` de `inv_movimientos` con `idem_key` única:
clave de la FE + número de línea si viene del XML; documento de la Bandeja + número de línea si viene de la foto.
Procesar N veces la misma línea deja **un** movimiento. Cuando llega la FE de una compra que ya entró por foto, el
movimiento de foto pasa a `reemplazado` y queda vigente el de la FE: nunca suman los dos. Una nota de crédito es un
movimiento `nc` negativo, enlazado al de la factura. El stock sube cuando la línea queda **asociada a un producto**
(§6.1), no antes. Mientras F3 no exista, la entrada a stock de `InvRevision` (§1.1) sigue como está; qué se hace con
ella es la fase 0: etiquetar «provisorio» (decisión P4, §12.2).

### 6.5 Relación con `supplier_item_map` e `ingredient_prices`

Hoy existen y los usa la Revisión de inventario (`InvRevision`). Propuesta: tablas nuevas `inv_*` (abajo) y las
viejas quedan como están hasta que F4 reemplace el módulo; lo ya aprendido en `supplier_item_map` se ofrece como
sugerencia inicial en la cola, no se aplica solo (apunta a `ingredients`, no al catálogo nuevo).

### 6.6 Borrador de esquema F3 — **requiere firma**

| Tabla | Columnas principales |
|---|---|
| `inv_linea_producto` | `location_id` · `supplier_id` · `codigo_comercial` · `cabys` · `detalle_norm` · `unidad` · `producto_id` (null si no es de inventario) · `es_inventario` · `factor` (> 0) · `creado_por` · `creado_en` · `reemplaza_a` |
| `inv_compras` | `location_id` · `producto_id` · `supplier_id` · `fecha` · `cantidad` (unidad del producto; negativa en NC) · `costo_unitario` · `impuesto_unitario` · `moneda` · `tipo_cambio` · `origen` (fe / foto / manual) · `fe_linea_id` · `document_id` · `estado` (vigente / reemplazada / a_confirmar) |
| `inv_costos` (vista) | por producto: costo último, promedio, fecha, proveedor, variación |

**Con D-CSC-5 (27-nov), borrador que reemplaza a `inv_compras` como tabla — requiere firma:**

| Objeto | Columnas o regla |
|---|---|
| **`inv_movimientos`** (ledger único) | `location_id` · `tipo` (compra / nc / consumo_teorico / merma / traspaso_salida / traspaso_entrada / produccion) · `producto_id` · `lugar_id` (opcional) · `cantidad` (±, unidad del producto) · `costo_unitario` · `impuesto_unitario` · `moneda` · `tipo_cambio` · `fecha` · `recibido_en` (B1) · `idem_key` **única** · `origen_ref` (línea de FE / documento / turno / traspaso) · `estado` (vigente / reemplazado / a_confirmar) · quién y cuándo. Sin `update` ni `delete` de cantidades. |
| `inv_compras` | Deja de ser tabla: es la lectura de los movimientos `compra` y `nc` (vista, si hace falta el nombre). |
| `pl_cuentas` | Plan de cuentas chico del P&L gerencial: nombre · tipo (costo de ventas / gasto operativo). Cada cuenta se mapea a una de `finance_accounts` (decisión P1, §12.2; el contador valida la lista). |
| `inv_productos.cuenta_pl` | Cuenta del producto; obligatoria al crear un producto (§6.7). |
| `fe_linea_cuenta` | Línea de FE **sin producto** (servicio o gasto) → cuenta; aprendida por la misma llave de §6.1. |
| `inv_stock`, `food_cost_periodo`, `pl_mensual` (vistas) | Calculadas desde el ledger, los conteos y las FE; nada se guarda a mano (§15). |

El conteo físico sigue en `inv_conteo_envios` / `inv_conteos` (§7.7), que ya son un registro que solo inserta; la vista
`inv_stock` parte del último conteo **completo** y le suma los movimientos posteriores. Si además el conteo deja una
fila «ancla» en el ledger (como propone la entrega) se cierra en el borrador de esquema de F4a.

### 6.7 Línea → cuenta del P&L, en la misma cola (G-012 v3, D-CSC-6)

- La cola «líneas sin asociar» (§6.2) resuelve también la **cuenta**: toda línea de FE termina en un producto (que
  trae su cuenta) o, si es un servicio o un gasto sin producto, en una cuenta elegida con un toque. La opción «no es
  de inventario» de §6.1 pasa a pedir esa cuenta.
- La cuenta de una línea sin producto se recuerda con la misma llave de §6.1 (proveedor + código comercial + unidad):
  la próxima línea igual se resuelve sola.
- **Producto nuevo:** nombre + unidad (lista cerrada) + área + cuenta (lista cerrada). Sin unidad o sin cuenta no se
  crea. El ID lo pone el sistema; mínimo y par quedan vacíos hasta que los cargue el encargado. Un producto no se
  borra: pasa a inactivo.
- **Proveedor:** nunca se da de alta solo. Una cédula desconocida va a «emisor nuevo», que ya existe (mig 203).
- Lo que no tiene cuenta no se esconde: el P&L lo muestra aparte como «sin cuenta», con su monto (§15).

---

## 7. F4 — Inventario: conteo, gerencia y pedido sugerido

Parte de lo probado en el piloto (reglas 1–9 de la [v0](SPEC-inventario-v0.md) §2). Acá va solo lo que se agrega o
se decide.

### 7.1 Dos vías, un solo código (D-CSC-1)

- Un módulo `conteo` único (pantallas, reglas y cola sin señal). Se monta en dos lugares:
  - **Dentro de Satori App:** ruta `/inventario/conteo`, con la sesión de quien entró.
  - **Link aparte:** segunda entrada del mismo build (`…/conteo/`), con su propio manifiesto para **instalarse** en la
    tablet o el celular. Un link por área (`?area=barra`): al instalar, el ícono dice «Conteo · Barra» y abre directo
    en los lugares de esa área. Sin menú, sin el resto de la app.
- Las dos vías llaman a las **mismas funciones** de la base y escriben en la misma tabla. Lo único distinto es cómo se
  identifica el aparato (sesión o habilitación).

### 7.2 Habilitar el aparato e identificar a quien cuenta (D-CSC-2)

1. **Una vez, un gerente:** en Satori App → Inventario → Dispositivos → «Habilitar un aparato» elige local y áreas y
   obtiene un código de un solo uso (válido 10 min, también como QR). En la tablet abre el link, escribe el código y
   listo. El aparato guarda una credencial propia; la base guarda solo su huella. Se le pone nombre («Tablet barra»).
2. **Cada conteo:** la pantalla muestra la lista de **empleados activos de ese local**; se toca un nombre. Sin clave.
3. **Qué puede hacer un aparato habilitado:** leer áreas, lugares y productos de su local (nombre, unidad, orden;
   **sin costos ni proveedores**), leer la lista de nombres para elegir, y **insertar** conteos. Nada más.
4. **Revocar:** owner o manager, en la misma pantalla; el aparato deja de funcionar al instante y lo que tenga en
   cola se rechaza con motivo visible («este aparato ya no está habilitado; avisá al gerente»).
5. Dentro de Satori App también se elige el nombre del empleado (queda la sesión **y** el nombre elegido).
6. **Riesgo aceptado y acotado:** quien tenga el aparato puede contar a nombre de otro. Se acepta (igual que la
   planilla de hoy); queda registrado el aparato, la hora y el nombre, y la lista muestra solo nombre e inicial del
   apellido.

### 7.3 Pantalla de conteo

Flujo: **nombre → lugar → productos de ese lugar → enviar**. La fecha la pone el sistema (calendario del área: día 1
y lunes; un envío va a la última fecha del calendario que ya llegó).

```
┌──────────────────────────────┐   ┌──────────────────────────────┐
│ Conteo · Barra      ● en línea│   │ ← Cámara 1        lun 30-nov │
│ ¿Quién cuenta?               │   │ Cuenta: Ana P.      12 de 18 │
│ ┌──────────┐ ┌──────────┐    │   ├──────────────────────────────┤
│ │ Ana P.   │ │ Beto R.  │    │   │ Producto A            botella│
│ └──────────┘ └──────────┘    │   │                    [  2,5  ] │
│ ┌──────────┐ ┌──────────┐    │   │ Producto B             gramos│
│ │ Caro S.  │ │ Dani M.  │    │   │                    [  12   ] │
│ └──────────┘ └──────────┘    │   │  ⚠ ¿Son gramos? 12 g es muy  │
├──────────────────────────────┤   │    poco.  [Sí, 12 g] [Corregir]│
│ Lugares de hoy (lun 30-nov)  │   │ Producto C              unidad│
│ ✓ Barra frente      Beto R.  │   │                    [      ]  │
│ ◐ Cámara 1   12 de 18 · vos  │   │               [ No hay (0) ] │
│ ○ Bodega seca                │   ├──────────────────────────────┤
│ ⏳ 1 envío esperando señal    │   │ [ Seguir después ] [ Enviar ]│
└──────────────────────────────┘   └──────────────────────────────┘
```

- **Teclado numérico** propio de la pantalla (botones grandes, coma decimal, «borrar», «siguiente»); no depende del
  teclado del sistema. Un valor ilegible no se guarda y lo dice (R29–R35).
- **La unidad siempre a la vista**, del catálogo; nunca un campo libre.
- **«¿Son gramos?»:** producto en gramos con un valor mayor a 0 y menor a 20 → pregunta antes de aceptar (el error
  típico es anotar kilos). «Sí» queda registrado como confirmado.
- **Vacío no es cero.** Cada producto lleva un número o «No hay (0)». «Enviar» con vacíos avisa cuántos faltan y
  deja elegir: completar o enviar **parcial**.
- **Conteo a medias:** «Seguir después» guarda el borrador en el aparato (por lugar y fecha) y, si hay señal, también
  en la base como **parcial**. Un lugar parcial se ve ◐ y **no cuenta como hecho**; el total del producto no aparece
  hasta que todos sus lugares estén completos (regla 1 del piloto). Cualquiera puede retomar un parcial desde otro
  aparato: ve lo ya cargado y quién lo cargó.
- **Sin señal:** todo se puede contar sin conexión (el catálogo queda guardado en el aparato al abrir). El envío
  entra a una cola con identificador propio por envío; al volver la señal sale solo, una sola vez (reintento seguro).
  La pantalla muestra «⏳ N envíos esperando señal» y no deja creer que ya se guardó. Un rechazo de la base se
  muestra con su motivo y **no se pierde** lo tecleado.
- **Dos personas en el mismo lugar:** al abrir un lugar que otro tiene en curso, aviso «Beto R. lo está contando
  desde las 14:05» con «Contar otro lugar» (recomendado) o «Contar igual». Si llegan dos envíos completos del mismo
  lugar y fecha: **vale el último**, el anterior queda «Reemplazado» (regla 3 del piloto), y si difieren, gerencia ve
  «doble conteo» con las diferencias producto por producto. Nunca se suman ni se mezclan dos envíos. Sin señal no hay
  aviso previo: la regla se aplica al llegar.
- **Pruebas:** el modo prueba del piloto se mantiene (un empleado ficticio «Prueba» por local; no cuenta).
- **Fechas viejas:** antes de la fecha de arranque del área no entra ningún conteo real.

### 7.4 Gerencia (dentro de Satori App)

```
┌ Inventario · Santa Teresa ─────────────────────────────────────────────┐
│ [Resumen] [Conteos] [Pedido] [Compras] [Catálogo] [Dispositivos]       │
├────────────────────────────────────────────────────────────────────────┤
│ Conteo del lun 30-nov   Barra ✓ 5/5    Cocina ◐ 3/6 (faltan 3 lugares) │
│ Cumplimiento 8 semanas  Barra 8/8      Cocina 6/8                      │
├────────────────────────────────────────────────────────────────────────┤
│ ⚠ Bajo mínimo (4)                 ⏱ Se acaba antes del próximo pedido (2)│
│ Producto A   3 Ud   mín 6         Producto D  alcanza 2 días · pedido   │
│ Producto B   800 g  mín 2000                  llega en 4                │
├────────────────────────────────────────────────────────────────────────┤
│ ↑ Subas de precio (1)             ? Líneas sin asociar (7)             │
│ ⚑ Doble conteo (1)                ? Consumo negativo (1)               │
└────────────────────────────────────────────────────────────────────────┘
```

- **Bajo mínimo:** stock del último conteo completo + compras posteriores < mínimo.
- **Consumo entre conteos** = conteo anterior + compras de F3 entre las dos fechas − conteo actual. Solo entre conteos
  **completos**. Consumo negativo = falta una compra o hay un error de conteo → se lista para revisar, no se oculta.
- **«Se acaba antes del próximo pedido»:** consumo diario = promedio de los últimos intervalos (propuesta: 4);
  días que alcanza = stock ÷ consumo diario; se marca si alcanza menos que los días hasta la **próxima entrega** de
  ese proveedor (próximo día de pedido + demora, de `proveedor_compras_config`). Sin historia suficiente dice «sin
  datos todavía», no inventa.
- **Cumplimiento de conteos:** por área y fecha del calendario: Hecho · En curso · Incompleto · Atrasado; quién
  contó cada lugar; % de las últimas 8 semanas. Aviso por correo de la v0 (lunes y día 1, 21:00 CR) se mantiene.
- **Stock valorizado y consumo con costo** (owner y contador): cantidades × costo de F3.

### 7.5 Pedido sugerido

- Por proveedor: **sugerido = par − stock − pedidos en camino**, nunca negativo, redondeado **hacia arriba** a la
  unidad de compra (factor de F3: si se compra por caja de 24 y faltan 30 Ud → 2 cajas).
- Stock = último conteo completo + compras posteriores. **En camino** = pedidos marcados «enviado» y todavía no
  recibidos.
- El gerente ajusta cantidades, agrega o saca líneas, y toca **«Copiar para WhatsApp»**: el texto queda en el
  portapapeles (y el botón de compartir del aparato, si lo tiene). **La app nunca envía nada a un proveedor.**
- Después de copiar, pregunta «¿Lo enviaste?» → **Enviado** (pasa a «en camino») o queda en borrador. Un pedido en
  camino se cierra cuando llega la recepción o la FE de ese proveedor (la app lo **sugiere** y el gerente confirma), a
  mano, o vence solo a los N días (propuesta 10) con aviso.

```
┌ Pedido · Proveedor de prueba 1 ──────────── entrega: jue ─────────────┐
│ Producto      stock   par   en camino   sugerido      pedir          │
│ Producto A    6 Ud    48    0           42 → 2 cajas  [ 2 ] cajas    │
│ Producto B    10 Ud   12    0           2  → 1 caja   [ 1 ] cajas    │
│ Producto C    30 Ud   24    0           0             [ 0 ]          │
│                         [ Copiar para WhatsApp ]   [ Guardar borrador ]│
└───────────────────────────────────────────────────────────────────────┘
Texto copiado (ejemplo ficticio):
  Pedido Satori Santa Teresa · jueves
  2 cajas · Producto A
  1 caja · Producto B
  Gracias.
```

### 7.6 Importación desde las planillas piloto

Sin datos reales en el repo: acá va solo el **formato**. Se exporta cada pestaña a CSV y un script la carga, primero
en staging y en modo simulación (informe de qué entraría, qué se rechaza y por qué).

| Archivo (uno por área) | Columnas | Reglas |
|---|---|---|
| Catálogo | `id` · `activo` · `categoria` · `grupo` · `producto` · `unidad` · `proveedor` · `costo_unitario` · `minimo` · `par` · `lugares` (lista separada por «;») · `notas` · `activo_desde` | `unidad` de la lista cerrada; `proveedor` tiene que existir en `suppliers` (si no, queda sin proveedor y se lista); el `id` del piloto se conserva como `id_piloto` |
| Conteos | `fecha_conteo` · `enviado` · `quien` · `area` · `lugar` · `id_producto` · `cantidad` · `estado` (vigente / reemplazado / prueba) | Se importan los tres estados; `quien` queda como texto (`quien_piloto`), sin atarlo a un empleado |
| Histórico | `id_producto` · una columna por fecha con el total | Entra como conteo «histórico» sin lugar (un total por producto y fecha), solo para fechas **anteriores** al arranque del área |
| Dudosos | `id_producto` · `fecha` · `valor_original` · `valor_normalizado` · `motivo` | Marca `dudoso` en el histórico; los reportes lo señalan y no lo usan para promedios |

La importación es repetible (misma entrada → mismo resultado, sin duplicar) y deja un informe: productos, lugares,
conteos e históricos cargados; filas rechazadas con motivo.

### 7.7 Borrador de esquema F4 — **requiere firma**

Las tablas de la v0 §4 (`inv_areas`, `inv_lugares`, `inv_productos`, `inv_producto_lugar`, `inv_conteo_fechas`,
`inv_conteos`, vista `inv_totales`), con `location_id`, más:

| Tabla | Columnas principales |
|---|---|
| `inv_productos` (agrega) | `id_piloto` · `unidad_compra` y `factor_compra` por defecto (para redondear el pedido) |
| `inv_conteo_envios` | `id` (lo pone el aparato: reintento seguro) · `location_id` · `area_id` · `lugar_id` · `fecha_conteo` · `empleado_id` · `dispositivo_id` o `perfil_id` · `tipo` (completo / parcial / prueba / histórico) · `estado` (vigente / reemplazado) · `enviado_en` · `recibido_en` |
| `inv_conteos` (líneas) | `envio_id` · `producto_id` · `cantidad` · `gramos_confirmado` · `dudoso` |
| `inv_dispositivos` | `location_id` · `nombre` · `areas` · `huella_credencial` · `habilitado_por` · `habilitado_en` · `ultimo_uso` · `revocado_por` · `revocado_en` |
| `inv_dispositivo_codigos` | código de un solo uso (huella), vence a los 10 min |
| `inv_pedidos` / `inv_pedido_lineas` | `location_id` · `supplier_id` · `estado` (borrador / enviado / recibido / vencido / cancelado) · `creado_por` · `enviado_en` · `recibido_en` · líneas: `producto_id` · `cantidad` · `unidad_compra` · `factor` |

Acceso del aparato: **nunca directo a las tablas**. Entra por funciones (o una Edge) que validan la credencial del
aparato, su local y sus áreas; `anon` no tiene permisos sobre ninguna tabla `inv_*`.

### 7.8 Permisos por rol (borrador — 🖊️)

| | owner | contador | manager (su local) | empleados (aparato habilitado) |
|---|---|---|---|---|
| Contar | sí | sí | sí | sí (eligiendo su nombre) |
| Catálogo: productos, lugares, orden | sí | sí | sí | no |
| Catálogo: costo, proveedor, mínimo, par | sí | sí | mínimo y par | no |
| Ver costos, stock valorizado, consumo con costo | sí | sí | pregunta 8 | no |
| Asociar líneas (F3) | sí | sí | sí | no |
| Resolver cruces (F2) | sí | sí | sí | no |
| Pedido: armar, copiar, marcar enviado | sí | no (ve) | sí | no |
| Habilitar y revocar aparatos | sí | no | sí | no |
| Pantalla de control de la ingesta (F1) | sí | sí | no | no |

### 7.9 Bordes del conteo (G-014)

Entrega **G-014** del Auditor (26-nov-2026), contrastada contra esta spec y la [v0](SPEC-inventario-v0.md). Son
**propuestas**: nada de acá está decidido ni autoriza esquema. No cambia ninguna decisión tomada (D-INV-1 a 5,
D-CSC-1 a 4, §12.1); donde una propuesta roza una regla del piloto, lo dice.

**Lo nuestro que el mercado no tiene y se conserva tal cual:** total solo con **todos** los lugares · vacío ≠ 0 ·
reenvío reemplazado con historial · doble conteo con diferencias · aparato habilitado sin clave + nombre · envíos de
prueba · cola sin señal · histórico migrado con dudosos.

| # | Borde | Recomendación | Esquema | Hay que decidirlo antes de |
|---|---|---|---|---|
| B1 | Hora de corte | Corte fijo por área + hora de recepción | 🖊️ | F3 (compras) |
| B2 | Traspasos | Salida + entrada con estado enviado / recibido | 🖊️ (y costo) | F4a |
| B3 | Producto movido con conteo abierto | Regla en pantalla + marca «conteo estirado» | no | F4b |
| B4 | Teclear en unidad de compra | Una unidad guardada + «cajas + sueltos» | 🖊️ | F4a |
| B5 | Botellas abiertas | Escala fija, método anotado | 🖊️ | F4a |
| B6 | Control de magnitud | Pregunta contra el conteo anterior y el par | 🖊️ (acceso del aparato) | F4a |
| B7 | Producción propia | Elaboración = producto contable; costo en F5 | 🖊️ | F4a |
| B8 | Variación en ₡ y por rubro | Vista en colones agrupada por categoría | 🖊️ solo decimales del costo | F3 |
| B9 | Parcial que nunca se completa | Vence al cierre del día siguiente | no (cambia regla 2 del piloto) | F4b |
| B10 | Frecuencia | Lista corta semanal + completo el día 1 | 🖊️ | F4a |
| B11 | Multi-local | Identidad compartida + configuración por local | 🖊️ | **migración del catálogo (antes de F3)** |

**B1 · Hora de corte del conteo.** Hoy la v0 y §7.3 fijan **fecha**, no hora, y §6.3 asienta la compra por fecha de
emisión. Una entrega del mismo día contada antes de que llegue (o después) duplica o resta consumo.
- Opciones: **(a)** seguir solo con fecha · **(b)** corte fijo por área («antes de recibir» o «al cierre») + hora de
  recepción en la compra · **(c)** congelar recepciones mientras hay un conteo abierto.
- **Recomendación: (b).** (c) frena la operación; (a) deja el error adentro.
- Regla: compras y traspasos con hora **≤ corte** entran **antes** del conteo; el resto, al intervalo siguiente.
- La FE no trae hora de recepción: se toma la de la **recepción de la Bandeja** (cruce de F2). Sin recepción, vale la
  fecha de emisión con la marca «hora supuesta», y el producto se señala si el consumo da negativo.
- Conteo atrasado (el martes lo del lunes): el corte efectivo es la hora real en que se contó cada lugar; gerencia lo
  ve «fuera de corte». Una entrega entre el conteo de dos lugares del mismo producto va «a revisar», no se adivina.
- 🖊️ Esquema: `corte` en `inv_areas` · `recibido_en` en `inv_compras` (la `fecha` de emisión no cambia: el costo
  sigue saliendo de ahí) · hora de conteo del aparato en `inv_conteo_envios` (distinta de `recibido_en` si hubo cola).

**B2 · Traspasos (local ↔ local y área ↔ área).** Ninguna spec los tiene. Sin registro, un préstamo de barra a
cocina se ve como consumo en una y como consumo negativo en la otra.
- Opciones: **(a)** no registrar · **(b)** un solo paso (sale y entra a la vez) · **(c)** dos pasos: salida en origen
  + entrada en destino, con estado **enviado / recibido**.
- **Recomendación: (c)**, cargado en gerencia de Satori App (no en el aparato de conteo, en la primera versión).
  Dentro del mismo local quien recibe confirma con un toque; un «enviado» sin recibir a los N días (propuesta 3) da
  aviso. Se registra **antes** del conteo y le aplica el corte de B1.
- Consumo = conteo anterior + compras + traspasos recibidos − traspasos enviados − conteo actual.
- Valor: al costo de referencia del origen (promedio de 90 días, §12.1). Mueve costo entre áreas y locales → plata.
- Necesita que el producto sea **el mismo** en origen y destino (B11).
- 🖊️ Esquema: `inv_traspasos` y sus líneas (origen, destino, producto, cantidad, costo, estado, quién y cuándo en
  cada paso). Registro, no edición (principio 4).

**B3 · Producto movido entre lugares con una fecha de conteo abierta.** Si se cuenta la cámara, alguien sube producto
a la barra y después se cuenta la barra, sale doble; al revés, ninguno.
- Opciones: **(a)** nada · **(b)** regla operativa: con un lugar ◐ o sin contar no se mueve producto de esa área; la
  pantalla lo recuerda y va a la guía SOP · **(c)** marca «conteo estirado» cuando los lugares de un producto se
  contaron con más de N horas de diferencia (propuesta 4) · **(d)** registrar cada movimiento entre lugares.
- **Recomendación: (b) + (c).** (d) es fricción diaria para un dato que no se usa. El total sigue apareciendo solo
  con todos los lugares; «estirado» lo marca para revisar, no lo esconde.
- Esquema: no (sale de las horas de envío). El umbral, configurable.

**B4 · Teclear en unidad de compra.** Contar 2 cajas y 5 sueltos obliga hoy a multiplicar de cabeza.
- Opciones: **(a)** como hoy · **(b)** una unidad guardada + teclado «cajas + sueltos»: la pantalla muestra el
  factor («caja = 24 Ud») y el resultado («53 Ud») antes de aceptar; se guarda 53 y se anota cómo se tecleó ·
  **(c)** varias unidades guardadas por producto.
- **Recomendación: (b).** D-INV-3 queda intacta; (c) la rompe y se descarta.
- El botón «cajas» aparece solo en productos con factor **confirmado** por encargado o contador. El factor de conteo
  es del producto (`factor_compra`, §7.7); el de cada línea de proveedor (§6.1) es otro y puede diferir.
- 🖊️ Esquema: en `inv_conteos`, cajas y sueltos tecleados y factor usado · en `inv_productos`, quién confirmó el
  factor y cuándo.

**B5 · Botellas abiertas.** Hoy entra cualquier decimal («2,5»), cada uno estima distinto.
- Opciones: **(a)** decimal libre · **(b)** escala fija: botones «llena / ¾ / ½ / ¼» y pasos de 0,1, con el método
  anotado («a ojo») · **(c)** balanza para todo.
- **Recomendación: (b).** Balanza solo en F5 y solo para destilados caros.
- 🖊️ Esquema: modo de conteo por producto (entero / decimal / botella) y `metodo` en la línea del conteo.

**B6 · Control de magnitud general.** «¿Son gramos?» atrapa un solo error.
- Opciones: **(a)** solo «¿Son gramos?» · **(b)** además, pregunta si el valor es ×10 o ÷10 del conteo anterior de
  ese lugar, o más de 3× el par · **(c)** bloquear.
- **Recomendación: (b)**, como pregunta («Sí, es 240» queda registrado), nunca bloqueo. La pantalla **no muestra** el
  número anterior, para no sesgar a quien cuenta.
- 🖊️ El aparato tendría que leer par y último conteo (hoy §7.2 le da solo nombre, unidad y orden): amplía el acceso
  sin sesión → firma. `gramos_confirmado` pasa a ser una confirmación con motivo.

**B7 · Producción propia contable.** Caldos, salsas y preparaciones ya hechas son stock: si no se cuentan, el
consumo del mes carga ingredientes que siguen en la cámara. Es la pregunta 6 de la v0.
- Opciones: **(a)** no contarlas · **(b)** elaboración = producto del catálogo, se cuenta como cualquier otro y se
  valoriza con el costo de su receta (F5) · **(c)** derivarlas de recetas (el conteo se convierte a ingredientes).
- **Recomendación: (b)**; en F4 se cuentan cantidades y el costo llega con F5. (c) necesita recetas y rendimientos
  que todavía no existen.
- 🖊️ Esquema: tipo de producto (comprado / elaboración); una elaboración no tiene proveedor ni compras.

**B8 · Variación en ₡ y por rubro.** Una lista de cantidades por producto no dice dónde está la plata.
- Opciones: **(a)** cantidades por producto · **(b)** además en colones (cantidad × costo de referencia), agrupada
  por categoría y ordenada por monto · **(c)** además como % de la venta del rubro.
- **Recomendación: (b)**; (c) con F5. Quién ve colones no cambia (§7.8 y §12.1).
- Esquema: la vista no toca nada. 🖊️ Sí toca el tipo de `costo_unitario` (§6.6): el costo por gramo necesita
  decimales de sobra (propuesta: 6) y se redondea solo el total.

**B9 · Lugar «parcial» que nunca se completa.** Un ◐ eterno deja la fecha sin total y nadie lo cierra.
- Opciones: **(a)** retomable hasta la próxima fecha del calendario (implícito hoy) · **(b)** vence al cierre del
  **día siguiente** a la fecha del calendario (hora CR) y la fecha queda «Incompleto» · **(c)** vence a las 24 h del
  primer envío.
- **Recomendación: (b).** Contar el martes lo del lunes sigue andando; el miércoles ya no. Acota la regla 2 del
  piloto: lo decide el dueño. El consumo ya salta a los conteos completos (§7.4).
- Esquema: no (estado calculado).

**B10 · Frecuencia.** Responde la pregunta 2 de la v0.
- Opciones: **(a)** todo, cada lunes y día 1 (regla 2 del piloto) · **(b)** lista corta semanal de lo caro (15 a 20
  productos como máximo, los lunes) + conteo completo el día 1 · **(c)** conteo diario de unos pocos.
- **Recomendación: (b).** Cambia la regla 2 solo si el dueño lo decide; F0 sigue como está mientras tanto.
- En una fecha de lista corta, un lugar está hecho cuando se contaron sus productos de la lista.
- 🖊️ Esquema: marca de lista corta por producto y tipo «corta» en `inv_conteo_fechas`.

**B11 · Multi-local.**
- Opciones: **(a)** un catálogo separado por local · **(b)** un catálogo único e igual para los dos · **(c)**
  **identidad de producto compartida** (nombre, unidad, categoría, tipo) + **configuración por local** (lugares,
  orden, par, mínimo, proveedor, unidad de compra, activo).
- **Recomendación: (c).** Sin identidad compartida no hay traspasos (B2) ni comparación entre locales. Es compatible
  con D-INV-5 **si** «propio catálogo» se lee como «propia configuración»: esa lectura la confirman el dueño y el
  contador; D-INV-5 no se toca acá.
- 🖊️ Esquema: parte `inv_productos` en identidad + configuración por local. **Hay que decidirlo antes de la
  migración del catálogo**, que se adelanta a F3 (§11).

**Riesgos que suma G-014** (van también a §13): factor de compra mal confirmado · sesgo al estimar botellas ·
decimales del costo unitario · parcial que nunca se completa.

**Respuestas del dueño (26-nov-2026), cierran las preguntas de abajo:**
- **B1 (corte):** se cuenta los **lunes y el día 1 de cada mes, antes de recibir mercadería**. Toda compra o traspaso del día del conteo entra **después** del conteo.
- **B2 (traspasos):** pasa poco, pero puede pasar → el traspaso existe como movimiento propio (recomendación (c) de B2), sin apuro de pantalla.
- **B10 (frecuencia):** **se cuenta todo** en cada conteo (lunes y día 1); no hay lista corta semanal. Lo de la regla 2 del piloto sigue igual.
- **B11 (multi-local):** **configuración propia para cada local** (lugares, orden, par, mínimo, proveedor, unidad de compra). La identidad compartida del producto (recomendación (c)) queda como propuesta: se confirma con el dueño junto con la migración del catálogo.
- **B7 (elaboraciones):** **se cuentan** como producto.
- **B9 (parcial):** el dueño toma la recomendación: un parcial **vence al cierre del día siguiente** y la fecha queda «Incompleto».

**Preguntas para el dueño (G-014):**
1. ¿Barra y cocina cuentan **antes de recibir** o **al cierre**? ¿El mismo corte en los dos locales?
2. ¿Hay préstamos barra ↔ cocina o entre locales que hoy no se anotan?
3. ¿Qué productos van en la lista corta semanal (15 a 20 como máximo)?
4. ¿El contador acepta «identidad compartida + configuración por local» (B11)?
5. Elaboraciones: ¿se cuentan como producto o se derivan de recetas?
6. ¿Un parcial vence al cierre del día siguiente (B9)?

**Fuentes** (consultadas por el Auditor el 26-nov-2026; describen cómo funciona cada producto según su propio
fabricante, no son evidencia independiente). Documentación de producto: docs.restaurant365.com (storage locations,
item location records, item transfers) · support.apicbase.com (counting, parallel counting, transfer stock) ·
support.toasttab.com (xtraCHEF inventory counts) · help.wisk.ai. Sitio del producto: marketman.com. **Material
comercial:** supy.io. De ahí salen dos datos puntuales usados arriba: Apicbase registra los traspasos antes del
conteo y Restaurant365 los maneja con estado enviado / recibido.

### 7.10 Sello del conteo del día 1 y botón «Merma» (G-012 v3)

**Dos conteos, dos usos.** El de los lunes es **operativo** (pedido, «se acaba antes»). El del día 1 es **contable**:
cierra el período del P&L (§15) y su final es el inicial del mes siguiente.

**Sello del día 1 — decidido (P3, §12.2): sella el contador; reenvío sin ajuste hasta el día 5.**
- Revisado por el contador, el conteo del día 1 queda **sellado**. Un reenvío posterior de ese lugar y fecha no
  cambia el período: genera un **ajuste fechado y visible**, con quién y por qué.
- Roza la regla 3 del piloto («vale el último»), que seguiría igual para los lunes y para el día 1 **antes** del sello.
- Falta decidir: quién sella (contador, owner o los dos), hasta cuándo se puede reenviar sin ajuste y si un mes sin
  sello bloquea el P&L o solo lo marca «sin sellar».
- 🖊️ Esquema y permisos: marca de sello en la fecha de conteo y permiso de sellar.

**«Merma» como un botón del empleado.**
- Flujo: **Merma → producto → cantidad → motivo (lista cerrada) → Listo**, desde el teléfono, con la unidad del
  producto a la vista y el mismo teclado del conteo (§7.3). Sin precios: el costo sale del ledger.
- Inserta un movimiento `merma` en `inv_movimientos`, con reintento seguro (`idem_key` del aparato, cola sin señal).
- La lista de motivos la define el dueño con los encargados (vencido, roto, error de preparación, …).
- 🖊️ Hoy un aparato habilitado solo inserta conteos (§7.2, punto 3). Sumar merma **amplía el acceso sin sesión**:
  firma al construir. Entra en F4c (§11).
- Los traspasos (B2) y la producción de elaboraciones (B7) son también movimientos del ledger, no tablas aparte.

---

## 8. F5 — Recetas con costo (modelo y ganchos; no se construye acá)

- **Llave de venta:** `(local, codigo)` de `pos_productos` (mig 198). Una receta se ata a un código del PoS; las
  cantidades vendidas salen de las funciones de la 067 (`pos_ventas_lineas`), nunca de otra fuente (regla 6 de ESTADO).
- **Modelo (borrador):** `inv_recetas` (`location_id`, `pos_codigo`, nombre, rinde) · `inv_receta_lineas` (producto
  o **sub-receta**, cantidad en la unidad del producto, merma %) · `inv_preparaciones` para lo que se produce en casa
  (caldos, salsas): tienen receta propia y pueden contarse como producto.
- **La receta guarda cantidades, no costos (G-012 v3).** El **costo del plato** es una **vista**: Σ cantidad × costo
  de referencia del producto (promedio de 90 días, §12.1; el último se muestra al lado). Cuando cambia el costo de un
  producto, todos los platos y sub-recetas que lo usan muestran el costo nuevo en la siguiente lectura, sin ningún
  proceso que escriba en la receta. **Margen** = precio del PoS − costo. Aviso cuando un plato cruza el umbral de
  costo de su rubro.
- **Consumo teórico** = ventas × receta, calculado por **un único motor al cierre de turno** (D-CSC-7): inserta un
  movimiento `consumo_teorico` por producto con `idem_key` = local + turno + producto. Cerrar dos veces el mismo
  turno no duplica. Una venta sin receta queda listada «sin receta» y no descuenta nada. De la Caja solo **lee** que
  el turno cerró; no toca la Caja ni los sagrados.
- **El teórico no pisa el stock real.** Stock esperado = último conteo completo + compras − teórico; el conteo
  siguiente da el real. **Variación** = consumo real (F4) − teórico, por producto y período, en colones y ordenada por
  monto (B8).
- **Se apagan los dos motores de hoy cuando entre este** (D-CSC-7): el botón manual por día de `InvConsumo` y
  `depleteOrderInventory` (por pedido; hoy sin llamadores en `main`, §1.1). Cómo se retiran, y qué pasa con los
  `sale_deduction` ya escritos, va en la spec de F5.
- **Ganchos que F1–F4 dejan listos:** una unidad por producto con factores · `inv_costos` · consumo entre conteos por
  producto · productos marcados «preparación».
- **Qué pasa con `recipes` / `recipe_ingredients` / `ingredients`:** se decide en la spec de F5 (migrar lo cargado o
  empezar del recetario en planillas). Hasta entonces el módulo actual no se toca.

---

## 9. Flujos por rol

| Rol | Hoy | Con esta spec |
|---|---|---|
| **Empleado que recibe** (cajero, puesto de Bandeja) | Revisa, sube la foto a la Bandeja, elige forma de pago | **Igual.** Nada cambia. |
| **Empleado que cuenta** (barman, barback, cocina, …) | Planilla piloto | F4: abre el ícono del área, toca su nombre, cuenta por lugar, envía. |
| **Manager** (su local) | Bandeja y Caja | F2: avisos «FE sin recepción» y «Para revisar» · F3: cola de líneas sin asociar, avisos de suba · F4: resumen, cumplimiento, pedido con «Copiar para WhatsApp», habilita aparatos. |
| **Contador** | Paga pendientes, reportes | F1: pantalla de control · F2: estado en cada pendiente antes de pagar, NC posteriores · F3: costos · F4: consumo y stock valorizado. |
| **Owner** | Todo | Todo lo anterior + ficha de proveedor, umbrales y reporte mensual por proveedor. |

Pantalla de quien paga (F2), sobre la lista de pendientes que ya existe (se **agrega** una señal; no cambia el flujo
de pago):

```
Pendientes de pago
 Proveedor de prueba 1   fact 1234   ₡ 10.000   ✓ Conciliada
 Proveedor de prueba 2   fact 0077   ₡ 25.000   ⚠ Montos distintos: FE ₡ 25.900   [Ver]
 Proveedor de prueba 3   recibo      ₡  8.000   · Recibo sin FE (no emite)
 Proveedor de prueba 4   fact 5521   ₡ 40.000   … Recibida, falta FE (día 2 de 5)
```

Pantalla de control de la ingesta (F1, owner y contador):

```
Facturas electrónicas · Santa Teresa        Última ingesta: hace 8 min ●
 Hoy: 6 nuevas · 1 duplicada · 0 con error · 1 correo sin XML
 Para revisar (2):  receptor distinto (1) · suma de líneas no calza (1)
 Proveedores nuevos (1):  cédula terminada en …42 — [Vincular a un proveedor]
```

## 10. Medidas de éxito

| Fase | Medida | Meta |
|---|---|---|
| F1 | XML que llegan al correo y quedan ingeridos sin intervención | ≥ 98 % |
| F1 | Demora correo → base | ≤ 15 min (mediana) |
| F1 | Comprobantes duplicados en la base | 0 |
| F2 | Compras con FE conciliadas solas | > 80 % |
| F2 | Avisos «FE sin recepción» resueltos | < 48 h |
| F2 | Transferencias pagadas con estado «Montos distintos» o sin recepción | 0 |
| F3 | Líneas de FE asociadas solas después de 8 semanas | > 90 % |
| F3 | Antigüedad de la cola «sin asociar» | < 7 días |
| F4 | Conteos del calendario completos y en fecha | ≥ 90 % |
| F4 | Productos con consumo negativo por conteo | < 5 % |
| F4 | Tiempo para contar un lugar | menor que en la planilla (medir en el piloto) |
| F4 | Quiebres de stock de productos con par cargado | bajan mes a mes |
| Todas | Cambios en Bandeja, Caja o sagrados | 0 |

### 10.1 Criterios de aceptación de la cadena (G-012 v3)

Verificables en staging, con datos ficticios:

- La misma FE o la misma línea procesada N veces deja exactamente **1** compra.
- Foto + FE de la misma compra: 1 movimiento vigente y 1 reemplazado.
- Una NC total deja la compra neta en 0 y la factura «Anulada por NC», sin tocar la Caja.
- El stock de un producto a cualquier fecha se reproduce desde el ledger.
- El food cost real del mes coincide con el cálculo a mano de la hoja «Contador» del piloto sobre el mismo set ficticio.
- El P&L del mes cuadra: suma por cuentas = FE sin IVA − NC; lo «sin cuenta» se ve aparte.
- Un empleado cuenta un lugar en menos tiempo que en la planilla, sin escribir nombres ni fechas.
- Ninguna escritura en `documents`, en `cash_movements` ni en los sagrados.

## 11. Tabla de fases

| Fase | PRs previstos | Qué toca | Firma |
|---|---|---|---|
Reordenada el 27-nov (G-012 v3, D-CSC-6): **el P&L de mercadería va antes que F5**, porque no necesita recetas: le
alcanza con las FE asociadas y dos conteos del día 1. Es lo que ya hace a mano la hoja «Contador» del piloto.

| Orden | Fase | PRs previstos | Qué toca | Firma |
|---|---|---|---|---|
| 0 | **Fase 0** — *decidida (P4, §12.2): etiquetar «provisorio»* | Etiquetar o congelar lo que hoy muestra un stock sin ancla: Stock, Consumo, el pedido del Dashboard y la suma de stock de la Revisión | Textos y visibilidad de pantallas de gerencia | no (si se decide: OK y guía SOP) |
| 1 | **F1.0** | Verificar condiciones de Google y contar el volumen real del buzón (solo lectura, a mano con el dueño) | Nada | no |
| 2 | **F1** — en `main` (§1.1) | Parser puro + pruebas · migración (`fe_*`, bucket) · Edge `fe-ingesta` · script de Apps Script · pantalla de control. *Propuesto y sin construir:* la respuesta de Hacienda como estado visible y la marca del tiquete (§12.2) | Esquema, Edge y secreto en prod, Storage | 🖊️ **sí** |
| 3 | **F2** | Función de cruce + pruebas · migración (`fe_cruces`, config, vista) · señal en pendientes y avisos | Esquema; **solo lectura** sobre `documents` y `cash_movements` | 🖊️ **sí** |
| 4 | **F3-mín** | Migración (`inv_linea_producto`, `inv_movimientos` solo con `compra` y `nc`, `pl_cuentas`, `fe_linea_cuenta`) · cola línea → producto **o cuenta** · costos y aviso de precio por impacto | Esquema; costos (plata) | 🖊️ **sí** |
| 5 | **F4a** | Migración `inv_*` + permisos + aparatos · importación del piloto en staging | Esquema, permisos, acceso sin sesión | 🖊️ **sí** (con verificador independiente) |
| 6 | **F4b** | Módulo de conteo (dos vías) · sin señal · guía SOP · sello del día 1 *(si se decide, §7.10)* | Pantallas del personal → validación física del dueño | OK + validación |
| 7 | **P&L-mín** (§15) | Vistas `food_cost_periodo` (método periódico) y `pl_mensual` · pantalla mensual por local · CSV al contador | Plata (reporte); solo lectura sobre FE, conteos, ventas y Caja | 🖊️ **sí** (con verificador independiente) |
| 8 | **F4c** | Gerencia · pedido sugerido · correos de cumplimiento · merma (§7.10) · traspasos (B2) | Pantallas de gerencia; merma amplía el acceso del aparato | OK; 🖊️ merma y traspasos |
| 9 | **F5** | Spec propia: recetas (cantidades), costo del plato en vista, consumo teórico por cierre de turno, variación; apaga los dos motores viejos (§8) | — | spec aparte |

Dependencias: F2 necesita F1 · F3-mín necesita F1 (y usa F2 para saber qué se recibió) · el catálogo `inv_productos`
de F4a hace falta para F3-mín, así que **la migración del catálogo se adelanta a F3-mín** (el conteo en pantalla sigue
en F4b; mientras, el piloto en planillas continúa) · P&L-mín necesita F3-mín y dos conteos completos del día 1 (el
primer mes puede partir del conteo importado del piloto, §7.6) · F5 necesita F3-mín y F4.

Guías SOP: cada PR con pantallas actualiza `docs/sop-app/` (guía nueva «Inventario y compras» en F4b; nota en
«6.2 Caja» cuando F2 agregue la señal en pendientes).

## 12. Preguntas abiertas para el dueño

1. **Correo de proveedores:** ¿esa cuenta recibe solo facturas de proveedores? El script puede leer todo el buzón
   (aunque solo saca XML). ¿Es una cuenta común de Gmail o de Google Workspace? (cambia las cuotas, no el diseño).
2. **Carga inicial:** ¿desde qué fecha se ingieren las facturas que ya están en el buzón? (propuesta: desde el
   arranque del piloto de conteo de cada área).
3. **Nosara:** ¿las facturas de los dos locales llegan al mismo correo y con la misma cédula de receptor? Si es así,
   hace falta una regla para saber de qué local es cada una (propuesta: por proveedor, con revisión cuando un
   proveedor atiende a los dos).
4. **Avisos de F2:** ¿quién resuelve «FE sin recepción» y «Para revisar»: el manager del local, el contador o los dos?
5. **Costo con o sin IVA** (para el contador). Propuesta: sin IVA.
6. **Costo de referencia:** ¿promedio de 90 días o costo último para stock valorizado y consumo?
7. **Umbrales:** margen de monto del cruce (1 %), suba de precio (8 %), vencimiento de un pedido en camino (10 días).
8. **Manager y costos:** ¿el manager ve costos y stock valorizado de su local, o solo cantidades?
9. **Empleados por local:** hoy `employees` no tiene local. Para «empleados activos del local» hay que cargarlo
   (columna nueva, con firma) — ¿un empleado puede estar en los dos locales?
10. **PDF de la factura:** ¿hace falta guardarlo además del XML? (propuesta: no).
11. **Días de pedido y demora por proveedor:** ¿quién los carga, el manager o el contador?
12. Siguen abiertas las de la [v0](SPEC-inventario-v0.md) §8 (calendario de cocina, conteos parciales de lo caro,
    mermas y producción propia).
13. **Bordes del conteo (G-014):** seis preguntas en §7.9 (corte, préstamos, lista corta, multi-local,
    elaboraciones, vencimiento del parcial).
14. **G-012 v3:** las decisiones P1–P5 están en §12.2.

### 12.1 Respondidas por el dueño (25-nov-2026)
- **4 · Avisos de F2:** los resuelven manager y contador, pero **al arrancar el aviso al manager va apagado** (interruptor por local); solo el contador los recibe hasta que el dueño lo encienda.
- **5 y 6 · Costo:** **sin IVA**, con **promedio de 90 días** como costo de referencia (stock valorizado, consumo y recetas). El último precio se muestra aparte, con el aviso de suba.
- **8 · Manager y costos:** **sí**, ve costos y stock valorizado **de su local** (permiso de base: firma al construir).
- **9 · Empleados por local:** un empleado **puede estar en los dos locales** (lista de locales por empleado; columna o tabla nueva con firma).
- **1 · Correo:** cuenta de **Gmail común** (no Workspace): se usan las cuotas de cuenta personal de Apps Script; F1.0 las confirma.
- **2 · Carga inicial:** desde el **30-nov-2026**.
- **3 · Nosara:** **otro correo y otra cédula de receptor.** Cada factura se asigna al local por la cédula del receptor (tabla local ↔ cédula, configurable por el owner); un script por cuenta, misma Edge.
- Siguen abiertas: 7, 10, 11 y 12.

### 12.2 Decisiones P1–P5 (dueño, 27-nov-2026 ~13:40 CR)

El dueño aceptó D-CSC-5, 6 y 7 (§2) y decidió P1–P5:

| # | Tema | Decisión | Falta |
|---|---|---|---|
| P1 | Cuentas del P&L gerencial | **Un solo plan de cuentas:** cada cuenta del P&L nuevo se **mapea** a una de `finance_accounts` (`/finanzas`, §1.1); no hay dos planes paralelos. Base: Alimentos y Bebidas (costo de ventas); Descartables, Limpieza, Mantenimiento y Servicios (gasto operativo) | Que el contador valide la lista; el esquema lleva firma |
| P2 | Tiquete electrónico «no respalda gasto» | **No se marca** hasta que el contador lo confirme por escrito | Respuesta del contador |
| P3 | Sello del conteo del día 1 | **Sí:** sella el **contador** al revisar. Hasta el día 5 del mes se puede reenviar sin ajuste; después de sellado, solo con un ajuste fechado y visible. Un mes sin sello se muestra como P&L «provisorio» | — |
| P4 | Pantallas viejas (Stock, Consumo, pedido del Dashboard, suma de stock de la Revisión) | **Etiquetar «provisorio, no usar para decidir»**, sin ocultarlas, hasta F3-mín y F4 (lo ve el personal: lleva validación física) | PR chico de texto |
| P5 | Datos de arranque | **Empezar de cero:** nada de lo viejo de la app sobre stock, inventario o P&L se migra (`ingredients.current_stock`, `inventory_movements`, recetas con costo a mano): no se usó de forma consistente y la Bandeja de fotos sirvió para pagar proveedores, no para seguir productos. La hoja «Compras» del piloto no se importa. El P&L arranca con FE desde el primer mes completo. **Histórico 2026:** si es posible, se importa del sistema contable del contador (QuickBooks) como referencia de comparación, en una tabla aparte y de solo lectura, nunca mezclada con el P&L calculado | Formato de exportación del contador (P&L mensual 2026 por cuenta, CSV o Excel) y el mapeo de sus cuentas a `finance_accounts` |

## 13. Riesgos

| Riesgo | Mitigación |
|---|---|
| El disparador del script se apaga y nadie se entera | «Última ingesta» en la pantalla de control y aviso en el Inicio de owner y contador si pasa de 6 h |
| Factor de conversión mal puesto contamina costos | Guarda de 3× contra el último costo, «factor a confirmar», y toda asociación es reversible (queda la anterior) |
| Aparato habilitado en manos de cualquiera | Solo inserta conteos; sin costos; revocable; queda aparato, hora y nombre |
| Cambio de versión del XML de Hacienda | Parser por nombre de elemento, tolerante; lo desconocido va a «revisar», no se pierde (queda el XML original) |
| El cruce por cédula + total confunde dos compras iguales | Más de un candidato nunca se resuelve solo |
| Factor de compra mal confirmado al teclear «cajas + sueltos» (G-014) | El botón aparece solo con factor confirmado; la pantalla muestra factor y resultado antes de aceptar; queda el factor usado en cada línea (§7.9 B4) |
| Sesgo al estimar botellas abiertas (G-014) | Escala fija y método anotado; doble conteo para comparar; balanza en F5 para lo caro (§7.9 B5) |
| Decimales del costo unitario (costo por gramo) (G-014) | Costo con decimales de sobra; se redondea solo el total (§7.9 B8) |
| Lugar «parcial» que nunca se completa (G-014) | Vencimiento definido y fecha «Incompleto» (§7.9 B9) |
| Datos reales en el repo público | Pruebas con XML ficticios; muestras reales solo en staging; revisión del diff antes de cada commit |
| Doble entrada a stock: foto + FE, o Revisión + F3 (G-012 v3) | `idem_key` única; la compra de foto queda reemplazada por la de la FE (§6.4); la entrada de `InvRevision` se resuelve en la fase 0 (§12.2) |
| Doble descuento: por pedido + manual + por turno (G-012 v3) | Un solo motor al cierre de turno; los otros dos se apagan cuando entre (D-CSC-7, §8) |
| El P&L gerencial se lee como contabilidad oficial (G-012 v3) | Etiqueta «gerencial» en pantalla y en el CSV; nunca escribe asientos; la contabilidad oficial la lleva el contador (§15) |
| Dos P&L con números distintos: `/finanzas` (base caja) y §15 (devengado) (27-nov) | Decidir cómo conviven antes de F3-mín (§12.2, P1); cada pantalla dice su base |
| Sello del mes roto por un reenvío (G-012 v3) | Un día 1 sellado solo se corrige con un ajuste fechado y visible (§7.10; decidido, P3) |

## 14. Qué queda afuera

Envío automático de pedidos · validación de la firma digital del XML · aceptación o rechazo de comprobantes ante
Hacienda · **asientos contables** (la **vista** gerencial del P&L sí entra, §15; no escribe asientos ni reemplaza la
contabilidad del contador) · cambios en la Bandeja, la Caja o `extract-document` · recetas (F5, spec propia) ·
tiempo real con Pub/Sub (documentado como alternativa en §4.1).

---

## 15. P&L gerencial de mercadería (G-012 v3, D-CSC-6)

**Qué es:** una vista mensual por local, para el dueño y el contador, que sale sola de lo que ya entra por la cadena
(FE asociadas + conteos del día 1 + ventas del PoS). **Qué no es:** contabilidad oficial. No escribe asientos; todo lo
que muestra lleva la etiqueta «gerencial». No necesita recetas, por eso va antes que F5.

**Base: devengado por fecha de emisión de la FE**, no por fecha de pago. El pago sigue siendo de la Caja y la Bandeja
y no cambia: la regla 11 de ESTADO (fecha del movimiento de caja = día en que se registró) queda intacta.

**Costo de ventas, método periódico, por cuenta:**

```
costo de ventas del mes (cuenta) = inventario inicial + compras del mes − inventario final
```

- Inventario inicial y final: conteo **completo** del día 1 de cada mes, valorizado al costo de referencia (§12.1). El
  final de un mes es el inicial del siguiente. Es la regla 7 del piloto ([v0](SPEC-inventario-v0.md) §2).
- Compras del mes: movimientos `compra` y `nc` del ledger con fecha de emisión dentro del mes, sin IVA.
- Si falta un conteo completo, el período dice **«sin conteo»**: no estima ni inventa.

**Líneas de la vista** (`pl_mensual`, por local y mes):

| Línea | De dónde sale |
|---|---|
| Ventas por rubro | PoS, por las funciones de la 067 (regla 6 de ESTADO) |
| Costo de ventas por cuenta (Alimentos, Bebidas, …) | Método periódico de arriba |
| **Food cost real** por cuenta | Costo de ventas de la cuenta ÷ ventas de su rubro |
| Mano de obra | De Planilla, cuando exista; hasta entonces la línea dice «sin dato» |
| Gastos operativos por cuenta | Líneas de FE con cuenta de gasto (§6.7) + egresos de Caja **sin** FE, con su categoría |
| **Prime cost** | Costo de ventas + mano de obra (sin mano de obra, no se muestra) |
| Sin cuenta | Total de las líneas de FE todavía sin cuenta, aparte y a la vista |

**Reglas:**
- Toda línea de FE del mes está en una cuenta o figura en «sin cuenta» con su monto.
- Cuadre: suma por cuentas = total sin IVA de las FE del mes − notas de crédito.
- **Nada se cuenta dos veces:** si un egreso de Caja tiene una FE conciliada (F2), manda la FE y el egreso queda como
  su pago.
- Con F5, el food cost **teórico** y la variación (§8) se suman al lado del real, siempre etiquetados; el real no cambia.
- **CSV para el contador:** mes, local, cuenta, tipo y monto, más el detalle por comprobante. Es la única salida.
- Solo lectura sobre `fe_*`, conteos, ventas y `cash_movements`. Permisos: owner y contador; el manager, lo de su
  local si el dueño lo habilita (misma lógica que §12.1, respuesta 8).

**Aceptación:** con dos conteos completos del día 1 y las compras del medio, el food cost real coincide con el cálculo
a mano de la hoja «Contador» del piloto sobre el mismo set ficticio (prueba de paridad en staging).

**Decidido (§12.2, 27-nov):** cuentas mapeadas a `/finanzas` (P1) · tiquete sin marcar hasta que confirme el contador
(P2) · sello del día 1 por el contador (P3) · arranque de cero con FE; histórico 2026 desde el sistema del contador
como referencia aparte, si se puede exportar (P5).

## 16. Anexo — Mapa del piloto (G-012 v3)

**Ubicación:** el piloto en Drive; rutas en la entrega privada G-012 v3. Este repo es público: acá no van IDs, links
ni datos del piloto. El piloto es de solo lectura para quien construya: no se edita ni se ejecuta nada de esa carpeta.

**Qué hay:** por área (barra y cocina), un libro de **catálogo** (hojas Productos y Proveedores) y un libro de
**gerencia**; más el código de la app de conteo (un script y una pantalla HTML).

**Pestaña de la planilla → pantalla o tabla de la app:**

| Pestaña (piloto) | En la app |
|---|---|
| Productos (catálogo) | `inv_productos` + `inv_producto_lugar` + `inv_lugares` (§7.7); pantalla Catálogo de §7.4 |
| Proveedores (catálogo) | `suppliers` + `proveedor_compras_config` (§5.5) |
| Inicio | Resumen de gerencia (§7.4) |
| Conteos | `inv_conteo_envios` / `inv_conteos` (§7.7) |
| Histórico | `inv_totales` (vista; total solo con todos los lugares contados) |
| Semana | Gerencia semanal: bajo mínimo, «se acaba antes» y cumplimiento (§7.4) |
| Compras | Movimientos `compra` de `inv_movimientos`, desde la FE (§6.4). Nadie las carga a mano |
| Contador | `food_cost_periodo` y `pl_mensual` (§15) |
| Pedido | Pedido sugerido (§7.5) |

**Lugares por área** (dato de configuración que hoy está fijo en el script y como columnas Sí/No del catálogo; en la
app son filas de `inv_lugares`, por local):

| Área | Lugares | Arranque del piloto |
|---|---|---|
| Barra (4) | Heladera · Bodega · Bar rack · Premium | 23-nov-2026 |
| Cocina (9) | Repisas · Cajas · Cubetas y aceites · Empaques · Congelador cocina · Heladera negra · Heladera sushi · Congelador sushi · Hielera | 30-nov-2026 |

**Comportamientos del script que no se portan** (la app los resuelve de otra forma):

| En el piloto | En la app |
|---|---|
| Copia del catálogo a la gerencia cada hora y en cada envío | No hace falta: hay un solo catálogo en la base |
| Tope fijo de 200 filas de productos por área | Sin tope |
| Candado del script para que dos envíos no se pisen | `idem_key` por envío y transacción en la base (§7.3) |
| ID del producto con prefijo del área, puesto por el script | El ID lo pone el sistema; el del piloto se conserva en `id_piloto` (§7.6) |
| Fecha de arranque fija en el código | `inv_areas`, por local y área (regla 5 del piloto) |
| Pestaña `_mapa` (resto de un formulario anterior, según la entrega) | No se importa |
| Aviso por correo de lunes y día 1 a las 21:00 | **Sí se mantiene** (§7.4) |
