# Mensaje para anfitriones (hoteles y concierges) · BORRADOR

> **Borrador (08-nov) para que lo revise el dueño antes de usarlo.** Sin datos personales: lo que va entre `<…>` se
> completa al mandarlo (su nombre, su link del portal y `<valor del crédito>`, el valor vigente en colones de la
> configuración del local). Las partes **[con el pase]** van solo cuando el pase de Google Wallet esté encendido (hoy está
> apagado hasta la prueba en un teléfono).

## Español

Hola, <nombre>:

Te escribimos de **Satori Sushi Bar** con una novedad del **Club Satori**, el programa para quienes nos recomiendan.

**Qué cambia**
- Ya no hay tarjetas de papel. Tenés un **portal propio** con tu QR, tu saldo y el botón «Canjear»: <link del portal>.
  Guardalo; es solo tuyo.
- Cada persona que llega con tu cupón suma: **cada 6 personas, 1 crédito** (se suma de a medio crédito). **Cada crédito
  vale <valor del crédito>** en tu cuenta en Satori.
- Tus huéspedes reciben un **cupón del 10 %** (un solo uso) al escanear tu QR.

**Tu saldo de la tarjeta de papel pasa a tu portal.**

**Los créditos vencen a los 12 meses sin actividad: cada persona que llega con tu cupón o cada canje vuelve a contar los 12 meses.**

**[con el pase] Cómo guardás el pase**
1. Abrí tu portal y tocá «Agregar a Google Wallet».
2. Desde ahí ves tu saldo y tenés el botón «Canjear» siempre a mano.
3. Con iPhone, por ahora: abrí tu portal y agregalo a la pantalla de inicio.

**Cómo compartís tu link**
- En tu portal, tocá «Compartir» y mandalo por WhatsApp, o mostrá tu QR en recepción.
- Quien lo escanea obtiene su cupón del 10 % y lo muestra en caja al pagar.

**Cómo canjeás tus créditos**
1. En Satori, abrí tu portal (o tu pase) y tocá «Canjear».
2. Te aparece un código de 6 caracteres que **vale 10 minutos y sirve una sola vez**: mostralo en caja.
3. Elegís cuántos créditos usar (1, 1,5 o 2 por visita). Sin el código no se puede canjear.

Tus datos los cuidamos según nuestro aviso de privacidad: <link del aviso de privacidad>

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
- In your portal, tap “Share” and send it on WhatsApp, or show your QR at the front desk.
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
- El valor del crédito va como `<valor del crédito>` (el vigente al mandarlo).

## Abierto
- El texto para iPhone depende de cuándo se encienda Apple Wallet.
- El dominio sale de la configuración de club-web (`VITE_CLUB_URL`); el que se use al mandar, el de esa variable.
