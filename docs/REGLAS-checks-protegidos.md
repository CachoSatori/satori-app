# Checks protegidos — un cambio no puede modificar los checks que lo juzgan

**Qué es:** el workflow `.github/workflows/checks-protegidos.yml` (check «Checks protegidos») mira la lista de archivos
de cada PR contra `main`. Si toca un archivo que **juzga** cambios (pruebas guardianas, skills, workflows, gate,
baterías de los PASE, tabla de hashes de los sagrados), lo marca, lista los archivos y dice **«necesita OK del dueño»**.

**Por qué:** si un PR puede aflojar la prueba, la skill o el workflow que lo revisa, el verde no prueba nada. Cambiar
un juez está permitido, pero a la vista y con OK explícito del dueño.

## Lista de archivos protegidos

La fuente de verdad es `REGLAS` en `scripts/ci/checks-protegidos.mjs`. Resumen:

| Patrón | Por qué |
|---|---|
| `src/*.test.ts` | Pruebas guardianas del repo entero: `privacidadRepo`, `dominioRepo`, `walletRepo`, `refProdEnPruebas`, `fechaHoyCR`, `ventasSoloPos` |
| `club-web/src/usted.test.ts`, `src/shared/wallet/usted.test.ts` | Guardas del «usted» en textos para clientes |
| `supabase/*.test.ts` | Pruebas de migraciones (`migraciones.test.ts`, `club_local_manager.test.ts`) |
| `.claude/**` | Skills de los agentes que hacen y revisan los PR |
| `CLAUDE.md`, `**/CLAUDE.md` | Convenciones que leen los agentes |
| `docs/REGLAS-POR-INCIDENTE.md`, `docs/REGLAS-checks-protegidos.md` | Reglas nacidas de incidentes y esta misma guarda |
| `.github/workflows/**`, `.github/CODEOWNERS` | Gate de CI, deploy y esta guarda |
| `scripts/ci/**` | Lint con línea base (`lint-linea-base.json`), esta guarda y su lista |
| `vite.config.ts`, `vitest.setup.ts`, `eslint.config.js` | Qué pruebas corren y con qué reglas de lint |
| `scripts/sql/mutar_bateria.py`, `mutaciones_*.json`, `bateria_*`, `baterias_*`, `gate61*`, `local_*` | Infraestructura de las baterías de los PASE |
| `scripts/sql/*_pruebas*`, `*_verificacion.sql` | Batería de un PASE **ya escrita** (modificar, borrar o renombrar). La batería **nueva** de una migración nueva no se marca |
| `ESTADO.md` (solo si el patch toca la tabla de hashes de los sagrados) | Una línea `+`/`-` que dice «sagrado», o que nombra un sagrado junto a un hash |

Renombrar un protegido también cuenta (se mira el nombre viejo). Si un protegido nuevo aparece en el repo, se agrega a
`REGLAS` en un PR (que a su vez queda marcado, como corresponde).

**Fuera a propósito:** `supabase/migraciones-reservadas.json` y las migraciones (cambian en cada PR de esquema y ya
las juzgan las pruebas de migraciones), `package.json` (cambia con cada dependencia) y los sagrados mismos
(`cashUtils.ts`, `tipCalculations.ts`, `cierrePozo.ts`): son lo juzgado, no el juez; los cuida la regla 8 de `ESTADO.md`.

## Cómo funciona (y por qué es seguro)

- **`pull_request_target`:** corre la versión del workflow y del script que está en `main`. Un PR que cambia la guarda
  no la cambia para sí mismo: lo nuevo rige recién después del merge. Por eso el PR que crea esta guarda no la ve correr.
- **Sin código del PR:** el checkout es de `main` (solo `scripts/ci`, sin token guardado). La lista de archivos sale de
  la API (`GET /pulls/{n}/files`); para `ESTADO.md` se lee su patch de la misma respuesta. No hay `npm ci`.
- **Sin inyecciones:** nada del PR (título, rama, cuerpo) se interpola en el YAML ni en el shell. Los nombres de
  archivo se escapan antes de escribir la anotación.
- **Permisos:** `contents: read`, `pull-requests: read`.
- Si la API falla: en modo observar avisa y no frena; en modo bloquear falla.

## El OK del dueño: etiqueta `ok-dueno-checks`

- La pone **solo el coordinador**, cuando el dueño lo pide explícitamente por el chat para ese PR. El PR lo anota
  («OK del dueño a checks protegidos, <fecha y hora CR>»).
- Poner o sacar la etiqueta vuelve a correr el check.
- **Ojo:** la etiqueta sigue puesta si después entran más commits. Quien revisa saca la etiqueta si un commit nuevo
  toca otro archivo protegido, y pide OK otra vez.
- Una vez creada la etiqueta en el repo, cualquiera con permiso de triage puede ponerla: el control es de proceso
  (la regla de arriba), no técnico. Si hace falta más, ver «Más adelante».

## Modo observar (hoy)

`MODO: observar` en el workflow. El check sale **verde** con una anotación amarilla (warning) y el resumen del job con
la lista. No bloquea nada. Sirve para ver durante unos días cuántos PR marca y si hay falsos positivos.

Esperado: el PR de la otra sesión que edita `.claude/skills` queda marcado. Es correcto.

## Cómo pasarla a bloquear

1. Crear la etiqueta `ok-dueno-checks` en el repo (una vez).
2. PR que cambia en `.github/workflows/checks-protegidos.yml` `MODO: observar` → `MODO: bloquear` (queda marcado por
   esta misma guarda: necesita OK del dueño).
3. Después del merge, el dueño marca el check **«Checks protegidos»** como requerido en la protección de `main`
   (hoy `main` no tiene regla de protección: sin eso el check falla en rojo pero no impide el merge).

Vuelta atrás: volver `MODO` a `observar` (o borrar el workflow). No toca la app, las bases ni el deploy.

## Más adelante (no incluido)

- Que la etiqueta solo valga si la puso una cuenta del dueño o del coordinador (leer el evento `labeled` y su
  `sender`); o reemplazarla por una revisión aprobada vía `CODEOWNERS` con «Require review from Code Owners».
- Sacar la etiqueta automáticamente en cada `synchronize` (pide `pull-requests: write`).

## Pruebas

`scripts/ci/checks-protegidos.test.ts` (corre en `npx vitest run`): patrones, renombres, batería nueva vs. existente,
patch de `ESTADO.md`, observar vs. bloquear con y sin etiqueta, escape de anotaciones, que cada patrón exista en el
repo y que el workflow siga con `pull_request_target`, solo lectura y sin checkout del PR.
