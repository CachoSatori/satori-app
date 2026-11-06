# Inventario de módulos — App Satori (área 6)

> Verificado contra el código de `main` en `c20e688` (06/11/2026), más la mig 079 (`d192549`, en PROD el 06/11).
> **Borrador, validar en el local.** Los permisos de la base salen de `supabase/migrations/`. La 0095 avisa
> que algunas policies de PROD se crearon fuera de las migraciones: donde no se pudo confirmar, dice
> «(validar)».
>
> **UI** = lo que muestra la pantalla (tarjeta de Inicio, pestañas, botones). **Base** = lo que permite
> Postgres (RLS y funciones). Una cuenta inactiva no tiene permisos en la base: `get_my_role()` devuelve
> NULL desde la 069.

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

| Módulo | Ruta | Roles (UI) | Permisos en la base | Tareas principales | Reglas de negocio |
|---|---|---|---|---|---|
| Acceso / Login | `/login` | Público. Con sesión y perfil, va a `/` | Signup apagado en Auth (`disable_signup`). 068: el alta crea salonero inactivo | Entrar, salir, «Cuenta deshabilitada» → «Reintentar» | Sin «Crear cuenta». Un solo mensaje de error: «Email o contraseña incorrectos» |
| Primer ingreso | pantalla «Elegí tu contraseña» | Cuentas con `app_metadata.cambiar_password` | Edge Function `alta-empleado` (`cambiar_password`); solo ella baja el flag | Cambiar la contraseña temporal | Mínimo 8 caracteres, distinta de la temporal |
| Registro de clientes | `/registro` | Público | 072: `anon` ya no inserta en `customers` | Ninguna, está apagado | Muestra «El registro de clientes vuelve pronto con el Club Satori» |
| Inicio | `/` | Todo usuario activo; cada tarjeta se filtra por rol (ver 6.1) | Cada tarjeta lee con la RLS de su módulo | Navegar; estado en vivo para owner, manager y contador | El cajero entra directo a `/caja`. Una ruta sin permiso vuelve a `/` |
| Caja | `/caja` | owner, manager, cajero: 6 pestañas («Caja Diaria», «🔒 Cierre del día», «Movimientos», «Proveedores», «Pendientes», «Resumen»). contador: las 4 últimas. La alerta de días sin cierre, solo owner y manager | `cash_*` y `suppliers`: leen y escriben owner, manager y cajero (012); contador lee e inserta solo pendientes o banco (038). Borrado por `delete_movement_cascade` (motivo obligatorio, auditado). `cerrar_dia_completo`: owner, manager y cajero. `deshacer_cierre_dia`: owner y manager, o cajero con clave de gerencia verificada en el servidor (071). Cambios de montos registrados en `movement_edits` (052) | Abrir y cerrar la Caja Diaria, pagos, gastos e ingresos (foto o manual), propinas, «Dar visto», cierre del día en dos fases con «↺ Recontar», deshacer, «🗑 Borrar TODO el día», saldo a favor, resumen | Una Caja Diaria por día. Cierre de turno: cuadra con menos de ₡500 de diferencia. Cierre del día: tolerancia ₡500 / US$1, un solo reconteo, motivo obligatorio fuera de tolerancia, «Ajuste de cierre» automático. Ingresos de más de ₡100.000 piden aprobación de manager. Cola offline solo para movimientos |
| Propinas | `/propinas` | owner, manager y cajero operan; contador solo lee. «Quincenal», «Estadísticas», «Cocina», «✏ Editar» y «🗑 Eliminar», solo owner y manager | `tip_sessions` y `tip_entries`: escriben owner, manager y cajero (012); leen todos los usuarios con sesión (073). `role_tip_points`: solo owner (001) | Abrir turno (fecha, AM/PM, tipo de cambio), cargar efectivo y electrónico, quién trabajó y sus horas, coberturas, cerrar, historial, quincenal (CSV e impresión), cocina semanal | Puntos = horas × puntos por hora del rol. Pago redondeado al colón. El tipo de cambio queda fijo al abrir. Solo el electrónico pasa a «Propinas por pagar» en Caja. Q1 = días 1 a 15, Q2 = 16 a fin de mes |
| Mi Rendimiento | `/mi-rendimiento` | salonero, barman, barback, runner, cocina y manager (lo propio); owner además «Ver como», solo lectura | Ventas del PoS por las funciones de la 067, sin medios de pago. `ventas_*`: leen todos (011). Propinas: leen todos (073) | Pestañas «心 Resumen», «📅 Por día», «🍱 Productos», «🗓️ Semana», «¥ Propinas», «🏆 Competencias» | `FUENTE_VENTAS='pos'` (el PoS por encima del Excel). Todo es de solo lectura |
| Mis Propinas | `/mis-propinas` | Redirige a `/mi-rendimiento?tab=propinas` | Igual que Mi Rendimiento | Ver lo cobrado por quincena | — |
| Ventas | `/ventas` | owner, manager y contador. «Paridad (validación)», solo owner. «Saloneros», «Saloneros x línea», «Evaluación», «Competencias», «Ing. Menú», «Cargar XLS» y «Productos», solo owner y manager | `ventas_*` y `product_map`: leen todos con sesión; escriben owner, manager y contador (011). `pos_ndf_*`: leen owner, manager y contador (062) | Ver el día y el servicio en vivo, cargar el XLS de respaldo, metas, productos, reporte mensual | `FUENTE_VENTAS='pos'`. «En vivo» se actualiza cada 30 s. «→ Caja» bloqueado después del corte del pozo |
| Resumen | `/resumen` | owner, manager, contador | `ventas_dias`, `cash_*`, `tip_*` | Cuadre del día | Lee solo el Excel (`ventas_dias`) |
| Semana | `/semana` | owner, manager, contador | `ventas_dias`, `tip_sessions` | Esta semana contra la anterior | «Lunes — revisar». Lee solo el Excel |
| Reporte Mensual | `/reporte-mensual` | owner, manager, contador | `ventas_*`, `tip_*`, `cash_movements` | Reporte del mes: «↗ Compartir», «🖨 Imprimir» | Lee el Excel, no el PoS |
| Inventario | `/inventario` | owner, manager y contador: «📊 Stock», «🧾 Revisión», «💰 Food Cost», «📦 Movimientos». Solo owner y manager: «🧂 Ingredientes», «📋 Recetas», «🍽 Consumo» | `ingredients` y `inventory_movements`: escriben owner, manager y cajero (017). Recetas: owner y manager activos (069). Revisión: owner, manager y contador (040). Lectura: (validar) | Stock, orden de compra sugerida, revisión de facturas, recetas, consumo, food cost | El consumo pide confirmación y escribe movimientos. Tolerancia de factura: 2 % / ₡50 |
| Clientes (CRM) | `/clientes` | owner, manager, cajero: «Clientes», «Segmentos», «Métricas», «QR registro», «Fidelización» | `customers`: leen owner, manager, contador y cajero; escriben owner, manager y cajero (004). Fidelización: solo owner y manager (005). `anon` cerrado (072) | Fichas, segmentos, reglas de puntos y premios | `REGISTRO_PUBLICO_ACTIVO=false`: el QR y `/registro` están apagados hasta el Club Satori |
| Finanzas | `/finanzas` | owner, manager, contador | `finance_*`: leen owner, manager y contador; escriben owner y manager (006) | P&L presupuesto contra real; «🧾 Facturas para verificar» | Los reales se calculan solos. No hay pantalla para editar el presupuesto |
| Bandeja (inbox) | `/inbox` (`/inbox/share` → `/inbox`) | Ruta: owner, manager, contador, cajero. **Sin tarjeta en Inicio**: se llega por el «Compartir» de la PWA | `documents` y su bucket (016): owner, manager, contador, cajero | Fotos de facturas y comprobantes, lectura con IA, confirmar | Pago en efectivo solo cajero y manager, con la Caja Diaria abierta. Detecta duplicados |
| SOPs | `/sops` | Tarjeta: todos los roles menos contador. Ruta: cualquier usuario activo | `sops`: lee un usuario **activo** (010 + 079); escriben owner y manager. PDF de `sops/*`: usuario activo (077 + 079). Libro de franquicia: solo owner y manager (077, restrictiva) | Buscar, leer, «Ver PDF», «Imprimir», «Libros», editar, desactivar | URL firmada de 10 min. «Eliminar» desactiva, no borra |
| Admin | `/admin` (OwnerRoute) | owner | `profiles`: cambiar rol o activación exige owner activo (068). `employees`: escriben owner y manager (001). `role_tip_points`: owner (001). `exchange_rates`: owner, manager y contador (011). Alta y reportes: Edge Functions que exigen owner activo | «Empleados», «Usuarios» («+ Nuevo empleado», rol, Habilitar/Deshabilitar), «Puntos por rol», «Tipo de cambio», «Horas trabajadas», botones de reportes | La contraseña temporal se muestra una vez. No se puede crear un owner directo. Un tipo de cambio por fecha |
| Prueba | `/prueba` (OwnerRoute) | owner | Solo lectura | «Simulador de cierre de Caja Fuerte» | Banco de pruebas |

## Solo en STAGING (no están en PROD; sin guía hasta que pasen)

| Módulo | Ruta | Roles | Estado |
|---|---|---|---|
| Mi Turno | `/mi-turno` | Tarjeta: salonero, barman (la ruta deja además a owner y manager) | RPC `my_turno_stats` (026). Va con el pase del PoS propio. `my_turno_stats` todavía se ejecuta sin sesión en staging |
| Comandero (PoS propio) | `/comandero` | owner, manager, salonero, barman, cajero | Migraciones 022–036. Bloqueado por el PILAR (sesión multi-dispositivo) |
| KDS | `/kds` | Tarjeta: owner, manager, cocina, barman (la ruta suma cajero y runner) | Pantalla de cocina y barra |
| Salarios | `/salarios` | Tarjeta: owner, manager (la ruta suma contador) | Migraciones 055–061 (nómina, BioTime). Bloqueos humanos pendientes |
| Admin › «🍣 PoS» | `/admin` (pestaña) | owner | Catálogo y productos del PoS propio |

## Diferencias entre la pantalla y la base (para revisar; no se corrigen en este PR)

1. **Rutas sin lista de roles:**
   - `/sops`: el contador no tiene tarjeta, pero puede entrar escribiendo la URL.
   - `/inbox`: no tiene tarjeta.
   - Los accesos directos de la PWA apuntan a `/proveedor` y `/comandero`, que no existen en `main`.
2. **OwnerRoute no mira `is_active`** (`/admin`, `/prueba`). La base y las funciones sí lo bloquean.
3. **Caja:**
   - El contador ve botones que la base le rechaza («+ Nuevo movimiento», «✓ Pagado», «✕ Rechazar»…).
   - La clave de gerencia se pide solo en la pantalla para «Dar visto», ediciones y «✕ Rechazar»; la base deja hacerlo al cajero directo.
   - El saldo a favor le falla al cajero aunque ponga la clave, porque la función solo acepta owner o manager.
   - La política `cierre_write` incluye al contador, pero la pantalla no.
4. **Propinas:**
   - El cajero puede editar y borrar turnos en la base, aunque la pantalla se lo oculta.
   - No hay restricción única por fecha y turno.
   - Las horas aceptan cuartos de hora, pero la columna guarda un decimal.
   - «Quincenal» recalcula los pagos en vez de leer los guardados.
5. **Lecturas amplias:**
   - Cualquier usuario con sesión lee las propinas de todos (073) y las ventas del PoS de todo el local (067).
   - En Ventas, la base deja escribir al contador en tablas que la pantalla le oculta (011).
6. **SoP:**
   - La policy general del bucket (016) deja a cajero y contador escribir en `sops/*`.
   - «Eliminar» desactiva y no muestra errores.
7. **CRM:** la pestaña «Fidelización» se le muestra al cajero, pero la base solo deja guardar a owner y manager.
8. **Resumen, Semana y Reporte mensual** leen solo el Excel, así que sus totales pueden no coincidir con Ventas («Hoy»).
9. **Repo público:** en el código de `main` hay **nombres reales de personas** (una exclusión por nombre en `TipCocina.tsx`, visible en pantalla, y comentarios en `MiRendimientoWrap.tsx`, `admin.ts` y la mig 067) y **correos reales** (un alias en la pantalla de Admin y un destinatario fijo en `supabase/functions/monthly-report/`). No se copiaron a estas guías. Hay que sacarlos del código en un PR aparte.
