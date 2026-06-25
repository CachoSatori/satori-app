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

## 🧭 Handoff — leer en este orden para arrancar el PASE A PROD (handoff 2026-06-25, cierre)
1. **[../ESTADO.md](../ESTADO.md)** — foto compacta: ramas (**main `483d29c` intacto**, **staging `ee5878a`**, lineal), prod vs staging, migraciones (ninguna nueva). **§(b-ter) = la PANTALLA NEGRA del bootstrap, ✅ VALIDADA en staging → PRIORIDAD 1 de pase a prod.** §(b-bis) auth-recovery (🟡 gated). §(g) los 3 pendientes de prod.
2. **[../PROMPT-CONTINUACION.md](../PROMPT-CONTINUACION.md)** — el PLAN del pase: **§0-ter** (fix pantalla negra, validado) + **★ PRIORIDAD 1** = hotfix NUEVO desde `main`, cherry-pick `0adf30e`+`f0f8127`+`8bed794` (**NO** `ee5878a`), firma de la dueña + ritual (`version.json.commit`), coordinado con `createDayMovement` (`399fc0b`) y auth-recovery (`e0df9ae`+`14e4546`, gated). **★ PRIORIDAD 2** = Hallazgo B (drain del outbox en `SIGNED_IN`). ⚠️ NUNCA `staging`→`main`: solo cherry-pick.
3. **[../docs/HANG-RCA-2.md](./HANG-RCA-2.md)** — RCA del auth-recovery (loop `OFFLINE_WAITING` tras suspensión larga): lock = red herring; causa real = el fetch de auth no vuelve + máquina sin escape. **Contexto del gemelo:** el BOOTSTRAP de `useAuth` era el OTRO gemelo sin topear → la pantalla negra (§b-ter de ESTADO).
4. **[../HALLAZGOS.md](../HALLAZGOS.md)** — backlog triado de las auditorías: seguridad (**#1 IDOR en `extract-document` = PRE-REQUISITO de la Ola 2/Bandeja**, #2 monthly-report, #3 config.toml, #14 deploy sin gate de tests, #5 cash_cierres_dia), Hallazgo B, deep-dive de auth (C/D/E/F/H/I/J), falta de entorno DOM para tests, y la lección de la sesión.
5. **[../ROADMAP.md](../ROADMAP.md)** — plan por fases (✅/🟢/🟡/🔲); pantalla negra ✅ validado en staging, estabilidad (Olas 1+1.1) ✅ en prod, Bandeja Etapa 1 ✅ en staging, PILAR de escalabilidad de auth bloqueante del PoS. RCA realtime previo → [rca/2026-06-22-realtime-suspension.md](./rca/2026-06-22-realtime-suspension.md) · historia vieja del "se traba" → [../HANG-RCA.md](../HANG-RCA.md).

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
