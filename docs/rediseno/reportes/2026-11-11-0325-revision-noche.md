# Revisión nocturna · 2026-11-11 03:25 CR

## Para Ismael

- **Sigue trabado el merge a `staging` (mismo problema que a las 00:29).** #101 (A1) y #102 (B1) se volvieron a verificar y pasan todo, sin firma necesaria. El merge lo volvió a bloquear el control de permisos de la sesión automática («merge sin revisión»). No se buscó otra vía.
  - **Consecuencia:** las líneas A y B de las 04:10, 04:50, 06:10 y 06:50 no tienen tarea `lista` y van a terminar sin hacer nada.
  - **Opciones:**
    1. Que la revisión de las 05:40 (o vos, con una palabra en el chat del asesor) mergee #101 y #102 tal cual. **Recomendado para hoy.**
    2. Ajustar el permiso de las tareas programadas de revisión para que puedan mergear a `staging`.
    3. Dejar el merge siempre a mano y que las revisiones solo aprueben.
  - **Recomendación:** opción 1 ahora y opción 2 para que el proceso funcione solo. Si se elige la 3, conviene bajar las corridas de las líneas de la madrugada para no gastar consumo en corridas vacías.
- La duda de A1 sobre «En curso» (anotada a las 00:29) sigue abierta; no bloquea.

## Qué cambió desde las 00:29

Nada en el rediseño:
- #101 sigue en `8f06131` y #102 en `8743bce` (mismas puntas que se aprobaron);
- `staging` sigue en `fb29872`;
- no hay reportes nuevos de las líneas ni entradas nuevas en `DECISIONES.md`;
- no hay PR `[rediseño …]` nuevos.

(`main` avanzó a `66b3b85` con #96 y #108, que son docs de pases y no afectan al rediseño.)

## Estado de las tareas

| Tarea | Estado | Nota |
|---|---|---|
| A1 · Textos y etiquetas | `en revisión #101` · **aprobada, merge pendiente** | Pasa todo de nuevo. Merge bloqueado (permiso). |
| A2 · Ventas agrupado | `pendiente` | Espera A1 en `staging`. |
| A3 · «Borrar TODO el día» | `pendiente` · FIRMA | Sin firma en `DECISIONES.md`. |
| A4 · Medir Ventas | `pendiente` | Espera A2. |
| B1 · Colores en un solo lugar | `en revisión #102` · **aprobada, merge pendiente** | Pasa todo de nuevo. Merge bloqueado (permiso). |
| B2 · Valores del diseño C | `pendiente` | Espera B1 en `staging`. |
| B3 · Shell | `pendiente` | Espera B1 y A2. |
| B4 · Inicio con pendientes | `pendiente` | Espera B3. |

No se pasó ninguna tarea a `lista`, por el mismo motivo que a las 00:29: armar A2 o B2 desde `staging` sin A1/B1 chocaría en `VentasModule.tsx` e `index.css`.

## Lo revisado (contra el repo, de nuevo)

### #101 · A1 (`8f06131`)
- 8 archivos, todos de la línea A: `ResumenSemanal.tsx`, `VentasModule.tsx`, `ventasNav.css` (nuevo), `CierreSimulator.tsx`, `RolePointsConfig.tsx`, `ProductosAdmin.tsx` y las guías 6.4 y 6.6.
- Nada prohibido; ninguna `.insert/.update/.delete/.upsert/.rpc(` agregada.
- Guías actualizadas; sin datos personales (sin correos, teléfonos ni montos).
- GitHub: `mergeable: clean`.

### #102 · B1 (`8743bce`)
- Solo `src/index.css` (línea B). La verificación de «sin cambio visual» de las 00:29 sigue valiendo: la punta no cambió.
- Sin escrituras a la base; sin datos personales.
- GitHub: `mergeable: clean`. No choca con A1 (archivos disjuntos).

### Gates (corridos por esta revisión, en las dos ramas)

| Gate | A1 | B1 |
|---|---|---|
| build producción (pipefail) | ✅ | ✅ |
| `npm test` con variables ficticias de Supabase | 158 ✅ · 2 omitidos · 1 ❌ `pos-bridge/backfill.test.ts` (falta `mssql`, de entorno; igual en `staging`) | igual |
| `grep` de diagnósticos en `dist/` | vacío ✅ | vacío ✅ |
| diff de `cashUtils.ts` / `tipCalculations.ts` | vacío ✅ | vacío ✅ |

## Mergeado

Nada (bloqueado por permiso).

## Pedido

Nada: ninguno de los dos PR necesita cambios.

## Riesgo

- **La cola sigue trabada** y las corridas de la madrugada van a salir vacías.
- **Gate de tests:** sigue la propuesta de las 00:29 (correr con variables ficticias y marcar `pos-bridge/backfill.test.ts` como conocido).
- Sigue vigente la divergencia `staging`/`main` del reporte de las 15:41.
