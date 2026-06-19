# RCA — "Se queda pensando" al guardar (refresh/sesión de Supabase)

> Análisis de causa raíz. Mitigación segura aplicada; fix de fondo **diseñado para aprobación** (no aplicado a ciegas).

## Síntoma
Al guardar una operación crítica (cerrar turno de caja, confirmar en la Bandeja, etc.) **después de tener la pantalla abierta un rato**, el botón queda en "Guardando…/Cerrando…" para siempre. Recargar la app lo resuelve.

## Evidencia en el código
1. **`shared/api/supabase.ts:11-18`** — el cliente principal usa un **lock no-op** (`noLock`) para el refresh de token, con este comentario explícito:
   > *"the SDK uses navigator.locks to serialize refreshes… When a lock is never released (hard reload mid-refresh, expired session on first load) getSession() hangs forever."*
   Es decir: **ya hubo un hang de lock** y se "tapó" deshabilitando el lock. Pero deshabilitar el lock quita la serialización **sin** agregar un timeout al refresh en sí.
2. **`shared/ManagerOverride.tsx:15-17`** — se crea un **segundo `createClient`** (cliente temporal para verificar la contraseña del manager sin desloguear al cajero). Antes usaba el `storageKey` por defecto → **mismo namespace de localStorage y mismo nombre de lock** que el principal ⇒ warning *"Multiple GoTrueClient instances detected"* y contención del lock de refresh. (Es el único otro `createClient` del proyecto — confirmado por grep.)
3. **`shared/hooks/useAuth.tsx:45-49`** — `onAuthStateChange` dispara `loadProfile()` (una query) en **cada** evento, incluido `TOKEN_REFRESHED`. supabase-js refresca el token al recuperar foco/visibilidad de la pestaña ⇒ cada vez que el usuario vuelve a la app se relanza una query de perfil. No es el hang en sí, pero es un **re-fetch en cada foco** que se encadena con la operación del usuario.
4. **Operaciones críticas sin cancelación**: las escrituras (`closeCashSession`, `createCashMovement`, etc.) no tienen `AbortController`. Si la escritura se dispara **justo** cuando el token venció (pestaña en segundo plano > expiración), supabase-js intenta refrescar el token **inline** antes de mandar el request; ese refresh HTTP puede quedar colgado (reconexión tras suspensión del equipo, red intermitente de Santa Teresa) y, sin lock ni timeout, **la escritura espera para siempre**.

## Causa raíz (confirmada)
No es "lentitud". Es un **refresh de token que se cuelga** y bloquea la escritura, en un setup frágil:
- el `noLock` quitó el deadlock del lock pero dejó el refresh **sin timeout**;
- el **2º GoTrueClient** (ManagerOverride) compartía namespace de lock/storage con el principal (contención + warning);
- el refresh ocurre **en el peor momento** (al hacer click tras volver de segundo plano con token vencido), sin cancelación.
El `setTimeout`-wrapper agregado antes **no es la cura**: es una red de seguridad para no dejar la UI colgada. La cura es que el refresh no se cuelgue.

## Aplicado en esta auditoría (inequívocamente seguro)
- **`storageKey` propio para el cliente temporal de ManagerOverride** (`sb-satori-manager-override`). Aísla el 2º cliente → elimina el warning "Multiple GoTrueClient instances" y la contención del lock de refresh. Cero cambio de comportamiento (ese cliente ya usa `persistSession:false`). — commit `fix(auth): storageKey propio…`.

## Diseño de la solución de fondo (estado por ítem)
1. **Refresco proactivo en foco/visibilidad** — ✅ **APLICADO** (`src/shared/hooks/useAuth.tsx`,
   efecto `refreshOnFocus`): en `visibilitychange`→visible **y** `focus`, dispara
   `supabase.auth.getSession()` (refresca el token si venció) al volver a la app, para que al hacer
   click ya esté fresco. Evita la carrera click-vs-refresh. Es no-bloqueante (fire-and-forget con
   `.catch`): si el refresh falla, NO traba la UI — la red de seguridad de los timeouts en las
   escrituras sigue actuando. Complementa a `safeNavigatorLock` (ítem 2). Ver detalle en "Fase 2
   APLICADA" abajo.
2. **Revisar el `noLock`**: en vez de un lock no-op, usar el lock por defecto de supabase-js (basado en `navigator.locks`, que se auto-libera al cerrar la pestaña y tiene timeout interno) **o** un lock con timeout acotado. El no-op fue un parche; el lock con timeout es la opción robusta. Requiere prueba (no flipear a ciegas).
3. **Eliminar el 2º cliente**: verificar la contraseña del manager por una **RPC / Edge Function server-side** (chequeo de credenciales del lado servidor) en vez de un `signInWithPassword` en un cliente aparte. Quita por completo el 2º GoTrueClient. Requiere una function nueva.
4. **Cancelación + reintento idempotente** en escrituras críticas: `AbortController` con timeout corto + reintento (las operaciones ya son casi idempotentes: `createCashSession` tiene guarda de duplicados; `closeCashSession` es un UPDATE; conviene revisar `recordCierreSales`/inventario que ya son idempotentes por `document_id`).
5. **Sobre el timeout-wrapper actual**: una vez aplicados 1+2, el wrapper deja de ser necesario como "única defensa" pero conviene **mantenerlo** como última red (mostrar "recargá" si algo realmente se cuelga). No quitarlo hasta validar 1+2 en producción con el dueño.

## Cómo reproducir / validar
Abrir el cierre de caja, **mandar la pestaña a segundo plano > 1 h** (o suspender el equipo), volver y tocar "Cerrar" inmediatamente. Con la causa raíz: cuelga. Con el diseño (1+2): el token ya está fresco al volver → guarda sin colgarse.

---

## Fase 2 APLICADA (sprint 2026-06-11, rama sprint-junio-11 — staging)

**a) `noLock` → `safeNavigatorLock`** (`src/shared/api/supabase.ts`): lock real sobre
`navigator.locks` (serializa refreshes entre pestañas — el noLock permitía refreshes
concurrentes y un refresh token de un solo uso podía invalidar la sesión de otra pestaña),
con tope de adquisición de 10s: si el lock está colgado (el escenario de este RCA), aborta
la espera y ejecuta sin lock (= comportamiento noLock como peor caso).

**a-bis) Refresco proactivo en foco/visibilidad** (`src/shared/hooks/useAuth.tsx`, efecto
`refreshOnFocus`) — **ítem 1 del diseño, APLICADO**: al volver el foco/visibilidad de la pestaña
se dispara `supabase.auth.getSession()` para que el token ya esté fresco antes del próximo click.
No-bloqueante (no traba la UI si falla). Es el complemento de `safeNavigatorLock`.

**b) ManagerOverride server-side** (`migración 019` + `src/shared/ManagerOverride.tsx`):
RPC `verify_manager(email, password)` SECURITY DEFINER que valida contra `auth.users` con
pgcrypto y exige owner/manager **activo**. Reemplaza el cliente Supabase temporal del
navegador (signInWithPassword paralelo que podía colgarse en el refresh). Cliente con
timeout de 10s y errores diferenciados (credenciales vs red). `anon` tiene EXECUTE revocado.

**c) Cómo se probó el ciclo del RCA** (staging local, bundle build:staging servido estático,
sesión real de un usuario de prueba `test-cajero@staging.satori`):
1. Lock del SDK (`lock:sb-<ref>-auth-token`) retenido por una promesa que nunca resuelve +
   `expires_at` de la sesión forzado al pasado en localStorage + eventos
   `visibilitychange`/`focus` (= "volver a la app") → la sesión terminó refrescada
   (expires_at futuro), locks limpios y la app respondiendo. Sin hang.
2. Prueba determinística del escape-hatch (misma función, lock retenido por otro contexto):
   lock libre → ejecuta CON lock en 1ms; lock colgado → aborta a los ~10.5s y ejecuta sin
   lock. Nunca se queda esperando indefinidamente.
3. RPC desde el navegador con el JWT real del cajero: creds de manager OK → `true`;
   password mala → `false`; `anon` → 401 permission denied.

Pendiente de validación física (dueña): flujo completo del modal (cajero intenta eliminar
un registro guardado → modal → credenciales de gerencia) en un dispositivo real.
