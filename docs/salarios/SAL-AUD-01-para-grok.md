# SAL-AUD-01 — el arreglo, sus líneas y la prueba que falla sin él (para Grok)

**Arreglo:** mig **084** `supabase/migrations/084_employee_payroll.sql` en la rama `claude/salarios-rls`, commit
**`6ef968e`** (diseño de dos tablas, decidido por Ismael: «el manager SÍ puede VER las tarifas; banco solo
owner/contador»). md5 del archivo: `db243e229b4ec22db44f67a0604ec954` (= la fila 084 del ledger de staging desde el
08-nov 23:38 CR). Solo en staging; Salarios no está en prod.

## Qué cerraba
Antes de la 084 la planilla vivía en columnas de `employees` (`hourly_rate_crc`, `fixed_salary_crc`,
`nombre_homebanking`, `banco`, `cuenta_iban_alias`). Las políticas de `employees` dejan leer filas a todos los activos
(«Todos ven empleados activos») y gestionarlas al manager: **cualquier cajero o salonero leía las tarifas de todos, y el
manager leía y escribía los datos bancarios.**

## Las líneas
| Líneas | Qué |
|---|---|
| 37–56 | `employee_payroll` (tarifas). **SELECT: owner, manager, contador** (L55–56). |
| 62–68 | `employee_payroll` INSERT / UPDATE / DELETE: **solo owner y contador**. |
| 71–92 | `employee_bank_info` (datos bancarios). **Todo (incluido SELECT): solo owner y contador** (L90–92). |
| 95–115 | Mudanza: las tarifas y el banco de `employees` pasan a las tablas nuevas; `employees` queda en 0 / null. |
| 122 | `CHECK employees_planilla_en_employee_payroll`: nadie puede volver a escribir planilla en `employees` (23514). |
| 128–132 | `employee_wage_rates`: SELECT owner/manager/contador; escritura solo owner/contador. |

## La prueba que falla sin el arreglo
`scripts/sql/084_pruebas.sh` (sin falsos verdes, mismo esquema que la 085; solo staging, todo descartado):
- **`… CON`** (la 084 aplicada): `manager activo` → `ve_banco = false`, guardar → 42501; `cajero activo` →
  `ve_tarifa = false`; más owner/contador (ven y guardan), manager inactivo y salonero (nada), CHECK (23514) y anon
  (42501).
- **`… SIN`**: cada caso aplica `084_rollback.sql` dentro de su transacción (la planilla vuelve a `employees`) y corre
  las MISMAS lecturas. Resultado esperado: **el manager VE el banco** y **el cajero VE la tarifa** → las dos pruebas de
  seguridad («manager no lee banco», «cajero no lee tarifas») **fallan sin el arreglo**. El modo da verde cuando esas
  dos fallas aparecen.

**Evidencia ya corrida (08-nov, 23:38 CR):** la versión anterior del script (sin esperados automáticos) dio, comparada
a mano línea por línea: manager `banco 0`, guardar 42501; cajero y salonero `tarifas 0`; owner y contador leen y
guardan; CHECK 23514; anon 42501 (ver `docs/salarios/084-ventana-2026-11-08.md`). **El script nuevo (`CON` y `SIN`)
corre en la próxima ventana nocturna de staging** (no se corre de día: el modo `SIN` hace DDL dentro de la transacción).
