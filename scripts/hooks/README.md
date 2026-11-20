# Hooks de las sesiones de agentes (`.claude/settings.json`)

`.claude/settings.json` viaja con el repo: toda sesión de Claude Code abierta en satori-app carga estas reglas y
estos hooks. Frenan lo irreversible aunque el agente se equivoque. Son **checks protegidos**
(`scripts/ci/checks-protegidos.mjs`): cambiarlos pide OK del dueño.

Solo **exit 2** bloquea; cualquier otro código, o un timeout, deja seguir. Por eso la guardia lleva
`"onFailure": "block"` (Claude Code 2.1.329: un fallo, timeout o salida rara cuenta como exit 2; se ignora en Stop y
TaskCompleted) y, por si la versión no lo conoce, `|| exit 2` en el comando: falla cerrada. Cada consulta a GitHub
tiene 15 s (hasta 3 por merge = 45 s) y el hook 90 s.

## Qué hay

| Evento | Script | Bloquea (exit 2) |
|---|---|---|
| `PreToolUse` · `Bash` | `guardia.mjs` | leer una ruta `.env*` (`.env.example` sí) · escribir una marca o `.claude/settings(.local).json` · `git push` a `main` (`main`, `HEAD:main`, `refs/heads/main`, `--mirror`/`--all`, push sin refspec estando en `main`) · `--force`/`-f`/`+refspec` (solo `--force-with-lease`) · `supabase db push` / `functions deploy` / `db reset --linked` · merge de PR fuera de D1, con `--auto`, sin `--match-head-commit` o sin SHA firmado · SQL destructivo fuera de `begin … rollback` (salvo migración firmada) · escritura en prod sin turno · `DELETE` por PostgREST |
| `PreToolUse` · `mcp__*supabase*__*` | `guardia.mjs` | igual para `execute_sql` y `apply_migration`; contra prod, toda herramienta que escribe (migración, deploy de Edge, secretos, ramas) pide el turno |
| `PostToolUse` · `Edit\|Write\|MultiEdit` | `lint-archivo.mjs` | eslint del archivo `.ts`/`.tsx` tocado con **más errores que en la base** de la rama (merge-base con `origin/main`). La deuda vieja no bloquea; sumar un error sí. Archivo nuevo: cero errores |
| `TaskCompleted` | `tests-tarea.mjs` | `vitest related` sobre lo cambiado en la rama; si cae una prueba, la tarea no se marca completa (solo las líneas de falla) |
| `Stop` | `gate-stop.mjs` | si hay cambios sin commitear, archivos nuevos o commits por delante de origin: `bash scripts/ci/gate.sh` (si **solo** cambiaron `.md`, camino rápido: las guardas que leen documentos, `GUARDAS_DOCS`); si falla, la sesión sigue. Tope de **3 rondas** seguidas con `stop_hook_active` (después deja terminar y avisa: no hay bucle). Un gate verde se recuerda para ese mismo árbol |

Además, `permissions.deny` niega por regla: `Read` de `.env*`, `cat/head/tail/less/grep/source` sobre `.env*`, push a
`main` y con `--force`/`-f` (también `git -c … push`), `supabase db push` y `supabase functions deploy` (también con
`npx`), `supabase db reset --linked` / `--db-url`. Las reglas de `Bash` son de mejor esfuerzo (un `bash -c` las esquiva); la guardia es la que vale.
`permissions.ask` pide permiso para editar las marcas, `.claude/settings.json`, `.claude/settings.local.json` (ignorado
por `.gitignore`) y `scripts/hooks/**`.

**`.env`:** solo cuentan los argumentos que son rutas de archivo; el patrón de `grep`/`rg`/`sed`/`awk` no
(`grep -rn ".env" src` pasa).

## Regla D1 (hora de Costa Rica, UTC-6 sin horario de verano)

- **23:30–15:50:** libre.
- **15:50–19:00:** bloqueado siempre (cierre de caja de la mañana y preparación del servicio).
- **19:00–23:30:** solo con el OK del dueño en el momento (marca «OK de la noche»).

Aplica a `gh pr merge` y `gh api … /pulls/N/merge` (no GET). El merge tiene que fijar la cabeza:
`gh pr merge N --match-head-commit <sha firmado>` (o `-f sha=<sha>` en la API). Se bloquean siempre `gh pr merge --auto`,
el merge por GraphQL y el merge por `curl` a la API.

## Marcas que habilitan (no versionadas)

Archivos `.claude/*.local` (los ignora `.gitignore` por `*.local`) **o** variables de entorno fijadas al abrir la
sesión. Las pone la sesión del dueño con su OK; un agente no puede escribirlas por Bash (lo frena la guardia) y por
Edit/Write pide permiso.

| Marca | Archivo | Variable | Formato | Vence |
|---|---|---|---|---|
| SHA firmado | `.claude/sha-firmado.local` | `SATORI_SHA_FIRMADO` | una línea por PR: `#305 <sha>` (7 a 40 hex). Un `<sha>` sin número vale para cualquier PR | al cambiar la cabeza del PR |
| OK de la noche | `.claude/ok-dueno-noche.local` | `SATORI_OK_DUENO_NOCHE` | `AAAA-MM-DD #305 «cita textual del OK del dueño»` (fecha CR de hoy, número del PR, cita de 8+ caracteres entre «…» o "…"); vale solo para ese PR | al cambiar el día CR |
| Migración firmada | `.claude/migracion-firmada.local` | `SATORI_MIGRACION_FIRMADA` | una línea por archivo: `<sha256 del .sql> [nombre]` (lo que da `sha256sum supabase/migrations/NNN_x.sql`) | al cambiar el archivo (otro sha) |
| Turno de prod | `.claude/turno-prod.local` | `SATORI_TURNO_PROD` | una línea con `TURNO DE PROD` y la fecha CR de hoy, p. ej. `TURNO DE PROD: esta sesión de CC · AAAA-MM-DD` (regla 13) | al cambiar el día CR |

- **SHA firmado:** la cabeza del PR (leída por REST: `gh api repos/…/pulls/N`) tiene que empezar con el SHA firmado.
  Un PR **solo de `.md`** queda exento del SHA, **no** de D1. Si no se puede leer el PR, no se mergea.
- **Migración firmada:** habilita `drop`/`delete` (p. ej. `drop policy if exists`) de ESE texto exacto (se tolera
  solo el salto de línea final) al aplicarlo a mano con firma (regla 1). No da turno de prod: contra prod hace falta además.
- **Turno de prod:** leer prod (SELECT, `list_*`, `get_*`) no lo pide; escribir sí (SQL de escritura o DDL,
  `apply_migration`, deploy de Edge, secretos, ramas). SQL que no se puede leer cuenta como escritura. El turno **no**
  habilita `drop`/`delete`/`truncate` fuera de `begin … rollback`.

## SQL

- `drop`, `delete` y `truncate` solo dentro de `begin … rollback` (incluye el cuerpo de un `do $$ … $$`, que corre ya).
  `commit`, o una transacción sin `rollback`, bloquea. No cuentan: strings, comentarios, cuerpos de funciones,
  `on delete cascade`, `for delete` de una policy, `grant … delete`.
- Se mira en `mcp__*supabase*__execute_sql` / `apply_migration`, en `curl` a
  `api.supabase.com/v1/projects/<ref>/database/query` (`-d`, `--data*`, `@archivo`, heredoc) y en `psql` a un host de
  Supabase, a una URL `postgres://`, a una variable (`psql "$DB_URL"`) o a un host no local (`-c`, `-f`, heredoc).
  `psql` a localhost o socket local (baterías) no se mira.
- `execute '…'` dentro de un `do $$ … $$` con `drop`/`delete`/`truncate` cuenta como destructivo.
- Sin ref literal (regla 7) solo se puede leer: `$REF` o `psql "$DB_URL"` con SQL que escribe bloquea.

## `SATORI_ENTORNO=staging-agentes`

Para sesiones de agentes que solo trabajan contra staging. Con esa variable en el entorno de la sesión:
- se niega **toda** herramienta `mcp__*supabase*__*` cuyo `project_id` no sea el de staging (lectura incluida, y también
  las que no llevan `project_id`), y el SQL por Bash a otro ref;
- se niega todo merge de PR (el push a `main` ya está frenado siempre).

## Auto mode: `autoMode.environment` NO va en este archivo

Claude Code ignora `autoMode` en `.claude/settings.json` y en `.claude/settings.local.json` (son controlables por el
repo): solo lo lee de la configuración del usuario (`~/.claude/settings.json`), de `--settings` o de la gestionada, y
avisa «settings autoMode in projectSettings ignored». Para bajar los bloqueos falsos del clasificador, el dueño pega
esto en su `~/.claude/settings.json` (o lo pasa con `--settings`):

```json
{
  "autoMode": {
    "environment": [
      "$defaults",
      "Repositorio de trabajo: github.com/CachoSatori/satori-app (público). Las ramas claude/* son de los agentes; main solo cambia por PR con OK del dueño.",
      "Supabase STAGING = ref hwiatgicyyqyezqwldia: base de pruebas; se permite escribir dentro de transacciones de prueba (begin … rollback).",
      "Supabase PROD = ref yiczgdtirrkdvohdquzf: solo lectura salvo firma del dueño y turno de prod (lo controlan los hooks del repo).",
      "Dominios de confianza: github.com, api.github.com, registry.npmjs.org, *.supabase.co, supabase.com, *.pages.dev, code.claude.com."
    ]
  }
}
```

## Probar

```bash
npx vitest run scripts/hooks      # corre también dentro de bash scripts/ci/gate.sh
```

Las pruebas usan repos git descartables y herramientas simuladas (vitest y gate falsos); el reloj se fija con
`SATORI_HOOKS_AHORA` (ISO), que existe solo para las pruebas. El ref de prod no se escribe en las pruebas: se importa de
`sql.mjs` (`src/refProdEnPruebas.test.ts`).

## Límites conocidos

- Quien controla el entorno del proceso de Claude Code (o edita `.claude/settings.local.json` con permiso) puede apagar
  los hooks: protegen contra errores del agente, no contra el dueño de la máquina.
- `PostToolUse` no deshace la edición: avisa al modelo con el error para que lo arregle.
- El lector de shell no expande variables ni alias; ante un cuerpo SQL que no puede leer, bloquea si el comando
  menciona `drop`/`delete`/`truncate` (y en prod lo trata como escritura).
