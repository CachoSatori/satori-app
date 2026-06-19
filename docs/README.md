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

## 🧭 Handoff — leer en este orden para ponerse al día
1. **[../ESTADO.md](../ESTADO.md)** — foto compacta: ramas (staging `cb25672`), prod vs staging, migraciones (⚠ mig 038 sin aplicar, espera firma), pendientes. **Incluye la Bandeja fusionada (Etapa 1).**
2. **[../ROADMAP.md](../ROADMAP.md)** — plan por fases con estado real (✅/🟢/⏳/🔲); Bandeja Etapa 1 (🟢 validada) + Etapa 2 (diseñada) + backlog nuevo de junio.
3. **[../PROMPT-CONTINUACION.md](../PROMPT-CONTINUACION.md)** — backlog priorizado (mig 038 → Etapa 2 → PWA urgente → deudas a futuro); marca qué espera firma vs validación física.
4. **[../SPEC-LAVU-FLUJO-MESA.md](../SPEC-LAVU-FLUJO-MESA.md)** — fuente de verdad del flujo de mesa/comanda (semáforo de paridad).
5. **[../REPORTE-NOCHE-2.md](../REPORTE-NOCHE-2.md)** — trabajo previo (PoS pro + FE estructura + inventario activo) + checklist de prueba física.

> Otros relacionados: `ESTADO-ARCHIVO.md` (changelog histórico detallado), `ESTADO-PROPINA-POOL.md`
> (solo en la rama `propina-pool`, sin merge), `AUDITORIA-CONSOLIDACION.md` (auditoría técnica),
> `OFFLINE.md` / `STAGING.md` / `HANG-RCA.md` (notas de infraestructura).
