# Flujo real del salón y el cruce con el PoS — explicación y propuestas

> 09-nov, pedido del dueño. **Solo explicación y propuestas: no se cambió nada.** Todo lo que sigue sale del código de
> hoy (`075_club_satori_esquema.sql` de esta rama, `src/shared/api/club.ts`, `src/modules/club/Escanear.tsx` y la 082
> v3 del puente en `5da233a`). Las líneas son aproximadas.

**El flujo del salón, según el dueño:**
1. Primero se escanea el QR y se confirma en la app.
2. Recién después se aplica en el PoS (el 856, la cortesía o la promo).
3. La cortesía puede salir al inicio, y el cliente paga 40 minutos o más después.

## Resumen en una línea
El flujo del dueño funciona: la app se ata al **pedido abierto**, no a la factura, y el cruce espera mientras el pedido
siga abierto. Los problemas aparecen cuando el pedido **no termina en una factura con su número**:
- mesas juntadas;
- cuenta dividida sin factura «principal»;
- factura anulada y rehecha sin el pedido.

En dos de esos casos **sí se puede perder un beneficio** (el premio por referido y las personas pendientes de un
anfitrión nuevo). Ver §5.

## (a) Cuándo y con qué dato se elige la mesa/pedido
1. La caja escanea el QR. Para un cupón, una tarjeta, un canje o una visita de socio, la pantalla pide el **pedido**.
   Lo hace `SelectorPedido` en `Escanear.tsx` (~283).
2. La lista sale de `club_pedidos_abiertos` (075 ~2456), que lee `pos_ndf_open`: la foto de pedidos abiertos que manda
   el puente en cada ciclo (~75 s). Cada fila muestra pedido, área y mesa, total, salonero y pax.
3. **Un toque elige el pedido.** No se tipea nada. La app manda **solo la clave**: `posParaServidor` en `club.ts` ~172
   manda `{modo:'pedido', pedido, clave}`, y la clave es `pedido:<fecha>:<n>`, porque el número del pedido se reinicia
   cada día.
4. **Al confirmar, el servidor vuelve a mirar el pedido** en `club_pos_ref` (075 ~849):
   - El puente tiene que estar al día (`club_puente_fresco`: un ciclo sin error en los últimos 5 minutos).
   - El pedido tiene que seguir en `pos_ndf_open`.
   - Si pasa, **guarda en el registro** (`pos_ref`): pedido, área, mesa, total, pax, `abierto_en` (la hora de apertura
     del pedido en el PoS, `FAC_Pedidos.FechaRegistra`) y **`hora` = la hora del servidor al confirmar**.
5. Desde ese momento el registro queda atado a **pedido + hora de apertura**. Ese par no cambia aunque cambie la mesa.
6. **Plan B** (botón «El pedido no está», o el puente sin datos): la lista de **facturas ya cobradas** de las últimas
   2 h (`club_facturas_recientes` ~2485). Sirve solo **después** de cobrar.

**Lo que esto implica para el flujo del dueño:** el pedido tiene que estar **abierto en el PoS y haber llegado al
puente** antes de escanear. Si el cliente llega y se escanea antes de que el salonero abra el pedido:
- la lista no lo muestra;
- el plan B no tiene ninguna factura que ofrecer;
- la caja no puede registrar hasta que el pedido aparezca. Tarda hasta un ciclo, ~75 s, después de abrirlo; se toca
  «Actualizar».

No se pierde nada, pero la pantalla no explica qué hacer (ver S7).

## (b) Cuándo corre el cruce y cuánto espera antes de «sin cruce»
- **El cruce no es una tarea que corre a una hora.** Se calcula cada vez que alguien abre Excepciones o un reporte
  (`club_cruce_facturas` / `club_cruce_detalle`, 075 ~2733). Nada se guarda. Si la factura llega tarde, el próximo
  vistazo ya la cruza.
- **La factura del registro** (la «principal») es la del PoS con `numero_pedido` = el pedido elegido, **y**:
  - con la misma hora de apertura (±2 s), si la factura la trae (mig 081);
  - si no la trae, la primera con ese número cerrada desde la apertura y **hasta 18 h después del escaneo**.

  Además se suman las **facturas sin pedido de la misma mesa** cobradas entre la apertura y 30 min después de la
  principal (cuenta dividida).
- **«SIN_CRUCE» para cupón, tarjeta y canje** (`club_excepciones` ~3097) sale solo si se cumplen **las tres** cosas:
  1. el registro es con pedido y no encontró ninguna factura;
  2. pasó la **latencia del puente** desde el escaneo: `club_config.puente_latencia_min`, **30 min** por defecto,
     configurable por local de 1 a 1.440;
  3. **el pedido ya no está abierto** en el PoS, **o** pasaron 18 h desde el escaneo.

  Con el flujo del dueño (pagan 40 min o más después): mientras el pedido siga abierto, **no se marca nada**, por más
  que pasen horas. Al cobrar, el puente manda en el **mismo ciclo y en la misma transacción** la factura y la foto nueva
  de pedidos abiertos (082 v3, pasos 1 y 3). En el caso normal, la factura ya está cuando el pedido desaparece.
- **Matiz:** la latencia se cuenta **desde el escaneo**, no desde el cobro. Con 40 min de mesa ya está vencida al
  cobrar, así que no protege nada. Si el agente lee las facturas antes que la foto y el cobro cae entre las dos
  lecturas, el registro puede salir «sin cruce» **durante un ciclo (~75 s)** y desaparecer solo. **No lo verifiqué en el
  agente.** El riesgo real es que en esos segundos un manager elija una factura a mano: hoy la elegida a mano **le gana**
  al cruce automático para siempre (`mv` ~2995). Ver S6.
- **Visitas de socio:** no tienen «SIN_CRUCE». Lo que hay:
  - `club_reporte_visitas` (~5045) cuenta «sin factura» a los **30 min del escaneo, aunque el pedido siga abierto**.
    Con el flujo del dueño, durante el servicio ese número sube de más (ver S2).
  - Del lado de la factura: `LC_SIN_REGISTRO` («factura con el 856 sin visita que la cruce», **exacta**) a los 30 min
    del **cobro**.

## (c) Casos del salón

| Caso | Qué pasa hoy | ¿«Sin cruce» por error? | ¿Se pierde el beneficio? |
|---|---|---|---|
| **Cambia la mesa** (el pedido se traslada) | La principal cruza igual: se busca por pedido + apertura, no por mesa. Las divididas se buscan con la mesa **del escaneo** (`v_mesa` ~2766), no con la de la factura. | No para la principal. **Sí para las divididas**: una parte cobrada sin pedido en la mesa nueva no se suma. Eso puede disparar `CUPON_SIN_PROMO` o `REGISTRO_LC_SIN_856` si la promo o el 856 quedaron en esa parte. | No |
| **Se juntan dos mesas** (el PoS pasa el pedido B al A) | Si se escaneó en B, B desaparece sin factura → «SIN_CRUCE» (cupón, tarjeta, canje). Las candidatas que ve el manager (`club_sin_cruce_candidatas` ~3560) son, de entrada, **solo facturas sin pedido**: la de A (con pedido) aparece solo si busca por los dígitos del tiquete. **Visita de socio en B:** no hay «SIN_CRUCE» ni forma de elegir la factura (`club_sin_cruce_elegir` solo acepta `club_movimientos`). La factura de A, con el 856, sale como `LC_SIN_REGISTRO` (exacta), una alarma contra el cajero que no se corrige eligiendo. | «SIN_CRUCE» es correcto (no hay cruce automático), pero el manager no encuentra la factura fácil. **`LC_SIN_REGISTRO` y `CORTESIA_SIN_SOCIO` sí son por error.** | **Sí, el premio por referido** (ver §5) |
| **Cuenta dividida** | Si una de las facturas lleva el pedido: esa es la principal, y las sin pedido de la misma mesa hasta 30 min después se suman. Si **ninguna** lleva el pedido: no hay principal ni ventana → «SIN_CRUCE». El manager puede elegir **una sola** factura (`club_cruces_manuales` tiene clave `movimiento_id`). Una parte pagada más de 30 min después de la principal tampoco se suma. | Sí, para las partes que no entran | **Sí, el premio**, si el 856 quedó en una parte que no cruza |
| **Se anula y se rehace la factura** | La anulada pasa a `X` (el agente relee las `X` de la ventana de 36 h) y el cruce solo mira `C`. Si la nueva **lleva el mismo pedido y la misma apertura**, cruza sola. Si sale **sin pedido**, no hay principal → «SIN_CRUCE» (cupón, tarjeta, canje) o nada (visita de socio, igual que mesas juntadas). Además, una factura elegida a mano que después se anula sigue contando (el `join` de `mv` ~3005 no mira el estado). | Sí, si la nueva sale sin pedido | **Sí: personas pendientes de un anfitrión nuevo.** `club_pendiente_resolver` (~1226) **rechaza aprobar** si hay una `X` del pedido y ninguna `C` cruza: «La factura de esa visita está anulada (X): rechazalo». Una refactura sin pedido hace que gerencia **tenga que rechazar** personas reales. |
| **El cliente paga en otra caja** | Del mismo local: no cambia nada. El cruce no mira la caja; busca la factura del pedido en el local. De **otro** local: ese pedido no existe allá. No pasa en el salón. | No | No |
| **El puente se atrasa** | Ver (d) | No: mientras el puente no actualiza, el pedido sigue «abierto» y no se marca nada | No |

## (d) Qué ve el cajero si el puente se atrasa
- **Hasta 5 minutos sin ciclo:**
  - la lista anda, pero puede estar hasta 5 minutos vieja: un pedido recién abierto no aparece todavía (se toca
    «Actualizar»);
  - un pedido recién cobrado puede aparecer y se puede elegir. Cruza cuando llegue la factura.
- **Más de 5 minutos sin ciclo, o el último ciclo con error** (`club_puente_fresco` en falso):
  - la lista de pedidos **no carga** y la pantalla dice **«Puente sin datos.»**, y pasa sola al plan B: «Elegí la
    factura de la lista (cerradas en las últimas 2 horas)».
  - Como el plan B también sale del puente, con el puente caído esa lista está vieja o vacía: «No hay facturas cerradas
    en las últimas 2 horas. Cobrá la cuenta en el PoS y tocá «Actualizar»».
- **Si el puente se cae entre la lista y el «Confirmar»:** el servidor rechaza con «Puente sin datos: elegí la
  factura».
- **Si el pedido se cobró entre la lista y el «Confirmar»:** «El pedido N ya no está abierto: elegí la factura de la
  lista».
- **En resumen:** con el puente caído **no se puede registrar nada** del Club hasta que vuelva. Con el flujo del dueño,
  la cortesía del inicio no se puede confirmar en la app primero. **No hay modo sin puente**: es a propósito
  (CLUB-AUD-27, la lista no es confiable). Lo que falta es decirle al cajero qué hacer mientras tanto (S7).

## 5. Dónde se puede perder un beneficio (lo importante)
1. **Premio por referido** (`club_premios_generar` ~5799). Nace **solo** con la primera factura `C` del referido que
   tenga el 856 **y cruce automáticamente** con una visita suya. Usa `club_cruce_facturas` sin la elección manual.
   Si la única visita del referido fue en una mesa juntada, una cuenta dividida sin principal o una refactura sin
   pedido, **el referente no recibe el premio**, y no hay pantalla para corregirlo.
2. **Personas pendientes del anfitrión nuevo** (`club_pendiente_resolver` ~1226). Con la factura anulada y rehecha sin
   pedido, gerencia no puede aprobar: el sistema obliga a rechazar.

El resto **no toca saldos**: «SIN_CRUCE», `LC_SIN_REGISTRO`, `CUPON_SIN_PROMO` y el reporte de visitas son controles.
El cupón suma personas, y la visita de socio da su beneficio, al confirmar en la app, sin esperar al cruce
(`club_cupon_usar`, `club_socio_visita`). «SIN_CRUCE» no toca el libro (`club_sin_cruce_elegir`: «No toca el libro ni
el saldo»).

## 6. Propuestas (sin aplicar; cada una con su prueba)
Cada prueba va a la batería (`075_pruebas_staging.sql`) con su mutación en `mutaciones_r7.json`. Así se demuestra que
**cae sin el arreglo**, como en IDS-AUDITOR.md.

| # | Arreglo | Prueba |
|---|---|---|
| **S1** | **Visitas de socio con elección manual.** `club_sin_cruce_candidatas` / `club_sin_cruce_elegir` aceptan también una visita de socio (`club_visitas_socio`), en una tabla de cruces manuales de visitas o con una columna `visita_id`. «SIN_CRUCE» lista también las visitas, con la misma regla de (b). `vs` (~3012), `club_premios_generar` y `club_reporte_visitas` usan «la elegida a mano, si hay; si no, la automática». | Visita de socio en el pedido B; el PoS lo junta con A y la factura de A tiene el 856. **Antes:** `LC_SIN_REGISTRO` sobre A, ninguna excepción que resolver y sin premio para el referente. **Después:** «SIN_CRUCE» de la visita → el manager elige A → `LC_SIN_REGISTRO` desaparece y `club_premios_generar` crea el premio. |
| **S2** | **`club_reporte_visitas`:** «sin factura» con la misma regla que «SIN_CRUCE»: pasada la latencia **y** el pedido ya no está abierto (o 18 h). | Visita escaneada hace 40 min con el pedido todavía en `pos_ndf_open` → `sin_fac = 0`. Se borra el pedido de `pos_ndf_open` sin factura → `sin_fac = 1`. |
| **S3** | **Cambio de mesa:** las divididas se buscan con la mesa **de la factura principal** (`mesa_factura`/`area_factura`, donde se cobró), y la del escaneo solo si la factura no la trae. | Pedido escaneado en la mesa 4 y cobrado en la 9: principal con `mesa_factura = 9` más una factura sin pedido en la mesa 9, 10 min después. **Antes:** solo la principal. **Después:** principal + dividida. Control: una factura sin pedido en la mesa 4 **no** se suma. |
| **S4** | **Cuenta dividida sin principal:** el manager puede elegir **varias** facturas para un registro (`club_cruces_manuales` con clave `(movimiento_id, numero_factura)`; la historia ya es de solo inserción). | Registro con pedido y dos facturas sin pedido de la mesa, con el 856 en la segunda. Elegir las dos → ni `CUPON_SIN_PROMO` ni `REGISTRO_LC_SIN_856`, y `ticket_ids` tiene 2. |
| **S5** | **Candidatas:** de entrada, también las facturas **con** pedido cobradas después del escaneo, el mismo día (para las mesas juntadas). Primero la misma mesa, después las sin pedido, después el resto. Marcadas «con otro pedido». | Pedido B juntado con A: la factura de A aparece en la lista sin buscar por dígitos, marcada «con otro pedido». |
| **S6** | **Una factura elegida a mano no le gana a una automática que llega después.** En `mv`: si `auto_ids` no está vacío, vale el automático, y la elección manual queda en la historia como «reemplazada por el cruce automático». Además, la elegida a mano tiene que estar `C` (si se anula, vuelve a «SIN_CRUCE»). | Registro sin factura → el manager elige X → llega la factura del pedido → `ticket_ids` = la del pedido. Y: el manager elige X → X pasa a anulada → el registro vuelve a «SIN_CRUCE». |
| **S7** | **Textos de la caja** (`Escanear.tsx`): con la lista sin el pedido, «Si el pedido todavía no está abierto en el PoS, abrilo y tocá «Actualizar» (tarda hasta 2 minutos)». Con «Puente sin datos», «No se puede registrar hasta que vuelva el puente: atendé la mesa normal, guardá el QR en pantalla y registrá cuando la lista cargue; si se cobra antes, elegí la factura». La guía de caja (`docs/sop-app/`) cambia en el mismo PR. | vitest del texto según el estado (lista vacía, puente sin datos, plan B sin facturas). |
| **S8** | **Pendientes con refactura:** en `club_pendiente_resolver`, una `X` del pedido impide aprobar **solo si** no hay una `C` cruzada **ni elegida a mano** (S1/S4). Así gerencia elige la refactura y aprueba. | Pendiente con pedido; su factura pasa a `X` y se rehace sin pedido. **Antes:** «rechazalo». **Después:** el manager elige la refactura → aprobar anda. Control: `X` sin ninguna `C` → sigue rechazando. |

**Orden sugerido:**
1. S8, S1 y S2: tocan beneficios o señalan al cajero sin motivo.
2. S6 y S3.
3. S4, S5 y S7: comodidad del manager y de la caja.

Todo es de la 075 (bloque del Club) y de la app. **No toca el puente ni la 082.**

**Para confirmar en el salón antes de implementar** (no está en el código, depende del PoS):
- al trasladar una mesa, ¿el pedido conserva su número y su hora de apertura?
- al juntar mesas, ¿qué pedido queda?
- al dividir, ¿alguna factura lleva el pedido?
- al anular y rehacer, ¿la nueva lleva el pedido?

Con una prueba de cada una en el PoS de staging (o mirando `pos_ndf_tickets` de un día real) se confirma cuáles de
S3–S5 hacen falta.
