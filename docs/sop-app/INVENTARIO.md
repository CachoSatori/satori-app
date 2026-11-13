# Inventario de módulos — App Satori (área 6)

> Verificado contra el código de `main` en `c20e688` (06/11/2026), más el merge `d192549`.
> **Borrador, validar en el local.** Describe el comportamiento esperado: qué ve y qué puede hacer cada rol
> en la pantalla.

## Guías escritas

| Código | Guía | Ruta | Libro del empleado |
|---|---|---|---|
| 6.1 | [Acceso y roles](6.1%20Acceso%20y%20roles.md) | `/login`, `/`, `/registro` | Sí |
| 6.2 | [Caja](6.2%20Caja.md) | `/caja` | Sí |
| 6.3 | [Propinas](6.3%20Propinas.md) | `/propinas` | Sí |
| 6.4 | [Ventas y Dashboard](6.4%20Ventas%20y%20Dashboard.md) (incluye Resumen, Semana y Reporte mensual) | `/ventas` | No |
| 6.5 | [Mi Rendimiento](6.5%20Mi%20Rendimiento.md) (incluye Mis Propinas) | `/mi-rendimiento` | Sí |
| 6.6 | [Admin](6.6%20Admin.md) | `/admin` | No |
| 6.7 | [SoP](6.7%20SoP.md) | `/sops` | Sí |

Todavía **sin guía**: Inventario, Clientes, Finanzas, Bandeja y Prueba (ver abajo). Los códigos 6.8 en adelante
quedan para ellos.

## Módulos en PROD (`main`)

| Módulo | Ruta | Roles (UI) | Tareas principales | Reglas de negocio |
|---|---|---|---|---|
| Acceso / Login | `/login` | Público. Con sesión y perfil, va a `/` | Entrar, salir, «Cuenta deshabilitada» → «Reintentar» | Sin «Crear cuenta». Un solo mensaje de error: «Email o contraseña incorrectos» |
| Primer ingreso | pantalla «Elegí tu contraseña» | Cuentas nuevas creadas desde Admin | Cambiar la contraseña temporal | Mínimo 8 caracteres, distinta de la temporal |
| Registro de clientes | `/registro` | Público | Ninguna, está apagado | Muestra «El registro de clientes vuelve pronto con el Club Satori» |
| Inicio | `/` | Todo usuario activo; cada tarjeta se filtra por rol (ver 6.1) | Navegar; owner, manager y contador ven además el resumen del día: frase, 3 números y «Para hacer hoy» (rediseño B4, `src/shared/layout/pendientes.ts`) | El cajero entra directo a `/caja`. Una ruta sin permiso vuelve a `/`. La lista de tarjetas vive en `src/shared/layout/modulos.ts` |
| Caja | `/caja` | owner, manager, cajero: 6 pestañas («Caja Diaria», «🔒 Cierre del día», «Movimientos», «Proveedores», «Pendientes», «Resumen»). contador: las 4 últimas. La alerta de días sin cierre, solo owner y manager | Abrir y cerrar la Caja Diaria, pagos, gastos e ingresos (foto o manual), propinas, «Dar visto», cierre del día en dos fases con «↺ Recontar», deshacer, «🗑 Borrar TODO el día», saldo a favor, resumen | Una Caja Diaria por día. Cierre de turno: cuadra con menos de ₡500 de diferencia. Cierre del día: tolerancia ₡500 / US$1, un solo reconteo, motivo obligatorio fuera de tolerancia, «Ajuste de cierre» automático. Ingresos de más de ₡100.000 piden aprobación de manager. Cola offline solo para movimientos |
| Propinas | `/propinas` | owner, manager y cajero operan; contador solo lee. «Quincenal», «Estadísticas», «Cocina», «✏ Editar» y «🗑 Eliminar», solo owner y manager | Abrir turno (fecha, AM/PM, tipo de cambio), cargar efectivo y electrónico, quién trabajó y sus horas, coberturas, cerrar, historial, quincenal (CSV e impresión), cocina semanal | Puntos = horas × puntos por hora del rol. Pago redondeado al colón. El tipo de cambio queda fijo al abrir. Solo el electrónico pasa a «Propinas por pagar» en Caja. Q1 = días 1 a 15, Q2 = 16 a fin de mes |
| Mi Rendimiento | `/mi-rendimiento` | salonero, barman, barback, runner, cocina y manager (lo propio); owner además «Ver como», solo lectura | Pestañas «心 Resumen», «📅 Por día», «🍱 Productos», «🗓️ Semana», «¥ Propinas», «🏆 Competencias» | `FUENTE_VENTAS='pos'` (el PoS por encima del Excel). Todo es de solo lectura |
| Mis Propinas | `/mis-propinas` | Redirige a `/mi-rendimiento?tab=propinas` | Ver lo cobrado por quincena | — |
| Ventas | `/ventas` | owner, manager y contador. «Paridad (validación)», solo owner. «Saloneros», «Saloneros x línea», «Evaluación», «Competencias», «Ing. Menú», «Cargar XLS» y «Productos», solo owner y manager | Ver el día y el servicio en vivo, cargar el XLS de respaldo, metas, productos, reporte mensual | `FUENTE_VENTAS='pos'`. «En vivo» se actualiza cada 30 s. «→ Caja» bloqueado después del corte del pozo |
| Resumen | `/resumen` | owner, manager, contador | Cuadre del día | Junta Ventas, Caja y Propinas del día |
| Semana | `/semana` | owner, manager, contador | Esta semana contra la anterior | Los lunes la tarjeta dice «Lunes — revisar» |
| Reporte Mensual | `/reporte-mensual` | owner, manager, contador | Reporte del mes: «↗ Compartir», «🖨 Imprimir» | Resume Ventas, Propinas y Caja del mes |
| Inventario | `/inventario` | owner, manager y contador: «📊 Stock», «🧾 Revisión», «💰 Food Cost», «📦 Movimientos». Solo owner y manager: «🧂 Ingredientes», «📋 Recetas», «🍽 Consumo» | Stock, orden de compra sugerida, revisión de facturas, recetas, consumo, food cost | El consumo pide confirmación y escribe movimientos. Tolerancia de factura: 2 % / ₡50 |
| Clientes (CRM) | `/clientes` | owner, manager, cajero: «Clientes», «Segmentos», «Métricas», «QR registro». «Fidelización» la configuran owner y manager | Fichas, segmentos, reglas de puntos y premios | `REGISTRO_PUBLICO_ACTIVO=false`: el QR y `/registro` están apagados hasta el Club Satori |
| Finanzas | `/finanzas` | owner, manager, contador | P&L presupuesto contra real; «🧾 Facturas para verificar» | Los reales se calculan solos. No hay pantalla para editar el presupuesto |
| Bandeja (inbox) | `/inbox` (`/inbox/share` → `/inbox`) | owner, manager, contador, cajero. Se abre desde el «Compartir» del celular (app instalada) | Fotos de facturas y comprobantes, lectura con IA, confirmar | Pago en efectivo solo cajero y manager, con la Caja Diaria abierta. **Duplicados (13-nov):** la misma foto o la misma clave FE de una factura vigente no entran (bloqueo, todos los roles; las de pagos borrados y las descartadas no cuentan; si la que bloquea espera en la Bandeja, el aviso dice «confirmala en la lista»); mismo proveedor + número + total con otra foto entra con aviso; si no se puede verificar (sin conexión), no entra nada y avisa «No se pudo verificar…». También recibe los documentos extra de una foto cargada desde Caja. **Fecha (13-nov):** día/mes de Costa Rica; la clave FE manda; una fecha imposible se da vuelta con aviso «Revisá la fecha: la leímos como D/M.» y una futura avisa (misma regla que Caja, guía 6.2) |
| SOPs | `/sops` | Todos los roles menos contador | Buscar, leer, «Ver PDF», «Imprimir», «Libros», editar, desactivar | URL firmada de 10 min. «Eliminar» desactiva, no borra |
| Admin | `/admin` | owner | «Empleados», «Usuarios» («+ Nuevo empleado», rol, Habilitar/Deshabilitar), «Puntos por rol», «Tipo de cambio», «Horas trabajadas», botones de reportes | La contraseña temporal se muestra una vez. No se puede crear un owner directo. Un tipo de cambio por fecha |
| Prueba | `/prueba` | owner | «Simulador de cierre de Caja Fuerte» | Banco de pruebas |

## Solo en STAGING (no están en PROD; sin guía hasta que pasen)

| Módulo | Ruta | Roles | Estado |
|---|---|---|---|
| Mi Turno | `/mi-turno` | salonero, barman | Va con el pase del PoS propio |
| Comandero (PoS propio) | `/comandero` | owner, manager, salonero, barman, cajero | Bloqueado por el PILAR (sesión multi-dispositivo) |
| KDS | `/kds` | owner, manager, cocina, barman | Pantalla de cocina y barra |
| Salarios | `/salarios` | owner, manager | Nómina y BioTime. Bloqueos humanos pendientes |
| Admin › «🍣 PoS» | `/admin` (pestaña) | owner | Catálogo y productos del PoS propio |
| Menú global (rediseño B3) | todas las pantallas privadas | Quien tiene 4 tarjetas o más en «Inicio» | Lateral desde 1024 px; barra inferior de hasta 5 botones con «Más» (hoja modal; Escape la cierra, rediseño B6). Mismas tarjetas que «Inicio», agrupadas. Ver 6.1, Tarea 3 |

## Permisos

Las diferencias de permisos conocidas están documentadas fuera del repo.
