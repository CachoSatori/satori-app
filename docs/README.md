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
  Subsume la "Bandeja — Etapa 2" del ROADMAP (D6). **🆕 Construido hasta F4.1 en staging** (ver ESTADO/ROADMAP).
- **[auth-borrado-casos.md](./auth-borrado-casos.md)** — 🆕 matriz de **casos de prueba del borrado con autorización de
  gerencia** (mig 044): autorización (cajero+credenciales / owner-manager / inválidas / rol no gerencial), red/estado
  (offline, timeout), UX del modal y cascada (reversa de asiento, descarte de tarea, doc huérfano), + contrato del
  frontend. Cada caso marcado [auto]/[manual] + consulta legible de `movement_deletions` para el contador.

## En la raíz del repo (specs previos, se conservan donde estaban)
- **[../SPEC-LAVU-FLUJO-MESA.md](../SPEC-LAVU-FLUJO-MESA.md)** — flujo de mesa Lavu vs Satori
  (21 funciones, semáforo de paridad de la COMANDA; ya casi todo ✅).
- **[../SPEC-COMANDERO-UX.md](../SPEC-COMANDERO-UX.md)** — UX del display del salonero
  (Lavu/Toast/TouchBistro/Square), auditoría de callejones sin salida y backlog P0/P1/P2.

## Leyenda de encaje
- 🟢 ya implementado en Satori · 🟡 valioso y razonable de hacer · 🔵 futuro / depende de decisión.
- ⏳ pendiente de profundizar/decidir (aplica a todo: nada se implementa desde estos docs).

## 🧭 Handoff — leer en este orden (actualizado 2026-06-27)
1. **[../ESTADO.md](../ESTADO.md)** — foto compacta: ramas (**main `79d8004`** INTACTO en prod; **staging `f1e1aa9`**), prod vs staging, migraciones (040–044 en staging FUERA de `schema_migrations`). Secciones (a)–(f): build por módulo, pendientes de plata sin firma, pendientes humanos. **Lo de ESTA sesión:** unificación construida hasta F4.1 + fix borrado-móvil + fix auth-borrado (mig 044).
2. **[../PROMPT-CONTINUACION.md](../PROMPT-CONTINUACION.md)** — el PLAN: **★ PRÓXIMO** = terminar la unificación (**F4.2** clasificación advisory en CashTurno + **F4.3** el asistente "un solo Agregar"). Deuda: reorder del `document_id`, test de `buildReviewLines`, propuesta `useDeleteAuthorization()`. Hallazgos del audit (override cosmético; "Borrar el día" saltea cascada). DIFERIDOS (decisión dueña): reconciliación del ledger (ahora incl. 044), pase a prod IDOR+mig 039, auth-recovery+Hallazgo B. ⚠️ NUNCA `staging`→`main`. **RITUAL del link antes de cualquier comando de DB.**
3. **[../ROADMAP.md](../ROADMAP.md)** — plan por fases: estabilidad (Olas 1+1.1) + pantalla negra + `createDayMovement` ✅ en prod; **§1ter = unificación Bandeja↔Caja: diseño ✅ + esquema 040–044 ✅ + F3/F4.1 construidos en staging; falta F4.2/F4.3**; PILAR de escalabilidad de auth bloqueante del PoS.
4. **[./SPEC-unificacion-bandeja-caja.md](./SPEC-unificacion-bandeja-caja.md)** — el SPEC v1 firmado del módulo: §7 máquina de estados, §8 invariantes, §11 contable (Opción A), §12 borrado, §18 decisiones firmadas, **§19 visión futura (P&L granular)**.
5. **[./auth-borrado-casos.md](./auth-borrado-casos.md)** — 🆕 casos de prueba del borrado con autorización de gerencia (mig 044): qué probar y cómo, marcados [auto]/[manual]. + **[../HALLAZGOS.md](../HALLAZGOS.md)** (backlog triado + aprendizaje crítico del **ritual del link**; Hallazgo B; #1 IDOR ✅ cerrado en staging).

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
