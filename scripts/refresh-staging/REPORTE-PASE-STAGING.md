# Pase a STAGING · estado

> ## 🔴 EL PASE **NO** SE EJECUTÓ
>
> Frenado en **A.3 (la copia de datos)** por una **FK dura de `created_by` contra `profiles`**,
> exactamente el caso que la consigna mandaba reportar en vez de forzar. El detalle, con números
> y las cuatro opciones, está en [PLAN.md §4](PLAN.md).
>
> **No se hizo merge, ni push, ni deploy, ni se sembró la apertura.** Nada salió a staging.
> **La base de staging quedó ÍNTEGRA**, verificada contra el backup.

## Qué SÍ quedó hecho

| Parte | Estado |
|---|---|
| **A.1** Plan read-only + diff de esquema + grafo de FKs | ✅ [PLAN.md](PLAN.md) |
| **A.2** Backup de staging a JSON + restore documentado | ✅ 11 tablas · 3.415 filas |
| **A.3** Copia prod → staging | 🔴 **FRENADA** — decisión pendiente |
| **A.4** Verificación post-refresh | ⏸️ depende de A.3 |
| **B** Corte por variable de entorno + test | ✅ commiteado |
| **C.1** Seed de apertura | ⏸️ la cifra sale de los datos refrescados |
| **C.2** Merge + push + deploy | ⏸️ sin datos frescos la validación en piso no sirve |
| **C.3** Este reporte | ✅ (como estado, no como acta de pase) |

## Estado de la base de STAGING

Se intentó la copia, falló en la primera tabla y **se restauró**. Verificado tabla por tabla
contra el backup `_backups-staging/2026-07-22-pre-refresh/`:

| tabla | filas |
|---|---|
| `cash_movements` | 980 |
| `cash_sessions` | 170 |
| `cash_cierres_dia` | 16 |
| `suppliers` | 85 |
| `tip_sessions` | 177 |
| `tip_entries` | 1047 |
| `role_tip_points` | 7 |
| `employees` | 31 |
| `exchange_rates` | 3 |
| `movement_deletions` | 792 |
| `documents` | 107 |

Además: **0** movimientos con `session_id` colgado y los **5** `documents.linked_movement_id`
intactos. PROD nunca se tocó — el smoke de rechazo de escritura (`25006`) se verificó antes de
leer un solo dato.

## B · La fecha de corte, resuelta

`POZO_CORTE` ahora sale de **`VITE_POZO_CORTE`**, con `2026-08-01` de fallback y validación de
formato (una fecha mal formada o inexistente —`2026-02-31`— cae al fallback y avisa por consola).

**Cómo inyectarla, y por qué esa vía.** El repo solo tiene workflow para **prod**
(`.github/workflows/deploy.yml` → GitHub Pages). **Staging es Cloudflare Pages con configuración
externa: no hay workflow en el repo**, la integración git de CF buildea el push sola. Por eso la
variable **no se puede setear desde acá**: hay que cargarla en el **dashboard de Cloudflare Pages**
(Settings → Environment variables → `VITE_POZO_CORTE = 2026-07-23`).

Verificado que la vía funciona:

```bash
VITE_APP_ENV=staging VITE_POZO_CORTE=2026-07-23 npm run build
# → dist/assets/cierrePozo-*.js contiene 2026-07-23
```

**Si preferís no tocar el dashboard**, la alternativa es un commit SOLO-STAGING que fije
`POZO_CORTE_FALLBACK = '2026-07-23'`, marcado **NO cherry-pickear a main**. Con la vía de la env
var disponible y probada, esa segunda vía queda como plan B — no se hizo el commit para no dejar
una divergencia de ramas que después haya que recordar no mergear.

## Lo que falta, en orden

1. **Decidir la opción de [PLAN.md §4](PLAN.md)** (recomendada: la 2 — remapear 14 filas, sin
   tocar auth ni esquema).
2. Correr `backup.ts` y después `refresh.ts` con la opción elegida.
3. Verificar: conteos prod == staging, y re-correr el harness (`run.ts` + `run-t2.ts`) sobre los
   datos frescos. La red de regresión tiene que seguir dando los mismos pares consecutivos.
4. Sembrar la apertura del pozo con el contado físico del último cierre completo de los datos
   frescos (`sep_diaria + sep_registradora + remanente`, CRC y USD) — la cifra se imprime bien
   grande para que la dueña la verifique.
5. Cargar `VITE_POZO_CORTE=2026-07-23` en Cloudflare Pages.
6. Merge `feat/t2-cierre-pozo` → `staging` y push. **`main` no se toca.**
7. Verificar deploy verde + `{base}version.json` con el commit esperado + smoke del sitio.

## Limitaciones conocidas (cuando se ejecute)

- **Storage no se copia**: las fotos de facturas apuntarán a paths que en staging no existen. No
  afecta ningún número.
- `tip_sessions.pool_pos_*` quedan en 0 (columnas del PoS que prod no tiene).
- `supplier_item_map` queda con referencias colgadas a proveedores reemplazados.
- Según la opción elegida, hasta 14 filas pueden quedar atribuidas a otra persona.
