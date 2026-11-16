# 📚 Índice de documentación — Satori App

> **Actualizado 2026-11-16.** Todos los enlaces de este índice fueron verificados contra la rama
> actual (`main`). Si algo no está enlazado, es porque **no existe en esta rama**.

Dos clases de documento conviven acá, y **no valen lo mismo**:

- **SPEC de IMPLEMENTACIÓN** — firmado, autoriza construir.
- **SPEC de INVESTIGACIÓN / DECISIÓN** — insumo para decidir. **No autoriza código por sí solo.**

---

## 🧭 Handoff — leer en este orden

0. **[handoffs/README.md](./handoffs/README.md)** — índice de handoffs; el vigente es
   [HANDOFF-2026-11-16](./handoffs/HANDOFF-2026-11-16.md).
1. **[../ESTADO.md](../ESTADO.md)** — foto compacta del proyecto: el **modelo del POZO** (leerlo
   antes de tocar caja), §(a) ramas, §(b) prod vs solo-staging, §(c) migraciones, §(d) build por
   módulo, §(e) pendientes de **plata** con firma, §(f) pendientes humanos/técnicos, sagrados con
   sus hashes, y las notas que ahorran una sesión.
2. **[../PASE-POZO-A-PROD.md](../PASE-POZO-A-PROD.md)** — acta del pase del pozo a producción:
   diff auditado, gate, asiento de arranque, verificación final y rollback.
3. **[../PROMPT-CONTINUACION.md](../PROMPT-CONTINUACION.md)** — backlog vigente: arriba «Lo próximo» (al 16/11) y, debajo,
   el detalle por prioridad (P0–P3) y el histórico.
4. **[../ROADMAP.md](../ROADMAP.md)** — plan por fases con su estado (el Club en §3.1).
5. **[../HALLAZGOS.md](../HALLAZGOS.md)** — hallazgos triados; la tabla «Estado de lo abierto» (16/11) dice qué sigue abierto
   (ítem 11 / `config.toml`, `version.json` y el service worker, hallazgo 232, privacidad D3).

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

## 🟢 Club Satori — SPECs vigentes (en [club-satori/](./club-satori/README.md))

- **[club-satori/SPEC-clics-embudo.md](./club-satori/SPEC-clics-embudo.md)** — 🖊️ **FIRMADO 16-nov-2026 (D1–D9 con las
  recomendaciones; no está construido).** Registro de clics en «Reservar», «Cómo llegar» y «Reseña» (portal, cupón,
  cumpleaños), embudo clic → reserva de OpenTable → llegada → reseña; plan en 5 PRs, cada uno con su firma. **El aviso
  de privacidad v1.4 lo lee quien asesora en Ley 8968 antes de publicarse.** El §13 (cumpleaños automático por el pase de
  Wallet, dos niveles configurables) también está firmado.
- **[club-satori/SPEC.md](./club-satori/SPEC.md)** — el SPEC del Club (fases F0–F3, modelo de datos, pantallas, seguridad).
  F0 y F1 ✅ en prod desde el 11-nov; F2 y F3 siguen como diseño. Lo posterior lo precisan los SPEC de abajo.
- **[club-satori/SPEC-LC-promos.md](./club-satori/SPEC-LC-promos.md)** — Local Club en Wallet, promociones y reglas de combinación (07-nov).
- **[club-satori/CONTRATO-pase.md](./club-satori/CONTRATO-pase.md)** — frontera entre el pase de Wallet y la base del Club (v1).
- **[club-satori/WALLET-GOOGLE-ACTIVACION.md](./club-satori/WALLET-GOOGLE-ACTIVACION.md)** — activación de Google Wallet (en prod el 16-nov; falta la prueba de baja, §5.5).
- **[club-satori/RUNBOOK-piloto.md](./club-satori/RUNBOOK-piloto.md)** · **[INVENTARIO-FUNCIONES.md](./club-satori/INVENTARIO-FUNCIONES.md)** — operación del piloto y mapa de funciones.

**Superados (se conservan como historia, no como guía):**
[PROPUESTA-LC-modelo.md](./club-satori/PROPUESTA-LC-modelo.md) §4 → reemplazado por [PLAN-LC-lanzamiento.md](./club-satori/PLAN-LC-lanzamiento.md) (07-nov) ·
[PLAN-CRM-cierre.md](./club-satori/PLAN-CRM-cierre.md) → ejecutado (F0, migs 072 y 073) ·
[PERFIL-SISTEMA-ACTUAL.md](./club-satori/PERFIL-SISTEMA-ACTUAL.md) y [historico/](./club-satori/historico/) → relevamiento del sistema viejo de créditos, ya reemplazado por el Club.

## 🟢 Otras SPECs vigentes

- **[SPEC-prompax-explicado.md](./SPEC-prompax-explicado.md)** — 🖊️ v2.3 ✅ EN PROD desde el 07-nov (mig 080).
- **[MULTILOCAL-fase0.md](./MULTILOCAL-fase0.md)** y **[MULTILOCAL-relevamiento.md](./MULTILOCAL-relevamiento.md)** — multilocal fuera del Club; decisiones aprobadas el 08-nov, **sin construir**. Regla: nada atado a un local por nombre.
- **[analisis/2026-11-mediodia-localclub/specs/](./analisis/2026-11-mediodia-localclub/specs/)** — SPEC del análisis de ventas integrado y del reporte del mediodía (insumos; los huecos abiertos están en ROADMAP §3).
- **Guías de uso de la app:** [sop-app/INVENTARIO.md](./sop-app/INVENTARIO.md) (una guía por módulo; se actualizan en el mismo PR que cambia el módulo).

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
