# Integración Supabase↔GitHub (Branching) — cómo se aplican las migraciones a PROD

> **Resumen ejecutivo para futuras sesiones.** Descubierto 2026-08-07 (noche) al pasar la mig 052 a prod:
> prod ya la tenía aplicada sin que nadie corriera un apply manual. Caracterizado 100% read-only
> (`gh api` de checks + Management API GET `/branches` + `git log`). **Decisión: ADOPTADA.**
> Contexto: [ESTADO.md §(c)](../ESTADO.md) · [HALLAZGOS.md](../HALLAZGOS.md) · topología de deploy del repo.

## TL;DR

**`main` es la rama de producción de la base de prod.** Pushear/mergear una **migración** (`.sql` nuevo en
`supabase/migrations/`) a `main` la **auto-aplica a la base de PROD** (`yiczgdti`) y la registra en
`schema_migrations`. Lo hace la **Supabase GitHub App** (feature *Branching*), no un workflow del repo.

## Qué la dispara

- **La Supabase GitHub App** (`app_slug: supabase`), que postea el check-run **"Supabase Preview"** en cada
  commit. **NO** es un workflow del repo: el único es `.github/workflows/deploy.yml`, y ese es **solo frontend**
  (`npm run build` con la anon key → GitHub Pages; no toca la base). **NO** hay `supabase/config.toml`.
- **Evento:** un push a la rama de producción (`main`). Si el commit trae un `.sql` nuevo en
  `supabase/migrations/`, la app corre `db push` contra prod y lo aplica + registra. En commits sin migración
  nueva, es no-op (verde).

## Alcance — SOLO prod

- La integración está atada al **proyecto PROD `yiczgdtirrkdvohdquzf`** con git **`main` = rama de producción**
  (Management API `/branches` → 1 rama: `name:"main"`, `is_default:true`, `git_branch:"main"`, parent = sí mismo).
- **Staging NO.** En commits de la rama git `staging` el check sale **`skipped`**. El proyecto **STAGING
  (`hwiatgicyyqyezqwldia`) NO está atado a esta integración** → sus migraciones siguen siendo **manuales**
  (CLI `supabase db query --linked` / Management API firmada), como en `scripts/ledger-reconciliacion/`.

## Condición — aplica si el ledger de prod está consistente

- **Verde (`success`) → aplicó** (o no había nada pendiente). **Rojo (`failure`) → el `db push` a prod falló**
  (típicamente por **drift del ledger** de prod) y **NO aplicó nada**.
- Evidencia (gh api `/commits/<sha>/check-runs`, app `supabase`):
  - **pre-B2** (≤ 2026-07-23: `c77ced0`, `1c8a9ad`, `3df4feb`…) → **`failure`** (era el "Supabase Preview rojo
    crónico"; NO era un bug ajeno, era el ledger con drift).
  - **post-B2** (desde 2026-07-27, prod reconciliado a 33+ filas alineadas: `1748205`, `5e85abc`, `6bb9c33`…) →
    **`success`**.
- Por eso los pases viejos figuran "out-of-band": aplicaban la mig a prod **a mano ANTES de pushear**, así la
  integración no encontraba nada pendiente (verde no-op). El pase de la 052 pusheó el `.sql` primero → la
  integración lo aplicó (`6bb9c33`: prod 35→36, `movement_edits` creada, fila 052 con 9 statements).

## Cómo se hace un pase de migración a PROD **ahora** (modelo adoptado)

1. **Pre-requisito:** el ledger de prod está **consistente** (sin drift). Si hay drift, primero reconciliar
   (si no, el auto-apply sale rojo y no entra).
2. Llevar el archivo `.sql` a `main` (cherry-pick sobre rama desde `main`, **nunca** merge `staging→main`;
   por las untracked que bloquean el checkout, usar **worktree git aislado**). `git push origin main`.
3. **Eso ES el apply.** Verificar:
   - check **"Supabase Preview" = success** en el commit (`gh api .../commits/<sha>/check-runs`);
   - estado real de la base read-only (canal firmado: `read_only:true` + smoke `25006`): la tabla/objeto existe,
     `schema_migrations` subió +1 con la fila nueva;
   - deploy de frontend a Pages verde por `version.json.commit` + grafo de chunks (aparte, es otro eje).
4. **⚠️ NO correr apply/repair manual después** — ya está aplicada y registrada; un `migration repair` **duplicaría**
   la fila del ledger.

### Guardrails de la decisión adoptada

1. Una migración llega a `main` **solo cuando ya está lista para producción** (main = base de prod en vivo).
2. **Staging sigue manual** (CLI/Management API); no está atado a la integración.

## Interruptor de control (por si algún día se desactiva)

- **No hay nada en el repo** (ni `config.toml`, ni workflow). Se controla **en el Dashboard de Supabase**:
  - **Dashboard → proyecto `yiczgdtirrkdvohdquzf` → Branches** (es el `details_url` del check), y/o
  - **Project Settings → Integrations → GitHub** (conexión del repo + rama de producción + toggles de deploy).
- **Desactivar** = apagar Branching / desconectar la integración GitHub del proyecto prod → se vuelve al
  out-of-band manual (pero entonces hay que **reconciliar el ledger de prod y aplicar cada mig a mano**).
- Verificación read-only del estado: `GET https://api.supabase.com/v1/projects/yiczgdtirrkdvohdquzf/branches`.

## TODO / a confirmar

- **Edge functions:** la rama de prod reporta `status: FUNCTIONS_DEPLOYED` y Branching suele desplegar functions
  en el push. **Falta confirmar** si un cambio en `supabase/functions/` que llegue a `main` se **auto-despliega a
  prod** (los pases viejos las deployaban a mano con `functions deploy --project-ref`). Si se confirma, es otra
  superficie de auto-deploy a prod a tener presente.
- **`seed.sql`:** normalmente solo corre al crear una rama, no en cada push a la rama de producción persistente
  (riesgo bajo) — confirmar si alguna vez interesa.
