# Club Satori — migración desde Firestore (F1b)

`migrar_firestore.py` pasa el sistema viejo de créditos (Firestore `creditos-73bac`, solo Satori) a las tablas `club_*` de la mig 075. **Solo staging**: el ref está fijo en el código y el script se niega a correr contra cualquier otro, prod incluido. Spec: [`docs/club-satori/SPEC.md`](../../docs/club-satori/SPEC.md) §7.

## Reglas de privacidad
- El export trae teléfonos y emails. Va **fuera del repo** (por ejemplo `~/club-export/`, con permisos 700). El script se niega a leer el export o a escribir la salida dentro del repo.
- El script nunca imprime nombres, teléfonos ni emails: solo conteos y sumas. A los errores de la base se les quita la fila que falló.
- Los dos CSV de revisión (`equivalencias_negocios.csv` y `duplicados.csv`) sí tienen nombres. Se escriben en `--out`, fuera del repo, con permisos 600.
- Cuando el dueño apruebe la prueba, se borran el export y la carpeta de salida.

## Controles (revisión de Grok del 07-nov, CLUB-AUD-19..23)
- **El export se verifica antes de armar nada** (21). Si falla, el script sale con código 3 y no toca la base:
  - tiene que traer un manifiesto, `MANIFEST.json` (`{"provisional": false, "archivos": {nombre: sha256}}`) o el `MANIFEST.md` del bot de Grok, con un sha256 por archivo;
  - el sha256 de cada archivo que se lee tiene que coincidir con el del manifiesto;
  - si el manifiesto dice «provisional», se rechaza;
  - el negocio tiene que ser el de Satori (`uPberDoE9w19ydF6bZSA`);
  - los vencimientos tienen que ser ids únicos, todos débitos de Satori y todos del 05-nov-2026 (hora CR).
- **Validación dentro de la transacción** (19). Si algo falla, `raise` y no queda nada cargado:
  - `diferencias_saldo_vs_firestore`, `cuentas_baja_con_saldo`, `vencer_simular_hoy` y el barrido de anon tienen que dar 0;
  - los conteos del plan tienen que ser iguales a los de la base;
  - cada total de `--esperados` tiene que coincidir.
- **`--apply` exige `--esperados archivo.json`**: los totales firmados por el dueño, por ejemplo `{"miembros": 338, "creditos_activos": 66.0, "pm_pendiente": 0}`. No se hardcodean en el script.
- **`--ensayo`**: hace la carga completa y la validación contra staging, pero termina en ROLLBACK. Sirve para probar el export real sin guardar nada.
- **Datos personales** (20): viajan en un único literal jsonb (`jsonb_to_recordset`). Si la base devuelve un error, se imprime solo el SQLSTATE; nunca el cuerpo ni `LINE`.
- **PM pendiente** (22): una sola definición, la de `club_reporte_mes`: cargos no anulados menos pagos.
- **Re-ejecución** (23):
  - conserva el `id`, el `codigo` y el `token_portal` de cada miembro por `legacy_id`, así que los QR y portales ya repartidos siguen valiendo;
  - aborta si ya hay meses cerrados en `club_reportes_cerrados`.
- **Pruebas:** `python3 -I scripts/club/test_migrar_firestore.py`, con un export sintético armado en una carpeta temporal. Con `CLUB_ENSAYO_STAGING=1` corre además los ensayos contra staging, siempre con ROLLBACK.

## Uso
```bash
# 1) Plan, sin tocar la base: conteos, controles y CSV de revisión
python3 -I scripts/club/migrar_firestore.py --local <id-del-local> --export ~/club-export/export.zip --dry-run

# 2) Ensayo en STAGING: todo + validación, termina en ROLLBACK
python3 -I scripts/club/migrar_firestore.py --local <id-del-local> --export ~/club-export/export.zip --ensayo

# 2) Carga en STAGING: borra lo migrado antes (origen='migracion') y vuelve a insertar, en una transacción
python3 -I scripts/club/migrar_firestore.py --local <id-del-local> --export ~/club-export/export.zip --apply --esperados ~/club-export/esperados.json
```
- `--local`: id del local destino en `club_config` (LC-ML: ningún local está escrito en el script; tiene que estar dado de
  alta antes, RUNBOOK paso 4b).
- `--export`: el zip o la carpeta con `businesses.json`, `referrers.json`, `referrals.json`, `referrals_club.json` y `vencimientos_*.json`.
- `--out`: la carpeta de salida (por defecto `~/club-export/salida`). Ahí quedan los CSV y `validacion.json`.
- **Conexión:** usa la Management API de Supabase (`/v1/projects/{ref}/database/query`), porque hace falta SQL transaccional. El token va en la variable de entorno `SUPABASE_ACCESS_TOKEN` y nunca en el repo. En la sesión de Claude Code lo inyecta el proxy.
- **Re-ejecutable:** `--apply` borra de `club_pm_*`, `club_movimientos`, `club_miembros` (y sus contactos, en cascada) y `club_negocios` todo lo que tiene `origen = 'migracion'`. **Nunca toca `club_config`.** Si hay datos cargados en la app sobre miembros migrados (movimientos, cupones, PM o visitas), aborta sin borrar nada.

## Mapeo
| Origen | Destino | Regla |
|---|---|---|
| `businesses` | `club_config` (el local de `--local`) | Se verifica que la tasa sea igual a `personas_por_credito` (6); si no, aborta. No se modifica. |
| `workPlace` | `club_negocios` (`origen='migracion'`, tipo `otro`) | Se normaliza con la misma regla del índice único (espacios, mayúsculas y tildes). Las variantes que coinciden se unifican. Las fusiones dudosas solo aparecen como sugerencia en el CSV. |
| `referrers` | `club_miembros` (`legacy_id = _id`) + `club_miembros_contacto` | `deleted` pasa a `baja`. Tipo: «satori» en el nombre o el negocio → `equipo`; nombre terminado en «PM» o con montos en `referrals_club` → `concierge_pm`; el resto → `referente`. Teléfono a E.164 (+506 si tiene 8 dígitos); texto o «None» → vacío. Email inválido → vacío. Código y token nuevos. Un nombre vacío queda como «(sin nombre)». |
| `referrals` credit | `club_movimientos` `tarjeta` | `personas = peopleCount` · `fecha_visita = createdAt` · nota «fecha aproximada (carga)». |
| `referrals` debit (sin los de `vencimientos_*.json`) | `club_movimientos` `canje` | Se agrupan por referente y minuto UTC: un canje por grupo, con `personas = −Σ`, `creditos = Σ/6` y los ids viejos en `legacy_ids`. Los canjes de más de 2 créditos se migran como están (D3). |
| ids de `vencimientos_*.json` | `club_movimientos` `vencimiento` | Uno por referente, con nota «cancelación inactividad 05-nov-2026». |
| cuentas `deleted` con saldo > 0 | `club_movimientos` `vencimiento` | D1 (corregida el 05-nov): por el saldo, fechado en la baja = la más tardía entre `updatedAt` y el último movimiento de la cuenta, con la nota «cuenta borrada en el sistema viejo». Si alguna fecha cae desde el 1-nov-2026, el script frena. Así un mes cerrado da siempre lo mismo. |
| restos sin actividad | `club_movimientos` `vencimiento` | Decisión del dueño (07-nov): las cuentas sin tarjeta, canje ni restitución en el plazo de vencimiento que solo tienen un **resto de menos de medio crédito** (1 o 2 personas con la tasa 6) se vencen con la **fecha de la migración** y la nota «resto del sistema viejo». Mismo criterio que `club_vencer_candidatos`. Después, la simulación de hoy tiene que dar **0 cuentas**; si queda alguna, la migración frena sin guardar nada. |
| `referrals_club` credit / debit | `club_pm_cargos` (`pendiente`) / `club_pm_pagos` | `amount / 100` = colones. Los cargos de cuentas borradas pasan a `anulado`, con `anulado_en` = la fecha de la baja (D2). |

## Validación (`validacion.json`, solo agregados)
- **Restos y vencimiento:** `vencimientos_restos` (cuentas y personas) y `vencer_simular_hoy`, que tiene que ser **0**.
- **Saldo por miembro:** la suma del libro, sin los vencimientos D1 y de restos, tiene que ser igual al credit − debit de Firestore, con **0 diferencias**.
- **Créditos activos:** el total, separado en externos y equipo, y la cantidad de cuentas con créditos. Las cuentas en baja tienen que terminar en 0.
- **PM:** el neto de las cuentas no borradas, separado en con sufijo «PM» y sin sufijo.
- **Totales por mes,** en UTC y en hora de Costa Rica.
- **Conteos** de miembros, tarjetas, canjes, vencimientos y PM.
- **Barrido de `anon`:** tiene que dar vacío.
