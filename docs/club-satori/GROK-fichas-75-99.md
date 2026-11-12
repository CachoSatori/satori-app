# Fichas de Grok 75–99 · estado (08-nov, noche)

> Lista de seguimiento **sin detalles explotables**: qué área toca cada ficha, su estado y dónde quedó, sin el paso a paso
> del problema. El detalle de cada ficha lo tiene Ismael (auditoría de Grok); acá solo lo que llegó a esta sesión.
> **Severidad:** la que vino con la ficha; «—» = no vino indicada (no se inventa).

## Fichas que llegaron
| Ficha | Área | Severidad | Estado | Dónde |
|---|---|---|---|---|
| **75** | Pase de Wallet: sincronización (un miembro con error no tiene que trabar al resto) | — | **Pendiente**, programada para la sesión nocturna B (02:30, 09-nov). El cron de sincronización sigue apagado hasta cerrarla. | rama `claude/club-wallet` |
| **76** | Pase de Wallet (segunda ficha de la sincronización) | — | **Abierta, sin texto**: Ismael se lo pide a Grok. No se trabaja hasta tenerlo. | — |
| **90** | Local Club: visita del socio cuando ya usó el beneficio en el día | Media | **Hecha** (respuesta «ya usó hoy», «no aplicar beneficio», pantalla en rojo; prueba negativa) | `bd6786e` |
| **91** | Local Club: un solo socio con beneficio por factura | Media | **Hecha** (configurable; el segundo va como invitado; pruebas negativas) | `bd6786e` |
| **93** | Excepciones: aprobar personas pendientes revalida el estado actual | — | **Hecha** (pruebas) | `bd6786e` |
| **99** | Puente del PoS: lotes con datos inconsistentes | — | **Hecha** en la rama del pase del puente (pruebas del puente 11/11) | `e4678b3` (`claude/puente-item11-prod`) |

## Fichas sin texto en esta sesión
**77–89, 92 y 94–98:** no llegaron a esta sesión ni están en el repo. **Necesita a Ismael:** pasarlas (o confirmar que
no aplican al Club) para poder darles estado. Hasta entonces, su estado es **«sin texto»**, no «hecha».

## Para referencia: fichas de Grok de fuera del rango que se cerraron el 08-nov
| Ficha | Área | Estado | Dónde |
|---|---|---|---|
| 24 | club-web: verificación anti-robots y tope por red al crear cupones | Hecha | `5f98f75` |
| 39 | Búsqueda de la caja: tope por usuario y rastro | Hecha | `5f98f75` |
| 41 | Lecturas de datos personales con rastro (contacto, código, exportes, reporte del mes) | Hecha | `5f98f75`, `96ed1bd`, `377f077` |
| 56 | Gate de prod: modo prod del migrador | **Diseño** (RUNBOOK §12, sin implementar) | `f3c034e`, `377f077` |
| 61 | Gate de prod: diff exacto del catálogo | **Mecanismo hecho, probado solo en staging**; falta la lectura de prod con firma | `4fb5f28` |
| 63 | Aviso de privacidad para el turista que deja contacto | Hecha | `5f98f75` |

## Docs que quedan reemplazados por decisiones posteriores
- `AVANCE-LC.md`, autorrevisión del multilocal: «DECISIÓN PROVISORIA: no hay Club compartido entre locales» →
  **reemplazado** por el Club compartido (decisión de Ismael, 08-nov).
- `NOCHE-2026-11-08-RESUMEN.md` punto 7 y `PLAN-LC-lanzamiento.md` (cortesías, hallazgos del PoS): el 857 «INVITADO»
  como pregunta abierta → **reemplazado**: el 857 es el beneficio para quien viene con un socio, sin límite de
  acompañantes (decisión de Ismael, 08-nov; `bd6786e`).
