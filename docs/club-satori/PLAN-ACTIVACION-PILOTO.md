# Plan de activación del piloto del Club en prod (Santa Teresa)

> 10-nov (actualizado con el calendario nuevo del dueño). **Qué falta para que el Club funcione en prod, en Santa Teresa,
> con clientes reales**, en orden. Cada paso a prod va con su firma, después de la auditoría de su paquete, y nunca se
> mergea entre las **17:00 y las 23:00 CR**. Si una auditoría pide cambios, el paso y los siguientes se corren.
> El detalle del pase del Club está en su paquete ([PASE-150-151-club.md](../pases/PASE-150-151-club.md)) y el de cada
> verificación, en el [RUNBOOK](RUNBOOK-piloto.md). Acá va el resumen para decidir y coordinar.

## En una mirada

**Ya está en prod:**
- el puente del PoS (081, 082 v3 y el Edge v3, 09-nov);
- la seguridad por rol activo (068, 069 y 085, esta última el 10-nov).

**Calendario:**

| Día | Qué |
|---|---|
| **mar 10-nov** | **089 y 090** de caja. **Cloudflare del Club** (proyecto `satori-club`, Turnstile de prod y DNS): el dueño con Claude. El Club ya está en un solo PR (#59) y el paquete del pase armado (#93) |
| **mié 11-nov** | Por la mañana, el **agente nuevo del puente** (#83). Después, **091 → 093** de caja. El G-61 «antes» con prod ya en la 093 |
| **jue 12-nov** | Por la mañana, el **pase del Club** (merge del #59: Branching aplica la 150 y la 151) y la configuración del local. Por la tarde, **la prueba interna** con el personal |
| **vie 13-nov** | **Revisar las excepciones** de la prueba y **decidir si se abre a clientes**: el mismo vie 13 o el lun 16 |

## 1. Lista ordenada

**Imprescindible:** sin eso el Club no arranca, o arranca sin un control importante. **Recomendado:** conviene antes,
pero no bloquea. **Después:** puede venir con el piloto andando.

| # | Paso | ¿Hace falta para arrancar? | Depende de | Cuándo |
|---|---|---|---|---|
| 1 | **089 y 090 de caja** (anon sin permisos sobrantes; tablas nuevas sin permisos para anon) | Imprescindible por el orden: 085 → 089 → 090 → 091 → 092 → 093 → Club | 085 (hecha) | **mar 10-nov** |
| 2 | **Cloudflare del Club, antes del pase:** proyecto de Pages `satori-club` (rama de producción `main`) con `SUPABASE_URL` y `SUPABASE_ANON_KEY` de prod y los topes `RL_CREAR` y `RL_LEER`; **Turnstile de prod** (widget del dominio; nunca una clave de prueba `1x`/`2x`/`3x`); **DNS** del dominio al proyecto. La `CLUB_WEB_KEY` de prod **no**: va el día del pase (paso 7) | **Imprescindible:** sin club-web no hay cupones de turistas ni alta de socios por QR; sin Turnstile, el alta y los cupones responden 503 | — | **mar 10-nov**, el dueño con Claude |
| 3 | **Agente nuevo del puente** en la PC del PoS (#83: `4d3513a` → `5da233a`). Ensayo en staging hecho (09-nov, con dos cierres de caja) | **Recomendado.** Sin él no llegan la mesa de la factura, el consecutivo ni la clave FE: las cuentas divididas cruzan peor y no se busca una factura por los dígitos del tiquete. El Club funciona igual | — (no toca la base) | **mié 11-nov, por la mañana** |
| 4 | **091, 092 y 093 de caja** (multilocal fase 0 con el catálogo `locations`; solo el owner borra un empleado con login del PoS; lecturas de ventas con cuenta activa) | **La 091 es imprescindible:** la 151 del Club se apoya en su `locations`. La 092 y la 093, por el orden | 089, 090 | **mié 11-nov** |
| 5 | **Club en un solo PR:** #78, #82, #85, #86, #87, #88, #91 y #81 dentro del #59, con `main` adentro. ✅ **Hecho el 10-nov** (batería 597/597 en staging) | Imprescindible | — | ✅ 10-nov |
| 6 | **Paquete del pase del Club** (#93, formato del PASE-089): 075 → 150 y 100 → 151, G-61, lecturas previas, humo antes y después, vuelta atrás y firma. ✅ **Armado el 10-nov**; falta la auditoría y la firma | Imprescindible | 5 | auditoría mar 10 – mié 11 |
| 7 | **Pase del Club en prod: merge del #59 → Branching aplica la 150 y la 151**, como la 085 y la 089 (no se aplica nada a mano: entre la 150 y la 151 no tiene que pasar nada). Después: alta de los locales **los dos apagados**, el dominio y la **`CLUB_WEB_KEY` de prod** (se carga ese día) | Imprescindible | 1, 2, 4, 6 | **jue 12-nov, por la mañana** |
| 8 | **Configuración del local:** las decisiones del dueño del 10-nov están registradas en el paquete (§6.4 del PASE-150-151) | Imprescindible | 7 | jue 12-nov |
| 9 | **Carga única del lanzamiento:** la página vieja (Firestore) y las tarjetas de papel, con la base del Club vacía y el sha256 firmado (G-56). **Tiene que ir antes de encender:** después de la prueba interna la base ya no está vacía | **Imprescindible** si los anfitriones de hoy tienen que entrar con su saldo | 7 | jue 12-nov, antes de la prueba |
| 10 | **Prueba interna en prod con el personal** (§3): se enciende Santa Teresa **sin anunciarlo** (nadie de afuera tiene los QR ni el enlace del alta) | Imprescindible | 7–9 | **jue 12-nov, por la tarde** (antes del servicio) |
| 11 | **Revisar las excepciones de la prueba** y decidir la apertura | Imprescindible | 10 | **vie 13-nov** |
| 12 | **Abrir a clientes:** `lc_excepciones_desde` = ese día; promoción «Local Club» vigente; el PoS del Local Club de 15 % a 10 %; mensajes a anfitriones y socios; carteles con el QR | Imprescindible | 11 | **vie 13 o lun 16-nov** (decisión del vie 13) |
| 13 | **087 y 088 de caja** (auditoría de cambios de empleados; «recibe reparto de cocina»). Van **después** del Club, al bloque de pase **152+**: el número se asigna cuando se arma cada paquete. Lo mismo la 093 si se atrasa y queda después del Club | No bloquea el Club | Club en prod | cuando estén listas |
| 14 | **Pase de Wallet** (Google): terminar la sincronización (B3) y la prueba en un teléfono (B5) | **Después:** el portal y la caja funcionan sin el pase | 7 | semana del 23-nov |
| 15 | **Apple Wallet** | Después: hace falta el D-U-N-S | 14 | sin fecha |
| 16 | **CLAUDE-HALL-05, bloque A** (sacar MAINTAIN a `authenticated` en las 10 tablas del Club) | Después (higiene) | 7 | semana del 23-nov |
| 17 | El costo de «descuento sin respaldo» (la batería por tramos ya está hecha, #91) | Después (rendimiento) | — | cuando se pueda |

**Por qué este orden.** Supabase **no aplica una migración con número menor que la última aplicada**. Por eso:
- la caja que va antes del Club (089–093) entra primero; lo que quede para después (087, 088) toma **152+**;
- la 091 tiene que estar antes de la 151, porque la 151 usa su tabla de locales.

## 2. Qué necesito del dueño

| Para | Qué | Cuándo |
|---|---|---|
| Paso 1 | Firmas de los paquetes de la 089 y la 090 (los arma la sesión de caja) y la ventana | mar 10-nov |
| Paso 2 | **Cloudflare, con Claude:** crear (o confirmar) el proyecto `satori-club`; cargar `SUPABASE_URL` y `SUPABASE_ANON_KEY` de prod y los dos topes; crear el **widget de Turnstile** del dominio (la clave del sitio va en el build y la secreta como Secret); apuntar el **DNS** | **mar 10-nov** |
| Paso 3 | Firma del paquete del agente nuevo, una ventana fuera de servicio (~15 min) y estar en la PC del PoS | mié 11-nov, por la mañana |
| Paso 4 | Firmas de la 091, la 092 y la 093 y su ventana | mié 11-nov |
| Paso 6 | **G-61 «antes»:** después de la 093, correr el catálogo en el editor SQL de prod (solo lectura) y pasarle el CSV a Claude (no tiene datos de personas); revisar y firmar las diferencias esperadas en el #93. Después, la firma del paquete | mié 11-nov |
| Paso 7 | **Generar la `CLUB_WEB_KEY` de prod** en su PC y cargarla como Secret en Cloudflare (nunca por chat); cargar su sha256 en la base | jue 12-nov |
| Paso 9 | **Export de Firestore depurado** (manifiesto final) y el **CSV de las tarjetas de papel**, y firmar el sha256 de la carga | **antes del jue 12-nov** |
| Paso 10 | **Al menos una cortesía del sorteo** cargada en Club → Promociones (con una activa alcanza para encender); dos o tres personas del equipo y un turno de 30 min antes del servicio | jue 12-nov |
| Paso 11 | **Decidir el día de la apertura** (vie 13 o lun 16) | vie 13-nov |
| Paso 12 | Cambiar en el PoS el Local Club de 15 % a 10 %, el mismo día. Mandar los mensajes a anfitriones y socios (borradores en `piloto/`). Imprimir los carteles con el QR del alta | el día de la apertura |
| Paso 14 | Cuenta de **Google Pay & Wallet Console** (issuer) y la **cuenta de servicio**: sus claves se cargan como secretos del Edge de prod, nunca por chat. Un Android con Google Wallet para la prueba | semana del 23-nov |
| Paso 15 | D-U-N-S para Apple | sin fecha |

**Decisiones del local, ya tomadas (10-nov).** Quedan registradas en el paso de configuración del paquete
(PASE-150-151 §6.4), no como pendientes:
- `socio_visitas_por_dia` = 1 (global) y `socio_visitas_semana_max` = 7;
- `anfitrion_tope_mes_crc` = 150000; los otros topes, en sus valores por defecto;
- `lc_excepciones_desde` = el día de la apertura a clientes;
- las cortesías del sorteo quedan abiertas: son datos (Club → Promociones) y se cargan cuando el dueño las defina;
- los `pos_login` ya están en Empleados: no hay que cargar nada.

**Revisar antes de abrir** (decisiones vigentes, por si cambió algo):
- el criterio de «es local» que valida la caja;
- el premio por referir: cortesía, tope por mes y vencimiento;
- la vigencia de la promoción «Local Club»: días, horario y si entra el menú de mediodía.

## 3. Qué se prueba con el personal antes de abrir a clientes

**En staging, antes del pase (mar 10 – mié 11-nov).** La vista previa de staging ya deja entrar.
- **Recorrido de la caja** con la guía rápida (`piloto/guia-rapida-caja.pdf`), con un cajero real:
  - escanear un cupón;
  - elegir el pedido;
  - el plan B con una factura en R;
  - registrar la visita de un socio y el canje con código;
  - el alta de un socio en caja.
- **Gerencia:** resolver una excepción, confirmar un alta y aprobar personas pendientes.

**En prod, jue 12-nov por la tarde, con Santa Teresa encendido sin anunciarlo.** No hay un modo «solo para el equipo»:
encendido, funciona para cualquiera que tenga un QR o el enlace, y por eso todavía no se reparten.
1. Un anfitrión de prueba (alguien del equipo) genera su QR. Otra persona saca un cupón desde su teléfono (club-web
   real, con Turnstile) y lo usa en una mesa real: suma personas.
2. Un socio de prueba se anota por `/alta` y la caja lo valida. En su visita, la pantalla dice qué aplicar, y en el PoS
   se marca el 856.
3. Un canje con el código del portal.
4. **El vie 13-nov,** Excepciones: lo de la prueba cruza con sus facturas, y las que salgan tienen explicación.
5. Reportes: el mes en curso muestra lo de la prueba.
6. **Lo de prueba no se borra** (el libro es de solo inserción): se marca con una nota o un ajuste, y se anota.

**Criterio para abrir a clientes** (se decide el vie 13-nov):
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
| La base del Club falla **antes de que haya actividad** | La vuelta atrás del paquete (PASE-150-151 §8: la 151 y después la 150, y el revert del merge) | — |
| La base del Club falla **con actividad** | **No se borra.** Se apaga el local y se arregla con una migración nueva (152+) | Los saldos y movimientos quedan |
| La app (`/club`) falla | Revertir el código del merge. **Los `.sql` ya aplicados nunca se borran** | La base queda como está |

## 5. Lo que queda para después del arranque

- **Pase de Wallet** (Google, semana del 23-nov) y **Apple** (con el D-U-N-S). Los mensajes que dicen «[con el pase]» se
  mandan cuando esté.
- **Arreglos del salón S1, S3–S7** (cuentas divididas, mesas juntadas, elegir la factura de una visita de socio).
- **Promociones v2, alta por QR con origen, referidos, canjes abiertos y avisos por el pase:** el diseño va en
  `SPEC-PROMOS-V2-Y-ALTA-QR.md`, sin código.
- **P-R7-A:** la regla de pasar de socio a anfitrión (espera el OK).
- **Nosara:** su agente, su secreto y encender el local.

### Backlog del Club (ideas para después del piloto; no se construyen ahora)
- **Rendimiento del salonero por tipo de cliente** (idea del dueño, 10-nov). Con el `salonero_login` de cada factura:
  el promedio por pax y los productos por pax de cada salonero, separados por turista, Local Club o socio, promo, menú de
  mediodía, descuentos y venta a crédito. Esos clientes consumen menos y hoy ensucian el promedio del salonero.
  - Al diseñarlo: revisar de dónde sale cada tipo de cliente (visitas del Club, cupones, Local Club, marcadores de
    descuento, promo, menú de mediodía), definir con el dueño qué es «venta a crédito» en el PoS y cómo se cuenta una
    factura con más de un tipo de cliente.
