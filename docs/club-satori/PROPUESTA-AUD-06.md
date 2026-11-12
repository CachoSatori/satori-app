# CLUB-AUD-06 · Cerrar la llamada directa a las funciones públicas con la anon key (propuesta)

> Para que decida Ismael. **No está implementado.** Se aplica antes de la salida general.

## El problema
`club-web` (#38) pone un tope por IP (`CF-Connecting-IP`) delante de `club_cupon_crear`, `club_cupon_ver`,
`club_cupon_contacto` y `club_portal`. Pero la anon key es pública, porque va en el navegador de la app. Con ella,
cualquiera puede llamar `POST /rest/v1/rpc/club_cupon_crear` **directo a Supabase** y saltearse el tope.

Lo que queda hoy:
- el tope de 30 cupones por referente y por día, en SQL;
- no se crean créditos (el cupón lo tiene que usar la caja);
- pero se pueden agotar los cupones de un referente o sembrar contactos falsos.

## Opciones
| | Cómo | A favor | En contra |
|---|---|---|---|
| **A. Clave compartida en un header (recomendada)** | La Pages Function agrega `x-club-web: <clave>`. Las 4 funciones leen `current_setting('request.headers', true)::json->>'x-club-web'` y la comparan con un hash guardado en una tabla privada (`club_web_clave`, sin grants). Sin la clave → el mismo «Código no válido» de siempre. | Chica y en SQL, se prueba con el harness de siempre. Rotar la clave es un `update`. La clave solo sirve para lo que ya hace hoy la anon key. | Si la clave se filtra, vuelve el problema (se rota). |
| B. Rol propio `club_web` + JWT firmado en el edge | Revocar a anon; la función firma un JWT corto con el rol `club_web`. | Sin secreto en la base. | El edge necesita el **JWT secret** del proyecto, que permite firmar cualquier rol (también `service_role`). Riesgo alto. |
| C. Edge Function de Supabase como única puerta | Revocar a anon; la Edge usa `service_role` y su propio rate limit (KV externo). | Todo en Supabase. | Más infraestructura, y el rate limit por IP igual necesita un almacén aparte. |

**Recomendación: A**, más un tope global en SQL como red de seguridad: un máximo de cupones por minuto y
por local, con advisory lock y conteo sobre el índice `(referente_id, creado_en)`, más uno nuevo
`(location_id, creado_en)`.

## Pasos (si se aprueba A)
1. En la 075:
   - tabla `club_web_clave (location_id, hash, creada_en)` sin grants;
   - función interna `club_web_ok()`;
   - las 4 funciones públicas la llaman primero.
2. Secreto `CLUB_WEB_KEY` en Cloudflare Pages: Settings → Variables and Secrets, como secreto.
3. Pruebas:
   - anon sin el header → «Código no válido»;
   - con el header correcto → OK;
   - con un header viejo, después de rotar → «Código no válido».
4. Rotación: generar una clave nueva, guardar su hash y actualizar el secreto en Pages.
