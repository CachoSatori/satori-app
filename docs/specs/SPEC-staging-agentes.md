# SPEC — Staging para los agentes de la nube (20-nov-2026)

> **Propuesta, nada construido ni aplicado.** Lleva firma del dueño y verificador de seguridad. A prueba hasta el 3-dic.

## 0. Problema y qué se verificó
- Las baterías de staging dependen de la sesión del dueño (regla 14): el conector pide confirmaciones que un subagente
  no ve, y el proxy de la nube bloquea `*.supabase.co` y `pages.dev`.
- Entornos de la nube (<https://code.claude.com/docs/en/cloud-environments>, leído el 20-nov): las **variables de
  entorno las lee cualquiera**; el **secreto de red** lo agrega el proxy fuera de la máquina (el agente no ve el
  valor; solo HTTPS); la red **Custom** toma una lista propia; los hooks del repo **sí corren** (un solo repo).
- Supabase tiene tokens con alcance por proyecto y permiso
  (<https://supabase.com/docs/guides/platform/personal-access-tokens>).

## 1. Credencial
| Opción | A favor | En contra |
|---|---|---|
| **A · Token de Management API con alcance solo a staging (recomendada)** | Supabase lo rechaza en prod. Va por HTTPS → secreto de red. Corre SQL en `begin…rollback`. | En staging puede todo lo del permiso «Database». |
| B · Rol Postgres propio | Permisos finos por tabla. | No va por HTTPS: el proxy no lo pasa y la clave quedaría en una variable legible. |
| C · Service key de staging | No sirve en prod. | No corre SQL libre y salta la RLS que queremos probar. |

- **Permisos:** Database (lectura y escritura), API Keys y API Key Secrets (lectura; los usa `sesion.sh`). Sin Edge,
  secretos, Auth Config, ramas ni organización. Proyecto: **solo** `satori-staging`.
- **Dónde vive:** secreto de red (Bearer, host `api.supabase.com`) del entorno nuevo `satori-staging-agentes`. Nunca en
  variables, repo, chat ni PR.
- **Rotación** (cada 30 días o ante la duda): token nuevo → borrar el secreto → cargar el nuevo → revocar el viejo →
  prueba del §3. **Revocación:** borrar el token en Supabase (corta al instante) y el secreto del entorno.

## 2. Red del entorno (Custom)
```text
hwiatgicyyqyezqwldia.supabase.co
satori-staging.pages.dev
*.satori-staging.pages.dev
```
Más la casilla de la lista por defecto (npm, para el gate). `api.supabase.com` entra por el secreto de red; GitHub, por
su proxy. **Nunca:** el host de prod, `*.supabase.co`, `*.pages.dev`.

## 3. Barreras para que nunca toque prod
1. **Alcance del token y de la red:** el token no tiene permiso sobre prod y el host de datos de prod no está en la
   lista. **No es separación física:** los conectores MCP (el de Supabase del dueño llega a prod) y el navegador remoto
   no salen por la lista Custom. Por eso en este entorno los conectores de Supabase y Cloudflare van **apagados** (§7).
2. **Ref fijo en cada script** (`hwiatgicyyqyezqwldia` escrito, no por parámetro; aborta si no coincide, como
   `scripts/staging-usuarios-prueba/lib.sh`). Las escrituras exigen además la marca de staging (`club_entorno`).
3. **Hook PreToolUse** (lo arma `claude/settings-hooks`; este es el contrato). Se activa con una variable propia del
   entorno, `SATORI_ENTORNO=staging-agentes` (no con `CLAUDE_CODE_REMOTE`). **Niega**, sin preguntar: (a) todo Bash que
   nombre el ref de prod junto a `curl`, `supabase` o `psql`; (b) todo host `*.supabase.co` que no sea el de staging;
   (c) toda herramienta `mcp__Supabase__*` cuyo `project_id` no sea el de staging, lectura incluida; (d) `gh pr merge`,
   el merge por API y el push a `main`. **Solo frena errores, no a un agente decidido** (compara texto).
4. **Prueba que muerde** (`scripts/staging-agentes/prueba-barreras.sh`, a construir; al arrancar, tras cada rotación y
   tras cada re-clonado). Es la única excepción explícita del hook. Verifica: `GET /v1/projects/<prod>/…` con el token
   → 401/403 (si da 200: parar y revocar) · un pedido sin llave al host de prod lo rechaza el proxy · un comando de
   mentira con el ref de prod lo niega el hook, y con el hook apagado en una copia esa prueba cae · **0 usuarios
   reales activos** en staging (`inventario.sql`).

## 4. Qué hacen los agentes y qué sigue con el dueño
| Agentes, sin el dueño | Sigue con el dueño |
|---|---|
| Baterías SQL en `begin … rollback`, con mutación | Todo lo de prod y `main` |
| Recrear usuarios de prueba (`crear.sh`) y abrir sesión (`sesion.sh`) | Migración **persistente** en staging: OK por chat, la corre el agente |
| Recorridos con `satori-verificar` | Edge y secretos de staging (el token no tiene ese permiso) |
| Leer ledger y catálogo de staging | Re-clonar, crear y rotar el token, validación física |

- **Después de cada re-clonado**, en este orden: `crear.sh` → `neutralizar-copias.sql` → `inventario.sql` → prueba del §3.

- El envoltorio de baterías (a construir) pone el `rollback` y rechaza un `commit` en el archivo.
- **Regla 14:** se propone «la corre el entorno `satori-staging-agentes`; si falla, la sesión del dueño». No esquivar
  las confirmaciones del conector queda igual.

## 5. Usuarios de prueba y datos ficticios
- Ya existen (17-nov): uno por rol, `prueba-<rol>@staging-satori.test`, sin contraseña, sesión de 1 h en un archivo
  fuera del repo. No se crean otros.
- Datos sembrados: nombres «Prueba …», teléfonos 80000000–80000099, montos inventados, dominios `.test`.
- Reportes: solo conteos y OK/no. **Las capturas nunca se suben al repo**.

## 6. Riesgos y vuelta atrás
| Riesgo | Qué lo frena |
|---|---|
| Se filtra el token | No entra a la máquina; solo abre staging; se revoca en un minuto. |
| La **service key de staging sí entra a la máquina** (`sesion.sh` la baja a un temporal) | Solo sirve en staging. Se **rota** al cerrar la prueba y ante cualquier duda. |
| Staging es copia de datos reales | **Requisito previo (D4):** el entorno no se habilita hasta anonimizar el clonado. |
| DDL persistente o creación de roles en staging (el permiso «Database» lo permite) | Envoltorio con `rollback`; lo persistente, solo con OK. Si pasa: re-clonar. |
| **Abierto:** `main` no exige revisión; una sesión podría mergear | El hook niega merge y push a `main` en este entorno; el cierre real es exigir revisión en GitHub (decisión aparte). |
| Drift con prod (staging en 194, sin la 189, faltan 065/066) | Cada batería imprime el ledger; verde en staging no es verde en prod; el humo de prod sigue en el PASE. |

**Vuelta atrás (2 minutos, sin tocar bases):** revocar el token, borrar el secreto, rotar la service key de staging,
archivar el entorno. Vuelve la regla 14 de hoy.

## 7. Pasos del dueño, de a uno (recién con D4 cumplida)
1. Supabase → cuenta → Access Tokens → token nuevo `staging-agentes`: proyecto **solo** `satori-staging`, permisos del
   §1, vencimiento a 30 días si lo ofrece. Copiarlo (se ve una sola vez).
2. claude.ai/code → selector de entorno → **Nuevo entorno** → `satori-staging-agentes`.
3. Red: **Custom**, pegar las 3 líneas del §2 y tildar la lista por defecto.
4. Variables de entorno: `SATORI_ENTORNO=staging-agentes` (no es secreto).
5. **Apagar los conectores de Supabase y Cloudflare** en ese entorno y en sus sesiones.
6. **Secretos de red → Agregar:** tipo Bearer, sitio `api.supabase.com`, pegar el token. Guardar. No pegarlo en
   ningún otro lado.
7. Avisar por el chat «entorno listo»: un agente corre la prueba del §3 y reporta.

## 8. Métrica (hasta el 3-dic, anotada en el handoff de cada día)
| Qué se cuenta | Meta |
|---|---|
| Baterías y recorridos corridos sin el dueño / total | ≥ 80 % |
| Bloqueos falsos (hook o proxy frenan algo legítimo de staging) | ≤ 1 por semana, con comando y hora |
| Pedidos que llegaron a prod con esta credencial | **0** (uno solo: se revoca y se corta la prueba) |

## 9. Decisiones del dueño
| # | Decisión | Opciones | Recomendación | ¿Firma? |
|---|---|---|---|---|
| D1 | Credencial | A token con alcance · B rol Postgres · C service key | A | Sí |
| D2 | Permisos | Con «API Key Secrets» (pantallas) · sin (solo SQL) | Con | Sí |
| D3 | Regla 14 | Cambiarla (§4) · dejarla | Cambiarla, a prueba | Sí |
| D4 | Anonimizar el clonado (PR aparte) | **Requisito previo**, no opción: sin esto el entorno no se habilita | Hacerlo primero | Sí |
