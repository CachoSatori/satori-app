---
name: satori-merge-y-deploy
description: Usala cuando el dueño da el OK para mergear un PR a main de satori-app — ventana horaria, chequeos antes del merge, verificación del deploy (app, Pages del Club, Worker, Branching, /api/salud) y actualización de ESTADO.
---

# Merge y deploy — Satori App

Mergear a `main` **es** desplegar: GitHub Pages publica la app, Branching corre `migrate` contra PROD (regla 1),
Cloudflare construye `satori-club` y el Worker `satori-club-api` desde `main`.

## 1. Ventana horaria (hora de Costa Rica, UTC-6)
- [ ] **Nunca entre las 17:00 y las 23:00 CR.** Es la regla más estricta vigente (decisión del dueño en
      `docs/handoffs/HANDOFF-2026-11-11.md` §4 y prerrequisito 0.3 de cada PASE). La regla 3 de `ESTADO.md` dice 19–22 h
      (el servicio); manda la más estricta. Una excepción solo vale si el dueño la escribe en su firma.
- [ ] Lejos de los cierres de caja: el del turno mañana (~16:00) y el de la noche (~23:00). No mergear mientras se
      está cerrando, ni con la caja abierta en servicio. Después de las 23:00, esperar a que el cierre de la noche termine.
- [ ] Una sola sesión mergea a `main` a la vez, cada una solo sus PRs (regla 3). Nadie más pushea a `main` en la ventana.
- [ ] Hora real: `TZ=America/Costa_Rica date` (no la del contenedor).

## 2. Antes del merge
- [ ] **OK explícito del dueño** para **este** PR y **este** SHA de cabeza. El dueño firma por el chat: se cita en el
      cuerpo del merge (con roles, no nombres). Sin OK, no se mergea, aunque la revisión diga «listo».
- [ ] Si el PR toca plata, esquema o prod: su PASE firmado en `docs/pases/` y los prerrequisitos del §0 en verde.
- [ ] Cabeza = SHA firmado: `gh pr view <n> --json headRefOid,mergeable,isDraft`. Si cambió, la firma no vale.
- [ ] **Gate sobre main + PR** en copia limpia: `git merge --no-ff origin/main` en la cabeza (sin conflictos) y el gate
      de `satori-estandar-pr` §3 entero (`npm ci`, `tsc -b`, `vite build`, `vitest run`, lint ≤ `main`; club-web si
      aplica).
- [ ] Sagrados por hash igual a la tabla de ESTADO. Ningún archivo bajo `supabase/functions/` (regla 2).
- [ ] Migraciones: está claro por qué vía entran (ver `satori-migraciones-y-prod` §4). Si es «a mano antes del merge»,
      ya están aplicadas y verificadas en prod.
- [ ] Si el merge necesita algo en un panel (variable, binding, secreto, Worker existente), está hecho **antes**.
- [ ] La vuelta atrás está escrita (revert del merge + rollback SQL si aplica).

## 3. El merge
- [ ] Sacar el borrador: `gh pr ready <n>` (usa GraphQL; si no está disponible, avisar: la API REST no saca un PR de
      borrador y un borrador no se puede mergear).
- [ ] Mergear con **merge commit** atado al SHA firmado:
      `gh api -X PUT repos/CachoSatori/satori-app/pulls/<n>/merge -f merge_method=merge -f sha=<cabeza firmada>`.
- [ ] Anotar el SHA del merge y la hora `-06:00`.

## 4. Después del merge: verificar por contenido, no por HTTP 200 (regla 9)
**App (GitHub Pages)**
- [ ] El run «Deploy to GitHub Pages» del merge en success (`gh run list --workflow deploy.yml -L 3`).
- [ ] `curl -s https://cachosatori.github.io/satori-app/version.json` → `commit` = el SHA del merge. Con `curl`, no el
      navegador: el service worker devuelve `index.html` y lleva al login.

**Supabase Branching**
- [ ] Check «Supabase Preview» del merge en success; en el log, «All migrations are up to date» (o las migraciones
      esperadas, si entran por esa vía). Ledger y catálogo según el PASE.

**Club (si el PR toca `club-web/` o la API)**
- [ ] Pages `satori-club`: el deploy de producción de `main` en Ready.
- [ ] Worker `satori-club-api`: el build automático de `main` (Workers Builds, root `club-web/worker`) en Ready, con
      `env.RL_CREAR (ratelimit)` y `env.RL_LEER (ratelimit)` en el log y el Version ID nuevo.
- [ ] Deploy manual del Worker (solo si el PASE lo pide): el aviso de wrangler («differs from the remote
      configuration…») se contesta **SÍ solo si** las diferencias son exactamente `vars` `SUPABASE_URL` y
      `SUPABASE_ANON_KEY`, y los topes `RL_CREAR` (2001, 5 por 60 s) y `RL_LEER` (2002, 60 por 60 s). Cualquier otra
      diferencia: **NO**, parar y copiar el aviso tal cual (PASE-150-151 §11.4 paso 4c).
- [ ] `curl -si https://club.satoricostarica.com/api/salud`: encabezado `x-club-api: worker` y `rl_crear`, `rl_leer`,
      `club_web_key`, `turnstile` y `supabase` en `true`. Con `x-club-api: pages` o algo en `false`: se para (tabla del
      §11.3 del PASE-150-151).

**Funcional**
- [ ] El recorrido mínimo que dice el PR (pantalla tocada, rol afectado). Lo que pide estar en el local lo valida el
      dueño; anotalo como pendiente, no como hecho.

## 5. Cerrar
- [ ] PR de docs (`claude/docs-estado-<fecha>`) que reemplaza el bloque ⚡ARRANQUE de `ESTADO.md`: `main` = SHA y hora,
      qué entró, ledger, Edge, Cloudflare, pendientes. El bloque se **reemplaza**, no se acumula. Si cambió el backlog,
      también `PROMPT-CONTINUACION.md` y el handoff.
- [ ] Bitácora del PASE (§9/§10) si hubo pase.

## 6. Nunca
- Force-push a `main`, a `staging` ni a ramas que son fuente de código desplegado (Edge de la regla 2, agente del PoS).
- Mergear el PR de otra sesión, o varios PRs juntos sin que el dueño lo pida.
- Revertir con `git reset` + push: la vuelta atrás es un PR de revert (y el `.sql` de lo que está en el ledger se
  queda, regla 10).
- Desplegar una Edge Function «de paso» con el merge.
