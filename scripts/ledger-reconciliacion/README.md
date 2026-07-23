# Reconciliación del ledger de migraciones — herramientas READ-ONLY

Diagnostican `supabase_migrations.schema_migrations` **por objeto/privilegio**, no por el ledger
(que es justo lo que está en duda). Van por **Management API** porque `supabase db query --linked`
**cuelga** en este entorno. Todo pasa por `assertSoloSelect()` + `read_only:true`, y antes de leer
prueban que el servidor **rechaza** una escritura (`25006`). **Ninguno escribe.**

```bash
# staging (libre)
node --import ./scripts/t0-reconciliacion-cajas/register.mjs scripts/ledger-reconciliacion/diagnostico.ts staging

# prod (doble opt-in: ref clavado + firma del dueño)
T0_PROD_FIRMADO=2026-07-23 T0_FIRMA_ESPERADA=2026-07-23 \
  node --import ./scripts/t0-reconciliacion-cajas/register.mjs scripts/ledger-reconciliacion/diagnostico.ts prod
```

| script | qué hace |
|---|---|
| `backup.ts <entorno> <sufijo>` | Vuelca el ledger a `_handoff/ledger-<entorno>-<sufijo>.json`. **Correr SIEMPRE antes de escribir.** |
| `diagnostico.ts <entorno>` | Ledger + sondas por objeto de cada migración → qué está aplicado de verdad. |
| `acl-funciones.ts <entorno>` | Privilegios de las `SECURITY DEFINER`: cuáles quedaron ejecutables por `anon`. |
| `comun.ts` | Candados (ref clavado, firma de prod, link del CLI), `q()` read-only y el smoke. |

## Lo que hay que saber antes de tocar el ledger

- **Escribir NO se hace desde acá.** `migration repair` y los `UPDATE` de `version` van a mano, con
  **firma del dueño**, backup previo y el ritual del ref. Ver `ESTADO.md §(c)`.
- **Nunca `repair --status reverted` sobre algo aplicado.** El CLI lo sugiere; sería mentirle al
  ledger. Pasó con el `035` y con el `009`.
- **El CLI ordena los archivos por NOMBRE y el ledger por VERSIÓN.** Si los dos órdenes no
  coinciden, el merge-join se desalinea y `db push` se bloquea aunque la base esté perfecta. Por eso
  `009_user_selfsignup.sql` se renombró a `0090_…` (staging, 2026-07-23).
- **Estado:** Fase A + B1 ✅ (staging, `db push` destrabado) · **B2 (prod) pendiente**.
  Historia completa: [`_handoff/FASE-A-LEDGER-2026-07-23.md`](../../_handoff/FASE-A-LEDGER-2026-07-23.md).
