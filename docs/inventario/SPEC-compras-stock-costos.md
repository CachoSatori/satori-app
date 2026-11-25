# SPEC — Compras → Stock → Costos (spec única, por fases)

**Estado:** PROPUESTA (25-nov-2026). Junta en un solo documento la conciliación de compras con factura electrónica
(borrador del 12-nov, documentos del proyecto), el inicio de spec de inventario
([SPEC-inventario-v0](SPEC-inventario-v0.md)) y las decisiones del dueño del 25-nov (§2).
**No autoriza código ni esquema.** Cada fase se construye con el OK del dueño y, donde la tabla de fases dice
🖊️, con su firma. Todo borrador de esquema de este documento está marcado **«requiere firma»**.
**No cambia nada de hoy:** la Bandeja (`/inbox`), la Caja y sus reglas siguen igual; ningún archivo sagrado se toca.

Ejemplos: todos ficticios («Proveedor de prueba 1», «Producto A», montos inventados). El correo de proveedores, los
nombres reales, las cédulas y los montos no van a este repo (público).

## 0. Resumen en una página

| Fase | Qué resuelve | Qué ve la gente |
|---|---|---|
| **F1** Ingesta | Cada XML de factura electrónica que llega al correo de proveedores queda guardado y leído, solo, en 10–15 min | Nadie ve nada nuevo todavía (pantalla de control para owner y contador) |
| **F2** Cruce | Cada factura electrónica se cruza con lo que el personal subió a la Bandeja y con su pago | Quien paga ve el estado en cada pendiente; el gerente, avisos de «FE sin recepción» |
| **F3** Línea ↔ producto | Cada línea del proveedor se asocia a un producto del catálogo con su conversión de unidad; sale el costo | Gerente: cola «líneas sin asociar» y avisos de suba de precio |
| **F4** Inventario | Conteo por lugar (link instalable por área), gerencia y pedido sugerido | Personal: la pantalla de conteo. Gerencia: bajo mínimo, «se acaba antes», cumplimiento, pedido |
| **F5** Recetas con costo | Modelo y ganchos para costo por plato y teórico vs. real | Nada: no se construye en esta spec |

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

## 2. Decisiones que mandan (dueño, 25-nov-2026)

| # | Decisión |
|---|---|
| D-CSC-1 | El conteo se puede hacer por dos vías, con el mismo código y los mismos datos: pantalla dentro de Satori App y **link aparte instalable**. En la práctica se usa el link. |
| D-CSC-2 | Al empezar un conteo se elige el nombre de un **empleado registrado y activo del local**. El aparato lo habilita un gerente una vez; el empleado no escribe clave. |
| D-CSC-3 | Las facturas electrónicas salen del correo de proveedores con la opción más eficiente de Google. Recomendación a confirmar acá: Apps Script dentro de esa cuenta → Edge Function con secreto (§4.1 la confirma). |
| D-CSC-4 | Orden: F1 → F2 → F3 → F4 → F5. Una sola spec. |

Siguen vigentes D-INV-1 a D-INV-5 de la [v0](SPEC-inventario-v0.md) (una app de conteo, catálogo a cargo del
encargado del área y el contador, una unidad por producto, histórico migrado normalizado, multi-local en la misma app).

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
- **Costo último:** el de la compra más reciente. **Costo promedio:** ponderado por cantidad en una ventana (propuesta:
  últimos 90 días; pregunta 6). Los dos se muestran; cuál usa cada reporte lo decide el contador.
- **Con o sin IVA:** propuesta: costo **sin** IVA, con el impuesto guardado aparte (pregunta 5, contador).
- **Moneda:** se guarda en la moneda de la factura y en colones con el `TipoCambio` del propio XML.
- **Aviso de suba de precio:** cuando el costo unitario de una compra supera en más de un umbral (propuesta 8 %,
  ajustable) al promedio de las tres compras anteriores del mismo producto y proveedor. Se ve en el Inicio de
  gerencia y en la ficha del producto, con el antes y el después. Una baja mayor al umbral también se marca (puede
  ser un factor mal puesto).

### 6.4 Compras sin factura electrónica

Proveedor sin FE (o FE que nunca llegó): las líneas salen de lo que `extract-document` leyó de la foto
(`raw_json…items`), entran a la misma cola con la marca «leído de foto» y **siempre** las confirma una persona antes
de contar como compra (la lectura de una foto manuscrita no es exacta). Si después llega la FE de esa misma compra,
la compra «de foto» queda reemplazada por la del XML (una sola cuenta).

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

---

## 8. F5 — Recetas con costo (modelo y ganchos; no se construye acá)

- **Llave de venta:** `(local, codigo)` de `pos_productos` (mig 198). Una receta se ata a un código del PoS; las
  cantidades vendidas salen de las funciones de la 067 (`pos_ventas_lineas`), nunca de otra fuente (regla 6 de ESTADO).
- **Modelo (borrador):** `inv_recetas` (`location_id`, `pos_codigo`, nombre, rinde) · `inv_receta_lineas` (producto
  o **sub-receta**, cantidad en la unidad del producto, merma %) · `inv_preparaciones` para lo que se produce en casa
  (caldos, salsas): tienen receta propia y pueden contarse como producto.
- **Costo del plato** = Σ cantidad × costo de F3 (último o promedio, a elegir). **Margen** = precio del PoS − costo.
- **Consumo teórico** = ventas × receta. **Variación** = consumo real (F4) − teórico, por producto y período.
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

## 11. Tabla de fases

| Fase | PRs previstos | Qué toca | Firma |
|---|---|---|---|
| **F1.0** | Verificar condiciones de Google y contar el volumen real del buzón (solo lectura, a mano con el dueño) | Nada | no |
| **F1** | Parser puro + pruebas · migración (`fe_*`, bucket) · Edge `fe-ingesta` · script de Apps Script · pantalla de control | Esquema, Edge y secreto en prod, Storage | 🖊️ **sí** |
| **F2** | Función de cruce + pruebas · migración (`fe_cruces`, config, vista) · señal en pendientes y avisos | Esquema; **solo lectura** sobre `documents` y `cash_movements` | 🖊️ **sí** |
| **F3** | Migración (`inv_linea_producto`, `inv_compras`) · cola de líneas · costos y aviso de suba | Esquema; costos (plata) | 🖊️ **sí** |
| **F4a** | Migración `inv_*` + permisos + aparatos · importación del piloto en staging | Esquema, permisos, acceso sin sesión | 🖊️ **sí** (con verificador independiente) |
| **F4b** | Módulo de conteo (dos vías) · sin señal · guía SOP | Pantallas del personal → validación física del dueño | OK + validación |
| **F4c** | Gerencia · pedido sugerido · correos de cumplimiento | Pantallas de gerencia | OK |
| **F5** | Spec propia | — | spec aparte |

Dependencias: F2 necesita F1 · F3 necesita F1 (y usa F2 para saber qué se recibió) · el catálogo `inv_productos` de
F4a hace falta para F3, así que **la migración del catálogo se adelanta a F3** (el conteo en pantalla sigue en F4b;
mientras, el piloto en planillas continúa) · F5 necesita F3 y F4.

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

### 12.1 Respondidas por el dueño (25-nov-2026)
- **4 · Avisos de F2:** los resuelven manager y contador, pero **al arrancar el aviso al manager va apagado** (interruptor por local); solo el contador los recibe hasta que el dueño lo encienda.
- **5 y 6 · Costo:** **sin IVA**, con **promedio de 90 días** como costo de referencia (stock valorizado, consumo y recetas). El último precio se muestra aparte, con el aviso de suba.
- **8 · Manager y costos:** **sí**, ve costos y stock valorizado **de su local** (permiso de base: firma al construir).
- **9 · Empleados por local:** un empleado **puede estar en los dos locales** (lista de locales por empleado; columna o tabla nueva con firma).
- Siguen abiertas: 1, 2, 3, 7, 10, 11 y 12.

## 13. Riesgos

| Riesgo | Mitigación |
|---|---|
| El disparador del script se apaga y nadie se entera | «Última ingesta» en la pantalla de control y aviso en el Inicio de owner y contador si pasa de 6 h |
| Factor de conversión mal puesto contamina costos | Guarda de 3× contra el último costo, «factor a confirmar», y toda asociación es reversible (queda la anterior) |
| Aparato habilitado en manos de cualquiera | Solo inserta conteos; sin costos; revocable; queda aparato, hora y nombre |
| Cambio de versión del XML de Hacienda | Parser por nombre de elemento, tolerante; lo desconocido va a «revisar», no se pierde (queda el XML original) |
| El cruce por cédula + total confunde dos compras iguales | Más de un candidato nunca se resuelve solo |
| Datos reales en el repo público | Pruebas con XML ficticios; muestras reales solo en staging; revisión del diff antes de cada commit |

## 14. Qué queda afuera

Envío automático de pedidos · validación de la firma digital del XML · aceptación o rechazo de comprobantes ante
Hacienda · asientos contables · cambios en la Bandeja, la Caja o `extract-document` · recetas (F5, spec propia) ·
tiempo real con Pub/Sub (documentado como alternativa en §4.1).
