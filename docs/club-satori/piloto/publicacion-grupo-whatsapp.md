# Publicación para el grupo de WhatsApp del Local Club · BORRADOR

> **Borrador (16-nov) con los textos aprobados por el dueño.** Es para el grupo de WhatsApp de unas 500 personas que **ya
> conocen** el Local Club (no hay base de datos de locales). Sin datos personales: lo que va entre `<…>` se completa al
> publicar.
>
> - `<fecha de publicación>`: el día en que se manda.
> - `<link de alta>`: el link del alta **con el origen del grupo**, por ejemplo
>   `<dominio>/alta?local=santa-teresa&origen=whatsapp`. El `&origen=whatsapp` sirve para medir cuántas altas vienen del
>   grupo. **Registrar ese origen todavía no existe:** se construye con la spec de clics (#223). Mientras tanto el link
>   funciona igual: la página de alta lee solo `local` y `ref` (`club-web/src/main.ts`, `paginaAlta`) e ignora cualquier
>   otro parámetro; se revisó que un `origen` extra no la rompe.
> - Tope: **una en el almuerzo y una en la cena** (firmado por el dueño el 16-nov, mig 181; almuerzo hasta las 15:59, cena
>   desde las 16:00). Publicar con este texto cuando la 181 esté en producción.
> - `<link del aviso>`: `<dominio>/privacidad`.
> - Cumpleaños **no** va en la publicación.

## Español

🍣 Local Club de Satori: ahora digital

Nueva promoción vigente desde el <fecha de publicación>: 10 % en su cuenta y una cortesía sorpresa en cada visita al presentar su QR de socio, para toda su mesa.

1. Toque el link o escanee el QR: <link de alta>
2. Complete su nombre y su WhatsApp.
3. En su próxima visita, muestre su QR de socio en caja y listo.

Vale en Satori Santa Teresa · Una visita con beneficio en el almuerzo y una en la cena, cada día.

Aviso de privacidad: <link del aviso>

## English (traducción fiel)

🍣 Satori's Local Club: now digital

New promotion valid from <publication date>: 10% off your bill and a surprise treat on every visit when you show your member QR, for your whole table.

1. Tap the link or scan the QR: <sign-up link>
2. Enter your name and your WhatsApp.
3. On your next visit, show your member QR at the register and you are set.

Valid at Satori Santa Teresa · One visit with the benefit at lunch and one at dinner, every day.

Privacy notice: <privacy notice link>
