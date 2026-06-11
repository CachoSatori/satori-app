# Satori App — Entorno de STAGING

Staging = una copia de la app con **base de datos separada** de producción, para probar lo
riesgoso (cirugía de auth, tiempo real, offline) sin tocar plata real.

## 🔒 Regla innegociable
- **Producción** = proyecto Supabase ref **`yiczgdtirrkdvohdquzf`** → NUNCA se toca desde staging.
- Todo lo de staging es contra un proyecto Supabase **distinto** (`satori-staging`).
- Antes de aplicar migraciones se **imprime y verifica el project-ref** y que **≠ producción**.

## Cómo está armado
- **Aislamiento por env vars** (`src/shared/api/supabase.ts` ya toma URL/anon-key SOLO de
  `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`, sin fallback hardcodeado). Apuntás staging a
  la base de staging con sus propias env vars → cero riesgo de pegarle a prod.
- **Banner STAGING**: si `VITE_APP_ENV=staging`, se muestra una franja roja fija y no-cerrable
  "⚠ STAGING — DATOS DE PRUEBA · NO ES PRODUCCIÓN" en todas las pantallas. En prod no aparece.
- **Build de staging**: `npm run build:staging` (= `tsc -b && VITE_APP_ENV=staging vite build`).
  No toca el `npm run build` de producción.

## 📦 Datos: staging es un ESPEJO de los datos reales de prod (2026-06-11)
- Staging contiene una **COPIA completa de los datos de producción** (ventas, caja, propinas,
  proveedores, etc.), clonada con `scripts/clone-prod-to-staging.sh`. **Sigue siendo descartable**:
  cualquier cosa que rompas se re-clona con un solo comando:
  ```bash
  SUPABASE_ACCESS_TOKEN=sbp_xxx ./scripts/clone-prod-to-staging.sh --yes
  ```
- El script tiene los guardrails ADENTRO: prod (`yiczgdtirrkdvohdquzf`) es **solo lectura**
  (aborta ante cualquier sentencia no-SELECT) y la escritura va **únicamente** a
  `hwiatgicyyqyezqwldia` (aborta si el destino no es ese ref). Hace backup corto previo en
  `.staging-backups/`, trunca public, copia todo + `auth.users`/`auth.identities`, restaura el
  owner (`satorisushibar@gmail.com` = owner activo), re-sincroniza secuencias y **verifica**
  (conteos por tabla + 3 spot-checks financieros idénticos).
- **Logins en staging = credenciales de PROD** (los usuarios se clonan con su hash de contraseña).
- El banner "DATOS DE PRUEBA" **sigue siendo correcto**: es una copia desechable, no el original —
  nada de lo que se haga en staging toca producción.
- **No se clona**: Storage (las fotos de la Bandeja no se ven en staging) ni la config de Auth
  (staging usa autoconfirm + site_url propio, a propósito).

---

## PASO 0 — Lo que hace el dueño (2 clics, una vez)
1. En Supabase → **New project** → nombre `satori-staging` (free tier). Anotar:
   - **project-ref** de staging (NO el de prod).
   - **db password** que pongas al crearlo.
2. Crear un **Personal Access Token** (Account → Access Tokens) para la CLI: `SUPABASE_ACCESS_TOKEN`.
Pasale esos 3 datos a Claude para el PASO 1.

## PASO 1 — Migraciones a staging (lo corre Claude, o vos con estos comandos)
Con la CLI de Supabase y el token en el entorno (no-interactivo):
```bash
export SUPABASE_ACCESS_TOKEN=<token>
export SUPABASE_DB_PASSWORD=<db_password_staging>
supabase link --project-ref <REF_STAGING>     # verificar: REF_STAGING ≠ yiczgdtirrkdvohdquzf
supabase db push                               # aplica supabase/migrations/* (incluida la 018)
```
Verificar el esquema (que staging tenga las tablas/columnas clave): `cash_sessions`
(con `midday_check_by`/`midday_check_at`), `cash_movements`, `cash_cierres_dia`, `tip_sessions`,
`tip_entries`, `documents`, etc.

> **Drift baseline (`migrations/0095_drift_baseline.sql`):** crea SOLO las tablas que en prod
> existen fuera de migraciones (estructura). **No** trae RLS/policies a propósito — así, si
> alguna vez corre contra prod por error, los `create table if not exists` no tocan nada y
> **no puede debilitar la seguridad de prod**.
>
> **RLS permisiva de staging (`staging-rls.sql`, en la raíz, NO en migrations/):** después de
> aplicar las migraciones a staging, corré **SOLO contra STAGING** el contenido de `staging-rls.sql`
> (SQL Editor de staging o vía la Management API con el ref de staging) para habilitar el acceso
> `authenticated` a esas tablas y poder probar. **NUNCA correrlo en producción.** Reconciliar a la
> RLS-por-rol exacta de prod = deuda técnica (requiere pg_dump).

## PASO 3 — Conectar el host de staging (lo hace el dueño — consola externa)
**Recomendado: Cloudflare Pages o Netlify** (GitHub Pages no sirve para 2 sitios desde un repo).
1. Crear un sitio nuevo conectado a este repo, **rama `staging`**.
2. Build command: `npm run build:staging` · Output dir: `dist`.
3. Env vars del sitio (¡las de STAGING!):
   - `VITE_SUPABASE_URL` = URL del proyecto **staging**
   - `VITE_SUPABASE_ANON_KEY` = anon key del proyecto **staging**
   - `VITE_APP_ENV` = `staging`
4. (Vite usa `base: '/satori-app'` para GitHub Pages; en Cloudflare/Netlify quizá quieras servir
   en la raíz — si el sitio queda en blanco, ajustar `base` en `vite.config` para staging o servir
   bajo `/satori-app`. Verificar el free tier vigente del host.)

> Producción sigue como está: GitHub Pages vía `deploy.yml` en push a `main`. **No se tocó.**
> No se creó un workflow de deploy de staging porque GitHub Pages aloja un solo sitio por repo;
> el staging va por Cloudflare/Netlify (arriba).

## Flujo de trabajo con staging
- Lo riesgoso (Fase 2 de auth: `noLock` real + verificación de manager por Edge Function,
  tiempo real, offline) se desarrolla en ramas, se prueba en **staging** (rama `staging`),
  y recién cuando funciona se lleva a `main` (producción).
