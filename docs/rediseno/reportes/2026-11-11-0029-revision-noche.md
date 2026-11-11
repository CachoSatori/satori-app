# Revisión nocturna · 2026-11-11 00:29 CR

## Para Ismael

- **Permiso para mergear a `staging` en las corridas automáticas.** #101 (A1) y #102 (B1) pasan todo y no llevan firma, pero el merge a `staging` lo bloqueó el control de permisos de la sesión automática («merge sin revisión»). No se buscó otra vía.
  - Mientras no se resuelva, la cola se frena: A2 depende de A1 y B2 de B1, así que las líneas de la madrugada no tienen tarea `lista`.
  - **Opciones:**
    1. Que la revisión de las 05:40 (o vos) mergee #101 y #102 tal cual (recomendado para hoy).
    2. Ajustar el permiso de la tarea programada para que pueda mergear a `staging`.
    3. Dejar el merge siempre a mano y que las revisiones solo aprueben.
  - **Recomendación:** opción 1 ahora y opción 2 para que el proceso funcione solo.
- **Duda de A1 (no bloquea):** como «Semana» siempre muestra la semana en curso, el % contra la semana anterior ya no aparece nunca: siempre dice «En curso». Si querés ver el %, hace falta un selector de semana o comparar a igual cantidad de días (esto último cambia un cálculo y lleva tu decisión).

## Estado de las tareas

| Tarea | Estado | Nota |
|---|---|---|
| A1 · Textos y etiquetas | `en revisión #101` · **aprobada, merge pendiente** | Pasa todo. No se pudo mergear (permiso). |
| A2 · Ventas agrupado | `pendiente` | Espera que A1 esté en `staging`. |
| A3 · «Borrar TODO el día» | `pendiente` · FIRMA | Sin firma en `DECISIONES.md`. |
| A4 · Medir Ventas | `pendiente` | Espera A2. |
| B1 · Colores en un solo lugar | `en revisión #102` · **aprobada, merge pendiente** | Pasa todo. No se pudo mergear (permiso). |
| B2 · Valores del diseño C | `pendiente` | Espera que B1 esté en `staging`. |
| B3 · Shell | `pendiente` | Espera B1 y A2. |
| B4 · Inicio con pendientes | `pendiente` | Espera B3. |

No se pasó ninguna tarea a `lista`: A2 y B2 armadas desde `staging` sin A1/B1 chocarían (`VentasModule.tsx`, `index.css`).

## Lo revisado (contra el repo)

Las dos ramas salen de la punta actual de `staging` (`fb29872`), sin conflictos entre sí (A1 no toca `index.css`; B1 solo toca `index.css`).

### #101 · A1 (`8f06131`)
- **Archivos:** `src/modules/resumen/ResumenSemanal.tsx`, `src/modules/ventas/VentasModule.tsx`, `src/modules/ventas/ventasNav.css` (nuevo), `src/modules/prueba/CierreSimulator.tsx`, `src/modules/admin/RolePointsConfig.tsx`, `src/modules/admin/ProductosAdmin.tsx`, guías 6.4 y 6.6. Todo de la línea A.
- **Prohibido:** nada. `CierreSimulator` sigue importando `saldoCajaFuerte` de `cashUtils` sin cambios; el `useAuth` agregado solo lee el perfil ya cargado.
- **Base:** ninguna `.insert/.update/.delete/.upsert/.rpc(` ni consulta nueva.
- **Cálculos:** ninguno cambia; «En curso» es solo cómo se muestra el % (`today <= thisWeek.to`). PAX pasa de `fi()` (con ₡) a `toLocaleString('es-CR')`.
- **Pestañas de Ventas:** `div` → `button` con `role="tab"`/`aria-selected`; el reset de `ventasNav.css` cubre fondo, bordes y fuente, y `.vt-nav-tab` ya fija color, tamaño y padding, así que el aspecto se mantiene.
- **Guías:** 6.4 y 6.6 actualizadas con `verificado_en_commit`. Prueba no tiene guía (anotado en el PR).
- **Datos personales:** ninguno.

### #102 · B1 (`8743bce`)
- **Archivos:** solo `src/index.css` (línea B).
- **Sin cambio visual, verificado por la revisión:** las `--c-*` tienen los mismos valores que las variables viejas (incluidos los bloques `--t-*` de `.tips-module` y de caja, y `--vt-*`, que tenían valores idénticos al global). Un script que reemplaza cada `var(--c-*)` por su valor y saca las definiciones de variables deja como única diferencia con `staging` comentarios y `#999`→`#999999` / `#444`→`#444444` (mismo color).
- **Guía:** no aplica (no cambia pantalla); dicho en el PR.
- **Datos personales:** ninguno.

### Gates (corridos por la revisión en las dos ramas y en `staging`)

| Gate | A1 | B1 | `staging` |
|---|---|---|---|
| build producción (pipefail) | ✅ | ✅ | ✅ |
| `npm test` sin `.env` | 6 archivos fallan al importar | igual | igual (los mismos 6) |
| `npm test` con variables ficticias de Supabase | 158 ✅, 1 ❌ `pos-bridge/backfill.test.ts` (falta `mssql`) | igual | — |
| `grep` de diagnósticos en `dist/` | vacío ✅ | vacío ✅ | vacío ✅ |
| diff de `cashUtils.ts` / `tipCalculations.ts` | vacío ✅ | vacío ✅ | — |

El único rojo es de entorno y existe igual en `staging`.

## Mergeado

Nada (bloqueado por permiso; ver «Para Ismael»).

## Pedido

Nada: ninguno de los dos PR necesita cambios.

## Riesgo

- **El proceso queda trabado** hasta que se mergeen #101 y #102: sin eso, las líneas no tienen tarea.
- **Gate de tests:** sigue sin correr limpio sin variables de Supabase ni `mssql`. Propuesta para la revisión de día: que el gate sea `npm test` con variables ficticias y que se excluya o se marque como conocido `pos-bridge/backfill.test.ts`.
- Sigue vigente el riesgo de la divergencia `staging`/`main` del reporte de las 15:41.
