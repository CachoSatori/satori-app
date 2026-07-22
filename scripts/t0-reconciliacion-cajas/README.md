# T0 · Harness de reconciliación de cajas (READ-ONLY)

Mide el histórico de caja de **STAGING** y corre el modelo de **pozo único de efectivo** en
paralelo al modelo actual (`saldoCajaFuerte`), **sin tocar la app**. Es el insumo de números
para decidir el rediseño; no propone ni ejecuta ninguna migración.

Salida: [`REPORTE-T0-RECONCILIACION.md`](REPORTE-T0-RECONCILIACION.md) en esta misma carpeta.

## Cómo correrlo

```bash
node --import ./scripts/t0-reconciliacion-cajas/register.mjs scripts/t0-reconciliacion-cajas/run.ts
```

Desde la raíz del repo. Requiere Node ≥ 22.18 (usa el *type stripping* nativo, sin `tsx` ni
compilación previa) y `.env.local` con `VITE_SUPABASE_URL` apuntando a staging.

El `--import` registra un resolver ESM de ~10 líneas (`ts-resolve-hook.mjs`) para que Node pueda
seguir los imports sin extensión que usa `src/` (Vite los resuelve; Node crudo no). Sin él,
importar `cashUtils.ts` falla al resolver `'../../shared/utils'`.

Opcional: `--out <ruta>` para escribir el reporte en otro lado.

Typecheck del harness (aparte del build de la app, que no lo mira):

```bash
npx tsc -p scripts/t0-reconciliacion-cajas
```

### Credenciales

La **anon key sola no sirve**: RLS filtra `cash_movements` y PostgREST responde `200` con `[]`.
El harness elige transporte en este orden:

| Orden | Transporte | De dónde sale la credencial |
|---|---|---|
| 1 | `postgrest` | `SUPABASE_SERVICE_ROLE_KEY` en el entorno |
| 2 | `mgmt` | `SUPABASE_ACCESS_TOKEN`, o el Keychain de macOS (`security find-generic-password -s "Supabase CLI"`) |
| 3 | `postgrest` | `VITE_SUPABASE_ANON_KEY` — casi seguro devuelve 0 filas, y entonces el script aborta explicando esto |

En la máquina de la dueña sale por el **camino 2** (el mismo canal read-only que ya se usó para
diagnósticos anteriores, ver `HALLAZGOS.md`). Forzar uno con `T0_BACKEND=mgmt|postgrest`.
El token nunca se imprime ni se guarda.

## Garantías

- **READ-ONLY de verdad.** El transporte `mgmt` manda cada consulta con `read_only: true`, que
  Postgres impone a nivel de transacción: un `CREATE` por ese canal falla con `25006`. Además
  `assertSoloSelect()` rechaza cualquier sentencia que no empiece con `SELECT`. Cero
  INSERT/UPDATE/DELETE, cero DDL, cero migraciones.
- **Solo staging.** El ref del proyecto está clavado en `env.ts` y **no hay override**: si la URL
  no es la de staging (incluido prod), el script aborta antes de abrir la primera conexión.
- **`src/` intacto.** El único símbolo importado de la app es `saldoCajaFuerte`, en modo lectura.
  Los sagrados (`cashUtils.ts`, `tipCalculations.ts`, `posFiscal.ts`) quedan byte a byte iguales.
- **Idempotente.** Re-correrlo con los mismos datos produce un reporte **byte-idéntico**: no se
  estampa la hora de ejecución, sino el watermark de los datos (conteos + último `created_at`).
- **No entra a la suite.** Ningún archivo se llama `*.test.ts`, así que `npm test` lo ignora.
  `tsconfig.app.json` solo incluye `src`, así que tampoco entra a `npm run build`.

## Qué hay adentro

| Archivo | Qué hace |
|---|---|
| `run.ts` | Entrypoint: lee → analiza → verifica invariantes → escribe el reporte |
| `env.ts` | `.env.local`, candado de proyecto (staging o nada), token de Management API |
| `db.ts` | Lectura read-only con los dos transportes; paginado; coerción de numéricos |
| `pozo.ts` | **`saldoPozoEfectivo`** y `contribucionPozo` — funciones puras del modelo nuevo |
| `analisis.ts` | Clasificación de cierres, comparativo pozo↔CF, inventarios. Sin red |
| `reporte.ts` | Render del Markdown |
| `ts-resolve-hook.mjs` + `register.mjs` | Resolver ESM para los imports sin extensión de `src/` |
| `tsconfig.json` | Solo para `tsc -p`; inerte para el build de la app |

`saldoPozoEfectivo` vive **acá y no en `src/`** a propósito: es una maqueta para medir, no código
de la app. Si el pozo se adopta, ese código se escribirá en `src/` con sus tests, en su propio pase.

## Invariantes que el script verifica antes de escribir

Si alguna falla, **aborta sin generar el reporte** (mejor nada que un número que miente):

1. **Espejo de `saldoCajaFuerte`.** Para desglosar la diferencia hace falta el aporte *por fila*,
   que la función real no expone. `contribucionCajaFuerte()` replica esa lógica y el script
   comprueba que su suma sea idéntica a la función importada. Si `cashUtils.ts` cambiara, salta acá.
2. **El desglose cuadra.** La suma de la columna Δ de §2.2 tiene que ser exactamente `pozo − CF`.
3. **Todos los cierres clasificados.** Ninguna fila `tipo='completo'` puede quedar sin clase.

## Parámetros

En `analisis.ts`, arriba del todo: `TOLERANCIA_CRC` (₡500), `VENTANA_PROPINA_DIAS` (±3 días) y
`FECHAS_NO_CONFIABLES` (los días con turnos ficticios de prueba en staging).
