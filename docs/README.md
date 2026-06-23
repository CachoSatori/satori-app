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

## 🧭 Handoff — leer en este orden para ponerse al día (handoff 2026-06-23)
1. **[../ESTADO.md](../ESTADO.md)** — foto compacta: ramas (main `04b1a32`, staging `90099fb`), prod vs staging, migraciones (038 aplicada en staging; ⚠ 035 flaggeada), pendientes. **Incluye los 2 fixes ya en PROD (SW + fechas) + la saga Realtime/candado de auth ✅ canariada a prod + el fix de re-auth de Realtime tras suspensión (jun-23, solo staging, blindaje validado).**
2. **[../docs/rca/2026-06-22-realtime-suspension.md](./rca/2026-06-22-realtime-suspension.md)** — RCA de Realtime tras suspensión: diagnóstico final (desync token HTTP↔socket **+ auth-ops zombi que cuelgan la recuperación**), el blindaje por timeout implementado y qué falta validar (revive-on-timeout). **Lectura clave si tocás Realtime.**
3. **[../ROADMAP.md](../ROADMAP.md)** — plan por fases con estado real (✅/🟢/⏳/🔲); fixes SW+fechas+Realtime/candado ✅ en prod, fix Realtime/suspensión 🟡 implementado en staging (blindaje validado), Bandeja Etapa 1 ✅ en staging, Etapa 2 diseñada, PILAR de escalabilidad de sesión/auth bloqueante del PoS.
4. **[../PROMPT-CONTINUACION.md](../PROMPT-CONTINUACION.md)** — backlog priorizado: **ítem 0 = validación limpia del revive-on-timeout → borrar `[rt-diag]` + pase a main** → pilar escalabilidad → hora-CR bordes → mig 035 → Etapa 2. Marca qué espera firma/decisión vs validación física.
5. **[../HANG-RCA.md](../HANG-RCA.md)** — historia técnica del "se traba" / cuelgues: capa de auth + Realtime, candado `navigator.locks`, la saga round 1 / round 2 (revertido) / fix de contención. Flujo de mesa/comanda → [../SPEC-LAVU-FLUJO-MESA.md](../SPEC-LAVU-FLUJO-MESA.md) · checklist físico PoS → [../REPORTE-NOCHE-2.md](../REPORTE-NOCHE-2.md).

> **RCA cerrados (jun-21):** [../_handoff/PROD-SW-RCA.md](../_handoff/PROD-SW-RCA.md) (SW viejo en prod →
> updateViaCache + version.json) · [../_handoff/RCA-FECHAS-BORDE.md](../_handoff/RCA-FECHAS-BORDE.md)
> (400 por `-31` en reportes → helper `monthRangeBounds`). Ambos arreglos en prod.
> **Saga Realtime/candado de auth (jun-22):** [../HANG-RCA.md](../HANG-RCA.md) — resuelta y **✅ canariada a prod**.
> **Realtime tras suspensión (jun-23):** [rca/2026-06-22-realtime-suspension.md](./rca/2026-06-22-realtime-suspension.md) —
> fix implementado en staging, blindaje validado, revive-on-timeout pendiente de validación limpia.
>
> Otros relacionados: `ESTADO-ARCHIVO.md` (changelog histórico), `ESTADO-PROPINA-POOL.md` (solo en la rama
> `propina-pool`), `_handoff/038-apply.log` (aplicación mig 038 + discrepancia 035), `AUDITORIA-CONSOLIDACION.md`,
> `OFFLINE.md` / `STAGING.md` / `HANG-RCA.md` (infraestructura).
