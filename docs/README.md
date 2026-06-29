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

## 🧭 Handoff — leer en este orden (actualizado 2026-06-28)
1. **[../ESTADO.md](../ESTADO.md)** — foto compacta: ramas (**main `52d1475`** en prod; **staging `3b821f0`**), prod vs staging, migraciones. **§header = lo de ESTA sesión (2026-06-28, cont. — CI/infra):** GitHub Actions del deploy subidas a **Node 24 (`@v5`)** en main y staging (`deploy.yml` byte-idéntico, drift cerrado; deploy verde, warning de Node 20 desaparecido) + **`supabase/.temp/` untrackeado también en main** (clon fresco ya no arranca en prod) + 2 ramas de prep borradas. §(a) ramas · §(b) prod vs staging · §(c) migraciones (sin cambios) · §(d) build (sin código de app; Pages de main verde) · §(e) plata (sin cambios) · §(f) humanos/prolijidad. El detalle de las sesiones previas (IDOR 2026-06-28, 2026-06-25/26/27) está archivado en `ESTADO-ARCHIVO.md`.
2. **[../PROMPT-CONTINUACION.md](../PROMPT-CONTINUACION.md)** — el PLAN: **★ PENDIENTES NUEVOS:** prueba cross-user del IDOR [opcional], subir `node-version` del build a Node 22 [aparte], check "Supabase Preview" en rojo crónico [pre-existente, ajeno]. **✅ Cerrados 2026-06-28 (cont.):** untrack de `.temp/` a main + bump de GitHub Actions a `@v5`/Node 24 (main+staging). **★ PRÓXIMO** = construcción del módulo de unificación (regenerar tipos TS → F3–F5). Pase a prod pendiente: **Bandeja Etapa 1 + migs 038/039** (el IDOR **ya está en prod**). ⚠️ NUNCA `staging`→`main` en bloque: solo pase quirúrgico. **RITUAL del link a staging antes de cualquier comando de DB.**
3. **[../ROADMAP.md](../ROADMAP.md)** — plan por fases: estabilidad (Olas 1+1.1) + pantalla negra + `createDayMovement` + **🆕 IDOR ✅ en prod**; la **Ola 2 (Bandeja Etapa 1 + mig 038) ya NO está bloqueada por el IDOR**; **§1ter = unificación Bandeja↔Caja: diseño ✅ + esquema 040–043 ✅ aplicado a staging, código sin construir**; PILAR de escalabilidad de auth bloqueante del PoS.
4. **[./SPEC-unificacion-bandeja-caja.md](./SPEC-unificacion-bandeja-caja.md)** — el SPEC v1 firmado del módulo que se construye a continuación: §7 máquina de estados, §8 invariantes, §11 contable (Opción A), §12 borrado, §18 decisiones firmadas, **§19 visión futura (P&L granular)**.
5. **[../HALLAZGOS.md](../HALLAZGOS.md)** — backlog triado + **✅ Accionado 2026-06-28: #1 IDOR resuelto EN PROD + footgun del link resuelto en staging (pendiente en main)**; **⚠⚠ aprendizaje crítico: el CLI estaba enlazado a PROD (ritual del link)**; Hallazgo B (drain del outbox en `SIGNED_IN`, precond. del auth-recovery) **✅ cerrado en staging (`492eaa5`)**; entorno DOM ✅ resuelto. **Sigue abierto:** #2 `monthly-report` sin auth, #3 `config.toml`, #14 deploy sin gate de tests, #5 RLS `cash_cierres_dia`.

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
