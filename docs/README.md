# 📚 Índice de documentación — Satori App

> **Actualizado 2026-07-22.** Todos los enlaces de este índice fueron verificados contra la rama
> actual (`main`). Si algo no está enlazado, es porque **no existe en esta rama**.

Dos clases de documento conviven acá, y **no valen lo mismo**:

- **SPEC de IMPLEMENTACIÓN** — firmado, autoriza construir.
- **SPEC de INVESTIGACIÓN / DECISIÓN** — insumo para decidir. **No autoriza código por sí solo.**

---

## 🧭 Handoff — leer en este orden

1. **[../ESTADO.md](../ESTADO.md)** — foto compacta del proyecto: el **modelo del POZO** (leerlo
   antes de tocar caja), §(a) ramas, §(b) prod vs solo-staging, §(c) migraciones, §(d) build por
   módulo, §(e) pendientes de **plata** con firma, §(f) pendientes humanos/técnicos, sagrados con
   sus hashes, y las notas que ahorran una sesión.
2. **[../PASE-POZO-A-PROD.md](../PASE-POZO-A-PROD.md)** — acta del pase del pozo a producción:
   diff auditado, gate, asiento de arranque, verificación final y rollback.
3. **[../PROMPT-CONTINUACION.md](../PROMPT-CONTINUACION.md)** — backlog vigente por prioridad:
   **P0** T3 endurecimiento de caja · **P1** deuda corta (mergear `main→staging`, ledger de
   migraciones) · **P2** decisiones/firmas del dueño · **P3** PILAR de auth + gran pase del PoS ·
   **⛔** lo que quedó fuera de alcance.
4. **[../ROADMAP.md](../ROADMAP.md)** — plan por fases; el rediseño de cajas va ✅ hecho y validado.
5. **[../HALLAZGOS.md](../HALLAZGOS.md)** — backlog triado de hallazgos. Sigue abierto: #2
   `monthly-report` sin auth, #3 `config.toml`, #14 deploy sin gate de tests, #5 RLS `cash_cierres_dia`.

## 🧮 Caja y el modelo del POZO

El rediseño de cajas (2026-07-22) tiene su documentación junto al código y al harness que lo midió:

- **[../scripts/t0-reconciliacion-cajas/README.md](../scripts/t0-reconciliacion-cajas/README.md)** —
  el harness **read-only** que diagnosticó el problema, con su candado de doble opt-in para prod.
  Reportes: [T0](../scripts/t0-reconciliacion-cajas/REPORTE-T0-RECONCILIACION.md) ·
  [T0-B (prod)](../scripts/t0-reconciliacion-cajas/REPORTE-T0B-PROD.md) ·
  [T1](../scripts/t0-reconciliacion-cajas/REPORTE-T1-PARALELO.md) ·
  [T1-B (prod)](../scripts/t0-reconciliacion-cajas/REPORTE-T1B-PROD-PARALELO.md) ·
  [auditoría de canales T2](../scripts/t0-reconciliacion-cajas/AUDITORIA-CANALES-T2.md).
- **[../scripts/refresh-staging/PLAN.md](../scripts/refresh-staging/PLAN.md)** — runbook para volver
  staging a espejo de prod. Actas:
  [CORTE-2026-07-22](../scripts/refresh-staging/CORTE-2026-07-22.md) ·
  [TRIAGE-TARJETA](../scripts/refresh-staging/TRIAGE-TARJETA.md) ·
  [ARRANQUE-CERO](../scripts/refresh-staging/ARRANQUE-CERO.md) ·
  [REPORTE-PASE-STAGING](../scripts/refresh-staging/REPORTE-PASE-STAGING.md).

## 🟢 SPECs de IMPLEMENTACIÓN (firmados)

- **[SPEC-propinas-efectivo-electronico.md](./SPEC-propinas-efectivo-electronico.md)** — 🖊️ **FIRMADO
  2026-07-09 · ✅ EN PROD.** La cuenta por pagar de propinas se genera **solo por la porción
  electrónica**; el efectivo se lo queda el equipo y nunca genera movimiento ni pendiente (el
  *take-home* por empleado no cambia). Mig **046** aplicada a prod out-of-band.

## 🔵 SPECs de INVESTIGACIÓN / DECISIÓN (no autorizan código)

- **[SPEC-unificacion-bandeja-caja.md](./SPEC-unificacion-bandeja-caja.md)** — ✅ **v1, decisiones de
  diseño FIRMADAS (2026-06-26)**; la **Etapa 1 está en PROD**. Colapsar Bandeja y Caja Diaria en un
  único "Agregar"; auto-clasificar como **ayuda visual** (el humano confirma); sacar "Ingresar a
  inventario" del cajero → contador/manager en Inventarios; asiento contable automático.
  §7 máquina de estados · §8 invariantes · §11 contable (Opción A) · §12 borrado · §18 decisiones
  firmadas · §19 visión futura (P&L granular).
  **La Etapa 2 sigue 🔲 diseñada sin construir** — se construye solo si el uso real la pide.
- **[SPEC-LAVU-OPERACION.md](./SPEC-LAVU-OPERACION.md)** — Lavu vs Satori en OPERACIÓN: caja diaria
  (Till-In/Out, fondo firmado, corte del día, denominaciones, varianza), proveedores (Paid-Out,
  depósito a banco/Vault, puente factura→inventario→costo→margen), cierres (Expected vs Actual vs
  Reconciliation=0), KDS (expo/pase, bump bar), inventario (depletion, PO, FIFO/caducidad).
  > 💡 Buena parte del capítulo de **caja/cierres** quedó **resuelta por el modelo del pozo**: un
  > solo saldo, un solo canal, reconciliación por día. Leerlo con eso en mente.
- **[SPEC-COMPETIDORES-PoS.md](./SPEC-COMPETIDORES-PoS.md)** — Toast / Square / TouchBistro paso a
  paso: firing Hold/Stay/Send, coursing, fire-by-prep-time, expediter, 86, revenue centers, Comp vs
  Void, split check vs split payment, daypart, offline híbrido. Cada feature con encaje 🟢/🟡/🔵 + fuente.
- **[SPEC-COMANDA-GAPS.md](./SPEC-COMANDA-GAPS.md)** — 3 gaps priorizados para decidir: **Comp vs
  Void** (P&L), **fire-by-prep-time** (el campo prep ya existe), **revenue centers**.

## 📄 SPECs en la raíz del repo (se conservan donde estaban)

- **[../SPEC-LAVU-FLUJO-MESA.md](../SPEC-LAVU-FLUJO-MESA.md)** — flujo de mesa Lavu vs Satori
  (21 funciones, semáforo de paridad de la COMANDA).
- **[../SPEC-COMANDERO-UX.md](../SPEC-COMANDERO-UX.md)** — UX del display del salonero, auditoría de
  callejones sin salida y backlog P0/P1/P2.

## 🔧 RCAs y diagnósticos

| RCA | Estado |
|---|---|
| [HANG-RCA-2.md](./HANG-RCA-2.md) — auth-recovery: loop `OFFLINE_WAITING` tras suspensión larga | en staging, gate físico pendiente |
| [rca/2026-06-22-realtime-suspension.md](./rca/2026-06-22-realtime-suspension.md) — Realtime tras suspensión profunda | ✅ resuelto y validado |
| [../HANG-RCA.md](../HANG-RCA.md) — saga vieja del "se traba" (Realtime/candado de auth) | ✅ cerrado, canariado a prod |
| [../_handoff/PROD-SW-RCA.md](../_handoff/PROD-SW-RCA.md) — Service Worker viejo en prod | ✅ cerrado |
| [../_handoff/RCA-FECHAS-BORDE.md](../_handoff/RCA-FECHAS-BORDE.md) — 400 por `-31` en reportes | ✅ cerrado |

Infraestructura: [../OFFLINE.md](../OFFLINE.md) · [../STAGING.md](../STAGING.md) ·
[../ESTADO-ARCHIVO.md](../ESTADO-ARCHIVO.md) (changelog histórico).

> `ESTADO-PROPINA-POOL.md` **no existe en esta rama** — vive solo en la rama `propina-pool`.

## Leyenda

🟢 ya implementado · 🟡 valioso y razonable de hacer · 🔵 futuro / depende de decisión ·
🔲 diseñado sin construir · ⏳ pendiente de profundizar o decidir · 🖊️ requiere firma del dueño.
