# PASE a PROD — Edge `pago-notificar`: comprobante de pago con el estándar de reportes (⛔ firma para desplegar)

> Repo público: sin valores de secretos, proveedores ni destinatarios. Solo nombres de secretos y huellas.

## Qué pasa y qué no
- **Pasa:** el comprobante de pago que recibe el proveedor sale con el estándar de reportes v1 adaptado a correo, en
  «usted» («Por favor, no responda a este correo», antes «No respondas»). Plantilla nueva en
  `supabase/functions/pago-notificar/plantilla.ts` + `correo-estandar.ts`.
- **No pasa:** no cambia la autenticación (JWT + RLS), ni la decisión de enviar (`notificar_pago = 'email'` + correo
  cargado), ni el sellado de `proveedor_notificado_at`, ni los datos mostrados, ni el asunto, ni `verify_jwt` (sigue
  **on**). El correo del proveedor no va en el cuerpo. Sin migraciones, sin secretos, sin merges.

## SHA y huellas
- Fuente: rama `claude/correo-estandar-pago-notificar` (base `main`). El SHA exacto a firmar es la cabeza del PR al firmar.
- Prod antes (16-nov 22:2x CR, solo lectura): **v13 · on** · `ezbr_sha256` `0e47a0350843…` · desplegada el 17-ago. Su
  `index.ts` coincide con el de `main` (blob `5b4e0ebc`), la base de este PR. Ninguna otra rama tiene otra versión.

## Responsables
- Ejecución: sesión de Claude Code con acceso a prod. Control: el dueño (o quien designe), distinto de quien ejecuta.

## Antes (solo lectura)
- [ ] `pago-notificar`: versión, `verify_jwt` = on, hash = `0e47a0350843…`. Si es otro, **parar**.
- [ ] Hash de las demás funciones anotado.

## Despliegue
```bash
git switch claude/correo-estandar-pago-notificar   # el SHA firmado
supabase functions deploy pago-notificar --project-ref yiczgdtirrkdvohdquzf --use-api
```
Sin `--no-verify-jwt`.

## Después
- [ ] `pago-notificar`: versión +1, `verify_jwt` **on**, hash nuevo anotado. Las demás, mismo hash.
- [ ] Humo sin datos: `POST` sin `Authorization` → 401.
- [ ] Prueba real con OK del dueño: un proveedor de prueba con `notificar_pago = 'email'` y un correo **del dueño**
      (no un proveedor real), «Enviar comprobante» desde Caja. El dueño mira el correo en Gmail web y en el teléfono y
      lo compara con `docs/reportes/previews/pago-notificar*.png`. Si no se puede, queda **pendiente** (no probado).

## Criterios de parada
Hash de antes distinto · `verify_jwt` cambia · el correo sale vacío o con datos distintos al pago → **parar y volver
atrás**. El pago nunca depende del correo (fire-and-forget): si falla, `proveedor_notificado_at` queda vacío y la app
ofrece reintento.

## Vuelta atrás
- Volver a desplegar `main` (blob `5b4e0ebc` de `supabase/functions/pago-notificar/index.ts`):
  `git switch --detach origin/main && supabase functions deploy pago-notificar --project-ref yiczgdtirrkdvohdquzf --use-api`.
- Sin datos ni esquema que deshacer.

## Firma y bitácora
| Fecha y hora (-06:00) | Quién | Qué |
|---|---|---|
| | | |
