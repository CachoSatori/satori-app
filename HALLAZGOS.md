# HALLAZGOS — backlog triado de las auditorías (al día: 2026-10-30)

> **Cómo leer este archivo:** arriba está **lo vigente** — el triage al 30/10 de todo lo anterior y los hallazgos
> nuevos de octubre. Abajo, en **📚 Histórico**, quedan completas y sin editar las entradas de junio a agosto (la
> versión de `staging`, que contiene toda la de `main`). Cada estado de arriba se verificó contra el repo o contra
> las bases el 30/10. El backlog accionable está en [PROMPT-CONTINUACION.md](PROMPT-CONTINUACION.md).

---

## 👤 Noviembre 2026 — Alta de empleados desde Admin (✅ prod, 06/11, PR #39)

- **Problema:** desde SEC-01 (04/11, `disable_signup`) no había forma de sumar empleados desde la app. El texto de ayuda y el login todavía decían «Crear cuenta», que fallaba con «Signups not allowed».
- **Ahora:** Admin → Usuarios → **«+ Nuevo empleado»**, con nombre, correo, rol y un vínculo opcional con un empleado activo sin cuenta. Llama a la Edge Function **`alta-empleado`**, que:
  - verifica el JWT (en el gateway y otra vez adentro) y que quien llama sea **owner activo**;
  - acepta solo los roles permitidos, **sin owner** (un owner nuevo se promueve desde la lista);
  - rechaza el email repetido sin distinguir mayúsculas, y el empleado inexistente, inactivo o ya vinculado;
  - crea el usuario con service_role. El perfil nace salonero inactivo por la 068;
  - asigna el rol, la activación y el vínculo **con el JWT del owner**, así la guarda de la 068 y las policies (`get_my_role`, 069) lo vuelven a verificar en la base;
  - si algo falla, borra el usuario: el cascade se lleva el perfil y el vínculo queda en null. No quedan restos;
  - devuelve una **contraseña temporal** que se muestra una vez, con «Copiar».
- **Primer ingreso:** el flag `app_metadata.cambiar_password` (solo lo escribe service_role) muestra «Elegí tu contraseña».
  - Lo baja **solo** la función, en la misma llamada que cambia la contraseña, después de verificar la temporal y exigir una nueva distinta, de 8 a 72 caracteres.
  - GoTrue revoca los refresh tokens al cambiar la contraseña (visto en staging), así que la pantalla vuelve a entrar sola con la nueva.
- **Errores:** al cliente solo llegan códigos y mensajes fijos más una ref. El detalle va al log de la función, sin contraseñas ni tokens.
- **Invitación por correo descartada por ahora:** prod no tiene SMTP propio (el de Supabase solo entrega al equipo de la organización) y `site_url` apuntaba a localhost. El `site_url` ya está corregido (06/11).
- **Deploy:** a mano, por la regla del ítem 11. El código de la función entra a `main` con `config.toml` (`alta-empleado` → `verify_jwt = true`).
- **Pruebas en staging, con usuarios reales de cada rol:**

  | Caso | Resultado |
  |---|---|
  | Owner activo crea cajero vinculado / manager | 201; el primer ingreso exige el cambio y la temporal deja de entrar |
  | Manager, cajero, owner inactivo | 403, 0 cuentas |
  | Sin token / token basura | 401 |
  | Email repetido | 409 |
  | Rol owner / rol inventado | 400 |
  | Empleado ya vinculado | 409, sin huérfano |
  | Falla simulada del vínculo | sin restos |
  | Owners activos | sin cambios |
  | CORS | origen ajeno sin permiso |

  También se montaron las pantallas reales contra la base. Staging quedó limpio.
- **En prod, pruebas sin escribir:** sin token → 401, token sin usuario → 401 `sin_sesion`, el origen de prod con permiso y otro origen sin permiso.

## 🔁 Noviembre 2026 — «Recontar» una vez en el cierre del día; el cierre de turno deja de contar (✅ prod, 06/11)

- **Cierre del día:** el «Debería quedar», el «Cuadra / Diferencia» y la verificación se siguen viendo **en vivo**.
  - **Dentro de tolerancia** (₡500 / US$1): sin pasos extra, igual que antes.
  - **Fuera de tolerancia:** al pedir el cierre aparece «El conteo no cuadra» con dos opciones:
    - **«↺ Recontar»** (una sola vez): el primer conteo se guarda en `cash_cierres_dia.primer_conteo_crc/usd` (mig 074) y las 6 separaciones quedan en blanco; ventas, retiro y notas no se tocan. Si después sigue fuera, el motivo es obligatorio y no hay un segundo reconteo.
    - **«No recontar — registrar el motivo»** (se queda, firmado por Ismael): motivo obligatorio y `primer_conteo_*` en null.
  - El resumen muestra «Primer conteo (antes del reconteo)» cuando lo hubo.
  - No cambian la tolerancia, `requiresAjuste`, `cuadra`/`cuadraUSD` ni los montos que se guardan.
- **Antes se probó un conteo ciego** (#31: esperado oculto hasta «Confirmar conteo»). Ismael lo descartó y se revirtió (#32) **sin tocar la base**: la 074 quedó con columnas nulas, compatible con el cliente de la 071.
- **Cierre de turno:** ya no pide efectivo ni muestra «debería / Cuadra». `final_cash_*` queda null y ningún cálculo lo usa; CashResumen lo muestra como «Caja Diaria al cerrar (histórico)», con «—» si falta.
  - **Por qué:** el «debería» de un solo cajón queda incompleto **por diseño del pozo** (`pozo.ts`, REPORTE-T1B §3.1). La plata pasa entre la Caja Fuerte, la Registradora y la Caja Diaria sin registrar el traspaso, y las propinas salen de la Registradora (`propinaPago.ts`), así que daba negativos imposibles (−₡119.800 el 17/08). El control real del efectivo es el **cierre del día**.
  - «Disponible» pasa a decir «Fondo menos pagos del día (no incluye reposiciones)» y ya no avisa «déficit».
- **Recorrido real en staging (05/11):** el `CashCierre` de la rama se montó en happy-dom contra la base de staging, con sesión real de un cajero de prueba. Resultados:

  | Caso | Resultado |
  |---|---|
  | Turno | se cierra con `final_cash_*` null |
  | −₡200 | directo al resumen, sin oferta; dif −200, `primer_conteo` null |
  | +₡1.500 → recuenta y cuadra | dif 0, `primer_conteo` ₡866.070 / US$3.441 |
  | −₡2.000 → recuenta y da −₡1.500 | sin motivo no cierra; ajuste −₡1.500, `primer_conteo` ₡862.570 |
  | −₡2.000 → «No recontar» | ajuste −₡2.000, `primer_conteo` null |

  Staging quedó limpio.

## 🧾 Noviembre 2026 — El cierre del día se guardaba en 4 llamadas sueltas (✅ mig 071 en prod, 05/11)

- **Antes:** Fase 2 = `updateCierreCompleto` → `recordCierreSales` → `recordCierreRetiro` → `recordCierreAjuste`, cada una por su lado.
  - Si una fallaba, el cierre quedaba «completo» a medias.
  - Los deletes previos no chequeaban su error, y el `23505` del ajuste se tragaba. Si el delete no había borrado y el monto cambió, quedaba el ajuste viejo sin aviso.
  - «Deshacer» eran 4 deletes sueltos, y la contraseña de gerencia se validaba solo en el cliente.
  - `cash_cierres_dia` no tenía UNIQUE por fecha: un doble «Confirmar» de la Fase 1 podía duplicar el día.
  - En prod (120 cierres) el único a medias fue el 19/10, y lo causó el «Borrar TODO» (#25).
- **Ahora (mig 071):**
  - `cerrar_dia_completo` y `deshacer_cierre_dia` escriben todo en **una transacción** (SECURITY INVOKER: el RLS aplica igual).
  - Los montos los sigue calculando el cliente; la RPC solo valida coherencia y escribe **las mismas filas** que antes (comparado fila por fila en staging).
  - Idempotencia con `close_op_id`, más `UNIQUE(session_date)`.
  - Contador excluido. La regla de turno abierto es la misma de la pantalla.
  - La contraseña de gerencia se verifica en el servidor (`verify_manager`).
- **Recorrido real en staging (05/11, sin rollback, funciones del cliente con sesión real):**
  - diferencia chica → cierra sin ajuste;
  - deshacer como cajero: sin credenciales «No autorizado», con las de gerencia borra todo junto;
  - diferencia grande → ajuste ₡; solo US$ → ajuste US$ (ids de ajuste = los del cliente);
  - Fase 1 dos veces → «el mediodía ya está sellado».
  - Encontró un bug que los tests no veían: `supabase.rpc` sin `bind` perdía el `this`. Corregido, y el test ahora lo atrapa.
- **Replay de los 120 cierres completos de prod contra las validaciones de la RPC:** 115 pasan. Los 5 que no, no los produce el cliente actual:
  - 29/06, 18/07 y 29/07: el tipo era un selector manual (hasta el 05/08) y no coincide con el signo («Faltante» con sobrante, «Otro»);
  - 02/08: el ajuste en US$ (US$236) se borró a mano el 04/08 («error»);
  - 19/10: el ajuste lo borró el «Borrar TODO» (#25).
  - El cliente actual deriva el tipo del signo y manda `''` sin ajuste, con los mismos umbrales que la RPC: no hace falta otro arreglo.

## 🧯 Noviembre 2026 — «Borrar TODO el día» borraba movimientos de OTRO día operativo (✅ fix en prod, 05/11, PR #25)

- **Síntoma:** el ajuste del 19/10 (+₡54.107, «Sobrante») no existía en movimientos y nadie vio un error.
- **Causa:** `discardDiaCompleto` (`src/shared/api/cash.ts`, paso 2) elegía los movimientos sin turno por `created_at` dentro del día calendario de CR. Un cierre sellado después de medianoche crea sus filas con `created_at` del día siguiente, y el «Borrar TODO» de ese día siguiente se las llevaba.
- **Casos en prod** (`movement_deletions`):
  - **20/10:** se borraron «Ventas cierre» y «Ajuste de cierre» del 19/10 (₡15.600 + US$100 y ₡54.106,70). No se recrearon; el ajuste del 20/10 los volvió a sumar como ajuste.
  - **20/07:** se borraron «Ventas cierre» del 19/07 y «Propinas turno 2026-07-17 Noche» (₡70.775). Las ventas se recrearon al re-cerrar y las propinas se recargaron con turno.
- **Fix** (rama `claude/fix-borrar-dia`; solo `discardDiaCompleto`, `discardCierreDia` y la confirmación):
  - selección por **día operativo**: con turno, el `session_date`; sin turno, la fecha que escribe el sistema en la descripción (cierre, apertura de pozo, retiro, «Propinas turno»); los manuales, por `created_at`. `fechaOperativa` (`cierrePozo.ts`) no se tocó;
  - **vista previa** antes de confirmar: cantidad, ₡ y US$ por día operativo, manuales con su hora de carga, y las filas de otro día operativo listadas como aviso, que **no se borran**. Si la lista cambió entre la vista previa y el borrado, no se borra nada;
  - **ningún delete sin chequear el error:** el paso 3 de `discardDiaCompleto` y los 3 deletes de `discardCierreDia` («Deshacer cierre») antes se tragaban el fallo;
  - el texto ya no dice «NO toca propinas»: borra los **pagos** de propinas del día, no las propinas asignadas.
- **Datos históricos:** no se corrigen; el 19/10 se decide aparte.

## 🔐 Noviembre 2026 — SEC-01: escalada de roles en `profiles`

### SEC-01 · 🔴→🟢 Cualquiera podía registrarse como owner (prod; staging cerrado, prod pendiente del Paso 2)

- **Evidencia (03–04/11, prod y staging idénticos):**
  - `handle_new_user()` (trigger `AFTER INSERT` sobre `auth.users`) tomaba `COALESCE((raw_user_meta_data->>'role')::user_role, 'salonero')`.
  - `disable_signup=false` y `mailer_autoconfirm=true`: con la anon key (pública) se podía hacer `POST /auth/v1/signup` con `data.role='owner'`, y la cuenta quedaba confirmada al instante.
  - La cuenta nacía con `is_active=false`, pero `get_my_role()` (`SELECT role FROM profiles WHERE id = auth.uid()`, sin `search_path`) no mira `is_active`. Resultado: permisos de owner en todas las policies.
  - `anon` y `authenticated` tienen INSERT, UPDATE y DELETE en todas las columnas de `profiles`. Lo único que frena es RLS.
  - **Sin explotación:** 0 usuarios con `role` en la metadata (sin filtro de fecha), 3 owners legítimos.
- **Causa:** la mig `0090_user_selfsignup` confió en la metadata del cliente. La activación (`is_active`) no estaba conectada con el rol a nivel base.
- **Contención (Paso A, 04/11, firmado):**
  - `disable_signup=true` en los dos proyectos. El signup con anon da `422 signup_disabled`.
  - Bans de 2 managers que ya no usan la app (Rosaura y LE - Consultorias), más el borrado de sus 6 sesiones y 15 refresh tokens.
- **Fix (mig 068):**
  - `handle_new_user` siempre da de alta `salonero` + inactivo.
  - Trigger `profiles_guarda_roles`: cambiar `role` o `is_active`, insertar un perfil elevado o activo, o borrar un perfil exige un owner **activo**. Bypass solo sin JWT o con `service_role`.
  - Constraint trigger diferido que impide quedar con 0 owners activos.
  - `drop policy if exists perfil_propio_update`.
  - `search_path` en `get_my_role`, con el mismo cuerpo.

### Drift de policies de `profiles` (prod = staging ≠ repo)

- En las bases están «Perfil propio visible» (SELECT `id = auth.uid()`), «Owners y managers ven todos los perfiles» (SELECT) y «Solo owners crean/editan perfiles» (ALL, `get_my_role()='owner'`, sin `with_check`). Se aplicaron fuera de migraciones.
- `perfil_propio_update` (`001:107` del repo) **no existe** en ninguna base. La 068 la borra si existiera.
- **Drift de trigger:** el trigger de `auth.users` se llama `trg_on_auth_user_created` en prod y `on_auth_user_created` en staging. Las dos llaman a `handle_new_user()`. La 068 solo reemplaza la función.

### SEC-01b · ✅ Resuelto en staging y en prod (05/11) — guardas que se abren con NULL o no miran `is_active`

**Cierre (05/11):**
- **Mig 069** (rama `claude/sec-01b-is-active`):
  - `get_my_role()` pasa a ser `… and is_active`;
  - las 6 guardas de prod pasan a `if get_my_role() is null or get_my_role() not in (…)`, con el texto completo de prod y diff de 1 línea por función;
  - las 3 policies llevan `and profiles.is_active` (`alter policy`, con todo lo demás igual).
- **Mig 070** (rama `claude/sec-01b-pos-guardas`, solo la línea `staging`): la misma corrección de guarda en las 6 funciones del PoS propio, más el revoke de EXECUTE a `public`/`anon`. Se aplicó en staging **antes** que la 069.
- **Pruebas en staging** (JWT simulado, todo con rollback): un owner **inactivo** queda bloqueado en las 12 funciones, en las 3 policies y en el cobro real (`get_my_role()` = NULL). Owner, manager, cajero y salonero activos se comportan igual que antes de la 069.

**Prod (05/11 09:22 CR, firmado):**
- Re-chequeo previo: los md5 de las 7 funciones y las 3 policies, idénticos al Paso 0.
- Todos los que usaron cierres, movimientos, facturas, inventario y créditos en los últimos 30 días están activos (Inés, Caja Satori, Cacho). Los únicos inactivos con esos roles son Rosaura y LE - Consultorias, baneadas.
- 069 aplicada a mano. Catálogo: diff de 1 línea por función, policies con `is_active` y todo idéntico a staging después de la 069.
- Owner, manager y cajero activos conservan su rol (solo lectura). Rosaura, con rollback: `get_my_role()` = NULL y `delete_supplier_credit` da raise.
- Ledger de prod: 46 → 47.

**Hallazgo del re-escaneo (05/11):** en staging había 6 guardas `not in` más, en el PoS propio (`pos_cobrar_check`, `pos_cobrar_orden`, `pos_merge_orden`, `pos_reopen_orden`, `pos_unmerge_orden`, `sync_pos_tips_to_pool`). Como `anon` las podía ejecutar y no tiene `auth.uid()`, **la guarda ya estaba abierta para `anon`**. Quedó cerrado con el revoke y la 070.

**Criterio:** las guardas NULL-inseguras se corrigen **antes o en la misma migración** que el cambio de `get_my_role()` para que mire `is_active`. Si `get_my_role()` pasa a devolver NULL para inactivos sin eso, esas guardas les **abren** la función.

Escaneo de `pg_proc.prosrc` y `pg_policies` en prod (04/11):

| Objeto | Patrón | ¿Abre con NULL? |
|---|---|---|
| `mark_factura_verified` (038) | `if get_my_role() not in (…) then raise` | **Sí** |
| `complete_inventory_review` (043) | ídem | **Sí** |
| `discard_inventory_review` (043) | ídem | **Sí** |
| `apply_supplier_credit` (053) | ídem | **Sí** |
| `delete_supplier_credit` (053) | ídem | **Sí** |
| `create_supplier_credit` (054) | ídem | **Sí** |
| policy `cash_cierres_dia.cierre_write` (ALL) | lee `profiles.role = any(…)` directo, **sin `is_active`** | No, pero un inactivo conserva el permiso → **CRÍTICO** |
| policy `recipes.inv_write_recipes` (ALL) | ídem | ídem → **CRÍTICO** |
| policy `recipe_ingredients.inv_write_ri` (ALL) | ídem | ídem → **CRÍTICO** |
| `delete_movement_cascade` | `if get_my_role() in (…)`; si no, contraseña de gerencia con `p.is_active`; si no, raise | No |
| `verify_manager`, `verify_manager_password` | `p.role in (…) and p.is_active` | No |
| `pos_ventas_*` (067) y ~60 policies | `get_my_role() = any(…)` / `= 'x'` | No (NULL deniega) |

- Son **6 guardas vivas, no 8:** las del repo en 039:53 y 043:147 (`delete_movement_cascade`) ya están reemplazadas en prod por la versión con contraseña.
- No hay usos con `<>`, `!=`, `is distinct from`, `coalesce(get_my_role…)` ni `is null`. La única `SECURITY DEFINER` que escribe en `profiles` es `handle_new_user`.
- Hoy ninguna cuenta de Auth está sin perfil, así que nadie recibe NULL. Las 6 guardas son una bomba para el día en que cambie `get_my_role()`.

### 🟠 BLOQUEANTE del PoS propio — `anon` ejecuta funciones `SECURITY DEFINER` del PoS en staging (6 de 7 cerradas el 05/11)

- **05/11 (firmado, solo staging):** se revocó EXECUTE a `public`/`anon` en las 6 de cobro, fusión, reapertura y propinas; `authenticated` y `service_role` lo conservan. Verificado con `has_function_privilege('anon', …) = false`. Antes se buscó en `src/`: solo se llaman desde `/comandero` (`PrivateRoute`), y `sync_pos_tips_to_pool` no se llama desde la app. Versionado en la 070.
- **Sigue abierta:** `my_turno_stats` (solo staging) todavía es ejecutable por `anon`. Está en el ROADMAP como pendiente del requisito del pase.

- En staging, `anon` tiene EXECUTE sobre `pos_cobrar_check`, `pos_cobrar_orden`, `pos_merge_orden`, `pos_unmerge_orden`, `pos_reopen_orden`, `sync_pos_tips_to_pool` y `my_turno_stats` (además de las 4 de siempre).
  - Medido con `has_function_privilege('anon', …)` el 04/11. Staging tiene 25 SD; prod, 17.
- Son funciones de plata (cobro, propinas): **requisito bloqueante antes de pasar el PoS propio a prod**. Hay que revocarlas de `public`/`anon` (ver B1, 2026-07-23: el `revoke from anon` solo no alcanza) y verificarlo.

## 🔐 Noviembre 2026 — SEC-03 y SEC-04: accesos sin sesión (✅ cerrados en prod, 05/11, migs 072 y 073)

### SEC-03 · 🔴 ALTA → ✅ · `anon` insertaba en `customers` sin validación (mig 007)

- **Qué era:** [`007_customer_selfsignup.sql:11-15`](supabase/migrations/007_customer_selfsignup.sql) creaba `customers_anon_insert` (`for insert to anon with check (true)`) y la línea 18 daba `grant insert … to anon`. Cualquiera, sin cuenta, creaba clientes con `points`, `tier`, `total_spent_crc`, `total_visits`, `notes` o `active` arbitrarios, y el `UNIQUE(phone)` (error `23505`) revelaba si un teléfono ya estaba en la base. El CRM no se usa en operación (2 clientes en prod).
- **Arreglo — mig 072 (`072_crm_cierre_anon.sql`):** drop de la policy + `revoke insert, update, delete` de `anon` en `customers`, `customer_interactions`, `loyalty_config` y `loyalty_rewards`. Las policies de staff de la 004 no cambian. `/registro` y `CrmQR` quedan apagados con el aviso «El registro de clientes vuelve pronto con el Club Satori» (flag en `src/modules/crm/registroPublico.ts`); vuelven en la F1 del Club con una función `SECURITY DEFINER`. `staging-drift-sync.sql:337` quedó comentada.
- Rollback de emergencia (reabre el agujero): `scripts/sql/072_rollback.sql`.

### SEC-04 · 🔴 ALTA → ✅ · lectura anónima de propinas y empleados

- **Qué era:** cinco policies SELECT `to public` sin exigir sesión: «Todos ven entradas de propinas» (`tip_entries`, `using (true)`), «… sesiones de propinas» (`tip_sessions`), «… puntos por rol» (`role_tip_points`), «… tipos de cambio» (`exchange_rates`) y «Todos ven empleados activos» (`employees`, `using (is_active = true)`). Con la anon key del bundle se leían las propinas y los pagos por empleado (2.095 entradas, 440 sesiones en prod) y nombre, rol, `pos_name` y `pos_login` de los empleados activos. Lo encontró el Paso 0 de la 072.
- **Arreglo — mig 073 (`073_lecturas_anon_a_authenticated.sql`):** las 5 policies recreadas iguales pero `to authenticated` + `revoke select` de `anon` en las 5 tablas. Antes se comprobó que ninguna pantalla sin sesión (`/login`, `/registro`) ni cron lee esas tablas con la anon key (los crons y las Edge Functions usan `service_role`). Las líneas de `staging-drift-sync.sql` que las recreaban quedaron comentadas.
- Rollback de emergencia (reabre el agujero): `scripts/sql/073_rollback.sql`.

### Aplicación y verificación (las dos migraciones)

- **Staging (05/11, ~19:30 UTC):** cada una corrida dos veces (idempotentes), ledger 70 → 72. Ismael validó en `satori-staging.pages.dev` con owner y salonero.
- **Prod (05/11, ~20:05 UTC = 14:05 CR):** Paso 0 repetido sin cambios; aplicadas a mano dos veces **antes del merge** (Branching), ledger 48 → 50.
- **Verificado en las dos bases:**
  - `has_table_privilege('anon', …)` = `false` para cada permiso revocado (INSERT/UPDATE/DELETE en las 4 del CRM; SELECT en las 5 de SEC-04); `authenticated` conserva SELECT.
  - REST con la anon key: HEAD/GET a las 5 tablas → `401` / `42501`; POST a `customers` con `points: 99999` → `401` / `42501`, y no se creó ninguna fila.
  - Owner y salonero (sesión simulada con su JWT, en transacción con rollback): las mismas filas que antes en las 9 tablas.
  - Barrido de `public` después: ninguna tabla con permisos de `anon` y una policy que no exija sesión.
- **Respaldos de staging** `cash_movements_pre_migracion_2026_07` y `suppliers_pre_migracion_2026_07` (solo staging) tenían RLS apagado: se cerraron con `scripts/sql/staging_respaldos_cierre_anon.sql` (RLS sin policies + `revoke all` a `anon`/`authenticated`), sin borrarlos; HEAD/PATCH con la anon key → `401`. Decidir si se borran: en el backlog.
- **Queda (higiene, no exposición):** `anon` conserva INSERT/UPDATE/DELETE a nivel tabla en las 5 tablas de SEC-04 (grants por defecto de Supabase); RLS los bloquea porque las policies de escritura exigen rol.

## 🆕 Hallazgos de octubre 2026 (go-live del PoS)

1. **Branching corre `migrate` contra PROD en cada push a `main`** (confirmado de nuevo en los logs de #13–#16:
   `Connecting to database... All migrations are up to date.`). **Decisión vigente:** las migraciones se aplican a
   mano en prod **antes** del merge y se verifican; el merge queda como no-op para la base. Así entraron 062–066 y la
   067. Regla escrita en [ESTADO.md](ESTADO.md).
2. **Un PR con `supabase/functions/` re-desplegaría las funciones con `verify_jwt=true`** (no hay `config.toml`).
   `ingest-ndf` corre en prod como v1 con `verify_jwt=false` y el agente solo manda `x-ingest-secret`: un redeploy
   automático le daría 401 en cada ciclo. Por eso #13 se mergeó sin la carpeta. Abierto hasta el ítem 11.
3. **El RLS de `pos_ndf_*` devuelve 0 filas a un salonero, sin error** (medido el 29/10 con el JWT de un salonero
   real). Con `'pos'` la app caía en silencio al Excel. **Resuelto (30/10):** mig 067 (funciones sin medios de pago,
   un solo camino para todos los roles) + `estadoPos` y franja «Mostrando solo el Excel…» cuando no se puede leer.
4. **Las tablas `pos_ndf_*` no tienen PII** (sin nombre, teléfono, dirección ni cédula de cliente; texto libre
   revisado). Sí tienen datos sensibles del negocio: medios de pago por factura, descuentos y `clase_ingreso`
   (`duenos` 322, `cortesia` 1.732). Las funciones 067 no los devuelven.
5. **«Ver como» usa los permisos del owner:** no sirve para probar permisos. La 067 se probó con un salonero real
   en staging y simulando el JWT en prod.
6. **El ICP de la pestaña del owner dividía `payout_crc`** (lo cobrado del reparto), no la propina generada: FRANCO
   (barman) daba 411 % y los saloneros la mitad. **Resuelto (#15):** propina electrónica declarada, barra «no
   aplica», benchmark único con Mi Rendimiento.
7. **Con el Excel, el ICP de octubre salía inflado** (15,7 %): las ventas del Excel cortan el 20/10 y las propinas
   llegan al 28/10. Con el PoS da 10,6 %. Los umbrales (≥13 / <10 %) siguen sin recalibrar contra el histórico 5–9 %.
8. **`version.json` desde el navegador lleva al login:** el service worker (`NavigationRoute` con allowlist
   `^/satori-app/` y denylist solo `/inbox/share`) responde `index.html` a esa navegación. El archivo sí se publica.
   Abierto: agregar `/\/version\.json$/` a `navigateFallbackDenylist`.
9. **El deploy de #16 quedó en `waiting`** ~13 min (job `deploy` del run #247): regla de protección del environment
   `github-pages`, que el deploy de #15 no tuvo. Abierto: revisar si es a propósito.
10. **Cloudflare Pages:** según el ESTADO de septiembre, la URL principal de staging publica desde
    `integracion/analitica-staging`, que quedó 4 commits atrás de `staging`. Lo validado el 30/10 en staging fue un
    deploy de *preview* de `staging`. Abierto: alinear las ramas.
11. **Agente de BioTime parado desde el 14/09** (última sync 17:12 UTC). Abierto.
12. **Ledger de staging sin las filas 065 y 066** (las columnas existen). Abierto.
13. **«Contexto jueves» de Hoy mostró un promedio mal** (₡235.773 vs ₡406.064) mientras cargaba el histórico.
    Abierto: revisar si mezcla Excel y PoS.

## 🧭 Triage al 30/10 de lo anterior

| Hallazgo (sección del histórico) | Estado al 30/10 | Evidencia |
|---|---|---|
| Branching auto-aplica migraciones a prod (2026-08-07 noche) | ✅ **Adoptado y vigente** | Logs de Branching de #13–#16; regla en ESTADO.md |
| Mig 052 auditoría de ediciones + ledger de staging reconciliado (2026-08-07 tarde) | ✅ Resuelto · 🆕 el ledger de staging volvió a quedar sin 065/066 | 052 en el ledger de prod (45 filas) |
| `delete_movement_cascade` no se puede llamar por la Management API (2026-08-07) | ✅ Vigente como aprendizaje | — |
| El auto-disparo de «Deploy to GitHub Pages» falló en 2 pases (2026-08-07) | ✅ Ya no pasa (runs #244–#247 dispararon solos) · 🆕 ver octubre #9 | Runs de Actions |
| `revoke … from anon` inefectivo en `SECURITY DEFINER` (B1, 2026-07-23) | 🟠 **Parcial:** B2 endureció las de plata; **quedan 4** ejecutables por `anon` (`get_my_role`, `handle_new_user`, `log_movement_edit`, `unif_on_cash_movement`) | `has_function_privilege('anon', …)` en prod, 30/10 |
| Pagos pendientes huérfanos en Proveedores (smoke 2026-07-06) | ✅ Resuelto | El dueño rechazó los huérfanos desde la UI; T3 #7 |
| Subset core de la 026 en prod (hotfix 2026-07-06) | ✅ Resuelto · excepción permanente | Documentado en ESTADO.md |
| Faltante fantasma del cierre · déficit USD de CF · edición de pago = cascade (2026-07-03) | ✅ Resuelto / histórico | Pozo único + T3 en prod |
| Ritual de `project-ref` antes de comandos de base (2026-07-03) | ✅ **Vigente** | Regla 7 de ESTADO.md |
| Accionados 2026-06-26/27/28 (IDOR, cascadas, IA desde el teléfono, outbox, render de Propinas, pantalla negra) | ✅ Resueltos y en prod | — |
| Seguridad #1 IDOR `extract-document` | ✅ Resuelto (prod v7, `verify_jwt` on) | Management API |
| Seguridad #2 `monthly-report` sin auth | 🔴 **Abierto** (prod v9, `verify_jwt` off) | Management API, 30/10 |
| Seguridad #3 falta `supabase/config.toml` | 🔴 **Abierto** (= ítem 11) | No existe en `main` |
| Seguridad #14 `deploy.yml` sin gate de tests | 🔴 **Abierto** | `deploy.yml` no corre `vitest` |
| Seguridad #5 RLS de `cash_cierres_dia` | ✅ Verificado: prod y staging tienen las mismas 2 policies (lectura: cualquier autenticado; escritura: owner/manager/cajero/contador) | `pg_policies`, 30/10 |
| Deep-dive auth C–J (watchdog, doble refresh, latido, re-suscripciones…) | ⏸️ Parqueado, va con el PILAR | — |
| Testing: entorno DOM en vitest | ✅ Resuelto | — |

---

# 📚 Histórico — entradas de junio a agosto 2026, sin editar

## HALLAZGOS — backlog triado de las auditorías (handoff 2026-06-25, addenda 2026-06-26/27/28, 2026-07-03, hotfix 2026-07-06)

> **SOLO evaluación.** Nada de esto fue accionado salvo lo indicado como ✅. Es el inventario de lo que
> las auditorías de esta sesión encontraron, para decidir qué atacar y en qué orden. No implementa nada.
> Estado/pase a prod → [ESTADO.md](ESTADO.md) · backlog priorizado → [PROMPT-CONTINUACION.md](PROMPT-CONTINUACION.md).

### 🔌 2026-08-07 (noche) — HALLAZGO: la base de prod tiene auto-deploy de migraciones (Supabase Branching)

Al pasar la mig 052 a prod, el pre-check read-only encontró que **prod YA la tenía aplicada** — sin apply manual.
Investigado 100% read-only (`gh api` checks + Management API GET `/branches` + `git log`). Resumen ejecutivo →
[`_handoff/INTEGRACION-SUPABASE.md`](_handoff/INTEGRACION-SUPABASE.md).

- **Mecanismo:** lo hace la **Supabase GitHub App** (`app_slug: supabase`) con **Branching** activo — **NO** un
  workflow del repo (el único es `.github/workflows/deploy.yml`, solo frontend con la anon key) y **NO** hay
  `supabase/config.toml`. Es la app la que postea el check **"Supabase Preview"**.
- **Alcance = SOLO PROD.** Management API `/branches` del proyecto prod (`yiczgdti`) devuelve 1 rama: `name:"main"`,
  `is_default:true`, `git_branch:"main"` (la base de producción atada a git `main`). En commits de la rama git
  `staging` el check sale **`skipped`** → el proyecto **STAGING (`hwiatgic`) NO está atado a la integración**
  (sus migraciones siguen manuales por CLI/Management API).
- **Disparo:** push a `main`. La app corre `db push` contra prod; si el commit trae un `.sql` nuevo en
  `supabase/migrations/`, lo **aplica + registra en `schema_migrations`**. Evidencia: `6bb9c33` (mig 052) → prod
  **35→36 filas**, `movement_edits` creada, fila 052 con **9 statements** (formato db push).
- **Condición (por qué antes NO aplicaba):** el `db push` a prod solo entra si el **ledger de prod está
  consistente**. Evidencia gh api: en commits de main **pre-B2** (≤ 2026-07-23: c77ced0, 1c8a9ad, 3df4feb) el
  check era **`failure`** (drift del ledger → db push fallaba); **desde el B2** (2026-07-27, prod reconciliado)
  es **`success`** en todos. → El viejo "Supabase Preview rojo crónico" era ESO, y ya se dio vuelta. Los pases
  viejos evitaban el auto-apply **aplicando la mig out-of-band ANTES de pushear** (nada pendiente → verde no-op).
- **Superficie de riesgo:** (1) **cualquier `.sql` nuevo/modificado en `supabase/migrations/` que llegue a
  `main`** (push directo o merge de PR) → auto-aplicado a prod. (2) **Edge functions PROBABLEMENTE también**
  (la rama reporta `status: FUNCTIONS_DEPLOYED`) → **A CONFIRMAR** si cambios en `supabase/functions/` en main
  se despliegan solos a prod. (3) NO toca el frontend (eso es Pages) ni staging.
- **⚠️ Implicación:** el orden "git primero (reversible) · base al final" **NO se sostiene para prod**: pushear
  el `.sql` a `main` YA es el apply. Un `Supabase Preview` verde sobre un commit de main con `.sql` nuevo = ya
  está en prod → **NO correr apply/repair manual después** (el repair duplicaría la fila del ledger).
- **DECISIÓN: ADOPTADA** (el pase a prod pasa a ser el push a main + verificar). **Guardrails:** (1) una mig
  llega a `main` **solo cuando ya va para prod** y con el **ledger de prod consistente**; (2) **staging sigue
  manual**. **Interruptor** si se quiere desactivar: Dashboard de Supabase → proyecto `yiczgdti` → **Branches**
  (o Settings → Integrations → GitHub). No tocado (solo identificado).

### 🧾 2026-08-07 (tarde) — Auditoría de EDICIONES (mig 052) + ledger de STAGING reconciliado

- **Mig `052` — auditoría de EDICIONES de `cash_movements`** (espejo de `movement_deletions`/039, pero para
  UPDATE). Tabla `movement_edits` **append-only** + trigger `AFTER UPDATE` `log_movement_edit()` (`SECURITY
  DEFINER`) que registra **solo** cambios en 10 columnas sensibles (`amount_crc, amount_usd, method,
  movement_type, caja_origen, status, subcategory, classification, account_id, supplier_id`); ignora no-op /
  cosméticos / el toque de `updated_at`. RLS **solo-SELECT** owner/manager/contador (ningún cliente forja o borra
  trazas; escribe únicamente el trigger). **Aplicada out-of-band a staging + verificada punta a punta** (una
  edición real por la app dejó su fila con `edited_by` = usuario). Cero código de app, sagrados byte-idénticos.
  **Commit `2ccdfa0`, FF-merged a `staging`.**
- **Ledger de STAGING reconciliado.** `schema_migrations` cortaba en **049** con `050`/`051`/`052` aplicadas
  FUERA del ledger. `supabase migration repair --status applied 050 051 052` → **49 → 52 filas**, `migration
  list` alineado (local==remote, sin huérfanos), **`db push` desbloqueado** (`Remote database is up to date`,
  no-op). Con **backups antes/después** (`_handoff/ledger-staging-2026-08-07-{pre,post}-reconciliacion.json`) y
  **`--status applied`** (NUNCA `reverted` — le mentiría al ledger sobre plata real).
- **PROD ya estaba consistente — NO se tocó.** Foto read-only por el canal firmado (`comun.ts`/`prod-gate`,
  `read_only:true` + smoke `25006`): prod tiene **35 filas** y `050`/`051` **ya están en su ledger** (los docs
  viejos decían "33 filas + `051` out-of-band" → desactualizado). El **único pendiente de prod es la `052`**.
- **Pase de `052` a PROD = su propia sesión, con firma.** Como el ledger de prod SÍ es consistente, allá la `052`
  lleva **`migration repair --status applied 052`** además del SQL out-of-band (a diferencia de staging, donde
  se registró junto con el arrastre `050`/`051`).

### 🧭 2026-08-07 — 2 aprendizajes operativos (pases ítems 1/7/8)

- **`delete_movement_cascade` NO se puede llamar por el canal admin (Management API).** La versión de prod
  (mig 044) exige en su FASE 1 de autorización una de dos: `get_my_role() in ('owner','manager')` (sesión de
  app con JWT) **o** `p_manager_email` + `p_manager_password` validados server-side (crypt). Por la Management
  API el contexto corre como `supabase_read_only_user` con `get_my_role() = null` y `auth.uid() = null` → cae
  al `else` → `raise 'No autorizado para borrar movimientos'`. **Conclusión:** los **borrados** de movimientos
  van **desde la app** logueado como owner/manager; por SQL admin solo se pueden hacer **correcciones** (UPDATE
  directo, que NO pasa por esa RPC). Por eso el ítem 7 se **corrigió** en vez de borrarse. (Un `DELETE` crudo
  tampoco sirve: `inventory_movements.cash_movement_id` es `ON DELETE SET NULL` → dejaría inventario huérfano
  + el documento colgando + sin auditoría — justo lo que la mig 039/044 existe para evitar.)
- **El auto-disparo del workflow "Deploy to GitHub Pages" falló en 2 pases seguidos.** El push a `main` **no
  disparó** el workflow (Actions habilitado, sin `[skip ci]`); hubo que lanzarlo a mano con
  `gh workflow run deploy.yml --ref main` (`workflow_dispatch`). Además, con congestión de runners, algunos
  jobs quedaron en cola ~15 min y fueron **cancelados** (`build`/`deploy: cancelled` → run `failure`, aunque el
  código compile local), y dispatches repetidos **colisionan en el grupo de concurrencia `pages`**. **A revisar
  en `deploy.yml`:** por qué el trigger `on: push` no dispara (¿filtros de `paths`? ¿webhook?) y la
  `concurrency`. Workaround: verificar que no haya runs `queued`/`in_progress`, lanzar **UN** dispatch limpio y
  monitorear; confirmar por `version.json.commit` + grafo de chunks, **nunca por HTTP 200** (el fallback SPA
  responde 200 a cualquier `/assets/*.js` inexistente).

### 🔐 2026-07-23 (Fase B1) — `revoke ... from anon` INEFECTIVO: funciones SECURITY DEFINER ejecutables por `anon`

**Hallado auditando el DDL del `035` antes de traer su archivo.** No se arregló nada — solo se documenta.

- **El bug de patrón.** `create function` otorga **EXECUTE a PUBLIC** por defecto. Revocarle a `anon`
  (`revoke execute on function ... from anon`) **NO le quita lo que hereda de PUBLIC** → `anon` sigue
  pudiendo ejecutar. El patrón correcto es el de la **mig 045**: `revoke all on function ... from
  public, anon`.
- **Evidencia (STAGING, `proacl` crudo).** El `=X/postgres` inicial (sin rol antes del `=`) **es**
  PUBLIC con EXECUTE:

  | función | mig | `proacl` | `anon` puede ejecutar |
  |---|---|---|---|
  | `sync_pos_tips_to_pool` | 035 | `=X/postgres` \| … | 🔴 **sí** |
  | `delete_movement_cascade` | 039/043/044 | `=X/postgres` \| … | 🔴 **sí** |
  | `verify_manager_password` | 045 | *(sin `=X/`)* | ✅ no |

- **🔴 ALCANCE REAL: 12 de 17.** Al barrer TODAS las `SECURITY DEFINER` de `public` con
  [`scripts/ledger-reconciliacion/acl-funciones.ts`](scripts/ledger-reconciliacion/acl-funciones.ts)
  (staging) resultó que **no son 2, son 12** las ejecutables por `anon`:

  🔴 `delete_movement_cascade` · `get_my_role` · `handle_new_user` · `mark_factura_verified` ·
  `my_turno_stats` · `pos_cobrar_check` · `pos_cobrar_orden` · `pos_merge_orden` ·
  `pos_reopen_orden` · `pos_unmerge_orden` · `sync_pos_tips_to_pool` · `unif_on_cash_movement`

  ✅ Cerradas correctamente (patrón `from public, anon`): `complete_inventory_review` ·
  `discard_inventory_review` · `post_accounting_entry` · `verify_manager` · `verify_manager_password`

  **De las 12, las de COBRO del PoS (`pos_cobrar_*`) son plata.** El PoS **no está en prod**, pero
  `delete_movement_cascade`, `mark_factura_verified`, `unif_on_cash_movement`, `get_my_role` y
  `handle_new_user` **sí**. Correr el mismo script contra prod es parte de B2.

- **⚠️ Alcance PROD.** `delete_movement_cascade` **está en producción** (migs 039/043/044). En Fase A se
  verificó en prod que `verify_manager_password` sí está cerrada (`anon`=false), pero **no** se midió el
  ACL de `delete_movement_cascade` en prod → **verificarlo en B2** (lectura, read-only).
- **Mitigación vigente (por qué no es una emergencia):** ambas funciones tienen **guard interno de rol**
  — `sync_pos_tips_to_pool` hace `if get_my_role() not in ('owner','manager') then raise exception`, y
  `delete_movement_cascade` exige auth de manager desde la 044. Un `anon` que las invoque muere en el
  guard. Lo roto es la **defensa en profundidad**, no el control de acceso efectivo.
- **Acción propuesta (NO ejecutada):** una migración nueva que haga
  `revoke all on function <fn> from public, anon` para las funciones afectadas, y auditar el resto de
  las `SECURITY DEFINER` con el mismo criterio. **Toca privilegios de funciones de plata → firma.**
  El archivo `035_propina_pos_pool.sql` traído en B1 **conserva el DDL original a propósito** (debe
  reflejar lo aplicado) y lleva la advertencia en su cabecera.

- **✅ MEDIDO Y ENDURECIDO EN PROD (B2, 2026-07-27, con firma).** `acl-funciones.ts prod` (read-only)
  dio **5/10** `SECURITY DEFINER` ejecutables por `anon`: `delete_movement_cascade`,
  `mark_factura_verified`, `get_my_role`, `handle_new_user`, `unif_on_cash_movement` (las `pos_*`
  **no existen en prod**). La **mig 049** aplicó `revoke all ... from public, anon` a las **2 RPC
  directas de plata/auditoría** (`delete_movement_cascade(uuid,text,text,text)` +
  `mark_factura_verified(uuid)`) → ambas `anon`=false; prod quedó en **3/10**. Se dejaron **afuera a
  propósito**: `get_my_role` (helper de RLS `TO public` → revocarlo puede cambiar "RLS niega" por
  "permission denied"; a `anon` no le filtra nada) y los 2 triggers (`unif_on_cash_movement`,
  `handle_new_user` — no invocables directo; el revoke no frena el disparo). Detalle →
  [`_handoff/acl-prod-2026-07-27.md`](_handoff/acl-prod-2026-07-27.md). La 049 se portó también a
  staging (12/17 → **10/17**; las `pos_*` van con el pase del PoS).

### 🔎 Smoke físico PROD 2026-07-06 — TODO PASÓ · 1 hallazgo: pagos pendientes huérfanos

El dueño validó en piso el pase completo en PROD y **todo pasó**: `version.json` ✓ · Caja Diaria sin errores ✓ · asistente con foto + lectura IA Sonnet (efectivo y pendientes, genera tarea de revisión) ✓ · borrado con contraseña de manager (elimina movimiento + tarea asociada) ✓ · Cierre del Día con diferencias USD y gate de ajuste ✓ · sinceramiento USD realizado ✓ · Propinas sin parpadeo, pago por la vía real ✓. **La ola 2026-07 queda cerrada.**

- **🆕 [P1 estabilización] Pagos pendientes huérfanos en Proveedores.** **Síntoma:** en la pestaña **Proveedores** de Caja aparecen **"14 PAGOS PENDIENTES"** en rojo. **Dónde se ve:** vista de proveedores / pendientes de Caja Diaria. **El problema:** son pendientes de **proveedores que ya no existen** — datos huérfanos, **error viejo** (no lo introdujo el pase; el smoke solo lo hizo visible). **Hipótesis:** al borrar un proveedor, sus pagos/pendientes **no se limpiaron en cascada** → quedaron colgados sin fila de proveedor viva que los respalde; y/o la query de pendientes no filtra por proveedor existente. **Acción (registrar, NO arreglar ahora — estabilización):** (1) **limpieza de datos** — identificar los pendientes sin proveedor vivo y saldarlos/eliminarlos con criterio; (2) **prevención** — evaluar FK con `on delete` adecuado (o `set null` + filtro) y/o filtrar la query de pendientes por proveedor existente. NO tocar en caliente; entra al backlog P1.

### 🔥 Hotfix 2026-07-06 — faltaba el subset core de la mig 026 en PROD (columna `attachments`)

- **Síntoma:** en prod, la Bandeja/Caja tiraba `Could not find the 'attachments' column of 'cash_movements' in the schema cache`. **Causa raíz:** el pase único (2026-07-04) excluyó las migs **022–037 como "PoS"**, pero la **026 (`operacion_roles`) tiene 4 secciones core que la Bandeja/Caja SÍ necesitan** — no son PoS. Se colaron en el corte por estar en un archivo "de PoS".
- **Fix (out-of-band, Management API curl, mismo canal del pase):** se aplicaron a PROD (`yiczgdtirrkdvohdquzf`) las **secciones 1–4 de la 026** en una request: (1) `alter type user_role add value 'proveedor'`; (2) `cash_movements.attachments jsonb` (la columna del error); (3) bucket privado `facturas` + 3 políticas de Storage; (4) 4 políticas RLS del rol proveedor. Luego `NOTIFY pgrst, 'reload schema'`. **La sección 5 (`my_turno_stats`) quedó EXCLUIDA** — referencia `pos_orders`/`tip_entries` que prod no tiene y nada en prod la llama. Todo idempotente (`if not exists` / `on conflict` / `drop policy if exists`); aplicó limpio (HTTP 201).
- **Verificado (PROD):** columna `attachments` (jsonb) ✅ · enum `user_role='proveedor'` ✅ · bucket `facturas` ✅ · las 7 políticas creadas ✅ (`facturas_{insert,select,delete}` + `suppliers_proveedor_select` + `cash_sessions_proveedor_select` + `cash_movements_proveedor_{insert,select_own}`; una 8ª política pre-existente, `"Managers y owners ven proveedores"`, matchea el LIKE por el nombre pero es ajena).
- **Ledger NO tocado · NO se creó archivo de migración nuevo** (es un subset de la 026 que ya existe; numerarlo duplicado ensuciaría la secuencia). Queda como **más deuda out-of-band de prod** (`038–045 + subset core de 026`), a saldar en la reconciliación del ledger. Prod ahora tiene lo core de la 026 aplicado FUERA del `schema_migrations`.

### 🆕 Hallazgos 2026-07-03 (ola grande de Caja/Cierre/Revisión — todo en STAGING)

- **El FALTANTE FANTASMA del cierre — CAUSA RAÍZ ENCONTRADA Y ENTERRADA.** El cierre tiraba un faltante que no era real. Venía de un **desacople**: la fórmula del "debería" **restaba las propinas** (tipeadas), pero el movimiento `'Ventas cierre'` ingresaba el efectivo **BRUTO** a Caja Fuerte (sin descontar propinas). Resultado: el ledger de CF quedaba en `contado + propinas` → faltante fantasma cada día con propinas. **Muerto con "propinas por la vía real"** (`380cb9a`): ahora las propinas se pagan como movimiento real (egreso desde Registradora), la matemática resta las **efectivamente pagadas**, y `'Ventas cierre'` ingresa el **NETO** → `ledger = contado` exacto. El test del gap, que **documentaba** el desfase, se **dio vuelta** y ahora lo **afirma**. Validado físicamente: el cierre "cuadra correctamente" con propinas pagadas y el ledger arranca sincero a la mañana siguiente.
- **Ledger de Caja Fuerte con DÉFICIT HISTÓRICO USD (−$2678).** La fórmula USD firmada (`46ab5c6`: `calcDeberiaUSD` ahora suma `saldoBase.usd`) **destapó** que el ledger de CF nunca contó bien los dólares — retiros USD sin registrar eran **invisibles** para el cuadre viejo (solo miraba ventas). El −$2678 de staging es **espejo de prod**. **Reconciliado en staging** con un ajuste inicial firmado (Ismael cargó Movimientos → Ingreso · Otro CF, USD = físico + 2678). **Prod pendiente:** repetir con el conteo físico del día del pase (§PASE A PROD paso 5).
- **La EDICIÓN de un pago NO es un UPDATE — es `delete_movement_cascade` + `persistPago` recreate.** Por eso "editar un pago como cajero" fallaba sin pedir credenciales: el bloqueo real no estaba en un UPDATE (no existe) sino en el **reenvío de credenciales al path de plata** (la RPC de borrado re-valida server-side). Fundamenta por qué la mig 045 (autorización por contraseña) y el envolver el edit-path con `requireManager` + reenvío de credenciales. Confirmado leyendo `CashTurno.confirmPago` en modo edición.
- **El cambio de modelo de IA de `extract-document` es una ENV VAR, no código.** `ANTHROPIC_MODEL` (leído en `extract-document/index.ts` con default `claude-haiku-4-5`) → cambiar a `claude-sonnet-4-5` es `supabase secrets set`, **sin deploy de código, reversible al instante**. Aplica a las functions sin redeploy. **Trampa de handoff:** no viaja con el cherry-pick a prod → hay que replicarlo aparte (§PASE A PROD paso 4).
- **La verificación de la migración out-of-band se hace por privilegio, no por ledger.** `verify_manager_password` (045) se aplicó a staging con `db query --linked` y se verificó con `has_function_privilege('anon', ..., 'execute') = false` + `pg_proc.prosecdef = true`. Patrón repetible para el pase a prod.

### 🔄 CAMBIO DE RITUAL (2026-07-03) — el guardrail pre-comando-de-base ahora chequea `project-ref`

**El archivo del link del CLI cambió: `supabase/.temp/linked-project.json` YA NO EXISTE en el CLI v2.105.** El estado del link vive ahora en **`supabase/.temp/project-ref`** (texto plano con el ref; el mismo ref aparece también en `supabase/.temp/pooler-url`). El ritual obligatorio de abajo se actualiza: chequear **`cat supabase/.temp/project-ref`** (no `linked-project.json`). Debe decir `hwiatgicyyqyezqwldia` para staging. Si una checklist vieja pide verificar `linked-project.json`, el equivalente real es `project-ref`.

### ✅ Accionado 2026-06-28
- **#1 IDOR en `extract-document` → RESUELTO EN PROD.** La versión segura (`c38a252`) se **desplegó al Supabase de prod**
  (`supabase functions deploy extract-document --project-ref yiczgdtirrkdvohdquzf`; no va por git) y **`main` quedó alineado**
  (`a0d9f0d`, `extract-document/index.ts` byte-idéntico a staging/prod). **Smoke** `POST` sin `Authorization` → **`401`**
  (`UNAUTHORIZED_NO_AUTH_HEADER`). ✅ **Validación física:** la dueña leyó una factura real en prod con rol de caja → OK.
  **Pendiente OPCIONAL no bloqueante:** prueba cross-user (rol fuera de caja → `403` "Sin acceso al documento"). Sale de la
  lista de pendientes de pase (ver §🔐 Seguridad #1).
- **Footgun del link de Supabase → RESUELTO EN STAGING, pendiente en main.** `supabase/.temp/linked-project.json` estaba
  **trackeado apuntando a PROD** y `.temp/` no estaba ignorado → cualquier clon fresco arrancaba enlazado a prod (la causa del
  ⚠⚠ aprendizaje crítico de abajo). Fix `bb93335` (rama `chore/gitignore-supabase-temp`, mergeado a staging por FF):
  `git rm --cached supabase/.temp/` (sin borrar de disco) + `supabase/.temp/` en `.gitignore`. **⚠️ Solo en STAGING — en main
  sigue trackeado apuntando a prod** (portar; ver PROMPT-CONTINUACION ★ PENDIENTES NUEVOS).

### ✅ Accionado 2026-06-27
- **Borrado de día / descarte de turno saltaba la cascada.** `discardDiaCompleto`/`discardCashSession`
  borraban `cash_movements` con `.delete()` crudo → `accounting_entries` huérfanos + `inventory_review_task`
  colgadas (el mismo bug de integridad que mig 039 cerró para el borrado por movimiento, pero por estos dos
  caminos). **ARREGLADO + MERGEADO a staging** (`b8ab78c`): ambos enrutan por `delete_movement_cascade` con
  credenciales de gerencia (mig 044). Test `cash.discardDia.test.ts`. ✅ validada físicamente (pruebas A y B:
  la tarea de Revisión desaparece tras el borrado). Opcional no bloqueante: verificación SQL directa de 0
  `accounting_entries` huérfanos.
- **Lectura de facturas con IA fallaba desde el teléfono** (HEIC/peso/orientación EXIF → Anthropic vacío →
  "sin leer"). **ARREGLADO + MERGEADO a staging (`eefa056`):** se normaliza la foto en el navegador antes de
  subirla (`imageNormalize.ts`). Front-only. ✅ validada físicamente (captura directa con el teléfono).
- **Limpieza de código muerto no-money — MERGEADA a staging** (`9b1127c`→`abb2a25`). Los hallazgos de limpieza
  NO accionados (money-adjacent, sagrados, duplicación de `fi`, `InventoryStep.tsx` huérfano, `@types/dompurify`)
  están catalogados y rankeados en [INFORME-LIMPIEZA.md](INFORME-LIMPIEZA.md). **Follow-up sugerido:** `knip`/`ts-prune`
  en CI (el `noUnusedLocals` del build no detecta exports muertos).
- **Follow-up de seguridad pendiente (Edge Function):** endurecer `mediaType()` de `extract-document` para que NO
  dependa solo de la extensión del archivo. El fix de la foto (front normalizando a JPEG) resuelve el síntoma; el
  endurecimiento server-side queda como defensa en profundidad (no se tocó `supabase/` esta sesión).

### ⚠⚠ APRENDIZAJE CRÍTICO DE PROCESO (2026-06-26) — el CLI estaba enlazado a PRODUCCIÓN
El CLI de Supabase quedó **enlazado a PROD** (`ref yiczgdtirrkdvohdquzf`, "satori-app"), **NO a staging**
(`hwiatgicyyqyezqwldia`, "satori-staging"). Se descubrió al ir a diagnosticar el ledger; **lo cazó el guardrail
ANTES de tocar nada**. El link puede quedar apuntando a prod **sin avisar** (un `supabase/.temp/linked-project.json`
stale).

> 🆕 **MITIGACIÓN PARCIAL (2026-06-28, ver §✅ Accionado 2026-06-28):** `supabase/.temp/` quedó **untrackeado + ignorado en
> STAGING** (`bb93335`) → un clon fresco de staging ya no arranca enlazado a prod. **Pero en main sigue trackeado apuntando a
> prod** (pendiente de portar). El RITUAL de abajo sigue siendo obligatorio igual: el link local puede quedar en prod sin avisar.

> 🛑 **REGLA FIJA, ritual obligatorio — ANTES de CUALQUIER comando de base** (`migration list`, `db query`,
> `db push`, `db dump`, `db pull`…): correr **`cat supabase/.temp/project-ref`** → **DEBE** decir
> `hwiatgicyyqyezqwldia`. **🆕 CAMBIÓ (CLI v2.105): es `project-ref`, no `linked-project.json` (ya no existe).**
> Si no es staging: `supabase link --project-ref hwiatgicyyqyezqwldia` y **re-verificar**.
> **NUNCA correr un comando de DB sin confirmar el ref primero.** Bajo ningún concepto apuntar a `yiczgdtirrkdvohdquzf`.
> (En esta ola 2026-07-03 se usó `db query --linked` con doble check del `project-ref` para aplicar la mig 045 a staging.)

### ✅ Accionado esta sesión
- **Hallazgo A — PANTALLA NEGRA (bootstrap de `useAuth` sin tope).** Diagnosticado y **arreglado + validado en
  staging** (3 commits `0adf30e`/`f0f8127`/`8bed794` + palanca de diag `ee5878a`). Ver ESTADO §b-ter / PROMPT §0-ter.
  **Pendiente: pase a prod (PRIORIDAD 1).**

### ✅ Accionado 2026-06-28 (cont.) — Hallazgo B (PLATA)
- **B — drain del outbox en `SIGNED_IN` → RESUELTO en STAGING y 🆕 EN PROD** (`a14da50`, cherry-pick `52d26b9`; origen `492eaa5`, rama `fix/outbox-flush-on-signin`, mergeada por
  FF; client-side, **sin migración**). Antes `outbox.ts` flusheaba por `'online'` / arranque / un backoff que se apaga con la
  cola vacía; **NO** había flush atado a `SIGNED_IN`/re-login → la premisa "el outbox drena al reloguear" (del fix de
  auth-recovery) no estaba garantizada. **Fix:** `initOutbox` registra `supabase.auth.onAuthStateChange` y, vía el predicado
  exportado/testeable `shouldFlushOnAuthEvent` (SOLO `SIGNED_IN`; `TOKEN_REFRESHED`/`INITIAL_SESSION`/`SIGNED_OUT` **no**
  drenan), dispara el **mismo patrón que el handler de `online`** (reset de backoff + `autoFlush`, **no** `flushNow` directo —
  distinto del "Fix propuesto" original). Guard `outboxWired` contra doble-registro (blinda también el listener `online`).
  **NO** toca el `onAuthStateChange` global de `supabase.ts` ni `flushNow`/`supabaseExecutor`. Tests: +4 del gateo
  (`outbox.test.ts` 9→13); build prod **EXIT 0** + **155** verdes. 🆕 **PORTADO A PROD** (`a14da50`); validado en staging, smoke en prod pendiente del OK de la dueña.
  ✅ **Desbloquea la PRECONDICIÓN del auth-recovery** (hoy DIFERIDO; ver ESTADO §f / PROMPT §0-bis).

### ✅ Accionado 2026-06-28 (cont.) — Render de Propinas estabilizado (PLATA)
- **Render de Propinas inestable → ESTABILIZADO en STAGING y 🆕 EN PROD** (`a14da50`, cherry-pick; origen `ec70598`, rama `fix/propinas-render-estabilidad`, FF;
  client-side, **sin migración**). Bug de PROD que dejaba Propinas **inusable**: `take_home`/`pts_val` se guardaban en el
  estado `lines` y un `useEffect` los recalculaba con `setLines` → cada refetch de realtime (auto-eco de las escrituras
  propias) dejaba un frame con `take_home: 0` ("₡ —"); y el picker de Coberturas no excluía a los activos ni persistía.
  **Fix (4 partes):** (1) `take_home`/`pts_val` **DERIVADOS en un `useMemo`** (no en estado → síncrono, nunca un frame en 0);
  (2) el picker excluye a quienes ya participan (helper puro `availableForCobertura` + node-test); (3) `addCobertura`/
  `removeCobertura` **persisten** (upsert/delete → sobreviven un refetch); (4) refetch por auto-eco cortado con `pauseWhile`
  (3s) + `lastLocalWriteRef`. **SAGRADO intacto:** `tipCalculations.ts`/`calcTurno` **byte-idéntico**, payout al cerrar
  **idéntico** (merge 1:1 verificado; el `?? 0` es código muerto); `tips.ts` sin cambios de firma. Build EXIT 0, 159 tests
  (+4 del helper), **verificación adversarial 4/4 PASS**. 🆕 **PORTADO A PROD** (`a14da50`, cherry-pick limpio: `TipsModule.tsx`
  byte-idéntico en main); **crisis prod-down cerrada**; validado en staging, smoke en prod pendiente del OK de la dueña.

### 🧪 Testing
- **✅ RESUELTO (2026-06-26) — entorno DOM en vitest.** Se agregó `happy-dom` + React Testing Library + `vitest.setup.ts`
  (mergeado a staging `69d7749`). Default `node` a propósito; los tests DOM piden `// @vitest-environment happy-dom`.
  El smoke `src/App.smoke.test.tsx` **renderiza el árbol con router y falla si reaparece el loop `/`↔`/login`** (el bug que
  antes era invisible). Gates verdes: build prod EXIT 0 + vitest 19 files/141 tests.

### 🔐 Seguridad (audit de la sesión — triado)
- **✅ #1 IDOR en `extract-document` — RESUELTO EN PROD (2026-06-28)** (`c38a252`): exige JWT, baja bajo RLS sin service_role,
  CORS por allowlist; validado los 2 lados. **Desplegado al Supabase de prod + `main` alineado (`a0d9f0d`)**; smoke `401` +
  validación física (lectura OK con rol de caja). **Ya NO es prerequisito pendiente de la Ola 2.** Pendiente OPCIONAL: prueba
  cross-user (→ `403`). Ver §✅ Accionado 2026-06-28.
- **#2 `monthly-report` sin auth en el cuerpo** + el cliente lo invoca con `fetch` **sin `Authorization`**. **VERIFICAR** en
  el dashboard de Supabase si `verify_jwt` está on/off y si el botón de reporte de prod realmente manda (corre con service-role).
- **#3 falta `supabase/config.toml`** → el `verify_jwt` de las functions no está versionado (no se puede auditar/reproducir).
- **#14 `deploy.yml` sin gate de tests** — corre `tsc -b` (vía `npm run build`) pero **no `vitest`** antes de publicar a prod.
- **#5 `cash_cierres_dia` RLS** — `staging-rls.sql` tiene `using(true)` pero `staging-drift-sync.sql` la dropea; **verificar la
  policy VIVA contra la base** (no se puede desde el repo). Resto del audit de seguridad **parqueado**.

### 🔧 Deep-dive auth / recuperación (parqueado — varios solapan con el PILAR de escalabilidad de auth del PoS)
- **C — watchdog que borra el precache** (`index.html`, 15s): demasiado agresivo; en una red transitoria al boot puede
  borrar el app-shell offline. Propuesta: primero `reg.update()`+reload; wipe de caches solo ante fallo repetido y con red.
- **D — doble refresh de token** (SDK `startAutoRefresh` + `refreshSession` manual en `classifyRealtime`): refresh tokens de
  un solo uso → posible carrera; el lock lo mitiga salvo en el escape lock-free.
- **E — sin latido periódico:** la recuperación depende de que dispare `visibilitychange`/`focus`/`online`; falta un health-tick.
- **F — tormenta de re-suscripciones en `rt:healthy`:** cada `useRealtimeRefetch` re-suscribe a la vez (relevante para el
  PILAR de ~10 dispositivos).
- **H — `loadProfile` re-corre en cada `TOKEN_REFRESHED`** (cada hora + cada resume): query innecesaria.
- **I — doble carga de sesión al boot** (`getSession()` manual + `INITIAL_SESSION` de `onAuthStateChange`).
- **J — `getSession` perpetuo en `/login`** tras logout forzado (background work hasta sesión fresca).

### 🎓 Lección de la sesión
**Arreglar la capa donde está el síntoma, no la de al lado.** El RCA de realtime (máquina de 3 estados) era correcto pero
**incompleto**: el BOOTSTRAP de `useAuth` era el gemelo sin topear y **nadie lo había topeado** → causaba la pantalla negra
una semana después. El síntoma ("no carga / negro") apuntaba al arranque, no a realtime.
