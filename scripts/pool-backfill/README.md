# Backfill de `tip_sessions.pool_total_crc` (READ-ONLY en esta fase)

Persiste el **total real del pool por turno** = `calcTurno/calcHistory().totalPool` (el SAGRADO):
`efectivo + propinaSala (por covered_role) + barra (efectivo + electrónica)`. Con eso Historial
—y a futuro todos los reportes— muestran el total real **sin recomputar** y sin releer las entries
por turno (el fallback `poolTotalOf` subcuenta: le falta la `propinaSala`).

El número **no se reimplementa**: el harness importa `calcHistory` de
`src/shared/utils/tipCalculations.ts` y lo envuelve (`core.ts`). `core.test.ts` lo fija al peso
(patrón oracle) y corre dentro de `npm test`.

## Cómo se ejecuta

Node ≥ 22.18 (type stripping nativo, sin `tsx`). El `--import register.mjs` engancha un resolver
ESM de ~10 líneas para los imports sin extensión de `src/`. Desde la raíz del repo.

### Dry-run contra STAGING (no escribe)

```bash
node --import ./scripts/pool-backfill/register.mjs scripts/pool-backfill/run.ts
```

Requiere `.env.local` con `VITE_SUPABASE_URL` de staging y el token de la Management API
(`SUPABASE_ACCESS_TOKEN` o Keychain `Supabase CLI`). Candado: `assertStaging` aborta si el `.env`
no apunta a staging.

### Dry-run READ-ONLY contra PRODUCCIÓN (no escribe)

```bash
POOL_BACKFILL_PROD_FIRMADO=2026-08-05 \
  node --import ./scripts/pool-backfill/register.mjs scripts/pool-backfill/run-prod.ts
```

Doble opt-in (`prod-gate.ts`): el ref de prod está **clavado en el código** y además exige la firma
`POOL_BACKFILL_PROD_FIRMADO`. Antes de leer un dato manda una escritura con `read_only:true` y
**exige** que el server la rechace (25006); toma `count(*)` antes/después y aborta si cambió.
Control: **Julio 2026 = ₡2.167.131** (== Estadísticas / Correo / Quincenal); si no coincide, sale ≠ 0.

`run-prod.ts` **no importa** ningún camino de escritura.

## Aplicar el backfill (fase de PASE — NO en esta fase BUILD)

Solo STAGING, solo cuando la mig `051` ya esté aplicada, y escribe **únicamente** `pool_total_crc`:

```bash
POOL_BACKFILL_APPLY=yes node --import ./scripts/pool-backfill/register.mjs scripts/pool-backfill/run.ts
```

Re-ejecutable (idempotente): salta las sesiones cuyo `pool_total_crc` ya coincide (`EPS = 0.5`).
`applyPoolTotalStaging` aborta si el ref no es staging y valida cada UPDATE
(`assertOnlyPoolTotalUpdate`: una sentencia, solo esa columna, `where id = uuid`).

## Typecheck del harness (aparte del build de la app)

```bash
npx tsc -p scripts/pool-backfill
```

## Archivos

- `core.ts` — envuelve el SAGRADO `calcHistory` → `sessionPoolTotal` / `planSessions` / `monthlyTotals`. Puro.
- `core.test.ts` — paridad (oracle) + covered_role + redondeo mensual. Corre en `npm test`.
- `mgmt.ts` — lectura read-only por Management API (reusa token/guard/sonda de `../t0-reconciliacion-cajas`) + escritura staging-only de una columna.
- `report.ts` / `runner.ts` — armado del reporte del dry-run.
- `run.ts` (staging) · `run-prod.ts` (prod, firmado, read-only) · `prod-gate.ts` (doble opt-in).
- `register.mjs` / `ts-resolve-hook.mjs` / `tsconfig.json` — plomería del runner (mismo molde que T0).
