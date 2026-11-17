# PASE a PROD — Edge `cierre-email`: correo del cierre con el estándar de reportes (⛔ firma para desplegar)

> Repo público: sin valores de secretos ni destinatarios. Solo nombres de secretos y huellas.

## Qué pasa y qué no
- **Pasa:** el correo del cierre del día completo sale con el estándar de reportes v1 adaptado a correo. Plantilla
  nueva en `supabase/functions/cierre-email/plantilla.ts` + `correo-estandar.ts`.
- **No pasa:** no cambia la autenticación (JWT del usuario + RLS), ni la fila que se lee, ni las cifras (mismas
  columnas, mismas sumas, mismo umbral de «cuadra» < ₡500), ni el asunto, ni el destinatario, ni `verify_jwt` (sigue
  **on**). No toca la lógica de cierres de caja (sagrados intactos). Sin migraciones, sin secretos nuevos, sin merges.
- **Pasa también (firma del dueño, 16-nov):** se saca el correo por defecto escrito en el código. El destinatario sale
  **solo** del secreto `REPORT_TO_EMAIL` (el mismo de `monthly-report`; los secretos de Edge son del proyecto, así que
  es el mismo valor). Si falta o no tiene forma de correo: no se lee el cierre ni se llama a Resend, se loguea «falta
  destinatario» y responde `500` `falta_destinatario`. La app no se entera (`sendCierreEmail` es fire-and-forget y
  nunca lanza): **el cierre no se rompe**.

## SHA y huellas
- Fuente: rama `claude/correo-estandar-cierre-email` (base `main`). El SHA exacto a firmar es la cabeza del PR al firmar.
- Prod antes (16-nov 22:2x CR, solo lectura): **v13 · on** · `ezbr_sha256` `36ff59eed179…` · desplegada el 17-jul. Su
  `index.ts` coincide con el de `main` (blob `f690e31c`), que es la base de este PR.
- ⚠️ La rama `claude/item-11-config` tiene otra versión de `index.ts` que también saca el destinatario por defecto. Si el
  ítem 11 entra primero, este cambio se rebasa sobre él y queda una sola versión (la de `destinatario.ts`).

## Responsables
- Ejecución: sesión de Claude Code con acceso a prod. Control: el dueño (o quien designe), distinto de quien ejecuta.

## Antes (solo lectura)
- [ ] **Paso previo obligatorio:** el secreto `REPORT_TO_EMAIL` existe en prod (`supabase secrets list --project-ref
      yiczgdtirrkdvohdquzf`: **solo nombre y digest**, nunca el valor). Según el coordinador ya está cargado (lo usa
      `monthly-report`); si no aparece, **parar**: con este código el correo del cierre no saldría.
- [ ] `cierre-email`: versión, `verify_jwt` = on, hash = `36ff59eed179…`. Si es otro, **parar**.
- [ ] Hash de las demás funciones anotado.

## Despliegue
```bash
git switch claude/correo-estandar-cierre-email   # el SHA firmado
supabase functions deploy cierre-email --project-ref yiczgdtirrkdvohdquzf --use-api
```
Sin `--no-verify-jwt`.

## Después
- [ ] `cierre-email`: versión +1, `verify_jwt` **on**, hash nuevo anotado. Las demás, mismo hash.
- [ ] Humo sin datos: `POST` sin `Authorization` → 401.
- [ ] Prueba real: el próximo cierre completo (o reenviar uno con el JWT del owner: `{"cierre_id": …}`). El dueño mira el
      correo en Gmail web y en el teléfono (claro y oscuro) y lo compara con `docs/reportes/previews/cierre-email*.png`
      y con el popup del cierre: **las cifras tienen que ser las mismas**.
- [ ] Si la sesión no puede invocar la función, la prueba queda **pendiente** con el dueño (foto).

## Criterios de parada
Hash de antes distinto · `verify_jwt` cambia · el correo sale vacío, cortado o con cifras distintas al popup del
cierre → **parar y volver atrás**. El cierre nunca depende del correo (fire-and-forget): un correo roto no rompe la caja.

## Vuelta atrás
- Volver a desplegar `main` (blob `f690e31c` de `supabase/functions/cierre-email/index.ts`):
  `git switch --detach origin/main && supabase functions deploy cierre-email --project-ref yiczgdtirrkdvohdquzf --use-api`.
- Sin datos ni esquema que deshacer.

## Firma y bitácora
| Fecha y hora (-06:00) | Quién | Qué |
|---|---|---|
| | | |
