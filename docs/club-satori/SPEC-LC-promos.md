# SPEC complemento: Local Club en Wallet, promociones y reglas de combinación (07-nov-2026)

> Texto del dueño, copiado tal cual. Se lee junto con [SPEC.md](SPEC.md).

**Decisión del dueño:** el piloto oficial en prod sale con el paquete completo en Wallet (créditos de referentes + Local
Club). Antes, un piloto interno de créditos en staging, en paralelo con el sistema viejo.

## 1. Local Club

- **Beneficio inicial:** 10 % + cortesía. Todo configurable desde Promociones (§3).
- **Alta:**
  - en caja: el cajero lo anota y valida que es local; el socio queda activo;
  - autoalta por QR, para la campaña por WhatsApp a los socios actuales: formulario → pase en estado «pendiente». En su
    primera visita, la caja lo valida y pasa a activo. Mientras está pendiente, el beneficio no aplica.
  - Así un turista no se hace socio solo con el link.
- **Socio que refiere a socio:** el que refiere gana un premio configurable (por defecto, una cortesía en su próxima
  visita) cuando el referido queda activo (validado en caja). Tope de premios por mes.
- **Migración:** no hay una lista completa. Los socios actuales llegan por la campaña de WhatsApp (QR → autoalta →
  validación en caja).
- **Cuentas separadas:** cada socio separa lo suyo y paga su propia factura. El beneficio va por factura, no por mesa. El
  PoS ya marca las facturas Local Club con el artículo 856: ese es el cruce exacto entre visita y factura.

## 2. Una persona, un pase

- Un miembro puede ser referente y socio a la vez. El pase de Wallet es uno por persona y muestra lo que corresponde:
  créditos, estado de socio, cortesía disponible y promociones vigentes.
- QR público del pase (`/r/`) = cupones de turista (si es referente). Identificación del socio en caja y canje = código
  privado (R-01): el socio y el referente muestran el código del pase/portal, no el QR público.

## 3. Promociones y reglas (configuración del owner)

- **Pantalla «Promociones»:** nombre, vigencia (fechas, días de la semana, horario), para quién (socios, referentes,
  turistas con cupón, todos), beneficio (porcentaje, productos de cortesía elegidos del menú con cantidad, 2×1),
  productos o familias incluidos y excluidos (por ejemplo, sin menú de mediodía), límites (por visita, persona o mes) y
  estado (borrador, vigente, terminada).
- **Cortesías:** se eligen del catálogo de productos del PoS, con su cantidad.
- **Matriz de compatibilidad (configurable):** qué beneficios se pueden combinar en la misma factura. Regla fija desde el
  día uno: una factura pagada con créditos no lleva ningún descuento.
- El PoS sigue siendo Nube de Fuego: la app le dice al cajero qué aplicar («10 % LC + 1 postre de cortesía», o «paga con
  créditos: NO aplicar descuento») y después verifica contra la factura del puente. La app no aplica descuentos en el PoS.
- **Excepciones nuevas:**
  - `CANJE_CON_DESCUENTO`;
  - `LC_SIN_REGISTRO` (factura con el 856 y sin visita registrada);
  - `REGISTRO_LC_SIN_856`;
  - `CORTESIA_NO_CONFIGURADA` (un producto en cortesía que no corresponde);
  - `PROMO_FUERA_DE_VIGENCIA`.

## 4. Reportes

- **Socios:** activos, pendientes, nuevos por referido, visitas, gasto, frecuencia, cortesías y costo del beneficio.
- **Por promoción:** usos, costo y margen.
- Mismo estándar de reportes ([ESTANDAR-reportes.md](ESTANDAR-reportes.md)).
