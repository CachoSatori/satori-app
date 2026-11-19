# PASE a PROD — Edge `pago-notificar`: un correo por pago, con la lista de facturas (⛔ firma para desplegar)

> Repo público: sin valores de secretos, proveedores, destinatarios ni montos reales. Solo nombres y huellas.
> Decisión del dueño: 19-nov 08:48 CR. Esta rama **no va a `main`** (regla 2 de ESTADO, guarda R04).

## Qué pasa y qué no
- **Pasa:** la función acepta `{ movimiento_ids: uuid[] }` y manda **un** correo por llamada con todas las facturas
  del pago: fecha y referencia de cada una (`description || subcategory`, como la app), lo facturado, el crédito a favor aplicado (si hubo) y lo **pagado**
  (facturado − crédito no reversado), el total pagado en la moneda que corresponda (₡, $ o ambas: una factura solo en dólares no dice «₡0 total
  pagado»), la **fecha del pago** (CR) y el método. Sigue aceptando
  `{ movimiento_id }` (la app de hoy) como lista de 1. Nuevo: valida que todas sean del mismo proveedor y estén
  pagadas (`aprobado`); si no, no manda nada. Si alguna no está pagada todavía (p. ej. en la cola offline) contesta
  **409 con `pendientes: [ids]`** para que la app pueda reintentar después (la app no lo usa todavía: anotado para #303). Sella `proveedor_notificado_at` en todas.
- **Fecha del pago (ronda 2), en este orden:** (a) la última fila de `movement_edits` (052) del movimiento con
  `changed.status.new = 'aprobado'`; (b) si no hay fila legible, el **día CR de `created_at`** del movimiento, lo que
  mostraba la v15. Cubre los pagos que nacieron pagados o son anteriores a la auditoría (una parte grande de los pagos a proveedor en prod)
  y al cajero (RLS de `movement_edits` = owner/manager/contador). (c) Solo si no hay ninguna fecha confiable, la del
  envío, rotulada **«enviado el»**: nunca la fecha del envío como «fecha del pago». Un reenvío días después no cambia
  la fecha del pago.
  - Límite conocido de (b): una factura registrada pendiente y pagada otro día **por un cajero** sale con el día en que
    se registró (igual que la v15). Arreglarlo exige que el cajero pueda leer el momento del pago (migración): fuera de
    esta ronda.
- **No pasa:** no cambia la autenticación (JWT + RLS, sin service_role), la decisión de enviar
  (`notificar_pago = 'email'` + correo), el remitente, ni `verify_jwt` (sigue **on**). Sin migraciones, sin secretos.

## SHA y huellas
- Fuente: rama `claude/pago-notificar-agrupado`. Primer commit = el código de prod v15 (588c5593 + remitente propio);
  el SHA a firmar es la cabeza de la rama al firmar.
- Prod antes (19-nov, solo lectura con `get_edge_function`): **v15 · on** · `ezbr_sha256` `4657572543c1…`.

## Orden del pase (la app va DESPUÉS)
1. **Esta Edge** (compatible con los dos formatos). Con la app de hoy sigue saliendo un correo por factura, pero ya con
   la fecha real y lo pagado.
2. **La app** (#303, borrador, rama `claude/pago-agrupado-app`): una llamada por proveedor. Pendiente para #303:
   leer `pendientes` del 409 y reintentar solo esos ids cuando salgan de la cola. Si por error la app llegara
   antes, la Edge vieja contesta 400 «Falta movimiento_id» y la app cae sola a una llamada por id (lo de hoy).

## Responsables
- Ejecución: la sesión con el turno de prod. Control: el dueño (o quien designe), distinto de quien ejecuta.

## Antes (solo lectura)
- [ ] `pago-notificar`: versión 15, `verify_jwt` = on, hash = `4657572543c1…`. Si es otro, **parar**.
- [ ] Hash de las demás funciones anotado.

## Despliegue
```bash
git switch claude/pago-notificar-agrupado   # el SHA firmado
supabase functions deploy pago-notificar --project-ref yiczgdtirrkdvohdquzf --use-api
```
Sin `--no-verify-jwt`.

## Después
- [ ] `pago-notificar`: versión +1, `verify_jwt` **on**, hash nuevo anotado. Las demás, mismo hash.
- [ ] Humo sin datos: `POST` sin `Authorization` → 401; con JWT y `{}` → 400 «Faltan movimiento_ids».
- [ ] Prueba real con OK del dueño: proveedor de prueba con `notificar_pago = 'email'` y un correo **del dueño**, dos
      facturas de prueba pagadas juntas (una con crédito aplicado). Un correo, dos filas, fecha de hoy, pagado = facturado −
      crédito. Con un usuario cajero (sin auditoría legible): la fecha del pago es el día de registro, nunca «hoy» por
      el envío si la factura es de otro día. Si no se puede, queda **pendiente** (no probado).

## Criterios de parada
Hash de antes distinto · `verify_jwt` cambia · el correo sale con lo facturado como pagado, con «₡0 total pagado» en
una factura en dólares, o con la fecha del envío rotulada «fecha del pago»
→ **parar y volver atrás**. El pago nunca depende del correo (fire-and-forget).

## Vuelta atrás
- Volver a desplegar el primer commit de la rama (el código de prod v15):
  `git switch --detach 99a53281 && supabase functions deploy pago-notificar --project-ref yiczgdtirrkdvohdquzf --use-api`.
  Si la app nueva ya está en `main`, sigue funcionando: la Edge vieja le contesta 400 y la app cae a una llamada por id.
- Sin datos ni esquema que deshacer.

## Firma y bitácora
| Fecha y hora (-06:00) | Quién | Qué |
|---|---|---|
| 19-nov-2026 (-06:00) | sesión de la rama | Ronda 2 (revisión): fecha del pago auditoría → `created_at` → «enviado el»; referencia `description \|\| subcategory`; total en su moneda; 409 con `pendientes`. Sin desplegar. |
| | | |
