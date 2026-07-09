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

## 🧭 Handoff — leer en este orden (actualizado 2026-07-09 — ✅ pase + smoke físico + sinceramiento USD; estabilización en curso, ventana cierra ~13-jul)
1. **[../ESTADO.md](../ESTADO.md)** — foto compacta **post-pase**: ramas (**main código `92c0831`** en PROD con toda la ola 2026-07 + Bandeja + unificación, **SIN PoS**; **staging código `1daef0c`** = dev con PoS; HEADs actuales `cf50724`/`508853a`, avanzan por docs-only), §(b) prod vs staging, §(c) migraciones (prod ledger **≤021 + 038–045 out-of-band**; 🆕 **migración de histórico CANCELADA en staging** — `ventas_efectivo_hist` DROPeada, 2 backups `*_pre_migracion_2026_07` vivos 30 días), §(d) build por módulo, §(e) plata/humanos (smoke + USD ✅ HECHOS 07-06), §(f) **deuda técnica** (huérfanos **decididos**, arranque limpio de prod, `saldoCajaFuerte` sin ancla). Detalle del pase → `ESTADO-ARCHIVO.md` (bloque 2026-07-04).
2. **[../PROMPT-CONTINUACION.md](../PROMPT-CONTINUACION.md)** — backlog vigente **por prioridad (P0–P3)**: **P0** estabilización (observar prod; **ventana cierra ~13-jul**; smoke+USD ya ✅) · **P1** cola post-ventana con **decisiones firmadas** (semántica del rojo + rechazo de 2 huérfanos, reconciliación del ledger, hora-CR, **arranque limpio de prod**) — el import histórico #6 quedó **🛑 CANCELADO** · **P2** decisiones de producto (Etapa 2 Bandeja, `propina-pool`, foto comprobante) · **P3** pilar de sesión/auth + gran pase del PoS (diferido). **RITUAL del link: `cat supabase/.temp/project-ref`**; si `db query --linked` cuelga → **curl a la Management API** (`api.supabase.com/v1/projects/<ref>/database/query`, token del Keychain con **`-a supabase`**).
3. **[../ROADMAP.md](../ROADMAP.md)** — plan por fases: los Tiers de la ola (0/2.1/3, Opción B, propinas vía real, tema claro) y la **unificación Bandeja↔Caja** están **EN PROD** (`92c0831`); el **plan de 3 OLAS quedó ✅ COMPLETADO** (Ola 2/3 subsumidas por el pase único). El **PILAR de escalabilidad de auth** sigue bloqueante del **GRAN PASE del PoS** — lo único que queda solo en staging (migs 022–037).
4. **[./SPEC-unificacion-bandeja-caja.md](./SPEC-unificacion-bandeja-caja.md)** — el SPEC v1 firmado del módulo ya construido: §7 máquina de estados, §8 invariantes, §11 contable (Opción A), §12 borrado, §18 decisiones firmadas, **§19 visión futura (P&L granular)**.
5. **[../HALLAZGOS.md](../HALLAZGOS.md)** — backlog triado. **🆕 2026-07-06→09 (arriba del archivo):** migración histórico Excel→app **ejecutada y REVERTIDA** en staging (cierre 07-09); **`saldoCajaFuerte` sin ancla** (registrado, relevante a futuro); smoke físico PROD OK con 1 hallazgo → pagos "huérfanos" **reencuadrados** (el "14" es `overdueCount`) y **decididos**; **convención de ventas migradas CERRADA** (subregistro 49%, TC casa 510/500/490/470, corr 0,978 vs PoS). **2026-07-03:** faltante fantasma (enterrado), déficit histórico USD de CF (−$2678), edición de pagos = delete_cascade+recreate, modelo IA = env var, **🔄 `project-ref` reemplaza a `linked-project.json`**, **⚠⚠ el CLI puede quedar enlazado a PROD (ritual del link)**. **Sigue abierto:** #2 `monthly-report` sin auth, #3 `config.toml`, #14 deploy sin gate de tests, #5 RLS `cash_cierres_dia`.

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
