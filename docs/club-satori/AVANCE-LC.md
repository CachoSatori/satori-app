# Avance · Local Club y pase de Wallet

> Lo actualiza cada sesión al cerrar una etapa (también las nocturnas). Plan: [PLAN-LC-lanzamiento.md](PLAN-LC-lanzamiento.md).
> Contrato: [CONTRATO-pase.md](CONTRATO-pase.md). Rama: `claude/epic-tesla-pyo77m` (PR #59). **Solo staging.**
> Estados: **pendiente** · **en curso** · **hecha**. Pruebas: batería (`scripts/sql/075_pruebas_staging.sql`), carreras,
> paridad, vitest.

## Sesión A · Local Club (075, caja, excepciones, pantallas)
| Etapa | Qué | Días | Estado | SHA | Pruebas |
|---|---|---|---|---|---|
| A1 | Roles, QR fijo del socio, activar como anfitrión, stub del contrato del pase | 2 | **hecha** | `a1e93db` | batería 294/294 (nuevas 53–56) · carreras 6/6 · paridad 602 = 602 · migrador 15/15 · vitest 1.487 |
| A2 | Socios: alta provisional + confirmación, autoalta (Turnstile, topes, purga, privacidad), validación, token de pase, cursor | 2,5 | en curso | — | — |
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
