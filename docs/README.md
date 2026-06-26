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

## 🧭 Handoff — leer en este orden (handoff 2026-06-26)
1. **[../ESTADO.md](../ESTADO.md)** — foto compacta: ramas (**main `79d8004`** = pantalla negra + durabilidad `createDayMovement` EN PROD; **staging `a3dfacf`**), prod vs staging, migraciones. **§(b-quater) = lo de ESTA sesión** (IDOR de `extract-document` cerrado + borrado→cascada de inventario, mig 039) con la **nota de la mig 039 aplicada por dashboard** (no en `schema_migrations`) y la **sub-decisión abierta de la foto**. §(b-ter) pantalla negra (en prod + receta). §(b-bis) auth-recovery (🟡 gated). §(g) pendientes + próximo proyecto.
2. **[../PROMPT-CONTINUACION.md](../PROMPT-CONTINUACION.md)** — el PLAN: **§0-quater** = lo de esta sesión (IDOR + mig 039, ambos SOLO en staging). **★ PRIORIDAD 1** = pases de prod pendientes (auth-recovery gated + IDOR + mig 039). Ola 2 = Bandeja Etapa 1 + mig 038 (el IDOR, su prerequisito, **ya cerrado en staging** — falta pasarlo a prod). **🆕 PRÓXIMO PROYECTO:** SPEC de la unificación Bandeja↔Caja (solo diseño). ⚠️ NUNCA `staging`→`main`: solo cherry-pick.
3. **[../ROADMAP.md](../ROADMAP.md)** — plan por fases (✅/🟢/🟡/🔲): estabilidad (Olas 1+1.1) + pantalla negra + `createDayMovement` ✅ en prod; IDOR + mig 039 ✅ en staging; **§1ter = el próximo proyecto (unificación Bandeja↔Caja, arranca por diseño)**; PILAR de escalabilidad de auth bloqueante del PoS.
4. **[../HALLAZGOS.md](../HALLAZGOS.md)** — backlog triado de las auditorías: seguridad (**#1 IDOR en `extract-document` = ✅ CERRADO en staging esta sesión, falta pase a prod**, #2 monthly-report, #3 config.toml, #14 deploy sin gate de tests, #5 cash_cierres_dia), Hallazgo B (drain del outbox en `SIGNED_IN`), deep-dive de auth (C/D/E/F/H/I/J), falta de entorno DOM para tests.
5. **[../docs/HANG-RCA-2.md](./HANG-RCA-2.md)** — RCA del auth-recovery (loop `OFFLINE_WAITING` tras suspensión larga, 🟡 pendiente de pase a prod GATEADO): lock = red herring; causa real = el fetch de auth no vuelve + máquina sin escape. RCA realtime previo → [rca/2026-06-22-realtime-suspension.md](./rca/2026-06-22-realtime-suspension.md) · historia vieja del "se traba" → [../HANG-RCA.md](../HANG-RCA.md).

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
