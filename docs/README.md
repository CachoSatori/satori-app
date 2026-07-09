# 📚 Índice de specs de investigación — PoS Satori

Documentos de **investigación y decisión** (no son implementación). Fuente de verdad para
profundizar cada punto **antes** de ejecutarlo. Todos los ítems están marcados como pendientes de
profundizar/decidir; nada acá implementa nada por sí solo.

## En `docs/` (esta carpeta)
- **[SPEC-LAVU-OPERACION.md](./SPEC-LAVU-OPERACION.md)** — Lavu vs Satori en OPERACIÓN: caja diaria
  (Till-In/Out, fondo firmado, corte del día, denominaciones, varianza), proveedores (Paid-Out,
  depósito a banco/Vault, puente factura→inventario→costo→margen), cierres (Expected vs Actual vs
  Reconciliation=0, cajón vs banco de salonero), KDS (expo/pase, conteos, bump bar), inventario
  (depletion, PO, FIFO/caducidad, teórico vs real).
- **[SPEC-COMPETIDORES-PoS.md](./SPEC-COMPETIDORES-PoS.md)** — Toast / Square / TouchBistro paso a
  paso (comanda + operación): firing Hold/Stay/Send, coursing, fire-by-prep-time, expediter, 86,
  revenue centers, Comp vs Void, split check vs split payment, daypart, plano color-coded, offline
  híbrido, fotos/alérgenos/maridajes. Cada feature con encaje 🟢/🟡/🔵 + fuente.
- **[SPEC-COMANDA-GAPS.md](./SPEC-COMANDA-GAPS.md)** — 3 gaps priorizados para decidir:
  **Comp vs Void** (P&L), **fire-by-prep-time** (el campo prep ya existe), **revenue centers**
  (venta por área salón/barra/terraza).
- **[SPEC-unificacion-bandeja-caja.md](./SPEC-unificacion-bandeja-caja.md)** — ✅ **v1, decisiones de diseño
  FIRMADAS (2026-06-26)**: colapsar Bandeja y Caja Diaria en un **único "Agregar"**; auto-clasificar
  Proveedores/Operativa como **ayuda visual** (el humano confirma); sacar "Ingresar a inventario" del cajero →
  **contador/manager** lo completa en Inventarios; asiento contable automático. **SOLO diseño** (no autoriza código).
  Subsume la "Bandeja — Etapa 2" del ROADMAP (D6).
- **[SPEC-propinas-efectivo-electronico.md](./SPEC-propinas-efectivo-electronico.md)** — 🖊️ **FIRMADO
  (2026-07-09) · SPEC de IMPLEMENTACIÓN** (a diferencia del resto de esta carpeta): la **cuenta por pagar
  de propinas se genera SOLO por la porción electrónica**; el efectivo se lo queda el equipo y nunca genera
  movimiento/pendiente (el *take-home* por empleado no cambia). Rama `feat/propinas-efectivo-electronico`
  lista; **mig 046 pendiente de aplicar a staging con firma**; `tipCalculations.ts` byte-idéntico.
  Backlog → PROMPT-CONTINUACION P2 #6.

## En la raíz del repo (specs previos, se conservan donde estaban)
- **[../SPEC-LAVU-FLUJO-MESA.md](../SPEC-LAVU-FLUJO-MESA.md)** — flujo de mesa Lavu vs Satori
  (21 funciones, semáforo de paridad de la COMANDA; ya casi todo ✅).
- **[../SPEC-COMANDERO-UX.md](../SPEC-COMANDERO-UX.md)** — UX del display del salonero
  (Lavu/Toast/TouchBistro/Square), auditoría de callejones sin salida y backlog P0/P1/P2.

## Leyenda de encaje
- 🟢 ya implementado en Satori · 🟡 valioso y razonable de hacer · 🔵 futuro / depende de decisión.
- ⏳ pendiente de profundizar/decidir (aplica a todo: nada se implementa desde estos docs).

## 🧭 Handoff — leer en este orden (actualizado 2026-07-04 — ✅ pase a prod hecho)
1. **[../ESTADO.md](../ESTADO.md)** — foto compacta **post-pase**: ramas (**main `92c0831`** en PROD con toda la ola 2026-07 + Bandeja + unificación, **SIN PoS**; **staging `1daef0c`** = dev con PoS), §(b) prod vs staging (**la unificación entera ya está en prod**), §(c) migraciones (prod ledger **≤021 + 038–045 out-of-band**; ambos entornos con deuda de ledger), §(d) build por módulo, §(e) **pendientes de plata/humanos** (smoke físico + sinceramiento USD en prod PENDIENTES), §(f) **deuda técnica**. Detalle del pase → `ESTADO-ARCHIVO.md` (bloque 2026-07-04).
2. **[../PROMPT-CONTINUACION.md](../PROMPT-CONTINUACION.md)** — backlog vigente **por prioridad (P0–P3)**: **P0** estabilización post-pase (smoke físico + sinceramiento USD en prod) · **P1** deuda corta (reconciliación del ledger — ahora en AMBOS entornos —, rotar 2 tokens GitHub vencidos, hora-CR en bordes de período) · **P2** decisiones de producto (Etapa 2 Bandeja, `propina-pool`, foto de comprobante al pagar propina) · **P3** pilar de sesión/auth + gran pase del PoS (diferido). El plan viejo del pase quedó como referencia histórica. **RITUAL del link: `cat supabase/.temp/project-ref`**; 🆕 si `db query --linked` cuelga → **curl a la Management API** (`api.supabase.com/v1/projects/<ref>/database/query`, token del Keychain).
3. **[../ROADMAP.md](../ROADMAP.md)** — plan por fases: los Tiers de la ola (0/2.1/3, Opción B, propinas vía real, tema claro) y la **unificación Bandeja↔Caja** están **EN PROD** (`92c0831`); el **plan de 3 OLAS quedó ✅ COMPLETADO** (Ola 2/3 subsumidas por el pase único). El **PILAR de escalabilidad de auth** sigue bloqueante del **GRAN PASE del PoS** — lo único que queda solo en staging (migs 022–037).
4. **[./SPEC-unificacion-bandeja-caja.md](./SPEC-unificacion-bandeja-caja.md)** — el SPEC v1 firmado del módulo ya construido: §7 máquina de estados, §8 invariantes, §11 contable (Opción A), §12 borrado, §18 decisiones firmadas, **§19 visión futura (P&L granular)**.
5. **[../HALLAZGOS.md](../HALLAZGOS.md)** — backlog triado + **🆕 Hallazgos 2026-07-03:** faltante fantasma (causa raíz + enterrado), déficit histórico USD de CF (−$2678, staging reconciliado / prod pendiente), la edición de pagos es delete_cascade+recreate, el modelo IA es una env var, **🔄 cambio de ritual: `project-ref` reemplaza a `linked-project.json`**. **⚠⚠ aprendizaje crítico: el CLI puede quedar enlazado a PROD (ritual del link)**. **Sigue abierto:** #2 `monthly-report` sin auth, #3 `config.toml`, #14 deploy sin gate de tests, #5 RLS `cash_cierres_dia`.

> RCAs de referencia: auth-recovery → [./HANG-RCA-2.md](./HANG-RCA-2.md) · Realtime tras suspensión → [rca/2026-06-22-realtime-suspension.md](./rca/2026-06-22-realtime-suspension.md) · `/caja` Cmd+Shift+R → RCA en la rama `rca/caja-hardreload-hang` (sin mergear, no está en staging) · historia vieja del "se traba" → [../HANG-RCA.md](../HANG-RCA.md).

> **RCA cerrados (jun-21):** [../_handoff/PROD-SW-RCA.md](../_handoff/PROD-SW-RCA.md) (SW viejo en prod →
> updateViaCache + version.json) · [../_handoff/RCA-FECHAS-BORDE.md](../_handoff/RCA-FECHAS-BORDE.md)
> (400 por `-31` en reportes → helper `monthRangeBounds`). Ambos arreglos en prod.
> **Saga Realtime/candado de auth (jun-22):** [../HANG-RCA.md](../HANG-RCA.md) — resuelta y **✅ canariada a prod**.
> **Realtime tras suspensión (jun-22→24):** [rca/2026-06-22-realtime-suspension.md](./rca/2026-06-22-realtime-suspension.md) —
> **✅ CERRADO: RESUELTO Y VALIDADO en staging** (máquina de 3 estados + gateo del emit + endurecimiento `SESSION_EXPIRED`, §9 del RCA).
>
> Otros relacionados: `ESTADO-ARCHIVO.md` (changelog histórico), `ESTADO-PROPINA-POOL.md` (solo en la rama
> `propina-pool`), `_handoff/038-apply.log` (aplicación mig 038 + discrepancia 035), `AUDITORIA-CONSOLIDACION.md`,
> `OFFLINE.md` / `STAGING.md` / `HANG-RCA.md` (infraestructura).
