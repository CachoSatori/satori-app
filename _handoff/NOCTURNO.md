# Corrida nocturna — satori-app — 2026-06-19

Tarea: secuencial Fase 0 → 1 → 2 → 3. Guardrails: nada a `main`, cero prod, sagrados intactos,
DDL solo aditivo, verde antes de cada commit, **parar en Fase 0 si la migración da error**.

---

## ▶︎ ACTUALIZACIÓN — Corrida 2 (2026-06-19): SOLO Fases 1 y 2 (la dueña pidió saltar 0 y 3)

Instrucción posterior: correr **solo** Fase 1 (caché del SW) y Fase 2 (refresco de token en foco),
saltando Fase 0 (la 038 la maneja la dueña aparte) y Fase 3 (Etapa 2 espera). Ambas **mergeadas a
staging**, build+lint+tests verdes. `main` intacto, cero prod, sagrados sin tocar.

### FASE 1 — Caché del Service Worker (Cloudflare Pages) → ✅ HECHA, en staging
- Build real (`npm run build:staging`) → nombres EXACTOS en la raíz de dist: `sw.js`, `sw-share.js`,
  `registerSW.js`, `manifest.webmanifest`, `index.html` (+ `workbox-*.js` ya hasheado → ese se cachea).
- Creado **`public/_headers`** con `Cache-Control: no-cache, must-revalidate` para esos archivos
  exactos + `/index.html` + `/`. (En PROD/GitHub Pages se ignora; solo aplica en Cloudflare/staging.)
- Verificado que `_headers` se copia a `dist/` en el build.
- Commit `fix(pwa): _headers no-cache…` → merge no-ff a staging (`67740da`).
- **Verificación curl ANTES/DESPUÉS** del deploy: ver bloque al pie de este archivo.

### FASE 2 — Refresco proactivo de token en foco (ítem 1 HANG-RCA) → ✅ YA ESTABA, doc corregida
- **El código del ítem 1 ya estaba implementado y vivo en staging**: `src/shared/hooks/useAuth.tsx`,
  efecto `refreshOnFocus` → en `visibilitychange`→visible **y** `focus` dispara
  `supabase.auth.getSession()` (refresca el token vencido al volver), no-bloqueante. (Lo agregó el
  sprint del SW como complemento de `safeNavigatorLock`.)
- NO reescribí código de auth que ya funciona (riesgo sin beneficio). NO toqué `safeNavigatorLock`
  ni `verify_manager` ni el AbortController (ítem 4, fuera de alcance).
- Lo único desactualizado era **HANG-RCA.md**, que listaba el ítem 1 como "NO aplicado" → corregido a
  **APLICADO** (commit `docs(hang-rca)…`, `1e51923`).
- **Para la dueña:** "guardar tras volver de 2º plano" ya funciona en staging desde antes; esta
  corrida solo dejó la documentación fiel.

---

## RESUMEN: PARADO EN FASE 0 (🔴). Fases 1, 2 y 3 NO ejecutadas.

La migración 038 **NO se pudo aplicar** a staging por un bloqueo de historial preexistente, y la
única salida que ofrece el CLI exige reescribir el historial de una migración de PLATA (035, de
propina-pool) — prohibido por los guardrails. Honrando el "PARÁ" explícito de la Fase 0, **no toqué
nada más** y no avancé a las fases siguientes. **La base de staging quedó SIN cambios.**

---

## FASE 0 — Aplicar 038 a STAGING → 🔴 BLOQUEADA (sin mutaciones)

- Proyecto linkeado verificado = `hwiatgicyyqyezqwldia` (STAGING, no prod). ✓
- `supabase migration list --linked` (read-only): **038 es la única migración local pendiente**, PERO
  el remoto tiene **035** (solo en rama `propina-pool`, sin merge — es propina→pool, **PLATA**) y un
  **009** fantasma (artefacto de orden por el baseline `0095`).
- `supabase db push --linked --dry-run` (read-only, **no aplica nada**): se niega con
  *"Remote migration versions not found in local migrations directory"* y sugiere
  `supabase migration repair --status reverted 009 035` + `supabase db pull`.
- **No ejecuté esa remediación:** marcar 035 como "revertida" miente sobre el estado real (035 SÍ está
  aplicada en staging) y toca una migración de plata → fuera de alcance y contra los guardrails.
- Sin `psql` ni password de la DB → no pude aplicar SOLO el SQL de 038 por fuera de `db push`.
- Log completo con evidencia y opciones de desbloqueo: **[_handoff/038-apply.log](038-apply.log)**.

**Para desbloquear (decisión humana):** OPCIÓN A (recomendada) — aplicar el SQL de 038 desde el SQL
Editor del dashboard de **staging** (es aditiva e idempotente) y luego `supabase migration repair
--status applied 038`; o dar el password de la DB de staging. OPCIÓN B — decidir qué hacer con
035/009 en el historial y recién ahí `db push`. Tras aplicar: regenerar tipos y verificar columnas
`factura_verified_by/at`, policy `cash_movements_contador_insert`, función `mark_factura_verified`.

## FASE 1 — Caché del Service Worker → ✅ HECHA (Corrida 2, ver arriba). En staging.
## FASE 2 — Refresco de token al volver el foco → ✅ ítem 1 ya estaba; doc corregida (Corrida 2).
## FASE 3 — Etapa 2 scaffold (rama feat/bandeja-etapa2) → ⏸️ NO EJECUTADA (la dueña la dejó en espera).

---

## (1) Qué quedó en STAGING para que la dueña pruebe físicamente (en orden)
1. **Caché del SW — YA NO HACE FALTA BORRAR CACHÉ:** un deploy nuevo se ve al recargar. El `sw.js`,
   `registerSW.js`, el manifest y el shell responden `no-cache, must-revalidate` (verificado por curl,
   bloque al pie). Probar: hacer un cambio visible, recargar la PWA → debería aparecer sin limpiar caché.
2. **Guardar tras volver de 2º plano:** mandar la app a segundo plano > 1 h (o suspender el equipo),
   volver y tocar "Cerrar turno"/confirmar en la Bandeja → debería guardar sin quedarse "pensando"
   (el token se refresca al volver el foco; ítem 1 HANG-RCA, ya vivo en staging).
3. **Los dos caminos de la 038 (contador registra desde la Bandeja + botón "✓ Verificar"):** SIGUEN
   APAGADOS — **dependen de aplicar la migración 038**, que NO se aplicó (Fase 0 bloqueada, ver arriba).
   Gating por RLS, esperado. Se encienden recién cuando la dueña desbloquee y se aplique la 038.

## (2) Qué quedó en feat/bandeja-etapa2 sin mergear
**NADA.** La rama no se creó (Fase 3 quedó en espera por decisión de la dueña).

## (3) Fases que pararon en rojo
**Fase 0 (🔴)** — bloqueo de historial de migraciones (035/009), detallado arriba y en
`038-apply.log`. Necesita decisión humana. **Fases 1 y 2 quedaron verdes y en staging** (Corrida 2).

---

## Verificación curl Fase 1 — ANTES vs DESPUÉS del deploy (satori-staging.pages.dev)

ANTES (deploy sin `_headers`, default de Cloudflare Pages):
```
/sw.js          → HTTP/2 200 · cache-control: public, max-age=0, must-revalidate
/registerSW.js  → HTTP/2 200 · cache-control: public, max-age=0, must-revalidate
/index.html     → HTTP/2 308  (redirige a /)
```

DESPUÉS (deploy con `public/_headers`, merge en staging):
```
/sw.js                 → HTTP/2 200 · cache-control: no-cache, must-revalidate
/sw-share.js           → HTTP/2 200 · cache-control: no-cache, must-revalidate
/registerSW.js         → HTTP/2 200 · cache-control: no-cache, must-revalidate
/manifest.webmanifest  → HTTP/2 200 · cache-control: no-cache, must-revalidate
/  (shell)             → HTTP/2 200 · cache-control: no-cache, must-revalidate
```
→ Objetivo cumplido: el SW y el shell responden `no-cache / must-revalidate`. Los assets con hash
(`assets/*`, `workbox-*.js`) se siguen cacheando (inmutables) — no se tocaron.
