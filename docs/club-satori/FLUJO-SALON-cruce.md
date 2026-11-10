# Flujo real del salón y el cruce con el PoS — explicación y propuestas

> 09-nov, pedido del dueño. **Solo explicación y propuestas: no se cambió nada.**
> - **v2 (tarde):** suma dos datos que cambian el análisis de la mañana:
>   - **en este PoS la factura queda en `R` hasta el CIERRE DE CAJA** (16:00 y ~23:00) y recién ahí pasa a `C`;
>   - **con el agente de prod de hoy (`4d3513a`), `consecutivo_fe`, `clave_fe` y `mesa_factura` llegan en null.**
> - **Fuentes:** el código de hoy (`075_club_satori_esquema.sql` de la rama del Club, `src/shared/api/club.ts`,
>   `src/modules/club/Escanear.tsx`, la 082 v3) y una lectura de STAGING de solo lectura (§0). Las líneas son
>   aproximadas.

**El flujo del salón, según el dueño:**
1. Primero se escanea el QR y se confirma en la app.
2. Recién después se aplica en el PoS (el 856, la cortesía o la promo).
3. La cortesía puede salir al inicio, y el cliente paga 40 minutos o más después.
4. La factura pasa a `C` en el cierre de caja, no al cobrar.

## 0. Lo que muestran los datos (staging, mismo PoS, solo lectura)
- **Las facturas de la noche del 08-nov** se registraron entre las 17:39 y las 22:31 (hora de Costa Rica). **Todas**
  tienen `fecha_cierra` = **22:33** y entraron como `C` a las 22:43 (`ingested_at`). Hasta el cierre de caja fueron
  `R`.
- **El agente relee las `R`** de las últimas 36 h en cada ciclo (082 v3): las `R` **están** en `pos_ndf_tickets`
  durante el servicio, con su `numero_pedido`.
- **En staging el agente es el nuevo** y trae `mesa_factura`, `consecutivo_fe` y `pedido_abierto_en`. En prod, el
  agente `4d3513a` **no** los trae (RESULTADO del pase, 09-nov).
- **`mesa` solo viene en las facturas con pedido:** 83 de 97 `C`, las mismas 83 que tienen pedido. Una factura sin
  pedido no trae mesa por ningún lado con el agente viejo.

## Resumen
1. **El cruce del Club solo mira facturas `C`.** Con el cierre de caja a las 16:00 y ~23:00, una mesa cobrada a las
   20:00 queda **sin cruce hasta ~22:45**.
2. **«Sin cruce» falso, todas las noches.** «SIN_CRUCE» sale cuando el pedido ya no está abierto y pasaron 30 min
   desde el escaneo. Con el flujo del dueño se cumple apenas se cobra. Así, **cada registro de cupón, tarjeta o canje
   de una mesa cobrada antes del cierre aparece como «SIN_CRUCE» por error** durante horas, y desaparece solo después
   del cierre. Lo mismo pasa con el «sin factura» del reporte de visitas de socio.
3. **El plan B no sirve durante el servicio.** La lista «facturas de las últimas 2 h» solo muestra `C`, y antes del
   cierre de caja no hay ninguna. Después del cierre, las facturas de la noche ya tienen más de 2 h.
4. **Hay un caso donde se PIERDE un beneficio en el servicio.** Si una factura se anula y se rehace, gerencia no puede
   aprobar las personas pendientes de un anfitrión nuevo hasta el cierre: la refactura está en `R` y el sistema dice
   «rechazalo».
5. **Con el agente viejo (prod) las cuentas divididas no cruzan nunca:** la factura sin pedido no trae mesa.
   Tampoco anda la búsqueda por los dígitos del tiquete: no hay `consecutivo_fe`. Esto lo arregla el agente nuevo, no
   el Club.

Lo del resumen se suma a lo de la mañana: mesas juntadas, cuenta dividida sin principal y visitas de socio sin
elección manual (§3 y §5).

## (a) Cuándo y con qué dato se elige la mesa/pedido
1. **La caja escanea el QR.** Para un cupón, una tarjeta, un canje o una visita de socio, la pantalla pide el
   **pedido** (`SelectorPedido`, `Escanear.tsx` ~283).
2. **La lista** sale de `club_pedidos_abiertos` (075 ~2475): los pedidos que el puente ve abiertos en el PoS
   (`pos_ndf_open`, foto de cada ciclo, ~75 s). Muestra pedido, área y mesa, total, salonero y pax.
3. **Un toque elige** el pedido. No se tipea nada. La app manda solo la clave `pedido:<fecha>:<n>` (`posParaServidor`,
   `club.ts` ~172).
4. **Al confirmar**, el servidor vuelve a mirar el pedido (`club_pos_ref`, 075 ~914):
   - el puente tiene que estar al día: un ciclo sin error en los últimos 5 minutos;
   - el pedido tiene que seguir abierto.

   Si pasa, guarda en el registro: el pedido, el área y la mesa **del momento del escaneo**, el total, los pax, la hora
   de apertura del pedido y **la hora del servidor al confirmar** (`hora`). Con el agente viejo, la apertura es la del
   pedido según `updated_at`; el agente ya mandaba esa hora ahí.
5. **Desde ese momento el registro queda atado a pedido + apertura.** No a la mesa y no a la factura.
6. **El flujo del dueño encaja:** primero se confirma en la app, después se carga el 856, la cortesía o la promo en el
   PoS, y se cobra cuando sea.
7. **Condición:** el pedido tiene que estar **abierto en el PoS y haber llegado al puente** antes de escanear. Si el
   cliente se escanea antes de que el salonero abra el pedido, la caja no puede registrar hasta que aparezca (~75 s
   después de abrirlo, con «Actualizar»).

## (b) Cuándo corre el cruce, si cruza con `R`, y cuándo marca «sin cruce»
**El cruce no es una tarea que corre a una hora.** Se calcula cada vez que alguien abre Excepciones o un reporte
(`club_cruce_detalle`, 075 ~2794). Nada se guarda: cuando la factura cambia, el próximo vistazo ya lo ve.

**¿Cruza con `R`? No. Solo con `C`.**
- La factura principal es la del PoS con ese `numero_pedido`, `estado = 'C'`, cobrada entre la apertura y 18 h
  después del escaneo.
- Las divididas también son solo `C`.
- La única excepción es la regla vieja de la anulada (`club_pendiente_resolver`), que mira `X` (ver (c)).

**«SIN_CRUCE»** (cupón, tarjeta o canje con pedido; `club_excepciones`, ~3097) sale cuando se cumplen **las tres**:
1. no hay ninguna factura `C` que cruce;
2. pasaron **30 min desde el escaneo** (`puente_latencia_min`, configurable por local);
3. **el pedido ya no está abierto** en el PoS, **o** pasaron 18 h.

**Una noche real con el flujo del dueño:**

| Hora | Qué pasa | Qué muestra el Club |
|---|---|---|
| 19:00 | Se escanea, se confirma y sale la cortesía. El pedido está abierto. | Nada (pedido abierto) |
| 19:45 | El cliente paga. La factura nace en **`R`** y el pedido sale de la foto de abiertos en el mismo ciclo. | — |
| 19:46 → 22:42 | La factura es `R`, el pedido no está abierto y pasaron más de 30 min desde las 19:00. | **«SIN_CRUCE» (por error)**. El manager no puede elegir la factura: `club_sin_cruce_elegir` solo acepta `C`. |
| 22:33 | Cierre de caja: la factura pasa a **`C`**. | — |
| ~22:43 | El agente la relee como `C`. | El registro **cruza solo** y «SIN_CRUCE» desaparece |

Lo mismo al mediodía, con el cierre de las 16:00.

**Visitas de socio:**
- No tienen «SIN_CRUCE».
- El reporte de visitas (`club_reporte_visitas`, ~5066) cuenta **«sin factura»** a los 30 min del escaneo, aunque la
  factura esté en `R` o el pedido siga abierto. **Por error, toda la noche.**
- Del lado de la factura, `LC_SIN_REGISTRO` («factura con el 856 sin visita») mira solo `C`, a los 30 min de la
  factura. Ese espera bien al cierre.

**El matiz de la mañana sigue:** la latencia se cuenta desde el escaneo, no desde el cobro, así que con este flujo no
protege nada.

## (c) Casos del salón

| Caso | Qué pasa hoy | ¿«Sin cruce» por error? | ¿Se pierde el beneficio? |
|---|---|---|---|
| **Cualquier mesa cobrada antes del cierre de caja** | Factura en `R` hasta el cierre (§b). | **Sí: «SIN_CRUCE» de cupón, tarjeta y canje, y «sin factura» del reporte de visitas, hasta ~10 min después del cierre.** | No: el saldo y el beneficio se dieron al confirmar. Pero el manager ve excepciones falsas toda la noche. |
| **Cambia la mesa** (traslado) | La principal cruza igual: va por pedido + apertura, no por mesa. Las divididas se buscan con la mesa **del escaneo** y en `mesa_factura`, **que con el agente viejo es null**. | Para la principal, no. Una dividida en la mesa nueva no se suma; con el agente viejo, ninguna se suma. | No |
| **Se juntan dos mesas** (el PoS pasa el pedido B al A) | Si se escaneó en B, B desaparece sin factura → «SIN_CRUCE» (correcto). Las candidatas del manager son de entrada **solo facturas sin pedido**: la de A no aparece, y **con el agente viejo no se puede buscar por los dígitos del tiquete** (no hay `consecutivo_fe`). **Visita de socio en B:** no hay forma de elegir la factura. Sale `LC_SIN_REGISTRO` (exacta) sobre A después del cierre: una alarma contra el cajero. | «SIN_CRUCE» es correcto, pero el manager no tiene cómo resolverlo. **`LC_SIN_REGISTRO` y `CORTESIA_SIN_SOCIO` sí son por error.** | **Sí: el premio por referido**, si esa era la visita que lo generaba (§4) |
| **Cuenta dividida** | Si una factura lleva el pedido, es la principal. Las sin pedido de la misma mesa se suman hasta 30 min después, **pero con el agente viejo no traen mesa: no se suman nunca.** Si ninguna lleva el pedido: «SIN_CRUCE», y el manager puede elegir **una sola** factura. | Sí, para las partes que no entran | **Sí, el premio**, si el 856 quedó en una parte que no cruza |
| **Se anula y se rehace la factura** | La anulada pasa a `X`. La nueva, en `R` hasta el cierre: hasta ahí no cruza. Después del cierre cruza sola si lleva el pedido, y si sale sin pedido queda «SIN_CRUCE». **Anfitrión nuevo con personas pendientes:** `club_pendiente_resolver` (~1226) **no deja aprobar** si hay una `X` del pedido y ninguna `C` que cruce. Durante el servicio la refactura es `R`, así que el sistema dice «La factura de esa visita está anulada (X): rechazalo». | Sí, hasta el cierre (y para siempre si la nueva no lleva pedido) | **Sí: gerencia termina rechazando personas reales** si resuelve antes del cierre |
| **El cliente paga en otra caja** del mismo local | No cambia nada: el cruce no mira la caja. Va por el pedido en el local, y espera la `C` del cierre igual que siempre. | Solo lo de la primera fila | No |

## (d) Qué ve el cajero si el puente se atrasa
- **Menos de 5 min sin ciclo:**
  - la lista anda, pero un pedido recién abierto puede no estar (se toca «Actualizar»);
  - un pedido recién cobrado puede seguir en la lista: se elige y queda bien (cruza después del cierre).
- **Más de 5 min sin ciclo, o un ciclo con error:** «**Puente sin datos.**». La pantalla pasa al plan B: «Elegí la
  factura de la lista (cerradas en las últimas 2 horas)».
  - **Con este PoS esa lista está vacía durante el servicio:** solo muestra `C`, y no hay `C` hasta el cierre. El
    cajero ve «No hay facturas cerradas en las últimas 2 horas. Cobrá la cuenta en el PoS y tocá «Actualizar»», y
    aunque cobre, la factura no aparece, porque queda en `R`.
  - **Resultado: con el puente caído, el Club no puede registrar nada hasta que el puente vuelva**, y el plan B no lo
    salva.
- **Si se cae entre la lista y «Confirmar»:** «Puente sin datos: elegí la factura».
- **Si el pedido se cobró entre la lista y «Confirmar»:** «El pedido N ya no está abierto: elegí la factura de la
  lista». Esa lista está vacía hasta el cierre, por lo mismo de arriba.

## 4. Dónde se pierde un beneficio
1. **Personas pendientes de un anfitrión nuevo** (`club_pendiente_resolver`). Con una factura anulada y rehecha, si
   gerencia resuelve **antes del cierre de caja** (refactura en `R`), el sistema obliga a rechazar. Después del cierre
   se puede aprobar, si la refactura lleva el pedido.
2. **Premio por referido** (`club_premios_generar` ~5828). Nace con la primera factura `C` del referido con el 856 que
   **cruce automáticamente** con una visita suya. Con el cierre de caja, solo **se demora** hasta el cierre. **Se
   pierde** si esa visita fue en una mesa juntada, en una cuenta dividida o en una refactura sin pedido: no cruza
   nunca, y no hay pantalla para elegir la factura de una visita de socio.

El resto son controles: no tocan el saldo. Pero con «SIN_CRUCE» falso toda la noche, el manager se acostumbra a
ignorarlo, y eso es un riesgo de control.

## 5. Propuestas (sin aplicar; cada una con su prueba)
Cada prueba va a la batería con su mutación en `mutaciones_r7.json`: tiene que **caer sin el arreglo**.

| # | Arreglo | Prueba |
|---|---|---|
| **S0** (nuevo; **el más importante**) | **«Cobrada, falta el cierre de caja»: una factura `R` del pedido cuenta como cruce PROVISIONAL.** `club_cruce_detalle` suma la principal en `R` con rol `provisional`. «SIN_CRUCE» y el «sin factura» del reporte de visitas **no salen** mientras haya una `R` del pedido. Los controles **exactos** (`CUPON_SIN_PROMO`, `REGISTRO_LC_SIN_856`, `LC_SIN_REGISTRO`, premios, `club_sin_cruce_elegir`) **siguen esperando la `C`**: antes del cierre las líneas todavía pueden anularse. Si la `R` pasa a `X` sin otra factura, «SIN_CRUCE» vuelve solo. | Registro con pedido, factura del pedido en `R`, pedido fuera de `pos_ndf_open`, escaneo de hace 40 min. **Antes:** «SIN_CRUCE». **Después:** sin «SIN_CRUCE» y con el estado «cobrada, falta el cierre de caja». La `R` pasa a `C`: cruce exacto. La `R` pasa a `X`: vuelve «SIN_CRUCE». Lo mismo en `club_reporte_visitas` (`sin_fac` 0 → 1 solo con `X`). |
| **S0b** | **Plan B con `R`:** `club_facturas_recientes` lista también las `R` de las últimas 2 h, marcadas «cobrada, sin cierre de caja», y `club_pos_ref` (modo factura) las acepta. Así, con el puente caído o el pedido recién cobrado, la caja puede registrar sobre la factura cobrada. | Factura `R` de hace 20 min: aparece en la lista y `club_cupon_usar` con `{modo:'factura'}` la acepta. Una `X` no aparece. |
| **S8** | **Pendientes con refactura:** una `X` del pedido impide aprobar **solo si** no hay una `C` **ni una `R`** del pedido, ni una factura elegida a mano. | Pendiente con pedido; su factura pasa a `X` y la refactura está en `R`. **Antes:** «rechazalo». **Después:** se aprueba. Control: `X` sin ninguna otra factura → sigue rechazando. |
| **S1** | **Visitas de socio con elección manual** (candidatas y elegir para `club_visitas_socio`; `vs`, premios y reporte de visitas usan «la elegida a mano, si hay; si no, la automática»). | Visita en B juntado con A, con el 856 en A. **Antes:** `LC_SIN_REGISTRO` sobre A y sin premio. **Después:** «SIN_CRUCE» de la visita → el manager elige A → sin `LC_SIN_REGISTRO` y con premio. |
| **S2** | `club_reporte_visitas`: «sin factura» con la regla de «SIN_CRUCE» (más S0). | Visita de hace 40 min con el pedido abierto → 0; con `R` → 0; pedido cerrado sin factura → 1. |
| **S3** | Divididas: la mesa de la factura principal (`mesa_factura`, si viene) y, si no, la del escaneo. **Con el agente viejo no alcanza:** la factura sin pedido no trae mesa. **Va con el agente nuevo.** | Escaneo en mesa 4, cobro en mesa 9: principal con `mesa_factura = 9` + sin pedido en la 9 → principal + dividida. |
| **S4** | Cuenta dividida sin principal: el manager puede elegir **varias** facturas. | Dos facturas sin pedido, 856 en la segunda → se eligen las dos → sin `CUPON_SIN_PROMO` ni `REGISTRO_LC_SIN_856`. |
| **S5** | Candidatas: de entrada, también las facturas **con** pedido cobradas después del escaneo, marcadas «con otro pedido». Y, como **con el agente viejo no hay `consecutivo_fe`**, búsqueda por **total** y **hora**. | Pedido B juntado con A: la de A aparece sin buscar. Búsqueda por total ₡X: aparece. |
| **S6** | Una factura elegida a mano no le gana a una automática que llega después, y tiene que estar `C` (si se anula, vuelve «SIN_CRUCE»). | Elegida X → llega la del pedido → vale la del pedido. X anulada → vuelve «SIN_CRUCE». |
| **S7** | Textos de la caja: pedido que todavía no está en la lista; «Puente sin datos» con qué hacer; plan B que explica `R`. La guía de caja cambia en el mismo PR. | vitest de los textos según el estado. |

**S0 y S8 están APLICADAS EN STAGING** (09-nov 14:25 CR, autorizado por el dueño; rama `claude/club-s0-s8`). Detalle y
vuelta atrás en AVANCE-LC («09-nov · tarde: S0 y S8»). El resto sigue como propuesta.

**Orden sugerido para el piloto:**
1. **S0 y S8**, antes del piloto: sin ellos, «SIN_CRUCE» sale falso todas las noches y gerencia puede rechazar
   personas reales.
2. **S0b y S2.**
3. **S1 y S6.**
4. **S4, S5 y S7.**
5. **S3** va con el agente nuevo.

Todo es de la 075 (bloque del Club) y de la app. **No toca el puente ni la 082.**

**Para confirmar en el salón** (depende del PoS, no del código):
- al trasladar una mesa, ¿el pedido conserva su número y su apertura?
- al juntar mesas, ¿qué pedido queda?
- al dividir, ¿alguna factura lleva el pedido?
- al anular y rehacer, ¿la nueva lleva el pedido?
- **¿una factura en `R` puede cambiar de líneas antes del cierre, o solo anularse?** Si solo se anula, S0 podría usar
  la `R` también para los controles exactos y adelantarlos.
