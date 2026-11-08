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
| A3 | Promociones mínimas + productos + admin de cortesías del sorteo | 2 | pendiente | — | — |
| A4 | «Qué aplicar», sorteo de cortesía, visita por factura (856), premio por referir (1.ª factura C con 856), topes, antiautocanje, créditos pendientes, portal con dos pestañas | 4,5 | pendiente | — | — |
| A5 | Excepciones LC (11) + «pendiente de configuración» de R02 + reporte de altas por cajero | 2,5 | pendiente | — | — |
| A6 | Recorrido, guía de uso, RUNBOOK | 1,5 | pendiente | — | — |

## Sesión B · pase de Wallet (Google; Apple apagado)
| Etapa | Qué | Días | Estado | SHA | Pruebas |
|---|---|---|---|---|---|
| B1 | Edge `club-pase`: JWT «Save to Google Wallet», clase y objeto | 1,5 | pendiente | — | — |
| B2 | Botón en el portal y en la autoalta | 0,5 | pendiente | — | — |
| B3 | Sincronización por eventos, mensajes de canje, baja | 1,5 | pendiente | — | — |
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
    1. Texto del aviso de privacidad (`club-web/src/i18n.ts`, `alta_aviso`) y versión `v0-provisorio`. Antes de la
       campaña: texto final y versión `v1` en `club_config` y en `club-web/src/config.ts` el mismo día.
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
