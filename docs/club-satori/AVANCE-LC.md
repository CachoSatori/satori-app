# Avance · Local Club y pase de Wallet

> Lo actualiza cada sesión al cerrar una etapa (también las nocturnas). Plan: [PLAN-LC-lanzamiento.md](PLAN-LC-lanzamiento.md).
> Contrato: [CONTRATO-pase.md](CONTRATO-pase.md). Rama: `claude/epic-tesla-pyo77m` (PR #59). **Solo staging.**
> Estados: **pendiente** · **en curso** · **hecha**. Pruebas: batería (`scripts/sql/075_pruebas_staging.sql`), carreras,
> paridad, vitest.

## Sesión A · Local Club (075, caja, excepciones, pantallas)
| Etapa | Qué | Días | Estado | SHA | Pruebas |
|---|---|---|---|---|---|
| A1 | Roles, QR fijo del socio, activar como anfitrión, stub del contrato del pase | 2 | en curso | — | — |
| A2 | Socios: alta en caja, autoalta, validación, premio por referir | 1,5 | pendiente | — | — |
| A3 | Promociones mínimas + productos para cortesías | 1,5 | pendiente | — | — |
| A4 | «Qué aplicar», visita por factura (856), topes, antiautocanje, portal con dos pestañas | 3 | pendiente | — | — |
| A5 | Excepciones LC (6) | 1,5 | pendiente | — | — |
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
