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

## Cómo correrlo contra PRODUCCIÓN (T0-B)

El dueño firmó la corrida read-only contra prod el **2026-07-22**. Entry point aparte,
reporte aparte ([`REPORTE-T0B-PROD.md`](REPORTE-T0B-PROD.md)), mismas consultas y mismas
clasificaciones:

```bash
T0_PROD_FIRMADO=2026-07-22 node --import ./scripts/t0-reconciliacion-cajas/register.mjs scripts/t0-reconciliacion-cajas/run-prod.ts
```

**Doble opt-in, y las dos condiciones son obligatorias:**

1. El ref de prod está **clavado en el código** de `run-prod.ts` — no sale de `.env.local`,
   así que apuntar el `.env` a otro lado no cambia nada.
2. Exige `T0_PROD_FIRMADO=2026-07-22`. Sin la variable, o con otra fecha, **aborta** y explica
   por qué. La fecha es la firma del dueño: para otro día hace falta autorización nueva y
   editar `FIRMA_REQUERIDA` a mano.

**Qué hace antes de leer un solo dato:**

- Manda a propósito un `create temp table` con `read_only:true` y **exige que el servidor lo
  rechace** con `25006`. Si esa sonda pasara, aborta sin consultar nada.
- Toma `count(*)` de las 3 tablas **antes** y **después** de la corrida, y los publica en el
  reporte. Si cambiaron, aborta: no fue el harness (solo manda SELECT), pero el snapshot ya
  no sería consistente.

El reporte de prod trae además una sección **§4 · Focos**: días que se auditan contra los datos
y no contra la memoria (remediaciones a mano, cajas viejas). Los focos se declaran en `FOCOS`,
dentro de `run-prod.ts`.

> `run.ts` (staging) **no cambió de comportamiento**: su reporte sale byte-idéntico al del
> commit anterior. Todo lo que agregó el T0-B es opcional y solo lo pasa `run-prod.ts`.

## T1 · Corrida paralela ANCLADA (staging)

```bash
node --import ./scripts/t0-reconciliacion-cajas/register.mjs scripts/t0-reconciliacion-cajas/run-t1.ts
```

Salida: [`REPORTE-T1-PARALELO.md`](REPORTE-T1-PARALELO.md). Mismo candado de entorno que `run.ts`
(staging o nada) y mismo transporte read-only.

Valida el núcleo **`src/modules/cash/pozo.ts`** —recién promovido a la app pero que **nadie
importa todavía**— contra el histórico real. En vez de acumular desde cero como el T0 (que da
negativo por falta de asiento de apertura), **se ancla en el conteo físico sellado del día
anterior** y reconstruye qué debería haber al cierre del día siguiente:

```
ancla(d−1)  = sep_diaria + sep_registradora + remanente     ← contado a mano
esperado(d) = ancla(d−1) + ef_real_m + ef_real_n − propinas_m − propinas_n − otros_n
            + neto del período (d−1, d]   ← calculado por saldoPozoEfectivo, la función real
residuo     = (contado − esperado) − diferencia_crc sellada
```

Anclar en el físico hace que **cada día se evalúe solo**, sin arrastrar el error del anterior.
El harness importa `contribucionPozo` de `src/`: si el núcleo cambia, el reporte cambia — que es
lo que se le pide a una validación paralela.

**Tres trampas de doble conteo**, todas evitadas por exclusión explícita y reportada:

1. `ef_real_*` ya es **BRUTO** (verificado en `CashCierre.tsx`: `efRealM = vm_crc − vm_usd·tc`).
   Sumarle las propinas "de vuelta" las contaría al revés.
2. Las filas `Ventas cierre` que genera el cierre son **NETAS** de propinas: contarlas a ellas y
   además a los egresos `Propinas por turno` resta las propinas dos veces.
3. El retiro de dueños **no es un movimiento aparte**: `recordCierreRetiro` lo graba como traspaso
   `Caja Fuerte → Banco`. Contarlo como `otros_n` y como traspaso del período lo resta dos veces.

Las propinas de **días intermedios** sí cuentan como egreso: `propinas_m/n` solo cubre las del día
del cierre, así que en un período con hueco las del medio no están selladas en ningún lado.

### Adenda T1 · las dos preguntas sobre PROD

`run-t1.ts` corre **también contra producción** para responder las dos preguntas obligatorias de la
adenda (§5 y §6 del reporte), con el **mismo doble opt-in** que `run-prod.ts` — el candado vive una
sola vez, en `prod-gate.ts`:

```bash
T0_PROD_FIRMADO=2026-07-22 node --import ./scripts/t0-reconciliacion-cajas/register.mjs scripts/t0-reconciliacion-cajas/run-t1.ts
```

Sin la firma **aborta**. Para quedarse solo con la parte de staging: `--solo-staging`.

- **§5 — el sobrante del 2026-07-18.** Replay mecánico del cierre con `saldoCajaFuerte` sobre el
  ledger **tal como estaba al sellar** (con el de hoy da otro número). Reproduce la diferencia
  sellada al céntimo y descompone el sobrante colón por colón.
- **§6 — la no-uniformidad del "hueco 2".** Descompone el efectivo de cada día por los tres canales
  que pueden avisarle a `deberia` (ledger de Caja Fuerte · campos sellados `propinas_m/n` · ninguno)
  y mide la brecha contra la diferencia sellada.

Lo que no cierra queda **declarado como NO-EXPLICADO con números**, no forzado.

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
- **Cada entorno por su puerta.** `run.ts` (staging) tiene el ref clavado en `env.ts` **sin
  override**: si la URL no es la de staging —prod incluido— aborta antes de abrir la primera
  conexión. A prod solo se llega por `run-prod.ts`, con el ref clavado en el código **y** la
  firma del dueño en el entorno. Ningún entry point puede terminar en el proyecto equivocado
  por un `.env` mal apuntado.
- **`src/` intacto.** El único símbolo importado de la app es `saldoCajaFuerte`, en modo lectura.
  Los sagrados (`cashUtils.ts`, `tipCalculations.ts`, `posFiscal.ts`) quedan byte a byte iguales.
- **Idempotente.** Re-correrlo con los mismos datos produce un reporte **byte-idéntico**: no se
  estampa la hora de ejecución, sino el watermark de los datos (conteos + último `created_at`).
- **No entra a la suite.** Ningún archivo se llama `*.test.ts`, así que `npm test` lo ignora.
  `tsconfig.app.json` solo incluye `src`, así que tampoco entra a `npm run build`.

## Qué hay adentro

| Archivo | Qué hace |
|---|---|
| `run.ts` | Entrypoint STAGING: lee → analiza → verifica invariantes → escribe el reporte |
| `run-prod.ts` | Entrypoint PROD (doble opt-in) → `REPORTE-T0B-PROD.md` |
| `run-t1.ts` | Entrypoint T1: corrida anclada por día → `REPORTE-T1-PARALELO.md` |
| `anclado.ts` | T1: pares de cierres, período, exclusiones y diagnóstico. Sin red |
| `reporte-t1.ts` | T1: render del Markdown |
| `preguntas.ts` | T1: replay del cierre y descomposición por canal (adenda). Sin red |
| `prod-gate.ts` | Doble opt-in de PROD — implementación única, la usan run-prod.ts y run-t1.ts |
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
