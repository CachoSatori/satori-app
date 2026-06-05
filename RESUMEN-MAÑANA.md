# Resumen de la auditoría nocturna — para Cacho

**Rama:** `audit/cleanup-nocturna` (NO está en producción · NO se tocó la base de datos · revisá y mergeá vos cuando quieras).

## En una frase
El sistema ya estaba **muy sano**. Hice una limpieza segura (3 commits chicos), documenté todo lo demás, y **no toqué nada de Caja, Propinas ni Finanzas** — lo verifiqué con el diff (está vacío para esos módulos).

## Lo que mejoró (con números)
| | Antes | Después |
|---|---|---|
| Dependencias | 12 | **8** (saqué 3 que no se usaban: Capacitor x2 y date-fns) |
| Errores de TypeScript | 0 | 0 (se mantiene) |
| `console.log` de debug | 0 | 0 |
| Código muerto removido | — | 2 funciones huérfanas + 3 formateadores duplicados |
| Build | ✅ verde | ✅ verde (208 ms) |

**Traducción:** la app queda un poco más liviana de instalar y con menos código repetido, sin ningún cambio en lo que ves ni en lo que calcula.

## Qué NO toqué (a propósito) y por qué
- **La base de datos**: cero cambios (es la regla; la base es la verdad).
- **Caja / Propinas / Finanzas / Food Cost**: cero cambios de lógica (son sagrados y están en uso diario).
- **Tipos de Supabase** (151 `as never`): es deuda técnica real pero arreglarla es riesgoso sin supervisión → lo dejé documentado con un plan.

## Bugs
- **Ninguno** que rompa cálculos. El único riesgo conocido es el **"se queda pensando" al guardar** cuando la sesión vence — ya lo mitigamos con timeouts; la solución de fondo (re-login automático) queda como recomendación.

## Próximos pasos recomendados (con vos presente)
1. **Mergear esta rama** a `main` (es seguro: solo limpieza, build verde).
2. **Regenerar los tipos de Supabase** y empezar a sacar los `as never` — mejora fuerte de robustez, archivo por archivo.
3. **Unificar `ROLE_LABELS`** (está copiado en 8 lugares) en una sola fuente.
4. **Atacar la causa raíz del "se queda pensando"** (reconexión/refresh de sesión del cliente Supabase).
5. Opcional: dedup del formateador `fi` también en los módulos financieros (es idéntico, pero quise que lo mires vos por ser plata).

> Detalle técnico completo en `AUDITORIA.md`.
