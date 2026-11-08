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
   - **Tope mensual de créditos para anfitrión nuevo:** ver la segunda tanda (abajo). **No bloquea:** sobre lo ganado,
     con alerta y créditos pendientes de aprobación.
   - **Fase 2** (no ahora): botón «Quiero ser anfitrión» y topes por desempeño.
4. **Decisiones (configurables):**
   - **Vigencia LC:** todos los días, mañana y mediodía incluidos (CONFIRMADO).
   - **Alta de local:** el cajero marca «verifiqué residencia». Obligatorios nombre y WhatsApp. **Nunca** se guardan números
     de cédula, DIMEX ni pasaporte (provisorio).
   - **Premio por referir socios:** 1 cortesía, máximo 3 por mes, vence a los 60 días (provisorio).
   - **Cortesía LC:** por sorteo entre las activas (ver la segunda tanda). Vacía hasta que Ismael cargue las cortesías.
5. **Avance:** [AVANCE-LC.md](AVANCE-LC.md), por etapa, con estado, SHA y pruebas en números (para las sesiones nocturnas).

### Dónde caen los puntos 2 y 3, y cuánto suman
| Etapa | Suma | Días antes → ahora |
|---|---|---|
| A1 | QR fijo del socio (`codigo_socio`, prefijo `/s/`, 9 caracteres a mano). Escanear reconoce `/s/` y `/r/`. «Activar como anfitrión» (owner y manager, con auditoría). Contrato del pase con la regla del código de barras | 1,5 → **2** |
| A4 | Tope de 1 visita por día. Antiautocanje en el cupón. Tope mensual del anfitrión nuevo. Portal con las dos pestañas | 2 → **3** |
| A5 | `DESCUENTO_SIN_RESPALDO` (punto 1), `SOCIO_USO_ANOMALO`, `CUPON_AUTOREFERIDO` | 1 → **1,5** |
| B5 | Código de barras según el rol, link de cupones en el reverso, «Mi Club» y «Anfitrión» en el pase | 1 → **1,5** |

**Total A: 9 → 11 días** (camino crítico). **Total B: 6 → 6,5 días.**

## Decisiones vigentes («1b», confirmadas el 07-nov a la noche) — mandan sobre las tandas de abajo
1. **Cortesías por sorteo:** admin del Club con **máximo 10** cortesías activables o desactivables, cada una ligada a un
   artículo de la sección **«CORTESÍA CLUB»** del PoS (₡0; los códigos los pasa Ismael). Sorteo **fijo por visita** (no se
   vuelve a sortear), **1 cortesía por visita, 1 visita por día**. Excepciones `CORTESIA_DISTINTA`, `CORTESIA_SIN_SOCIO` y
   `CORTESIA_NO_CONFIGURADA`. (Reemplaza el cruce por «familia 17» de la segunda tanda.)
2. **Tope del anfitrión sobre lo GANADO:** alerta `ANFITRION_SOBRE_TOPE` **siempre** que pase ₡25.000 en el mes; retención
   «pendiente de aprobación» **solo en sus primeros 90 días**; aprueba un manager u owner **distinto del anfitrión**.
3. **Wallet:** Google sigue **ya**; Apple programado y **apagado** hasta el D-U-N-S.
4. **PROMO CLUB 10 %** existe en el PoS; el código lo pasa Ismael aparte. Mientras, R02 queda en **«pendiente de
   configuración»**.
5. **Turnstile en staging con las claves de prueba de Cloudflare** (las de prod las carga Ismael; RUNBOOK paso 6).

## Más decisiones del 07-nov (segunda tanda)
1. **Cortesías del LC = SORTEO.**
   - **Admin del Club → «Cortesías»:** hasta **10** cortesías cargadas, cada una activable o desactivable. Se eligen de los
     productos que llegan en las facturas del puente, igual que en A3.
   - **Al escanear al socio** se sortea **una** entre las activas. El resultado queda registrado en la visita y **no se
     vuelve a sortear**: un segundo escaneo devuelve la misma (prueba negativa en la batería).
   - **Frecuencia configurable:** por defecto, 1 cortesía por visita y 1 visita por día.
   - **`CORTESIA_DISTINTA`:** el producto cobrado como cortesía en la factura no coincide con el sorteado.
   - **Cómo se cobra hoy una cortesía en Nube de Fuego** (facturas reales desde el 1-sep):
     - es un **artículo aparte, a precio 0, de la familia 17 «Cortesías»**: «CREPE CORTESIA» (397, 30 veces) y «BANANA
       FLAMBE CORTESIA» (398, 7 veces);
     - el puente lo marca `es_cortesia` por la familia 17 y la factura queda con `clase_ingreso = 'cortesia'` (37
       facturas). 14 de esas 37 son Local Club (856);
     - no hay cortesías hechas con «línea al 100 %» sobre el producto del menú. Hay líneas sueltas a ₡0 fuera de la
       familia 17 (1 o 2 por producto), que son ajustes;
     - además, **el 857 «INVITADO» (₡0) aparece en 104 facturas, 90 de ellas junto al 856**: hay que preguntarle a Ismael
       qué marca.
   - **Diseño del cruce:** cada cortesía del admin es **un artículo de cortesía del PoS (familia 17)**, con su nombre y su
     producto del menú de referencia. `CORTESIA_DISTINTA` compara las líneas de la familia 17 de la factura de la visita
     contra el código sorteado:
     - salta si hay otra cortesía, o si hay una de más;
     - si no hay ninguna, no es excepción: el socio puede no pedirla;
     - como respaldo, una línea a ₡0 fuera de la familia 17 también cuenta como cortesía cobrada.
   - **Para Ismael:** si quiere otras cortesías (por ejemplo un postre del día), tiene que crear en el PoS su artículo
     «… CORTESIA» en la familia 17. Hoy solo hay 2.
2. **Tope del anfitrión nuevo: NO bloquea.**
   - A ₡25.000 por mes (configurable) salta la alerta `ANFITRION_SOBRE_TOPE`.
   - Los créditos **ganados** que pasen ese monto quedan **«pendientes de aprobación»**: no suman al saldo hasta que un
     manager u owner los aprueba, con auditoría. **Quien aprueba no puede ser el anfitrión.**
   - Reemplaza la lectura anterior (sobre lo canjeado).
3. **Wallet:** Google arranca **ya** (no depende del D-U-N-S). Apple queda programado y apagado; se enciende cuando llegue
   el D-U-N-S.
4. **«PROMO CLUB 10%» ya está creado en el PoS.**
   - El código llegó como `<PEGAR CÓDIGO>`: **falta el número**.
   - En las facturas del puente todavía no aparece ninguna línea «PROMO CLUB…» (no se usó todavía, o el nombre es otro).
   - Con el código, se carga en `club_config.promo_articulo_codigo` (staging ahora; prod en el RUNBOOK) y se enciende
     `CUPON_SIN_PROMO`.

### Dónde caen y cuánto suman
| Etapa | Suma | Días |
|---|---|---|
| A3 | Admin «Cortesías» (hasta 10, activables, del listado de productos de las facturas) y la frecuencia en `club_config` | 1,5 → **2** |
| A4 | Sorteo al escanear (uno por visita, registrado, mismo resultado si se reescanea). Créditos pendientes de aprobación del anfitrión nuevo: tabla aparte, aprobación de owner o manager que no sea el anfitrión, auditoría, pantalla en la ficha | 3 → **4** |
| A5 | `CORTESIA_DISTINTA` y `ANFITRION_SOBRE_TOPE` | 1,5 → **2** |
| B | El pase muestra «1 cortesía sorpresa» (no el producto: se sortea en caja). Google arranca ya | sin cambio (**6,5**) |

**Total A: 11 → 12,5 días** (camino crítico). **Total B: 6,5.**

## Tercera tanda (08-nov): respuestas, auditoría de Grok ronda 5 — van antes de A2 y B1
1. **Tope del anfitrión, sobre lo GANADO.**
   - `ANFITRION_SOBRE_TOPE` salta **siempre** que supere ₡25.000 en el mes (configurable).
   - La **retención** («pendiente de aprobación») aplica **solo en sus primeros 90 días** como anfitrión.
   - Aprueba un manager u owner que **no** sea el anfitrión, con auditoría.
2. **`DESCUENTO_SIN_RESPALDO`:** criterio confirmado (60 % por día, una excepción por factura).
3. **Cortesías por SECCIÓN DEL PoS.**
   - Ismael crea en Nube de Fuego la sección «CORTESÍA CLUB», con cada producto como artículo propio a ₡0.
   - Cada cortesía del admin (hasta 10, activable) **es un artículo de esa sección**.
   - Cruce por código de artículo:
     - `CORTESIA_DISTINTA`: un artículo distinto al sorteado;
     - `CORTESIA_SIN_SOCIO`: un artículo de la sección en una factura sin visita de socio;
     - `CORTESIA_NO_CONFIGURADA`: una línea a ₡0 o al 100 % fuera de la sección.
   - Los códigos los pasa Ismael cuando los cree.
4. **Correcciones de diseño:**
   - **LC-DES-01:** el alta en caja queda **«activo provisional»**: el socio usa el 10 % ese día. Un manager u owner
     **distinto de quien lo cargó** lo confirma dentro de **7 días**; si no, vuelve a pendiente. Se suman
     `SOCIO_ALTA_SIN_CONFIRMAR` y el reporte de altas por cajero. Prueba negativa: quien cargó no confirma.
   - **LC-DES-02:** el premio por referir nace **solo con la primera factura C pagada del referido con el 856**, no con la
     validación. Sin ciclos, sin autorreferido (mismo teléfono), con tope por referente y por validador. Pruebas negativas
     de cada caso. **Pasa de A2 a A4** (necesita el cruce de visitas).
   - **LC-DES-07:** autoalta con Turnstile, tope por IP y tope global por día, purga de pendientes sin validar a los 30
     días, aviso de privacidad versionado con link de baja (texto provisorio; lo firma Ismael), datos mínimos (nombre y
     WhatsApp).
   - **CLUB-AUD-69:** el pase **no** lleva el token del portal. Lleva un **token de pase propio**, revocable y regenerable
     (regenerarlo actualiza el pase). Con él solo se abre «Canjear», que sigue con el código de un solo uso. Prueba: un
     token revocado no genera código.
   - **CLUB-AUD-70:** el cursor del pase solo avanza; el rebobinado es una función aparte y explícita. Prueba: dos
     sincronizaciones simultáneas dejan el cursor en el máximo.
   - **R02:** con `promo_articulo_codigo` en NULL, `CUPON_SIN_PROMO` y `PROMO_SIN_CUPON` salen **«pendiente de
     configuración»**, nunca «ok». El código de PROMO CLUB 10% se carga cuando llegue.
   - **LC-DES-10:** la 075 **no** está en prod y se sigue corrigiendo en el mismo archivo. RUNBOOK, paso 0: verificar el
     ledger de prod; **si aparece la 075, se frena todo**.
5. **Cola de endurecimiento** (para las sesiones nocturnas cuando una etapa está bloqueada), en este orden:
   - ~~**CLUB-AUD-36:** resolver solo excepciones que existen, con segregación por quien las registró;~~ **HECHO** `3e294a5`
   - ~~**38:** lock en el conteo de intentos;~~ **HECHO** `2b306ff`
   - ~~**68:** `estado = 'C'` en el cruce del camino viejo (factura tipeada), o retirar ese camino;~~ **HECHO** `f3b65cb`
     (se eligió `estado = 'C'`)
   - ~~**R02 «pendiente de configuración»**~~ **HECHO** `8a76ed8` (sale de A5)
   - **42:** que la rama `pruebas` no exista en prod;
   - **43:** asserts fuertes en la batería (W1–W14);
   - **en la rama del puente, sin desplegar:**
     - 44/45: ingesta transaccional por local;
     - 46: ignorar el `last_poll_at` que llega y que `last_factura` solo avance;
     - 47: secreto ≥ 32 caracteres, sin duplicados;
     - 48: topes de largo.
6. **CRM viejo** (CLUB-AUD-64 / LC-DES-09): diagnóstico y plan en [PLAN-CRM-cierre.md](PLAN-CRM-cierre.md). **Solo el
   plan**: toca RLS de prod y lo firma Ismael.

### Dónde caen y cuánto suman
| Etapa | Suma | Días |
|---|---|---|
| A2 | Alta provisional + confirmación por otra persona en 7 días + vuelta a pendiente. Autoalta con Turnstile, topes, purga a 30 días, aviso de privacidad versionado y baja. Token de pase propio (AUD-69) y cursor con rebobinado aparte (AUD-70). **Sale** el premio por referir (pasa a A4) | 1,5 → **2,5** |
| A4 | Premio por referir con la primera factura C con el 856, sin ciclos ni autorreferido, con topes | 4 → **4,5** |
| A5 | `SOCIO_ALTA_SIN_CONFIRMAR`, `CORTESIA_SIN_SOCIO`, `CORTESIA_NO_CONFIGURADA`, ~~«pendiente de configuración» de R02~~ (hecho el 08-nov, `8a76ed8`), reporte de altas por cajero | 2 → **2,5** |
| B | Link de «Canjear» con el token de pase (no el del portal) | 6,5 → **7** |

**Total A: 12,5 → 14,5 días** (A1 hecha: quedan ≈ 12,5). **Total B: 7.** La cola de endurecimiento no suma al camino
crítico: la usan las noches cuando una etapa está bloqueada.

## Sesión A (esta) · Local Club en la 075, caja, excepciones y pantallas
| Etapa | Qué | Días |
|---|---|---|
| A1 | **Roles** en la 075 (`club_miembro_roles`; `tipo` queda como espejo del rol de anfitrión, para no romper lo que ya anda). QR fijo del socio. «Activar como anfitrión». **Stub del contrato del pase** (`club_pase_datos` con referentes reales, eventos, cursor, emisión). Batería y carreras sin regresiones. | 2 |
| A2 | **Socios:** alta en caja (activo provisional + confirmación de otra persona en 7 días), autoalta (club-web `/alta`, ES y EN, Turnstile, topes, purga a 30 días, aviso de privacidad versionado), validación en caja, token de pase propio, cursor con rebobinado aparte, auditoría y eventos del pase. Pruebas. | 2,5 |
| A3 | **Promociones mínimas + productos + cortesías del sorteo:** tablas, vista de productos desde las líneas, pantalla «Promociones», admin «Cortesías» (hasta 10, activables), la promo inicial «Local Club 10 % + cortesía» (en borrador). Pruebas. | 2 |
| A4 | **Motor «qué aplicar» + visita por factura:** el socio se identifica con su QR fijo (`/s/`), sorteo de la cortesía (uno por visita), regla fija de créditos, pantalla única en Escanear, visita y cruce por el 856, tope de 1 visita por día, antiautocanje, créditos pendientes de aprobación del anfitrión nuevo, portal con dos pestañas. `club_pase_datos` completo. Pruebas. | 4 |
| A5 | **Excepciones** `CANJE_CON_DESCUENTO`, `LC_SIN_REGISTRO`, `REGISTRO_LC_SIN_856`, `DESCUENTO_SIN_RESPALDO`, `SOCIO_USO_ANOMALO`, `CUPON_AUTOREFERIDO`, `CORTESIA_DISTINTA` y `ANFITRION_SOBRE_TOPE`. Pruebas con facturas sintéticas y con las 142 facturas LC reales (solo lectura). | 2 |
| A6 | **Cierre:** recorrido integral con capturas (alta en caja, autoalta → validación → premio, visita con el 856, canje + LC → alarma), paridad, carreras, guía de uso (`docs/sop-app/`) y RUNBOOK actualizado. | 1,5 |
| | **Total A** | **14,5** |

## Sesión B (otra sesión de Claude Code) · pase de Wallet
| Etapa | Qué | Días |
|---|---|---|
| B1 | Edge `club-pase` en staging: firma del JWT «Save to Google Wallet», clase y objeto por miembro, con el JSON de ejemplo del contrato. | 1,5 |
| B2 | club-web: «Agregar a Google Wallet» en el portal y al final de la autoalta (ES y EN), con `x-club-web` y tope. | 0,5 |
| B3 | Sincronización: lector de eventos cada 2 min + «Actualizar mi pase»; mensajes del pase desde `club_alertas`; baja → pase expirado. | 1,5 |
| B4 | Apple: `.pkpass` y web service de actualización, **apagado** por flag. | 1,5 |
| B5 | Integración con los datos reales de A, código de barras según el rol (socio → QR del socio; solo referente → QR de cupones), link de cupones en el reverso, y prueba en un teléfono real. | 1,5 |
| | **Total B** | **7** |

## Qué depende de qué
- **B1 a B4 no esperan a A:** usan el JSON de ejemplo del contrato.
- **B5 necesita** el stub de A1 (referentes, día 1-2) y el `club_pase_datos` completo de A4 (día 6-7).
- **A2 y A4 necesitan A1** (roles). **A4 necesita A3** (promociones y productos). **A5 necesita A4** (visitas).
- **El lanzamiento necesita A6 y B5**, más el RUNBOOK (que suma: cambio del PoS de 15 % a 10 % y el artículo
  «PROMO CLUB 10%» cargado en `promo_articulo_codigo`).
- **Camino crítico:** A1 → A3 → A4 → A5 → A6 ≈ **12,5 días** (A1 ya hecha: quedan ≈ 10,5). B termina antes (≈ 6,5 días + espera de A4 para B5). **Google arranca ya.**

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
