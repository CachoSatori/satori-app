# Casos de prueba — Borrado con autorización de gerencia

Flujo cubierto: borrar un movimiento de caja con autorización de owner/manager
(migración **044** + frontend). Fix: un cajero con credenciales de gerencia válidas
ahora SÍ puede borrar (antes la RPC rechazaba por el rol del llamador).

Piezas:
- RPC `delete_movement_cascade(p_movement_id, p_note, p_manager_email?, p_manager_password?)` — mig 044.
- `requireManager()` → `{ ok, managerEmail?, managerPassword? }` — [`ManagerOverride.tsx`](../src/shared/ManagerOverride.tsx).
- `useDeletionNote()` → modal de nota — [`deletionNote.tsx`](../src/modules/cash/deletionNote.tsx).
- `deleteCashMovement(id, note, managerEmail?, managerPassword?)` — [`cash.ts`](../src/shared/api/cash.ts).
- 5 puntos de borrado: CashMovimientos (`handleDelete`, `handleBulkDelete`) y CashTurno (pago/ingreso/egreso).

Leyenda: **[auto]** = candidato a test automatizado · **[manual]** = verificación en la app.

## Autorización

| # | Caso | Resultado esperado | Tipo |
|---|------|--------------------|------|
| 1 | Cajero + credenciales de **owner** válidas | Borra. `movement_deletions.authorized_by` = uid del owner; `deleted_by` = uid del cajero | [manual] · authorized_by [auto] |
| 2 | Cajero + credenciales de **manager** válidas | Borra. `authorized_by` = uid del manager; `deleted_by` = cajero | [manual] |
| 3 | Cajero + credenciales **inválidas** (mala contraseña / correo inexistente) | NO borra. Mensaje claro "Credenciales inválidas o sin permiso de gerencia…". El modal queda abierto para reintentar | [manual] |
| 4 | Cajero + credenciales de un rol **NO gerencial** (p. ej. otro cajero/salonero activo) | NO borra (la RPC exige `role in ('owner','manager')`). Mismo mensaje que #3 | [manual] · RPC [auto-DB] |
| 5 | **owner/manager logueado** | Borra SIN pedir credenciales (modal no aparece). `authorized_by` = su propio uid | [manual] |
| 6 | Cajero válido pero el manager fue **desactivado** entre el modal y la RPC | NO borra (la RPC re-valida `is_active`). Error del server visible | [manual, raro] |

## Red / estado

| # | Caso | Resultado esperado | Tipo |
|---|------|--------------------|------|
| 7 | **Offline** al confirmar el borrado | Error claro: "El borrado requiere conexión…". NO se encola (no queda borrado a medias) | [manual] · [auto] (mock isOffline) |
| 8 | verify_manager **sin conexión / timeout >10s** | Modal muestra "sin conexión o demoró demasiado…". No autoriza | [manual] |
| 9 | Error del **servidor** en verify_manager | Modal muestra "Error del servidor al verificar: …. Reintentá" | [manual] |

## UX del modal

| # | Caso | Resultado esperado | Tipo |
|---|------|--------------------|------|
| 10 | **Cancelar** el modal de gerencia (botón o click afuera) | `{ ok: false }` → no borra | [manual] · contrato [auto] |
| 11 | Modal de **nota vacía** o cancelado | `askNote` → null → no borra (no se llama a la RPC) | [manual] · contrato [auto] |
| 12 | En **móvil**: confirmar → gerencia → nota → borrar | Borra (era el bug original: el `window.prompt` se suprimía tras awaits; ahora es modal in-app) | [manual] |

## Cascada (integridad — la RPC, idéntica a 043)

| # | Caso | Resultado esperado | Tipo |
|---|------|--------------------|------|
| 13 | Borrar un pago de mercadería con inventario ingresado | Revierte el/los asiento(s) (`accounting_entries` contra-asiento + `status='reversed'`), descarta la tarea de inventario activa (`DESCARTADA`, motivo `cascade`), borra el inventario ligado y el movimiento | [manual] · [auto-DB] |
| 14 | Borrar un movimiento cuya factura no la referencia nada más | El documento huérfano se borra (permite recargar la factura sin chocar con el dedupe por sha256) | [manual] |
| 15 | Reintentar el borrado del mismo id (idempotencia) | Segundo intento no hace nada (la RPC retorna si el movimiento ya no existe) | [auto-DB] |

## Contrato del frontend (candidatos a test automatizado)

- `requireManager()` devuelve `{ ok }` (no boolean): owner/manager → `{ ok: true }` sin credenciales; cancelar → `{ ok: false }`. **[auto]**
- `deleteCashMovement` agrega `p_manager_email`/`p_manager_password` a los args **solo** cuando ambos vienen; sin ellos, los omite (owner/manager autoriza por rol). **[auto]**
- Ningún call site usa el patrón booleano viejo `if (!(await requireManager()))` — todos chequean `.ok`. **[auto/lint]**

## Auditoría — consulta legible para el contador

`deleted_by` = quién apretó; `authorized_by` = quién autorizó. Ejemplo:

```sql
select md.deleted_at,
       dp.full_name as borro,
       ap.full_name as autorizo,
       md.note,
       md.movement_snapshot->>'amount_crc' as monto_crc
  from public.movement_deletions md
  left join public.profiles dp on dp.id = md.deleted_by
  left join public.profiles ap on ap.id = md.authorized_by
 order by md.deleted_at desc
 limit 50;
```

> `authorized_by` queda `null` solo en borrados anteriores a la mig 044; de ahí en más se llena en todos los caminos.
