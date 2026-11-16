# Programas del Club: referentes, concierges, equipo y socios

Define quién es quién en el Club Satori y cómo funcionaba el sistema anterior. Es documentación de negocio; las pantallas
están en la guía [6.13 Club Satori](../sop-app/6.13%20Club%20Satori.md).

## Tipos de miembro

### Referente (`referente`)

- Persona o negocio (hotel, tienda, host) que entrega a sus clientes un beneficio de **10 % de descuento**. Antes era una
  tarjeta física; hoy es el cupón digital de su QR.
- Por cada **6 personas** que usan su cupón gana **1 crédito** para consumir en Satori. Hoy el crédito vale ₡18.000
  (configurable); antes fue 12k, luego 14k y luego 16k.
- Canje de 1, 1,5 o 2 créditos por visita, **solo en salón**.
- Su beneficio es **crédito para consumo**, no plata.

### Concierge (`concierge_pm`, programa «Club PM», desde mar-2024)

- Casi exclusivo de hotelería, en todos sus formatos.
- Prefiere referir al cliente directo y recibe una **comisión del 10 % del consumo** de sus clientes en el restaurante (en
  efectivo o consumido). El cliente recibe un postre de cortesía.
- **Base del 10 % = subtotal** de la cuenta, sin impuestos ni servicio (decisión del dueño, 15-nov-2026, opción A). La invitación a concierges decía «ticket total»: se corrige cuando el programa se reactive.
- **Estado (decisión del dueño): en pausa** (`pm_pausado` en `club_config`). No hay una forma clara de registrar ese gasto
  ante Hacienda: la mayoría de los concierges no puede emitir factura. Por eso hubo poco movimiento últimamente.
  **Pendiente:** definición contable con el contador antes de reactivarlo.

### Equipo (`equipo`)

Personal de Satori. Desde la migración 157 registra personas para el ranking de desempeño, **sin créditos** (decisión D7 A).

### Socio del Local Club

Residente con beneficio de descuento propio. No es anfitrión.

## Cómo funcionaba la página vieja

Detalle completo (canje, alta y pago de concierges, reporte mensual, cancelación de 12 meses): [historico/PROCEDIMIENTOS-sistema-viejo.md](historico/PROCEDIMIENTOS-sistema-viejo.md).

Sistema externo de créditos, reemplazado por el Club en la app el 12-nov-2026; quedó en solo lectura.

- El referente repartía tarjetas físicas; el cliente que llegaba con tarjeta tenía 10 %.
- Las tarjetas se cargaban a mano en la página, muchas veces con atraso (foto por WhatsApp). Por eso había meses en cero.
- El saldo se llevaba en personas y los créditos salían de 1 cada 6 (medio crédito con 3).
- El canje se cobraba en el PoS con el cliente «CRÉDITOS NUEVO» y la forma de pago «Créditos» (queda como cuenta por
  cobrar).
- El Club PM se cerraba como «REGALÍA PM (concierge)» y la comisión se pagaba en caja de proveedores con una factura
  «Concierge/PM».
- Había un gestor con pago fijo mensual.

**Problemas que el Club en la app resuelve:** carga diferida, saldos duplicados, tarjetas sin fecha real, PM sin registro.

## Hoy en la app

Referente y concierge suman personas y créditos con la misma regla. La comisión PM todavía no se calcula (programa en
pausa).
