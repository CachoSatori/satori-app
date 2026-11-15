# Sistema viejo de créditos y comisiones — cómo se operaba

Registro histórico de cómo funcionaban los programas de referentes y concierges **antes** del Club Satori en la app.
Sirve para migrar sin perder reglas y para entender los datos viejos. El modelo de datos de la página vieja está en
[PERFIL-SISTEMA-ACTUAL.md](../PERFIL-SISTEMA-ACTUAL.md); las definiciones vigentes, en
[PROGRAMAS-referentes-y-concierges.md](../PROGRAMAS-referentes-y-concierges.md).

Fuentes (privadas, en el Drive del negocio y en el proyecto de Claude): «SOP – Créditos» (sep-2025) y su versión
«SOP 2.7 Créditos» (nov-2026), «Debitación de créditos» y «Cómo cerrar las mesas PM» (abr/may-2025), «Protocolo de
reclutamiento de concierges y PM» (jun-2025), la invitación PM en español e inglés (may-2025), la propuesta «Programa
créditos» (feb-2026), los reportes mensuales de créditos (oct-2026) y la cancelación por vencimiento del 05-nov-2026.
Este archivo no copia nombres, contactos ni montos reales (repo público).

## 1. Referentes: tarjetas de 10 % y créditos

- Hoteles, tiendas y hosts reciben tarjetas físicas de **10 % de descuento** para entregar a sus clientes.
- Cuando un cliente paga con la tarjeta, se anota en la página vieja **«Cargar tarjeta»**: referente + cantidad de
  personas. La carga se hacía a mano y muchas veces con días o semanas de atraso (un mes entero se cargó junto a
  principios del mes siguiente).
- **6 personas = 1 crédito.** Hay medios créditos (3 personas = 0,5).
- Valor del crédito: **₡18.000** desde feb-2026 (antes ₡16.000). La propuesta que lo subió también planteaba un pago
  variable por persona al gestor del programa a partir de un umbral mensual; quedó como propuesta de gestión, no como
  regla del sistema.
- La comunicación de bienvenida a cada referente la hacía una persona del equipo por WhatsApp, con un mensaje armado.

### Canje (pagar con créditos)

1. En la página vieja: **Créditos → Consumir crédito**, buscar al referente por nombre o lugar de trabajo, ver el
   saldo e ingresar los créditos a usar. **Máximo 2 por uso.**
2. En el PoS: cliente **«CRÉDITOS NUEVO»**, forma de pago «Créditos» por el monto del crédito (o el total de la cuenta,
   si el crédito la cubre). La diferencia se cobra en efectivo o tarjeta; el vuelto se calcula aparte, porque la mesa no
   cierra si el monto no coincide.
- **Pedidos para llevar: no se pagan con créditos**, salvo autorización del manager con visto bueno de un dueño.
- Mesas que separan cuentas: quien paga con créditos paga de último, desde la ventana principal.
- Controles del manager (SOP 2.7): cada canje con respaldo en el sistema de créditos, ninguna cuenta con diferencias,
  el límite de 2 respetado. Meta: ₡0 de diferencias y 0 consumos sin respaldo.

## 2. Concierges y property managers (Club PM, desde mar-2024)

**Qué se ofrecía** (invitación PM): por cada mesa reservada por el concierge, Satori registra **10 % del ticket** y a fin
de mes el concierge elige entre saldo para consumir, gift card o comisión en efectivo (**con factura**). Los clientes
reciben un **postre de cortesía**.

**Regla de oro:** la comisión cuenta **solo si el concierge hizo la reserva** por el canal oficial. Que el cliente diga
«vengo de parte de…» no vale.

### Alta de un concierge
1. Contacto por WhatsApp con un mensaje armado y el PDF de la invitación (español o inglés).
2. Número correlativo y nombre con sufijo **«PM»** (formato `NN/ Nombre PM`), con las villas u hoteles que maneja.
3. Se registraba igual en tres lugares: una hoja propia en la planilla de comisiones, un «cliente» en el PoS (con el
   número de concierge en el campo de identificación, para que coincida con la planilla) y una persona en la sección
   Club de la página vieja.
4. Se lo sumaba a un grupo de WhatsApp de reservas. Un hotel grande tenía grupo propio y acumulaba las comisiones como
   premio para sus mejores vendedores, con el mismo informe mensual.

### Reserva y servicio
- Formato fijo en el grupo: **nombre del concierge · nombre del cliente · fecha · hora · comensales**.
- Quien ve el mensaje (salonero, manager o barra) la carga en OpenTable aclarando a qué concierge pertenece.
- El manager de turno avisa al salonero que es «cliente PM» y que corresponde el postre de cortesía.
- Con el cliente sentado, caja o el manager ponen el nombre del concierge en la mesa del PoS.

### Registro de la comisión
- Al cerrar, caja o el manager cargan en la página vieja (**Club → Cargar crédito**) el **10 % del subtotal** de la
  cuenta, ya calculado: la página no calcula el porcentaje ni guarda la factura ni la mesa.
- En paralelo, la planilla de comisiones tiene una hoja por concierge con recuadros por mes (fecha, reserva, personas,
  subtotal y 10 % automático). Ambas sumas tienen que coincidir.

> Diferencia entre fuentes: el protocolo interno dice 10 % del **subtotal**; la invitación al concierge dice 10 % del
> **ticket total**. La app nueva tiene que fijar una sola base (ver decisión abierta en el handoff).

### Pago de la comisión
- **A comienzo de cada mes**, informe a cada concierge (captura de su saldo) avisando que puede pasar a cobrar.
- **En efectivo:** lo paga solo el encargado de turno con acceso a la caja de proveedores, como proveedor
  «Concierge/PM» y con factura.
- **Como consumo** (saldo acumulado): en la página vieja, **Club → Pagar**, el valor a usar; en el PoS, los productos
  que suman aproximadamente ese monto se separan y se cierran como **«REGALÍA PM (nombre)»**; el resto de la mesa se
  cobra normal.
- **Por qué se pausó:** la mayoría de los concierges no puede emitir factura, y no había forma clara de registrar ese
  gasto ante Hacienda. Desde fines de jun-2026 la sección Club de la página vieja no registra movimientos.

## 3. Reporte mensual de créditos (formato oct-2026)

Indicadores y definiciones que usaba el reporte, útiles para replicarlos en el Tablero:
- **Trimestre contra el mismo del año anterior:** personas traídas, tarjetas, créditos otorgados y canjeados.
- **Fechas = fecha de carga** en la página vieja, no de la visita (de ahí los saltos cuando se carga atrasado).
- **Ritmo:** últimos 3 meses contra el promedio de los 9 anteriores.
- **A contactar:** referentes que bajaron más del doble que el programa en el mismo período.
- **Dormido:** ≥ 10 personas en 12 meses y 0 tarjetas en 90 días.
- **Nuevo:** primera tarjeta en los últimos 92 días. **Ascenso:** ≥ 3 personas por mes y ≥ 2 veces su base.
- El **equipo** se reporta aparte de los referentes externos (trae personas pero no compite con ellos).
- Alertas de gestión: comisiones PM pendientes de pago que hay que cruzar con el PoS antes de pagar, y cuentas sin
  sufijo PM con «monto a cobrar» (¿son concierges mal nombrados?).

## 4. Cancelación por vencimiento de 12 meses (05-nov-2026)

- **Criterio:** corte al 05-nov-2026; cuenta inactiva = sin tarjeta cargada y sin canje desde el 05-nov-2025 inclusive;
  solo cuentas con saldo > 0; se cancela todo el saldo, fracciones incluidas. Autorizada por el dueño.
- Se registró como **consumo** porque la página vieja no tiene otro tipo de movimiento: **no son canjes reales** y
  los reportes la excluyen de «créditos canjeados». La migración la marca (`cancelacion_vencimiento_12m`).
- **Restitución:** el dueño decide caso por caso. Se vuelve a cargar con «Cargar tarjeta» la cantidad cancelada
  (créditos × 6 personas, porque la página pide personas), con la nota «RESTITUCIÓN de VENCIMIENTO 12M · fecha», y
  no cuenta como personas traídas.
- La lista por cuenta (con nombres y montos) vive solo en archivos privados, nunca en el repo.

## 5. Qué cambia en la app nueva

| Página vieja | Club Satori en la app |
|---|---|
| Tarjeta física cargada a mano y con atraso | Cupón con QR que se registra al cobrar |
| Sin quién, mesa ni factura | Cada movimiento con operador, local, mesa y factura |
| «PM» = sufijo en el nombre | Tipo de miembro `concierge_pm` |
| 1 fila por crédito consumido | 1 movimiento por canje, con su cantidad |
| Saldo duplicado (tabla + movimientos) | Saldo calculado desde los movimientos |
| Comisión cargada ya calculada | Pendiente: base del 10 % y forma de pago con factura (decisión del dueño) |
