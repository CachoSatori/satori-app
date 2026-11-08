# Avance · Local Club y pase de Wallet

> Lo actualiza cada sesión al cerrar una etapa (también las nocturnas). Plan: [PLAN-LC-lanzamiento.md](PLAN-LC-lanzamiento.md).
> Contrato: [CONTRATO-pase.md](CONTRATO-pase.md). Rama: `claude/epic-tesla-pyo77m` (PR #59). **Solo staging.**
> Estados: **pendiente** · **en curso** · **hecha**. Pruebas: batería (`scripts/sql/075_pruebas_staging.sql`), carreras,
> paridad, vitest.

## Sesión A · Local Club (075, caja, excepciones, pantallas)
| Etapa | Qué | Días | Estado | SHA | Pruebas |
|---|---|---|---|---|---|
| A1 | Roles, QR fijo del socio, activar como anfitrión, stub del contrato del pase | 2 | **hecha** | `a1e93db` | batería 294/294 (nuevas 53–56) · carreras 6/6 · paridad 602 = 602 · migrador 15/15 · vitest 1.487 |
| A2 | Socios: alta provisional + confirmación, autoalta (Turnstile, topes, purga, privacidad), validación, token de pase, cursor | 2,5 | **hecha** | `838b892` | batería 318/318 (nueva 57, 24 casos) · carreras 7/7 (nueva 17) · paridad 633 = 633 · migrador 15 OK · vitest 1.490 · club-web 13/13 |
| A3 | Promociones mínimas + productos + admin de cortesías del sorteo | 2 | **hecha** | `fc53012` + `600b868` | batería 351/351 (nueva 60, 18 casos) · carreras 8/8 · paridad 717 = 717 · vitest 1.491 · build OK · migrador 15 OK · captura de la pantalla |
| A4 | «Qué aplicar», sorteo de cortesía, visita por factura (856), premio por referir (1.ª factura C con 856), topes, antiautocanje, créditos pendientes, portal con dos pestañas | 4,5 | **hecha** | `ea6c34f` · `9372d33` · `2c8b324` · `95391be` · `60c0be7` | batería 385/385 (nuevas 63–66) · carreras 8/8 · paridad OK · vitest 1.491 · portal verificado en el navegador |
| A5 | Excepciones LC (11) + «pendiente de configuración» de R02 + reporte de altas por cajero | 2,5 | **hecha** (en el día, 08-nov) | `6b037fa` | batería 404/404 (nueva 67, 19 casos) · carreras 8/8 · paridad OK · vitest 1.491 · excepciones de 120 días en ~3 s |
| A6 | Recorrido, guía de uso, RUNBOOK | 1,5 | pendiente | — | — |

## Sesión B · pase de Wallet (Google; Apple apagado)
| Etapa | Qué | Días | Estado | SHA | Pruebas |
|---|---|---|---|---|---|
| B1 | Edge `club-pase`: JWT «Save to Google Wallet», clase y objeto | 1,5 | **hecha** (rama `claude/club-wallet`, sin desplegar) | `adfa208` | 20 pruebas nuevas (vitest 1.511) · build OK · eslint y tsc limpios · humo con datos reales de staging (solo lectura) |
| B2 | Botón en el portal y en la autoalta | 0,5 | **hecha** (apagada por flag `VITE_WALLET_GOOGLE`) | `5bede8d` | API club-web 15/15 · build y tsc limpios |
| B3 | Sincronización por eventos, mensajes de canje, baja | 1,5 | **en curso** (núcleo + rutas del Edge) | `f3f53d9` + `2654b7e` | 10 pruebas nuevas (wallet 29) |
| B4 | Apple apagado | 1,5 | pendiente | — | — |
| B5 | Integración real, código de barras según el rol, prueba en teléfono | 1,5 | pendiente | — | — |

## Bitácora
- 07-nov · Plan aprobado (6c1a5fb) con ajustes. Arranca A1.
- 07-nov · **A1 hecha** (`a1e93db`).
  - **Roles:** `club_miembro_roles` es la fuente de verdad; `club_miembros.tipo` queda como espejo del rol de anfitrión
    ('socio' si no tiene). Las funciones que preguntan por `tipo` siguen igual.
  - **QR del socio:** `/s/` + 9 caracteres, solo identifica. «Activar como anfitrión»: owner o manager, con nota.
  - **Contrato del pase:** stub listo para B. `club_pase_datos` da datos reales de anfitriones; para socios, `beneficio`
    null, `cortesias` [] y `visitas_mes` 0 hasta A3/A4.
  - **Ojo, sesiones siguientes:** al borrar miembros sintéticos, borrar antes `club_miembro_roles` y `club_pase_eventos`
    (ver `scripts/sql/club_carreras/limpiar.sql`).
  - **Próximo:** A2 (alta en caja, autoalta, validación, premio por referir).
- 07-nov · Segunda tanda de decisiones.
  - **Cortesías:** sorteo; hoy se cobran como artículo de la familia 17 a ₡0.
  - **Tope del anfitrión nuevo:** no bloquea; los créditos ganados que pasan el tope quedan pendientes de aprobación.
  - **Wallet:** Google arranca ya.
  - **Total A: 12,5 días.**
  - **Falta el código de «PROMO CLUB 10%».**
- 08-nov · Tercera tanda (auditoría de Grok, ronda 5).
  - **Total A: 14,5 · B: 7.**
  - **Cola de endurecimiento** en el PLAN, para las noches bloqueadas.
  - **CRM viejo:** plan en PLAN-CRM-cierre.md (lo firma Ismael).
  - **Arranca A2.**
- 08-nov · **A2 hecha** (`838b892`).
  - **Alta en caja** (`club_socio_alta_caja`): nombre, WhatsApp y «verifiqué residencia» obligatorios; email opcional.
    Queda **activo provisional 7 días** (`club_config.socio_provisional_dias`). La confirma en Miembros → Socios →
    «Altas por confirmar» un manager u owner **distinto** de quien la cargó; si no, `club_socios_mantenimiento` la vuelve
    a pendiente.
  - **Autoalta** (`/alta` en club-web → `club_socio_autoalta`): Turnstile + tope por IP en club-web; tope global de
    60 por día en SQL; pendiente hasta la validación en caja («Validar socio» en Escanear, también provisional). Sin
    validar a los 30 días, se purga (contacto y rol borrados; la fila del miembro queda en baja con el nombre borrado,
    porque la auditoría y los eventos la referencian).
  - **Token de pase** (`club_miembros.token_pase`, `/w/`): owner o manager lo revocan o regeneran en la ficha.
  - **Cursor:** `club_pase_cursor_rebobinar` (solo `service_role`, motivo obligatorio, auditado).
  - **Tarea diaria:** `pg_cron` `club_socios_mantenimiento` a las 03:15 CR, programada por la 075 solo si hay
    `pg_cron` (staging sí; en prod se verifica en el paso 4 del RUNBOOK).
  - **DECISIONES PROVISORIAS (las revisa Ismael):**
    1. ~~Texto del aviso de privacidad~~ → **cargado el texto de Ismael como `v1-borrador`** (08-nov; ES/EN en
       `club-web/src/i18n.ts`, versión en `club-web/src/config.ts` y en `club_config`, staging incluido). Falta el
       **correo de contacto** (hoy `‹correo›`/`‹email›`): cuando llegue, se reemplaza y se sube la versión el mismo día.
    2. La respuesta de la autoalta es pareja: si el WhatsApp ya es socio no se dice; si la persona ya existía (por
       ejemplo, un socio en baja que vuelve) queda pendiente **sin** devolver su portal.
    3. Topes: 60 autoaltas por día, purga a 30 días, provisional 7 días (los tres en `club_config`).
    4. El referido (`?ref=`) se guarda en `referido_por`; el premio nace en A4 (primera factura C con el 856).
  - **Necesita a Ismael:** widget de Turnstile en Cloudflare (`VITE_TURNSTILE_SITEKEY` y el Secret `TURNSTILE_SECRET`);
    en staging alcanzan las claves de prueba de Cloudflare.
  - **Guía de uso** (`docs/sop-app/`): el Club todavía no tiene guía; va en A6 con el recorrido.
  - **Próximo:** A3 (promociones mínimas + productos + admin de cortesías).
- 07-nov (noche) · Decisiones «1b» consolidadas al principio del PLAN (cortesías por sección «CORTESÍA CLUB», tope sobre
  lo ganado, Google ya / Apple apagado, PROMO CLUB 10 % pendiente de código, Turnstile de prueba en staging).
  Sesiones nocturnas programadas en esta sesión: 01:00 (A3), 02:30 (B1 en `claude/club-wallet`), 04:30 (integración).
- 08-nov (antes de la 01:00) · Tanda «pre» de la cola de endurecimiento: **CLUB-AUD-36** (`3e294a5`), **R02 pendiente de
  configuración** (`8a76ed8`), **CLUB-AUD-68** (`f3b65cb`, con `estado = 'C'`) y **CLUB-AUD-38** (`2b306ff`). Batería
  324/324, carreras 8/8, paridad 633 = 633. Detalle: [NOCHE-2026-11-08-pre.md](NOCHE-2026-11-08-pre.md). **La 01:00 no los
  repite** (marcados como hechos en la cola del PLAN).
- 08-nov (antes de la 01:00) · Tanda «pre2» (Grok sobre `0b40cec`): **CLUB-AUD-71** (`64d969a`), **72** (`208cdc2`),
  **73** (`b6ab9b3`) y **74** (`80cbfa3`, sin desplegar). Batería 333/333, carreras 8/8, paridad 651 = 651. Detalle:
  [NOCHE-2026-11-08-pre2.md](NOCHE-2026-11-08-pre2.md). Tachados en la cola del PLAN: **la 01:00 no los repite**.
- 08-nov 01:00 · **A3 hecha** (sesión nocturna A). SQL `fc53012`, pantalla `600b868`. Detalle:
  [NOCHE-2026-11-08-A.md](NOCHE-2026-11-08-A.md). **Próximo: A4** (motor «qué aplicar», sorteo, visita por factura).
- 08-nov 01:00 (cont.) · Con el tiempo que sobró: **CLUB-AUD-42** hecho (`5b441c9`) y **CLUB-AUD-43 parcial** (`3439244`;
  falta la lista W1–W14 de Grok). Batería 354/354, carreras 8/8, paridad 724 = 724.
- 08-nov 01:00 (cont.) · Puente, sin desplegar: **CLUB-AUD-46/47/48** (`831b3ee` en `claude/puente-item11`). 44/45 no
  arrancada (necesita migración nueva). Cola del PLAN al día.
- 08-nov 02:30 · **B1 hecha** en `claude/club-wallet` (`adfa208`), **sin desplegar**. Detalle:
  [NOCHE-2026-11-08-B.md](NOCHE-2026-11-08-B.md). Próximo de B: B2 (botón en el portal y en la autoalta).
- 08-nov 02:30 (cont.) · **B2 hecha** (`5bede8d`): «Agregar a Google Wallet» en el portal y al final de la autoalta,
  **apagado por flag** hasta desplegar el Edge. Próximo de B: B3 (sincronización por eventos, mensajes, baja).
- 08-nov 02:30 (cont.) · **B3 núcleo** (`f3f53d9`): sincronización pura (token OAuth, PATCH por miembro, mensajes de
  canje, cursor). **Falta:** la ruta del Edge y el programador (cada 2 min), «Actualizar mi pase», y una función de A
  que liste los pases emitidos (para los eventos globales de promociones).
- 08-nov 02:30 (cont.) · B3: rutas `sync` y `actualizar` del Edge (`2654b7e`). Faltan el programador y la función de A.
- 08-nov 04:30 · **Integración** en `claude/club-integracion` (= epic-tesla + club-wallet, sin conflictos). Corte para la
  auditoría: **`5fd7ab1`**. Batería 354/354, carreras 8/8, paridad 724 = 724, vitest 1.521, builds OK, migrador 15 OK.
  Staging en base. Resumen y «necesita a Ismael»: [NOCHE-2026-11-08-RESUMEN.md](NOCHE-2026-11-08-RESUMEN.md).
- 08-nov (día) ·
  - **Anotaciones de B traídas a epic-tesla** (`901026b`).
  - **`club_pases_emitidos()`** (`490451d`, prueba 62); B3 ya la usa para los eventos de promociones (`5f759ad`, club-wallet).
  - **Puente CLUB-AUD-44/45** (`9461731`, sin desplegar): mig 082 `pos_ndf_ingestar` (una transacción + lock por local);
    carrera de dos POST de la misma factura: antes 6 líneas, ahora 3. **44 a 48 están juntos** en `claude/puente-item11`.
  - **Diseño del pase** propuesto (`b5d6a33`, club-wallet; lo aprueba Ismael).
  - **A4 hecha**:
    - A4.1 visita del socio y «qué aplicar» (sorteo fijo, tope por día, regla de créditos, antiautocanje);
    - A4.2 Escanear;
    - A4.3 premio por referir;
    - A4.4 créditos pendientes de aprobación del anfitrión nuevo;
    - A4.5 portal con dos pestañas y pase completo.
  - Lo que depende de los códigos de CORTESÍA CLUB o de PROMO CLUB 10 % sale «pendiente de configuración».
  - **DECISIONES PROVISORIAS:**
    1. A4.4: el cupón que pasa el tope va entero a pendientes (no se parte la visita).
    2. La aprobación la hace alguien distinto de quien registró el cupón (no hay vínculo miembro ↔ usuario para
       chequear «distinto del anfitrión» cuando el anfitrión es del equipo).
    3. Premio: un referido da a lo sumo un premio; lo que no lo da queda anotado con el motivo y no se reevalúa.
    4. Visita: la caja elige el pedido como con el cupón; el cruce con el 856 se hace después (A5).
  - **Próximo:** A5 (excepciones).
- 08-nov (día, tarde) ·
  - **Ledger de staging:** la 082 tiene su fila, con texto idéntico al archivo (md5 `5db915c8…`).
  - **RUNBOOK:** (reemplazado el mismo día por la regla de numeración del 08-nov: ver abajo) la migración del Club iba como **086** (paso 3b: renombre, ledger de staging, pruebas y
    rollback; **no ejecutado**).
  - **A5 hecha** (`6b037fa`): 11 excepciones del Local Club y reporte de altas por usuario. Con datos reales de staging
    (120 días): 275 `LC_SIN_REGISTRO` (el LC se cobra sin la app) y 310 `DESCUENTO_SIN_RESPALDO`. Por eso existe
    `lc_excepciones_desde` (RUNBOOK 8b).
  - **DECISIONES PROVISORIAS:**
    1. El 857 «INVITADO» no está en `articulos_cero_permitidos` hasta que Ismael diga qué marca, así que hoy sale como
       `CORTESIA_NO_CONFIGURADA` cuando hay sección.
    2. `DESCUENTO_SIN_RESPALDO`: umbral de 1 % por debajo de la moda; ante un empate de modas, se toma el precio más
       alto.
    3. `REGISTRO_LC_SIN_856` y `CORTESIA_DISTINTA` solo miran visitas ya cruzadas con su factura (la que no cruzó
       todavía no salta).
  - **Próximo:** A6 (recorrido, guía de uso y RUNBOOK).
- 08-nov (día, 857 y autorrevisión) ·
  - **857 «INVITADO»** (`56b1d6d`): cuenta igual que el 856 en todas las reglas. Máximo de invitados por visita
    configurable (`lc_invitados_max`, 3) y excepción `LC_INVITADOS_EXCEDIDOS` cuando se pasa. Prueba 68.
  - **main en las ramas:** traído a `claude/epic-tesla-pyo77m` y a `claude/club-wallet` (test de numeración 5/5).
    **`claude/puente-item11` NO:** arrastra 403 commits de otros frentes desde su base con main (PoS F1–F3, salarios,
    propinas…), con 17 conflictos en código ajeno al puente. Se abortó el merge (la rama quedó como estaba). Lo propio del
    puente son unos 46 archivos (`supabase/functions/ingest-ndf`, `src/shared/ndf`, la 082, `scripts/sql/puente_carreras`).
    Propuesta para Ismael: armar `claude/puente-item11-v2` desde main con solo esos archivos.

### Autorrevisión adversarial (A4, A5 y el 857) — qué puede hacer de más cada actor
| Actor | Qué podría intentar | Qué lo frena hoy | Hueco / acción |
|---|---|---|---|
| Anónimo | Leer visitas, premios, excepciones, pendientes | Tablas sin grants; funciones solo `authenticated` con rol; club-web solo las puertas públicas | — |
| Socio | Prestar su QR a otro en otra mesa el mismo día | 1 visita por día (la caja ve «ya registró su visita de hoy»); la otra factura con el 856 sale `LC_SIN_REGISTRO`; `SOCIO_USO_ANOMALO` si se registran dos mesas | La caja igual podría cobrar el 10 %: la detección es posterior |
| Socio | Autorreferirse con otro teléfono | Premio solo con la 1.ª factura C con el 856; tope por referente y por validador | Un segundo teléfono real no se detecta (límite del diseño) |
| Anfitrión | Usar su cupón en su propia mesa de socio | Bloqueo en `club_cupon_usar` + `CUPON_AUTOREFERIDO` si se cuela | — |
| Anfitrión nuevo | Ganar mucho en el mes | Retención sobre ₡25.000 (primeros 90 días) + `ANFITRION_SOBRE_TOPE` | Partir en varios cupones no lo esquiva (cuenta el acumulado del mes) |
| Invitado | Más acompañantes que lo permitido | `LC_INVITADOS_EXCEDIDOS` (posterior) | La caja no lo bloquea (la app no toca el PoS) |
| Cajero | Registrar visitas falsas para justificar un 856 | `SOCIO_USO_ANOMALO`, reporte de altas por usuario, auditoría | **Falta un reporte de visitas por usuario** (propuesta para A6) |
| Cajero | Alta en caja de un «socio» inventado | Provisional 7 días; `SOCIO_ALTA_SIN_CONFIRMAR`; lo confirma otro; reporte de altas | — |
| Manager | Resolver la excepción de un descuento que dio él en el PoS | **Hueco cerrado hoy:** las que salen solo del PoS (sin registrante en la app) las resuelve el owner (prueba 68) | DECISIÓN PROVISORIA: más trabajo para el owner |
| Manager | Aprobar personas pendientes de un cupón que registró él | Lo bloquea la base («lo registraste vos») | No se puede chequear «distinto del anfitrión» si el anfitrión es del equipo (no hay vínculo miembro ↔ usuario) |
| Manager | Editar promociones o cortesías | Solo el owner | — |

- 08-nov (tarde, ajustes de Ismael) ·
  - **857 sin límite** (`bd6786e`): sale `lc_invitados_max` y la excepción `LC_INVITADOS_EXCEDIDOS`; el resto del 857
    queda igual. Reemplaza lo de arriba.
  - **Grok 90/91/93** (`bd6786e`, prueba 69): socio que ya usó su beneficio hoy en otro pedido → «ya_uso_hoy», «NO
    aplicar beneficio», tarjeta en rojo; un socio con beneficio por factura (`socios_por_factura`, 1) → el segundo va
    como invitado (857) y el % se aplica una sola vez; `club_pendiente_resolver` revalida anfitrión activo, factura no
    anulada (X) y cupón vigente antes de aprobar.
  - **Segregación por login del PoS** (`985991e`, prueba 68): las excepciones que salen del PoS miran el login de quien
    cobró (cajero/salonero) mapeado en Empleados (`pos_login`); ese empleado no la resuelve; si el login no está mapeado,
    solo el owner. Reemplaza la DECISIÓN PROVISORIA de arriba.
  - **Numeración** (`bacb200`): el renombre del pase va al bloque de PASE 150–199, nunca a 100–149. Hoy la 081 y la
    082 entran con su número si van primero y la 075 tomaría la 150. No se renombró nada.
  - **Puente** (`claude/puente-item11-prod` @ `e4678b3`): cherry-pick de `831b3ee` y `9461731` (sin conflictos;
    `mapTicket.ts` idéntico, roster y GreenSeason intactos) + Grok 99 en `puente_carreras/pruebas.sql` (11/11). Sin deploy.
    Se descarta `puente-item11-v2`. **PAQUETE DE PASE para firma:** `docs/club-satori/PAQUETE-PASE-puente.md` (`9c5975b`).
  - **Aviso de privacidad `v1-borrador`** (`e38fd49`): texto de Ismael ES/EN en club-web, versión en club-web, 075 y
    staging. Falta el correo de contacto.
  - **Diseño del pase** (club-wallet `61dc7de`): el daruma no está en el repo; maqueta v2 con 悟 y franja «SATORI · CLUB».
    Sigue apagado hasta el OK.
  - Pruebas: batería 421/421 · paridad 829 = 829 · carreras 8/8 · club-web 14/14 · ndf 203/203 · wallet+club 51/51.

### Autorrevisión adversarial (ajustes del 08-nov tarde)
| Actor | Qué podría intentar | Qué lo frena hoy | Hueco / acción |
|---|---|---|---|
| Socio | Usar el beneficio en dos pedidos el mismo día | La segunda llamada devuelve «ya_uso_hoy» sin crear visita; la caja ve rojo | Si la caja igual cobra el %, sale `DESCUENTO_SIN_RESPALDO`/`LC_SIN_REGISTRO` (posterior) |
| Socio | Dos socios en la misma factura para sumar % | `socios_por_factura` = 1: el segundo sale «como_invitado», sin % ni cortesía | Configurable hasta 10: si el owner lo sube, el % se sigue aplicando una vez (lo controla la caja) |
| Invitado | Muchos 857 en una factura | Ya no hay tope (decisión de Ismael) | Sin excepción por cantidad: queda a criterio de caja |
| Anfitrión | Que le aprueben personas de un cupón anulado o de una factura anulada | `club_pendiente_resolver` revalida cupón, factura X y anfitrión activo antes de aprobar | — |
| Cajero | Resolver la excepción de una factura que cobró él | Su login del PoS mapeado a su usuario lo bloquea | Logins compartidos (p. ej. el de turno) sin mapear → solo el owner: más trabajo para el owner |
| Manager | Resolver una excepción de una factura que cobró él | Igual que el cajero, por login del PoS | Si cobró con el login de otro, no se detecta (límite del PoS) |
| Operador del pase a prod | Correr el Edge nuevo sin la 082, o soltar la 082 con el Edge nuevo arriba | Paquete con orden fijo y rollback «Edge anterior antes del drop» | Requiere la copia del Edge actual antes de empezar (paso 0) |

- 08-nov (tarde 2, Ismael: multilocal y pase del puente) ·
  - **Multilocal** (`8e4299a`): el Club corre por local y encender uno es un dato (`club_config.club_activo`). Nosara
    cargado y **apagado**. Selector de local en la app (solo con más de uno), pestaña **Locales** del owner con el
    interruptor (auditado), club-web manda el local (`?local=` o elegido). Prueba 70 (17 casos): local sintético
    apagado → encendido → apagado, y ninguna función `club_*` nombra un local. RUNBOOK paso 11: checklist «Encender un
    local». club-wallet: la franja del pase dice «Satori · Club» (`8f5dd4f`).
    **DECISIÓN PROVISORIA:** un socio o anfitrión pertenece a un local (el de Santa Teresa no tiene beneficio en Nosara).
    **Queda:** el `default 'santa-teresa'` de `location_id` en las tablas (lo usan solo el migrador y la batería).
  - **Relevamiento fuera del Club:** `docs/MULTILOCAL-relevamiento.md` (solo lista; caja y propinas no tienen local).
  - **Puente:** `docs/puente/PASE-PROD-2026-11-09.md` en `claude/puente-item11-prod` (`40370cc`), para la firma del lunes;
    carreras y pruebas del puente en verde con el SHA fijo `e4678b3`. La 085 espera al puente.
  - **PR #64** mergeado (`1e28444`) con el OK de Ismael; ledger de prod en `080` antes y después.
  - Pruebas: batería 438/438 · paridad 840 = 840 · carreras OK · vitest 1.496 · club-web 14/14 · wallet + club 51/51.

### Autorrevisión adversarial (multilocal)
| Actor | Qué podría intentar | Qué lo frena hoy | Hueco / acción |
|---|---|---|---|
| Anónimo | Darse de alta en un local apagado o inventado (`local` en la autoalta) | `club_local(..., true)`: el local tiene que existir y estar encendido; el proxy solo deja pasar ids `^[a-z0-9-]{2,40}$` | `club_locales_activos` muestra los nombres de los locales encendidos (dato público) |
| Socio | Usar su QR en el otro local | La visita exige el Club encendido en SU local y busca el pedido en su local | DECISIÓN PROVISORIA: no hay Club compartido entre locales |
| Anfitrión | Generar cupones con el local apagado | `club_cupon_crear` exige el Club encendido en su local | — |
| Cajero | Operar en un local apagado eligiéndolo en un navegador viejo | El selector solo muestra locales encendidos (salvo al owner) y la base rechaza igual | — |
| Manager | Encender un local | RLS de `club_config`: solo el owner (prueba 70) | — |
| Owner | Encender Nosara sin preparar códigos ni topes | Confirmación con el aviso del checklist | Es una decisión suya; el checklist del RUNBOOK es la guía |
| Cualquiera | Una pantalla que llame sin local con dos encendidos | La base pide elegir; nunca supone uno | Un acceso del inicio (alertas del Club) usa el último local elegido en ese navegador |

- 08-nov (tarde 3, Ismael: genérico, aviso v1, marcadores) ·
  - **Aviso de privacidad v1** (`30b1de5`): texto final, sin ubicación, con el correo de contacto; versión `v1` en
    club-web, en la 075 y en staging; cada alta guarda la versión aceptada.
  - **Marcadores de descuento** (`190ab94`): lista configurable por local (código del PoS, nombre, % esperado, activo);
    DESCUENTO_SIN_RESPALDO y CANJE_CON_DESCUENTO la usan. Pestaña **Descuentos** (owner edita; manager y contador ven).
    Prueba 71.
  - **Multilocal GENÉRICO** (`37deeee`): ningún local escrito en la 075, la app del Club, club-web, el pase ni el
    migrador. Alta de un local con un INSERT o desde la app (sembrada sola: marcadores y promo en borrador), encender
    con un click. RUNBOOK pasos 4b (alta de los locales en prod) y 11 (genérico). Prueba 72: local nuevo → encender →
    visita real con su 10 % → apagar. Puente: `claude/puente-locales-genericos` (`37ffcfb`), para después del lunes.
  - Pruebas: batería 456/456 · paridad 863 = 863 · vitest 1.497 · club-web 14/14 · wallet + club 51/51 · puente
    genérico 471/471 · migrador 15 OK.

### Autorrevisión adversarial (genérico, aviso v1, marcadores)
| Actor | Qué podría intentar | Qué lo frena hoy | Hueco / acción |
|---|---|---|---|
| Owner | Cargar como marcador un artículo cualquiera para tapar descuentos | Es su decisión; queda auditado (`marcador_alta`/`marcador_edicion`) y CANJE_CON_DESCUENTO sigue saltando con créditos | Un marcador sin % respalda cualquier descuento: preferir cargarlo con su % |
| Manager | Cargar o apagar un marcador para que no le salga una excepción | Solo el owner (prueba 71) | — |
| Cajero | Usar un marcador de % en una factura con más descuento | Con % esperado, el descuento distinto (±1,5 puntos) sigue saliendo (prueba 71) | — |
| Cajero | Marcar el artículo de otro local | Los marcadores son por local (prueba 71) | — |
| Manager | Dar de alta un local o encenderlo | Solo el owner (pruebas 70 y 72) | — |
| Cualquiera | Insertar datos del Club sin local con dos locales encendidos | El default de `location_id` exige un único local encendido; si no, falla | — |
| Anónimo | Aceptar un aviso viejo | La autoalta exige la versión vigente (`v1`) | — |
