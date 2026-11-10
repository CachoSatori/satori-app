# Google Wallet: activación del pase (semana del 23-nov)

> Prioridad baja: va **después** del pase del Club en prod (jue 12-nov) y de la apertura a clientes.
> **El Issuer ID y el correo de la cuenta de servicio no se escriben en el repo** (es público; decisión del dueño, 10-nov):
> son secretos del Edge. La prueba `src/walletRepo.test.ts` falla si aparece un Issuer ID de Wallet o una cuenta de servicio
> de Google real en cualquier archivo. Las pruebas usan valores de mentira (`3388000000012345678`, `@proyecto-falso`).
> Las claves **nunca** pasan por el chat.

## Estado (10-nov, lo preparó el dueño)
- Cuenta de emisor en la Google Pay & Wallet Console: perfil aprobado, **en modo demo**.
- Proyecto de Google Cloud con la Google Wallet API habilitada.
- Cuenta de servicio invitada en la consola de Wallet como **Desarrollador**. **Sin clave JSON**: se crea el día que se
  carga (§1).
- Código: Edge `supabase/functions/club-pase` (B1–B3) y club-web (B2, el botón «Agregar a Google Wallet», apagado por
  `VITE_WALLET_GOOGLE`), en la rama `claude/club-wallet`. **No está desplegado.**

## 1. Secretos del Edge `club-pase` (prod) y cómo se cargan

| Nombre exacto | Qué va | Tipo | Notas |
|---|---|---|---|
| `GOOGLE_WALLET_ISSUER_ID` | El Issuer ID (el número de la Pay & Wallet Console) | secreto | No es una clave, pero va como secreto para que no esté en el repo |
| `GOOGLE_WALLET_SA_KEY` | **El contenido entero** del archivo JSON de la clave de la cuenta de servicio | secreto | El Edge exige `client_email` de `….iam.gserviceaccount.com` y `private_key` |
| `CLUB_WEB_KEY` | La misma clave de club-web de prod (§6.3 del PASE-150-151) | secreto | El portón: sin ella, 503 |
| `CLUB_WEB_ORIGIN` | El dominio del Club (`https://…`, igual a `club_config_global.club_url`) | secreto | Obligatorio: sin él, 503 |
| `CLUB_PASE_SYNC_KEY` | Una clave nueva al azar, de 32 caracteres o más, **distinta** de `CLUB_WEB_KEY` | secreto | La usa el programador de la sincronización (B3) |
| `WALLET_DISENO` | `{"colorFondo":"#0d0d0d","logoUrl":"https://<dominio>/pase/logo.png","heroUrl":"https://<dominio>/pase/hero.png"}` | secreto | El diseño de §2. Sin él, el pase sale sin logo ni franja |

`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` los pone Supabase solo en cada Edge. En Supabase los secretos son **del
proyecto**: los ven todas las Edge Functions de prod.

**Crear la clave y cargarla (el dueño, en su PC; nada pasa por el chat):**
1. Google Cloud Console → el proyecto de Wallet → **IAM y administración** → **Cuentas de servicio** → la cuenta del
   emisor → pestaña **Claves** → **Agregar clave** → **Crear clave nueva** → **JSON** → **Crear**. Se descarga un `.json`.
   (Si la organización de Google Cloud bloquea la creación de claves, aparece un aviso de política: se ve con Claude
   antes de seguir.)
2. Supabase → proyecto de **PROD** (leer el ref en pantalla) → **Edge Functions** → **Secrets** (o Project Settings →
   Edge Functions → Secrets) → **Add new secret**:
   - Name `GOOGLE_WALLET_SA_KEY`, Value: abrir el `.json` con un editor de texto, **seleccionar todo**, copiar y pegar.
   - Name `GOOGLE_WALLET_ISSUER_ID`, Value: el número que muestra la Pay & Wallet Console.
   - Los otros cuatro de la tabla, igual.
   - **Save.** El panel muestra los nombres y una huella, nunca el valor.
3. **Borrar el `.json`** de Descargas y vaciar la papelera. No se guarda en ningún lado: si se pierde, se crea otra clave
   (paso 1) y se borra la vieja.
4. **Rotar:** crear la clave nueva, cargarla (paso 2) y, recién ahí, en la pestaña **Claves**, borrar la vieja.

**Desplegar el Edge** (el dueño, o Claude con su firma; nunca entre las 17:00 y las 23:00):
`supabase functions deploy club-pase --no-verify-jwt --project-ref <ref de prod>`. Sin el header `x-club-web` responde
401, y con un token que no existe, `404 portal_invalido`: los dos dicen que los secretos están cargados (si falta uno,
todo da 503). Que el JSON de la clave sea válido se ve recién en la prueba de §3, con un portal real.

**Club-web:** Cloudflare Pages `satori-club` → Variables → `VITE_WALLET_GOOGLE` = `1` (texto, se usa en el build) y volver
a desplegar. Hasta entonces el botón «Agregar a Google Wallet» no aparece.

## 2. La clase del pase (para pedir el acceso de publicación)
Tipo **genérico** (`genericClass` / `genericObject`): un pase por persona, socio y/o anfitrión. La clase es
`<issuer>.club-satori` y el objeto, `<issuer>.club-<miembro>`: no cambian aunque se regenere el QR.

| Elemento | Valor | De dónde sale |
|---|---|---|
| Nombre visible (`cardTitle`) | **«Satori»** (ES y EN; decisión del dueño, 10-nov) | `src/shared/wallet/googlePase.ts` |
| Encabezado (`header`) | el nombre de pila de la persona | contrato del pase |
| Subtítulo (`subheader`) | «Socio del Local Club», «Anfitrión» o «Socio y anfitrión» (EN: Local Club member, Host, Member and host) | ídem |
| Logo (`logo`) | el daruma en un círculo tinta, 990×990 PNG (`club-web/public/pase/logo.png`) | Google lo recorta en círculo |
| Franja (`heroImage`) | la cara del daruma sobre tinta, 1032×336 PNG (`club-web/public/pase/hero.png`) | — |
| Color de fondo (`hexBackgroundColor`) | **`#0d0d0d`** (tinta) | `WALLET_DISENO` |
| Código de barras | QR: el del socio (`/s/…`) o, si es solo anfitrión, el de cupones (`/r/…`), con el código corto debajo | contrato del pase |
| Textos | socio: «Vale en todos los Satori»; cortesía sorpresa si hay; anfitrión: «₡… disponibles», personas referidas del mes y cuántas faltan para el próximo medio crédito | ídem |
| Enlaces del reverso | «Canjear créditos (código de 10 minutos)» y, si corresponde, «Tus cupones para compartir» | ídem |
| Datos de contacto | **ninguno** (el Edge aborta si el objeto lleva un `@` o un `+506`) | `armarObjeto` |
| Baja | el pase pasa a `EXPIRED` | ídem |

Maqueta: `docs/club-satori/img/pase-propuesta.png` (v4, aprobada el 08-nov). Las imágenes tienen que estar **publicadas**
en el dominio del Club antes de pedir la publicación: Google las baja de esas URL.

**Pedir el acceso de publicación** (Pay & Wallet Console → Google Wallet API): con la prueba de §3 hecha y el pase
guardado en un teléfono. Google suele pedir capturas del pase y del flujo «Agregar a Google Wallet»: sacarlas en la
prueba de §3. Hasta que lo aprueben, solo las cuentas de prueba pueden guardar el pase.

## 3. Prueba en un Android, en modo demo
En modo demo **solo las cuentas de prueba** guardan el pase, y el pase muestra una marca de prueba. Así, aunque el
Edge esté en prod, ningún cliente puede guardarlo.
1. **Cuentas de prueba:** Pay & Wallet Console → Google Wallet API → la sección de usuarios o cuentas de prueba →
   agregar la cuenta de Google del teléfono de prueba (alguien del equipo). El nombre exacto del menú se confirma en la
   consola.
2. **El teléfono:** un Android con la app Google Wallet, con la sesión iniciada con esa cuenta.
3. **Una persona de prueba del Club** en prod (alguien del equipo, socio y anfitrión), con su enlace del portal.
4. Desde el teléfono: abrir el portal → **Agregar a Google Wallet** → se abre la página de Google → **Guardar**.
5. Revisar en el pase:
   - el nombre «Satori», el logo, la franja y el fondo tinta;
   - el nombre de pila y el subtítulo correctos;
   - el QR: escanearlo en la caja (Escanear) y que abra a esa persona;
   - los créditos y las personas referidas, iguales al portal;
   - «Canjear créditos»: genera el código de 10 minutos;
   - sin teléfono ni correo en ningún lado.
6. **Sincronización (B3):** registrar una visita o un canje de esa persona y ver que el pase se actualice. Hoy solo
   existe la ruta `actualizar` del Edge: el botón «Actualizar mi pase» del portal y el programador todavía no están (§4).
7. **Baja:** dar de baja a la persona de prueba y ver el pase vencido.
8. Sacar las capturas para el pedido de publicación (§2) y anotar el resultado en `AVANCE-LC.md`.

**Si algo falla:** se apaga el botón (`VITE_WALLET_GOOGLE` vacío y volver a desplegar club-web). El portal y la caja siguen
funcionando sin el pase.

## 4. Pendiente antes del 23-nov (en la rama `claude/club-wallet`)
- Llevar la rama al día con el #59 (después del pase del Club) y revisar la sincronización con la 150 y la 151.
- El programador de la sincronización (B3) sigue **apagado**, y falta el botón «Actualizar mi pase» en el portal de
  club-web: decidir con el dueño si van en la primera semana.
- Apple Wallet: sigue apagado hasta el D-U-N-S.
