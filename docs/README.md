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
- **[SPEC-propinas-efectivo-electronico.md](./SPEC-propinas-efectivo-electronico.md)** — 🖊️ **FIRMADO ·
  ✅ EN PROD 2026-07-10, validado en piso · SPEC de IMPLEMENTACIÓN** (a diferencia del resto de esta
  carpeta): la **cuenta por pagar de propinas se genera SOLO por la porción electrónica**; el efectivo se lo
  queda el equipo y nunca genera movimiento/pendiente (el *take-home* por empleado no cambia). **mig 046
  (`tip_sessions.pool_barra_electronico_crc`) aplicada out-of-band a STAGING y PROD**; `tipCalculations.ts`
  byte-idéntico. Cerrado.
- **🖊️ SPEC notificación de pago a proveedores** — **NO está en el repo todavía**: vive en el **proyecto de
  Claude** (`claude/SPEC-notificacion-pago-proveedores.md`), esperando firma del dueño. Al firmar y arrancar
  se trae a `docs/` y se enlaza acá. Implica **mig 047** (nueva) + **prerequisito DNS** (remitente propio).
  → PROMPT-CONTINUACION P1 #9 (COLA #1).

## 🔬 Research — comparativa de PoS (✅ FIRMADO por el dueño 2026-07-10)
Comparativa de **6 sistemas PoS** → gap analysis contra el ROADMAP de Satori. **FIRMADO**: lista de 6,
veredictos A–E, descartes D1–D4 y priorización (la **ejecución de cada ítem C sigue pidiendo firma** al
implementar). En `docs/research/`:
- **[research/00-MARCO.md](./research/00-MARCO.md)** — Fase 0: marco de comparación y criterios de selección de los 6.
- **[research/01-FICHAS.md](./research/01-FICHAS.md)** — fichas por sistema (features, pricing, límites, con fuente).
- **[research/02-MEJORES-PRACTICAS.md](./research/02-MEJORES-PRACTICAS.md)** — mejores prácticas transversales, con fuente verificada.
- **[research/03-GAP-ANALYSIS.md](./research/03-GAP-ANALYSIS.md)** — 🖊️ **FIRMADO** · gap vs ROADMAP: dónde Satori
  ya es superior (A), qué valida el mercado (B), qué replicar/mejorar (C1–C5), descartes (D1–D4), y (E).

## En la raíz del repo (specs previos, se conservan donde estaban)
- **[../SPEC-LAVU-FLUJO-MESA.md](../SPEC-LAVU-FLUJO-MESA.md)** — flujo de mesa Lavu vs Satori
  (21 funciones, semáforo de paridad de la COMANDA; ya casi todo ✅).
- **[../SPEC-COMANDERO-UX.md](../SPEC-COMANDERO-UX.md)** — UX del display del salonero
  (Lavu/Toast/TouchBistro/Square), auditoría de callejones sin salida y backlog P0/P1/P2.

## Leyenda de encaje
- 🟢 ya implementado en Satori · 🟡 valioso y razonable de hacer · 🔵 futuro / depende de decisión.
- ⏳ pendiente de profundizar/decidir (aplica a todo: nada se implementa desde estos docs).

## 🧭 Handoff — leer en este orden (actualizado 2026-07-17 — ✅ todo lo operativo EN PROD y validado en piso; ventana de estabilización CERRADA)
1. **[../ESTADO.md](../ESTADO.md)** — foto compacta: ramas (**main = `880c863`** en PROD con TODO lo no-PoS; **staging = `8c41965`** = dev, único diferencial = el PoS), §(b) prod vs staging, §(c) migraciones (prod ledger **≤021 + 038–046 + subset 026 out-of-band**; staging **022–038 + 039–046**; 🆕 migración de histórico CANCELADA en staging — 2 backups `*_pre_migracion_2026_07` 30 días), §(d) build por módulo, §(e) plata/validación (⏳ smoke real de C3), §(f) humanos/fiscales/técnicos. Detalle histórico → `ESTADO-ARCHIVO.md` (bloque 2026-07-09→17).
2. **[../PROMPT-CONTINUACION.md](../PROMPT-CONTINUACION.md)** — backlog vigente. **Arriba: la 🆕 COLA ACTUAL (orden del asesor 2026-07-17)** — (1) SPEC notificación de pago a proveedores (firma pendiente; mig 047 + DNS) · (2) edición de propinas por CAJERO con gerencia (firmado) · (3) reconciliación del ledger (plan read-only primero) · (4) hora-CR · (5) DNS SiteGround · (6) FE-CR + diseño del PILAR (C4/C5/B1). **⏳ smoke real de C3** pendiente del dueño. **RITUAL del link: `cat supabase/.temp/project-ref`**; si `db query --linked` cuelga → **curl a la Management API** (`api.supabase.com/v1/projects/<ref>/database/query`, token del Keychain, servicio `Supabase CLI`).
3. **[../ROADMAP.md](../ROADMAP.md)** — plan por fases. Nota autoritativa 2026-07-17 arriba: toda la ola + propinas ef/elec + cierre ventas-0 + Proveedores simplificado + quick-wins C2/C3 están **EN PROD** (`880c863`); el **plan de 3 OLAS quedó ✅ COMPLETADO**. El **PILAR de auth** sigue bloqueante del **GRAN PASE del PoS** — lo único solo-en-staging (migs 022–037).
4. **[./SPEC-unificacion-bandeja-caja.md](./SPEC-unificacion-bandeja-caja.md)** — el SPEC v1 firmado del módulo ya construido **y en prod**: §7 máquina de estados, §8 invariantes, §11 contable (Opción A), §12 borrado, §18 decisiones firmadas, **§19 visión futura (P&L granular)**.
5. **[../HALLAZGOS.md](../HALLAZGOS.md)** — backlog triado. **Sigue abierto (relevante a la cola):** #2 `monthly-report` sin auth (patrón a NO repetir — `cierre-email` ya lo hace bien), #5 RLS `cash_cierres_dia`, #3 `config.toml`, #14 deploy sin gate de tests. Contexto histórico: `saldoCajaFuerte` sin ancla · migración de histórico revertida en staging · convención de ventas CERRADA · déficit USD de CF (−$2678) · edición de pagos = delete_cascade+recreate · `project-ref` reemplaza a `linked-project.json` (⚠⚠ el CLI puede quedar enlazado a PROD — ritual del link).

> **🖊️ Nota SPEC pendiente (fuera del repo):** el **SPEC de notificación de pago a proveedores** (COLA #1) vive en el **proyecto de Claude** (`claude/SPEC-notificacion-pago-proveedores.md`), NO en `docs/`. Se trae al repo al firmarse. Igual que `ESTADO-PROPINA-POOL.md` (solo en la rama `propina-pool`), no está en la rama actual **a propósito**.

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
