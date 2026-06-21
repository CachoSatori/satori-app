# Continuación — backlog priorizado (handoff 2026-06-21)

Estado: PROD (`main` `ff836a0`) = capa de inteligencia + **fix del SW viejo** + **fix de fechas-borde**
(ambos validados en prod). STAGING (`e0404a9`) = todo el PoS + Bandeja Etapa 1 + ambos fixes. Guardrails
de siempre: **nada a `main`/PROD sin orden explícita, DDL solo migraciones aditivas, sagrados intactos**
(`cashUtils`, `tipCalculations`, `computeTotals`, cierres, cobro/vuelto), builds+tests+eslint verdes por
commit. Estado completo → [ESTADO.md](ESTADO.md) · Fases → [ROADMAP.md](ROADMAP.md).

Marcadores: ✅ hecho · 🖊️ espera FIRMA/DECISIÓN de la dueña (plata) · 👁️ espera VALIDACIÓN FÍSICA ·
🟢 ingeniería lista para arrancar.

> **Ya resuelto y EN PROD (jun-21):** SW viejo (`fde9264`, RCA `_handoff/PROD-SW-RCA.md`) y fechas de
> borde de mes (`ff836a0`, RCA `_handoff/RCA-FECHAS-BORDE.md`). El "se traba" eran esas DOS causas.

---

## 1. 🖊️👁️ Hora-CR en bordes de período (PLATA — cambia números, valida la dueña)
**Misma familia que el `-31`, NO tocada en el fix porque cambia atribuciones.** El fix de fechas resolvió el
400 (cobertura por día), pero las queries de plata siguen acotando `created_at` en **UTC** (`…Z`), con offset
**+6h** vs CR. Lugares: `finance.ts:132/139` (P&L borde de **año** — NO da 400 porque dic tiene 31, pero el
31-dic de noche cae en el año equivocado) y similares. **Diseño:** construir los límites en hora CR (mismo
`dateCR` ya usado). **Bloqueado por:** validación física de la dueña contra un cierre conocido (cambia números).
Ver `_handoff/RCA-FECHAS-BORDE.md` §5 + `fix/fecha-cr-consistente` (ya en staging, también pendiente de validar).

## 2. 🔲 404 menor en prod sobre `propinas:1` (prolijidad, baja prioridad)
Un recurso falta en prod (`propinas:1` en Network) — probablemente un icono o un source-map. **NO afecta la
operación** (las pantallas cargan). Identificar el archivo exacto (DevTools → Network, filtro vacío, recargar)
y agregarlo o quitar la referencia. No urgente.

## 3. 🖊️ Discrepancia de la mig 035 en el ledger de staging
El ledger de staging tiene **035 como aplicada** aunque el archivo solo vive en `propina-pool` (sin merge).
Sesión dedicada de propinas: entender el origen ANTES de tocar nada. **NO tocar el historial de migraciones**
hasta saber por qué quedó así. Detalle en `_handoff/038-apply.log`.

## 4. 🟢 ETAPA 2 — entrada única foto-primero 100% dentro de Caja Diaria (diseñada, sin arrancar)
La Bandeja Etapa 1 ya está validada. Etapa 2:
- **Una sola entrada foto-primero** dentro de **Caja Diaria**; se **retira** el camino `facturas` (queda legacy).
- **Foto OBLIGATORIA** por pago. La **IA lee y SUGIERE** tipo/categoría (mercadería/operativo/personal/socios)
  mapeando a las categorías existentes; el **humano confirma** (nunca auto-commit de montos).
- **Propinas:** pide **turno (AM/PM)+fecha** en vez de proveedor y **concilia el pendiente**.
- **Offline — Opción A:** se registra el pago igual sin red; la IA procesa la foto al volver internet.

## 5. 🖊️ Pase del PoS + Bandeja a PROD (gran salto, decisión de la dueña)
Consolidar migraciones **022–038** con guard anti-staging; crear buckets `facturas`/`productos`/`documents`
en prod; regenerar tipos post-merge. Requiere autorización única + verificación de hash. Es 021→038 en una.

## 6. 👁️ Validación física pendiente en staging (construido, verde, sin probar en piso)
Checklist en [REPORTE-NOCHE-2.md](REPORTE-NOCHE-2.md): **cobro + anti-doble-cobro** (mig 033), **comandero pro**,
**FE estructura (SIM)**, **inventario activo** (stock baja por receta + COGS al cerrar).

## 7. 🖊️ DECISIÓN dueña — propina PoS → pool (`propina-pool`, sin merge)
¿Propina de tarjeta/SINPE al **mismo** pool que efectivo (implementado) o **separada**? Sin tocar
`tipCalculations`. `git show propina-pool:ESTADO-PROPINA-POOL.md`.

## 8. 🟢 Deudas a futuro (documentadas, no urgentes)
- **Cuentas por pagar / crédito a proveedores 7-15-30 días** (fecha de PAGO ≠ fecha de registro).
- **Alerta de cambio de precio** de un producto (que el contador la detecte → ajustar la receta).
- **Offline robusto** con base local que sincroniza al volver internet.
- **Unidades de inventario por presentación** (kilo/litro/gramos; huevos por maple/caja) por ingrediente.
- **FE real:** emisor certificado CR (Hacienda 4.4) detrás de `FeProvider`. Bloqueado por CIIU/CABYS de la contadora.
