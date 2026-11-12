# Inventario de funciones del Club Satori

> Qué hace hoy el Club, pantalla por pantalla, para compararlo con otras apps de clubes. Lenguaje simple.
> Estado al **10-nov**, sobre la rama del Club (PR #59 y sus ramas: S0/S8, S0b/S2, fechas). **Todavía no está en
> producción**: hoy corre en staging. Los nombres de botones van entre «comillas», como en la pantalla.
> Detalle operativo: la guía [`6.13 Club Satori`](../sop-app/6.13%20Club%20Satori.md).

## En una mirada

- **Dos programas en uno:**
  - **Anfitriones** (referentes, concierges de hoteles y equipo). Recomiendan Satori. Cada persona que llega con su
    cupón les suma, y 6 personas = 1 crédito. Los créditos se canjean en el restaurante.
  - **Socios del Local Club** (gente que vive en la zona). Tienen un beneficio en cada visita: hoy, 10 % y una cortesía
    sorpresa.
- **Sin app para descargar:** el turista, el anfitrión y el socio usan páginas web y un QR. El personal usa el módulo
  «Club» de la app de Satori.
- **El PoS no se toca:** la caja registra en el Club y aplica a mano en el PoS lo que dice la pantalla. Después, el
  puente lee las facturas del PoS y el Club **controla** que coincidan (las «Excepciones»).
- **Multilocal:** el Club se prende o se apaga por local. El socio vale en todos los locales prendidos.
- **Roles:** owner, manager y cajero. El contador no entra al módulo.

## Quién ve qué

| Pantalla | owner | manager | cajero |
|---|---|---|---|
| Escanear | sí | sí | sí (es lo único que ve) |
| Miembros | sí | sí | — |
| Negocios | sí | sí | — |
| Excepciones | sí | sí | — |
| Reportes | sí (más vencimiento, cerrar el mes y contactos para ofertas) | sí | — |
| Promociones | edita | solo mira | — |
| Descuentos | edita | solo mira | — |
| Locales | sí | — | — |

En el «Inicio» de la app, la tarjeta «Club» muestra cuántas excepciones hay abiertas.

---

## 1. Escanear (caja)

**Quién:** owner, manager y cajero.

**Qué hace:**
- **Leer un código:** con la cámara («📷 Escanear») o escribiéndolo en «Código a mano». Reconoce cuatro cosas: el cupón del
  turista, el código de canje del anfitrión, el pase del anfitrión y el QR del socio.
- **Buscar a un anfitrión sin código** (plan B): por nombre, negocio o los últimos 4 del teléfono. Cada búsqueda queda
  registrada y hay un tope por minuto.
- **Elegir el pedido de la mesa:** la lista de pedidos abiertos del PoS, que llega por el puente.
  - Si el pedido ya se cerró o el puente está caído: «Factura (plan B)», la lista de facturas cobradas de las últimas 2
    horas.
  - Una factura cobrada que todavía no pasó el cierre de caja aparece con la nota «Cobrada, falta el cierre de caja:
    vale igual».
- **Cupón del turista:** elegir cuántas personas hay en la mesa (1 a 30) y el pedido, y confirmar. Suma personas al
  anfitrión. El cajero aplica el 10 % en el PoS y marca el artículo «PROMO CLUB 10 %».
- **Canje de créditos:** el anfitrión muestra un código de 6 caracteres que genera en su portal; vale 10 minutos y sirve
  una vez. Se elige cuánto canjear: 1, 1,5 o 2 créditos, con su valor en colones. Al confirmar sale el enlace
  «Avisarle por WhatsApp ↗».
  - **«Canje sin celular»** (solo owner y manager): pide el motivo y queda como excepción para que otra persona lo
    revise.
- **Visita del socio:** «Registrar visita y ver qué aplicar». La pantalla dice exactamente qué aplicar en el PoS: el %, la
  cortesía sorteada, el artículo 856 (LOCAL CLUB) y un 857 (INVITADO) por cada acompañante.
  - Una visita con beneficio por día en cualquier Satori, y un socio con beneficio por factura.
  - Si no hay beneficio, el recuadro sale con borde rojo y dice por qué: ya lo usó hoy, va como invitado, paga con
    créditos o no hay promoción vigente.
- **Socios:** validar a un socio que se anotó por la web, o dar de alta uno nuevo en caja.
  - El alta queda **provisional** hasta que otra persona la confirma.
  - Nunca se anota un número de documento.
- **Sin conexión:** «Reintentá: no se va a duplicar». Cada operación tiene su id.

**Datos que usa:**
- cupones, anfitriones y socios del Club;
- pedidos abiertos y facturas del PoS (por el puente);
- la promoción vigente y las cortesías del local;
- el saldo de créditos.

**A medias o pendiente:**
- **Cuenta dividida, mesas juntadas, refacturas:**
  - con el agente viejo del puente, algunas partes de una cuenta dividida no se suman;
  - mejoras propuestas, sin hacer: S1, S3 (necesita el agente nuevo), S4, S5, S6 y S7 (ver
    [FLUJO-SALON-cruce](FLUJO-SALON-cruce.md));
  - hechas: S0, S0b, S2 y S8.
- **Visita de socio en una mesa juntada:** no hay pantalla para elegir la factura (propuesta S1). En ese caso se puede
  perder el premio por referido.
- **Búsqueda de facturas por número de tiquete:** con el agente viejo no llega el número de la factura electrónica. El
  agente nuevo ya lo manda (en ensayo en staging).

## 2. Miembros

**Quién:** owner y manager.

**Qué hace:**
- **Tres listas:** «Referentes y concierges», «Equipo» y «Socios», con filtro por nombre o negocio.
- **«+ Nuevo»:** tipo, nombre, negocio, estado y contacto. El anfitrión queda en el local elegido.
- **En la ficha de cada miembro:**
  - el saldo (créditos y colones) y la última actividad;
  - bajar su QR, copiar el link de su portal y regenerar el QR;
  - «Activar como anfitrión»: un socio que empieza a compartir cupones;
  - revocar o regenerar el botón «Canjear» de su pase;
  - **solo owner:** «Ajuste», para corregir un error (puede ser negativo), y «Restitución», para devolver personas
    vencidas.
- **Aprobaciones**, siempre por una persona distinta de quien registró:
  - «Personas pendientes de aprobación»: las de un anfitrión nuevo que pasó el tope del mes;
  - «Altas por confirmar» de socios.
- **Baja y reactivación:** pasar a una persona a «Baja» y después a «Activo» le devuelve sus roles. La excepción es el
  socio que se dio de baja él mismo: ese rol no vuelve, salvo que se anote otra vez en caja.

**Datos que usa:** miembros, negocios, movimientos (tarjeta, canje, ajuste, restitución) y saldos.

**A medias o pendiente:**
- **Pasar de socio a anfitrión:** hoy solo con «Activar como anfitrión». Hay un plan para ordenar esa regla (P-R7-A),
  que **espera el OK** del dueño.
- **Carga inicial de saldos de papel:** se hace con una herramienta aparte (plantilla y validador), no desde la
  pantalla.

## 3. Negocios

**Quién:** owner y manager.

**Qué hace:** la lista de negocios (hoteles, tiendas…) de donde vienen los anfitriones. Alta, edición, activo o
inactivo, y cuántos miembros tiene cada uno.

**Datos que usa:** negocios y miembros.

**A medias o pendiente:** nada abierto.

## 4. Excepciones (controles)

**Quién:** owner y manager. Quien registró algo no puede resolver su propia excepción.

**Qué hace:**
- **Compara lo que se registró en el Club con las facturas del PoS** y muestra las diferencias. Se filtra por fechas y
  por tipo, y se pueden ver las ya resueltas.
- **Cada excepción** trae «Qué es», el detalle del PoS (factura, mesa, total, turno y login del PoS) y «Resolver con
  nota».
- **Tipos (22), en simple:**
  - **Del cupón y la tarjeta:**
    - promo sin cupón;
    - cupón sin promo;
    - cupón autorreferido;
    - visita repetida;
    - personas por encima del pax;
    - tarjeta física cargada a mano.
  - **Del canje:**
    - créditos sin canje;
    - canje con monto distinto;
    - canje con descuento;
    - canje sin código.
  - **Del cruce con la factura:**
    - registro sin factura;
    - sin cruce (posible cuenta dividida): **el manager puede elegir la factura**;
    - factura ambigua.
  - **Del socio:**
    - Local Club sin registro (se dio el 856 sin escanear al socio);
    - visita de socio sin el 856;
    - uso raro del QR de socio;
    - alta de socio sin confirmar.
  - **De cortesías:**
    - cortesía distinta de la sorteada;
    - cortesía sin socio;
    - línea a ₡0 fuera de cortesías.
  - **De descuentos y topes:**
    - descuento sin respaldo, con los descuentos «clasificados» por porcentaje aparte de la alarma real;
    - anfitrión sobre el tope del mes.
- **Factura en R** (cobrada, falta el cierre de caja): cuenta como cobrada y no dispara «sin cruce» ni «registro sin
  factura». Los controles exactos esperan al cierre de caja.
- **Excepciones del PoS con login fijo de caja:** las resuelve el owner, que identifica a la persona por la fecha y el
  turno.

**Datos que usa:**
- movimientos del Club;
- facturas y líneas del PoS (por el puente);
- marcadores de descuento, cortesías y la configuración del local;
- logins del PoS de cada empleado.

**A medias o pendiente:**
- La excepción «descuento sin respaldo» es lenta con muchos datos: 2,8 s sobre 60 días en staging. Para mirar antes
  del piloto.
- Las mejoras de cuentas divididas (S1, S4, S5, S6) cambian lo que se puede resolver acá.
- Tres decisiones del dueño que no llegaron escritas: excepciones de funciones (G-56), reintentos del pase y la regla de
  `club_sin_cruce_elegir` ([AVANCE-LC](AVANCE-LC.md)).

## 5. Reportes

**Quién:** owner y manager. Algunas acciones, solo el owner.

**Qué hace:**
- **Reporte del mes por local:** abre en el mes en curso, que se ve parcial («mes en curso»).
  - **Indicadores:** personas referidas (contra el mes anterior), créditos canjeados y su valor, créditos en saldo y
    cuentas con saldo, cupones usados y generados.
  - **Listas:** ranking de anfitriones, «A contactar» (créditos que vencen en 30 días) y «Dormidos» (cuentas sin
    actividad).
  - **«Altas de socios por usuario»** y **«Visitas de socios por usuario»:** cuántas cargó cada persona del equipo, sin
    factura y cuántas veces el mismo socio.
- **«Exportar PDF»** (A4) y **«Exportar CSV»:** cada exporte queda registrado (quién, cuándo, mes y local).
- **Comparación con la página vieja:** personas por anfitrión y por semana, lado a lado, para el piloto en paralelo.
- **Solo owner:**
  - **«Contactos para ofertas (CSV)»:** los turistas que aceptaron recibir ofertas, cada uno con su link de baja;
  - **Vencimiento por inactividad:** primero «Simular vencimiento», que muestra la lista sin tocar nada, y después
    «Confirmar». Vence el saldo de las cuentas sin actividad en el plazo (12 meses) y el corte es hoy;
  - **«Cerrar el mes»:** congela el reporte con una huella. Para «Recerrar» hace falta un motivo. Solo se cierran meses
    terminados.

**Datos que usa:** movimientos, saldos, cupones, visitas de socios, altas y los cierres de mes guardados.

**A medias o pendiente:**
- **La comparación con la página vieja** sirve solo para el piloto en paralelo. Después se puede sacar.
- **No hay reportes por campaña**, de clientes nuevos contra recurrentes, ni de ticket promedio de socios.

## 6. Promociones (y cortesías del sorteo)

**Quién:** el owner edita; el manager solo mira.

**Qué hace:**
- **Promociones:** nombre, para quién, descuento (%), cuántas cortesías se sortean por visita, fechas, horario y días.
  - Estados: borrador → vigente → terminada. Una terminada no se edita.
- **«Cortesías del sorteo» (hasta 10):** se buscan en las facturas, entre los artículos de la sección «CORTESÍA CLUB» del
  PoS. Cada una se prende o se apaga. En cada visita de socio se sortea cuál toca.

**Datos que usa:** promociones, cortesías y los artículos del PoS (por el puente).

**A medias o pendiente:** el mínimo para el lanzamiento. No hay promociones por cumpleaños, por cantidad de visitas ni
por nivel.

## 7. Descuentos (marcadores)

**Quién:** el owner edita; el manager solo mira.

**Qué hace:**
- **«Marcadores de descuento»:** el artículo del PoS que respalda un descuento autorizado (856, 857, la promo, tarjetas
  de hoteles o tiendas, personal…).
  - Con un % esperado, respalda solo ese porcentaje (±1,5 puntos). Sin %, respalda cualquiera.
  - Se prenden y se apagan; no se borran.
- **«Descuentos tipificados por porcentaje»:** descuentos que el PoS aplica sin artículo. Se les pone nombre para que no
  salgan como alarma.
- **«Reporte de descuentos sin artículo»:** facturas y monto estimado por mes, tipo y turno, con las filas «sin
  clasificar» en rojo.

**Datos que usa:** marcadores, tipos de descuento y las líneas de las facturas del PoS.

**A medias o pendiente:** nada abierto.

## 8. Locales

**Quién:** solo owner.

**Qué hace:**
- La lista de locales con el Club prendido o apagado. «Encender» y «Apagar» piden confirmación.
- **«Crear local (apagado)»:** id, nombre, dirección y mapa. Se puede copiar la configuración de otro local.
- Con más de un local prendido, arriba aparece el selector «Local», que queda recordado en el aparato.

**Datos que usa:** la configuración del Club por local. Todo cambio queda en el historial.

**A medias o pendiente:**
- **El segundo local** (Nosara) está cargado pero apagado. Le falta el agente del puente y su secreto.
- **Una sola lista de locales para toda la app:** la propuesta (migración 100) está escrita y sin aplicar. Va en el pase
  del Club.

## 9. Páginas públicas (club-web)

**Quién:** cualquiera con el enlace o el QR. Están en **español e inglés**.

**Qué hace:**
- **QR del anfitrión** (`/r/…`):
  - el turista pasa una verificación de Cloudflare (casi siempre automática) y obtiene su cupón 10 %, con QR,
    vencimiento y cómo llegar;
  - opcional: aceptar recibir ofertas, con el aviso de privacidad.
  - Hay topes por red y por anfitrión.
- **Baja de ofertas** (`/b/…`): borra el contacto del turista.
- **Aviso de privacidad** (`/privacidad`): el texto completo vigente.
- **Portal del miembro** (`/p/…`):
  - **anfitrión:** saldo en créditos y colones, y «Canjear» (genera el código de 10 minutos);
  - **socio:** «Mi Club» con el beneficio de hoy, su QR y «Darme de baja del Local Club».
- **Alta de socio** (`/alta`): «Sumate al Local Club», con el aviso de privacidad. Queda pendiente hasta que se valida
  en caja; si en 30 días no se valida, se borra.

**Datos que usa:** cupones, miembros, saldos y contactos para ofertas (solo los que aceptaron). Las páginas no ven
nada del PoS.

**A medias o pendiente:**
- No hay inicio de sesión con contraseña: el portal se abre con su enlace privado.
- No hay historial de visitas ni de canjes para el miembro: solo el saldo.

## 10. Pase de Wallet (Google; Apple apagado)

**Quién:** anfitriones y socios, desde su portal o al anotarse.

**Qué hace hoy:**
- **Hecho en una rama aparte, sin desplegar:**
  - la función que arma el pase de Google Wallet («Guardar en Google Wallet»);
  - el botón en el portal y en el alta. Está apagado por una opción de configuración.
- **El pase muestra:** saldo (créditos y colones) y personas referidas, o el beneficio del socio.

**A medias o pendiente:**
- **B3** (en curso): actualizar el pase solo cuando cambia algo (canje, baja).
- **B4:** Apple Wallet. Apagado.
- **B5:** prueba real en un teléfono y el código de barras según el rol.
- No se manda ningún aviso por el pase (notificaciones).

---

## Lo que el Club NO hace hoy (para comparar con otras apps)

- **Sin app propia:** son páginas web y un QR. El pase de Wallet existe, pero sin desplegar.
- **Puntos:** no se ganan por gasto (₡). Se ganan por **personas referidas** (anfitriones) o por **visita** (socios).
- **Sin niveles** (plata, oro…), sin cumpleaños y sin «la 10.ª visita gratis».
- **Mensajes:** no se mandan automáticos (ni WhatsApp, ni email, ni push). Hay un enlace para avisar por WhatsApp a
  mano, y la exportación de contactos que aceptaron ofertas.
- **El PoS no se integra en las dos direcciones:** la caja aplica a mano lo que dice la pantalla, y el Club controla
  después con las facturas.
- **Sin pago ni recarga online:** los créditos solo se canjean en el restaurante.
- **No hay encuestas, reseñas ni referidos entre socios.** El premio por referido es solo para el que refiere y se da
  con la primera factura del referido.

## Dónde mirar más

- Guía de uso: [`docs/sop-app/6.13 Club Satori.md`](../sop-app/6.13%20Club%20Satori.md).
- Avance y pendientes: [AVANCE-LC.md](AVANCE-LC.md).
- Flujo del salón y mejoras S0–S8: [FLUJO-SALON-cruce.md](FLUJO-SALON-cruce.md).
- Contrato del pase de Wallet: [CONTRATO-pase.md](CONTRATO-pase.md).
