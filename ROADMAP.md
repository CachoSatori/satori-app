# Satori App — Roadmap

De dashboard de analítica a sistema operativo del restaurante.
**Satori Sushi Bar · Santa Teresa & Nosara, Costa Rica · Actualizado 2026-10-30.**

> Esta página dice **en qué estado está cada fase hoy**, verificado contra `main` (`43e843d`), `staging`
> (`a4b11ae`) y las dos bases. El plan largo original (visión en 3 capas, fases 0–5, PoS/KDS, CRM, chatbot,
> finanzas, matriz impacto/esfuerzo, decisiones pendientes) sigue completo en
> [ROADMAP-ARCHIVO.md](ROADMAP-ARCHIVO.md). Estado vivo → [ESTADO.md](ESTADO.md) · backlog →
> [PROMPT-CONTINUACION.md](PROMPT-CONTINUACION.md).

Leyenda: ✅ en prod y validado en piso · 🟢 en prod, falta validar en piso · 🧪 solo en staging · 🔲 no construido ·
🚧 bloqueado.

---

## 1. Operación de caja y plata

| Fase | Estado | Notas |
|---|---|---|
| Caja diaria + cierre · Caja Fuerte · movimientos | ✅ prod | Sagrado `cashUtils.ts` `b597c697`. |
| **POZO único** (tres cajas = un saldo; corte 2026-07-22) | ✅ prod | Primer cierre real cuadró. Acta → [PASE-POZO-A-PROD.md](PASE-POZO-A-PROD.md). |
| **T3 · endurecimiento de caja** (los 8 ítems; mig 052 auditoría de ediciones) | ✅ prod | Cerrado el 10/08. |
| Bandeja unificada + Revisión de inventario · autorización por contraseña (045) | ✅ prod | Etapa 2 de la Bandeja (foto-primero dentro de Caja) 🔲 diseñada, espera decisión. |
| **Proveedores A** (notificación de pago, mig 047) + **B** (saldo a favor FIFO, migs 053/054) + comprobantes | 🟢 prod | Falta validar en piso. El correo sale recién con el DNS de Resend (depende del dueño). |
| Finanzas / P&L | ✅ prod | Hora-CR en bordes de período resuelta. |
| Reconciliación prod vs Excel del dueño | 🔲 | Viable desde el pozo (un número por día). |

## 2. Propinas y personal

| Fase | Estado | Notas |
|---|---|---|
| Propinas (pool por `covered_role`, `pool_total_crc` fuente única, elegibilidad por rol 048) | ✅ prod | Sagrado `tipCalculations.ts` `7603ba5a`. |
| Edición de propinas por cajero con autorización · foto de comprobante obligatoria | 🔲 | Firmadas, sin construir / diferida. |
| **Salarios F0** (maestro de nómina, mig 055) · **U0a/U0b** (ciclo de pago + Excel homebanking, migs 056/058) | 🧪 staging | Bloqueos humanos: 6 activos sin código BioTime, `fecha_ingreso` vacía, consulta al contador (bruto vs neto, vacaciones). |
| **BioTime F1** (marcas, mig 057 + Edge `ingest-punches` + agente) | 🧪 staging · ⚠️ | El agente está **parado desde el 14/09** (22.969 marcas). Falta Task Scheduler, decisión de identidad §7 y F1d. |
| Salarios F2–F5 (núcleo, consolidado, % ventas, liquidaciones) | 🔲 | Cada fase con firma propia. |

## 3. Ventas y analítica

| Fase | Estado | Notas |
|---|---|---|
| Módulo Ventas desde el Excel (`ventas_dias` / `ventas_hist`) | ✅ prod | Desde el 30/10 es **respaldo**: último día cargado en prod = 20/10. |
| **Puente del PoS «Nube de Fuego»** (agente → `ingest-ndf` → `pos_ndf_*`, migs 062–066) | ✅ prod | Dos agentes en la PC del PoS (staging y prod), latido OK el 30/10. |
| **P1/P2 · Ventas desde el PoS** (`FUENTE_VENTAS='pos'`, día de factura, fusión con el Excel) | ✅ prod (30/10) | Validado físicamente por Ismael. Rollback = revert de #16. |
| Paridad xls ↔ PoS | ✅ prod | **Temporal**: se retira con la pestaña «Cargar XLS». |
| En vivo · Frente C (≈₡ y pax de mesa abierta) · desplegable de productos · turnos por lote | ✅ prod | Solo gerencia; lee las tablas `pos_ndf_*` directo. |
| Lentes de saloneros por línea · atribución de salón | ✅ prod | |
| **Mi Rendimiento** (casa del empleado: Resumen, Por día, Productos, Semana, Propinas, Competencias) | ✅ prod | «Ver como» solo owner. Sigue `FUENTE_VENTAS`. |
| **ICP** = propina electrónica declarada / neta de sus mesas (barra «no aplica») | ✅ prod (30/10) | Umbrales ≥13 / <10 % sin recalibrar contra el histórico (5–9 %). |
| **Lectura del PoS para el equipo** (mig 067, sin medios de pago) + franja de aviso | ✅ prod (30/10) | Probada con salonero real en staging; verificada por JWT en prod. |
| Retirar el Excel (pestaña «Cargar XLS») y Paridad | 🔲 | En el backlog, después de un tiempo con el PoS solo. |
| Re-ingesta 2025 del `01` → ROSAURA (450 tickets, ₡19,06M) | 🔲 | Con firma; requiere actualizar los dos agentes. |
| Agregación server-side de días del PoS (`pos_ndf_dias` o RPC) | 🔲 | Solo si el cálculo en el navegador se vuelve lento. Toca esquema e ingest. |
| Merch de mostrador (familia 21) en categoría propia | 🔲 | Decide Ismael. |

## 4. PoS propio (gran pase)

| Fase | Estado | Notas |
|---|---|---|
| F0–F3 del PoS: catálogo/salón, comandero, KDS, cobro + splits, ticket SIM (migs 022–037, `posFiscal.ts`) | 🧪 staging | El gran pase a prod va detrás del PILAR. |
| Inventario activo + recetas + COGS | 🧪 staging | |
| FE-CR (factura electrónica real) | 🔲 | Hoy solo estructura SIM en staging. |
| **PILAR · sesión/auth escalable y multi-tenant** (~10 dispositivos concurrentes) | 🚧 🔲 | **Bloquea el gran pase del PoS.** |

## 5. Plataforma y deuda técnica

| Tema | Estado | Notas |
|---|---|---|
| Estabilidad (pantalla negra, realtime tras suspensión, outbox en `SIGNED_IN`, offline) | ✅ prod | |
| Versionar `ingest-ndf` en `main` con `supabase/config.toml` (ítem 11) | 🔲 | Hasta entonces, ningún PR a `main` con `supabase/functions/`. |
| Hardening ACL: 4 `SECURITY DEFINER` ejecutables por `anon` en prod | 🔲 | `get_my_role` exige análisis de policies antes del revoke. |
| Gate de tests en `deploy.yml` | 🔲 | Hoy publica sin correr `vitest`. |
| `version.json` → login por el service worker | 🔲 | Agregar `/\/version\.json$/` a `navigateFallbackDenylist`. |

---

## Lo próximo, en orden

1. Cerrar lo que quedó del go-live del PoS: rotación de secretos de ingest, revocar el token `claude-code-prod`,
   usuarios de la app para RODRI/FRANCO/MAXI BARRA, recalibrar los umbrales del ICP.
2. Retirar el Excel y Paridad cuando Ismael lo firme.
3. Ítem 11 (`config.toml` + `ingest-ndf` versionado), y después re-ingesta 2025 con los agentes actualizados.
4. Salarios: destrabar BioTime (agente parado) y los bloqueos humanos; pase a prod por fase, con firma.
5. PILAR de auth → gran pase del PoS.

El detalle y la prioridad de cada ítem están en [PROMPT-CONTINUACION.md](PROMPT-CONTINUACION.md).
