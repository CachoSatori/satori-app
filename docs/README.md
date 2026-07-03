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

## En la raíz del repo (specs previos, se conservan donde estaban)
- **[../SPEC-LAVU-FLUJO-MESA.md](../SPEC-LAVU-FLUJO-MESA.md)** — flujo de mesa Lavu vs Satori
  (21 funciones, semáforo de paridad de la COMANDA; ya casi todo ✅).
- **[../SPEC-COMANDERO-UX.md](../SPEC-COMANDERO-UX.md)** — UX del display del salonero
  (Lavu/Toast/TouchBistro/Square), auditoría de callejones sin salida y backlog P0/P1/P2.

## Leyenda de encaje
- 🟢 ya implementado en Satori · 🟡 valioso y razonable de hacer · 🔵 futuro / depende de decisión.
- ⏳ pendiente de profundizar/decidir (aplica a todo: nada se implementa desde estos docs).

## 🧭 Handoff — leer en este orden (actualizado 2026-07-03)
1. **[../ESTADO.md](../ESTADO.md)** — foto compacta: ramas (**main `a14da50`** en prod, **INTACTA**; **staging `ddb1c08`**), prod vs staging, migraciones. **§header = la ola 2026-07-03 (10 pases FF a staging, todos validados físicamente por Ismael; PROD intacta):** Tier 0 (cierre visual + fórmula USD firmada), Tier 2.1 (autorización por contraseña + **mig 045** en staging), Tier 3 completo (Revisión foto/panel/adjuntar + asistente orden/flujo guiado), **Opción B** (ajuste de cierre al ledger), **propinas por la vía real** (faltante fantasma enterrado), rediseño de Caja a tema claro. §(a) ramas · §(b) prod vs staging · §(c) migraciones (mig 045 en staging, NO prod) · §(d) build por módulo · §(e) plata firmada+aplicada a staging · §(f) **deuda del pase único a prod**. Detalle de la sesión → `ESTADO-ARCHIVO.md` (bloque 2026-07-03).
2. **[../PROMPT-CONTINUACION.md](../PROMPT-CONTINUACION.md)** — el PLAN: **🚨 §PASE A PROD (primero) = la próxima sesión.** Los 5 pasos: (1) reconciliar el ledger de migraciones, (2) cherry-pick FF-only de la ola `a4b1be3..ddb1c08` a main en orden, (3) aplicar migs 038–045 en prod, (4) replicar el secret `ANTHROPIC_MODEL=claude-sonnet-4-5` en prod, (5) sinceramiento USD en prod con el conteo físico del día. **Diferidos con decisión:** foto de comprobante al pagar propina (firmado, pase siguiente) · **Tier 1 (monto-on-modify) DESCARTADO por la dueña**. ⚠️ NUNCA `staging`→`main` en bloque. **RITUAL del link: `cat supabase/.temp/project-ref` = `hwiatgicyyqyezqwldia`.**
3. **[../ROADMAP.md](../ROADMAP.md)** — plan por fases con los Tiers de esta ola cerrados (todos ✅🟢 en staging): Tier 0, Tier 2.1, Tier 3, Opción B, propinas vía real, tema claro. La **unificación Bandeja↔Caja ya está CONSTRUIDA y validada en staging** (F41–F43); solo falta el pase a prod. PILAR de escalabilidad de auth sigue bloqueante del PoS grande.
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
