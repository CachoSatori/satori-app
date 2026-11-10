# Plan de activación del piloto del Club en prod (Santa Teresa)

> 10-nov. **Qué falta para que el Club funcione en prod, en Santa Teresa, con clientes reales**, en orden.
> **Las fechas son estimadas:** cada paso a prod va con su firma, después de la auditoría de su paquete, y nunca se
> mergea entre las **17:00 y las 23:00 CR**. Si una auditoría pide cambios, el paso y los siguientes se corren.
> El detalle técnico de cada paso del Club está en el [RUNBOOK](RUNBOOK-piloto.md). Acá va el resumen para decidir y
> coordinar.

## En una mirada

**Ya está en prod:**
- el puente del PoS (081, 082 v3 y el Edge v3, 09-nov);
- la seguridad por rol activo (068, 069 y 085, esta última el 10-nov).

**Lo que falta, en 4 etapas:**
1. **Caja:** sus migraciones pendientes (087 a 093), antes que el Club, porque Supabase no aplica una versión menor que
   la última aplicada.
2. **Agente nuevo del puente** (#83). Recomendado antes del piloto.
3. **El pase del Club:** la base (075 como 150 y 100 como 151), club-web con su dominio y Turnstile, la carga de saldos
   y el merge.
4. **Prueba interna con el personal en prod**, y después **clientes reales**. El pase de Wallet puede venir una o dos
   semanas después.

**Fecha estimada para clientes reales: martes 17-nov**, si las firmas y auditorías salen sin cambios grandes.

## 1. Lista ordenada

**Imprescindible:** sin eso el Club no arranca, o arranca sin un control importante. **Recomendado:** conviene antes,
pero no bloquea. **Después:** puede venir con el piloto andando.

| # | Paso | ¿Hace falta para arrancar? | Depende de | Fecha estimada |
|---|---|---|---|---|
| 1 | **087 y 088 de caja** (auditoría de cambios de empleados; «recibe reparto de cocina»). Van ahora, o pasan al bloque 152+ | Decisión del dueño (abajo) | — | mié 11-nov |
| 2 | **089 y 090 de caja** (anon sin permisos sobrantes; tablas nuevas sin permisos para anon). La 090 todavía es borrador | Imprescindible por el orden: la regla fijada es 085 → 089 → 090 → 091 → 092 → Club | 085 (hecha) | mié 11-nov |
| 3 | **091 de caja** (multilocal fase 0: catálogo de locales `locations`) | **Imprescindible:** la 100 del Club se apoya en esa tabla | 089, 090 | jue 12-nov |
| 4 | **092 de caja** (solo el owner borra un empleado con login del PoS) | Imprescindible por el orden | 091 | jue 12-nov |
| 5 | **093 de caja** (las lecturas de ventas exigen cuenta activa; Grok 126) | Recomendado. Si va después del Club, se renumera a 152+ | 092 | jue 12-nov |
| 6 | **Agente nuevo del puente** en la PC del PoS (#83: `4d3513a` → `5da233a`). Ensayo en staging hecho (09-nov, con dos cierres de caja) | **Recomendado.** Sin él no llegan la mesa de la factura, el consecutivo ni la clave FE: las cuentas divididas cruzan peor y no se busca una factura por los dígitos del tiquete. El Club funciona igual | — (no toca la base) | vie 13-nov, por la mañana |
| 7 | **Juntar el Club en una sola rama:** los PR del Club (#78, #82, #85, #86, #87, #88, #91 y #81) entran al PR #59, y se re-auditan como un solo paquete | Imprescindible | — | jue 12 – vie 13-nov |
| 8 | **Paquete del pase del Club** (formato de la plantilla, como el de la 085): renumerar 075 → 150 y 100 → 151, el diff de catálogo staging ↔ prod (G-61), lecturas previas, prueba de humo, vuelta atrás | Imprescindible | 7 | vie 13-nov |
| 9 | **Pase del Club en prod (base):** la 150 (todo el Club), el alta de los locales (**los dos apagados**; el RUNBOOK da de alta Santa Teresa encendido, pero así nadie opera hasta la prueba interna), la 151 (catálogo de locales) y la clave de club-web | Imprescindible | 2–5, 8 | lun 16-nov, por la mañana |
| 10 | **club-web en prod:** Cloudflare Pages `satori-club` con las variables de prod, los topes (`RL_CREAR`, `RL_LEER`), **Turnstile de prod** y el **dominio** `club.satoricostarica.com` | **Imprescindible:** sin club-web no hay cupones de turistas ni alta de socios por QR. Sin Turnstile, el alta y los cupones responden 503 | 9 | lun 16-nov |
| 11 | **Carga única del lanzamiento:** la página vieja (Firestore) y las tarjetas de papel, con la base del Club vacía, fuera de servicio y con el sha256 firmado (G-56) | **Imprescindible** si los anfitriones de hoy tienen que entrar con su saldo | 9 | lun 16-nov, fuera de servicio |
| 12 | **Configuración del local:** códigos del PoS (856, 857, 1123), sección de cortesías (17/40), cortesías del sorteo, topes, empleados con su login del PoS, `lc_excepciones_desde` = el día del lanzamiento, tarjeta física apagada | Imprescindible | 9 | lun 16-nov |
| 13 | **Merge del PR #59** (la app publicada con `/club`). Branching ve las versiones ya aplicadas y no las repite | Imprescindible | 9–12 | lun 16-nov, antes de las 17:00 |
| 14 | **Prueba interna en prod con el personal** (§3): se enciende Santa Teresa **sin anunciarlo** (nadie de afuera tiene los QR ni el enlace del alta) | Imprescindible | 13 | lun 16 (tarde, antes del servicio) y mar 17-nov |
| 15 | **Encender el Club para clientes:** promoción «Local Club» vigente, el PoS del Local Club de 15 % a 10 %, mensajes a anfitriones y socios, carteles con el QR | Imprescindible | 14 | **mar 17-nov** |
| 16 | **Pase de Wallet** (Google): terminar la sincronización (B3) y la prueba en un teléfono (B5) | **Después:** el portal y la caja funcionan sin el pase | 10 | semana del 23-nov |
| 17 | **Apple Wallet** | Después: hace falta el D-U-N-S | 16 | sin fecha |
| 18 | **CLAUDE-HALL-05, bloque A** (sacar MAINTAIN a `authenticated` en las 10 tablas del Club) | Después (higiene) | 9 | semana del 23-nov |
| 19 | **Batería por tramos** (#91) y el costo de «descuento sin respaldo» | Después (solo pruebas y rendimiento) | — | cuando se pueda |

**Por qué este orden.** Supabase **no aplica una migración con número menor que la última aplicada**. Por eso:
- las de caja (087–093) van **antes** que el Club (150–151), o se renumeran a 152+;
- la 091 tiene que estar antes de la 151, porque la 151 usa su tabla de locales.

## 2. Qué necesito del dueño

| Para | Qué | Cuándo |
|---|---|---|
| Paso 1 | **Decidir la 087 y la 088:** ¿van ahora (antes que el Club) o pasan al bloque 152+? | mié 11-nov |
| Pasos 2–5 | Firmas de los paquetes de caja (los arma la sesión de caja) y la ventana | 11–12-nov |
| Paso 6 | Firma del paquete del agente nuevo, una ventana fuera de servicio (~15 min) y estar en la PC del PoS | vie 13-nov |
| Paso 8 | Firma del paquete del pase del Club, después de la auditoría | vie 13-nov |
| Paso 10 | **Cloudflare:** crear (o confirmar) el proyecto de Pages `satori-club`; cargar como Secret la `CLUB_WEB_KEY` de prod (nueva, nunca la de staging); `SUPABASE_URL` y `SUPABASE_ANON_KEY` de prod; los dos topes | lun 16-nov |
| Paso 10 | **Turnstile:** crear el widget para `club.satoricostarica.com`. La clave del sitio va en el build y la secreta como Secret. **No puede ser una clave de prueba** (que empiece con `1x`, `2x` o `3x`) | lun 16-nov |
| Paso 10 | **DNS:** apuntar `club.satoricostarica.com` al proyecto `satori-club` | lun 16-nov |
| Paso 11 | **Export de Firestore depurado** (manifiesto final) y el **CSV de las tarjetas de papel**, y firmar el sha256 de la carga | antes del lun 16-nov |
| Paso 12 | **Decisiones del local:** las cortesías del sorteo (qué artículos); los topes (cupones por día y por minuto, visitas del socio, tope del anfitrión nuevo, altas por día); qué empleados tienen login del PoS; la fecha de arranque de las excepciones | antes del lun 16-nov |
| Paso 14 | Dos o tres personas del equipo para la prueba interna (§3) y un turno de 30 min antes del servicio | lun 16-nov |
| Paso 15 | Cambiar en el PoS el Local Club de 15 % a 10 %, el mismo día. Mandar los mensajes a anfitriones y socios (borradores en `piloto/`). Imprimir los carteles con el QR del alta | mar 17-nov |
| Paso 16 | Cuenta de **Google Pay & Wallet Console** (issuer) y la **cuenta de servicio**: sus claves se cargan como secretos del Edge de prod, nunca por chat. Un Android con Google Wallet para la prueba | semana del 23-nov |
| Paso 17 | D-U-N-S para Apple | sin fecha |

**Revisar antes del paso 15** (decisiones vigentes, por si cambió algo):
- el criterio de «es local» que valida la caja;
- el premio por referir: cortesía, tope por mes y vencimiento;
- la vigencia de la promoción «Local Club»: días, horario y si entra el menú de mediodía.

## 3. Qué se prueba con el personal antes de abrir a clientes

**En staging, antes del pase (jue 12 – vie 13-nov):**
- **Recorrido de la caja** con la guía rápida (`piloto/guia-rapida-caja.pdf`), con un cajero real:
  - escanear un cupón;
  - elegir el pedido;
  - el plan B con una factura en R;
  - registrar la visita de un socio y el canje con código;
  - el alta de un socio en caja.
- **Gerencia:** resolver una excepción, confirmar un alta y aprobar personas pendientes.
- **Hace falta** que la vista previa de staging deje entrar: el dueño corrige las variables de Preview en Cloudflare
  (pasos que ya le pasé).

**En prod, con Santa Teresa encendido sin anunciarlo (lun 16 tarde – mar 17-nov).** No hay un modo «solo para el
equipo»: encendido, funciona para cualquiera que tenga un QR o el enlace, y por eso todavía no se reparten.
1. Un anfitrión de prueba (alguien del equipo) genera su QR. Otra persona saca un cupón desde su teléfono (club-web
   real, con Turnstile) y lo usa en una mesa real: suma personas.
2. Un socio de prueba se anota por `/alta` y la caja lo valida. En su visita, la pantalla dice qué aplicar, y en el PoS
   se marca el 856.
3. Un canje con el código del portal.
4. **Al día siguiente,** Excepciones: lo de la prueba cruza con sus facturas, y las que salgan tienen explicación.
5. Reportes: el mes en curso muestra lo de la prueba.
6. **Lo de prueba no se borra** (el libro es de solo inserción): se marca con una nota o un ajuste, y se anota.

**Criterio para abrir a clientes:**
- los 5 puntos dan lo esperado;
- ninguna excepción sin explicación;
- el puente sin error durante la prueba.

## 4. Cómo se apaga si algo sale mal

| Qué pasa | Qué se hace | Qué queda |
|---|---|---|
| **Cualquier problema con clientes** | Owner → Club → **Locales** → **Apagar** (un clic; o `club_activo = false`) | Se cortan altas, visitas, cupones, canjes y premios en el local. No se borra nada. La caja cobra como antes |
| club-web falla o se abusa | Sacar el dominio en Cloudflare (o rotar la `CLUB_WEB_KEY`: la base deja de aceptar a club-web) | La caja sigue funcionando |
| El pase de Wallet manda algo mal | Apagar la emisión | El portal y la caja siguen |
| El agente nuevo falla | Vuelta atrás del #83: la tarea vuelve al `.cmd` viejo; la carpeta vieja está intacta (~2 min) | El puente sigue con el agente de antes |
| La base del Club falla **antes de que haya actividad** | El rollback de la 150 (está en el paquete) | — |
| La base del Club falla **con actividad** | **No se borra.** Se apaga el local y se arregla con una migración nueva | Los saldos y movimientos quedan |
| La app (`/club`) falla | Revertir el código del merge. **Los `.sql` ya aplicados nunca se borran** | La base queda como está |

## 5. Lo que queda para después del arranque

- **Pase de Wallet** (Google, semana del 23-nov) y **Apple** (con el D-U-N-S). Los mensajes que dicen «[con el pase]» se
  mandan cuando esté.
- **Arreglos del salón S1, S3–S7** (cuentas divididas, mesas juntadas, elegir la factura de una visita de socio).
- **Promociones v2, alta por QR con origen, referidos, canjes abiertos y avisos por el pase:** el diseño va en
  `SPEC-PROMOS-V2-Y-ALTA-QR.md`, sin código.
- **P-R7-A:** la regla de pasar de socio a anfitrión (espera el OK).
- **Nosara:** su agente, su secreto y encender el local.
