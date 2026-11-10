# Rediseño de la app · protocolo de trabajo automático

> Rama de control: `claude/rediseno-control`. **Nunca se mergea.** Acá viven el plan, las colas y los reportes.
> Plan completo y motivos: `docs/rediseno/PLAN.md`.

## Quién hace qué

| Sesión | Cuándo (hora CR) | Qué hace |
|---|---|---|
| **Línea A** (módulos) | 01:10 · 06:20 · 16:20 | Toma la primera tarea `lista` de `COLA-A.md`, la hace en su rama, abre el PR y deja su reporte. |
| **Línea B** (shell y estética) | 02:10 · 06:50 · 16:50 | Lo mismo con `COLA-B.md`. |
| **Revisión** | 05:40 · 15:40 | Revisa los PR y reportes nuevos, mergea a `staging` lo que pasa, marca la tarea siguiente y avisa a Ismael **solo** si hay una decisión o un riesgo real. |
| **Ismael** | Cuando lo avisa la revisión | Firma lo que toca un archivo de cierre, valida lo visual en staging y autoriza cada pase a `main`. |

## Reglas para las líneas (A y B)

1. **Una tarea por corrida.** Si no hay ninguna `lista`, o hay un PR propio con `cambios pedidos`, se arregla eso primero. Si no hay nada que hacer, se termina sin tocar nada.
2. **Rama** `claude/rediseno-<id de tarea>` desde `origin/staging`. **PR a `staging`** con título `[rediseño A] …` o `[rediseño B] …`. **Nunca** mergear: ni a staging ni a main.
3. **Solo los archivos de tu línea** (ver la tabla de abajo). Si una tarea necesita uno de la otra línea, se frena y se anota en el reporte.
4. **Prohibido:**
   - sagrados (`cashUtils.ts`, `tipCalculations.ts`, `computeTotals`, `posFiscal`, `cierrePozo` y la lógica de cierres);
   - `supabase/`, migraciones, RLS y roles;
   - cambiar consultas o escrituras a la base;
   - outbox y service worker;
   - cambiar permisos (`MODULES[].roles`, rutas, `PrivateRoute`).

   Es todo trabajo de pantalla.
5. **Gates antes del PR:**
   - `bash -c 'set -o pipefail; VITE_APP_ENV=production npm run build'`;
   - `npm test`;
   - `grep -rE "armBootHang|__satoriDiag|boot-hang|realtimeReproSwitch" dist/`, que tiene que dar vacío;
   - `git diff origin/staging --stat -- src/modules/cash/cashUtils.ts src/modules/tips/tipCalculations.ts`, que también tiene que dar vacío.
6. **Guía del módulo:** se actualiza en `docs/sop-app/` en el mismo PR (regla de `CLAUDE.md`).
7. **Repo público:** nada de nombres, teléfonos, correos ni montos reales.
8. **GitHub:** usar la API REST con `gh api` (GraphQL no está disponible).
   - Crear un PR: `gh api repos/CachoSatori/satori-app/pulls -f title=… -f head=… -f base=staging -f body=…`.
9. **Reporte** al terminar: crear `docs/rediseno/reportes/<AAAA-MM-DD-HHMM>-<A|B>-<id>.md`. Lleva:
   - qué se hizo y el link al PR;
   - los gates con su resultado;
   - **qué va a ver el encargado**, en concreto;
   - las dudas.

   Además, en tu `COLA-?.md`, pasar la tarea a `en revisión` con el número de PR. Commit solo de esos dos archivos en `claude/rediseno-control`: `git pull --rebase` y push; si choca, reintentar una vez.

## Archivos por línea

| Línea A | Línea B |
|---|---|
| `src/modules/resumen/**` · `src/modules/ventas/**` · `src/modules/cash/CashCierre.tsx` (solo JSX, con firma) · `src/modules/prueba/**` · `src/modules/admin/**` · guías 6.2, 6.4 y 6.6 | `src/index.css` · `src/App.tsx` · `src/pages/HomePage.tsx` · `src/shared/layout/**` (nuevo) · `public/marca/**` · guías 6.1 e `INVENTARIO.md` |

## Reglas para la revisión

1. **Leer:**
   - `PROTOCOLO.md`, `PLAN.md` y las dos colas;
   - los reportes nuevos desde el último reporte de revisión;
   - los PR abiertos `[rediseño …]`, con `gh api repos/CachoSatori/satori-app/pulls?state=open`.
2. **Por cada PR, verificar contra el repo, no contra el reporte:**
   - el diff toca solo archivos de su línea;
   - nada prohibido;
   - ningún cambio en `.insert/.update/.delete/.upsert/.rpc(`;
   - los gates, corridos de nuevo por la revisión;
   - la guía actualizada;
   - nada de datos personales.
3. **Decisión:**
   - **Pasa y no lleva firma:** mergear a `staging` con merge commit (`gh api -X PUT repos/CachoSatori/satori-app/pulls/<n>/merge -f merge_method=merge`), salvo entre las 19:00 y las 22:00 CR. Marcarla `hecha` en la cola.
   - **No pasa:** comentar en el PR qué falta, marcarla `cambios pedidos` y no mergear.
   - **Lleva firma** (`CashCierre.tsx` o cualquier tarea marcada **FIRMA**): no mergear. Marcarla `espera firma` y avisar a Ismael.
   - **Cambio visual grande** (B2, B3, B4): mergear a staging y avisar a Ismael que hay **validación visual pendiente**, con la lista de pantallas para mirar.
4. **Siguiente paso:** pasar a `lista` la próxima tarea de cada cola cuyas dependencias estén `hechas`. Si una tarea tiene que cambiar por lo que se aprendió, se reescribe en la cola.
5. **Nunca mergear a `main`.** Cuando un bloque está validado por Ismael en staging, la revisión prepara una rama `claude/rediseno-prod-<bloque>` desde `origin/main` con cherry-pick, abre el PR a `main` **sin mergear** y le avisa.
6. **Reporte** en `docs/rediseno/reportes/<AAAA-MM-DD-HHMM>-revision.md`, con:
   - el estado de cada tarea;
   - lo mergeado;
   - lo pedido;
   - el riesgo.
7. **Mensaje final para Ismael** (le llega como notificación). La primera línea es una de estas dos:
   - `SIN NOVEDADES PARA VOS: …`, seguida de dos líneas con lo que avanzó;
   - `NECESITO TU DECISIÓN: …`, seguida de qué decidir, con opciones y una recomendación.

   Máximo 8 líneas en total.

## Estados de las colas

`pendiente` (espera dependencias) → `lista` → `en revisión #PR` → `hecha` | `cambios pedidos #PR` | `espera firma #PR`.
