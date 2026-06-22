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

## En la raíz del repo (specs previos, se conservan donde estaban)
- **[../SPEC-LAVU-FLUJO-MESA.md](../SPEC-LAVU-FLUJO-MESA.md)** — flujo de mesa Lavu vs Satori
  (21 funciones, semáforo de paridad de la COMANDA; ya casi todo ✅).
- **[../SPEC-COMANDERO-UX.md](../SPEC-COMANDERO-UX.md)** — UX del display del salonero
  (Lavu/Toast/TouchBistro/Square), auditoría de callejones sin salida y backlog P0/P1/P2.

## Leyenda de encaje
- 🟢 ya implementado en Satori · 🟡 valioso y razonable de hacer · 🔵 futuro / depende de decisión.
- ⏳ pendiente de profundizar/decidir (aplica a todo: nada se implementa desde estos docs).

## 🧭 Handoff — leer en este orden para ponerse al día (handoff 2026-06-22)
1. **[../ESTADO.md](../ESTADO.md)** — foto compacta: ramas (main `ff836a0`, staging `23c6bc8`), prod vs staging, migraciones (038 aplicada en staging; ⚠ 035 flaggeada), pendientes. **Incluye los 2 fixes ya en PROD (SW + fechas) y la saga Realtime/candado de auth (jun-22, solo staging — PROD aún con el bug vivo).**
2. **[../ROADMAP.md](../ROADMAP.md)** — plan por fases con estado real (✅/🟢/⏳/🔲); fixes SW+fechas ✅ en prod, fix Realtime/candado 🟢 en staging (pendiente canario), Bandeja Etapa 1 ✅ en staging, Etapa 2 diseñada, PILAR de escalabilidad de sesión/auth marcado bloqueante del PoS.
3. **[../PROMPT-CONTINUACION.md](../PROMPT-CONTINUACION.md)** — backlog priorizado: **ítem 0 = canario a PROD del fix Realtime/candado** → pilar escalabilidad → hora-CR bordes → 404 menor → mig 035 → Etapa 2. Marca qué espera firma/decisión vs validación física.
4. **[../HANG-RCA.md](../HANG-RCA.md)** — historia técnica del "se traba" / cuelgues: capa de auth + Realtime, candado `navigator.locks`, la saga round 1 / round 2 (revertido) / fix de contención.
5. **[../SPEC-LAVU-FLUJO-MESA.md](../SPEC-LAVU-FLUJO-MESA.md)** — fuente de verdad del flujo de mesa/comanda (semáforo de paridad). Trabajo PoS previo + checklist físico → [../REPORTE-NOCHE-2.md](../REPORTE-NOCHE-2.md).

> **RCA cerrados (jun-21):** [../_handoff/PROD-SW-RCA.md](../_handoff/PROD-SW-RCA.md) (SW viejo en prod →
> updateViaCache + version.json) · [../_handoff/RCA-FECHAS-BORDE.md](../_handoff/RCA-FECHAS-BORDE.md)
> (400 por `-31` en reportes → helper `monthRangeBounds`). Ambos arreglos en prod.
> **Saga Realtime/candado de auth (jun-22):** [../HANG-RCA.md](../HANG-RCA.md) — resuelta en staging,
> **pendiente canario a prod**.
>
> Otros relacionados: `ESTADO-ARCHIVO.md` (changelog histórico), `ESTADO-PROPINA-POOL.md` (solo en la rama
> `propina-pool`), `_handoff/038-apply.log` (aplicación mig 038 + discrepancia 035), `AUDITORIA-CONSOLIDACION.md`,
> `OFFLINE.md` / `STAGING.md` / `HANG-RCA.md` (infraestructura).
