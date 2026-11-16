# Propuesta · Local Club, promociones y pase único (Paso 0, 07-nov-2026)

> Solo lectura y propuesta. **No se construye nada sin el OK del dueño.** Se lee con [SPEC.md](SPEC.md) y
> [SPEC-LC-promos.md](SPEC-LC-promos.md). Datos de staging, desde el 1-sep.

## 1. Qué trae hoy el puente

### Catálogo de productos
**No se sincroniza.**
- El agente lee `FAC_Productos` (código, nombre, familia y `PrecioVenta`) **solo** para estimar el total de las mesas
  abiertas; no lo guarda en ninguna tabla.
- En las líneas de factura (`pos_ndf_ticket_lines`) vienen el código, el nombre, la familia, `es_cortesia` y `monto`. El
  `precio` viene vacío en las 230.291 líneas. Desde el 1-sep aparecen 281 productos y 13 familias.
- `pos_prices` (542) tiene precio por **nombre**, sin código ni familia.
- `product_map` (720) es la tabla de cocina: nombre, estación, CABYS. No tiene código del PoS ni precio.

**Para las cortesías y las promociones hace falta el catálogo con código, nombre, familia y precio:** una tabla nueva,
alimentada por el agente.

### Artículo 856 (LOCAL CLUB)
**Sí llega.** Está en 142 facturas cerradas desde el 1-sep, con monto 0.

### El 10 %
**No llega como descuento.**
- `descuento_crc` vale 0 en el 100 % de las facturas desde agosto, y las líneas no tienen columna de descuento.
- En las facturas con el 856, **cada línea ya viene rebajada: hoy el PoS aplica el 15 %**, no el 10 %. El precio unitario
  es exactamente 0,85 del normal en todos los productos de los ejemplos.

### 3 ejemplos (anonimizados: sin número de factura, mesa, salonero ni cliente)
| Ejemplo | Líneas | Total | Descuento en el campo | Precio de cada línea contra el normal |
|---|---|---|---|---|
| LC-1 | Pollo teriyaki, gin tonic, PAX, LOCAL CLUB (₡0) | ₡16.376 | ₡0 | 8.199 / 9.646 = **0,85** · 5.115 / 6.018 = **0,85** |
| LC-2 | Pollo teriyaki, Pilsen, PAX, LOCAL CLUB (₡0) | ₡12.676 | ₡0 | **0,85** · 2.106 / 2.478 = **0,85** |
| LC-3 | 3 rolls, 2 tragos, LOCAL CLUB (₡0) | ₡38.065 | ₡0 | las 5 líneas en **0,85** |

**Otros datos de las 142 facturas LC:**
- 14 llevan alguna línea en cortesía.
- **5 se pagaron con créditos** (cxc > 0). Con la regla fija («una factura pagada con créditos no lleva descuento»),
  serían `CANJE_CON_DESCUENTO`.

**Consecuencias:**
- **Detectar el descuento real** (10 % del cupón, 15 % o 10 % del LC, 2×1) necesita el precio de catálogo: descuento de
  la línea = 1 − monto ÷ (precio × cantidad). Con el catálogo, `CUPON_SIN_PROMO` puede dejar de depender del artículo
  marcador.
- **Decisión del dueño:** la SPEC dice «10 % + cortesía» y el PoS hoy aplica 15 %. Hay que elegir uno y configurar el PoS
  igual; si no, todas las visitas LC darían `PROMO_FUERA_DE_VIGENCIA`.

## 2. Qué queda del CRM pausado

| Pieza | Estado | Sirve para el socio | Propuesta |
|---|---|---|---|
| `customers` (2 filas) | teléfono, email, nacimiento, puntos, nivel, `wallet_pass_id` | No: cajero y contador ven y editan los contactos, contra la regla del Club (solo gerencia) | Export y borrado en una migración aparte, después del piloto |
| `customer_interactions` (1) | puntos ganados y gastados | No | Igual |
| `loyalty_config` (1) | puntos por ₡1.000, niveles, bonos | No: el LC es beneficio por factura, no puntos | Igual |
| `loyalty_rewards` (4) | bebida, roll, postre de cortesía y 10 % por puntos | Solo como idea de cortesías iniciales; en el LC se eligen del catálogo del PoS | Igual |
| `/registro` y `CrmQR` | apagados (`REGISTRO_PUBLICO_ACTIVO=false`) | El formulario sirve de referencia visual; la autoalta nueva va por club-web, con función pública y `x-club-web`, como el cupón | Sacar la ruta cuando exista la autoalta |

## 3. Modelo propuesto (todo en la misma 075; sigue sin estar en prod)

### Una persona, un miembro, un pase
**Recomendado:** `club_miembro_roles(miembro_id, rol, estado, desde, validado_por, validado_en, alta_por, referido_por)`.
- `rol`: `referente`, `concierge_pm`, `equipo` o `socio`. PK `(miembro_id, rol)`.
- `estado` del rol de socio: `pendiente`, `activo` o `baja`. El referente sigue usando `club_miembros.estado`.
- `club_miembros.tipo` deja de existir. Las funciones preguntan «¿tiene el rol X activo?»:
  - `club_resolver` y `club_canje` → rol de referente;
  - el beneficio LC → rol de socio activo.
- **Por qué una tabla de roles y no dos columnas:** cada rol tiene su propio estado, quién lo validó y cuándo, y la
  auditoría ya registra los cambios. Alternativa más chica: `club_socios(miembro_id, estado, …)` aparte, dejando `tipo` para
  el referente. Es más rápida de hacer, pero deja dos conceptos de «tipo».

### Socios
- **Alta en caja:** `club_socio_alta(nombre, contacto, nota)`, cajero o manager → socio **activo**, validado por quien la cargó.
- **Autoalta:** `club_socio_autoalta(datos, codigo_referidor?)`, pública por club-web con `x-club-web` y tope por IP →
  socio **pendiente**, con pase **pendiente**.
- **Validación en caja:** `club_socio_validar(miembro, nota)`, cajero o manager, en la primera visita → **activo**.
  Mientras está pendiente, el beneficio no aplica.
- **Identificación en caja:** con el código privado del pase o del portal (el mismo mecanismo de R-01, código de un solo
  uso), nunca con el QR público.

### Visitas de socio por factura
`club_visitas_socio(id, miembro_id, ticket_id único, fecha, registrado_por, promos_aplicadas, cortesias, base_crc, descuento_crc_estimado)`.
- El cruce es **exacto por factura**: la factura con el 856 que la caja elige de la lista (como el plan B) o la del pedido.
- **Cuentas separadas:** cada socio, su factura. El beneficio va por factura, no por mesa.

### Catálogo
`pos_ndf_productos(local, codigo, nombre, familia, precio_neto, activo, actualizado)`.
- Lo trae el agente desde `FAC_Productos`.
- Es la **mig 08x, aditiva**, en el orden del RUNBOOK: la migración antes del Edge.

### Promociones
- **`club_promociones`:**
  - nombre y estado (`borrador`, `vigente`, `terminada`);
  - vigencia: fechas, días de la semana y horario;
  - para quién: `socio`, `referente`, `turista_cupon` o `todos`;
  - beneficio: `porcentaje`, `cortesia` o `2x1`;
  - porcentaje y límites (por visita, por persona y por mes).
- **`club_promo_productos(promo_id, codigo o familia, modo, cantidad)`:** `modo` es `incluye`, `excluye` o `cortesia`. Las
  cortesías se eligen del catálogo, con su cantidad.
- **`club_compatibilidad(promo_a, promo_b, combinable)`:** configurable. Más una **regla fija en la base**: una factura
  pagada con créditos no lleva ningún descuento.
- **Motor «qué aplicar»:** `club_aplicar(miembro, pedido)` devuelve el texto para la caja («10 % LC + 1 postre de
  cortesía», o «Paga con créditos: NO aplicar descuento») y lo deja registrado en la visita. La app no toca el PoS.
- **`club_promo_usos(visita, promo, cortesias, costo_estimado)`:** para los reportes por promoción.

### Premios por referido (socio → socio)
`club_premios(id, beneficiario, origen = 'referido_socio', referido, promo o cortesía, estado, creado_en, usado_en, visita_id)`.
- Nace cuando el referido queda **activo**, validado en caja.
- Tope mensual en `club_config`.
- Se consume en la próxima visita del beneficiario.

### Excepciones nuevas
Usan el catálogo y el 856:

| Excepción | Cuándo salta |
|---|---|
| `CANJE_CON_DESCUENTO` | La visita tiene un canje y alguna línea rebajada o el 856. |
| `LC_SIN_REGISTRO` | Factura con el 856 sin visita de socio. |
| `REGISTRO_LC_SIN_856` | Visita de socio con factura sin el 856. |
| `CORTESIA_NO_CONFIGURADA` | Línea `es_cortesia` que ninguna promo vigente de esa visita permite. |
| `PROMO_FUERA_DE_VIGENCIA` | Rebaja o 856 fuera de la vigencia (fecha, día u horario) o sobre productos excluidos, como el menú de mediodía. |

### Pase de Wallet (F1e): uno por persona
- Muestra créditos (si es referente), estado de socio (pendiente o activo), cortesía disponible y promociones vigentes.
- **QR del pase = el público `/r/`, solo si es referente** (cupones de turistas). El socio que no es referente no lleva QR
  público.
- Botón «Código para la caja» = el código privado de un solo uso: canje de créditos e identificación del socio.

### Impacto en la 075
- **Tablas nuevas:** roles, visitas de socio, promociones, productos de la promo, compatibilidad, usos y premios.
- **Funciones:** alta, autoalta, validación, motor y excepciones.
- **Se ajustan:** `club_resolver` (el código privado también identifica al socio), los reportes (socios y promociones,
  con el estándar) y la auditoría (validaciones y premios).
- El canje no cambia, salvo la regla fija de créditos sin descuento.

## 4. Plan por etapas y estimación (días de trabajo, hasta el paquete completo en staging)
| Etapa | Qué | Días |
|---|---|---|
| E0 | Decisiones del dueño: % del LC (10 o 15), cortesías iniciales, matriz de compatibilidad, tope de premios | — |
| E1 | Catálogo en el puente: agente, Edge y mig 08x aditiva; backfill; actualización de la PC | 1,5 |
| E2 | Modelo en la 075: roles, socios, alta, autoalta, validación, visitas por factura, premios por referido; pruebas | 3 |
| E3 | Promociones: tablas, pantalla «Promociones» del owner (vigencia, productos del catálogo, compatibilidad), motor «qué aplicar»; pruebas | 3,5 |
| E4 | Las 5 excepciones LC + descuento real por línea (también mejora `CUPON_SIN_PROMO`); pruebas | 2 |
| E5 | Caja: socio con código privado, alta y validación, el texto «qué aplicar» | 1,5 |
| E6 | club-web: autoalta por QR de la campaña, portal del socio, ES y EN | 1,5 |
| E7 | Reportes: socios y por promoción (usos, costo y margen), con el estándar | 2 |
| E8 | Pase de Wallet F1e: Google con el pase único; Apple con el código listo y apagado hasta el D-U-N-S | 4 |
| E9 | Recorrido integral en staging, auditoría y RUNBOOK actualizado | 1,5 |
| **Total** | | **≈ 20,5** (≈ 16,5 sin el Wallet) |
