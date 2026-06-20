# RCA (solo-lectura) — PWA que se queda en versión vieja en PRODUCCIÓN (GitHub Pages)

> Investigación SIN cambios de código/SW/build/deploy. Solo curl read-only + lectura de código + doc oficial.
> Fecha: 2026-06-19 · Prod: `https://cachosatori.github.io/satori-app/` (rama `main`, base `/satori-app/`).
> Staging: `https://satori-staging.pages.dev` (Cloudflare Pages, ya curado con `public/_headers`).

---

## (a) Headers crudos REALES — PROD vs STAGING

**PROD — GitHub Pages (Fastly/Varnish), deploy del 12-jun (`last-modified` Fri, 12 Jun 2026):**
```
/sw.js                 HTTP/2 200 · cache-control: max-age=600 · etag "6a2c824c-16ec" · via 1.1 varnish · x-served-by cache-pdk…
/registerSW.js         HTTP/2 200 · cache-control: max-age=600 · etag "6a2c824c-9c"
/index.html            HTTP/2 200 · cache-control: max-age=600 · etag "6a2c824c-b69"
/manifest.webmanifest  HTTP/2 200 · cache-control: max-age=600 · etag "6a2c824c-3e1"
/  (raíz)              HTTP/2 200 · cache-control: max-age=600
```
→ GitHub Pages sirve **`Cache-Control: max-age=600`** (10 min) en TODOS, incluidos sw.js/registerSW.js/index.html/manifest.
   No hay forma de cambiarlo: Pages **ignora `public/_headers`** (eso es una feature de Cloudflare/Netlify, no de Pages).

**STAGING — Cloudflare Pages (con `public/_headers`):**
```
/sw.js                 HTTP/2 200 · cache-control: no-cache, must-revalidate
/registerSW.js         HTTP/2 200 · cache-control: no-cache, must-revalidate
/index.html            HTTP/2 308 · cache-control: no-cache, must-revalidate
/manifest.webmanifest  HTTP/2 200 · cache-control: no-cache, must-revalidate
```
→ `no-cache, must-revalidate` en los archivos críticos. **Mismo código, distinto header.** Staging se curó; prod no.

---

## (b) Mecanismo de update del SW (estado actual del código, idéntico en main y staging)

**`vite.config.ts` (VitePWA):**
- `registerType: 'autoUpdate'` + `injectRegister: 'auto'` → el plugin **inyecta `registerSW.js`** que registra `sw.js`.
- `workbox`: `skipWaiting: true` + `clientsClaim: true` (el SW nuevo activa y toma control sin esperar).
- `globPatterns: ['**/*.{js,css,html,...}']` → **`index.html` se PRECACHEA**; `navigateFallback: index.html` → toda navegación SPA la sirve el SW desde el precache.
- **`updateViaCache` NO está seteado** en ningún lado del repo → vale el **default del navegador: `'imports'`**.

**`src/main.tsx`:** `checkUpdate()` (por cada registration: `reg.update()` + si hay `waiting` → `postMessage SKIP_WAITING`) al cargar **y cada 60 min**; `controllerchange` → `window.location.reload()` **una sola vez** (guard anti-loop de 60 s vía sessionStorage).

**`index.html` (watchdog de arranque):** si `__satoriBootOk` (lo setea `useAuth` al resolver sesión) NO se marca en **15 s** Y hay un SW controlando → des-registra SWs + vacía Cache Storage + recarga UNA vez (guard `satori-sw-rescued`). **Clave: solo se dispara ante un HANG DURO de arranque; NO ante "arranca bien pero es vieja".**

**`HANG-RCA.md` — estado de ítems:** ítem 1 (refresco token en foco) ✅ aplicado; ítem 2 (`safeNavigatorLock`) ✅; ítem 3 (`verify_manager` server-side) ✅; **ítem 4 (AbortController/timeout en escrituras) — NO aplicado** (sigue solo el `withTimeout`-wrapper como red). El ítem 4 es ortogonal a este RCA (es sobre escrituras que se cuelgan, no sobre el SW viejo).

---

## (c) Causa raíz — por qué el SW nuevo NO se toma en PROD (con evidencia)

**Diferenciador único confirmado: el header.** Cloudflare (staging) responde `no-cache, must-revalidate`;
GitHub Pages (prod) responde `max-age=600` en `/`, `sw.js`, `registerSW.js`, `index.html`, `manifest`. La doc
oficial de vite-plugin-pwa dice explícitamente que esos archivos **NO deben cachearse** (ver Fuentes).

**Cadena causal en prod:**
1. El SW viejo controla la página y, por `navigateFallback`, sirve el **`index.html` PRECACHEADO** (el de cuando ese SW
   se instaló) → referencia los **hashes de assets viejos** → la app carga la **versión vieja, pero funcional**.
2. Para actualizar hace falta que un **SW nuevo se instale**. Eso ocurre cuando el navegador detecta que `sw.js`
   cambió (su contenido incluye el manifest de precache, que cambia por build). La detección la disparan
   `reg.update()` (carga + cada 60 min) y la revisión del navegador al navegar.
3. **Acá pega el `max-age=600`:** con el default `updateViaCache: 'imports'`, el navegador NO fuerza bypass de su
   HTTP-cache para los scripts importados del SW, y tanto el navegador como **Fastly** consideran `sw.js`/
   `registerSW.js`/`index.html` "frescos" por 10 min (y la propagación de edge de Fastly suele estirarlo). Resultado:
   la revisión de update se satisface con copias **viejas cacheadas** durante la ventana → el SW nuevo **no se detecta**
   en la visita corta de la cajera. La app sigue sirviendo el shell viejo del precache.
4. El **watchdog de 15 s NO rescata** este caso: la app vieja arranca bien (`__satoriBootOk = true`), así que el
   watchdog—pensado para el hang duro—no entra. El único "arreglo" manual que le queda al usuario es **borrar caché**
   (que des-registra el SW + vacía Cache Storage) → de ahí el síntoma reportado.

**Contraprueba (mismo código):** en staging, `no-cache` hace que navegador y CDN revaliden `sw.js`+`index.html` en
cada request → el próximo `reg.update()` ve el SW nuevo de inmediato → `skipWaiting/clientsClaim` + `controllerchange`
→ recarga → versión nueva. Por eso staging se destrabó **solo con el header**, sin tocar código.

**Entonces, ¿es CDN, navegador o precache?** Es la **combinación**, gatillada por el header de Pages:
`max-age=600` (CDN Fastly + HTTP-cache del navegador) retrasa/impide la **detección** del `sw.js` nuevo, y el
**precache de workbox** del `index.html` viejo es lo que el usuario sigue viendo mientras tanto. El precache por sí
solo no es el bug (en staging existe igual y no molesta); el bug es la **detección tardía** por culpa del header,
que en Pages no se puede corregir con headers.

---

## (d) Opciones de arreglo — RANKEADAS (NINGUNA implementada; a evaluar)

> Restricción dura: en GitHub Pages **no se pueden setear headers** → el arreglo debe ser **client-side** (código),
> no `_headers`. Todo se prueba en **staging primero**. Sagrados no se tocan (esto es SW/registro, no plata).

### #1 (RECOMENDADA) — `updateViaCache: 'none'` en el registro del SW
- **Qué cambia:** `vite.config.ts` → `injectRegister: null` (o registrar a mano) **+** `src/main.tsx` registra el SW
  con `navigator.serviceWorker.register(swUrl, { updateViaCache: 'none', scope: BASE })`. (El `registerSW.js` que
  inyecta el plugin hoy NO setea `updateViaCache`; por eso vale el default `'imports'`. Verificar contra
  vite-plugin-pwa ^1.3.0 si expone la opción directo o si conviene el registro manual — main.tsx ya tiene lógica de SW.)
- **¿Funciona en Pages? ¿por qué?** Sí: es **comportamiento del cliente**, no depende de headers. `'none'` obliga al
  navegador a **bypassear su HTTP-cache** para el script del SW **y sus imports** en cada chequeo de update → revalida
  contra el origen en vez de reusar la copia "fresca". Ataca directamente la mitad "navegador" de la causa raíz.
- **Riesgo:** BAJO-MEDIO. Toca el registro del SW en prod (uso diario). Solo hace el chequeo más estricto; NO cambia
  activación (sigue `skipWaiting/clientsClaim` + recarga). Riesgo residual: la ventana de edge de Fastly puede seguir
  sirviendo `sw.js` viejo unos minutos post-deploy (GitHub purga Fastly al deploy, así que es acotado).
- **Cómo se prueba en staging ANTES de prod:** desplegar a staging, abrir como PWA instalada, hacer un cambio visible,
  re-deploy, y confirmar (sin borrar caché) que el SW nuevo se toma y la app recarga una sola vez (sin loop). Como
  staging ya tiene `no-cache`, además validar que el registro manual no rompa install/update/activación. Validación
  real = **canario en prod** (un dispositivo) por el comportamiento Fastly que staging no reproduce.

### #2 (COMPLEMENTO robusto) — Chequeo de versión con cache-bust en `checkUpdate()`
- **Qué cambia:** `src/main.tsx` → en `checkUpdate()` hacer `fetch(`${BASE}version.json?t=${Date.now()}`, {cache:'no-store'})`
  (un `version.json` minúsculo emitido en build con el hash/commit) y, si difiere del que corre, forzar
  `reg.update()` / `SKIP_WAITING` (o, último recurso, unregister + reload con el guard anti-loop ya existente).
- **¿Funciona en Pages? ¿por qué?** Sí: el **query `?t=` + `cache:'no-store'`** bypassea CDN y navegador para ESE
  fetch (no necesita headers). Detecta "estoy viejo" aunque el `sw.js` esté cacheado, y dispara la actualización.
- **Riesgo:** MEDIO. Más lógica y otro artefacto de build (`version.json`); hay que reusar el guard anti-loop para no
  ciclar recargas. Cinturón-y-tiradores sobre #1.
- **Cómo se prueba en staging:** igual que #1 + forzar un `version.json` distinto y ver que detecta y actualiza.

### #3 (RECHAZADA) — Cache-bust de la URL del `sw.js` (ej. `sw.js?v=hash`)
- **Qué cambia:** registrar `sw.js?v=<build>` para esquivar el cache.
- **¿Funciona?** NO conviene: cambiar la URL del SW **registra un SW distinto** (la identidad/scope se ata a la URL del
  script) → rompe el ciclo de update y puede dejar SWs duplicados. Anti-patrón. Se descarta.

### Nota sobre `_headers` (lo de staging) en prod
NO aplica: Pages ignora `_headers`. Si en el futuro se migrara prod a Cloudflare Pages (o se pusiera un proxy/CDN que
permita headers), la cura de staging (`no-cache, must-revalidate` en sw.js/index.html/manifest) sería la solución
canónica y de menor riesgo. Mientras prod siga en GitHub Pages, el arreglo tiene que ser client-side (#1, +#2).

---

## Fuentes
- [vite-plugin-pwa — Deployment (no cachear /, /sw.js, /index.html, /manifest.webmanifest)](https://vite-pwa-org.netlify.app/deployment/)
- [vite-plugin-pwa — repo](https://github.com/vite-pwa/vite-plugin-pwa)
- [Discussion #821 — Service Worker not detecting updates](https://github.com/vite-pwa/vite-plugin-pwa/discussions/821)
- [Issue #810 — SW tarda 30–60 s en detectar update](https://github.com/vite-pwa/vite-plugin-pwa/issues/810)
- [CSS-Tricks — Using the VitePWA Plugin for an Offline Site](https://css-tricks.com/vitepwa-plugin-offline-service-worker/)

> Evidencia de headers: `curl -sI` a prod y staging el 2026-06-19 (pegada en sección (a)). Solo-lectura; no se tocó prod.

---

## Implementación (rama `fix/pwa-sw-update-prod` — 2026-06-20, SIN merge)

Se construyeron #1 y #2. Commits discretos. Sagrados intactos (esto es SW/registro). Sin migraciones.

### #1 — `updateViaCache: 'none'` — VÍA ELEGIDA: registro manual (`injectRegister: null`)
- **Por qué esa vía:** se verificó que **vite-plugin-pwa ^1.3.0 NO expone `updateViaCache`** por config
  (su `registerSW` generado hace `navigator.serviceWorker.register(path, { scope, type })`, sin esa
  opción — confirmado en `node_modules/vite-plugin-pwa/dist/*`). Por eso la vía de **menor diff y limpia**
  es `injectRegister: null` + registro manual en `main.tsx`, que ya tenía la lógica de SW.
- **`vite.config.ts`:** `injectRegister: 'auto'` → `injectRegister: null` (deja de inyectar `registerSW.js`;
  el `sw.js`/workbox NO cambian → siguen `skipWaiting`+`clientsClaim`).
- **`src/main.tsx`:** `navigator.serviceWorker.register(`${BASE}sw.js`, { updateViaCache: 'none', scope: BASE })`
  (BASE = `import.meta.env.BASE_URL`). Toda la lógica previa se preserva (controllerchange→reload con guard,
  checkUpdate, SKIP_WAITING al waiting).

### version.json (infra de build)
- **`vite.config.ts`:** `appCommit()` = `GITHUB_SHA[:7]` en CI · `git rev-parse --short HEAD` en local ·
  timestamp como fallback. `define: { __APP_COMMIT__ }` (identidad embebida en el bundle) + plugin
  `versionJsonPlugin` que emite `dist/version.json` = `{ commit, builtAt }`. NO entra al precache
  (`globPatterns` no incluye `.json`) → siempre se pide a red.
- **`src/vite-env.d.ts`** (nuevo): `declare const __APP_COMMIT__: string` (+ `vite/client`).

### #2 — chequeo de version.json con cache-bust (`src/main.tsx`)
- Helper `nudgeUpdate()` (reg.update + SKIP_WAITING al waiting). `checkUpdate()` = `nudgeUpdate()` +
  `fetch(`${BASE}version.json?t=${Date.now()}`, { cache:'no-store' })`; si `commit !== __APP_COMMIT__`
  → `nudgeUpdate()`. **La recarga la hace SOLO el `controllerchange` existente (guard de 60s);** NO se
  agregó un segundo mecanismo de recarga (evita ciclos). Errores (offline/404/json inválido) → silencio.
- **Limitación honesta:** #2 es **señal + empuje**, no un bypass del `sw.js` cacheado por Fastly. Si Fastly
  aún sirve `sw.js` viejo (ventana ~10 min post-deploy, ya con purge), el siguiente `nudgeUpdate` lo toma
  cuando el edge refresca. No fuerza unregister+reload en mismatch (sería un 2º mecanismo de recarga).

### Verificación local (build artifact, `vite preview`) — funcional, NO final
- `build:staging` y build prod (base `/satori-app/`): **verdes**. `lint` 78/66 (= baseline, sin nuevos errores).
  `tests` 105/105.
- Servido con `vite preview` (base `/satori-app/`, = prod): `GET {BASE}version.json` → 200
  `{"commit":"…","builtAt":"…"}`; `GET {BASE}sw.js` → 200; `GET {BASE}registerSW.js` → **404** (ya no se
  inyecta); el bundle contiene refs `updateViaCache` y `version.json?t=`. `__APP_COMMIT__` == `version.json.commit`
  en el mismo build (no dispara falso "stale").
- **NO verificado localmente (requiere navegador real sobre un deploy):** install/activate del SW en cliente,
  el ciclo "redeploy → se toma sin loop", el intervalo de 60 min, y offline. El dev server de vite tiene
  `devOptions.enabled:false` → no corre el SW; y el merge a staging está prohibido en esta tarea.

### Cómo validar de verdad (lo decide la dueña)
1. **Staging primero:** mergear esta rama a staging (otra tarea), abrir la PWA instalada, hacer un cambio
   visible + redeploy, y confirmar SIN borrar caché: el SW nuevo se toma, recarga UNA vez (sin loop),
   `version.json` se sirve y compara, y offline sigue andando.
2. **Validación REAL = canario en PROD (GitHub Pages):** el comportamiento de Fastly (max-age=600 + purge
   en deploy) **NO se reproduce en Cloudflare/staging**. Probar en 1 dispositivo de prod tras un deploy:
   ¿el SW nuevo se toma solo, sin "borrar caché"? Eso es lo único que cierra el RCA.
