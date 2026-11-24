# Inventario de módulos — App Satori (área 6)

> Verificado contra el código de `main` en `c20e688` (06/11/2026), más el merge `d192549`.
> **Borrador, validar en el local.** Describe el comportamiento esperado: qué ve y qué puede hacer cada rol
> en la pantalla.

## Guías escritas

| Código | Guía | Ruta | Libro del empleado |
|---|---|---|---|
| 6.1 | [Acceso y roles](6.1%20Acceso%20y%20roles.md) | `/login`, `/`, `/registro`, `/mi-cuenta` | Sí |
| 6.2 | [Caja](6.2%20Caja.md) | `/caja` | Sí |
| 6.3 | [Propinas](6.3%20Propinas.md) | `/propinas` | Sí |
| 6.4 | [Ventas y Dashboard](6.4%20Ventas%20y%20Dashboard.md) (incluye Resumen, Semana y Reporte mensual) | `/ventas` | No |
| 6.5 | [Mi Rendimiento](6.5%20Mi%20Rendimiento.md) (incluye Mis Propinas) | `/mi-rendimiento` | Sí |
| 6.6 | [Admin](6.6%20Admin.md) | `/admin` | No |
| 6.7 | [SoP](6.7%20SoP.md) | `/sops` | Sí |
| 6.13 | [Club Satori](6.13%20Club%20Satori.md) (**solo staging**, PR #59; incluye multilocal, descuentos y las páginas públicas) | `/club` | Sí |

Todavía **sin guía**: Inventario, Clientes, Finanzas, Bandeja y Prueba (ver abajo). Los códigos 6.8 en adelante
quedan para ellos.

## Módulos en PROD (`main`)

| Módulo | Ruta | Roles (UI) | Tareas principales | Reglas de negocio |
|---|---|---|---|---|
| Acceso / Login | `/login` | Público. Con sesión y perfil, va a `/` | Entrar, salir, «Cuenta deshabilitada» → «Reintentar» | Sin «Crear cuenta». Un solo mensaje de error: «Email o contraseña incorrectos» |
| Primer ingreso | pantalla «Elegí tu contraseña» | Cuentas nuevas creadas desde Admin | Cambiar la contraseña temporal | Mínimo 8 caracteres, distinta de la temporal |
| Mi cuenta | `/mi-cuenta` | Todo usuario logueado. Se abre con «Contraseña» (botón con llave) del Inicio o «Cambiar contraseña» del menú lateral (ver 6.1, Tarea 2b) | Cambiar mi contraseña | Mínimo 10 y no «Débil», pide la actual, cierra las otras sesiones, sin conexión no se puede. Si el owner pidió el cambio (mig 185, guía 6.6 Tarea 2c), la app solo deja estar acá hasta cambiarla (sin conexión no bloquea) |
| Registro de clientes | `/registro` | Público | Ninguna, está apagado | Muestra «El registro de clientes vuelve pronto con el Club Satori» |
| Inicio | `/` | Todo usuario activo; cada tarjeta se filtra por rol (ver 6.1) | Navegar; owner, manager y contador ven además el resumen del día: frase, 3 números y «Para hacer hoy» (rediseño B4, `src/shared/layout/pendientes.ts`); owner y manager, además, «Club · Para revisar hoy» (alertas con umbral, migración 164; ver 6.1 y 6.13) | El cajero entra directo a `/caja`. Una ruta sin permiso vuelve a `/`. La lista de tarjetas vive en `src/shared/layout/modulos.ts` |
| Caja | `/caja` | owner, manager, cajero: 6 pestañas («Caja Diaria», «🔒 Cierre del día», «Movimientos», «Proveedores», «Pendientes», «Resumen»). contador: las 4 últimas. La alerta de días sin cierre, solo owner y manager | Abrir y cerrar la Caja Diaria, pagos, gastos e ingresos (foto o manual), propinas, «Dar visto», cierre del día en dos fases con «↺ Recontar», deshacer, «🗑 Borrar TODO el día», saldo a favor, resumen | Una Caja Diaria por día. Cierre de turno: cuadra con menos de ₡500 de diferencia. Cierre del día: tolerancia ₡500 / US$1, un solo reconteo, motivo obligatorio fuera de tolerancia, «Ajuste de cierre» automático, «Resumen del día» obligatorio (o «Sin novedades»). Ingresos de más de ₡100.000 piden aprobación de manager. Cola offline solo para movimientos |
| Propinas | `/propinas` | owner, manager y cajero operan; contador solo lee. «Quincenal», «Estadísticas», «Cocina», «✏ Editar» y «🗑 Eliminar», solo owner y manager | Abrir turno (fecha, AM/PM, tipo de cambio), cargar efectivo y electrónico, quién trabajó y sus horas, coberturas, cerrar, historial, quincenal (CSV e impresión), cocina semanal | Puntos = horas × puntos por hora del rol. Pago redondeado al colón. El tipo de cambio queda fijo al abrir. Solo el electrónico pasa a «Propinas por pagar» en Caja. Q1 = días 1 a 15, Q2 = 16 a fin de mes |
| Mi Rendimiento | `/mi-rendimiento` | salonero, barman, barback, runner, cocina y manager (lo propio); owner además «Ver como», solo lectura | Pestañas «心 Resumen», «📅 Por día», «🍱 Productos», «🗓️ Semana», «¥ Propinas», «🏆 Competencias» | Ventas solo del PoS (16-nov). Todo es de solo lectura |
| Mis Propinas | `/mis-propinas` | Redirige a `/mi-rendimiento?tab=propinas` | Ver lo cobrado por quincena | — |
| Ventas | `/ventas` | owner, manager y contador. «Saloneros», «Saloneros x línea», «Evaluación», «Competencias», «Ing. Menú», «Productos» y «Mesas internas», solo owner y manager | Menú de 7 entradas desde el 3.5.2 (23-nov): «Resumen» (abre ahí, con «Ayer»; sin sub-pestañas: «Hoy», «Ventas» e «Histórico» se retiraron), «Productos», «Equipo», «Tiempos» (con «Análisis»), «Regalías», «En vivo», «Ajustes». Ver cualquier período y el servicio en vivo, metas, regalías, productos, reporte mensual | Solo del PoS (16-nov: sin «Cargar XLS» ni «Paridad»; histórico viejo solo antes del 5-ene-2024). «En vivo» se actualiza cada 30 s. «→ Caja» retirado con «Hoy» (D12) |
| Resumen | `/resumen` | owner, manager, contador | Cuadre del día | Junta Ventas (del PoS), Caja y Propinas del día |
| Semana | `/semana` | owner, manager, contador | Esta semana contra la anterior | Los lunes la tarjeta dice «Lunes — revisar» |
| Reporte Mensual | `/reporte-mensual` | owner, manager, contador | Reporte del mes: «↗ Compartir», «🖨 Imprimir» | Resume Ventas, Propinas y Caja del mes |
| Inventario | `/inventario` | owner, manager y contador: «📊 Stock», «🧾 Revisión», «💰 Food Cost», «📦 Movimientos». Solo owner y manager: «🧂 Ingredientes», «📋 Recetas», «🍽 Consumo» | Stock, orden de compra sugerida, revisión de facturas, recetas, consumo, food cost | Ventas del consumo y del food cost: del PoS (16-nov). El consumo pide confirmación y escribe movimientos. Tolerancia de factura: 2 % / ₡50. En «🧾 Revisión», un «Cant.», «Factor →base» o «Precio» ilegible muestra el aviso con el cuadro y la línea y apaga «💾 Guardar» y «✓ Completar» (23-nov; misma tabla que la Bandeja). En «📦 Movimientos», un «Costo unitario ₡» ilegible o negativo apaga «✓ Registrar movimiento» con su aviso (antes la compra entraba sin costo y sin egreso en Caja); en «📋 Recetas», «Cantidad» (mayor que 0) y «Merma %» (0 a 50; vacío = 0) ilegibles apagan «+ Agregar» (24-nov, R35) |
| Clientes (CRM) | `/clientes` | owner, manager, cajero: «Clientes», «Segmentos», «Métricas», «QR registro». «Fidelización» la configuran owner y manager | Fichas, segmentos, reglas de puntos y premios | `REGISTRO_PUBLICO_ACTIVO=false`: el QR y `/registro` están apagados hasta el Club Satori. «Registrar interacción» («Monto ₡», «Puntos +», «Puntos −»), las reglas de «Fidelización» y el costo de una recompensa: un cuadro ilegible, negativo o (en puntos) con decimales muestra el aviso con el cuadro y apaga el botón (24-nov, R35) |
| Finanzas | `/finanzas` | owner, manager, contador | P&L presupuesto contra real; «🧾 Facturas para verificar» | Los reales se calculan solos (ventas de salón y delivery: del PoS desde el 16-nov). No hay pantalla para editar el presupuesto |
| Bandeja (inbox) | `/inbox` (`/inbox/share` → `/inbox`) | owner, manager, contador, cajero. Se abre desde el «Compartir» del celular (app instalada) | Fotos de facturas y comprobantes, lectura con IA, confirmar | Pago en efectivo solo cajero y manager, con la Caja Diaria abierta. **Duplicados (13-nov):** la misma foto o la misma clave FE de una factura vigente no entran (bloqueo, todos los roles; las de pagos borrados y las descartadas no cuentan; si la que bloquea espera en la Bandeja, el aviso dice «confirmala en la lista»); mismo proveedor + número + total con otra foto entra con aviso; si no se puede verificar (sin conexión), no entra nada y avisa «No se pudo verificar…». También recibe los documentos extra de una foto cargada desde Caja. **Fecha (13-nov, revisada 14-nov):** día/mes de Costa Rica; la clave FE manda; sin clave se toma la única lectura posible (aviso «Revisá la fecha: la leímos como D/M.» si se dio vuelta); si las dos son posibles, el campo arranca vacío, pregunta «¿… o …?» y no se confirma hasta elegir; futura o de más de 7 días avisa. Si la fecha impresa difiere de la de la clave (15-nov), avisa con las dos («La clave dice … y la factura dice …: revisá la fecha.»), no la cambia en silencio. El movimiento entra el día en que se confirma, nunca en la fecha del documento (también propinas, desde el 14-nov) (misma regla que Caja, guía 6.2) **Paso «Inventario» (23-nov):** si «Cant.», «Factor →base» o «Precio» de una línea tiene algo que no es número («0-450», «5-»), sale el aviso con el cuadro y la línea («Precio · …»: …) y «✓ Ingresar a inventario» queda apagado; antes entraba como 0. Vacío sigue siendo 0. Con «No es inventario» el factor se apaga y vuelve a 1 |
| SOPs | `/sops` | Todos los roles menos contador | Buscar, leer, «Ver PDF», «Imprimir», «Libros», editar, desactivar | URL firmada de 10 min. «Eliminar» desactiva, no borra |
| Admin | `/admin` | owner | «Empleados», «Usuarios» («+ Nuevo empleado», rol, Habilitar/Deshabilitar, «Pedir cambio de contraseña»), «Puntos por rol», «Tipo de cambio», «Horas trabajadas», botones de reportes | La contraseña temporal se muestra una vez. No se puede crear un owner directo. Un tipo de cambio por fecha |
| Prueba | `/prueba` | owner | «Simulador de cierre de Caja Fuerte» | Banco de pruebas |

## Solo en STAGING (no están en PROD; sin guía hasta que pasen)

| Módulo | Ruta | Roles | Estado |
|---|---|---|---|
| Mi Turno | `/mi-turno` | salonero, barman | Va con el pase del PoS propio |
| Comandero (PoS propio) | `/comandero` | owner, manager, salonero, barman, cajero | Bloqueado por el PILAR (sesión multi-dispositivo) |
| KDS | `/kds` | owner, manager, cocina, barman | Pantalla de cocina y barra |
| Salarios | `/salarios` | owner, manager | Nómina y BioTime. Bloqueos humanos pendientes |
| Admin › «🍣 PoS» | `/admin` (pestaña) | owner | Catálogo y productos del PoS propio |
| Club Satori | `/club` | owner, manager, cajero, contador (el cajero solo «Escanear»; el contador solo «Tablero»; «Campañas» y «Locales» solo owner) | Guía 6.13 escrita contra la rama del PR #59; pasa con el pase del Club |
| Menú global (rediseño B3) | todas las pantallas privadas | Quien tiene 4 tarjetas o más en «Inicio» | Lateral desde 1024 px; barra inferior de hasta 5 botones con «Más» (hoja modal; Escape la cierra, rediseño B6). Mismas tarjetas que «Inicio», agrupadas. Ver 6.1, Tarea 3 |

## Permisos

Las diferencias de permisos conocidas están documentadas fuera del repo.
