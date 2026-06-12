# REPORTE NOCTURNO — TRAMO 1 (2026-06-12, madrugada)

> Guardrails respetados: **cero contacto con prod** (ni lectura) · **main intacto** ·
> trabajo en rama `pos-f1` → mergeado a `staging` solo completo y verde ·
> DDL aditivo únicamente · sagrados (cashUtils/tipCalculations/cierres) sin tocar.

## Tabla de ítems

| Ítem | Estado |
|---|---|
| Tarea B (transferencias visibles) | ✅ Ya estaba COMPLETA y en staging desde ayer (`0a6b853`) — verificado, nada que terminar |
| Migración multi-local (`locations`) | ✅ COMPLETO (mig 022, seeds Santa Teresa + Nosara) |
| Migración catálogo modificadores | ✅ COMPLETO (mig 022: `modifier_groups`/`modifiers`/`product_modifier_groups` sobre `product_map` sin alterarlo) |
| Migración salón (`salon_tables`) | ✅ COMPLETO (mig 022) |
| Admin → Catálogo PoS | ✅ COMPLETO (grupos, opciones con delta ₡, vínculo a productos, vista previa del salonero con precio en vivo) |
| Admin → Editor de Salón | ✅ COMPLETO (plano por local, mesas con +/- de posición — robusto en tablet —, capacidad/forma/nombre, quitar) |
| Admin → Locales | ✅ COMPLETO (alta/edición + selector de local activo) |
| RLS tablas nuevas | ✅ COMPLETO (patrón real: lectura autenticada, gestión owner/manager con `get_my_role()`) |
| Tests | ✅ 29/29 (20 previos + 9 nuevos de `posPricing`) |
| Seeds demo en staging | ✅ Licor (obligatorio: Flor de Caña +0 / Zacapa +3000 / Bacardí +500), Término, Extras · MOJITO y MOJITO ZACAPA 23 vinculados · 20 mesas ST (mezcla 2/4/6 pax) |
| P3c (estados vacíos) | ⏭ NO INICIADO (presupuesto a F1 sólida, como ordena el prompt) |
| PROMPT-TRAMO-2.md + job programado | ✅ archivo creado · job: ver sección "Tramo 2 programado" |

**Commits**: `01664eb` (F1 completa) sobre `staging` (que ya traía la Tarea B `0a6b853` y el SQL de prod `f06c6d3` en pausa).
**Migraciones aplicadas a staging**: `022_pos_f1_locales_catalogo_salon.sql` (aditiva, registrada).
**Smoke-test en navegador** (staging build, usuario de prueba): pestaña Admin → 🍣 PoS abre; salón muestra las 20 mesas; en Catálogo el grupo obligatorio **bloquea** sin selección y con Zacapa el total da **₡7.500** (4.500 base + 3.000) con "✓ se puede enviar".

## DECISIONES-NOCTURNAS (para revisión de la dueña)
1. **Una sola migración 022** (en vez de 3): mismas tablas, un solo archivo atómico e idempotente.
2. **Una pestaña "🍣 PoS" en Admin** con 3 secciones internas (Salón/Catálogo/Locales) en vez de 3 pestañas — menos invasivo en AdminModule.
3. **Vínculo producto↔grupo por NOMBRE** (`product_map.nombre` es la PK real de la tabla) — mismo patrón que ventas/recetas.
4. **`location_id` solo en tablas NUEVAS**; las existentes (caja/propinas/ventas) se adoptan en F4 con columnas nullable + backfill `santa-teresa` (documentado en la migración). F1 no toca producción.
5. **Posición de mesas con botones ↑↓←→ (pasos de 20px)**, no drag — confiable en tablet; el drag se puede sumar después sin migrar nada.
6. **`test-manager@staging.satori` quedó promovido a OWNER en staging** (para smoke-test de Admin y para que mañana puedas probar sin tus credenciales reales). `verify_manager` sigue aceptándolo para el override. Si lo querés de vuelta como manager: `update profiles set role='manager' where email='test-manager@staging.satori'`.
7. **Vista previa del catálogo usa base de ejemplo ₡4.500** — `product_map` no tiene precio de venta (solo costo); el precio de venta del PoS se definirá en F2/F3 (columna nueva o tabla `pos_prices`). Anotado como decisión de producto pendiente.

## Job de las 05:00 — ACTUALIZADO AL TRAMO 3 (cierre de ventana)
- El job `com.satori.tramo2` ahora ejecuta **PROMPT-TRAMO-3.md** (el 2 ya se hizo a mano) con la
  ruta completa del binario (`~/.local/bin/claude`, launchd no lee .zshrc), `-p` no-interactivo,
  `--dangerously-skip-permissions`, PATH explícito y log en `/tmp/satori-tramo3.log`. **Cargado y
  verificado** (`launchctl list | grep satori`).
- ⚠️ **Falta UN paso de la dueña**: la prueba headless devolvió "Not logged in" (el keychain tiene
  credenciales pero el CLI 2.1.175 no las toma en `-p`). **Antes de dormir o al despertar**: abrir
  Terminal → `claude` → `/login` (una vez). Con eso el job de las 05:00 corre solo. Si no, lanzalo
  a mano: `cd ~/Downloads/satori-app && claude -p "$(cat PROMPT-TRAMO-3.md)" --dangerously-skip-permissions`
- Prueba inofensiva ejecutada: el binario corre por la misma vía del job (la única falla es el login).

## (histórico tramo 1) Tramo 2 programado — ⚠️ requiere lanzamiento manual
- `PROMPT-TRAMO-2.md` en la raíz (contenido exacto de la dueña).
- Job `launchd` **cargado y verificado** (`com.satori.tramo2`, 05:00 hora local = hora CR; log en `/tmp/satori-tramo2.log`). **PERO**: esta Mac **no tiene el CLI `claude` instalado** (esta sesión corre dentro de la app de escritorio, que no expone el binario) → a las 05:00 el job va a dejar en el log el aviso "claude CLI no instalado" y nada más. **El TRAMO 2 hay que lanzarlo a mano al despertar**: abrí Claude Code (app) en este repo y pegale el contenido de `PROMPT-TRAMO-2.md`.
- Alternativa permanente: instalar el CLI (`npm install -g @anthropic-ai/claude-code`, requiere sesión iniciada con `claude login`) y el job de las 05:00 corre solo de ahí en más. Para quitar el job: `launchctl unload ~/Library/LaunchAgents/com.satori.tramo2.plist`.
- Nota de seguridad: el job usa `--dangerously-skip-permissions` (necesario para correr sin nadie frente a la pantalla). Los guardrails quedan a cargo del prompt — revisá el log a la mañana.

---

# REPORTE NOCTURNO — TRAMO 2 (2026-06-12, ~00:30)

> Guardrails intactos: nada a main · cero contacto con prod · Tarea A sigue EN PAUSA ·
> staging solo recibió trabajo completo (builds prod+staging EXIT=0, tests 32/32).

## Tabla de ítems del tramo 2

| Ítem | Estado |
|---|---|
| PROMPT-TRAMO-3.md (guardar, no ejecutar) | ✅ COMPLETO (`7523f42`, contenido exacto de la dueña) |
| Migración pos_orders/pos_order_items + realtime | ✅ COMPLETO (mig 023 aplicada y registrada en staging; pax con CHECK >= 1 en la base) |
| Comandero (tablet) | ✅ COMPLETO mínimo viable (`/comandero`): plano del salón con mesas libres/ocupadas en vivo, pax obligatorio ≥1 (teclado numérico, confirmar bloqueado), badge pax editable, pedido con modificadores (obligatorios bloquean), curso con un tap (default por tipo), asiento 1..pax, marchar por curso o todo, realtime multi-dispositivo |
| KDS | ⏭ NO INICIADO — decisión de presupuesto (orden del prompt: "si solo entra una cosa completa, que sea migración + comandero mínimo"). **Handoff TRAMO 3**: todo lo que necesita ya existe — `pos_order_items.kitchen_status/marched_at` + realtime activo; falta solo la pantalla (ruta /kds, agrupar por comanda, timers verde→rojo, bump → kitchen_status='listo') y el orden de categorías configurable en Admin |
| Tests | ✅ 32/32 (29 + 3 de cursos) |
| Seed demo F2 | ✅ Mesa 1 abierta (pax 4, Test Manager) con MOJITO + Zacapa marchado — verificado en DB |

**Smoke E2E real en navegador**: Mesa 1 → pax 4 (sin pax el botón no deja) → MOJITO → el grupo Licor bloqueó hasta elegir → Zacapa → agregado con asiento y curso Bebida → "Marchar bebidas (1)" → quedó "🔥 en cocina" (DB: kitchen_status='marchado').

## DECISIONES-NOCTURNAS del tramo 2
8. **`base_price_crc = 0` en los ítems** — `product_map` no tiene precio de venta; el TRAMO 3 lo resuelve (su prompt ya lo incluye). El ítem guarda los deltas de modificadores igual (₡3.000 del Zacapa quedó en el pedido).
9. **`product_name` sin FK** en pos_order_items (snapshot): renombrar un producto del catálogo no debe romper pedidos históricos.
10. **Sin tile en Home para /comandero** — la ruta existe y está gateada por rol (owner/manager/cajero/salonero/barman); el tile se decide de día (es la pantalla principal de las tablets, quizá merezca layout propio).

---

# REPORTE NOCTURNO — TRAMO 3 (2026-06-12, ~05:00 madrugada)

> Guardrails intactos: **nada a main · cero contacto con prod (ni lectura)** · Tarea A
> sigue EN PAUSA · sagrados (cashUtils/tipCalculations/cierres) **sin tocar** · DDL
> **aditivo** · todo el trabajo en rama **`pos-f3`** (NO mergeado a staging todavía —
> ver DECISIÓN-NOCTURNA-FISCAL #12 sobre la migración). **Builds prod+staging EXIT=0,
> tests 54/54.**

## Auditoría de apertura
- Estado real: el último commit de la ventana previa (`263aa58`) era **solo docs** — la
  función `computeTotals` que mencionaba **no existía en código**. La migración 024 estaba
  **redactada pero sin trackear** (en disco, no commiteada). O sea: el TRAMO 3 estaba **sin
  empezar** salvo el borrador de SQL. Baseline verde (32/32 tests). Nada a medias que revertir.

## Tabla de ítems del tramo 3

| Ítem | Estado |
|---|---|
| **computeTotals** (modelo fiscal CR) | ✅ `src/shared/utils/posFiscal.ts` — desglose neto/IVA derivado, deltas finales que heredan tax_type, servicio 10% por canal, `SERVICE_CONFIG` centralizado. **12 tests** |
| **KDS `/kds`** | ✅ comandas en vivo por Realtime, ítems por categoría (orden de Admin), timer verde→ámbar→rojo por curso, vistas Salón/Barra vs Delivery, bump por ítem o por comanda (✓ listo → desaparece). Helpers puros con **7 tests** |
| **Precio de venta (Admin)** | ✅ Admin → 🍣 PoS → **Precios**: precio FINAL (IVA incl.) inline, selector de impuesto (default IVA 13%), neto/IVA **solo-lectura** derivados, indicador "N sin precio" + filtro, badge `demo` |
| **Comandero usa precio real** | ✅ carga precios del local, marca "sin precio" en la búsqueda y **bloquea el envío** de ítems sin precio; el ítem guarda base real + tax_type |
| **Cuenta de mesa** (solo lectura) | ✅ botón 🧾 en el pedido → desglose completo (consumo · neto · IVA · servicio 10% · total) vía `computeTotals`, vista por mesa o por asiento. SIN cobro, SIN impresión |
| **Transferencia de mesas** | ✅ botón ↔ → elige salonero → `transferOrder` deja traza en `transfers` jsonb y reasigna `current_salonero_id` (métricas siguen al receptor). Muestra historial de traspasos |
| **Reglas de turno** | ✅ botón 🔒 → `canCloseShift`: turno mañana cierra con mesas abiertas; último turno **bloqueado** listando las mesas vivas. Puro + **3 tests**. Informativo — **no toca la Caja/cierres sagrados** |
| **Config KDS (Admin)** | ✅ Admin → 🍣 PoS → **KDS**: orden de categorías ↑↓ + umbrales del timer por curso (seg) |
| **print-bridge** (spike) | ✅ `print-bridge/` — servicio Node sin deps, HTTP `/print` en LAN → ESC/POS por TCP 9100 (3nStar RPT004), estaciones CAJA/BARRA/SALÓN, modo SIM por defecto, `smoke.js` verde, README de instalación |
| **Realtime en el plano** | ✅ Ya venía del TRAMO 2 — el comandero se suscribe a `pos_orders`+`salon_tables`; una mesa abierta por un salonero se ve ocupada en las demás tablets al instante |
| **Migración 024 aplicada a staging** | ⚠️ **BLOQUEADA** — ver DECISIÓN-NOCTURNA-FISCAL #12. La migración está lista e idempotente; falta aplicarla (paso de la dueña) |

**Commits** (rama `pos-f3`, sobre `staging`): `computeTotals` · F3 base (mig 024 + API + turno) ·
KDS · precios Admin+comandero · cuenta de mesa · transferencias+turno · print-bridge.
**Verde**: `npm run build` y `npm run build:staging` → **EXIT=0**; `npm test` → **54/54**
(32 previos + 22 nuevos: 12 fiscal, 7 KDS, 3 turno). `tsc -b` strict limpio.
*(Nota: `npm run lint` tiene 67 errores **pre-existentes** en todo el repo — patrón de
`load()`/debounce en effects, fast-refresh, etc.; mi código sigue el mismo patrón ya mergeado
en TRAMO 1/2. Lint no es gate de build/deploy; builds y tests sí, y están verdes.)*

## DECISIONES-NOCTURNAS del tramo 3
11. **`computeTotals` en archivo propio** (`posFiscal.ts`), no dentro de `posPricing.ts`: la
    matemática fiscal es la pieza más sensible (toca plata) y merece su propio módulo testeado.
    Sigue siendo **una sola función** como pide la spec.
12. **DECISIÓN-NOCTURNA-FISCAL — base del servicio 10% = PENDIENTE-CONTADORA**: implementado el
    default **10% sobre el subtotal NETO, servicio sin IVA**, todo centralizado en
    `SERVICE_CONFIG` (`src/shared/utils/posFiscal.ts`). Cuando la contadora confirme si la base
    es neto o total-con-IVA y si el servicio lleva IVA, se ajusta **en ese único lugar** (4 líneas)
    y los tests siguen verdes. Salón/barra cobran servicio; delivery NO.
13. **KDS muestra solo `marchado`** (no `listo`): el bump pasa a `listo` y la comanda **desaparece**
    de cocina — coincide con el smoke E2E pedido ("bump → desaparece"). `listo` queda como estado
    "listo para el runner" sin pantalla propia (se decide de día si el KDS quiere una columna "listos").
14. **El KDS ordena por la categoría del producto** (`product_map.tipo`) usando un mapa
    producto→tipo cargado una vez; las categorías fuera del orden configurado van al final.
15. **Transferencia: `salonero_name` visible pasa al receptor**; la apertura original queda
    inmutable en `opened_by` + en la traza `transfers` (de dónde vino). Atribución de métricas
    futura = `current_salonero_id`.
16. **Reglas de turno informativas, NO atadas a la Caja**: el chequeo `canCloseShift` vive en el
    comandero y avisa; **no** modifica el cierre del día (sagrado). El gating real al cierre de
    Caja se cablea de día, con la dueña, cuando se decida cómo se marca "último turno".

## ⚠️ DECISIÓN-NOCTURNA-FISCAL #12 — por qué 024 NO se aplicó a staging
- `supabase db push --linked` (proyecto linkeado = **satori-staging**, verificado) **falló** por
  una **discrepancia PRE-EXISTENTE en el historial de migraciones** alrededor de la `009`
  (filas `0095` + `009` duplicada/desalineada local vs remoto) — **no la introdujo este tramo**.
  La CLI pide `supabase migration repair --status reverted 009`, que **muta la tabla de historial
  de migraciones de la staging compartida**. **No lo ejecuté solo** (es una decisión de la dueña;
  los guardrails dicen "ambigüedad → DECISIÓN-NOCTURNA y seguir", y tocar el historial de una DB
  compartida no es aditivo-seguro). No hay `psql` ni password local para aplicarla por fuera.
- **La migración 024 es 100% idempotente** (`create table if not exists`, `add column if not
  exists`) y **aditiva** — segura de aplicar. Hasta que se aplique, la app **degrada con gracia**
  (las llamadas a `pos_prices`/`pos_kds_settings` están en `try/catch` → no rompe; el comandero
  muestra todo "sin precio" y bloquea pedidos nuevos hasta que haya precios).
- **Por eso `pos-f3` NO se mergeó a `staging`**: mergear el código sin la DB lista degradaría el
  demo del comandero que hoy funciona. Queda listo para que la dueña aplique 024 y luego mergee.

---

# ☀️ CHECKLIST DE LA MAÑANA — DEFINITIVO (3 tramos)

### A) PROD (pendiente de tramos previos — sin cambios este tramo)
1. **PROD**: correr `MIGRACIONES-PROD-OFFLINE.sql` en el SQL Editor de PROD → confirmar **3 filas ok=true**.
2. **Confirmar A.3**: el merge a `main` va **solo hasta `f06c6d3`** (offline + SQL). Decímelo y lo ejecuto.

### B) Aplicar el TRAMO 3 a staging (3 pasos)
3. **Aplicar migración 024 a staging** (resuelve el bloqueo de la DECISIÓN-FISCAL #12). Opción
   simple y segura (es idempotente): abrí el **SQL Editor de staging** y pegá el contenido de
   `supabase/migrations/024_pos_f3_precios_kds_canal.sql` → Run. (Alternativa CLI: arreglar el
   historial con `supabase migration repair --status reverted 009` y luego `supabase db push` —
   pero el SQL editor evita tocar el historial.)
4. **Mergear el código**: `git checkout staging && git merge pos-f3` (builds y tests ya verdes).
   Avisame y lo hago yo, o lo corrés vos. Deploy de staging.
5. **Cargar precios reales**: Admin → 🍣 PoS → **Precios**. Hay 2 demo (MOJITO ₡4.500 / MOJITO
   ZACAPA ₡7.500, marcados `demo`); el resto sale "⚠ sin precio". Cargá los reales (precio FINAL
   con IVA, lo que ve el cliente). El comandero no deja pedir lo que no tenga precio.

### C) Pruebas físicas en staging (login `test-manager@staging.satori` / `staging-test-2026`)
6. **F1 — Catálogo y Salón**: Admin → 🍣 PoS → Editor de Salón (mové una mesa con las flechas) ·
   Catálogo (grupo "Licor": sin licor bloquea, con Zacapa +₡3.000) · Locales (Nosara vacío).
7. **F1.5 — Precios**: cargá un precio a un producto → verificá que el **neto/IVA** se calculan
   solos (IVA 13% → neto = precio/1.13) y son solo-lectura · cambiá el impuesto a "exento" y mirá
   el IVA irse a 0 · el contador "N sin precio" baja al cargar.
8. **F2 — Comandero** (`satori-staging.pages.dev/comandero`): Mesa 1 ya tiene un MOJITO de demo ·
   abrí otra mesa (confirmar SIN pax NO deja) · pedí un producto **con precio** (uno sin precio
   aparece en gris "⚠ sin precio" y no se puede elegir) · marchá · mirá la mesa ponerse roja en
   otra tablet (realtime).
9. **KDS** (`/kds`, abrir en la TV o tablet de barra): marchá desde el comandero → **la comanda
   aparece en /kds** (vista Salón/Barra) · el timer corre (verde→ámbar→rojo según el umbral del
   curso, configurable en Admin → 🍣 PoS → KDS) · tocá un ítem o "✓ Listo toda la comanda" →
   **bump → desaparece**. (Smoke E2E completo: marchar → aparece → bump → desaparece.)
10. **Cuenta de mesa**: en una mesa con ítems tocá 🧾 **Cuenta** → revisá el desglose (consumo ·
    neto · IVA · **servicio 10%** · total) · cambiá a vista "por asiento" · abrí una mesa de
    **delivery** y verificá que **no cobra servicio**. (Solo lectura — sin cobro ni impresión.)
11. **Transferencia de mesas** (2 tablets/usuarios): abrí una mesa con usuario A → ↔ Transferir a
    usuario B → en B la mesa figura a su nombre, con la traza "A → B" · las métricas futuras van a B.
12. **Reglas de turno**: botón 🔒 **Cierre de turno** → con mesas abiertas, "turno mañana" deja
    cerrar y "último turno" **bloquea** listando las mesas. (Por ahora es un aviso; el gate real al
    cierre de Caja se cablea de día.)
13. **Tarea B en staging** (de tramos previos, 7 pasos): Restante → pago por Transferencia →
    "pendiente · no descuenta efectivo" → Restante NO cambia → línea de pendientes → un pago en
    Efectivo sí baja el Restante.

### D) Opcional / cuando haya hardware
14. **print-bridge** (en la mini-PC, cuando la quieras probar): `cd print-bridge && node smoke.js`
    (sale `SMOKE OK` + 2 tickets en pantalla). Con impresora real: seguí el `print-bridge/README.md`
    (IP fija por impresora, `SIM=0 PRINTER_CAJA=ip:9100 … node server.js`, prueba con `curl`).
