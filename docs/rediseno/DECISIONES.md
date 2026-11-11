# Decisiones de Ismael

> Ismael decide **solo por el chat del asesor** (no usa GitHub). El asesor anota acá cada decisión, con fecha y hora CR.
> La revisión lee este archivo en cada corrida: es la única fuente de firmas, validaciones visuales y autorizaciones de pase a `main`.

| Fecha y hora | Qué | Decisión |
|---|---|---|
| 2026-11-10 09:00 | Proceso automático | Aprobado: 2 líneas + revisión. Las revisiones de la noche (0:20 y 3:20) son silenciosas; avisan las de 5:40 y 15:40. Si el consumo es mucho, se bajan corridas. |
| 2026-11-11 08:20 | Merge a `staging` de #101 (A1) y #102 (B1) | Aprobado («apruebo todo», por chat). Mergeados por la sesión de revisión con Ismael presente. |
| 2026-11-11 08:20 | Gate de tests | Aprobado: `npm test` con variables ficticias de Supabase; `pos-bridge/backfill.test.ts` (falta `mssql`) es fallo conocido de entorno. |
| 2026-11-11 08:40 | Ritmo del proceso | Aprobado: los merges a `staging` se aprueban por chat en tanda (el control de seguridad de las sesiones automáticas no deja mergear sin una persona). Las líneas corren 01:10/02:50, 10:10/10:50 y 16:10/16:50 (se sacan las de 04 y 06 h). A3 pasa a `lista` para que su PR esté listo para firmar. |
