# Plan — usuarios de prueba propios en staging (17-nov-2026)

> Estado: **propuesta, nada ejecutado.** Ningún usuario se creó, cambió ni borró en ninguna base.
> El dueño da el OK antes de cada fase de escritura. Repo público: solo conteos y roles.

## 1. Problema

- Los usuarios de Supabase Auth de **staging** (`hwiatgic…`) incluyen **copias exactas de prod** (`yiczgdti…`):
  mismo `id`, mismo correo y **mismo hash de contraseña**. Si staging se filtra, se filtran credenciales de prod.
- Origen: `scripts/clone_prod_to_staging.py`, paso 3, copia `auth.users` e `auth.identities` de prod **con
  `encrypted_password`** (el comentario lo dice: «el login de staging usa las credenciales de PROD»).
  Si alguien lo vuelve a correr, el problema vuelve.
- Los agentes no tienen usuarios propios por rol para probar pantallas y permisos (ESTADO regla 4: «Ver como» no
  prueba permisos; hace falta un usuario real del rol).

## 2. Inventario (17-nov, solo lectura)

Comparación con prod por md5 del `id`, del correo en minúsculas y del hash: prod solo devolvió conteos.

| Rol (staging) | Usuarios | Activos | Mismo id/correo/hash que prod | Último login en staging |
|---|---|---|---|---|
| owner | 4 | 4 | 2 | 13-nov |
| manager | 2 | 1 | 0 | 09-nov |
| contador | 1 | 1 | 1 | 11-nov |
| cajero | 1 | 0 | 0 | 05-nov |
| salonero | 3 | 1 | 0 | 05-nov |
| **Total** | **11** (prod: 12) | **7** | **3** | 13-nov |

- Las 3 copias de prod coinciden en id, correo **y** hash: la misma contraseña de prod abre staging.
- Esas 3 tienen **823 filas** que las referencian en staging (cajas, movimientos, órdenes…, FKs sin cascade):
  **no se pueden borrar** sin romper datos. Se neutralizan (ban + clave al azar), no se borran.
- Las otras 8 son solo de staging (59 filas dependientes en 4 de ellas). 3 usan un dominio de correo real: su hash
  no coincide con prod, pero una persona pudo haber repetido su contraseña (bcrypt con sal distinta no lo deja ver).
  Por eso el plan neutraliza **todo** usuario que no sea de prueba, no solo las 3 copias exactas.
- 2 usuarios sintéticos viejos (salonero, dominio `.invalid`, baneados) quedaron de pruebas anteriores.
- Ningún usuario con rol barman, barback, runner, cocina ni proveedor en staging.
- Repetible con `scripts/staging-usuarios-prueba/inventario.sql`.

## 3. Qué necesita un usuario para entrar a cada módulo (repo + base de staging)

- `auth.users` → el trigger `handle_new_user` (068) crea `profiles` como **salonero inactivo**.
- `profiles.role` y `profiles.is_active = true`. La guarda `profiles_guarda_roles` (SEC-01) exige owner activo
  **salvo** sin JWT (Management API) o `service_role`. Todo cambio de rol o activación lo anota la **bitácora 165**
  (`trg_profiles_bitacora_permisos`, origen `sistema` o `service_role`). Si la bitácora está caída, el `update` falla
  (regla 12, fail closed): **parar**, no desactivar el trigger para esto.
- `app_metadata.cambiar_password` **no** debe estar en `true` (si no, la app pide cambiar la clave antes de entrar).
- Locales: `mis_locales()` → owner y contador ven todos; el resto, sus filas de `profile_locations` o, si no tiene,
  `santa-teresa`. Para probar Nosara con un rol de piso hace falta una fila en `profile_locations`.
- Empleado: «Mi rendimiento» busca `employees.profile_id`; sin vínculo muestra el aviso de cuenta sin empleado.
- Rutas por rol (`src/App.tsx`): Resumen, Semana, Reporte mensual, Ventas, Inventario, Finanzas → owner/manager/contador;
  Caja y Propinas → + cajero; Bandeja → owner/manager/contador/cajero; Clientes → owner/manager/cajero;
  Club → owner/manager/cajero/contador; Mi rendimiento → roles de piso + manager + owner; Admin y Prueba → solo owner.
- `alta-empleado` (Edge, rama `claude/alta-empleado-fn`) **no crea owners** y necesita el JWT de un owner activo:
  sirve para la operación real, no para sembrar staging. Se usa la API de admin de staging directo.

## 4. Propuesta

### (a) Un usuario de prueba por rol — `scripts/staging-usuarios-prueba/crear.sh`

- 10 usuarios: `owner, manager, contador, cajero, salonero, barman, barback, runner, cocina, proveedor`.
- Correo `prueba-<rol>@staging-satori.test` (dominio `.test`: reservado, no existe, no se manda nada; es el que
  acepta `src/privacidadRepo.test.ts` — `.invalid` no está en su lista). Nombre «Prueba <Rol>».
- Creados por la **API de admin de staging** (`POST /auth/v1/admin/users`, `email_confirm: true`), **sin contraseña**,
  con `app_metadata.usuario_prueba = true`. Rol y activación por SQL sin JWT (queda en la bitácora).
- Cajero y roles de piso: un empleado «Prueba <Rol>» vinculado, con `participa_servicio = false` para que **no entre
  al reparto de propinas** de staging.
- Idempotente; nunca toca un usuario fuera del dominio de prueba. Ref de staging fijo en el script.

### (b) Dónde vive la contraseña

| Opción | Cómo | A favor | En contra |
|---|---|---|---|
| **A · Sin contraseña (recomendada)** | Los usuarios no tienen clave. `sesion.sh <rol> <archivo>` genera un magic link por la API de admin (no manda correo), lo canjea y deja la sesión (1 h) en un archivo 0600 **fuera del repo**. Mismo patrón que `scripts/sql/club_api/pos_login_manager.sh`. | No hay secreto que guardar, rotar ni filtrar. Solo puede usarlo quien ya tiene acceso a staging. Sirve para API y pantallas (sesión en `localStorage`). | La pantalla de login con usuario y clave no se prueba con estos usuarios (se prueba aparte con un usuario sintético de un solo uso). |
| B · Supabase Vault de staging | Clave al azar en `vault.secrets`; el agente la lee por SQL sin imprimirla. | Login real por la pantalla. | Un secreto más; queda en el mismo lugar que protege. |
| C · Secret de GitHub Actions | `STG_PRUEBA_PASSWORD` del repo. | Útil si algún día hay e2e en CI. | Los agentes de CC no pueden leerlo; solo un workflow. |
| D · Gestor del dueño | El dueño la guarda y la pasa. | — | Trabajo manual del dueño y pasa por el chat: descartada. |

**Por qué `encrypted_password` no queda vacío (verificado 17-nov):** aunque el alta no lleve `password`, GoTrue guarda
igual un hash bcrypt de 60 caracteres de una clave al azar que nadie conoce ni ve. Por eso el control `sin_password` de
`crear.sh` **no** mira que la columna esté vacía; significa «nadie conoce la contraseña»: (1) el payload del alta no
trae `password` (el script lo verifica con `jq` antes de crear y frena si aparece) y (2) el usuario no tiene
identidades fuera de `email`. El script además informa `hash_bcrypt_al_azar` (largo 60) como dato, no como falla.

Nunca en el repo ni en el chat. Recomendación: **A**; si después hace falta probar el login por pantalla, sumar B
para **un** usuario.

### (c) Neutralizar las copias de prod — `scripts/staging-usuarios-prueba/neutralizar-copias.sql`

- A **todo** usuario que no sea `@staging-satori.test`: contraseña nueva al azar generada y hasheada dentro de la base
  (nadie la conoce, no sale en logs), `banned_until` a 100 años, `recovery_token` vacío, y se cierran sus sesiones
  y refresh tokens. **Sin borrar filas** y sin tocar `profiles` (no dispara la bitácora).
- Guardas: aborta si no están los usuarios de prueba (en prod no existen) o si no hay un owner de prueba activo.
- Va **después** de `crear.sh`, para no dejar staging sin owner.

### (c2) Que no vuelva a pasar — cambio a `scripts/clone_prod_to_staging.py` (otro PR, con firma)

- Paso 3: copiar `auth.users` **sin** `encrypted_password` (columna vacía o hash al azar) y con `banned_until` a
  100 años; no reemplazar usuarios de staging por los de prod.
- Paso 5 hoy recrea como **salonero inactivo** el perfil de todo usuario de staging tras el `TRUNCATE … CASCADE`:
  los usuarios de prueba perderían su rol. Agregar al final una llamada a `crear.sh` (idempotente).
- Prueba: correr el clonado en staging y volver a comparar hashes con prod → 0 coincidencias.

### (d) Vuelta atrás — `scripts/staging-usuarios-prueba/vuelta-atras.sql`

- Ban: reversible (`banned_until = null`). La contraseña vieja **no** se recupera (a propósito); la cuenta vuelve con
  clave nueva por la API de admin o «recovery» del panel de staging.
- Usuarios de prueba: se borran (empleado, después usuario por la API; cascade al perfil). Si ya dejaron filas en
  tablas sin cascade, se banean en vez de borrarse.
- Nada de esto toca prod.

### (e) Qué tiene que hacer el dueño

- **Solo dar el OK por el chat**, en dos pasos: (1) crear los usuarios de prueba; (2) neutralizar las copias.
- No hace falta que toque nada. Efecto para él: **su usuario de staging deja de entrar** (si lo usa, se le vuelve a
  dar acceso con clave nueva — opción en la vuelta atrás). En prod no cambia nada.
- Recomendado aparte (no lo exige este plan): como la contraseña de prod de 3 cuentas estuvo en una base con menos
  controles, que esas 3 personas **cambien su contraseña en prod** desde la app. Lo decide el dueño.

## 5. Orden propuesto

1. OK del dueño → `crear.sh` en staging → `inventario.sql` (10 de prueba, roles bien) → `sesion.sh owner` y una
   lectura por API como prueba.
2. OK del dueño → `neutralizar-copias.sql` → `inventario.sql` → comparación de hashes con prod = 0 coincidencias.
3. PR aparte para `clone_prod_to_staging.py` (c2).
4. Skill «verificar» / `satori-estandar-pr` §4: usar `sesion.sh` para pruebas de permisos y pantallas.

## 6. Bitácora

- **17-nov ~13:20 (CR):** creados los 10 usuarios de prueba en staging con `crear.sh`. Roles OK; sesión de owner y de
  salonero por `sesion.sh` OK. El control `sin_password` dio false en los 10 porque esperaba `encrypted_password`
  vacío (ver §4(b)); corregido en este PR.
- **17-nov ~13:30 (CR):** neutralizadas las 11 cuentas que no son de prueba (contraseña al azar, ban a 100 años,
  0 sesiones).
- **17-nov:** redirecciones de Auth de staging ampliadas a `https://*.satori-staging.pages.dev/**` para poder validar
  vistas previas de PR.
