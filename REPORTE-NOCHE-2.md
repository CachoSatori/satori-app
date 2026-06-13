# Reporte noche 2 — fábrica nocturna (4 tandas)

> Guardrails: nada a main, cero PROD, ramas desde staging, merge solo completo con 93+ tests verdes,
> DDL aditivo, sagrados intactos. `main` = `cb100de` (intacto). Las tandas T2/T3/T4 leen este archivo.

---

## ⏰ Jobs programados (launchd) — CARGADOS ✅
`launchctl list | grep satori` muestra los 3 (status 0, esperando su hora):
- `com.satori.T2` → 03:30 · `com.satori.T3` → 05:15 · `com.satori.T4` → 06:45 (hora local CR).
- Cada uno corre `claude --dangerously-skip-permissions -p "$(cat PROMPT-Tn.md)"` en el repo, log en
  `/tmp/satori-Tn.log`. Plists en `~/Library/LaunchAgents/com.satori.T{2,3,4}.plist`.

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
