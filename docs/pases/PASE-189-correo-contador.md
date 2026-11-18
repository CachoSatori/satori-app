# PASE-189 — Correo quincenal «Ventas por día» al contador (Edge `ventas-dia-contador` + cron, mig 189)

> **⛔ NO MERGEAR sin firma.** Toca prod en dos lugares: una **Edge Function nueva** (deploy a mano) y una **tarea de
> pg_cron** (mig 189, entra por merge → Branching). Firma del dueño sobre el SHA exacto. Si algo no coincide, **se para
> y se avisa**. Pedido del dueño por el chat, 17-nov-2026 19:09 -06:00.

## 1. Qué pasa y qué no
**Pasa:**
- Edge `ventas-dia-contador` (nueva, `verify_jwt` **on**): arma el «Detalle por día» de la quincena cerrada desde el PoS
  (`pos_ndf_tickets` + `pos_ndf_ticket_lines`, estado `C`, local, jornada CR) con la **misma lógica que la pantalla**
  (paquete `ventasPos.gen.js` de `src/modules/ventas/ventasDiaContadorPuro.ts`: `armarDiasMap` → `getDayStats` →
  `getContabilidadDays` + `totalesContabilidad`) y manda **un correo aparte** a `REPORT_TO_EMAIL` con dos adjuntos:
  `.xlsx` (formato, fila TOTAL con fórmulas) y `.csv` (como el botón ⬇ CSV, UTF-8 con BOM, con # y TOTAL).
- Mig 189: tarea `satori-ventas-dia-contador`, `0 13 1,16 * *` (13:00 UTC = 07:00 CR; pg_cron de prod corre en GMT,
  leído 17-nov), misma forma de llamada y de autenticación que los jobs 3 y 4 (Bearer = `service_role_key` del Vault, por
  nombre), body `{"local":"santa-teresa"}`, `timeout_milliseconds` 120000.
- App: `totalesContabilidad` (la fila TOTAL de Contabilidad) pasa a una función de `ventasUtils.ts` que usan la pantalla y
  el correo. **El personal no ve ningún cambio** (mismas sumas, mismo orden).

**No pasa:** ningún esquema (tablas, funciones, permisos), los jobs 3, 4 y 8, `monthly-report`, secretos (usa los que ya
existen: `REPORT_TO_EMAIL`, `RESEND_API_KEY`), sagrados, `ventas_dias`/`ventas_hist` (R18), `employees` (no se lee).
La respuesta y el log de la Edge no traen montos ni nombres (SEC-02): período, conteos, adjuntos, bytes y sha256.

## 2. SHA y huellas
| Qué | Valor |
|---|---|
| Rama / PR | `claude/correo-contador-ventas-dia` — SHA de la cabeza del PR (anotar al firmar) |
| Paquete | `supabase/functions/ventas-dia-contador/ventasPos.gen.js`; `sha256(cuerpo)` en su cabecera; `contrato.test.tsx` exige que sea igual al que sale hoy de `src/` |
| md5 del comando de la tarea 189 | `bd40913a82322ef9c7dfa940133118f2` (lo verifica `scripts/sql/189_humo_cron.sql`) |
| Jobs que NO cambian (leído 17-nov) | 3 `satori-monthly-report` md5 `95d77b5e…` · 4 `satori-quincenal-report` md5 `122fa713…` · 8 `club_socios_mantenimiento` md5 `d248e069…` |

## 3. Responsables
Ejecuta: sesión de CC del dueño (deploy de la Edge y SQL) y el merge (Branching). Control: otra sesión o persona.
Firma: el dueño, por el chat.

## 4. Prerrequisitos y orden (no se mezcla)
1. **186, 187 y 188 en prod antes del merge de la 189** (R16: Branching rechaza una versión menor que la última; si la
   189 entra primero, la 186–188 tienen que renumerarse). Si siguen sin firma, se decide: esperar o pasar la 189 igual
   y renumerar las otras a 190+.
2. Edge desplegada y con dry_run OK **antes** del merge (si la tarea corre sin Edge, solo da 404: inocuo).
3. Merge fuera de 15:50–19:00 (D1). Nadie más pushea a `main` en la ventana.
4. **Regla 2 / R04:** la carpeta `supabase/functions/ventas-dia-contador/` **no va a `main`** hasta el ítem 11. El PR está
   en dos commits: el 1.º (app, mig 189, scripts, docs) es lo que se mergea; el 2.º (la Edge) queda en la rama como
   fuente del deploy. Ver «Merge» en el cuerpo del PR.

## 5. Edge — deploy a mano (sesión de CC del dueño)
Antes (solo lectura, PROD `yiczgdti…` leído en pantalla):
```bash
supabase secrets list --project-ref yiczgdtirrkdvohdquzf     # deben estar REPORT_TO_EMAIL y RESEND_API_KEY (solo NOMBRE y huella)
supabase functions list --project-ref yiczgdtirrkdvohdquzf   # ventas-dia-contador NO existe todavía
```
Deploy, desde la rama en el SHA firmado (sin Docker; `verify_jwt` queda **on**, no pasar `--no-verify-jwt`):
```bash
git fetch origin && git checkout <SHA firmado>
supabase functions deploy ventas-dia-contador --project-ref yiczgdtirrkdvohdquzf --use-api
```
Después: `ventas-dia-contador` v1, `verify_jwt` **on**, anotar `ezbr_sha256`.
**Staging primero** (recomendado): lo mismo con `--project-ref hwiatgicyyqyezqwldia` y el dry_run del §6 contra la URL de
staging (si staging no tiene `service_role_key` en el Vault, el dry_run responde 401: anotarlo, no es un fallo de la Edge).

## 6. Pruebas en prod
**6.1 dry_run (no manda nada)** — `scripts/sql/189_correr_edge.sql`, paso A con `{"local":"santa-teresa","dry_run":true}`,
paso B con el id. Esperado (hoy, 17-nov → la última cerrada es la 1.ª de noviembre):
| Campo | Esperado |
|---|---|
| `status_code` | 200 |
| `ok` / `dry_run` / `enviado` | true / true / false |
| `quincena` · `desde` · `hasta` | `2026-11-1` · `2026-11-01` · `2026-11-15` |
| `dias` · `dias_con_ventas` | 15 · ≈ 15 (cada día con ventas del PoS) |
| `adjuntos` | `satori_ventas_dia_santa-teresa_2026-11-1.xlsx` y `.csv`, con bytes > 0 y sha256 |
Control cruzado (solo lectura, sin copiar montos al chat): el owner abre «Histórico» → «Ventas» → noviembre y compara la
neta del 1 al 15 contra el correo real del 6.2.

**6.2 Corrida real manual a la dirección del negocio** (con firma; manda UN correo a `REPORT_TO_EMAIL`): paso A con
`{"local":"santa-teresa","quincena":"2026-11-1"}`. Esperado: `enviado:true` y el correo en la casilla del negocio con los
dos adjuntos; el dueño abre el Excel y el CSV y compara 2–3 días y el TOTAL con «Detalle por día».

## 7. Cron (después del merge de la 189)
1. Check «Supabase Preview» del merge en success, «All migrations are up to date».
2. Ledger: exactamente 1 fila `189` / `cron_ventas_dia_contador`.
3. **Humo (R02):** `scripts/sql/189_humo_cron.sql` (verifica la tarea contra el md5 firmado y programa un humo cada
   minuto) → esperar ≥ 2 minutos → `scripts/sql/189_humo_cierre.sql` (exige corridas del humo y lo baja).
4. **Día siguiente real:** el 1 o el 16 siguiente, después de las 07:00 CR: `cron.job_run_details` de la tarea con
   `succeeded`, y en `net._http_response` (se guarda ~6 h) `status_code` 200 con `enviado:true`; el correo en la casilla.

## 8. Criterios de parada
- Falta `REPORT_TO_EMAIL` o `RESEND_API_KEY` por nombre → no desplegar.
- `verify_jwt` off, 401/403/500 en el dry_run, `quincena` distinta de la esperada, adjuntos ausentes → volver atrás (§9).
- La 189 no queda con el md5 firmado o el humo no corre → `189_rollback.sql` + avisar.
- La neta del correo real no coincide con «Detalle por día» → no dejar la tarea activa (rollback de la 189) y avisar.

## 9. Vuelta atrás
- **Cron:** `scripts/sql/189_rollback.sql` (baja solo la tarea y la fila del ledger) y, en el mismo momento, un PR que saca
  `supabase/migrations/189_cron_ventas_dia_contador.sql` de `main` (regla 10). Con la 189 en el ledger y la decisión de
  dejarla, alternativa: solo `cron.unschedule('satori-ventas-dia-contador')` + migración nueva hacia adelante (R14).
- **Edge:** `supabase functions delete ventas-dia-contador --project-ref yiczgdtirrkdvohdquzf` (es nueva: no hay versión
  anterior que restaurar). Sin la tarea, nadie la llama.
- **App:** revert del merge (la función `totalesContabilidad` no cambia números).

## 10. Firma y bitácora
| Fecha y hora (-06:00) | Quién | Qué | Resultado |
|---|---|---|---|
| | | | |
