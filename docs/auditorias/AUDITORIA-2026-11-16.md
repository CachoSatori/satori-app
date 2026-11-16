# Auditoría del proyecto — 16-nov-2026

> **Solo lectura.** No se tocó código, bases, Edge Functions ni PRs. Foto tomada el 16/11 entre las 16:15 y las 16:45
> (hora de Costa Rica) sobre `main` = `064a042` (merge del #228), prod (`yiczgdti…`, ledger 180) y staging
> (`hwiatgic…`, ledger 182). Fuentes: el repo, los *advisors* de Supabase (seguridad y rendimiento), el catálogo de
> Postgres (`pg_policies`, `pg_proc`, `cron.job`, índices; ninguna fila con datos de personas) y la API de GitHub.
> **Repo público:** este documento no trae nombres, montos, correos ni secretos; los hallazgos de seguridad se describen
> sin receta de explotación.

## 1. Resumen ejecutivo

1. **No encontré ningún P0**: hoy nada rompe plata, datos ni seguridad de forma comprobada. Caja, cierres y puente del PoS
   están sanos (0 días sin cierre en 60 días, 0 turnos abiertos colgados, latido del agente al día, sagrados intactos).
2. **Seis P1.** El más urgente para la plata: la cola offline **descarta en silencio** un movimiento de caja si el servidor
   lo rechaza por cualquier motivo que no sea de red (A01).
3. **El mantenimiento diario del Club nunca corrió en prod** (0 corridas desde el 11/11): no vence altas provisionales,
   no purga autoaltas ni contactos, no genera premios (A02). Es el mayor riesgo del piloto.
4. **Autorización por contraseña de gerencia sin tope de intentos** y probando contra todas las cuentas a la vez (A03).
5. **Datos comerciales reales en el repo público** (59 archivos de análisis con ventas y costos) que la guarda de
   privacidad no mira: solo busca un nombre y correos (A04).
6. **Cinco de siete Edge Functions corren código que no está en `main`**; el PR que lo ordena (#61) lleva 8 días
   abierto y la tabla de ESTADO quedó vieja (A05).
7. **La lógica de plata del Club vive en SQL (331 funciones) y el CI no ejecuta ni una**: las baterías se corren a mano (A06).
8. Seguridad de base: sin tablas sin RLS, sin `SECURITY DEFINER` sin `search_path`, sin políticas `true`, sin vistas
   expuestas, buckets privados. La puerta pública del Club (Pages → Worker → base) está bien diseñada.
9. La documentación de arranque se contradice con la realidad en varios puntos (protección de `main`, pruebas en el
   deploy, versiones de Edge, backlog al 11/11) (A14).
10. Ritmo: 27 migraciones y 124 merges en 5 días. Funciona por la disciplina del proceso, pero el margen se acaba: quedan
    17 números en el bloque de pase (A13) y 1 de margen en el tope de eslint.

**Gate medido por esta auditoría** (copia limpia de `064a042`): `vitest run` 2509 pasan / 4 skip (229 archivos) ·
eslint 82 (tope 83). Sagrados por hash de blob: `tipCalculations.ts` `7603ba5a` · `cashUtils.ts` `b597c697` ·
`cierrePozo.ts` `bf22ee44` (iguales a ESTADO).

## 2. Hallazgos

Prioridad: **P0** rompe plata, datos o seguridad hoy · **P1** riesgo alto · **P2** deuda · **P3** mejora.
Esfuerzo: S (≤ medio día) · M (1–2 días) · L (más).

| Id | Pr. | Área | Evidencia | Impacto | Arreglo propuesto | ¿Plata / esquema / sagrados? | ¿Firma? | Esf. |
|---|---|---|---|---|---|---|---|---|
| A01 | P1 | Plata · offline | `src/shared/offline/outbox.ts:79-83` (todo error que no sea de red es `fatal`), `:54-60` (la operación `fatal` se borra de la cola), `:77` (queda solo en el almacén `audit` de IndexedDB de ese aparato). Ninguna pantalla lee ese almacén ni `fatals` (búsqueda en `src/`, sin resultados fuera de `outbox.ts` e `idb.ts`) | Un pago o ingreso cargado sin conexión puede perderse sin aviso si al sincronizar la base responde con sesión vencida, 5xx, 429 o *timeout* de sentencia: la caja queda desbalanceada y nadie se entera. No pude verificar si ya pasó: el registro vive en cada aparato | (1) Clasificar: 401/403 por sesión, 408, 429 y 5xx → `retry`; solo violaciones de regla (`23xxx` distinto de `23505`, `42501`) → `fatal`. (2) Lo `fatal` no se borra: pasa a una bandeja «No se pudo guardar» visible en Caja, con reintento y descarte explícito. (3) Aviso en el Inicio a gerencia | Plata (no sagrados) | Sí | M |
| A02 | P1 | Club · operación | `cron.job`: `club_socios_mantenimiento`, `15 9 * * *`, `active = true`, **0 filas** en `cron.job_run_details` (los otros dos jobs tienen 5 y 6; el último corrió el 15/11). Se agenda en `supabase/migrations/150_club_satori_esquema.sql:5009-5013`; función en `:4969` | Desde el 11/11 no corre: vencimiento de altas provisionales, purga de autoaltas sin validar, purga de contactos de ofertas (plazo prometido en el aviso de privacidad) y `club_premios_generar` (`club_premios` tiene 0 filas). Hoy el daño es nulo (0 provisionales vencidas sin procesar), pero crece con el piloto. Causa no determinada | Diagnosticar en una sesión con acceso (¿corre a mano en transacción descartada? ¿el job quedó registrado fuera del ciclo del *worker*?). Reagendar con `cron.unschedule` + `cron.schedule` y verificar una corrida. Sumar un latido: aviso en el Inicio si la última corrida tiene más de 26 h | Esquema (job) | Sí | S |
| A03 | P1 | Seguridad | `verify_manager_password(text)` en prod (`supabase/migrations/045_verify_manager_by_password.sql:49,77`): `SECURITY DEFINER`, ejecutable por `authenticated` (advisor 0029), compara la contraseña recibida contra **todas** las cuentas de gerencia activas, con una espera fija en el fallo como único freno. Sin contador de intentos ni bloqueo. Además responde distinto cuando dos cuentas comparten contraseña. Protección de contraseñas filtradas apagada (advisor `auth_leaked_password_protection`) | Cualquier cuenta con sesión (salonero, barra) puede probar contraseñas de gerencia en paralelo y sin límite; cada intento fallido retiene una conexión de la base. Con la contraseña se autorizan borrados de movimientos y deshacer cierres | Tabla de intentos por `auth.uid()` con tope y bloqueo temporal (como `club_canje_intentos`), mismo mensaje para todos los fallos, bitácora de autorizaciones fallidas visible al dueño, y encender la protección de contraseñas filtradas. A mediano plazo: PIN de autorización propio por encargado, separado de la contraseña de la cuenta | Esquema | Sí | M |
| A04 | P1 | Privacidad · repo público | `docs/analisis/2026-11-mediodia-localclub/` (59 archivos; `datos/*.csv` con ventas, descuentos y márgenes por mes; `datos/costos/*.xlsx` con costos), su `README.md` con cifras; `src/modules/cash/comprobante.ts:8` (un teléfono con formato real en un comentario); `src/modules/tips/TipCocina.tsx:24,102` (regla por nombre de pila). `src/privacidadRepo.test.ts:22-23,29-34` solo busca un nombre y correos, salta binarios y `supabase/migrations/` | La regla «Repo público» (sin montos reales, nombres ni teléfonos) no se cumple y la guarda no lo detecta. Lo ya publicado queda en el historial de git aunque se borre | (1) Sacar `docs/analisis/…/datos` y las cifras del README al proyecto privado (decisión D3 ya firmada: «montos en un PR chico»; el alcance real es mayor). (2) Decidir si se reescribe el historial o se acepta lo publicado. (3) Ampliar la guarda: teléfonos (+506 / 8 dígitos), cédulas, extensiones `.csv/.xls/.xlsx` fuera de una lista permitida, y lista por hash de nombres del personal | No | Sí (historial) | M |
| A05 | P1 | Operación · Edge | `list_edge_functions` (prod, 16/11): 7 funciones; `supabase/functions/` en `main` tiene 4 carpetas y no hay `supabase/config.toml`. `ingest-ndf`, `alta-empleado` y `club-pase` no están en `main`; `monthly-report` y `extract-document` de `main` son anteriores a lo desplegado (ESTADO, regla 2). ESTADO «Edge Functions (12/11)» dice v12/v10/v4/v4/v4/v3 y prod tiene v20/v19/v12/v12/v12/v11; el hash de `extract-document` en prod (`d2ac367d…`, actualizado el 14/11) no es el documentado (`2f88ef52…`). PR #61 (ítem 11) abierto desde el 08/11 | No se puede reconstruir prod desde `main`; un despliegue desde `main` volvería a `monthly-report` sin control de acceso y dejaría la Bandeja sin leer facturas. No pude verificar qué código corre hoy en `extract-document` (el hash cambió y ningún documento del repo lo explica) | Cerrar el ítem 11 esta semana: traer a `main` el código exacto de las 7 (verificado por hash contra prod), `config.toml` con `verify_jwt` por función, y una prueba del gate que compare la lista de funciones con `config.toml`. Actualizar la tabla de ESTADO con hash y fecha, no con número de versión | No (despliegue) | Sí | M |
| A06 | P1 | Calidad · plata | `.github/workflows/ci.yml` no levanta Postgres; `scripts/sql/` tiene 151 archivos de pruebas y *rollbacks* que se corren a mano. De 229 archivos de prueba, 32 leen texto fuente (10 de ellos, `.sql`) en lugar de ejecutar. ESTADO (16/11) reconoce baterías inválidas por correrse después de aplicar y una que se tragaba su error | Créditos, canjes, topes, vencimientos y permisos por local se validan solo si alguien se acuerda y lo hace bien. Una regresión en una función de plata puede llegar a prod con el gate en verde (ya pasó: la 157 pisó a la 156, *hotfix* 171) | Job de CI con Postgres: `scripts/sql/local_armar_base.sh` + todas las baterías, obligatorio en PRs que tocan `supabase/migrations/` o `scripts/sql/`. Formato único de batería (cada caso falla el job) | No | No | M |
| A07 | P2 | Seguridad · caja | Política `cierre_read` en `cash_cierres_dia`: `auth.role() = 'authenticated'` (prod, `pg_policies`); la restrictiva por local deja pasar a cualquier cuenta activa (`091_multilocal_fase0.sql:99-106`). Igual patrón en `inv_read_ingredients`, `inv_read_recipes`, `inv_read_ri`, `inv_read_mov`. `docs/README.md:26` ya lo listaba abierto en julio («#5 RLS cash_cierres_dia») | Cualquier cuenta activa (salón, barra) puede leer por API los cierres de caja del día. En inventario, además, las cuentas inactivas | Reemplazar por rol activo de caja/gerencia, igual que la 085 hizo con las demás lecturas | Esquema | Sí | S |
| A08 | P2 | Seguridad · caja | Políticas `cash_movements_proveedor_insert` (solo exige tipo y autor), `cash_sessions_proveedor_select` y `suppliers_proveedor_select` (todas las filas) en prod | Riesgo latente: hoy no hay ninguna cuenta con rol proveedor. El día que se cree una, puede insertar movimientos de cualquier monto y estado, y leer todos los turnos | Borrar las tres políticas o acotarlas (estado `pendiente`, su proveedor) antes de dar de alta al primer proveedor | Esquema | Sí | S |
| A09 | P2 | Esquema · *drift* | En prod hay políticas que ninguna migración crea (`cierre_read`, `cierre_write`, `inv_read_*`, las de proveedor…): solo figuran en `staging-drift-sync.sql` (raíz). Funciones en prod sin fuente en `supabase/migrations/`: `handle_updated_at`, `touch_updated_at`, `update_ingredient_stock` (las tres sin `search_path`, advisor 0011). Ledger de prod: 018–021 sin nombre; staging no tiene filas 065 y 066 | Una base armada desde las migraciones (la que usan las baterías locales) no tiene el mismo RLS de caja que prod: las pruebas de permisos pueden dar verde contra algo que no es prod | Migración «esquema como prod» (como la 177 y la 178) que declare esas políticas y funciones sin cambiar prod, y una prueba que compare `pg_policies` y `pg_proc` de una base local con una foto versionada de prod | Esquema (sin efecto en prod) | Sí | M |
| A10 | P2 | Plata · concurrencia | `src/shared/api/cash.ts:98-126` (`createCashSession`) y `src/shared/api/tips.ts:41-65` (`createTipSession`): `insert` sin `client_op_id`; en prod `cash_sessions` y `tip_sessions` no tienen índice único por fecha, turno y local. Datos: 0 grupos duplicados en caja; 1 en propinas (julio) | Doble toque, reintento tras *timeout* o dos aparatos pueden abrir dos turnos iguales; los movimientos se reparten entre ambos | Índice único parcial `(location_id, session_date, shift_type)` y tratar `23505` como «ya abierto» (igual que el cierre, 071) | Esquema · plata | Sí | S |
| A11 | P2 | Seguridad | `information_schema.role_table_grants`: `anon` conserva privilegios en 30 tablas (por ejemplo, todos sobre `profiles`, `cash_cierres_dia`, `documents`, `finance_*`; `INSERT` en `cash_movements`) | Hoy no pasa nada: RLS no deja filas a `anon`. Pero una política mal escrita mañana abre la tabla a internet sin segunda barrera | `revoke all … from anon` en todas las tablas de `public` (el Club entra por funciones); prueba en la batería | Esquema | Sí | S |
| A12 | P2 | Seguridad | `cron.job.command` de los dos jobs de reportes contiene una cabecera de autorización con una llave en claro (verificado por patrón; no leí el valor ni de qué llave se trata) | Quien lea `cron.job` (respaldos, volcados, soporte) obtiene la llave | Pasarla a Vault (`vault.decrypted_secrets`) y rotarla | Esquema | Sí | S |
| A13 | P2 | Operación | Bloque de pase 150–199 (`supabase/migraciones-reservadas.json`); staging ya va por la 182. En 5 días entraron 27 migraciones | Quedan 17 números. Además, toda migración nace en un bloque de creación y se renumera al entrar: trabajo y riesgo de error en cada PR | Asignar ya el bloque siguiente (200–299) y simplificar: número definitivo al abrir el PR, tomado del registro | No | Decisión del dueño | S |
| A14 | P2 | Documentación | `ESTADO.md:16` «Sin regla de protección» (la API muestra protección con el *check* `Gate` obligatorio); `ESTADO.md:462` y `.claude/skills/satori-estandar-pr/SKILL.md:46` «`deploy.yml` no corre `vitest`» (`deploy.yml:36-38` corre `npm test`); `ESTADO.md:186` tickets al 30/10; `ESTADO.md:88` gate de las 00:11; `PROMPT-CONTINUACION.md:1-8` «al día 11/11», «el Club todavía no está en prod», ledger 095; `ROADMAP.md:4` 30/10; `HALLAZGOS.md:1` 30/10 (los hallazgos 230–232 que cita ESTADO no están ahí); `docs/README.md:3` 22/07; la tabla de sagrados de la skill no trae `cierrePozo.ts` | Una sesión nueva arranca con datos falsos: puede creer que no hay gate, o que el Club no está en prod | Un PR de docs (el #231 ya ordena el arranque): corregir estas líneas, mover el backlog viejo a archivo, y que ⚡ARRANQUE deje de repetir lo que se puede medir (gate, protección) | No | No | S |
| A15 | P2 | Calidad · PRs | Abiertos desde el 08–09/11: #60, #61, #63, #70, #73 (estado `dirty`, con conflictos), #75 | Trabajo útil que envejece: #70 son pruebas de caracterización de los sagrados; #73 arregla propinas y caja fuera de sagrados; #75 saca correos del código (pendiente de privacidad) | #61 → A05. #70: rebasar y mergear (solo pruebas). #73: rehacer sobre `main` en PRs chicos o cerrar. #60, #63 y #75: rebasar, revisar y decidir en una sola pasada; lo que no entre en 7 días se cierra con nota | Según PR | Sí (#73) | M |
| A16 | P2 | Plata · fecha | `054_create_supplier_credit.sql:22,85` usa `current_date` (UTC) cuando no llega fecha, y `src/shared/api/cash.ts:907` manda `null` si no la hay. `src/modules/inventario/InvMovimientos.tsx:70` y `src/shared/api/inventario.ts:128` toman la fecha UTC | El mismo error que se arregló hoy en Ventas: desde las 18:00 un saldo a favor de proveedor sin fecha queda con la de mañana. Inventario todavía no se usa | Mandar siempre `todayCR()` desde la app y, en la función, `(now() at time zone 'America/Costa_Rica')::date`. Sumar estos archivos a la guardia de fecha que creó el #222 | Plata (fecha de un crédito) | Sí | S |
| A17 | P2 | Rendimiento | Advisor de rendimiento (prod): 61 claves foráneas sin índice (entre ellas `club_visitas.miembro_id`, `tip_entries.employee_id`, `cash_movements.supplier_id`), 12 políticas que reevalúan `auth.*` por fila, 136 avisos de políticas permisivas duplicadas, 1 índice duplicado (`exchange_rates`), 18 índices sin uso | Con los volúmenes de hoy no se nota. Va a pesar en los reportes del Club y con el segundo local | Una migración: índices para las claves del Club y de caja, `(select auth.uid())` en las 12 políticas, borrar el índice duplicado. Revisar los «sin uso» en un mes | Esquema | Sí | S |
| A18 | P2 | Producto · Bandeja y caja | `ESTADO.md` «Lectura de facturas»: «Agregar» de Caja guarda solo el primer documento de una foto y no detecta duplicados; «Agregar foto» de Proveedores crea el documento vacío sin avisar cuando la lectura falla | Una factura puede entrar dos veces o no entrar, y el cajero no lo ve. Está pospuesto «después del piloto» | Adelantar dos cosas chicas: mostrar el motivo cuando la lectura falla y reutilizar en Caja el control de duplicados de la Bandeja | No (pantallas) | Validación física | M |
| A19 | P2 | Calidad | Módulos sin ninguna prueba: `crm` (1.101 líneas), `resumen` (1.264), `finanzas` (274). eslint 82 de 83, con 74 errores | Cambios en esos módulos pasan el gate sin red. El tope de eslint no deja margen | Prueba de humo por pantalla en los tres; bajar la línea base de eslint de a 10 por semana | No | No | M |
| A20 | P3 | Seguridad | Advisor 0028: `handle_new_user`, `log_movement_edit` y `unif_on_cash_movement` (disparadores) y `get_my_role` ejecutables por `anon`; `club_promo_beneficio` sin `search_path` | Bajo: un disparador no se puede invocar por API y `get_my_role` devuelve nulo sin sesión | `revoke execute … from public, anon` y fijar `search_path` | Esquema | Sí | S |
| A21 | P3 | Esquema · multi-local | `cash_cierres_dia` tiene único por `session_date` solamente (`cash_cierres_dia_session_date_key`) | Conocido (091): bloquea el cierre del segundo local el mismo día | Resolver con la fase de multi-local, con firma de sagrados | Esquema · cierres | Sí | M |
| A22 | P3 | Limpieza | Raíz del repo: `AUDITORIA.md` (junio), `REPORTE-NOCHE-2.md`, `RESUMEN-MAÑANA.md`, `MIGRACIONES-PROD-JUN11.sql`, `staging-rls.sql`, `staging-drift-sync.sql`; `src/modules/prueba/` | Ruido para quien arranca; SQL suelto que parece aplicable | Mover a `docs/historico/` (el SQL, con un encabezado «no aplicar») | No | No | S |

### Lo que revisé y está bien

- **RLS:** las 91 tablas de `public` tienen RLS; 0 políticas con `true`; 0 funciones `SECURITY DEFINER` sin
  `search_path`; la única vista (`club_saldos`) es `security_invoker`; los dos *buckets* son privados.
- **Club público:** las 16 funciones del Club que `anon` puede ejecutar exigen la cabecera secreta que solo conoce el Worker
  (`club_web_ok`: 15 directo y `club_portal` a través de `club_portal_datos`); el Worker falla cerrado sin limitador (503), tiene tope por IP y por red, y Turnstile en alta y cupón
  (`club-web/functions/_lib/api.js`). No hay claves en el repo (búsqueda de JWT, llaves privadas y prefijos conocidos:
  solo valores de prueba generados).
- **Idempotencia:** `client_op_id` único en `cash_movements`, `club_movimientos`, `supplier_credits` y
  `credit_applications`; el cierre del día es atómico (071/074) y único por fecha. Los 38 movimientos sin `client_op_id` de
  los últimos 30 días son todos ingresos a Caja Fuerte, el tipo que escribe el cierre del día
  (`074_cierre_primer_conteo.sql:146-155`, dentro de la transacción del cierre); no rastreé fila por fila su origen.
- **Hora CR en SQL:** las funciones del Club usan `America/Costa_Rica` (59 usos en la 150); solo quedan los casos de A16.
- **Edge:** `verify_jwt` apagado solo en `ingest-ndf` y `club-pase`, las dos con secreto propio según ESTADO (no verifiqué el código desplegado).

### Lo que no pude verificar

- El contenido de la auditoría del 12-nov (está en el proyecto privado, no en el repo).
- El código que corre en cada Edge Function de prod (solo vi versión, fecha y hash).
- Secretos y configuración de Cloudflare (Worker, Pages, *bindings* de límite).
- Si la cola offline ya descartó operaciones reales (A01): el registro está en cada aparato.
- Por qué el job del Club no corre (A02).
- Fricción real en el piso: no hubo observación del personal; lo de producto sale del código y de ESTADO.

## 3. Qué mejoró y qué empeoró desde el 12-nov

Comparación hecha contra lo que el repo permite verificar (el documento del 12-nov no está en el repo).

**Mejoró**
- CI con *check* obligatorio en los PR y pruebas antes de publicar (#133); `main` con protección.
- El Club pasó a prod sin incidentes de plata registrados; permisos por local para el manager (170, 172, 176).
- Bitácora de permisos de Admin (165) con regla «caída = no se cambian roles».
- El repo declara lo que prod ya tenía (177, 178): menos *drift* de columnas.
- «Hoy» en hora de Costa Rica en Ventas (#222), con guardia. Guarda de privacidad para nombre y correos (#221).
- Skills del repo para PR, revisión, migraciones y merge.
- Triage de PRs e issues viejos (9 cerrados el 16/11).

**Empeoró o sigue igual**
- Ítem 11 (Edge en `main`) sigue abierto; ahora son 7 funciones y las versiones documentadas quedaron viejas (A05).
- La superficie SQL creció a 331 funciones en prod sin pruebas automáticas (A06).
- El backlog (`PROMPT-CONTINUACION.md`), el roadmap y HALLAZGOS no se tocaron en su contenido desde el 11/11 y el 30/10 (A14).
- Seis PRs del 08–09/11 siguen abiertos (A15).
- El bloque de numeración de pase se está por agotar (A13).
- El hallazgo de RLS de `cash_cierres_dia` (julio) sigue abierto (A07).

## 4. Riesgos del piloto del Club (para esta semana)

1. **A02**: el mantenimiento diario no corre. Arreglar antes de sumar socios por autoalta.
2. **Ventana de las 23:31**: cuatro PRs y dos migraciones (181, 182) seguidas. Recomendación: una por vez, verificar
   ledger y una función de cada migración antes de la siguiente, y cortar la tanda ante la primera diferencia.
3. **Wallet de Google recién encendido**: falta la prueba de baja; el cron del Worker que vence pases depende de un
   secreto que no pude verificar.
4. **Topes por IP del portal** siguen en el backlog (hallazgo 232).
5. **Sin pruebas automáticas de SQL** (A06) mientras entran dos o tres migraciones del Club por día.

## 5. Plan de dos semanas

**Semana 1 (17–22 nov): cerrar los P1**

| Día | Qué | Hallazgo | Quién |
|---|---|---|---|
| Lun | Diagnóstico y arreglo del job del Club; latido en el Inicio | A02 | Sesión del dueño (Supabase) + agente |
| Lun–Mar | Cola offline: clasificación de errores y bandeja «No se pudo guardar» | A01 | Agente de construcción + verificador independiente |
| Mar | Decisión de privacidad (historial) y PR que saca los datos de análisis; guarda ampliada | A04 | Dueño decide · agente de docs |
| Mié–Jue | Ítem 11: las 7 Edge en `main` + `config.toml` + prueba | A05 | Agente de construcción · firma |
| Jue–Vie | Tope de intentos en la autorización de gerencia + protección de contraseñas filtradas | A03 | Agente de construcción + verificador · firma |
| Vie | Job de CI con Postgres y las baterías | A06 | Agente de construcción |

**Semana 2 (23–29 nov): deuda que protege la plata**

| Qué | Hallazgo |
|---|---|
| Una migración de seguridad: `cierre_read` e inventario por rol, políticas de proveedor, `revoke` a `anon`, disparadores | A07, A08, A11, A20 |
| Único de turnos de caja y de propinas | A10 |
| Fecha CR en saldo a favor e inventario | A16 |
| «Esquema como prod» para políticas y funciones sin fuente + prueba de comparación | A09 |
| Índices y políticas del advisor de rendimiento | A17 |
| Credencial del cron a Vault y rotación | A12 |
| Bloque 200–299 y numeración definitiva al abrir el PR | A13 |
| Docs de arranque al día; raíz ordenada | A14, A22 |
| Pasada única por los PRs viejos | A15 |
| Avisos de lectura de facturas en Caja y Proveedores | A18 |

Todo lo que toca esquema o plata va con firma, staging antes y verificador independiente, por las skills del repo.
