# Pase a PROD — Google Wallet del Club con acceso de publicación (encender «Agregar a Google Wallet»)

> **Repo público:** sin Issuer ID, llaves, correos de cuentas de servicio, tokens ni nombres. Los secretos van solo por
> **nombre** y, cuando hace falta, por los primeros 8 caracteres de su **digest** (sha256; no permite recuperar el valor).
> Los valores los carga el dueño o su sesión **directo** en el panel de Supabase o de Cloudflare: nunca por chat, repo ni
> línea de comandos.
>
> - **Contexto:** Google aprobó el **acceso de publicación** de la Google Wallet API para el emisor de la empresa
>   (16-nov-2026 13:36 -06:00). Hasta hoy el emisor estaba en modo demo: solo las cuentas de prueba podían guardar el pase.
> - **Decisión B (firmada por el dueño el 16-nov):** el Edge `club-pase` se despliega **a mano** desde la rama
>   `claude/club-pase-edge` (fuera de `main` por la regla 2 de ESTADO hasta el ítem 11 / PR #61).
> - **Lleva firma:** sí (§10). Sin firma, solo lecturas.
> - **Si algo no coincide con lo esperado: se para y se avisa.** No se improvisa en prod.

## 0. Lo que encontró la preparación (16-nov, 14:15–14:30 CR, solo lectura en prod)
**El Edge y los secretos ya están en prod desde el 13-nov** (`docs/pases/PASE-club-pase-prod.md`, firmas del 13-nov y
redespliegue del 15-nov). Lo que cambia con la aprobación de Google es **quién puede guardar el pase**, no el código ni
los secretos. Por eso este pase **no despliega nada salvo que el §3 dé distinto**: verifica, prueba en un Android y
enciende el botón.

| Qué | Prod `yiczgdti…` | Staging `hwiatgic…` |
|---|---|---|
| `club-pase` | **v6 · `verify_jwt` off** · hash `3ee7558f…` · actualizado 15-nov 06:03 CR (desde `6c5848e`) | v11 · off · hash `0f87d4e4…` · actualizado 13-nov 11:36 CR (código anterior a la 157/168: sin «Personas registradas» ni avance de 90 días) |
| Ledger | 180 | 180 |
| `club_pases` (pases emitidos) | **0** | — |
| Cursor `google` (`club_pase_cursor`) | 3347 = último evento de `club_pase_eventos` (al día) | — |
| `club_config_global.club_url` | el dominio del Club (= `CLUB_WEB_ORIGIN`) | — |

- **Código de la rama vs. `main` actual:** `claude/club-pase-edge` se puso al día con `main` (`5396649`, ledger 180) con un
  merge **dentro de la rama** (`5cc5073`, sin conflictos). `supabase/functions/club-pase/` y `src/shared/wallet/` quedan
  **idénticos** a `6c5848e` (lo desplegado en prod): **no hace falta redesplegar**. vitest de la rama: 2511 pasan / 4 skip
  (incluidas `env.test.ts` del Edge y las de `src/shared/wallet/`).
- **Compatibilidad con el esquema hasta la 180:** el Edge llama `club_pase_por_token`, `club_pase_datos` (última versión:
  168), `club_pase_emitido`, `club_pases_emitidos`, `club_pase_eventos_leer`, `club_pase_cursor_leer/guardar` (150),
  `club_alertas_pendientes` (157) y `club_alerta_enviada` (150). Ninguna de las 169–180 las cambia (la 172 toca
  `club_pase_token`, que el Edge no usa; la 176 cambia la política de gerencia de `club_pases`, y el Edge entra con
  `service_role`). `club_pase_reintento_*` no existen en ninguna base: solo las usa `/sync`, que no tiene programador en
  el piloto.
- **Worker `satori-club-api`:** su cron (`*/10 * * * *`, `club-web/worker/programado.js`) llama a `/club-pase/vencer` con
  `x-club-pase-sync`. El cursor `google` al día y el contador de `club_pase_cursor_leer` en `pg_stat_statements` (455)
  indican que sigue llamando; el control lo confirma en el §4.
- **No se pudo desde la sesión:** listar los secretos por nombre (el conector de Supabase no tiene esa lectura) ni llamar
  al Edge (el proxy de la sesión bloquea `*.supabase.co`). Lo hace el dueño o su sesión en el §2 y el §5.
- **Staging no se tocó:** sin poder llamar al Edge, desplegar ahí no tenía prueba de humo. Queda como paso opcional (§6).

## 1. Qué pasa y qué no
**Pasa:**
1. Se verifica que los 8 secretos existen con su nombre exacto (7 del Edge en prod + 1 del Worker). **No se carga ninguno
   nuevo** salvo que falte alguno.
2. Prueba en un Android **con una cuenta de Google cualquiera** (ya no hace falta que sea de prueba): pedir el pase,
   guardarlo, revisarlo, actualizarlo y verificar que la baja lo vence sin QR.
3. Se enciende `VITE_WALLET_GOOGLE` en Cloudflare Pages y se vuelve a desplegar club-web: aparecen «Agregar a Google
   Wallet» y «Actualizar mi pase».

**No pasa:** migraciones, datos, merges a `main`, cambios en la app de gerencia o en la caja, ni código del Edge (salvo
el §3-b, solo si la verificación lo pide). `main` no cambia.

**Responsables:** ejecución = el dueño o su sesión de CC (los secretos y el panel); **control = otra persona** (lecturas de
§2, §4 y §8, por ejemplo una sesión de Claude en solo lectura u otra persona del equipo). No pueden ser la misma.

## 2. Los 8 secretos (verificar; cargar solo si falta alguno)
**Dónde se miran:** Supabase → proyecto **PROD** (leer el ref en pantalla: `yiczgdti…`) → **Edge Functions** → **Secrets**
(muestra nombre y digest; nunca el valor). En la terminal: `supabase secrets list --project-ref yiczgdtirrkdvohdquzf`
(nombre + digest). El del Worker: Cloudflare → Workers → `satori-club-api` → **Settings** → **Variables and Secrets**.

| # | Nombre exacto | Dónde | Qué valor va (descripción, nunca el valor) | Digest al 13-nov (primeros 8) |
|---|---|---|---|---|
| 1 | `GOOGLE_WALLET_ISSUER_ID` | Supabase prod | El número del emisor (Pay & Wallet Console → Google Wallet API). **La aprobación no lo cambia** (Google pasa la misma cuenta a modo publicación): si la consola muestra el mismo número, no se toca | `5d9bf496` |
| 2 | `GOOGLE_WALLET_SA_KEY` | Supabase prod | El JSON entero de la clave de la cuenta de servicio **de prod** (distinta de la de staging). La cuenta sigue como Desarrollador en la consola | `0c74a543` |
| 3 | `CLUB_WEB_KEY` | Supabase prod | La clave de club-web de prod (la misma de Pages y del Worker; coincide con la activa de la base) | `d65e37c7` |
| 4 | `CLUB_WEB_ORIGIN` | Supabase prod | El dominio del Club = `select club_url from public.club_config_global;`, sin barra final | `73ce68cc` |
| 5 | `WALLET_DISENO` | Supabase prod | El JSON público de §1 de `docs/club-satori/WALLET-GOOGLE-ACTIVACION.md` (color tinta, logo y franja del dominio del Club) | `82e0c46e` |
| 6 | `WALLET_ENTORNO` | Supabase prod | `prod` (minúsculas). **Nunca `stg` en prod** | `6754af96` |
| 7 | `CLUB_PASE_SYNC_KEY` | Supabase prod | Clave al azar de ≥ 32 caracteres, distinta de `CLUB_WEB_KEY`: el portón de `/vencer` | `0c21a15f` |
| 8 | `CLUB_PASE_SYNC_KEY` | Cloudflare, Worker `satori-club-api` (Secret) | **La misma** que la #7. Sin ella el cron no hace nada | — (Cloudflare no muestra digest) |

`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` los pone Supabase solo. **Criterio:** si los 7 nombres de Supabase están y sus
digests son los de la tabla, no se carga nada. Si un digest es otro, se anota (alguien lo cambió después del 13-nov) y se
para hasta saber por qué. Si falta uno, lo carga el dueño (pasos de §1 del doc de activación: **Add new secret**, pegar,
**Save**; borrar el archivo `.json` de la clave de Descargas y vaciar la papelera).
**Cambiar un secreto puede subir la versión de todas las funciones sin cambiar su código:** se confirma por la lista de
secretos (nombre + digest) y por el hash, nunca por la versión.

## 3. Antes (solo lectura; el control)
a. **Edge de prod:** `club-pase` sigue en **v6 · `verify_jwt` off · hash `3ee7558f…`**. Las otras 6 funciones, con su hash
   anotado (`supabase functions list --project-ref yiczgdtirrkdvohdquzf` o la Management API).
b. **Solo si el hash de `club-pase` NO es `3ee7558f…`** (alguien lo cambió): se para y se avisa. Si el dueño firma volver
   a la fuente conocida, se despliega desde la rama (sin Docker; `--no-verify-jwt` es obligatorio: club-web llama sin JWT
   de usuario y el portón es `x-club-web`):
   ```bash
   git fetch origin claude/club-pase-edge
   git checkout claude/club-pase-edge
   git rev-parse --short HEAD
   supabase --version
   supabase functions deploy club-pase --project-ref yiczgdtirrkdvohdquzf --no-verify-jwt --use-api
   ```
   `git rev-parse` tiene que dar `5cc5073` (o un SHA posterior que este pase anote con su firma). CLI 2.122.0 o más
   nueva. Tiene que terminar en «Deployed Functions … club-pase». Después: `verify_jwt` **off** (si dice on, el botón da
   401: se vuelve a desplegar con `--no-verify-jwt`).
c. **Base** (`begin read only` … `rollback`):
   ```sql
   select max(version) from supabase_migrations.schema_migrations;               -- 180 (o 181/182 si ya entraron: ver §9)
   select count(*) from public.club_pases;                                         -- 0 antes de la prueba
   select ultimo_id from public.club_pase_cursor where nombre = 'google';          -- = max(id) de club_pase_eventos, o cerca
   select max(id) from public.club_pase_eventos;
   select club_url from public.club_config_global;                                 -- = CLUB_WEB_ORIGIN
   ```
d. **Imágenes del pase:** abrir en el navegador `<dominio del Club>/pase/logo.png` y `/pase/hero.png`: tienen que verse
   el daruma (no la página del Club). Si no, el pase sale sin logo ni franja: se para.
e. **Google:** en la Pay & Wallet Console, el emisor figura con acceso de publicación (ya no «demo»).

## 4. Humo del portón (el dueño, en su terminal; sin datos de nadie)
Las claves se cargan sin que se vean ni queden en el historial (`read -rs`):
```bash
read -rs ANON; echo
read -rs CWK; echo
E=https://yiczgdtirrkdvohdquzf.supabase.co/functions/v1/club-pase
```
`ANON` = la anon key de prod; `CWK` = la `CLUB_WEB_KEY` de prod.
```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$E/google" -H "apikey: $ANON" -H 'Content-Type: application/json' -d '{"token":"x"}'
```
→ **401** (sin `x-club-web`).
```bash
curl -sS -w '\n%{http_code}\n' -X POST "$E/google" -H "apikey: $ANON" -H "x-club-web: $CWK" -H 'Content-Type: application/json' -d "{\"token\":\"$(printf 'a%.0s' {1..64})\"}"
```
→ **404** `portal_invalido` (la clave pasa; el token no existe). **503** = falta un secreto o `WALLET_ENTORNO` no es
`prod`: se para y se vuelve al §2.
```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$E/vencer" -H "apikey: $ANON"
```
→ **401** (sin `x-club-pase-sync`). Al terminar: `unset ANON CWK`.
**Cron del Worker:** Cloudflare → Workers → `satori-club-api` → **Logs**: cada 10 minutos una línea `club-pase-vencer` con
`"ok": true` y `"status": 200`. Si dice 401, la clave del Worker (#8) no es la del Edge (#7).

## 5. Prueba en un Android (el dueño, antes de encender el botón)
**Qué hace falta:** un Android con la app **Google Wallet** y una cuenta de Google (puede ser la del dueño). Una persona
**de prueba en prod** que sea del equipo y quiera tener el pase (por ejemplo, el propio dueño como socio y anfitrión). El
botón todavía no se ve en el portal, así que el link se pide por la API pública del Club, que ya funciona sin el botón.

1. **El link del portal:** app → **Club** → **Miembros** → la persona → **«⎘ Link del portal»**. El token es lo que va
   después de `/p/`. En la terminal, sin que se vea:
   ```bash
   read -rs TOK; echo
   C=https://club.satoricostarica.com
   curl -sS -X POST "$C/api/portal/$TOK/wallet" > /tmp/pase.json
   python3 -c "import json;u=json.load(open('/tmp/pase.json')).get('data',{}).get('url','');print('largo del link:',len(u));print(u[:40]+'…')"
   ```
   Tiene que decir un largo **menor a 1.800** y empezar con `https://pay.google.com/gp/v/save/`. Si trae
   `{"error":"servicio"}`: Supabase → Edge Functions → `club-pase` → **Logs**, línea «club-pase: Google …» (se para).
2. **Pasar el link al teléfono** por un canal propio (por ejemplo, una nota o un mensaje a uno mismo) y abrirlo **en el
   Android** → **Guardar** (o «Agregar»).
3. **Qué tiene que ver** en Google Wallet:
   - título **«Satori»**, el **nombre de pila** de la persona y el subtítulo («Socio del Local Club», «Anfitrión» o «Socio
     y anfitrión»);
   - fondo tinta (casi negro), el logo del daruma y la franja de arriba;
   - **sin** la marca «[TEST ONLY]» / «Solo para pruebas» (si aparece, el emisor sigue en demo: se para);
   - anfitrión: «Créditos al 16-nov HH:MM» con la hora de Costa Rica y «₡… disponibles»; solo socio: «Actualizado · …»;
   - el **QR** con el código corto debajo: escanearlo con la caja de prod (**Club → Escanear**) tiene que abrir a esa
     persona;
   - en el reverso: «Canjear créditos (código de 10 minutos)» (solo anfitrión con créditos) y, si es socio y anfitrión,
     «Sus cupones para compartir»;
   - **ningún** teléfono ni correo.
4. **Actualizar:** registrar una visita o una cortesía de esa persona en la caja y correr:
   ```bash
   curl -sS -X POST "$C/api/portal/$TOK/wallet/actualizar"
   ```
   → `{"data":{"resultado":"actualizado"}}` y, en el teléfono (puede tardar un minuto), la hora de la línea de fecha cambia.
5. **Baja (la condición pendiente del doc de activación):** solo si la persona de prueba puede quedar de baja (después se
   reactiva desde la ficha). App → Club → Miembros → la persona → estado **«baja»**. Esperar **hasta 10 minutos** (el cron
   del Worker). El pase del teléfono queda **vencido y SIN QR**. En los logs del Worker, la línea `club-pase-vencer` de esa
   pasada dice `"vencidos": 1`. Reactivar a la persona y volver a pedir el pase (paso 1): sale activo con QR.
   Si no se quiere dar de baja a nadie en prod: esta prueba se hace en staging (§6) y se anota así.
6. **Limpiar:** `unset TOK; rm -f /tmp/pase.json`. Anotar en §11: hora, qué se vio y una captura (no va al repo si muestra
   un nombre real).

**Criterio:** todo lo del paso 3 se ve, el QR abre a la persona y la baja vence el pase sin QR. Si algo falla: **no se
enciende el botón**.

## 6. Staging (opcional; sin secretos nuevos de prod)
Staging tiene `club-pase` **v11** (13-nov), anterior a la 157/168 de prod. Para probar la baja ahí con el mismo código que
prod: desplegar desde la rama con los secretos que staging **ya tiene** (`WALLET_ENTORNO` = `stg`, su propia clave de
cuenta de servicio; ninguna clave de prod):
```bash
git checkout claude/club-pase-edge && git rev-parse --short HEAD
supabase functions deploy club-pase --project-ref hwiatgicyyqyezqwldia --no-verify-jwt --use-api
```
y seguir los pasos 3 a 9 del §2 de `docs/club-satori/WALLET-GOOGLE-ACTIVACION.md`. No necesita firma de prod, sí el OK del
dueño para tocar staging.

## 7. Encender el botón: `VITE_WALLET_GOOGLE` (lleva firma: lo ve el cliente)
**Dónde:** Cloudflare → **Workers & Pages** → **`satori-club`** (Pages) → **Settings** → **Variables and Secrets**
(entorno **Production**) → **Add** → Type **Text** (no Secret: se usa en el build) → Name `VITE_WALLET_GOOGLE` → Value `1`
→ **Save**. Después: **Deployments** → el último de producción → **⋯** → **Retry deployment** (la variable entra en el
build; sin redesplegar no cambia nada).
**El Worker `satori-club-api` no necesita la variable:** solo sirve la API y el cron, no el portal.

**Qué ve el cliente** (portal del Club, `/p/…`, debajo de «Hola, …»):
- **«Agregar a Google Wallet»**: «Preparando su pase…» y lo lleva a Google Wallet para guardarlo. Si falla: «No pudimos
  preparar el pase. Pruebe de nuevo en un rato.»
- **«Actualizar mi pase»**: «Listo: su pase de Google Wallet quedó al día.»; si nunca lo guardó: «Todavía no tiene el pase
  en Google Wallet. Agréguelo con el botón de arriba.»; si ya no tiene beneficio vigente: «Su pase quedó vencido…».
- También aparece «Agregar a Google Wallet» al final de la autoalta de socio (sin «Actualizar»).
- En inglés, los mismos textos en inglés. En un iPhone el botón aparece igual pero Google Wallet no se instala ahí: el
  link abre la página web del pase de Google (Apple Wallet sigue apagado).

**Verificar después (el control):** abrir el portal de la persona de prueba en el teléfono y ver los dos botones. Ver el
contenido (no solo un 200): el build nuevo tiene que mostrar «Agregar a Google Wallet». La guía SOP del Club en
`docs/sop-app/` se actualiza en un PR aparte si cambia lo que explica el personal (el botón es del cliente, no de la app).

## 8. Después (el control, solo lectura)
- `club-pase`: misma versión y **mismo hash** que en el §3 (si no hubo §3-b); las otras 6 funciones, iguales.
- Secretos: los mismos 7 nombres y digests del §2.
- `select count(*) from public.club_pases;` → sube con cada persona que pide el pase (1 después de la prueba).
- Cursor `google` sigue avanzando y los logs del Worker muestran `club-pase-vencer` con 200 cada 10 minutos.
- La caja y el portal siguen funcionando (un escaneo y un portal abiertos).

**Criterios de parada:** 503 en el portón · `verify_jwt` on · digest distinto al del §2 sin explicación · «[TEST ONLY]»
en el pase · teléfono o correo en el pase · el QR no abre a la persona · la baja no vence el pase o deja el QR · el
Worker en 401. En cualquiera: **no se enciende** (o se apaga, §9) y se avisa.

## 9. Vuelta atrás y orden
**Vuelta atrás (de la más liviana a la más fuerte):**
1. **Apagar el botón:** `VITE_WALLET_GOOGLE` vacío (o borrar la variable) y **Retry deployment** de Pages. Los pases ya
   guardados siguen en los teléfonos; `/vencer` los sigue venciendo con las bajas.
2. **Cortar el Edge:** borrar un secreto obligatorio (por ejemplo `WALLET_ENTORNO`): todo responde 503 y el portal muestra
   «No pudimos preparar el pase». La caja y el portal siguen sin el pase.
3. **Volver a la fuente anterior:** desplegar `6c5848e` (hash `3ee7558f…`) desde la rama, con `--no-verify-jwt`.
4. Último recurso: `supabase functions delete club-pase --project-ref yiczgdtirrkdvohdquzf`.
Sin migraciones ni datos que deshacer. El cursor `google` se deja como está.

**Orden respecto de las migraciones 181 y 182 (PR #229 y #226, en borrador con firma pendiente): no dependen.**
- La **181** (`club_tope_almuerzo_cena`) reescribe la visita del socio y sigue dejando un evento `cortesia` en
  `club_pase_eventos`: `/vencer` lo lee y no toca Google (no es una baja). No cambia ninguna función del Edge.
- La **182** (`club_portal_reserva_anfitrion`) cambia `club_portal` (lo que ve el portal), no las funciones del pase.
- Este pase puede ir antes, después o entre ellas. **Única regla:** no hacer el §5 ni el §7 en el mismo minuto que un merge
  a `main` (Branching), para no mezclar causas si algo falla. Si una migración futura cambia `club_pase_datos`,
  `club_pase_por_token`, `club_pase_emitido`, `club_pases_emitidos`, `club_pase_eventos_leer` o el cursor, se vuelve a
  correr el §5 antes de encender.

**Ventana:** las pruebas y el encendido **no** durante el servicio (19–22 h) ni de 15:50 a 19:00 (cierre de la mañana); el
encendido no es un merge, pero lo ve el cliente.

## 10. Firma (qué necesita firma del dueño)
| Paso | ¿Firma? | Nota |
|---|---|---|
| §2 verificar los secretos | No (lectura) | Cargar uno que falte: **sí**, en el momento |
| §3-b redesplegar `club-pase` | **Sí**, sobre el SHA exacto | Solo si el hash no coincide |
| §4 humo del portón | No | Lo corre el dueño (tiene las claves) |
| §5 prueba en el Android (incluida la baja en prod) | **Sí** (dar de baja a una persona real de prod) | Sin la baja, no lleva firma |
| §6 staging | OK del dueño para tocar staging | Sin claves de prod |
| §7 encender `VITE_WALLET_GOOGLE` | **Sí** (lo ve el cliente) + validación física del dueño | Después de §4 y §5 con todo bien |

Firma: ____________ · fecha y hora (-06:00): ____________ · SHA de la rama: `5cc5073`

## 11. Bitácora
| Paso | Hora CR | Quién | Resultado |
|---|---|---|---|
| Preparación (§0) | 16-nov 14:15–14:30 | sesión de CC (solo lectura en prod) | Edge v6 off `3ee7558f…`, ledger 180, 0 pases, cursor al día; rama al día con `main` (`5cc5073`), Edge idéntico a `6c5848e` |
| §2 secretos | | | |
| §3 antes | | | |
| §4 portón | | | |
| §5 Android | | | |
| §7 encendido | | | |
| §8 después | | | |
