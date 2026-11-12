# SPEC — Club Satori: referentes, créditos, PM y Local Club en la app (v2, 05-nov-2026)

> Estado: **borrador para revisión de Ismael.** Migración (§7) basada en el perfil técnico de Grok (`perfil-tecnico-sistema-creditos.md`, 05-nov).
> Reemplaza la página externa de créditos (creditos-73bac) y reactiva el CRM pausado (`src/modules/crm`, migraciones 004/005/007).
> Multi-local desde el día 1: todo lleva `location_id`.

## 0. Objetivo y principios
- **Una sola base de miembros** para todo lo que hoy está separado: referentes (tarjetas + créditos), concierges PM (comisiones), Local Club, turistas y equipo Satori.
- **La app es la fuente de verdad.** Toda la operación del club (escanear, registrar, canjear) se hace en la app, no en el PoS. El PoS de Nube de Fuego solo cierra la mesa con la promo vigente, y el puente controla que cada mesa con promo tenga su registro en la app. Así, si mañana se reemplaza el PoS, el club no cambia.
- **Libro mayor de solo inserción:** el saldo nunca se edita; se calcula. Cada movimiento tiene tipo, quién lo hizo y por qué. Esto resuelve lo que la página no permitía: los vencimientos, ajustes y restituciones quedan distinguibles de los canjes.
- **Sin tarjetas físicas ni carga diferida.** El referente tiene su QR en el Wallet. El turista lo escanea con la cámara y recibe un cupón digital. La caja escanea el cupón y todo queda registrado en el momento, con fecha de visita real. Se terminan la impresión de tarjetas, la foto por WhatsApp y los meses en cero.

## 1. Fases
| Fase | Qué | Cuándo (propuesto) |
|---|---|---|
| **F0** | Cerrar el registro público del CRM (hoy `customers_anon_insert WITH CHECK (true)`: cualquiera se crea con puntos o nivel arbitrarios). Va después de SEC-01. | Inmediato |
| **F1** | Referentes y concierges con **pase de Wallet + QR**; cupón digital del turista; escáner único en caja; créditos, canjes y PM; portal; alertas por Wallet; reportes; migración completa. **Se dejan de usar la página y las tarjetas físicas.** | Construcción nov–dic. Piloto con 3-5 referentes antes del 10-dic; salida general después del 15-ene, para no cambiar el circuito en plena alta |
| **F2** | Mejoras del cupón (guardarlo en el Wallet del turista, ofertas a turistas que dejaron contacto) y QR dinámico si hay abuso. | Feb–mar |
| **F3** | Local Club en el Wallet: socios, ofertas que cambian, premios por frecuencia, referidos, sorpresas. Reemplaza el descuento fijo. | Desde may (temporada baja) |

## 2. Flujos (F1)

### 2.1 Turista referido (reemplaza la tarjeta física)
1. **El referente** (recepcionista, host, tienda) tiene en su Wallet el **pase Satori** con su QR. Si no tiene Wallet, el mismo QR está en su link del portal.
2. **El turista escanea ese QR con la cámara** → se abre una página web de Satori (sin bajar nada) → se genera un **cupón 10 %** con su propio QR.
   - **Vale 5 días y se usa una sola vez.**
   - Opcional: nombre y WhatsApp o email para recibir ofertas (opt-in). Así se construye la base de turistas.
   - Botón «Guardar en Wallet» (deseable en F1; si no llega, en F2).
3. **En caja, el cajero abre la app → «Escanear»** y lee el cupón del celular del cliente. La app valida que esté vigente y sin usar, pide personas de la mesa + número de factura del PoS y lo marca usado. Las personas se le suman al referente en ese momento.
4. **El PoS** cierra la mesa con la promo 10 %, como hoy.
5. **El puente controla:** cada factura con 10 % de tarjeta tiene que tener un cupón usado. Las diferencias van a la bandeja de excepciones.

**Antiabuso:**
- máximo de cupones por referente por día (configurable);
- alerta si un referente genera muchos cupones que nadie usa;
- si un QR se publica en redes, se puede regenerar (el pase de Wallet se actualiza solo).
- El crédito solo se genera con un cupón usado en una mesa real con factura, así que no hay crédito sin consumo.

### 2.2 Canje de créditos del referente (R-01, revisado el 07-nov; auditoría ronda 3)
- **El QR público del referente (`/r/`) NO sirve para canjear.** Es público por diseño: está en la recepción, se comparte y
  se imprime. Escaneado en caja muestra el saldo y nada más. Lo mismo con «buscar» (plan B).
- **Canje = código de canje privado, de un solo uso.** El referente toca «Canjear» en su portal (`/p/{token}`) o en su pase
  de Wallet (F1e) y recibe un código de **6 caracteres** (QR `/k/{código}`) que **vence a los 10 minutos**. Generar
  otro invalida el anterior; tope de 5 por hora. La caja lo escanea (o escribe los 6 caracteres) → ve el saldo → canjea
  **1, 1,5 o 2 créditos** (de a 0,5, **máximo 2 por visita y por día**) con el pedido o la factura.
- En la base se guarda **solo el hash** del código. El canje lo consume en la misma transacción que el movimiento
  (orden de locks: operación → código → miembro). Mismo `p_op` = mismo canje; otro `p_op` con el mismo código = rechazado.
- **Tope de intentos fallidos:** 5 en 15 minutos por usuario de caja y por referente. Después, «Demasiados códigos
  equivocados: esperá 15 minutos».
- **Sin celular:** «Canje sin celular», solo owner o manager, con nota obligatoria. Queda la excepción `CANJE_SIN_CODIGO`,
  siempre visible, que no resuelve quien lo aprobó.
- **Aviso al referente en cada canje:** queda el evento en `club_alertas` para que lo dispare el pase de Wallet; mientras
  tanto, la confirmación del canje en caja ofrece «Avisarle por WhatsApp» (link wa.me con el canje y el saldo).
- El token del portal pasa a ser una **credencial de plata**: «Regenerar QR» cambia el código público y el token, y cada vez
  que alguien copia el link del portal queda en la auditoría.
- La mesa se cierra en el PoS como hoy («CRÉDITOS NUEVO» / forma de pago «Créditos»). El puente controla que el monto
  coincida (`CANJE_MONTO_DISTINTO`). Regla fija: una factura pagada con créditos no lleva ningún descuento.

### 2.3 Socio del Local Club
- **Recomendado: escanear el QR del pase del socio.** Es más rápido que buscar, no se equivoca de persona, no hay que decir nombres ni teléfonos en voz alta en la caja, y registra la visita en el momento (base para premios por frecuencia en F3).
- **Al escanear, la caja carga el número de factura del PoS.** El monto, los platos, las personas y la hora se traen solos por el puente. Así queda el consumo de cada socio (gasto por visita, frecuencia, platos favoritos, franja) sin tipear montos, que es donde aparecen los errores. Plan B, si el puente está caído: monto a mano, marcado «manual», que se concilia después.
- Esa información es la base de las promociones personalizadas de F3 (ej. «tu roll favorito», «hace 30 días que no venís», premio a quien gasta más en temporada baja).
- **Plan B de identificación:** búsqueda por nombre o los últimos 4 dígitos del teléfono, para el que olvidó el celular. Queda marcado «registro manual».
- Mientras no exista el pase del socio (F3), el LC se sigue registrando como hoy en el PoS (artículo LOCAL CLUB).

### 2.4 Un solo botón en caja
**«Escanear»** reconoce solo qué es: cupón de turista, pase de referente (canje) o pase de socio LC. Una sola pantalla para el cajero.

## 3. Modelo de datos (F1)
Todas las tablas llevan `location_id`. Todo se hace con migraciones aditivas, con firma de Ismael.

| Tabla | Campos clave | Notas |
|---|---|---|
| `club_negocios` | id, location_id, nombre, tipo (hotel, tienda, host, delivery, concierge, otro), activo | Hoy el negocio es texto libre («atrapasuenos», «Atrapasueños»). Normalizarlo permite rankings por negocio |
| `club_miembros` | id, location_id, tipo (`referente` \| `concierge_pm` \| `equipo` \| `socio` \| `turista`), nombre, negocio_id, teléfono, email, opt-in WhatsApp/email, `codigo` (único, para el QR), `token_portal`, estado, origen (`app` \| `migracion`), legacy_id | Equipo = regla «satori» de hoy, ahora como campo. Teléfono y email solo visibles para gerencia |
| `club_movimientos` (solo inserción) | id, location_id, miembro_id, tipo, personas (+/−, **unidad del saldo**), creditos (informativo en canjes), personas_por_credito, valor_credito_crc, factura_pos, cupon_id, fecha_visita, registrado_en, registrado_por, nota, `client_op_id` (idempotente), origen, legacy_ids | Tipos: `tarjeta`, `canje`, `vencimiento`, `ajuste`, `restitucion`. Corrección = movimiento inverso, nunca UPDATE ni DELETE |
| `club_pm_cargos` | id, location_id, miembro_id, factura_pos, subtotal_crc (desde el puente), pct, monto_crc, estado (`pendiente` \| `aprobado` \| `pagado` \| `anulado`), pagado_en, `cash_movement_id` | La comisión se calcula sola desde la factura. El pago se vincula al movimiento de caja de proveedores que ya existe (sin tocar `cashUtils`) |
| `club_cupones` | id, location_id, referente_id, codigo (único), creado_en, vence_en (+5 días), usado_en, usado_por, factura_pos, personas, contacto opt-in (nombre, WhatsApp/email), estado | Un solo uso. Al usarse genera el movimiento `tarjeta` del referente |
| `club_config` | location_id, valor_credito_crc (18.000), personas_por_credito (6), canje_min (1), canje_paso (0,5), max_creditos_por_visita (2), cupon_dias (5), cupones_max_dia_referente, solo_salon, vencimiento_meses (12), aviso_dias (30 y 7), pm_pct (10), pm_pausado (true hoy) | Todo configurable por local y con historial de cambios |
| `club_visitas` | id, location_id, miembro_id (socio), factura_pos, monto_neto, personas, platos (desde el puente), origen (`qr` \| `manual`), registrado_por, fecha | Consumo por socio. Mismo patrón para turistas con cupón (monto de la factura del cupón) |
| `club_alertas` | id, miembro_id, tipo, canal, enviado_en, estado | Registro de avisos |

- **Unidad del saldo: personas, no créditos** (como hoy). El libro guarda personas: + al usar un cupón, − al canjear (6 por crédito, 3 por medio crédito). Los créditos se **derivan**: `créditos = floor(p/6) + (resto ≥ 3 ? 0,5 : 0)`. «Personas para el próximo crédito» se calcula desde el mismo saldo. Así se replica exacto el sistema actual y no hay redondeos acumulados.
- **Un canje = un movimiento** (con `creditos` = 1, 1,5 o 2 y `personas` = −6, −9 o −12), no N filas como hoy.
- `personas_por_credito` y `valor_credito_crc` quedan guardados en cada movimiento. Si cambian, la historia no se reescribe.
- **Saldo:** vista `club_saldos` (Σ personas → créditos derivados), con la última actividad. Sin saldo duplicado: hoy el sistema tiene saldo guardado y recalculado, con 2 cuentas que no coinciden. Acá hay una sola fuente.
- **Concierge PM = campo `tipo`**, no el sufijo del nombre. Las comisiones se guardan en colones (hoy están ×100 y la pantalla las muestra como USD).

## 4. Pantallas (F1)
| Pantalla | Quién | Qué |
|---|---|---|
| Caja → **Escanear** (botón grande) | cajero, manager | Cupón turista → personas + factura · Pase referente → saldo + canje (1 / 1,5 / 2) · Pase socio LC → registrar visita · Plan B: búsqueda |
| Página pública del cupón | turista | Escanear el QR del referente → cupón con QR, vence en 5 días · opt-in de contacto · Guardar en Wallet |
| Club → Miembros | manager, owner | Alta y edición de referentes, concierges y negocios · enviar el pase de Wallet o el link · regenerar QR · historial por miembro · equipo aparte |
| Club → PM | owner, contador | Cargos desde facturas, aprobar, pagar (vincula caja), pausar el programa |
| Club → Excepciones | manager | Facturas del puente sin registro y registros sin factura |
| Club → Reportes | owner, manager | El reporte mensual v3 (acciones, ranking, a contactar, dormidos, nuevos, equipo, saldos por antigüedad, PM, calidad), con filtro por local y exportación a PDF/CSV |
| Portal del referente (link) | referente | Ver saldo, historial y su QR. Sin usuario: link con token, solo lectura |

## 5. Comunicación con referentes
- **Canal principal: el pase de Wallet.**
  - Muestra el saldo, las personas para el próximo crédito y el QR.
  - Cuando cambia el saldo, el pase se actualiza y el teléfono muestra un aviso en la pantalla bloqueada. **Es gratis** y reemplaza la mayoría de los WhatsApp.
- **Link del portal:** el detalle (historial, vencimientos), para quien no usa Wallet.
- **Avisos:**
  - «¡Completaste un crédito!», en el momento;
  - resumen mensual;
  - **«tus créditos vencen en 30 días» y «en 7 días»**.
- **Respaldo:** WhatsApp por link `wa.me` armado por la app. Más adelante, WhatsApp Business API si hace falta.

## 5.1 Vencimiento
- **12 meses sin actividad** (cualquier tarjeta o canje reinicia el plazo), con avisos a los 30 y a los 7 días. Configurable por local.
  **También la restitución** (la hace el owner) cuenta como actividad y reinicia el plazo: decisión de Ismael, 08-nov
  (es lo que hace `club_vencer`). Se cuenta desde la **última actividad**, no desde que se gana cada crédito.
- **Por qué 12 y no 6 meses:**
  - hoy hay solo 7,5 créditos (₡135.000) con actividad de hace 6 a 12 meses, así que bajar a 6 recupera muy poco;
  - y castiga al referente estacional, que manda gente en alta y viene a consumir en baja.
  - Si después de un año con el sistema nuevo el saldo vencible crece, se revisa.

## 6. Seguridad
- **Las tablas del club solo se leen con usuario de staff.** El portal del referente usa una función SECURITY DEFINER por token (como la mig 067). Las guardas NULL-seguras son obligatorias: aprendizaje de SEC-01b.
- **La página pública del cupón no toca tablas directo:** una función SECURITY DEFINER recibe el código del referente y crea el cupón, con límite por referente y por IP y validación de cada campo. Es lo opuesto al `WITH CHECK (true)` del CRM viejo.
- **Movimientos de solo inserción, también para el dueño de la tabla:** un trigger rechaza UPDATE, DELETE y TRUNCATE en
  `club_movimientos` a todos. La única excepción es el rol `postgres` cuando declara en la transacción
  `club.libro_mantenimiento`: `'migracion'` solo borra filas `origen = 'migracion'` (el migrador, al volver a migrar);
  `'pruebas'` es para las pruebas de staging, que terminan en ROLLBACK, y para borrar datos sintéticos. Para corregir un
  saldo: un ajuste o una restitución (solo owner).
- **Códigos que el staff no lee (CLUB-AUD-30):** ni el código del QR público (`club_miembros.codigo`) ni los de los cupones
  (`club_cupones.codigo`). La caja resuelve por función; owner y manager ven el código del referente por función. El
  contador no ve cupones.
- **Auditoría (CLUB-AUD-25):** `club_auditoria`, de solo inserción. Guarda altas, ediciones (antes y después), bajas,
  reactivaciones, regeneración del código, quién copió el link del portal, cambios de contacto (qué cambió, sin los
  valores) y negocios. Las resoluciones de excepciones son historial: cada una es una fila nueva. **Segregación:** quien
  registró el movimiento no resuelve su excepción (la resuelve el owner); `TARJETA_MANUAL` y `CANJE_SIN_CODIGO` no las
  resuelve quien las cargó o aprobó.
- **Puente (CLUB-AUD-27 y 31):** el modo pedido exige el puente al día (último ciclo hace menos de 5 minutos y sin error);
  si no, «Puente sin datos: elegí la factura» (plan B). La clave del pedido abierto lleva la fecha
  (`pedido:<AAAA-MM-DD>:<n>`) y un número repetido no se adivina.
- **Tarjeta física (CLUB-AUD-26):** flag por entorno, `club_config.tarjeta_manual_activa`. En prod está apagada: el piloto
  oficial es solo con pases de Wallet. En staging está prendida para el piloto interno en paralelo, con tope diario por
  miembro (30 personas por defecto) y la excepción `TARJETA_MANUAL` siempre visible.
- Canje con validaciones del lado de la base: saldo suficiente, máximo por visita e idempotencia.
- Teléfonos y correos: visibles solo para gerencia. Nunca en reportes ni exports del bot.

## 7. Migración completa (F1)
**Fuente:** export de Grok (Firestore `creditos-73bac`, negocio `uPberDoE9w19ydF6bZSA` «Satori Terrace Sushi Bar»). Con contactos: queda solo en la máquina de Grok hasta que Claude Code lo pida.

| Origen (Firestore) | Destino | Regla |
|---|---|---|
| `businesses` (Satori) | `club_config` del local Santa Teresa | rate 6. **Burger House no se migra** (no es de Satori) |
| `referrers` (340; 88 con `deleted`) | `club_miembros` + `club_negocios` | `legacy_id = _id`. `deleted` pasa a estado «baja». `workPlace` se normaliza a `club_negocios` (revisión manual de variantes). Tipo: nombre o negocio con «satori» → `equipo`; sufijo «PM» o movimientos de club → `concierge_pm`; el resto → `referente`. Teléfonos a E.164 (+506 por defecto si tienen 8 dígitos); «None» o texto → vacío |
| `referrals` credit (1.816) | `club_movimientos` tipo `tarjeta` | `personas = peopleCount`, `fecha_visita = createdAt` (marcada «aproximada = fecha de carga»), `origen='migracion'`, sin operador ni factura |
| `referrals` debit (926) | `club_movimientos` tipo `canje` | Se agrupan los N docs del mismo referente en el mismo minuto como **un** canje (1, 1,5, 2…). Se guardan los ids originales |
| 136 debits del 05-nov 11:09–11:42 (lista con ids de Grok) | tipo `vencimiento` | Nunca como canje |
| `referrals_club` credit (104) / debit (21) | `club_pm_cargos` (estado `pendiente`) / pagos | `amount / 100` = colones (validar contra el reporte: ₡226.375 PM + ₡74.482 sin sufijo) |
| `users_info` | **no se migra**: solo sirve para validar | Las 2 cuentas con desfase se resuelven con la suma de movimientos |

**Decisiones de Ismael para la migración (05-nov):**
- **13 nombres duplicados con distinto negocio:** probablemente la misma persona que cambió de trabajo. Claude Code arma la lista y Ismael los revisa uno por uno antes del corte. Mientras tanto, no se fusiona nada automáticamente.
- **12 cuentas no-PM con monto de club:** sí son concierges → `tipo = concierge_pm`.
- **Variantes de negocio:** sí se unifican. Claude Code propone la tabla de equivalencias e Ismael la aprueba.
- **Burger House:** no es de Satori (lo usa el desarrollador de la página para otro cliente). **No se migra.**
- **Privacidad al cerrar:** el proyecto Firebase de la página es del desarrollador, y tiene los teléfonos de los referentes de Satori. Al terminar los 3 meses de solo lectura, pedirle por escrito que borre los datos de Satori (`businessId uPberDoE9w19ydF6bZSA`) y quitar los accesos.

**Validación (Claude Code la corre y reporta):**
- saldo de personas y créditos por miembro igual al recálculo de Firestore del día del corte (en total: 66 créditos);
- totales por mes iguales al «Mes a mes», con la zona horaria corregida: el sitio agrupa en UTC y la app en hora de Costa Rica, así que pueden moverse movimientos de fin de mes;
- PM pendiente igual a ₡300.857.

**Corte:**
- semana en paralelo;
- congelar la página;
- export final;
- migración;
- la página queda en solo lectura 3 meses.

## 8. Decisiones registradas (Ismael, 05-nov)
- Se escanea con la app, no con el PoS. El PoS solo carga la promo y el puente controla.
- **Sin tarjetas físicas ni stickers:** QR del referente en el Wallet → el turista lo escanea → cupón digital de 5 días y un solo uso.
- Canje de 1, 1,5 o 2 créditos por visita (máximo 2).
- Vencimiento automático: sí, con avisos. Plazo recomendado de 12 meses (Ismael evaluaba 6).
- Se mantienen las reglas: ₡18.000 por crédito, 1 cada 6 personas, máximo 2 por visita.
- Referentes: resumen en Wallet + detalle en un link.
- Siempre multi-local.
- Migración completa del historial.
- Local Club sigue con descuento por ahora (posible baja al 10 % en las próximas semanas); se rediseña en F3.
- PM: comisión desde la factura del PoS; **programa en pausa por temas contables** (se construye con el interruptor `pm_pausado`).
- Créditos de cuentas del equipo activas: se mantienen. Inactivas más de 12 meses: canceladas el 05-nov.

## 9. Pendientes para cerrar el spec
1. ~~Perfil técnico de Grok~~ ✅ recibido el 05-nov. Burger House no se migra.
2. Definición contable con el contador: el crédito como pasivo, el canje como «a crédito» o regalía, y el PM como gasto.
3. **Cuentas de Wallet** (sociedad LCT Desarrollos; Satori es la marca):
   - Google: ✅ Issuer ID `3388000000023220960`, en modo prueba. La publicación se pide cuando exista la clase del pase.
   - Apple: D-U-N-S pedido el 05-nov; después, inscripción como «Organization» con satoricostarica.com.
   - Dominio: subdominio `club.satoricostarica.com` para el cupón; Ismael tiene el control del dominio.
4. Confirmar 12 meses de vencimiento.
5. Plan de transición de las tarjetas físicas que ya están repartidas: se aceptan hasta una fecha y la caja las registra por búsqueda manual.

## 10. F2 y F3 (dirección, se detalla después)
- **F2:**
  - cupón del turista guardado en el Wallet;
  - ofertas a turistas con opt-in;
  - QR dinámico del referente si hay abuso.
  - Misma base técnica que el pase de Catucza.
- **F3 Local Club:**
  - socio con su pase y QR;
  - ofertas por franja o temporada que llegan al Wallet;
  - premios por frecuencia en producto, no en %;
  - referidos que suman.
  - Reusa `customers`, `loyalty_config` y `loyalty_rewards` del CRM pausado.
  - Un solo beneficio por cuenta.
