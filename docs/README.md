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

## 🧭 Handoff — leer en este orden para ponerse al día (handoff 2026-06-25)
1. **[../ESTADO.md](../ESTADO.md)** — foto compacta: ramas (**main `483d29c` intacto**, **staging `14e4546`**), prod vs staging, migraciones, pendientes. **§(b-bis) = el bug de auth recovery (loop `OFFLINE_WAITING` tras suspensión larga) corregido esta sesión, SOLO en staging y GATEADO a validación física.**
2. **[../docs/HANG-RCA-2.md](./HANG-RCA-2.md)** — 🆕 **RCA del 2º cuelgue de auth recovery (lo más caliente).** Hipótesis del lock **DESCARTADA** (red herring, `no adquirido`=0 en todos los logs); causa real = `getSession`/`refreshSession` no vuelven tras suspensión + la máquina no tenía escape; fix = N=3 → `SESSION_EXPIRED` + signOut local + latch one-shot. ⚠️ **Validado solo por unit tests → falta repro físico + suspensión real >1h.**
3. **[../PROMPT-CONTINUACION.md](../PROMPT-CONTINUACION.md)** — backlog priorizado: **§0-bis = el fix de auth recovery (staging, GATED)**, §0.1(b) `createDayMovement` ✅ hecho, §1 plan de pase a prod en olas + ramas de prod (`hotfix/createdaymovement-durability-prod` lista; el hotfix de auth aún por crear). Marca qué espera firma/decisión vs validación física. ⚠️ NUNCA `staging`→`main`: solo cherry-pick.
4. **[../ROADMAP.md](../ROADMAP.md)** — plan por fases con estado real (✅/🟢/🟡/🔲); estabilidad (Olas 1+1.1) ✅ en prod, auth recovery largo 🟡 en staging (gated), Bandeja Etapa 1 ✅ en staging, Etapa 2 diseñada, PILAR de escalabilidad de sesión/auth bloqueante del PoS.
5. **[../docs/rca/2026-06-22-realtime-suspension.md](./rca/2026-06-22-realtime-suspension.md)** — RCA previo de Realtime tras suspensión (§9 = máquina de 3 estados, resolución del caso validado). **Contexto: HANG-RCA-2 construye sobre esta máquina.** Historia más vieja del "se traba" → [../HANG-RCA.md](../HANG-RCA.md) · flujo de mesa → [../SPEC-LAVU-FLUJO-MESA.md](../SPEC-LAVU-FLUJO-MESA.md) · checklist físico PoS → [../REPORTE-NOCHE-2.md](../REPORTE-NOCHE-2.md).

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
