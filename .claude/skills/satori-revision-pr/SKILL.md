---
name: satori-revision-pr
description: Usala cuando te piden revisar un PR de satori-app que construyó otra sesión — checklist por disparador (plata, esquema, permisos, sagrados, hora CR, offline, privacidad, Edge, deploy) que mira solo lo que el diff toca, con severidad Importante / Menor / Preexistente y veredicto listo / cambios / bloquea.
---

# Revisión de PR — Satori App

Revisás algo que no construiste: verificá contra el diff, el repo y `ESTADO.md`, no contra el reporte del autor. Solo lectura (no pusheás a la rama ajena ni mergeás). Si esta skill y `ESTADO.md` no coinciden, gana `ESTADO.md`.

## 0. Preparar y gate propio
- [ ] `gh pr view <n> --json title,body,headRefOid,baseRefName,isDraft` y `gh pr diff <n> --name-only`. Clon o worktree limpio en `headRefOid`; anotá el **SHA revisado** (un push nuevo invalida revisión, hallazgos y gate).
- [ ] Leé las 🛑 Reglas de `ESTADO.md`; todo hallazgo se compara contra eso. En ronda 2 o más, partí de hallazgos y gate de ese SHA (§4).
- [ ] Corré vos `bash scripts/ci/gate.sh` (`satori-estandar-pr` §3) y pegá su línea `GATE:`. Si los números no coinciden con los del PR, es hallazgo.

## 2. Checklist por disparador
Recorré la lista de archivos del diff (`--name-only`) y el diff mismo contra la columna **Disparador**. Revisás **solo las
filas que coinciden**; las que no, no se tocan. En el informe dejá escrito **qué filas aplicaste** (por su ID) y cuáles no
coincidieron. Los incidentes `R##` están en [docs/REGLAS-POR-INCIDENTE.md](../../../docs/REGLAS-POR-INCIDENTE.md): si un diff
repite uno, el hallazgo es **Importante** y cita la fila.

| ID | Disparador (del diff) | Qué revisar | Incidente o regla de origen |
|---|---|---|---|
| C01 | **Siempre** | Privacidad (`CLAUDE.md`): ningún nombre, teléfono, correo, cédula, monto real, ref de prod en una prueba, llave ni secreto, en código, docs, comentarios, PR y commits. El gate no mira `.claude/` ni todo `docs/`: a mano. | R22 |
| C02 | **Siempre** | **Pruebas que muerden:** para el cambio central, hacé vos una mutación (revertir el arreglo en la copia limpia) y mirá que algo caiga; si nada cae, la prueba no prueba. Las pruebas no hablan con un proyecto real (env falsa de `vite.config.ts`). Una prueba que ya no puede probar algo lo dice (NO PROBADO) y no da verde. | `satori-estandar-pr` §4 |
| C03 | **Siempre** | **Deploy:** ¿qué publica el merge (app, club-web, Worker, Branching)? ¿Algo necesita un panel antes (variable, binding, secreto)? ¿Rompe el service worker o versiones viejas abiertas? ¿Vuelta atrás escrita y posible (revert + rollback SQL, sin borrar el `.sql` del ledger)? ¿⚡ARRANQUE al día si cambia el estado real? | ESTADO reglas 9 y 10; R19 |
| C04 | `src/modules/cash/**`, `src/shared/api/cash*`, `**/tip*`, `pozo.ts`, `cierrePozo.ts`, `posFiscal.ts`, cualquier escritura a `cash_*` o propinas | **Plata y caja:** ¿cambia un monto, un saldo, el «debería» de un cierre, propinas, el pozo o la Caja Fuerte? Cada camino nuevo de escritura: ¿quién lo dispara, en qué estado, qué pasa si se repite? Redondeos, colones/dólares, tipo de cambio. ICP según la regla 5 (el 10 % de servicio no entra). | ESTADO regla 5; R08 |
| C05 | `cashUtils.ts`, `tipCalculations.ts`, `posFiscal.ts`, `cierrePozo.ts` o cualquier archivo de la lógica de cierres | **Sagrados (regla 8):** `git hash-object` de cada uno = tabla de ESTADO; `pozo.ts` y `cierrePozo.ts` sin reimplementar. | ESTADO regla 8 |
| C06 | `supabase/migrations/**`, `scripts/sql/*_rollback.sql`, `supabase/migraciones-reservadas.json` | **Migración:** número en su bloque y registrado (`supabase/migraciones-reservadas.json` + tabla de ESTADO), con rollback y pruebas. ¿Toca prod sin firma? Es Importante y bloquea. ¿Dice por qué vía entra a prod (merge → Branching, o a mano antes del merge, regla 1) y tiene su PASE en `docs/pases/`? Número ≤ al último del ledger de prod → tiene que ir al bloque de pase 150–199, en orden con las demás. | ESTADO reglas 1 y 3; R16 |
| C07 | `supabase/migrations/**` que cambia, borra o revierte un `.sql` ya existente | ¿Algún `.sql` ya aplicado en prod cambia, se borra o se revierte? Bloquea (regla 10). | ESTADO regla 10; R14 |
| C08 | `supabase/migrations/**` o `scripts/sql/**` con `create or replace function` | Parte de la definición vigente en prod (md5 de `pg_get_functiondef`) y lleva guarda de md5 de lo que reemplaza. Medir contra prod con consulta propia. | R13; R17 |
| C09 | `**/*.sql` o migraciones con `create policy`, `alter policy`, `security definer`, `grant`, `revoke`, RLS | **Esquema, RLS y permisos:** policies nuevas o cambiadas: ¿qué ve y escribe cada rol, `anon` incluido? ¿`SECURITY DEFINER` con `search_path` fijo, rol chequeado adentro y `revoke` a `public`/`anon`? Lectura del PoS por las funciones de la 067; `pos_ndf_*` solo gerencia (regla 6). Las pruebas de permisos usan un usuario real del rol o su JWT en `begin read only` … `rollback` (regla 4): «Ver como» no prueba permisos. | ESTADO reglas 4 y 6 |
| C10 | `scripts/sql/*_pruebas.sql`, baterías, `scripts/sql/baterias_assert.test.ts` | La batería corrió **antes** de aplicar y no se traga errores (`exception when others`); resumen «pasaron X / fallaron Y». | R15 |
| C11 | `**/*.sql` con `cron.` | Sin `for update` ni bloqueos sobre `cron.job`; `cron.schedule` / `cron.unschedule`; humo con tarea temporal; verificar una corrida real. | R01; R02 |
| C12 | `supabase/functions/**`, `supabase/config.toml` | **Edge (regla 2):** archivos bajo `supabase/functions/` en un PR a `main` → Importante hasta cerrar el ítem 11 (`main` tiene código viejo de `monthly-report`, `extract-document` y otros: Branching pisaría prod). El archivo central (`index.ts`) está en el commit. Si es un PR a la rama de Edge: `verify_jwt` según la tabla de ESTADO; hash y versión de lo desplegado. | ESTADO regla 2; R03; R04 |
| C13 | `new Date`, `Date.UTC`, `toISOString`, `getDate()`, `getHours()`, `setMonth`, rangos `-01…-31`, nombres de archivo con fecha | **Hora de Costa Rica:** «hoy» y días operativos con `todayCR()` / `dateCR()`. Buscá en el diff `toISOString().slice(0, 10)`, `new Date().getDate()`, `getHours()` sin zona y últimos días de mes fijos. Las pruebas de fecha corren de noche en CR (23:30 CR) y no dependen del día de la semana. | R05; R10 |
| C14 | `src/shared/offline/**`, `OFFLINE.md`, escrituras de caja, pagos o propinas por la cola | **Offline y outbox:** cada operación lleva `client_op_id` y el servidor la trata idempotente; el replay en orden no duplica plata ni se traba con un error; lo no clasificable es retry, no fatal; nada se borra en silencio. | R08 |
| C15 | `club-web/**` (incluidos `functions/` y `worker/`), `src/shared/wallet/**`, textos de UI de cara al cliente | **Club y textos:** textos para clientes en «usted» (`club-web/src/usted.test.ts` y `src/shared/wallet/usted.test.ts`); build de club-web con `VITE_CLUB_URL` de prueba; `club-pase` con `verify_jwt = false`; qué ve el cliente. | R21; `satori-estandar-pr` §5 |
| C16 | `src/**/*.tsx` con `.map(` que dibuja filas o secciones | Claves de React y estado de expandido únicos (tupla completa, `JSON.stringify`, sin `slugify`). | R07 |
| C17 | `src/**` con `order by`, `limit`, «ejemplo» o primera fila (SQL o TS) | Desempate total y fijo; probado con un empate. | R06 |
| C18 | `signedUrl`, `createSignedUrl`, `storage.` dentro de componentes de fila | Firma al verse, con memoria y máximo 4 en vuelo. | R09 |
| C19 | `src/modules/**/*.tsx`, `src/shared/ui/**`, textos de pantalla, botones, roles o reglas de un módulo | **Guía SOP:** la guía de `docs/sop-app/` cambió en el mismo PR con `verificado_en_commit`, o el PR explica por qué no. Si cambia lo que ve el personal, el PR dice en concreto qué va a ver el encargado. | `CLAUDE.md`; `satori-estandar-pr` §6 |
| C20 | Reportes, correos, pantallas de ventas (`src/modules/ventas/**`, `monthly-report`) | Leen del PoS por las funciones de la 067, nunca de `ventas_dias`; guarda `src/ventasSoloPos.test.ts`. | R18 |
| C21 | `pos-bridge/**`, `*.md` o scripts con hosts, PCs, rutas o IPs | Ningún host ni nombre de PC real; el agente vive en su rama (no se mergea a `main`). | R12 |
| C22 | `*.test.ts` / `*.test.tsx` que recorren el repo, usan timers, `sleep` o carga | Sin reintentos ni `sleep`; tope explícito; causa buscada o reportada. | R11 |
| C23 | `.github/**`, `vite.config.ts`, `public/**`, `wrangler.toml`, service worker, `package.json` | Qué cambia en el deploy y en el CI (el gate de CI y `npm test` en `deploy.yml` existen: no los da por únicos), `navigateFallbackDenylist`, variables o bindings que hay que cargar antes. Build local: `tsc -b`, no `tsc --noEmit`; `VITE_APP_ENV=production` para un build de prod. | R19; R20 |
| C24 | `ESTADO.md`, `PROMPT-CONTINUACION.md`, `docs/historico/**` | ⚡ARRANQUE al día; ≤ 15 KB cada uno (lo podado va tal cual al histórico); tabla de numeración coincide con `migraciones-reservadas.json` (`migraciones.test.ts`). | `satori-estandar-pr` §10 |

## 3. Salida
Primero una línea: **«Filas aplicadas: C01, C02, C03, …. No coincidieron: …»** y el SHA revisado.
Luego los hallazgos ordenados de más grave a menos, cada uno con evidencia:

| # | Severidad | Archivo:línea | Qué pasa | Escenario concreto | Qué pedir |
|---|---|---|---|---|---|

**Severidad:**
- **Importante:** tiene que arreglarse antes del merge. Si toca plata, permisos, datos, prod o una regla de ESTADO, además **bloquea**.
- **Menor:** puede ir después, con ítem en el backlog (`PROMPT-CONTINUACION.md`).
- **Preexistente:** ya estaba en `main` antes del PR; no bloquea. Se anota y, si corresponde, va al backlog. Antes de
  etiquetar así, comprobalo contra `origin/main`.

Veredicto, en una línea, sobre el SHA revisado:
- **Listo**: sin Importantes (el merge sigue las reglas de `satori-merge-y-deploy`).
- **Cambios**: lista corta de los Importantes que faltan.
- **Bloquea**: qué regla rompe y qué haría falta.

Lo que no pudiste verificar (sin acceso a la base, al panel, etc.) va aparte como «NO VERIFICADO», nunca como OK.

## 4. Rondas
- Recibís o dejás hallazgos y gate para ESE SHA; no los rehacés: revisás lo cambiado desde el SHA anterior y que cada hallazgo previo quedó cerrado. **Excepción: plata, esquema y seguridad**: recalculás con tu propio SQL de solo lectura.
- Tras 3 rondas con un check fallando, parás y lo traés al coordinador con la causa. Test inestable: ni reintento ni `sleep` (R11).
- Tu informe termina con el trailer propuesto: `Verificado: gate | gate+staging | gate+verificador | ninguno (motivo)`.
