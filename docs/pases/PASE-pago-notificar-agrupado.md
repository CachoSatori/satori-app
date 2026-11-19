# PASE a PROD — Edge `pago-notificar`: un correo por pago, con la lista de facturas (⛔ firma para desplegar)

> Repo público: sin valores de secretos, proveedores, destinatarios ni montos reales. Solo nombres y huellas.
> Decisión del dueño: 19-nov 08:48 CR. Esta rama **no va a `main`** (regla 2 de ESTADO, guarda R04).

## Qué pasa y qué no
- **Pasa:** la función acepta `{ movimiento_ids: uuid[] }` y manda **un** correo por llamada con todas las facturas
  del pago: fecha y referencia de cada una, lo facturado, el crédito a favor aplicado (si hubo) y lo **pagado**
  (facturado − crédito no reversado), el total pagado, la **fecha real del pago** (CR) y el método. Sigue aceptando
  `{ movimiento_id }` (la app de hoy) como lista de 1. Nuevo: valida que todas sean del mismo proveedor y estén
  pagadas (`aprobado`); si no, no manda nada. Sella `proveedor_notificado_at` en todas.
- **Fecha del pago:** la última fila de `movement_edits` (052) del movimiento con `changed.status.new = 'aprobado'`.
  Su RLS es owner/manager/contador: con un cajero vuelve vacía y se usa el momento del envío (en el flujo normal,
  segundos después de marcar pagado).
- **No pasa:** no cambia la autenticación (JWT + RLS, sin service_role), la decisión de enviar
  (`notificar_pago = 'email'` + correo), el remitente, ni `verify_jwt` (sigue **on**). Sin migraciones, sin secretos.

## SHA y huellas
- Fuente: rama `claude/pago-notificar-agrupado`. Primer commit = el código de prod v15 (588c5593 + remitente propio);
  el SHA a firmar es la cabeza de la rama al firmar.
- Prod antes (19-nov, solo lectura con `get_edge_function`): **v15 · on** · `ezbr_sha256` `4657572543c1…`.

## Orden del pase (la app va DESPUÉS)
1. **Esta Edge** (compatible con los dos formatos). Con la app de hoy sigue saliendo un correo por factura, pero ya con
   la fecha real y lo pagado.
2. **La app** (#303, borrador, rama `claude/pago-agrupado-app`): una llamada por proveedor. Si por error la app llegara
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
      crédito. Si no se puede, queda **pendiente** (no probado).

## Criterios de parada
Hash de antes distinto · `verify_jwt` cambia · el correo sale con la fecha de la factura o con lo facturado como pagado
→ **parar y volver atrás**. El pago nunca depende del correo (fire-and-forget).

## Vuelta atrás
- Volver a desplegar el primer commit de la rama (el código de prod v15):
  `git switch --detach 99a53281 && supabase functions deploy pago-notificar --project-ref yiczgdtirrkdvohdquzf --use-api`.
  Si la app nueva ya está en `main`, sigue funcionando: la Edge vieja le contesta 400 y la app cae a una llamada por id.
- Sin datos ni esquema que deshacer.

## Firma y bitácora
| Fecha y hora (-06:00) | Quién | Qué |
|---|---|---|
| | | |
