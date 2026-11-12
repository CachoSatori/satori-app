# Decisiones de Ismael

> Ismael decide **solo por el chat del asesor** (no usa GitHub). El asesor anota acá cada decisión, con fecha y hora CR.
> La revisión lee este archivo en cada corrida: es la única fuente de firmas, validaciones visuales y autorizaciones de pase a `main`.

| Fecha y hora | Qué | Decisión |
|---|---|---|
| 2026-11-10 09:00 | Proceso automático | Aprobado: 2 líneas + revisión. Las revisiones de la noche (0:20 y 3:20) son silenciosas; avisan las de 5:40 y 15:40. Si el consumo es mucho, se bajan corridas. |
| 2026-11-11 08:20 | Merge a `staging` de #101 (A1) y #102 (B1) | Aprobado («apruebo todo», por chat). Mergeados por la sesión de revisión con Ismael presente. |
| 2026-11-11 08:20 | Gate de tests | Aprobado: `npm test` con variables ficticias de Supabase; `pos-bridge/backfill.test.ts` (falta `mssql`) es fallo conocido de entorno. |
| 2026-11-11 10:14 | Ritmo del proceso | Aprobado: los merges a `staging` se aprueban por chat en tanda (el control de seguridad de las sesiones automáticas no deja mergear sin una persona). Las líneas corren 01:10/02:50, 10:10/10:50 y 16:10/16:50 (se sacan las de 04 y 06 h). A3 pasa a `lista` para que su PR esté listo para firmar. |
| 2026-11-11 11:45 | A2 (#111) y B2 (#112) | Validadas visualmente por Ismael en las vistas previas de Cloudflare (`claude-rediseno-a2…` y `claude-rediseno-b2…`) y aprobado el merge a `staging` («quedó bien», «B está revisado y también muy bien»). A2 pasó además una revisión independiente (subagente). |
| 2026-11-11 12:55 | **Firma A3** (#113, `CashCierre.tsx`, solo JSX) y **validación visual B3** (#114, menú global) | Firmado y validado por Ismael («firmo A3 B3»), en las vistas previas de Cloudflare. Mergeados a `staging`. Autoriza además reprogramar las líneas para correr lo antes posible. |
| 2026-11-11 14:10 | Validación visual B4 (#115) y A5 | B4 validado en la vista previa («todo ok») y mergeado a `staging` (merge #115 a las 14:25; corregido por la auditoría, hallazgo 207). **A5 aprobada** («a5 si»): Ventas carga a pedido; cambia *cuándo* se consulta (no qué ni cómo), sin migraciones ni `posNdf.ts`. |
| 2026-11-11 15:15 | Alcance antes del pase a `main` | **Todo junto:** el estilo carta se lleva a los módulos (Ventas, Caja, Propinas, Resumen, Admin, Inventario) antes del pase. Se arreglan los hallazgos de la auditoría externa del 11-nov (195–207). |
| 2026-11-11 15:15 | Archivos de la línea A | **Ampliados:** `src/modules/cash/**` (solo pantalla; sin sagrados ni lógica de cierres; todo archivo de cierre lleva FIRMA), `src/modules/tips/**` (sin `tipCalculations.ts`), `src/modules/inventario/**`. |
| 2026-11-11 15:15 | Formato de colones | **Al estándar:** «₡1.460.000» (₡ pegado, punto de miles) en toda la app, incluidos los textos que se comparten. Cambia solo la presentación. |
| 2026-11-11 15:51 | Merge de A5 (#116) a `staging` | Aprobado por Ismael en el chat («a5 ya habíamos dicho que sí»). Gates corridos de nuevo por la revisión; mergeado (`f80b117`). |
| 2026-11-11 15:55 | Auditoría 197 (cuándo lee el Inicio la alerta de días sin cierre) | **Una vez por sesión:** se lee la primera vez que se entra al Inicio y se reusa hasta cerrar la app o recargar; los otros pendientes se pintan sin esperarla. Cambia solo *cuándo* se consulta (no qué ni cómo); excepción autorizada para B5. |
| 2026-11-11 22:05 | Merge de A6 (#120) a `staging` | Aprobado por Ismael («a6 ok») tras ver la vista previa. Colones «₡1.460.000» en toda la app; selector de Admin legible. |
| 2026-11-11 22:50 | Paralelo | Con la autorización de Ismael de adelantar al máximo («sigamos avanzando»): A10 pasa a la línea B como B7 con sus archivos habilitados solo para esa tarea; A8 no espera a A7 (archivos distintos). |
| 2026-11-11 22:55 | A7 (#121) y B6 (#122) | Validadas por Ismael en las vistas previas («a7 ok b6 ok») y mergeadas a `staging` (`32c88bb`, `6510e21`). |
| 2026-11-11 22:55 | **Firma anticipada de A8** (Caja con estilo carta) | Ismael firma A8 («a8 firmo») antes de que exista el PR. **Condición de la revisión:** vale solo si el diff de los archivos de cierre es exclusivamente de estilo y texto (sin funciones, condiciones, cálculos ni consultas). Si aparece algo más, se vuelve a pedir firma mostrando el cambio. |
