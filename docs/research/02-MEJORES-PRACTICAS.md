# Research PoS — Mejores prácticas POR FLUJO (síntesis transversal)

> Satori App · 2026-07-10 · Fase 2 del research. Fuentes: hallazgos verificados adversarialmente
> (3 votos contra fuente primaria) de las corridas 1 y 2 del deep research. Cada afirmación citada.
> **Recomendaciones = pendientes de firma del dueño.**

---

## 1. PROPINAS — cómo lo resuelven los grandes

**El estado del arte es más pobre de lo que parece — Satori ya está adelante en lo esencial:**

- **Toast (nativo) NO distribuye propinas: solo calcula un split sugerido** que el gerente dispersa a mano; la automatización real es un add-on pago (Tips Manager). Su Pooled Tips Report reparte solo propinas de tarjeta, entre los fichados **al momento de ABRIR el cheque** (no al cobrarlo), dividido por horas. [Toast docs: Pooling-Tips-and-Tipping-Out]
- **Square SÍ distribuye automático** (por transacción = split igualitario entre fichados; diario/semanal = por horas; o % fijo por rol), pero lo encierra tras planes pagos Plus/Premium/Shifts Plus. El default es propina directa: 100% para quien la cobró. [Square help 8141, 7654]
- **Lightspeed O-Series**: 4 modalidades de captura (pantalla PoS / datáfono / recibo / ninguna), propina agregable en checkout O post-venta desde el historial, y un **Tips report con "tips owing"** (propinas adeudadas como pasivo por empleado) — pero **ningún motor de pooling**. [Lightspeed O-Series 31329491401755]
- **Toast Shift Review** (el patrón más valioso): checkout de fin de turno por empleado, configurable como obligatorio, que **netea ventas en efectivo contra propinas de tarjeta** y dice explícitamente "el empleado le debe X al restaurante" o viceversa; propinas de tarjeta pagadas desde la gaveta o por planilla; propinas en efectivo **declaradas** (con % mínimo configurable sobre ventas en efectivo, por compliance fiscal US). [Toast: Shift-Review-Overview, Declaring-Cash-Tips]
- **Anti-patrón documentado (Toast):** el auto-close de las 4am captura cheques pagados-no-cerrados **SIN propina** → ajuste post-batch engorroso. Lección: un cierre automático nunca debe descartar plata en silencio. [Toast: Close-Out-Day + Add-Tips-after-Batched]

**Dónde queda Satori:** el pooling por puntos/roles con coberturas de Satori es MÁS automático que Toast nativo y no está detrás de un paywall como Square. La distinción efectivo/electrónico recién pasada a prod (la casa solo debe lo electrónico) es exactamente el patrón del Shift Review de Toast (neteo de streams) — ya lo tenemos, por la vía del movimiento real de caja.

**Ideas a considerar (pendientes de firma):**
- **"Tips owing" como pasivo visible por empleado** (Lightspeed): una vista de cuánto se le adeuda a cada empleado en electrónico no pagado. Hoy Satori lo tiene por turno, no por persona.
- **Checkout por empleado estilo Shift Review** (Toast): cuando el PoS propio esté vivo, un mini-cierre por salonero (sus ventas, sus propinas, su efectivo) — encaja con "Mi Turno" ya diseñado en el ROADMAP (§operación-roles #3).

## 2. CAJA / ARQUEO — el modelo de 3 capas

- **Toast separa tres cosas**: (a) *Shift Review* (por empleado), (b) *cash drawer closeout* (arqueo físico POR GAVETA al fin de turno, con conteo, over/short explícito — "Cash over / Cash short / No difference"), y (c) *Close Out Day* (cierre del día de negocio). **El arqueo tiene umbral configurable (Closeout Over/Short Max): si la diferencia lo excede, exige aprobación gerencial.** El depósito físico se registra aparte en Cash Deposits (excluye fondos iniciales). [Toast: adminCashDrawerOperations, adminCashDeposits, Close-Out-Day]
- **Toast automatiza el cierre**: a las 4am cierra solo cheques y desficha empleados — el cierre manual es opcional. (Con el edge case de propinas ya anotado.) [Toast: Close-Out-Day]
- **Square modela la caja como SESIONES de gaveta**: apertura solo desde el PoS con efectivo inicial, cierre con conteo + descripción, y **todo paid-in/paid-out queda en el historial de la sesión con descripción y total corriente** — un audit trail por sesión. Reporte de gaveta enviable por email. [Square help 8344, 8358]
- **Fudo cobra el arqueo desde el plan más barato** — señal de mercado: caja/arqueo es percibido como funcionalidad BASE, no premium. Múltiples cajas/turnos recién en el plan Pro. [fu.do/es-ar/precios]

**Dónde queda Satori:** el cierre de 2 fases (Mediodía/Noche) + conteo físico por separaciones + gate de ajuste con motivo + Opción B (ajuste como movimiento real al ledger) es equivalente o superior al estándar SMB. El umbral de Toast ya existe en Satori (₡500/$1 → motivo obligatorio + autorización por contraseña, mig 045).

**Ideas a considerar (pendientes de firma):**
- **"Over/short" explícito y acumulado**: reporte histórico de diferencias de cierre (cuánto y con qué frecuencia sobra/falta) — Toast lo trae; a Satori le falta la vista agregada (los datos ya existen en los movimientos de ajuste).
- **Email del cierre** (Square): mandar el resumen del Cierre del Día por correo automático al owner — Satori ya tiene infraestructura de emails de reportes.
- **Multi-gaveta**: irrelevante hoy (una caja), relevante al escalar (el modelo por-sesión de Square es el correcto y Satori ya modela cash_sessions así).

## 3. OFFLINE — la arquitectura de referencia

- **Toast "offline mode with local sync"**: un **hub local designado** (dispositivo fijo, Ethernet, uno por local) recibe todas las actualizaciones y las redistribuye a los dispositivos de la LAN sin nube — en corte de internet, las comandas siguen llegando a los KDS. Límites: sin internet no entran órdenes online; si cae la LAN misma, nada se pasa entre dispositivos. El modo legacy por-dispositivo (sin hub) está en deprecación. [doc.toasttab.com: platformOfflineKDSDevices, platformOfflineModeLocalSync, adminOfflineModeOverview]

**Dónde queda Satori:** el patrón hub-local de Toast es EXACTAMENTE el F5 "HUB LOCAL" ya escrito en el ROADMAP de Satori (mini-PC como servidor LAN, KDS sin internet, sync a la nube al volver). El research valida esa apuesta con el líder del mercado: no es sobre-ingeniería, es el estado del arte. El outbox idempotente de Satori (client_op_id) ya es la mitad cliente de ese diseño.

**Implicancia de diseño (para el PILAR de auth):** Toast resuelve multi-dispositivo con un hub que reduce la charla con la nube — el diseño de sesión/auth multi-dispositivo de Satori debería considerar el hub como parte de la respuesta (menos refresh contention si los dispositivos hablan con el hub).

## 4. PRICING / EMPAQUETADO — señales de mercado

- **Fudo (LatAm)**: núcleo barato + módulos (KDS, mesas, facturación electrónica, ventas por comensal se venden aparte); arqueo incluido desde el plan mínimo; inventario/recetas en plan medio; inventario valorizado + múltiples cajas + estado de resultados en el plan alto. [fu.do/es-ar/precios]
- **Square**: el tip pooling automático y features de equipo están detrás de Plus/Premium — la monetización va por las funciones de PLATA y equipo, no por el registro de ventas.

**Lectura para Satori:** lo que el mercado cobra caro (arqueo robusto, pooling automático, P&L, multi-caja) es lo que Satori ya construyó como base. Si algún día Satori se ofrece a terceros (hotelería/franquicias), el empaquetado modular de Fudo es la referencia de cómo se vende en LatAm.

## 5. COMANDERO / MESAS / KDS

- **TouchBistro**: plano de salón editable REMOTO desde el cloud con sync automático al local; analítica por mesa (tiempo sentado, gasto); transferencia de mesa sin perder la cuenta; splits por swipe (patentado). [touchbistro.com]
- **TouchBistro tercerizó su KDS** ("Powered by Fresh", hardware dedicado): hasta un líder iPad-first decidió no construir KDS propio. Señal: el KDS es más difícil de lo que parece — el de Satori (ya construido en staging) debe mantenerse deliberadamente simple.
- **Simphony**: umbral de señal WiFi configurable por dispositivo para pasar a offline automáticamente — robustez pensada para redes malas. [docs.oracle]

**Dónde queda Satori:** el comandero F1-F2 (PAX obligatorio, cursos, asiento, KDS con timers y orden escalonado por subcategoría) está bien especificado y a la altura. Ideas: la **edición remota del plano con sync** (TouchBistro) es un detalle de calidad para el editor de salón de F1; la **transferencia de mesa con atribución de métricas** ya está en las reglas transversales del ROADMAP — validada por el mercado.

## 6. INVENTARIO / COGS

- **Toast (xtraCHEF)**: foto/scan de factura → AI/ML extrae líneas → auto-codifica → sincroniza a contabilidad; costos por ingrediente/categoría/proveedor; recipe costing con plate cost y margen (tier Pro). [pos.toasttab.com/products/xtrachef]
- **Fudo**: inventario/recetas en plan medio; inventario VALORIZADO en plan alto — el mercado LatAm cobra premium por la valorización.

**Dónde queda Satori:** la Bandeja con foto+IA de Satori (Claude leyendo facturas CR → movimiento + tarea de revisión de inventario) **ya es el patrón xtraCHEF**, integrado al flujo de caja en vez de vendido aparte. El puente que falta (factura → líneas → inventario → costo por receta) es exactamente la F1.2-1.4 del ROADMAP + el SPEC de unificación §19 (P&L granular por línea). El research valida esa dirección: es lo que el líder cobra como add-on premium.

## 7. PERSONAL / ROLES / PERMISOS

- **TouchBistro**: cuentas individuales, permisos granulares por staff type, acciones sensibles (cambios de menú, payouts) restringidas; labor cost y ventas por empleado en vivo; fichaje en terminal; scheduling = producto aparte. [touchbistro.com]
- **Toast**: Shift Review por empleado como ritual de fin de turno (ver §1).

**Dónde queda Satori:** roles + RLS + `verify_manager_password` (server-side, mig 045) ya cubren el patrón de "acción sensible exige autorización". Lo que Satori NO tiene: **fichaje (clock in/out) y costo laboral en vivo** — hoy las horas se cargan a mano en propinas. Idea para decisión de producto: un fichaje simple alimentaría horas de propinas + labor cost del P&L. No urgente; anotarlo como candidato post-PoS.

## 8. MULTI-LOCAL / FRANQUICIA / HOTELERÍA (el norte del PILAR)

- **Simphony EMC**: jerarquía **Enterprise → Property → Revenue Center** con **herencia-con-override** — config corporativa cascadea, cada local sobrescribe lo suyo (precio local, disponibilidad). + **Distribution**: copiar configuración entre locales/sistemas con object numbers idénticos. [docs.oracle]
- **Simphony CAPS**: un servicio LOCAL obligatorio por propiedad que aísla del cloud y hace store-and-forward. La misma conclusión que Toast (hub local) y TouchBistro (red local cableada): **los tres líderes ponen un cerebro local en el restaurante.**
- **Simphony↔OPERA**: el PoS postea al folio del huésped con desglose granular — la referencia funcional si Satori apunta a hotelería.

**Dónde queda Satori:** las tres decisiones ya tomadas quedan VALIDADAS por el estado del arte — (1) `locations` desde el diseño (F1), (2) HUB LOCAL F5 (= CAPS/hub de Toast), (3) el PILAR de auth multi-tenant antes del rollout del PoS. **Recomendación de diseño concreta para el PILAR:** adoptar el patrón herencia-con-override de Simphony en el modelo de datos multi-local (config a nivel empresa → local → estación), y tratar el hub local no como "feature offline" sino como pieza de la arquitectura de sesión (menos contención de auth si los dispositivos hablan con el hub).

## 9. ANTI-PATRONES documentados (qué NO copiar)

1. **Cierre automático que descarta plata en silencio** (Toast 4am captura sin propina → ajuste engorroso). Regla Satori ya vigente: nada de plata se resuelve sin confirmación humana o queda irrecuperable. Mantenerla al automatizar cualquier cierre.
2. **Funcionalidad de plata detrás de paywall** (Square pooling, Toast Tips Manager): la fricción que empuja a los restaurantes a planillas Excel. Satori la evita por construcción.
3. **Propinas atadas al momento de ABRIR el cheque** (Toast Pooled Tips Report): atribución injusta en cambios de turno. El modelo por turno+horas+puntos de Satori es más justo.
4. **KDS con hardware cautivo** (TouchBistro/MicroTouch): Satori en TVs/mini-PC baratas es la decisión correcta para su contexto.

