# Research PoS — Fichas por sistema (Fase 1)

> Satori App · 2026-07-10. Todo lo afirmado acá sobrevivió **verificación adversarial 3-votos contra fuente primaria**
> (2 corridas de deep research, 213 agentes, ~440+ fetches). Donde un eje NO tiene datos verificados, se dice
> explícitamente — los huecos honestos valen más que el relleno. Fuentes por afirmación en `run1-full.json` / `run2-full.json`.

---

## 1. TOAST — el líder de servicio completo en EEUU

**Propinas:** el pooling nativo NO distribuye: calcula un split sugerido que el gerente dispersa a mano (la automatización es el add-on pago Tips Manager). Pooled Tips Report reparte solo tarjeta, entre fichados al momento de ABRIR el cheque, por horas. [support.toasttab: Pooling-Tips-and-Tipping-Out]
**Shift Review (su joya):** checkout de fin de turno por empleado, configurable como obligatorio — netea ventas en efectivo vs propinas de tarjeta y dice "el empleado debe X / se le debe X"; propinas tarjeta pagadas de gaveta o por planilla; efectivo se DECLARA (con % mínimo configurable). [Shift-Review-Overview; Declaring-Cash-Tips]
**Caja:** modelo de 3 capas — Shift Review (empleado) / cash drawer closeout (arqueo físico POR GAVETA, over/short explícito, umbral configurable que exige aprobación gerencial) / Close Out Day (día de negocio). Depósitos en pantalla aparte (excluye fondos iniciales). [adminCashDrawerOperations; adminCashDeposits]
**Cierre automático:** 4am ET cierra cheques y desficha a todos; el manual es opcional. **Edge case real:** el auto-close captura cheques pagados-no-cerrados SIN propina → ajuste post-batch engorroso. [Close-Out-Day-Z-Report-Auto-Capture]
**Offline:** "offline mode with local sync" — un HUB LOCAL designado (fijo, Ethernet, 1/local) redistribuye las órdenes por LAN sin nube; los KDS siguen recibiendo comandas en corte de internet. Sin internet no entran órdenes online; si cae la LAN, nada viaja. Modo legacy por-dispositivo en deprecación. [doc.toasttab: platformOfflineModeLocalSync]
**Inventario/COGS:** vía xtraCHEF (producto adquirido): facturas de proveedor procesadas con AI/ML, líneas auto-codificadas sincronizadas a contabilidad (QBO); recipe costing con plate cost y margen (tier Pro; el claim de "factoriza labor" es copy de marketing no sustentado en docs técnicos). [pos.toasttab.com/products/xtrachef; xtraCHEF-101]
**Huecos sin verificar:** pricing 2025-26, quejas reales agregadas, detalles de multi-local.

## 2. SQUARE FOR RESTAURANTS — el estándar de simplicidad

**Propinas:** SÍ distribuye automático cuando se activa: por transacción (split igualitario entre fichados), diario/semanal (por horas), o % fijo por rol — pero está detrás de Plus/Premium/Shifts Plus (pago). Default: propina directa 100% a quien cobró. [help 8141, 7654]
**Pago de propinas en efectivo:** manual vía Cash Management → Pay In/Out etiquetado "(Nombre) Tips" → queda como deducción trazable en el historial de la gaveta. Automatiza el cálculo y la liquidación por payroll, NO el desembolso físico. [help 8141, 6480]
**Caja:** sesiones de gaveta — apertura SOLO desde el PoS con efectivo inicial; cierre con conteo + descripción; todo paid-in/paid-out queda en el historial de la sesión con descripción y total corriente (audit trail por sesión); reporte de gaveta por email. [help 8344, 8358]
**Huecos sin verificar:** KDS, multi-local, inventario, personal, pricing detallado, quejas.

## 3. LIGHTSPEED RESTAURANT (O-Series) — captura flexible, reporting

**Propinas:** 4 modalidades de captura (pantalla PoS / datáfono integrado / recibo impreso / ninguna); propina agregable en checkout O post-venta desde el historial ("Add tip"). **Tips report por empleado con "tips owing"** — propinas adeudadas como pasivo por persona (concepto valioso). NO documenta motor de pooling/distribución. [o-series-support: 31329491401755]
**Huecos sin verificar:** comandero, KDS, inventario avanzado, multi-local, pricing, quejas.

## 4. TOUCHBISTRO — el iPad-first local-first

**Arquitectura (2025-26):** híbrida — nube + red local CABLEADA como respaldo: las terminales siguen hablándose sin internet; se toman/cierran órdenes, se comanda al KDS y se cobra offline (pagos según procesador). El viejo Mac mini ya no se publicita pero el "TouchBistro Pro Server" local persiste en docs. [touchbistro.com/pos; cdn.touchbistro.com/help]
**Mesas/salón:** plano editable REMOTO desde el portal cloud (mesas, paredes, secciones, salones → sync automático al local); analítica por mesa (tiempo sentado, gasto), transferencias de mesa sin perder la cuenta. [features/floor-plan-table-management]
**Cobro:** splits en la mesa por partes iguales o por ítem con gesto de swipe — feature con PATENTE en EEUU. [pos-solutions/restaurant-pos]
**KDS:** NO es propio — es "Powered by Fresh" (partnership) y solo corre en pantallas MicroTouch dedicadas compradas a TouchBistro. Señal de mercado: hasta un líder iPad-first tercerizó el KDS. [kitchen-display-system; fresh.technology]
**Personal:** fichaje en terminal con monitoreo cloud; cuentas individuales con permisos granulares por staff type (acciones sensibles restringidas: cambios de menú, payouts); labor cost/horas extra/ventas por empleado en vivo. Scheduling avanzado = add-on aparte (Labor Management). [features/staff-management-scheduling]
**Huecos sin verificar:** arqueo de caja detallado, inventario, pricing, quejas.

## 5. ORACLE SIMPHONY (MICROS) — el patrón enterprise/hotelería

**Multi-propiedad (su esencia):** Enterprise Management Console (EMC) con jerarquía de 3 niveles — **Enterprise → Property → Revenue Center** (+ zonas opcionales) — y configuración por **herencia-con-override**: lo definido arriba cascadea; cualquier nivel inferior puede sobrescribir selectivamente (ej.: menú corporativo, precio por local). [docs.oracle: c_ent_mgmt_console; c_enterprise_inheritance_overrides]
**Distribution:** copiar registros de configuración entre propiedades/revenue centers (y hasta entre sistemas Simphony distintos, ej. test→prod) manteniendo object numbers idénticos. Patrón franquicia puro. [c_enterprise_distribution]
**Offline/resiliencia:** **CAPS (Check and Posting Service)** — servicio on-premise OBLIGATORIO, exactamente uno por propiedad: aísla a los clientes PoS de la latencia a la nube, maneja posteo, checks compartidos entre terminales y reporting local; en corte, encola store-and-forward y reenvía al reconectar. [simcm/t_shared_services_overview_caps]
**Tuning por dispositivo:** umbral de señal WiFi configurable (Offline/Reconnect Threshold 0-99) al cual las tablets pasan solas a modo offline — diseñado para redes inestables. [c_properties_wireless_signal_strength]
**Hotelería:** interfaz NATIVA con OPERA PMS — postea consumos del restaurante directo al folio del huésped con desglose granular (hasta 16 sales / 64 tax / 16 discount / 14 service-charge itemizers) + consulta de huésped por nombre/habitación. El estándar que Satori debería imitar en espíritu para su ambición hotelera. [c_opera_pms_enhanced_interface]
**Huecos sin verificar:** pricing/licenciamiento, quejas reales (complejidad/costo de implementación es fama conocida pero no sobrevivió verificación con fuente dura).

## 6. FUDO — el jugador LatAm

**Modelo de negocio (verificado en vivo):** núcleo barato + módulos — 3 planes (AR: Inicial/Avanzado/Pro) + Multisucursal a consultar. **Arqueo y movimientos de caja + impresión de comandas: desde el plan MÁS BARATO** (señal: caja es base, no premium). Inventario/recetas → plan medio; inventario valorizado + múltiples cajas/turnos + estado de resultados → plan alto. **KDS, gestión de mesas, facturación electrónica y ventas por comensal = add-ons pagos aparte.** [fu.do/es-ar/precios]
**Huecos sin verificar:** detalle funcional de cada módulo, facturación electrónica CR/LatAm (el claim del patrón de integración no sobrevivió verificación).

---

## Huecos honestos del research (para una tercera pasada si el dueño la pide)

1. **Quejas reales de usuarios (G2/Capterra/Reddit)** — los claims de reviews no sobrevivieron la verificación adversarial (subjetivos/inestables). Queda como lectura direccional, no como hallazgo.
2. **Pricing 2025-26** de Toast/Square/Lightspeed/TouchBistro/Simphony (solo Fudo quedó verificado).
3. **KDS y multi-local de Square y Lightspeed.**
4. **Facturación electrónica LatAm/CR** — sigue abierto; coincide con la tarea F0 del ROADMAP ("investigación de proveedores FE CR"), que ya estaba pendiente y es MÁS urgente que este research (bloquea F3).
