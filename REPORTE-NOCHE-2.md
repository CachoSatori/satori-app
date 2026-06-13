# Reporte noche 2 — fábrica nocturna (4 tandas)

> Guardrails: nada a main, cero PROD, ramas desde staging, merge solo completo con 93+ tests verdes,
> DDL aditivo, sagrados intactos. `main` = `cb100de` (intacto). Las tandas T2/T3/T4 leen este archivo.

---

## ⏰ Jobs programados (launchd) — ❌ DISPARARON PERO FALLARON → descargados
Los 3 jobs **sí se dispararon** a su hora (03:30 / 05:15 / 06:45) pero fallaron: dentro del plist el
`$(cat PROMPT-Tn.md)` **no se expandió** → `claude` recibió prompt vacío
(`Error: Input must be provided ... when using --print`, ver `/tmp/satori-Tn.log`). Es el fallo
conocido de launchd con expansión de subshell en el string del plist. **Los descargué**
(`launchctl bootout`) para que NO re-disparen rotos mañana.

**→ T2 y T3 se ejecutaron MANUALMENTE en esta sesión (ver abajo). T4 queda lista para correr a mano:**
```
cd /Users/ismaelgutierrezpechemiel/Downloads/satori-app
/Users/ismaelgutierrezpechemiel/.local/bin/claude --dangerously-skip-permissions -p "$(cat PROMPT-T4.md)" 2>&1 | tee /tmp/satori-T4.log
```
(Nota: buena parte de T4 ya está en staging — alérgenos + EmptyState estética Satori — ver §T4.)

### Respaldo manual (si launchd no dispara — ya pasó antes), correr EN ORDEN en el repo:
```
cd /Users/ismaelgutierrezpechemiel/Downloads/satori-app
/Users/ismaelgutierrezpechemiel/.local/bin/claude --dangerously-skip-permissions -p "$(cat PROMPT-T2.md)" 2>&1 | tee /tmp/satori-T2.log
/Users/ismaelgutierrezpechemiel/.local/bin/claude --dangerously-skip-permissions -p "$(cat PROMPT-T3.md)" 2>&1 | tee /tmp/satori-T3.log
/Users/ismaelgutierrezpechemiel/.local/bin/claude --dangerously-skip-permissions -p "$(cat PROMPT-T4.md)" 2>&1 | tee /tmp/satori-T4.log
```

---

## TANDA 1 — COMPLETA (4/4)

### 1.1 — Fix doble-cobro: ⚠️ EN RAMA, NO MERGEADO (espera revisión de la dueña) — toca plata
**DECISIÓN-NOCTURNA #1 (importante, leer):** el fix de doble-cobro **ya había quedado en `staging`**
en la sesión anterior (commit `c308dfd`, migración 033, RPC atómica + `client_op_id`, verificado
10/10). Tu instrucción de esta noche es mantener el fix de plata **sin merge**. Conflicto real:
- **NO lo revertí de staging.** Revertir el camino del cobro es, en sí, un cambio de plata no
  supervisado de madrugada que **reintroduciría el bug 🔴** en tu entorno de prueba — lo contrario a
  proteger la plata. Y el límite que de verdad protege el dinero (**PROD/main**) sigue **intacto**.
- La rama **`fix-doble-cobro` quedó pusheada** (origin) para tu revisión; el **pase a PROD está
  gateado** a tu OK explícito.
- **Si preferís lo contrario** (sacarlo de staging): decímelo y lo revierto en un commit. Lo dejé así
  porque es lo más cauto con la plata y con tu entorno de prueba.

### 1.2 — Extracción del comandero TERMINADA ✅ (staging)
Modales restantes → `comanderoModals.tsx` (ReabrirModal, ReorderModal, MergeModal, TransferModal,
CuentaView, SplitModal, CheckoutModal, ItemPicker). Puro mover+importar, sin cambio de conducta.
**ComanderoModule.tsx 1284 → 544 líneas** (antes ya 1406→1281 con `comanderoShared`). 93 tests + tsc
+ build verdes. Commit `37b58c8`.

### 1.3 — Estados vacíos elegantes (P3c) ✅ (staging)
Componente `EmptyState` reutilizable (icono + título + pista, tono claro/oscuro) en comandero
(sin mesas / sin resultados / carta sin precio / mesa sin pedido) y KDS (cocina al día). Solo
presentación. Commit `b417632`. (T4 lo va a repintar con la estética Satori oscuro+dorado.)

### 1.4 — Fix rules-of-hooks en MiRendimiento.tsx ✅ (staging)
El early-return del estado vacío estaba ANTES de 6 `useMemo` (hooks condicionales, bug latente). Se
movió DESPUÉS de todos los hooks (ya guardaban con `activeName`). Comportamiento preservado, 0
rules-of-hooks, 93 tests verdes. Commit `9067047`.

---

## Estado al cierre de T1
- `staging`: 1.2 + 1.3 + 1.4 mergeados y pusheados; el fix de cobro de la sesión previa sigue ahí
  (ver DECISIÓN-NOCTURNA #1).
- `main`: intacto (`cb100de`).
- Pendiente para la dueña despierta: **revisar `fix-doble-cobro`** y decidir el pase a PROD del PoS
  completo (migraciones 022-033 consolidadas).

---

## TANDA 2 — COMPLETA ✅ (ejecutada manualmente, en staging)
### 2.1 — Atomicidad de merge/unmerge/reopen (AUDITORIA 🟡)
**Migración 034**: RPC SECURITY DEFINER `pos_merge_orden` / `pos_unmerge_orden` / `pos_reopen_orden`
envuelven las operaciones multi-paso (antes 3-4 statements sueltos → estado parcial si fallaba a
mitad) en UNA transacción. **La matemática NO cambia**: el merge recibe los checks ya calculados por
`splitByGroup` y solo los persiste. Verificado en DB (merge→2 ítems+2 checks; unmerge→ítems vuelven;
reopen→mesa abierta). Commit `d233910`.
### 2.2 — Pausar refetch de Realtime con modal abierto (la preocupación de la dueña) ✅
`useRealtimeRefetch` ahora acepta `pauseWhile()`; el comandero pasa `modalOpen` (picker/checkout/
split/cuenta/transfer/ronda/merge/anular). Mientras hay un modal abierto, el refetch se pospone
(reintenta cada 4s) → la lista NO se refresca bajo los pies del salonero. Commits `f98e73b`/`c124fa0`.
### 2.3 — Limpieza segura restante
Sin deuda material nueva: el código muerto genuino ya se había barrido; lo que marca ESLint es ruido
pre-existente (`_`-prefijos intencionales + módulos legacy). Sin cambios riesgosos.

## TANDA 3 — COMPLETA ✅ (en staging)
Robustez del PoS sin tocar lógica de negocio: **estados de carga inicial** en comandero
("Cargando salón…") y KDS ("Cargando comandas…") para no parpadear el vacío antes de los datos;
**mensajes de error en español claros** ("No se pudo cargar … revisá la conexión y reintentá").
96 tests verdes. Commit `26fb1f3`.

## TANDA 4 — COMPLETA ✅ (en staging) — "mejoras lindas para la dueña"
Auditoría primero: **casi toda la T4 ya estaba en staging** del trabajo en paralelo. Se confirmó
ítem por ítem qué existía y se cerró SOLO lo que faltaba (puro presentación/UX, cero plata/esquema):

| Mejora T4 | Estado | Dónde |
|---|---|---|
| Alérgenos ⚠️ en el **TILE** del grid (de un vistazo, sin abrir) | ✅ ya estaba | `Tile` en comanderoShared (badge ⚠️ arriba-derecha, solo lectura) |
| Alérgenos ⚠️ en picker + qty-popup | ✅ ya estaba | `AllergenLine` + `parseAllergens` |
| **Buscador en vivo** transversal a toda la carta | ✅ ya estaba | `searchTiles` + input "Buscar producto en toda la carta…" |
| **Feedback táctil** `:active` en cada botón | ✅ ya estaba | `.cm-tap` (scale .95 + brillo) |
| **Transiciones suaves** familia→categoría→productos | ✅ ya estaba | `.cm-fade-in` en los 3 niveles |
| **Total SIEMPRE visible** mientras se comanda | ✅ ya estaba | total en header + **barra sticky al pie** `.cm-total-bar` (Satori oscuro+dorado) |
| EmptyState Satori: KDS sin comandas | ✅ ya estaba | `tone="satori"` |
| EmptyState Satori: mesa sin pedido | ✅ ya estaba | `tone="satori"` |
| EmptyState Satori: búsqueda sin resultados | ✅ ya estaba | `tone="satori"` |
| **EmptyState Satori: carta sin precio** | ✅ **cerrado esta corrida** | era tono claro → ahora `satori` |
| **EmptyState Satori: sin mesas en el local** | ✅ **cerrado esta corrida** | era tono claro → ahora `satori` |

Lo único que faltaba eran esos **2 estados vacíos** que aún usaban el tono claro genérico; se
unificaron al variante `satori` ya probado (commit `bef3790`). 105 tests verdes · tsc · build.
*(Nota: el smoke en navegador quedó limitado por un desajuste de raíz del preview vs. el repo; el
componente es el MISMO `EmptyState tone="satori"` ya vivo y verificado en KDS / mesa sin pedido /
búsqueda sin resultados.)*

---

## 🌙 ADEMÁS — 3 prompts grandes de esta sesión (P1/P2/P3)
> Mismos guardrails: nada a main, cero PROD, ramas desde staging, DDL aditivo, sagrados intactos.

### P1 — Propina PoS → Pool 🔒 (rama `propina-pool`, **SIN merge**, espera tu validación)
Conecta `pos_payments.tip_crc` (propina ya capturada en el cobro) al pool del turno **sin tocar
`tipCalculations`** (el reparto no cambia; solo cambia el total que recibe). mig 035 (`pool_pos_crc/usd`
separado del manual + RPC idempotente `sync_pos_tips_to_pool`), botón **"↻ Traer del PoS"** en
Propinas. Verificado end-to-end (suma exacta, no duplica). **DECISIÓN-PRODUCTO abierta:** propina
tarjeta/SINPE al mismo pool (implementado, conservador) vs separado (switch documentado). Reporte:
`ESTADO-PROPINA-POOL.md`.

### P2 — Facturación Electrónica: ESTRUCTURA (rama `fe-estructura`, ✅ mergeada)
mig 036: tabla `fe_documentos` (estado pendiente/emitido/error, tiquete/factura, receptor opcional,
consecutivo/clave, snapshot neto/IVA/servicio/total, **único por pago = idempotente**) + `ciiu/cabys`
en `product_map`. `feProvider` SIM (`emitido-sim`) que **NUNCA llama a Hacienda**. El cobro genera el
documento (si falla, el cobro no se revierte); el ticket muestra datos fiscales; Admin→Productos con
CIIU/CABYS editables + "⚠ pendiente de código fiscal".

### P3 — Inventario Activo F1: depleción por venta + COGS real (rama `inventario-activo`, ✅ mergeada)
Diagnóstico: el inventario (ingredientes/recetas/movimientos + trigger de stock + motor de depleción
+ food cost + alertas por mínimo) **ya existía** → no se duplicó. mig 037: `pos_orders.cogs_crc`.
Al **cerrar el pedido**, descuenta stock por receta (idempotente por pedido; sin receta → no descuenta
y avisa), calcula el **COGS real** y muestra resumen en el ticket. Mecánica DB verificada en staging.

---

## Estado al cierre (T1+T2+T3)
- `staging`: todo mergeado y desplegado — extracción comandero, empty states, rules-of-hooks,
  atomicidad merge/reopen (mig 034), pausar refetch, loading states, + preview T4 (alérgenos/satori).
- `main`: intacto (`cb100de`).
- **fix doble-cobro**: rama `fix-doble-cobro` pusheada, **NO mergeada como cambio nuevo** — pero OJO:
  ya estaba en staging de la sesión previa (DECISIÓN-NOCTURNA #1, arriba). Espera tu revisión para el
  pase a PROD.

## ✅ Checklist de prueba física para la dueña (staging)

### Comandero (T2/T3/T4 — lo "lindo y pro")
1. **Arranca**: entrá a /comandero → mientras carga dice "Cargando salón…", luego el plano. Si el
   local no tiene mesas, ahora ves la **tarjeta oscura de marca** ("Sin mesas en este local").
2. **Alérgenos de un vistazo**: un producto con alérgenos cargados muestra el **⚠️ en el botón del
   grid** (sin abrirlo); al tocarlo, también la línea de detalle en el popup.
3. **Buscador en vivo**: escribí en "Buscar producto en toda la carta…" → filtra al instante por
   todas las familias. Sin resultados → tarjeta de marca "Sin resultados para «…»".
4. **Se siente pro**: cada botón "hunde" al tocarlo; al pasar familia→categoría→productos hay una
   transición suave; el **total de la mesa queda fijo abajo** (barra oscura+dorada) aunque scrollees.
5. **Carta sin precio** (si pasara): muestra la tarjeta de marca, no un vacío genérico.
6. **Combinar/separar mesas** (atómico): combiná dos, mirá las 2 cuentas, separalas → todo o nada.
7. **Reabrir** una mesa cerrada → vuelve a abrirse de una sola vez.
8. **Dos tablets a la vez**: con un modal abierto (cobro/dividir) la lista NO se refresca de golpe.

### Cobro + lo nuevo de esta noche (P2/P3)
9. **Cobro** (sigue igual): cobrá una mesa → ticket y cierre normales. (Anti-doble-cobro ya en
   staging; su pase a PROD espera tu OK.)
10. **Factura electrónica (estructura, SIM)**: al cobrar, el ticket ahora muestra un bloque
    **"TIQUETE ELECTRÓNICO (SIM)"** con consecutivo/clave **simulados** — dice "documento simulado,
    no fiscal". **No se manda nada a Hacienda.** En Admin→Productos hay campos **CIIU/CABYS** con el
    aviso "⚠ pendiente de código fiscal" (los confirma la contadora).
11. **Inventario que se mueve solo**: cargá una receta para un producto, ponéle stock al ingrediente,
    vendé y **cerrá** la mesa → en Inventario el stock **baja según la receta**; el ticket avisa
    cuántos ingredientes se descontaron, el **COGS** del pedido, y si algún producto **no tenía
    receta** o algún ingrediente quedó **bajo stock**.

### Propinas (P1 — en rama, todavía NO en staging)
12. *(Cuando aprobés `propina-pool`)* En Propinas, botón **"↻ Traer del PoS"** trae las propinas
    cobradas del día al pool; el reparto entre el equipo es el de siempre, sobre un total mayor.
    **Falta tu decisión:** propina de tarjeta/SINPE ¿al mismo pool que efectivo o separada?

> `main` intacto (`cb100de`). PROD sin tocar. Todo lo de arriba vive en **staging**, salvo P1
> (rama `propina-pool`) que espera tu visto bueno.
