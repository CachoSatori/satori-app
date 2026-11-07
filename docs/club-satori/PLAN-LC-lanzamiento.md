# Plan · Local Club con alcance mínimo para lanzar (07-nov-2026)

> Reemplaza el plan de [PROPUESTA-LC-modelo.md](PROPUESTA-LC-modelo.md) §4. **No se construye hasta el OK de este plan.**
> Solo staging. Dos sesiones en paralelo, con la frontera escrita en [CONTRATO-pase.md](CONTRATO-pase.md).

## Decisiones de Ismael (07-nov) que este plan da por hechas
- **Beneficio LC:** 10 % + cortesía. El PoS pasa de 15 % a 10 % **el mismo día del lanzamiento**.
- **Créditos + descuento:** `CANJE_CON_DESCUENTO`. Está bien que salte.
- **Promo del cupón:** artículo marcador «PROMO CLUB 10%» como control principal (lo crea Ismael). La detección por precio
  contra la lista queda como respaldo, cuando haya catálogo (después del lanzamiento).
- **Alcance mínimo.** Queda **después del lanzamiento**: el armador completo de promociones, la sincronización del
  catálogo con precios, la detección por precio y los reportes avanzados del socio.

## Qué entra (lanzamiento) y cómo
| Pieza | Cómo, en mínimo |
|---|---|
| Miembro con roles | `club_miembro_roles(miembro_id, rol, estado, desde, validado_por, validado_en, alta_por, referido_por)`. `rol`: `referente`, `concierge_pm`, `equipo` o `socio`. Estado del socio: `pendiente`, `activo` o `baja`. Se migra `tipo` → roles (y se ajusta el migrador F1b). |
| Alta en caja | Escanear → «Nuevo socio»: nombre, WhatsApp (o email) y «validé que es local». Queda **activo**. Cajero o manager. |
| Autoalta | club-web `/s` (el QR de la campaña de WhatsApp): formulario → socio **pendiente** + pase pendiente. La primera vez que va, la caja lo identifica con el código del pase o del portal y toca «Validar socio» → **activo**. Función pública con `x-club-web` y tope por IP, igual que el cupón. |
| Premio por referir socios | El link de autoalta lleva el código del socio que refiere. Cuando el referido queda **activo**, el que refirió gana la cortesía configurada (por defecto, 1 postre en su próxima visita). Tope de premios por mes en `club_config`. |
| Visita del socio por factura | `club_visitas_socio` (una por factura). La caja identifica al socio, la app dice qué aplicar y se elige el pedido o la factura (como hoy). El cruce exacto es el artículo **856** en esa factura. Cuentas separadas: cada socio, su factura. |
| Beneficio | `club_promociones` mínima: nombre, para quién (`socio`, `referente`, `turista_cupon`, `todos`), vigencia (desde y hasta, días y horario), porcentaje y cortesías (producto + cantidad), estado (`borrador`, `vigente`, `terminada`). Arranca con «Local Club: 10 % + 1 cortesía». |
| Productos para cortesías | Vista con los códigos y nombres que **ya llegan** en `pos_ndf_ticket_lines` (últimos 120 días, con familia). **Sin tocar el agente.** |
| Compatibilidad mínima | Regla fija en la base: **pagar con créditos = sin descuento** (el motor no ofrece ni el 10 % ni la cortesía si se canjea en esa visita). Sin matriz configurable en el lanzamiento. |
| Excepciones | `CANJE_CON_DESCUENTO`: factura con créditos (cxc > 0 o canje del Club) que tiene el 856, «PROMO CLUB 10%» o una línea en cortesía. `LC_SIN_REGISTRO`: factura con el 856 sin visita de socio. `REGISTRO_LC_SIN_856`: visita de socio cuya factura no tiene el 856. Las tres, con segregación y auditoría como las demás. |
| Pantalla de promociones | Club → «Promociones» (owner): lista de vigentes, crear, editar, vigencia y para quién, porcentaje y cortesías del listado. Sin el armador completo. |
| Escanear | Una sola pantalla «Qué aplicar», según lo que se escaneó (código del pase o del portal, cupón de turista): «10 % LC + 1 postre de cortesía», «Paga con créditos: NO aplicar descuento», «Socio pendiente: validalo primero». |

## Ajustes y decisiones del 07-nov (OK al plan 6c1a5fb)
1. **Control del 10 % (A5): `DESCUENTO_SIN_RESPALDO`.**
   - **Precio de referencia por artículo:** el precio unitario **modal** de los últimos 30 días, sin las facturas con el 856
     ni con «PROMO CLUB 10%».
   - **Cuándo salta:** una línea por debajo de su referencia, en una factura sin cupón ni 856.
   - **Sin tocar** el agente ni el catálogo.
   - **Para que un cambio de lista no dispare una avalancha:**
     - el precio de referencia se calcula **por día**, con la moda de los 30 días anteriores a esa factura;
     - una baja que se repite en ≥ 60 % de las ventas del artículo en el día **es el precio nuevo**, no una excepción;
     - además, una sola excepción por factura, no por línea.

     Se documenta junto a la función.
   - **Pruebas:** una factura LC legítima no salta; un descuento suelto sí; un cambio de lista no genera una avalancha.
2. **QR fijo del socio (CONFIRMADO).**
   - Sirve solo para identificarse (10 % y cortesía), **nunca para créditos**. Los créditos siguen con el código de un solo uso.
   - Tope: 1 visita por día por socio.
   - `SOCIO_USO_ANOMALO`: el mismo QR en dos mesas el mismo día, o más de **N** visitas por semana (N configurable, 5 por
     defecto).
3. **Anfitrión y cliente** (una persona, un pase, roles socio y/o referente; «anfitrión» = referente):
   - **Portal `/p/` con dos pestañas:** «Mi Club» (10 %, cortesías, visitas, créditos) y «Anfitrión» (QR y link de cupones,
     referidos, créditos ganados, «Canjear»). Con un solo rol, una sola pestaña.
   - **Pase:** si es socio, el código de barras es el QR del socio, y el QR de cupones va en la pestaña Anfitrión y como
     link en el reverso. Si es solo referente, el código de barras es el QR de cupones, como hoy.
   - **Caja:** Escanear reconoce los dos QR por prefijo (`/s/` socio, `/r/` cupones) y muestra qué es cada uno.
   - **Activar a un socio como anfitrión:** solo manager u owner, desde la app, con auditoría.
   - **Antiautocanje:** un cupón no aplica en una factura donde el mismo anfitrión registró visita de socio (prueba
     negativa en la batería). Si el cruce lo detecta después, `CUPON_AUTOREFERIDO`.
   - **Tope mensual de créditos para anfitrión nuevo:** configurable, por defecto ₡25.000 (provisorio). Se aplica al
     **canje**: valor canjeado por mes calendario, durante los primeros 90 días como anfitrión. Si Ismael lo quiere sobre
     lo **ganado**, se cambia.
   - **Fase 2** (no ahora): botón «Quiero ser anfitrión» y topes por desempeño.
4. **Decisiones (configurables):**
   - **Vigencia LC:** todos los días, mañana y mediodía incluidos (CONFIRMADO).
   - **Alta de local:** el cajero marca «verifiqué residencia». Obligatorios nombre y WhatsApp. **Nunca** se guardan números
     de cédula, DIMEX ni pasaporte (provisorio).
   - **Premio por referir socios:** 1 cortesía, máximo 3 por mes, vence a los 60 días (provisorio).
   - **Cortesía LC:** configurable y **vacía** hasta que Ismael elija el producto.
5. **Avance:** [AVANCE-LC.md](AVANCE-LC.md), por etapa, con estado, SHA y pruebas en números (para las sesiones nocturnas).

### Dónde caen los puntos 2 y 3, y cuánto suman
| Etapa | Suma | Días antes → ahora |
|---|---|---|
| A1 | QR fijo del socio (`codigo_socio`, prefijo `/s/`, 9 caracteres a mano). Escanear reconoce `/s/` y `/r/`. «Activar como anfitrión» (owner y manager, con auditoría). Contrato del pase con la regla del código de barras | 1,5 → **2** |
| A4 | Tope de 1 visita por día. Antiautocanje en el cupón. Tope mensual del anfitrión nuevo. Portal con las dos pestañas | 2 → **3** |
| A5 | `DESCUENTO_SIN_RESPALDO` (punto 1), `SOCIO_USO_ANOMALO`, `CUPON_AUTOREFERIDO` | 1 → **1,5** |
| B5 | Código de barras según el rol, link de cupones en el reverso, «Mi Club» y «Anfitrión» en el pase | 1 → **1,5** |

**Total A: 9 → 11 días** (camino crítico). **Total B: 6 → 6,5 días.**

## Sesión A (esta) · Local Club en la 075, caja, excepciones y pantallas
| Etapa | Qué | Días |
|---|---|---|
| A1 | **Roles** en la 075 (`club_miembro_roles`; `tipo` queda como espejo del rol de anfitrión, para no romper lo que ya anda). QR fijo del socio. «Activar como anfitrión». **Stub del contrato del pase** (`club_pase_datos` con referentes reales, eventos, cursor, emisión). Batería y carreras sin regresiones. | 2 |
| A2 | **Socios:** alta en caja, autoalta (función pública + club-web `/s`, ES y EN), validación en caja, premio por referir (config + tope mensual), auditoría y eventos del pase. Pruebas. | 1,5 |
| A3 | **Promociones mínimas + productos:** tablas, vista de productos desde las líneas, pantalla «Promociones», cortesías, la promo inicial «Local Club 10 % + cortesía» (en borrador). Pruebas. | 1,5 |
| A4 | **Motor «qué aplicar» + visita por factura:** el socio se identifica con su QR fijo (`/s/`), regla fija de créditos, pantalla única en Escanear, visita y cruce por el 856, tope de 1 visita por día, antiautocanje, tope mensual del anfitrión nuevo, portal con dos pestañas. `club_pase_datos` completo. Pruebas. | 3 |
| A5 | **Excepciones** `CANJE_CON_DESCUENTO`, `LC_SIN_REGISTRO`, `REGISTRO_LC_SIN_856`, `DESCUENTO_SIN_RESPALDO`, `SOCIO_USO_ANOMALO` y `CUPON_AUTOREFERIDO`. Pruebas con facturas sintéticas y con las 142 facturas LC reales (solo lectura). | 1,5 |
| A6 | **Cierre:** recorrido integral con capturas (alta en caja, autoalta → validación → premio, visita con el 856, canje + LC → alarma), paridad, carreras, guía de uso (`docs/sop-app/`) y RUNBOOK actualizado. | 1,5 |
| | **Total A** | **11** |

## Sesión B (otra sesión de Claude Code) · pase de Wallet
| Etapa | Qué | Días |
|---|---|---|
| B1 | Edge `club-pase` en staging: firma del JWT «Save to Google Wallet», clase y objeto por miembro, con el JSON de ejemplo del contrato. | 1,5 |
| B2 | club-web: «Agregar a Google Wallet» en el portal y al final de la autoalta (ES y EN), con `x-club-web` y tope. | 0,5 |
| B3 | Sincronización: lector de eventos cada 2 min + «Actualizar mi pase»; mensajes del pase desde `club_alertas`; baja → pase expirado. | 1,5 |
| B4 | Apple: `.pkpass` y web service de actualización, **apagado** por flag. | 1,5 |
| B5 | Integración con los datos reales de A, código de barras según el rol (socio → QR del socio; solo referente → QR de cupones), link de cupones en el reverso, y prueba en un teléfono real. | 1,5 |
| | **Total B** | **6,5** |

## Qué depende de qué
- **B1 a B4 no esperan a A:** usan el JSON de ejemplo del contrato.
- **B5 necesita** el stub de A1 (referentes, día 1-2) y el `club_pase_datos` completo de A4 (día 6-7).
- **A2 y A4 necesitan A1** (roles). **A4 necesita A3** (promociones y productos). **A5 necesita A4** (visitas).
- **El lanzamiento necesita A6 y B5**, más el RUNBOOK (que suma: cambio del PoS de 15 % a 10 % y el artículo
  «PROMO CLUB 10%» cargado en `promo_articulo_codigo`).
- **Camino crítico:** A1 → A3 → A4 → A5 → A6 ≈ **11 días**. B termina antes (≈ 6,5 días + espera de A4 para B5).

## Qué necesito de Ismael y cuándo
| Cuándo | Qué | Para |
|---|---|---|
| **Antes de arrancar (día 0)** | OK de este plan y del contrato | A y B |
| Día 0 | Cuenta de **Google Pay & Wallet Console** (issuer) y la **cuenta de servicio**: cargar `GOOGLE_WALLET_ISSUER_ID` y `GOOGLE_WALLET_SA_KEY` como secretos del Edge en staging (nunca por chat) | B1 |
| Día 0 | Logo, colores e imagen del local para el pase (o aprobar la propuesta de B) | B1 |
| Día 1 | **Criterio de «es local»** que valida la caja (cédula de residencia, recibo, conocerlo…) y los datos mínimos del alta (¿WhatsApp obligatorio?) | A2 |
| Día 2 | **Premio por referir:** qué cortesía (producto y cantidad), **tope por mes** y si vence | A2 |
| Día 3 | **La cortesía del LC:** qué producto(s) y cantidad; **vigencia** (¿todos los días y horarios? ¿sin menú de mediodía?) | A3 |
| Día 3 | Crear en el PoS el artículo **«PROMO CLUB 10%»** y pasarme su código | A5 y el cupón (R-02) |
| Día 5 | Un teléfono Android con Google Wallet para la prueba real | B5 |
| Día 6-7 | Recorrido en staging con la caja (15 min) y OK | A6 |
| **Día del lanzamiento** | Cambiar en el PoS el LC de **15 % a 10 %**; firmas del RUNBOOK | prod |
| Más adelante | D-U-N-S para encender Apple | B4 |

**Sigue pendiente de antes:** actualizar el agente de staging a `0cf4d87` (clave del pedido con fecha), con el plan del
agente. No bloquea el Local Club.

## Riesgos y cómo se cubren
- **Sin precios en el lanzamiento:** el 10 % no se verifica por precio. El control es el 856 (cruce exacto),
  «PROMO CLUB 10%» para el cupón y `CANJE_CON_DESCUENTO` para la regla fija. La detección por precio entra después.
- **Socios que no validan nunca:** quedan pendientes sin beneficio; un filtro en Miembros los lista.
- **La migración de `tipo` a roles** toca casi todas las funciones del Club: por eso va primero, con la batería completa
  como red.
