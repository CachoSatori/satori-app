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
| **Fix «Borrar TODO el día»** (elegir por día operativo, vista previa, errores chequeados) | 🧪 staging (05/11) | Borraba filas de cierres de otro día (20/07 y 20/10). Prod con firma aparte. Ver [HALLAZGOS.md](HALLAZGOS.md). |
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
| Ingestar el % de descuento por línea (`FAC_PedidosDet.Descuento` / `TipoDescuento`) | 🔲 | Backlog, sin fecha. Separa Local Club, tarjeta 10 %, personal 30 % y cortesías. Bridge + Edge + columna → firma. Hueco #3 de [SPEC-analisis-ventas-integrado §6](docs/analisis/2026-11-mediodia-localclub/specs/SPEC-analisis-ventas-integrado.md). |
| Ingestar `FAC_Facturas.CuentaCobrar` (cerrada «a crédito») | 🔲 | Backlog, sin fecha. Mostrar aparte los créditos de tarjetas (~₡260k/mes). Bridge + Edge + columna → firma. Hueco #6 de la misma SPEC. |
| Revisar `regalia_crc` en tickets `cortesia` | 🔲 | Backlog, sin fecha. Tickets con `valor_servido` > 0 y `regalia_crc` = 0. Revisión, sin esquema. Hueco #7 de la misma SPEC. |
| Franja mediodía/noche por hora de la factura, no por turno de caja | 🔲 | Backlog, sin fecha. El turno queda mal anotado en los dos sentidos (Q27 en [r8](docs/analisis/2026-11-mediodia-localclub/rondas/r8-Q27-D14-D15.md)). Solo lectura y cálculo, sin esquema. |
| Código de quien entregó la tarjeta de hotel o tienda en cada mesa + conciliación automática de créditos (sistema web ↔ `CuentaCobrar`) | 🔲 | Backlog, sin fecha. Requiere ingesta → firma. Ver [r9](docs/analisis/2026-11-mediodia-localclub/rondas/r9-programa-creditos-PM.md). |
| Descuento al personal (30 %): código de empleado obligatorio y reporte mensual por persona | 🔲 | Backlog, sin fecha. Va con firma. Ver D14/D15 en [r8](docs/analisis/2026-11-mediodia-localclub/rondas/r8-Q27-D14-D15.md). |
| Comisiones PM como costo del programa en los reportes | 🔲 | Backlog, sin fecha. Hoy se pagan en efectivo por caja de proveedores, fuera del PoS. Ver [r9](docs/analisis/2026-11-mediodia-localclub/rondas/r9-programa-creditos-PM.md). |
| Tablero mensual supuesto vs realidad de programas (LC, créditos, menú) | 🔲 | Backlog, sin fecha. Con firma. Solo lectura, por hora de factura. Ver [ESCENARIOS-cambios-programas.md §4](docs/analisis/2026-11-mediodia-localclub/ESCENARIOS-cambios-programas.md). |
| Local Club 3.0: tarjeta en Wallet con QR único, referidos que suman puntos, sin descuento fijo | 🔲 | Backlog, sin fecha. Toca ingesta y esquema → firma. Datos personales nunca en el repo. Ver [ESCENARIOS §6](docs/analisis/2026-11-mediodia-localclub/ESCENARIOS-cambios-programas.md). |

## 4. PoS propio (gran pase)

| Fase | Estado | Notas |
|---|---|---|
| F0–F3 del PoS: catálogo/salón, comandero, KDS, cobro + splits, ticket SIM (migs 022–037, `posFiscal.ts`) | 🧪 staging | El gran pase a prod va detrás del PILAR. |
| Inventario activo + recetas + COGS | 🧪 staging | |
| FE-CR (factura electrónica real) | 🔲 | Hoy solo estructura SIM en staging. |
| **PILAR · sesión/auth escalable y multi-tenant** (~10 dispositivos concurrentes) | 🚧 🔲 | **Bloquea el gran pase del PoS.** |
| **Requisito del pase: revocar EXECUTE de `anon` en las `SECURITY DEFINER` del PoS propio** (`pos_cobrar_*`, `pos_merge_orden`, `pos_unmerge_orden`, `pos_reopen_orden`, `sync_pos_tips_to_pool`, `my_turno_stats`) | 🚧 🔲 | **Bloqueante:** medido en staging el 04/11. No pasa a prod sin revocarlo y verificarlo con `has_function_privilege`. Ver [HALLAZGOS.md](HALLAZGOS.md). |

## 5. Plataforma y deuda técnica

| Tema | Estado | Notas |
|---|---|---|
| Estabilidad (pantalla negra, realtime tras suspensión, outbox en `SIGNED_IN`, offline) | ✅ prod | |
| Versionar `ingest-ndf` en `main` con `supabase/config.toml` (ítem 11) | 🔲 | Hasta entonces, ningún PR a `main` con `supabase/functions/`. |
| **SEC-01 · cierre de la escalada de roles** (mig 068: rol fijo al dar de alta, guarda de owner activo, nunca 0 owners) | 🟢 prod (05/11) | Paso A y mig 068 aplicados en prod. Falta que Ismael valide (3 owners, Admin, un salonero real en Mi Rendimiento) y el merge del PR. |
| **SEC-01b · `get_my_role()` mira `is_active`** | 🔲 🔴 | **CRÍTICO.** Antes o en la misma migración: corregir las 6 guardas `not in` que se abren con NULL y las 3 policies que leen `profiles.role` sin `is_active` (`cierre_write`, `inv_write_recipes`, `inv_write_ri`). |
| Versionar en migraciones las policies reales de `profiles` (y revisar drift en el resto) | 🔲 | Hoy prod y staging tienen 3 policies que no están en el repo. También el nombre distinto del trigger de `auth.users`. |
| 🔴 **Prioridad alta · Alta de empleados desde Admin** (Edge Function con `service_role`: el owner crea la cuenta y asigna rol; nunca el cliente) | 🔲 🖊️ | El auto-registro quedó cerrado el 04/11 (`disable_signup`): hoy no hay forma de sumar empleados desde la app. La función tiene que verificar que quien llama sea un owner activo. Va con `supabase/config.toml` (ítem 11) para fijar `verify_jwt`. |
| Decidir si se reactiva el auto-registro de empleados | 🔲 🖊️ | Apagado desde el 04/11 (`disable_signup`). Con la 068 sería seguro (salonero + inactivo), pero cualquiera podría crear cuentas pendientes. Alternativa: alta solo por el owner. |
| `LoginPage` sigue ofreciendo «crear cuenta» de empleado | 🔲 | Con el signup apagado devuelve un error técnico (`Signups not allowed`). Ocultar el botón o poner un mensaje claro («pedile el alta al encargado»). Toca `src/`. |
| Hardening ACL: 4 `SECURITY DEFINER` ejecutables por `anon` en prod | 🔲 | `get_my_role` exige análisis de policies antes del revoke. Higiene (en prod no son de plata). |
| Gate de tests en `deploy.yml` | 🔲 | Hoy publica sin correr `vitest`. |
| `version.json` → login por el service worker | 🔲 | Agregar `/\/version\.json$/` a `navigateFallbackDenylist`. |

---

## Lo próximo, en orden

0. **SEC-01:** validación de Ismael en prod + merge → **alta de empleados desde Admin** → SEC-01b → SEC-02.
1. Cerrar lo que quedó del go-live del PoS: rotación de secretos de ingest, revocar el token `claude-code-prod`,
   usuarios de la app para RODRI/FRANCO/MAXI BARRA, recalibrar los umbrales del ICP.
2. Retirar el Excel y Paridad cuando Ismael lo firme.
3. Ítem 11 (`config.toml` + `ingest-ndf` versionado), y después re-ingesta 2025 con los agentes actualizados.
4. Salarios: destrabar BioTime (agente parado) y los bloqueos humanos; pase a prod por fase, con firma.
5. PILAR de auth → gran pase del PoS.

El detalle y la prioridad de cada ítem están en [PROMPT-CONTINUACION.md](PROMPT-CONTINUACION.md).
