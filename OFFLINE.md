# Satori App — Política OFFLINE-FIRST (sprint 2026-06-12)

Prerequisito del futuro módulo PoS. **El offline NO cambia ninguna fórmula**
(cashUtils, tipCalculations y cierres intactos) — solo cambia **cuándo viajan
los datos**, nunca **qué se calcula**.

## Arquitectura (3 piezas, `src/shared/offline/`)

| Pieza | Qué hace |
|---|---|
| `idb.ts` | Mini-wrapper de IndexedDB sin dependencias (stores: `cache`, `outbox`, `audit`). Se evaluó la lib `idb`: para este uso no justifica la dependencia. |
| `cache.ts` (FASE A) | `cachedFetch(key, fetcher)`: red primero (timeout 8s) → actualiza caché; sin red o red caída → sirve el caché al instante. Ningún módulo operativo queda vacío offline. |
| `outbox.ts` (FASE B) | Cola persistente de mutaciones con `client_op_id` (UUID). Replay en orden estricto al reconectar, idempotente server-side (mig 021). |

**Lecturas cacheadas**: caja (sesión abierta, sesiones, movimientos, proveedores,
cierres previos vía sesiones) · propinas (turnos, turno abierto, entradas,
empleados, puntos por rol). El refresh de fondo lo aportan los mecanismos ya
existentes (Realtime `useRealtimeRefetch` + refetch al volver el foco): al
reconectar recargan de red y re-escriben este caché.
**Nota de diseño**: no es SWR "puro" (servir caché y revalidar SIEMPRE) — online
se va directo a la red, como siempre; el caché entra solo cuando la red falta o
falla. Mismo resultado operativo, sin re-cablear cada componente.

**Escrituras encolables**: movimientos de caja (crear/editar/eliminar pagos,
ingresos y egresos) y entradas de propinas del turno (upsert/delete). Si fallan
por red se encolan y se ve el banner "N operaciones pendientes" + badge ⏳ en el
ítem. Reintento automático al reconectar (`online` + backoff 5s→60s) y botón
"Sincronizar ahora". La cola vive en IndexedDB → **sobrevive a cerrar y reabrir
la app**. Las listas proyectan la cola pendiente (insert/update/delete) sobre lo
leído, así los ítems encolados se ven aun tras reabrir.

## Idempotencia (migración 021)
`cash_movements.client_op_id` y `tip_entries.client_op_id` **UNIQUE (nullable)**.
Cada op encolada viaja con su UUID; un replay repetido rebota con `23505` y el
cliente la descarta de la cola — **jamás se duplica plata**. Además los inserts
de caja viajan con `id` generado en el cliente (= `client_op_id`), así las
ediciones/borrados encolados después referencian el mismo id que tendrá el
servidor; `tip_entries` converge por su upsert `(session_id, employee_id)`.

## Política de conflictos — LAST-WRITE-WINS (decisión y límites)
Al replayar un **update**, el ejecutor consulta `updated_at` del registro: si otro
dispositivo lo modificó DESPUÉS de la op local, **se aplica igual** (LWW), con
`console.warn` visible y registro en el store `audit` de IndexedDB (auditable en
el dispositivo). **Límites asumidos**: (1) LWW puede pisar la edición del otro
dispositivo — en esta operación (un cajero por caja) el caso es raro y el monto
queda auditado; (2) la auditoría es local al dispositivo, no central (subir el
flag a la DB exigiría otra columna — se decidió no ensuciar el esquema hasta que
la operación lo pida); (3) los relojes del cliente participan del orden — skew
extremo puede clasificar mal un conflicto (solo afecta el warning, no el dato).

### Orden y errores del replay
- **Orden estricto** por `seq` (autoincremental de IndexedDB): una edición nunca
  se aplica antes que su creación. Un fallo de RED **frena todo el flush** (se
  reintenta después desde el mismo punto).
- **Rechazo del servidor** (RLS, FK, datos inválidos): la op se **descarta** y se
  audita + `console.error` — dejarla trabaría la cola para siempre.
- **Multi-pestaña**: el flush corre dentro de `navigator.locks`
  (`satori-outbox-flush`, `ifAvailable`) → dos pestañas nunca replyan a la vez.

## Qué NO funciona offline (y por qué)
| Operación | Motivo |
|---|---|
| **Cierre del día (ambas fases)** y **cierre de la Caja Diaria** | Requieren estado consistente del servidor (saldo por ledger, idempotencia de ventas, orden de fases). Botón frenado con mensaje "El cierre requiere conexión". |
| **Apertura de caja / de turno de propinas** | Crea la sesión-contenedor en el servidor; operar contra una sesión fantasma rompería las FKs de todo lo encolado. Abrir con señal; después se puede operar sin red. |
| **Login inicial** | Sin sesión cacheada no hay con qué operar. Con sesión ya iniciada, la app abre y opera offline. |
| **Bandeja (fotos), Ventas XLS, reportes por mail** | Dependen de Storage/Edge Functions. |
| **Aprobar gerencia (verify_manager)** | Es una verificación server-side a propósito (seguridad > conveniencia). |

## Auth offline (interacción con la Fase 2 de sesión)
Con el token vencido y sin red, las mutaciones se encolan igual (la cola no
exige sesión válida para ENCOLAR; la exige el replay). Al reconectar, el refresh
proactivo (foco) renueva el token y el flush corre con sesión fresca. Sin
deadlock con `safeNavigatorLock`: el lock de auth tiene escape a los 10s y el
lock del flush es `ifAvailable` (nunca espera bloqueado).

## Cómo probar (dueña — ver plan completo en el reporte del sprint)
1. Con la caja abierta y señal, poné **modo avión**.
2. Registrá 2-3 pagos/egresos → aparecen con ⏳ y el banner cuenta pendientes.
3. **Cerrá la app del todo y reabrila** (sin señal): los ítems siguen ahí.
4. Sacá el modo avión → en segundos el banner desaparece y los ⏳ se van
   (o tocá "Sincronizar ahora").
5. Verificá en Movimientos que cada pago está UNA sola vez.
