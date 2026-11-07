# Club Satori — migración desde Firestore (F1b)

`migrar_firestore.py` pasa el sistema viejo de créditos (Firestore `creditos-73bac`, solo Satori) a las tablas `club_*` de la mig 075. **Solo staging**: el ref está fijo en el código y el script se niega a correr contra cualquier otro, prod incluido. Spec: [`docs/club-satori/SPEC.md`](../../docs/club-satori/SPEC.md) §7.

## Reglas de privacidad
- El export trae teléfonos y emails. Va **fuera del repo** (por ejemplo `~/club-export/`, con permisos 700). El script se niega a leer el export o a escribir la salida dentro del repo.
- El script nunca imprime nombres, teléfonos ni emails: solo conteos y sumas. A los errores de la base se les quita la fila que falló.
- Los dos CSV de revisión (`equivalencias_negocios.csv` y `duplicados.csv`) sí tienen nombres. Se escriben en `--out`, fuera del repo, con permisos 600.
- Cuando Ismael apruebe la prueba, se borran el export y la carpeta de salida.

## Uso
```bash
# 1) Plan, sin tocar la base: conteos, controles y CSV de revisión
python3 -I scripts/club/migrar_firestore.py --export ~/club-export/export.zip --dry-run

# 2) Carga en STAGING: borra lo migrado antes (origen='migracion') y vuelve a insertar, en una transacción
python3 -I scripts/club/migrar_firestore.py --export ~/club-export/export.zip --apply
```
- `--export`: el zip o la carpeta con `businesses.json`, `referrers.json`, `referrals.json`, `referrals_club.json` y `vencimientos_*.json`.
- `--out`: la carpeta de salida (por defecto `~/club-export/salida`). Ahí quedan los CSV y `validacion.json`.
- **Conexión:** usa la Management API de Supabase (`/v1/projects/{ref}/database/query`), porque hace falta SQL transaccional. El token va en la variable de entorno `SUPABASE_ACCESS_TOKEN` y nunca en el repo. En la sesión de Claude Code lo inyecta el proxy.
- **Re-ejecutable:** `--apply` borra de `club_pm_*`, `club_movimientos`, `club_miembros` (y sus contactos, en cascada) y `club_negocios` todo lo que tiene `origen = 'migracion'`. **Nunca toca `club_config`.** Si hay datos cargados en la app sobre miembros migrados (movimientos, cupones, PM o visitas), aborta sin borrar nada.

## Mapeo
| Origen | Destino | Regla |
|---|---|---|
| `businesses` | `club_config` (santa-teresa) | Se verifica que la tasa sea igual a `personas_por_credito` (6); si no, aborta. No se modifica. |
| `workPlace` | `club_negocios` (`origen='migracion'`, tipo `otro`) | Se normaliza con la misma regla del índice único (espacios, mayúsculas y tildes). Las variantes que coinciden se unifican. Las fusiones dudosas solo aparecen como sugerencia en el CSV. |
| `referrers` | `club_miembros` (`legacy_id = _id`) + `club_miembros_contacto` | `deleted` pasa a `baja`. Tipo: «satori» en el nombre o el negocio → `equipo`; nombre terminado en «PM» o con montos en `referrals_club` → `concierge_pm`; el resto → `referente`. Teléfono a E.164 (+506 si tiene 8 dígitos); texto o «None» → vacío. Email inválido → vacío. Código y token nuevos. Un nombre vacío queda como «(sin nombre)». |
| `referrals` credit | `club_movimientos` `tarjeta` | `personas = peopleCount` · `fecha_visita = createdAt` · nota «fecha aproximada (carga)». |
| `referrals` debit (sin los de `vencimientos_*.json`) | `club_movimientos` `canje` | Se agrupan por referente y minuto UTC: un canje por grupo, con `personas = −Σ`, `creditos = Σ/6` y los ids viejos en `legacy_ids`. Los canjes de más de 2 créditos se migran como están (D3). |
| ids de `vencimientos_*.json` | `club_movimientos` `vencimiento` | Uno por referente, con nota «cancelación inactividad 05-nov-2026». |
| cuentas `deleted` con saldo > 0 | `club_movimientos` `vencimiento` | D1 (corregida el 05-nov): por el saldo, fechado en la baja = la más tardía entre `updatedAt` y el último movimiento de la cuenta, con la nota «cuenta borrada en el sistema viejo». Si alguna fecha cae desde el 1-nov-2026, el script frena. Así un mes cerrado da siempre lo mismo. |
| restos sin actividad | `club_movimientos` `vencimiento` | Decisión de Ismael (07-nov): las cuentas sin tarjeta, canje ni restitución en el plazo de vencimiento que solo tienen un **resto de menos de medio crédito** (1 o 2 personas con la tasa 6) se vencen con la **fecha de la migración** y la nota «resto del sistema viejo». Mismo criterio que `club_vencer_candidatos`. Después, la simulación de hoy tiene que dar **0 cuentas**; si queda alguna, la migración frena sin guardar nada. |
| `referrals_club` credit / debit | `club_pm_cargos` (`pendiente`) / `club_pm_pagos` | `amount / 100` = colones. Los cargos de cuentas borradas pasan a `anulado`, con `anulado_en` = la fecha de la baja (D2). |

## Validación (`validacion.json`, solo agregados)
- **Restos y vencimiento:** `vencimientos_restos` (cuentas y personas) y `vencer_simular_hoy`, que tiene que ser **0**.
- **Saldo por miembro:** la suma del libro, sin los vencimientos D1 y de restos, tiene que ser igual al credit − debit de Firestore, con **0 diferencias**.
- **Créditos activos:** el total, separado en externos y equipo, y la cantidad de cuentas con créditos. Las cuentas en baja tienen que terminar en 0.
- **PM:** el neto de las cuentas no borradas, separado en con sufijo «PM» y sin sufijo.
- **Totales por mes,** en UTC y en hora de Costa Rica.
- **Conteos** de miembros, tarjetas, canjes, vencimientos y PM.
- **Barrido de `anon`:** tiene que dar vacío.
