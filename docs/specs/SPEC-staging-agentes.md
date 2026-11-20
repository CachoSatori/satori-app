# SPEC — Staging para los agentes de la nube (20-nov-2026)

> **Propuesta, nada construido ni aplicado.** Lleva firma del dueño y verificador de seguridad. A prueba hasta el 3-dic.

## 0. Problema y qué se verificó
- Las baterías de staging dependen de la sesión del dueño (regla 14): el conector pide confirmaciones que un subagente
  no ve, y el proxy de la nube bloquea `*.supabase.co` y `pages.dev`.
- Entornos de la nube (<https://code.claude.com/docs/en/cloud-environments>, leído el 20-nov): las **variables de
  entorno las lee cualquiera** que use el entorno; el **secreto de red** lo agrega el proxy fuera de la máquina (el
  agente no ve el valor; solo HTTPS; no se edita, se borra y se recarga); la red **Custom** toma una lista propia de
  dominios; los hooks de `.claude/settings.json` del repo **sí corren** (sesión con un solo repo).
- Supabase tiene tokens con alcance por proyecto y permiso
  (<https://supabase.com/docs/guides/platform/personal-access-tokens>).

## 1. Credencial
| Opción | A favor | En contra |
|---|---|---|
| **A · Token de Management API con alcance solo a staging (recomendada)** | Supabase lo rechaza en prod. Va por HTTPS → secreto de red. Corre SQL en `begin…rollback` y los scripts que ya existen. | En staging puede todo lo del permiso «Database». |
| B · Rol Postgres propio | Permisos finos por tabla. | Puerto de base, no HTTPS: el proxy no lo pasa y la clave quedaría en una variable legible. |
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
su proxy. **Nunca:** el host de prod, `*.supabase.co`, `*.pages.dev`. A confirmar en la prueba: si el navegador del
agente sale por esta lista.

## 3. Barreras para que nunca toque prod (de dura a blanda)
1. **Separación física:** el token no tiene permiso sobre prod y el host de datos de prod no está en la red. Es la
   única que no depende de que el agente se porte bien.
2. **Ref fijo en cada script** (`hwiatgicyyqyezqwldia` escrito, no por parámetro; aborta si no coincide, como
   `scripts/staging-usuarios-prueba/lib.sh`). Las escrituras exigen además la marca de staging (`club_entorno`).
3. **Hook PreToolUse** (lo arma `claude/settings-hooks`; este es el contrato): con `CLAUDE_CODE_REMOTE=true`, **negar**
   (a) todo Bash que nombre el ref de prod junto a `curl`, `supabase` o `psql`; (b) todo host `*.supabase.co` que no
   sea el de staging; (c) las escrituras del conector de Supabase sobre prod. Nunca «preguntar»: un subagente no ve la
   pregunta. Compara texto, así que es blanda: no reemplaza a la 1.
4. **Prueba que muerde** (`scripts/staging-agentes/prueba-barreras.sh`, a construir; al arrancar y tras cada rotación):
   el token ve **un solo** proyecto, el de staging (si ve otro: parar y revocar) · un pedido sin llave al host de prod
   lo rechaza el proxy · un comando de mentira con el ref de prod lo niega el hook · con el hook apagado en una copia,
   esa última prueba cae.

## 4. Qué hacen los agentes y qué sigue con el dueño
| Agentes, sin el dueño | Sigue con el dueño |
|---|---|
| Baterías SQL en `begin … rollback`, con mutación | Todo lo de prod y `main` |
| Recrear usuarios de prueba (`crear.sh`) y abrir sesión (`sesion.sh`) | Migración **persistente** en staging: OK por chat, la corre el agente |
| Recorridos con `satori-verificar` | Edge y secretos de staging (el token no tiene ese permiso) |
| Leer ledger y catálogo de staging | Re-clonar, crear y rotar el token, validación física |

- El envoltorio de baterías (a construir) pone el `rollback` él mismo y rechaza un `commit` en el archivo.
- **Regla 14:** se propone «la corre el entorno `satori-staging-agentes`; si falla, la sesión del dueño». No esquivar
  las confirmaciones del conector queda igual.

## 5. Usuarios de prueba y datos ficticios
- Ya existen (17-nov): uno por rol, `prueba-<rol>@staging-satori.test`, sin contraseña, sesión de 1 h en un archivo
  fuera del repo; más el manager de prueba de `STAGING.md`. No se crean otros.
- Datos sembrados: nombres «Prueba …», teléfonos 80000000–80000099, montos inventados, dominios `.test`.
- Reportes y capturas: solo conteos y OK/no. Un dato real de la copia no se sube.

## 6. Riesgos y vuelta atrás
| Riesgo | Qué lo frena |
|---|---|
| Se filtra el token | No entra a la máquina; solo abre staging; se revoca en un minuto. `sesion.sh` baja la service key de staging a un temporal que se borra al salir. |
| Staging es copia de datos reales | Las cuentas reales ya están neutralizadas, pero los agentes pueden leer ventas y proveedores reales → D4. |
| Drift (ledger 191 vs 194, sin 189, faltan 065/066) | Cada batería imprime el ledger; verde en staging no es verde en prod; el humo de prod sigue en el PASE. |
| El hook bloquea de más o de menos | Se mide (§8); la barrera 1 no depende de él. |

**Vuelta atrás (2 minutos, sin tocar bases):** revocar el token, borrar el secreto, archivar el entorno. Vuelve la
regla 14 de hoy.

## 7. Pasos del dueño, de a uno
1. Supabase → cuenta → Access Tokens → token nuevo `staging-agentes`: proyecto **solo** `satori-staging`, permisos del
   §1, vencimiento a 30 días si lo ofrece. Copiarlo (se ve una sola vez).
2. claude.ai/code → selector de entorno → **Nuevo entorno** → `satori-staging-agentes`.
3. Red: **Custom**, pegar las 3 líneas del §2 y tildar la lista por defecto.
4. **Secretos de red → Agregar:** tipo Bearer, sitio `api.supabase.com`, pegar el token. Guardar.
5. No pegar el token en ningún otro lado.
6. Avisar por el chat «entorno listo»: un agente corre la prueba del §3 y reporta.

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
| D4 | Datos reales en staging | Dejar el espejo · anonimizar al clonar (PR aparte) | Anonimizar | Sí |
| D5 | Migración persistente en staging | OK por chat cada vez · libre | OK por chat | No |
