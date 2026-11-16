# Pase a PROD de la mig 177 `esquema_centimos_como_prod` (origen caja 097)

> **Estado: preparado, SIN ejecutar.** Formato del `PASE-089`. **Lleva firma: esquema (sin efecto en prod).** Firma del
> dueño por el chat: «177 Mergea» (15-nov-2026). Si algo no coincide con lo que dice acá, **se para y se avisa**.
>
> - **Vía: merge → Branching.** No se aplica nada a mano.
> - **Orden:** DESPUÉS de la **174, 175 y 176** (PRs #206, #205 y #204, sin mergear al preparar esto). Branching rechaza
>   un número menor después de uno mayor: si la 177 entrara antes, la 174–176 ya no podrían entrar con su número.
>   La 177 no depende de ellas ni ellas de la 177 (no tocan estas columnas).
> - **Regla del ledger:** exactamente 1 fila `177` con su `name`. No se compara md5.
> - **Repo público:** en la bitácora solo tipos y conteos; nunca montos.

## 1. Qué pasa y qué no
- **El problema:** `001_initial_schema.sql` declara `cash_movements.amount_crc`, `tip_entries.tip_amount_crc`,
  `tip_entries.payout_crc` y seis columnas de `cash_sessions` como `NUMERIC(12,0)`, pero en prod son `numeric(12,2)`;
  ninguna migración del repo explica el cambio (se hizo a mano antes del baseline). Además, `0095_drift_baseline` crea
  «if not exists» `cash_cierres_dia` y las tablas de inventario/recetas con `numeric` sin escala (en prod ya existían
  con escala). Una base armada desde el repo redondea céntimos o guarda escalas distintas a prod.
- **Pasa (en una base armada desde el repo):** las 39 columnas de la tabla §2 quedan con el tipo de prod.
- **Pasa en PROD:** nada. La 177 lee `pg_attribute`, ve que cada columna ya tiene el tipo de destino y no ejecuta ningún
  `ALTER` (ni reescritura ni lock de tabla). Solo agrega la fila 177 al ledger.
- **No pasa:** ni datos, ni funciones, ni políticas, ni sagrados, ni Edge. No agrega las 5 columnas que faltan en el
  repo (§2b).

## 2. Las diferencias (todas las columnas numéricas de `public`)
Lectura en prod (`yiczgdti…`, solo lectura: `pg_attribute`/`information_schema.columns`, 15-nov-2026 23:38 -06:00)
contra una base Postgres 16 armada con `scripts/sql/local_armar_base.sh` desde `main` `4ba922e`. De 204 columnas
numéricas de prod, 199 existen en la base del repo y **39 tienen otro tipo** (30 de plata):

| # | Columna | Repo antes de la 177 | PROD (y repo después) | Declarada en | ¿Plata? |
|---|---|---|---|---|---|
| 1 | `cash_cierres_dia.diferencia_crc` | numeric | numeric(12,2) | 0095_drift_baseline | sí |
| 2 | `cash_cierres_dia.ef_real_m_crc` | numeric | numeric(12,2) | 0095_drift_baseline | sí |
| 3 | `cash_cierres_dia.ef_real_n_crc` | numeric | numeric(12,2) | 0095_drift_baseline | sí |
| 4 | `cash_cierres_dia.otros_m_crc` | numeric | numeric(12,2) | 0095_drift_baseline | sí |
| 5 | `cash_cierres_dia.otros_n_crc` | numeric | numeric(12,2) | 0095_drift_baseline | sí |
| 6 | `cash_cierres_dia.propinas_m_crc` | numeric | numeric(12,2) | 0095_drift_baseline | sí |
| 7 | `cash_cierres_dia.propinas_n_crc` | numeric | numeric(12,2) | 0095_drift_baseline | sí |
| 8 | `cash_cierres_dia.remanente_crc` | numeric | numeric(12,2) | 0095_drift_baseline | sí |
| 9 | `cash_cierres_dia.remanente_usd` | numeric | numeric(8,2) | 0095_drift_baseline | sí |
| 10 | `cash_cierres_dia.sep_diaria_crc` | numeric | numeric(12,2) | 0095_drift_baseline | sí |
| 11 | `cash_cierres_dia.sep_diaria_usd` | numeric | numeric(8,2) | 0095_drift_baseline | sí |
| 12 | `cash_cierres_dia.sep_registradora_crc` | numeric | numeric(12,2) | 0095_drift_baseline | sí |
| 13 | `cash_cierres_dia.sep_registradora_usd` | numeric | numeric(8,2) | 0095_drift_baseline | sí |
| 14 | `cash_cierres_dia.tipo_cambio` | numeric | numeric(8,2) | 0095_drift_baseline | sí |
| 15 | `cash_cierres_dia.vm_crc` | numeric | numeric(12,2) | 0095_drift_baseline | sí |
| 16 | `cash_cierres_dia.vm_usd` | numeric | numeric(8,2) | 0095_drift_baseline | sí |
| 17 | `cash_cierres_dia.vn_crc` | numeric | numeric(12,2) | 0095_drift_baseline | sí |
| 18 | `cash_cierres_dia.vn_usd` | numeric | numeric(8,2) | 0095_drift_baseline | sí |
| 19 | `cash_movements.amount_crc` | numeric(12,0) | numeric(12,2) | 001 | sí |
| 20 | `cash_sessions.final_bank_crc` | numeric(12,0) | numeric(12,2) | 001 | sí |
| 21 | `cash_sessions.final_safe_crc` | numeric(12,0) | numeric(12,2) | 001 | sí |
| 22 | `cash_sessions.final_service_crc` | numeric(12,0) | numeric(12,2) | 001 | sí |
| 23 | `cash_sessions.final_suppliers_crc` | numeric(12,0) | numeric(12,2) | 001 | sí |
| 24 | `cash_sessions.initial_service_crc` | numeric(12,0) | numeric(12,2) | 001 | sí |
| 25 | `cash_sessions.initial_suppliers_crc` | numeric(12,0) | numeric(12,2) | 001 | sí |
| 26 | `ingredients.cost_per_unit` | numeric | numeric(12,2) | 0095_drift_baseline | sí |
| 27 | `ingredients.current_stock` | numeric | numeric(12,3) | 0095_drift_baseline | no |
| 28 | `ingredients.min_stock` | numeric | numeric(12,3) | 0095_drift_baseline | no |
| 29 | `inventory_movements.qty_delta` | numeric | numeric(12,3) | 0095_drift_baseline | no |
| 30 | `inventory_movements.unit_cost` | numeric | numeric(12,2) | 0095_drift_baseline | sí |
| 31 | `recipe_ingredients.quantity` | numeric | numeric(12,4) | 0095_drift_baseline | no |
| 32 | `recipe_ingredients.waste_factor` | numeric | numeric(5,4) | 0095_drift_baseline | no |
| 33 | `recipes.yield_qty` | numeric | numeric(10,3) | 0095_drift_baseline | no |
| 34 | `role_tip_points.points` | integer | numeric(4,1) | 001 | no |
| 35 | `tip_entries.hours_worked` | numeric(4,1) | numeric(4,2) | 001 | no |
| 36 | `tip_entries.payout_crc` | numeric(12,0) | numeric(12,2) | 001 | sí |
| 37 | `tip_entries.points` | numeric(8,2) | numeric(10,4) | 001 | no |
| 38 | `tip_entries.tip_amount_crc` | numeric(12,0) | numeric(12,2) | 001 | sí |
| 39 | `tip_entries.tip_amount_usd` | numeric(8,2) | numeric(10,2) | 001 | sí |

### 2b. Columnas que están en prod y faltan en el repo (fuera del alcance de la 177)
`cash_movements.amount_usd`, `cash_sessions.initial_cash_crc`, `initial_cash_usd`, `final_cash_crc`, `final_cash_usd`
(todas `numeric` sin escala en prod). Ninguna migración del repo las crea: una base desde el repo no las tiene, aunque
funciones del repo (p. ej. la 074) insertan `amount_usd`. Queda como decisión aparte (ver el PR). La batería (caso 08)
falla si aparece otra faltante.
**Resuelto (16-nov, «177 firmo A»):** las declara la 178 (`docs/pases/PASE-178-columnas-caja.md`).

### 2c. Dependencias
Ninguna vista depende de estas tablas en prod (`pg_depend`/`pg_rewrite`: 0) ni en la base local; ninguna política ni
restricción usa estas columnas. Un `ALTER ... TYPE` no queda bloqueado en una base nueva. Triggers de fila no se
disparan con `ALTER ... TYPE`.

## 3. Prerrequisitos
- PR en borrador con revisión y **firma del dueño sobre el SHA exacto** (firmado: «177 Mergea»).
- La 174, 175 y 176 ya en el ledger de prod (o el dueño decide otro orden y se renumera).
- Ventana de merge (regla D1): libre de 23:30 a 15:50; nunca de 15:50 a 19:00.

## 4. Lecturas previas en prod (solo lectura, `begin read only` … `rollback`)
Tomadas el 15-nov-2026 23:38 -06:00:
- Ledger: **87 filas, última 173, sin fila 177**.
- Las 39 columnas de §2 ya tienen el tipo de la columna «PROD» (0 diferencias). Consulta:
  ```sql
  begin read only;
  select c.relname||'.'||a.attname as col, format_type(a.atttypid, a.atttypmod) as tipo
    from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('cash_movements','cash_sessions','tip_entries','role_tip_points',
         'cash_cierres_dia','ingredients','inventory_movements','recipes','recipe_ingredients')
     and a.attnum > 0 and not a.attisdropped and a.atttypid in ('numeric'::regtype, 'int4'::regtype)
   order by 1;
  select relname, relfilenode from pg_class where relnamespace = 'public'::regnamespace and relname in
         ('cash_movements','cash_sessions','tip_entries','role_tip_points','cash_cierres_dia','ingredients',
          'inventory_movements','recipes','recipe_ingredients') order by 1;
  rollback;
  ```
  Anotar los `relfilenode` el día del pase (antes del merge).
- Re-tomar estas lecturas justo antes del merge: si alguna columna ya no tiene el tipo de §2, **se para**.

## 5. Pruebas
- **Base local** (Postgres 16, `PGHOST=/tmp PGPORT=5499`): `bash scripts/sql/177_pruebas.sh` → arma una base desde el
  repo y corre `scripts/sql/177_pruebas.sql` (transacción descartada). Resultado: **10/10** y **4/4 mutaciones muerden**:
  sin la guarda → cae 04 (la 2.ª corrida hace ALTER); sin una columna de la lista → cae 02; con una escala distinta a
  prod → cae 02; sin el control anti-redondeo → cae 07. Los casos 04 y 05 prueban lo de prod: en una base que ya tiene
  los tipos de prod, 0 `ALTER TABLE` (contados con un trigger de evento `ddl_command_end`, cuyo funcionamiento prueba el
  06) y ninguna tabla reescrita (`relfilenode` igual).
- **Staging:** no aplica (staging descartado como espejo; la batería vuelve tipos atrás y crea un trigger de evento:
  solo base local).

## 6. Humo después (solo lectura)
- Ledger: exactamente 1 fila `177` con `name = esquema_centimos_como_prod`; check «Supabase Preview» en success con «All
  migrations are up to date».
- La consulta de §4: **igual que antes** (mismos tipos y **mismos `relfilenode`**: prueba de que no hubo reescritura).
- Caja y propinas del día siguen registrando (montos con céntimos se guardan igual que antes).

## 7. Criterios de parada
Un error de Branching, un `relfilenode` distinto, o cualquier tipo distinto del de §2 → se para, se avisa y se evalúa §8.

## 8. Vuelta atrás
- En prod **no hay nada que deshacer** (la 177 no ejecutó ningún ALTER). `scripts/sql/177_rollback.sql` solo lee y
  confirma los tipos (esperado: 0 filas). **No** se vuelve a los tipos viejos (redondearía céntimos reales), **no** se
  borra la fila 177 del ledger y **no** se saca el `.sql` de `main` (regla 10). Cualquier ajuste: migración nueva.

## 9. Responsables
- **Ejecución:** el dueño (merge, o autoriza el merge).
- **Control:** otra persona o sesión que no ejecuta (lecturas de §4 y §6).

## 10. Firma y bitácora
| Cuándo (-06:00) | Qué | Quién | Resultado |
|---|---|---|---|
| 2026-11-15 23:38 | Lectura previa en prod (solo lectura) | sesión de Claude Code | 87 filas, última 173; 39 columnas ya con el tipo de prod |
| 2026-11-15 | Firma «177 Mergea» (esquema, sin efecto en prod) | dueño (chat) | — |
| | Merge → Branching | | |
| | Humo después | | |
