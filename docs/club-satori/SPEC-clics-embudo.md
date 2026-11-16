# SPEC — Registro de clics y embudo del Club Satori

> **Clase:** SPEC de INVESTIGACIÓN / DECISIÓN. **No autoriza código ni migraciones**: construye Opus después de la firma,
> verifica un agente independiente y se aplica a staging antes de la firma de prod.
> **Fecha:** 16-nov-2026 · **Base leída:** `main` `9225d87`, ledger 180 en prod y en staging (solo lectura) · PR #220 (borrador).
> **Decisiones del dueño ya tomadas (16-nov):** qué se registra, opción A (ligado por ID interno), sin IP, 13 meses +
> totales para siempre, el registro nunca frena el link, embudo clic → reserva → llegada → reseña, multi-local.
> Cumpleaños automático por el pase de Wallet (opción A): §13.

## 1. Objetivo

Saber, por local y por grupo (`local`, `turista`, `referente`, `cumpleanos`: los mismos del #220), cuánta gente toca
«Reservar», «Cómo llegar» y «Reseña», y cuántos de esos toques terminan en una reserva, en una llegada y en un clic de
reseña. Y poder comparar **año contra año** y **mes contra el mismo mes del año anterior**, aunque el detalle ya se haya
borrado.

Fuera de alcance: plata (no toca saldos, créditos, caja ni sagrados), Edge Functions (regla 2), y saber si la reseña se
publicó (Google no lo informa: se mide el clic en el link de reseña).

## 2. Qué ve cada rol

| Rol | Qué ve | Qué hace |
|---|---|---|
| **Dueño** | Club → Embudo → «Links»: totales de todos los locales, embudo y comparaciones. Nunca nombres. | Carga el CSV de OpenTable. Cambia la ventana de atribución. |
| **Manager** | Lo mismo, solo de sus locales (regla de la 172/176). | Nada más. |
| **Contador / personal** | Nada (fase 1). | — |
| **Cliente** | Nada distinto: los mismos botones, que abren igual de rápido. El aviso de privacidad v1.4 lo dice. | — |

El reporte muestra **solo totales**. No hay vista «clics de un socio» ni en la ficha: no se construye.

## 3. Qué hay hoy (verificado en el esquema)

| Paso | Dato que ya existe | Límite |
|---|---|---|
| Clic en reseña, turista | `club_cupones.resena_clic_en` (158): solo la **primera** vez | No guarda repeticiones |
| Clic en reseña, socio | `club_resena_socio.clic_en` (167): un renglón por pedido de reseña | Solo cuando le toca la tarjeta |
| Llegada, socio | `club_visitas_socio` (`miembro_id`, `location_id`, `registrada_en`) | — |
| Llegada, cumpleaños | `club_cumple_usos` (`miembro_id`, `anio`, `usado_en`, sin `deshecho_en`) | — |
| Llegada, turista | `club_cupones.usado_en` (estado usado) | — |
| Llegada, referente | `club_visitas` (tarjeta del anfitrión) | El portal del referente no tiene «Reservar» todavía |
| Links por local | `club_config.reserva_url`, `mapa_url`, `resena_url` | Nosara sin cargar hasta que abra |
| Job diario | `pg_cron` `club_socios_mantenimiento` (09:15 UTC), en prod y staging | — |

Las migraciones 158 y 167 **confirman el clic en el link de reseña, no la reseña**. Clic en «Reservar» y «Cómo llegar»:
hoy no se registra nada.

## 4. Modelo de datos propuesto

Una migración (bloque CLUB, siguiente libre del registro; entra a prod renumerada a 181+ por la regla 3). Todas las
tablas con RLS prendida, `revoke all` a `public`, `anon` y `authenticated`, **sin políticas**: se leen y escriben solo por
funciones `SECURITY DEFINER` con `search_path` fijo.

**`club_clics`** (detalle; vive 13 meses)

| Columna | Nota |
|---|---|
| `id bigint identity`, `en timestamptz default now()`, `dia date` | `dia` en hora de Costa Rica |
| `location_id text` → `club_config` | Multi-local |
| `tipo` | `reservar` · `mapa` · `resena` (CHECK) |
| `origen` | `portal_socio` · `cupon` · `cumple_whatsapp` · `portal_referente` · `wallet` (CHECK) |
| `grupo` | `local` · `turista` · `referente` · `cumpleanos` (CHECK). Lo decide **el servidor**, nunca el navegador |
| `miembro_id uuid null` → `club_miembros` `on delete set null` | Uno de los dos, o ninguno |
| `cupon_id uuid null` → `club_cupones` `on delete set null` | CHECK: no los dos a la vez |

No existen columnas de IP, navegador, referer, URL ni texto libre. Una prueba de catálogo lo fija (§10).

**`club_clics_enlaces`** (links cortos para mensajes): `codigo` (12 caracteres al azar, PK), `miembro_id`,
`location_id`, `tipo`, `origen`, `grupo`, `creado_en`, `vence_en` (60 días). Se borran al vencer.

**`club_clics_totales`** (para siempre; sin IDs de personas)
PK (`periodo` `dia`|`mes`, `fecha`, `location_id`, `grupo`, `origen`, `tipo`). Columnas: `clics`, `unicos` (personas o
cupones distintos), `sin_ligar`, `unicos_con_llegada`, `unicos_con_resena`, `cerrado_en`. El renglón de mes existe
aparte porque los únicos del mes no salen de sumar los días.

**`club_reservas_ot`** (import de OpenTable; para siempre; sin datos del comensal)
PK (`dia`, `location_id`, `campana`, `estado`). Columnas: `reservas`, `personas`, `carga_id`. Más
**`club_reservas_ot_cargas`**: quién, cuándo, rango de fechas, huella sha256 del archivo, filas leídas y descartadas.

**Funciones**

| Función | Quién | Qué hace |
|---|---|---|
| `club_clic_registrar(p_tipo, p_origen, p_token, p_codigo)` | `anon`, solo con el portón `club_web_ok()` | Resuelve token → socio o código → cupón, toma el local y el grupo, aplica los topes de §5 e inserta. Responde siempre `{ok:true}` (no revela si la credencial vale). |
| `club_clic_enlace_crear(p_miembro, p_tipo, p_origen)` | owner y manager de ese local | Devuelve el código corto para el WhatsApp de cumpleaños. |
| `club_clic_enlace_abrir(p_codigo)` | `anon` con portón | Registra el clic y devuelve la URL de destino, armada en el servidor con la campaña del #220. |
| `club_clics_reporte(p_desde, p_hasta, p_location)` | owner; manager de sus locales | Totales + reservas de OpenTable + mismo período del año anterior. |
| `club_reservas_ot_cargar(p_location, p_desde, p_hasta, p_filas, p_sha)` | solo owner | Reemplaza el rango de ese local en una transacción; deja la carga en `club_auditoria`. |
| `club_clics_mantenimiento()` | job | Agrega, cierra y borra (abajo). |

Las marcas de la 158 y la 167 siguen como están (las usa el Embudo del anfitrión, 162). En la fase 2,
`club_cupon_resena_clic` y `club_portal_resena('clic')` insertan además en `club_clics`: una sola fuente, sin que el
navegador mande dos avisos.

**Conversión** (se calcula antes de borrar): un único **llegó** si tiene una llegada (§3) en el mismo local dentro de
`clic_ventana_dias` desde su primer clic del período (nueva columna en `club_config_global`, propuesta 30 días); **reseñó**
si tiene clic de reseña después de esa llegada. Se atribuye al día del clic.

**Job `club_clics_mantenimiento`** (`pg_cron`, diario 09:30 UTC = 03:30 CR, idempotente):
1. Recalcula `club_clics_totales` de los últimos `ventana + 5` días y del mes en curso y el anterior (upsert).
2. Pone `cerrado_en` a los días con más de `ventana + 5` días: ya no cambian.
3. Borra de `club_clics` lo que tiene más de 13 meses **solo si** su día está cerrado y la suma de `clics` de los totales
   de ese día coincide con el conteo del detalle. Si no coincide: no borra, deja una fila en `club_alertas` y sigue.
4. Borra enlaces vencidos.

**Baja del socio:** en el mismo momento de la baja (portal o gerencia) sus clics pasan a `miembro_id = null`. Los
totales no cambian.

## 5. Endpoint anónimo y anti-abuso (integra el hallazgo 232)

- **Páginas** (portal del socio, cupón, futuro portal del referente): el botón sigue siendo un `<a href target="_blank">`
  normal. Al tocarlo, `navigator.sendBeacon('/api/clic', …)` (si no existe, `fetch` con `keepalive`), sin
  `preventDefault` y sin esperar respuesta. Si el aviso falla, se pierde ese clic y el link abre igual.
- **Mensajes** (WhatsApp de cumpleaños, después Wallet): no hay página propia, así que el link es
  `/ir/{codigo}` en el dominio del Club. La API registra y redirige (302). Si la base no responde en 1,5 s o el código no
  existe: redirige igual a una página fija del Club con los botones de reserva de cada local. Nunca una pantalla de error.
- **`POST /api/clic`** `{tipo, origen, token | codigo}` → `club_clic_registrar`. Formatos validados con las mismas
  expresiones de hoy (`RE_TOKEN`, `RE_CUPON`). Responde 204 siempre.
- **El widget de OpenTable** de «Mi Club» es un iframe de otro dominio: lo que pasa adentro no se ve. Esas reservas
  aparecen solo en el paso «reserva» (por campaña). Se dice en la pantalla.

**Topes.** El hallazgo 232 («topes por IP del portal») está en el backlog de ESTADO solo con el título; su detalle no está
en el repo. Se toma como: el tope del portal depende solo de la IP, y una IP compartida (hotel, wifi del local) castiga a
todos mientras que quien rota IPs no tiene freno. Propuesta para este endpoint, y como patrón para el portal:

| Capa | Regla | Dónde |
|---|---|---|
| Por credencial | 30 clics por hora por token o cupón | SQL (cuenta en `club_clics`) |
| Rebote | Mismo sujeto + tipo + origen en menos de 2 min = no se inserta | SQL |
| Por IP | `RL_LEER` con clave propia `clic:{ip}`, 60 por minuto | Cloudflare (binding de hoy) |
| Global | Tope por local y por minuto (como `cupones_max_minuto_local`) → alerta en `club_alertas` | SQL |

La IP se usa **solo** como clave del limitador de Cloudflare, en memoria de ese servicio. No llega a la base, no va a
los logs (la alerta de hoy ya registra solo el prefijo de la clave) y no se guarda con hash. A diferencia del resto de la
API, si falta el limitador este endpoint **no** frena nada del cliente: descarta el registro y el link ya abrió.

## 6. Cruce con OpenTable (import de CSV)

La API de OpenTable es para socios comerciales: al principio el dueño exporta el informe de reservas y lo carga en la app.

- **Dónde:** Club → Embudo → «Links» → «Cargar reservas de OpenTable» (solo owner). Elige local y archivo.
- **El archivo se lee en el navegador.** Nombre, teléfono, correo y notas del comensal **no salen del equipo**: a la base
  viajan solo las filas agregadas.
- **Columnas que se usan** (se ubican por encabezado, en español o inglés, sin depender del orden): fecha de la reserva,
  cantidad de personas, estado, origen RestRef y nombre de la campaña RestRef. Si falta alguna, no carga y dice cuál.
- **Filtro:** solo filas con origen del Club. Campaña `local`, `turista`, `cumpleanos` o `referente`; cualquier otra
  (incluida la campaña anterior al #220) va a `otra`.
- **Estados:** se normalizan a `cumplida`, `no_show`, `cancelada`, `pendiente`.
- **Idempotencia:** cada carga declara su rango de fechas y **reemplaza** ese rango para ese local. Cargar dos veces el
  mismo archivo no duplica; cargar uno más nuevo corrige estados.
- **Vista previa antes de guardar:** rango, totales por campaña y filas descartadas con el motivo.
- **Prerrequisito:** un export real de muestra para fijar encabezados y estados (queda **fuera del repo**; los fixtures
  de prueba son ficticios).

El cruce clic → reserva es **por campaña y por período, no por persona**: a OpenTable no viaja nada del socio (#220).
Por eso la tasa de ese paso puede pasar de 100 % (reservas hechas en el widget) y la pantalla lo aclara.

## 7. Pantalla y gráficos

Club → pestaña **Embudo**, con selector «Anfitriones | **Links**» (no se suma una pestaña más). Filtros: local (el
manager, solo los suyos), período (mes por defecto), grupo.

1. **Embudo del período** (barras horizontales, una fila por grupo): clics en «Reservar» → reservas de OpenTable →
   llegadas → clics en reseña, con la tasa de cada paso.
2. **Año contra año** (líneas, 12 meses): clics y llegadas del año en curso contra el anterior.
3. **Mes contra el mismo mes del año anterior** (tabla): clics, únicos, reservas, llegadas, reseñas, con la diferencia
   en número y en %.
4. **Por grupo y por local** (barras apiladas por mes). Con «todos los locales», una fila por local.
5. **Por botón y por origen** (tabla chica): reservar / mapa / reseña × portal, cupón, cumpleaños.

Sin año anterior dice «sin dato» (la comparación empieza a servir en nov-2027). Arriba, la fecha de la última carga de
OpenTable y hasta qué día cubre. Días sin cerrar marcados como «provisional». Exporte CSV de los totales. Sigue el
estándar de reportes y las fechas en hora de Costa Rica.

## 8. Privacidad (Ley 8968)

**El aviso v1.3 no cubre este uso.** Dice que se guardan nombre, contacto, cumpleaños, visitas y beneficios, y que los
datos no se usan «para nada más». Un clic ligado al socio es un dato nuevo y medir el uso es un fin nuevo. Hace falta
**v1.4**: migración con las huellas nuevas en `club_avisos_privacidad`, `AVISO_PRIVACIDAD_VERSION` en club-web y
`aviso.test.ts`, en el mismo PR (orden como en la 173). El resto del aviso queda igual; cambian tres párrafos.

**Español**
- *Qué datos guardamos* — se agrega al final: «También anotamos cuándo toca los botones "Reservar", "Cómo llegar" o
  "Reseña" de su portal, de su cupón o de un mensaje nuestro. No guardamos su dirección IP ni datos de su teléfono.»
- *Para qué* — antes de «No vendemos sus datos…»: «También para saber, con totales, si esos botones le sirven a nuestros
  clientes: por ejemplo, cuántas reservas terminan en una visita.»
- *Cuánto tiempo* — se agrega al final: «El registro de esos botones ligado a usted se borra a los 13 meses; después
  solo quedan totales, que no le identifican.»

**English**
- *What we keep* — added at the end: "We also note when you tap the "Reserve", "Directions" or "Review" buttons in your
  portal, on your coupon or in a message from us. We do not store your IP address or data about your phone."
- *Why* — before "We don't sell your data…": "Also to learn, in totals, whether those buttons are useful to our guests:
  for example, how many reservations end in a visit."
- *How long* — added at the end: "The record of those buttons linked to you is deleted after 13 months; after that only
  totals remain, which do not identify you."

**Turista** (resumen `optin_aviso`, ES / EN), se agrega: «También anotamos, ligado a su cupón, cuándo toca "Reservar",
"Cómo llegar" o "Reseña"; ese registro se borra a los 13 meses.» / "We also note, linked to your coupon, when you tap
"Reserve", "Directions" or "Review"; that record is deleted after 13 months."

**Socios que aceptaron una versión anterior:** ver la decisión D2. Recomendación de producto, no dictamen legal: conviene
que quien asesora al negocio en la Ley 8968 lea la v1.4 antes de la firma.

## 9. Plan por fases (PRs chicos)

| # | PR | Contenido | Firma |
|---|---|---|---|
| 1 | Esquema + registro | Migración (tablas, `club_clic_registrar`, topes), `/api/clic`, beacon en «Reservar» y «Cómo llegar» del portal y del cupón. **Aviso v1.4 en el mismo PR.** | Sí (esquema + aviso) |
| 2 | Reseña y totales | Clic de reseña a `club_clics` desde las funciones de la 158 y la 167; `club_clics_totales`, job y borrado a 13 meses; baja → anónimo. | Sí (esquema + cron) |
| 3 | Pantalla «Links» | `club_clics_reporte`, gráficos 1 a 5, exporte. Guía `docs/sop-app/6.13`. | OK + validación física |
| 4 | OpenTable | Tablas e import del CSV, paso «reserva» en el embudo. | Sí (esquema) |
| 5 | Cumpleaños | `club_clics_enlaces`, `/ir/{codigo}`, link corto en el WhatsApp del Inicio. | Sí + validación física |
| 6 | Después | Portal del referente (cuando tenga «Reservar») y **cumpleaños automático por Wallet (§13)**. | Sí (§13) |

Cada PR: batería antes de aplicar (base local), staging, verificador independiente, y recién ahí la firma. Los PR 1, 2, 4
y 5 necesitan #220 en `main` (campañas).

## 10. Pruebas y baterías

- **SQL** (`scripts/sql/NNN_pruebas.sql`, transacción descartada, con mutaciones): `anon` sin portón → rechazado; token o
  código inválido → `{ok:true}` y cero filas; grupo y local salen del servidor aunque el navegador mande otros; rebote y
  tope por credencial; manager de otro local → 42501; cajero, contador e inactivo → 42501; el job es idempotente (dos
  corridas = mismos totales); **no borra** si los totales no coinciden; borra a los 13 meses y los totales quedan
  iguales; baja → `miembro_id` null; medianoche en hora CR; import repetido no duplica.
- **Catálogo:** ninguna columna de las tablas nuevas se llama ni contiene IP, agente, referer o URL; ninguna política
  para `anon`.
- **club-web (vitest):** el beacon no llama a `preventDefault`; con `sendBeacon` que falla o no existe el `href` no cambia;
  `/ir/` redirige con la base caída; textos en «usted»; huella del aviso v1.4.
- **App:** formato del embudo, año anterior vacío → «sin dato», CSV con columnas en otro orden, en inglés, con filas de
  otra campaña y con datos personales que **no** aparecen en lo que se envía.
- **Staging:** recorrido real (portal, cupón, cumpleaños) y lectura de `club_clics` por el verificador.

## 11. Riesgos

| Riesgo | Mitigación |
|---|---|
| El link `/ir/` depende de nuestro dominio | Tiempo máximo + página de respaldo; decisión D3 |
| Inflar clics a mano o con un bot | Topes de §5; el reporte muestra únicos además de clics |
| Leer mal el paso «reserva» (no es por persona; el widget no deja clic) | Texto fijo en la pantalla; tasas marcadas como «por campaña» |
| El dueño no carga el CSV | Fecha de la última carga a la vista; aviso en el Inicio si pasan más de 35 días (fase 4) |
| El formato del export de OpenTable cambia | Lectura por encabezado; falla con mensaje claro, no carga a medias |
| Días con 1 o 2 clics permiten deducir quién fue | Solo gerencia ve totales; sin nombres ni cruce por persona en ninguna pantalla |
| Borrado antes de agregar | El job compara sumas y no borra si no coinciden; batería con mutación |
| Cambiar funciones públicas (158/167) | Copia exacta + una línea; md5 antes y después; rollback escrito |

## 12. Decisiones abiertas para el dueño

| # | Decisión | Opciones | Recomendación | ¿Firma? |
|---|---|---|---|---|
| D1 | Aviso de privacidad v1.4 | A) aprobar el texto de §8 · B) cambiarlo | **A**, con lectura previa de quien asesora en Ley 8968 | **Sí** |
| D2 | Socios que aceptaron v1.3 o anterior | A) sus clics se guardan **sin ligar** hasta que acepten la v1.4 con un aviso en el portal · B) ligar a todos y avisar por WhatsApp · C) ligar sin avisar | **A**: se pierde algo de cruce al principio, sin riesgo legal | **Sí** |
| D3 | Clic del WhatsApp de cumpleaños | A) link corto del Club que registra y redirige · B) link directo a OpenTable (sin clic; solo la campaña) | **A**, con página de respaldo | Sí (ve el cliente) |
| D4 | Ventana clic → llegada | 14 · **30** · 60 días | **30** (configurable por el dueño) | No (OK por chat) |
| D5 | Reservas de OpenTable en la base | A) solo totales por día, campaña y estado · B) una fila por reserva, sin datos del comensal | **A**: mínimo de datos | Sí (esquema) |
| D6 | Dónde va la pantalla | A) dentro de «Embudo» · B) pestaña nueva | **A** | No |
| D7 | Contador | A) no ve · B) ve totales en el Tablero | **A** por ahora | No |
| D8 | Cada cuánto se carga el CSV | Semanal · **mensual** (día 1 a 5) | **Mensual**, con recordatorio | No |
| D9 | Hallazgo 232 en el resto del portal | A) aplicar el mismo esquema de topes (credencial + IP) en un PR aparte · B) dejarlo en backlog | **A**, después de la fase 1 | Sí (toca la API pública) |

## 13. Cumpleaños automático (decisión del dueño, 16-nov, opción A)

La app detecta el cumpleaños del socio y le manda un aviso directo al **pase de Wallet** (Google primero; Apple cuando
apruebe). Se enciende cuando Google apruebe el acceso de publicación. Sin WhatsApp Business API (descartada por ahora).
Igual que el resto de este SPEC: no autoriza código; cada pieza lleva su firma.

**Qué no cambia (173 y 175):** una vez por socio y por **año del cumpleaños**, en cualquier local; la marca la hace la
caja sobre la visita (`club_cumple_usar`); solo el owner la deshace; la caja nunca ve la fecha; la cortesía sigue siendo
el artículo «CORTESÍA CLUB» a ₡0. Solo socios activos con cumpleaños **y permiso** (`cumple_permiso_en`).

**Cuándo se dispara.** Job diario (`pg_cron`, 15:00 UTC = **09:00 CR**). Toma a los socios cuyo próximo cumpleaños cae
en `aviso_dias_antes` días (columna nueva en `club_cumple_config`, propuesta **5**; ver C1), con la configuración del
**local del socio** (`club_miembros.location_id`: encendido, texto, mínimo de personas, link de reserva). Si el job no
corrió un día, al siguiente avisa a quien quedó pendiente mientras falte para el cumpleaños; nunca avisa después.
**Una vez por año:** usa la misma marca de hoy, `club_cumple_envios` (PK socio + año), con dos columnas nuevas: `canal`
(`whatsapp` | `wallet`) y `vence_dia`. El job deja el pedido en la cola del pase (`club_alertas`, contrato de
`CONTRATO-pase.md`) y la marca se escribe **recién cuando la Edge confirma el envío**. Con la marca puesta, ni el job ni
el botón manual vuelven a avisar.

**Texto del aviso** (pase; pasa por `src/shared/wallet/usted.test.ts`; `{beneficio}` y `{N}` salen de la configuración):
- **ES** — «¡Feliz cumpleaños! Se acerca su día y queremos celebrarlo con usted. Si reserva y nos visita en los próximos
  7 días, recibe {beneficio}. Mesas de {N} personas o más. Reserve aquí: {link}»
- **EN** — "Happy birthday! Your day is coming up and we would love to celebrate with you. Book and visit us within the
  next 7 days to receive {beneficio}. For tables of {N} or more. Book here: {link}"
- `{link}` = `/ir/{codigo}` (§5) con origen `wallet` y grupo `cumpleanos`: registra el clic y abre el OpenTable del local
  del socio con la campaña `cumpleanos` (#220). La línea de mesas se omite si el mínimo es 1.

**Cambio de regla del beneficio.** Para el socio **avisado por el pase**, la ventana deja de ser «días antes y después
del cumpleaños» y pasa a ser **el día del aviso + 7 días** (`vence_dia`, día de Costa Rica). `club_cumple_en_caja_dia`
responde `aplica` solo dentro de esa ventana; afuera, `{"aplica": false}` como hoy. El socio **sin aviso por el pase**
sigue con la ventana de la 173 (ver C2).

**Cómo se verifica la reserva.** El widget y el link de OpenTable no dejan rastro por persona, así que la reserva
**no se puede comprobar por socio en la base**. Lo robusto es separar dos cosas:
- **Lo que decide el servidor:** que haya una **visita registrada en caja** dentro de la ventana y que no haya marca del
  año (índice único de la 175). Eso no se puede saltar.
- **Lo que confirma el cajero:** que la mesa vino con reserva y cumple el mínimo de personas, como hoy con «solo con
  reserva»; el recuadro de Escanear se lo recuerda con el día de vencimiento («vale hasta el …», sin la fecha del
  cumpleaños).
- **OpenTable, campaña `cumpleanos`:** solo por **totales**, para el embudo y como control: si en un mes las marcas de
  uso superan por mucho a las reservas de la campaña, sale en «Excepciones». No bloquea ninguna cortesía.

**Quien no tiene pase** (o el envío falló, o el pase es de Apple antes de la aprobación): no cambia nada. Aparece en el
bloque del Inicio con el botón manual de WhatsApp (173), que usa el link corto con origen `cumple_whatsapp`.

**Qué ve el equipo en el Inicio** (owner y manager de sus locales): el bloque «Cumpleaños en los próximos N días» queda
igual para los pendientes de WhatsApp, y suma una línea de solo lectura: «Avisados por Wallet: X» con el día de
vencimiento de cada uno y «vino / no vino». Sin fecha de cumpleaños. Un envío que falló vuelve solo a la lista manual.

**Medición en el embudo** (grupo `cumpleanos`, por local y por canal `wallet` | `whatsapp`):

| Paso | Fuente | Nota |
|---|---|---|
| Aviso | `club_cumple_envios` por canal → total diario en `club_clics_totales` (tipo `aviso`) | Por persona, 13 meses; después totales |
| Clic | `club_clics` (origen `wallet` o `cumple_whatsapp`, tipo `reservar`) | Por persona |
| Reserva | `club_reservas_ot`, campaña `cumpleanos` | Por totales; no distingue canal |
| Llegada | `club_cumple_usos` vigente dentro de la ventana | Por persona |

**Dependencias.** (1) Aprobación de publicación de Google Wallet. (2) La Edge `club-pase` vive fuera de `main` por la
regla 2 hasta cerrar el ítem 11 (PR #61): el envío se construye en `claude/club-pase-edge` y se despliega a mano, o
espera al ítem 11. (3) Fase 5 de §9 (`club_clics_enlaces`, `/ir/`) y #220 en `main`. (4) Migración con firma: columnas
de `club_cumple_envios` y `club_cumple_config`, job y cambio de `club_cumple_en_caja_dia` (copia exacta + la regla
nueva; baterías de la 173 y la 175 verdes; medianoche CR; 29-feb; cruce de fin de año). (5) Aviso de privacidad (C4).
(6) Guía `docs/sop-app/6.13` en el mismo PR. En §9, esto es la fase 6.

**Decisiones abiertas**

| # | Decisión | Opciones | Recomendación | ¿Firma? |
|---|---|---|---|---|
| C1 | Cuántos días antes sale el aviso | A) 7: la ventana termina el día del cumpleaños · B) **5**: cubre hasta 2 días después · C) 3: poco tiempo para reservar una mesa grande | **B**, configurable por local | Sí (regla de cortesía) |
| C2 | Ventana de quien no recibió el aviso por el pase | A) sigue la de la 173 (antes y después del cumpleaños) · B) 7 días desde el WhatsApp manual · C) sin aviso no hay beneficio | **B** cuando el pase lleve un mes andando: una sola regla; mientras tanto **A** | Sí |
| C3 | «Con reserva» | A) lo confirma el cajero; OpenTable solo controla por totales · B) el cajero anota el número de confirmación · C) esperar a una API de OpenTable | **A**: sin fricción en caja y sin datos nuevos | Sí |
| C4 | Aviso de privacidad | A) sumar a la v1.4 (§8) que el aviso de cumpleaños puede llegar al pase · B) dejar la v1.3 (solo nombra WhatsApp) | **A**, en la misma lectura legal de D1 | **Sí** |
| C5 | Construir antes del ítem 11 | A) en `claude/club-pase-edge`, despliegue a mano · B) esperar al ítem 11 | **A** solo en staging; a prod con el ítem 11 cerrado | Sí (Edge en prod) |
| C6 | Hora del aviso | **09:00** · 11:00 · 17:00 (hora CR) | **09:00**: se lee antes de planear el día y lejos del servicio | No (OK por chat) |
