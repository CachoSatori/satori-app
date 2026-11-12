# Google Wallet: activación del pase (piloto, semana del 23-nov)

> **El Issuer ID y el correo de la cuenta de servicio no se escriben en el repo** (es público; decisión del dueño, 10-nov):
> son secretos del Edge. La prueba `src/walletRepo.test.ts` falla si aparece un Issuer ID de Wallet o una cuenta de servicio
> de Google real en cualquier archivo. Las pruebas usan valores de mentira (`3388000000012345678`, `@proyecto-falso`).
> Las claves **nunca** pasan por el chat ni por la línea de comandos (quedarían en el historial de la terminal).

## 0. Decisiones del dueño (12-nov) y dónde está el código
- **Piloto sin sincronización automática.** No hay programador de `/club-pase/sync` ni migración de reintentos
  (`propuestas/club_pase_reintentos.sql`): quedan para después del piloto. Sin `CLUB_PASE_SYNC_KEY`, `/sync` responde 503
  (queda cerrado). Para que el pase no engañe:
  - el pase dice de cuándo son sus datos: «Créditos al 12-nov 13:20» (anfitrión) o «Actualizado · 12-nov 13:20» (solo socio),
    en hora de Costa Rica;
  - el portal tiene **«Actualizar mi pase»**, que vuelve a escribir el pase de esa persona con los datos de ahora;
  - sin ningún rol vigente (socio pendiente o activo, o anfitrión activo) el pase queda **vencido** (`EXPIRED`), sin QR.
- **Link de «Guardar» corto.** Al pedir el pase, el Edge crea la clase y crea (o actualiza) el objeto por la API de Wallet, y
  el JWT del link lleva solo los IDs. El JWT completo (clase y objeto adentro) pasaba los 1.800 caracteres que recomienda
  Google y ya no se usa.
- **Diseño:** sin cambios hasta ver la captura del pase real (fondo tinta `#0d0d0d`, logo y franja del daruma).
- **Código:**
  - En `main` (PR de `claude/wallet-google-main`): el pase (`src/shared/wallet/`), las rutas de club-web
    (`/api/portal/{token}/wallet` y `/api/portal/{token}/wallet/actualizar`, que también atiende el Worker
    `satori-club-api` porque usa el mismo `functions/_lib/api.js`), los botones del portal (apagados) y las imágenes
    (`club-web/public/pase/`).
  - **El Edge `supabase/functions/club-pase/` NO está en `main`** (ESTADO, regla 2: nada bajo `supabase/functions/` hasta el
    ítem 11). Vive en la rama **`claude/club-pase-edge`** (= el PR de `main` + el Edge) y se despliega **a mano** desde ahí.
    Cuando entre a `main` con el ítem 11, su `config.toml` tiene que decir `verify_jwt = false`.
  - El Edge importa los módulos de `src/shared/wallet/` (fuera de `supabase/functions/`). Con la CLI de Supabase y
    `--use-api` eso funciona: así se desplegó `ingest-ndf` v3 el 09-nov (CLI 2.122.0, importa `src/shared/ndf/`). Ojo:
    `supabase functions download` se niega a extraer esos archivos, así que la fuente de lo desplegado es **el SHA de la
    rama**, no lo que se baje del panel.

## 1. Secretos del Edge `club-pase` (staging y prod, cada uno con los suyos)

| Nombre exacto | Qué va | Notas |
|---|---|---|
| `GOOGLE_WALLET_ISSUER_ID` | El número del emisor (Pay & Wallet Console) | El mismo en staging y prod (el emisor está en modo demo) |
| `GOOGLE_WALLET_SA_KEY` | **El contenido entero** del JSON de la clave de la cuenta de servicio | Una clave para staging y **otra** para prod (si se filtra una, se borra sin tocar la otra). El Edge exige `client_email` de `….iam.gserviceaccount.com` y `private_key` |
| `CLUB_WEB_KEY` | La clave de club-web **de ese proyecto** (la de staging en staging, la de prod en prod) | Es el portón: el header `x-club-web` tiene que traer esta clave |
| `CLUB_WEB_ORIGIN` | El dominio del Club **de ese proyecto**: el resultado de `select club_url from public.club_config_global;` | Sin barra final. El QR del pase tiene que empezar con este dominio |
| `WALLET_DISENO` | `{"colorFondo":"#0d0d0d","logoUrl":"https://<dominio>/pase/logo.png","heroUrl":"https://<dominio>/pase/hero.png"}` | Opcional. Las imágenes tienen que estar publicadas (llegan con el PR de `main`). Sin él, el pase sale sin logo ni franja |
| `WALLET_ENTORNO` | **`stg`** en staging · **`prod`** en prod (en minúsculas, nada más) | **Obligatorio.** Staging y prod comparten el emisor de Google y los IDs de miembro pueden coincidir (el clon de prod a staging los copia; la carga única los trae escritos). Con `stg`, la clase es `…club-satori-stg` y los objetos `…club-stg-<miembro>`; con `prod`, sin sufijo. Falta o tiene otro valor → 503: nunca cae en prod |
| `CLUB_PASE_SYNC_KEY` | — | **No va en el piloto** |

`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` los pone Supabase solo. Los secretos de Edge son **del proyecto**: los ven
todas las Edge Functions de ese proyecto. Sin `CLUB_WEB_KEY`, `GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_SA_KEY`,
`CLUB_WEB_ORIGIN` o un `WALLET_ENTORNO` válido, todo responde 503 sin tocar la base ni Google (falla cerrada).
**La clase que ya existe en Google no se pisa:** el Edge la crea si no está (POST) y, si ya existe (409), la deja como
está. Además, antes de escribir nada comprueba que la clase y el objeto sean de su propio ambiente.

**Crear la clave de la cuenta de servicio** (el dueño, en su PC; nada pasa por el chat):
1. Google Cloud Console → el proyecto de Wallet → **IAM y administración** → **Cuentas de servicio** → la cuenta del
   emisor → pestaña **Claves** → **Agregar clave** → **Crear clave nueva** → **JSON** → **Crear**. Se descarga un `.json`.
   (Si aparece un aviso de política de la organización que bloquea crear claves, se para y se ve antes de seguir.)
2. Supabase → el proyecto (leer el ref en pantalla) → **Edge Functions** → **Secrets** → **Add new secret**: Name
   `GOOGLE_WALLET_SA_KEY`, Value: abrir el `.json` con un editor de texto, seleccionar todo, copiar y pegar. Lo mismo con
   los otros de la tabla. **Save.** El panel muestra los nombres, nunca el valor.
3. **Borrar el `.json`** de Descargas y vaciar la papelera. Si se pierde, se crea otra clave y se borra la vieja.
4. **Rotar:** crear la clave nueva, cargarla y, recién ahí, en la pestaña **Claves**, borrar la vieja.

## 2. Desplegar el Edge en STAGING y probarlo (el dueño, desde su terminal)
**Antes:** Supabase CLI 2.122.0 o más nueva (`supabase --version`) y la sesión iniciada (`supabase login`). No hace falta
Docker: se despliega con `--use-api`. Los secretos de §1 ya cargados **en staging**, con **`WALLET_ENTORNO` = `stg`**
(sin él todo da 503). Nunca durante el servicio (19–22 h).

1. Traer la rama y anotar el SHA (va a la bitácora):
   ```bash
   git fetch origin claude/club-pase-edge
   git checkout claude/club-pase-edge
   git rev-parse --short HEAD
   ```
2. Desplegar en staging:
   ```bash
   supabase functions deploy club-pase --project-ref hwiatgicyyqyezqwldia --no-verify-jwt --use-api
   ```
   Tiene que terminar en «Deployed Functions … club-pase». `--no-verify-jwt` es obligatorio: club-web llama sin JWT de
   usuario y el portón es `x-club-web`.
3. Cargar en variables de la terminal, **sin que se vean ni queden en el historial**, la anon key de staging y la
   `CLUB_WEB_KEY` de staging (`read -rs` no muestra lo que se escribe):
   ```bash
   read -rs ANON; echo
   read -rs CWK; echo
   E=https://hwiatgicyyqyezqwldia.supabase.co/functions/v1/club-pase
   ```
4. **Portón** (sin datos de nadie). Sin `x-club-web` → **401**; con la clave y un token que no existe → **404**. Si da
   **503**, falta un secreto (o `CLUB_WEB_ORIGIN` está mal formado).
   ```bash
   curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$E/google" -H "apikey: $ANON" -H 'Content-Type: application/json' -d '{"token":"x"}'
   ```
   ```bash
   curl -sS -w '\n%{http_code}\n' -X POST "$E/google" -H "apikey: $ANON" -H "x-club-web: $CWK" -H 'Content-Type: application/json' -d "{\"token\":\"$(printf 'a%.0s' {1..64})\"}"
   ```
5. **Una persona de prueba de staging** (socio y anfitrión, del equipo): en la app de staging → Club → Miembros → la
   persona → «⎘ Link del portal». El token es lo que va después de `/p/`. Cargarlo igual, sin que se vea:
   ```bash
   read -rs TOK; echo
   curl -sS -X POST "$E/google" -H "apikey: $ANON" -H "x-club-web: $CWK" -H 'Content-Type: application/json' -d "{\"token\":\"$TOK\"}" > /tmp/pase.json
   ```
   ```bash
   python3 -c "import json;u=json.load(open('/tmp/pase.json')).get('url','');print('largo del link:',len(u));print(u[:40]+'…')"
   ```
   Tiene que decir un largo **menor a 1.800**. Si `/tmp/pase.json` trae `{"error":"servicio"}`: Google rechazó la clase o
   el objeto (ver los logs del Edge en el panel: Edge Functions → `club-pase` → Logs, línea «club-pase: Google …»).
6. **En el Android de prueba** (la app Google Wallet con una **cuenta de prueba** de la consola, §3): abrir el link entero
   de `/tmp/pase.json` (mandárselo por un canal propio) → **Guardar**. Revisar: «Satori», el nombre de pila, el subtítulo,
   el fondo, «Créditos al …» con la hora de Costa Rica, el QR (escanearlo en la caja de staging: abre a esa persona),
   «Canjear créditos» (genera el código de 10 minutos) y que no haya teléfono ni correo.
7. **Actualizar:** registrar una visita o un canje de esa persona en staging y correr:
   ```bash
   curl -sS -w '\n%{http_code}\n' -X POST "$E/actualizar" -H "apikey: $ANON" -H "x-club-web: $CWK" -H 'Content-Type: application/json' -d "{\"token\":\"$TOK\"}"
   ```
   → `{"resultado":"actualizado"}` y el pase del teléfono cambia (la hora de «Créditos al …» también). Para alguien que
   nunca pidió el pase (el objeto no existe en Google), la respuesta es `{"resultado":"sin_pase"}`.
8. **Baja:** dar de baja a la persona de prueba en staging y repetir el paso 7: el pase queda vencido.
9. Borrar las variables y el archivo: `unset ANON CWK TOK; rm -f /tmp/pase.json`. Sacar las capturas para el pedido de
   publicación (§3) y anotar el resultado (SHA del paso 1, hora, qué se vio) en `AVANCE-LC.md`.

**Prod:** los mismos pasos con el ref de prod, los secretos de prod y **con la firma del dueño**. En modo demo solo las
cuentas de prueba pueden guardar el pase, así que el Edge en prod no expone nada a los clientes mientras el botón siga
apagado. **Vuelta atrás del Edge:** borrar un secreto obligatorio (todo responde 503) o `supabase functions delete
club-pase --project-ref <ref>`. El portal y la caja siguen funcionando sin el pase.

## 3. La consola de Google (el dueño)
1. Pay & Wallet Console → Google Wallet API: anotar el Issuer ID (sigue en modo demo). No se comparte.
2. **Usuarios** de la consola: la cuenta de servicio sigue como **Desarrollador** (alcanza para crear clases y objetos).
3. Google Cloud: la **Google Wallet API** sigue habilitada en el proyecto.
4. **Cuentas de prueba:** agregar la cuenta de Google del Android de prueba (el nombre exacto del menú se confirma en la consola).
5. La clase **la crea el Edge** con el primer pase: no hace falta crearla a mano. Después del paso 6 de §2 (staging),
   verificar que aparece **`…club-satori-stg`** en la consola. Esa clase alcanza para pedir la publicación (decisión del
   dueño, 12-nov). La de prod (`…club-satori`, sin sufijo) aparece recién con el primer pase pedido en prod.
6. **Pedir el acceso de publicación** con la prueba hecha: Google suele pedir capturas del pase y del flujo «Agregar a
   Google Wallet». Las imágenes del pase tienen que estar publicadas en el dominio del Club (llegan con el PR de `main`).
   Hasta la aprobación, solo las cuentas de prueba pueden guardar el pase.
7. **Con la aprobación:** Cloudflare Pages `satori-club` → Variables → `VITE_WALLET_GOOGLE` = `1` (texto, se usa en el
   build) y volver a desplegar. Recién ahí aparecen «Agregar a Google Wallet» y «Actualizar mi pase» en el portal.
   **Apagar:** `VITE_WALLET_GOOGLE` vacío y volver a desplegar.

## 4. La clase y el objeto (para el pedido de publicación)
Tipo **genérico** (`genericClass` / `genericObject`). En prod, la clase es `<issuer>.club-satori` y el objeto,
`<issuer>.club-<miembro>`; en staging, `<issuer>.club-satori-stg` y `<issuer>.club-stg-<miembro>` (`WALLET_ENTORNO`). No
cambian aunque se regenere el QR.

| Elemento | Valor | De dónde sale |
|---|---|---|
| Nombre visible (`cardTitle`) | «Satori» (ES y EN; decisión del dueño, 10-nov) | `src/shared/wallet/googlePase.ts` |
| Encabezado (`header`) | el nombre de pila de la persona | contrato del pase |
| Subtítulo (`subheader`) | «Socio del Local Club», «Anfitrión» o «Socio y anfitrión» (EN: Local Club member, Host, Member and host) | ídem |
| Logo (`logo`) | el daruma en un círculo tinta, 990×990 PNG (`club-web/public/pase/logo.png`) | `WALLET_DISENO` |
| Franja (`heroImage`) | la cara del daruma sobre tinta, 1032×336 PNG (`club-web/public/pase/hero.png`) | `WALLET_DISENO` |
| Color de fondo | `#0d0d0d` (tinta) | `WALLET_DISENO` |
| Código de barras | QR: el del socio (`/s/…`) o, si es solo anfitrión, el de cupones (`/r/…`), con el código corto debajo | contrato del pase |
| Textos | socio: «Vale en todos los Satori» (o «Valide su alta en su próxima visita…» si está pendiente) y la cortesía sorpresa si hay; anfitrión: «Créditos al 12-nov 13:20 · ₡… disponibles», personas referidas del mes y cuántas faltan para el próximo medio crédito; solo socio: «Actualizado · 12-nov 13:20» | ídem |
| Enlaces del reverso | «Canjear créditos (código de 10 minutos)» y, si corresponde, «Tus cupones para compartir» | ídem |
| Datos de contacto | **ninguno** (el Edge aborta si el objeto lleva un `@` o un `+506`) | `armarObjeto` |
| Baja o sin rol vigente | el pase pasa a `EXPIRED`, sin QR | ídem |

Maqueta: `docs/club-satori/img/pase-propuesta.png` (v4, aprobada el 08-nov).

## 5. Riesgos del piloto
- **Datos del pase:** el pase muestra datos de la última vez que se pidió o se actualizó (la línea con la fecha lo dice).
  Manda lo que diga el portal o la caja.
- **Baja:** sin sincronización, el pase de alguien dado de baja sigue «vigente» en su teléfono hasta que se actualice. La caja
  igual rechaza el QR de una persona de baja: no se pierde plata.
- **Pase compartido:** quien tenga una captura del QR de socio puede intentar usar el beneficio (igual que con el portal).
  El enlace «Canjear» del pase genera códigos de canje de ese anfitrión: si se filtra, se corta con «Regenerar» o
  «Revocar» el botón «Canjear» en la ficha del miembro.
- **Vencimiento:** el pase no tiene fecha propia; solo se vence con la baja (al actualizar).
