# Revisión nocturna · 2026-11-12 03:21 CR (silenciosa)

## Para Ismael
- **Pase chico del Daruma a `main` (PR #131, `63981ea`, `mergeable: clean`, base `9efde77`):** espera tu firma. Son 3 archivos (`src/index.css`, `src/pages/auth/LoginPage.tsx` y la guía 6.1), los mismos de B8. Esta revisión no lo toca: lo arma y lo mergea la revisión de día con tu OK, fuera de 19–22 h.
- **Dudas que dejó B8** (ninguna urgente):
  - En el Inicio en computadora se ven **dos Darumas** casi juntos (menú y barra de arriba), como pediste. Si se ve repetido, se oculta el de la barra con una línea de CSS.
  - **Semana y Reporte mensual** no tienen el Daruma en el encabezado porque usan estilos en línea; hace falta una tarea chica de la línea A (ponerles una clase). Salarios, Comandero, KDS y Mi Turno quedan sin Daruma (fuera del rediseño).
- **No hay tareas para las líneas.** Las colas A y B están terminadas (A1–A9, B1–B8). Si querés una tanda 3, siguen los candidatos de la revisión de 00:25: 202 (foco en la hoja «Más»), 205 (monospace que queda), 206 (Noto Serif JP por Google), la paleta `--c-serie-*` y, ahora, el Daruma en Semana y Reporte mensual. **Recomendación:** decidirlo después del pase #131.

## Reportes leídos desde la última revisión (`2026-11-12-0025-revision-noche.md`)
- `2026-11-12-0030-pase-prod.md`, `2026-11-12-0030-pase-hecho.md` y `2026-11-12-0040-pase-auditoria.md`: pase de #128 a `main` (`9efde77`), ya registrado en `DECISIONES.md` 00:25–00:29. Fuera del alcance nocturno.
- `2026-11-12-0301-B-B8.md`: B8 (#130), validada por Ismael y mergeada a `staging` (`154208d`) según `DECISIONES.md` 03:15.

## PR abiertos `[rediseño …]` hacia `staging`
- **Ninguno.** El único PR del rediseño abierto es #131, hacia `main`: no se revisa ni se mergea de noche.

## Estado de las tareas
| Tarea | Estado |
|---|---|
| A1–A9 | `hecha` |
| A10 | movida a B7 (`hecha`) |
| B1–B8 (y B5b) | `hecha` |

No hay tareas `pendiente` para pasar a `lista`.

## Mergeado
- Nada.

## Pedido
- Nada.

## Riesgo
- Ninguno nuevo. `staging` en `154208d` (merge de #130); `main` en `9efde77` (merge de #128).
- Limpieza menor: queda la rama `claude/rediseno-B8` (con mayúscula), duplicada de `claude/rediseno-b8`; el proxy no deja borrarla. Se puede borrar a mano.
