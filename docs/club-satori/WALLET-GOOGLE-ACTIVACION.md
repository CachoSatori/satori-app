# Google Wallet: activación del pase (piloto, semana del 23-nov)

> **El Issuer ID y el correo de la cuenta de servicio no se escriben en el repo** (es público; decisión del dueño, 10-nov):
> son secretos del Edge. La prueba `src/walletRepo.test.ts` falla si aparece un Issuer ID de Wallet o una cuenta de servicio
> de Google real en cualquier archivo. Las pruebas usan valores de mentira (`3388000000012345678`, `@proyecto-falso`).
> Las claves **nunca** pasan por el chat ni por la línea de comandos (quedarían en el historial de la terminal).

## 0. Decisiones del dueño (12-nov) y dónde está el código
- **Piloto sin sincronización automática de saldos.** No hay programador de `/club-pase/sync` (la completa) ni migración
  de reintentos (`propuestas/club_pase_reintentos.sql`): quedan para después del piloto. **(12-nov, opción c del dueño)
  La única pasada automática es `/club-pase/vencer`:** cada 10 minutos, el cron del Worker `satori-club-api` le pide al
  Edge que venza en Google los pases de las personas dadas de baja (o sin ningún rol vigente), por cualquier camino: la
  app, el portal o la purga de autoaltas. Lee los eventos de `club_pase_eventos` que la base ya deja; **no toca el
  esquema**. Los demás cambios no tocan Google. Para que el pase no engañe:
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
| `WALLET_DISENO` | **El mismo valor en staging y en prod** (son URLs públicas, no un secreto): `{"colorFondo":"#0d0d0d","logoUrl":"https://club.satoricostarica.com/pase/logo.png","heroUrl":"https://club.satoricostarica.com/pase/hero.png"}` | Opcional. Las imágenes son `club-web/public/pase/logo.png` (990×990) y `hero.png` (1032×336): Vite las copia a `dist/` y quedan en el dominio del Club **con el deploy de Pages del merge** del PR de `main`. Antes de eso esas URLs dan 404: hasta entonces, sin `WALLET_DISENO` (el pase sale sin logo ni franja). Staging usa las mismas imágenes del dominio de prod: no hay club-web de staging publicado. Lo cuida `club-web/src/paseImagenes.test.ts` |
| `WALLET_ENTORNO` | **`stg`** en staging · **`prod`** en prod (en minúsculas, nada más) | **Obligatorio.** Staging y prod comparten el emisor de Google y los IDs de miembro pueden coincidir (el clon de prod a staging los copia; la carga única los trae escritos). Con `stg`, la clase es `…club-satori-stg` y los objetos `…club-stg-<miembro>`; con `prod`, sin sufijo. Falta o tiene otro valor → 503: nunca cae en prod |
| `CLUB_PASE_SYNC_KEY` | Una clave nueva al azar, de 32 caracteres o más, **distinta** de `CLUB_WEB_KEY` | **(12-nov) Va en el piloto, para la opción c:** el portón de `/club-pase/vencer` (y de `/sync`, que sigue sin programador). La misma clave va como **Secret** `CLUB_PASE_SYNC_KEY` en el **Worker** `satori-club-api` (solo prod: staging no tiene Worker). Sin ella en el Worker, el cron no hace nada |

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
8. **Baja (opción c, 12-nov).** `/actualizar` no sirve para esto: después de la baja responde `404 portal_invalido`
   (`club_pase_por_token` solo encuentra miembros activos con un rol vigente). El que vence el pase es **`/vencer`**. En
   staging no hay Worker ni cron: se llama a mano, con la `CLUB_PASE_SYNC_KEY` de staging cargada sin que se vea.
   Dar de baja a la persona de prueba (app de staging → Club → Miembros → estado «baja») y correr:
   ```bash
   read -rs SYNC; echo
   curl -sS -w '\n%{http_code}\n' -X POST "$E/vencer" -H "apikey: $ANON" -H "x-club-pase-sync: $SYNC"
   ```
   → `200` con un resumen (`"vencidos": 1`) y el pase del teléfono queda **vencido y SIN QR** (13-nov: `/vencer` lee el
   objeto con GET y lo reemplaza con PUT sin código de barras; antes un PATCH lo dejaba vencido pero con el QR). Revisar
   en el teléfono que no quede ningún código para escanear. Repetirlo sin cambios nuevos da `"eventos": 0`; si la misma
   persona vuelve a tener un evento, el resumen dice `"ya_vencidos": 1` y Google no se reescribe. `/actualizar` de una
   persona vencida tampoco le vuelve a poner el QR. Probar también la baja desde el portal («Darme de baja del Local Club», si era su único rol). Si la
   respuesta trae `errores` con «permanente», Google rechazó el objeto: ver los logs del Edge. En prod lo hace el cron del
   Worker cada 10 minutos (sus resúmenes, solo conteos, quedan en los logs del Worker: «club-pase-vencer»).
9. Borrar las variables y el archivo: `unset ANON CWK TOK SYNC; rm -f /tmp/pase.json`. Sacar las capturas para el pedido de
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
7. **Encender** (Cloudflare Pages `satori-club` → Variables → `VITE_WALLET_GOOGLE` = `1`, texto que se usa en el build, y
   volver a desplegar). Recién ahí aparecen «Agregar a Google Wallet» y «Actualizar mi pase» en el portal. **Condiciones,
   todas:**
   - [x] la prueba en staging: el pase se guarda y se ve bien (12-nov, clase `club-satori-stg`);
   - [ ] **la baja vence el pase (probado en staging)** — con la opción c (§2, paso 8), falta probarla;
   - [ ] `CLUB_PASE_SYNC_KEY` cargada en el Edge de prod y como Secret en el Worker `satori-club-api` (el cron);
   - [x] el PR de `main` mergeado (#144, `3cacf43`, 12-nov 22:02 CR: las imágenes del pase publicadas con el deploy de Pages);
   - [ ] el Edge de prod desplegado con sus secretos, `WALLET_ENTORNO` = `prod`, y el portón probado (§2, pasos 2 a 4 con el ref de prod);
   - [ ] la aprobación de publicación de Google.

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
| Enlaces del reverso | «Canjear créditos (código de 10 minutos)» y, si corresponde, «Sus cupones para compartir» | ídem |
| Datos de contacto | **ninguno** (el Edge aborta si el objeto lleva un `@` o un `+506`) | `armarObjeto` |
| Baja o sin rol vigente | el pase pasa a `EXPIRED`, sin QR | ídem |

Maqueta: `docs/club-satori/img/pase-propuesta.png` (v4, aprobada el 08-nov).

## 5. Riesgos del piloto
- **Datos del pase:** el pase muestra datos de la última vez que se pidió o se actualizó (la línea con la fecha lo dice).
  Manda lo que diga el portal o la caja.
- **Baja:** con la opción c, el pase de alguien dado de baja se vence en Google **en hasta 10 minutos** (el cron del
  Worker). Mientras tanto la caja igual rechaza su QR. Si Google falla de forma transitoria (5xx, 429), la pasada siguiente
  reintenta; un rechazo permanente queda en el resumen del log. Es condición para encender (§3, paso 7).
- **Pase compartido:** quien tenga una captura del QR de socio puede intentar usar el beneficio (igual que con el portal).
  El enlace «Canjear» del pase genera códigos de canje de ese anfitrión: si se filtra, se corta con «Regenerar» o
  «Revocar» el botón «Canjear» en la ficha del miembro.
- **Vencimiento:** el pase no tiene fecha propia. Se vence con la baja (o sin ningún rol vigente), por `/vencer` (ver «Baja»).
- **Cursor compartido:** `/vencer` usa el mismo cursor (`google`) que la sincronización completa. Cuando se encienda la
  completa, después del piloto, rebobinarlo (`club_pase_cursor_rebobinar`) para que actualice los saldos que esta pasada salteó.
