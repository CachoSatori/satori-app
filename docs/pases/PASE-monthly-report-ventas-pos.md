# PASE — `monthly-report`: ventas del PoS (sin `ventas_dias`)

> ⛔ plata: firma del dueño + verificador independiente antes de desplegar a prod. Nada de esto se mergea a `main`
> (regla 2: nada bajo `supabase/functions/` hasta el ítem 11); se despliega **a mano** desde esta rama.

## 1. Qué pasa y qué no
- Incluye el correo con el estándar de reportes de **#241** (`plantilla.ts`): este pase reemplaza al de #241.
- **Pasa:** el correo de ventas (día 1 = mes anterior; día 15 = quincena 1–14) suma las ventas **del PoS**
  (`pos_ndf_tickets` + `pos_ndf_ticket_lines`, estado `C`, local `santa-teresa`, día CR de factura) con la
  **misma lógica que la app** (paquete `ventasPos.gen.js` de `src/modules/ventas/ventasPosPuro.ts`).
  Decisión firmada del dueño, 16-nov-2026 22:20 CR.
- **Por qué urge:** `ventas_dias` no tiene filas desde el **20-oct**. El reporte del 1-nov (octubre) sumó **solo
  20 de 31 días**; el del 1-dic (noviembre) saldría **«sin datos»** (no se manda el correo de ventas).
- **No pasa:** propinas (igual), destinatario, cron, autenticación (SEC-02), `verify_jwt` (sigue **on**), esquema
  (sin migración), `ventas_dias`/`ventas_hist` (no se tocan; `ventas_dias` solo se LEE en `dry_run`, para el control).
- **Cambios visibles en el correo:** «Ventas totales» = neta del PoS (la de la app); el delivery de un mesero pasa a
  «Delivery» (antes a «Salón»); «Caja / Para llevar» = salón cobrado con login de caja; «Ticket promedio / PAX» =
  (salón + caja) ÷ pax, con el pax de caja; la tendencia semanal y por día usan la venta total del día (antes, solo
  meseros); el «vs período anterior» sale del PoS (antes quedaba en 0 cuando el xls no tenía ese período).

## 2. SHA y huellas
| Qué | Valor |
|---|---|
| Rama | `claude/reporte-mensual-desde-pos`, **sobre #241** (`claude/correo-estandar-monthly-report` @ `2bc860c`: plantilla nueva y sin correo por defecto). Se despliegan JUNTOS: lecturas del PoS + plantilla del estándar |
| Paquete `ventasPos.gen.js` | generado desde `claude/ventas-desde-pos` @ `4f7091a` (sin nombres: roster vacío, meseros «<código> · sin asignar», sin comentarios), `sha256(cuerpo)` en su cabecera (la prueba lo verifica) |
| Prod antes (leído 16-nov 22:5x CR, solo lectura) | `monthly-report` **v22**, `verify_jwt` on, `ezbr_sha256` `314a893e…` |
| Vuelta atrás | volver a **v22** (hash `314a893e…`): redesplegar su fuente, `claude/reporte-quincenal-fechas` @ `4d5f973` |

## 3. Responsables
Ejecuta: sesión de CC del dueño. Control: otra persona/sesión (no la misma). Firma: el dueño, sobre el SHA del PR.

## 4. Prerrequisitos
- **Nombres:** el paquete no trae nombres (privacidad D3). Los saca de `employees` (`pos_login` → nombre). Un login
  sin cargar sale «<código> · sin asignar» en el ranking. Hoy (16-nov, solo lectura): **1 login de oct–nov sin
  `employees.pos_login`, 4 facturas** → el dueño lo carga en Admin → Empleados → «Login del PoS» antes del 1-dic.
- Gate de la rama verde (vitest de `supabase/functions/monthly-report/`: paridad, lectura, totales, control).
- PR A (`claude/ventas-desde-pos`) **no** es requisito para desplegar: el paquete es autocontenido. Sí lo es para
  regenerarlo (`node scripts/edge/empaquetar-ventas-pos.mjs supabase/functions/monthly-report/ventasPos.gen.js`).

## 5. Staging primero (ref `hwiatgic…` — leerlo en pantalla)
```bash
supabase functions deploy monthly-report --project-ref hwiatgicyyqyezqwldia --use-api   # verify_jwt queda on
# dry_run con el JWT de un owner de staging (o service_role desde Vault). NO manda correos.
curl -sS -X POST "https://hwiatgicyyqyezqwldia.supabase.co/functions/v1/monthly-report" \
  -H "Authorization: Bearer $JWT_OWNER_STAGING" -H "Content-Type: application/json" \
  -d '{"month":"2026-10","tipo":"ventas","dry_run":true}'
```
Esperado (staging puede tener otros datos): `ok:true`, `fuente:"pos"`, `enviados:["ventas"]`, y `control` con
`dias_xls_sin_pos: 0` y `razon_neta_dias_en_comun` entre 0,98 y 1,02.

## 6. Prod: lecturas antes, despliegue, dry_run (sin enviar)
0. **Destinatario (desde #241 @ `2bc860c` no hay correo por defecto):** `supabase secrets list --project-ref
   yiczgdtirrkdvohdquzf` y verificar que exista **`REPORT_TO_EMAIL` por NOMBRE** (solo nombre y huella; nunca el
   valor). Si falta, **parar**: el envío real respondería 500 «falta_destinatario» (el dry_run igual corre). Lo mismo
   en staging antes del §5.
1. Antes (solo lectura): versión, `verify_jwt`, `ezbr_sha256` de `monthly-report` = §2. Si no coincide, **parar**.
2. `supabase functions deploy monthly-report --project-ref yiczgdtirrkdvohdquzf --use-api` (desde esta rama, SHA del PR).
3. Después: versión +1, `verify_jwt` **on**, hash nuevo anotado.
4. **dry_run de octubre** (compara con lo que mandó el reporte del 1-nov; la respuesta y el log traen solo
   conteos y razones, nunca montos):
   ```bash
   curl -sS -X POST "https://yiczgdtirrkdvohdquzf.supabase.co/functions/v1/monthly-report" \
     -H "Authorization: Bearer $JWT_OWNER" -H "Content-Type: application/json" \
     -d '{"month":"2026-10","tipo":"ventas","dry_run":true}'
   ```
   **Esperado** (medido el 16-nov en prod por SQL de solo lectura, aproximando la neta por líneas):
   | Campo | Esperado |
   |---|---|
   | `control.dias_pos` | 31 |
   | `control.dias_xls` | 20 (1 al 20-oct) |
   | `control.dias_en_comun` | 20 |
   | `control.dias_xls_sin_pos` | 0 |
   | `control.razon_neta_dias_en_comun` | ≈ 1,01 (tolerancia 0,98–1,03; la paridad ya la validó el dueño) |
   | `control.razon_total_pos_vs_xls` | ≈ 1,79 (el reporte del 1-nov tenía solo 20 días) |
   Los logs del 1-nov ya no están (retención), así que «lo que mandó» se reconstruye con la misma suma del código
   viejo sobre `ventas_dias` (Σ `total` de todos los buckets): es exactamente lo que leía.
5. En el dry_run también se puede pedir `tipo:"ambos"`: la respuesta dice `enviados:["ventas","propinas"]` sin mandar
   nada; los HTML de la plantilla de #241 se ven con `docs/reportes/previews/` (no salen por la respuesta).
6. dry_run de la quincena actual (`{"periodo":"quincena","tipo":"ventas","dry_run":true}`): `enviados:["ventas"]`,
   `dias_xls: 0` (no hay xls de noviembre) — confirma que el día 15 de diciembre ya no sale vacío.

## 7. Criterios de parada
- `REPORT_TO_EMAIL` ausente por nombre (§6.0), cualquier `ok:false` / 500, `verify_jwt` off, o `razon_neta_dias_en_comun` fuera de 0,98–1,03 → **volver atrás** (§2)
  y avisar. No se manda ningún correo real hasta que el dueño lo pida.

## 8. Vuelta atrás (a v22)
`git checkout 4d5f973 && supabase functions deploy monthly-report --project-ref yiczgdtirrkdvohdquzf --use-api`;
verificar `verify_jwt` on y que el hash vuelva a `314a893e…` (si no coincide, avisar: la fuente de v22 no es esa).

## 9. Firma y bitácora
| Fecha y hora (-06:00) | Quién | Qué | Resultado |
|---|---|---|---|
| | | | |
