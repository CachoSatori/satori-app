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
| A6 | Recorrido, guía de uso, RUNBOOK | 1,5 | **hecha** (en el día, 08-nov) | `a1d19b6` · `1701776` + guía | batería 460/460 (nueva 73) · paridad OK · recorrido p12 4/4 (owner) · guía `docs/sop-app/6.13 Club Satori.md` |

## Sesión B · pase de Wallet (Google; Apple apagado)
| Etapa | Qué | Días | Estado | SHA | Pruebas |
|---|---|---|---|---|---|
| B1 | Edge `club-pase`: JWT «Save to Google Wallet», clase y objeto | 1,5 | **hecha** (rama `claude/club-wallet`, sin desplegar) | `adfa208` | 20 pruebas nuevas (vitest 1.511) · build OK · eslint y tsc limpios · humo con datos reales de staging (solo lectura) |
| B2 | Botón en el portal y en la autoalta | 0,5 | **hecha** (apagada por flag `VITE_WALLET_GOOGLE`) | `5bede8d` | API club-web 15/15 · build y tsc limpios |
| B3 | Sincronización por eventos, mensajes de canje, baja | 1,5 | **casi hecha**: núcleo, rutas del Edge, baja (EXPIRED) y **Grok 75** (un miembro con error no traba el cursor). Falta: la tabla de reintentos (propuesta, fuera de la 075) y el programador (**cron apagado**) | `f3f53d9` + `2654b7e` + `7bc5532` | wallet 43 (8 del Grok 75) · propuesta SQL 7/7 en staging (descartada) |
| B4 | Apple apagado | 1,5 | **núcleo hecho** (apagado): pass.json, firma PKCS#7 y .pkpass con WebCrypto. Falta: web service de actualización y cableado (dependen del certificado de Apple) | `f130c37` + `9088aba` | 9 pruebas (openssl cms y zipfile verifican) |
| B5 | Integración real, código de barras según el rol, prueba en teléfono | 1,5 | pendiente | — | — |

**12-nov (decisiones del dueño) · Google Wallet al piloto, sin sincronización automática.** Rama
`claude/wallet-google-main` (PR a `main`, borrador): el pase en `main` sin el Edge (regla 2), textos en «usted», pase
vencido sin roles vigentes, línea «Créditos al …» con la hora de Costa Rica, «Actualizar mi pase» en el portal y link de
«Guardar» corto (la clase y el objeto se crean por la API; el JWT lleva solo los IDs). El Issuer ID sale de `SPEC.md`. El
Edge vive en `claude/club-pase-edge` y se despliega a mano (`WALLET-GOOGLE-ACTIVACION.md` §2). B3 (programador y
reintentos) queda para después del piloto.

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
| Socio | Usar su QR en el otro local | La visita exige el Club encendido en SU local y busca el pedido en su local | ~~DECISIÓN PROVISORIA: no hay Club compartido entre locales~~ **REEMPLAZADO** (08-nov): Club compartido, decisión de Ismael (`677d0cc`); ver `GROK-fichas-75-99.md` |
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

- 08-nov (tarde 4) · **location_id sin default** (Ismael): NOT NULL y SIN default en todas las tablas del Club; nunca se
  asume un local en silencio. El migrador pasa `--local`; la batería declara su local UNA vez (`pg_temp.loc()`, el único
  encendido en staging; si no hay exactamente uno, no arranca) y sus 134 inserciones lo pasan explícito (las carreras,
  sus 4). Prueba 72: ninguna tabla tiene default ni acepta nulo, y una inserción sin local falla (23502).
  Batería 457/457 · paridad 863 = 863 · carreras 8/8 · migrador 15 OK.
  Autorrevisión: el riesgo era un dato del Club cargado en otro local sin que nadie lo note; ahora falla. Un script
  nuevo que inserte sin local se entera en la primera corrida.

- 08-nov (tarde 5) · **A6 hecha** (Ismael: «seguí con A6 hasta el corte»):
  - **Reporte «Visitas de socios por usuario»** (`a1d19b6`): por quien registró la visita: visitas, socios, con
    beneficio, como invitado, con créditos, **sin factura** y máximo de un mismo socio. Cierra el hueco de la autorrevisión
    A4/A5 («falta un reporte de visitas por usuario»). Prueba 73.
  - **Guía de uso** `docs/sop-app/6.13 Club Satori.md` (plantilla de `docs/sop-app/`; escrita contra la rama, el Club no
    está en `main`) e INVENTARIO actualizado. Sin nombres de personas ni locales salvo como dato.
  - **Recorrido p12** (owner, solo lectura): selector de local, Locales con «Nuevo local», Descuentos y el reporte nuevo,
    4/4. Ajuste visual de Locales y del selector a la paleta del módulo (`1701776`). Un texto de la UI nombraba a una
    persona: cambiado a genérico.
  - **Nota para Ismael:** las cuentas de prueba `club-prueba-manager` y `club-prueba-cajero` están **desactivadas** en
    staging desde el 07-nov 18:05 UTC (no las reactivé; el permiso del manager lo cubren las pruebas).
  - **Estimación «Club compartido»:** pasada por chat (≈ 14,5 h; decide Ismael). No se cambió nada. **REEMPLAZADO:** Ismael
    eligió el Club compartido y se hizo (`677d0cc`, `75e5cfc`).

### Autorrevisión adversarial (A6)
| Actor | Qué podría intentar | Qué lo frena hoy | Hueco / acción |
|---|---|---|---|
| Cajero | Registrar visitas falsas a un socio amigo | «Visitas de socios por usuario»: «Sin factura» y «Máx. un socio» por usuario; LC_SIN_REGISTRO / REGISTRO_LC_SIN_856 | La revisión es posterior (semanal) |
| Cajero | Ver el reporte para saber qué se mira | Solo owner y manager (prueba 73) | — |
| Manager | Ocultar sus propias visitas | El reporte agrupa por quien registró, sin filtro por usuario | — |
| Owner | — | — | La guía es borrador: validarla en el local antes de publicarla |
  - **Recorrido integral A6 (paso 13, staging, datos sintéticos, 12/12):** alta en caja (cajero) → autoalta en club-web
    con el código de la socia (aviso v1) → validación en caja → visita con el pedido: «Qué aplicar» 10 % + cortesía →
    el PoS cierra la factura con el 856 → premio para la socia que refirió → su visita aplica la cortesía de premio →
    canje de 1 crédito + factura con el 856 → **«Canje con descuento»** en Excepciones → el owner (otra persona) confirma el
    alta → reportes del mes. Limpieza: staging en 2538 / 338 / 338, sin claves ni datos sintéticos. Capturas en el
    scratchpad de la sesión (no van al repo: muestran datos de staging).
  - Arreglo de texto: «…hasta el {fecha} p. m..» (punto doble) en la validación de socio.
  - **Para Ismael:** el encabezado de club-web usa el kanji 里 (el que dijo que no va en el pase); no se tocó: va con la
    decisión del diseño.

- 08-nov (tarde 6, decisiones de Ismael) ·
  - **Puente:** el pase a prod es el **lunes 09-nov a las 9:00**; `claude/puente-item11-prod` sin cambios de código
    (`e4678b3`), paquete con la hora (`3b13c0d`).
  - **Datos del PoS del local de Santa Teresa** (staging, `2fc5edc`): PROMO CLUB 10 % = `1123` (su marcador se siembra
    solo con 10 % esperado; R02 deja de estar pendiente); sección de cortesías = (clasificación 17, subclasificación 40),
    configurable por local (la subclasificación queda guardada: el puente todavía no la trae); CORTESIA_SIN_SOCIO cuenta
    solo desde `lc_excepciones_desde`.
  - **Turno y logins fijos** (`182c88d`): las excepciones del PoS muestran turno (mañana/tarde, corte por local) y login;
    los logins fijos de caja (111, 222 en staging) no son «sin empleado» y esas las resuelve el owner. Prueba 74.
  - **Descuentos tipificados por %** (`b8a4a31`): por local (nombre, %, activo); DESCUENTO_SIN_RESPALDO clasificado o
    «sin clasificar» (la alarma real; el chip del Inicio cuenta solo esos); reporte por mes/tipo/turno con monto estimado.
    Staging: «Tipo 10 %», «Tipo 15 %», «Tipo 30 %». Prueba 75.
  - **Daruma** (club-web `364effc`, pase `2ef1be3`): imagen propia (SVG → PNG sin fondo); reemplaza al 里 en el encabezado
    y el favicon de club-web; logo y franja del pase; maqueta v3 (fondo tinta recomendado; variante roja). Pase apagado.
  - **CLUB COMPARTIDO** (`677d0cc`, `75e5cfc`, pase `3deaa7f`): el socio vale en todos los locales encendidos; la
    visita es del local de la caja y queda con ese local; tope diario global; alta/validación desde cualquier local;
    premio en cualquier local; SOCIO_USO_ANOMALO entre locales; reporte del mes con «visitas de socios de otro local»;
    portal y pase «Vale en todos los Satori» (el pase no lista promociones). Prueba 76 (9 casos). Recorrido integral
    re-corrido: 12/12 (el arnés re-siembra los pedidos: el agente real de staging reemplaza la foto de mesas abiertas).
  - Pruebas: batería 483/483 · paridad OK · carreras 8/8 · vitest 1.497 · club-web 14/14 · wallet + club 52/52.
  - **No se tocaron** las cuentas `club-prueba-*` (las revisa la sesión de caja).
  - **Daruma real (v4, decisión de Ismael):** la imagen final de Ismael (foto del daruma real) reemplaza al daruma
    dibujado, que se borró de club-web y del pase. Original sin tocar y scripts en `docs/club-satori/img/daruma/`; solo
    se recorta el fondo blanco, sin filtros. club-web (`375ab18`): encabezado y favicons de 32 y 64 px. Pase (`7d9ab45`):
    logo en círculo tinta 990×990, hero 1032×336 con la cara, fondo tinta = diseño aprobado; maqueta v4. **El pase sigue
    apagado** hasta la cuenta de Google Wallet y la prueba en un teléfono.

### Autorrevisión adversarial (turno, descuentos tipificados, Club compartido)
| Actor | Qué podría intentar | Qué lo frena hoy | Hueco / acción |
|---|---|---|---|
| Socio | Usar el beneficio en dos locales el mismo día | Tope diario GLOBAL: el segundo local responde «ya_uso_hoy» (prueba 76) | — |
| Socio | Anotarse en un local apagado para usarlo en otro | Vale en los encendidos (decisión); el alta exige un local encendido | — |
| Cajero | Registrar la visita en otro local (elegir mal el local) | El pedido tiene que estar abierto en ESE local (puente); SOCIO_USO_ANOMALO entre locales | Si elige mal, la visita no cruza: «Sin factura» en el reporte por usuario |
| Cajero | Dar un descuento del 10/15/30 % sin autorización | Sale clasificado (no alarma) pero queda en el reporte por mes/tipo/turno | **Un tipo cargado deja de alarmar ese %:** el owner decide qué tipos carga; el reporte los muestra |
| Cajero con login fijo | Que su excepción la resuelva un manager amigo | Con login fijo, solo el owner (prueba 74) | El owner identifica por fecha y turno: depende del registro de turnos |
| Manager | Cargar un tipo de descuento para ocultar los suyos | Solo el owner carga tipos (prueba 75); auditado | — |
| Anfitrión | Cobrar el premio dos veces en locales distintos | El premio se marca usado en la visita (una sola fila) | — |

## 08-nov · tarde (tanda 2): pase claro, privacidad, material del piloto, gates de prod
| # | Qué | SHA | Pruebas |
|---|---|---|---|
| 1 | **Pase: créditos claros.** «₡36.000 disponibles» / «₡36,000 available» (créditos × valor del crédito, miles con separador fijo) y, si suma, «9 personas referidas este mes» / «9 guests referred this month» en otra línea. Maqueta v4 al día. **Sigue apagado.** | club-wallet `1b02b49` | wallet + club 54/54 |
| 2 | **Grok 63:** aviso corto en el opt-in del cupón con «Aviso completo (v1)» (`/privacidad`) y «Darme de baja» (`/b/<cupón>`); la base exige la versión vigente del local y la guarda con la fecha (`club_cupones_contactos.aviso_version`). `club_cupon_contacto_baja` (10.ª puerta pública): borra el contacto, deja rastro sin datos, responde siempre igual. | `5f98f75` | batería 77 · api 18/18 |
| 3 | **Grok 41:** `club_miembro_codigo`, `club_miembro_contacto_ver` (nueva) y `club_registrar_exporte` (CSV y HTML, antes de armar el archivo; si falla, no exporta) dejan fila en `club_auditoria`: quién, cuándo, rol; nunca el dato. Las tablas de contacto ya no tienen SELECT para `authenticated`. | `5f98f75` | batería 5, 28, 78 |
| 4 | **Grok 39:** `club_buscar` audita cada búsqueda (texto o dígitos y cuántas filas; nunca lo buscado) y frena pasado `club_config.buscar_tope_minuto` (30 de fábrica, 5–300; con varios locales encendidos, el menor) por usuario y por minuto. Prueba negativa. | `5f98f75` | batería 79 |
| 5 | **Grok 24:** `POST /api/cupon` pide Turnstile (sin `TURNSTILE_SECRET`, 503: falla cerrada) y tope por prefijo de red /24 y /64, como el alta. `/r/…` muestra el widget antes del botón. | `5f98f75` | api 18/18 |
| 6 | **Material del piloto (borradores):** `docs/club-satori/piloto/`: guía rápida de caja (HTML + PDF, una A4), mensaje a anfitriones y a socios (ES/EN). | `766e838` | — |
| 7 | **Gates de prod G-56 y G-61** propuestos en RUNBOOK §12 (solo diseño). `scripts/sql/club_catalogo_ext.sql` probado solo en staging (solo lectura). RUNBOOK al día: 10 puertas, 898 objetos, orden del pase con los dos gates. | `f3c034e` | — |

- Pruebas al cierre: batería **512/512** · paridad **898 = 898** · carreras **8/8** · vitest **1.501** (+4 omitidas) ·
  club-web **18/18** · migrador **15 OK** (3 omitidas) · build y lint de lo tocado limpios (los errores de lint de
  `scripts/ledger-reconciliacion` y `AdminModule` ya estaban).
- Staging vuelve a su base: 2538 movimientos / 338 miembros / 338 roles; sin locales de prueba ni claves de club-web.
- **DECISIÓN PROVISORIA:** los contactos de turistas (`club_cupones_contactos`) **no se leen desde la app** (ni owner):
  hasta que haya un exporte de ofertas auditado, se leen solo por SQL del proyecto. Si Ismael quiere verlos en la app,
  va por una función con rastro, como el contacto del miembro.
- **DECISIÓN PROVISORIA:** el texto del aviso **corto** del cupón es nuevo (resume el v1 para el turista): es borrador.

### Autorrevisión adversarial (tanda 2)
| Actor | Qué podría intentar | Qué lo frena hoy | Hueco / acción |
|---|---|---|---|
| Anónimo | Pedir cupones en masa rotando IPs | Turnstile + tope por IP y por /24 o /64 + tope por anfitrión y día + tope global por minuto en la base | Sin `TURNSTILE_SECRET` en prod **no hay cupones** (503): está en el RUNBOOK §6 |
| Anónimo | Dar de baja a un turista ajeno | Necesita el código del cupón (10 caracteres, secreto); responde igual exista o no | Quien vea la pantalla del turista puede darlo de baja: daño bajo (solo deja de recibir ofertas) |
| Anónimo | Dejar contacto sin aceptar el aviso | La base exige la versión vigente exacta del local | — |
| Cajero | Armar el mapa de teléfonos con «últimos 4 dígitos» | 30 búsquedas por minuto y cada una queda con su usuario; nunca devuelve teléfono | 10.000 combinaciones = horas y queda a la vista en `club_auditoria`. **Acción sugerida:** una alerta si alguien supera N búsquedas por día |
| Manager | Leer contactos o exportar sin rastro | La tabla no se lee directo; la función y el exporte dejan fila; la auditoría es de solo inserción | El exporte lo registra la app: una app modificada podría saltearlo, pero el dato del reporte sale de `club_reporte_mes` (owner/manager). **Hueco anotado:** auditar también `club_reporte_mes` si Ismael lo quiere |
| Owner | Borrar su propio rastro | `club_auditoria` sin DELETE para la app y con trigger de solo inserción (prueba 78) | — |
| Anfitrión | Ver un saldo en ₡ que no es el real | El ₡ = créditos × `valor_credito_crc` vigente | Si el owner cambia el valor del crédito, el pase no se actualiza hasta el próximo evento del miembro (no hay evento por cambio de config). Anotado para B |

## 08-nov · noche (correcciones de Ismael) · `96ed1bd`
- **Guía rápida:** cupón = aplicar el 10 % en el PoS **y** marcar «PROMO CLUB 10 %» (vale ₡0: es la marca).
- **Créditos con colones** («1 crédito · ₡10.000») en el saldo y en «Créditos a canjear» de la caja, la confirmación, el
  aviso del canje, el portal y las guías: coincide con el pase.
- **Aviso v1.1** (ES/EN): «Qué datos guardamos» suma «y tu email, si lo das». **DECISIÓN:** versión nueva y no aclaración,
  porque agrega una categoría de datos a lo que la persona acepta; quien aceptó v1 queda con v1 en su fila. Costo cero:
  todavía nadie aceptó en prod. Config de staging: v1.1 en los dos locales; una prueba de club-web verifica que la
  versión de club-web sea la que la migración carga por defecto.
- **Exportes entregados por la base:** `club_reporte_exportar` (owner/manager) audita y devuelve el reporte; la app solo
  le da formato. `club_registrar_exporte` se borró. **Contactos para ofertas:** `club_contactos_ofertas_exportar`, solo
  owner, solo opt-in, con rastro (filas, sin datos) y el link de baja `/b/<cupón>` en cada fila; botón en «Reportes».
- **Evento global `config`** al cambiar `valor_credito_crc` o `personas_por_credito`: la versión de todos los pases sube.
- **Prueba 82 (RLS de public):** falla si una tabla no tiene RLS, si una vista no es `security_invoker`, si anon tiene
  algún permiso sin política sobre una tabla `club_*`, o si aparece una tabla **nueva** fuera del Club en esa situación.
  Los privilegios por defecto no se tocaron. **Marcadas hoy (fuera del Club, solo listadas; RLS activo en todas, así que
  anon igual no lee ni escribe):** accounting_entries, cash_movements, cash_sessions, credit_applications,
  movement_deletions, movement_edits, pos_ndf_cursor, pos_ndf_open, pos_ndf_ticket_lines, pos_ndf_tickets, product_map,
  punch_exceptions, sops, supplier_credits, suppliers, time_punches, tip_entries, tip_sessions, ventas_comps, ventas_dias,
  ventas_hist, ventas_metas (22). Ninguna tabla sin RLS ni vista sin `security_invoker`.
- Pruebas: batería **526/526** · paridad **901 = 901** · vitest **1.505** · club-web **20/20**. Staging en su base.
- Autorrevisión: el exporte ya no depende de la app (sin pasar por la base no hay datos). El de contactos es solo owner y
  cada fila lleva su baja. Hueco que queda: quien tenga el CSV puede reenviarlo; el rastro dice quién lo bajó y cuándo.
  Los botones de «Créditos a canjear» ahora son más largos («1,5 créditos · ₡15.000»): pasan las pruebas, pero no los
  revisé en pantalla de teléfono (pendiente del recorrido).

## 08-nov · noche (tanda 3)
- **Mensajes del piloto** (`docs/club-satori/piloto/`): socios sin «tus acompañantes van como invitados»; acompañantes y
  cortesía sorpresa marcados **[CONFIRMAR ISMAEL]**; anfitriones con `<valor del crédito>` y dos párrafos
  **[CONFIRMAR ISMAEL]** (saldo de la tarjeta de papel, vencimiento de los créditos).
- **G-56** (RUNBOOK §12): filtro de sentencias, línea de base «cero socios en `club_*`», `lock_timeout` y
  `statement_timeout`, `migracion.sql` con datos personales (viaja solo el sha256), ensayo fuera de horario. Sigue diseño.
- **G-61** mecánico (`4fb5f28`): `gate61.sh` + `gate61_catalogo.sql` (3.439 hechos, determinista) + esperadas con firma;
  `gate61_test.sh` 13/13; staging contra staging → 0. **Probado solo en staging**; la lectura de prod necesita la firma.
- **Paridad:** `club_paridad.sh` sale 2 con una salida vacía, `null` o con menos de 898 objetos.
- **`club_reporte_mes` deja rastro** (`ver_reporte_mes`: quién, cuándo, mes, local, vivo; sin datos) (`377f077`).
- **Fichas de Grok 75–99:** `GROK-fichas-75-99.md`. Llegaron 75, 76, 90, 91, 93 y 99; **77–89, 92 y 94–98 no llegaron**
  (necesita a Ismael). Club compartido y 857 marcados como reemplazados donde decían lo contrario.
- Pruebas: batería **528/528** · paridad **901 = 901** · gate61 13/13 y staging → 0. Staging en su base.

## 08-nov · noche (decisiones de Ismael) · `fd1effb`, `78b9f80`
- **Mensajes del piloto cerrados:** invitados sin límite («el beneficio vale para toda la mesa, siempre que se sienten con
  vos»), cortesía en cada visita (sale de la promo vigente), saldo de papel al portal y vencimiento. Lo mismo en la guía
  rápida (una A4) y en la 6.13 (una sola factura por mesa con socio).
- **Vencimiento verificado:** el SPEC §5.1 («12 meses sin actividad; cualquier tarjeta o canje reinicia el plazo») y
  `club_vencer` (vence todo el saldo si la última tarjeta, canje o restitución tiene más de `vencimiento_meses`)
  **coinciden**: se cuenta desde la **última actividad**, no desde que se gana cada crédito. Texto único en mensajes,
  portal, aviso del canje por WhatsApp y guías. **Matiz para Ismael (no se eligió nada):** el código también cuenta la
  **restitución** (la hace el owner) como actividad; el SPEC nombra solo tarjeta y canje.
- **Tope diario único del Club:** `club_config_global.socio_visitas_por_dia` (una fila, solo owner, auditado); se borró la
  columna por local. Regla visible: «Una visita con beneficio por día, en cualquier Satori.» Prueba 83. Se revierte si
  Ismael decide otra cosa.
- **Saldos de tarjetas de papel:** plantilla, validador y `migrar_firestore.py saldos-papel` con las reglas de G-56
  (`docs/club-satori/piloto/saldos-papel.md`). Ensayo en staging con 6 anfitriones ficticios: OK y ROLLBACK (staging
  intacto); negativas en vivo: código inexistente y entorno equivocado frenan. 19 pruebas. **DECISIONES PROVISORIAS:**
  unidad = personas; movimiento `tarjeta` con la fecha de la tarjeta (cuenta para el vencimiento).
- **club-web:** el dominio sale de `VITE_CLUB_URL` (o del origen). **Pendiente fuera de club-web:** la base (links del
  pase, portal de la autoalta, código de canje, baja del turista y la lectura de QR de `club_resolver`) y la app de caja
  (`src/modules/club/qrFormato.ts`) todavía tienen el dominio escrito.
- **Descuentos tipificados** en staging: «Descuento 10 %», «Descuento 15 %», «Descuento 30 %».
- `claude/club-wallet` mergeada con epic (`1f42737`): conflictos de club-web resueltos (botón de Wallet + dominio por
  variable); club-web 23/23, wallet + club 56/56.
- Pruebas: batería **536/536** · paridad OK · vitest 1.507 · club-web 22 · migrador 15 OK · saldos 19 OK. Staging en base.

## 08-nov · noche (tanda 5) · `796951e` (epic) · `b818404` (club-wallet)
- **Aviso v1.1 corregido** sin subir versión (nadie lo aceptó en prod), ES y EN: «Para qué» suma las ofertas solo si las
  aceptó (y ya no contradice «no los usamos para nada más»); «Quién los ve» suma los servicios tecnológicos con
  servidores fuera de Costa Rica; «Cuánto tiempo» suma los contactos de ofertas (hasta la baja o 24 meses sin contacto)
  **[CONFIRMAR ISMAEL]**; «Responsable» con `<dirección del responsable>` **[CONFIRMAR ISMAEL]**. El RUNBOOK §6 exige 0
  marcas antes del deploy de club-web.
- **Retención de contactos de ofertas:** `club_config_global.contactos_ofertas_meses` (24, provisorio) y borrado diario en
  `club_socios_mantenimiento` (rastro sin datos). «Último contacto» = `ultimo_contacto_en` (lo marca quien manda la oferta)
  o la fecha en que aceptó. Prueba 84. Una prueba de club-web compara el texto del aviso con el valor por defecto.
- **Dominio en la configuración:** `club_config_global.club_url` + `club_url()` (falla cerrada sin dominio) en los links
  del pase, el portal de la autoalta, el canje, la baja y la lectura de QR; la app de caja lo lee al abrir el Club; el
  Edge del pase usa `CLUB_WEB_ORIGIN` (sin él, 503). `src/dominioRepo.test.ts` falla si el dominio vuelve a estar escrito
  fuera de los docs (probado con un archivo trucado). En staging el dominio está cargado como dato.
- **Saldos de papel:** fecha del movimiento = la de la carga por defecto **[CONFIRMAR ISMAEL]** (la de la tarjeta, en la
  nota y como opción). `doble-carga-papel` (solo lectura) cruza el CSV con el export de Firestore: hace falta el mapa
  código ↔ id viejo, porque el export no tiene el código del Club. 25 pruebas (con un export ficticio).
- **SPEC §5.1:** la restitución cuenta como actividad (decisión de Ismael).
- Pruebas: batería **547/547** · paridad OK · vitest 1.511 · club-web 23 · wallet + club 60 · saldos 25 · gate61 13/13.

## 09-nov · tarde (Grok NO-GO del puente; Club: 106, 109 y los arreglos de la auditoría) · rama del Club, nada en prod
- **Puente** (otra rama, `claude/puente-item11-prod-v2`): contrato del cursor con «corte seguro» en la 082 (ID 83), A7
  contra la RPC real en staging, paquete y guía v2. Ver `docs/puente/PASE-PROD-2026-11-09.md` en esa rama.
- **106 · login del PoS:** solo el owner carga o cambia `employees.pos_login` (y el perfil de un empleado con login);
  trigger con historial inmutable (`club_pos_login_historial`) y `club_auditoria`. La resolución de una excepción guarda el
  actor del PoS tal como estaba (`club_excepciones_resueltas.actor_pos`). Prueba negativa por la API REAL como manager:
  `scripts/sql/club_api/pos_login_manager.sh` → 403 / 42501, la fila no cambia; el nombre se sigue editando. Coordinado
  con caja (#65): solo la base.
- **109 · carga de papel:** `club_cargas_papel` (un local, un lote = sha256 de las filas; únicos; solo inserción) y
  `lock table … in exclusive mode` antes de la línea de base. Ensayo con dos sesiones en staging: la segunda espera.
- **B1 · G-56:** análisis real del SQL (`scripts/club/sql_g56.py`; 50 pruebas, con los 4 trucados de la auditoría) y modo
  PROD de la carga de papel (`--aplicar-firmado`, probado solo en staging: el SQL de prod se niega solo).
- **B2:** la carga de papel tiene origen `papel`; el migrador frena si la encuentra (nunca la borra).
- **B3:** `club_canje_aviso` deja rastro (`ver_telefono_canje`, sin el número); `club_reportes_cerrados` sin lectura
  directa (solo por `club_reporte_mes`).
- **B4:** el reporte del mes cuenta como actividad solo lo de la app; las cargas iniciales salen aparte (`carga_inicial`).
- **B5:** el tope diario cuenta solo visitas con beneficio; un segundo escaneo del mismo pedido devuelve la misma visita
  con cualquier tope (sin otra fila ni re-sorteo).
- **B6:** gate61 en modo prod rechaza A = B y un `MIN_OBJETOS` bajo el piso (3000 hechos); las esperadas cambian solo por
  PR revisado. **B9:** club-web en producción sin `VITE_CLUB_URL` no compila ni arranca.
- **B7 (elegido):** el plazo de 24 meses de los contactos de ofertas se cuenta **desde la aceptación**; se sacó
  `ultimo_contacto_en` (las ofertas salen por fuera de la app: no hay un contacto confiable que marcar). El aviso v1.1 lo
  dice así. **B8:** huella sha256 del aviso por versión e idioma (`club_avisos_privacidad`, FK desde `club_config`; prueba
  de club-web). **B10:** aviso v1.1 sin marcas: 24 meses y la dirección pública del restaurante (ES/EN).
- **B11 · carga única:** migrador `--primera-carga` (sin `delete`, «cero socios», fecha de carga, chequeo de 12 meses
  sobre la fuente, papel por `legacy_id` en la misma transacción, `--emitir`). Docs: `piloto/saldos-papel.md` §A y RUNBOOK §8.
- Pruebas: batería **567/567** · paridad OK (970) · carreras OK · gate61 19/19 · club-web 26 · saldos 30 (+4 staging) ·
  G-56 50 · migrador 15 (+6 staging).

## 09-nov · noche A (01:00, desatendida) · tarjeta del anfitrión a 390 px e ítem 43 · rama del Club, nada en prod
Detalle: [`NOCHE-2026-11-09-A.md`](NOCHE-2026-11-09-A.md).
- **Tarjeta del anfitrión** (`736414a`): en «Escanear», con un código de canje, los botones de «Créditos a canjear» se
  partían en 4 líneas y el tercero desbordaba a 390 px. Ahora son tres líneas cortas (número / créditos / ₡), con el
  texto completo en `aria-label`. Medido con datos sintéticos en staging, que se borraron después. Hay capturas de antes y
  después. 6.13 y la guía rápida de caja están al día.
- **Ítem 43 · asserts fuertes (70–85, más la 43):** 16 refuerzos. Lo que antes era «al menos» o «hay alguno» ahora es una
  cuenta exacta contra la línea base, y además se mira el estado después de cada negativa. Cuatro mutaciones dentro de la
  transacción descartada confirman que cada assert cae cuando debe; los asserts viejos pasaban con esas mismas mutaciones.
  La 75 sigue con «al menos», con el motivo anotado: staging recibe facturas reales del puente.
- **Bug real que encontró la 85 reforzada:** `club_sin_cruce_elegir` guardaba la resolución de SIN_CRUCE **sin** el actor
  (Grok 106). Ahora llama a `club_excepcion_actor` como el resolvedor general. Cambio en la 075, aplicado en staging solo
  en esa función. La definición anterior quedó guardada.
- **Fragilidad del ambiente:** la 43 fallaba si había un intento de canje real en los últimos 15 minutos. Ahora lo aísla
  dentro de la transacción.
- Pruebas: batería **568/568** · paridad **970 = 970** · carreras 8/8 + 04 · gate61 0 fallas · vitest 1.515 · club-web 27 ·
  Python 111 · migraciones 6/6. Staging en base (2.538 / 338, papel 0, 0 residuos; v2 del puente aplicada).

### Autorrevisión adversarial (noche A)
- **Anónimo:** esta noche no se abrió ninguna superficie nueva. `club_sin_cruce_elegir` sigue sin `execute` para anon
  (verificado en staging) y la tarjeta es de la app con sesión.
- **Socio:** no cambió nada de lo que ve. El tope diario ahora se prueba con las filas reales (2 con beneficio, la 3.ª no
  suma); antes solo se miraba el estado devuelto.
- **Anfitrión:** el ₡ de cada botón es solo pantalla, calculado con `valor_credito_crc`; el canje lo calcula la base. Si
  falta el valor, no se muestra la línea de ₡, en vez de mostrar un ₡0 engañoso. Riesgo residual: un monto de 7 cifras con
  tres botones a 390 px queda justo. Hoy un botón es como mucho 2 créditos, que no llega ahí.
- **Invitado:** sin cambios.
- **Cajero:** no puede elegir la factura de un SIN_CRUCE (owner/manager); eso no cambió. Los botones de canje mantienen el
  tamaño de toque (`big`, mismo ancho repartido).
- **Manager:** elegir la factura de un SIN_CRUCE ahora hace una lectura más (`club_excepcion_actor`, la lista de 120 días
  filtrada por tipo). Es el mismo costo que ya paga «Resolver» y no se midió aparte. Si en el piloto «Elegir factura» se
  siente lento, esa lectura es lo primero que hay que mirar.

## 09-nov · madrugada (Grok GO condicionado; 113 → 082 v3; Club 114–116) · nada en prod ni en main
- **Puente** (otra rama, `claude/puente-item11-prod-v2`):
  - código `5da233a`, 082 v3 `edb7ffc5…`, aplicada en staging con el Edge v16;
  - 119 y 118 en el paquete y la guía; el kit en seco dio 35/35 en PowerShell 5.1 y 7;
  - #71 en `0a33df42`.
- **114 · G-56:** `sql_g56.py` rechaza toda llamada a una función fuera de una lista blanca:
  - la lista son los built-ins inmutables (verificados contra el catálogo de staging) más excepciones nombradas, cada
    una con su motivo: G-56 suma `now` y `to_char`, y el migrador suma 8 más que usa su SQL hoy;
  - **decisión del dueño:** esas excepciones no son inmutables (estables y 3 volátiles que generan códigos);
  - hay un trucado por forma (`select … into`, `:=`, `insert … select`, `if`, `create temp table … as select`, con
    comillas y sin esquema): el filtro anterior los dejaba pasar;
  - límite que queda: la notación de atributo (`fila.funcion`) no se ve sin mirar el esquema.
- **115 · carga única:** cruce papel ↔ Firestore por `legacy_id`, antes de emitir y dentro de la transacción. Aborta si
  una fila no cruza o si la tarjeta ya está en Firestore. Doc corregida («el mapa es directo» no era cierto).
- **116 · `pos_login_manager.sh`:**
  - cabeceras en archivos (umask 077), `mktemp -d` + trap y nada secreto en argv;
  - manager sintético que se crea y se borra (0 residuos verificados).
- Pruebas: Python 122/122 con staging · API 106: 403/42501, el nombre se edita, 0 residuos. Staging en base.

## 09-nov · ronda r7 de Grok (07:02) · staging y ramas propias, nada en prod ni en main
- **Puente:** pase **reprogramado, fecha a definir por el dueño tras la auditoría de la 082 v3**. Se dice así en el
  paquete, la guía (`cd6d5a1`, sin cambios de código) y el cuerpo del #71, y los punteros de este repo apuntan al v2
  (`c284d77`). La 082 no se tocó.
- **R7-02** (`15ac3af`): `club_miembro_roles.baja_por` ('socio' | 'gerencia'). Reactivar a la persona no revierte la baja
  que dio el propio socio. Prueba 86.
- **CLUB-AUD-66** (`cc1f142`): el replay de `club_cupon_usar` exige el mismo cupón y las mismas personas, también el de un
  pendiente. Prueba 87.
- **DOC-AUD-02 y P-R7-F:**
  - lo que estaba como CLUB-AUD-71…74 es mío y pasa a **CLAUDE-HALL-01…04**;
  - [`IDS-AUDITOR.md`](IDS-AUDITOR.md): ID ↔ commit ↔ SHA ↔ prueba que falla sin el arreglo, con las mutaciones
    reproducibles en `scripts/sql/mutar_bateria.py`;
  - **55 y 60 no los encuentro; 64 no está arreglado.**
- **P-R7-A:** diagnóstico y plan en [`P-R7-A-plan.md`](P-R7-A-plan.md). **Espera el OK.**
- `gate61_test.sh` corre **sin red** desde hoy. Al probar el script viejo, una consulta de solo lectura del catálogo llegó
  a prod: el detalle está en IDS-AUDITOR.md.
- Pruebas: batería **580/580**, paridad **974 = 974**, carreras 8/8, gate61_test 20/20 sin red, vitest 1.515, club-web 27,
  Python 122 con staging. Staging en base.

## 09-nov · mañana (pase del puente hoy; 089/090 de caja en staging) · rama del Club, nada en prod ni en main
### INCIDENTE: una prueba mandó a prod una consulta de solo lectura (07:48 CR)
- **Cuándo:** 09-nov, **07:48:52 y 07:49:58** (hora de Costa Rica), dos llamadas.
- **Qué consulta:** `scripts/sql/gate61_catalogo.sql`, el catálogo normalizado de G-61. Lee solo `pg_catalog`: nombres,
  columnas, ACL, políticas y el md5 de los cuerpos de funciones. **No lee filas de ninguna tabla**: ningún dato de
  personas.
  - Fue por la API de administración de Supabase (`/database/query`), envuelta en
    `begin; set transaction read only; … ; rollback;`.
- **Por qué:** estaba armando la evidencia de «falla sin el arreglo» de G-61.
  - Corrí el `gate61_test.sh` de ese momento contra el `gate61.sh` viejo de `4fb5f28`, que todavía no frenaba A = B.
  - El caso «prod: A = B» de la prueba tenía escrito el ref de prod con `--prod-firmado`.
  - El script viejo conectó.
  - Fue un error mío: una prueba nunca debió tener el ref de prod.
- **Solo lectura:** transacción `read only` que termina en `rollback`, y solo catálogo. **No se escribió nada en prod.**
- **Cómo se cerró:**
  1. `gate61_test.sh` corre **sin red**: un `curl` falso anota cualquier intento y la prueba falla si alguien lo llama.
     El cierre es «ningún caso salió a la red» (`da3bc9a`).
  2. **Ningún archivo de prueba tiene el ref de prod:**
     - `gate61_test.sh` y `scripts/club/test_saldos_papel.py` usan un ref inventado para el «NEGADO»;
     - el único caso que necesita el ref real lo lee de `SATORI_REF_PROD`, que **en las pruebas no existe**, así que se
       omite.
  3. **Prueba que lo controla:** `src/refProdEnPruebas.test.ts` (vitest).
     - Lee el ref de la herramienta donde sí va como candado (`scripts/club/migrar_firestore.py`).
     - Falla si cualquier archivo de prueba lo tiene: nombre o carpeta con test, prueba, carrera, ensayo o spec, sin
       contar los `.md`.
     - **Verificado que muerde:** un archivo temporal `scripts/sql/zz_prueba_temporal.sh` con el ref hizo fallar la
       prueba; borrado, pasa.
  4. El ayudante de consultas de la sesión (fuera del repo) ya no tiene un atajo a prod.
- **REGLA (del dueño, 09-nov):** ningún script de prueba puede tener el ref de prod. Si lo necesita, lo lee de una
  variable (`SATORI_REF_PROD`) que en las pruebas no existe. El ref de prod queda solo en las **herramientas**, como
  candado (`gate61.sh`, `migrar_firestore.py`).

### Decisiones del dueño del 09-nov
| Tema | Decisión | Fuente |
|---|---|---|
| **Pase del puente** | Se hizo **hoy**, con el paquete tal como estaba (`claude/puente-item11-prod-v2` @ `cd6d5a1`, código `5da233a`), y **salió bien**. Lo ejecutó el dueño en la PC del PoS: 081 a las 10:57, 082 v3 a las ~12:00 y Edge `ingest-ndf` v3 a las 12:03:30 (-06:00). El agente sigue en `4d3513a`. Resultado y desvíos en [`RESULTADO-PASE-2026-11-09.md`](../puente/RESULTADO-PASE-2026-11-09.md) (en `main`, #76 `a794b61`). El #71 se mergeó con la autorización del dueño (`2953994`, 13:21) y `main` quedó descongelado. | Mensaje del dueño, 09-nov mañana y tarde |
| **089 y 090 en staging** | Caja las aplicó esta mañana: 089 a las 08:27 CR y 090 a las 08:28 CR, cada una con la firma del dueño para staging. El **residual de `supabase_admin`** de la 090 queda aceptado. Si algo del Club falla por eso, se avisa **antes** de cambiar nada. | `a4d1192` (089), `ed1eec8` (090) |
| **Plazo de 24 meses** | Los contactos de ofertas se guardan hasta la baja o **24 meses desde la aceptación** (B7). Está en el aviso v1.1 (`club-web/src/i18n.ts`) y en `contactos_ofertas_meses`. | Entrada del 09-nov tarde (B7, B10) |
| **Historial de git** | Lo único escrito: OPS-AUD-01 de `claude/docs-correos-ops` (`39847d5`) dice «la contraseña sigue en el historial de git (**no se reescribe**)». **A confirmar** que esa es la decisión. | `39847d5`, HALLAZGOS.md |
| **G-56: excepciones de funciones** | **PENDIENTE de texto.** La decisión no llegó escrita a esta sesión. Lo que hay es el contexto del 09-nov madrugada (Grok 114: G-56 suma `now` y `to_char`, el migrador suma 8). No se cambia nada hasta tener la decisión. | — |
| **Reintentos del pase** | **PENDIENTE de texto.** La decisión no llegó escrita. | — |
| **`club_sin_cruce_elegir`** | **PENDIENTE de texto.** La decisión no llegó escrita. El flujo real y las propuestas S1–S8 están en [`FLUJO-SALON-cruce.md`](FLUJO-SALON-cruce.md). | — |

### Lo demás de esta mañana
- **089/090 y el Club:** con las dos aplicadas en staging, todo en verde:
  - batería **580/580**, paridad **974 = 974** y carreras 8/8;
  - gate61_test 0 fallas, sin red;
  - vitest 1.517, club-web 27, Python 123 (16 omitidas; con staging, 1 omitida).

  No hubo nada que cambiar.
- **Flujo del salón** (escanear primero, aplicar en el PoS después, pagar 40 min o más después): explicación y
  propuestas en [`FLUJO-SALON-cruce.md`](FLUJO-SALON-cruce.md).
  - Hay dos lugares donde un cruce que falta **sí** puede hacer perder un beneficio:
    - el premio por referido;
    - las personas pendientes de un anfitrión nuevo, cuando la factura se anula y se rehace sin el pedido.
  - Arreglos propuestos (S1–S8), sin aplicar.
- **CLAUDE-HALL-05** (MAINTAIN): diagnóstico y propuesta en [`CLAUDE-HALL-05-maintain.md`](CLAUDE-HALL-05-maintain.md).
  - **Causa en el Club:** el bucle de la 075 §3 revoca una lista sin `maintain`.
  - **Causa en lo demás:** los privilegios por defecto de `postgres`.
  - **Propuesta en dos bloques:** la 075 del Club, y el resto para caja después del pase. Sin aplicar.
- **55 y 60:** abiertos; hace falta el texto del auditor. **64:** plan con fechas propuestas en
  [`IDS-AUDITOR.md`](IDS-AUDITOR.md) §4, sin implementar.
- **120 y 121 del puente:** quedan para después del pase. No se tocaron.

### 09-nov · tarde (después del pase)
- **Flujo del salón, v2** ([`FLUJO-SALON-cruce.md`](FLUJO-SALON-cruce.md)). Suma dos datos del dueño, confirmados con
  staging (solo lectura): **la factura queda en `R` hasta el cierre de caja** (16:00 y ~23:00), y con el agente de
  prod llegan en null `consecutivo_fe`, `clave_fe` y `mesa_factura`. Lo que eso implica:
  - El cruce del Club **solo mira `C`**. Por eso **«SIN_CRUCE» sale falso todas las noches**, desde el cobro hasta
    ~10 min después del cierre de caja.
  - El plan B («facturas de las últimas 2 h») está vacío durante el servicio.
  - Gerencia puede verse obligada a rechazar personas pendientes reales cuando la factura se anuló y se rehizo.
  - Con el agente viejo, las cuentas divididas no cruzan.
  - Propuestas S0 (una `R` del pedido cuenta como cruce provisional), S0b y S8 primero, antes del piloto. **Sin
    aplicar.**
- **Decisiones que siguen sin texto** en esta sesión: excepciones de G-56, reintentos del pase y
  `club_sin_cruce_elegir`. «Historial de git» queda a confirmar (tabla de arriba). No se cambia nada por ellas hasta
  tener el texto.
- **Regla nueva del dueño (09-nov tarde):** **cualquier escritura en staging fuera de una transacción descartada se pide
  antes.** La batería, la paridad, las carreras y las pruebas de la 085 y de la 100 corren en transacciones con
  ROLLBACK y siguen sin pedir permiso. Lo que deja algo escrito (aplicar una migración, cambiar el ledger, cargar un
  secreto) se pide primero. La última escritura de este tipo fue la fila 085 del ledger de staging (texto sin nombre,
  md5 `68b6384b…`, 09-nov ~14:00 CR): estuvo bien hecha, pero desde ahora se pide.
- **Orden en prod de las migraciones pendientes** (Supabase no aplica una versión menor que la última aplicada):
  **085 → 091 → 092 → 100**. La 100 (#81) además necesita la 075 del Club: va en el pase del Club, después de la 075, y
  no se mergea antes que la 091 y la 092. Paquete de la 085: #80.

### 09-nov · tarde: S0 y S8 aplicadas en STAGING (autorizado por el dueño) · rama `claude/club-s0-s8`, nada en prod
- **S0 · «cobrada, falta el cierre de caja».** Una factura `R` del pedido es un cruce **provisional**
  (`club_cruce_provisional`, nueva e interna):
  - **«SIN_CRUCE»** no sale con ella;
  - **«sin factura»** del reporte de visitas tampoco la cuenta;
  - los **controles exactos** (`club_cruce_facturas`: cupón sin promo, visita sin el 856, premios, elegir la factura)
    siguen esperando la `C`.
- **S8.** Una factura anulada (`X`) impide aprobar un pendiente solo si el pedido no tiene una `C` **ni una `R`**.
- **Pruebas:** batería **88** (S0) y **89** (S8). Con las funciones de antes (mutaciones `S0` y `S8` de
  `mutaciones_r7.json`, commit `9dcf212`) **caen 2 y 1**. Las mutaciones anteriores siguen cayendo igual (R02 2,
  CLUB-AUD-43 1, R7-02 4, CLUB-AUD-66 3).
- **Estado de staging ANTES** (14:18 CR):
  - ledger 85 filas, la última 090;
  - md5 de `pg_get_functiondef`: `club_excepciones` `57795c2d…`, `club_pendiente_resolver` `ddda0a12…`,
    `club_reporte_visitas` `bde539ab…`;
  - `club_cruce_provisional` no existía.
- **Aplicado a las 14:25:28 CR, en una transacción:**
  - la función nueva y las 3 funciones cambiadas, tal cual están en la 075 de la rama;
  - `revoke` de la nueva para `public`, `anon` y `authenticated`.

  Antes de aplicarlo, la batería con el cambio dentro de una transacción descartada dio 587/587.
- **Estado de staging DESPUÉS:**
  - ledger igual (85 filas, la última 090);
  - md5: `club_cruce_provisional` `d09c0e6c…`, `club_excepciones` `a919ee7c…`, `club_pendiente_resolver` `054cfc17…`,
    `club_reporte_visitas` `0ab994dd…`;
  - nadie ejecuta la función nueva desde `anon` ni `authenticated`.
- **Verde:**
  - batería **587/587**;
  - paridad **975 = 975** (un objeto más: la función nueva);
  - carreras 8/8 y gate61_test sin fallas.
- **Vuelta atrás en staging, si hiciera falta:**
  1. volver a crear las 3 funciones desde la 075 de `9dcf212`;
  2. después, `drop function public.club_cruce_provisional(text, jsonb)`.

  Las tablas y los datos no cambiaron.

- **La fila 075 del ledger de STAGING ya no es igual al archivo 075** (aviso del dueño, 09-nov tarde). S0 y S8 cambiaron
  el archivo (`club_cruce_provisional` y tres funciones) y se aplicaron en staging solo las funciones, no la migración
  entera, así que `statements` de la fila 075 sigue con el texto de antes. **No se toca ahora.** Se resuelve en el pase
  del Club a prod, cuando la 075 se renumere (075 → 150, CLUB-AUD-100): ahí se arma la fila del ledger con el archivo
  final. La paridad (975 = 975) compara el catálogo, no el ledger, y sigue igual.

### 09-nov · tarde: S0b y S2 aplicadas en STAGING (autorizado por el dueño) · rama `claude/club-s0b-s2`, nada en prod
- **S0b · plan B con `R`.** La lista del plan B (`club_facturas_recientes`) trae también las facturas `R` de las últimas
  2 h, con la columna nueva `estado`. La caja las ve con la nota «Cobrada, falta el cierre de caja: vale igual».
  - `club_pos_ref` (modo factura) acepta `C` o `R`; una `X` no.
  - `club_visita_canonica`: la factura del plan B en `R` da la clave del pedido, la misma que cuando pase a `C`.
  - `club_cruce_provisional` también vale para el plan B: con la factura elegida en `R`, **«REGISTRO_SIN_FACTURA»** no
    sale (se agregó la condición en `club_excepciones`). Si la `R` pasa a `X`, sale; cuando pasa a `C`, cruza exacto.
  - `club_facturas_recientes` cambia lo que devuelve: la 075 la borra antes de crearla, y los permisos se vuelven a dar
    en el mismo archivo.
- **S2 · «sin factura» del reporte de visitas con la regla de «SIN_CRUCE».** Una visita cuyo pedido sigue **abierto** no
  cuenta hasta que el pedido se cierra sin factura (o pasan 18 h desde el escaneo).
- **Pruebas:** batería **90** (S0b) y **91** (S2).
  - Con los arreglos cargados dentro de la transacción descartada de la batería: **595/595** (23 s).
  - Con staging tal como está (sin los arreglos): **caen 6**, 5 de la 90 y 1 de la 91 («2 → 4»: el pedido abierto contaba).
  - Mutaciones `S0b` y `S2` en `mutaciones_r7.json` (las funciones de `c309b26`). `mutar_bateria.py` acepta
    `sql_antes` (para borrar `club_facturas_recientes` antes de volver a crear la versión vieja, que devuelve otro tipo).
- **Batería más rápida:** `pg_temp.exc` lee 14 días de excepciones y no 60. La batería de antes (587 casos) ya tardaba
  30,2 s, el máximo que espera la Management API, porque staging suma tickets reales del puente cada día. Las facturas
  de prueba que mira son de las últimas 240 h y el corte más viejo es `current_date - 7`.
  - Aparte: `club_excepciones(…, 'DESCUENTO_SIN_RESPALDO')` sobre 60 días tarda **2,8 s** en staging (todas juntas,
    1,4 s). Para mirar antes del piloto, no se tocó.
- **App:** `marcaFactura` (con vitest) y la nota en el plan B de «Escanear». Los textos dicen «cobradas», no «cerradas».
  Guía 6.13: tarea 2, indicador «Visitas sin factura» y reglas.
- **Estado de staging ANTES** (16:29 CR, solo lectura):
  - ledger 85 filas, la última 090;
  - md5 de `pg_get_functiondef`: `club_facturas_recientes` `594083c3…` (sin `estado`), `club_pos_ref` `6600c524…`,
    `club_visita_canonica` `544aec01…`, `club_cruce_provisional` `d09c0e6c…`, `club_excepciones` `a919ee7c…`,
    `club_reporte_visitas` `0ab994dd…`.
- **Aplicado a las 16:32:39 CR**, autorizado por el dueño, en una transacción:
  - precondición: los 6 md5 iguales a los de las 16:29 (se volvieron a leer a las 16:32: iguales);
  - `drop` + `create` de `club_facturas_recientes` con sus permisos (`authenticated` ejecuta);
  - las otras 5 funciones, tal cual están en la 075 de la rama (`04916fa`).
- **Estado de staging DESPUÉS:**
  - ledger igual (85 filas, la última 090);
  - md5: `club_facturas_recientes` `d8a00039…` (con `estado`), `club_pos_ref` `4449eee4…`, `club_visita_canonica`
    `a31bf7a3…`, `club_cruce_provisional` `7080f582…`, `club_excepciones` `43218a89…`, `club_reporte_visitas`
    `fcd67503…`;
  - permisos iguales a los de antes en las 6.
- **Verde:**
  - batería **595/595** (28 s);
  - paridad **975 = 975**;
  - mutaciones: R02 2, CLUB-AUD-43 1, R7-02 4, CLUB-AUD-66 3, S0 5 (ahora también caen la 90 y la 91), S8 1, **S0b 5**,
    **S2 1**.
- **Vuelta atrás en staging, si hiciera falta:** las 6 funciones desde la 075 de `c309b26`, con el `drop` de
  `club_facturas_recientes` primero, y sus permisos. Las tablas y los datos no cambiaron.
- **El ledger de staging (fila 075) sigue sin igualar el archivo**, como con S0/S8: se resuelve en el pase del Club.


### 10-nov: 136 (Grok) — la baja del turista con una llave propia, APLICADA en staging (autorizado) · rama `claude/club-baja-token`, nada en prod
- **Riesgo real, distinto del que se describió:** no se borran contactos en masa adivinando códigos. El código tiene ~50
  bits, la función responde siempre `true` (no confirma si existe) y hay tope por IP. El problema es que el **código del
  cupón** era también el link de baja, y ese código va en el QR que ve la caja, en cada mensaje de ofertas y en el CSV
  del owner. Con un mensaje reenviado, cualquiera podía dar de baja al turista y, si el cupón seguía vigente, **usarlo**.
- **Arreglo:**
  - `club_cupones_contactos.baja_token`: 128 bits por contacto, único;
  - `club_cupon_contacto_baja(p_token)` borra por esa llave (y no por el código);
  - el CSV de ofertas trae `/b/<llave>`;
  - club-web: `POST /api/baja/:llave` (la ruta vieja con el código ya no existe), la página `/b/` pide la llave y el
    aviso corto dice que cada mensaje trae su link.
  - Sin Turnstile: con una llave de 128 bits no hace falta, y la baja tiene que ser de un solo clic. El tope por IP
    sigue.
- **Pruebas:**
  - batería 77 y 80: el contacto nace con su llave; con el código del cupón ya no se borra nada; el CSV no trae el
    código. Con el arreglo dentro de la transacción descartada: **597/597**;
  - sin el arreglo, la batería se corta al leer `baja_token` (la columna no existe);
  - mutación `136` en `mutaciones_r7.json`;
  - API de club-web 19/19; las 2 pruebas nuevas caen con la `api.js` vieja.
- **Ojo:** la batería tardó entre 21 y 30 s en esta corrida: sigue cerca del máximo de la Management API.
- **Estado de staging ANTES** (10-nov 08:43 CR, solo lectura): `club_cupon_contacto_baja(p_codigo)` md5 `d6063385…`
  (ejecutan `anon` y `authenticated`), `club_contactos_ofertas_exportar` md5 `6b7b1956…`, sin la columna `baja_token`,
  0 contactos, ledger 85 filas (última 090).
- **Aplicado a las 08:44:42 CR**, autorizado por el dueño, en una transacción con precondición (los dos md5 y la
  columna ausente): la columna con su índice único, `drop` + `create` de `club_cupon_contacto_baja(p_token)` con sus
  permisos, y el exporte. Tal cual están en la 075 de `7f3de6b`.
- **Estado DESPUÉS:** `club_cupon_contacto_baja(p_token)` md5 `9d6df33e…` (mismos permisos), exporte `8921d7b5…`,
  `baja_token` not null con default y el índice `club_cupones_contactos_baja_token_key`; ledger igual (85 · 090).
- **Verde:** batería **597/597** · paridad **977 = 977** (dos objetos más: la columna y el índice) · API de club-web
  **19/19** · mutación `136`: **caen 4** (77 y 80). Para que la mutación caiga por casos y no corte la batería, las dos
  llamadas a la baja con la llave en la prueba 77 van dentro de un `begin … exception`.
- **Vuelta atrás en staging:** `drop` de `club_cupon_contacto_baja(text)` y la versión de `37164ea` (por código) con sus
  permisos; el exporte de `37164ea`; `drop index` y `drop column baja_token`. Hoy no hay contactos que pierdan su llave.

### Pendiente del piloto: partir la batería del Club (propuesta del 10-nov; HECHO el mismo día, ver abajo)
**Por qué:** la batería corre en un solo request a la Management API, que corta a los **30 s**. Hoy tarda **21–30 s**
y crece con los tickets reales que el puente suma a staging cada día. Si pasa de 30, no hay resultado (no se sabe si
está verde) y `mutar_bateria.py` tampoco corre.

**Lo que la complica:** los bloques comparten fixtures por `_ids` (78 lecturas: `cupon1`, `manu`, `ref_cod`, `m2`…`m5`,
`ped_m`…) y por datos que deja un bloque anterior (por ejemplo, la factura 990950 de la 27 la usa la 90). Partirla «por
la mitad» rompe esas dependencias.

**Propuesta:**
1. **Un preámbulo común** (`075_pruebas_comun.sql`): `begin`, las tablas temporales, los `set local`, todas las funciones
   `pg_temp.*` (como, yo, r, loc, cruce, fac, factura, exc, hay, socio, aviso…) y los **fixtures compartidos** que hoy
   crean los primeros bloques y leen los demás (miembros base, `cupon1`, `manu`, `ref_cod`, `m2`…`m5`).
2. **4 tramos por tema**, de ≤ 12 s cada uno, cada uno autosuficiente: (A) cupones, canjes y roles (1–26); (B) pedidos,
   cruce y socios (27–59); (C) excepciones del PoS del Local Club (60–75, los más pesados); (D) 76–91 y el bloque 6
   (cuentas inactivas). Cada request = preámbulo + tramo + el `select` de resultados + `rollback`.
3. **Un runner** (`correr_bateria.sh`): corre los tramos **uno detrás del otro** (en paralelo podrían trabarse en las
   mismas filas, como `club_config`), junta los JSON, compara el total de casos con el esperado y sale ≠ 0 si algo
   falla o si un tramo no devolvió resultado.
4. **`mutar_bateria.py`**: mete la mutación en el tramo de su ancla. Si las funciones mutadas las usan otros tramos,
   los corre todos con la mutación.
5. **Un control estático** (vitest que lee el SQL): cada clave de `_ids` que lee un tramo se crea en el preámbulo o en
   ese mismo tramo. Así, mover un bloque de tramo no rompe nada en silencio.
6. **La paridad no cambia** (ya es su propio request).

**Descartado:** conectarse directo a la base (`psql`) para evitar el límite: necesita la contraseña de la base en la
sesión. **Complemento:** bajar el costo de `DESCUENTO_SIN_RESPALDO` (2,8 s sobre 60 días), que es lo que más pesa en
los bloques 60–68.

### 10-nov: la batería del Club por tramos (solo pruebas; rama `claude/club-bateria-tramos`, PR en borrador, nada en prod)
- **Un solo archivo**, `scripts/sql/075_pruebas_staging.sql`, con marcas `-- ════════ TRAMO n: …`:
  - **preámbulo:** el encabezado, los datos base, las funciones `pg_temp.*`, incluidas las 7 que antes se creaban adentro
    de la 27, la 64 y la 67, y los perfiles de contador y manager activos, que antes estaban en la 28;
  - **5 tramos** (la propuesta decía 4): 1–26 · 27–59 · 60–67 · 68–69 · 70–91 y 6. La 68 sola tarda ~5,5 s en el
    servidor: con 4 tramos, el de 60–68 llegó a 12,9 s.
  - Cada tramo trae su **puesta a punto**: la clave de club-web rotada, la config del local y la global, el marcador de
    `PRUEBA-PROMO` y el estado de «Local Club». Cada cambio va con una guarda: en la batería entera no toca nada.
    Se armó comparando, al empezar cada tramo, el estado «solo» contra la batería entera (config, marcadores,
    promociones, clave, perfiles y cantidad de filas). Las filas de datos difieren y los tramos lo toleran.
- **`scripts/sql/bateria_club.py`:** corre los tramos uno detrás del otro. **Sale ≠ 0** si un tramo no devuelve
  resultados, si un caso falla, o si el total no es el de `--esperado`.
- **`mutar_bateria.py`:** cada mutación va en el tramo de su ancla y en todos los siguientes (como en la batería entera,
  donde sigue puesta hasta el final).
- **`scripts/sql/bateria_tramos.test.ts` (vitest):** cada tramo lee de `_ids` solo lo que crea el preámbulo o él mismo;
  ninguno crea funciones `pg_temp`; cada ancla de mutación aparece una vez. Trae un caso armado que muestra que el
  control avisa.
- **Dos casos que dependían de otro tramo**, ahora autosuficientes:
  - la 90 tiene su propia factura C (993962), en vez de la 990950 de la 27;
  - el caso B3 de la 85 («ver el teléfono del canje queda en club_auditoria») pasó a la 43, donde se ve el teléfono.
    Conserva la etiqueta «85».
- **Resultado en staging** (transacciones con `rollback`):
  - por tramos, **597/597** en 3 corridas: tramo 1 (107 casos) 3,5–8,4 s; tramo 2 (225) 4,7–8,3 s; tramo 3 (72)
    4,0–4,7 s; tramo 4 (17) 5,9–6,2 s; tramo 5 (176) 5,3–7,0 s. Los picos son carga de staging;
  - el archivo entero en un solo request, **597/597** (21–23 s);
  - mutaciones, iguales a la batería entera: R02 2, CLUB-AUD-43 1, R7-02 4, CLUB-AUD-66 3, S0 5, S8 1, S0b 5, S2 1,
    136 4.
- **La 60 se queda en el tramo 3:** pasarla al 2 obligaba a copiar en la puesta a punto las cortesías y promociones que
  siembra.

### Pendiente (después del piloto): bajar el costo de «descuento sin respaldo»
- `club_excepciones(…, 'DESCUENTO_SIN_RESPALDO')` tarda **2,8 s sobre 60 días** en staging (todas las excepciones juntas,
  1,4 s). Es lo que más pesa en el tramo 3 (bloques 60–68) y en la pantalla Excepciones cuando se elige ese tipo.
- Qué mirar: el plan de la consulta del precio habitual (la moda de los 30 días anteriores por artículo), con
  `explain analyze` sobre staging. **Sin analizar todavía; no se tocó.**

## 09-nov · noche B (02:30, desatendida) · pase de Wallet: Grok 75 y B4 · rama `claude/club-wallet`, nada en prod
Detalle: [`NOCHE-2026-11-09-B.md`](NOCHE-2026-11-09-B.md).
- **Grok 75** (`7bc5532`): un miembro con error en la sincronización del pase se saltea y se anota para reintentar
  (id, evento, mensaje corto; nunca teléfonos ni datos del pase). El cursor avanza por encima de lo procesado. La
  pasada siguiente reintenta a los anotados (tope 10) y los da por resueltos si salen bien. Los mensajes de canje que
  fallan ya no frenan el cursor. **Sin la tabla de reintentos** (propuesta en `propuestas/club_pase_reintentos.sql`,
  porque esta noche la 075 no se tocaba): modo conservador, el cursor frena antes del primer evento del fallido.
- **B4** (`f130c37`, `9088aba`): el pase de Apple, apagado. Arma `pass.json` con el mismo contrato y textos que Google,
  la firma PKCS#7 y el `.pkpass`, solo con WebCrypto. La firma la verifica `openssl cms` con un certificado falso.
- Grok 76 no se tocó. El cron de `/sync` sigue apagado. El diseño v4 sigue sin cambios.
- Pruebas: vitest 1.568 (wallet 52), `dominioRepo` OK, tsc -b, build y lint OK.

### Autorrevisión adversarial (noche B)
- **Anónimo:** no hay rutas nuevas. `/club-pase/apple` sigue en 404 y `/sync` exige su clave. Las funciones de
  reintentos (propuesta) son solo de service_role, y la tabla no se lee desde la app.
- **Socio:** no puede forzar reintentos ni mover el cursor; lo anotado no lleva sus datos.
- **Anfitrión:** su pase de Apple dice lo mismo que el de Google (₡ disponibles, referidos). El token del web service
  sale de un HMAC con un secreto del Edge: el pase no expone el token del portal.
- **Invitado:** sin cambios.
- **Cajero / manager:** sin cambios en la app.
- **Riesgo que queda:** un miembro que falla siempre se reintenta hasta 10 veces y después queda anotado, sin
  reintentos automáticos. Hace falta que el dueño vea esa lista (pantalla o consulta) cuando se encienda el pase.
