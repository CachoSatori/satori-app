---
name: satori-merge-y-deploy
description: Usala cuando el dueño da el OK para mergear un PR a main de satori-app — ventana horaria, chequeos antes del merge, verificación del deploy (app, Pages del Club, Worker, Branching, /api/salud) y actualización de ESTADO.
---

# Merge y deploy — Satori App

Mergear a `main` **es** desplegar: Pages publica la app, Branching corre `migrate` contra PROD (regla 1) y despliega las Edge Functions declaradas en `supabase/config.toml` (regla 2), Cloudflare construye `satori-club` y `satori-club-api`.

## 1. Ventana y OK
- [ ] Hora real: `TZ=America/Costa_Rica date`. Ventana D1 y excepción de PRs solo `.md`: **regla 3 de ESTADO**. Una sola sesión mergea, solo sus PRs.
- [ ] Salvo PR solo `.md` con Gate verde (regla 3), hace falta **OK explícito del dueño** para **este** PR y **este** SHA, citado en el cuerpo del merge (con roles). Sin OK no se mergea aunque la revisión diga «listo».
- [ ] Antes de mergear un `.md`: `gh pr diff <n> --name-only` confirma que todo es `.md`.

## 2. Antes del merge
- [ ] `gh pr view <n> --json headRefOid,mergeable,isDraft`: cabeza = SHA firmado; si cambió, la firma no vale.
- [ ] Gate de `satori-estandar-pr` §3 sobre main + PR (`git merge --no-ff origin/main` sin conflictos); sagrados por hash = ESTADO. Si toca `supabase/functions/` o `supabase/config.toml` (regla 2): `config.toml` válido (R04 verde: lista blanca, cada función con su `verify_jwt`, `ingest-ndf` y `club-pase` en false) y **firma del dueño**, porque el merge despliega esas Edge en prod; anotar antes, por función, versión, `verify_jwt` y `ezbr_sha256` (solo lectura).
- [ ] Plata, esquema o prod: PASE firmado en `docs/pases/`. Migraciones: vía clara (`satori-migraciones-y-prod` §4).
- [ ] Etiquetas `ok-dueno-*` (`ok-dueno-edge` levanta R04; `ok-dueno-checks`, la de checks protegidos): solo con el OK del dueño en el chat y **no quedan atadas al SHA**; confirmá que el OK cubre la cabeza actual o sacá la etiqueta.
- [ ] Lo que haga falta en un panel (variable, binding, secreto) está hecho antes. La vuelta atrás está escrita.

## 3. El merge
- [ ] Sacar el borrador: `gh api -X POST repos/CachoSatori/satori-app/pulls/<n>/ccr/ready_for_review`.
- [ ] `gh api -X PUT repos/CachoSatori/satori-app/pulls/<n>/merge -f merge_method=merge -f sha=<cabeza>`. Anotar SHA del merge y hora `-06:00`.

## 4. Verificar por contenido, no por HTTP 200 (regla 9)
- [ ] **App:** run «Deploy to GitHub Pages» del merge en success; `curl -s https://cachosatori.github.io/satori-app/version.json` → `commit` = SHA del merge (con `curl`, no navegador). Si el proxy da 403, vale el run en success y se anota «version.json no verificable».
- [ ] **Branching:** el Preview por PR está desactivado: no se espera el check «Supabase Preview» del PR. Después del merge, el despliegue de `main` en Supabase sin error y el ledger con 1 fila por versión nueva (solo lectura).
- [ ] **Edge (si el merge tocó `supabase/functions/` o `config.toml`), solo lectura:** `list_edge_functions` de las 8 funciones: versión (+1 las que cambiaron), `verify_jwt` = `config.toml` y `ezbr_sha256` antes → después, anotados en el PASE; `get_edge_function` = los archivos del merge. **Latido del PoS:** `pos_ndf_cursor.last_poll_at` avanza y `last_error` en null en los 2–3 ciclos siguientes (`ingest-ndf`). Si algo no coincide: vuelta atrás de esa función (PASE) y avisar.
- [ ] **Club** (si toca `club-web/` o la API): Pages `satori-club` y Worker `satori-club-api` (root `club-web/worker`) en Ready, con `env.RL_CREAR` y `env.RL_LEER` en el log. `curl -si https://club.satoricostarica.com/api/salud`: `x-club-api: worker` y `rl_crear`, `rl_leer`, `club_web_key`, `turnstile`, `supabase` en `true`; si no, se para (PASE-150-151 §11.3).
- [ ] Deploy manual del Worker (solo si el PASE lo pide): el aviso «differs from the remote configuration…» se contesta SÍ solo si las diferencias son exactamente `vars` `SUPABASE_URL` y `SUPABASE_ANON_KEY` y los topes `RL_CREAR` (2001, 5/60 s) y `RL_LEER` (2002, 60/60 s); otra diferencia: NO, parar y copiar el aviso.
- [ ] **Funcional:** el recorrido mínimo del PR. Lo que pide estar en el local lo valida el dueño: pendiente, no hecho.

## 5. Cerrar
PR de docs que **reemplaza** ⚡ARRANQUE de `ESTADO.md` (`main` = SHA y hora, qué entró, ledger, Edge, pendientes); si cambió el backlog, `PROMPT-CONTINUACION.md` y el handoff. Bitácora del PASE si hubo pase.

## 6. Nunca
- Force-push a `main`, `staging` o ramas de código desplegado. Mergear PRs de otra sesión o varios juntos sin pedido del dueño.
- Revertir con `git reset` + push: la vuelta atrás es un PR de revert (el `.sql` del ledger se queda, regla 10).
- Mergear código de Edge sin firma: con `config.toml` en `main`, el merge lo despliega en prod. Ni desplegar una Edge a mano «de paso».
