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

## Sesión A (esta) · Local Club en la 075, caja, excepciones y pantallas
| Etapa | Qué | Días |
|---|---|---|
| A1 | **Roles** en la 075: tabla, migración de `tipo` → roles, ajuste de `resolver`, `canje`, `cupón`, `buscar`, reportes y migrador. **Stub del contrato del pase** (`club_pase_datos` con referentes reales, eventos, cursor, emisión). Batería y carreras sin regresiones. | 1,5 |
| A2 | **Socios:** alta en caja, autoalta (función pública + club-web `/s`, ES y EN), validación en caja, premio por referir (config + tope mensual), auditoría y eventos del pase. Pruebas. | 1,5 |
| A3 | **Promociones mínimas + productos:** tablas, vista de productos desde las líneas, pantalla «Promociones», cortesías, la promo inicial «Local Club 10 % + cortesía» (en borrador). Pruebas. | 1,5 |
| A4 | **Motor «qué aplicar» + visita por factura:** identificar al socio con el código de un solo uso, regla fija de créditos, la pantalla única en Escanear, visita y cruce por el 856. `club_pase_datos` completo (socio, cortesías, promociones). Pruebas. | 2 |
| A5 | **Excepciones** `CANJE_CON_DESCUENTO`, `LC_SIN_REGISTRO` y `REGISTRO_LC_SIN_856` en Excepciones, en el reporte y en la calidad del mes. Pruebas con facturas sintéticas y con las 142 facturas LC reales (solo lectura). | 1 |
| A6 | **Cierre:** recorrido integral con capturas (alta en caja, autoalta → validación → premio, visita con el 856, canje + LC → alarma), paridad, carreras, guía de uso (`docs/sop-app/`) y RUNBOOK actualizado. | 1,5 |
| | **Total A** | **9** |

## Sesión B (otra sesión de Claude Code) · pase de Wallet
| Etapa | Qué | Días |
|---|---|---|
| B1 | Edge `club-pase` en staging: firma del JWT «Save to Google Wallet», clase y objeto por miembro, con el JSON de ejemplo del contrato. | 1,5 |
| B2 | club-web: «Agregar a Google Wallet» en el portal y al final de la autoalta (ES y EN), con `x-club-web` y tope. | 0,5 |
| B3 | Sincronización: lector de eventos cada 2 min + «Actualizar mi pase»; mensajes del pase desde `club_alertas`; baja → pase expirado. | 1,5 |
| B4 | Apple: `.pkpass` y web service de actualización, **apagado** por flag. | 1,5 |
| B5 | Integración con los datos reales de A (stub del día 1, completo desde el día 5) y prueba en un teléfono real con Google Wallet. | 1 |
| | **Total B** | **6** |

## Qué depende de qué
- **B1 a B4 no esperan a A:** usan el JSON de ejemplo del contrato.
- **B5 necesita** el stub de A1 (referentes, día 1-2) y el `club_pase_datos` completo de A4 (día 6-7).
- **A2 y A4 necesitan A1** (roles). **A4 necesita A3** (promociones y productos). **A5 necesita A4** (visitas).
- **El lanzamiento necesita A6 y B5**, más el RUNBOOK (que suma: cambio del PoS de 15 % a 10 % y el artículo
  «PROMO CLUB 10%» cargado en `promo_articulo_codigo`).
- **Camino crítico:** A1 → A3 → A4 → A5 → A6 ≈ **9 días**. B termina antes (≈ 6 días + espera de A4 para B5).

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
