# PASE a PROD — Edge `monthly-report`: correos con el estándar de reportes (⛔ firma para desplegar)

> Repo público: sin valores de secretos ni destinatarios. Solo nombres de secretos y huellas.

## Qué pasa y qué no
- **Pasa:** los dos correos del reporte (ventas y propinas, mensual del día 1 y 1.ª quincena del día 15) salen con el
  estándar de reportes v1 (`docs/club-satori/ESTANDAR-reportes.md`) adaptado a correo. Plantilla nueva en
  `supabase/functions/monthly-report/plantilla.ts` + `correo-estandar.ts`.
- **No pasa:** no cambia qué se calcula ni de dónde se lee (`calcVentas`, `calcPropinas`, `pool.ts`, `fechas.ts`,
  `periodo.ts` iguales), ni los asuntos, ni el destinatario, ni la autenticación (SEC-02), ni `verify_jwt` (sigue **on**).
  Sin migraciones, sin secretos, sin merges.

## SHA y huellas
- Fuente: rama `claude/correo-estandar-monthly-report` (base `claude/reporte-quincenal-fechas` @ `4d5f9733`, el código
  vivo). El SHA exacto a firmar es la cabeza del PR en el momento de la firma.
- Prod antes (leído el 16-nov 22:2x CR, solo lectura): **v22 · on** · `ezbr_sha256` `314a893e3764…` · actualizada el
  16-nov 22:09 CR. Su `index.ts`, `periodo.ts`, `fechas.ts` y `pool.ts` coinciden con `4d5f9733`.

## ⚠️ Orden con la otra sesión (lecturas del PoS)
Otra sesión cambia las **lecturas** de `index.ts` (que lean del PoS) en otra rama. Este PR toca solo la plantilla y la
quita de `index.ts` (bloque de helpers y de `build*Email`), sin tocar las consultas. **Quien despliegue segundo tiene que
desplegar las dos ramas juntas** (merge de una en la otra, gate verde); si no, el despliegue pisa al otro.
La plantilla recibe tipos estructurales (`VentasCorreo`, `PropinasCorreo`): si las lecturas nuevas entregan los mismos
campos, no hay que tocar `plantilla.ts`.

## Responsables
- Ejecución: sesión de Claude Code con acceso a prod (Management API o CLI `--use-api`).
- Control: el dueño (o quien él designe), distinto de quien ejecuta.

## Antes (solo lectura)
- [ ] `monthly-report`: versión, `verify_jwt` = on, `ezbr_sha256` = `314a893e3764…`. Si el hash es otro, **parar**: alguien
      desplegó después de este paquete.
- [ ] Hash de las demás funciones anotado (no tienen que cambiar).

## Despliegue
```bash
git switch claude/correo-estandar-monthly-report   # el SHA firmado
supabase functions deploy monthly-report --project-ref yiczgdtirrkdvohdquzf --use-api
```
Sin `--no-verify-jwt` (la función va con `verify_jwt` = on).

## Después
- [ ] `monthly-report`: versión +1, `verify_jwt` **on**, hash nuevo anotado. Las demás funciones, mismo hash.
- [ ] Humo sin correo: botón de Admin no; usar `POST` con el JWT del owner y `{"dry_run":true}` → `200`, `enviados`
      con `ventas` y `propinas` (calcula y arma el HTML, no manda). Con `{"dry_run":true,"periodo":"quincena"}` igual.
- [ ] Prueba real (con OK del dueño): `{"tipo":"ventas"}` o `{"tipo":"propinas"}` → el dueño mira el correo en Gmail
      web y en el teléfono (modo claro y oscuro) y lo compara con `docs/reportes/previews/monthly-report-*.png`.
- [ ] Si la sesión no puede invocar la función (proxy), la prueba la hace el dueño con una foto. Queda **pendiente**, no
      se da por probada.

## Criterios de parada
- Hash de antes distinto del anotado · `verify_jwt` cambia · el `dry_run` responde distinto de 200 · el correo de prueba
  sale vacío, cortado o con cifras distintas a las del correo anterior → **parar y volver atrás**.

## Vuelta atrás
- Volver a desplegar **`4d5f9733`** (`claude/reporte-quincenal-fechas`, el código de la v22):
  `git switch --detach 4d5f9733 && supabase functions deploy monthly-report --project-ref yiczgdtirrkdvohdquzf --use-api`.
- Comparar el hash con `314a893e3764…` (si difiere solo por el empaquetado, comparar el código con `get_edge_function`).
- Sin datos ni esquema que deshacer.

## Firma y bitácora
| Fecha y hora (-06:00) | Quién | Qué |
|---|---|---|
| | | |
