# Pase a producción · arreglos de la auditoría del 12-nov (208–210)

- **209:** `main` `cf1a61d` (#109, #125) mergeado en `claude/rediseno-prod-estilo`, sin conflictos. Head `918447b`, 0 commits atrás de `main`. Build ✅ · `npm test` 139 archivos / 1721 tests ✅ (incluye `club-web/src/build.test.ts`).
- **208:** `0fe4033`: señal `club` en `pendientes.ts`; si falla `getExcepcionesAbiertas`, «sin comprobar» y nunca «Todo en orden» (owner y manager). Misma lectura y mismo momento. 6 tests nuevos. Guía 6.1.
- **210:** A9 se queda: pedido explícito de Ismael (00:10) y validado (00:15). Aclarado en DECISIONES; la auditoría leyó DECISIONES antes de esas entradas.
- **Reverificado contra `main`:** sin `supabase/`, sagrados, `pos/`, `salarios/`, `ProductosAdmin`, `vite.config.ts`; 0 escrituras; 0 cambios de rutas; `modulos.ts` = `MODULES` de `main` (14) y `ROLE_LANDING` = `main`.
- **Pendiente para el merge:** validación de Ismael en la vista previa de `918447b` por rol, entrada de autorización en DECISIONES, tag `pre-rediseno` y ventana (antes de las 17:00 CR según la auditoría; nunca 19–22).
- Fuera de alcance (auditoría): 202 (atrapar el foco en «Más»), 205 (monospace restante), 206 (Noto Serif JP por Google).
