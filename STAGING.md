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
  owner (`<correo-del-negocio>` = owner activo), re-sincroniza secuencias y **verifica**
  (conteos por tabla + 3 spot-checks financieros idénticos).
- **Logins:** ~~credenciales de PROD~~ (desactualizado). El clonado ya sanea Auth (sin hash, correo `prod-…@staging-satori.test`,
  baneados) y se entra con los usuarios de prueba (`scripts/staging-usuarios-prueba/`). La copia de hoy es anterior a ese
  saneo: la deja al día la anonimización de abajo.
- El banner "DATOS DE PRUEBA" **sigue siendo correcto**: es una copia desechable, no el original —
  nada de lo que se haga en staging toca producción.
- **No se clona**: Storage (las fotos de la Bandeja no se ven en staging) ni la config de Auth
  (staging usa autoconfirm + site_url propio, a propósito).

## 🕶️ Anonimizar staging (spec firmada el 20-nov · script listo, **SIN CORRER**)
Spec: [docs/specs/SPEC-anonimizar-staging.md](docs/specs/SPEC-anonimizar-staging.md) (D1 montos quedan · D2 alias numerado ·
D3 Storage borrado + imagen ficticia · D4 JSON con lista blanca y `ventas_dias` vacía · D5 sueldos ficticios por tipo · D6 SOP
quedan · D7 cédula del emisor en la clave FE). Código: [`scripts/staging-anonimizar/`](scripts/staging-anonimizar/).
**Escribe en staging para siempre:** lo corre el coordinador con el **OK del dueño por chat**. Nunca prod: ref fijo en
`correr.py` y `lib.sh`, y la guarda SQL exige además `club_entorno = 'staging'` y los usuarios de prueba (en prod no existen).

| Archivo | Qué hace |
|---|---|
| `clasificacion.sql` | Clase de **cada** columna de texto/JSON de `public` (470 al 20-nov). Una columna nueva sin clase **aborta** la corrida. |
| `comun.sql` | Guarda, reglas puras (clave FE, descripción, formas de lo ficticio), política JSON y controles del §2. |
| `anonimizar.sql` | Alias, correos, teléfonos, notas, llaves, seudónimos, claves FE, JSON, sueldos, Auth, `net`. Una transacción; **aborta** si cambia una suma de caja, propinas o ventas, una huella, los permisos o las claves FE. |
| `verificar.sql` | Solo conteos: exige 0 correos/teléfonos/nombres reales, banco, llaves viejas, columnas sin clase, Storage de más. |
| `storage.sh` | Borra todo Storage salvo `documents/sops/` y sube `anon/ficticia.png` (por la API; desde SQL no se puede). |
| `correr.py` | Arma los fragmentos y los manda (Management API, ref de staging). `--local` para el Postgres local, `--armar` para ver el SQL. |
| `cadena.sh` | La cadena entera de un re-clonado, en orden, parando en el primer error. |

**Orden (ahora, y después de cada re-clonado).** Leer el ref en pantalla antes (regla 7). Cada paso para en el primer error:
```bash
export SUPABASE_ACCESS_TOKEN=…                                   # o el proxy de la sesión
bash scripts/staging-usuarios-prueba/crear.sh                     # 1 usuarios de prueba (idempotente)
# 2 neutralizar-copias.sql (scripts/staging-usuarios-prueba/), como dice su encabezado
python3 scripts/staging-anonimizar/correr.py ensayo               # 3 batería entera en BEGIN … ROLLBACK (no deja nada)
python3 scripts/staging-anonimizar/correr.py ensayo --idempotencia  # 4 dos pasadas, ROLLBACK
python3 scripts/staging-anonimizar/correr.py real --si            # 5 COMMIT (con el OK del dueño)
bash scripts/staging-anonimizar/storage.sh                        # 6a ensayo: solo cuenta
bash scripts/staging-anonimizar/storage.sh --si                   # 6b borra y sube la imagen ficticia
python3 scripts/staging-anonimizar/correr.py verificar            # 7 todo lo exigido en 0
# 8 inventario.sql (scripts/staging-usuarios-prueba/) · 9 prueba de barreras (SPEC-staging-agentes)
```
O todo junto: `bash scripts/staging-anonimizar/cadena.sh --si` (1–8). Si el ensayo da «ANON-FALLAN», «ANON-ABORTA» o
«ANON-VERIFICAR-FALLA», **no** se corre el paso real: se trae al coordinador con el mensaje (solo conteos, sin datos).

- **Qué queda igual:** montos, tipo de cambio, fechas, productos y precios, logins del PoS, roles, locales, configuración,
  `bitacora_permisos`, SOP. Las descripciones de caja que arma el sistema (ventas del cierre, retiro, apertura del pozo,
  propinas por turno, ajuste de cierre sin su motivo) quedan, porque el cierre las busca por texto; el resto es «Nota de
  prueba» con su «· fact AAAA-MM-DD».
- **Probarlo sin staging:** `PGHOST=/tmp PGPORT=5499 PGUSER=pgv bash scripts/sql/local_armar_base.sh anon_local` y
  `PGDATABASE=anon_local python3 scripts/staging-anonimizar/correr.py ensayo --local [--idempotencia]` (31 casos con una
  semilla inventada) · `python3 scripts/sql/anonimizar_staging_mutaciones.py` (13 arreglos deshechos: todos tienen que caer).
- **Tiempo:** la Management API corta a los 30 s. Con un volumen como el de staging (41 mil tiquetes, 234 mil líneas, 24 mil
  marcas) en local: real ≈ 5 s, ensayo ≈ 8 s, ensayo con idempotencia ≈ 10 s. Si en staging se pasa, la transacción se
  descarta sola: no queda nada a medias.
- **Vuelta atrás:** si falla, no queda nada (una transacción). Si el resultado no sirve: re-clonar desde prod (solo lectura)
  y correr la cadena de nuevo. El borrado de Storage no se deshace ni hace falta (prod no se toca).
- **Lo que este script no limpia:** los respaldos automáticos de Supabase de staging anteriores a la corrida y la carpeta
  local `.staging-backups/` del clonado (perfiles y correos de antes de sanear): borrarla a mano en la máquina que clonó.

---

## 👤 Manager de prueba (16-nov-2026)
Prod no tiene por qué tener un manager activo, y staging (copia de prod) tampoco: las baterías que buscan uno
(«owner y manager activos») caían en el caso 00. Para eso staging tiene un usuario **100 % ficticio**:

| Dato | Valor |
|---|---|
| Nombre | Manager Prueba |
| Correo (login) | `manager.prueba@example.com` (dominio reservado para ejemplos) |
| UUID | `00000000-0000-4000-8000-0000000e0001` |
| Rol / estado | `manager`, activo |
| Local | `santa-teresa` (principal). No tiene Nosara: sirve también para probar «Sin permiso en ese local». |

- **Recrearlo** (después de re-clonar staging, o si alguien lo tocó): correr
  [`scripts/sql/staging_manager_prueba.sql`](scripts/sql/staging_manager_prueba.sql) en **staging** (ref
  `hwiatgicyyqyezqwldia`; leer el ref antes, regla 7). Es idempotente, aborta si la base no está marcada como staging
  (`club_entorno`) y no cambia la contraseña de un usuario que ya existe. Los cambios de rol, activo y local quedan en la
  bitácora de permisos (165) con origen `sistema`.
- **Contraseña:** el repo **no tiene** un lugar para credenciales de staging, así que el script le pone una contraseña
  aleatoria que **nadie conoce** (se genera y se hashea dentro de la base; no sale en ninguna salida). Para entrar con
  este usuario a la app de staging, primero hay que **resetearla**: el dueño, en el panel de Supabase de staging →
  Authentication → Users → `manager.prueba@example.com` → poner una contraseña nueva, y guardarla **fuera del repo**
  (nunca en el repo, el chat ni un PR).
- **Para baterías y permisos no hace falta la contraseña:** se prueba con su JWT simulado dentro de una transacción
  descartada (regla 4), p. ej.
  `select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000e0001","role":"authenticated"}', true); set local role authenticated;`
- **No se crea en prod.** Las baterías que necesitan **dos** managers de locales distintos (la 171 con la 170) siguen
  necesitando el segundo dentro de su propia transacción.

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
