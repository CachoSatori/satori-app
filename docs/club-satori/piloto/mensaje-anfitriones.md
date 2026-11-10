# Mensaje para anfitriones (hoteles y concierges) · BORRADOR

> **Borrador (08-nov; 10-nov: «usted» y el cartel) para que lo revise el dueño antes de usarlo.** Sin datos personales: lo que va entre `<…>` se
> completa al mandarlo (su nombre, su link del portal y `<valor del crédito>`, el valor vigente en colones de la
> configuración del local). Las partes **[con el pase]** van solo cuando el pase de Google Wallet esté encendido (hoy está
> apagado hasta la prueba en un teléfono).

## Español

Hola, <nombre>:

Le escribimos de **Satori Sushi Bar** con una novedad del **Club Satori**, el programa para quienes nos recomiendan.

**Qué cambia**
- Ya no hay tarjetas de papel. Usted tiene un **portal propio** con su QR, su saldo y el botón «Canjear»: <link del portal>.
  Guárdelo; es solo suyo.
- Cada persona que llega con su cupón suma: **cada 6 personas, 1 crédito** (se suma de a medio crédito). **Cada crédito
  vale <valor del crédito>** en su cuenta en Satori.
- Sus huéspedes reciben un **cupón del 10 %** (un solo uso) al escanear su QR.

**El saldo de su tarjeta de papel pasa a su portal.**

**Los créditos vencen a los 12 meses sin actividad: cada persona que llega con su cupón o cada canje vuelve a contar los 12 meses.**

**[con el pase] Cómo guarda el pase**
1. Abra su portal y toque «Agregar a Google Wallet».
2. Desde ahí ve su saldo y tiene el botón «Canjear» siempre a mano.
3. Con iPhone, por ahora: abra su portal y agréguelo a la pantalla de inicio.

**Cómo comparte su link**
- En su portal, toque «Compartir» y mándelo por WhatsApp, o muestre su QR en recepción. También le podemos dar un
  **cartel para la recepción** con su QR.
- Quien lo escanea obtiene su cupón del 10 % y lo muestra en caja al pagar.

**Cómo canjea sus créditos**
1. En Satori, abra su portal (o su pase) y toque «Canjear».
2. Le aparece un código de 6 caracteres que **vale 10 minutos y sirve una sola vez**: muéstrelo en caja.
3. Elige cuántos créditos usar (1, 1,5 o 2 por visita). Sin el código no se puede canjear.

Cuidamos sus datos según nuestro aviso de privacidad: <link del aviso de privacidad>

¡Gracias por recomendarnos!
Satori Sushi Bar

## English

Hi <name>,

This is **Satori Sushi Bar** with news about **Club Satori**, our program for the people who recommend us.

**What changes**
- No more paper cards. You have your **own portal** with your QR, your balance and the “Redeem” button: <portal link>.
  Keep it; it is just for you.
- Every guest who comes with your coupon counts: **every 6 guests, 1 credit** (you earn half a credit at a time). **Each
  credit is worth <credit value>** on your bill at Satori.
- Your guests get a **10% coupon** (one use) when they scan your QR.

**Your paper card balance moves to your portal.**

**Credits expire after 12 months without activity: every guest who comes with your coupon or every redemption restarts the 12 months.**

**[with the pass] How to save your pass**
1. Open your portal and tap “Add to Google Wallet”.
2. From there you see your balance and always have the “Redeem” button at hand.
3. On iPhone, for now: open your portal and add it to your home screen.

**How to share your link**
- In your portal, tap “Share” and send it on WhatsApp, or show your QR at the front desk. We can also give you a
  **front-desk poster** with your QR.
- Whoever scans it gets a 10% coupon and shows it at the register when paying.

**How to redeem your credits**
1. At Satori, open your portal (or your pass) and tap “Redeem”.
2. You get a 6-character code that is **valid for 10 minutes and works once**: show it at the register.
3. You choose how many credits to use (1, 1.5 or 2 per visit). Without the code, credits cannot be redeemed.

We take care of your data under our privacy notice: <link del aviso de privacidad>

Thank you for recommending us!
Satori Sushi Bar

## Decidido (el dueño, 08-nov noche)
- El saldo de la tarjeta de papel pasa al portal (carga masiva: `docs/club-satori/piloto/saldos-papel.md`).
- Los créditos vencen a los 12 meses **sin actividad**. Verificado: el SPEC (§5.1) y `club_vencer` cuentan desde la última
  actividad, no desde que se gana cada crédito; el mismo texto va en el portal, el aviso del canje por WhatsApp y las guías.
- El valor del crédito va como `<valor del crédito>` (el vigente al mandarlo, de la configuración del local).
- **(10-nov) Valor confirmado por el dueño: ₡18.000 por crédito, cada 6 personas** (el de la configuración; el texto lo
  sigue tomando de ahí). El español va con **usted**; el inglés queda igual.

## Abierto
- El texto para iPhone depende de cuándo se encienda Apple Wallet.
- El dominio sale de la configuración de club-web (`VITE_CLUB_URL`); el que se use al mandar, el de esa variable.
