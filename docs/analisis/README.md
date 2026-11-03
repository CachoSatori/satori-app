# Análisis de datos

Análisis puntuales hechos con datos del PoS y de la app. Sirven de base para specs y reportes futuros.
Son **solo lectura**: no tocan la base ni el código de la app.

## Índice

| Fecha | Tema | README |
|---|---|---|
| 2026-11 | Mediodía, menú (familia 29 GREENSEASON) y descuento Local Club | [2026-11-mediodia-localclub/README.md](2026-11-mediodia-localclub/README.md) |

## Convención

Cada análisis va en `docs/analisis/<AAAA-MM>-<tema>/` con esta estructura:

| Carpeta / archivo | Qué tiene |
|---|---|
| `README.md` | Resultados, definiciones y cómo reproducir |
| `rondas/` | Cada ronda de queries con resultados e interpretación, en orden |
| `sql/` | Queries sueltas |
| `specs/` | SPECs que salieron del análisis |
| `scripts/` | Scripts (Python, etc.) de cálculo y agregados |
| `datos/` | CSV exportados de las queries (agregados) y planillas de insumo |

Al agregar un análisis, sumar una línea al índice de arriba.

## Regla

**Nunca guardar en CSV teléfono, dirección, cédula ni nombres de clientes.**
