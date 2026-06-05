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

## Diseño de la solución de fondo (para aprobar — NO aplicado)
1. **Refresco proactivo en foco/visibilidad**: en `visibilitychange`→visible, `await supabase.auth.getSession()` (refresca si hace falta) **antes** de habilitar acciones críticas, para que al hacer click el token ya esté fresco. Evita la carrera click-vs-refresh.
2. **Revisar el `noLock`**: en vez de un lock no-op, usar el lock por defecto de supabase-js (basado en `navigator.locks`, que se auto-libera al cerrar la pestaña y tiene timeout interno) **o** un lock con timeout acotado. El no-op fue un parche; el lock con timeout es la opción robusta. Requiere prueba (no flipear a ciegas).
3. **Eliminar el 2º cliente**: verificar la contraseña del manager por una **RPC / Edge Function server-side** (chequeo de credenciales del lado servidor) en vez de un `signInWithPassword` en un cliente aparte. Quita por completo el 2º GoTrueClient. Requiere una function nueva.
4. **Cancelación + reintento idempotente** en escrituras críticas: `AbortController` con timeout corto + reintento (las operaciones ya son casi idempotentes: `createCashSession` tiene guarda de duplicados; `closeCashSession` es un UPDATE; conviene revisar `recordCierreSales`/inventario que ya son idempotentes por `document_id`).
5. **Sobre el timeout-wrapper actual**: una vez aplicados 1+2, el wrapper deja de ser necesario como "única defensa" pero conviene **mantenerlo** como última red (mostrar "recargá" si algo realmente se cuelga). No quitarlo hasta validar 1+2 en producción con el dueño.

## Cómo reproducir / validar
Abrir el cierre de caja, **mandar la pestaña a segundo plano > 1 h** (o suspender el equipo), volver y tocar "Cerrar" inmediatamente. Con la causa raíz: cuelga. Con el diseño (1+2): el token ya está fresco al volver → guarda sin colgarse.
